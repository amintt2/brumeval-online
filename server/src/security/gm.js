// Game-master / admin chat commands. Roles: 'admin' (ADMIN_NAMES env or account.role) and 'gm' (account.role,
// granted with /role). Players without a role get exactly the "Commande inconnue" answer, as for any typo.
// Every action is written to the security journal (type 'gm').
import { S2C, FX } from '../../../shared/protocol.js';
import { CLASSES } from '../../../shared/data.js';
import { isWalkable, WORLD_LIMIT } from '../../../shared/world.js';
import { PLAYER_RADIUS } from '../../../shared/protocol.js';
import { nameKey } from '../auth.js';
import { checkDialogDistance } from '../systems/npc.js';
import { formatDuration, parseDuration, banSpan } from './format.js';
import { mutePlayerAccount, unmuteAccount, muteRemaining } from './chatmod.js';

const RANK = { player: 0, gm: 1, admin: 2 };
const ROLE_LABEL = { player: 'joueur', gm: 'maître du jeu', admin: 'administrateur' };
const ROLE_ARG = { joueur: 'player', player: 'player', aucun: 'player', mj: 'gm', gm: 'gm', modo: 'gm', admin: 'admin' };
const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+:[0-9a-f:]*$/i;

export const GM_HELP = [
  'Commandes de modération :',
  '/kick <nom> [raison] — expulser un joueur',
  '/ban <nom> [durée] [raison] — bannir un compte (durée : 30m, 2h, 3j, 1sem ou perm ; perm par défaut)',
  '/banip <nom|IP> [durée] [raison] — bannir une adresse IP (administrateurs)',
  '/unban <nom|IP> — lever un bannissement',
  '/bans — bannissements en cours',
  '/mute <nom> <durée> [raison] — réduire au silence · /unmute <nom>',
  '/tp <x> <z> — se téléporter · /tp <nom> — faire venir un joueur · /tpto <nom> — aller vers un joueur',
  '/announce <message> — annonce à tous les joueurs',
  '/inspect <nom> — score de suspicion, signalements récents, sanctions',
  '/who — joueurs en ligne (avec leur IP pour les administrateurs)',
  '/role <nom> <joueur|mj|admin> — changer le rôle d\'un compte (administrateurs)',
];

/** name -> { player (online or null), account (or null), name (display) } */
function resolveTarget(game, name) {
  if (typeof name !== 'string' || !name) return null;
  const player = game.playerByName(name);
  const account = player?.account || game.store?.get?.(name) || null;
  if (!player && !account) return null;
  return { player, account, name: player?.name || account.name, key: nameKey(player?.name || account.name) };
}

function roleOfTarget(sec, t) {
  if (t.player) return sec.roleOf(t.player);
  return sec.roleOf({ name: t.name, account: t.account });
}

/** Staff can only sanction lower ranks; admins can sanction anyone but themselves. */
function checkRank(game, actor, t) {
  if (t.key === nameKey(actor.name)) return 'Vous ne pouvez pas vous cibler vous-même.';
  const sec = game.security;
  const a = RANK[sec.roleOf(actor)], b = RANK[roleOfTarget(sec, t)];
  if (a < RANK.admin && b >= a) return 'Vous ne pouvez pas sanctionner un membre de l\'équipe.';
  return null;
}

const reply = (game, p, text) => game.systemChat(text, { to: p });

/** Split "nom rest…" */
function splitArg(rest) {
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest.trim());
  return m ? [m[1], (m[2] || '').trim()] : ['', ''];
}

/** "[durée] [raison]" -> { durationMs (null = permanent), reason } */
function durationAndReason(rest, { required = false } = {}) {
  const [first, more] = splitArg(rest);
  const d = parseDuration(first);
  if (d === undefined) {
    if (required) return null;
    return { durationMs: null, reason: rest.trim() };
  }
  return { durationMs: d, reason: more };
}

