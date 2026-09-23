// Quick balance sanity check for the v0.3 design (analytic model, NOT the combat simulation).
// Run: node docs/design/tools/balance.mjs [--json] [--verbose]
//
// For 2 plausible builds per class (+2 hybrids) at levels 5 / 15 / 30, with typical gear of the matching tier:
//   - the allocation is completed with the cheapest paths and checked with validateTree (legal builds only);
//   - every unlocked ability is resolved (variants, passives, Inaptitude, weapon requirement, damage envelope cap);
//   - a 60 s solo fight is played against a reference monster of the same level (0.05 s steps): cooldowns, mana,
//     stamina (30 kept in reserve for a dodge roll), commitment (windup + cast + channel + recovery), buffs, heals;
//   - DPS, effective HP (defence, heals, shields, guard) and "kills per life" = (DPS / monster HP) × time to die.
// The per-class exposure (share of the monster's attacks that connect: melee stands in range, casters and archers
// don't) is calibrated ONCE at level 5 on the v0.2 kit (migration preset + v0.2 weapons), which the real v0.2
// simulation (tests/balance/sim.mjs, docs/EQUILIBRAGE.md) measured at ±9 %. Everything else is the tree + items data.
// Targets: pure classes within ±15 % of each other (class = mean of its 2 builds) at every level;
//          hybrids between 80 % and 100 % of the best pure build of their main class.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLASS_START, validateTree, cheapestPath, collectEffects, unlockedAbilities, isInapt, inaptitudeReduction, indexTree,
} from './lib/treelib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = path.resolve(HERE, '..');
const tree = JSON.parse(fs.readFileSync(path.join(DESIGN, 'skilltree.json'), 'utf8'));
const items = JSON.parse(fs.readFileSync(path.join(DESIGN, 'items.json'), 'utf8'));
const { abilities: AB, nodes: NODES } = indexTree(tree);
const VERBOSE = process.argv.includes('--verbose');

// ------------------------------------------------------------------ class stats (shared/data.js, wave1/combat-souls)
const CLASS = {
  warrior: { hp: 130, hpLvl: 18, mp: 40, mpLvl: 4, atk: 11, atkLvl: 2.2, def: 4, defLvl: 1.2, crit: 0.08 },
  mage: { hp: 85, hpLvl: 11, mp: 95, mpLvl: 12, atk: 9, atkLvl: 2.7, def: 2, defLvl: 0.7, crit: 0.1 },
  ranger: { hp: 100, hpLvl: 14, mp: 80, mpLvl: 7, atk: 10, atkLvl: 2.3, def: 3, defLvl: 0.9, crit: 0.15 },
};
const STAMINA = { max: 100, regen: 35, dodgeReserve: 30 };
const MP_REGEN_COMBAT = 0.015;
// healing potion of the matching tier (crafting.json: small 60 / medium 140 / large 220 / very large 400), one every
// 20 s (shared potion cooldown proposed for v0.3), 0.8 s of commitment to drink it
const POTION = (L) => (L < 7 ? 60 : L < 14 ? 140 : L < 25 ? 220 : 400);
const POTION_CD = 20;
const K = (lvl) => 60 + 6 * Math.max(0, lvl - 10); // proposed v0.3 mitigation constant (rules.damageFormula)
// reference monster of level L (fit of the v0.2 slime/wolf/goblin/skeleton curves, extended to 30)
const MONSTER = (L) => ({ hp: 20 + 32 * L, atk: 2 + 4 * L, def: 2 * L, interval: 1.6, heavyShare: 0.3, heavyMult: 1.6 });

// ------------------------------------------------------------------ gear (items.json formulas)
const FAM = items.families;
const RAR = { 5: 1.05, 15: 1.1, 30: 1.1 }; // uncommon at 5, rare at 15/30 (typical, not best-in-slot)
const AFF = items.affixes;
const affixMid = (id, lvl) => {
  const a = AFF[id];
  const t = (lvl - 1) / 29;
  const lo = (a.range['1'][0] + a.range['1'][1]) / 2, hi = (a.range['30'][0] + a.range['30'][1]) / 2;
  return lo * (1 - t) + hi * t;
};
function gearStats(g, L) {
  const m = RAR[L] || 1.1;
  const f = FAM[g.weapon];
  const s = { poiseMult: f.poise || 1, stMult: f.st || 1, atk: 0, def: 0, mp: 0, hp: 0, crit: f.crit || 0, weaponFamily: g.weapon, tags: new Set(f.tags), hands: f.hands, cdMult: f.cd || 1, offhand: g.offhand || null };
  s.atk += Math.round((3 + 1.6 * L) * f.atk * m) + affixMid('force', L);
  if (f.mp) s.mp += Math.round((4 + 2 * L) * f.mp * m);
  const TYPE = { plaques: 1, cuir: 0.6, tissu: 0.35 };
  s.def += Math.round((6 + 3.2 * L) * TYPE[g.armor] * m);
  if (g.armor === 'tissu') s.mp += Math.round(10 + 4 * L);
  s.hp += affixMid('vitalite', L); // rare chest: Vitalité
  s.armor = g.armor;
  if (g.offhand === 'bouclier') { s.def += Math.round(2 + 1.3 * L); s.block = Math.min(0.9, (60 + L) / 100); s.tags.add('bouclier'); }
  if (g.offhand === 'grimoire') { s.mp += Math.round(8 + 3 * L); s.tags.add('focalisateur_secondaire'); }
  if (g.offhand === 'carquois') { s.atk += Math.max(1, Math.round(L / 4)); s.crit += 0.02; }
  return s;
}
// v0.2 kit (legacy weapons) for the calibration
const V02_GEAR = {
  // v0.2 weapon + armour at the levels measured by the v0.2 simulation (5, 10, 14)
  warrior: { 5: { w: 'rusty_sword', a: 'leather_tunic' }, 10: { w: 'steel_sword', a: 'chainmail' }, 14: { w: 'runeblade', a: 'golem_plate' } },
  mage: { 5: { w: 'apprentice_staff', a: 'leather_tunic' }, 10: { w: 'arcane_staff', a: 'mage_robe' }, 14: { w: 'ember_staff', a: 'mage_robe' } },
  ranger: { 5: { w: 'short_bow', a: 'leather_tunic' }, 10: { w: 'long_bow', a: 'chainmail' }, 14: { w: 'elven_bow', a: 'golem_plate' } },
};
const V01_ITEMS = {
  rusty_sword: { atk: 4, f: 'epee_longue' }, steel_sword: { atk: 12, f: 'epee_longue' }, runeblade: { atk: 24, f: 'epee_runique' },
  apprentice_staff: { atk: 5, f: 'baton' }, arcane_staff: { atk: 13, mp: 20, f: 'baton' }, ember_staff: { atk: 26, mp: 40, f: 'baton' },
  short_bow: { atk: 4, f: 'arc_court' }, long_bow: { atk: 12, crit: 0.03, f: 'arc_long' }, elven_bow: { atk: 25, crit: 0.05, f: 'arc_long' },
  leather_tunic: { def: 3 }, chainmail: { def: 10 }, mage_robe: { def: 6, mp: 40 }, golem_plate: { def: 22, hp: 60 },
};

