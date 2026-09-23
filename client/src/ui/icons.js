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

const KIND_GLYPH = { melee: 'sword', projectile: 'arrow', aoe_self: 'burst', aoe_target: 'target', self_heal: 'cross' };
export function abilityIconSpec(abilityId, cls) {
  const ab = ABILITIES[abilityId];
  const color = CLASSES[cls]?.color || '#7a6a50';
  let g = KIND_GLYPH[ab?.kind] || 'burst';
  if (ab?.kind === 'projectile' && cls === 'mage') g = 'flame';
  if (abilityId === 'war_cry') g = 'shield';
  return { url: `/icons/ab_${abilityId}.png`, glyph: g, c1: color, c2: '#120d0a', fit: 'cover' };
}

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
