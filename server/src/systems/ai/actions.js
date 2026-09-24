// [combat-souls] Monster attacks: light melee swings (wind-up then hit check), telegraphed area attacks (charge,
// leap, slam, stomp, rock throws…), dodgeable projectiles, pack howls and heals. Everything is resolved at
// impact time against the positions of the targets then.
import { computeDamage } from '../../../../shared/data.js';
import { S2C, FX, PLAYER_RADIUS } from '../../../../shared/protocol.js';
import { inVillage } from '../../../../shared/world.js';
import { dist, round2 } from '../../util.js';
import { damagePlayer } from '../players.js';
import { telegraphs, hostilesOf } from '../telegraph.js';
import { stepToward } from './movement.js';
import { provoke } from './index.js';
// [skilltree] statuses (Froid slows the wind-ups, Aveuglé / Nuage toxique weaken the hits), ice walls
import { windupMult, dealtMult } from '../status.js';
import { wallBlocks } from '../zones.js';

const MELEE_ARC = (80 * Math.PI) / 180;     // half-angle in front of the monster where a light swing lands
const MELEE_SLACK = 0.6;                    // extra reach at impact (server position lag)
const DASH_SPEED = 26;                      // charge (line + dash) m/s
const LEAP_SPEED = 20;                      // leap (circle + leap) m/s
const DASH_EARLY_MS = 25;                   // leave half a tick early (the AI ticks at 20 Hz)

export const angleTo = (m, x, z) => Math.atan2(x - m.x, z - m.z);
function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Wind-up time of an attack for this monster (enraged bosses are faster). */
// Light swings get a personal random delay (-10 % … +35 %): delayed attacks punish panic rolls.
export const windupOf = (m, atk) => {
  const jitter = atk.kind === 'melee' && m.rng ? 0.9 + m.rng() * 0.45 : 1;
  return Math.round((atk.windup || 400) * (m.enraged ? 0.85 : 1) * jitter);
};

function hitPlayer(game, m, p, atk) {
  const now = game.now();
  const { amount, crit } = computeDamage(m.atk * dealtMult(m, now), atk.power || 1, p.stats.def, m.crit, game.rng(), game.rng());
  // [skilltree] what the defender needs to know: telegraphed (stagger, guard cost ×1.5), rasant / imblocable / spell
  const info = { kind: atk.kind, tele: atk.kind === 'tele', lo: !!atk.lo, nb: !!atk.nb, mag: !!atk.mag, boss: !!m.boss };
  damagePlayer(game, p, m, amount, crit, atk.id, info);
}

/** Velocity estimate of a player from its last accepted moves (m/s). */
function velocityOf(p) {
  const h = p.mv?.history;
  if (!h || h.length < 2) return { vx: 0, vz: 0 };
  const a = h[h.length - 2], b = h[h.length - 1];
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0.01 || dt > 0.5) return { vx: 0, vz: 0 };
  return { vx: (b.x - a.x) / dt, vz: (b.z - a.z) / dt };
}

/** Telegraph geometry of `atk` launched by `m` at `target`, with an optional angular offset. */
export function teleShape(m, atk, target, offset = 0) {
  const a = angleTo(m, target.x, target.z) + offset;
  switch (atk.at) {
    case 'target':
      return { shape: atk.shape, x: target.x, z: target.z, r: atk.r, r2: atk.r2, a, arc: atk.arc, w: atk.wid, len: atk.len };
    case 'front':
      return { shape: atk.shape, x: m.x, z: m.z, r: atk.r, r2: atk.r2, a, arc: atk.arc, w: atk.wid, len: atk.len };
    default: // 'self'
      return { shape: atk.shape, x: m.x, z: m.z, r: atk.r, r2: atk.r2, a, arc: atk.arc, w: atk.wid, len: atk.len };
  }
}

/**
 * Start `atk` on `target`. Sets m.act to the wind-up of the attack. The resolution happens in `tickAttack`
 * (melee / projectile / howl / heal) or in the telegraph system (tele).
 */
