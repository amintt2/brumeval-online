// Brumeval Online v0.3 — contrôle du monde (références, chevauchements, courbe de niveaux, temps de trajet).
// Lit docs/world/world_layout.json + heightmap.png, recalcule les chemins à pied indépendamment du générateur.
// Usage (racine du dépôt) : node docs/world/tools/validate.mjs        → code de sortie 1 s'il reste une erreur.
// Sortie détaillée : docs/world/tools/out/validate_report.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGray16 } from './png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLD = path.resolve(HERE, '..');
const L = JSON.parse(fs.readFileSync(path.join(WORLD, 'world_layout.json'), 'utf8'));
const meta = L.frame.heightmapMeta;
const { w: N, data: U16 } = decodeGray16(fs.readFileSync(path.join(WORLD, 'heightmap.png')));
const STEP = meta.metresPerSample, X0 = meta.x0, Z0 = meta.z0;
const H = new Float32Array(N * N); for (let k = 0; k < N * N; k++) H[k] = U16[k] * 0.01 - 60;
const X = (i) => X0 + i * STEP, Z = (j) => Z0 + j * STEP;
const I = (x) => Math.round((x - X0) / STEP), J = (z) => Math.round((z - Z0) / STEP);
const P = L.frame.playable;
const errors = [], warnings = [], info = {};
const err = (m) => errors.push(m), warn = (m) => warnings.push(m);

// ------------------------------------------------------------------ géométrie
const inPoly = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const inShape = (x, z, s) => s.circle ? Math.hypot(x - s.circle[0], z - s.circle[1]) <= s.circle[2] : inPoly(x, z, s.polygon);
const segDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); return [Math.hypot(px - ax - t * dx, pz - az - t * dz), t]; };
const cm = L.controlMap;
const regionAt = (x, z) => { const c = Math.floor((x - cm.x0) / cm.cell), r = Math.floor((z - cm.z0) / cm.cell); const ch = cm.region[r]?.[c]; return L.regions.find((q) => q.char === ch)?.id; };
const REG = Object.fromEntries(L.regions.map((r) => [r.id, r]));

// ------------------------------------------------------------------ eau et routes rasterisées sur la grille de 4,5 m
const WATER = new Float32Array(N * N).fill(-Infinity);   // surface d'eau
const LAVA = new Uint8Array(N * N), ROAD = new Uint8Array(N * N);
for (let k = 0; k < N * N; k++) if (H[k] < 0) WATER[k] = 0;
const box = (x0, z0, x1, z1, fn) => { for (let j = Math.max(0, J(z0)); j <= Math.min(N - 1, J(z1)); j++) for (let i = Math.max(0, I(x0)); i <= Math.min(N - 1, I(x1)); i++) fn(i, j, j * N + i, X(i), Z(j)); };
for (const lk of L.lakes) box(lk.x - lk.rx * 1.3, lk.z - lk.rz * 1.3, lk.x + lk.rx * 1.3, lk.z + lk.rz * 1.3, (i, j, k, x, z) => {
  if (H[k] < lk.level && ((x - lk.x) / lk.rx) ** 2 + ((z - lk.z) / lk.rz) ** 2 < 1.69) { WATER[k] = Math.max(WATER[k], lk.level); if (lk.lava) LAVA[k] = 1; }
});
if (L.wetland) { const xs = L.wetland.poly.map((p) => p[0]), zs = L.wetland.poly.map((p) => p[1]);
  box(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), (i, j, k, x, z) => { if (H[k] < L.wetland.level && inPoly(x, z, L.wetland.poly)) WATER[k] = Math.max(WATER[k], L.wetland.level); }); }
for (const rv of L.rivers) {
  const pr = rv.surfaceProfile, half = rv.width / 2 + 1;
  for (let s = 0; s < pr.length - 1; s++) {
    const [ax, az, ah] = pr[s], [bx, bz, bh] = pr[s + 1];
    box(Math.min(ax, bx) - half, Math.min(az, bz) - half, Math.max(ax, bx) + half, Math.max(az, bz) + half, (i, j, k, x, z) => {
      const [d, t] = segDist(x, z, ax, az, bx, bz); if (d > half) return;
      const surf = ah + (bh - ah) * t; if (H[k] < surf) WATER[k] = Math.max(WATER[k], surf);
    });
  }
}
const ROAD_HALF = { main: 4, trail: 2.5 };
for (const rd of L.roads) { const half = ROAD_HALF[rd.cls] || 3;
  for (let s = 0; s < rd.pts.length - 1; s++) { const [ax, az] = rd.pts[s], [bx, bz] = rd.pts[s + 1];
    box(Math.min(ax, bx) - half, Math.min(az, bz) - half, Math.max(ax, bx) + half, Math.max(az, bz) + half, (i, j, k, x, z) => { if (segDist(x, z, ax, az, bx, bz)[0] <= half) ROAD[k] = 1; }); } }
