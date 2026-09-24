// Brumeval Online v0.3 — rendu de la carte du monde (docs/world/carte_monde.png).
// Entrées : docs/world/heightmap.png (16 bits) + docs/world/world_layout.json.  Aucune dépendance externe (PNG via node:zlib).
// Usage (racine du dépôt) : node docs/world/tools/render_map.mjs [--size 2400] [--out docs/world/carte_monde.png] [--grid]
//   --grid : ajoute une grille de coordonnées tous les 250 m (outil de relecture, pas pour la carte finale).
// Rendu : teintes de biome + teinte hypsométrique, ombrage du relief (lumière nord-ouest), courbes tous les 10 m (50 m en gras),
// mers/lagons/lacs/lave selon la profondeur, rivières, routes et sentiers, symboles (forêts, pins, palmiers, dunes, roseaux),
// zones rouges hachurées, noms de régions, villes, pierres, donjons, sommets, boss, cartouche (légende, échelle, nord).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGray16, encodeRGB } from './png.mjs';
import { GLYPHS, ACCENTS, MARKS } from './font.mjs';
import { fbm2, hash2i, smoothstep, clamp } from '../../../shared/noise.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLD = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SIZE = +arg('--size', 2400);
const OUT = path.resolve(arg('--out', path.join(WORLD, 'carte_monde.png')));
const GRID = argv.includes('--grid');

const L = JSON.parse(fs.readFileSync(path.join(WORLD, 'world_layout.json'), 'utf8'));
const meta = L.frame.heightmapMeta;
const { w: N, data: U16 } = decodeGray16(fs.readFileSync(path.join(WORLD, 'heightmap.png')));
const HS = new Float32Array(N * N); for (let k = 0; k < N * N; k++) HS[k] = U16[k] * 0.01 - 60;
const STEP = meta.metresPerSample, GX0 = meta.x0, GZ0 = meta.z0, SPAN = (N - 1) * STEP;
const P = L.frame.playable;

// ------------------------------------------------------------------ cadre de l'image
const W = SIZE, MAPH = SIZE, LEG = Math.round(SIZE * 0.1), H = MAPH + LEG;
const MPP = SPAN / SIZE;                        // mètres par pixel
const PX = (x) => (x - GX0) / MPP, PY = (z) => (z - GZ0) / MPP;
const WX = (px) => GX0 + (px + 0.5) * MPP, WZ = (py) => GZ0 + (py + 0.5) * MPP;
const S = SIZE / 2400;                          // facteur d'échelle des symboles et du texte

// ------------------------------------------------------------------ terrain échantillonné
function hAt(x, z) {
  const gi = clamp((x - GX0) / STEP, 0, N - 1.001), gj = clamp((z - GZ0) / STEP, 0, N - 1.001);
  const i = gi | 0, j = gj | 0, fx = gi - i, fz = gj - j, k = j * N + i;
  const a = HS[k], b = HS[k + 1], c = HS[k + N], d = HS[k + N + 1];
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}
const cm = L.controlMap;
const cmAt = (grid, x, z) => { const c = clamp(Math.floor((x - cm.x0) / cm.cell), 0, cm.cols - 1), r = clamp(Math.floor((z - cm.z0) / cm.cell), 0, cm.rows - 1); return grid[r][c]; };
const regionByChar = Object.fromEntries(L.regions.map((r) => [r.char, r]));
const hex = (s) => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Teintes cartographiques des biomes (bible visuelle, un peu adoucies pour la lecture).
const BIOME_MAP = {
  G: '#86b458', O: '#cdb45a', M: '#b9aa66', A: '#cfb66a', F: '#4f8a3e', L: '#4a7a66', S: '#eef2f6', R: '#a39d92', V: '#5a524e',
  W: '#6f8150', H: '#c9804c', C: '#b0674a', D: '#e6bf7e', T: '#8cbc62', K: '#98a070', B: '#eadcb4', Q: '#e2d6ae', U: '#e8dcb4', Z: '#8fb35e', Y: '#5a524e',
};
const BC = Object.fromEntries(Object.entries(BIOME_MAP).map(([k, v]) => [k, hex(v)]));
const PARCH = hex('#efe4c6');
// Champ de couleur des biomes : moyenne gaussienne (σ = 55 m) des cellules de 32 m sur une grille de 16 m,
// puis lecture bilinéaire à des coordonnées déformées par un bruit (bords organiques, pas de marches de 32 m).
const FC = 16, FN = Math.ceil(SPAN / FC) + 1, FIELD = new Float32Array(FN * FN * 3);
{
  const sig = 55, R = Math.ceil((2.5 * sig) / cm.cell);
  for (let fj = 0; fj < FN; fj++) for (let fi = 0; fi < FN; fi++) {
    const x = GX0 + fi * FC, z = GZ0 + fj * FC, c0 = Math.floor((x - cm.x0) / cm.cell), r0 = Math.floor((z - cm.z0) / cm.cell);
    let a = 0, b = 0, c = 0, wsum = 0;
    for (let r = r0 - R; r <= r0 + R; r++) for (let cc = c0 - R; cc <= c0 + R; cc++) {
      const rr = clamp(r, 0, cm.rows - 1), ccc = clamp(cc, 0, cm.cols - 1);
      const cx = cm.x0 + (cc + 0.5) * cm.cell, cz = cm.z0 + (r + 0.5) * cm.cell, w = Math.exp(-((cx - x) ** 2 + (cz - z) ** 2) / (2 * sig * sig));
      const col = BC[cm.biome[rr][ccc]] || BC.G; a += col[0] * w; b += col[1] * w; c += col[2] * w; wsum += w;
    }
    const o = (fj * FN + fi) * 3; FIELD[o] = a / wsum; FIELD[o + 1] = b / wsum; FIELD[o + 2] = c / wsum;
  }
}
function biomeColor(x, z) {
  const wx = x + (fbm2(x * 0.004, z * 0.004, 11, 3) - 0.5) * 220 + (fbm2(x * 0.02, z * 0.02, 13, 2) - 0.5) * 50;
  const wz = z + (fbm2(x * 0.004, z * 0.004, 29, 3) - 0.5) * 220 + (fbm2(x * 0.02, z * 0.02, 31, 2) - 0.5) * 50;
  const gi = clamp((wx - GX0) / FC, 0, FN - 1.001), gj = clamp((wz - GZ0) / FC, 0, FN - 1.001), i = gi | 0, j = gj | 0, fx = gi - i, fz = gj - j;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) { const k = (j * FN + i) * 3 + c; out[c] = (FIELD[k] * (1 - fx) + FIELD[k + 3] * fx) * (1 - fz) + (FIELD[k + FN * 3] * (1 - fx) + FIELD[k + FN * 3 + 3] * fx) * fz; }
  return out;
}

