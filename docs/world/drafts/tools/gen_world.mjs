// Brumeval Online v0.3 — deterministic world heightmap + control map generator.
// Usage (repo root):  node docs/world/drafts/tools/gen_world.mjs [--quick] [--no-render]
// Outputs: docs/world/drafts/heightmap.png (16-bit), heightmap.json, carto.json, topo.png, tools/out/*.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fbm2, valueNoise2, mulberry32, smoothstep, lerp, clamp } from '../../../../shared/noise.js';
import { LAKES as LEGACY_LAKES, WORLD_SEED as LEGACY_SEED } from '../../../../shared/world.js';
import * as S from './world_spec.mjs';
import { encodeGray16 } from './png.mjs';
import { renderTopo } from './render_topo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const OUT_TOOLS = path.join(HERE, 'out');
fs.mkdirSync(OUT_TOOLS, { recursive: true });
const ARGS = new Set(process.argv.slice(2));
const QUICK = ARGS.has('--quick');
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const { size: N, step: STEP, x0: X0, z0: Z0 } = S.GRID;
const X = (i) => X0 + i * STEP, Z = (j) => Z0 + j * STEP;
const idx = (i, j) => j * N + i;
const H = new Float32Array(N * N);
const SEED = S.SEED;

// ------------------------------------------------------------------ geometry helpers
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1) : 0;
  return [Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t];
}
function bbox(poly, m = 0) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of poly) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); }
  return [a - m, b - m, c + m, d + m];
}
/** Signed distance to polygon (negative inside). Outside bbox+margin returns margin (cheap). */
function makePolySDF(poly, margin = 1e9) {
  const bb = bbox(poly, margin);
  return (x, z) => {
    if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) return margin;
    let d = Infinity, inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      d = Math.min(d, segDist(x, z, xj, zj, xi, zi)[0]);
    }
    return inside ? -d : d;
  };
}
/** Nearest point on polyline → { d, s (arc length), seg, t } */
function polyNearest(pts, x, z) {
  let best = { d: Infinity, s: 0, seg: 0, t: 0 }, acc = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const L = Math.hypot(bx - ax, bz - az);
    const [d, t] = segDist(x, z, ax, az, bx, bz);
    if (d < best.d) best = { d, s: acc + t * L, seg: k, t };
    acc += L;
  }
  return best;
}
const polyLength = (pts) => { let L = 0; for (let k = 0; k < pts.length - 1; k++) L += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]); return L; };
/** Resample a polyline every `ds` metres → [[x, z, s, k, t]] */
function resample(pts, ds) {
  const out = []; const L = polyLength(pts); const n = Math.max(2, Math.ceil(L / ds) + 1);
  let k = 0, acc = 0;
  for (let q = 0; q < n; q++) {
    const s = (q / (n - 1)) * L;
    while (k < pts.length - 2 && acc + Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) < s) { acc += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]); k++; }
    const segL = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    const t = segL > 0 ? clamp((s - acc) / segL, 0, 1) : 0;
    out.push([lerp(pts[k][0], pts[k + 1][0], t), lerp(pts[k][1], pts[k + 1][1], t), s, k, t]);
  }
  return out;
}
function sampleH(x, z, A = H) {
  const fi = clamp((x - X0) / STEP, 0, N - 1.001), fj = clamp((z - Z0) / STEP, 0, N - 1.001);
  const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
  return lerp(lerp(A[idx(i, j)], A[idx(i + 1, j)], u), lerp(A[idx(i, j + 1)], A[idx(i + 1, j + 1)], u), v);
}
/** iterate cells inside a world-space bbox */
function forBox(xa, za, xb, zb, fn) {
  const ia = clamp(Math.floor((xa - X0) / STEP), 0, N - 1), ib = clamp(Math.ceil((xb - X0) / STEP), 0, N - 1);
  const ja = clamp(Math.floor((za - Z0) / STEP), 0, N - 1), jb = clamp(Math.ceil((zb - Z0) / STEP), 0, N - 1);
  for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) fn(i, j, X(i), Z(j), idx(i, j));
}
const ridgedN = (x, z, seed, oct) => { // ridged multifractal-ish in [0,1]
  let sum = 0, amp = 0.5, f = 1, norm = 0, prev = 1;
  for (let o = 0; o < oct; o++) { let n = 1 - Math.abs(valueNoise2(x * f, z * f, seed + o * 31) * 2 - 1); n *= n; sum += n * amp * prev; prev = clamp(n * 1.6, 0, 1); norm += amp; amp *= 0.5; f *= 2.03; }
  return sum / norm;
};
const inEllipse = (x, z, cx, cz, rx, rz) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2;

// ------------------------------------------------------------------ legacy 360 m square (exact copy of shared/world.js without its edge walls)
const LEG_FLATS = [{ x: 0, z: 0, r: 30, h: 1.2 }, { x: -100, z: -8, r: 18, h: null }, { x: 88, z: -88, r: 18, h: null }, { x: 118, z: -132, r: 14, h: null }];
function legRaw(x, z) {
  let h = 1.5 + (fbm2(x * 0.011, z * 0.011, LEGACY_SEED, 4) - 0.5) * 12;
  h += (fbm2(x * 0.06, z * 0.06, LEGACY_SEED + 7, 2) - 0.5) * 1.2;
  if (h < 0) h *= 0.3;
  return h;
}
const LEG_FLAT_H = LEG_FLATS.map((a) => a.h ?? legRaw(a.x, a.z));
export function legacyHeight(x, z) {
  let h = legRaw(x, z);
  for (let i = 0; i < LEG_FLATS.length; i++) {
    const a = LEG_FLATS[i], d = Math.hypot(x - a.x, z - a.z);
    if (d < a.r + 18) h = lerp(LEG_FLAT_H[i], h, smoothstep(a.r, a.r + 18, d));
  }
  for (const l of LEGACY_LAKES) {
    const d = Math.hypot(x - l.x, z - l.z);
    if (d < l.r + 3) h = lerp(h, -5, 1 - smoothstep(l.r * 0.3, l.r + 3, d));
  }
  return h + S.LEGACY.lift;
}
// blend metric: square near the axes, rounded near the corners (no visible rectangle); ≥ 0.994 exact inside |x|,|z| <= 160
export const legacyMetric = (x, z) => Math.max(Math.abs(x), Math.abs(z), 0.8 * Math.hypot(x, z));
const legacyW = (x, z) => 1 - smoothstep(S.LEGACY.keep, S.LEGACY.blendTo, legacyMetric(x, z));

// ------------------------------------------------------------------ meanders: densify authored rivers with a deterministic lateral wiggle
for (let ri = 0; ri < S.RIVERS.length; ri++) {
  const Rv = S.RIVERS[ri]; if (Rv._meandered) continue;
  const base = Rv.pts.map((p) => [p[0], p[1]]), L = polyLength(base);
  const smp = resample(base, 18), amp = Rv.type === 'canyon' ? 8 : Rv.width < 14 ? 14 : 30, lam = Rv.type === 'canyon' ? 260 : 380;
  Rv.pts = smp.map(([x, z, s2, k, t], q) => {
    const [ax, az] = base[k], [bx, bz] = base[k + 1], l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l, nz = (bx - ax) / l;
    const taper = smoothstep(0, 120, s2) * smoothstep(L, L - 120, s2);
    const off = taper * amp * (Math.sin((s2 / lam) * Math.PI * 2 + ri) * 0.6 + (fbm2(s2 / 150, ri * 7.3, SEED + 171, 3) - 0.5) * 1.6);
    return [x + nx * off, z + nz * off, lerp(Rv.pts[k][2], Rv.pts[k + 1][2], t)];
  });
  Rv._meandered = true;
}

// ------------------------------------------------------------------ masks used by several passes
const coastSDF = makePolySDF(S.COAST);
const wetSDF = makePolySDF(S.WETLAND.poly, 400);
const desertPoly = S.REGIONS.find((r) => r.id === 'sable_rouge').poly;
const desertSDF = makePolySDF(desertPoly, 400);
const plateauSDF = Object.fromEntries(S.PLATEAUS.map((p) => [p.id, makePolySDF(p.poly, 500)]));
const COASTD = new Float32Array(N * N);   // noisy signed distance to the coast (+ inland)
const MOUNT = new Float32Array(N * N);    // mountain mask 0..1 (for erosion, biomes)
const ERODE = new Float32Array(N * N);    // erosion weight
const DUNE = new Float32Array(N * N);     // dune mask

