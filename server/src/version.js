// [netcode-perf] Server version (root package.json) and client build id (fingerprint of client/dist/index.html,
// which references the hashed bundles: any client change gives a new id). Used by auth_ok, /health,
// /api/status and /api/version so that web clients and the launcher know when to reload / update.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT_DIR } from './config.js';

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = readVersion();

let indexFile = null;
let cache = { key: '', build: 'dev' };

/** Where the built client lives (set by startServer). */
export function setStaticDir(dir) {
  indexFile = dir ? path.join(dir, 'index.html') : null;
  cache = { key: '', build: 'dev' };
}

/** 'dev' when no client is built, else a 12-hex-digit fingerprint of index.html (re-read when it changes). */
export function buildId() {
  if (!indexFile) return 'dev';
  let st;
  try {
    st = fs.statSync(indexFile);
  } catch {
    cache = { key: '', build: 'dev' };
    return 'dev';
  }
  const key = `${st.size}:${st.mtimeMs}`;
  if (key !== cache.key) {
    try {
      cache = { key, build: createHash('sha1').update(fs.readFileSync(indexFile)).digest('hex').slice(0, 12) };
    } catch {
      return cache.build;
    }
  }
  return cache.build;
}
