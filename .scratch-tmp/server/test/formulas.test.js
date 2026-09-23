import test from 'node:test';
import assert from 'node:assert/strict';
import {
  xpToNext, playerStats, monsterStats, computeDamage, monsterXp, MAX_LEVEL, CLASSES, ITEMS,
} from '../../shared/data.js';
import { applyXp } from '../src/progression.js';

test('xpToNext grows with level and is 0 at max level', () => {
  assert.equal(xpToNext(1), 100);
  assert.equal(xpToNext(2), Math.floor(100 * 2 ** 1.5));
  for (let l = 1; l < MAX_LEVEL - 1; l++) assert.ok(xpToNext(l + 1) > xpToNext(l));
  assert.equal(xpToNext(MAX_LEVEL), 0);
});

test('playerStats includes class growth and equipment bonuses', () => {
  const base = playerStats('warrior', 1, {});
  assert.equal(base.mhp, CLASSES.warrior.hp);
  assert.equal(base.atk, CLASSES.warrior.atk);
  const eq = playerStats('warrior', 1, { weapon: 'rusty_sword', armor: 'leather_tunic' });
  assert.equal(eq.atk, base.atk + ITEMS.rusty_sword.atk);
  assert.equal(eq.def, base.def + ITEMS.leather_tunic.def);
  const lvl5 = playerStats('mage', 5, { weapon: 'arcane_staff' });
  assert.equal(lvl5.mmp, Math.round(CLASSES.mage.mp + CLASSES.mage.mpLvl * 4 + ITEMS.arcane_staff.mp));
  const plate = playerStats('ranger', 12, { armor: 'golem_plate' });
  assert.equal(plate.mhp, Math.round(CLASSES.ranger.hp + CLASSES.ranger.hpLvl * 11 + 60));
});

test('computeDamage: variance, crits, mitigation, minimum 1', () => {
  const lo = computeDamage(100, 1, 0, 0, 0, 0.99);
  const hi = computeDamage(100, 1, 0, 0, 0.9999, 0.99);
  assert.equal(lo.amount, 85);
  assert.equal(hi.amount, 115);
  assert.equal(lo.crit, false);
  const crit = computeDamage(100, 1, 0, 0.5, 0.5, 0.1);
  assert.equal(crit.crit, true);
  assert.equal(crit.amount, 160);
  const mitigated = computeDamage(100, 1, 60, 0, 0.5, 0.99);
  assert.equal(mitigated.amount, 50);
  assert.equal(computeDamage(0.1, 0.1, 500, 0, 0, 0.99).amount, 1);
});

test('monsterXp scales with level difference and is clamped', () => {
  assert.equal(monsterXp('slime', 1, 1), 20);
  assert.equal(monsterXp('slime', 3, 1), Math.round((20 + 12) * 1.2));
  assert.equal(monsterXp('wolf', 6, 1), Math.round((30 + 40) * 1.5)); // capped at 1.5
  assert.equal(monsterXp('slime', 1, 20), 2); // floor 0.1
  assert.ok(monsterXp('golem', 14, 14) === 1500);
});

test('monsterStats per level', () => {
  const s = monsterStats('goblin', 7);
  assert.equal(s.mhp, 95 + 18 * 6);
  assert.equal(s.def, Math.round(5 + 1.2 * 6));
});

test('applyXp: single and multiple level-ups at once', () => {
  assert.deepEqual(applyXp(1, 0, 50), { level: 1, xp: 50, gained: 0 });
  assert.deepEqual(applyXp(1, 90, 10), { level: 2, xp: 0, gained: 1 });
  const need = xpToNext(1) + xpToNext(2) + xpToNext(3);
  assert.deepEqual(applyXp(1, 0, need + 7), { level: 4, xp: 7, gained: 3 });
});

test('applyXp: stops at max level with xp 0', () => {
  assert.deepEqual(applyXp(MAX_LEVEL, 0, 5000), { level: MAX_LEVEL, xp: 0, gained: 0 });
  const r = applyXp(MAX_LEVEL - 1, 0, 10_000_000);
  assert.equal(r.level, MAX_LEVEL);
  assert.equal(r.xp, 0);
  assert.equal(r.gained, 1);
});

test('applyXp ignores non-positive amounts', () => {
  assert.deepEqual(applyXp(3, 10, 0), { level: 3, xp: 10, gained: 0 });
  assert.deepEqual(applyXp(3, 10, -50), { level: 3, xp: 10, gained: 0 });
});
