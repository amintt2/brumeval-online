// Merge the loot and crafting drafts into the final, mutually consistent data:
//   docs/design/items.json    (families, bases, uniques, consumables, sets, lines, affixes, rarities, drop tables, forge, salvage)
//   docs/design/crafting.json (materials, gathering nodes, professions, recipes, crafted sets, plans, rules)
// Run: node docs/design/tools/build_items.mjs
// Decisions (see OBJETS_ARTISANAT.md §10): monster tiers/levels come from the crafting draft (bandit T3, troll T6);
// crafted items that duplicated a loot base by name reuse the loot id; every crafted gear piece gets a base entry
// computed with the loot formulas; icons use the Codex CX-12 family naming (<famille>_tN) except v0.1 items and uniques.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = path.resolve(HERE, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DESIGN, 'drafts', f), 'utf8'));
const I = read('items.json');
const C = read('crafting.json');
const log = [];

// ------------------------------------------------------------------ icons (Codex CX-12 naming + extensions)
export const FAMILY_ICON = {
  epee_courte: 'shortsword', epee_longue: 'sword', epee_batarde: 'bastard', rapiere: 'rapier', cimeterre: 'scimitar',
  lame_courbe: 'curved', espadon: 'greatsword', epee_runique: 'runesword', hache: 'axe', masse: 'mace', lance: 'spear',
  dague: 'dagger', baton: 'staff', sceptre: 'sceptre', arc_court: 'bow', arc_long: 'longbow', arbalete: 'crossbow',
  bouclier: 'shield', grimoire: 'tome', carquois: 'quiver',
};
const ARMOR_ICON = { plaques: 'plate', cuir: 'leather', tissu: 'cloth' };
const SLOT_ICON = { head: 'helm', chest: 'chest', hands: 'gloves', feet: 'boots' };
const tierNum = (t) => Number(String(t).replace('T', ''));
function iconFor(b) {
  const t = tierNum(b.tier);
  if (b.family && FAMILY_ICON[b.family]) return `${FAMILY_ICON[b.family]}_t${t}`;
  if (b.armor) return `${SLOT_ICON[b.slot]}_${ARMOR_ICON[b.armor]}_t${t}`;
  if (b.slot === 'ring') return `ring_t${t}`;
  if (b.slot === 'amulet') return `amulet_t${t}`;
  return b.icon;
}

// ------------------------------------------------------------------ formulas (items.meta.formulas)
const fam = I.families;
const ARMOR_DEF = { plaques: 1, cuir: 0.6, tissu: 0.35 };
const SHARE = { head: 0.22, chest: 0.4, hands: 0.18, feet: 0.2 };
const weaponAtk = (lvl, f) => Math.round((3 + 1.6 * lvl) * (fam[f]?.atk ?? 1));
const armorDef = (lvl, type, slot) => Math.round((6 + 3.2 * lvl) * ARMOR_DEF[type] * SHARE[slot]);
const clothMana = (lvl, slot) => Math.round((10 + 4 * lvl) * SHARE[slot]);
const focusMana = (lvl, f) => Math.round((4 + 2 * lvl) * (fam[f]?.mp ?? 0));
const tierOfLvl = (lvl) => (lvl <= 5 ? 1 : lvl <= 10 ? 2 : lvl <= 15 ? 3 : lvl <= 20 ? 4 : lvl <= 25 ? 5 : 6);
const sellOf = (lvl, mult = 1) => Math.round((5 + 0.6 * lvl * lvl) * mult);

// ------------------------------------------------------------------ 1. id reconciliation
const RENAME = { ring_copper: 'copper_ring', scimitar_goblin: 'goblin_scimitar', scimitar_sands: 'redsand_scimitar', quiver_chitin: 'chitin_quiver', ring_frost: 'frost_ring' };
for (const r of C.recipes) if (RENAME[r.output.item]) {
  log.push(`recette ${r.id} : ${r.output.item} -> ${RENAME[r.output.item]} (même objet que le butin)`);
  r.output.item = RENAME[r.output.item];
}

