// Death overlay: "Vous êtes mort" + "Réapparaître au village".
import { h } from './dom.js';
import { glyph } from './icons.js';

export function createDeath(parent, handlers) {
  const btn = h('button', { class: 'bv-btn gold big', type: 'button' }, glyph('house'), h('span', { text: 'Réapparaître au village' }));
  const el = h('div', { class: 'bv-death bv-hidden', role: 'alertdialog', 'aria-label': 'Vous êtes mort' },
    h('div', { class: 'bv-death-box' },
      h('div', { class: 'bv-death-skull' }, glyph('skull')),
      h('h2', { class: 'bv-death-title', text: 'Vous êtes mort' }),
      h('p', { class: 'bv-death-sub', text: 'Votre esprit erre dans les brumes… Les gardiens de Brumeval peuvent vous ramener parmi les vivants.' }),
      btn));
  parent.appendChild(el);
  btn.addEventListener('click', () => {
    btn.disabled = true;
    handlers.respawn?.();
    // if the server does not answer, allow another try
    setTimeout(() => { btn.disabled = false; }, 2500);
  });
  return {
    get visible() { return !el.classList.contains('bv-hidden'); },
    show(show) {
      const was = !el.classList.contains('bv-hidden');
      el.classList.toggle('bv-hidden', !show);
      if (show && !was) btn.disabled = false;
    },
  };
}
