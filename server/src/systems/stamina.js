// [combat-souls] Stamina, dodge roll, sprint and attack commitment (ROADMAP §4.3).
// The Player exposes maxSpeedAt(nowMs): the speed the movement validator allows at that instant
// (base speed, sprint, roll burst, recovery slow after an attack…).
import { STAMINA, ROLL, ROLL_SPEED, COMMIT, regenStamina } from '../../../shared/combat.js';
import { S2C, FX } from '../../../shared/protocol.js';
import { isNum, round3 } from '../util.js';
// [skilltree] Roulade / Sprint are Fondamentaux (tree), resolved with their variants
import { resolveAbility, stat } from '../../../shared/skills.js';
import { buffFlag } from './buffs.js';

/** Fresh combat state of a player (called by the Player constructor). */
export function initCombatState(p) {
  if (!(p.mst > 0)) p.mst = STAMINA.max; // [skilltree] tree passives set mst (Player.recomputeStats)
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
  // [skilltree] Fondamentaux / abilities in progress
  p.rollSpeed = ROLL_SPEED;
  p.guardUp = false; p.guardReq = false;
  p.airFrom = Infinity; p.airUntil = 0; p.landUntil = 0;
  p.charging = null; p.casting = null; p.channel = null; p.summon = null;
  p.staggerUntil = 0; p.dashUntil = 0; p.dashSpeed = 0;
  p.sprintSince = 0;
}

const roulade = (p) => resolveAbility(p.tree, 'roulade', { weapon: p.eq?.weapon });
const sprintSpec = (p) => resolveAbility(p.tree, 'sprint', { weapon: p.eq?.weapon });
/** Resolved Sprint of a player (cached until the tree changes). */
function sprintOf(p) {
  if (!p.sprintCache || p.sprintCache.tree !== p.tree) p.sprintCache = { tree: p.tree, spec: sprintSpec(p) };
  return p.sprintCache.spec;
}
/** Sprint multiplier (Course du vent: x1.65 after 5 s out of combat, Course feutree x1.35). */
function sprintMult(p, now) {
  const s = sprintOf(p);
  if (s.multOutOfCombat && now - p.lastCombat > 5000) return Math.min(1.65, s.multOutOfCombat);
  return s.mult || STAMINA.sprintMult;
}

/** Sprint is effective (requested, learnt, stamina left, not exhausted, not guarding / charging). */
export const isSprinting = (p) => p.sprintReq && !p.exhausted && p.st > 0 && !p.guardUp && !p.charging
  && (!p.tree || (p.tree.unlocked.has('sprint') && !stat(p.tree, 'noSprint')));
export const isRolling = (p, now) => now < p.rollUntil;

/** Max movement speed allowed at `now` (m/s). */
export function maxSpeedAt(p, now) {
  const base = p.stats.speed;
  const sm = p.tree ? sprintMult(p, now) : STAMINA.sprintMult;
  if (now < p.rollUntil + ROLL.graceMs) return Math.max(base * sm, (p.rollSpeed || ROLL_SPEED) * 1.1);
  // [skilltree] ability movement (leap, lunge, blink...): the destination is server-computed
  if (now < (p.dashUntil || 0) + ROLL.graceMs && p.dashSpeed > 0) return Math.max(base * sm, p.dashSpeed * 1.15);
  let mult = isSprinting(p) || now < p.sprintGraceUntil ? sm : 1;
  // [skilltree] Envol: a longer jump (x1.4 distance); the jump never adds speed otherwise
  if (now < (p.airUntil || 0) && p.jumpHoriz > 1) mult *= p.jumpHoriz;
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
      if (!p.sprintSince) p.sprintSince = now;
      const drain = p.tree ? sprintOf(p).stPerS ?? STAMINA.sprintPerS : STAMINA.sprintPerS;
      p.st = Math.max(0, p.st - drain * dt);
      p.stSpentAt = now;
      if (p.st <= 0) {
        p.exhausted = true;
        p.sprintGraceUntil = now + STAMINA.sprintGraceMs;
      }
    } else {
      p.sprintSince = 0;
      if (p.st < p.mst) {
        // [skilltree] tree regen / delay; guard up: x0.4 (Garde)
        const regen = (p.stRegen || STAMINA.regen) * (p.guardUp ? 0.4 : 1);
        p.st = regenStamina(p.st, p.mst, now - p.stSpentAt, dt * 1000, regen, p.stRegenDelayMs || STAMINA.regenDelayMs);
      }
    }
    if (p.exhausted && p.st >= STAMINA.sprintMin) p.exhausted = false;
    syncStamina(p);
    p.mv.advance?.(now, maxSpeedAt(p, now));
  }
}

