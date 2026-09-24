// [skilltree] L'Arbre des Brumes: tree rules (shared/skills.js), server allocation / loadout / Renaissance, v0.1 / v0.2
// migration, the data-driven ability engine (all 65 abilities, kinds and modifiers), Fondamentaux (jump vs ring
// telegraph, guard / parry, charged attack) and anti-cheat.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ABILITIES, MAX_LEVEL, xpToNext, ITEMS } from '../../shared/data.js';
import {
  TREE, NODES, points, nodeCost, validateTree, allocate, unlockedAbilities, resolveAbility, buildTree, legacySkills,
  freshSkills, checkLoadout, sanitizeSkills, budgetOf, spentOf, BASE_ABILITY, NOT_SLOTTABLE, repairLoadout, reachCosts,
  RENAISSANCE, renaissanceTitle, isInapt, CLASS_START, cheapestPath, pointsSummary,
} from '../../shared/skills.js';
import { migrateAccount, migrateCharacter, newCharacter } from '../src/persistence.js';
import { telegraphs } from '../src/systems/telegraph.js';
import { damagePlayer, grantXp } from '../src/systems/players.js';
import { EXOTIC } from '../src/systems/abilities.js';
import { onLevelUp } from '../src/systems/skills.js';
import { render, SOURCE, TARGET } from '../../scripts/build-skilltree.mjs';
import { makeGame, addPlayer, place, advance, spawnAt, zoneOf } from './helpers.js';
import { skillsFor, WEAPON_FOR } from './support/treekit.js';

const CLS = ['warrior', 'mage', 'ranger'];
// fights happen in the skeletons' zone (a monster far from its zone leashes home and becomes invulnerable)
const Z = zoneOf('skeleton');
const ZX = Z.x, ZZ = Z.z;
const fond3 = { fond_roulade: 1, fond_sprint: 1, fond_saut: 1 };
const sk = (alloc = {}, extra = {}) => ({ alloc, gift: [], legacyFloor: 0, rb: 0, affinity: [], ...extra });

// ------------------------------------------------------------------ data
test('tree data: shared/skilltree.js is generated from docs/design/skilltree.json and up to date', () => {
  const src = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  assert.equal(fs.readFileSync(TARGET, 'utf8'), render(src), 'lancez node scripts/build-skilltree.mjs');
  assert.equal(TREE.nodes.length, 318);
  assert.equal(TREE.abilities.length, 65);
  for (const id of ['strike', 'heavy_blow', 'whirlwind', 'war_cry', 'firebolt', 'fireball', 'frost_nova', 'heal', 'shot', 'piercing_shot', 'arrow_rain', 'rapid_fire']) {
    assert.ok(ABILITIES[id], `capacité v0.2 conservée : ${id}`);
  }
  // links are symmetric, every node reachable from every class
  for (const n of TREE.nodes) for (const l of n.links) assert.ok(NODES.get(l).links.includes(n.id), `${n.id} ↔ ${l}`);
  for (const c of CLS) assert.equal(reachCosts(c).size, TREE.nodes.length, `tout l'arbre est joignable (${c})`);
});

test('points: 1 per level from 2, +1 every 5 levels (rules table), 35 at level 30; MAX_LEVEL 30', () => {
  for (const [lvl, pts] of Object.entries(TREE.rules.points.table)) assert.equal(points(Number(lvl)), pts, `niveau ${lvl}`);
  assert.equal(points(30), 35);
  assert.equal(MAX_LEVEL, 30);
  // xp: unchanged below 20 (saves keep their progress), then steeper, 0 at the max level
  assert.equal(xpToNext(1), 100);
  assert.equal(xpToNext(19), Math.floor(100 * 19 ** 1.5));
  assert.ok(xpToNext(20) > Math.floor(100 * 20 ** 1.5));
  for (let l = 1; l < 29; l++) assert.ok(xpToNext(l + 1) > xpToNext(l));
  assert.equal(xpToNext(30), 0);
});

test('costs: own class / Survie / near bridges 1, other class 2, other keystones and far bridge keystones 3', () => {
  for (const n of TREE.nodes) {
    for (const c of CLS) assert.equal(nodeCost(n, c), n.costs[c], `${n.id} pour ${c}`);
  }
  const cost = (id, c) => nodeCost(NODES.get(id), c);
  assert.equal(cost('fond_garde', 'mage'), 1);
  assert.equal(cost('gu_coup_puissant', 'warrior'), 1);
  assert.equal(cost('gu_coup_puissant', 'mage'), 2);
  assert.equal(cost('mage_depart', 'warrior'), 2);
  const otherKs = TREE.nodes.find((n) => n.type === 'keystone' && n.region === 'mage');
  assert.equal(nodeCost(otherKs, 'warrior'), 3);
  // Renaissance affinity: that class's nodes cost 1
  assert.equal(nodeCost(NODES.get('gu_coup_puissant'), 'mage', ['warrior']), 1);
  assert.equal(nodeCost(NODES.get('guerrier_depart'), 'mage', ['warrior']), 1);
});

test('validation: gate of 3 Fondamentaux, points, ranks, level, exclusive groups, connectivity, variants, region points', () => {
  const v = (cls, level, alloc, extra) => validateTree(cls, level, sk(alloc, extra));
  assert.equal(v('warrior', 5, { fond_garde: 1, gu_coup_puissant: 1 }).code, 'tree_gate');
  assert.ok(v('warrior', 5, { ...fond3, gu_coup_puissant: 1 }).ok);
  assert.equal(v('warrior', 3, { ...fond3, gu_coup_puissant: 1 }).code, 'tree_points');
  assert.equal(v('warrior', 30, { ...fond3, sv_souplesse: 4 }).code, 'tree_rank');
  assert.equal(v('warrior', 5, { ...fond3, sv_souplesse: 1, sv_longue_esquive: 1, ks_danseur: 1 }).code, 'tree_level'); // min. level 10
  assert.equal(v('warrior', 30, { ...fond3, sv_souplesse: 1, sv_pas_ombre: 1, sv_roulade_lourde: 1 }).code, 'tree_exclusive');
  assert.equal(v('warrior', 30, { ...fond3, gu_ga_cri_ralliement: 1 }).code, 'tree_link');
  assert.equal(v('warrior', 30, { ...fond3, ro_ti_trait_fatal: 1 }).ok, false);
  // ultimates need points spent in their region first (reqRegionPoints)
  const full = skillsFor('ranger', 'trait_fatal').sk.alloc;
  assert.ok(validateTree('ranger', 30, sk(full)).ok);
  const path = cheapestPath('ranger', Object.keys(fond3), 'ro_ti_trait_fatal').path;
  const bare = { ...fond3 };
  for (const id of path) bare[id] = 1;
  assert.equal(validateTree('ranger', 30, sk(bare)).code, 'tree_req');
  // points never negative: any accepted state spends at most the budget
  for (const c of CLS) {
    for (let level = 1; level <= 30; level += 7) {
      const res = allocate(c, level, sk(), ['fond_roulade', 'fond_sprint', 'fond_saut', 'fond_garde', 'fond_charge'].slice(0, points(level)));
      if (points(level) === 0) assert.equal(res.ok, false);
      else assert.ok(res.ok && res.spent <= res.budget, `${c} niveau ${level}`);
    }
  }
});

