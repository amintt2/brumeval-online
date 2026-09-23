// Movement anti-cheat through the real Game path (handleMessage -> movement.js -> security.flag):
// realistic jittery clients produce ZERO corrections and ZERO flags; cheats are corrected and flagged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../../shared/collision.js';
import { PLAYER_RADIUS, MOVE_SEND_HZ } from '../../shared/protocol.js';
import { generateWorldObjects, SPAWN_POINT, isWalkable } from '../../shared/world.js';
import { mulberry32 } from '../../shared/noise.js';
import { sweepObstacles, MoveValidator } from '../src/movement.js';
import { makeGame, addPlayer, place } from './helpers.js';

const cw = new CollisionWorld();
const SPRINT = 1.45;
const ROLL_SPEED = 5 / 0.55;

/**
 * Realistic client: renders at `fps` (dt capped at 0.1 s like client/src/game/player.js), moves with
 * CollisionWorld.move in ≤ 0.5 m sub-steps towards random targets, sends `move` at most at MOVE_SEND_HZ,
 * sometimes sprints or rolls (sending `sprint` / `dodge` first, like the combat-souls client). Each message
 * gets a network latency: base + jitter, plus lag spikes of 150–300 ms every few seconds (TCP keeps order,
 * so a spike delays every later message too: they arrive in a burst).
 */
function simulateClient({ x, z, speed, seconds, seed, fps = 60, area = null, sprint = false, roll = false }) {
  const rand = mulberry32(seed);
  const out = []; // { t: send time, kind: 'move'|'sprint'|'dodge', x, z, on }
  let t = 0, lastSend = -1, target = null, sprinting = false, sprintUntil = 0, rollUntil = 0, rollDir = null;
  let nextAction = 1 + rand() * 2;
  const pickTarget = () => {
    if (area) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * area.r;
      return { x: area.x + Math.cos(a) * r, z: area.z + Math.sin(a) * r };
    }
    const a = rand() * Math.PI * 2;
    return { x: x + Math.cos(a) * 25, z: z + Math.sin(a) * 25 };
  };
  while (t < seconds) {
    const frame = (1 / fps) * (rand() < 0.03 ? 4 + rand() * 6 : 0.8 + rand() * 0.4); // occasional hitches
    t += frame;
    const dt = Math.min(frame, 0.1);
    if (!target || Math.hypot(target.x - x, target.z - z) < 0.5 || rand() < 0.002) target = pickTarget();
    if (t > nextAction) {
      nextAction = t + 1.5 + rand() * 3;
      if (roll && rand() < 0.4 && t > rollUntil) {
        const d = Math.hypot(target.x - x, target.z - z) || 1;
        rollDir = { x: (target.x - x) / d, z: (target.z - z) / d };
        rollUntil = t + 0.55;
        out.push({ t, kind: 'dodge' });
      } else if (sprint && !sprinting) {
        sprinting = true;
        sprintUntil = t + 1 + rand() * 3;
        out.push({ t, kind: 'sprint', on: true });
      }
    }
    if (sprinting && t > sprintUntil) {
      sprinting = false;
      out.push({ t, kind: 'sprint', on: false });
    }
    let v = speed * (sprinting ? SPRINT : 1);
    let dir;
    if (t < rollUntil) { v = ROLL_SPEED; dir = rollDir; } else {
      const d = Math.hypot(target.x - x, target.z - z);
      dir = { x: (target.x - x) / d, z: (target.z - z) / d };
    }
    const total = v * dt;
    const steps = Math.max(1, Math.ceil(total / 0.5));
    for (let i = 0; i < steps; i++) {
      const r = cw.move(x, z, x + (dir.x * total) / steps, z + (dir.z * total) / steps, PLAYER_RADIUS);
      x = r.x; z = r.z;
    }
    if (t - lastSend >= 1 / MOVE_SEND_HZ) {
      lastSend = t;
      out.push({ t, kind: 'move', x: +x.toFixed(2), z: +z.toFixed(2) });
    }
  }
  // network: latency 40 ms + jitter 0–80 ms, lag spikes of 150–300 ms every 2–5 s; order preserved
  let spikeAt = 2 + rand() * 3, spikeEnd = -1, spikeLen = 0, prev = 0;
  for (const m of out) {
    if (m.t >= spikeAt) { spikeLen = 0.15 + rand() * 0.15; spikeEnd = m.t + spikeLen; spikeAt = m.t + 2 + rand() * 3; }
    let arrive = m.t + 0.04 + rand() * 0.08;
    if (m.t < spikeEnd) arrive = Math.max(arrive, spikeEnd + 0.04); // held back, then released together
    arrive = Math.max(arrive, prev);
    prev = arrive;
    m.arrive = arrive * 1000;
  }
  return out;
}

