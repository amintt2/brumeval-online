// Pure URL helpers (no Electron import: unit-tested with node:test).
'use strict';

const DEFAULT_SERVER_URL = 'https://brumel.mciut.fr';

/**
 * Normalises what a player typed in "URL du serveur".
 * Accepts "brumel.mciut.fr", "https://brumel.mciut.fr/", "http://localhost:3000"…
 * Returns the canonical base URL (origin + optional path, no trailing slash, no query/hash),
 * or null when the value is not a usable http(s) URL.
 */
function normalizeServerUrl(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s || s.length > 2048) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    // No scheme: local addresses default to http, everything else to https.
    s = (/^(localhost|127\.|\[::1\])/i.test(s) ? 'http://' : 'https://') + s;
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname || u.username || u.password) return null;
  const path = u.pathname.replace(/\/+$/, '');
  return u.origin + path;
}

/** Origin ("https://host:port") of an URL string, or null. */
function originOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** True when `url` lives on the same origin as the configured server `base`. */
function isSameOrigin(url, base) {
  const a = originOf(url);
  return a !== null && a === originOf(base);
}

/** Only web links may be handed to the system browser (never file:, javascript:, custom schemes…). */
function isSafeExternalUrl(url) {
  if (typeof url !== 'string' || url.length > 4096) return false;
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Joins the server base URL and an absolute path ("/news.json"). */
function serverPath(base, path) {
  return base.replace(/\/+$/, '') + path;
}

module.exports = { DEFAULT_SERVER_URL, normalizeServerUrl, originOf, isSameOrigin, isSafeExternalUrl, serverPath };
