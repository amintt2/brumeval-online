// Brumeval Online — authoritative game server entry point.
//   node server/src/index.js          (env: PORT=3000, DATA_DIR=server/data, STATIC_DIR=client/dist)
//   import { startServer } from './server/src/index.js'
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_PORT, WS_PATH } from '../../shared/protocol.js';
import { GAME_TITLE } from '../../shared/data.js';
import { ROOT_DIR, SAVE_INTERVAL_MS, STATUS_LOG_MS } from './config.js';
import { createLogger } from './log.js';
import { createStaticHandler } from './http.js';
import { attachNet } from './net.js';
import { AccountStore } from './persistence.js';
import { Game } from './game.js';

const resolveDir = (dir) => (path.isAbsolute(dir) ? dir : path.resolve(ROOT_DIR, dir));

/**
 * Start the game server.
 * Relative directories are resolved against the repository root.
 * @returns {Promise<{ port: number, close: () => Promise<void>, game: Game, store: AccountStore }>}
 */
export async function startServer({ port = DEFAULT_PORT, dataDir = 'server/data', staticDir = 'client/dist', quiet = false } = {}) {
  const log = createLogger({ quiet });
  const store = new AccountStore(resolveDir(dataDir), log).load();
  const game = new Game({ store, log });

  const server = http.createServer(createStaticHandler(resolveDir(staticDir), log));
  server.on('clientError', (err, socket) => {
    try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* ignore */ }
  });
  const net = attachNet(server, { game, store, log });

  await new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(port, () => {
      server.off('error', onError);
      resolve();
    });
  });
  server.on('error', (err) => log.error('http :', err.message));

  game.start();
  const saveTimer = setInterval(() => {
    try {
      game.syncAll();
      store.save();
    } catch (err) {
      log.error('sauvegarde périodique :', err?.message || err);
    }
  }, SAVE_INTERVAL_MS);
  saveTimer.unref();
  const statusTimer = setInterval(() => {
    const t = game.takeTickStats();
    if (game.players.size) log.info(`état : ${game.players.size} joueur(s) en ligne, tick moyen ${t.avg.toFixed(2)} ms (max ${t.max.toFixed(1)} ms)`);
  }, STATUS_LOG_MS);
  statusTimer.unref();

  const actualPort = server.address().port;
  log.info(`${GAME_TITLE} — serveur démarré sur http://localhost:${actualPort} (WebSocket ${WS_PATH}, ${store.size} compte(s), ${game.monsters.size} monstres)`);

  let closing = null;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      clearInterval(saveTimer);
      clearInterval(statusTimer);
      game.stop();
      game.syncAll();
      store.save(true);
      await net.close(); // disconnect handlers save again (harmless)
      store.save();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
      log.info('serveur arrêté, comptes sauvegardés');
    })();
    return closing;
  };

  return { port: actualPort, close, game, store };
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const port = Number.parseInt(process.env.PORT || '', 10);
  const opts = { port: Number.isFinite(port) ? port : DEFAULT_PORT };
  if (process.env.DATA_DIR) opts.dataDir = process.env.DATA_DIR;
  if (process.env.STATIC_DIR) opts.staticDir = process.env.STATIC_DIR;
  startServer(opts)
    .then((srv) => {
      let stopping = false;
      const shutdown = (sig) => {
        if (stopping) return;
        stopping = true;
        console.log(`\n${sig} reçu, arrêt du serveur…`);
        const force = setTimeout(() => process.exit(1), 5000);
        srv.close().then(() => {
          clearTimeout(force);
          process.exit(0);
        });
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGBREAK', () => shutdown('SIGBREAK'));
      // scripts/dev.mjs asks for a graceful stop over IPC before restarting (Windows has no SIGTERM handler).
      process.on('message', (m) => { if (m === 'shutdown') shutdown('redémarrage'); });
    })
    .catch((err) => {
      console.error(err.code === 'EADDRINUSE' ? `Le port est déjà utilisé : ${err.message}` : err);
      process.exit(1);
    });
  process.on('uncaughtException', (err) => console.error('[exception non gérée]', err));
  process.on('unhandledRejection', (err) => console.error('[promesse rejetée]', err));
}

