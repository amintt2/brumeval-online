// Validation of the v0.3 design data: skilltree.json, items.json, crafting.json.
// Run: node docs/design/tools/validate.mjs        (exit code 1 on any error)
//      node docs/design/tools/validate.mjs --json (machine-readable stats)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLASSES, CLASS_START, CLASS_REGION, nodeCost, reachCosts, validateTree, indexTree, points,
} from './lib/treelib.mjs';
import { describeStat } from './lib/vocab.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = path.resolve(HERE, '..');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DESIGN, f), 'utf8'));
const tree = load('skilltree.json');
const items = load('items.json');
const crafting = load('crafting.json');

const errors = [];
const warns = [];
const stats = {};
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

// ====================================================================== TREE
{
  const { nodes, abilities } = indexTree(tree);
  if (nodes.size !== tree.nodes.length) err('arbre : ids de nœuds en double');
  if (abilities.size !== tree.abilities.length) err('arbre : ids de capacités en double');
  const REGIONS = ['survie', 'guerrier', 'mage', 'rodeur', 'pont_gm', 'pont_mr', 'pont_rg'];
  const TYPES = ['root', 'skill', 'variant', 'passive', 'keystone'];

  // --- fields, links
  for (const n of tree.nodes) {
    if (!REGIONS.includes(n.region)) err(`nœud ${n.id} : région inconnue ${n.region}`);
    if (!TYPES.includes(n.type)) err(`nœud ${n.id} : type inconnu ${n.type}`);
    if (!n.name || !n.desc) err(`nœud ${n.id} : nom ou description manquant`);
    if (typeof n.x !== 'number' || typeof n.y !== 'number') err(`nœud ${n.id} : coordonnées manquantes`);
    if (!(n.maxRank >= 1 && n.maxRank <= 3)) err(`nœud ${n.id} : maxRank ${n.maxRank}`);
    for (const l of n.links) {
      if (l === n.id) err(`nœud ${n.id} : lien vers lui-même`);
      const o = nodes.get(l);
      if (!o) err(`nœud ${n.id} : lien vers ${l} inexistant`);
      else if (!o.links.includes(n.id)) err(`lien non réciproque ${n.id} -> ${l}`);
    }
    if (new Set(n.links).size !== n.links.length) err(`nœud ${n.id} : lien en double`);
    for (const c of CLASSES) if (n.costs?.[c] !== nodeCost(n, c) && n.type !== 'root') err(`nœud ${n.id} : coût ${c} incohérent`);
    if (n.type === 'variant') {
      if (!n.ability || !abilities.has(n.ability)) err(`variante ${n.id} : capacité ${n.ability} inconnue`);
      if (!n.exclusiveGroup) err(`variante ${n.id} : pas de groupe exclusif`);
      if (!n.vfx) err(`variante ${n.id} : intention visuelle (vfx) manquante`);
    }
    if (n.type === 'skill' && !n.effects.some((e) => e.mod === 'unlock')) err(`compétence ${n.id} : ne débloque rien`);
    // effects
    for (const e of n.effects) {
      if (!e.stat && !e.mod) err(`nœud ${n.id} : effet sans stat ni mod`);
      if (!['add', 'mul', 'set'].includes(e.op)) err(`nœud ${n.id} : op ${e.op}`);
      if (e.mod === 'unlock') {
        if (!abilities.has(e.value)) err(`nœud ${n.id} : débloque ${e.value} inconnue`);
      } else if (e.mod) {
        const ab = e.mod.split('.')[0];
        if (!abilities.has(ab)) err(`nœud ${n.id} : mod ${e.mod} vers une capacité inconnue`);
        if (e.op === 'mul' && typeof e.value === 'number' && (e.value < -1 || e.value > 3)) err(`nœud ${n.id} : mul hors bornes ${e.value}`);
      } else if (!describeStat(e.stat) || !tree.effectVocabulary.stats[e.stat]) err(`nœud ${n.id} : stat ${e.stat} absente du vocabulaire`);
    }
  }
  // --- roots, starts, Fondamentaux
  const root = nodes.get('coeur');
  if (!root || root.type !== 'root') err('racine coeur absente');
  const fonds = tree.nodes.filter((n) => n.fondamental);
  const FOND_AB = ['roulade', 'sprint', 'saut', 'garde', 'attaque_chargee'];
  if (fonds.length !== 5) err(`il faut 5 Fondamentaux (trouvé ${fonds.length})`);
  for (const ab of FOND_AB) {
    const f = fonds.find((n) => n.effects.some((e) => e.mod === 'unlock' && e.value === ab));
    if (!f) err(`Fondamental manquant pour ${ab}`);
    else if (!f.links.includes('coeur')) err(`Fondamental ${f.id} non relié au Cœur`);
  }
  if (tree.rules.gate.fondamentaux !== 3) err('la porte doit être de 3 Fondamentaux');
  for (const c of CLASSES) {
    const s = nodes.get(CLASS_START[c]);
    if (!s || s.start !== c) err(`nœud de départ ${CLASS_START[c]} absent`);
    else {
      const base = tree.classes[c].baseAbility;
      if (!s.effects.some((e) => e.mod === 'unlock' && e.value === base)) err(`départ ${c} ne donne pas ${base}`);
      if (s.effects.filter((e) => e.mod === 'unlock').length !== 1) err(`départ ${c} : doit donner une seule capacité`);
    }
  }
  // gate check with the validator
  for (const c of CLASSES) {
    const s = nodes.get(CLASS_START[c]);
    const nb = s.links.find((l) => nodes.get(l).region === CLASS_REGION[c]);
    const r1 = validateTree(tree, c, 10, { fond_roulade: 1, fond_sprint: 1, [nb]: 1 });
    if (r1.ok || r1.code !== 'tree_gate') err(`porte des Fondamentaux non appliquée pour ${c} (${JSON.stringify(r1)})`);
    const r2 = validateTree(tree, c, 10, { fond_roulade: 1, fond_sprint: 1, fond_saut: 1, [nb]: 1 });
    if (!r2.ok) err(`allocation minimale refusée pour ${c} : ${JSON.stringify(r2)}`);
  }

  // --- regions
  const count = {};
  for (const n of tree.nodes) count[n.region] = (count[n.region] || 0) + 1;
  stats.regions = count;
  for (const r of ['guerrier', 'mage', 'rodeur']) if (count[r] < 60 || count[r] > 95) err(`région ${r} : ${count[r]} nœuds (attendu ~70)`);
  if (count.survie < 25 || count.survie > 45) err(`Survie : ${count.survie} nœuds`);
  for (const r of ['pont_gm', 'pont_mr', 'pont_rg']) if (count[r] < 8 || count[r] > 16) err(`passerelle ${r} : ${count[r]} nœuds`);
  // bridges touch both neighbours
  for (const [b, pair] of Object.entries({ pont_gm: ['guerrier', 'mage'], pont_mr: ['mage', 'rodeur'], pont_rg: ['rodeur', 'guerrier'] })) {
    for (const reg of pair) {
      const touch = tree.nodes.some((n) => n.region === b && n.links.some((l) => nodes.get(l).region === reg));
      if (!touch) err(`passerelle ${b} non reliée à la région ${reg}`);
    }
  }

  // --- reachability & costs per class
  stats.reach = {};
  for (const c of CLASSES) {
    const d = reachCosts(tree, c);
    const unreached = tree.nodes.filter((n) => !d.has(n.id));
    if (unreached.length) err(`${c} : ${unreached.length} nœud(s) inaccessibles (${unreached.slice(0, 5).map((n) => n.id)})`);
    const byRegion = {};
    for (const n of tree.nodes) {
      const v = d.get(n.id);
      byRegion[n.region] = Math.max(byRegion[n.region] || 0, v);
    }
    stats.reach[c] = { maxCostByRegion: byRegion, farthest: Math.max(...d.values()) };
  }
  // v0.2 abilities close to start
  const V02 = { warrior: ['heavy_blow', 'whirlwind', 'war_cry'], mage: ['fireball', 'frost_nova', 'heal'], ranger: ['piercing_shot', 'rapid_fire', 'arrow_rain'] };
  stats.v02Cost = {};
  for (const c of CLASSES) {
    const d = reachCosts(tree, c);
    for (const ab of V02[c]) {
      const n = tree.nodes.find((x) => x.type === 'skill' && x.ability === ab);
      if (!n) { err(`capacité v0.2 ${ab} absente de l'arbre`); continue; }
      stats.v02Cost[ab] = d.get(n.id);
      if (d.get(n.id) > 4) err(`capacité v0.2 ${ab} trop loin (${d.get(n.id)} points)`);
    }
  }

  // --- abilities
  const unlockedSomewhere = new Set();
  for (const n of tree.nodes) for (const e of n.effects) if (e.mod === 'unlock') unlockedSomewhere.add(e.value);
  const groupsOf = new Map();
  for (const g of tree.exclusiveGroups) {
    const members = g.nodes.map((id) => nodes.get(id));
    if (members.some((m) => !m)) err(`groupe ${g.id} : nœud inconnu`);
    if (g.nodes.length < 2 || g.nodes.length > 3) err(`groupe ${g.id} : ${g.nodes.length} options (2 ou 3 attendues)`);
    if (members.some((m) => m && m.ability !== g.ability)) err(`groupe ${g.id} : variantes de capacités différentes`);
    const touched = new Set([g.ability]);
    for (const m of members) for (const e of m?.effects || []) if (e.mod && e.mod !== 'unlock') touched.add(e.mod.split('.')[0]);
    for (const t of touched) (groupsOf.get(t) || groupsOf.set(t, []).get(t)).push(g.id);
  }
  for (const n of tree.nodes) if (n.exclusiveGroup && !tree.exclusiveGroups.some((g) => g.id === n.exclusiveGroup && g.nodes.includes(n.id))) err(`nœud ${n.id} : groupe ${n.exclusiveGroup} non déclaré`);
  for (const a of tree.abilities) {
    if (!a.name || !a.desc || !a.kind) err(`capacité ${a.id} : nom/description/type manquant`);
    if (!Array.isArray(a.tags) || !a.tags.length) err(`capacité ${a.id} : étiquettes manquantes`);
    if (typeof a.mp !== 'number' || typeof a.st !== 'number') err(`capacité ${a.id} : coûts manquants`);
    if (typeof a.cd !== 'number' && a.cd !== 'base' && !a.derivedFrom) err(`capacité ${a.id} : recharge manquante`);
    if (!a.souls) warn(`capacité ${a.id} : pas de note soulslike`);
    if (!unlockedSomewhere.has(a.id) && !a.derivedFrom) err(`capacité ${a.id} : jamais débloquée`);
    if (!groupsOf.has(a.id)) err(`capacité ${a.id} : aucun groupe de variantes exclusives`);
    if (!(a.home === null || ['warrior', 'mage', 'ranger'].includes(a.home) || (Array.isArray(a.home) && a.home.every((h) => CLASSES.includes(h))))) err(`capacité ${a.id} : home invalide`);
    if (![null, 'melee', 'arc', 'dague', 'focus', 'focus_ou_arc', 'base'].includes(a.weapon)) err(`capacité ${a.id} : arme requise inconnue ${a.weapon}`);
  }
  // at level 1 a character has only its base attack
  for (const c of CLASSES) {
    const s = nodes.get(CLASS_START[c]);
    const unl = s.effects.filter((e) => e.mod === 'unlock').map((e) => e.value);
    if (unl.length !== 1 || unl[0] !== tree.classes[c].baseAbility) err(`${c} : au niveau 1 il faut seulement l'attaque de base`);
  }

  // --- keystones
  for (const n of tree.nodes.filter((x) => x.type === 'keystone')) {
    const k = tree.keystones.find((x) => x.id === n.id);
    if (!k) err(`clé de voûte ${n.id} absente de keystones[]`);
    else if (!k.upside || !k.drawback) err(`clé de voûte ${n.id} : gain ou contrepartie manquant`);
  }
  for (const k of tree.keystones) if (!nodes.has(k.id)) err(`keystones[] : ${k.id} n'est pas un nœud`);
  // icon keys (ASSET_REQUESTS.md)
  const icons = new Map();
  for (const a of tree.abilities) {
    if (a.icon !== `ab_${a.id}`) err(`capacité ${a.id} : icône ${a.icon} (attendu ab_${a.id})`);
  }
  for (const k of tree.keystones) {
    if (!/^ks_[a-z_]+$/.test(k.icon || '')) err(`clé de voûte ${k.id} : icône manquante`);
    if (icons.has(k.icon)) err(`icône ${k.icon} partagée par ${icons.get(k.icon)} et ${k.id}`);
    icons.set(k.icon, k.id);
  }

  // --- geometry
  let minD = Infinity, minPair = null;
  const arr = tree.nodes;
  for (let i = 0; i < arr.length; i++)
    for (let j = i + 1; j < arr.length; j++) {
      const d = Math.hypot(arr[i].x - arr[j].x, arr[i].y - arr[j].y);
      if (d < minD) { minD = d; minPair = [arr[i].id, arr[j].id]; }
    }
  stats.minNodeDistance = { d: Math.round(minD), pair: minPair };
  if (minD < 55) err(`deux nœuds trop proches : ${minPair} (${minD.toFixed(0)})`);
  const links = [];
  for (const n of arr) for (const l of n.links) if (n.id < l) links.push([n, nodes.get(l)]);
  const segPt = (p, a, b) => {
    const vx = b.x - a.x, vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y);
  };
  let minClear = Infinity, clearInfo = null;
  for (const [a, b] of links)
    for (const n of arr) {
      if (n === a || n === b) continue;
      const d = segPt(n, a, b);
      if (d < minClear) { minClear = d; clearInfo = `${a.id}-${b.id} / ${n.id}`; }
    }
  stats.minLinkClearance = { d: Math.round(minClear), where: clearInfo };
  if (minClear < 25) err(`un lien passe sur un nœud : ${clearInfo} (${minClear.toFixed(0)})`);
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  let crossings = 0;
  for (let i = 0; i < links.length; i++)
    for (let j = i + 1; j < links.length; j++) {
      const [a, b] = links[i], [c, d] = links[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)) {
        crossings++;
        if (crossings <= 5) warn(`liens croisés : ${a.id}-${b.id} × ${c.id}-${d.id}`);
      }
    }
  stats.linkCrossings = crossings;
  if (crossings > 0) err(`${crossings} croisement(s) de liens`);
  stats.links = links.length;
  // region sectors: every node closer to its own region's centroid-angle than overlapping another region's nodes
  const ang = (n) => ((Math.atan2(n.y, n.x) * 180) / Math.PI + 360) % 360;
  const sectors = {};
  for (const n of arr) {
    if (n.region === 'survie') continue;
    const a = ang(n);
    const s = (sectors[n.region] = sectors[n.region] || { min: 999, max: -999, rmin: 1e9, rmax: 0, list: [] });
    s.list.push(a);
    s.rmin = Math.min(s.rmin, Math.hypot(n.x, n.y));
    s.rmax = Math.max(s.rmax, Math.hypot(n.x, n.y));
  }
  for (const [r, s] of Object.entries(sectors)) {
    // handle wrap-around (rodeur spans 0°)
    const shifted = s.list.map((a) => (r === 'rodeur' && a < 90 ? a + 360 : a));
    s.min = Math.round(Math.min(...shifted));
    s.max = Math.round(Math.max(...shifted));
    s.rmin = Math.round(s.rmin);
    s.rmax = Math.round(s.rmax);
    delete s.list;
  }
  stats.sectors = sectors;
  const survR = Math.max(...arr.filter((n) => n.region === 'survie').map((n) => Math.hypot(n.x, n.y)));
  stats.survieMaxRadius = Math.round(survR);
  if (survR > 470) err(`Survie dépasse le rayon 470 (${survR})`);

  // --- exclusive choices never block the tree (random picks)
  let rng = 12345;
  const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
  let blocked = 0;
  for (let t = 0; t < 2000; t++) {
    const banned = new Set();
    for (const g of tree.exclusiveGroups) {
      const keep = g.nodes[Math.floor(rand() * g.nodes.length)];
      for (const id of g.nodes) if (id !== keep) banned.add(id);
    }
    const seen = new Set(['coeur']);
    const q = ['coeur'];
    while (q.length) {
      const cur = q.shift();
      for (const nb of nodes.get(cur).links) if (!seen.has(nb) && !banned.has(nb)) { seen.add(nb); q.push(nb); }
    }
    const miss = tree.nodes.filter((n) => !banned.has(n.id) && !seen.has(n.id));
    if (miss.length) { blocked++; if (blocked < 3) warn(`choix exclusif bloquant : ${miss.slice(0, 3).map((n) => n.id)}`); }
  }
  stats.exclusiveChoiceSamples = { samples: 2000, blocked };
  if (blocked) err(`${blocked} tirages de variantes bloquent l'accès à des nœuds`);

  // --- migration presets
  for (const c of CLASSES) {
    const p = tree.migration.presets[c];
    const alloc = Object.fromEntries(p.nodes.map((id) => [id, 1]));
    for (const lvl of [1, 3, 5, 20]) {
      const r = validateTree(tree, c, lvl, alloc, tree.rules.migration.gift, { legacyFloor: tree.rules.migration.legacyFloor[c] });
      if (!r.ok) err(`préréglage v0.2 ${c} invalide au niveau ${lvl} : ${JSON.stringify(r)}`);
    }
  }
  // --- parcours conseillé (rules.guide) : valide à chaque niveau, sans point perdu
  if (!tree.rules.guide) err('rules.guide absent (parcours conseillé des niveaux 2 à 10)');
  else for (const c of CLASSES) {
    const alloc = {};
    for (const step of tree.rules.guide.paths[c] || []) {
      for (const id of step.nodes) alloc[id] = 1;
      const r = validateTree(tree, c, step.level, alloc, []);
      if (!r.ok) err(`parcours conseillé ${c} invalide au niveau ${step.level} : ${JSON.stringify(r)}`);
      else if (r.spent !== r.budget) warn(`parcours conseillé ${c} niveau ${step.level} : ${r.spent}/${r.budget} points`);
    }
  }
  stats.tree = {
    nodes: tree.nodes.length,
    byType: tree.nodes.reduce((o, n) => ((o[n.type] = (o[n.type] || 0) + 1), o), {}),
    abilities: tree.abilities.length,
    exclusiveGroups: tree.exclusiveGroups.length,
    keystones: tree.keystones.length,
    stats: Object.keys(tree.effectVocabulary.stats).length,
    pointsAt30: points(30),
    fullTreeCost: Object.fromEntries(CLASSES.map((c) => [c, tree.nodes.reduce((s, n) => s + (n.start === c ? 0 : nodeCost(n, c) * n.maxRank), 0)])),
  };
}