test('allocate: all or nothing, unreachable / expensive nodes refused, random walks never go over budget', () => {
  const base = sk({ ...fond3 });
  const bad = allocate('warrior', 10, base, ['gu_coup_puissant', 'ma_ks_erudit_martial']);
  assert.equal(bad.ok, false);
  assert.deepEqual(base.alloc, fond3, 'rien n\'est modifié');
  // another class's keystone costs 3 and must be connected
  assert.equal(allocate('warrior', 30, base, ['ma_ks_erudit_martial']).code, 'tree_link');
  // expensive: a level 4 warrior (3 points spent) cannot buy the mage start (2 points)
  assert.equal(allocate('warrior', 4, base, ['mage_depart']).code, 'tree_points');
  // fuzz: random affordable steps from the frontier; the state stays valid and within budget
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (const c of CLS) {
    let s = sk({ ...fond3 });
    for (let i = 0; i < 400; i++) {
      const owned = new Set([...Object.keys(s.alloc), 'coeur', CLASS_START[c]]);
      const frontier = TREE.nodes.filter((n) => !owned.has(n.id) && n.type !== 'root' && n.links.some((l) => owned.has(l)));
      const pick = frontier[Math.floor(rnd() * frontier.length)];
      const res = allocate(c, 30, s, [pick.id]);
      if (res.ok) s = { ...s, alloc: res.alloc };
      const val = validateTree(c, 30, s);
      assert.ok(val.ok && val.spent <= val.budget && budgetOf(30, s) - spentOf(c, s) >= 0);
    }
    assert.ok(spentOf(c, s) >= 30, `${c}: l'arbre se remplit (${spentOf(c, s)} points)`);
  }
});

// ------------------------------------------------------------------ server: allocation, loadout
test('server: skill_alloc / skill_alloc_batch validated server-side, new abilities auto-slotted, self fields', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'warrior', fresh: true });
  const s = p.session;
  const self = p.selfState();
  assert.deepEqual(self.abilities, ['strike', null, null, null]);
  assert.deepEqual(self.points, { total: 0, spent: 0, free: 0, floor: 0 });
  assert.deepEqual(self.tree, { alloc: {}, gift: [], affinity: [] });
  assert.equal(self.renaissance.n, 0);
  game.handleMessage(p, { t: 'skill_alloc', node: 'fond_roulade' });
  assert.equal(s.last('err').code, 'tree_points');
  grantXp(game, p, xpToNext(1) + xpToNext(2) + xpToNext(3) + xpToNext(4));
  assert.equal(p.level, 5);
  assert.equal(p.selfField('points').total, 5);
  s.clear();
  game.handleMessage(p, { t: 'skill_alloc', node: 'gu_coup_puissant' });
  assert.equal(s.last('err').code, 'tree_gate');
  game.handleMessage(p, { t: 'skill_alloc_batch', nodes: ['fond_roulade', 'fond_sprint', 'fond_garde', 'nope'] });
  assert.equal(s.last('err').code, 'tree_unknown');
  assert.deepEqual(p.skills.alloc, {}, 'tout ou rien');
  game.handleMessage(p, { t: 'skill_alloc_batch', nodes: ['fond_roulade', 'fond_sprint', 'fond_garde'] });
  game.handleMessage(p, { t: 'skill_alloc', add: [{ id: 'gu_coup_puissant' }] });
  assert.deepEqual(p.skills.alloc, { fond_roulade: 1, fond_sprint: 1, fond_garde: 1, gu_coup_puissant: 1 });
  assert.equal(p.loadout[1], 'heavy_blow', 'la nouvelle compétence arrive dans la barre');
  const last = s.last('self', (m) => 'loadout' in m);
  assert.equal(last.loadout[1], 'heavy_blow');
  assert.deepEqual(last.points, { total: 5, spent: 4, free: 1, floor: 0 });
  assert.ok(s.notes('level').some((t) => t.includes('Coup puissant')));
  // persisted with the character
  p.syncAccount();
  assert.equal(p.account.skills.alloc.gu_coup_puissant, 1);
});

test('server: tree spam and forged nodes are flagged, oversized batches refused', () => {
  const game = makeGame();
  const flags = [];
  game.security.flag = (pl, code) => flags.push(code);
  const p = addPlayer(game, { cls: 'mage', fresh: true, level: 10 });
  game.handleMessage(p, { t: 'skill_alloc', node: '__proto__' });
  assert.ok(flags.includes('tree_forged'));
  game.handleMessage(p, { t: 'skill_alloc_batch', nodes: new Array(65).fill('fond_saut') });
  assert.ok(flags.includes('tree_spam'));
  for (let i = 0; i < 8; i++) game.handleMessage(p, { t: 'skill_alloc', node: 'fond_saut' });
  assert.equal(p.session.last('err').code, 'rate_limit');
  assert.ok(flags.filter((f) => f === 'tree_spam').length >= 2);
});

test('loadout: 8 slots saved per character, base attack in slot 1, only learnt abilities, potions allowed', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'mage' }); // migrated v0.2 mage
  const s = p.session;
  game.handleMessage(p, { t: 'loadout', slots: ['firebolt', 'heal', 'frost_nova', 'fireball', 'item:potion_mp_s', 'item:potion_hp_s', null, null] });
  assert.deepEqual(p.loadout.slice(0, 4), ['firebolt', 'heal', 'frost_nova', 'fireball']);
  assert.deepEqual(p.selfField('abilities'), ['firebolt', 'heal', 'frost_nova', 'fireball'], 'vue v0.2 = 4 premiers emplacements');
  for (const bad of [
    ['heal', 'firebolt', null, null, null, null, null, null], // slot 0 must be a base attack
    ['firebolt', 'whirlwind', null, null, null, null, null, null], // not learnt
    ['firebolt', 'roulade', null, null, null, null, null, null], // Fondamental: own key
    ['firebolt', 'heal', 'heal', null, null, null, null, null], // duplicate
    ['firebolt', 'item:rusty_sword', null, null, null, null, null, null], // not a consumable
    ['firebolt', null, null, null],
    'firebolt',
  ]) {
    s.clear();
    game.clockRef.t += 300; // stay under the tree message rate
    game.handleMessage(p, { t: 'loadout', slots: bad });
    assert.equal(s.last('err')?.code, 'loadout_bad', JSON.stringify(bad));
  }
  // a potion on the bar is used from the bag
  place(game, p, 50, 30);
  p.mp = 1;
  const n0 = p.inv.reduce((n, x) => n + (x?.id === 'potion_mp_s' ? x.q : 0), 0);
  game.handleMessage(p, { t: 'ability', slot: 4 });
  assert.equal(p.inv.reduce((n, x) => n + (x?.id === 'potion_mp_s' ? x.q : 0), 0), n0 - 1);
  // slot 5..8 work like 1..4 (v0.3 clients)
  const m = spawnAt(game, 'slime', 50, 34);
  game.handleMessage(p, { t: 'loadout', slots: ['firebolt', null, null, null, null, null, null, 'fireball'] });
  p.mp = p.mmp;
  game.handleMessage(p, { t: 'ability', slot: 7, tg: m.id });
  advance(game, 1200);
  assert.ok(s.of('dmg', (d) => d.ab === 'fireball' && d.src === p.id).length === 1);
  assert.ok(s.of('cd', (c) => c.slot === 7 && c.ab === 'fireball').length === 1);
  assert.deepEqual(checkLoadout(null, new Set()), { ok: false });
});

