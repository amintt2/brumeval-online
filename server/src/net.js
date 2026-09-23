// WebSocket sessions: parsing, rate limiting, authentication, routing to the game.
// [anticheat] v0.2 hardening: real client IP, Origin allow-list, connections per IP, bans, auth timeout, idle
// kick, token-bucket rate limits (global + per message type), strict message validation, login throttling,
// account creation limit, name filter. See docs/SECURITE.md.
import { WebSocketServer, WebSocket } from 'ws';
import { WS_PATH, C2S, S2C, decode } from '../../shared/protocol.js';
import { CLASSES } from '../../shared/data.js';
import {
  MAX_PAYLOAD, MAX_AUTH_ATTEMPTS, HEARTBEAT_MS, MAX_BUFFERED_BYTES, MAX_PLAYERS, MOTD,
} from './config.js';
import { validName, validPassword, validClass, nameKey, hashPassword, verifyPassword, dummyVerify, PASSWORD_MIN, PASSWORD_MAX } from './auth.js';
import { newAccount } from './persistence.js';
import { isNum } from './util.js';
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
  wrong_credentials: 'Nom ou mot de passe incorrect.',
  already_online: 'Ce personnage est déjà connecté.',
  server_full: 'Le serveur est complet, réessayez plus tard.',
  bad_request: 'Requête invalide.',
  rate_limit: 'Trop de tentatives. Réessayez dans un instant.',
  banned: 'Ce compte est banni.',
};

/** Message types that count as player activity for the idle kick. */
const PASSIVE_TYPES = new Set([C2S.PING]);

let sessionSeq = 0;

class Session {
  constructor(ws, ip, ctx) {
    this.id = ++sessionSeq;
    this.ws = ws;
    this.ip = ip;
    this.ctx = ctx;
    this.player = null;
    this.authBusy = false;
    this.authAttempts = 0;
    this.closed = false;
    this.alive = true;
    const now = Date.now();
    const cfg = ctx.security.cfg;
    this.bucket = new TokenBucket(cfg.globalRate, cfg.globalBurst, now);
    this.types = new TypeLimiter();
    this.lastActivity = now;
    this.connectedAt = now;
    this.lastRateFlag = 0;
    this.authTimer = setTimeout(() => {
      if (!this.player && !this.closed) this.kick('Délai de connexion dépassé. Rechargez la page pour vous reconnecter.');
    }, cfg.authTimeoutMs);
    this.authTimer.unref?.();

    ws.on('message', (data) => this.onMessage(data));
    ws.on('close', () => this.onClose());
    ws.on('error', () => { /* 'close' follows */ });
    ws.on('pong', () => { this.alive = true; });
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
    ws.send(str);
  }

  kick(msg) {
    if (this.closed) return;
    this.send({ t: S2C.KICK, msg });
    this.ctx.log.info(`${this.label()} expulsé : ${msg}`);
    setImmediate(() => { try { this.ws.close(4000, 'kick'); } catch { /* ignore */ } });
    this.closed = true;
  }

  label() {
    return this.player ? this.player.name : `connexion ${this.ip}`;
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
      if (!this.player && (msg.t === C2S.LOGIN || msg.t === C2S.REGISTER)) this.authErr('bad_request');
      return;
    }
    if (!this.types.allow(msg.t, now)) {
      // dropped; flagged at most once per second (a long network stall can legitimately release a burst)
      if (now - this.lastRateFlag >= 1000) {
        this.lastRateFlag = now;
        this.security.flag(this.player || this, 'rate', 1, { t: msg.t });
      }
      if (msg.t === C2S.LOGIN || msg.t === C2S.REGISTER) this.authErr('rate_limit');
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
    if (!this.player) {
      if (msg.t === C2S.REGISTER) this.guardAuth(() => this.register(msg));
      else if (msg.t === C2S.LOGIN) this.guardAuth(() => this.login(msg));
      return; // everything else is ignored before auth
    }
    if (msg.t === C2S.REGISTER || msg.t === C2S.LOGIN) return;
    game.handleMessage(this.player, msg);
  }

