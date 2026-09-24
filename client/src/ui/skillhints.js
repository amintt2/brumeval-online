// [skilltree] Level-up flow: « +1 point de compétence » card with a button to open the tree (and the suggested node of
// the « parcours conseillé »), and the first-time tutorial about the Fondamentaux (once per character, remembered).
import { NODES, FOND_IDS, RULES } from '@shared/skills.js';
import { h, setText, clear, lsGet, lsSet } from './dom.js';
import { glyph } from './icons.js';
import { keybinds } from '../game/keybinds.js';
import { treeState } from '../game/skillState.js';

const FOND_TEXT = [
  ['fond_roulade', 'roll', 'esquive les coups télégraphiés'],
  ['fond_sprint', 'sprint', 'garde vos distances'],
  ['fond_saut', 'jump', 'passe au-dessus des ondes de choc'],
  ['fond_garde', 'guard', 'bloque les coups de face'],
  ['fond_charge', 'slot1', 'maintenir l\'attaque de base'],
];

export function createSkillHints(parent, { onOpenTree }) {
  const title = h('div', { class: 'bv-sp-title' });
  const body = h('div', { class: 'bv-sp-body' });
  const openBtn = h('button', { class: 'bv-btn small', type: 'button', onclick: () => { hide(); onOpenTree?.(); } }, glyph('tree'), h('span', { text: 'Ouvrir l\'arbre' }), h('kbd'));
  const laterBtn = h('button', { class: 'bv-btn small secondary', type: 'button', onclick: () => hide(true) }, h('span', { text: 'Plus tard' }));
  const card = h('div', { class: 'bv-sp bv-frame', role: 'status', 'aria-live': 'polite', hidden: true },
    h('div', { class: 'bv-sp-icon' }, glyph('tree')), h('div', { class: 'bv-sp-main' }, title, body, h('div', { class: 'bv-sp-btns' }, laterBtn, openBtn)));
  parent.appendChild(card);
  let timer = 0;
  let charKey = null;
  let prevLevel = null;
  let prevFree = null;
  let tutorial = false;

  function hide(dismiss = false) {
    card.hidden = true;
    clearTimeout(timer);
    if (dismiss && tutorial && charKey) lsSet(`bv.tut.fond.${charKey}`, '1');
  }

  function show(self, gained) {
    const free = self.points?.free || 0;
    const t = treeState(self) || { alloc: {}, gift: [] };
    const owned = new Set([...Object.keys(t.alloc || {}), ...(t.gift || [])]);
    const fond = FOND_IDS.filter((id) => owned.has(id)).length;
    const guide = (RULES.guide?.paths?.[self.cls] || []).find((s) => s.nodes.some((id) => !owned.has(id)));
    tutorial = fond < RULES.gate.fondamentaux && lsGet(`bv.tut.fond.${charKey}`, '') !== '1';
    setText(openBtn.querySelector('kbd'), keybinds.label('tree'));
    setText(title, gained > 0 ? `+${gained} point${gained > 1 ? 's' : ''} de compétence` : `${free} point${free > 1 ? 's' : ''} de compétence à dépenser`);
    clear(body);
    if (tutorial) {
      body.append(
        h('p', { text: `Commencez par les Fondamentaux, au centre de l'Arbre des Brumes (1 point chacun). Dès que vous en connaissez ${RULES.gate.fondamentaux}, la région de votre classe s'ouvre :` }),
        h('ul', { class: 'bv-sp-fonds' }, FOND_TEXT.map(([id, action, why]) => h('li', { class: owned.has(id) ? 'done' : '' },
          h('b', { text: NODES.get(id).name }), h('kbd', { text: action === 'slot1' ? `maintenir ${keybinds.label('slot1')}` : keybinds.label(action) || '—' }), h('span', { text: why })))));
    }
    if (guide) {
      const names = guide.nodes.filter((id) => !owned.has(id)).map((id) => NODES.get(id)?.name).filter(Boolean);
      body.append(h('p', { class: 'bv-sp-guide' }, glyph('star'), h('span', { text: `Conseillé : ${names.join(' + ')} — ${guide.why}` })));
    }
    laterBtn.hidden = false;
    card.hidden = false;
    card.classList.remove('pop');
    void card.offsetWidth;
    card.classList.add('pop');
    clearTimeout(timer);
    if (!tutorial) timer = setTimeout(() => hide(), 14000);
  }

  return {
    hide,
    update(self) {
      if (!self || !self.points || !treeState(self)) return;
      const key = String(self.name || '').toLowerCase();
      const free = self.points.free || 0;
      if (key !== charKey) {
        charKey = key;
        prevLevel = self.level;
        prevFree = free;
        // first connection of a character with unspent points and no Fondamentaux yet: the tutorial
        if (free > 0 && lsGet(`bv.tut.fond.${key}`, '') !== '1') setTimeout(() => show(self, 0), 1500);
        return;
      }
      if (self.level > prevLevel && free > 0) show(self, Math.max(1, free - (prevFree || 0)));
      else if (free === 0 && !card.hidden) hide();
      prevLevel = self.level;
      prevFree = free;
    },
  };
}
