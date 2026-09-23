// [combat-souls] Monster AI with variance.
//   idle / wander inside the spawn zone → alert (notices the player: short pause facing it) → combat ('chase')
//   → leash back home ('return').
// In combat a small utility AI picks the next action — attack (weighted random among the attacks in range and
// off cooldown), approach, strafe, back off, pause / feint, flee, howl, heal — scored from the archetype
// (MONSTERS[*].ai) and the individual temperament rolled at spawn (ai/brain.js). Every random choice uses the
// monster's own seeded RNG: deterministic for tests, different from one individual to the next.
import { REGEN } from '../../../../shared/data.js';
import { S2C, FX } from '../../../../shared/protocol.js';
import { POISE } from '../../../../shared/combat.js';
import { inVillage } from '../../../../shared/world.js';
import { LEASH_EXTRA } from '../../config.js';
import { dist, dist2, randRange } from '../../util.js';
import { setupMonster, resetBrainState } from './brain.js';
import { startAttack, tickAttack, cancelTelegraphs, hasInjuredAlly, hasAlliesToCall, angleTo } from './actions.js';
import { checkPhase } from './boss.js';
import { stepToward, stepDir, touchesVillage } from './movement.js';

export { stepToward, touchesVillage };

const WANDER_SPEED = 0.35;   // fraction of speed while wandering
const RETURN_SPEED = 1.5;    // fraction of speed while leashing back
const GIVE_UP_DIST = 45;     // target farther than this: leash back
const GIVE_UP_MS = 12_000;   // no attack given or taken for this long: leash back

// How much each archetype likes to circle around its target / to pause.
const STRAFE_W = { brute: 0.25, rusher: 0.5, skirmisher: 1.6, ranged: 1.1, caster: 0.9, pack: 1.2, boss: 0.15, hopper: 0.5 };
const PAUSE_W = { brute: 0.45, rusher: 0.2, skirmisher: 0.35, ranged: 0.35, caster: 0.4, pack: 0.3, boss: 0.5, hopper: 0.5 };

export function updateMonsters(game, dt, now) {
  for (const m of game.monsters.values()) {
    if (m.dead) continue;
    if (!m.brain) setupMonster(game, m);
    switch (m.ai) {
      case 'idle': idle(game, m, dt, now); break;
      case 'wander': wander(game, m, dt, now); break;
      case 'alert': alert(game, m, dt, now); break;
      case 'chase': combat(game, m, dt, now); break;
      case 'return': returnHome(game, m, dt, now); break;
      default: m.ai = 'idle'; break;
    }
  }
}

const validVictim = (p) => p && !p.dead && !inVillage(p.x, p.z);
const rnd = (m) => (m.rng ? m.rng() : Math.random());

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

/** Enter combat against `p` (after `delayMs` of reaction). */
function startCombat(game, m, p, now, delayMs = 0) {
  m.ai = 'chase';
  m.target = p.id;
  m.act = null;
  m.decideAt = now + delayMs;
  m.atkReady = Math.max(m.atkReady, now + 500);
  m.lastCombat = now;
}

/** Notice a player: short alert phase facing it (FX notice → "!" above the head), then combat. */
function startAlert(game, m, p, now, extraMs = 0) {
  const [a, b] = m.brain.notice || [250, 600];
  m.ai = 'alert';
  m.target = p.id;
  m.alertUntil = now + a + rnd(m) * (b - a) + extraMs;
  m.ry = angleTo(m, p.x, p.z);
  game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.NOTICE, src: m.id });
}

/**
 * Something made `m` hostile towards `p` (damage, pack howl). Idle / alert monsters react after their
 * personal reaction delay; monsters already fighting keep their current action.
 */
export function provoke(game, m, p, now, delayMs = null) {
  if (m.dead || m.ai === 'return' || m.ai === 'chase') return;
  const react = delayMs ?? m.temper?.reactMs ?? 300;
  if (m.ai === 'alert' || delayMs === null) {
    startCombat(game, m, p, now, Math.min(react, 250));
    m.atkReady = Math.max(m.atkReady, now + 400);
  } else {
    startAlert(game, m, p, now, react);
  }
}