// ================================================================== 1. lowland base
log('base lowlands + coast distance');
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = X(i), z = Z(j), k = idx(i, j);
  let sw = 0, sh = 0;
  for (const [ax, az, ah, ar] of S.ANCHORS) { const w = Math.exp(-((x - ax) ** 2 + (z - az) ** 2) / (ar * ar)) + 1e-9; sw += w; sh += w * ah; }
  let h = sh / sw;
  // rolling hills everywhere, damped in wetlands and desert (dunes replace them)
  const wet = 1 - smoothstep(-150, 120, wetSDF(x, z));
  const des = 1 - smoothstep(-200, 150, desertSDF(x, z));
  const hilly = (1 - wet) * (1 - 0.7 * des) * (0.25 + 0.75 * smoothstep(200, 650, Math.max(Math.abs(x), Math.abs(z))));  // calmer around the legacy square
  const wx = x + (fbm2(x / 900, z / 900, SEED + 5, 2) - 0.5) * 500, wz = z + (fbm2(x / 900, z / 900, SEED + 6, 2) - 0.5) * 500;
  const hillAmp = 0.6 + 0.8 * fbm2(x / 1400, z / 1400, SEED + 7, 2);
  h += hilly * hillAmp * ((fbm2(wx / 650, wz / 650, SEED + 1, 4) - 0.5) * 46 + (ridgedN(wx / 420, wz / 420, SEED + 8, 3) - 0.35) * 26 + (fbm2(x / 170, z / 170, SEED + 2, 3) - 0.5) * 10);
  H[k] = h;
  DUNE[k] = des;
  const cd = coastSDF(x, z);
  COASTD[k] = -cd + (fbm2(x / 260, z / 260, SEED + 3, 3) - 0.5) * 120 + (fbm2(x / 110, z / 110, SEED + 9, 3) - 0.5) * 70 + (fbm2(x / 40, z / 40, SEED + 4, 2) - 0.5) * 20;
  ERODE[k] = 0.35 * hilly;
}

// ================================================================== 2. mountain ranges, peaks, volcano
log('ridges and peaks');
for (const R of S.RIDGES) {
  const pts = R.pts.map((p) => [p[0], p[1]]);
  const bb = bbox(pts, Math.max(...R.pts.map((p) => p[3])) + 10);
  forBox(bb[0], bb[1], bb[2], bb[3], (i, j, x, z, k) => {
    const n = polyNearest(pts, x, z);
    const a = R.pts[n.seg], b = R.pts[n.seg + 1];
    const Hc = lerp(a[2], b[2], n.t), W = lerp(a[3], b[3], n.t);
    // warp the distance so ridges are not tubes
    const d = n.d * (0.8 + 0.45 * fbm2(x / 220, z / 220, SEED + 11, 3)) ;
    const t = d / W; if (t >= 1) return;
    const p = Math.pow(1 - smoothstep(0, 1, t), 1.15);
    const base = H[k];
    if (Hc > base) H[k] = base + p * (Hc - base);
    MOUNT[k] = Math.max(MOUNT[k], p);
  });
}
for (const [, , px, pz, ph, pr] of S.PEAKS) {
  forBox(px - pr, pz - pr, px + pr, pz + pr, (i, j, x, z, k) => {
    const t = Math.hypot(x - px, z - pz) / pr; if (t >= 1) return;
    const p = Math.pow(1 - t, 1.6) * (1 - 0.15 * smoothstep(0.0, 0.08, 0.08 - t)); // slightly rounded summit
    if (ph > H[k]) H[k] += p * (ph - H[k]);
    MOUNT[k] = Math.max(MOUNT[k], Math.min(1, p * 1.5));
  });
}
// ridged detail on every mountain
for (let k = 0; k < N * N; k++) {
  const m = MOUNT[k]; if (m <= 0.01) continue;
  const i = k % N, j = (k / N) | 0, x = X(i), z = Z(j);
  const r = ridgedN(x / 330, z / 330, SEED + 21, 5);
  H[k] += (r - 0.45) * 95 * Math.pow(m, 0.8) + (fbm2(x / 60, z / 60, SEED + 22, 2) - 0.5) * 8 * m;
  ERODE[k] = Math.max(ERODE[k], 0.4 + 0.6 * m);
}
log('volcano');
{
  const V = S.VOLCANO;
  const cone = (r) => V.base + (V.top - V.base) * Math.pow(Math.max(0, 1 - r / V.R), 1.45);
  const rimH = cone(V.craterR) + 4, floorH = rimH - V.craterDepth;
  forBox(V.x - V.R, V.z - V.R, V.x + V.R, V.z + V.R, (i, j, x, z, k) => {
    const dx = x - V.x, dz = z - V.z, r = Math.hypot(dx, dz); if (r >= V.R) return;
    const ang = Math.atan2(dz, dx);
    // radial gullies
    const gul = (ridgedN(ang * 9, r / 90, SEED + 31, 3) - 0.5) * 22 * smoothstep(V.R, V.R * 0.35, r) * smoothstep(V.craterR, V.craterR * 2, r);
    let h = cone(r) + gul;
    if (r < V.craterR * 1.25) { // crater bowl
      const q = r / V.craterR;
      const bowl = floorH + (rimH - floorH) * smoothstep(0.55, 1.0, q);
      h = lerp(bowl, h, smoothstep(1.0, 1.25, q));
    }
    // breach (lava spillway): a notch from the crater floor down the flank
    let da = Math.abs(Math.atan2(Math.sin(ang - V.breach), Math.cos(ang - V.breach)));
    if (da < V.breachWidth && r > V.craterR * 0.6 && r < V.R * 0.7) {
      const ch = floorH - (r - V.craterR) * 0.34;
      const w = (1 - da / V.breachWidth) ** 1.5 * smoothstep(V.R * 0.7, V.R * 0.45, r);
      if (ch < h) h = lerp(h, ch, w);
    }
    const blend = smoothstep(V.R, V.R * 0.75, r);
    H[k] = Math.max(H[k], lerp(H[k], h, blend));
    MOUNT[k] = Math.max(MOUNT[k], 0.6 * blend);
    ERODE[k] = Math.max(ERODE[k], 0.5 * blend * smoothstep(V.craterR * 1.5, V.craterR * 2.5, r));
  });
  S.VOLCANO._rim = rimH; S.VOLCANO._floor = floorH;
}

