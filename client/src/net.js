// Network transport: a thin wrapper around WebSocket (JSON frames, see shared/protocol.js), or around the
// offline fake server which speaks exactly the same protocol.
import { WS_PATH, encode, decode } from '@shared/protocol.js';
import { observeServerVersion } from './version.js'; // [netcode-perf]

export function serverUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // [netcode-perf] batch=1: the server coalesces the messages of one tick into one `batch` frame
  return `${proto}//${location.host}${WS_PATH}?batch=1`;
}

/**
 * [netcode-perf] Deliver one decoded server frame: a `batch` { m: [...] } is unpacked in order, so the rest
 * of the client only ever sees plain messages. auth_ok also feeds the "new version" check.
 */
export function dispatchFrame(msg, onMessage) {
  if (msg.t === 'batch') {
    if (!Array.isArray(msg.m)) return;
    for (const m of msg.m) {
      if (!m || typeof m !== 'object' || typeof m.t !== 'string' || m.t === 'batch') continue;
      try {
        dispatchFrame(m, onMessage);
      } catch (err) {
        console.error(`[net] message « ${m.t} » :`, err); // one faulty handler must not drop the rest of the batch
      }
    }
    return;
  }
  if (msg.t === 'auth_ok') observeServerVersion(msg);
  onMessage(msg);
}

/**
 * A connection object:
 *   send(msg)   close()   isOpen()
 *   events: onOpen(), onMessage(msg), onClose(info)
 */
export class Connection {
  constructor(handlers) {
    this.h = handlers;
    this.ws = null;
    this.fake = null;
    this.open = false;
    this.closing = false;
    this.sentCount = 0;
  }

  /** Connect to the real server. Resolves when open, rejects on failure. */
  connect(url = serverUrl()) {
    this.close();
    this.closing = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.open = true;
        settled = true;
        this.h.onOpen?.();
        resolve();
      };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        const msg = decode(ev.data);
        if (msg) dispatchFrame(msg, (m) => this.h.onMessage(m)); // [netcode-perf]
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('ws_error'));
        }
      };
      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        const wasOpen = this.open;
        this.open = false;
        this.ws = null;
        if (!settled) {
          settled = true;
          reject(new Error('ws_closed'));
        }
        if (wasOpen && !this.closing) this.h.onClose?.({ code: ev.code, reason: ev.reason });
      };
    });
  }

  /** Attach to an offline fake server (same protocol, no network). */
  connectFake(fake) {
    this.close();
    this.closing = false;
    this.fake = fake;
    this.open = true;
    fake.attach((msg) => {
      if (this.fake === fake) this.h.onMessage(msg);
    });
    this.h.onOpen?.();
    return Promise.resolve();
  }

  isOpen() {
    return this.open;
  }

  send(msg) {
    if (!this.open) return false;
    this.sentCount++;
    if (this.fake) {
      this.fake.receive(JSON.parse(encode(msg)));
      return true;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encode(msg));
      return true;
    }
    return false;
  }

  close() {
    this.closing = true;
    this.open = false;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    if (this.fake) {
      this.fake.detach();
      this.fake = null;
    }
  }
}
