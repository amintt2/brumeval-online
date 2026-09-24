// [skilltree] Fondamentaux (docs/design/ARBRE_COMPETENCES.md §5): Saut (+ Attaque sautée), Garde (+ Parade parfaite,
// Garde de fer, Égide arcanique), Attaque chargée (hold the base attack), and the defensive pipeline of a player hit
// (i-frames and perfect dodge, jump over « rasant » attacks, guard / parry, shields, stagger « vacillement »).
// Roulade and Sprint live in systems/stamina.js. Everything is server-authoritative: the jump has no height on the
// server and never raises the movement allowance (except Envol's ×1.4 distance), the validator stays in charge.
import { S2C, FX } from '../../../shared/protocol.js';
import { PLAYER_STAGGER } from '../../../shared/combat.js';
import { stat, statEffects, weaponTags } from '../../../shared/skills.js';
import { isNum, dist } from '../util.js';
import { spendStamina, isRolling, applyRecovery, setRollCancel } from './stamina.js';
import { setTelegraphHooks } from './telegraph.js';
import { specOf, castAbility, cancelCast, stopChannel, fireVolley, strike } from './abilities.js';
import { monstersInRadius } from './combat.js';
import { addBuff, buffStat, removeBuff } from './buffs.js';
import { applyPoise } from './ai.js';
import { applyStatus } from './status.js';

const TWO_PI = Math.PI * 2;
function angDiff(a, b) {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d < -Math.PI) d += TWO_PI;
  return d;
}

/** In the air (between take-off and landing): « rasant » (lo) telegraphs miss. */
export const isAirborne = (p, now) => now >= (p.airFrom ?? Infinity) && now < (p.airUntil || 0);
export const isStaggered = (p, now) => now < (p.staggerUntil || 0);

// ------------------------------------------------------------------ Saut
/** C2S jump { dx, dz } */
export function handleJump(game, p, msg) {
  if (p.dead) return;
  if (!p.tree.unlocked.has('saut')) return game.error(p, 'locked', 'Apprenez d\'abord le Saut (Fondamental).');
  const dx = isNum(msg.dx) ? msg.dx : NaN, dz = isNum(msg.dz) ? msg.dz : NaN;
  const l = Math.hypot(dx, dz);
  if (!Number.isFinite(l) || l > 1.5) return game.error(p, 'bad_request', 'Direction invalide.');
  const now = game.now();
  if (isRolling(p, now)) return;
  if (isStaggered(p, now)) return game.error(p, 'staggered', 'Vous vacillez !');
  if (now < (p.airUntil || 0) + 60 || now < (p.jumpReady || 0)) {
    // a second take-off while airborne is impossible for a well-behaved client
    if (now < (p.airUntil || 0) - 100) game.security?.flag?.(p, 'jump_air', 0.5);
    return game.error(p, 'cooldown', 'Saut pas encore prêt');
  }
  if (p.casting || p.channel) return game.error(p, 'busy', 'Vous êtes en train d\'incanter.');
  const spec = specOf(p, 'saut', now);
  const st = Math.max(0, Math.round(spec.st || 0));
  if (!spendStamina(p, st, now)) return game.error(p, 'no_stamina', 'Pas assez d\'endurance');
  cancelCharge(game, p);
  p.guardUp = false;
  const take = spec.takeoffMs ?? 50;
  const air = spec.airMs ?? 350;
  const land = Math.max(0, spec.landMs ?? 100);
  p.airFrom = now + take;
  p.airUntil = now + take + air;
  p.landUntil = p.airUntil + land;
  p.landSlow = spec.landSlow ?? 0.5;
  p.jumpHoriz = spec.horizMult || 1;
  p.jumpReady = now + (spec.cd ?? 0.5) * 1000;
  p.jumpAtk = null;
  p.hitInAir = false;
  p.moveUntil = Math.max(p.moveUntil, p.airUntil);
  const u = l > 0.2 ? { x: dx / l, z: dz / l } : { x: 0, z: 0 };
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.JUMP, src: p.id, dx: +u.x.toFixed(3), dz: +u.z.toFixed(3), ms: take + air });
  game.schedule(take + air, () => land_(game, p));
}