// ================================================================== 3. plateaus, mesas, basins
log('plateaus and mesas');
for (const P of S.PLATEAUS) {
  const sdf = plateauSDF[P.id];
  const [cx, cz] = P.poly.reduce((a, p) => [a[0] + p[0] / P.poly.length, a[1] + p[1] / P.poly.length], [0, 0]);
  const bb = bbox(P.poly, P.edge * 6);
  forBox(bb[0], bb[1], bb[2], bb[3], (i, j, x, z, k) => {
    let di = -sdf(x, z) + (fbm2(x / 90, z / 90, SEED + 41, 3) - 0.5) * P.edge * 3.2 + (fbm2(x / 25, z / 25, SEED + 42, 2) - 0.5) * P.edge * 0.8;
    if (di < -P.edge * 5) return;
    let top = P.top + P.tilt[0] * (x - cx) + P.tilt[1] * (z - cz) + P.dome * smoothstep(0, 280, di);
    let rough = (fbm2(x / 140, z / 140, SEED + 43, 4) - 0.5) * 18;
    if (P.terrace) { const tv = top + rough; const q = Math.floor(tv / P.terrace); const f = tv / P.terrace - q; top = (q + smoothstep(0.55, 0.9, f)) * P.terrace; }
    else top += rough * 0.5;
    const t = smoothstep(-P.edge * 0.5, P.edge * 0.5, di);
    const talus = smoothstep(-P.edge * 5, -P.edge * 0.4, di) * 0.28;       // scree skirt at the foot of the cliff
    const base = H[k];
    const up = Math.max(0, top - base);
    H[k] = base + up * Math.max(t, talus * (1 - t));
    ERODE[k] = Math.max(ERODE[k], 0.55 * smoothstep(-P.edge * 3, 0, di) * smoothstep(P.edge * 3, 0, di)); // erode the rims
    if (di > P.edge) ERODE[k] = Math.min(ERODE[k], 0.25);
  });
}
for (const [id, , mx, mz, mr, mh] of S.MESAS) {
  const R = mr * 2.2;
  forBox(mx - R, mz - R, mx + R, mz + R, (i, j, x, z, k) => {
    const ang = Math.atan2(z - mz, x - mx);
    const rr = mr * (1 + (fbm2(Math.cos(ang) * 2 + mx, Math.sin(ang) * 2 + mz, SEED + 51, 3) - 0.5) * 0.5);
    const d = Math.hypot(x - mx, z - mz) - rr;
    const t = smoothstep(8, -6, d), talus = smoothstep(rr * 0.9, 0, d) * 0.3;
    const top = mh + (fbm2(x / 50, z / 50, SEED + 52, 2) - 0.5) * 4;
    const up = Math.max(0, top - H[k]);
    H[k] += up * Math.max(t, talus * (1 - t));
    if (d < 20) DUNE[k] *= smoothstep(-5, 20, d);
    ERODE[k] = Math.max(ERODE[k], 0.5 * smoothstep(rr * 0.6, 0, Math.abs(d)));
  });
}
for (const [, bx, bz, rx, rz, depth] of S.BASINS) {
  forBox(bx - rx * 1.6, bz - rz * 1.6, bx + rx * 1.6, bz + rz * 1.6, (i, j, x, z, k) => {
    const q = Math.sqrt(inEllipse(x, z, bx, bz, rx, rz)); if (q >= 1.6) return;
    H[k] -= depth * (1 - smoothstep(0.3, 1.6, q)) * (0.85 + 0.3 * fbm2(x / 70, z / 70, SEED + 61, 2));
  });
}

// ================================================================== 4. desert dunes, wetlands
log('dunes and wetlands');
{
  const ang = (-20 * Math.PI) / 180; // prevailing wind from the WNW → crests run NNE-SSW
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const [ex, ez, er] = S.REGIONS.find((r) => r.id === 'mer_dunes').circle;
  for (let k = 0; k < N * N; k++) {
    const m = DUNE[k]; if (m < 0.01) continue;
    const i = k % N, j = (k / N) | 0, x = X(i), z = Z(j);
    const erg = 1 - smoothstep(er * 0.6, er * 1.7, Math.hypot(x - ex, z - ez));
    const westWall = smoothstep(-1900, -2250, x);                       // giant dunes against the western edge
    const lam = 170 + 60 * fbm2(x / 900, z / 900, SEED + 71, 2) + 70 * erg;
    const u = (x * ca + z * sa + (fbm2(x / 500, z / 500, SEED + 72, 3) - 0.5) * 420) / lam;
    const p = u - Math.floor(u);
    const prof = p < 0.72 ? smoothstep(0, 0.72, p) : 1 - smoothstep(0.72, 1, p); // gentle windward, steep lee
    const v = (x * -sa + z * ca) / (lam * 0.55);
    const cross = 0.6 + 0.4 * valueNoise2(v, u * 0.35, SEED + 73);
    const A = (8 + 10 * fbm2(x / 400, z / 400, SEED + 74, 2)) + 20 * erg + 22 * westWall;
    // keep the flats around Ambresable and the oases sailable/flat
    const town = smoothstep(120, 260, Math.hypot(x + 1240, z - 400));
    H[k] += m * town * A * prof * cross;
    ERODE[k] *= 1 - m;
  }
}
for (let k = 0; k < N * N; k++) {
  const i = k % N, j = (k / N) | 0, x = X(i), z = Z(j);
  const s = wetSDF(x, z); if (s > 150) continue;
  const w = 1 - smoothstep(-120, 150, s);
  const wetH = S.WETLAND.level + (fbm2(x / 95, z / 95, SEED + 81, 3) - 0.56) * 6 + (fbm2(x / 22, z / 22, SEED + 82, 2) - 0.5) * 1.4;
  H[k] = lerp(H[k], wetH, w);
  ERODE[k] *= 1 - w;
}

// ================================================================== 5. coast, lagoons, islands, sandbars
log('coast, islands');
const cliffAt = (x, z) => { let c = 0; for (const [cx, cz, r, v] of S.COAST_CLIFFS) c = Math.max(c, v * (1 - smoothstep(r * 0.5, r, Math.hypot(x - cx, z - cz)))); return c; };
const lagoonAt = (x, z) => { let m = 0; for (const [cx, cz, rx, rz] of S.LAGOONS) m = Math.max(m, 1 - smoothstep(0.6, 1.0, Math.sqrt(inEllipse(x, z, cx, cz, rx, rz)))); return m; };
const LAGOON = new Float32Array(N * N);
for (let k = 0; k < N * N; k++) {
  const i = k % N, j = (k / N) | 0, x = X(i), z = Z(j);
  const d = COASTD[k], c = cliffAt(x, z), lg = lagoonAt(x, z);
  LAGOON[k] = lg;
  if (d >= 0) {
    const beach = 0.5 + d * lerp(0.028, 0.5, c);
    const w = smoothstep(0, lerp(280, 32, c), d);
    const h = H[k];
    H[k] = lerp(Math.min(beach, h), h, w);
    if (d < 300) ERODE[k] *= smoothstep(0, 300, d);
  } else {
    const dd = -d;
    let sea = -(0.6 + dd * lerp(0.045, 0.3, c));
    sea += (fbm2(x / 120, z / 120, SEED + 91, 3) - 0.5) * 3;
    sea = Math.max(sea, -45);
    const lag = -0.35 - 2.6 * fbm2(x / 160, z / 160, SEED + 92, 3) - 0.8 * smoothstep(0, 200, dd) * (1 - lg);
    H[k] = lerp(sea, Math.max(sea, lag), lg);
    ERODE[k] = 0;
  }
}
for (const [id, , ix, iz, R, top, cliff] of S.ISLANDS) {
  forBox(ix - R * 1.5, iz - R * 1.5, ix + R * 1.5, iz + R * 1.5, (i, j, x, z, k) => {
    const ang = Math.atan2(z - iz, x - ix);
    const rr = R * (1 + (fbm2(Math.cos(ang) * 1.7 + ix / 97, Math.sin(ang) * 1.7 + iz / 97, SEED + 101, 3) - 0.5) * 0.7);
    const p = 1 - Math.hypot(x - ix, z - iz) / rr; if (p < -0.3) return;
    const shape = cliff > 0.3 ? lerp(smoothstep(0, 0.5, p), smoothstep(0.02, 0.14, p), cliff) : Math.pow(smoothstep(0, 1, p), 1.2);
    const ih = -1.2 + (top + 1.2) * shape + (p > 0.1 ? (fbm2(x / 70, z / 70, SEED + 102, 3) - 0.5) * top * 0.35 : 0);
    const reef = p > -0.3 ? lerp(H[k], Math.max(H[k], -1.0), smoothstep(-0.3, 0, p)) : H[k];
    H[k] = Math.max(reef, ih);
    if (p > 0) COASTD[k] = Math.max(COASTD[k], p * rr);
  });
}
for (const sb of S.SANDBARS) {
  const bb = bbox(sb, 40);
  forBox(bb[0], bb[1], bb[2], bb[3], (i, j, x, z, k) => {
    const n = polyNearest(sb, x, z); if (n.d > 34) return;
    const target = -0.4 + (fbm2(x / 30, z / 30, SEED + 111, 2) - 0.5) * 0.3;
    H[k] = Math.max(H[k], lerp(target, H[k], smoothstep(9, 34, n.d)));
  });
}

