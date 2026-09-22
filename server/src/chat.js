// Chat: global messages, whispers (/w), /who, /help, rate limiting.
import { S2C, CHAT_MAX_LEN } from '../../shared/protocol.js';
import { CLASSES } from '../../shared/data.js';
import { CHAT_RATE } from './config.js';

// Control characters (C0, DEL, C1) and bidi overrides are replaced by spaces.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** Trim, strip control characters, cap at CHAT_MAX_LEN. Returns '' for unusable input. */
export function sanitizeChat(text) {
  if (typeof text !== 'string') return '';
  return text.slice(0, CHAT_MAX_LEN * 4).replace(CONTROL_RE, ' ').trim().slice(0, CHAT_MAX_LEN).trim();
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
  '/help — afficher cette aide',
  'Déplacement : ZQSD / WASD ou flèches · Clic : sélectionner · Tab : cible suivante · 1-4 : capacités · 5-6 : potions',
];

export function handleChat(game, p, msg) {
  const text = sanitizeChat(msg.text);
  if (!text) return;
  if (!allowChat(p.chatTimes, game.now())) return game.error(p, 'rate_limit', 'Vous parlez trop vite, patientez un instant.');

  if (text[0] !== '/') {
    game.broadcast({ t: S2C.CHAT, ch: 'global', from: p.name, text });
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
      const body = m[2].trim();
      game.send(target, { t: S2C.CHAT, ch: 'whisper_in', from: p.name, text: body });
      game.send(p, { t: S2C.CHAT, ch: 'whisper_out', to: target.name, text: body });
      return;
    }
    case '/who': case '/qui': {
      const list = [...game.players.values()]
        .map((o) => `${o.name} (${CLASSES[o.cls].name} niv. ${o.level})`)
        .sort((a, b) => a.localeCompare(b, 'fr'));
      const n = list.length;
      return game.systemChat(`${n} joueur${n > 1 ? 's' : ''} en ligne : ${list.join(', ')}`, { to: p });
    }
    case '/help': case '/aide': case '/?': case '/h':
      for (const line of HELP_LINES) game.systemChat(line, { to: p });
      return;
    default:
      return game.systemChat(`Commande inconnue : ${rawCmd}. Tapez /help pour la liste des commandes.`, { to: p });
  }
}
