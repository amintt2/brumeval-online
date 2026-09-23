// Brumeval Online — authoritative game server entry point.
//   node server/src/index.js          (env: PORT=3000, DATA_DIR=server/data, STATIC_DIR=client/dist,
//                                      TRUST_PROXY=0|1|n, MAX_PLAYERS=100 — see docs/DEPLOIEMENT.md)
//   import { startServer } from './server/src/index.js'
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_PORT, WS_PATH } from '../../shared/protocol.js';
import { GAME_TITLE } from '../../shared/data.js';
import { ROOT_DIR, SAVE_INTERVAL_MS, STATUS_LOG_MS, MAX_PLAYERS, MOTD } from './config.js';
import { createLogger } from './log.js';
import { createHttpHandler } from './http.js';
import { attachNet } from './net.js';
import { AccountStore } from './persistence.js';
import { Game } from './game.js';
import { attachPerf } from './perf.js';
import { VERSION, buildId, setStaticDir } from './version.js';
import { netStats, socketBytesWritten, PERMESSAGE_DEFLATE } from './wsout.js';

const BACKUP_CHECK_MS = 60 * 60_000;   // daily backup: checked every hour
const PERF_CHECK_MS = 60_000;          // tick budget warning / phase window
const NET_SAMPLE_MS = 5_000;           // outgoing bandwidth sampling for /health

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
  const perf = attachPerf(game);
  const startedAt = Date.now();
  setStaticDir(resolveDir(staticDir));

  // outgoing bandwidth, sampled (bytes really written on the sockets, i.e. after compression)
  const netRate = { at: performance.now(), wire: 0, raw: 0, msgs: 0, wireBps: 0, rawBps: 0, msgps: 0 };
  let net = null;
  const status = () => ({ name: GAME_TITLE, online: game.players.size, max: MAX_PLAYERS, version: VERSION, build: buildId(), motd: MOTD });
  const routes = {
    '/api/status': status,
    '/api/version': () => ({ version: VERSION, build: buildId() }),
    '/health': () => {
      const mem = process.memoryUsage();
      const t = perf.snapshot();
      return {
        status: t.p95 > t.budgetMs ? 'degraded' : 'ok',
        version: VERSION,
        build: buildId(),
        uptime: Math.round((Date.now() - startedAt) / 1000),
        players: game.players.size,
        maxPlayers: MAX_PLAYERS,
        entities: game.entities.size,
        monsters: game.monsters.size,
        monstersAwake: game.aoi?.stats.awake ?? null,
        accounts: store.size,
        tick: t,
        net: {
          sessions: net ? net.sessions.size : 0,
          outKBps: Math.round(netRate.wireBps / 102.4) / 10,
          outRawKBps: Math.round(netRate.rawBps / 102.4) / 10,
          msgPerS: Math.round(netRate.msgps),
          perClientKBps: game.players.size ? Math.round(netRate.wireBps / game.players.size / 102.4) / 10 : 0,
          compression: PERMESSAGE_DEFLATE ? 'permessage-deflate' : 'none',
          snapshotsSkipped: game.snapState?.skipped ?? 0, // rounds skipped for congested clients (snapshot.js)
        },
        saves: { ...store.stats, pending: !!store.writing, lastError: store.lastError },
        memory: { rssMB: Math.round(mem.rss / 1048576), heapMB: Math.round(mem.heapUsed / 1048576) },
        node: process.version,
        time: new Date().toISOString(),
      };
    },
  };
  const httpHandler = createHttpHandler({ staticDir: resolveDir(staticDir), log, routes });
  const server = http.createServer(httpHandler);
  server.on('clientError', (err, socket) => {
    try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* ignore */ }
  });
  net = attachNet(server, { game, store, log });

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
      store.save(); // background writes of the changed accounts only
    } catch (err) {
      log.error('sauvegarde périodique :', err?.message || err);
    }
  }, SAVE_INTERVAL_MS);
  saveTimer.unref();
  const statusTimer = setInterval(() => {
    const t = game.takeTickStats();
    const p = perf.percentiles();
    if (game.players.size) log.info(`état : ${game.players.size} joueur(s) en ligne, tick moyen ${t.avg.toFixed(2)} ms (p95 ${p.p95.toFixed(2)} ms, max ${t.max.toFixed(1)} ms), ${(netRate.wireBps / 1024).toFixed(1)} Ko/s sortants`);
  }, STATUS_LOG_MS);
  statusTimer.unref();
  const perfTimer = setInterval(() => {
    perf.check(log);
    perf.resetPhases();
  }, PERF_CHECK_MS);
  perfTimer.unref();
  const netTimer = setInterval(() => {
    const now = performance.now();
    const wire = socketBytesWritten(net.sessions);
    const dt = (now - netRate.at) / 1000;
    if (dt > 0) {
      netRate.wireBps = Math.max(0, wire - netRate.wire) / dt;
      netRate.rawBps = (netStats.bytes - netRate.raw) / dt;
      netRate.msgps = (netStats.msgs - netRate.msgs) / dt;
    }
    Object.assign(netRate, { at: now, wire, raw: netStats.bytes, msgs: netStats.msgs });
  }, NET_SAMPLE_MS);
  netTimer.unref();
  let backupRun = Promise.resolve();
  const backup = () => {
    if (store.size === 0) return;
    game.syncAll();
    backupRun = store.maybeBackup().catch(() => { /* logged by the store */ });
  };
  backup();
  const backupTimer = setInterval(backup, BACKUP_CHECK_MS);
  backupTimer.unref();
  httpHandler.statics.warm().catch(() => { /* best effort */ });

  const actualPort = server.address().port;
  log.info(`${GAME_TITLE} v${VERSION} — serveur démarré sur http://localhost:${actualPort} (WebSocket ${WS_PATH}, ${store.size} compte(s), ${game.monsters.size} monstres)`);

  let closing = null;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      clearInterval(saveTimer);
      clearInterval(statusTimer);
      clearInterval(perfTimer);
      clearInterval(netTimer);
      clearInterval(backupTimer);
      game.stop();
      game.syncAll();
      store.save(true);
      await net.close(); // disconnect handlers save again (harmless)
      store.save(true);
      await store.flush();
      await backupRun;
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

