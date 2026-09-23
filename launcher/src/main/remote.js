// Fetches the news and the server status from the main process (Chromium network stack: system proxy,
// certificates…). The launcher UI never talks to the network itself (its CSP has connect-src 'none').
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { net } = require('electron');
const { parseNews, parseStatus } = require('./lib/feeds');
const { serverPath } = require('./lib/urls');

const TIMEOUT_MS = 8000;
const BUNDLED_NEWS = path.join(__dirname, '..', 'renderer', 'vendor', 'news.json');

async function getJson(url, userAgent) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await net.fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, status: res.status, ms };
    const text = await res.text();
    if (text.length > 512 * 1024) return { ok: false, status: res.status, ms };
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, ms, notJson: true };
    }
    return { ok: true, status: res.status, ms, json };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: ctrl.signal.aborted ? 'délai dépassé' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

function bundledNews() {
  try {
    return parseNews(JSON.parse(fs.readFileSync(BUNDLED_NEWS, 'utf8')));
  } catch {
    return null;
  }
}

/** → { ok, items, offline } ; falls back to the copy of news.json shipped with the launcher. */
async function fetchNews(base, userAgent) {
  const r = await getJson(serverPath(base, '/news.json'), userAgent);
  const parsed = r.ok ? parseNews(r.json) : null;
  if (parsed) return { ok: true, items: parsed.items, offline: false };
  const local = bundledNews();
  if (local) return { ok: true, items: local.items, offline: true };
  return { ok: false, items: [], offline: true };
}

/**
 * → { online, players, maxPlayers, version, message, ms }.
 * /api/status and /health are optional: when neither exists, a reachable game page still means "online".
 */
async function fetchStatus(base, userAgent) {
  for (const p of ['/api/status', '/health']) {
    const r = await getJson(serverPath(base, p), userAgent);
    if (r.ok) return { ...parseStatus(r.json), ms: r.ms };
    if (r.status === 503) return { ...parseStatus({ ok: false }), ms: r.ms };
    if (r.status === 0) return { online: false, players: null, maxPlayers: null, version: '', message: '', ms: null };
  }
  // Endpoints missing (older server): probe the page itself.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await net.fetch(serverPath(base, '/'), { method: 'HEAD', signal: ctrl.signal, cache: 'no-store', headers: { 'User-Agent': userAgent } });
    return { online: res.ok, players: null, maxPlayers: null, version: '', message: '', ms: Date.now() - t0 };
  } catch {
    return { online: false, players: null, maxPlayers: null, version: '', message: '', ms: null };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchNews, fetchStatus };
