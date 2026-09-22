// World layout shared by server (collision, spawns) and client (rendering, minimap).
// Coordinates: metres on the ground plane (x, z). Y is up. North = -Z (top of the minimap).
// Yaw convention everywhere: ry = Math.atan2(dirX, dirZ)  → ry = 0 means facing +Z.
import { fbm2, mulberry32, smoothstep, lerp, clamp } from './noise.js';

export const WORLD_SEED = 1337;
export const WORLD_HALF = 180;          // terrain spans [-180, 180] on x and z
export const WORLD_LIMIT = 160;         // entities are clamped to |x|,|z| <= WORLD_LIMIT
export const WATER_LEVEL = -1.2;        // client draws a water plane at this height
export const TERRAIN_STEP = 1.5;        // suggested client terrain grid spacing (metres)

export const SPAWN_POINT = { x: 0, z: 7, ry: 0 };

/** Safe zone: no combat, monsters never enter. */
export const VILLAGE = { x: 0, z: 0, r: 30 };

/** Named areas, checked in order; the first match wins. */
export const REGIONS = [
  { id: 'village', name: 'Village de Brumeval', x: 0, z: 0, r: 32, safe: true },
  { id: 'lair', name: 'Antre du Golem', x: 118, z: -132, r: 22 },
  { id: 'graveyard', name: 'Cimetière oublié', x: 88, z: -88, r: 30 },
  { id: 'goblins', name: 'Camp gobelin', x: -100, z: -8, r: 32 },
  { id: 'forest', name: 'Forêt des Murmures', x: 10, z: -92, r: 50 },
  { id: 'plains_e', name: "Plaines d'Émeraude", x: 58, z: 30, r: 40 },
  { id: 'plains_sw', name: 'Prairie du Sud', x: -38, z: 55, r: 34 },
];
export const DEFAULT_REGION = { id: 'wilds', name: 'Terres sauvages' };

export function regionAt(x, z) {
  for (const r of REGIONS) if ((x - r.x) ** 2 + (z - r.z) ** 2 <= r.r * r.r) return r;
  return DEFAULT_REGION;
}
export const inVillage = (x, z) => (x - VILLAGE.x) ** 2 + (z - VILLAGE.z) ** 2 <= VILLAGE.r * VILLAGE.r;

/** Dirt roads (polylines). Client paints them on the terrain; no obstacles are placed on them. */
export const ROADS = [
  [[0, 0], [20, 6], [45, 18], [70, 28]],
  [[0, 0], [-4, -30], [4, -60], [20, -80], [50, -88], [80, -86]],
  [[80, -86], [100, -110], [112, -126]],
  [[0, 0], [-30, -2], [-60, -8], [-92, -8]],
  [[0, 0], [-12, 25], [-30, 50]],
];
export const ROAD_WIDTH = 3.5;

export const LAKES = [
  { x: -50, z: -60, r: 16 },
  { x: 40, z: 72, r: 14 },
  { x: -120, z: 80, r: 20 },
];

/** Flattened areas (village plaza, camps). `h` null = use raw terrain height at the centre. */
const FLAT_AREAS = [
  { x: 0, z: 0, r: 30, h: 1.2 },
  { x: -100, z: -8, r: 18, h: null },
  { x: 88, z: -88, r: 18, h: null },
  { x: 118, z: -132, r: 14, h: null },
];

/** Monster spawn zones. Monsters wander inside the circle and leash back when > r + 18 from centre. */
export const SPAWN_ZONES = [
  { id: 'slime_e', monster: 'slime', x: 58, z: 30, r: 24, count: 14 },
  { id: 'slime_sw', monster: 'slime', x: -38, z: 55, r: 20, count: 10 },
  { id: 'wolf_forest', monster: 'wolf', x: 15, z: -95, r: 32, count: 16 },
  { id: 'goblin_camp', monster: 'goblin', x: -100, z: -8, r: 22, count: 12 },
  { id: 'graveyard', monster: 'skeleton', x: 88, z: -88, r: 20, count: 12 },
  { id: 'golem_lair', monster: 'golem', x: 118, z: -132, r: 8, count: 1 },
];

/** Non-player characters placed in the village. `key` matches NPCS in data.js. */
export const NPC_SPAWNS = [
  { key: 'elder', x: -4, z: -7, ry: Math.atan2(4, 7) },
  { key: 'merchant', x: 7.2, z: 4.4, ry: Math.atan2(-7.2, -4.4) },
];

// ---------------------------------------------------------------- terrain
function rawHeight(x, z) {
  let h = 1.5 + (fbm2(x * 0.011, z * 0.011, WORLD_SEED, 4) - 0.5) * 12;
  h += (fbm2(x * 0.06, z * 0.06, WORLD_SEED + 7, 2) - 0.5) * 1.2;
  if (h < 0) h *= 0.3;
  return h;
}
const FLAT_H = FLAT_AREAS.map((a) => (a.h ?? rawHeight(a.x, a.z)));

