// [netcode-perf] Spatial hash grid (area of interest) for entity queries + monster sleep scheduling.
//
// The grid is refreshed by `sync()`: one O(n) pass over game.entities that moves entities whose cell
// changed, inserts new ones and drops removed ones (no allocation in the steady state). Positions are
// written directly by many systems (movement, AI, tests' teleports), so every query path calls `sync()`
// (or `ensure()`, once per tick) instead of relying on setters. Queries return *candidates* from the cells
// overlapping the circle; callers keep their exact distance test.
//
// Monster sleep: a monster that is not fighting and has no player within WAKE_RADIUS only runs its AI every
// SLEEP_EVERY ticks (with a proportionally larger dt, staggered by id), so a much larger world with many
// more monsters costs almost nothing where nobody is playing.
import { KIND, VIEW_RADIUS } from '../../shared/protocol.js';

export const CELL = 32;                         // metres
export const WAKE_RADIUS = VIEW_RADIUS + 24;    // monsters within this of a player run at full rate
export const SLEEP_EVERY = 10;                  // sleeping monsters tick at TICK_RATE / 10 (2 Hz)

const OFF = 1 << 12;          // cell coordinates are offset so that keys stay positive
const STRIDE = 1 << 13;
export const cellOf = (v) => Math.floor(v / CELL);
const keyOf = (cx, cz) => (cx + OFF) * STRIDE + (cz + OFF);

class Cell {
  constructor() {
    this.players = [];
    this.others = [];
  }
}

export class Aoi {
  constructor(game) {
    this.game = game;
    this.cells = new Map();     // key -> Cell
    this.tracked = new Map();   // entity id -> entry { e, key, list, idx, stamp }
    this.stamp = 0;
    this.syncedTick = -1;
    this.wake = new Map();      // cell key -> wake epoch (cell has a player within WAKE_RADIUS)
    this.wakeEpoch = 0;
    this.stats = { awake: 0, asleep: 0 };
  }

  /** Refresh the grid from the entities' current positions. O(n), allocation-free in steady state. */
  sync() {
    const stamp = ++this.stamp;
    for (const e of this.game.entities.values()) {
      let t = this.tracked.get(e.id);
      const key = keyOf(cellOf(e.x), cellOf(e.z));
      if (t === undefined || t.e !== e) {
        if (t !== undefined) this.unlink(t);
        t = { e, key, list: null, idx: -1, stamp };
        this.tracked.set(e.id, t);
        this.link(t);
      } else if (t.key !== key) {
        this.unlink(t);
        t.key = key;
        this.link(t);
      }
      t.stamp = stamp;
    }
    if (this.tracked.size !== this.game.entities.size) {
      for (const [id, t] of this.tracked) {
        if (t.stamp !== stamp) {
          this.unlink(t);
          this.tracked.delete(id);
        }
      }
    }
    this.syncedTick = this.game.tickCount;
  }

  /** sync() at most once per game tick (for the bulk per-tick users: AI, snapshots). */
  ensure() {
    if (this.syncedTick !== this.game.tickCount) this.sync();
  }

  link(t) {
    let c = this.cells.get(t.key);
    if (c === undefined) this.cells.set(t.key, (c = new Cell()));
    const list = t.e.kind === KIND.PLAYER ? c.players : c.others;
    t.list = list;
    t.idx = list.length;
    list.push(t);
  }

  unlink(t) {
    const list = t.list;
    if (!list) return;
    const last = list.pop();
    if (last !== t) {
      list[t.idx] = last;
      last.idx = t.idx;
    }
    t.list = null;
    t.idx = -1;
  }

