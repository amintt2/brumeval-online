// Coloured primitive placeholders used whenever a GLB is missing or fails to load.
// The game must stay fully playable (and reasonably pretty) with zero assets.
import * as THREE from 'three';

const matCache = new Map();
/** Shared flat-shaded standard material. */
export function flatMat(color, opts = {}) {
  const key = `${color}|${opts.emissive || ''}|${opts.ei || 0}|${opts.rough ?? 0.85}|${opts.metal ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.85,
      metalness: opts.metal ?? 0,
      flatShading: true,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
      emissiveIntensity: opts.ei ?? (opts.emissive ? 1 : 0),
    });
    m.name = `fb_${color}`;
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map();
function geo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

function mesh(g, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

const G = {
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  sphere: (d = 1) => geo(`sph${d}`, () => new THREE.IcosahedronGeometry(0.5, d)),
  cyl: (seg = 8) => geo(`cyl${seg}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, seg)),
  cone: (seg = 8) => geo(`cone${seg}`, () => new THREE.ConeGeometry(0.5, 1, seg)),
  capsule: () => geo('capsule', () => new THREE.CapsuleGeometry(0.5, 1, 4, 10)),
  dodeca: () => geo('dodeca', () => new THREE.DodecahedronGeometry(0.5, 0)),
  torus: () => geo('torusArc', () => new THREE.TorusGeometry(0.5, 0.03, 5, 16, Math.PI * 1.1)),
};

// ------------------------------------------------------------------ humanoids
const HUMANOIDS = {
  warrior: { body: '#9c2b22', legs: '#3c3f47', skin: '#e0b48f', arms: '#8d949c', extra: 'warrior' },
  mage: { body: '#3450a8', legs: '#2a2f6b', skin: '#e3b894', arms: '#3450a8', extra: 'mage' },
  ranger: { body: '#3f6b35', legs: '#5a4028', skin: '#d9ab86', arms: '#6b4c2e', extra: 'ranger' },
  npc_elder: { body: '#6b4a2e', legs: '#4f3822', skin: '#e2b996', arms: '#6b4a2e', extra: 'elder' },
  npc_merchant: { body: '#b8456a', legs: '#6a3b7a', skin: '#e8bf9a', arms: '#d9a441', extra: 'merchant' },
  goblin: { body: '#6b5230', legs: '#4a3a22', skin: '#6aa33a', arms: '#6aa33a', extra: 'goblin', scale: 0.68 },
  skeleton: { body: '#d8d0bc', legs: '#d8d0bc', skin: '#e8e0cc', arms: '#d8d0bc', extra: 'skeleton', thin: true },
};

