// [render-souls] Pure (no WebGL) parts of the client renderer: graphics settings, wind material rules, flipbook
// manifest validation, terrain data (splat weights / grass mask) and its independence from the map size.
import test from 'node:test';
import assert from 'node:assert/strict';

// quality.js persists to localStorage: provide an in-memory one (Node has none by default)
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const Q = await import('../../client/src/render/quality.js');
const { windKindOf, windParamsFor } = await import('../../client/src/render/wind.js');
const { parseFlipbookEntry } = await import('../../client/src/render/flipbooks.js');
const { computeTerrainData, LAYERS } = await import('../../client/src/render/terrainData.js');
const { WORLD_HALF } = await import('../../shared/world.js');

test('graphics presets: every preset has every option, post off disables AO and volumetric fog', () => {
  for (const id of Q.PRESET_IDS) {
    for (const k of Q.OPTION_KEYS) assert.ok(k in Q.PRESETS[id], `${id}.${k}`);
    assert.ok(Q.PRESET_LABELS[id]);
  }
  assert.equal(Q.PRESET_LABELS.eleve, 'Élevé');
  assert.equal(Q.PRESETS.bas.post, false);
  assert.equal(Q.PRESETS.bas.ao, false);
});

test('graphics settings: defaults, persistence, custom detection, sanitising', () => {
  store.clear();
  Q._resetForTests();
  assert.equal(Q.hasSavedSettings(), false);
  assert.equal(Q.getSettings().preset, 'moyen');
  const seen = [];
  const off = Q.onSettingsChange((s) => seen.push(s.preset));
  Q.applyPreset('ultra');
  assert.equal(Q.getSettings().shadows, 3);
  assert.equal(Q.hasSavedSettings(), true);
  Q.updateSettings({ grass: 0.2 });
  assert.equal(Q.getSettings().preset, 'custom');
  // going back to the exact preset values re-selects the preset
  Q.updateSettings({ grass: Q.PRESETS.ultra.grass });
  assert.equal(Q.getSettings().preset, 'ultra');
  Q.updateSettings({ post: false });
  assert.equal(Q.getSettings().ao, false);
  assert.equal(Q.getSettings().fog, false);
  // hostile / corrupted values are clamped
  Q.updateSettings({ shadows: 99, grass: -4, distance: 'x', fpsCap: 77, pixelRatio: 10 });
  const s = Q.getSettings();
  assert.equal(s.shadows, 3);
  assert.equal(s.grass, 0);
  assert.ok(s.distance >= 0.6 && s.distance <= 1.4);
  assert.ok(Q.FPS_CAPS.includes(s.fpsCap));
  assert.equal(s.pixelRatio, 2);
  off();
  assert.deepEqual(seen, ['ultra', 'custom', 'ultra', 'custom', 'custom']);
  // reload from storage
  Q._resetForTests();
  assert.equal(Q.getSettings().shadows, 3);
  // corrupted storage falls back to "moyen"
  store.set('brumeval.graphics.v1', '{not json');
  Q._resetForTests();
  assert.equal(Q.getSettings().preset, 'moyen');
});

test('graphics benchmark → preset', () => {
  assert.equal(Q.presetFromBenchmark(4, 'ANGLE (AMD Radeon RX 6650 XT)'), 'ultra');
  assert.equal(Q.presetFromBenchmark(9, 'NVIDIA GeForce RTX 3060'), 'eleve');
  assert.equal(Q.presetFromBenchmark(15, ''), 'moyen');
  assert.equal(Q.presetFromBenchmark(40, ''), 'bas');
  assert.equal(Q.presetFromBenchmark(3, 'Intel(R) UHD Graphics 620'), 'moyen');
  assert.equal(Q.presetFromBenchmark(3, 'Google SwiftShader'), 'bas');
});

test('wind: material names (ROADMAP §4.4) decide what sways', () => {
  const m = (name) => ({ name });
  assert.equal(windKindOf(m('Leaves')), 'leaf');
  assert.equal(windKindOf(m('Foliage_dark')), 'leaf');
  assert.equal(windKindOf(m('oak_leaf')), 'leaf');
  assert.equal(windKindOf(m('Grass_tuft')), 'grass');
  assert.equal(windKindOf(m('Banner_red')), 'cloth');
  assert.equal(windKindOf(m('Cloth')), 'cloth');
  assert.equal(windKindOf(m('Bark')), null);
  assert.equal(windKindOf(m('Leaf_trunk')), null); // trunks never move
  assert.equal(windKindOf(m('Stone')), null);
  assert.equal(windKindOf(m('')), null);
  // cloth hangs from its top edge, leaves bend from the model origin
  const box = { min: { y: 1 }, max: { y: 3 } };
  assert.equal(windParamsFor(m('Banner'), box, 'banner', true).base, 3);
  assert.equal(windParamsFor(m('Leaves'), box, 'tree_oak', true).base, 0.1);
  // v0.1 bush without named materials still sways (legacy rule), its wood does not
  assert.equal(windParamsFor(m('Green'), box, 'bush', false).kind, 'leaf');
  assert.equal(windParamsFor(m('Wood'), box, 'bush', false), null);
});

test('flipbook manifest entries are validated', () => {
  const ok = parseFlipbookEntry('fire_loop', { file: 'fire_loop.webp', cols: 8, rows: 8, frames: 60, fps: 30, loop: true, blending: 'additive', size: 1.6 });
  assert.equal(ok.url, '/vfx/fire_loop.webp');
  assert.equal(ok.frames, 60);
  assert.equal(ok.additive, true);
  assert.equal(ok.loop, true);
  const n = parseFlipbookEntry('smoke', { file: 'smoke.webp', cols: 4, rows: 4, blending: 'normal' });
  assert.equal(n.additive, false);
  assert.equal(n.frames, 16); // defaults to the whole grid
  assert.equal(n.fps, 24);
  assert.equal(parseFlipbookEntry('bad', { file: '../../secret.png', cols: 2, rows: 2 }), null);
  assert.equal(parseFlipbookEntry('bad', { file: 'x.webp', cols: 0, rows: 2 }), null);
  assert.equal(parseFlipbookEntry('bad', null), null);
  assert.equal(parseFlipbookEntry('big', { file: 'x.webp', cols: 2, rows: 2, frames: 99 }).frames, 4);
});

test('terrain data: normalised splat weights, grass mask, any map size', () => {
  for (const half of [WORLD_HALF, 400]) {
    const d = computeTerrainData(half, 8);
    const n = d.size * d.size;
    assert.equal(d.heights.length, n);
    assert.equal(d.splat0.length, n * 4);
    assert.equal(LAYERS.length, 10);
    for (let k = 0; k < n; k += 97) {
      const o = k * 4;
      const sum = d.splat0[o] + d.splat0[o + 1] + d.splat0[o + 2] + d.splat0[o + 3]
        + d.splat1[o] + d.splat1[o + 1] + d.splat1[o + 2] + d.splat1[o + 3] + d.splat2[o] + d.splat2[o + 1];
      assert.ok(sum >= 245 && sum <= 256, `splat sum ${sum}`);
      assert.ok(Number.isFinite(d.heights[k]));
    }
    // there is grass somewhere, and none under the village plaza (cobbles)
    let grassy = 0;
    for (let k = 0; k < n; k++) if (d.grass[k * 4] > 128) grassy++;
    assert.ok(grassy > n * 0.05, 'grass coverage');
    const c = Math.floor(d.size / 2);
    assert.ok(d.grass[(c * d.size + c) * 4] < 40, 'village plaza without grass');
  }
});
