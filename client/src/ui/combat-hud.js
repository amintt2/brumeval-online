// [combat-souls] Soulslike HUD pieces: stamina bar (under the player's mana), boss health bar (bottom centre,
// with phase notches), red low-hp vignette with hit pulses and damage direction indicators.
import { h, setText, clamp01 } from './dom.js';
import { createBar } from './hud.js';
import './combat-hud.css';

/** Stamina bar appended to the player unit frame. */
export function createStaminaBar(frameMain) {
  const bar = createBar('st', 'bv-st');
  bar.el.title = 'Endurance — roulade (Espace), sprint (Maj)';
  frameMain?.appendChild(bar.el);
  let flashT = 0;
  return {
    el: bar.el,
    set(st, mst) {
      if (!Number.isFinite(st) || !(mst > 0)) return;
      bar.set(st, mst, '');
      bar.el.classList.toggle('low', st < 30);
    },
    /** Blink when an action is refused for lack of stamina. */
    flashEmpty() {
      bar.el.classList.remove('empty');
      void bar.el.offsetWidth;
      bar.el.classList.add('empty');
      clearTimeout(flashT);
      flashT = setTimeout(() => bar.el.classList.remove('empty'), 600);
    },
  };
}

/** Large boss health bar shown while fighting a boss. */
export function createBossBar(parent) {
  const name = h('div', { class: 'bv-boss-name' });
  const phase = h('div', { class: 'bv-boss-phase' });
  const fill = h('div', { class: 'bv-boss-fill' });
  const lag = h('div', { class: 'bv-boss-lag' });
  const marks = h('div', { class: 'bv-boss-marks' });
  const bar = h('div', { class: 'bv-boss-bar' }, lag, fill, marks);
  const el = h('div', { class: 'bv-boss bv-hidden', role: 'status' }, h('div', { class: 'bv-boss-top' }, name, phase), bar);
  parent.appendChild(el);
  let cur = null, lastR = -1, marksKey = '';
  return {
    el,
    /** d = { id, name, hp, mhp, phase, marks: [0.66, 0.3] } | null */
    set(d) {
      if (!d) {
        if (cur) { el.classList.add('bv-hidden'); cur = null; lastR = -1; }
        return;
      }
      if (!cur || cur.id !== d.id) {
        el.classList.remove('bv-hidden');
        el.classList.remove('enter');
        void el.offsetWidth;
        el.classList.add('enter');
        lastR = -1;
      }
      cur = d;
      setText(name, d.name || '');
      setText(phase, d.phase > 1 ? (d.phase >= 3 ? 'Enragé' : `Phase ${d.phase}`) : '');
      el.classList.toggle('enraged', d.phase >= 3);
      const r = d.mhp > 0 ? clamp01(d.hp / d.mhp) : 0;
      if (r !== lastR) {
        const w = `${(r * 100).toFixed(2)}%`;
        fill.style.width = w;
        if (r > lastR) { lag.style.transition = 'none'; lag.style.width = w; void lag.offsetWidth; lag.style.transition = ''; } else lag.style.width = w;
        lastR = r;
      }
      const key = (d.marks || []).join(',');
      if (key !== marksKey) {
        marksKey = key;
        marks.textContent = '';
        for (const m of d.marks || []) marks.appendChild(h('i', { style: `left:${(m * 100).toFixed(1)}%` }));
      }
    },
  };
}

/** Full-screen overlay: red vignette (low hp), hit pulses, damage direction arcs. */
export function createCombatOverlay(parent) {
  const vignette = h('div', { class: 'bv-vignette' });
  const pulse = h('div', { class: 'bv-hitpulse' });
  const dirs = h('div', { class: 'bv-dmgdirs' });
  const el = h('div', { class: 'bv-combat-overlay' }, vignette, pulse, dirs);
  parent.appendChild(el);
  const pool = [];
  for (let i = 0; i < 6; i++) {
    const a = h('i', { class: 'bv-dmgdir' });
    dirs.appendChild(a);
    pool.push({ el: a, until: 0 });
  }
  return {
    el,
    setHp(hp, mhp, dead) {
      const r = mhp > 0 ? hp / mhp : 1;
      const v = dead ? 0 : r < 0.35 ? (0.35 - r) / 0.35 : 0;
      vignette.style.opacity = (v * 0.85).toFixed(3);
      vignette.classList.toggle('critical', !dead && r < 0.15);
    },
    /** A hit on the local player. `angle` = direction of the attacker relative to the camera (0 = in front), heavy = big hit. */
    hit(angle, heavy = false) {
      pulse.classList.remove('on', 'heavy');
      void pulse.offsetWidth;
      pulse.classList.add('on');
      if (heavy) pulse.classList.add('heavy');
      if (!Number.isFinite(angle)) return;
      const now = performance.now();
      let slot = pool.find((p) => p.until < now) || pool.reduce((a, b) => (a.until < b.until ? a : b));
      slot.until = now + 900;
      const s = slot.el;
      s.style.setProperty('--a', `${angle.toFixed(3)}rad`);
      s.classList.remove('on', 'heavy');
      void s.offsetWidth;
      s.classList.add('on');
      if (heavy) s.classList.add('heavy');
    },
  };
}
