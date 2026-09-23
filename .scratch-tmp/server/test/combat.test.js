import test from 'node:test';
import assert from 'node:assert/strict';
import { ABILITIES, MONSTERS, xpToNext, MAX_LEVEL, monsterXp, REGEN } from '../../shared/data.js';
import { SPAWN_POINT, VILLAGE } from '../../shared/world.js';
import { CORPSE_TIME_S } from '../../shared/protocol.js';
import { damageMonster } from '../src/systems/combat.js';
import { grantXp } from '../src/systems/players.js';
import { makeGame, addPlayer, place, advance, spawnAt, zoneOf, constRng } from './helpers.js';

const errCodes = (s) => s.of('err').map((m) => m.code);

test('ability validation: slot, target, safe zone, range, mana, cooldown, dead', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'warrior' });
  const s = p.session;
  const m = spawnAt(game, 'slime', 58, 30);
  const npc = [...game.npcs.values()][0];
  place(game, p, 58, 34.5);

  game.handleMessage(p, { t: 'ability', slot: 7, tg: m.id });
  game.handleMessage(p, { t: 'ability', slot: 1.5, tg: m.id });
  game.handleMessage(p, { t: 'ability', slot: '1', tg: m.id });
  game.handleMessage(p, { t: 'ability', slot: 1 });
  game.handleMessage(p, { t: 'ability', slot: 1, tg: 999999 });
  game.handleMessage(p, { t: 'ability', slot: 1, tg: -3 });
  game.handleMessage(p, { t: 'ability', slot: 1, tg: npc.id });
  game.handleMessage(p, { t: 'ability', slot: 1, tg: m.id }); // 4.5 m > 2.8 + 0.5
  assert.deepEqual(errCodes(s), ['bad_request', 'bad_request', 'bad_request', 'no_target', 'no_target', 'bad_request', 'bad_target', 'out_of_range']);
  assert.equal(s.last('err').msg, 'Cible hors de portée');
  assert.equal(p.mp, p.mmp);

  s.clear();
  place(game, p, 0, 7);
  game.handleMessage(p, { t: 'ability', slot: 1, tg: m.id });
  assert.deepEqual(s.last('err'), { t: 'err', code: 'safe_zone', msg: 'Impossible de combattre dans le village' });

  s.clear();
  place(game, p, 58, 32.5);
  const mp0 = p.mp;
  game.handleMessage(p, { t: 'ability', slot: 1, tg: m.id });
  assert.deepEqual(s.of('err'), []);
  assert.deepEqual(s.last('cd'), { t: 'cd', slot: 1, ms: ABILITIES.heavy_blow.cd * 1000 });
  assert.equal(p.mp, mp0 - ABILITIES.heavy_blow.mp);
  assert.ok(s.last('fx', (f) => f.k === 'swing' && f.src === p.id && f.tg === m.id && f.ab === 'heavy_blow'));
  const dmg = s.last('dmg');
  assert.equal(dmg.src, p.id);
  assert.equal(dmg.tg, m.id);
  assert.ok(dmg.v > 0 && typeof dmg.crit === 'boolean' && dmg.hp === Math.max(0, Math.ceil(m.hp)));
  assert.ok(s.last('self', (x) => 'mp' in x), 'mana sent in self');

  game.handleMessage(p, { t: 'ability', slot: 1, tg: m.id });
  assert.equal(s.last('err').code, 'cooldown');

  p.mp = 5;
  game.handleMessage(p, { t: 'ability', slot: 2 });
  assert.deepEqual(s.last('err'), { t: 'err', code: 'no_mana', msg: 'Pas assez de mana' });

  p.dead = true;
  game.handleMessage(p, { t: 'ability', slot: 0, tg: m.id });
  assert.equal(s.last('err').code, 'dead');
});

