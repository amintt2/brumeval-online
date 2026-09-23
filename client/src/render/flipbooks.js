// Flipbook VFX: Blender-rendered sprite sheets listed in /vfx/manifest.json
//   { "<name>": { file, cols, rows, frames, fps, loop, blending: 'additive' | 'normal', size } }
// Each sheet is ONE pooled InstancedMesh of camera-facing (or ground-aligned) quads. Everything per instance
// (position, start time, life, size, rotation, tint, drift velocity) lives in instanced attributes written once at
// spawn; the animation (frame, cross-fade between frames, growth, fades) runs in the shader from the global time,
// so an idle effect costs no CPU and a sheet with no live instance costs no draw call.
// When the manifest or a sheet is missing, `play()` returns null and effects.js keeps its procedural fallback.
import * as THREE from 'three';
import { assetExists } from './assetManifest.js';

const POOL = 48;
const OFF = -1e6; // start time of a free slot

const vert = /* glsl */ `
attribute vec4 iA;   // start, life (s, < 0 = endless loop), size (m), rotation
attribute vec4 iB;   // tint rgb, alpha
attribute vec4 iC;   // drift velocity xyz, flags (1 = ground-aligned)
attribute vec3 iPos;
uniform float uTime;
uniform float uFps;
uniform float uFrames;
uniform float uLoop;
varying vec2 vUv;
varying vec4 vTint;
varying float vFrame;
void main() {
  float age = uTime - iA.x;
  float life = iA.y;
  bool endless = life < 0.0;
  if (age < 0.0 || (!endless && age > life)) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float f = age * uFps;
  f = uLoop > 0.5 ? mod(f, uFrames) : min(f, uFrames - 1.0);
  vFrame = f;
  float fadeIn = smoothstep(0.0, 0.06, age);
  float fadeOut = endless ? 1.0 : 1.0 - smoothstep(life - min(0.3, life * 0.25), life, age);
  float grow = 1.0 + 0.12 * min(age, 2.0);
  vec3 center = iPos + iC.xyz * age;
  float s = iA.z * grow;
  float c = cos(iA.w), sn = sin(iA.w);
  vec2 corner = mat2(c, sn, -sn, c) * (position.xy * s);
  vec4 mv;
  if (iC.w > 0.5) {
    mv = viewMatrix * vec4(center + vec3(corner.x, 0.04, corner.y), 1.0);
  } else {
    mv = viewMatrix * vec4(center, 1.0);
    mv.xy += corner;
  }
  gl_Position = projectionMatrix * mv;
  // never let a sprite cover the whole screen when the camera passes through it
  float near = smoothstep(0.35, 1.6, -mv.z);
  vTint = vec4(iB.rgb, iB.a * fadeIn * fadeOut * near);
  vUv = position.xy + 0.5;
}`;