// ------------------------------------------------------------------ surfaces d'eau (mer, lacs, lave, étangs du marais)
const inPoly = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const HPX = new Float32Array(W * MAPH), WS = new Float32Array(W * MAPH).fill(-Infinity), WKIND = new Uint8Array(W * MAPH); // 1 mer 2 lac 3 lave 4 étang
for (let py = 0; py < MAPH; py++) for (let px = 0; px < W; px++) { const k = py * W + px, h = hAt(WX(px), WZ(py)); HPX[k] = h; if (h < 0) { WS[k] = 0; WKIND[k] = 1; } }
const pxBox = (x0, z0, x1, z1, fn) => { for (let py = Math.max(0, Math.floor(PY(z0))); py <= Math.min(MAPH - 1, Math.ceil(PY(z1))); py++) for (let px = Math.max(0, Math.floor(PX(x0))); px <= Math.min(W - 1, Math.ceil(PX(x1))); px++) fn(py * W + px, WX(px), WZ(py)); };
for (const lk of L.lakes) pxBox(lk.x - lk.rx * 1.35, lk.z - lk.rz * 1.35, lk.x + lk.rx * 1.35, lk.z + lk.rz * 1.35, (k, x, z) => {
  if (HPX[k] < lk.level && ((x - lk.x) / lk.rx) ** 2 + ((z - lk.z) / lk.rz) ** 2 < 1.8 && lk.level > WS[k]) { WS[k] = lk.level; WKIND[k] = lk.lava ? 3 : 2; }
});
if (L.wetland) { const xs = L.wetland.poly.map((p) => p[0]), zs = L.wetland.poly.map((p) => p[1]);
  pxBox(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), (k, x, z) => { if (HPX[k] < L.wetland.level && WS[k] < L.wetland.level && inPoly(x, z, L.wetland.poly)) { WS[k] = L.wetland.level; WKIND[k] = 4; } }); }
const isWater = (k) => WKIND[k] > 0 && WS[k] - HPX[k] > 0.05;

// ------------------------------------------------------------------ image (flottants 0..1)
const IMG = new Float32Array(W * H * 3);
const setPx = (k, c) => { IMG[k * 3] = c[0]; IMG[k * 3 + 1] = c[1]; IMG[k * 3 + 2] = c[2]; };
const blendPx = (px, py, c, a) => { if (px < 0 || py < 0 || px >= W || py >= H || a <= 0) return; const o = (py * W + px) * 3; IMG[o] += (c[0] - IMG[o]) * a; IMG[o + 1] += (c[1] - IMG[o + 1]) * a; IMG[o + 2] += (c[2] - IMG[o + 2]) * a; };

const SEA_RAMP = [[0, hex('#9be6d6')], [1.5, hex('#58d0c8')], [4, hex('#34b3c4')], [9, hex('#2688b4')], [18, hex('#1f6a9c')], [40, hex('#194a78')]];
const LAKE_RAMP = [[0, hex('#8cd0d6')], [2, hex('#5aaec4')], [6, hex('#3d8cb0')], [14, hex('#2f6f98')]];
const ramp = (R, v) => { if (v <= R[0][0]) return R[0][1]; for (let i = 1; i < R.length; i++) if (v <= R[i][0]) return mix(R[i - 1][1], R[i][1], (v - R[i - 1][0]) / (R[i][0] - R[i - 1][0])); return R.at(-1)[1]; };
const ROCK_GREY = hex('#8e877c'), ROCK_RED = hex('#9c5a3e'), ROCK_ICE = hex('#a7b0bb'), ROCK_DARK = hex('#4a4240'), SAND = hex('#ecdcae'), LAVA = hex('#ff6a1a'), CRUST = hex('#3a2a26');
const LX = -0.62, LY = 0.72, LZ = -0.45, LN = Math.hypot(LX, LY, LZ);   // lumière nord-ouest
const EX = 2.4;                                                          // exagération verticale de l'ombrage

const SLOPE = new Float32Array(W * MAPH);
for (let py = 0; py < MAPH; py++) for (let px = 0; px < W; px++) {
  const k = py * W + px, x = WX(px), z = WZ(py), h = HPX[k];
  const e = 3;                                            // dérivées sur ±3 m environ (lisse l'ombrage)
  const dx = (hAt(x + e, z) - hAt(x - e, z)) / (2 * e), dz = (hAt(x, z + e) - hAt(x, z - e)) / (2 * e);
  SLOPE[k] = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
  const nx = -dx * EX, nz = -dz * EX, nn = Math.hypot(nx, 1, nz);
  const shade = clamp((nx * LX + LY + nz * LZ) / (nn * LN), 0, 1);
  let c;
  if (isWater(k)) {
    const d = WS[k] - h;
    if (WKIND[k] === 3) { const n = fbm2(x * 0.08, z * 0.08, 5, 3); c = mix(LAVA, CRUST, smoothstep(0.45, 0.7, n)); }
    else if (WKIND[k] === 1) c = mix(ramp(SEA_RAMP, d), [0.05, 0.12, 0.2], 0.0), c = c.map((v) => v * (0.9 + 0.16 * shade));
    else c = ramp(LAKE_RAMP, d).map((v) => v * (0.94 + 0.1 * shade));
  } else {
    c = biomeColor(x, z);
    const base = c;
    c = mix(c, PARCH, 0.12);
    // teinte hypsométrique : les hauteurs éclaircissent légèrement
    c = mix(c, hex('#f1ead8'), smoothstep(150, 420, h) * 0.35);
    // grain de sol (variation de 4 %)
    const g = (fbm2(x * 0.05, z * 0.05, 3, 3) - 0.5) * 0.09; c = c.map((v) => v * (1 + g));
    // plages et rivages (pas dans le marais)
    if (h < 2.4 && !(L.wetland && inPoly(x, z, L.wetland.poly))) c = mix(c, SAND, smoothstep(2.4, 0.8, h));
    // roche sur les pentes fortes : teinte tirée du biome (roche rouge à l'ouest, basalte au volcan, roche claire au nord)
    const s = SLOPE[k];
    const rock = mix(base.map((v) => v * 0.72), ROCK_GREY, 0.45);
    c = mix(c, rock, smoothstep(30, 48, s) * 0.85);
    // neige des sommets du nord-ouest (au-dessus de 300 m)
    const north = smoothstep(-300, -900, x) * smoothstep(-1300, -1800, z);
    c = mix(c, hex('#f4f7fa'), smoothstep(290, 340, h) * north * (1 - smoothstep(40, 60, s) * 0.6));
    c = c.map((v) => v * (0.38 + 0.86 * shade));
  }
  setPx(k, c);
}
// écume du rivage et lignes de hauts-fonds (façon carte ancienne)
for (let py = 1; py < MAPH - 1; py++) for (let px = 1; px < W - 1; px++) {
  const k = py * W + px; if (!isWater(k) || WKIND[k] === 3) continue;
  const nb = [k - 1, k + 1, k - W, k + W]; let land = 0; for (const q of nb) if (!isWater(q)) land++;
  if (land) { blendPx(px, py, [0.97, 0.98, 0.95], 0.7); continue; }
  if (WKIND[k] === 1) { const d = WS[k] - HPX[k]; for (const lv of [2.5, 7, 16]) { const dn = WS[k + 1] - HPX[k + 1], dd = WS[k + W] - HPX[k + W]; if ((d < lv) !== (dn < lv) || (d < lv) !== (dd < lv)) blendPx(px, py, [0.9, 0.97, 1], lv < 5 ? 0.38 : 0.2); } }
}
// courbes de niveau : 10 m fines, 50 m appuyées
for (let py = 0; py < MAPH - 1; py++) for (let px = 0; px < W - 1; px++) {
  const k = py * W + px; if (isWater(k)) continue;
  const h = HPX[k], hr = HPX[k + 1], hd = HPX[k + W];
  const cross = (step) => Math.floor(h / step) !== Math.floor(hr / step) || Math.floor(h / step) !== Math.floor(hd / step);
  if (cross(50)) blendPx(px, py, [0.22, 0.16, 0.1], 0.34);
  else if (cross(10) && SLOPE[k] < 42) blendPx(px, py, [0.25, 0.19, 0.12], 0.13);
}
// hors de la zone jouable : assombri et désaturé (murailles et haute mer)
for (let py = 0; py < MAPH; py++) for (let px = 0; px < W; px++) {
  const x = WX(px), z = WZ(py); const dOut = Math.max(P.x0 - x, x - P.x1, P.z0 - z, z - P.z1);
  if (dOut <= -20) continue; const t = smoothstep(-20, 60, dOut) * 0.45; const o = (py * W + px) * 3;
  const lum = 0.3 * IMG[o] + 0.59 * IMG[o + 1] + 0.11 * IMG[o + 2];
  for (let c = 0; c < 3; c++) IMG[o + c] = (IMG[o + c] + (lum * 0.8 - IMG[o + c]) * t) * (1 - t * 0.35);
}

