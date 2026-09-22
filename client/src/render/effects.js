// Combat visual effects: projectiles (fire orbs with lights and trails, arrows), AOE ground decals (fire / frost /
// arrow rain / golem slam), melee slash arcs, whirlwind, heal sparkles, level-up pillar, respawn column, hit
// sparks, death puffs and floating combat text. Everything is pooled.
import * as THREE from 'three';
import { FX, KIND } from '@shared/protocol.js';
import { ABILITIES } from '@shared/data.js';
import { terrainHeight } from '@shared/world.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ParticleSystem } from './particles.js';
import { glowTexture, sparkTexture, smokeTexture } from './textures.js';
import { RENDER } from '../config.js';

const col = (hex) => new THREE.Color(hex);
const AB = {
  strike: { color: col('#fff4dc'), slash: 1 },
  heavy_blow: { color: col('#ffb347'), slash: 1.35 },
  whirlwind: { color: col('#e4ecff') },
  war_cry: { color: col('#ff5a2a') },
  firebolt: { color: col('#ff7a1a'), proj: 'fire', size: 0.2 },
  fireball: { color: col('#ff5010'), proj: 'fire', size: 0.38, explode: true },
  frost_nova: { color: col('#7fd4ff') },
  heal: { color: col('#7dffa0') },
  shot: { color: col('#f5e6c8'), proj: 'arrow' },
  piercing_shot: { color: col('#8fe4ff'), proj: 'arrow', glow: true },
  arrow_rain: { color: col('#ffd870') },
  rapid_fire: { color: col('#ffd27a'), proj: 'arrow' },
};
const C_WHITE = col('#ffffff'), C_SPARK = col('#ffe7b0'), C_FIRE = col('#ff7a1a'), C_FIRE2 = col('#ffd35a');
const C_SMOKE = col('#3a3530'), C_DUST = col('#9c8a6e'), C_FROST = col('#9fe0ff'), C_FROST2 = col('#e8f8ff');
const C_GOLD = col('#ffd45a'), C_GOLD2 = col('#fff2b0'), C_HEAL = col('#6dff8a'), C_HEAL2 = col('#d8ffb0');
const C_BLOOD = col('#ff5040'), C_GEL = col('#6fd35a'), C_BONE = col('#e8e0cc'), C_ROCK = col('#7d7a74');
const C_RESPAWN = col('#8fd8ff');

const STYLE = { ring: 0, frost: 1, slam: 2, soft: 3, target: 4, fire: 5 };

// ------------------------------------------------------------------ shaders
const decalVert = /* glsl */ `
attribute float aR;
attribute float aA;
varying float vR;
varying float vA;
void main() {
  vR = aR; vA = aA;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const decalFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uP;
uniform float uFade;
uniform float uStyle;
uniform float uTime;
varying float vR;
varying float vA;
void main() {
  float front = uP;
  float ring = exp(-pow((vR - front) * 11.0, 2.0));
  float fill = smoothstep(front + 0.03, front - 0.35, vR) * 0.15;
  float pat = 1.0;
  float ang = vA * 6.2831853;
  if (uStyle > 0.5 && uStyle < 1.5) {
    pat = 0.35 + 0.65 * pow(abs(sin(ang * 9.0 + vR * 5.0)), 3.0);
    fill *= 1.3;
  } else if (uStyle > 1.5 && uStyle < 2.5) {
    float crack = smoothstep(0.93, 0.99, abs(sin(ang * 7.0 + sin(vR * 10.0) * 0.7)));
    pat = 0.3 + crack * 2.4;
    fill *= 1.2;
  } else if (uStyle > 2.5 && uStyle < 3.5) {
    ring *= 0.35;
    fill = smoothstep(1.0, 0.0, vR) * 0.16;
  } else if (uStyle > 3.5 && uStyle < 4.5) {
    float dash = step(0.5, fract(vA * 24.0 + uTime * 0.8));
    ring = exp(-pow((vR - 0.95) * 16.0, 2.0)) * (0.5 + 0.5 * dash) * 1.4;
    fill = 0.035 + 0.025 * sin(uTime * 8.0);
  } else if (uStyle > 4.5) {
    pat = 0.6 + 0.4 * sin(ang * 5.0 + uTime * 6.0 + vR * 8.0);
  }
  float edge = smoothstep(1.0, 0.94, vR);
  float a = (ring * 0.75 + fill * pat) * uFade * edge;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}`;

const arcVert = /* glsl */ `
attribute float aU;
attribute float aR;
varying float vU;
varying float vR;
void main() {
  vU = aU; vR = aR;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const arcFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uP;
uniform float uFade;
varying float vU;
varying float vR;
void main() {
  float head = uP;
  float tail = smoothstep(head - 0.55, head, vU) * step(vU, head + 0.001);
  float radial = smoothstep(0.0, 0.35, vR) * smoothstep(1.0, 0.75, vR);
  float core = smoothstep(0.45, 0.8, vR) * smoothstep(1.0, 0.85, vR);
  float a = tail * (radial * 0.7 + core * 0.9) * uFade;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.5) * a, 1.0);
  #include <colorspace_fragment>
}`;

const pillarVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const pillarFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uFade;
uniform float uTime;
varying vec2 vUv;
void main() {
  float v = vUv.y;
  float stripes = 0.55 + 0.45 * sin(vUv.x * 6.2831853 * 6.0 + v * 9.0 - uTime * 7.0);
  float a = pow(1.0 - v, 1.6) * (0.55 + 0.45 * stripes) * uFade;
  a *= smoothstep(0.0, 0.06, v);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), (1.0 - v) * 0.35) * a, 1.0);
  #include <colorspace_fragment>
}`;

function discGeometry(rings = 7, segs = 48) {
  const n = 1 + rings * segs;
  const pos = new Float32Array(n * 3), aR = new Float32Array(n), aA = new Float32Array(n);
  aR[0] = 0; aA[0] = 0;
  for (let r = 1; r <= rings; r++) {
    for (let s = 0; s < segs; s++) {
      const i = 1 + (r - 1) * segs + s;
      aR[i] = r / rings;
      aA[i] = s / segs;
    }
  }
  const idx = [];
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + ((s + 1) % segs);
      const c = a + segs, d = b + segs;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
  g.setAttribute('aA', new THREE.BufferAttribute(aA, 1));
  g.setIndex(idx);
  return g;
}

function arcGeometry(r0, r1, theta, segs) {
  const n = (segs + 1) * 2;
  const pos = new Float32Array(n * 3), aU = new Float32Array(n), aR = new Float32Array(n);
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const a = -theta / 2 + u * theta;
    for (let j = 0; j < 2; j++) {
      const r = j ? r1 : r0;
      const k = i * 2 + j;
      // sweep from the right side (+x) to the left, around the forward axis (+z)
      pos[k * 3] = -Math.sin(a) * r;
      pos[k * 3 + 1] = 0;
      pos[k * 3 + 2] = Math.cos(a) * r;
      aU[k] = u; aR[k] = j;
    }
    if (i < segs) {
      const a0 = i * 2;
      idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aU', new THREE.BufferAttribute(aU, 1));
  g.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
  g.setIndex(idx);
  return g;
}

function arrowGeometry() {
  const shaft = new THREE.CylinderGeometry(0.018, 0.018, 0.85, 5);
  shaft.rotateX(Math.PI / 2);
  const head = new THREE.ConeGeometry(0.045, 0.14, 5);
  head.rotateX(Math.PI / 2);
  head.translate(0, 0, 0.49);
  const f1 = new THREE.BoxGeometry(0.004, 0.08, 0.16);
  f1.translate(0, 0, -0.36);
  const f2 = new THREE.BoxGeometry(0.08, 0.004, 0.16);
  f2.translate(0, 0, -0.36);
  const parts = [shaft, head, f1, f2].map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k);
    return ng;
  });
  return mergeGeometries(parts, false);
}

const easeOut = (k) => 1 - (1 - k) * (1 - k);

export class Effects {
  /**
   * ctx: { scene, entities: EntityRenderer, labels: LabelLayer, audio, state, shake(amount, dur), selfPos() }
   */
  constructor(ctx) {
    this.ctx = ctx;
    const scene = ctx.scene;
    this.scene = scene;
    this.glow = new ParticleSystem(scene, { max: 2500, texture: glowTexture(), additive: true, name: 'fxGlow' });
    this.spark = new ParticleSystem(scene, { max: 800, texture: sparkTexture(), additive: true, name: 'fxSpark' });
    this.smoke = new ParticleSystem(scene, { max: 700, texture: smokeTexture(), additive: false, name: 'fxSmoke' });
    this.systems = [this.glow, this.spark, this.smoke];

    // point lights (constant count)
    this.lights = [];
    for (let i = 0; i < RENDER.fxLights; i++) {
      const L = new THREE.PointLight(0xff8a3a, 0, 10, 2);
      L.name = `fxLight${i}`;
      scene.add(L);
      this.lights.push({ light: L, until: 0, peak: 0, start: 0, follow: null });
    }

    // fire orb projectiles
    this.orbGeo = new THREE.IcosahedronGeometry(1, 1);
    this.orbs = [];
    for (let i = 0; i < 14; i++) {
      const core = new THREE.Mesh(this.orbGeo, new THREE.MeshBasicMaterial({ color: 0xfff0c8, toneMapped: false, fog: false }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xff7a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false,
      }));
      const g = new THREE.Group();
      g.add(core, halo);
      g.visible = false;
      g.renderOrder = 21;
      scene.add(g);
      this.orbs.push({ group: g, core, halo, active: false });
    }
    // arrows
    this.arrowGeo = arrowGeometry();
    this.arrowMat = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.7, flatShading: true });
    this.arrowGlowMat = new THREE.MeshBasicMaterial({ color: 0xbff0ff, toneMapped: false });
    this.arrows = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(this.arrowGeo, this.arrowMat);
      m.visible = false;
      m.castShadow = false;
      scene.add(m);
      this.arrows.push({ mesh: m, active: false });
    }
    this.projectiles = [];

    // raining arrows (instanced)
    this.rainMax = 72;
    this.rain = new THREE.InstancedMesh(this.arrowGeo, this.arrowMat, this.rainMax);
    this.rain.name = 'arrowRain';
    this.rain.count = 0;
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    this.rainArrows = [];

    // decals
    this.decals = [];
    for (let i = 0; i < 10; i++) {
      const u = {
        uColor: { value: new THREE.Color() }, uP: { value: 0 }, uFade: { value: 1 }, uStyle: { value: 0 }, uTime: { value: 0 },
      };
      const mat = new THREE.ShaderMaterial({
        name: 'aoeDecal', uniforms: u, vertexShader: decalVert, fragmentShader: decalFrag,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false, toneMapped: false,
      });
      const mesh = new THREE.Mesh(discGeometry(), mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.decals.push({ mesh, u, active: false, t: 0, dur: 1, style: 0, grow: 0.3 });
    }

    // slash arcs / whirlwind
    this.slashGeo = arcGeometry(0.55, 1.75, (Math.PI * 2) / 3, 24);
    this.spinGeo = arcGeometry(0.4, 1.0, Math.PI * 2 * 0.98, 64);
    this.arcs = [];
    for (let i = 0; i < 6; i++) {
      const u = { uColor: { value: new THREE.Color() }, uP: { value: 0 }, uFade: { value: 1 } };
      const mat = new THREE.ShaderMaterial({
        name: 'slashArc', uniforms: u, vertexShader: arcVert, fragmentShader: arcFrag,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
      });
      const mesh = new THREE.Mesh(this.slashGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 22;
      scene.add(mesh);
      this.arcs.push({ mesh, u, active: false, t: 0, dur: 0.3, spin: false, follow: 0 });
    }

    // pillars (level up / respawn)
    const pg = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
    pg.translate(0, 0.5, 0);
    this.pillars = [];
    for (let i = 0; i < 3; i++) {
      const u = { uColor: { value: new THREE.Color() }, uFade: { value: 0 }, uTime: { value: 0 } };
      const mat = new THREE.ShaderMaterial({
        name: 'pillar', uniforms: u, vertexShader: pillarVert, fragmentShader: pillarFrag,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
      });
      const mesh = new THREE.Mesh(pg, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 23;
      scene.add(mesh);
      this.pillars.push({ mesh, u, active: false, t: 0, dur: 2, id: 0, h: 7, r: 1 });
    }

    // campfire-ish ambient emitters (embers) registered by the world
    this.emitters = [];
    this.time = 0;
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._z = new THREE.Vector3(0, 0, 1);
    this._s = new THREE.Vector3(1, 1, 1);
  }

  setViewport(heightPx, camera) {
    for (const s of this.systems) s.setViewport(heightPx, camera);
  }

  addEmitter(x, y, z, kind) {
    this.emitters.push({ x, y, z, kind, acc: 0 });
  }

  // ---------------------------------------------------------------- helpers
  /** World point on entity `id` at fraction `f` of its height. */
  point(id, f, out) {
    const v = this.ctx.entities.get(id);
    if (!v) return false;
    out.set(v.rec.x, v.root.position.y + v.height * v.scale * f, v.rec.z);
    return true;
  }

  _light(pos, color, peak, dur, follow = null) {
    let best = this.lights[0];
    for (const l of this.lights) if (l.until < best.until) best = l;
    best.light.position.copy(pos);
    best.light.color.copy(color);
    best.peak = peak;
    best.start = this.time;
    best.until = this.time + dur;
    best.follow = follow;
    best.light.distance = follow ? 9 : 14;
    return best;
  }

  _decal(x, z, r, color, style, dur, grow = 0.3) {
    let d = this.decals.find((q) => !q.active);
    if (!d) d = this.decals.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    const pos = d.mesh.geometry.attributes.position;
    const aR = d.mesh.geometry.attributes.aR, aA = d.mesh.geometry.attributes.aA;
    for (let i = 0; i < pos.count; i++) {
      const rr = aR.getX(i) * r, a = aA.getX(i) * Math.PI * 2;
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      pos.setXYZ(i, px, terrainHeight(px, pz) + 0.09, pz);
    }
    pos.needsUpdate = true;
    d.u.uColor.value.copy(color);
    d.u.uStyle.value = style;
    d.u.uP.value = 0;
    d.u.uFade.value = 1;
    d.active = true;
    d.t = 0;
    d.dur = dur;
    d.grow = grow;
    d.style = style;
    d.mesh.visible = true;
    return d;
  }

  _arc(id, color, scale = 1, spin = false, radius = 1, dur = 0.28) {
    const v = this.ctx.entities.get(id);
    if (!v) return;
    let a = this.arcs.find((q) => !q.active) || this.arcs[0];
    a.active = true;
    a.t = 0;
    a.dur = dur;
    a.spin = spin;
    a.follow = id;
    a.u.uColor.value.copy(color);
    a.u.uP.value = 0;
    a.u.uFade.value = 1;
    a.mesh.geometry = spin ? this.spinGeo : this.slashGeo;
    a.mesh.scale.setScalar(spin ? radius : scale * v.scale * Math.max(1, v.radius * 1.3));
    a.tilt = spin ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.35);
    a.mesh.visible = true;
    this._placeArc(a, v);
  }

  _placeArc(a, v) {
    const rec = v.rec;
    const h = a.spin ? 1.0 : 1.15;
    a.mesh.position.set(rec.x, v.root.position.y + h * v.scale * (v.height / 1.8), rec.z);
    if (a.spin) {
      a.mesh.rotation.set(0, rec.ry + a.t * Math.PI * 4, 0);
    } else {
      a.mesh.rotation.set(0, 0, 0);
      a.mesh.rotateY(rec.ry);
      a.mesh.rotateZ(a.tilt);
    }
  }

  _pillar(id, color, h, r, dur) {
    const p = this.pillars.find((q) => !q.active) || this.pillars[0];
    p.active = true;
    p.t = 0;
    p.dur = dur;
    p.id = id;
    p.h = h;
    p.r = r;
    p.u.uColor.value.copy(color);
    p.mesh.visible = true;
    this._placePillar(p);
  }

  _placePillar(p) {
    const v = this.ctx.entities.get(p.id);
    if (v) p.mesh.position.set(v.rec.x, v.root.position.y, v.rec.z);
  }

  _burst(sys, pos, color, n, speed, size, life, gravity = 0, drag = 1.5, up = 0, sizeEnd = size * 0.3, spread = 1) {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      sys.emit(
        pos.x, pos.y, pos.z,
        r * Math.cos(th) * s * spread, u * s + up, r * Math.sin(th) * s * spread,
        color, size * (0.7 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.6), gravity, drag, sizeEnd,
      );
    }
  }

  _near(pos, d = 45) {
    const sp = this.ctx.selfPos();
    return !sp || (pos.x - sp.x) ** 2 + (pos.z - sp.z) ** 2 < d * d;
  }

  _sound(name, pos) {
    this.ctx.audio?.play(name, pos);
  }

  // ---------------------------------------------------------------- events
  fx(m) {
    const E = this.ctx.entities;
    const p = this._v;
    switch (m.k) {
      case FX.SWING: {
        E.playAnim(m.src, 'Attack');
        const ab = AB[m.ab];
        if (ab && ab.slash) {
          this._arc(m.src, ab.color, ab.slash, false, 1, m.ab === 'heavy_blow' ? 0.34 : 0.26);
          if (this.point(m.src, 0.6, p)) this._sound(m.ab === 'heavy_blow' ? 'heavy' : 'swing', p);
        } else if (this.point(m.src, 0.5, p)) {
          this._sound('claw', p);
        }
        if (m.tg) this.ctx.onAct?.(m.src, m.tg);
        break;
      }
      case FX.CAST: {
        const ab = ABILITIES[m.ab];
        const isBow = m.ab === 'shot' || m.ab === 'piercing_shot' || m.ab === 'rapid_fire' || m.ab === 'arrow_rain';
        const played = E.playAnim(m.src, 'Cast');
        if (played && !played.animator.has('Cast') && isBow) played.animator.play('Attack');
        const c = AB[m.ab]?.color || C_GOLD;
        if (this.point(m.src, 0.62, p)) {
          if (!isBow) {
            for (let i = 0; i < 16; i++) {
              const a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * 0.25;
              this.glow.emit(p.x + Math.cos(a) * r, p.y + (Math.random() - 0.3) * 0.6, p.z + Math.sin(a) * r,
                -Math.cos(a) * 0.6, 1.2 + Math.random(), -Math.sin(a) * 0.6, c, 0.22, 0.55, 0, 1, 0.05);
            }
          }
          if (ab && ab.kind !== 'self_heal') this._sound(isBow ? 'bow' : m.ab === 'frost_nova' ? 'frostcast' : 'cast', p);
        }
        if (m.tg) this.ctx.onAct?.(m.src, m.tg);
        break;
      }
      case FX.PROJ:
        this._projectile(m);
        break;
      case FX.AOE:
        this._aoe(m);
        break;
      case FX.HEAL:
        this._healFx(m.tg, m.ab);
        break;
      case FX.LEVEL:
        if (this.point(m.src, 0, p)) {
          this._pillar(m.src, C_GOLD, 7.5, 1.0, 2.2);
          this._decal(p.x, p.z, 3.2, C_GOLD, STYLE.ring, 1.4, 0.5);
          p.y += 0.2;
          for (let i = 0; i < 60; i++) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * 1.1;
            this.spark.emit(p.x + Math.cos(a) * r, p.y + Math.random() * 1.5, p.z + Math.sin(a) * r,
              Math.cos(a) * 0.4, 2 + Math.random() * 4, Math.sin(a) * 0.4, i % 2 ? C_GOLD : C_GOLD2, 0.28, 1.6, -0.5, 0.4, 0.05);
          }
          this._light(p.setY(p.y + 2), C_GOLD, 25, 1.4);
          this._sound('levelup', p);
          const v = E.get(m.src);
          if (v) this.ctx.labels.spawnText('Niveau supérieur !', this._v2.set(v.rec.x, v.topY + 0.6, v.rec.z), 'crit');
        }
        break;
      case FX.HIT:
        E.flash(m.tg, 0.8);
        if (this.point(m.tg, 0.55, p)) this._burst(this.spark, p, C_SPARK, 6, 4, 0.2, 0.3, 4);
        break;
      case FX.RESPAWN: {
        const v = E.get(m.src);
        if (v && v.rec.k === KIND.PLAYER) {
          this._pillar(m.src, C_RESPAWN, 4.5, 0.8, 1.5);
          if (this.point(m.src, 0.2, p)) {
            this._burst(this.glow, p, C_RESPAWN, 30, 2.5, 0.25, 1.0, -1, 1.2);
            this._sound('respawn', p);
          }
        } else if (v && this.point(m.src, 0.3, p)) {
          this._burst(this.smoke, p, C_DUST, 10, 1.5, 0.8, 1.0, 0, 2, 0.5, 1.4);
        }
        break;
      }
      default:
        break;
    }
  }

  _projectile(m) {
    const ab = AB[m.ab] || { color: C_FIRE, proj: 'fire', size: 0.2 };
    const from = new THREE.Vector3(), to = new THREE.Vector3();
    if (!this.point(m.src, 0.68, from)) return;
    if (!this.point(m.tg, 0.55, to)) return;
    // start a bit in front of the caster
    const dx = to.x - from.x, dz = to.z - from.z, dl = Math.hypot(dx, dz) || 1;
    from.x += (dx / dl) * 0.45;
    from.z += (dz / dl) * 0.45;
    const dur = Math.max(0.08, (m.ms || 400) / 1000);
    const pr = { kind: ab.proj || 'fire', ab: m.ab, color: ab.color, size: ab.size || 0.2, from, to, cur: from.clone(), prev: from.clone(), t: 0, dur, tg: m.tg, trail: 0, obj: null, light: null, explode: !!ab.explode, glow: !!ab.glow };
    if (pr.kind === 'fire') {
      const orb = this.orbs.find((o) => !o.active);
      if (!orb) return;
      orb.active = true;
      orb.group.visible = true;
      orb.core.scale.setScalar(pr.size * 0.55);
      orb.halo.scale.setScalar(pr.size * 6);
      orb.halo.material.color.copy(pr.color);
      orb.group.position.copy(from);
      pr.obj = orb;
      pr.light = this._light(from, pr.color, pr.explode ? 16 : 8, dur + 0.05, pr);
    } else {
      const ar = this.arrows.find((a) => !a.active);
      if (!ar) return;
      ar.active = true;
      ar.mesh.visible = true;
      ar.mesh.material = pr.glow ? this.arrowGlowMat : this.arrowMat;
      ar.mesh.position.copy(from);
      pr.obj = ar;
    }
    this.projectiles.push(pr);
  }

  _impact(pr) {
    const p = pr.cur;
    if (pr.kind === 'fire') {
      if (pr.explode) {
        this._burst(this.glow, p, C_FIRE, 40, 7, 0.55, 0.55, -1, 3, 0.8, 0.1);
        this._burst(this.glow, p, C_FIRE2, 20, 4, 0.4, 0.4, 0, 3, 0.5, 0.1);
        this._burst(this.smoke, p, C_SMOKE, 12, 2, 0.9, 1.1, -1.2, 2, 0.6, 1.8);
        this._light(p, C_FIRE, 45, 0.45);
        this._sound('explode', p);
      } else {
        this._burst(this.glow, p, C_FIRE, 16, 4, 0.3, 0.35, 0, 3, 0.4, 0.05);
        this._burst(this.spark, p, C_FIRE2, 6, 5, 0.18, 0.3, 5);
        this._sound('firehit', p);
      }
    } else {
      this._burst(this.spark, p, pr.glow ? C_FROST : C_SPARK, pr.glow ? 12 : 6, 4, 0.18, 0.28, 6);
      this._sound('arrowhit', p);
    }
  }

  _aoe(m) {
    const E = this.ctx.entities;
    const p = this._v.set(m.x, terrainHeight(m.x, m.z), m.z);
    const r = m.r || 4;
    const ab = m.ab;
    if (ab === 'whirlwind') {
      E.playAnim(m.src, 'Attack');
      this._arc(m.src, AB.whirlwind.color, 1, true, r * 0.95, 0.55);
      this._decal(m.x, m.z, r, col('#c8d4ff'), STYLE.ring, 0.7, 0.25);
      for (let i = 0; i < 28; i++) {
        const a = Math.random() * Math.PI * 2, rr = r * (0.5 + Math.random() * 0.5);
        this.smoke.emit(m.x + Math.cos(a) * rr, p.y + 0.2, m.z + Math.sin(a) * rr, -Math.sin(a) * 3, 0.6, Math.cos(a) * 3, C_DUST, 0.7, 0.8, 0, 2, 1.5, 0.5);
      }
      this._sound('whirl', p);
    } else if (ab === 'frost_nova') {
      E.playAnim(m.src, 'Cast');
      this._decal(m.x, m.z, r, C_FROST, STYLE.frost, 1.3, 0.28);
      p.y += 0.6;
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2, s = r * (1.2 + Math.random() * 1.4);
        this.spark.emit(p.x, p.y + Math.random() * 0.6, p.z, Math.cos(a) * s, 0.5 + Math.random() * 1.5, Math.sin(a) * s,
          i % 3 ? C_FROST : C_FROST2, 0.3, 0.7, 1.5, 2.2, 0.08);
      }
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2, s = r * 0.8;
        this.smoke.emit(p.x, p.y - 0.4, p.z, Math.cos(a) * s, 0.3, Math.sin(a) * s, C_FROST2, 0.9, 1.2, 0, 2.2, 2.2, 0.5);
      }
      this._light(p, C_FROST, 30, 0.6);
      this._sound('frost', p);
    } else if (ab === 'arrow_rain') {
      E.playAnim(m.src, 'Cast');
      this._decal(m.x, m.z, r, AB.arrow_rain.color, STYLE.target, 1.5, 0.12);
      const n = 34;
      for (let i = 0; i < n; i++) {
        if (this.rainArrows.length >= this.rainMax) break;
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * r;
        const x = m.x + Math.cos(a) * rr, z = m.z + Math.sin(a) * rr;
        this.rainArrows.push({ x, z, y0: terrainHeight(x, z), delay: Math.random() * 0.9, t: 0, tilt: (Math.random() - 0.5) * 0.5, yaw: Math.random() * Math.PI * 2, landed: false });
      }
      this._sound('rain', p);
    } else if (ab === 'slam' || (!ab && r >= 5)) {
      E.playAnim(m.src, 'Attack');
      this._decal(m.x, m.z, r, col('#ff9a3a'), STYLE.slam, 1.3, 0.2);
      p.y += 0.2;
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * r;
        this.smoke.emit(p.x + Math.cos(a) * 1.2, p.y, p.z + Math.sin(a) * 1.2, Math.cos(a) * s, 0.6 + Math.random(), Math.sin(a) * s,
          C_DUST, 1.1, 1.3, 0, 2, 2.6, 0.7);
      }
      this._burst(this.smoke, p, C_ROCK, 18, 7, 0.25, 1.0, 14, 0.2, 5, 0.25);
      this._sound('slam', p);
      const sp = this.ctx.selfPos();
      if (sp) {
        const d = Math.hypot(sp.x - m.x, sp.z - m.z);
        if (d < r + 12) this.ctx.shake(0.55 * (1 - d / (r + 12)) + 0.1, 0.6);
      }
    } else {
      const c = AB[ab]?.color || C_FIRE;
      this._decal(m.x, m.z, r, c, STYLE.fire, 1.0, 0.3);
      this._burst(this.glow, p.setY(p.y + 0.5), c, 30, r, 0.4, 0.6, 0, 2.5, 0.8);
    }
  }

  _healFx(id, ab) {
    const p = this._v;
    if (!this.point(id, 0, p)) return;
    if (ab === 'war_cry') {
      this.ctx.entities.playAnim(id, 'Cast');
      this._decal(p.x, p.z, 4, AB.war_cry.color, STYLE.ring, 0.9, 0.2);
      p.y += 1.2;
      this._burst(this.glow, p, AB.war_cry.color, 30, 5, 0.35, 0.5, 0, 3, 0.2);
      this._burst(this.spark, p, C_GOLD, 12, 4, 0.22, 0.5, 0, 2);
      this._light(p, AB.war_cry.color, 20, 0.5);
      this._sound('warcry', p);
      return;
    }
    if (ab === 'heal') this.ctx.entities.playAnim(id, 'Cast');
    this._decal(p.x, p.z, 1.6, C_HEAL, STYLE.soft, 1.3, 0.6);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 6, r = 0.6 + Math.random() * 0.25;
      this.spark.emit(p.x + Math.cos(a) * r, p.y + (i / 36) * 1.6, p.z + Math.sin(a) * r,
        -Math.sin(a) * 0.8, 1.2 + Math.random() * 0.8, Math.cos(a) * 0.8, i % 2 ? C_HEAL : C_HEAL2, 0.26, 1.1, -0.3, 0.8, 0.06);
    }
    this._sound('heal', p);
  }

  /** `dmg` message: floating number, hit flash, sparks, Hit animation. */
  damage(m, selfId) {
    const E = this.ctx.entities;
    const v = E.get(m.tg);
    if (!v) return;
    const p = this._v;
    this.point(m.tg, 0.6, p);
    const top = this._v2.set(v.rec.x, v.topY + 0.2, v.rec.z);
    let cls = m.crit ? 'crit' : '';
    if (m.tg === selfId) cls = m.crit ? 'self crit' : 'self';
    this.ctx.labels.spawnText(m.crit ? `${m.v} !` : String(m.v), top, cls);
    E.flash(m.tg, m.crit ? 1 : 0.7);
    if (!v.rec.dead && m.hp > 0) E.playAnim(m.tg, 'Hit');
    // sparks pushed away from the attacker
    const s = E.get(m.src);
    let nx = 0, nz = 0;
    if (s) {
      nx = v.rec.x - s.rec.x; nz = v.rec.z - s.rec.z;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
    }
    const c = m.ab === 'frost_nova' ? C_FROST : (m.ab === 'firebolt' || m.ab === 'fireball') ? C_FIRE2 : (v.modelKey === 'slime' ? C_GEL : C_SPARK);
    for (let i = 0; i < (m.crit ? 14 : 7); i++) {
      this.spark.emit(p.x, p.y, p.z, nx * 3 + (Math.random() - 0.5) * 4, 1 + Math.random() * 3, nz * 3 + (Math.random() - 0.5) * 4,
        c, 0.2, 0.32, 9, 1, 0.05);
    }
    if (v.rec.k === KIND.PLAYER && !m.ab) this._burst(this.glow, p, C_BLOOD, 5, 2, 0.18, 0.3, 5);
    this._sound(m.crit ? 'crit' : 'hit', p);
    v.rec.hp = m.hp;
    v.rec.dirtyLabel = true;
  }

  heal(m, selfId) {
    const v = this.ctx.entities.get(m.tg);
    if (!v) return;
    this.ctx.labels.spawnText(`+${m.v}`, this._v2.set(v.rec.x, v.topY + 0.2, v.rec.z), 'heal');
    v.rec.hp = m.hp;
    v.rec.dirtyLabel = true;
    if (m.tg === selfId) { /* sparkles come with fx HEAL; potions have no fx → small sparkle */ }
  }

  /** Small sparkle for potions (no FX message). */
  potion(id, mana) {
    const p = this._v;
    if (!this.point(id, 0.3, p)) return;
    const c1 = mana ? col('#6cb8ff') : C_HEAL, c2 = mana ? col('#d8ecff') : C_HEAL2;
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.5 * Math.random() + 0.2;
      this.spark.emit(p.x + Math.cos(a) * r, p.y + Math.random(), p.z + Math.sin(a) * r, 0, 1 + Math.random(), 0, i % 2 ? c1 : c2, 0.2, 0.9, -0.2, 0.5, 0.05);
    }
    this._sound('potion', p);
  }

  death(id) {
    const E = this.ctx.entities;
    const v = E.get(id);
    if (!v) return;
    E.playAnim(id, 'Death');
    const p = this._v;
    this.point(id, 0.3, p);
    const key = v.modelKey;
    if (key === 'slime') this._burst(this.smoke, p, C_GEL, 18, 3, 0.35, 0.8, 8, 1, 2, 0.2);
    else if (key === 'skeleton') this._burst(this.glow, p, col('#a8c8ff'), 20, 1.5, 0.35, 1.4, -1.5, 1.5, 0.5, 0.1);
    else if (key === 'golem') {
      this._burst(this.smoke, p, C_DUST, 40, 5, 1.2, 1.6, 0, 1.8, 1, 2.5);
      this._burst(this.glow, p.setY(p.y + 1.5), col('#34d8ff'), 40, 4, 0.4, 1.2, -1, 1.2);
      this.ctx.shake(0.4, 0.8);
    } else this._burst(this.smoke, p, C_DUST, 12, 1.6, 0.6, 1.0, 0, 2, 0.4, 1.3);
    this._sound(v.rec.k === KIND.PLAYER ? 'pdeath' : key === 'skeleton' ? 'bones' : 'death', p);
    if (v.rec.k === KIND.MONSTER) {
      const b = this._v3.set(v.rec.x, terrainHeight(v.rec.x, v.rec.z), v.rec.z);
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        this.smoke.emit(b.x + Math.cos(a) * 0.4, b.y + 0.1, b.z + Math.sin(a) * 0.4, Math.cos(a) * 1.2, 0.3, Math.sin(a) * 1.2, C_DUST, 0.5, 0.9, 0, 2, 1.1, 0.5);
      }
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt, time, camera) {
    this.time = time;
    const E = this.ctx.entities;
    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t += dt;
      const k = Math.min(1, pr.t / pr.dur);
      // home on the target's current (rendered) position
      if (pr.tg) this.point(pr.tg, 0.55, pr.to);
      pr.prev.copy(pr.cur);
      const dist = pr.from.distanceTo(pr.to);
      const arc = pr.kind === 'arrow' ? Math.min(1.2, dist * 0.04) : Math.min(0.6, dist * 0.02);
      pr.cur.lerpVectors(pr.from, pr.to, k);
      pr.cur.y += Math.sin(k * Math.PI) * arc;
      if (pr.kind === 'fire') {
        const o = pr.obj;
        o.group.position.copy(pr.cur);
        o.halo.material.rotation = time * 3;
        const pulse = 1 + Math.sin(time * 30) * 0.08;
        o.halo.scale.setScalar(pr.size * 6 * pulse);
        // trail
        pr.trail += dt;
        const every = pr.explode ? 0.008 : 0.014;
        while (pr.trail > every) {
          pr.trail -= every;
          const j = pr.size * 0.6;
          this.glow.emit(pr.cur.x + (Math.random() - 0.5) * j, pr.cur.y + (Math.random() - 0.5) * j, pr.cur.z + (Math.random() - 0.5) * j,
            (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6,
            Math.random() < 0.5 ? pr.color : C_FIRE2, pr.size * 2.4, 0.35 + Math.random() * 0.2, -0.5, 1.5, pr.size * 0.4);
          if (pr.explode && Math.random() < 0.3) {
            this.smoke.emit(pr.cur.x, pr.cur.y, pr.cur.z, 0, 0.5, 0, C_SMOKE, pr.size * 1.6, 0.6, -0.4, 1, pr.size * 3.5, 0.45);
          }
        }
      } else {
        const m = pr.obj.mesh;
        m.position.copy(pr.cur);
        this._v3.subVectors(pr.cur, pr.prev);
        if (this._v3.lengthSq() > 1e-8) m.quaternion.setFromUnitVectors(this._z, this._v3.normalize());
        if (pr.glow) {
          this.glow.emit(pr.cur.x, pr.cur.y, pr.cur.z, 0, 0, 0, pr.color, 0.35, 0.25, 0, 0, 0.05);
        }
      }
      if (k >= 1) {
        this._impact(pr);
        if (pr.kind === 'fire') { pr.obj.active = false; pr.obj.group.visible = false; }
        else { pr.obj.active = false; pr.obj.mesh.visible = false; }
        if (pr.light && pr.light.follow === pr) pr.light.follow = null;
        this.projectiles.splice(i, 1);
      }
    }
    // lights
    for (const l of this.lights) {
      if (time >= l.until) { l.light.intensity = 0; l.follow = null; continue; }
      if (l.follow) {
        l.light.position.copy(l.follow.cur);
        l.light.intensity = l.peak;
      } else {
        const k = (time - l.start) / Math.max(0.01, l.until - l.start);
        l.light.intensity = l.peak * (1 - k) * (1 - k);
      }
    }
    // decals
    for (const d of this.decals) {
      if (!d.active) continue;
      d.t += dt;
      const k = d.t / d.dur;
      if (k >= 1) { d.active = false; d.mesh.visible = false; continue; }
      d.u.uP.value = d.style === STYLE.target || d.style === STYLE.soft ? 1 : Math.min(1, easeOut(Math.min(1, d.t / (d.dur * d.grow))));
      d.u.uFade.value = (k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35) * Math.min(1, d.t / 0.06);
      d.u.uTime.value = time;
    }
    // arcs
    for (const a of this.arcs) {
      if (!a.active) continue;
      a.t += dt;
      const k = a.t / a.dur;
      if (k >= 1) { a.active = false; a.mesh.visible = false; continue; }
      const v = E.get(a.follow);
      if (v) this._placeArc(a, v);
      a.u.uP.value = a.spin ? 1.0 : Math.min(1.2, easeOut(k) * 1.25);
      a.u.uFade.value = a.spin ? Math.sin(k * Math.PI) : (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
    }
    // pillars
    for (const p of this.pillars) {
      if (!p.active) continue;
      p.t += dt;
      const k = p.t / p.dur;
      if (k >= 1) { p.active = false; p.mesh.visible = false; continue; }
      this._placePillar(p);
      const grow = easeOut(Math.min(1, p.t / 0.3));
      p.mesh.scale.set(p.r * (0.6 + 0.4 * grow), p.h * grow, p.r * (0.6 + 0.4 * grow));
      p.u.uFade.value = (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4) * 0.9;
      p.u.uTime.value = time;
      if (Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2;
        this.glow.emit(p.mesh.position.x + Math.cos(a) * p.r * 0.9, p.mesh.position.y + Math.random() * 0.5, p.mesh.position.z + Math.sin(a) * p.r * 0.9,
          0, 3 + Math.random() * 2, 0, p.u.uColor.value, 0.3, 1.0, 0, 0.5, 0.05);
      }
    }
    // arrow rain
    if (this.rainArrows.length) {
      let n = 0;
      for (let i = this.rainArrows.length - 1; i >= 0; i--) {
        const a = this.rainArrows[i];
        a.t += dt;
        const tt = a.t - a.delay;
        if (tt < 0) continue;
        const fall = 0.32;
        if (tt > fall + 0.9) { this.rainArrows.splice(i, 1); continue; }
        const k = Math.min(1, tt / fall);
        const h = (1 - k) * 11;
        const off = (1 - k) * 3.5;
        const x = a.x + Math.sin(a.yaw) * off, z = a.z + Math.cos(a.yaw) * off;
        const y = a.y0 + 0.35 + h;
        if (k >= 1 && !a.landed) {
          a.landed = true;
          this._v3.set(a.x, a.y0 + 0.1, a.z);
          this.smoke.emit(a.x, a.y0 + 0.1, a.z, (Math.random() - 0.5), 0.5, (Math.random() - 0.5), C_DUST, 0.35, 0.5, 0, 2, 0.8, 0.6);
          this.spark.emit(a.x, a.y0 + 0.2, a.z, 0, 1.5, 0, C_SPARK, 0.2, 0.2, 5);
        }
        // arrow points along its fall direction (down and slightly forward)
        this._v3.set(-Math.sin(a.yaw) * 3.5, -11, -Math.cos(a.yaw) * 3.5).normalize();
        this._q.setFromUnitVectors(this._z, this._v3);
        const sc = tt > fall + 0.6 ? Math.max(0.01, 1 - (tt - fall - 0.6) / 0.3) : 1;
        this._s.setScalar(sc);
        this._m.compose(this._v2.set(x, y, z), this._q, this._s);
        this.rain.setMatrixAt(n++, this._m);
      }
      this.rain.count = n;
      this.rain.instanceMatrix.needsUpdate = true;
    } else if (this.rain.count) {
      this.rain.count = 0;
    }
    // ambient emitters (campfire embers)
    for (const em of this.emitters) {
      if (!this._near(em, 60)) continue;
      em.acc += dt;
      while (em.acc > 0.06) {
        em.acc -= 0.06;
        this.glow.emit(em.x + (Math.random() - 0.5) * 0.6, em.y + 0.3, em.z + (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4, Math.random() < 0.5 ? C_FIRE : C_FIRE2, 0.35, 0.9, -0.3, 0.6, 0.05);
        if (Math.random() < 0.25) this.smoke.emit(em.x, em.y + 1.0, em.z, (Math.random() - 0.5) * 0.3, 0.9, (Math.random() - 0.5) * 0.3, C_SMOKE, 0.6, 2.2, -0.1, 0.3, 1.8, 0.25);
      }
    }
    for (const s of this.systems) s.update(dt);
  }

  clear() {
    for (const pr of this.projectiles) {
      if (pr.kind === 'fire') { pr.obj.active = false; pr.obj.group.visible = false; }
      else { pr.obj.active = false; pr.obj.mesh.visible = false; }
    }
    this.projectiles.length = 0;
    this.rainArrows.length = 0;
    for (const d of this.decals) { d.active = false; d.mesh.visible = false; }
    for (const a of this.arcs) { a.active = false; a.mesh.visible = false; }
    for (const p of this.pillars) { p.active = false; p.mesh.visible = false; }
    for (const s of this.systems) s.clear();
  }
}
