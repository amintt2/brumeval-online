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
import { isFaceted, smoothNormals } from './geomUtils.js';
import { assetExists } from './assetManifest.js';
import { windKindOf, windParamsFor, WIND_KIND_CODE } from './wind.js';

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

/** True if two skeletons use the same bones with the same inverse bind matrices. */
function sameSkin(a, b) {
  if (a.bones.length !== b.bones.length) return false;
  for (let i = 0; i < a.bones.length; i++) {
    if (a.bones[i] !== b.bones[i]) return false;
    const x = a.boneInverses[i].elements, y = b.boneInverses[i].elements;
    for (let k = 0; k < 16; k++) if (Math.abs(x[k] - y[k]) > 1e-5) return false;
  }
  return true;
}

function isEmissive(mat) {
  if (!mat || !mat.emissive) return false;
  const e = mat.emissive;
  return (e.r + e.g + e.b) * (mat.emissiveIntensity ?? 1) > 0.3;
}

// [render-souls] attributes kept when baking static meshes (textures need uvs / tangents)
const STATIC_ATTRS = ['position', 'normal', 'color', 'uv', 'uv1', 'uv2', 'tangent'];
const SPIN_NODE = /^sails?\b|^sails?[._-]/i;

function bakeStaticGeometry(o) {
  let g = o.geometry.clone();
  for (const name of Object.keys(g.attributes)) if (!STATIC_ATTRS.includes(name)) g.deleteAttribute(name);
  for (const name of Object.keys(g.morphAttributes)) delete g.morphAttributes[name];
  if (g.index) g = g.toNonIndexed();
  g.applyMatrix4(o.matrixWorld);
  if (o.matrixWorld.determinant() < 0) {
    // mirrored node: flip triangle winding
    for (const a of Object.values(g.attributes)) {
      const s = a.itemSize;
      for (let i = 0; i < a.count; i += 3) {
        for (let c = 0; c < s; c++) {
          const t = a.array[(i + 1) * s + c];
          a.array[(i + 1) * s + c] = a.array[(i + 2) * s + c];
          a.array[(i + 2) * s + c] = t;
        }
      }
    }
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

/** Merge geometries of one material: keep only the attributes they all have, normalise colour attributes. */
function mergeSameMaterial(geos) {
  const common = STATIC_ATTRS.filter((a) => geos.every((g) => g.attributes[a]));
  for (const g of geos) {
    for (const name of Object.keys(g.attributes)) if (!common.includes(name)) g.deleteAttribute(name);
    const c = g.attributes.color;
    if (c && (c.itemSize !== 3 || c.normalized || !(c.array instanceof Float32Array))) {
      const arr = new Float32Array(c.count * 3);
      for (let i = 0; i < c.count; i++) { arr[i * 3] = c.getX(i); arr[i * 3 + 1] = c.getY(i); arr[i * 3 + 2] = c.getZ(i); }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    for (const a of ['uv', 'uv1', 'uv2', 'tangent']) {
      const at = g.attributes[a];
      if (at && (at.normalized || !(at.array instanceof Float32Array))) {
        const arr = new Float32Array(at.count * at.itemSize);
        for (let i = 0; i < at.count; i++) for (let k = 0; k < at.itemSize; k++) arr[i * at.itemSize + k] = at.getComponent(i, k);
        g.setAttribute(a, new THREE.BufferAttribute(arr, at.itemSize));
      }
    }
  }
  return geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
}

/**
 * Bake every mesh of `root` into model space and merge per material. Nodes named "Sails…" (windmills) are kept
 * apart as spinning parts ({ geometry, material, pivot, axis }). Faceted (flat-exported) untextured meshes get
 * crease-angle smooth normals.
 */
function extractStaticParts(root, { smooth = true } = {}) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  const glowBox = new THREE.Box3();
  let hasGlow = false;
  const spinRoots = [];
  root.traverse((o) => { if (o !== root && SPIN_NODE.test(o.name || '')) spinRoots.push(o); });
  const inSpin = (o) => {
    for (let p = o; p; p = p.parent) if (spinRoots.includes(p)) return p;
    return null;
  };
  const spinByRoot = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const g = bakeStaticGeometry(o);
    if (isEmissive(mat)) {
      g.computeBoundingBox();
      glowBox.union(g.boundingBox);
      hasGlow = true;
    }
    const sr = inSpin(o);
    const map = sr ? (spinByRoot.get(sr) || spinByRoot.set(sr, new Map()).get(sr)) : byMat;
    let entry = map.get(mat);
    if (!entry) map.set(mat, (entry = { material: mat, geos: [] }));
    entry.geos.push(g);
  });
  const finish = (map) => {
    const parts = [];
    for (const { material, geos } of map.values()) {
      let merged = null;
      try {
        merged = mergeSameMaterial(geos);
      } catch {
        merged = null;
      }
      if (!merged) continue;
      if (smooth && !material.map && !material.normalMap && isFaceted(merged)) smoothNormals(merged, 40);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      parts.push({ geometry: merged, material });
    }
    return parts;
  };
  const parts = finish(byMat);
  const spin = [];
  for (const [sr, map] of spinByRoot) {
    const pivot = new THREE.Vector3().setFromMatrixPosition(sr.matrixWorld);
    // spin axis: the node's local +Y… unless the sails lie in a vertical plane (usual windmill): use the node's
    // forward axis (the thinnest extent of its bounding box)
    const box = new THREE.Box3();
    for (const p of finish(map)) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox);
      spin.push({ ...p, pivot });
    }
    const size = box.getSize(new THREE.Vector3());
    const axis = new THREE.Vector3(size.x < size.y && size.x < size.z ? 1 : 0, size.y <= size.x && size.y <= size.z ? 1 : 0, size.z < size.x && size.z < size.y ? 1 : 0);
    if (axis.lengthSq() === 0) axis.set(0, 0, 1);
    for (const s of spin) if (s.pivot === pivot) s.axis = axis;
  }
  _box.setFromObject(root);
  const size = _box.getSize(new THREE.Vector3());
  const glow = hasGlow ? glowBox.getCenter(new THREE.Vector3()) : null;
  return { parts, spin, height: size.y, width: Math.max(size.x, size.z), glow };
}

