// Monster AI: idle / wander inside the spawn zone -> aggro -> chase & attack -> leash back home.
import { REGEN, computeDamage } from '../../../shared/data.js';
import { S2C, FX } from '../../../shared/protocol.js';
import { VILLAGE, inVillage } from '../../../shared/world.js';
import { LEASH_EXTRA } from '../config.js';
import { dist, dist2, randRange, round2 } from '../util.js';
import { damagePlayer } from './players.js';
import { aoiOf } from '../aoi.js'; // [netcode-perf]

const WANDER_SPEED = 0.35;   // fraction of speed while wandering
const RETURN_SPEED = 1.5;    // fraction of speed while leashing back
const MOVE_FLAG_MS = 150;    // `s` = MOVE for this long after a step

export function updateMonsters(game, tickDt, now) {
  const aoi = aoiOf(game); // [netcode-perf] spatial grid + monsters far from every player sleep (low tick rate)
  aoi.beginTick();
  for (const m of game.monsters.values()) {
    if (m.dead) continue;
    const dt = aoi.monsterStep(m, tickDt); // [netcode-perf]
    if (dt === 0) continue; // [netcode-perf] asleep this tick
    switch (m.ai) {
      case 'idle': idle(game, m, dt, now); break;
      case 'wander': wander(game, m, dt, now); break;
      case 'chase': chase(game, m, dt, now); break;
      case 'return': returnHome(game, m, dt, now); break;
      default: m.ai = 'idle'; break;
    }
  }
}

/** True if a circle of radius r at (x, z) overlaps the village. */
const touchesVillage = (x, z, r) => dist2(x, z, VILLAGE.x, VILLAGE.z) <= (VILLAGE.r + r) * (VILLAGE.r + r);

/**
 * Move `m` towards (tx, tz) by at most speed*dt (and ≤ 1 m), stopping `stop` metres short.
 * Uses CollisionWorld.move and never enters the village. Returns the distance moved.
 */
export function stepToward(game, m, tx, tz, speed, dt, stop, now) {
  const dx = tx - m.x, dz = tz - m.z;
  const d = Math.hypot(dx, dz);
  if (d > 1e-6) m.ry = Math.atan2(dx, dz);
  if (d <= stop + 1e-3) return 0;
  const step = Math.min(speed * dt, d - stop, 1);
  const nx = m.x + (dx / d) * step, nz = m.z + (dz / d) * step;
  if (touchesVillage(nx, nz, m.radius)) return 0;
  const r = game.collision.move(m.x, m.z, nx, nz, m.radius);
  if (touchesVillage(r.x, r.z, m.radius)) return 0;
  const moved = Math.hypot(r.x - m.x, r.z - m.z);
  if (moved > 1e-4) {
    m.x = r.x;
    m.z = r.z;
    m.moveUntil = now + MOVE_FLAG_MS;
  }
  return moved;
}

const validVictim = (p) => p && !p.dead && !inVillage(p.x, p.z);

/** Highest-threat valid damager, else the current target if still valid. */
export function pickTarget(game, m) {
  let best = null, bestDmg = -1;
  for (const [id, dmg] of m.threat) {
    const p = game.players.get(id);
    if (!p || p.dead) { m.threat.delete(id); continue; }
    if (!validVictim(p)) continue;
    if (dmg > bestDmg) { best = p; bestDmg = dmg; }
  }
  if (best) return best;
  const cur = m.target ? game.players.get(m.target) : null;
  return validVictim(cur) ? cur : null;
}

function startChase(game, m, p, now) {
  m.ai = 'chase';
  m.target = p.id;
  m.atkReady = Math.max(m.atkReady, now + 500);
  if (m.def.slam) m.slamReady = now + m.def.slam.cd * 1000;
  m.lastCombat = now;
}

export function startReturn(m) {
  m.ai = 'return';
  m.target = 0;
  m.threat.clear();
  m.hp = m.mhp;          // full heal when leashing
  m.slowUntil = 0;
  m.stuck = 0;
}

const aggroBuf = []; // [netcode-perf] reused query buffer