// bancs de sable (0,4 m d'eau, marchables)
const SAND = new Uint8Array(N * N);
for (const sb of L.coast.sandbars || []) for (let s = 0; s < sb.length - 1; s++) { const [ax, az] = sb[s], [bx, bz] = sb[s + 1];
  box(Math.min(ax, bx) - 14, Math.min(az, bz) - 14, Math.max(ax, bx) + 14, Math.max(az, bz) + 14, (i, j, k, x, z) => { if (segDist(x, z, ax, az, bx, bz)[0] <= 12) SAND[k] = 1; }); }

const WADE = L.heightTypology.wadeMaxDepth, TAN = Math.tan((L.heightTypology.walkableMaxDeg * Math.PI) / 180);
const depth = (k) => Math.max(0, WATER[k] - H[k]);
const passable = (k) => !LAVA[k] && (ROAD[k] || SAND[k] || depth(k) <= WADE);
const slopeAt = (i, j) => { const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1), c = Math.max(0, j - 1), d = Math.min(N - 1, j + 1);
  return (Math.atan(Math.hypot((H[j * N + b] - H[j * N + a]) / ((b - a) * STEP), (H[d * N + i] - H[c * N + i]) / ((d - c) * STEP))) * 180) / Math.PI; };
const inPlay = (i, j) => { const x = X(i), z = Z(j); return x >= P.x0 && x <= P.x1 && z >= P.z0 && z <= P.z1; };
const PLAY = new Uint8Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) PLAY[j * N + i] = inPlay(i, j) ? 1 : 0;
const t0 = Date.now(); const lap = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

// ------------------------------------------------------------------ plus courts chemins (tas binaire)
const RUN = 6.5, OFFROAD = 0.92;
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
function dijkstra(x, z) {
  const T = new Float64Array(N * N).fill(Infinity), heap = new Int32Array(N * N * 20), hv = new Float64Array(N * N * 20); let hn = 0;
  const push = (k, v) => { let c = hn++; while (c > 0) { const p = (c - 1) >> 1; if (hv[p] <= v) break; heap[c] = heap[p]; hv[c] = hv[p]; c = p; } heap[c] = k; hv[c] = v; };
  const pop = () => { const k = heap[0]; hn--; const lk = heap[hn], lv = hv[hn]; let c = 0; for (;;) { const l = 2 * c + 1; if (l >= hn) break; const r = l + 1; const m = r < hn && hv[r] < hv[l] ? r : l; if (hv[m] >= lv) break; heap[c] = heap[m]; hv[c] = hv[m]; c = m; } heap[c] = lk; hv[c] = lv; return k; };
  const s = J(z) * N + I(x); T[s] = 0; push(s, 0);
  while (hn) { const hvt = hv[0]; const k = pop(), t = T[k]; if (hvt > t) continue; const i = k % N, j = (k / N) | 0;
    for (let d = 0; d < 8; d++) { const di = DIRS[d][0], dj = DIRS[d][1], dl = DIRS[d][2]; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N || !PLAY[nj * N + ni]) continue;
      const nk = nj * N + ni; if (!passable(nk)) continue;
      const run = dl * STEP, rise = H[nk] - H[k];
      if (!(ROAD[nk] && ROAD[k]) && Math.abs(rise) / run > TAN) continue;
      const g = Math.max(0, rise / run), v = RUN * Math.max(0.35, 1 - g) * (ROAD[nk] ? 1 : OFFROAD) * (depth(nk) > 0.05 ? 0.6 : 1);
      const nt = t + run / v; if (nt < T[nk]) { T[nk] = nt; if (hn >= heap.length) throw new Error('tas plein'); push(nk, nt); } } }
  return T;
}
const tAt = (T, x, z) => { let best = Infinity; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const k = (J(z) + dj) * N + I(x) + di; if (T[k] < best) best = T[k]; } return best; };