/** A player whose allowed speed follows sprint / roll messages like the combat-souls Player.maxSpeedAt. */
function withSpeedModel(p) {
  p.sprintOn = false;
  p.rollUntil = 0;
  p.maxSpeedAt = (now) => (now < p.rollUntil ? ROLL_SPEED : p.stats.speed * (p.sprintOn ? SPRINT : 1));
  return p;
}

/** Replay client messages into the game at their arrival times. */
function replay(game, p, msgs) {
  const t0 = game.clockRef.t;
  for (const m of msgs) {
    game.clockRef.t = t0 + m.arrive;
    if (m.kind === 'sprint') p.sprintOn = m.on;
    else if (m.kind === 'dodge') p.rollUntil = game.now() + 550;
    else game.handleMessage(p, { t: 'move', x: m.x, z: m.z, ry: 0 });
  }
}

test('legit play: jittery clients with lag spikes, bursts, hitches, sprint and rolls → zero corrections, zero flags', () => {
  const scenarios = [];
  for (let seed = 1; seed <= 6; seed++) {
    // open field, village (houses, well, lamp posts, fence ring), goblin camp (tents), graveyard
    scenarios.push({ x: 50, z: 25, area: null, seed });
    scenarios.push({ x: SPAWN_POINT.x, z: SPAWN_POINT.z, area: { x: 0, z: 0, r: 26 }, seed });
    scenarios.push({ x: -92, z: -8, area: { x: -100, z: -8, r: 14 }, seed });
    scenarios.push({ x: 88, z: -80, area: { x: 88, z: -88, r: 12 }, seed });
  }
  let moves = 0;
  for (const sc of scenarios) {
    for (const cls of ['warrior', 'mage', 'ranger']) {
      for (const fps of [60, 20]) {
        const game = makeGame();
        const p = withSpeedModel(addPlayer(game, { cls }));
        place(game, p, sc.x, sc.z);
        game.clockRef.t += 5000; // out of the post-teleport grace: every rejection would be flagged
        const msgs = simulateClient({ x: sc.x, z: sc.z, speed: p.stats.speed, seconds: 12, seed: sc.seed * 97 + fps, fps, area: sc.area, sprint: true, roll: true });
        moves += msgs.length;
        replay(game, p, msgs);
        const label = `${cls} ${fps} fps seed ${sc.seed} (${sc.x}, ${sc.z})`;
        assert.equal(p.session.of('correct').length, 0, `corrections: ${label}`);
        assert.equal(game.security.stats.flags, 0, `flags: ${label} ${JSON.stringify(game.security.flagsOf(p.name))}`);
      }
    }
  }
  assert.ok(moves > 15_000, `${moves} moves replayed`);
});

test('legit play without maxSpeedAt (plain v0.1 speed) is never corrected either', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const game = makeGame();
    const p = addPlayer(game, { cls: 'ranger' });
    place(game, p, 0, 7);
    game.clockRef.t += 5000;
    replay(game, p, simulateClient({ x: 0, z: 7, speed: p.stats.speed, seconds: 15, seed, area: { x: 0, z: 0, r: 30 } }));
    assert.equal(p.session.of('correct').length, 0);
    assert.equal(game.security.stats.flags, 0);
  }
});

