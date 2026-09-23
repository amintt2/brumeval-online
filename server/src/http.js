// HTTP: static files of the built client (client/dist) + small JSON API (/health, /api/status, /api/version).
// Static files: path-traversal safe, SPA index.html fallback, brotli/gzip for compressible types (compressed
// output cached in memory), long-term immutable caching for Vite's hashed /assets/*, ETag / Last-Modified
// revalidation (304) for everything else (index.html, /models, /icons, /ui…), which is served `no-cache` so a
// new deployment is picked up at the next page load.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/** Extensions worth compressing (text, and binary formats that are not compressed already). */
export const COMPRESSIBLE = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.map', '.txt', '.svg', '.ico',
  '.glb', '.gltf', '.bin', '.wasm', '.ttf', '.otf', '.wav',
]);
const MIN_COMPRESS = 1024;                 // smaller bodies are sent as they are
const MAX_COMPRESS = 16 * 1024 * 1024;     // larger files are streamed uncompressed
const CACHE_MAX_BYTES = 96 * 1024 * 1024;  // compressed variants kept in memory

export const NOT_BUILT_HTML = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Brumeval Online</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d12;color:#e8dcc0;font-family:Georgia,serif}
main{max-width:560px;padding:32px;border:1px solid #b8913a;border-radius:10px;background:#151922}
h1{margin-top:0;color:#e0b95a}code{background:#222835;padding:2px 6px;border-radius:4px;color:#fff}</style></head>
<body><main><h1>Brumeval Online</h1>
<p>Le serveur de jeu fonctionne, mais le client n'a pas encore été compilé.</p>
<p>Lancez <code>npm run build</code> puis rechargez cette page,<br>ou utilisez <code>npm run dev</code> et jouez sur <code>http://localhost:5173</code>.</p>
</main></body></html>`;

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

function sendText(res, status, body, type = 'text/plain; charset=utf-8', head = false) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
  res.end(head ? undefined : body);
}

async function statFile(p) {
  try {
    return await fs.promises.stat(p);
  } catch {
    return null;
  }
}

/** Preferred encoding the client accepts: 'br', 'gzip' or null (identity). */
export function pickEncoding(header) {
  if (typeof header !== 'string' || !header) return null;
  const acc = new Map();
  for (const part of header.toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    let q = 1;
    for (const p of params) {
      const m = /^\s*q=([0-9.]+)\s*$/.exec(p);
      if (m) q = Number(m[1]);
    }
    if (name) acc.set(name.trim(), q);
  }
  const ok = (e) => (acc.get(e) ?? acc.get('*') ?? 0) > 0;
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

const etagOf = (st, enc) => `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}${enc ? `-${enc === 'br' ? 'br' : 'gz'}` : ''}"`;

/** RFC 7232 weak comparison of If-None-Match against `etag`. */
export function etagMatches(header, etag) {
  if (typeof header !== 'string') return false;
  const bare = etag.replace(/^W\//, '');
  return header.split(',').some((t) => {
    const s = t.trim();
    return s === '*' || s.replace(/^W\//, '') === bare;
  });
}

/** In-memory cache of compressed files (key: path + encoding, invalidated by size/mtime). */
export class CompressionCache {
  constructor(maxBytes = CACHE_MAX_BYTES) {
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.map = new Map();      // key -> { size, mtimeMs, buf }
    this.inflight = new Map(); // key -> Promise<Buffer>
    this.hits = 0;
    this.misses = 0;
  }

  async get(file, st, enc) {
    const key = `${file}\n${enc}`;
    const hit = this.map.get(key);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
      this.hits++;
      this.map.delete(key); // refresh LRU position
      this.map.set(key, hit);
      return hit.buf;
    }
    let p = this.inflight.get(key);
    if (!p) {
      this.misses++;
      p = (async () => {
        const raw = await fs.promises.readFile(file);
        const big = raw.length > 2 * 1024 * 1024;
        const buf = enc === 'br'
          ? await brotli(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: big ? 6 : 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
          : await gzip(raw, { level: big ? 6 : 9 });
        this.store(key, { size: st.size, mtimeMs: st.mtimeMs, buf });
        return buf;
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  store(key, entry) {
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.buf.length;
      this.map.delete(key);
    }
    if (entry.buf.length > this.maxBytes) return;
    this.map.set(key, entry);
    this.bytes += entry.buf.length;
    for (const [k, v] of this.map) {
      if (this.bytes <= this.maxBytes) break;
      this.map.delete(k);
      this.bytes -= v.buf.length;
    }
  }
}

function cacheControlFor(rel) {
  // Vite fingerprinted build output never changes under the same name
  if (rel.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  // index.html, /models, /icons, /ui…: always revalidated (ETag / Last-Modified → 304)
  return 'public, no-cache';
}

async function serveFile(req, res, file, st, rel, log, cache) {
  const ext = path.extname(file).toLowerCase();
  const head = req.method === 'HEAD';
  const type = MIME[ext] || 'application/octet-stream';
  const compressible = COMPRESSIBLE.has(ext) && st.size >= MIN_COMPRESS && st.size <= MAX_COMPRESS;
  const enc = compressible ? pickEncoding(req.headers['accept-encoding']) : null;
  const etag = etagOf(st, enc);
  const headers = {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheControlFor(rel),
    'Last-Modified': st.mtime.toUTCString(),
    ETag: etag,
  };
  if (compressible) headers.Vary = 'Accept-Encoding';

  const inm = req.headers['if-none-match'];
  const ims = req.headers['if-modified-since'];
  const notModified = inm !== undefined
    ? etagMatches(inm, etag)
    : ims !== undefined && Math.floor(st.mtimeMs / 1000) <= Math.floor(Date.parse(ims) / 1000);
  if (notModified) {
    res.writeHead(304, headers);
    return res.end();
  }

  if (enc) {
    let buf;
    try {
      buf = await cache.get(file, st, enc);
    } catch (err) {
      log?.error(`compression de ${file} impossible : ${err.message}`);
      buf = null;
    }
    if (buf) {
      headers['Content-Encoding'] = enc;
      headers['Content-Length'] = buf.length;
      res.writeHead(200, headers);
      return res.end(head ? undefined : buf);
    }
    headers.ETag = etagOf(st, null);
  }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  if (head) return res.end();
  const stream = fs.createReadStream(file);
  stream.on('error', (err) => {
    log?.error(`lecture de ${file} impossible : ${err.message}`);
    res.destroy();
  });
  stream.pipe(res);
}

/** Returns an http request handler serving `staticDir`. */
export function createStaticHandler(staticDir, log, cache = new CompressionCache()) {
  const root = path.resolve(staticDir);
  const handler = async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return sendText(res, 405, 'Méthode non autorisée');
      }
      const head = req.method === 'HEAD';
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      } catch {
        return sendText(res, 400, 'Requête invalide', undefined, head);
      }
      if (pathname.includes('\0')) return sendText(res, 400, 'Requête invalide', undefined, head);

      const index = path.join(root, 'index.html');
      const indexSt = await statFile(index);
      if (!indexSt) return sendText(res, 200, NOT_BUILT_HTML, MIME['.html'], head);

      const file = path.resolve(root, '.' + path.posix.normalize('/' + pathname));
      if (file !== root && !file.startsWith(root + path.sep)) return sendText(res, 403, 'Accès interdit', undefined, head);

      let st = await statFile(file);
      let target = file;
      if (st && st.isDirectory()) {
        target = path.join(file, 'index.html');
        st = await statFile(target);
      }
      const relOf = (f) => '/' + path.relative(root, f).split(path.sep).join('/');
      if (st && st.isFile()) return await serveFile(req, res, target, st, relOf(target), log, cache);

      // SPA fallback for "page" URLs; real missing assets get a 404 so loaders can fall back.
      const ext = path.extname(pathname);
      if (!ext || ext === '.html') return await serveFile(req, res, index, indexSt, '/index.html', log, cache);
      return sendText(res, 404, 'Fichier introuvable', undefined, head);
    } catch (err) {
      log?.error('http :', err?.message || err);
      if (!res.headersSent) sendText(res, 500, 'Erreur interne');
      else res.destroy();
    }
  };
  handler.cache = cache;
  /** Compress the text bundles in the background so the first visitor does not wait (best effort). */
  handler.warm = async () => {
    const dir = path.join(root, 'assets');
    let files;
    try { files = await fs.promises.readdir(dir); } catch { return 0; }
    let n = 0;
    for (const f of [...files, '../index.html']) {
      const file = path.join(dir, f);
      if (!['.js', '.css', '.html'].includes(path.extname(f))) continue;
      const st = await statFile(file);
      if (!st || !st.isFile() || st.size < MIN_COMPRESS || st.size > MAX_COMPRESS) continue;
      try {
        await cache.get(file, st, 'br');
        await cache.get(file, st, 'gzip');
        n++;
      } catch { /* served uncompressed on error */ }
    }
    return n;
  };
  return handler;
}

// ------------------------------------------------------------------ JSON API
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function sendJson(res, status, obj, head = false) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...CORS,
  });
  res.end(head ? undefined : body);
}

/**
 * Full HTTP handler: `routes` ({ '/health': (req) => object, … }) answer JSON with CORS (for the launcher and
 * monitoring), everything else is a static file.
 */
export function createHttpHandler({ staticDir, log, routes = {} }) {
  const statics = createStaticHandler(staticDir, log);
  const handler = async (req, res) => {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch { /* the static handler answers 400 */ }
    const route = Object.prototype.hasOwnProperty.call(routes, pathname) ? routes[pathname] : null;
    if (!route) return statics(req, res);
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...CORS, 'Content-Length': 0 });
        return res.end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD, OPTIONS');
        return sendJson(res, 405, { error: 'Méthode non autorisée' });
      }
      const out = await route(req);
      sendJson(res, 200, out, req.method === 'HEAD');
    } catch (err) {
      log?.error(`http ${pathname} :`, err?.message || err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Erreur interne' });
      else res.destroy();
    }
  };
  handler.statics = statics;
  return handler;
}
