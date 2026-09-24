// [skilltree] L'Arbre des Brumes on the server: tree state of a player, allocation (all validated server-side with
// shared/skills.js), action bar (loadout), Renaissance (DECISIONS.md §3), tree-derived stats.
// Protocol: shared/protocol.js (skill_alloc, skill_alloc_batch, loadout, renaissance; SelfState tree / points /
// loadout / renaissance).
import { CLASSES, ITEMS, MAX_LEVEL } from '../../../shared/data.js';
import { S2C, FX } from '../../../shared/protocol.js';
import { STAMINA } from '../../../shared/combat.js';
import {
  allocate, buildTree, stat, checkLoadout, repairLoadout, autoSlot, unlockedAbilities, pointsSummary, freshSkills,
  RENAISSANCE, renaissanceTitle, affinitySlots, TREE_ERRORS, TREE_CLASSES, NODES, ABILITY_DEFS, RULES, MAX_ALLOC_BATCH,
} from '../../../shared/skills.js';
import { firstEmpty } from '../inventory.js';

/** Messages about the tree accepted per second before `tree_spam` is flagged (docs/design §14.2). */
const TREE_MSG_PER_S = 5;
/** Renaissance: out of combat for this long. */
const RENAISSANCE_CALM_MS = 10_000;

// ------------------------------------------------------------------ player state
/** (Re)build the tree cache of a player and everything derived from it (stats, stamina caps, bar). */
export function refreshTree(p) {
  p.tree = buildTree(p.cls, p.skills);
  p.skills.loadout = repairLoadout(p.skills.loadout, p.tree.unlocked, p.cls);
  p.recomputeStats();
  p.markDirty('tree', 'points', 'loadout', 'renaissance', 'abilities', 'mst');
}

/** Tree-derived character stats (applied by Player.recomputeStats on top of class/level/gear). */
export function applyTreeStats(p, s) {
  const t = p.tree;
  if (!t) return;
  const v = (n) => stat(t, n);
  s.mhp = Math.max(1, Math.round(s.mhp * (1 + v('mhpPct'))));
  s.mmp = Math.max(0, Math.round((s.mmp + v('mmp')) * (1 + v('mmpPct'))));
  s.def = Math.max(0, Math.round(s.def * (1 + v('defPct'))));
  s.crit = +(s.crit + v('crit')).toFixed(3);
  s.speed = +(s.speed * (1 + v('speedPct'))).toFixed(3);
  const caps = RULES.caps;
  p.mst = Math.max(40, Math.min(caps.stMax, STAMINA.max + v('mst')));
  p.stRegen = Math.min(caps.stRegenMax, (STAMINA.regen + v('stRegen')) * (1 + v('stRegenPct')));
  p.stRegenDelayMs = Math.max(caps.stRegenDelayMinMs, STAMINA.regenDelayMs + v('stRegenDelayMs'));
  p.equilibre = Math.min(caps.equilibreMax, v('equilibre'));
}

// ------------------------------------------------------------------ SelfState fields
export function treeField(p) {
  return { alloc: { ...p.skills.alloc }, gift: [...p.skills.gift], affinity: [...(p.skills.affinity || [])] };
}
export function pointsField(p) {
  return pointsSummary(p.cls, p.level, p.skills);
}
export function renaissanceField(p) {
  const n = p.skills.rb || 0;
  return {
    n, max: RENAISSANCE.max, title: renaissanceTitle(n),
    available: p.level >= RENAISSANCE.level && n < RENAISSANCE.max,
    xpPct: Math.round(n * RENAISSANCE.xpPct * 100) / 100,
    // the next Renaissance lets the player pick an affinity class
    needsAffinity: affinitySlots(n + 1) > affinitySlots(n),
  };
}

