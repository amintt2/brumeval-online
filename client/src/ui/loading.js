// Loading screen: logo, gold progress bar, status text and rotating hints.
import { GAME_TITLE } from '@shared/data.js';
import { h, clamp01 } from './dom.js';

const HINTS = [
  'Le village de Brumeval est une zone sûre : aucun monstre ne peut y entrer.',
  'Parlez à l\'Ancien Aldric, au centre du village, pour obtenir vos premières quêtes.',
  'Appuyez sur Tab pour cibler l\'ennemi le plus proche devant vous.',
  'Les touches 5 et 6 boivent une potion de soin ou de mana.',
  'Clic droit sur un objet du sac pour le vendre lorsque la boutique est ouverte.',
  'Chuchotez à un autre joueur avec /w nom message.',
  'Hors combat, vos points de vie et de mana se régénèrent rapidement.',
  'Au-delà du cimetière, un golem millénaire attend son heure…',
  'Les loups de la Forêt des Murmures chassent en meute : restez sur vos gardes.',
  'Marchande Élise vend potions, armes et armures près du puits.',
];

export function createLoading(parent) {
  const fill = h('div', { class: 'bv-load-fill' });
  const pctEl = h('div', { class: 'bv-load-pct', text: '0 %' });
  const textEl = h('div', { class: 'bv-load-text', text: 'Chargement…' });
  const hintEl = h('div', { class: 'bv-load-hint' });
  const title = GAME_TITLE.split(' ');
  const el = h('div', { class: 'bv-screen bv-loading bv-hidden', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' },
    h('div', { class: 'bv-load-center' },
      h('div', { class: 'bv-logo small' },
        h('div', { class: 'bv-logo-main', text: title[0] }),
        h('div', { class: 'bv-logo-sub' }, h('span', { class: 'bv-logo-line' }), h('span', { text: title.slice(1).join(' ') || 'Online' }), h('span', { class: 'bv-logo-line r' }))),
      h('div', { class: 'bv-load-box' },
        h('div', { class: 'bv-load-row' }, textEl, pctEl),
        h('div', { class: 'bv-load-bar' }, fill, h('div', { class: 'bv-load-gleam' })),
        h('div', { class: 'bv-load-hintwrap' }, h('span', { class: 'bv-load-hintlabel', text: 'Astuce' }), hintEl))));
  parent.appendChild(el);

  let hintIdx = Math.floor(Math.random() * HINTS.length);
  let hintTimer = null;
  function nextHint() {
    hintIdx = (hintIdx + 1) % HINTS.length;
    hintEl.classList.remove('in');
    void hintEl.offsetWidth;
    hintEl.textContent = HINTS[hintIdx];
    hintEl.classList.add('in');
  }

  return {
    get visible() { return !el.classList.contains('bv-hidden'); },
    set(p, text) {
      if (p == null) {
        el.classList.add('bv-hidden');
        clearInterval(hintTimer);
        hintTimer = null;
        return;
      }
      const wasHidden = el.classList.contains('bv-hidden');
      el.classList.remove('bv-hidden');
      const v = clamp01(Number(p) || 0);
      fill.style.width = `${(v * 100).toFixed(1)}%`;
      pctEl.textContent = `${Math.round(v * 100)} %`;
      el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      if (text != null) textEl.textContent = String(text);
      if (wasHidden || !hintTimer) {
        nextHint();
        clearInterval(hintTimer);
        hintTimer = setInterval(nextHint, 5000);
      }
    },
  };
}
