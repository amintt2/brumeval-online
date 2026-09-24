// [combat-souls] Soulslike combat: telegraph geometry, stamina / dodge / sprint, attack commitment, movement
// allowance, AI variance & determinism, boss phases, poise, guard, dodgeable projectiles, elites, death echo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ABILITIES, MONSTERS, ELITE, monsterXp, xpToNext } from '../../shared/data.js';
import { inTelegraph, STAMINA, ROLL, ROLL_SPEED, regenStamina } from '../../shared/combat.js';
import { damageMonster } from '../src/systems/combat.js';
import { telegraphs } from '../src/systems/telegraph.js';
import { damagePlayer } from '../src/systems/players.js';
import { decide } from '../src/systems/ai/index.js';
import { startAttack } from '../src/systems/ai/actions.js';
import { PLAYER_RADIUS } from '../../shared/protocol.js';
import { migrateCharacter, newCharacter } from '../src/persistence.js';
import { makeGame, addPlayer, place, advance, spawnAt, zoneOf } from './helpers.js';

const r2 = (v) => Math.round(v * 100) / 100;

test('telegraph shapes: circle, ring, cone and line hit tests (with target radius)', () => {
  const circle = { shape: 'circle', x: 10, z: 10, r: 3 };
  assert.ok(inTelegraph(circle, 10, 12.9));
  assert.ok(!inTelegraph(circle, 10, 13.5));
  assert.ok(inTelegraph(circle, 10, 13.4, 0.45), 'target radius counts');

  const ring = { shape: 'ring', x: 0, z: 0, r: 10, r2: 4 };
  assert.ok(!inTelegraph(ring, 0, 2), 'safe inside the inner radius');
  assert.ok(inTelegraph(ring, 7, 0));
  assert.ok(!inTelegraph(ring, 11, 0), 'safe outside');

  // cone facing +X (a = atan2(1, 0) = PI/2), 90° opening
  const cone = { shape: 'cone', x: 0, z: 0, r: 5, a: Math.PI / 2, arc: Math.PI / 2 };
  assert.ok(inTelegraph(cone, 3, 0));
  assert.ok(inTelegraph(cone, 3, 2.5), 'inside the 45° half-angle');
  assert.ok(!inTelegraph(cone, 1, 3), 'outside the opening');
  assert.ok(!inTelegraph(cone, -3, 0), 'behind the apex');
  assert.ok(!inTelegraph(cone, 5.6, 0), 'beyond the radius');
  assert.ok(inTelegraph(cone, 0.1, -0.1), 'standing on the apex');

  // line from the origin towards +Z, 8 m long, 2 m wide
  const line = { shape: 'line', x: 0, z: 0, a: 0, len: 8, w: 2 };
  assert.ok(inTelegraph(line, 0.9, 7.9));
  assert.ok(!inTelegraph(line, 1.2, 4));
  assert.ok(inTelegraph(line, 1.2, 4, 0.45));
  assert.ok(!inTelegraph(line, 0, 8.6));
  assert.ok(!inTelegraph(line, 0, -0.6));
  const diag = { shape: 'line', x: 0, z: 0, a: Math.PI / 4, len: 10, w: 1 };
  assert.ok(inTelegraph(diag, 5, 5));
  assert.ok(!inTelegraph(diag, 5, 3));
});

test('telegraph system: resolved at impact against current positions, i-frames negate, cancel sends tele_end', () => {
  const game = makeGame();
  const m = spawnAt(game, 'slime', 58, 30);
  const a = addPlayer(game), b = addPlayer(game), c = addPlayer(game);
  place(game, a, 58, 32); place(game, b, 59, 30); place(game, c, 57, 29);
  const hits = [];
  const id = telegraphs(game).start(m, { shape: 'circle', x: 58, z: 30, r: 3 }, 600, { ab: 'test', clip: 'Attack2', onHit: (p) => hits.push(p.id) });
  const msg = a.session.last('tele');
  assert.deepEqual(msg, { t: 'tele', id, src: m.id, shape: 'circle', x: 58, z: 30, r: 3, a: 0, ms: 600, ab: 'test', clip: 'Attack2' });
  place(game, b, 70, 30);     // b walks out during the wind-up
  c.iframeUntil = game.now() + 1000; // c rolls through it
  advance(game, 650);
  assert.deepEqual(hits, [a.id]);
  assert.ok(c.session.of('fx', (f) => f.k === 'dodge' && f.tg === c.id).length === 1);

  const id2 = telegraphs(game).start(m, { shape: 'line', x: 58, z: 30, a: 0, len: 6, w: 2 }, 800, { onHit: (p) => hits.push(p.id) });
  assert.ok(telegraphs(game).cancel(id2));
  assert.deepEqual(a.session.last('tele_end'), { t: 'tele_end', id: id2 });
  advance(game, 900);
  assert.deepEqual(hits, [a.id], 'cancelled telegraph never lands');
  assert.equal(telegraphs(game).size, 0);
});