// ------------------------------------------------------------------ primitives vectorielles anticrénelées (masque de couverture)
const MASK = new Float32Array(W * H); let touched = [];
const cover = (px, py, a) => { if (px < 0 || py < 0 || px >= W || py >= H) return; const k = py * W + px; if (MASK[k] === 0) touched.push(k); if (a > MASK[k]) MASK[k] = a; };
function capsule(ax, ay, bx, by, r) {
  const x0 = Math.floor(Math.min(ax, bx) - r - 1), x1 = Math.ceil(Math.max(ax, bx) + r + 1), y0 = Math.floor(Math.min(ay, by) - r - 1), y1 = Math.ceil(Math.max(ay, by) + r + 1);
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const cx = px + 0.5, cy = py + 0.5; let t = l2 ? ((cx - ax) * dx + (cy - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(cx - ax - t * dx, cy - ay - t * dy); const a = clamp(r + 0.5 - d, 0, 1); if (a > 0) cover(px, py, a);
  }
}
function polyFill(pts) { // remplissage anticrénelé par sur-échantillonnage 4×4
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  for (let py = Math.floor(Math.min(...ys)); py <= Math.ceil(Math.max(...ys)); py++) for (let px = Math.floor(Math.min(...xs)); px <= Math.ceil(Math.max(...xs)); px++) {
    let n = 0; for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inPoly(px + (sx + 0.5) / 4, py + (sy + 0.5) / 4, pts)) n++;
    if (n) cover(px, py, n / 16);
  }
}
function flush(color, alpha = 1) { const c = typeof color === 'string' ? hex(color) : color; for (const k of touched) { blendPx(k % W, (k / W) | 0, c, MASK[k] * alpha); MASK[k] = 0; } touched = []; }
function polyline(pts, r, dash) { // pts en pixels ; dash = [plein, vide] en pixels
  if (!dash) { for (let i = 0; i < pts.length - 1; i++) capsule(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r); return; }
  let on = true, left = dash[0];
  for (let i = 0; i < pts.length - 1; i++) {
    let [ax, ay] = pts[i]; const [bx, by] = pts[i + 1]; let seg = Math.hypot(bx - ax, by - ay);
    while (seg > 0) { const t = Math.min(left, seg), f = t / seg; const cx = ax + (bx - ax) * f, cy = ay + (by - ay) * f;
      if (on) capsule(ax, ay, cx, cy, r); ax = cx; ay = cy; seg -= t; left -= t; if (left <= 1e-6) { on = !on; left = on ? dash[0] : dash[1]; } }
  }
}
const disc = (x, y, r) => capsule(x, y, x, y, r);
const toPx = (pts) => pts.map((p) => [PX(p[0]), PY(p[1])]);
function chaikin(pts, n = 2) { let p = pts; for (let it = 0; it < n; it++) { const q = [p[0]]; for (let i = 0; i < p.length - 1; i++) { const [a, b] = [p[i], p[i + 1]]; q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } q.push(p.at(-1)); p = q; } return p; }

