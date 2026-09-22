// GLB loading + cache, with procedural fallbacks for every model key.
//  - animated models (characters / creatures): cloned per entity with SkeletonUtils.clone
//  - static props: every mesh is baked (node world transform applied) and merged per material, so the world
//    renderer can draw each (type, material) as one InstancedMesh batch.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CLASSES, MONSTERS, NPCS } from '@shared/data.js';
import { OBJECT_TYPES } from '@shared/world.js';
import { buildCreatureFallback, buildStaticFallback } from './fallbacks.js';

export const ANIMATED_KEYS = [...new Set([
  ...Object.values(CLASSES).map((c) => c.model),
  ...Object.values(NPCS).map((n) => n.model),
  ...Object.values(MONSTERS).map((m) => m.model),
])];
export const STATIC_KEYS = [...new Set(Object.values(OBJECT_TYPES).map((o) => o.model))];

/** Approximate expected heights (m) — used to sanity-rescale a model exported at a wrong scale. */
const EXPECTED_HEIGHT = {
  warrior: 1.8, mage: 1.9, ranger: 1.8, npc_elder: 1.8, npc_merchant: 1.75,
  goblin: 1.2, skeleton: 1.8, slime: 0.8, wolf: 1.0, golem: 4.0,
};
const CLIP_NAMES = ['Idle', 'Walk', 'Attack', 'Cast', 'Hit', 'Death'];

const _box = new THREE.Box3();

function normalizeClipName(name) {
  const base = String(name).split('|').pop().trim();
  const found = CLIP_NAMES.find((c) => c.toLowerCase() === base.toLowerCase());
  return found || base;
}

function isEmissive(mat) {
  if (!mat || !mat.emissive) return false;
  const e = mat.emissive;
  return (e.r + e.g + e.b) * (mat.emissiveIntensity ?? 1) > 0.3;
}

/** Bake every mesh of `root` into world space and merge per material. */
function extractStaticParts(root) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  const glowBox = new THREE.Box3();
  let hasGlow = false;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    let g = o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    }
    for (const name of Object.keys(g.morphAttributes)) delete g.morphAttributes[name];
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(o.matrixWorld);
    if (o.matrixWorld.determinant() < 0) {
      // mirrored node: flip triangle winding
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i += 3) {
        for (const a of [p, n]) {
          if (!a) continue;
          for (let c = 0; c < a.itemSize; c++) {
            const t = a.array[(i + 1) * a.itemSize + c];
            a.array[(i + 1) * a.itemSize + c] = a.array[(i + 2) * a.itemSize + c];
            a.array[(i + 2) * a.itemSize + c] = t;
          }
        }
      }
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (isEmissive(mat)) {
      g.computeBoundingBox();
      glowBox.union(g.boundingBox);
      hasGlow = true;
    }
    let entry = byMat.get(mat);
    if (!entry) byMat.set(mat, (entry = { material: mat, geos: [] }));
    entry.geos.push(g);
  });
  const parts = [];
  for (const { material, geos } of byMat.values()) {
    const withColor = geos.every((g) => g.attributes.color);
    if (!withColor) for (const g of geos) if (g.attributes.color) g.deleteAttribute('color');
    for (const g of geos) {
      // colour attributes may be vec4 / normalized ints: make them float vec3 so merging works
      const c = g.attributes.color;
      if (c && (c.itemSize !== 3 || c.normalized || !(c.array instanceof Float32Array))) {
        const arr = new Float32Array(c.count * 3);
        for (let i = 0; i < c.count; i++) { arr[i * 3] = c.getX(i); arr[i * 3 + 1] = c.getY(i); arr[i * 3 + 2] = c.getZ(i); }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      }
    }
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    parts.push({ geometry: merged, material });
  }
  _box.setFromObject(root);
  const size = _box.getSize(new THREE.Vector3());
  const glow = hasGlow ? glowBox.getCenter(new THREE.Vector3()) : null;
  return { parts, height: size.y, width: Math.max(size.x, size.z), glow };
}

