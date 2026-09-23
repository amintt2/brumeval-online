// Chat: global messages, whispers (/w), /who, /help, /ignore, rate limiting, moderation, staff commands.
import { S2C, CHAT_MAX_LEN } from '../../shared/protocol.js';
import { CLASSES } from '../../shared/data.js';
import { CHAT_RATE } from './config.js';
import { moderateMessage, chatStrike, ignores, addIgnore, removeIgnore, ignoreSet } from './security/chatmod.js';
import { handleGmCommand } from './security/gm.js';

// Control characters (C0, DEL, C1) and bidi overrides are replaced by spaces.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
// Invisible characters (zero-width spaces/joiners, word joiner, BOM, soft hyphen, LRM/RLM, Mongolian vowel
// separator, invisible math operators, Hangul fillers) are removed.
const INVISIBLE_RE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2060-\u2064\u206a-\u206f\u3164\ufeff\uffa0]/g;
// "Zalgo": more than 2 combining marks in a row are dropped.
const COMBINING_RUN_RE = /([\u0300-\u036f\u0483-\u0489\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]{2})[\u0300-\u036f\u0483-\u0489\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]+/g;

/**
 * Trim, strip control / invisible characters and combining-mark floods, cap at CHAT_MAX_LEN.
 * Returns '' for unusable input. Nothing is HTML-escaped: the client renders chat with textContent.
 */
export function sanitizeChat(text) {
  if (typeof text !== 'string') return '';
  return text.slice(0, CHAT_MAX_LEN * 4)
    .replace(CONTROL_RE, ' ')
    .replace(INVISIBLE_RE, '')
    .replace(COMBINING_RUN_RE, '$1')
    .trim().slice(0, CHAT_MAX_LEN).trim();
}

/** Sliding-window limiter: returns true if the message is allowed (and records it). */
export function allowChat(times, now) {
  while (times.length && now - times[0] >= CHAT_RATE.windowMs) times.shift();
  if (times.length >= CHAT_RATE.count) return false;
  times.push(now);
  return true;
}

export const HELP_LINES = [
  'Commandes disponibles :',
  '/w <nom> <message> — chuchoter à un joueur',
  '/who — liste des joueurs en ligne',
  '/ignore <nom> — ne plus voir les messages d\'un joueur (/ignore seul : votre liste) · /unignore <nom>',
  '/help — afficher cette aide',
  'Déplacement : ZQSD / WASD ou flèches · Clic : sélectionner · Tab : cible suivante · 1-4 : capacités · 5-6 : potions',
];

export function handleChat(game, p, msg) {
  const text = sanitizeChat(msg.text);
  if (!text) return;
  // staff commands are never rate limited (moderating a raid needs many commands in a row)
  const staffCommand = text[0] === '/' && game.security?.isStaff(p);
  if (!staffCommand && !allowChat(p.chatTimes, game.now())) {
    chatStrike(game, p, 'chat_flood');
    return game.error(p, 'rate_limit', 'Vous parlez trop vite, patientez un instant.');
  }

  if (text[0] !== '/') {
    const mod = moderateMessage(game, p, text);
    if (!mod.ok) return game.error(p, 'rate_limit', mod.msg);
    const out = JSON.stringify({ t: S2C.CHAT, ch: 'global', from: p.name, text: mod.text });
    for (const o of game.players.values()) if (!ignores(o, p)) game.sendRaw(o, out);
    return;
  }

  const [rawCmd] = text.split(/\s+/, 1);
  const cmd = rawCmd.toLowerCase();
  const rest = text.slice(rawCmd.length).trim();

  switch (cmd) {
    case '/w': case '/whisper': case '/msg': case '/m': case '/mp': {
      const m = /^(\S+)\s+([\s\S]+)$/.exec(rest);
      if (!m) return game.systemChat('Usage : /w <nom> <message>', { to: p });
      const target = game.playerByName(m[1]);
      if (!target) return game.error(p, 'no_target', `Joueur introuvable ou hors ligne : ${m[1]}`);
      if (target === p) return game.error(p, 'bad_target', 'Vous ne pouvez pas vous chuchoter à vous-même.');
      const mod = moderateMessage(game, p, m[2].trim());
      if (!mod.ok) return game.error(p, 'rate_limit', mod.msg);
      const body = mod.text;
      // an ignored sender is not told (no harassment feedback loop): the whisper is silently dropped
      if (!ignores(target, p)) game.send(target, { t: S2C.CHAT, ch: 'whisper_in', from: p.name, text: body });
      game.send(p, { t: S2C.CHAT, ch: 'whisper_out', to: target.name, text: body });
      return;
    }
    case '/who': case '/qui': {
      const admin = game.security?.isAdmin(p);
      const list = [...game.players.values()]
        .map((o) => `${o.name} (${CLASSES[o.cls].name} niv. ${o.level})${admin ? ` [${o.session?.ip || '?'}]` : ''}`)
        .sort((a, b) => a.localeCompare(b, 'fr'));
      const n = list.length;
      return game.systemChat(`${n} joueur${n > 1 ? 's' : ''} en ligne : ${list.join(', ')}`, { to: p });
    }
    case '/ignore': case '/ignorer': {
      const name = rest.split(/\s+/)[0];
      if (!name) {
        const list = ignoreSet(p);
        return game.systemChat(list.length ? `Joueurs ignorés (${list.length}) : ${list.join(', ')}` : 'Vous n\'ignorez personne. Usage : /ignore <nom>', { to: p });
      }
      const target = game.playerByName(name);
      const display = target?.name || game.store?.get?.(name)?.name;
      if (!display) return game.error(p, 'no_target', `Personnage inconnu : ${name}`);
      const err = addIgnore(game, p, display);
      if (err) return game.error(p, 'bad_target', err);
      return game.systemChat(`Vous ignorez désormais ${display}. (/unignore ${display} pour annuler)`, { to: p });
    }
    case '/unignore': case '/designorer': {
      const name = rest.split(/\s+/)[0];
      if (!name) return game.systemChat('Usage : /unignore <nom>', { to: p });
      return removeIgnore(game, p, name)
        ? game.systemChat(`Vous n'ignorez plus ${name}.`, { to: p })
        : game.error(p, 'bad_target', `${name} n'est pas dans votre liste d'ignorés.`);
    }
    case '/help': case '/aide': case '/?': case '/h':
      for (const line of HELP_LINES) game.systemChat(line, { to: p });
      if (game.security?.isStaff(p)) game.systemChat('Commandes de modération : tapez /mj', { to: p });
      return;
    default:
      if (handleGmCommand(game, p, cmd, rest)) return;
      return game.systemChat(`Commande inconnue : ${rawCmd}. Tapez /help pour la liste des commandes.`, { to: p });
  }
}