// ------------------------------------------------------------------ 1. références et unicité
const ids = new Map();
const addId = (kind, id) => { if (ids.has(id) && ids.get(id) !== kind) warn(`id partagé ${id} (${ids.get(id)} / ${kind})`); else if (ids.has(id)) err(`id en double : ${id} (${kind})`); ids.set(id, kind); };
for (const r of L.regions) addId('region', r.id);
for (const t of L.towns) addId('town', t.id);
for (const o of L.outposts) addId('outpost', o.id);
for (const c of L.camps) addId('camp', c.id);
for (const wp of L.waypoints) addId('waypoint', wp.id);
for (const d of L.dungeons) addId('dungeon', d.id);
for (const q of L.pois) addId('poi', q.id);
const KNOWN_MONSTERS = new Set(['slime', 'wolf', 'goblin', 'skeleton', 'golem', 'ice_wolf', 'boar', 'spider', 'scorpion', 'yeti', 'bog_lurker', 'troll', 'frost_giant', 'sand_wyrm',
  'goblin_shaman', 'skeleton_archer', 'bandit', 'wraith', 'lich', 'swamp_hag', 'champion', ...L.monsters.new.map((m) => m.key)]);
for (const r of L.regions) {
  for (const mo of r.monsters) { if (!KNOWN_MONSTERS.has(mo.key)) err(`${r.id} : monstre inconnu ${mo.key}`);
    const [a, b] = mo.levels, [ra, rb] = r.levels; if (a < ra - 2 || b > rb + 2) (mo.note || '').match(/rare|élite/) ? null : warn(`${r.id} : ${mo.key} niv. ${a}–${b} hors de la région (${ra}–${rb})`); }
  for (const mb of [...r.miniBosses, ...r.bosses]) { const model = mb.model || mb.key; if (!KNOWN_MONSTERS.has(model)) err(`${r.id} : modèle de boss inconnu ${model}`);
    const at = regionAt(mb.x, mb.z); if (at !== r.id) err(`${r.id} : boss « ${mb.name} » posé dans ${at}`); }
  const tiers = { T1: [1, 5], T2: [5, 10], T3: [10, 15], T4: [15, 20], T5: [20, 25], T6: [25, 30] };
  const ts = r.tier.match(/T\d/g).map((t) => tiers[t]); const tmin = Math.min(...ts.map((t) => t[0])), tmax = Math.max(...ts.map((t) => t[1]));
  if (r.levels[1] < tmin || r.levels[0] > tmax) err(`${r.id} : palier ${r.tier} incompatible avec niv. ${r.levels.join('–')}`);
}
for (const s of L.story) for (const id of s.regions) if (!REG[id]) err(`trame ${s.chapter} : région inconnue ${id}`);
const brumTotal = L.regions.reduce((a, r) => a + r.brumillons, 0); info.brumillons = brumTotal;
const lastTier = L.collectible.rewards.at(-1)[0]; if (lastTier !== brumTotal) err(`Brumillons : ${brumTotal} posés mais dernier palier à ${lastTier}`);

// ------------------------------------------------------------------ 2. placement : région, terre ferme, pente
const placed = [
  ...L.towns.map((t) => ({ kind: 'ville', id: t.id, name: t.name, x: t.x, z: t.z, region: t.region, flat: true })),
  ...L.outposts.map((t) => ({ kind: 'avant-poste', id: t.id, name: t.name, x: t.x, z: t.z, region: t.region, flat: true })),
  ...L.camps.map((t) => ({ kind: 'camp', id: t.id, name: t.name, x: t.x, z: t.z, region: t.region, flat: true })),
  ...L.waypoints.map((t) => ({ kind: 'pierre', id: t.id, name: t.name, x: t.x, z: t.z, region: t.region })),
  ...L.dungeons.map((t) => ({ kind: 'donjon', id: t.id, name: t.name, x: t.x, z: t.z, region: t.region })),
  ...L.pois.map((t) => ({ kind: 'lieu:' + t.type, id: t.id, name: t.name, x: t.x, z: t.z, region: t.region, flat: t.type === 'arene', water: ['source', 'pont', 'cascade', 'repere', 'epave'].includes(t.type) })),
];
const meanSlope = (x, z, r) => { let s = 0, n = 0; box(x - r, z - r, x + r, z + r, (i, j) => { s += slopeAt(i, j); n++; }); return s / n; };
const dryAt = (x, z) => { const k = J(z) * N + I(x); return depth(k) <= 0.05 && !LAVA[k]; };
function suggest(p, needFlat) {
  let best = null;
  for (let r = 10; r <= 200 && !best; r += 10) for (let a = 0; a < 16; a++) {
    const x = Math.round(p.x + r * Math.cos((a * Math.PI) / 8)), z = Math.round(p.z + r * Math.sin((a * Math.PI) / 8));
    if (regionAt(x, z) !== p.region || !dryAt(x, z)) continue;
    const s = needFlat ? meanSlope(x, z, 15) : slopeAt(I(x), J(z)); if (s > (needFlat ? 10 : 30)) continue;
    best = [x, z]; break;
  }
  return best ? ` → proposé (${best[0]}, ${best[1]})` : '';
}
for (const p of placed) {
  const at = regionAt(p.x, p.z);
  if (p.region && at !== p.region) err(`${p.kind} ${p.id} : région déclarée ${p.region}, carte = ${at}`);
  if (!p.water && !dryAt(p.x, p.z)) err(`${p.kind} ${p.id} « ${p.name} » dans l'eau (prof. ${depth(J(p.z) * N + I(p.x)).toFixed(1)} m)${suggest({ ...p, region: at }, p.flat)}`);
  if (p.flat) { const s = meanSlope(p.x, p.z, 15); if (s > 12) (p.kind === 'ville' || p.kind === 'avant-poste' ? err : warn)(`${p.kind} ${p.id} : pente moyenne ${s.toFixed(0)}° sur 15 m (> 12°)${suggest({ ...p, region: at }, true)}`); }
}

