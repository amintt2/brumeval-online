// Terrain: chunked heightfield meshes (3 LODs with skirts, frustum + distance culling) shaded by a PBR splat
// material (10 texture layers blended by biome / height / slope / road distance, height-aware blending, triplanar
// rock on steep slopes, anti-tiling and macro variation, per-pixel normals from the height map), the distant
// mountain ring, PBR water, and the analytic height raycast.
import * as THREE from 'three';
import { WORLD_HALF, TERRAIN_STEP, WATER_LEVEL, terrainHeight } from '@shared/world.js';
import { fbm2, valueNoise2, smoothstep, clamp } from '@shared/noise.js';
import { LAYERS } from './terrainData.js';

/** Metres covered by one repeat of each layer's texture (same order as LAYERS). */
const TILE = { grass: 3.2, forest_floor: 3.6, dirt: 3.0, road: 3.4, cobble: 2.2, rock: 5.5, snow: 5, sand: 3.5, mud: 3.2, ash: 3.4 };
const CHUNK_TARGET = 64; // metres (rounded to a whole number of grid cells)

// ------------------------------------------------------------------ shader
const TERRAIN_PARS = /* glsl */ `
varying vec3 vTerrainPos;
uniform sampler2D tTHeight;
uniform sampler2D tTSplat0;
uniform sampler2D tTSplat1;
uniform sampler2D tTSplat2;
uniform sampler2DArray tTAlbedo;
uniform sampler2DArray tTNormal;
uniform sampler2DArray tTOrm;
uniform vec4 uTInfo;            // half, step, size
uniform float uTTile[${LAYERS.length}];
uniform float uTWaterLevel;
uniform float uTDetail;         // 1 = full detail (anti-tiling second sample)
float tHash(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 tHmUv(vec2 xz) { return ((xz + uTInfo.x) / uTInfo.y + 0.5) / uTInfo.z; }
float tHeightAt(vec2 xz) { return texture2D(tTHeight, tHmUv(xz)).r; }
// OpenGL-convention tangent normal (green = image up) on the XZ plane → world offset
vec3 tDetailY(vec3 tn) { return vec3(tn.x, 0.0, -tn.y); }
`;

