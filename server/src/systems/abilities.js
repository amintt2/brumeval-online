// [skilltree] Data-driven ability engine. Every ability of l'Arbre des Brumes (skilltree.json › abilities) and every
// variant / passive that modifies it runs through here, resolved per use by shared/skills.js resolveAbility()
// (variants → passives → Inaptitude → weapon → guardrails). Kinds:
//   melee (single target, or a cone with shape.arc / meleeArcDeg / arc) · projectile (count / spread, sequential hits,
//   pierce, splash, split, shatter, bounce) · aoe_self · aoe_target (delayed impact, persistent ground zones, lines,
//   rings) · self_heal (+ heal over time, group heal) · buff (stats, shields, mana shield) · debuff (mark) · dash
//   (leap, lunge, blink, sidestep, backflip) · channel (targeted hits, cone, circle, line, aimed release) · summon
//   (wisp, ice wall) · trap. Statuses: systems/status.js. Zones, walls, traps, summons: systems/zones.js.
// Costs (mana, stamina, hp), cooldowns, cast times, wind-ups and recoveries come from the resolved data; the
// existing combat rules (commitment, i-frames, poise, telegraphs, guard of the monsters) apply unchanged.
// Mechanics that are too exotic for v0.3 are approximated or ignored: see EXOTIC below (docs/EQUILIBRAGE.md).
import { ITEMS, ABILITIES } from '../../../shared/data.js';
import { S2C, FX, KIND } from '../../../shared/protocol.js';
import { inVillage } from '../../../shared/world.js';
import { resolveAbility, isItemEntry, stat, LOADOUT_SLOTS, WEAPON_NEED_TEXT, weaponTags } from '../../../shared/skills.js';
import { RANGE_TOLERANCE, MULTI_HIT_INTERVAL_MS } from '../config.js';
import { dist, isId, isInt, isNum, round2 } from '../util.js';
import { healPlayer } from './players.js';
import { spendStamina, applyRecovery, isRolling, isRunning } from './stamina.js';
import { hitMonster, damageMonster, monstersInRadius, attackFor, hitCond } from './combat.js';
import { applyStatus, detonate, froidStacks, isFrozen, consumeFroid, poisonStacks } from './status.js';
import { addBuff } from './buffs.js';
import { addZone, addWall, addTrap, setSummon, dashPlayer, pushMonster, baitMonsters, setZoneHooks } from './zones.js';
import { handleUseItem } from './items.js';
import { provoke, cancelTelegraphs, applyPoise } from './ai.js';
import { jumpAttack, isAirborne, handleCharge, cancelCharge } from './fundamentals.js';

const MELEE_SLACK = 0.8;           // extra reach when a delayed swing lands (the target may step back a little)
const DEFAULT_CAST_SLOW = 0.3;     // speed factor while casting
const TWO_PI = Math.PI * 2;

/**
 * Design mechanics that are approximated (✓ closest faithful version) or not simulated yet (✗) — listed in
 * docs/EQUILIBRAGE.md « Arbre des Brumes : mécaniques approchées ». Field names are the `mod` fields of skilltree.json.
 */
export const EXOTIC = {
  homing: '✓ les projectiles touchent toujours leur cible (pas de trajectoire courbe)',
  bounce: '✓ ricochet sur un second monstre proche (6 m), sans trajectoire',
  split: '✓ éclats répartis sur les monstres autour de l\'impact',
  pull: '✓ attraction instantanée vers le lanceur (sans animation serveur)',
  knockback: '✓ recul instantané de la cible',
  travel: '✗ mur de flammes mobile : reste une ligne fixe',
  drift: '✗ nuage rampant : reste fixe',
  orbit: '✗ éclats en orbite : partent comme une salve normale',
  turnRate: '✓ le rayon suit l\'orientation du joueur à chaque tic',
  decoy: '✗ leurre du Pas de brume',
  intercept: '✗ interception de projectiles par le feu follet',
  reflect: '✗ renvoi de dégâts du Bouclier miroir',
  reflectMelee: '✗ Bastion épineux (renvoi)',
  encase: '✓ Prison de glace : gel de la cible au lieu d\'un mur',
  thorns: '✗ épines du Mur hérissé',
  shatterBurst: '✗ explosion du Mur hérissé',
  aura: '✗ auras (Cri d\'effroi, Armure de l\'aurore)',
  alternate: '✗ alternance taille / pointe',
  finisher: '✓ tous les 3 coups : ×1,8 (Frappe) ; balayage final (Coup d\'épieu)',
  extendOnKill: '✗ prolongation de la Rage à chaque mort',
  onKill: '✗ effets à la mort d\'une cible',
  onBreak: '✗ explosion de l\'Égide brisée',
  absorbToMana: '✗ Égide de mana : conversion en mana non simulée',
  absorbOneHit: '✗ Carapace : absorption d’un coup non simulée',
  allyRadius: '✗ effets de groupe (pas encore de groupes)',
  allyFactor: '✗ effets de groupe (pas encore de groupes)',
  appliesToAllies: '✗ marque partagée avec le groupe (pas encore de groupes)',
  groupHeal: '✓ soigne aussi les joueurs proches',
  single: '✓ Défi : provoque la cible seule',
  mark: '✓ Défi : la cible provoquée est aussi marquée (+10 % de dégâts subis)',
  distanceMult: '✓ Bout portant : dégâts selon la distance',
  afterDodgeOrGuard: '✓ coup critique juste après une roulade ou un blocage',
  pattern: '✓ salve en éventail : les flèches visent les monstres autour de la cible',
  scatter: '✓ Pluie de météores : impacts répartis autour du point visé',
  spreadTime: '✓',
  fuse: '✓ boule collante : explose après le délai',
  ground: '✗ filet collant au sol',
  explode: '✓ appât piégé : explosion à la fin',
  onFixate: '✗ Appât sanglant : bonus de dégâts sur les bêtes fixées',
  onHit: '✗ Trait de brèche : effet à l’impact non simulé',
  onBleedBurst: '✗ effets à l’éclatement d’une hémorragie',
  bleedTakenMod: '✗ Marque de sang : saignement subi accru',
  bleedBuildMod: '✗ Hallali sanglant : saignement accru',
  slowPerStack: '✓ ralentissement par charge de poison',
  defPerStack: '✓ Venin corrosif : −5 % de défense par charge de poison',
  debuffCritTaken: '✓ Point faible : +15 % de chances de critique contre la cible du Brise-garde',
  addBlocked: '✗ Riposte vengeresse : ajout des dégâts bloqués',
  vsStaggered: '✓ Perce-cœur : ×1,6 et critique contre une cible déséquilibrée',
  interruptTele: '✓ annule une attaque télégraphiée non-boss en préparation',
  lastHit: '✓ dernier coup renforcé',
  slowSelf: '✗ Rempart de mana : ralentissement du lanceur',
  passDmg: '✗ Pas tranchant : dégâts au passage',
  arrivalBurst: '✓ explosion à l\'arrivée du Pas de brume',
  charges: '✗ charges multiples (Pas de brume redoublé : une seule charge)',
  enemyAtkSpeed: '✓ Brume étouffante : attaques plus lentes dans le nuage',
  freezeIfChilled: '✓ Nova glaciale : gèle les cibles déjà sous Froid',
  endFreeze: '✓ Œil du blizzard : gèle en fin de canalisation',
  spread: '✓ Embrasement contagieux : la brûlure se propage',
  detonateBleed: '✓ Hémorragie : fait éclater le saignement',
  everyNth: '✓ tous les N tirs : charge de poison',
  ignoreArmorWeight: '✗ pas encore de poids d’armure (objets v0.3)',
  wallHp: '✗ le Mur de glace n’a pas de PV : il dure 6 s',
  resFeu: '✗ aucun monstre n’inflige encore de feu (seuls les sorts « mag » comptent comme arcane)',
  resGivre: '✗ aucun monstre n’inflige encore de givre',
  resPoison: '✗ aucun monstre n’empoisonne encore',
  echoOnMap: '✗ affichage sur la carte : côté client',
  echoKeepOld: '✗ un seul écho de mort à la fois',
  echoMax: '✗ un seul écho de mort à la fois',
  redirectGroupDmg: '✗ pas encore de groupes',
  dotTakenDurPct: '✗ les monstres n’infligent pas encore de dégâts sur la durée',
  gatherHerbPct: '✗ récolte (métiers v0.3)',
  teleEarlyMarkedMs: '✗ affichage anticipé : côté client',
  dualWield: '✗ pas encore de main gauche',
};