  guardAuth(fn) {
    if (this.authBusy || this.player) return;
    if (++this.authAttempts > MAX_AUTH_ATTEMPTS) {
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

  async register(msg) {
    const { store, game } = this.ctx;
    const sec = this.security;
    const { name, password, cls } = msg;
    if (!validName(name)) return this.authErr('bad_name');
    const problem = nameProblem(name);
    if (problem) {
      sec.seclog.write({ type: 'auth', result: 'name_refused', name, why: problem, ip: this.ip });
      return this.authErr('bad_name', NAME_PROBLEM_MESSAGES[problem]);
    }
    if (!validPassword(password)) return this.authErr('bad_password');
    if (!validClass(cls)) return this.authErr('bad_class');
    if (store.has(name)) return this.authErr('name_taken');
    if (lookalikeTaken(name, store, game)) return this.authErr('name_taken', NAME_PROBLEM_MESSAGES.lookalike);
    if (!sec.canRegister(this.ip)) {
      sec.seclog.write({ type: 'auth', result: 'register_limit', name, ip: this.ip }, `reglimit:${this.ip}`);
      return this.authErr('rate_limit', 'Trop de personnages créés depuis votre adresse. Réessayez plus tard.');
    }
    if (game.players.size >= MAX_PLAYERS) return this.authErr('server_full');
    const { salt, hash } = await hashPassword(password);
    if (this.closed) return;
    if (store.has(name)) return this.authErr('name_taken'); // registered meanwhile
    if (game.players.size >= MAX_PLAYERS) return this.authErr('server_full');
    const account = store.create(newAccount(name, cls, salt, hash));
    store.save();
    sec.registered(this, name);
    this.ctx.log.info(`nouveau compte : ${name} (${CLASSES[cls].name})`);
    this.enter(account);
  }

  async login(msg) {
    const { store, game } = this.ctx;
    const sec = this.security;
    const { name, password } = msg;
    if (typeof name !== 'string' || typeof password !== 'string' || name.length > 64 || password.length > 256) {
      return this.authErr('bad_request');
    }
    const wait = sec.loginBlockedFor(this.ip, name);
    if (wait > 0) {
      sec.loginRefusedWhileBlocked(this, name);
      return this.authErr('rate_limit', `Trop de tentatives de connexion. Réessayez dans ${formatDuration(wait)}.`);
    }
    const account = store.get(name);
    const ok = account ? await verifyPassword(password, account.salt, account.hash) : await dummyVerify(password);
    if (this.closed) return;
    if (!ok) {
      sec.loginFailed(this, name);
      return this.authErr('wrong_credentials');
    }
    sec.loginSucceeded(this, account.name);
    const ban = sec.accountBan(account.name);
    if (ban) {
      sec.seclog.write({ type: 'auth', result: 'banned', name: account.name, ip: this.ip }, `banned:${this.ip}`);
      return this.authErr('banned', sec.banMessage(ban));
    }
    if (game.byName.has(nameKey(account.name))) return this.authErr('already_online');
    if (game.players.size >= MAX_PLAYERS) return this.authErr('server_full');
    this.enter(account);
  }

  enter(account) {
    const { game, log } = this.ctx;
    clearTimeout(this.authTimer);
    const p = game.addPlayer(account, this);
    this.player = p;
    this.lastActivity = Date.now();
    this.security.onEnter(p);
    this.send({ t: S2C.AUTH_OK, id: p.id, self: p.selfState(), tod: game.tod(), online: game.players.size, motd: MOTD });
    log.info(`+ ${p.name} (${CLASSES[p.cls].name} niv. ${p.level}) connecté — ${game.players.size} en ligne`);
    const role = this.security.roleOf(p);
    if (role !== 'player') game.systemChat(`Vous êtes connecté en tant que ${role === 'admin' ? 'administrateur' : 'maître du jeu'}. Tapez /mj pour les commandes.`, { to: p });
  }

  onClose() {
    this.closed = true;
    clearTimeout(this.authTimer);
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
}

/** A name that looks like an existing character ("Élodie" vs "Elodie", "Bob" vs "B0b"). */
function lookalikeTaken(name, store, game) {
  const key = confusableKey(name);
  for (const p of game.players.values()) if (confusableKey(p.name) === key) return true;
  const accounts = store?.accounts;
  if (accounts && typeof accounts.values === 'function') {
    for (const a of accounts.values()) if (a && typeof a.name === 'string' && confusableKey(a.name) === key) return true;
  }
  return false;
}

/** Attach the WebSocket endpoint to an http server. Returns { wss, close() }. */
export function attachNet(httpServer, ctx) {
  const security = ctx.security || ctx.game.security || new Security({ log: ctx.log });
  ctx.security = security;
  const cfg = security.cfg;
  const wss = new WebSocketServer({
    server: httpServer,
    path: WS_PATH,
    maxPayload: MAX_PAYLOAD,
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
    const s = new Session(ws, ip, ctx);
    const refusal = security.connectionRefusal(ip);
    if (refusal) {
      kickSession(s, refusal);
      clearTimeout(s.authTimer);
      return;
    }
    security.connOpened(ip);
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
    for (const s of sessions) if (s.player && !s.closed && now - s.lastActivity > cfg.idleKickMs) s.kick(KICK_MESSAGES.idle);
  }, Math.max(200, Math.min(HEARTBEAT_MS, cfg.idleKickMs / 4)));
  idleTimer.unref();

  return {
    wss,
    sessions,
    close() {
      clearInterval(heartbeat);
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
