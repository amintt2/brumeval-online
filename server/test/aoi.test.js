// [netcode-perf] Spatial grid queries, monster sleep, tick profiler, proxy-aware client IP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Aoi, aoiOf, CELL, SLEEP_EVERY, WAKE_RADIUS } from '../src/aoi.js';
import { monstersInRadius } from '../src/systems/combat.js';
import { TickProfiler, attachPerf, WARN_P95_MS } from '../src/perf.js';
import { clientIp, trustedHops } from '../src/proxy.js';
import { makeGame, addPlayer, place, advance, spawnAt, zoneOf } from './helpers.js';

test('grid queries return exactly the brute-force answer, after moves, spawns and removals', () => {
  const game = makeGame({ spawnMonsters: true, seed: 3 });
  const players = [];
  for (let i = 0; i < 20; i++) {
    const p = addPlayer(game, { name: `Grille${i}` });
    place(game, p, -150 + Math.random() * 300, -150 + Math.random() * 300);
    players.push(p);
  }
  const aoi = aoiOf(game);
  for (let round = 0; round < 30; round++) {
    for (const e of game.entities.values()) {
      if (Math.random() < 0.3) { e.x += (Math.random() - 0.5) * 70; e.z += (Math.random() - 0.5) * 70; }
    }
    if (round === 10) game.removePlayer(players.pop());
    if (round === 20) spawnAt(game, 'wolf', 0, -90);
    const x = -150 + Math.random() * 300, z = -150 + Math.random() * 300, r = 5 + Math.random() * 90;
    const got = aoi.playersNear(x, z, r).map((p) => p.id).sort((a, b) => a - b);
    const want = [...game.players.values()].filter((p) => Math.hypot(p.x - x, p.z - z) <= r).map((p) => p.id).sort((a, b) => a - b);
    assert.deepEqual(got, want, `players near (${x.toFixed(0)}, ${z.toFixed(0)}) r=${r.toFixed(0)}`);
    const gotM = monstersInRadius(game, x, z, r).map((m) => m.id);
    const wantM = [...game.monsters.values()].filter((m) => !m.dead && !m.invulnerable && Math.hypot(m.x - x, m.z - z) <= r + m.radius).map((m) => m.id);
    assert.deepEqual(gotM, wantM, 'monstersInRadius: same monsters, same (spawn) order');
    const cand = new Set(aoi.query(x, z, r, [], 'all').map((e) => e.id));
    for (const e of game.entities.values()) {
      if (Math.hypot(e.x - x, e.z - z) <= r) assert.ok(cand.has(e.id), `candidate ${e.id} present`);
    }
  }
  assert.ok(aoi.cells.size > 1);
  assert.equal(aoi.tracked.size, game.entities.size);
});

test('monsters far from every player sleep (low tick rate) and wake up when a player comes near', () => {
  const game = makeGame({ seed: 5 });
  const zone = zoneOf('golem');
  const m = spawnAt(game, 'golem', zone.x, zone.z);
  m.aiUntil = 0; // wants to wander right away
  const p = addPlayer(game, { name: 'Réveil' });
  place(game, p, 0, 7); // village: ~180 m from the golem lair
  assert.ok(Math.hypot(m.x - p.x, m.z - p.z) > WAKE_RADIUS + CELL * 1.5);

  const aoi = aoiOf(game);
  aoi.beginTick();
  const steps = [];
  for (let i = 0; i < SLEEP_EVERY * 3; i++) {
    game.tickCount++;
    steps.push(aoi.monsterStep(m, 0.05));
  }
  assert.equal(steps.filter((s) => s > 0).length, 3, 'one AI turn every SLEEP_EVERY ticks');
  assert.ok(steps.filter((s) => s > 0).every((s) => Math.abs(s - 0.05 * SLEEP_EVERY) < 1e-9), 'with a proportional dt');

  // asleep, it still wanders (slowly updated) inside its zone
  const x0 = m.x, z0 = m.z;
  advance(game, 3000);
  assert.ok(m.ai === 'wander' || m.ai === 'idle');
  assert.ok(Math.hypot(m.x - x0, m.z - z0) > 0.1 || m.ai === 'idle');
  assert.ok(aoi.stats.asleep >= 1);

  // a player nearby: full rate again, and it aggroes as before
  place(game, p, m.x + 3, m.z);
  advance(game, 50);
  assert.equal(aoi.monsterStep(m, 0.05), 0.05);
  assert.equal(m.ai, 'chase');
  assert.equal(m.target, p.id);
});