test('dodge roll: validation, stamina cost, cooldown, i-frames, fx roll, recovery cancelled', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'ranger' });
  const other = addPlayer(game);
  place(game, p, 50, 30); place(game, other, 52, 30);
  const s = p.session;
  game.handleMessage(p, { t: 'dodge', dx: 'a', dz: 1 });
  game.handleMessage(p, { t: 'dodge', dx: 0, dz: 0 });
  game.handleMessage(p, { t: 'dodge', dx: 5, dz: 5 });
  assert.deepEqual(s.of('err').map((e) => e.code), ['bad_request', 'bad_request', 'bad_request']);
  assert.equal(p.st, STAMINA.max);

  s.clear();
  p.recoverUntil = game.now() + 500;
  game.handleMessage(p, { t: 'dodge', dx: 0.6, dz: 0.8 });
  assert.equal(s.of('err').length, 0);
  assert.equal(p.st, STAMINA.max - STAMINA.roll);
  assert.equal(s.last('self', (x) => 'st' in x).st, STAMINA.max - STAMINA.roll);
  assert.equal(p.recoverUntil, 0, 'a roll cancels the attack recovery');
  const now = game.now();
  assert.equal(p.iframeUntil, now + ROLL.iframeMs);
  assert.equal(p.rollUntil, now + ROLL.ms);
  assert.deepEqual(other.session.last('fx', (f) => f.k === 'roll'), { t: 'fx', k: 'roll', src: p.id, dx: 0.6, dz: 0.8, ms: 550 });
  assert.ok(p.maxSpeedAt(now + 100) >= ROLL_SPEED);

  game.handleMessage(p, { t: 'dodge', dx: 1, dz: 0 });
  assert.equal(s.last('err').code, 'cooldown');
  advance(game, ROLL.cdMs);
  game.handleMessage(p, { t: 'dodge', dx: 1, dz: 0 });
  game.handleMessage(p, { t: 'dodge', dx: 1, dz: 0 });
  advance(game, ROLL.cdMs);
  p.st = 10;
  game.handleMessage(p, { t: 'dodge', dx: 1, dz: 0 });
  assert.deepEqual(s.last('err'), { t: 'err', code: 'no_stamina', msg: 'Pas assez d\'endurance' });
});

test('stamina: regenerates after the delay, sprint drains while moving and speeds up, exhaustion', () => {
  assert.equal(regenStamina(50, 100, 500, 1000), 50, 'no regen during the delay');
  assert.equal(regenStamina(50, 100, 1800, 1000), 50 + STAMINA.regen);
  const game = makeGame();
  const p = addPlayer(game, { cls: 'warrior' });
  place(game, p, 50, 30);
  const base = p.stats.speed;
  assert.equal(p.maxSpeedAt(game.now()), base);
  game.handleMessage(p, { t: 'sprint', on: true });
  assert.equal(p.maxSpeedAt(game.now()), base * STAMINA.sprintMult);
  // standing still: no drain
  advance(game, 500);
  assert.equal(p.st, STAMINA.max);
  // moving: drains STAMINA.sprintPerS per second
  let x = 50;
  for (let i = 0; i < 20; i++) {
    x += base * STAMINA.sprintMult * 0.05 * 0.95;
    game.clockRef.t += 50;
    game.handleMessage(p, { t: 'move', x, z: 30 });
    game.tick();
  }
  assert.equal(p.session.of('correct').length, 0, 'sprint speed accepted');
  assert.ok(Math.abs(p.st - (STAMINA.max - STAMINA.sprintPerS)) < 2, `drain ≈ ${STAMINA.sprintPerS}/s (${p.st})`);
  // exhaustion
  p.st = 0.5;
  game.clockRef.t += 50;
  game.handleMessage(p, { t: 'move', x: x + 0.3, z: 30 });
  game.tick();
  assert.equal(p.exhausted, true);
  advance(game, STAMINA.sprintGraceMs + 100);
  assert.equal(p.maxSpeedAt(game.now()), base, 'no more sprint when exhausted');
  advance(game, STAMINA.regenDelayMs + 400);
  assert.ok(p.st >= STAMINA.sprintMin && !p.exhausted);
  game.handleMessage(p, { t: 'sprint', on: false });
  assert.equal(p.maxSpeedAt(game.now() + 1000), base);
});

