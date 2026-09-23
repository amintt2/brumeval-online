// Unit tests of the security core (server/src/security): rate limits, validation, IP / Origin, names,
// bans, journal, suspicion scores and escalation, login throttling, invariants.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TokenBucket, TypeLimiter, Backoff, WindowCounter } from '../src/security/ratelimit.js';
import { validateC2S, checkStructure } from '../src/security/validate.js';
import { clientIp, normalizeIp, originAllowed, isLoopback } from '../src/security/connection.js';
import { nameProblem, confusableKey } from '../src/security/names.js';
import { BanStore } from '../src/security/bans.js';
import { SecurityLog } from '../src/security/seclog.js';
import { Security } from '../src/security/index.js';
import { loadSecurityConfig } from '../src/security/config.js';
import { checkPlayerInvariants } from '../src/security/invariants.js';
import { parseDuration, formatDuration } from '../src/security/format.js';
import { sanitizeSecurityFields } from '../src/security/accountFields.js';
import { sanitizeAccount, newAccount, newCharacter } from '../src/persistence.js';
import { makeGame, addPlayer, FakeSession } from './helpers.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-sec-'));

test('token bucket: burst then sustained rate', () => {
  const b = new TokenBucket(10, 5, 0);
  for (let i = 0; i < 5; i++) assert.ok(b.take(0));
  assert.equal(b.take(0), false);
  assert.ok(b.take(100));   // +1 token after 100 ms
  assert.equal(b.take(100), false);
  assert.ok(b.level(10_000) <= 5);
  const t = new TypeLimiter({ move: [1, 2], default: [1, 1] });
  assert.ok(t.allow('move', 0) && t.allow('move', 0));
  assert.equal(t.allow('move', 0), false);
  assert.ok(t.allow('dodge', 0));   // unknown types share the default bucket
  assert.equal(t.allow('sprint', 0), false);
});

test('backoff: free failures, then exponential lock, forgotten after a while', () => {
  const b = new Backoff({ free: 3, baseMs: 1000, maxMs: 8000, forgetMs: 60_000 });
  for (let i = 0; i < 3; i++) b.fail('k', 0);
  assert.equal(b.blockedFor('k', 0), 0);
  b.fail('k', 0);
  assert.equal(b.blockedFor('k', 0), 1000);
  b.fail('k', 1000);
  assert.equal(b.blockedFor('k', 1000), 2000);
  for (let i = 0; i < 10; i++) b.fail('k', 2000);
  assert.equal(b.blockedFor('k', 2000), 8000);  // capped
  assert.equal(b.blockedFor('k', 70_000), 0);   // forgotten
  assert.equal(b.failures('k', 70_000), 0);
  const w = new WindowCounter(2, 1000);
  w.add('ip', 0); w.add('ip', 10);
  assert.equal(w.allowed('ip', 500), false);
  assert.ok(w.allowed('ip', 1001));
});