// ------------------------------------------------------------------ texte : police 5×7 tracée en traits arrondis
const glyphCells = (ch) => {
  ch = ch === '–' || ch === '—' ? '-' : ch === '·' ? '.' : ch === '’' ? "'" : ch;
  let mark = null; if (ACCENTS[ch]) { mark = ACCENTS[ch][1]; ch = ACCENTS[ch][0]; }
  const g = GLYPHS[ch] || GLYPHS[' ']; const cells = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r][c] === '1') cells.push([c, r]);
  const marks = mark && MARKS[mark] ? MARKS[mark].map(([c, r]) => [c, r]) : [];
  return { cells, marks };
};
function textStrokes(str, x, y, s, { track = 0, italic = 0 } = {}, fn) {
  let cx = x; const up = str.toUpperCase().replace(/Œ/g, 'OE');
  for (const ch of up) {
    const { cells, marks } = glyphCells(ch); const on = new Set(cells.map(([c, r]) => c + ',' + r));
    const P2 = (c, r) => [cx + c * s + s / 2 + (3.5 - r) * s * italic, y + r * s + s / 2];
    for (const [c, r] of cells) {
      let linked = false;
      for (const [dc, dr] of [[1, 0], [0, 1]]) if (on.has(c + dc + ',' + (r + dr))) { fn(P2(c, r), P2(c + dc, r + dr)); linked = true; }
      for (const [dc, dr] of [[1, 1], [-1, 1]]) if (on.has(c + dc + ',' + (r + dr)) && !on.has(c + dc + ',' + r) && !on.has(c + ',' + (r + dr))) { fn(P2(c, r), P2(c + dc, r + dr)); linked = true; }
      if (!linked && ![[-1, 0], [0, -1], [-1, -1], [1, -1]].some(([dc, dr]) => on.has(c + dc + ',' + (r + dr)))) fn(P2(c, r), P2(c, r));
    }
    for (const [c, r] of marks) fn(P2(c, r * 0.8 - 0.2), P2(c, r * 0.8 - 0.2));
    cx += 6 * s + track;
  }
}
const textW = (str, s, track = 0) => [...str.replace(/[Œœ]/g, 'OE')].length * (6 * s + track) - s - track;
/** Texte centré en (x, y) (pixels).  opt : size (px de hauteur de module), color, halo, haloW, weight, track, italic, align */
function text(str, x, y, opt = {}) {
  const s = opt.size ?? 2 * S, w = textW(str, s, opt.track || 0), h = 7 * s;
  const left = opt.align === 'left' ? x : opt.align === 'right' ? x - w : x - w / 2, top = y - h / 2;
  const rw = s * (opt.weight ?? 0.5);
  if (opt.halo !== null) { textStrokes(str, left, top, s, opt, (a, b) => capsule(a[0], a[1], b[0], b[1], rw + (opt.haloW ?? 1.6 * S))); flush(opt.halo ?? '#f6efdc', opt.haloA ?? 0.85); }
  textStrokes(str, left, top, s, opt, (a, b) => capsule(a[0], a[1], b[0], b[1], rw)); flush(opt.color ?? '#2c2118');
  return { w, h };
}

// ------------------------------------------------------------------ symboles (arbres, palmiers, dunes, roseaux)
const hash = (a, b, s) => hash2i(a, b, s);            // [0, 1)
const occupied = new Uint8Array(W * MAPH);             // routes et villes : pas de symboles dessus
function markOcc(px, py, r) { for (let y = Math.floor(py - r); y <= py + r; y++) for (let x = Math.floor(px - r); x <= px + r; x++) if (x >= 0 && y >= 0 && x < W && y < MAPH) occupied[y * W + x] = 1; }
for (const rd of L.roads) { const pts = toPx(rd.pts); for (let i = 0; i < pts.length - 1; i++) { const n = Math.ceil(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) / 2); for (let t = 0; t <= n; t++) markOcc(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t / n, 5 * S); } }
for (const rv of L.rivers) { const pts = toPx(rv.surfaceProfile); for (let i = 0; i < pts.length - 1; i++) { const n = Math.ceil(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) / 2); for (let t = 0; t <= n; t++) markOcc(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t / n, rv.width / MPP / 2 + 4 * S); } }
for (const t of [...L.towns, ...L.outposts, ...L.camps]) markOcc(PX(t.x), PY(t.z), (t.safeRadius || 25) / MPP + 6 * S);
const oases = L.lakes.filter((l) => l.id.startsWith('oasis'));
const nearOasis = (x, z) => oases.some((o) => Math.hypot(x - o.x, z - o.z) < Math.max(o.rx || 60, 60) + 170) || Math.hypot(x - L.towns.find((t) => t.id === 'ambresable').x, z - L.towns.find((t) => t.id === 'ambresable').z) < 240;
const riverDist = (x, z, ids) => { let best = Infinity; for (const rv of L.rivers) { if (ids && !ids.includes(rv.id)) continue; const p = rv.surfaceProfile; for (let i = 0; i < p.length - 1; i++) { const [ax, az] = p[i], [bx, bz] = p[i + 1]; const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = clamp(t, 0, 1); best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz)); } } return best; };

