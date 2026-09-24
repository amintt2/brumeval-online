// Keyboard + pointer input. Every action goes through the rebindable controls (game/keybinds.js): keyboard keys are
// physical codes (KeyboardEvent.code), so ZQSD on AZERTY keyboards works out of the box; the middle / side mouse
// buttons can be bound too. Pointer events are only listened to on the canvas (UI panels sit above it).
// [skilltree] Roulade + Sprint on the same key (default Shift): tap = roll, hold = sprint (DECISIONS.md §4).
import { keybinds, eventCode, mouseCode, learnKey } from './keybinds.js';

const DRAG_PX = 5;
/** Roll/sprint key pressed shorter than this = dodge roll (on release); held longer = sprint. */
export const SHIFT_TAP_MS = 200;
const MOVE = { move_f: 'f', move_b: 'b', move_l: 'l', move_r: 'r' };
const moveOf = (code) => {
  for (const a of keybinds.actionsOf(code)) if (MOVE[a]) return MOVE[a];
  return null;
};

export class Input {
  /**
   * handlers: { isTyping(), onKey(code, ev), onKeyUp(code, ev), onClick(button, x, y, ev), onDrag(dx, dy, buttons),
   *             onWheel(dy), onHover(x, y), onDodge() (roll), onAction(actionId, down, code) (jump, guard, bar slots…) }
   */
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.h = handlers;
    this.held = new Set();     // held movement codes
    this.pressed = new Set();  // every held bound code (keys + mouse buttons)
    this.shift = new Set();    // held roll/sprint shared key(s): tap = roll, hold = sprint
    this.shiftAt = 0;          // when the first of them went down (performance.now)
    this.shiftCombo = false;   // used as a modifier (Maj + clic droit, Maj + touche): no roll on release
    this.sprintHeld = new Set(); // held sprint-only codes (sprint on its own key)
    window.addEventListener('pointerdown', () => { if (this.shift.size) this.shiftCombo = true; }, true);
    this.mouseX = window.innerWidth / 2;
    this.mouseY = window.innerHeight / 2;
    this.buttons = 0;
    this.down = null; // { x, y, button, dragged }
    this.enabled = true;

    window.addEventListener('keydown', (e) => this._keyDown(e));
    window.addEventListener('keyup', (e) => this._keyUp(eventCode(e), e));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    // the side buttons navigate back / forward in the browser: never while playing
    window.addEventListener('mouseup', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
    window.addEventListener('pointerup', (e) => {
      const mc = mouseCode(e.button);
      if (mc && this.pressed.has(mc)) this._keyUp(mc, e);
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this._pointerDown(e));
    canvas.addEventListener('pointermove', (e) => this._pointerMove(e));
    canvas.addEventListener('pointerup', (e) => this._pointerUp(e));
    canvas.addEventListener('pointercancel', () => { this.down = null; this.buttons = 0; });
    canvas.addEventListener('lostpointercapture', (e) => { this.buttons = e.buttons || 0; });
    canvas.addEventListener('auxclick', (e) => e.preventDefault());
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
    for (const c of [...this.pressed]) this._release(c, null, true);
    this.held.clear();
    this.pressed.clear();
    this.shift.clear();
    this.sprintHeld.clear();
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
    learnKey(e.code, e.key);
    if (this.typing()) {
      this.held.clear();
      return;
    }
    const t = e.target;
    if (t && t !== document.body && t !== this.canvas && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
      return; // a form field of the UI has focus
    }
    if (!this.enabled) return;
    const code = eventCode(e);
    if (code === 'Tab') e.preventDefault();
    // Space and the arrows would scroll / press a focused button
    if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault();
    this._press(code, e);
  }

  _keyUp(code, e) {
    if (!this.pressed.has(code) && !this.held.has(code)) return;
    this._release(code, e, false);
  }

  /** A bound code went down (key or mouse button). */
  _press(code, e) {
    const repeat = !!e?.repeat;
    const shared = keybinds.rollSprintShared(code);
    if (!repeat) {
      if (shared && !this.shift.has(code)) {
        if (this.shift.size === 0) { this.shiftAt = performance.now(); this.shiftCombo = false; }
        this.shift.add(code);
      } else if (!shared && this.shift.size && !moveOf(code)) {
        this.shiftCombo = true;
      }
    }
    if (moveOf(code)) this.held.add(code);
    const first = !this.pressed.has(code);
    this.pressed.add(code);
    if (!repeat || code === 'Tab') this.h.onKey?.(code, e);
    if (!first || repeat) return;
    for (const a of keybinds.actionsOf(code)) {
      if (a === 'sprint' && !shared) this.sprintHeld.add(code);
      else if (a === 'roll' && !shared) { if (this.enabled && !this.typing()) this.h.onDodge?.(); }
      else if (!MOVE[a] && a !== 'roll' && a !== 'sprint') this.h.onAction?.(a, true, code, e);
    }
  }

  /** A bound code went up. `silent`: focus lost (no roll, but the held actions are released). */
  _release(code, e, silent) {
    this.held.delete(code);
    const was = this.pressed.delete(code);
    this.sprintHeld.delete(code);
    if (this.shift.delete(code) && this.shift.size === 0 && !silent) {
      // released before the sprint threshold: a tap = dodge roll
      if (this.enabled && !this.typing() && !this.shiftCombo && performance.now() - this.shiftAt < SHIFT_TAP_MS) this.h.onDodge?.();
    }
    if (!was) return;
    this.h.onKeyUp?.(code, e);
    for (const a of keybinds.actionsOf(code)) {
      if (!MOVE[a] && a !== 'roll' && a !== 'sprint') this.h.onAction?.(a, false, code, e);
    }
  }

  /** Is an action's key (or button) held right now? */
  isHeld(actionId) {
    for (const c of keybinds.codesOf(actionId)) if (this.pressed.has(c)) return true;
    return false;
  }

  _pointerDown(e) {
    if (document.activeElement && document.activeElement !== this.canvas && document.activeElement !== document.body) {
      document.activeElement.blur?.();
    }
    this.canvas.focus({ preventScroll: true });
    // [skilltree] a bound mouse button (middle / side) is an action, not a camera drag
    const mc = mouseCode(e.button);
    if (mc && keybinds.actionsOf(mc).length) {
      e.preventDefault();
      if (this.enabled && !this.typing()) this._press(mc, e);
      return;
    }
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
    if (d && (e.buttons & 7) === 0) {
      this.down = null;
      if (!d.dragged && !d.multi) this.h.onClick?.(d.button, e.clientX, e.clientY, e);
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  /** Sprint: the shared roll/sprint key held longer than SHIFT_TAP_MS, or a sprint-only key held. */
  get sprinting() {
    if (!this.enabled || this.typing()) return false;
    if (this.sprintHeld.size) return true;
    return this.shift.size > 0 && performance.now() - this.shiftAt >= SHIFT_TAP_MS;
  }

  get dragging() {
    return !!(this.down && this.down.dragged);
  }

  /** Movement axes in camera space: fz forward (+1) / back, fx right (+1) / left. */
  axes(out) {
    let fz = 0, fx = 0;
    if (!this.typing() && this.enabled) {
      for (const c of this.held) {
        const m = moveOf(c);
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