test('sliding along any obstacle never looks like walking through it', () => {
  const objs = generateWorldObjects().filter((o) => o.r > 0);
  const rand = mulberry32(7);
  let pairs = 0;
  for (let i = 0; i < 400; i++) {
    const o = objs[Math.floor(rand() * objs.length)];
    const a = rand() * Math.PI * 2;
    let x = o.x + Math.cos(a) * (o.r + 3), z = o.z + Math.sin(a) * (o.r + 3);
    if (cw.penetration(x, z, PLAYER_RADIUS) > 0 || !isWalkable(x, z)) continue;
    // aim slightly off-centre so the client slides around the obstacle
    const off = (rand() - 0.5) * o.r;
    const tx = o.x - Math.cos(a) * (o.r + 3) - Math.sin(a) * off, tz = o.z - Math.sin(a) * (o.r + 3) + Math.cos(a) * off;
    for (const stepLen of [0.3, 0.45, 0.65, 0.94]) {
      let px = x, pz = z;
      for (let k = 0; k < 40; k++) {
        const d = Math.hypot(tx - px, tz - pz);
        if (d < 0.3) break;
        let nx = px, nz = pz;
        const sub = Math.max(1, Math.ceil(stepLen / 0.5));
        for (let s = 0; s < sub; s++) {
          const r = cw.move(nx, nz, nx + ((tx - px) / d) * (stepLen / sub), nz + ((tz - pz) / d) * (stepLen / sub), PLAYER_RADIUS);
          nx = r.x; nz = r.z;
        }
        const from = { x: +px.toFixed(2), z: +pz.toFixed(2) }, to = { x: +nx.toFixed(2), z: +nz.toFixed(2) };
        assert.equal(sweepObstacles(from, to, cw), null, `${o.type} r=${o.r} step ${stepLen}`);
        pairs++;
        px = nx; pz = nz;
      }
    }
  }
  assert.ok(pairs > 5000);
});

test('walking through a house, a lamp post or a rock is detected (segment sweep)', () => {
  const objs = generateWorldObjects();
  for (const type of ['house', 'lamp_post', 'rock_b', 'tree_pine']) {
    const o = objs.find((x) => x.type === type);
    const rho = o.r + PLAYER_RADIUS;
    const a = { x: o.x - rho - 0.05, z: o.z }, b = { x: o.x + rho + 0.05, z: o.z };
    assert.equal(sweepObstacles(a, b, cw), 'wall', type);
  }
});

test('speed hack ×1.6 is corrected, flagged and ends in a kick (client obeying corrections or not)', () => {
  for (const obeys of [true, false]) {
    const game = makeGame();
    const p = addPlayer(game, { cls: 'warrior', name: 'Rapidos' });
    place(game, p, 50, 25);
    game.clockRef.t += 5000;
    const rand = mulberry32(obeys ? 1 : 2);
    let x = 50, z = 25, a = 0, seen = 0;
    for (let i = 0; i < 3000 && !p.session.closed; i++) {
      game.clockRef.t += 66;
      if (i % 30 === 0) a = rand() * Math.PI * 2;
      const step = p.stats.speed * 1.6 * 0.066;
      let tx = x + Math.cos(a) * step, tz = z + Math.sin(a) * step;
      if (Math.abs(tx - 50) > 30 || Math.abs(tz - 25) > 30) { a += Math.PI; tx = x; tz = z; }
      const r = cw.move(x, z, tx, tz, PLAYER_RADIUS);
      x = r.x; z = r.z;
      game.handleMessage(p, { t: 'move', x: +x.toFixed(2), z: +z.toFixed(2) });
      const corr = p.session.of('correct');
      if (obeys && corr.length > seen) { x = corr[corr.length - 1].x; z = corr[corr.length - 1].z; }
      seen = corr.length;
    }
    assert.ok(p.session.of('correct').length > 5, 'corrections sent');
    assert.ok(game.security.flagsOf('Rapidos').some((f) => f.code === 'speed' || f.code === 'teleport'));
    assert.ok(p.session.kicked, `kicked once the suspicion score is high enough (obeys=${obeys})`);
  }
});

