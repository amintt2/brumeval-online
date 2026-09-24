// Game data + pure formulas shared by server (authoritative) and client (UI, tooltips, prediction).
// All player-facing text is French.
import TREE from './skilltree.js'; // [skilltree]

export const GAME_TITLE = 'Brumeval Online';
export const MAX_LEVEL = 30; // [skilltree] v0.3: 20 → 30 (docs/design/ARBRE_COMPETENCES.md §3.1)
export const INV_SIZE = 24;
export const START_GOLD = 25;

/**
 * XP needed to go from `level` to `level + 1` (0 at max level). Unchanged up to level 20 (v0.2 saves keep their
 * progress); [skilltree] levels 20 → 30 cost 10 % more per level above 19 (×1.1 at 20 … ×2.0 at 29).
 */
export function xpToNext(level) {
  if (level >= MAX_LEVEL) return 0;
  const base = 100 * Math.pow(level, 1.5);
  return Math.floor(level < 20 ? base : base * (1 + 0.1 * (level - 19)));
}

// ------------------------------------------------------------------ classes
export const CLASSES = {
  warrior: {
    name: 'Guerrier', model: 'warrior', color: '#c0392b',
    desc: 'Combattant au corps à corps, robuste et redoutable.',
    hp: 130, hpLvl: 18, mp: 40, mpLvl: 4, atk: 11, atkLvl: 2.2, def: 4, defLvl: 1.2, crit: 0.08, speed: 6.5,
    abilities: ['strike', 'heavy_blow', 'whirlwind', 'war_cry'], // v0.2 bar (migration mapping, character screen)
    base: 'strike', // [skilltree] level 1: only the base attack
    start: { weapon: 'rusty_sword', armor: 'leather_tunic', items: [['potion_hp_s', 3]] },
  },
  mage: {
    name: 'Mage', model: 'mage', color: '#2e6fd8',
    desc: 'Maître des arcanes : sorts puissants à distance, mais fragile.',
    hp: 85, hpLvl: 11, mp: 95, mpLvl: 12, atk: 9, atkLvl: 2.7, def: 2, defLvl: 0.7, crit: 0.1, speed: 6.3,
    abilities: ['firebolt', 'fireball', 'frost_nova', 'heal'],
    base: 'firebolt',
    start: { weapon: 'apprentice_staff', armor: 'leather_tunic', items: [['potion_hp_s', 2], ['potion_mp_s', 2]] },
  },
  ranger: {
    name: 'Rôdeur', model: 'ranger', color: '#2e9e4f',
    desc: 'Archer agile qui frappe de loin avec précision.',
    hp: 100, hpLvl: 14, mp: 80, mpLvl: 7, atk: 10, atkLvl: 2.3, def: 3, defLvl: 0.9, crit: 0.15, speed: 6.8,
    abilities: ['shot', 'piercing_shot', 'arrow_rain', 'rapid_fire'],
    base: 'shot',
    start: { weapon: 'short_bow', armor: 'leather_tunic', items: [['potion_hp_s', 3]] },
  },
};

// ------------------------------------------------------------------ abilities
// [skilltree] v0.3: the 65 abilities of l'Arbre des Brumes (shared/skilltree.js, generated from
// docs/design/skilltree.json). The 12 v0.2 abilities keep their id. Base values only: what a given character really
// casts is resolveAbility() in shared/skills.js (variants, passives, Inaptitude, weapon).
// kind: melee | projectile | aoe_self | aoe_target | self_heal | buff | debuff | dash | channel | summon | trap |
//       toggle | jump | guard | charge. power = multiplier on attacker atk; range/radius in metres; cd in seconds;
//   st = stamina cost · rec / recSlow = recovery (attack commitment) · poise = poise damage (docs/EQUILIBRAGE.md).
export const ABILITIES = Object.fromEntries(TREE.abilities.map((a) => [a.id, a]));

