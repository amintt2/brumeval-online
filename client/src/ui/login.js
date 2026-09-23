// [accounts] Login screen: Connexion / Créer un compte, « Rester connecté », « Se connecter avec une passkey »,
// clear errors, and (in a normal browser) the « Télécharger le launcher » card. Characters are chosen afterwards
// on the character selection screen (charscreens.js). docs/COMPTES.md
import { GAME_TITLE } from '@shared/data.js';
import { h } from './dom.js';
import { glyph } from './icons.js';
import { store, inLauncher } from '../account/session.js';
import { launcherDownloads, detectOs, RELEASES_URL } from '../account/launcherDownload.js';
import { onPwaAvailable, installPwa } from '../account/pwaInstall.js';

const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9_]{3,16}$/;

/** Game logo: the Codex artwork when present, the CSS title otherwise. */
export function gameLogo(small = false, tag = null) {
  const title = GAME_TITLE.split(' ');
  const text = h('div', { class: 'bv-logo-text' },
    h('div', { class: 'bv-logo-main', text: title[0] }),
    h('div', { class: 'bv-logo-sub' }, h('span', { class: 'bv-logo-line' }), h('span', { text: title.slice(1).join(' ') || 'Online' }), h('span', { class: 'bv-logo-line r' })));
  const img = h('img', { class: 'bv-logo-img', src: '/ui/art/logo_512.png', alt: GAME_TITLE, draggable: 'false', decoding: 'async' });
  const el = h('div', { class: `bv-logo${small ? ' small' : ''}` }, img, text, tag ? h('div', { class: 'bv-logo-tag', text: tag }) : null);
  img.addEventListener('load', () => el.classList.add('has-img'));
  img.addEventListener('error', () => img.remove());
  return el;
}

/** « Télécharger le launcher » card (browser only, dismissible, remembered). */
function createLauncherCard(onPlayInBrowser) {
  const os = detectOs();
  const dl = launcherDownloads(os);
  const primary = dl.files[0];
  const close = h('button', { class: 'bv-lc-close', type: 'button', title: 'Ne plus afficher', 'aria-label': 'Ne plus afficher' }, glyph('close'));
  const pwaBtn = h('button', { class: 'bv-btn small secondary bv-lc-pwa', type: 'button', hidden: true },
    glyph('download'), h('span', { text: 'Installer l’application web' }));
  const links = h('div', { class: 'bv-lc-links' });
  if (primary) {
    links.append(h('a', { class: 'bv-btn gold bv-lc-dl', href: primary.url, rel: 'noopener', download: '' },
      glyph('download'), h('span', { text: `Télécharger pour ${dl.label}` })));
    for (const f of dl.files.slice(1)) links.append(h('a', { class: 'bv-lc-alt', href: f.url, rel: 'noopener', download: '', text: f.label }));
  }
  links.append(h('a', { class: 'bv-lc-alt', href: `${RELEASES_URL}/latest`, target: '_blank', rel: 'noopener', text: primary ? 'Autres systèmes et versions' : 'Voir les téléchargements' }));
  const play = h('button', { class: 'bv-btn secondary bv-lc-play', type: 'button' }, glyph('play'), h('span', { text: 'Jouer dans le navigateur' }));
  const el = h('aside', { class: 'bv-launcher-card bv-frame', 'aria-label': 'Launcher Brumeval' },
    close,
    h('div', { class: 'bv-lc-banner' }),
    h('h2', { class: 'bv-lc-title', text: 'Télécharger le launcher' }),
    h('p', { class: 'bv-lc-lead', text: primary ? `Recommandé sur ${dl.label}.` : 'Disponible pour Windows, macOS et Linux.' }),
    h('ul', { class: 'bv-lc-benefits' },
      h('li', null, h('b', { text: 'Performances' }), h('span', { text: ' : moteur graphique dédié, sans onglets ni extensions.' })),
      h('li', null, h('b', { text: 'Mises à jour automatiques' }), h('span', { text: ' : toujours la dernière version du jeu.' })),
      h('li', null, h('b', { text: 'Plein écran' }), h('span', { text: ' : une fenêtre de jeu immersive (F11).' }))),
    links,
    pwaBtn,
    h('div', { class: 'bv-lc-or' }, h('span', { text: 'ou' })),
    play,
    h('p', { class: 'bv-lc-note', text: 'Votre compte et vos personnages sont les mêmes partout.' }));
  const hide = () => {
    el.classList.add('bv-hidden-card');
    store.launcherCardDismissed = true;
  };
  close.addEventListener('click', hide);
  play.addEventListener('click', () => {
    hide();
    onPlayInBrowser();
  });
  onPwaAvailable((ok) => { pwaBtn.hidden = !ok; });
  pwaBtn.addEventListener('click', () => { installPwa(); });
  if (store.launcherCardDismissed) el.classList.add('bv-hidden-card');
  return el;
}

