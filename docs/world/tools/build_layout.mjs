// Brumeval Online v0.3 — assemble docs/world/world_layout.json.
// Entrées : tools/out/carto.json (mesures du générateur gen_world.mjs), tools/content_spec.mjs (contenu),
//           heightmap.png (typologie des hauteurs mesurée par région).
// Usage (racine du dépôt) : node docs/world/tools/build_layout.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGray16 } from './png.mjs';
import * as C from './content_spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLD = path.resolve(HERE, '..');
const carto = JSON.parse(fs.readFileSync(path.join(HERE, 'out', 'carto.json'), 'utf8'));
const hmMeta = JSON.parse(fs.readFileSync(path.join(WORLD, 'heightmap.json'), 'utf8'));
const { w: N, data: U16 } = decodeGray16(fs.readFileSync(path.join(WORLD, 'heightmap.png')));
const STEP = hmMeta.metresPerSample, X0 = hmMeta.x0, Z0 = hmMeta.z0;
const Hs = new Float32Array(N * N); for (let k = 0; k < N * N; k++) Hs[k] = U16[k] * 0.01 - 60;
const cm = carto.controlMap;
const cell = (x, z) => { const c = Math.floor((x - cm.x0) / cm.cell), r = Math.floor((z - cm.z0) / cm.cell); return c >= 0 && r >= 0 && c < cm.cols && r < cm.rows ? [r, c] : null; };
const regionByChar = Object.fromEntries(carto.regions.map((r) => [r.char, r.id]));

// ---------------------------------------------------------------- typologie des hauteurs mesurée par région
const bands = C.ALTITUDE_BANDS;
const bandOf = (h) => bands.findIndex((b) => h >= b.min && h < b.max);
const slopeOf = (i, j) => {
  const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
  const dx = (Hs[j * N + i1] - Hs[j * N + i0]) / ((i1 - i0) * STEP), dz = (Hs[j1 * N + i] - Hs[j0 * N + i]) / ((j1 - j0) * STEP);
  return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
};
const stats = {};
for (const r of carto.regions) stats[r.id] = { n: 0, band: new Array(bands.length).fill(0), slope: new Array(C.SLOPE_CLASSES.length).fill(0), hs: [] };
const P = carto.frame.playable;
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = X0 + i * STEP, z = Z0 + j * STEP;
  if (x < P.x0 || x > P.x1 || z < P.z0 || z > P.z1) continue;
  const rc = cell(x, z); if (!rc) continue;
  if (cm.water[rc[0]][rc[1]] !== '0') continue;        // terres émergées seulement
  const h = Hs[j * N + i]; if (h < 0) continue;
  const st = stats[regionByChar[cm.region[rc[0]][rc[1]]]]; if (!st) continue;
  st.n++; st.band[Math.max(0, bandOf(h))]++;
  const s = slopeOf(i, j); st.slope[C.SLOPE_CLASSES.findIndex((c) => s < c.maxDeg)]++;
  if ((i + j) % 3 === 0) st.hs.push(h);
}
const pct = (a, n) => a.map((v) => Math.round((1000 * v) / Math.max(1, n)) / 10);
const quant = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]); };
const typology = {};
for (const [id, st] of Object.entries(stats)) {
  const bp = pct(st.band, st.n);
  const main = bp.indexOf(Math.max(...bp));
  typology[id] = {
    mainBand: bands[main].id,
    bandsPct: Object.fromEntries(bands.map((b, k) => [b.id, bp[k]]).filter(([, v]) => v > 0)),
    slopePct: Object.fromEntries(C.SLOPE_CLASSES.map((c, k) => [c.id, pct(st.slope, st.n)[k]])),
    elevation: { p5: quant(st.hs, 0.05), median: quant(st.hs, 0.5), p95: quant(st.hs, 0.95) },
  };
}

// ---------------------------------------------------------------- assemblage
const reliefId = Object.fromEntries(C.RELIEF_TYPES.map(([id, key]) => [key, id]));
const inPoly = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const regionAt = (x, z) => { const rc = cell(x, z); return rc ? regionByChar[cm.region[rc[0]][rc[1]]] : null; };
const hAt = (x, z) => { const i = Math.round((x - X0) / STEP), j = Math.round((z - Z0) / STEP); return +Hs[j * N + i].toFixed(1); };

