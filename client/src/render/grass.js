// Dense wind-blown grass, fully GPU-instanced: tiles of TILE metres around the camera, each drawn with one
// instanced call; every blade clump derives its position, size and colour from gl_InstanceID + the tile origin
// + the terrain maps (height, grass density / tint / height), so there is no per-instance CPU data at all.
// LOD = fewer instances per tile with the distance (the far set is a prefix of the near set → no popping),
// travelling gusts from wind.js, bending away from characters, shrink-out at the edge of the field.
// Uses /textures/grass_blades.webp (alpha atlas, cards) when it exists, otherwise procedural geometric blades.
import * as THREE from 'three';
import { WIND, WIND_PARS, BENDER_PARS } from './wind.js';

const TILE = 16;
const MAX_PER_TILE = 3600; // clumps per tile at full density (≈ 14 clumps / m², 3 blades each)

const GRASS_VERT_PARS = /* glsl */ `
${WIND_PARS}
${BENDER_PARS}
uniform sampler2D tGHeight;
uniform sampler2D tGMask;
uniform vec4 uGInfo;
uniform float uGDensity;
uniform float uGRadius;
uniform vec3 uGCam;
uniform float uGWidthScale;
uniform float uGTile;
uniform float uGMax;
attribute vec2 aBlade; // (blade index, width multiplier of the LOD)
varying vec3 vGColor;
varying float vGTip;
varying vec2 vGUv;
varying float vGVar;
varying vec3 vGWorld;
// share of the tile's clumps kept at a distance (the far LOD geometries draw a prefix of the instances)
float gLodKeep(float d) { return mix(mix(1.0, 0.42, smoothstep(10.0, 22.0, d)), 0.16, smoothstep(24.0, 38.0, d)); }
float gh1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec2 gUv(vec2 xz) { return ((xz + uGInfo.x) / uGInfo.y + 0.5) / uGInfo.z; }
`;

const GRASS_VERT = /* glsl */ `
vec3 gOrigin = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
float gid = float(gl_InstanceID);
// stable per-tile seed (tiles are re-used at other places: the seed follows the world tile, not the mesh)
float seed = gid * 1.618 + floor(gOrigin.x / uGTile) * 91.7 + floor(gOrigin.z / uGTile) * 53.3;
vec2 lp = vec2(gh1(seed), gh1(seed + 17.13)) * uGTile;
vec2 wxz = gOrigin.xz + lp;
vec4 gm = texture2D(tGMask, gUv(wxz));
float gy = texture2D(tGHeight, gUv(wxz)).r;
float dist = length(wxz - uGCam.xz);
float lodKeep = gLodKeep(dist);
float keep = step(gh1(seed + 3.7), gm.r * uGDensity) * step(gid / uGMax, lodKeep);
float fadeOut = 1.0 - smoothstep(uGRadius * 0.72, uGRadius, dist);
float H = (0.28 + 0.5 * gh1(seed + 5.1)) * (0.45 + gm.b * 1.05) * keep * fadeOut;
float yaw = gh1(seed + 9.3) * 6.2831853 + aBlade.x * 2.2;
float cy = cos(yaw), sy = sin(yaw);
float t = position.y; // 0 root … 1 tip
#ifdef GRASS_CARDS
  float W = (0.55 + 0.35 * gh1(seed + 2.2)) * uGWidthScale * aBlade.y * inversesqrt(max(lodKeep, 0.1));
  H *= 1.25;
#else
  float W = (0.06 + 0.045 * gh1(seed + 2.2)) * uGWidthScale * aBlade.y * (1.0 - t * 0.85) * inversesqrt(max(lodKeep, 0.1));
#endif
vec3 across = vec3(cy, 0.0, sy);
vec3 facing = vec3(-sy, 0.0, cy);
// static lean + wind + push by characters (bend grows with t²)
vec2 lean = (vec2(gh1(seed + 7.7), gh1(seed + 8.8)) - 0.5) * 0.35;
vec2 wind = bvWind(wxz, gh1(seed + 4.4));
vec2 push = bvBend(wxz) * 0.9;
vec2 bend = (lean + wind * 0.75 + push) * t * t * H;
float bl = length(bend);
float drop = 1.0 - min(0.6, bl * bl / max(H * H, 1e-4) * 0.5);
vec3 world = vec3(wxz.x, gy, wxz.y) + across * (position.x * W) + vec3(bend.x, t * H * drop, bend.y);
vec3 gTransformed = world - gOrigin;
vGWorld = world;
vGVar = gh1(seed + 21.7);
vGTip = t;
vGUv = vec2(position.x + 0.5, t);
// colour: dry/golden … lush, darker roots, per-clump variation
float v = gh1(seed + 12.1);
vec3 lush = mix(vec3(0.07, 0.14, 0.03), vec3(0.12, 0.2, 0.04), v);
vec3 dry = mix(vec3(0.2, 0.19, 0.06), vec3(0.28, 0.25, 0.09), v);
vGColor = mix(dry, lush, gm.g);
vGColor = mix(vGColor * 0.45, vGColor * (1.05 + 0.25 * gh1(seed + 1.9)), smoothstep(0.0, 0.85, t));
`;

