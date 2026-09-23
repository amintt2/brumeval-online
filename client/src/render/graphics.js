// Graphics orchestrator: owns the quality settings and wires them into the environment (shadows, IBL, fog), the
// post-processing pipeline, the terrain / grass / water / world objects, dynamic resolution, the FPS limiter,
// GPU timing and the start-up benchmark that picks the initial preset.
import * as THREE from 'three';
import { WORLD_HALF, TERRAIN_STEP } from '@shared/world.js';
import { URLP } from '../config.js';
import {
  getSettings, applyPreset, onSettingsChange, hasSavedSettings, presetFromBenchmark, PRESETS,
} from './quality.js';
import { PostPipeline } from './post.js';
import { Terrain, buildMountainRing, buildWater } from './terrain.js';
import { loadTerrainData, loadTerrainTextures, loadOptionalTexture, terrainDataTextures, disposeTerrainWorker } from './terrainTextures.js';
import { GrassField } from './grass.js';
import { WIND, updateWind } from './wind.js';
import { preloadManifest } from './assetManifest.js';
import { SMALL_CASTER_LAYER } from './shadows.js';

/**
 * Direct3D (ANGLE) prints HLSL compiler *notes* in the program info log of perfectly valid shaders, e.g. three's own
 * PMREM filter ("warning X4122: sum of … cannot be represented accurately"). They are kept for debugging in
 * `shaderNotes` instead of the console; anything else (real errors / other warnings) is forwarded unchanged.
 */
export const shaderNotes = [];
const BENIGN_HLSL = /^\s*(\(\d+,[\d-]+\):\s*)?warning X(4122|3595|3557|3570|3571|4000|4008)\b/;
{
  const prev = THREE.getConsoleFunction?.();
  THREE.setConsoleFunction?.((type, message, ...params) => {
    if (type === 'warn' && String(message).startsWith('THREE.WebGLProgram: Program Info Log')) {
      const lines = String(params[0] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => BENIGN_HLSL.test(l))) {
        if (shaderNotes.length < 50) shaderNotes.push(lines.join(' | '));
        return;
      }
    }
    if (prev) prev(type, message, ...params);
    else (console[type] || console.log)(message, ...params);
  });
}

const TEST_PRESET = (() => {
  try {
    const p = new URLSearchParams(location.search).get('gfx');
    return p && PRESETS[p] ? p : null;
  } catch {
    return null;
  }
})();

/** GPU frame time through EXT_disjoint_timer_query_webgl2 (when the browser exposes it). */
class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.queries = [];
    this.active = null;
    this.ms = 0;
  }

  get available() {
    return !!this.ext;
  }

  begin() {
    if (!this.ext || this.active) return;
    const q = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.queries.push(this.active);
    this.active = null;
    this.poll();
  }

  poll() {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      this.queries.shift();
      gl.deleteQuery(q);
      if (!disjoint) this.ms = this.ms ? this.ms * 0.9 + (ns / 1e6) * 0.1 : ns / 1e6;
    }
    // never let the queue grow (e.g. hidden tab)
    while (this.queries.length > 6) gl.deleteQuery(this.queries.shift());
  }
}

export class Graphics {
  constructor({ renderer, scene, camera, env }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.env = env;
    this.post = null;
    this.terrain = null;
    this.grass = null;
    this.water = null;
    this.world = null;
    this.scale = 1;          // dynamic resolution scale
    this._lastTs = -1e9;
    this._dyn = { acc: 0, dtEma: 16.7, up: 0 };
    this.frameMs = 0;
    this.gpu = new GpuTimer(renderer.getContext());
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    renderer.info.autoReset = false;
    camera.layers.enable(SMALL_CASTER_LAYER);
    this.settings = TEST_PRESET ? { ...PRESETS[TEST_PRESET], preset: TEST_PRESET } : getSettings();
    if (URLP.quality === 'low') this.settings = { ...PRESETS.bas, preset: 'bas' };
    this._unsub = onSettingsChange((s) => {
      if (TEST_PRESET || URLP.quality === 'low') return;
      this.apply(s);
    });
    this._benders = [];
    for (let i = 0; i < 12; i++) this._benders.push({ x: 0, z: 0, r: 0, s: 1 });
    this.apply(this.settings);
  }

  get anisotropy() {
    const s = this.settings;
    return Math.min(this.maxAniso, s.shadows >= 3 ? 16 : s.shadows >= 2 ? 8 : 4);
  }

  get viewDistance() {
    return 260 * this.settings.distance;
  }