// ------------------------------------------------------------------ resolution helpers
/** Resolved ability of player `p` right now (variants, passives, Inaptitude, weapon, conditions). */
export function specOf(p, id, now, game = null) {
  const cond = game ? hitCond(game, p, null, now) : (w) => condLight(p, w, now);
  return resolveAbility(p.tree, id, { weapon: p.eq.weapon, cond });
}
function condLight(p, w, now) {
  if (!w) return true;
  if (w.hpUnder !== undefined && !(p.hp / p.mhp < w.hpUnder)) return false;
  if (w.weaponFamily && !w.weaponFamily.includes(ITEMS[p.eq.weapon]?.family)) return false;
  if (w.offhand || w.grip || w.enemiesWithin8 !== undefined || w.enemiesWithin8Min !== undefined) return false;
  if (w.cond === 'weapon_bow' && !weaponTags(p.eq.weapon).includes('distance')) return false;
  if (w.cond === 'still_0.6s' && !(now - (p.lastMoveAt ?? -Infinity) >= 600)) return false;
  return true;
}

const channelDur = (spec) => {
  if (spec.channelMs) return spec.channelMs / 1000;
  if (spec.channel && typeof spec.channel === 'object') return spec.channel.dur || 1;
  if (typeof spec.channel === 'number') return spec.channel;
  return (spec.hits || 1) * (spec.interval || 0.3);
};
const powerSeqOf = (spec) => {
  if (Array.isArray(spec.powerSeq)) return spec.powerSeq;
  if (Array.isArray(spec.power)) return spec.power;
  return new Array(Math.max(1, spec.hits || 1)).fill(spec.power || 0);
};
const basePower = (spec) => (Array.isArray(spec.power) ? spec.power[0] : spec.power || 0);

/** Does this ability need a hostile target entity? */
export function needsTarget(spec) {
  if (spec.kind === 'melee' || spec.kind === 'projectile' || spec.kind === 'debuff') return !(spec.kind === 'melee' && spec.shape?.arc >= 180);
  if (spec.kind === 'channel') return !spec.shape && !(spec.channel && typeof spec.channel === 'object');
  return false;
}

// ------------------------------------------------------------------ C2S ability
/** C2S ability { slot: 0..7, tg?, x?, z?, ph? } */
export function handleAbility(game, p, msg) {
  if (!isInt(msg.slot, 0, LOADOUT_SLOTS - 1)) return game.error(p, 'bad_request', 'Capacité invalide.');
  if (p.dead) return game.error(p, 'dead', 'Vous êtes mort.');
  const slot = msg.slot;
  const entry = p.loadout[slot];
  if (!entry) return game.error(p, 'bad_request', 'Aucune compétence dans cet emplacement.');
  if (isItemEntry(entry)) return useBarItem(game, p, entry.slice(5));
  const id = entry;
  const now = game.now();
  if (!p.tree.unlocked.has(id)) return game.error(p, 'locked', 'Compétence non apprise.');
  if (msg.ph === 'start' || msg.ph === 'release') return handleCharge(game, p, slot, msg, now);
  const spec = specOf(p, id, now, game);
  let target = null;
  const tgValid = msg.tg !== undefined && msg.tg !== null && msg.tg !== 0;
  if (needsTarget(spec)) {
    if (!tgValid) return game.error(p, 'no_target', 'Aucune cible sélectionnée.');
    if (!isId(msg.tg)) return game.error(p, 'bad_request', 'Cible invalide.');
    const e = game.entities.get(msg.tg);
    if (!e) return game.error(p, 'no_target', 'Cible introuvable.');
    if (e.kind !== KIND.MONSTER) {
      return game.error(p, 'bad_target', e.kind === KIND.NPC ? 'Vous ne pouvez pas attaquer ce personnage.' : 'Vous ne pouvez pas attaquer un autre joueur.');
    }
    if (e.dead) return game.error(p, 'bad_target', 'Cette cible est déjà morte.');
    target = e;
  } else if (tgValid && isId(msg.tg)) {
    const e = game.monsters.get(msg.tg);
    if (e && !e.dead) target = e; // optional aim (aoe at the target, dash towards it…)
  }
  if (inVillage(p.x, p.z)) return game.error(p, 'safe_zone', 'Impossible de combattre dans le village');
  if (target) p.lastTargetId = target.id; // the wisp shoots at it
  // [combat-souls] no attacking in the middle of a dodge roll
  if (isRolling(p, now)) {
    if (target && slot === 0) p.autoTarget = target.id;
    return;
  }
  // [skilltree] base attack in the air = Attaque sautée
  if (spec.base && isAirborne(p, now)) return jumpAttack(game, p, slot, target, now);
  // Slot 0 (re)starts auto-attacking this target; any targeted ability switches an active auto-attack.
  if (target && needsTarget(spec) && (slot === 0 || p.autoTarget)) p.autoTarget = target.id;
  const err = castAbility(game, p, slot, target, msg, now);
  if (!err) return;
  if (slot === 0 && err.code === 'cooldown') return; // the auto-attack will swing as soon as it is ready
  // [combat-souls] ranged auto-attack while running: it fires once the player slows down (hint throttled)
  if (err.code === 'moving' || err.code === 'staggered') {
    if (now - (p.movingErrAt || -Infinity) < 3000) return;
    p.movingErrAt = now;
  }
  game.error(p, err.code, err.msg);
}

/** Bar slot holding a consumable: use the first stack of it. */
function useBarItem(game, p, itemId) {
  const idx = p.inv.findIndex((s) => s && s.id === itemId);
  if (idx < 0) return game.error(p, 'cant_use', `Plus de ${ITEMS[itemId]?.name || 'cet objet'} dans le sac.`);
  return handleUseItem(game, p, { slot: idx });
}

/**
 * Validate and use the ability of bar slot `slot`. Returns null on success or { code, msg } on refusal.
 * `point` carries optional x/z (ground target) and tg.
 */