// ------------------------------------------------------------------ 3. chevauchements
const safe = L.safeZones.map((s) => ({ ...s, x: s.circle[0], z: s.circle[1], r: s.circle[2] }));
for (const rz of L.redZones) {
  for (const s of safe) if (inShape(s.x, s.z, rz.shape)) err(`zone sûre ${s.id} dans la zone rouge ${rz.id}`);
  for (const wp of L.waypoints) if (inShape(wp.x, wp.z, rz.shape)) warn(`pierre ${wp.id} dans la zone rouge ${rz.id}`);
  for (const t of L.towns) if (inShape(t.x, t.z, rz.shape)) err(`ville ${t.id} dans la zone rouge ${rz.id}`);
}
for (const r of L.regions) for (const b of r.bosses) for (const s of safe) if (Math.hypot(b.x - s.x, b.z - s.z) < s.r + 40) err(`boss ${b.name} à moins de 40 m de la zone sûre ${s.id}`);
for (let a = 0; a < L.waypoints.length; a++) for (let b = a + 1; b < L.waypoints.length; b++) { const A = L.waypoints[a], B = L.waypoints[b]; const d = Math.hypot(A.x - B.x, A.z - B.z); if (d < 250) warn(`pierres ${A.id} et ${B.id} à ${d.toFixed(0)} m`); }
const arenas = placed.filter((p) => p.kind === 'lieu:arene');
for (let a = 0; a < arenas.length; a++) for (let b = a + 1; b < arenas.length; b++) { const d = Math.hypot(arenas[a].x - arenas[b].x, arenas[a].z - arenas[b].z); if (d < 60) err(`arènes ${arenas[a].id} / ${arenas[b].id} se chevauchent (${d.toFixed(0)} m)`); }
for (const rd of L.roads) for (const s of rd.pts) if (!regionAt(s[0], s[1])) err(`route ${rd.id} hors carte`);

// ------------------------------------------------------------------ 4. temps de trajet (depuis chaque ville)
const hubs = L.towns.map((t) => t.id);
const T = {}; for (const t of L.towns) { T[t.id] = dijkstra(t.x, t.z); lap('chemins depuis ' + t.id); }
const min = (s) => (s === Infinity ? null : +(s / 60).toFixed(1));
const reach = {};
for (const p of placed) { const s = tAt(T.brumeval, p.x, p.z); reach[p.id] = min(s); if (s === Infinity) err(`${p.kind} ${p.id} « ${p.name} » inaccessible à pied depuis Brumeval`); }
info.hubTimes = Object.fromEntries(hubs.map((a) => [a, Object.fromEntries(hubs.map((b) => { const t = L.towns.find((q) => q.id === b); return [b, min(tAt(T[a], t.x, t.z))]; }))]));
// pierre la plus proche : part des terres jouables à plus de 700 m d'une pierre (ligne droite)
let far = 0, land = 0, worst = 0;
for (let j = 0; j < N; j += 4) for (let i = 0; i < N; i += 4) { if (!inPlay(i, j)) continue; const k = j * N + i; if (depth(k) > 0.05 || H[k] < 0) continue; land++;
  let d = Infinity; for (const wp of L.waypoints) d = Math.min(d, Math.hypot(X(i) - wp.x, Z(j) - wp.z)); if (d > 700) far++; worst = Math.max(worst, d); }
