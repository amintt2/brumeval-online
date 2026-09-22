// Login / character creation screen.
import { CLASSES, GAME_TITLE } from '@shared/data.js';
import { h, fmt1, lsGet, lsSet } from './dom.js';
import { iconBox, classIconSpec, abilityIconSpec, glyph } from './icons.js';
import { abilityTooltip } from './tooltip.js';

const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9_]{3,16}$/;
const CLASS_ORDER = ['warrior', 'mage', 'ranger'];
const ROLE = { warrior: 'Mêlée · Robuste', mage: 'Distance · Magie', ranger: 'Distance · Précision' };
const MAXS = {
  hp: Math.max(...CLASS_ORDER.map((c) => CLASSES[c].hp)),
  mp: Math.max(...CLASS_ORDER.map((c) => CLASSES[c].mp)),
  atk: Math.max(...CLASS_ORDER.map((c) => CLASSES[c].atk)),
  def: Math.max(...CLASS_ORDER.map((c) => CLASSES[c].def)),
};

export function createLogin(parent, handlers, tooltip) {
  let mode = lsGet('bv.name') ? 'login' : 'create';
  let cls = CLASS_ORDER.includes(lsGet('bv.cls')) ? lsGet('bv.cls') : 'warrior';
  let busy = false;

  const nameIn = h('input', {
    class: 'bv-input', type: 'text', id: 'bv-login-name', autocomplete: 'username', spellcheck: 'false',
    maxLength: 16, placeholder: 'Nom du héros', value: lsGet('bv.name', ''),
  });
  const passIn = h('input', {
    class: 'bv-input', type: 'password', id: 'bv-login-pass', autocomplete: 'current-password',
    maxLength: 64, placeholder: 'Mot de passe',
  });
  const errEl = h('div', { class: 'bv-login-error', role: 'alert', 'aria-live': 'assertive' });
  const submitLabel = h('span', { text: '' });
  const submitBtn = h('button', { class: 'bv-btn gold bv-login-submit', type: 'submit' }, h('span', { class: 'bv-spinner' }), submitLabel);

  // tabs
  const tabLogin = h('button', { class: 'bv-tab', type: 'button', role: 'tab', text: 'Connexion', onclick: () => setMode('login') });
  const tabCreate = h('button', { class: 'bv-tab', type: 'button', role: 'tab', text: 'Nouveau personnage', onclick: () => setMode('create') });

  // class cards
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
      h('div', { class: 'bv-class-extra', text: `Critique ${Math.round(c.crit * 100)} % · Vitesse ${fmt1(c.speed)}` }),
      abilities);
    cards[id] = card;
    cardRow.appendChild(card);
  }
  const classSection = h('div', { class: 'bv-login-classes' }, h('div', { class: 'bv-login-label', text: 'Choisissez votre classe' }), cardRow);

  const form = h('form', { class: 'bv-login-form', novalidate: true, autocomplete: 'on' },
    h('div', { class: 'bv-login-fields' },
      h('label', { class: 'bv-field' }, h('span', { class: 'bv-field-l', text: 'Nom' }), nameIn),
      h('label', { class: 'bv-field' }, h('span', { class: 'bv-field-l', text: 'Mot de passe' }), passIn)),
    classSection,
    errEl,
    h('div', { class: 'bv-login-actions' }, submitBtn));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  // Explicit Enter handling (does not rely on implicit form submission).
  nameIn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (!passIn.value && NAME_RE.test(nameIn.value.trim())) passIn.focus();
    else submit();
  });
  passIn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    submit();
  });

  const card = h('div', { class: 'bv-login-card bv-frame' },
    h('div', { class: 'bv-tabs', role: 'tablist' }, tabLogin, tabCreate),
    form);

  const title = GAME_TITLE.split(' ');
  const logo = h('div', { class: 'bv-logo' },
    h('div', { class: 'bv-logo-main', text: title[0] }),
    h('div', { class: 'bv-logo-sub' }, h('span', { class: 'bv-logo-line' }), h('span', { text: title.slice(1).join(' ') || 'Online' }), h('span', { class: 'bv-logo-line r' })),
    h('div', { class: 'bv-logo-tag', text: 'Les brumes se lèvent sur la vallée…' }));

  const el = h('div', { class: 'bv-screen bv-login bv-hidden' },
    h('div', { class: 'bv-login-center' },
      logo,
      card,
      h('div', { class: 'bv-login-foot' }, glyph('shield'), h('span', { text: 'Un monde entièrement façonné dans Blender' }))));
  parent.appendChild(el);

  function setMode(m) {
    mode = m;
    el.classList.toggle('mode-create', m === 'create');
    el.classList.toggle('mode-login', m === 'login');
    tabLogin.classList.toggle('active', m === 'login');
    tabCreate.classList.toggle('active', m === 'create');
    tabLogin.setAttribute('aria-selected', String(m === 'login'));
    tabCreate.setAttribute('aria-selected', String(m === 'create'));
    passIn.autocomplete = m === 'create' ? 'new-password' : 'current-password';
    classSection.hidden = m !== 'create';
    updateSubmitLabel();
    setError(null);
  }
  function selectClass(id) {
    cls = id;
    for (const k of CLASS_ORDER) {
      cards[k].classList.toggle('selected', k === id);
      cards[k].setAttribute('aria-checked', String(k === id));
    }
  }
  function updateSubmitLabel() {
    if (busy) submitLabel.textContent = mode === 'create' ? 'Création…' : 'Connexion…';
    else submitLabel.textContent = mode === 'create' ? 'Créer le personnage' : 'Entrer dans Brumeval';
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
      setError('Le nom doit comporter 3 à 16 caractères (lettres, chiffres ou _).');
      nameIn.focus();
      return;
    }
    if (pass.length < 4 || pass.length > 64) {
      setError('Le mot de passe doit comporter entre 4 et 64 caractères.');
      passIn.focus();
      return;
    }
    setError(null);
    lsSet('bv.name', name);
    if (mode === 'create') {
      lsSet('bv.cls', cls);
      handlers.register?.(name, pass, cls);
    } else handlers.login?.(name, pass);
  }

  setMode(mode);
  selectClass(cls);

  return {
    el,
    get visible() { return !el.classList.contains('bv-hidden'); },
    show(show) {
      el.classList.toggle('bv-hidden', !show);
      if (show) {
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
      for (const x of [nameIn, passIn, submitBtn, tabLogin, tabCreate, ...Object.values(cards)]) x.disabled = busy;
      updateSubmitLabel();
    },
  };
}
