// [combat-souls] Stamina, dodge roll, sprint and attack commitment (ROADMAP §4.3).
// The Player exposes maxSpeedAt(nowMs): the speed the movement validator allows at that instant
// (base speed, sprint, roll burst, recovery slow after an attack…).
import { STAMINA, ROLL, ROLL_SPEED, COMMIT, regenStamina } from '../../../shared/combat.js';
import { S2C, FX } from '../../../shared/protocol.js';
import { isNum, round3 } from '../util.js';

/** Fresh combat state of a player (called by the Player constructor). */
export function initCombatState(p) {
  p.mst = STAMINA.max;
  p.st = p.mst;
  p.sentSt = p.mst;
  p.stSpentAt = -Infinity;
  p.sprintReq = false;       // client holds the sprint key
  p.exhausted = false;       // stamina hit 0 while sprinting: sprint stops until STAMINA.sprintMin
  p.sprintGraceUntil = 0;
  p.rollUntil = 0;
  p.iframeUntil = 0;
  p.rollReady = 0;
  p.rollDx = 0; p.rollDz = 0;
  p.recoverUntil = 0;        // attack commitment
  p.recoverSlow = 1;
  p.moveSpeedEst = 0;        // smoothed speed of the last accepted moves (m/s)
}

/** Sprint is effective (requested, stamina left, not exhausted). */
export const isSprinting = (p) => p.sprintReq && !p.exhausted && p.st > 0;
export const isRolling = (p, now) => now < p.rollUntil;

/** Max movement speed allowed at `now` (m/s). */
export function maxSpeedAt(p, now) {
  const base = p.stats.speed;
  if (now < p.rollUntil + ROLL.graceMs) return Math.max(base * STAMINA.sprintMult, ROLL_SPEED * 1.1);
  let mult = isSprinting(p) || now < p.sprintGraceUntil ? STAMINA.sprintMult : 1;
  if (now < p.recoverUntil) mult = Math.min(mult, p.recoverSlow);
  return base * mult;
}

/** Spend stamina (returns false and spends nothing when there is not enough). */
export function spendStamina(p, amount, now) {
  if (!(amount > 0)) return true;
  if (p.st < amount) return false;
  p.st -= amount;
  p.stSpentAt = now;
  syncStamina(p, true);
  return true;
}

/** Mark `st` dirty when the shown value moved enough (keeps `self` traffic low while regenerating). */
function syncStamina(p, force = false) {
  const v = Math.floor(p.st);
  if (v === p.sentSt) return;
  if (force || Math.abs(v - p.sentSt) >= 4 || v === 0 || v >= p.mst) {
    p.sentSt = v;
    p.markDirty('st');
  }
}

/** Attack commitment: after an ability the caster is slowed for a short recovery. */
export function applyRecovery(p, ab, now) {
  const rec = ab.rec ?? COMMIT.rec;
  if (!(rec > 0)) return;
  p.recoverUntil = Math.max(p.recoverUntil, now + rec * 1000);
  p.recoverSlow = ab.recSlow ?? COMMIT.recSlow;
}

/** Per tick: sprint drain, regeneration, movement allowance integration. */
export function updateStamina(game, dt, now) {
  for (const p of game.players.values()) {
    if (p.dead) continue;
    const moving = now < p.moveUntil;
    if (isSprinting(p) && moving) {
      p.st = Math.max(0, p.st - STAMINA.sprintPerS * dt);
      p.stSpentAt = now;
      if (p.st <= 0) {
        p.exhausted = true;
        p.sprintGraceUntil = now + STAMINA.sprintGraceMs;
      }
    } else if (p.st < p.mst) {
      p.st = regenStamina(p.st, p.mst, now - p.stSpentAt, dt * 1000);
    }
    if (p.exhausted && p.st >= STAMINA.sprintMin) p.exhausted = false;
    syncStamina(p);
    p.mv.advance?.(now, maxSpeedAt(p, now));
  }
}

/** C2S dodge { dx, dz } */
export function handleDodge(game, p, msg) {
  if (p.dead) return;
  if (!isNum(msg.dx) || !isNum(msg.dz)) return game.error(p, 'bad_request', 'Direction invalide.');
  const l = Math.hypot(msg.dx, msg.dz);
  if (l < 0.2 || l > 1.5) return game.error(p, 'bad_request', 'Direction invalide.');
  const now = game.now();
  if (now < p.rollReady) return game.error(p, 'cooldown', 'Roulade pas encore prête');
  if (!spendStamina(p, STAMINA.roll, now)) return game.error(p, 'no_stamina', 'Pas assez d\'endurance');
  p.mv.advance?.(now, maxSpeedAt(p, now));
  const dx = msg.dx / l, dz = msg.dz / l;
  p.rollUntil = now + ROLL.ms;
  p.iframeUntil = now + ROLL.iframeMs;
  p.rollReady = now + ROLL.cdMs;
  p.rollDx = dx; p.rollDz = dz;
  p.recoverUntil = 0;          // rolling cancels the recovery of an attack (it costs stamina instead)
  p.moveUntil = Math.max(p.moveUntil, now + ROLL.ms);
  p.ry = Math.atan2(dx, dz);
  // the auto-attack resumes after the roll
  if (p.cooldowns[0] < p.rollUntil) p.cooldowns[0] = p.rollUntil;
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.ROLL, src: p.id, dx: round3(dx), dz: round3(dz) });
}

/** C2S sprint { on } */
export function handleSprint(game, p, msg) {
  const on = msg.on === true;
  const now = game.now();
  if (!on && isSprinting(p)) p.sprintGraceUntil = now + STAMINA.sprintGraceMs; // client may be a message ahead
  p.mv.advance?.(now, maxSpeedAt(p, now));
  p.sprintReq = on;
}

/** Record the speed of an accepted move (used to refuse ranged auto-attacks while running). */
export function trackMoveSpeed(p, d, elapsedMs) {
  const inst = d / Math.max(0.03, elapsedMs / 1000);
  p.moveSpeedEst = p.moveSpeedEst * 0.4 + Math.min(inst, 30) * 0.6;
}

/** True while the player moves faster than COMMIT.rangedMoveMax of its base speed. */
export function isRunning(p, now) {
  return now < p.moveUntil && p.moveSpeedEst > p.stats.speed * COMMIT.rangedMoveMax;
}
