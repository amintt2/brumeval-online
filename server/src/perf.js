// [netcode-perf] Tick profiler: rolling tick-duration percentiles (p50/p95/p99), per-phase timings and budget
// warnings. `attachPerf(game)` instruments a Game instance (wraps tick() and guard(), which every tick phase
// already goes through), so the game loop itself needs no change. Exposed on /health.
import { TICK_RATE } from '../../shared/protocol.js';

export const TICK_BUDGET_MS = 1000 / TICK_RATE;   // 50 ms
export const WARN_P95_MS = TICK_BUDGET_MS / 2;     // warn when p95 uses more than half of the budget
const WINDOW = 60 * TICK_RATE;                     // last 60 s of ticks

export class TickProfiler {
  constructor({ window = WINDOW } = {}) {
    this.buf = new Float64Array(window);
    this.n = 0;          // samples stored (≤ window)
    this.i = 0;          // next write index
    this.total = 0;      // ticks recorded since start
    this.over = 0;       // ticks over budget since start
    this.phases = new Map(); // label -> { total, n, max } since the last resetPhases()
    this.phaseTicks = 0;     // ticks recorded since the last resetPhases()
    this.lastWarn = -Infinity;
  }

  record(ms) {
    this.buf[this.i] = ms;
    this.i = (this.i + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
    this.total++;
    this.phaseTicks++;
    if (ms > TICK_BUDGET_MS) this.over++;
  }

  phase(label, ms) {
    let p = this.phases.get(label);
    if (p === undefined) this.phases.set(label, (p = { total: 0, n: 0, max: 0 }));
    p.total += ms;
    p.n++;
    if (ms > p.max) p.max = ms;
  }

  /** Percentiles over the rolling window (ms). */
  percentiles() {
    if (this.n === 0) return { samples: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
    const a = this.buf.slice(0, this.n).sort();
    const at = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i];
    return { samples: a.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: a[a.length - 1], avg: sum / a.length };
  }

  /** JSON-ready summary (rounded). Phases: ms per tick on average, slowest single call, number of calls. */
  snapshot() {
    const p = this.percentiles();
    const r = (v) => Math.round(v * 1000) / 1000;
    const phases = {};
    for (const [label, s] of this.phases) phases[label] = { msPerTick: r(this.phaseTicks ? s.total / this.phaseTicks : 0), max: r(s.max), calls: s.n };
    return {
      rate: TICK_RATE, budgetMs: TICK_BUDGET_MS, samples: p.samples,
      p50: r(p.p50), p95: r(p.p95), p99: r(p.p99), max: r(p.max), avg: r(p.avg),
      ticks: this.total, overBudget: this.over, phases,
    };
  }

  /** Reset the phase accumulators (called by the periodic budget check so phases describe the last minute). */
  resetPhases() {
    this.phases.clear();
    this.phaseTicks = 0;
  }

  /** Log a French warning when the tick p95 exceeds WARN_P95_MS (at most once a minute). */
  check(log, now = Date.now()) {
    const p = this.percentiles();
    if (p.samples >= TICK_RATE * 5 && p.p95 > WARN_P95_MS && now - this.lastWarn > 60_000) {
      this.lastWarn = now;
      const worst = [...this.phases.entries()].sort((a, b) => b[1].total - a[1].total)[0];
      log?.warn(`tick lent : p95 ${p.p95.toFixed(1)} ms, p99 ${p.p99.toFixed(1)} ms (budget ${TICK_BUDGET_MS} ms)` +
        (worst ? ` — phase la plus coûteuse : ${worst[0]}` : ''));
      return true;
    }
    return false;
  }
}

/** Instrument `game` (idempotent). Returns its profiler, also reachable as game.perf. */
export function attachPerf(game) {
  if (game.perf) return game.perf;
  const perf = new TickProfiler();
  game.perf = perf;
  const tick = game.tick;
  game.tick = function profiledTick() {
    const t0 = performance.now();
    tick.call(this);
    perf.record(performance.now() - t0);
  };
  const guard = game.guard;
  game.guard = function profiledGuard(label, fn) {
    const t0 = performance.now();
    guard.call(this, label, fn);
    perf.phase(label, performance.now() - t0);
  };
  return perf;
}