test('slot 0 auto-attack keeps swinging until stop / target death; cooldown presses are silent', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'warrior' });
  const s = p.session;
  const m = spawnAt(game, 'slime', 58, 30);
  m.hp = m.mhp = 10_000; // survives for a while
  place(game, p, 58, 32);
  game.handleMessage(p, { t: 'ability', slot: 0, tg: m.id });
  assert.equal(p.autoTarget, m.id);
  game.handleMessage(p, { t: 'ability', slot: 0, tg: m.id }); // on cooldown: no error
  assert.deepEqual(s.of('err'), []);
  const swings = () => s.of('fx', (f) => f.k === 'swing' && f.src === p.id).length;
  assert.equal(swings(), 1);
  advance(game, 1450);
  assert.equal(swings(), 2);
  advance(game, 1400);
  assert.equal(swings(), 3);
  // snapshot shows the auto target
  assert.equal(p.entState(game.now()).tg, m.id);

  game.handleMessage(p, { t: 'stop' });
  assert.equal(p.autoTarget, 0);
  advance(game, 3000);
  assert.equal(swings(), 3);

  // restart and kill
  m.hp = 5;
  game.handleMessage(p, { t: 'ability', slot: 0, tg: m.id });
  advance(game, 100);
  assert.ok(m.dead);
  assert.equal(p.autoTarget, 0);
});

test('out-of-range slot 0 sets the auto target and swings once in range', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'warrior' });
  const m = spawnAt(game, 'slime', 58, 30);
  place(game, p, 58, 40);
  game.handleMessage(p, { t: 'ability', slot: 0, tg: m.id });
  assert.equal(p.session.last('err').code, 'out_of_range');
  assert.equal(p.autoTarget, m.id);
  advance(game, 100);
  assert.equal(p.session.of('fx', (f) => f.k === 'swing').length, 0);
  place(game, p, 58, 32);
  advance(game, 100);
  assert.equal(p.session.of('fx', (f) => f.k === 'swing' && f.src === p.id).length, 1);
});

test('projectiles land after dist/speed and only if the target is still alive; multi-hit volleys', () => {
  const game = makeGame();
  const mage = addPlayer(game, { cls: 'mage' });
  const s = mage.session;
  const m = spawnAt(game, 'slime', 58, 30);
  m.hp = m.mhp = 5000;
  place(game, mage, 58, 41);
  game.handleMessage(mage, { t: 'ability', slot: 0, tg: m.id });
  assert.ok(s.last('fx', (f) => f.k === 'cast' && f.ab === 'firebolt'));
  const proj = s.last('fx', (f) => f.k === 'proj');
  assert.equal(proj.ms, Math.round((11 / ABILITIES.firebolt.speed) * 1000));
  assert.equal(proj.tg, m.id);
  assert.equal(s.of('dmg').length, 0);
  advance(game, proj.ms - 60);
  assert.equal(s.of('dmg').length, 0);
  advance(game, 100);
  assert.equal(s.of('dmg').length, 1);

  // target dies while the projectile flies: no damage applied
  game.handleMessage(mage, { t: 'stop' });
  advance(game, 2000);
  s.clear();
  game.handleMessage(mage, { t: 'ability', slot: 1, tg: m.id });
  const other = addPlayer(game, { cls: 'warrior' });
  place(game, other, 58, 31);
  damageMonster(game, m, other, 99999, false, 'strike');
  assert.ok(m.dead);
  advance(game, 1500);
  assert.equal(s.of('dmg', (d) => d.src === mage.id).length, 0);

  // ranger rapid fire: 3 arrows 250 ms apart
  const r = addPlayer(game, { cls: 'ranger' });
  const m2 = spawnAt(game, 'slime', 60, 30);
  m2.hp = m2.mhp = 5000;
  place(game, r, 60, 40);
  game.handleMessage(r, { t: 'ability', slot: 3, tg: m2.id });
  advance(game, 1000);
  assert.equal(r.session.of('fx', (f) => f.k === 'proj' && f.ab === 'rapid_fire').length, 3);
  assert.equal(r.session.of('dmg', (d) => d.src === r.id && d.ab === 'rapid_fire').length, 3);
  assert.equal(r.session.of('cd', (c) => c.slot === 3).length, 1);
});

