// Pure terrain data (no Three.js): height grid, splat weights for the 10 PBR layers and the grass mask.
// Runs in a Web Worker (terrainWorker.js) when possible, synchronously otherwise. Everything derives from the
// shared world description, so a bigger map (WORLD_HALF / REGIONS / ROADS in shared/world.js) just works.
import {
  WORLD_HALF, TERRAIN_STEP, WATER_LEVEL, ROAD_WIDTH, REGIONS, ROADS, VILLAGE, terrainHeight,
} from '../../../shared/world.js';
import { fbm2, valueNoise2, smoothstep, clamp } from '../../../shared/noise.js';

/** Layer order of the texture arrays (file names /textures/terrain/<name>_{albedo,normal,orm}.webp). */
export const LAYERS = ['grass', 'forest_floor', 'dirt', 'road', 'cobble', 'rock', 'snow', 'sand', 'mud', 'ash'];
export const L = Object.fromEntries(LAYERS.map((n, i) => [n, i]));

/** Grid description: V×V samples every `step` metres starting at (-half, -half). */
export function gridInfo(half = WORLD_HALF, step = TERRAIN_STEP) {
  const n = Math.max(2, Math.round((half * 2) / step));
  return { half, step: (half * 2) / n, size: n + 1 };
}

const REG = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
const near = (x, z, r, inner, outer) => (r ? 1 - smoothstep(inner, outer, Math.hypot(x - r.x, z - r.z)) : 0);

