// [netcode-perf] Per-account persistence (ROADMAP §4.2): v0.1 import, dirty-only atomic writes, background
// saves, migration defaults, daily backups — and a real login with an account saved by v0.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  AccountStore, newAccount, migrateAccount, sanitizeAccount, accountFileName, ACCOUNT_VERSION, BACKUP_KEEP,
} from '../src/persistence.js';
import { startServer } from '../src/index.js';

// accounts.json written by the v0.1.0 server code (AccountStore.save of commit 21f048a) — passwords
// « ancienmdp1 » (Vétéran), « ancienmdp2 » (Mage_Ancienne), « ancienmdp3 » (con).
const FIXTURE = fileURLToPath(new URL('./fixtures/v0.1/accounts.json', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-store-'));
const quiet = { info() {}, warn() {}, error() {} };
const withLegacy = () => {
  const dir = tmp();
  fs.copyFileSync(FIXTURE, path.join(dir, 'accounts.json'));
  return dir;
};
const readAcc = (dir, key) => JSON.parse(fs.readFileSync(path.join(dir, 'accounts', accountFileName(key)), 'utf8'));

test('v0.1 accounts.json is imported once into one file per account and kept as accounts.v1.bak.json', () => {
  const dir = withLegacy();
  try {
    const logs = [];
    const store = new AccountStore(dir, { info: (m) => logs.push(m), warn() {}, error: (m) => logs.push(m) }).load();
    assert.equal(store.size, 3);
    assert.ok(!fs.existsSync(path.join(dir, 'accounts.json')), 'legacy file moved away');
    assert.equal(fs.readFileSync(path.join(dir, 'accounts.v1.bak.json'), 'utf8'), fs.readFileSync(FIXTURE, 'utf8'), 'untouched backup');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'accounts')).sort(), ['con-.json', 'mage_ancienne.json', 'vétéran.json']);
    assert.ok(logs.some((l) => /3 compte\(s\) importé\(s\)/.test(l)));

    const v = readAcc(dir, 'vétéran');
    const old = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).accounts['vétéran'];
    for (const k of ['name', 'cls', 'salt', 'hash', 'level', 'xp', 'gold', 'hp', 'mp', 'x', 'z', 'created', 'lastSeen']) assert.equal(v[k], old[k], k);
    assert.deepEqual(v.quests, old.quests);
    assert.deepEqual(v.eq, old.eq);
    assert.deepEqual(v.inv[3], { id: 'wolf_pelt', q: 7 });
    assert.equal(v.inv[5], null, 'unknown item dropped by the migration');
    assert.equal(v.v, ACCOUNT_VERSION);

    // second start: nothing to import, same accounts, the backup is not overwritten
    const again = new AccountStore(dir, quiet).load();
    assert.equal(again.size, 3);
    assert.deepEqual(again.get('VÉTÉRAN'), store.get('vétéran'));
    assert.deepEqual(fs.readdirSync(dir).sort(), ['accounts', 'accounts.v1.bak.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an interrupted import (per-account files + accounts.json) keeps the newer per-account data', () => {
  const dir = withLegacy();
  try {
    fs.mkdirSync(path.join(dir, 'accounts'));
    const newer = migrateAccount({ ...JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).accounts['vétéran'], gold: 99999, lastSeen: Date.now() });
    fs.writeFileSync(path.join(dir, 'accounts', 'vétéran.json'), JSON.stringify(newer));
    fs.writeFileSync(path.join(dir, 'accounts', 'vétéran.json.123.7.tmp'), '{"half":');
    fs.writeFileSync(path.join(dir, 'accounts', 'cassé.json'), '{ pas du json');
    fs.writeFileSync(path.join(dir, 'accounts.v1.bak.json'), 'ancienne sauvegarde');
    const store = new AccountStore(dir, quiet).load();
    assert.equal(store.size, 3);
    assert.equal(store.get('vétéran').gold, 99999);
    const files = fs.readdirSync(path.join(dir, 'accounts'));
    assert.ok(!files.some((f) => f.endsWith('.tmp')), 'stale temp files removed');
    assert.ok(files.some((f) => f.startsWith('cassé.json.corrompu-')), 'unreadable account set aside');
    assert.equal(fs.readFileSync(path.join(dir, 'accounts.v1.bak.json'), 'utf8'), 'ancienne sauvegarde', 'existing backup kept');
    assert.ok(fs.readdirSync(dir).some((f) => /^accounts\.v1\.bak-\d+\.json$/.test(f)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('only changed accounts are written; background saves; sync save wins over an older background write', async () => {
  const dir = tmp();
  try {
    const store = new AccountStore(dir, quiet).load();
    const a = store.create(newAccount('Alpha', 'mage', 's', 'h'));
    const b = store.create(newAccount('Beta', 'warrior', 's', 'h'));
    assert.equal(store.save(true), true);
    assert.equal(store.stats.writes, 2);
    assert.equal(store.save(true), true);
    assert.equal(store.stats.writes, 2, 'nothing changed, nothing written');

    a.gold = 777;
    store.markDirty();
    assert.equal(store.save(), true, 'background save accepted');
    assert.ok(store.writing, 'write in flight');
    await store.flush();
    assert.equal(store.stats.writes, 3, 'only the changed account');
    assert.equal(readAcc(dir, 'alpha').gold, 777);
    assert.equal(readAcc(dir, 'beta').gold, b.gold);

    // a background write of gold=1, then gold=2 saved synchronously before it lands: 2 must win
    a.gold = 1;
    store.markDirty(a);
    const pending = store.saveAsync();
    a.gold = 2;
    store.save(true);
    await pending;
    await store.flush();
    assert.equal(readAcc(dir, 'alpha').gold, 2);
    assert.ok(!fs.readdirSync(path.join(dir, 'accounts')).some((f) => f.endsWith('.tmp')));
    assert.equal(new AccountStore(dir, quiet).load().get('alpha').gold, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrateAccount: defaults for missing fields, unknown fields kept, prototype keys ignored', () => {
  const raw = JSON.parse('{"name":"Futur","cls":"ranger","salt":"a","hash":"b","guild":"Les Brumes","__proto__":{"admin":true}}');
  const a = migrateAccount(raw);
  assert.equal(sanitizeAccount, migrateAccount);
  assert.equal(a.level, 1);
  assert.equal(a.xp, 0);
  assert.equal(a.gold, 25);
  assert.equal(a.hp, null);
  assert.equal(a.inv.length, 24);
  assert.deepEqual(a.eq, { weapon: null, armor: null });
  assert.deepEqual(a.quests, {});
  assert.equal(a.v, ACCOUNT_VERSION);
  assert.equal(a.guild, 'Les Brumes', 'a field written by a newer feature survives');
  assert.equal(a.admin, undefined);
  assert.equal(Object.getPrototypeOf(a), Object.prototype);
  const n = newAccount('Neuf', 'mage', 's', 'h');
  assert.equal(n.v, ACCOUNT_VERSION, 'new characters go through the migration too');
  assert.equal(accountFileName('con'), 'con-.json');
  assert.equal(accountFileName('LPT1'.toLowerCase()), 'lpt1-.json');
  assert.equal(accountFileName('connor'), 'connor.json');
});

test('daily backups: one gzip bundle per day in the accounts.json format, the 7 most recent kept', async () => {
  const dir = tmp();
  try {
    const store = new AccountStore(dir, quiet).load();
    store.create(newAccount('Sauvé', 'mage', 's', 'h'));
    const day = 86_400_000;
    const t0 = Date.UTC(2026, 8, 1, 12);
    for (let i = 0; i < 10; i++) assert.ok(await store.maybeBackup(t0 + i * day));
    assert.equal(await store.maybeBackup(t0 + 9 * day + 3600_000), null, 'already done today');
    const files = fs.readdirSync(path.join(dir, 'backups')).sort();
    assert.equal(files.length, BACKUP_KEEP);
    assert.equal(files[0], 'comptes-2026-09-04.json.gz');
    assert.equal(files.at(-1), 'comptes-2026-09-10.json.gz');
    const bundle = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'backups', files.at(-1)))).toString('utf8'));
    assert.equal(bundle.accounts['sauvé'].name, 'Sauvé');

    // restoring a backup = importing it as accounts.json
    const restore = tmp();
    fs.writeFileSync(path.join(restore, 'accounts.json'), JSON.stringify(bundle));
    assert.equal(new AccountStore(restore, quiet).load().get('sauvé').name, 'Sauvé');
    fs.rmSync(restore, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** ws client helper */
function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.msgs = [];
    ws.on('message', (d) => ws.msgs.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.waitFor = async (pred, timeout = 8000) => {
      const t0 = Date.now();
      for (;;) {
        const m = ws.msgs.find(pred);
        if (m) return m;
        if (Date.now() - t0 > timeout) throw new Error('timeout');
        await new Promise((r) => setTimeout(r, 10));
      }
    };
  });
}

test('a player saved by v0.1 logs in on v0.2 with all their progress', async () => {
  const dir = withLegacy();
  const srv = await startServer({ port: 0, dataDir: dir, staticDir: path.join(dir, 'none'), quiet: true });
  try {
    const ws = await connect(srv.port);
    ws.send(JSON.stringify({ t: 'login', name: 'vÉtÉran', password: 'ancienmdp1' }));
    const ok = await ws.waitFor((m) => m.t === 'auth_ok' || m.t === 'auth_err');
    assert.equal(ok.t, 'auth_ok', JSON.stringify(ok));
    const s = ok.self;
    assert.equal(s.name, 'Vétéran');
    assert.equal(s.level, 9);
    assert.equal(s.xp, 410);
    assert.equal(s.gold, 1234);
    assert.deepEqual([s.x, s.z], [52.5, 28.25]);
    assert.deepEqual(s.quests.q_wolves, { state: 'active', n: 3 });
    assert.deepEqual(s.inv[3], { id: 'wolf_pelt', q: 7 });
    assert.equal(typeof ok.ver, 'string');

    const bad = await connect(srv.port);
    bad.send(JSON.stringify({ t: 'login', name: 'Mage_Ancienne', password: 'mauvais' }));
    assert.equal((await bad.waitFor((m) => m.t === 'auth_err')).code, 'wrong_credentials');
    const reserved = await connect(srv.port);
    reserved.send(JSON.stringify({ t: 'login', name: 'CON', password: 'ancienmdp3' }));
    assert.equal((await reserved.waitFor((m) => m.t === 'auth_ok' || m.t === 'auth_err')).t, 'auth_ok');
    for (const w of [ws, bad, reserved]) w.close();
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
