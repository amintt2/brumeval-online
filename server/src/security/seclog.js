// Security journal: one JSON object per line (JSONL) in <dataDir>/security.log, rotated by size
// (security.log -> security.log.1 -> … -> security.log.<keep>). The newest entries are also kept in memory
// for /inspect. Without a data directory (unit tests) only the memory ring is used.
import fs from 'node:fs';
import path from 'node:path';

const RING_SIZE = 500;
/** Entries with the same throttle key are written at most once per THROTTLE_MS (the others are counted). */
const THROTTLE_MS = 2000;

export class SecurityLog {
  constructor({ dataDir = null, maxBytes = 5 * 1024 * 1024, keep = 3, log = null, clock = Date.now } = {}) {
    this.file = dataDir ? path.join(dataDir, 'security.log') : null;
    this.maxBytes = maxBytes;
    this.keep = keep;
    this.log = log;
    this.clock = clock;
    this.ring = [];
    this.size = -1; // unknown until the first write
    this.throttle = new Map(); // key -> { t, suppressed }
    this.failed = false;
    if (this.file) {
      try { fs.mkdirSync(dataDir, { recursive: true }); } catch { /* reported on first write */ }
    }
  }

  /**
   * Record an event. `entry.type` is required ('flag', 'warn', 'kick', 'ban', 'unban', 'gm', 'auth', 'conn',
   * 'chat', 'invariant'…). `throttleKey` groups repetitive entries.
   */
  write(entry, throttleKey = null) {
    const now = this.clock();
    if (throttleKey) {
      const th = this.throttle.get(throttleKey);
      if (th && now - th.t < THROTTLE_MS) {
        th.suppressed++;
        return false;
      }
      const suppressed = th?.suppressed || 0;
      this.throttle.set(throttleKey, { t: now, suppressed: 0 });
      if (suppressed) entry = { ...entry, suppressed };
      if (this.throttle.size > 5000) this.pruneThrottle(now);
    }
    const rec = { ts: new Date(now).toISOString(), ...entry };
    this.ring.push(rec);
    if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE);
    if (this.file) this.append(`${JSON.stringify(rec)}\n`);
    return true;
  }

  pruneThrottle(now) {
    for (const [k, v] of this.throttle) if (now - v.t > THROTTLE_MS) this.throttle.delete(k);
  }

  append(line) {
    try {
      if (this.size < 0) {
        try { this.size = fs.statSync(this.file).size; } catch { this.size = 0; }
      }
      if (this.size + line.length > this.maxBytes) this.rotate();
      fs.appendFileSync(this.file, line);
      this.size += Buffer.byteLength(line);
      this.failed = false;
    } catch (err) {
      if (!this.failed) this.log?.error(`journal de sécurité : écriture impossible (${err.message})`);
      this.failed = true;
    }
  }

  rotate() {
    for (let i = this.keep; i >= 1; i--) {
      const src = i === 1 ? this.file : `${this.file}.${i - 1}`;
      const dst = `${this.file}.${i}`;
      try {
        if (fs.existsSync(src)) {
          if (i === this.keep && fs.existsSync(dst)) fs.unlinkSync(dst);
          fs.renameSync(src, dst);
        }
      } catch (err) {
        this.log?.error(`journal de sécurité : rotation impossible (${err.message})`);
      }
    }
    this.size = 0;
  }

  /** Most recent in-memory entries matching `pred`, newest first. */
  recent(pred = () => true, limit = 20) {
    const out = [];
    for (let i = this.ring.length - 1; i >= 0 && out.length < limit; i--) if (pred(this.ring[i])) out.push(this.ring[i]);
    return out;
  }
}
