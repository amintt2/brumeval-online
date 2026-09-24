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
// [skilltree] builds of l'Arbre des Brumes
import {
  buildTree, resolveAbility, stat, cheapestPath, validateTree, budgetOf, spentOf, nodeCost, TREE, CLASS_START, BASE_ABILITY,
} from '../../shared/skills.js';

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
export const DODGE = { tele: 0.75, proj: 0.6, melee: 0.3 };
/** Probability that a ranged player escapes a monster that reached melee range (roll away and keep kiting). */
const KITE_SKILL = 0.6;

function makePlayer(cls, level, build = null) {
  const st = build ? build.stats : playerStats(cls, level, gearAt(cls, level));
  return {
    cls, level, ...st, hp: st.mhp, mp: st.mmp, st: build?.mst || STAMINA.max, mst: build?.mst || STAMINA.max, stAt: -1e9,
    cds: [0, 0, 0, 0], rollReady: 0, iframe: 0, recUntil: 0, recSlow: 1, rollUntil: 0,
    ranged: build ? build.ranged : cls !== 'warrior', dmgTaken: 0, mpUsed: 0, buffs: [], markUntil: -1,
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
export function fight(cls, level, type, mLevel, variant, rng, trace = null, build = null) {
  const p = makePlayer(cls, level, build);
  const m = makeMonster(type, mLevel, variant);
  const abs = build ? build.abs : CLASSES[cls].abilities.map((id) => ({ id, ...ABILITIES[id] }));
  // [skilltree] attack (reference attack for out-of-class abilities), buffs and the hunter's mark
  const atkOf = (ab) => (build ? build.atkFor(ab) : p.atk);
  const buffMult = () => p.buffs.reduce((k, b) => (t < b.until ? k * (1 + (b.dmgPct || 0)) : k), 1) * (t < p.markUntil ? 1.15 : 1);
  let d = p.ranged ? PULL_DIST : 12;
  let t = 0;
  let monsterReady = 0.4 + rng() * 0.3; // alert phase
  let kiteChoice = null;
  const pending = []; // player projectiles in flight { at, power, ab }
  const hitMonster = (ab, power) => {
    const g = m.brain.guard;
    let { amount } = build
      ? computeDamage(atkOf(ab), power * (ab.weaponMult ?? 1) * (1 + (ab.dmgPct || 0)) * buffMult(), m.defense, p.crit + (ab.critAdd || 0), rng(), rng())
      : computeDamage(p.atk, power, m.defense, p.crit, rng(), rng());
    // [skilltree] damage over time and bleed built by the hit (counted at once: solo fights last long enough)
    if (build) amount = Math.round(amount * (1 + dotShare(ab)) + (ab.bleedBuild ? (ab.bleedBuild / 100) * (0.06 * m.mhp) : 0));
    if (g && !(m.act && m.act.phase === 'windup') && rng() < 0.7) amount = Math.max(1, Math.round(amount * (1 - g.reduce)));
    m.hp -= amount;
    if (t < (m.poiseImmuneUntil || 0)) return; // hyper-armor after a stagger
    if (t - m.poiseAt > POISE.windowMs / 1000) m.poise = 0;
    m.poiseAt = t;
    m.poise += ab.poise || 0;
    if (m.poise >= (m.brain.poise || 30)) {
      m.poise = 0;
      m.act = null;
      const st = (m.def.boss ? POISE.bossStaggerMs : POISE.staggerMs) / 1000;
      m.busyUntil = t + st;
      m.poiseImmuneUntil = t + st + POISE.immuneMs / 1000;
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
    p.st = regenStamina(p.st, p.mst, (t - p.stAt) * 1000, DT * 1000, build?.stRegen, build?.stRegenDelayMs);
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
    const healSlot = build ? abs.findIndex((a) => a.kind === 'self_heal') : cls === 'ranger' ? -1 : 3;
    const buffSlot = build ? abs.findIndex((a) => a.kind === 'buff' || a.kind === 'debuff') : -1;
    if (!rolling) {
      if (healSlot >= 0 && p.hp < p.mhp * (cls === 'warrior' ? 0.45 : 0.5) && t >= p.cds[healSlot] && p.mp >= abs[healSlot].mp) {
        cast(healSlot);
      } else if (buffSlot >= 0 && t >= p.cds[buffSlot] && p.mp >= (abs[buffSlot].mp || 0) && d < 12) {
        cast(buffSlot);
      } else {
        for (const slot of build ? build.order : [1, 2, 0]) {
          const ab = abs[slot];
          if (t < p.cds[slot] || p.mp < (ab.mp || 0) || p.st < (ab.st || 0) + (slot === 0 ? 0 : 10)) continue;
          // mana discipline: keep a reserve (for the heal / next fight) unless the monster is still healthy
          if (ab.mp && p.mp - ab.mp < p.mmp * 0.4 && m.hp < m.mhp * 0.5) continue;
          if (ab.kind === 'melee' && d > ab.range) continue;
          if (ab.kind === 'projectile' && d > ab.range) continue;
          if (ab.kind === 'aoe_self' && d > ab.radius) continue;
          if (ab.kind === 'aoe_target' && d > ab.range) continue;
          if ((ab.kind === 'channel' || ab.kind === 'dash') && d > (ab.range || ab.radius || 3)) continue;
          if (ab.kind === 'self_heal' || ab.kind === 'buff' || ab.kind === 'debuff') continue;
          if (slot === 0 && ab.kind === 'projectile' && moving && p.speed * slow > p.speed * COMMIT.rangedMoveMax) continue;
          cast(slot);
          break;
        }
      }
    }
    function cast(slot) {
      const ab = abs[slot];
      if (!build) {
        // v0.2 model, unchanged (baseline of docs/EQUILIBRAGE.md)
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
        return;
      }
      // [skilltree] resolved ability: cast time and wind-up delay the hit, channels tick, buffs / marks multiply
      p.cds[slot] = t + (typeof ab.cd === 'number' ? ab.cd : 1);
      p.mp -= ab.mp || 0;
      p.mpUsed += ab.mp || 0;
      if (ab.st) spendSt(ab.st);
      if (ab.hpCost) p.hp -= p.hp * ab.hpCost;
      const castT = (ab.cast || 0) + (ab.windup || 0);
      p.recUntil = t + castT + (ab.rec ?? COMMIT.rec);
      p.recSlow = ab.recSlow ?? COMMIT.recSlow;
      if (ab.kind === 'self_heal') { p.hp = Math.min(p.mhp, p.hp + p.mhp * (ab.heal || 0) + (ab.hot ? p.mhp * ab.hot.pct : 0)); return; }
      if (ab.kind === 'buff') { p.buffs.push({ until: t + (ab.dur ?? ab.duration ?? 6), dmgPct: (ab.buff?.dmgPct || 0) + (ab.buff?.meleeBonusDmg || 0) }); return; }
      if (ab.kind === 'debuff') { p.markUntil = t + (ab.duration || 15); return; }
      const seq = Array.isArray(ab.powerSeq) ? ab.powerSeq : Array.isArray(ab.power) ? ab.power : null;
      const ticks = ab.kind === 'aoe_target' && ab.duration && ab.tick ? Math.round(ab.duration / ab.tick)
        : ab.kind === 'channel' && ab.tick ? Math.round((ab.channel || 1) / ab.tick) : ab.hits || 1;
      const n = seq ? seq.length : ticks;
      for (let i = 0; i < n; i++) {
        const power = seq ? seq[i] : ab.power;
        const flight = ab.kind === 'projectile' ? d / (ab.speed || 20) : 0;
        const step = ab.kind === 'channel' ? ab.tick || ab.interval || 0.25 : ab.kind === 'projectile' ? 0.25 : ab.tick || 0.15;
        const delay = castT + flight + i * step + (ab.delay || 0);
        if (delay > 0) pending.push({ at: t + delay, power, ab });
        else hitMonster(ab, power);
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

/** [skilltree] Extra damage of statuses, as a share of the hit (burn 30 %, wounds, poison over 6 s). */
function dotShare(ab) {
  let k = 0;
  for (const a of ab.applies || []) if ((typeof a === 'string' ? a : a.id) === 'brulure') k += 0.3;
  if (ab.dot) k += ab.dot.total || 0;
  if (ab.poison) k += (((ab.poison.perStackPerS || 0.25) * 6) / Math.max(0.3, ab.power || 1)) * 0.6;
  if (ab.poisonStacks) k += ((ab.poisonStacks * 0.25 * 6) / Math.max(0.3, ab.power || 1)) * 0.6;
  return k;
}

// ------------------------------------------------------------------ [skilltree] tree builds
/**
 * A build of l'Arbre des Brumes at `level`: the 3 Fondamentaux (+ Garde for melee), the cheapest paths to its target
 * abilities (and variants), then passives of its branches (cheapest first, ranks included) until the points are spent.
 * Resolved abilities (variants, passives, Inaptitude, weapon) and tree stats come from shared/skills.js — the same
 * code as the server.
 */
export function makeBuild(def, level) {
  const { cls, targets, fill = [], weapon, armor } = def;
  const alloc = { fond_roulade: 1, fond_sprint: 1, fond_saut: 1 };
  if (def.garde) alloc.fond_garde = 1;
  const skills = { alloc, gift: [], rb: 0, affinity: [], legacyFloor: 0 };
  const budget = budgetOf(level, skills);
  const tryAdd = (ids) => {
    const next = { ...alloc };
    for (const id of ids) next[id] = (next[id] || 0) + 1;
    if (validateTree(cls, level, { ...skills, alloc: next }).ok) { Object.assign(alloc, next); return true; }
    return false;
  };
  const unlockNode = (ab) => TREE.nodes.find((n) => (n.effects || []).some((e) => e.mod === 'unlock' && e.value === ab))?.id;
  for (const ab of targets) {
    const node = unlockNode(ab);
    if (!node || node === CLASS_START[cls] || alloc[node]) continue;
    const r = cheapestPath(cls, Object.keys(alloc), node);
    if (r) tryAdd(r.path);
  }
  for (const id of def.variants || []) {
    const r = cheapestPath(cls, Object.keys(alloc), id);
    if (r) tryAdd(r.path);
  }
  // fill: passives of the build's branches (then Survie's body passives), cheapest path first, ranks included
  const SURVIE = ['endurance', 'soutien', 'seuil'];
  for (let guard = 0; guard < 120 && spentOf(cls, { ...skills, alloc }) < budget; guard++) {
    const { dist, prev } = distances(cls, alloc);
    const cands = [];
    for (const n of TREE.nodes) {
      if (n.type !== 'passive' || (alloc[n.id] || 0) >= (n.maxRank || 1)) continue;
      const branchOk = fill.includes(n.branch) || (n.region === 'survie' && SURVIE.includes(n.branch));
      if (!branchOk || !dist.has(n.id)) continue;
      const cost = alloc[n.id] ? nodeCost(n, cls) : dist.get(n.id);
      cands.push({ n, score: cost + (fill.includes(n.branch) ? 0 : 1.5) });
    }
    cands.sort((a, b) => a.score - b.score || a.n.id.localeCompare(b.n.id));
    let added = false;
    for (const { n } of cands) {
      const path = [];
      if (alloc[n.id]) path.push(n.id);
      else for (let cur = n.id; cur && !alloc[cur] && cur !== 'coeur' && cur !== CLASS_START[cls]; cur = prev.get(cur)) path.unshift(cur);
      if (tryAdd(path)) { added = true; break; }
    }
    if (!added) break;
  }
  const tree = buildTree(cls, skills);
  const gear = { weapon: weapon || gearAt(cls, level).weapon, armor: armor || gearAt(cls, level).armor };
  const base = playerStats(cls, level, gear);
  const v = (n) => stat(tree, n);
  const stats = {
    ...base,
    mhp: Math.round(base.mhp * (1 + v('mhpPct'))),
    mmp: Math.round((base.mmp + v('mmp')) * (1 + v('mmpPct'))),
    def: Math.round(base.def * (1 + v('defPct'))),
    crit: base.crit + v('crit'),
    speed: base.speed * (1 + v('speedPct')),
  };
  const ids = [BASE_ABILITY[cls], ...targets].slice(0, 4);
  const abs = ids.map((id) => ({ id, ...resolveAbility(tree, id, { weapon: gear.weapon }) }));
  const atkFor = (ab) => {
    if (!ab.inapt || !ab.refClasses?.length) return base.atk;
    return Math.min(base.atk, Math.max(...ab.refClasses.map((c) => playerStats(c, level, gear).atk)));
  };
  return {
    name: def.name, cls, level, alloc, spent: spentOf(cls, skills), budget, stats, abs, atkFor, gear,
    order: def.order || [1, 2, 3, 0].filter((i) => i < abs.length),
    ranged: def.ranged ?? cls !== 'warrior',
    mst: Math.max(40, Math.min(180, STAMINA.max + v('mst'))),
    stRegen: (STAMINA.regen + v('stRegen')) * (1 + v('stRegenPct')),
    stRegenDelayMs: Math.max(500, STAMINA.regenDelayMs + v('stRegenDelayMs')),
    usable: abs.every((a) => a.usable),
  };
}

/** Cost to reach every node from an allocation (Dijkstra, variants never used as a step). */
function distances(cls, alloc) {
  const dist = new Map();
  const prev = new Map();
  const start = ['coeur', CLASS_START[cls], ...Object.keys(alloc)];
  const pq = start.map((id) => [id, 0, null]);
  const nodes = new Map(TREE.nodes.map((n) => [n.id, n]));
  while (pq.length) {
    let bi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i][1] < pq[bi][1]) bi = i;
    const [id, d, from] = pq.splice(bi, 1)[0];
    if (dist.has(id)) continue;
    dist.set(id, d);
    prev.set(id, from);
    const n = nodes.get(id);
    if (n.type === 'variant' && !alloc[id]) continue;
    for (const l of n.links) if (!dist.has(l)) pq.push([l, d + nodeCost(nodes.get(l), cls), id]);
  }
  return { dist, prev };
}

/** Builds of the report (docs/EQUILIBRAGE.md « Arbre des Brumes »): 2 per class + 2 hybrids. */
export const BUILDS = [
  { name: 'Guerrier Gardien', cls: 'warrior', garde: true, targets: ['heavy_blow', 'shield_bash', 'war_cry'], fill: ['gardien', 'tronc'] },
  { name: 'Guerrier Berserker', cls: 'warrior', garde: true, targets: ['whirlwind', 'rend', 'rage'], fill: ['berserker', 'tronc'] },
  { name: 'Mage Pyromancien', cls: 'mage', targets: ['fireball', 'ignite', 'heal'], variants: ['ma_v_bolt_feu'], fill: ['pyromancie', 'tronc'] },
  { name: 'Mage de Givre', cls: 'mage', targets: ['ice_lance', 'frost_nova', 'heal'], fill: ['givre', 'tronc'] },
  { name: 'Rôdeur Tireur', cls: 'ranger', targets: ['piercing_shot', 'rapid_fire', 'arrow_rain'], fill: ['tireur', 'origine'] },
  { name: 'Rôdeur Venin', cls: 'ranger', targets: ['fleche_empoisonnee', 'fleche_barbelee', 'marque_de_chasse'], fill: ['venin', 'origine'] },
  { name: 'Hybride Lame spirituelle (Guerrier → Mage)', cls: 'warrior', garde: true, targets: ['blade_wave', 'enchant_blade', 'heavy_blow'], fill: ['lame_spirituelle', 'tronc'], weapon: 'runeblade' },
  { name: 'Hybride Mage de bataille (Mage + Tourbillon)', cls: 'mage', targets: ['whirlwind', 'fireball', 'heal'], fill: ['pyromancie', 'tronc'], weapon: 'runeblade', ranged: false },
];

/** Matchups of the tree builds (monsters scaled to the level: the v0.3 regions come with the world update). */
export const TREE_MATCHUPS = {
  10: [['skeleton', 10, 'brute'], ['skeleton', 10, 'occultist'], ['goblin', 9, 'thrower']],
  20: [['skeleton', 19, 'brute'], ['skeleton', 19, 'occultist'], ['wolf', 19, null]],
  30: [['skeleton', 29, 'brute'], ['skeleton', 29, 'occultist'], ['goblin', 29, 'skirmisher']],
};

export function buildMatchup(build, type, mLevel, variant, n = 100, seed = 1) {
  const rng = mulberry32(seed * 7919 + build.level * 131 + type.length * 17 + build.name.length * 1009);
  let t = 0, dmg = 0, deaths = 0, mp = 0;
  for (let i = 0; i < n; i++) {
    const r = fight(build.cls, build.level, type, mLevel, variant, rng, null, build);
    t += r.t; dmg += r.dmgTaken; deaths += r.died ? 1 : 0; mp += r.mpUsed;
  }
  const p = makePlayer(build.cls, build.level, build);
  const ttk = t / n, dmgTaken = dmg / n, deathRate = deaths / n;
  const hpDown = Math.max(0, dmgTaken - (ttk + TRAVEL_S) * p.mhp * REGEN.hpCombat) / (p.mhp * REGEN.hpRest);
  const mpDown = Math.max(0, mp / n - (ttk + TRAVEL_S) * p.mmp * REGEN.mpCombat) / (p.mmp * REGEN.mpRest);
  const cycle = ttk + Math.max(hpDown, mpDown) + deathRate * DEATH_PENALTY_S + TRAVEL_S;
  const xp = monsterXp(type, mLevel, build.level) * (1 - deathRate);
  return { build: build.name, level: build.level, type, variant, mLevel, ttk, dmgPct: dmgTaken / p.mhp, deathRate, xpm: (xp / cycle) * 60 };
}

export function runTreeBalance({ n = 100, seed = 1 } = {}) {
  const rows = [];
  const eff = {};
  const builds = {};
  for (const level of Object.keys(TREE_MATCHUPS).map(Number)) {
    eff[level] = {};
    for (const def of BUILDS) {
      const b = makeBuild(def, level);
      builds[`${def.name}@${level}`] = b;
      let sum = 0;
      for (const [type, mLevel, variant] of TREE_MATCHUPS[level]) {
        const r = buildMatchup(b, type, mLevel, variant, n, seed);
        rows.push(r);
        sum += r.xpm;
      }
      eff[level][def.name] = sum / TREE_MATCHUPS[level].length;
    }
  }
  return { rows, eff, builds };
}

export function formatTreeReport(res) {
  const out = [];
  const levels = Object.keys(res.eff);
  out.push(`| Build | ${levels.map((l) => `Niv. ${l} (XP/min)`).join(' | ')} | Points niv. 30 | Barre (1 à 4) |`);
  out.push(`|---|${levels.map(() => '---:').join('|')}|---:|---|`);
  for (const def of BUILDS) {
    const b30 = res.builds[`${def.name}@30`];
    out.push(`| ${def.name} | ${levels.map((l) => Math.round(res.eff[l][def.name])).join(' | ')} | ${b30.spent}/${b30.budget} | ${b30.abs.map((a) => `${a.name}${a.inapt ? ' (Inapte)' : ''}`).join(', ')} |`);
  }
  out.push('');
  out.push('| Build | Niv. | Adversaire | TTK (s) | Dégâts subis (% PV) | Morts |');
  out.push('|---|---:|---|---:|---:|---:|');
  for (const r of res.rows) {
    const vname = (MONSTERS[r.type].variants || []).find((v) => v.key === r.variant)?.name;
    out.push(`| ${r.build} | ${r.level} | ${vname || MONSTERS[r.type].name} niv. ${r.mLevel} | ${f1(r.ttk)} | ${Math.round(r.dmgPct * 100)} % | ${Math.round(r.deathRate * 100)} % |`);
  }
  return out.join('\n');
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
    const vname = (MONSTERS[r.type].variants || []).find((v) => v.key === r.variant)?.name;
    const name = `${vname || MONSTERS[r.type].name} niv. ${r.mLevel}`;
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
  console.log('\n## Arbre des Brumes (builds)\n');
  console.log(formatTreeReport(runTreeBalance({ n: Math.max(40, Math.round((Number(process.argv[2]) || 150) / 2)) })));
}