info.waypointCoverage = { landFartherThan700mPct: +((100 * far) / land).toFixed(1), worstDistanceM: Math.round(worst) };
if (far / land > 0.02) warn(`${info.waypointCoverage.landFartherThan700mPct} % des terres à plus de 700 m d'une pierre (pire : ${Math.round(worst)} m)`);

// ------------------------------------------------------------------ 5. courbe de niveaux
// temps de marche depuis Brumeval jusqu'au « cœur » de chaque région (médiane des temps sur ses cellules atteignables)
const regT = {}, regTs = Object.fromEntries(L.regions.map((r) => [r.id, []]));
for (let j = 0; j < N; j += 3) for (let i = 0; i < N; i += 3) { const t = T.brumeval[j * N + i]; if (t === Infinity) continue; const id = regionAt(X(i), Z(j)); if (id) regTs[id].push(t); }
for (const r of L.regions) { const ts = regTs[r.id].sort((a, b) => a - b); regT[r.id] = ts.length ? +(ts[ts.length >> 1] / 60).toFixed(1) : null; }
lap('courbe de niveaux');
const curve = L.regions.map((r) => ({ id: r.id, levels: r.levels, danger: r.danger, walkMinFromBrumeval: regT[r.id] })).sort((a, b) => a.levels[0] - b.levels[0]);
info.levelCurve = curve;
// corrélation (rang de Spearman) niveau minimal ↔ éloignement, hors zones rouges
const yellow = curve.filter((c) => c.danger !== 'rouge' && c.walkMinFromBrumeval != null);
const rank = (arr) => { const s = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); s.forEach(([, i], k) => (r[i] = k)); return r; };
const ra = rank(yellow.map((c) => c.levels[0])), rb = rank(yellow.map((c) => c.walkMinFromBrumeval)), n = yellow.length;
const rho = 1 - (6 * ra.reduce((s, v, i) => s + (v - rb[i]) ** 2, 0)) / (n * (n * n - 1)); info.levelDistanceSpearman = +rho.toFixed(2);
if (rho < 0.5) warn(`la difficulté ne monte pas assez avec l'éloignement (Spearman ${rho.toFixed(2)})`);
// voisins : saut de niveau minimal > 8 entre régions jaunes qui se touchent
const adj = new Set();
for (let r = 0; r < cm.rows; r++) for (let c = 0; c < cm.cols; c++) { const a = cm.region[r][c]; for (const [dr, dc] of [[0, 1], [1, 0]]) { const b = cm.region[r + dr]?.[c + dc]; if (b && b !== a && cm.water[r][c] === '0') adj.add([a, b].sort().join('')); } }
const byChar = Object.fromEntries(L.regions.map((r) => [r.char, r]));
info.levelJumps = [];
for (const pair of adj) { const A = byChar[pair[0]], B = byChar[pair[1]]; if (!A || !B) continue; const jump = Math.abs(A.levels[0] - B.levels[0]);
  if (jump > 8) info.levelJumps.push(`${A.id} (${A.levels.join('–')}) ↔ ${B.id} (${B.levels.join('–')}) : +${jump}`); }

// ------------------------------------------------------------------ 6. typologie des hauteurs (cohérence avec les étages annoncés)
for (const r of L.regions) { const e = r.heightTypology.elevation; if (e.max > 420 && r.danger !== 'rouge') warn(`${r.id} : sommet jouable à ${e.max} m (> 420 m)`); }

// ------------------------------------------------------------------ rapport
const report = { errors, warnings, info, reachFromBrumevalMin: reach };
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'out', 'validate_report.json'), JSON.stringify(report, null, 1));
console.log('— Temps entre villes (min, à pied) —');
for (const [a, row] of Object.entries(info.hubTimes)) console.log(a.padEnd(12), Object.entries(row).map(([b, t]) => `${b}:${t}`).join('  '));
console.log('— Courbe de niveaux (niv. min · minutes depuis Brumeval) —');
console.log(curve.map((c) => `${c.id}${c.danger === 'rouge' ? '*' : ''} ${c.levels.join('–')} · ${c.walkMinFromBrumeval}`).join('\n'));
console.log('Spearman niveau/éloignement (jaunes) :', info.levelDistanceSpearman, '· Brumillons :', brumTotal, '· couverture pierres :', JSON.stringify(info.waypointCoverage));
console.log('Sauts de niveau entre voisins (> 8) :\n  ' + info.levelJumps.join('\n  '));
console.log(`\n${warnings.length} avertissement(s)`); for (const w of warnings) console.log('  ⚠ ' + w);
console.log(`${errors.length} erreur(s)`); for (const e of errors) console.log('  ✖ ' + e);
process.exitCode = errors.length ? 1 : 0;