// ================================================================== 6. legacy square (first pass, so later passes see it)
function applyLegacy() {
  const B = S.LEGACY.blendTo;
  forBox(-B, -B, B, B, (i, j, x, z, k) => {
    const w = legacyW(x, z); if (w <= 0) return;
    H[k] = lerp(H[k], legacyHeight(x, z), w);
    ERODE[k] *= 1 - w;
  });
}
applyLegacy();

// ================================================================== 7. hydraulic erosion (droplets)
log('erosion');
{
  const drops = QUICK ? 60000 : 380000;
  const rand = mulberry32(SEED + 777);
  const E = new Float32Array(N * N); for (let k = 0; k < N * N; k++) E[k] = H[k] / STEP; // heights in cell units
  const inertia = 0.06, capF = 5, minCap = 0.01, erodeS = 0.35, depS = 0.3, evap = 0.015, grav = 4, maxSteps = 70;
  const brush = []; { const r = 2; let s = 0; for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const w = Math.max(0, r - Math.hypot(dx, dz)); if (w > 0) { brush.push([dx, dz, w]); s += w; } } for (const b of brush) b[2] /= s; }
  const hg = (px, pz) => {
    const i = Math.floor(px), j = Math.floor(pz), u = px - i, v = pz - j, k = idx(i, j);
    const a = E[k], b = E[k + 1], c = E[k + N], d = E[k + N + 1];
    return [a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v, (b - a) * (1 - v) + (d - c) * v, (c - a) * (1 - u) + (d - b) * u];
  };
  for (let n = 0; n < drops; n++) {
    let px = 2 + rand() * (N - 5), pz = 2 + rand() * (N - 5);
    if (ERODE[idx(Math.floor(px), Math.floor(pz))] < 0.05) continue;
    let dx = 0, dz = 0, speed = 1, water = 1, sed = 0;
    for (let s = 0; s < maxSteps; s++) {
      const ci = Math.floor(px), cj = Math.floor(pz), u = px - ci, v = pz - cj;
      const [h0, gx, gz] = hg(px, pz);
      dx = dx * inertia - gx * (1 - inertia); dz = dz * inertia - gz * (1 - inertia);
      const len = Math.hypot(dx, dz); if (len < 1e-6) break;
      dx /= len; dz /= len; px += dx; pz += dz;
      if (px < 2 || pz < 2 || px > N - 3 || pz > N - 3) break;
      const h1 = hg(px, pz)[0], dh = h1 - h0;
      const cap = Math.max(-dh * speed * water * capF, minCap);
      const k0 = idx(ci, cj);
      if (sed > cap || dh > 0) {
        const dep = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depS;
        sed -= dep;
        E[k0] += dep * (1 - u) * (1 - v); E[k0 + 1] += dep * u * (1 - v); E[k0 + N] += dep * (1 - u) * v; E[k0 + N + 1] += dep * u * v;
      } else {
        const w = ERODE[k0];
        const er = Math.min((cap - sed) * erodeS, -dh) * w;
        for (const [bx, bz, bw] of brush) { const kk = idx(ci + bx, cj + bz); E[kk] -= er * bw; }
        sed += er;
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * grav)); water *= 1 - evap;
    }
  }
  for (let k = 0; k < N * N; k++) { const e = E[k] * STEP; H[k] = lerp(H[k], e, clamp(ERODE[k] * 1.5, 0, 1)); }
}
applyLegacy();

// ================================================================== 7b. dry ravines
log('ravines');
for (const Rv of S.RAVINES) {
  const pts = Rv.pts.map((p) => [p[0], p[1]]);
  const Lr = polyLength(pts), hw = Rv.width / 2, reach = hw + 90;
  const smp = resample(pts, 4); const beds = smp.map(([x, z, s2, k, t]) => lerp(Rv.pts[k][2], Rv.pts[k + 1][2], t));
  const bb = bbox(pts, reach);
  forBox(bb[0], bb[1], bb[2], bb[3], (i, j, x, z, k) => {
    const n = polyNearest(pts, x, z); if (n.d > reach) return;
    const f0 = clamp(n.s / Lr, 0, 1) * (smp.length - 1), a = Math.floor(f0), b = Math.min(a + 1, smp.length - 1);
    const bed = lerp(beds[a], beds[b], f0 - a) + (fbm2(x / 30, z / 30, SEED + 161, 2) - 0.5) * 2;
    const d = Math.max(0, n.d + (fbm2(x / 50, z / 50, SEED + 162, 2) - 0.5) * hw);
    // fade the carve in at the head of the ravine
    const head = smoothstep(Lr, Lr - 60, n.s);
    const f = d < hw ? bed : bed + (d - hw) * Rv.wall;
    if (f < H[k]) H[k] = lerp(H[k], f, head);
  });
}

// ================================================================== 8. lakes
log('lakes');
const LAKE_ID = new Int16Array(N * N).fill(-1);
const WATER = new Float32Array(N * N).fill(-999);   // water surface (m) where water exists
for (let li = 0; li < S.LAKES.length; li++) {
  const L = S.LAKES[li];
  if (!L.level) L.level = +(sampleH(L.x, L.z) - 1.2).toFixed(1);
  L.level = +(+L.level).toFixed(1);
  let leak = 0;
  forBox(L.x - L.rx * 1.6, L.z - L.rz * 1.6, L.x + L.rx * 1.6, L.z + L.rz * 1.6, (i, j, x, z, k) => {
    const ang = Math.atan2(z - L.z, x - L.x);
    const wob = 1 + (fbm2(Math.cos(ang) * 1.5 + L.x / 50, Math.sin(ang) * 1.5, SEED + 121, 3) - 0.5) * 0.35;
    const q = Math.sqrt(inEllipse(x, z, L.x, L.z, L.rx, L.rz)) / wob;
    if (q < 1) {
      const bed = L.level - 0.4 - L.depth * Math.pow(1 - q, 0.6);
      H[k] = Math.min(H[k], bed); LAKE_ID[k] = li; WATER[k] = L.level;
    } else if (q < 1.5) {
      const rim = L.level + 0.3 + 1.2 * smoothstep(1, 1.5, q);
      const need = rim - H[k];
      if (need > 0) { const add = Math.min(need, 4) * (1 - smoothstep(1.2, 1.5, q)); H[k] += add; if (need > 4 && q < 1.1) leak++; }
    }
  });
  L._leakCells = leak;
}

// ================================================================== 9. rivers (monotonic beds carved into the terrain)
log('rivers');
const RIVER_D = new Float32Array(N * N).fill(1e9);  // distance to nearest river centreline (m)
const RIVER_ID = new Int16Array(N * N).fill(-1);
const RIVER_PROFILES = [];
for (let ri = 0; ri < S.RIVERS.length; ri++) {
  const Rv = S.RIVERS[ri];
  const pts = Rv.pts.map((p) => [p[0], p[1]]);
  const samples = resample(pts, 3);
  // authored bed along arc length
  const beds = samples.map(([x, z, s, k, t]) => lerp(Rv.pts[k][2], Rv.pts[k + 1][2], t));
  for (let q = 0; q < samples.length; q++) { // stay below the current terrain, then monotonic
    const [x, z] = samples[q];
    const terr = sampleH(x, z);
    beds[q] = Math.min(beds[q], terr - Rv.depth - 0.6);
    if (q > 0) beds[q] = Math.min(beds[q], beds[q - 1] - 0.0005);
  }
  const Ls = samples[samples.length - 1][2];
  const bedAt = (s) => { const f = clamp(s / Ls, 0, 1) * (samples.length - 1); const a = Math.floor(f), b = Math.min(a + 1, samples.length - 1); return lerp(beds[a], beds[b], f - a); };
  const hw = Rv.width / 2;
  const canyon = Rv.type === 'canyon';
  const floorW = canyon ? Math.max(10, Rv.width * 0.8) : Rv.width * 1.2;
  const reach = canyon ? hw + floorW + 70 : hw + 190;
  const bb = bbox(pts, reach);
  forBox(bb[0], bb[1], bb[2], bb[3], (i, j, x, z, k) => {
    const n = polyNearest(pts, x, z); if (n.d > reach) return;
    const wob = (fbm2(x / 40, z / 40, SEED + 131 + ri, 2) - 0.5) * hw * 0.5;
    const d = Math.max(0, n.d + wob);
    const bed = bedAt(n.s), surf = bed + Rv.depth;
    let f;
    if (d < hw) f = bed + 0.35 * (d / hw) ** 2 * Rv.depth;
    else if (d < hw + floorW) f = surf + 0.25 + (d - hw) * (canyon ? 0.04 : 0.05);
    else f = surf + 0.25 + floorW * (canyon ? 0.04 : 0.05) + (d - hw - floorW) * (canyon ? 2.3 : 0.16 + 0.0012 * (d - hw - floorW));
    if (f < H[k]) H[k] = f;
    if (d < RIVER_D[k]) { RIVER_D[k] = d; RIVER_ID[k] = ri; }
    if (d < hw && LAKE_ID[k] < 0) WATER[k] = Math.max(WATER[k], surf);
  });
  RIVER_PROFILES.push({ id: Rv.id, samples, beds, bedAt, Ls, hw, floorW });
}

