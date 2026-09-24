// [skilltree] « L'Arbre des Brumes » screen (N by default, and the menu): full-screen Canvas2D view of the 318 nodes
// (docs/design/ARBRE_COMPETENCES.md §14.5) — pan (drag) and zoom (wheel, 0.3–2), region tints and names, node shapes
// by type (skill = gold circle with its icon, variant = turquoise diamond, passive = small circle with its ranks,
// keystone = purple octagon, Fondamental = white-gold ring, class start = class colour), allocated / pending /
// available / locked states, cost badges (« Pas de don » 2 or 3 points), exact numbers in the tooltip (values of the
// ability before → after), search (Ctrl+F), cheapest path on hover (click = plan it), « Parcours conseillé » up to
// level 10 in one click, preview of the pending nodes before « Confirmer », and the Renaissance ritual (level 30,
// double confirmation). Everything is validated with shared/skills.js, then by the server.
import { CLASSES } from '@shared/data.js';
import {
  TREE, NODES, RULES, TREE_ERRORS, CLASS_START, ABILITY_DEFS, RENAISSANCE, FOND_IDS, BRIDGE_CLASSES, TREE_CLASSES,
  allocate, nodeCost, cheapestPath, buildTree, resolveAbility, isInapt, renaissanceTitle, affinitySlots,
} from '@shared/skills.js';
import { h, setText, clear, lsGet, lsSet, fmt1 } from './dom.js';
import { glyph } from './icons.js';
import { abilityNumbers } from './skillTips.js';
import { keybinds } from '../game/keybinds.js';
import { treeState } from '../game/skillState.js';

