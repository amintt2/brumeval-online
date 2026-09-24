// [skilltree] L'Arbre des Brumes — pure rules shared by the server (authoritative) and the client (tree screen,
// tooltips, prediction): points, costs, Inaptitude, full-state validation, unlocked abilities, effects, ability
// resolution (variants → passives → Inaptitude → weapon → guardrails), action bar (loadout), v0.2 migration and
// Renaissance. Port of docs/design/tools/lib/treelib.mjs (reference implementation) + docs/design/DECISIONS.md.
// Data: shared/skilltree.js (generated from docs/design/skilltree.json by scripts/build-skilltree.mjs).
import TREE from './skilltree.js';
import { ITEMS } from './data.js';

export { TREE };
export const RULES = TREE.rules;
export const TREE_CLASSES = ['warrior', 'mage', 'ranger'];
export const CLASS_REGION = { warrior: 'guerrier', mage: 'mage', ranger: 'rodeur' };
export const REGION_CLASS = { guerrier: 'warrior', mage: 'mage', rodeur: 'ranger' };
export const CLASS_START = { warrior: 'guerrier_depart', mage: 'mage_depart', ranger: 'rodeur_depart' };
export const BRIDGE_CLASSES = { pont_gm: ['warrior', 'mage'], pont_mr: ['mage', 'ranger'], pont_rg: ['ranger', 'warrior'] };
export const BASE_ABILITY = { warrior: 'strike', mage: 'firebolt', ranger: 'shot' };
/** The v0.2 action bars (slots 1..4), kept for the migration mapping. */
export const V02_ABILITIES = {
  warrior: ['strike', 'heavy_blow', 'whirlwind', 'war_cry'],
  mage: ['firebolt', 'fireball', 'frost_nova', 'heal'],
  ranger: ['shot', 'piercing_shot', 'arrow_rain', 'rapid_fire'],
};

export const NODES = new Map(TREE.nodes.map((n) => [n.id, n]));
export const ABILITY_DEFS = new Map(TREE.abilities.map((a) => [a.id, a]));
export const STATUS_DEFS = new Map(TREE.statuses.map((s) => [s.id, s]));
export const FOND_IDS = TREE.nodes.filter((n) => n.fondamental).map((n) => n.id);

/** Fondamentaux and derived states: bound to their own keys / messages, never to the action bar. */
export const NOT_SLOTTABLE = new Set(['roulade', 'sprint', 'saut', 'garde', 'attaque_chargee', 'attaque_sautee', 'riposte_parfaite']);
export const LOADOUT_SLOTS = RULES.loadout?.slots || 8;
/** Max nodes per allocation message (docs/design §14.2). */
export const MAX_ALLOC_BATCH = 64;

// ------------------------------------------------------------------ Renaissance (DECISIONS.md §3)
export const RENAISSANCE = {
  level: 30,         // available at this level
  max: 5,            // « Né de la Brume I à V »
  xpPct: 0.15,       // +15 % XP per Renaissance
  inaptStep: 0.2,    // Inaptitude −5 points per Renaissance (−25 % → −20 % … → 0 %): 20 % of the penalty each
  points: 1,         // +1 skill point per Renaissance
  affinityAt: [2, 4], // a new affinity class at the 2nd and 4th Renaissance (every 2 cycles)
};
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
/** Title shown under the name (« Né de la Brume III »), '' before the first Renaissance. */
export const renaissanceTitle = (n) => (n > 0 ? `Né de la Brume ${ROMAN[Math.min(n, RENAISSANCE.max) - 1]}` : '');
/** Number of affinity classes a character with n Renaissances may have chosen. */
export const affinitySlots = (n) => RENAISSANCE.affinityAt.filter((k) => n >= k).length;

// ------------------------------------------------------------------ errors (French, shown to the player)
export const TREE_ERRORS = {
  tree_unknown: 'Nœud inconnu.',
  tree_points: 'Pas assez de points de compétence.',
  tree_gate: 'Apprenez d\'abord 3 Fondamentaux.',
  tree_link: 'Ce nœud n\'est pas relié à votre arbre.',
  tree_exclusive: 'Une autre variante de ce groupe est déjà choisie.',
  tree_rank: 'Rang maximum atteint.',
  tree_level: 'Niveau insuffisant pour ce nœud.',
  tree_req: 'Pas assez de points dépensés dans cette région.',
  tree_variant: 'Apprenez d\'abord la compétence que cette variante transforme.',
  tree_combat: 'Impossible pendant un combat.',
  loadout_bad: 'Barre d\'action invalide.',
};

// ------------------------------------------------------------------ points & costs
/** Skill points of `level` (1 per level from 2, +1 at every multiple of 5): 35 at level 30. */
export function points(level) {
  return Math.max(0, level - 1) + Math.floor(level / 5);
}

