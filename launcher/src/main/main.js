// Brumeval Launcher — Electron main process.
//  - launcher window: news, server status, options, launcher self-update (UI served from the brumeval:// scheme)
//  - game window: the web game loaded from the configured server (always the latest deploy)
// Security: contextIsolation + sandbox everywhere, no Node in any page, a minimal preload bridge for the launcher
// UI and a tiny one for the game page (isLauncher / info / quit, src/preload/game.js), navigation locked to the
// configured server origin, links opened in the system browser, strict CSP.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain, protocol, screen, session, shell } = require('electron');

const SMOKE = process.env.LAUNCHER_SMOKE === '1';
// The smoke test never touches the player's real settings, cache or saved window positions.
if (SMOKE) {
  const tmp = os.tmpdir();
  for (const d of fs.readdirSync(tmp)) {
    if (!d.startsWith('brumeval-launcher-smoke-')) continue;
    try { // profiles of earlier runs (Chromium keeps them locked until the process is gone)
      const p = path.join(tmp, d);
      if (Date.now() - fs.statSync(p).mtimeMs > 3600e3) fs.rmSync(p, { recursive: true, force: true });
    } catch { /* still in use */ }
  }
  app.setPath('userData', fs.mkdtempSync(path.join(tmp, 'brumeval-launcher-smoke-')));
}

const { createLog } = require('./log');
const { SettingsStore } = require('./store');
const { WINDOW_DEFAULTS, applyPatch, isVisibleOn, defaultSettings } = require('./lib/settings');
const { isSameOrigin, isSafeExternalUrl, originOf } = require('./lib/urls');
const { fetchNews, fetchStatus } = require('./remote');
const { LauncherUpdater, RELEASES_URL } = require('./updater');

const SCHEME = 'brumeval';
const LAUNCHER_ORIGIN = `${SCHEME}://launcher`;
const LAUNCHER_URL = `${LAUNCHER_ORIGIN}/index.html`;
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'launcher.js');
const GAME_PRELOAD = path.join(__dirname, '..', 'preload', 'game.js'); // window.brumevalLauncher (isLauncher, info, quit)
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const GAME_PARTITION = 'persist:brumeval-game';
const IS_MAC = process.platform === 'darwin';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);

const log = createLog(app.getPath('userData'));
const store = new SettingsStore(app.getPath('userData'), log);

let launcherWin = null;
let gameWin = null;
let updater = null;
let quitting = false;
const smokeExternal = []; // links the smoke test "opened" (never handed to the real browser)

// ------------------------------------------------------------------------------------------------ helpers

function userAgent() {
  return `BrumevalLauncher/${app.getVersion()} (${process.platform}; Electron ${process.versions.electron})`;
}

function openExternal(url) {
  if (!isSafeExternalUrl(url)) {
    log.warn('lien externe refusé :', String(url).slice(0, 200));
    return false;
  }
  if (SMOKE) smokeExternal.push(url);
  else shell.openExternal(url).catch((err) => log.warn('ouverture du navigateur impossible :', err.message));
  return true;
}

function sendToLauncher(channel, payload) {
  if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.send(channel, payload);
}

