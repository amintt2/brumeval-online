// Action bar: 4 ability slots (keys 1-4) with cooldown sweeps + potion quick slots (5 = soin, 6 = mana).
import { ABILITIES, ITEMS } from '@shared/data.js';
import { h, setText, toggleClass, fmt1 } from './dom.js';
import { iconBox, setIcon, abilityIconSpec, itemIconSpec } from './icons.js';
import { abilityTooltip, simpleTooltip } from './tooltip.js';

const HP_POTIONS = ['potion_hp_l', 'potion_hp_s']; // best first
const MP_POTIONS = ['potion_mp_s'];

export function createActionBar(parent, { handlers, tooltip, isTyping, isActive, notify }) {
  let self = null;
  const slots = [];
  const bar = h('div', { class: 'bv-actionbar bv-frame' });
  const abGroup = h('div', { class: 'bv-ab-group' });
  const potGroup = h('div', { class: 'bv-ab-group pots' });

  for (let i = 0; i < 4; i++) {
    const icon = iconBox(null);
    const cd = h('div', { class: 'bv-cd' });
    const cdText = h('div', { class: 'bv-cd-text' });
    const btn = h('button', {
      class: 'bv-slot bv-ab-slot', type: 'button', 'aria-label': `Capacité ${i + 1}`,
      onclick: () => {
        flash(i);
        handlers.ability?.(i);
      },
    }, icon, cd, cdText, h('kbd', { class: 'bv-slot-key', text: String(i + 1) }));
    const slot = { btn, icon, cd, cdText, abilityId: null, end: 0, dur: 0 };
    tooltip.bind(btn, () => (slot.abilityId ? abilityTooltip(slot.abilityId, { self, key: String(i + 1) }) : null));
    slots.push(slot);
    abGroup.appendChild(btn);
  }

  function potionSlot(key, ids, label) {
    const icon = iconBox(itemIconSpec(ids[ids.length - 1]));
    const count = h('span', { class: 'bv-slot-count', text: '0' });
    const btn = h('button', {
      class: 'bv-slot bv-pot-slot', type: 'button', 'aria-label': `${label} (${key})`,
      onclick: () => {
        flash(key === '5' ? 4 : 5);
        usePotion(ids, label);
      },
    }, icon, count, h('kbd', { class: 'bv-slot-key', text: key }));
    const p = { btn, icon, count, ids, label, shown: null };
    tooltip.bind(btn, () => {
      const inv = self?.inv || [];
      const parts = ids.map((id) => [id, countOf(inv, id)]).filter(([, n]) => n > 0).map(([id, n]) => `${ITEMS[id].name} ×${n}`);
      return simpleTooltip(label, parts.length ? parts.join(' · ') : 'Aucune potion dans le sac.', `Raccourci : ${key}`);
    });
    potGroup.appendChild(btn);
    return p;
  }
  const hpPot = potionSlot('5', HP_POTIONS, 'Potion de soin');
  const mpPot = potionSlot('6', MP_POTIONS, 'Potion de mana');

  bar.append(abGroup, h('div', { class: 'bv-ab-sep' }), potGroup);
  parent.appendChild(bar);

  function countOf(inv, id) {
    let n = 0;
    for (const s of inv) if (s && s.id === id) n += s.q || 1;
    return n;
  }
  function usePotion(ids) {
    const inv = self?.inv || [];
    for (const id of ids) {
      const slot = inv.findIndex((s) => s && s.id === id);
      if (slot >= 0) {
        handlers.useItem?.(slot);
        return;
      }
    }
    notify?.(ids === HP_POTIONS ? 'Vous n\'avez plus de potion de soin.' : 'Vous n\'avez plus de potion de mana.', 'error');
  }

  const allBtns = () => [...slots.map((s) => s.btn), hpPot.btn, mpPot.btn];
  function flash(i) {
    const b = allBtns()[i];
    if (!b) return;
    b.classList.remove('pressed');
    void b.offsetWidth;
    b.classList.add('pressed');
  }

  // keyboard feedback only (core performs the actions for keys 1-6)
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || !isActive() || isTyping()) return;
    const m = e.code ? /^(?:Digit|Numpad)([1-6])$/.exec(e.code) : /^([1-6])$/.exec(e.key || '');
    if (m) flash(Number(m[1]) - 1);
  });

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
    update(s) {
      self = s;
      const abilities = s.abilities || [];
      for (let i = 0; i < 4; i++) {
        const sl = slots[i];
        const id = abilities[i] || null;
        if (id !== sl.abilityId) {
          sl.abilityId = id;
          setIcon(sl.icon, id ? abilityIconSpec(id, s.cls) : null);
          sl.btn.setAttribute('aria-label', id ? `${ABILITIES[id]?.name} (${i + 1})` : `Capacité ${i + 1}`);
        }
        const ab = id ? ABILITIES[id] : null;
        toggleClass(sl.btn, 'no-mana', !!ab && ab.mp > (s.mp || 0));
        toggleClass(sl.btn, 'is-auto', !!ab?.auto);
        toggleClass(sl.btn, 'disabled', !!s.dead);
      }
      for (const p of [hpPot, mpPot]) {
        const inv = s.inv || [];
        let n = 0;
        let best = null;
        for (const id of p.ids) {
          const c = countOf(inv, id);
          n += c;
          if (c > 0 && !best) best = id;
        }
        const show = best || p.ids[p.ids.length - 1];
        if (show !== p.shown) {
          p.shown = show;
          setIcon(p.icon, itemIconSpec(show));
        }
        setText(p.count, n);
        toggleClass(p.btn, 'empty', n === 0);
        toggleClass(p.btn, 'disabled', !!s.dead);
      }
    },
  };
}
