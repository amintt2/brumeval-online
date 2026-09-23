import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, QUESTS, INV_SIZE, playerStats } from '../../shared/data.js';
import { C2S, CHAT_MAX_LEN, VIEW_RADIUS, KIND } from '../../shared/protocol.js';
import { SPAWN_ZONES } from '../../shared/world.js';
import { damageMonster } from '../src/systems/combat.js';
import { sanitizeChat, allowChat } from '../src/chat.js';
import { makeGame, addPlayer, place, advance, spawnAt } from './helpers.js';

const npcOf = (game, key) => [...game.npcs.values()].find((n) => n.key === key);
const count = (p, id) => p.inv.reduce((n, s) => n + (s && s.id === id ? s.q : 0), 0);
const slotOf = (p, id) => p.inv.findIndex((s) => s && s.id === id);

test('new characters start with class gear, gold and items', () => {
  const game = makeGame();
  const w = addPlayer(game, { cls: 'warrior' });
  const self = w.selfState();
  assert.equal(self.level, 1);
  assert.equal(self.gold, 25);
  assert.deepEqual(self.eq, { weapon: 'rusty_sword', armor: 'leather_tunic' });
  assert.deepEqual(self.inv[0], { id: 'potion_hp_s', q: 3 });
  assert.equal(self.inv.length, INV_SIZE);
  assert.deepEqual(self.abilities, ['strike', 'heavy_blow', 'whirlwind', 'war_cry']);
  const st = playerStats('warrior', 1, self.eq);
  assert.deepEqual(self.stats, { atk: st.atk, def: st.def, crit: st.crit, speed: st.speed });
  assert.equal(self.hp, st.mhp);
  assert.equal(self.dead, false);
  for (const k of ['id', 'name', 'cls', 'xp', 'xpNext', 'mhp', 'mp', 'mmp', 'quests', 'x', 'z', 'ry']) assert.ok(k in self, k);
});

test('use_item: potions heal / restore mana, full hp refused, equipment is equipped', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'mage' });
  place(game, p, 50, 30);
  const hpSlot = slotOf(p, 'potion_hp_s');
  game.handleMessage(p, { t: 'use_item', slot: hpSlot });
  assert.equal(p.session.last('err').code, 'cant_use');
  p.hp = 10;
  game.handleMessage(p, { t: 'use_item', slot: hpSlot });
  assert.equal(p.hp, 10 + ITEMS.potion_hp_s.heal);
  assert.deepEqual(p.session.last('heal'), { t: 'heal', tg: p.id, v: 60, hp: 70 });
  assert.equal(count(p, 'potion_hp_s'), 1);
  assert.equal(p.session.last('self').inv[hpSlot].q, 1);

  p.mp = 0;
  game.handleMessage(p, { t: 'use_item', slot: slotOf(p, 'potion_mp_s') });
  assert.equal(p.mp, ITEMS.potion_mp_s.mana);
  assert.equal(count(p, 'potion_mp_s'), 1);

  // junk cannot be used
  p.inv[10] = { id: 'slime_gel', q: 4 };
  game.handleMessage(p, { t: 'use_item', slot: 10 });
  assert.equal(p.session.last('err').code, 'cant_use');
  // empty / invalid slots
  game.handleMessage(p, { t: 'use_item', slot: 11 });
  game.handleMessage(p, { t: 'use_item', slot: 24 });
  game.handleMessage(p, { t: 'use_item', slot: '1' });
  assert.deepEqual(p.session.of('err').slice(-3).map((e) => e.code), ['bad_request', 'bad_request', 'bad_request']);

  // equipment through use_item
  p.level = 6;
  p.inv[12] = { id: 'arcane_staff', q: 1 };
  game.handleMessage(p, { t: 'use_item', slot: 12 });
  assert.equal(p.eq.weapon, 'arcane_staff');
  assert.deepEqual(p.inv[12], { id: 'apprentice_staff', q: 1 });
});

