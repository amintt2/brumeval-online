// Chat moderation and GM / admin commands through Game.handleMessage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeChat } from '../src/chat.js';
import { calmCaps, collapseRuns, hasForbiddenLink } from '../src/security/chatmod.js';
import { Security } from '../src/security/index.js';
import { Game } from '../src/game.js';
import { mulberry32 } from '../../shared/noise.js';
import { FakeSession, addPlayer, place } from './helpers.js';

/** Game with manual clocks (game + security wall clock) and ADMIN_NAMES = Amin. */
function makeModGame() {
  const clockRef = { t: 100_000 };
  const wall = { t: 1_700_000_000_000 };
  const security = new Security({ clock: () => wall.t, config: { adminNames: ['amin'] } });
  const game = new Game({ clock: () => clockRef.t, rng: mulberry32(1), spawnMonsters: false, security });
  game.clockRef = clockRef;
  game.wall = wall;
  return game;
}

const say = (game, p, text) => game.handleMessage(p, { t: 'chat', text });
const lastSystem = (p) => p.session.last('chat', (c) => c.ch === 'system')?.text;
const globals = (p) => p.session.of('chat', (c) => c.ch === 'global');
const wait = (game, ms) => { game.clockRef.t += ms; game.wall.t += ms; };

test('sanitizing: control, bidi, zero-width and zalgo characters; caps and character runs', () => {
  assert.equal(sanitizeChat('a\u200bb\u200dc\ufeffd\u2060e'), 'abcde');
  assert.equal(sanitizeChat('x\u202ey'), 'x y');
  assert.equal(sanitizeChat('e\u0301\u0301\u0301\u0301\u0301'), 'e\u0301\u0301');
  assert.equal(sanitizeChat('<b>salut</b> & "toi"'), '<b>salut</b> & "toi"', 'no HTML escaping server-side');
  assert.equal(calmCaps('ACHETEZ MES POTIONS PAS CHERES'), 'Achetez mes potions pas cheres');
  assert.equal(calmCaps('OK GG'), 'OK GG', 'short shouts are fine');
  assert.equal(collapseRuns('noooooooooooon !!!!!!!!'), 'nooooon !!!!!');
  assert.ok(hasForbiddenLink('va sur http://site-louche.ru', []));
  assert.ok(hasForbiddenLink('discord.gg/abcd', []));
  assert.ok(!hasForbiddenLink('https://brumel.mciut.fr/aide', ['brumel.mciut.fr']));
  assert.ok(!hasForbiddenLink('Salut, de rien. Oui, me voilà !', []));
});

test('link filter, repeated messages and flood lead to an automatic mute (escalating, persisted on the account)', () => {
  const game = makeModGame();
  const a = addPlayer(game, { name: 'Bavard' });
  const b = addPlayer(game, { name: 'Lecteur' });
  say(game, a, 'rejoignez mon serveur www.autre-jeu.com');
  assert.equal(globals(b).length, 0);
  assert.match(a.session.last('err').msg, /liens/);
  say(game, a, 'bonjour');
  say(game, a, 'Bonjour !');
  say(game, a, 'BONJOUR');                   // same message a 3rd time within 30 s
  assert.equal(globals(b).length, 2);
  assert.match(a.session.last('err').msg, /répéter/);
  wait(game, 6000);
  for (let i = 0; i < 6; i++) say(game, a, `message ${i}`); // 6th = flood: 3rd strike within a minute
  assert.ok(a.account.muteUntil > game.wall.t, 'muted');
  assert.match(lastSystem(a), /réduit au silence pendant 2 min pour spam/);
  wait(game, 6000);
  b.session.clear();
  say(game, a, 'je peux parler ?');
  say(game, a, '/w Lecteur psst');
  assert.equal(b.session.of('chat').length, 0);
  assert.match(a.session.last('err').msg, /réduit au silence encore/);
  say(game, a, '/who');                     // commands still work while muted
  assert.match(lastSystem(a), /joueurs en ligne/);
  wait(game, 2 * 60_000);
  say(game, a, 'de retour');
  assert.equal(globals(b).length, 1);
  assert.equal(a.account.muteUntil, undefined);
  assert.equal(a.account.muteCount, 1, 'next automatic mute will be longer');
  assert.ok(game.security.flagsOf('Bavard').some((f) => f.code === 'chat_spam'));
});

