// Pure inventory helpers. An inventory is an array of INV_SIZE slots: null | { id: itemId, q: qty }.
import { ITEMS, INV_SIZE } from '../../shared/data.js';
import { has } from './util.js';

export const isItem = (id) => has(ITEMS, id);
export const stackSize = (id) => (isItem(id) ? Math.max(1, ITEMS[id].stack || 1) : 1);
export const isEquipment = (id) => isItem(id) && (ITEMS[id].type === 'weapon' || ITEMS[id].type === 'armor');
/** Equipment slot ('weapon' | 'armor') an item goes into, or null. */
export const equipSlotOf = (id) => (isEquipment(id) ? ITEMS[id].type : null);

export const emptyInventory = () => new Array(INV_SIZE).fill(null);
export const cloneInventory = (inv) => inv.map((s) => (s ? { id: s.id, q: s.q } : null));

export function firstEmpty(inv) {
  for (let i = 0; i < inv.length; i++) if (!inv[i]) return i;
  return -1;
}

export function freeSlots(inv) {
  let n = 0;
  for (const s of inv) if (!s) n++;
  return n;
}

/** How many units of `id` can still be added. */
export function spaceFor(inv, id) {
  if (!isItem(id)) return 0;
  const max = stackSize(id);
  let space = 0;
  for (const s of inv) {
    if (!s) space += max;
    else if (s.id === id && s.q < max) space += max - s.q;
  }
  return space;
}

export const canAdd = (inv, id, qty) => spaceFor(inv, id) >= qty;

/** True if every [id, qty] of `list` fits at once. */
export function canAddAll(inv, list) {
  const copy = cloneInventory(inv);
  for (const [id, qty] of list) if (addItem(copy, id, qty) < qty) return false;
  return true;
}

/**
 * Add up to `qty` units, filling existing stacks first, then empty slots (in order).
 * Mutates `inv`; returns the number of units actually added.
 */
export function addItem(inv, id, qty) {
  if (!isItem(id) || !(qty > 0)) return 0;
  const max = stackSize(id);
  let left = Math.floor(qty);
  for (let i = 0; i < inv.length && left > 0; i++) {
    const s = inv[i];
    if (s && s.id === id && s.q < max) {
      const n = Math.min(left, max - s.q);
      s.q += n;
      left -= n;
    }
  }
  for (let i = 0; i < inv.length && left > 0; i++) {
    if (!inv[i]) {
      const n = Math.min(left, max);
      inv[i] = { id, q: n };
      left -= n;
    }
  }
  return Math.floor(qty) - left;
}

/** Remove up to `qty` units from one slot. Returns the number removed. */
export function removeAt(inv, slot, qty = Infinity) {
  const s = inv[slot];
  if (!s) return 0;
  const n = Math.min(s.q, qty);
  s.q -= n;
  if (s.q <= 0) inv[slot] = null;
  return n;
}

export function countItem(inv, id) {
  let n = 0;
  for (const s of inv) if (s && s.id === id) n += s.q;
  return n;
}

/** "Petite potion de soin x2" / "Gelée de gluant". */
export function formatItem(id, qty = 1) {
  const name = isItem(id) ? ITEMS[id].name : id;
  return qty > 1 ? `${name} x${qty}` : name;
}

/**
 * Sanitise a persisted inventory: exactly INV_SIZE slots, known items, integer quantities within stack limits.
 * Unknown/invalid entries are dropped.
 */
export function sanitizeInventory(raw) {
  const inv = emptyInventory();
  if (!Array.isArray(raw)) return inv;
  for (let i = 0; i < INV_SIZE && i < raw.length; i++) {
    const s = raw[i];
    if (!s || typeof s !== 'object' || !isItem(s.id)) continue;
    const q = Math.min(stackSize(s.id), Math.floor(Number(s.q)));
    if (q > 0) inv[i] = { id: s.id, q };
  }
  return inv;
}