function land_(game, p) {
  if (game.players.get(p.id) !== p) return;
  const now = game.now();
  if (p.hitInAir) {
    p.hitInAir = false;
    stagger(game, p, PLAYER_STAGGER.airHitMs, now);
  }
  const ja = p.jumpAtk;
  p.jumpAtk = null;
  if (!ja || p.dead) {
    game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.LAND, src: p.id });
    return;
  }
  // melee jump attack: area at the landing point
  const { spec, base } = ja;
  const r = spec.radius || 1.5;
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.LAND, src: p.id, r });
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.AOE, src: p.id, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, r, ab: 'attaque_sautee' });
  const hitSpec = { ...base, id: 'attaque_sautee', tags: [...(base.tags || []), 'zone'], poise: (base.poise || 0) * (spec.poiseMult || 1.5) };
  for (const m of monstersInRadius(game, p.x, p.z, r + 0.5)) strike(game, p, m, (base.power || 1) * (spec.powerMult || 1.3), hitSpec, now);
  applyRecovery(p, { rec: spec.rec ?? 0.3, recSlow: spec.recSlow ?? 0.3 }, now);
  // the base attack recharges from the landing (not a DPS gain)
  if (typeof base.cd === 'number') p.cds.set(base.id, now + base.cd * 1000);
}

/** Base attack pressed in the air: Attaque sautée (melee: at the landing; ranged: one ×1.1 shot now). */
export function jumpAttack(game, p, slot, target, now) {
  if (p.jumpAtk) return;
  const baseId = p.loadout[slot];
  if (now < p.cdOf(baseId)) return;
  const base = specOf(p, baseId, now, game);
  const spec = specOf(p, 'attaque_sautee', now, game);
  const st = (base.st || 0) + (spec.st || 5);
  if (p.st < st) return game.error(p, 'no_stamina', 'Pas assez d\'endurance');
  if (!base.usable) return;
  spendStamina(p, st, now);
  p.cds.set(baseId, (p.airUntil || now) + (base.cd || 1) * 1000 + 1000); // released at the landing
  if (base.kind === 'projectile') {
    if (!target) return;
    const pw = (base.power || 1) * (spec.rangedPowerMult || 1.1);
    const s2 = spec.rangedBurstR ? { ...base, splash: { radius: spec.rangedBurstR, pct: 1 } } : base;
    fireVolley(game, p, s2, target, pw);
    p.jumpHoriz = Math.min(p.jumpHoriz || 1, spec.rangedHorizMult || 0.5);
    game.schedule(Math.max(0, (p.airUntil || now) - now), () => { if (typeof base.cd === 'number') p.cds.set(baseId, game.now() + base.cd * 1000); });
    return;
  }
  p.jumpAtk = { spec, base: { ...base, id: baseId } };
  if (target) p.autoTarget = target.id;
}

// ------------------------------------------------------------------ Garde
/** A raise opens a parry window at most once per second (Sekiro / Elden Ring-like lockout). */
export const PARRY_COOLDOWN_MS = 1000;
/** Guard raises per second above which the account is flagged (guard_spam). */
export const GUARD_SPAM_PER_S = 4;
/** C2S guard { on } */
export function handleGuard(game, p, msg) {
  const on = msg.on === true;
  const now = game.now();
  if (!on) {
    p.guardReq = false;
    p.guardUp = false;
    return;
  }
  if (p.dead) return;
  if (!p.tree.unlocked.has('garde')) return game.error(p, 'locked', 'Apprenez d\'abord la Garde (Fondamental).');
  if (stat(p.tree, 'noGuard')) return game.error(p, 'locked', 'Votre clé de voûte interdit la Garde.');
  p.guardReq = true;
  if (isStaggered(p, now) || isRolling(p, now) || p.casting || p.channel) return;
  cancelCharge(game, p);
  if (!p.guardUp) {
    p.guardUp = true;
    p.guardAuto = false;
    p.guardStartAt = now;
    // Parade parfaite lockout: a raise opens a parry window only once every PARRY_COOLDOWN_MS (toggling the
    // guard key cannot keep the window open), other raises only block after raiseMs
    p.guardParry = now - (p.parryRaiseAt ?? -Infinity) >= PARRY_COOLDOWN_MS;
    if (p.guardParry) p.parryRaiseAt = now;
    // anti-cheat: more than GUARD_SPAM_PER_S raises within 1 s is a macro
    const w = (p.guardRaises ||= []);
    w.push(now);
    while (w.length && now - w[0] > 1000) w.shift();
    if (w.length === GUARD_SPAM_PER_S + 1) game.security?.flag?.(p, 'guard_spam', 0.5, { n: w.length });
  }
}