/** C2S dodge { dx, dz } - [skilltree] needs the Roulade Fondamental; its variants change it (Pas de l'ombre...). */
export function handleDodge(game, p, msg) {
  if (p.dead) return;
  if (!isNum(msg.dx) || !isNum(msg.dz)) return game.error(p, 'bad_request', 'Direction invalide.');
  const l = Math.hypot(msg.dx, msg.dz);
  if (l < 0.2 || l > 1.5) return game.error(p, 'bad_request', 'Direction invalide.');
  if (p.tree && !p.tree.unlocked.has('roulade')) return game.error(p, 'locked', 'Apprenez d\'abord la Roulade (niveau 2, arbre des compétences).');
  const now = game.now();
  if (now < (p.staggerUntil || 0)) return game.error(p, 'staggered', 'Vous vacillez !');
  if (buffFlag(p, 'noRoll')) return game.error(p, 'cant_use', 'Impossible de rouler pendant le Bastion.');
  if (now < p.rollReady) return game.error(p, 'cooldown', 'Roulade pas encore prête');
  const r = p.tree ? roulade(p) : { st: STAMINA.roll, dist: ROLL.dist, ms: ROLL.ms, iframeMs: ROLL.iframeMs, cd: ROLL.cdMs / 1000 };
  let cost = r.st ?? STAMINA.roll;
  if (p.tree) {
    cost *= 1 + stat(p.tree, 'rollStaminaPct');
    const h = p.buffs?.get('hallali');
    if (h && now < h.until && h.rollStCost) cost *= 1 + h.rollStCost;
    cost = Math.max(0, Math.round(cost));
  }
  if (!spendStamina(p, cost, now)) return game.error(p, 'no_stamina', 'Pas assez d\'endurance');
  p.rollPaid = cost;
  p.mv.advance?.(now, maxSpeedAt(p, now));
  const dx = msg.dx / l, dz = msg.dz / l;
  const ms = r.ms ?? ROLL.ms;
  const dist = (r.dist ?? ROLL.dist) * (1 + (p.tree ? stat(p.tree, 'rollDistPct') : 0));
  p.rollSpeed = dist / (ms / 1000);
  p.rollMs = ms;
  p.rollStartAt = now;
  p.rollUntil = now + Math.max(ms, r.actAfterMs ?? 0);
  p.iframeUntil = now + (r.iframeStartMs || 0) + (r.iframeMs ?? ROLL.iframeMs);
  p.rollReady = now + (r.cd ?? ROLL.cdMs / 1000) * 1000;
  p.rollDx = dx; p.rollDz = dz;
  p.recoverUntil = 0;          // rolling cancels the recovery of an attack (it costs stamina instead)
  p.moveUntil = Math.max(p.moveUntil, now + ms);
  p.ry = Math.atan2(dx, dz);
  // [skilltree] a roll cancels a cast (nothing spent), a channel (Trait fatal: half the mana back) and a charge
  cancelInProgress?.(game, p, r);
  p.guardUp = false;
  // the auto-attack resumes after the roll
  const base = p.loadout?.[0];
  if (base && p.cdOf(base) < p.rollUntil) p.cds.set(base, p.rollUntil);
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.ROLL, src: p.id, dx: round3(dx), dz: round3(dz), ms });
}

let cancelInProgress = null;
/** abilities / fundamentals register how a roll cancels casts, channels and charges (no import cycle). */
export function setRollCancel(fn) { cancelInProgress = fn; }

/** C2S sprint { on } - [skilltree] needs the Sprint Fondamental (silently ignored otherwise: the key is shared). */
export function handleSprint(game, p, msg) {
  const on = msg.on === true && (!p.tree || p.tree.unlocked.has('sprint'));
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
