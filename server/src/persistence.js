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
import { CLASSES, MAX_LEVEL, START_GOLD, xpToNext } from '../../shared/data.js';
import { SPAWN_POINT, isWalkable } from '../../shared/world.js';
import { emptyInventory, addItem, sanitizeInventory, isItem, equipSlotOf } from './inventory.js';
import { sanitizeQuests } from './quests.js';
import { nameKey, validName, validClass } from './auth.js';

const gzip = promisify(zlib.gzip);

/** Schema version written in every account file (`v`). v1 = the v0.1 accounts.json records. */
export const ACCOUNT_VERSION = 2;
export const ACCOUNTS_DIR = 'accounts';
export const LEGACY_FILE = 'accounts.json';
export const LEGACY_BACKUP = 'accounts.v1.bak.json';
export const BACKUP_DIR = 'backups';
export const BACKUP_KEEP = 7;
const LEGACY_FILE_VERSION = 1;          // `version` of the accounts.json bundle format
const HOT_TTL_MS = 15 * 60_000;         // accounts untouched this long stop being checked at each save

/** A brand-new level 1 character record with the class start gear. */
export function newAccount(name, cls, salt, hash) {
  const c = CLASSES[cls];
  const inv = emptyInventory();
  for (const [id, q] of c.start.items) addItem(inv, id, q);
  const now = Date.now();
  const rec = {
    name, cls, salt, hash,
    level: 1, xp: 0, gold: START_GOLD,
    hp: null, mp: null, // null = full
    inv,
    eq: { weapon: c.start.weapon || null, armor: c.start.armor || null },
    quests: {},
    x: SPAWN_POINT.x, z: SPAWN_POINT.z,
    created: now, lastSeen: now,
  };
  return migrateAccount(rec) || rec; // every feature's defaults apply to new characters too
}

const finite = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Fields handled by the core of migrateAccount (everything else is carried over untouched). */
const CORE_FIELDS = new Set(['name', 'cls', 'salt', 'hash', 'level', 'xp', 'gold', 'hp', 'mp', 'inv', 'eq', 'quests', 'x', 'z', 'created', 'lastSeen', 'v']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validate / normalise / upgrade a persisted account (any version, v0.1 included) into the current schema.
 * Returns null when it cannot be used at all (no valid name, class or credentials).
 *
 * Unknown top-level fields are kept as they are (a field written by a newer feature is never lost).
 * FEATURES ADD THEIR PERSISTENT FIELDS HERE: in the section at the end, one small block per feature, tagged
 * with the feature key, that validates `raw.<field>` and sets `acc.<field>` (default when missing/invalid).
 */
export function migrateAccount(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!validName(raw.name) || !validClass(raw.cls)) return null;
  if (typeof raw.salt !== 'string' || typeof raw.hash !== 'string') return null;
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
    name: raw.name, cls: raw.cls, salt: raw.salt, hash: raw.hash,
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
  });

  // ---- [netcode-perf] schema version
  acc.v = ACCOUNT_VERSION;

  // ---- per-feature fields (v0.2+): add your block below, e.g.
  //   // [my-feature] short description
  //   acc.myField = isValid(raw.myField) ? raw.myField : DEFAULT;

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
    this.accounts = new Map(); // nameKey -> record
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
    let bad = 0;
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
      const key = nameKey(acc.name);
      const prev = this.accounts.get(key);
      if (prev && (prev.lastSeen || 0) >= (acc.lastSeen || 0)) continue;
      this.accounts.set(key, acc);
      this.disk.set(key, text);
      this.queued.set(key, text);
    }
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
      const key = nameKey(acc.name);
      if (this.accounts.has(key)) { kept++; continue; } // a per-account file already exists: it is newer
      this.accounts.set(key, acc);
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
        this.log?.error(`import du compte ${acc.name} impossible : ${err.message}`);
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

  get size() { return this.accounts.size; }
  has(name) { return typeof name === 'string' && this.accounts.has(nameKey(name)); }

  /** Account by (case-insensitive) name, or null. A returned account is watched for changes until idle. */
  get(name) {
    if (typeof name !== 'string') return null;
    const key = nameKey(name);
    const acc = this.accounts.get(key);
    if (!acc) return null;
    this.hot.add(key);
    return acc;
  }

  create(record) {
    const key = nameKey(record.name);
    this.accounts.set(key, record);
    this.hot.add(key);
    this.flagged = true;
    return record;
  }

  /** Something changed: with an account, that one; without, any account in use (logged in recently). */
  markDirty(account) {
    if (account && typeof account.name === 'string') this.hot.add(nameKey(account.name));
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
