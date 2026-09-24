// [skilltree] Client view of the local character's tree (SelfState.tree / points / loadout / renaissance): cached
// tree (shared/skills.js buildTree), resolved abilities (variants, passives, Inaptitude, weapon), action bar with a
// fallback for servers / offline mode without the tree (v0.2 SelfState: abilities[4] + potions on 5 and 6).
import {
  buildTree, resolveAbility, unlockedAbilities, defaultLoadout, LOADOUT_SLOTS, ABILITY_DEFS, isItemEntry, BASE_ABILITY,
} from '@shared/skills.js';

let cacheKey = null;
let cacheTree = null;
let specCache = new Map();

/** Tree state object of the self (or null for an older server). */
export const treeState = (self) => (self && self.tree && typeof self.tree === 'object' ? self.tree : null);

/** Cached tree of the self (buildTree), rebuilt when the tree / Renaissance / class changes. */
export function treeOf(self) {
  if (!self) return null;
  const t = treeState(self);
  const rb = self.renaissance?.n || 0;
  const key = t ? `${self.cls}|${rb}|${JSON.stringify(t.alloc)}|${(t.gift || []).join(',')}|${(t.affinity || []).join(',')}` : `${self.cls}|legacy`;
  if (key !== cacheKey) {
    cacheKey = key;
    specCache = new Map();
    cacheTree = t
      ? buildTree(self.cls, { alloc: t.alloc || {}, gift: t.gift || [], rb, affinity: t.affinity || [] })
      // older server: every v0.2 ability of the class (no Fondamentaux learnt, the server decides)
      : buildTree(self.cls, { alloc: {}, gift: [] });
    if (!t) for (const id of self.abilities || []) if (id) cacheTree.unlocked.add(id);
  }
  return cacheTree;
}

/** Is an ability (or Fondamental) known? Without a tree (older server) everything the class had is. */
export function knows(self, id) {
  if (!self) return false;
  const t = treeState(self);
  if (!t) return id !== 'saut' && id !== 'garde' && id !== 'attaque_chargee';
  return treeOf(self).unlocked.has(id);
}

/** Resolved ability for the self (cached per tree + weapon). */
export function specOf(self, id) {
  const tree = treeOf(self);
  if (!tree || !ABILITY_DEFS.has(id)) return null;
  const k = `${id}|${self.eq?.weapon || ''}|${self.hp < self.mhp * 0.5 ? 1 : 0}`;
  let s = specCache.get(k);
  if (!s) {
    s = resolveAbility(tree, id, { weapon: self.eq?.weapon || null, cond: (w) => condLight(self, w) });
    specCache.set(k, s);
  }
  return s;
}
function condLight(self, w) {
  if (!w) return true;
  if (w.hpUnder !== undefined) return self.mhp > 0 && self.hp / self.mhp < w.hpUnder;
  return false; // situational conditions are only known by the server
}

/** The 8-slot action bar of the self (server loadout, or rebuilt from the v0.2 fields). */
export function loadoutOf(self) {
  if (!self) return new Array(LOADOUT_SLOTS).fill(null);
  if (Array.isArray(self.loadout) && self.loadout.length === LOADOUT_SLOTS) return self.loadout;
  const bar = defaultLoadout(self.cls);
  (self.abilities || []).forEach((id, i) => { if (i < 4) bar[i] = id || null; });
  if (!bar[0]) bar[0] = BASE_ABILITY[self.cls] || null;
  return bar;
}

/** Does the server know the tree (skill_alloc, loadout…)? */
export const hasTree = (self) => !!treeState(self) && Array.isArray(self.loadout);

/** Abilities unlocked by the tree, in a stable order (base attacks first, then the tree's ability order). */
export function learntAbilities(self) {
  const t = treeState(self);
  const set = t ? unlockedAbilities(self.cls, t.alloc || {}, t.gift || []) : new Set((self?.abilities || []).filter(Boolean));
  const order = [...ABILITY_DEFS.keys()];
  return [...set].sort((a, b) => {
    const A = ABILITY_DEFS.get(a), B = ABILITY_DEFS.get(b);
    if (!!A?.base !== !!B?.base) return A?.base ? -1 : 1;
    return order.indexOf(a) - order.indexOf(b);
  });
}

export { isItemEntry };