/** Locks a webContents: only `isAllowed(url)` navigations, every other web link goes to the system browser. */
function harden(contents, isAllowed) {
  const guard = (event, url) => {
    if (isAllowed(url)) return;
    event.preventDefault();
    openExternal(url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
}

/** Saved bounds if they still fit on a connected display, otherwise a centred default size. */
function restoreBounds(kind) {
  const def = WINDOW_DEFAULTS[kind];
  const saved = store.get().windows[kind];
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  const primary = screen.getPrimaryDisplay().workArea;
  const width = Math.min(saved?.width ?? def.width, primary.width);
  const height = Math.min(saved?.height ?? def.height, primary.height);
  const out = { width, height, maximized: !!saved?.maximized };
  if (saved && isVisibleOn(saved, areas)) {
    out.x = saved.x;
    out.y = saved.y;
    out.width = saved.width;
    out.height = saved.height;
  }
  return out;
}

/** Remembers size / position / maximized state of a window (not while minimized or fullscreen). */
function trackBounds(win, kind) {
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const maximized = win.isMaximized();
    const b = maximized ? win.getNormalBounds() : win.getBounds();
    const s = store.get();
    store.set({ ...s, windows: { ...s.windows, [kind]: { ...b, maximized } } });
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on('resize', later);
  win.on('move', later);
  win.on('maximize', later);
  win.on('unmaximize', later);
  win.on('close', save);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function errorPage(base, title, detail) {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Brumeval Online</title><style>
html,body{margin:0;height:100%;background:#0b0d12;color:#eee4ce;font:17px/1.5 Georgia,serif}
body{display:flex;align-items:center;justify-content:center}
main{max-width:560px;margin:24px;padding:32px 36px;border:1px solid rgba(201,162,77,.55);border-radius:10px;
background:linear-gradient(180deg,#241e18,#0d0b0a);box-shadow:0 20px 60px rgba(0,0,0,.6);text-align:center}
h1{margin:0 0 8px;color:#f2d58c;font-size:26px;letter-spacing:.06em}p{margin:8px 0;color:#b9ab90}
code{color:#877c68;font-size:13px}a{display:inline-block;margin-top:18px;padding:10px 28px;border-radius:6px;
background:linear-gradient(180deg,#f2d58c,#c9a24d 55%,#6e5020);color:#1a1208;font-weight:bold;text-decoration:none;
letter-spacing:.08em}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>
<p><code>${escapeHtml(base)}</code></p><a href="${escapeHtml(base)}/">RÉESSAYER</a></main></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

// ------------------------------------------------------------------------------------------------ launcher UI

function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Requête invalide', { status: 400 });
    }
    if (url.host !== 'launcher') return new Response('Introuvable', { status: 404 });
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Requête invalide', { status: 400 });
    }
    const file = path.normalize(path.join(RENDERER_DIR, rel));
    if (!file.startsWith(RENDERER_DIR + path.sep)) return new Response('Accès interdit', { status: 403 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, {
        headers: {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Content-Security-Policy': CSP,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return new Response('Introuvable', { status: 404 });
    }
  });
}

function createLauncherWindow() {
  const b = restoreBounds('launcher');
  const def = WINDOW_DEFAULTS.launcher;
  launcherWin = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: def.minWidth,
    minHeight: def.minHeight,
    show: false,
    title: 'Brumeval Launcher',
    backgroundColor: '#0b0d12',
    icon: IS_MAC ? undefined : ICON,
    titleBarStyle: 'hidden',
    ...(IS_MAC
      ? { trafficLightPosition: { x: 16, y: 14 } }
      : { titleBarOverlay: { color: '#0d0f15', symbolColor: '#e6c46f', height: 40 } }),
    webPreferences: {
      preload: PRELOAD,
      // Screenshots of the smoke test need a window that keeps painting while hidden.
      offscreen: SMOKE && !!process.env.LAUNCHER_SMOKE_SHOTS,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  harden(launcherWin.webContents, (url) => url.startsWith(LAUNCHER_ORIGIN + '/'));
  trackBounds(launcherWin, 'launcher');
  launcherWin.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      launcherWin.setFullScreen(!launcherWin.isFullScreen());
    } else if (input.key === 'I' && input.control && input.shift && !app.isPackaged) {
      launcherWin.webContents.toggleDevTools();
    }
  });
  launcherWin.once('ready-to-show', () => {
    if (SMOKE) return;
    if (b.maximized) launcherWin.maximize();
    launcherWin.show();
  });
  launcherWin.on('closed', () => {
    launcherWin = null;
    if (!gameWin && !quitting) app.quit();
  });
  launcherWin.loadURL(LAUNCHER_URL);
}

function showLauncher() {
  if (!launcherWin) createLauncherWindow();
  else {
    if (launcherWin.isMinimized()) launcherWin.restore();
    if (!SMOKE) launcherWin.show();
    launcherWin.focus();
  }
}

// ------------------------------------------------------------------------------------------------ game window

let gameSessionReady = false;
function gameSession() {
  const ses = session.fromPartition(GAME_PARTITION);
  if (gameSessionReady) return ses;
  gameSessionReady = true;
  const ALLOWED = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'keyboardLock']);
  const fromServer = (url) => isSameOrigin(url || '', store.get().serverUrl);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(ALLOWED.has(permission) && fromServer(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => ALLOWED.has(permission) && fromServer(requestingOrigin));
  ses.setUserAgent(`${ses.getUserAgent()} ${userAgent().split(' ')[0]}`);
  return ses;
}

function setPlaying(playing) {
  sendToLauncher('launcher:playing', playing);
}

function openGame() {
  if (gameWin && !gameWin.isDestroyed()) {
    if (gameWin.isMinimized()) gameWin.restore();
    gameWin.show();
    gameWin.focus();
    return { ok: true, already: true };
  }
  const settings = store.get();
  const base = settings.serverUrl;
  const b = restoreBounds('game');
  const def = WINDOW_DEFAULTS.game;
  gameSession();
  gameWin = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: def.minWidth,
    minHeight: def.minHeight,
    show: false,
    title: 'Brumeval Online',
    backgroundColor: '#0b0d12',
    icon: IS_MAC ? undefined : ICON,
    autoHideMenuBar: true,
    fullscreen: settings.fullscreen && !SMOKE,
    webPreferences: {
      partition: GAME_PARTITION,
      preload: GAME_PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  if (!IS_MAC) gameWin.removeMenu();
  const win = gameWin;
  const wc = win.webContents;
  harden(wc, (url) => isSameOrigin(url, base));
  trackBounds(win, 'game');

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    } else if (input.key === 'F5' && !input.alt) {
      event.preventDefault();
      if (isSameOrigin(wc.getURL(), base)) wc.reload();
      else wc.loadURL(base + '/');
    } else if (input.key === 'I' && input.control && input.shift && !app.isPackaged) {
      wc.toggleDevTools();
    }
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ERR_ABORTED: replaced by another navigation */) return;
    log.warn(`chargement du jeu impossible (${code} ${desc}) : ${url}`);
    wc.loadURL(errorPage(base, 'Serveur injoignable', `Impossible de charger le jeu (${desc}). Vérifiez votre connexion ou l'adresse du serveur dans les options du launcher.`));
  });
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    log.error('le jeu s\'est arrêté :', details.reason);
    if (!win.isDestroyed()) wc.loadURL(errorPage(base, 'Le jeu s\'est arrêté', `Le processus du jeu s'est arrêté (${details.reason}).`));
  });
  win.once('ready-to-show', () => {
    if (!SMOKE) {
      if (b.maximized && !settings.fullscreen) win.maximize();
      win.show();
    }
    if (store.get().closeOnPlay && launcherWin && !SMOKE) launcherWin.close();
  });
  win.on('closed', () => {
    if (gameWin === win) gameWin = null;
    setPlaying(false);
    if (!launcherWin && !quitting) app.quit();
  });

  wc.loadURL(base + '/');
  setPlaying(true);
  log.info('jeu lancé sur', base);
  return { ok: true };
}