  /** Apply a settings object (from quality.js). */
  apply(s) {
    const prev = this.settings;
    this.settings = s;
    const r = this.renderer;
    this.env.configure(s, this.viewDistance);
    if (s.post && !this.post) this.post = new PostPipeline(r);
    this.post?.setOptions({ ao: s.ao, fog: s.fog });
    // pixel ratio (the canvas buffer); the dynamic scale is applied on top
    const pr = Math.min(window.devicePixelRatio || 1, s.pixelRatio);
    if (Math.abs(r.getPixelRatio() - pr) > 1e-3) r.setPixelRatio(pr);
    if (!s.dynres) this.scale = 1;
    this._applyWorld();
    if (prev && prev !== s && (prev.post !== s.post || prev.pixelRatio !== s.pixelRatio)) this.resize();
  }

  _applyWorld() {
    const s = this.settings;
    if (this.terrain) {
      this.terrain.viewDistance = this.viewDistance;
      this.terrain.setDetail(s.shadows >= 1 || s.post);
      // (texture-array anisotropy is fixed at load time: the CPU copy is released after the upload)
    }
    if (this.grass) {
      const radius = Math.min(78, (26 + 44 * s.grass) * Math.max(0.8, s.distance));
      this.grass.configure(s.grass, radius);
    }
    this.world?.setDistance(s.distance);
  }

  /**
   * Build terrain (worker), texture arrays, mountains, water, grass, HDRIs. onProgress(fraction, text).
   * Returns { terrain, water, ring }.
   */
  async buildWorld(onProgress) {
    const floatLinear = this.renderer.extensions.has('OES_texture_float_linear');
    onProgress?.(0.1, 'Sculpture du terrain…');
    await preloadManifest();
    const size = this.settings.preset === 'ultra' ? 1024 : 512;
    const [data, layers, waterNormal, foam, atlas] = await Promise.all([
      loadTerrainData(WORLD_HALF, TERRAIN_STEP),
      loadTerrainTextures(size, Math.min(this.maxAniso, 8)),
      loadOptionalTexture('/textures/water_normal.webp', { anisotropy: this.anisotropy }),
      loadOptionalTexture('/textures/foam.webp', { anisotropy: 4 }),
      loadOptionalTexture('/textures/grass_blades.webp', { srgb: true, repeat: false, anisotropy: 4 }),
      this.env.loadHdr(),
    ]);
    onProgress?.(0.8, 'Peinture des sols…');
    const maps = terrainDataTextures(data, floatLinear);
    this.maps = maps;
    this.terrainData = data;
    this.terrain = new Terrain(data, maps, layers);
    this.scene.add(this.terrain.group);
    this.ring = buildMountainRing(this.terrain.ringMaterial);
    this.scene.add(this.ring);
    this.water = await buildWater(maps, { normal: waterNormal, foam });
    this.scene.add(this.water.mesh);
    if (atlas) {
      atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
      atlas.generateMipmaps = true;
    }
    this.grass = new GrassField(this.scene, maps, data, atlas);
    this.textureInfo = { terrainLayers: layers.size, baked: layers.baked, procedural: layers.procedural, waterNormal: !!waterNormal, foam: !!foam, grassAtlas: !!atlas, hdr: Object.keys(this.env.ibl.hdr) };
    disposeTerrainWorker();
    this._applyWorld();
    onProgress?.(1, 'Terrain prêt');
    return { terrain: this.terrain, water: this.water, ring: this.ring };
  }

  attachWorld(world) {
    this.world = world;
    this._applyWorld();
  }

  /** Call from the animation loop before simulating: true = skip this frame (FPS limit). */
  skipFrame(ts) {
    const cap = this.settings.fpsCap;
    if (!cap) return false;
    const interval = 1000 / cap;
    if (ts - this._lastTs < interval - 1.0) return true;
    this._lastTs = ts - Math.min(interval, Math.max(0, ts - this._lastTs - interval));
    return false;
  }

  resize() {
    const r = this.renderer;
    const w = window.innerWidth, h = window.innerHeight;
    r.setSize(w, h, false);
    if (this.post) {
      const pr = r.getPixelRatio();
      this.post.setSize(w * pr * this.scale, h * pr * this.scale);
    }
  }

  /** The bending "benders": the player and the nearest characters. */
  _collectBenders(focus, entities) {
    const out = this._benders;
    let n = 0;
    if (entities) {
      for (const rec of entities.values ? entities.values() : entities) {
        if (n >= out.length) break;
        if (!rec || rec.dead || !Number.isFinite(rec.x)) continue;
        const dx = rec.x - focus.x, dz = rec.z - focus.z;
        if (dx * dx + dz * dz > 30 * 30) continue;
        const v = rec.view;
        const rad = v ? Math.max(0.6, v.radius * v.scale * 1.6) : 0.9;
        const b = out[n++];
        b.x = rec.x; b.z = rec.z; b.r = rad; b.s = 1;
      }
    }
    for (let i = n; i < out.length; i++) out[i].r = 0;
    return out;
  }

