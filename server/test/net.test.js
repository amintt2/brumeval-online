import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../src/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal ws client recording messages. */
function connect(port, pathname = '/ws') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${pathname}`);
    ws.msgs = [];
    ws.on('message', (d) => ws.msgs.push(JSON.parse(d.toString())));
    ws.closed = new Promise((r) => ws.on('close', (code) => r(code)));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.sendJson = (m) => ws.send(JSON.stringify(m));
    ws.waitFor = async (pred, timeout = 3000) => {
      const t0 = Date.now();
      for (;;) {
        const m = ws.msgs.find(pred);
        if (m) return m;
        if (Date.now() - t0 > timeout) throw new Error('timeout');
        await sleep(10);
      }
    };
  });
}

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-net-'));
  const srv = await startServer({ port: 0, dataDir: dir, staticDir: path.join(dir, 'none'), quiet: true });
  try {
    await fn(srv, dir);
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('auth errors, pre-auth messages ignored, auth_ok payload', async () => {
  await withServer(async (srv) => {
    const ws = await connect(srv.port);
    ws.sendJson({ t: 'chat', text: 'hello' });
    ws.sendJson({ t: 'ability', slot: 0, tg: 3 });
    ws.sendJson({ t: 'respawn' });
    ws.send('pas du json');
    ws.send(Buffer.from([0, 1, 2, 3]));
    ws.sendJson({ t: 'register', name: 'Test', password: 'abc', cls: 'mage' });
    assert.equal((await ws.waitFor((m) => m.t === 'auth_err')).code, 'bad_password');
    ws.msgs.length = 0;
    ws.sendJson({ t: 'register', name: 'Test', password: 'abcd', cls: 'druide' });
    assert.equal((await ws.waitFor((m) => m.t === 'auth_err')).code, 'bad_class');
    ws.msgs.length = 0;
    ws.sendJson({ t: 'login', name: 'Inconnu', password: 'abcd' });
    const e = await ws.waitFor((m) => m.t === 'auth_err');
    assert.equal(e.code, 'wrong_credentials');
    assert.equal(typeof e.msg, 'string');
    ws.msgs.length = 0;
    ws.sendJson({ t: 'login', name: { $gt: '' }, password: 'abcd' });
    assert.equal((await ws.waitFor((m) => m.t === 'auth_err')).code, 'bad_request');
    ws.msgs.length = 0;
    ws.sendJson({ t: 'register', name: 'Testeur', password: 'abcd', cls: 'ranger' });
    const ok = await ws.waitFor((m) => m.t === 'auth_ok');
    assert.ok(ok.id > 0);
    assert.equal(ok.online, 1);
    assert.equal(typeof ok.tod, 'number');
    assert.match(ok.motd, /Brumeval/);
    assert.equal(ok.self.cls, 'ranger');
    assert.ok(!ws.msgs.some((m) => m.t === 'chat' || m.t === 'err'), 'nothing answered to pre-auth gameplay messages');
    // a second register on the same socket is ignored
    ws.sendJson({ t: 'register', name: 'Autre', password: 'abcd', cls: 'ranger' });
    const snap = await ws.waitFor((m) => m.t === 'snap');
    assert.ok(snap.ents.some((e) => e.id === ok.id));
    await sleep(100);
    assert.equal(ws.msgs.filter((m) => m.t === 'auth_ok' || m.t === 'auth_err').length, 1);
    ws.close();
    await ws.closed;
  });
});

test('flooding more than 60 messages per second gets kicked', async () => {
  await withServer(async (srv) => {
    const ws = await connect(srv.port);
    for (let i = 0; i < 80; i++) ws.sendJson({ t: 'ping', c: i });
    const code = await ws.closed;
    assert.ok(ws.msgs.some((m) => m.t === 'kick' && typeof m.msg === 'string'));
    assert.equal(code, 4000);
    // the server is still alive
    const ws2 = await connect(srv.port);
    ws2.sendJson({ t: 'ping', c: 1 });
    assert.equal((await ws2.waitFor((m) => m.t === 'pong')).c, 1);
    ws2.close();
  });
});

test('payloads over 8 KB close the socket; other paths are refused', async () => {
  await withServer(async (srv) => {
    const ws = await connect(srv.port);
    ws.send(JSON.stringify({ t: 'chat', text: 'x'.repeat(9000) }));
    assert.equal(await ws.closed, 1009);
    await assert.rejects(connect(srv.port, '/autre'));
  });
});

test('disconnect removes the player for others and persists the account; relogin restores it', async () => {
  await withServer(async (srv, dir) => {
    const a = await connect(srv.port);
    const b = await connect(srv.port);
    a.sendJson({ t: 'register', name: 'Alix', password: 'secret1', cls: 'warrior' });
    const okA = await a.waitFor((m) => m.t === 'auth_ok');
    b.sendJson({ t: 'register', name: 'Brune', password: 'secret2', cls: 'mage' });
    await b.waitFor((m) => m.t === 'auth_ok');
    await b.waitFor((m) => m.t === 'snap' && m.ents.some((e) => e.id === okA.id));
    // A walks a bit
    for (let i = 1; i <= 5; i++) {
      a.sendJson({ t: 'move', x: 0.4 * i, z: 7, ry: 1.57 });
      await sleep(70);
    }
    a.close();
    await a.closed;
    await b.waitFor((m) => m.t === 'snap' && m.gone.includes(okA.id));
    await b.waitFor((m) => m.t === 'chat' && m.ch === 'system' && m.text === 'Alix a quitté Brumeval.');
    await srv.store.flush(); // [netcode-perf] per-account files, written in the background
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'accounts', 'alix.json'), 'utf8'));
    assert.equal(saved.x, 2);
    assert.equal(saved.cls, 'warrior');

    const a2 = await connect(srv.port);
    a2.sendJson({ t: 'login', name: 'ALIX', password: 'secret1' });
    const re = await a2.waitFor((m) => m.t === 'auth_ok');
    assert.notEqual(re.id, okA.id);
    assert.equal(re.self.name, 'Alix');
    assert.equal(re.self.x, 2);
    // already online
    const a3 = await connect(srv.port);
    a3.sendJson({ t: 'login', name: 'alix', password: 'secret1' });
    assert.equal((await a3.waitFor((m) => m.t === 'auth_err')).code, 'already_online');
    for (const w of [a2, a3, b]) w.close();
  });
});

test('server close disconnects clients and saves', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-net-'));
  const srv = await startServer({ port: 0, dataDir: dir, staticDir: path.join(dir, 'none'), quiet: true });
  try {
    const ws = await connect(srv.port);
    ws.sendJson({ t: 'register', name: 'Fermeture', password: 'abcd', cls: 'mage' });
    await ws.waitFor((m) => m.t === 'auth_ok');
    await srv.close();
    const code = await ws.closed;
    assert.ok([1001, 1006].includes(code), String(code));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'accounts', 'fermeture.json'), 'utf8'));
    assert.equal(saved.name, 'Fermeture');
    await srv.close(); // idempotent
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
