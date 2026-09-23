// Brumeval Online — DOM/CSS user interface. Public API: SPEC §5.2.
// createUI(root, handlers) builds everything inside `root` and returns the methods called by client-core.
import './ui.css';
import { h } from './dom.js';
import { createTooltip } from './tooltip.js';
import { createMenus } from './menus.js';
import { createBackdrop } from './backdrop.js';
import { createLogin } from './login.js';
import { createLoading } from './loading.js';
import { createPlayerFrame, createTargetFrame, createXpBar, createMenu } from './hud.js';
import { createActionBar } from './actionbar.js';
import { createChat } from './chat.js';
import { createToasts } from './toasts.js';
import { createMinimap } from './minimap.js';
import { createTracker } from './tracker.js';
import { createDeath } from './death.js';
import { createDialog } from './dialog.js';
import { createWindowManager } from './panels/window.js';
import { createInventoryPanel } from './panels/inventory.js';
import { createCharacterPanel } from './panels/character.js';
import { createQuestPanel } from './panels/quests.js';
import { createHelpPanel } from './panels/help.js';
import { createStaminaBar, createBossBar, createCombatOverlay } from './combat-hud.js'; // [combat-souls]
import { createSettingsPanel } from './panels/settings.js'; // [render-souls] graphics settings (key O)

const NOTIFY_KINDS = new Set(['info', 'error', 'xp', 'loot', 'quest', 'level', 'gold']);
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;0,800;1,400&family=Cinzel+Decorative:wght@700;900&family=Cinzel:wght@500;600;700;800&display=swap';

/** ui.css @imports the fonts; a <link> as well guarantees them even if bundling reorders CSS. */
function ensureFonts() {
  if (typeof document === 'undefined' || document.querySelector('link[data-bv-fonts]')) return;
  const pre = document.createElement('link');
  pre.rel = 'preconnect';
  pre.href = 'https://fonts.gstatic.com';
  pre.crossOrigin = '';
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = FONTS_URL;
  css.dataset.bvFonts = '1';
  document.head.append(pre, css);
}
const PANEL_KEYS = { i: 'inventory', c: 'character', l: 'quests', h: 'help' };
PANEL_KEYS.o = 'settings'; // [render-souls]