// ------------------------------------------------------------------ static data
const REGION_COLOR = {
  survie: '#9fb2c6', guerrier: '#c0392b', mage: '#2e6fd8', rodeur: '#2e9e4f',
  pont_gm: ['#c0392b', '#2e6fd8'], pont_mr: ['#2e6fd8', '#2e9e4f'], pont_rg: ['#2e9e4f', '#c0392b'],
};
// annular sectors (angles in degrees from +x, y up; radii in tree units), design §4
const SECTORS = [
  { id: 'guerrier', a0: 56, a1: 124, r0: 480, r1: 1540 },
  { id: 'pont_gm', a0: 131, a1: 168, r0: 740, r1: 1220 },
  { id: 'mage', a0: 168, a1: 250, r0: 450, r1: 1560 },
  { id: 'pont_mr', a0: 255, a1: 285, r0: 780, r1: 1225 },
  { id: 'rodeur', a0: 294, a1: 372, r0: 480, r1: 1520 },
  { id: 'pont_rg', a0: 12, a1: 43, r0: 760, r1: 1260 },
];
const SURVIE_BRANCH = {
  coeur: 'Cœur', fondamentaux: 'Fondamentaux', sprint: 'Sprint', charge: 'Attaque chargée', endurance: 'Endurance',
  garde: 'Garde', roulade: 'Roulade', saut: 'Saut', soutien: 'Soutien', seuil: 'Seuils',
};
const TYPE_LABEL = { skill: 'Compétence', variant: 'Variante', passive: 'Passif', keystone: 'Clé de voûte', root: 'Racine' };
const SIZE = { root: 30, fond: 22, start: 26, skill: 19, keystone: 21, variant: 13, passive: 10 };
const MIN_PX = { root: 7, fond: 6, start: 7, skill: 5, keystone: 5, variant: 3.5, passive: 3 };
const ZMIN = 0.3, ZMAX = 2.0;
const NODE_LIST = TREE.nodes;
const LINKS = [];
for (const n of NODE_LIST) for (const l of n.links) if (n.id < l && NODES.has(l)) LINKS.push([n, NODES.get(l)]);
const GROUPS = new Map();
for (const n of NODE_LIST) if (n.exclusiveGroup) {
  if (!GROUPS.has(n.exclusiveGroup)) GROUPS.set(n.exclusiveGroup, []);
  GROUPS.get(n.exclusiveGroup).push(n);
}
// branch labels at the centroid of their nodes
const BRANCH_LABELS = [];
{
  const acc = new Map();
  for (const n of NODE_LIST) {
    if (n.region === 'survie' || n.type === 'root' || BRIDGE_CLASSES[n.region]) continue;
    const k = `${n.region}/${n.branch}`;
    if (!acc.has(k)) acc.set(k, { x: 0, y: 0, n: 0, region: n.region, branch: n.branch });
    const a = acc.get(k);
    a.x += n.x; a.y += n.y; a.n++;
  }
  for (const a of acc.values()) {
    const name = TREE.regions[a.region]?.branches?.[a.branch] || TREE.regions[a.region]?.name || '';
    if (!name || a.branch === 'tronc' || a.branch === 'origine') continue;
    BRANCH_LABELS.push({ x: a.x / a.n, y: a.y / a.n, name, region: a.region });
  }
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const SEARCH_TEXT = new Map(NODE_LIST.map((n) => [n.id, norm(`${n.name} ${n.desc} ${n.ability ? ABILITY_DEFS.get(n.ability)?.name || '' : ''}`)]));
const kindOf = (n) => (n.type === 'root' ? 'root' : n.fondamental ? 'fond' : n.start ? 'start' : n.type);
const hexA = (hex, a) => {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
};
const regionHex = (r) => {
  const c = REGION_COLOR[r];
  return Array.isArray(c) ? c[0] : c || '#9fb2c6';
};

// ------------------------------------------------------------------ icons drawn in the canvas (loaded lazily)
const icons = new Map(); // abilityId -> { img, ok }
function iconOf(id, onload) {
  let e = icons.get(id);
  if (!e) {
    e = { img: new Image(), ok: false };
    e.img.decoding = 'async';
    e.img.onload = () => { e.ok = true; onload(); };
    e.img.onerror = () => { e.ok = false; };
    e.img.src = `/icons/ab_${id}.png`;
    icons.set(id, e);
  }
  return e.ok ? e.img : null;
}

export function createSkillTree(parent, { handlers, menus, notify, onOpenBook, onClose }) {
  let self = null;
  let open = false;
  let pending = [];               // node ids, one entry per rank
  let st = null;                  // computed states
  let hover = null;               // hovered node
  const tipAt = { n: null, x: 0, y: 0 }; // node and pointer position of the visible tooltip
  let hoverPath = null;           // cheapest path preview { path, cost }
  let search = '';
  let matches = [];
  let matchIdx = -1;
  let W = 0, H = 0, dpr = 1;
  const view = { cx: 0, cy: 0, s: 0.8 };
  let raf = 0;
  let lastT = 0;

  // ---------------------------------------------------------------- DOM
  const canvas = h('canvas', { class: 'bv-tree-canvas', 'aria-label': 'Arbre des Brumes', role: 'img', tabIndex: 0 });
  const title = h('h2', { class: 'bv-tree-title', text: 'L\'Arbre des Brumes' });
  const sub = h('div', { class: 'bv-tree-sub' });
  const ptsFree = h('b', { class: 'bv-tree-pts-n', text: '0' });
  const ptsLabel = h('span', { class: 'bv-tree-pts-l' });
  const ptsPending = h('span', { class: 'bv-tree-pts-p' });
  const points = h('div', { class: 'bv-tree-pts', title: 'Points de compétence' }, ptsFree, h('div', { class: 'bv-tree-pts-col' }, ptsLabel, ptsPending));
  const searchIn = h('input', { class: 'bv-tree-search-in', type: 'search', placeholder: 'Rechercher un nœud…', 'aria-label': 'Rechercher un nœud', spellcheck: 'false', autocomplete: 'off' });
  const searchN = h('span', { class: 'bv-tree-search-n' });
  const searchBox = h('label', { class: 'bv-tree-search' }, glyph('search'), searchIn, searchN);
  const btn = (g, label, fn, cls = 'secondary', key = null) => h('button', { class: `bv-btn small ${cls}`.trim(), type: 'button', onclick: fn }, g ? glyph(g) : null, h('span', { text: label }), key ? h('kbd', { text: key }) : null);
  const guideBtn = btn('star', 'Parcours conseillé', () => applyGuide());
  const centerBtn = btn('target', 'Centrer', () => centerOnOwn(true));
  const bookBtn = btn('book', 'Livre', () => onOpenBook?.(), 'secondary', 'K');
  const rnBtn = btn('swirl', 'Renaissance', () => openRenaissance(), 'secondary bv-tree-rnbtn');
  const closeBtn = btn('close', 'Fermer', () => close(), '', 'N');
  const top = h('header', { class: 'bv-tree-top' },
    h('div', { class: 'bv-tree-titles' }, title, sub),
    points,
    h('div', { class: 'bv-tree-actions' }, searchBox, guideBtn, centerBtn, bookBtn, rnBtn, closeBtn));
  const legend = h('ul', { class: 'bv-tree-legend' },
    ...[
      ['sk', 'Compétence'], ['va', 'Variante (une par groupe)'], ['pa', 'Passif (rangs)'], ['ks', 'Clé de voûte'], ['fo', 'Fondamental'],
    ].map(([c, t]) => h('li', null, h('i', { class: `bv-tl-${c}` }), h('span', { text: t }))),
    h('li', null, h('i', { class: 'bv-tl-cost', text: '2' }), h('span', { text: 'Pas de don : coûte plus, Inaptitude' })));
  const hint = h('div', { class: 'bv-tree-hint', text: 'Clic : ajouter · clic droit : retirer · glisser : déplacer · molette : zoom · Ctrl+F : rechercher' });
  const pendList = h('div', { class: 'bv-tree-pend-list' });
  const pendCost = h('span', { class: 'bv-tree-pend-cost' });
  const confirmBtn = h('button', { class: 'bv-btn', type: 'button', onclick: () => confirmPending() }, glyph('plus'), h('span', { class: 'bv-tree-confirm-l', text: 'Confirmer' }));
  const cancelBtn = h('button', { class: 'bv-btn small secondary', type: 'button', onclick: () => { pending = []; recompute(); } }, h('span', { text: 'Annuler' }));
  const pendBar = h('div', { class: 'bv-tree-pend bv-frame', hidden: true },
    h('div', { class: 'bv-tree-pend-head' }, h('span', { class: 'bv-tree-pend-t', text: 'En attente' }), pendCost),
    pendList, h('div', { class: 'bv-tree-pend-btns' }, cancelBtn, confirmBtn));
  const tut = h('div', { class: 'bv-tree-tut bv-frame', hidden: true });
  const tip = h('div', { class: 'bv-tree-tip tt' });
  const zoomIn = h('button', { class: 'bv-wm-zoom', type: 'button', 'aria-label': 'Zoom avant', text: '+', onclick: () => zoomAt(1.25) });
  const zoomOut = h('button', { class: 'bv-wm-zoom', type: 'button', 'aria-label': 'Zoom arrière', text: '−', onclick: () => zoomAt(0.8) });
  const rnModal = h('div', { class: 'bv-tree-rn-veil', hidden: true });
  const el = h('div', { class: 'bv-tree', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Arbre des Brumes', hidden: true },
    canvas, top, h('div', { class: 'bv-wm-zooms bv-tree-zooms' }, zoomIn, zoomOut),
    h('footer', { class: 'bv-tree-foot' }, legend, hint), pendBar, tut, tip, rnModal);
  parent.appendChild(el);
  const ctx = canvas.getContext('2d');

  // ---------------------------------------------------------------- model
  const cls = () => self?.cls || 'warrior';
  const level = () => self?.level || 1;
  function skillsState(extra = pending) {
    const t = treeState(self) || { alloc: {}, gift: [], affinity: [] };
    const alloc = { ...(t.alloc || {}) };
    for (const id of extra) alloc[id] = (alloc[id] || 0) + 1;
    return { alloc, gift: t.gift || [], legacyFloor: self?.points?.floor || 0, rb: self?.renaissance?.n || 0, affinity: t.affinity || [] };
  }
  const baseSkills = () => skillsState([]);

  /** Recompute node states (owned / pending / available / blocked / locked) and the counters. */
  function recompute() {
    if (!self) return;
    const c = cls();
    const base = baseSkills();
    const cur = skillsState();
    const own = new Set(['coeur', CLASS_START[c], ...Object.keys(base.alloc), ...base.gift]);
    const pend = new Map();
    for (const id of pending) pend.set(id, (pend.get(id) || 0) + 1);
    const withPend = new Set([...own, ...pend.keys()]);
    const aff = base.affinity;
    const states = new Map();
    const pendCostN = pending.reduce((a, id) => a + nodeCost(NODES.get(id), c, aff), 0);
    const free = Math.max(0, (self.points?.free ?? 0) - pendCostN);
    const takenGroups = new Set();
    for (const id of withPend) { const g = NODES.get(id)?.exclusiveGroup; if (g) takenGroups.add(g); }
    for (const n of NODE_LIST) {
      const rank = (base.alloc[n.id] || 0) + (base.gift.includes(n.id) ? 1 : 0);
      const pr = pend.get(n.id) || 0;
      const owned = n.type === 'root' || n.start === c || rank > 0;
      const linked = n.type === 'root' || n.start === c || n.fondamental || n.links.some((l) => withPend.has(l));
      const cost = nodeCost(n, c, aff);
      let status = 'locked';
      let code = null;
      const maxed = (rank + pr) >= (n.maxRank || 1) || n.type === 'root' || n.start === c || base.gift.includes(n.id);
      if (!maxed && (linked || owned || pr)) {
        const res = allocate(c, level(), cur, [n.id]);
        if (res.ok) status = 'available';
        else { status = 'blocked'; code = res.code; }
      }
      if (pr) status = status === 'available' ? 'pending+' : 'pending';
      else if (owned && status !== 'available') status = 'owned';
      else if (owned) status = 'owned+';
      const excluded = n.exclusiveGroup && takenGroups.has(n.exclusiveGroup) && !withPend.has(n.id);
      states.set(n.id, { status, code, rank, pr, cost, linked, excluded, inapt: n.ability ? isInapt(ABILITY_DEFS.get(n.ability) || {}, c) : false });
    }
    st = { states, free, pendCost: pendCostN, own, withPend, total: self.points?.total ?? 0, spent: self.points?.spent ?? 0 };
    // guide: the next suggested nodes (levels ≤ 10)
    st.guide = new Set();
    for (const step of RULES.guide?.paths?.[c] || []) {
      const left = step.nodes.filter((id) => !withPend.has(id));
      if (left.length) { for (const id of left) st.guide.add(id); break; }
    }
    hoverPath = null;
    if (hover) planHover(hover);
    refreshChrome();
    // the tree / points changed (Confirmer accepted, level up…): rebuild the visible tooltip, never a stale one
    if (tipAt.n && tip?.classList.contains('show')) showTip(tipAt.n, tipAt.x, tipAt.y);
  }

  function refreshChrome() {
    if (!self || !st) return;
    setText(ptsFree, st.free);
    setText(ptsLabel, `point${st.free > 1 ? 's' : ''} libre${st.free > 1 ? 's' : ''} · ${st.total} au total`);
    setText(ptsPending, pending.length ? `${st.pendCost} en attente` : st.free > 0 ? 'Cliquez un nœud brillant' : level() < 30 ? 'Prochain point au niveau suivant' : '');
    points.classList.toggle('has-free', st.free > 0);
    setText(sub, `${CLASSES[self.cls]?.name || ''} · niveau ${level()}${self.renaissance?.n ? ` · ${renaissanceTitle(self.renaissance.n)}` : ''}`);
    // pending bar
    pendBar.hidden = !pending.length;
    if (pending.length) {
      const counts = new Map();
      for (const id of pending) counts.set(id, (counts.get(id) || 0) + 1);
      clear(pendList).append(...[...counts].map(([id, n]) => h('button', {
        class: 'bv-tree-chip', type: 'button', title: 'Retirer', onclick: () => removePending(id),
      }, h('span', { text: NODES.get(id).name }), n > 1 ? h('b', { text: `×${n}` }) : null, glyph('close'))));
      setText(pendCost, `${st.pendCost} point${st.pendCost > 1 ? 's' : ''}`);
      setText(confirmBtn.querySelector('.bv-tree-confirm-l'), `Confirmer (${st.pendCost} point${st.pendCost > 1 ? 's' : ''})`);
    }
    setText(bookBtn.querySelector('kbd'), keybinds.label('book'));
    setText(closeBtn.querySelector('kbd'), keybinds.label('tree'));
    const rn = self.renaissance;
    rnBtn.classList.toggle('ready', !!rn?.available);
    rnBtn.title = rn?.available ? 'La Renaissance est disponible' : `La Renaissance s'ouvre au niveau ${RENAISSANCE.level}`;
    guideBtn.disabled = !st.guide.size;
    // tutorial card: fewer than 3 Fondamentaux
    const fond = FOND_IDS.filter((id) => st.withPend.has(id)).length;
    tut.hidden = fond >= RULES.gate.fondamentaux || lsGet('bv.tut.tree', '') === '1';
    if (!tut.hidden) {
      clear(tut).append(
        h('div', { class: 'bv-tree-tut-t', text: 'Les Fondamentaux d\'abord' }),
        h('p', { text: `Au centre, autour du Cœur des Brumes : Roulade, Sprint, Saut, Garde et Attaque chargée (1 point chacun). Dès que vous en connaissez ${RULES.gate.fondamentaux}, la région de votre classe s'ouvre.` }),
        h('p', { class: 'dim', text: `Vous en avez ${fond} sur ${RULES.gate.fondamentaux}. « Parcours conseillé » les choisit pour vous.` }),
        h('button', { class: 'bv-btn small secondary', type: 'button', onclick: () => { lsSet('bv.tut.tree', '1'); tut.hidden = true; } }, h('span', { text: 'Compris' })));
    }
  }

  // ---------------------------------------------------------------- actions
  function tryAdd(ids, quiet = false) {
    // allocate() validates the whole state: the saved tree + every pending rank + the new ones
    const full = allocate(cls(), level(), skillsState([]), [...pending, ...ids]);
    if (!full.ok) {
      if (!quiet) notify?.(reasonText(full.code, full.node), 'error');
      return false;
    }
    pending.push(...ids);
    recompute();
    return true;
  }

  function reasonText(code, nodeId) {
    const n = nodeId && NODES.get(nodeId);
    if (code === 'tree_points') return `Pas assez de points de compétence (${st?.free ?? 0} libre${(st?.free ?? 0) > 1 ? 's' : ''}).`;
    if (code === 'tree_level' && n?.minLevel) return `« ${n.name} » demande le niveau ${n.minLevel}.`;
    if (code === 'tree_req' && n?.reqRegionPoints) return `« ${n.name} » demande ${n.reqRegionPoints.min} points dépensés dans la région ${TREE.regions[n.reqRegionPoints.region]?.name || ''}.`;
    return TREE_ERRORS[code] || 'Impossible d\'apprendre ce nœud.';
  }

  function removePending(id) {
    const i = pending.lastIndexOf(id);
    if (i < 0) return;
    pending.splice(i, 1);
    // drop what no longer holds (a node that depended on the removed one)
    let guard = 80;
    while (pending.length && guard-- > 0) {
      const res = allocate(cls(), level(), skillsState([]), pending);
      if (res.ok) break;
      const j = res.node ? pending.lastIndexOf(res.node) : -1;
      pending.splice(j >= 0 ? j : pending.length - 1, 1);
    }
    recompute();
  }

  function clickNode(n, right) {
    if (!self || !st) return;
    if (!treeState(self)) { notify?.('Le serveur ne gère pas encore l\'Arbre des Brumes.', 'error'); return; }
    const s = st.states.get(n.id);
    if (right) {
      if (s.pr) removePending(n.id);
      return;
    }
    if (s.status === 'available' || s.status === 'owned+' || s.status === 'pending+') { tryAdd([n.id]); return; }
    if (s.status === 'owned' || s.status === 'pending') {
      if (n.type !== 'root' && !n.start) notify?.(s.status === 'owned' ? `« ${n.name} » est déjà appris${(n.maxRank || 1) > 1 ? ' (rang maximum)' : ''}.` : 'Déjà en attente.', 'info');
      return;
    }
    if (s.status === 'blocked' && s.code !== 'tree_link') { notify?.(reasonText(s.code, n.id), 'error'); return; }
    // not linked yet: plan the cheapest path
    const path = cheapestPath(cls(), [...st.withPend], n.id, baseSkills().affinity);
    if (!path || !path.path.length) { notify?.(TREE_ERRORS.tree_link, 'error'); return; }
    if (tryAdd(path.path) && path.path.length > 1) notify?.(`Chemin ajouté : ${path.path.length} nœuds, ${path.cost} point${path.cost > 1 ? 's' : ''}.`, 'info');
  }

  function confirmPending() {
    if (!pending.length) return;
    const res = allocate(cls(), level(), skillsState([]), pending);
    if (!res.ok) { notify?.(reasonText(res.code, res.node), 'error'); return; }
    const list = [...pending];
    if (handlers.allocNodes?.(list) === false) { notify?.('Connexion au serveur perdue.', 'error'); return; }
    pending = [];
    recompute();
  }

  /** « Parcours conseillé »: the class path of levels 2 → 10, as far as the free points go. */
  function applyGuide() {
    if (!self || !st) return;
    const steps = RULES.guide?.paths?.[cls()] || [];
    const added = [];
    let stopAt = null;
    for (const step of steps) {
      for (const id of step.nodes) {
        if (st.withPend.has(id) || added.includes(id)) continue;
        const res = allocate(cls(), level(), skillsState([]), [...pending, ...added, id]);
        if (res.ok) added.push(id);
        else if (!stopAt) stopAt = step;
      }
      if (stopAt) break;
    }
    if (!added.length) {
      notify?.(stopAt ? `Parcours conseillé : prochain nœud au niveau ${stopAt.level} (« ${NODES.get(stopAt.nodes[0])?.name} »).` : 'Parcours conseillé terminé : choisissez votre spécialisation.', 'info');
      return;
    }
    pending.push(...added);
    recompute();
    const cost = added.reduce((a, id) => a + nodeCost(NODES.get(id), cls(), baseSkills().affinity), 0);
    notify?.(`Parcours conseillé : ${added.map((id) => NODES.get(id).name).join(', ')} (${cost} point${cost > 1 ? 's' : ''}). Vérifiez puis confirmez.`, 'info');
    const last = NODES.get(added[added.length - 1]);
    flyTo(last.x, -last.y, Math.max(view.s / dpr, 0.7));
  }

  // ---------------------------------------------------------------- view
  const toScreen = (x, y) => [(x - view.cx) * view.s + W / 2, (-y - view.cy) * view.s + H / 2];
  const toWorld = (sx, sy) => ({ x: (sx - W / 2) / view.s + view.cx, y: -((sy - H / 2) / view.s + view.cy) });
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(100, Math.round(r.width * dpr)), hh = Math.max(100, Math.round(r.height * dpr));
    if (w !== W || hh !== H) { W = canvas.width = w; H = canvas.height = hh; }
  }
  function zoomAt(f, sx = W / 2, sy = H / 2) {
    const before = toWorld(sx, sy);
    view.s = Math.max(ZMIN * dpr, Math.min(ZMAX * dpr, view.s * f));
    const after = toWorld(sx, sy);
    view.cx += before.x - after.x;
    view.cy -= before.y - after.y;
    clampView();
  }
  function clampView() {
    view.cx = Math.max(-1700, Math.min(1700, view.cx));
    view.cy = Math.max(-1700, Math.min(1700, view.cy));
  }
  let fly = null;
  function flyTo(dx, dy, s) {
    // s = CSS scale (view.s is in device pixels per tree unit)
    fly = { x0: view.cx, y0: view.cy, s0: view.s, x1: dx, y1: dy, s1: Math.max(ZMIN * dpr, Math.min(ZMAX * dpr, s * dpr)), t: 0 };
  }
  function centerOnOwn(animate = false) {
    if (!self) return;
    const fond = FOND_IDS.filter((id) => st?.withPend.has(id)).length;
    const start = NODES.get(CLASS_START[cls()]);
    let x, y, s;
    if (fond >= RULES.gate.fondamentaux) {
      x = start.x * 0.75; y = start.y * 0.75; s = 0.55;
    } else {
      // before the gate: between the Cœur (the Fondamentaux) and the own class start, both on screen, so a new
      // character sees its own region first (not the other classes' nodes)
      x = start.x * 0.45; y = start.y * 0.45;
      const r = canvas.getBoundingClientRect();
      const halfW = Math.max(100, r.width) / 2, halfH = Math.max(100, r.height) / 2;
      const margin = 110; // world units around the two ends (node + label)
      s = Math.min(1, halfW / (Math.abs(start.x) * 0.55 + margin), halfH / (Math.abs(start.y) * 0.55 + margin));
      s = Math.max(ZMIN, s);
    }
    if (animate) flyTo(x, -y, s);
    else { view.cx = x; view.cy = -y; view.s = s * dpr; }
  }

  // ---------------------------------------------------------------- drawing
  function nodeRadius(n) {
    const k = kindOf(n);
    return Math.max(SIZE[k] * view.s, MIN_PX[k] * dpr);
  }

  function drawSectors() {
    const [ox, oy] = toScreen(0, 0);
    for (const sct of SECTORS) {
      const c = REGION_COLOR[sct.id];
      const r0 = sct.r0 * view.s, r1 = sct.r1 * view.s;
      const g = ctx.createRadialGradient(ox, oy, r0, ox, oy, r1);
      const c0 = Array.isArray(c) ? c[0] : c, c1 = Array.isArray(c) ? c[1] : c;
      g.addColorStop(0, hexA(c0, 0.2));
      g.addColorStop(0.55, hexA(Array.isArray(c) ? c1 : c0, 0.11));
      g.addColorStop(1, hexA(c1, 0));
      ctx.beginPath();
      ctx.arc(ox, oy, r1, (-sct.a1 * Math.PI) / 180, (-sct.a0 * Math.PI) / 180);
      ctx.arc(ox, oy, r0, (-sct.a0 * Math.PI) / 180, (-sct.a1 * Math.PI) / 180, true);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    }
    // Survie: misty disc
    const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, 470 * view.s);
    g.addColorStop(0, 'rgba(200,215,235,0.16)');
    g.addColorStop(0.7, 'rgba(160,180,205,0.07)');
    g.addColorStop(1, 'rgba(160,180,205,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ox, oy, 470 * view.s, 0, Math.PI * 2);
    ctx.fill();
    // region names
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const sct of SECTORS) {
      const reg = TREE.regions[sct.id];
      const a = (((sct.a0 + sct.a1) / 2) * Math.PI) / 180;
      const bridge = !!BRIDGE_CLASSES[sct.id];
      const rr = bridge ? (sct.r0 + sct.r1) / 2 : sct.r1 + 40;
      const [x, y] = toScreen(Math.cos(a) * rr, Math.sin(a) * rr);
      const size = Math.max(11 * dpr, Math.min(40 * dpr, (bridge ? 34 : 70) * view.s));
      ctx.font = `700 ${size}px Cinzel, Georgia, serif`;
      ctx.fillStyle = hexA(regionHex(sct.id) === '#9fb2c6' ? '#9fb2c6' : '#f2d58c', bridge ? 0.28 : 0.4);
      if (bridge && view.s < 0.45 * dpr) continue;
      ctx.fillText(bridge ? reg.name : reg.name.toUpperCase(), x, y);
    }
    if (view.s < 1.1 * dpr) {
      ctx.font = `600 ${Math.max(10 * dpr, Math.min(22 * dpr, 30 * view.s))}px Cinzel, Georgia, serif`;
      for (const b of BRANCH_LABELS) {
        const [x, y] = toScreen(b.x, b.y);
        ctx.fillStyle = 'rgba(235,222,190,0.22)';
        ctx.fillText(b.name, x, y);
      }
    }
  }

  function linkStyle(a, b) {
    const sa = st.states.get(a.id), sb = st.states.get(b.id);
    const oa = sa.status.startsWith('owned') || a.type === 'root' || a.start === cls();
    const ob = sb.status.startsWith('owned') || b.type === 'root' || b.start === cls();
    const pa = sa.pr > 0, pb = sb.pr > 0;
    if ((oa || pa) && (ob || pb)) return pa || pb ? 'pending' : 'owned';
    if ((oa || pa) && (sb.status === 'available') || (ob || pb) && (sa.status === 'available')) return 'open';
    return 'dim';
  }

  function drawLinks(t) {
    const lw = Math.max(1, 2.2 * view.s);
    const groups = { owned: [], pending: [], open: [], dim: [] };
    for (const l of LINKS) groups[linkStyle(l[0], l[1])].push(l);
    const stroke = (list, style, width, dash = null) => {
      if (!list.length) return;
      ctx.beginPath();
      for (const [a, b] of list) {
        const [x1, y1] = toScreen(a.x, a.y), [x2, y2] = toScreen(b.x, b.y);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      if (dash) ctx.lineDashOffset = -t * 30 * dpr;
      ctx.stroke();
    };
    const dimA = search ? 0.12 : 0.45;
    stroke(groups.dim, `rgba(120,118,130,${dimA})`, lw * 0.7);
    stroke(groups.open, `rgba(242,213,140,${search ? 0.25 : 0.55})`, lw);
    stroke(groups.owned, 'rgba(255,214,120,0.95)', lw * 1.6);
    stroke(groups.pending, 'rgba(120,235,255,0.95)', lw * 1.5, [6 * dpr, 5 * dpr]);
    ctx.setLineDash([]);
    // exclusive groups: dotted arcs between the options
    if (view.s > 0.45 * dpr) {
      ctx.beginPath();
      for (const list of GROUPS.values()) {
        for (let i = 0; i + 1 < list.length; i++) {
          const [x1, y1] = toScreen(list[i].x, list[i].y), [x2, y2] = toScreen(list[i + 1].x, list[i + 1].y);
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          const [ox, oy] = toScreen(0, 0);
          const dx = mx - ox, dy = my - oy, dl = Math.hypot(dx, dy) || 1;
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(mx + (dx / dl) * 14 * view.s, my + (dy / dl) * 14 * view.s, x2, y2);
        }
      }
      ctx.strokeStyle = `rgba(80,220,210,${search ? 0.1 : 0.35})`;
      ctx.lineWidth = Math.max(1, 1.2 * view.s);
      ctx.setLineDash([2 * dpr, 4 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // cheapest path preview
    if (hoverPath && hoverPath.path.length) {
      const pts = [];
      const first = NODES.get(hoverPath.path[0]);
      const from = first.links.map((l) => NODES.get(l)).find((m) => st.withPend.has(m.id));
      if (from) pts.push(from);
      for (const id of hoverPath.path) pts.push(NODES.get(id));
      ctx.beginPath();
      pts.forEach((n, i) => { const [x, y] = toScreen(n.x, n.y); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.strokeStyle = 'rgba(255,236,170,0.9)';
      ctx.lineWidth = lw * 1.3;
      ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.lineDashOffset = -t * 40 * dpr;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function shapePath(k, x, y, r) {
    ctx.beginPath();
    if (k === 'variant') {
      ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.2, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r * 1.2, y); ctx.closePath();
    } else if (k === 'keystone') {
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (i * Math.PI) / 4;
        const px = x + Math.cos(a) * r * 1.08, py = y + Math.sin(a) * r * 1.08;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
    } else ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  const TYPE_COL = { skill: '#e0b04a', variant: '#43d6c8', passive: '#cdb88a', keystone: '#b45ce8', fond: '#fff1c4', root: '#fff6dc' };

  function drawNode(n, t) {
    const s = st.states.get(n.id);
    const k = kindOf(n);
    const [x, y] = toScreen(n.x, n.y);
    const r = nodeRadius(n);
    if (x < -r * 3 || y < -r * 3 || x > W + r * 3 || y > H + r * 3) return;
    const isMatch = search && matches.includes(n);
    const dim = search && !isMatch;
    ctx.globalAlpha = dim ? 0.22 : 1;
    const reg = k === 'start' ? CLASSES[n.start]?.color || regionHex(n.region) : regionHex(n.region);
    const typeCol = k === 'start' ? reg : TYPE_COL[k] || '#cdb88a';
    const owned = s.status.startsWith('owned') || k === 'root' || n.start === cls();
    const pend = s.pr > 0;
    const avail = s.status === 'available' || s.status === 'owned+' || s.status === 'pending+';
    // halo
    if ((owned || pend || avail) && !dim) {
      const pulse = avail && !owned && !pend ? 0.55 + 0.45 * Math.sin(t * 4 + n.x * 0.01) : 1;
      const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * (owned ? 2.3 : 2.0));
      const hc = pend ? '#78ebff' : owned ? typeCol : '#f2d58c';
      g.addColorStop(0, hexA(hc, (owned ? 0.55 : pend ? 0.6 : 0.35) * pulse));
      g.addColorStop(1, hexA(hc, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // body
    shapePath(k === 'fond' || k === 'root' || k === 'start' ? 'circle' : k, x, y, r);
    let fill;
    if (pend) fill = hexA('#1d6a7a', 0.95);
    else if (owned) fill = k === 'start' ? hexA(reg, 0.95) : hexA(typeCol, 0.92);
    else if (avail) fill = 'rgba(40,32,20,0.96)';
    else fill = 'rgba(16,15,18,0.95)';
    ctx.fillStyle = fill;
    ctx.fill();
    // inner tint of the region (unowned)
    if (!owned && !pend && (k === 'skill' || k === 'passive' || k === 'keystone')) {
      ctx.fillStyle = hexA(reg, avail ? 0.28 : 0.14);
      ctx.fill();
    }
    ctx.lineWidth = Math.max(1, (k === 'fond' || k === 'root' ? 2.6 : 1.8) * Math.min(1.4, view.s / dpr + 0.3) * dpr);
    ctx.strokeStyle = pend ? '#9ff4ff' : owned ? '#fff4d0' : avail ? '#f2d58c' : s.status === 'blocked' ? 'rgba(170,150,110,0.55)' : 'rgba(110,105,110,0.6)';
    ctx.stroke();
    if (k === 'fond' || k === 'root') {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
      ctx.strokeStyle = owned ? 'rgba(90,70,30,0.8)' : 'rgba(255,241,196,0.6)';
      ctx.lineWidth = Math.max(1, 1.5 * dpr * Math.min(1, view.s / dpr + 0.3));
      ctx.stroke();
    }
    // icon / emblem
    if (r > 7 * dpr && (k === 'skill' || k === 'fond' || k === 'start' || k === 'keystone')) {
      const abId = n.ability || (n.effects || []).find((e) => e.mod === 'unlock')?.value;
      const img = abId && k !== 'keystone' ? iconOf(abId, () => {}) : null;
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
        ctx.clip();
        ctx.globalAlpha = (dim ? 0.22 : 1) * (owned || pend ? 1 : avail ? 0.8 : 0.45);
        ctx.drawImage(img, x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
        ctx.restore();
        ctx.globalAlpha = dim ? 0.22 : 1;
      } else {
        const letter = k === 'root' ? '✦' : (ABILITY_DEFS.get(abId)?.name || n.name).charAt(0);
        ctx.font = `700 ${Math.round(r * 0.95)}px Cinzel, Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = owned ? 'rgba(40,26,8,0.9)' : pend ? '#dffbff' : avail ? '#f2d58c' : 'rgba(170,160,140,0.6)';
        ctx.fillText(letter, x, y + r * 0.05);
      }
    }
    // ranks (passives)
    if ((n.maxRank || 1) > 1 && view.s > 0.55 * dpr) {
      const txt = `${s.rank + s.pr}/${n.maxRank}`;
      ctx.font = `800 ${Math.round(Math.max(9 * dpr, r * 0.9))}px "Alegreya Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = s.rank + s.pr > 0 ? '#fff4d0' : 'rgba(200,190,170,0.75)';
      ctx.fillText(txt, x, y + r + 2 * dpr);
    }
    // cost badge (« pas de don ») and Inaptitude mark
    if (!owned && s.cost >= 2 && view.s > 0.4 * dpr && !dim) {
      const br = Math.max(6 * dpr, r * 0.42);
      const bx = x + r * 0.85, by = y - r * 0.85;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fillStyle = s.cost >= 3 ? '#d4452a' : '#e8892a';
      ctx.fill();
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = '#1a0e05';
      ctx.stroke();
      ctx.font = `800 ${Math.round(br * 1.35)}px "Alegreya Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(String(s.cost), bx, by + 0.5);
    }
    if (s.inapt && !dim && view.s > 0.5 * dpr && (k === 'skill' || k === 'start')) {
      const bx = x - r * 0.9, by = y - r * 0.9, br = Math.max(5 * dpr, r * 0.36);
      ctx.beginPath();
      ctx.moveTo(bx, by - br); ctx.lineTo(bx + br, by + br * 0.8); ctx.lineTo(bx - br, by + br * 0.8); ctx.closePath();
      ctx.fillStyle = '#ff9a3a';
      ctx.fill();
      ctx.fillStyle = '#1a0e05';
      ctx.font = `900 ${Math.round(br * 1.2)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', bx, by + br * 0.15);
    }
    // excluded variant (another option of its group is taken)
    if (s.excluded && !owned) {
      ctx.beginPath();
      ctx.moveTo(x - r * 0.7, y - r * 0.7); ctx.lineTo(x + r * 0.7, y + r * 0.7);
      ctx.strokeStyle = 'rgba(200,80,70,0.7)';
      ctx.lineWidth = Math.max(1, 1.5 * dpr);
      ctx.stroke();
    }
    // guide star
    if (st.guide.has(n.id) && !dim) {
      const bob = Math.sin(t * 3) * 3 * dpr;
      drawStar(x, y - r - 11 * dpr + bob, 7 * dpr, '#ffd45a');
    }
    // search match ring
    if (isMatch) {
      ctx.beginPath();
      ctx.arc(x, y, r * 1.55, 0, Math.PI * 2);
      ctx.strokeStyle = n === matches[matchIdx] ? '#ffffff' : 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
    }
    // hover ring
    if (hover === n) {
      ctx.beginPath();
      ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff6da';
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
    }
    // names
    const showName = (k === 'skill' || k === 'keystone' || k === 'fond' || k === 'start' || k === 'root') ? view.s > 0.75 * dpr : view.s > 1.3 * dpr;
    if (showName && !dim) {
      ctx.font = `600 ${Math.round(11 * dpr * Math.min(1.25, Math.max(0.9, view.s / dpr)))}px "Alegreya Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const ty = y + r + ((n.maxRank || 1) > 1 ? 14 : 3) * dpr;
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(n.name, x, ty);
      ctx.fillStyle = owned ? '#ffe7a8' : pend ? '#bff6ff' : avail ? '#f4e6c4' : 'rgba(190,182,165,0.8)';
      ctx.fillText(n.name, x, ty);
    }
    ctx.globalAlpha = 1;
  }

  function drawStar(x, y, r, color) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = '#3a2508';
    ctx.stroke();
  }

  function draw(t) {
    resize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#141319');
    bg.addColorStop(1, '#060608');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    if (!st) return;
    drawSectors();
    drawLinks(t);
    // unowned first, owned / pending / hovered on top
    const order = [[], [], []];
    for (const n of NODE_LIST) {
      const s = st.states.get(n.id);
      order[s.pr || s.status.startsWith('owned') ? 1 : 0].push(n);
    }
    for (const n of order[0]) drawNode(n, t);
    for (const n of order[1]) drawNode(n, t);
    if (hover) drawNode(hover, t);
  }

  function loop(ts) {
    raf = 0;
    if (!open) return;
    const t = ts / 1000;
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016);
    lastT = t;
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / 0.45);
      const k = 1 - (1 - fly.t) ** 3;
      view.cx = fly.x0 + (fly.x1 - fly.x0) * k;
      view.cy = fly.y0 + (fly.y1 - fly.y0) * k;
      view.s = fly.s0 + (fly.s1 - fly.s0) * k;
      if (fly.t >= 1) fly = null;
    }
    draw(t);
    raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (open && !raf) raf = requestAnimationFrame(loop); };

  // ---------------------------------------------------------------- picking & tooltip
  function pick(sx, sy) {
    let best = null, bd = Infinity;
    for (const n of NODE_LIST) {
      const [x, y] = toScreen(n.x, n.y);
      const r = nodeRadius(n) * 1.25 + 3 * dpr;
      const d = Math.hypot(x - sx, y - sy);
      if (d < r && d < bd) { bd = d; best = n; }
    }
    return best;
  }

  function planHover(n) {
    hoverPath = null;
    const s = st?.states.get(n.id);
    if (!s || !treeState(self) || !(s.status === 'locked' || (s.status === 'blocked' && s.code === 'tree_link'))) return;
    hoverPath = cheapestPath(cls(), [...st.withPend], n.id, baseSkills().affinity);
  }

  const line = (cls2, ...kids) => h('div', { class: `tt-line ${cls2 || ''}`.trim() }, ...kids);
  function nodeTip(n) {
    const s = st.states.get(n.id);
    const k = kindOf(n);
    const c = cls();
    const box = [];
    const tag = n.fondamental ? 'Fondamental' : n.start ? 'Départ de classe' : TYPE_LABEL[n.type] || '';
    box.push(h('div', { class: 'tt-head' }, h('div', { class: `tt-name ${k === 'keystone' ? 'tt-ks' : 'tt-gold'}`, text: n.name }), tag ? h('span', { class: 'tt-tag', text: tag }) : null));
    const reg = TREE.regions[n.region];
    const branch = n.region === 'survie' ? SURVIE_BRANCH[n.branch] : reg?.branches?.[n.branch];
    box.push(line('tt-sub', [reg?.name, branch && branch !== reg?.name ? branch : null].filter(Boolean).join(' · ')));
    box.push(line('tt-desc-plain', n.desc));
    if (n.drawback) box.push(line('tt-bad', `Contrepartie : ${n.drawback}`));
    // numbers of the ability (before → after)
    const abIds = new Set();
    if (n.ability) abIds.add(n.ability);
    for (const e of n.effects || []) {
      if (e.mod === 'unlock') abIds.add(e.value);
      else if (e.mod) abIds.add(e.mod.split('.')[0]);
    }
    if (abIds.size && n.type !== 'root') {
      const before = buildTree(c, baseSkills());
      const alreadyIn = s.pr > 0 || s.status === 'owned';
      const afterSk = skillsState(alreadyIn ? pending : [...pending, n.id]);
      const after = buildTree(c, afterSk);
      const weapon = self?.eq?.weapon || null;
      let shown = 0;
      for (const id of abIds) {
        if (shown >= 2 || !ABILITY_DEFS.has(id)) continue;
        if (!after.unlocked.has(id) && !before.unlocked.has(id)) continue;
        const b = before.unlocked.has(id) ? resolveAbility(before, id, { weapon }) : null;
        const a = resolveAbility(after, id, { weapon });
        const rows = abilityNumbers(a);
        const was = b ? new Map(abilityNumbers(b)) : null;
        if (!rows.length) continue;
        shown++;
        box.push(line('tt-ab-t', b ? ABILITY_DEFS.get(id).name : `Débloque : ${ABILITY_DEFS.get(id).name}`));
        box.push(h('div', { class: 'tt-grid' }, rows.map(([kk, v]) => {
          const w = was?.get(kk);
          const ch = was && w !== undefined && w !== v;
          return [h('span', { class: 'tt-k', text: kk }), h('span', { class: `tt-v${ch ? ' tt-up' : ''}`, text: ch ? `${w} → ${v}` : v })];
        })));
        if (a.inapt > 0) box.push(line('tt-inapt', `Inaptitude : puissance ${Math.round(RULES.inaptitude.power * a.inapt * 100)} %, coûts +${Math.round(RULES.inaptitude.cost * a.inapt * 100)} %, recharge +${Math.round(RULES.inaptitude.cooldown * a.inapt * 100)} %`));
      }
    }
    // cost, ranks, requirements
    if (n.type !== 'root' && n.start !== c && !(treeState(self)?.gift || []).includes(n.id)) {
      const cost = s.cost;
      box.push(line(cost >= 2 ? 'tt-inapt' : 'tt-cost', cost >= 2
        ? `Coût : ${cost} points par rang — pas de don pour ça${n.type === 'keystone' ? ' (clé de voûte étrangère)' : n.start ? ' (départ d\'une autre classe)' : ''}`
        : `Coût : ${cost} point${(n.maxRank || 1) > 1 ? ' par rang' : ''}`));
    } else if ((treeState(self)?.gift || []).includes(n.id)) box.push(line('tt-good', 'Offert (personnage de la v0.2)'));
    if ((n.maxRank || 1) > 1) box.push(line('tt-dim', `Rang ${s.rank + s.pr} / ${n.maxRank}`));
    if (n.minLevel) box.push(line(level() >= n.minLevel ? 'tt-dim' : 'tt-bad', `Niveau ${n.minLevel} requis`));
    if (n.reqRegionPoints) {
      const rp = n.reqRegionPoints;
      let have = 0;
      const sk = skillsState();
      for (const [id, r] of Object.entries(sk.alloc)) {
        const m = NODES.get(id);
        if (m && m.region === rp.region && id !== n.id && !sk.gift.includes(id)) have += nodeCost(m, c, sk.affinity) * r;
      }
      box.push(line(have >= rp.min ? 'tt-dim' : 'tt-bad', `${rp.min} points dépensés dans la région ${TREE.regions[rp.region]?.name || ''} (vous : ${have})`));
    }
    if (n.exclusiveGroup) {
      const others = (GROUPS.get(n.exclusiveGroup) || []).filter((m) => m !== n).map((m) => m.name);
      if (others.length) box.push(line(s.excluded ? 'tt-bad' : 'tt-dim', `Une seule variante : ${others.join(', ')}`));
    }
    // status / action
    let act;
    if (n.type === 'root') act = line('tt-good', 'Toujours acquis. Les Fondamentaux s\'y rattachent.');
    else if (s.pr && s.status === 'pending') act = line('tt-pend', 'En attente de confirmation · clic droit : retirer');
    else if (s.status === 'available' || s.status === 'owned+' || s.status === 'pending+') act = line('tt-hint', `Clic : ${s.rank + s.pr ? 'ajouter un rang' : 'apprendre'} (${s.cost} point${s.cost > 1 ? 's' : ''})${s.pr ? ' · clic droit : retirer' : ''}`);
    else if (s.status === 'owned') act = line('tt-good', n.start === c ? 'Départ de votre classe : acquis.' : 'Acquis.');
    else if (hoverPath) act = line('tt-hint', `Clic : prévoir le chemin le moins cher (${hoverPath.path.length} nœud${hoverPath.path.length > 1 ? 's' : ''}, ${hoverPath.cost} point${hoverPath.cost > 1 ? 's' : ''})`);
    else act = line('tt-bad', reasonText(s.code || 'tree_link', n.id));
    box.push(act);
    return box;
  }

  function showTip(n, mx, my) {
    tipAt.n = n; tipAt.x = mx; tipAt.y = my;
    if (!n || !st) { tip.classList.remove('show'); return; }
    clear(tip).append(...nodeTip(n));
    tip.classList.add('show');
    const r = tip.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    let x = mx - host.left + 18, y = my - host.top + 18;
    if (x + r.width > host.width - 8) x = mx - host.left - r.width - 14;
    if (y + r.height > host.height - 8) y = Math.max(8, my - host.top - r.height - 14);
    tip.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(y)}px)`;
  }

  // ---------------------------------------------------------------- pointer
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus({ preventScroll: true });
    drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, button: e.button, id: e.pointerId };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id) {
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) { drag.moved = true; showTip(null); }
      if (drag.moved) {
        view.cx -= ((e.clientX - drag.lx) * dpr) / view.s;
        view.cy -= ((e.clientY - drag.ly) * dpr) / view.s;
        clampView();
        fly = null;
      }
      drag.lx = e.clientX; drag.ly = e.clientY;
      if (drag.moved) return;
    }
    const r = canvas.getBoundingClientRect();
    const n = pick((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    if (n !== hover) {
      hover = n;
      if (n) planHover(n); else hoverPath = null;
      canvas.style.cursor = n ? 'pointer' : 'grab';
    }
    showTip(hover, e.clientX, e.clientY);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.moved || e.type === 'pointercancel') return;
    const r = canvas.getBoundingClientRect();
    const n = pick((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    if (n) { clickNode(n, d.button === 2); showTip(n, e.clientX, e.clientY); }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (!drag) { hover = null; hoverPath = null; showTip(null); } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 30;
    fly = null;
    zoomAt(Math.exp(-dy * 0.0015), (e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    showTip(null);
  }, { passive: false });

  // ---------------------------------------------------------------- search
  function runSearch() {
    search = norm(searchIn.value.trim());
    matches = search.length >= 2 ? NODE_LIST.filter((n) => SEARCH_TEXT.get(n.id).includes(search)) : [];
    if (search.length < 2) search = '';
    matchIdx = -1;
    setText(searchN, search ? `${matches.length} résultat${matches.length > 1 ? 's' : ''}` : '');
    if (matches.length) nextMatch();
  }
  function nextMatch() {
    if (!matches.length) return;
    matchIdx = (matchIdx + 1) % matches.length;
    const n = matches[matchIdx];
    flyTo(n.x, -n.y, Math.max(view.s / dpr, 0.9));
  }
  searchIn.addEventListener('input', runSearch);
  searchIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nextMatch(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); searchIn.value = ''; runSearch(); searchIn.blur(); canvas.focus(); }
  });

  // ---------------------------------------------------------------- Renaissance (DECISIONS.md §3)
  let rnState = { affinity: null, understood: false };
  function openRenaissance() {
    if (!self) return;
    rnState = { affinity: null, understood: false };
    renderRenaissance();
    rnModal.hidden = false;
  }
  function closeRenaissance() { rnModal.hidden = true; }
  function renderRenaissance() {
    const rn = self.renaissance || { n: 0, max: RENAISSANCE.max, available: false, needsAffinity: false };
    const n = rn.n || 0;
    const next = n + 1;
    const pct = (k) => `${Math.round(k * RENAISSANCE.xpPct * 100)} %`;
    const inapt = (k) => `${Math.round(Math.abs(RULES.inaptitude.power) * Math.max(0, 1 - RENAISSANCE.inaptStep * k) * 100)} %`;
    const maxed = n >= RENAISSANCE.max;
    const levelOk = level() >= RENAISSANCE.level;
    const owned = new Set([self.cls, ...(treeState(self)?.affinity || [])]);
    const affChoices = TREE_CLASSES.filter((c) => !owned.has(c));
    const needs = !!rn.needsAffinity && affinitySlots(next) > affinitySlots(n);
    const bonus = (label, now, then) => h('li', null, h('span', { text: label }), h('b', { text: now === then ? then : `${now} → ${then}` }));
    const understood = h('input', { type: 'checkbox', id: 'bv-rn-ok', checked: rnState.understood, onchange: () => { rnState.understood = understood.checked; renderRenaissance(); } });
    const can = rn.available && !maxed && levelOk && rnState.understood && (!needs || rnState.affinity);
    const goBtn = h('button', { class: 'bv-btn bv-rn-go', type: 'button', disabled: !can, onclick: () => finalConfirm(needs) }, glyph('swirl'), h('span', { text: 'Renaître…' }));
    let why = '';
    if (maxed) why = 'Vous êtes déjà Né de la Brume V : la dernière Renaissance est accomplie.';
    else if (!levelOk) why = `La Renaissance s'ouvre au niveau ${RENAISSANCE.level} (vous êtes niveau ${level()}).`;
    else if (!rn.available) why = 'La Renaissance n\'est pas disponible pour l\'instant.';
    const box = h('div', { class: 'bv-tree-rn bv-frame', role: 'dialog', 'aria-label': 'La Renaissance' },
      h('button', { class: 'bv-win-close', type: 'button', 'aria-label': 'Fermer', onclick: closeRenaissance }, glyph('close')),
      h('h3', { class: 'bv-rn-title', text: 'La Renaissance' }),
      h('p', { class: 'bv-rn-sub', text: n ? `Vous êtes ${renaissanceTitle(n)}.` : 'Aucune Renaissance pour l\'instant.' }),
      h('p', { text: `Au niveau ${RENAISSANCE.level}, le rituel de la Brume vous ramène au niveau 1 et vous rend tous vos points, Fondamentaux compris : vous rechoisissez tout en remontant. Vous gardez votre équipement, votre or, votre sac, votre banque, vos quêtes terminées et vos métiers (un objet d'un niveau trop élevé attend que vous le regagniez).` }),
      h('div', { class: 'bv-rn-cols' },
        h('div', null, h('div', { class: 'bv-sec-title', text: maxed ? 'Vos bonus' : `Bonus de la Renaissance ${['I', 'II', 'III', 'IV', 'V'][Math.min(next, 5) - 1]}` }),
          h('ul', { class: 'bv-rn-bonus' },
            bonus('Expérience', `+${pct(n)}`, `+${pct(maxed ? n : next)}`),
            bonus('Inaptitude', `−${inapt(n)}`, `−${inapt(maxed ? n : next)}`),
            bonus('Points de compétence bonus', `+${n * RENAISSANCE.points}`, `+${(maxed ? n : next) * RENAISSANCE.points}`),
            bonus('Titre', n ? renaissanceTitle(n) : '—', renaissanceTitle(maxed ? n : next)),
            h('li', null, h('span', { text: 'Aura de brume spectrale' }), h('b', { text: 'visible par tous' })),
            h('li', null, h('span', { text: 'Classe d\'affinité (nœuds à 1 point)' }), h('b', { text: 'aux 2ᵉ et 4ᵉ Renaissances' })))),
        needs ? h('div', null, h('div', { class: 'bv-sec-title', text: 'Choisissez une classe d\'affinité' }),
          h('div', { class: 'bv-rn-aff' }, affChoices.map((c) => h('button', {
            class: `bv-rn-affbtn${rnState.affinity === c ? ' on' : ''}`, type: 'button', style: { '--cc': CLASSES[c]?.color || '#888' },
            onclick: () => { rnState.affinity = c; renderRenaissance(); },
          }, h('b', { text: CLASSES[c]?.name || c }), h('small', { text: 'Ses nœuds coûtent 1 point au lieu de 2.' }))))) : null),
      h('p', { class: 'bv-rn-note', text: 'Le rituel demande 10 secondes hors combat. (En attendant l\'Arbre-Brume du nouveau monde, il se fait n\'importe où.)' }),
      why ? h('p', { class: 'bv-rn-why', text: why }) : null,
      h('label', { class: 'bv-rn-check', for: 'bv-rn-ok' }, understood, h('span', { text: 'Je comprends que mon personnage revient au niveau 1 et que je devrai tout rechoisir.' })),
      h('div', { class: 'bv-rn-btns' }, h('button', { class: 'bv-btn small secondary', type: 'button', onclick: closeRenaissance }, h('span', { text: 'Plus tard' })), goBtn));
    clear(rnModal).appendChild(box);
  }
  function finalConfirm(needs) {
    const aff = needs ? rnState.affinity : null;
    const text = `Dernière confirmation : ${self.name} revient au niveau 1 et devient ${renaissanceTitle((self.renaissance?.n || 0) + 1)}${aff ? `, avec l'affinité ${CLASSES[aff]?.name}` : ''}. Cette action est définitive.`;
    const go = (ok) => {
      if (!ok) return;
      handlers.renaissance?.(aff);
      closeRenaissance();
    };
    if (menus?.confirm) menus.confirm({ title: 'Renaître de la Brume ?', text, ok: 'Renaître', cancel: 'Annuler', danger: true }, go);
    else go(window.confirm(text));
  }

  // ---------------------------------------------------------------- open / close
  function show() {
    if (open) return;
    open = true;
    el.hidden = false;
    resize();
    recompute();
    if (!view.init) { view.init = true; centerOnOwn(false); }
    lastT = 0;
    kick();
    requestAnimationFrame(() => canvas.focus({ preventScroll: true }));
  }
  function close() {
    if (!open) return;
    open = false;
    el.hidden = true;
    closeRenaissance();
    showTip(null);
    hover = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    onClose?.();
  }
  el.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); e.stopPropagation(); searchIn.focus(); searchIn.select(); }
  });
  window.addEventListener('resize', () => { if (open) resize(); });

  return {
    get isOpen() { return open; },
    get renaissanceOpen() { return !rnModal.hidden; },
    open: show,
    close,
    toggle: () => (open ? close() : show()),
    closeRenaissance,
    /** Open centred on the next suggested node (level-up « Ouvrir l'arbre »). */
    openGuide() {
      show();
      const id = [...(st?.guide || [])][0];
      const n = id && NODES.get(id);
      if (n) flyTo(n.x, -n.y, Math.max(0.8, view.s / dpr));
    },
    focusSearch() { show(); searchIn.focus(); },
    update(s) {
      const prevTree = self && treeState(self);
      self = s;
      // points / tree / level changed: pending nodes may be allocated now (or no longer valid)
      if (pending.length && prevTree !== treeState(s)) {
        const res = allocate(cls(), level(), skillsState([]), pending);
        if (!res.ok) pending = [];
      }
      if (open) recompute();
      if (!rnModal.hidden) renderRenaissance();
    },
    /** Debug / tests: pending list and node states. */
    _debug: () => ({ pending: [...pending], state: (id) => st?.states.get(id), view: { ...view }, free: st?.free }),
    _click: (id, right = false) => { const n = NODES.get(id); if (n) clickNode(n, right); },
    _confirm: () => confirmPending(),
    _guide: () => applyGuide(),
  };
}

// small helpers kept for tests
export const _internals = { SECTORS, LINKS, GROUPS, fmt1 };