/** Prepare a loaded / fallback animated model template. */
function makeAnimatedTemplate(key, scene, animations, fallback) {
  scene.updateMatrixWorld(true);
  _box.setFromObject(scene);
  let size = _box.getSize(new THREE.Vector3());
  let scale = 1;
  const expected = EXPECTED_HEIGHT[key];
  if (!fallback && expected && size.y > 0.01) {
    const ratio = size.y / expected;
    if (ratio < 0.55 || ratio > 1.8) {
      scale = expected / size.y;
      console.info(`[assets] ${key}: height ${size.y.toFixed(2)} m, rescaled ×${scale.toFixed(2)}`);
    }
  }
  const height = Math.max(0.3, size.y * scale);
  const radius = Math.max(0.3, Math.max(size.x, size.z) * scale * 0.5);
  const clips = new Map();
  for (const clip of animations || []) clips.set(normalizeClipName(clip.name), clip);
  const skinned = [];
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.isSkinnedMesh) skinned.push(o);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && m.isMeshStandardMaterial) m.envMapIntensity = 0;
      }
    }
  });
  // generous culling sphere for skinned meshes (animations move vertices far from the bind pose)
  for (const m of skinned) {
    const inv = m.matrixWorld.clone().invert();
    const c = new THREE.Vector3(0, size.y / 2, 0).applyMatrix4(inv);
    const s = new THREE.Vector3().setFromMatrixScale(m.matrixWorld);
    const r = (Math.max(size.y, size.x, size.z) * 0.9) / Math.max(1e-4, Math.min(s.x, s.y, s.z));
    m.userData.cullSphere = new THREE.Sphere(c, r);
  }
  return { key, scene, clips, height, radius, scale, fallback, skinned: skinned.length > 0 };
}

export class AssetLibrary {
  constructor() {
    this.loader = new GLTFLoader();
    this.animated = new Map();
    this.statics = new Map();
    this.missing = [];
  }

  async _load(key) {
    try {
      const gltf = await this.loader.loadAsync(`/models/${key}.glb`);
      return gltf;
    } catch (err) {
      this.missing.push(key);
      console.info(`[assets] ${key}.glb indisponible → modèle de remplacement`, err?.message || '');
      return null;
    }
  }

  /** Load every model; onProgress(done, total, key). Never rejects. */
  async loadAll(onProgress) {
    const keys = [...ANIMATED_KEYS, ...STATIC_KEYS];
    let done = 0;
    const total = keys.length;
    await Promise.all(keys.map(async (key) => {
      const gltf = await this._load(key);
      try {
        if (ANIMATED_KEYS.includes(key)) {
          this.animated.set(key, gltf
            ? makeAnimatedTemplate(key, gltf.scene, gltf.animations, false)
            : makeAnimatedTemplate(key, buildCreatureFallback(key), [], true));
        } else {
          const res = gltf ? extractStaticParts(gltf.scene) : extractStaticParts(buildStaticFallback(key));
          res.fallback = !gltf;
          if (!res.parts.length) throw new Error('no mesh');
          this.statics.set(key, res);
        }
      } catch (err) {
        console.info(`[assets] ${key}: modèle invalide (${err.message}) → remplacement`);
        if (ANIMATED_KEYS.includes(key)) this.animated.set(key, makeAnimatedTemplate(key, buildCreatureFallback(key), [], true));
        else this.statics.set(key, { ...extractStaticParts(buildStaticFallback(key)), fallback: true });
      }
      done++;
      onProgress?.(done, total, key);
    }));
  }

  staticModel(key) {
    let s = this.statics.get(key);
    if (!s) {
      s = { ...extractStaticParts(buildStaticFallback(key)), fallback: true };
      this.statics.set(key, s);
    }
    return s;
  }

  template(key) {
    let t = this.animated.get(key);
    if (!t) {
      t = makeAnimatedTemplate(key, buildCreatureFallback(key), [], true);
      this.animated.set(key, t);
    }
    return t;
  }

  /**
   * Create an independent instance of an animated model.
   * Returns { object, clips, height, radius, materials: [{ mat, emissive, ei }], fallback }.
   */
  instantiate(key) {
    const t = this.template(key);
    const object = t.skinned ? SkeletonUtils.clone(t.scene) : t.scene.clone(true);
    if (t.scale !== 1) object.scale.multiplyScalar(t.scale);
    const matMap = new Map();
    const materials = [];
    object.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.isSkinnedMesh) {
        // (userData is JSON-cloned by Object3D.copy, so rebuild a real Sphere)
        const src = o.userData.cullSphere;
        if (src && src.center) {
          o.boundingSphere = new THREE.Sphere(new THREE.Vector3(src.center.x, src.center.y, src.center.z), src.radius);
        } else {
          o.frustumCulled = false;
        }
      }
      const swap = (m) => {
        let c = matMap.get(m);
        if (!c) {
          c = m.clone();
          matMap.set(m, c);
          materials.push({ mat: c, emissive: c.emissive ? c.emissive.clone() : null, ei: c.emissiveIntensity ?? 1 });
        }
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    return { object, clips: t.clips, height: t.height, radius: t.radius, materials, fallback: t.fallback };
  }

  /** Dispose an instance created by instantiate() (geometries are shared and kept). */
  disposeInstance(inst) {
    for (const { mat } of inst.materials) mat.dispose();
  }
}

