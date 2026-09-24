// [accounts] Modal sheets shown above everything (screens and HUD): the account panel and the in-game main menu.
// A sheet traps nothing fancy: Escape closes the top-most one (ui/index.js), focus goes to its first control.
import { h, setText } from './dom.js';
import { glyph } from './icons.js';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDate = (ts) => (ts ? dateFmt.format(new Date(ts)) : '—');

export function createSheetStack() {
  const stack = [];
  return {
    push(s) { if (!stack.includes(s)) stack.push(s); },
    remove(s) { const i = stack.indexOf(s); if (i >= 0) stack.splice(i, 1); },
    closeTop() {
      const s = stack.at(-1);
      if (!s) return false;
      s.close();
      return true;
    },
    get open() { return stack.length > 0; },
  };
}

function sheetShell(layer, stack, { id, title, cls = '' }) {
  const titleEl = h('h2', { class: 'bv-sheet-title', id: `${id}-t`, text: title });
  const closeBtn = h('button', { class: 'bv-win-close', type: 'button', title: 'Fermer (Échap)', 'aria-label': 'Fermer' }, glyph('close'));
  const body = h('div', { class: 'bv-sheet-body' });
  const card = h('div', { class: `bv-sheet bv-frame ${cls}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-t` },
    h('header', { class: 'bv-sheet-head' }, titleEl, closeBtn), body);
  const veil = h('div', { class: 'bv-sheet-veil' }, card);
  layer.appendChild(veil);
  let lastFocus = null;
  const api = {
    card, body, titleEl,
    isOpen: false,
    onClose: null,
    open() {
      if (api.isOpen) return;
      api.isOpen = true;
      lastFocus = document.activeElement;
      veil.classList.add('show');
      stack.push(api);
      setTimeout(() => card.querySelector('button:not(:disabled):not(.bv-win-close), input')?.focus({ preventScroll: true }), 40);
    },
    close() {
      if (!api.isOpen) return;
      api.isOpen = false;
      veil.classList.remove('show');
      stack.remove(api);
      if (card.contains(document.activeElement)) document.activeElement.blur();
      if (lastFocus && lastFocus.isConnected && typeof lastFocus.focus === 'function' && lastFocus !== document.body) lastFocus.focus({ preventScroll: true });
      api.onClose?.();
    },
  };
  closeBtn.addEventListener('click', () => api.close());
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) api.close(); });
  return api;
}

