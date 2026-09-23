// Player abilities, auto-attack, damage to monsters, monster deaths (XP / loot / quest credit).
import { ABILITIES, QUESTS, NPCS, computeDamage, monsterXp } from '../../../shared/data.js';
import { S2C, FX, KIND, CORPSE_TIME_S } from '../../../shared/protocol.js';
import { inVillage } from '../../../shared/world.js';
import { RANGE_TOLERANCE, MULTI_HIT_INTERVAL_MS } from '../config.js';
import { recordKill, killLabel } from '../quests.js';
import { dist, isId, isInt, isNum, randInt, round2 } from '../util.js';
import { grantXp, giveItem, giveGold, healPlayer } from './players.js';
import { aoiOf } from '../aoi.js'; // [netcode-perf]

const TARGETED = new Set(['melee', 'projectile']);

/** C2S ability { slot, tg?, x?, z? } */
export function handleAbility(game, p, msg) {
  if (!isInt(msg.slot, 0, 3)) return game.error(p, 'bad_request', 'Capacité invalide.');
  if (p.dead) return game.error(p, 'dead', 'Vous êtes mort.');
  const slot = msg.slot;
  const ab = ABILITIES[p.abilities[slot]];
  let target = null;
  if (TARGETED.has(ab.kind)) {
    if (msg.tg === undefined || msg.tg === null || msg.tg === 0) return game.error(p, 'no_target', 'Aucune cible sélectionnée.');
    if (!isId(msg.tg)) return game.error(p, 'bad_request', 'Cible invalide.');
    const e = game.entities.get(msg.tg);
    if (!e) return game.error(p, 'no_target', 'Cible introuvable.');
    if (e.kind !== KIND.MONSTER) {
      return game.error(p, 'bad_target', e.kind === KIND.NPC ? 'Vous ne pouvez pas attaquer ce personnage.' : 'Vous ne pouvez pas attaquer un autre joueur.');
    }
    if (e.dead) return game.error(p, 'bad_target', 'Cette cible est déjà morte.');
    target = e;
  }
  if (inVillage(p.x, p.z)) return game.error(p, 'safe_zone', 'Impossible de combattre dans le village');
  // Slot 0 (re)starts auto-attacking this target; any targeted ability switches an active auto-attack.
  if (target && (slot === 0 || p.autoTarget)) p.autoTarget = target.id;
  const err = castAbility(game, p, slot, target, msg, game.now());
  if (!err) return;
  if (slot === 0 && err.code === 'cooldown') return; // the auto-attack will swing as soon as it is ready
  game.error(p, err.code, err.msg);
}

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
 * Validate and execute ability `slot`. Returns null on success or { code, msg } on refusal.
 * `point` carries optional x/z (ground target) and tg.
 */
export function castAbility(game, p, slot, target, point, now) {
  const abId = p.abilities[slot];
  const ab = ABILITIES[abId];
  if (now < p.cooldowns[slot]) return { code: 'cooldown', msg: 'Capacité en recharge' };

  let px = 0, pz = 0;
  if (target) {
    if (dist(p.x, p.z, target.x, target.z) > ab.range + RANGE_TOLERANCE) return { code: 'out_of_range', msg: 'Cible hors de portée' };
  } else if (ab.kind === 'aoe_target') {
    if (isNum(point?.x) && isNum(point?.z)) {
      px = point.x; pz = point.z;
    } else {
      const e = isId(point?.tg) ? game.monsters.get(point.tg) : null;
      if (!e || e.dead) return { code: 'no_target', msg: 'Choisissez une zone cible.' };
      px = e.x; pz = e.z;
    }
    if (dist(p.x, p.z, px, pz) > ab.range + RANGE_TOLERANCE) return { code: 'out_of_range', msg: 'Zone hors de portée' };
  }
  if (p.mp < ab.mp) return { code: 'no_mana', msg: 'Pas assez de mana' };

  // --- pay & start cooldown
  p.cooldowns[slot] = now + ab.cd * 1000;
  if (ab.mp > 0) {
    p.mp -= ab.mp;
    p.markDirty('mp');
  }
  game.send(p, { t: S2C.CD, slot, ms: Math.round(ab.cd * 1000) });

  switch (ab.kind) {
    case 'melee':
      game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.SWING, src: p.id, tg: target.id, ab: abId });
      p.ry = Math.atan2(target.x - p.x, target.z - p.z);
      hitMonster(game, p, target, ab.power, abId);
      break;
    case 'projectile': {
      game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.CAST, src: p.id, ab: abId });
      fireProjectile(game, p, target, ab, abId);
      for (let i = 1; i < (ab.hits || 1); i++) {
        game.schedule(i * MULTI_HIT_INTERVAL_MS, () => {
          if (p.dead || game.players.get(p.id) !== p || target.dead || !game.entities.has(target.id)) return;
          fireProjectile(game, p, target, ab, abId);
        });
      }
      break;
    }
    case 'aoe_self': {
      game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.AOE, src: p.id, x: round2(p.x), z: round2(p.z), r: ab.radius, ab: abId });
      for (const m of monstersInRadius(game, p.x, p.z, ab.radius)) {
        hitMonster(game, p, m, ab.power, abId);
        if (ab.slow && !m.dead && !m.invulnerable) m.slowUntil = now + ab.slow.dur * 1000;
      }
      break;
    }
    case 'aoe_target': {
      game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.CAST, src: p.id, ab: abId });
      game.broadcastNear(px, pz, { t: S2C.FX, k: FX.AOE, src: p.id, x: round2(px), z: round2(pz), r: ab.radius, ab: abId });
      p.ry = Math.atan2(px - p.x, pz - p.z);
      for (const m of monstersInRadius(game, px, pz, ab.radius)) hitMonster(game, p, m, ab.power, abId);
      break;
    }
    case 'self_heal':
      healPlayer(game, p, Math.round(p.mhp * ab.heal), abId);
      break;
    default:
      break;
  }
  return null;
}

