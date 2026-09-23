#!/usr/bin/env node
// [combat-souls] Balance simulation (docs/EQUILIBRAGE.md).
// Solo fights of each class against each monster / archetype at levels 1, 5, 10 and 14, under a simplified but
// data-driven model of the real rules (shared/data.js + shared/combat.js): damage formula, cooldowns, mana,
// stamina, attack commitment (recovery slow), dodge rolls with i-frames, monster wind-ups / telegraphs /
// projectiles, poise & stagger, skeleton guard, elites excluded (5 % bonus content).
//
// Player policies (what a reasonable player does):
//   warrior: walks into melee, heavy blow / whirlwind on cooldown, auto-attack, war cry below 45 % hp, rolls
//            through telegraphed attacks (and some light swings) when it has the stamina.
//   mage / ranger: open from range, keep the distance while shooting (ranged auto-attacks only fire while
//            moving slowly: the kite speed is capped), roll away when a monster reaches melee, heal (mage) below
//            50 %, dodge telegraphs / projectiles.
// Output per matchup: time to kill, damage taken, death rate; per class and level: an efficiency score = XP per
// minute including the downtime needed to regenerate hp / mana afterwards and a death penalty.
//
//   node tests/balance/sim.mjs            → prints the tables (markdown)
//   import { runBalance } from './sim.mjs' → used by server/test/balance.test.js
import {
  CLASSES, ABILITIES, MONSTERS, REGEN, playerStats, monsterStats, computeDamage, monsterXp,
} from '../../shared/data.js';
import { STAMINA, ROLL, POISE, COMMIT, regenStamina } from '../../shared/combat.js';
import { mulberry32 } from '../../shared/noise.js';
import { resolveBrain } from '../../server/src/systems/ai/brain.js';

const DT = 0.05;
const MAX_T = 180;
const DEATH_PENALTY_S = 75;       // run back from the village + lost echo risk
const TRAVEL_S = 5;               // walk to the next monster
const PULL_DIST = 16;             // fights start at this distance (monster noticed / pulled)

/** Gear a player of this class typically wears at `level` (shop + quest rewards). */
export function gearAt(cls, level) {
  const w = { warrior: ['rusty_sword', 'steel_sword', 'runeblade'], mage: ['apprentice_staff', 'arcane_staff', 'ember_staff'], ranger: ['short_bow', 'long_bow', 'elven_bow'] }[cls];
  const tier = level >= 12 ? 2 : level >= 6 ? 1 : 0;
  let armor = 'leather_tunic';
  if (cls === 'mage' && level >= 5) armor = 'mage_robe';
  else if (cls !== 'mage' && level >= 12) armor = 'golem_plate';
  else if (cls !== 'mage' && level >= 6) armor = 'chainmail';
  return { weapon: w[tier], armor };
}

/** Per-class dodge skill (probability to roll a readable attack in time). Same for all classes. */
const DODGE = { tele: 0.75, proj: 0.6, melee: 0.3 };
/** Probability that a ranged player escapes a monster that reached melee range (roll away and keep kiting). */
const KITE_SKILL = 0.6;

function makePlayer(cls, level) {
  const st = playerStats(cls, level, gearAt(cls, level));
  return {
    cls, level, ...st, hp: st.mhp, mp: st.mmp, st: STAMINA.max, stAt: -1e9,
    cds: [0, 0, 0, 0], rollReady: 0, iframe: 0, recUntil: 0, recSlow: 1, rollUntil: 0,
    ranged: cls !== 'warrior', dmgTaken: 0, mpUsed: 0,
  };
}

function makeMonster(type, level, variant, elite = false) {
  const def = MONSTERS[type];
  const v = (def.variants || []).find((x) => x.key === variant) || null;
  const s = monsterStats(type, level);
  const brain = resolveBrain(def, v);
  const mhp = Math.round(s.mhp * (v?.hp ?? 1) * (elite ? 1.8 : 1));
  return {
    type, level, def, brain, mhp, hp: mhp, atk: Math.round(s.atk * (v?.atk ?? 1) * (elite ? 1.3 : 1)), defense: s.def, crit: s.crit,
    speed: s.speed * (v?.speed ?? 1), cds: {}, act: null, busyUntil: 0, poise: 0, poiseAt: -1e9, phase: 1,
    ranged: brain.arch === 'ranged' || brain.arch === 'caster', pref: brain.pref ? (brain.pref[0] + brain.pref[1]) / 2 : 0,
  };
}

