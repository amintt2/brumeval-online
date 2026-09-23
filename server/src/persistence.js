// Account storage (v0.2, ROADMAP §4.2): one JSON file per account in <dataDir>/accounts/<nameKey>.json.
//
// - Only accounts whose content changed are written, atomically (temp file + fsync + rename).
// - `save()` writes in the background (async I/O, never stalls the game loop); `save(true)` writes
//   synchronously (shutdown, tests); `flush()` resolves once background writes are on disk.
// - The v0.1 single file accounts.json is imported automatically once, then kept as accounts.v1.bak.json.
// - Every record goes through `migrateAccount(raw)`: the single place where each feature gives its
//   persistent fields a default value (old saves stay loadable forever).
// - A gzip bundle of every account is written once a day in <dataDir>/backups/ (the 7 most recent are kept);
//   it uses the v0.1 accounts.json format, so restoring one is just importing it again (docs/DEPLOIEMENT.md).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { CLASSES, MAX_LEVEL, START_GOLD, xpToNext } from '../../shared/data.js';
import { SPAWN_POINT, isWalkable } from '../../shared/world.js';
import { MAX_CHARS } from '../../shared/protocol.js';
import { emptyInventory, addItem, sanitizeInventory, isItem, equipSlotOf } from './inventory.js';
import { sanitizeQuests } from './quests.js';
import { nameKey, validName, validClass } from './auth.js';
import { sanitizeSecurityFields } from './security/accountFields.js'; // [anticheat]
import { sanitizeEcho } from './systems/echo.js'; // [combat-souls]

const gzip = promisify(zlib.gzip);

/**
 * Schema version written in every account file (`v`).
 *   v1 = the v0.1 accounts.json records (one character = one account: name + password + progression)
 *   v2 = the same record, one file per account (v0.2 wave 1)
 *   v3 = an account (login + password + remembered sessions + passkeys) holding up to MAX_CHARS characters
 *        (docs/COMPTES.md)
 */
export const ACCOUNT_VERSION = 3;
export { MAX_CHARS };
export const MAX_SESSIONS = 10;
export const MAX_PASSKEYS = 10;
export const ACCOUNTS_DIR = 'accounts';
export const LEGACY_FILE = 'accounts.json';
export const LEGACY_BACKUP = 'accounts.v1.bak.json';
export const BACKUP_DIR = 'backups';
export const BACKUP_KEEP = 7;
const LEGACY_FILE_VERSION = 1;          // `version` of the accounts.json bundle format
const HOT_TTL_MS = 15 * 60_000;         // accounts untouched this long stop being checked at each save
export const DELETED_KEEP = 10;         // deleted characters kept in the account file (manual restore by an admin)
export const PRE_V3_DIR = 'accounts.v2.bak'; // original v2 files, copied once before their upgrade to v3

const CHAR_ID_RE = /^[a-z0-9]{6,20}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
export const newCharId = () => randomBytes(6).toString('hex');
const newUid = () => randomBytes(16).toString('base64url');

/** A brand-new level 1 character with the class start gear (no credentials: those live on the account). */
export function newCharacter(name, cls) {
  const c = CLASSES[cls];
  const inv = emptyInventory();
  for (const [id, q] of c.start.items) addItem(inv, id, q);
  const now = Date.now();
  const rec = {
    id: newCharId(),
    name, cls,
    level: 1, xp: 0, gold: START_GOLD,
    hp: null, mp: null, // null = full
    inv,
    eq: { weapon: c.start.weapon || null, armor: c.start.armor || null },
    quests: {},
    x: SPAWN_POINT.x, z: SPAWN_POINT.z,
    created: now, lastSeen: now,
    echo: null, // [combat-souls] death echo { x, z, xp }
  };
  return migrateCharacter(rec) || rec; // every feature's defaults apply to new characters too
}

/**
 * A brand-new account `login` with its password hash. With `cls`, it also gets a first character named like
 * the login (what a v0.1 registration created; legacy clients and tests rely on it).
 */
export function newAccount(login, cls, salt, hash) {
  const now = Date.now();
  const acc = {
    v: ACCOUNT_VERSION, login, salt, hash, uid: newUid(),
    created: now, lastSeen: now, lastChar: null,
    chars: [], sessions: [], passkeys: [],
  };
  if (cls) {
    const ch = newCharacter(login, cls);
    acc.chars.push(ch);
    acc.lastChar = ch.id;
  }
  return acc;
}

