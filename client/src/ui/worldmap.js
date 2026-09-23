// [accounts] Full-screen world map (M or Menu → Carte): the pre-rendered map of the current world (the same one as
// the minimap, bigger), regions and names, village / camps, roads, lakes, NPCs, objectives of the active quests,
// other players nearby, the player's position and facing, zoom (wheel) and pan (drag), click to place a personal
// marker (also on the minimap), Escape or M to close. Everything comes from a map descriptor (mapdata.js).
import { h, setText } from './dom.js';
import { glyph } from './icons.js';
import { regionAt } from '@shared/world.js';

const POI_STYLE = {
  village: { fill: '#f2d58c', stroke: '#3a2a08', letter: 'V' },
  camp: { fill: '#e0a050', stroke: '#3a1d08', letter: 'C' },
  danger: { fill: '#b9c0c8', stroke: '#1b1f24', letter: '†' },
  boss: { fill: '#c35cff', stroke: '#240933', letter: '!' },
};

export function createWorldMap(parent, { onMarker, onClose } = {}) {
  let desc = null;
  let base = null;
  let open = false;
  let W = 0, H = 0, dpr = 1;
  const view = { x: 0, z: 0, scale: 1, fit: 1 };
  let live = null;   // { x, z, ry, ents, self }
  let marker = null;
  let hover = null;  // world point under the pointer

  const canvas = h('canvas', { class: 'bv-wm-canvas', 'aria-label': 'Carte du monde', role: 'img', tabIndex: 0 });
  const title = h('div', { class: 'bv-wm-title' });
  const hoverEl = h('div', { class: 'bv-wm-hover' });
  const centerBtn = h('button', { class: 'bv-btn small secondary', type: 'button' }, glyph('target'), h('span', { text: 'Centrer sur moi' }));
  const clearBtn = h('button', { class: 'bv-btn small secondary', type: 'button', disabled: true }, glyph('pin'), h('span', { text: 'Retirer le repère' }));
  const closeBtn = h('button', { class: 'bv-btn small', type: 'button' }, glyph('close'), h('span', { text: 'Fermer' }), h('kbd', { text: 'M' }));
  const zoomIn = h('button', { class: 'bv-wm-zoom', type: 'button', 'aria-label': 'Zoom avant', text: '+' });
  const zoomOut = h('button', { class: 'bv-wm-zoom', type: 'button', 'aria-label': 'Zoom arrière', text: '−' });
  const sw = (cls) => h('i', { class: `bv-wm-sw ${cls}` });
  const legend = h('ul', { class: 'bv-wm-legend' },
    h('li', null, sw('self'), h('span', { text: 'Vous' })),
    h('li', null, sw('player'), h('span', { text: 'Joueurs proches' })),
    h('li', null, sw('npc'), h('span', { text: 'Personnages' })),
    h('li', null, sw('quest'), h('span', { text: 'Objectifs de quête' })),
    h('li', null, sw('marker'), h('span', { text: 'Votre repère' })));
  const el = h('div', { class: 'bv-worldmap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Carte du monde', hidden: true },
    canvas,
    h('header', { class: 'bv-wm-top' }, h('div', { class: 'bv-wm-titles' }, title, hoverEl), h('div', { class: 'bv-wm-actions' }, centerBtn, clearBtn, closeBtn)),
    h('div', { class: 'bv-wm-zooms' }, zoomIn, zoomOut),
    h('footer', { class: 'bv-wm-foot' },
      legend,
      h('div', { class: 'bv-wm-hint', text: 'Molette : zoom · Glisser : déplacer · Clic : placer un repère · Clic droit : le retirer' })));
  parent.appendChild(el);
  const ctx = canvas.getContext('2d');

  // ---------------------------------------------------------------- view
  const toScreen = (x, z) => [(x - view.x) * view.scale + W / 2, (z - view.z) * view.scale + H / 2];
  const toWorld = (sx, sy) => ({ x: (sx - W / 2) / view.scale + view.x, z: (sy - H / 2) / view.scale + view.z });
  function clampView() {
    const lim = desc?.limit || 160;
    view.scale = Math.max(view.fit * 0.8, Math.min(view.fit * 10, view.scale));
    view.x = Math.max(-lim, Math.min(lim, view.x));
    view.z = Math.max(-lim, Math.min(lim, view.z));
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(100, Math.round(r.width * dpr)), hh = Math.max(100, Math.round(r.height * dpr));
    if (w !== W || hh !== H) {
      const keep = W ? view.scale / view.fit : null;
      W = canvas.width = w;
      H = canvas.height = hh;
      view.fit = Math.min(W, H) / ((desc?.limit || 160) * 2 + 16);
      view.scale = keep ? keep * view.fit : view.fit;
      clampView();
    }
  }
  function zoomAt(f, sx = W / 2, sy = H / 2) {
    const before = toWorld(sx, sy);
    view.scale *= f;
    clampView();
    const after = toWorld(sx, sy);
    view.x += before.x - after.x;
    view.z += before.z - after.z;
    clampView();
    draw();
  }

  // ---------------------------------------------------------------- drawing
  const px = (v) => v * dpr;
  function label(text, x, y, size, color = '#fff1cc', weight = 700, font = 'Cinzel, Georgia, serif') {
    ctx.font = `${weight} ${Math.round(px(size))}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = px(3);
    ctx.strokeStyle = 'rgba(10,8,6,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
  function diamond(x, y, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r, y); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = px(1.2); ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.stroke();
  }
  function pin(x, y, r) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = r;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - r * 1.4, y - r * 1.6, x - r * 1.1, y - r * 3.1, x, y - r * 3.1);
    ctx.bezierCurveTo(x + r * 1.1, y - r * 3.1, x + r * 1.4, y - r * 1.6, x, y);
    ctx.fillStyle = '#ffd35a'; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = px(1.5); ctx.strokeStyle = '#3a2508'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - r * 2.05, r * 0.45, 0, Math.PI * 2); ctx.fillStyle = '#3a2508'; ctx.fill();
    ctx.restore();
  }

  function draw() {
    if (!open || !desc) return;
    resize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(0, 0, W, H);
    const half = desc.half;
    const [x0, y0] = toScreen(-half, -half);
    const size = half * 2 * view.scale;
    if (base) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(base, x0, y0, size, size);
    } else label('Cartographie en cours…', W / 2, H / 2, 18);
    // outside the walkable area
    const lim = desc.limit;
    const [lx, ly] = toScreen(-lim, -lim);
    const ls = lim * 2 * view.scale;
    ctx.fillStyle = 'rgba(8,10,14,0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(lx, ly, ls, ls);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(242,213,140,0.35)';
    ctx.lineWidth = px(1.5);
    ctx.strokeRect(lx, ly, ls, ls);

    const zoom = view.scale / view.fit;
    // regions: soft dashed outline + name
    ctx.setLineDash([px(6), px(6)]);
    for (const r of desc.regions) {
      const [x, y] = toScreen(r.x, r.z);
      ctx.beginPath();
      ctx.arc(x, y, r.r * view.scale, 0, Math.PI * 2);
      ctx.strokeStyle = r.safe ? 'rgba(140,220,140,0.55)' : 'rgba(242,213,140,0.28)';
      ctx.lineWidth = px(1.4);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // quest objectives
    const quests = desc.questAreas(live?.self);
    for (const q of quests) {
      const [x, y] = toScreen(q.x, q.z);
      const rr = Math.max(px(10), q.r * view.scale);
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,205,80,0.13)';
      ctx.fill();
      ctx.setLineDash([px(8), px(5)]);
      ctx.strokeStyle = 'rgba(255,210,90,0.9)';
      ctx.lineWidth = px(2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // region names (after the quest fills so they stay readable)
    for (const r of desc.regions) {
      const [x, y] = toScreen(r.x, r.z);
      label(r.name, x, y - r.r * view.scale * 0.55, Math.min(20, 11 + zoom * 2.2), r.safe ? '#d9f5c8' : '#f4e3b8');
    }
    for (const q of quests) {
      const [x, y] = toScreen(q.x, q.z);
      const rr = Math.max(px(10), q.r * view.scale);
      label(`! ${q.name}`, x, y + rr + px(12), 13, '#ffd35a', 800, 'Alegreya Sans, sans-serif');
      label(q.label, x, y + rr + px(28), 11.5, '#f6e7c1', 700, 'Alegreya Sans, sans-serif');
    }
    // points of interest
    for (const p of desc.pois) {
      const st = POI_STYLE[p.kind] || POI_STYLE.village;
      const [x, y] = toScreen(p.x, p.z);
      const r = px(9);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = st.fill; ctx.fill();
      ctx.lineWidth = px(2); ctx.strokeStyle = st.stroke; ctx.stroke();
      ctx.font = `800 ${Math.round(px(11))}px Cinzel, Georgia, serif`;
      ctx.fillStyle = st.stroke; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(st.letter, x, y + px(0.5));
    }
    // NPCs
    for (const n of desc.npcs) {
      const [x, y] = toScreen(n.x, n.z);
      diamond(x, y, px(5), '#ffd24a');
      if (zoom > 2.2) label(n.name, x, y - px(14), 11.5, '#ffe9a8', 700, 'Alegreya Sans, sans-serif');
    }
    // other players nearby (area of interest)
    for (const e of live?.ents || []) {
      if (e.k !== 'player') continue;
      const [x, y] = toScreen(e.x, e.z);
      ctx.beginPath(); ctx.arc(x, y, px(4.5), 0, Math.PI * 2);
      ctx.fillStyle = '#62b6ff'; ctx.fill();
      ctx.lineWidth = px(1.2); ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.stroke();
      if (e.n && zoom > 1.6) label(e.n, x, y - px(12), 11, '#cfe6ff', 700, 'Alegreya Sans, sans-serif');
    }
    // personal marker
    if (marker) {
      const [x, y] = toScreen(marker.x, marker.z);
      pin(x, y, px(6));
    }
    // self arrow — ry = atan2(dirX, dirZ); map x → right, z → down
    if (live) {
      const [x, y] = toScreen(live.x, live.z);
      const ang = Math.atan2(Math.cos(live.ry || 0), Math.sin(live.ry || 0));
      const a = px(11);
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath(); ctx.arc(0, 0, a * 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,246,218,0.16)'; ctx.fill();
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(a, 0); ctx.lineTo(-a * 0.7, a * 0.62); ctx.lineTo(-a * 0.35, 0); ctx.lineTo(-a * 0.7, -a * 0.62); ctx.closePath();
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = a * 0.5;
      ctx.fillStyle = '#fff6da'; ctx.fill();
      ctx.shadowBlur = 0; ctx.lineWidth = px(1.5); ctx.strokeStyle = '#3a2a08'; ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- input
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vz: view.z, moved: false, button: e.button };
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    hover = toWorld((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    updateHover();
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved && drag.button === 0) {
      view.x = drag.vx - (dx * dpr) / view.scale;
      view.z = drag.vz - (dy * dpr) / view.scale;
      clampView();
      draw();
    }
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (d.moved) return;
    if (d.button === 2) return setMarker(null, true);
    const r = canvas.getBoundingClientRect();
    const w = toWorld((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    const lim = desc?.limit || 160;
    if (Math.abs(w.x) > lim || Math.abs(w.z) > lim) return;
    setMarker({ x: Math.round(w.x * 10) / 10, z: Math.round(w.z * 10) / 10 }, true);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(e.deltaY > 0 ? 1 / 1.2 : 1.2, (e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const step = 40 / view.scale * dpr;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      view.x += moves[e.key][0]; view.z += moves[e.key][1];
      clampView(); draw();
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(1.25); }
    else if (e.key === '-') { e.preventDefault(); zoomAt(0.8); }
  });
  zoomIn.addEventListener('click', () => zoomAt(1.3));
  zoomOut.addEventListener('click', () => zoomAt(1 / 1.3));
  centerBtn.addEventListener('click', () => {
    if (!live) return;
    view.x = live.x; view.z = live.z;
    if (view.scale < view.fit * 2.5) view.scale = view.fit * 2.5;
    clampView(); draw();
  });
  clearBtn.addEventListener('click', () => setMarker(null, true));
  closeBtn.addEventListener('click', () => api.close());
  window.addEventListener('resize', () => { if (open) draw(); });

  function updateHover() {
    if (!hover || !desc) return setText(hoverEl, '');
    const lim = desc.limit;
    if (Math.abs(hover.x) > lim || Math.abs(hover.z) > lim) return setText(hoverEl, 'Montagnes infranchissables');
    return setText(hoverEl, `${regionAt(hover.x, hover.z).name} · ${Math.round(hover.x)} · ${Math.round(hover.z)}`);
  }

  function setMarker(m, fromUser) {
    marker = m;
    clearBtn.disabled = !m;
    if (fromUser) onMarker?.(m);
    draw();
  }

  const api = {
    get isOpen() { return open; },
    /** Plug a map descriptor (mapdata.js). */
    setMap(d) {
      desc = d;
      setText(title, d.name);
      d.base((c) => { base = c; draw(); });
    },
    open() {
      if (open || !desc) return;
      open = true;
      el.hidden = false;
      W = 0;
      resize();
      if (live) { view.x = live.x * 0.5; view.z = live.z * 0.5; }
      view.scale = view.fit * 1.25;
      clampView();
      draw();
      setTimeout(() => canvas.focus({ preventScroll: true }), 30);
    },
    close() {
      if (!open) return;
      open = false;
      el.hidden = true;
      if (el.contains(document.activeElement)) document.activeElement.blur();
      onClose?.();
    },
    toggle() { if (open) api.close(); else api.open(); },
    /** Live data (same feed as the minimap, plus the self state for quests). */
    update(d) {
      live = d;
      if (open) draw();
    },
    setMarker: (m) => setMarker(m, false),
  };
  return api;
}
