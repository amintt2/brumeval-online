import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../../shared/collision.js';
import { PLAYER_RADIUS, MOVE_SEND_HZ, STATE } from '../../shared/protocol.js';
import { LAKES, generateWorldObjects } from '../../shared/world.js';
import { mulberry32 } from '../../shared/noise.js';
import { validateMove, maxMoveDistance, MoveValidator } from '../src/movement.js';
import { makeGame, addPlayer, place, advance } from './helpers.js';

const cw = new CollisionWorld();

/** Road-following routes out of the village (no obstacles on roads). */
const ROUTES = {
  east: [[4, 3.5], [20, 6], [45, 18], [70, 28]],
  north: [[-3, 2.5], [-2, -10], [-4, -30], [4, -60], [20, -80]],
  west: [[-3, 2.5], [-30, -2], [-60, -8], [-85, -8]],
  southwest: [[-12, 25], [-30, 50]],
};

/**
 * Simulate a real client walking from (x, z) along `route` at `speed` for at most `seconds`,
 * sending at MOVE_SEND_HZ; the server receives each message after a random network jitter.
 * Returns [{ x, z, arrive }] in arrival order.
 */
function simulateClient(x, z, route, speed, seconds, jitterMs, seed, hz = MOVE_SEND_HZ) {
  const rand = mulberry32(seed);
  const out = [];
  const dt = 1 / hz;
  let wp = 0;
  for (let t = dt; t <= seconds && wp < route.length; t += dt) {
    let budget = speed * dt;
    while (budget > 1e-6 && wp < route.length) {
      const [tx, tz] = route[wp];
      const d = Math.hypot(tx - x, tz - z);
      if (d < 0.05) { wp++; continue; }
      const step = Math.min(budget, d, 0.5);
      const r = cw.move(x, z, x + ((tx - x) / d) * step, z + ((tz - z) / d) * step, PLAYER_RADIUS);
      x = r.x; z = r.z;
      budget -= step;
    }
    out.push({ x: +x.toFixed(2), z: +z.toFixed(2), arrive: t * 1000 + rand() * jitterMs });
  }
  // messages keep their order on a TCP stream: arrival time is monotonic
  for (let i = 1; i < out.length; i++) out[i].arrive = Math.max(out[i].arrive, out[i - 1].arrive);
  return out;
}

/** Server (or network) stalls: messages arriving during a stall are processed together at its end. */
function withStalls(msgs, everyMs, stallMs) {
  return msgs.map((m) => {
    const k = Math.floor(m.arrive / everyMs), start = k * everyMs + everyMs / 2;
    return m.arrive >= start && m.arrive < start + stallMs ? { ...m, arrive: start + stallMs } : m;
  });
}

/** Run messages through the server validator (SPEC rule + window rule). Returns the rejection count. */
function runValidation(msgs, start, speed) {
  const mv = new MoveValidator(start.x, start.z, 0);
  let rejected = 0;
  for (const m of msgs) {
    if (mv.check(m, m.arrive, speed, cw)) rejected++;
    else mv.accept(m, m.arrive, speed);
  }
  return rejected;
}

test('maxMoveDistance follows speed × elapsed × 1.35 + 0.6 with elapsed capped at 1 s', () => {
  assert.equal(maxMoveDistance(6, 0), 0.6);
  assert.ok(Math.abs(maxMoveDistance(6, 500) - (6 * 0.5 * 1.35 + 0.6)) < 1e-9);
  assert.equal(maxMoveDistance(6, 60_000), maxMoveDistance(6, 1000));
  assert.equal(maxMoveDistance(6, -100), 0.6);
});

test('legitimate 15 Hz movement with network jitter is never rejected', () => {
  for (const speed of [6.3, 6.5, 6.8]) {
    for (let seed = 1; seed <= 12; seed++) {
      // long walks out of the village along every road
      for (const [name, route] of Object.entries(ROUTES)) {
        for (const jitter of [40, 180, 400]) {
          const msgs = simulateClient(0, 7, route, speed, 14, jitter, seed * 31 + name.length + jitter);
          assert.ok(msgs.length > 60);
          assert.equal(runValidation(msgs, { x: 0, z: 7 }, speed), 0, `speed ${speed} seed ${seed} jitter ${jitter} → ${name}`);
        }
      }
    }
  }
});

test('bursts after a network stall are accepted', () => {
  const msgs = simulateClient(0, 7, ROUTES.east, 6.8, 6, 0, 1);
  // 1.5 s stall: 22 messages arrive at the same instant
  for (let i = 20; i < 43; i++) msgs[i].arrive = msgs[42].arrive;
  assert.equal(runValidation(msgs, { x: 0, z: 7 }, 6.8), 0);
});

test('low-fps clients (steps > 0.6 m) survive server stalls and message bursts', () => {
  for (const [hz, stall] of [[10, 450], [8, 700], [15, 900], [12, 1000]]) {
    for (const [name, route] of Object.entries(ROUTES)) {
      const msgs = withStalls(simulateClient(0, 7, route, 6.8, 14, 60, hz * 7 + stall, hz), 2500, stall);
      assert.ok(msgs.some((m, i) => i > 0 && m.arrive === msgs[i - 1].arrive), 'bursts present');
      assert.equal(runValidation(msgs, { x: 0, z: 7 }, 6.8), 0, `${hz} Hz, ${stall} ms stalls → ${name}`);
    }
  }
});

