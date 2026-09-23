import test from 'node:test';
import assert from 'node:assert/strict';
import { validName, validPassword, validClass, nameKey, hashPassword, verifyPassword, dummyVerify } from '../src/auth.js';

test('name validation (3-16 chars, letters incl. French accents, digits, _)', () => {
  for (const ok of ['Bob', 'Élodie', 'Zoë_42', 'abcdefghijklmnop', 'ÀÖØöøÿ', 'a_1']) assert.ok(validName(ok), ok);
  for (const bad of ['ab', 'abcdefghijklmnopq', 'avec espace', 'x-y', 'emoji😀', '', null, 42, ['Bob'], 'Łukasz', 'a×b']) {
    assert.ok(!validName(bad), String(bad));
  }
});

test('password and class validation', () => {
  // v0.2: 6 characters minimum for new passwords (login never checks the length rule)
  assert.ok(validPassword('abcdef'));
  assert.ok(validPassword('x'.repeat(64)));
  assert.ok(!validPassword('abcde'));
  assert.ok(!validPassword('abc'));
  assert.ok(!validPassword('x'.repeat(65)));
  assert.ok(!validPassword(1234));
  assert.ok(validClass('mage'));
  assert.ok(!validClass('paladin'));
  assert.ok(!validClass('__proto__'));
  assert.ok(!validClass('constructor'));
  assert.equal(nameKey('ÉloDie'), 'élodie');
});

test('scrypt hashing: random salt, verification, wrong password', async () => {
  const a = await hashPassword('motdepasse');
  const b = await hashPassword('motdepasse');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(await verifyPassword('motdepasse', a.salt, a.hash), true);
  assert.equal(await verifyPassword('motdepassE', a.salt, a.hash), false);
  assert.equal(await verifyPassword('motdepasse', a.salt, ''), false);
  assert.equal(await verifyPassword('motdepasse', undefined, a.hash), false);
  assert.equal(await dummyVerify('x'), false);
});
