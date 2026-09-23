// Minimap (top-right): static world map pre-rendered once from shared/world.js (height colours,
// hill shading, water, roads, village, props), then dynamic dots drawn on every update. North (−Z) up.
import {
  WORLD_HALF, WORLD_LIMIT, WATER_LEVEL, LAKES, ROADS, ROAD_WIDTH, REGIONS, VILLAGE,
  terrainHeight, regionAt, generateWorldObjects,
} from '@shared/world.js';
import { h, setText, fmt } from './dom.js';
import { simpleTooltip } from './tooltip.js';

const GRID = 360;                 // heightmap samples per side (1 m)
const MAP_PX = 2048;              // static map canvas size (shared with the world map, M)
const K = MAP_PX / (WORLD_HALF * 2);
const ZOOMS = [36, 60, 95, 180];  // visible radius in metres
const DOT = {
  player: '#62b6ff',
  monster: '#ff4b3a',
  boss: '#c35cff',
  npc: '#ffd24a',
};

const lerp = (a, b, t) => a + (b - a) * t;
function mix(c1, c2, t) {
  t = Math.max(0, Math.min(1, t));
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

function baseColor(x, z, hgt) {
  if (hgt < WATER_LEVEL) {
    const d = WATER_LEVEL - hgt;
    return mix([74, 142, 176], [26, 62, 104], d / 3.2);
  }
  const above = hgt - WATER_LEVEL;
  let c;
  if (above < 0.7) c = mix([186, 170, 116], [121, 150, 72], above / 0.7); // sand → grass
  else if (hgt < 9) c = mix([104, 146, 64], [78, 118, 52], (hgt - 0.5) / 8.5);
  else if (hgt < 20) c = mix([96, 110, 72], [124, 116, 104], (hgt - 9) / 11);
  else c = mix([128, 122, 112], [236, 240, 244], (hgt - 20) / 10);
  // region tints
  const inR = (id, f) => {
    const r = REGION_BY_ID[id];
    if (!r) return 0;
    const d = Math.hypot(x - r.x, z - r.z);
    return Math.max(0, Math.min(1, (r.r - d) / (r.r * f)));
  };
  const forest = inR('forest', 0.35);
  if (forest > 0 && hgt < 12) c = mix(c, [52, 92, 44], forest * 0.8);
  const grave = Math.max(inR('graveyard', 0.4), inR('lair', 0.4));
  if (grave > 0) c = mix(c, [98, 102, 88], grave * 0.75);
  const camp = inR('goblins', 0.5);
  if (camp > 0) c = mix(c, [132, 112, 72], camp * 0.55);
  return c;
}

/** Build the static map progressively (a few rows per frame) so the main thread never stalls. */
function buildStaticMap(onDone) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MAP_PX;
  const heights = new Float32Array((GRID + 1) * (GRID + 1));
  const step = (WORLD_HALF * 2) / GRID;
  let row = 0;
  const work = () => {
    const t0 = performance.now();
    while (row <= GRID && performance.now() - t0 < 10) {
      const z = -WORLD_HALF + row * step;
      for (let i = 0; i <= GRID; i++) heights[row * (GRID + 1) + i] = terrainHeight(-WORLD_HALF + i * step, z);
      row++;
    }
    if (row <= GRID) {
      setTimeout(work, 0);
      return;
    }
    finish();
  };
  const finish = () => {
    // colour + hill shading into a GRID×GRID image, then scale up with smoothing
    const small = document.createElement('canvas');
    small.width = small.height = GRID;
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(GRID, GRID);
    const H = (i, j) => heights[Math.min(GRID, Math.max(0, j)) * (GRID + 1) + Math.min(GRID, Math.max(0, i))];
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const hv = H(i, j);
        const x = -WORLD_HALF + (i + 0.5) * step;
        const z = -WORLD_HALF + (j + 0.5) * step;
        let c = baseColor(x, z, hv);
        if (hv >= WATER_LEVEL) {
          const dx = H(i + 1, j) - H(i - 1, j);
          const dz = H(i, j + 1) - H(i, j - 1);
          const shade = Math.max(0.62, Math.min(1.3, 1 - (dx + dz) * 0.16));
          c = [c[0] * shade, c[1] * shade, c[2] * shade];
        } else {
          // shoreline foam
          const nearShore = H(i + 1, j) >= WATER_LEVEL || H(i - 1, j) >= WATER_LEVEL || H(i, j + 1) >= WATER_LEVEL || H(i, j - 1) >= WATER_LEVEL;
          if (nearShore) c = mix(c, [150, 200, 214], 0.45);
        }
        const o = (j * GRID + i) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, MAP_PX, MAP_PX);
    const P = (v) => (v + WORLD_HALF) * K;

    // lake sheen
    for (const l of LAKES) {
      const g = ctx.createRadialGradient(P(l.x) - l.r * K * 0.3, P(l.z) - l.r * K * 0.3, 0, P(l.x), P(l.z), l.r * K);
      g.addColorStop(0, 'rgba(160,210,235,0.28)');
      g.addColorStop(1, 'rgba(160,210,235,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(P(l.x), P(l.z), l.r * K, 0, Math.PI * 2);
      ctx.fill();
    }
    // roads: dark edge then tan fill
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [w, col] of [[ROAD_WIDTH * K + 3, 'rgba(70,52,30,0.55)'], [ROAD_WIDTH * K, '#bfa270']]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      for (const road of ROADS) {
        ctx.beginPath();
        road.forEach(([x, z], i) => (i ? ctx.lineTo(P(x), P(z)) : ctx.moveTo(P(x), P(z))));
        ctx.stroke();
      }
    }
    // village plaza
    const vg = ctx.createRadialGradient(P(VILLAGE.x), P(VILLAGE.z), 0, P(VILLAGE.x), P(VILLAGE.z), 15 * K);
    vg.addColorStop(0, 'rgba(198,176,128,0.95)');
    vg.addColorStop(0.75, 'rgba(186,160,112,0.75)');
    vg.addColorStop(1, 'rgba(186,160,112,0)');
    ctx.fillStyle = vg;
    ctx.beginPath();
    ctx.arc(P(VILLAGE.x), P(VILLAGE.z), 15 * K, 0, Math.PI * 2);
    ctx.fill();

    // props
    let objs = [];
    try {
      objs = generateWorldObjects();
    } catch {
      objs = [];
    }
    const disc = (x, z, r, fill, stroke) => {
      ctx.beginPath();
      ctx.arc(P(x), P(z), Math.max(0.8, r * K), 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };
    for (const o of objs) {
      switch (o.type) {
        case 'tree_pine': disc(o.x, o.z, 1.5 * o.s, 'rgba(24,58,30,0.82)'); break;
        case 'tree_oak': disc(o.x, o.z, 1.9 * o.s, 'rgba(40,78,32,0.8)'); break;
        case 'tree_dead': disc(o.x, o.z, 1.1 * o.s, 'rgba(70,64,58,0.85)'); break;
        case 'rock_a': case 'rock_b': disc(o.x, o.z, o.r * 0.9, 'rgba(128,124,118,0.9)', 'rgba(40,38,34,0.5)'); break;
        case 'gravestone': disc(o.x, o.z, 0.55, 'rgba(210,210,200,0.9)'); break;
        case 'tent': disc(o.x, o.z, 1.7, 'rgba(120,82,48,0.95)', 'rgba(40,24,10,0.6)'); break;
        case 'campfire': disc(o.x, o.z, 1.1, '#ff9a3c', 'rgba(80,30,0,0.8)'); break;
        case 'well': disc(o.x, o.z, 1.3, '#6aa6c8', 'rgba(40,40,40,0.8)'); break;
        case 'house': {
          ctx.save();
          ctx.translate(P(o.x), P(o.z));
          ctx.rotate(-o.ry);
          const s = 6 * K;
          ctx.fillStyle = '#8a4a32';
          ctx.strokeStyle = 'rgba(30,16,8,0.85)';
          ctx.lineWidth = 1.5;
          ctx.fillRect(-s / 2, -s / 2, s, s);
          ctx.strokeRect(-s / 2, -s / 2, s, s);
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(-s / 2, 0, s, s / 2);
          ctx.restore();
          break;
        }
        case 'stall': disc(o.x, o.z, 1.5, '#c9563c', 'rgba(40,16,8,0.7)'); break;
        case 'fence': disc(o.x, o.z, 0.45, 'rgba(92,64,36,0.9)'); break;
        default: break;
      }
    }
    // outside the walkable world: darken the border mountains slightly
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(P(-WORLD_LIMIT), P(-WORLD_LIMIT), WORLD_LIMIT * 2 * K, WORLD_LIMIT * 2 * K);
    onDone(canvas);
  };
  setTimeout(work, 0);
}

