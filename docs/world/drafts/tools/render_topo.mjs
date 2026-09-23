// Topographic map renderer: hillshade + hypsometric/biome tints + 10 m contours (bold 50 m) + water, roads, labels.
import fs from 'node:fs';
import path from 'node:path';
import { encodeRGB } from './png.mjs';
import { drawText, textWidth } from './font.mjs';

const HYPSO = [[-45, [38, 70, 110]], [-8, [52, 110, 160]], [-1, [90, 160, 200]], [0, [120, 150, 95]], [15, [132, 164, 98]], [45, [158, 176, 110]],
  [90, [188, 186, 128]], [140, [202, 180, 128]], [190, [192, 158, 112]], [240, [170, 140, 112]], [290, [168, 158, 150]], [340, [214, 212, 216]], [420, [248, 248, 252]], [600, [255, 255, 255]]];
const BIO_RGB = { G: [112, 168, 84], O: [214, 196, 112], A: [214, 186, 104], F: [60, 110, 62], L: [58, 92, 84], S: [242, 244, 250], R: [150, 144, 138],
  V: [88, 82, 82], W: [88, 116, 88], H: [196, 112, 78], C: [178, 100, 70], D: [232, 204, 150], T: [150, 196, 110], K: [150, 160, 118], B: [238, 224, 176], M: [196, 172, 104],
  Q: [40, 80, 130], U: [70, 200, 205], Z: [70, 130, 190], Y: [230, 80, 20] };

function hypso(h) {
  for (let i = 0; i < HYPSO.length - 1; i++) {
    const [a, ca] = HYPSO[i], [b, cb] = HYPSO[i + 1];
    if (h <= b) { const t = Math.max(0, Math.min(1, (h - a) / (b - a))); return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]; }
  }
  return HYPSO[HYPSO.length - 1][1];
}

