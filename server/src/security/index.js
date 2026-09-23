// Security core: suspicion scores with decay, automatic escalation (warn -> kick -> temporary ban),
// bans, connection / login limits, economy invariants and the security journal.
//
// Other modules report suspicious behaviour with `game.security?.flag?.(player, code, weight, detail)`
// (ROADMAP §4.3). A flag adds `weight` to the account score and to the IP score; scores halve every
// `scoreHalfLifeMs`. Crossing `warnAt` logs a warning, `kickAt` disconnects the player (a "strike");
// `banAfterKicks` strikes within `strikeWindowMs` give an automatic temporary ban that doubles each time.
import { nameKey } from '../auth.js';
import { loadSecurityConfig } from './config.js';
import { SecurityLog } from './seclog.js';
import { BanStore } from './bans.js';
import { Backoff, WindowCounter } from './ratelimit.js';
import { isLoopback } from './connection.js';
import { checkPlayerInvariants } from './invariants.js';
import { formatDuration, banSpan } from './format.js';

const RECENT_FLAGS = 30;
const INVARIANT_EVERY_MS = 2000;
const PRUNE_EVERY_MS = 60_000;
const WARN_EVERY_MS = 60_000;

/** Refusal spam: more than `max` refusals with this error code within 10 s -> flag. */
const REFUSAL_RULES = {
  out_of_range: { max: 15, code: 'range_spam', w: 2 },
  cooldown: { max: 15, code: 'cooldown_spam', w: 2 },
  bad_request: { max: 12, code: 'bad_request_spam', w: 2 },
  no_target: { max: 25, code: 'target_spam', w: 1 },
  bad_target: { max: 25, code: 'target_spam', w: 1 },
  too_far: { max: 20, code: 'range_spam', w: 1 },
  '*': { max: 40, code: 'refusal_spam', w: 3 },
};
const REFUSAL_WINDOW_MS = 10_000;

export const KICK_MESSAGES = {
  suspicious: 'Vous avez été déconnecté : activité suspecte détectée.',
  idle: 'Vous avez été déconnecté pour inactivité.',
};

export class Security {
  /**
   * @param {object} [opts]
   * @param {string|null} [opts.dataDir] where bans.json / security.log live (null = memory only)
   * @param {object} [opts.config] overrides of loadSecurityConfig()
   * @param {() => number} [opts.clock] wall clock (epoch ms)
   */
  constructor({ dataDir = null, log = null, config = {}, clock = Date.now } = {}) {
    this.cfg = loadSecurityConfig(config);
    this.log = log;
    this.clock = clock;
    this.game = null;
    this.seclog = new SecurityLog({ dataDir, maxBytes: this.cfg.logMaxBytes, keep: this.cfg.logKeep, log, clock: () => this.clock() });
    this.bans = new BanStore({ dataDir, log, clock: () => this.clock() });
    this.scores = new Map();      // 'a:<key>' | 'ip:<ip>' -> { v, t }
    this.sessionScores = new WeakMap(); // pre-auth sessions from exempt addresses
    this.recentFlags = new Map(); // account key -> [{ t, code, w, detail }]
    this.strikes = new Map();     // account key | ip -> [t]
    this.lastWarn = new Map();
    this.connsByIp = new Map();
    this.loginIp = new Backoff({ free: this.cfg.loginFreeFailsIp, baseMs: this.cfg.loginBackoffBaseMs, maxMs: this.cfg.loginBackoffMaxIpMs, forgetMs: this.cfg.loginForgetMs });
    this.loginAccount = new Backoff({ free: this.cfg.loginFreeFailsAccount, baseMs: this.cfg.loginBackoffBaseMs, maxMs: this.cfg.loginBackoffMaxAccountMs, forgetMs: this.cfg.loginForgetMs });
    this.registrations = new WindowCounter(this.cfg.accountsPerIpPerHour, 3_600_000);
    this.refusals = new WeakMap(); // player -> Map(code -> times[])
    this.nextInvariantAt = 0;
    this.nextPruneAt = 0;
    this.stats = { flags: 0, kicks: 0, bans: 0 };
  }

