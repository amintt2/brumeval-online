// Action bar ([skilltree] v0.3): 8 slots (keys 1–8 by default, rebindable) holding the loadout saved on the server —
// abilities of the tree (slot 1 = base attack, hold it for the Attaque chargée) or consumables ('item:<id>', potions on
// 5 and 6 by default). Drag & drop from the skill book (K), between slots, or out of the bar to empty a slot.
// Cooldown sweeps per slot, mana / weapon / stamina states, and the Fondamentaux (Roulade, Saut, Garde, Sprint) with
// their real keys on the left.
import { ITEMS } from '@shared/data.js';
import { checkLoadout, ABILITY_DEFS, LOADOUT_SLOTS } from '@shared/skills.js';
import { h, setText, toggleClass, fmt1 } from './dom.js';
import { iconBox, setIcon, abilityIconSpec, itemIconSpec, glyph } from './icons.js';
import { simpleTooltip, itemTooltip } from './tooltip.js';
import { abilityTip } from './skillTips.js';
import { makeDraggable } from './dragdrop.js';
import { keybinds } from '../game/keybinds.js';
import { loadoutOf, specOf, knows, hasTree, treeOf, isItemEntry } from '../game/skillState.js';

const FOND_SLOTS = [
  { id: 'roulade', action: 'roll', label: 'Roulade', glyph: 'swirl' },
  { id: 'saut', action: 'jump', label: 'Saut', glyph: 'wing' },
  { id: 'garde', action: 'guard', label: 'Garde', glyph: 'shield' },
  { id: 'sprint', action: 'sprint', label: 'Sprint', glyph: 'arrow' },
];
const FOND_HINT = {
  roulade: 'Appui court : esquive invulnérable un instant.',
  saut: 'Passe au-dessus des ondes de choc au sol (télégraphes à vagues).',
  garde: 'Maintenir : bloque les coups de face contre de l\'endurance.',
  sprint: 'Maintenir : court plus vite en consommant de l\'endurance.',
};

const countOf = (inv, id) => {
  let n = 0;
  for (const s of inv || []) if (s && s.id === id) n += s.q || 1;
  return n;
};

