// Per-client snapshots: area of interest from the spatial grid (aoi.js), static-field delta rule
// (SPEC §4.3) and field-level dynamic deltas (ROADMAP §4.3).
//
// For every client and every entity it knows, the server remembers the last value sent for each dynamic
// field (x z ry hp mhp s tg sl and any field other features add to entState). A snapshot only carries the
// fields that changed since; an entity with no change at all is left out of `ents` (it is still known: only
// `gone` removes it). The client keeps the previous value of every omitted field.
// Positions are quantised to QPOS metres and angles to QANG radians, so idle jitter never costs bytes.
// Every entity is re-sent whole to each client every FULL_EVERY rounds (staggered by id) as a safety net.
//
// Each entity's fields are serialised once per round (shared by all clients); only the concatenation of the
// changed fragments is per client.
import { VIEW_RADIUS } from '../../shared/protocol.js';
import { AOI_EXIT_MARGIN } from './config.js';
import { aoiOf } from './aoi.js';

const R_IN2 = VIEW_RADIUS * VIEW_RADIUS;
const R_OUT = VIEW_RADIUS + AOI_EXIT_MARGIN;
const R_OUT2 = R_OUT * R_OUT;
export const QPOS = 0.05;          // metres
export const QANG = 0.02;          // radians (≈ 1.1°)
export const FULL_EVERY = 50;      // snapshot rounds (5 s at 10 Hz)
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
const jsonValue = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'null') : (JSON.stringify(v) ?? 'null'));

/** Per-entity serialisation cache, refreshed once per round the entity is visible to someone. */
class EntCache {
  constructor(id) {
    this.id = id;
    this.round = -1;
    this.keys = [];        // dynamic field names (without id)
    this.frags = [];       // `"key":value` for each key, aligned with keys
    this.shape = 0;        // bumped whenever the key list changes
    this.staticVer = -1;
    this.staticFrag = '';  // `"k":…,"n":…` (static fields), for staticVer
    this.idFrag = `{"id":${id}`;
  }

  refresh(e, now, round) {
    this.round = round;
    const st = e.entState(now);
    const keys = this.keys, frags = this.frags;
    let i = 0, same = true;
    for (const k in st) {
      if (k === 'id') continue;
      let v = st[k];
      if (typeof v === 'number') {
        if (k === 'x' || k === 'z') v = qpos(v);
        else if (k === 'ry') v = qang(v);
      }
      if (same && keys[i] !== k) same = false;
      keys[i] = k;
      frags[i] = prefix(k) + jsonValue(v);
      i++;
    }
    if (keys.length !== i) {
      same = false;
      keys.length = i;
      frags.length = i;
    }
    if (!same) this.shape++;
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
    this.ver = -1;
    this.stamp = 0;
    this.shape = -1;
    this.last = [];        // last fragment sent for each key of the entity's cache (aligned)
  }
}

/** Snapshot state attached to the game (created lazily). */
function stateOf(game) {
  let s = game.snapState;
  if (!s) {
    s = game.snapState = { round: 0, cache: new Map(), buf: [], parts: [], gone: [] };
  }
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
    parts.length = 0;
    gone.length = 0;
    const known = p.known;
    aoi.query(p.x, p.z, R_OUT, buf, 'all');
    for (let bi = 0; bi < buf.length; bi++) {
      const e = buf[bi];
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
      k.stamp = round;
      const keys = c.keys, frags = c.frags, last = k.last;
      if (k.ver !== c.staticVer || k.shape !== c.shape) {
        // first sight, static change or new field layout: everything
        k.ver = c.staticVer;
        k.shape = c.shape;
        last.length = keys.length;
        let s = c.idFrag;
        for (let i = 0; i < keys.length; i++) {
          last[i] = frags[i];
          s += `,${frags[i]}`;
        }
        parts.push(`${s}${c.staticFrag}}`);
        continue;
      }
      const all = (round + e.id) % FULL_EVERY === 0;
      let s = null;
      for (let i = 0; i < keys.length; i++) {
        const f = frags[i];
        if (!all && last[i] === f) continue;
        last[i] = f;
        s = s === null ? `${c.idFrag},${f}` : `${s},${f}`;
      }
      if (s !== null) parts.push(`${s}}`);
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