// ------------------------------------------------------------------ monsters
// level: [min, max]; stats grow per level above 1. aggro/leash/range in metres. respawn in seconds.
// drops: chance per kill (0..1). model = GLB key. scale applied by the client. radius = collision radius.
export const MONSTERS = {
  slime: {
    name: 'Gluant', model: 'slime', level: [1, 3], radius: 0.5, scale: 1,
    hp: 40, hpLvl: 12, atk: 5, atkLvl: 1.5, def: 1, defLvl: 0.5, speed: 3.2,
    aggro: 0, range: 1.8, atkCd: 1.8, leash: 22, xp: 20, xpLvl: 6, respawn: 12, gold: [1, 4],
    drops: [{ id: 'slime_gel', ch: 0.5 }, { id: 'potion_hp_s', ch: 0.08 }],
  },
  wolf: {
    name: 'Loup gris', model: 'wolf', level: [3, 6], radius: 0.6, scale: 1,
    hp: 70, hpLvl: 15, atk: 9, atkLvl: 2, def: 3, defLvl: 1, speed: 5.4,
    aggro: 10, range: 2.0, atkCd: 1.6, leash: 26, xp: 30, xpLvl: 8, respawn: 15, gold: [2, 7],
    drops: [{ id: 'wolf_pelt', ch: 0.45 }, { id: 'potion_hp_s', ch: 0.1 }],
  },
  goblin: {
    name: 'Gobelin', model: 'goblin', level: [5, 8], radius: 0.5, scale: 1,
    hp: 95, hpLvl: 18, atk: 12, atkLvl: 2.5, def: 5, defLvl: 1.2, speed: 5.0,
    aggro: 11, range: 2.2, atkCd: 1.5, leash: 26, xp: 45, xpLvl: 10, respawn: 18, gold: [4, 12],
    drops: [{ id: 'goblin_trinket', ch: 0.4 }, { id: 'potion_hp_s', ch: 0.12 }, { id: 'potion_mp_s', ch: 0.08 }, { id: 'chainmail', ch: 0.02 }],
  },
  skeleton: {
    name: 'Squelette', model: 'skeleton', level: [8, 11], radius: 0.5, scale: 1,
    hp: 140, hpLvl: 22, atk: 17, atkLvl: 3, def: 8, defLvl: 1.5, speed: 4.6,
    aggro: 12, range: 2.3, atkCd: 1.7, leash: 28, xp: 60, xpLvl: 10, respawn: 20, gold: [6, 18],
    drops: [{ id: 'ancient_bone', ch: 0.45 }, { id: 'potion_hp_l', ch: 0.08 }, { id: 'steel_sword', ch: 0.02 }, { id: 'arcane_staff', ch: 0.02 }, { id: 'long_bow', ch: 0.02 }],
  },
  golem: {
    name: 'Golem ancien', model: 'golem', level: [14, 14], radius: 1.4, scale: 1, boss: true,
    hp: 3000, hpLvl: 0, atk: 46, atkLvl: 0, def: 20, defLvl: 0, speed: 3.6,
    aggro: 14, range: 3.4, atkCd: 2.2, leash: 30, xp: 1500, xpLvl: 0, respawn: 180, gold: [120, 220],
    drops: [{ id: 'golem_core', ch: 1 }, { id: 'runeblade', ch: 0.25 }, { id: 'ember_staff', ch: 0.25 }, { id: 'elven_bow', ch: 0.25 }, { id: 'golem_plate', ch: 0.2 }],
  },
};