// ------------------------------------------------------------------ anti-spam
function treeRate(game, p) {
  const now = game.now();
  const w = (p.treeMsgTimes ||= []);
  while (w.length && now - w[0] > 1000) w.shift();
  w.push(now);
  if (w.length > TREE_MSG_PER_S) {
    if (w.length === TREE_MSG_PER_S + 1) game.security?.flag?.(p, 'tree_spam', 1, { n: w.length });
    game.error(p, 'rate_limit', 'Trop de demandes : patientez un instant.');
    return false;
  }
  return true;
}

function treeError(game, p, res) {
  const code = res.code || 'tree_unknown';
  game.error(p, code, TREE_ERRORS[code] || 'Allocation refusée.');
}

// ------------------------------------------------------------------ allocation
/** Apply a validated allocation (+ auto-slot of newly unlocked abilities). */
function commitAlloc(game, p, alloc) {
  const before = p.tree.unlocked;
  p.skills.alloc = alloc;
  p.tree = buildTree(p.cls, p.skills);
  const added = [];
  for (const id of p.tree.unlocked) {
    if (before.has(id)) continue;
    added.push(id);
    autoSlot(p.skills.loadout, id);
  }
  refreshTree(p);
  for (const id of added) {
    const def = ABILITY_DEFS.get(id);
    if (def) game.notify(p, 'level', `Nouvelle compétence : ${def.name}`);
  }
  game.store?.markDirty(p.account);
  return added;
}

/**
 * C2S skill_alloc { node } (one rank) — also accepts the design form { add: [{ id, r? }] } (all or nothing).
 */
export function handleSkillAlloc(game, p, msg) {
  if (!treeRate(game, p)) return;
  let adds;
  if (typeof msg.node === 'string') adds = [msg.node];
  else if (Array.isArray(msg.add)) adds = msg.add;
  else return game.error(p, 'bad_request', 'Nœud invalide.');
  return allocAll(game, p, adds);
}

/** C2S skill_alloc_batch { nodes: [nodeId, …] } — each entry adds one rank; all or nothing (tree preview « Valider »). */
export function handleSkillAllocBatch(game, p, msg) {
  if (!treeRate(game, p)) return;
  if (!Array.isArray(msg.nodes) || msg.nodes.length === 0) return game.error(p, 'bad_request', 'Liste de nœuds invalide.');
  if (msg.nodes.length > MAX_ALLOC_BATCH) {
    game.security?.flag?.(p, 'tree_spam', 1, { n: msg.nodes.length });
    return game.error(p, 'bad_request', 'Trop de nœuds dans une seule demande.');
  }
  return allocAll(game, p, msg.nodes);
}

function allocAll(game, p, adds) {
  if (adds.length > MAX_ALLOC_BATCH || adds.some((a) => !(typeof a === 'string' || (a && typeof a === 'object' && typeof a.id === 'string')))) {
    return game.error(p, 'bad_request', 'Nœud invalide.');
  }
  if (p.dead) return game.error(p, 'dead', 'Vous êtes mort.');
  const res = allocate(p.cls, p.level, p.skills, adds);
  if (!res.ok) {
    // a well-behaved client never asks for an unknown node: count it towards the refusal-spam detection
    if (res.code === 'tree_unknown') game.security?.flag?.(p, 'tree_forged', 1, { node: String(res.node).slice(0, 40) });
    return treeError(game, p, res);
  }
  const names = adds.map((a) => NODES.get(typeof a === 'string' ? a : a.id)?.name).filter(Boolean);
  commitAlloc(game, p, res.alloc);
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.SKILL, src: p.id });
  if (names.length === 1) game.notify(p, 'info', `Appris : ${names[0]}`);
  else game.notify(p, 'info', `${names.length} nœuds appris.`);
  return true;
}

// ------------------------------------------------------------------ action bar
/** C2S loadout { slots: [abilityId | 'item:<id>' | null] × 8 } — saved per character. */
export function handleLoadout(game, p, msg) {
  if (!treeRate(game, p)) return;
  const res = checkLoadout(msg.slots, p.tree.unlocked);
  if (!res.ok) return game.error(p, 'loadout_bad', TREE_ERRORS.loadout_bad);
  p.skills.loadout = res.slots;
  p.markDirty('loadout', 'abilities');
  game.store?.markDirty(p.account);
  return true;
}