test('/ignore and /unignore hide global messages and whispers', () => {
  const game = makeModGame();
  const a = addPlayer(game, { name: 'Troll' });
  const b = addPlayer(game, { name: 'Calme' });
  say(game, b, '/ignore troll');
  assert.match(lastSystem(b), /Vous ignorez désormais Troll/);
  say(game, a, 'coucou');
  say(game, a, '/w Calme tu m\'entends ?');
  assert.equal(b.session.of('chat', (c) => c.from === 'Troll').length, 0);
  assert.ok(a.session.last('chat', (c) => c.ch === 'whisper_out'), 'the sender is not told');
  say(game, b, '/ignore');
  assert.match(lastSystem(b), /Joueurs ignorés \(1\) : troll/);
  say(game, b, '/ignore Calme');
  assert.match(b.session.last('err').msg, /vous-même/);
  say(game, b, '/ignore Inconnu');
  assert.equal(b.session.last('err').code, 'no_target');
  assert.deepEqual(b.account.ignore, ['troll']);
  say(game, b, '/unignore Troll');
  wait(game, 6000);
  say(game, a, 'et maintenant ?');
  assert.equal(b.session.last('chat', (c) => c.ch === 'global').from, 'Troll');
});

test('staff commands are unknown for regular players (same answer as a typo)', () => {
  const game = makeModGame();
  const p = addPlayer(game, { name: 'Curieux' });
  const v = addPlayer(game, { name: 'Victime' });
  for (const cmd of ['/kick Victime', '/ban Victime 1h', '/banip Victime', '/unban Victime', '/mute Victime 1h', '/unmute Victime',
    '/tp 10 10', '/tp Victime', '/tpto Victime', '/announce coucou', '/inspect Victime', '/role Curieux admin', '/mj', '/bans']) {
    wait(game, 1100);
    p.session.clear();
    say(game, p, cmd);
    assert.match(lastSystem(p), /^Commande inconnue : \//, cmd);
  }
  assert.equal(v.session.kicked, null);
  assert.equal(game.security.accountBan('Victime'), null);
  assert.equal(p.account.role, undefined);
});

test('admin (ADMIN_NAMES): kick, ban with duration, unban, mute, inspect with IP, /who with IPs, journal', () => {
  const game = makeModGame();
  const admin = addPlayer(game, { name: 'Amin' });
  const t = addPlayer(game, { name: 'Tricheur' });
  admin.session.ip = '198.51.100.1';
  t.session.ip = '198.51.100.66';
  game.security.onEnter(t);

  say(game, admin, '/mj');
  assert.ok(admin.session.of('chat').some((c) => c.text.startsWith('/kick')));
  say(game, admin, '/help');
  assert.match(lastSystem(admin), /Commandes de modération : tapez \/mj/);

  say(game, admin, '/who');
  assert.match(lastSystem(admin), /Tricheur \(Guerrier niv\. 1\) \[198\.51\.100\.66\]/);

  game.security.flag(t, 'speed', 3, { d: 9 });
  say(game, admin, '/inspect tricheur');
  const lines = admin.session.of('chat').slice(-7).map((c) => c.text).join('\n');
  assert.match(lines, /Suspicion : 3\.0 \(compte\)/);
  assert.match(lines, /IP : 198\.51\.100\.66/);
  assert.match(lines, /Signalements récents : speed/);

  say(game, admin, '/mute Tricheur 10m insultes');
  assert.ok(t.account.muteUntil - game.wall.t === 600_000);
  assert.match(lastSystem(t), /réduit au silence pour 10 min par un maître du jeu\. Raison : insultes\./);
  say(game, admin, '/unmute Tricheur');
  assert.equal(t.account.muteUntil, undefined);

  say(game, admin, '/ban Tricheur 2h speedhack répété');
  const ban = game.security.accountBan('Tricheur');
  assert.equal(ban.until - game.wall.t, 7_200_000);
  assert.equal(ban.reason, 'speedhack répété');
  assert.equal(ban.author, 'Amin');
  assert.match(t.session.kicked, /Ce compte est banni encore 2 h\. Raison : speedhack répété\./);
  say(game, admin, '/bans');
  assert.match(lastSystem(admin), /Tricheur — encore 2 h — par Amin — speedhack répété/);
  say(game, admin, '/unban tricheur');
  assert.equal(game.security.accountBan('Tricheur'), null);

  const k = addPlayer(game, { name: 'Genant' });
  say(game, admin, '/kick Genant spam');
  assert.match(k.session.kicked, /expulsé par un maître du jeu\. Raison : spam\./);
  say(game, admin, '/kick Amin');
  assert.match(admin.session.last('err').msg, /vous-même/);

  const gmEntries = game.security.seclog.recent((e) => e.type === 'gm', 50).map((e) => e.cmd);
  for (const c of ['kick', 'ban', 'unban', 'mute', 'unmute', 'inspect']) assert.ok(gmEntries.includes(c), c);
});

test('/banip bans the address (admins only), kicks everyone on it and refuses loopback addresses', () => {
  const game = makeModGame();
  const admin = addPlayer(game, { name: 'Amin' });
  const a = addPlayer(game, { name: 'Multi1' });
  const b = addPlayer(game, { name: 'Multi2' });
  a.session.ip = '203.0.113.9';
  b.session.ip = '203.0.113.9';
  say(game, admin, '/banip Multi1 3j comptes multiples');
  assert.ok(a.session.kicked && b.session.kicked);
  const ban = game.security.ipBan('203.0.113.9');
  assert.equal(ban.until - game.wall.t, 3 * 86_400_000);
  const local = addPlayer(game, { name: 'Local' });
  local.session.ip = '127.0.0.1';
  say(game, admin, '/banip Local');
  assert.match(admin.session.last('err').msg, /adresse locale/);
  say(game, admin, '/unban 203.0.113.9');
  assert.equal(game.security.ipBan('203.0.113.9'), null);
});

test('GM role: granted with /role, cannot sanction staff nor use admin-only commands; teleports', () => {
  const game = makeModGame();
  const admin = addPlayer(game, { name: 'Amin' });
  const gm = addPlayer(game, { name: 'Gardienne' });
  const p = addPlayer(game, { name: 'Perdu' });
  place(game, admin, 0, 7);
  place(game, gm, 50, 25);
  place(game, p, -60, -8);
  say(game, admin, '/role Gardienne mj');
  assert.equal(gm.account.role, 'gm');
  assert.match(lastSystem(gm), /maître du jeu/);

  say(game, gm, '/kick Amin');
  assert.match(gm.session.last('err').msg, /membre de l'équipe/);
  say(game, gm, '/banip Perdu');
  assert.match(lastSystem(gm), /^Commande inconnue/);
  say(game, gm, '/role Perdu admin');
  assert.match(lastSystem(gm), /^Commande inconnue/);

  // /tp x z
  say(game, gm, '/tp 60 30');
  assert.ok(Math.hypot(gm.x - 60, gm.z - 30) < 8);
  assert.deepEqual(gm.session.last('correct'), { t: 'correct', x: gm.x, z: gm.z });
  say(game, gm, '/tp 500 0');
  assert.match(gm.session.last('err').msg, /hors du monde/);
  // /tpto nom
  say(game, gm, '/tpto Perdu');
  assert.ok(Math.hypot(gm.x - p.x, gm.z - p.z) < 5);
  // /tp nom (summon)
  place(game, gm, 50, 25);
  say(game, gm, '/tp Perdu');
  assert.ok(Math.hypot(gm.x - p.x, gm.z - p.z) < 5);
  assert.match(lastSystem(p), /téléporté auprès de Gardienne/);
  // the teleported player's in-flight moves are not flagged
  game.clockRef.t += 50;
  game.handleMessage(p, { t: 'move', x: -59.6, z: -8 });
  assert.equal(game.security.stats.flags, 0);

  // /announce reaches everyone as a notification
  say(game, gm, '/announce Redémarrage du serveur dans 5 minutes');
  for (const o of [admin, gm, p]) assert.equal(o.session.last('notify').text, 'Annonce : Redémarrage du serveur dans 5 minutes');

  say(game, admin, '/role Gardienne joueur');
  assert.equal(gm.account.role, undefined);
  wait(game, 1100);
  say(game, gm, '/mj');
  assert.match(lastSystem(gm), /^Commande inconnue/);
});

test('offline targets: ban and mute an account that is not connected', () => {
  const game = makeModGame();
  const accounts = new Map();
  game.store = {
    get: (n) => accounts.get(String(n).toLowerCase()) || null,
    has: (n) => accounts.has(String(n).toLowerCase()),
    markDirty() {},
  };
  accounts.set('absent', { name: 'Absent', cls: 'mage', level: 3, lastIp: '198.51.100.40' });
  const admin = addPlayer(game, { name: 'Amin' });
  say(game, admin, '/ban Absent');
  assert.equal(game.security.accountBan('absent').until, null, 'permanent by default');
  say(game, admin, '/mute Absent 1j');
  assert.ok(accounts.get('absent').muteUntil > game.wall.t);
  say(game, admin, '/banip Absent 1h');
  assert.ok(game.security.ipBan('198.51.100.40'));
  say(game, admin, '/inspect Absent');
  assert.ok(admin.session.of('chat').some((c) => /Absent \(Mage niv\. 3, joueur\) — hors ligne/.test(c.text)));
  assert.ok(admin.session.of('chat').some((c) => /Bannissement : définitivement/.test(c.text)));
});

test('a kicked FakeSession / closed session is not kicked twice', () => {
  const s = new FakeSession();
  s.kick('a');
  s.kick('b');
  assert.equal(s.of('kick').length, 1);
});