// ------------------------------------------------------------------ migration
test('migration v0.1 / v0.2: Roulade + Sprint offered, point floor, the 4 v0.2 abilities on the same keys', () => {
  const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
  const v2 = JSON.parse(fs.readFileSync(`${dir}v0.2/accounts/gardienne.json`, 'utf8'));
  const acc = migrateAccount(v2);
  const ch = acc.chars[0];
  assert.equal(ch.cls, 'ranger');
  assert.equal(ch.level, 12);
  assert.deepEqual(ch.skills.gift, ['fond_roulade', 'fond_sprint']);
  assert.equal(ch.skills.migrated, 'v0.2');
  assert.deepEqual(ch.skills.loadout.slice(0, 4), ['shot', 'piercing_shot', 'arrow_rain', 'rapid_fire']);
  assert.deepEqual(ch.skills.loadout.slice(4, 6), ['item:potion_hp_s', 'item:potion_mp_s']);
  const val = validateTree('ranger', 12, ch.skills);
  assert.ok(val.ok);
  assert.equal(val.budget, points(12), 'level 12: its own points (13), the floor no longer matters');
  assert.equal(budgetOf(12, ch.skills) - val.spent, 13 - 6, '7 points free to spend');
  const v1 = JSON.parse(fs.readFileSync(`${dir}v0.1/accounts.json`, 'utf8'));
  for (const raw of Object.values(v1.accounts)) {
    const a = migrateAccount(raw);
    if (!a) continue;
    for (const c of a.chars) {
      const res = validateTree(c.cls, c.level, c.skills);
      assert.ok(res.ok, `${c.name}: ${JSON.stringify(res)}`);
      const unlocked = unlockedAbilities(c.cls, c.skills.alloc, c.skills.gift);
      for (const id of ['roulade', 'sprint']) assert.ok(unlocked.has(id), `${c.name} garde ${id}`);
      for (const id of { warrior: ['strike', 'heavy_blow', 'whirlwind', 'war_cry'], mage: ['firebolt', 'fireball', 'frost_nova', 'heal'], ranger: ['shot', 'piercing_shot', 'arrow_rain', 'rapid_fire'] }[c.cls]) {
        assert.ok(unlocked.has(id) && c.skills.loadout.includes(id), `${c.name} (${c.cls}, niv. ${c.level}) garde ${id}`);
      }
    }
  }
  // level 1 v0.2 characters too (floor = preset cost)
  for (const cls of CLS) {
    const c = migrateCharacter({ name: `Ancien${cls}`, cls, level: 1 });
    const res = validateTree(cls, 1, c.skills);
    assert.ok(res.ok && res.spent === TREE.migration.presets[cls].cost && res.budget === res.spent, cls);
    assert.equal(c.skills.loadout.filter((x) => x && !x.startsWith('item:')).length, 4);
  }
  // a new character does not get the migration; a saved v0.3 state is kept as is
  const fresh = newCharacter('Novice', 'mage');
  assert.deepEqual(fresh.skills.alloc, {});
  assert.deepEqual(fresh.skills.gift, []);
  const again = migrateCharacter(JSON.parse(JSON.stringify(ch)));
  assert.deepEqual(again.skills, ch.skills);
  // a corrupted state is repaired without losing points (they come back unspent)
  const broken = sanitizeSkills({ alloc: { fond_roulade: 1, gu_coup_puissant: 9, nope: 1, __proto__: 1 }, gift: ['fond_garde'], loadout: 'x', rb: 99 }, 'warrior', 3);
  assert.ok(validateTree('warrior', 3, broken).ok);
  assert.equal(broken.rb, RENAISSANCE.max);
  assert.deepEqual(broken.gift, []);
  assert.equal(broken.loadout[0], 'strike');
});

test('migrated characters are not nerfed on first login: same abilities, same slots, usable immediately', () => {
  const game = makeGame();
  for (const cls of CLS) {
    const acc = migrateCharacter({ name: `Retour${cls}`, cls, level: 3, eq: newCharacter('X', cls).eq, inv: newCharacter('X', cls).inv });
    const p = game.addPlayer(acc, new (class { constructor() { this.msgs = []; } send(m) { this.msgs.push(m); } sendRaw() {} })());
    assert.deepEqual(p.abilities, { warrior: ['strike', 'heavy_blow', 'whirlwind', 'war_cry'], mage: ['firebolt', 'fireball', 'frost_nova', 'heal'], ranger: ['shot', 'piercing_shot', 'arrow_rain', 'rapid_fire'] }[cls]);
    assert.ok(p.tree.unlocked.has('roulade') && p.tree.unlocked.has('sprint'));
    for (const id of p.abilities) assert.ok(resolveAbility(p.tree, id, { weapon: p.eq.weapon }).usable, `${cls}: ${id} utilisable avec l'arme de départ`);
    // the v0.3 patch notes of the first-login card exist for every class
    assert.ok(TREE.rules.migration.notes[cls].length >= 2);
  }
  // v0.2 Soin healed 35 %: a migrated Mage keeps 35 % (Rémanence, offered by the preset), at every level
  for (const lvl of [1, 10, 30]) {
    const heal = resolveAbility(buildTree('mage', legacySkills('mage', lvl)), 'heal');
    assert.ok(Math.max(heal.heal || 0, heal.hot?.pct || 0) >= 0.35, `Soin du Mage migré niv. ${lvl}`);
  }
  // Roulade / Sprint stay free for veterans (DECISIONS §3, documented in docs/COMPTES.md)
  assert.equal(pointsSummary('warrior', 30, legacySkills('warrior', 30)).spent, TREE.migration.presets.warrior.cost);
});

test('tree data follows DECISIONS §3 / §4: no reset, Espace = Saut, Maj = Roulade / Sprint, no hard-coded key in descriptions', () => {
  assert.equal(TREE.rules.respec, undefined);
  assert.equal(TREE.rules.migration.respecFree, undefined);
  assert.ok(!/[Rr]éinitialisation gratuite/.test(JSON.stringify(TREE.rules)));
  assert.equal(TREE.rules.keys.saut, 'Space');
  assert.match(TREE.rules.keys.roulade, /^ShiftLeft/);
  const ab = (id) => TREE.abilities.find((a) => a.id === id);
  assert.equal(ab('saut').defaultKey, 'Space');
  assert.match(ab('roulade').defaultKey, /^ShiftLeft/);
  for (const id of ['fond_roulade', 'fond_sprint', 'fond_saut']) assert.ok(!/\((Espace|Maj|C)\)/.test(NODES.get(id).desc), id);
});

