#!/usr/bin/env node
// Soak test: the server runs in a child process (so its CPU can be measured alone), N bots walk
// randomly (legitimately, like the real client), chat and auto-attack monsters for D seconds.
// Usage: node tests/soak.mjs [--bots 20] [--seconds 20] [--port 0]
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot, sleep } from './lib/botClient.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};

// ------------------------------------------------------------------ child: the server
if (process.argv.includes('--server')) {
  const { startServer } = await import('../server/src/index.js');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-soak-'));
  const srv = await startServer({ port: arg('port', 0), dataDir, staticDir: path.join(dataDir, 'none'), quiet: true });
  process.send({ t: 'ready', port: srv.port });
  process.on('message', async (m) => {
    if (m.t === 'stats') {
      process.send({ t: 'stats', cpu: process.cpuUsage(), wall: performance.now(), ticks: srv.game.takeTickStats(), players: srv.game.players.size, errors: srv.game.errorCount, mem: process.memoryUsage().rss });
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
  const N = arg('bots', 20), SECONDS = arg('seconds', 20);
  const child = fork(fileURLToPath(import.meta.url), ['--server', '--port', String(arg('port', 0))], { stdio: ['ignore', 'inherit', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; process.stderr.write(d); });
  const next = (t) => new Promise((r) => { const h = (m) => { if (m.t === t) { child.off('message', h); r(m); } }; child.on('message', h); });
  const { port } = await next('ready');
  const stats = async () => { child.send({ t: 'stats' }); return next('stats'); };
  console.log(`[soak] serveur sur le port ${port}, ${N} bots, ${SECONDS} s`);

  const classes = ['warrior', 'mage', 'ranger'];
  const bots = [];
  for (let i = 0; i < N; i++) {
    const b = new Bot(`ws://127.0.0.1:${port}/ws`, `S${i}`, { keepHistory: false });
    await b.connect();
    const r = await b.register(`Soak${i}`, 'motdepasse', classes[i % 3]);
    if (r.t !== 'auth_ok') throw new Error(`auth ${i}: ${r.code}`);
    bots.push(b);
  }
  await sleep(500);
  const s0 = await stats();
  const until = performance.now() + SECONDS * 1000;
  // random destinations around the village roads and the east plains
  const spots = [[4, 3.5], [-3, 2.5], [20, 6], [45, 18], [60, 30], [-30, -2], [-12, 25], [-4, -30], [50, 36], [66, 24]];
  let stuck = 0;
  const run = async (b, i) => {
    let k = i % spots.length;
    while (performance.now() < until) {
      k = (k + 1 + Math.floor(Math.random() * 3)) % spots.length;
      const [x, z] = spots[k];
      try {
        await b.walkTo(x + (Math.random() - 0.5) * 4, z + (Math.random() - 0.5) * 4, { maxMs: Math.max(100, until - performance.now()) });
      } catch { stuck++; }
      if (Math.random() < 0.3) b.send({ t: 'chat', text: `bonjour de ${b.label}` });
      const mon = [...b.ents.values()].find((e) => e.k === 'monster' && e.s !== 2 && Math.hypot(e.x - b.x, e.z - b.z) < 15);
      if (mon) b.send({ t: 'ability', slot: 0, tg: mon.id });
      b.send({ t: 'ping', c: Date.now() });
    }
  };
  await Promise.all(bots.map(run));
  const s1 = await stats();

  const cpuMs = (s1.cpu.user + s1.cpu.system - s0.cpu.user - s0.cpu.system) / 1000;
  const wallMs = s1.wall - s0.wall;
  const t = s1.ticks;
  const corrections = bots.reduce((n, b) => n + b.corrections, 0);
  const received = bots.reduce((n, b) => n + b.count, 0);
  console.log(`[soak] joueurs connectés : ${s1.players}`);
  console.log(`[soak] ticks : ${t.ticks} (attendu ≈ ${Math.round(wallMs / 50)}), durée moyenne ${t.avg.toFixed(3)} ms, max ${t.max.toFixed(2)} ms → ${(t.avg / 50 * 100).toFixed(2)} % du budget de 50 ms`);
  console.log(`[soak] CPU du processus serveur : ${(cpuMs / wallMs * 100).toFixed(1)} % d'un cœur (réseau + JSON + ticks), RSS ${(s1.mem / 1e6).toFixed(0)} Mo`);
  console.log(`[soak] messages reçus par les bots : ${received}, corrections : ${corrections}, trajets bloqués : ${stuck}, erreurs serveur : ${s1.errors}`);
  for (const b of bots) await b.close();
  child.send({ t: 'stop' });
  await new Promise((r) => child.on('exit', r));
  const okAll = s1.errors === 0 && corrections === 0 && s1.players === N && t.avg < 7.5 && !/ERREUR/.test(stderr);
  console.log(okAll ? '[soak] SUCCÈS' : '[soak] ÉCHEC');
  process.exit(okAll ? 0 : 1);
}
