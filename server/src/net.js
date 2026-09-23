// WebSocket sessions: parsing, rate limiting, authentication, routing to the game.
// [anticheat] v0.2 hardening: real client IP, Origin allow-list, connections per IP, bans, auth timeout, idle
// kick, token-bucket rate limits (global + per message type), strict message validation, login throttling,
// account creation limit, name filter. See docs/SECURITE.md.
// [accounts] A connection goes through three states: anonymous -> account (character selection) -> in world.
// Accounts own up to MAX_CHARS characters, remembered sessions and passkeys. See docs/COMPTES.md.
import { WebSocketServer, WebSocket } from 'ws';
import { WS_PATH, C2S, S2C, decode, MAX_CHARS } from '../../shared/protocol.js';
import { CLASSES } from '../../shared/data.js';
import {
  MAX_PAYLOAD, MAX_AUTH_ATTEMPTS, HEARTBEAT_MS, MAX_BUFFERED_BYTES, MAX_PLAYERS, MOTD,
} from './config.js';
import { validName, validPassword, validClass, nameKey, hashPassword, verifyPassword, dummyVerify, PASSWORD_MIN, PASSWORD_MAX } from './auth.js';
import { newAccount, newCharacter, MAX_PASSKEYS } from './persistence.js';
import {
  issueToken, findToken, revokeSession, revokeAllSessions, accountSummary, charList, validTokenFormat,
} from './accounts.js';
import {
  relyingParty, registrationOptions, authenticationOptions, verifyRegistration, verifyLogin, responseShapeOk,
  cleanLabel, CHALLENGE_TTL_MS,
} from './passkeys.js';
import { isNum } from './util.js';
import { PERMESSAGE_DEFLATE, Outbox, wantsBatch, flushAll } from './wsout.js'; // [netcode-perf]
import { VERSION, buildId } from './version.js'; // [netcode-perf]
import { Security, kickSession, KICK_MESSAGES } from './security/index.js';
import { TokenBucket, TypeLimiter } from './security/ratelimit.js';
import { validateC2S } from './security/validate.js';
import { clientIp, originAllowed } from './security/connection.js';
import { nameProblem, confusableKey, NAME_PROBLEM_MESSAGES } from './security/names.js';
import { formatDuration } from './security/format.js';

const AUTH_MESSAGES = {
  bad_name: 'Nom invalide : 3 à 16 caractères (lettres, chiffres ou _).',
  bad_password: `Mot de passe invalide : ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères.`,
  bad_class: 'Classe inconnue.',
  name_taken: 'Ce nom est déjà pris.',
  login_taken: 'Ce nom de compte est déjà pris.',
  wrong_credentials: 'Nom ou mot de passe incorrect.',
  already_online: 'Ce personnage est déjà connecté.',
  server_full: 'Le serveur est complet, réessayez plus tard.',
  bad_request: 'Requête invalide.',
  rate_limit: 'Trop de tentatives. Réessayez dans un instant.',
  banned: 'Ce compte est banni.',
  // [accounts]
  bad_token: 'Votre session a expiré. Reconnectez-vous.',
  passkey_failed: 'Clé d’accès refusée ou inconnue.',
  no_character: 'Ce compte n’a pas encore de personnage : rechargez la page pour en créer un.',
  unavailable: 'Les clés d’accès ne sont pas disponibles sur cette adresse.',
};

const ACCOUNT_MESSAGES = {
  ...AUTH_MESSAGES,
  too_many_chars: `Vous avez déjà ${MAX_CHARS} personnages : supprimez-en un pour en créer un autre.`,
  not_found: 'Personnage introuvable.',
  bad_confirm: 'Pour confirmer, tapez exactement le nom du personnage.',
  in_world: 'Quittez d’abord le monde (Changer de personnage).',
  wrong_credentials: 'Mot de passe actuel incorrect.',
  passkey_failed: 'La clé d’accès n’a pas pu être enregistrée.',
  too_many_passkeys: `Vous avez déjà ${MAX_PASSKEYS} clés d’accès : supprimez-en une d’abord.`,
  reauth_required: 'Confirmez votre mot de passe actuel pour ajouter une clé d’accès.',
};

/**
 * Adding a passkey mints a durable, high-assurance credential: it needs a FRESH proof of the password (or of an
 * existing passkey). A remembered-session token (login_token, stored in the browser) is low-assurance and is
 * never enough on its own: the password must be typed again. See docs/COMPTES.md.
 */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;

/** Message types that count as player activity for the idle kick. */
const PASSIVE_TYPES = new Set([C2S.PING]);
/** Anonymous connections: the only messages accepted. */
const AUTH_TYPES = new Set([C2S.REGISTER, C2S.LOGIN, C2S.LOGIN_TOKEN, C2S.PASSKEY_LOGIN_OPTIONS, C2S.PASSKEY_LOGIN_VERIFY]);
/** Account messages (character selection screen AND in world). */
const ACCOUNT_TYPES = new Set([
  C2S.CHAR_CREATE, C2S.CHAR_DELETE, C2S.CHAR_SELECT, C2S.CHAR_LOGOUT, C2S.LOGOUT, C2S.LOGOUT_ALL, C2S.ACCOUNT_GET,
  C2S.PASSWORD_CHANGE, C2S.PASSKEY_REG_OPTIONS, C2S.PASSKEY_REG_VERIFY, C2S.PASSKEY_RENAME, C2S.PASSKEY_DELETE,
]);

