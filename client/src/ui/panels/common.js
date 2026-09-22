// Small view helpers shared by panels and the NPC dialog.
import { ITEMS, RARITY_COLORS } from '@shared/data.js';
import { h, fmt } from '../dom.js';
import { iconBox, itemIconSpec, glyph } from '../icons.js';
import { itemTooltip } from '../tooltip.js';
import { questRewards } from '../quests-util.js';

export function rewardsView(qid, self, tooltip) {
  const list = questRewards(qid, self?.cls);
  const wrap = h('div', { class: 'bv-rewards' });
  for (const r of list) {
    if (r.kind === 'xp') wrap.appendChild(h('div', { class: 'bv-rw xp' }, h('span', { class: 'bv-rw-i xp', text: 'XP' }), h('span', { text: `${fmt(r.value)}` })));
    else if (r.kind === 'gold') {
      wrap.appendChild(h('div', { class: 'bv-rw gold' },
        iconBox({ url: '/icons/gold.png', glyph: 'coin', c1: '#d9a93a', c2: '#5a3b0a', fit: 'contain' }, 'bv-rw-ic'),
        h('span', { text: `${fmt(r.value)} po` })));
    } else {
      const it = ITEMS[r.id];
      const chip = h('div', { class: 'bv-rw item', style: { '--rar': RARITY_COLORS[it.rarity] } },
        iconBox(itemIconSpec(r.id), 'bv-rw-ic'),
        h('span', { class: 'bv-rw-name', style: { color: RARITY_COLORS[it.rarity] }, text: it.name }),
        r.qty > 1 ? h('span', { class: 'bv-rw-q', text: `×${r.qty}` }) : null);
      tooltip.bind(chip, () => itemTooltip(r.id, { self, qty: r.qty }));
      wrap.appendChild(chip);
    }
  }
  return wrap;
}

export function goldView(value, cls = '') {
  return h('span', { class: `bv-goldinline ${cls}`.trim() },
    iconBox({ url: '/icons/gold.png', glyph: 'coin', c1: '#d9a93a', c2: '#5a3b0a', fit: 'contain' }, 'bv-gi-ic'),
    h('span', { class: 'bv-gi-v', text: fmt(value) }));
}

export function progressBar(n, count, cls = '') {
  const r = count > 0 ? Math.max(0, Math.min(1, n / count)) : 0;
  return h('div', { class: `bv-prog ${cls}`.trim() },
    h('i', { style: { width: `${(r * 100).toFixed(1)}%` } }),
    h('span', { text: `${n} / ${count}` }));
}

export function emptyNote(text, glyphName = 'scroll') {
  return h('div', { class: 'bv-empty' }, glyph(glyphName), h('span', { text }));
}