// ------------------------------------------------------------------ Renaissance
test('Renaissance: level 30, back to level 1, every point refunded, gear / gold / quests kept, cumulative bonuses', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'warrior', level: 29, gold: 999, quests: { q_slimes: { state: 'done', n: 8 } }, eq: { weapon: 'runeblade', armor: 'golem_plate' } });
  place(game, p, 0, 5);
  const s = p.session;
  game.handleMessage(p, { t: 'renaissance', confirm: true });
  assert.equal(s.last('err').code, 'renaissance_level');
  p.level = 30;
  onLevelUp(game, p);
  // no Arbre-Brume in the world yet: the ritual is done from the tree screen, the notification says so
  assert.ok(s.notes('level').some((t) => t.includes('Renaissance est disponible') && !t.includes('Arbre-Brume')));
  p.lastCombat = game.now();
  game.handleMessage(p, { t: 'renaissance', confirm: true });
  assert.equal(s.last('err').code, 'tree_combat');
  p.lastCombat = -Infinity;
  game.handleMessage(p, { t: 'renaissance' });
  assert.equal(s.last('err').code, 'bad_request');
  game.handleMessage(p, { t: 'renaissance', confirm: true });
  assert.equal(p.level, 1);
  assert.equal(p.xp, 0);
  assert.deepEqual(p.skills.alloc, {});
  assert.deepEqual(p.skills.gift, [], 'même les Fondamentaux offerts sont à rechoisir');
  assert.equal(p.skills.legacyFloor, 0);
  assert.equal(p.skills.rb, 1);
  assert.equal(p.gold, 999);
  assert.deepEqual(p.quests, { q_slimes: { state: 'done', n: 8 } });
  // over-level gear goes back to the bag (room available)
  assert.deepEqual(p.eq, { weapon: null, armor: null });
  assert.ok(p.inv.some((x) => x?.id === 'runeblade') && p.inv.some((x) => x?.id === 'golem_plate'));
  assert.deepEqual(p.loadout.slice(0, 4), ['strike', null, null, null]);
  const r = p.selfField('renaissance');
  assert.equal(r.n, 1);
  assert.equal(r.title, 'Né de la Brume I');
  assert.equal(p.staticState().rb, 1, 'aura visible de tous');
  assert.equal(p.selfField('points').total, 1, '+1 point bonus au niveau 1');
  // +15 % XP
  const before = p.xp;
  grantXp(game, p, 20);
  assert.equal(p.xp - before, 23);
  // Inaptitude −5 points per Renaissance (−25 % → −20 %)
  const t0 = buildTree('mage', sk({ ...fond3 }));
  const t1 = buildTree('mage', sk({ ...fond3 }, { rb: 1 }));
  const t5 = buildTree('mage', sk({ ...fond3 }, { rb: 5 }));
  const w0 = resolveAbility(t0, 'whirlwind', { weapon: 'steel_sword' });
  const w1 = resolveAbility(t1, 'whirlwind', { weapon: 'steel_sword' });
  const w5 = resolveAbility(t5, 'whirlwind', { weapon: 'steel_sword' });
  assert.ok(Math.abs(w0.power - ABILITIES.whirlwind.power * 0.75) < 1e-9);
  assert.ok(Math.abs(w1.power - ABILITIES.whirlwind.power * 0.8) < 1e-9);
  assert.ok(Math.abs(w5.power - ABILITIES.whirlwind.power) < 1e-9 && w5.inapt === 0);
  // 2nd Renaissance: an affinity class is required, its nodes cost 1
  p.level = 30;
  game.handleMessage(p, { t: 'renaissance', confirm: true });
  assert.equal(s.last('err').code, 'bad_request');
  game.handleMessage(p, { t: 'renaissance', confirm: true, affinity: 'warrior' });
  assert.equal(s.last('err').code, 'bad_request', 'pas sa propre classe');
  game.handleMessage(p, { t: 'renaissance', confirm: true, affinity: 'mage' });
  assert.equal(p.skills.rb, 2);
  assert.deepEqual(p.skills.affinity, ['mage']);
  assert.equal(nodeCost(NODES.get('ma_fireball'), 'warrior', p.skills.affinity), 1);
  for (let i = 3; i <= 5; i++) {
    p.level = 30;
    game.handleMessage(p, { t: 'renaissance', confirm: true, affinity: 'ranger' });
    assert.equal(p.skills.rb, i);
  }
  assert.equal(renaissanceTitle(5), 'Né de la Brume V');
  p.level = 30;
  game.handleMessage(p, { t: 'renaissance', confirm: true, affinity: 'ranger' });
  assert.equal(s.last('err').code, 'renaissance_max');
  // persisted
  p.syncAccount();
  assert.equal(migrateCharacter(p.account).skills.rb, 5);
});

// ------------------------------------------------------------------ resolution
test('resolveAbility: variants, passives, Inaptitude (design example), weapons, guardrails', () => {
  // design §3.4: a level 18 mage with the Tourbillon → ×1.43, 25 mana, 23 stamina, 12 s
  const { sk: s1 } = skillsFor('mage', 'whirlwind', { level: 18 });
  const t = buildTree('mage', s1);
  const w = resolveAbility(t, 'whirlwind', { weapon: 'steel_sword' });
  assert.ok(isInapt(ABILITIES.whirlwind, 'mage'));
  assert.ok(Math.abs(w.power - 1.425) < 1e-9, `×${w.power}`); // ×1.43 in the design (rounded)
  assert.equal(w.mp, 25);
  assert.equal(w.st, 23);
  assert.equal(w.cd, 12);
  assert.deepEqual(w.refClasses, ['warrior']);
  assert.equal(resolveAbility(t, 'whirlwind', { weapon: 'arcane_staff' }).usable, false, 'une compétence de mêlée demande une arme de mêlée');
  // focus without a focus: −20 %
  const tm = buildTree('mage', legacySkills('mage', 5));
  assert.equal(resolveAbility(tm, 'fireball', { weapon: 'arcane_staff' }).weaponMult, 1);
  assert.equal(resolveAbility(tm, 'fireball', { weapon: 'steel_sword' }).weaponMult, 0.8);
  // base attacks are never greyed out
  assert.ok(resolveAbility(tm, 'firebolt', { weapon: null }).usable);
  // variant: Trait de feu (element + burn), Frappe éclair
  const fb = resolveAbility(tm, 'firebolt', {});
  assert.ok(fb.tags.includes('feu') && !fb.tags.includes('arcane') && fb.applies.includes('brulure'));
  const tw = buildTree('warrior', sk({ ...fond3, gu_frappe_eclair: 1 }));
  const st = resolveAbility(tw, 'strike', { weapon: 'rusty_sword' });
  assert.equal(st.cd, 1);
  assert.equal(st.st, 4);
  // passives per rank: Souplesse −2 stamina per rank; guardrail: roll cost ≥ 12 unless Danseur des brumes
  const tr = buildTree('warrior', sk({ ...fond3, sv_souplesse: 3 }));
  assert.equal(resolveAbility(tr, 'roulade', {}).st, 24);
  const tp = buildTree('warrior', sk({ ...fond3, sv_souplesse: 3, sv_pas_ombre: 1 }));
  assert.equal(resolveAbility(tp, 'roulade', {}).st, 16);
  const td = buildTree('warrior', sk({ ...fond3, sv_souplesse: 1, sv_aplomb: 1, sv_longue_esquive: 2, ks_danseur: 1 }));
  const rd = resolveAbility(td, 'roulade', {});
  assert.equal(rd.st, 0);
  assert.equal(rd.cd, 1.8);
  assert.ok(rd.iframeMs <= 450, 'invulnérabilité de roulade plafonnée');
  // tree damage envelope capped at +75 %
  const big = buildTree('warrior', sk());
  big.stats.set('dmgPct', 3);
  assert.equal(resolveAbility(big, 'strike', {}).dmgPct, 0.75);
});