// ------------------------------------------------------------------ 2. bases: loot bases + crafted gear
const bases = structuredClone(I.bases);
const uniques = structuredClone(I.uniques);
const consumables = {};
const GEAR_SLOTS = new Set(['weapon', 'offhand', 'head', 'chest', 'hands', 'feet', 'ring', 'amulet']);
const AFFIX = I.affixes;
const affixMid = (id, lvl) => {
  const a = AFFIX[id];
  if (!a) return 0;
  const lo = a.range['1'], hi = a.range['30'];
  const t = (lvl - 1) / 29;
  const v = ((lo[0] + lo[1]) / 2) * (1 - t) + ((hi[0] + hi[1]) / 2) * t;
  return v < 1 ? +v.toFixed(3) : Math.round(v);
};
for (const r of C.recipes) {
  const o = r.output;
  const id = o.item;
  if (bases[id] || uniques[id]) {
    bases[id] && (bases[id].crafted = true);
    continue;
  }
  if (o.slot && GEAR_SLOTS.has(o.slot)) {
    const lvl = o.ilvl || r.lvl;
    const tier = `T${r.tier || tierOfLvl(lvl)}`;
    const b = { name: o.name, slot: o.slot, tier, lvl, crafted: true };
    if (o.slot === 'weapon') {
      b.family = o.family;
      b.hands = fam[o.family]?.hands ?? 1;
      b.atk = weaponAtk(lvl, o.family);
      if (fam[o.family]?.mp) b.mp = focusMana(lvl, o.family);
    } else if (o.slot === 'offhand') {
      b.family = o.family;
      if (o.family === 'bouclier') Object.assign(b, { def: Math.round(2 + 1.3 * lvl), block: Math.min(90, 60 + lvl), guardStamina: 0.8 });
      if (o.family === 'grimoire') Object.assign(b, { mp: Math.round(8 + 3 * lvl), atk: Math.max(1, Math.round(lvl / 4)) });
      if (o.family === 'carquois') Object.assign(b, { atk: Math.max(1, Math.round(lvl / 4)), crit: 0.02 });
    } else if (SHARE[o.slot]) {
      b.armor = o.armor;
      b.def = armorDef(lvl, o.armor, o.slot);
      if (o.armor === 'tissu') b.mp = clothMana(lvl, o.slot);
      if (r.set) { b.line = r.set; b.craftedSet = r.set; }
    } else if (o.slot === 'ring' || o.slot === 'amulet') {
      const aff = r.signature || 'vitalite';
      b.implicit = [[aff, affixMid(aff, lvl)]];
    }
    b.sell = sellOf(lvl);
    b.price = 0;
    b.icon = iconFor(b);
    bases[id] = b;
    continue;
  }
  // consumables, bags, forge stones, refined materials handled below
  if (C.materials.some((m) => m.id === id)) continue;
  const c = { name: o.name, type: 'consumable', icon: o.icon || id, stack: 20 };
  if (/^potion_|^elixir_/.test(id)) c.type = id.startsWith('elixir_') ? 'elixir' : 'potion';
  if (/^oil_/.test(id)) c.type = 'oil';
  if (/^bag_/.test(id)) Object.assign(c, { type: 'bag', stack: 1, bagSlots: o.bagSlots, slot: 'bag', icon: id });
  if (/^forge_stone_/.test(id)) Object.assign(c, { type: 'forge_stone', stack: 99, use: o.use });
  if (o.effect) c.effect = o.effect;
  consumables[id] = c;
}
// v0.1 potions (kept as they are), forge stone names/levels from the loot draft
const LEGACY_CONS = {
  potion_hp_s: { name: 'Petite potion de soin', type: 'potion', icon: 'potion_hp_s', heal: 60, stack: 20, price: 10, sell: 2, rarity: 'common', effect: 'Rend 60 PV.', legacy: true },
  potion_hp_l: { name: 'Grande potion de soin', type: 'potion', icon: 'potion_hp_l', heal: 220, stack: 20, price: 45, sell: 10, rarity: 'uncommon', effect: 'Rend 220 PV.', legacy: true },
  potion_mp_s: { name: 'Potion de mana', type: 'potion', icon: 'potion_mp_s', mana: 70, stack: 20, price: 15, sell: 3, rarity: 'common', effect: 'Rend 70 points de mana.', legacy: true },
};
for (const [id, v] of Object.entries(LEGACY_CONS)) consumables[id] = { ...(consumables[id] || {}), ...v };
for (const [id, s] of Object.entries(I.dropTables.stones)) consumables[id] = { ...(consumables[id] || {}), name: s.name, type: 'forge_stone', stack: s.stack, sell: s.sell, levels: s.levels, icon: `forge_stone_${Object.keys(I.dropTables.stones).indexOf(id) + 1}` };
for (const c of Object.values(consumables)) if (c.type === 'potion' && !c.icon) c.icon = 'potion';