function humanoid(key) {
  const d = HUMANOIDS[key];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const th = d.thin ? 0.55 : 1;
  const mBody = flatMat(d.body), mLegs = flatMat(d.legs), mSkin = flatMat(d.skin), mArms = flatMat(d.arms);
  // legs
  for (const sx of [-1, 1]) body.add(mesh(G.capsule(), mLegs, sx * 0.13, 0.43, 0, 0, 0, 0, 0.2 * th, 0.5, 0.2 * th));
  // torso
  body.add(mesh(G.capsule(), mBody, 0, 1.1, 0, 0, 0, 0, 0.46 * (d.thin ? 0.7 : 1), 0.42, 0.34 * (d.thin ? 0.7 : 1)));
  // head
  body.add(mesh(G.sphere(1), mSkin, 0, 1.6, 0.01, 0, 0, 0, 0.34));
  // eyes
  const eyeMat = d.extra === 'skeleton' ? flatMat('#ff5a2a', { emissive: '#ff4a1a', ei: 2.5 }) : flatMat('#1b1b1f');
  for (const sx of [-1, 1]) body.add(mesh(G.sphere(0), eyeMat, sx * 0.065, 1.63, 0.155, 0, 0, 0, 0.055));
  // arms
  for (const sx of [-1, 1]) body.add(mesh(G.capsule(), mArms, sx * 0.34, 1.12, 0, 0, 0, sx * 0.12, 0.15 * th, 0.42, 0.15 * th));
  // hands
  for (const sx of [-1, 1]) body.add(mesh(G.sphere(0), mSkin, sx * 0.38, 0.8, 0.02, 0, 0, 0, 0.12));

  const metal = flatMat('#b9c0c8', { rough: 0.35, metal: 0.8 });
  const wood = flatMat('#6b4a2e');
  switch (d.extra) {
    case 'warrior':
      body.add(mesh(G.box(), metal, 0.4, 1.12, 0.3, Math.PI / 2 - 0.3, 0, 0, 0.06, 0.95, 0.12)); // blade
      body.add(mesh(G.box(), flatMat('#6b5a2e'), 0.4, 0.84, 0.08, 0, 0, 0, 0.26, 0.05, 0.08)); // guard
      body.add(mesh(G.cyl(12), flatMat('#7a2a20'), -0.46, 1.05, 0.08, 0, 0, Math.PI / 2, 0.55, 0.06, 0.55)); // shield
      body.add(mesh(G.sphere(1), metal, 0, 1.67, 0, 0, 0, 0, 0.37, 0.28, 0.37)); // helmet
      break;
    case 'mage':
      body.add(mesh(G.cone(10), flatMat('#2a2f6b'), 0, 1.98, -0.02, -0.12, 0, 0, 0.42, 0.55, 0.42)); // hat
      body.add(mesh(G.cyl(10), flatMat('#2a2f6b'), 0, 1.76, 0, 0, 0, 0, 0.56, 0.04, 0.56)); // brim
      body.add(mesh(G.cyl(6), wood, 0.42, 1.0, 0.1, 0, 0, 0, 0.05, 1.75, 0.05)); // staff
      body.add(mesh(G.sphere(1), flatMat('#7fd0ff', { emissive: '#4fb8ff', ei: 2.2 }), 0.42, 1.92, 0.1, 0, 0, 0, 0.16));
      body.add(mesh(G.cone(10), flatMat('#3450a8'), 0, 0.52, 0, 0, 0, 0, 0.62, 0.9, 0.55)); // robe skirt
      break;
    case 'ranger':
      body.add(mesh(G.sphere(1), flatMat('#2f5a2a'), 0, 1.66, -0.03, 0, 0, 0, 0.4, 0.38, 0.4)); // hood
      body.add(mesh(G.torus(), wood, -0.42, 1.05, 0.12, 0, Math.PI / 2, Math.PI / 2 - 0.55, 1.5)); // bow
      body.add(mesh(G.cyl(8), flatMat('#5a3b22'), 0.12, 1.2, -0.24, 0.35, 0, 0, 0.14, 0.6, 0.14)); // quiver
      break;
    case 'elder':
      body.add(mesh(G.cone(8), flatMat('#eeeeea'), 0, 1.36, 0.15, Math.PI, 0, 0, 0.26, 0.42, 0.2)); // beard
      body.add(mesh(G.cyl(6), wood, 0.42, 0.85, 0.12, 0, 0, 0.05, 0.05, 1.65, 0.05)); // stick
      body.add(mesh(G.cone(10), flatMat('#6b4a2e'), 0, 0.5, 0, 0, 0, 0, 0.6, 0.95, 0.55)); // robe
      body.add(mesh(G.sphere(1), flatMat('#dcdcd8'), 0, 1.7, -0.03, 0, 0, 0, 0.33, 0.2, 0.33)); // hair
      break;
    case 'merchant':
      body.add(mesh(G.box(), flatMat('#efe6d0'), 0, 0.95, 0.19, 0, 0, 0, 0.42, 0.6, 0.04)); // apron
      body.add(mesh(G.cone(10), flatMat('#6a3b7a'), 0, 0.5, 0, 0, 0, 0, 0.6, 0.95, 0.55)); // skirt
      body.add(mesh(G.sphere(1), flatMat('#6b3a1e'), 0, 1.72, -0.1, 0, 0, 0, 0.3)); // hair bun
      body.add(mesh(G.sphere(1), flatMat('#d9a441'), 0, 1.78, 0, 0, 0, 0, 0.36, 0.14, 0.36)); // head scarf
      break;
    case 'goblin':
      for (const sx of [-1, 1]) body.add(mesh(G.cone(6), mSkin, sx * 0.3, 1.66, 0, 0, 0, sx * -1.35, 0.14, 0.42, 0.08)); // ears
      body.add(mesh(G.cyl(6), wood, 0.44, 1.02, 0.25, Math.PI / 2 - 0.4, 0, 0, 0.12, 0.8, 0.12)); // club
      body.add(mesh(G.sphere(0), mSkin, 0, 1.58, 0.18, 0, 0, 0, 0.1, 0.1, 0.16)); // nose
      break;
    case 'skeleton':
      body.add(mesh(G.box(), flatMat('#8a5a3a', { rough: 0.6, metal: 0.4 }), 0.4, 1.1, 0.3, Math.PI / 2 - 0.3, 0, 0, 0.06, 0.85, 0.1));
      for (let i = 0; i < 3; i++) body.add(mesh(G.box(), flatMat('#cfc6b0'), 0, 1.0 + i * 0.12, 0.08, 0, 0, 0, 0.36, 0.03, 0.2)); // ribs
      break;
  }
  if (d.scale) root.scale.setScalar(d.scale);
  return root;
}