test('fighting monsters never sleep', () => {
  const game = makeGame();
  const zone = zoneOf('wolf');
  const m = spawnAt(game, 'wolf', zone.x, zone.z);
  const aoi = aoiOf(game);
  aoi.beginTick();
  m.ai = 'chase';
  m.target = 1;
  for (let i = 0; i < SLEEP_EVERY; i++) {
    game.tickCount++;
    assert.equal(aoi.monsterStep(m, 0.05), 0.05);
  }
  m.ai = 'return';
  m.target = 0;
  assert.equal(aoi.monsterStep(m, 0.05), 0.05);
});

test('Aoi works on a bare game object (no Game needed) and handles negative coordinates', () => {
  const entities = new Map();
  const game = { entities, players: new Map(), tickCount: 0 };
  const aoi = new Aoi(game);
  const mk = (id, x, z) => ({ id, x, z, kind: 'monster', radius: 0.5 });
  entities.set(1, mk(1, -0.1, -0.1));
  entities.set(2, mk(2, 0.1, 0.1));
  entities.set(3, mk(3, -500, 700));
  assert.deepEqual(aoi.monstersNear(0, 0, 1).map((e) => e.id).sort(), [1, 2]);
  assert.deepEqual(aoi.monstersNear(-500, 700, 2).map((e) => e.id), [3]);
  entities.delete(1);
  assert.deepEqual(aoi.monstersNear(0, 0, 1).map((e) => e.id), [2]);
});

test('tick profiler: percentiles, phases, budget warning', () => {
  const prof = new TickProfiler({ window: 100 });
  for (let i = 1; i <= 100; i++) prof.record(i / 10); // 0.1 … 10 ms
  const p = prof.percentiles();
  assert.equal(p.samples, 100);
  assert.ok(Math.abs(p.p50 - 5.1) < 1e-9 && Math.abs(p.p95 - 9.6) < 1e-9 && Math.abs(p.p99 - 10) < 1e-9, JSON.stringify(p));
  const warnings = [];
  const log = { warn: (m) => warnings.push(m) };
  assert.equal(prof.check(log), false);
  for (let i = 0; i < 100; i++) prof.record(WARN_P95_MS + 5);
  prof.phase('snapshot', 30);
  assert.equal(prof.check(log, 1e9), true);
  assert.match(warnings[0], /tick lent : p95/);
  assert.match(warnings[0], /snapshot/);
  assert.equal(prof.check(log, 1e9 + 1000), false, 'at most one warning per minute');

  const game = makeGame();
  const perf = attachPerf(game);
  assert.equal(attachPerf(game), perf, 'idempotent');
  advance(game, 500);
  const s = perf.snapshot();
  assert.equal(s.samples, 10);
  assert.equal(s.phases.ai.calls, 10);
  assert.equal(s.phases.snapshot.calls, 5, 'snapshots every other tick');
  assert.ok(s.phases.ai.msPerTick >= 0 && s.p95 >= s.p50);
});

test('client IP: socket address unless TRUST_PROXY says how many proxies to trust', () => {
  const req = (xff, addr = '::ffff:10.0.0.2', real) => ({ socket: { remoteAddress: addr }, headers: { 'x-forwarded-for': xff, 'x-real-ip': real } });
  assert.equal(trustedHops(undefined), 0);
  assert.equal(trustedHops('0'), 0);
  assert.equal(trustedHops('false'), 0);
  assert.equal(trustedHops('true'), 1);
  assert.equal(trustedHops('2'), 2);
  assert.equal(clientIp(req('1.2.3.4'), 0), '10.0.0.2', 'X-Forwarded-For ignored without TRUST_PROXY (forgeable)');
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4'), 1), '1.2.3.4', 'last hop appended by the trusted proxy');
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4, 10.0.0.9'), 2), '1.2.3.4');
  assert.equal(clientIp(req(undefined, '::ffff:10.0.0.2', '5.6.7.8'), 1), '5.6.7.8', 'X-Real-IP fallback');
  assert.equal(clientIp(req(undefined), 1), '10.0.0.2');
});