export function castAbility(game, p, slot, target, point, now, override = null) {
  const id = p.loadout[slot];
  if (!id) return { code: 'bad_request', msg: 'Aucune compétence dans cet emplacement.' };
  const spec = override || specOf(p, id, now, game);
  if (!spec) return { code: 'bad_request', msg: 'Capacité inconnue.' };
  if (!spec.usable) return { code: 'no_weapon', msg: `Il faut ${WEAPON_NEED_TEXT[spec.need] || 'une autre arme'}.` };
  if (now < p.cdOf(id)) return { code: 'cooldown', msg: 'Capacité en recharge' };
  if (now < (p.staggerUntil || 0)) return { code: 'staggered', msg: 'Vous vacillez !' };
  if (p.casting || p.channel) return { code: 'busy', msg: 'Vous êtes déjà en train d\'incanter.' };
  if (p.charging) cancelCharge(game, p);

  let px = 0, pz = 0;
  if (target && needsTarget(spec)) {
    if (dist(p.x, p.z, target.x, target.z) > spec.range + RANGE_TOLERANCE) return { code: 'out_of_range', msg: 'Cible hors de portée' };
  } else if (spec.kind === 'aoe_target' && spec.at !== 'self') {
    if (isNum(point?.x) && isNum(point?.z)) {
      px = point.x; pz = point.z;
    } else if (target) {
      px = target.x; pz = target.z;
    } else {
      const e = isId(point?.tg) ? game.monsters.get(point.tg) : null;
      if (!e || e.dead) return { code: 'no_target', msg: 'Choisissez une zone cible.' };
      px = e.x; pz = e.z;
    }
    if (dist(p.x, p.z, px, pz) > spec.range + RANGE_TOLERANCE) return { code: 'out_of_range', msg: 'Zone hors de portée' };
  } else if (spec.kind === 'channel' && spec.shape === 'circle' && spec.at !== 'self') {
    if (isNum(point?.x) && isNum(point?.z)) { px = point.x; pz = point.z; } else if (target) { px = target.x; pz = target.z; } else { px = p.x + Math.sin(p.ry) * 6; pz = p.z + Math.cos(p.ry) * 6; }
    if (dist(p.x, p.z, px, pz) > (spec.range || 18) + RANGE_TOLERANCE) return { code: 'out_of_range', msg: 'Zone hors de portée' };
  } else if (isNum(point?.x) && isNum(point?.z)) {
    px = point.x; pz = point.z;
  } else if (target) {
    px = target.x; pz = target.z;
  } else {
    px = p.x + Math.sin(p.ry) * 5; pz = p.z + Math.cos(p.ry) * 5;
  }
  if (p.mp < (spec.mp || 0)) {
    // Pacte de la lune de sang (keystone): spells take the missing mana from the hp (never under floorPct %)
    const blood = stat(p.tree, 'bloodMagic');
    const hpCost = ((spec.mp || 0) - p.mp) * (blood?.hpPerMana || 1);
    if (!blood || !(spec.tags || []).includes('sort') || p.hp - hpCost < p.mhp * ((blood.floorPct || 10) / 100)) return { code: 'no_mana', msg: 'Pas assez de mana' };
  }
  // [combat-souls] stamina + no ranged auto-attack spam while running full speed
  if (p.st < (spec.st || 0)) return { code: 'no_stamina', msg: 'Pas assez d\'endurance' };
  if (spec.auto && spec.kind === 'projectile' && isRunning(p, now)) return { code: 'moving', msg: 'Ralentissez pour tirer' };
  if (spec.window && now - (p.lastBlockAt ?? -Infinity) > spec.window * 1000) return { code: 'riposte_window', msg: 'La Riposte suit un coup bloqué.' };
  if (id === 'bond_de_retrait' && now < (p.rollUntil || 0) + 500) return { code: 'cooldown', msg: 'Pas juste après une roulade.' };
  // [skilltree] Élan (sprint variant): the base attack after 0.8 s of sprint becomes an Assault
  let sp = spec;
  if (spec.base) sp = assaultOf(game, p, spec, target, now) || spec;
  // Au plus près (Tir): at point-blank range the shot becomes two knife cuts
  if (spec.melee_under && target && dist(p.x, p.z, target.x, target.z) <= spec.melee_under.dist) {
    sp = { ...sp, kind: 'melee', range: spec.melee_under.dist, powerSeq: spec.melee_under.power, poise: spec.melee_under.poise ?? sp.poise, tags: [...(sp.tags || []).filter((t) => t !== 'projectile'), 'melee', 'dague'] };
  }
  p.guardUp = false; // attacking lowers the guard (the client raises it again)
  const ctx = { slot, id, target, x: px, z: pz, point };
  if ((sp.cast || 0) > 0) {
    startCast(game, p, sp, ctx, now);
    return null;
  }
  pay(game, p, sp, ctx, now);
  execute(game, p, sp, ctx, now);
  return null;
}

/** Élan: after sprinting minSprintMs, the base attack leaps `lunge` metres towards the target, stronger. */
function assaultOf(game, p, spec, target, now) {
  if (!p.sprintReq || !p.tree.unlocked.has('sprint')) return null;
  const sprint = specOf(p, 'sprint', now);
  const a = sprint.assault;
  if (!a || !p.sprintSince || now - p.sprintSince < (a.minSprintMs || 800) || !target) return null;
  const out = { ...spec };
  out.range = (spec.range || 2.8) + (a.lunge || 3);
  out.power = basePower(spec) * (a.powerMult || 1.4);
  out.poise = (spec.poise || 0) + (a.poiseAdd || 25);
  out.st = (spec.st || 0) + (a.stAdd || 10);
  out.rec = a.rec ?? spec.rec;
  out.assault = a;
  return out;
}

/** Pay the costs, start the cooldown (every bar slot holding the ability gets its `cd`), recovery. */
export function pay(game, p, spec, ctx, now) {
  const id = ctx.id;
  const cdMs = typeof spec.cd === 'number' ? Math.round(spec.cd * 1000) : 0;
  if (cdMs > 0) p.cds.set(id, now + cdMs);
  spendStamina(p, spec.st || 0, now); // [combat-souls]
  applyRecovery(p, spec, now); // [combat-souls] attack commitment
  if (spec.mp > 0) {
    const missing = Math.max(0, spec.mp - p.mp);
    if (missing > 0) {
      // Pacte de la lune de sang: the rest is paid with hp (checked in castAbility)
      p.hp = Math.max(1, p.hp - missing * (stat(p.tree, 'bloodMagic')?.hpPerMana || 1));
      p.markDirty('hp');
    }
    p.mp = Math.max(0, p.mp - spec.mp);
    p.markDirty('mp');
  }
  if (spec.hpCost > 0 && !p.dead) {
    p.hp = Math.max(1, p.hp - p.hp * spec.hpCost); // never lethal
    p.markDirty('hp');
  }
  if (cdMs > 0) {
    p.loadout.forEach((v, i) => { if (v === id) game.send(p, { t: S2C.CD, slot: i, ms: cdMs, ab: id }); });
  }
  p.lastAbilityAt = now;
}

// ------------------------------------------------------------------ casting (pre-cast: nothing is spent before it ends)
function startCast(game, p, spec, ctx, now) {
  const ms = Math.round(spec.cast * 1000);
  p.casting = { id: ctx.id, spec, ctx, until: now + ms, slow: spec.castSlow ?? DEFAULT_CAST_SLOW };
  if (ctx.target) p.ry = Math.atan2(ctx.target.x - p.x, ctx.target.z - p.z);
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.CHANNEL, src: p.id, ab: ctx.id, ms });
}

/** Cancel a cast (roll, stagger, death): nothing was spent. */
export function cancelCast(game, p) {
  if (!p.casting) return false;
  const id = p.casting.id;
  p.casting = null;
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.CHANNEL_END, src: p.id, ab: id });
  return true;
}

function finishCast(game, p, now) {
  const c = p.casting;
  p.casting = null;
  const { spec, ctx } = c;
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.CHANNEL_END, src: p.id, ab: ctx.id });
  if (p.dead) return;
  const t = ctx.target;
  if (t && needsTarget(spec)) {
    if (t.dead || !game.entities.has(t.id) || dist(p.x, p.z, t.x, t.z) > spec.range + RANGE_TOLERANCE + 2) {
      return game.error(p, 'out_of_range', 'Cible perdue');
    }
  }
  if (p.mp < (spec.mp || 0)) return game.error(p, 'no_mana', 'Pas assez de mana');
  if (p.st < (spec.st || 0)) return game.error(p, 'no_stamina', 'Pas assez d\'endurance');
  pay(game, p, spec, ctx, now);
  execute(game, p, spec, ctx, now);
}

/** Per tick: casts that end, channels, summons (called by the game loop). */
export function updateAbilities(game, now) {
  for (const p of game.players.values()) {
    if (p.dead) {
      p.casting = null;
      p.channel = null;
      continue;
    }
    if (p.casting && now >= p.casting.until) finishCast(game, p, now);
    if (p.channel) tickChannel(game, p, now);
  }
}

// ------------------------------------------------------------------ execution
/** Run an ability (costs already paid). The wind-up delays the impact (the swing / aim is visible). */
export function execute(game, p, spec, ctx, now) {
  const delay = Math.round((spec.windup || 0) * 1000);
  const t = ctx.target;
  if (t) p.ry = Math.atan2(t.x - p.x, t.z - p.z);
  else if (spec.kind === 'aoe_target' || spec.kind === 'dash') p.ry = Math.atan2(ctx.x - p.x, ctx.z - p.z);
  const run = () => {
    if (p.dead || game.players.get(p.id) !== p) return;
    runKind(game, p, spec, ctx, game.now());
  };
  if (spec.kind === 'melee') {
    game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.SWING, src: p.id, tg: t ? t.id : 0, ab: ctx.id, ms: delay });
  } else if (spec.kind !== 'aoe_self' && spec.kind !== 'dash' && spec.kind !== 'self_heal' && spec.kind !== 'buff') {
    game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.CAST, src: p.id, ab: ctx.id });
  }
  if (delay > 0) game.schedule(delay, run);
  else run();
}

