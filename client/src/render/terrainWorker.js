// Web Worker: terrain data and procedural texture layers computed off the main thread (the loading screen keeps
// animating while it runs).
import { computeTerrainData } from './terrainData.js';
import { generateLayer } from './proceduralTextures.js';

self.onmessage = (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'layers') {
      const out = {};
      const transfer = [];
      for (const name of msg.names || []) {
        const l = generateLayer(name, msg.size || 256);
        out[name] = l;
        transfer.push(l.albedo.buffer, l.normal.buffer, l.orm.buffer);
      }
      self.postMessage({ id: msg.id, ok: true, data: out }, transfer);
      return;
    }
    const d = computeTerrainData(msg.half, msg.step);
    self.postMessage({ id: msg.id, ok: true, data: d }, [d.heights.buffer, d.splat0.buffer, d.splat1.buffer, d.splat2.buffer, d.grass.buffer]);
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err?.message || err) });
  }
};