export function startAttack(game, m, atk, target, now) {
  const wind = Math.round(windupOf(m, atk) * windupMult(m, now)); // [skilltree] Froid: slower attacks
  const cdMult = m.enraged ? 0.7 : 1;
  m.cds[atk.id] = now + (atk.cd || 1.5) * 1000 * cdMult;
  if (atk.once) m.used[atk.id] = true;
  m.lastCombat = now;
  m.ry = angleTo(m, target.x, target.z);
  const act = { kind: 'attack', atk, tg: target.id, phase: 'windup', t0: now, impactAt: now + wind, until: now + wind + (atk.rec || 300) };
  m.act = act;
  switch (atk.kind) {
    case 'melee':
      game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.SWING, src: m.id, tg: target.id, ab: atk.id, ms: wind });
      break;
    case 'proj':
    case 'heal':
      game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.CAST, src: m.id, ab: atk.id, ms: wind });
      break;
    case 'howl':
      game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.HOWL, src: m.id, r: atk.r || 20, ms: wind });
      break;
    case 'tele': {
      const n = Math.max(1, atk.count || 1);
      const others = n > 1 ? otherTargets(game, m, target) : [];
      act.teleIds = [];
      for (let i = 0; i < n; i++) {
        // extra copies aim at other players in the fight, or fan out around the main target
        const tg = others[i - 1] || target;
        const off = tg === target && i > 0 ? (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.32 : 0;
        const shape = teleShape(m, atk, tg, off);
        if (i === 0) act.shape = shape;
        const id = telegraphs(game).start(m, shape, wind, {
          ab: atk.id,
          clip: i === 0 ? atk.clip : undefined,
          lo: atk.lo, nb: atk.nb, mag: atk.mag, // [skilltree]
          onHit: (p) => hitPlayer(game, m, p, atk),
        });
        act.teleIds.push(id);
        m.teleIds.push(id);
      }
      // charges and leaps travel DURING the end of the wind-up so the body arrives with the hit (no ghost hit
      // from 5 m away, the monster flying in afterwards)
      act.dash = dashPlan(m, atk, act.shape, wind);
      if (act.dash) act.departAt = act.impactAt - act.dash.ms - DASH_EARLY_MS;
      break;
    }
    default:
      break;
  }
  return act;
}

/**
 * Destination and speed of a charge / leap so that it ends at the impact: a charge runs to the end of its line,
 * a leap lands just short of the aimed point (bodies touching, not on top of the player). Faster than the base
 * speed when the wind-up is too short for the distance.
 */
export function dashPlan(m, atk, s, windMs) {
  if (!s) return null;
  let x, z, speed;
  if (atk.dash && s.shape === 'line') {
    const len = Math.max(0, (s.len || 0) - m.radius);
    x = s.x + Math.sin(s.a) * len;
    z = s.z + Math.cos(s.a) * len;
    speed = DASH_SPEED;
  } else if (atk.leap && s.shape === 'circle') {
    const d = dist(m.x, m.z, s.x, s.z);
    const land = Math.max(0, d - ((m.radius || 0.5) + PLAYER_RADIUS));
    x = d > 1e-6 ? m.x + ((s.x - m.x) / d) * land : m.x;
    z = d > 1e-6 ? m.z + ((s.z - m.z) / d) * land : m.z;
    speed = LEAP_SPEED;
  } else return null;
  const d = dist(m.x, m.z, x, z);
  if (d < 0.05) return null;
  const maxMs = Math.max(50, windMs * 0.8);
  if ((d / speed) * 1000 > maxMs) speed = d / (maxMs / 1000);
  return { x, z, speed, ms: Math.round((d / speed) * 1000) };
}

function otherTargets(game, m, main) {
  const out = [];
  for (const id of m.threat.keys()) {
    const p = game.players.get(id);
    if (p && p !== main && !p.dead && !inVillage(p.x, p.z) && dist(m.x, m.z, p.x, p.z) < 25) out.push(p);
  }
  return out;
}

/** Cancel the pending telegraphs of `m` (death, stagger, leash, phase change). */
export function cancelTelegraphs(game, m) {
  if (!m.teleIds?.length) return;
  for (const id of m.teleIds) telegraphs(game).cancel(id);
  m.teleIds = [];
}

/** Per tick while an attack is in progress. Returns false once it is over. */
export function tickAttack(game, m, target, dt, now) {
  const act = m.act;
  const atk = act.atk;
  // a charge / leap takes off before the impact (dashPlan) and may finish during the recovery
  if (act.dash && !act.departed && now >= act.departAt) {
    act.departed = true;
    m.dash = { x: act.dash.x, z: act.dash.z, speed: act.dash.speed };
  }
  if (m.dash) {
    const d = m.dash;
    const moved = stepToward(game, m, d.x, d.z, d.speed, dt, 0, now, false);
    if (moved < 1e-3 || dist(m.x, m.z, d.x, d.z) < 0.15) m.dash = null;
  }
  if (act.phase === 'windup') {
    // light swings and projectiles track the target; telegraphed attacks are committed
    if (target && atk.kind !== 'tele') m.ry = angleTo(m, target.x, target.z);
    // light swings keep closing in on a retreating target (no free kiting by walking backwards)
    if (target && atk.kind === 'melee' && dist(m.x, m.z, target.x, target.z) > (atk.max || 2) * 0.8) {
      stepToward(game, m, target.x, target.z, m.speed * (m.brain.run || 1), dt, (atk.max || 2) * 0.7, now); // [skilltree] slows: status.moveMult
    }
    if (now < act.impactAt) return true;
    act.phase = 'recover';
    resolveAttack(game, m, act, target, now);
    if (atk.next) {
      const next = m.brain.attacks.find((a) => a.id === atk.next);
      if (next && target && !target.dead) {
        startAttack(game, m, next, target, now);
        return true;
      }
    }
    return true;
  }
  // recovery (punish window)
  return now < act.until;
}

