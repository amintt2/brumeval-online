// [skilltree] Test helpers: a tree state that unlocks a given ability (cheapest path), weapons per requirement.
import { NODES, TREE, CLASS_START, cheapestPath, validateTree, FOND_IDS, nodeCost } from '../../../shared/skills.js';

/** Node that unlocks `abilityId` (a class start for base attacks). */
export function unlockNodeOf(abilityId) {
  for (const n of TREE.nodes) if ((n.effects || []).some((e) => e.mod === 'unlock' && e.value === abilityId)) return n.id;
  return null;
}

/** Tree state (level `level`) with 3 Fondamentaux + the cheapest path to the node unlocking `abilityId`, plus `extra` nodes. */
export function skillsFor(cls, abilityId, { level = 30, extra = [], rb = 0 } = {}) {
  const alloc = { fond_roulade: 1, fond_sprint: 1, fond_saut: 1 };
  const add = (target) => {
    if (!target || target === CLASS_START[cls] || alloc[target]) return;
    const r = cheapestPath(cls, Object.keys(alloc), target);
    if (!r) throw new Error(`pas de chemin vers ${target}`);
    for (const id of r.path) if (NODES.get(id).start !== cls) alloc[id] = 1;
  };
  const target = unlockNodeOf(abilityId);
  // ultimates / some keystones need points spent in their region first: fill it with the cheapest passives
  const req = target && NODES.get(target).reqRegionPoints;
  if (req) {
    const spentIn = () => Object.keys(alloc).reduce((n, id) => n + (NODES.get(id).region === req.region ? nodeCost(NODES.get(id), cls) : 0), 0);
    let guard = 60;
    while (spentIn() < req.min && guard-- > 0) {
      const owned = new Set([...Object.keys(alloc), CLASS_START[cls], 'coeur']);
      const next = TREE.nodes.find((n) => n.region === req.region && !owned.has(n.id) && (n.type === 'passive' || n.type === 'skill') && !n.exclusiveGroup
        && !n.reqRegionPoints && !n.minLevel && n.links.some((l) => owned.has(l)));
      if (!next) break;
      alloc[next.id] = 1;
    }
  }
  add(target);
  for (const id of extra) add(id);
  const sk = { v: 1, alloc, gift: [], legacyFloor: 0, rb, affinity: [], loadout: [null, null, null, null, null, null, null, null] };
  const res = validateTree(cls, level, sk);
  return { sk, res };
}

export const WEAPON_FOR = { melee: 'steel_sword', arc: 'long_bow', dague: 'long_bow', focus: 'arcane_staff', focus_ou_arc: 'arcane_staff' };
export { FOND_IDS };