export function createActionBar(parent, { handlers, tooltip, isTyping, isActive, notify }) {
  let self = null;
  const slots = [];
  const bar = h('div', { class: 'bv-actionbar bv-frame' });
  const fondGroup = h('div', { class: 'bv-ab-fond', 'aria-label': 'Fondamentaux' });
  const abGroup = h('div', { class: 'bv-ab-group' });

  // ---------------------------------------------------------------- Fondamentaux (read-only, real keys)
  const fonds = FOND_SLOTS.map((f) => {
    const key = h('kbd', { class: 'bv-slot-key' });
    const el = h('div', { class: 'bv-slot bv-fond-slot', role: 'img', 'aria-label': f.label },
      iconBox({ url: `/icons/ab_${f.id}.png`, glyph: f.glyph, c1: '#6a5a3a', c2: '#141009', fit: 'cover' }),
      h('span', { class: 'bv-fond-lock' }, glyph('lock')), key);
    tooltip.bind(el, () => {
      if (!self) return null;
      const k = keybinds.labels(f.action).join(' / ') || 'aucune touche';
      const shared = f.id === 'roulade' || f.id === 'sprint' ? keybinds.codesOf('roll').some((c) => keybinds.rollSprintShared(c)) : false;
      const how = shared ? (f.id === 'roulade' ? `${k} (appui court)` : `${k} (maintenir)`) : k;
      if (!knows(self, f.id)) return simpleTooltip(f.label, `${FOND_HINT[f.id]} Pas encore appris : Fondamental de l'Arbre des Brumes (${keybinds.label('tree') || 'N'}).`, `Touche : ${how}`);
      return abilityTip(self, f.id, { key: how });
    });
    fondGroup.appendChild(el);
    return { ...f, el, key };
  });

  // ---------------------------------------------------------------- 8 slots
  for (let i = 0; i < LOADOUT_SLOTS; i++) {
    const icon = iconBox(null);
    const cd = h('div', { class: 'bv-cd' });
    const cdText = h('div', { class: 'bv-cd-text' });
    const count = h('span', { class: 'bv-slot-count' });
    const key = h('kbd', { class: 'bv-slot-key' });
    const btn = h('button', {
      class: 'bv-slot bv-ab-slot', type: 'button', 'aria-label': `Emplacement ${i + 1}`,
      dataset: { drop: 'bar', slot: String(i) },
      onclick: () => {
        flash(i);
        handlers.ability?.(i);
      },
    }, icon, cd, cdText, count, key);
    const slot = { i, btn, icon, cd, cdText, count, key, entry: null, end: 0, dur: 0 };
    tooltip.bind(btn, () => slotTooltip(slot));
    makeDraggable(btn, {
      payload: () => (slot.entry && hasTree(self) ? { from: i, entry: slot.entry } : null),
      icon: () => iconBox(specFor(slot.entry)),
      onDrop: (target, p) => dropOn(target, p),
      onStart: () => tooltip.hide(),
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    slots.push(slot);
    abGroup.appendChild(btn);
  }

  bar.append(fondGroup, h('div', { class: 'bv-ab-sep' }), abGroup);
  parent.appendChild(bar);

  function specFor(entry) {
    if (!entry) return null;
    if (isItemEntry(entry)) return itemIconSpec(entry.slice(5));
    return abilityIconSpec(entry, self?.cls);
  }

  function slotTooltip(slot) {
    const e = slot.entry;
    const key = keybinds.labels(`slot${slot.i + 1}`).join(' / ');
    if (!e) {
      return simpleTooltip(`Emplacement ${slot.i + 1}`, hasTree(self)
        ? `Vide. Glissez une compétence ou une potion depuis le livre de compétences (${keybinds.label('book') || 'K'}).`
        : 'Vide.', key ? `Raccourci : ${key}` : null);
    }
    if (isItemEntry(e)) {
      const id = e.slice(5);
      const n = countOf(self?.inv, id);
      return itemTooltip(id, { self, qty: n, hint: `${n ? `${n} dans le sac` : 'Aucun dans le sac'} · Raccourci : ${key || '—'}` });
    }
    const hint = slot.i === 0 && knows(self, 'attaque_chargee') ? 'Maintenir la touche : Attaque chargée' : null;
    return abilityTip(self, e, { key, hint });
  }

  // ---------------------------------------------------------------- drag & drop → loadout message
  /** Drop of a book entry ({ entry }) or a slot ({ from, entry }) on a bar slot (or outside: clear). */
  function dropOn(target, p) {
    if (!self || !hasTree(self)) return;
    const cur = [...loadoutOf(self)];
    const next = [...cur];
    const to = target && target.dataset.drop === 'bar' ? Number(target.dataset.slot) : -1;
    if (to < 0) {
      if (p.from === undefined) return;
      if (p.from === 0) { notify?.('L\'emplacement 1 garde toujours une attaque de base.', 'error'); return; }
      next[p.from] = null;
    } else if (p.from !== undefined) {
      if (p.from === to) return;
      [next[p.from], next[to]] = [next[to], next[p.from]];
    } else {
      const k = next.indexOf(p.entry);
      if (k === to) return;
      if (k >= 0) next[k] = next[to];
      next[to] = p.entry;
    }
    const base0 = next[0] && !isItemEntry(next[0]) && ABILITY_DEFS.get(next[0])?.base;
    if (!base0) {
      notify?.('L\'emplacement 1 est réservé à une attaque de base (l\'attaque automatique).', 'error');
      return;
    }
    const res = checkLoadout(next, treeOf(self).unlocked);
    if (!res.ok) { notify?.('Cette barre d\'action n\'est pas valide.', 'error'); return; }
    handlers.setLoadout?.(res.slots);
  }

  const allBtns = () => slots.map((s) => s.btn);
  function flash(i) {
    const b = allBtns()[i];
    if (!b) return;
    b.classList.remove('pressed');
    void b.offsetWidth;
    b.classList.add('pressed');
  }

  // keyboard feedback only (core performs the actions)
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || !isActive() || isTyping()) return;
    for (const a of keybinds.actionsOf(e.code)) {
      const m = /^slot([1-8])$/.exec(a);
      if (m) flash(Number(m[1]) - 1);
    }
  });

  function refreshKeys() {
    for (const s of slots) setText(s.key, keybinds.label(`slot${s.i + 1}`));
    for (const f of fonds) setText(f.key, keybinds.label(f.action));
  }
  keybinds.onChange(refreshKeys);
  refreshKeys();

  // ---------------------------------------------------------------- cooldowns
  let raf = 0;
  function tick() {
    raf = 0;
    const now = performance.now();
    let active = false;
    for (const s of slots) {
      if (!s.end) continue;
      const left = s.end - now;
      if (left <= 0) {
        s.end = 0;
        s.btn.classList.remove('on-cd');
        s.cd.style.removeProperty('--p');
        s.cdText.textContent = '';
        s.btn.classList.remove('ready');
        void s.btn.offsetWidth;
        s.btn.classList.add('ready');
        continue;
      }
      active = true;
      s.cd.style.setProperty('--p', (left / s.dur).toFixed(4));
      setText(s.cdText, left >= 1000 ? String(Math.ceil(left / 1000)) : fmt1(Math.max(0.1, left / 1000)));
    }
    if (active) raf = requestAnimationFrame(tick);
  }

  return {
    setCooldown(slot, ms) {
      const s = slots[slot];
      if (!s) return;
      ms = Number(ms) || 0;
      if (ms <= 0) {
        s.end = performance.now();
      } else {
        s.end = performance.now() + ms;
        s.dur = ms;
        s.btn.classList.add('on-cd');
        s.btn.classList.remove('ready');
      }
      if (!raf) raf = requestAnimationFrame(tick);
    },
    /** Visual feedback of a bar key held (charge) / released. */
    press(slot, down) {
      const s = slots[slot];
      if (!s) return;
      toggleClass(s.btn, 'held', !!down);
    },
    refreshKeys,
    /** Screen rectangle of the bar (level-up card placement). */
    get el() { return bar; },
    update(sf) {
      self = sf;
      const lo = loadoutOf(sf);
      const tree = hasTree(sf);
      toggleClass(bar, 'has-tree', tree);
      for (let i = 0; i < LOADOUT_SLOTS; i++) {
        const sl = slots[i];
        const e = lo[i] || null;
        if (e !== sl.entry) {
          sl.entry = e;
          setIcon(sl.icon, specFor(e));
          const name = !e ? null : isItemEntry(e) ? ITEMS[e.slice(5)]?.name : ABILITY_DEFS.get(e)?.name;
          sl.btn.setAttribute('aria-label', name ? `${name} (emplacement ${i + 1})` : `Emplacement ${i + 1}`);
          toggleClass(sl.btn, 'is-empty', !e);
          toggleClass(sl.btn, 'is-item', !!e && isItemEntry(e));
        }
        if (!e) { setText(sl.count, ''); toggleClass(sl.btn, 'no-mana', false); toggleClass(sl.btn, 'unusable', false); continue; }
        if (isItemEntry(e)) {
          const n = countOf(sf.inv, e.slice(5));
          setText(sl.count, n);
          toggleClass(sl.btn, 'empty', n === 0);
          toggleClass(sl.btn, 'disabled', !!sf.dead);
          continue;
        }
        setText(sl.count, '');
        const ab = specOf(sf, e);
        toggleClass(sl.btn, 'no-mana', !!ab && ab.mp > (sf.mp || 0));
        toggleClass(sl.btn, 'unusable', !!ab && ab.usable === false);
        toggleClass(sl.btn, 'inapt', !!ab && ab.inapt > 0);
        toggleClass(sl.btn, 'is-auto', !!ab?.base);
        toggleClass(sl.btn, 'disabled', !!sf.dead);
        toggleClass(sl.btn, 'empty', false);
      }
      for (const f of fonds) {
        const k = knows(sf, f.id);
        toggleClass(f.el, 'locked', !k);
      }
      fondGroup.hidden = !tree;
    },
  };
}
