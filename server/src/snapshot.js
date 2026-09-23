// Per-client snapshots with area of interest and the static-field delta rule (SPEC §4.3).
// Each entity is serialised at most twice per snapshot round (dynamic-only / full) and the JSON
// fragments are shared between all clients.
import { VIEW_RADIUS } from '../../shared/protocol.js';
import { AOI_EXIT_MARGIN } from './config.js';

const R_IN2 = VIEW_RADIUS * VIEW_RADIUS;
const R_OUT2 = (VIEW_RADIUS + AOI_EXIT_MARGIN) * (VIEW_RADIUS + AOI_EXIT_MARGIN);

export function sendSnapshots(game, now) {
  if (game.players.size === 0) return;
  const head = `{"t":"snap","tick":${game.tickCount},"tod":${game.tod()},"on":${game.players.size},"ents":[`;
  const dynJson = new Map();
  const fullJson = new Map();
  const dyn = (e) => {
    let s = dynJson.get(e.id);
    if (s === undefined) dynJson.set(e.id, (s = JSON.stringify(e.entState(now))));
    return s;
  };
  const full = (e) => {
    let s = fullJson.get(e.id);
    if (s === undefined) fullJson.set(e.id, (s = JSON.stringify({ ...e.entState(now), ...e.staticState() })));
    return s;
  };
  const stamp = game.tickCount;
  const entities = [...game.entities.values()];

  for (const p of game.players.values()) {
    const parts = [];
    const known = p.known;
    for (const e of entities) {
      const k = known.get(e.id);
      if (e.ownerId && e.ownerId !== p.id) continue; // [combat-souls] death echoes: owner only
      if (e !== p) {
        const dx = e.x - p.x, dz = e.z - p.z;
        if (dx * dx + dz * dz > (k ? R_OUT2 : R_IN2)) continue;
      }
      if (!k) {
        known.set(e.id, { ver: e.staticVer, stamp });
        parts.push(full(e));
      } else if (k.ver !== e.staticVer) {
        k.ver = e.staticVer;
        k.stamp = stamp;
        parts.push(full(e));
      } else {
        k.stamp = stamp;
        parts.push(dyn(e));
      }
    }
    const gone = [];
    for (const [id, k] of known) {
      if (k.stamp !== stamp) {
        gone.push(id);
        known.delete(id);
      }
    }
    game.sendRaw(p, `${head}${parts.join(',')}],"gone":[${gone.join(',')}]}`);
  }
}
