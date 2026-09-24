// Icons: vector glyphs (built with createElementNS from constant path data) and PNG icons with a
// graceful fallback (gradient + glyph/letter) while assets are missing or fail to load.
import { ITEMS, ABILITIES, CLASSES } from '@shared/data.js';
import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';

// 24×24 filled glyphs. A path starting with '!' uses the evenodd fill rule (holes).
const GLYPHS = {
  sword: [
    'M20.8 2.2 21.8 3.2 21.6 6.2 11.6 16.2 7.8 12.4 17.8 2.4Z',
    'M5.4 12.2 6.8 10.8 13.2 17.2 11.8 18.6Z',
    'M8.4 15.8 10.2 17.6 6.6 21.2 4.8 19.4Z',
    'M3.9 18.9 5.1 20.1 3.9 21.3 2.7 20.1Z',
  ],
  staff: [
    'M4.9 21.5 3.5 20.1 14.2 9.4 15.6 10.8Z',
    '!M17.2 2.6a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 1 1 0-8.4Zm0 2a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 1 0 0-4.4Z',
    'M17.2 5.6a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 1 1 0-2.4Z',
    'M20.6 12.2 21.2 13.6 22.6 14.2 21.2 14.8 20.6 16.2 20 14.8 18.6 14.2 20 13.6Z',
  ],
  bow: [
    'M4.2 2.6C12.6 3.4 20.4 11 21.4 19.6L19.6 19.9C18.6 12.3 11.7 5.6 4.2 4.6Z',
    'M4.6 3.9 20.1 19.3 19.4 20 3.9 4.6Z',
    'M2.5 14.2 11.6 9.6 12.4 11.2 3.3 15.8Z',
    'M12.8 8.3 15.2 8.8 13.4 11.8Z',
  ],
  shield: ['M12 2 20 5v6c0 5.4-3.4 9.4-8 11-4.6-1.6-8-5.6-8-11V5Z'],
  flask: [
    'M9 2h6v2h-1v4.1c3 1.1 5 3.9 5 7.1C19 19 15.9 22 12 22s-7-3-7-6.8c0-3.2 2-6 5-7.1V4H9Z',
  ],
  armor: ['M8 3l4 2 4-2 5 3-2 5.2-2-.9V21H7V10.3l-2 .9L3 6Z'],
  gem: ['!M7 3h10l5 6-10 12L2 9Zm1.2 2L5 8.6h4.3Zm7.6 0-1.1 3.6H19Zm-5.6 0-.9 3.6h6.6l-.9-3.6ZM5.3 10.6l5.6 6.8-1.9-6.8Zm5.8 0 .9 7.1.9-7.1Zm3.8 0-1.9 6.8 5.6-6.8Z'],
  drop: ['M12 2s-7 8-7 12.5C5 18.6 8.1 22 12 22s7-3.4 7-7.5C19 10 12 2 12 2Z'],
  bone: [
    'M7.6 4.2a2.6 2.6 0 0 0-3.1 3.6 2.6 2.6 0 0 0 1.8 4.1l5.9 5.9a2.6 2.6 0 0 0 4.1 1.8 2.6 2.6 0 0 0 3.6-3.1 2.6 2.6 0 0 0-3.4-3.4L10.9 7.5a2.6 2.6 0 0 0-3.3-3.3Z',
  ],
  pelt: ['M12 2c1.5 1.8 3.4 2.3 5.5 2.1-.6 2 .2 3.8 2.2 5-1.6 1.4-2 3.1-1.2 5.1-2 .3-3.3 1.6-3.8 3.6-1.3-1.3-2.6-1.3-3.9 0l-.8 2.2-.8-2.2c-1.3-1.3-2.6-1.3-3.9 0-.5-2-1.8-3.3-3.8-3.6.8-2 .4-3.7-1.2-5.1 2-1.2 2.8-3 2.2-5C8.6 4.3 10.5 3.8 12 2Z'],
  ring: ['!M12 6.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 1 1 0-15Zm0 3a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9Z', 'M9.2 1.8h5.6L16 4.4 12 7.4 8 4.4Z'],
  bag: [
    'M9 2.5h6l-1.3 3.3C18 7.3 21 11.3 21 15.4 21 19.6 17.4 22 12 22s-9-2.4-9-6.6c0-4.1 3-8.1 7.3-9.6Z',
    'M8.6 6.6h6.8v1.3H8.6Z',
  ],
  person: ['M12 2.5a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 1 1 0-9.2Z', 'M3.4 21.5c0-5 3.9-8.1 8.6-8.1s8.6 3.1 8.6 8.1Z'],
  scroll: [
    '!M6.5 3H18a3 3 0 0 1 3 3v1.5h-3.2V18a3 3 0 0 1-3 3H5.5a3 3 0 0 1-3-3v-1.5h3.3V6.2A3.2 3.2 0 0 1 6.5 3Zm2.3 5v1.6h6.6V8Zm0 3.3v1.6h6.6v-1.6Zm0 3.3v1.6h4.4v-1.6Z',
  ],
  help: [
    'M12 2.8c-3.4 0-5.7 2-5.7 5.1h3.1c0-1.4 1-2.3 2.6-2.3 1.5 0 2.5.9 2.5 2.1 0 1.3-.9 1.9-2.1 2.7-1.5.9-2 2-2 3.7v.9h3.1v-.6c0-1.1.5-1.7 1.7-2.5 1.5-1 2.4-2.2 2.4-4.3 0-2.9-2.3-4.8-5.6-4.8Z',
    'M12 16.8a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 1 1 0-4.2Z',
  ],
  skull: [
    '!M12 2c-5.1 0-8.5 3.6-8.5 8.2 0 2.8 1.3 4.8 3 6V19.5c0 .8.7 1.5 1.5 1.5h8c.8 0 1.5-.7 1.5-1.5v-3.3c1.7-1.2 3-3.2 3-6C20.5 5.6 17.1 2 12 2ZM6.4 11.2a2.1 2.1 0 1 0 4.2 0 2.1 2.1 0 1 0-4.2 0Zm7 0a2.1 2.1 0 1 0 4.2 0 2.1 2.1 0 1 0-4.2 0ZM12 13.6l1.3 2.4h-2.6ZM9 18v2h1.2v-2Zm2.4 0v2h1.2v-2Zm2.4 0v2H15v-2Z',
  ],
  coin: ['!M12 3a9 9 0 1 1 0 18 9 9 0 1 1 0-18Zm0 2a7 7 0 1 0 0 14 7 7 0 1 0 0-14Zm0 1.6a5.4 5.4 0 1 1 0 10.8 5.4 5.4 0 1 1 0-10.8Z'],
  close: ['M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4Z'],
  flame: ['M12 2c.6 3.2 3 4.6 4.6 7 1.5 2.2 2.4 4.2 2.4 6.3C19 19 15.9 22 12 22s-7-3-7-6.7c0-2.6 1.3-4.6 3-6.1.1 1.8.8 3 2 3.6-.6-3.6.3-7.4 2-10.8Z'],
  burst: ['M12 1.5l2.2 6.2 6.2-2.6-2.6 6.2 6.2 2.2-6.2 2.2 2.6 6.2-6.2-2.6-2.2 6.2-2.2-6.2-6.2 2.6 2.6-6.2L0 13.5l6.2-2.2-2.6-6.2 6.2 2.6Z'],
  target: ['!M12 2a10 10 0 1 1 0 20 10 10 0 1 1 0-20Zm0 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 1 0 0-15Zm0 2.5a5 5 0 1 1 0 10 5 5 0 1 1 0-10Zm0 2.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 1 0 0-4.8Z'],
  cross: ['M9.5 3h5v6.5H21v5h-6.5V21h-5v-6.5H3v-5h6.5Z'],
  arrow: ['M3 19.6 15.4 7.2l-2.6-.6L19.8 3l-3.6 7-.6-2.6L3.2 19.8Z', 'M3.4 16.2l1.6 1.6-1.9 1.3-.9-.9Zm3 2.9-1.6-1.6-1.3 1.9.9.9Z'],
  house: ['M12 3 2.5 11h2.5v9.5h5.2V15h3.6v5.5H19V11h2.5Z'],
  compass: ['M12 2 15 12 12 22 9 12Z'],
  speech: ['M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'],
  // [render-souls] settings cog
  gear: ['!M10.3 2h3.4l.5 2.6c.7.2 1.3.5 1.9.9l2.3-1.3 2.4 2.4-1.3 2.3c.4.6.7 1.2.9 1.9l2.6.5v3.4l-2.6.5c-.2.7-.5 1.3-.9 1.9l1.3 2.3-2.4 2.4-2.3-1.3c-.6.4-1.2.7-1.9.9l-.5 2.6h-3.4l-.5-2.6c-.7-.2-1.3-.5-1.9-.9l-2.3 1.3-2.4-2.4 1.3-2.3c-.4-.6-.7-1.2-.9-1.9L2 13.7v-3.4l2.6-.5c.2-.7.5-1.3.9-1.9L4.2 5.6l2.4-2.4 2.3 1.3c.6-.4 1.2-.7 1.9-.9Zm1.7 6.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 1 0 0-7.4Z'],
  // [accounts]
  map: ['!M3 5.5 8.5 3l7 2.5L21 3v15.5L15.5 21l-7-2.5L3 21Zm6.5-.2v11.4l5 1.8V7.1Z'],
  menu: ['M3 5h18v2.6H3Zm0 5.7h18v2.6H3Zm0 5.7h18V19H3Z'],
  key: ['!M7.5 7a5.5 5.5 0 0 1 10.3 2.6H22v3.2h-1.6v2.6h-3.2v-2.6h-1.1A5.5 5.5 0 1 1 7.5 7Zm2.5 2.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 1 0 0-5.2Z'],
  logout: ['M4 3h9v2.6H6.6v12.8H13V21H4Z', 'M15.4 7.2 20.2 12l-4.8 4.8-1.8-1.8 1.7-1.7H9v-2.6h6.3L13.6 9Z'],
  download: ['M10.7 3h2.6v9.1l3.1-3.1 1.8 1.8-6.2 6.2-6.2-6.2 1.8-1.8 3.1 3.1Z', 'M4 18.4h16V21H4Z'],
  pin: ['!M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7Zm0 4.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 1 0 0-5.6Z'],
  play: ['M7 4.5v15l12.5-7.5Z'],
  plus: ['M10.7 4h2.6v6.7H20v2.6h-6.7V20h-2.6v-6.7H4v-2.6h6.7Z'],
  trash: ['M9 3h6l1 1.6h4.4v2.6H3.6V4.6H8Z', 'M5.6 8.6h12.8L17.3 21H6.7Z'],
  back: ['M10.5 5 3.5 12l7 7 1.8-1.8-3.9-3.9H20.5v-2.6H8.4l3.9-3.9Z'],
  // [skilltree] tree, book, statuses, lock, search
  tree: ['M12 1.5 18.5 9h-3.2l4.2 5.2h-4.3l3.3 4.3H13.3V22.5h-2.6v-4H5.5l3.3-4.3H4.5L8.7 9H5.5Z'],
  book: ['M3 4.2C5.8 3.4 8.6 3.6 11 5v15.5c-2.4-1.3-5.2-1.5-8-.8Z', 'M13 5c2.4-1.4 5.2-1.6 8-.8v15.5c-2.8-.7-5.6-.5-8 .8Z'],
  snow: ['M11 1.8h2v4.1l2.3-1.6 1.1 1.6L13 8.3v2l1.8-1 .1-4 2 .1-.1 2.8 3.6-2 1 1.7-3.6 2 2.4 1.4-1 1.7-3.5-2-1.7 1 1.7 1 3.5-2 1 1.7-2.4 1.4 3.6 2-1 1.7-3.6-2 .1 2.8-2 .1-.1-4L13 13.7v2l3.4 2.4-1.1 1.6L13 18.1v4.1h-2v-4.1l-2.3 1.6-1.1-1.6 3.4-2.4v-2l-1.8 1-.1 4-2-.1.1-2.8-3.6 2-1-1.7 3.6-2-2.4-1.4 1-1.7 3.5 2 1.7-1-1.7-1-3.5 2-1-1.7 2.4-1.4-3.6-2 1-1.7 3.6 2-.1-2.8 2-.1.1 4 1.8 1v-2L7.6 5.9l1.1-1.6L11 5.9Z'],
  crystal: ['M12 1.5 17.5 9 12 22.5 6.5 9Z', 'M4 8.5l2 1-2.4 5L2.5 12Z', 'M20 8.5l-2 1 2.4 5 1.1-2.5Z'],
  root: ['M11 2h2v8l4-3 1.2 1.6L13 12.5V15l5 4-1.2 1.6L13 17.6V22h-2v-4.4l-3.8 3L6 19l5-4v-2.5L5.8 8.6 7 7l4 3Z'],
  star: ['M12 2l2.6 6.3L21 9l-5 4.4L17.5 20 12 16.6 6.5 20 8 13.4 3 9l6.4-.7Z'],
  eye: ['!M12 5C6.5 5 2.5 12 2.5 12s4 7 9.5 7 9.5-7 9.5-7-4-7-9.5-7Zm0 3.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 1 1 0-7Z'],
  lock: ['!M7 10V7a5 5 0 0 1 10 0v3h1.5v11h-13V10Zm2.5 0h5V7a2.5 2.5 0 0 0-5 0Z'],
  search: ['!M10 3a7 7 0 0 1 5.6 11.2l5.2 5.2-1.6 1.6-5.2-5.2A7 7 0 1 1 10 3Zm0 2.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 1 0 0-9.2Z'],
  wing: ['M2 18c3-8 9-13 20-15-2 3-3.6 5-6.2 6.5l3.2-.2c-2 2.4-4.4 3.8-7.5 4.4l2.6.6C11 17 7 18.2 2 18Z'],
  swirl: ['!M12 2.5a9.5 9.5 0 1 1-9.5 9.5h2.6A6.9 6.9 0 1 0 12 5.1a4.4 4.4 0 1 0 4.4 4.4h2.6A7 7 0 1 1 12 2.5Z'],
};

