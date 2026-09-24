// [netcode-perf] Field-level snapshot deltas: a client merging snapshots field by field always ends up with
// exactly the server state (quantised), whatever moves, fights, dies or crosses the AOI border.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEW_RADIUS, STATE } from '../../shared/protocol.js';
import { QPOS, QANG, FULL_EVERY, SNAP_SKIP_BYTES } from '../src/snapshot.js';
import { damageMonster } from '../src/systems/combat.js';
import { makeGame, addPlayer, place, advance, spawnAt } from './helpers.js';

const q = (v, step) => Math.round(v / step) * step;
const near = (a, b, step) => Math.abs(a - b) <= step / 2 + 1e-9;

/** Client-side store fed by snapshots, merging every field (what client/src/state.js does). */
function mirror(session) {
  const ents = new Map();
  let read = 0;
  return {
    ents,
    pump() {
      for (; read < session.msgs.length; read++) {
        const m = session.msgs[read];
        if (m.t !== 'snap') continue;
        for (const e of m.ents) {
          const cur = ents.get(e.id);
          if (cur) Object.assign(cur, e);
          else ents.set(e.id, { ...e });
        }
        for (const id of m.gone) ents.delete(id);
      }
    },
  };
}

function assertMirrors(game, p, view, label) {
  view.pump();
  const now = game.now();
  for (const e of game.entities.values()) {
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (e !== p && d > VIEW_RADIUS) continue; // inside the hysteresis band either answer is fine
    const got = view.ents.get(e.id);
    assert.ok(got, `${label}: entity ${e.id} (${e.kind}) at ${d.toFixed(1)} m is known`);
    const st = e.entState(now);
    assert.ok(near(got.x, st.x, QPOS) && near(got.z, st.z, QPOS), `${label}: position of ${e.id}`);
    assert.ok(near(got.ry, st.ry, QANG), `${label}: ry of ${e.id}`);
    for (const k of ['hp', 'mhp', 's', 'tg', 'sl']) {
      if (st[k] !== undefined) assert.equal(got[k], st[k], `${label}: ${k} of ${e.id}`);
    }
    const stat = e.staticState();
    for (const k of Object.keys(stat)) assert.equal(got[k], stat[k], `${label}: static ${k} of ${e.id}`);
  }
  for (const id of view.ents.keys()) {
    const e = game.entities.get(id);
    assert.ok(e, `${label}: entity ${id} removed on the server is gone on the client`);
    assert.ok(Math.hypot(e.x - p.x, e.z - p.z) <= VIEW_RADIUS + 5 + 1e-6, `${label}: ${id} is inside the AOI`);
  }
}

test('merged deltas always equal the server state (random walk, fights, deaths, AOI in/out)', () => {
  const game = makeGame({ spawnMonsters: true, seed: 7 });
  const rng = (() => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); })();
  const players = [];
  for (let i = 0; i < 6; i++) {
    const p = addPlayer(game, { name: `Miroir${i}`, cls: ['warrior', 'mage', 'ranger'][i % 3] });
    place(game, p, 40 + i * 3, 20 + i);
    players.push(p);
  }
  const views = players.map((p) => mirror(p.session));
  for (let step = 0; step < 240; step++) {
    for (const p of players) {
      // mostly small steps, sometimes a long jump (in and out of each other's AOI)
      if (rng() < 0.03) place(game, p, -120 + rng() * 240, -120 + rng() * 240);
      else place(game, p, p.x + (rng() - 0.5) * 1.2, p.z + (rng() - 0.5) * 1.2);
      p.ry = rng() * 6 - 3;
      if (rng() < 0.1) p.hp = Math.max(1, p.hp - 5);
    }
    if (step % 7 === 0) {
      const m = [...game.monsters.values()].find((x) => !x.dead);
      if (m) damageMonster(game, m, players[step % players.length], 1 + Math.floor(rng() * 40), false);
    }
    advance(game, 50);
    if (game.tickCount % 2 === 0) players.forEach((p, i) => assertMirrors(game, p, views[i], `pas ${step} joueur ${i}`));
  }
});