// ------------------------------------------------------------------ creatures
function slime() {
  const root = new THREE.Group();
  const gel = new THREE.MeshStandardMaterial({ color: '#63cf52', roughness: 0.25, metalness: 0, emissive: '#1f5a14', emissiveIntensity: 0.6, flatShading: false });
  gel.name = 'fb_slime';
  root.add(mesh(G.sphere(2), gel, 0, 0.33, 0, 0, 0, 0, 0.9, 0.66, 0.9));
  root.add(mesh(G.sphere(1), gel, 0, 0.6, -0.05, 0, 0, 0, 0.36, 0.25, 0.36));
  const white = flatMat('#ffffff'), black = flatMat('#111111');
  for (const sx of [-1, 1]) {
    root.add(mesh(G.sphere(1), white, sx * 0.14, 0.45, 0.36, 0, 0, 0, 0.16));
    root.add(mesh(G.sphere(0), black, sx * 0.14, 0.45, 0.43, 0, 0, 0, 0.08));
  }
  return root;
}

function wolf() {
  const root = new THREE.Group();
  const fur = flatMat('#7c8088'), dark = flatMat('#51545b'), light = flatMat('#b9bcc2');
  root.add(mesh(G.capsule(), fur, 0, 0.62, -0.05, Math.PI / 2, 0, 0, 0.5, 0.75, 0.46));
  root.add(mesh(G.capsule(), dark, 0, 0.78, -0.1, Math.PI / 2, 0, 0, 0.36, 0.6, 0.2));
  root.add(mesh(G.box(), fur, 0, 0.84, 0.62, 0.1, 0, 0, 0.34, 0.3, 0.34));
  root.add(mesh(G.box(), light, 0, 0.76, 0.86, 0.12, 0, 0, 0.2, 0.16, 0.26));
  root.add(mesh(G.sphere(0), flatMat('#161616'), 0, 0.79, 0.99, 0, 0, 0, 0.07));
  for (const sx of [-1, 1]) {
    root.add(mesh(G.cone(4), dark, sx * 0.11, 1.05, 0.58, 0, 0, 0, 0.1, 0.2, 0.08));
    root.add(mesh(G.sphere(0), flatMat('#ffcc33', { emissive: '#ffaa00', ei: 0.8 }), sx * 0.09, 0.9, 0.79, 0, 0, 0, 0.05));
  }
  for (const [x, z] of [[-0.15, 0.35], [0.15, 0.35], [-0.15, -0.45], [0.15, -0.45]]) {
    root.add(mesh(G.cyl(6), fur, x, 0.25, z, 0, 0, 0, 0.12, 0.5, 0.12));
  }
  root.add(mesh(G.cone(6), dark, 0, 0.72, -0.72, -2.2, 0, 0, 0.14, 0.55, 0.14));
  return root;
}

