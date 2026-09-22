// Terrain mesh (vertex-coloured heightfield from shared/world.js) and the animated water plane.
import * as THREE from 'three';
import {
  WORLD_HALF, TERRAIN_STEP, WATER_LEVEL, ROAD_WIDTH, REGIONS,
  terrainHeight, roadDistance,
} from '@shared/world.js';
import { fbm2, valueNoise2, smoothstep, clamp } from '@shared/noise.js';

const C = (hex) => new THREE.Color(hex);
const PAL = {
  grassA: C('#5d8f3a'), grassB: C('#86a846'), grassC: C('#4c7d34'),
  meadow: C('#98b84e'), meadowFlower: C('#b6c45a'),
  forest: C('#3a5f2c'), forestB: C('#4a5a2c'),
  dirt: C('#8f6d45'), dirtB: C('#7a5a38'),
  plaza: C('#a8977a'), plazaB: C('#8c7c64'),
  camp: C('#7d6444'),
  grave: C('#646a58'), graveB: C('#545a4c'),
  lair: C('#5e5850'),
  sand: C('#cdbb88'), wet: C('#7d7458'),
  rock: C('#7f7a72'), rockB: C('#5f5b56'), rockWarm: C('#8a7866'),
  scrub: C('#4f6a36'), scrubB: C('#5e6a3a'),
  snow: C('#eef2f6'),
};

const REG = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
const dist = (x, z, r) => Math.hypot(x - r.x, z - r.z);

/** Colour of the ground at (x, z) with height h and normal-y ny. Writes into `out` (linear). */
function groundColor(x, z, h, ny, out, tmp) {
  const n1 = fbm2(x * 0.035, z * 0.035, 71, 3);
  const n2 = valueNoise2(x * 0.55, z * 0.55, 99);
  const n3 = fbm2(x * 0.12, z * 0.12, 5, 2);
  // base grass
  out.copy(PAL.grassA).lerp(PAL.grassB, smoothstep(0.35, 0.7, n1));
  out.lerp(PAL.grassC, smoothstep(0.55, 0.8, n3) * 0.5);
  // eastern meadow / southern prairie: lighter, yellower
  const pe = 1 - smoothstep(28, 48, dist(x, z, REG.plains_e));
  const ps = 1 - smoothstep(22, 40, dist(x, z, REG.plains_sw));
  const meadow = Math.max(pe, ps);
  if (meadow > 0) out.lerp(tmp.copy(PAL.meadow).lerp(PAL.meadowFlower, n2 * 0.6), meadow * 0.6);
  // forest floor
  const f = 1 - smoothstep(36, 56, dist(x, z, REG.forest));
  if (f > 0) out.lerp(tmp.copy(PAL.forest).lerp(PAL.forestB, n3), f * 0.85);
  // graveyard & lair: grey, dead grass
  const g = 1 - smoothstep(16, 30, dist(x, z, REG.graveyard));
  if (g > 0) out.lerp(tmp.copy(PAL.grave).lerp(PAL.graveB, n2), g * 0.85);
  const l = 1 - smoothstep(10, 24, dist(x, z, REG.lair));
  if (l > 0) out.lerp(PAL.lair, l * 0.9);
  // goblin camp: trampled dirt
  const cp = 1 - smoothstep(9, 17, dist(x, z, REG.goblins)) * (0.7 + n3 * 0.6);
  if (cp > 0) out.lerp(PAL.camp, clamp(cp, 0, 1) * 0.85);
  // village plaza (cobbles around the well)
  const dv = Math.hypot(x, z);
  const pz = 1 - smoothstep(8.5, 11.5 + n3 * 2, dv);
  if (pz > 0) out.lerp(tmp.copy(PAL.plaza).lerp(PAL.plazaB, n2 > 0.55 ? 1 : 0.25), pz);
  // roads
  const rd = roadDistance(x, z);
  const half = ROAD_WIDTH / 2;
  const road = 1 - smoothstep(half - 0.5 + n2 * 0.4, half + 0.9 + n3 * 0.6, rd);
  if (road > 0) out.lerp(tmp.copy(PAL.dirt).lerp(PAL.dirtB, n2), road * 0.92);
  // shore sand and wet ground below the water line
  const sand = 1 - smoothstep(WATER_LEVEL + 0.35, WATER_LEVEL + 1.3 + n2 * 0.4, h);
  if (sand > 0) out.lerp(PAL.sand, sand);
  if (h < WATER_LEVEL - 0.25) out.lerp(PAL.wet, smoothstep(WATER_LEVEL - 0.25, WATER_LEVEL - 2.5, h));
  // mountain foothills: darker scrub before the rock takes over
  const foot = smoothstep(4, 9, h + n3 * 2) * (1 - smoothstep(14, 20, h));
  if (foot > 0) out.lerp(tmp.copy(PAL.scrub).lerp(PAL.scrubB, n1), foot * 0.75);
  // rock on steep slopes and mountains (layered strata, warm / cool variation), snow on peaks
  const steep = smoothstep(0.86, 0.66, ny);
  const mount = smoothstep(10, 18, h + n3 * 4);
  const rk = Math.max(steep, mount);
  if (rk > 0) {
    tmp.copy(PAL.rock).lerp(PAL.rockWarm, smoothstep(0.3, 0.7, n1)).lerp(PAL.rockB, n2 * 0.6);
    const strata = 0.82 + 0.18 * Math.sin(h * 1.35 + n3 * 5);
    tmp.r *= strata; tmp.g *= strata; tmp.b *= strata;
    out.lerp(tmp, rk);
  }
  const snow = smoothstep(22, 29, h + n1 * 7) * smoothstep(0.5, 0.78, ny);
  if (snow > 0) out.lerp(PAL.snow, snow);
  // fine speckle
  const sp = 0.93 + n2 * 0.14;
  out.r *= sp; out.g *= sp; out.b *= sp;
  return out;
}

