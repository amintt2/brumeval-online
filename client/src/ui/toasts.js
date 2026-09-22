// Toast notifications (top centre, stacked, auto-fade), zone banner and level-up banner.
import { REGIONS } from '@shared/world.js';
import { h, frTypo } from './dom.js';
import { glyph } from './icons.js';

const KIND_GLYPH = { info: 'speech', error: 'close', xp: 'burst', loot: 'bag', quest: 'scroll', level: 'burst', gold: 'coin' };
const DURATION = { error: 3200, xp: 2600, gold: 2800, loot: 3600, quest: 4200, level: 4500, info: 3800 };
const MAX_TOASTS = 4;

export function createToasts(parent) {
  const stack = h('div', { class: 'bv-toasts', 'aria-live': 'polite' });
  parent.appendChild(stack);

  function remove(t) {
    if (t.dead) return;
    t.dead = true;
    clearTimeout(t.timer);
    t.el.classList.add('out');
    setTimeout(() => t.el.remove(), 380);
  }
  const live = [];
  function arm(t) {
    clearTimeout(t.timer);
    t.timer = setTimeout(() => {
      remove(t);
      const i = live.indexOf(t);
      if (i >= 0) live.splice(i, 1);
    }, DURATION[t.kind] || 3500);
  }

  function toast(text, kind = 'info') {
    text = frTypo(text);
    if (!text) return;
    if (!KIND_GLYPH[kind]) kind = 'info';
    // merge identical consecutive messages (e.g. "Trop loin" spam) into a ×N counter
    const top = live[live.length - 1];
    if (top && top.text === text && top.kind === kind) {
      top.n++;
      top.count.textContent = `×${top.n}`;
      top.count.hidden = false;
      top.el.classList.remove('bump');
      void top.el.offsetWidth;
      top.el.classList.add('bump');
      arm(top);
      return;
    }
    const count = h('span', { class: 'bv-toast-n', hidden: true });
    const el = h('div', { class: `bv-toast k-${kind}` },
      h('span', { class: 'bv-toast-i' }, glyph(KIND_GLYPH[kind])),
      h('span', { class: 'bv-toast-t', text }),
      count);
    const t = { el, text, kind, n: 1, count, timer: 0, dead: false };
    stack.prepend(el);
    live.push(t);
    while (live.length > MAX_TOASTS) remove(live.shift());
    arm(t);
  }

  // ---------------------------------------------------------------- zone banner
  const zoneName = h('div', { class: 'bv-zone-name' });
  const zoneSub = h('div', { class: 'bv-zone-sub' });
  const zone = h('div', { class: 'bv-zone', 'aria-live': 'polite' },
    h('div', { class: 'bv-zone-orn' }, h('i'), glyph('compass'), h('i')),
    zoneName,
    zoneSub);
  parent.appendChild(zone);
  let zoneTimer = 0;
  function showZone(name) {
    if (!name) return;
    const region = REGIONS.find((r) => r.name === name);
    zoneName.textContent = String(name);
    zoneSub.textContent = region?.safe ? 'Zone sûre' : region ? 'Territoire hostile' : 'Contrée sauvage';
    zone.classList.toggle('safe', !!region?.safe);
    zone.classList.remove('show');
    void zone.offsetWidth;
    zone.classList.add('show');
    parent.classList.add('zone-on'); // pushes the toast stack below the banner
    clearTimeout(zoneTimer);
    zoneTimer = setTimeout(() => {
      zone.classList.remove('show');
      parent.classList.remove('zone-on');
    }, 3600);
  }

  // ---------------------------------------------------------------- level banner
  const lvTitle = h('div', { class: 'bv-lvl-title' });
  const lvSub = h('div', { class: 'bv-lvl-sub' });
  const lvl = h('div', { class: 'bv-lvl' }, h('div', { class: 'bv-lvl-rays' }), lvTitle, lvSub);
  parent.appendChild(lvl);
  let lvTimer = 0;
  let lvShownAt = -Infinity;
  function showLevel(level, sub) {
    const recent = performance.now() - lvShownAt < 2500;
    if (level != null) lvTitle.textContent = `Niveau ${level} !`;
    else if (!recent) lvTitle.textContent = 'Niveau supérieur !';
    lvSub.textContent = sub || (recent ? lvSub.textContent : 'Vos forces grandissent.');
    if (!recent) {
      lvl.classList.remove('show');
      void lvl.offsetWidth;
      lvl.classList.add('show');
      lvShownAt = performance.now();
    }
    clearTimeout(lvTimer);
    lvTimer = setTimeout(() => lvl.classList.remove('show'), 3800);
  }

  return { toast, showZone, showLevel };
}
