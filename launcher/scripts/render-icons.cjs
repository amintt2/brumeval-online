// Rasterises launcher/build/icon.svg into every PNG the project needs (launcher + PWA).
// Run with Electron (headless, no visible window):  npm run icons   (from launcher/)
// Outputs:
//   launcher/build/icon.png               1024 px, transparent (electron-builder derives .ico / .icns from it)
//   client/public/pwa/icon-192.png        192 px, transparent
//   client/public/pwa/icon-512.png        512 px, transparent
//   client/public/pwa/maskable-512.png    512 px, opaque background, crest inside the 80 % safe zone
//   client/public/pwa/apple-touch-icon.png 180 px, opaque background
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const LAUNCHER = path.resolve(__dirname, '..');
const ROOT = path.resolve(LAUNCHER, '..');
const SVG = path.join(LAUNCHER, 'build', 'icon.svg');
const PWA = path.join(ROOT, 'client', 'public', 'pwa');

const TARGETS = [
  { file: path.join(LAUNCHER, 'build', 'icon.png'), size: 1024, scale: 1, bg: null },
  { file: path.join(PWA, 'icon-192.png'), size: 192, scale: 1, bg: null },
  { file: path.join(PWA, 'icon-512.png'), size: 512, scale: 1, bg: null },
  { file: path.join(PWA, 'maskable-512.png'), size: 512, scale: 0.78, bg: '#0b0d12' },
  { file: path.join(PWA, 'apple-touch-icon.png'), size: 180, scale: 0.9, bg: '#0b0d12' },
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let code = 0;
  try {
    const svg = fs.readFileSync(SVG, 'utf8');
    const win = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadURL('data:text/html;charset=utf-8,<!doctype html><title>icons</title>');
    for (const t of TARGETS) {
      const js = `(async () => {
        const img = new Image();
        img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
        await img.decode();
        const c = document.createElement('canvas');
        c.width = c.height = ${t.size};
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        ${t.bg ? `g.fillStyle = ${JSON.stringify(t.bg)}; g.fillRect(0, 0, ${t.size}, ${t.size});` : ''}
        const s = ${t.size} * ${t.scale};
        g.drawImage(img, (${t.size} - s) / 2, (${t.size} - s) / 2, s, s);
        return c.toDataURL('image/png');
      })()`;
      const url = await win.webContents.executeJavaScript(js);
      fs.mkdirSync(path.dirname(t.file), { recursive: true });
      fs.writeFileSync(t.file, Buffer.from(url.split(',')[1], 'base64'));
      console.log(`${path.relative(ROOT, t.file)} (${t.size} px)`);
    }
  } catch (err) {
    console.error('Échec du rendu des icônes :', err);
    code = 1;
  }
  app.exit(code);
});