// [accounts] one static map for the minimap and the full-screen world map
let staticCanvas = null;
let staticWaiters = null;
/** The pre-rendered world map canvas (MAP_PX², world [-WORLD_HALF, WORLD_HALF]); built once, on first use. */
export function getStaticMap(cb) {
  if (staticCanvas) { cb(staticCanvas); return; }
  if (staticWaiters) { staticWaiters.push(cb); return; }
  staticWaiters = [cb];
  buildStaticMap((c) => {
    staticCanvas = c;
    const list = staticWaiters;
    staticWaiters = null;
    for (const fn of list) fn(c);
  });
}
export const STATIC_MAP_PX = MAP_PX;

/** [accounts] Personal marker (world map click) drawn on the minimap: a gold pin, on the rim when far away. */
function drawMarker(ctx, m, px, pz, scale, cx, dotR) {
  let dx = (m.x - px) * scale, dz = (m.z - pz) * scale;
  const d = Math.hypot(dx, dz);
  const rim = cx - dotR * 2.4;
  if (d > rim) { dx *= rim / d; dz *= rim / d; }
  const x = cx + dx, y = cx + dz, r = dotR * 1.35;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = r;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - r * 1.4, y - r * 1.6, x - r * 1.1, y - r * 3.1, x, y - r * 3.1);
  ctx.bezierCurveTo(x + r * 1.1, y - r * 3.1, x + r * 1.4, y - r * 1.6, x, y);
  ctx.fillStyle = '#ffd35a';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, r / 3);
  ctx.strokeStyle = '#3a2508';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y - r * 2.05, r * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = '#3a2508';
  ctx.fill();
  ctx.restore();
}