/** One fight. Returns { t, dmgTaken, died, mpUsed }. */
export function fight(cls, level, type, mLevel, variant, rng, trace = null) {
  const p = makePlayer(cls, level);
  const m = makeMonster(type, mLevel, variant);
  const abs = CLASSES[cls].abilities.map((id) => ({ id, ...ABILITIES[id] }));
  let d = p.ranged ? PULL_DIST : 12;
  let t = 0;
  let monsterReady = 0.4 + rng() * 0.3; // alert phase
  let kiteChoice = null;
  const pending = []; // player projectiles in flight { at, power, ab }
  const hitMonster = (ab, power) => {
    const g = m.brain.guard;
    let { amount } = computeDamage(p.atk, power, m.defense, p.crit, rng(), rng());
    if (g && !(m.act && m.act.phase === 'windup') && rng() < 0.7) amount = Math.max(1, Math.round(amount * (1 - g.reduce)));
    m.hp -= amount;
    if (t - m.poiseAt > POISE.windowMs / 1000) m.poise = 0;
    m.poiseAt = t;
    m.poise += ab.poise || 0;
    if (m.poise >= (m.brain.poise || 30)) {
      m.poise = 0;
      m.act = null;
      m.busyUntil = t + (m.def.boss ? POISE.bossStaggerMs : POISE.staggerMs) / 1000;
    }
  };
  const spendSt = (v) => { p.st -= v; p.stAt = t; };
  const tryRoll = () => {
    if (t < p.rollReady || p.st < STAMINA.roll) return false;
    spendSt(STAMINA.roll);
    p.rollReady = t + ROLL.cdMs / 1000;
    p.iframe = t + ROLL.iframeMs / 1000;
    p.rollUntil = t + ROLL.ms / 1000;
    p.recUntil = 0;
    return true;
  };

  while (t < MAX_T) {
    t += DT;
    trace?.(t, d, m, p);
    // ---- stamina / mana regen (in combat rates)
    p.st = regenStamina(p.st, STAMINA.max, (t - p.stAt) * 1000, DT * 1000);
    p.mp = Math.min(p.mmp, p.mp + p.mmp * REGEN.mpCombat * DT);
    p.hp = Math.min(p.mhp, p.hp + p.mhp * REGEN.hpCombat * DT);
    // ---- projectiles
    for (let i = pending.length - 1; i >= 0; i--) {
      if (t >= pending[i].at) { hitMonster(pending[i].ab, pending[i].power); pending.splice(i, 1); }
    }
    if (m.hp <= 0) return { t, dmgTaken: p.dmgTaken, died: false, mpUsed: p.mpUsed };

    // ---- player movement
    const rolling = t < p.rollUntil;
    const slow = t < p.recUntil ? p.recSlow : 1;
    const mReach = Math.max(...m.brain.attacks.filter((a) => a.kind !== 'heal' && a.kind !== 'howl').map((a) => a.max || 2));
    let moving = false;
    if (rolling) {
      d += (p.ranged ? 1 : 0) * (ROLL.dist / (ROLL.ms / 1000)) * DT; // ranged roll away; melee rolls through (no distance change)
    } else if (p.ranged) {
      // keep the distance while shooting: walk away at the kite speed (autos still fire under COMMIT.rangedMoveMax)
      const want = m.ranged ? 9 : 11;
      if (d < want) { d += p.speed * Math.min(COMMIT.rangedMoveMax * 0.92, slow) * DT; moving = true; }
      // roll away when caught in melee — a human does not always make it (KITE_SKILL)
      if (d > 4) kiteChoice = null;
      if (d < 2.6 && !m.ranged) {
        if (kiteChoice === null) kiteChoice = rng() < KITE_SKILL;
        if (kiteChoice) tryRoll();
      }
    } else if (d > 2.4) {
      d -= p.speed * slow * DT;
      moving = true;
    }
    // ---- monster movement
    // monsters keep closing in during the wind-up of a light swing (tracking), not during telegraphs
    const tracking = m.act && m.act.atk.kind === 'melee' && d > (m.act.atk.max || 2) * 0.8;
    if (tracking) d -= m.speed * (m.brain.run || 1) * DT;
    if (t >= monsterReady && !(m.act) && t >= m.busyUntil) {
      const want = m.ranged ? m.pref : 1.6;
      if (d > want + 0.3) d -= m.speed * (d > 4.5 ? m.brain.run || 1 : 1) * DT;
      else if (m.ranged && d < m.pref * 0.7) d += m.speed * 0.8 * DT;
    }
    d = Math.max(0.8, d);

    // ---- player abilities
    if (!rolling) {
      if (cls === 'warrior' && p.hp < p.mhp * 0.45 && t >= p.cds[3] && p.mp >= abs[3].mp) {
        cast(3);
      } else if (cls === 'mage' && p.hp < p.mhp * 0.5 && t >= p.cds[3] && p.mp >= abs[3].mp) {
        cast(3);
      } else {
        for (const slot of [1, 2, 0]) {
          const ab = abs[slot];
          if (t < p.cds[slot] || p.mp < (ab.mp || 0) || p.st < (ab.st || 0) + (slot === 0 ? 0 : 10)) continue;
          // mana discipline: keep a reserve (for the heal / next fight) unless the monster is still healthy
          if (ab.mp && p.mp - ab.mp < p.mmp * 0.4 && m.hp < m.mhp * 0.5) continue;
          if (ab.kind === 'melee' && d > ab.range) continue;
          if (ab.kind === 'projectile' && d > ab.range) continue;
          if (ab.kind === 'aoe_self' && d > ab.radius) continue;
          if (ab.kind === 'aoe_target' && d > ab.range) continue;
          if (slot === 0 && ab.kind === 'projectile' && moving && p.speed * slow > p.speed * COMMIT.rangedMoveMax) continue;
          cast(slot);
          break;
        }
      }
    }
    function cast(slot) {
      const ab = abs[slot];
      p.cds[slot] = t + ab.cd;
      p.mp -= ab.mp || 0;
      p.mpUsed += ab.mp || 0;
      if (ab.st) spendSt(ab.st);
      p.recUntil = t + (ab.rec ?? COMMIT.rec);
      p.recSlow = ab.recSlow ?? COMMIT.recSlow;
      if (ab.kind === 'self_heal') { p.hp = Math.min(p.mhp, p.hp + p.mhp * ab.heal); return; }
      const n = ab.hits || 1;
      for (let i = 0; i < n; i++) {
        const delay = ab.kind === 'projectile' ? d / ab.speed + i * 0.25 : 0;
        if (delay > 0) pending.push({ at: t + delay, power: ab.power, ab });
        else hitMonster(ab, ab.power);
      }
    }

    // ---- monster attacks
    if (t < monsterReady || t < m.busyUntil) continue;
    if (m.def.boss) {
      const r = m.hp / m.mhp;
      const ph = r <= 0.3 ? 3 : r <= 0.66 ? 2 : 1;
      if (ph > m.phase) { m.phase = ph; m.act = null; m.busyUntil = t + 1.9; continue; }
    }
    const enr = m.phase >= 3;
    if (m.act) {
      if (t < m.act.impact) continue;
      const atk = m.act.atk;
      m.act = null;
      m.busyUntil = t + (atk.rec || 300) / 1000 + 0.15 + rng() * 0.25 + (rng() < 0.25 ? 0.6 : 0); // think / strafe / pause
      if (atk.kind === 'heal') { m.hp = Math.min(m.mhp, m.hp + m.mhp * (atk.heal || 0.2) * 0.5); continue; }
      if (atk.kind === 'howl') continue;
      let hit;
      if (t < p.iframe) hit = false;
      else if (atk.kind === 'melee') hit = d <= (atk.max || 2) + 0.6;
      else if (atk.kind === 'proj') hit = true;
      else hit = d <= Math.max(atk.r || 0, atk.len || 0) + 0.45 && !(atk.shape === 'ring' && d < (atk.r2 || 0));
      if (atk.dash || atk.leap) d = Math.max(0.8, d - (atk.len || atk.max || 4) + 1); // charge / leap closes the gap
      if (hit) {
        const { amount } = computeDamage(m.atk, atk.power || 1, p.def, m.crit, rng(), rng());
        p.hp -= amount;
        p.dmgTaken += amount;
        if (p.hp <= 0) return { t, dmgTaken: p.dmgTaken, died: true, mpUsed: p.mpUsed };
      }
      continue;
    }
    // pick an attack in range
    const opts = m.brain.attacks.filter((a) => {
      if (a.phase && m.phase < a.phase) return false;
      if (t < (m.cds[a.id] || 0) || a.kind === 'howl') return false;
      if (a.kind === 'heal') return m.hp < m.mhp * 0.7;
      return d >= (a.min || 0) && d <= (a.max || 2);
    });
    if (!opts.length) continue;
    let sum = 0;
    for (const a of opts) sum += a.w || 1;
    let r = rng() * sum;
    let atk = opts[opts.length - 1];
    for (const a of opts) { if (r < (a.w || 1)) { atk = a; break; } r -= a.w || 1; }
    const wind = (atk.windup || 400) * (enr ? 0.85 : 1) / 1000;
    m.cds[atk.id] = t + (atk.cd || 1.5) * (enr ? 0.7 : 1);
    m.act = { atk, impact: t + wind };
    // the player reacts: roll through / away from readable attacks
    const kind = atk.kind === 'tele' ? 'tele' : atk.kind === 'proj' ? 'proj' : atk.kind === 'melee' ? 'melee' : null;
    if (kind && rng() < DODGE[kind]) {
      const reactAt = t + Math.max(0, wind - ROLL.iframeMs / 1000 * 0.7);
      // schedule the roll so that the i-frames cover the impact
      m.act.dodgeAt = reactAt;
    }
    if (m.act.dodgeAt !== undefined) {
      const at = m.act.dodgeAt;
      // approximate: the roll happens at `at` if stamina allows then
      const stAt = regenStamina(p.st, STAMINA.max, (at - p.stAt) * 1000, (at - t) * 1000);
      if (stAt >= STAMINA.roll && at >= p.rollReady) {
        spendSt(STAMINA.roll);
        p.rollReady = at + ROLL.cdMs / 1000;
        p.iframe = at + ROLL.iframeMs / 1000;
        p.rollUntil = at + ROLL.ms / 1000;
        p.recUntil = 0;
      }
    }
  }
  return { t: MAX_T, dmgTaken: p.dmgTaken, died: false, mpUsed: p.mpUsed, timeout: true };
}

