// Security configuration: every threshold of the anti-cheat / moderation layer, overridable by environment
// variables (see docs/SECURITE.md) or by `startServer({ security: { … } })` in tests.
import { trustedHops } from '../proxy.js';

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};
const num = (v, d) => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d) => {
  if (v === undefined || v === null || v === '') return d;
  return /^(1|true|yes|oui|on)$/i.test(String(v).trim());
};
const list = (v) => (typeof v === 'string' && v.trim()
  ? v.split(',').map((s) => s.trim()).filter(Boolean)
  : null);

export const DEFAULT_ORIGINS = ['https://brumel.mciut.fr'];

/**
 * Build the security configuration.
 * @param {object} [overrides] fields that win over the environment (tests)
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadSecurityConfig(overrides = {}, env = process.env) {
  // Under `node --test` the automated tests connect without an Origin header (Node clients).
  const underTest = !!env.NODE_TEST_CONTEXT;
  const cfg = {
    // ---- connection layer
    /** Number of reverse proxies in front of the server whose X-Forwarded-For entries are trusted (0 = ignore XFF). */
    trustProxy: trustedHops(env.TRUST_PROXY), // 0|1|n, also true/oui (server/src/proxy.js)
    /** Browser origins allowed to open the WebSocket ('*' disables the check). Same-host origins are always allowed. */
    allowedOrigins: list(env.ALLOWED_ORIGINS) || [...DEFAULT_ORIGINS],
    /** http(s)://localhost:* and 127.0.0.1:* origins (development). */
    allowLocalhostOrigins: bool(env.ALLOW_LOCALHOST_ORIGINS, true),
    /** Clients sending no Origin header at all (bots, scripts). Off in production. */
    allowNoOrigin: bool(env.ALLOW_NO_ORIGIN, underTest),
    /**
     * Loopback addresses (127.0.0.1, ::1) are exempt from per-IP limits: behind a reverse proxy without
     * TRUST_PROXY every player would otherwise share the proxy's address.
     */
    exemptLoopback: bool(env.SECURITY_EXEMPT_LOOPBACK, true),
    maxConnPerIp: Math.max(1, int(env.MAX_CONN_PER_IP, 5)),
    /** A connection must log in within this delay. */
    authTimeoutMs: Math.max(5, int(env.AUTH_TIMEOUT_S, 120)) * 1000,
    /** Kick after this long without any gameplay message (pings do not count). */
    idleKickMs: Math.max(1, num(env.IDLE_KICK_MIN, 30)) * 60_000,
    /** Global message budget per connection: sustained rate and burst (token bucket). Beyond → kick. */
    globalRate: num(env.MSG_RATE_PER_S, 60),
    globalBurst: num(env.MSG_BURST, 120),

    // ---- authentication
    loginFreeFailsIp: int(env.LOGIN_FREE_FAILS_IP, 8),
    loginFreeFailsAccount: int(env.LOGIN_FREE_FAILS_ACCOUNT, 5),
    loginBackoffBaseMs: int(env.LOGIN_BACKOFF_BASE_MS, 1000),
    loginBackoffMaxIpMs: int(env.LOGIN_BACKOFF_MAX_IP_S, 900) * 1000,
    loginBackoffMaxAccountMs: int(env.LOGIN_BACKOFF_MAX_ACCOUNT_S, 300) * 1000,
    /** Failure counters are forgotten after this long without a new failure. */
    loginForgetMs: int(env.LOGIN_FORGET_MIN, 15) * 60_000,
    accountsPerIpPerHour: Math.max(1, int(env.ACCOUNTS_PER_IP_PER_HOUR, 5)),

    // ---- suspicion & escalation
    /** Suspicion scores halve every `scoreHalfLifeMs`. */
    scoreHalfLifeMs: num(env.SUSPICION_HALF_LIFE_MIN, 10) * 60_000,
    warnAt: num(env.SUSPICION_WARN, 15),
    kickAt: num(env.SUSPICION_KICK, 50),
    /** Automatic kicks within `strikeWindowMs` before an automatic temporary ban. */
    banAfterKicks: Math.max(1, int(env.SUSPICION_BAN_AFTER_KICKS, 3)),
    strikeWindowMs: num(env.SUSPICION_STRIKE_WINDOW_H, 24) * 3_600_000,
    /** First automatic ban duration; doubles for every previous automatic ban (max 30 days). */
    autoBanMs: num(env.AUTO_BAN_MIN, 60) * 60_000,
    autoBanMaxMs: 30 * 24 * 3_600_000,

    // ---- security log
    logMaxBytes: Math.max(64 * 1024, int(env.SECURITY_LOG_MAX_MB, 5) * 1024 * 1024),
    logKeep: Math.max(1, int(env.SECURITY_LOG_KEEP, 3)),

    // ---- moderation
    adminNames: (list(env.ADMIN_NAMES) || []).map((n) => n.toLowerCase()),
    chatLinkWhitelist: (list(env.CHAT_LINK_WHITELIST) || ['brumel.mciut.fr']).map((d) => d.toLowerCase()),

    // ---- economy
    maxGold: int(env.MAX_GOLD, 10_000_000),
    /** Throw on broken inventory invariants (tests / debug); in production they are repaired and flagged. */
    strictInvariants: bool(env.SECURITY_ASSERT, underTest),
  };
  return Object.assign(cfg, overrides);
}