test('teleport, out-of-bounds, walking through a house and moving while dead are rejected and flagged', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'ranger', name: 'Fantome' });
  place(game, p, 50, 25);
  game.clockRef.t += 5000;
  game.handleMessage(p, { t: 'move', x: 70, z: 25 });
  assert.equal(p.x, 50);
  assert.equal(game.security.flagsOf('Fantome')[0].code, 'teleport');

  // back in sync, then out of the world
  game.clockRef.t += 5000;
  game.handleMessage(p, { t: 'move', x: 50.3, z: 25 });
  game.clockRef.t += 100;
  game.handleMessage(p, { t: 'move', x: 50.6, z: 25 });
  assert.equal(p.x, 50.6);
  game.clockRef.t += 5000;
  game.handleMessage(p, { t: 'move', x: 50.6, z: 9999 });
  assert.equal(game.security.flagsOf('Fantome')[0].code, 'out_of_bounds');

  // through a house in two big-but-legal steps
  const house = generateWorldObjects().find((o) => o.type === 'house');
  const rho = house.r + PLAYER_RADIUS;
  place(game, p, house.x - rho - 0.1, house.z);
  game.clockRef.t += 5000;
  game.handleMessage(p, { t: 'move', x: house.x - rho + 0.05, z: house.z }); // brushing the wall: fine
  assert.equal(p.session.of('correct').length, 2);
  game.clockRef.t += 5000;
  game.handleMessage(p, { t: 'move', x: house.x + rho + 0.1, z: house.z }); // 8.4 m in one message
  const codes = game.security.flagsOf('Fantome').map((f) => f.code);
  assert.ok(codes[0] === 'teleport' || codes[0] === 'wall', codes.join());
  // small steps straight through the house: the destination is inside it
  place(game, p, house.x - rho - 0.1, house.z);
  game.clockRef.t += 5000;
  game.handleMessage(p, { t: 'move', x: house.x - rho + 0.6, z: house.z });
  assert.equal(game.security.flagsOf('Fantome')[0].code, 'blocked');

  // dead: moves in flight are tolerated, later ones are flagged
  place(game, p, 50, 25);
  p.dead = true;
  game.clockRef.t += 100;
  game.handleMessage(p, { t: 'move', x: 50.4, z: 25 });
  game.clockRef.t += 400;
  game.handleMessage(p, { t: 'move', x: 50.8, z: 25 });
  assert.notEqual(game.security.flagsOf('Fantome')[0].code, 'move_dead');
  game.clockRef.t += 2000;
  game.handleMessage(p, { t: 'move', x: 51.2, z: 25 });
  assert.equal(game.security.flagsOf('Fantome')[0].code, 'move_dead');
  assert.equal(p.x, 50);
});

test('after a server teleport, moves already in flight are corrected without being flagged', () => {
  const game = makeGame();
  const p = addPlayer(game, { name: 'Voyageur' });
  place(game, p, 50, 25);
  game.clockRef.t += 5000;
  game.handleMessage(p, { t: 'move', x: 50.4, z: 25 });
  // GM /tpto: server-side reset to a far place
  place(game, p, -60, -8);
  for (let i = 1; i <= 5; i++) {
    game.clockRef.t += 66;
    game.handleMessage(p, { t: 'move', x: 50.4 + i * 0.4, z: 25 }); // old trajectory, still in flight
  }
  assert.equal(game.security.stats.flags, 0);
  assert.equal(p.x, -60);
  // the client snapped: its next moves start from the new place and are accepted
  game.clockRef.t += 66;
  game.handleMessage(p, { t: 'move', x: -59.6, z: -8 });
  assert.equal(p.x, -59.6);
  // in sync again: a teleport is now flagged
  game.clockRef.t += 66;
  game.handleMessage(p, { t: 'move', x: -30, z: -8 });
  assert.equal(game.security.stats.flags, 1);
});

test('the allowed speed follows player.maxSpeedAt (sprint / roll contract, ROADMAP §4.3)', () => {
  const run = (speedFn, v) => {
    const open = { penetration: () => 0, query: () => [] }; // no obstacles: only the speed matters here
    const mv = new MoveValidator(50, 25, 0);
    let x = 50, dir = 1, rejected = 0;
    for (let t = 66; t <= 15_000; t += 66) {
      if (x > 70) dir = -1;
      else if (x < 30) dir = 1;
      const to = { x: x + dir * v * 0.066, z: 25 };
      if (mv.check(to, t, speedFn(t), open)) rejected++;
      else { mv.accept(to, t, speedFn(t)); x = to.x; }
    }
    return rejected;
  };
  assert.equal(run(() => 6.5 * SPRINT, 6.5 * SPRINT), 0, 'sprinting at the sprint speed');
  assert.ok(run(() => 6.5, 6.5 * SPRINT) > 10, 'sprint speed without sprint allowance');
  assert.ok(run(() => 6.5 * 0.5, 6.5) > 10, 'slowed players cannot walk at full speed');
});