// [combat-souls] Monster AI (server/src/systems/ai/): archetype, attacks and variants.
//   arch: 'brute' | 'rusher' | 'skirmisher' | 'ranged' | 'caster' | 'pack' | 'boss' | 'hopper'
//   poise: poise damage that staggers the monster · notice: [min, max] ms of the alert phase (facing the player)
//   run: speed multiplier while closing a gap (Run clip) · pref: [min, max] preferred distance to the target
//   flee: hp fraction under which cautious individuals run away for a while · pack: howl calls allies
//   guard: { reduce, arc } frontal damage reduction while not attacking
//   attacks[]: id, kind ('melee' | 'tele' | 'proj' | 'howl' | 'heal'), min/max distance to pick it, cd (s),
//     w (base weight), power (× atk), windup (ms until impact), rec (ms of recovery after — punish window),
//     tele: shape ('circle' | 'cone' | 'line' | 'ring'), at ('self' | 'target' | 'front'), r, r2, arc, len, wid,
//           dash (charge to the end of the line), leap (land on the circle), count (several at once)
//     proj: speed (m/s), hitR (radius at the landing point), lead (0..1 aim ahead of a moving target)
//     clip: animation played on the attacker (synced by the client), phase: minimum boss phase, next: combo
//   variants[]: { key, ch (chance), name?, hp?, atk?, speed? (multipliers), ai (overrides) } — same model.
export const ELITE = { ch: 0.05, hp: 1.8, atk: 1.3, xp: 1.5, gold: 2, drops: 2, prefix: 'Élite' };
const MONSTER_AI = {
  slime: {
    ai: {
      arch: 'hopper', poise: 16, notice: [300, 700], run: 1.1, pref: [0, 1.6], flee: 0,
      attacks: [
        { id: 'slime_hit', kind: 'melee', max: 1.8, cd: 1.8, w: 3, power: 1, windup: 420, rec: 350 },
        { id: 'slime_slam', kind: 'tele', shape: 'circle', at: 'target', r: 2.2, min: 2.2, max: 6, cd: 7, w: 2, power: 1.6, windup: 950, rec: 700, leap: true, clip: 'Attack2' },
      ],
    },
  },
  wolf: {
    speed: 5.8,
    ai: {
      arch: 'rusher', pack: true, poise: 24, notice: [150, 450], run: 1.3, pref: [0, 2], flee: 0.18,
      attacks: [
        { id: 'wolf_bite', kind: 'melee', max: 2.0, cd: 1.5, w: 3, power: 1, windup: 330, rec: 300 },
        { id: 'wolf_lunge', kind: 'tele', shape: 'line', at: 'front', len: 7.5, wid: 1.6, min: 3.2, max: 7.5, cd: 5.5, w: 2.2, power: 1.35, windup: 700, rec: 650, dash: true, clip: 'Attack2' },
        { id: 'wolf_howl', kind: 'howl', r: 22, min: 0, max: 30, cd: 30, w: 4, windup: 900, once: true, clip: 'Attack2' },
      ],
    },
  },
  goblin: {
    ai: {
      arch: 'skirmisher', poise: 28, notice: [200, 550], run: 1.2, pref: [1.5, 3.5], flee: 0.2,
      attacks: [
        { id: 'goblin_slash', kind: 'melee', max: 2.2, cd: 1.4, w: 3, power: 1, windup: 340, rec: 280 },
        { id: 'goblin_leap', kind: 'tele', shape: 'cone', at: 'front', r: 3.6, arc: 1.6, min: 1.5, max: 4.5, cd: 6, w: 1.6, power: 1.5, windup: 750, rec: 600, clip: 'Attack2' },
      ],
    },
    variants: [
      { key: 'skirmisher', ch: 0.6 },
      {
        key: 'thrower', ch: 0.4, name: 'Gobelin lanceur', hp: 0.8, atk: 0.95,
        ai: {
          arch: 'ranged', pref: [8, 14], flee: 0.25, run: 1.1,
          attacks: [
            { id: 'goblin_spear', kind: 'proj', min: 4, max: 17, cd: 2.4, w: 3, power: 1.1, windup: 520, rec: 350, speed: 17, hitR: 0.95, lead: 0.35, clip: 'Shoot' },
            { id: 'goblin_stab', kind: 'melee', max: 2.0, cd: 1.6, w: 1, power: 0.8, windup: 360, rec: 300 },
          ],
        },
      },
    ],
  },
  skeleton: {
    speed: 4.2,
    ai: {
      arch: 'brute', poise: 44, notice: [300, 700], run: 1.15, pref: [0, 2.2], flee: 0,
      guard: { reduce: 0.4, arc: 2.0 },
      attacks: [
        { id: 'skel_swing', kind: 'melee', max: 2.3, cd: 1.9, w: 3, power: 1, windup: 450, rec: 400 },
        { id: 'skel_overhead', kind: 'tele', shape: 'cone', at: 'front', r: 3.8, arc: 1.2, min: 0, max: 3.6, cd: 5.5, w: 2, power: 2.0, windup: 1000, rec: 900, clip: 'Attack2' },
      ],
    },
    variants: [
      { key: 'brute', ch: 0.8 },
      {
        key: 'occultist', ch: 0.2, name: 'Squelette occultiste', hp: 0.75, atk: 0.9,
        ai: {
          arch: 'caster', pref: [7, 12], guard: null, flee: 0, poise: 30,
          attacks: [
            { id: 'skel_curse', kind: 'tele', mag: true, shape: 'circle', at: 'target', r: 2.6, min: 3, max: 16, cd: 4.5, w: 3, power: 1.3, windup: 1150, rec: 500, clip: 'Attack2' },
            { id: 'skel_mend', kind: 'heal', min: 0, max: 30, cd: 9, w: 5, heal: 0.2, r: 14, windup: 700, rec: 300 },
            { id: 'skel_swing', kind: 'melee', max: 2.1, cd: 2.0, w: 1, power: 0.8, windup: 450, rec: 400 },
          ],
        },
      },
    ],
  },
  golem: {
    ai: {
      arch: 'boss', poise: 150, notice: [500, 500], run: 1, pref: [0, 3.2], flee: 0, leash: 26,
      phases: [0.66, 0.3],
      attacks: [
        { id: 'golem_punch', kind: 'melee', max: 3.4, cd: 2.2, w: 3, power: 1, windup: 600, rec: 500 },
        { id: 'golem_slam', kind: 'tele', shape: 'circle', at: 'self', r: 5.5, min: 0, max: 5, cd: 8, w: 2.2, power: 1.6, windup: 1100, rec: 900, clip: 'Attack2' },
        { id: 'golem_stomp', kind: 'tele', lo: true, shape: 'ring', at: 'self', r: 10, r2: 4.2, min: 3.5, max: 10, cd: 10, w: 2, power: 1.4, windup: 1250, rec: 800, clip: 'Attack2' },
        { id: 'golem_rock', kind: 'tele', shape: 'line', at: 'front', len: 20, wid: 2.4, min: 6, max: 22, cd: 6, w: 2.6, power: 1.35, windup: 1300, rec: 600, phase: 2, count: 2, clip: 'Attack2' },
        { id: 'golem_sweep', kind: 'tele', lo: true, shape: 'cone', at: 'front', r: 6.5, arc: 2.3, min: 0, max: 6, cd: 7, w: 1.8, power: 1.3, windup: 900, rec: 700, phase: 2, clip: 'Attack2' },
        { id: 'golem_quake', kind: 'tele', nb: true, shape: 'circle', at: 'self', r: 6.5, min: 0, max: 9, cd: 12, w: 2.5, power: 1.7, windup: 1000, rec: 300, phase: 3, next: 'golem_stomp', clip: 'Special' },
      ],
    },
  },
};
for (const [type, v] of Object.entries(MONSTER_AI)) Object.assign(MONSTERS[type], v);

