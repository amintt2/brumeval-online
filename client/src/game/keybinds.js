// [skilltree] Rebindable controls (docs/design/DECISIONS.md §4, ARBRE_COMPETENCES.md §14.4): every action has up to two
// bindings (keyboard `KeyboardEvent.code` — physical keys, so AZERTY and QWERTY share the same defaults — or a mouse
// button 'Mouse1' middle / 'Mouse3' back / 'Mouse4' forward). Saved in localStorage; the help panel, the action bar
// and every hint show the real binding. Pure module (no DOM needed; storage and layout detection are optional).

/** Mouse buttons that can be bound (left / right stay selection, attack and camera). */
export const MOUSE_CODES = ['Mouse1', 'Mouse3', 'Mouse4'];

const A = (id, label, group, def, extra = {}) => ({ id, label, group, def, ...extra });
/** Every rebindable action, in display order. group: move | combat | bar | ui. */
export const ACTIONS = [
  A('move_f', 'Avancer', 'move', ['KeyW', 'ArrowUp']),
  A('move_b', 'Reculer', 'move', ['KeyS', 'ArrowDown']),
  A('move_l', 'Aller à gauche', 'move', ['KeyA', 'ArrowLeft']),
  A('move_r', 'Aller à droite', 'move', ['KeyD', 'ArrowRight']),
  A('jump', 'Saut', 'combat', ['Space'], { hint: 'Passe au-dessus des ondes de choc au sol' }),
  A('roll', 'Roulade', 'combat', ['ShiftLeft', 'ShiftRight'], { hint: 'Sur la même touche que le Sprint : appui court' }),
  A('sprint', 'Sprint', 'combat', ['ShiftLeft', 'ShiftRight'], { hint: 'Sur la même touche que la Roulade : maintenir', hold: true }),
  A('guard', 'Garde', 'combat', ['KeyE'], { hint: 'Maintenir pour bloquer de face', hold: true }),
  A('target', 'Cibler l\'ennemi suivant', 'combat', ['Tab']),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => A(`slot${n}`, `Emplacement ${n} de la barre`, 'bar', [`Digit${n}`, `Numpad${n}`],
    n === 1 ? { hint: 'Attaque de base : maintenir pour l\'Attaque chargée' } : {})),
  A('tree', 'Arbre des Brumes', 'ui', ['KeyN']),
  A('book', 'Livre de compétences', 'ui', ['KeyK']),
  A('inventory', 'Sac', 'ui', ['KeyI']),
  A('character', 'Personnage', 'ui', ['KeyC']),
  A('quests', 'Journal de quêtes', 'ui', ['KeyL']),
  A('map', 'Carte du monde', 'ui', ['KeyM']),
  A('help', 'Aide', 'ui', ['KeyH']),
  A('options', 'Options', 'ui', ['KeyO']),
  A('chat', 'Discussion', 'ui', ['Enter', 'NumpadEnter']),
];
export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
export const GROUP_LABELS = { move: 'Déplacements', combat: 'Combat', bar: 'Barre d\'action', ui: 'Fenêtres' };
/** Pairs of actions that may share a key: Roulade (tap) + Sprint (hold) on the same key, as in Elden Ring. */
const SHAREABLE = [['roll', 'sprint']];
/** Keys that can never be bound (Escape closes windows / the menu, F-keys belong to the browser). */
const RESERVED = new Set(['Escape', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu']);
export const STORAGE_KEY = 'bv.keys.v1';

const storage = {
  get() { try { return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null; } catch { return null; } },
  set(v) { try { globalThis.localStorage?.setItem(STORAGE_KEY, v); } catch { /* private window */ } },
};

/** Default bindings (fresh copy). */
export function defaultBindings() {
  const out = {};
  for (const a of ACTIONS) out[a.id] = [a.def[0] ?? null, a.def[1] ?? null];
  return out;
}

const validCode = (c) => typeof c === 'string' && c.length > 0 && c.length <= 32 && /^[A-Za-z0-9]+$/.test(c) && !RESERVED.has(c);

/** Merge a stored object over the defaults (unknown actions / bad codes are ignored). */
export function sanitizeBindings(raw) {
  const out = defaultBindings();
  if (!raw || typeof raw !== 'object') return out;
  for (const a of ACTIONS) {
    const v = raw[a.id];
    if (!Array.isArray(v)) continue;
    out[a.id] = [0, 1].map((i) => (v[i] === null ? null : validCode(v[i]) ? v[i] : out[a.id][i]));
  }
  return out;
}

export const canShare = (a, b) => a === b || SHAREABLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/**
 * Bindings store. createKeybinds({ storage?: { get(), set(v) } }) → API. The game uses the shared instance
 * `keybinds` below; tests create their own.
 */
export function createKeybinds(opts = {}) {
  const st = opts.storage || storage;
  let binds = defaultBindings();
  try { binds = sanitizeBindings(JSON.parse(st.get() || 'null')); } catch { binds = defaultBindings(); }
  let index = new Map();
  const listeners = new Set();
  function reindex() {
    index = new Map();
    for (const a of ACTIONS) {
      for (const c of binds[a.id]) {
        if (!c) continue;
        if (!index.has(c)) index.set(c, []);
        if (!index.get(c).includes(a.id)) index.get(c).push(a.id);
      }
    }
  }
  reindex();
  // another tab of the game changed the bindings: follow it
  if (!opts.storage && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      try { binds = sanitizeBindings(JSON.parse(e.newValue || 'null')); } catch { binds = defaultBindings(); }
      reindex();
      for (const fn of listeners) {
        try { fn(api); } catch { /* ignore */ }
      }
    });
  }
  function changed() {
    reindex();
    st.set(JSON.stringify(binds));
    for (const fn of listeners) {
      try { fn(api); } catch { /* a listener must not break the others */ }
    }
  }
  const api = {
    /** Copy of every binding { action: [code|null, code|null] }. */
    all() { return JSON.parse(JSON.stringify(binds)); },
    /** Codes bound to an action (without nulls). */
    codesOf(id) { return (binds[id] || []).filter(Boolean); },
    /** Actions bound to a code ([] if none). */
    actionsOf(code) { return index.get(code) || []; },
    /** Is `code` bound to action `id`? */
    is(code, id) { return (index.get(code) || []).includes(id); },
    /**
     * Bind `code` to action `id` (slot 0 = primary, 1 = secondary; null clears). A key already used by another
     * action is taken away from it (conflict), except the shareable pairs (Roulade + Sprint).
     * Returns { ok, displaced: [actionId], error? }.
     */
    set(id, slot, code) {
      if (!ACTION_BY_ID.has(id) || (slot !== 0 && slot !== 1)) return { ok: false, displaced: [], error: 'Action inconnue.' };
      if (code !== null && !validCode(code)) return { ok: false, displaced: [], error: 'Cette touche est réservée.' };
      const displaced = [];
      if (code) {
        for (const other of ACTIONS) {
          if (other.id === id || canShare(id, other.id)) continue;
          const b = binds[other.id];
          for (let i = 0; i < 2; i++) if (b[i] === code) { b[i] = null; if (!displaced.includes(other.id)) displaced.push(other.id); }
        }
        // no duplicate on the same action
        const b = binds[id];
        if (b[1 - slot] === code) b[1 - slot] = null;
      }
      binds[id][slot] = code;
      changed();
      return { ok: true, displaced };
    },
    /** Restore every default. */
    reset() { binds = defaultBindings(); changed(); },
    /** Codes used by more than one action that are not allowed to share: [{ code, actions }]. */
    conflicts() {
      const out = [];
      for (const [code, ids] of index) {
        const bad = ids.filter((a) => ids.some((b) => !canShare(a, b)));
        if (bad.length > 1) out.push({ code, actions: bad });
      }
      return out;
    },
    /** Do Roulade and Sprint share a key (tap = roll, hold = sprint)? */
    rollSprintShared(code) { return api.is(code, 'roll') && api.is(code, 'sprint'); },
    /** Label of the primary binding of an action ('' if unbound). */
    label(id) { const c = api.codesOf(id)[0]; return c ? keyLabel(c) : ''; },
    /** Labels of every binding of an action. */
    labels(id) { return api.codesOf(id).map(keyLabel); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** The keyboard layout became known: labels changed (nothing saved). */
    emitLayout() {
      for (const fn of listeners) {
        try { fn(api); } catch { /* ignore */ }
      }
    },
  };
  return api;
}

// ------------------------------------------------------------------ labels (French, layout-aware)
const NAMED = {
  Space: 'Espace', ShiftLeft: 'Maj', ShiftRight: 'Maj droite', ControlLeft: 'Ctrl', ControlRight: 'Ctrl droite',
  AltLeft: 'Alt', AltRight: 'Alt Gr', Enter: 'Entrée', NumpadEnter: 'Entrée (pavé)', Tab: 'Tab', Backspace: 'Retour',
  CapsLock: 'Verr. maj', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Delete: 'Suppr', Insert: 'Inser',
  Home: 'Début', End: 'Fin', PageUp: 'Page ↑', PageDown: 'Page ↓', Mouse1: 'Clic molette', Mouse3: 'Souris 4',
  Mouse4: 'Souris 5', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';',
  Quote: '\'', Backslash: '\\', Comma: ',', Period: '.', Slash: '/', IntlBackslash: '<', NumpadAdd: '+ (pavé)',
  NumpadSubtract: '− (pavé)', NumpadMultiply: '× (pavé)', NumpadDivide: '÷ (pavé)', NumpadDecimal: '. (pavé)',
};
/** Physical code → character of the user's layout (learnt from keydown events and the Keyboard Map API). */
const layout = new Map();
let layoutTimer = 0;
/** Remember what a physical key prints on this keyboard (AZERTY: KeyW → Z). */
export function learnKey(code, key) {
  if (!code || typeof key !== 'string' || key.length !== 1 || key === ' ') return;
  if (/^(Key|Digit|Backquote|Minus|Equal|Bracket|Semicolon|Quote|Backslash|Comma|Period|Slash|IntlBackslash)/.test(code)) {
    const k = key.toUpperCase();
    if (layout.get(code) !== k) {
      layout.set(code, k);
      clearTimeout(layoutTimer);
      layoutTimer = setTimeout(() => keybinds?.emitLayout?.(), 60);
    }
  }
}
/** Ask the browser for the keyboard layout (Chromium only; silently ignored elsewhere). */
export async function detectLayout() {
  try {
    const map = await globalThis.navigator?.keyboard?.getLayoutMap?.();
    if (!map) return false;
    for (const [code, key] of map) learnKey(code, key);
    return true;
  } catch {
    return false;
  }
}
/** French label of a binding code ('KeyW' → 'Z' on AZERTY, 'W' on QWERTY). */
export function keyLabel(code) {
  if (!code) return '';
  if (layout.has(code) && !/^(Digit|Numpad)/.test(code)) return layout.get(code);
  if (NAMED[code]) return NAMED[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `${m[1]} (pavé)`;
  m = /^F(\d+)$/.exec(code);
  if (m) return code;
  return code;
}

/** Physical code of a keyboard event (virtual keyboards may send an empty `code`: derive it from `key`). */
export function eventCode(e) {
  if (e.code) return e.code;
  const k = e.key || '';
  if (/^[a-z]$/i.test(k)) return `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  return k === ' ' ? 'Space' : k;
}
/** Binding code of a mouse button (null for left / right, which are not rebindable). */
export const mouseCode = (button) => (button === 1 ? 'Mouse1' : button === 3 ? 'Mouse3' : button === 4 ? 'Mouse4' : null);

/** The shared bindings of the game. */
export const keybinds = createKeybinds();