const SYM = [];   // [type, px, py, scale, variant]
const cellPx = 9 * S;
for (let gy = 0; gy < MAPH / cellPx; gy++) for (let gx = 0; gx < W / cellPx; gx++) {
  const px = (gx + 0.15 + 0.7 * hash(gx, gy, 1)) * cellPx, py = (gy + 0.15 + 0.7 * hash(gx, gy, 2)) * cellPx;
  const ip = px | 0, jp = py | 0; if (ip >= W || jp >= MAPH) continue; const k = jp * W + ip;
  if (isWater(k) || occupied[k] || SLOPE[k] > 30) continue;
  const x = WX(px), z = WZ(py), h = HPX[k]; if (x < P.x0 - 40 || x > P.x1 + 40 || z < P.z0 - 40 || z > P.z1 + 40) continue;
  const b = cmAt(cm.biome, x, z), r = hash(gx, gy, 3), v = hash(gx, gy, 4);
  const forestN = fbm2(x * 0.004, z * 0.004, 77, 3);           // bosquets : la densité varie par taches
  if (b === 'F') { if (r < 0.55 + (forestN - 0.5) * 0.9) SYM.push([h > 150 || z < -2000 ? 'pine' : 'tree', px, py, 1, v]); }
  else if (b === 'L') { if (r < 0.75) SYM.push(['tree_dark', px, py, 1, v]); }
  else if (b === 'R' || (b === 'S' && h < 300)) { if (r < 0.2 && h < 330) SYM.push(['pine', px, py, 0.9, v]); }
  else if (b === 'T' || b === 'B') { if (r < (h < 25 ? 0.16 : 0.08)) SYM.push(['palm', px, py, 1, v]); }
  else if (b === 'D' || b === 'H') { if (nearOasis(x, z) || riverDist(x, z, ['ambre', 'oued_ambre']) < 70) { if (r < 0.45) SYM.push(['palm', px, py, 1.05, v]); } else if (b === 'D' && r < 0.2 && gx % 2 === 0) SYM.push(['dune', px, py, 1, v]); else if (b === 'H' && r < 0.025) SYM.push(['cactus', px, py, 1, v]); }
  else if (b === 'W') { if (r < 0.28) SYM.push([r < 0.1 ? 'tree_swamp' : 'reed', px, py, 1, v]); }
  else if (b === 'O' || b === 'A') { if (r < 0.06 + Math.max(0, forestN - 0.55) * 0.9) SYM.push(['tree_gold', px, py, 1, v]); }
  else if (b === 'G') { if (r < 0.05 + Math.max(0, forestN - 0.55) * 1.2) SYM.push(['tree', px, py, 0.9, v]); }
  else if (b === 'M' || b === 'K') { if (r < 0.035) SYM.push(['shrub', px, py, 1, v]); }
  else if (b === 'V') { if (r < 0.03) SYM.push(['dead', px, py, 1, v]); }
}
SYM.sort((a, b) => a[2] - b[2]); const NSYM = SYM.length;
const COL = { tree: ['#3f7a33', '#6aa54a'], tree_dark: ['#2f5a4e', '#4f8373'], tree_gold: ['#c2862e', '#e8b64a'], tree_swamp: ['#4d5e36', '#6d7f4a'], pine: ['#2e5a3a', '#4c7d52'] };
for (const [type, x, y, sc, v] of SYM) {
  const s = sc * S;
  if (type === 'tree' || type === 'tree_dark' || type === 'tree_gold' || type === 'tree_swamp') {
    const r = (3.4 + v * 1.4) * s; disc(x + 1.6 * s, y + 1.8 * s, r); flush('#1d2a14', 0.28);
    disc(x, y, r); flush(COL[type][0]); disc(x - r * 0.3, y - r * 0.35, r * 0.45); flush(COL[type][1], 0.9);
  } else if (type === 'pine') {
    const hh = (7 + v * 3) * s, ww = (3.4 + v) * s;
    polyFill([[x + 1.5 * s, y + 2 * s - hh], [x + ww + 1.5 * s, y + 2 * s], [x - ww + 1.5 * s, y + 2 * s]]); flush('#1d2a14', 0.25);
    polyFill([[x, y - hh], [x + ww, y], [x - ww, y]]); flush(COL.pine[0]); polyFill([[x, y - hh], [x - ww * 0.1, y - hh * 0.2], [x - ww * 0.75, y - hh * 0.1]]); flush(COL.pine[1], 0.8);
  } else if (type === 'palm') {
    const hh = (7 + v * 3) * s, lean = (v - 0.5) * 4 * s, tx = x + lean, ty = y - hh;
    polyline([[x, y], [x + lean * 0.4, y - hh * 0.5], [tx, ty]], 0.8 * s); flush('#6b4a2a');
    for (let f = 0; f < 5; f++) { const a = -Math.PI / 2 + (f - 2) * 0.62 + (v - 0.5) * 0.3, len = (4.6 + (f % 2)) * s; polyline([[tx, ty], [tx + Math.cos(a) * len * 0.6, ty + Math.sin(a) * len * 0.6 - 0.8 * s], [tx + Math.cos(a) * len, ty + Math.sin(a) * len + 1.6 * s]], 0.9 * s); }
    flush('#2f8a3a'); disc(tx, ty, 1.1 * s); flush('#7a5a2a');
  } else if (type === 'dune') {
    const pts = []; for (let t = 0; t <= 8; t++) { const a = Math.PI * (0.15 + 0.7 * t / 8); pts.push([x + Math.cos(a) * 7 * s, y - Math.sin(a) * 3 * s + 3 * s]); }
    polyline(pts, 0.7 * s); flush('#b88a4e', 0.75);
  } else if (type === 'reed') { for (const dx of [-1.6, 0, 1.6]) polyline([[x + dx * s, y], [x + dx * s * 1.6, y - (4 + Math.abs(dx)) * s]], 0.55 * s); flush('#44552c', 0.9); }
  else if (type === 'cactus') { polyline([[x, y], [x, y - 7 * s]], 1.1 * s); polyline([[x - 3 * s, y - 5 * s], [x - 3 * s, y - 3 * s], [x, y - 3 * s]], 0.8 * s); polyline([[x + 3 * s, y - 6 * s], [x + 3 * s, y - 4 * s], [x, y - 4 * s]], 0.8 * s); flush('#4f7a3a'); }
  else if (type === 'shrub') { disc(x, y, 2.4 * s); flush('#6f7a3e', 0.85); }
  else if (type === 'dead') { polyline([[x, y], [x, y - 6 * s]], 0.6 * s); polyline([[x, y - 4 * s], [x - 2.5 * s, y - 6.5 * s]], 0.5 * s); polyline([[x, y - 3 * s], [x + 2.5 * s, y - 5 * s]], 0.5 * s); flush('#2a2220', 0.9); }
}

// ------------------------------------------------------------------ zones rouges (hachures + contour)
const shapePx = (sh) => sh.circle ? Array.from({ length: 64 }, (_, i) => [PX(sh.circle[0] + sh.circle[2] * Math.cos((i / 64) * 2 * Math.PI)), PY(sh.circle[1] + sh.circle[2] * Math.sin((i / 64) * 2 * Math.PI))]) : toPx(sh.polygon);
for (const rz of L.redZones) {
  const pts = shapePx(rz.shape); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  for (let py = Math.floor(Math.min(...ys)); py <= Math.ceil(Math.max(...ys)); py++) for (let px = Math.floor(Math.min(...xs)); px <= Math.ceil(Math.max(...xs)); px++)
    if (inPoly(px + 0.5, py + 0.5, pts)) { blendPx(px, py, [0.75, 0.1, 0.08], 0.07); if (((px + py) % Math.round(16 * S)) < 2.2 * S) blendPx(px, py, [0.7, 0.08, 0.06], 0.22); }
  polyline([...pts, pts[0]], 2.4 * S, [14 * S, 8 * S]); flush('#fff4e8', 0.8);
  polyline([...pts, pts[0]], 1.4 * S, [14 * S, 8 * S]); flush('#b01a14');
}

// ------------------------------------------------------------------ rivières, cascades
for (const rv of L.rivers) {
  const pts = chaikin(toPx(rv.surfaceProfile), 2); const wpx = Math.max(1.3 * S, rv.width / MPP / 2);
  for (let i = 0; i < pts.length - 1; i++) { const t = i / (pts.length - 1), r = wpx * (0.45 + 0.55 * Math.min(1, t * 2.5)); capsule(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r + 1.1 * S); }
  flush('#e9f4f2', 0.8);
  for (let i = 0; i < pts.length - 1; i++) { const t = i / (pts.length - 1), r = wpx * (0.45 + 0.55 * Math.min(1, t * 2.5)); capsule(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r); }
  flush('#3f95c0');
}
for (const wf of L.waterfalls) { const x = PX(wf.x), y = PY(wf.z); for (let i = 0; i < 3; i++) polyline([[x - 5 * S, y - 6 * S + i * 4 * S], [x, y - 2 * S + i * 4 * S], [x + 5 * S, y - 6 * S + i * 4 * S]], 1.1 * S); flush('#ffffff'); }