let sessionSeq = 0;

/** An address this account recently logged in from with its password or a passkey. */
function trustedIp(account, ip) {
  return !!(account && ip && ip !== '?' && account.authIps?.includes(ip));
}

class Session {
  constructor(ws, ip, ctx, req = null) {
    this.id = ++sessionSeq;
    this.ws = ws;
    this.ip = ip;
    this.ctx = ctx;
    this.account = null;   // [accounts] authenticated account (character selection or in world)
    this.tokenId = null;   // [accounts] remembered session used / issued by this connection (revoked by `logout`)
    this.webauthn = null;  // [accounts] pending passkey challenge { purpose, challenge, exp }
    this.strongAuthAt = 0; // [accounts] last proof of the password or of a passkey on this connection (not a token)
    this.player = null;
    this.authBusy = false;
    this.accBusy = false;
    this.authAttempts = 0;
    this.closed = false;
    this.alive = true;
    this.origin = typeof req?.headers?.origin === 'string' ? req.headers.origin : null;
    this.host = typeof req?.headers?.host === 'string' ? req.headers.host : null;
    this.ua = typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 120) : '';
    const now = Date.now();
    const cfg = ctx.security.cfg;
    this.bucket = new TokenBucket(cfg.globalRate, cfg.globalBurst, now);
    this.types = new TypeLimiter();
    this.lastActivity = now;
    this.connectedAt = now;
    this.lastRateFlag = 0;
    this.authTimer = null;
    this.armAuthTimer();

