import test from 'node:test';
import assert from 'node:assert/strict';
import { INV_SIZE } from '../../shared/data.js';
import {
  emptyInventory, addItem, canAdd, canAddAll, spaceFor, removeAt, countItem, firstEmpty, freeSlots,
  formatItem, sanitizeInventory, stackSize, equipSlotOf, isEquipment,
} from '../src/inventory.js';

test('addItem stacks up to the item stack size then uses new slots', () => {
  const inv = emptyInventory();
  assert.equal(inv.length, INV_SIZE);
  assert.equal(addItem(inv, 'potion_hp_s', 5), 5);
  assert.deepEqual(inv[0], { id: 'potion_hp_s', q: 5 });
  assert.equal(addItem(inv, 'potion_hp_s', 20), 20); // 15 into slot 0, 5 into slot 1
  assert.deepEqual(inv[0], { id: 'potion_hp_s', q: 20 });
  assert.deepEqual(inv[1], { id: 'potion_hp_s', q: 5 });
  assert.equal(countItem(inv, 'potion_hp_s'), 25);
});

test('equipment never stacks', () => {
  const inv = emptyInventory();
  assert.equal(stackSize('steel_sword'), 1);
  assert.equal(addItem(inv, 'steel_sword', 3), 3);
  assert.equal(inv.filter(Boolean).length, 3);
  assert.equal(equipSlotOf('steel_sword'), 'weapon');
  assert.equal(equipSlotOf('chainmail'), 'armor');
  assert.equal(equipSlotOf('slime_gel'), null);
  assert.ok(isEquipment('long_bow'));
});

test('full inventory: partial adds report what fitted', () => {
  const inv = emptyInventory();
  for (let i = 0; i < INV_SIZE; i++) addItem(inv, 'steel_sword', 1);
  assert.equal(firstEmpty(inv), -1);
  assert.equal(freeSlots(inv), 0);
  assert.equal(addItem(inv, 'slime_gel', 1), 0);
  assert.equal(canAdd(inv, 'slime_gel', 1), false);
  inv[3] = { id: 'slime_gel', q: 48 };
  assert.equal(spaceFor(inv, 'slime_gel'), 2);
  assert.equal(addItem(inv, 'slime_gel', 5), 2);
  assert.equal(inv[3].q, 50);
});

test('canAddAll simulates without mutating', () => {
  const inv = emptyInventory();
  for (let i = 0; i < INV_SIZE - 1; i++) addItem(inv, 'steel_sword', 1);
  const snapshot = JSON.stringify(inv);
  assert.equal(canAddAll(inv, [['potion_hp_s', 3]]), true);
  assert.equal(canAddAll(inv, [['potion_hp_s', 3], ['runeblade', 1]]), false);
  assert.equal(JSON.stringify(inv), snapshot);
});

test('removeAt removes quantities and clears empty slots', () => {
  const inv = emptyInventory();
  addItem(inv, 'wolf_pelt', 7);
  assert.equal(removeAt(inv, 0, 3), 3);
  assert.equal(inv[0].q, 4);
  assert.equal(removeAt(inv, 0), 4);
  assert.equal(inv[0], null);
  assert.equal(removeAt(inv, 0), 0);
});

test('unknown items are rejected', () => {
  const inv = emptyInventory();
  assert.equal(addItem(inv, 'excalibur', 1), 0);
  assert.equal(addItem(inv, '__proto__', 1), 0);
  assert.equal(spaceFor(inv, 'toString'), 0);
});

test('formatItem', () => {
  assert.equal(formatItem('potion_hp_s', 2), 'Petite potion de soin x2');
  assert.equal(formatItem('slime_gel', 1), 'Gelée de gluant');
});

test('sanitizeInventory repairs persisted data', () => {
  const inv = sanitizeInventory([{ id: 'potion_hp_s', q: 999 }, { id: 'nope', q: 1 }, null, { id: 'slime_gel', q: -2 }, 'x']);
  assert.equal(inv.length, INV_SIZE);
  assert.deepEqual(inv[0], { id: 'potion_hp_s', q: 20 });
  assert.equal(inv[1], null);
  assert.equal(inv[3], null);
  assert.equal(inv[4], null);
  assert.equal(sanitizeInventory('garbage').length, INV_SIZE);
});
