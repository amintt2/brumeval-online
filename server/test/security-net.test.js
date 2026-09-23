// Connection-layer security against the real server: Origin, IPs behind a trusted proxy, connection limits,
// bans, login throttling, registration rules, auth timeout, idle kick, malformed / oversized / flood traffic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../src/index.js';
import { hashPassword } from '../src/auth.js';
import { newAccount } from '../src/persistence.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ws client; `ip` is sent as X-Forwarded-For (the server trusts one proxy hop in these tests). */
function connect(port, { ip, origin = 'http://localhost:5201', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (ip) h['X-Forwarded-For'] = ip;
    const opts = { headers: h };
    if (origin) opts.origin = origin;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, opts);
    ws.msgs = [];
    ws.on('message', (d) => ws.msgs.push(JSON.parse(d.toString())));
    ws.closed = new Promise((r) => ws.on('close', (code) => r(code)));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('unexpected-response', (req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
    ws.sendJson = (m) => ws.send(JSON.stringify(m));
    ws.waitFor = async (pred, timeout = 4000) => {
      const t0 = Date.now();
      for (;;) {
        const m = ws.msgs.find(pred);
        if (m) return m;
        if (Date.now() - t0 > timeout) throw new Error('timeout');
        await sleep(10);
      }
    };
    ws.auth = async (m) => {
      const from = ws.msgs.length;
      ws.sendJson(m);
      return ws.waitFor((x, i) => ws.msgs.indexOf(x) >= from && (x.t === 'auth_ok' || x.t === 'auth_err'));
    };
  });
}

async function withServer(security, fn, prepare) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-secnet-'));
  if (prepare) await prepare(dir);
  const srv = await startServer({ port: 0, dataDir: dir, staticDir: path.join(dir, 'none'), quiet: true, security: { trustProxy: 1, allowNoOrigin: false, ...security } });
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

test('Origin allow-list: foreign sites and Origin-less clients are refused at the handshake', async () => {
  await withServer({}, async ({ srv, dir, c }) => {
    await assert.rejects(connect(srv.port, { origin: 'https://site-pirate.example' }), (e) => e.status === 403);
    await assert.rejects(connect(srv.port, { origin: null }), (e) => e.status === 403);
    const ok = await c({ origin: 'https://brumel.mciut.fr' });
    ok.sendJson({ t: 'ping', c: 1 });
    assert.equal((await ok.waitFor((m) => m.t === 'pong')).c, 1);
    await c({ origin: 'http://localhost:5201' });
    const log = fs.readFileSync(path.join(dir, 'security.log'), 'utf8');
    assert.match(log, /"refused":"origin"/);
  });
});

test('max 5 connections per IP (behind a trusted proxy); loopback exempt; IP bans refuse the connection', async () => {
  await withServer({}, async ({ srv, c }) => {
    const socks = [];
    for (let i = 0; i < 5; i++) socks.push(await c({ ip: '198.51.100.10' }));
    const sixth = await c({ ip: '198.51.100.10' });
    assert.equal(await sixth.closed, 4000);
    assert.match(sixth.msgs.find((m) => m.t === 'kick').msg, /Trop de connexions/);
    await c({ ip: '198.51.100.11' });           // another address is fine
    socks[0].close();
    await socks[0].closed;
    await sleep(50);
    const again = await c({ ip: '198.51.100.10' });
    again.sendJson({ t: 'ping', c: 2 });
    await again.waitFor((m) => m.t === 'pong');
    for (let i = 0; i < 8; i++) await c({});   // no X-Forwarded-For: 127.0.0.1, exempt
    srv.security.bans.banIp('198.51.100.66', { durationMs: 3_600_000, reason: 'robot', author: 'test' });
    const banned = await c({ ip: '198.51.100.66' });
    assert.equal(await banned.closed, 4000);
    assert.match(banned.msgs[0].msg, /Votre adresse est bannie encore 1 h\. Raison : robot\./);
  });
});