/** Frontal guard / parry. Returns { blocked: true, amount } (amount let through) or null (not blocked). */
function guardHit(game, p, src, amount, info, now) {
  if (!p.guardUp || !src || info.lo || info.nb) return null;
  const g = specOf(p, 'garde', now);
  if (info.mag && !g.blocksMagic) return null;
  const a = Math.atan2(src.x - p.x, src.z - p.z);
  if (Math.abs(angDiff(p.ry, a)) > ((g.arcDeg || 120) * Math.PI) / 360) return null;
  const since = now - (p.guardStartAt ?? now);
  // Parade parfaite: the hit is cancelled, the attacker loses its balance, « Contre parfait »
  if (g.parryWindowMs && !p.guardAuto && p.guardParry && since <= g.parryWindowMs) {
    p.lastBlockAt = now;
    game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.PARRY, src: p.id, tg: src.id });
    if (src.kind === 'monster') applyPoise(game, src, g.parryPoise || 60, now);
    grantRiposte(game, p, now, true);
    return { blocked: true, amount: 0 };
  }
  if (since < (g.raiseMs ?? 150)) return null; // still raising the guard
  const melee = weaponTags(p.eq.weapon).includes('melee');
  const r = g.reduce;
  let red = g.reduceAll ?? (typeof r === 'number' ? r : melee ? r?.melee ?? 0.5 : r?.autre ?? 0.3);
  red = Math.min(0.9, red + stat(p.tree, 'guardReducePct'));
  // Mur vivant (keystone): 100 % (85 % against a boss) — only with a shield in the off-hand (none in the v0.3 items yet)
  for (const e of statEffects(p.tree, 'guardReduce')) if (!e.when?.offhand) red = Math.max(red, info.boss ? e.bossValue ?? e.value : e.value);
  let cost = Math.min(60, 8 + (60 * amount) / Math.max(1, p.mhp)) * (info.tele ? 1.5 : 1);
  cost *= Math.max(0.1, 1 + stat(p.tree, 'guardStaminaPct')) * (g.blockStMult || 1);
  cost = Math.round(cost);
  if (p.st < cost) {
    // guard broken: stamina gone, 1 s stagger, the hit goes through
    spendStamina(p, p.st, now);
    p.guardUp = false;
    game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.GUARD_BREAK, src: p.id, ms: PLAYER_STAGGER.guardBreakMs });
    stagger(game, p, PLAYER_STAGGER.guardBreakMs, now);
    return null;
  }
  spendStamina(p, cost, now);
  const through = Math.max(0, Math.round(amount * (1 - red)));
  p.lastBlockAt = now;
  if (g.mpPerBlock > 0) { p.mp = Math.max(0, p.mp - g.mpPerBlock); p.markDirty('mp'); }
  const heal = stat(p.tree, 'onBlockHealPct');
  if (heal > 0 && now - (p.blockHealAt || -Infinity) > 1000) {
    p.blockHealAt = now;
    p.hp = Math.min(p.mhp, p.hp + p.mhp * heal);
  }
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.BLOCK, src: p.id, tg: src.id, v: through });
  return { blocked: true, amount: through };
}

function grantRiposte(game, p, now, parry = false) {
  // Garde au couteau: after a perfect parry, the next Coup de dague hits much harder
  const pr = parry && stat(p.tree, 'parryRiposte');
  if (pr) addBuff(game, p, 'parry_riposte', 1500, { ability: pr.ability, mult: pr.mult || 2.5 });
  const g = specOf(p, 'riposte_parfaite', now).grant;
  if (!g) return;
  addBuff(game, p, 'riposte_parfaite', g.ms || 1000, { powerMult: g.powerMult, powerMultNonMelee: g.powerMultNonMelee, poiseAdd: g.poiseAdd });
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.PERFECT, src: p.id, ms: g.ms || 1000 });
}