  now() { return this.clock(); }

  attach(game) {
    this.game = game;
    return this;
  }

  // ------------------------------------------------------------------ roles
  roleOf(p) {
    if (!p) return 'player';
    if (this.cfg.adminNames.includes(nameKey(p.name))) return 'admin';
    // [accounts] the account login counts as well, and the account role wins over a character role
    if (typeof p.login?.login === 'string' && this.cfg.adminNames.includes(nameKey(p.login.login))) return 'admin';
    const r = p.login?.role || p.account?.role;
    return r === 'admin' || r === 'gm' ? r : 'player';
  }

  isStaff(p) { return this.roleOf(p) !== 'player'; }
  isAdmin(p) { return this.roleOf(p) === 'admin'; }

  /** Loopback addresses are exempt from per-IP accounting (see config.exemptLoopback). */
  ipExempt(ip) { return !ip || ip === '?' || (this.cfg.exemptLoopback && isLoopback(ip)); }

  // ------------------------------------------------------------------ suspicion
  /** Normalise a flag target: Player, net Session (pre-auth) or IP string. */
  subject(x) {
    if (!x) return null;
    if (typeof x === 'string') return { ip: x, key: null, name: null, session: null, player: null };
    if (typeof x.name === 'string' && x.session) {
      return { player: x, session: x.session, name: x.name, key: nameKey(x.name), ip: x.session.ip || x.account?.lastIp || null };
    }
    const p = x.player || null;
    return { player: p, session: x, name: p?.name || null, key: p ? nameKey(p.name) : null, ip: x.ip || null };
  }

  decayed(entry, now) {
    if (!entry) return 0;
    const dt = Math.max(0, now - entry.t);
    return entry.v * 0.5 ** (dt / this.cfg.scoreHalfLifeMs);
  }

  addScore(key, w, now) {
    const v = this.decayed(this.scores.get(key), now) + w;
    this.scores.set(key, { v, t: now });
    return v;
  }

  setScore(key, v, now) {
    if (this.scores.has(key)) this.scores.set(key, { v, t: now });
  }

  /** Current (decayed) suspicion of an account name or an IP. */
  scoreOf({ name, ip } = {}) {
    const now = this.clock();
    if (name) return this.decayed(this.scores.get(`a:${nameKey(name)}`), now);
    if (ip) return this.decayed(this.scores.get(`ip:${ip}`), now);
    return 0;
  }

  /** Recent flags of an account, newest first. */
  flagsOf(name) {
    return [...(this.recentFlags.get(nameKey(name)) || [])].reverse();
  }

  /**
   * Record a suspicion. Returns the resulting score of the subject.
   * @param {object|string} target  Player, pre-auth net Session, or IP
   * @param {string} code  short code: 'speed', 'teleport', 'wall', 'bad_packet', 'brute_force', 'chat_spam'…
   * @param {number} [weight=1]
   * @param {*} [detail] small JSON-able detail for the journal
   */
  flag(target, code, weight = 1, detail = undefined) {
    const s = this.subject(target);
    if (!s) return 0;
    const w = Math.max(0, Math.min(100, Number(weight) || 0));
    const now = this.clock();
    code = String(code).slice(0, 40);
    this.stats.flags++;
    let score = 0;
    if (s.key) score = this.addScore(`a:${s.key}`, w, now);
    if (s.ip && !this.ipExempt(s.ip)) {
      const ipScore = this.addScore(`ip:${s.ip}`, w, now);
      if (!s.key) score = ipScore;
    } else if (!s.key && s.session) {
      const e = this.sessionScores.get(s.session);
      const v = this.decayed(e, now) + w;
      this.sessionScores.set(s.session, { v, t: now });
      score = v;
    }
    if (s.key) {
      let list = this.recentFlags.get(s.key);
      if (!list) this.recentFlags.set(s.key, (list = []));
      const last = list[list.length - 1];
      if (last && last.code === code && now - last.t < 2000) {
        last.n = (last.n || 1) + 1;
        last.w += w;
        last.t = now;
      } else {
        list.push({ t: now, code, w, detail: shortDetail(detail) });
        if (list.length > RECENT_FLAGS) list.shift();
      }
    }
    this.seclog.write(
      { type: 'flag', code, w: round1(w), score: round1(score), name: s.name || undefined, ip: s.ip || undefined, detail: shortDetail(detail) },
      `flag:${s.key || s.ip}:${code}`,
    );
    this.escalate(s, score, code, now);
    return score;
  }