// ------------------------------------------------------------------ teleport helpers
/** Nearest free walkable point around (x, z) (spiral search up to ~8 m), or null. */
export function findFreeSpot(game, x, z) {
  x = Math.max(-WORLD_LIMIT + 1, Math.min(WORLD_LIMIT - 1, x));
  z = Math.max(-WORLD_LIMIT + 1, Math.min(WORLD_LIMIT - 1, z));
  const free = (px, pz) => isWalkable(px, pz) && game.collision.penetration(px, pz, PLAYER_RADIUS) < 0.01;
  if (free(x, z)) return { x, z };
  for (let r = 0.75; r <= 8; r += 0.75) {
    const n = Math.max(8, Math.round(r * 6));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (Math.abs(px) <= WORLD_LIMIT && Math.abs(pz) <= WORLD_LIMIT && free(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

/** Server-side teleport (resets movement validation, snaps the client). Returns false if no free spot. */
export function teleportPlayer(game, p, x, z) {
  const spot = findFreeSpot(game, x, z);
  if (!spot) return false;
  p.x = Math.round(spot.x * 100) / 100;
  p.z = Math.round(spot.z * 100) / 100;
  p.mv.reset(p.x, p.z, game.now());
  p.moveUntil = 0;
  p.markDirty('x', 'z');
  game.sendCorrect(p, true);
  checkDialogDistance(game, p);
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.RESPAWN, src: p.id });
  return true;
}

// ------------------------------------------------------------------ commands
const COMMANDS = {
  '/mj': { role: 'gm', run: (game, p) => { for (const l of GM_HELP) reply(game, p, l); } },
  '/gm': { alias: '/mj' },
  '/aidemj': { alias: '/mj' },

  '/kick': {
    role: 'gm',
    run(game, p, rest) {
      const [name, reason] = splitArg(rest);
      if (!name) return reply(game, p, 'Usage : /kick <nom> [raison]');
      const t = resolveTarget(game, name);
      if (!t?.player) return game.error(p, 'no_target', `Joueur introuvable ou hors ligne : ${name}`);
      const err = checkRank(game, p, t);
      if (err) return game.error(p, 'bad_target', err);
      game.security.gmLog(p, 'kick', { target: t.name, reason: reason || undefined });
      game.security.kick(t.player, `Vous avez été expulsé par un maître du jeu.${reason ? ` Raison : ${reason}.` : ''}`);
      reply(game, p, `${t.name} a été expulsé.`);
    },
  },

  '/ban': {
    role: 'gm',
    run(game, p, rest) {
      const [name, more] = splitArg(rest);
      if (!name) return reply(game, p, 'Usage : /ban <nom> [durée : 30m, 2h, 3j, 1sem, perm] [raison]');
      const t = resolveTarget(game, name);
      if (!t) return game.error(p, 'no_target', `Personnage inconnu : ${name}`);
      const err = checkRank(game, p, t);
      if (err) return game.error(p, 'bad_target', err);
      const { durationMs, reason } = durationAndReason(more);
      const sec = game.security;
      const ban = sec.bans.banAccount(t.name, { durationMs, reason, author: p.name });
      sec.gmLog(p, 'ban', { target: t.name, until: ban.until === null ? 'perm' : new Date(ban.until).toISOString(), reason: reason || undefined });
      if (t.player) sec.kick(t.player, sec.banMessage(ban));
      reply(game, p, `${t.name} est banni ${durationMs === null ? 'définitivement' : `pour ${formatDuration(durationMs)}`}${reason ? ` (${reason})` : ''}.`);
    },
  },

  '/banip': {
    role: 'admin',
    run(game, p, rest) {
      const [arg, more] = splitArg(rest);
      if (!arg) return reply(game, p, 'Usage : /banip <nom|IP> [durée] [raison]');
      const sec = game.security;
      let ip = null, label = arg;
      if (IP_RE.test(arg)) ip = arg.toLowerCase();
      else {
        const t = resolveTarget(game, arg);
        if (!t) return game.error(p, 'no_target', `Personnage inconnu : ${arg}`);
        const err = checkRank(game, p, t);
        if (err) return game.error(p, 'bad_target', err);
        ip = t.player?.session?.ip || t.account?.lastIp || null;
        label = `${t.name} (${ip})`;
        if (!ip || ip === '?') return game.error(p, 'bad_target', `Adresse IP inconnue pour ${t.name}.`);
      }
      if (sec.ipExempt(ip)) return game.error(p, 'bad_target', `Impossible de bannir l'adresse locale ${ip} (serveur derrière un proxy sans TRUST_PROXY ?).`);
      if (ip === p.session?.ip) return game.error(p, 'bad_target', 'Vous ne pouvez pas bannir votre propre adresse.');
      const { durationMs, reason } = durationAndReason(more);
      const ban = sec.bans.banIp(ip, { durationMs, reason, author: p.name });
      sec.gmLog(p, 'banip', { target: label, ip, until: ban.until === null ? 'perm' : new Date(ban.until).toISOString(), reason: reason || undefined });
      let n = 0;
      for (const o of [...game.players.values()]) {
        if (o.session?.ip === ip && o !== p) { sec.kick(o, sec.banMessage(ban)); n++; }
      }
      reply(game, p, `Adresse ${ip} bannie ${durationMs === null ? 'définitivement' : `pour ${formatDuration(durationMs)}`}${n ? ` — ${n} joueur(s) expulsé(s)` : ''}.`);
    },
  },

  '/unban': {
    role: 'gm',
    run(game, p, rest) {
      const [arg] = splitArg(rest);
      if (!arg) return reply(game, p, 'Usage : /unban <nom|IP>');
      const sec = game.security;
      let n = 0;
      if (IP_RE.test(arg)) {
        if (!sec.isAdmin(p)) return game.error(p, 'bad_request', 'Seuls les administrateurs gèrent les bannissements d\'adresse IP.');
        n = sec.bans.remove('ip', arg.toLowerCase());
      } else {
        n = sec.bans.remove('account', arg);
      }
      sec.gmLog(p, 'unban', { target: arg, removed: n });
      reply(game, p, n ? `Bannissement levé : ${arg}.` : `Aucun bannissement actif pour ${arg}.`);
    },
  },

  '/bans': {
    role: 'gm',
    run(game, p) {
      const sec = game.security;
      const now = sec.now();
      const list = sec.bans.active(now).filter((b) => b.type === 'account' || sec.isAdmin(p));
      if (!list.length) return reply(game, p, 'Aucun bannissement en cours.');
      reply(game, p, `${list.length} bannissement(s) en cours :`);
      for (const b of list.slice(-15)) {
        reply(game, p, `${b.type === 'ip' ? `IP ${b.key}` : (b.name || b.key)} — ${banSpan(b.until, now)} — par ${b.author}${b.reason ? ` — ${b.reason}` : ''}`);
      }
    },
  },

  '/mute': {
    role: 'gm',
    run(game, p, rest) {
      const [name, more] = splitArg(rest);
      const dr = name ? durationAndReason(more, { required: true }) : null;
      if (!dr) return reply(game, p, 'Usage : /mute <nom> <durée : 10m, 1h, 1j…> [raison]');
      const t = resolveTarget(game, name);
      if (!t) return game.error(p, 'no_target', `Personnage inconnu : ${name}`);
      const err = checkRank(game, p, t);
      if (err) return game.error(p, 'bad_target', err);
      const ms = dr.durationMs === null ? 10 * 365 * 86_400_000 : dr.durationMs;
      mutePlayerAccount(game, t.account, ms, dr.reason);
      game.security.gmLog(p, 'mute', { target: t.name, ms, reason: dr.reason || undefined });
      const span = dr.durationMs === null ? 'définitivement' : `pour ${formatDuration(ms)}`;
      if (t.player) game.systemChat(`Vous avez été réduit au silence ${span} par un maître du jeu.${dr.reason ? ` Raison : ${dr.reason}.` : ''}`, { to: t.player });
      reply(game, p, `${t.name} est réduit au silence ${span}.`);
    },
  },

  '/unmute': {
    role: 'gm',
    run(game, p, rest) {
      const [name] = splitArg(rest);
      if (!name) return reply(game, p, 'Usage : /unmute <nom>');
      const t = resolveTarget(game, name);
      if (!t) return game.error(p, 'no_target', `Personnage inconnu : ${name}`);
      const was = unmuteAccount(game, t.account);
      game.security.gmLog(p, 'unmute', { target: t.name });
      if (t.player && was) game.systemChat('Vous pouvez de nouveau parler.', { to: t.player });
      reply(game, p, was ? `${t.name} peut de nouveau parler.` : `${t.name} n'était pas réduit au silence.`);
    },
  },

  '/tp': {
    role: 'gm',
    run(game, p, rest) {
      const args = rest.trim().split(/\s+/).filter(Boolean);
      if (args.length === 2 && args.every((a) => /^-?\d+(?:[.,]\d+)?$/.test(a))) {
        const [x, z] = args.map((a) => Number(a.replace(',', '.')));
        if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT) return game.error(p, 'bad_request', `Coordonnées hors du monde (±${WORLD_LIMIT}).`);
        if (p.dead) return game.error(p, 'dead', 'Vous êtes mort.');
        if (!teleportPlayer(game, p, x, z)) return game.error(p, 'bad_request', 'Aucun emplacement libre à cet endroit.');
        game.security.gmLog(p, 'tp', { x: p.x, z: p.z });
        return reply(game, p, `Téléporté en (${p.x.toFixed(1)}, ${p.z.toFixed(1)}).`);
      }
      if (args.length !== 1) return reply(game, p, 'Usage : /tp <x> <z> ou /tp <nom> (faire venir un joueur)');
      const t = resolveTarget(game, args[0]);
      if (!t?.player) return game.error(p, 'no_target', `Joueur introuvable ou hors ligne : ${args[0]}`);
      if (t.player === p) return game.error(p, 'bad_target', 'Vous êtes déjà ici.');
      if (t.player.dead) return game.error(p, 'bad_target', `${t.name} est mort.`);
      if (!teleportPlayer(game, t.player, p.x + Math.sin(p.ry) * 1.5, p.z + Math.cos(p.ry) * 1.5)) return game.error(p, 'bad_request', 'Aucun emplacement libre près de vous.');
      game.security.gmLog(p, 'summon', { target: t.name, x: t.player.x, z: t.player.z });
      game.systemChat(`Vous avez été téléporté auprès de ${p.name}.`, { to: t.player });
      reply(game, p, `${t.name} a été téléporté auprès de vous.`);
    },
  },

  '/tpto': {
    role: 'gm',
    run(game, p, rest) {
      const [name] = splitArg(rest);
      if (!name) return reply(game, p, 'Usage : /tpto <nom>');
      const t = resolveTarget(game, name);
      if (!t?.player) return game.error(p, 'no_target', `Joueur introuvable ou hors ligne : ${name}`);
      if (t.player === p) return game.error(p, 'bad_target', 'Vous êtes déjà ici.');
      if (p.dead) return game.error(p, 'dead', 'Vous êtes mort.');
      if (!teleportPlayer(game, p, t.player.x + 1.5, t.player.z)) return game.error(p, 'bad_request', 'Aucun emplacement libre près de ce joueur.');
      game.security.gmLog(p, 'tpto', { target: t.name, x: p.x, z: p.z });
      reply(game, p, `Téléporté auprès de ${t.name}.`);
    },
  },

  '/announce': {
    role: 'gm',
    run(game, p, rest) {
      const text = rest.trim();
      if (!text) return reply(game, p, 'Usage : /announce <message>');
      game.security.gmLog(p, 'announce', { text: text.slice(0, 200) });
      const msg = { t: S2C.NOTIFY, kind: 'info', text: `Annonce : ${text}` };
      for (const o of game.players.values()) game.send(o, msg);
    },
  },
  '/annonce': { alias: '/announce' },

  '/inspect': {
    role: 'gm',
    run(game, p, rest) {
      const [name] = splitArg(rest);
      if (!name) return reply(game, p, 'Usage : /inspect <nom>');
      const t = resolveTarget(game, name);
      if (!t) return game.error(p, 'no_target', `Personnage inconnu : ${name}`);
      const sec = game.security;
      const admin = sec.isAdmin(p);
      const now = sec.now();
      const a = t.account;
      const role = roleOfTarget(sec, t);
      const lvl = t.player ? t.player.level : a?.level;
      const cls = CLASSES[t.player?.cls || a?.cls]?.name || '?';
      const ip = t.player?.session?.ip || a?.lastIp || null;
      sec.gmLog(p, 'inspect', { target: t.name });
      reply(game, p, `— ${t.name} (${cls} niv. ${lvl}, ${ROLE_LABEL[role]}) — ${t.player ? 'en ligne' : 'hors ligne'}`);
      const ipScore = ip ? sec.scoreOf({ ip }) : 0;
      const strikes = (sec.strikes.get(t.key) || []).length;
      reply(game, p, `Suspicion : ${sec.scoreOf({ name: t.name }).toFixed(1)} (compte)${admin && ip ? ` · ${ipScore.toFixed(1)} (IP)` : ''} · expulsions automatiques récentes : ${strikes}`);
      if (admin) reply(game, p, `IP : ${ip || 'inconnue'}`);
      if (t.player) reply(game, p, `Position : (${t.player.x.toFixed(1)}, ${t.player.z.toFixed(1)})${t.player.dead ? ' — mort' : ''}`);
      const mute = t.player ? muteRemaining(game, t.player) : Math.max(0, (a?.muteUntil || 0) - now);
      reply(game, p, `Silence : ${mute > 0 ? `encore ${formatDuration(mute)}${a?.muteReason ? ` (${a.muteReason})` : ''}` : 'non'}`);
      const ban = sec.accountBan(t.name);
      reply(game, p, `Bannissement : ${ban ? `${banSpan(ban.until, now)} — ${ban.reason || 'sans raison'} (par ${ban.author})` : 'non'}`);
      const flags = sec.flagsOf(t.name).slice(0, 8);
      if (!flags.length) return reply(game, p, 'Aucun signalement récent.');
      reply(game, p, `Signalements récents : ${flags.map((f) => `${f.code}${f.n > 1 ? `×${f.n}` : ''} (il y a ${formatDuration(now - f.t)})`).join(', ')}`);
    },
  },

  '/role': {
    role: 'admin',
    run(game, p, rest) {
      const [name, r] = splitArg(rest);
      const role = ROLE_ARG[(r || '').toLowerCase()];
      if (!name || !role) return reply(game, p, 'Usage : /role <nom> <joueur|mj|admin>');
      const t = resolveTarget(game, name);
      if (!t) return game.error(p, 'no_target', `Personnage inconnu : ${name}`);
      if (t.key === nameKey(p.name)) return game.error(p, 'bad_target', 'Vous ne pouvez pas changer votre propre rôle.');
      if (role === 'player') delete t.account.role;
      else t.account.role = role;
      game.store?.markDirty();
      game.security.gmLog(p, 'role', { target: t.name, role });
      const effective = roleOfTarget(game.security, t);
      if (t.player) game.systemChat(`Votre rôle est maintenant : ${ROLE_LABEL[effective]}.`, { to: t.player });
      reply(game, p, `Rôle de ${t.name} : ${ROLE_LABEL[effective]}${effective !== role ? ' (imposé par ADMIN_NAMES)' : ''}.`);
    },
  },
};

/**
 * Run a staff command. Returns true when the command exists AND the player may use it; false otherwise
 * (the caller then answers "Commande inconnue", so regular players cannot discover staff commands).
 */
export function handleGmCommand(game, p, cmd, rest) {
  if (!game.security || !Object.prototype.hasOwnProperty.call(COMMANDS, cmd)) return false;
  let def = COMMANDS[cmd];
  if (def.alias) def = COMMANDS[def.alias];
  const role = game.security.roleOf(p);
  if (RANK[role] < RANK[def.role]) return false;
  def.run(game, p, rest);
  return true;
}

export const isStaffCommand = (cmd) => Object.prototype.hasOwnProperty.call(COMMANDS, cmd);