const TERRAIN_FRAG = /* glsl */ `
vec3 tWorldN;
float tRough;
float tAO;
{
  vec3 p = vTerrainPos;
  float camDist = length(cameraPosition - p);
  #ifdef TERRAIN_RING
    vec3 macroN = normalize(vTRingNormal);
  #else
    float s = uTInfo.y;
    float hl = tHeightAt(p.xz - vec2(s, 0.0)), hr = tHeightAt(p.xz + vec2(s, 0.0));
    float hd = tHeightAt(p.xz - vec2(0.0, s)), hu = tHeightAt(p.xz + vec2(0.0, s));
    vec3 macroN = normalize(vec3(hl - hr, 2.0 * s, hd - hu));
  #endif
  float w[10];
  #ifdef TERRAIN_RING
    // outside the play area: grass / forest floor low, rock and snow up the slopes
    float rn = tNoise(p.xz * 0.05);
    for (int i = 0; i < 10; i++) w[i] = 0.0;
    float rockR = max(smoothstep(0.82, 0.62, macroN.y), smoothstep(18.0, 40.0, p.y + rn * 14.0));
    float snowR = smoothstep(78.0, 100.0, p.y + rn * 16.0) * smoothstep(0.5, 0.75, macroN.y);
    w[0] = (1.0 - rockR) * (0.4 + rn * 0.6);
    w[1] = (1.0 - rockR) * (1.0 - rn) * 0.8;
    w[5] = rockR * 3.0;
    w[6] = snowR * 8.0;
  #else
    vec2 suv = tHmUv(p.xz);
    vec4 s0 = texture2D(tTSplat0, suv), s1 = texture2D(tTSplat1, suv), s2 = texture2D(tTSplat2, suv);
    w[0] = s0.r; w[1] = s0.g; w[2] = s0.b; w[3] = s0.a;
    w[4] = s1.r; w[5] = s1.g; w[6] = s1.b; w[7] = s1.a;
    w[8] = s2.r; w[9] = s2.g;
    // per-pixel slope rock (sharper than the splat map)
    w[5] += smoothstep(0.8, 0.6, macroN.y) * 2.5;
  #endif
  // break the splat borders with noise
  float bn = tNoise(p.xz * 0.9) - 0.5;
  // pick the 3 strongest layers
  int i0 = 0, i1 = 1, i2 = 2;
  float w0 = -1.0, w1 = -1.0, w2 = -1.0;
  for (int i = 0; i < 10; i++) {
    float v = w[i] * (1.0 + bn * 0.35 * float(i != 0));
    if (v > w0) { w2 = w1; i2 = i1; w1 = w0; i1 = i0; w0 = v; i0 = i; }
    else if (v > w1) { w2 = w1; i2 = i1; w1 = v; i1 = i; }
    else if (v > w2) { w2 = v; i2 = i; }
  }
  w0 = max(w0, 0.0); w1 = max(w1, 0.0); w2 = max(w2, 0.0);
  float macro = tNoise(p.xz * 0.021) * 0.6 + tNoise(p.xz * 0.083) * 0.4;
  float detail = uTDetail * smoothstep(8.0, 30.0, camDist) * 0.55 + 0.2 * uTDetail;
  // triplanar weights (rock only)
  vec3 tw = pow(abs(macroN), vec3(4.0));
  tw /= (tw.x + tw.y + tw.z);
  bool steep = macroN.y < 0.86;
  vec3 dpx = dFdx(p), dpy = dFdy(p);
  vec4 A[3]; vec3 N[3]; vec4 O[3];
  int ids[3]; ids[0] = i0; ids[1] = i1; ids[2] = i2;
  float ws[3]; ws[0] = w0; ws[1] = w1; ws[2] = w2;
  for (int k = 0; k < 3; k++) {
    float li = float(ids[k]);
    float tile = uTTile[ids[k]];
    if (ws[k] <= 0.002) { A[k] = vec4(0.5); N[k] = vec3(0.0); O[k] = vec4(1.0, 0.9, 0.0, 1.0); continue; }
    if (ids[k] == 5 && steep) {
      // triplanar rock
      vec3 q = p / tile;
      vec3 gx = dpx / tile, gy = dpy / tile;
      vec4 ax = textureGrad(tTAlbedo, vec3(q.zy, li), gx.zy, gy.zy), ay = textureGrad(tTAlbedo, vec3(q.xz, li), gx.xz, gy.xz), az = textureGrad(tTAlbedo, vec3(q.xy, li), gx.xy, gy.xy);
      vec3 nx = textureGrad(tTNormal, vec3(q.zy, li), gx.zy, gy.zy).xyz * 2.0 - 1.0;
      vec3 ny = textureGrad(tTNormal, vec3(q.xz, li), gx.xz, gy.xz).xyz * 2.0 - 1.0;
      vec3 nz = textureGrad(tTNormal, vec3(q.xy, li), gx.xy, gy.xy).xyz * 2.0 - 1.0;
      vec4 ox = textureGrad(tTOrm, vec3(q.zy, li), gx.zy, gy.zy), oy = textureGrad(tTOrm, vec3(q.xz, li), gx.xz, gy.xz), oz = textureGrad(tTOrm, vec3(q.xy, li), gx.xy, gy.xy);
      A[k] = ax * tw.x + ay * tw.y + az * tw.z;
      O[k] = ox * tw.x + oy * tw.y + oz * tw.z;
      N[k] = vec3(0.0, -nx.y, nx.x) * sign(macroN.x) * tw.x + tDetailY(ny) * tw.y + vec3(nz.x, -nz.y, 0.0) * sign(macroN.z) * tw.z;
    } else {
      vec2 uv = p.xz / tile;
      vec2 ux = dpx.xz / tile, uy = dpy.xz / tile;
      A[k] = textureGrad(tTAlbedo, vec3(uv, li), ux, uy);
      N[k] = tDetailY(textureGrad(tTNormal, vec3(uv, li), ux, uy).xyz * 2.0 - 1.0);
      O[k] = textureGrad(tTOrm, vec3(uv, li), ux, uy);
      if (detail > 0.01) {
        // anti-tiling: a rotated, larger-scale second sample blended by a macro noise
        vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.37 + vec2(0.31, 0.77);
        mat2 rot2 = mat2(0.8, -0.6, 0.6, 0.8) * 0.37;
        vec4 a2 = textureGrad(tTAlbedo, vec3(uv2, li), rot2 * ux, rot2 * uy);
        float m = detail * (0.35 + 0.65 * smoothstep(0.3, 0.7, macro));
        A[k] = vec4(mix(A[k].rgb, a2.rgb, m * 0.6), mix(A[k].a, a2.a, m * 0.5));
      }
    }
  }
  // height-aware blending (albedo alpha = height when provided, else the ORM occlusion)
  float h0 = A[0].a < 0.995 ? A[0].a : O[0].r;
  float h1 = A[1].a < 0.995 ? A[1].a : O[1].r;
  float h2 = A[2].a < 0.995 ? A[2].a : O[2].r;
  float sum = w0 + w1 + w2 + 1e-4;
  vec3 hb = vec3(w0, w1, w2) / sum + vec3(h0, h1, h2) * 0.55;
  float top = max(hb.x, max(hb.y, hb.z)) - 0.22;
  vec3 bw = max(hb - top, 0.0);
  bw *= vec3(step(0.002, w0), step(0.002, w1), step(0.002, w2));
  bw /= (bw.x + bw.y + bw.z + 1e-4);
  vec3 albedo = A[0].rgb * bw.x + A[1].rgb * bw.y + A[2].rgb * bw.z;
  vec3 dn = N[0] * bw.x + N[1] * bw.y + N[2] * bw.z;
  vec4 orm = O[0] * bw.x + O[1] * bw.y + O[2] * bw.z;
  // macro variation (breaks the repetition at a distance)
  albedo *= 0.84 + 0.3 * macro;
  albedo = mix(albedo, albedo * vec3(1.06, 1.0, 0.9), smoothstep(0.55, 0.9, tNoise(p.xz * 0.013 + 4.0)) * 0.5);
  // wet ground at the shore
  float wet = 1.0 - smoothstep(uTWaterLevel - 0.1, uTWaterLevel + 0.55, p.y);
  albedo *= 1.0 - wet * 0.38;
  tRough = mix(orm.g, 0.18, wet * 0.85);
  tAO = mix(1.0, orm.r, 0.85);
  float nStrength = 1.0 - smoothstep(30.0, 90.0, camDist) * 0.6;
  tWorldN = normalize(macroN + dn * nStrength);
  diffuseColor.rgb *= albedo;
}
`;

