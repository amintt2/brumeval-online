// [combat-souls] Balance thresholds from the simulation of tests/balance/sim.mjs (see docs/EQUILIBRAGE.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBalance } from '../../tests/balance/sim.mjs';

const res = runBalance({ n: 80, seed: 3 });

test('balance: the three classes stay within ±15 % of efficiency at levels 1, 5, 10 and 14', () => {
  for (const [level, spread] of Object.entries(res.spread)) {
    assert.ok(spread <= 0.15, `niveau ${level} : écart ${Math.round(spread * 100)} % (${JSON.stringify(res.eff[level])})`);
  }
});

test('balance: regular monsters die in reasonable time and rarely kill a player of their level', () => {
  for (const r of res.rows) {
    assert.ok(r.ttk < 40, `${r.cls} niv. ${r.level} contre ${r.type}/${r.variant} : ${r.ttk.toFixed(1)} s`);
    assert.ok(r.deathRate <= 0.1, `${r.cls} niv. ${r.level} contre ${r.type}/${r.variant} : ${Math.round(r.deathRate * 100)} % de morts`);
  }
});

test('balance: the golem is a long, dangerous fight but can be won solo at level 14 by every class', () => {
  for (const r of res.boss) {
    assert.ok(r.ttk > 30 && r.ttk < 180, `${r.cls} : ${r.ttk.toFixed(1)} s`);
    assert.ok(r.deathRate < 0.5, `${r.cls} : ${Math.round(r.deathRate * 100)} % de morts`);
  }
  // it hurts: every class takes real damage
  assert.ok(res.boss.every((r) => r.dmgPct > 0.1));
});

// [skilltree] builds of l'Arbre des Brumes (tests/balance/sim.mjs › BUILDS): every build spends its points, can use
// its whole bar with its weapon, kills its opponents in reasonable time and rarely dies.
test('balance (tree): 2 builds per class + 2 hybrids at levels 10, 20 and 30', async () => {
  const { runTreeBalance, BUILDS } = await import('../../tests/balance/sim.mjs');
  const tree = runTreeBalance({ n: 30, seed: 3 });
  for (const [key, b] of Object.entries(tree.builds)) {
    assert.ok(b.budget - b.spent <= 1, `${key} : les points sont placés (${b.spent}/${b.budget})`);
    assert.ok(b.usable, `${key} : toute la barre est utilisable avec l'arme choisie`);
  }
  for (const r of tree.rows) {
    assert.ok(r.ttk < 40, `${r.build} niv. ${r.level} contre ${r.type} : ${r.ttk.toFixed(1)} s`);
    assert.ok(r.deathRate <= 0.1, `${r.build} niv. ${r.level} contre ${r.type} : ${Math.round(r.deathRate * 100)} % de morts`);
  }
  assert.equal(Object.keys(tree.eff[30]).length, BUILDS.length);
  // XP/min spread around the mean at levels 20 and 30 (review of 24/09: it was −25 % … +33 %). The Tireur stays a bit
  // above (its v0.2 abilities are never weaker than in v0.2), the Inapte hybrid a bit under (docs/EQUILIBRAGE.md §7)
  for (const level of [20, 30]) {
    const e = tree.eff[level];
    const mean = Object.values(e).reduce((a, b) => a + b, 0) / BUILDS.length;
    for (const [name, v] of Object.entries(e)) {
      const d = v / mean - 1;
      assert.ok(d > -0.22 && d < 0.25, `${name} niv. ${level} : ${Math.round(d * 100)} % de la moyenne`);
    }
  }
});