test('area abilities: whirlwind radius, frost nova slow, arrow rain ground target', () => {
  const game = makeGame();
  const w = addPlayer(game, { cls: 'warrior' });
  const near1 = spawnAt(game, 'slime', 50, 30);
  const near2 = spawnAt(game, 'slime', 53, 30);
  const far = spawnAt(game, 'slime', 60, 30);
  for (const m of [near1, near2, far]) m.hp = m.mhp = 5000;
  place(game, w, 50, 32);
  game.handleMessage(w, { t: 'ability', slot: 2 });
  const aoe = w.session.last('fx', (f) => f.k === 'aoe');
  assert.deepEqual({ x: aoe.x, z: aoe.z, r: aoe.r, ab: aoe.ab }, { x: 50, z: 32, r: ABILITIES.whirlwind.radius, ab: 'whirlwind' });
  const hit = new Set(w.session.of('dmg').map((d) => d.tg));
  assert.ok(hit.has(near1.id) && hit.has(near2.id) && !hit.has(far.id));

  const mage = addPlayer(game, { cls: 'mage' });
  place(game, mage, 58, 31);
  game.handleMessage(mage, { t: 'ability', slot: 2 });
  assert.ok(far.slowUntil > game.now());
  assert.equal(far.entState(game.now()).sl, 1);
  advance(game, ABILITIES.frost_nova.slow.dur * 1000 + 100);
  assert.equal(far.entState(game.now()).sl, 0);

  const ranger = addPlayer(game, { cls: 'ranger' });
  place(game, ranger, 40, 30);
  game.handleMessage(ranger, { t: 'ability', slot: 2 });
  assert.equal(ranger.session.last('err').code, 'no_target');
  game.handleMessage(ranger, { t: 'ability', slot: 2, x: 70, z: 30 });
  assert.equal(ranger.session.last('err').code, 'out_of_range');
  ranger.session.clear();
  game.handleMessage(ranger, { t: 'ability', slot: 2, x: 51.5, z: 30 });
  const rain = ranger.session.last('fx', (f) => f.k === 'aoe');
  assert.equal(rain.ab, 'arrow_rain');
  const rainHits = new Set(ranger.session.of('dmg', (d) => d.src === ranger.id).map((d) => d.tg));
  assert.ok(rainHits.has(near1.id) && rainHits.has(near2.id) && !rainHits.has(far.id));
});

test('self heal abilities restore a share of max hp', () => {
  const game = makeGame();
  const w = addPlayer(game, { cls: 'warrior' });
  place(game, w, 50, 30);
  w.hp = 10;
  game.handleMessage(w, { t: 'ability', slot: 3 });
  const heal = w.session.last('heal');
  assert.equal(heal.tg, w.id);
  assert.equal(heal.v, Math.round(w.mhp * ABILITIES.war_cry.heal));
  assert.equal(w.hp, 10 + heal.v);
  assert.ok(w.session.last('fx', (f) => f.k === 'heal' && f.ab === 'war_cry'));
  assert.equal(w.session.last('self', (x) => 'hp' in x).hp, w.hpShown());
});

