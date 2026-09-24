// Player damage against monsters, monster deaths (XP / loot / quest credit), auto-attack.
// [skilltree] The abilities themselves are executed by the data-driven engine (systems/abilities.js); this module
// is the damage core every ability, status and summon goes through.
import { ABILITIES, ITEMS, QUESTS, NPCS, computeDamage, monsterXp, playerStats } from '../../../shared/data.js';
import { S2C, KIND, CORPSE_TIME_S } from '../../../shared/protocol.js';
import { inVillage } from '../../../shared/world.js';
import { stat } from '../../../shared/skills.js';
import { RANGE_TOLERANCE } from '../config.js';
import { recordKill, killLabel } from '../quests.js';
import { dist, randInt } from '../util.js';
import { grantXp, giveItem, giveGold } from './players.js';
import { aoiOf } from '../aoi.js'; // [netcode-perf]
// [combat-souls]
import { ELITE } from '../../../shared/data.js';
import { FX } from '../../../shared/protocol.js';
import { isRolling, isRunning } from './stamina.js';
import { applyPoise, guardReduction, onMonsterDamaged, onMonsterDeath, cancelTelegraphs } from './ai.js';
// [skilltree]
import { setStatusHooks, takenMult, defMult, froidStacks, hasStatus, stunMonster } from './status.js';
import { buffStat, consumeRiposte } from './buffs.js';
import { castAbility, handleAbility, specOf } from './abilities.js';

export { handleAbility, castAbility };

/** C2S stop */
export function handleStop(game, p) {
  p.autoTarget = 0;
}

/** Monsters (alive, damageable) within `r` of (x, z). */
export function monstersInRadius(game, x, z, r) {
  // [netcode-perf] spatial grid query instead of a scan of every monster
  const out = aoiOf(game).monstersNear(x, z, r, []);
  let n = 0;
  for (const m of out) {
    if (m.dead || m.invulnerable || !game.monsters.has(m.id)) continue;
    if (dist(x, z, m.x, m.z) <= r + m.radius) out[n++] = m;
  }
  out.length = n;
  return out.sort((a, b) => a.id - b.id); // spawn order, as before (deterministic damage rolls)
}

/**
 * [skilltree] Attack used by an ability: the character's, or for an out-of-class ability (Inaptitude) the lower of
 * it and the attack a character of the ability's class would have at the same level with the same gear
 * (ARBRE_COMPETENCES.md §3.4 « attaque de référence »).
 */
export function attackFor(p, spec) {
  const atk = p.stats.atk;
  if (!spec?.inapt || !spec.refClasses?.length) return atk;
  let ref = 0;
  for (const c of spec.refClasses) ref = Math.max(ref, playerStats(c, p.level, p.eq).atk);
  return Math.min(atk, ref || atk);
}

/** Condition evaluator for conditional tree effects at hit time (`when`). */
export function hitCond(game, p, m, now) {
  return (w) => {
    if (!w) return true;
    if (w.hpUnder !== undefined && !(p.hp / p.mhp < w.hpUnder)) return false;
    if (w.hitWithin !== undefined && !(now - (p.lastHitTakenAt ?? -Infinity) <= w.hitWithin * 1000)) return false;
    if (w.weaponFamily && !w.weaponFamily.includes(ITEMS[p.eq.weapon]?.family)) return false;
    if (w.offhand || w.grip) return false; // no off-hand / two-handed grips in the v0.3 item set yet
    if (w.cond === 'weapon_bow' && !(ITEMS[p.eq.weapon]?.wt || []).includes('distance')) return false;
    if (w.cond === 'still_0.6s' && !(now - (p.lastMoveAt ?? -Infinity) >= 600)) return false;
    if (w.enemiesWithin8 !== undefined || w.enemiesWithin8Min !== undefined) {
      const n = monstersInRadius(game, p.x, p.z, 8).length;
      if (n < (w.enemiesWithin8Min ?? w.enemiesWithin8)) return false;
    }
    return true;
  };
}

/**
 * Roll the damage of player `p` hitting monster `m` with `power` (× attack).
 * `spec` = resolved ability (shared/skills.js resolveAbility) or null (plain hit). opts: { poise, noRiposte }.
 * Returns the damage dealt (0 if ignored).
 */