// ------------------------------------------------------------------ items
// type: 'consumable' | 'weapon' | 'armor' | 'junk'. icon = /icons/<icon>.png. price = buy price, sell = sell price.
// cls = allowed classes (omitted = all). lvl = required level. rarity: common | uncommon | rare | epic.
export const ITEMS = {
  potion_hp_s: { name: 'Petite potion de soin', type: 'consumable', icon: 'potion_hp_s', heal: 60, stack: 20, price: 10, sell: 2, rarity: 'common', desc: 'Rend 60 PV.' },
  potion_hp_l: { name: 'Grande potion de soin', type: 'consumable', icon: 'potion_hp_l', heal: 220, stack: 20, price: 45, sell: 10, rarity: 'uncommon', desc: 'Rend 220 PV.' },
  potion_mp_s: { name: 'Potion de mana', type: 'consumable', icon: 'potion_mp_s', mana: 70, stack: 20, price: 15, sell: 3, rarity: 'common', desc: 'Rend 70 points de mana.' },

  slime_gel: { name: 'Gelée de gluant', type: 'junk', icon: 'slime_gel', stack: 50, sell: 3, rarity: 'common', desc: 'Visqueuse et vaguement lumineuse.' },
  wolf_pelt: { name: 'Fourrure de loup', type: 'junk', icon: 'wolf_pelt', stack: 50, sell: 7, rarity: 'common', desc: 'Une fourrure épaisse et chaude.' },
  goblin_trinket: { name: 'Babiole gobeline', type: 'junk', icon: 'goblin_trinket', stack: 50, sell: 11, rarity: 'common', desc: 'Un bibelot volé, sans grande valeur.' },
  ancient_bone: { name: 'Os ancien', type: 'junk', icon: 'ancient_bone', stack: 50, sell: 16, rarity: 'uncommon', desc: 'Il émane de cet os une étrange aura.' },
  golem_core: { name: 'Cœur de golem', type: 'junk', icon: 'golem_core', stack: 10, sell: 150, rarity: 'epic', desc: 'Une gemme vibrante d\'énergie ancienne.' },

  rusty_sword: { name: 'Épée rouillée', type: 'weapon', wt: ['melee', 'une_main'], family: 'epee_courte', icon: 'rusty_sword', cls: ['warrior'], lvl: 1, atk: 4, price: 20, sell: 5, rarity: 'common' },
  steel_sword: { name: 'Épée d\'acier', type: 'weapon', wt: ['melee', 'une_main'], family: 'epee_longue', icon: 'steel_sword', cls: ['warrior'], lvl: 6, atk: 12, price: 180, sell: 45, rarity: 'uncommon' },
  runeblade: { name: 'Lame runique', type: 'weapon', wt: ['melee', 'une_main'], family: 'epee_runique', icon: 'runeblade', cls: ['warrior'], lvl: 12, atk: 24, price: 0, sell: 160, rarity: 'epic' },
  apprentice_staff: { name: 'Bâton d\'apprenti', type: 'weapon', wt: ['focalisateur'], family: 'baton', icon: 'apprentice_staff', cls: ['mage'], lvl: 1, atk: 5, price: 20, sell: 5, rarity: 'common' },
  arcane_staff: { name: 'Bâton arcanique', type: 'weapon', wt: ['focalisateur'], family: 'baton', icon: 'arcane_staff', cls: ['mage'], lvl: 6, atk: 13, mp: 20, price: 180, sell: 45, rarity: 'uncommon' },
  ember_staff: { name: 'Bâton des braises', type: 'weapon', wt: ['focalisateur'], family: 'baton', icon: 'ember_staff', cls: ['mage'], lvl: 12, atk: 26, mp: 40, price: 0, sell: 160, rarity: 'epic' },
  short_bow: { name: 'Arc court', type: 'weapon', wt: ['distance'], family: 'arc_court', icon: 'short_bow', cls: ['ranger'], lvl: 1, atk: 4, price: 20, sell: 5, rarity: 'common' },
  long_bow: { name: 'Arc long', type: 'weapon', wt: ['distance'], family: 'arc_long', icon: 'long_bow', cls: ['ranger'], lvl: 6, atk: 12, crit: 0.03, price: 180, sell: 45, rarity: 'uncommon' },
  elven_bow: { name: 'Arc elfique', type: 'weapon', wt: ['distance'], family: 'arc_long', icon: 'elven_bow', cls: ['ranger'], lvl: 12, atk: 25, crit: 0.05, price: 0, sell: 160, rarity: 'epic' },

  leather_tunic: { name: 'Tunique de cuir', type: 'armor', icon: 'leather_tunic', lvl: 1, def: 3, price: 20, sell: 5, rarity: 'common' },
  mage_robe: { name: 'Robe de mage', type: 'armor', icon: 'mage_robe', cls: ['mage'], lvl: 5, def: 6, mp: 40, price: 150, sell: 38, rarity: 'uncommon' },
  chainmail: { name: 'Cotte de mailles', type: 'armor', icon: 'chainmail', cls: ['warrior', 'ranger'], lvl: 6, def: 10, price: 200, sell: 50, rarity: 'uncommon' },
  golem_plate: { name: 'Armure du golem', type: 'armor', icon: 'golem_plate', cls: ['warrior', 'ranger'], lvl: 12, def: 22, hp: 60, price: 0, sell: 175, rarity: 'epic' },
};
export const RARITY_COLORS = { common: '#e8e8e8', uncommon: '#3fd46a', rare: '#3f8cff', epic: '#b85cff' };
export const EQUIP_SLOTS = ['weapon', 'armor'];
// [skilltree] v0.3: equipment is no longer reserved to a class (ROADMAP §2 bis): a hybrid wields the weapon of the
// abilities it learnt (weapon tags `wt`: melee | une_main | focalisateur | distance; `family` for tree conditions).
// `cls` stays on items as the recommended classes (tooltips).
export const canUse = (item, cls, level) => level >= (item.lvl || 1);

