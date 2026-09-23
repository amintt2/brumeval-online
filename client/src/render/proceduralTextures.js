// Tileable procedural PBR layers (albedo / normal / ORM, RGBA8) used when the baked terrain textures
// (/textures/terrain/*.webp) are missing. Pure JS (runs in the terrain worker).

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = (t) => t * t * (3 - 2 * t);
/** Periodic value noise (period p cells). */
function pnoise(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
  const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
  const u = fade(xf), v = fade(yf);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function pfbm(x, y, p, seed, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * pnoise(x * f, y * f, p * f, seed + i * 17);
    n += a;
    a *= 0.5;
    f *= 2;
  }
  return s / n;
}
/** Periodic Worley: returns [f1, f2, cellHash]. */
function pworley(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const wx = ((cx % p) + p) % p, wy = ((cy % p) + p) % p;
      const px = cx + 0.15 + 0.7 * hash2(wx, wy, seed), py = cy + 0.15 + 0.7 * hash2(wx, wy, seed + 5);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, seed + 9); } else if (d < f2) f2 = d;
    }
  }
  return [f1, f2, id];
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Layer recipes: height(u, v) in 0..1 (tileable on [0,1)²) and colour(u, v, h) → [r, g, b] (sRGB 0..255),
 * rough(h) → roughness 0..1, bump = normal strength.
 */
const RECIPES = {
  grass: {
    bump: 1.2,
    height: (u, v) => pfbm(u * 8, v * 8, 8, 11, 4) * 0.55 + pnoise(u * 64, v * 16, 64, 12) * 0.45,
    color: (u, v, h) => {
      const t = pfbm(u * 4, v * 4, 4, 13, 3);
      let c = mixc(hex('#3f5a24'), hex('#6c7a34'), t);
      c = mixc(c, hex('#7f7a3e'), clamp01((pnoise(u * 12, v * 12, 12, 14) - 0.6) * 2.5) * 0.6);
      return mixc(c, hex('#2c3d18'), (1 - h) * 0.45);
    },
    rough: (h) => 0.82 + (1 - h) * 0.12,
  },
  forest_floor: {
    bump: 1.6,
    height: (u, v) => {
      const [f1] = pworley(u * 14, v * 14, 14, 21);
      return clamp01(pfbm(u * 6, v * 6, 6, 22, 4) * 0.5 + (1 - f1) * 0.5);
    },
    color: (u, v, h) => {
      const leaf = pnoise(u * 40, v * 40, 40, 23);
      let c = mixc(hex('#3a2f1e'), hex('#5a4326'), h);
      if (leaf > 0.7) c = mixc(c, hex('#7a5a2a'), (leaf - 0.7) * 2.5);
      const moss = clamp01((pfbm(u * 5, v * 5, 5, 24, 3) - 0.55) * 3);
      return mixc(c, hex('#3c4a22'), moss * 0.7);
    },
    rough: (h) => 0.88,
  },
  dirt: {
    bump: 1.8,
    height: (u, v) => {
      const [f1, , id] = pworley(u * 22, v * 22, 22, 31);
      const peb = id > 0.72 ? clamp01(1 - f1 * 2.2) : 0;
      return clamp01(pfbm(u * 8, v * 8, 8, 32, 4) * 0.7 + peb * 0.5);
    },
    color: (u, v, h) => mixc(mixc(hex('#5a4630'), hex('#83674a'), pfbm(u * 5, v * 5, 5, 33, 3)), hex('#9a8a78'), clamp01((h - 0.75) * 3) * 0.6),
    rough: () => 0.9,
  },
  road: {
    bump: 1.5,
    height: (u, v) => {
      const rut = Math.pow(Math.abs(Math.sin((u + pfbm(u * 2, v * 2, 2, 41, 2) * 0.08) * Math.PI * 2)), 6) * 0.25;
      const [f1, , id] = pworley(u * 30, v * 30, 30, 42);
      const peb = id > 0.6 ? clamp01(1 - f1 * 2.5) : 0;
      return clamp01(0.45 + pfbm(u * 10, v * 10, 10, 43, 4) * 0.3 - rut + peb * 0.35);
    },
    color: (u, v, h) => mixc(mixc(hex('#6e5b43'), hex('#8d7657'), pfbm(u * 6, v * 6, 6, 44, 3)), hex('#a39580'), clamp01((h - 0.7) * 3) * 0.5),
    rough: () => 0.86,
  },
  cobble: {
    bump: 3.2,
    height: (u, v) => {
      const [f1, f2, id] = pworley(u * 7, v * 7, 7, 51);
      const edge = clamp01((f2 - f1) * 5);
      return clamp01(Math.pow(edge, 0.6) * (0.75 + id * 0.25) - pnoise(u * 50, v * 50, 50, 52) * 0.06);
    },
    color: (u, v, h) => {
      const [, , id] = pworley(u * 7, v * 7, 7, 51);
      const stone = mixc(hex('#6a655c'), hex('#8e877a'), id);
      return mixc(hex('#34302a'), mixc(stone, hex('#5a5a48'), pnoise(u * 20, v * 20, 20, 53) * 0.25), clamp01(h * 2.2));
    },
    rough: (h) => 0.7 + (1 - h) * 0.25,
  },
  rock: {
    bump: 2.6,
    height: (u, v) => {
      const [f1, f2] = pworley(u * 5, v * 5, 5, 61);
      const crack = clamp01((f2 - f1) * 6);
      return clamp01(pfbm(u * 6, v * 6, 6, 62, 5) * 0.6 + crack * 0.4);
    },
    color: (u, v, h) => {
      const strata = 0.5 + 0.5 * Math.sin((v + pfbm(u * 3, v * 3, 3, 63, 3) * 0.4) * Math.PI * 2 * 6);
      let c = mixc(hex('#5a564f'), hex('#8a847a'), h * 0.7 + strata * 0.3);
      return mixc(c, hex('#6f6456'), pfbm(u * 4, v * 4, 4, 64, 2) * 0.35);
    },
    rough: (h) => 0.78 + (1 - h) * 0.15,
  },
  snow: {
    bump: 0.8,
    height: (u, v) => pfbm(u * 6, v * 6, 6, 71, 5),
    color: (u, v, h) => mixc(hex('#c8d2de'), hex('#f2f5f8'), h),
    rough: (h) => 0.55 + h * 0.2,
  },
  sand: {
    bump: 0.9,
    height: (u, v) => 0.5 + 0.35 * Math.sin((u * 12 + pfbm(u * 3, v * 3, 3, 81, 3) * 3) * Math.PI * 2) * 0.5 + pnoise(u * 90, v * 90, 90, 82) * 0.2,
    color: (u, v, h) => mixc(hex('#a08a64'), hex('#c7b288'), h),
    rough: () => 0.9,
  },
  mud: {
    bump: 1.3,
    height: (u, v) => pfbm(u * 7, v * 7, 7, 91, 4),
    color: (u, v, h) => mixc(hex('#2c231a'), hex('#4e3d2c'), h),
    rough: (h) => 0.35 + h * 0.4,
  },
  ash: {
    bump: 1.1,
    height: (u, v) => pfbm(u * 9, v * 9, 9, 101, 4),
    color: (u, v, h) => {
      const c = mixc(hex('#2e2b29'), hex('#5c5754'), h);
      const ember = pnoise(u * 60, v * 60, 60, 102);
      return ember > 0.93 ? mixc(c, hex('#6a3a24'), (ember - 0.93) * 10) : c;
    },
    rough: () => 0.92,
  },
};

