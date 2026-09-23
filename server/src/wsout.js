// [netcode-perf] Outgoing WebSocket traffic: permessage-deflate settings, per-tick message coalescing
// (S2C `batch`) and traffic counters for /health.
//
// A client that connects with `?batch=1` (the web client, the bots) receives every message queued during
// one event-loop turn — typically one server tick: snapshot + self + fx + dmg… — as a single frame
// `{"t":"batch","m":[msg, msg, …]}` (order preserved; the client unpacks it transparently). Other clients
// (raw tests, old launchers) get one frame per message, sent immediately, exactly as before.

/** permessage-deflate (RFC 7692) settings for the WebSocketServer. */
export const PERMESSAGE_DEFLATE = {
  threshold: 128,                 // tiny frames (pong, cd…) are not worth a deflate round
  concurrencyLimit: 16,           // zlib jobs in flight (they run on the libuv thread pool)
  serverMaxWindowBits: 14,        // 16 KB sliding window: several snapshots of context, 64 KB of RAM
  zlibDeflateOptions: { level: 4, memLevel: 7 },
  clientNoContextTakeover: true,  // client → server messages are tiny; keeps the inflate side cheap
};

export const netStats = { msgs: 0, frames: 0, bytes: 0, batches: 0 };

const pending = new Set();
let scheduled = false;

function flushPending() {
  scheduled = false;
  if (pending.size === 0) return;
  const list = [...pending];
  pending.clear();
  for (const o of list) o.flush();
}

/** Flush every queued batch now (e.g. before closing the sockets on shutdown). */
export const flushAll = flushPending;

export class Outbox {
  /** @param {import('ws').WebSocket} ws @param {boolean} batch */
  constructor(ws, batch) {
    this.ws = ws;
    this.batch = !!batch;
    this.q = [];
  }

  push(str) {
    netStats.msgs++;
    if (!this.batch) {
      netStats.frames++;
      netStats.bytes += str.length;
      this.ws.send(str);
      return;
    }
    this.q.push(str);
    if (this.q.length === 1) {
      pending.add(this);
      if (!scheduled) {
        scheduled = true;
        setImmediate(flushPending);
      }
    }
  }

  flush() {
    const q = this.q;
    if (q.length === 0) return;
    const out = q.length === 1 ? q[0] : `{"t":"batch","m":[${q.join(',')}]}`;
    if (q.length > 1) netStats.batches++;
    q.length = 0;
    if (this.ws.readyState !== 1) return; // not OPEN any more
    netStats.frames++;
    netStats.bytes += out.length;
    this.ws.send(out);
  }

  discard() {
    this.q.length = 0;
    pending.delete(this);
  }
}

/** True when the upgrade request asks for batched delivery (`/ws?batch=1`). */
export function wantsBatch(req) {
  const url = req?.url || '';
  const i = url.indexOf('?');
  if (i < 0) return false;
  return new URLSearchParams(url.slice(i + 1)).get('batch') === '1';
}

/** Total bytes really written on the sessions' sockets (after compression), for rate sampling. */
export function socketBytesWritten(sessions) {
  let n = 0;
  for (const s of sessions) n += s.ws?._socket?.bytesWritten || 0;
  return n;
}