test('monster death: XP to all damagers, gold & drops to the top damager, quest credit, corpse, respawn with a new id', () => {
  const game = makeGame({ rng: constRng(0) }); // min gold, every drop succeeds
  const a = addPlayer(game, { cls: 'warrior', quests: { q_slimes: { state: 'active', n: 2 } } });
  const b = addPlayer(game, { cls: 'mage', quests: { q_slimes: { state: 'active', n: 7 } } });
  const c = addPlayer(game, { cls: 'ranger' }); // spectator, no damage
  const m = spawnAt(game, 'slime', 58, 30);
  for (const p of [a, b, c]) place(game, p, 58, 33);
  advance(game, 100); // everyone knows the slime (snapshot)
  const countBefore = game.monsters.size;
  damageMonster(game, m, b, 5, false, 'firebolt');
  damageMonster(game, m, a, 20, false, 'strike');
  damageMonster(game, m, b, 99999, false, 'firebolt'); // b is now the top damage dealer and lands the kill
  assert.ok(m.dead);

  const death = a.session.last('death');
  assert.deepEqual(death, { t: 'death', id: m.id, by: b.id });
  const xpA = monsterXp('slime', m.level, a.level);
  assert.ok(a.session.notes('xp').includes(`+${xpA} XP`));
  assert.ok(b.session.notes('xp').length === 1);
  assert.equal(c.session.notes('xp').length, 0);
  // loot to b only
  assert.equal(a.session.notes('gold').length, 0);
  assert.deepEqual(b.session.notes('gold'), [`+${MONSTERS.slime.gold[0]} pièce d'or`]);
  assert.ok(b.session.notes('loot').includes('Vous avez obtenu : Gelée de gluant'));
  // quest credit for every damager with the quest active
  assert.deepEqual(a.session.notes('quest'), ['Gluants éliminés : 3/8']);
  assert.deepEqual(b.session.notes('quest'), ['Gluants éliminés : 8/8', 'Objectif accompli : Nuisance gluante — retournez voir Ancien Aldric.']);
  assert.deepEqual(b.quests.q_slimes, { state: 'ready', n: 8 });
  advance(game, 60);
  assert.deepEqual(b.session.last('self', (x) => 'quests' in x).quests.q_slimes, { state: 'ready', n: 8 });

  // corpse stays CORPSE_TIME_S, then gone
  assert.ok(game.entities.has(m.id));
  advance(game, CORPSE_TIME_S * 1000 + 150);
  assert.ok(!game.entities.has(m.id));
  assert.ok(a.session.of('snap').some((sn) => sn.gone.includes(m.id)));
  assert.equal(game.monsters.size, countBefore - 1);
  // respawn as a NEW entity
  const maxIdBefore = game.nextId;
  advance(game, (MONSTERS.slime.respawn - CORPSE_TIME_S) * 1000 + 200);
  assert.equal(game.monsters.size, countBefore);
  const newest = [...game.monsters.values()].find((x) => x.id >= maxIdBefore);
  assert.ok(newest && newest.type === 'slime' && newest.id !== m.id && !newest.dead);
});

test('loot that does not fit is lost with a notify', () => {
  const game = makeGame({ rng: constRng(0) });
  const inv = new Array(24).fill(null).map(() => ({ id: 'steel_sword', q: 1 }));
  const p = addPlayer(game, { cls: 'warrior', inv });
  const m = spawnAt(game, 'slime', 58, 30);
  place(game, p, 58, 32);
  damageMonster(game, m, p, 99999, false);
  assert.ok(p.session.notes('error').some((t) => t.startsWith('Inventaire plein — objet perdu : Gelée de gluant')));
  assert.equal(p.inv.filter((s) => s.id !== 'steel_sword').length, 0);
});

test('XP: several level-ups at once, level-up effects, max level stops XP', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'mage', name: 'Lumière' });
  const other = addPlayer(game, { cls: 'warrior' });
  place(game, p, 50, 30);
  place(game, other, 52, 30);
  advance(game, 100);
  const ver = p.staticVer;
  p.hp = 10; p.mp = 3;
  grantXp(game, p, xpToNext(1) + xpToNext(2) + xpToNext(3) + 5);
  assert.equal(p.level, 4);
  assert.equal(p.xp, 5);
  assert.equal(p.hp, p.mhp);
  assert.equal(p.mp, p.mmp);
  assert.equal(p.staticVer, ver + 1);
  assert.ok(p.session.notes('level').includes('Niveau 4 atteint !'));
  assert.ok(other.session.of('chat').some((c) => c.ch === 'system' && c.text === 'Lumière a atteint le niveau 4 !'));
  assert.ok(other.session.of('fx').some((f) => f.k === 'level' && f.src === p.id));
  game.flushSelf(p);
  const self = p.session.last('self');
  assert.equal(self.level, 4);
  assert.equal(self.xpNext, xpToNext(4));
  // other clients get the static fields again (lv changed)
  other.session.clear();
  advance(game, 100);
  const ent = other.session.last('snap').ents.find((e) => e.id === p.id);
  assert.equal(ent.lv, 4);
  assert.equal(ent.n, 'Lumière');

  p.level = MAX_LEVEL; p.xp = 0;
  p.session.clear();
  grantXp(game, p, 10_000);
  assert.equal(p.xp, 0);
  assert.equal(p.session.notes('xp').length, 0);
});

