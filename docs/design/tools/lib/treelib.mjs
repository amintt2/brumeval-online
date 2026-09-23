// Pure helpers for "L'Arbre des Brumes" (docs/design/skilltree.json).
// Reference implementation for shared/skills.js: points, costs, Inaptitude, validation, ability resolution.
// No I/O here: validate.mjs, balance.mjs and build_tree.mjs import it.

export const CLASSES = ['warrior', 'mage', 'ranger'];
export const CLASS_REGION = { warrior: 'guerrier', mage: 'mage', ranger: 'rodeur' };
export const REGION_CLASS = { guerrier: 'warrior', mage: 'mage', rodeur: 'ranger' };
export const CLASS_START = { warrior: 'guerrier_depart', mage: 'mage_depart', ranger: 'rodeur_depart' };
export const BRIDGE_CLASSES = { pont_gm: ['warrior', 'mage'], pont_mr: ['mage', 'ranger'], pont_rg: ['ranger', 'warrior'] };

/** Skill points available at `level` (1 per level from 2, +1 at every multiple of 5). */
export function points(level) {
  return Math.max(0, level - 1) + Math.floor(level / 5);
}

/** Points of a character, with the v0.2 migration floor (see rules.migration.legacyFloor). */
export function pointsOf(char) {
  const p = points(char.level);
  return char.legacyFloor ? Math.max(p, char.legacyFloor) : p;
}

/** Cost of ONE rank of `node` for a character of class `cls` (tree_rules §4.1). */
export function nodeCost(node, cls) {
  if (node.type === 'root') return 0;
  const own = CLASS_REGION[cls];
  if (node.start) return node.start === cls ? 0 : 2;
  const r = node.region;
  if (r === 'survie') return 1;
  if (r === own) return node.type === 'keystone' ? 1 : 1;
  if (BRIDGE_CLASSES[r]) {
    const near = BRIDGE_CLASSES[r].includes(cls);
    if (node.type === 'keystone') return near ? 1 : 3;
    return near ? 1 : 2;
  }
  // another class region
  return node.type === 'keystone' ? 3 : 2;
}

/** Does an ability suffer Inaptitude for this class? */
export function isInapt(ability, cls) {
  const h = ability.home;
  if (h == null) return false;
  return Array.isArray(h) ? !h.includes(cls) : h !== cls;
}

export function indexTree(tree) {
  if (tree._idx) return tree._idx;
  const nodes = new Map(tree.nodes.map((n) => [n.id, n]));
  const abilities = new Map(tree.abilities.map((a) => [a.id, a]));
  const idx = { nodes, abilities };
  Object.defineProperty(tree, '_idx', { value: idx, enumerable: false });
  return idx;
}

/** Undirected adjacency (links are stored on both sides in skilltree.json). */
export function neighbours(tree, id) {
  return indexTree(tree).nodes.get(id)?.links || [];
}

/**
 * Validate a complete allocation (tree_rules §8). alloc = { nodeId: rank }, gift = [nodeId].
 * Returns { ok: true, spent } or { ok: false, code, node, msg }.
 */