/** Ground height (y) at (x, z). Deterministic; identical on client and server. */
export function terrainHeight(x, z) {
  let h = rawHeight(x, z);
  for (let i = 0; i < FLAT_AREAS.length; i++) {
    const a = FLAT_AREAS[i];
    const d = Math.hypot(x - a.x, z - a.z);
    if (d < a.r + 18) h = lerp(FLAT_H[i], h, smoothstep(a.r, a.r + 18, d));
  }
  for (const l of LAKES) {
    const d = Math.hypot(x - l.x, z - l.z);
    if (d < l.r + 3) h = lerp(h, -5, 1 - smoothstep(l.r * 0.3, l.r + 3, d));
  }
  const e = Math.max(Math.abs(x), Math.abs(z));
  if (e > 145) {
    const t = smoothstep(145, WORLD_HALF, e);
    h += t * t * 38 + t * fbm2(x * 0.08, z * 0.08, WORLD_SEED + 13, 3) * 10;
  }
  return h;
}

/** Walkable = inside the world limit and not in deep water. */
export function isWalkable(x, z) {
  if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT) return false;
  return terrainHeight(x, z) >= WATER_LEVEL - 0.4;
}

/** Distance from (x, z) to the nearest road centre-line. */
export function roadDistance(x, z) {
  let best = Infinity;
  for (const road of ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i], [bx, bz] = road[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
  }
  return best;
}

// ---------------------------------------------------------------- world objects
/**
 * Static object types. `r` = collision radius at scale 1 (0 = no collision).
 * `model` = GLB key in /models/<model>.glb.
 */
export const OBJECT_TYPES = {
  tree_pine: { model: 'tree_pine', r: 0.55 },
  tree_oak: { model: 'tree_oak', r: 0.7 },
  tree_dead: { model: 'tree_dead', r: 0.45 },
  rock_a: { model: 'rock_a', r: 0.9 },
  rock_b: { model: 'rock_b', r: 1.5 },
  bush: { model: 'bush', r: 0 },
  flowers: { model: 'flowers', r: 0 },
  house: { model: 'house', r: 3.7 },
  well: { model: 'well', r: 1.4 },
  fence: { model: 'fence', r: 0.7 },
  lamp_post: { model: 'lamp_post', r: 0.3 },
  crate: { model: 'crate', r: 0.6 },
  barrel: { model: 'barrel', r: 0.5 },
  campfire: { model: 'campfire', r: 0.9 },
  tent: { model: 'tent', r: 1.9 },
  gravestone: { model: 'gravestone', r: 0.45 },
  stall: { model: 'stall', r: 1.6 },
};

const yawTo = (dx, dz) => Math.atan2(dx, dz);

let _cache = null;
/**
 * Deterministically generate every static object in the world.
 * Returns [{ id, type, x, z, ry, s, r }] where r = collision radius (already scaled; 0 = none).
 */
