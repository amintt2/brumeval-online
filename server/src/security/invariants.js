// Economy invariants checked after every player action and periodically:
//   - inventory: an array of INV_SIZE slots, each null or { id: known item, q: integer 1..stack size };
//     no slot object shared by two slots (aliasing = duplication exploit); equipment never stacks
//   - equipment: known items in the right slot
//   - gold: integer in [0, maxGold]
// Violations are repaired and reported; in strict mode (tests, SECURITY_ASSERT=1) they throw.
import { ITEMS, INV_SIZE } from '../../../shared/data.js';

const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const stackOf = (id) => Math.max(1, ITEMS[id].stack || 1);
const isEquip = (id) => ITEMS[id].type === 'weapon' || ITEMS[id].type === 'armor';

/**
 * Check (and repair when `repair`) a player's gold / inventory / equipment.
 * @returns {string[]} problems found (empty = healthy)
 */
export function checkPlayerInvariants(p, { maxGold = 10_000_000, repair = true } = {}) {
  const problems = [];
  // gold
  if (!(typeof p.gold === 'number' && Number.isInteger(p.gold) && p.gold >= 0 && p.gold <= maxGold)) {
    problems.push(`gold:${p.gold}`);
    if (repair) {
      const g = Number.isFinite(p.gold) ? Math.floor(p.gold) : 0;
      p.gold = Math.max(0, Math.min(maxGold, g));
      p.markDirty?.('gold');
    }
  }
  // inventory
  if (!Array.isArray(p.inv)) {
    problems.push('inv:not_array');
    if (repair) {
      p.inv = new Array(INV_SIZE).fill(null);
      p.markDirty?.('inv');
    }
  } else {
    let changed = false;
    if (p.inv.length !== INV_SIZE) {
      problems.push(`inv:length:${p.inv.length}`);
      if (repair) {
        p.inv.length = INV_SIZE;
        for (let i = 0; i < INV_SIZE; i++) if (p.inv[i] === undefined) p.inv[i] = null;
        changed = true;
      }
    }
    const seen = new Set();
    for (let i = 0; i < p.inv.length; i++) {
      const s = p.inv[i];
      if (s === null) continue;
      if (!s || typeof s !== 'object' || !has(ITEMS, s.id)) {
        problems.push(`inv[${i}]:bad_item`);
        if (repair) { p.inv[i] = null; changed = true; }
        continue;
      }
      if (seen.has(s)) {
        problems.push(`inv[${i}]:aliased`);
        if (repair) { p.inv[i] = null; changed = true; }
        continue;
      }
      seen.add(s);
      const max = isEquip(s.id) ? 1 : stackOf(s.id);
      if (!Number.isInteger(s.q) || s.q < 1 || s.q > max) {
        problems.push(`inv[${i}]:qty:${s.id}:${s.q}`);
        if (repair) {
          const q = Number.isFinite(s.q) ? Math.floor(s.q) : 0;
          if (q < 1) p.inv[i] = null;
          else s.q = Math.min(q, max);
          changed = true;
        }
      }
    }
    if (changed) p.markDirty?.('inv');
  }
  // equipment
  if (p.eq && typeof p.eq === 'object') {
    for (const slot of ['weapon', 'armor']) {
      const id = p.eq[slot];
      if (id === null || id === undefined) continue;
      if (!has(ITEMS, id) || ITEMS[id].type !== slot) {
        problems.push(`eq.${slot}:${id}`);
        if (repair) {
          p.eq[slot] = null;
          p.recomputeStats?.();
          p.markDirty?.('eq');
        }
      }
    }
  }
  return problems;
}
