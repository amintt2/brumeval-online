// Atmospheric backdrop shared by the login and loading screens: night sky, moon, stars,
// layered misty mountain ridges, a pine forest silhouette, drifting fog and floating embers.
// Built with createElementNS from generated numbers only (no markup strings).
import { h } from './dom.js';
import { mulberry32 } from '@shared/noise.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  for (const c of kids) e.appendChild(c);
  return e;
}

function ridge(rand, base, amp, rough, W, H) {
  // midpoint displacement → jagged mountain line
  let pts = [[0, base + (rand() - 0.5) * amp], [W, base + (rand() - 0.5) * amp]];
  let a = amp;
  for (let it = 0; it < 7; it++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      next.push([(x0 + x1) / 2, (y0 + y1) / 2 + (rand() - 0.5) * a], pts[i]);
    }
    pts = next;
    a *= rough;
  }
  let d = `M0 ${H} `;
  for (const [x, y] of pts) d += `L${x.toFixed(1)} ${y.toFixed(1)} `;
  return `${d}L${W} ${H}Z`;
}

function forest(rand, base, W, H) {
  let d = `M0 ${H} L0 ${base} `;
  let x = 0;
  while (x < W) {
    const w = 14 + rand() * 22;
    const th = 30 + rand() * 70;
    const y = base + Math.sin(x * 0.004) * 16 + (rand() - 0.5) * 8;
    // pine: three stacked tiers
    const cx = x + w / 2;
    d += `L${x.toFixed(1)} ${y.toFixed(1)} `;
    d += `L${(cx - w * 0.35).toFixed(1)} ${(y - th * 0.35).toFixed(1)} L${(cx - w * 0.18).toFixed(1)} ${(y - th * 0.35).toFixed(1)} `;
    d += `L${(cx - w * 0.28).toFixed(1)} ${(y - th * 0.62).toFixed(1)} L${(cx - w * 0.1).toFixed(1)} ${(y - th * 0.62).toFixed(1)} `;
    d += `L${cx.toFixed(1)} ${(y - th).toFixed(1)} `;
    d += `L${(cx + w * 0.1).toFixed(1)} ${(y - th * 0.62).toFixed(1)} L${(cx + w * 0.28).toFixed(1)} ${(y - th * 0.62).toFixed(1)} `;
    d += `L${(cx + w * 0.18).toFixed(1)} ${(y - th * 0.35).toFixed(1)} L${(cx + w * 0.35).toFixed(1)} ${(y - th * 0.35).toFixed(1)} `;
    d += `L${(x + w).toFixed(1)} ${y.toFixed(1)} `;
    x += w * (0.55 + rand() * 0.5);
  }
  return `${d}L${W} ${H}Z`;
}

export function createBackdrop() {
  const rand = mulberry32(4242);
  const W = 1600;
  const H = 900;
  const grad = (id, top, bottom) =>
    s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: 0, 'stop-color': top }),
      s('stop', { offset: 1, 'stop-color': bottom }));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMax slice', class: 'bv-bd-svg', 'aria-hidden': 'true' },
    s('defs', {},
      grad('bvbd-r1', '#3a4660', '#1c2333'),
      grad('bvbd-r2', '#262f44', '#121824'),
      grad('bvbd-r3', '#171d2b', '#0b0f17'),
      grad('bvbd-r4', '#0b0e15', '#050609')),
    s('path', { d: ridge(rand, 470, 260, 0.52, W, H), fill: 'url(#bvbd-r1)', opacity: 0.75 }),
    s('path', { d: ridge(rand, 560, 200, 0.5, W, H), fill: 'url(#bvbd-r2)', opacity: 0.92 }),
    s('path', { d: ridge(rand, 660, 150, 0.48, W, H), fill: 'url(#bvbd-r3)' }),
    s('path', { d: forest(rand, 800, W, H), fill: 'url(#bvbd-r4)' }));

  // stars as one element with many box-shadows (numbers only)
  const stars = h('div', { class: 'bv-bd-stars' });
  const shadows = [];
  for (let i = 0; i < 140; i++) {
    const x = (rand() * 100).toFixed(2);
    const y = (rand() * 55).toFixed(2);
    const a = (0.25 + rand() * 0.7).toFixed(2);
    const sz = rand() < 0.12 ? 1.5 : 0.5;
    shadows.push(`${x}vw ${y}vh 0 ${sz}px rgba(255,245,225,${a})`);
  }
  stars.style.boxShadow = shadows.join(',');

  const embers = h('div', { class: 'bv-bd-embers' });
  for (let i = 0; i < 18; i++) {
    const e = h('span', { class: 'bv-ember' });
    e.style.left = `${(rand() * 100).toFixed(1)}%`;
    e.style.animationDelay = `${(-rand() * 14).toFixed(2)}s`;
    e.style.animationDuration = `${(9 + rand() * 9).toFixed(2)}s`;
    e.style.setProperty('--drift', `${((rand() - 0.5) * 18).toFixed(1)}vw`);
    const sz = 2 + rand() * 3;
    e.style.width = e.style.height = `${sz.toFixed(1)}px`;
    embers.appendChild(e);
  }

  return h('div', { class: 'bv-backdrop', 'aria-hidden': 'true' },
    h('div', { class: 'bv-bd-sky' }),
    stars,
    h('div', { class: 'bv-bd-moon' }),
    svg,
    h('div', { class: 'bv-bd-fog f1' }),
    h('div', { class: 'bv-bd-fog f2' }),
    h('div', { class: 'bv-bd-fog f3' }),
    embers,
    h('div', { class: 'bv-bd-vignette' }));
}