/** A hit negated by the roll i-frames: Esquive parfaite (stamina back, « Contre parfait ») when the roll was late. */
export function onDodged(game, p, now) {
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.DODGE, tg: p.id });
  if (p.perfectDone === p.rollStartAt) return;
  const roll = specOf(p, 'roulade', now);
  if (!roll.perfectWindowMs || now - (p.rollStartAt ?? -Infinity) > roll.perfectWindowMs) return;
  p.perfectDone = p.rollStartAt;
  const refund = Math.min(roll.perfectRefundSt || 15, p.rollPaid || 0); // never more than the roll cost
  if (refund > 0) p.st = Math.min(p.mst, p.st + refund);
  grantRiposte(game, p, now);
  // Fantôme des brumes: the monsters lose sight of you for a moment (never bosses, half on elites), internal cd
  const ghost = stat(p.tree, 'onPerfectDodge');
  if (ghost && now >= (p.ghostReady || 0)) {
    p.ghostReady = now + (ghost.icd || 8) * 1000;
    for (const m of game.monsters.values()) {
      if (m.dead || m.target !== p.id || m.boss || m.act?.kind === 'stagger') continue;
      if (m.act?.kind === 'attack') continue; // never cancels an attack already launched
      m.act = { kind: 'pause', until: now + (ghost.stealth || 1.5) * 1000 * (m.elite ? ghost.elites ?? 0.5 : 1) };
    }
  }
}

// ------------------------------------------------------------------ player stagger (vacillement)
export function stagger(game, p, ms, now) {
  // Équilibre (+ Roulade lourde: +50 for 0.4 s after the roll), Inébranlable (ccDurationPct)
  const eq = (p.equilibre || 0) + (now < (p.equilibreBonusUntil || 0) ? p.equilibreBonus || 0 : 0);
  const k = Math.max(0.4, 1 - Math.min(90, eq) / 100) * Math.max(0.3, 1 + stat(p.tree, 'ccDurationPct'));
  const d = Math.round(ms * k);
  p.staggerUntil = Math.max(p.staggerUntil || 0, now + d);
  p.guardUp = false;
  cancelCast(game, p);
  stopChannel(game, p, 'stagger');
  cancelCharge(game, p);
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.VACILLE, src: p.id, ms: d });
}

/**
 * Defensive pipeline of a player hit by `src` (monster, or null): i-frames / perfect dodge, jump over « rasant »,
 * guard / parry, damage taken modifiers, shields, mana shield. Returns the damage to apply (0 = negated) and whether
 * the hit was blocked. info = { tele, lo, nb, mag, boss, kind }.
 */
export function defendPlayer(game, p, src, amount, info, now) {
  const fromMonster = src && src.kind === 'monster';
  if (fromMonster && now < (p.iframeUntil || 0)) {
    onDodged(game, p, now);
    return { amount: 0, negated: true };
  }
  if (info.lo && isAirborne(p, now)) {
    game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.DODGE, tg: p.id });
    return { amount: 0, negated: true };
  }
  let blocked = false;
  const g = fromMonster ? guardHit(game, p, src, amount, info, now) : null;
  if (g) {
    blocked = true;
    amount = g.amount;
    if (amount <= 0) return { amount: 0, negated: true, blocked };
  }
  amount *= Math.max(0.1, 1 + stat(p.tree, 'dmgTakenPct') + buffStat(p, 'dmgTakenPct'));
  // resistances: only spells (mag) have an element in v0.3 (arcane)
  if (info.mag) amount *= 1 - Math.min(0.6, stat(p.tree, 'resArcane'));
  // Fureur: each hit taken gives +x % damage for a few seconds (stacks)
  const fury = statEffects(p.tree, 'onHitTakenDmgPct')[0];
  if (fury && fromMonster) {
    const n = p.fury && now < p.fury.until ? Math.min(fury.maxStacks || 5, p.fury.n + 1) : 1;
    p.fury = { n, pct: fury.value, until: now + (fury.dur || 5) * 1000 };
  }
  // Égide runique (absorb shield)
  const sh = p.buffs?.get('rune_aegis');
  if (sh && sh.shieldHp > 0 && now < sh.until) {
    const a = Math.min(sh.shieldHp, amount);
    sh.shieldHp -= a;
    amount -= a;
    if (sh.shieldHp <= 0) removeBuff(game, p, 'rune_aegis');
  }
  // Bouclier de mana: part of the damage is paid with mana
  const ms = p.buffs?.get('mana_shield');
  if (ms && now < ms.until && amount > 0) {
    const part = amount * (ms.absorb || 0.4);
    const cost = part * (ms.manaPerDmg || 1.5);
    const paid = Math.min(p.mp, cost);
    amount -= paid / (ms.manaPerDmg || 1.5);
    p.mp -= paid;
    p.markDirty('mp');
    if (p.mp <= 0.5) removeBuff(game, p, 'mana_shield');
  }
  // Armure de givre: melee attackers get chilled
  const fa = p.buffs?.get('frost_armor');
  if (fa && now < fa.until && fromMonster && info.kind === 'melee') applyStatus(game, src, p, 'froid', { stacks: fa.meleeAttackerFroid || 1 });
  amount = Math.max(0, Math.round(amount));
  // Attaque chargée: a hit outside the super-armour loses the charge (no cost)
  const c = p.charging;
  if (c && amount > 0) {
    const held = now - c.start;
    if (held < c.fullMs - c.hyperMs) cancelCharge(game, p);
  }
  if (info.tele && amount > 0 && !blocked) {
    if (isAirborne(p, now)) p.hitInAir = true;
    else stagger(game, p, info.boss ? PLAYER_STAGGER.bossMs : PLAYER_STAGGER.teleMs, now);
  }
  return { amount, blocked };
}

