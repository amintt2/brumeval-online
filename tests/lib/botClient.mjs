// Headless game client used by tests/bot.mjs and tests/soak.mjs.
// Keeps a merged SelfState, an entity store built from `snap` deltas, and lets tests await messages.
import WebSocket from 'ws';
import { CollisionWorld } from '../../shared/collision.js';
import { MOVE_SEND_HZ, PLAYER_RADIUS } from '../../shared/protocol.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sharedCollision = null;
export const collisionWorld = () => (sharedCollision ||= new CollisionWorld());

export class Bot {
  constructor(url, label, { keepHistory = true, batch = true, origin = 'http://localhost', headers = null } = {}) {
    // `batch` asks the server to coalesce the messages of one tick into a single `batch` frame (unpacked here).
    this.url = batch ? `${url}${url.includes('?') ? '&' : '?'}batch=1` : url;
    this.label = label;
    this.keepHistory = keepHistory;
    this.origin = origin;     // browsers always send an Origin (the server refuses Origin-less clients by default)
    this.headers = headers;   // e.g. { 'X-Forwarded-For': ip } to simulate players behind a trusted proxy
    this.history = [];         // every message received (when keepHistory)
    this.count = 0;            // messages received
    this.frames = 0;           // WebSocket frames received (a batch frame carries several messages)
    this.bytes = 0;            // payload bytes received (after permessage-deflate decompression)
    this.waiters = [];
    this.self = null;
    this.id = 0;
    this.ents = new Map();     // id -> merged EntState
    this.corrections = 0;
    this.errors = [];          // err messages
    this.closed = false;
    this.x = 0; this.z = 0; this.ry = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, { origin: this.origin, ...(this.headers ? { headers: this.headers } : {}) });
      this.ws = ws;
      ws.on('open', () => resolve(this));
      ws.on('error', (err) => {
        this.lastError = err.message;
        if (ws.readyState !== WebSocket.OPEN) reject(err);
      });
      ws.on('message', (data) => this.onMessage(data));
      ws.on('close', (code) => {
        this.closed = true;
        this.closeCode = code;
        for (const w of this.waiters) w.reject(new Error(`${this.label}: socket fermée (${code}) en attendant ${w.desc}`));
        this.waiters = [];
      });
    });
  }

  /** Bytes read on the TCP socket so far (what really crossed the network, compressed). */
  wireBytes() {
    return this.ws?._socket?.bytesRead ?? this.bytes;
  }

  onMessage(data) {
    this.frames++;
    this.bytes += data.length;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg && msg.t === 'batch' && Array.isArray(msg.m)) {
      for (const m of msg.m) this.dispatch(m);
      return;
    }
    this.dispatch(msg);
  }

  dispatch(msg) {
    if (!msg || typeof msg !== 'object') return;
    this.count++;
    this.apply(msg);
    if (this.keepHistory) this.history.push(msg);
    for (const w of [...this.waiters]) {
      let ok = false;
      try { ok = w.pred(msg); } catch (err) { w.reject(err); this.waiters.splice(this.waiters.indexOf(w), 1); continue; }
      if (ok) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  }

  apply(msg) {
    switch (msg.t) {
      case 'auth_ok':
        this.id = msg.id;
        this.self = msg.self;
        this.x = msg.self.x; this.z = msg.self.z;
        break;
      case 'self':
        if (this.self) for (const [k, v] of Object.entries(msg)) if (k !== 't') this.self[k] = v;
        break;
      case 'snap':
        for (const e of msg.ents) {
          const cur = this.ents.get(e.id);
          if (cur) Object.assign(cur, e);
          else this.ents.set(e.id, { ...e });
        }
        for (const id of msg.gone || []) this.ents.delete(id);
        break;
      case 'correct':
        this.corrections++;
        this.x = msg.x; this.z = msg.z;
        break;
      case 'err':
        this.errors.push(msg);
        break;
      case 'kick':
        this.kickMsg = msg.msg;
        break;
      default:
        break;
    }
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Index to pass as `from` so that waitFor also sees messages received after this point. */
  mark() { return this.history.length; }

  /** Resolve with the first message matching `pred` (searching history from `from`, then live). */
  waitFor(pred, { timeout = 5000, from = null, desc = 'un message' } = {}) {
    if (from !== null) {
      for (let i = from; i < this.history.length; i++) if (pred(this.history[i])) return Promise.resolve(this.history[i]);
    }
    if (this.closed) return Promise.reject(new Error(`${this.label}: socket fermée, impossible d'attendre ${desc}`));
    return new Promise((resolve, reject) => {
      const w = { pred, desc, resolve: null, reject: null };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`${this.label}: délai dépassé (${timeout} ms) en attendant ${desc}`));
      }, timeout);
      w.resolve = (m) => { clearTimeout(timer); resolve(m); };
      w.reject = (e) => { clearTimeout(timer); reject(e); };
      this.waiters.push(w);
    });
  }

  waitType(t, extra = () => true, opts = {}) {
    return this.waitFor((m) => m.t === t && extra(m), { desc: `« ${t} »`, ...opts });
  }

  async register(name, password, cls) {
    const from = this.mark();
    this.send({ t: 'register', name, password, cls });
    return this.waitFor((m) => m.t === 'auth_ok' || m.t === 'auth_err', { from, timeout: 8000, desc: 'auth' });
  }

  async login(name, password) {
    const from = this.mark();
    this.send({ t: 'login', name, password });
    return this.waitFor((m) => m.t === 'auth_ok' || m.t === 'auth_err', { from, timeout: 8000, desc: 'auth' });
  }

  /**
   * Walk to (tx, tz) like the real client: CollisionWorld.move steps at `speed × factor`,
   * one `move` every 1/MOVE_SEND_HZ s. Throws if stuck.
   */
  async walkTo(tx, tz, { factor = 1, stop = 0.3, maxMs = 30000 } = {}) {
    const cw = collisionWorld();
    const speed = this.self.stats.speed * factor;
    const interval = 1000 / MOVE_SEND_HZ;
    const t0 = performance.now();
    let last = t0;
    let lastProgress = t0, best = Infinity;
    for (;;) {
      const d = Math.hypot(tx - this.x, tz - this.z);
      if (d <= stop) break;
      if (d < best - 0.05) { best = d; lastProgress = performance.now(); }
      if (performance.now() - lastProgress > 2500) throw new Error(`${this.label}: bloqué en (${this.x.toFixed(1)}, ${this.z.toFixed(1)}) vers (${tx}, ${tz})`);
      if (performance.now() - t0 > maxMs) throw new Error(`${this.label}: trajet trop long vers (${tx}, ${tz})`);
      await sleep(interval);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      let remaining = Math.min(speed * dt, d);
      while (remaining > 1e-4) {
        const step = Math.min(0.5, remaining);
        const dd = Math.hypot(tx - this.x, tz - this.z);
        if (dd < 1e-6) break;
        const r = cw.move(this.x, this.z, this.x + ((tx - this.x) / dd) * step, this.z + ((tz - this.z) / dd) * step, PLAYER_RADIUS);
        this.x = r.x; this.z = r.z;
        remaining -= step;
      }
      this.ry = Math.atan2(tx - this.x, tz - this.z);
      this.send({ t: 'move', x: +this.x.toFixed(2), z: +this.z.toFixed(2), ry: +this.ry.toFixed(3) });
    }
    this.send({ t: 'move', x: +this.x.toFixed(2), z: +this.z.toFixed(2), ry: +this.ry.toFixed(3) });
  }

  async walkPath(points, opts) {
    for (const [x, z] of points) await this.walkTo(x, z, opts);
  }

  close() {
    return new Promise((resolve) => {
      if (this.closed || !this.ws) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}
