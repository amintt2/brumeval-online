// Static world objects drawn as InstancedMesh batches: one batch per (type, material, chunk, LOD). Chunking keeps
// frustum culling (main camera and every shadow cascade) effective; each chunk shows one LOD (<key>_lod1/2.glb
// when the asset exists) chosen from its distance to the camera, and small props disappear beyond a distance.
// Foliage / grass / cloth materials sway with the shared wind field (materials named Leaf*/Foliage*/Grass*/
// Cloth*/Banner*, ROADMAP §4.4). Windmill "Sails" nodes spin. Lamp posts and the campfire get additive glow
// sprites and a small pool of point lights assigned to the ones nearest to the player.
import * as THREE from 'three';
import { generateWorldObjects, OBJECT_TYPES, WORLD_HALF, terrainHeight } from '@shared/world.js';
import { RENDER } from '../config.js';
import { glowTexture } from './textures.js';
import { patchStaticMaterial } from './seeThrough.js';
import { windKindOf, windParamsFor } from './wind.js';
import { STATIC_UNIFORMS } from './assets.js';
import { SMALL_CASTER_LAYER } from './shadows.js';

const NO_SHADOW = new Set(['flowers']);
/** Low props never hide the player: no need for line-of-sight dithering on them. */
const NO_SEE_THROUGH = new Set(['flowers', 'bush', 'crate', 'barrel', 'gravestone', 'fence', 'campfire']);
/** Small props: hidden when the whole chunk is far from the camera (tiny + fogged anyway). */
const SMALL = new Set(['flowers', 'bush', 'crate', 'barrel', 'gravestone']);
const SMALL_DIST = 105;
const SINK = { rock_a: 0.12, rock_b: 0.15, tree_pine: 0.05, tree_oak: 0.05, tree_dead: 0.05, bush: 0.05, gravestone: 0.04 };
const GLOW_TYPES = { lamp_post: { color: '#ffb25a', size: 1.7, light: 26, flicker: 0.08 }, campfire: { color: '#ff7a24', size: 3.0, light: 60, flicker: 0.35 } };
const CHUNK = 64;
/** LOD switch distances (metres, × the view-distance setting). */
const LOD_DIST = [45, 95];

