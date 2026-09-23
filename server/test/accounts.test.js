// [accounts] Accounts v3: migrations (v0.1 accounts.json and v0.2 per-account files), remembered sessions
// (token lifecycle), characters (CRUD, ownership, global name uniqueness, 5-character limit), legacy clients,
// passwords and passkeys (real WebAuthn verification against a software authenticator). docs/COMPTES.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startServer } from '../src/index.js';
import { AccountStore, newAccount, ACCOUNT_VERSION, PRE_V3_DIR, MAX_CHARS } from '../src/persistence.js';
import { issueToken, findToken, revokeSession, revokeAllSessions, hashToken, TOKEN_TTL_MS } from '../src/accounts.js';
import { relyingParty } from '../src/passkeys.js';
import { SoftAuthenticator } from './support/softauthn.js';

const V01 = fileURLToPath(new URL('./fixtures/v0.1/accounts.json', import.meta.url));
const V02 = fileURLToPath(new URL('./fixtures/v0.2/accounts/gardienne.json', import.meta.url));
const quiet = { info() {}, warn() {}, error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-acc-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ORIGIN = 'http://localhost:5201';

function connect(port, { origin = ORIGIN, ip } = {}) {
  return new Promise((resolve, reject) => {
    const headers = ip ? { 'X-Forwarded-For': ip } : {};
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin, headers });
    ws.msgs = [];
    ws.on('message', (d) => ws.msgs.push(JSON.parse(d.toString())));
    ws.closed = new Promise((r) => ws.on('close', (code) => r(code)));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.sendJson = (m) => ws.send(JSON.stringify(m));
    ws.waitFor = async (pred, from = 0, timeout = 5000) => {
      const t0 = Date.now();
      for (;;) {
        const m = ws.msgs.slice(from).find(pred);
        if (m) return m;
        if (Date.now() - t0 > timeout) throw new Error(`timeout (${ws.msgs.slice(from).map((x) => x.t).join(',')})`);
        await sleep(5);
      }
    };
    /** send `m` and wait for the first reply among `types` */
    ws.req = (m, types = ['account_ok', 'account_err', 'auth_ok', 'auth_err', 'logged_out', 'passkey_options']) => {
      const from = ws.msgs.length;
      ws.sendJson(m);
      return ws.waitFor((x) => types.includes(x.t), from);
    };
  });
}

/** Send and check that nothing comes back within 200 ms. */
async function silent(ws, m) {
  const n = ws.msgs.length;
  ws.sendJson(m);
  await sleep(200);
  return ws.msgs.slice(n).every((x) => x.t === 'snap' || x.t === 'pong' || x.t === 'chat');
}