test('AI: aggressive monsters aggro, chase, attack; passive ones do not', () => {
  const game = makeGame();
  const zone = zoneOf('wolf');
  const wolf = spawnAt(game, 'wolf', zone.x, zone.z);
  const slime = spawnAt(game, 'slime', 58, 30);
  const p = addPlayer(game, { cls: 'warrior' });
  const q = addPlayer(game, { cls: 'warrior' });
  place(game, p, zone.x + 8, zone.z);
  place(game, q, 59.5, 30);
  advance(game, 100);
  assert.equal(wolf.ai, 'chase');
  assert.equal(wolf.target, p.id);
  assert.equal(slime.ai, 'idle');
  advance(game, 3000);
  assert.ok(Math.hypot(wolf.x - p.x, wolf.z - p.z) <= MONSTERS.wolf.range);
  assert.ok(p.session.of('dmg', (d) => d.src === wolf.id && d.tg === p.id).length >= 1);
  assert.ok(p.hp < p.mhp);
  assert.equal(slime.ai, 'idle');
  assert.equal(q.hp, q.mhp);
});

test('AI: threat picks the top damage dealer', () => {
  const game = makeGame();
  const m = spawnAt(game, 'slime', 58, 30);
  const a = addPlayer(game);
  const b = addPlayer(game);
  place(game, a, 58, 32);
  place(game, b, 60, 30);
  m.hp = m.mhp = 5000;
  damageMonster(game, m, a, 10, false);
  advance(game, 60);
  assert.equal(m.target, a.id);
  damageMonster(game, m, b, 50, false);
  advance(game, 60);
  assert.equal(m.target, b.id);
});

test('AI: leash when too far from the zone, full heal and invulnerable while returning', () => {
  const game = makeGame();
  const zone = zoneOf('wolf');
  const wolf = spawnAt(game, 'wolf', zone.x, zone.z);
  const p = addPlayer(game, { cls: 'ranger' });
  place(game, p, zone.x + 6, zone.z);
  damageMonster(game, wolf, p, 20, false);
  assert.equal(wolf.ai, 'chase');
  // the player runs far away east; the wolf follows until the leash distance
  place(game, p, zone.x + zone.r + 40, zone.z);
  p.hp = 1e9; p.mhp = 1e9;
  for (let i = 0; i < 400 && wolf.ai === 'chase'; i++) advance(game, 50);
  assert.equal(wolf.ai, 'return');
  assert.equal(wolf.hp, wolf.mhp);
  assert.equal(wolf.threat.size, 0);
  assert.equal(damageMonster(game, wolf, p, 10, false), false, 'invulnerable while returning');
  for (let i = 0; i < 600 && wolf.ai === 'return'; i++) advance(game, 50);
  assert.equal(wolf.ai, 'idle');
  assert.ok(Math.hypot(wolf.x - wolf.homeX, wolf.z - wolf.homeZ) < 0.5);
});

test('AI: monsters leash when their target enters the village and never enter it', () => {
  const game = makeGame();
  const m = spawnAt(game, 'slime', 36, 8); // just outside the east village gate
  m.homeX = 58; m.homeZ = 30;
  const p = addPlayer(game);
  place(game, p, 34, 8);
  damageMonster(game, m, p, 1, false);
  assert.equal(m.ai, 'chase');
  place(game, p, VILLAGE.r - 3, 6);
  advance(game, 100);
  assert.equal(m.ai, 'return');

  // a chasing monster stops at the village border
  const m2 = spawnAt(game, 'slime', 40, 8);
  m2.hp = m2.mhp = 1e6;
  const r = addPlayer(game, { cls: 'ranger' });
  place(game, r, 31.5, 8); // outside the village circle, but close
  damageMonster(game, m2, r, 1, false);
  for (let i = 0; i < 100; i++) {
    advance(game, 50);
    assert.ok(Math.hypot(m2.x, m2.z) > VILLAGE.r, 'monster entered the village');
  }
});