const regions = carto.regions.map((r) => {
  const c = C.REGION_CONTENT[r.id];
  if (!c) throw new Error('contenu manquant pour la région ' + r.id);
  return {
    id: r.id, char: r.char, name: r.name, biome: r.biome, biomeName: r.biomeName, levels: r.levels, danger: r.danger, tier: r.tier,
    version: c.version, shape: r.shape, bbox: r.bbox, areaKm2: r.areaKm2, landKm2: r.landKm2,
    relief: c.relief.map((k) => ({ id: reliefId[k], key: k })),
    heightTypology: { ...typology[r.id], elevation: { ...r.elevation, ...typology[r.id].elevation } },
    walkableLandPct: r.walkableLandPct,
    weather: c.weather.map(([kind, wgt]) => ({ kind, weight: wgt })), ambiance: c.ambiance,
    monsters: c.monsters, miniBosses: c.miniBosses, bosses: c.bosses, harvest: c.harvest, brumillons: c.brumillons,
    landmarks: r.landmarks,
  };
});

const towns = carto.towns.map((t) => ({ ...t, region: regionAt(t.x, t.z), ...(C.SERVICES[t.id] || {}) }));
const outposts = carto.outposts.map((o) => ({ ...o, region: regionAt(o.x, o.z), ...(C.SERVICES[o.id] || {}) }));
const camps = C.CAMPS.map((c) => ({ ...c, y: hAt(c.x, c.z) }));
const safeZones = [
  ...towns.map((t) => ({ id: t.id, kind: 'ville', circle: [t.x, t.z, t.safeRadius] })),
  ...camps.filter((c) => c.safeRadius).map((c) => ({ id: c.id, kind: 'sanctuaire', circle: [c.x, c.z, c.safeRadius] })),
];
const dungeons = [
  ...carto.dungeons.map((d) => ({ ...d, ...(C.DUNGEON_CONTENT[d.id] || {}) })),
  ...C.EXTRA_DUNGEONS.map((d) => ({ ...d, y: hAt(d.x, d.z) })),
];
const pois = C.POIS.map((q) => ({ ...q, y: hAt(q.x, q.z) }));
const redZones = regions.filter((r) => r.danger === 'rouge').map((r) => ({
  id: r.id, name: r.name, levels: r.levels, tier: r.tier, shape: r.shape, version: r.version,
  rules: 'ROADMAP §2 bis : JcJ libre, sac de butin 10 min, +50 % XP, +100 % butin, 5 s de protection à l’entrée',
}));

const layout = {
  schema: 'brumeval.world_layout/1',
  version: 'v0.3-1',
  generatedBy: 'docs/world/tools/build_layout.mjs (gen_world.mjs + content_spec.mjs)',
  doc: 'Schéma : docs/world/MONDE.md §0. Coordonnées : x est, z sud (nord = −z), mètres, Brumeval (0,0), mer 0 m.',
  frame: { ...carto.frame, heightmap: 'heightmap.png', heightmapMeta: hmMeta },
  heightTypology: {
    source: 'cartographe (gen_world.mjs) — mesuré sur heightmap.png',
    bands: C.ALTITUDE_BANDS, vegetationLimits: C.VEGETATION_LIMITS, slopeClasses: C.SLOPE_CLASSES,
    walkableMaxDeg: C.WALKABLE_MAX_DEG, wadeMaxDepth: C.WADE_MAX_DEPTH,
    reliefTypes: C.RELIEF_TYPES.map(([id, key, name, shape]) => ({ id, key, name, shape })),
    slopeHistogramPlayableLand: carto.slopeRules.histogramPlayableLand,
  },
  biomes: Object.fromEntries(Object.entries(carto.biomes).map(([k, name]) => [k, { name, ...(C.BIOME_STYLE[k] || {}) }])),
  regions, redZones, safeZones,
  towns, outposts, camps, landmarks: carto.landmarks, waypoints: carto.waypoints, dungeons, pois,
  roads: carto.roads.map(({ _worst, ...r }) => r), rivers: carto.rivers, lakes: carto.lakes, waterfalls: carto.waterfalls,
  wetland: carto.wetland, coast: carto.coast,
  relief: { peaks: carto.peaks, passes: carto.passes, volcano: carto.volcano, ranges: carto.ranges, plateaus: carto.plateaus, mesas: carto.mesas },
  monsters: { new: C.NEW_MONSTERS },
  story: C.STORY, collectible: C.COLLECTIBLE, traversal: C.TRAVERSAL.map(([what, version]) => ({ what, version })),
  travel: carto.travel,
  controlMap: cm,
};
fs.writeFileSync(path.join(WORLD, 'world_layout.json'), JSON.stringify(layout, null, 1));
console.log('world_layout.json :', regions.length, 'régions,', pois.length, 'lieux,', dungeons.length, 'donjons,', carto.waypoints.length, 'pierres');
for (const r of regions) console.log(r.id.padEnd(14), r.heightTypology.mainBand, JSON.stringify(r.heightTypology.bandsPct), JSON.stringify(r.heightTypology.elevation));
