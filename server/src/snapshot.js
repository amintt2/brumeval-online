// Per-client snapshots: area of interest from the spatial grid (aoi.js), static-field delta rule
// (SPEC §4.3) and field-level dynamic deltas (ROADMAP §4.3).
//
// A snapshot only carries the dynamic fields (x z ry hp mhp s tg sl and any field other features add to
// entState) that changed since the previous snapshot round; an entity with no change at all is left out of
// `ents` (it is still known: only `gone` removes it). The client keeps the previous value of every omitted
// field. Positions are quantised to QPOS metres and angles to QANG radians, so idle jitter costs nothing.
//
// Every known entity is processed for every client at every round (or reported `gone`), so a client that
// knows an entity always holds its state of the previous round: the delta "previous round → this round" is
// the same for every such client and is serialised once per entity. Clients that see an entity for the
// first time (or after a static/layout change) get it whole, and each entity is re-sent whole to every
// client every FULL_EVERY rounds (staggered by id) as a safety net for client-side edits.
//
// Congestion: a client whose socket still holds more than SNAP_SKIP_BYTES of unsent data (slow link, or the
// compression pipeline falling behind) is skipped for the round instead of queueing more snapshots. Its
// knowledge is left untouched, so the next round it is served it gets the full state of every entity
// (they are no longer "up to date"): the delta chain is never broken and memory stays bounded.
import { VIEW_RADIUS } from '../../shared/protocol.js';
import { AOI_EXIT_MARGIN } from './config.js';
import { aoiOf } from './aoi.js';

const R_IN2 = VIEW_RADIUS * VIEW_RADIUS;
const R_OUT = VIEW_RADIUS + AOI_EXIT_MARGIN;
const R_OUT2 = R_OUT * R_OUT;
export const QPOS = 0.05;          // metres
export const QANG = 0.02;          // radians (≈ 1.1°)
export const FULL_EVERY = 50;      // snapshot rounds (5 s at 10 Hz)
export const SNAP_SKIP_BYTES = 256 * 1024; // unsent bytes above which a client skips a snapshot round
const IPOS = 1 / QPOS, IANG = 1 / QANG;

const qpos = (v) => Math.round(v * IPOS) / IPOS;
const qang = (v) => Math.round(v * IANG) / IANG;

/** `"key":` prefixes, built once per field name. */
const prefixes = new Map();
const prefix = (k) => {
  let s = prefixes.get(k);
  if (s === undefined) prefixes.set(k, (s = `${JSON.stringify(k)}:`));
  return s;
};
const jsonValue = (v) => (typeof v === 'number' ? String(v) : (JSON.stringify(v) ?? 'null'));

/** Per-entity serialisation cache, refreshed once per round the entity is visible to someone. */
class EntCache {
  constructor(id) {
    this.id = id;
    this.round = -1;
    this.keys = [];        // dynamic field names (without id)
    this.vals = [];        // comparable value of each key (primitive, or its JSON for objects)
    this.shape = 0;        // bumped whenever the key list changes
    this.full = '';        // `{"id":…,<every dynamic field>` (no closing brace)
    this.delta = null;     // `{"id":…,<fields changed since the previous round>}` or null (no change)
    this.staticVer = -1;
    this.staticFrag = '';  // `,"k":…,"n":…` (static fields), for staticVer
  }