export function renderTopo(ctx) {
  const { S, N, STEP, X0, Z0, H, WTYPE, WATER, BIOME, BIO_KEYS, SLOPE, ROAD_D, BRIDGE, PEAKS_OUT, PASSES_OUT, OUT, OUT_TOOLS, QUICK } = ctx;
  const W = QUICK ? 1024 : 2048, IMG = new Uint8Array(W * W * 3);
  const span = (N - 1) * STEP, mpp = span / W;                 // metres per pixel
  const toPx = (x, z) => [((x - X0) / span) * W, ((z - Z0) / span) * W];
  // per-sample colour (biome tint over hypsometry) → bilinear at pixel resolution
  const colS = new Float32Array(N * N * 3);
  // biome tint, box-blurred (~40 m) so biome borders read as natural transitions
  const tint = new Float32Array(N * N * 3);
  for (let k = 0; k < N * N; k++) { const c = BIO_RGB[BIO_KEYS[BIOME[k]]] || [128, 128, 128]; tint[k * 3] = c[0]; tint[k * 3 + 1] = c[1]; tint[k * 3 + 2] = c[2]; }
  const blur = (A, r) => {
    const T = new Float32Array(A.length);
    for (let pass = 0; pass < 2; pass++) {
      const src = pass ? T : A, dst = pass ? A : T;
      for (let line = 0; line < N; line++) for (let c = 0; c < 3; c++) {
        let acc = 0; const get = (q) => { const qq = Math.max(0, Math.min(N - 1, q)); return pass ? src[(qq * N + line) * 3 + c] : src[(line * N + qq) * 3 + c]; };
        for (let q = -r; q <= r; q++) acc += get(q);
        for (let q = 0; q < N; q++) { const o = pass ? (q * N + line) * 3 + c : (line * N + q) * 3 + c; dst[o] = acc / (2 * r + 1); acc += get(q + r + 1) - get(q - r); }
      }
    }
  };
  blur(tint, 5); blur(tint, 5);
  for (let k = 0; k < N * N; k++) {
    const h = H[k], b = BIO_KEYS[BIOME[k]], wt = WTYPE[k];
    let c;
    if (wt === 1 || wt === 2) { const d = -h; c = wt === 2 ? [70 + 40 * Math.min(1, 1 - d / 4), 196 - d * 10, 205 - d * 4] : hypso(h); }
    else if (wt === 3 || wt === 4 || wt === 5) c = [72, 136, 196];
    else if (wt === 6) c = [235, 90, 25];
    else { const hy = hypso(h), bc = [tint[k * 3], tint[k * 3 + 1], tint[k * 3 + 2]]; const m = b === 'S' ? 0.7 : b === 'D' || b === 'V' ? 0.65 : b === 'H' || b === 'C' ? 0.3 : 0.42; c = [hy[0] * (1 - m) + bc[0] * m, hy[1] * (1 - m) + bc[1] * m, hy[2] * (1 - m) + bc[2] * m]; }
    colS[k * 3] = c[0]; colS[k * 3 + 1] = c[1]; colS[k * 3 + 2] = c[2];
  }
  const Hp = new Float32Array(W * W), Wt = new Uint8Array(W * W);
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    const fi = Math.min(N - 1.001, (px + 0.5) * mpp / STEP), fj = Math.min(N - 1.001, (py + 0.5) * mpp / STEP);
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * N + i;
    const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
    Hp[py * W + px] = H[k] * w00 + H[k + 1] * w10 + H[k + N] * w01 + H[k + N + 1] * w11;
    const o = (py * W + px) * 3;
    for (let c = 0; c < 3; c++) IMG[o + c] = colS[k * 3 + c] * w00 + colS[(k + 1) * 3 + c] * w10 + colS[(k + N) * 3 + c] * w01 + colS[(k + N + 1) * 3 + c] * w11;
    Wt[py * W + px] = WTYPE[Math.round(fj) * N + Math.round(fi)];
  }
  // hillshade (light from the north-west, 42° high), vertical exaggeration 1.6
  const az = (315 * Math.PI) / 180, alt = (42 * Math.PI) / 180;
  const lx = Math.cos(alt) * Math.sin(az) * -1, lz = Math.cos(alt) * Math.cos(az) * -1, ly = Math.sin(alt);
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    const p = py * W + px, wt = Wt[p];
    const a = Hp[py * W + Math.max(0, px - 1)], b = Hp[py * W + Math.min(W - 1, px + 1)], c = Hp[Math.max(0, py - 1) * W + px], d = Hp[Math.min(W - 1, py + 1) * W + px];
    const gx = ((b - a) / (2 * mpp)) * 1.6, gz = ((d - c) / (2 * mpp)) * 1.6;
    const nl = 1 / Math.hypot(gx, gz, 1);
    const sh = Math.max(0, (-gx * lx + ly - gz * lz) * nl);
    const f = wt === 0 ? 0.42 + 0.78 * sh : 0.9 + 0.1 * sh;
    const o = p * 3;
    for (let q = 0; q < 3; q++) IMG[o + q] = Math.max(0, Math.min(255, IMG[o + q] * f));
  }
  // contours on land: 10 m thin, 50 m bold; coastline
  for (let py = 0; py < W - 1; py++) for (let px = 0; px < W - 1; px++) {
    const p = py * W + px;
    const h = Hp[p], hr = Hp[p + 1], hd = Hp[p + W];
    const land = Wt[p] === 0 || Wt[p] === 5;
    if ((h >= 0) !== (hr >= 0) || (h >= 0) !== (hd >= 0)) { if (Wt[p] <= 2 || Wt[p + 1] <= 2) { const o = p * 3; IMG[o] = 40; IMG[o + 1] = 50; IMG[o + 2] = 70; continue; } }
    if (!land || h < 0) continue;
    const l = Math.floor(h / 10), lr = Math.floor(hr / 10), ld = Math.floor(hd / 10);
    if (l !== lr || l !== ld) {
      const lv = Math.max(l, lr, ld) * 10, bold = lv % 50 === 0;
      const o = p * 3, a = bold ? 0.7 : 0.38;
      const c = bold ? [70, 45, 25] : [90, 65, 40];
      for (let q = 0; q < 3; q++) IMG[o + q] = IMG[o + q] * (1 - a) + c[q] * a;
    }
  }
  // helpers
  const plot = (x, y, c, a = 1) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= W) return; const o = (y * W + x) * 3; for (let q = 0; q < 3; q++) IMG[o + q] = IMG[o + q] * (1 - a) + c[q] * a; };
  const disc = (x, y, r, c, a = 1) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 0.5) plot(x + dx, y + dy, c, a); };
  const line = (pts, width, c, dash = 0, a = 1) => {
    let acc = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = toPx(pts[k][0], pts[k][1]), [bx, by] = toPx(pts[k + 1][0], pts[k + 1][1]);
      const L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L * 2);
      for (let s = 0; s <= n; s++) {
        const t = s / n; acc += L / n;
        if (dash && Math.floor(acc / dash) % 2 === 1) continue;
        disc(ax + (bx - ax) * t, ay + (by - ay) * t, width, c, a);
      }
    }
  };
  const S2 = QUICK ? 1 : 2;
  const label = (x, z, txt, s, color = [20, 20, 20], halo = [250, 246, 235], dx = 6, dy = -4) => { const [px, py] = toPx(x, z); drawText(IMG, W, W, txt, Math.round(px + dx), Math.round(py + dy), s, color, halo); };
  const labelC = (x, z, txt, s, color, halo) => { const [px, py] = toPx(x, z); drawText(IMG, W, W, txt, Math.round(px - textWidth(txt, s) / 2), Math.round(py - 3.5 * s), s, color, halo); };

  // river centre lines (small streams would vanish otherwise)
  for (const r of S.RIVERS) line(r.pts.map((p) => [p[0], p[1]]), r.width < 14 ? 1 : 1.5, [40, 100, 185], 0, 0.9);
  // roads
  for (const r of S.ROADS) line(r.pts, r.cls === 'main' ? 1.6 : 1.0, r.cls === 'main' ? [150, 30, 25] : [110, 60, 35], r.cls === 'main' ? 0 : 5);
  // legacy roads (shared/world.js) in the start square
  for (const r of [[[0, 0], [20, 6], [45, 18], [70, 28]], [[0, 0], [-4, -30], [4, -60], [20, -80], [50, -88], [80, -86]], [[80, -86], [100, -110], [112, -126]], [[0, 0], [-30, -2], [-60, -8], [-92, -8]], [[0, 0], [-12, 25], [-30, 50]]]) line(r, 1.2, [150, 30, 25]);
  // red zones outlines
  for (const R of S.REGIONS.filter((r) => r.danger === 'rouge')) {
    let poly;
    if (R.circle) { poly = []; for (let a = 0; a <= 64; a++) poly.push([R.circle[0] + Math.cos((a / 64) * Math.PI * 2) * R.circle[2], R.circle[1] + Math.sin((a / 64) * Math.PI * 2) * R.circle[2]]); }
    else { poly = (R.plateau ? S.PLATEAUS.find((p) => p.id === R.plateau).poly : R.poly).slice(); poly.push(poly[0]); }
    line(poly, 1.3, [210, 20, 20], 7, 0.9);
  }
  // playable border + km grid ticks
  const P = S.PLAYABLE;
  line([[P.x0, P.z0], [P.x1, P.z0], [P.x1, P.z1], [P.x0, P.z1], [P.x0, P.z0]], 1.2, [30, 30, 30], 10, 0.8);
  for (let x = -2000; x <= 2000; x += 500) { const [px] = toPx(x, 0); for (let y = 0; y < 14 * S2; y++) plot(px, y, [0, 0, 0]); drawText(IMG, W, W, String(x), Math.round(px + 3), 3, S2, [0, 0, 0], [255, 255, 255]); }
  for (let z = -2500; z <= 1500; z += 500) { const [, py] = toPx(0, z); for (let x = 0; x < 14 * S2; x++) plot(x, py, [0, 0, 0]); drawText(IMG, W, W, String(z), 3, Math.round(py + 3), S2, [0, 0, 0], [255, 255, 255]); }

  // region names (large)
  for (const R of S.REGIONS) {
    let cx, cz;
    if (R.label) [cx, cz] = R.label;
    else if (R.circle) [cx, cz] = [R.circle[0], R.circle[1] + R.circle[2] * 0.55];
    else { const poly = R.plateau ? S.PLATEAUS.find((p) => p.id === R.plateau).poly : R.poly; cx = poly.reduce((a, p) => a + p[0], 0) / poly.length; cz = poly.reduce((a, p) => a + p[1], 0) / poly.length; }
    const col = R.danger === 'rouge' ? [170, 10, 10] : [45, 30, 20];
    labelC(cx, cz, R.name.toUpperCase(), S2 + (R.circle ? 0 : 1), col, [252, 248, 238]);
    labelC(cx, cz + 34 * mpp * S2 / 2 * (R.circle ? 1.4 : 2), `NIV. ${R.lv[0]}-${R.lv[1]}`, S2, col, [252, 248, 238]);
  }
  // peaks ▲ and passes )(
  for (const p of PEAKS_OUT) {
    const [px, py] = toPx(p.x, p.z);
    for (let y = 0; y < 7 * S2; y++) for (let x = -y / 2; x <= y / 2; x++) plot(px + x, py - 5 * S2 + y, p.mesa ? [120, 50, 30] : [15, 15, 15]);
    if (p.name) label(p.x, p.z, `${p.name} ${p.h}`, S2, [15, 15, 15], [255, 252, 240], 6 * S2, -4 * S2);
  }
  for (const p of PASSES_OUT) { const [px, py] = toPx(p.x, p.z); drawText(IMG, W, W, ')(', Math.round(px - 5 * S2), Math.round(py - 3 * S2), S2, [20, 20, 120], [255, 255, 255]); label(p.x, p.z, `${p.name} ${p.h}`, S2, [20, 20, 120], [255, 255, 255], 8 * S2, 3 * S2); }
  // waypoints ◆, dungeons ▼, towns ■, landmark ✶
  for (const [, name, x, z] of S.WAYPOINTS) { const [px, py] = toPx(x, z); const r = 3 * S2; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) + Math.abs(dy) <= r) plot(px + dx, py + dy, Math.abs(dx) + Math.abs(dy) >= r - 1 ? [0, 60, 80] : [60, 230, 240]); }
  for (const [, name, x, z] of S.DUNGEONS) { const [px, py] = toPx(x, z); for (let y = 0; y < 6 * S2; y++) for (let dx = -(6 * S2 - y) / 2; dx <= (6 * S2 - y) / 2; dx++) plot(px + dx, py - 3 * S2 + y, [110, 20, 140]); label(x, z, name, S2 === 2 ? 1 : 1, [90, 10, 110], [255, 255, 255], 5 * S2, 2 * S2); }
  for (const T of [...S.TOWNS, ...S.OUTPOSTS]) {
    const [px, py] = toPx(T.x, T.z), r = (T.kind ? 5 : 3) * S2;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) plot(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) >= r - 1 ? [255, 255, 255] : T.kind ? [200, 20, 20] : [120, 60, 20]);
    label(T.x, T.z, T.name.toUpperCase(), T.kind ? S2 + 1 : S2, [120, 0, 0], [255, 255, 255], r + 4, -r);
  }
  for (const L of S.LANDMARKS) { const [px, py] = toPx(L.x, L.z); for (let a = 0; a < 8; a++) for (let t = 0; t < 9 * S2; t++) plot(px + Math.cos((a * Math.PI) / 4) * t, py + Math.sin((a * Math.PI) / 4) * t, [20, 120, 40]); disc(px, py, 3 * S2, [255, 215, 90]); label(L.x, L.z, "L'ARBRE-BRUME", S2 + 1, [10, 90, 30], [255, 255, 240], 10 * S2, 6 * S2); }
  // lake / island / river names
  for (const L of S.LAKES) if (!L.lava && L.rx > 60) labelC(L.x, L.z, L.name.toUpperCase(), 1, [10, 40, 110], [210, 230, 255]);
  for (const I of S.ISLANDS) if (I[1] && I[4] >= 100) labelC(I[2], I[3] + I[4] * 1.2, I[1].toUpperCase(), 1, [10, 40, 110], [220, 240, 255]);
  for (const r of S.RIVERS) { const m = r.pts[Math.floor(r.pts.length / 2)]; label(m[0], m[1], r.name, 1, [20, 60, 150], [230, 240, 255], 6, 4); }
  for (const R of S.RIDGES) { if (R.id.startsWith('mur')) continue; const m = R.pts[Math.floor((R.pts.length - 1) / 2)]; label(m[0], m[1], R.name.toUpperCase(), 1, [80, 60, 50], [250, 245, 235], -40, 12); }
  // title + legend
  const tx = 20 * S2, ty = W - 60 * S2;
  drawText(IMG, W, W, 'BRUMEVAL ONLINE - CARTE TOPOGRAPHIQUE DU MONDE V0.3 (BROUILLON)', tx, ty, S2 + 1, [255, 255, 255], [20, 30, 50]);
  drawText(IMG, W, W, `4,1 X 4,1 KM JOUABLES - COURBES 10 M (50 M EN GRAS) - NORD EN HAUT - 1 PX = ${mpp.toFixed(2)} M`, tx, ty + 14 * S2, S2, [255, 255, 255], [20, 30, 50]);
  drawText(IMG, W, W, 'ROUGE PLEIN = ROUTE, TIRETS = SENTIER, TIRETS ROUGES = ZONE ROUGE, LOSANGE = WAYPOINT, VIOLET = DONJON', tx, ty + 26 * S2, S2, [255, 255, 255], [20, 30, 50]);
  // legend ramp
  const [lxp, lyp] = toPx(420, 1560); const lx0 = Math.round(lxp), ly0 = Math.round(lyp);
  const marks = [0, 50, 100, 150, 200, 250, 300, 350, 400];
  for (let x = 0; x < 200 * S2; x++) { const h = (x / (200 * S2)) * 420; const c = hypso(h); for (let y = 0; y < 10 * S2; y++) plot(lx0 + x, ly0 + y, c); }
  for (const m of marks) { const x = lx0 + (m / 420) * 200 * S2; drawText(IMG, W, W, String(m), Math.round(x - 4), ly0 + 12 * S2, S2 === 2 ? 1 : 1, [255, 255, 255], [20, 30, 50]); }
  drawText(IMG, W, W, 'ALTITUDE (M)', lx0, ly0 - 12 * S2, S2, [255, 255, 255], [20, 30, 50]);

  fs.writeFileSync(path.join(OUT, 'topo.png'), encodeRGB(W, W, IMG));
  // crops for close inspection
  const crop = (name, x0, z0, x1, z1) => {
    const [ax, ay] = toPx(x0, z0).map((v) => Math.max(0, Math.round(v))), [bx, by] = toPx(x1, z1).map((v) => Math.min(W, Math.round(v)));
    const cw = bx - ax, ch = by - ay, C = new Uint8Array(cw * ch * 3);
    for (let y = 0; y < ch; y++) C.set(IMG.subarray(((ay + y) * W + ax) * 3, ((ay + y) * W + bx) * 3), y * cw * 3);
    fs.writeFileSync(path.join(OUT_TOOLS, `crop_${name}.png`), encodeRGB(cw, ch, C));
  };
  crop('nw', -2304, -2808, 0, -500); crop('ne', 0, -2808, 2304, -500); crop('sw', -2304, -700, 0, 1800); crop('se', 0, -700, 2304, 1800); crop('centre', -900, -1700, 900, 400);
  // slope map (walkability) for review
  const SL = new Uint8Array(N * N * 3);
  for (let k = 0; k < N * N; k++) {
    const s = SLOPE[k], w = WTYPE[k];
    const c = w ? [60, 110, 200] : s < 25 ? [200, 230, 190] : s < 40 ? [240, 220, 120] : s < 55 ? [230, 120, 60] : [120, 20, 20];
    SL.set(c, k * 3);
  }
  fs.writeFileSync(path.join(OUT_TOOLS, 'slope.png'), encodeRGB(N, N, SL));
}