/** Build the terrain mesh. Returns { mesh, heights, size } (heights = grid used by the water shader). */
export function buildTerrain() {
  const N = Math.round((WORLD_HALF * 2) / TERRAIN_STEP);
  const V = N + 1;
  const pos = new Float32Array(V * V * 3);
  const heights = new Float32Array(V * V);
  for (let j = 0; j < V; j++) {
    const z = -WORLD_HALF + j * TERRAIN_STEP;
    for (let i = 0; i < V; i++) {
      const x = -WORLD_HALF + i * TERRAIN_STEP;
      const h = terrainHeight(x, z);
      const k = j * V + i;
      heights[k] = h;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    }
  }
  const idx = new Uint32Array(N * N * 6);
  let p = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      // alternate the diagonal for a less regular look
      if ((i + j) & 1) { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; }
      else { idx[p++] = a; idx[p++] = c; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal.array;
  const col = new Float32Array(V * V * 3);
  const c = new THREE.Color(), tmp = new THREE.Color();
  for (let k = 0; k < V * V; k++) {
    groundColor(pos[k * 3], pos[k * 3 + 2], heights[k], nrm[k * 3 + 1], c, tmp);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  mat.name = 'terrain';
  // per-pixel detail noise so the 1.5 m vertex grid doesn't look like smooth plastic
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vTerrainPos;
float tHash(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 wp = vTerrainPos.xz;
  float dn = tNoise(wp * 2.3) * 0.55 + tNoise(wp * 7.1) * 0.3 + tNoise(wp * 0.6) * 0.15;
  diffuseColor.rgb *= 0.86 + dn * 0.28;
}`);
  };
  mat.customProgramCacheKey = () => 'terrain-detail-v1';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { mesh, heights, size: V };
}

// ------------------------------------------------------------------ distant mountains
/**
 * Purely decorative mountain range outside the playable square (|x|,|z| > WORLD_HALF): it continues the edge
 * cliffs of the terrain into jagged, snow-capped ridges that fade into the fog, so the world border reads as a
 * mountain range instead of a wall.
 */
export function buildMountainRing(material) {
  const OUT = 460, STEP = 6;
  const N = Math.round((OUT * 2) / STEP);
  const V = N + 1;
  const pos = new Float32Array(V * V * 3);
  const col = new Float32Array(V * V * 3);
  const c = new THREE.Color(), tmp = new THREE.Color();
  const edgeIn = WORLD_HALF - 3;
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      let x = -OUT + i * STEP, z = -OUT + j * STEP;
      const k = j * V + i;
      const e = Math.max(Math.abs(x), Math.abs(z));
      // pull the inner ring vertices onto the terrain edge so the seam is hidden under the cliff tops
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
      const h = base + rise;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      // colours: dark forested foothills → rock → snow
      const n = valueNoise2(x * 0.08, z * 0.08, 31);
      c.copy(PAL.scrub).lerp(PAL.forest, 0.5 + n * 0.3);
      c.lerp(tmp.copy(PAL.rock).lerp(PAL.rockWarm, peaks).lerp(PAL.rockB, n * 0.5), smoothstep(22, 46, h + n * 10));
      c.lerp(PAL.snow, smoothstep(70, 92, h + n * 14));
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
  }
  const idx = [];
  const inner = WORLD_HALF - STEP * 2;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x0 = -OUT + i * STEP, z0 = -OUT + j * STEP;
      // skip cells well inside the playable terrain
      if (Math.max(Math.abs(x0), Math.abs(x0 + STEP)) < inner && Math.max(Math.abs(z0), Math.abs(z0 + STEP)) < inner) continue;
      const a = j * V + i, b = a + 1, cc = a + V, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'mountains';
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

// ------------------------------------------------------------------ water
const waterVert = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const waterFrag = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uDepth;
uniform float uTime;
uniform float uHalf;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uNight;
varying vec3 vWorld;

float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float waves(vec2 p) {
  float t = uTime;
  return wNoise(p * 0.55 + vec2(t * 0.25, t * 0.13)) * 0.5
       + wNoise(p * 1.3 - vec2(t * 0.31, -t * 0.22)) * 0.3
       + wNoise(p * 3.1 + vec2(-t * 0.5, t * 0.4)) * 0.2;
}

void main() {
  vec2 uv = (vWorld.xz + uHalf) / (2.0 * uHalf);
  float depth = texture(uDepth, uv).r * 6.0;
  float e = 0.15;
  float hC = waves(vWorld.xz);
  float hX = waves(vWorld.xz + vec2(e, 0.0));
  float hZ = waves(vWorld.xz + vec2(0.0, e));
  vec3 n = normalize(vec3((hC - hX) * 2.2, 1.0, (hC - hZ) * 2.2));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 3.5, depth));
  vec3 col = mix(base, uSky, 0.15 + fres * 0.65);
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(n, H), 0.0), 160.0) * 1.6;
  col += uSunColor * spec * smoothstep(-0.05, 0.1, uSunDir.y);
  // foam at the shore line
  float foamN = wNoise(vWorld.xz * 2.4 + vec2(uTime * 0.6, 0.0));
  float foam = (1.0 - smoothstep(0.0, 0.32, depth)) * (0.55 + 0.45 * foamN);
  foam += (1.0 - smoothstep(0.3, 0.55, depth)) * smoothstep(0.65, 0.9, foamN) * 0.5;
  col = mix(col, vec3(0.92, 0.96, 1.0) * (1.0 - uNight * 0.6), clamp(foam, 0.0, 1.0) * 0.8);
  float alpha = mix(0.45, 0.88, smoothstep(0.0, 2.0, depth));
  alpha = max(alpha, foam * 0.9);
  alpha = mix(alpha, 1.0, fres * 0.4);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function buildWater(heights, size) {
  // depth texture (metres below the water line, /6 → byte)
  const data = new Uint8Array(size * size);
  for (let k = 0; k < size * size; k++) data[k] = Math.round(clamp((WATER_LEVEL - heights[k]) / 6, 0, 1) * 255);
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uDepth: { value: null },
      uTime: { value: 0 },
      uHalf: { value: WORLD_HALF },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSky: { value: new THREE.Color('#9cc4e4') },
      uDeep: { value: new THREE.Color('#1d4e66') },
      uShallow: { value: new THREE.Color('#3f8a8c') },
      uNight: { value: 0 },
    },
  ]);
  uniforms.uDepth.value = tex;
  const mat = new THREE.ShaderMaterial({
    name: 'water',
    uniforms,
    vertexShader: waterVert,
    fragmentShader: waterFrag,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  // only cover the area where water can actually be visible (the lakes + low spots), as a few quads
  const geo = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.position.y = WATER_LEVEL;
  mesh.renderOrder = 1;
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;

  const deepDay = new THREE.Color('#1d4e66'), deepNight = new THREE.Color('#081826');
  const shallowDay = new THREE.Color('#3f8a8c'), shallowNight = new THREE.Color('#123038');
  return {
    mesh,
    update(time, env) {
      uniforms.uTime.value = time;
      uniforms.uSunDir.value.copy(env.lightDir);
      uniforms.uSunColor.value.copy(env.sun.color).multiplyScalar(Math.min(1, env.sun.intensity / 2.5));
      uniforms.uSky.value.copy(env.palette.hor).lerp(env.palette.top, 0.35);
      uniforms.uNight.value = env.night;
      uniforms.uDeep.value.copy(deepDay).lerp(deepNight, env.night);
      uniforms.uShallow.value.copy(shallowDay).lerp(shallowNight, env.night);
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
      // refine
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