  escalate(s, score, code, now) {
    if (s.player && this.isStaff(s.player)) return; // staff (teleports, tests…) are never auto-sanctioned
    const who = s.key || s.ip || 'session';
    if (score >= this.cfg.kickAt) {
      if (s.session?.closed) return;
      // the score is halved so that the next offence (after reconnecting) escalates faster than a fresh one
      if (s.key) this.setScore(`a:${s.key}`, score / 2, now);
      if (s.ip && !this.ipExempt(s.ip)) this.setScore(`ip:${s.ip}`, score / 2, now);
      if (!s.key && s.session) this.sessionScores.set(s.session, { v: score / 2, t: now });
      const strikeKey = s.key || (s.ip && !this.ipExempt(s.ip) ? s.ip : null);
      let strikes = 0;
      if (strikeKey) {
        const list = (this.strikes.get(strikeKey) || []).filter((t) => now - t < this.cfg.strikeWindowMs);
        list.push(now);
        this.strikes.set(strikeKey, list);
        strikes = list.length;
      }
      if (strikeKey && strikes >= this.cfg.banAfterKicks) {
        this.strikes.delete(strikeKey);
        const type = s.key ? 'account' : 'ip';
        const offenses = this.bans.offenseCount(strikeKey);
        const durationMs = Math.min(this.cfg.autoBanMaxMs, this.cfg.autoBanMs * 2 ** offenses);
        const ban = this.bans.add(type, strikeKey, { durationMs, reason: `triche détectée (${code})`, author: 'anti-triche', name: s.name || undefined, auto: true });
        this.stats.bans++;
        this.seclog.write({ type: 'ban', auto: true, target: s.name || s.ip, ban: type, ip: s.ip || undefined, until: new Date(ban.until).toISOString(), reason: ban.reason });
        this.log?.warn(`anti-triche : ${s.name || s.ip} banni automatiquement pour ${formatDuration(durationMs)} (${code})`);
        this.kickSubject(s, `Vous avez été banni temporairement (${formatDuration(durationMs)}) : triche détectée.`);
        if (type === 'account') this.kickAccountSessions(s.key, ban);
      } else {
        this.stats.kicks++;
        this.seclog.write({ type: 'kick', auto: true, target: s.name || s.ip, ip: s.ip || undefined, code, score: round1(score), strikes });
        this.log?.warn(`anti-triche : ${s.name || s.ip} expulsé (score ${round1(score)}, ${code})`);
        this.kickSubject(s, KICK_MESSAGES.suspicious);
      }
      return;
    }
    if (score >= this.cfg.warnAt) {
      const last = this.lastWarn.get(who) || 0;
      if (now - last >= WARN_EVERY_MS) {
        this.lastWarn.set(who, now);
        this.seclog.write({ type: 'warn', target: s.name || s.ip, ip: s.ip || undefined, code, score: round1(score) });
        this.log?.warn(`anti-triche : comportement suspect de ${s.name || s.ip} (score ${round1(score)}, dernier signalement : ${code})`);
      }
    }
  }

  kickSubject(s, msg) {
    const session = s.session || s.player?.session;
    if (!session) return;
    kickSession(session, msg);
  }

  /** Kick every online player of this account key (ban on an online account). */
  kickAccountSessions(key, ban) {
    const p = this.game?.byName?.get(key);
    if (p) kickSession(p.session, this.banMessage(ban));
  }

  /** Kick a player now (GM / anti-cheat). */
  kick(p, msg) {
    kickSession(p.session, msg);
  }

