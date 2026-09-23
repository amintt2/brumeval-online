// Image-based lighting.
//  - Loads the Blender HDRIs (/env/sky_{day,golden,night,overcast}.hdr) when they exist, measures and normalises
//    their brightness, and hands them to the sky dome as a blended layer.
//  - Renders the sky ("env pass") into a small cube map and prefilters it with PMREM → scene.environment.
//    Refreshed a couple of times per second at most (the day lasts 20 minutes), reusing every render target.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { assetExists } from './assetManifest.js';

export const HDR_NAMES = ['day', 'golden', 'night', 'overcast'];
/** Target mean luminance of the upper hemisphere of each HDRI (keeps them consistent with the sun). */
const HDR_TARGET = { day: 1.15, golden: 0.62, night: 0.05, overcast: 0.9 };

/** Mean luminance of the upper half of an equirect half-float texture (sub-sampled). */
function upperMeanLuminance(tex) {
  const { data, width, height } = tex.image;
  if (!data || !width || !height) return 1;
  const stride = data.length / (width * height); // 4 (RGBA) usually
  const half = data instanceof Uint16Array;
  const f = half ? THREE.DataUtils.fromHalfFloat : (v) => v;
  let sum = 0, n = 0;
  const step = Math.max(1, Math.floor(width / 128));
  // equirect: row 0 is the top (flipY false for DataTexture) — sample rows from the zenith to the horizon
  for (let y = 0; y < height / 2; y += step) {
    const lat = ((y + 0.5) / height) * Math.PI; // 0 at the zenith
    const w = Math.sin(lat); // solid-angle weight
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * stride;
      const l = 0.2126 * f(data[i]) + 0.7152 * f(data[i + 1]) + 0.0722 * f(data[i + 2]);
      if (Number.isFinite(l)) { sum += Math.min(l, 50) * w; n += w; }
    }
  }
  return n > 0 ? sum / n : 1;
}

export class EnvironmentLighting {
  constructor(renderer, sky) {
    this.renderer = renderer;
    this.sky = sky;
    this.hdr = {}; // name -> { tex, norm }
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(1, 2000, this.cubeRT);
    this.envScene = new THREE.Scene();
    this.envScene.add(sky.envDome);
    this.target = null;
    this.acc = Infinity;
    this.texture = null;
  }

  /** Try to load the HDRIs (never rejects). Returns the list of loaded names. */
  async load() {
    const loader = new HDRLoader();
    loader.setDataType(THREE.HalfFloatType);
    const loaded = [];
    await Promise.all(HDR_NAMES.map(async (name) => {
      try {
        const url = `/env/sky_${name}.hdr`;
        if ((await assetExists(url)) === false) return; // not shipped (manifest): no 404 request
        const tex = await loader.loadAsync(url);
        if (!tex?.image?.width) throw new Error('vide');
        const mean = upperMeanLuminance(tex);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.LinearSRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
        this.hdr[name] = { tex, norm: HDR_TARGET[name] / Math.max(1e-4, mean) };
        loaded.push(name);
      } catch {
        /* missing file (404 / SPA fallback) → procedural sky only */
      }
    }));
    const U = this.sky.uniforms;
    HDR_NAMES.forEach((name, i) => { if (this.hdr[name]) U[`uHdr${i}`].value = this.hdr[name].tex; });
    this.available = loaded.length > 0;
    return loaded;
  }

  /**
   * Blend weights of the HDRIs for a time of day (0..1) and an overcast factor (0..1).
   * Writes normalised weights (× brightness normalisation) into the sky uniforms.
   */
  setBlend(tod, overcast = 0) {
    const U = this.sky.uniforms;
    if (!this.available) { U.uHdrMix.value = 0; return; }
    const sunH = Math.sin((tod - 0.25) * Math.PI * 2); // sun height -1..1
    const golden = Math.exp(-((sunH - 0.12) ** 2) / 0.012);
    const day = THREE.MathUtils.smoothstep(sunH, 0.12, 0.45);
    const night = THREE.MathUtils.smoothstep(-sunH, 0.02, 0.2);
    let w = [day, golden, night, 0];
    w = w.map((v) => v * (1 - overcast));
    w[3] = overcast;
    // redistribute the weight of missing HDRIs
    const names = HDR_NAMES;
    let total = 0;
    for (let i = 0; i < 4; i++) { if (!this.hdr[names[i]]) w[i] = 0; total += w[i]; }
    if (total < 1e-4) {
      // e.g. only "day" exists and it's night: keep the closest one, darkened by the gradient itself
      const i = names.findIndex((n) => this.hdr[n]);
      w = [0, 0, 0, 0];
      w[i] = 1;
      total = 1;
    }
    U.uHdrW.value.set(
      (w[0] / total) * (this.hdr.day?.norm || 0),
      (w[1] / total) * (this.hdr.golden?.norm || 0),
      (w[2] / total) * (this.hdr.night?.norm || 0),
      (w[3] / total) * (this.hdr.overcast?.norm || 0),
    );
    U.uHdrMix.value = 0.6;
  }

  /** Re-capture the sky into the IBL map when due (every `period` seconds) or when forced. */
  update(dt, scene, force = false, period = 0.6) {
    this.acc += dt;
    if (!force && this.acc < period) return false;
    this.acc = 0;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevXr = r.xr.enabled;
    const prevShadow = r.shadowMap.autoUpdate;
    r.xr.enabled = false;
    r.shadowMap.autoUpdate = false;
    this.cubeCam.update(r, this.envScene);
    r.shadowMap.autoUpdate = prevShadow;
    this.target = this.pmrem.fromCubemap(this.cubeRT.texture, this.target);
    r.setRenderTarget(prevTarget);
    r.xr.enabled = prevXr;
    if (scene.environment !== this.target.texture) {
      scene.environment = this.target.texture;
      this.texture = this.target.texture;
    }
    return true;
  }

  dispose() {
    this.pmrem.dispose();
    this.cubeRT.dispose();
    this.target?.dispose();
    for (const h of Object.values(this.hdr)) h.tex.dispose();
  }
}