export function createLogin(parent, H) {
  let mode = store.login ? 'login' : 'create';
  let busy = false;
  let passkeyOk = false;
  const launcher = inLauncher();

  const nameIn = h('input', {
    class: 'bv-input', type: 'text', id: 'bv-login-name', autocomplete: 'username webauthn', spellcheck: 'false',
    maxLength: 16, placeholder: 'Nom de compte', value: store.login,
  });
  const passIn = h('input', {
    class: 'bv-input', type: 'password', id: 'bv-login-pass', autocomplete: 'current-password',
    maxLength: 64, placeholder: 'Mot de passe',
  });
  const pass2In = h('input', {
    class: 'bv-input', type: 'password', id: 'bv-login-pass2', autocomplete: 'new-password',
    maxLength: 64, placeholder: 'Confirmez le mot de passe',
  });
  const pass2Field = h('label', { class: 'bv-field', for: 'bv-login-pass2' }, h('span', { class: 'bv-field-l', text: 'Confirmation' }), pass2In);
  const remember = h('input', { type: 'checkbox', id: 'bv-login-remember', class: 'bv-check' });
  remember.checked = store.remember;
  remember.addEventListener('change', () => { store.remember = remember.checked; });
  const rememberRow = h('label', { class: 'bv-remember', for: 'bv-login-remember' }, remember,
    h('span', { class: 'bv-remember-box', 'aria-hidden': 'true' }),
    h('span', { text: 'Rester connecté' }),
    h('small', { text: launcher ? 'sur ce launcher' : 'sur cet appareil' }));
  const errEl = h('div', { class: 'bv-login-error', role: 'alert', 'aria-live': 'assertive' });
  const submitLabel = h('span', { text: '' });
  const submitBtn = h('button', { class: 'bv-btn gold bv-login-submit', type: 'submit' }, h('span', { class: 'bv-spinner' }), submitLabel);
  const passkeyBtn = h('button', { class: 'bv-btn secondary bv-login-passkey', type: 'button', hidden: true },
    glyph('key'), h('span', { text: 'Se connecter avec une passkey' }));
  passkeyBtn.addEventListener('click', () => {
    if (busy) return;
    setError(null);
    H.passkeyLogin(remember.checked);
  });
  const orRow = h('div', { class: 'bv-login-or', hidden: true }, h('span', { text: 'ou' }));
  const createNote = h('p', { class: 'bv-login-note', text: 'Un compte, jusqu’à 5 personnages : vous les créerez juste après.' });

  const tabLogin = h('button', { class: 'bv-tab', type: 'button', role: 'tab', id: 'bv-tab-login', text: 'Connexion', onclick: () => setMode('login') });
  const tabCreate = h('button', { class: 'bv-tab', type: 'button', role: 'tab', id: 'bv-tab-create', text: 'Créer un compte', onclick: () => setMode('create') });

  const form = h('form', { class: 'bv-login-form', novalidate: true, autocomplete: 'on' },
    h('div', { class: 'bv-login-fields' },
      h('label', { class: 'bv-field', for: 'bv-login-name' }, h('span', { class: 'bv-field-l', text: 'Nom de compte' }), nameIn),
      h('label', { class: 'bv-field', for: 'bv-login-pass' }, h('span', { class: 'bv-field-l', text: 'Mot de passe' }), passIn),
      pass2Field),
    rememberRow,
    errEl,
    h('div', { class: 'bv-login-actions' }, submitBtn),
    createNote,
    orRow,
    h('div', { class: 'bv-login-actions' }, passkeyBtn));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  nameIn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (!passIn.value && NAME_RE.test(nameIn.value.trim())) passIn.focus();
    else submit();
  });

  const card = h('div', { class: 'bv-login-card bv-frame' },
    h('div', { class: 'bv-tabs', role: 'tablist' }, tabLogin, tabCreate),
    form);

  const launcherCard = launcher ? null : createLauncherCard(() => (nameIn.value ? passIn : nameIn).focus({ preventScroll: true }));
  const el = h('div', { class: 'bv-screen bv-login bv-hidden' },
    h('div', { class: 'bv-login-layout' },
      h('div', { class: 'bv-login-center' },
        gameLogo(false, 'Les brumes se lèvent sur la vallée…'),
        card,
        h('div', { class: 'bv-login-foot' }, glyph('shield'), h('span', { text: 'Un monde entièrement façonné dans Blender' }))),
      launcherCard));
  parent.appendChild(el);

  function setMode(m) {
    mode = m;
    el.classList.toggle('mode-create', m === 'create');
    el.classList.toggle('mode-login', m === 'login');
    for (const [t, on] of [[tabLogin, m === 'login'], [tabCreate, m === 'create']]) {
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    }
    passIn.autocomplete = m === 'create' ? 'new-password' : 'current-password';
    pass2Field.hidden = m !== 'create';
    createNote.hidden = m !== 'create';
    syncPasskey();
    updateSubmitLabel();
    setError(null);
  }
  function syncPasskey() {
    const show = passkeyOk && mode === 'login';
    passkeyBtn.hidden = !show;
    orRow.hidden = !show;
  }
  function updateSubmitLabel() {
    if (busy) submitLabel.textContent = mode === 'create' ? 'Création…' : 'Connexion…';
    else submitLabel.textContent = mode === 'create' ? 'Créer le compte' : 'Se connecter';
  }
  function setError(msg) {
    errEl.textContent = msg || '';
    errEl.classList.remove('shake');
    if (msg) {
      void errEl.offsetWidth; // restart animation
      errEl.classList.add('shake');
    }
  }
  function submit() {
    if (busy) return;
    const name = nameIn.value.trim();
    const pass = passIn.value;
    if (!NAME_RE.test(name)) {
      setError('Le nom de compte doit comporter 3 à 16 caractères (lettres, chiffres ou _).');
      nameIn.focus();
      return;
    }
    // new accounts need 6+ characters; accounts created with 4-5 before v0.2 still log in
    const passMin = mode === 'create' ? 6 : 4;
    if (pass.length < passMin || pass.length > 64) {
      setError(`Le mot de passe doit comporter entre ${passMin} et 64 caractères.`);
      passIn.focus();
      return;
    }
    if (mode === 'create' && pass2In.value !== pass) {
      setError('Les deux mots de passe ne correspondent pas.');
      pass2In.focus();
      return;
    }
    setError(null);
    store.login = name;
    store.remember = remember.checked;
    if (mode === 'create') H.register(name, pass, remember.checked);
    else H.login(name, pass, remember.checked);
  }

  setMode(mode);

  return {
    el,
    get visible() { return !el.classList.contains('bv-hidden'); },
    show(show) {
      el.classList.toggle('bv-hidden', !show);
      if (show) {
        if (store.login) {
          nameIn.value = store.login;
          if (mode !== 'login') setMode('login');
        }
        passIn.value = '';
        pass2In.value = '';
        remember.checked = store.remember;
        setTimeout(() => {
          if (el.classList.contains('bv-hidden')) return;
          (nameIn.value ? passIn : nameIn).focus({ preventScroll: true });
        }, 60);
      } else if (el.contains(document.activeElement)) document.activeElement.blur();
    },
    setError,
    setBusy(b) {
      busy = !!b;
      el.classList.toggle('is-busy', busy);
      for (const x of [nameIn, passIn, pass2In, remember, submitBtn, passkeyBtn, tabLogin, tabCreate]) x.disabled = busy;
      updateSubmitLabel();
    },
    setPasskeySupported(ok) {
      passkeyOk = !!ok;
      syncPasskey();
    },
    setMode,
  };
}