// [render-souls] Static models exported with many flat-colour materials (v0.1 kit: a well has 7, a stall 8):
// colour, roughness, metalness, emission (+ "lights up at night" flag) and wind parameters are baked into vertex
// attributes so the whole model is drawn with ONE material = one draw call per chunk (per side mode).
// Textured / transparent / alpha-tested materials are left as they are.
export const STATIC_UNIFORMS = { uNightGlow: { value: 1 } };
const NIGHT_GLOW = /(lantern|window|lamp|candle)/i;

function staticMergeable(m) {
  return !!m && m.isMeshStandardMaterial && !m.map && !m.normalMap && !m.alphaMap && !m.emissiveMap && !m.transparent
    && (m.opacity ?? 1) >= 1 && !m.alphaTest && !m.isMeshPhysicalMaterial;
}

function patchMergedStaticShader(sh) {
  sh.uniforms.uNightGlow = STATIC_UNIFORMS.uNightGlow;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 aPbr;\nattribute vec4 aEmis;\nvarying vec2 vPbr;\nvarying vec4 vEmis;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = aPbr;\nvEmis = aEmis;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;\nvarying vec4 vEmis;\nuniform float uNightGlow;')
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
    .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive + vEmis.rgb * mix(1.0, uNightGlow, vEmis.w);');
}