// ================================================================== account panel
export function createAccountSheet(layer, stack, H, menus) {
  const sheet = sheetShell(layer, stack, { id: 'bv-acc', title: 'Compte', cls: 'bv-acc' });
  let data = null;
  let passkeyOk = false;

  const msg = h('div', { class: 'bv-acc-msg', role: 'status', 'aria-live': 'polite' });
  const who = h('div', { class: 'bv-acc-who' });

  // passkeys
  const pkList = h('ul', { class: 'bv-acc-pk' });
  // adding a passkey needs the password again unless it was typed a few minutes ago (server: reauth_required)
  const pkPw = h('input', { class: 'bv-input', type: 'password', autocomplete: 'current-password', maxLength: 64, id: 'bv-acc-pkpw' });
  const pkPwField = h('label', { class: 'bv-field', for: 'bv-acc-pkpw', hidden: true },
    h('span', { class: 'bv-field-l', text: 'Mot de passe actuel (confirmation)' }), pkPw);
  const pkAdd = h('button', { class: 'bv-btn small gold', type: 'button', onclick: () => { H.passkeyAdd(pkPw.value); pkPw.value = ''; } }, glyph('key'), h('span', { text: 'Ajouter une clé d’accès' }));
  pkPw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pkAdd.click(); } });
  const pkNote = h('p', { class: 'bv-acc-note' });

  // password
  const oldIn = h('input', { class: 'bv-input', type: 'password', autocomplete: 'current-password', maxLength: 64, id: 'bv-acc-old' });
  const newIn = h('input', { class: 'bv-input', type: 'password', autocomplete: 'new-password', maxLength: 64, id: 'bv-acc-new' });
  const new2In = h('input', { class: 'bv-input', type: 'password', autocomplete: 'new-password', maxLength: 64, id: 'bv-acc-new2' });
  const pwBtn = h('button', { class: 'bv-btn small secondary', type: 'submit', text: 'Changer le mot de passe' });
  const revokeIn = h('input', { type: 'checkbox', id: 'bv-acc-revoke', class: 'bv-check' });
  revokeIn.checked = true;
  const revokeField = h('label', { class: 'bv-remember bv-acc-revoke', for: 'bv-acc-revoke' }, revokeIn,
    h('span', { class: 'bv-remember-box', 'aria-hidden': 'true' }),
    h('small', { text: 'Supprimer aussi toutes les clés d’accès (recommandé si quelqu’un d’autre a pu accéder au compte)' }));
  const pwForm = h('form', { class: 'bv-acc-pw', novalidate: true },
    h('input', { type: 'text', autocomplete: 'username', hidden: true, class: 'bv-acc-user', 'aria-hidden': 'true', tabIndex: -1 }),
    h('label', { class: 'bv-field', for: 'bv-acc-old' }, h('span', { class: 'bv-field-l', text: 'Mot de passe actuel' }), oldIn),
    h('label', { class: 'bv-field', for: 'bv-acc-new' }, h('span', { class: 'bv-field-l', text: 'Nouveau (6 à 64 caractères)' }), newIn),
    h('label', { class: 'bv-field', for: 'bv-acc-new2' }, h('span', { class: 'bv-field-l', text: 'Confirmation' }), new2In),
    revokeField,
    pwBtn);
  pwForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (newIn.value.length < 6 || newIn.value.length > 64) return setMsg('Le nouveau mot de passe doit comporter 6 à 64 caractères.', true);
    if (newIn.value !== new2In.value) return setMsg('Les deux mots de passe ne correspondent pas.', true);
    if (!oldIn.value) return setMsg('Entrez votre mot de passe actuel.', true);
    const hasKeys = (data?.account?.passkeys || []).length > 0;
    H.passwordChange(oldIn.value, newIn.value, hasKeys && revokeIn.checked);
  });

  // sessions
  const sessions = h('p', { class: 'bv-acc-note' });
  const logoutAll = h('button', { class: 'bv-btn small danger', type: 'button' }, glyph('logout'), h('span', { text: 'Se déconnecter partout' }));
  logoutAll.addEventListener('click', () => {
    menus.confirm({
      title: 'Se déconnecter partout ?',
      text: 'Tous les appareils mémorisés (« Rester connecté ») devront se reconnecter, y compris celui-ci. Les autres connexions ouvertes sont fermées.',
      ok: 'Se déconnecter partout', danger: true,
    }, (ok) => { if (ok) H.logoutAll(); });
  });

  sheet.body.append(
    who,
    msg,
    h('section', { class: 'bv-acc-sec' },
      h('h3', { class: 'bv-sec-title', text: 'Clés d’accès (passkeys)' }),
      h('p', { class: 'bv-acc-note', text: 'Connectez-vous sans mot de passe avec l’empreinte, le visage ou le code de votre appareil.' }),
      pkList, pkNote, pkPwField, h('div', { class: 'bv-acc-row' }, pkAdd)),
    h('section', { class: 'bv-acc-sec' },
      h('h3', { class: 'bv-sec-title', text: 'Mot de passe' }),
      pwForm),
    h('section', { class: 'bv-acc-sec' },
      h('h3', { class: 'bv-sec-title', text: 'Sessions' }),
      sessions,
      h('div', { class: 'bv-acc-row' }, logoutAll)));

  function setMsg(text, error = false) {
    setText(msg, text || '');
    msg.classList.toggle('error', !!error);
  }

  function renderPasskeys() {
    pkList.replaceChildren();
    const keys = data?.account?.passkeys || [];
    if (!keys.length) pkList.appendChild(h('li', { class: 'bv-acc-pk-empty', text: 'Aucune clé d’accès pour le moment.' }));
    for (const k of keys) {
      const label = h('span', { class: 'bv-acc-pk-l', text: k.label });
      const input = h('input', { class: 'bv-input small', type: 'text', maxLength: 40, value: k.label, hidden: true, 'aria-label': 'Nom de la clé' });
      const rename = h('button', { class: 'bv-btn small secondary', type: 'button', text: 'Renommer' });
      const del = h('button', { class: 'bv-btn small secondary', type: 'button', 'aria-label': `Supprimer la clé ${k.label}` }, glyph('trash'));
      const commit = () => {
        const v = input.value.trim();
        input.hidden = true;
        label.hidden = false;
        rename.textContent = 'Renommer';
        if (v && v !== k.label) H.passkeyRename(k.id, v);
      };
      rename.addEventListener('click', () => {
        if (input.hidden) {
          input.hidden = false;
          label.hidden = true;
          rename.textContent = 'Valider';
          input.focus();
          input.select();
        } else commit();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.value = k.label; input.hidden = true; label.hidden = false; rename.textContent = 'Renommer'; }
      });
      del.addEventListener('click', () => menus.confirm({
        title: 'Supprimer cette clé d’accès ?',
        text: `« ${k.label} » ne permettra plus de se connecter. Pensez aussi à la retirer du gestionnaire de mots de passe de l’appareil.`,
        ok: 'Supprimer', danger: true,
      }, (ok) => { if (ok) H.passkeyDelete(k.id); }));
      pkList.appendChild(h('li', { class: 'bv-acc-pk-item' },
        glyph('key'),
        h('span', { class: 'bv-acc-pk-main' }, label, input,
          h('small', { text: `Ajoutée le ${fmtDate(k.created)} · ${k.used ? `utilisée le ${fmtDate(k.used)}` : 'jamais utilisée'}` })),
        rename, del));
    }
    pkAdd.disabled = !passkeyOk;
    revokeField.hidden = !keys.length;
    setText(pkNote, passkeyOk ? '' : 'Ce navigateur ne prend pas en charge les clés d’accès (ou la page n’est pas en HTTPS).');
    pkNote.hidden = passkeyOk;
  }

  return {
    get isOpen() { return sheet.isOpen; },
    open() {
      setMsg('');
      oldIn.value = newIn.value = new2In.value = pkPw.value = '';
      revokeIn.checked = true;
      sheet.open();
    },
    close: () => sheet.close(),
    set(d) {
      data = d;
      const a = d?.account;
      setText(who, a ? `Connecté en tant que ${a.name}${a.role === 'admin' ? ' (administrateur)' : a.role === 'gm' ? ' (maître du jeu)' : ''}` : '');
      const n = a?.sessions || 0;
      setText(sessions, n ? `${n} appareil${n > 1 ? 's' : ''} mémorisé${n > 1 ? 's' : ''} (« Rester connecté »).` : 'Aucun appareil mémorisé.');
      const acc = pwForm.querySelector('.bv-acc-user');
      if (acc) acc.value = a?.name || '';
      renderPasskeys();
    },
    setPasskeySupported(ok) {
      passkeyOk = !!ok;
      renderPasskeys();
    },
    info(text) {
      setMsg(text, false);
      oldIn.value = newIn.value = new2In.value = '';
    },
    error(text) { setMsg(text, true); },
    /** The server wants the password before adding a passkey: show the field and focus it. */
    needPassword() {
      pkPwField.hidden = false;
      pkPw.value = '';
      setTimeout(() => pkPw.focus({ preventScroll: false }), 60);
    },
  };
}