test('equip / unequip with class and level checks; stats recomputed and hp/mp clamped', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'mage' });
  p.inv[5] = { id: 'mage_robe', q: 1 };
  p.inv[6] = { id: 'steel_sword', q: 1 };
  game.handleMessage(p, { t: 'equip', slot: 5 });
  assert.deepEqual(p.session.last('err'), { t: 'err', code: 'cant_use', msg: 'Niveau 5 requis.' });
  game.handleMessage(p, { t: 'equip', slot: 6 });
  assert.deepEqual(p.session.last('err'), { t: 'err', code: 'cant_use', msg: 'Réservé à : Guerrier.' });
  game.handleMessage(p, { t: 'equip', slot: 0 });
  assert.equal(p.session.last('err').code, 'cant_use'); // potion

  p.level = 5;
  p.recomputeStats();
  const mmpBefore = p.mmp;
  game.handleMessage(p, { t: 'equip', slot: 5 });
  assert.equal(p.eq.armor, 'mage_robe');
  assert.deepEqual(p.inv[5], { id: 'leather_tunic', q: 1 });
  assert.equal(p.mmp, mmpBefore + ITEMS.mage_robe.mp);
  const self = p.session.last('self');
  assert.equal(self.eq.armor, 'mage_robe');
  assert.equal(self.mmp, p.mmp);
  assert.equal(self.stats.def, p.stats.def);
  assert.ok(p.session.notes('info').includes('Équipé : Robe de mage'));

  // unequip -> first empty slot; mp clamped to the new max
  p.mp = p.mmp;
  game.handleMessage(p, { t: 'unequip', slot: 'armor' });
  assert.equal(p.eq.armor, null);
  assert.equal(p.mp, p.mmp);
  assert.equal(count(p, 'mage_robe'), 1);
  game.handleMessage(p, { t: 'unequip', slot: 'armor' });
  assert.equal(p.session.last('err').code, 'bad_request');
  game.handleMessage(p, { t: 'unequip', slot: 'head' });
  assert.equal(p.session.last('err').code, 'bad_request');

  // unequip with a full inventory
  for (let i = 0; i < INV_SIZE; i++) if (!p.inv[i]) p.inv[i] = { id: 'slime_gel', q: 1 };
  game.handleMessage(p, { t: 'unequip', slot: 'weapon' });
  assert.equal(p.session.last('err').code, 'inv_full');
  assert.equal(p.eq.weapon, 'apprentice_staff');
});

test('drop destroys the whole stack', () => {
  const game = makeGame();
  const p = addPlayer(game);
  game.handleMessage(p, { t: 'drop', slot: 0 });
  assert.equal(p.inv[0], null);
  assert.ok(p.session.notes('info').includes('Objet jeté : Petite potion de soin x3'));
  game.handleMessage(p, { t: 'drop', slot: 0 });
  assert.equal(p.session.last('err').code, 'bad_request');
});

test('interact: range check, dialog payload for quest giver and merchant', () => {
  const game = makeGame();
  const p = addPlayer(game);
  const elder = npcOf(game, 'elder');
  const merchant = npcOf(game, 'merchant');
  place(game, p, elder.x + 10, elder.z);
  game.handleMessage(p, { t: 'interact', id: elder.id });
  assert.deepEqual(p.session.last('err'), { t: 'err', code: 'too_far', msg: 'Trop loin' });
  game.handleMessage(p, { t: 'interact', id: 'x' });
  assert.equal(p.session.last('err').code, 'bad_request');
  game.handleMessage(p, { t: 'interact', id: 424242 });
  assert.equal(p.session.last('err').code, 'no_target');

  place(game, p, elder.x + 2, elder.z + 2);
  game.handleMessage(p, { t: 'interact', id: elder.id });
  assert.deepEqual(p.session.last('dialog'), {
    t: 'dialog', id: elder.id, npc: 'elder', name: 'Ancien Aldric', text: elder.def.greeting,
    quests: [{ q: 'q_slimes', state: 'available', n: 0 }], shop: null,
  });
  place(game, p, merchant.x + 1, merchant.z);
  game.handleMessage(p, { t: 'interact', id: merchant.id });
  const d = p.session.last('dialog');
  assert.equal(d.npc, 'merchant');
  assert.deepEqual(d.quests, []);
  assert.deepEqual(d.shop, merchant.def.shop);
  assert.equal(merchant.entState().hp, merchant.mhp);
  assert.equal(merchant.staticState().nk, 'merchant');
});

