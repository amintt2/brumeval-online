import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SPAWN_POINT, LAKES } from '../../shared/world.js';
import { AccountStore, newAccount, sanitizeAccount, migrateCharacter, writeFileAtomic, ACCOUNT_VERSION } from '../src/persistence.js';
import { makeGame, addPlayer, place } from './helpers.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brumeval-persist-'));
const quiet = { info() {}, warn() {}, error() {} };

test('save / load round trip keeps every character field', () => {
  const dir = tmp();
  try {
    const store = new AccountStore(dir, quiet).load();
    const account = store.create(newAccount('Éloïse', 'mage', 'ab', 'cd'));
    const acc = account.chars[0];
    Object.assign(acc, { level: 7, xp: 123, gold: 456, hp: 80, mp: 12, x: 40.5, z: 21.25 });
    acc.inv[4] = { id: 'wolf_pelt', q: 9 };
    acc.quests = { q_slimes: { state: 'done', n: 8 }, q_wolves: { state: 'active', n: 2 } };
    assert.equal(store.save(true), true);
    assert.equal(store.dirty, false);
    assert.deepEqual(fs.readdirSync(dir), ['accounts']);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'accounts')), ['éloïse.json'], 'one file per account, no temp file left behind');

    const again = new AccountStore(dir, quiet).load();
    assert.equal(again.size, 1);
    const b = again.get('ÉLOÏSE');
    assert.ok(b, 'case-insensitive lookup');
    for (const k of ['id', 'name', 'cls', 'level', 'xp', 'gold', 'hp', 'mp', 'x', 'z']) assert.equal(b[k], acc[k], k);
    const ab = again.getAccount('éloïse');
    for (const k of ['login', 'salt', 'hash', 'uid', 'lastChar']) assert.equal(ab[k], account[k], k);
    assert.deepEqual(b.inv, acc.inv);
    assert.deepEqual(b.eq, acc.eq);
    assert.deepEqual(b.quests, acc.quests);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt legacy accounts.json is set aside and the server starts empty', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'accounts.json'), '{ oops');
    const store = new AccountStore(dir, quiet).load();
    assert.equal(store.size, 0);
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('accounts.json.corrompu-')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sanitizeAccount repairs or rejects persisted records', () => {
  assert.equal(sanitizeAccount(null), null);
  assert.equal(sanitizeAccount({ name: 'x', cls: 'mage', salt: 'a', hash: 'b' }), null);
  assert.equal(sanitizeAccount({ name: 'Valide', cls: 'paladin', salt: 'a', hash: 'b' }), null);
  assert.equal(sanitizeAccount({ name: 'Valide', cls: 'mage' }), null);
  const lake = LAKES[0];
  const a = migrateCharacter({
    name: 'Valide', cls: 'warrior', salt: 'a', hash: 'b', level: 99, xp: -5, gold: 'lots',
    eq: { weapon: 'leather_tunic', armor: 'chainmail' }, inv: 'bad', quests: { q_slimes: { state: 'active', n: 3 } },
    x: lake.x, z: lake.z,
  });
  assert.equal(a.level, 20);
  assert.equal(a.v, undefined, 'the schema version lives on the account');
  assert.equal(sanitizeAccount({ name: 'Valide', cls: 'warrior', salt: 'a', hash: 'b', level: 99 }).v, ACCOUNT_VERSION);
  assert.equal(a.xp, 0);
  assert.equal(a.gold, 25);
  assert.deepEqual(a.eq, { weapon: null, armor: 'chainmail' }); // armor in the weapon slot is dropped
  assert.equal(a.inv.length, 24);
  assert.deepEqual([a.x, a.z], [SPAWN_POINT.x, SPAWN_POINT.z]); // unwalkable -> spawn
  assert.deepEqual(a.quests, { q_slimes: { state: 'active', n: 3 } });
});

test('writeFileAtomic replaces the file content', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'x.json');
    writeFileAtomic(f, '1');
    writeFileAtomic(f, '2');
    assert.equal(fs.readFileSync(f, 'utf8'), '2');
    assert.deepEqual(fs.readdirSync(dir), ['x.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('player sync: live state goes back to the account; dead players are saved at the spawn', () => {
  const game = makeGame();
  const p = addPlayer(game, { cls: 'ranger' });
  place(game, p, 55.555, 22.222);
  p.gold = 999; p.xp = 42; p.hp = 33.7;
  p.inv[7] = { id: 'goblin_trinket', q: 2 };
  p.syncAccount();
  const a = p.account;
  assert.equal(a.gold, 999);
  assert.equal(a.xp, 42);
  assert.equal(a.hp, 34);
  assert.deepEqual([a.x, a.z], [55.56, 22.22]);
  assert.deepEqual(a.inv[7], { id: 'goblin_trinket', q: 2 });
  a.inv[7].q = 1; // the account keeps its own copy
  assert.equal(p.inv[7].q, 2);
  p.dead = true;
  p.syncAccount();
  assert.deepEqual([a.x, a.z, a.hp], [SPAWN_POINT.x, SPAWN_POINT.z, null]);
});