// ------------------------------------------------------------------ routes, sentiers, ponts
for (const rd of L.roads) {
  const pts = chaikin(toPx(rd.pts), 2), main = rd.cls === 'main';
  polyline(pts, (main ? 2.9 : 1.9) * S); flush('#f7efdc', 0.75);
  polyline(pts, (main ? 1.7 : 1.05) * S, main ? null : [6 * S, 4 * S]); flush(main ? '#8a2f1c' : '#6a3a20');
  for (const b of rd.bridges || []) { const bx = PX(b.x ?? b[0]), by = PY(b.z ?? b[1]); if (!isFinite(bx)) continue; disc(bx, by, 3.2 * S); flush('#2c2118'); disc(bx, by, 1.8 * S); flush('#e8dcc0'); }
}

// ------------------------------------------------------------------ marqueurs
const diamond = (x, y, r) => polyFill([[x, y - r], [x + r, y], [x, y + r], [x - r, y]]);
const icon = {
  town(x, y) { const r = 9 * S; polyFill([[x - r - 2 * S, y + r * 0.8 + 2 * S], [x - r - 2 * S, y - r * 0.2], [x, y - r * 1.3 - 2 * S], [x + r + 2 * S, y - r * 0.2], [x + r + 2 * S, y + r * 0.8 + 2 * S]]); flush('#fff8ea');
    polyFill([[x - r, y + r * 0.8], [x - r, y - r * 0.2], [x, y - r * 1.3], [x + r, y - r * 0.2], [x + r, y + r * 0.8]]); flush('#b2291e'); polyFill([[x - r * 0.3, y + r * 0.8], [x - r * 0.3, y + r * 0.1], [x + r * 0.3, y + r * 0.1], [x + r * 0.3, y + r * 0.8]]); flush('#fff1d6'); },
  outpost(x, y) { const r = 5.5 * S; polyFill([[x - r - 1.8 * S, y - r - 1.8 * S], [x + r + 1.8 * S, y - r - 1.8 * S], [x + r + 1.8 * S, y + r + 1.8 * S], [x - r - 1.8 * S, y + r + 1.8 * S]]); flush('#fff8ea'); polyFill([[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]]); flush('#c46a24'); },
  camp(x, y) { const r = 6 * S; polyFill([[x, y - r - 2 * S], [x + r + 2 * S, y + r * 0.7 + 1.5 * S], [x - r - 2 * S, y + r * 0.7 + 1.5 * S]]); flush('#fff8ea'); polyFill([[x, y - r], [x + r, y + r * 0.7], [x - r, y + r * 0.7]]); flush('#d0892c'); },
  waypoint(x, y) { diamond(x, y, 7.5 * S); flush('#123c48'); diamond(x, y, 5.2 * S); flush('#46e0f0'); disc(x, y, 1.4 * S); flush('#ffffff'); },
  dungeon(x, y, locked) { const r = 6.5 * S, pts = [[x - r, y + r]]; for (let i = 0; i <= 10; i++) { const a = Math.PI + (i / 10) * Math.PI; pts.push([x + Math.cos(a) * r, y - r * 0.2 + Math.sin(a) * r]); } pts.push([x + r, y + r]);
    polyFill(pts.map(([px, py]) => [x + (px - x) * 1.35, y + (py - y) * 1.3])); flush('#fff8ea'); polyFill(pts); flush(locked ? '#8f8a98' : '#5a2d8c'); disc(x, y + r * 0.35, r * 0.35); flush('#1a0f24'); },
  peak(x, y) { const r = 6 * S; polyFill([[x, y - r - 2 * S], [x + r + 2 * S, y + r * 0.8 + 1.4 * S], [x - r - 2 * S, y + r * 0.8 + 1.4 * S]]); flush('#f6efdc', 0.8); polyFill([[x, y - r], [x + r, y + r * 0.8], [x - r, y + r * 0.8]]); flush('#3a2d24'); },
  boss(x, y, big) { const r = (big ? 6.5 : 4.8) * S; disc(x, y, r + 1.8 * S); flush('#fff4e8'); disc(x, y, r); flush('#9e1510'); polyline([[x - r * 0.5, y - r * 0.5], [x + r * 0.5, y + r * 0.5]], 0.9 * S); polyline([[x + r * 0.5, y - r * 0.5], [x - r * 0.5, y + r * 0.5]], 0.9 * S); flush('#ffffff'); },
  tree(x, y) { const r = 11 * S; for (let i = 0; i < 10; i++) { const a = (i / 10) * 2 * Math.PI; polyline([[x, y], [x + Math.cos(a) * r * 1.5, y + Math.sin(a) * r * 1.5]], 1 * S); } flush('#fff2b8', 0.8);
    disc(x, y, r + 2 * S); flush('#fff8ea'); disc(x, y, r); flush('#d9a520'); disc(x - 3 * S, y - 3 * S, r * 0.45); flush('#fff0a8'); },
  view(x, y) { const r = 4.2 * S; polyFill([[x - r, y + r], [x - r * 0.55, y - r * 1.2], [x + r * 0.55, y - r * 1.2], [x + r, y + r]]); flush('#fff8ea'); polyFill([[x - r * 0.6, y + r * 0.7], [x - r * 0.35, y - r * 0.9], [x + r * 0.35, y - r * 0.9], [x + r * 0.6, y + r * 0.7]]); flush('#6a5646'); },
};
const LABELS = [];   // étiquettes posées après les marqueurs (au-dessus de tout)
for (const q of L.pois.filter((q) => q.type === 'belvedere')) icon.view(PX(q.x), PY(q.z));
for (const pk of L.relief.peaks) { icon.peak(PX(pk.x), PY(pk.z)); LABELS.push([pk.name + ' ' + Math.round(pk.h), PX(pk.x), PY(pk.z) + 12 * S, { size: 1.35 * S, color: '#3a2d24', weight: 0.45 }]); }
for (const d of L.dungeons) icon.dungeon(PX(d.x), PY(d.z), d.version !== 'v0.1' && d.version !== 'v0.3');
for (const r of L.regions) for (const b of [...r.bosses, ...r.miniBosses]) icon.boss(PX(b.x), PY(b.z), r.bosses.includes(b));
for (const wp of L.waypoints) icon.waypoint(PX(wp.x), PY(wp.z));
for (const c of L.camps) icon.camp(PX(c.x), PY(c.z));
for (const o of L.outposts) { icon.outpost(PX(o.x), PY(o.z)); LABELS.push([o.name, PX(o.x), PY(o.z) + 14 * S, { size: 1.6 * S, color: '#6a3410' }]); }
for (const lm of L.landmarks) { icon.tree(PX(lm.x), PY(lm.z)); LABELS.push([lm.name, PX(lm.x), PY(lm.z) - 22 * S, { size: 2.1 * S, color: '#7a5200', weight: 0.55 }]); }
for (const t of L.towns) { icon.town(PX(t.x), PY(t.z)); LABELS.push([t.name, PX(t.x), PY(t.z) + 21 * S, { size: 2.6 * S, color: '#7a1a10', weight: 0.6, haloW: 2.2 * S }]); }

