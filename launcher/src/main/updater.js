// Launcher self-update through electron-updater + GitHub Releases (amintt2/brumeval-online, tags launcher-v*).
// The game itself is loaded from the server, so it is always up to date; only the launcher needs this.
'use strict';

const { app, shell } = require('electron');
const { friendlyError } = require('./lib/updateErrors');

const RELEASES_URL = 'https://github.com/amintt2/brumeval-online/releases/latest';
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
// Squirrel.Mac refuses to install an update into an unsigned app: on macOS the launcher only *announces* new
// versions (link to GitHub) unless package.json sets "brumeval": { "macAutoUpdate": true } (signed + notarized builds).
const MAC_AUTO_UPDATE = require('../../package.json').brumeval?.macAutoUpdate === true;

class LauncherUpdater {
  /** @param {{ send: (state) => void, log: object, smoke: boolean }} opts */
  constructor({ send, log, smoke }) {
    this.send = send;
    this.log = log;
    this.state = { state: 'idle', version: '', percent: 0, message: '' };
    this.updater = null;
    this.timer = null;

    let reason = '';
    if (smoke) reason = 'Mode test : mises à jour désactivées.';
    else if (!app.isPackaged) reason = 'Mode développement : mises à jour désactivées.';
    if (reason) {
      this.state = { state: 'disabled', version: '', percent: 0, message: reason };
      return;
    }

    const { autoUpdater } = require('electron-updater');
    this.updater = autoUpdater;
    autoUpdater.logger = log;
    // The portable .exe cannot replace itself either: it announces new versions like unsigned macOS builds.
    this.manualOnly = !!process.env.PORTABLE_EXECUTABLE_DIR || (process.platform === 'darwin' && !MAC_AUTO_UPDATE);
    autoUpdater.autoDownload = !this.manualOnly;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', message: 'Recherche de mises à jour…' }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'uptodate', message: `Launcher à jour (v${app.getVersion()})` }));
    autoUpdater.on('update-available', (info) => {
      if (this.manualOnly) {
        this.set({ state: 'available', version: info.version, percent: 0, manual: true, message: `La version ${info.version} est disponible au téléchargement.` });
      } else {
        this.set({ state: 'downloading', version: info.version, percent: 0, message: `Téléchargement de la version ${info.version}…` });
      }
    });
    autoUpdater.on('download-progress', (p) => this.set({
      state: 'downloading',
      percent: Math.max(0, Math.min(100, p.percent || 0)),
      bytesPerSecond: p.bytesPerSecond || 0,
      message: `Téléchargement de la version ${this.state.version}…`,
    }));
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'downloaded', version: info.version, percent: 100, message: `La version ${info.version} est prête.` }));
    autoUpdater.on('error', (err) => {
      log.warn('mise à jour :', err);
      // A failed background check must not hide an update that is already downloaded.
      if (this.state.state === 'downloaded') return;
      this.set({ state: 'error', message: friendlyError(err), manual: this.manualOnly });
    });
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.send(this.state);
  }

  start() {
    if (!this.updater) return;
    this.check();
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  check() {
    if (!this.updater || ['downloading', 'downloaded', 'available'].includes(this.state.state)) return;
    this.updater.checkForUpdates().catch(() => { /* reported through the 'error' event */ });
  }

  /** "Redémarrer pour mettre à jour". */
  install() {
    if (this.updater && this.state.state === 'downloaded') {
      setImmediate(() => this.updater.quitAndInstall(false, true));
      return true;
    }
    if (this.state.manual) shell.openExternal(RELEASES_URL);
    return false;
  }

  stop() {
    clearInterval(this.timer);
  }
}

module.exports = { LauncherUpdater, RELEASES_URL };