const GRASS_FRAG_PARS = /* glsl */ `
varying vec3 vGColor;
varying float vGTip;
varying vec2 vGUv;
varying float vGVar;
varying vec3 vGWorld;
uniform sampler2D tGAtlas;
uniform float uGAtlasCols;
uniform vec3 uGSunDir;
uniform vec3 uGSunColor;
`;

/** Blade clump: `blades` tapered blades of `segments` segments; aBlade = (index, width multiplier). */
function bladeGeometry(segments = 3, blades = 3, widthMul = 1) {
  const pos = [], bl = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const base = pos.length / 3;
    for (let s = 0; s < segments; s++) {
      const t = s / segments;
      pos.push(-0.5, t, 0, 0.5, t, 0);
      bl.push(b, widthMul, b, widthMul);
    }
    pos.push(0, 1, 0);
    bl.push(b, widthMul);
    for (let s = 0; s < segments - 1; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const last = base + (segments - 1) * 2;
    idx.push(last, last + 1, base + segments * 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(bl, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

/** Two crossed alpha cards (atlas mode). */
function cardGeometry(widthMul = 1) {
  const pos = [], bl = [], idx = [];
  for (let b = 0; b < 2; b++) {
    const base = pos.length / 3;
    pos.push(-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0);
    for (let k = 0; k < 4; k++) bl.push(b * 0.714, widthMul); // aBlade.x × 2.2 ≈ 90° apart
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(bl, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setIndex(idx);
  return g;
}

export class GrassField {
  /** maps: terrainDataTextures() result; data: terrain data (for the per-tile density); atlas: optional texture. */
  constructor(scene, maps, data, atlas = null) {
    this.scene = scene;
    this.maps = maps;
    this.data = data;
    this.cards = !!atlas;
    this.group = new THREE.Group();
    this.group.name = 'grass';
    scene.add(this.group);
    this.density = 0.6;
    this.radius = 45;
    this.enabled = true;
    this.uniforms = {
      ...WIND,
      tGHeight: { value: maps.height },
      tGMask: { value: maps.grass },
      uGInfo: { value: maps.info },
      uGDensity: { value: 1 },
      uGRadius: { value: 45 },
      uGCam: { value: new THREE.Vector3() },
      uGWidthScale: { value: 1 },
      uGTile: { value: TILE },
      uGMax: { value: MAX_PER_TILE },
      tGAtlas: { value: atlas },
      uGAtlasCols: { value: atlas ? Math.max(1, Math.round((atlas.image?.width || 1) / (atlas.image?.height || 1))) : 1 },
      uGSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uGSunColor: { value: new THREE.Color(1, 1, 1) },
    };
    // LOD geometries: fewer blades / segments and fewer instances (a prefix of the full set) further away
    const LODS = this.cards
      ? [[1, () => cardGeometry(1)], [0.42, () => cardGeometry(1.15)], [0.16, () => cardGeometry(1.3)]]
      : [[1, () => bladeGeometry(3, 3, 1)], [0.42, () => bladeGeometry(2, 2, 1.25)], [0.16, () => bladeGeometry(2, 1, 1.7)]];
    this.lodGeos = LODS.map(([f, make]) => {
      const g = make();
      g.userData.fraction = f;
      g.instanceCount = Math.round(MAX_PER_TILE * f);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(TILE / 2, 0, TILE / 2), TILE * 0.72 + 7);
      g.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -8, -1), new THREE.Vector3(TILE + 1, 8, TILE + 1));
      return g;
    });
    this.material = this._material();
    this.tiles = new Map(); // key -> mesh
    this.pool = [];
    this._tileDensity = this._computeTileDensity();
    this._last = { x: NaN, z: NaN };
  }

  _material() {
    const U = this.uniforms;
    const cards = this.cards;
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.78, metalness: 0, side: THREE.DoubleSide,
      alphaTest: cards ? 0.45 : 0,
    });
    m.name = 'GrassField';
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${cards ? '#define GRASS_CARDS\n' : ''}${GRASS_VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', `${GRASS_VERT}\nvec3 objectNormal = normalize(mix(facing, vec3(0.0, 1.0, 0.0), 0.62));`)
        .replace('#include <begin_vertex>', 'vec3 transformed = gTransformed;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${cards ? '#define GRASS_CARDS\n' : ''}${GRASS_FRAG_PARS}`)
        .replace('#include <map_fragment>', `
#ifdef GRASS_CARDS
  float col = floor(vGVar * uGAtlasCols);
  vec4 atl = texture2D(tGAtlas, vec2((vGUv.x + col) / uGAtlasCols, vGUv.y));
  diffuseColor.a *= atl.a;
  diffuseColor.rgb *= mix(vGColor, atl.rgb * vGColor * 2.4, 0.5);
#else
  diffuseColor.rgb *= vGColor;
#endif`)
        // both faces keep the soft, up-facing normal (no back-face flip)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        // translucency: light through the blades when looking towards the sun
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 gV = normalize(cameraPosition - vGWorld);
  float back = pow(max(dot(-gV, uGSunDir), 0.0), 3.0);
  totalEmissiveRadiance += vGColor * uGSunColor * (0.03 + back * 0.5) * vGTip;
}`);
    };
    m.customProgramCacheKey = () => (cards ? 'grass-cards-v1' : 'grass-blades-v1');
    return m;
  }

  /** Max grass density per world tile (skips empty tiles entirely). */
  _computeTileDensity() {
    const d = this.data;
    const n = Math.ceil((d.half * 2) / TILE);
    const out = new Float32Array(n * n);
    const V = d.size;
    for (let j = 0; j < V; j++) {
      const z = -d.half + j * d.step;
      const tz = Math.min(n - 1, Math.floor((z + d.half) / TILE));
      for (let i = 0; i < V; i++) {
        const x = -d.half + i * d.step;
        const tx = Math.min(n - 1, Math.floor((x + d.half) / TILE));
        const g = d.grass[(j * V + i) * 4] / 255;
        const k = tz * n + tx;
        if (g > out[k]) out[k] = g;
      }
    }
    this._tilesN = n;
    return out;
  }

  /** density 0 (off) … 1, radius in metres. */
  configure(density, radius) {
    this.density = density;
    this.radius = radius;
    this.enabled = density > 0.01;
    this.uniforms.uGDensity.value = Math.min(1, density * 1.1);
    this.uniforms.uGRadius.value = radius;
    this.group.visible = this.enabled;
    this._last.x = NaN;
  }

  _mesh() {
    const m = this.pool.pop() || new THREE.Mesh(this.lodGeos[0], this.material);
    m.frustumCulled = true;
    m.castShadow = false;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.name = 'grassTile';
    this.group.add(m);
    return m;
  }

  update(camPos, focus, env) {
    if (!this.enabled) return;
    const U = this.uniforms;
    U.uGCam.value.copy(focus);
    if (env) {
      U.uGSunDir.value.copy(env.lightDir);
      U.uGSunColor.value.copy(env.lightColor).multiplyScalar(env.lightIntensity);
    }
    // rebuild the tile set when the focus moved by more than 2 m
    if (Math.abs(focus.x - this._last.x) < 2 && Math.abs(focus.z - this._last.z) < 2) return;
    this._last.x = focus.x;
    this._last.z = focus.z;
    const R = this.radius;
    const d = this.data;
    const n = this._tilesN;
    const t0x = Math.floor((focus.x - R + d.half) / TILE), t1x = Math.floor((focus.x + R + d.half) / TILE);
    const t0z = Math.floor((focus.z - R + d.half) / TILE), t1z = Math.floor((focus.z + R + d.half) / TILE);
    const want = new Set();
    for (let tz = Math.max(0, t0z); tz <= Math.min(n - 1, t1z); tz++) {
      for (let tx = Math.max(0, t0x); tx <= Math.min(n - 1, t1x); tx++) {
        if (this._tileDensity[tz * n + tx] < 0.02) continue;
        const ox = -d.half + tx * TILE, oz = -d.half + tz * TILE;
        const cx = ox + TILE / 2, cz = oz + TILE / 2;
        const dist = Math.max(0, Math.hypot(cx - focus.x, cz - focus.z) - TILE * 0.7);
        if (dist > R) continue;
        const key = tz * n + tx;
        want.add(key);
        let m = this.tiles.get(key);
        if (!m) {
          m = this._mesh();
          this.tiles.set(key, m);
          // tile height: sample the height map at its centre for a sensible bounding sphere
          const V = d.size;
          const i = Math.min(V - 1, Math.max(0, Math.round((cx + d.half) / d.step)));
          const j = Math.min(V - 1, Math.max(0, Math.round((cz + d.half) / d.step)));
          m.position.set(ox, d.heights[j * V + i], oz);
          m.updateMatrix();
          m.updateMatrixWorld();
        }
        const lod = dist < 22 ? 0 : dist < 38 ? 1 : 2; // see gLodKeep() in the shader
        m.geometry = this.lodGeos[lod];
      }
    }
    for (const [key, m] of this.tiles) {
      if (want.has(key)) continue;
      this.group.remove(m);
      this.pool.push(m);
      this.tiles.delete(key);
    }
  }

  /** Blade width compensation for the lower-density LODs is done by density; width scale follows quality. */
  setWidthScale(s) {
    this.uniforms.uGWidthScale.value = s;
  }

  get tileCount() {
    return this.tiles.size;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const g of this.lodGeos) g.dispose();
    this.material.dispose();
  }
}
