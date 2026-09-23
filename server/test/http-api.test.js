// [netcode-perf] HTTP compression, caching headers, revalidation, /health, /api/status, /api/version.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { startServer } from '../src/index.js';
import { pickEncoding, etagMatches } from '../src/http.js';

function request(port, pathname, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withDist(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-http2-'));
  const dist = path.join(root, 'dist');
  for (const d of ['assets', 'models', 'icons', 'ui']) fs.mkdirSync(path.join(dist, d), { recursive: true });
  const js = `// bundle\n${'export const brume = "Brumeval";\n'.repeat(400)}`;
  fs.writeFileSync(path.join(dist, 'index.html'), `<!doctype html><title>Brumeval Online</title><script src="/assets/index-abc123.js"></script>${' '.repeat(2000)}`);
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), js);
  fs.writeFileSync(path.join(dist, 'models', 'slime.glb'), Buffer.alloc(8000, 7));
  fs.writeFileSync(path.join(dist, 'icons', 'potion.png'), Buffer.alloc(3000, 1));
  const srv = await startServer({ port: 0, dataDir: path.join(root, 'data'), staticDir: dist, quiet: true });
  try {
    await fn(srv, { root, dist, js });
  } finally {
    await srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('Accept-Encoding negotiation and weak ETag comparison', () => {
  assert.equal(pickEncoding('gzip, deflate, br'), 'br');
  assert.equal(pickEncoding('gzip;q=1, br;q=0'), 'gzip');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding('*'), 'br');
  assert.equal(pickEncoding(undefined), null);
  assert.ok(etagMatches('"abc"', 'W/"abc"'));
  assert.ok(etagMatches('W/"x", W/"abc"', 'W/"abc"'));
  assert.ok(etagMatches('*', 'W/"abc"'));
  assert.ok(!etagMatches('"abd"', 'W/"abc"'));
});

test('text assets are served brotli / gzip compressed (cached), binary images as they are', async () => {
  await withDist(async (srv, { js }) => {
    const br = await request(srv.port, '/assets/index-abc123.js', { headers: { 'accept-encoding': 'gzip, br' } });
    assert.equal(br.status, 200);
    assert.equal(br.headers['content-encoding'], 'br');
    assert.equal(br.headers.vary, 'Accept-Encoding');
    assert.equal(zlib.brotliDecompressSync(br.body).toString(), js);
    assert.ok(br.body.length < js.length / 5, `compressed ${br.body.length} / ${js.length}`);
    assert.match(br.headers['cache-control'], /max-age=31536000, immutable/);

    const gz = await request(srv.port, '/assets/index-abc123.js', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(gz.body).toString(), js);
    assert.notEqual(gz.headers.etag, br.headers.etag, 'one ETag per representation');

    const plain = await request(srv.port, '/assets/index-abc123.js');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.body.toString(), js);

    const again = await request(srv.port, '/assets/index-abc123.js', { headers: { 'accept-encoding': 'br' } });
    assert.deepEqual(again.body, br.body);

    const glb = await request(srv.port, '/models/slime.glb', { headers: { 'accept-encoding': 'br' } });
    assert.equal(glb.headers['content-encoding'], 'br', 'glTF binaries compress well too');
    const png = await request(srv.port, '/icons/potion.png', { headers: { 'accept-encoding': 'br' } });
    assert.equal(png.headers['content-encoding'], undefined, 'PNG is already compressed');
    assert.equal(png.body.length, 3000);

    const head = await request(srv.port, '/assets/index-abc123.js', { method: 'HEAD', headers: { 'accept-encoding': 'br' } });
    assert.equal(head.body.length, 0);
    assert.equal(Number(head.headers['content-length']), br.body.length);
  });
});

test('index.html and /models /icons: no-cache + ETag / Last-Modified revalidation (304)', async () => {
  await withDist(async (srv, { dist }) => {
    const idx = await request(srv.port, '/', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(idx.status, 200);
    assert.match(idx.headers['cache-control'], /no-cache/);
    assert.ok(idx.headers.etag);
    const r304 = await request(srv.port, '/', { headers: { 'accept-encoding': 'gzip', 'if-none-match': idx.headers.etag } });
    assert.equal(r304.status, 304);
    assert.equal(r304.body.length, 0);
    const spa = await request(srv.port, '/une/page', { headers: { 'accept-encoding': 'gzip', 'if-none-match': idx.headers.etag } });
    assert.equal(spa.status, 304, 'SPA fallback revalidates like index.html');

    const m = await request(srv.port, '/models/slime.glb');
    assert.match(m.headers['cache-control'], /no-cache/);
    assert.equal((await request(srv.port, '/models/slime.glb', { headers: { 'if-none-match': m.headers.etag } })).status, 304);
    assert.equal((await request(srv.port, '/models/slime.glb', { headers: { 'if-modified-since': m.headers['last-modified'] } })).status, 304);

    // a new deployment changes the ETag: full response again
    fs.writeFileSync(path.join(dist, 'models', 'slime.glb'), Buffer.alloc(8001, 3));
    const changed = await request(srv.port, '/models/slime.glb', { headers: { 'if-none-match': m.headers.etag } });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.length, 8001);
  });
});

test('/health, /api/status and /api/version (JSON, CORS for the launcher, never cached)', async () => {
  await withDist(async (srv) => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    const h = await request(srv.port, '/health');
    assert.equal(h.status, 200);
    assert.match(h.headers['content-type'], /application\/json/);
    assert.equal(h.headers['cache-control'], 'no-store');
    assert.equal(h.headers['access-control-allow-origin'], '*');
    const health = JSON.parse(h.body);
    assert.equal(health.status, 'ok');
    assert.equal(health.version, pkg.version);
    assert.match(health.build, /^[0-9a-f]{12}$/, 'build id of the served client');
    assert.equal(typeof health.uptime, 'number');
    assert.equal(health.players, 0);
    assert.ok(health.monsters > 0);
    for (const k of ['p50', 'p95', 'p99', 'max', 'samples', 'budgetMs']) assert.equal(typeof health.tick[k], 'number', k);
    assert.equal(typeof health.memory.rssMB, 'number');
    assert.equal(typeof health.net.outKBps, 'number');

    const st = JSON.parse((await request(srv.port, '/api/status')).body);
    assert.deepEqual(Object.keys(st).sort(), ['build', 'max', 'motd', 'name', 'online', 'version']);
    assert.equal(st.online, 0);
    assert.equal(st.version, pkg.version);
    assert.match(st.motd, /Brumeval/);

    const v = JSON.parse((await request(srv.port, '/api/version?x=1')).body);
    assert.deepEqual(v, { version: pkg.version, build: health.build });

    const pre = await request(srv.port, '/api/status', { method: 'OPTIONS', headers: { origin: 'app://launcher', 'access-control-request-method': 'GET' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers['access-control-allow-origin'], '*');
    assert.match(pre.headers['access-control-allow-methods'], /GET/);
    assert.equal((await request(srv.port, '/health', { method: 'POST' })).status, 405);
    assert.equal((await request(srv.port, '/health', { method: 'HEAD' })).body.length, 0);
    const unknown = await request(srv.port, '/api/inconnu');
    assert.equal(unknown.status, 404, 'unknown API paths are a JSON 404, not the SPA page');
    assert.match(unknown.headers['content-type'], /json/);
  });
});