const finite = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Fields handled by the core of migrateCharacter (everything else is carried over untouched). */
const CORE_FIELDS = new Set(['id', 'name', 'cls', 'salt', 'hash', 'level', 'xp', 'gold', 'hp', 'mp', 'inv', 'eq', 'quests', 'x', 'z', 'created', 'lastSeen', 'v']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** Fields of a v3 account record (anything else found at its top level is carried over untouched). */
const ACCOUNT_FIELDS = new Set(['v', 'login', 'salt', 'hash', 'uid', 'role', 'lastIp', 'authIps', 'created', 'lastSeen', 'lastChar', 'chars', 'sessions', 'passkeys', 'deleted']);

/**
 * Validate / normalise one CHARACTER record (a v1/v2 account record is exactly a character plus salt/hash).
 * Returns null when it cannot be used at all (no valid name or class). salt/hash are not kept here.
 *
 * FEATURES ADD THEIR PERSISTENT CHARACTER FIELDS HERE: in the section at the end, one small block per feature,
 * tagged with the feature key, that validates `raw.<field>` and sets `acc.<field>` (default when missing/invalid).
 */
export function migrateCharacter(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!validName(raw.name) || !validClass(raw.cls)) return null;
  const acc = {};
  for (const k of Object.keys(raw)) {
    if (!CORE_FIELDS.has(k) && !UNSAFE_KEYS.has(k) && raw[k] !== undefined) acc[k] = raw[k];
  }

  // ---- core fields (v0.1)
  const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(finite(raw.level, 1))));
  const xp = level >= MAX_LEVEL ? 0 : Math.max(0, Math.min(xpToNext(level) - 1, Math.floor(finite(raw.xp, 0))));
  const eq = { weapon: null, armor: null };
  for (const slot of ['weapon', 'armor']) {
    const id = raw.eq?.[slot];
    if (isItem(id) && equipSlotOf(id) === slot) eq[slot] = id;
  }
  let x = finite(raw.x, SPAWN_POINT.x), z = finite(raw.z, SPAWN_POINT.z);
  if (!isWalkable(x, z)) ({ x, z } = SPAWN_POINT);
  Object.assign(acc, {
    id: typeof raw.id === 'string' && CHAR_ID_RE.test(raw.id) ? raw.id : newCharId(),
    name: raw.name, cls: raw.cls,
    level, xp,
    gold: Math.max(0, Math.floor(finite(raw.gold, START_GOLD))),
    hp: typeof raw.hp === 'number' && raw.hp > 0 ? raw.hp : null,
    mp: typeof raw.mp === 'number' && raw.mp >= 0 ? raw.mp : null,
    inv: sanitizeInventory(raw.inv),
    eq,
    quests: sanitizeQuests(raw.quests),
    x, z,
    created: finite(raw.created, Date.now()),
    lastSeen: finite(raw.lastSeen, Date.now()),
    ...sanitizeSecurityFields(raw), // [anticheat] role, mute, ignore list, last IP (all optional)
    echo: sanitizeEcho(raw.echo), // [combat-souls] death echo { x, z, xp }; v0.1 accounts have none
  });

  // ---- per-feature fields (v0.2+): add your block below, e.g.
  //   // [my-feature] short description
  //   acc.myField = isValid(raw.myField) ? raw.myField : DEFAULT;

  return acc;
}

const SESSION_ID_RE = /^[0-9a-f]{8,32}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Remembered sessions ("Rester connecté"): { id, h: sha256(token) hex, created, exp, used, ua }. */
function sanitizeSessions(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (!s || typeof s !== 'object' || !SESSION_ID_RE.test(s.id) || !HASH_RE.test(s.h)) continue;
    const exp = finite(s.exp, 0);
    if (exp <= now) continue; // expired sessions are forgotten
    out.push({ id: s.id, h: s.h, created: finite(s.created, now), exp, used: finite(s.used, now), ua: str(s.ua, 120) });
  }
  return out.slice(-MAX_SESSIONS);
}