async function clearGameCache() {
  const ses = gameSession();
  let before = 0;
  try {
    before = await ses.getCacheSize();
  } catch { /* unknown size */ }
  // HTTP cache, service workers + their caches (3D models…), compiled shaders and code caches.
  // Local storage (remembered name, graphics options) is kept on purpose.
  await ses.clearCache();
  await ses.clearStorageData({ storages: ['cachestorage', 'serviceworkers', 'shadercache'] });
  await ses.clearCodeCaches({});
  log.info(`cache du jeu vidé (${before} octets)`);
  return { ok: true, freedBytes: before, playing: !!gameWin };
}

// ------------------------------------------------------------------------------------------------ IPC

function fromLauncher(event) {
  const url = event.senderFrame?.url || '';
  return url.startsWith(LAUNCHER_ORIGIN + '/');
}

function publicSettings() {
  const s = store.get();
  return { serverUrl: s.serverUrl, fullscreen: s.fullscreen, closeOnPlay: s.closeOnPlay };
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!fromLauncher(event)) throw new Error('origine refusée');
    return fn(...args);
  });
}

/** IPC from the game window (its own preload): only from the game page at the configured server origin. */
function fromGame(event) {
  return !!gameWin && !gameWin.isDestroyed() && event.sender === gameWin.webContents
    && isSameOrigin(event.senderFrame?.url || '', store.get().serverUrl);
}