// ------------------------------------------------------------------ builds
// targets: node ids (":n" = rank n). Missing links are completed with the cheapest path (no variant used as a path).
const BUILDS = [
  {
    id: 'g_gardien', fill: ['gu_ga_peau_de_pierre:3','gu_ga_endurci:3','sv_vigueur:3','sv_souffle:3','gu_ga_sentinelle','gu_ga_inebranlable'], cls: 'warrior', name: 'Guerrier Gardien (épée longue + bouclier, plaques)',
    gear: { weapon: 'epee_longue', offhand: 'bouclier', armor: 'plaques' },
    at: {
      5: ['fond_roulade', 'fond_garde', 'fond_charge', 'gu_coup_puissant', 'gu_ga_cri'],
      15: ['fond_roulade', 'fond_garde', 'fond_charge', 'fond_sprint', 'gu_coup_puissant', 'gu_coup_fendoir', 'gu_ga_cri', 'gu_ga_cri_souffle', 'gu_ga_constitution:3', 'gu_ga_coup_bouclier', 'gu_ga_bouclier_ecrasant', 'gu_ga_riposte', 'gu_ga_riposte_vengeresse', 'gu_be_tourbillon'],
      30: ['fond_roulade', 'fond_garde', 'fond_charge', 'fond_sprint', 'fond_saut', 'gu_coup_puissant', 'gu_coup_fendoir', 'gu_ga_cri', 'gu_ga_cri_souffle', 'gu_ga_constitution:3', 'gu_ga_coup_bouclier', 'gu_ga_bouclier_ecrasant', 'gu_ga_riposte', 'gu_ga_riposte_vengeresse', 'gu_be_tourbillon', 'gu_ga_peau_de_pierre:3', 'gu_ga_maitrise_longue', 'gu_ga_bastion', 'gu_ga_bastion_epineux', 'gu_ga_endurci:2', 'gu_ga_ks_mur_vivant', 'sv_bras:2', 'sv_parade'],
    },
  },
  {
    id: 'g_berserker', fill: ['gu_be_plaie:3','gu_be_soif:3','gu_be_chair:3','gu_be_carnage:3','sv_vigueur:3','gu_be_fureur','gu_be_briseur'], cls: 'warrior', name: 'Guerrier Berserker (espadon, plaques)',
    gear: { weapon: 'espadon', armor: 'plaques' },
    at: {
      5: ['fond_roulade', 'fond_sprint', 'fond_charge', 'gu_coup_puissant', 'gu_ga_cri'],
      15: ['fond_roulade', 'fond_sprint', 'fond_charge', 'fond_garde', 'gu_coup_puissant', 'gu_coup_fendoir', 'gu_be_tourbillon', 'gu_be_tourbillon_sanglant', 'gu_be_rage', 'gu_be_entaille', 'gu_be_soif:2', 'gu_be_chair:2', 'gu_be_plaie', 'gu_ga_cri'],
      30: ['fond_roulade', 'fond_sprint', 'fond_charge', 'fond_garde', 'fond_saut', 'gu_coup_puissant', 'gu_coup_fendoir', 'gu_be_tourbillon', 'gu_be_tourbillon_sanglant', 'gu_be_rage', 'gu_be_entaille', 'gu_be_hemorragie', 'gu_be_soif:3', 'gu_be_chair:3', 'gu_be_plaie:3', 'gu_ga_cri', 'gu_be_maitrise_espadon', 'gu_be_carnage:3', 'gu_be_execution', 'gu_be_ks_dechaine', 'gu_be_bond'],
    },
  },
  {
    id: 'm_pyro', fill: ['ma_p_flamme_attisee:3','ma_p_fournaise:3','ma_p_etincelle:2','ma_p_esprit_vif:3','sv_vigueur:3','ma_p_meditation:3','sv_souffle:3'], cls: 'mage', name: 'Mage Pyromancien (bâton, tissu)',
    gear: { weapon: 'baton', armor: 'tissu' },
    at: {
      5: ['fond_roulade', 'fond_sprint', 'fond_saut', 'ma_fireball', 'ma_v_bolt_feu'],
      15: ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_garde', 'ma_fireball', 'ma_v_bolt_feu', 'ma_v_fireball_grande', 'ma_heal', 'ma_p_flamme_attisee:3', 'ma_fire_wall', 'ma_p_braises_tenaces', 'ma_ignite', 'ma_frost_nova'],
      30: ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_garde', 'sv_egide', 'ma_fireball', 'ma_v_bolt_feu', 'ma_v_fireball_grande', 'ma_heal', 'ma_p_flamme_attisee:3', 'ma_fire_wall', 'ma_p_braises_tenaces', 'ma_ignite', 'ma_flame_breath', 'ma_p_fournaise:3', 'ma_p_etincelle:2', 'ma_meteor', 'ma_ks_coeur_de_braise', 'ma_frost_nova', 'ma_p_esprit_vif:2'],
    },
  },
  {
    id: 'm_givre', fill: ['ma_p_morsure_froid:3','ma_p_coeur_gele:3','ma_p_vigueur_erudit:2','ma_p_peau_de_givre:2','ma_p_hiver_long:2','sv_vigueur:3','ma_p_esprit_vif:3'], cls: 'mage', name: 'Mage de givre (bâton, tissu)',
    gear: { weapon: 'baton', armor: 'tissu' },
    at: {
      5: ['fond_roulade', 'fond_sprint', 'fond_saut', 'ma_frost_nova', 'ma_heal'],
      15: ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_garde', 'ma_frost_nova', 'ma_v_nova_glaciale', 'ma_heal', 'ma_v_bolt_givre', 'ma_ice_lance', 'ma_p_morsure_froid:3', 'ma_p_vigueur_erudit:2', 'ma_frost_armor', 'ma_fireball'],
      30: ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_garde', 'sv_egide', 'ma_frost_nova', 'ma_v_nova_glaciale', 'ma_heal', 'ma_v_bolt_givre', 'ma_ice_lance', 'ma_v_lance_trio', 'ma_p_morsure_froid:3', 'ma_p_vigueur_erudit:2', 'ma_frost_armor', 'ma_p_coeur_gele:3', 'ma_p_peau_de_givre:2', 'ma_blizzard', 'ma_v_blizzard_oeil', 'ma_ks_hiver_eternel', 'ma_p_esprit_vif'],
    },
  },
  {
    id: 'r_tireur', fill: ['ro_ti_main_sure:3','ro_ti_oeil_exerce:3','ro_ti_point_faible:2','ro_ti_tir_tendu:2','ro_ti_carquois_profond:2','sv_vigueur:3','sv_souffle:3'], cls: 'ranger', name: 'Rôdeur Tireur (arc long + carquois, cuir)',
    gear: { weapon: 'arc_long', offhand: 'carquois', armor: 'cuir' },
    at: {
      5: ['fond_roulade', 'fond_sprint', 'fond_saut', 'ro_ti_main_sure', 'ro_ti_tir_percant'],
      15: ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_charge', 'ro_ti_main_sure:3', 'ro_ti_tir_percant', 'ro_ti_tir_traversant', 'ro_ti_tir_rapide', 'ro_ti_rafale', 'ro_ti_oeil_exerce', 'ro_ti_pluie', 'ro_tq_marque', 'ro_tq_bond_retrait'],
      30: ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_charge', 'fond_garde', 'ro_ti_main_sure:3', 'ro_ti_tir_percant', 'ro_ti_tir_traversant', 'ro_ti_tir_rapide', 'ro_ti_rafale', 'ro_ti_oeil_exerce:3', 'ro_ti_pluie', 'ro_ti_fleche_assommante', 'ro_tq_marque', 'ro_ti_tir_tendu:2', 'ro_ti_point_faible:2', 'ro_ti_trait_fatal', 'ro_ti_posture_archer', 'ro_ti_tir_de_maitre', 'sv_souplesse', 'sv_esquive_parfaite'],
    },
  },
  {
    id: 'r_venin', fill: ['ro_ve_herboriste:2','ro_ve_saigneur:3','ro_ve_virulence:2','ro_ti_main_sure:3','sv_vigueur:3','sv_souffle:3'], cls: 'ranger', name: 'Rôdeur Venin (arc court, cuir)',
    gear: { weapon: 'arc_court', offhand: 'carquois', armor: 'cuir' },
    at: {
      5: ['fond_roulade', 'fond_sprint', 'fond_saut', 'ro_ve_herboriste', 'ro_ve_fleche_empoisonnee'],
      15: ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_charge', 'ro_ve_herboriste:2', 'ro_ve_fleche_empoisonnee', 'ro_ve_venin_corrosif', 'ro_ve_fleche_barbelee', 'ro_ve_plaie_ouverte', 'ro_ve_nuage', 'ro_ti_main_sure', 'ro_ti_tir_percant', 'ro_ve_mithridatisation'],
      30: ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_charge', 'fond_garde', 'ro_ve_herboriste:2', 'ro_ve_fleche_empoisonnee', 'ro_ve_venin_corrosif', 'ro_ve_fleche_barbelee', 'ro_ve_plaie_ouverte', 'ro_ve_nuage', 'ro_ti_main_sure:2', 'ro_ti_tir_percant', 'ro_ve_mithridatisation', 'ro_ve_entaille', 'ro_ve_saigneur:3', 'ro_ve_virulence:2', 'ro_ve_fleau', 'ro_ve_veneneux', 'ro_tq_marque', 'sv_souplesse'],
    },
  },
  // ---- hybrids
  {
    id: 'h_lame_spirituelle', fill: ['ma_p_flamme_attisee:3','ma_p_fournaise:3','sv_vigueur:3','ma_p_esprit_vif:3','sv_souffle:3'], cls: 'mage', hybrid: true, name: 'Hybride : Mage lame spirituelle (épée runique + grimoire, tissu) — Tourbillon du Guerrier',
    gear: { weapon: 'epee_runique', offhand: 'grimoire', armor: 'tissu' },
    at: {
      15: ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_garde', 'ma_fireball', 'ma_v_bolt_feu', 'ma_heal', 'gm_onde_tranchante', 'gm_lame_enchantee', 'gm_lame_ardente', 'gm_maitrise_runique', 'gu_md_brise_garde'],
      30: ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_garde', 'ma_fireball', 'ma_v_bolt_feu', 'ma_heal', 'ma_p_flamme_attisee:3', 'gm_onde_tranchante', 'gm_lame_enchantee', 'gm_lame_ardente', 'gm_maitrise_runique', 'gm_ks_serment', 'gu_be_tourbillon', 'gu_coup_puissant', 'ma_fire_wall', 'ma_p_braises_tenaces'],
    },
  },
  {
    id: 'h_rodeur_givre', fill: ['mr_p_seve_arcanique:2','ro_ti_carquois_profond:2','ro_ti_main_sure:3','ro_ti_oeil_exerce:3','sv_vigueur:3','sv_souffle:3'], cls: 'ranger', hybrid: true, name: 'Hybride : Rôdeur de givre (arc long, cuir) — Arcaniste sylvestre + Lance de glace du Mage',
    gear: { weapon: 'arc_long', offhand: 'carquois', armor: 'cuir' },
    at: {
      15: ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_charge', 'ro_ve_herboriste', 'ro_ve_cueilleur', 'mr_p_oeil_sylvestre:2', 'mr_rune_arrow', 'mr_frost_brambles', 'ro_ti_main_sure', 'ro_ti_tir_percant'],
      30: ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_charge', 'ro_ve_herboriste', 'ro_ve_cueilleur', 'mr_p_oeil_sylvestre:2', 'mr_rune_arrow', 'mr_v_arrow_eclatee', 'mr_frost_brambles', 'mr_wisp', 'mr_p_seve_arcanique:2', 'mr_ks_arc_des_astres', 'ro_ti_main_sure:3', 'ro_ti_tir_percant', 'ro_ti_tir_rapide', 'ro_ti_rafale', 'mr_v_brambles_nord', 'ma_ice_lance', 'ro_tq_marque'],
    },
  },
];

