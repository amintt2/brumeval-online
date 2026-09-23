// [combat-souls] Monster locomotion helpers (collision-aware, never enter the village).
import { VILLAGE } from '../../../../shared/world.js';
import { PLAYER_RADIUS } from '../../../../shared/protocol.js';
import { dist2 } from '../../util.js';
import { aoiOf } from '../../aoi.js';

export const MOVE_FLAG_MS = 150;    // `s` = MOVE for this long after a step

/** True if a circle of radius r at (x, z) overlaps the village. */
export const touchesVillage = (x, z, r) => dist2(x, z, VILLAGE.x, VILLAGE.z) <= (VILLAGE.r + r) * (VILLAGE.r + r);

/**
 * Move `m` towards (tx, tz) by at most speed*dt (and ≤ 1 m, or more for charges), stopping `stop` metres short.
 * Uses CollisionWorld.move and never enters the village. Returns the distance moved.
 * `face` = turn towards the destination (false for charges / backing off while facing the target).
 */
export function stepToward(game, m, tx, tz, speed, dt, stop, now, face = true) {
  const dx = tx - m.x, dz = tz - m.z;
  const d = Math.hypot(dx, dz);
  if (face && d > 1e-6) m.ry = Math.atan2(dx, dz);
  if (d <= stop + 1e-3) return 0;
  const step = Math.min(speed * dt, d - stop, Math.max(1, speed * dt));
  const nx = m.x + (dx / d) * step, nz = m.z + (dz / d) * step;
  if (touchesVillage(nx, nz, m.radius)) return 0;
  const r = game.collision.move(m.x, m.z, nx, nz, m.radius);
  if (touchesVillage(r.x, r.z, m.radius)) return 0;
  bodyStop(game, m, r);
  const moved = Math.hypot(r.x - m.x, r.z - m.z);
  if (moved > 1e-4) {
    m.x = r.x;
    m.z = r.z;
    m.moveUntil = now + MOVE_FLAG_MS;
  }
  return moved;
}

const nearBuf = [];

/**
 * Bodies do not overlap: clip the move (m.x, m.z) -> r so that `m` stops at contact distance
 * (m.radius + PLAYER_RADIUS) of every living player. Moving away / sideways out of contact stays free.
 */
function bodyStop(game, m, r) {
  const contact = (m.radius || 0.5) + PLAYER_RADIUS;
  const mx = r.x - m.x, mz = r.z - m.z;
  const len2 = mx * mx + mz * mz;
  if (len2 < 1e-10 || !game.players?.size) return;
  let t = 1;
  for (const p of aoiOf(game).playersNear(r.x, r.z, contact + 0.05, nearBuf, false)) {
    if (p.dead) continue;
    const ox = m.x - p.x, oz = m.z - p.z;
    // only moves that bring the bodies closer are clipped
    if (ox * mx + oz * mz >= 0) continue;
    const c0 = ox * ox + oz * oz - contact * contact;
    if (c0 <= 0) { t = 0; break; } // already touching: no closer
    // smallest s in [0, 1] with |o + s·move| = contact
    const b = ox * mx + oz * mz;
    const disc = b * b - len2 * c0;
    if (disc < 0) continue;
    const s = (-b - Math.sqrt(disc)) / len2;
    if (s >= 0 && s < t) t = s;
  }
  if (t < 1) {
    r.x = m.x + mx * t;
    r.z = m.z + mz * t;
  }
}

/** Move `m` by the direction (dx, dz) (unit) for speed*dt metres. Returns the distance moved. */
export function stepDir(game, m, dx, dz, speed, dt, now) {
  const step = speed * dt;
  return stepToward(game, m, m.x + dx * step, m.z + dz * step, speed, dt, 0, now, false);
}
