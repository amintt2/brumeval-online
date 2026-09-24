// [skilltree] Client rebindable controls (client/src/game/keybinds.js): defaults of DECISIONS.md §4, conflicts,
// the Roulade + Sprint shared key, persistence and sanitising of a stored (possibly hand-edited) object.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeybinds, defaultBindings, sanitizeBindings, keyLabel, learnKey, mouseCode } from '../../client/src/game/keybinds.js';

const memory = (init = null) => {
  let v = init;
  return { get: () => v, set: (x) => { v = x; }, peek: () => v };
};

test('default bindings follow DECISIONS.md §4', () => {
  const k = createKeybinds({ storage: memory() });
  assert.deepEqual(k.codesOf('jump'), ['Space']);
  assert.ok(k.codesOf('roll').includes('ShiftLeft'));
  assert.ok(k.codesOf('sprint').includes('ShiftLeft'));
  assert.ok(k.rollSprintShared('ShiftLeft'), 'Shift: tap = roll, hold = sprint');
  assert.deepEqual(k.codesOf('guard'), ['KeyE']);
  for (let n = 1; n <= 8; n++) assert.equal(k.codesOf(`slot${n}`)[0], `Digit${n}`);
  assert.deepEqual(k.codesOf('tree'), ['KeyN']);
  assert.deepEqual(k.codesOf('book'), ['KeyK']);
  assert.deepEqual(k.conflicts(), [], 'the defaults have no conflict');
});

test('rebinding takes the key away from the other action and is saved', () => {
  const st = memory();
  const k = createKeybinds({ storage: st });
  const res = k.set('jump', 0, 'KeyI');
  assert.ok(res.ok);
  assert.deepEqual(res.displaced, ['inventory']);
  assert.deepEqual(k.codesOf('inventory'), []);
  assert.deepEqual(k.actionsOf('KeyI'), ['jump']);
  assert.deepEqual(k.conflicts(), []);
  // a new instance reads the saved bindings back (reload)
  const k2 = createKeybinds({ storage: st });
  assert.deepEqual(k2.codesOf('jump'), ['KeyI']);
  k2.reset();
  assert.deepEqual(k2.codesOf('jump'), ['Space']);
  assert.deepEqual(k2.codesOf('inventory'), ['KeyI']);
});

test('roll and sprint may share a key, mouse buttons bind, reserved keys are refused', () => {
  const k = createKeybinds({ storage: memory() });
  assert.deepEqual(k.set('roll', 0, 'KeyA').displaced, ['move_l']);
  assert.ok(k.set('sprint', 0, 'KeyA').ok);
  assert.deepEqual(k.conflicts(), []);
  assert.ok(k.rollSprintShared('KeyA'));
  assert.equal(mouseCode(4), 'Mouse4');
  assert.equal(mouseCode(0), null, 'left click is not rebindable');
  assert.ok(k.set('guard', 1, 'Mouse4').ok);
  assert.ok(k.is('Mouse4', 'guard'));
  assert.equal(k.set('guard', 0, 'Escape').ok, false);
  assert.ok(k.set('guard', 0, null).ok);
  assert.deepEqual(k.codesOf('guard'), ['Mouse4']);
});

test('stored bindings are sanitised (unknown actions, bad codes)', () => {
  const s = sanitizeBindings({ jump: ['KeyJ', 'bad code!'], nope: ['KeyX'], guard: 'KeyE' });
  assert.deepEqual(s.jump, ['KeyJ', defaultBindings().jump[1]]);
  assert.equal(s.nope, undefined);
  assert.deepEqual(s.guard, defaultBindings().guard);
  const k = createKeybinds({ storage: memory('{not json') });
  assert.deepEqual(k.codesOf('jump'), ['Space']);
});

test('labels are French and follow the keyboard layout (AZERTY)', () => {
  assert.equal(keyLabel('Space'), 'Espace');
  assert.equal(keyLabel('ShiftLeft'), 'Maj');
  assert.equal(keyLabel('Digit3'), '3');
  assert.equal(keyLabel('Mouse1'), 'Clic molette');
  assert.equal(keyLabel('KeyW'), 'W');
  learnKey('KeyW', 'z');
  assert.equal(keyLabel('KeyW'), 'Z');
});