// noms des eaux (italique bleu)
const WATER_LABELS = [
  ...L.lakes.filter((l) => !l.lava).map((l) => [l.name, l.x, l.z + (l.rz || 40) * 0.1, 1.5]),
  ...L.rivers.map((rv) => { const p = rv.surfaceProfile[Math.floor(rv.surfaceProfile.length * 0.55)]; return [rv.name, p[0] + 60, p[1], 1.3]; }),
  ['Mer des Salins', 200, 1640, 2.6], ["Mer d'Azurine", 1900, 460, 2.4], ['Golfe des Embruns', 2150, -420, 2.0],
];
for (const [name, x, z, sz] of WATER_LABELS) LABELS.push([name, PX(x), PY(z), { size: sz * S, color: '#1d5a86', italic: 0.22, halo: '#e8f6f6', haloA: 0.6, weight: 0.45 }]);

// noms de régions (grandes capitales espacées) + niveaux
const LABEL_POS = {   // positions choisies à la main (m) ; sinon barycentre des terres de la région
  brumeval: [-40, 330], arbre: [-110, -1040], coeur_aldmar: [230, -1390], aldmar: [-380, -1370], mordore: [-640, -420], songes: [-560, 1000], port_salin: [420, 700],
  ventfauve: [560, -260], sylve: [380, -1600], egares: [-60, -2230], givreval: [-1000, -2020], couronne: [-1700, -2470], cendres: [1330, -1540], coeur_brasier: [1450, -2330],
  brumenoire: [1260, -1100], embruns: [1830, -620], rougecrete: [-1680, -300], entaille: [-1300, -1060], sable_rouge: [-1330, 640], mer_dunes: [-1880, 1330],
  azurine: [1520, 930], epave: [1930, 1600],
};
const regCenter = {};
for (let r = 0; r < cm.rows; r++) for (let c = 0; c < cm.cols; c++) { if (cm.water[r][c] !== '0') continue; const ch = cm.region[r][c]; const q = (regCenter[ch] ||= [0, 0, 0]); q[0] += cm.x0 + (c + 0.5) * cm.cell; q[1] += cm.z0 + (r + 0.5) * cm.cell; q[2]++; }
for (const reg of L.regions) {
  const q = regCenter[reg.char]; if (!q) continue; const pos = LABEL_POS[reg.id] || [q[0] / q[2], q[1] / q[2]];
  const x = PX(pos[0]), y = PY(pos[1]); const red = reg.danger === 'rouge';
  const big = !red && q[2] > 500; const sz = Math.min((big ? 3.3 : 2.5) * S, (520 * S) / (reg.name.length * 8.2));
  LABELS.push([reg.name, x, y, { size: sz, track: 2.2 * S, color: red ? '#8e0f0a' : '#3a2616', weight: 0.5, haloW: 2.4 * S, haloA: 0.72 }]);
  LABELS.push([`niv. ${reg.levels[0]}–${reg.levels[1]}${red ? ' · zone rouge' : ''}`, x, y + 7 * sz + 4 * S, { size: 1.55 * S, color: red ? '#a0140e' : '#4a3a28', weight: 0.5 }]);
}
for (const [str, x, y, opt] of LABELS) text(str, x, y, opt);

// ------------------------------------------------------------------ grille de relecture
if (GRID) {
  for (let v = -2250; v <= 2250; v += 250) { const x = PX(v); polyline([[x, 0], [x, MAPH]], v % 1000 ? 0.4 : 0.8); flush('#000000', 0.4); text(String(v), x, 12, { size: 1.3, halo: '#ffffff' }); }
  for (let v = -2750; v <= 1750; v += 250) { const y = PY(v); polyline([[0, y], [W, y]], v % 1000 ? 0.4 : 0.8); flush('#000000', 0.4); text(String(v), 22, y, { size: 1.3, halo: '#ffffff' }); }
}
// cadre de la zone jouable et graduations tous les 500 m
polyline([[PX(P.x0), PY(P.z0)], [PX(P.x1), PY(P.z0)], [PX(P.x1), PY(P.z1)], [PX(P.x0), PY(P.z1)], [PX(P.x0), PY(P.z0)]], 1 * S, [10 * S, 7 * S]); flush('#2c2118', 0.55);
for (let v = -2000; v <= 2000; v += 500) { text(String(v), PX(v), PY(P.z0) - 12 * S, { size: 1.3 * S, color: '#2c2118' }); }
for (let v = -2500; v <= 1500; v += 500) { text(String(v), PX(P.x0) - 8 * S, PY(v), { size: 1.3 * S, color: '#2c2118', align: 'right' }); }