  // ------------------------------------------------------------------ bans
  banMessage(ban, now = this.clock()) {
    const reason = ban.reason ? ` Raison : ${ban.reason}.` : '';
    const what = ban.type === 'ip' ? 'Votre adresse est bannie' : 'Ce compte est banni';
    return `${what} ${banSpan(ban.until, now)}.${reason}`;
  }

  accountBan(name) { return this.bans.accountBan(name, this.clock()); }
  ipBan(ip) { return ip && ip !== '?' ? this.bans.ipBan(ip, this.clock()) : null; }

  // ------------------------------------------------------------------ connections
  /** Reason (French) to refuse a new connection from `ip`, or null. */
  connectionRefusal(ip) {
    const ban = this.ipBan(ip);
    if (ban) return this.banMessage(ban);
    if (!this.ipExempt(ip) && (this.connsByIp.get(ip) || 0) >= this.cfg.maxConnPerIp) {
      this.seclog.write({ type: 'conn', refused: 'too_many', ip }, `conn:${ip}`);
      return 'Trop de connexions depuis votre adresse. Fermez les autres onglets du jeu.';
    }
    return null;
  }

  connOpened(ip) { this.connsByIp.set(ip, (this.connsByIp.get(ip) || 0) + 1); }

  connClosed(ip) {
    const n = (this.connsByIp.get(ip) || 0) - 1;
    if (n > 0) this.connsByIp.set(ip, n);
    else this.connsByIp.delete(ip);
  }

  // ------------------------------------------------------------------ authentication
  /** Remaining lockout (ms) before `ip` may try to log into `name` (0 = allowed). */
  /**
   * Remaining login lock for this address and account name (0 = allowed). The per-name lock slows a brute force
   * spread over many addresses; `trusted` (an address this account recently logged in from with its password or a
   * passkey) skips it, so failures sent from elsewhere cannot lock the owner out of her usual device. The per-IP
   * lock still applies to everyone. A locked account can always use a remembered session or a passkey.
   */
  loginBlockedFor(ip, name, { trusted = false } = {}) {
    const now = this.clock();
    const k = typeof name === 'string' ? nameKey(name) : '';
    const byIp = this.ipExempt(ip) ? 0 : this.loginIp.blockedFor(ip, now);
    const byAcc = k && !trusted ? this.loginAccount.blockedFor(k, now) : 0;
    return Math.max(byIp, byAcc);
  }

  loginFailed(session, name) {
    const now = this.clock();
    const ip = session?.ip;
    const k = typeof name === 'string' ? nameKey(name) : '';
    const e1 = k ? this.loginAccount.fail(k, now) : null;
    const e2 = !this.ipExempt(ip) ? this.loginIp.fail(ip, now) : null;
    this.seclog.write({ type: 'auth', result: 'fail', name: k || undefined, ip, fails: e1?.fails }, `authfail:${ip}:${k}`);
    const over = (e1 && e1.fails > this.cfg.loginFreeFailsAccount) || (e2 && e2.fails > this.cfg.loginFreeFailsIp);
    if (over) this.flag(session, 'brute_force', 3, { name: k });
  }

  loginSucceeded(session, name) {
    const k = nameKey(name);
    this.loginAccount.reset(k);
    if (!this.ipExempt(session?.ip)) this.loginIp.reset(session.ip);
  }

  /** A locked-out client keeps trying: suspicious on its own. */
  loginRefusedWhileBlocked(session, name) {
    this.flag(session, 'brute_force', 4, { name: typeof name === 'string' ? nameKey(name) : undefined, blocked: true });
  }

  canRegister(ip) {
    return this.ipExempt(ip) || this.registrations.allowed(ip, this.clock());
  }

  registered(session, name) {
    const ip = session?.ip;
    if (!this.ipExempt(ip)) this.registrations.add(ip, this.clock());
    this.seclog.write({ type: 'auth', result: 'register', name, ip });
  }

  /** Called when a player enters the world. */
  onEnter(p) {
    const ip = p.session?.ip;
    if (ip && ip !== '?' && p.account) p.account.lastIp = ip;
    this.seclog.write({ type: 'auth', result: 'login', name: p.name, ip, role: this.roleOf(p) });
  }