/** [combat-souls] Death echo marker (cyan diamond with a glow; on the rim with an arrow when far away). */
function drawEcho(ctx, e, px, pz, scale, cx, dotR, W) {
  let dx = (e.x - px) * scale, dz = (e.z - pz) * scale;
  const d = Math.hypot(dx, dz);
  const rim = cx - dotR * 2.2;
  const far = d > rim;
  if (far) { dx *= rim / d; dz *= rim / d; }
  const x = cx + dx, y = cx + dz, r = dotR * 1.5;
  ctx.save();
  ctx.shadowColor = 'rgba(90, 225, 255, 0.95)';
  ctx.shadowBlur = r * 2.2;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.3);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r * 1.3);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = '#8ff0ff';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, W / 180);
  ctx.strokeStyle = '#0b3140';
  ctx.stroke();
  if (far) {
    const a = Math.atan2(dz, dx);
    ctx.translate(x + Math.cos(a) * r * 1.9, y + Math.sin(a) * r * 1.9);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(r * 0.8, 0);
    ctx.lineTo(-r * 0.4, r * 0.6);
    ctx.lineTo(-r * 0.4, -r * 0.6);
    ctx.closePath();
    ctx.fillStyle = '#8ff0ff';
    ctx.fill();
  }
  ctx.restore();
}

