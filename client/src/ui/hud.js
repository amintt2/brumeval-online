// HUD pieces: player & target unit frames, XP bar, gold counter and menu buttons.
import { CLASSES, NPCS, xpToNext, MAX_LEVEL } from '@shared/data.js';
import { h, setText, toggleClass, fmt, clamp01 } from './dom.js';
import { iconBox, setIcon, classIconSpec, glyph, statusList } from './icons.js';
import { STATUS_DEFS, renaissanceTitle } from '@shared/skills.js'; // [skilltree]
import { simpleTooltip } from './tooltip.js';

/** Resource bar with a lagging "damage" ghost and inner shine. */
export function createBar(kind, extraCls = '') {
  const fill = h('div', { class: 'bv-bar-fill' });
  const lag = h('div', { class: 'bv-bar-lag' });
  const text = h('div', { class: 'bv-bar-text' });
  const el = h('div', { class: `bv-bar ${kind} ${extraCls}`.trim() }, lag, fill, text);
  let last = -1;
  return {
    el,
    set(v, max, label) {
      const r = max > 0 ? clamp01(v / max) : 0;
      if (r !== last) {
        const w = `${(r * 100).toFixed(2)}%`;
        fill.style.width = w;
        if (r > last) {
          lag.style.transition = 'none';
          lag.style.width = w;
          void lag.offsetWidth;
          lag.style.transition = '';
        } else lag.style.width = w;
        last = r;
      }
      setText(text, label);
    },
  };
}

/** Difficulty colour of a monster level relative to the player's level. */
export function levelColor(targetLevel, selfLevel) {
  const d = (targetLevel || 1) - (selfLevel || 1);
  if (d >= 5) return '#ff4a3d';
  if (d >= 3) return '#ff8f2a';
  if (d >= -2) return '#ffd84a';
  if (d >= -6) return '#55d25a';
  return '#a3a3a3';
}

// ------------------------------------------------------------------ player frame
export function createPlayerFrame(parent, tooltip) {
  const portrait = iconBox(null, 'bv-uf-img');
  const lvl = h('div', { class: 'bv-uf-level' });
  const name = h('div', { class: 'bv-uf-name' });
  const cls = h('div', { class: 'bv-uf-sub' });
  const hp = createBar('hp');
  const mp = createBar('mp');
  const dead = h('div', { class: 'bv-uf-dead', text: 'Mort' });
  const el = h('div', { class: 'bv-uf bv-uf-player bv-frame' },
    h('div', { class: 'bv-uf-portrait' }, portrait, dead, lvl),
    h('div', { class: 'bv-uf-main' },
      h('div', { class: 'bv-uf-top' }, name, cls),
      hp.el,
      mp.el));
  parent.appendChild(el);
  let curCls = null;
  let self = null;
  tooltip.bind(el.querySelector('.bv-uf-portrait'), () =>
    self ? simpleTooltip(self.name, `${CLASSES[self.cls]?.name || ''} de niveau ${self.level}`, 'C : fiche du personnage') : null);

  return {
    update(s) {
      self = s;
      if (s.cls !== curCls) {
        curCls = s.cls;
        setIcon(portrait, classIconSpec(s.cls, 'portrait'));
        el.style.setProperty('--cc', CLASSES[s.cls]?.color || '#888');
      }
      setText(name, s.name);
      setText(cls, CLASSES[s.cls]?.name || '');
      setText(lvl, s.level);
      hp.set(s.hp, s.mhp, `${fmt(s.hp)} / ${fmt(s.mhp)}`);
      mp.set(s.mp, s.mmp, `${fmt(s.mp)} / ${fmt(s.mmp)}`);
      toggleClass(el, 'is-dead', !!s.dead);
      toggleClass(el, 'low-hp', !s.dead && s.mhp > 0 && s.hp / s.mhp < 0.25);
    },
  };
}

// ------------------------------------------------------------------ target frame
const NPC_ROLE = { quest: 'Donneur de quêtes', shop: 'Marchande' };
function npcRoleByName(name) {
  for (const k in NPCS) if (NPCS[k].name === name) return NPC_ROLE[NPCS[k].role] || 'Habitant';
  return 'Habitant';
}

