// Minimal bridge for the GAME window (sandboxed preload: only `electron` is available).
// The web game uses it to know it runs inside the launcher (no "download the launcher" card) and to offer
// "Quitter" in its main menu. Nothing else is exposed: the game page stays a normal web page.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brumevalLauncher', {
  isLauncher: true,
  /** { version, platform } of the launcher. */
  info: () => ipcRenderer.invoke('game:info'),
  /** Close the game window (the launcher decides whether the whole app quits). */
  quit: () => ipcRenderer.invoke('game:quit'),
});
