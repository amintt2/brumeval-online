// Graphics settings: presets (Bas / Moyen / Élevé / Ultra), per-option overrides, persistence (localStorage) and a
// tiny event bus. This module has no Three.js dependency so the settings panel can import it cheaply.

const STORAGE_KEY = 'brumeval.graphics.v1';

/** Preset ids in display order. */
export const PRESET_IDS = ['bas', 'moyen', 'eleve', 'ultra'];
export const PRESET_LABELS = { bas: 'Bas', moyen: 'Moyen', eleve: 'Élevé', ultra: 'Ultra', custom: 'Personnalisé' };

/**
 * Every option:
 *  shadows   0 off · 1 low (2 cascades 1024) · 2 medium (3 cascades 2048) · 3 high (4 cascades 2048)
 *  ao        screen-space ambient occlusion (GTAO-like, half resolution)
 *  fog       volumetric height fog + light shafts (post pass); off = classic distance fog
 *  grass     density 0 (off) … 1
 *  post      post-processing (HDR, bloom, colour grading, SMAA); off = direct rendering
 *  distance  view distance factor 0.6 … 1.4
 *  dynres    dynamic resolution (keeps the frame time under budget)
 *  fpsCap    0 = unlimited (vsync), otherwise 30 / 60 / 120 / 144
 *  pixelRatio maximum device pixel ratio used
 */
export const PRESETS = {
  bas: { shadows: 0, ao: false, fog: false, grass: 0.3, post: false, distance: 0.7, dynres: true, fpsCap: 60, pixelRatio: 1 },
  moyen: { shadows: 1, ao: false, fog: true, grass: 0.6, post: true, distance: 0.9, dynres: true, fpsCap: 0, pixelRatio: 1 },
  eleve: { shadows: 2, ao: true, fog: true, grass: 0.85, post: true, distance: 1.1, dynres: true, fpsCap: 0, pixelRatio: 1.5 },
  ultra: { shadows: 3, ao: true, fog: true, grass: 1, post: true, distance: 1.35, dynres: false, fpsCap: 0, pixelRatio: 2 },
};
export const OPTION_KEYS = Object.keys(PRESETS.moyen);
export const FPS_CAPS = [0, 30, 60, 120, 144];

const listeners = new Set();
let current = null;

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function sanitize(raw) {
  const base = PRESETS[raw && PRESET_IDS.includes(raw.preset) ? raw.preset : 'moyen'];
  const out = { preset: raw && (PRESET_IDS.includes(raw.preset) || raw.preset === 'custom') ? raw.preset : 'moyen', auto: !!raw?.auto };
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  out.shadows = Math.round(num(raw?.shadows, 0, 3, base.shadows));
  out.ao = typeof raw?.ao === 'boolean' ? raw.ao : base.ao;
  out.fog = typeof raw?.fog === 'boolean' ? raw.fog : base.fog;
  out.grass = num(raw?.grass, 0, 1, base.grass);
  out.post = typeof raw?.post === 'boolean' ? raw.post : base.post;
  out.distance = num(raw?.distance, 0.6, 1.4, base.distance);
  out.dynres = typeof raw?.dynres === 'boolean' ? raw.dynres : base.dynres;
  out.fpsCap = FPS_CAPS.includes(+raw?.fpsCap) ? +raw.fpsCap : base.fpsCap;
  out.pixelRatio = num(raw?.pixelRatio, 0.5, 2, base.pixelRatio);
  // AO and volumetric fog live in the post pipeline
  if (!out.post) { out.ao = false; out.fog = false; }
  return out;
}

/** True when a saved configuration exists (otherwise the renderer runs the quick benchmark). */
export function hasSavedSettings() {
  const s = storage();
  try {
    return !!(s && s.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

/** Current settings (loaded lazily from localStorage). */
export function getSettings() {
  if (current) return current;
  let raw = null;
  const s = storage();
  try {
    const txt = s?.getItem(STORAGE_KEY);
    if (txt) raw = JSON.parse(txt);
  } catch {
    raw = null;
  }
  current = sanitize(raw || { preset: 'moyen' });
  return current;
}

function save() {
  const s = storage();
  try {
    s?.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* private mode / quota: settings simply won't persist */
  }
}

function emit(prev) {
  for (const fn of listeners) {
    try {
      fn(current, prev);
    } catch (err) {
      console.error(err);
    }
  }
}

/** Apply a whole preset. */
export function applyPreset(id, { auto = false, persist = true } = {}) {
  if (!PRESETS[id]) return getSettings();
  const prev = getSettings();
  current = sanitize({ ...PRESETS[id], preset: id, auto });
  if (persist) save();
  emit(prev);
  return current;
}

/** Change some options; the preset becomes "custom" unless the result equals a preset. */
export function updateSettings(patch) {
  const prev = getSettings();
  const next = sanitize({ ...prev, ...patch, preset: 'custom', auto: false });
  // re-detect a preset match so the selector stays meaningful
  for (const id of PRESET_IDS) {
    const p = PRESETS[id];
    if (OPTION_KEYS.every((k) => (typeof p[k] === 'number' ? Math.abs(p[k] - next[k]) < 1e-6 : p[k] === next[k]))) {
      next.preset = id;
      break;
    }
  }
  current = next;
  save();
  emit(prev);
  return current;
}

/** Subscribe to changes: fn(settings, previous). Returns an unsubscribe function. */
export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Pick a preset from a benchmark result: median milliseconds of a frame rendered at "Élevé" at the current
 * resolution, and the GPU name (when the browser exposes it).
 */
export function presetFromBenchmark(ms, gpuName = '') {
  const g = String(gpuName || '').toLowerCase();
  const software = /swiftshader|llvmpipe|software|basic render/.test(g);
  if (software) return 'bas';
  const integrated = /intel|uhd|iris|mali|adreno|powervr|apple m1(?!\s*(pro|max|ultra))/.test(g);
  let id;
  if (ms < 6.5) id = 'ultra';
  else if (ms < 11) id = 'eleve';
  else if (ms < 20) id = 'moyen';
  else id = 'bas';
  if (integrated && (id === 'ultra' || id === 'eleve')) id = 'moyen';
  return id;
}

// ------------------------------------------------------------------ runtime hooks (set by render/graphics.js)
// The settings panel (UI) never imports Three.js: the renderer registers what the panel may ask for.
const hooks = { stats: null, autodetect: null };

/** Renderer side: { stats() → { fps, calls, triangles, scale, gpuMs… }, autodetect() → Promise<presetId> }. */
export function setGraphicsHooks(h) {
  Object.assign(hooks, h);
}

/** UI side: the registered hooks (null when the renderer isn't running, e.g. the UI sandbox page). */
export function graphicsHooks() {
  return hooks;
}

/** Test helper: forget the in-memory settings (reloads from storage on the next getSettings()). */
export function _resetForTests() {
  current = null;
  listeners.clear();
}