/** Create an SVG glyph element (decorative, aria-hidden). */
export function glyph(name, cls = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `bv-glyph ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const raw of GLYPHS[name] || GLYPHS.gem) {
    const p = document.createElementNS(NS, 'path');
    if (raw[0] === '!') {
      p.setAttribute('fill-rule', 'evenodd');
      p.setAttribute('d', raw.slice(1));
    } else p.setAttribute('d', raw);
    svg.appendChild(p);
  }
  return svg;
}

// ------------------------------------------------------------------ image cache
// url -> 'ok' | 'fail'. Avoids hammering the server with 404s on every re-render.
const imgStatus = new Map();

/**
 * Icon box: fallback (gradient + glyph or letter) underneath, <img> on top once it loads.
 * spec = { url, glyph?, letter?, c1, c2, fit?: 'contain'|'cover' }
 */
export function iconBox(spec, cls = '') {
  const box = h('span', { class: `bv-icon ${cls}`.trim() });
  setIcon(box, spec);
  return box;
}

/** Update an icon box in place (no-op when the spec did not change). */
export function setIcon(box, spec) {
  const key = spec ? `${spec.url}|${spec.glyph || ''}|${spec.letter || ''}|${spec.c1}|${spec.c2}` : '';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren();
  box.classList.remove('has-img');
  if (!spec) {
    box.classList.add('is-empty');
    return;
  }
  box.classList.remove('is-empty');
  const fb = h('span', { class: 'bv-icon-fb' });
  fb.style.setProperty('--c1', spec.c1 || '#5a4a36');
  fb.style.setProperty('--c2', spec.c2 || '#1b1611');
  if (spec.glyph) fb.appendChild(glyph(spec.glyph));
  else if (spec.letter) fb.appendChild(h('span', { class: 'bv-icon-letter', text: spec.letter }));
  box.appendChild(fb);
  if (!spec.url || imgStatus.get(spec.url) === 'fail') return;
  const img = new Image();
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  if (spec.fit === 'cover') img.className = 'cover';
  img.onload = () => {
    imgStatus.set(spec.url, 'ok');
    if (box.contains(img)) box.classList.add('has-img');
  };
  img.onerror = () => {
    imgStatus.set(spec.url, 'fail');
    img.remove();
    box.classList.remove('has-img');
  };
  img.src = spec.url;
  box.appendChild(img);
  // known-good (cached) image: hide the fallback right away to avoid a one-frame flash
  if (imgStatus.get(spec.url) === 'ok' || (img.complete && img.naturalWidth > 0)) box.classList.add('has-img');
}

// ------------------------------------------------------------------ specs per domain
const RARITY_BG = {
  common: ['#6b6254', '#1d1914'],
  uncommon: ['#2f7a45', '#0f2416'],
  rare: ['#2f5ea8', '#0f1a33'],
  epic: ['#7a3fb3', '#1f0f33'],
};
const JUNK_GLYPH = { slime_gel: 'drop', wolf_pelt: 'pelt', goblin_trinket: 'ring', ancient_bone: 'bone', golem_core: 'gem' };
const CLASS_GLYPH = { warrior: 'sword', mage: 'staff', ranger: 'bow' };

export function itemIconSpec(itemId) {
  const it = ITEMS[itemId];
  if (!it) return { url: null, glyph: 'gem', c1: '#555', c2: '#111' };
  let g = 'gem';
  let [c1, c2] = RARITY_BG[it.rarity] || RARITY_BG.common;
  if (it.type === 'consumable') {
    g = 'flask';
    if (it.mana) [c1, c2] = ['#2d5fc0', '#0c1a3a'];
    else [c1, c2] = it.rarity === 'uncommon' ? ['#c2352a', '#3a0b08'] : ['#a33a2e', '#2a0c09'];
  } else if (it.type === 'weapon') g = CLASS_GLYPH[it.cls?.[0]] || 'sword';
  else if (it.type === 'armor') g = 'armor';
  else g = JUNK_GLYPH[itemId] || 'gem';
  return { url: `/icons/${it.icon}.png`, glyph: g, c1, c2, fit: 'contain' };
}

const KIND_GLYPH = {
  melee: 'sword', projectile: 'arrow', aoe_self: 'burst', aoe_target: 'target', self_heal: 'cross',
  // [skilltree] v0.3 kinds
  dash: 'wing', buff: 'shield', channel: 'swirl', summon: 'star', trap: 'target', debuff: 'eye', jump: 'wing', guard: 'shield', charge: 'burst', toggle: 'wing',
};
/** [skilltree] Emblem colours by element (fallback icons of the 65 abilities until Codex draws them). */
const ELEMENT_BG = { feu: '#c2541f', givre: '#3f8fc4', arcane: '#7a3fc4', nature: '#3f8f45', poison: '#5f9a24', saignement: '#9a1f2a' };
const HOME_BG = { warrior: '#8a2a20', mage: '#2a4f9a', ranger: '#2a7a3a' };
export function abilityIconSpec(abilityId, cls) {
  const ab = ABILITIES[abilityId];
  const tags = ab?.tags || [];
  const home = Array.isArray(ab?.home) ? ab.home[0] : ab?.home;
  let color = CLASSES[cls]?.color || '#7a6a50';
  if (ab && !ab.v02) {
    const el = tags.find((t) => ELEMENT_BG[t]);
    color = el ? ELEMENT_BG[el] : home ? HOME_BG[home] : '#6b6254';
  }
  let g = KIND_GLYPH[ab?.kind] || 'burst';
  if (ab?.kind === 'projectile' && (cls === 'mage' || tags.includes('feu'))) g = 'flame';
  if (tags.includes('givre') && g !== 'wing') g = 'snow';
  if (tags.includes('poison')) g = 'drop';
  if (abilityId === 'war_cry') g = 'shield';
  return { url: `/icons/ab_${abilityId}.png`, glyph: g, c1: color, c2: '#120d0a', fit: 'cover' };
}

/** [skilltree] Status effects shown on nameplates / the target frame (EntState.stt bits, shared/protocol.js). */
export const STATUS_FLAGS = [
  { bit: 1, id: 'brulure', name: 'Brûlure', glyph: 'flame', color: '#ff7a1a' },
  { bit: 2, id: 'froid', name: 'Froid', glyph: 'snow', color: '#8fd8ff' },
  { bit: 4, id: 'gel', name: 'Gel', glyph: 'crystal', color: '#c8f2ff' },
  { bit: 8, id: 'enracine', name: 'Enraciné', glyph: 'root', color: '#8cc85a' },
  { bit: 16, id: 'poison', name: 'Empoisonné', glyph: 'drop', color: '#7ddc3a' },
  { bit: 32, id: 'saignement', name: 'Saignement', glyph: 'drop', color: '#e2303c' },
  { bit: 64, id: 'marque', name: 'Marqué', glyph: 'target', color: '#ff6ad8' },
  { bit: 128, id: 'etourdi', name: 'Étourdi', glyph: 'star', color: '#ffd54a' },
  { bit: 256, id: 'aveugle', name: 'Aveuglé', glyph: 'eye', color: '#d0c8b0' },
];
export const statusList = (flags) => STATUS_FLAGS.filter((s) => (flags & s.bit) !== 0);

/** Class emblem spec (portrait fallback). kind: 'portrait' | 'class'. */
export function classIconSpec(cls, kind = 'portrait') {
  const c = CLASSES[cls];
  return {
    url: c ? `/ui/${kind}_${cls}.png` : null,
    glyph: CLASS_GLYPH[cls] || 'person',
    c1: c?.color || '#6b5a44',
    c2: '#0d0a08',
    fit: kind === 'portrait' ? 'cover' : 'contain',
  };
}