test('shop: buy with gold / space checks, sell anywhere near the merchant only', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'ranger' });
  const merchant = npcOf(game, 'merchant');
  const elder = npcOf(game, 'elder');
  place(game, p, merchant.x + 2, merchant.z);
  game.handleMessage(p, { t: 'buy', id: merchant.id, item: 'potion_hp_s' });
  assert.equal(p.gold, 25 - 10);
  assert.equal(count(p, 'potion_hp_s'), 4);
  assert.ok(p.session.notes('gold').includes('Vous avez acheté : Petite potion de soin (−10 or)'));
  game.handleMessage(p, { t: 'buy', id: merchant.id, item: 'potion_hp_s', qty: 2 });
  assert.equal(p.session.last('err').code, 'no_gold');
  p.gold = 1000;
  game.handleMessage(p, { t: 'buy', id: merchant.id, item: 'potion_mp_s', qty: 3 });
  assert.equal(p.gold, 1000 - 45);
  assert.equal(count(p, 'potion_mp_s'), 3);
  for (const bad of [{ item: 'runeblade' }, { item: 'nope' }, { item: 'potion_hp_s', qty: 0 }, { item: 'potion_hp_s', qty: 21 }, { item: 'potion_hp_s', qty: 1.5 }]) {
    game.handleMessage(p, { t: 'buy', id: merchant.id, ...bad });
    assert.equal(p.session.last('err').code, 'bad_request', JSON.stringify(bad));
  }
  game.handleMessage(p, { t: 'buy', id: elder.id, item: 'potion_hp_s' });
  assert.equal(p.session.last('err').code, 'too_far');

  // sell a partial stack then the rest
  p.inv[8] = { id: 'wolf_pelt', q: 5 };
  game.handleMessage(p, { t: 'sell', id: merchant.id, slot: 8, qty: 2 });
  assert.equal(p.gold, 955 + 14);
  assert.equal(p.inv[8].q, 3);
  game.handleMessage(p, { t: 'sell', id: merchant.id, slot: 8 });
  assert.equal(p.inv[8], null);
  assert.equal(p.gold, 955 + 35);
  assert.ok(p.session.notes('gold').includes('Vous avez vendu : Fourrure de loup x3 (+21 or)'));
  game.handleMessage(p, { t: 'sell', id: merchant.id, slot: 8 });
  assert.equal(p.session.last('err').code, 'bad_request');
  game.handleMessage(p, { t: 'sell', id: merchant.id, slot: 0, qty: 99 });
  assert.equal(p.session.last('err').code, 'bad_request');

  // inventory full
  for (let i = 0; i < INV_SIZE; i++) p.inv[i] = { id: 'steel_sword', q: 1 };
  game.handleMessage(p, { t: 'buy', id: merchant.id, item: 'potion_hp_s' });
  assert.equal(p.session.last('err').code, 'inv_full');

  // too far / not a merchant
  place(game, p, merchant.x + 20, merchant.z);
  game.handleMessage(p, { t: 'sell', id: merchant.id, slot: 0 });
  assert.equal(p.session.last('err').code, 'too_far');
  place(game, p, elder.x + 1, elder.z);
  game.handleMessage(p, { t: 'sell', id: elder.id, slot: 0 });
  assert.equal(p.session.last('err').code, 'bad_target');
});