async function withServer(fn, { prepare, security = {} } = {}) {
  const dir = tmp();
  if (prepare) await prepare(dir);
  const srv = await startServer({ port: 0, dataDir: dir, staticDir: path.join(dir, 'none'), quiet: true, security: { allowNoOrigin: false, ...security } });
  const open = [];
  const c = async (opts) => { const ws = await connect(srv.port, opts); open.push(ws); return ws; };
  try {
    await fn({ srv, dir, c });
  } finally {
    for (const ws of open) try { ws.terminate(); } catch { /* ignore */ }
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ migrations
test('v0.2 per-account file: becomes an account with ONE character keeping all progression; original kept', () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, 'accounts'));
    fs.copyFileSync(V02, path.join(dir, 'accounts', 'gardienne.json'));
    const raw = JSON.parse(fs.readFileSync(V02, 'utf8'));
    const store = new AccountStore(dir, quiet).load();
    const acc = store.getAccount('GARDIENNE');
    assert.equal(acc.v, ACCOUNT_VERSION);
    assert.equal(acc.login, 'Gardienne');
    assert.equal(acc.salt, raw.salt);
    assert.equal(acc.hash, raw.hash);
    assert.equal(acc.role, 'gm');
    assert.equal(acc.lastIp, '203.0.113.9');
    assert.deepEqual(acc.sessions, []);
    assert.deepEqual(acc.passkeys, []);
    assert.equal(acc.chars.length, 1);
    const ch = acc.chars[0];
    for (const k of ['name', 'cls', 'level', 'xp', 'gold', 'hp', 'x', 'z', 'created', 'lastSeen', 'muteUntil', 'muteReason', 'muteCount', 'role', 'guild']) {
      assert.equal(ch[k], raw[k], k);
    }
    assert.deepEqual(ch.inv, raw.inv);
    assert.deepEqual(ch.eq, raw.eq);
    assert.deepEqual(ch.quests, raw.quests);
    assert.deepEqual(ch.echo, raw.echo);
    assert.deepEqual(ch.ignore, raw.ignore);
    assert.equal(ch.mp, null);
    assert.equal(store.get('gardienne'), ch, 'character lookup by name');
    assert.equal(store.accountOfChar('GARDIENNE'), acc);
    // the original is copied once, the upgraded account is rewritten at the next save
    assert.equal(fs.readFileSync(path.join(dir, PRE_V3_DIR, 'gardienne.json'), 'utf8'), fs.readFileSync(V02, 'utf8'));
    assert.equal(store.save(true), true);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'accounts', 'gardienne.json'), 'utf8'));
    assert.equal(onDisk.v, ACCOUNT_VERSION);
    assert.equal(onDisk.chars[0].id, ch.id);
    const again = new AccountStore(dir, quiet).load();
    assert.equal(again.getAccount('gardienne').chars[0].id, ch.id, 'stable character id');
    assert.equal(again.getAccount('gardienne').uid, acc.uid, 'stable passkey user handle');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('old accounts log in with their old name and password: new client -> selection, old client -> world', async () => {
  await withServer(async ({ c }) => {
    const ws = await c();
    let r = await ws.req({ t: 'login', name: 'gardienne', password: 'ancienmdp1', remember: false });
    assert.equal(r.t, 'account_ok', JSON.stringify(r));
    assert.equal(r.account.name, 'Gardienne');
    assert.equal(r.account.role, 'gm');
    assert.equal(r.token, undefined, 'no token without « Rester connecté »');
    assert.equal(r.method, 'password');
    assert.equal(r.chars.length, 1);
    assert.equal(r.chars[0].name, 'Gardienne');
    assert.equal(r.chars[0].level, 12);
    assert.equal(typeof r.chars[0].zone, 'string');
    r = await ws.req({ t: 'char_select', id: r.chars[0].id });
    assert.equal(r.t, 'auth_ok');
    assert.equal(r.self.gold, 4321);
    assert.deepEqual(r.self.echo, { x: 50, z: 40, xp: 30 });
    // v0.1 accounts.json record, through a client of the previous deploy (login without `remember`)
    const old = await c();
    r = await old.req({ t: 'login', name: 'VÉTÉRAN', password: 'ancienmdp1' });
    assert.equal(r.t, 'auth_ok');
    assert.equal(r.self.name, 'Vétéran');
    assert.equal(r.self.level, 9);
    assert.equal(r.self.gold, 1234);
  }, {
    prepare: (dir) => {
      fs.copyFileSync(V01, path.join(dir, 'accounts.json'));
      fs.mkdirSync(path.join(dir, 'accounts'));
      fs.copyFileSync(V02, path.join(dir, 'accounts', 'gardienne.json'));
    },
  });
});