/** Point budget of a character: level points (v0.2 migration floor while higher) + 1 per Renaissance. */
export function budgetOf(level, skills = {}) {
  const p = points(level);
  const floor = skills.legacyFloor > 0 ? skills.legacyFloor : 0;
  return Math.max(p, floor) + (skills.rb || 0) * RENAISSANCE.points;
}

/** Cost of ONE rank of `node` for a character of class `cls` (+ affinity classes from Renaissances). */
export function nodeCost(node, cls, affinity = []) {
  const c = baseCost(node, cls);
  if (!affinity || !affinity.length || c <= 1) return c;
  let best = c;
  for (const a of affinity) {
    if (a === cls || !CLASS_REGION[a]) continue;
    const r = node.region;
    // an affinity class costs like one's own: its region, its start node and its neighbouring bridges cost 1
    if (r === CLASS_REGION[a] || node.start === a || (BRIDGE_CLASSES[r] && BRIDGE_CLASSES[r].includes(a))) best = Math.min(best, 1);
  }
  return best;
}

function baseCost(node, cls) {
  if (node.type === 'root') return 0;
  if (node.start) return node.start === cls ? 0 : RULES.costs.otherStart;
  const r = node.region;
  if (r === 'survie') return RULES.costs.survie;
  if (r === CLASS_REGION[cls]) return RULES.costs.ownRegion;
  if (BRIDGE_CLASSES[r]) {
    const near = BRIDGE_CLASSES[r].includes(cls);
    if (node.type === 'keystone') return near ? RULES.costs.ownRegion : RULES.costs.farBridgeKeystone;
    return near ? RULES.costs.nearBridge : RULES.costs.farBridge;
  }
  return node.type === 'keystone' ? RULES.costs.otherKeystone : RULES.costs.otherRegion;
}

/** Does an ability suffer Inaptitude for this class? (Survie abilities never do.) */
export function isInapt(ability, cls) {
  const h = ability.home;
  if (h == null) return false;
  return Array.isArray(h) ? !h.includes(cls) : h !== cls;
}

/** Home classes of an ability ([] for Survie). */
export const homesOf = (ability) => (ability.home == null ? [] : Array.isArray(ability.home) ? ability.home : [ability.home]);

// ------------------------------------------------------------------ validation
const allocEntries = (alloc) => (alloc instanceof Map ? [...alloc] : Object.entries(alloc || {}));

/**
 * Validate a COMPLETE tree state (docs/design §14.2): ids, ranks, minimum level, points, exclusive groups,
 * Fondamentaux gate, points spent per region, connectivity from the Cœur + own start, variants of known abilities.
 * skills = { alloc: { nodeId: rank }, gift: [nodeId], legacyFloor?, rb?, affinity? }.
 * Returns { ok: true, spent, budget } or { ok: false, code, node?, spent?, budget? }.
 */
