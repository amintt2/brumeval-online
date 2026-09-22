// Floating tooltip that follows the mouse, plus content builders for items and abilities.
import { ITEMS, ABILITIES, CLASSES, RARITY_COLORS, canUse } from '@shared/data.js';
import { h, fmt, fmt1 } from './dom.js';
import { glyph } from './icons.js';

export const RARITY_LABEL = { common: 'Commun', uncommon: 'Peu commun', rare: 'Rare', epic: 'Épique' };
export const TYPE_LABEL = { consumable: 'Consommable', weapon: 'Arme', armor: 'Armure', junk: 'Butin' };
const KIND_LABEL = {
  melee: 'Corps à corps',
  projectile: 'Projectile',
  aoe_self: 'Zone autour de vous',
  aoe_target: 'Zone ciblée',
  self_heal: 'Soin personnel',
};

export function createTooltip(layer) {
  const tip = h('div', { class: 'bv-tooltip', role: 'tooltip' });
  layer.appendChild(tip);
  let anchor = null;
  let provider = null;
  let mx = 0;
  let my = 0;

  function render() {
    const content = provider ? provider() : null;
    if (!content) {
      hide();
      return;
    }
    tip.replaceChildren(content);
    tip.classList.add('show');
    place();
  }
  function place() {
    const r = tip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = mx + 18;
    let y = my + 20;
    if (x + r.width > vw - 8) x = Math.max(8, mx - r.width - 14);
    if (y + r.height > vh - 8) y = Math.max(8, my - r.height - 14);
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  function hide() {
    anchor = null;
    provider = null;
    tip.classList.remove('show');
  }

  /** Attach a tooltip to `el`; `fn` returns a Node (or null for no tooltip) each time it is shown. */
  function bind(el, fn) {
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      anchor = el;
      provider = fn;
      mx = e.clientX;
      my = e.clientY;
      render();
    });
    el.addEventListener('pointermove', (e) => {
      if (anchor !== el) return;
      mx = e.clientX;
      my = e.clientY;
      place();
    });
    el.addEventListener('pointerleave', () => {
      if (anchor === el) hide();
    });
    el.addEventListener('pointerdown', () => {
      if (anchor === el) hide();
    });
  }

  /** Re-render the visible tooltip (data changed under the cursor). */
  function refresh() {
    if (!anchor) return;
    if (!anchor.isConnected || anchor.closest('.bv-hidden, .is-closed')) {
      hide();
      return;
    }
    render();
  }

  return { bind, refresh, hide, get visible() { return !!anchor; } };
}

// ------------------------------------------------------------------ content builders
const line = (cls, ...kids) => h('div', { class: `tt-line ${cls || ''}`.trim() }, ...kids);

function coinText(n) {
  return h('span', { class: 'tt-coin' }, glyph('coin', 'coin'), `${fmt(n)} po`);
}

/**
 * Item tooltip.
 * ctx = { self, qty, equipped, shop: 'buy'|'sell'|null, hint }
 */