function registerGameIpc() {
  ipcMain.handle('game:info', (event) => {
    if (!fromGame(event)) throw new Error('origine refusée');
    return { version: app.getVersion(), platform: process.platform };
  });
  ipcMain.handle('game:quit', (event) => {
    if (!fromGame(event)) throw new Error('origine refusée');
    setImmediate(() => { if (gameWin && !gameWin.isDestroyed()) gameWin.close(); });
    return true;
  });
}

function registerIpc() {
  registerGameIpc();
  handle('launcher:get-state', () => ({
    settings: publicSettings(),
    defaults: { serverUrl: defaultSettings().serverUrl },
    version: app.getVersion(),
    platform: process.platform,
    updater: updater.state,
    playing: !!gameWin,
    releasesUrl: RELEASES_URL,
  }));
  handle('launcher:save-settings', (patch) => {
    const r = applyPatch(store.get(), patch);
    if (!r.ok) return r;
    store.set(r.settings);
    return { ok: true, settings: publicSettings() };
  });
  handle('launcher:news', () => fetchNews(store.get().serverUrl, userAgent()));
  handle('launcher:status', () => fetchStatus(store.get().serverUrl, userAgent()));
  handle('launcher:play', () => openGame());
  handle('launcher:clear-cache', () => clearGameCache().catch((err) => {
    log.error('vidage du cache :', err);
    return { ok: false };
  }));
  handle('launcher:open-external', (url) => openExternal(url));
  handle('launcher:install-update', () => updater.install());
  handle('launcher:check-update', () => {
    updater.check();
    return updater.state;
  });
}

// ------------------------------------------------------------------------------------------------ menu

function buildMenu() {
  if (!IS_MAC) {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS needs an application menu for Cmd+Q / copy-paste shortcuts.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about', label: 'À propos de Brumeval Launcher' },
      { type: 'separator' },
      { role: 'hide', label: 'Masquer Brumeval' },
      { role: 'hideOthers', label: 'Masquer les autres' },
      { role: 'unhide', label: 'Tout afficher' },
      { type: 'separator' },
      { role: 'quit', label: 'Quitter Brumeval' },
    ] },
    { label: 'Édition', submenu: [
      { role: 'undo', label: 'Annuler' },
      { role: 'redo', label: 'Rétablir' },
      { type: 'separator' },
      { role: 'cut', label: 'Couper' },
      { role: 'copy', label: 'Copier' },
      { role: 'paste', label: 'Coller' },
      { role: 'selectAll', label: 'Tout sélectionner' },
    ] },
    { label: 'Fenêtre', submenu: [
      { role: 'minimize', label: 'Réduire' },
      { role: 'togglefullscreen', label: 'Plein écran' },
      { label: 'Launcher', accelerator: 'Cmd+L', click: () => showLauncher() },
      { role: 'close', label: 'Fermer la fenêtre' },
    ] },
  ]));
}