    ws.on('message', (data) => this.onMessage(data));
    ws.on('close', () => this.onClose());
    ws.on('error', () => { /* 'close' follows */ });
    ws.on('pong', () => { this.alive = true; });
  }

  armAuthTimer() {
    clearTimeout(this.authTimer);
    this.authTimer = setTimeout(() => {
      if (!this.account && !this.player && !this.closed) this.kick('Délai de connexion dépassé. Rechargez la page pour vous reconnecter.');
    }, this.ctx.security.cfg.authTimeoutMs);
    this.authTimer.unref?.();
  }

  send(msg) {
    this.sendRaw(JSON.stringify(msg));
  }

  sendRaw(str) {
    const ws = this.ws;
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      // client cannot keep up (or stopped reading): drop it rather than buffering forever
      this.ctx.log.warn(`${this.label()} trop lent, déconnexion`);
      ws.terminate();
      return;
    }
    if (this.outbox) return this.outbox.push(str); // [netcode-perf] per-tick `batch` coalescing (opt-in)
    ws.send(str);
  }

  kick(msg) {
    if (this.closed) return;
    this.send({ t: S2C.KICK, msg });
    this.outbox?.flush(); // deliver the kick message before the socket closes
    this.ctx.log.info(`${this.label()} expulsé : ${msg}`);
    setImmediate(() => { try { this.ws.close(4000, 'kick'); } catch { /* ignore */ } });
    this.closed = true;
  }

  label() {
    if (this.player) return this.player.name;
    if (this.account) return `compte ${this.account.login}`;
    return `connexion ${this.ip}`;
  }

  get security() { return this.ctx.security; }

  onMessage(data) {
    if (this.closed) return;
    const now = Date.now();
    if (!this.bucket.take(now)) {
      this.security.flag(this.player || this, 'flood', 10, { rate: 'global' });
      return this.kick('Trop de messages envoyés.');
    }
    const msg = decode(data);
    if (!msg) {
      this.security.flag(this.player || this, 'bad_packet', 1, 'json');
      return;
    }
    const bad = validateC2S(msg);
    if (bad) {
      this.security.flag(this.player || this, 'bad_packet', bad === 'forbidden_key' ? 5 : 2, { t: String(msg.t).slice(0, 20), why: bad });
      if (!this.account && AUTH_TYPES.has(msg.t)) this.authErr('bad_request');
      else if (ACCOUNT_TYPES.has(msg.t)) this.accErr(msg.t, 'bad_request');
      return;
    }
    if (!this.types.allow(msg.t, now)) {
      // dropped; flagged at most once per second (a long network stall can legitimately release a burst)
      if (now - this.lastRateFlag >= 1000) {
        this.lastRateFlag = now;
        this.security.flag(this.player || this, 'rate', 1, { t: msg.t });
      }
      if (!this.account && AUTH_TYPES.has(msg.t)) this.authErr('rate_limit');
      else if (ACCOUNT_TYPES.has(msg.t)) this.accErr(msg.t, 'rate_limit');
      return;
    }
    if (!PASSIVE_TYPES.has(msg.t)) this.lastActivity = now;
    try {
      this.route(msg);
    } catch (err) {
      this.ctx.game.reportError(`message ${String(msg.t).slice(0, 20)} de ${this.label()}`, err);
    }
  }

  route(msg) {
    const { game } = this.ctx;
    if (msg.t === C2S.PING) {
      if (isNum(msg.c)) this.send({ t: S2C.PONG, c: msg.c, s: Date.now() });
      return;
    }
    if (!this.account) {
      switch (msg.t) {
        case C2S.REGISTER: return this.guardAuth(() => this.register(msg));
        case C2S.LOGIN: return this.guardAuth(() => this.login(msg));
        case C2S.LOGIN_TOKEN: return this.guardAuth(() => this.loginToken(msg));
        case C2S.PASSKEY_LOGIN_OPTIONS: return this.guardAuth(() => this.passkeyLoginOptions(), false);
        case C2S.PASSKEY_LOGIN_VERIFY: return this.guardAuth(() => this.passkeyLoginVerify(msg));
        default: return; // everything else is ignored before auth
      }
    }
    if (ACCOUNT_TYPES.has(msg.t)) return this.accountMessage(msg);
    if (!this.player || AUTH_TYPES.has(msg.t)) return;
    game.handleMessage(this.player, msg);
  }

  guardAuth(fn, counts = true) {
    if (this.authBusy || this.account) return;
    if (counts && ++this.authAttempts > MAX_AUTH_ATTEMPTS) {
      this.security.flag(this, 'brute_force', 5, { attempts: this.authAttempts });
      return this.kick('Trop de tentatives de connexion.');
    }
    this.authBusy = true;
    fn()
      .catch((err) => {
        this.ctx.game.reportError('auth', err);
        this.authErr('bad_request');
      })
      .finally(() => { this.authBusy = false; });
  }

  authErr(code, msg) {
    this.send({ t: S2C.AUTH_ERR, code, msg: msg || AUTH_MESSAGES[code] });
  }

  accErr(op, code, msg) {
    this.send({ t: S2C.ACCOUNT_ERR, op, code, msg: msg || ACCOUNT_MESSAGES[code] || ACCOUNT_MESSAGES.bad_request });
  }

  /** Why a NEW name (login or character) is refused, or null. Sends nothing. */
  nameRefusal(name, { character }) {
    const { store, game } = this.ctx;
    const sec = this.security;
    if (!validName(name)) return ['bad_name'];
    // names listed in ADMIN_NAMES can only be created before being listed (nobody can grab a free admin name)
    const problem = sec.cfg.adminNames.includes(nameKey(name)) ? 'reserved' : nameProblem(name);
    if (problem) {
      sec.seclog.write({ type: 'auth', result: 'name_refused', name, why: problem, ip: this.ip });
      return ['bad_name', NAME_PROBLEM_MESSAGES[problem]];
    }
    if (character) {
      if (store.has(name) || game.byName.has(nameKey(name))) return ['name_taken'];
      if (lookalikeTaken(name, store, game)) return ['name_taken', NAME_PROBLEM_MESSAGES.lookalike];
    } else if (store.hasLogin(name)) return ['login_taken'];
    return null;
  }

  // ------------------------------------------------------------------ anonymous -> account
  async register(msg) {
    const { store, game } = this.ctx;
    const sec = this.security;
    const { name, password, cls } = msg;
    const legacy = cls !== undefined && cls !== null; // v0.1 / wave-1 client: account + first character + select
    const ipBan = sec.ipBan(this.ip); // banned while this connection was already open
    if (ipBan) return this.authErr('banned', sec.banMessage(ipBan));
    const refusal = this.nameRefusal(name, { character: false }) || (legacy ? this.nameRefusal(name, { character: true }) : null);
    if (refusal) return this.authErr(refusal[0] === 'login_taken' && legacy ? 'name_taken' : refusal[0], refusal[1]);
    if (!validPassword(password)) return this.authErr('bad_password');
    if (legacy && !validClass(cls)) return this.authErr('bad_class');
    if (!sec.canRegister(this.ip)) {
      sec.seclog.write({ type: 'auth', result: 'register_limit', name, ip: this.ip }, `reglimit:${this.ip}`);
      return this.authErr('rate_limit', 'Trop de personnages créés depuis votre adresse. Réessayez plus tard.');
    }
    if (legacy && game.players.size >= MAX_PLAYERS) return this.authErr('server_full');
    const { salt, hash } = await hashPassword(password);
    if (this.closed) return;
    // registered meanwhile?
    const again = this.nameRefusal(name, { character: false }) || (legacy ? this.nameRefusal(name, { character: true }) : null);
    if (again) return this.authErr(again[0] === 'login_taken' && legacy ? 'name_taken' : again[0], again[1]);
    if (legacy && game.players.size >= MAX_PLAYERS) return this.authErr('server_full');
    const account = store.create(newAccount(name, legacy ? cls : null, salt, hash));
    store.save();
    sec.registered(this, name);
    this.ctx.log.info(`nouveau compte : ${name}${legacy ? ` (${CLASSES[cls].name})` : ''}`);
    this.accountIn(account, { method: 'register', remember: msg.remember === true, legacy });
  }

  async login(msg) {
    const { store } = this.ctx;
    const sec = this.security;
    const { name, password } = msg;
    if (typeof name !== 'string' || typeof password !== 'string' || name.length > 64 || password.length > 256) {
      return this.authErr('bad_request');
    }
    const ipBan = sec.ipBan(this.ip); // banned while this connection was already open
    if (ipBan) return this.authErr('banned', sec.banMessage(ipBan));
    const account = store.getAccount(name);
    const wait = sec.loginBlockedFor(this.ip, name, { trusted: trustedIp(account, this.ip) });
    if (wait > 0) {
      sec.loginRefusedWhileBlocked(this, name);
      return this.authErr('rate_limit', `Trop de tentatives de connexion. Réessayez dans ${formatDuration(wait)}.`);
    }
    const ok = account ? await verifyPassword(password, account.salt, account.hash) : await dummyVerify(password);
    if (this.closed) return;
    if (!ok) {
      sec.loginFailed(this, name);
      return this.authErr('wrong_credentials');
    }
    // a login message without `remember` comes from a pre-accounts client: straight into the world as before
    const legacy = !Object.prototype.hasOwnProperty.call(msg, 'remember');
    this.accountIn(account, { method: 'password', remember: msg.remember === true, legacy });
  }

  async loginToken(msg) {
    const { store } = this.ctx;
    const sec = this.security;
    const ipBan = sec.ipBan(this.ip);
    if (ipBan) return this.authErr('banned', sec.banMessage(ipBan));
    const wait = sec.loginBlockedFor(this.ip, '#token');
    if (wait > 0) {
      sec.loginRefusedWhileBlocked(this, '#token');
      return this.authErr('rate_limit', `Trop de tentatives de connexion. Réessayez dans ${formatDuration(wait)}.`);
    }
    const found = validTokenFormat(msg.token) ? findToken(store, msg.token) : null;
    if (!found) {
      // expired / revoked tokens are normal; many unknown tokens from one address are token guessing
      sec.flag(this, 'token_guess', validTokenFormat(msg.token) ? 1 : 3);
      sec.loginFailed(this, '#token');
      return this.authErr('bad_token');
    }
    store.markDirty(found.acc);
    this.accountIn(found.acc, { method: 'token', rotate: found.session.id });
  }

  rp() {
    const cfg = this.security.cfg;
    return relyingParty({ origin: this.origin, host: this.host, allowedOrigins: cfg.allowedOrigins, env: this.ctx.env || process.env });
  }

  async passkeyLoginOptions() {
    const rp = this.rp();
    if (!rp) return this.authErr('unavailable');
    const options = await authenticationOptions(rp);
    this.webauthn = { purpose: 'login', challenge: options.challenge, exp: Date.now() + CHALLENGE_TTL_MS, rp };
    this.send({ t: S2C.PASSKEY_OPTIONS, purpose: 'login', options });
  }

  async passkeyLoginVerify(msg) {
    const { store } = this.ctx;
    const sec = this.security;
    const ch = this.webauthn;
    this.webauthn = null; // single use
    const ipBan = sec.ipBan(this.ip);
    if (ipBan) return this.authErr('banned', sec.banMessage(ipBan));
    const wait = sec.loginBlockedFor(this.ip, '#passkey');
    if (wait > 0) {
      sec.loginRefusedWhileBlocked(this, '#passkey');
      return this.authErr('rate_limit', `Trop de tentatives de connexion. Réessayez dans ${formatDuration(wait)}.`);
    }
    const fail = (why, w = 1) => {
      sec.flag(this, 'passkey_fail', w, { why });
      sec.loginFailed(this, '#passkey');
      this.ctx.log.info(`passkey refusée (${why}) depuis ${this.ip}`);
      return this.authErr('passkey_failed');
    };
    if (!ch || ch.purpose !== 'login' || ch.exp < Date.now()) return fail('no_challenge');
    if (!responseShapeOk(msg.resp, 'login')) return fail('shape', 2);
    const acc = store.accountByCredential(msg.resp.id);
    const key = acc?.passkeys.find((k) => k.id === msg.resp.id);
    if (!acc || !key) return fail('unknown_credential');
    try {
      await verifyLogin(msg.resp, ch, ch.rp, acc, key);
    } catch (err) {
      return fail(String(err?.message || err).slice(0, 60), 2);
    }
    if (this.closed) return;
    store.markDirty(acc);
    this.accountIn(acc, { method: 'passkey', remember: msg.remember === true });
  }

  /** Common end of every successful authentication. */
  accountIn(account, { method, remember = false, rotate = null, legacy = false }) {
    const { store, game } = this.ctx;
    const sec = this.security;
    // a ban on the login or on ANY character of the account blocks the whole account
    for (const n of [account.login, ...account.chars.map((c) => c.name)]) {
      const ban = sec.accountBan(n);
      if (ban) {
        sec.seclog.write({ type: 'auth', result: 'banned', name: account.login, ip: this.ip }, `banned:${this.ip}`);
        return this.authErr('banned', sec.banMessage(ban));
      }
    }
    if (method !== 'token' && method !== 'register') sec.loginSucceeded(this, account.login);
    if (method === 'token') sec.loginSucceeded(this, '#token');
    if (method === 'passkey') sec.loginSucceeded(this, '#passkey');
    clearTimeout(this.authTimer);
    this.account = account;
    this.strongAuthAt = method === 'token' ? 0 : Date.now();
    this.lastActivity = Date.now();
    account.lastSeen = Date.now();
    if (this.ip && this.ip !== '?') {
      account.lastIp = this.ip;
      // a proof of the password / a passkey makes this address "usual" for the account (not a token login)
      if (method !== 'token') account.authIps = [this.ip, ...(account.authIps || []).filter((x) => x !== this.ip)].slice(0, 3);
    }
    store.markDirty(account);
    let set = this.ctx.accountSessions.get(nameKey(account.login));
    if (!set) this.ctx.accountSessions.set(nameKey(account.login), (set = new Set()));
    set.add(this);
    let token;
    if (rotate || remember) {
      const t = issueToken(store, account, { id: rotate, ua: this.ua });
      token = t.token;
      this.tokenId = t.id;
    }
    store.save();
    if (legacy) {
      const k = nameKey(account.login);
      const ch = account.chars.find((c) => nameKey(c.name) === k) || account.chars.find((c) => c.id === account.lastChar) || account.chars[0];
      if (!ch) {
        this.leaveAccount();
        return this.authErr('no_character');
      }
      if (game.byName.has(nameKey(ch.name))) {
        this.leaveAccount();
        return this.authErr('already_online');
      }
      if (game.players.size >= MAX_PLAYERS) {
        this.leaveAccount();
        return this.authErr('server_full');
      }
      return this.enter(ch);
    }
    this.sendAccount({ token, method });
  }

  sendAccount(extra = {}) {
    const a = this.account;
    if (!a) return;
    const msg = { t: S2C.ACCOUNT_OK, account: accountSummary(a), chars: charList(a) };
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) msg[k] = v;
    this.send(msg);
  }

  /** Back to anonymous (logout): the connection stays open on the login screen. */
  leaveAccount() {
    this.leaveWorld();
    const a = this.account;
    if (a) this.ctx.accountSessions.get(nameKey(a.login))?.delete(this);
    this.account = null;
    this.tokenId = null;
    this.webauthn = null;
    this.strongAuthAt = 0;
    this.armAuthTimer();
  }

  // ------------------------------------------------------------------ account messages
  accountMessage(msg) {
    if (this.accBusy) return this.accErr(msg.t, 'rate_limit', 'Opération déjà en cours.');
    const run = async () => {
      switch (msg.t) {
        case C2S.ACCOUNT_GET: return this.sendAccount();
        case C2S.CHAR_CREATE: return this.charCreate(msg);
        case C2S.CHAR_DELETE: return this.charDelete(msg);
        case C2S.CHAR_SELECT: return this.charSelect(msg);
        case C2S.CHAR_LOGOUT: this.leaveWorld(); return this.sendAccount();
        case C2S.LOGOUT: return this.logout(false);
        case C2S.LOGOUT_ALL: return this.logout(true);
        case C2S.PASSWORD_CHANGE: return this.passwordChange(msg);
        case C2S.PASSKEY_REG_OPTIONS: return this.passkeyRegOptions(msg);
        case C2S.PASSKEY_REG_VERIFY: return this.passkeyRegVerify(msg);
        case C2S.PASSKEY_RENAME: return this.passkeyRename(msg);
        case C2S.PASSKEY_DELETE: return this.passkeyDelete(msg);
        default: return undefined;
      }
    };
    this.accBusy = true;
    Promise.resolve()
      .then(run)
      .catch((err) => {
        this.ctx.game.reportError(`compte (${msg.t})`, err);
        this.accErr(msg.t, 'bad_request');
      })
      .finally(() => { this.accBusy = false; });
  }

  ownChar(id) {
    return typeof id === 'string' ? this.account.chars.find((c) => c.id === id) || null : null;
  }

  async charCreate(msg) {
    const { store } = this.ctx;
    const acc = this.account;
    const op = C2S.CHAR_CREATE;
    if (this.player) return this.accErr(op, 'in_world');
    if (acc.chars.length >= MAX_CHARS) return this.accErr(op, 'too_many_chars');
    const refusal = this.nameRefusal(msg.name, { character: true });
    if (refusal) return this.accErr(op, refusal[0], refusal[1]);
    if (!validClass(msg.cls)) return this.accErr(op, 'bad_class');
    const ch = store.addChar(acc, newCharacter(msg.name, msg.cls));
    acc.lastChar = ch.id;
    store.save();
    this.security.seclog.write({ type: 'auth', result: 'char_create', name: ch.name, account: acc.login, ip: this.ip });
    this.ctx.log.info(`nouveau personnage : ${ch.name} (${CLASSES[ch.cls].name}) — compte ${acc.login}`);
    this.sendAccount({ created: ch.id });
  }

  async charDelete(msg) {
    const { store, game } = this.ctx;
    const acc = this.account;
    const op = C2S.CHAR_DELETE;
    const ch = this.ownChar(msg.id);
    if (!ch) {
      if (typeof msg.id === 'string' && msg.id) this.security.flag(this, 'foreign_char', 2, { op: 'delete' });
      return this.accErr(op, 'not_found');
    }
    if (typeof msg.confirm !== 'string' || nameKey(msg.confirm.trim()) !== nameKey(ch.name)) return this.accErr(op, 'bad_confirm');
    if (this.player?.account === ch || game.byName.has(nameKey(ch.name))) return this.accErr(op, 'already_online');
    store.removeChar(acc, ch.id);
    store.save();
    this.security.seclog.write({ type: 'auth', result: 'char_delete', name: ch.name, account: acc.login, ip: this.ip });
    this.ctx.log.info(`personnage supprimé : ${ch.name} — compte ${acc.login}`);
    this.sendAccount({ info: `${ch.name} a été supprimé.` });
  }

  async charSelect(msg) {
    const { game } = this.ctx;
    const op = C2S.CHAR_SELECT;
    const ch = this.ownChar(msg.id);
    if (!ch) {
      if (typeof msg.id === 'string' && msg.id) this.security.flag(this, 'foreign_char', 2, { op: 'select' });
      return this.accErr(op, 'not_found');
    }
    if (this.player?.account === ch) return undefined; // already playing it
    const ban = this.security.accountBan(ch.name) || this.security.accountBan(this.account.login);
    if (ban) return this.accErr(op, 'banned', this.security.banMessage(ban));
    this.leaveWorld(); // switching characters directly from the world
    if (game.byName.has(nameKey(ch.name))) return this.accErr(op, 'already_online');
    if (game.players.size >= MAX_PLAYERS) return this.accErr(op, 'server_full');
    return this.enter(ch);
  }

  async logout(all) {
    const { store, log } = this.ctx;
    const acc = this.account;
    if (all) {
      const n = revokeAllSessions(store, acc);
      for (const s of [...(this.ctx.accountSessions.get(nameKey(acc.login)) || [])]) {
        if (s !== this) s.kick('Vous avez été déconnecté : déconnexion de tous les appareils.');
      }
      log.info(`compte ${acc.login} : déconnexion partout (${n} session(s) mémorisée(s) révoquée(s))`);
    } else if (this.tokenId) revokeSession(store, acc, this.tokenId);
    store.save();
    this.leaveAccount();
    this.send({ t: S2C.LOGGED_OUT, ...(all ? { all: true } : {}) });
  }

  async passwordChange(msg) {
    const { store } = this.ctx;
    const sec = this.security;
    const acc = this.account;
    const op = C2S.PASSWORD_CHANGE;
    const wait = sec.loginBlockedFor(this.ip, acc.login, { trusted: trustedIp(acc, this.ip) });
    if (wait > 0) return this.accErr(op, 'rate_limit', `Trop de tentatives. Réessayez dans ${formatDuration(wait)}.`);
    const ok = await verifyPassword(msg.old, acc.salt, acc.hash);
    if (this.closed || this.account !== acc) return undefined;
    if (!ok) {
      sec.loginFailed(this, acc.login);
      return this.accErr(op, 'wrong_credentials');
    }
    if (!validPassword(msg.password)) return this.accErr(op, 'bad_password');
    const { salt, hash } = await hashPassword(msg.password);
    if (this.closed || this.account !== acc) return undefined;
    acc.salt = salt;
    acc.hash = hash;
    this.strongAuthAt = Date.now();
    // every other remembered session stops working (a stolen token dies with the old password)
    revokeAllSessions(store, acc, this.tokenId);
    // ... and, on request (the client's default), every passkey: a passkey enrolled by an intruder would survive
    const nKeys = msg.revokePasskeys === true ? acc.passkeys.length : 0;
    if (nKeys) {
      acc.passkeys = [];
      store.index(acc);
    }
    // the account's other open connections are closed too (like logout_all)
    for (const s of [...(this.ctx.accountSessions.get(nameKey(acc.login)) || [])]) {
      if (s !== this) s.kick('Vous avez été déconnecté : le mot de passe du compte a été modifié.');
    }
    store.markDirty(acc);
    store.save();
    sec.seclog.write({ type: 'auth', result: 'password_change', name: acc.login, ip: this.ip, passkeysRevoked: nKeys });
    const keys = nKeys ? ` ${nKeys} clé${nKeys > 1 ? 's' : ''} d’accès supprimée${nKeys > 1 ? 's' : ''}.` : '';
    return this.sendAccount({ info: `Mot de passe modifié. Les autres appareils devront se reconnecter.${keys}` });
  }

  /** True when this connection proved the password or a passkey recently (a token login never counts). */
  freshAuth() {
    return this.strongAuthAt > 0 && Date.now() - this.strongAuthAt < REAUTH_WINDOW_MS;
  }

  async passkeyRegOptions(msg = {}) {
    const op = C2S.PASSKEY_REG_OPTIONS;
    const sec = this.security;
    const acc = this.account;
    if (acc.passkeys.length >= MAX_PASSKEYS) return this.accErr(op, 'too_many_passkeys');
    if (!this.freshAuth()) {
      if (typeof msg.password !== 'string' || !msg.password) return this.accErr(op, 'reauth_required');
      const wait = sec.loginBlockedFor(this.ip, acc.login, { trusted: trustedIp(acc, this.ip) });
      if (wait > 0) return this.accErr(op, 'rate_limit', `Trop de tentatives. Réessayez dans ${formatDuration(wait)}.`);
      const ok = await verifyPassword(msg.password, acc.salt, acc.hash);
      if (this.closed || this.account !== acc) return undefined;
      if (!ok) {
        sec.loginFailed(this, acc.login);
        return this.accErr(op, 'wrong_credentials');
      }
      this.strongAuthAt = Date.now();
    }
    const rp = this.rp();
    if (!rp) return this.accErr(op, 'unavailable');
    const options = await registrationOptions(this.account, rp);
    this.webauthn = { purpose: 'register', challenge: options.challenge, exp: Date.now() + CHALLENGE_TTL_MS, rp };
    this.send({ t: S2C.PASSKEY_OPTIONS, purpose: 'register', options });
    return undefined;
  }

  async passkeyRegVerify(msg) {
    const { store } = this.ctx;
    const acc = this.account;
    const op = C2S.PASSKEY_REG_VERIFY;
    const ch = this.webauthn;
    this.webauthn = null;
    if (!ch || ch.purpose !== 'register' || ch.exp < Date.now()) return this.accErr(op, 'passkey_failed', 'Délai dépassé : recommencez l’ajout de la clé.');
    if (!this.freshAuth()) return this.accErr(op, 'reauth_required');
    if (!responseShapeOk(msg.resp, 'register')) return this.accErr(op, 'passkey_failed');
    if (acc.passkeys.length >= MAX_PASSKEYS) return this.accErr(op, 'too_many_passkeys');
    let cred;
    try {
      cred = await verifyRegistration(msg.resp, ch, ch.rp, msg.label);
    } catch (err) {
      this.security.flag(this, 'passkey_fail', 1, { why: String(err?.message || err).slice(0, 60) });
      return this.accErr(op, 'passkey_failed');
    }
    if (this.account !== acc) return undefined;
    if (store.accountByCredential(cred.id)) return this.accErr(op, 'passkey_failed', 'Cette clé d’accès est déjà enregistrée.');
    acc.passkeys.push(cred);
    store.index(acc);
    store.markDirty(acc);
    store.save();
    this.security.seclog.write({ type: 'auth', result: 'passkey_add', name: acc.login, ip: this.ip });
    return this.sendAccount({ info: `Clé d’accès « ${cred.label} » ajoutée.`, passkeyAdded: cred.id });
  }

  async passkeyRename(msg) {
    const key = this.account.passkeys.find((k) => k.id === msg.id);
    if (!key) return this.accErr(C2S.PASSKEY_RENAME, 'not_found', 'Clé d’accès introuvable.');
    const label = cleanLabel(msg.label);
    if (!label) return this.accErr(C2S.PASSKEY_RENAME, 'bad_request', 'Nom de clé invalide.');
    key.label = label;
    this.ctx.store.markDirty(this.account);
    this.ctx.store.save();
    return this.sendAccount();
  }

  async passkeyDelete(msg) {
    const { store } = this.ctx;
    const acc = this.account;
    const n = acc.passkeys.length;
    acc.passkeys = acc.passkeys.filter((k) => k.id !== msg.id);
    if (acc.passkeys.length === n) return this.accErr(C2S.PASSKEY_DELETE, 'not_found', 'Clé d’accès introuvable.');
    store.index(acc);
    store.markDirty(acc);
    store.save();
    this.security.seclog.write({ type: 'auth', result: 'passkey_delete', name: acc.login, ip: this.ip });
    return this.sendAccount({ info: 'Clé d’accès supprimée.' });
  }

  // ------------------------------------------------------------------ world
  enter(ch) {
    const { game, log, store } = this.ctx;
    const acc = this.account;
    const p = game.addPlayer(ch, this);
    p.login = acc; // [accounts] account-level role (Security.roleOf)
    this.player = p;
    acc.lastChar = ch.id;
    store.markDirty(acc);
    this.lastActivity = Date.now();
    this.security.onEnter(p);
    this.send({ t: S2C.AUTH_OK, id: p.id, self: p.selfState(), tod: game.tod(), online: game.players.size, motd: MOTD, ver: VERSION, build: buildId() }); // [netcode-perf] ver/build
    log.info(`+ ${p.name} (${CLASSES[p.cls].name} niv. ${p.level}) connecté — ${game.players.size} en ligne`);
    const role = this.security.roleOf(p);
    if (role !== 'player') game.systemChat(`Vous êtes connecté en tant ${role === 'admin' ? 'qu\'administrateur' : 'que maître du jeu'}. Tapez /mj pour les commandes.`, { to: p });
  }

  /** Leave the world (character change / logout / disconnect): entity removed, character saved. */
  leaveWorld() {
    const p = this.player;
    if (!p) return;
    this.player = null;
    const { game, log } = this.ctx;
    try {
      game.removePlayer(p);
    } catch (err) {
      game.reportError('déconnexion', err);
    }
    log.info(`- ${p.name} déconnecté — ${game.players.size} en ligne`);
  }

  onClose() {
    this.closed = true;
    this.outbox?.discard(); // [netcode-perf]
    clearTimeout(this.authTimer);
    this.leaveWorld();
    const a = this.account;
    if (a) this.ctx.accountSessions?.get(nameKey(a.login))?.delete(this);
  }
}

