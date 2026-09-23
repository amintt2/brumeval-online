#!/usr/bin/env node
// Test de charge : le serveur tourne dans un processus enfant (pour mesurer son CPU seul) et N bots
// (100 par défaut) se déplacent, combattent et discutent pendant D secondes, tous regroupés dans la même
// zone (le pire cas : chaque client voit tous les autres).
//
//   node tests/load.mjs [--bots 100] [--seconds 60] [--spread 22] [--json resultat.json] [--no-batch]
//                       [--check]   (code de sortie 1 si les objectifs ne sont pas atteints)
//
// Rapport : durée du tick p50/p95/p99/max, CPU du processus serveur, RSS, octets/s reçus par client
// (sur le fil, donc après compression permessage-deflate, et avant compression), messages/s par client.
// Objectifs (docs/PERFORMANCES.md) : 100 joueurs → tick p95 < 10 ms et < 20 Ko/s par client.
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot, sleep } from './lib/botClient.mjs';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return typeof def === 'number' ? Number(v) : v;
};
const flag = (name) => argv.includes(`--${name}`);

const TARGET_P95_MS = 10;
const TARGET_KBPS = 20;

// ------------------------------------------------------------------ child: the server
if (flag('server')) {
  const maxPlayers = arg('max', 100);
  process.env.MAX_PLAYERS = String(maxPlayers);
  const { startServer } = await import('../server/src/index.js');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-load-'));
  const srv = await startServer({ port: arg('port', 0), dataDir, staticDir: path.join(dataDir, 'none'), quiet: true });
  // Tick durations measured here (works with any server version): wrap game.tick.
  const game = srv.game;
  const durations = [];
  const origTick = game.tick.bind(game);
  game.tick = () => {
    const t0 = performance.now();
    origTick();
    durations.push(performance.now() - t0);
  };
  let cpu0 = process.cpuUsage(), wall0 = performance.now();
  process.send({ t: 'ready', port: srv.port });
  process.on('message', async (m) => {
    if (m.t === 'reset') {
      durations.length = 0;
      cpu0 = process.cpuUsage();
      wall0 = performance.now();
      process.send({ t: 'reset' });
    } else if (m.t === 'stats') {
      const sorted = Float64Array.from(durations).sort();
      const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
      const cpu = process.cpuUsage(cpu0);
      const wall = performance.now() - wall0;
      const phases = typeof game.perf?.snapshot === 'function' ? game.perf.snapshot().phases : null;
      process.send({
        t: 'stats',
        ticks: sorted.length, wall,
        p50: pct(50), p95: pct(95), p99: pct(99), max: sorted.length ? sorted[sorted.length - 1] : 0,
        avg: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
        cpuPct: ((cpu.user + cpu.system) / 1000 / wall) * 100,
        rss: process.memoryUsage().rss, heap: process.memoryUsage().heapUsed,
        players: game.players.size, monsters: game.monsters.size, errors: game.errorCount, phases,
      });
    } else if (m.t === 'stop') {
      await srv.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
      process.exit(0);
    }
  });
} else {
  await parent();
}

