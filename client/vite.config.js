import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { assetManifest } from './vite-asset-manifest.js'; // [render-souls]

const shared = fileURLToPath(new URL('../shared', import.meta.url));
// [accounts] launcher version of this build: the website's « Télécharger le launcher » card links its installers
const launcherVersion = (() => {
  try { return JSON.parse(readFileSync(new URL('../launcher/package.json', import.meta.url), 'utf8')).version; } catch { return '0.2.0'; }
})();

export default defineConfig({
  plugins: [assetManifest()], // [render-souls] /asset-manifest.json (optional assets present in public/)
  resolve: { alias: { '@shared': shared } },
  define: { __LAUNCHER_VERSION__: JSON.stringify(launcherVersion) },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    // GAME_SERVER lets several dev instances run side by side (e.g. GAME_SERVER=ws://localhost:3102 npx vite --port 5174)
    proxy: {
      '/ws': { target: process.env.GAME_SERVER || 'ws://localhost:3000', ws: true },
      // [netcode-perf] JSON endpoints of the game server (status, version, health)
      '/api': { target: (process.env.GAME_SERVER || 'ws://localhost:3000').replace(/^ws/, 'http') },
      '/health': { target: (process.env.GAME_SERVER || 'ws://localhost:3000').replace(/^ws/, 'http') },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
