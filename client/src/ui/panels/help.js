// Help panel: controls (the REAL bindings of Options › Commandes, [skilltree]), chat commands and tips.
import { h, clear } from '../dom.js';
import { createWindow } from './window.js';
import { keybinds } from '../../game/keybinds.js';

const K = (id) => () => keybinds.labels(id);
const moveKeys = () => ['move_f', 'move_l', 'move_b', 'move_r'].map((a) => keybinds.label(a) || '—');
const barKeys = () => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => keybinds.label(`slot${n}`) || '—');
const shared = () => keybinds.codesOf('roll').some((c) => keybinds.rollSprintShared(c));

// each row: [keys() → string[], description() | string]
const CONTROLS = [
  [moveKeys, 'Se déplacer'],
  [K('roll'), () => (shared() ? 'Appui court : roulade d\'esquive (invulnérable un instant, coûte de l\'endurance)' : 'Roulade d\'esquive')],
  [K('sprint'), () => (shared() ? 'Maintenir : sprinter (consomme de l\'endurance)' : 'Maintenir : sprinter')],
  [K('jump'), 'Sauter : passe au-dessus des ondes de choc au sol (Fondamental)'],
  [K('guard'), 'Maintenir : garde, bloque les coups de face (Fondamental)'],
  [() => ['Clic gauche'], 'Sélectionner une cible · parler à un PNJ'],
  [() => ['Clic droit'], 'Attaquer le monstre visé'],
  [() => ['Clic droit'], 'Maintenir et glisser : pivoter la caméra'],
  [() => ['Clic gauche', 'Clic droit'], 'Maintenir les deux : courir tout droit'],
  [() => ['Molette'], 'Zoomer / dézoomer'],
  [K('target'), 'Cibler l\'ennemi suivant'],
  [() => ['Échap'], 'Fermer une fenêtre · annuler la cible · menu principal'],
  [barKeys, 'Barre d\'action (8 emplacements)'],
  [() => [keybinds.label('slot1') || '1'], 'Attaque de base · maintenir : Attaque chargée (Fondamental)'],
];
const WINDOWS = [
  ['tree', 'Arbre des Brumes (compétences)'],
  ['book', 'Livre de compétences (glisser sur la barre)'],
  ['inventory', 'Sac'],
  ['character', 'Personnage'],
  ['quests', 'Journal de quêtes'],
  ['help', 'Aide'],
  ['options', 'Options (graphismes, son, commandes)'],
  ['map', 'Carte du monde'],
  ['chat', 'Ouvrir la discussion / envoyer'],
];
const COMMANDS = [
  ['/w nom message', 'Chuchoter à un joueur'],
  ['/r message', 'Répondre au dernier chuchotement'],
  ['/who', 'Liste des joueurs en ligne'],
  ['/help', 'Aide du serveur'],
];
const TIPS = [
  'Le village de Brumeval est une zone sûre : aucun combat n\'y est possible.',
  'Hors combat, vos points de vie et de mana se régénèrent rapidement.',
  'Un point d\'exclamation doré au-dessus de l\'Ancien Aldric signale une nouvelle quête.',
  'Le butin va directement dans votre sac : vendez-le à Marchande Élise.',
  // [combat-souls]
  'Les zones rouges au sol annoncent une attaque : sortez-en ou roulez au travers au dernier moment.',
  'Chaque attaque vous engage : vous ralentissez un court instant après avoir frappé ou tiré.',
  'En mourant, vous laissez un écho contenant l\'expérience du niveau en cours. Retrouvez-le avant de mourir à nouveau !',
  'Les coups puissants déséquilibrent les monstres et interrompent leurs attaques.',
  // [skilltree]
  'Chaque niveau donne un point de compétence : apprenez d\'abord 3 Fondamentaux au centre de l\'Arbre des Brumes, puis spécialisez-vous.',
  'Zone au sol dessinée en vagues : attaque rasante, sautez-la. Bordure crénelée : imblocable, roulez. Runes violettes : un sort.',
];

export function createHelpPanel(wm, { onToggle }) {
  const win = wm.add(createWindow({
    id: 'help', title: 'Aide', subtitle: 'Commandes et conseils', keyHint: keybinds.label('help') || 'H',
    onShow: () => { render(); onToggle?.(true); },
    onHide: () => onToggle?.(false),
  }));
  const keys = (list) => h('span', { class: 'bv-keys' }, list.filter(Boolean).map((k) => h('kbd', { text: k })));
  const table = (rows) => h('div', { class: 'bv-help-table' }, rows.map(([k, d]) => h('div', { class: 'bv-help-row' }, keys(k), h('span', { class: 'bv-help-d', text: d }))));
  function render() {
    const winKey = win.el.querySelector('.bv-win-key');
    if (winKey) winKey.textContent = keybinds.label('help');
    clear(win.body).append(
      h('div', { class: 'bv-help-cols' },
        h('div', { class: 'bv-help-col' },
          h('div', { class: 'bv-sec-title', text: 'Déplacement & combat' }),
          table(CONTROLS.map(([k, d]) => [k().length ? k() : ['—'], typeof d === 'function' ? d() : d]))),
        h('div', { class: 'bv-help-col' },
          h('div', { class: 'bv-sec-title', text: 'Fenêtres' }),
          table(WINDOWS.map(([id, d]) => [keybinds.labels(id).length ? keybinds.labels(id).slice(0, 1) : ['—'], d])),
          h('div', { class: 'bv-sec-title', text: 'Discussion' }),
          h('div', { class: 'bv-help-table' }, COMMANDS.map(([c, d]) => h('div', { class: 'bv-help-row' }, h('code', { text: c }), h('span', { class: 'bv-help-d', text: d })))),
          h('p', { class: 'bv-help-note', text: 'Toutes les touches se changent dans Options › Commandes.' }))),
      h('div', { class: 'bv-sec-title', text: 'Conseils' }),
      h('ul', { class: 'bv-help-tips' }, TIPS.map((t) => h('li', { text: t }))));
  }
  keybinds.onChange(() => { if (win.isOpen) render(); });
  render();
  return { win, render };
}