// ------------------------------------------------------------------ allocation
function allocate(b, L) {
  const cls = b.cls;
  const owned = new Set(['coeur', CLASS_START[cls]]);
  const alloc = {};
  const add = (id, r = 1) => {
    alloc[id] = Math.max(alloc[id] || 0, r);
    owned.add(id);
  };
  const targets = b.at[L].map((t) => t.split(':')).map(([id, r]) => [id, Number(r || 1)]);
  // Fondamentaux first (no adjacency needed)
  for (const [id, r] of targets) if (NODES.get(id)?.fondamental) add(id, r);
  for (const [id, r] of targets) {
    if (!NODES.has(id)) throw new Error(`${b.id}: nœud inconnu ${id}`);
    if (owned.has(id)) { add(id, r); continue; }
    const p = cheapestPath(tree, cls, owned, id);
    if (!p) throw new Error(`${b.id}: ${id} inaccessible`);
    for (const x of p.path) add(x, x === id ? r : 1);
  }
  // spend the remaining points on the build's filler list (passives), in order
  const budget = validateTree(tree, cls, L, {}).budget;
  const spentNow = () => validateTree(tree, cls, 50, alloc).spent;
  for (const f of b.fill || []) {
    const [id, rMax] = f.split(':');
    for (let r = 1; r <= Number(rMax || 1); r++) {
      if ((alloc[id] || 0) >= r) continue;
      const trial = { ...alloc };
      if (!owned.has(id)) { const p = cheapestPath(tree, cls, owned, id); if (!p) break; for (const x of p.path) trial[x] = Math.max(trial[x] || 0, 1); }
      trial[id] = r;
      if (validateTree(tree, cls, L, trial).ok) { Object.assign(alloc, trial); for (const k of Object.keys(trial)) owned.add(k); } else break;
    }
  }
  void budget; void spentNow;
  const v = validateTree(tree, cls, L, alloc);
  return { alloc, v };
}