/** Generate one tileable layer. Returns { albedo, normal, orm } Uint8Arrays (size² × 4). */
export function generateLayer(name, size = 256) {
  const R = RECIPES[name] || RECIPES.dirt;
  const n = size * size;
  const hgt = new Float32Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) hgt[y * size + x] = R.height(x / size, y / size);
  const albedo = new Uint8Array(n * 4), normal = new Uint8Array(n * 4), orm = new Uint8Array(n * 4);
  const bump = R.bump * (size / 256);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      const h = hgt[i];
      const c = R.color(x / size, y / size, h);
      albedo[o] = c[0]; albedo[o + 1] = c[1]; albedo[o + 2] = c[2]; albedo[o + 3] = Math.round(h * 255);
      const hl = hgt[y * size + ((x - 1 + size) % size)], hr = hgt[y * size + ((x + 1) % size)];
      const hd = hgt[((y - 1 + size) % size) * size + x], hu = hgt[((y + 1) % size) * size + x];
      // OpenGL convention (green = image up), like Blender bakes
      let nx = (hl - hr) * bump, ny = (hu - hd) * bump, nz = 1 / 8;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      normal[o] = (nx * 0.5 + 0.5) * 255; normal[o + 1] = (ny * 0.5 + 0.5) * 255; normal[o + 2] = (nz * 0.5 + 0.5) * 255; normal[o + 3] = 255;
      // cavity AO from the local height relative to its neighbours
      const cav = clamp01(0.75 + (h - (hl + hr + hd + hu) * 0.25) * 6 + h * 0.25);
      orm[o] = cav * 255; orm[o + 1] = clamp01(R.rough(h)) * 255; orm[o + 2] = 0; orm[o + 3] = 255;
    }
  }
  return { albedo, normal, orm };
}