/** Dernier souffle (keystone): survive a lethal hit every 120 s. Returns true if the death was prevented. */
export function cheatDeath(game, p, now) {
  const cd = stat(p.tree, 'cheatDeath');
  if (!cd || now < (p.cheatDeathReady || 0)) return false;
  const v = typeof cd === 'object' ? cd : {};
  p.cheatDeathReady = now + (v.cdS || 120) * 1000;
  p.hp = 1;
  p.iframeUntil = now + (v.iframeMs || 600);
  p.st = Math.min(p.mst, p.st + (v.st || 30));
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.PERFECT, src: p.id, ms: v.iframeMs || 600 });
  game.notify(p, 'info', 'Dernier souffle !');
  return true;
}

// ------------------------------------------------------------------ Attaque chargée
/** ability { slot, ph: 'start' | 'release' } on the base attack. */
export function handleCharge(game, p, slot, msg, now) {
  const baseId = p.loadout[slot];
  const base = specOf(p, baseId, now, game);
  if (!base?.base) return game.error(p, 'bad_request', 'Seule l\'attaque de base se charge.');
  if (msg.ph === 'start') {
    if (!p.tree.unlocked.has('attaque_chargee')) return game.error(p, 'locked', 'Apprenez d\'abord l\'Attaque chargée (Fondamental).');
    if (p.charging || p.casting || p.channel || isRolling(p, now) || isStaggered(p, now) || isAirborne(p, now)) return;
    if (now < p.cdOf(baseId)) return game.error(p, 'cooldown', 'Attaque pas encore prête');
    const spec = specOf(p, 'attaque_chargee', now, game);
    const speed = 1 + stat(p.tree, 'chargeSpeedPct');
    const own = base.charged?.fullMs ? base.charged.fullMs * ((spec.fullMs || 1200) / 1200) : spec.fullMs || 1200;
    const full = Math.round(own / Math.max(0.5, speed));
    const tg = Number.isSafeInteger(msg.tg) ? msg.tg : p.autoTarget || 0;
    p.charging = { slot, id: baseId, start: now, tg, fullMs: full, minMs: spec.minMs || 400, maxMs: spec.maxHoldMs || 2000, hyperMs: spec.hyperArmorMs || 300, spec };
    p.guardUp = false;
    game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.CHARGE, src: p.id, ab: baseId, ms: full });
    return;
  }
  // release
  if (!p.charging) return;
  releaseCharge(game, p, now, msg);
}

export function cancelCharge(game, p) {
  if (!p.charging) return false;
  const c = p.charging;
  p.charging = null;
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.CHARGED, src: p.id, ab: c.id, lvl: -1 });
  return true;
}