// ------------------------------------------------------------------ effects helpers
function condOk(e, ctx) {
  const w = e.when;
  if (!w) return 1;
  if (w.weaponFamily && !w.weaponFamily.includes(ctx.weaponFamily)) return 0;
  if (w.offhand && w.offhand !== ctx.offhand) return 0;
  if (w.grip === 'deux_mains' && ctx.hands !== 2) return 0;
  if (w.hpUnder || w.enemiesWithin8Min) return 0;
  if (w.enemiesWithin8) return 1;
  if (w.cond) return 0.5; // situational (e.g. standing still): half uptime
  if (w.hitWithin) return 1;
  return 1;
}
function statSum(effects, stat, ctx) {
  let s = 0;
  for (const e of effects) if (e.stat === stat && typeof e.value === 'number' && e.op === 'add') s += e.value * condOk(e, ctx);
  return s;
}
function charStats(b, L, effects, gear) {
  const c = CLASS[b.cls];
  const ctx = { weaponFamily: gear.weaponFamily, offhand: gear.offhand, hands: gear.hands };
  const st = {
    mhp: (c.hp + c.hpLvl * (L - 1) + gear.hp) * (1 + statSum(effects, 'mhpPct', ctx)),
    mmp: (c.mp + c.mpLvl * (L - 1) + gear.mp + statSum(effects, 'mmp', ctx)) * (1 + statSum(effects, 'mmpPct', ctx)),
    atk: c.atk + c.atkLvl * (L - 1) + gear.atk,
    def: (c.def + c.defLvl * (L - 1) + gear.def) * (1 + statSum(effects, 'defPct', ctx)),
    crit: c.crit + gear.crit + statSum(effects, 'crit', ctx),
    critDmg: 0.6 + statSum(effects, 'critDmgPct', ctx),
    mst: STAMINA.max + statSum(effects, 'mst', ctx),
    stRegen: (STAMINA.regen + statSum(effects, 'stRegen', ctx)) * (1 + statSum(effects, 'stRegenPct', ctx)) * (gear.armor === 'plaques' ? 0.8 : gear.armor === 'cuir' ? 1.12 : 1),
    mpRegen: MP_REGEN_COMBAT * (1 + statSum(effects, 'mpRegenCombatPct', ctx)),
    attackSpeed: statSum(effects, 'attackSpeedPct', ctx),
    dmgTaken: statSum(effects, 'dmgTakenPct', ctx),
    lifesteal: Math.min(0.09, statSum(effects, 'lifestealMelee', ctx)),
    mpCost: statSum(effects, 'mpCostPct', ctx),
    castTime: statSum(effects, 'castTimePct', ctx) - (gear.armor === 'tissu' ? 0.12 : 0) + (gear.armor === 'plaques' ? 0.12 : 0),
    ownClassPower: statSum(effects, 'ownClassPowerPct', ctx),
    ctx,
  };
  return st;
}
/** attack a character of class `cls` would have at level L with the same gear (reference attack rule). */
const classAtk = (cls, L, gear) => CLASS[cls].atk + CLASS[cls].atkLvl * (L - 1) + gear.atk;

// ------------------------------------------------------------------ ability resolution (simplified resolveAbility)
function setPath(o, p, v) {
  const parts = p.split('.');
  let cur = o;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts.at(-1)] = v;
}
function getPath(o, p) {
  return p.split('.').reduce((c, k) => (c == null ? undefined : c[k]), o);
}
function froidOf(applies) {
  if (!Array.isArray(applies)) return 0;
  let s = 0;
  for (const x of applies) if (x && typeof x === 'object' && x.id === 'froid') s += (x.stacks || 1) / (x.every || 1);
  return s;
}