test('movement allowance: a roll burst is accepted, roll speed without rolling is corrected, recovery slows', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'mage' });
  place(game, p, 50, 30);
  advance(game, 1500);
  const rollMoves = (x0) => {
    let x = x0;
    const step = ROLL.dist / (ROLL.ms / 1000) / 15; // 15 Hz messages
    for (let t = 0; t < ROLL.ms; t += 1000 / 15) {
      x += step;
      game.clockRef.t += 1000 / 15;
      game.handleMessage(p, { t: 'move', x: r2(x), z: 30 });
      if (t % 50 < 1000 / 15) game.tick();
    }
    return x;
  };
  // walk at full speed first so that no burst credit is left, then burst
  const walk = (x0, ms) => {
    let x = x0;
    for (let t = 0; t < ms; t += 50) {
      x += p.stats.speed * 0.05 * 0.97;
      game.clockRef.t += 50;
      game.handleMessage(p, { t: 'move', x: r2(x), z: 30 });
      game.tick();
    }
    return x;
  };
  // without rolling, moving at roll speed for a while is a speed hack (the anticheat budget absorbs
  // ~1.5 s of lag bursts, so the hack has to last a few seconds to be corrected)
  let xh = walk(50, 2000);
  for (let i = 0; i < 12; i++) xh = rollMoves(xh);
  assert.ok(p.session.of('correct').length > 0, 'roll speed without roll corrected');
  place(game, p, 50, 30);
  advance(game, 3500);
  p.session.clear();
  const x1 = walk(50, 2000);
  assert.equal(p.session.of('correct').length, 0);
  game.handleMessage(p, { t: 'dodge', dx: 1, dz: 0 });
  const x2 = rollMoves(x1);
  walk(x2, 1000);
  assert.equal(p.session.of('correct').length, 0, 'dodge roll produces no correction');
  assert.ok(p.x > x1 + 4.5 + p.stats.speed * 0.9);

  // attack commitment: during the recovery the allowance drops to recSlow × speed
  const now = game.now();
  p.recoverUntil = now + 500; p.recoverSlow = 0.3;
  assert.equal(p.maxSpeedAt(now), p.stats.speed * 0.3);
  assert.equal(p.maxSpeedAt(now + 600), p.stats.speed);
});

