// [netcode-perf] Wire level: permessage-deflate, opt-in `batch` frames, auth_ok version, and the client side
// (client/src/net.js unpacking, client/src/state.js field-by-field merge, version notice).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import WebSocket from 'ws';
import { startServer } from '../src/index.js';
import { VERSION } from '../src/version.js';

register(new URL('./support/alias-hooks.mjs', import.meta.url));
const { dispatchFrame, serverUrl } = await import('../../client/src/net.js');
const { GameState } = await import('../../client/src/state.js');
const { observeServerVersion, resetServerVersion } = await import('../../client/src/version.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(port, query = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
    ws.frames = [];
    ws.msgs = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      ws.frames.push(m);
      if (m.t === 'batch') ws.msgs.push(...m.m);
      else ws.msgs.push(m);
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.waitFor = async (pred, timeout = 8000) => {
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-netcode-'));
  const srv = await startServer({ port: 0, dataDir: dir, staticDir: path.join(dir, 'none'), quiet: true });
  try {
    await fn(srv);
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('permessage-deflate is negotiated; batch frames only for clients that ask; auth_ok carries ver/build', async () => {
  await withServer(async (srv) => {
    const plain = await connect(srv.port);
    assert.match(plain.extensions, /permessage-deflate/);
    const batched = await connect(srv.port, '?batch=1');
    plain.send(JSON.stringify({ t: 'register', name: 'Plat', password: 'abcd', cls: 'mage' }));
    batched.send(JSON.stringify({ t: 'register', name: 'Groupe', password: 'abcd', cls: 'warrior' }));
    const okP = await plain.waitFor((m) => m.t === 'auth_ok');
    const okB = await batched.waitFor((m) => m.t === 'auth_ok');
    assert.equal(okP.ver, VERSION);
    assert.equal(okB.build, 'dev', 'no built client in this test');
    await batched.waitFor((m) => m.t === 'snap');
    await sleep(400);
    assert.ok(!plain.frames.some((f) => f.t === 'batch'), 'unbatched client never sees batch frames');
    const batches = batched.frames.filter((f) => f.t === 'batch');
    assert.ok(batches.length > 0, 'several messages in one tick are coalesced');
    for (const b of batches) {
      assert.ok(Array.isArray(b.m) && b.m.length >= 2);
      assert.ok(b.m.every((m) => typeof m.t === 'string' && m.t !== 'batch'));
    }
    // ordering is preserved inside and across frames: snapshot ticks only increase
    const ticks = batched.msgs.filter((m) => m.t === 'snap').map((m) => m.tick);
    assert.deepEqual(ticks, [...ticks].sort((a, b) => a - b));
    // kick messages are delivered before the socket closes, even batched
    for (let i = 0; i < 80; i++) batched.send(JSON.stringify({ t: 'ping', c: i }));
    await new Promise((r) => batched.on('close', r));
    assert.ok(batched.msgs.some((m) => m.t === 'kick'));
    plain.close();
  });
});

test('client net.js: batch frames are unpacked in order, faulty entries skipped, auth_ok checks the version', () => {
  const got = [];
  dispatchFrame({ t: 'batch', m: [{ t: 'snap', tick: 1 }, null, { t: 'batch', m: [] }, 5, { t: 'self', hp: 3 }, { nope: 1 }] }, (m) => got.push(m));
  assert.deepEqual(got.map((m) => m.t), ['snap', 'self']);
  const thrown = [];
  const orig = console.error;
  console.error = () => thrown.push(1);
  try {
    dispatchFrame({ t: 'batch', m: [{ t: 'a' }, { t: 'b' }] }, (m) => { if (m.t === 'a') throw new Error('boum'); got.push(m); });
  } finally {
    console.error = orig;
  }
  assert.equal(got.at(-1).t, 'b', 'an exception in one handler does not drop the rest of the batch');
  assert.equal(thrown.length, 1);
  globalThis.location = { protocol: 'https:', host: 'brumel.example' };
  assert.equal(serverUrl(), 'wss://brumel.example/ws?batch=1');
  delete globalThis.location;
});

test('client version notice: first auth_ok is the reference, a different one after reconnecting shows it', () => {
  resetServerVersion();
  const created = [];
  globalThis.document = {
    createElement: (tag) => {
      const el = { tag, style: {}, children: [], textContent: '', isConnected: false, setAttribute() {}, addEventListener() {}, append(...c) { this.children.push(...c); }, remove() { this.isConnected = false; } };
      created.push(el);
      return el;
    },
    body: { appendChild(el) { el.isConnected = true; } },
  };
  try {
    assert.equal(observeServerVersion({ t: 'auth_ok' }), false, 'offline mode: no version');
    assert.equal(observeServerVersion({ ver: '0.2.0', build: 'aaa' }), false);
    assert.equal(observeServerVersion({ ver: '0.2.0', build: 'aaa' }), false, 'same server after a reconnection');
    assert.equal(created.length, 0);
    assert.equal(observeServerVersion({ ver: '0.2.0', build: 'bbb' }), true, 'redeployed client');
    const banner = created.find((e) => e.tag === 'div');
    const text = banner.children.map((c) => c.textContent).join('');
    assert.match(text, /Nouvelle version disponible/);
    assert.match(text, /recharger/);
    assert.equal(observeServerVersion({ ver: '0.3.0', build: 'ccc' }), true);
    assert.equal(created.filter((e) => e.tag === 'div').length, 1, 'only one banner at a time');
  } finally {
    delete globalThis.document;
    resetServerVersion();
  }
});

test('client state.js: snapshots merge field by field; omitted entities hold their position', () => {
  const st = new GameState();
  st.inGame = true;
  st.selfId = 1;
  const added = [];
  st.on('add', (r) => added.push(r.id));
  st.applySnap({ tick: 10, tod: 0.5, on: 2, ents: [
    { id: 1, x: 0, z: 7, ry: 0, hp: 50, mhp: 50, s: 0, tg: 0, k: 'player', n: 'Moi', c: 'mage', m: 'mage', lv: 1 },
    { id: 7, x: 10, z: 20, ry: 1, hp: 30, mhp: 40, s: 1, tg: 1, sl: 1, k: 'monster', n: 'Loup', m: 'wolf', lv: 3, mt: 'wolf' },
  ], gone: [] }, 1000);
  assert.deepEqual(added, [1, 7]);
  const wolf = st.entities.get(7);
  // delta: only x changed, then only hp
  st.applySnap({ tick: 12, tod: 0.5, on: 2, ents: [{ id: 7, x: 11 }], gone: [] }, 1100);
  assert.equal(wolf.hp, 30);
  assert.equal(wolf.tg, 1, 'omitted tg keeps its value');
  assert.equal(wolf.sl, 1, 'omitted sl keeps its value');
  assert.equal(wolf.s, 1);
  assert.equal(wolf.n, 'Loup');
  assert.equal(wolf.count, 2);
  const last = (wolf.head + wolf.count - 1) % 16;
  assert.deepEqual([wolf.sx[last], wolf.sz[last], Math.round(wolf.sry[last] * 1000) / 1000], [11, 20, 1], 'z and ry taken from the previous sample');
  st.applySnap({ tick: 14, ents: [{ id: 7, hp: 12, tg: 0 }], gone: [] }, 1200);
  assert.equal(wolf.hp, 12);
  assert.equal(wolf.tg, 0);
  assert.equal(wolf.count, 3, 'a sample is still added (held position)');
  // entity absent from the snapshot: its timeline is extended at the same place
  st.applySnap({ tick: 16, ents: [], gone: [] }, 1300);
  assert.equal(wolf.count, 4);
  wolf.interpolate(16 * 50);
  assert.deepEqual([wolf.x, wolf.z], [11, 20]);
  st.applySnap({ tick: 18, ents: [{ id: 7, x: 12 }], gone: [] }, 1400);
  wolf.interpolate(17 * 50);
  assert.ok(Math.abs(wolf.x - 11.5) < 1e-6, `moves only between the last two snapshots (x=${wolf.x})`);
  st.applySnap({ tick: 20, ents: [], gone: [7] }, 1500);
  assert.ok(!st.entities.has(7));
});