// ------------------------------------------------------------------ cartouche (bas de l'image)
for (let py = MAPH; py < H; py++) for (let px = 0; px < W; px++) { const n = 0; setPx(py * W + px, [0.93 + n, 0.89 + n, 0.78 + n]); }
polyline([[0, MAPH + 1], [W, MAPH + 1]], 2 * S); flush('#2c2118');
const LY0 = MAPH + LEG * 0.2;
text('Brumeval Online — Carte du monde v0.3', 40 * S, LY0, { size: 3.4 * S, align: 'left', color: '#2c2118', weight: 0.55, halo: null });
text('4 096 × 4 096 m jouables · nord en haut · Brumeval en (0, 0) · mer à 0 m · courbes tous les 10 m (50 m en gras)', 40 * S, LY0 + 42 * S, { size: 1.6 * S, align: 'left', color: '#4a3a28', halo: null });
text('Rendu par docs/world/tools/render_map.mjs depuis heightmap.png et world_layout.json', 40 * S, LY0 + 66 * S, { size: 1.4 * S, align: 'left', color: '#6a5a48', halo: null });
// échelle
const sbx = 40 * S, sby = MAPH + LEG * 0.82, sbl = 1000 / MPP;
for (let i = 0; i < 4; i++) { polyFill([[sbx + (i * sbl) / 4, sby - 5 * S], [sbx + ((i + 1) * sbl) / 4, sby - 5 * S], [sbx + ((i + 1) * sbl) / 4, sby + 5 * S], [sbx + (i * sbl) / 4, sby + 5 * S]]); flush(i % 2 ? '#f6efdc' : '#2c2118'); }
polyline([[sbx, sby - 5 * S], [sbx + sbl, sby - 5 * S], [sbx + sbl, sby + 5 * S], [sbx, sby + 5 * S], [sbx, sby - 5 * S]], 0.8 * S); flush('#2c2118');
for (const [v, lab] of [[0, '0'], [0.5, '500 m'], [1, '1 km']]) text(lab, sbx + v * sbl, sby - 18 * S, { size: 1.5 * S, halo: null });
text('≈ 2 min 30 à pied', sbx + sbl + 16 * S, sby, { size: 1.5 * S, align: 'left', halo: null, color: '#4a3a28' });
// légende des symboles
const lgx = W * 0.47, lgy = MAPH + LEG * 0.22, col = W * 0.135, row = 30 * S;
const LEGEND = [
  ['town', 'Ville (zone sûre)'], ['outpost', 'Avant-poste'], ['camp', 'Camp / sanctuaire'], ['waypoint', 'Pierre de téléportation'],
  ['dungeon', 'Donjon (ouvert)'], ['dungeon_locked', 'Donjon (v0.4 et plus)'], ['boss', 'Boss / mini-boss'], ['peak', 'Sommet (m)'],
  ['view', 'Belvédère'], ['road', 'Route'], ['trail', 'Sentier'], ['red', 'Zone rouge (JcJ libre)'],
];
LEGEND.forEach(([k, lab], i) => {
  const cx = lgx + Math.floor(i / 4) * col, cy = lgy + (i % 4) * row;
  if (k === 'road' || k === 'trail') { polyline([[cx - 12 * S, cy], [cx + 12 * S, cy]], (k === 'road' ? 1.7 : 1.05) * S, k === 'trail' ? [6 * S, 4 * S] : null); flush(k === 'road' ? '#8a2f1c' : '#6a3a20'); }
  else if (k === 'red') { polyline([[cx - 12 * S, cy - 6 * S], [cx + 12 * S, cy - 6 * S], [cx + 12 * S, cy + 6 * S], [cx - 12 * S, cy + 6 * S], [cx - 12 * S, cy - 6 * S]], 1.4 * S, [7 * S, 4 * S]); flush('#b01a14'); }
  else if (k === 'dungeon_locked') icon.dungeon(cx, cy, true); else if (k === 'boss') icon.boss(cx, cy, true); else if (k === 'dungeon') icon.dungeon(cx, cy, false); else icon[k](cx, cy);
  text(lab, cx + 20 * S, cy, { size: 1.55 * S, align: 'left', halo: null, color: '#2c2118' });
});
// symboles de végétation
const vx = W * 0.47, vy = MAPH + LEG * 0.86;
[['tree', 'forêt'], ['pine', 'pins'], ['palm', 'palmiers'], ['tree_gold', 'bois dorés'], ['dune', 'dunes'], ['reed', 'marais']].forEach(([t, lab], i) => {
  const x = vx + i * W * 0.068; SYM.length = 0; const s = S;
  if (t === 'tree' || t === 'tree_gold') { disc(x, vy, 4.2 * s); flush(COL[t][0]); disc(x - 1.3 * s, vy - 1.5 * s, 1.9 * s); flush(COL[t][1]); }
  else if (t === 'pine') { polyFill([[x, vy - 8 * s], [x + 4 * s, vy + 1 * s], [x - 4 * s, vy + 1 * s]]); flush(COL.pine[0]); }
  else if (t === 'palm') { polyline([[x, vy + 4 * s], [x + 1 * s, vy - 4 * s]], 0.8 * s); flush('#6b4a2a'); for (let f = 0; f < 5; f++) { const a = -Math.PI / 2 + (f - 2) * 0.62; polyline([[x + s, vy - 4 * s], [x + s + Math.cos(a) * 5 * s, vy - 4 * s + Math.sin(a) * 5 * s + 1.6 * s]], 0.9 * s); } flush('#2f8a3a'); }
  else if (t === 'dune') { const pts = []; for (let k = 0; k <= 8; k++) { const a = Math.PI * (0.15 + 0.7 * k / 8); pts.push([x + Math.cos(a) * 7 * s, vy - Math.sin(a) * 3 * s + 3 * s]); } polyline(pts, 0.7 * s); flush('#b88a4e'); }
  else { for (const dx of [-1.6, 0, 1.6]) polyline([[x + dx * s, vy + 3 * s], [x + dx * s * 1.6, vy - 3 * s]], 0.55 * s); flush('#44552c'); }
  text(lab, x + 10 * S, vy, { size: 1.45 * S, align: 'left', halo: null, color: '#2c2118' });
});
// rose des vents
const nx0 = W - 110 * S, ny0 = MAPH + LEG * 0.5, nr = 34 * S;
polyFill([[nx0, ny0 - nr], [nx0 + 8 * S, ny0], [nx0, ny0 + nr * 0.35], [nx0 - 8 * S, ny0]]); flush('#b2291e');
polyFill([[nx0, ny0 + nr], [nx0 + 8 * S, ny0], [nx0, ny0 - nr * 0.35], [nx0 - 8 * S, ny0]]); flush('#2c2118');
polyFill([[nx0 - nr, ny0], [nx0, ny0 - 6 * S], [nx0 + nr, ny0], [nx0, ny0 + 6 * S]]); flush('#6a5a48', 0.8);
text('N', nx0, ny0 - nr - 14 * S, { size: 2.2 * S, halo: null, color: '#2c2118' });
// barre d'altitude
const ax0 = W * 0.33, ay0 = MAPH + LEG * 0.82, aw = W * 0.12;
for (let i = 0; i < aw; i++) { const h = (i / aw) * 400; const c = mix(mix(hex('#8cbc62'), hex('#cdb45a'), smoothstep(20, 120, h)), hex('#f1ead8'), smoothstep(150, 400, h) * 0.8); for (let j = -5 * S; j <= 5 * S; j++) setPx(Math.round(ay0 + j) * W + Math.round(ax0 + i), c); }
for (const v of [0, 100, 200, 300, 400]) text(v + ' m', ax0 + (v / 400) * aw, ay0 - 17 * S, { size: 1.4 * S, halo: null });

// ------------------------------------------------------------------ encodage
const rgb = new Uint8Array(W * H * 3); for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(clamp(IMG[i], 0, 1) * 255);
fs.writeFileSync(OUT, encodeRGB(W, H, rgb, { Title: 'Brumeval Online - carte du monde v0.3', Software: 'docs/world/tools/render_map.mjs' }));
console.log(`carte écrite : ${path.relative(process.cwd(), OUT)} (${W}×${H}, ${MPP.toFixed(2)} m/px, ${NSYM} symboles)`);