const glowVert = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aFlicker;
attribute float aNightOnly;
uniform float uScale;
uniform float uNight;
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float fl = 1.0 + aFlicker * (sin(uTime * 11.0 + position.x) * 0.5 + sin(uTime * 17.3 + position.z) * 0.5);
  float vis = mix(1.0, uNight, aNightOnly);
  vAlpha = vis * fl * (1.0 - smoothstep(70.0, 140.0, -mv.z));
  vColor = aColor;
  gl_PointSize = min(aSize * fl * uScale / max(0.5, -mv.z), 220.0);
}`;
const glowFrag = /* glsl */ `
uniform sampler2D uMap;
uniform float uGain;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.003) discard;
  // HDR: bright enough to bloom through the post pipeline
  gl_FragColor = vec4(vColor * a * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class WorldObjects {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'worldObjects';
    this.lampSources = []; // { x, y, z, type, light, flicker }
    this.nightMats = [];   // lantern materials dimmed by day
    this.lights = [];
    this.chunks = [];      // { cx, cz, r, lods: [[InstancedMesh…]…], small, lod }
    this.spinners = [];    // { mesh, base: [Matrix4], pivot, axis, speed }
    this.distance = 1;
    this.smallDist = SMALL_DIST;
    this._acc = 1;
  }

  /** View-distance factor (settings): LOD switch and small-prop distances scale with it. */
  setDistance(f) {
    this.distance = f;
    this.smallDist = SMALL_DIST * f;
    for (const c of this.chunks) c.lod = -1;
  }

  _patch(model, type) {
    const key = OBJECT_TYPES[type].model;
    for (const lod of model.lods || [model.parts]) {
      const named = lod.some((p) => windKindOf(p.material));
      for (const part of lod) {
        const see = !NO_SEE_THROUGH.has(type);
        if (part.material.userData.mergedStatic) {
          // merged flat-colour model: wind parameters are per-vertex attributes
          patchStaticMaterial(part.material, { seeThrough: see, wind: part.material.userData.hasWind ? 'attr' : null, amp: 1 });
          continue;
        }
        if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
        const w = windParamsFor(part.material, part.geometry.boundingBox, key, named);
        patchStaticMaterial(part.material, { seeThrough: see, wind: w?.kind || null, amp: w?.amp || 0, base: w?.base ?? 0.1 });
      }
    }
  }

  build() {
    const objs = generateWorldObjects();
    const buckets = new Map();
    for (const o of objs) {
      const cx = Math.floor((o.x + WORLD_HALF) / CHUNK), cz = Math.floor((o.z + WORLD_HALF) / CHUNK);
      const ck = `${cx}|${cz}`;
      let c = buckets.get(ck);
      if (!c) buckets.set(ck, (c = { cx, cz, types: new Map() }));
      let list = c.types.get(o.type);
      if (!list) c.types.set(o.type, (list = []));
      list.push(o);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const glowPos = [], glowCol = [], glowSize = [], glowFlicker = [], glowNight = [];
    const tmpC = new THREE.Color();
    const patched = new Set();
    let drawn = 0;
    for (const c of buckets.values()) {
      const chunk = { cx: -WORLD_HALF + (c.cx + 0.5) * CHUNK, cz: -WORLD_HALF + (c.cz + 0.5) * CHUNK, r: CHUNK * 0.75, lods: [[], [], []], small: [], lod: -1 };
      for (const [type, list] of c.types) {
        const model = this.assets.staticModel(OBJECT_TYPES[type].model);
        if (!patched.has(model)) { this._patch(model, type); patched.add(model); }
        const lods = model.lods && model.lods.length ? model.lods : [model.parts];
        const matrices = list.map((o) => {
          const y = this.baseHeight(o) - (SINK[o.type] || 0) * o.s;
          p.set(o.x, y, o.z);
          q.setFromAxisAngle(up, o.ry);
          s.setScalar(o.s);
          return new THREE.Matrix4().compose(p, q, s);
        });
        for (let l = 0; l < 3; l++) {
          const parts = lods[Math.min(l, lods.length - 1)];
          // a missing LOD level re-uses the previous level's meshes (no extra draw calls)
          if (l > 0 && Math.min(l, lods.length - 1) === Math.min(l - 1, lods.length - 1)) {
            for (const im of chunk.lods[l - 1].filter((x) => x.userData.type === type)) chunk.lods[l].push(im);
            continue;
          }
          for (const part of parts) {
            const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
            im.name = `${type}${l ? `_lod${l}` : ''}`;
            im.userData.type = type;
            im.castShadow = !NO_SHADOW.has(type);
            im.receiveShadow = true;
            if (part.material.userData.windDepth) im.customDepthMaterial = part.material.userData.windDepth;
            matrices.forEach((mm, i) => im.setMatrixAt(i, mm));
            im.instanceMatrix.needsUpdate = true;
            im.computeBoundingSphere();
            im.computeBoundingBox();
            im.visible = false;
            this.group.add(im);
            chunk.lods[l].push(im);
            if (SMALL.has(type)) chunk.small.push(im);
            // small props only cast into the sharpest shadow cascade
            if (SMALL.has(type) || type === 'fence') im.layers.set(SMALL_CASTER_LAYER);
            drawn++;
          }
        }
        // spinning parts (windmill sails): one instanced mesh per part, matrices animated
        for (const sp of model.spin || []) {
          const im = new THREE.InstancedMesh(sp.geometry, sp.material, list.length);
          im.name = `${type}_sails`;
          im.castShadow = true;
          im.receiveShadow = true;
          matrices.forEach((mm, i) => im.setMatrixAt(i, mm));
          im.computeBoundingSphere();
          this.group.add(im);
          this.spinners.push({ mesh: im, base: matrices.map((mm) => mm.clone()), pivot: sp.pivot, axis: sp.axis, speed: 0.6 });
        }
        // glow sprites + light sources
        const g = GLOW_TYPES[type];
        if (g) {
          for (const mm of matrices) {
            const gp = model.glow ? model.glow.clone() : new THREE.Vector3(0, type === 'campfire' ? 0.5 : 2.7, 0);
            gp.applyMatrix4(mm);
            glowPos.push(gp.x, gp.y, gp.z);
            tmpC.set(g.color);
            glowCol.push(tmpC.r, tmpC.g, tmpC.b);
            const sc = new THREE.Vector3().setFromMatrixScale(mm).x;
            glowSize.push(g.size * sc);
            glowFlicker.push(g.flicker);
            glowNight.push(type === 'campfire' ? 0 : 1);
            this.lampSources.push({ x: gp.x, y: gp.y + (type === 'campfire' ? 0.6 : 0), z: gp.z, type, power: g.light, flicker: g.flicker });
          }
        }
        if (type === 'lamp_post') {
          for (const lod of lods) {
            for (const part of lod) {
              const mat = part.material;
              if (mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.3 && !this.nightMats.some((n) => n.mat === mat)) {
                this.nightMats.push({ mat, base: mat.emissiveIntensity ?? 1 });
              }
            }
          }
        }
      }
      this.chunks.push(chunk);
    }
    this.batchCount = drawn;
    this.scene.add(this.group);

    // glow sprites
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
    gg.setAttribute('aColor', new THREE.Float32BufferAttribute(glowCol, 3));
    gg.setAttribute('aSize', new THREE.Float32BufferAttribute(glowSize, 1));
    gg.setAttribute('aFlicker', new THREE.Float32BufferAttribute(glowFlicker, 1));
    gg.setAttribute('aNightOnly', new THREE.Float32BufferAttribute(glowNight, 1));
    this.glowUniforms = { uScale: { value: 400 }, uNight: { value: 0 }, uTime: { value: 0 }, uMap: { value: glowTexture() }, uGain: { value: 1.6 } };
    const gm = new THREE.ShaderMaterial({
      name: 'lampGlow',
      uniforms: this.glowUniforms,
      vertexShader: glowVert,
      fragmentShader: glowFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.glow = new THREE.Points(gg, gm);
    this.glow.name = 'lampGlow';
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 5;
    this.scene.add(this.glow);

    // point-light pool (constant count → no shader recompiles)
    for (let i = 0; i < RENDER.lampLights; i++) {
      const L = new THREE.PointLight(0xffa850, 0, 16, 2);
      L.name = `lamp${i}`;
      L.userData.src = null;
      this.scene.add(L);
      this.lights.push(L);
    }
  }

  baseHeight(o) {
    const r = Math.min(1.4, Math.max(0.35, (OBJECT_TYPES[o.type].r || 0.4) * o.s * 0.8));
    let h = terrainHeight(o.x, o.z);
    h = Math.min(h, terrainHeight(o.x + r, o.z), terrainHeight(o.x - r, o.z), terrainHeight(o.x, o.z + r), terrainHeight(o.x, o.z - r));
    return h;
  }

  /** Viewport height in device pixels × projection scale (for point-size attenuation). */
  setViewport(heightPx, camera) {
    this.glowUniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  /** Per-chunk LOD + small-prop culling. */
  _cull(camPos) {
    const d0 = LOD_DIST[0] * this.distance, d1 = LOD_DIST[1] * this.distance;
    for (const c of this.chunks) {
      const d = Math.max(0, Math.hypot(c.cx - camPos.x, c.cz - camPos.z) - c.r);
      let lod = d < d0 ? 0 : d < d1 ? 1 : 2;
      if (c.lod >= 0 && lod !== c.lod) {
        // hysteresis band of 6 m
        const dd = d + (lod > c.lod ? -6 : 6);
        const l2 = dd < d0 ? 0 : dd < d1 ? 1 : 2;
        if (l2 === c.lod) lod = c.lod;
      }
      const smallOn = d < this.smallDist;
      if (lod !== c.lod || smallOn !== c.smallOn) {
        for (let l = 0; l < 3; l++) for (const im of c.lods[l]) im.visible = false;
        for (const im of c.lods[lod]) im.visible = smallOn || !c.small.includes(im);
        c.lod = lod;
        c.smallOn = smallOn;
      }
    }
  }

  update(dt, time, focus, night, camPos) {
    if (camPos) this._cull(camPos);
    this.glowUniforms.uTime.value = time;
    this.glowUniforms.uNight.value = night;
    for (const n of this.nightMats) n.mat.emissiveIntensity = n.base * (0.25 + 1.6 * night);
    STATIC_UNIFORMS.uNightGlow.value = 0.25 + 1.6 * night; // merged models: lanterns / windows
    // windmill sails
    if (this.spinners.length) {
      const rot = new THREE.Matrix4(), t1 = new THREE.Matrix4(), t2 = new THREE.Matrix4(), mm = new THREE.Matrix4();
      for (const sp of this.spinners) {
        rot.makeRotationAxis(sp.axis, time * sp.speed);
        t1.makeTranslation(sp.pivot.x, sp.pivot.y, sp.pivot.z);
        t2.makeTranslation(-sp.pivot.x, -sp.pivot.y, -sp.pivot.z);
        sp.base.forEach((b, i) => {
          mm.copy(b).multiply(t1).multiply(rot).multiply(t2);
          sp.mesh.setMatrixAt(i, mm);
        });
        sp.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this._acc += dt;
    if (this._acc > 0.3) {
      this._acc = 0;
      // assign lights to the nearest sources (within 55 m), allocation-free selection
      for (const s of this.lampSources) s._taken = false;
      for (const L of this.lights) {
        let best = null, bd = 55 * 55;
        for (const s of this.lampSources) {
          if (s._taken) continue;
          const d = (s.x - focus.x) ** 2 + (s.z - focus.z) ** 2;
          if (d < bd) { bd = d; best = s; }
        }
        L.userData.src = best;
        if (best) {
          best._taken = true;
          L.position.set(best.x, best.y, best.z);
        }
      }
    }
    for (const L of this.lights) {
      const s = L.userData.src;
      if (!s) { L.intensity = 0; continue; }
      const vis = s.type === 'campfire' ? Math.max(0.3, night) : night;
      const fl = 1 + s.flicker * (Math.sin(time * 13 + s.x) * 0.5 + Math.sin(time * 21.7 + s.z) * 0.5);
      L.intensity = s.power * vis * fl;
      L.distance = s.type === 'campfire' ? 22 : 16;
    }
  }
}