// icons of loot bases -> CX-12 family icons (legacy v0.1 ids keep their existing icon)
for (const [id, b] of Object.entries(bases)) {
  if (b.legacy) continue;
  b.icon = iconFor(b);
}
for (const [id, u] of Object.entries(uniques)) u.icon = `uq_${id}`;

// 3D models held in hand (Codex CX-3 / CX-3b naming eq_<family>_<n>); see ASSET_REQUESTS.md
// existing (CX-3 + CX-3b): sword 1..5, greatsword 1..4, staff 1..4, bow 1..4, shield 1..3, other families 1..2
// requested for v0.3: a 3rd look for every sword family (T5–T6), eq_sword_6, eq_greatsword_5, eq_uq_<id> for uniques
const EQ = {
  epee_longue: (t) => `eq_sword_${Math.min(t, 6)}`,
  espadon: (t) => `eq_greatsword_${t <= 2 ? t : t <= 4 ? 3 : t === 5 ? 4 : 5}`,
  baton: (t) => `eq_staff_${t <= 2 ? t : t <= 4 ? 3 : 4}`,
  arc_court: (t) => `eq_bow_${t <= 3 ? 1 : 2}`,
  arc_long: (t) => `eq_bow_${t <= 3 ? 3 : 4}`,
  bouclier: (t) => `eq_shield_${Math.ceil(t / 2)}`,
};
const SWORD3 = new Set(['epee_courte', 'epee_batarde', 'rapiere', 'cimeterre', 'lame_courbe', 'epee_runique']);
function modelFor(b) {
  const t = tierNum(b.tier);
  if (EQ[b.family]) return EQ[b.family](t);
  const key = FAMILY_ICON[b.family];
  if (SWORD3.has(b.family)) return `eq_${key}_${t <= 2 ? 1 : t <= 4 ? 2 : 3}`;
  return `eq_${key}_${t <= 3 ? 1 : 2}`;
}
for (const b of Object.values(bases)) if (b.slot === 'weapon' || b.slot === 'offhand') b.model = modelFor(b);
for (const [id, u] of Object.entries(uniques)) u.model = `eq_uq_${id}`;

// balance (tools/balance.mjs): the very large potion healed a mage for its whole life bar every 20 s
if (consumables.potion_hp_xl) Object.assign(consumables.potion_hp_xl, { heal: 400, effect: 'Rend 400 PV.' });
for (const [id, v] of Object.entries({ potion_hp_m: 140, potion_hp_l: 220 })) if (consumables[id]) consumables[id].heal = v;
if (consumables.potion_hp_s) consumables.potion_hp_s.heal = 60;
for (const c of Object.values(consumables)) if (c.type === 'potion' || c.type === 'elixir') c.cooldownGroup = c.type === 'potion' ? 'potion' : 'elixir';

// ------------------------------------------------------------------ 3. lines (armour series): loot + crafted
const lines = structuredClone(I.lines);
const TYPE = { plate: 'plaques', leather: 'cuir', cloth: 'tissu' };
for (const s of C.sets) {
  if (lines[s.id]) {
    lines[s.id].craftedSet = s.id;
    continue;
  }
  const pieces = {};
  for (const pid of s.pieces) pieces[bases[pid]?.slot || '?'] = pid;
  lines[s.id] = { name: s.name, type: TYPE[s.weight], tier: `T${s.tier}`, lvl: s.lvl, source: `artisanat (${{ forge: 'Forge', tailoring: 'Couture et tannerie', alchemy: 'Alchimie' }[s.prof]})`, set: null, craftedSet: s.id, pieces };
}

// ------------------------------------------------------------------ 4. materials + drop tables
const materials = structuredClone(C.materials);
// scarlet mark: red-zone currency material (was only in the loot draft)
materials.push({
  id: 'scarlet_mark', name: 'Marque écarlate', type: 'material', kind: 'monster', tier: 6, rarity: 'rare', stack: 50, sell: 40,
  icon: 'scarlet_mark', desc: "Un sceau de sang séché arraché aux champions des zones rouges. Les forgerons d'Aldmar l'échangent contre leurs meilleures pierres.",
  sources: [{ monster: 'scarlet_champion', ch: 1, qty: [3, 5] }, { redZoneElite: true, ch: 0.2, qty: [1, 1] }],
});
for (const m of materials) for (const s of m.sources || []) if (s.monster === 'red_zone_elite') { delete s.monster; s.redZoneElite = true; }
for (const [mid, ch] of [['rune_shard', 0.5], ['crystal_shard', 0.5]]) materials.find((m) => m.id === mid).sources.push({ monster: 'scarlet_champion', ch, qty: [1, 2] });

