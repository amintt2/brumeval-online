// Connection-level helpers: real client IP behind reverse proxies, Origin allow-list.

/** Strip the IPv4-mapped IPv6 prefix and zone ids: "::ffff:1.2.3.4" -> "1.2.3.4". */
export function normalizeIp(ip) {
  if (typeof ip !== 'string' || !ip) return '?';
  let s = ip.trim();
  if (s.startsWith('[') && s.includes(']')) s = s.slice(1, s.indexOf(']'));
  const pct = s.indexOf('%');
  if (pct > 0) s = s.slice(0, pct);
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(s)) s = s.slice(7);
  // "1.2.3.4:5678" (some proxies add the port)
  const m = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(s);
  if (m) s = m[1];
  return s.toLowerCase().slice(0, 64);
}

export function isLoopback(ip) {
  return ip === '::1' || /^127\./.test(ip) || ip === 'localhost';
}

/**
 * Client IP of an upgrade request. X-Forwarded-For is only used when `trustProxy` > 0: the address added by
 * the n-th trusted proxy (counting from the right) is the client. Anything to its left can be forged.
 */
export function clientIp(req, trustProxy = 0) {
  const peer = normalizeIp(req?.socket?.remoteAddress || '');
  if (!(trustProxy > 0)) return peer;
  const raw = req?.headers?.['x-forwarded-for'];
  const header = Array.isArray(raw) ? raw.join(',') : raw;
  if (typeof header !== 'string' || !header.trim()) return peer;
  const hops = header.split(',').map((s) => s.trim()).filter(Boolean);
  if (!hops.length) return peer;
  const candidate = hops[Math.max(0, hops.length - trustProxy)];
  const ip = normalizeIp(candidate);
  return /^[0-9a-f:.]+$/i.test(ip) ? ip : peer;
}

const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i;

/**
 * Is a WebSocket upgrade from this Origin allowed?
 * - no Origin header (non-browser client): only when cfg.allowNoOrigin
 * - same host as the request (the page served by this server, whatever its domain)
 * - an entry of cfg.allowedOrigins ('*' allows everything)
 * - http(s)://localhost / 127.x / [::1] on any port when cfg.allowLocalhostOrigins
 */
export function originAllowed(origin, host, cfg) {
  if (origin === undefined || origin === null || origin === '') return !!cfg.allowNoOrigin;
  if (typeof origin !== 'string') return false;
  const o = origin.trim().toLowerCase().replace(/\/+$/, '');
  if (cfg.allowedOrigins.includes('*')) return true;
  if (cfg.allowedOrigins.some((a) => a.toLowerCase().replace(/\/+$/, '') === o)) return true;
  if (cfg.allowLocalhostOrigins && LOCAL_ORIGIN_RE.test(o)) return true;
  if (typeof host === 'string' && host) {
    try {
      const u = new URL(o);
      if (u.host.toLowerCase() === host.trim().toLowerCase()) return true;
    } catch {
      return false;
    }
  }
  return false;
}