const frag = /* glsl */ `
uniform sampler2D uMap;
uniform float uCols;
uniform float uRows;
uniform float uFrames;
uniform float uLoop;
uniform float uGain;
uniform float uLight;
varying vec2 vUv;
varying vec4 vTint;
varying float vFrame;
vec4 cell(float f) {
  float col = mod(f, uCols);
  float row = floor(f / uCols);
  vec2 uv = (vec2(col, uRows - 1.0 - row) + clamp(vUv, 0.004, 0.996)) / vec2(uCols, uRows);
  return texture2D(uMap, uv);
}
void main() {
  float f0 = floor(vFrame);
  float f1 = f0 + 1.0;
  f1 = uLoop > 0.5 ? mod(f1, uFrames) : min(f1, uFrames - 1.0);
  vec4 t = mix(cell(f0), cell(f1), fract(vFrame));
  float a = t.a * vTint.a;
  if (a < 0.004) discard;
#ifdef FLIP_ADDITIVE
  gl_FragColor = vec4(t.rgb * vTint.rgb * a * uGain, 1.0);
#else
  gl_FragColor = vec4(t.rgb * vTint.rgb * uLight, a);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function quad() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const inst = (n) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(POOL * n), n);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  g.setAttribute('iPos', inst(3));
  g.setAttribute('iA', inst(4));
  g.setAttribute('iB', inst(4));
  g.setAttribute('iC', inst(4));
  for (let i = 0; i < POOL; i++) g.attributes.iA.setX(i, OFF);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);

/** Validate one manifest entry. Returns a normalised description or null. */
export function parseFlipbookEntry(name, e) {
  if (!e || typeof e !== 'object' || typeof e.file !== 'string' || !e.file) return null;
  if (!/^[\w./-]+$/.test(e.file) || e.file.includes('..')) return null;
  const cols = Math.round(num(e.cols, 1, 64, 0));
  const rows = Math.round(num(e.rows, 1, 64, 0));
  if (!cols || !rows) return null;
  const frames = Math.round(num(e.frames, 1, cols * rows, cols * rows));
  const blend = String(e.blending || 'additive').toLowerCase();
  return {
    name,
    url: e.file.startsWith('/') ? e.file : `/vfx/${e.file}`,
    cols,
    rows,
    frames,
    fps: num(e.fps, 1, 120, 24),
    loop: !!e.loop,
    additive: !/^(normal|alpha|blend|premultiplied)/.test(blend),
    size: num(e.size, 0.05, 50, 1.5),
  };
}

class Sheet {
  constructor(desc, texture, scene, uniforms) {
    this.desc = desc;
    this.geometry = quad();
    this.material = new THREE.ShaderMaterial({
      name: `vfx_${desc.name}`,
      vertexShader: vert,
      fragmentShader: frag,
      defines: desc.additive ? { FLIP_ADDITIVE: '' } : {},
      uniforms: {
        uTime: uniforms.uTime,
        uLight: uniforms.uLight,
        uGain: { value: desc.additive ? 2.2 : 1 },
        uMap: { value: texture },
        uCols: { value: desc.cols },
        uRows: { value: desc.rows },
        uFrames: { value: desc.frames },
        uFps: { value: desc.fps },
        uLoop: { value: desc.loop ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: desc.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.texture = texture;
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = `vfx_${desc.name}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = desc.additive ? 24 : 20;
    // visible until the first update so that the shader warm-up (renderer.compileAsync) compiles it
    this.mesh.visible = true;
    scene.add(this.mesh);
    this.slots = Array.from({ length: POOL }, () => ({ start: OFF, life: 0, follow: null, gen: 0 }));
    this.dirty = false;
  }

  _free(now) {
    let best = -1, oldest = Infinity;
    for (let i = 0; i < POOL; i++) {
      const s = this.slots[i];
      if (s.start === OFF || (s.life >= 0 && now - s.start > s.life)) return i;
      // steal the oldest finite effect when the pool is full (never an endless loop)
      if (s.life >= 0 && s.start < oldest) { oldest = s.start; best = i; }
    }
    return best;
  }

  spawn(now, pos, o) {
    const i = this._free(now);
    if (i < 0) return null;
    const d = this.desc;
    const g = this.geometry;
    const life = (o.loop ?? d.loop) ? -1 : (o.life ?? d.frames / d.fps);
    const start = now + (o.delay || 0);
    const s = this.slots[i];
    s.start = start;
    s.life = life;
    s.follow = o.follow || null;
    s.gen++;
    g.attributes.iPos.setXYZ(i, pos.x, pos.y, pos.z);
    g.attributes.iA.setXYZW(i, start, life, o.size ?? d.size, o.rotation ?? Math.random() * Math.PI * 2);
    const c = o.color;
    g.attributes.iB.setXYZW(i, c ? c.r : 1, c ? c.g : 1, c ? c.b : 1, o.alpha ?? 1);
    const v = o.velocity;
    g.attributes.iC.setXYZW(i, v ? v.x : 0, v ? v.y : 0, v ? v.z : 0, o.ground ? 1 : 0);
    this.dirty = true;
    if (i + 1 > g.instanceCount) g.instanceCount = i + 1;
    return { sheet: this, index: i, gen: s.gen };
  }

  stop(h, now, fade = 0.3) {
    const s = this.slots[h.index];
    if (s.gen !== h.gen) return;
    const age = now - s.start;
    s.life = Math.max(0, age) + fade;
    s.follow = null;
    this.geometry.attributes.iA.setY(h.index, s.life);
    this.dirty = true;
  }

  update(now) {
    const g = this.geometry;
    let top = 0;
    for (let i = 0; i < POOL; i++) {
      const s = this.slots[i];
      if (s.start === OFF) continue;
      if (s.life >= 0 && now - s.start > s.life) {
        s.start = OFF;
        s.follow = null;
        g.attributes.iA.setX(i, OFF);
        this.dirty = true;
        continue;
      }
      top = i + 1;
      if (s.follow) {
        const p = s.follow();
        if (p) { g.attributes.iPos.setXYZ(i, p.x, p.y, p.z); this.dirty = true; }
      }
    }
    g.instanceCount = top;
    this.mesh.visible = top > 0;
    if (this.dirty) {
      for (const k of ['iPos', 'iA', 'iB', 'iC']) g.attributes[k].needsUpdate = true;
      this.dirty = false;
    }
  }

  clear() {
    for (let i = 0; i < POOL; i++) {
      this.slots[i].start = OFF;
      this.slots[i].follow = null;
      this.geometry.attributes.iA.setX(i, OFF);
    }
    this.dirty = true;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

export class Flipbooks {
  constructor(scene, { anisotropy = 1 } = {}) {
    this.scene = scene;
    this.sheets = new Map();
    this.anisotropy = anisotropy;
    this.uniforms = { uTime: { value: 0 }, uLight: { value: 1 } };
    this.time = 0;
    this.names = [];
    this.ready = this._load().catch(() => []);
  }

  async _load() {
    if (await assetExists('/vfx/manifest.json') === false) return [];
    let manifest;
    try {
      const res = await fetch('/vfx/manifest.json', { cache: 'no-cache' });
      if (!res.ok || !/json/.test(res.headers.get('content-type') || '')) return [];
      manifest = await res.json();
    } catch {
      return [];
    }
    if (!manifest || typeof manifest !== 'object') return [];
    const loader = new THREE.TextureLoader();
    await Promise.all(Object.entries(manifest).map(async ([name, entry]) => {
      const desc = parseFlipbookEntry(name, entry);
      if (!desc) return;
      if (await assetExists(desc.url) === false) return;
      try {
        const tex = await loader.loadAsync(desc.url);
        if (!tex?.image?.width) { tex?.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = this.anisotropy;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        this.sheets.set(name, new Sheet(desc, tex, this.scene, this.uniforms));
      } catch {
        /* missing / unreadable sheet: the procedural effect stays */
      }
    }));
    this.names = [...this.sheets.keys()].sort();
    return this.names;
  }

  has(name) {
    return this.sheets.has(name);
  }

  /**
   * Play flipbook `name` at `pos` (THREE.Vector3-like). Options: size (m), color (THREE.Color), alpha, rotation,
   * ground (lie flat on the ground), velocity (drift m/s), life (s), loop, delay (s), follow() → position | null.
   * Returns a handle (for stop) or null when the sheet is not available.
   */
  play(name, pos, opts = {}) {
    const s = this.sheets.get(name);
    if (!s) return null;
    return s.spawn(this.time, pos, opts);
  }

  stop(handle, fade) {
    handle?.sheet?.stop(handle, this.time, fade);
  }

  /** Brightness of the alpha-blended (lit-looking) sheets: 1 by day, darker at night. */
  setLight(v) {
    this.uniforms.uLight.value = v;
  }

  update(dt, time) {
    this.time = time;
    this.uniforms.uTime.value = time;
    for (const s of this.sheets.values()) s.update(time);
  }

  clear() {
    for (const s of this.sheets.values()) s.clear();
  }

  dispose() {
    for (const s of this.sheets.values()) s.dispose(this.scene);
    this.sheets.clear();
  }
}
