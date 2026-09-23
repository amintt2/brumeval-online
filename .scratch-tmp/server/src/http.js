// Static file serving for the built client (client/dist). Path-traversal safe, SPA index.html fallback.
import fs from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

function sendText(res, status, body, type = 'text/plain; charset=utf-8', head = false) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
  res.end(head ? undefined : body);
}

async function statFile(p) {
  try {
    const st = await fs.promises.stat(p);
    return st;
  } catch {
    return null;
  }
}

function serveFile(req, res, file, st, log) {
  const ext = path.extname(file).toLowerCase();
  const rel = file.split(path.sep).join('/');
  const hashed = rel.includes('/assets/'); // Vite fingerprinted build output
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Last-Modified': st.mtime.toUTCString(),
  });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file);
  stream.on('error', (err) => {
    log?.error(`lecture de ${file} impossible : ${err.message}`);
    res.destroy();
  });
  stream.pipe(res);
}

/** Returns an http request handler serving `staticDir`. */
export function createStaticHandler(staticDir, log) {
  const root = path.resolve(staticDir);
  return async (req, res) => {
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
      if (st && st.isFile()) return serveFile(req, res, target, st, log);

      // SPA fallback for "page" URLs; real missing assets get a 404 so loaders can fall back.
      const ext = path.extname(pathname);
      if (!ext || ext === '.html') return serveFile(req, res, index, indexSt, log);
      return sendText(res, 404, 'Fichier introuvable', undefined, head);
    } catch (err) {
      log?.error('http :', err?.message || err);
      if (!res.headersSent) sendText(res, 500, 'Erreur interne');
      else res.destroy();
    }
  };
}