// ------------------------------------------------------------------ Renaissance
/**
 * C2S renaissance { confirm: true, affinity?: cls } — level 30, alive, out of combat. Back to level 1 with every
 * point refunded (Fondamentaux included), gear / gold / inventory / quests kept; permanent bonuses.
 */
export function handleRenaissance(game, p, msg) {
  if (msg.confirm !== true) return game.error(p, 'bad_request', 'Confirmez la Renaissance.');
  if (p.dead) return game.error(p, 'dead', 'Vous êtes mort.');
  const n = p.skills.rb || 0;
  if (n >= RENAISSANCE.max) return game.error(p, 'renaissance_max', 'Vous êtes déjà Né de la Brume V.');
  if (p.level < RENAISSANCE.level) return game.error(p, 'renaissance_level', `La Renaissance demande le niveau ${RENAISSANCE.level}.`);
  const now = game.now();
  if (now - p.lastCombat < RENAISSANCE_CALM_MS) return game.error(p, 'tree_combat', TREE_ERRORS.tree_combat);
  const affinity = [...(p.skills.affinity || [])];
  if (affinitySlots(n + 1) > affinitySlots(n)) {
    const a = msg.affinity;
    if (!TREE_CLASSES.includes(a) || a === p.cls || affinity.includes(a)) {
      return game.error(p, 'bad_request', 'Choisissez une classe d\'affinité (une autre classe que la vôtre).');
    }
    affinity.push(a);
  }
  applyRenaissance(game, p, affinity);
  return true;
}

export function applyRenaissance(game, p, affinity) {
  const rb = (p.skills.rb || 0) + 1;
  const loadout = freshSkills(p.cls).loadout;
  p.skills = { ...freshSkills(p.cls), rb, affinity, loadout };
  p.level = 1;
  p.xp = 0;
  p.staticVer++; // `lv` and the aura (`rb`) changed
  // gear above level 1 goes back to the bag when there is room (else it stays worn but inert: playerStats)
  for (const slot of ['weapon', 'armor']) {
    const id = p.eq[slot];
    if (!id || (ITEMS[id].lvl || 1) <= 1) continue;
    const free = firstEmpty(p.inv);
    if (free < 0) continue;
    p.inv[free] = { id, q: 1 };
    p.eq[slot] = null;
  }
  p.cds?.clear?.();
  refreshTree(p);
  p.hp = p.mhp;
  p.mp = p.mmp;
  p.st = p.mst;
  p.markDirty('level', 'xp', 'xpNext', 'inv', 'eq', 'hp', 'mp', 'st', 'stats');
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.RENAISSANCE, src: p.id, n: rb });
  const title = renaissanceTitle(rb);
  game.notify(p, 'level', `Renaissance ! Vous êtes désormais ${title}.`);
  game.systemChat(`${p.name} renaît de la brume : ${title} !`);
  game.log.info(`${p.name} : Renaissance ${rb}${affinity.length ? ` (affinité : ${affinity.map((c) => CLASSES[c].name).join(', ')})` : ''}`);
  game.store?.markDirty(p.account);
}

/** XP multiplier of the Renaissance bonus (+15 % per Renaissance). */
export const xpMultOf = (p) => 1 + Math.min(p.skills?.rb || 0, RENAISSANCE.max) * RENAISSANCE.xpPct;

/** Level up: the budget grows, nothing else to do (points stay unspent until the player chooses). */
export function onLevelUp(game, p) {
  p.markDirty('points', 'renaissance');
  if (p.level >= MAX_LEVEL && (p.skills.rb || 0) < RENAISSANCE.max) {
    game.notify(p, 'level', 'La Renaissance vous attend au pied de l\'Arbre-Brume.');
  }
}

export { unlockedAbilities };
