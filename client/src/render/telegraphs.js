// [combat-souls] Telegraphed attacks (S2C `tele` / `tele_end`): terrain-conforming ground decals that fill up
// until the impact — soulslike clarity: faint red area, bright outline, an orange fill sweeping from the origin
// (circle/cone: centre → edge, ring: inner → outer, line: along the charge), a flash at the impact.
// Also plays the attacker's clip (Attack2 / Special…) time-scaled so that the strike lands with the impact.
import * as THREE from 'three';
import { terrainHeight } from '@shared/world.js';
import './souls.css';
import { windupMs } from './teleTiming.js';

export { windupMs };

const SHAPE_ID = { circle: 0, ring: 1, cone: 2, line: 3 };
const LIFT = 0.08;
const FLASH_S = 0.14;
const FADE_S = 0.32;
const CANCEL_S = 0.22;
const STRIKE_AT = 0.55; // fraction of a wind-up clip where the strike happens

const vert = /* glsl */ `
attribute float aF;
attribute float aS;
varying float vF;
varying float vS;
void main() {
  vF = aF; vS = aS;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uFill;
uniform float uP;
uniform float uFade;
uniform float uFlash;
uniform float uTime;
uniform float uShape;
varying float vF;
varying float vS;
void main() {
  // distance to the border in "shape units" (0 at the border)
  float outer = 1.0 - vF;
  float side = 1.0 - abs(vS);
  float border = outer;
  if (uShape > 0.5 && uShape < 1.5) border = min(outer, vF);           // ring: inner edge too
  if (uShape > 1.5) border = min(border, side * 3.0);                    // cone / line: side edges
  if (uShape > 2.5) border = min(side * 2.0, min(outer, vF * 6.0));     // line: start edge
  float edge = 1.0 - smoothstep(0.0, 0.05, border);
  // filled part (grows with the wind-up) and its bright front
  float filled = step(vF, uP);
  float front = exp(-pow((vF - uP) * 30.0, 2.0)) * step(0.02, uP) * (1.0 - step(0.999, uP));
  float pulse = 0.85 + 0.15 * sin(uTime * 10.0);
  vec3 col = mix(uBase, uFill, filled * 0.75 + front);
  float a = 0.16 + filled * 0.30 + front * 0.55 + edge * 0.75 * pulse;
  col = mix(col, vec3(1.0, 0.93, 0.8), uFlash * 0.7);
  a = max(a, uFlash * 0.85);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.95) * uFade);
}`;