// ------------------------------------------------------------------ ability engine
test('ability engine: every one of the 65 abilities runs from the data (right weapon, learnt through the tree)', () => {
  const homeCls = (a) => (a.home == null ? 'warrior' : Array.isArray(a.home) ? a.home[0] : a.home);
  let n = 0;
  for (const a of TREE.abilities) {
    if (NOT_SLOTTABLE.has(a.id)) continue;
    const cls = homeCls(a);
    const { sk: s1, res } = skillsFor(cls, a.id);
    assert.ok(res.ok, `${a.id}: ${JSON.stringify(res)}`);
    const game = makeGame();
    s1.loadout = repairLoadout([BASE_ABILITY[cls], a.base ? null : a.id], unlockedAbilities(cls, s1.alloc), cls);
    const weapon = WEAPON_FOR[a.weapon] || { warrior: 'steel_sword', mage: 'arcane_staff', ranger: 'long_bow' }[cls];
    const p = addPlayer(game, { cls, level: 30, skills: s1, eq: { weapon, armor: 'leather_tunic' } });
    const m = spawnAt(game, 'skeleton', ZX, ZZ);
    const m2 = spawnAt(game, 'skeleton', ZX + 1.5, ZZ + 1);
    for (const x of [m, m2]) { x.hp = x.mhp = 50_000; x.speed = 0; x.atkReady = Infinity; }
    place(game, p, ZX, ZZ + 2.4);
    p.ry = Math.PI;
    p.hp = Math.round(p.mhp / 2);
    p.lastBlockAt = game.now(); // Riposte follows a block
    const slot = a.base ? 0 : 1;
    game.handleMessage(p, { t: 'ability', slot, tg: m.id, x: ZX, z: ZZ });
    if (a.kind === 'trap') { advance(game, 1100); m.x = p.x + Math.sin(p.ry) * 1.5; m.z = p.z + Math.cos(p.ry) * 1.5; }
    advance(game, 4000);
    const s = p.session;
    assert.deepEqual(s.of('err').map((e) => e.code), [], `${a.id} : aucune erreur`);
    const did = s.of('dmg', (d) => d.src === p.id && (d.ab === a.id || d.ab === 'brulure' || d.ab === 'poison' || d.ab === 'saignement')).length
      + s.of('heal', (h) => h.tg === p.id).length
      + s.of('fx', (f) => (f.src === p.id || f.tg === m.id) && (f.ab === a.id || f.k === 'status') && ['buff', 'zone', 'trap', 'status', 'dash', 'aoe'].includes(f.k)).length;
    assert.ok(did > 0, `${a.id} (${a.kind}) a un effet`);
    n++;
  }
  assert.equal(n, 65 - NOT_SLOTTABLE.size + 0);
});

/** A character of `cls` with the abilities of `extra` nodes (cheapest paths), level 30, in front of a big skeleton. */
function arena(cls, abilityId, { extra = [], weapon, monsters = 1, gap = 2.4 } = {}) {
  const { sk: s1, res } = skillsFor(cls, abilityId, { extra });
  assert.ok(res.ok, JSON.stringify(res));
  const game = makeGame({ seed: 5 });
  const unlocked = unlockedAbilities(cls, s1.alloc);
  s1.loadout = repairLoadout([BASE_ABILITY[cls], abilityId], unlocked, cls);
  const w = weapon || WEAPON_FOR[ABILITIES[abilityId].weapon] || { warrior: 'steel_sword', mage: 'arcane_staff', ranger: 'long_bow' }[cls];
  const p = addPlayer(game, { cls, level: 30, skills: s1, eq: { weapon: w, armor: 'leather_tunic' } });
  const ms = [];
  for (let i = 0; i < monsters; i++) {
    const m = spawnAt(game, 'skeleton', ZX + i * 1.2, ZZ - i * 1.5);
    m.hp = m.mhp = 50_000; m.speed = 0; m.atkReady = Infinity; m.brain.guard = null;
    ms.push(m);
  }
  place(game, p, ZX, ZZ + gap);
  p.ry = Math.PI;
  return { game, p, ms, m: ms[0], s: p.session, cast: (msg = {}) => game.handleMessage(p, { t: 'ability', slot: 1, tg: ms[0].id, x: ms[0].x, z: ms[0].z, ...msg }) };
}
const dmgOf = (s, ab, tg) => s.of('dmg', (d) => d.ab === ab && (!tg || d.tg === tg));

test('ability modifiers: projectile count, pierce, splash, cone, chained hits, cast time, mana / stamina / cooldown', () => {
  // Trait jumeau: 2 projectiles, one per target
  let a = arena('mage', 'firebolt', { extra: ['ma_v_bolt_jumeaux'], monsters: 2, gap: 8 });
  a.p.skills.loadout = ['firebolt', null, null, null, null, null, null, null];
  a.game.handleMessage(a.p, { t: 'ability', slot: 0, tg: a.m.id });
  advance(a.game, 800);
  assert.deepEqual(new Set(dmgOf(a.s, 'firebolt').map((d) => d.tg)), new Set(a.ms.map((m) => m.id)));
  // Lance-glacier: pierces every monster on the line
  a = arena('mage', 'ice_lance', { extra: ['ma_v_lance_glacier'], monsters: 1, gap: 8 });
  const behind = spawnAt(a.game, 'skeleton', ZX, ZZ - 4);
  behind.hp = behind.mhp = 50_000; behind.speed = 0; behind.atkReady = Infinity;
  a.cast();
  advance(a.game, 1500);
  assert.ok(dmgOf(a.s, 'ice_lance', a.m.id).length === 1 && dmgOf(a.s, 'ice_lance', behind.id).length === 1, 'perforation');
  // Boule de feu: cast time (nothing spent before), splash, burn
  a = arena('mage', 'fireball', { monsters: 2, gap: 8 });
  const mp0 = a.p.mp;
  a.cast();
  assert.equal(a.p.mp, mp0, 'incantation : rien n\'est dépensé avant la fin');
  assert.equal(a.p.casting.id, 'fireball');
  advance(a.game, 1200);
  assert.equal(a.p.mp < mp0, true);
  assert.equal(new Set(dmgOf(a.s, 'fireball').map((d) => d.tg)).size, 2, 'explosion');
  assert.ok(a.s.of('fx', (f) => f.k === 'status' && f.st === 'brulure').length >= 1);
  advance(a.game, 3000);
  assert.ok(dmgOf(a.s, 'brulure').length >= 4, 'la brûlure brûle (tics de 0,5 s)');
  // a roll cancels a cast: no mana spent, no cooldown
  a = arena('mage', 'heal', { monsters: 1 });
  a.p.hp = 10;
  const mp1 = a.p.mp;
  a.cast();
  a.game.handleMessage(a.p, { t: 'dodge', dx: 1, dz: 0 });
  advance(a.game, 1500);
  assert.equal(a.p.session.of('heal').length, 0);
  assert.ok(a.p.mp >= mp1 - 0.01 && a.p.cdOf('heal') === 0, 'soin annulé : mana non dépensée');
  // Souffle ardent: channelled cone, drains mana and stamina per second
  a = arena('mage', 'flame_breath', { monsters: 2, gap: 3 });
  a.cast();
  advance(a.game, 2600);
  assert.ok(dmgOf(a.s, 'flame_breath').length >= 12, 'cône canalisé (tics de 0,25 s sur deux cibles)');
  assert.ok(a.p.st < a.p.mst - 20);
  // Danse des lames: 3 hits, one cooldown
  a = arena('warrior', 'blade_dance');
  a.cast();
  advance(a.game, 1500);
  assert.equal(dmgOf(a.s, 'blade_dance').length, 3);
  assert.equal(a.s.of('cd', (c) => c.ab === 'blade_dance').length, 1);
});