// ------------------------------------------------------------------ NPCs & quests
export const NPCS = {
  elder: {
    name: 'Ancien Aldric', model: 'npc_elder', role: 'quest',
    greeting: 'Bienvenue à Brumeval, voyageur. Nos terres sont infestées de créatures… Nous avons besoin de héros.',
    quests: ['q_slimes', 'q_wolves', 'q_goblins', 'q_skeletons', 'q_golem'],
  },
  merchant: {
    name: 'Marchande Élise', model: 'npc_merchant', role: 'shop',
    greeting: 'Des potions, des armes, des armures ! Le meilleur de Brumeval, à prix d\'ami.',
    shop: ['potion_hp_s', 'potion_hp_l', 'potion_mp_s', 'steel_sword', 'arcane_staff', 'long_bow', 'mage_robe', 'chainmail'],
  },
};

export const QUESTS = {
  q_slimes: {
    name: 'Nuisance gluante', giver: 'elder', lvl: 1, requires: null,
    text: 'Les gluants dévorent nos récoltes dans les Plaines d\'Émeraude, à l\'est du village. Éliminez-en huit.',
    done: 'Merci ! Nos champs respirent enfin.',
    goal: { kill: 'slime', count: 8 },
    reward: { xp: 250, gold: 25, items: [['potion_hp_s', 3]] },
  },
  q_wolves: {
    name: 'Les crocs de la forêt', giver: 'elder', lvl: 3, requires: 'q_slimes',
    text: 'Des loups affamés rôdent dans la Forêt des Murmures, au nord. Chassez-en six avant qu\'ils n\'attaquent nos troupeaux.',
    done: 'Vous êtes un chasseur hors pair !',
    goal: { kill: 'wolf', count: 6 },
    reward: { xp: 700, gold: 60, items: [['potion_hp_s', 3], ['potion_mp_s', 2]] },
  },
  q_goblins: {
    name: 'Menace gobeline', giver: 'elder', lvl: 5, requires: 'q_wolves',
    text: 'Les gobelins de l\'ouest pillent nos caravanes. Rendez-vous à leur camp et abattez-en huit.',
    done: 'Les routes de l\'ouest sont de nouveau sûres.',
    goal: { kill: 'goblin', count: 8 },
    reward: { xp: 1400, gold: 110, items: [['potion_hp_l', 2]] },
  },
  q_skeletons: {
    name: 'Le repos des morts', giver: 'elder', lvl: 8, requires: 'q_goblins',
    text: 'Au nord-est, les morts du Cimetière oublié se relèvent. Renvoyez dix squelettes au repos éternel.',
    done: 'Les âmes du cimetière vous remercient.',
    goal: { kill: 'skeleton', count: 10 },
    reward: { xp: 2600, gold: 180, items: [['potion_hp_l', 3]] },
  },
  q_golem: {
    name: 'Le Golem ancien', giver: 'elder', lvl: 12, requires: 'q_skeletons',
    text: 'Un golem millénaire s\'est éveillé dans son antre, au-delà du cimetière. Lui seul menace encore Brumeval. Terrassez-le.',
    done: 'Vous êtes le héros de Brumeval ! Acceptez cette arme légendaire.',
    goal: { kill: 'golem', count: 1 },
    reward: { xp: 5000, gold: 500, items: [], classItem: { warrior: 'runeblade', mage: 'ember_staff', ranger: 'elven_bow' } },
  },
};