// ------------------------------------------------------------------------------------------------ smoke test

async function runSmoke() {
  const target = process.env.LAUNCHER_SMOKE_URL;
  const results = [];
  const fail = (msg) => {
    log.error(`SMOKE ÉCHEC : ${msg}`);
    console.error(JSON.stringify({ smoke: 'fail', error: msg, results }));
    app.exit(1);
  };
  const ok = (name, detail = '') => {
    results.push(name);
    log.info(`SMOKE ok : ${name} ${detail}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (what, fn, ms = 20000) => {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      try {
        last = await fn();
        if (last) return last;
      } catch (err) {
        last = err.message;
      }
      await sleep(150);
    }
    throw new Error(`${what} (dernière valeur : ${JSON.stringify(last)})`);
  };
  setTimeout(() => fail('délai global dépassé'), 120000).unref();

  try {
    if (!originOf(target || '')) throw new Error('LAUNCHER_SMOKE_URL manquante ou invalide');
    const saved = applyPatch(store.get(), { serverUrl: target });
    if (!saved.ok) throw new Error(saved.error);
    store.set(saved.settings);

    createLauncherWindow();
    const lwc = launcherWin.webContents;
    await waitFor('chargement du launcher', () => !lwc.isLoading() && lwc.getURL() === LAUNCHER_URL);
    const env = await lwc.executeJavaScript('({ title: document.title, bridge: typeof window.brumeval, req: typeof require, proc: typeof process })');
    if (env.title !== 'Brumeval Launcher') throw new Error(`titre du launcher : ${env.title}`);
    if (env.bridge !== 'object' || env.req !== 'undefined' || env.proc !== 'undefined') throw new Error(`isolation : ${JSON.stringify(env)}`);
    ok('isolation', JSON.stringify(env));
    const evalBlocked = await lwc.executeJavaScript("(() => { try { return new Function('return 1')() === 1 ? 'eval' : 'eval' } catch { return 'bloqué' } })()");
    if (evalBlocked !== 'bloqué') throw new Error('la CSP n\'empêche pas eval');
    ok('csp');
    const news = await waitFor('nouvelles', () => lwc.executeJavaScript("document.querySelectorAll('.news-item').length"));
    const newsOffline = await lwc.executeJavaScript("!document.getElementById('news-offline').hidden");
    if (newsOffline) {
      // A local test server always has news.json; an older remote server may not (the bundled copy is shown).
      if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(target + '/')) throw new Error('news.json du serveur non chargé (copie locale affichée)');
      log.warn('SMOKE : news.json absent du serveur, copie locale affichée');
    }
    ok('nouvelles', `${news} article(s)`);
    const status = await waitFor('statut du serveur', () => lwc.executeJavaScript("document.getElementById('status').dataset.state === 'online' && document.getElementById('status-text').textContent"));
    ok('statut', status);
    if (process.env.LAUNCHER_SMOKE_SHOTS) {
      // Optional screenshots for reviewing the UI (hidden window, painted offscreen).
      const dir = process.env.LAUNCHER_SMOKE_SHOTS;
      fs.mkdirSync(dir, { recursive: true });
      await lwc.executeJavaScript('document.fonts.ready.then(() => 1)');
      await sleep(1200);
      fs.writeFileSync(path.join(dir, 'launcher.png'), (await lwc.capturePage()).toPNG());
      const opened = await lwc.executeJavaScript("document.getElementById('options-btn').click(); !document.getElementById('options').hidden");
      if (!opened) throw new Error('la fenêtre des options ne s\'ouvre pas');
      lwc.invalidate();
      await sleep(500);
      fs.writeFileSync(path.join(dir, 'options.png'), (await lwc.capturePage()).toPNG());
      await lwc.executeJavaScript("document.querySelector('[data-close]').click(); 1");
      ok('captures', dir);
    }

    await lwc.executeJavaScript("document.getElementById('play').click()");
    await waitFor('fenêtre du jeu', () => gameWin);
    const gwc = gameWin.webContents;
    await waitFor('chargement du jeu', () => !gwc.isLoading() && isSameOrigin(gwc.getURL(), target));
    const title = await waitFor('titre du jeu', async () => {
      const t = await gwc.executeJavaScript('document.title');
      return t === 'Brumeval Online' && t;
    });
    ok('jeu', title);
    if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(target + '/')) {
      // The web game's service worker (PWA) works inside the launcher and stores the 3D models.
      const cached = await waitFor('service worker du jeu', () => gwc.executeJavaScript(`(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg || !reg.active) return 0;
        const keys = await caches.keys();
        if (!keys.includes('brumeval-assets-v1')) return 0;
        const entries = await (await caches.open('brumeval-assets-v1')).keys();
        return entries.filter((r) => r.url.includes('/models/')).length;
      })()`), 30000);
      ok('service-worker', `${cached} modèle(s) en cache`);
    }
    const playing = await lwc.executeJavaScript("document.body.classList.contains('is-playing')");
    if (!playing) throw new Error('le launcher n\'affiche pas « En jeu »');
    ok('en-jeu');

    // Navigation outside the server origin is blocked and handed to the (stubbed) system browser.
    const before = gwc.getURL();
    await gwc.executeJavaScript("location.href = 'https://example.com/ailleurs'; 1");
    await waitFor('lien externe', () => smokeExternal.includes('https://example.com/ailleurs'), 5000);
    await sleep(300);
    if (gwc.getURL() !== before) throw new Error(`navigation non bloquée : ${gwc.getURL()}`);
    await gwc.executeJavaScript("window.open('https://example.com/popup'); 1");
    await waitFor('popup bloquée', () => smokeExternal.includes('https://example.com/popup'), 5000);
    if (BrowserWindow.getAllWindows().length !== 2) throw new Error('une fenêtre inattendue a été ouverte');
    ok('navigation');

    const cleared = await lwc.executeJavaScript('window.brumeval.clearGameCache()');
    if (!cleared?.ok) throw new Error('vidage du cache');
    const left = await gwc.executeJavaScript("caches.keys().then((k) => k.filter((n) => n.startsWith('brumeval-')).length)");
    if (left) throw new Error(`${left} cache(s) du service worker restant(s) après le vidage`);
    ok('cache');

    gameWin.close();
    await waitFor('fermeture du jeu', async () => !gameWin && !(await lwc.executeJavaScript("document.body.classList.contains('is-playing')")));
    ok('fermeture');

    console.log(JSON.stringify({ smoke: 'ok', results }));
    quitting = true;
    app.exit(0);
  } catch (err) {
    fail(err.message);
  }
}

// ------------------------------------------------------------------------------------------------ lifecycle

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (gameWin && !gameWin.isDestroyed()) {
      if (gameWin.isMinimized()) gameWin.restore();
      gameWin.focus();
    } else showLauncher();
  });

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.whenReady().then(() => {
    log.info(`Brumeval Launcher ${app.getVersion()} (${process.platform} ${process.arch}, Electron ${process.versions.electron})${SMOKE ? ' — test automatique' : ''}`);
    buildMenu();
    registerAppProtocol();
    updater = new LauncherUpdater({ send: (s) => sendToLauncher('launcher:updater', s), log, smoke: SMOKE });
    registerIpc();
    if (SMOKE) {
      runSmoke();
      return;
    }
    createLauncherWindow();
    // Let the window paint first; the check is asynchronous anyway.
    setTimeout(() => updater.start(), 3000);
  });

  app.on('activate', () => {
    if (!launcherWin && !gameWin) createLauncherWindow();
  });

  app.on('before-quit', () => {
    quitting = true;
    updater?.stop();
    store.saveNow();
  });

  app.on('window-all-closed', () => app.quit());
}