function resolve(b, L, abId, effects, cs, gear, alloc) {
  const a = structuredClone(AB.get(abId));
  const ctx = cs.ctx;
  // variants/passives on fields: set, then add, then mul (nested paths allowed: "poison.perStackPerS")
  const mods = effects.filter((e) => e.mod && e.mod.startsWith(abId + '.') && condOk(e, ctx));
  const field = (e) => e.mod.slice(abId.length + 1);
  for (const e of mods.filter((x) => x.op === 'set')) setPath(a, field(e), e.value);
  for (const e of mods.filter((x) => x.op === 'add' && typeof x.value === 'number')) setPath(a, field(e), (getPath(a, field(e)) || 0) + e.value);
  const mul = {};
  for (const e of mods.filter((x) => x.op === 'mul')) mul[field(e)] = (mul[field(e)] || 0) + e.value;
  for (const [k, v] of Object.entries(mul)) if (typeof getPath(a, k) === 'number') setPath(a, k, getPath(a, k) * (1 + v));
  // weapon requirement
  const tags = gear.tags;
  const martial = tags.has('melee') && !tags.has('focalisateur');
  let weaponMult = 1;
  if (a.weapon === 'melee' && !martial) return null;
  if (a.weapon === 'arc' && !tags.has('distance')) return null;
  if (a.weapon === 'dague' && !(tags.has('distance') || (martial && gear.hands === 1))) return null;
  const focusFull = tags.has('focalisateur') || (effects.some((e) => e.stat === 'focusFromBow') && tags.has('distance'));
  const focusPartial = tags.has('focalisateur_partiel') || tags.has('focalisateur_secondaire');
  const runeFull = effects.some((e) => e.stat === 'focusPenaltyRemoved' && condOk(e, ctx));
  if (a.weapon === 'focus' || a.weapon === 'focus_ou_arc') {
    if (a.weapon === 'focus_ou_arc' && tags.has('distance')) weaponMult = 1;
    else if (focusFull || runeFull) weaponMult = 1;
    else if (focusPartial) weaponMult = 0.9;
    else weaponMult = 0.8;
  }
  if (a.weapon === 'dague' && tags.has('distance')) weaponMult = 0.8; // belt knife with a bow
  // damage envelope (additive, capped)
  const atags = new Set(a.tags);
  if (a.element) atags.add(a.element);
  const burn = Array.isArray(a.applies) && a.applies.includes('brulure');
  if (burn) atags.add('feu');
  let dmgPct = statSum(effects, 'dmgPct', ctx);
  for (const t of atags) if (!['saignement', 'poison'].includes(t)) dmgPct += statSum(effects, `dmgPct.${t}`, ctx);
  dmgPct = Math.min(tree.rules.caps.treeDamagePct, dmgPct);
  const dotPct = Math.min(tree.rules.caps.treeDamagePct, statSum(effects, 'dmgPct', ctx) + statSum(effects, 'dmgPct.saignement', ctx) + statSum(effects, 'dmgPct.poison', ctx));
  // Inaptitude + reference attack
  let pw = 1, cost = 1, cdm = 1;
  let atk = cs.atk;
  const inapt = isInapt(a, b.cls);
  if (inapt) {
    const f = 1 - inaptitudeReduction(tree, b.cls, effects, a);
    pw = 1 + tree.rules.inaptitude.power * f;
    cost = 1 + tree.rules.inaptitude.cost * f;
    cdm = 1 + tree.rules.inaptitude.cooldown * f;
    atk = Math.min(atk, ...[].concat(a.home).map((h) => classAtk(h, L, gear)));
  } else if (a.home) pw *= 1 + cs.ownClassPower;
  // direct damage in atk multiples
  const power = typeof a.power === 'number' ? a.power : 0;
  let direct = power * (a.hits || 1) * (a.projectiles ? a.projectiles * 0.8 : 1); // spread: ~80 % of the extra projectiles hit
  if (a.kind === 'channel' && a.channel && a.tick) direct = power * (a.channel / a.tick);
  if (a.id === 'fire_wall') direct = power * ((a.duration || 5) / (a.tick || 0.5)) * 0.5; // target stays half the time
  if (a.kind === 'summon' && a.period) direct = power * ((a.duration || 10) / a.period);
  if (a.groundBurn) direct += a.groundBurn.power * (a.groundBurn.duration / a.groundBurn.tick) * 0.5;
  if (a.lowHp) direct *= 1 + (a.lowHp.mult - 1) * 0.3; // execute: 30 % of its uses under 30 % HP
  if (a.shatter && [...alloc.unlocked].some((x) => ['frost_nova', 'blizzard', 'frost_brambles'].includes(x) || (x === 'firebolt' && alloc.alloc.ma_v_bolt_givre))) direct *= 1 + (a.shatter.mult - 1) * 0.6;
  direct *= 1 + statSum(effects, 'dmgDirectPct', ctx);
  let dot = 0; // uncapped damage over time (bleeds, hemorrhage) in atk multiples
  if (a.dot?.total) dot += a.dot.total;
  const mon = MONSTER(L);
  const bleed = (a.bleedBuild || 0) + (a.bleedAdd || 0);
  if (bleed) dot += (bleed / 100) * (1.5 + (0.06 * mon.hp) / Math.max(1, atk)) * (1 + statSum(effects, 'bleedBuildPct', ctx));
  // poison: stacks with a global cap (fight())
  let poisonStacks = 0;
  if (a.poison) poisonStacks = 1;
  if (a.poisonStacks) poisonStacks = a.poisonStacks;
  if (a.poisonPerS) poisonStacks = Math.min(3, Math.round((a.duration || 6) * a.poisonPerS * 0.5));
  const perStack = (a.poison?.perStackPerS ?? 0.25) * (1 + statSum(effects, 'poisonTickPct', ctx));
  // poise & cold
  const poisePct = statSum(effects, 'poisePct', ctx) + (atags.has('sort') ? statSum(effects, 'poisePct.sort', ctx) : 0);
  const famPoise = a.base || ['melee', 'arc', 'dague'].includes(a.weapon) ? gear.poiseMult || 1 : 1;
  const poise = (a.poise || 0) * famPoise * (1 + poisePct) * (a.kind === 'channel' ? 1 : a.hits || 1);
  let froid = froidOf(a.applies);
  if (a.id === 'blizzard' && a.channel && a.tick) froid = froid * (a.channel / a.tick);
  const castMult = Math.max(0.5, 1 + cs.castTime);
  const commit = Math.max(0.3, (a.windup || 0) + (a.cast || 0) * castMult + (a.channel || 0) + (a.rec ?? 0.3));
  let cd = typeof a.cd === 'number' ? a.cd * cdm : 1.3;
  if (a.base) cd = cd * gear.cdMult * (1 - Math.min(0.3, cs.attackSpeed));
  if (a.id === 'riposte') cd = Math.max(cd, 6); // needs a blocked hit first
  const k = atk * pw * weaponMult;
  return {
    id: a.id, name: a.name, kind: a.kind, base: !!a.base,
    dmg: k * (direct * (1 + dmgPct) + dot * (1 + dotPct)), // expected per use, before crit & monster defence
    burn, poisonStacks, poisonDps: k * perStack * (1 + dotPct), detonate: a.id === 'fleau' ? a.detonate || 1.5 : 0,
    poise, froid, cd, commit,
    iframe: (a.iframe || 0) > 0 || (a.iframeMs || 0) > 0, ctrlS: (a.root || 0) + (a.slow ? a.slow.pct * a.slow.dur * 0.5 : 0),
    mp: Math.ceil((a.mp || 0) * cost * (1 + cs.mpCost)), st: Math.ceil((a.st || 0) * cost * (a.base ? gear.stMult || 1 : 1)),
    heal: a.heal || 0, buff: a.buff || a.effects || null, dur: a.dur || a.duration || 0, absorb: a.absorb || 0,
    shield: a.shield || null, dmgTakenFromYou: a.dmgTakenFromYou || 0, crit: a.guaranteedCrit ? 1 : a.critAdd || 0,
    melee: a.tags.includes('melee'), inapt, weaponMult: +weaponMult.toFixed(2), powerMult: +pw.toFixed(3),
  };
}

