// Accounts v3 (docs/COMPTES.md): remembered sessions ("Rester connecté" tokens) and the summaries sent to the
// client in `account_ok`. Storage and indexes live in persistence.js (AccountStore).
import { createHash, randomBytes } from 'node:crypto';
import { regionAt } from '../../shared/world.js';
import { MAX_CHARS, MAX_SESSIONS } from './persistence.js';

/** A remembered session lasts this long after its last use (the token is rotated at every use). */
export const TOKEN_TTL_MS = 30 * 24 * 3_600_000;
/** 256-bit random tokens, base64url without padding (43 characters). */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const validTokenFormat = (t) => typeof t === 'string' && TOKEN_RE.test(t);
/** Only this hash is stored: a leaked account file does not reveal usable tokens. */
export const hashToken = (t) => createHash('sha256').update(t).digest('hex');

/**
 * Issue a new remembered-session token for `acc` (or rotate the one of session `id`).
 * @returns {{ token: string, id: string }} the token is only ever sent to the client, never stored
 */
export function issueToken(store, acc, { id = null, ua = '', now = Date.now() } = {}) {
  const token = randomBytes(32).toString('base64url');
  const h = hashToken(token);
  const exp = now + TOKEN_TTL_MS;
  const cur = id ? acc.sessions.find((s) => s.id === id) : null;
  if (cur) Object.assign(cur, { h, exp, used: now });
  else {
    id = randomBytes(8).toString('hex');
    acc.sessions.push({ id, h, created: now, exp, used: now, ua: String(ua || '').slice(0, 120) });
    acc.sessions = acc.sessions.filter((s) => s.exp > now).slice(-MAX_SESSIONS); // the oldest are forgotten
  }
  store.index(acc);
  store.markDirty(acc);
  return { token, id };
}

/**
 * Account and session of a remembered-session token, or null (unknown, revoked or expired).
 * An expired session is removed.
 */
export function findToken(store, token, now = Date.now()) {
  if (!validTokenFormat(token)) return null;
  const h = hashToken(token);
  const acc = store.accountByTokenHash(h);
  if (!acc) return null;
  const session = acc.sessions.find((s) => s.h === h);
  if (!session) return null;
  if (session.exp <= now) {
    revokeSession(store, acc, session.id);
    return null;
  }
  return { acc, session };
}

/** Forget one remembered session (its token stops working). */
export function revokeSession(store, acc, id) {
  if (!id) return false;
  const n = acc.sessions.length;
  acc.sessions = acc.sessions.filter((s) => s.id !== id);
  if (acc.sessions.length === n) return false;
  store.index(acc);
  store.markDirty(acc);
  return true;
}

/** Forget every remembered session of the account, except `keepId` (e.g. after a password change). */
export function revokeAllSessions(store, acc, keepId = null) {
  const n = acc.sessions.length;
  acc.sessions = acc.sessions.filter((s) => keepId && s.id === keepId);
  store.index(acc);
  store.markDirty(acc);
  return n - acc.sessions.length;
}

/** What the character selection screen shows about one character. */
export function charSummary(ch) {
  return {
    id: ch.id,
    name: ch.name,
    cls: ch.cls,
    level: ch.level,
    zone: regionAt(ch.x, ch.z)?.name || '',
    lastPlayed: ch.lastSeen || 0,
    eq: { weapon: ch.eq?.weapon || null, armor: ch.eq?.armor || null },
  };
}

/** `account_ok.account`: public account data (never credentials, token hashes or public keys). */
export function accountSummary(acc) {
  return {
    name: acc.login,
    lastChar: acc.lastChar || null,
    maxChars: MAX_CHARS,
    created: acc.created,
    passkeys: acc.passkeys.map((k) => ({ id: k.id, label: k.label, created: k.created, used: k.used || 0 })),
    sessions: acc.sessions.length,
    ...(acc.role ? { role: acc.role } : {}),
  };
}

/** Characters in creation order (stable positions on the selection screen). */
export function charList(acc) {
  return acc.chars.map(charSummary);
}
