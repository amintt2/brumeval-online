// Client game state: self state (merged from auth_ok / self messages), entity store fed by snapshots,
// snapshot interpolation buffers and the server clock estimate.
import { TICK_RATE, INTERP_DELAY_MS, STATE, KIND, DAY_LENGTH_S } from '@shared/protocol.js';

const RING = 16;
const STATIC_FIELDS = ['k', 'n', 'm', 'lv', 'c', 'sc', 'b', 'mt', 'nk'];
STATIC_FIELDS.push('el', 'vr'); // [combat-souls] elite flag, monster variant
STATIC_FIELDS.push('rb'); // [skilltree] Renaissances of a player (aura + title)
const TWO_PI = Math.PI * 2;

/** Shortest signed angle from a to b. */
export function angleDelta(a, b) {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d < -Math.PI) d += TWO_PI;
  return d;
}

export class EntityRecord {
  constructor(id) {
    this.id = id;
    this.k = null; this.n = ''; this.m = null; this.lv = 1; this.c = null; this.sc = 1; this.b = 0;
    this.mt = null; this.nk = null;
    this.hp = 1; this.mhp = 1; this.s = STATE.IDLE; this.tg = 0; this.sl = 0;
    this.ac = 0; this.stt = 0; this.rb = 0; // [skilltree]
    // interpolation ring buffer
    this.st = new Float64Array(RING); this.sx = new Float32Array(RING); this.sz = new Float32Array(RING);
    this.sry = new Float32Array(RING);
    this.head = 0; this.count = 0;
    // rendered state
    this.x = 0; this.z = 0; this.ry = 0; this.speed = 0;
    this.lastX = 0; this.lastZ = 0;
    this.isSelf = false;
    this.view = null;
    this.dirtyModel = true;   // model must be (re)built
    this.dirtyLabel = true;   // nameplate text/colour must be refreshed
    this.deadAt = 0;
    this.seenAt = 0;
    this.snapStamp = 0;       // [netcode-perf] GameState.snapStamp of the last snapshot that carried it
  }
  get dead() { return this.s === STATE.DEAD; }
  get hostile() { return this.k === KIND.MONSTER; }

  pushSample(t, x, z, ry) {
    if (this.count > 0) {
      const last = (this.head + this.count - 1) % RING;
      if (t <= this.st[last]) {
        // same or older tick (duplicate) → overwrite the newest sample
        this.sx[last] = x; this.sz[last] = z; this.sry[last] = ry;
        return;
      }
      // teleport → forget history so we don't slide across the map
      if (Math.abs(x - this.sx[last]) + Math.abs(z - this.sz[last]) > 12) this.count = 0;
    }
    if (this.count === 0) {
      this.head = 0;
      this.x = x; this.z = z; this.ry = ry; this.lastX = x; this.lastZ = z;
    }
    let idx;
    if (this.count < RING) {
      idx = (this.head + this.count) % RING;
      this.count++;
    } else {
      idx = this.head;
      this.head = (this.head + 1) % RING;
    }
    this.st[idx] = t; this.sx[idx] = x; this.sz[idx] = z; this.sry[idx] = ry;
  }

  /**
   * Interpolate at server time `rt`, then (for other players) low-pass the result: their positions reach the
   * server at the client's move rate (15 Hz) but are sampled by 10 Hz snapshots, so consecutive snapshots
   * alternately contain one or two moves — without smoothing the walk would visibly pulse.
   */
  interpolateSmooth(rt, dt) {
    const px = this.x, pz = this.z;
    this.interpolate(rt);
    if (this.k !== KIND.PLAYER || dt <= 0) return;
    const tx = this.x, tz = this.z;
    if (Math.abs(tx - px) + Math.abs(tz - pz) > 4) return; // teleport / first sample
    const a = 1 - Math.exp(-dt / 0.13);
    this.x = px + (tx - px) * a;
    this.z = pz + (tz - pz) * a;
  }