function runKind(game, p, spec, ctx, now) {
  switch (spec.kind) {
    case 'melee': return meleeAbility(game, p, spec, ctx, now);
    case 'projectile': return projectileAbility(game, p, spec, ctx, now);
    case 'aoe_self': return aoeSelf(game, p, spec, ctx, now);
    case 'aoe_target': case 'aoe_line': return aoeTarget(game, p, spec, ctx, now);
    case 'self_heal': return selfHeal(game, p, spec, ctx, now);
    case 'buff': return buffAbility(game, p, spec, ctx, now);
    case 'debuff': return debuffAbility(game, p, spec, ctx, now);
    case 'dash': return dashAbility(game, p, spec, ctx, now);
    case 'channel': return startChannel(game, p, spec, ctx, now);
    case 'summon': case 'control': return summonAbility(game, p, spec, ctx, now);
    case 'trap': return trapAbility(game, p, spec, ctx, now);
    default: return null;
  }
}

const liveTarget = (game, m) => m && !m.dead && !m.invulnerable && game.monsters.get(m.id) === m;

// ---- geometry
function angDiff(a, b) {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d < -Math.PI) d += TWO_PI;
  return d;
}
/** Monsters inside a cone (apex x,z, facing a, radius r, full opening arcDeg degrees). */
export function monstersInCone(game, x, z, a, r, arcDeg) {
  const half = (arcDeg * Math.PI) / 360;
  return monstersInRadius(game, x, z, r).filter((m) => {
    const d = dist(x, z, m.x, m.z);
    if (d <= m.radius + 0.3) return true;
    const tol = Math.asin(Math.min(1, m.radius / d));
    return Math.abs(angDiff(a, Math.atan2(m.x - x, m.z - z))) <= half + tol;
  });
}
/** Monsters inside a line (origin x,z, direction a, length len, width w). */
export function monstersInLine(game, x, z, a, len, w) {
  const fx = Math.sin(a), fz = Math.cos(a);
  return monstersInRadius(game, x + (fx * len) / 2, z + (fz * len) / 2, len / 2 + w).filter((m) => {
    const dx = m.x - x, dz = m.z - z;
    const along = dx * fx + dz * fz;
    const side = Math.abs(dx * fz - dz * fx);
    return along >= -m.radius && along <= len + m.radius && side <= w / 2 + m.radius;
  }).sort((u, v) => dist(x, z, u.x, u.z) - dist(x, z, v.x, v.z));
}
/** Monsters in a ring (outer r, inner r2). */
function monstersInRing(game, x, z, r, r2) {
  return monstersInRadius(game, x, z, r).filter((m) => dist(x, z, m.x, m.z) + m.radius >= r2);
}

// ---- statuses and on-hit effects
/**
 * Everything a hit applies after its damage (statuses, wounds, poison, bleed gauge, slows, CC, debuffs, pull).
 * `dmg` = damage of the hit (0 if it did not land).
 */
export function onHitEffects(game, p, m, spec, dmg, now) {
  if (!liveTarget(game, m)) return;
  const tree = p.tree;
  const s = (n) => stat(tree, n);
  const dur = (id, d) => d + s(`statusDurS.${id}`);
  const every = (key, n) => {
    p.everyCount ||= new Map();
    const c = (p.everyCount.get(key) || 0) + 1;
    p.everyCount.set(key, c);
    return c % n === 0;
  };
  const burnMax = stat(tree, 'statusMaxStacks.brulure') || 1; // Cœur de braise: burns stack (3)
  for (const a of spec.applies || []) {
    const e = typeof a === 'string' ? { id: a } : a;
    if (e.every && !every(`${spec.id}:${e.id}`, e.every)) continue;
    switch (e.id) {
      case 'brulure': applyStatus(game, m, p, 'brulure', { hit: dmg, dur: dur('brulure', e.dur ?? 3), max: burnMax }); break;
      case 'froid': applyStatus(game, m, p, 'froid', { stacks: e.stacks ?? 1, dur: dur('froid', e.dur ?? 3), toGel: stat(tree, 'froidToGel') || null }); break;
      case 'marque': applyStatus(game, m, p, 'marque', { pct: e.dmgTakenPct ?? 0.12, dur: e.dur ?? 6 }); break;
      case 'saignement': applyStatus(game, m, p, 'bleedBuild', { add: 20 * (1 + s('bleedBuildPct')), hit: dmg }); break;
      default: applyStatus(game, m, p, e.id, { dur: e.dur, stacks: e.stacks }); break;
    }
  }
  if (spec.dot && dmg > 0) {
    const d = spec.dot;
    if (d.type === 'brulure') applyStatus(game, m, p, 'brulure', { hit: dmg, pct: d.total, dur: d.dur });
    else applyStatus(game, m, p, 'saignement', { hit: dmg, total: d.total * (1 + s('dmgPct.saignement')), dur: d.dur });
  }
  if (spec.bleedBuild) applyStatus(game, m, p, 'bleedBuild', { add: spec.bleedBuild * (1 + s('bleedBuildPct')), hit: dmg });
  const maxPoison = stat(tree, 'poisonMaxStacks') || spec.poison?.maxStacks || 3;
  if (spec.poison) {
    applyStatus(game, m, p, 'poison', { stacks: 1, atk: attackFor(p, spec), perStackPerS: (spec.poison.perStackPerS ?? 0.25) * (1 + s('poisonTickPct') + s('dmgPct.poison')), dur: spec.poison.dur ?? 6, max: maxPoison });
    if (spec.slowPerStack) applyStatus(game, m, p, 'slow', { pct: spec.slowPerStack * poisonStacks(m, now), dur: 3 });
  }
  if (spec.poisonStacks > 0) applyStatus(game, m, p, 'poison', { stacks: spec.poisonStacks, atk: attackFor(p, spec), perStackPerS: 0.25 * (1 + s('poisonTickPct')), dur: 6, max: maxPoison });
  if (spec.everyNth?.poisonStacks && every(`${spec.id}:nth`, spec.everyNth.n || 3)) {
    applyStatus(game, m, p, 'poison', { stacks: spec.everyNth.poisonStacks, atk: attackFor(p, spec), dur: 6, max: maxPoison });
  }
  if (spec.slow && typeof spec.slow === 'object' && spec.kind !== 'trap') applyStatus(game, m, p, 'slow', { pct: spec.slow.pct, dur: spec.slow.dur ?? 3 });
  if (spec.root > 0 && spec.kind !== 'trap') applyStatus(game, m, p, 'enracine', { dur: spec.root });
  if (spec.stun > 0) applyStatus(game, m, p, 'etourdi', { dur: spec.stun });
  if (spec.debuff) applyStatus(game, m, p, 'debuff', { ...spec.debuff, critTaken: spec.debuffCritTaken || 0 });
  if (spec.defPerStack && m.status) m.status.poisonDefPct = spec.defPerStack;
  // Hémorragie (Entaille): the wounds already open burst at once (×1.3 of what remains)
  if (spec.detonateBleed && dmg > 0) {
    const rest = detonate(m, now, 'saignement');
    if (rest > 0) damageMonster(game, m, p, Math.round(rest * spec.detonateBleed), false, 'saignement', 0);
  }
  if (spec.knockback > 0) pushMonster(game, m, p.x, p.z, spec.knockback);
  if (spec.pull > 0) pushMonster(game, m, p.x, p.z, -spec.pull);
  const eb = p.buffs?.get('enchant_blade');
  if (eb && now < eb.until && (spec.tags || []).includes('melee')) {
    if (eb.dot?.type === 'brulure') applyStatus(game, m, p, 'brulure', { hit: dmg, pct: eb.dot.total, dur: eb.dot.dur });
    if (eb.slowPerHit) applyStatus(game, m, p, 'froid', { stacks: 1, dur: eb.slowPerHit.dur || 3, max: eb.slowPerHit.maxStacks || 2 });
  }
  // interruptions: Coup de bouclier (light attacks), Flèche d'arrêt (non-boss telegraphs), Filet (charges)
  const winding = m.act?.kind === 'attack' && m.act.phase === 'windup';
  if (winding && !m.boss) {
    const k = m.act.atk.kind;
    const interrupt = ((spec.tags || []).includes('interruption') && k === 'melee')
      || (spec.interruptTele && k === 'tele')
      || (spec.id === 'filet' && k === 'tele' && m.act.atk.dash);
    if (interrupt) {
      cancelTelegraphs(game, m);
      m.dash = null;
      m.act = { kind: 'stagger', until: now + 700 };
      game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.STAGGER, src: m.id, ms: 700 });
    }
  }
}