function golem() {
  const root = new THREE.Group();
  const stone = flatMat('#7d7a74'), stoneD = flatMat('#5f5c57'), moss = flatMat('#4f7a34');
  const rune = flatMat('#7ff0ff', { emissive: '#34d8ff', ei: 3 });
  for (const sx of [-1, 1]) {
    root.add(mesh(G.dodeca(), stoneD, sx * 0.62, 0.65, 0, 0.2, sx, 0, 0.9, 1.35, 0.9));
    root.add(mesh(G.dodeca(), stone, sx * 1.45, 2.0, 0.1, 0.3, 0, sx * 0.2, 0.85, 1.9, 0.85));
    root.add(mesh(G.dodeca(), stoneD, sx * 1.5, 0.95, 0.25, 0, 0, 0, 0.9));
    root.add(mesh(G.dodeca(), moss, sx * 1.25, 3.05, 0, 0, 0, 0, 0.9, 0.5, 0.9));
  }
  root.add(mesh(G.dodeca(), stone, 0, 2.2, 0, 0.1, 0.3, 0, 2.2, 1.9, 1.5));
  root.add(mesh(G.dodeca(), moss, 0, 3.05, -0.1, 0, 0, 0, 1.8, 0.5, 1.2));
  root.add(mesh(G.dodeca(), stoneD, 0, 3.45, 0.25, 0, 0, 0, 0.8, 0.7, 0.75));
  for (const sx of [-1, 1]) root.add(mesh(G.sphere(0), rune, sx * 0.18, 3.5, 0.6, 0, 0, 0, 0.13));
  root.add(mesh(G.sphere(0), rune, 0, 2.3, 0.72, 0, 0, 0, 0.42));
  return root;
}

const CREATURE_BUILDERS = { slime, wolf, golem };

/** Fallback for an animated (character/creature) model key. */
export function buildCreatureFallback(key) {
  if (HUMANOIDS[key]) return humanoid(key);
  if (CREATURE_BUILDERS[key]) return CREATURE_BUILDERS[key]();
  const root = new THREE.Group();
  root.add(mesh(G.capsule(), flatMat('#aa55cc'), 0, 0.9, 0, 0, 0, 0, 0.6, 1.2, 0.6));
  return root;
}