export function createTargetFrame(parent) {
  const portrait = iconBox(null, 'bv-uf-img');
  const lvl = h('div', { class: 'bv-uf-level' });
  const boss = h('div', { class: 'bv-uf-boss' }, glyph('skull'), h('span', { text: 'Boss' }));
  const name = h('div', { class: 'bv-uf-name' });
  const sub = h('div', { class: 'bv-uf-sub' });
  const hp = createBar('hp');
  const dead = h('div', { class: 'bv-uf-dead', text: 'Mort' });
  const statuses = h('div', { class: 'bv-uf-st', 'aria-label': 'Effets' }); // [skilltree]
  let lastSt = -1;
  const el = h('div', { class: 'bv-uf bv-uf-target bv-frame is-empty' },
    h('div', { class: 'bv-uf-portrait' }, portrait, dead, lvl, boss),
    h('div', { class: 'bv-uf-main' },
      h('div', { class: 'bv-uf-top' }, name, sub),
      hp.el,
      statuses));
  parent.appendChild(el);
  let cur = null;
  let selfLevel = 1;

  function render() {
    const t = cur;
    if (!t) return;
    const kind = t.kind || 'monster';
    el.dataset.kind = kind;
    let color = '#ffffff';
    let subText = '';
    let spec;
    if (kind === 'npc') {
      color = '#ffd36b';
      subText = npcRoleByName(t.name);
      spec = { url: null, letter: (t.name || '?').replace(/^(Ancien|Marchande|Marchand)\s+/, '').charAt(0), c1: '#b8862b', c2: '#2a1c08' };
    } else if (kind === 'player') {
      color = '#8cc8ff';
      subText = t.rb > 0 ? renaissanceTitle(t.rb) : 'Joueur';
      spec = { url: null, glyph: 'person', c1: '#2f6fb0', c2: '#0b1830' };
    } else {
      color = t.hostile === false ? '#ffd84a' : levelColor(t.level, selfLevel);
      subText = t.boss ? 'Boss' : t.hostile === false ? 'Neutre' : 'Monstre';
      spec = t.boss
        ? { url: null, glyph: 'skull', c1: '#7a2fb0', c2: '#16061f' }
        : { url: null, letter: (t.name || '?').charAt(0), c1: '#8a2a20', c2: '#1d0806' };
    }
    setIcon(portrait, spec);
    name.style.color = color;
    lvl.style.color = kind === 'monster' ? color : '';
    setText(name, t.name || '???');
    setText(sub, subText);
    setText(lvl, t.level ?? '?');
    toggleClass(el, 'is-boss', !!t.boss);
    const mhp = Number(t.mhp) || 0;
    const hpv = Math.max(0, Number(t.hp) || 0);
    const showBar = kind !== 'npc' && mhp > 0;
    hp.el.hidden = !showBar;
    if (showBar) hp.set(hpv, mhp, `${fmt(hpv)} / ${fmt(mhp)}  ·  ${Math.round((hpv / mhp) * 100)} %`);
    toggleClass(el, 'is-dead', kind !== 'npc' && mhp > 0 && hpv <= 0);
    // [skilltree] status effects of the target (brûlure, froid, gel, poison, saignement, marque…)
    const st = hpv > 0 ? t.stt || 0 : 0;
    if (st !== lastSt) {
      lastSt = st;
      statuses.replaceChildren(...statusList(st).map((s) => h('span', {
        class: `bv-uf-chip st-${s.id}`, style: { '--c': s.color },
        title: `${s.name} — ${STATUS_DEFS.get(s.id)?.desc || ''}`.replace(/ — $/, ''),
      }, glyph(s.glyph), h('span', { text: s.name }))));
      statuses.hidden = st === 0;
    }
  }

  return {
    set(t) {
      if (!t) {
        cur = null;
        el.classList.add('is-empty');
        return;
      }
      const changed = !cur || cur.id !== t.id;
      cur = t;
      render();
      if (changed) {
        el.classList.remove('is-empty', 'pop');
        void el.offsetWidth;
        el.classList.add('pop');
      }
    },
    setSelfLevel(l) {
      if (l === selfLevel) return;
      selfLevel = l;
      if (cur) render();
    },
  };
}

// ------------------------------------------------------------------ XP bar
export function createXpBar(parent, tooltip) {
  const fill = h('div', { class: 'bv-xp-fill' });
  const text = h('div', { class: 'bv-xp-text' });
  const ticks = h('div', { class: 'bv-xp-ticks' });
  for (let i = 1; i < 10; i++) ticks.appendChild(h('i', { style: { left: `${i * 10}%` } }));
  const el = h('div', { class: 'bv-xp' }, fill, ticks, text);
  parent.appendChild(el);
  let last = null;
  let s = null;
  tooltip.bind(el, () => {
    if (!s) return null;
    const next = s.xpNext ?? xpToNext(s.level);
    if (!next) return simpleTooltip('Expérience', 'Vous avez atteint le niveau maximum.');
    return simpleTooltip('Expérience', `${fmt(s.xp)} / ${fmt(next)} XP — encore ${fmt(next - s.xp)} XP avant le niveau ${s.level + 1}.`);
  });
  return {
    update(self) {
      s = self;
      const next = self.xpNext ?? xpToNext(self.level);
      const key = `${self.level}|${self.xp}|${next}`;
      if (key === last) return;
      const gained = last && self.xp > Number(last.split('|')[1]);
      last = key;
      if (!next || self.level >= MAX_LEVEL) {
        fill.style.width = '100%';
        setText(text, `Niveau ${self.level} — niveau maximum`);
        return;
      }
      const r = clamp01(self.xp / next);
      fill.style.width = `${(r * 100).toFixed(2)}%`;
      setText(text, `Niveau ${self.level} — ${fmt(self.xp)} / ${fmt(next)} XP  (${Math.floor(r * 100)} %)`);
      if (gained) {
        el.classList.remove('gain');
        void el.offsetWidth;
        el.classList.add('gain');
      }
    },
  };
}