// ====================================================================== ITEMS & CRAFTING
try {
  const bases = items.bases;
  const uniques = items.uniques;
  const cons = items.consumables || {};
  const mats = new Map(crafting.materials.map((m) => [m.id, m]));
  const plans = new Map((crafting.plans || []).map((p) => [p.id, p]));
  const itemIds = new Set([...Object.keys(bases), ...Object.keys(uniques), ...Object.keys(cons)]);
  const anyId = (id) => itemIds.has(id) || mats.has(id) || plans.has(id);
  // id collisions between namespaces
  for (const id of mats.keys()) if (itemIds.has(id)) err(`id ${id} à la fois matériau et objet`);
  for (const id of Object.keys(uniques)) if (bases[id]) err(`id ${id} à la fois base et unique`);
  for (const id of Object.keys(cons)) if (bases[id] || uniques[id]) err(`id ${id} consommable en double`);
  // v0.1 ids
  const V01 = ['potion_hp_s', 'potion_hp_l', 'potion_mp_s', 'slime_gel', 'wolf_pelt', 'goblin_trinket', 'ancient_bone', 'golem_core',
    'rusty_sword', 'steel_sword', 'runeblade', 'apprentice_staff', 'arcane_staff', 'ember_staff', 'short_bow', 'long_bow', 'elven_bow',
    'leather_tunic', 'mage_robe', 'chainmail', 'golem_plate'];
  for (const id of V01) if (!anyId(id)) err(`id v0.1 ${id} disparu`);
  // families, slots
  const fam = items.families;
  for (const [id, b] of Object.entries({ ...bases, ...uniques })) {
    if (!b.name) err(`objet ${id} : nom manquant`);
    if (!items.meta.slots[b.slot] && b.slot !== 'ring') err(`objet ${id} : emplacement ${b.slot} inconnu`);
    if ((b.slot === 'weapon' || b.slot === 'offhand') && !fam[b.family]) err(`objet ${id} : famille ${b.family} inconnue`);
    if (['head', 'chest', 'hands', 'feet'].includes(b.slot) && !['plaques', 'cuir', 'tissu'].includes(b.armor)) err(`objet ${id} : type d'armure ${b.armor}`);
    if (!/^T[1-6]$/.test(b.tier)) err(`objet ${id} : palier ${b.tier}`);
    if (!(b.lvl >= 1 && b.lvl <= 30)) err(`objet ${id} : niveau ${b.lvl}`);
    if (!b.icon) err(`objet ${id} : icône manquante`);
    if (b.line && !items.lines[b.line]) err(`objet ${id} : série ${b.line} inconnue`);
  }
  for (const [id, b] of Object.entries({ ...bases, ...uniques })) {
    if ((b.slot === 'weapon' || b.slot === 'offhand') && !/^eq_[a-z_]+_?\d*$/.test(b.model || '')) err(`objet ${id} : modèle eq_* manquant`);
  }
  for (const r of crafting.recipes) {
    const b = bases[r.output.item] || cons[r.output.item];
    if (b?.icon && r.output.icon && r.output.icon !== b.icon) err(`recette ${r.id} : icône ${r.output.icon} ≠ ${b.icon}`);
  }
  for (const [id, u] of Object.entries(uniques)) {
    if (u.rarity !== 'legendary') err(`unique ${id} : rareté ${u.rarity}`);
    if (!u.effect) err(`unique ${id} : pas d'effet spécial`);
    if (u.boss && !items.dropTables.monsters[u.boss]) err(`unique ${id} : boss ${u.boss} inconnu`);
  }
  // lines & sets
  for (const [id, l] of Object.entries(items.lines)) {
    for (const [slot, pid] of Object.entries(l.pieces)) {
      if (!bases[pid]) err(`série ${id} : pièce ${pid} inconnue`);
      else if (bases[pid].slot !== slot) err(`série ${id} : pièce ${pid} n'est pas ${slot}`);
    }
    if (l.set && !items.sets[l.set]) err(`série ${id} : ensemble ${l.set} inconnu`);
  }
  for (const [id, s] of Object.entries(items.sets)) for (const pid of Object.values(s.pieces)) if (!bases[pid]) err(`ensemble ${id} : pièce ${pid} inconnue`);
  // affixes
  for (const [id, a] of Object.entries(items.affixes)) if (!a.range?.['1'] || !a.range?.['30']) err(`affixe ${id} : bornes 1/30 manquantes`);
  // drop tables
  const dt = items.dropTables.monsters;
  for (const [m, d] of Object.entries(dt)) {
    for (const [mid] of d.materials || []) if (!mats.has(mid)) err(`butin ${m} : matériau ${mid} inconnu`);
    for (const [sid] of d.stones || []) if (!anyId(sid)) err(`butin ${m} : pierre ${sid} inconnue`);
    for (const [cid] of d.consumables || []) if (!anyId(cid)) err(`butin ${m} : consommable ${cid} inconnu`);
    for (const [uid] of d.uniques || []) if (!uniques[uid]) err(`butin ${m} : unique ${uid} inconnu`);
    for (const [sid] of d.setPieces || []) if (!items.sets[sid]) err(`butin ${m} : ensemble ${sid} inconnu`);
    for (const [pid] of d.plans || []) if (!plans.has(pid)) err(`butin ${m} : plan ${pid} inconnu`);
    if (!/^T[1-6]$/.test(d.tier)) err(`butin ${m} : palier ${d.tier}`);
    if (!Array.isArray(d.lvl)) err(`butin ${m} : niveaux manquants`);
  }
  // materials
  const usedMats = new Set();
  for (const r of crafting.recipes) for (const [i] of r.inputs) usedMats.add(i);
  for (const [id, m] of mats) {
    if (!m.name || !m.icon) err(`matériau ${id} : nom ou icône manquant`);
    if (!usedMats.has(id)) err(`matériau ${id} : utilisé par aucune recette`);
    for (const s of m.sources || []) if (s.monster && !dt[s.monster]) err(`matériau ${id} : monstre ${s.monster} inconnu`);
  }
  // every monster material in drop tables has the monster as a source
  for (const [m, d] of Object.entries(dt)) for (const [mid] of d.materials || []) {
    const mm = mats.get(mid);
    if (mm && mm.kind === 'monster' && !(mm.sources || []).some((s) => s.monster === m)) err(`matériau ${mid} : source ${m} absente`);
  }
  // recipes
  const recipeIds = new Set();
  const STATIONS = new Set(['forge', 'alchemy_table', 'workbench']);
  for (const r of crafting.recipes) {
    if (recipeIds.has(r.id)) err(`recette ${r.id} en double`);
    recipeIds.add(r.id);
    for (const [i, q] of r.inputs) {
      if (!anyId(i)) err(`recette ${r.id} : ingrédient ${i} inconnu`);
      if (!(q >= 1)) err(`recette ${r.id} : quantité ${q}`);
    }
    if (!anyId(r.output.item)) err(`recette ${r.id} : produit ${r.output.item} inconnu`);
    if (!crafting.professions[r.prof]) err(`recette ${r.id} : métier ${r.prof}`);
    if (!STATIONS.has(r.station)) err(`recette ${r.id} : station ${r.station}`);
    if (r.learn?.plan && !plans.has(r.learn.plan)) err(`recette ${r.id} : plan ${r.learn.plan} inconnu`);
    const out = bases[r.output.item];
    if (out && out.lvl && Math.abs(out.lvl - r.lvl) > 3) warn(`recette ${r.id} : niveau ${r.lvl} ≠ objet ${out.lvl}`);
  }
  for (const [id, p] of plans) for (const t of p.teaches) if (!recipeIds.has(t)) err(`plan ${id} : recette ${t} inconnue`);
  for (const s of crafting.sets) for (const pid of s.pieces) if (!bases[pid]) err(`ensemble fabriqué ${s.id} : pièce ${pid} inconnue`);
  // no legendary crafted
  for (const r of crafting.recipes) if (uniques[r.output.item]) err(`recette ${r.id} fabrique un légendaire`);
  // player examples
  const wolfSet = crafting.sets.find((s) => s.id === 'wolf');
  if (!wolfSet) err("exemple joueur : ensemble du loup absent");
  else for (const pid of wolfSet.pieces) {
    const r = crafting.recipes.find((x) => x.output.item === pid);
    if (!r || !r.inputs.some(([i]) => i === 'wolf_pelt')) err(`ensemble du loup : ${pid} sans fourrure de loup`);
  }
  const slimePotions = crafting.recipes.filter((r) => r.prof === 'alchemy' && r.inputs.some(([i]) => i === 'slime_gel'));
  if (!slimePotions.some((r) => r.output.item === 'potion_hp_s')) err('exemple joueur : petite potion de soin à la gelée de gluant absente');
  // swords
  const swordFams = Object.entries(fam).filter(([, f]) => f.group === 'épée').map(([k]) => k);
  const swords = Object.entries(bases).filter(([, b]) => swordFams.includes(b.family));
  const uniqueSwords = Object.entries(uniques).filter(([, u]) => swordFams.includes(u.family));
  if (swords.length < 30) err(`seulement ${swords.length} épées`);
  // tiers of monsters vs levels
  const TIERS = items.dropTables.tiers;
  for (const [m, d] of Object.entries(dt)) {
    const t = TIERS[d.tier];
    if (t && (d.lvl[0] < t.lvl[0] - 1 || d.lvl[1] > t.lvl[1] + 1)) warn(`monstre ${m} : niveaux ${d.lvl} hors du palier ${d.tier} ${t.lvl}`);
  }
  // crafting monsters = drop-table monsters
  for (const m of Object.keys(crafting.monsterDrops || {})) if (!dt[m]) err(`crafting.monsterDrops.${m} absent des tables de butin`);
  stats.items = {
    bases: Object.keys(bases).length,
    weapons: Object.values(bases).filter((b) => b.slot === 'weapon').length,
    swords: swords.length,
    swordFamilies: swordFams.length,
    swordsByFamily: Object.fromEntries(swordFams.map((f) => [f, swords.filter(([, b]) => b.family === f).length])),
    uniques: Object.keys(uniques).length,
    uniqueSwords: uniqueSwords.length,
    consumables: Object.keys(cons).length,
    lines: Object.keys(items.lines).length,
    lootSets: Object.keys(items.sets).length,
    affixes: Object.keys(items.affixes).length,
    monsters: Object.keys(dt).length,
    materials: mats.size,
    recipes: crafting.recipes.length,
    recipesByProf: crafting.recipes.reduce((o, r) => ((o[r.prof] = (o[r.prof] || 0) + 1), o), {}),
    plans: plans.size,
    craftedSets: crafting.sets.length,
  };
} catch (e) {
  err('objets/artisanat : exception ' + e.message);
}

// ====================================================================== REPORT
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: errors.length === 0, errors, warnings: warns, stats }, null, 1));
} else {
  console.log('=== Validation des données de conception v0.3 ===');
  console.log(JSON.stringify(stats, null, 1));
  for (const w of warns) console.log('avertissement : ' + w);
  for (const e of errors) console.log('ERREUR : ' + e);
  console.log(errors.length ? `ÉCHEC : ${errors.length} erreur(s)` : `OK : 0 erreur, ${warns.length} avertissement(s)`);
}
process.exit(errors.length ? 1 : 0);
