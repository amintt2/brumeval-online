// Inventory panel: 24 slots, rarity borders, quantities, tooltips, left-click use/equip,
// right-click context menu (Utiliser/Équiper, Vendre while a shop is open, Jeter with confirmation).
import { ITEMS, INV_SIZE, RARITY_COLORS, CLASSES, canUse } from '@shared/data.js';
import { h, setText, toggleClass, fmt } from '../dom.js';
import { iconBox, setIcon, itemIconSpec } from '../icons.js';
import { itemTooltip } from '../tooltip.js';
import { createWindow } from './window.js';
import { goldView } from './common.js';

export function createInventoryPanel(wm, { handlers, tooltip, menus, notify, isShopOpen, onToggle }) {
  const win = wm.add(createWindow({
    id: 'inventory', title: 'Sac', keyHint: 'I',
    onShow: () => { onToggle?.(true); render(); },
    onHide: () => onToggle?.(false),
  }));
  let self = null;
  const slots = [];
  const grid = h('div', { class: 'bv-inv-grid' });
  for (let i = 0; i < INV_SIZE; i++) {
    const icon = iconBox(null);
    const qty = h('span', { class: 'bv-slot-count' });
    const btn = h('button', { class: 'bv-slot bv-inv-slot is-empty', type: 'button', 'aria-label': `Emplacement ${i + 1}` }, icon, qty);
    const s = { btn, icon, qty, id: null, q: 0 };
    btn.addEventListener('click', () => primary(i));
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey && isShopOpen() && slots[i].id && ITEMS[slots[i].id]?.sell) {
        handlers.sell?.(i);
        return;
      }
      context(i, e.clientX, e.clientY);
    });
    tooltip.bind(btn, () => {
      const it = slots[i].id;
      if (!it) return null;
      const item = ITEMS[it];
      let hint;
      if (isShopOpen()) hint = item.sell ? 'Clic droit : vendre · Maj + clic droit : vente rapide' : 'Clic droit : options';
      else if (item.type === 'consumable') hint = 'Clic : utiliser · Clic droit : options';
      else if (item.type === 'weapon' || item.type === 'armor') hint = 'Clic : équiper · Clic droit : options';
      else hint = 'Clic droit : options';
      return itemTooltip(it, { self, qty: slots[i].q, shop: isShopOpen() ? 'sell' : null, hint });
    });
    slots.push(s);
    grid.appendChild(btn);
  }
  const goldEl = goldView(0);
  const goldV = goldEl.querySelector('.bv-gi-v');
  const goldSlot = h('div', { class: 'bv-inv-gold' }, goldEl);
  const countEl = h('span', { class: 'bv-inv-count' });
  const shopHint = h('div', { class: 'bv-inv-shophint', text: 'Boutique ouverte — clic droit sur un objet pour le vendre' });
  win.body.append(grid, shopHint);
  win.footer.append(goldSlot, countEl);

  function reasonCantUse(item) {
    if (!self) return null;
    if ((item.lvl || 1) > self.level) return `Niveau ${item.lvl} requis`;
    return null;
  }

  function primary(i) {
    const id = slots[i].id;
    if (!id) return;
    const item = ITEMS[id];
    if (!item) return;
    if (item.type === 'consumable') handlers.useItem?.(i);
    else if (item.type === 'weapon' || item.type === 'armor') {
      const why = reasonCantUse(item);
      if (why) notify(`Impossible d'équiper ${item.name} : ${why.toLowerCase()}.`, 'error');
      else handlers.equip?.(i);
    } else {
      const r = slots[i].btn.getBoundingClientRect();
      context(i, r.left + r.width / 2, r.top + r.height / 2);
    }
  }

  function context(i, x, y) {
    const id = slots[i].id;
    if (!id) return;
    const item = ITEMS[id];
    const q = slots[i].q;
    const items = [];
    if (item.type === 'consumable') items.push({ label: 'Utiliser', onClick: () => handlers.useItem?.(i) });
    else if (item.type === 'weapon' || item.type === 'armor') {
      const why = reasonCantUse(item);
      items.push({ label: 'Équiper', disabled: !!why, note: why || null, onClick: () => handlers.equip?.(i) });
    }
    if (isShopOpen()) {
      if (item.sell) items.push({ label: q > 1 ? `Vendre (×${q})` : 'Vendre', note: `${fmt(item.sell * q)} po`, onClick: () => handlers.sell?.(i) });
      else items.push({ label: 'Vendre', disabled: true, note: 'Sans valeur' });
    }
    items.push({
      label: 'Jeter',
      danger: true,
      onClick: () => menus.confirm({
        title: 'Jeter l\'objet',
        text: `Voulez-vous vraiment détruire « ${item.name} »${q > 1 ? ` (×${q})` : ''} ? Cette action est irréversible.`,
        ok: 'Jeter',
        cancel: 'Garder',
        danger: true,
      }, (ok) => {
        // make sure the slot still holds the same item before dropping
        if (ok && slots[i].id === id) handlers.drop?.(i);
      }),
    });
    menus.contextMenu(x, y, items, item.name, RARITY_COLORS[item.rarity]);
  }

  function render() {
    if (!self) return;
    const inv = self.inv || [];
    let used = 0;
    for (let i = 0; i < INV_SIZE; i++) {
      const s = slots[i];
      const e = inv[i] || null;
      const id = e && ITEMS[e.id] ? e.id : null;
      const q = id ? e.q || 1 : 0;
      if (id) used++;
      if (id !== s.id) {
        s.id = id;
        setIcon(s.icon, id ? itemIconSpec(id) : null);
        toggleClass(s.btn, 'is-empty', !id);
        if (id) s.btn.style.setProperty('--rar', RARITY_COLORS[ITEMS[id].rarity]);
        else s.btn.style.removeProperty('--rar');
        s.btn.dataset.rarity = id ? ITEMS[id].rarity : '';
        s.btn.setAttribute('aria-label', id ? ITEMS[id].name : `Emplacement ${i + 1}`);
      }
      if (q !== s.q) {
        s.q = q;
        setText(s.qty, q > 1 ? q : '');
      }
      toggleClass(s.btn, 'unusable', !!id && (ITEMS[id].type === 'weapon' || ITEMS[id].type === 'armor') && !canUse(ITEMS[id], self.cls, self.level));
    }
    setText(goldV, fmt(self.gold || 0));
    setText(countEl, `${used} / ${INV_SIZE}`);
    toggleClass(countEl, 'full', used >= INV_SIZE);
    shopHint.hidden = !isShopOpen();
    toggleClass(win.el, 'shop-open', isShopOpen());
  }

  return {
    win,
    update(s) {
      self = s;
      if (win.isOpen) render();
    },
    refresh() {
      if (win.isOpen) render();
    },
  };
}
