// [accounts] Character selection and character creation screens (docs/COMPTES.md).
// Selection: list (name, class, level, zone, last played), 3D preview of the selected character (its real GLB on a
// pedestal, drawn by render/charPreview.js through H.previewAttach / H.previewChar; class art as fallback), Jouer,
// Créer un personnage (≤ 5), Supprimer (confirmation by typing the name), Compte, Se déconnecter.
// Creation: name + class cards (portrait, description, key stats, weapon, abilities), back button.
import { CLASSES, ITEMS, MAX_LEVEL } from '@shared/data.js';
import { MAX_CHARS } from '@shared/protocol.js';
import { h, fmt1, setText, lsGet, lsSet } from './dom.js';
import { iconBox, classIconSpec, abilityIconSpec, glyph } from './icons.js';
import { abilityTooltip } from './tooltip.js';
import { gameLogo } from './login.js';
import { store } from '../account/session.js';

const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9_]{3,16}$/;
export const CLASS_ORDER = ['warrior', 'mage', 'ranger'];
const ROLE = { warrior: 'Mêlée · Robuste', mage: 'Distance · Magie', ranger: 'Distance · Précision' };
const MAXS = {
  hp: Math.max(...CLASS_ORDER.map((c) => CLASSES[c].hp)),
  mp: Math.max(...CLASS_ORDER.map((c) => CLASSES[c].mp)),
  atk: Math.max(...CLASS_ORDER.map((c) => CLASSES[c].atk)),
  def: Math.max(...CLASS_ORDER.map((c) => CLASSES[c].def)),
};

