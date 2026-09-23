// Keyboard + pointer input. Movement keys use KeyboardEvent.code (KeyW/KeyA/KeyS/KeyD), so ZQSD on AZERTY
// keyboards works out of the box. Pointer events are only listened to on the canvas (UI panels sit above it).
const MOVE_CODES = {
  KeyW: 'f', ArrowUp: 'f',
  KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l',
  KeyD: 'r', ArrowRight: 'r',
};
const DRAG_PX = 5;
/** Shift pressed shorter than this = dodge roll (on release); held longer = sprint (docs/design/DECISIONS.md §4). */
export const SHIFT_TAP_MS = 200;
const isShift = (c) => c === 'ShiftLeft' || c === 'ShiftRight' || c === 'Shift';

/**
 * Physical key code of a keyboard event. Some virtual keyboards / remote-desktop tools send an empty
 * `code`: fall back to a code derived from `key` (letters → KeyX, digits → DigitN, named keys as is).
 */
function keyCode(e) {
  if (e.code) return e.code;
  const k = e.key || '';
  if (/^[a-z]$/i.test(k)) return `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  return k === ' ' ? 'Space' : k;
}

export class Input {
  /**
   * handlers: { isTyping(), onKey(code, ev), onClick(button, x, y, ev), onDrag(dx, dy, buttons), onWheel(dy),
   *             onHover(x, y), onDodge() (Shift tapped) }
   */
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.h = handlers;
    this.held = new Set();
    this.shift = new Set(); // [combat-souls] Shift key(s) held: tap = roll, hold = sprint
    this.shiftAt = 0;       // when the first Shift key went down (performance.now)
    this.shiftCombo = false; // Shift used as a modifier (Maj + clic droit, Maj + touche): no roll on release
    window.addEventListener('pointerdown', () => { if (this.shift.size) this.shiftCombo = true; }, true);
    this.mouseX = window.innerWidth / 2;
    this.mouseY = window.innerHeight / 2;
    this.buttons = 0;
    this.down = null; // { x, y, button, dragged }
    this.enabled = true;

    window.addEventListener('keydown', (e) => this._keyDown(e));
    window.addEventListener('keyup', (e) => {
      const c = keyCode(e);
      this.held.delete(c);
      if (isShift(c) && this.shift.delete(c) && this.shift.size === 0) {
        // released before the sprint threshold: a tap = dodge roll
        if (this.enabled && !this.typing() && !this.shiftCombo && performance.now() - this.shiftAt < SHIFT_TAP_MS) this.h.onDodge?.();
      }
    });
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this._pointerDown(e));
    canvas.addEventListener('pointermove', (e) => this._pointerMove(e));
    canvas.addEventListener('pointerup', (e) => this._pointerUp(e));
    canvas.addEventListener('pointercancel', () => { this.down = null; this.buttons = 0; });
    canvas.addEventListener('lostpointercapture', (e) => { this.buttons = e.buttons || 0; });
    window.addEventListener('pointermove', (e) => { this.mouseX = e.clientX; this.mouseY = e.clientY; }, { passive: true });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 30;
      else if (e.deltaMode === 2) dy *= 300;
      this.h.onWheel?.(dy);
    }, { passive: false });
  }

  reset() {
    this.held.clear();
    this.shift.clear();
    this.buttons = 0;
    this.down = null;
  }

  typing() {
    try {
      return !!this.h.isTyping?.();
    } catch {
      return false;
    }
  }

  _keyDown(e) {
    if (this.typing()) {
      this.held.clear();
      return;
    }
    const t = e.target;
    if (t && t !== document.body && t !== this.canvas && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
      return; // a form field of the UI has focus
    }
    if (!this.enabled) return;
    const code = keyCode(e);
    if (code === 'Tab') e.preventDefault();
    // Space is reserved for the jump (v0.3): no page scroll / button press. Shift: tap = roll, hold = sprint.
    if (code === 'Space') e.preventDefault();
    if (isShift(code) && !this.shift.has(code)) {
      if (this.shift.size === 0) { this.shiftAt = performance.now(); this.shiftCombo = false; }
      this.shift.add(code);
    } else if (!isShift(code) && this.shift.size && !MOVE_CODES[code]) {
      this.shiftCombo = true;
    }
    if (MOVE_CODES[code]) {
      this.held.add(code);
      if (code.startsWith('Arrow')) e.preventDefault();
    }
    if (!e.repeat || code === 'Tab') this.h.onKey?.(code, e);
  }

  _pointerDown(e) {
    if (document.activeElement && document.activeElement !== this.canvas && document.activeElement !== document.body) {
      document.activeElement.blur?.();
    }
    this.canvas.focus({ preventScroll: true });
    this.buttons = e.buttons;
    this.mouseX = e.clientX; this.mouseY = e.clientY;
    if (!this.down) {
      this.down = { x: e.clientX, y: e.clientY, button: e.button, dragged: false, multi: false, lastX: e.clientX, lastY: e.clientY };
    } else {
      this.down.multi = true; // a second button joined (both buttons = run): never treat the release as a click
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  _pointerMove(e) {
    this.mouseX = e.clientX; this.mouseY = e.clientY;
    this.buttons = e.buttons;
    const d = this.down;
    // chorded presses (second button while one is held) only arrive as pointermove
    if (d && (e.buttons & 3) === 3) d.multi = true;
    if (d && e.buttons) {
      if (!d.dragged && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_PX) d.dragged = true;
      if (d.dragged) {
        this.h.onDrag?.(e.clientX - d.lastX, e.clientY - d.lastY, e.buttons);
      }
      d.lastX = e.clientX; d.lastY = e.clientY;
    } else {
      this.h.onHover?.(e.clientX, e.clientY);
    }
  }

  _pointerUp(e) {
    this.buttons = e.buttons;
    const d = this.down;
    if (d && e.buttons === 0) {
      this.down = null;
      if (!d.dragged && !d.multi) this.h.onClick?.(d.button, e.clientX, e.clientY, e);
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  /** Shift held longer than SHIFT_TAP_MS (and not typing): sprint. A tap never sprints. */
  get sprinting() {
    return this.shift.size > 0 && this.enabled && !this.typing() && performance.now() - this.shiftAt >= SHIFT_TAP_MS;
  }

  get dragging() {
    return !!(this.down && this.down.dragged);
  }

  /** Movement axes in camera space: fz forward (+1) / back, fx right (+1) / left. */
  axes(out) {
    let fz = 0, fx = 0;
    if (!this.typing() && this.enabled) {
      for (const c of this.held) {
        const m = MOVE_CODES[c];
        if (m === 'f') fz += 1;
        else if (m === 'b') fz -= 1;
        else if (m === 'r') fx += 1;
        else if (m === 'l') fx -= 1;
      }
      // both mouse buttons held = run forward (classic MMO control)
      if ((this.buttons & 3) === 3) fz = 1;
    }
    out.fx = Math.max(-1, Math.min(1, fx));
    out.fz = Math.max(-1, Math.min(1, fz));
    return out;
  }
}