test('login brute force: generic error, per-account backoff, then locked out, flagged and kicked', async () => {
  await withServer({ loginFreeFailsAccount: 3, loginBackoffBaseMs: 400 }, async ({ srv, c }) => {
    const owner = await c({ ip: '198.51.100.20' });
    assert.equal((await owner.auth({ t: 'register', name: 'Victime', password: 'secret123', cls: 'mage' })).t, 'auth_ok');
    owner.close();
    const atk = await c({ ip: '203.0.113.5' });
    const codes = [];
    for (let i = 0; i < 6; i++) {
      const r = await atk.auth({ t: 'login', name: 'Victime', password: `essai${i}` });
      codes.push(r.code);
      if (r.code === 'wrong_credentials') assert.equal(r.msg, 'Nom ou mot de passe incorrect.');
    }
    assert.deepEqual(codes.slice(0, 4), ['wrong_credentials', 'wrong_credentials', 'wrong_credentials', 'wrong_credentials']);
    assert.ok(codes.slice(4).every((x) => x === 'rate_limit'), codes.join());
    // unknown names answer exactly like known ones
    const probe = await c({ ip: '203.0.113.6' });
    for (let i = 0; i < 4; i++) assert.equal((await probe.auth({ t: 'login', name: 'Fantome', password: 'x' })).code, 'wrong_credentials');
    assert.equal((await probe.auth({ t: 'login', name: 'Fantome', password: 'x' })).code, 'rate_limit');
    // the real owner, from elsewhere, must wait for the lock too (then gets in with the right password)
    await sleep(1700);
    const back = await c({ ip: '198.51.100.20' });
    assert.equal((await back.auth({ t: 'login', name: 'victime', password: 'secret123' })).t, 'auth_ok');
    assert.ok(srv.security.scoreOf({ ip: '203.0.113.5' }) > 0, 'attacker flagged');
    // more than 12 attempts on one connection -> kick
    const spam = await c({ ip: '203.0.113.7' });
    for (let i = 0; i < 14 && spam.readyState === WebSocket.OPEN; i++) {
      spam.sendJson({ t: 'login', name: `Nom${i}`, password: 'x' });
      await sleep(i < 5 ? 300 : 1020); // burst of 5, then under the login message rate (1 / s)
    }
    assert.ok(spam.msgs.some((m) => m.t === 'kick'));
  });
});

test('registration rules: 6-char passwords, reserved / offensive / look-alike names, accounts per IP per hour; old 4-char passwords still work', async () => {
  const prepare = async (dir) => {
    const { salt, hash } = await hashPassword('abcd');
    const acc = newAccount('Ancien', 'warrior', salt, hash);
    fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({ version: 1, accounts: { ancien: acc } }));
  };
  await withServer({ accountsPerIpPerHour: 2 }, async ({ c }) => {
    // one connection per attempt: the register message itself is rate limited (5 in a burst, then 1 / s)
    const reg = async (name, password = 'motdepasse', cls = 'ranger') => {
      const ws = await c({ ip: '198.51.100.30' });
      const r = await ws.auth({ t: 'register', name, password, cls });
      ws.close();
      await ws.closed;
      return r;
    };
    let r = await reg('Nouveau', 'abcde');
    assert.equal(r.code, 'bad_password');
    assert.match(r.msg, /6 à 64 caractères/);
    for (const [name, re] of [['Admin', /réservé/], ['MJ_Paul', /réservé/], ['Brumeval', /réservé/], ['Connard', /pas autorisé/], ['__proto__', /réservé/]]) {
      r = await reg(name);
      assert.equal(r.code, 'bad_name', name);
      assert.match(r.msg, re, name);
    }
    r = await reg('ancien');
    assert.equal(r.code, 'name_taken');
    r = await reg('Anc1en');
    assert.equal(r.code, 'name_taken');
    assert.match(r.msg, /ressemble trop/);
    // existing account with a 4-character password still logs in
    const old = await c({ ip: '198.51.100.31' });
    const ok = await old.auth({ t: 'login', name: 'Ancien', password: 'abcd' });
    assert.equal(ok.t, 'auth_ok');
    // 2 accounts per IP per hour
    const w1 = await c({ ip: '198.51.100.32' });
    assert.equal((await w1.auth({ t: 'register', name: 'Premier', password: 'motdepasse', cls: 'mage' })).t, 'auth_ok');
    const w2 = await c({ ip: '198.51.100.32' });
    assert.equal((await w2.auth({ t: 'register', name: 'Deuxieme', password: 'motdepasse', cls: 'mage' })).t, 'auth_ok');
    const w3 = await c({ ip: '198.51.100.32' });
    r = await w3.auth({ t: 'register', name: 'Troisieme', password: 'motdepasse', cls: 'mage' });
    assert.equal(r.code, 'rate_limit');
    assert.match(r.msg, /Trop de personnages/);
  }, prepare);
});