test('unchanged entities are omitted, changed fields only, full refresh every FULL_EVERY rounds', () => {
  const game = makeGame();
  const a = addPlayer(game, { name: 'Obs' });
  const b = addPlayer(game, { name: 'Cible' });
  place(game, a, 0, 7);
  place(game, b, 3, 7);
  advance(game, 100);
  a.session.clear();
  let rounds = 0, withB = 0;
  for (let i = 0; i < FULL_EVERY * 2; i++) {
    advance(game, 100);
    rounds++;
    const snap = a.session.last('snap');
    const eb = snap.ents.find((e) => e.id === b.id);
    if (eb) {
      withB++;
      assert.deepEqual(Object.keys(eb).sort(), ['ac', 'hp', 'id', 'mhp', 'ry', 's', 'tg', 'x', 'z'], 'periodic refresh is whole');
    }
  }
  assert.equal(rounds, FULL_EVERY * 2);
  assert.equal(withB, 2, 'an idle entity is only re-sent by the periodic refresh');

  // quantisation: a 1 cm move is not worth a byte, a 10 cm one is
  a.session.clear();
  place(game, b, 3.01, 7);
  advance(game, 100);
  if ((game.snapState.round + b.id) % FULL_EVERY !== 0) assert.equal(a.session.last('snap').ents.find((e) => e.id === b.id), undefined);
  place(game, b, 3.1, 7);
  advance(game, 100);
  assert.equal(a.session.last('snap').ents.find((e) => e.id === b.id)?.x, q(3.1, QPOS));
});

test('deaths are delivered by delta (s and hp), then gone after the corpse time', () => {
  const game = makeGame();
  const p = addPlayer(game, { name: 'Chasseur' });
  place(game, p, 58, 34);
  const m = spawnAt(game, 'slime', 58, 30);
  advance(game, 100);
  damageMonster(game, m, p, 1e6, false);
  advance(game, 100);
  const e = p.session.last('snap').ents.find((x) => x.id === m.id);
  assert.equal(e.s, STATE.DEAD);
  assert.equal(e.hp, 0);
  advance(game, 4500);
  assert.ok(p.session.of('snap').some((s) => s.gone.includes(m.id)));
});

test('entities may restrict who sees them (visibleTo)', () => {
  const game = makeGame();
  const a = addPlayer(game, { name: 'Proprio' });
  const b = addPlayer(game, { name: 'Autre' });
  place(game, a, 0, 7);
  place(game, b, 1, 7);
  const secret = spawnAt(game, 'slime', 2, 9);
  secret.visibleTo = (viewer) => viewer === a;
  advance(game, 100);
  assert.ok(a.session.of('snap').some((s) => s.ents.some((e) => e.id === secret.id)));
  assert.ok(!b.session.of('snap').some((s) => s.ents.some((e) => e.id === secret.id)));
});

test('entState fields added by other features are delta-encoded too', () => {
  const game = makeGame();
  const a = addPlayer(game, { name: 'Voyeur' });
  const b = addPlayer(game, { name: 'Sprinteur' });
  place(game, a, 0, 7);
  place(game, b, 2, 7);
  const base = b.entState.bind(b);
  let st = 100;
  b.entState = (now) => ({ ...base(now), st, buffs: ['rage'] });
  advance(game, 100);
  let eb = a.session.last('snap').ents.find((e) => e.id === b.id);
  assert.equal(eb.st, 100);
  assert.deepEqual(eb.buffs, ['rage']);
  st = 70;
  advance(game, 100);
  eb = a.session.last('snap').ents.find((e) => e.id === b.id);
  assert.deepEqual(Object.keys(eb).sort(), ['id', 'st'], 'objects compared by value, only the stamina changed');
});

test('a congested client skips snapshot rounds, then catches up with full states (no broken delta chain)', () => {
  const game = makeGame({ spawnMonsters: true, seed: 3 });
  const a = addPlayer(game, { name: 'Lent' });
  const b = addPlayer(game, { name: 'Rapide' });
  place(game, a, 40, 20);
  place(game, b, 44, 22);
  const view = mirror(a.session);
  advance(game, 500);
  assertMirrors(game, a, view, 'avant');
  // the socket of A is backed up: no snapshot is queued for it, B is served normally
  a.session.ws = { bufferedAmount: SNAP_SKIP_BYTES + 1 };
  const snapsA = a.session.of('snap').length, snapsB = b.session.of('snap').length;
  const skipped0 = game.snapState.skipped;
  for (let i = 0; i < 10; i++) {
    place(game, b, b.x + 0.7, b.z);
    b.hp = Math.max(1, b.hp - 3);
    advance(game, 100);
  }
  place(game, b, 200, 200); // B leaves A's area of interest while A is congested (gone must follow)
  advance(game, 100);
  assert.equal(a.session.of('snap').length, snapsA, 'no snapshot for the congested client');
  assert.ok(b.session.of('snap').length > snapsB, 'other clients still get theirs');
  assert.ok(game.snapState.skipped > skipped0, 'skipped rounds are counted (/health)');
  // drained: the next round brings A back to the exact server state
  a.session.ws.bufferedAmount = 0;
  advance(game, 100);
  assertMirrors(game, a, view, 'après congestion');
  assert.ok(a.session.last('snap').gone.includes(b.id), 'B is reported gone');
  for (let i = 0; i < 20; i++) {
    advance(game, 100);
    assertMirrors(game, a, view, `reprise ${i}`);
  }
});