function mergeStaticParts(parts, modelKey) {
  const hasNamedWind = parts.some((p) => windKindOf(p.material));
  const keep = [];
  const groups = new Map(); // side -> geos
  for (const part of parts) {
    const m = part.material;
    if (!staticMergeable(m)) { keep.push(part); continue; }
    let g = part.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    const n = g.attributes.position.count;
    g.computeBoundingBox();
    const vc = m.vertexColors ? g.attributes.color : null;
    const col = new Float32Array(n * 3), pbr = new Float32Array(n * 2), em = new Float32Array(n * 4), wind = new Float32Array(n * 3);
    const e = m.emissive || new THREE.Color(0, 0, 0), ei = m.emissiveIntensity ?? 1;
    const night = NIGHT_GLOW.test(m.name || '') ? 1 : 0;
    const w = windParamsFor(m, g.boundingBox, modelKey, hasNamedWind);
    const wk = w ? WIND_KIND_CODE[w.kind] : 0;
    for (let i = 0; i < n; i++) {
      const r = vc ? vc.getX(i) : 1, gg = vc ? vc.getY(i) : 1, b = vc ? vc.getZ(i) : 1;
      col[i * 3] = m.color.r * r; col[i * 3 + 1] = m.color.g * gg; col[i * 3 + 2] = m.color.b * b;
      pbr[i * 2] = m.roughness ?? 1; pbr[i * 2 + 1] = m.metalness ?? 0;
      em[i * 4] = e.r * ei; em[i * 4 + 1] = e.g * ei; em[i * 4 + 2] = e.b * ei; em[i * 4 + 3] = night;
      wind[i * 3] = wk; wind[i * 3 + 1] = w ? w.amp : 0; wind[i * 3 + 2] = w ? w.base : 0;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 2));
    g.setAttribute('aEmis', new THREE.BufferAttribute(em, 4));
    g.setAttribute('aWind', new THREE.BufferAttribute(wind, 3));
    const side = m.side ?? THREE.FrontSide;
    let entry = groups.get(side);
    if (!entry) groups.set(side, (entry = { geos: [], wind: false, emissive: false }));
    entry.geos.push(g);
    if (w) entry.wind = true;
    if (e.r + e.g + e.b > 0.01) entry.emissive = true;
  }
  for (const [side, entry] of groups) {
    if (entry.geos.length < 2 && !entry.wind) {
      // a single material: nothing to gain, keep the original part
      const orig = parts.find((p) => staticMergeable(p.material) && (p.material.side ?? THREE.FrontSide) === side);
      if (orig) { keep.push(orig); continue; }
    }
    const merged = entry.geos.length === 1 ? entry.geos[0] : mergeGeometries(entry.geos, false);
    if (!merged) { for (const p of parts) if (staticMergeable(p.material) && (p.material.side ?? THREE.FrontSide) === side) keep.push(p); continue; }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    merged.userData.hasWind = entry.wind;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side });
    mat.name = `${modelKey}_merged`;
    mat.userData.mergedStatic = true;
    mat.userData.hasWind = entry.wind;
    mat.onBeforeCompile = patchMergedStaticShader;
    mat.customProgramCacheKey = () => 'merged-static-v1';
    keep.push({ geometry: merged, material: mat });
  }
  return keep;
}

/** Anisotropic filtering on every texture of a loaded model (colour spaces are set by GLTFLoader). */
function tuneTextures(root, anisotropy) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
        const t = m[k];
        if (t && t.isTexture && t.anisotropy !== anisotropy) { t.anisotropy = anisotropy; t.needsUpdate = true; }
      }
    }
  });
}

// ------------------------------------------------------------------ character merging
// Character GLBs have ~8-16 flat-colour materials each (one draw call per material, twice with shadows).
// All their opaque primitives are merged into ONE mesh whose colour / roughness / metalness / emission are
// baked into vertex attributes and read by a lightly patched MeshStandardMaterial. The material's own
// `emissive` stays free (black) for per-instance hit flashes and frost tint.
const _identity = new THREE.Matrix4();

function patchMergedShader(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 aPbr;\nattribute vec3 aEmis;\nvarying vec2 vPbr;\nvarying vec3 vEmis;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = aPbr;\nvEmis = aEmis;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;\nvarying vec3 vEmis;')
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
    .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive + vEmis;');
}
const mergedKey = () => 'merged-pbr-v1';

function mergedMaterial(flat) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: !!flat });
  m.name = 'merged';
  m.onBeforeCompile = patchMergedShader;
  m.customProgramCacheKey = mergedKey;
  return m;
}

const mergeable = (m) => m && m.isMeshStandardMaterial && !m.map && !m.transparent && (m.opacity ?? 1) >= 1 && !m.alphaTest;