export function validateTree(tree, cls, level, alloc, gift = [], opts = {}) {
  const { nodes } = indexTree(tree);
  const rules = tree.rules;
  const start = CLASS_START[cls];
  const giftSet = new Set(gift);
  const all = new Map(Object.entries(alloc));
  for (const g of gift) if (!all.has(g)) all.set(g, 1);
  let spent = 0;
  const groups = new Map();
  let fond = 0;
  let nonFond = 0;
  const regionPts = {};
  for (const [id, rank] of all) {
    const n = nodes.get(id);
    if (!n || n.type === 'root') return { ok: false, code: 'tree_unknown', node: id };
    if (n.start === cls) continue; // own start is implicit and free
    if (!(rank >= 1 && rank <= (n.maxRank || 1))) return { ok: false, code: 'tree_rank', node: id };
    if (n.minLevel && level < n.minLevel) return { ok: false, code: 'tree_level', node: id };
    if (!giftSet.has(id)) {
      const c = nodeCost(n, cls) * rank;
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
  const budget = pointsOf({ level, legacyFloor: opts.legacyFloor });
  if (spent > budget) return { ok: false, code: 'tree_points', spent, budget };
  if (nonFond > 0 && fond < rules.gate.fondamentaux) return { ok: false, code: 'tree_gate' };
  // requirements on points spent in a region (ultimates / keystones)
  for (const [id] of all) {
    const n = nodes.get(id);
    if (n.reqRegionPoints) {
      const have = regionPts[n.reqRegionPoints.region] || 0;
      // the node itself does not count
      const self = giftSet.has(id) ? 0 : nodeCost(n, cls) * (all.get(id) || 1);
      if (have - self < n.reqRegionPoints.min) return { ok: false, code: 'tree_req', node: id };
    }
  }
  // connectivity from coeur + own start
  const seen = new Set(['coeur', start]);
  const queue = ['coeur', start];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of nodes.get(cur).links) {
      if (!seen.has(nb) && all.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  for (const [id] of all) if (!seen.has(id)) return { ok: false, code: 'tree_link', node: id };
  // variants need their ability unlocked
  const unlocked = unlockedAbilities(tree, cls, all);
  for (const [id] of all) {
    const n = nodes.get(id);
    if (n.type === 'variant' && n.ability && !unlocked.has(n.ability)) return { ok: false, code: 'tree_variant', node: id };
  }
  return { ok: true, spent, budget };
}

/** Abilities unlocked by an allocation (Map or object). */
export function unlockedAbilities(tree, cls, alloc) {
  const { nodes } = indexTree(tree);
  const ids = alloc instanceof Map ? [...alloc.keys()] : Object.keys(alloc);
  const out = new Set();
  const startNode = nodes.get(CLASS_START[cls]);
  for (const e of startNode.effects) if (e.mod === 'unlock') out.add(e.value);
  for (const id of ids) {
    const n = nodes.get(id);
    if (!n) continue;
    for (const e of n.effects || []) if (e.mod === 'unlock') out.add(e.value);
  }
  return out;
}

/**
 * Cheapest cost to reach every node for a class (Dijkstra; start = coeur + own start, both free;
 * the Fondamentaux gate is ignored here, the validator checks it separately).
 */
export function reachCosts(tree, cls) {
  const { nodes } = indexTree(tree);
  const dist = new Map();
  const start = CLASS_START[cls];
  const pq = [['coeur', 0], [start, 0]];
  while (pq.length) {
    pq.sort((a, b) => a[1] - b[1]);
    const [id, d] = pq.shift();
    if (dist.has(id)) continue;
    dist.set(id, d);
    for (const nb of nodes.get(id).links) {
      if (dist.has(nb)) continue;
      pq.push([nb, d + nodeCost(nodes.get(nb), cls)]);
    }
  }
  return dist;
}

/** Cheapest path (list of node ids, excluding already-owned) from owned set to target. */
export function cheapestPath(tree, cls, owned, target) {
  const { nodes } = indexTree(tree);
  const dist = new Map();
  const prev = new Map();
  const pq = [];
  const takenGroups = new Set();
  for (const o of owned) if (nodes.get(o)?.exclusiveGroup) takenGroups.add(nodes.get(o).exclusiveGroup);
  for (const o of owned) pq.push([o, 0, null]);
  while (pq.length) {
    pq.sort((a, b) => a[1] - b[1]);
    const [id, d, p] = pq.shift();
    if (dist.has(id)) continue;
    dist.set(id, d);
    prev.set(id, p);
    if (id === target) break;
    for (const nb of nodes.get(id).links) {
      if (dist.has(nb)) continue;
      const n = nodes.get(nb);
      // a variant can be a path step only if its exclusive group is still free (small penalty: avoid when possible)
      if (n.type === 'variant' && nb !== target && takenGroups.has(n.exclusiveGroup)) continue;
      pq.push([nb, d + nodeCost(n, cls) + (n.type === 'variant' && nb !== target ? 0.01 : 0), id]);
    }
  }
  if (!dist.has(target)) return null;
  const path = [];
  let cur = target;
  while (cur && !owned.has(cur)) {
    path.unshift(cur);
    cur = prev.get(cur);
  }
  return { path, cost: dist.get(target) };
}

/** All effects of an allocation, expanded by rank. */
export function collectEffects(tree, cls, alloc) {
  const { nodes } = indexTree(tree);
  const out = [];
  const entries = alloc instanceof Map ? [...alloc] : Object.entries(alloc);
  entries.push([CLASS_START[cls], 1]);
  for (const [id, rank] of entries) {
    const n = nodes.get(id);
    if (!n) continue;
    for (const e of n.effects || []) {
      if (e.atRank && rank < e.atRank) continue;
      const mult = e.perRank ? rank : 1;
      out.push({ ...e, value: typeof e.value === 'number' ? e.value * mult : e.value, node: id });
    }
  }
  return out;
}

/** Total Inaptitude reduction for an ability (sum of inaptitudeReduce effects, capped by rules). */
export function inaptitudeReduction(tree, cls, effects, ability) {
  let red = 0;
  for (const e of effects) {
    if (e.stat !== 'inaptitudeReduce') continue;
    if (e.classes) {
      // reduction only for abilities whose home is in `classes` (e.g. Serment : guerrier+mage)
      const homes = Array.isArray(ability.home) ? ability.home : [ability.home];
      if (!homes.some((h) => e.classes.includes(h))) continue;
      if (e.forClass && !e.forClass.includes(cls)) continue;
    }
    red += e.value;
  }
  return Math.min(red, tree.rules.inaptitude.maxReduction);
}
