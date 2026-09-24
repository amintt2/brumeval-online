// Inventory actions: use (potions), equip / unequip, drop.
import { ITEMS, CLASSES, INV_SIZE, EQUIP_SLOTS } from '../../../shared/data.js';
import { removeAt, firstEmpty, equipSlotOf, addItem, formatItem } from '../inventory.js';
import { isInt } from '../util.js';
import { healPlayer } from './players.js';
import { stat } from '../../../shared/skills.js'; // [skilltree]

function slotItem(game, p, slot) {
  if (!isInt(slot, 0, INV_SIZE - 1)) { game.error(p, 'bad_request', 'Emplacement invalide.'); return null; }
  const s = p.inv[slot];
  if (!s) { game.error(p, 'bad_request', 'Emplacement vide.'); return null; }
  return s;
}

/** Why the player cannot equip this item, or null. */
export function equipError(item, cls, level) {
  // [skilltree] v0.3: no class restriction any more (a hybrid wields the weapon of its abilities); item.cls = recommended
  if (level < (item.lvl || 1)) return `Niveau ${item.lvl} requis.`;
  return null;
}

export function equipFromSlot(game, p, slot) {
  const s = slotItem(game, p, slot);
  if (!s) return;
  const item = ITEMS[s.id];
  const eqSlot = equipSlotOf(s.id);
  if (!eqSlot) return game.error(p, 'cant_use', 'Cet objet ne peut pas être équipé.');
  const err = equipError(item, p.cls, p.level);
  if (err) return game.error(p, 'cant_use', err);
  const prev = p.eq[eqSlot];
  if (s.q > 1) {
    // defensive: equipment never stacks, but keep the extra units if it ever does
    if (prev && firstEmpty(p.inv) < 0) return game.error(p, 'inv_full', 'Inventaire plein');
    s.q -= 1;
    if (prev) addItem(p.inv, prev, 1);
  } else {
    p.inv[slot] = prev ? { id: prev, q: 1 } : null;
  }
  p.eq[eqSlot] = s.id;
  p.recomputeStats();
  p.markDirty('inv', 'eq');
  game.notify(p, 'info', `Équipé : ${item.name}`);
  game.store?.markDirty();
}

export function handleUseItem(game, p, msg) {
  const s = slotItem(game, p, msg.slot);
  if (!s) return;
  const item = ITEMS[s.id];
  if (item.type === 'weapon' || item.type === 'armor') return equipFromSlot(game, p, msg.slot);
  if (item.type !== 'consumable') return game.error(p, 'cant_use', 'Cet objet ne peut pas être utilisé.');
  if (p.dead) return game.error(p, 'dead', 'Vous êtes mort.');
  const wantsHp = item.heal > 0 && p.hp < p.mhp;
  const wantsMp = item.mana > 0 && p.mp < p.mmp;
  if (!wantsHp && !wantsMp) {
    return game.error(p, 'cant_use', item.heal > 0 ? 'Vos points de vie sont déjà au maximum.' : 'Votre mana est déjà au maximum.');
  }
  removeAt(p.inv, msg.slot, 1);
  p.markDirty('inv');
  if (item.heal > 0) healPlayer(game, p, item.heal, null);
  if (item.mana > 0) {
    // [skilltree] Alchimiste de fortune (+x %), Pacte de la lune de sang (−50 % on mana potions)
    const k = p.tree ? Math.max(0, 1 + stat(p.tree, 'potionPct') + stat(p.tree, 'potionPct.mana')) : 1;
    p.mp = Math.min(p.mmp, p.mp + Math.round(item.mana * k));
    p.markDirty('mp');
  }
}

export function handleEquip(game, p, msg) {
  equipFromSlot(game, p, msg.slot);
}

export function handleUnequip(game, p, msg) {
  if (!EQUIP_SLOTS.includes(msg.slot)) return game.error(p, 'bad_request', 'Emplacement d\'équipement invalide.');
  const id = p.eq[msg.slot];
  if (!id) return game.error(p, 'bad_request', 'Aucun objet équipé à cet emplacement.');
  const free = firstEmpty(p.inv);
  if (free < 0) return game.error(p, 'inv_full', 'Inventaire plein');
  p.inv[free] = { id, q: 1 };
  p.eq[msg.slot] = null;
  p.recomputeStats();
  p.markDirty('inv', 'eq');
  game.notify(p, 'info', `Retiré : ${ITEMS[id].name}`);
  game.store?.markDirty();
}

export function handleDrop(game, p, msg) {
  const s = slotItem(game, p, msg.slot);
  if (!s) return;
  p.inv[msg.slot] = null;
  p.markDirty('inv');
  game.notify(p, 'info', `Objet jeté : ${formatItem(s.id, s.q)}`);
  game.store?.markDirty();
}
