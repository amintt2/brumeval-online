// Launcher settings: defaults, validation and window-bounds sanitising (pure, unit-tested).
'use strict';

const { DEFAULT_SERVER_URL, normalizeServerUrl } = require('./urls');

const WINDOW_DEFAULTS = {
  launcher: { width: 1120, height: 700, minWidth: 900, minHeight: 580 },
  game: { width: 1280, height: 800, minWidth: 800, minHeight: 500 },
};

function defaultSettings() {
  return {
    serverUrl: DEFAULT_SERVER_URL,
    fullscreen: false,
    closeOnPlay: false,
    windows: {},
  };
}

const int = (v) => (Number.isFinite(v) ? Math.round(v) : null);

/** Keeps only sane saved bounds: { x, y, width, height, maximized }. Returns null when unusable. */
function sanitizeBounds(raw, kind) {
  const def = WINDOW_DEFAULTS[kind];
  if (!def || !raw || typeof raw !== 'object') return null;
  const width = int(raw.width);
  const height = int(raw.height);
  if (width === null || height === null) return null;
  const out = {
    width: Math.min(Math.max(width, def.minWidth), 10000),
    height: Math.min(Math.max(height, def.minHeight), 10000),
    maximized: raw.maximized === true,
  };
  const x = int(raw.x);
  const y = int(raw.y);
  if (x !== null && y !== null && Math.abs(x) < 100000 && Math.abs(y) < 100000) {
    out.x = x;
    out.y = y;
  }
  return out;
}

/** Turns whatever was read from settings.json (possibly corrupted or from an older version) into valid settings. */
function sanitizeSettings(raw) {
  const s = defaultSettings();
  if (!raw || typeof raw !== 'object') return s;
  const url = normalizeServerUrl(raw.serverUrl);
  if (url) s.serverUrl = url;
  if (typeof raw.fullscreen === 'boolean') s.fullscreen = raw.fullscreen;
  if (typeof raw.closeOnPlay === 'boolean') s.closeOnPlay = raw.closeOnPlay;
  if (raw.windows && typeof raw.windows === 'object') {
    for (const kind of Object.keys(WINDOW_DEFAULTS)) {
      const b = sanitizeBounds(raw.windows[kind], kind);
      if (b) s.windows[kind] = b;
    }
  }
  return s;
}

/**
 * Applies a patch coming from the launcher UI (only user-editable keys).
 * Returns { ok: true, settings } or { ok: false, error } with a French message.
 */
function applyPatch(current, patch) {
  if (!patch || typeof patch !== 'object') return { ok: false, error: 'Réglages invalides.' };
  const next = { ...current, windows: { ...current.windows } };
  if ('serverUrl' in patch) {
    const url = normalizeServerUrl(patch.serverUrl);
    if (!url) return { ok: false, error: 'Adresse du serveur invalide (exemple : https://brumel.mciut.fr).' };
    next.serverUrl = url;
  }
  if ('fullscreen' in patch) {
    if (typeof patch.fullscreen !== 'boolean') return { ok: false, error: 'Réglages invalides.' };
    next.fullscreen = patch.fullscreen;
  }
  if ('closeOnPlay' in patch) {
    if (typeof patch.closeOnPlay !== 'boolean') return { ok: false, error: 'Réglages invalides.' };
    next.closeOnPlay = patch.closeOnPlay;
  }
  return { ok: true, settings: next };
}

/**
 * True when a saved rectangle is still visible enough on one of the current displays
 * (a monitor may have been unplugged since last time). `workAreas` = [{ x, y, width, height }].
 */
function isVisibleOn(bounds, workAreas) {
  if (!bounds || bounds.x === undefined) return false;
  return workAreas.some((a) => {
    const ix = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const iy = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    // At least 120×60 px of the window (including its title bar area) must be on screen.
    return ix >= 120 && iy >= 60 && bounds.y >= a.y - 8;
  });
}

module.exports = { WINDOW_DEFAULTS, defaultSettings, sanitizeSettings, sanitizeBounds, applyPatch, isVisibleOn };