export function hitMonster(game, p, m, power, abId, spec = null, opts = {}) {
  if (m.dead || m.invulnerable) return 0;
  const now = game.now();
  const tree = p.tree;
  const cond = hitCond(game, p, m, now);
  const s = (n) => stat(tree, n, { cond });
  const tags = spec?.tags || [];
  const melee = tags.includes('melee');
  // ---- power: tree envelope (with conditional bonuses) + buffs + target states
  let pw = power * (spec?.weaponMult ?? 1);
  let env = spec?.dmgPct ?? 0;
  if (froidStacks(m, now) > 0) env += s('dmgVsStatusPct.froid');
  if (m.act?.kind === 'stagger') env += s('dmgVsStaggeredPct');
  env += s('dmgPerMissingHp10') * Math.floor((1 - p.hp / p.mhp) * 10);
  env = Math.min(0.75, env);
  pw *= 1 + env;
  pw *= 1 + buffStat(p, 'dmgPct');
  if (melee) {
    const eb = p.buffs?.get('enchant_blade');
    if (eb && now < eb.until) pw *= 1 + (eb.meleeBonusDmg || 0);
  }
  const hall = p.buffs?.get('hallali');
  if (hall && now < hall.until && m.status?.mark?.src === p.id) pw *= 1 + (hall.dmgVsMarked || 0);
  if (spec?.lowHp && m.hp / m.mhp < spec.lowHp.under) pw *= m.boss ? spec.lowHp.bossMult || spec.lowHp.mult : spec.lowHp.mult;
  let poise = opts.poise ?? spec?.poise ?? ((abId && ABILITIES[abId]?.poise) || 0);
  if (!opts.noRiposte && spec && (spec.power || 0) > 0) {
    const r = consumeRiposte(p, now, melee);
    if (r) { pw *= r.power; poise += r.poise; }
  }
  pw *= takenMult(m, p, now);
  // ---- crit
  let crit = p.stats.crit + (spec?.critAdd || 0);
  if (hasStatus(m, 'brulure', now)) crit += s('critVsStatus.brulure');
  const nh = p.buffs?.get('sidestep');
  if (spec?.guaranteedCrit || (nh && now < nh.until && (spec?.power || 0) > 0)) {
    crit = 1;
    if (nh) p.buffs.delete('sidestep');
  }
  const def = Math.max(0, m.defense * defMult(m, now) * (1 - (spec?.armorPen || 0)));
  const r = computeDamage(attackFor(p, spec), pw, def, crit, game.rng(), game.rng());
  let amount = r.amount;
  if (r.crit) {
    const cd = s('critDmgPct');
    if (cd) amount = Math.max(1, Math.round(amount * (1.6 + cd) / 1.6));
    poise *= 1 + s('critPoisePct');
  }
  poise *= spec?.poiseMult || 1;
  const ok = damageMonster(game, m, p, amount, r.crit, abId, poise, { ignoreGuard: spec?.ignoreGuard });
  if (!ok) return 0;
  onPlayerHit(game, p, m, amount, spec, melee, now);
  return amount;
}

/** Lifesteal, mana / stamina on hit (tree passives, capped). */
function onPlayerHit(game, p, m, amount, spec, melee, now) {
  if (!melee || p.dead) return;
  const ls = Math.min(0.09, stat(p.tree, 'lifestealMelee') + (spec?.lifesteal || 0));
  if (ls > 0) {
    p.hp = Math.min(p.mhp, p.hp + amount * ls);
    p.markDirty('hp');
  }
  const mana = stat(p.tree, 'manaOnMeleeHit') + (p.buffs?.get('enchant_blade')?.manaPerHit || 0);
  if (mana > 0 && now - (p.manaHitAt || -Infinity) > 250) {
    p.manaHitAt = now;
    p.mp = Math.min(p.mmp, p.mp + mana);
    p.markDirty('mp');
  }
  const st = stat(p.tree, 'stOnMeleeHit');
  if (st > 0) p.st = Math.min(p.mst, p.st + st);
  const hall = p.buffs?.get('hallali');
  if (hall && now < hall.until && m.status?.mark?.src === p.id && hall.stOnHitMarked) p.st = Math.min(p.mst, p.st + hall.stOnHitMarked);
}

/**
 * Apply damage to a monster (threat, aggro, poise, death). Returns false if ignored (dead / leashing).
 * `poise` defaults to the base poise of `abId` (v0.2 behaviour); pass 0 for DoTs.
 */