function resolveAttack(game, m, act, target, now) {
  const atk = act.atk;
  m.lastCombat = now;
  switch (atk.kind) {
    case 'melee': {
      if (!target || target.dead || inVillage(target.x, target.z)) return;
      const d = dist(m.x, m.z, target.x, target.z);
      const front = Math.abs(angDiff(m.ry, angleTo(m, target.x, target.z))) <= MELEE_ARC;
      if (d <= (atk.max || m.def.range) + MELEE_SLACK && front) hitPlayer(game, m, target, atk);
      return;
    }
    case 'tele': {
      m.teleIds = m.teleIds.filter((id) => !act.teleIds?.includes(id));
      // a charge / leap that could not take off yet (very short wind-up) leaves now
      if (act.dash && !act.departed) {
        act.departed = true;
        m.dash = { x: act.dash.x, z: act.dash.z, speed: act.dash.speed };
      }
      return;
    }
    case 'proj':
      launchProjectile(game, m, atk, target, now);
      return;
    case 'howl':
      howl(game, m, atk, target, now);
      return;
    case 'heal':
      healAllies(game, m, atk);
      return;
    default:
  }
}

/** Dodgeable projectile: flies to a ground point, hits whoever stands there at arrival. */
function launchProjectile(game, m, atk, target, now) {
  if (!target || target.dead) return;
  const d0 = dist(m.x, m.z, target.x, target.z);
  const speed = atk.speed || 16;
  const flight = d0 / speed;
  const lead = (atk.lead || 0) * (m.temper?.aim ?? 0.5) * 2;
  const v = velocityOf(target);
  let x = target.x + v.vx * flight * lead, z = target.z + v.vz * flight * lead;
  const max = (atk.max || 16) + 2;
  const d = dist(m.x, m.z, x, z);
  if (d > max) { x = m.x + ((x - m.x) / d) * max; z = m.z + ((z - m.z) / d) * max; }
  const ms = Math.max(60, Math.round((dist(m.x, m.z, x, z) / speed) * 1000));
  m.ry = angleTo(m, x, z);
  game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.PROJ, src: m.id, x: round2(x), z: round2(z), ab: atk.id, ms });
  const hitR = (atk.hitR || 0.9) + PLAYER_RADIUS;
  game.schedule(ms, () => {
    if (m.dead || game.entities.get(m.id) !== m) return;
    for (const p of hostilesOf(game, m)) {
      if (dist(p.x, p.z, x, z) > hitR) continue;
      if (wallBlocks(game, m.x, m.z, p.x, p.z)) continue; // [skilltree] Mur de glace
      hitPlayer(game, m, p, atk);
    }
  });
}

/** Pack call: allies of the same kind nearby join the fight against the same target. */
function howl(game, m, atk, target, now) {
  const r = atk.r || 20;
  let n = 0;
  for (const o of game.monsters.values()) {
    if (o === m || o.dead || o.type !== m.type) continue;
    if (o.ai === 'chase' || o.ai === 'return') continue;
    if (dist(m.x, m.z, o.x, o.z) > r) continue;
    provoke(game, o, target, now, 150 + n * 120);
    // spread around the target
    if (o.temper) o.temper.strafeSide = n % 2 ? -m.temper.strafeSide : m.temper.strafeSide;
    n++;
  }
  return n;
}

/** Caster: heal the most injured ally in range (itself included). */
function healAllies(game, m, atk) {
  let best = null, worst = 0.8;
  for (const o of game.monsters.values()) {
    if (o.dead || o.invulnerable) continue;
    if (dist(m.x, m.z, o.x, o.z) > (atk.r || 14)) continue;
    const ratio = o.hp / o.mhp;
    if (ratio < worst) { worst = ratio; best = o; }
  }
  if (!best) return null;
  const v = Math.round(best.mhp * (atk.heal || 0.2));
  best.hp = Math.min(best.mhp, best.hp + v);
  game.broadcastNear(best.x, best.z, { t: S2C.HEAL, tg: best.id, v, hp: Math.max(1, Math.ceil(best.hp)) });
  game.broadcastNear(best.x, best.z, { t: S2C.FX, k: FX.HEAL, tg: best.id, ab: atk.id });
  return best;
}

/** Does an injured ally (≤ 70 % hp) stand within the heal radius? */
export function hasInjuredAlly(game, m, atk) {
  for (const o of game.monsters.values()) {
    if (o.dead || o.invulnerable) continue;
    if (o.hp / o.mhp <= 0.7 && dist(m.x, m.z, o.x, o.z) <= (atk.r || 14)) return true;
  }
  return false;
}

/** Are there idle allies of the same type to call? */
export function hasAlliesToCall(game, m, atk) {
  const r = atk.r || 20;
  for (const o of game.monsters.values()) {
    if (o === m || o.dead || o.type !== m.type || o.ai === 'chase' || o.ai === 'return') continue;
    if (dist(m.x, m.z, o.x, o.z) <= r) return true;
  }
  return false;
}