/** Hit + effects in one call. Returns the damage. */
function strike(game, p, m, power, spec, now, opts = {}) {
  if (!liveTarget(game, m)) return 0;
  let pw = power;
  let poise = opts.poise ?? spec.poise;
  // Fracas (Lance de glace): ×1.6 on a frozen / chilled (2+) target, consumes the cold
  if (spec.shatter && (isFrozen(m, now) || froidStacks(m, now) >= (spec.shatter.minStacks || 2))) {
    pw *= spec.shatter.mult || 1.6;
    consumeFroid(m);
  }
  // Flèche assommante: +50 % poise on a monster in the middle of a wind-up
  if (spec.teleBonusPoise && m.act?.kind === 'attack' && m.act.phase === 'windup' && (!m.boss || spec.teleBonusPoiseBoss)) {
    poise *= 1 + spec.teleBonusPoise * (m.boss ? spec.teleBonusPoiseBoss || 0 : 1);
  }
  // Perce-cœur (Trait fatal) against a staggered target
  let s2 = spec;
  if (spec.vsStaggered && m.act?.kind === 'stagger') {
    pw *= spec.vsStaggered.mult || 1.6;
    if (spec.vsStaggered.crit) s2 = { ...spec, guaranteedCrit: true };
  }
  // Bout portant (Tir): damage by distance
  if (Array.isArray(spec.distanceMult)) {
    const d = dist(p.x, p.z, m.x, m.z);
    for (const b of spec.distanceMult) if ((b.max === undefined || d <= b.max) && (b.min === undefined || d >= b.min)) pw *= b.mult;
  }
  // Riposte au couteau: critical right after a roll or a block
  if (spec.afterDodgeOrGuard) {
    const w = spec.afterDodgeOrGuard.windowMs || 400;
    if (now - (p.rollStartAt ?? -Infinity) <= (p.rollMs || 550) + w || now - (p.lastBlockAt ?? -Infinity) <= w) {
      s2 = { ...s2, guaranteedCrit: !!spec.afterDodgeOrGuard.crit };
      poise += spec.afterDodgeOrGuard.poiseAdd || 0;
    }
  }
  const dmg = hitMonster(game, p, m, pw, spec.id, s2, { poise, noRiposte: opts.noRiposte });
  if (dmg > 0 && !opts.noEffects) onHitEffects(game, p, m, spec, dmg, now);
  return dmg;
}

// ---- melee
function meleeAbility(game, p, spec, ctx, now) {
  const t = ctx.target;
  const arc = spec.shape?.arc ?? spec.meleeArcDeg ?? spec.arc;
  const r = spec.shape?.r ?? spec.range;
  const face = t ? Math.atan2(t.x - p.x, t.z - p.z) : p.ry;
  const seq = powerSeqOf(spec);
  // Troisième temps (Frappe): every 3rd base attack within the window hits harder
  let fin = null;
  if (spec.finisher?.every) {
    p.finisher ||= { n: 0, at: -Infinity };
    if (now - p.finisher.at > (spec.finisher.window || 2) * 1000) p.finisher.n = 0;
    p.finisher.n++;
    p.finisher.at = now;
    if (p.finisher.n % spec.finisher.every === 0) fin = spec.finisher;
  }
  seq.forEach((pw0, i) => {
    const go = () => {
      if (p.dead) return;
      const n = game.now();
      let targets;
      if (arc) targets = monstersInCone(game, p.x, p.z, face, r + 0.3, arc);
      else targets = liveTarget(game, t) && dist(p.x, p.z, t.x, t.z) <= spec.range + RANGE_TOLERANCE + MELEE_SLACK ? [t] : [];
      let pw = pw0;
      let poise = spec.poise;
      if (fin) { pw *= fin.mult || 1.8; poise += fin.poise || 0; }
      if (spec.lastHit && i === seq.length - 1) { pw = spec.lastHit.power ?? pw; poise = spec.lastHit.poise ?? poise; }
      for (const m of targets) strike(game, p, m, pw, spec, n, { poise, noRiposte: i > 0 });
    };
    if (i === 0) go();
    else game.schedule(i * 150, go);
  });
  if (spec.hopBack > 0) {
    const a = face + Math.PI;
    dashPlayer(game, p, p.x + Math.sin(a) * spec.hopBack, p.z + Math.cos(a) * spec.hopBack, 200, { iframeMs: spec.iframeMs || 0, ab: spec.id });
  }
  if (spec.dash > 0 && t) { // Charge au bouclier: rush to the target first (the hit above already landed at arrival range)
    dashPlayer(game, p, t.x - Math.sin(face) * (t.radius + 0.6), t.z - Math.cos(face) * (t.radius + 0.6), 250, { ab: spec.id });
  }
}

// ---- projectiles
function projectileAbility(game, p, spec, ctx, now) {
  const t = ctx.target;
  if (!t) return;
  // Onde tranchante « Croissant »: a cone instead of a projectile
  if (spec.shape?.cone) {
    const a = Math.atan2(t.x - p.x, t.z - p.z);
    for (const m of monstersInCone(game, p.x, p.z, a, spec.shape.r || spec.range, spec.shape.cone)) strike(game, p, m, basePower(spec), spec, now);
    game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.AOE, src: p.id, x: round2(p.x), z: round2(p.z), r: spec.shape.r || spec.range, ab: spec.id });
    return;
  }
  const hits = spec.hits > 1 && !spec.shots ? spec.hits : 1;
  const gap = spec.id === 'arcane_shards' ? 90 : MULTI_HIT_INTERVAL_MS;
  for (let i = 0; i < hits; i++) {
    const fire = () => {
      if (p.dead || game.players.get(p.id) !== p || !liveTarget(game, t)) return;
      fireVolley(game, p, spec, t, basePower(spec), i > 0);
    };
    if (i === 0) fire();
    else game.schedule(i * gap, fire);
  }
}

/** One volley: `projCount` / `projectiles` arrows in a fan (one per target), each resolved at arrival. */
export function fireVolley(game, p, spec, t, power, later = false) {
  const count = Math.max(1, spec.projCount || spec.projectiles || 1);
  const targets = [t];
  if (count > 1) {
    const a = Math.atan2(t.x - p.x, t.z - p.z);
    const others = monstersInCone(game, p.x, p.z, a, spec.range || 20, Math.max(20, (spec.spreadDeg || 20) * 2))
      .filter((m) => m !== t).sort((u, v) => dist(p.x, p.z, u.x, u.z) - dist(p.x, p.z, v.x, v.z));
    for (const m of others) { if (targets.length >= count) break; targets.push(m); }
  }
  const each = spec.powerEach ? power * spec.powerEach : power;
  for (const m of targets) launch(game, p, spec, m, each, later);
}

