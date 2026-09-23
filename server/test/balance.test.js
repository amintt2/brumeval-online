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
