// Token buckets: the global per-connection budget and one bucket per client message type.

export class TokenBucket {
  /**
   * @param {number} rate  tokens refilled per second
   * @param {number} burst bucket capacity (starts full)
   */
  constructor(rate, burst, now = 0) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.t = now;
  }

  refill(now) {
    if (now > this.t) {
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.t) / 1000) * this.rate);
      this.t = now;
    }
  }

  /** Take `n` tokens if available. Returns true when allowed. */
  take(now, n = 1) {
    this.refill(now);
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }

  level(now) {
    this.refill(now);
    return this.tokens;
  }
}

/**
 * Per client message type: [sustained rate per second, burst]. The real client sends `move` at 15 Hz (bursts of
 * queued messages after a network stall are absorbed by the burst) and `ping` every 2 s. Unknown / future types
 * (e.g. `dodge`, `sprint`) use `default`.
 */
export const TYPE_LIMITS = {
  move: [30, 100],
  ability: [12, 24],
  stop: [10, 20],
  chat: [3, 8],
  interact: [5, 12],
  quest_accept: [5, 10],
  quest_turnin: [5, 10],
  buy: [8, 20],
  sell: [12, 30],
  use_item: [8, 20],
  equip: [8, 20],
  unequip: [8, 20],
  drop: [8, 20],
  respawn: [2, 5],
  ping: [3, 8],
  register: [1, 5],
  login: [1, 5],
  default: [20, 40],
};

/** Lazily created per-type buckets of one connection. */
export class TypeLimiter {
  constructor(limits = TYPE_LIMITS) {
    this.limits = limits;
    this.buckets = new Map();
  }

  allow(type, now) {
    const key = Object.prototype.hasOwnProperty.call(this.limits, type) ? type : 'default';
    let b = this.buckets.get(key);
    if (!b) {
      const [rate, burst] = this.limits[key];
      b = new TokenBucket(rate, burst, now);
      this.buckets.set(key, b);
    }
    return b.take(now);
  }
}

/**
 * Exponential backoff after repeated failures, keyed by string (IP, account…).
 * The first `free` failures cost nothing; then each failure locks the key for base × 2^(n − free) ms (capped).
 */
export class Backoff {
  constructor({ free, baseMs, maxMs, forgetMs }) {
    this.free = free;
    this.baseMs = baseMs;
    this.maxMs = maxMs;
    this.forgetMs = forgetMs;
    this.map = new Map();
  }

  entry(key, now) {
    const e = this.map.get(key);
    if (e && now - e.last > this.forgetMs) {
      this.map.delete(key);
      return null;
    }
    return e || null;
  }

  /** Remaining lock in ms (0 = allowed). */
  blockedFor(key, now) {
    const e = this.entry(key, now);
    return e ? Math.max(0, e.until - now) : 0;
  }

  fail(key, now) {
    const e = this.entry(key, now) || { fails: 0, last: now, until: 0 };
    e.fails++;
    e.last = now;
    if (e.fails > this.free) e.until = now + Math.min(this.maxMs, this.baseMs * 2 ** (e.fails - this.free - 1));
    this.map.set(key, e);
    return e;
  }

  reset(key) { this.map.delete(key); }

  failures(key, now) { return this.entry(key, now)?.fails || 0; }

  /** Drop forgotten entries (memory bound). */
  prune(now) {
    for (const [k, e] of this.map) if (now - e.last > this.forgetMs) this.map.delete(k);
  }
}

/** Sliding window counter: at most `max` events per `windowMs` per key. */
export class WindowCounter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.map = new Map();
  }

  times(key, now) {
    const a = this.map.get(key);
    if (!a) return [];
    while (a.length && now - a[0] >= this.windowMs) a.shift();
    if (!a.length) this.map.delete(key);
    return a;
  }

  allowed(key, now) { return this.times(key, now).length < this.max; }

  add(key, now) {
    const a = this.times(key, now);
    a.push(now);
    this.map.set(key, a);
  }

  prune(now) {
    for (const k of [...this.map.keys()]) this.times(k, now);
  }
}