/** Grid geometry in world space for a telegraph message. */
function buildGeometry(t) {
  const pos = [], aF = [], aS = [], idx = [];
  const pushV = (x, z, f, s) => {
    pos.push(x, terrainHeight(x, z) + LIFT, z);
    aF.push(f); aS.push(s);
  };
  const grid = (nu, nv, fn) => {
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) fn(i / nu, j / nv);
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = i * (nv + 1) + j, b = a + nv + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  };
  const sa = Math.sin(t.a || 0), ca = Math.cos(t.a || 0);
  switch (t.shape) {
    case 'ring': {
      const r0 = t.r2 || 0, r1 = t.r;
      const segs = Math.max(48, Math.ceil(r1 * 7));
      grid(Math.max(4, Math.ceil((r1 - r0) * 1.2)), segs, (u, v) => {
        const rr = r0 + (r1 - r0) * u, ang = v * Math.PI * 2;
        pushV(t.x + Math.sin(ang) * rr, t.z + Math.cos(ang) * rr, u, 0);
      });
      break;
    }
    case 'cone': {
      const half = (t.arc || Math.PI / 2) / 2;
      const segs = Math.max(12, Math.ceil(t.r * half * 4));
      grid(Math.max(5, Math.ceil(t.r * 1.2)), segs, (u, v) => {
        const rr = Math.max(0.001, t.r * u), ang = (t.a || 0) + (v * 2 - 1) * half;
        pushV(t.x + Math.sin(ang) * rr, t.z + Math.cos(ang) * rr, u, v * 2 - 1);
      });
      break;
    }
    case 'line': {
      const len = t.len || 1, w = t.w || 1;
      grid(Math.max(4, Math.ceil(len * 1.5)), 4, (u, v) => {
        const along = len * u, across = (v * 2 - 1) * (w / 2);
        // forward (sa, ca), right (ca, -sa)
        pushV(t.x + sa * along + ca * across, t.z + ca * along - sa * across, u, v * 2 - 1);
      });
      break;
    }
    default: { // circle
      const segs = Math.max(40, Math.ceil(t.r * 8));
      grid(Math.max(5, Math.ceil(t.r * 1.5)), segs, (u, v) => {
        const rr = t.r * u, ang = v * Math.PI * 2;
        pushV(t.x + Math.sin(ang) * rr, t.z + Math.cos(ang) * rr, u, 0);
      });
      break;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aF', new THREE.Float32BufferAttribute(aF, 1));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Colour themes per attack family (all readable red / orange on grass, sand and stone).
const THEMES = {
  default: { base: '#ff2a14', fill: '#ff8a1e' },
  boss: { base: '#ff1438', fill: '#ff6a1a' },
  arcane: { base: '#c02aff', fill: '#ff5ad2' },
};
const themeOf = (ab) => (ab?.startsWith('golem') ? THEMES.boss : ab === 'skel_curse' ? THEMES.arcane : THEMES.default);

export class Telegraphs {
  /** ctx: { scene, entities: EntityRenderer } */
  constructor(ctx) {
    this.ctx = ctx;
    this.list = new Map(); // id -> decal
    this.time = 0;
    this.pendingAnims = [];
  }

  /**
   * S2C tele. `rtt` = smoothed round trip (ms): the server resolves the hit `ms` after it SENT the telegraph, and
   * a roll / step needs half a round trip to reach it, so the decal is full at the last moment an answer can still
   * arrive in time (now + ms - rtt, see windupMs). Without it, a roll timed on the decal was always one RTT late.
   */
  add(m, now = performance.now(), rtt = 0) {
    if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.z) || !SHAPE_ID.hasOwnProperty(m.shape)) return;
    this.remove(m.id);
    const theme = themeOf(m.ab);
    const u = {
      uBase: { value: new THREE.Color(theme.base) },
      uFill: { value: new THREE.Color(theme.fill) },
      uP: { value: 0 },
      uFade: { value: 1 },
      uFlash: { value: 0 },
      uTime: { value: this.time },
      uShape: { value: SHAPE_ID[m.shape] },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'telegraph',
      uniforms: u,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      fog: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(buildGeometry(m), mat);
    mesh.name = `tele${m.id}`;
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    this.ctx.scene.add(mesh);
    const ms = windupMs(Math.max(50, m.ms || 800), rtt);
    this.list.set(m.id, { id: m.id, src: m.src, mesh, u, start: now, end: now + ms, state: 'wind', t: 0, x: m.x, z: m.z, shape: m.shape, r: m.r });
    if (m.clip && m.src) this._animate(m.src, m.clip, ms, now);
  }

  /** Play the attacker's clip so that its strike (STRIKE_AT of the clip) lands at the impact. */
  _animate(src, clip, ms, now) {
    const v = this.ctx.entities.get(src);
    if (!v) return;
    const a = v.animator;
    const real = a.has(clip);
    const dur = a.clipDuration?.(clip) ?? 1.2;
    if (real) {
      v.animator.play(clip, { timeScale: (STRIKE_AT * dur) / (ms / 1000) });
      return;
    }
    // no such clip on this model: procedural wind-up, then the regular Attack clip right before the impact
    v.animator.play(clip, { timeScale: (STRIKE_AT * dur) / (ms / 1000) });
    if (a.has('Attack')) {
      const atkDur = a.clipDuration('Attack');
      this.pendingAnims.push({ src, clip: 'Attack', at: now + Math.max(0, ms - atkDur * 1000 * 0.4) });
    }
  }

  /** S2C tele_end: the attack was cancelled (stagger, death). */
  cancel(id) {
    const d = this.list.get(id);
    if (!d || d.state !== 'wind') return;
    d.state = 'cancel';
    d.t = 0;
    this.pendingAnims = this.pendingAnims.filter((p) => p.src !== d.src);
  }

  remove(id) {
    const d = this.list.get(id);
    if (!d) return;
    this.ctx.scene.remove(d.mesh);
    d.mesh.geometry.dispose();
    d.mesh.material.dispose();
    this.list.delete(id);
  }

  clear() {
    for (const id of [...this.list.keys()]) this.remove(id);
    this.pendingAnims.length = 0;
  }

  /** Active (winding-up) telegraphs, for debugging / tests. */
  active() {
    return [...this.list.values()].filter((d) => d.state === 'wind').map((d) => ({ id: d.id, shape: d.shape, x: d.x, z: d.z, p: d.u.uP.value }));
  }

  update(dt, time, now = performance.now()) {
    this.time = time;
    for (let i = this.pendingAnims.length - 1; i >= 0; i--) {
      const p = this.pendingAnims[i];
      if (now >= p.at) {
        this.ctx.entities.get(p.src)?.animator.play(p.clip);
        this.pendingAnims.splice(i, 1);
      }
    }
    for (const d of [...this.list.values()]) {
      const u = d.u;
      u.uTime.value = time;
      if (d.state === 'wind') {
        const k = Math.min(1, (now - d.start) / Math.max(1, d.end - d.start));
        u.uP.value = k * k * (3 - 2 * k) * 0.35 + k * 0.65; // eases in, reads linearly
        if (now >= d.end) { d.state = 'flash'; d.t = 0; u.uP.value = 1; }
      } else if (d.state === 'flash') {
        d.t += dt;
        u.uFlash.value = 1 - d.t / FLASH_S;
        if (d.t >= FLASH_S) { d.state = 'fade'; d.t = 0; u.uFlash.value = 0; }
      } else {
        d.t += dt;
        const dur = d.state === 'cancel' ? CANCEL_S : FADE_S;
        u.uFade.value = Math.max(0, 1 - d.t / dur);
        if (d.t >= dur) this.remove(d.id);
      }
    }
  }
}