  /**
   * Candidate entities within `r` of (x, z) (cells overlapping the circle), appended to `out` (cleared first).
   * `which`: 'players' | 'others' | 'all'. Callers do the exact distance test.
   */
  query(x, z, r, out = [], which = 'all') {
    out.length = 0;
    const x0 = cellOf(x - r), x1 = cellOf(x + r), z0 = cellOf(z - r), z1 = cellOf(z + r);
    const wantP = which !== 'others', wantO = which !== 'players';
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const c = this.cells.get(keyOf(cx, cz));
        if (c === undefined) continue;
        if (wantP) for (let i = 0; i < c.players.length; i++) out.push(c.players[i].e);
        if (wantO) for (let i = 0; i < c.others.length; i++) out.push(c.others[i].e);
      }
    }
    return out;
  }

  /**
   * Players exactly within `r` of (x, z). `fresh` re-syncs the grid first; pass false inside the tick after
   * beginTick()/ensure() (players only move between ticks, so the grid is exact for them there).
   */
  playersNear(x, z, r, out = [], fresh = true) {
    if (fresh) this.sync();
    else this.ensure();
    this.query(x, z, r, out, 'players');
    return filterRadius(out, x, z, r);
  }

  /** Monsters whose body (radius) overlaps the circle (x, z, r) (fresh grid). */
  monstersNear(x, z, r, out = [], maxBody = 8) {
    this.sync();
    this.query(x, z, r + maxBody, out, 'others');
    let n = 0;
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      if (e.kind !== KIND.MONSTER) continue;
      const rr = r + (e.radius || 0);
      const dx = e.x - x, dz = e.z - z;
      if (dx * dx + dz * dz <= rr * rr) out[n++] = e;
    }
    out.length = n;
    return out;
  }

  // ---------------------------------------------------------------- monster sleep
  /** Recompute which cells are awake (have a player within WAKE_RADIUS). Once per tick. */
  refreshWake() {
    const epoch = ++this.wakeEpoch;
    const reach = Math.ceil(WAKE_RADIUS / CELL);
    const r2 = WAKE_RADIUS * WAKE_RADIUS;
    for (const p of this.game.players.values()) {
      const pcx = cellOf(p.x), pcz = cellOf(p.z);
      for (let cx = pcx - reach; cx <= pcx + reach; cx++) {
        // distance from the player to the nearest point of the cell
        const nx = Math.max(cx * CELL, Math.min(p.x, (cx + 1) * CELL)) - p.x;
        for (let cz = pcz - reach; cz <= pcz + reach; cz++) {
          const nz = Math.max(cz * CELL, Math.min(p.z, (cz + 1) * CELL)) - p.z;
          if (nx * nx + nz * nz <= r2) this.wake.set(keyOf(cx, cz), epoch);
        }
      }
    }
    if (this.wake.size > 4096) {
      for (const [k, e] of this.wake) if (e !== epoch) this.wake.delete(k);
    }
    this.stats.awake = 0;
    this.stats.asleep = 0;
  }

  /** True when a player is within ~WAKE_RADIUS of (x, z) (cell granularity, after refreshWake()). */
  isAwakeAt(x, z) {
    return this.wake.get(keyOf(cellOf(x), cellOf(z))) === this.wakeEpoch;
  }

  /**
   * Time step for monster `m` this tick: `dt` when awake, 0 when it skips this tick (asleep),
   * `dt × SLEEP_EVERY` on its sleeping turn. Only calm monsters (idle / wandering, no target) may sleep:
   * anything fighting, leashing home or in another AI state always runs at full rate.
   */
  monsterStep(m, dt) {
    if ((m.ai !== 'idle' && m.ai !== 'wander') || m.target || this.isAwakeAt(m.x, m.z)) {
      this.stats.awake++;
      return dt;
    }
    this.stats.asleep++;
    return (this.game.tickCount + m.id) % SLEEP_EVERY === 0 ? dt * SLEEP_EVERY : 0;
  }

  /** Called once at the start of the AI phase. */
  beginTick() {
    this.ensure();
    this.refreshWake();
  }
}

function filterRadius(arr, x, z, r) {
  const r2 = r * r;
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    const dx = e.x - x, dz = e.z - z;
    if (dx * dx + dz * dz <= r2) arr[n++] = e;
  }
  arr.length = n;
  return arr;
}

/** The game's Aoi (created on first use, so Game itself needs no change). */
export const aoiOf = (game) => game.aoi || (game.aoi = new Aoi(game));