/** WebAuthn credentials: { id, pk (COSE public key, base64url), counter, transports, label, created, used }. */
function sanitizePasskeys(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const k of list) {
    if (!k || typeof k !== 'object' || typeof k.id !== 'string' || !B64URL_RE.test(k.id) || k.id.length > 1400) continue;
    if (typeof k.pk !== 'string' || !B64URL_RE.test(k.pk) || seen.has(k.id)) continue;
    seen.add(k.id);
    out.push({
      id: k.id, pk: k.pk,
      counter: Math.max(0, Math.floor(finite(k.counter, 0))),
      transports: Array.isArray(k.transports) ? k.transports.filter((t) => typeof t === 'string' && t.length <= 16).slice(0, 8) : [],
      label: str(k.label, 40) || 'Clé d’accès',
      created: finite(k.created, Date.now()),
      used: finite(k.used, 0),
    });
  }
  return out;
}

/**
 * Validate / normalise / upgrade a persisted ACCOUNT (any version, v0.1 included) into the current v3 schema.
 * Returns null when it cannot be used at all (no valid login or credentials, or a v1/v2 record without a valid
 * character).
 *
 * - v1/v2 (one character per account): the account keeps the old name as its login and gets ONE character
 *   with the same name and ALL the progression (level, xp, gold, inventory, equipment, quests, position, echo,
 *   moderation fields and any field written by another feature). The role is copied to the account.
 * - v3: every character goes through migrateCharacter (an unusable one is set aside in `deleted`, never lost).
 * Unknown top-level fields are kept as they are (a field written by a newer feature is never lost).
 */
export function migrateAccount(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.salt !== 'string' || typeof raw.hash !== 'string') return null;
  const now = Date.now();
  if (!Array.isArray(raw.chars)) {
    // ---- v1 / v2: the record IS a character
    const ch = migrateCharacter(raw);
    if (!ch) return null;
    const acc = {
      v: ACCOUNT_VERSION, login: raw.name, salt: raw.salt, hash: raw.hash, uid: newUid(),
      created: ch.created, lastSeen: ch.lastSeen, lastChar: ch.id,
      chars: [ch], sessions: [], passkeys: [],
    };
    if (ch.role) acc.role = ch.role;
    if (ch.lastIp) acc.lastIp = ch.lastIp;
    return acc;
  }
  // ---- v3
  if (!validName(raw.login)) return null;
  const acc = {};
  for (const k of Object.keys(raw)) {
    if (!ACCOUNT_FIELDS.has(k) && !UNSAFE_KEYS.has(k) && raw[k] !== undefined) acc[k] = raw[k];
  }
  const chars = [];
  const deleted = Array.isArray(raw.deleted) ? raw.deleted.filter((d) => d && typeof d === 'object') : [];
  const ids = new Set();
  for (const c of raw.chars) {
    const ch = migrateCharacter(c);
    if (!ch) {
      if (c && typeof c === 'object') deleted.push({ ...c, invalid: true, deletedAt: now });
      continue;
    }
    while (ids.has(ch.id)) ch.id = newCharId();
    ids.add(ch.id);
    chars.push(ch);
  }
  Object.assign(acc, {
    v: ACCOUNT_VERSION,
    login: raw.login, salt: raw.salt, hash: raw.hash,
    uid: typeof raw.uid === 'string' && B64URL_RE.test(raw.uid) && raw.uid.length <= 64 ? raw.uid : newUid(),
    created: finite(raw.created, now),
    lastSeen: finite(raw.lastSeen, now),
    lastChar: chars.some((c) => c.id === raw.lastChar) ? raw.lastChar : (chars[0]?.id ?? null),
    chars,
    sessions: sanitizeSessions(raw.sessions, now),
    passkeys: sanitizePasskeys(raw.passkeys),
  });
  if (raw.role === 'admin' || raw.role === 'gm') acc.role = raw.role;
  if (typeof raw.lastIp === 'string' && raw.lastIp.length <= 64) acc.lastIp = raw.lastIp;
  // [accounts] addresses of the last password / passkey logins (targeted-lockout exemption, admins only)
  if (Array.isArray(raw.authIps)) {
    const ips = raw.authIps.filter((x) => typeof x === 'string' && x.length <= 64).slice(0, 3);
    if (ips.length) acc.authIps = ips;
  }
  if (deleted.length) acc.deleted = deleted;
  return acc;
}

