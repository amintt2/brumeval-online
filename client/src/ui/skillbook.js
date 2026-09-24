// [skilltree] Livre de compétences (K by default): every learnt ability with its icon (emblem fallback until
// /icons/ab_<id>.png exists), description and resolved costs (variants, passives, Inaptitude in orange), the
// Fondamentaux with their real keys, and the consumables of the bag — drag any of them onto the action bar (or
// double-click to put it in the first free slot).
import { ITEMS } from '@shared/data.js';
import { ABILITY_DEFS, NOT_SLOTTABLE, checkLoadout, autoSlot } from '@shared/skills.js';
import { h, setText, fmt1, clear } from './dom.js';
import { iconBox, abilityIconSpec, itemIconSpec, glyph } from './icons.js';
import { itemTooltip } from './tooltip.js';
import { abilityTip, KIND_LABEL, activeVariants } from './skillTips.js';
import { createWindow } from './panels/window.js';
import { makeDraggable } from './dragdrop.js';
import { keybinds } from '../game/keybinds.js';
import { learntAbilities, specOf, loadoutOf, hasTree, knows, treeOf } from '../game/skillState.js';

const FONDS = [
  ['roulade', 'roll'], ['sprint', 'sprint'], ['saut', 'jump'], ['garde', 'guard'], ['attaque_chargee', 'slot1'],
];