export function createUI(root, handlers = {}) {
  ensureFonts();
  // Handlers may be partial: missing ones become no-ops (looked up at call time).
  const H = new Proxy({}, {
    get: (_, k) => (typeof handlers[k] === 'function' ? (...a) => handlers[k](...a) : () => {}),
  });

  const ui = h('div', { class: 'bv-ui', lang: 'fr' });
  root.appendChild(ui);

  const hud = h('div', { class: 'bv-hud' });
  const winLayer = h('div', { class: 'bv-windows' });
  const fxLayer = h('div', { class: 'bv-fx' });
  const screens = h('div', { class: 'bv-screens' });
  const overlay = h('div', { class: 'bv-overlay' });
  const backdrop = createBackdrop();
  screens.appendChild(backdrop);
  ui.append(hud, fxLayer, winLayer, screens, overlay);

  const tooltip = createTooltip(overlay);
  const menus = createMenus(overlay);
  const wm = createWindowManager(winLayer);

  let self = null;
  let selfKey = null;
  let prevLevel = null;

  const isTyping = () => {
    const a = document.activeElement;
    return !!a && ui.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  };

  // ---------------------------------------------------------------- screens
  const login = createLogin(screens, H, tooltip);
  const loading = createLoading(screens);
  const death = createDeath(fxLayer, H);
  const toasts = createToasts(fxLayer);

  // ---------------------------------------------------------------- HUD
  const unitframes = h('div', { class: 'bv-unitframes' });
  hud.appendChild(unitframes);
  const playerFrame = createPlayerFrame(unitframes, tooltip);
  const targetFrame = createTargetFrame(unitframes);
  // [combat-souls] stamina bar, boss bar, low-hp vignette / damage direction
  const stamina = createStaminaBar(unitframes.querySelector('.bv-uf-player .bv-uf-main'));
  const bossBar = createBossBar(hud);
  const combatOverlay = createCombatOverlay(fxLayer);
  const minimapCol = h('div', { class: 'bv-rightcol' });
  hud.appendChild(minimapCol);
  const minimap = createMinimap(minimapCol, tooltip);
  const chat = createChat(hud, { handlers: H });
  const notify = (text, kind = 'info') => api.notify(text, kind);
  const actionbar = createActionBar(hud, { handlers: H, tooltip, isTyping, isActive: () => hudActive(), notify });
  const menu = createMenu(hud, (id) => wm.toggle(id), tooltip);
  const xpbar = createXpBar(hud, tooltip);

  // ---------------------------------------------------------------- windows
  const onToggle = (id) => (open) => {
    menu.setActive(id, open);
    tooltip.hide();
  };
  const inventory = createInventoryPanel(wm, {
    handlers: H, tooltip, menus, notify, isShopOpen: () => dialog.shopOpen, onToggle: onToggle('inventory'),
  });
  const character = createCharacterPanel(wm, { handlers: H, tooltip, menus, onToggle: onToggle('character') });
  const quests = createQuestPanel(wm, { tooltip, onToggle: onToggle('quests') });
  createHelpPanel(wm, { onToggle: onToggle('help') });
  createSettingsPanel(wm, { onToggle: onToggle('settings') }); // [render-souls]
  let invAutoOpened = false;
  const dialog = createDialog(wm, {
    handlers: H,
    tooltip,
    onOpen: () => inventory.refresh(),
    onClose: () => {
      tooltip.hide();
      menus.closeMenu();
      if (invAutoOpened && wm.isOpen('inventory')) wm.close('inventory');
      invAutoOpened = false;
      inventory.refresh();
    },
  });
  const tracker = createTracker(minimapCol, {
    onOpenQuest: (qid) => {
      quests.select(qid);
      wm.open('quests');
    },
  });

  // ---------------------------------------------------------------- visibility
  function hudActive() {
    return !!self && !login.visible && !loading.visible;
  }
  function syncVisibility() {
    const inGame = hudActive();
    ui.classList.toggle('in-game', inGame);
    ui.classList.toggle('screen-open', login.visible || loading.visible);
    backdrop.classList.toggle('show', login.visible || loading.visible);
    if (!inGame) tooltip.hide();
  }

  // ---------------------------------------------------------------- keyboard
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented && e.key !== 'Escape') return;
    if (login.visible || loading.visible) return; // the login form handles its own keys
    if (isTyping()) return; // the chat input handles Enter / Escape itself
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const consume = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (e.key === 'Escape') {
      if (e.repeat) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      tooltip.hide();
      if (menus.closeTop() || wm.closeTop()) consume();
      return;
    }
    if (!self) return;
    if (e.key === 'Enter' || e.key === 'NumpadEnter') {
      if (menus.modalOpen) return;
      consume();
      chat.open();
      return;
    }
    if (e.repeat || menus.modalOpen) return;
    const id = PANEL_KEYS[(e.key || '').toLowerCase()];
    if (id) {
      e.preventDefault();
      wm.toggle(id);
    }
  }, true);

  ui.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('input, textarea')) e.preventDefault();
  });
  // Mouse clicks must not leave focus on a UI button: Space/Enter would otherwise re-trigger it
  // while the player is playing. Keyboard activations (detail === 0) keep focus for accessibility.
  ui.addEventListener('click', (e) => {
    const b = e.target.closest?.('button');
    if (b && e.detail > 0 && document.activeElement === b) b.blur();
  });

  // ---------------------------------------------------------------- public API (SPEC §5.2)
  const api = {
    setLoading(progress, text) {
      loading.set(progress, text);
      syncVisibility();
    },
    showLogin(show) {
      login.show(!!show);
      if (show) {
        login.setBusy(false);
        chat.close();
        menus.closeTop();
        menus.closeTop();
        dialog.close();
        wm.closeAll();
        death.show(false);
        targetFrame.set(null);
      }
      syncVisibility();
    },
    setLoginError(msg) {
      login.setError(msg || null);
    },
    setLoginBusy(busy) {
      login.setBusy(!!busy);
    },
    setSelf(s) {
      if (!s || typeof s !== 'object') return;
      const key = `${s.id}|${s.name}`;
      if (key !== selfKey) {
        selfKey = key;
        prevLevel = null;
      }
      if (prevLevel != null && s.level > prevLevel) toasts.showLevel(s.level);
      prevLevel = s.level;
      self = s;
      playerFrame.update(s);
      combatOverlay.setHp(s.hp, s.mhp, s.dead); // [combat-souls]
      targetFrame.setSelfLevel(s.level);
      xpbar.update(s);
      actionbar.update(s);
      menu.setGold(s.gold || 0);
      tracker.update(s);
      inventory.update(s);
      character.update(s);
      quests.update(s);
      dialog.update(s);
      tooltip.refresh();
      syncVisibility();
    },
    setTarget(t) {
      targetFrame.set(t && typeof t === 'object' ? t : null);
    },
    setCooldown(slot, ms) {
      actionbar.setCooldown(Number(slot), Number(ms));
    },
    addChat(m) {
      chat.addChat(m);
    },
    notify(text, kind = 'info') {
      if (text == null || text === '') return;
      const k = NOTIFY_KINDS.has(kind) ? kind : 'info';
      if (k === 'level') toasts.showLevel(null, String(text));
      else toasts.toast(String(text), k);
      chat.addNotify(String(text), k);
    },
    showDialog(d) {
      if (!d) {
        dialog.close();
        return;
      }
      dialog.show(d);
      if (Array.isArray(d.shop) && d.shop.length && !wm.isOpen('inventory')) {
        invAutoOpened = true;
        wm.open('inventory');
      }
      inventory.refresh();
    },
    showDeath(show) {
      death.show(!!show);
      ui.classList.toggle('is-dead', !!show);
      if (show) menus.closeTop();
    },
    showZone(name) {
      toasts.showZone(name);
    },
    updateMinimap(d) {
      minimap.update(d);
    },
    // [combat-souls]
    setStamina(st, mst) { stamina.set(Math.round(st * 2) / 2, mst); },
    staminaEmpty() { stamina.flashEmpty(); },
    setBoss(d) { bossBar.set(d && typeof d === 'object' ? d : null); },
    damageTaken(angle, heavy) { combatOverlay.hit(angle, !!heavy); },
    setStatus(s) {
      minimap.setStatus(s);
    },
    isTyping,
  };

  // Start building the static minimap in the background (chunked, never blocks a frame).
  setTimeout(() => minimap.ensureMap(), 300);
  syncVisibility();

  // Non-API helpers for the sandbox page / debugging.
  Object.defineProperty(api, '_dev', { value: { wm, chat, menus, tooltip }, enumerable: false });
  return api;
}