export function createMinimap(parent, tooltip) {
  const canvas = h('canvas', { class: 'bv-mm-canvas', 'aria-label': 'Minicarte', role: 'img' });
  const zoneEl = h('div', { class: 'bv-mm-zone' });
  const coordEl = h('div', { class: 'bv-mm-coords' });
  const zoomIn = h('button', { class: 'bv-mm-zoom in', type: 'button', 'aria-label': 'Zoom avant', text: '+' });
  const zoomOut = h('button', { class: 'bv-mm-zoom out', type: 'button', 'aria-label': 'Zoom arrière', text: '−' });
  const ring = h('div', { class: 'bv-mm-ring' },
    canvas,
    h('div', { class: 'bv-mm-glass' }),
    h('div', { class: 'bv-mm-north' }, h('span', { text: 'N' })),
    zoomIn, zoomOut);
  const statusOnline = h('span', { class: 'bv-st-online' });
  const statusPing = h('span', { class: 'bv-st-ping' });
  const statusFps = h('span', { class: 'bv-st-fps' });
  const status = h('div', { class: 'bv-status' }, statusOnline, statusPing, statusFps);
  const el = h('div', { class: 'bv-minimap' }, zoneEl, ring, coordEl, status);
  parent.appendChild(el);
  tooltip.bind(zoneEl, () => {
    const r = last ? regionAt(last.x, last.z) : null;
    return r ? simpleTooltip(r.name, r.safe ? 'Zone sûre : aucun combat possible.' : 'Soyez prudent, des créatures rôdent.') : null;
  });

  let staticMap = null;
  let marker = null; // [accounts] { x, z } personal marker
  let zoomIdx = 1;
  let last = null;
  const ctx = canvas.getContext('2d');
  let W = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(64, Math.round(r.width * dpr));
    if (w !== W) {
      W = w;
      canvas.width = canvas.height = W;
    }
  }

  function draw() {
    if (!W) resize();
    if (!W) return;
    const cx = W / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cx, cx, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#1b2230';
    ctx.fillRect(0, 0, W, W);
    const px = last ? last.x : 0;
    const pz = last ? last.z : 0;
    const R = ZOOMS[zoomIdx];
    const scale = cx / R; // px per metre
    if (staticMap) {
      ctx.imageSmoothingEnabled = true;
      const sx = (px - R + WORLD_HALF) * K;
      const sz = (pz - R + WORLD_HALF) * K;
      ctx.drawImage(staticMap, sx, sz, 2 * R * K, 2 * R * K, 0, 0, W, W);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `${Math.round(W / 14)}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Cartographie…', cx, cx);
    }
    // grid-less subtle vignette
    const vg = ctx.createRadialGradient(cx, cx, cx * 0.55, cx, cx, cx);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, W);

    if (last) {
      const dotR = Math.max(2.5, W / 64);
      const ents = Array.isArray(last.ents) ? last.ents : [];
      // draw order: npcs, monsters, players, bosses on top
      const order = { npc: 0, monster: 1, player: 2 };
      const sorted = ents.slice().sort((a, b) => (order[a.k] ?? 1) + (a.boss ? 3 : 0) - ((order[b.k] ?? 1) + (b.boss ? 3 : 0)));
      for (const e of sorted) {
        if (e.k === 'echo') continue; // [combat-souls] drawn below
        const dx = (e.x - px) * scale;
        const dz = (e.z - pz) * scale;
        if (dx * dx + dz * dz > (cx - dotR) * (cx - dotR)) continue;
        const x = cx + dx;
        const y = cx + dz;
        const color = e.boss ? DOT.boss : DOT[e.k] || DOT.monster;
        const r = e.boss ? dotR * 1.8 : e.k === 'npc' ? dotR * 1.15 : dotR;
        ctx.beginPath();
        if (e.k === 'npc') {
          // diamond
          ctx.moveTo(x, y - r * 1.2);
          ctx.lineTo(x + r, y);
          ctx.lineTo(x, y + r * 1.2);
          ctx.lineTo(x - r, y);
          ctx.closePath();
        } else ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = Math.max(1, W / 180);
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.stroke();
        if (e.boss) {
          ctx.beginPath();
          ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(195,92,255,0.55)';
          ctx.stroke();
        }
      }
      // [combat-souls] death echo: glowing marker, pinned to the rim when out of range
      if (last.echo) drawEcho(ctx, last.echo, px, pz, scale, cx, dotR, W);
      if (marker) drawMarker(ctx, marker, px, pz, scale, cx, dotR); // [accounts]
      // self arrow — ry = atan2(dirX, dirZ); map x → right, z → down
      const ry = Number(last.ry) || 0;
      const ang = Math.atan2(Math.cos(ry), Math.sin(ry));
      const a = Math.max(6, W / 17);
      ctx.save();
      ctx.translate(cx, cx);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(a, 0);
      ctx.lineTo(-a * 0.7, a * 0.62);
      ctx.lineTo(-a * 0.35, 0);
      ctx.lineTo(-a * 0.7, -a * 0.62);
      ctx.closePath();
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = a * 0.5;
      ctx.fillStyle = '#fff6da';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(1, W / 160);
      ctx.strokeStyle = '#3a2a08';
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function setZoom(i) {
    zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, i));
    zoomIn.disabled = zoomIdx === 0;
    zoomOut.disabled = zoomIdx === ZOOMS.length - 1;
    draw();
  }
  zoomIn.addEventListener('click', () => setZoom(zoomIdx - 1));
  zoomOut.addEventListener('click', () => setZoom(zoomIdx + 1));
  ring.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(zoomIdx + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });
  setZoom(zoomIdx);

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); draw(); }) : null;
  ro?.observe(canvas);
  window.addEventListener('resize', () => { resize(); draw(); });

  let building = false;
  function ensureMap() {
    if (building || staticMap) return;
    building = true;
    getStaticMap((c) => {
      staticMap = c;
      draw();
    });
  }

  return {
    ensureMap,
    update(d) {
      if (!d) return;
      ensureMap();
      last = d;
      const region = regionAt(Number(d.x) || 0, Number(d.z) || 0);
      setText(zoneEl, region.name);
      el.classList.toggle('safe', !!region.safe);
      setText(coordEl, `${fmt(d.x)} · ${fmt(d.z)}`);
      draw();
    },
    setMarker(m) {
      marker = m && Number.isFinite(m.x) && Number.isFinite(m.z) ? { x: m.x, z: m.z } : null;
      draw();
    },
    setStatus(s) {
      if (!s) return;
      if (s.online != null) setText(statusOnline, `${fmt(s.online)} en ligne`);
      if (s.ping != null) {
        const p = Math.round(s.ping);
        setText(statusPing, `${p} ms`);
        statusPing.className = `bv-st-ping ${p < 100 ? 'good' : p < 220 ? 'mid' : 'bad'}`;
      }
      if (s.fps != null) setText(statusFps, `${Math.round(s.fps)} ips`);
    },
  };
}

