// Minimal bridge between the launcher UI and the main process (sandboxed preload: only `electron` is available).
// The game window has its own tiny bridge (src/preload/game.js).
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel) => (callback) => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('brumeval', {
  getState: () => ipcRenderer.invoke('launcher:get-state'),
  saveSettings: (patch) => ipcRenderer.invoke('launcher:save-settings', patch),
  fetchNews: () => ipcRenderer.invoke('launcher:news'),
  fetchStatus: () => ipcRenderer.invoke('launcher:status'),
  play: () => ipcRenderer.invoke('launcher:play'),
  clearGameCache: () => ipcRenderer.invoke('launcher:clear-cache'),
  openExternal: (url) => ipcRenderer.invoke('launcher:open-external', String(url)),
  installUpdate: () => ipcRenderer.invoke('launcher:install-update'),
  checkUpdate: () => ipcRenderer.invoke('launcher:check-update'),
  onUpdater: subscribe('launcher:updater'),
  onPlaying: subscribe('launcher:playing'),
});
