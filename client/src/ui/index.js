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
// [accounts] character screens, account panel, in-game main menu, world map
import './account.css';
import { createCharSelect, createCharCreate } from './charscreens.js';
import { createSheetStack, createAccountSheet, createGameMenu } from './sheets.js';
import { createWorldMap } from './worldmap.js';
import { brumevalMap } from './mapdata.js';
import { lsGet, lsSet } from './dom.js';
import { glyph } from './icons.js';

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
  const mapLayer = h('div', { class: 'bv-maplayer' }); // [accounts] world map (above the HUD and windows)
  const sheetLayer = h('div', { class: 'bv-sheets' }); // [accounts] account panel, main menu (above everything)
  const backdrop = createBackdrop();
  // [accounts] Codex artwork over the procedural backdrop (login / characters, rotating loading screens)
  const bdArt = h('div', { class: 'bv-bd-art' });
  backdrop.insertBefore(bdArt, backdrop.querySelector('.bv-bd-fog'));
  screens.appendChild(backdrop);
  ui.append(hud, fxLayer, winLayer, mapLayer, screens, sheetLayer, overlay);

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
  const login = createLogin(screens, H);
  const loading = createLoading(screens);
  // [accounts]
  const charSelect = createCharSelect(screens, H, { overlay: sheetLayer });
  const charCreate = createCharCreate(screens, H, tooltip);
  const sheets = createSheetStack();
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
  // [accounts] world map and main menu buttons under the minimap (the bottom menu bar is full)
  const mapBtn = h('button', { class: 'bv-mm-tool', type: 'button', 'aria-label': 'Carte du monde (M)', onclick: () => H.openMap() }, glyph('map'), h('span', { text: 'Carte' }), h('kbd', { text: 'M' }));
  const menuBtn = h('button', { class: 'bv-mm-tool', type: 'button', 'aria-label': 'Menu principal (Échap)', onclick: () => gameMenu.toggle() }, glyph('menu'), h('span', { text: 'Menu' }), h('kbd', { text: 'Échap' }));
  minimapCol.querySelector('.bv-minimap')?.appendChild(h('div', { class: 'bv-mm-tools' }, mapBtn, menuBtn));
  const chat = createChat(hud, { handlers: H });
  const notify = (text, kind = 'info') => api.notify(text, kind);
  const actionbar = createActionBar(hud, { handlers: H, tooltip, isTyping, isActive: () => hudActive(), notify });
  const menu = createMenu(hud, (id) => {
    if (id === 'map') worldMap.toggle(); // [accounts]
    else if (id === 'menu') gameMenu.toggle();
    else wm.toggle(id);
  }, tooltip);
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
  createSettingsPanel(wm, { onToggle: onToggle('settings'), H, onHelp: () => wm.open('help') }); // [render-souls] + [accounts] audio, controls
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

  // ---------------------------------------------------------------- [accounts] account panel, main menu, map
  const accountSheet = createAccountSheet(sheetLayer, sheets, H, menus);
  const gameMenu = createGameMenu(sheetLayer, sheets, H, { canQuit: () => !!H.canQuit() });
  const markerKey = () => (self?.name ? `bv.marker.${self.name.toLowerCase()}` : null);
  const worldMap = createWorldMap(mapLayer, {
    onMarker: (m) => {
      minimap.setMarker(m);
      const k = markerKey();
      if (k) lsSet(k, m ? JSON.stringify(m) : '');
    },
    onClose: () => mapBtn.classList.remove('active'),
  });
  worldMap.setMap(brumevalMap());
  function loadMarker() {
    let m = null;
    try { m = JSON.parse(lsGet(markerKey() || '', '') || 'null'); } catch { m = null; }
    minimap.setMarker(m);
    worldMap.setMarker(m);
  }

  // ---------------------------------------------------------------- visibility
  const screenOpen = () => login.visible || loading.visible || charSelect.visible || charCreate.visible;
  function hudActive() {
    return !!self && !screenOpen();
  }
  let artTimer = 0;
  function syncVisibility() {
    const inGame = hudActive();
    const open = screenOpen();
    ui.classList.toggle('in-game', inGame);
    ui.classList.toggle('screen-open', open);
    backdrop.classList.toggle('show', open);
    // [accounts] artwork: bg_login on the login / character screens, bg_loading_1..3 rotated while loading
    const art = loading.visible ? 'loading' : open ? 'login' : null;
    if (art !== bdArt.dataset.art) {
      bdArt.dataset.art = art || '';
      clearInterval(artTimer);
      if (art === 'login') setArt('/ui/art/bg_login.webp');
      else if (art === 'loading') {
        let i = Math.floor(Math.random() * 3);
        const next = () => { setArt(`/ui/art/bg_loading_${(i++ % 3) + 1}.webp`); };
        next();
        artTimer = setInterval(next, 8000);
      }
    }
    if (!inGame) {
      tooltip.hide();
      worldMap.close();
      gameMenu.close();
    }
  }
  /** Fade to an artwork once it is loaded; a missing file simply keeps the procedural backdrop. */
  function setArt(url) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      bdArt.style.backgroundImage = `url("${url}")`;
      bdArt.classList.add('show');
    };
    img.onerror = () => bdArt.classList.remove('show');
    img.src = url;
  }

  // ---------------------------------------------------------------- keyboard
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented && e.key !== 'Escape') return;
    const consume = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    // [accounts] modal layers first: confirmation, account panel / main menu
    if (e.key === 'Escape' && (menus.modalOpen || sheets.open)) {
      if (!e.repeat) { if (!menus.closeTop()) sheets.closeTop(); }
      consume();
      return;
    }
    if (sheets.open) return; // the sheet's own controls handle the keys
    if (charCreate.visible && e.key === 'Escape') { consume(); H.showCharCreate(false); return; }
    if (screenOpen()) return; // the login / character screens handle their own keys
    if (isTyping()) return; // the chat input handles Enter / Escape itself
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Escape') {
      if (e.repeat) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      tooltip.hide();
      if (worldMap.isOpen) { worldMap.close(); consume(); return; }
      if (menus.closeTop() || wm.closeTop()) { consume(); return; }
      // nothing to close: the target is cleared by the game (main.js); otherwise open the main menu
      if (self && !H.hasTarget()) { gameMenu.open(); consume(); }
      return;
    }
    if (!self) return;
    // [accounts] M: world map
    if ((e.key === 'm' || e.key === 'M') && !e.repeat && !menus.modalOpen) {
      consume();
      worldMap.toggle();
      mapBtn.classList.toggle('active', worldMap.isOpen);
      return;
    }
    if (worldMap.isOpen) return;
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
        charSelect.show(false); // [accounts]
        charCreate.show(false);
        accountSheet.close();
        gameMenu.close();
        worldMap.close();
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
      const newChar = key !== selfKey;
      if (key !== selfKey) {
        selfKey = key;
        prevLevel = null;
      }
      if (newChar) { self = s; loadMarker(); } // [accounts] personal marker of this character
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
      worldMap.update({ ...d, self }); // [accounts]
    },
    // ---------------------------------------------------------------- [accounts] accounts & characters
    /** Character selection screen (data = account_ok). */
    showCharSelect(show, data = null, opts = {}) {
      if (data) { charSelect.set(data, opts); accountSheet.set(data); }
      if (show) {
        login.show(false);
        charCreate.show(false);
        gameMenu.close();
        worldMap.close();
        chat.close();
        dialog.close();
        wm.closeAll();
        death.show(false);
        targetFrame.set(null);
        self = null;
        selfKey = null;
      }
      charSelect.show(!!show);
      syncVisibility();
    },
    setAccount(data, opts = {}) {
      if (!data) return;
      charSelect.set(data, opts);
      accountSheet.set(data);
    },
    showCharCreate(show) {
      charCreate.show(!!show);
      if (show) charSelect.show(false);
      else if (!self) charSelect.show(true);
      syncVisibility();
    },
    setCharSelectError: (m) => charSelect.setError(m || null),
    setCharSelectInfo: (m) => charSelect.setInfo(m || null),
    setCharSelectBusy: (b) => charSelect.setBusy(!!b),
    setCharCreateError: (m) => charCreate.setError(m || null),
    setCharCreateBusy: (b) => charCreate.setBusy(!!b),
    showPasskeyOffer: (show) => charSelect.showPasskeyOffer(!!show),
    setPasskeySupported(ok) {
      login.setPasskeySupported(ok);
      accountSheet.setPasskeySupported(ok);
    },
    openAccount() { accountSheet.open(); },
    openOptions() { wm.open('settings'); },
    accountInfo(text) { accountSheet.info(text); },
    accountError(text) { accountSheet.error(text); },
    accountNeedPassword() { accountSheet.needPassword(); },
    get accountOpen() { return accountSheet.isOpen; },
    openGameMenu() { if (hudActive()) gameMenu.open(); },
    openMap() { if (hudActive()) { worldMap.open(); mapBtn.classList.add('active'); } },
    get charSelectVisible() { return charSelect.visible; },
    get charCreateVisible() { return charCreate.visible; },
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
  Object.defineProperty(api, '_dev', { value: { wm, chat, menus, tooltip, charSelect, charCreate, accountSheet, gameMenu, worldMap }, enumerable: false });
  return api;
}