test('attack commitment: abilities cost stamina, slow the caster, ranged auto-attacks wait for the player to slow down', () => {
  const game = makeGame();
  const r = addPlayer(game, { cls: 'ranger' });
  const m = spawnAt(game, 'slime', 58, 30);
  m.hp = m.mhp = 1e6; m.speed = 0; m.atkReady = Infinity;
  place(game, r, 58, 40);
  game.handleMessage(r, { t: 'ability', slot: 1, tg: m.id });
  const ab = ABILITIES.piercing_shot;
  assert.equal(r.st, STAMINA.max - ab.st);
  assert.equal(r.recoverUntil, game.now() + ab.rec * 1000);
  assert.equal(r.maxSpeedAt(game.now()), r.stats.speed * ab.recSlow);
  r.st = 3;
  advance(game, 7000);
  r.st = 3; r.stSpentAt = game.now();
  game.handleMessage(r, { t: 'ability', slot: 1, tg: m.id });
  assert.equal(r.session.last('err').code, 'no_stamina');

  // running full speed: the auto-attack holds its fire
  r.st = 100;
  r.session.clear();
  game.handleMessage(r, { t: 'stop' });
  let z = 40;
  for (let i = 0; i < 6; i++) {
    z += 0.45;
    game.clockRef.t += 66;
    game.handleMessage(r, { t: 'move', x: 58, z });
    game.tick();
  }
  game.handleMessage(r, { t: 'ability', slot: 0, tg: m.id });
  assert.equal(r.session.last('err').code, 'moving');
  assert.equal(r.autoTarget, m.id);
  assert.equal(r.session.of('fx', (f) => f.k === 'proj' && f.src === r.id).length, 0);
  advance(game, 600); // stops moving → the shot goes off
  assert.equal(r.session.of('fx', (f) => f.k === 'proj' && f.src === r.id).length, 1);
});

/** Action trace of a monster fighting a sturdy dummy for `ms`. */
function trace(seed, ms = 12_000) {
  const game = makeGame({ seed: 3 });
  const zone = zoneOf('wolf');
  const m = spawnAt(game, 'wolf', zone.x, zone.z, { seed });
  const p = addPlayer(game, { cls: 'warrior', level: 6 });
  p.hp = p.mhp = 1e7;
  place(game, p, zone.x + 6, zone.z);
  damageMonster(game, m, p, 1, false);
  const out = [];
  let last = '';
  for (let t = 0; t < ms; t += 50) {
    advance(game, 50);
    const k = m.act ? (m.act.kind === 'attack' ? m.act.atk.id : m.act.kind) : '-';
    if (k !== last) { out.push(k); last = k; }
  }
  return { out, temper: m.temper };
}

test('AI: deterministic for a seed, different individuals behave differently', () => {
  const a1 = trace(1234), a2 = trace(1234), b = trace(98765);
  assert.deepEqual(a1.out, a2.out, 'same seed → same behaviour');
  assert.notDeepEqual(a1.out, b.out, 'different seed → different behaviour');
  assert.notDeepEqual(a1.temper, b.temper);
  for (const t of [a1.temper, b.temper]) {
    assert.ok(t.reactMs >= 150 && t.reactMs <= 600);
    assert.ok(t.aggression >= 0.2 && t.aggression <= 1 && (t.strafeSide === 1 || t.strafeSide === -1));
  }
  // variety: a wolf fighting for 12 s uses several kinds of actions
  const kinds = new Set(a1.out);
  assert.ok(kinds.has('wolf_bite'), 'bites');
  assert.ok(kinds.size >= 4, `varied actions: ${[...kinds].join(', ')}`);
  // the utility choice stays within the legal options
  const game = makeGame();
  const zone = zoneOf('goblin');
  const g = spawnAt(game, 'goblin', zone.x, zone.z, { variant: 'thrower' });
  const p = addPlayer(game);
  place(game, p, zone.x + 12, zone.z);
  g.ai = 'chase'; g.target = p.id; g.atkReady = 0;
  const picks = new Set();
  for (let i = 0; i < 40; i++) { g.act = null; g.cds = {}; picks.add(decide(game, g, p, game.now())); }
  assert.ok(picks.has('attack') && !picks.has('flee'), [...picks].join(','));
});