function launch(game, p, spec, m, power, later) {
  const d = dist(p.x, p.z, m.x, m.z);
  const ms = Math.max(30, Math.round((d / (spec.speed || 20)) * 1000));
  p.ry = Math.atan2(m.x - p.x, m.z - p.z);
  const ox = p.x, oz = p.z;
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.PROJ, src: p.id, tg: m.id, ab: spec.id, ms });
  game.schedule(ms, () => {
    // lands only if the target is still alive and the caster still online
    if (!liveTarget(game, m) || game.players.get(p.id) !== p) return;
    const now = game.now();
    const fuse = spec.fuse > 0 && !spec.splash;
    const land = () => {
      if (!liveTarget(game, m) || game.players.get(p.id) !== p) return;
      const n = game.now();
      strike(game, p, m, power, spec, n, { noRiposte: later });
      // pierce: the next monsters along the line (pierceFalloff: -x per extra target)
      const pierce = spec.pierce === true ? 99 : spec.pierce || 0;
      if (pierce > 0) {
        const a = Math.atan2(m.x - ox, m.z - oz);
        const line = monstersInLine(game, ox, oz, a, spec.range || 20, 1.2).filter((x) => x !== m && dist(ox, oz, x.x, x.z) > dist(ox, oz, m.x, m.z) - 0.5);
        let k = 1;
        for (const x of line.slice(0, pierce)) strike(game, p, x, power * Math.max(0.2, 1 - (spec.pierceFalloff || 0) * k++), spec, n, { noRiposte: true });
      }
      if (spec.splash) {
        game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.AOE, src: p.id, x: round2(m.x), z: round2(m.z), r: spec.splash.radius, ab: spec.id });
        for (const x of monstersInRadius(game, m.x, m.z, spec.splash.radius)) if (x !== m) strike(game, p, x, power * (spec.splash.pct || 0.5), spec, n, { noRiposte: true });
      }
      if (spec.split) {
        const others = monstersInRadius(game, m.x, m.z, spec.split.radius || 3).filter((x) => x !== m).slice(0, spec.split.count || 3);
        for (const x of others) strike(game, p, x, spec.split.power || 0.5, spec, n, { noRiposte: true, noEffects: true });
      }
      if (spec.bounce?.count) {
        const next = monstersInRadius(game, m.x, m.z, spec.bounce.range || 6).find((x) => x !== m);
        if (next) strike(game, p, next, power * (spec.bounce.power || 0.5), spec, n, { noRiposte: true });
      }
    };
    if (fuse) game.schedule(Math.round(spec.fuse * 1000), land);
    else land();
    void now;
  });
}

// ---- areas around the caster
function aoeSelf(game, p, spec, ctx, now) {
  const r = spec.radius || 4;
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.AOE, src: p.id, x: round2(p.x), z: round2(p.z), r, ab: spec.id });
  // Provocation / Défi: monsters switch to the caster after their current attack (never a cancelled telegraph)
  if (spec.id === 'taunt') {
    const list = spec.single ? (ctx.target ? [ctx.target] : []) : monstersInRadius(game, p.x, p.z, r);
    for (const m of list) {
      taunt(game, p, m, now, (spec.single?.dur || spec.dur || 4) * (m.boss ? 0.5 : 1));
      // Défi: the challenged monster also takes more damage
      if (spec.mark) applyStatus(game, m, p, 'marque', { pct: spec.mark.dmgTakenPct || 0.1, dur: spec.single?.dur || 6 });
    }
    if (spec.buff) addBuff(game, p, 'taunt', (spec.dur || 4) * 1000, { stats: numericStats(spec.buff) });
    return;
  }
  const list = monstersInRadius(game, p.x, p.z, r);
  // Fléau: every poison in range bursts (150 % of what remains), + bleed, 1 stack spreads
  if (spec.id === 'fleau') {
    let healed = 0;
    for (const m of list) {
      const rest = detonate(m, now, 'poison');
      if (rest > 0) {
        const v = Math.round(rest * (spec.detonate || 1.5));
        damageMonster(game, m, p, v, false, spec.id, spec.poise);
        healed += v * (spec.lifesteal || 0);
        applyStatus(game, m, p, 'bleedBuild', { add: spec.bleedAdd || 50, hit: v });
        for (const o of monstersInRadius(game, m.x, m.z, spec.spreadR || 4)) {
          if (o !== m) applyStatus(game, o, p, 'poison', { stacks: 1, atk: attackFor(p, spec), dur: 6 });
        }
      }
    }
    if (healed > 0) healPlayer(game, p, Math.round(healed), spec.id);
    return;
  }
  for (const m of list) {
    if (spec.freezeIfChilled && froidStacks(m, now) > 0) applyStatus(game, m, p, 'gel', { dur: 1 });
    if ((basePower(spec) || 0) > 0) strike(game, p, m, basePower(spec), spec, now);
    else onHitEffects(game, p, m, spec, 0, now);
  }
}

function taunt(game, p, m, now, s) {
  if (m.dead) return;
  let top = 0;
  for (const v of m.threat.values()) top = Math.max(top, v);
  m.threat.set(p.id, top + 1 + (m.threat.get(p.id) || 0) * 0);
  if (m.ai !== 'chase') provoke(game, m, p, now);
  m.target = p.id;
  m.tauntUntil = now + s * 1000;
  m.tauntBy = p.id;
}

// ---- ground areas
function aoeTarget(game, p, spec, ctx, now) {
  let x = ctx.x, z = ctx.z;
  if (spec.at === 'self') { x = p.x; z = p.z; }
  const a = Math.atan2(x - p.x, z - p.z);
  const shape = shapeOf(spec, x, z, a, p);
  // Appât: beasts fixate on the bait
  if (spec.id === 'appat') {
    baitMonsters(game, p, x, z, spec, now);
    return;
  }
  const delay = Math.round((spec.delay || 0) * 1000 + (spec.id === 'meteor' ? 0 : 0));
  const count = Math.max(1, spec.count || 1);
  for (let i = 0; i < count; i++) {
    let sx = shape.x, sz = shape.z;
    if (count > 1 && spec.scatter) {
      const ang = (i / count) * TWO_PI + (game.rng() - 0.5);
      const rr = game.rng() * spec.scatter;
      sx += Math.sin(ang) * rr; sz += Math.cos(ang) * rr;
    }
    const sh = { ...shape, x: sx, z: sz };
    const extra = count > 1 && spec.spreadTime ? Math.round((spec.spreadTime * 1000 * i) / count) : 0;
    const persistent = (spec.duration > 0 && (spec.tick > 0 || spec.ticks > 0 || spec.poisonPerS)) || spec.id === 'nuage_toxique';
    if (persistent) {
      addZone(game, p, spec, sh, { delay: delay + extra, now });
    } else {
      // single impact, optionally telegraphed (visible to everyone: FX zone)
      if (delay + extra > 0) addZone(game, p, spec, sh, { delay: delay + extra, now, impactOnly: true });
      const hit = () => areaImpact(game, p, spec, sh, game.now());
      if (delay + extra > 0) game.schedule(delay + extra, hit);
      else hit();
    }
  }
}

/** Shape of a ground ability: circle (radius), line (len × wid, across the aim), ring (Cercle de feu). */
function shapeOf(spec, x, z, a, p) {
  if (spec.shape === 'line' || spec.kind === 'aoe_line') {
    if (spec.kind === 'aoe_line') return { shape: 'line', x: p.x, z: p.z, a, len: spec.range || 18, w: spec.wid || 1.5 };
    const across = a + Math.PI / 2;
    const len = spec.len || 7;
    return { shape: 'line', x: x - (Math.sin(across) * len) / 2, z: z - (Math.cos(across) * len) / 2, a: across, len, w: spec.wid || 1.5 };
  }
  if (spec.shape === 'ring') return { shape: 'ring', x, z, r: spec.radius || 3, r2: Math.max(0, (spec.radius || 3) - 1.2) };
  return { shape: 'circle', x, z, r: spec.radius || 3 };
}

export function monstersInShape(game, sh) {
  switch (sh.shape) {
    case 'line': return monstersInLine(game, sh.x, sh.z, sh.a, sh.len, sh.w);
    case 'ring': return monstersInRing(game, sh.x, sh.z, sh.r, sh.r2);
    case 'cone': return monstersInCone(game, sh.x, sh.z, sh.a, sh.r, sh.arc);
    default: return monstersInRadius(game, sh.x, sh.z, sh.r);
  }
}