  /** Interpolate the buffered samples at server time `rt` into this.x/z/ry. */
  interpolate(rt) {
    const n = this.count;
    if (n === 0) return;
    const h = this.head;
    const first = h, last = (h + n - 1) % RING;
    if (n === 1 || rt <= this.st[first]) {
      const i = n === 1 ? last : first;
      this.x = this.sx[i]; this.z = this.sz[i]; this.ry = this.sry[i];
      return;
    }
    if (rt >= this.st[last]) {
      // small extrapolation (≤ 120 ms) to hide late packets, then hold
      const p = (h + n - 2) % RING;
      const dt = this.st[last] - this.st[p];
      const ex = Math.min(rt - this.st[last], 120);
      if (dt > 0 && ex > 0 && this.s === STATE.MOVE) {
        const k = ex / dt;
        this.x = this.sx[last] + (this.sx[last] - this.sx[p]) * k;
        this.z = this.sz[last] + (this.sz[last] - this.sz[p]) * k;
      } else {
        this.x = this.sx[last]; this.z = this.sz[last];
      }
      this.ry = this.sry[last];
      return;
    }
    for (let j = 0; j < n - 1; j++) {
      const a = (h + j) % RING, b = (h + j + 1) % RING;
      if (rt >= this.st[a] && rt <= this.st[b]) {
        const span = this.st[b] - this.st[a];
        const k = span > 0 ? (rt - this.st[a]) / span : 1;
        this.x = this.sx[a] + (this.sx[b] - this.sx[a]) * k;
        this.z = this.sz[a] + (this.sz[b] - this.sz[a]) * k;
        this.ry = this.sry[a] + angleDelta(this.sry[a], this.sry[b]) * k;
        return;
      }
    }
  }

  /** Latest known server position. */
  latest(out) {
    if (this.count === 0) { out.x = this.x; out.z = this.z; return out; }
    const last = (this.head + this.count - 1) % RING;
    out.x = this.sx[last]; out.z = this.sz[last];
    return out;
  }
}

/** [netcode-perf] Repeat the newest interpolation sample at server time t (entity unchanged). */
function holdSample(rec, t) {
  if (rec.count === 0) return;
  const last = (rec.head + rec.count - 1) % RING;
  if (t > rec.st[last]) rec.pushSample(t, rec.sx[last], rec.sz[last], rec.sry[last]);
}

export class GameState {
  constructor() {
    this.selfId = 0;
    this.self = null;
    this.entities = new Map();
    this.tod = 0.35;
    this.todFrozen = null;
    this.online = 0;
    this.inGame = false;
    this.clockOffset = null;
    this.lastSnapAt = 0;
    this.lastTick = -1;
    this.snapStamp = 0;          // [netcode-perf] snapshots applied (marks the entities each one carried)
    this.dialog = null;          // currently open NPC dialog payload
    this.cooldowns = new Array(8).fill(0); // performance.now() when each action bar slot is ready again ([skilltree] 8)
    this.listeners = { add: [], remove: [], self: [] };
  }

  on(ev, fn) { this.listeners[ev].push(fn); }
  emit(ev, a, b) { for (const fn of this.listeners[ev]) fn(a, b); }

  reset() {
    for (const rec of this.entities.values()) this.emit('remove', rec);
    this.entities.clear();
    this.selfId = 0;
    this.self = null;
    this.inGame = false;
    this.clockOffset = null;
    this.lastTick = -1;
    this.dialog = null;
    this.cooldowns.fill(0);
  }

  setSelf(id, self) {
    this.selfId = id;
    this.self = { ...self };
    this.emit('self', this.self, null);
  }

  /** Merge a partial SelfState (arrays/objects are replaced whole). */
  mergeSelf(partial) {
    if (!this.self) return;
    const changed = {};
    for (const k of Object.keys(partial)) {
      if (k === 't') continue;
      this.self[k] = partial[k];
      changed[k] = true;
    }
    this.emit('self', this.self, changed);
  }

  /** Server time (ms) at which remote entities should be rendered now. */
  renderTime(now) {
    if (this.clockOffset === null) return 0;
    return now - this.clockOffset - INTERP_DELAY_MS;
  }