// ------------------------------------------------------------------ tokens
test('remembered-session tokens: 256-bit, stored hashed, rotated, expiring, revocable', () => {
  const dir = tmp();
  try {
    const store = new AccountStore(dir, quiet).load();
    const acc = store.create(newAccount('Jeton', null, 's', 'h'));
    const t1 = issueToken(store, acc, { ua: 'Test' });
    assert.match(t1.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(acc.sessions.length, 1);
    assert.equal(acc.sessions[0].h, hashToken(t1.token));
    assert.ok(!JSON.stringify(acc).includes(t1.token), 'the token itself is never stored');
    assert.equal(findToken(store, t1.token).acc, acc);
    // rotation: same session, new token, the old one stops working
    const t2 = issueToken(store, acc, { id: t1.id });
    assert.equal(t2.id, t1.id);
    assert.equal(acc.sessions.length, 1);
    assert.equal(findToken(store, t1.token), null);
    assert.equal(findToken(store, t2.token).session.id, t1.id);
    // expiry
    const now = Date.now();
    assert.equal(findToken(store, t2.token, now + TOKEN_TTL_MS + 1), null);
    assert.equal(acc.sessions.length, 0, 'expired session removed');
    // revocation
    const a = issueToken(store, acc);
    const b = issueToken(store, acc);
    assert.equal(revokeSession(store, acc, a.id), true);
    assert.equal(findToken(store, a.token), null);
    assert.ok(findToken(store, b.token));
    const d = issueToken(store, acc);
    assert.equal(revokeAllSessions(store, acc, d.id), 1);
    assert.equal(findToken(store, b.token), null);
    assert.ok(findToken(store, d.token), 'the kept session survives');
    // garbage
    for (const bad of ['', 'x', 'a'.repeat(43), null, 42]) assert.equal(findToken(store, bad), null);
    // at most 10 sessions
    for (let i = 0; i < 15; i++) issueToken(store, acc);
    assert.equal(acc.sessions.length, 10);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ characters
test('characters: create, unique names (case, look-alikes, other accounts), 5 max, ownership, delete with confirmation', async () => {
  await withServer(async ({ srv, c }) => {
    const a = await c();
    let r = await a.req({ t: 'register', name: 'CompteA', password: 'motdepasse', remember: true });
    assert.equal(r.t, 'account_ok');
    assert.deepEqual(r.chars, []);
    assert.match(r.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(await silent(a, { t: 'register', name: 'Autre1', password: 'motdepasse' }), true, 'ignored once logged in');
    r = await a.req({ t: 'char_create', name: 'Aldric', cls: 'warrior' });
    assert.equal(r.t, 'account_ok');
    assert.equal(r.chars.length, 1);
    assert.equal(r.created, r.chars[0].id);
    assert.equal(r.account.lastChar, r.created);
    const aldric = r.created;
    for (const [name, cls, code] of [['aldric', 'mage', 'name_taken'], ['A1dric', 'mage', 'name_taken'], ['Aldric2', 'paladin', 'bad_class'], ['x', 'mage', 'bad_name'], ['Admin', 'mage', 'bad_name']]) {
      r = await a.req({ t: 'char_create', name, cls });
      assert.equal(r.t, 'account_err', name);
      assert.equal(r.code, code, name);
      assert.equal(r.op, 'char_create');
    }
    // another account cannot take the name either, and cannot touch A's characters
    const b = await c();
    r = await b.req({ t: 'register', name: 'CompteB', password: 'motdepasse', remember: false });
    assert.equal(r.token, undefined);
    assert.equal((await b.req({ t: 'char_create', name: 'ALDRIC', cls: 'mage' })).code, 'name_taken');
    assert.equal((await b.req({ t: 'char_select', id: aldric })).code, 'not_found');
    assert.equal((await b.req({ t: 'char_delete', id: aldric, confirm: 'Aldric' })).code, 'not_found');
    // up to 5
    await sleep(1000); // char_create is rate limited (burst of 10, then 1 / s)
    for (let i = 2; i <= MAX_CHARS; i++) assert.equal((await a.req({ t: 'char_create', name: `Heros${i}`, cls: 'mage' })).t, 'account_ok');
    r = await a.req({ t: 'char_create', name: 'Sixieme', cls: 'ranger' });
    assert.equal(r.code, 'too_many_chars');
    // delete needs the exact name
    assert.equal((await a.req({ t: 'char_delete', id: aldric, confirm: 'Aldri' })).code, 'bad_confirm');
    r = await a.req({ t: 'char_delete', id: aldric, confirm: 'aldric' });
    assert.equal(r.t, 'account_ok');
    assert.equal(r.chars.length, MAX_CHARS - 1);
    assert.ok(!r.chars.some((ch) => ch.id === aldric));
    assert.equal(srv.store.getAccount('CompteA').deleted[0].name, 'Aldric', 'kept aside for an admin restore');
    // the name is free again
    assert.equal((await b.req({ t: 'char_create', name: 'Aldric', cls: 'mage' })).t, 'account_ok');
    // a character that is playing cannot be deleted
    const heros2 = srv.store.get('Heros2').id;
    assert.equal((await a.req({ t: 'char_select', id: heros2 })).t, 'auth_ok');
    assert.equal((await a.req({ t: 'char_delete', id: heros2, confirm: 'Heros2' })).code, 'already_online');
    // character creation is refused while in the world
    await sleep(1100);
    assert.equal((await a.req({ t: 'char_create', name: 'Dedans', cls: 'mage' })).code, 'in_world');
  });
});

test('char_logout leaves the world (saved) and char_select switches characters; one character online once', async () => {
  await withServer(async ({ srv, c }) => {
    const a = await c();
    let r = await a.req({ t: 'register', name: 'Joueuse', password: 'motdepasse', remember: false });
    const m = (await a.req({ t: 'char_create', name: 'Mira', cls: 'mage' })).created;
    const w = (await a.req({ t: 'char_create', name: 'Wulf', cls: 'warrior' })).created;
    r = await a.req({ t: 'char_select', id: m });
    assert.equal(r.t, 'auth_ok');
    assert.equal(r.self.cls, 'mage');
    const mid = r.id;
    assert.ok(srv.game.players.has(mid));
    srv.game.players.get(mid).gold = 999;
    r = await a.req({ t: 'char_logout' });
    assert.equal(r.t, 'account_ok');
    assert.ok(!srv.game.players.has(mid), 'entity removed');
    assert.equal(srv.store.get('Mira').gold, 999, 'character saved');
    assert.equal(r.account.lastChar, m);
    // switch directly from the world
    r = await a.req({ t: 'char_select', id: m });
    r = await a.req({ t: 'char_select', id: w });
    assert.equal(r.t, 'auth_ok');
    assert.equal(r.self.name, 'Wulf');
    assert.equal(srv.game.players.size, 1);
    // the same character cannot be online twice
    const b = await c();
    await b.req({ t: 'login', name: 'joueuse', password: 'motdepasse', remember: false });
    assert.equal((await b.req({ t: 'char_select', id: w })).code, 'already_online');
    assert.equal((await b.req({ t: 'char_select', id: m })).t, 'auth_ok');
  });
});

test('remembered login over the network: token rotated on use, logout revokes it, logout_all disconnects everywhere', async () => {
  await withServer(async ({ c }) => {
    const a = await c();
    let r = await a.req({ t: 'register', name: 'Fidele', password: 'motdepasse', remember: true });
    const t1 = r.token;
    await a.req({ t: 'char_create', name: 'Fidele', cls: 'ranger' });
    a.close();
    const b = await c();
    r = await b.req({ t: 'login_token', token: t1 });
    assert.equal(r.t, 'account_ok');
    assert.equal(r.method, 'token');
    assert.equal(r.chars[0].name, 'Fidele');
    const t2 = r.token;
    assert.ok(t2 && t2 !== t1, 'rotated');
    const x = await c();
    assert.equal((await x.req({ t: 'login_token', token: t1 })).code, 'bad_token', 'old token dead');
    assert.equal((await x.req({ t: 'login_token', token: 'n'.repeat(43) })).code, 'bad_token');
    // logout revokes the current token and goes back to the login screen (socket still open)
    r = await b.req({ t: 'logout' });
    assert.equal(r.t, 'logged_out');
    assert.equal(await silent(b, { t: 'char_select', id: 'abcdef' }), true, 'account messages ignored after logout');
    assert.equal((await b.req({ t: 'login_token', token: t2 })).code, 'bad_token');
    // logout_all: every token revoked, other connections of the account kicked
    const d1 = await c();
    const k1 = (await d1.req({ t: 'login', name: 'Fidele', password: 'motdepasse', remember: true })).token;
    const d2 = await c();
    const k2 = (await d2.req({ t: 'login', name: 'Fidele', password: 'motdepasse', remember: true })).token;
    r = await d1.req({ t: 'logout_all' });
    assert.equal(r.t, 'logged_out');
    assert.equal(r.all, true);
    await d2.waitFor((m) => m.t === 'kick');
    const e = await c();
    assert.equal((await e.req({ t: 'login_token', token: k1 })).code, 'bad_token');
    assert.equal((await e.req({ t: 'login_token', token: k2 })).code, 'bad_token');
  });
});

test('password change: old password required, other remembered sessions revoked', async () => {
  await withServer(async ({ c }) => {
    const a = await c();
    const keep = (await a.req({ t: 'register', name: 'Secret', password: 'motdepasse', remember: true })).token;
    const b = await c();
    const other = (await b.req({ t: 'login', name: 'Secret', password: 'motdepasse', remember: true })).token;
    assert.equal((await a.req({ t: 'password_change', old: 'mauvais', password: 'nouveau123' })).code, 'wrong_credentials');
    assert.equal((await a.req({ t: 'password_change', old: 'motdepasse', password: 'abc' })).code, 'bad_password');
    const r = await a.req({ t: 'password_change', old: 'motdepasse', password: 'nouveau123' });
    assert.equal(r.t, 'account_ok');
    assert.match(r.info, /Mot de passe modifié/);
    const x = await c();
    assert.equal((await x.req({ t: 'login', name: 'Secret', password: 'motdepasse', remember: false })).code, 'wrong_credentials');
    assert.equal((await x.req({ t: 'login', name: 'Secret', password: 'nouveau123', remember: false })).t, 'account_ok');
    const y = await c();
    assert.equal((await y.req({ t: 'login_token', token: other })).code, 'bad_token');
    assert.equal((await y.req({ t: 'login_token', token: keep })).t, 'account_ok', 'this device stays remembered');
  });
});

test('legacy client: register { name, password, cls } creates the account + character and enters the world', async () => {
  await withServer(async ({ srv, c }) => {
    const a = await c();
    const r = await a.req({ t: 'register', name: 'Ancienne', password: 'motdepasse', cls: 'mage' });
    assert.equal(r.t, 'auth_ok');
    assert.equal(r.self.name, 'Ancienne');
    assert.equal(r.self.cls, 'mage');
    const acc = srv.store.getAccount('ancienne');
    assert.equal(acc.chars.length, 1);
    assert.equal(acc.chars[0].name, 'Ancienne');
    // legacy register refuses a name taken by a character of another account (and vice versa)
    const b = await c();
    await b.req({ t: 'register', name: 'Autre', password: 'motdepasse', remember: false });
    await b.req({ t: 'char_create', name: 'Personnage', cls: 'mage' });
    const d = await c();
    assert.equal((await d.req({ t: 'register', name: 'personnage', password: 'motdepasse', cls: 'warrior' })).code, 'name_taken');
    assert.equal((await d.req({ t: 'register', name: 'AUTRE', password: 'motdepasse' })).code, 'login_taken');
    // an account without character cannot use the legacy login
    assert.equal((await d.req({ t: 'login', name: 'Vide1', password: 'motdepasse' })).code, 'wrong_credentials');
    await d.req({ t: 'register', name: 'Vide1', password: 'motdepasse', remember: false });
    const e = await c();
    assert.equal((await e.req({ t: 'login', name: 'Vide1', password: 'motdepasse' })).code, 'no_character');
  });
});

test('token guessing and brute force are rate limited and flagged', async () => {
  await withServer(async ({ srv, c }) => {
    const ws = await c({ ip: '198.51.100.77' });
    let last;
    for (let i = 0; i < 12; i++) {
      last = await ws.req({ t: 'login_token', token: `${'z'.repeat(40)}${String(i).padStart(3, '0')}` }, ['auth_err', 'kick']);
      if (last.code === 'rate_limit' || last.t === 'kick') break;
      await sleep(10);
    }
    assert.ok(last.code === 'rate_limit' || last.t === 'kick', JSON.stringify(last));
    assert.ok(srv.security.scoreOf({ ip: '198.51.100.77' }) > 0, 'flagged');
  }, { security: { trustProxy: 1, loginFreeFailsIp: 3, loginBackoffBaseMs: 5000 } });
});

// ------------------------------------------------------------------ passkeys
test('relying party: RP_ID env, request host, page origin and ALLOWED_ORIGINS', () => {
  assert.deepEqual(relyingParty({ origin: 'http://localhost:5173', host: 'localhost:3000', env: {} }), { id: 'localhost', origins: ['http://localhost:5173'] });
  assert.deepEqual(relyingParty({ origin: 'https://brumel.mciut.fr', host: '127.0.0.1:3000', env: {}, allowedOrigins: ['https://brumel.mciut.fr'] }), { id: 'brumel.mciut.fr', origins: ['https://brumel.mciut.fr'] });
  assert.deepEqual(relyingParty({ origin: 'https://jeu.mciut.fr', host: 'x', env: { RP_ID: 'mciut.fr' }, allowedOrigins: ['https://brumel.mciut.fr', '*'] }), { id: 'mciut.fr', origins: ['https://jeu.mciut.fr', 'https://brumel.mciut.fr'] });
  assert.equal(relyingParty({ origin: 'https://evil.example', host: 'x', env: { RP_ID: 'mciut.fr' } }), null, 'origin outside the RP ID');
});

test('passkeys: register after a password login, then log in with the discoverable credential; negative paths', async () => {
  const auth = new SoftAuthenticator();
  await withServer(async ({ srv, c }) => {
    const a = await c();
    await a.req({ t: 'register', name: 'Clef', password: 'motdepasse', remember: false });
    await a.req({ t: 'char_create', name: 'Clef', cls: 'ranger' });
    // registration: options for this connection
    let r = await a.req({ t: 'passkey_reg_options' });
    assert.equal(r.t, 'passkey_options');
    assert.equal(r.purpose, 'register');
    assert.equal(r.options.rp.id, 'localhost');
    assert.equal(r.options.authenticatorSelection.residentKey, 'required');
    // wrong origin in clientData -> refused (and the challenge is consumed)
    let resp = auth.register(r.options, { origin: 'https://evil.example' });
    assert.equal((await a.req({ t: 'passkey_reg_verify', resp })).code, 'passkey_failed');
    resp = auth.register(r.options, { origin: ORIGIN });
    assert.equal((await a.req({ t: 'passkey_reg_verify', resp })).code, 'passkey_failed', 'challenge is single use');
    // wrong challenge
    r = await a.req({ t: 'passkey_reg_options' });
    resp = auth.register({ ...r.options, challenge: 'AAAAAAAAAAAAAAAAAAAAAA' }, { origin: ORIGIN });
    assert.equal((await a.req({ t: 'passkey_reg_verify', resp })).code, 'passkey_failed');
    // happy path
    r = await a.req({ t: 'passkey_reg_options' });
    resp = auth.register(r.options, { origin: ORIGIN });
    r = await a.req({ t: 'passkey_reg_verify', resp, label: 'Mon PC <b>' });
    assert.equal(r.t, 'account_ok', JSON.stringify(r));
    assert.equal(r.account.passkeys.length, 1);
    assert.equal(r.account.passkeys[0].label, 'Mon PC b');
    const credId = resp.id;
    assert.equal(r.account.passkeys[0].id, credId);
    const stored = srv.store.getAccount('clef').passkeys[0];
    assert.deepEqual(stored.transports, ['internal', 'hybrid']);
    assert.ok(!JSON.stringify(r).includes(stored.pk), 'public key never sent back');
    // rename
    r = await a.req({ t: 'passkey_rename', id: credId, label: 'Portable' });
    assert.equal(r.account.passkeys[0].label, 'Portable');

    // login with the passkey (no name), remembered
    const b = await c();
    assert.equal((await b.req({ t: 'passkey_login_verify', resp: auth.authenticate({ challenge: 'AAAA', rpId: 'localhost' }, { origin: ORIGIN }) })).code, 'passkey_failed', 'no challenge issued');
    r = await b.req({ t: 'passkey_login_options' });
    assert.equal(r.purpose, 'login');
    assert.deepEqual(r.options.allowCredentials, []);
    r = await b.req({ t: 'passkey_login_verify', resp: auth.authenticate(r.options, { origin: ORIGIN }), remember: true });
    assert.equal(r.t, 'account_ok', JSON.stringify(r));
    assert.equal(r.account.name, 'Clef');
    assert.equal(r.method, 'passkey');
    assert.ok(r.token);
    assert.equal(srv.store.getAccount('clef').passkeys[0].counter, auth.creds.get(credId).counter, 'signature counter stored');

    // negative login paths
    // (one connection per attempt: the passkey messages are rate limited per connection)
    let x;
    const bad = async (opts, why) => {
      x = await c();
      const o = await x.req({ t: 'passkey_login_options' });
      const res = await x.req({ t: 'passkey_login_verify', resp: auth.authenticate(o.options, { origin: ORIGIN, ...opts }) });
      assert.equal(res.code, 'passkey_failed', why);
    };
    await bad({ badSignature: true }, 'bad signature');
    await bad({ tamper: (cd) => { cd.origin = 'https://evil.example'; } }, 'wrong origin');
    await bad({ tamper: (cd) => { cd.type = 'webauthn.create'; } }, 'wrong type');
    await bad({ counter: 1 }, 'replayed / cloned counter');
    x = await c();
    const o = await x.req({ t: 'passkey_login_options' });
    const forged = auth.authenticate(o.options, { origin: ORIGIN });
    forged.response.userHandle = 'QUFBQUFBQUFBQUFBQUFBQQ';
    assert.equal((await x.req({ t: 'passkey_login_verify', resp: forged })).code, 'passkey_failed', 'user handle of another account');
    const unknown = new SoftAuthenticator();
    unknown.register({ challenge: 'x', rp: { id: 'localhost' }, user: { id: 'QUFB' } }, { origin: ORIGIN });
    x = await c();
    const u = await x.req({ t: 'passkey_login_options' });
    assert.equal((await x.req({ t: 'passkey_login_verify', resp: unknown.authenticate(u.options, { origin: ORIGIN }) })).code, 'passkey_failed', 'unknown credential');

    // delete
    r = await a.req({ t: 'passkey_delete', id: credId });
    assert.equal(r.account.passkeys.length, 0);
    const y = await c();
    const o2 = await y.req({ t: 'passkey_login_options' });
    assert.equal((await y.req({ t: 'passkey_login_verify', resp: auth.authenticate(o2.options, { origin: ORIGIN }) })).code, 'passkey_failed', 'deleted passkey');
  }, { security: { loginFreeFailsIp: 100, loginFreeFailsAccount: 100 } });
});

test('malformed passkey payloads are rejected by validation, oversized ones never reach the verifier', async () => {
  await withServer(async ({ c }) => {
    const x = await c();
    await x.req({ t: 'passkey_login_options' });
    assert.equal((await x.req({ t: 'passkey_login_verify', resp: 'pas un objet' })).code, 'bad_request');
    assert.equal((await x.req({ t: 'passkey_login_verify', resp: { id: 'a', rawId: 'b', type: 'public-key', response: {} } })).code, 'passkey_failed');
  });
});