/** Bake one primitive into merged-format attributes (optionally rigidly bound to `boneIndex`). */
function bakePart(src, matrix, mat, skin, boneIndex) {
  let g = src.clone();
  const keep = skin ? ['position', 'normal', 'color', 'skinIndex', 'skinWeight'] : ['position', 'normal', 'color'];
  for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
  g.morphAttributes = {};
  if (g.index) g = g.toNonIndexed();
  g.applyMatrix4(matrix);
  const n = g.attributes.position.count;
  if (matrix.determinant() < 0) {
    for (const a of Object.values(g.attributes)) {
      const s = a.itemSize;
      for (let i = 0; i < n; i += 3) {
        for (let c = 0; c < s; c++) {
          const t = a.array[(i + 1) * s + c];
          a.array[(i + 1) * s + c] = a.array[(i + 2) * s + c];
          a.array[(i + 2) * s + c] = t;
        }
      }
    }
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const vc = mat.vertexColors ? g.attributes.color : null;
  const col = new Float32Array(n * 3), pbr = new Float32Array(n * 2), em = new Float32Array(n * 3);
  const c = mat.color, e = mat.emissive || new THREE.Color(0, 0, 0), ei = mat.emissiveIntensity ?? 1;
  const rough = mat.roughness ?? 1, metal = mat.metalness ?? 0;
  for (let i = 0; i < n; i++) {
    const r = vc ? vc.getX(i) : 1, gg = vc ? vc.getY(i) : 1, b = vc ? vc.getZ(i) : 1;
    col[i * 3] = c.r * r; col[i * 3 + 1] = c.g * gg; col[i * 3 + 2] = c.b * b;
    pbr[i * 2] = rough; pbr[i * 2 + 1] = metal;
    em[i * 3] = e.r * ei; em[i * 3 + 1] = e.g * ei; em[i * 3 + 2] = e.b * ei;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 2));
  g.setAttribute('aEmis', new THREE.BufferAttribute(em, 3));
  if (skin) {
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    for (let i = 0; i < n; i++) {
      if (boneIndex !== null || !SI) {
        si[i * 4] = boneIndex ?? 0; sw[i * 4] = 1;
      } else {
        si[i * 4] = SI.getX(i); si[i * 4 + 1] = SI.getY(i); si[i * 4 + 2] = SI.getZ(i); si[i * 4 + 3] = SI.getW(i);
        sw[i * 4] = SW.getX(i); sw[i * 4 + 1] = SW.getY(i); sw[i * 4 + 2] = SW.getZ(i); sw[i * 4 + 3] = SW.getW(i);
      }
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }
  return g;
}

/** Merge the opaque primitives of a skinned character into one SkinnedMesh. Returns the number merged. */
function mergeSkinned(scene) {
  scene.updateMatrixWorld(true);
  const skinned = [], rigid = [];
  scene.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || !mergeable(o.material)) return;
    if (o.isSkinnedMesh) { skinned.push(o); return; }
    let p = o.parent;
    while (p && !p.isBone) p = p.parent;
    if (p) rigid.push({ o, bone: p });
  });
  if (!skinned.length) return 0;
  const skeleton = skinned[0].skeleton;
  const parts = skinned.filter((o) => sameSkin(o.skeleton, skeleton));
  const rigidParts = rigid.filter((r) => skeleton.bones.includes(r.bone));
  if (parts.length + rigidParts.length < 2) return 0;
  const geos = [
    ...parts.map((o) => bakePart(o.geometry, o.bindMatrix, o.material, true, null)),
    ...rigidParts.map(({ o, bone }) => bakePart(o.geometry, o.matrixWorld, o.material, true, skeleton.bones.indexOf(bone))),
  ];
  const merged = mergeGeometries(geos, false);
  if (!merged) return 0;
  // [render-souls] flat-exported characters: smooth the curved parts (robes, sleeves, hats), keep hard edges
  if (isFaceted(merged)) smoothNormals(merged, 50);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  const mesh = new THREE.SkinnedMesh(merged, mergedMaterial(false));
  mesh.name = 'mergedBody';
  scene.add(mesh);
  mesh.updateMatrixWorld(true);
  mesh.bind(skeleton, _identity.clone());
  for (const o of parts) o.parent?.remove(o);
  for (const { o } of rigidParts) o.parent?.remove(o);
  return parts.length + rigidParts.length;
}

/** Merge a rigid (fallback) model into one Mesh. */
function mergeRigid(scene) {
  scene.updateMatrixWorld(true);
  const list = [];
  scene.traverse((o) => { if (o.isMesh && !Array.isArray(o.material) && mergeable(o.material)) list.push(o); });
  if (list.length < 2) return scene;
  const merged = mergeGeometries(list.map((o) => bakePart(o.geometry, o.matrixWorld, o.material, false, null)), false);
  if (!merged) return scene;
  const root = new THREE.Group();
  root.name = scene.name;
  const mesh = new THREE.Mesh(merged, mergedMaterial(true));
  mesh.name = 'mergedBody';
  root.add(mesh);
  return root;
}