const martialOf = (gear) => gear.tags.has('melee') && !gear.tags.has('focalisateur');
// ------------------------------------------------------------------ 60 s fight
function fight(b, L, abil, cs, gear, exposure, alloc, effects) {
  const mon = MONSTER(L);
  const T = 60, dt = 0.05;
  let t = 0, busy = 0, mp = cs.mmp, st = cs.mst, dmg = 0, heals = 0, shields = 0;
  const cdEnd = new Map();
  const buffs = [];
  const uses = {};
  const mitig = K(L) / (K(L) + mon.def);
  const critMult = (extra = 0) => 1 + Math.min(1, cs.crit + extra) * cs.critDmg;
  const order = [...abil].sort((x, y) => y.dmg - x.dmg);
  // statuses
  const burnMax = effects.some((e) => e.stat === 'statusMaxStacks.brulure') ? 3 : 1;
  const burnDur = 3 + statSum(effects, 'statusDurS.brulure', cs.ctx);
  let burns = []; // {until, dps}
  const poisonMax = 3 + statSum(effects, 'poisonMaxStacks', cs.ctx);
  let poisons = []; // {until, dps}
  let froid = []; // expiry times of cold stacks (max 3)
  const froidDur = 3 + statSum(effects, 'statusDurS.froid', cs.ctx);
  const froidBonus = statSum(effects, 'dmgVsStatusPct.froid', cs.ctx);
  let froidTime = 0; // integral of stacks
  let poiseAcc = [], staggers = 0, dodged = 0, ctrlTime = 0, nextPotion = 10, froidAcc = 0;
  const poiseThreshold = 16 + 2 * L;
  while (t < T) {
    mp = Math.min(cs.mmp, mp + cs.mmp * cs.mpRegen * dt);
    st = Math.min(cs.mst, st + cs.stRegen * dt * 0.8);
    burns = burns.filter((x) => x.until > t);
    poisons = poisons.filter((x) => x.until > t);
    froid = froid.filter((x) => x > t);
    froidTime += froid.length * dt;
    for (const x of burns) dmg += x.dps * dt;
    for (const x of poisons) dmg += x.dps * dt;
    if (t >= busy && t >= nextPotion) {
      heals += POTION(L) * (1 + statSum(effects, 'potionPct', cs.ctx));
      nextPotion = t + POTION_CD;
      busy = t + 0.8;
    }
    if (t >= busy) {
      const active = buffs.filter((x) => x.until > t);
      const ready = (a) => (cdEnd.get(a.id) || 0) <= t && mp >= a.mp && st - a.st >= (a.base ? 0 : STAMINA.dodgeReserve);
      let pick = null;
      for (const a of order) if ((a.heal || a.buff || a.absorb || a.shield || a.dmgTakenFromYou || a.iframe) && (a.dmg === 0 || a.iframe) && ready(a) && (a.heal || a.iframe ? t >= 8 : true)) { pick = a; break; }
      if (!pick) for (const a of order) if (!a.base && (a.dmg > 0 || a.poisonStacks || a.detonate) && ready(a)) { pick = a; break; }
      if (!pick) pick = order.find((a) => a.base && ready(a));
      if (pick) {
        uses[pick.id] = (uses[pick.id] || 0) + 1;
        mp -= pick.mp;
        st -= pick.st;
        cdEnd.set(pick.id, t + pick.cd);
        busy = t + pick.commit;
        if (pick.heal) heals += pick.heal * cs.mhp;
        if (pick.iframe) dodged++;
        if (pick.ctrlS) ctrlTime += pick.ctrlS;
        if (pick.shield) shields += (pick.shield.hpPct || 0) * cs.mhp;
        if (pick.absorb) shields += pick.absorb * cs.mhp * 0.5;
        if (pick.buff || pick.dmgTakenFromYou) {
          const bf = pick.buff || {};
          const marked = buffs.some((x) => x.mark && x.until > t);
          buffs.push({
            until: t + (pick.dur || 6), dmgPct: (bf.dmgPct || 0) + (bf.dmgVsMarked && marked ? bf.dmgVsMarked : 0) + (pick.dmgTakenFromYou || 0),
            atkSpeed: bf.attackSpeedPct || 0, defPct: bf.defPct || 0, dmgTaken: bf.dmgTakenPct || 0, meleeBonus: bf.meleeBonusDmg || 0, mark: !!pick.dmgTakenFromYou,
          });
        }
        const bd = active.reduce((s, x) => s + x.dmgPct, 0) + (froid.length ? froidBonus : 0);
        if (pick.dmg > 0) {
          const mb = pick.melee ? active.reduce((s, x) => s + x.meleeBonus, 0) : 0;
          const d = pick.dmg * (1 + bd + mb) * critMult(pick.crit) * mitig;
          dmg += d;
          if (pick.melee) heals += d * cs.lifesteal;
          if (pick.burn) {
            const dps = (0.3 * d) / burnDur;
            if (burns.length < burnMax) burns.push({ until: t + burnDur, dps });
            else {
              burns.sort((x, y) => x.dps - y.dps);
              if (burns[0].dps < dps) burns[0] = { until: t + burnDur, dps };
            }
          }
        }
        for (let i = 0; i < pick.poisonStacks; i++) {
          const s = { until: t + 6, dps: pick.poisonDps * (1 + bd) * mitig };
          if (poisons.length < poisonMax) poisons.push(s);
          else { poisons.sort((x, y) => x.until - y.until); poisons[0] = s; }
        }
        if (pick.detonate && poisons.length) {
          dmg += pick.detonate * poisons.reduce((s, x) => s + x.dps * (x.until - t), 0);
          poisons = [];
        }
        froidAcc += pick.froid;
        for (; froidAcc >= 1; froidAcc--) {
          if (froid.length < 3) froid.push(t + froidDur);
          else { froid.sort((x, y) => x - y); froid[0] = t + froidDur; }
        }
        if (pick.poise) {
          poiseAcc = poiseAcc.filter((x) => x.t > t - 3.5);
          poiseAcc.push({ t, p: pick.poise });
          if (poiseAcc.reduce((s, x) => s + x.p, 0) >= poiseThreshold) { staggers++; poiseAcc = []; }
        }
      }
    }
    t += dt;
  }
  const dps = dmg / T;
  // incoming damage
  const hitsPerS = 1 / mon.interval;
  const rawPerS = mon.atk * (1 + mon.heavyShare * (mon.heavyMult - 1)) * hitsPerS;
  const pMitig = K(L) / (K(L) + cs.def);
  const guard = alloc.alloc.fond_garde ? (gear.offhand === 'bouclier' ? 0.25 * gear.block : 0.1 * (martialOf(gear) ? 0.5 : 0.3)) : 0;
  // control: cold slows attacks (−15 % per stack), staggers cancel an attack and stop the monster 0.9 s
  const coldAvg = froidTime / T;
  // Hiver éternel: 3 stacks freeze a non-boss 1.2 s, then 8 s of immunity
  if (effects.some((e) => e.stat === 'froidToGel') && coldAvg >= 1.5) ctrlTime += (1.2 / 9.2) * T;
  const control = Math.min(0.4, 0.1 * coldAvg + (staggers * 0.9 + ctrlTime) / T); // Froid: −10 % attack speed per stack
  let dr = 0;
  for (const a of abil) {
    if (!a.buff || !uses[a.id]) continue;
    const up = Math.min(1, (uses[a.id] * (a.dur || 0)) / T);
    if (a.buff.dmgTakenPct) dr += -a.buff.dmgTakenPct * up;
    if (a.buff.defPct) dr += a.buff.defPct * 0.4 * up;
  }
  const inPerS = rawPerS * pMitig * exposure * (1 + cs.dmgTaken) * (1 - guard) * (1 - Math.min(0.5, dr)) * (1 - control);
  // sustain (heals, lifesteal, shields over the 60 s) lowers the net damage intake, at most by half
  const heavyHit = mon.atk * pMitig * exposure; // one normal hit avoided per i-frame dash (the roll is common to all)
  const sustain = (heals + shields + dodged * heavyHit) / T; // an i-frame dash dodges one heavy attack
  const net = Math.max(inPerS - sustain, 0.5 * inPerS); // heals are cast only when needed and can be interrupted
  const pool = cs.mhp;
  const ttd = pool / net;
  const kpl = (dps / mon.hp) * ttd;
  return { dps, ttd, kpl, ehp: pool / pMitig, heals, uses, control: +control.toFixed(3), staggers, inPerS: +inPerS.toFixed(1), sustain: +sustain.toFixed(1), coldAvg: +coldAvg.toFixed(2) };
}

