// Account credential validation and password hashing (scrypt + random salt + timingSafeEqual).
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { CLASSES } from '../../shared/data.js';
import { has } from './util.js';

export const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9_]{3,16}$/;
export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 64;

export const validName = (name) => typeof name === 'string' && NAME_RE.test(name);
export const validPassword = (pw) => typeof pw === 'string' && pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX;
export const validClass = (cls) => has(CLASSES, cls);
/** Case-insensitive account key. */
export const nameKey = (name) => name.toLowerCase();

const KEYLEN = 32;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scryptAsync(password, salt, keylen) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, SCRYPT_OPTS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Returns { salt, hash } as hex strings. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

/** Constant-time verification of `password` against a stored salt/hash pair. */
export async function verifyPassword(password, salt, hash) {
  if (typeof salt !== 'string' || typeof hash !== 'string') return false;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length === 0) return false;
  const got = await scryptAsync(password, Buffer.from(salt, 'hex'), expected.length);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const DUMMY = { salt: '00'.repeat(16), hash: '00'.repeat(KEYLEN) };
/** Same cost as a real verification: used for unknown names so timing does not reveal which accounts exist. */
export async function dummyVerify(password) {
  await verifyPassword(typeof password === 'string' ? password : '', DUMMY.salt, DUMMY.hash);
  return false;
}
