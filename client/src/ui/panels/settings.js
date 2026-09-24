// [render-souls] Graphics settings panel (touche O): presets Bas / Moyen / Élevé / Ultra, individual options,
// live performance read-out. Settings are stored in localStorage by render/quality.js and applied at once by the
// renderer (render/graphics.js subscribes to the changes). This module never imports Three.js.
import './settings.css';
import { h, setText } from '../dom.js';
import { createWindow } from './window.js';
import { createControlsSection } from './controls.js'; // [skilltree] rebindable controls
import {
  PRESET_IDS, PRESET_LABELS, FPS_CAPS, getSettings, applyPreset, updateSettings, onSettingsChange, graphicsHooks,
} from '../../render/quality.js';

const SHADOW_LABELS = ['Désactivées', 'Basses', 'Moyennes', 'Hautes'];
const PRESET_HINTS = {
  bas: 'Pour les petites configurations et les ordinateurs portables.',
  moyen: 'Équilibré : lumière dorée, brouillard et herbe au vent.',
  eleve: 'Ombres fines, occlusion ambiante, herbe dense.',
  ultra: 'Tout au maximum, pour les cartes graphiques puissantes.',
};
const PIXEL_RATIOS = [[0.75, '75 %'], [1, '100 %'], [1.5, '150 %'], [2, '200 %']];
const fmtInt = (n) => Math.round(n).toLocaleString('fr-FR');
const pct = (v) => `${Math.round(v * 100)} %`;

let uid = 0;

/**
 * A focused form control makes the game think the player is typing (movement keys are ignored): give the focus
 * back to the game after a mouse change. Keyboard users keep the focus (Tab navigation).
 */
let lastPointer = 0;
if (typeof window !== 'undefined') window.addEventListener('pointerdown', () => { lastPointer = performance.now(); }, true);
function releaseFocus(el) {
  if (performance.now() - lastPointer < 4000 && document.activeElement === el) el.blur();
}

/** Toggle switch row. */
function toggleRow(label, hint, onChange) {
  const id = `bv-set-${++uid}`;
  const input = h('input', { type: 'checkbox', id, class: 'bv-set-switch', role: 'switch', onchange: () => { onChange(input.checked); releaseFocus(input); } });
  const row = h('div', { class: 'bv-set-row' },
    h('label', { class: 'bv-set-label', for: id }, h('span', { text: label }), hint ? h('small', { text: hint }) : null),
    input);
  return {
    row,
    set(v, disabled = false) {
      input.checked = !!v;
      input.disabled = !!disabled;
      row.classList.toggle('is-disabled', !!disabled);
    },
  };
}

/** Select row ([value, label] options). */
function selectRow(label, hint, options, onChange) {
  const id = `bv-set-${++uid}`;
  const select = h('select', { id, class: 'bv-set-select', onchange: () => { onChange(select.value); releaseFocus(select); } },
    options.map(([v, l]) => h('option', { value: String(v), text: l })));
  const row = h('div', { class: 'bv-set-row' },
    h('label', { class: 'bv-set-label', for: id }, h('span', { text: label }), hint ? h('small', { text: hint }) : null),
    select);
  return {
    row,
    set(v, disabled = false) {
      select.value = String(v);
      select.disabled = !!disabled;
      row.classList.toggle('is-disabled', !!disabled);
    },
  };
}

/** Range row with a value read-out; onChange fires on release, onInput while dragging (label only). */
function rangeRow(label, hint, { min, max, step }, format, onChange) {
  const id = `bv-set-${++uid}`;
  const out = h('output', { class: 'bv-set-out', for: id });
  const input = h('input', {
    type: 'range', id, class: 'bv-set-range', min, max, step,
    oninput: () => setText(out, format(+input.value)),
    onchange: () => { onChange(+input.value); releaseFocus(input); },
  });
  const row = h('div', { class: 'bv-set-row bv-set-row-range' },
    h('label', { class: 'bv-set-label', for: id }, h('span', { text: label }), hint ? h('small', { text: hint }) : null),
    h('div', { class: 'bv-set-rangewrap' }, input, out));
  return {
    row,
    set(v) {
      input.value = String(v);
      setText(out, format(v));
    },
  };
}