test('quest flow: accept, kill progress, ready, turn-in rewards, next quest unlocked by level', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'ranger' });
  const elder = npcOf(game, 'elder');
  place(game, p, elder.x + 2, elder.z);
  game.handleMessage(p, { t: 'quest_turnin', id: elder.id, q: 'q_slimes' });
  assert.equal(p.session.last('err').code, 'bad_request');
  game.handleMessage(p, { t: 'quest_accept', id: elder.id, q: 'q_wolves' });
  assert.equal(p.session.last('err').code, 'bad_request');
  game.handleMessage(p, { t: 'quest_accept', id: elder.id, q: 'q_slimes' });
  assert.deepEqual(p.quests.q_slimes, { state: 'active', n: 0 });
  assert.ok(p.session.notes('quest').includes('Quête acceptée : Nuisance gluante'));
  assert.deepEqual(p.session.last('self').quests, { q_slimes: { state: 'active', n: 0 } });
  assert.deepEqual(p.session.last('dialog').quests, [{ q: 'q_slimes', state: 'active', n: 0 }]);

  // 8 slime kills
  for (let i = 0; i < 8; i++) {
    const m = spawnAt(game, 'slime', 58, 30);
    damageMonster(game, m, p, 99999, false);
  }
  assert.deepEqual(p.quests.q_slimes, { state: 'ready', n: 8 });
  assert.ok(p.session.notes('quest').includes('Gluants éliminés : 8/8'));

  const gold = p.gold, pots = count(p, 'potion_hp_s');
  p.session.clear();
  game.handleMessage(p, { t: 'quest_turnin', id: elder.id, q: 'q_slimes' });
  assert.deepEqual(p.quests.q_slimes, { state: 'done', n: 8 });
  assert.equal(p.gold, gold + QUESTS.q_slimes.reward.gold);
  assert.equal(count(p, 'potion_hp_s'), pots + 3);
  assert.ok(p.session.notes('quest').includes('Quête terminée : Nuisance gluante'));
  assert.ok(p.session.notes('xp').includes('+250 XP'));
  const d = p.session.last('dialog');
  assert.equal(d.text, QUESTS.q_slimes.done);
  // q_wolves needs level 3
  if (p.level >= 3) assert.deepEqual(d.quests, [{ q: 'q_wolves', state: 'available', n: 0 }]);
  else assert.deepEqual(d.quests, []);
  game.handleMessage(p, { t: 'quest_turnin', id: elder.id, q: 'q_slimes' });
  assert.equal(p.session.last('err').code, 'bad_request');
});

test('quest turn-in refuses when rewards do not fit; class item reward', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'mage', level: 12, quests: { q_golem: { state: 'ready', n: 1 } } });
  const elder = npcOf(game, 'elder');
  place(game, p, elder.x + 2, elder.z);
  for (let i = 0; i < INV_SIZE; i++) p.inv[i] = { id: 'steel_sword', q: 1 };
  game.handleMessage(p, { t: 'quest_turnin', id: elder.id, q: 'q_golem' });
  assert.equal(p.session.last('err').code, 'inv_full');
  assert.equal(p.quests.q_golem.state, 'ready');
  p.inv[3] = null;
  game.handleMessage(p, { t: 'quest_turnin', id: elder.id, q: 'q_golem' });
  assert.equal(p.quests.q_golem.state, 'done');
  assert.deepEqual(p.inv[3], { id: 'ember_staff', q: 1 });
});

