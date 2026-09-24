// [skilltree] Options › Commandes: rebind every action (keyboard keys, middle / side mouse buttons), two bindings per
// action, conflict detection (a key taken from another action is announced; Roulade + Sprint may share a key: tap /
// hold), reset to the defaults (DECISIONS.md §4). Saved in localStorage by game/keybinds.js.
import { h, setText, clear } from '../dom.js';
import { ACTIONS, ACTION_BY_ID, GROUP_LABELS, keybinds, keyLabel, eventCode, mouseCode } from '../../game/keybinds.js';

let capture = null; // { id, slot, btn }
/** A binding is being captured: the game and the UI shortcuts must ignore the keys. */
export const isCapturing = () => !!capture;

export function createControlsSection({ menus, notify } = {}) {
  const note = h('div', { class: 'bv-kb-note', 'aria-live': 'polite' });
  const table = h('div', { class: 'bv-kb-table' });
  const resetBtn = h('button', {
    type: 'button', class: 'bv-btn small secondary', text: 'Touches par défaut',
    onclick: () => {
      const go = (ok) => { if (ok) { keybinds.reset(); say('Toutes les touches sont revenues à leurs valeurs par défaut.'); } };
      if (menus?.confirm) menus.confirm({ title: 'Touches par défaut', text: 'Remettre toutes les touches à leurs valeurs par défaut ?', ok: 'Réinitialiser', cancel: 'Annuler' }, go);
      else go(true);
    },
  });
  const el = h('div', { class: 'bv-kb' },
    h('p', { class: 'bv-kb-intro', text: 'Cliquez une touche puis appuyez sur la nouvelle (clavier ou bouton de souris : molette, boutons latéraux). Échap : annuler · Retour arrière : effacer.' }),
    table, note, h('div', { class: 'bv-kb-foot' }, resetBtn));

  function say(text, bad = false) {
    setText(note, text);
    note.classList.toggle('bad', bad);
  }

  function render() {
    const conflicts = keybinds.conflicts();
    const bad = new Set(conflicts.flatMap((c) => c.actions));
    clear(table);
    let group = null;
    for (const a of ACTIONS) {
      if (a.group !== group) {
        group = a.group;
        table.appendChild(h('div', { class: 'bv-kb-group', text: GROUP_LABELS[group] }));
      }
      const codes = keybinds.all()[a.id];
      const btns = [0, 1].map((slot) => {
        const code = codes[slot];
        const b = h('button', {
          type: 'button',
          class: `bv-kb-key${code ? '' : ' empty'}${capture && capture.id === a.id && capture.slot === slot ? ' listening' : ''}`,
          'aria-label': `${a.label} : ${code ? keyLabel(code) : 'aucune touche'} (${slot ? 'secondaire' : 'principale'})`,
          text: capture && capture.id === a.id && capture.slot === slot ? 'Appuyez…' : code ? keyLabel(code) : '—',
          onclick: (e) => { e.stopPropagation(); startCapture(a.id, slot); },
        });
        return b;
      });
      const unbound = !codes[0] && !codes[1];
      table.appendChild(h('div', { class: `bv-kb-row${bad.has(a.id) ? ' conflict' : ''}${unbound ? ' unbound' : ''}` },
        h('span', { class: 'bv-kb-label' }, h('span', { text: a.label }), a.hint ? h('small', { text: a.hint }) : null),
        ...btns));
    }
    if (conflicts.length) say(`Conflit : ${conflicts.map((c) => `${keyLabel(c.code)} (${c.actions.map((x) => ACTION_BY_ID.get(x).label).join(', ')})`).join(' · ')}`, true);
  }

  function startCapture(id, slot) {
    stopCapture();
    capture = { id, slot };
    render();
    say(`« ${ACTION_BY_ID.get(id).label} » : appuyez sur une touche…`);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('mouseup', swallowSide, true);
  }
  function stopCapture() {
    if (!capture) return;
    capture = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointer, true);
    setTimeout(() => window.removeEventListener('mouseup', swallowSide, true), 0);
  }
  function swallowSide(e) { if (e.button === 3 || e.button === 4) e.preventDefault(); }
  function assign(code) {
    const { id, slot } = capture;
    stopCapture();
    const res = keybinds.set(id, slot, code);
    if (!res.ok) { say(res.error || 'Touche refusée.', true); render(); return; }
    const label = ACTION_BY_ID.get(id).label;
    if (!code) say(`« ${label} » : touche effacée.`);
    else if (res.displaced.length) {
      const names = res.displaced.map((x) => `« ${ACTION_BY_ID.get(x).label} »`).join(', ');
      say(`${keyLabel(code)} est maintenant « ${label} » — retirée de ${names}.`, true);
      notify?.(`${keyLabel(code)} retirée de ${names}.`, 'info');
    } else say(`« ${label} » : ${keyLabel(code)}.`);
    render();
  }
  function onKey(e) {
    if (!capture) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const code = eventCode(e);
    if (code === 'Escape') { stopCapture(); say('Modification annulée.'); render(); return; }
    if (code === 'Backspace' || code === 'Delete') { assign(null); return; }
    assign(code);
  }
  function onPointer(e) {
    if (!capture) return;
    const mc = mouseCode(e.button);
    if (!mc) {
      // left / right click elsewhere: cancel (they stay selection / attack / camera)
      if (!e.target.closest?.('.bv-kb-key')) { stopCapture(); say('Modification annulée.'); render(); }
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    assign(mc);
  }

  keybinds.onChange(() => { if (!capture) render(); });
  render();
  return { el, render, cancel: () => { if (capture) { stopCapture(); render(); } } };
}