/** Road segments with bounding boxes for a fast distance query. */
function roadSegments(pad) {
  const segs = [];
  for (const road of ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i], [bx, bz] = road[i + 1];
      segs.push({ ax, az, bx, bz, minX: Math.min(ax, bx) - pad, maxX: Math.max(ax, bx) + pad, minZ: Math.min(az, bz) - pad, maxZ: Math.max(az, bz) + pad });
    }
  }
  return segs;
}
function roadDist(segs, x, z, cap) {
  let best = cap;
  for (const s of segs) {
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const t = clamp(((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz), 0, 1);
    const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

/**
 * Compute the terrain data.
 * Returns { half, step, size, heights: Float32Array(size²), splat: Uint8Array(size² × 12) (3 RGBA textures,
 * interleaved as [tex0 RGBA, tex1 RGBA, tex2 RGBA] per texel → split by the caller), grass: Uint8Array(size² × 4) }.
 */
export function computeTerrainData(half = WORLD_HALF, step = TERRAIN_STEP) {
  const g = gridInfo(half, step);
  const V = g.size, S = g.step;
  const heights = new Float32Array(V * V);
  for (let j = 0; j < V; j++) {
    const z = -half + j * S;
    for (let i = 0; i < V; i++) heights[j * V + i] = terrainHeight(-half + i * S, z);
  }
  const segs = roadSegments(ROAD_WIDTH + 4);
  const splat0 = new Uint8Array(V * V * 4), splat1 = new Uint8Array(V * V * 4), splat2 = new Uint8Array(V * V * 4);
  const grass = new Uint8Array(V * V * 4);
  const w = new Float32Array(12);
  const hAt = (i, j) => heights[clamp(j, 0, V - 1) * V + clamp(i, 0, V - 1)];
  const vil = VILLAGE || { x: 0, z: 0, r: 30 };
  for (let j = 0; j < V; j++) {
    const z = -half + j * S;
    for (let i = 0; i < V; i++) {
      const x = -half + i * S;
      const k = j * V + i;
      const h = heights[k];
      // slope: normal.y from central differences
      const gx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * S);
      const gz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * S);
      const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      const n1 = fbm2(x * 0.035, z * 0.035, 71, 3);
      const n2 = valueNoise2(x * 0.21, z * 0.21, 99);
      const n3 = fbm2(x * 0.12, z * 0.12, 5, 2);
      w.fill(0);
      w[L.grass] = 1;
      let lush = 0.72 + (n1 - 0.5) * 0.5; // grass colour: 0 dry/golden … 1 lush
      let tall = 0.7 + n3 * 0.5;           // grass height
      let density = 1;
      // meadows: lush, tall
      const meadow = Math.max(near(x, z, REG.plains_e, 26, 48), near(x, z, REG.plains_sw, 20, 40));
      lush += meadow * 0.25; tall += meadow * 0.35;
      // scattered dirt patches in the grass
      const patch = smoothstep(0.62, 0.74, fbm2(x * 0.06, z * 0.06, 313, 3));
      w[L.dirt] += patch * 0.9;
      density *= 1 - patch * 0.8;
      // forest floor
      const f = near(x, z, REG.forest, 36, 58);
      if (f > 0) {
        w[L.forest_floor] += f * (1.1 + n3 * 0.4);
        w[L.grass] *= 1 - f * 0.75;
        density *= 1 - f * 0.55;
        lush += f * 0.15;
        tall -= f * 0.3;
      }
      // graveyard: mud + ash, dead grass
      const gy = near(x, z, REG.graveyard, 16, 32);
      if (gy > 0) {
        w[L.mud] += gy * (0.6 + n2 * 0.5);
        w[L.ash] += gy * (0.3 + n3 * 0.4);
        w[L.grass] *= 1 - gy * 0.7;
        lush -= gy * 0.7;
        density *= 1 - gy * 0.45;
      }
      // golem lair: ash and rock
      const lr = near(x, z, REG.lair, 10, 26);
      if (lr > 0) {
        w[L.ash] += lr * 1.2;
        w[L.rock] += lr * 0.5 * n2;
        w[L.grass] *= 1 - lr * 0.9;
        density *= 1 - lr * 0.9;
        lush -= lr;
      }
      // goblin camp: trampled dirt and mud
      const cp = near(x, z, REG.goblins, 8, 18) * (0.7 + n3 * 0.6);
      if (cp > 0) {
        w[L.dirt] += cp * 1.1;
        w[L.mud] += cp * 0.4 * n2;
        w[L.grass] *= 1 - clamp(cp, 0, 1) * 0.9;
        density *= 1 - clamp(cp, 0, 1) * 0.9;
      }
      // village plaza: cobbles
      const dv = Math.hypot(x - vil.x, z - vil.z);
      const pz = 1 - smoothstep(8.5, 11.5 + n3 * 2, dv);
      if (pz > 0) {
        w[L.cobble] += pz * 3;
        density *= (1 - pz) ** 3;
      }
      // roads (cobbled in the village)
      const rd = roadDist(segs, x, z, 99);
      const hw = ROAD_WIDTH / 2;
      const road = 1 - smoothstep(hw - 0.6 + n2 * 0.4, hw + 0.8 + n3 * 0.6, rd);
      if (road > 0) {
        const inVil = 1 - smoothstep(vil.r * 0.75, vil.r + 4, dv);
        w[L.cobble] += road * 3 * inVil;
        w[L.road] += road * 3 * (1 - inVil);
        density *= (1 - road) ** 3;
      }
      const verge = (1 - smoothstep(hw + 0.5, hw + 2.6, rd)) * (1 - road);
      if (verge > 0) { w[L.dirt] += verge * 0.5 * n2; tall -= verge * 0.35; density *= 1 - verge * 0.4; }
      // shore sand, mud below the water line
      const sand = 1 - smoothstep(WATER_LEVEL + 0.1, WATER_LEVEL + 0.75 + n2 * 0.3, h);
      if (sand > 0) { w[L.sand] += sand * 3; density *= 1 - sand; }
      if (h < WATER_LEVEL - 0.3) { w[L.mud] += smoothstep(WATER_LEVEL - 0.3, WATER_LEVEL - 2.0, h) * 4; density = 0; }
      // foothills: dirt and dry grass, then rock, snow on the peaks
      const foot = smoothstep(4, 9, h + n3 * 2) * (1 - smoothstep(14, 20, h));
      if (foot > 0) { w[L.dirt] += foot * 0.4 * n1; lush -= foot * 0.3; }
      const steep = smoothstep(0.82, 0.62, ny);
      const mount = smoothstep(10, 18, h + n3 * 4);
      const rk = Math.max(steep, mount);
      if (rk > 0) {
        w[L.rock] += rk * 4;
        density *= 1 - rk;
      }
      const snow = smoothstep(22, 29, h + n1 * 7) * smoothstep(0.5, 0.78, ny);
      if (snow > 0) { w[L.snow] += snow * 8; density = 0; }
      // normalise and pack
      let sum = 0;
      for (let q = 0; q < 10; q++) { w[q] = Math.max(0, w[q]); sum += w[q]; }
      const inv = sum > 0 ? 255 / sum : 0;
      const o = k * 4;
      splat0[o] = w[0] * inv; splat0[o + 1] = w[1] * inv; splat0[o + 2] = w[2] * inv; splat0[o + 3] = w[3] * inv;
      splat1[o] = w[4] * inv; splat1[o + 1] = w[5] * inv; splat1[o + 2] = w[6] * inv; splat1[o + 3] = w[7] * inv;
      splat2[o] = w[8] * inv; splat2[o + 1] = w[9] * inv; splat2[o + 2] = 0; splat2[o + 3] = 0;
      // grass mask: density only where grass dominates
      const gw = (w[L.grass] + w[L.forest_floor] * 0.35) / Math.max(1e-4, sum);
      grass[o] = clamp(density * smoothstep(0.25, 0.65, gw), 0, 1) * 255;
      grass[o + 1] = clamp(lush, 0, 1) * 255;
      grass[o + 2] = clamp(tall, 0.2, 1.4) / 1.4 * 255;
      grass[o + 3] = 255;
    }
  }
  return { half, step: S, size: V, heights, splat0, splat1, splat2, grass };
}