  refresh(e, now, round) {
    const consecutive = this.round === round - 1;
    this.round = round;
    const st = e.entState(now);
    const keys = this.keys, vals = this.vals;
    const head = `{"id":${this.id}`;
    let full = head, delta = head, i = 0, same = true, changed = false;
    for (const k in st) {
      if (k === 'id') continue;
      let v = st[k];
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) v = null;
        else if (k === 'x' || k === 'z') v = qpos(v);
        else if (k === 'ry') v = qang(v);
      } else if (v === undefined) {
        continue;
      }
      const frag = prefix(k) + jsonValue(v);
      const cmp = v !== null && typeof v === 'object' ? frag : v;
      if (keys[i] !== k) same = false;
      else if (vals[i] !== cmp) {
        changed = true;
        delta += `,${frag}`;
      }
      keys[i] = k;
      vals[i] = cmp;
      full += `,${frag}`;
      i++;
    }
    if (keys.length !== i) {
      same = false;
      keys.length = i;
      vals.length = i;
    }
    if (!same) this.shape++;
    this.full = full;
    // not refreshed last round or new layout: nobody can be up to date, clients get the full state
    this.delta = !consecutive || !same ? `${full}}` : changed ? `${delta}}` : null;
    if (this.staticVer !== e.staticVer) {
      this.staticVer = e.staticVer;
      const s = e.staticState();
      let out = '';
      for (const k in s) {
        if (k === 'id' || s[k] === undefined) continue;
        out += `,${prefix(k)}${jsonValue(s[k])}`;
      }
      this.staticFrag = out;
    }
  }
}

/** What one client knows about one entity. */
class Known {
  constructor() {
    this.ver = -1;     // static version sent
    this.stamp = 0;    // last round this entity was processed for this client
    this.shape = -1;   // field layout sent
  }
}

/** True when the client's connection is backed up (bytes queued on the socket or in the deflate pipeline). */
function congested(p) {
  const ws = p.session?.ws;
  return !!ws && ws.bufferedAmount > SNAP_SKIP_BYTES;
}

/** Snapshot state attached to the game (created lazily). */
function stateOf(game) {
  let s = game.snapState;
  if (!s) s = game.snapState = { round: 0, cache: new Map(), buf: [], parts: [], gone: [], skipped: 0 };
  return s;
}

export function sendSnapshots(game, now) {
  if (game.players.size === 0) return;
  const S = stateOf(game);
  const round = ++S.round;
  const aoi = aoiOf(game);
  aoi.sync(); // entities added during this tick (respawns, …) must be visible right away
  const head = `{"t":"snap","tick":${game.tickCount},"tod":${game.tod()},"on":${game.players.size},"ents":[`;
  const cache = S.cache, buf = S.buf, parts = S.parts, gone = S.gone;

  for (const p of game.players.values()) {
    if (congested(p)) { // see "Congestion" above: this client catches up with full states later
      S.skipped++;
      continue;
    }
    parts.length = 0;
    gone.length = 0;
    const known = p.known;
    aoi.query(p.x, p.z, R_OUT, buf, 'all');
    for (let bi = 0; bi < buf.length; bi++) {
      const e = buf[bi];
      if (e.ownerId && e.ownerId !== p.id) continue; // [combat-souls] death echoes: owner only
      let k = known.get(e.id);
      if (e !== p) {
        const dx = e.x - p.x, dz = e.z - p.z;
        if (dx * dx + dz * dz > (k ? R_OUT2 : R_IN2)) continue;
        if (typeof e.visibleTo === 'function' && !e.visibleTo(p)) continue; // e.g. owner-only entities
      }
      let c = cache.get(e.id);
      if (c === undefined) cache.set(e.id, (c = new EntCache(e.id)));
      if (c.round !== round) c.refresh(e, now, round);
      if (k === undefined) known.set(e.id, (k = new Known()));
      const upToDate = k.stamp === round - 1;
      k.stamp = round;
      if (k.ver !== c.staticVer || k.shape !== c.shape) {
        // first sight, static change or new field layout: everything
        k.ver = c.staticVer;
        k.shape = c.shape;
        parts.push(`${c.full}${c.staticFrag}}`);
      } else if (!upToDate || (round + e.id) % FULL_EVERY === 0) {
        parts.push(`${c.full}}`);
      } else if (c.delta !== null) {
        parts.push(c.delta);
      }
    }
    for (const [id, k] of known) {
      if (k.stamp !== round) {
        gone.push(id);
        known.delete(id);
      }
    }
    game.sendRaw(p, `${head}${parts.join(',')}],"gone":[${gone.join(',')}]}`);
  }

  // forget the serialisation cache of entities that no longer exist
  if (round % 100 === 0) {
    for (const id of cache.keys()) if (!game.entities.has(id)) cache.delete(id);
  }
}