/** Prepare a loaded / fallback animated model template. */
function makeAnimatedTemplate(key, scene, animations, fallback) {
  scene.updateMatrixWorld(true);
  _box.setFromObject(scene);
  let size = _box.getSize(new THREE.Vector3());
  try {
    if (fallback) scene = mergeRigid(scene);
    else mergeSkinned(scene);
  } catch (err) {
    console.info(`[assets] ${key}: fusion des maillages impossible (${err.message})`);
  }
  scene.updateMatrixWorld(true);
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
      // [render-souls] characters now receive the image-based lighting (IBL) like the rest of the world
      for (const m of mats) {
        if (m && m.isMeshStandardMaterial) m.envMapIntensity = 1;
      }
      // unmerged faceted primitives (e.g. textured parts of an old export): smooth them too
      const m0 = mats[0];
      if (o.name !== 'mergedBody' && o.geometry && !m0?.normalMap && !o.morphTargetInfluences) {
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
        if (isFaceted(g)) {
          smoothNormals(g, 50);
          o.geometry = g;
        }
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
    this.anisotropy = 4; // [render-souls] set from the graphics settings before loadAll()
  }

  async _load(key, optional = false) {
    // [render-souls] skip files the asset manifest knows are absent (no 404 noise)
    if (await assetExists(`/models/${key}.glb`) === false) {
      if (!optional) this.missing.push(key);
      return null;
    }
    try {
      const gltf = await this.loader.loadAsync(`/models/${key}.glb`);
      tuneTextures(gltf.scene, this.anisotropy);
      return gltf;
    } catch (err) {
      if (optional) return null;
      this.missing.push(key);
      // a missing file comes back as a 404 or as the SPA index.html: that's expected, stay quiet
      const msg = String(err?.message || err || '');
      if (!/404|doctype|not valid JSON|Failed to fetch/i.test(msg)) console.info(`[assets] ${key}.glb illisible (${msg}) → modèle de remplacement`);
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
          // [render-souls] optional LOD files <key>_lod1.glb / <key>_lod2.glb (static models only)
          res.parts = mergeStaticParts(res.parts, key);
          res.lods = [res.parts];
          if (gltf) {
            for (const l of [1, 2]) {
              const lg = await this._load(`${key}_lod${l}`, true);
              if (!lg) break;
              try {
                const lr = extractStaticParts(lg.scene);
                if (lr.parts.length) res.lods.push(mergeStaticParts(lr.parts, key));
              } catch {
                break;
              }
            }
          }
          this.statics.set(key, res);
        }
      } catch (err) {
        console.info(`[assets] ${key}: modèle invalide (${err.message}) → remplacement`);
        if (ANIMATED_KEYS.includes(key)) this.animated.set(key, makeAnimatedTemplate(key, buildCreatureFallback(key), [], true));
        else {
          const fb = { ...extractStaticParts(buildStaticFallback(key)), fallback: true };
          fb.parts = mergeStaticParts(fb.parts, key);
          fb.lods = [fb.parts];
          this.statics.set(key, fb);
        }
      }
      done++;
      onProgress?.(done, total, key);
    }));
  }

  staticModel(key) {
    let s = this.statics.get(key);
    if (!s) {
      s = { ...extractStaticParts(buildStaticFallback(key)), fallback: true };
      s.parts = mergeStaticParts(s.parts, key);
      s.lods = [s.parts];
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
          if (m.onBeforeCompile === patchMergedShader) {
            // Material.clone() does not carry the shader patch over
            c.onBeforeCompile = patchMergedShader;
            c.customProgramCacheKey = mergedKey;
          }
          matMap.set(m, c);
          materials.push({ mat: c, emissive: c.emissive ? c.emissive.clone() : null, ei: c.emissiveIntensity ?? 1 });
        }
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    // GLTFLoader + SkeletonUtils give every skinned primitive its own Skeleton (and bone texture). Primitives of
    // the same skin are bound to the same bones with the same inverses: share one Skeleton per skin instead.
    const skeletons = [];
    if (t.skinned) {
      object.traverse((o) => {
        if (!o.isSkinnedMesh || !o.skeleton) return;
        const sk = o.skeleton;
        const shared = skeletons.find((s) => sameSkin(s, sk));
        if (shared) o.bind(shared, o.bindMatrix);
        else skeletons.push(sk);
      });
    }
    return { object, clips: t.clips, height: t.height, radius: t.radius, materials, skeletons, fallback: t.fallback };
  }

  /** Dispose an instance created by instantiate() (geometries are shared and kept). */
  disposeInstance(inst) {
    for (const { mat } of inst.materials) mat.dispose();
    for (const sk of inst.skeletons || []) sk.dispose();
  }
}