export function validateTree(cls, level, skills) {
  const alloc = skills.alloc || {};
  const gift = skills.gift || [];
  const affinity = skills.affinity || [];
  const start = CLASS_START[cls];
  const giftSet = new Set(gift);
  const all = new Map(allocEntries(alloc));
  for (const g of gift) if (!all.has(g)) all.set(g, 1);
  let spent = 0;
  const groups = new Map();
  let fond = 0;
  let nonFond = 0;
  const regionPts = {};
  for (const [id, rank] of all) {
    const n = NODES.get(id);
    if (!n || n.type === 'root') return { ok: false, code: 'tree_unknown', node: id };
    if (n.start === cls) continue; // own start: implicit and free
    if (!(Number.isInteger(rank) && rank >= 1 && rank <= (n.maxRank || 1))) return { ok: false, code: 'tree_rank', node: id };
    if (n.minLevel && level < n.minLevel) return { ok: false, code: 'tree_level', node: id };
    if (giftSet.has(id) && !n.migrationGift) return { ok: false, code: 'tree_unknown', node: id };
    if (!giftSet.has(id)) {
      const c = nodeCost(n, cls, affinity) * rank;
      spent += c;
      regionPts[n.region] = (regionPts[n.region] || 0) + c;
    }
    if (n.exclusiveGroup) {
      if (groups.has(n.exclusiveGroup)) return { ok: false, code: 'tree_exclusive', node: id };
      groups.set(n.exclusiveGroup, id);
    }
    if (n.fondamental) fond++;
    else nonFond++;
  }
  const budget = budgetOf(level, skills);
  if (spent > budget) return { ok: false, code: 'tree_points', spent, budget };
  if (nonFond > 0 && fond < RULES.gate.fondamentaux) return { ok: false, code: 'tree_gate' };
  for (const [id] of all) {
    const n = NODES.get(id);
    if (!n.reqRegionPoints || n.start === cls) continue;
    const have = regionPts[n.reqRegionPoints.region] || 0;
    const self = giftSet.has(id) ? 0 : nodeCost(n, cls, affinity) * (all.get(id) || 1); // the node itself does not count
    if (have - self < n.reqRegionPoints.min) return { ok: false, code: 'tree_req', node: id };
  }
  // connectivity from the Cœur + own start
  const seen = new Set(['coeur', start]);
  const queue = ['coeur', start];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of NODES.get(cur).links) {
      if (!seen.has(nb) && all.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  for (const [id] of all) if (!seen.has(id)) return { ok: false, code: 'tree_link', node: id };
  const unlocked = unlockedAbilities(cls, all);
  for (const [id] of all) {
    const n = NODES.get(id);
    if (n.type === 'variant' && n.ability && !unlocked.has(n.ability)) return { ok: false, code: 'tree_variant', node: id };
  }
  return { ok: true, spent, budget };
}

/** Points spent (gifts are free). */
export function spentOf(cls, skills) {
  let s = 0;
  const gift = new Set(skills.gift || []);
  for (const [id, rank] of allocEntries(skills.alloc)) {
    const n = NODES.get(id);
    if (!n || gift.has(id) || n.start === cls) continue;
    s += nodeCost(n, cls, skills.affinity || []) * rank;
  }
  return s;
}

/**
 * Add ranks to a tree state, all or nothing. `adds` = [nodeId | { id, r? }] (r = ranks to add, default 1).
 * Returns { ok: true, alloc, spent, budget } (a NEW alloc object) or { ok: false, code, node? }.
 */
export function allocate(cls, level, skills, adds) {
  if (!Array.isArray(adds) || adds.length === 0 || adds.length > MAX_ALLOC_BATCH) return { ok: false, code: 'tree_unknown' };
  const alloc = { ...(skills.alloc || {}) };
  const gift = new Set(skills.gift || []);
  for (const a of adds) {
    const id = typeof a === 'string' ? a : a && typeof a.id === 'string' ? a.id : null;
    const r = typeof a === 'object' && a !== null && a.r !== undefined ? a.r : 1;
    if (!id || !NODES.has(id) || !Number.isInteger(r) || r < 1 || r > 3) return { ok: false, code: 'tree_unknown', node: id };
    if (NODES.get(id).start === cls || gift.has(id)) return { ok: false, code: 'tree_rank', node: id };
    alloc[id] = (alloc[id] || 0) + r;
  }
  const res = validateTree(cls, level, { ...skills, alloc });
  if (!res.ok) return res;
  return { ok: true, alloc, spent: res.spent, budget: res.budget };
}

/** Abilities unlocked by an allocation (+ gifts): the own start's base attack is always there. */
export function unlockedAbilities(cls, alloc, gift = []) {
  const ids = alloc instanceof Map ? [...alloc.keys()] : Object.keys(alloc || {});
  const out = new Set();
  for (const e of NODES.get(CLASS_START[cls]).effects) if (e.mod === 'unlock') out.add(e.value);
  for (const id of [...ids, ...gift]) {
    const n = NODES.get(id);
    if (!n) continue;
    for (const e of n.effects || []) if (e.mod === 'unlock') out.add(e.value);
  }
  // derived abilities come with their parent
  if (out.has('saut')) out.add('attaque_sautee');
  return out;
}

/** Every effect of an allocation (+ own start + gifts), expanded by rank. */
export function collectEffects(cls, alloc, gift = []) {
  const out = [];
  const entries = allocEntries(alloc);
  for (const g of gift) if (!entries.some(([id]) => id === g)) entries.push([g, 1]);
  entries.push([CLASS_START[cls], 1]);
  for (const [id, rank] of entries) {
    const n = NODES.get(id);
    if (!n) continue;
    for (const e of n.effects || []) {
      if (e.atRank && rank < e.atRank) continue;
      const mult = e.perRank ? rank : 1;
      out.push({ ...e, value: typeof e.value === 'number' ? e.value * mult : e.value, node: id });
    }
  }
  return out;
}

// ------------------------------------------------------------------ tree cache (effects indexed for fast resolution)
const STAT_CAPS = { lifestealMelee: 0.09, equilibre: 60, resFeu: 0.6, resGivre: 0.6, resArcane: 0.6, resPoison: 0.6 };

/**
 * Pre-computed view of a character's tree: unlocked abilities, ability modifiers grouped by ability,
 * unconditional stat sums and conditional stats. Rebuilt whenever the allocation changes.
 */
export function buildTree(cls, skills = {}) {
  const alloc = skills.alloc || {};
  const gift = skills.gift || [];
  const effects = collectEffects(cls, alloc, gift);
  const unlocked = unlockedAbilities(cls, alloc, gift);
  const mods = new Map();
  const stats = new Map();
  const sets = new Map();
  const cond = [];
  const nodes = new Set([...Object.keys(alloc), ...gift]);
  for (const e of effects) {
    if (e.mod && e.mod !== 'unlock') {
      const i = e.mod.indexOf('.');
      const ab = e.mod.slice(0, i);
      if (!mods.has(ab)) mods.set(ab, []);
      mods.get(ab).push({ ...e, field: e.mod.slice(i + 1) });
      continue;
    }
    if (!e.stat) continue;
    if (e.when) { cond.push(e); continue; }
    if (e.op === 'set') sets.set(e.stat, e.value);
    else if (typeof e.value === 'number') stats.set(e.stat, (stats.get(e.stat) || 0) + e.value);
  }
  return { cls, effects, unlocked, mods, stats, sets, cond, nodes, rb: skills.rb || 0, affinity: skills.affinity || [] };
}

/**
 * Value of a stat for a tree cache: unconditional sum (+ conditional effects whose `when` holds for `ctx.cond`).
 * Flag stats (op 'set') return their value (true / object) or undefined.
 */
export function stat(tree, name, ctx = null) {
  if (!tree) return 0;
  let v = tree.stats.get(name) || 0;
  let set = tree.sets.get(name);
  if (ctx?.cond && tree.cond.length) {
    for (const e of tree.cond) {
      if (e.stat !== name || !ctx.cond(e.when, e)) continue;
      if (e.op === 'set') set = e.value;
      else if (typeof e.value === 'number') v += e.value;
    }
  }
  if (set !== undefined && typeof set !== 'number') return set;
  if (typeof set === 'number') v = set;
  const cap = STAT_CAPS[name];
  return cap !== undefined ? Math.min(cap, v) : v;
}

/** Every effect of a stat (with its extra parameters: dur, maxStacks, target, family…), conditional ones included. */
export function statEffects(tree, name) {
  if (!tree) return [];
  return tree.effects.filter((e) => e.stat === name);
}

/** Total Inaptitude reduction for an ability (sum of inaptitudeReduce effects, capped by the rules). */
export function inaptitudeReduction(tree, ability) {
  let red = 0;
  for (const e of tree.effects) {
    if (e.stat !== 'inaptitudeReduce') continue;
    if (e.classes) {
      const homes = homesOf(ability);
      if (!homes.some((h) => e.classes.includes(h))) continue;
      if (e.forClass && !e.forClass.includes(tree.cls)) continue;
    }
    red += e.value;
  }
  return Math.min(red, RULES.inaptitude.maxReduction);
}

/** Inaptitude factor of an ability for this tree: 0 = none, 1 = full penalty (−25 % power, +25 % cost, +20 % cd). */
export function inaptitudeFactor(tree, ability) {
  if (!isInapt(ability, tree.cls)) return 0;
  const rb = Math.min(tree.rb || 0, RENAISSANCE.max);
  return (1 - inaptitudeReduction(tree, ability)) * Math.max(0, 1 - RENAISSANCE.inaptStep * rb);
}

// ------------------------------------------------------------------ weapons
/** Weapon tags of an item (shared/data.js ITEMS[*].wt): 'melee' | 'focalisateur' | 'distance' | 'une_main'… */
export const weaponTags = (weaponId) => (weaponId && ITEMS[weaponId]?.wt) || [];
export const weaponFamily = (weaponId) => (weaponId && ITEMS[weaponId]?.family) || null;

/**
 * Weapon requirement of an ability (docs/design §3.5). Returns { ok, mult, need } — mult = power multiplier
 * (focus penalty, improvised base attack). Base attacks are never greyed out: without the right weapon they hit at
 * ×0.8 (bare hands, improvised throw).
 */
export function weaponCheck(ability, weaponId, tree = null) {
  const wt = weaponTags(weaponId);
  const fam = weaponFamily(weaponId);
  const has = (t) => wt.includes(t);
  const staffMelee = tree ? stat(tree, 'meleeFromStaff') : undefined;
  const bowFocus = tree ? !!stat(tree, 'focusFromBow') : false;
  const need = ability.weapon ?? null;
  const base = !!ability.base;
  switch (need) {
    case 'melee':
      if (has('melee')) return { ok: true, mult: 1, need };
      if (has('focalisateur') && staffMelee) return { ok: true, mult: 1 + (staffMelee.powerPct || -15) / 100, need };
      return base ? { ok: true, mult: 0.8, need } : { ok: false, mult: 0, need };
    case 'arc':
      if (has('distance')) return { ok: true, mult: 1, need };
      return base ? { ok: true, mult: 0.8, need } : { ok: false, mult: 0, need };
    case 'dague':
      if (has('distance')) return { ok: true, mult: 0.9, need }; // belt knife: weapon damage ×0.8
      if (has('melee') && has('une_main')) return { ok: true, mult: 1, need };
      return { ok: false, mult: 0, need };
    case 'focus': {
      if (has('focalisateur')) return { ok: true, mult: 1, need };
      if (has('distance') && bowFocus) return { ok: true, mult: 1, need };
      if (fam === 'epee_runique') return { ok: true, mult: tree && stat(tree, 'focusPenaltyRemoved', { cond: (w) => w.weaponFamily?.includes(fam) }) ? 1 : 0.9, need };
      return { ok: true, mult: 0.8, need };
    }
    case 'focus_ou_arc':
      if (has('focalisateur') || has('distance')) return { ok: true, mult: 1, need };
      return { ok: true, mult: 0.8, need };
    default:
      return { ok: true, mult: 1, need };
  }
}

/** French label of a weapon requirement (error messages, tooltips). */
export const WEAPON_NEED_TEXT = {
  melee: 'une arme de mêlée',
  arc: 'un arc',
  dague: 'un arc ou une arme de mêlée à une main',
  focus: 'un bâton ou un sceptre',
  focus_ou_arc: 'un focalisateur ou un arc',
};

// ------------------------------------------------------------------ ability resolution
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const EFFECT_KEYS = new Set(['mod', 'op', 'value', 'perRank', 'atRank', 'final', 'when', 'cap', 'node', 'field', 'stat', 'bossValue']);
const ELEMENTS = ['feu', 'givre', 'arcane', 'nature', 'physique'];

function getPath(o, path) {
  let cur = o;
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}
function setPath(o, path, v) {
  const ks = path.split('.');
  let cur = o;
  for (let i = 0; i < ks.length - 1; i++) {
    if (cur[ks[i]] == null || typeof cur[ks[i]] !== 'object') cur[ks[i]] = {};
    cur = cur[ks[i]];
  }
  cur[ks[ks.length - 1]] = v;
}

function applyMods(a, list) {
  const muls = new Map();
  for (const op of ['set', 'add', 'mul']) {
    for (const e of list) {
      if (e.op !== op) continue;
      if (op === 'set') {
        setPath(a, e.field, clone(e.value));
        // extra parameters carried by the effect (e.g. projCount + spreadDeg / powerEach)
        for (const k of Object.keys(e)) if (!EFFECT_KEYS.has(k)) a[k] = clone(e[k]);
        if (e.field === 'element' && Array.isArray(a.tags)) a.tags = [...a.tags.filter((t) => !ELEMENTS.includes(t)), e.value];
      } else if (op === 'add') {
        const cur = getPath(a, e.field);
        if (typeof e.value === 'number' && cur && typeof cur === 'object' && !Array.isArray(cur)) {
          // e.g. garde.reduce { bouclier, melee, autre } + 0.15: every numeric member (capped by `cap`)
          for (const k of Object.keys(cur)) if (typeof cur[k] === 'number') cur[k] = Math.min(e.cap ?? Infinity, cur[k] + e.value);
        } else if (typeof e.value === 'number') {
          const v = (typeof cur === 'number' ? cur : 0) + e.value;
          setPath(a, e.field, e.cap !== undefined ? Math.min(e.cap, v) : v);
        } else setPath(a, e.field, clone(e.value));
      } else {
        muls.set(e.field, (muls.get(e.field) || 0) + (typeof e.value === 'number' ? e.value : 0));
      }
    }
  }
  for (const [f, m] of muls) {
    const cur = getPath(a, f);
    if (typeof cur === 'number') setPath(a, f, cur * (1 + m));
    else if (typeof cur === 'string' && f === 'blockSt') a.blockStMult = (a.blockStMult || 1) * (1 + m);
    else a[`${f}Mult`] = (a[`${f}Mult`] || 1) * (1 + m);
  }
}

/**
 * Resolve an ability for a character (docs/design §14.1): base → variant (`set`) → `add` → `mul` → character stats
 * (tree damage envelope ≤ +75 %) → Inaptitude → weapon → guardrails → `final` effects. Pure.
 * ctx = { weapon: itemId|null, cond?: (when) => boolean }. Returns a fresh object (never the shared definition) with
 * extra fields: dmgPct, inapt (0..1), weaponMult, usable, need, cdVariant.
 */
export function resolveAbility(tree, id, ctx = {}) {
  const def = ABILITY_DEFS.get(id);
  if (!def) return null;
  const a = clone(def);
  const mods = tree?.mods.get(id) || [];
  applyMods(a, mods.filter((e) => !e.final));
  const s = (name) => stat(tree, name, ctx);
  const tags = new Set(a.tags || []);
  const hasTag = (t) => tags.has(t);
  // ---- character stats (one additive damage envelope, capped)
  let dmg = s('dmgPct') + s('dmgDirectPct');
  for (const t of tags) dmg += s(`dmgPct.${t}`);
  if (tree && homesOf(def).includes(tree.cls)) dmg += s('ownClassPowerPct');
  a.dmgPct = Math.min(RULES.caps.treeDamagePct, dmg);
  if (typeof a.mp === 'number') a.mp *= 1 + s('mpCostPct') + (hasTag('arc') ? s('costPct.arc') : 0);
  if (typeof a.st === 'number') {
    let m = s('stCostPct') + (hasTag('arc') ? s('costPct.arc') : 0) + ((a.power || 0) > 0 ? s('attackStaminaPct') : 0);
    for (const t of tags) m += s(`stCostPct.${t}`);
    a.st *= 1 + m;
  }
  if (typeof a.cast === 'number') a.cast = Math.max(0, a.cast * (1 + s('castTimePct')));
  if (typeof a.rec === 'number') a.rec = Math.max(0, a.rec * (1 + s('recPct')));
  if (typeof a.poise === 'number') a.poise *= 1 + s('poisePct') + (hasTag('sort') ? s('poisePct.sort') : 0);
  if (typeof a.range === 'number') {
    if (a.kind === 'melee' && hasTag('melee')) a.range += s('meleeRange');
    if (hasTag('arc')) a.range += s('range.arc');
  }
  if (typeof a.speed === 'number') {
    let m = 0;
    for (const t of tags) m += s(`projSpeedPct.${t}`);
    a.speed *= 1 + m;
  }
  if (a.kind === 'projectile' || hasTag('projectile')) a.critAdd = (a.critAdd || 0) + s('critTag.projectile');
  a.cdVariant = typeof a.cd === 'number' ? a.cd : 0;
  if (typeof a.cd === 'number' && a.auto) a.cd /= 1 + Math.max(0, s('attackSpeedPct'));
  // ---- Inaptitude
  a.inapt = tree ? inaptitudeFactor(tree, def) : 0;
  if (a.inapt > 0) {
    const pen = RULES.inaptitude;
    if (typeof a.power === 'number') a.power *= 1 + pen.power * a.inapt;
    if (typeof a.mp === 'number') a.mp = Math.ceil(a.mp * (1 + pen.cost * a.inapt));
    if (typeof a.st === 'number') a.st = Math.ceil(a.st * (1 + pen.cost * a.inapt));
    if (typeof a.cd === 'number') a.cd *= 1 + pen.cooldown * a.inapt;
    a.refClasses = homesOf(def);
  }
  // ---- weapon
  const wc = weaponCheck(a, ctx.weapon ?? null, tree);
  a.usable = wc.ok;
  a.need = wc.need;
  a.weaponMult = wc.mult;
  // ---- final effects (keystones), then guardrails
  applyMods(a, mods.filter((e) => e.final));
  if (typeof a.mp === 'number') a.mp = Math.max(0, Math.round(a.mp));
  if (typeof a.st === 'number') a.st = Math.max(0, Math.round(a.st));
  if (typeof a.cd === 'number' && a.cdVariant > 0 && a.inapt === 0) a.cd = Math.max(a.cd, a.cdVariant * (1 - RULES.caps.cdrMax));
  guardrails(a, tree);
  return a;
}

function guardrails(a, tree) {
  const caps = RULES.caps;
  if (a.id === 'roulade') {
    const cdMs = (a.cd || 0.6) * 1000;
    a.iframeMs = Math.min(a.iframeMs || 0, caps.rollIframeMs, cdMs * caps.rollIframeShareOfCd);
    const dancer = tree?.nodes?.has('ks_danseur');
    if (!dancer) a.st = Math.max(caps.rollMinSt, a.st || 0);
  }
  if (a.id === 'sprint') {
    a.stPerS = Math.max(caps.sprintMinStPerS, a.stPerS || 0);
    a.mult = Math.min(caps.sprintMaxMult, a.mult || 1);
  }
}

// ------------------------------------------------------------------ action bar (loadout)
export const isItemEntry = (v) => typeof v === 'string' && v.startsWith('item:');
const itemOfEntry = (v) => v.slice(5);

/** Default action bar of a new character: base attack in slot 1, potions in 5 and 6 (v0.2 keys). */
export function defaultLoadout(cls) {
  const out = new Array(LOADOUT_SLOTS).fill(null);
  out[0] = BASE_ABILITY[cls];
  out[4] = 'item:potion_hp_s';
  out[5] = 'item:potion_mp_s';
  return out;
}

/**
 * Validate a requested action bar. slots = [abilityId | 'item:<consumable>' | null] × 8. Slot 0 holds an unlocked
 * base attack; every ability must be unlocked and slottable; no duplicates. Returns { ok, slots } or { ok: false }.
 */
export function checkLoadout(slots, unlocked) {
  if (!Array.isArray(slots) || slots.length !== LOADOUT_SLOTS) return { ok: false };
  const seen = new Set();
  const out = [];
  for (let i = 0; i < LOADOUT_SLOTS; i++) {
    const v = slots[i] ?? null;
    if (v === null) { out.push(null); continue; }
    if (typeof v !== 'string' || v.length > 40 || seen.has(v)) return { ok: false };
    if (isItemEntry(v)) {
      const it = ITEMS[itemOfEntry(v)];
      if (!Object.prototype.hasOwnProperty.call(ITEMS, itemOfEntry(v)) || it.type !== 'consumable') return { ok: false };
    } else {
      const def = ABILITY_DEFS.get(v);
      if (!def || NOT_SLOTTABLE.has(v) || !unlocked.has(v)) return { ok: false };
    }
    seen.add(v);
    out.push(v);
  }
  const first = out[0] && ABILITY_DEFS.get(out[0]);
  if (!first || !first.base) return { ok: false };
  return { ok: true, slots: out };
}

/** Keep only still-valid entries (after a Renaissance or a data change); slot 0 falls back to the class base. */
export function repairLoadout(slots, unlocked, cls) {
  const out = new Array(LOADOUT_SLOTS).fill(null);
  const seen = new Set();
  if (Array.isArray(slots)) {
    for (let i = 0; i < LOADOUT_SLOTS; i++) {
      const v = slots[i];
      if (typeof v !== 'string' || seen.has(v)) continue;
      if (isItemEntry(v)) {
        const id = itemOfEntry(v);
        if (!Object.prototype.hasOwnProperty.call(ITEMS, id) || ITEMS[id].type !== 'consumable') continue;
      } else if (!ABILITY_DEFS.has(v) || NOT_SLOTTABLE.has(v) || !unlocked.has(v)) continue;
      out[i] = v;
      seen.add(v);
    }
  }
  const first = out[0] && ABILITY_DEFS.get(out[0]);
  if (!first || !first.base) {
    if (out[0] && !seen.has(BASE_ABILITY[cls])) {
      // move the displaced entry to a free slot
      const free = out.indexOf(null, 1);
      if (free > 0) out[free] = out[0];
    }
    out[0] = seen.has(BASE_ABILITY[cls]) ? out[0] : BASE_ABILITY[cls];
    if (!ABILITY_DEFS.get(out[0])?.base) out[0] = BASE_ABILITY[cls];
  }
  return out;
}

/** Put a newly unlocked ability in the first free slot (2..4 first: the keys of the v0.2 bar). Returns the slot or -1. */
export function autoSlot(slots, abilityId) {
  if (NOT_SLOTTABLE.has(abilityId) || slots.includes(abilityId)) return -1;
  for (const i of [1, 2, 3, 6, 7, 4, 5]) {
    if (i < slots.length && slots[i] === null) {
      slots[i] = abilityId;
      return i;
    }
  }
  return -1;
}

// ------------------------------------------------------------------ persistent state
/** Tree state of a brand-new character (level 1: only the base attack, DECISIONS.md §1). */
export function freshSkills(cls) {
  return { v: 1, alloc: {}, gift: [], legacyFloor: 0, loadout: defaultLoadout(cls), rb: 0, affinity: [] };
}

/**
 * Tree state given to a v0.1 / v0.2 character on its first v0.3 login (docs/design §14.3, DECISIONS.md §3):
 * Roulade + Sprint offered, a point floor (cost of the preset) while points(level) is lower, and the preset
 * « Reprendre mon style » allocated (each preset node is kept only if the tree stays valid, in preset order:
 * the most important first). The v0.2 bar is rebuilt in the same order (slots 1–4, potions on 5 and 6).
 */
export function legacySkills(cls, level) {
  const mig = RULES.migration;
  const sk = { v: 1, alloc: {}, gift: [...mig.gift], legacyFloor: mig.legacyFloor[cls] || 0, rb: 0, affinity: [], migrated: 'v0.2' };
  for (const id of TREE.migration.presets[cls]?.nodes || []) {
    const alloc = { ...sk.alloc, [id]: 1 };
    if (validateTree(cls, level, { ...sk, alloc }).ok) sk.alloc = alloc;
  }
  const unlocked = unlockedAbilities(cls, sk.alloc, sk.gift);
  const bar = defaultLoadout(cls);
  V02_ABILITIES[cls].forEach((ab, i) => { if (i > 0 && unlocked.has(ab)) bar[i] = ab; });
  sk.loadout = bar;
  return sk;
}

/**
 * Sanitize a persisted tree state (never trusts the file). Unknown nodes are dropped; if the whole state is not
 * valid any more (data change), nodes are removed from the last allocated until it is — points are never lost
 * (they come back as unspent points). Returns a clean object.
 */
export function sanitizeSkills(raw, cls, level) {
  if (!raw || typeof raw !== 'object') return null;
  const sk = { v: 1, alloc: {}, gift: [], legacyFloor: 0, rb: 0, affinity: [] };
  if (Number.isInteger(raw.rb) && raw.rb >= 0) sk.rb = Math.min(RENAISSANCE.max, raw.rb);
  if (Array.isArray(raw.affinity)) {
    for (const a of raw.affinity) if (TREE_CLASSES.includes(a) && a !== cls && !sk.affinity.includes(a)) sk.affinity.push(a);
    sk.affinity = sk.affinity.slice(0, affinitySlots(sk.rb));
  }
  if (Number.isInteger(raw.legacyFloor) && raw.legacyFloor > 0) sk.legacyFloor = Math.min(raw.legacyFloor, 10);
  if (Array.isArray(raw.gift)) {
    for (const g of raw.gift) if (RULES.migration.gift.includes(g) && !sk.gift.includes(g)) sk.gift.push(g);
  }
  if (raw.alloc && typeof raw.alloc === 'object' && !Array.isArray(raw.alloc)) {
    for (const [id, r] of Object.entries(raw.alloc)) {
      const n = NODES.get(id);
      if (!n || n.type === 'root' || n.start === cls || sk.gift.includes(id)) continue;
      if (Number.isInteger(r) && r >= 1) sk.alloc[id] = Math.min(r, n.maxRank || 1);
    }
  }
  if (typeof raw.migrated === 'string') sk.migrated = raw.migrated.slice(0, 16);
  let res = validateTree(cls, level, sk);
  let guard = 400;
  while (!res.ok && guard-- > 0) {
    const ids = Object.keys(sk.alloc);
    if (!ids.length) break;
    const bad = res.node && sk.alloc[res.node] ? res.node : ids[ids.length - 1];
    if (sk.alloc[bad] > 1 && res.code === 'tree_points') sk.alloc[bad]--;
    else delete sk.alloc[bad];
    res = validateTree(cls, level, sk);
  }
  if (!res.ok) sk.alloc = {};
  sk.loadout = repairLoadout(raw.loadout, unlockedAbilities(cls, sk.alloc, sk.gift), cls);
  return sk;
}

/** Summary sent to the client (SelfState.points). */
export function pointsSummary(cls, level, skills) {
  const total = budgetOf(level, skills);
  const spent = spentOf(cls, skills);
  return { total, spent, free: Math.max(0, total - spent), floor: skills.legacyFloor || 0 };
}

/** Cheapest cost to reach every node for a class (Dijkstra from the Cœur + own start; the gate is ignored). */
export function reachCosts(cls, affinity = []) {
  const dist = new Map();
  const pq = [['coeur', 0], [CLASS_START[cls], 0]];
  while (pq.length) {
    pq.sort((a, b) => a[1] - b[1]);
    const [id, d] = pq.shift();
    if (dist.has(id)) continue;
    dist.set(id, d);
    for (const nb of NODES.get(id).links) {
      if (dist.has(nb)) continue;
      pq.push([nb, d + nodeCost(NODES.get(nb), cls, affinity)]);
    }
  }
  return dist;
}

/** Cheapest path (node ids not yet owned, in allocation order) from the owned set to `target`, or null. */
export function cheapestPath(cls, owned, target, affinity = []) {
  const own = new Set(['coeur', CLASS_START[cls], ...owned]);
  const dist = new Map();
  const prev = new Map();
  const pq = [];
  const takenGroups = new Set();
  for (const o of own) if (NODES.get(o)?.exclusiveGroup) takenGroups.add(NODES.get(o).exclusiveGroup);
  for (const o of own) pq.push([o, 0, null]);
  while (pq.length) {
    pq.sort((a, b) => a[1] - b[1]);
    const [id, d, p] = pq.shift();
    if (dist.has(id)) continue;
    dist.set(id, d);
    prev.set(id, p);
    if (id === target) break;
    for (const nb of NODES.get(id)?.links || []) {
      if (dist.has(nb)) continue;
      const n = NODES.get(nb);
      if (n.type === 'variant' && nb !== target && takenGroups.has(n.exclusiveGroup)) continue;
      pq.push([nb, d + nodeCost(n, cls, affinity) + (n.type === 'variant' && nb !== target ? 0.01 : 0), id]);
    }
  }
  if (!dist.has(target)) return null;
  const path = [];
  let cur = target;
  while (cur && !own.has(cur)) {
    path.unshift(cur);
    cur = prev.get(cur);
  }
  return { path, cost: Math.round(dist.get(target)) };
}