async function parent() {
  const N = arg('bots', 100), SECONDS = arg('seconds', 60), SPREAD = arg('spread', 22);
  const CENTER = [48, 24]; // Plaines d'Émeraude, en bordure de la zone des gluants
  const child = fork(fileURLToPath(import.meta.url), ['--server', '--port', String(arg('port', 0)), '--max', String(Math.max(100, N))], {
    stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; process.stderr.write(d); });
  const next = (t) => new Promise((r) => { const h = (m) => { if (m.t === t) { child.off('message', h); r(m); } }; child.on('message', h); });
  const { port } = await next('ready');
  const url = `ws://127.0.0.1:${port}/ws`;
  const log = (s) => console.log(`[charge] ${s}`);
  log(`serveur sur le port ${port}, ${N} bots, ${SECONDS} s, foule de rayon ${SPREAD} m autour de (${CENTER})`);

  // ---- connect & register (in parallel batches: scrypt is the bottleneck)
  const classes = ['warrior', 'mage', 'ranger'];
  const bots = [];
  const t0 = performance.now();
  for (let i = 0; i < N; i += 10) {
    const batch = [];
    for (let j = i; j < Math.min(N, i + 10); j++) {
      batch.push((async () => {
        const b = new Bot(url, `L${j}`, { keepHistory: false, batch: !flag('no-batch') });
        await b.connect();
        const r = await b.register(`Charge${j}`, 'motdepasse', classes[j % 3]);
        if (r.t !== 'auth_ok') throw new Error(`inscription ${j} : ${r.code}`);
        return b;
      })());
    }
    bots.push(...(await Promise.all(batch)));
  }
  log(`${bots.length} bots connectés en ${((performance.now() - t0) / 1000).toFixed(1)} s, marche vers la foule…`);

  // ---- everyone walks to the crowd spot (not measured)
  const rnd = (r) => (Math.random() * 2 - 1) * r;
  const spot = () => [CENTER[0] + rnd(SPREAD), CENTER[1] + rnd(SPREAD)];
  const route = [[4, 3.5], [20, 6], [40, 16]];
  await Promise.all(bots.map(async (b) => {
    try { await b.walkPath([...route, spot()], { maxMs: 30000 }); } catch { /* stuck: stays where it is */ }
  }));
  await sleep(1000);

  // ---- measured phase
  child.send({ t: 'reset' });
  await next('reset');
  const wire0 = bots.map((b) => b.wireBytes());
  const raw0 = bots.map((b) => b.bytes);
  const cnt0 = bots.map((b) => b.count);
  const frames0 = bots.map((b) => b.frames);
  const tStart = performance.now();
  const until = tStart + SECONDS * 1000;
  let stuck = 0, chats = 0, attacks = 0;
  const run = async (b, i) => {
    await sleep((i * 37) % 1000);
    let lastChat = performance.now() - Math.random() * 10000;
    while (performance.now() < until) {
      const [x, z] = spot();
      try {
        await b.walkTo(x, z, { maxMs: Math.max(100, Math.min(6000, until - performance.now())) });
      } catch { stuck++; }
      if (performance.now() - lastChat > 8000 + Math.random() * 6000) {
        lastChat = performance.now();
        b.send({ t: 'chat', text: `Bonjour de ${b.label} ! On chasse les gluants ?` });
        chats++;
      }
      let mon = null, best = 14;
      for (const e of b.ents.values()) {
        if (e.k !== 'monster' || e.s === 2) continue;
        const d = Math.hypot(e.x - b.x, e.z - b.z);
        if (d < best) { best = d; mon = e; }
      }
      if (mon) {
        b.send({ t: 'ability', slot: 0, tg: mon.id });
        attacks++;
        await sleep(600 + Math.random() * 900); // stand and fight a little
      }
      b.send({ t: 'ping', c: Date.now() });
    }
  };
  await Promise.all(bots.map(run));
  const secs = (performance.now() - tStart) / 1000;
  const s = await (async () => { child.send({ t: 'stats' }); return next('stats'); })();

  const per = (arr0, get) => bots.reduce((n, b, i) => n + (get(b) - arr0[i]), 0) / bots.length / secs;
  const wireBps = per(wire0, (b) => b.wireBytes());
  const rawBps = per(raw0, (b) => b.bytes);
  const msgps = per(cnt0, (b) => b.count);
  const framesps = per(frames0, (b) => b.frames);
  const corrections = bots.reduce((n, b) => n + b.corrections, 0);
  const alive = bots.filter((b) => !b.closed).length;

  const result = {
    date: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, bots: N, seconds: +secs.toFixed(1),
    batch: !flag('no-batch'), players: s.players, monsters: s.monsters,
    tick: { n: s.ticks, p50: +s.p50.toFixed(3), p95: +s.p95.toFixed(3), p99: +s.p99.toFixed(3), max: +s.max.toFixed(2), avg: +s.avg.toFixed(3) },
    cpuPct: +s.cpuPct.toFixed(1), rssMB: +(s.rss / 1e6).toFixed(0), heapMB: +(s.heap / 1e6).toFixed(0),
    perClient: { wireKBps: +(wireBps / 1024).toFixed(2), rawKBps: +(rawBps / 1024).toFixed(2), msgPerS: +msgps.toFixed(1), framesPerS: +framesps.toFixed(1) },
    chats, attacks, corrections, stuck, disconnected: N - alive, serverErrors: s.errors, phases: s.phases,
  };
  log(`joueurs connectés : ${s.players}/${N}, monstres : ${s.monsters}, déconnectés : ${N - alive}`);
  log(`tick (${s.ticks} mesurés) : p50 ${s.p50.toFixed(2)} ms · p95 ${s.p95.toFixed(2)} ms · p99 ${s.p99.toFixed(2)} ms · max ${s.max.toFixed(1)} ms · moyenne ${s.avg.toFixed(2)} ms`);
  log(`CPU serveur : ${s.cpuPct.toFixed(1)} % d'un cœur · RSS ${(s.rss / 1e6).toFixed(0)} Mo · tas ${(s.heap / 1e6).toFixed(0)} Mo`);
  log(`par client : ${(wireBps / 1024).toFixed(2)} Ko/s sur le fil (${(rawBps / 1024).toFixed(2)} Ko/s avant compression), ${msgps.toFixed(1)} messages/s en ${framesps.toFixed(1)} trames/s`);
  log(`activité : ${chats} messages de discussion, ${attacks} attaques, ${corrections} corrections, ${stuck} trajets bloqués, ${s.errors} erreurs serveur`);
  if (s.phases) log(`phases du tick (moyenne ms) : ${Object.entries(s.phases).map(([k, v]) => `${k} ${v.avg.toFixed(3)}`).join(' · ')}`);
  const out = arg('json', null);
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));

  for (const b of bots) await b.close();
  child.send({ t: 'stop' });
  await new Promise((r) => child.on('exit', r));

  const healthy = s.errors === 0 && s.players === N && alive === N && !/ERREUR|\[exception/.test(stderr);
  const targets = s.p95 < TARGET_P95_MS && wireBps / 1024 < TARGET_KBPS;
  log(`objectifs (p95 < ${TARGET_P95_MS} ms, < ${TARGET_KBPS} Ko/s par client) : ${targets ? 'ATTEINTS' : 'NON ATTEINTS'}`);
  const ok = healthy && (!flag('check') || targets);
  log(ok ? 'SUCCÈS' : 'ÉCHEC');
  process.exit(ok ? 0 : 1);
}