export function createSkillBook(wm, { tooltip, handlers, notify, onToggle, onOpenTree }) {
  let self = null;
  let dirty = true;
  const win = wm.add(createWindow({
    id: 'book', title: 'Livre de compétences', subtitle: '', keyHint: keybinds.label('book') || 'K',
    onShow: () => { render(); onToggle?.(true); },
    onHide: () => onToggle?.(false),
  }));
  const intro = h('p', { class: 'bv-book-intro' });
  const fondList = h('div', { class: 'bv-book-fonds' });
  const list = h('div', { class: 'bv-book-list' });
  const items = h('div', { class: 'bv-book-items' });
  const itemsTitle = h('div', { class: 'bv-sec-title', text: 'Objets de la barre' });
  win.body.append(intro,
    h('div', { class: 'bv-sec-title', text: 'Fondamentaux' }), fondList,
    h('div', { class: 'bv-sec-title', text: 'Compétences' }), list,
    itemsTitle, items);
  const treeBtn = h('button', { class: 'bv-btn small', type: 'button', onclick: () => onOpenTree?.() }, glyph('tree'), h('span', { text: 'Arbre des Brumes' }), h('kbd', { class: 'bv-book-treekey' }));
  win.footer.append(h('span', { class: 'bv-book-hint', text: 'Glissez sur la barre d\'action · double-clic : premier emplacement libre' }), treeBtn);

  /** Put an entry in the first free slot of the bar (2–4 first, like the server's auto-slot). */
  function quickSlot(entry) {
    if (!self || !hasTree(self)) return;
    const lo = [...loadoutOf(self)];
    if (lo.includes(entry)) { notify?.('Déjà dans la barre d\'action.', 'info'); return; }
    let i = autoSlot(lo, entry);
    if (i < 0 && entry.startsWith('item:')) {
      for (const k of [4, 5, 6, 7, 1, 2, 3]) if (!lo[k]) { lo[k] = entry; i = k; break; }
    }
    if (i < 0) { notify?.('La barre d\'action est pleine : glissez l\'entrée sur un emplacement.', 'error'); return; }
    const res = checkLoadout(lo, treeOf(self).unlocked);
    if (res.ok) handlers.setLoadout?.(res.slots);
  }

  function dropFromBook(target, p) {
    if (!self || !hasTree(self) || !target || target.dataset.drop !== 'bar') return;
    const to = Number(target.dataset.slot);
    const lo = [...loadoutOf(self)];
    const k = lo.indexOf(p.entry);
    if (k === to) return;
    if (k >= 0) lo[k] = lo[to];
    lo[to] = p.entry;
    if (!(lo[0] && ABILITY_DEFS.get(lo[0])?.base)) {
      notify?.('L\'emplacement 1 est réservé à une attaque de base (l\'attaque automatique).', 'error');
      return;
    }
    const res = checkLoadout(lo, treeOf(self).unlocked);
    if (!res.ok) { notify?.('Cette barre d\'action n\'est pas valide.', 'error'); return; }
    handlers.setLoadout?.(res.slots);
  }

  function slotLabel(entry) {
    const i = loadoutOf(self).indexOf(entry);
    return i >= 0 ? keybinds.label(`slot${i + 1}`) || String(i + 1) : '';
  }

  function card(id) {
    const def = ABILITY_DEFS.get(id);
    const a = specOf(self, id) || def;
    const costs = [];
    if (a.mp > 0) costs.push(`${fmt1(a.mp)} mana`);
    if (a.st > 0) costs.push(`${fmt1(a.st)} end.`);
    if (a.cd > 0) costs.push(`${fmt1(a.cd)} s`);
    if (a.range > 0) costs.push(`${fmt1(a.range)} m`);
    const inBar = slotLabel(id);
    const variants = activeVariants(self, id);
    const el = h('div', { class: `bv-book-card${a.inapt > 0 ? ' inapt' : ''}${a.usable === false ? ' unusable' : ''}${inBar ? ' in-bar' : ''}`, tabIndex: 0, role: 'listitem' },
      h('span', { class: 'bv-slot bv-book-icon' }, iconBox(abilityIconSpec(id, self.cls))),
      h('div', { class: 'bv-book-main' },
        h('div', { class: 'bv-book-name' },
          h('span', { text: def.name }),
          def.base ? h('span', { class: 'bv-book-tag', text: 'Attaque de base' }) : h('span', { class: 'bv-book-tag dim', text: KIND_LABEL[def.kind] || '' }),
          a.inapt > 0 ? h('span', { class: 'bv-book-tag inapt', text: 'Inapte' }) : null,
          inBar ? h('kbd', { class: 'bv-book-key', title: 'Touche dans la barre d\'action', text: inBar }) : null),
        h('div', { class: 'bv-book-desc', text: def.desc }),
        h('div', { class: 'bv-book-costs' }, costs.join(' · ') || 'Aucun coût',
          variants.length ? h('span', { class: 'bv-book-var', text: ` · ${variants.join(', ')}` }) : null)));
    tooltip.bind(el, () => abilityTip(self, id, { key: inBar || null, hint: inBar ? null : 'Glissez-la sur la barre d\'action' }));
    el.addEventListener('dblclick', () => quickSlot(id));
    makeDraggable(el, {
      payload: () => ({ entry: id }),
      icon: () => iconBox(abilityIconSpec(id, self.cls)),
      onDrop: dropFromBook,
      onStart: () => tooltip.hide(),
    });
    return el;
  }

  function render() {
    if (!win.isOpen || !self) return;
    dirty = false;
    setText(win.el.querySelector('.bv-win-key'), keybinds.label('book'));
    setText(treeBtn.querySelector('kbd'), keybinds.label('tree'));
    if (!hasTree(self)) {
      intro.textContent = 'Le serveur ne gère pas encore l\'Arbre des Brumes.';
      clear(list); clear(fondList); clear(items);
      return;
    }
    const learnt = learntAbilities(self).filter((id) => !NOT_SLOTTABLE.has(id));
    win.setSubtitle(`${learnt.length} compétence${learnt.length > 1 ? 's' : ''} · ${self.points?.free || 0} point${(self.points?.free || 0) > 1 ? 's' : ''} à dépenser`);
    intro.textContent = learnt.length <= 1
      ? 'Au niveau 1, vous n\'avez que votre attaque de base. Chaque niveau donne des points à placer dans l\'Arbre des Brumes : les Fondamentaux d\'abord, puis les compétences de votre classe.'
      : 'Vos compétences, avec leurs valeurs réelles (variantes, passifs, Inaptitude). Glissez-les sur la barre d\'action.';
    clear(fondList).append(...FONDS.map(([id, action]) => {
      const def = ABILITY_DEFS.get(id);
      const k = knows(self, id);
      const keys = action === 'slot1' ? `maintenir ${keybinds.label('slot1') || '1'}` : keybinds.labels(action).join(' / ');
      const el = h('div', { class: `bv-book-fond${k ? '' : ' locked'}` },
        h('span', { class: 'bv-slot bv-book-icon small' }, iconBox(abilityIconSpec(id, self.cls)), k ? null : h('span', { class: 'bv-fond-lock' }, glyph('lock'))),
        h('span', { class: 'bv-book-fond-n', text: def.name }),
        h('kbd', { text: keys || '—' }));
      tooltip.bind(el, () => abilityTip(self, id, { key: keys, hint: k ? 'Fondamental : sa propre touche, pas dans la barre' : 'Pas encore appris (Arbre des Brumes, au centre)' }));
      return el;
    }));
    clear(list).append(...learnt.map(card));
    // consumables of the bag (unique ids) that can go on the bar
    const seen = new Set();
    const cons = [];
    for (const s of self.inv || []) {
      if (!s || seen.has(s.id) || ITEMS[s.id]?.type !== 'consumable') continue;
      seen.add(s.id);
      cons.push(s.id);
    }
    for (const e of loadoutOf(self)) if (e && e.startsWith('item:') && !seen.has(e.slice(5)) && ITEMS[e.slice(5)]) { seen.add(e.slice(5)); cons.push(e.slice(5)); }
    itemsTitle.hidden = !cons.length;
    clear(items).append(...cons.map((id) => {
      const entry = `item:${id}`;
      const n = (self.inv || []).reduce((a, s) => a + (s && s.id === id ? s.q || 1 : 0), 0);
      const inBar = slotLabel(entry);
      const el = h('div', { class: `bv-book-item${inBar ? ' in-bar' : ''}`, tabIndex: 0 },
        h('span', { class: 'bv-slot bv-book-icon small' }, iconBox(itemIconSpec(id)), h('span', { class: 'bv-slot-count', text: n })),
        h('span', { class: 'bv-book-fond-n', text: ITEMS[id].name }),
        inBar ? h('kbd', { text: inBar }) : null);
      tooltip.bind(el, () => itemTooltip(id, { self, qty: n, hint: 'Glissez-la sur la barre d\'action' }));
      el.addEventListener('dblclick', () => quickSlot(entry));
      makeDraggable(el, { payload: () => ({ entry }), icon: () => iconBox(itemIconSpec(id)), onDrop: dropFromBook, onStart: () => tooltip.hide() });
      return el;
    }));
  }

  keybinds.onChange(() => { if (win.isOpen) render(); });
  let key = '';
  return {
    win,
    update(s) {
      self = s;
      // re-render only when something the book shows changed
      const k = JSON.stringify([s.tree, s.loadout, s.eq, s.renaissance?.n, s.points, (s.inv || []).map((x) => x && `${x.id}:${x.q}`), s.mp > 0]);
      if (k !== key) { key = k; dirty = true; }
      if (dirty) render();
    },
    refresh: render,
  };
}