export function itemTooltip(itemId, ctx = {}) {
  const it = ITEMS[itemId];
  if (!it) return null;
  const self = ctx.self;
  const box = h('div', { class: 'tt tt-item' });
  const head = h('div', { class: 'tt-head' },
    h('div', { class: 'tt-name', style: { color: RARITY_COLORS[it.rarity] || '#eee' }, text: it.name }),
    ctx.equipped ? h('span', { class: 'tt-tag', text: 'Équipé' }) : null);
  box.appendChild(head);
  box.appendChild(line('tt-sub', `${RARITY_LABEL[it.rarity] || ''} · ${TYPE_LABEL[it.type] || ''}`));

  const stats = [];
  if (it.atk) stats.push(`+${it.atk} Attaque`);
  if (it.def) stats.push(`+${it.def} Défense`);
  if (it.hp) stats.push(`+${it.hp} Points de vie`);
  if (it.mp) stats.push(`+${it.mp} Mana`);
  if (it.crit) stats.push(`+${fmt1(it.crit * 100)} % Critique`);
  if (stats.length) box.appendChild(h('div', { class: 'tt-stats' }, stats.map((s) => line('tt-stat', s))));
  if (it.type === 'consumable') {
    const eff = it.heal ? `Rend ${it.heal} points de vie.` : it.mana ? `Rend ${it.mana} points de mana.` : it.desc;
    box.appendChild(line('tt-use', `Utiliser : ${eff}`));
  } else if (it.desc) box.appendChild(line('tt-desc', `« ${it.desc} »`));

  if (it.type === 'weapon' || it.type === 'armor') {
    const req = h('div', { class: 'tt-req' });
    if (it.cls) {
      const ok = !self || it.cls.includes(self.cls);
      req.appendChild(line(ok ? '' : 'tt-bad', `Classe : ${it.cls.map((c) => CLASSES[c]?.name || c).join(', ')}`));
    }
    if ((it.lvl || 1) > 1) {
      const ok = !self || self.level >= it.lvl;
      req.appendChild(line(ok ? '' : 'tt-bad', `Niveau ${it.lvl} requis`));
    }
    if (req.childNodes.length) box.appendChild(req);
  }
  if (ctx.qty > 1) box.appendChild(line('tt-dim', `Quantité : ${ctx.qty}`));
  else if (it.stack > 1 && ctx.shop === 'buy') box.appendChild(line('tt-dim', `S'empile par ${it.stack}`));

  if (ctx.shop === 'buy' && it.price) {
    const cant = self && self.gold < it.price;
    box.appendChild(line(`tt-price ${cant ? 'tt-bad' : ''}`, 'Prix : ', coinText(it.price)));
  } else if (it.sell) {
    const total = it.sell * Math.max(1, ctx.qty || 1);
    box.appendChild(line('tt-price', 'Prix de vente : ', coinText(total)));
  } else if (ctx.shop !== 'buy') box.appendChild(line('tt-dim', 'Ne peut pas être vendu'));

  if (ctx.hint) box.appendChild(line('tt-hint', ctx.hint));
  return box;
}

/** Ability tooltip. ctx = { self } */
export function abilityTooltip(abilityId, ctx = {}) {
  const ab = ABILITIES[abilityId];
  if (!ab) return null;
  const self = ctx.self;
  const box = h('div', { class: 'tt tt-ability' });
  box.appendChild(h('div', { class: 'tt-head' },
    h('div', { class: 'tt-name tt-gold', text: ab.name }),
    ab.auto ? h('span', { class: 'tt-tag', text: 'Attaque auto' }) : null));
  const cost = ab.mp ? `${ab.mp} mana` : 'Aucun coût';
  const lack = self && ab.mp > (self.mp || 0);
  box.appendChild(h('div', { class: 'tt-cols' },
    h('span', { class: lack ? 'tt-bad' : '', text: cost }),
    h('span', { text: `Recharge : ${fmt1(ab.cd)} s` })));
  let reach = 'Personnel';
  if (ab.kind === 'aoe_self') reach = `Rayon : ${fmt1(ab.radius)} m`;
  else if (ab.kind === 'aoe_target') reach = `Portée : ${fmt1(ab.range)} m · rayon ${fmt1(ab.radius)} m`;
  else if (ab.range) reach = `Portée : ${fmt1(ab.range)} m`;
  box.appendChild(h('div', { class: 'tt-cols' },
    h('span', { text: reach }),
    h('span', { class: 'tt-dim', text: KIND_LABEL[ab.kind] || '' })));
  box.appendChild(line('tt-desc tt-ab-desc', ab.desc));
  const extras = [];
  if (ab.power) extras.push(`Puissance ×${fmt1(ab.power)}`);
  if (ab.hits > 1) extras.push(`${ab.hits} coups`);
  if (ab.heal) extras.push(`Soigne ${Math.round(ab.heal * 100)} % des PV`);
  if (ab.slow) extras.push(`Ralentit de ${Math.round(ab.slow.pct * 100)} % (${ab.slow.dur} s)`);
  if (extras.length) box.appendChild(line('tt-dim', extras.join(' · ')));
  if (lack) box.appendChild(line('tt-bad', 'Mana insuffisant'));
  if (ctx.key) box.appendChild(line('tt-hint', `Raccourci : ${ctx.key}`));
  return box;
}

export function simpleTooltip(title, text, extra) {
  return h('div', { class: 'tt tt-simple' },
    h('div', { class: 'tt-name tt-gold', text: title }),
    text ? line('tt-desc-plain', text) : null,
    extra ? line('tt-hint', extra) : null);
}

export { canUse };