// ================================================================== in-game main menu
/**
 * Escape (no window open) or the menu button: Reprendre, Carte, Options, Compte, Changer de personnage,
 * Se déconnecter, Quitter (launcher only).
 */
export function createGameMenu(layer, stack, H, { canQuit, openTree = null, openBook = null }) {
  const sheet = sheetShell(layer, stack, { id: 'bv-gm', title: 'Menu', cls: 'bv-gamemenu' });
  const item = (g, label, fn, cls = '') => h('button', { class: `bv-gm-item ${cls}`.trim(), type: 'button', onclick: () => fn() }, glyph(g), h('span', { text: label }));
  const run = (fn) => () => { sheet.close(); fn(); };
  const quit = item('logout', 'Quitter le jeu', run(() => H.quit()), 'danger');
  quit.hidden = !canQuit();
  const items = [
    item('play', 'Reprendre', () => sheet.close(), 'primary'),
    item('map', 'Carte', run(() => H.openMap())),
    openTree ? item('tree', 'Arbre des Brumes', run(() => openTree())) : null, // [skilltree]
    openBook ? item('book', 'Livre de compétences', run(() => openBook())) : null,
    item('gear', 'Options', run(() => H.openOptions())),
    item('person', 'Compte', run(() => H.openAccount())),
    item('back', 'Changer de personnage', run(() => H.charLogout())),
    item('logout', 'Se déconnecter', run(() => H.logout())),
    quit,
  ].filter(Boolean);
  sheet.body.append(h('nav', { class: 'bv-gm-list', 'aria-label': 'Menu principal' }, items));
  sheet.body.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const vis = items.filter((b) => !b.hidden);
    const i = vis.indexOf(document.activeElement);
    vis[(i + (e.key === 'ArrowDown' ? 1 : -1) + vis.length) % vis.length].focus();
  });
  return {
    get isOpen() { return sheet.isOpen; },
    open: () => { quit.hidden = !canQuit(); sheet.open(); },
    close: () => sheet.close(),
    toggle: () => (sheet.isOpen ? sheet.close() : sheet.open()),
  };
}
