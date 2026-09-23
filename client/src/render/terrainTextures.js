// Terrain texture arrays (albedo / normal / ORM, one layer per ground type) and the shared terrain data maps.
// Baked sets are read from /textures/terrain/<name>_{albedo,normal,orm}.webp; missing layers are generated
// procedurally (tileable) in the terrain worker.
import * as THREE from 'three';
import { LAYERS, computeTerrainData } from './terrainData.js';
import { generateLayer } from './proceduralTextures.js';
import { assetExists } from './assetManifest.js';

// ------------------------------------------------------------------ worker plumbing
let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data?.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.data);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      workerBroken = true;
      for (const p of pending.values()) p.reject(new Error('worker'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function runInWorker(msg, fallback) {
  const w = getWorker();
  if (!w) return Promise.resolve().then(fallback);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...msg, id });
  }).catch(() => fallback());
}

/** Heights / splat / grass maps (worker, or synchronous fallback). */
export function loadTerrainData(half, step) {
  return runInWorker({ type: 'data', half, step }, () => computeTerrainData(half, step));
}

export function disposeTerrainWorker() {
  worker?.terminate();
  worker = null;
}

// ------------------------------------------------------------------ images
async function fetchImageData(url, size) {
  const known = await assetExists(url);
  if (known === false) return null;
  let res;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }
  if (!res.ok || !/^image\//.test(res.headers.get('content-type') || '')) return null;
  try {
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob, {
      resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none',
    });
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, size, size);
    bmp.close?.();
    return ctx.getImageData(0, 0, size, size).data;
  } catch {
    return null;
  }
}

function arrayTexture(data, size, layers, srgb, anisotropy) {
  const tex = new THREE.DataArrayTexture(data, size, size, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  // the CPU copy is only needed for the first upload
  tex.onUpdate = () => { tex.image.data = null; tex.onUpdate = null; };
  return tex;
}

/**
 * Load the 10 layers × 3 maps into three DataArrayTextures of `size`² per layer.
 * Returns { albedo, normal, orm, size, baked: [names loaded from files], procedural: [names generated] }.
 */
export async function loadTerrainTextures(size = 512, anisotropy = 4) {
  const MAPS = ['albedo', 'normal', 'orm'];
  // probe one file first: when the baked set is absent (e.g. before the lookdev delivery) skip 29 requests
  const probe = await fetchImageData('/textures/terrain/grass_albedo.webp', size);
  const results = {};
  if (probe) {
    await Promise.all(LAYERS.map(async (name) => {
      const maps = await Promise.all(MAPS.map((m) => (name === 'grass' && m === 'albedo' ? probe : fetchImageData(`/textures/terrain/${name}_${m}.webp`, size))));
      if (maps.every(Boolean)) results[name] = { albedo: maps[0], normal: maps[1], orm: maps[2] };
    }));
  }
  const missing = LAYERS.filter((n) => !results[n]);
  // all procedural → a smaller array is plenty
  const texSize = missing.length === LAYERS.length ? Math.min(size, 256) : size;
  if (missing.length) {
    const gen = await runInWorker({ type: 'layers', names: missing, size: texSize }, () => {
      const out = {};
      for (const n of missing) out[n] = generateLayer(n, texSize);
      return out;
    });
    for (const n of missing) results[n] = gen[n];
  }
  const layerBytes = texSize * texSize * 4;
  const packed = MAPS.map(() => new Uint8Array(layerBytes * LAYERS.length));
  LAYERS.forEach((name, li) => {
    MAPS.forEach((m, mi) => packed[mi].set(results[name][m].subarray(0, layerBytes), li * layerBytes));
  });
  return {
    albedo: arrayTexture(packed[0], texSize, LAYERS.length, true, anisotropy),
    normal: arrayTexture(packed[1], texSize, LAYERS.length, false, anisotropy),
    orm: arrayTexture(packed[2], texSize, LAYERS.length, false, anisotropy),
    size: texSize,
    baked: LAYERS.filter((n) => !missing.includes(n)),
    procedural: missing,
  };
}

/** Optional single texture (e.g. /textures/water_normal.webp). Returns null when missing. */
export async function loadOptionalTexture(url, { srgb = false, repeat = true, anisotropy = 4 } = {}) {
  const known = await assetExists(url);
  if (known === false) return null;
  try {
    const res = await fetch(url);
    if (!res.ok || !/^image\//.test(res.headers.get('content-type') || '')) return null;
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'flipY' });
    const tex = new THREE.Texture(bmp);
    tex.flipY = false; // already flipped by createImageBitmap
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

/** Data maps (height / splat / grass) as GPU textures. */
export function terrainDataTextures(data, floatLinear) {
  const V = data.size;
  let height;
  if (floatLinear) {
    height = new THREE.DataTexture(data.heights, V, V, THREE.RedFormat, THREE.FloatType);
  } else {
    const hf = new Uint16Array(V * V);
    for (let i = 0; i < hf.length; i++) hf[i] = THREE.DataUtils.toHalfFloat(data.heights[i]);
    height = new THREE.DataTexture(hf, V, V, THREE.RedFormat, THREE.HalfFloatType);
  }
  const lin = (t) => {
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const rgba = (arr) => lin(new THREE.DataTexture(arr, V, V, THREE.RGBAFormat, THREE.UnsignedByteType));
  return {
    height: lin(height),
    splat0: rgba(data.splat0),
    splat1: rgba(data.splat1),
    splat2: rgba(data.splat2),
    grass: rgba(data.grass),
    // uv = ((xz + half) / step + 0.5) / size
    info: new THREE.Vector4(data.half, data.step, V, 0),
  };
}
