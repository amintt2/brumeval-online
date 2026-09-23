// Account and IP bans, persisted in <dataDir>/bans.json (atomic write). Expired bans are pruned lazily.
//   { version: 1, bans: [{ id, type: 'account'|'ip', key, name?, until: epochMs|null, reason, author, created }],
//     offenses: { '<account key or ip>': number of automatic bans so far } }
import fs from 'node:fs';
import path from 'node:path';

const FILE_VERSION = 1;

/** Case-insensitive account key (same rule as auth.nameKey). */
const accountKey = (name) => String(name).toLowerCase();

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (attempt < 5 && ['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
        continue;
      }
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw err;
    }
  }
}

export class BanStore {
  constructor({ dataDir = null, log = null, clock = Date.now } = {}) {
    this.file = dataDir ? path.join(dataDir, 'bans.json') : null;
    this.log = log;
    this.clock = clock;
    this.bans = [];
    this.offenses = Object.create(null);
    this.seq = 1;
    this.load();
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const list = Array.isArray(data?.bans) ? data.bans : [];
      for (const b of list) {
        if (!b || (b.type !== 'account' && b.type !== 'ip') || typeof b.key !== 'string' || !b.key) continue;
        this.bans.push({
          id: Number.isSafeInteger(b.id) ? b.id : 0,
          type: b.type,
          key: b.type === 'account' ? accountKey(b.key) : b.key,
          name: typeof b.name === 'string' ? b.name : undefined,
          until: typeof b.until === 'number' && Number.isFinite(b.until) ? b.until : null,
          reason: typeof b.reason === 'string' ? b.reason.slice(0, 200) : '',
          author: typeof b.author === 'string' ? b.author.slice(0, 32) : '?',
          created: typeof b.created === 'number' ? b.created : this.clock(),
          auto: !!b.auto,
        });
      }
      for (const b of this.bans) if (b.id >= this.seq) this.seq = b.id + 1;
      for (const b of this.bans) if (!b.id) b.id = this.seq++;
      if (data?.offenses && typeof data.offenses === 'object') {
        for (const [k, v] of Object.entries(data.offenses)) {
          if (Number.isSafeInteger(v) && v > 0) this.offenses[k] = v;
        }
      }
      this.prune();
    } catch (err) {
      const backup = `${this.file}.corrompu-${Date.now()}`;
      try { fs.renameSync(this.file, backup); } catch { /* ignore */ }
      this.log?.error(`bans.json illisible (${err.message}) — sauvegardé sous ${path.basename(backup)}`);
    }
  }

  save() {
    if (!this.file) return true;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      writeAtomic(this.file, JSON.stringify({ version: FILE_VERSION, bans: this.bans, offenses: this.offenses }, null, 1));
      return true;
    } catch (err) {
      this.log?.error(`sauvegarde des bannissements impossible : ${err.message}`);
      return false;
    }
  }

  /** Remove expired bans. Returns true if something was removed. */
  prune(now = this.clock()) {
    const before = this.bans.length;
    this.bans = this.bans.filter((b) => b.until === null || b.until > now);
    return this.bans.length !== before;
  }

  active(now = this.clock()) {
    if (this.prune(now)) this.save();
    return this.bans;
  }

  /**
   * Add a ban. `durationMs` null/Infinity = permanent. A new ban on the same key replaces the previous one.
   * @returns the ban record
   */
  add(type, key, { durationMs = null, reason = '', author = '?', name, auto = false } = {}) {
    const now = this.clock();
    const k = type === 'account' ? accountKey(key) : String(key);
    this.bans = this.bans.filter((b) => !(b.type === type && b.key === k));
    const ban = {
      id: this.seq++,
      type,
      key: k,
      name: name || undefined,
      until: durationMs === null || durationMs === Infinity ? null : now + Math.max(1000, durationMs),
      reason: String(reason || '').slice(0, 200),
      author: String(author || '?').slice(0, 32),
      created: now,
      auto,
    };
    this.bans.push(ban);
    if (auto) this.offenses[k] = (this.offenses[k] || 0) + 1;
    this.save();
    return ban;
  }

  banAccount(name, opts = {}) { return this.add('account', name, { name, ...opts }); }
  banIp(ip, opts = {}) { return this.add('ip', ip, opts); }

  /** Remove bans of `type` on `key`. Returns the number removed. */
  remove(type, key) {
    const k = type === 'account' ? accountKey(key) : String(key);
    const before = this.bans.length;
    this.bans = this.bans.filter((b) => !(b.type === type && b.key === k));
    const n = before - this.bans.length;
    if (n) this.save();
    return n;
  }

  find(type, key, now = this.clock()) {
    if (typeof key !== 'string' || !key) return null;
    const k = type === 'account' ? accountKey(key) : key;
    for (const b of this.bans) {
      if (b.type === type && b.key === k && (b.until === null || b.until > now)) return b;
    }
    return null;
  }

  accountBan(name, now) { return this.find('account', name, now); }
  ipBan(ip, now) { return this.find('ip', ip, now); }

  /** Number of automatic bans already given to this key. */
  offenseCount(key) { return this.offenses[key] || 0; }
}