test('variants and elites: thrower goblins, elite stats, nameplate fields', () => {
  const game = makeGame();
  const zone = zoneOf('goblin');
  const t = spawnAt(game, 'goblin', zone.x, zone.z, { variant: 'thrower' });
  assert.equal(t.name, 'Gobelin lanceur');
  assert.equal(t.brain.arch, 'ranged');
  assert.equal(t.staticState().vr, 'thrower');
  const plain = spawnAt(game, 'goblin', zone.x, zone.z, { variant: 'skirmisher', seed: 5 });
  const elite = spawnAt(game, 'goblin', zone.x, zone.z, { variant: 'skirmisher', elite: true, seed: 5 });
  assert.equal(elite.name, `${ELITE.prefix} · Gobelin`);
  assert.equal(elite.mhp, Math.round(elite.base.mhp * ELITE.hp));
  assert.equal(elite.atk, Math.round(elite.base.atk * ELITE.atk));
  assert.equal(plain.mhp, plain.base.mhp);
  assert.equal(elite.staticState().el, 1);
  assert.equal(plain.staticState().el, undefined);
  // elite kill: XP × ELITE.xp
  const p = addPlayer(game, { level: 6 });
  place(game, p, zone.x + 2, zone.z);
  damageMonster(game, elite, p, 1e6, false);
  const xp = Math.round(monsterXp('goblin', elite.level, 6) * ELITE.xp);
  assert.ok(p.session.notes('xp').includes(`+${xp} XP`));
  // the variant mix follows the chances (60 % / 40 %)
  let throwers = 0;
  for (let i = 0; i < 400; i++) {
    const g = game.spawnMonster(zone);
    if (g.variant === 'thrower') throwers++;
    game.removeEntity(g);
  }
  assert.ok(throwers > 120 && throwers < 200, `throwers ${throwers}/400`);
});

test('goblin spears are dodgeable projectiles resolved at the landing point', () => {
  const game = makeGame();
  const zone = zoneOf('goblin');
  const g = spawnAt(game, 'goblin', zone.x, zone.z, { variant: 'thrower' });
  g.speed = 0;
  g.brain.attacks = g.brain.attacks.filter((a) => a.kind === 'proj');
  const stay = addPlayer(game, { cls: 'warrior' });
  stay.hp = stay.mhp = 1e6;
  place(game, stay, zone.x + 10, zone.z);
  damageMonster(game, g, stay, 1, false);
  let proj = null;
  for (let i = 0; i < 100 && !proj; i++) { advance(game, 50); proj = stay.session.last('fx', (f) => f.k === 'proj' && f.src === g.id); }
  assert.ok(proj && proj.tg === undefined && Number.isFinite(proj.x) && proj.ab === 'goblin_spear');
  advance(game, proj.ms + 100);
  assert.equal(stay.session.of('dmg', (d) => d.src === g.id).length, 1, 'standing still: hit');
  // next spear: step aside while it flies
  stay.session.clear();
  proj = null;
  for (let i = 0; i < 100 && !proj; i++) { advance(game, 50); proj = stay.session.last('fx', (f) => f.k === 'proj' && f.src === g.id); }
  place(game, stay, stay.x, stay.z + 3);
  advance(game, proj.ms + 100);
  assert.equal(stay.session.of('dmg', (d) => d.src === g.id).length, 0, 'moved away: missed');
});

test('poise: heavy hits stagger a monster and cancel its telegraph; skeleton guard absorbs frontal hits', () => {
  const game = makeGame();
  const zone = zoneOf('slime');
  const m = spawnAt(game, 'slime', zone.x, zone.z);
  m.hp = m.mhp = 1e5;
  const w = addPlayer(game, { cls: 'warrior', level: 5 });
  place(game, w, zone.x + 4, zone.z);
  damageMonster(game, m, w, 1, false);
  advance(game, 600);
  // force a telegraphed leap, then break its poise during the wind-up
  const slam = m.brain.attacks.find((a) => a.id === 'slime_slam');
  m.act = null; m.cds = {}; m.atkReady = 0;
  m.brain.attacks = [slam];
  let tele = null;
  for (let i = 0; i < 80 && !tele; i++) { advance(game, 50); tele = w.session.last('tele', (t) => t.src === m.id); }
  assert.ok(tele);
  damageMonster(game, m, w, 10, false, 'heavy_blow'); // poise 42 > 16
  assert.equal(m.act.kind, 'stagger');
  assert.ok(w.session.of('fx', (f) => f.k === 'stagger' && f.src === m.id).length === 1);
  assert.deepEqual(w.session.last('tele_end'), { t: 'tele_end', id: tele.id });
  advance(game, tele.ms + 200);
  assert.equal(w.session.of('dmg', (d) => d.ab === 'slime_slam').length, 0, 'no slam after the stagger');

  // guard
  const sz = zoneOf('skeleton');
  const sk = spawnAt(game, 'skeleton', sz.x, sz.z, { variant: 'brute' });
  sk.hp = sk.mhp = 1e5;
  sk.ry = 0; // faces +Z
  const front = addPlayer(game), back = addPlayer(game);
  place(game, front, sz.x, sz.z + 2); place(game, back, sz.x, sz.z - 2);
  sk.ai = 'chase'; sk.act = { kind: 'pause', until: Infinity };
  const hp0 = sk.hp;
  damageMonster(game, sk, front, 100, false);
  assert.equal(hp0 - sk.hp, 100 * (1 - MONSTERS.skeleton.ai.guard.reduce));
  assert.ok(front.session.of('fx', (f) => f.k === 'guard').length >= 1);
  const hp1 = sk.hp;
  damageMonster(game, sk, back, 100, false);
  assert.equal(hp1 - sk.hp, 100, 'no guard from behind');
});