// ------------------------------------------------------------------ menu + gold
export const MENU = [
  { id: 'tree', label: 'Arbre', key: 'N', glyph: 'tree', action: 'tree' }, // [skilltree]
  { id: 'book', label: 'Livre', key: 'K', glyph: 'book', action: 'book' },  // [skilltree]
  { id: 'inventory', label: 'Sac', key: 'I', glyph: 'bag' },
  { id: 'character', label: 'Personnage', key: 'C', glyph: 'person' },
  { id: 'quests', label: 'Quêtes', key: 'L', glyph: 'scroll' },
  { id: 'help', label: 'Aide', key: 'H', glyph: 'help' },
  { id: 'settings', label: 'Options', key: 'O', glyph: 'gear' }, // [render-souls] + [accounts] audio, controls
];

export function createMenu(parent, onToggle, tooltip, keyLabelOf = null) {
  const badges = {}; // [skilltree] free skill points on the tree button
  const goldVal = h('span', { class: 'bv-gold-v', text: '0' });
  const goldIcon = iconBox({ url: '/icons/gold.png', glyph: 'coin', c1: '#d9a93a', c2: '#5a3b0a', fit: 'contain' }, 'bv-gold-i');
  const gold = h('div', { class: 'bv-gold' }, goldIcon, goldVal);
  tooltip.bind(gold, () => simpleTooltip('Or', 'Pièces d\'or (po). Dépensez-les chez Marchande Élise.'));
  const buttons = {};
  const bar = h('nav', { class: 'bv-menu', 'aria-label': 'Menu' });
  const keyOf = (m) => (keyLabelOf ? keyLabelOf(m.action || (m.id === 'settings' ? 'options' : m.id)) : m.key) || m.key;
  for (const m of MENU) {
    const b = h('button', {
      class: 'bv-mbtn', type: 'button', 'aria-label': `${m.label} (${m.key})`,
      onclick: () => onToggle(m.id),
    }, glyph(m.glyph), h('span', { class: 'bv-mbtn-l', text: m.label }), h('kbd', { text: m.key }), h('span', { class: 'bv-mbtn-badge', hidden: true }));
    tooltip.bind(b, () => simpleTooltip(m.id === 'tree' ? 'Arbre des Brumes' : m.id === 'book' ? 'Livre de compétences' : m.label,
      m.id === 'tree' && badges.tree ? `${badges.tree} point${badges.tree > 1 ? 's' : ''} de compétence à dépenser.` : null, `Raccourci : ${keyOf(m)}`));
    buttons[m.id] = b;
    bar.appendChild(b);
  }
  const el = h('div', { class: 'bv-menuwrap' }, gold, bar);
  parent.appendChild(el);
  let lastGold = null;
  return {
    setGold(g) {
      if (g === lastGold) return;
      const up = lastGold != null && g > lastGold;
      lastGold = g;
      setText(goldVal, fmt(g));
      if (up) {
        gold.classList.remove('bump');
        void gold.offsetWidth;
        gold.classList.add('bump');
      }
    },
    setActive(id, on) {
      buttons[id]?.classList.toggle('active', !!on);
    },
    /** [skilltree] Real bindings on the buttons (Options › Commandes). */
    refreshKeys() {
      for (const m of MENU) {
        const k = keyOf(m);
        const b = buttons[m.id];
        setText(b.querySelector('kbd'), k);
        b.setAttribute('aria-label', `${m.label} (${k})`);
      }
    },
    /** [skilltree] Number badge on a button (free points on « Arbre »). */
    setBadge(id, n) {
      badges[id] = n;
      const el = buttons[id]?.querySelector('.bv-mbtn-badge');
      if (!el) return;
      el.hidden = !(n > 0);
      setText(el, n > 9 ? '9+' : String(n || ''));
      buttons[id].classList.toggle('has-badge', n > 0);
    },
  };
}