  // ------------------------------------------------------------------ gameplay hooks
  /** game.error() hook: detects spam of refused actions (out of range, cooldown, invalid targets…). */
  onRefusal(p, code) {
    if (!p || !this.game?.players?.has?.(p.id)) return;
    const now = this.game.now();
    let m = this.refusals.get(p);
    if (!m) this.refusals.set(p, (m = new Map()));
    for (const key of [code, '*']) {
      const rule = REFUSAL_RULES[key];
      if (!rule) continue;
      let times = m.get(key);
      if (!times) m.set(key, (times = []));
      while (times.length && now - times[0] >= REFUSAL_WINDOW_MS) times.shift();
      times.push(now);
      if (times.length > rule.max) {
        times.length = 0;
        this.flag(p, rule.code, rule.w, { err: code });
      }
    }
  }

  /** After every handled client message: economy invariants. */
  afterAction(p) {
    this.checkInvariants(p, 'action');
  }

  checkInvariants(p, when) {
    const strict = this.cfg.strictInvariants;
    const problems = checkPlayerInvariants(p, { maxGold: this.cfg.maxGold, repair: !strict });
    if (!problems.length) return problems;
    this.seclog.write({ type: 'invariant', name: p.name, when, problems: problems.slice(0, 10) }, `inv:${p.name}`);
    if (strict) throw new Error(`invariant violé pour ${p.name} (${when}) : ${problems.join(', ')}`);
    this.log?.error(`invariant violé pour ${p.name} (${when}) : ${problems.join(', ')} — corrigé`);
    return problems;
  }

  /** Called every game tick. */
  tick(now) {
    if (now >= this.nextInvariantAt) {
      this.nextInvariantAt = now + INVARIANT_EVERY_MS;
      for (const p of this.game?.players?.values?.() || []) {
        try { this.checkInvariants(p, 'tick'); } catch (err) { this.game.reportError('invariants', err); }
      }
    }
    if (now >= this.nextPruneAt) {
      this.nextPruneAt = now + PRUNE_EVERY_MS;
      this.prune();
    }
  }

  prune() {
    const now = this.clock();
    this.loginIp.prune(now);
    this.loginAccount.prune(now);
    this.registrations.prune(now);
    for (const [k, e] of this.scores) if (this.decayed(e, now) < 0.05) this.scores.delete(k);
    for (const [k, list] of this.strikes) {
      const kept = list.filter((t) => now - t < this.cfg.strikeWindowMs);
      if (kept.length) this.strikes.set(k, kept);
      else this.strikes.delete(k);
    }
    for (const [k, t] of this.lastWarn) if (now - t > WARN_EVERY_MS * 10) this.lastWarn.delete(k);
    for (const [k, list] of this.recentFlags) {
      if (!list.length || now - list[list.length - 1].t > 24 * 3_600_000) this.recentFlags.delete(k);
    }
    this.seclog.pruneThrottle(now);
  }

  /** GM action journal. */
  gmLog(actor, cmd, detail = {}) {
    this.seclog.write({ type: 'gm', by: actor.name, role: this.roleOf(actor), cmd, ...detail });
    this.log?.info(`[MJ] ${actor.name} : ${cmd}${detail.target ? ` → ${detail.target}` : ''}${detail.reason ? ` (${detail.reason})` : ''}`);
  }
}

/** Send `kick` and close, for real net sessions and test doubles alike. */
export function kickSession(session, msg) {
  if (!session || session.closed) return;
  if (typeof session.kick === 'function') session.kick(msg);
  else session.send?.({ t: 'kick', msg });
}

const round1 = (v) => Math.round(v * 10) / 10;

function shortDetail(d) {
  if (d === undefined || d === null) return undefined;
  if (typeof d === 'string') return d.slice(0, 120);
  if (typeof d === 'number' || typeof d === 'boolean') return d;
  try {
    const s = JSON.stringify(d);
    return s.length <= 300 ? d : s.slice(0, 300);
  } catch {
    return undefined;
  }
}
