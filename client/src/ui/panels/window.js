// Generic draggable window + a manager that handles z-order, toggling and "close top-most" (Escape).
import { h } from '../dom.js';
import { glyph } from '../icons.js';

/**
 * createWindow({ id, title, subtitle?, keyHint?, cls?, onRequestClose? })
 * → { id, el, head, body, footer, setTitle, setSubtitle, isOpen, show(), hide(), requestClose() }
 * onRequestClose: called when the user closes it (X / Escape / key). Defaults to hide().
 */
export function createWindow(opts) {
  const titleEl = h('h2', { class: 'bv-win-title', text: opts.title });
  const subEl = h('div', { class: 'bv-win-sub' });
  const closeBtn = h('button', { class: 'bv-win-close', type: 'button', title: 'Fermer (Échap)', 'aria-label': 'Fermer' }, glyph('close'));
  const head = h('header', { class: 'bv-win-head' },
    h('div', { class: 'bv-win-titles' }, titleEl, subEl),
    opts.keyHint ? h('kbd', { class: 'bv-win-key', text: opts.keyHint }) : null,
    closeBtn);
  const body = h('div', { class: 'bv-win-body' });
  const footer = h('footer', { class: 'bv-win-foot' });
  const el = h('section', {
    class: `bv-win bv-frame is-closed bv-win-${opts.id} ${opts.cls || ''}`.trim(),
    role: 'dialog',
    'aria-label': opts.title,
  }, head, body, footer);

  const win = {
    id: opts.id,
    el,
    head,
    body,
    footer,
    isOpen: false,
    dragged: false,
    setTitle(t) { titleEl.textContent = t; el.setAttribute('aria-label', t); },
    setSubtitle(t) { subEl.textContent = t || ''; subEl.hidden = !t; },
    show() {
      if (win.isOpen) return;
      win.isOpen = true;
      el.classList.remove('is-closed');
      el.classList.add('is-open');
      opts.onShow?.();
    },
    hide() {
      if (!win.isOpen) return;
      win.isOpen = false;
      el.classList.remove('is-open');
      el.classList.add('is-closed');
      opts.onHide?.();
    },
    requestClose() {
      if (opts.onRequestClose) opts.onRequestClose();
      else win.hide();
    },
  };
  win.setSubtitle(opts.subtitle || '');
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    win.requestClose();
  });

  // ---------------------------------------------------------------- dragging by the header
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    head.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    e.preventDefault();
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    moveTo(e.clientX - drag.dx, e.clientY - drag.dy);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    el.classList.remove('is-dragging');
  };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);

  function moveTo(x, y) {
    const r = el.getBoundingClientRect();
    const maxX = window.innerWidth - r.width;
    const maxY = window.innerHeight - Math.min(r.height, 60);
    const nx = Math.round(Math.max(0, Math.min(maxX, x)));
    const ny = Math.round(Math.max(0, Math.min(maxY, y)));
    el.style.left = `${nx}px`;
    el.style.top = `${ny}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
    win.dragged = true;
  }
  win.clampToViewport = () => {
    if (!win.dragged) return;
    const r = el.getBoundingClientRect();
    moveTo(r.left, r.top);
  };
  return win;
}

export function createWindowManager(layer) {
  const wins = new Map();
  let z = 10;

  function front(w) {
    if (Number(w.el.style.zIndex) === z) return;
    w.el.style.zIndex = String(++z);
  }
  function add(w) {
    wins.set(w.id, w);
    layer.appendChild(w.el);
    w.el.addEventListener('pointerdown', () => front(w), true);
    return w;
  }
  function open(id) {
    const w = wins.get(id);
    if (!w) return;
    w.show();
    front(w);
  }
  function close(id) {
    wins.get(id)?.hide();
  }
  function toggle(id) {
    const w = wins.get(id);
    if (!w) return;
    if (w.isOpen) w.requestClose();
    else open(id);
  }
  /** Close the open window with the highest z-index. Returns true when one was closed. */
  function closeTop() {
    let top = null;
    for (const w of wins.values()) {
      if (!w.isOpen) continue;
      if (!top || Number(w.el.style.zIndex || 0) > Number(top.el.style.zIndex || 0)) top = w;
    }
    if (!top) return false;
    top.requestClose();
    return true;
  }
  function closeAll() {
    for (const w of wins.values()) if (w.isOpen) w.hide();
  }
  window.addEventListener('resize', () => {
    for (const w of wins.values()) w.clampToViewport();
  });
  return { add, open, close, toggle, closeTop, closeAll, front, get: (id) => wins.get(id), isOpen: (id) => !!wins.get(id)?.isOpen };
}
