// [skilltree] Pointer-based drag & drop (skill book → action bar, bar slot ↔ bar slot, bar → outside = clear).
// A ghost icon follows the pointer; drop targets are elements with a `data-drop` attribute, and the source decides
// what happens through onDrop(target | null). Works with mouse, pen and touch (no HTML5 DnD quirks).
import { h, clear } from './dom.js';

let ghost = null;
let drag = null;

function ensureGhost() {
  if (ghost) return ghost;
  ghost = h('div', { class: 'bv-drag-ghost', 'aria-hidden': 'true' });
  document.body.appendChild(ghost);
  return ghost;
}

/** Is a drag in progress? */
export const dragging = () => !!drag?.active;

/**
 * Make `el` draggable. opts = { payload(): any | null, icon(): Node, onDrop(targetEl | null, payload), onStart?() }
 * A drag starts after 6 px of movement (a click stays a click).
 */
export function makeDraggable(el, opts) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const payload = opts.payload();
    if (payload == null) return;
    drag = { el, opts, payload, x: e.clientX, y: e.clientY, active: false, id: e.pointerId, over: null };
    const move = (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      if (!drag.active) {
        if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 6) return;
        drag.active = true;
        const g = ensureGhost();
        clear(g).appendChild(opts.icon());
        g.classList.add('show');
        document.documentElement.classList.add('bv-is-dragging');
        opts.onStart?.();
      }
      ghost.style.transform = `translate(${ev.clientX - 22}px, ${ev.clientY - 22}px)`;
      const t = targetAt(ev.clientX, ev.clientY);
      if (t !== drag.over) {
        drag.over?.classList.remove('drop-over');
        t?.classList.add('drop-over');
        drag.over = t;
      }
    };
    const up = (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      const d = drag;
      drag = null;
      d.over?.classList.remove('drop-over');
      if (!d.active) return;
      ghost?.classList.remove('show');
      document.documentElement.classList.remove('bv-is-dragging');
      // a drag must not also count as a click on the source
      const stop = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
      el.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 0);
      if (ev.type === 'pointercancel') return;
      d.opts.onDrop(targetAt(ev.clientX, ev.clientY), d.payload);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  });
}

function targetAt(x, y) {
  const stack = document.elementsFromPoint(x, y);
  for (const n of stack) {
    if (n === ghost || ghost?.contains(n)) continue;
    const t = n.closest?.('[data-drop]');
    if (t) return t;
  }
  return null;
}