test('message validation: schemas of known types, generic limits, prototype pollution keys', () => {
  assert.equal(validateC2S({ t: 'move', x: 1.5, z: -3, ry: 0.2 }), null);
  assert.equal(validateC2S({ t: 'move', x: 'a', z: 1 }), 'bad_field:x');
  assert.equal(validateC2S({ t: 'move', x: 1e9, z: 1 }), 'bad_field:x');
  assert.equal(validateC2S({ t: 'move', x: 1, z: 1, ry: 'x' }), 'bad_field:ry');
  assert.equal(validateC2S({ t: 'ability', slot: 0, tg: 12 }), null);
  assert.equal(validateC2S({ t: 'ability', slot: 0, tg: 0 }), null);
  assert.equal(validateC2S({ t: 'ability', slot: 9 }), 'bad_field:slot');
  assert.equal(validateC2S({ t: 'ability', slot: 1.5 }), 'bad_field:slot');
  assert.equal(validateC2S({ t: 'ability', slot: 1, tg: -4 }), 'bad_field:tg');
  assert.equal(validateC2S({ t: 'use_item', slot: 24 }), 'bad_field:slot');
  assert.equal(validateC2S({ t: 'buy', id: 3, item: 'potion_hp_s', qty: -2 }), 'bad_field:qty');
  assert.equal(validateC2S({ t: 'buy', id: 3, item: 'potion_hp_s', qty: NaN }), 'bad_number');
  assert.equal(validateC2S({ t: 'buy', id: 3, item: 'potion_hp_s' }), null);
  assert.equal(validateC2S({ t: 'sell', id: 3, slot: 2, qty: 1e12 }), 'bad_field:qty');
  assert.equal(validateC2S({ t: 'login', name: { $gt: '' }, password: 'x' }), 'bad_field:name');
  assert.equal(validateC2S({ t: 'chat', text: 'x'.repeat(801) }), 'string_too_long');
  assert.equal(validateC2S(JSON.parse('{"t":"move","x":1,"z":2,"__proto__":{"admin":true}}')), 'forbidden_key');
  assert.equal(validateC2S({ t: 'dodge', dx: 1, dz: 0, extra: { constructor: 1 } }), 'forbidden_key');
  assert.equal(validateC2S({ t: 'x', a: { b: { c: { d: 1 } } } }), 'too_deep');
  assert.equal(validateC2S({ t: 'x', big: 'y'.repeat(300) }), 'string_too_long');
  assert.equal(validateC2S({ t: 'x', list: new Array(40).fill(1) }), 'array_too_long');
  const many = { t: 'x' };
  for (let i = 0; i < 20; i++) many[`k${i}`] = i;
  assert.equal(validateC2S(many), 'too_many_keys');
  // unknown (future) message types pass the generic rules
  assert.equal(validateC2S({ t: 'sprint', on: true }), null);
  assert.equal(validateC2S({ t: 'emote', e: 'wave' }), null);
  assert.equal(checkStructure({ a: [1, 'b', null, true] }), null);
  assert.ok(!('admin' in {}), 'no prototype was polluted');
});