const monsters = {};
const craftDrops = C.monsterDrops;
for (const [id, d] of Object.entries(I.dropTables.monsters)) {
  const c = craftDrops[id];
  const out = { ...d };
  if (c) {
    out.tier = `T${c.tier}`;
    out.lvl = c.lvl;
    if (d.tier !== out.tier) log.push(`monstre ${id} : palier ${d.tier} -> ${out.tier} (niveaux ${c.lvl})`);
    out.materials = c.drops.map(([mid, ch, qty]) => [mid, ch, qty]);
  } else if (id === 'scarlet_champion') {
    out.lvl = [28, 30];
    out.materials = [['scarlet_mark', 1, [3, 5]], ['rune_shard', 0.5, [1, 2]], ['crystal_shard', 0.5, [1, 2]]];
    out.redZoneOnly = true;
  }
  monsters[id] = out;
}
const redZoneElite = { ...craftDrops.red_zone_elite, drops: [...craftDrops.red_zone_elite.drops, ['scarlet_mark', 0.2, [1, 1]]] };
delete redZoneElite.tier;

const dropTables = { ...structuredClone(I.dropTables), monsters, redZoneElite };
delete dropTables.materials; // materials are defined once, in crafting.json
dropTables.materialsNote = 'Les matériaux (nom, icône, sources) sont définis dans crafting.json › materials ; les tables ci-dessus donnent [id, chance, [min, max]].';

// ------------------------------------------------------------------ 5. recipes additions
const recipes = structuredClone(C.recipes);
for (const r of recipes) if (r.output.item === 'potion_hp_xl') r.output.effect = 'Rend 400 PV.';
for (const r of recipes) {
  const b = bases[r.output.item] || consumables[r.output.item];
  if (b?.icon) r.output.icon = b.icon; // one icon per item, the one in items.json
}
recipes.push({
  id: 'r_forge_stone_scarlet', name: 'Pierre ancestrale (marques écarlates)', prof: 'forge', station: 'forge', lvl: 25, tier: 6,
  inputs: [['scarlet_mark', 4], ['forge_stone_cut', 2]], output: { item: 'forge_stone_ancestral', qty: 1, name: 'Pierre de forge ancestrale', icon: 'forge_stone_3' },
  quality: 'none', learn: { from: 'trainer', npc: 'blacksmith', price: 400 }, fee: 20, xp: 60,
});

// ------------------------------------------------------------------ 6. meta, soft rules aligned with the tree
const meta = structuredClone(I.meta);
meta.version = 'v0.3-final-1';
meta.generatedBy = 'docs/design/tools/build_items.mjs (à partir de docs/design/drafts/items.json et crafting.json)';
meta.softRules.spellsWithoutFocus = "sort lancé sans focalisateur : −20 % de puissance ; avec une épée runique (focalisateur_partiel) ou un grimoire en main gauche : −10 % ; bâton ou sceptre : pleine puissance (règle commune avec l'Arbre des Brumes).";
meta.softRules.meleeRequirement = "les compétences « melee » de l'arbre demandent une arme portant l'étiquette melee sans l'étiquette focalisateur (le bâton et le sceptre ne suffisent pas, sauf clé de voûte Érudit martial)";
meta.softRules.beltKnife = "les compétences « dague » du Rôdeur utilisent le couteau de ceinture : toujours disponibles avec une arme « distance » (dégâts de l'arme ×0,8) ou une arme de mêlée à une main";
meta.potionCooldown = 'Toutes les potions de soin et de mana partagent une recharge de 20 s (0,8 s pour boire, annulée par une roulade) : la fiole reste un choix tactique, comme dans un soulslike.';
meta.icons = "Icônes : familles Codex CX-12 « <famille>_tN » (sword_t3, helm_plate_t2, ring_t5…) ; ids v0.1 : icônes existantes ; objets uniques : « uq_<id> ».";
meta.damageFormula = 'dégâts = atk × puissance × (0,85..1,15) × crit × K / (K + déf), K = 60 + 6 × max(0, niveau de l’attaquant − 10) (proposition v0.3 : les armures T5–T6 ne rendent pas invulnérable)';

