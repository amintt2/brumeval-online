// Character panel: class art, weapon & armor slots (click → unequip) and derived stats.
import { CLASSES, ITEMS, RARITY_COLORS, xpToNext } from '@shared/data.js';
import { h, setText, toggleClass, fmt, fmt1, pct } from '../dom.js';
import { iconBox, setIcon, itemIconSpec, classIconSpec, glyph } from '../icons.js';
import { itemTooltip, simpleTooltip } from '../tooltip.js';
import { createWindow } from './window.js';

const SLOT_LABEL = { weapon: 'Arme', armor: 'Armure' };

export function createCharacterPanel(wm, { handlers, tooltip, menus, onToggle }) {
  const win = wm.add(createWindow({
    id: 'character', title: 'Personnage', keyHint: 'C',
    onShow: () => { onToggle?.(true); render(); },
    onHide: () => onToggle?.(false),
  }));
  let self = null;

  const eqSlots = {};
  function eqSlot(slot) {
    const icon = iconBox(null);
    const empty = h('span', { class: 'bv-eq-empty' }, glyph(slot === 'weapon' ? 'sword' : 'armor'));
    const btn = h('button', { class: `bv-slot bv-eq-slot eq-${slot} is-empty`, type: 'button', 'aria-label': SLOT_LABEL[slot] }, empty, icon);
    const wrap = h('div', { class: 'bv-eq' }, btn, h('div', { class: 'bv-eq-label', text: SLOT_LABEL[slot] }));
    btn.addEventListener('click', () => {
      if (self?.eq?.[slot]) handlers.unequip?.(slot);
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = self?.eq?.[slot];
      if (!id) return;
      menus.contextMenu(e.clientX, e.clientY, [{ label: 'Déséquiper', onClick: () => handlers.unequip?.(slot) }], ITEMS[id]?.name, RARITY_COLORS[ITEMS[id]?.rarity]);
    });
    tooltip.bind(btn, () => {
      const id = self?.eq?.[slot];
      if (!id) return simpleTooltip(SLOT_LABEL[slot], 'Aucun objet équipé.', 'Équipez un objet depuis votre sac.');
      return itemTooltip(id, { self, equipped: true, hint: 'Clic : déséquiper' });
    });
    eqSlots[slot] = { btn, icon, id: null };
    return wrap;
  }

  const art = iconBox(null, 'bv-char-art-img');
  const nameEl = h('div', { class: 'bv-char-name' });
  const subEl = h('div', { class: 'bv-char-sub' });
  const top = h('div', { class: 'bv-char-top' },
    eqSlot('weapon'),
    h('div', { class: 'bv-char-art' }, h('div', { class: 'bv-char-glow' }), art),
    eqSlot('armor'));

  const xpFill = h('i');
  const xpText = h('span');
  const xp = h('div', { class: 'bv-char-xp' }, xpFill, xpText);

  const statRows = {};
  const STATS = [
    ['hp', 'Points de vie', 'Total de vos points de vie.'],
    ['mp', 'Mana', 'Ressource consommée par vos capacités.'],
    ['atk', 'Attaque', 'Augmente les dégâts de toutes vos capacités.'],
    ['def', 'Défense', 'Réduit les dégâts subis.'],
    ['crit', 'Critique', 'Chance d\'infliger un coup critique (160 % des dégâts).'],
    ['red', 'Réduction', 'Part des dégâts subis absorbée grâce à votre défense.'],
    ['speed', 'Vitesse', 'Vitesse de déplacement en mètres par seconde.'],
    ['gold', 'Or', 'Votre fortune, en pièces d\'or (po).'],
  ];
  const statsGrid = h('div', { class: 'bv-char-stats' });
  for (const [k, label, desc] of STATS) {
    const v = h('span', { class: 'bv-cs-v' });
    const row = h('div', { class: `bv-cs cs-${k}` }, h('span', { class: 'bv-cs-l', text: label }), v);
    tooltip.bind(row, () => simpleTooltip(label, desc));
    statRows[k] = v;
    statsGrid.appendChild(row);
  }

  win.body.append(
    top,
    h('div', { class: 'bv-char-ident' }, nameEl, subEl),
    xp,
    h('div', { class: 'bv-sec-title', text: 'Caractéristiques' }),
    statsGrid);
  win.footer.append(h('span', { class: 'bv-foot-hint', text: 'Cliquez sur un équipement pour le retirer.' }));

  let lastCls = null;
  function render() {
    if (!self) return;
    const c = CLASSES[self.cls];
    if (self.cls !== lastCls) {
      lastCls = self.cls;
      setIcon(art, classIconSpec(self.cls, 'class'));
      win.el.style.setProperty('--cc', c?.color || '#888');
    }
    setText(nameEl, self.name);
    setText(subEl, `${c?.name || ''} · Niveau ${self.level}`);
    for (const slot of ['weapon', 'armor']) {
      const s = eqSlots[slot];
      const id = self.eq?.[slot] || null;
      if (id !== s.id) {
        s.id = id;
        setIcon(s.icon, id ? itemIconSpec(id) : null);
        toggleClass(s.btn, 'is-empty', !id);
        if (id) s.btn.style.setProperty('--rar', RARITY_COLORS[ITEMS[id]?.rarity]);
        else s.btn.style.removeProperty('--rar');
      }
    }
    const next = self.xpNext ?? xpToNext(self.level);
    xpFill.style.width = next ? `${Math.min(100, (self.xp / next) * 100).toFixed(1)}%` : '100%';
    setText(xpText, next ? `${fmt(self.xp)} / ${fmt(next)} XP` : 'Niveau maximum');
    const st = self.stats || {};
    const def = st.def || 0;
    setText(statRows.hp, `${fmt(self.hp)} / ${fmt(self.mhp)}`);
    setText(statRows.mp, `${fmt(self.mp)} / ${fmt(self.mmp)}`);
    setText(statRows.atk, fmt(st.atk || 0));
    setText(statRows.def, fmt(def));
    setText(statRows.red, pct(1 - 60 / (60 + def)));
    setText(statRows.crit, pct(st.crit || 0));
    setText(statRows.speed, `${fmt1(st.speed || 0)} m/s`);
    setText(statRows.gold, `${fmt(self.gold || 0)} po`);
  }

  return {
    win,
    update(s) {
      self = s;
      if (win.isOpen) render();
    },
  };
}
