// [combat-souls] Per-monster AI setup: variant, elite roll, personal temperament and a private seeded RNG, so
// that two monsters of the same type never behave exactly the same way — while staying deterministic for tests.
import { ELITE } from '../../../../shared/data.js';
import { mulberry32 } from '../../../../shared/noise.js';

/** Merge the type AI with a variant's overrides (a variant listing attacks replaces them). */
export function resolveBrain(def, variant) {
  const base = def.ai || { arch: 'brute', poise: 30, attacks: [{ id: 'hit', kind: 'melee', max: def.range, cd: def.atkCd, w: 1, power: 1, windup: 400, rec: 300 }] };
  const b = { ...base, ...(variant?.ai || {}) };
  b.attacks = (variant?.ai?.attacks || base.attacks || []).map((a) => ({ ...a }));
  if (!b.attacks.length) b.attacks.push({ id: 'hit', kind: 'melee', max: def.range, cd: def.atkCd, w: 1, power: 1, windup: 400, rec: 300 });
  return b;
}

/** Personality of one individual (all in [0, 1] unless noted). */
export function rollTemperament(rng, brain) {
  const r = (a, b) => a + rng() * (b - a);
  const pref = brain.pref || [0, 2];
  return {
    aggression: r(0.2, 1),              // attacks / closes in more
    caution: r(0, 1),                   // backs off, flees at low hp
    reactMs: Math.round(r(150, 600)),   // reaction delay
    prefDist: r(pref[0], pref[1]),      // preferred distance to the target (m)
    strafeSide: rng() < 0.5 ? -1 : 1,   // circles clockwise or not
    patience: r(0, 1),                  // pauses / feints
    aim: r(0, 1),                       // how much projectiles lead a moving target
  };
}

function pickVariant(rng, variants) {
  if (!Array.isArray(variants) || !variants.length) return null;
  let r = rng();
  for (const v of variants) {
    if (r < (v.ch ?? 0)) return v;
    r -= v.ch ?? 0;
  }
  return variants[variants.length - 1];
}

/** Reset the runtime AI fields (spawn, leash). */
export function resetBrainState(m) {
  m.act = null;            // current action { kind, until, … }
  m.cds = {};              // attack id -> ready time (ms)
  m.used = {};             // once-per-fight attacks already used
  m.poiseDmg = 0;
  m.poiseAt = 0;
  m.phase = 1;
  m.enraged = false;
  m.decideAt = 0;
  m.alertUntil = 0;
  m.fled = false;
  m.teleIds = [];
  m.dash = null;
}

/**
 * Configure a freshly created monster. opts (tests / tools): { seed, variant: key, elite: boolean }.
 * Without opts everything is rolled from game.rng (deterministic with a seeded game rng).
 */
export function setupMonster(game, m, opts = {}) {
  const def = m.def;
  const seed = opts.seed ?? Math.floor(game.rng() * 4294967296);
  m.seed = seed >>> 0;
  m.rng = mulberry32(m.seed);
  // base stats (a monster can be re-configured by tests)
  m.base ??= { name: m.name, mhp: m.mhp, atk: m.atk, speed: m.speed };
  let variant = pickVariant(m.rng, def.variants);
  if (opts.variant !== undefined) variant = (def.variants || []).find((v) => v.key === opts.variant) || null;
  const eliteRoll = m.rng();
  const elite = opts.elite ?? (!def.boss && eliteRoll < ELITE.ch);

  m.variant = variant ? variant.key : null;
  m.elite = !!elite;
  let name = variant?.name || m.base.name;
  let mhp = m.base.mhp * (variant?.hp ?? 1);
  let atk = m.base.atk * (variant?.atk ?? 1);
  if (m.elite) {
    name = `${ELITE.prefix} · ${name}`;
    mhp *= ELITE.hp;
    atk *= ELITE.atk;
  }
  m.name = name;
  m.mhp = Math.round(mhp);
  m.hp = m.mhp;
  m.atk = Math.round(atk);
  m.speed = m.base.speed * (variant?.speed ?? 1);
  m.brain = resolveBrain(def, variant);
  m.temper = rollTemperament(m.rng, m.brain);
  resetBrainState(m);
  m.staticVer = (m.staticVer || 0) + 1;
  return m;
}