/** Former name of migrateAccount (kept for existing callers). */
export const sanitizeAccount = migrateAccount;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** rename with retries: antivirus / indexers on Windows can briefly lock the destination. */
function renameRetrySync(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (attempt < 5 && RETRYABLE.has(err.code)) {
        sleepSync(20 * (attempt + 1));
        continue;
      }
      try { fs.unlinkSync(from); } catch { /* ignore */ }
      throw err;
    }
  }
}

/** Atomically replace `file` with `data` (write tmp, fsync, rename; retries for Windows file locks). */
export function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  renameRetrySync(tmp, file);
}

/** Async write + fsync of a temp file (the rename is done by the caller, synchronously). */
async function writeTmpAsync(tmp, data) {
  const fh = await fs.promises.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

const RESERVED_WIN = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
/** File name of an account (names are [letters digits _] only; Windows device names get a '-' suffix). */
export const accountFileName = (key) => `${RESERVED_WIN.test(key) ? `${key}-` : key}.json`;

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export class AccountStore {
  constructor(dataDir, log) {
    this.dir = dataDir;
    this.accDir = path.join(dataDir, ACCOUNTS_DIR);
    this.legacyFile = path.join(dataDir, LEGACY_FILE);
    this.backupDir = path.join(dataDir, BACKUP_DIR);
    this.log = log;
    this.accounts = new Map(); // login key -> account record (v3)
    this.charIndex = new Map(); // character name key -> account (character names are unique server-wide)
    this.tokenIndex = new Map(); // sha256(remembered-session token) hex -> account
    this.credIndex = new Map();  // passkey credential id -> account
    this.indexed = new WeakMap(); // account -> { chars, tokens, creds } keys currently indexed for it
    this.hot = new Set();      // keys checked for changes at each save (logged in / created / flagged)
    this.disk = new Map();     // key -> JSON known to be on disk
    this.queued = new Map();   // key -> JSON handed to a writer (on disk or being written)
    this.seq = 0;
    this.committed = new Map(); // key -> seq of the last write renamed into place
    this.flagged = false;       // markDirty() since the last save
    this.writing = null;        // in-flight background save
    this.again = false;         // a save was requested while one was in flight
    this.lastError = null;
    this.stats = { writes: 0, errors: 0, lastSaveMs: 0, lastBackup: null };
  }

  fileOf(key) { return path.join(this.accDir, accountFileName(key)); }

  load() {
    fs.mkdirSync(this.accDir, { recursive: true });
    let bad = 0, migrated = 0;
    for (const f of fs.readdirSync(this.accDir)) {
      const file = path.join(this.accDir, f);
      if (f.endsWith('.tmp')) { // interrupted write: the previous version is still in place
        try { fs.unlinkSync(file); } catch { /* ignore */ }
        continue;
      }
      if (!f.endsWith('.json')) continue;
      let text, raw;
      try {
        text = fs.readFileSync(file, 'utf8');
        raw = JSON.parse(text);
      } catch (err) {
        const aside = `${file}.corrompu-${Date.now()}`;
        try { fs.renameSync(file, aside); } catch { /* ignore */ }
        this.log?.error(`compte illisible ${f} (${err.message}) — mis de côté sous ${path.basename(aside)}`);
        continue;
      }
      const acc = migrateAccount(raw);
      if (!acc) { bad++; continue; }
      const key = nameKey(acc.login);
      const prev = this.accounts.get(key);
      if (prev && (prev.lastSeen || 0) >= (acc.lastSeen || 0)) continue;
      if (prev) this.unindex(prev);
      this.accounts.set(key, acc);
      this.disk.set(key, text);
      this.queued.set(key, text);
      if (raw.v !== ACCOUNT_VERSION) {
        // upgraded (v2 -> v3): the original file is copied once, and the account is rewritten at the next save
        // so that its new character ids / passkey user handle are stable
        this.keepPreMigration(f, text);
        this.hot.add(key);
        this.flagged = true;
        migrated++;
      }
      this.index(acc);
    }
    if (migrated) this.log?.info(`migration des comptes v0.2 → v0.3 (plusieurs personnages par compte) : ${migrated} compte(s) converti(s), originaux conservés dans ${PRE_V3_DIR}/`);
    if (bad) this.log?.warn(`${bad} fichier(s) de compte invalide(s) ignoré(s) dans ${ACCOUNTS_DIR}/`);
    if (fs.existsSync(this.legacyFile)) this.importLegacy();
    return this;
  }

  /** One-time import of the v0.1 accounts.json (kept afterwards as accounts.v1.bak.json). */
  importLegacy() {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.legacyFile, 'utf8'));
    } catch (err) {
      const backup = `${this.legacyFile}.corrompu-${Date.now()}`;
      try { fs.renameSync(this.legacyFile, backup); } catch { /* ignore */ }
      this.log?.error(`accounts.json illisible (${err.message}) — sauvegardé sous ${path.basename(backup)}, aucun compte importé`);
      return;
    }
    const list = data && typeof data.accounts === 'object' && data.accounts ? Object.values(data.accounts) : [];
    let imported = 0, kept = 0, bad = 0, failed = 0;
    for (const raw of list) {
      const acc = migrateAccount(raw);
      if (!acc) { bad++; continue; }
      const key = nameKey(acc.login);
      if (this.accounts.has(key)) { kept++; continue; } // a per-account file already exists: it is newer
      this.accounts.set(key, acc);
      this.index(acc);
      const json = JSON.stringify(acc);
      try {
        writeFileAtomic(this.fileOf(key), json);
        this.disk.set(key, json);
        this.queued.set(key, json);
        imported++;
      } catch (err) {
        failed++;
        this.hot.add(key);
        this.flagged = true;
        this.log?.error(`import du compte ${acc.login} impossible : ${err.message}`);
      }
    }
    if (bad) this.log?.warn(`${bad} compte(s) invalide(s) ignoré(s) dans accounts.json`);
    if (failed) {
      this.log?.error(`import de accounts.json incomplet (${failed} échec(s)) : le fichier est conservé, nouvel essai au prochain démarrage`);
      return;
    }
    let dest = path.join(this.dir, LEGACY_BACKUP);
    if (fs.existsSync(dest)) dest = path.join(this.dir, `accounts.v1.bak-${Date.now()}.json`);
    try {
      renameRetrySync(this.legacyFile, dest);
    } catch (err) {
      this.log?.error(`accounts.json importé mais impossible à renommer (${err.message})`);
    }
    this.log?.info(`migration v0.1 → v0.2 : ${imported} compte(s) importé(s) depuis accounts.json` +
      `${kept ? `, ${kept} déjà présent(s)` : ''} (ancien fichier conservé sous ${path.basename(dest)})`);
  }

  /** Copy of an account file in its pre-v3 format (kept once, never overwritten). */
  keepPreMigration(file, text) {
    try {
      const dir = path.join(this.dir, PRE_V3_DIR);
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, file);
      if (!fs.existsSync(dest)) writeFileAtomic(dest, text);
    } catch (err) {
      this.log?.warn(`copie de sauvegarde de ${file} impossible : ${err.message}`);
    }
  }

  // ------------------------------------------------------------------ indexes
  /** (Re)index the characters, remembered sessions and passkeys of an account. Call after changing them. */
  index(acc) {
    this.unindex(acc);
    const keys = { chars: [], tokens: [], creds: [] };
    for (const ch of acc.chars) {
      const k = nameKey(ch.name);
      const other = this.charIndex.get(k);
      if (other && other !== acc) {
        this.log?.warn(`personnage ${ch.name} présent dans deux comptes (${other.login} et ${acc.login}) : seul le premier est indexé`);
        continue;
      }
      this.charIndex.set(k, acc);
      keys.chars.push(k);
    }
    for (const s of acc.sessions) { this.tokenIndex.set(s.h, acc); keys.tokens.push(s.h); }
    for (const c of acc.passkeys) { this.credIndex.set(c.id, acc); keys.creds.push(c.id); }
    this.indexed.set(acc, keys);
  }

  unindex(acc) {
    const keys = this.indexed.get(acc);
    if (!keys) return;
    for (const k of keys.chars) if (this.charIndex.get(k) === acc) this.charIndex.delete(k);
    for (const k of keys.tokens) if (this.tokenIndex.get(k) === acc) this.tokenIndex.delete(k);
    for (const k of keys.creds) if (this.credIndex.get(k) === acc) this.credIndex.delete(k);
    this.indexed.delete(acc);
  }

  // ------------------------------------------------------------------ lookups
  /** Number of accounts. */
  get size() { return this.accounts.size; }
  /** Number of characters (all accounts). */
  get charCount() { return this.charIndex.size; }

  /** Is this character name taken (case-insensitive, server-wide)? */
  has(name) { return typeof name === 'string' && this.charIndex.has(nameKey(name)); }
  hasChar(name) { return this.has(name); }
  /** Is this login taken (case-insensitive)? */
  hasLogin(login) { return typeof login === 'string' && this.accounts.has(nameKey(login)); }

  /** Account by (case-insensitive) login, or null. A returned account is watched for changes until idle. */
  getAccount(login) {
    if (typeof login !== 'string') return null;
    const key = nameKey(login);
    const acc = this.accounts.get(key);
    if (!acc) return null;
    this.hot.add(key);
    return acc;
  }

  /** Account owning the character `name`, or null. */
  accountOfChar(name) {
    if (typeof name !== 'string') return null;
    const acc = this.charIndex.get(nameKey(name));
    if (acc) this.hot.add(nameKey(acc.login));
    return acc || null;
  }

  /** CHARACTER record by (case-insensitive) name, or null (moderation, tests). Watched for changes until idle. */
  get(name) {
    const acc = this.accountOfChar(name);
    if (!acc) return null;
    const k = nameKey(name);
    return acc.chars.find((c) => nameKey(c.name) === k) || null;
  }

  /** Account of a remembered-session token hash, or null. */
  accountByTokenHash(h) { return (typeof h === 'string' && this.tokenIndex.get(h)) || null; }
  /** Account of a passkey credential id, or null. */
  accountByCredential(id) { return (typeof id === 'string' && this.credIndex.get(id)) || null; }

  /** Every character name (display case), e.g. for the look-alike name check. */
  *charNames() {
    for (const acc of this.accounts.values()) for (const ch of acc.chars) yield ch.name;
  }

  // ------------------------------------------------------------------ changes
  /** Add a new account (v3 record, see newAccount; an older record is migrated first). */
  create(record) {
    const acc = record && Array.isArray(record.chars) ? record : migrateAccount(record);
    const key = nameKey(acc.login);
    const prev = this.accounts.get(key);
    if (prev) this.unindex(prev);
    this.accounts.set(key, acc);
    this.index(acc);
    this.hot.add(key);
    this.flagged = true;
    return acc;
  }

  /** Add a character to an account (limits and name checks are the caller's job). */
  addChar(acc, ch) {
    acc.chars.push(ch);
    this.index(acc);
    this.markDirty(acc);
    return ch;
  }

  /** Remove a character (kept aside in `acc.deleted` for a manual restore; its name becomes free). */
  removeChar(acc, id) {
    const i = acc.chars.findIndex((c) => c.id === id);
    if (i < 0) return null;
    const [ch] = acc.chars.splice(i, 1);
    acc.deleted = [...(acc.deleted || []), { ...ch, deletedAt: Date.now() }].slice(-DELETED_KEEP);
    if (acc.lastChar === id) acc.lastChar = acc.chars[0]?.id ?? null;
    this.index(acc);
    this.markDirty(acc);
    return ch;
  }

  /**
   * Something changed: with a record (account or character), its account; without, any account in use
   * (logged in recently).
   */
  markDirty(record) {
    if (record && typeof record === 'object') {
      if (typeof record.login === 'string') this.hot.add(nameKey(record.login));
      else if (typeof record.name === 'string') {
        const acc = this.charIndex.get(nameKey(record.name));
        if (acc) this.hot.add(nameKey(acc.login));
      }
    }
    this.flagged = true;
  }

  get dirty() { return this.flagged; }

  /** Changed accounts compared with `ref` (disk or queued). Prunes idle unchanged accounts from `hot`. */
  collect(ref) {
    const jobs = [];
    const now = Date.now();
    for (const key of this.hot) {
      const acc = this.accounts.get(key);
      if (!acc) { this.hot.delete(key); continue; }
      const json = JSON.stringify(acc);
      if (json !== ref.get(key)) jobs.push({ key, json, seq: ++this.seq });
      else if (json === this.disk.get(key) && now - (acc.lastSeen || 0) > HOT_TTL_MS) this.hot.delete(key);
    }
    this.flagged = false;
    return jobs;
  }

  /**
   * Save changed accounts. `force` (shutdown, tests): synchronously, everything not yet on disk, and
   * returns true when all writes succeeded. Otherwise the writes happen in the background (returns true).
   */
  save(force = false) {
    if (!force) {
      this.saveAsync();
      return true;
    }
    const t0 = performance.now();
    let ok = true;
    for (const job of this.collect(this.disk)) {
      try {
        fs.mkdirSync(this.accDir, { recursive: true });
        writeFileAtomic(this.fileOf(job.key), job.json);
        this.committed.set(job.key, job.seq);
        this.disk.set(job.key, job.json);
        this.queued.set(job.key, job.json);
        this.stats.writes++;
      } catch (err) {
        ok = false;
        this.fail(job, err);
      }
    }
    this.stats.lastSaveMs = performance.now() - t0;
    return ok;
  }

  fail(job, err) {
    this.queued.delete(job.key); // retried at the next save
    this.hot.add(job.key);
    this.flagged = true;
    this.stats.errors++;
    this.lastError = err.message;
    this.log?.error(`sauvegarde du compte ${job.key} impossible : ${err.message}`);
  }

  /** Background save of the changed accounts (async I/O). Resolves true when every write succeeded. */
  saveAsync() {
    if (this.writing) {
      this.again = true;
      return this.writing;
    }
    if (!this.flagged) return Promise.resolve(true);
    const jobs = this.collect(this.queued);
    if (jobs.length === 0) return Promise.resolve(true);
    for (const job of jobs) this.queued.set(job.key, job.json);
    const t0 = performance.now();
    this.writing = (async () => {
      let ok = true;
      try { await fs.promises.mkdir(this.accDir, { recursive: true }); } catch { /* reported by the writes */ }
      for (const job of jobs) {
        const file = this.fileOf(job.key);
        const tmp = `${file}.${process.pid}.${job.seq}.tmp`;
        try {
          await writeTmpAsync(tmp, job.json);
          // rename synchronously so that a concurrent synchronous save (newer seq) can never be overwritten
          if ((this.committed.get(job.key) ?? 0) < job.seq) {
            renameRetrySync(tmp, file);
            this.committed.set(job.key, job.seq);
            this.disk.set(job.key, job.json);
            this.stats.writes++;
          } else {
            fs.unlinkSync(tmp);
          }
        } catch (err) {
          ok = false;
          try { fs.unlinkSync(tmp); } catch { /* ignore */ }
          this.fail(job, err);
        }
      }
      this.stats.lastSaveMs = performance.now() - t0;
      return ok;
    })().finally(() => {
      this.writing = null;
      if (this.again) {
        this.again = false;
        this.saveAsync();
      }
    });
    return this.writing;
  }

  /** Resolves when every requested background save is on disk. */
  async flush() {
    while (this.writing) await this.writing;
    if (this.flagged) await this.saveAsync();
    while (this.writing) await this.writing;
  }

  // ------------------------------------------------------------------ daily backups
  backupFile(day) { return path.join(this.backupDir, `comptes-${day}.json.gz`); }

  /** Write today's backup if it does not exist yet. Resolves with the file written, or null. */
  async maybeBackup(now = Date.now()) {
    const file = this.backupFile(today(now));
    if (fs.existsSync(file)) return null;
    return this.backupNow(now);
  }

  /** gzip bundle of every account (accounts.json format), then keep the BACKUP_KEEP most recent ones. */
  async backupNow(now = Date.now()) {
    const file = this.backupFile(today(now));
    try {
      const accounts = {};
      for (const [k, a] of this.accounts) accounts[k] = a;
      const data = await gzip(JSON.stringify({ version: LEGACY_FILE_VERSION, savedAt: now, accounts }), { level: 6 });
      await fs.promises.mkdir(this.backupDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeTmpAsync(tmp, data);
      renameRetrySync(tmp, file);
      this.pruneBackups();
      this.stats.lastBackup = path.basename(file);
      this.log?.info(`sauvegarde quotidienne : ${path.basename(file)} (${this.accounts.size} compte(s))`);
      return file;
    } catch (err) {
      this.stats.errors++;
      this.lastError = err.message;
      this.log?.error(`sauvegarde quotidienne impossible : ${err.message}`);
      return null;
    }
  }

  pruneBackups() {
    let files;
    try {
      files = fs.readdirSync(this.backupDir).filter((f) => /^comptes-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).sort();
    } catch {
      return;
    }
    for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
      try { fs.unlinkSync(path.join(this.backupDir, f)); } catch { /* ignore */ }
    }
  }
}