test('player death blocks actions; respawn restores hp/mp at the spawn point', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'mage' });
  const m = spawnAt(game, 'slime', 58, 30);
  place(game, p, 58, 31.2);
  damageMonster(game, m, p, 1, false);
  p.hp = 1;
  advance(game, 2500);
  assert.ok(p.dead);
  assert.deepEqual(p.session.last('death'), { t: 'death', id: p.id, by: m.id });
  assert.ok(p.session.of('self').some((x) => x.dead === true && x.hp === 0));
  assert.equal(p.entState(game.now()).s, 2);
  // the monster gives up (target dead): leashes home with full hp
  advance(game, 100);
  assert.notEqual(m.ai, 'chase');
  assert.equal(m.target, 0);
  assert.equal(m.hp, m.mhp);

  game.handleMessage(p, { t: 'ability', slot: 0, tg: m.id });
  assert.equal(p.session.last('err').code, 'dead');
  game.handleMessage(p, { t: 'use_item', slot: 0 });
  assert.equal(p.session.last('err').code, 'dead');

  p.session.clear();
  game.handleMessage(p, { t: 'respawn' });
  assert.equal(p.dead, false);
  assert.equal(p.hp, p.mhp);
  assert.equal(p.mp, p.mmp);
  assert.deepEqual([p.x, p.z], [SPAWN_POINT.x, SPAWN_POINT.z]);
  assert.deepEqual(p.session.last('correct'), { t: 'correct', x: SPAWN_POINT.x, z: SPAWN_POINT.z });
  const self = p.session.last('self');
  assert.equal(self.dead, false);
  assert.equal(self.hp, p.mhp);
  // respawn while alive is ignored
  p.session.clear();
  game.handleMessage(p, { t: 'respawn' });
  assert.equal(p.session.msgs.length, 0);
});

test('golem slam hits every player within its radius periodically', () => {
  const game = makeGame();
  const zone = zoneOf('golem');
  const golem = spawnAt(game, 'golem', zone.x, zone.z);
  const near = addPlayer(game, { cls: 'warrior' });
  const edge = addPlayer(game, { cls: 'mage' });
  const far = addPlayer(game, { cls: 'ranger' });
  for (const p of [near, edge, far]) { p.mhp = p.hp = 1e7; }
  place(game, near, zone.x + 2, zone.z);
  place(game, edge, zone.x, zone.z + 5.5);
  place(game, far, zone.x - 12, zone.z);
  damageMonster(game, golem, far, 1, false); // aggro onto the far player (golem walks towards it)
  golem.speed = 0; // keep the geometry fixed for the test
  advance(game, MONSTERS.golem.slam.cd * 1000 + 100);
  const slams = near.session.of('fx', (f) => f.k === 'aoe' && f.src === golem.id && f.ab === 'slam');
  assert.equal(slams.length, 1);
  assert.equal(slams[0].r, MONSTERS.golem.slam.radius);
  assert.ok(near.session.of('dmg', (d) => d.tg === near.id && d.ab === 'slam').length === 1);
  assert.ok(edge.session.of('dmg', (d) => d.tg === edge.id && d.ab === 'slam').length === 1);
  assert.equal(far.session.of('dmg', (d) => d.tg === far.id && d.ab === 'slam').length, 0);
  assert.equal(golem.staticState().b, 1);
});

test('regen: fast out of combat, slow in combat', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'warrior' });
  place(game, p, 50, 30);
  p.hp = 50; p.mp = 0;
  advance(game, 1000);
  assert.ok(Math.abs(p.hp - (50 + p.mhp * REGEN.hpRest)) < 0.01);
  assert.ok(Math.abs(p.mp - p.mmp * REGEN.mpRest) < 0.01);
  assert.equal(p.session.last('self', (x) => 'hp' in x).hp, Math.ceil(p.hp));
  const m = spawnAt(game, 'slime', 50, 32);
  m.hp = m.mhp = 1e6;
  damageMonster(game, m, p, 1, false);
  m.speed = 0; m.atkReady = Infinity;
  const hp0 = p.hp;
  advance(game, 1000);
  assert.ok(Math.abs(p.hp - (hp0 + p.mhp * REGEN.hpCombat)) < 0.01);
});