// ------------------------------------------------------------------ static props
function tree_pine() {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(7), flatMat('#6b4a30'), 0, 0.9, 0, 0, 0, 0, 0.42, 1.8, 0.42));
  const greens = ['#2f5e36', '#36693c', '#3f7644'];
  for (let i = 0; i < 3; i++) g.add(mesh(G.cone(8), flatMat(greens[i]), 0, 1.9 + i * 1.35, 0, 0, i * 0.4, 0, 3.4 - i * 0.85, 2.4, 3.4 - i * 0.85));
  return g;
}
function tree_oak() {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(7), flatMat('#6a4b33'), 0, 1.3, 0, 0, 0, 0, 0.6, 2.6, 0.6));
  const greens = ['#4e8a3a', '#5a9642', '#467f35'];
  const blobs = [[0, 3.6, 0, 3.4], [1.0, 3.2, 0.5, 2.3], [-0.9, 3.3, -0.4, 2.4], [0.2, 4.4, -0.3, 2.3]];
  blobs.forEach(([x, y, z, s], i) => g.add(mesh(G.sphere(1), flatMat(greens[i % 3]), x, y, z, 0, i, 0, s)));
  return g;
}
function tree_dead() {
  const g = new THREE.Group();
  const bark = flatMat('#6e675f');
  g.add(mesh(G.cyl(6), bark, 0, 1.4, 0, 0.05, 0, 0.06, 0.4, 2.8, 0.4));
  g.add(mesh(G.cyl(5), bark, 0.55, 2.9, 0, 0, 0, -0.8, 0.16, 1.5, 0.16));
  g.add(mesh(G.cyl(5), bark, -0.45, 3.2, 0.2, 0.3, 0, 0.7, 0.13, 1.3, 0.13));
  g.add(mesh(G.cyl(5), bark, 0.05, 3.5, -0.3, -0.6, 0, 0.1, 0.1, 1.2, 0.1));
  return g;
}
function rock_a() {
  const g = new THREE.Group();
  g.add(mesh(G.dodeca(), flatMat('#8b8781'), 0, 0.45, 0, 0.3, 0.5, 0.1, 1.8, 1.2, 1.6));
  return g;
}
function rock_b() {
  const g = new THREE.Group();
  g.add(mesh(G.dodeca(), flatMat('#807c75'), 0, 1.3, 0, 0.1, 0.3, 0.05, 1.7, 2.8, 1.5));
  g.add(mesh(G.dodeca(), flatMat('#908b84'), 0.9, 0.5, 0.4, 0.4, 0.2, 0, 1.3, 1.1, 1.2));
  g.add(mesh(G.dodeca(), flatMat('#6f6b65'), -0.8, 0.4, -0.3, 0.2, 0.8, 0, 1.1, 0.9, 1.0));
  return g;
}
function bush() {
  const g = new THREE.Group();
  const m1 = flatMat('#4f8a3c'), m2 = flatMat('#5c9a45');
  g.add(mesh(G.sphere(1), m1, 0, 0.42, 0, 0, 0, 0, 1.0, 0.8, 1.0));
  g.add(mesh(G.sphere(1), m2, 0.35, 0.35, 0.15, 0, 1, 0, 0.7));
  g.add(mesh(G.sphere(1), m2, -0.3, 0.33, -0.2, 0, 2, 0, 0.65));
  g.add(mesh(G.sphere(0), flatMat('#c0304a'), 0.2, 0.62, 0.35, 0, 0, 0, 0.1));
  return g;
}
function flowers() {
  const g = new THREE.Group();
  const cols = ['#e84a5f', '#ffd23f', '#f4f1ea', '#a06cd5', '#ff8c42'];
  const stem = flatMat('#4f8a3c');
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996, r = 0.12 + (i % 4) * 0.12;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    g.add(mesh(G.cyl(4), stem, x, 0.15, z, 0, 0, 0, 0.03, 0.3, 0.03));
    g.add(mesh(G.sphere(0), flatMat(cols[i % cols.length]), x, 0.32, z, 0, 0, 0, 0.12));
  }
  return g;
}
function house() {
  const g = new THREE.Group();
  g.add(mesh(G.box(), flatMat('#7c776f'), 0, 0.35, 0, 0, 0, 0, 6.2, 0.7, 6.2));
  g.add(mesh(G.box(), flatMat('#e3d4b0'), 0, 2.0, 0, 0, 0, 0, 5.8, 2.7, 5.8));
  for (const x of [-2.85, 0, 2.85]) g.add(mesh(G.box(), flatMat('#5a3c24'), x, 2.0, 2.92, 0, 0, 0, 0.22, 2.7, 0.1));
  const roofGeo = geo('roofPrism', () => {
    const s = new THREE.Shape();
    s.moveTo(-3.5, 0); s.lineTo(3.5, 0); s.lineTo(0, 2.3); s.closePath();
    const e = new THREE.ExtrudeGeometry(s, { depth: 6.6, bevelEnabled: false });
    e.translate(0, 0, -3.3);
    return e;
  });
  g.add(mesh(roofGeo, flatMat('#9a4a32'), 0, 3.3, 0, 0, Math.PI / 2, 0));
  g.add(mesh(G.box(), flatMat('#6f6a64'), 1.6, 5.0, -1.0, 0, 0, 0, 0.6, 1.6, 0.6));
  g.add(mesh(G.box(), flatMat('#4a3020'), 0, 1.45, 2.93, 0, 0, 0, 1.1, 1.9, 0.1));
  const win = flatMat('#ffd98a', { emissive: '#ffb347', ei: 0.6 });
  for (const x of [-1.8, 1.8]) g.add(mesh(G.box(), win, x, 2.3, 2.93, 0, 0, 0, 0.8, 0.7, 0.06));
  for (const x of [-2.93, 2.93]) g.add(mesh(G.box(), win, x, 2.3, 0, 0, 0, 0, 0.06, 0.7, 0.8));
  return g;
}
function well() {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(12), flatMat('#8a857c'), 0, 0.45, 0, 0, 0, 0, 2.3, 0.9, 2.3));
  g.add(mesh(G.cyl(12), flatMat('#23303a'), 0, 0.91, 0, 0, 0, 0, 1.7, 0.03, 1.7));
  for (const x of [-0.95, 0.95]) g.add(mesh(G.box(), flatMat('#6b4a2e'), x, 1.5, 0, 0, 0, 0, 0.14, 2.0, 0.14));
  g.add(mesh(G.cone(4), flatMat('#8b3a2a'), 0, 2.75, 0, 0, Math.PI / 4, 0, 2.6, 0.9, 1.9));
  g.add(mesh(G.cyl(8), flatMat('#6b4a2e'), 0, 1.3, 0, 0, 0, 0, 0.3, 0.3, 0.3));
  return g;
}
function fence() {
  const g = new THREE.Group();
  const w = flatMat('#7a5836'), w2 = flatMat('#8a6a44');
  for (const x of [-0.95, 0.95]) g.add(mesh(G.box(), w, x, 0.5, 0, 0, 0, 0, 0.14, 1.0, 0.14));
  for (const y of [0.4, 0.78]) g.add(mesh(G.box(), w2, 0, y, 0, 0, 0, 0, 2.0, 0.1, 0.07));
  return g;
}
function lamp_post() {
  const g = new THREE.Group();
  const iron = flatMat('#2d2d33', { rough: 0.5, metal: 0.6 });
  g.add(mesh(G.cyl(8), flatMat('#55524d'), 0, 0.15, 0, 0, 0, 0, 0.45, 0.3, 0.45));
  g.add(mesh(G.cyl(6), iron, 0, 1.5, 0, 0, 0, 0, 0.12, 2.8, 0.12));
  g.add(mesh(G.box(), flatMat('#ffd27a', { emissive: '#ffb347', ei: 2.5 }), 0, 2.75, 0, 0, 0, 0, 0.32, 0.4, 0.32));
  g.add(mesh(G.cone(4), iron, 0, 3.05, 0, 0, Math.PI / 4, 0, 0.5, 0.25, 0.5));
  return g;
}
function crate() {
  const g = new THREE.Group();
  g.add(mesh(G.box(), flatMat('#9a6e40'), 0, 0.45, 0, 0, 0, 0, 0.9, 0.9, 0.9));
  g.add(mesh(G.box(), flatMat('#6e4a28'), 0, 0.45, 0, 0, 0, 0, 0.94, 0.14, 0.94));
  return g;
}
function barrel() {
  const g = new THREE.Group();
  const lathe = geo('barrelLathe', () => {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector2(0.38 + Math.sin(t * Math.PI) * 0.08, t * 1.1));
    }
    return new THREE.LatheGeometry(pts, 12);
  });
  g.add(mesh(lathe, flatMat('#8a5e36'), 0, 0, 0));
  for (const y of [0.18, 0.92]) g.add(mesh(G.cyl(12), flatMat('#3a3a3f', { metal: 0.6, rough: 0.5 }), 0, y, 0, 0, 0, 0, 0.88, 0.06, 0.88));
  return g;
}
function campfire() {
  const g = new THREE.Group();
  const stone = flatMat('#77736c');
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    g.add(mesh(G.dodeca(), stone, Math.cos(a) * 0.7, 0.1, Math.sin(a) * 0.7, i, i, 0, 0.35, 0.25, 0.3));
  }
  const log = flatMat('#5a3a22');
  for (let i = 0; i < 3; i++) g.add(mesh(G.cyl(6), log, 0, 0.18, 0, Math.PI / 2 - 0.3, (i / 3) * Math.PI * 2, 0, 0.14, 1.0, 0.14));
  const flame = flatMat('#ffb347', { emissive: '#ff7a1a', ei: 3 });
  g.add(mesh(G.cone(6), flame, 0, 0.55, 0, 0, 0, 0, 0.5, 0.8, 0.5));
  g.add(mesh(G.cone(6), flatMat('#fff0a0', { emissive: '#ffd060', ei: 3 }), 0, 0.5, 0, 0, 0.5, 0, 0.28, 0.55, 0.28));
  return g;
}
function tent() {
  const g = new THREE.Group();
  g.add(mesh(G.cone(5), flatMat('#8a6a48'), 0, 1.35, 0, 0, 0, 0, 3.5, 2.7, 3.5));
  g.add(mesh(G.box(), flatMat('#2e2218'), 0, 0.55, 1.2, -0.35, 0, 0, 0.9, 1.1, 0.1));
  g.add(mesh(G.cyl(5), flatMat('#5a3a22'), 0, 2.9, 0, 0, 0, 0.1, 0.08, 0.8, 0.08));
  return g;
}
function gravestone() {
  const g = new THREE.Group();
  const s = flatMat('#8d8a84');
  g.add(mesh(G.box(), s, 0, 0.42, 0, 0, 0, 0, 0.6, 0.84, 0.16));
  g.add(mesh(G.cyl(10), s, 0, 0.84, 0, Math.PI / 2, 0, 0, 0.6, 0.16, 0.6));
  g.add(mesh(G.box(), flatMat('#6e6b66'), 0, 0.05, 0.1, 0, 0, 0, 0.75, 0.1, 0.45));
  return g;
}
function stall() {
  const g = new THREE.Group();
  const wood = flatMat('#7a5836');
  g.add(mesh(G.box(), wood, 0, 0.5, 0.3, 0, 0, 0, 2.8, 1.0, 0.9));
  for (const [x, z] of [[-1.35, 0.7], [1.35, 0.7], [-1.35, -0.8], [1.35, -0.8]]) g.add(mesh(G.box(), wood, x, 1.25, z, 0, 0, 0, 0.12, 2.5, 0.12));
  for (let i = 0; i < 6; i++) g.add(mesh(G.box(), flatMat(i % 2 ? '#f2eee4' : '#c0392b'), -1.25 + i * 0.5, 2.55, 0, 0.25, 0, 0, 0.5, 0.06, 2.0));
  for (let i = 0; i < 5; i++) g.add(mesh(G.sphere(0), flatMat(['#e84a5f', '#ffd23f', '#6aa33a', '#ff8c42', '#a06cd5'][i]), -1.0 + i * 0.5, 1.1, 0.4, 0, 0, 0, 0.25));
  return g;
}

const STATIC_BUILDERS = {
  tree_pine, tree_oak, tree_dead, rock_a, rock_b, bush, flowers, house, well, fence, lamp_post,
  crate, barrel, campfire, tent, gravestone, stall,
};

/** Fallback for a static prop key (a Group of meshes). */
export function buildStaticFallback(key) {
  const b = STATIC_BUILDERS[key];
  if (b) return b();
  const g = new THREE.Group();
  g.add(mesh(G.box(), flatMat('#aa55cc'), 0, 0.5, 0));
  return g;
}