  applySnap(snap, now) {
    if (typeof snap.tick === 'number') {
      const st = snap.tick * (1000 / TICK_RATE);
      const o = now - st;
      if (this.clockOffset === null || o < this.clockOffset || snap.tick < this.lastTick) this.clockOffset = o;
      else this.clockOffset += (o - this.clockOffset) * 0.03;
      this.lastTick = snap.tick;
    }
    if (typeof snap.tod === 'number') this.tod = snap.tod;
    if (typeof snap.on === 'number') this.online = snap.on;
    this.lastSnapAt = now;
    const t = (snap.tick ?? 0) * (1000 / TICK_RATE);

    if (Array.isArray(snap.ents)) {
      for (const e of snap.ents) {
        if (!e || typeof e.id !== 'number') continue;
        let rec = this.entities.get(e.id);
        const isNew = !rec;
        if (isNew) {
          rec = new EntityRecord(e.id);
          rec.isSelf = e.id === this.selfId;
          rec.seenAt = now;
          this.entities.set(e.id, rec);
        }
        for (const f of STATIC_FIELDS) {
          if (e[f] !== undefined && e[f] !== rec[f]) {
            if (f === 'm' || f === 'c' || f === 'k' || f === 'sc') rec.dirtyModel = true;
            rec[f] = e[f];
            rec.dirtyLabel = true;
          }
        }
        if (typeof e.hp === 'number') { if (e.hp !== rec.hp) rec.dirtyLabel = true; rec.hp = e.hp; }
        if (typeof e.mhp === 'number') { if (e.mhp !== rec.mhp) rec.dirtyLabel = true; rec.mhp = e.mhp; }
        if (typeof e.s === 'number') {
          if (e.s === STATE.DEAD && rec.s !== STATE.DEAD) rec.deadAt = now;
          rec.s = e.s;
        }
        // [netcode-perf] field-level deltas (ROADMAP §4.3): an omitted field keeps its previous value
        if (e.tg !== undefined) rec.tg = e.tg || 0;
        if (e.sl !== undefined) rec.sl = e.sl || 0;
        // [skilltree] players: action flags (guard, airborne, charging, casting, staggered); monsters: status flags
        if (e.ac !== undefined) rec.ac = e.ac || 0;
        if (e.stt !== undefined) { if ((e.stt || 0) !== rec.stt) rec.dirtyLabel = true; rec.stt = e.stt || 0; }
        rec.snapStamp = this.snapStamp + 1;
        const hasX = typeof e.x === 'number', hasZ = typeof e.z === 'number', hasRy = typeof e.ry === 'number';
        if (hasX || hasZ || hasRy) {
          if (rec.count > 0) {
            const last = (rec.head + rec.count - 1) % RING;
            rec.pushSample(t, hasX ? e.x : rec.sx[last], hasZ ? e.z : rec.sz[last], hasRy ? e.ry : rec.sry[last]);
          } else if (hasX && hasZ) {
            rec.pushSample(t, e.x, e.z, hasRy ? e.ry : rec.ry);
          }
        } else {
          holdSample(rec, t);
        }
        if (isNew) this.emit('add', rec);
      }
    }
    // [netcode-perf] entities left out of this snapshot did not change: extend their timeline at the same
    // place so that interpolation does not stretch their next move over the whole idle period
    this.snapStamp++;
    for (const rec of this.entities.values()) {
      if (rec.snapStamp !== this.snapStamp && !rec.isSelf) holdSample(rec, t);
    }
    if (Array.isArray(snap.gone)) {
      for (const id of snap.gone) {
        const rec = this.entities.get(id);
        if (!rec || rec.isSelf) continue;
        this.entities.delete(id);
        this.emit('remove', rec);
      }
    }
  }

  /** Advance the local time-of-day estimate between snapshots. */
  tickTod(dt) {
    if (this.todFrozen !== null) { this.tod = this.todFrozen; return; }
    this.tod = (this.tod + dt / DAY_LENGTH_S) % 1;
  }
}