export function createSettingsPanel(wm, { onToggle, H = null, onHelp = null, menus = null, notify = null } = {}) {
  let statsTimer = 0;
  const win = wm.add(createWindow({
    id: 'settings', title: 'Options', subtitle: 'Graphismes, son et commandes', keyHint: 'O',
    onShow: () => {
      refresh(getSettings());
      refreshAudio(); // [accounts]
      startStats();
      onToggle?.(true);
    },
    onHide: () => {
      controls.cancel(); // [skilltree]
      clearInterval(statsTimer);
      statsTimer = 0;
      onToggle?.(false);
    },
  }));

  // ---------------------------------------------------------------- presets
  const presetBtns = {};
  const presetBar = h('div', { class: 'bv-set-presets', role: 'radiogroup', 'aria-label': 'Préréglage' },
    PRESET_IDS.map((id) => {
      const b = h('button', {
        type: 'button', class: 'bv-set-preset', role: 'radio', 'aria-checked': 'false',
        title: PRESET_HINTS[id],
        onclick: () => applyPreset(id),
      }, h('span', { class: 'bv-set-preset-n', text: PRESET_LABELS[id] }));
      presetBtns[id] = b;
      return b;
    }));
  const presetNote = h('div', { class: 'bv-set-note' });

  // ---------------------------------------------------------------- options
  const post = toggleRow('Post-traitement', 'Lumière HDR, halo lumineux, étalonnage des couleurs, anticrénelage', (v) => updateSettings({ post: v }));
  const shadows = selectRow('Ombres', 'Ombres en cascade du soleil et de la lune',
    SHADOW_LABELS.map((l, i) => [i, l]), (v) => updateSettings({ shadows: +v }));
  const ao = toggleRow('Occlusion ambiante', 'Assombrit les recoins et le pied des objets', (v) => updateSettings({ ao: v }));
  const fog = toggleRow('Brouillard volumétrique', 'Brume au sol et rayons de lumière', (v) => updateSettings({ fog: v }));
  const grass = rangeRow('Herbe (densité)', 'Herbe au vent autour du personnage', { min: 0, max: 1, step: 0.05 },
    (v) => (v <= 0.01 ? 'Aucune' : pct(v)), (v) => updateSettings({ grass: v }));
  const distance = rangeRow('Distance d\'affichage', 'Détails, ombres et objets au loin', { min: 0.6, max: 1.4, step: 0.05 },
    pct, (v) => updateSettings({ distance: v }));
  const pixel = selectRow('Définition', 'Densité de pixels maximale (écrans haute résolution)', PIXEL_RATIOS,
    (v) => updateSettings({ pixelRatio: +v }));
  const dynres = toggleRow('Résolution dynamique', 'Baisse la définition quand la fluidité chute', (v) => updateSettings({ dynres: v }));
  const fps = selectRow('Limite d\'images par seconde', 'Économise la batterie et réduit la chauffe',
    FPS_CAPS.map((c) => [c, c ? `${c} i/s` : 'Illimitée (synchro écran)']), (v) => updateSettings({ fpsCap: +v }));

  const restartNote = h('div', { class: 'bv-set-note bv-set-warn', hidden: true,
    text: 'L\'anticrénelage du mode sans post-traitement s\'applique au prochain lancement du jeu.' });

  // ---------------------------------------------------------------- live stats
  const statFps = h('b', { text: '—' });
  const statCalls = h('b', { text: '—' });
  const statTris = h('b', { text: '—' });
  const statScale = h('b', { text: '—' });
  const stats = h('div', { class: 'bv-set-stats', 'aria-live': 'off' },
    h('span', null, statFps, ' i/s'),
    h('span', null, statCalls, ' appels'),
    h('span', null, statTris, ' triangles'),
    h('span', null, 'définition ', statScale));

  const detectBtn = h('button', {
    type: 'button', class: 'bv-btn small secondary', text: 'Détection automatique',
    title: 'Mesure les performances de votre machine et choisit le préréglage',
    onclick: async () => {
      const fn = graphicsHooks().autodetect;
      if (!fn || detectBtn.disabled) return;
      detectBtn.disabled = true;
      setText(detectBtn, 'Mesure en cours…');
      try {
        await fn();
      } catch {
        /* the current settings stay */
      }
      detectBtn.disabled = false;
      setText(detectBtn, 'Détection automatique');
    },
  });

  // ---------------------------------------------------------------- [accounts] audio & controls
  const volume = rangeRow('Volume', 'Effets sonores du jeu', { min: 0, max: 1, step: 0.05 },
    (v) => (v <= 0.001 ? 'Muet' : pct(v)), (v) => H?.setVolume(v));
  const mute = toggleRow('Couper le son', null, (v) => H?.setMuted(v));
  const helpBtn = h('button', { type: 'button', class: 'bv-btn small secondary', text: 'Aide complète', onclick: () => onHelp?.() });
  const controls = createControlsSection({ menus, notify }); // [skilltree]
  function refreshAudio() {
    const a = H?.getAudio?.() || { volume: 1, muted: false };
    volume.set(a.volume);
    mute.set(a.muted);
  }

  win.body.append(
    h('div', { class: 'bv-sec-title', text: 'Son' }),
    volume.row, mute.row,
    h('div', { class: 'bv-sec-title', text: 'Commandes' }),
    h('div', { class: 'bv-set-row' },
      h('span', { class: 'bv-set-label' }, h('span', { text: 'Clavier et souris' }), h('small', { text: 'Toutes les touches se changent ci-dessous' })),
      helpBtn),
    controls.el,
    h('div', { class: 'bv-sec-title', text: 'Graphismes : préréglage' }),
    presetBar,
    presetNote,
    h('div', { class: 'bv-sec-title', text: 'Lumière et ambiance' }),
    post.row, shadows.row, ao.row, fog.row,
    h('div', { class: 'bv-sec-title', text: 'Monde' }),
    grass.row, distance.row,
    h('div', { class: 'bv-sec-title', text: 'Performances' }),
    pixel.row, dynres.row, fps.row,
    restartNote,
  );
  win.footer.append(stats, detectBtn);

  function refresh(s) {
    for (const id of PRESET_IDS) {
      const on = s.preset === id;
      presetBtns[id].classList.toggle('active', on);
      presetBtns[id].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    const custom = s.preset === 'custom';
    setText(presetNote, custom
      ? 'Réglages personnalisés.'
      : `${PRESET_HINTS[s.preset] || ''}${s.auto ? ' (choisi automatiquement pour votre machine)' : ''}`);
    post.set(s.post);
    shadows.set(s.shadows);
    ao.set(s.ao, !s.post);
    fog.set(s.fog, !s.post);
    grass.set(s.grass);
    distance.set(s.distance);
    pixel.set(PIXEL_RATIOS.reduce((best, [v]) => (Math.abs(v - s.pixelRatio) < Math.abs(best - s.pixelRatio) ? v : best), 1));
    dynres.set(s.dynres);
    fps.set(s.fpsCap);
    const msaa = graphicsHooks().msaa?.();
    restartNote.hidden = !(msaa === false && !s.post);
    detectBtn.hidden = !graphicsHooks().autodetect;
  }

  function startStats() {
    clearInterval(statsTimer);
    const tick = () => {
      const st = graphicsHooks().stats?.();
      if (!st) {
        stats.hidden = true;
        return;
      }
      stats.hidden = false;
      setText(statFps, fmtInt(st.fps || 0));
      setText(statCalls, fmtInt(st.calls || 0));
      setText(statTris, st.triangles >= 1e6 ? `${(st.triangles / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : fmtInt(st.triangles || 0));
      setText(statScale, pct(st.scale ?? 1));
    };
    tick();
    statsTimer = setInterval(tick, 500);
  }

  onSettingsChange((s) => {
    if (win.isOpen) refresh(s);
  });
  refresh(getSettings());
  return { win, refresh: () => refresh(getSettings()), controls };
}