/** One impact of a ground ability (also each tick of a persistent zone). */
export function areaImpact(game, p, spec, sh, now, tickPower = null) {
  if (game.players.get(p.id) !== p) return;
  if (!tickPower) game.broadcastNear(sh.x, sh.z, { t: S2C.FX, k: FX.AOE, src: p.id, x: round2(sh.x), z: round2(sh.z), r: sh.r || sh.len || 3, ab: spec.id });
  for (const m of monstersInShape(game, sh)) {
    if (spec.detonate && spec.id === 'ignite') {
      const rest = detonate(m, now, 'brulure');
      strike(game, p, m, basePower(spec), spec, now);
      if (rest > 0) damageMonster(game, m, p, Math.round(rest * spec.detonate), false, spec.id, 0);
      if (spec.spread?.radius) for (const o of monstersInRadius(game, m.x, m.z, spec.spread.radius)) if (o !== m) applyStatus(game, o, p, 'brulure', { hit: rest || 10 });
      continue;
    }
    const pw = tickPower ?? basePower(spec);
    if (pw > 0) strike(game, p, m, pw, spec, now, { noRiposte: !!tickPower });
    else onHitEffects(game, p, m, spec, 0, now);
  }
  if (spec.groundBurn && !tickPower) {
    addZone(game, p, { ...spec, power: spec.groundBurn.power, tick: spec.groundBurn.tick || 0.5, duration: spec.groundBurn.duration || 3, poise: 0 }, sh, { now });
  }
}

// ---- heals, buffs, marks
function selfHeal(game, p, spec, ctx, now) {
  const mult = 1 + stat(p.tree, 'healReceivedPct');
  if (spec.heal > 0) healPlayer(game, p, Math.round(p.mhp * spec.heal * mult), spec.id);
  if (spec.stRestore > 0) { p.st = Math.min(p.mst, p.st + spec.stRestore); p.markDirty('st'); }
  if (spec.hot?.pct > 0) {
    const ticks = Math.max(1, Math.round(spec.hot.dur || 5));
    const per = Math.round((p.mhp * spec.hot.pct * mult) / ticks);
    for (let i = 1; i <= ticks; i++) game.schedule(i * 1000, () => { if (!p.dead && game.players.get(p.id) === p) healPlayer(game, p, per, spec.id); });
  }
  if (spec.groupHeal) {
    const r = spec.groupHeal.r || spec.groupHeal.radius || 8;
    for (const o of game.players.values()) {
      if (o === p || o.dead || dist(p.x, p.z, o.x, o.z) > r) continue;
      healPlayer(game, o, Math.round(o.mhp * (spec.groupHeal.pct || 0.15)), spec.id);
    }
  }
  void ctx; void now;
}

const BUFF_STATS = ['defPct', 'dmgPct', 'attackSpeedPct', 'dmgTakenPct', 'speedPct'];
function numericStats(b) {
  const out = {};
  for (const k of BUFF_STATS) if (typeof b?.[k] === 'number') out[k] = b[k];
  return out;
}

function buffAbility(game, p, spec, ctx, now) {
  const ms = Math.round((spec.dur ?? spec.duration ?? 6) * 1000);
  const b = spec.buff || {};
  const data = { stats: numericStats(b), flags: {} };
  if (b.noRoll) data.flags.noRoll = true;
  if (b.meleeBonusDmg) { data.meleeBonusDmg = b.meleeBonusDmg; data.element = spec.element || b.element; }
  if (spec.manaPerHit) data.manaPerHit = spec.manaPerHit;
  if (spec.dot) data.dot = spec.dot;
  if (spec.slowPerHit) data.slowPerHit = spec.slowPerHit;
  if (b.meleeAttackerFroid) data.meleeAttackerFroid = b.meleeAttackerFroid;
  if (typeof b.critAdd === 'number') data.critAdd = b.critAdd;
  if (spec.shield) data.shieldHp = Math.round((spec.shield.hpPct || 0) * p.mhp + (spec.shield.mpPct || 0) * p.mmp);
  if (spec.absorb > 0) { data.absorb = spec.absorb; data.manaPerDmg = spec.manaPerDmg || 1.5; }
  if (spec.effects) Object.assign(data, spec.effects);
  addBuff(game, p, spec.id, ms, data);
  void ctx; void now;
}

function debuffAbility(game, p, spec, ctx, now) {
  const t = ctx.target;
  if (!liveTarget(game, t)) return;
  applyStatus(game, t, p, 'marque', { pct: spec.dmgTakenFromYou ?? 0.15, dur: spec.duration ?? 15 });
  // a mark makes the monster notice you
  if (t.ai !== 'chase') provoke(game, t, p, now);
}

// ---- movement abilities
function dashAbility(game, p, spec, ctx, now) {
  const t = ctx.target;
  let a = t ? Math.atan2(t.x - p.x, t.z - p.z) : Math.atan2(ctx.x - p.x, ctx.z - p.z);
  if (!Number.isFinite(a)) a = p.ry;
  let d = spec.range || 4;
  if (spec.id === 'coup_epieu' && ITEMS[p.eq.weapon]?.family === 'lance') d += spec.weaponBonus?.lance_reach || 0;
  if (spec.id === 'bond_de_retrait') a += spec.direction === 'any' ? 0 : Math.PI;
  if (spec.id === 'sidestep') a += Math.PI / 2;
  if (spec.id === 'leap_slam' && t) d = Math.min(d, Math.max(0, dist(p.x, p.z, t.x, t.z) - (t.radius + 0.5)));
  if (spec.id === 'lunge' || spec.id === 'coup_epieu') {
    if (t) d = Math.min(d, Math.max(0, dist(p.x, p.z, t.x, t.z) - (t.radius + 0.5)));
  }
  const ms = Math.round(((spec.airborne || spec.dash || spec.dur || (spec.id === 'blink' ? 0 : 0.25)) || 0) * 1000);
  const fromX = p.x, fromZ = p.z;
  const opts = { ab: spec.id, iframeMs: spec.iframeMs ?? (spec.iframe ? spec.iframe * 1000 : 0), airborne: !!spec.airborne };
  dashPlayer(game, p, p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, ms, opts, (x, z) => {
    const n = game.now();
    switch (spec.id) {
      case 'leap_slam':
        game.broadcastNear(x, z, { t: S2C.FX, k: FX.AOE, src: p.id, x: round2(x), z: round2(z), r: spec.radius || 3, ab: spec.id });
        for (const m of monstersInRadius(game, x, z, spec.radius || 3)) strike(game, p, m, basePower(spec), spec, n);
        break;
      case 'lunge':
      case 'coup_epieu': {
        const hits = Math.max(1, spec.hits || 1);
        const line = monstersInLine(game, fromX, fromZ, a, dist(fromX, fromZ, x, z) + (spec.line?.len ? 1.5 : 2.2), spec.line?.wid || 1.2);
        for (let i = 0; i < hits; i++) for (const m of line) strike(game, p, m, basePower(spec), spec, n, { noRiposte: i > 0 });
        if (spec.finisher?.arc) for (const m of monstersInCone(game, x, z, a, spec.finisher.radius || 3, spec.finisher.arc)) if (!line.includes(m)) strike(game, p, m, basePower(spec), spec, n, { noRiposte: true });
        break;
      }
      case 'sidestep':
        addBuff(game, p, 'sidestep', (spec.nextHitCrit || 1.5) * 1000, {});
        break;
      case 'bond_de_retrait':
        if (basePower(spec) > 0 && liveTarget(game, t)) fireVolley(game, p, { ...spec, speed: 34, range: 20 }, t, basePower(spec), true);
        break;
      case 'blink':
        if (spec.arrivalBurst) for (const m of monstersInRadius(game, x, z, spec.arrivalBurst.radius || 2.5)) strike(game, p, m, spec.arrivalBurst.power || 0.6, { ...spec, poise: spec.arrivalBurst.poise || 12 }, n);
        break;
      default:
        if (basePower(spec) > 0 && liveTarget(game, t) && dist(x, z, t.x, t.z) <= 3 + t.radius) strike(game, p, t, basePower(spec), spec, n);
    }
  });
}

