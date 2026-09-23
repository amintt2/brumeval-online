#!/usr/bin/env node
// End-to-end security test (run by `npm test` after tests/bot.mjs). Starts the real server on a random port
// with a temporary data directory, then:
//   1. plays legitimately with jittery / bursty networking (lag spikes, message bursts) -> ZERO flags, ZERO corrections
//   2. attacks it: speed hack, teleports, walking through a house, flood, brute force, oversized and malformed
//      packets, prototype pollution, forbidden names, staff commands by a player -> all blocked
//   3. escalation: a persistent cheater is kicked, then banned automatically; an admin kicks / bans / unbans.
// Exits 0 / 1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/src/index.js';
import { generateWorldObjects } from '../shared/world.js';
import { PLAYER_RADIUS } from '../shared/protocol.js';
import { Bot, sleep, collisionWorld } from './lib/botClient.mjs';

const T0 = performance.now();
const DEADLINE_MS = 110_000;
const PASSWORD = 'motdepasse';

let step = 0;
const log = (msg) => console.log(`[sécurité ${((performance.now() - T0) / 1000).toFixed(1).padStart(5)} s] ${msg}`);
function ok(cond, msg) {
  if (!cond) throw new Error(`échec : ${msg}`);
  log(`✔ ${++step}. ${msg}`);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-securite-'));
let server = null;
const bots = [];

const watchdog = setTimeout(() => {
  console.error(`[sécurité] ÉCHEC : délai global de ${DEADLINE_MS / 1000} s dépassé`);
  process.exit(1);
}, DEADLINE_MS);

let ipSeq = 10;
/** A bot "behind the reverse proxy" with its own public address. */
async function newBot(label, { ip = `198.51.100.${ipSeq++}`, origin } = {}) {
  const b = new Bot(url(), label, { headers: { 'X-Forwarded-For': ip }, ...(origin !== undefined ? { origin } : {}) });
  bots.push(b);
  await b.connect();
  return b;
}
const url = () => `ws://127.0.0.1:${server.port}/ws`;
const sec = () => server.security;
const flagCodes = (name) => sec().flagsOf(name).map((f) => f.code);

/**
 * Walk like the real client but with a bad network: every ~1.2 s the connection stalls for 150–300 ms
 * (messages are held back, then flushed together in a burst).
 */
async function jitteryWalk(bot, points) {
  const cw = collisionWorld();
  const speed = bot.self.stats.speed;
  let held = [];
  let stallUntil = 0, nextStall = performance.now() + 800;
  let last = performance.now();
  for (const [tx, tz] of points) {
    let best = Infinity, lastProgress = performance.now();
    for (let guard = 0; guard < 600; guard++) {
      const d = Math.hypot(tx - bot.x, tz - bot.z);
      if (d < 0.3) break;
      if (d < best - 0.05) { best = d; lastProgress = performance.now(); }
      if (performance.now() - lastProgress > 1500) break; // stuck against something: next waypoint, like a player
      await sleep(1000 / 15);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      let remaining = Math.min(speed * dt, d);
      while (remaining > 1e-4) {
        const s = Math.min(0.5, remaining);
        const dd = Math.hypot(tx - bot.x, tz - bot.z);
        const r = cw.move(bot.x, bot.z, bot.x + ((tx - bot.x) / dd) * s, bot.z + ((tz - bot.z) / dd) * s, PLAYER_RADIUS);
        bot.x = r.x; bot.z = r.z;
        remaining -= s;
      }
      const msg = { t: 'move', x: +bot.x.toFixed(2), z: +bot.z.toFixed(2), ry: 0 };
      if (now >= nextStall) { stallUntil = now + 150 + Math.random() * 150; nextStall = now + 900 + Math.random() * 600; }
      if (now < stallUntil) held.push(msg);
      else {
        for (const m of held) bot.send(m);
        held = [];
        bot.send(msg);
      }
    }
  }
  for (const m of held) bot.send(m);
  await sleep(300);
}

async function main() {
  server = await startServer({
    port: 0, dataDir, staticDir: path.join(dataDir, 'pas-de-client'), quiet: true,
    security: {
      trustProxy: 1, allowNoOrigin: false, adminNames: ['gardien'],
      // lower escalation thresholds so that the scenario runs in seconds (production: 50 / 3)
      kickAt: 30, banAfterKicks: 2, autoBanMs: 10 * 60_000,
    },
  });
  log(`serveur de test sur le port ${server.port} (données : ${dataDir})`);

  // ---------------------------------------------------------------- 1. legitimate play
  const L = await newBot('Légitime');
  ok((await L.register('Honnete', PASSWORD, 'ranger')).t === 'auth_ok', 'joueur légitime connecté');
  // around the village first, cutting corners along lamp posts, the stall, crates and barrels, then out east
  const ring = [];
  for (let a = 90; a <= 450; a += 45) ring.push([13.5 * Math.cos((a * Math.PI) / 180), 13.5 * Math.sin((a * Math.PI) / 180)]);
  await jitteryWalk(L, [...ring, [4, 3.5], [20, 6], [45, 18]]);
  L.send({ t: 'chat', text: 'Bonjour à tous, belle journée !' });
  L.send({ t: 'ping', c: 1 });
  await L.waitType('pong', () => true, { from: L.mark() - 1 });
  await sleep(300);
  ok(L.corrections === 0, `aucune correction pour le joueur légitime (${L.history.filter((m) => m.t === 'snap').length} snaps reçus)`);
  ok(sec().stats.flags === 0, `aucun signalement pour le joueur légitime (${JSON.stringify(sec().flagsOf('Honnete'))})`);

  // ---------------------------------------------------------------- 2. attacks
  const C = await newBot('Tricheur');
  ok((await C.register('Tricheur', PASSWORD, 'warrior')).t === 'auth_ok', 'tricheur connecté');
  const srvC = server.game.playerByName('Tricheur');

  // through a house (small steps, destination inside the wall)
  const house = generateWorldObjects().find((o) => o.type === 'house');
  const toCentre = Math.hypot(house.x, house.z);
  const near = [house.x - (house.x / toCentre) * (house.r + 1.5), house.z - (house.z / toCentre) * (house.r + 1.5)];
  await C.walkPath([near]);
  await sleep(200);
  let from = C.mark();
  const dir = { x: house.x - C.x, z: house.z - C.z };
  const dl = Math.hypot(dir.x, dir.z);
  for (let i = 1; i <= 12; i++) {
    C.send({ t: 'move', x: +(C.x + (dir.x / dl) * 0.4 * i).toFixed(2), z: +(C.z + (dir.z / dl) * 0.4 * i).toFixed(2), ry: 0 });
    await sleep(66);
  }
  const back = await C.waitType('correct', () => true, { from, timeout: 2000 });
  C.x = back.x; C.z = back.z;
  const inHouse = Math.hypot(srvC.x - house.x, srvC.z - house.z) < house.r + PLAYER_RADIUS - 0.2;
  ok(!inHouse && flagCodes('Tricheur').some((c) => c === 'blocked' || c === 'wall'), 'traverser une maison : refusé et signalé');

  // speed hack ×2.5 for 3 s on the road (the client obeys corrections, like most hacks do to stay "in sync")
  await sleep(2600);
  await C.walkPath([[4, 3.5], [20, 6]]);
  const start = { x: srvC.x, z: srvC.z };
  const t0 = performance.now();
  const corrBefore = C.corrections;
  try {
    await C.walkTo(45, 18, { factor: 2.5, maxMs: 3000, stop: 0.3 });
  } catch { /* the walk is cut by corrections: expected */ }
  const elapsed = (performance.now() - t0) / 1000;
  await sleep(300);
  const travelled = Math.hypot(srvC.x - start.x, srvC.z - start.z);
  ok(C.corrections > corrBefore && travelled <= srvC.stats.speed * 1.1 * elapsed + srvC.stats.speed * 1.5 + 1.5,
    `speed hack ×2.5 : ${C.corrections - corrBefore} corrections, ${travelled.toFixed(1)} m parcourus en ${elapsed.toFixed(1)} s côté serveur (légitime : ${(srvC.stats.speed * elapsed).toFixed(1)} m)`);
  ok(flagCodes('Tricheur').includes('speed'), 'speed hack signalé (speed)');

  // teleport
  await sleep(2600); // the client is back in sync
  C.x = srvC.x; C.z = srvC.z;
  from = C.mark();
  C.send({ t: 'move', x: srvC.x + 30, z: srvC.z, ry: 0 });
  const corr = await C.waitType('correct', () => true, { from, timeout: 2000 });
  ok(Math.hypot(corr.x - srvC.x, corr.z - srvC.z) < 0.01 && flagCodes('Tricheur')[0] === 'teleport', 'téléportation refusée et signalée');

  // malformed / prototype pollution / oversized (another client)
  const P = await newBot('Pirate');
  ok((await P.register('Pirate', PASSWORD, 'mage')).t === 'auth_ok', 'client pirate connecté');
  P.ws.send('{"t":"move","x":1,"z":2,"__proto__":{"isAdmin":true}}');
  P.send({ t: 'buy', id: 1, item: 'potion_hp_s', qty: -99 });
  P.send({ t: 'use_item', slot: 1e9 });
  P.send({ t: 'ability', slot: 0, tg: 'tout le monde' });
  P.ws.send('{pas du json');
  from = P.mark();
  P.send({ t: 'ping', c: 77 });
  await P.waitType('pong', (m) => m.c === 77, { from });
  ok(!({}).isAdmin && flagCodes('Pirate').includes('bad_packet'), 'paquets malformés / pollution de prototype ignorés et signalés, session intacte');
  const big = await newBot('Gros paquet');
  big.ws.send(JSON.stringify({ t: 'chat', text: 'x'.repeat(10_000) }));
  await big.waitFor(() => false, { timeout: 2000 }).catch(() => {});
  ok(big.closed && big.closeCode === 1009, 'paquet de plus de 8 Ko : connexion fermée (1009)');

  // staff commands by a regular player
  from = C.mark();
  C.send({ t: 'chat', text: '/ban Honnete perm' });
  const unk = await C.waitType('chat', (m) => m.ch === 'system' && m.text.startsWith('Commande inconnue'), { from });
  ok(unk && !sec().accountBan('Honnete'), 'commande MJ par un joueur : « Commande inconnue », rien ne se passe');

  // forbidden names
  const N = await newBot('Noms');
  const names = {};
  for (const n of ['Admin', 'MJ_Officiel', 'Connard']) names[n] = (await N.register(n, PASSWORD, 'mage')).code;
  await sleep(1100);
  names.Honnète = (await N.register('Honnète', PASSWORD, 'mage')).code;
  names.court = (await N.register('Nouveau', 'abc12', 'mage')).code;
  ok(names.Admin === 'bad_name' && names.MJ_Officiel === 'bad_name' && names.Connard === 'bad_name' && names.Honnète === 'name_taken' && names.court === 'bad_password',
    `noms interdits / sosies / mot de passe court refusés (${JSON.stringify(names)})`);

  // brute force
  const B = await newBot('Force brute');
  const answers = [];
  for (let i = 0; i < 10; i++) {
    const r = await B.login('Honnete', `essai${i}`).catch(() => ({ code: 'fermé' }));
    answers.push(r.code);
    if (B.closed) break;
    await sleep(400);
  }
  ok(answers.slice(0, 5).every((c) => c === 'wrong_credentials') && answers.includes('rate_limit') && !answers.includes(undefined),
    `force brute : message générique puis verrouillage (${answers.join(', ')})`);

  // chat flood
  const F = await newBot('Flood');
  ok((await F.register('Bavard', PASSWORD, 'mage')).t === 'auth_ok', 'spammeur connecté');
  for (let i = 0; i < 12; i++) { F.send({ t: 'chat', text: `achetez mes potions ${i}` }); await sleep(20); }
  await sleep(500);
  const muted = server.game.playerByName('Bavard')?.account.muteUntil > Date.now();
  const got = L.history.filter((m) => m.t === 'chat' && m.from === 'Bavard').length;
  ok(muted && got <= 5, `flood de chat : ${got} messages diffusés, spammeur réduit au silence automatiquement`);
  for (let i = 0; i < 200 && !F.closed; i++) F.send({ t: 'ping', c: i });
  await sleep(500);
  ok(F.closed && F.history.some((m) => m.t === 'kick'), 'flood de messages : expulsé');

  // ---------------------------------------------------------------- 3. escalation & admin tools
  from = C.mark();
  for (let i = 0; i < 24 && !C.closed; i++) {
    C.send({ t: 'move', x: 0, z: 150, ry: 0 }); // out of the reachable area, again and again
    await sleep(2600 / 4);
  }
  await sleep(300);
  ok(C.closed && C.history.slice(from).some((m) => m.t === 'kick'), `tricheur persistant expulsé automatiquement (${flagCodes('Tricheur').slice(0, 4).join(', ')}…)`);
  const C2 = await newBot('Tricheur 2');
  ok((await C2.login('Tricheur', PASSWORD)).t === 'auth_ok', 'le tricheur se reconnecte');
  for (let i = 0; i < 24 && !C2.closed; i++) { C2.send({ t: 'move', x: 150, z: 0, ry: 0 }); await sleep(2600 / 4); }
  await sleep(300);
  const autoBan = sec().accountBan('Tricheur');
  ok(C2.closed && autoBan?.auto && /banni temporairement/.test(C2.history.find((m) => m.t === 'kick')?.msg || ''), 'récidive : bannissement temporaire automatique');
  const C3 = await newBot('Tricheur 3');
  const refused = await C3.login('Tricheur', PASSWORD);
  ok(refused.code === 'banned' && /encore/.test(refused.msg), `connexion refusée pendant le bannissement (« ${refused.msg} »)`);

  const A0 = await newBot('Admin');
  ok((await A0.register('Gardien', PASSWORD, 'warrior')).code === 'bad_name', 'un nom de ADMIN_NAMES encore libre ne peut pas être créé');
  sec().cfg.adminNames.length = 0; // the owner creates the account first, then lists it in ADMIN_NAMES
  ok((await A0.register('Gardien', PASSWORD, 'warrior')).t === 'auth_ok', "compte de l'administrateur créé");
  sec().cfg.adminNames.push('gardien');
  await A0.close();
  await sleep(200);
  const A = await newBot('Admin 2');
  ok((await A.login('Gardien', PASSWORD)).t === 'auth_ok', 'administrateur (ADMIN_NAMES) connecté');
  from = A.mark();
  A.send({ t: 'chat', text: '/inspect Tricheur' });
  const insp = await A.waitType('chat', (m) => m.ch === 'system' && m.text.startsWith('Suspicion'), { from });
  await A.waitType('chat', (m) => m.ch === 'system' && m.text.startsWith('IP : 198.51.100.'), { from });
  ok(!!insp, `/inspect : ${insp.text}`);
  from = A.mark();
  A.send({ t: 'chat', text: '/unban Tricheur' });
  await A.waitType('chat', (m) => m.ch === 'system' && m.text.startsWith('Bannissement levé'), { from });
  ok(!sec().accountBan('Tricheur'), '/unban lève le bannissement');
  from = L.mark();
  A.send({ t: 'chat', text: '/kick Honnete test de modération' });
  await L.waitType('kick', () => true, { from });
  ok(L.history.slice(from).some((m) => m.t === 'kick' && /test de modération/.test(m.msg)), '/kick par un administrateur');
  const journal = fs.readFileSync(path.join(dataDir, 'security.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  ok(['flag', 'kick', 'ban', 'gm', 'auth'].every((t) => journal.some((e) => e.type === t)), `journal de sécurité écrit (${journal.length} lignes JSONL)`);
  const bans = JSON.parse(fs.readFileSync(path.join(dataDir, 'bans.json'), 'utf8'));
  ok(bans.version === 1 && Array.isArray(bans.bans) && bans.offenses.tricheur === 1, 'bans.json persisté (récidive comptée)');
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(`[sécurité] ÉCHEC : ${err.stack || err.message}`);
} finally {
  for (const b of bots) await Promise.race([b.close(), sleep(500)]);
  if (server) await server.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  clearTimeout(watchdog);
}
const secs = ((performance.now() - T0) / 1000).toFixed(1);
if (failed) {
  console.error(`[sécurité] ÉCHEC après ${secs} s`);
  process.exit(1);
}
console.log(`[sécurité] SUCCÈS : ${step} vérifications en ${secs} s`);
process.exit(0);