function patchTerrainMaterial(material, uniforms, ring) {
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vTerrainPos;${ring ? '\nvarying vec3 vTRingNormal;' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\nvTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;${ring ? '\nvTRingNormal = normalize(mat3(modelMatrix) * objectNormal);' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${ring ? '#define TERRAIN_RING\nvarying vec3 vTRingNormal;\n' : ''}${TERRAIN_PARS}`)
      .replace('#include <map_fragment>', TERRAIN_FRAG)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tWorldN, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= tAO;\nreflectedLight.indirectSpecular *= tAO;');
  };
  material.customProgramCacheKey = () => (ring ? 'terrain-pbr-ring-v2' : 'terrain-pbr-v2');
}

// ------------------------------------------------------------------ chunk geometry
function sampleGrid(data, x, z) {
  const V = data.size, S = data.step, H = data.half;
  const fx = clamp((x + H) / S, 0, V - 1), fz = clamp((z + H) / S, 0, V - 1);
  const i = Math.min(V - 2, Math.floor(fx)), j = Math.min(V - 2, Math.floor(fz));
  const u = fx - i, v = fz - j;
  const h = data.heights;
  const a = h[j * V + i], b = h[j * V + i + 1], c = h[(j + 1) * V + i], d = h[(j + 1) * V + i + 1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function chunkGeometry(data, x0, z0, wx, wz, cells, skirt) {
  const cx = cells, cz = Math.max(1, Math.round(cells * (wz / wx)));
  const nx = cx + 1, nz = cz + 1;
  const gridCount = nx * nz;
  const edge = 2 * (nx + nz) - 4;
  const count = gridCount + edge;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const e = data.step;
  let k = 0;
  const put = (x, z, y) => {
    const hl = sampleGrid(data, x - e, z), hr = sampleGrid(data, x + e, z);
    const hd = sampleGrid(data, x, z - e), hu = sampleGrid(data, x, z + e);
    let ax = hl - hr, ay = 2 * e, az = hd - hu;
    const l = Math.hypot(ax, ay, az);
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    nrm[k * 3] = ax / l; nrm[k * 3 + 1] = ay / l; nrm[k * 3 + 2] = az / l;
    k++;
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i / cx) * wx, z = z0 + (j / cz) * wz;
      put(x, z, sampleGrid(data, x, z));
    }
  }
  const idx = [];
  for (let j = 0; j < cz; j++) {
    for (let i = 0; i < cx; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if ((i + j) & 1) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  // skirt: a curtain hanging below the border hides the cracks between LODs
  const ring = [];
  for (let i = 0; i < nx; i++) ring.push(i);
  for (let j = 1; j < nz; j++) ring.push(j * nx + cx);
  for (let i = cx - 1; i >= 0; i--) ring.push(cz * nx + i);
  for (let j = cz - 1; j >= 1; j--) ring.push(j * nx);
  const skirtStart = k;
  for (const v of ring) {
    const x = pos[v * 3], z = pos[v * 3 + 2];
    pos[k * 3] = x; pos[k * 3 + 1] = pos[v * 3 + 1] - skirt; pos[k * 3 + 2] = z;
    nrm[k * 3] = nrm[v * 3]; nrm[k * 3 + 1] = nrm[v * 3 + 1]; nrm[k * 3 + 2] = nrm[v * 3 + 2];
    k++;
  }
  for (let r = 0; r < ring.length; r++) {
    const a = ring[r], b = ring[(r + 1) % ring.length];
    const sa = skirtStart + r, sb = skirtStart + ((r + 1) % ring.length);
    // both windings: a crack can be seen from either side of the seam
    idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ------------------------------------------------------------------ terrain
export class Terrain {
  /**
   * data: output of computeTerrainData, maps: terrainDataTextures(data), layers: loadTerrainTextures().
   */
  constructor(data, maps, layers) {
    this.data = data;
    this.maps = maps;
    this.layers = layers;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.chunks = [];
    this.viewDistance = 400;
    this.uniforms = {
      tTHeight: { value: maps.height },
      tTSplat0: { value: maps.splat0 },
      tTSplat1: { value: maps.splat1 },
      tTSplat2: { value: maps.splat2 },
      tTAlbedo: { value: layers.albedo },
      tTNormal: { value: layers.normal },
      tTOrm: { value: layers.orm },
      uTInfo: { value: maps.info },
      uTTile: { value: LAYERS.map((n) => TILE[n] || 3) },
      uTWaterLevel: { value: WATER_LEVEL },
      uTDetail: { value: 1 },
    };
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    this.material.name = 'terrain';
    patchTerrainMaterial(this.material, this.uniforms, false);
    this.ringMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    this.ringMaterial.name = 'terrainRing';
    patchTerrainMaterial(this.ringMaterial, this.uniforms, true);
    this._build();
  }

  _build() {
    const d = this.data;
    const cellsTotal = d.size - 1;
    const per = Math.max(8, Math.round(CHUNK_TARGET / d.step / 4) * 4); // cells per chunk (multiple of 4)
    const n = Math.ceil(cellsTotal / per);
    for (let cj = 0; cj < n; cj++) {
      for (let ci = 0; ci < n; ci++) {
        const i0 = ci * per, j0 = cj * per;
        const ic = Math.min(per, cellsTotal - i0), jc = Math.min(per, cellsTotal - j0);
        const x0 = -d.half + i0 * d.step, z0 = -d.half + j0 * d.step;
        const wx = ic * d.step, wz = jc * d.step;
        const lods = [];
        for (let l = 0; l < 3; l++) {
          const cells = Math.max(1, Math.round(ic / (1 << l)));
          const geo = chunkGeometry(d, x0, z0, wx, wz, cells, 3 + l * 4); // skirts deep enough for steep LOD seams
          const m = new THREE.Mesh(geo, this.material);
          m.name = `terrain_${ci}_${cj}_lod${l}`;
          m.receiveShadow = true;
          m.castShadow = false;
          m.matrixAutoUpdate = false;
          m.visible = l === 0;
          this.group.add(m);
          lods.push(m);
        }
        const cx = x0 + wx / 2, cz = z0 + wz / 2;
        this.chunks.push({ lods, cx, cz, r: Math.hypot(wx, wz) / 2, lod: 0 });
      }
    }
    this.chunkSize = per * d.step;
  }

  /** Terrain meshes use this material (the mountain ring uses ringMaterial). */
  setAnisotropy(a) {
    for (const t of [this.layers.albedo, this.layers.normal, this.layers.orm]) {
      if (t.anisotropy !== a) { t.anisotropy = a; t.needsUpdate = true; }
    }
  }

  setDetail(full) {
    this.uniforms.uTDetail.value = full ? 1 : 0;
  }

  /** Per frame (cheap): choose each chunk's LOD from its distance to the camera, cull beyond the view distance. */
  update(camPos) {
    const cs = this.chunkSize;
    for (const c of this.chunks) {
      const d = Math.max(0, Math.hypot(c.cx - camPos.x, c.cz - camPos.z) - c.r);
      let lod = d < cs * 0.6 ? 0 : d < cs * 1.9 ? 1 : 2;
      // hysteresis: keep the current LOD within a small band
      if (lod !== c.lod) {
        const band = cs * 0.08;
        const d2 = Math.max(0, d + (lod > c.lod ? -band : band));
        const lod2 = d2 < cs * 0.6 ? 0 : d2 < cs * 1.9 ? 1 : 2;
        if (lod2 === c.lod) lod = c.lod;
      }
      const vis = d < this.viewDistance;
      for (let l = 0; l < 3; l++) c.lods[l].visible = vis && l === lod;
      c.lod = lod;
    }
  }

  dispose() {
    for (const c of this.chunks) for (const m of c.lods) m.geometry.dispose();
    this.material.dispose();
    this.ringMaterial.dispose();
  }
}

// ------------------------------------------------------------------ distant mountains
/**
 * Decorative mountain range outside the playable square (|x|,|z| > WORLD_HALF): it continues the edge cliffs of
 * the terrain into jagged, snow-capped ridges that fade into the fog.
 */
export function buildMountainRing(material) {
  const OUT = WORLD_HALF + 280, STEP = 6;
  const N = Math.round((OUT * 2) / STEP);
  const V = N + 1;
  const pos = new Float32Array(V * V * 3);
  const edgeIn = WORLD_HALF - 3;
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      let x = -OUT + i * STEP, z = -OUT + j * STEP;
      const k = j * V + i;
      const e = Math.max(Math.abs(x), Math.abs(z));
      if (e < edgeIn) {
        const s = edgeIn / e;
        x *= s; z *= s;
      }
      const ex = clamp(x, -WORLD_HALF, WORLD_HALF), ez = clamp(z, -WORLD_HALF, WORLD_HALF);
      const base = terrainHeight(ex, ez) - 0.8;
      const out = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - WORLD_HALF);
      const ridge = 1 - Math.abs(fbm2(x * 0.011, z * 0.011, 4242, 4) * 2 - 1);
      const peaks = fbm2(x * 0.004, z * 0.004, 777, 3);
      const rise = smoothstep(0, 110, out) * (30 + ridge * ridge * 95 * (0.55 + peaks * 0.9));
      const h = base + rise + (valueNoise2(x * 0.09, z * 0.09, 31) - 0.5) * 3 * smoothstep(0, 40, out);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    }
  }
  const idx = [];
  const inner = WORLD_HALF - STEP * 2;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x0 = -OUT + i * STEP, z0 = -OUT + j * STEP;
      if (Math.max(Math.abs(x0), Math.abs(x0 + STEP)) < inner && Math.max(Math.abs(z0), Math.abs(z0 + STEP)) < inner) continue;
      const a = j * V + i, b = a + 1, cc = a + V, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'mountains';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

// ------------------------------------------------------------------ water
const WATER_PARS = /* glsl */ `
varying vec3 vWPos;
uniform sampler2D tWHeight;
uniform vec4 uWInfo;
uniform sampler2D tWNormal;
uniform sampler2D tWFoam;
uniform float uWHasNormal;
uniform float uWHasFoam;
uniform float uWTime;
uniform float uWLevel;
uniform vec3 uWDeep;
uniform vec3 uWShallow;
uniform vec2 uWWind;
float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float wWaves(vec2 p) {
  float t = uWTime;
  return wNoise(p * 0.55 + uWWind * t * 0.25) * 0.5 + wNoise(p * 1.3 - vec2(t * 0.31, -t * 0.22)) * 0.3 + wNoise(p * 3.1 + vec2(-t * 0.5, t * 0.4)) * 0.2;
}
float wDepthAt(vec2 xz) { return uWLevel - texture2D(tWHeight, ((xz + uWInfo.x) / uWInfo.y + 0.5) / uWInfo.z).r; }
`;

const WATER_FRAG = /* glsl */ `
float wDepth = wDepthAt(vWPos.xz);
vec3 wN;
if (uWHasNormal > 0.5) {
  vec2 uv1 = vWPos.xz * 0.11 + uWWind * uWTime * 0.035;
  vec2 uv2 = vWPos.xz * 0.043 * mat2(0.8, -0.6, 0.6, 0.8) - uWWind.yx * uWTime * 0.02;
  vec3 n1 = texture2D(tWNormal, uv1).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tWNormal, uv2).xyz * 2.0 - 1.0;
  vec3 n = normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));
  wN = normalize(vec3(n.x, n.z * 2.2, -n.y));
} else {
  float e = 0.15;
  float hC = wWaves(vWPos.xz), hX = wWaves(vWPos.xz + vec2(e, 0.0)), hZ = wWaves(vWPos.xz + vec2(0.0, e));
  wN = normalize(vec3((hC - hX) * 2.0, 1.0, (hC - hZ) * 2.0));
}
// calmer normals far away (less aliasing / sparkle)
wN = normalize(mix(wN, vec3(0.0, 1.0, 0.0), smoothstep(40.0, 160.0, length(cameraPosition - vWPos))));
vec3 wView = normalize(cameraPosition - vWPos);
float wFres = pow(1.0 - max(dot(wN, wView), 0.0), 5.0);
vec3 wCol = mix(uWShallow, uWDeep, smoothstep(0.0, 3.2, wDepth));
// foam at the shore
float foamTex = uWHasFoam > 0.5 ? texture2D(tWFoam, vWPos.xz * 0.18 + uWWind * uWTime * 0.02).r : wNoise(vWPos.xz * 2.4 + vec2(uWTime * 0.6, 0.0));
float shore = 1.0 - smoothstep(0.0, 0.45, wDepth);
float wave = 0.5 + 0.5 * sin(wDepth * 14.0 - uWTime * 1.6 + wNoise(vWPos.xz * 0.7) * 5.0);
float wFoam = clamp(shore * (0.35 + 0.65 * foamTex) * (0.55 + 0.45 * wave) * 1.3, 0.0, 1.0);
wFoam = smoothstep(0.25, 0.75, wFoam);
diffuseColor.rgb = mix(wCol, vec3(0.9, 0.92, 0.9), wFoam);
float wAlpha = mix(0.35, 0.94, smoothstep(0.0, 2.2, wDepth));
wAlpha *= smoothstep(-0.02, 0.12, wDepth);
diffuseColor.a = max(wAlpha, wFoam * smoothstep(-0.02, 0.06, wDepth));
`;

export async function buildWater(maps, opts = {}) {
  const uniforms = {
    tWHeight: { value: maps.height },
    uWInfo: { value: maps.info },
    tWNormal: { value: opts.normal || null },
    tWFoam: { value: opts.foam || null },
    uWHasNormal: { value: opts.normal ? 1 : 0 },
    uWHasFoam: { value: opts.foam ? 1 : 0 },
    uWTime: { value: 0 },
    uWLevel: { value: WATER_LEVEL },
    uWDeep: { value: new THREE.Color('#06222c') },
    uWShallow: { value: new THREE.Color('#1f5a5a') },
    uWWind: { value: new THREE.Vector2(1, 0.3) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, depthWrite: false });
  mat.name = 'water';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_PARS}`)
      .replace('#include <map_fragment>', WATER_FRAG)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.04, 0.6, wFoam);')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);')
      // reflections stay visible over shallow water: raise the alpha with the fresnel term
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a = clamp(max(gl_FragColor.a, wFres * 0.9 * smoothstep(0.0, 0.1, wDepth)), 0.0, 1.0);');
  };
  mat.customProgramCacheKey = () => 'water-pbr-v2';
  const geo = new THREE.PlaneGeometry(maps.info.x * 2, maps.info.x * 2, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.position.y = WATER_LEVEL;
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  const deepDay = new THREE.Color('#06222c'), deepNight = new THREE.Color('#010812');
  const shallowDay = new THREE.Color('#1f5a5a'), shallowNight = new THREE.Color('#06161c');
  return {
    mesh,
    uniforms,
    update(time, env, wind) {
      uniforms.uWTime.value = time;
      if (wind) uniforms.uWWind.value.copy(wind);
      uniforms.uWDeep.value.copy(deepDay).lerp(deepNight, env.night);
      uniforms.uWShallow.value.copy(shallowDay).lerp(shallowNight, env.night);
    },
  };
}

// ------------------------------------------------------------------ height raycast
const _p = new THREE.Vector3();
/** March a ray against the heightfield. Returns true and writes the hit into `out` if the ground is hit. */
export function raycastTerrain(ray, out, maxDist = 400) {
  let prevT = 0;
  let step = 0.5;
  for (let t = 0.5; t < maxDist; t += step) {
    ray.at(t, _p);
    if (Math.abs(_p.x) > WORLD_HALF || Math.abs(_p.z) > WORLD_HALF) { prevT = t; step = Math.min(2, step * 1.05); continue; }
    const h = terrainHeight(_p.x, _p.z);
    if (_p.y <= h) {
      let lo = prevT, hi = t;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        ray.at(mid, _p);
        if (_p.y <= terrainHeight(_p.x, _p.z)) hi = mid; else lo = mid;
      }
      ray.at(hi, out);
      out.y = terrainHeight(out.x, out.z);
      return true;
    }
    prevT = t;
    step = Math.min(2, step * 1.05);
  }
  return false;
}

export { TERRAIN_STEP };