test('golem boss: phases unlock attacks, enrage at 30 %, leash resets', () => {
  const game = makeGame();
  const zone = zoneOf('golem');
  const golem = spawnAt(game, 'golem', zone.x, zone.z);
  const p = addPlayer(game, { cls: 'warrior', level: 14 });
  p.hp = p.mhp = 1e7;
  place(game, p, zone.x + 8, zone.z);
  damageMonster(game, golem, p, 1, false);
  advance(game, 200);
  assert.equal(golem.phase, 1);
  const unlocked = () => golem.brain.attacks.filter((a) => !a.phase || golem.phase >= a.phase).map((a) => a.id);
  assert.ok(!unlocked().includes('golem_rock'));
  damageMonster(game, golem, p, golem.mhp * 0.4, false);
  advance(game, 100);
  assert.equal(golem.phase, 2);
  assert.equal(golem.act.kind, 'phase');
  assert.deepEqual(p.session.last('fx', (f) => f.k === 'phase'), { t: 'fx', k: 'phase', src: golem.id, ph: 2, ms: 1900 });
  assert.ok(unlocked().includes('golem_rock') && !golem.enraged);
  assert.ok(p.session.notes('error').some((t) => t.includes('Golem ancien')));
  damageMonster(game, golem, p, golem.mhp * 0.35, false);
  advance(game, 100);
  assert.equal(golem.phase, 3);
  assert.ok(golem.enraged && unlocked().includes('golem_quake'));
  // phase 3 fights: telegraphs keep coming, rock lines are 'line' shapes
  golem.act = null;
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    advance(game, 50);
    for (const t of p.session.of('tele', (x) => x.src === golem.id)) seen.add(`${t.ab}:${t.shape}`);
    if (golem.hp < golem.mhp * 0.1) golem.hp = golem.mhp * 0.2;
  }
  assert.ok(seen.size >= 2, [...seen].join(' '));
  // leash: full heal, back to phase 1
  place(game, p, zone.x + 60, zone.z);
  for (let i = 0; i < 200 && golem.ai === 'chase'; i++) advance(game, 50);
  assert.equal(golem.ai, 'return');
  assert.equal(golem.phase, 1);
  assert.equal(golem.enraged, false);
  assert.equal(golem.hp, golem.mhp);
});