// ------------------------------------------------------------------ formulas
/** Derived stats of a player. `eq` = { weapon: itemId|null, armor: itemId|null }. */
export function playerStats(cls, level, eq = {}) {
  const c = CLASSES[cls];
  const l = level - 1;
  const w = eq.weapon ? ITEMS[eq.weapon] : null;
  const a = eq.armor ? ITEMS[eq.armor] : null;
  return {
    mhp: Math.round(c.hp + c.hpLvl * l + (w?.hp || 0) + (a?.hp || 0)),
    mmp: Math.round(c.mp + c.mpLvl * l + (w?.mp || 0) + (a?.mp || 0)),
    atk: Math.round(c.atk + c.atkLvl * l + (w?.atk || 0) + (a?.atk || 0)),
    def: Math.round(c.def + c.defLvl * l + (w?.def || 0) + (a?.def || 0)),
    crit: +(c.crit + (w?.crit || 0) + (a?.crit || 0)).toFixed(3),
    speed: c.speed,
  };
}

export function monsterStats(type, level) {
  const m = MONSTERS[type];
  const l = level - 1;
  return {
    mhp: Math.round(m.hp + m.hpLvl * l),
    atk: Math.round(m.atk + m.atkLvl * l),
    def: Math.round(m.def + m.defLvl * l),
    crit: 0.05,
    speed: m.speed,
  };
}

/** Damage after mitigation. `roll` in [0,1) for variance, `critRoll` in [0,1). */
export function computeDamage(atk, power, def, crit, roll, critRoll) {
  const isCrit = critRoll < crit;
  const raw = atk * power * (0.85 + roll * 0.3) * (isCrit ? 1.6 : 1);
  return { amount: Math.max(1, Math.round((raw * 60) / (60 + def))), crit: isCrit };
}

/** XP a player of `playerLevel` gets for killing a monster of type/level. */
export function monsterXp(type, monsterLevel, playerLevel) {
  const m = MONSTERS[type];
  const base = m.xp + m.xpLvl * (monsterLevel - 1);
  const mult = Math.min(1.5, Math.max(0.1, 1 + 0.1 * (monsterLevel - playerLevel)));
  return Math.max(1, Math.round(base * mult));
}

/** Regeneration per second as a fraction of max. Out of combat = no damage dealt/taken for 6 s. */
export const REGEN = { hpCombat: 0.004, hpRest: 0.04, mpCombat: 0.015, mpRest: 0.05, restDelay: 6 };