test('chat: global, whispers, /who, /help, unknown command, sanitising, rate limit', () => {
  const game = makeGame();
  const a = addPlayer(game, { name: 'Aline' });
  const b = addPlayer(game, { name: 'Bérénice' });
  game.handleMessage(a, { t: 'chat', text: '  salut\u0007 tout le monde  ' });
  assert.deepEqual(b.session.last('chat'), { t: 'chat', ch: 'global', from: 'Aline', text: 'salut  tout le monde' });
  assert.ok(a.session.last('chat', (c) => c.ch === 'global'));

  game.handleMessage(a, { t: 'chat', text: '/w bérénice  on se retrouve au puits ?' });
  assert.deepEqual(b.session.last('chat'), { t: 'chat', ch: 'whisper_in', from: 'Aline', text: 'on se retrouve au puits ?' });
  assert.deepEqual(a.session.last('chat'), { t: 'chat', ch: 'whisper_out', to: 'Bérénice', text: 'on se retrouve au puits ?' });

  game.handleMessage(a, { t: 'chat', text: '/w Fantome coucou' });
  assert.equal(a.session.last('err').code, 'no_target');
  game.clockRef.t += 6000;
  game.handleMessage(a, { t: 'chat', text: '/w Aline moi-même' });
  assert.equal(a.session.last('err').code, 'bad_target');
  game.handleMessage(a, { t: 'chat', text: '/w' });
  assert.match(a.session.last('chat').text, /Usage/);
  game.handleMessage(a, { t: 'chat', text: '/who' });
  assert.match(a.session.last('chat').text, /^2 joueurs en ligne : Aline \(Guerrier niv\. 1\), Bérénice/);
  game.handleMessage(a, { t: 'chat', text: '/danse' });
  assert.match(a.session.last('chat').text, /Commande inconnue/);
  game.clockRef.t += 6000;
  a.session.clear();
  game.handleMessage(a, { t: 'chat', text: '/help' });
  assert.ok(a.session.of('chat').length >= 4);
  assert.ok(a.session.of('chat').every((c) => c.ch === 'system'));

  // long messages are capped, empty ones ignored
  b.session.clear();
  game.handleMessage(a, { t: 'chat', text: 'abcdefghij '.repeat(100) });
  assert.equal(b.session.last('chat').text.length, CHAT_MAX_LEN);
  game.handleMessage(a, { t: 'chat', text: '    ' });
  game.handleMessage(a, { t: 'chat', text: 42 });
  assert.equal(b.session.of('chat').length, 1);

  // rate limit: 5 messages / 5 s
  game.clockRef.t += 6000;
  a.session.clear();
  for (let i = 0; i < 6; i++) game.handleMessage(a, { t: 'chat', text: `msg ${i}` });
  assert.deepEqual(a.session.of('err').map((e) => e.code), ['rate_limit']);
  game.clockRef.t += 5001;
  game.handleMessage(a, { t: 'chat', text: 'de nouveau' });
  assert.equal(a.session.of('err').length, 1);

  assert.equal(sanitizeChat('a‮b'), 'a b');
  const times = [];
  for (let i = 0; i < 5; i++) assert.ok(allowChat(times, 1000));
  assert.equal(allowChat(times, 1000), false);
  assert.ok(allowChat(times, 6000));
});

test('join / leave system messages; disconnect removes the entity (gone) and clears threat', () => {
  const game = makeGame();
  const a = addPlayer(game, { name: 'Anselme' });
  const bAcc = { name: 'Basile' };
  const b = addPlayer(game, bAcc);
  assert.ok(a.session.of('chat').some((c) => c.ch === 'system' && c.text === 'Basile a rejoint Brumeval.'));
  place(game, a, 58, 34);
  place(game, b, 58, 33);
  const m = spawnAt(game, 'slime', 58, 30);
  damageMonster(game, m, b, 3, false);
  advance(game, 100);
  assert.ok(a.session.last('snap').ents.some((e) => e.id === b.id));
  game.removePlayer(b);
  assert.equal(b.account.x, 58);
  assert.ok(!game.entities.has(b.id));
  assert.equal(m.threat.size, 0);
  assert.ok(a.session.of('chat').some((c) => c.text === 'Basile a quitté Brumeval.'));
  advance(game, 100);
  assert.ok(a.session.of('snap').some((s) => s.gone.includes(b.id)));
  assert.equal(game.playerByName('basile'), null);
  game.removePlayer(b); // idempotent
});