// ---- channels
function startChannel(game, p, spec, ctx, now) {
  const durS = channelDur(spec);
  const obj = spec.channel && typeof spec.channel === 'object' ? spec.channel : null;
  const hits = spec.hits || 0;
  const tick = spec.tick || spec.interval || (hits > 0 ? durS / hits : 0);
  p.channel = {
    id: ctx.id, spec, ctx, start: now, until: now + durS * 1000, tickMs: Math.round(tick * 1000), next: now,
    ticks: 0, maxTicks: hits > 0 ? hits : tick > 0 ? Math.round(durS / tick) : 0,
    mpPerS: spec.mpPerS || 0, stPerS: obj?.stPerS ?? spec.stPerS ?? 0,
    slow: obj?.moveMult ?? spec.moveWhileChannel ?? spec.moveDuring ?? 0.3,
    x: ctx.x, z: ctx.z,
  };
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.CHANNEL, src: p.id, ab: ctx.id, ms: Math.round(durS * 1000) });
  if (spec.shape === 'circle' && spec.at !== 'self') {
    game.broadcastNear(ctx.x, ctx.z, { t: S2C.FX, k: FX.ZONE, id: 0, src: p.id, ab: ctx.id, shape: 'circle', x: round2(ctx.x), z: round2(ctx.z), r: spec.radius || 5, ms: Math.round(durS * 1000) });
  }
  tickChannel(game, p, now);
}

/** Stop the channel (released key, roll, stagger, no mana). `refund` = part of the mana given back (Trait fatal). */
export function stopChannel(game, p, reason = 'stop') {
  const c = p.channel;
  if (!c) return false;
  p.channel = null;
  if (reason === 'roll' && c.spec.id === 'trait_fatal' && c.spec.mp > 0) {
    p.mp = Math.min(p.mmp, p.mp + c.spec.mp * 0.5);
    p.markDirty('mp');
  }
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.CHANNEL_END, src: p.id, ab: c.id });
  return true;
}

function tickChannel(game, p, now) {
  const c = p.channel;
  const spec = c.spec;
  // drains
  const dt = Math.max(0, now - (c.drainAt ?? now)) / 1000;
  c.drainAt = now;
  if (dt > 0 && (c.mpPerS || c.stPerS)) {
    const mp = c.mpPerS * dt, st = c.stPerS * dt;
    if (p.mp < mp || p.st < st) return stopChannel(game, p, 'empty');
    if (mp) { p.mp -= mp; p.markDirty('mp'); }
    if (st) spendStamina(p, st, now);
  }
  // aimed release (Trait fatal): nothing until the end
  if (c.maxTicks === 0) {
    if (now < c.until) return;
    stopChannel(game, p, 'done');
    const t = c.ctx.target;
    if (!liveTarget(game, t)) return;
    const a = Math.atan2(t.x - p.x, t.z - p.z);
    const pierce = spec.pierce === true ? 99 : spec.pierce || 0;
    const line = monstersInLine(game, p.x, p.z, a, spec.range || 30, 1.4).slice(0, 1 + pierce);
    game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.PROJ, src: p.id, tg: t.id, ab: spec.id, ms: Math.round((dist(p.x, p.z, t.x, t.z) / (spec.speed || 60)) * 1000) });
    if (!line.includes(t)) line.unshift(t);
    for (const m of line) strike(game, p, m, basePower(spec), spec, now);
    return;
  }
  while (p.channel === c && now >= c.next && c.ticks < c.maxTicks) {
    c.ticks++;
    c.next += c.tickMs;
    channelTick(game, p, c, now);
  }
  if (p.channel === c && (now >= c.until || c.ticks >= c.maxTicks)) {
    stopChannel(game, p, 'done');
    if (spec.endFreeze && spec.shape === 'circle') {
      for (const m of monstersInRadius(game, c.x, c.z, spec.radius || 5)) if (froidStacks(m, now) >= (spec.endFreeze.minStacks || 3)) applyStatus(game, m, p, 'gel', { dur: spec.endFreeze.dur || 1 });
    }
  }
}

function channelTick(game, p, c, now) {
  const spec = c.spec;
  const t = c.ctx.target;
  const pw = basePower(spec);
  if (spec.shape === 'cone') {
    const r = spec.radius || 6;
    for (const m of monstersInCone(game, p.x, p.z, p.ry, r, spec.arc || 70)) strike(game, p, m, pw, spec, now, { noRiposte: true });
    return;
  }
  if (spec.shape === 'circle') {
    const x = spec.at === 'self' ? p.x : c.x, z = spec.at === 'self' ? p.z : c.z;
    for (const m of monstersInRadius(game, x, z, spec.radius || 5)) strike(game, p, m, pw, spec, now, { noRiposte: true });
    return;
  }
  if (spec.shape === 'line') {
    const a = t && liveTarget(game, t) ? Math.atan2(t.x - p.x, t.z - p.z) : p.ry;
    p.ry = a;
    for (const m of monstersInLine(game, p.x, p.z, a, spec.range || 18, spec.wid || 1.2)) strike(game, p, m, pw, spec, now, { noRiposte: true });
    return;
  }
  // whirlwind (Tourbillon ambulant): hits around the caster
  if (spec.radius && !t) {
    game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.AOE, src: p.id, x: round2(p.x), z: round2(p.z), r: spec.radius, ab: spec.id });
    for (const m of monstersInRadius(game, p.x, p.z, spec.radius)) strike(game, p, m, pw, spec, now, { noRiposte: true });
    return;
  }
  if (!liveTarget(game, t)) return stopChannel(game, p, 'target');
  const last = c.ticks === c.maxTicks;
  if ((spec.tags || []).includes('projectile')) {
    if (dist(p.x, p.z, t.x, t.z) > (spec.range || 20) + RANGE_TOLERANCE + 2) return stopChannel(game, p, 'range');
    if (spec.pattern === 'fan30') fireVolley(game, p, { ...spec, projCount: 3, spreadDeg: 30 }, t, pw, c.ticks > 1);
    else fireVolley(game, p, spec, t, pw, c.ticks > 1);
    return;
  }
  // melee channel (Danse des lames)
  if (dist(p.x, p.z, t.x, t.z) > (spec.range || 2.8) + RANGE_TOLERANCE + MELEE_SLACK) return;
  let power = pw, poise = spec.poise;
  if (last && spec.lastHit) { power = spec.lastHit.power ?? power; poise = spec.lastHit.poise ?? poise; }
  p.ry = Math.atan2(t.x - p.x, t.z - p.z);
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.SWING, src: p.id, tg: t.id, ab: spec.id });
  strike(game, p, t, power, spec, now, { poise, noRiposte: c.ticks > 1 });
}

// ---- summons, walls, traps
function summonAbility(game, p, spec, ctx, now) {
  if (spec.id === 'wisp') {
    setSummon(game, p, spec, now);
    return;
  }
  if (spec.id === 'ice_wall') {
    if (spec.kind === 'control') {
      // Prison de glace: the target (non-boss) is encased (frozen) instead of a wall
      const t = ctx.target || monstersInRadius(game, ctx.x, ctx.z, 3)[0];
      if (t && !t.boss) applyStatus(game, t, p, 'gel', { dur: spec.encase || 2.5 });
      return;
    }
    const a = Math.atan2(ctx.x - p.x, ctx.z - p.z);
    const d = Math.min(spec.range || 10, Math.max(2, dist(p.x, p.z, ctx.x, ctx.z)));
    addWall(game, p, spec, p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, a + Math.PI / 2, now);
  }
}

function trapAbility(game, p, spec, ctx, now) {
  const a = p.ry;
  const d = Math.min(spec.range || 3, 1.5);
  addTrap(game, p, spec, p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, now);
  void ctx;
}

/** Poise of a hit on a monster from a tree mechanic (parry). */
export function poiseHit(game, m, poise, now) {
  return applyPoise(game, m, poise, now);
}

export { ABILITIES };

// zones / traps / summons resolve their hits with the same pipeline
setZoneHooks({ areaImpact, monstersInShape, strike });
export { strike };