test('ability modifiers: statuses (bleed, burn, poison, frost, slow, stun, mark), lifesteal, recovery', () => {
  // Entaille: bleed wound 180 % over 6 s
  let a = arena('warrior', 'rend');
  a.cast();
  advance(a.game, 400);
  const hit = dmgOf(a.s, 'rend')[0].v;
  advance(a.game, 6500);
  const bleed = dmgOf(a.s, 'saignement').reduce((n, d) => n + d.v, 0);
  assert.ok(Math.abs(bleed - hit * 1.8) <= 14, `saignement ${bleed} ≈ 1,8 × ${hit}`);
  // Flèche empoisonnée: poison stacks, no poise
  a = arena('ranger', 'fleche_empoisonnee', { gap: 8 });
  a.cast();
  advance(a.game, 400);
  assert.equal(a.m.status.poison.length, 1);
  const poise = a.m.poiseDmg;
  advance(a.game, 6500);
  assert.equal(dmgOf(a.s, 'poison').length, 6);
  assert.equal(a.m.poiseDmg, poise, 'le poison n\'inflige pas de déséquilibre');
  // Nova de givre: 2 stacks of Froid, slower monster and slower wind-ups
  a = arena('mage', 'frost_nova');
  a.m.speed = 4;
  a.cast();
  assert.equal(a.m.status.froid.n, 2);
  // Filet: −60 % speed for 3 s
  a = arena('ranger', 'filet', { gap: 8 });
  a.cast();
  advance(a.game, 700);
  assert.ok(a.m.status.slow.pct >= 0.59);
  // Coup de bouclier écrasant: stun 1.2 s (never a boss)
  a = arena('warrior', 'shield_bash', { extra: ['gu_ga_bouclier_ecrasant'] });
  a.cast();
  advance(a.game, 300);
  assert.ok(a.m.status.stun && a.m.act?.kind === 'stagger');
  // Marque du chasseur: +15 % damage taken from the marker
  a = arena('ranger', 'marque_de_chasse', { gap: 8 });
  a.cast();
  assert.ok(a.m.status.mark.pct === 0.15 && a.m.status.mark.src === a.p.id);
  // lifesteal (Soif de sang) on melee hits, capped at 9 %
  a = arena('warrior', 'strike', { extra: ['gu_be_soif'] });
  a.p.hp = 100;
  a.game.handleMessage(a.p, { t: 'ability', slot: 0, tg: a.m.id });
  advance(a.game, 250);
  const d = dmgOf(a.s, 'strike')[0].v;
  assert.ok(a.p.hp > 100 && a.p.hp - 100 <= d * 0.09 + 3, 'vol de vie');
  // recovery: commitment after a heavy blow
  a = arena('warrior', 'heavy_blow');
  a.cast();
  assert.ok(a.p.recoverUntil > a.game.now() && a.p.recoverSlow === ABILITIES.heavy_blow.recSlow);
});

test('Inaptitude in play: out-of-class cost, cooldown and reference attack; weapon required', () => {
  const a = arena('mage', 'whirlwind', { weapon: 'steel_sword' });
  const mp0 = a.p.mp;
  a.cast();
  assert.equal(mp0 - a.p.mp, Math.ceil(ABILITIES.whirlwind.mp * 1.25));
  advance(a.game, 400);
  assert.ok(dmgOf(a.s, 'whirlwind').length === 1);
  assert.equal(a.s.last('cd', (c) => c.ab === 'whirlwind').ms, Math.round(ABILITIES.whirlwind.cd * 1.2 * 1000));
  const b = arena('mage', 'whirlwind', { weapon: 'arcane_staff' });
  b.cast();
  assert.equal(b.s.last('err').code, 'no_weapon');
  assert.match(b.s.last('err').msg, /arme de mêlée/);
});

// ------------------------------------------------------------------ Fondamentaux
test('jump: airborne window clears ring / shockwave telegraphs (lo), not normal ones; stamina, cooldown, locked', () => {
  const game = makeGame();
  const fresh = addPlayer(game, { cls: 'ranger', fresh: true });
  game.handleMessage(fresh, { t: 'jump', dx: 0, dz: 1 });
  assert.equal(fresh.session.last('err').code, 'locked');
  const p = addPlayer(game, { cls: 'mage' }); // migrated mage: Saut in its preset
  place(game, p, 50, 30);
  const src = spawnAt(game, 'golem', 57, 30);
  src.atkReady = Infinity;
  const stomp = (lo) => telegraphs(game).start(src, { shape: 'ring', x: 57, z: 30, r: 10, r2: 4.2 }, 900, {
    ab: 'golem_stomp', lo, onHit: (pl) => damagePlayer(game, pl, src, 11, false, 'golem_stomp', { tele: true, lo, boss: true }),
  });
  const s = p.session;
  stomp(true);
  assert.equal(s.last('tele').lo, 1);
  advance(game, 600);
  const st0 = p.st;
  game.handleMessage(p, { t: 'jump', dx: 0, dz: 0 });
  assert.equal(st0 - p.st, ABILITIES.saut.st);
  game.handleMessage(p, { t: 'jump', dx: 0, dz: 0 });
  assert.equal(s.last('err').code, 'cooldown');
  advance(game, 400);
  assert.equal(s.of('dmg', (d) => d.tg === p.id).length, 0, 'saut au-dessus de l\'onde de choc');
  assert.ok(s.of('fx', (f) => f.k === 'dodge' && f.tg === p.id).length >= 1);
  // a normal (non-lo) telegraph still hits an airborne player; the landing staggers
  advance(game, 1500);
  stomp(false);
  advance(game, 600);
  game.handleMessage(p, { t: 'jump', dx: 0, dz: 0 });
  advance(game, 400);
  assert.equal(s.of('dmg', (d) => d.tg === p.id).length, 1);
  advance(game, 200);
  assert.ok(s.of('fx', (f) => f.k === 'vacille' && f.src === p.id).length >= 1, 'touché en l\'air : vacillement à l\'atterrissage');
  // no speed gain: the movement allowance of a jump is the walking speed
  advance(game, 1500);
  game.handleMessage(p, { t: 'jump', dx: 1, dz: 0 });
  assert.ok(p.maxSpeedAt(game.now() + 100) <= p.stats.speed * 1.0001);
});