export function startReturn(m, game = null) {
  if (game) cancelTelegraphs(game, m);
  m.ai = 'return';
  m.target = 0;
  m.threat.clear();
  m.hp = m.mhp;          // full heal when leashing
  m.slowUntil = 0;
  m.stuck = 0;
  resetBrainState(m);    // boss phases, cooldowns, poise…
}

/** Aggressive monsters notice the nearest valid player within `aggro` metres. */
function tryAggro(game, m, now) {
  const r = m.def.aggro;
  if (!(r > 0)) return false;
  let best = null, bestD = r * r;
  for (const p of game.players.values()) {
    if (!validVictim(p)) continue;
    const d = dist2(m.x, m.z, p.x, p.z);
    if (d <= bestD) { best = p; bestD = d; }
  }
  if (!best) return false;
  startAlert(game, m, best, now);
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

function alert(game, m, dt, now) {
  const p = game.players.get(m.target);
  if (!validVictim(p)) {
    m.ai = 'idle';
    m.target = 0;
    m.aiUntil = now + 1000;
    return;
  }
  m.ry = angleTo(m, p.x, p.z);
  if (now >= m.alertUntil) startCombat(game, m, p, now, 0);
}

function leashRadius(m) {
  return m.brain?.leash ?? m.zone.r + LEASH_EXTRA;
}

/** Movement speed in combat (slows, enrage, running to close a gap). */
function combatSpeed(m, now, running) {
  let s = m.speed;
  if (m.isSlowed(now)) s *= 0.5;
  if (m.enraged) s *= 1.25;
  if (running) s *= m.brain.run || 1;
  return s;
}

function combat(game, m, dt, now) {
  const z = m.zone;
  const leash = leashRadius(m);
  if (dist2(m.x, m.z, z.x, z.z) > leash * leash) return startReturn(m, game);
  const target = pickTarget(game, m);
  if (!target) return startReturn(m, game);
  // give up when the target is out of reach (kited far away, blocked by the scenery) or nothing happened for long
  if (dist2(m.x, m.z, target.x, target.z) > GIVE_UP_DIST * GIVE_UP_DIST || now - m.lastCombat > GIVE_UP_MS) return startReturn(m, game);
  m.target = target.id;
  checkPhase(game, m, now);

  if (m.act) {
    if (runAction(game, m, target, dt, now)) return;
    m.act = null;
    m.decideAt = Math.max(m.decideAt, now + thinkMs(m));
  }
  if (now < m.decideAt) {
    m.ry = angleTo(m, target.x, target.z);
    return;
  }
  decide(game, m, target, now);
  if (m.act) runAction(game, m, target, dt, now);
}

/** Small pause between two actions (never twice the same rhythm). */
function thinkMs(m) {
  const t = m.temper;
  return Math.round((t ? t.reactMs * 0.25 : 80) + rnd(m) * 180);
}

// ------------------------------------------------------------------ actions
function runAction(game, m, target, dt, now) {
  const act = m.act;
  switch (act.kind) {
    case 'attack':
      return tickAttack(game, m, target, dt, now);
    case 'stagger':
    case 'phase':
      return now < act.until;
    case 'approach': {
      const d = dist(m.x, m.z, target.x, target.z);
      if (d <= act.stop + 0.15) return false;
      const running = d > 4.5;
      const speed = combatSpeed(m, now, running);
      if (act.flank && d < 7) {
        // pack members curve around the target instead of queueing behind each other
        const a = angleTo(m, target.x, target.z) + act.flank * 0.6;
        stepDir(game, m, Math.sin(a), Math.cos(a), speed, dt, now);
        m.ry = angleTo(m, target.x, target.z);
      } else {
        stepToward(game, m, target.x, target.z, speed, dt, act.stop, now);
      }
      return now < act.until;
    }
    case 'strafe': {
      const d = dist(m.x, m.z, target.x, target.z);
      const a = angleTo(m, target.x, target.z);
      // tangent + a pull towards the preferred ring
      const side = act.side;
      let tx = Math.sin(a + (Math.PI / 2) * side), tz = Math.cos(a + (Math.PI / 2) * side);
      const pull = Math.max(-0.6, Math.min(0.6, (d - act.ring) * 0.35));
      tx += Math.sin(a) * pull; tz += Math.cos(a) * pull;
      const l = Math.hypot(tx, tz) || 1;
      const moved = stepDir(game, m, tx / l, tz / l, combatSpeed(m, now, false) * 0.65, dt, now);
      if (moved < 1e-3) act.side = -side; // blocked: circle the other way
      m.ry = a;
      return now < act.until;
    }
    case 'backoff': {
      const a = angleTo(m, target.x, target.z);
      const moved = stepDir(game, m, -Math.sin(a), -Math.cos(a), combatSpeed(m, now, false) * 0.8, dt, now);
      m.ry = a;
      if (moved < 1e-3) return false; // cornered: fight
      return now < act.until && dist(m.x, m.z, target.x, target.z) < act.stop;
    }
    case 'flee': {
      const a = angleTo(m, target.x, target.z);
      stepDir(game, m, -Math.sin(a), -Math.cos(a), combatSpeed(m, now, true), dt, now);
      m.ry = a + Math.PI;
      return now < act.until;
    }
    case 'pause':
      m.ry = angleTo(m, target.x, target.z);
      return now < act.until;
    default:
      return false;
  }
}

/** Utility-based choice of the next action (weighted random with the monster's own RNG). */
export function decide(game, m, target, now) {
  const B = m.brain, T = m.temper;
  const arch = B.arch;
  const d = dist(m.x, m.z, target.x, target.z);
  const opts = [];
  const canAttack = now >= m.atkReady;
  let reach = 0; // longest range among the ready attacks
  for (const atk of B.attacks) {
    if (atk.phase && m.phase < atk.phase) continue;
    if (now < (m.cds[atk.id] || 0)) continue;
    if (atk.once && m.used[atk.id]) continue;
    if (!canAttack) continue;
    if (atk.kind === 'heal' && !hasInjuredAlly(game, m, atk)) continue;
    if (atk.kind === 'howl' && !hasAlliesToCall(game, m, atk)) continue;
    if (atk.kind !== 'howl' && atk.kind !== 'heal') reach = Math.max(reach, atk.max || 2);
    if (d < (atk.min || 0) || d > (atk.max || 2)) continue;
    opts.push({ kind: 'attack', atk, w: (atk.w || 1) * (0.5 + T.aggression) });
  }
  const lightRange = B.attacks.find((a) => a.kind === 'melee')?.max || m.def.range;
  const ranged = arch === 'ranged' || arch === 'caster';
  const want = ranged ? T.prefDist : Math.min(T.prefDist || lightRange * 0.8, lightRange * 0.85);
  const hpRatio = m.hp / m.mhp;

  // close the gap when nothing can hit from here
  if (d > Math.max(want, reach) + 0.3 || (!opts.length && d > want + 0.5)) {
    opts.push({ kind: 'approach', w: opts.length ? 0.6 + T.aggression : 3 + T.aggression * 2 });
  }
  if (ranged && d < T.prefDist * 0.7) opts.push({ kind: 'backoff', w: 1.5 + T.caution * 2.5 });
  // hit & run: skirmishers step back after trading blows
  if (arch === 'skirmisher' && d < 2.6 && !opts.some((o) => o.kind === 'attack')) opts.push({ kind: 'backoff', w: 1 + T.caution * 2 });
  // rushers / hoppers step out of melee to use their gap closer (lunge, leap) again
  let gapStop = 0;
  if (arch === 'rusher' || arch === 'hopper') {
    const gap = B.attacks.find((a) => a.kind === 'tele' && (a.min || 0) >= 2 && now >= (m.cds[a.id] || 0) - 800);
    if (gap && d < gap.min) {
      gapStop = gap.min + 1;
      opts.push({ kind: 'backoff', w: 0.5 + T.caution * 1.2 + (1 - T.aggression) * 0.5 });
    }
  }
  if (d < 10) opts.push({ kind: 'strafe', w: (STRAFE_W[arch] ?? 0.5) * (0.5 + (1 - T.aggression) * 0.8) * (opts.some((o) => o.kind === 'attack') ? 0.5 : 1) });
  opts.push({ kind: 'pause', w: (PAUSE_W[arch] ?? 0.3) * (0.3 + T.patience) });
  if (B.flee && hpRatio < B.flee && !m.fled && T.caution > 0.45) opts.push({ kind: 'flee', w: 8 });

  let sum = 0;
  for (const o of opts) sum += o.w;
  let r = rnd(m) * sum;
  let pick = opts[opts.length - 1];
  for (const o of opts) {
    if (r < o.w) { pick = o; break; }
    r -= o.w;
  }
  switch (pick.kind) {
    case 'attack':
      startAttack(game, m, pick.atk, target, now);
      break;
    case 'approach':
      m.act = { kind: 'approach', until: now + 500 + rnd(m) * 900, stop: Math.max(0.3, Math.min(want, reach || want) * 0.9), flank: B.pack ? T.strafeSide : 0 };
      break;
    case 'strafe':
      m.act = { kind: 'strafe', until: now + 600 + rnd(m) * 1100 * (0.5 + T.patience), side: T.strafeSide, ring: Math.max(d, want) };
      if (rnd(m) < 0.2) T.strafeSide = -T.strafeSide; // change sides from time to time
      break;
    case 'backoff':
      m.act = { kind: 'backoff', until: now + 500 + rnd(m) * 700, stop: ranged ? T.prefDist : gapStop || 4.5 };
      break;
    case 'flee':
      m.fled = true;
      m.act = { kind: 'flee', until: now + 1800 + rnd(m) * 1700 };
      break;
    default: // pause / feint: hold the ground a moment, facing the target
      m.act = { kind: 'pause', until: now + 250 + rnd(m) * 650 * (0.5 + T.patience) };
      break;
  }
  return pick.kind;
}

// ------------------------------------------------------------------ hooks (combat.js)
/** Poise damage from a player's hit: staggers the monster when its poise breaks. */
export function applyPoise(game, m, poise, now) {
  if (m.dead || !(poise > 0) || !m.brain) return false;
  if (now - m.poiseAt > POISE.windowMs) m.poiseDmg = 0;
  m.poiseAt = now;
  m.poiseDmg += poise;
  const max = (m.brain.poise || 30) * (m.elite ? 1.3 : 1);
  if (m.poiseDmg < max || m.act?.kind === 'stagger' || m.act?.kind === 'phase') return false;
  m.poiseDmg = 0;
  cancelTelegraphs(game, m);
  m.dash = null;
  const ms = m.boss ? POISE.bossStaggerMs : POISE.staggerMs;
  m.act = { kind: 'stagger', until: now + ms };
  game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.STAGGER, src: m.id, ms });
  return true;
}

/** Frontal guard (skeletons): fraction of the damage absorbed, 0 if the guard does not apply. */
export function guardReduction(m, attacker) {
  const g = m.brain?.guard;
  if (!g || !attacker) return 0;
  const k = m.act?.kind;
  if (k === 'stagger' || (k === 'attack' && m.act.phase === 'windup')) return 0; // open while attacking
  const a = angleTo(m, attacker.x, attacker.z);
  let d = (a - m.ry) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= (g.arc || 2) / 2 ? g.reduce || 0.4 : 0;
}

/** A player damaged `m`: enter combat (reaction delay for idle monsters). */
export function onMonsterDamaged(game, m, attacker, now) {
  if (m.ai === 'chase' || m.ai === 'return' || m.dead) return;
  provoke(game, m, attacker, now);
  m.target = attacker.id;
}

export function onMonsterDeath(game, m) {
  cancelTelegraphs(game, m);
  m.act = null;
  m.dash = null;
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

