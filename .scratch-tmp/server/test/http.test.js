import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer } from '../src/index.js';

function request(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('static files: MIME types, index fallback, 404 for missing assets, traversal safe', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-http-'));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'models'));
  fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP-SECRET');
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Brumeval Online</title>');
  const files = {
    'assets/main-abc123.js': 'text/javascript', 'assets/style.css': 'text/css', 'models/slime.glb': 'model/gltf-binary',
    'icon.png': 'image/png', 'logo.svg': 'image/svg+xml', 'data.json': 'application/json', 'font.woff2': 'font/woff2',
  };
  for (const f of Object.keys(files)) fs.writeFileSync(path.join(dist, f), 'x'.repeat(10));
  const srv = await startServer({ port: 0, dataDir: path.join(root, 'data'), staticDir: dist, quiet: true });
  try {
    const home = await request(srv.port, '/');
    assert.equal(home.status, 200);
    assert.match(home.headers['content-type'], /^text\/html/);
    assert.match(home.body.toString(), /Brumeval Online/);

    for (const [f, type] of Object.entries(files)) {
      const r = await request(srv.port, `/${f}?v=1`);
      assert.equal(r.status, 200, f);
      assert.ok(r.headers['content-type'].startsWith(type), `${f}: ${r.headers['content-type']}`);
      assert.equal(r.body.length, 10);
    }
    assert.match((await request(srv.port, '/assets/main-abc123.js')).headers['cache-control'], /immutable/);

    const head = await request(srv.port, '/models/slime.glb', 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);

    // SPA fallback for page URLs, 404 for missing assets
    const page = await request(srv.port, '/jeu/quelque-part');
    assert.equal(page.status, 200);
    assert.match(page.body.toString(), /Brumeval Online/);
    assert.equal((await request(srv.port, '/models/absent.glb')).status, 404);

    // traversal attempts never leak files outside staticDir
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/..%5csecret.txt', '/assets/..%5c..%5csecret.txt', '/%2e%2e%5c%2e%2e%5csecret.txt']) {
      const r = await request(srv.port, p);
      assert.ok([400, 403, 404].includes(r.status), `${p} -> ${r.status}`);
      assert.ok(!r.body.toString().includes('TOP-SECRET'), p);
    }
    assert.equal((await request(srv.port, '/%E0%A4%A')).status, 400);
    assert.equal((await request(srv.port, '/', 'POST')).status, 405);
  } finally {
    await srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing staticDir: French help page', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-http-'));
  const srv = await startServer({ port: 0, dataDir: path.join(root, 'data'), staticDir: path.join(root, 'nope'), quiet: true });
  try {
    const r = await request(srv.port, '/');
    assert.equal(r.status, 200);
    const body = r.body.toString();
    assert.match(body, /npm run build/);
    assert.match(body, /npm run dev/);
    assert.match(body, /lang="fr"/);
    assert.equal((await request(srv.port, '/models/x.glb')).status, 200);
  } finally {
    await srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