test('guard: frontal block costs stamina, guard break, parry window (variant), rasants and imblocables pass', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'warrior', level: 10 }); // migrated warrior: Garde in its preset
  place(game, p, 50, 30);
  const m = spawnAt(game, 'skeleton', 50, 32);
  m.atkReady = Infinity;
  p.ry = 0; // facing +z, towards the skeleton
  const s = p.session;
  game.handleMessage(p, { t: 'guard', on: true });
  assert.equal(p.guardUp, true);
  advance(game, 200); // raised after 150 ms
  const hp0 = p.hp, st0 = p.st;
  damagePlayer(game, p, m, 40, false, 'skel_swing', { kind: 'melee' });
  assert.equal(hp0 - p.hp, 20, 'arme de mêlée : 50 % bloqués');
  assert.ok(p.st < st0);
  assert.ok(s.last('fx', (f) => f.k === 'block' && f.src === p.id));
  // from behind: not blocked
  const back = spawnAt(game, 'skeleton', 50, 28);
  const hp1 = p.hp;
  damagePlayer(game, p, back, 40, false, 'skel_swing', { kind: 'melee' });
  assert.equal(hp1 - p.hp, 40);
  // rasant / imblocable pass through the guard
  const hp2 = p.hp;
  damagePlayer(game, p, m, 10, false, 'golem_quake', { tele: true, nb: true });
  assert.equal(hp2 - p.hp, 10);
  // guard break at 0 stamina: stagger 1 s, the hit goes through
  advance(game, 1200);
  p.hp = p.mhp;
  p.st = 2;
  game.handleMessage(p, { t: 'guard', on: true });
  advance(game, 200);
  damagePlayer(game, p, m, 40, false, 'skel_swing', { kind: 'melee' });
  assert.equal(p.mhp - p.hp, 40);
  assert.ok(s.last('fx', (f) => f.k === 'guard_break'));
  assert.ok(p.staggerUntil > game.now() + 500);
  game.handleMessage(p, { t: 'dodge', dx: 1, dz: 0 });
  assert.equal(s.last('err').code, 'staggered');
  // Parade parfaite: raised just before the impact → no damage, poise to the attacker, « Contre parfait »
  const q = addPlayer(game, { cls: 'warrior', level: 10, skills: { ...legacySkills('warrior', 10), alloc: { ...legacySkills('warrior', 10).alloc, sv_bras: 1, sv_parade: 1 } } });
  place(game, q, 60, 30);
  const m2 = spawnAt(game, 'skeleton', 60, 32);
  m2.atkReady = Infinity;
  q.ry = 0;
  game.handleMessage(q, { t: 'guard', on: true });
  advance(game, 50);
  const hq = q.hp;
  damagePlayer(game, q, m2, 40, false, 'skel_swing', { kind: 'melee' });
  assert.equal(q.hp, hq, 'parade : coup annulé');
  assert.ok(m2.poiseDmg >= 60 || m2.act?.kind === 'stagger');
  assert.ok(q.buffs.has('riposte_parfaite'));
  // the Riposte now works (it follows a block)
  place(game, q, 60, 30);
  q.mp = q.mmp;
});

test('parry lockout: toggling the guard at 5 Hz parries < 30 % of the hits, raises > 4/s are flagged guard_spam', () => {
  const game = makeGame();
  const base = legacySkills('warrior', 10);
  const q = addPlayer(game, { cls: 'warrior', level: 10, skills: { ...base, alloc: { ...base.alloc, sv_bras: 1, sv_parade: 1 } } });
  place(game, q, 60, 30);
  const m = spawnAt(game, 'skeleton', 60, 32);
  m.atkReady = Infinity;
  q.ry = 0;
  const flags = [];
  const flag0 = game.security.flag.bind(game.security);
  game.security.flag = (t, code, ...rest) => { flags.push(code); return flag0(t, code, ...rest); };
  let parried = 0, hits = 0, rng = 1;
  for (let i = 0; i < 60; i++) {
    game.handleMessage(q, { t: 'guard', on: false });
    game.handleMessage(q, { t: 'guard', on: true });
    const phase = 50 * (rng = (rng * 7 + 3) % 4); // the hit lands 0..150 ms after the raise
    advance(game, phase);
    q.hp = q.mhp;
    damagePlayer(game, q, m, 40, false, 'skel_swing', { kind: 'melee' });
    hits++;
    if (q.hp === q.mhp) parried++;
    advance(game, 200 - phase);
    q.staggerUntil = 0;
  }
  assert.ok(parried / hits < 0.3, `parades : ${parried}/${hits}`);
  assert.ok(parried > 0, 'une parade par seconde reste possible');
  assert.ok(flags.includes('guard_spam'));
  // a patient player (guard lowered for > 1 s) still gets his parry
  game.handleMessage(q, { t: 'guard', on: false });
  advance(game, 1100);
  game.handleMessage(q, { t: 'guard', on: true });
  advance(game, 50);
  q.hp = q.mhp;
  damagePlayer(game, q, m, 40, false, 'skel_swing', { kind: 'melee' });
  assert.equal(q.hp, q.mhp, 'parade');
});

test('charged attack: hold the base attack, ×1.0 → ×1.8 power, poise ×2, cooldown from the release, lost on hit', () => {
  const a = arena('warrior', 'strike', { extra: ['fond_charge'] });
  const { game, p, m, s } = a;
  game.handleMessage(p, { t: 'ability', slot: 0, ph: 'start', tg: m.id });
  assert.ok(p.charging);
  assert.equal(p.entState(game.now()).ac & 4, 4);
  advance(game, 1300);
  game.handleMessage(p, { t: 'ability', slot: 0, ph: 'release', tg: m.id });
  advance(game, 100);
  const charged = s.last('fx', (f) => f.k === 'charged');
  assert.equal(charged.lvl, 1);
  const d = dmgOf(s, 'strike');
  assert.equal(d.length, 1);
  assert.ok(m.poiseDmg >= ABILITIES.strike.poise * 2 - 0.01 || m.act?.kind === 'stagger');
  assert.ok(p.cdOf('strike') > game.now(), 'recharge depuis le relâchement');
  // too early = normal attack
  advance(game, 2000);
  game.handleMessage(p, { t: 'ability', slot: 0, ph: 'start', tg: m.id });
  advance(game, 200);
  game.handleMessage(p, { t: 'ability', slot: 0, ph: 'release', tg: m.id });
  advance(game, 300);
  assert.equal(dmgOf(s, 'strike').length, 2);
  // hit while charging (outside the super-armour): lost, no cost
  advance(game, 2000);
  game.handleMessage(p, { t: 'ability', slot: 0, ph: 'start', tg: m.id });
  advance(game, 300);
  const st0 = p.st;
  damagePlayer(game, p, m, 5, false, 'skel_swing', { kind: 'melee' });
  assert.equal(p.charging, null);
  assert.equal(p.st, st0);
  // not learnt: refused
  const b = arena('warrior', 'heavy_blow');
  b.game.handleMessage(b.p, { t: 'ability', slot: 0, ph: 'start', tg: b.m.id });
  assert.equal(b.s.last('err').code, 'locked');
});