/** Matchups per player level: [type, monster level, variant]. */
export const MATCHUPS = {
  1: [['slime', 1, null], ['slime', 2, null]],
  5: [['slime', 3, null], ['wolf', 5, null], ['goblin', 5, 'skirmisher'], ['goblin', 5, 'thrower']],
  10: [['goblin', 8, 'skirmisher'], ['goblin', 8, 'thrower'], ['skeleton', 10, 'brute'], ['skeleton', 10, 'occultist'], ['wolf', 6, null]],
  14: [['skeleton', 11, 'brute'], ['skeleton', 11, 'occultist'], ['goblin', 8, 'thrower']],
};
export const BOSS = { level: 14, type: 'golem', mLevel: 14 };

/** Aggregate N fights. */
export function matchup(cls, level, type, mLevel, variant, n = 120, seed = 1) {
  const rng = mulberry32(seed * 7919 + level * 131 + type.length * 17 + (variant ? variant.length : 0) + cls.length * 1009);
  let t = 0, dmg = 0, deaths = 0, mp = 0;
  for (let i = 0; i < n; i++) {
    const r = fight(cls, level, type, mLevel, variant, rng);
    t += r.t; dmg += r.dmgTaken; deaths += r.died ? 1 : 0; mp += r.mpUsed;
  }
  const p = makePlayer(cls, level);
  const ttk = t / n, dmgTaken = dmg / n, deathRate = deaths / n;
  // downtime: only the deficit that the regeneration during the fight and the walk to the next monster
  // (TRAVEL_S, still at the in-combat rate) does not cover has to be waited for at the resting rate
  const hpDown = Math.max(0, dmgTaken - (ttk + TRAVEL_S) * p.mhp * REGEN.hpCombat) / (p.mhp * REGEN.hpRest);
  const mpDown = Math.max(0, mp / n - (ttk + TRAVEL_S) * p.mmp * REGEN.mpCombat) / (p.mmp * REGEN.mpRest);
  const cycle = ttk + Math.max(hpDown, mpDown) + deathRate * DEATH_PENALTY_S + TRAVEL_S;
  const xp = monsterXp(type, mLevel, level) * (1 - deathRate);
  return { cls, level, type, variant, mLevel, ttk, dmgTaken, dmgPct: dmgTaken / p.mhp, deathRate, xpm: (xp / cycle) * 60 };
}