  /** Per frame, before render(): environment, wind, terrain LODs, grass, water, post parameters. */
  update(dt, time, tod, focus, entities) {
    const env = this.env;
    env.update(tod, focus, this.camera, time, dt);
    updateWind(dt, time, this._collectBenders(focus, entities));
    const cam = this.camera.position;
    this.terrain?.update(cam);
    this.grass?.update(cam, focus, env);
    this.water?.update(time, env, WIND.uWindDir.value);
    this.renderer.toneMappingExposure = env.palette.exposure;
    if (this.post) {
      const P = this.post.params;
      const pal = env.palette;
      P.exposure = pal.exposure;
      P.bloom = pal.bloom;
      P.bloomThreshold = 1.4;
      P.fogColor.copy(env.fogColor);
      P.fogDensity = pal.dens * 0.36;
      P.fogFalloff = pal.fogH;
      P.fogBase = -1.2;
      P.shafts = pal.shafts * (env.lightIntensity > 0.05 ? 1 : 0);
      P.sunDir.copy(env.lightDir);
      P.sunColor.copy(env.lightColor).multiplyScalar(env.lightIntensity * 0.35);
      P.night = env.night;
      P.wind = WIND.uWindDir.value;
    }
    this._dynamicResolution(dt);
  }

  _dynamicResolution(dt) {
    const s = this.settings;
    const D = this._dyn;
    this.frameMs = this.gpu.available && this.gpu.ms > 0 ? this.gpu.ms : 0;
    D.dtEma = D.dtEma * 0.92 + dt * 1000 * 0.08;
    if (!s.dynres) return;
    D.acc += dt;
    if (D.acc < 0.5) return;
    D.acc = 0;
    const target = 1000 / (s.fpsCap || 60);
    let next = this.scale;
    if (this.frameMs > 0) {
      // GPU time known: aim at 85 % of the frame budget
      if (this.frameMs > target * 0.92) next = this.scale * Math.max(0.85, Math.sqrt((target * 0.85) / this.frameMs));
      else if (this.frameMs < target * 0.6) next = this.scale + 0.05;
    } else if (D.dtEma > target * 1.2) {
      next = this.scale - 0.1;
      D.up = 0;
    } else if (D.dtEma < target * 1.05) {
      D.up += 0.5;
      if (D.up >= 4) { next = this.scale + 0.05; D.up = 0; }
    }
    next = Math.min(1, Math.max(0.55, Math.round(next * 20) / 20));
    if (Math.abs(next - this.scale) >= 0.049) {
      this.scale = next;
      if (this.settings.post && this.post) this.resize();
      else {
        const pr = Math.min(window.devicePixelRatio || 1, s.pixelRatio) * this.scale;
        this.renderer.setPixelRatio(pr);
        this.resize();
      }
    }
  }

  /** Render the frame (post pipeline or direct). */
  render(time) {
    const r = this.renderer;
    r.info.reset();
    this.gpu.begin();
    if (this.settings.post && this.post) {
      this.post.render(this.scene, this.camera, time);
    } else {
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
    }
    this.gpu.end();
  }

  /** Rendering statistics (draw calls include the shadow and post passes). */
  stats() {
    const i = this.renderer.info;
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      points: i.render.points,
      gpuMs: +this.frameMs.toFixed(2),
      scale: this.scale,
      textures: i.memory.textures,
      geometries: i.memory.geometries,
      grassTiles: this.grass?.tileCount || 0,
      preset: this.settings.preset,
    };
  }

  /**
   * First launch (no saved settings): render a few frames at "Élevé" and pick the preset from the median frame
   * time. Returns the chosen preset id (or null when settings already exist).
   */
  async autoDetect() {
    if (hasSavedSettings() || TEST_PRESET || URLP.quality === 'low') return null;
    const gl = this.renderer.getContext();
    let gpuName = '';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpuName = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    } catch {
      gpuName = '';
    }
    const prev = this.settings;
    this.apply({ ...PRESETS.eleve, preset: 'eleve' });
    this.resize();
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* optional */
    }
    const px = new Uint8Array(4);
    const times = [];
    for (let i = 0; i < 14; i++) {
      const t0 = performance.now();
      this.update(1 / 60, i / 60, 0.3, this.camera.position.clone().setY(0), null);
      this.render(i / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // forces the GPU to finish
      const ms = performance.now() - t0;
      if (i >= 4) times.push(ms);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] || 16;
    // scale the measure to 1080p when the window is smaller / bigger
    const pixels = this.renderer.domElement.width * this.renderer.domElement.height;
    const norm = median * Math.min(2.5, Math.max(0.6, (1920 * 1080) / Math.max(1, pixels)));
    const id = presetFromBenchmark(norm, gpuName);
    this.settings = prev;
    applyPreset(id, { auto: true });
    this.benchmark = { ms: +median.toFixed(2), normalized1080p: +norm.toFixed(2), gpu: gpuName, preset: id };
    return id;
  }

  dispose() {
    this._unsub?.();
    this.post?.dispose();
    this.grass?.dispose();
    this.terrain?.dispose();
  }
}
