// Account storage: one JSON file (accounts.json) written atomically (tmp + rename).
import fs from 'node:fs';
import path from 'node:path';
import { CLASSES, MAX_LEVEL, START_GOLD, xpToNext } from '../../shared/data.js';
import { SPAWN_POINT, isWalkable } from '../../shared/world.js';
import { emptyInventory, addItem, sanitizeInventory, isItem, equipSlotOf } from './inventory.js';
import { sanitizeQuests } from './quests.js';
import { nameKey, validName, validClass } from './auth.js';
import { sanitizeSecurityFields } from './security/accountFields.js'; // [anticheat]

const FILE_VERSION = 1;

/** A brand-new level 1 character record with the class start gear. */
export function newAccount(name, cls, salt, hash) {
  const c = CLASSES[cls];
  const inv = emptyInventory();
  for (const [id, q] of c.start.items) addItem(inv, id, q);
  const now = Date.now();
  return {
    name, cls, salt, hash,
    level: 1, xp: 0, gold: START_GOLD,
    hp: null, mp: null, // null = full
    inv,
    eq: { weapon: c.start.weapon || null, armor: c.start.armor || null },
    quests: {},
    x: SPAWN_POINT.x, z: SPAWN_POINT.z,
    created: now, lastSeen: now,
  };
}

const finite = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Validate/normalise a persisted account. Returns null when it cannot be used at all. */
export function sanitizeAccount(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!validName(raw.name) || !validClass(raw.cls)) return null;
  if (typeof raw.salt !== 'string' || typeof raw.hash !== 'string') return null;
  const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(finite(raw.level, 1))));
  const xp = level >= MAX_LEVEL ? 0 : Math.max(0, Math.min(xpToNext(level) - 1, Math.floor(finite(raw.xp, 0))));
  const eq = { weapon: null, armor: null };
  for (const slot of ['weapon', 'armor']) {
    const id = raw.eq?.[slot];
    if (isItem(id) && equipSlotOf(id) === slot) eq[slot] = id;
  }
  let x = finite(raw.x, SPAWN_POINT.x), z = finite(raw.z, SPAWN_POINT.z);
  if (!isWalkable(x, z)) ({ x, z } = SPAWN_POINT);
  return {
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
    ...sanitizeSecurityFields(raw), // [anticheat] role, mute, ignore list, last IP (all optional)
  };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      // Antivirus / indexers on Windows can briefly lock the destination.
      if (attempt < 5 && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES')) {
        sleepSync(20 * (attempt + 1));
        continue;
      }
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw err;
    }
  }
}

export class AccountStore {
  constructor(dataDir, log) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'accounts.json');
    this.log = log;
    this.accounts = new Map(); // nameKey -> record
    this.dirty = false;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.file)) return this;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      const backup = `${this.file}.corrompu-${Date.now()}`;
      try { fs.renameSync(this.file, backup); } catch { /* ignore */ }
      this.log?.error(`accounts.json illisible (${err.message}) — sauvegardé sous ${path.basename(backup)}, démarrage avec une base vide`);
      return this;
    }
    const list = data && typeof data.accounts === 'object' && data.accounts ? Object.values(data.accounts) : [];
    let bad = 0;
    for (const raw of list) {
      const acc = sanitizeAccount(raw);
      if (!acc) { bad++; continue; }
      this.accounts.set(nameKey(acc.name), acc);
    }
    if (bad) this.log?.warn(`${bad} compte(s) invalide(s) ignoré(s) dans accounts.json`);
    return this;
  }

  get size() { return this.accounts.size; }
  has(name) { return this.accounts.has(nameKey(name)); }
  get(name) { return typeof name === 'string' ? this.accounts.get(nameKey(name)) || null : null; }

  create(record) {
    this.accounts.set(nameKey(record.name), record);
    this.dirty = true;
    return record;
  }

  markDirty() { this.dirty = true; }

  /** Write every account to disk if something changed (or `force`). Never throws. */
  save(force = false) {
    if (!this.dirty && !force) return true;
    const accounts = {};
    for (const [k, a] of this.accounts) accounts[k] = a;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      writeFileAtomic(this.file, JSON.stringify({ version: FILE_VERSION, savedAt: Date.now(), accounts }));
      this.dirty = false;
      return true;
    } catch (err) {
      this.log?.error(`sauvegarde des comptes impossible : ${err.message}`);
      return false;
    }
  }
}

