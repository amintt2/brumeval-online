// [netcode-perf] Client IP behind a reverse proxy.
// TRUST_PROXY unset / 0 / false: the socket address is used (direct exposure: X-Forwarded-For is ignored,
// since anybody can forge it). TRUST_PROXY=1 (or true): one trusted proxy (nginx, Caddy…) in front; the
// client address is the last entry it appended to X-Forwarded-For. TRUST_PROXY=n: n proxies in a chain.

export function trustedHops(env = process.env.TRUST_PROXY) {
  if (env === undefined || env === null) return 0;
  const v = String(env).trim().toLowerCase();
  if (v === '' || v === '0' || v === 'false' || v === 'no' || v === 'non') return 0;
  if (v === 'true' || v === 'yes' || v === 'oui') return 1;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 0;
}

const clean = (ip) => {
  const s = String(ip || '').trim();
  return s.startsWith('::ffff:') ? s.slice(7) : s;
};

/** Best-effort client IP for logs, rate limits and bans. */
export function clientIp(req, hops = trustedHops()) {
  const direct = clean(req?.socket?.remoteAddress) || '?';
  if (!hops) return direct;
  const xff = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff.join(',') : xff;
  if (typeof raw === 'string' && raw.trim()) {
    const list = raw.split(',').map(clean).filter(Boolean);
    const ip = list[list.length - hops] ?? list[0];
    if (ip) return ip.slice(0, 64);
  }
  const real = req.headers?.['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return clean(real).slice(0, 64);
  return direct;
}