export function damageMonster(game, m, attacker, amount, crit, abId, poise, opts = {}) {
  if (m.dead || m.invulnerable) return false;
  const now = game.now();
  // [combat-souls] frontal guard (skeletons): part of the hit is absorbed ([skilltree] unless Brise-garde)
  const guard = attacker.kind === KIND.PLAYER && !opts.ignoreGuard ? guardReduction(m, attacker, now) : 0;
  if (guard > 0) {
    amount = Math.max(1, Math.round(amount * (1 - guard)));
    game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.GUARD, src: m.id, tg: attacker.id });
  }
  m.hp -= amount;
  m.lastCombat = now;
  attacker.lastCombat = now;
  m.threat.set(attacker.id, (m.threat.get(attacker.id) || 0) + amount * (m.threatMult?.get?.(attacker.id) || 1));
  const msg = { t: S2C.DMG, src: attacker.id, tg: m.id, v: amount, crit: !!crit, hp: m.hp <= 0 ? 0 : Math.max(1, Math.ceil(m.hp)) };
  if (abId) msg.ab = abId;
  game.broadcastNear(m.x, m.z, msg);
  if (m.hp <= 0) {
    killMonster(game, m);
    return true;
  }
  // [combat-souls] reaction (reaction delay, alert) + poise / stagger
  onMonsterDamaged(game, m, attacker, now);
  applyPoise(game, m, poise ?? ((abId && ABILITIES[abId]?.poise) || 0), now);
  return true;
}

// statuses deal their damage through the same pipeline (no poise), stuns reuse the stagger action
setStatusHooks({
  damage: (game, m, p, amount, crit, abId) => damageMonster(game, m, p, amount, crit, abId, 0, { ignoreGuard: true }),
  stagger: (game, m, ms, now) => stunMonster(game, m, ms, now, cancelTelegraphs),
});

/** Monster death: XP to every damager, gold + drops to the top damage dealer, quest credit, corpse, respawn. */
export function killMonster(game, m) {
  const now = game.now();
  m.dead = true;
  m.hp = 0;
  m.deadAt = now;
  m.ai = 'dead';
  m.target = 0;
  m.slowUntil = 0;
  m.status = null; // [skilltree]
  onMonsterDeath(game, m); // [combat-souls] pending telegraphs are cancelled

  const damagers = [];
  for (const [id, dmg] of m.threat) {
    const p = game.players.get(id);
    if (p) damagers.push({ p, dmg });
  }
  m.threat.clear();
  let top = null;
  for (const d of damagers) if (!top || d.dmg > top.dmg) top = d;
  const killer = top ? top.p : null;

  game.broadcastNear(m.x, m.z, { t: S2C.DEATH, id: m.id, by: killer ? killer.id : 0 });

  for (const { p } of damagers) {
    grantXp(game, p, Math.round(monsterXp(m.type, m.level, p.level) * (m.elite ? ELITE.xp : 1))); // [combat-souls] elites
    const progress = recordKill(p.quests, m.type);
    if (progress.length) {
      p.markDirty('quests');
      for (const pr of progress) {
        game.notify(p, 'quest', `${killLabel(m.type)} : ${pr.n}/${pr.count}`);
        if (pr.ready) {
          const q = QUESTS[pr.qid];
          game.notify(p, 'quest', `Objectif accompli : ${q.name} — retournez voir ${NPCS[q.giver].name}.`);
        }
      }
    }
  }

  if (killer) {
    const [gMin, gMax] = m.def.gold;
    const eliteMul = m.elite ? ELITE.gold : 1; // [combat-souls] elites: more gold, better drop chances
    giveGold(game, killer, randInt(game.rng, gMin, gMax) * eliteMul);
    for (const drop of m.def.drops || []) if (game.rng() < drop.ch * (m.elite ? ELITE.drops : 1)) giveItem(game, killer, drop.id, 1);
  }
  game.store?.markDirty();

  game.schedule(CORPSE_TIME_S * 1000, () => game.removeEntity(m));
  game.schedule(m.def.respawn * 1000, () => game.spawnMonster(m.zone));
}

/** Server-side auto-attack: the base attack (bar slot 1) swings whenever it is ready and the target in range. */
export function updateAutoAttacks(game, now) {
  for (const p of game.players.values()) {
    if (!p.autoTarget) continue;
    if (p.dead) { p.autoTarget = 0; continue; }
    const m = game.entities.get(p.autoTarget);
    if (!m || m.kind !== KIND.MONSTER || m.dead) { p.autoTarget = 0; continue; }
    const id = p.loadout[0];
    if (!id || now < p.cdOf(id) || m.invulnerable || inVillage(p.x, p.z)) continue;
    // [combat-souls] no swing mid-roll; ranged autos wait until the player slows down; stamina
    // [skilltree] nor while guarding, charging, casting, airborne or staggered
    if (isRolling(p, now) || p.guardUp || p.charging || p.casting || p.channel || now < (p.staggerUntil || 0) || now < (p.airUntil || 0)) continue;
    const ab = ABILITIES[id];
    if (p.st < (ab.st || 0)) continue;
    if (ab.kind === 'projectile' && isRunning(p, now)) continue;
    const spec = specOf(p, id, now, game);
    if (dist(p.x, p.z, m.x, m.z) > spec.range + RANGE_TOLERANCE) continue;
    castAbility(game, p, 0, m, null, now);
  }
}