// ------------------------------------------------------------------ evaluate
function evaluate(b, L, exposure, gearOverride) {
  const { alloc, v } = gearOverride?.alloc ? { alloc: gearOverride.alloc, v: validateTree(tree, b.cls, L, gearOverride.alloc, gearOverride.gift || [], { legacyFloor: gearOverride.legacyFloor }) } : allocate(b, L);
  if (!v.ok) throw new Error(`${b.id} niv. ${L} : allocation invalide ${JSON.stringify(v)}`);
  const effects = collectEffects(tree, b.cls, alloc);
  const gear = gearOverride?.gear || gearStats(b.gear, L);
  const cs = charStats(b, L, effects, gear);
  const unlocked = unlockedAbilities(tree, b.cls, alloc);
  const ctxAlloc = { alloc, unlocked };
  const abil = [];
  for (const id of unlocked) {
    const a = AB.get(id);
    if (!a || a.home === null) continue; // Fondamentaux are identical for everyone
    const r = resolve(b, L, id, effects, cs, gear, ctxAlloc);
    if (r) abil.push(r);
  }
  const f = fight(b, L, abil, cs, gear, exposure, ctxAlloc, effects);
  return { build: b.id, cls: b.cls, L, spent: v.spent, budget: v.budget, nodes: Object.keys(alloc).length, stats: { mhp: Math.round(cs.mhp), mmp: Math.round(cs.mmp), atk: Math.round(cs.atk), def: Math.round(cs.def), crit: +cs.crit.toFixed(2) }, abil, ...f };
}

// calibration on the v0.2 kit (migration preset + v0.2 weapons/armour, levels 5 / 10 / 14 as in docs/EQUILIBRAGE.md)
function v02Gear(cls, L) {
  const g = V02_GEAR[cls][L];
  const w = V01_ITEMS[g.w], a = V01_ITEMS[g.a];
  const f = FAM[w.f];
  return { poiseMult: f.poise || 1, stMult: f.st || 1, atk: w.atk, def: a.def, mp: (w.mp || 0) + (a.mp || 0), hp: a.hp || 0, crit: w.crit || 0, weaponFamily: w.f, tags: new Set(f.tags), hands: f.hands, cdMult: 1, offhand: null, armor: 'cuir' };
}
const calib = {};
{
  const ratios = { warrior: [], mage: [], ranger: [] };
  for (const L of [5, 10, 14]) {
    const raw = {};
    for (const cls of ['warrior', 'mage', 'ranger']) {
      const b = { id: 'v02_' + cls, cls, gear: {}, at: {} };
      const p = tree.migration.presets[cls];
      const alloc = Object.fromEntries(p.nodes.map((id) => [id, 1]));
      raw[cls] = evaluate(b, L, 1, { alloc, gift: tree.rules.migration.gift, legacyFloor: tree.rules.migration.legacyFloor[cls], gear: v02Gear(cls, L) });
    }
    const mean = Object.values(raw).reduce((s, r) => s + r.kpl, 0) / 3;
    for (const cls of Object.keys(raw)) ratios[cls].push(raw[cls].kpl / mean);
  }
  for (const cls of Object.keys(ratios)) {
    const g = Math.exp(ratios[cls].reduce((s, r) => s + Math.log(r), 0) / ratios[cls].length);
    calib[cls] = { exposure: +g.toFixed(3), ratiosAtExposure1: ratios[cls].map((r) => +r.toFixed(2)) };
  }
}