test('death echo: XP dropped at the death spot, owner-only entity, recovered by walking over it, lost on a second death', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'warrior', level: 3, xp: 120 });
  const other = addPlayer(game);
  place(game, p, 60, 30); place(game, other, 62, 30);
  advance(game, 100);
  const m = spawnAt(game, 'slime', 60, 28);
  m.atkReady = Infinity; m.speed = 0;
  p.hp = 1;
  damagePlayer(game, p, m, 50, false);
  assert.ok(p.dead);
  assert.equal(p.xp, 0);
  assert.deepEqual(p.echo, { x: 60, z: 30, xp: 120 });
  assert.deepEqual(p.account.echo, { x: 60, z: 30, xp: 120 });
  assert.ok(p.session.notes('info').some((t) => t.includes('120 XP')));
  advance(game, 100);
  const seenBy = (pl) => pl.session.of('snap').some((s) => s.ents.some((e) => e.k === 'echo'));
  assert.ok(seenBy(p), 'owner sees its echo');
  assert.ok(!seenBy(other), 'other players never see it');
  game.flushSelf(p);
  assert.deepEqual(p.session.last('self', (x) => 'echo' in x).echo, { x: 60, z: 30, xp: 120 });

  // respawn in the village, walk back and pick it up
  game.handleMessage(p, { t: 'respawn' });
  place(game, p, 60.5, 30.5);
  advance(game, 100);
  assert.equal(p.echo, null);
  assert.equal(p.xp, 120);
  assert.equal(p.account.echo, null);
  assert.ok(p.session.of('fx', (f) => f.k === 'echo' && f.v === 120).length === 1);
  assert.ok(p.session.of('snap').some((s) => s.gone.length > 0));

  // die twice: the first echo is lost
  p.hp = 1;
  damagePlayer(game, p, m, 50, false);
  game.handleMessage(p, { t: 'respawn' });
  place(game, p, 50, 40);
  p.xp = 30;
  p.hp = 1;
  damagePlayer(game, p, m, 50, false);
  assert.deepEqual(p.echo, { x: 50, z: 40, xp: 30 });
  assert.ok(p.session.notes('error').some((t) => t.includes('dissipé') && t.includes('120 XP')));
  assert.equal([...game.entities.values()].filter((e) => e.kind === 'echo').length, 1);

  // persistence: sanitised, restored on login
  assert.deepEqual(migrateCharacter({ ...newCharacter('Echo', 'mage'), echo: { x: 50, z: 40, xp: 30 } }).echo, { x: 50, z: 40, xp: 30 });
  assert.equal(migrateCharacter({ ...newCharacter('Echo', 'mage'), echo: { x: 'a', z: 1, xp: 3 } }).echo, null);
  assert.equal(migrateCharacter({ ...newCharacter('Echo', 'mage'), echo: undefined }).echo, null);
  const acc = p.account;
  game.removePlayer(p);
  assert.equal([...game.entities.values()].filter((e) => e.kind === 'echo').length, 0);
  const s2 = { msgs: [], send() {}, sendRaw() {} };
  const p2 = game.addPlayer(acc, s2);
  assert.deepEqual(p2.echo, { x: 50, z: 40, xp: 30 });
  assert.equal([...game.entities.values()].filter((e) => e.kind === 'echo' && e.ownerId === p2.id).length, 1);
  assert.equal(p2.selfState().echo.xp, 30);
  assert.equal(p2.selfState().mst, STAMINA.max);
  assert.ok(xpToNext(3) > 120);
});

test('leaps and charges arrive WITH the hit (no ghost hit from 5 m); bodies never overlap the player', () => {
  for (const [type, ab] of [['slime', 'slime_slam'], ['wolf', 'wolf_lunge']]) {
    for (let seed = 1; seed <= 4; seed++) {
      const game = makeGame({ seed });
      const z = zoneOf(type);
      const p = addPlayer(game, { cls: 'warrior', level: 30 });
      place(game, p, z.x, z.z);
      const m = spawnAt(game, type, z.x + 5, z.z);
      damageMonster(game, m, p, 1, false);
      advance(game, 800);
      m.x = z.x + 5; m.z = z.z; m.act = null;
      place(game, p, z.x, z.z);
      const atk = m.brain.attacks.find((a) => a.id === ab);
      m.brain.attacks = [atk];
      startAttack(game, m, atk, p, game.now());
      const contact = m.radius + PLAYER_RADIUS;
      let hitD = null, minD = Infinity;
      for (let i = 0; i < 40; i++) {
        advance(game, 50);
        p.hp = p.mhp;
        const d = Math.hypot(m.x - p.x, m.z - p.z);
        minD = Math.min(minD, d);
        if (hitD === null && p.session.of('dmg', (x) => x.ab === ab).length) hitD = d;
      }
      assert.ok(hitD !== null, `${ab} hit`);
      assert.ok(hitD <= contact + 0.3, `${ab} seed ${seed}: body at ${hitD.toFixed(2)} m at the hit`);
      assert.ok(minD >= contact - 0.1, `${ab} seed ${seed}: overlapped the player (${minD.toFixed(2)} m)`);
    }
  }
});
