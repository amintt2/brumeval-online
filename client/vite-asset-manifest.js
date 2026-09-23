// [render-souls] Vite plugin: /asset-manifest.json lists the optional files of client/public (models, textures,
// env, vfx) so the client never requests assets that don't exist (no 404 noise for LODs, HDRIs, texture sets…).
// Served live by the dev server, emitted into dist/ by the build.
import fs from 'node:fs';
import path from 'node:path';

const DIRS = ['models', 'textures', 'env', 'vfx'];

function walk(root, rel, out) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, r, out);
    else if (e.isFile()) out.push(r);
  }
}

function listFiles(publicDir) {
  const out = [];
  for (const d of DIRS) walk(publicDir, d, out);
  return out.sort();
}

export function assetManifest() {
  let publicDir = '';
  return {
    name: 'brumeval-asset-manifest',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    configureServer(server) {
      server.middlewares.use('/asset-manifest.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(JSON.stringify({ files: listFiles(publicDir) }));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: JSON.stringify({ files: listFiles(publicDir) }) });
    },
  };
}