/** "à l'instant", "il y a 5 min", "il y a 3 h", "hier", "il y a 4 j", "12 mars 2026". */
export function lastPlayedText(ts, now = Date.now()) {
  if (!ts) return 'Jamais joué';
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 90) return 'Joué à l’instant';
  if (s < 3600) return `Joué il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `Joué il y a ${Math.round(s / 3600)} h`;
  if (s < 2 * 86400) return 'Joué hier';
  if (s < 30 * 86400) return `Joué il y a ${Math.round(s / 86400)} j`;
  return `Joué le ${new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/** Modal asking to type the character's name before deleting it. */
function deleteDialog(layer, ch, onConfirm) {
  const input = h('input', { class: 'bv-input', type: 'text', spellcheck: 'false', autocomplete: 'off', maxLength: 16, placeholder: ch.name, 'aria-label': 'Nom du personnage' });
  const ok = h('button', { class: 'bv-btn danger', type: 'button', disabled: true }, glyph('trash'), h('span', { text: 'Supprimer définitivement' }));
  const cancel = h('button', { class: 'bv-btn secondary', type: 'button', text: 'Annuler' });
  const veil = h('div', { class: 'bv-sheet-veil show', role: 'presentation' },
    h('div', { class: 'bv-sheet bv-frame bv-del', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'bv-del-t' },
      h('h3', { class: 'bv-modal-title', id: 'bv-del-t', text: `Supprimer ${ch.name} ?` }),
      h('p', { class: 'bv-modal-text', text: `${CLASSES[ch.cls]?.name || ''} niveau ${ch.level}. Cette action est définitive : son équipement, son or et ses quêtes seront perdus.` }),
      h('label', { class: 'bv-field' }, h('span', { class: 'bv-field-l', text: `Tapez « ${ch.name} » pour confirmer` }), input),
      h('div', { class: 'bv-modal-actions' }, cancel, ok)));
  const close = () => { veil.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);
  const match = () => input.value.trim().toLowerCase() === ch.name.toLowerCase();
  input.addEventListener('input', () => { ok.disabled = !match(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && match()) { e.preventDefault(); ok.click(); }
  });
  ok.addEventListener('click', () => {
    if (!match()) return;
    close();
    onConfirm(input.value.trim());
  });
  cancel.addEventListener('click', close);
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  layer.appendChild(veil);
  setTimeout(() => input.focus({ preventScroll: true }), 30);
  return close;
}

// ================================================================== selection
export function createCharSelect(parent, H, { overlay }) {
  let data = { account: null, chars: [] };
  let selected = null;
  let busy = false;
  let previewAttached = false;

  const accName = h('span', { class: 'bv-cs-accname' });
  const accountBtn = h('button', { class: 'bv-btn small secondary', type: 'button', onclick: () => H.openAccount() }, glyph('person'), h('span', { text: 'Compte' }));
  const logoutBtn = h('button', { class: 'bv-btn small secondary', type: 'button', onclick: () => H.logout() }, glyph('logout'), h('span', { text: 'Se déconnecter' }));
  const list = h('div', { class: 'bv-cs-list', role: 'listbox', 'aria-label': 'Vos personnages' });
  const count = h('div', { class: 'bv-cs-count' });
  const errEl = h('div', { class: 'bv-login-error', role: 'alert', 'aria-live': 'assertive' });

  // preview stage
  const stage = h('div', { class: 'bv-cs-stage' });
  const fallbackArt = h('div', { class: 'bv-cs-art' });
  const pvName = h('div', { class: 'bv-cs-pvname' });
  const pvInfo = h('div', { class: 'bv-cs-pvinfo' });
  const pvZone = h('div', { class: 'bv-cs-pvzone' });
  const playBtn = h('button', { class: 'bv-btn gold big bv-cs-play', type: 'button' }, h('span', { class: 'bv-spinner' }), glyph('play'), h('span', { text: 'Jouer' }));
  const delBtn = h('button', { class: 'bv-btn small secondary bv-cs-del', type: 'button' }, glyph('trash'), h('span', { text: 'Supprimer' }));
  const createBtn = h('button', { class: 'bv-btn secondary bv-cs-create', type: 'button', onclick: () => H.showCharCreate(true) }, glyph('plus'), h('span', { text: 'Créer un personnage' }));

  // passkey offer
  const offerAdd = h('button', { class: 'bv-btn small gold', type: 'button', onclick: () => H.passkeyAdd() }, glyph('key'), h('span', { text: 'Ajouter une clé d’accès (passkey)' }));
  const offerLater = h('button', { class: 'bv-btn small secondary', type: 'button', text: 'Plus tard', onclick: () => showOffer(false, true) });
  const offer = h('div', { class: 'bv-cs-offer bv-frame', role: 'status', hidden: true },
    glyph('key', 'bv-cs-offer-i'),
    h('div', { class: 'bv-cs-offer-t' },
      h('b', { text: 'Connectez-vous sans mot de passe' }),
      h('span', { text: 'Une clé d’accès utilise l’empreinte, le visage ou le code de votre appareil. Plus rapide et plus sûre.' })),
    h('div', { class: 'bv-cs-offer-a' }, offerAdd, offerLater));

  const el = h('div', { class: 'bv-screen bv-charselect bv-hidden' },
    h('header', { class: 'bv-cs-top' },
      gameLogo(true),
      h('div', { class: 'bv-cs-acc' }, glyph('person'), accName, accountBtn, logoutBtn)),
    offer,
    h('div', { class: 'bv-cs-body' },
      h('section', { class: 'bv-cs-side bv-frame' },
        h('h2', { class: 'bv-cs-title', text: 'Vos personnages' }),
        count,
        list,
        createBtn),
      h('section', { class: 'bv-cs-main' },
        stage,
        fallbackArt,
        h('div', { class: 'bv-cs-plate' }, pvName, pvInfo, pvZone),
        errEl,
        h('div', { class: 'bv-cs-actions' }, delBtn, playBtn))));
  parent.appendChild(el);

  playBtn.addEventListener('click', () => play());
  delBtn.addEventListener('click', () => {
    const ch = current();
    if (!ch || busy) return;
    deleteDialog(overlay, ch, (confirm) => H.charDelete(ch.id, confirm));
  });

  function current() { return data.chars.find((c) => c.id === selected) || null; }

  function play() {
    const ch = current();
    if (!ch || busy) return;
    setError(null);
    H.charSelect(ch.id);
  }

  function select(id, focus = false) {
    selected = id;
    const ch = current();
    for (const b of list.querySelectorAll('.bv-cs-char')) {
      const on = b.dataset.id === id;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus({ preventScroll: true });
    }
    playBtn.disabled = !ch || busy;
    delBtn.disabled = !ch || busy;
    if (ch) {
      const c = CLASSES[ch.cls];
      setText(pvName, ch.name);
      setText(pvInfo, `${c?.name || ''} · niveau ${ch.level}${ch.level >= MAX_LEVEL ? ' (max)' : ''}`);
      setText(pvZone, `${ch.zone || 'Terres sauvages'} · ${lastPlayedText(ch.lastPlayed)}`);
      el.style.setProperty('--cc', c?.color || '#c9a24d');
      fallbackArt.replaceChildren(iconBox(classIconSpec(ch.cls, 'class'), 'bv-cs-artimg'));
      store.lastChar = ch.id;
    } else {
      setText(pvName, data.chars.length ? '' : 'Aucun personnage');
      setText(pvInfo, data.chars.length ? '' : 'Créez votre premier héros pour entrer dans Brumeval.');
      setText(pvZone, '');
      fallbackArt.replaceChildren();
    }
    if (!previewAttached && H.previewAttach(stage)) previewAttached = true;
    el.classList.toggle('has-preview', previewAttached);
    H.previewChar(ch);
  }

  function render() {
    list.replaceChildren();
    const { chars, account } = data;
    setText(accName, account?.name || '');
    setText(count, `${chars.length} / ${account?.maxChars || MAX_CHARS}`);
    for (const ch of chars) {
      const c = CLASSES[ch.cls];
      const b = h('button', {
        class: `bv-cs-char cls-${ch.cls}`, type: 'button', role: 'option', 'aria-selected': 'false', tabIndex: -1,
        dataset: { id: ch.id }, style: { '--cc': c?.color || '#c9a24d' },
        onclick: () => select(ch.id),
        ondblclick: () => { select(ch.id); play(); },
      },
        iconBox(classIconSpec(ch.cls, 'portrait'), 'bv-cs-portrait'),
        h('span', { class: 'bv-cs-cinfo' },
          h('span', { class: 'bv-cs-cname', text: ch.name }),
          h('span', { class: 'bv-cs-cline', text: `${c?.name || ch.cls} · niv. ${ch.level}` }),
          h('span', { class: 'bv-cs-czone', text: ch.zone || '' }),
          h('span', { class: 'bv-cs-cwhen', text: lastPlayedText(ch.lastPlayed) })));
      list.appendChild(b);
    }
    for (let i = chars.length; i < (account?.maxChars || MAX_CHARS); i++) {
      list.appendChild(h('button', { class: 'bv-cs-empty', type: 'button', tabIndex: -1, onclick: () => H.showCharCreate(true) },
        glyph('plus'), h('span', { text: 'Emplacement libre' })));
    }
    createBtn.disabled = chars.length >= (account?.maxChars || MAX_CHARS) || busy;
    createBtn.title = createBtn.disabled && !busy ? `Maximum ${MAX_CHARS} personnages par compte` : '';
  }

  // arrow keys in the list, Enter plays
  list.addEventListener('keydown', (e) => {
    const ids = data.chars.map((c) => c.id);
    const i = ids.indexOf(selected);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = ids.length;
      if (!n) return;
      select(ids[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n], true);
    } else if (e.key === 'Enter') {
      if (e.target.closest('.bv-cs-char')) { e.preventDefault(); play(); }
    } else if (e.key === 'Delete') {
      e.preventDefault();
      delBtn.click();
    }
  });

  function setError(msg, info = false) {
    errEl.textContent = msg || '';
    errEl.classList.toggle('is-info', !!info);
    if (msg && !info) {
      errEl.classList.remove('shake');
      void errEl.offsetWidth;
      errEl.classList.add('shake');
    }
  }

  function showOffer(show, dismissed = false) {
    offer.hidden = !show;
    if (dismissed) store.passkeyOfferDismissed = true;
  }

  return {
    el,
    get visible() { return !el.classList.contains('bv-hidden'); },
    /** data = account_ok { account, chars }; preselect = character id to select (else last played). */
    set(d, { preselect = null } = {}) {
      data = { account: d.account || null, chars: Array.isArray(d.chars) ? d.chars : [] };
      render();
      const ids = data.chars.map((c) => c.id);
      const want = [preselect, selected, store.lastChar, data.account?.lastChar].find((id) => id && ids.includes(id)) || ids[0] || null;
      select(want);
    },
    show(show) {
      const was = !el.classList.contains('bv-hidden');
      el.classList.toggle('bv-hidden', !show);
      if (show && !was) {
        setError(null);
        // "Jouer" gets the focus: Enter plays the pre-selected character right away
        setTimeout(() => { if (!el.classList.contains('bv-hidden') && !playBtn.disabled) playBtn.focus({ preventScroll: true }); }, 60);
      }
      if (!show && el.contains(document.activeElement)) document.activeElement.blur();
      if (!show) H.previewChar(null);
      else select(selected);
    },
    setError,
    setInfo: (msg) => setError(msg, true),
    setBusy(b) {
      busy = !!b;
      el.classList.toggle('is-busy', busy);
      playBtn.disabled = busy || !current();
      delBtn.disabled = busy || !current();
      createBtn.disabled = busy || data.chars.length >= (data.account?.maxChars || MAX_CHARS);
    },
    showPasskeyOffer: (show) => showOffer(show),
    focusPlay() { if (!playBtn.disabled) playBtn.focus({ preventScroll: true }); },
  };
}

