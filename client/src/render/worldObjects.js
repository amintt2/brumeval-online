// Static world objects (≈ 960 of them) drawn as InstancedMesh batches: one batch per (type, material, chunk).
// Chunking keeps frustum culling (main camera and sun shadow camera) effective. Lamp posts and the campfire
// get additive glow sprites and a small pool of point lights assigned to the ones nearest to the player.
import * as THREE from 'three';
import { generateWorldObjects, OBJECT_TYPES, WORLD_HALF, terrainHeight } from '@shared/world.js';
import { RENDER } from '../config.js';
import { glowTexture } from './textures.js';

const NO_SHADOW = new Set(['flowers']);
const SINK = { rock_a: 0.12, rock_b: 0.15, tree_pine: 0.05, tree_oak: 0.05, tree_dead: 0.05, bush: 0.05, gravestone: 0.04 };
const GLOW_TYPES = { lamp_post: { color: '#ffc46b', size: 1.7, light: 26, flicker: 0.08 }, campfire: { color: '#ff8a2a', size: 3.0, light: 60, flicker: 0.35 } };

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
varying vec3 vColor;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
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
    this._acc = 1;
  }

  build() {
    const objs = generateWorldObjects();
    const CH = RENDER.chunkSize;
    const buckets = new Map();
    for (const o of objs) {
      const cx = Math.floor((o.x + WORLD_HALF) / CH), cz = Math.floor((o.z + WORLD_HALF) / CH);
      const k = `${o.type}|${cx}|${cz}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { type: o.type, list: [] }));
      b.list.push(o);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const glowPos = [], glowCol = [], glowSize = [], glowFlicker = [], glowNight = [];
    const tmpC = new THREE.Color();
    let drawn = 0;
    for (const { type, list } of buckets.values()) {
      const model = this.assets.staticModel(OBJECT_TYPES[type].model);
      const meshes = model.parts.map((part) => {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        im.name = `${type}`;
        im.castShadow = !NO_SHADOW.has(type);
        im.receiveShadow = true;
        return im;
      });
      list.forEach((o, i) => {
        const y = this.baseHeight(o) - (SINK[o.type] || 0) * o.s;
        p.set(o.x, y, o.z);
        q.setFromAxisAngle(up, o.ry);
        s.setScalar(o.s);
        m.compose(p, q, s);
        for (const im of meshes) im.setMatrixAt(i, m);
        const g = GLOW_TYPES[o.type];
        if (g) {
          const gp = model.glow ? model.glow.clone() : new THREE.Vector3(0, o.type === 'campfire' ? 0.5 : 2.7, 0);
          gp.applyMatrix4(m);
          glowPos.push(gp.x, gp.y, gp.z);
          tmpC.set(g.color);
          glowCol.push(tmpC.r, tmpC.g, tmpC.b);
          glowSize.push(g.size * o.s);
          glowFlicker.push(g.flicker);
          glowNight.push(o.type === 'campfire' ? 0 : 1);
          this.lampSources.push({ x: gp.x, y: gp.y + (o.type === 'campfire' ? 0.6 : 0), z: gp.z, type: o.type, power: g.light, flicker: g.flicker });
        }
      });
      for (const im of meshes) {
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.computeBoundingBox();
        this.group.add(im);
        drawn++;
      }
      if (type === 'lamp_post') {
        for (const part of model.parts) {
          const mat = part.material;
          if (mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.3 && !this.nightMats.some((n) => n.mat === mat)) {
            this.nightMats.push({ mat, base: mat.emissiveIntensity ?? 1 });
          }
        }
      }
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
    this.glowUniforms = { uScale: { value: 400 }, uNight: { value: 0 }, uTime: { value: 0 }, uMap: { value: glowTexture() } };
    const gm = new THREE.ShaderMaterial({
      name: 'lampGlow',
      uniforms: this.glowUniforms,
      vertexShader: glowVert,
      fragmentShader: glowFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    this.glow = new THREE.Points(gg, gm);
    this.glow.name = 'lampGlow';
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 5;
    this.scene.add(this.glow);

    // point-light pool (constant count → no shader recompiles)
    for (let i = 0; i < RENDER.lampLights; i++) {
      const L = new THREE.PointLight(0xffb35a, 0, 16, 2);
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

  update(dt, time, focus, night) {
    this.glowUniforms.uTime.value = time;
    this.glowUniforms.uNight.value = night;
    for (const n of this.nightMats) n.mat.emissiveIntensity = n.base * (0.35 + 0.65 * night);
    this._acc += dt;
    if (this._acc > 0.3) {
      this._acc = 0;
      // assign lights to the nearest sources
      const cand = this.lampSources
        .map((s) => ({ s, d: (s.x - focus.x) ** 2 + (s.z - focus.z) ** 2 }))
        .filter((c) => c.d < 55 * 55)
        .sort((a, b) => a.d - b.d);
      for (let i = 0; i < this.lights.length; i++) {
        const L = this.lights[i];
        const c = cand[i];
        L.userData.src = c ? c.s : null;
        if (c) L.position.set(c.s.x, c.s.y, c.s.z);
      }
    }
    for (const L of this.lights) {
      const s = L.userData.src;
      if (!s) { L.intensity = 0; continue; }
      const vis = s.type === 'campfire' ? Math.max(0.3, night) : night;
      const fl = 1 + s.flicker * (Math.sin(time * 13 + s.x) * 0.5 + Math.sin(time * 21.7 + s.z) * 0.5);
      L.intensity = s.power * vis * fl;
      L.distance = s.type === 'campfire' ? 20 : 15;
    }
  }
}