export function runBalance({ n = 120, seed = 1 } = {}) {
  const rows = [];
  const eff = {};
  for (const level of Object.keys(MATCHUPS).map(Number)) {
    eff[level] = {};
    for (const cls of Object.keys(CLASSES)) {
      let sum = 0;
      for (const [type, mLevel, variant] of MATCHUPS[level]) {
        const r = matchup(cls, level, type, mLevel, variant, n, seed);
        rows.push(r);
        sum += r.xpm;
      }
      eff[level][cls] = sum / MATCHUPS[level].length;
    }
  }
  const boss = Object.keys(CLASSES).map((cls) => matchup(cls, BOSS.level, BOSS.type, BOSS.mLevel, null, Math.max(20, n / 4), seed));
  const spread = {};
  for (const level of Object.keys(eff)) {
    const v = Object.values(eff[level]);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    spread[level] = Math.max(...v.map((x) => Math.abs(x / mean - 1)));
  }
  return { rows, eff, spread, boss };
}

const f1 = (v) => v.toFixed(1);
export function formatReport(res) {
  const out = [];
  out.push('| Niv. | Classe | Adversaire | TTK (s) | Dégâts subis (% PV) | Morts | XP/min |');
  out.push('|---|---|---|---:|---:|---:|---:|');
  for (const r of res.rows) {
    const name = `${MONSTERS[r.type].name}${r.variant && r.variant !== 'skirmisher' && r.variant !== 'brute' ? ` (${r.variant})` : ''} niv. ${r.mLevel}`;
    out.push(`| ${r.level} | ${CLASSES[r.cls].name} | ${name} | ${f1(r.ttk)} | ${Math.round(r.dmgPct * 100)} % | ${Math.round(r.deathRate * 100)} % | ${Math.round(r.xpm)} |`);
  }
  out.push('');
  out.push('| Niv. | Guerrier | Mage | Rôdeur | Écart max à la moyenne |');
  out.push('|---|---:|---:|---:|---:|');
  for (const level of Object.keys(res.eff)) {
    const e = res.eff[level];
    out.push(`| ${level} | ${Math.round(e.warrior)} | ${Math.round(e.mage)} | ${Math.round(e.ranger)} | ${Math.round(res.spread[level] * 100)} % |`);
  }
  out.push('');
  out.push('| Boss (solo, niv. 14) | TTK (s) | Dégâts subis (% PV) | Morts |');
  out.push('|---|---:|---:|---:|');
  for (const r of res.boss) out.push(`| ${CLASSES[r.cls].name} | ${f1(r.ttk)} | ${Math.round(r.dmgPct * 100)} % | ${Math.round(r.deathRate * 100)} % |`);
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('sim.mjs')) {
  const res = runBalance({ n: Number(process.argv[2]) || 150 });
  console.log(formatReport(res));
}