// ================================================================== creation
export function createCharCreate(parent, H, tooltip) {
  let cls = CLASS_ORDER.includes(lsGet('bv.cls')) ? lsGet('bv.cls') : 'warrior';
  let busy = false;

  const nameIn = h('input', {
    class: 'bv-input', type: 'text', id: 'bv-cc-name', autocomplete: 'off', spellcheck: 'false',
    maxLength: 16, placeholder: 'Nom du héros',
  });
  const errEl = h('div', { class: 'bv-login-error', role: 'alert', 'aria-live': 'assertive' });
  const createBtn = h('button', { class: 'bv-btn gold big', type: 'submit' }, h('span', { class: 'bv-spinner' }), h('span', { text: 'Créer le personnage' }));
  const backBtn = h('button', { class: 'bv-btn secondary', type: 'button', onclick: () => H.showCharCreate(false) }, glyph('back'), h('span', { text: 'Retour' }));

  const cards = {};
  const cardRow = h('div', { class: 'bv-class-row', role: 'radiogroup', 'aria-label': 'Classe' });
  for (const id of CLASS_ORDER) {
    const c = CLASSES[id];
    const stat = (label, v, max, cssCls) =>
      h('div', { class: 'bv-cstat' },
        h('span', { class: 'bv-cstat-l', text: label }),
        h('span', { class: `bv-cstat-bar ${cssCls}` }, h('i', { style: { width: `${Math.round((v / max) * 100)}%` } })),
        h('span', { class: 'bv-cstat-v', text: String(v) }));
    const abilities = h('div', { class: 'bv-cabil' });
    c.abilities.forEach((ab, i) => {
      const ic = h('span', { class: 'bv-cabil-i' }, iconBox(abilityIconSpec(ab, id)));
      tooltip.bind(ic, () => abilityTooltip(ab, { key: String(i + 1) }));
      abilities.appendChild(ic);
    });
    const weapon = ITEMS[c.start.weapon]?.name || '';
    const card = h('button', {
      class: `bv-class-card cls-${id}`, type: 'button', role: 'radio', 'aria-checked': 'false',
      style: { '--cc': c.color },
      onclick: () => selectClass(id),
    },
      h('div', { class: 'bv-class-art' }, h('div', { class: 'bv-class-glow' }), iconBox(classIconSpec(id, 'class'), 'bv-class-img')),
      h('div', { class: 'bv-class-name', text: c.name }),
      h('div', { class: 'bv-class-role', text: ROLE[id] }),
      h('p', { class: 'bv-class-desc', text: c.desc }),
      h('div', { class: 'bv-cstats' },
        stat('PV', c.hp, MAXS.hp, 'hp'),
        stat('Mana', c.mp, MAXS.mp, 'mp'),
        stat('Attaque', c.atk, MAXS.atk, 'atk'),
        stat('Défense', c.def, MAXS.def, 'def')),
      h('div', { class: 'bv-class-extra', text: `Arme : ${weapon} · Critique ${Math.round(c.crit * 100)} % · Vitesse ${fmt1(c.speed)}` }),
      abilities);
    cards[id] = card;
    cardRow.appendChild(card);
  }
  cardRow.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = CLASS_ORDER.indexOf(cls);
    const next = CLASS_ORDER[(i + (e.key === 'ArrowRight' ? 1 : -1) + CLASS_ORDER.length) % CLASS_ORDER.length];
    selectClass(next);
    cards[next].focus({ preventScroll: true });
  });

  const form = h('form', { class: 'bv-cc-form bv-frame', novalidate: true },
    h('div', { class: 'bv-cc-head' },
      backBtn,
      h('h2', { class: 'bv-cs-title', text: 'Nouveau personnage' })),
    h('label', { class: 'bv-field bv-cc-namefield', for: 'bv-cc-name' }, h('span', { class: 'bv-field-l', text: 'Nom du personnage' }), nameIn),
    h('div', { class: 'bv-login-label', text: 'Choisissez votre classe' }),
    cardRow,
    errEl,
    h('div', { class: 'bv-login-actions' }, createBtn));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });

  const el = h('div', { class: 'bv-screen bv-charcreate bv-hidden' }, h('div', { class: 'bv-cc-center' }, form));
  parent.appendChild(el);

  function selectClass(id) {
    cls = id;
    for (const k of CLASS_ORDER) {
      cards[k].classList.toggle('selected', k === id);
      cards[k].setAttribute('aria-checked', String(k === id));
      cards[k].tabIndex = k === id ? 0 : -1;
    }
  }
  function setError(msg) {
    errEl.textContent = msg || '';
    if (msg) {
      errEl.classList.remove('shake');
      void errEl.offsetWidth;
      errEl.classList.add('shake');
    }
  }
  function submit() {
    if (busy) return;
    const name = nameIn.value.trim();
    if (!NAME_RE.test(name)) {
      setError('Le nom doit comporter 3 à 16 caractères (lettres, chiffres ou _).');
      nameIn.focus();
      return;
    }
    setError(null);
    lsSet('bv.cls', cls);
    H.charCreate(name, cls);
  }
  selectClass(cls);

  return {
    el,
    get visible() { return !el.classList.contains('bv-hidden'); },
    show(show) {
      const was = !el.classList.contains('bv-hidden');
      el.classList.toggle('bv-hidden', !show);
      if (show && !was) {
        nameIn.value = '';
        setError(null);
        setTimeout(() => { if (!el.classList.contains('bv-hidden')) nameIn.focus({ preventScroll: true }); }, 60);
      } else if (!show && el.contains(document.activeElement)) document.activeElement.blur();
    },
    setError,
    setBusy(b) {
      busy = !!b;
      el.classList.toggle('is-busy', busy);
      for (const x of [nameIn, createBtn, backBtn, ...Object.values(cards)]) x.disabled = busy;
    },
  };
}