test('banned accounts cannot log in (message with remaining time), bans survive a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-secnet-'));
  try {
    let srv = await startServer({ port: 0, dataDir: dir, staticDir: path.join(dir, 'none'), quiet: true, security: { allowNoOrigin: false } });
    let ws = await connect(srv.port);
    assert.equal((await ws.auth({ t: 'register', name: 'Banni', password: 'motdepasse', cls: 'mage' })).t, 'auth_ok');
    srv.security.bans.banAccount('Banni', { durationMs: 2 * 86_400_000, reason: 'triche', author: 'Amin' });
    ws.terminate();
    await srv.close();
    srv = await startServer({ port: 0, dataDir: dir, staticDir: path.join(dir, 'none'), quiet: true, security: { allowNoOrigin: false } });
    ws = await connect(srv.port);
    const r = await ws.auth({ t: 'login', name: 'Banni', password: 'motdepasse' });
    assert.equal(r.code, 'banned');
    assert.match(r.msg, /^Ce compte est banni encore (1 j 23 h|2 j)\. Raison : triche\.$/);
    // a wrong password does not reveal the ban
    assert.equal((await ws.auth({ t: 'login', name: 'Banni', password: 'mauvais' })).code, 'wrong_credentials');
    ws.terminate();
    await srv.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('auth timeout and idle (AFK) kick', async () => {
  await withServer({ authTimeoutMs: 300, idleKickMs: 700 }, async ({ c }) => {
    const lurker = await c({ ip: '198.51.100.40' });
    assert.equal(await lurker.closed, 4000);
    assert.match(lurker.msgs[0].msg, /Délai de connexion dépassé/);
    const afk = await c({ ip: '198.51.100.41' });
    assert.equal((await afk.auth({ t: 'register', name: 'Dormeur', password: 'motdepasse', cls: 'mage' })).t, 'auth_ok');
    // pings do not count as activity
    const pinger = setInterval(() => { if (afk.readyState === WebSocket.OPEN) afk.sendJson({ t: 'ping', c: 1 }); }, 100);
    try {
      assert.equal(await afk.closed, 4000);
    } finally {
      clearInterval(pinger);
    }
    assert.match(afk.msgs.find((m) => m.t === 'kick').msg, /inactivité/);
  });
});

test('malformed, oversized, prototype-polluting and flooding clients', async () => {
  await withServer({}, async ({ srv, c }) => {
    const ws = await c({ ip: '198.51.100.50' });
    assert.equal((await ws.auth({ t: 'register', name: 'Pirate', password: 'motdepasse', cls: 'warrior' })).t, 'auth_ok');
    ws.send('{"t":"move","x":1,"z":2,"__proto__":{"isAdmin":true}}');
    ws.sendJson({ t: 'move', x: 'NaN', z: 1 });
    ws.sendJson({ t: 'use_item', slot: -1 });
    ws.sendJson({ t: 'buy', id: 1, item: 'potion_hp_s', qty: -50 });
    ws.sendJson({ t: 'nimportequoi', deep: { a: { b: { c: 1 } } } });
    ws.send('pas du json');
    ws.sendJson({ t: 'ping', c: 9 });
    await ws.waitFor((m) => m.t === 'pong' && m.c === 9);
    assert.ok(!({}).isAdmin);
    const flags = srv.security.flagsOf('Pirate');
    assert.ok(flags.some((f) => f.code === 'bad_packet'));
    assert.ok(srv.security.scoreOf({ name: 'Pirate' }) >= 10);
    // per-type limit: a burst of chat beyond the bucket is dropped silently (and flagged)
    for (let i = 0; i < 20; i++) ws.sendJson({ t: 'chat', text: `/who ${i}` });
    await sleep(200);
    assert.ok(srv.security.flagsOf('Pirate').some((f) => f.code === 'rate'));
    // oversized frame: closed by the WebSocket layer
    const big = await c({ ip: '198.51.100.51' });
    big.send(JSON.stringify({ t: 'chat', text: 'x'.repeat(9000) }));
    assert.equal(await big.closed, 1009);
    // global flood: more than the burst in a moment -> kick
    const flood = await c({ ip: '198.51.100.52' });
    for (let i = 0; i < 200; i++) flood.sendJson({ t: 'ping', c: i });
    assert.equal(await flood.closed, 4000);
    assert.match(flood.msgs.find((m) => m.t === 'kick').msg, /Trop de messages/);
  });
});