// ================================================================== 10. towns, outposts, landmark knoll, waypoints
log('settlements');
function flatten(x0, z0, r, blend, hTarget) {
  const h0 = hTarget ?? sampleH(x0, z0);
  forBox(x0 - r - blend, z0 - r - blend, x0 + r + blend, z0 + r + blend, (i, j, x, z, k) => {
    const d = Math.hypot(x - x0, z - z0) + (fbm2(x / 30, z / 30, SEED + 141, 2) - 0.5) * 10;
    const w = 1 - smoothstep(r, r + blend, d); if (w <= 0) return;
    if (WATER[k] > -999 && LAKE_ID[k] >= 0) return;
    H[k] = lerp(H[k], h0 + (fbm2(x / 40, z / 40, SEED + 142, 2) - 0.5) * 1.2, w);
  });
  return h0;
}
for (const T of S.TOWNS) {
  if (T.legacy) { T.h = +sampleH(T.x, T.z).toFixed(1); continue; }
  // average of the neighbourhood rather than a single sample → less cut/fill
  let s = 0, c = 0; for (let a = 0; a < 8; a++) { s += sampleH(T.x + Math.cos(a) * T.r * 0.6, T.z + Math.sin(a) * T.r * 0.6); c++; }
  let target = s / c;
  if (T.id === 'port_salin') target = Math.max(target, 4.5);
  if (T.id === 'ambresable') target = Math.max(target, 39.5);
  T.h = +flatten(T.x, T.z, T.r * 0.85, T.flat, target).toFixed(1);
}
for (const O of S.OUTPOSTS) O.h = +flatten(O.x, O.z, O.r, O.flat).toFixed(1);
for (const Lm of S.LANDMARKS) {
  forBox(Lm.x - 260, Lm.z - 260, Lm.x + 260, Lm.z + 260, (i, j, x, z, k) => {
    const d = Math.hypot(x - Lm.x, z - Lm.z);
    const p = 1 - smoothstep(Lm.r * 0.6, 250, d);
    const t = Lm.knoll + (fbm2(x / 25, z / 25, SEED + 151, 2) - 0.5) * 1.5 * smoothstep(Lm.r * 0.5, Lm.r, d);
    if (t > H[k]) H[k] += (t - H[k]) * p * (d < Lm.r ? 1 : 0.9);
  });
  Lm.h = +sampleH(Lm.x, Lm.z).toFixed(1);
}

// ================================================================== 11. roads (grade-limited profiles, cut & fill, bridges)
log('roads');
const ROAD_D = new Float32Array(N * N).fill(1e9);
const BRIDGE = new Uint8Array(N * N);
const ROAD_INFO = [];
const nearRiver = (x, z) => { let best = { d: 1e9, r: null }; for (const P of RIVER_PROFILES) { const Rv = S.RIVERS.find((r) => r.id === P.id); const n = polyNearest(Rv.pts.map((p) => [p[0], p[1]]), x, z); const lim = P.hw + 8; if (n.d < lim && n.d < best.d) best = { d: n.d, r: P, n }; } return best; };
const inLake = (x, z) => { const i = Math.round((x - X0) / STEP), j = Math.round((z - Z0) / STEP); return LAKE_ID[idx(clamp(i, 0, N - 1), clamp(j, 0, N - 1))] >= 0; };
for (const Rd of S.ROADS) {
  if (Rd.carve === false) { ROAD_INFO.push({ id: Rd.id, carve: false }); continue; }
  const half = S.ROAD_HALF[Rd.cls], shoulder = Rd.cls === 'main' ? 12 : 7;
  const smp = resample(Rd.pts, 4);
  const bridge = smp.map(([x, z]) => nearRiver(x, z).d < 1e9);
  const wet = smp.map(([x, z]) => sampleH(x, z) < 0.3 || inLake(x, z));
  let prof = smp.map(([x, z]) => Math.max(sampleH(x, z), 0.8));
  // bridge samples: interpolate between the banks
  for (let q = 0; q < prof.length; q++) if (bridge[q] || wet[q]) {
    let a = q; while (a > 0 && (bridge[a] || wet[a])) a--;
    let b = q; while (b < prof.length - 1 && (bridge[b] || wet[b])) b++;
    const t = (q - a) / Math.max(1, b - a); prof[q] = lerp(prof[a], prof[b], t) + 1.0;
  }
  // smooth (moving average 36 m) then limit the grade both ways
  const sm = prof.map((_, q) => { let s = 0, c = 0; for (let o = -4; o <= 4; o++) { const p = prof[clamp(q + o, 0, prof.length - 1)]; s += p; c++; } return s / c; });
  const g = Rd.grade * 4;
  // two feasible grade-limited profiles (cut-biased and fill-biased); their mean is feasible too and balances cut & fill
  const limit = (arr, fwdFirst) => {
    const p = arr.slice();
    const fwd = () => { for (let q = 1; q < p.length; q++) p[q] = clamp(p[q], p[q - 1] - g, p[q - 1] + g); };
    const bwd = () => { for (let q = p.length - 2; q >= 0; q--) p[q] = clamp(p[q], p[q + 1] - g, p[q + 1] + g); };
    if (fwdFirst) { fwd(); bwd(); } else { bwd(); fwd(); }
    return p;
  };
  const pa = limit(sm, true), pb = limit(sm, false);
  for (let q = 0; q < sm.length; q++) sm[q] = (pa[q] + pb[q]) / 2;
  let maxCut = 0, maxFill = 0, maxGrade = 0, bridges = [];
  for (let q = 0; q < smp.length; q++) {
    const d = sm[q] - sampleH(smp[q][0], smp[q][1]);
    if (!bridge[q]) { maxCut = Math.min(maxCut, d); maxFill = Math.max(maxFill, d); }
    if (q && Math.abs(sm[q] - sm[q - 1]) / 4 > maxGrade) { maxGrade = Math.abs(sm[q] - sm[q - 1]) / 4; Rd._worst = [Math.round(smp[q][0]), Math.round(smp[q][1]), +sm[q - 1].toFixed(1), +sm[q].toFixed(1), bridge[q], wet[q]]; }
    if (bridge[q] && (q === 0 || !bridge[q - 1])) bridges.push([+smp[q][0].toFixed(0), +smp[q][1].toFixed(0)]);
  }
  const pts = Rd.pts;
  const bb = bbox(pts, half + shoulder + 4);
  const Ltot = smp[smp.length - 1][2];
  forBox(bb[0], bb[1], bb[2], bb[3], (i, j, x, z, k) => {
    const n = polyNearest(pts, x, z); if (n.d > half + shoulder) return;
    const f = clamp(n.s / Ltot, 0, 1) * (smp.length - 1), a = Math.floor(f), b = Math.min(a + 1, smp.length - 1);
    const target = lerp(sm[a], sm[b], f - a);
    const isBridge = bridge[a] || bridge[b];
    if (n.d < ROAD_D[k]) ROAD_D[k] = n.d;
    if (isBridge) { if (n.d <= half + 1) BRIDGE[k] = 1; return; }
    if (wet[a] && wet[b]) { if (n.d <= half + 1) BRIDGE[k] = 1; return; }  // causeway / pier over water
    const w = 1 - smoothstep(half, half + shoulder, n.d);
    // embankments steeper than 1:1 would look odd → keep the shoulder blend
    H[k] = lerp(H[k], target, w);
  });
  ROAD_INFO.push({ id: Rd.id, name: Rd.name, cls: Rd.cls, length: Math.round(Ltot), maxGradePct: +(maxGrade * 100).toFixed(1), maxCut: +maxCut.toFixed(1), maxFill: +maxFill.toFixed(1), bridges });
}
// river water must stay on top of the carved channel even after roads
for (let k = 0; k < N * N; k++) if (RIVER_ID[k] >= 0 && WATER[k] > -999 && LAKE_ID[k] < 0 && H[k] > WATER[k] - 0.2 && !BRIDGE[k]) {
  // road fill may have covered the channel next to a bridge: keep it as dry ground
  WATER[k] = -999;
}
applyLegacy();
// legacy lakes (surface = old WATER_LEVEL + lift)
for (const l of LEGACY_LAKES) forBox(l.x - l.r, l.z - l.r, l.x + l.r, l.z + l.r, (i, j, x, z, k) => { if (H[k] < -1.2 + S.LEGACY.lift) WATER[k] = -1.2 + S.LEGACY.lift; });