function fireProjectile(game, p, target, ab, abId) {
  const d = dist(p.x, p.z, target.x, target.z);
  const ms = Math.max(30, Math.round((d / ab.speed) * 1000));
  p.ry = Math.atan2(target.x - p.x, target.z - p.z);
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.PROJ, src: p.id, tg: target.id, ab: abId, ms });
  game.schedule(ms, () => {
    // lands only if the target is still alive and the caster still online
    if (target.dead || !game.entities.has(target.id) || game.players.get(p.id) !== p) return;
    hitMonster(game, p, target, ab.power, abId);
  });
}

/** Roll damage for player `p` hitting monster `m` with `power`. */
export function hitMonster(game, p, m, power, abId) {
  const { amount, crit } = computeDamage(p.stats.atk, power, m.defense, p.stats.crit, game.rng(), game.rng());
  return damageMonster(game, m, p, amount, crit, abId);
}

/** Apply damage to a monster (threat, aggro, death). Returns false if ignored (dead / leashing). */
export function damageMonster(game, m, attacker, amount, crit, abId) {
  if (m.dead || m.invulnerable) return false;
  const now = game.now();
  m.hp -= amount;
  m.lastCombat = now;
  attacker.lastCombat = now;
  m.threat.set(attacker.id, (m.threat.get(attacker.id) || 0) + amount);
  const msg = { t: S2C.DMG, src: attacker.id, tg: m.id, v: amount, crit: !!crit, hp: m.hp <= 0 ? 0 : Math.max(1, Math.ceil(m.hp)) };
  if (abId) msg.ab = abId;
  game.broadcastNear(m.x, m.z, msg);
  if (m.hp <= 0) {
    killMonster(game, m);
    return true;
  }
  if (m.ai !== 'chase') {
    m.ai = 'chase';
    m.target = attacker.id;
    m.atkReady = Math.max(m.atkReady, now + 400);
    if (m.def.slam) m.slamReady = now + m.def.slam.cd * 1000;
  }
  return true;
}

/** Monster death: XP to every damager, gold + drops to the top damage dealer, quest credit, corpse, respawn. */
export function killMonster(game, m) {
  const now = game.now();
  m.dead = true;
  m.hp = 0;
  m.deadAt = now;
  m.ai = 'dead';
  m.target = 0;
  m.slowUntil = 0;

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
    grantXp(game, p, monsterXp(m.type, m.level, p.level));
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
    giveGold(game, killer, randInt(game.rng, gMin, gMax));
    for (const drop of m.def.drops || []) if (game.rng() < drop.ch) giveItem(game, killer, drop.id, 1);
  }
  game.store?.markDirty();

  game.schedule(CORPSE_TIME_S * 1000, () => game.removeEntity(m));
  game.schedule(m.def.respawn * 1000, () => game.spawnMonster(m.zone));
}

/** Server-side auto-attack: swing slot 0 whenever it is ready and the target in range. */
export function updateAutoAttacks(game, now) {
  for (const p of game.players.values()) {
    if (!p.autoTarget) continue;
    if (p.dead) { p.autoTarget = 0; continue; }
    const m = game.entities.get(p.autoTarget);
    if (!m || m.kind !== KIND.MONSTER || m.dead) { p.autoTarget = 0; continue; }
    if (now < p.cooldowns[0] || m.invulnerable || inVillage(p.x, p.z)) continue;
    const ab = ABILITIES[p.abilities[0]];
    if (dist(p.x, p.z, m.x, m.z) > ab.range + RANGE_TOLERANCE) continue;
    castAbility(game, p, 0, m, null, now);
  }
}
