// Help panel: controls, chat commands and tips.
import { h } from '../dom.js';
import { createWindow } from './window.js';

const CONTROLS = [
  [['Z', 'Q', 'S', 'D'], 'Se déplacer (ou W A S D, flèches)'],
  [['Clic gauche'], 'Sélectionner une cible · parler à un PNJ'],
  [['Clic droit'], 'Attaquer le monstre visé'],
  [['Clic droit'], 'Maintenir et glisser : pivoter la caméra'],
  [['Clic gauche', 'Clic droit'], 'Maintenir les deux : courir tout droit'],
  [['Molette'], 'Zoomer / dézoomer'],
  [['Tab'], 'Cibler l\'ennemi suivant'],
  [['Échap'], 'Fermer une fenêtre · annuler la cible · menu principal'],
  [['1', '2', '3', '4'], 'Capacités de la barre d\'action'],
  [['5'], 'Boire une potion de soin'],
  [['6'], 'Boire une potion de mana'],
];
// [combat-souls]
CONTROLS.splice(1, 0,
  [['Maj'], 'Appui court : roulade d\'esquive (invulnérable un instant, coûte de l\'endurance)'],
  [['Maj'], 'Maintenir : sprinter (consomme de l\'endurance)']);
const WINDOWS = [
  [['I'], 'Sac'],
  [['C'], 'Personnage'],
  [['L'], 'Journal de quêtes'],
  [['H'], 'Aide'],
  [['O'], 'Options (graphismes, son, commandes)'], // [render-souls]
  [['M'], 'Carte du monde'], // [accounts]
  [['Entrée'], 'Ouvrir la discussion / envoyer'],
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
];
// [combat-souls]
TIPS.push(
  'Les zones rouges au sol annoncent une attaque : sortez-en ou roulez au travers au dernier moment.',
  'Chaque attaque vous engage : vous ralentissez un court instant après avoir frappé ou tiré.',
  'En mourant, vous laissez un écho contenant l\'expérience du niveau en cours. Retrouvez-le avant de mourir à nouveau !',
  'Les coups puissants déséquilibrent les monstres et interrompent leurs attaques.');

export function createHelpPanel(wm, { onToggle }) {
  const win = wm.add(createWindow({
    id: 'help', title: 'Aide', subtitle: 'Commandes et conseils', keyHint: 'H',
    onShow: () => onToggle?.(true),
    onHide: () => onToggle?.(false),
  }));
  const keys = (list) => h('span', { class: 'bv-keys' }, list.map((k) => h('kbd', { text: k })));
  const table = (rows) => h('div', { class: 'bv-help-table' }, rows.map(([k, d]) => h('div', { class: 'bv-help-row' }, keys(k), h('span', { class: 'bv-help-d', text: d }))));
  win.body.append(
    h('div', { class: 'bv-help-cols' },
      h('div', { class: 'bv-help-col' },
        h('div', { class: 'bv-sec-title', text: 'Déplacement & combat' }),
        table(CONTROLS)),
      h('div', { class: 'bv-help-col' },
        h('div', { class: 'bv-sec-title', text: 'Fenêtres' }),
        table(WINDOWS),
        h('div', { class: 'bv-sec-title', text: 'Discussion' }),
        h('div', { class: 'bv-help-table' }, COMMANDS.map(([c, d]) => h('div', { class: 'bv-help-row' }, h('code', { text: c }), h('span', { class: 'bv-help-d', text: d })))))),
    h('div', { class: 'bv-sec-title', text: 'Conseils' }),
    h('ul', { class: 'bv-help-tips' }, TIPS.map((t) => h('li', { text: t }))));
  return { win };
}