// ================================================================== 12. water classification
log('water + slope');
const WTYPE = new Uint8Array(N * N); // 0 dry, 1 sea, 2 lagoon, 3 lake, 4 river, 5 wetland pond, 6 lava
for (let k = 0; k < N * N; k++) {
  const i = k % N, j = (k / N) | 0, x = X(i), z = Z(j);
  if (LAKE_ID[k] >= 0) { WTYPE[k] = S.LAKES[LAKE_ID[k]].lava ? 6 : 3; continue; }
  if (WATER[k] > -999 && H[k] < WATER[k]) { WTYPE[k] = RIVER_ID[k] >= 0 ? 4 : 3; continue; }
  if (H[k] < 0 && (COASTD[k] < 60 || H[k] < -0.05)) {
    // any cell below sea level that is connected to the sea; inland depressions below 0 are rare (checked below)
    WTYPE[k] = LAGOON[k] > 0.3 && H[k] > -3.5 ? 2 : 1; WATER[k] = 0; continue;
  }
  if (wetSDF(x, z) < 0 && H[k] < S.WETLAND.level) { WTYPE[k] = 5; WATER[k] = S.WETLAND.level; }
}
const SLOPE = new Float32Array(N * N); // degrees
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const a = H[idx(Math.max(0, i - 1), j)], b = H[idx(Math.min(N - 1, i + 1), j)], c = H[idx(i, Math.max(0, j - 1))], d = H[idx(i, Math.min(N - 1, j + 1))];
  const gx = (b - a) / (2 * STEP), gz = (d - c) / (2 * STEP);
  SLOPE[idx(i, j)] = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
}

// ================================================================== 13. regions + biomes (per sample)
log('regions + biomes');
const REG_SDF = S.REGIONS.map((r) => r.circle ? ((x, z) => Math.hypot(x - r.circle[0], z - r.circle[1]) - r.circle[2]) : makePolySDF(r.plateau ? S.PLATEAUS.find((p) => p.id === r.plateau).poly : r.poly));
export function regionIndexAt(x, z) {
  let best = -1, bd = Infinity;
  for (let r = 0; r < S.REGIONS.length; r++) { const d = REG_SDF[r](x, z); if (d <= 0) return r; if (d < bd) { bd = d; best = r; } }
  return best;
}
const REGION = new Uint8Array(N * N), BIOME = new Uint8Array(N * N);
const BIO_KEYS = Object.keys(S.BIOMES);
const bi = (c) => BIO_KEYS.indexOf(c);
for (let k = 0; k < N * N; k++) {
  const i = k % N, j = (k / N) | 0, x = X(i), z = Z(j);
  const ri = regionIndexAt(x, z); REGION[k] = ri;
  const R = S.REGIONS[ri], h = H[k], w = WTYPE[k];
  let b = R.biome;
  if (w === 1) b = 'Q'; else if (w === 2) b = 'U'; else if (w === 3 || w === 4) b = 'Z'; else if (w === 6) b = 'Y';
  else {
    if (R.id === 'givreval' || R.id === 'couronne') b = h > 262 ? 'S' : h > 212 ? 'R' : 'F';
    if (R.id === 'cendres' || R.id === 'coeur_brasier') b = h > 150 || R.id === 'coeur_brasier' ? 'V' : (fbm2(x / 200, z / 200, 5, 2) > 0.5 ? 'V' : 'M');
    if (R.id === 'sylve' && h > 200) b = 'R';
    if (R.id === 'mordore' && x < -1000 && z < -1100) b = 'F';
    if ((R.id === 'sable_rouge' || R.id === 'mer_dunes')) {
      for (const L of S.LAKES) if (L.id.startsWith('oasis') && inEllipse(x, z, L.x, L.z, L.rx * 2.2, L.rz * 2.2) < 1) b = 'T';
      if (SLOPE[k] > 35) b = 'H';
    }
    if (COASTD[k] >= 0 && COASTD[k] < 55 && h < 5 && cliffAt(x, z) < 0.5) b = 'B';
    if (SLOPE[k] > 48 && b !== 'S') b = R.id === 'rougecrete' || R.id === 'sable_rouge' || R.id === 'entaille' ? 'C' : 'R';
  }
  BIOME[k] = bi(b);
}

// ================================================================== 14. validation: reachability + traversal times
log('reachability');
const TAN40 = Math.tan((40 * Math.PI) / 180);
const WADE = 0.8;
const walkable = (k) => BRIDGE[k] || ROAD_D[k] < 2 || (WTYPE[k] === 0 || (WTYPE[k] !== 6 && WATER[k] - H[k] <= WADE));
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
const inPlay = (i, j) => { const x = X(i), z = Z(j); return x >= S.PLAYABLE.x0 && x <= S.PLAYABLE.x1 && z >= S.PLAYABLE.z0 && z <= S.PLAYABLE.z1; };
function dijkstra(sx, sz) {
  const cost = new Float64Array(N * N).fill(Infinity), dist = new Float64Array(N * N).fill(Infinity);
  const si = Math.round((sx - X0) / STEP), sj = Math.round((sz - Z0) / STEP), s = idx(si, sj);
  cost[s] = 0; dist[s] = 0;
  // binary heap
  const hk = [], hv = [];
  const push = (k, v) => { hk.push(k); hv.push(v); let c = hk.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (hv[p] <= hv[c]) break; [hk[p], hk[c]] = [hk[c], hk[p]]; [hv[p], hv[c]] = [hv[c], hv[p]]; c = p; } };
  const pop = () => { const k = hk[0], v = hv[0]; const lk = hk.pop(), lv = hv.pop(); if (hk.length) { hk[0] = lk; hv[0] = lv; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < hk.length && hv[l] < hv[m]) m = l; if (r < hk.length && hv[r] < hv[m]) m = r; if (m === c) break; [hk[m], hk[c]] = [hk[c], hk[m]]; [hv[m], hv[c]] = [hv[c], hv[m]]; c = m; } } return [k, v]; };
  push(s, 0);
  while (hk.length) {
    const [k, v] = pop(); if (v > cost[k]) continue;
    const i = k % N, j = (k / N) | 0;
    for (const [di, dj, m] of DIRS) {
      const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N || !inPlay(ni, nj)) continue;
      const nk = idx(ni, nj); if (!walkable(nk)) continue;
      const run = m * STEP, rise = H[nk] - H[k], sl = Math.abs(rise) / run;
      if (sl > TAN40 && !(BRIDGE[nk] && BRIDGE[k])) continue;
      const up = Math.max(0, rise / run);
      const speedF = Math.max(0.45, 1 - 1.1 * up - 0.3 * Math.max(0, -rise / run - 0.25)) * (ROAD_D[nk] < 5 ? 1.0 : 0.92);
      const nc = v + run / speedF;
      if (nc < cost[nk]) { cost[nk] = nc; dist[nk] = dist[k] + run; push(nk, nc); }
    }
  }
  return { cost, dist };
}
const POIS = [
  ...S.TOWNS.map((t) => ({ id: t.id, name: t.name, x: t.x, z: t.z, kind: 'ville' })),
  ...S.OUTPOSTS.map((t) => ({ id: t.id, name: t.name, x: t.x, z: t.z, kind: 'avant-poste' })),
  ...S.WAYPOINTS.map(([id, name, x, z]) => ({ id, name, x, z, kind: 'waypoint' })),
  ...S.DUNGEONS.map(([id, name, x, z]) => ({ id, name, x, z, kind: 'donjon' })),
];
const poiCell = (p) => idx(Math.round((p.x - X0) / STEP), Math.round((p.z - Z0) / STEP));
const RUN = 6.5, SPRINT_CYCLE = (() => { const sp = RUN * 1.45, tS = 100 / 18, tR = 0.8 + 100 / 35; return (sp * tS + RUN * tR) / (tS + tR); })(), MOUNT_SPEED = 14;
const HUBS = QUICK ? ['brumeval'] : ['brumeval', 'port_salin', 'ambresable', 'rochegivre', 'clairsaule'];
const TRAVEL = {}; const unreachable = [];
for (const hub of HUBS) {
  const T = S.TOWNS.find((t) => t.id === hub);
  const { cost, dist } = dijkstra(T.x, T.z);
  { let c = 0; for (let k = 0; k < N * N; k++) if (isFinite(cost[k])) c++; log("reached cells", c); }
  TRAVEL[hub] = {};
  for (const p of POIS) {
    // nearest walkable cell within 15 m of the POI
    let bestC = Infinity, bestD = Infinity;
    const pi = Math.round((p.x - X0) / STEP), pj = Math.round((p.z - Z0) / STEP);
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const kk = idx(clamp(pi + di, 0, N - 1), clamp(pj + dj, 0, N - 1)); if (cost[kk] < bestC) { bestC = cost[kk]; bestD = dist[kk]; } }
    const straight = Math.hypot(p.x - T.x, p.z - T.z);
    if (!isFinite(bestC)) { if (hub === 'brumeval') unreachable.push(p); TRAVEL[hub][p.id] = { straight: Math.round(straight), reachable: false }; continue; }
    TRAVEL[hub][p.id] = { straight: Math.round(straight), path: Math.round(bestD), walkMin: +(bestC / RUN / 60).toFixed(1), sprintMin: +(bestC / SPRINT_CYCLE / 60).toFixed(1), mountMin: +(bestD / MOUNT_SPEED / 60).toFixed(1) };
  }
  log('dijkstra', hub, 'done');
}
// share of playable land that is walkable & reachable from Brumeval