test('burst credit is bounded: a teleport after idling is capped at the 1 s allowance', () => {
  const mv = new MoveValidator(50, 25, 0);
  const cap = 6.5 * 1.35 + 0.6;
  assert.equal(mv.check({ x: 50 + cap + 0.1, z: 25 }, 60_000, 6.5, cw), 'too_fast');
  assert.equal(mv.check({ x: 50 + cap - 0.1, z: 25 }, 60_000, 6.5, cw), null);
  // spend the credit, then a second jump right away is refused
  mv.accept({ x: 50 + cap - 0.1, z: 25 }, 60_000, 6.5);
  assert.equal(mv.check({ x: 50 + cap + 1.5, z: 25 }, 60_010, 6.5, cw), 'too_fast');
});

test('speed hacks are rejected', () => {
  // x3 speed: rejected by the per-message SPEC rule
  const fast = simulateClient(0, 7, ROUTES.east, 6.5 * 3, 3, 0, 5);
  assert.ok(runValidation(fast, { x: 0, z: 7 }, 6.5) > fast.length / 2);
  // x1.8 speed passes the per-message slack but not the sliding window
  const sneaky = simulateClient(0, 7, ROUTES.east, 6.5 * 1.8, 5, 0, 5);
  assert.ok(runValidation(sneaky, { x: 0, z: 7 }, 6.5) > sneaky.length / 4);
  assert.equal(validateMove({ x: 50, z: 25 }, { x: 70, z: 25 }, 100, 6.5, cw), 'too_fast');
  // long idle does not allow teleporting (elapsed capped at 1 s)
  assert.equal(validateMove({ x: 50, z: 25 }, { x: 60, z: 25 }, 30_000, 6.5, cw), 'too_fast');
  assert.equal(validateMove({ x: 50, z: 25 }, { x: 58, z: 25 }, 30_000, 6.5, cw), null);
});

test('moves into deep water or out of the world are rejected', () => {
  const lake = LAKES[0];
  assert.equal(validateMove({ x: lake.x, z: lake.z + 0.2 }, { x: lake.x, z: lake.z }, 1000, 6.5, cw), 'unwalkable');
  assert.equal(validateMove({ x: 159.8, z: 0 }, { x: 160.4, z: 0 }, 1000, 6.5, cw), 'unwalkable');
});

test('moves into obstacles are rejected', () => {
  const house = generateWorldObjects().find((o) => o.type === 'house');
  const nearX = house.x + (house.r + 0.3) * 1, nearZ = house.z;
  assert.equal(validateMove({ x: nearX + 0.5, z: nearZ }, { x: house.x + house.r, z: house.z }, 1000, 6.5, cw), 'blocked');
  assert.equal(validateMove({ x: nearX + 1, z: nearZ }, { x: house.x + house.r + PLAYER_RADIUS + 0.05, z: nearZ }, 1000, 6.5, cw), null);
});

test('Game.handleMove: accept, MOVE state for 250 ms, throttled corrections, dead players frozen', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'ranger' });
  const s = p.session;
  place(game, p, 0, 7);
  game.clockRef.t += 66;
  game.handleMessage(p, { t: 'move', x: 0.4, z: 7.2, ry: 1.2 });
  assert.equal(p.x, 0.4);
  assert.equal(p.ry, 1.2);
  assert.equal(p.entState(game.now()).s, STATE.MOVE);
  game.clockRef.t += 300;
  assert.equal(p.entState(game.now()).s, STATE.IDLE);

  // speed hack -> correct, position kept, at most one correction per 250 ms
  game.handleMessage(p, { t: 'move', x: 30, z: 7 });
  game.handleMessage(p, { t: 'move', x: 31, z: 7 });
  assert.equal(p.x, 0.4);
  assert.equal(s.of('correct').length, 1);
  assert.deepEqual(s.last('correct'), { t: 'correct', x: 0.4, z: 7.2 });
  game.clockRef.t += 260;
  game.handleMessage(p, { t: 'move', x: 32, z: 7 });
  assert.equal(s.of('correct').length, 2);

  // malformed coordinates are ignored silently
  game.handleMessage(p, { t: 'move', x: 'a', z: null });
  game.handleMessage(p, { t: 'move', x: Infinity, z: 1 });
  assert.equal(p.x, 0.4);

  // dead players cannot move
  p.dead = true;
  game.clockRef.t += 300;
  game.handleMessage(p, { t: 'move', x: 0.6, z: 7.2 });
  assert.equal(p.x, 0.4);
  assert.equal(s.of('correct').length, 3);
});

test('walking away from an NPC closes its dialog', () => {
  const game = makeGame();
  const p = addPlayer(game);
  const elder = [...game.npcs.values()].find((n) => n.key === 'elder');
  place(game, p, elder.x + 2, elder.z + 1);
  game.handleMessage(p, { t: 'interact', id: elder.id });
  assert.equal(p.session.of('dialog').length, 1);
  // walk 12 m away in legitimate steps
  let x = p.x;
  for (let i = 0; i < 40 && !p.session.of('close_dialog').length; i++) {
    game.clockRef.t += 70;
    x += 0.4;
    game.handleMessage(p, { t: 'move', x, z: p.z });
  }
  assert.equal(p.session.of('close_dialog').length, 1);
  assert.ok(Math.hypot(p.x - elder.x, p.z - elder.z) > 8);
  advance(game, 100);
});
