import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTS } from '../../shared/data.js';
import {
  questStatus, dialogQuests, acceptQuest, recordKill, checkTurnIn, completeQuest, rewardItems, sanitizeQuests, killLabel,
} from '../src/quests.js';

test('quest chain availability follows requirements and level', () => {
  const pq = {};
  assert.equal(questStatus(pq, 'q_slimes', 1), 'available');
  assert.equal(questStatus(pq, 'q_wolves', 5), 'locked'); // requires q_slimes
  pq.q_slimes = { state: 'done', n: 8 };
  assert.equal(questStatus(pq, 'q_wolves', 2), 'locked'); // level 3 required
  assert.equal(questStatus(pq, 'q_wolves', 3), 'available');
  assert.equal(questStatus(pq, 'nope', 20), 'locked');
});

test('dialogQuests lists available/active/ready and omits done & locked', () => {
  const pq = {};
  assert.deepEqual(dialogQuests(pq, 1, 'elder'), [{ q: 'q_slimes', state: 'available', n: 0 }]);
  pq.q_slimes = { state: 'active', n: 3 };
  assert.deepEqual(dialogQuests(pq, 1, 'elder'), [{ q: 'q_slimes', state: 'active', n: 3 }]);
  pq.q_slimes = { state: 'ready', n: 8 };
  assert.deepEqual(dialogQuests(pq, 1, 'elder'), [{ q: 'q_slimes', state: 'ready', n: 8 }]);
  pq.q_slimes = { state: 'done', n: 8 };
  assert.deepEqual(dialogQuests(pq, 2, 'elder'), []);
  assert.deepEqual(dialogQuests(pq, 3, 'elder'), [{ q: 'q_wolves', state: 'available', n: 0 }]);
  assert.deepEqual(dialogQuests(pq, 20, 'merchant'), []);
  assert.deepEqual(dialogQuests(pq, 20, '__proto__'), []);
});

test('acceptQuest validates giver, status and level', () => {
  const pq = {};
  assert.match(acceptQuest(pq, 1, 'merchant', 'q_slimes'), /proposée/);
  assert.match(acceptQuest(pq, 1, 'elder', 'q_wolves'), /précédente/);
  assert.equal(acceptQuest(pq, 1, 'elder', 'q_slimes'), null);
  assert.deepEqual(pq.q_slimes, { state: 'active', n: 0 });
  assert.match(acceptQuest(pq, 1, 'elder', 'q_slimes'), /déjà/);
  pq.q_slimes = { state: 'done', n: 8 };
  assert.match(acceptQuest(pq, 2, 'elder', 'q_wolves'), /Niveau 3/);
});

test('recordKill progresses matching active quests and flags ready', () => {
  const pq = { q_slimes: { state: 'active', n: 6 } };
  assert.deepEqual(recordKill(pq, 'wolf'), []);
  assert.deepEqual(recordKill(pq, 'slime'), [{ qid: 'q_slimes', n: 7, count: 8, ready: false }]);
  assert.deepEqual(recordKill(pq, 'slime'), [{ qid: 'q_slimes', n: 8, count: 8, ready: true }]);
  assert.equal(pq.q_slimes.state, 'ready');
  assert.deepEqual(recordKill(pq, 'slime'), []); // ready quests no longer progress
  assert.equal(pq.q_slimes.n, 8);
});

test('turn-in checks and completion', () => {
  const pq = { q_slimes: { state: 'active', n: 3 } };
  assert.match(checkTurnIn(pq, 'elder', 'q_slimes'), /Gluants éliminés 3\/8/);
  assert.match(checkTurnIn(pq, 'elder', 'q_wolves'), /pas cette quête/);
  pq.q_slimes = { state: 'ready', n: 8 };
  assert.match(checkTurnIn(pq, 'merchant', 'q_slimes'), /pas rendue ici/);
  assert.equal(checkTurnIn(pq, 'elder', 'q_slimes'), null);
  completeQuest(pq, 'q_slimes');
  assert.deepEqual(pq.q_slimes, { state: 'done', n: 8 });
  assert.match(checkTurnIn(pq, 'elder', 'q_slimes'), /pas cette quête/);
});

test('rewardItems includes the class item', () => {
  assert.deepEqual(rewardItems('q_slimes', 'mage'), QUESTS.q_slimes.reward.items);
  assert.deepEqual(rewardItems('q_golem', 'mage'), [['ember_staff', 1]]);
  assert.deepEqual(rewardItems('q_golem', 'warrior'), [['runeblade', 1]]);
  assert.deepEqual(rewardItems('q_golem', 'ranger'), [['elven_bow', 1]]);
});

test('sanitizeQuests repairs persisted states', () => {
  const q = sanitizeQuests({ q_slimes: { state: 'active', n: 99 }, q_wolves: { state: 'bogus' }, nope: { state: 'done' }, q_goblins: { state: 'done', n: 1 } });
  assert.deepEqual(q, { q_slimes: { state: 'ready', n: 8 }, q_goblins: { state: 'done', n: 8 } });
  assert.deepEqual(sanitizeQuests(null), {});
});

test('kill labels are French', () => {
  assert.equal(killLabel('slime'), 'Gluants éliminés');
  assert.equal(killLabel('golem'), 'Golem ancien vaincu');
});