test('roll variants and perfect dodge: Pas de l\'ombre, Esquive parfaite (stamina back, « Contre parfait »)', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'ranger', skills: { ...legacySkills('ranger', 10), alloc: { ...legacySkills('ranger', 10).alloc, sv_souplesse: 1, sv_esquive_parfaite: 1 } }, level: 10 });
  place(game, p, 50, 30);
  const m = spawnAt(game, 'skeleton', 50, 33);
  m.atkReady = Infinity;
  game.handleMessage(p, { t: 'dodge', dx: 1, dz: 0 });
  const st = p.st;
  damagePlayer(game, p, m, 30, false, 'skel_swing', { kind: 'melee' });
  assert.equal(p.hp, p.mhp);
  assert.ok(p.st > st, 'esquive parfaite : endurance rendue');
  assert.ok(p.buffs.has('riposte_parfaite'));
  const q = addPlayer(game, { cls: 'ranger', skills: { ...legacySkills('ranger', 10), alloc: { ...legacySkills('ranger', 10).alloc, sv_souplesse: 1, sv_pas_ombre: 1 } }, level: 10 });
  place(game, q, 60, 30);
  const st0 = q.st;
  game.handleMessage(q, { t: 'dodge', dx: 1, dz: 0 });
  assert.equal(st0 - q.st, 20, 'Pas de l\'ombre : 22 − 2 (Souplesse)');
  assert.equal(q.iframeUntil - game.now(), 200);
  assert.ok(Math.abs(q.rollSpeed - 3 / 0.15) < 1e-9);
});

test('anti-cheat: Fondamentaux not learnt are refused, a second take-off in the air is flagged, sprint needs the node', () => {
  const game = makeGame();
  const flags = [];
  game.security.flag = (pl, code) => flags.push(code);
  const p = addPlayer(game, { cls: 'warrior', fresh: true });
  place(game, p, 50, 30);
  game.handleMessage(p, { t: 'dodge', dx: 1, dz: 0 });
  assert.equal(p.session.last('err').code, 'locked');
  assert.equal(p.rollUntil, 0, 'aucune roulade');
  game.handleMessage(p, { t: 'guard', on: true });
  assert.equal(p.guardUp, false);
  game.handleMessage(p, { t: 'sprint', on: true });
  assert.equal(p.sprintReq, false);
  assert.equal(p.maxSpeedAt(game.now()), p.stats.speed, 'pas de vitesse de sprint sans le Fondamental');
  const q = addPlayer(game, { cls: 'mage' });
  place(game, q, 55, 30);
  game.handleMessage(q, { t: 'jump', dx: 0, dz: 1 });
  advance(game, 100);
  game.handleMessage(q, { t: 'jump', dx: 0, dz: 1 });
  assert.ok(flags.includes('jump_air'));
  // an ability that is not on the bar / not learnt cannot be cast (the bar is server-side)
  game.handleMessage(p, { t: 'loadout', slots: ['strike', 'whirlwind', null, null, null, null, null, null] });
  assert.equal(p.session.last('err').code, 'loadout_bad');
  game.handleMessage(p, { t: 'ability', slot: 3 });
  assert.equal(p.session.last('err').code, 'bad_request');
});

test('statuses on EntState, exotic mechanics are listed', () => {
  const a = arena('mage', 'frost_nova');
  a.cast();
  assert.ok(a.m.entState(a.game.now()).stt & 2);
  assert.ok(Object.keys(EXOTIC).length > 20);
  for (const v of Object.values(EXOTIC)) assert.match(v, /^[✓✗]/);
  // ITEMS weapons carry tags for the tree requirements
  for (const [id, it] of Object.entries(ITEMS)) if (it.type === 'weapon') assert.ok(Array.isArray(it.wt) && it.wt.length, id);
  assert.equal(freshSkills('ranger').loadout[0], 'shot');
});

test('coverage: every field / stat modified by the tree is read by the engine or listed as approximated', async () => {
  const { coverage } = await import('../../scripts/skilltree-coverage.mjs');
  const c = coverage(EXOTIC);
  assert.deepEqual(c.missing.map((m) => m.f), []);
  assert.deepEqual(c.statsMissing.map((m) => m.s), []);
  assert.ok(c.engine.length > 90 && c.stats.length > 80);
});

test('keystones in play: Coups mesurés (1 critical in 4), Dernier souffle (survive a lethal hit), Course feutrée (aggro)', () => {
  const game = makeGame();
  const s1 = skillsFor('warrior', 'strike', { extra: ['gu_md_ks_coups_mesures'] }).sk;
  s1.loadout = ['strike', null, null, null, null, null, null, null];
  const p = addPlayer(game, { cls: 'warrior', level: 30, skills: s1, eq: { weapon: 'steel_sword', armor: null } });
  const m = spawnAt(game, 'skeleton', ZX, ZZ);
  m.hp = m.mhp = 100_000; m.speed = 0; m.atkReady = Infinity; m.brain.guard = null;
  place(game, p, ZX, ZZ + 2.4);
  game.handleMessage(p, { t: 'ability', slot: 0, tg: m.id });
  advance(game, 8 * 1400);
  const crits = p.session.of('dmg', (d) => d.src === p.id && d.ab === 'strike').map((d) => d.crit);
  assert.ok(crits.length >= 8);
  crits.forEach((c, i) => assert.equal(c, (i + 1) % 4 === 0, `coup ${i + 1}`));
  // Dernier souffle
  const s2 = skillsFor('warrior', 'strike', { extra: ['ks_dernier_souffle'] }).sk;
  const q = addPlayer(game, { cls: 'warrior', level: 30, skills: s2 });
  place(game, q, ZX + 5, ZZ);
  damagePlayer(game, q, m, q.hp + 500, false, 'golem_punch', { kind: 'melee' });
  assert.equal(q.dead, false);
  assert.equal(q.hp, 1);
  assert.ok(q.iframeUntil > game.now());
  advance(game, 1000);
  damagePlayer(game, q, m, q.hp + 500, false, 'golem_punch', { kind: 'melee' });
  assert.equal(q.dead, true, 'une seule fois toutes les 120 s');
  // Course feutrée
  const s3 = skillsFor('ranger', 'shot', { extra: ['sv_course_feutree'] }).sk;
  const r = addPlayer(game, { cls: 'ranger', level: 30, skills: s3 });
  assert.equal(r.aggroMult, 0.6);
});