// ------------------------------------------------------------------ 7. critic pass (économie) — OBJETS_ARTISANAT.md §10 bis
// Fabriquer ne doit jamais créer d'or ni d'essence : (1) un objet fabriqué se revend au marchand pour la valeur de ses
// matériaux, pas avec la formule du butin (×2 à ×8 selon la qualité) ; (2) il se recycle en chutes seulement, sans
// essence ni pierre ; (3) les filons sont grisés par compte (pas de tournée avec ses autres personnages).
const salvage = structuredClone(I.salvage);
const rules = structuredClone(C.rules);
const criticChanges = [];
const sellOfInput = (id) => materials.find((m) => m.id === id)?.sell ?? consumables[id]?.sell ?? bases[id]?.sell ?? 0;
let worstBefore = 0;
for (const r of recipes) {
  if (r.quality !== 'gear') continue;
  const value = r.inputs.reduce((s, [id, q]) => s + sellOfInput(id) * q, 0);
  const b = bases[r.output.item];
  const lootSell = b ? Math.round((b.sell || 0) * 2) : 0; // Inhabituel au minimum
  worstBefore = Math.max(worstBefore, lootSell / Math.max(1, value + (r.fee || 0)));
  r.vendorValue = value;
}
rules.craftedSell = "Un objet fabriqué (drapeau « crafted » posé à la fabrication, quelle que soit sa qualité) se revend au marchand pour la valeur de ses matériaux (recipe.vendorValue = somme des prix de vente des ingrédients), jamais avec la formule du butin. Il reste échangeable et vendable aux joueurs à n'importe quel prix.";
rules.recycling = "Voir items.json (salvage). Un objet fabriqué ne rend que des chutes (1 à 2, selon son type), jamais d'essence ni de pierre (sauf 50 % des pierres de forge dépensées dessus). Les chutes se reconvertissent en lingots, lanières, tissu et bois (recettes r_salvage_*).";
rules.gathering = rules.gathering.replace('grisé pour vous 3 min', 'grisé 3 min pour tout votre compte (tous vos personnages)');
salvage.crafted = "Objet fabriqué (drapeau « crafted ») : 1–2 chutes de son type, ni essence ni pierre (sauf 50 % des pierres de forge dépensées). Sinon, fabriquer un ensemble du loup pour le recycler transformait des fourrures en essences violines.";
salvage.setPieces = "Pièces d'ensemble de butin (Épiques) : 1 essence violine. Pièces d'ensemble fabriquées : règle des objets fabriqués (chutes seulement).";
criticChanges.push(
  { target: 'vente des objets fabriqués', what: 'valeur des matériaux (recipe.vendorValue)', why: `Revendus avec la formule du butin, les objets fabriqués rapportaient jusqu'à ×${worstBefore.toFixed(1)} la valeur de leurs matériaux et frais : fabriquer pour le marchand imprimait de l'or.` },
  { target: 'recyclage des objets fabriqués', what: 'chutes seulement, ni essence ni pierre', why: 'Une Capuche du loup (3 fourrures) rendait 2 fourrures + 1 essence violine : les essences épiques devenaient une ressource de palier 1.' },
  { target: 'récolte', what: 'filon grisé par compte', why: 'Changer de personnage multipliait la récolte par le nombre de personnages du compte.' },
);
meta.criticChanges = criticChanges;
meta.formulas.sell += " ; objets fabriqués : valeur des matériaux (crafting.json › rules.craftedSell)";

const families = structuredClone(I.families);
families.epee_runique.special = families.epee_runique.special.replace('(au lieu de −30 %)', '(au lieu de −20 %)');
const items = {
  meta, families, bases, uniques, consumables, sets: I.sets, lines,
  affixes: I.affixes, rarities: I.rarities, dropTables, forge: I.forge, salvage,
};

const crafting = {
  version: 'v0.3-final-1',
  note: "Artisanat v0.3. Les statistiques des objets fabriqués sont celles d'items.json › bases (mêmes formules que le butin). Tables de butin des monstres : items.json › dropTables.monsters.",
  materials, nodes: C.nodes, professions: C.professions, recipes, sets: C.sets, plans: C.plans, rules,
};

fs.writeFileSync(path.join(DESIGN, 'items.json'), JSON.stringify(items, null, 1) + '\n');
fs.writeFileSync(path.join(DESIGN, 'crafting.json'), JSON.stringify(crafting, null, 1) + '\n');
console.log(`items.json : ${Object.keys(bases).length} bases, ${Object.keys(uniques).length} uniques, ${Object.keys(consumables).length} consommables, ${Object.keys(lines).length} séries, ${Object.keys(monsters).length} monstres`);
console.log(`crafting.json : ${materials.length} matériaux, ${recipes.length} recettes, ${C.sets.length} ensembles, ${C.plans.length} plans`);
for (const l of log) console.log('  ' + l);