test('snapshots: AOI, static fields on first sight / change only, gone, self always included', () => {
  const game = makeGame();
  const a = addPlayer(game, { cls: 'mage', name: 'Anna' });
  const b = addPlayer(game, { cls: 'ranger', name: 'Bruno' });
  const golem = spawnAt(game, 'golem');
  place(game, a, 0, 7);
  place(game, b, 0, 7 + VIEW_RADIUS + 20);
  advance(game, 100);
  let snap = a.session.last('snap');
  assert.equal(snap.on, 2);
  assert.ok(snap.tod >= 0 && snap.tod < 1);
  assert.ok(Number.isInteger(snap.tick));
  const selfEnt = snap.ents.find((e) => e.id === a.id);
  assert.deepEqual(Object.keys(selfEnt).sort(), ['c', 'hp', 'id', 'k', 'lv', 'm', 'mhp', 'n', 'ry', 's', 'tg', 'x', 'z'].sort());
  assert.equal(selfEnt.k, KIND.PLAYER);
  assert.ok(!snap.ents.some((e) => e.id === b.id), 'b is out of the AOI');
  assert.ok(!snap.ents.some((e) => e.id === golem.id), 'golem is far away');
  const elder = snap.ents.find((e) => e.nk === 'elder');
  assert.equal(elder.k, 'npc');
  assert.equal(elder.m, 'npc_elder');

  // b comes into view: full state once, then dynamic fields only
  place(game, b, 5, 12);
  advance(game, 100);
  snap = a.session.last('snap');
  const bFull = snap.ents.find((e) => e.id === b.id);
  assert.equal(bFull.n, 'Bruno');
  assert.equal(bFull.c, 'ranger');
  assert.equal(bFull.m, 'ranger');
  advance(game, 100);
  const bDyn = a.session.last('snap').ents.find((e) => e.id === b.id);
  assert.deepEqual(Object.keys(bDyn).sort(), ['hp', 'id', 'mhp', 'ry', 's', 'tg', 'x', 'z']);
  assert.equal(a.session.last('snap').ents.find((e) => e.id === a.id).n, undefined);

  // hysteresis: slightly beyond VIEW_RADIUS keeps it, far beyond sends gone
  place(game, b, 0, 7 + VIEW_RADIUS + 2);
  advance(game, 100);
  assert.ok(a.session.last('snap').ents.some((e) => e.id === b.id));
  place(game, b, 0, 7 + VIEW_RADIUS + 10);
  advance(game, 100);
  assert.ok(a.session.last('snap').gone.includes(b.id));
  assert.ok(!a.session.last('snap').ents.some((e) => e.id === b.id));
  // and full static fields again when it comes back
  place(game, b, 3, 9);
  advance(game, 100);
  assert.equal(a.session.last('snap').ents.find((e) => e.id === b.id).n, 'Bruno');

  // monsters carry mt / sc / b
  place(game, a, golem.x - 10, golem.z);
  advance(game, 100);
  const g = a.session.last('snap').ents.find((e) => e.id === golem.id);
  assert.equal(g.mt, 'golem');
  assert.equal(g.b, 1);
  assert.equal(g.sc, 1);
  assert.equal(g.k, 'monster');
  assert.equal(typeof g.sl, 'number');
});

test('snapshot sizes stay reasonable with the full world', () => {
  const game = makeGame({ spawnMonsters: true });
  const p = addPlayer(game);
  place(game, p, 40, 20);
  advance(game, 300);
  assert.ok(p.session.of('snap').length >= 3);
  const first = JSON.stringify(p.session.of('snap')[0]);
  const later = JSON.stringify(p.session.last('snap'));
  assert.ok(later.length < first.length);
  assert.ok(later.length < 8000, `snap too big: ${later.length}`);
  assert.equal(game.monsters.size, SPAWN_ZONES.reduce((n, z) => n + z.count, 0));
});

test('fuzz: garbage payloads for every message type never throw', () => {
  const game = makeGame({ spawnMonsters: true });
  const p = addPlayer(game, { cls: 'ranger' });
  place(game, p, 50, 25);
  const junk = [undefined, null, 0, -1, 1.5, 1e308, NaN, '', 'x', '__proto__', [], {}, [1, 2], { a: 1 }, true, 'weapon', 'armor', 23, 24, 3, 99999];
  let n = 0;
  for (const t of [...Object.values(C2S), 'toString', '__proto__', 'constructor', 'hasOwnProperty']) {
    for (const v of junk) {
      for (const f of ['slot', 'tg', 'x', 'z', 'id', 'q', 'item', 'qty', 'text', 'c', 'ry', 'name', 'password', 'cls']) {
        game.handleMessage(p, { t, [f]: v });
        n++;
      }
      game.handleMessage(p, { t, slot: v, tg: v, x: v, z: v, id: v, q: v, item: v, qty: v, text: v });
    }
  }
  advance(game, 500);
  assert.ok(n > 1000);
  assert.ok(game.players.has(p.id));
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.hp));
});