function releaseCharge(game, p, now, msg = {}) {
  const c = p.charging;
  p.charging = null;
  const held = now - c.start;
  const tgId = Number.isSafeInteger(msg.tg) && msg.tg > 0 ? msg.tg : c.tg;
  const t = game.monsters.get(tgId);
  const target = t && !t.dead ? t : null;
  if (!target) {
    game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.CHARGED, src: p.id, ab: c.id, lvl: -1 });
    return game.error(p, 'no_target', 'Aucune cible.');
  }
  const base = specOf(p, c.id, now, game);
  if (held < c.minMs) {
    // released too early: a normal attack
    const err = castAbility(game, p, c.slot, target, {}, now);
    if (err && err.code !== 'cooldown') game.error(p, err.code, err.msg);
    return;
  }
  const s = c.spec;
  const lvl = Math.max(0, Math.min(1, (held - c.minMs) / Math.max(1, c.fullMs - c.minMs)));
  const powerMax = s.powerMax || 1.8, poiseMax = s.poiseMax || 2;
  const spec = { ...base };
  spec.power = (Array.isArray(base.power) ? base.power[0] : base.power || 1) * (1 + (powerMax - 1) * lvl);
  // Éventail: poisePerTarget (mul −40 %) → poisePerTargetMult
  spec.poise = (base.poise || 0) * (1 + (poiseMax - 1) * lvl) * (s.poisePerTargetMult || 1);
  spec.st = (base.st || 0) + (s.st || 10);
  spec.rec = s.rec ?? 0.5;
  spec.recSlow = s.recSlow ?? 0.3;
  spec.windup = 0;
  spec.charged = true;
  if (base.kind === 'melee') {
    spec.range = (base.range || 2.8) + (s.rangeBonusMelee || 0.5) * lvl;
    if (s.meleeArcDeg) spec.meleeArcDeg = s.meleeArcDeg;
  } else {
    spec.speed = (base.speed || 20) * (1 + (s.projSpeedBonus || 0.3) * lvl);
    if (lvl >= 1 && base.charged?.pierceAtFull) spec.pierce = base.charged.pierceAtFull;
    if (s.projCount) { spec.projCount = s.projCount; spec.spreadDeg = s.spreadDeg || 30; spec.powerEach = s.powerEach || 0.6; }
  }
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.CHARGED, src: p.id, ab: c.id, lvl: Math.round(lvl * 100) / 100 });
  const err = castAbility(game, p, c.slot, target, {}, now, spec);
  if (err) game.error(p, err.code, err.msg);
}

/** Per tick: automatic release of a charge held too long. */
export function updateFundamentals(game, now) {
  for (const p of game.players.values()) {
    if (p.charging && (p.dead || now - p.charging.start >= p.charging.maxMs)) {
      if (p.dead) p.charging = null;
      else releaseCharge(game, p, now);
    }
    if (p.guardReq && !p.guardUp && !p.dead && !isStaggered(p, now) && !isRolling(p, now) && !p.casting && !p.channel && !p.charging
      && p.tree.unlocked.has('garde') && now - (p.lastAbilityAt ?? -Infinity) > 400) {
      // the guard key is still held: it comes back up after an attack / a stagger (never a parry)
      p.guardUp = true;
      p.guardAuto = true;
      p.guardStartAt = now;
    }
  }
}

export { dist };

// a roll cancels a cast (nothing spent), a channel (Trait fatal: half the mana back) and a charge;
// Roulade lourde: +50 Équilibre just after, poise shock (landingPoise) at 1.5 m on arrival
setRollCancel((game, p, r) => {
  cancelCast(game, p);
  stopChannel(game, p, 'roll');
  cancelCharge(game, p);
  if (r?.equilibreBonus) {
    p.equilibreBonus = r.equilibreBonus;
    p.equilibreBonusUntil = game.now() + (r.ms || 650) + 400;
  }
  if (r?.landingPoise) {
    game.schedule(r.ms || 650, () => {
      if (p.dead || game.players.get(p.id) !== p) return;
      for (const m of monstersInRadius(game, p.x, p.z, 1.5)) applyPoise(game, m, r.landingPoise, game.now());
    });
  }
});
setTelegraphHooks({ dodged: onDodged, airborne: isAirborne });