export function generateWorldObjects() {
  if (_cache) return _cache;
  const out = [];
  const add = (type, x, z, ry = 0, s = 1) => {
    out.push({ id: out.length, type, x: +x.toFixed(2), z: +z.toFixed(2), ry: +ry.toFixed(3), s: +s.toFixed(2), r: +(OBJECT_TYPES[type].r * s).toFixed(2) });
  };
  const rand = mulberry32(WORLD_SEED);

  // --- village
  add('well', 0, 0, 0, 1);
  for (const deg of [62, 150, 222, 305]) {
    const a = (deg * Math.PI) / 180, x = Math.cos(a) * 19, z = Math.sin(a) * 19;
    add('house', x, z, yawTo(-x, -z), 1);
  }
  add('stall', 9.2, 7.4, yawTo(-9.2, -7.4), 1);
  for (let i = 0; i < 6; i++) {
    const a = ((i * 60 + 30) * Math.PI) / 180;
    add('lamp_post', Math.cos(a) * 11.5, Math.sin(a) * 11.5, yawTo(-Math.cos(a), -Math.sin(a)), 1);
  }
  add('crate', 13.0, 8.0, 0.3, 1); add('crate', 12.2, 10.2, 1.1, 0.85); add('barrel', 11.2, 8.9, 0, 1);
  add('barrel', -13.5, -12.0, 0, 1); add('crate', -12.0, -13.8, 0.6, 1);
  add('barrel', 14.5, -12.5, 0, 1); add('crate', -16.0, 9.5, 0.2, 1);
  // village fence ring with gaps where roads leave the village
  const exits = ROADS.filter((r) => r[0][0] === 0 && r[0][1] === 0).map((r) => Math.atan2(r[1][1], r[1][0]));
  const FR = 27, segs = Math.round((2 * Math.PI * FR) / 2.0);
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    if (exits.some((e) => Math.abs(Math.atan2(Math.sin(a - e), Math.cos(a - e))) < 0.2)) continue;
    add('fence', Math.cos(a) * FR, Math.sin(a) * FR, yawTo(Math.cos(a), Math.sin(a)), 1);
  }

  // --- goblin camp
  add('campfire', -100, -8, 0, 1.2);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4, x = -100 + Math.cos(a) * 10, z = -8 + Math.sin(a) * 10;
    add('tent', x, z, yawTo(-100 - x, -8 - z), 1);
  }
  for (const [x, z] of [[-93, -2], [-107, -15], [-95, -17], [-108, 1]]) add(rand() < 0.5 ? 'crate' : 'barrel', x, z, rand() * 6, 1);

  // --- graveyard
  for (let gx = 0; gx < 5; gx++) for (let gz = 0; gz < 4; gz++) {
    add('gravestone', 88 - 7 + gx * 3.5, -88 - 5 + gz * 3.5, (rand() - 0.5) * 0.3, 0.9 + rand() * 0.25);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.2;
    add('tree_dead', 88 + Math.cos(a) * 17, -88 + Math.sin(a) * 17, rand() * 6, 0.9 + rand() * 0.4);
  }
  for (const [x, z] of [[78, -97], [98, -97], [78, -79], [98, -79]]) add('lamp_post', x, z, yawTo(88 - x, -88 - z), 1);

  // --- golem lair: ring of big rocks, gap towards the road
  const gapA = Math.atan2(-110 + 132, 100 - 118);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - gapA), Math.cos(a - gapA))) < 0.45) continue;
    add('rock_b', 118 + Math.cos(a) * 16, -132 + Math.sin(a) * 16, rand() * 6, 1.1 + rand() * 0.5);
  }

  // --- scattered nature (rejection sampling)
  const clear = [
    { x: 0, z: 0, r: 34 }, { x: -100, z: -8, r: 22 }, { x: 88, z: -88, r: 21 }, { x: 118, z: -132, r: 20 },
  ];
  const placed = out.filter((o) => o.r > 0).map((o) => ({ x: o.x, z: o.z, r: o.r }));
  const okAt = (x, z, minGap, roadGap) => {
    if (Math.abs(x) > WORLD_LIMIT + 8 || Math.abs(z) > WORLD_LIMIT + 8) return false;
    if (terrainHeight(x, z) < WATER_LEVEL + 0.5) return false;
    if (roadDistance(x, z) < roadGap) return false;
    for (const c of clear) if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return false;
    for (const p of placed) if ((x - p.x) ** 2 + (z - p.z) ** 2 < (p.r + minGap) ** 2) return false;
    return true;
  };
  const scatter = (count, sample, pick, minGap, roadGap, collide = true) => {
    let n = 0;
    for (let tries = 0; n < count && tries < count * 40; tries++) {
      const [x, z] = sample();
      if (!okAt(x, z, minGap, roadGap)) continue;
      const [type, s] = pick();
      add(type, x, z, rand() * Math.PI * 2, s);
      if (collide && OBJECT_TYPES[type].r > 0) placed.push({ x, z, r: OBJECT_TYPES[type].r * s });
      n++;
    }
  };
  const inCircle = (cx, cz, r) => () => {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r;
    return [cx + Math.cos(a) * d, cz + Math.sin(a) * d];
  };
  const anywhere = () => [(rand() * 2 - 1) * (WORLD_HALF - 6), (rand() * 2 - 1) * (WORLD_HALF - 6)];
  // dense forest
  scatter(230, inCircle(10, -92, 52), () => [rand() < 0.62 ? 'tree_pine' : 'tree_oak', 0.8 + rand() * 0.55], 2.4, 3.5);
  // sparse trees, rocks everywhere (fewer inside the slime plains)
  scatter(170, anywhere, () => [rand() < 0.5 ? 'tree_oak' : 'tree_pine', 0.85 + rand() * 0.5], 3.0, 4);
  scatter(80, anywhere, () => [rand() < 0.65 ? 'rock_a' : 'rock_b', 0.6 + rand() * 0.8], 2.0, 3.5);
  // decoration without collision
  scatter(170, anywhere, () => ['bush', 0.7 + rand() * 0.6], 0.3, 2.5, false);
  scatter(80, inCircle(58, 30, 45), () => ['flowers', 0.8 + rand() * 0.5], 0.2, 2.2, false);
  scatter(60, inCircle(-38, 55, 38), () => ['flowers', 0.8 + rand() * 0.5], 0.2, 2.2, false);
  scatter(40, inCircle(0, 0, 60), () => ['flowers', 0.8 + rand() * 0.4], 0.2, 2.2, false);

  _cache = out;
  return out;
}
