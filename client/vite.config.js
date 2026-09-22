import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@shared': shared } },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    // GAME_SERVER lets several dev instances run side by side (e.g. GAME_SERVER=ws://localhost:3102 npx vite --port 5174)
    proxy: { '/ws': { target: process.env.GAME_SERVER || 'ws://localhost:3000', ws: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