/** A name that looks like an existing character ("Élodie" vs "Elodie", "Bob" vs "B0b"). */
function lookalikeTaken(name, store, game) {
  const key = confusableKey(name);
  for (const p of game.players.values()) if (confusableKey(p.name) === key) return true;
  if (store && typeof store.charNames === 'function') {
    for (const n of store.charNames()) if (confusableKey(n) === key) return true;
  }
  return false;
}

/** Attach the WebSocket endpoint to an http server. Returns { wss, close() }. */
export function attachNet(httpServer, ctx) {
  const security = ctx.security || ctx.game.security || new Security({ log: ctx.log });
  ctx.security = security;
  ctx.accountSessions ||= new Map(); // [accounts] login key -> open sessions of that account (logout_all)
  const cfg = security.cfg;
  const wss = new WebSocketServer({
    server: httpServer,
    path: WS_PATH,
    maxPayload: MAX_PAYLOAD,
    perMessageDeflate: PERMESSAGE_DEFLATE, // [netcode-perf] compression
    verifyClient: (info, cb) => {
      const origin = info.req.headers.origin;
      if (originAllowed(origin, info.req.headers.host, cfg)) return cb(true);
      const ip = clientIp(info.req, cfg.trustProxy);
      security.seclog.write({ type: 'conn', refused: 'origin', origin: String(origin ?? '(aucune)').slice(0, 100), ip }, `origin:${ip}`);
      cb(false, 403, 'Origine refusée');
    },
  });
  const sessions = new Set();
  let warnedProxy = false;

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req, cfg.trustProxy);
    if (!warnedProxy && !cfg.trustProxy && req.headers['x-forwarded-for']) {
      warnedProxy = true;
      ctx.log.warn('en-tête X-Forwarded-For reçu mais TRUST_PROXY n\'est pas activé : les limites par IP voient l\'adresse du proxy (voir docs/SECURITE.md)');
    }
    const s = new Session(ws, ip, ctx, req);
    const refusal = security.connectionRefusal(ip);
    if (refusal) {
      kickSession(s, refusal);
      clearTimeout(s.authTimer);
      return;
    }
    security.connOpened(ip);
    s.outbox = new Outbox(ws, wantsBatch(req)); // [netcode-perf]
    sessions.add(s);
    ws.on('close', () => {
      sessions.delete(s);
      security.connClosed(ip);
    });
  });
  wss.on('error', (err) => ctx.log.error('websocket :', err.message));

  const heartbeat = setInterval(() => {
    for (const s of sessions) {
      if (!s.alive) {
        s.ws.terminate();
        continue;
      }
      s.alive = false;
      try { s.ws.ping(); } catch { /* ignore */ }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  // idle (AFK) kick, checked often enough for short test delays
  const idleTimer = setInterval(() => {
    const now = Date.now();
    for (const s of sessions) if ((s.player || s.account) && !s.closed && now - s.lastActivity > cfg.idleKickMs) s.kick(KICK_MESSAGES.idle);
  }, Math.max(200, Math.min(HEARTBEAT_MS, cfg.idleKickMs / 4)));
  idleTimer.unref();

  return {
    wss,
    sessions,
    close() {
      clearInterval(heartbeat);
      flushAll(); // [netcode-perf] deliver queued batches before closing
      clearInterval(idleTimer);
      for (const s of sessions) {
        clearTimeout(s.authTimer);
        try { s.ws.close(1001, 'Serveur arrêté'); } catch { /* ignore */ }
      }
      return new Promise((resolve) => {
        // give sockets a moment to close gracefully, then force
        const t = setTimeout(() => {
          for (const s of sessions) s.ws.terminate();
          resolve();
        }, 300);
        wss.close(() => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}