/** Aggressive monsters attack the nearest valid player within `aggro` metres. */
function tryAggro(game, m, now) {
  const r = m.def.aggro;
  if (!(r > 0)) return false;
  let best = null, bestD = r * r;
  for (const p of aoiOf(game).playersNear(m.x, m.z, r, aggroBuf, false)) { // [netcode-perf] grid query
    if (!validVictim(p)) continue;
    const d = dist2(m.x, m.z, p.x, p.z);
    if (d <= bestD) { best = p; bestD = d; }
  }
  if (!best) return false;
  startChase(game, m, best, now);
  return true;
}

function regenMonster(m, dt, now) {
  if (m.hp < m.mhp && now - m.lastCombat > REGEN.restDelay * 1000) m.hp = Math.min(m.mhp, m.hp + m.mhp * REGEN.hpRest * dt);
}

function idle(game, m, dt, now) {
  regenMonster(m, dt, now);
  if (tryAggro(game, m, now)) return;
  if (now >= m.aiUntil) {
    const pt = game.randomPointInZone(m.zone, m.radius);
    m.wanderX = pt.x;
    m.wanderZ = pt.z;
    m.ai = 'wander';
    m.stuck = 0;
  }
}

function wander(game, m, dt, now) {
  regenMonster(m, dt, now);
  if (tryAggro(game, m, now)) return;
  const moved = stepToward(game, m, m.wanderX, m.wanderZ, m.speed * WANDER_SPEED, dt, 0, now);
  const arrived = dist(m.x, m.z, m.wanderX, m.wanderZ) < 0.3;
  m.stuck = moved < 1e-3 ? m.stuck + dt : 0;
  if (arrived || m.stuck > 1) {
    m.ai = 'idle';
    m.aiUntil = now + randRange(game.rng, 2000, 8000);
  }
}

function chase(game, m, dt, now) {
  const z = m.zone;
  const leash = z.r + LEASH_EXTRA;
  if (dist2(m.x, m.z, z.x, z.z) > leash * leash) return startReturn(m);
  const target = pickTarget(game, m);
  if (!target) return startReturn(m);
  m.target = target.id;

  const range = m.def.range;
  const speed = m.speed * (m.isSlowed(now) ? 0.5 : 1);
  if (dist(m.x, m.z, target.x, target.z) > range * 0.85) stepToward(game, m, target.x, target.z, speed, dt, range * 0.75, now);
  else m.ry = Math.atan2(target.x - m.x, target.z - m.z);

  if (now >= m.atkReady && dist(m.x, m.z, target.x, target.z) <= range) {
    m.atkReady = now + m.def.atkCd * 1000;
    m.lastCombat = now;
    const { amount, crit } = computeDamage(m.atk, 1, target.stats.def, m.crit, game.rng(), game.rng());
    game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.SWING, src: m.id, tg: target.id });
    damagePlayer(game, target, m, amount, crit);
  }

  const slam = m.def.slam;
  if (slam && now >= m.slamReady) {
    m.slamReady = now + slam.cd * 1000;
    m.lastCombat = now;
    game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.AOE, src: m.id, x: round2(m.x), z: round2(m.z), r: slam.radius, ab: 'slam' });
    for (const p of [...game.players.values()]) {
      if (!validVictim(p) || dist(m.x, m.z, p.x, p.z) > slam.radius) continue;
      const { amount, crit } = computeDamage(m.atk, slam.power, p.stats.def, m.crit, game.rng(), game.rng());
      damagePlayer(game, p, m, amount, crit, 'slam');
    }
  }
}

function returnHome(game, m, dt, now) {
  const moved = stepToward(game, m, m.homeX, m.homeZ, m.speed * RETURN_SPEED, dt, 0, now);
  if (dist(m.x, m.z, m.homeX, m.homeZ) < 0.3) {
    m.ai = 'idle';
    m.aiUntil = now + randRange(game.rng, 1500, 4000);
    return;
  }
  m.stuck = moved < 1e-3 ? m.stuck + dt : 0;
  if (m.stuck > 1.5) {
    // blocked by the scenery: snap home
    m.x = m.homeX;
    m.z = m.homeZ;
    m.ai = 'idle';
    m.aiUntil = now + 2000;
  }
}