// ================================================================== 15. measured summits and passes
function measurePeak(px, pz, r = 120) {
  let best = -Infinity, bx = px, bz = pz;
  forBox(px - r, pz - r, px + r, pz + r, (i, j, x, z, k) => { if (H[k] > best) { best = H[k]; bx = x; bz = z; } });
  return { h: +best.toFixed(0), x: Math.round(bx), z: Math.round(bz) };
}
const PEAKS_OUT = S.PEAKS.map(([id, name, x, z]) => ({ id, name, ...measurePeak(x, z, 140) }));
PEAKS_OUT.push({ id: 'brasier', name: S.VOLCANO.name, ...measurePeak(S.VOLCANO.x, S.VOLCANO.z, 200) });
for (const Mz of S.MESAS) if (Mz[1]) PEAKS_OUT.push({ id: Mz[0], name: Mz[1], ...measurePeak(Mz[2], Mz[3], Mz[4]), mesa: true });
const PASSES_OUT = S.PASSES.map(([id, name, x, z]) => ({ id, name, x, z, h: +sampleH(x, z).toFixed(0) }));

// ================================================================== 16. control map (32 m cells)
log('control map');
const CC = S.CONTROL_CELL, CN = Math.round((S.GRID.x1 - X0) / CC); // 144
const ctrl = { cell: CC, cols: CN, rows: CN, x0: X0, z0: Z0, biome: [], region: [], elev: [], water: [], net: [] };
const REG_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
for (let cj = 0; cj < CN; cj++) {
  let bRow = '', rRow = '', wRow = '', nRow = ''; const eRow = [];
  for (let ci = 0; ci < CN; ci++) {
    const xa = X0 + ci * CC, za = Z0 + cj * CC;
    const cnt = {}, wc = [0, 0, 0, 0, 0, 0, 0]; let s = 0, n = 0, road = 0, bridge = 0, river = 0, rcnt = {};
    forBox(xa + 0.1, za + 0.1, xa + CC - 0.1, za + CC - 0.1, (i, j, x, z, k) => {
      if (x < xa || x >= xa + CC || z < za || z >= za + CC) return;
      s += H[k]; n++; cnt[BIOME[k]] = (cnt[BIOME[k]] || 0) + 1; wc[WTYPE[k]]++; rcnt[REGION[k]] = (rcnt[REGION[k]] || 0) + 1;
      if (ROAD_D[k] < 4) road = 1; if (BRIDGE[k]) bridge = 1; if (RIVER_ID[k] >= 0 && RIVER_D[k] < 12) river = 1;
    });
    const top = (o) => +Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];
    bRow += BIO_KEYS[top(cnt)];
    rRow += REG_CHARS[top(rcnt)];
    eRow.push(Math.round(s / n));
    let wi = 0, wm = 0; for (let q = 1; q < 7; q++) if (wc[q] > wm) { wm = wc[q]; wi = q; }
    wRow += wm > n * 0.33 ? String(wi) : '0';
    nRow += String(road | (river << 1) | (bridge << 2));
  }
  ctrl.biome.push(bRow); ctrl.region.push(rRow); ctrl.elev.push(eRow); ctrl.water.push(wRow); ctrl.net.push(nRow);
}

// ================================================================== 17. stats per region
const regStats = S.REGIONS.map(() => ({ cells: 0, land: 0, sumH: 0, minH: Infinity, maxH: -Infinity, walk: 0, bb: [Infinity, Infinity, -Infinity, -Infinity] }));
const slopeHist = [0, 0, 0, 0, 0];
for (let k = 0; k < N * N; k++) {
  const i = k % N, j = (k / N) | 0; if (!inPlay(i, j)) continue;
  const st = regStats[REGION[k]]; st.cells++;
  const x = X(i), z = Z(j);
  st.bb[0] = Math.min(st.bb[0], x); st.bb[1] = Math.min(st.bb[1], z); st.bb[2] = Math.max(st.bb[2], x); st.bb[3] = Math.max(st.bb[3], z);
  if (WTYPE[k] === 0) {
    st.land++; st.sumH += H[k]; st.minH = Math.min(st.minH, H[k]); st.maxH = Math.max(st.maxH, H[k]);
    const s = SLOPE[k]; if (s < 40) st.walk++;
    slopeHist[s < 10 ? 0 : s < 25 ? 1 : s < 40 ? 2 : s < 55 ? 3 : 4]++;
  }
}

// ================================================================== outputs
log('writing outputs');
let hmin = Infinity, hmax = -Infinity;
const U16 = new Uint16Array(N * N);
for (let k = 0; k < N * N; k++) { const h = H[k]; hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); U16[k] = clamp(Math.round((h - S.HEIGHT_CODE.offset) / S.HEIGHT_CODE.scale), 0, 65535); }
fs.writeFileSync(path.join(OUT, 'heightmap.png'), encodeGray16(N, N, U16, { Title: 'Brumeval heightmap v0.3 draft', Comment: 'metres = value*0.01 - 60 ; sample (i,j) at x=-2304+4.5i, z=-2808+4.5j' }));
const meta = {
  format: 'PNG 16-bit grayscale, row-major, row 0 = north (z0)',
  width: N, height: N, metresPerSample: STEP, x0: X0, z0: Z0, x1: S.GRID.x1, z1: S.GRID.z1,
  decode: 'height_m = value * 0.01 - 60', seaLevel: 0, minHeight: +hmin.toFixed(2), maxHeight: +hmax.toFixed(2),
  playable: S.PLAYABLE, brumevalSample: [Math.round(-X0 / STEP), Math.round(-Z0 / STEP)],
  legacy: { square: [-S.LEGACY.half, S.LEGACY.half], keepExact: S.LEGACY.keep, blendTo: S.LEGACY.blendTo, lift: S.LEGACY.lift,
    rule: 'w = 1 - smoothstep(170, 450, max(|x|, |z|, 0.8*hypot(x,z))); height = lerp(heightmap, legacyHeight(x,z) + 45, w). Inside |x|,|z| <= 160 (the old WORLD_LIMIT) w >= 0.99.' },
  generator: 'docs/world/drafts/tools/gen_world.mjs (deterministic, seed ' + SEED + ')',
};
fs.writeFileSync(path.join(OUT, 'heightmap.json'), JSON.stringify(meta, null, 2));