test('client IP: X-Forwarded-For only with TRUST_PROXY, rightmost trusted hop; IPv4-mapped addresses', () => {
  const req = (remote, xff) => ({ socket: { remoteAddress: remote }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(normalizeIp('::ffff:10.0.0.5'), '10.0.0.5');
  assert.equal(normalizeIp('[::1]'), '::1');
  assert.equal(clientIp(req('::ffff:127.0.0.1', '6.6.6.6'), 0), '127.0.0.1');
  assert.equal(clientIp(req('127.0.0.1', '6.6.6.6, 1.2.3.4'), 1), '1.2.3.4');   // the client forged 6.6.6.6
  assert.equal(clientIp(req('127.0.0.1', '6.6.6.6, 1.2.3.4, 10.0.0.2'), 2), '1.2.3.4');
  assert.equal(clientIp(req('127.0.0.1', 'pas une ip'), 1), '127.0.0.1');
  assert.equal(clientIp(req('127.0.0.1'), 1), '127.0.0.1');
  assert.ok(isLoopback('127.0.0.1') && isLoopback('::1') && !isLoopback('10.0.0.1'));
});

test('Origin allow-list', () => {
  const cfg = loadSecurityConfig({ allowNoOrigin: false }, {});
  assert.ok(originAllowed('https://brumel.mciut.fr', 'brumel.mciut.fr', cfg));
  assert.ok(originAllowed('https://brumel.mciut.fr/', 'autre', cfg));
  assert.ok(originAllowed('http://localhost:5173', 'localhost:3000', cfg));
  assert.ok(originAllowed('http://127.0.0.1:5201', 'x', cfg));
  assert.ok(originAllowed('http://192.168.1.20:3000', '192.168.1.20:3000', cfg), 'same host');
  assert.ok(!originAllowed('https://evil.example', 'brumel.mciut.fr', cfg));
  assert.ok(!originAllowed('null', 'brumel.mciut.fr', cfg));
  assert.ok(!originAllowed(undefined, 'brumel.mciut.fr', cfg));
  assert.ok(originAllowed(undefined, 'x', { ...cfg, allowNoOrigin: true }));
  assert.ok(originAllowed('https://evil.example', 'x', { ...cfg, allowedOrigins: ['*'] }));
  const env = loadSecurityConfig({}, { ALLOWED_ORIGINS: 'https://a.fr, https://b.fr', ALLOW_LOCALHOST_ORIGINS: '0', ALLOW_NO_ORIGIN: '1', TRUST_PROXY: '1', ADMIN_NAMES: 'Amin, Zoé' });
  assert.deepEqual(env.allowedOrigins, ['https://a.fr', 'https://b.fr']);
  assert.ok(!originAllowed('http://localhost:5173', 'x', env));
  assert.ok(env.allowNoOrigin && env.trustProxy === 1);
  assert.deepEqual(env.adminNames, ['amin', 'zoé']);
});

test('name filter: reserved words, insults, look-alikes; ordinary names pass', () => {
  for (const ok of ['Sigmund', 'Hamjo', 'Monique', 'Dominique', 'Député', 'Siegfried', 'Nazira', 'Claude', 'Modou', 'BotAlpha', 'BotBêta', 'Élodie', 'Zoë_42', 'Aline', 'Bérénice', 'Constance', 'Montenegro', 'Scunthorp', 'Computer']) {
    assert.equal(nameProblem(ok), null, ok);
  }
  for (const [bad, why] of [['Admin', 'reserved'], ['GM_Bob', 'reserved'], ['GMBob', 'reserved'], ['BobMJ', 'reserved'], ['Modo_Luc', 'reserved'],
    ['Brumeval', 'reserved'], ['Adm1n', 'reserved'], ['Moderateur', 'reserved'], ['__proto__', 'reserved'], ['constructor', 'reserved'],
    ['Connard', 'offensive'], ['FuckYou', 'offensive'], ['sal0pe', 'offensive'], ['Gros_Con', 'offensive'], ['Hitler88', 'offensive'], ['PD_du_42', 'offensive']]) {
    assert.equal(nameProblem(bad), why, bad);
  }
  assert.equal(confusableKey('Élodie'), confusableKey('elodie'));
  assert.equal(confusableKey('Bob_1'), confusableKey('BobI'));
  assert.equal(confusableKey('B0b'), confusableKey('bob'));
  assert.notEqual(confusableKey('Bob'), confusableKey('Rob'));
});

test('durations: parsing and French formatting', () => {
  assert.equal(parseDuration('30m'), 30 * 60_000);
  assert.equal(parseDuration('2h'), 7_200_000);
  assert.equal(parseDuration('3j'), 3 * 86_400_000);
  assert.equal(parseDuration('1sem'), 7 * 86_400_000);
  assert.equal(parseDuration('90'), 90 * 60_000);
  assert.equal(parseDuration('perm'), null);
  assert.equal(parseDuration('triche'), undefined);
  assert.equal(parseDuration('0h'), undefined);
  assert.equal(formatDuration(45_000), '45 s');
  assert.equal(formatDuration(12 * 60_000), '12 min');
  assert.equal(formatDuration(125 * 60_000), '2 h 5 min');
  assert.equal(formatDuration(3 * 86_400_000), '3 j');
});

test('bans: account / IP, expiry, persistence in bans.json, corrupted file kept aside', () => {
  const dir = tmp();
  try {
    let now = 1_000_000;
    const clock = () => now;
    const bans = new BanStore({ dataDir: dir, clock });
    bans.banAccount('Tricheur', { durationMs: 3_600_000, reason: 'speedhack', author: 'Amin' });
    bans.banIp('1.2.3.4', { durationMs: null, reason: 'bot', author: 'Amin' });
    assert.ok(bans.accountBan('TRICHEUR', now));
    assert.ok(bans.ipBan('1.2.3.4', now));
    assert.equal(bans.ipBan('1.2.3.5', now), null);
    const reloaded = new BanStore({ dataDir: dir, clock });
    assert.equal(reloaded.accountBan('tricheur', now).reason, 'speedhack');
    assert.equal(reloaded.ipBan('1.2.3.4', now).until, null);
    now += 3_600_001;
    assert.equal(reloaded.accountBan('tricheur', now), null, 'expired');
    assert.equal(reloaded.active(now).length, 1);
    assert.equal(new BanStore({ dataDir: dir, clock }).bans.length, 1, 'expired bans pruned from the file');
    assert.equal(reloaded.remove('ip', '1.2.3.4'), 1);
    assert.equal(new BanStore({ dataDir: dir, clock }).bans.length, 0);
    // automatic offences are counted
    reloaded.add('account', 'X', { durationMs: 1000, auto: true });
    reloaded.add('account', 'X', { durationMs: 1000, auto: true });
    assert.equal(new BanStore({ dataDir: dir, clock }).offenseCount('x'), 2);
    fs.writeFileSync(path.join(dir, 'bans.json'), '{ pas du json');
    const broken = new BanStore({ dataDir: dir, clock, log: { error() {} } });
    assert.equal(broken.bans.length, 0);
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('bans.json.corrompu-')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('security journal: JSONL lines, throttled repeats, size rotation', () => {
  const dir = tmp();
  try {
    let now = 0;
    const log = new SecurityLog({ dataDir: dir, maxBytes: 64 * 1024, keep: 2, clock: () => now });
    assert.ok(log.write({ type: 'flag', code: 'speed', name: 'A' }, 'k'));
    assert.equal(log.write({ type: 'flag', code: 'speed', name: 'A' }, 'k'), false);
    now += 2500;
    log.write({ type: 'flag', code: 'speed', name: 'A' }, 'k');
    const lines = fs.readFileSync(path.join(dir, 'security.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[1].suppressed, 1);
    assert.ok(lines[0].ts.endsWith('Z'));
    for (let i = 0; i < 2000; i++) log.write({ type: 'gm', by: 'Amin', cmd: 'tp', pad: 'x'.repeat(60) });
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('security.log')).sort();
    assert.deepEqual(files, ['security.log', 'security.log.1', 'security.log.2']);
    assert.ok(fs.statSync(path.join(dir, 'security.log')).size <= 64 * 1024);
    assert.equal(log.recent((e) => e.type === 'gm', 3).length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('suspicion: scores decay, warn -> kick -> temporary ban for repeat offenders (doubling)', () => {
  let now = 5_000_000;
  const warns = [];
  const sec = new Security({ clock: () => now, log: { warn: (m) => warns.push(m), info() {}, error() {} }, config: { warnAt: 10, kickAt: 30, banAfterKicks: 2, autoBanMs: 60_000, scoreHalfLifeMs: 60_000 } });
  const game = makeGame();
  sec.attach(game);
  const p = addPlayer(game, { name: 'Suspect' });
  assert.equal(sec.flag(p, 'speed', 4), 4);
  now += 60_000;
  assert.ok(Math.abs(sec.scoreOf({ name: 'Suspect' }) - 2) < 1e-9, 'halved after one half-life');
  sec.flag(p, 'speed', 9);
  assert.ok(warns.some((w) => w.includes('Suspect')), 'warning logged');
  assert.equal(p.session.kicked, null);
  sec.flag(p, 'teleport', 25);
  assert.ok(p.session.kicked, 'kicked at kickAt');
  assert.equal(sec.accountBan('Suspect'), null, 'first strike: no ban');
  // reconnects and cheats again: second strike -> automatic temporary ban
  const s2 = new FakeSession();
  p.session = s2;
  sec.flag(p, 'teleport', 30);
  const ban = sec.accountBan('Suspect');
  assert.ok(ban && ban.auto && ban.until - now === 60_000);
  assert.match(s2.kicked, /banni temporairement/);
  // next automatic ban lasts twice as long
  now += 61_000;
  const s3 = new FakeSession();
  p.session = s3;
  sec.flag(p, 'teleport', 60);
  const s4 = new FakeSession();
  p.session = s4;
  sec.flag(p, 'teleport', 60);
  assert.equal(sec.accountBan('Suspect').until - now, 120_000);
  assert.deepEqual(sec.flagsOf('Suspect')[0].code, 'teleport');
  // staff are never sanctioned automatically
  const admin = addPlayer(game, { name: 'Gardien', role: 'admin' });
  sec.flag(admin, 'teleport', 100);
  assert.equal(admin.session.kicked, null);
});

test('flags on pre-auth sessions and IPs; loopback addresses are not scored per IP', () => {
  const sec = new Security({ config: { kickAt: 20 }, clock: () => 1_000_000 }); // fixed clock: no decay between two reads
  const s = new FakeSession('198.51.100.9');
  sec.flag(s, 'bad_packet', 5);
  assert.equal(sec.scoreOf({ ip: '198.51.100.9' }), 5);
  sec.flag(s, 'bad_packet', 20);
  assert.ok(s.kicked);
  const local = new FakeSession('127.0.0.1');
  sec.flag(local, 'bad_packet', 25);
  assert.equal(sec.scoreOf({ ip: '127.0.0.1' }), 0);
  assert.ok(local.kicked, 'the session itself is still kicked');
});

test('login throttling per account and per IP (generic answer), registration limit per IP', () => {
  let now = 0;
  const sec = new Security({ clock: () => now, config: { loginFreeFailsAccount: 3, loginFreeFailsIp: 5, loginBackoffBaseMs: 1000, accountsPerIpPerHour: 2 } });
  const s = new FakeSession('198.51.100.20');
  for (let i = 0; i < 3; i++) sec.loginFailed(s, 'Victime');
  assert.equal(sec.loginBlockedFor(s.ip, 'victime'), 0);
  sec.loginFailed(s, 'Victime');
  assert.equal(sec.loginBlockedFor(s.ip, 'VICTIME'), 1000);
  assert.equal(sec.loginBlockedFor('198.51.100.99', 'Victime'), 1000, 'the account is protected from every IP');
  assert.equal(sec.loginBlockedFor(s.ip, 'Autre'), 0);
  // a non-existing name behaves exactly the same (no enumeration)
  for (let i = 0; i < 4; i++) sec.loginFailed(s, 'Personne');
  assert.equal(sec.loginBlockedFor('203.0.113.50', 'Personne'), 1000);
  // the IP itself gets locked after its own free failures, whatever the name
  sec.loginFailed(s, 'Encore');
  assert.ok(sec.loginBlockedFor(s.ip, 'Nouveau') > 0);
  now += 60 * 60_000;
  assert.equal(sec.loginBlockedFor(s.ip, 'Victime'), 0, 'forgotten after a quiet period');
  sec.loginSucceeded(s, 'Victime');
  // registrations
  assert.ok(sec.canRegister(s.ip));
  sec.registered(s, 'A'); sec.registered(s, 'B');
  assert.equal(sec.canRegister(s.ip), false);
  assert.ok(sec.canRegister('127.0.0.1'), 'loopback exempt');
  now += 3_600_001;
  assert.ok(sec.canRegister(s.ip));
});

test('connections per IP and IP bans at connection time', () => {
  const sec = new Security({ config: { maxConnPerIp: 2 } });
  sec.connOpened('198.51.100.1');
  sec.connOpened('198.51.100.1');
  assert.match(sec.connectionRefusal('198.51.100.1'), /Trop de connexions/);
  assert.equal(sec.connectionRefusal('198.51.100.2'), null);
  sec.connClosed('198.51.100.1');
  assert.equal(sec.connectionRefusal('198.51.100.1'), null);
  for (let i = 0; i < 10; i++) sec.connOpened('127.0.0.1');
  assert.equal(sec.connectionRefusal('127.0.0.1'), null, 'loopback exempt (reverse proxy without TRUST_PROXY)');
  sec.bans.banIp('198.51.100.2', { durationMs: 60_000, reason: 'robot' });
  assert.match(sec.connectionRefusal('198.51.100.2'), /Votre adresse est bannie encore 1 min\. Raison : robot\./);
});

test('refused-action spam (out of range, cooldown, bad requests) is flagged', () => {
  const game = makeGame();
  const p = addPlayer(game, { name: 'Spammeur' });
  for (let i = 0; i < 15; i++) game.error(p, 'out_of_range', 'Cible hors de portée');
  assert.equal(game.security.stats.flags, 0, 'a few refusals are normal');
  game.error(p, 'out_of_range', 'Cible hors de portée');
  assert.equal(game.security.flagsOf('Spammeur')[0].code, 'range_spam');
  for (let i = 0; i < 16; i++) game.error(p, 'cooldown', 'Capacité en recharge');
  assert.equal(game.security.flagsOf('Spammeur')[0].code, 'cooldown_spam');
  game.clockRef.t += 20_000;
  for (let i = 0; i < 10; i++) game.error(p, 'bad_request', 'x');
  assert.equal(game.security.flagsOf('Spammeur')[0].code, 'cooldown_spam', 'window slid');
});

test('economy invariants: detected after each action; strict mode throws, production repairs', () => {
  const game = makeGame();
  const p = addPlayer(game, { name: 'Marchand' });
  assert.deepEqual(checkPlayerInvariants(p), []);
  const shared = { id: 'potion_hp_s', q: 2 };
  p.inv[5] = shared; p.inv[6] = shared;         // aliased stack (duplication)
  p.inv[7] = { id: 'potion_hp_s', q: 99 };      // over the stack size
  p.inv[8] = { id: 'n_existe_pas', q: 1 };
  p.inv[9] = { id: 'steel_sword', q: 2 };       // equipment never stacks
  p.gold = -5;
  assert.throws(() => game.handleMessage(p, { t: 'stop' }), /invariant/, 'strict under node --test');
  const problems = checkPlayerInvariants(p, { maxGold: 1000 });
  assert.equal(problems.length, 5, problems.join());
  assert.equal(p.inv[6], null);
  assert.equal(p.inv[7].q, 20);
  assert.equal(p.inv[8], null);
  assert.equal(p.inv[9].q, 1);
  assert.equal(p.gold, 0);
  p.gold = 5e9;
  checkPlayerInvariants(p, { maxGold: 1000 });
  assert.equal(p.gold, 1000);
  p.gold = NaN;
  checkPlayerInvariants(p);
  assert.equal(p.gold, 0);
  // production mode: repaired and reported, never thrown
  const errors = [];
  const sec = new Security({ log: { error: (m) => errors.push(m), warn() {}, info() {} }, config: { strictInvariants: false } });
  sec.attach(game);
  p.gold = -1;
  sec.afterAction(p);
  assert.equal(p.gold, 0);
  assert.match(errors[0], /invariant violé pour Marchand/);
});

test('account moderation fields survive a save/load round trip and old saves load unchanged', () => {
  // a v0.2 (one character per account) record with moderation fields
  const acc = { ...newCharacter('Ancien', 'mage'), salt: 'aa', hash: 'bb', role: 'gm', muteUntil: 123, muteReason: 'spam', muteCount: 2, ignore: ['bob', 'bob', 42, 'alice'], lastIp: '1.2.3.4' };
  const a = sanitizeAccount(JSON.parse(JSON.stringify(acc)));
  assert.equal(a.role, 'gm', 'the role moves up to the account');
  assert.equal(a.lastIp, '1.2.3.4');
  const s = a.chars[0];
  assert.equal(s.role, 'gm');
  assert.equal(s.muteUntil, 123);
  assert.deepEqual(s.ignore, ['bob', 'alice']);
  assert.equal(s.lastIp, '1.2.3.4');
  const again = sanitizeAccount(JSON.parse(JSON.stringify(a)));
  assert.equal(again.role, 'gm');
  assert.deepEqual(again.chars[0].ignore, ['bob', 'alice']);
  const v1 = sanitizeAccount(newAccount('Vieux', 'mage', 'aa', 'bb'));
  for (const k of ['role', 'muteUntil', 'ignore', 'lastIp']) assert.ok(!(k in v1) && !(k in v1.chars[0]), k);
  assert.deepEqual(sanitizeSecurityFields({ role: 'superadmin', muteUntil: 'demain' }), {});
});