const results = [];
for (const b of BUILDS) for (const L of Object.keys(b.at).map(Number)) results.push({ ...evaluate(b, L, calib[b.cls].exposure), hybrid: !!b.hybrid, name: b.name });

// ------------------------------------------------------------------ report
const LEVELS = [5, 15, 30];
const summary = { levels: {}, hybrids: [], ok: true, calibration: calib };
for (const L of LEVELS) {
  const pure = results.filter((r) => r.L === L && !r.hybrid);
  const byCls = {};
  for (const r of pure) (byCls[r.cls] = byCls[r.cls] || []).push(r);
  const clsScore = Object.fromEntries(Object.entries(byCls).map(([c, rs]) => [c, rs.reduce((s, r) => s + r.kpl, 0) / rs.length]));
  const mean = Object.values(clsScore).reduce((s, x) => s + x, 0) / 3;
  const dev = Object.fromEntries(Object.entries(clsScore).map(([c, s]) => [c, +((s / mean - 1) * 100).toFixed(1)]));
  const maxDev = Math.max(...Object.values(dev).map(Math.abs));
  const buildDev = Object.fromEntries(pure.map((r) => [r.build, +((r.kpl / mean - 1) * 100).toFixed(1)]));
  const lvlOk = maxDev <= 15 && Object.values(buildDev).every((d) => Math.abs(d) <= 25);
  summary.levels[L] = { classScore: Object.fromEntries(Object.entries(clsScore).map(([c, s]) => [c, +s.toFixed(2)])), deviationPct: dev, maxDeviationPct: +maxDev.toFixed(1), buildDeviationPct: buildDev, ok: lvlOk };
  if (!lvlOk) summary.ok = false;
}
for (const r of results.filter((x) => x.hybrid)) {
  const pures = results.filter((x) => !x.hybrid && x.cls === r.cls && x.L === r.L);
  const best = pures.reduce((a, b) => (a.kpl > b.kpl ? a : b));
  const ratio = r.kpl / best.kpl;
  const ok = ratio >= 0.8 && ratio <= 1.0;
  if (!ok) summary.ok = false;
  summary.hybrids.push({ build: r.build, L: r.L, kpl: +r.kpl.toFixed(2), bestPure: best.build, bestPureKpl: +best.kpl.toFixed(2), ratioPct: +(ratio * 100).toFixed(1), ok });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, results: results.map((r) => ({ ...r, abil: r.abil.map((a) => ({ id: a.id, dmg: +a.dmg.toFixed(1), cd: +a.cd.toFixed(2), mp: a.mp, st: a.st, inapt: a.inapt, weaponMult: a.weaponMult, powerMult: a.powerMult })) })) }, null, 1));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (x, d = 1) => x.toFixed(d).replace('.', ',');
  console.log('=== Équilibrage rapide v0.3 (modèle analytique) ===');
  console.log('Calibrage (exposition aux coups, kit v0.2 niveaux 5/10/14) :', Object.entries(calib).map(([c, v]) => `${c} ${num(v.exposure, 3)}`).join(' · '));
  console.log('\n| Niv. | Build | Points | PV | Att. | Déf. | DPS | Contrôle | Survie (s) | Victimes par vie |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) console.log(`| ${r.L} | ${r.hybrid ? '*' : ''}${r.build} | ${r.spent}/${r.budget} | ${r.stats.mhp} | ${r.stats.atk} | ${r.stats.def} | ${num(r.dps)} | ${Math.round(r.control * 100)} % | ${num(r.ttd)} | ${num(r.kpl, 2)} |`);
  console.log('\n| Niv. | Guerrier | Mage | Rôdeur | Écart max |');
  console.log('|---|---|---|---|---|');
  for (const L of LEVELS) {
    const s = summary.levels[L];
    console.log(`| ${L} | ${num(s.classScore.warrior, 2)} (${s.deviationPct.warrior} %) | ${num(s.classScore.mage, 2)} (${s.deviationPct.mage} %) | ${num(s.classScore.ranger, 2)} (${s.deviationPct.ranger} %) | ${s.maxDeviationPct} % ${s.ok ? 'OK' : 'HORS CIBLE'} |`);
  }
  console.log('\n| Hybride | Niv. | Victimes/vie | Meilleur pur | Ratio | Cible 80–100 % |');
  console.log('|---|---|---|---|---|---|');
  for (const h of summary.hybrids) console.log(`| ${h.build} | ${h.L} | ${num(h.kpl, 2)} | ${h.bestPure} (${num(h.bestPureKpl, 2)}) | ${h.ratioPct} % | ${h.ok ? 'OK' : 'HORS CIBLE'} |`);
  if (VERBOSE) for (const r of results) {
    console.log(`\n${r.build} niv. ${r.L} — dégâts subis ${r.inPerS}/s, soins ${r.sustain}/s, froid moyen ${r.coldAvg}, déséquilibres ${r.staggers} — utilisations 60 s : ${JSON.stringify(r.uses)}`);
    for (const a of r.abil) console.log(`   ${pad(a.id, 20)} dmg/usage ${num(a.dmg)} cd ${num(a.cd, 2)} mana ${a.mp} end. ${a.st}${a.inapt ? ` INAPTE ×${a.powerMult}` : ''}${a.weaponMult !== 1 ? ` arme ×${a.weaponMult}` : ''}`);
  }
  console.log(summary.ok ? '\nRÉSULTAT : OK (classes à ±15 %, hybrides entre 80 et 100 % du pur)' : '\nRÉSULTAT : HORS CIBLE');
}
process.exit(summary.ok ? 0 : 1);