const km2 = (cells) => +(cells * STEP * STEP / 1e6).toFixed(2);
const carto = {
  version: 'v0.3-draft-1',
  frame: { north: '-z', units: 'm', grid: S.GRID, playable: S.PLAYABLE, seaLevel: 0, heightmap: 'heightmap.png (+ heightmap.json)', brumeval: [0, 0] },
  biomes: S.BIOMES,
  regions: S.REGIONS.map((r, i) => ({
    id: r.id, char: REG_CHARS[i], name: r.name, biome: r.biome, biomeName: S.BIOMES[r.biome], levels: r.lv, danger: r.danger, tier: r.tier,
    shape: r.circle ? { circle: r.circle } : r.plateau ? { polygon: S.PLATEAUS.find((p) => p.id === r.plateau).poly } : { polygon: r.poly },
    bbox: regStats[i].bb.map((v) => Math.round(v)), areaKm2: km2(regStats[i].cells), landKm2: km2(regStats[i].land),
    elevation: regStats[i].land ? { min: Math.round(regStats[i].minH), mean: Math.round(regStats[i].sumH / regStats[i].land), max: Math.round(regStats[i].maxH) } : null,
    walkableLandPct: regStats[i].land ? Math.round((100 * regStats[i].walk) / regStats[i].land) : null,
    landmarks: r.landmarks,
  })),
  redZones: S.REGIONS.filter((r) => r.danger === 'rouge').map((r) => r.id),
  towns: S.TOWNS.map((t) => ({ id: t.id, name: t.name, kind: t.kind, x: t.x, z: t.z, y: t.h, safeRadius: t.r, danger: 'vert' })),
  outposts: S.OUTPOSTS.map((o) => ({ id: o.id, name: o.name, x: o.x, z: o.z, y: o.h })),
  landmarks: S.LANDMARKS.map((l) => ({ id: l.id, name: l.name, x: l.x, z: l.z, y: l.h, note: l.note })),
  waypoints: S.WAYPOINTS.map(([id, name, x, z]) => ({ id, name, x, z, y: +sampleH(x, z).toFixed(1), region: S.REGIONS[regionIndexAt(x, z)].id })),
  dungeons: S.DUNGEONS.map(([id, name, x, z, note]) => ({ id, name, x, z, y: +sampleH(x, z).toFixed(1), region: S.REGIONS[regionIndexAt(x, z)].id, note })),
  peaks: PEAKS_OUT, passes: PASSES_OUT,
  volcano: { ...S.VOLCANO, rim: Math.round(S.VOLCANO._rim), craterFloor: Math.round(S.VOLCANO._floor) },
  ranges: S.RIDGES.map((r) => ({ id: r.id, name: r.name, crest: r.pts })),
  plateaus: S.PLATEAUS.map((p) => ({ id: p.id, name: p.name, top: p.top, cliff: p.edge, polygon: p.poly })),
  mesas: S.MESAS.map(([id, name, x, z, r, h]) => ({ id, name, x, z, r, top: h })),
  lakes: S.LAKES.map((l) => ({ id: l.id, name: l.name, x: l.x, z: l.z, rx: l.rx, rz: l.rz, level: l.level, depth: l.depth, lava: !!l.lava, leakCells: l._leakCells })),
  wetland: { ...S.WETLAND },
  rivers: S.RIVERS.map((r, ri) => {
    const P = RIVER_PROFILES[ri];
    const every = Math.max(1, Math.round(60 / 3));
    const prof = []; for (let q = 0; q < P.samples.length; q += every) prof.push([Math.round(P.samples[q][0]), Math.round(P.samples[q][1]), +(P.beds[q] + r.depth).toFixed(1)]);
    const last = P.samples.length - 1; prof.push([Math.round(P.samples[last][0]), Math.round(P.samples[last][1]), +(P.beds[last] + r.depth).toFixed(1)]);
    return { id: r.id, name: r.name, type: r.type, width: r.width, depth: r.depth, wadeable: r.depth <= WADE, length: Math.round(P.Ls), source: prof[0], mouth: prof[prof.length - 1], surfaceProfile: prof };
  }),
  waterfalls: S.WATERFALLS.map(([id, name, x, z, top, bottom]) => ({ id, name, x, z, top, bottom })),
  coast: { landPolygon: S.COAST, noise: 'COASTD = -sdf + (fbm(x/260)-0.5)*110 + (fbm(x/60)-0.5)*22', cliffs: S.COAST_CLIFFS, lagoons: S.LAGOONS, islands: S.ISLANDS.map(([id, name, x, z, r, h, c]) => ({ id, name, x, z, r, summit: h, cliff: c })), sandbars: S.SANDBARS },
  roads: S.ROADS.map((r) => ({ ...r, ...(ROAD_INFO.find((q) => q.id === r.id) || {}) })),
  travel: { speeds: { run: RUN, sprintCycleAvg: +SPRINT_CYCLE.toFixed(2), mountV04: MOUNT_SPEED }, fromHubs: TRAVEL, unreachableFromBrumeval: unreachable.map((p) => p.id) },
  slopeRules: { walkableMaxDeg: 40, cliffDeg: 55, wadeMaxDepth: WADE, histogramPlayableLand: { '<10°': slopeHist[0], '10-25°': slopeHist[1], '25-40°': slopeHist[2], '40-55°': slopeHist[3], '>55°': slopeHist[4] } },
  controlMap: {
    doc: 'rows north→south, one char per 32 m cell. biome: see biomes; region: char → regions[].char; elev: mean metres; water: 0 dry 1 sea 2 lagoon 3 lake 4 river 5 wetland pond 6 lava (majority > 1/3 of the cell); net bitmask: 1 road, 2 river, 4 bridge',
    ...ctrl,
  },
};
fs.writeFileSync(path.join(OUT, 'carto.json'), JSON.stringify(carto));
log('heights', hmin.toFixed(1), '..', hmax.toFixed(1));
log('unreachable from Brumeval:', unreachable.map((p) => p.id).join(', ') || 'none');
console.log('peaks', PEAKS_OUT.map((p) => `${p.name} ${p.h}`).join(' | '));
console.log('passes', PASSES_OUT.map((p) => `${p.name} ${p.h}`).join(' | '));
console.log('lakes', S.LAKES.map((l) => `${l.id}@${l.level} leak=${l._leakCells}`).join(' | '));
console.log('roads', ROAD_INFO.map((r) => `${r.id} L${r.length} g${r.maxGradePct} cut${r.maxCut} fill${r.maxFill} br${(r.bridges || []).length} worst ${JSON.stringify(S.ROADS.find((q) => q.id === r.id)._worst)}`).join('\n  '));
console.log('slope hist', slopeHist);
console.log('regions', carto.regions.map((r) => `${r.id} ${r.areaKm2}km² h${r.elevation?.mean} walk${r.walkableLandPct}%`).join(' | '));
console.log('brumeval travel', Object.entries(TRAVEL.brumeval).map(([k, v]) => `${k}:${v.walkMin ?? 'X'}`).join(' '));

if (!ARGS.has('--no-render')) {
  renderTopo({ S, N, STEP, X0, Z0, H, WTYPE, WATER, BIOME, BIO_KEYS, REGION, SLOPE, ROAD_D, BRIDGE, RIVER_D, PEAKS_OUT, PASSES_OUT, OUT, OUT_TOOLS, sampleH, regionIndexAt, unreachable, QUICK });
  log('topo rendered');
}
