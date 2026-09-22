// WebSocket sessions: parsing, rate limiting, authentication, routing to the game.
import { WebSocketServer, WebSocket } from 'ws';
import { WS_PATH, C2S, S2C, decode } from '../../shared/protocol.js';
import { CLASSES } from '../../shared/data.js';
import {
  MAX_PAYLOAD, MSG_RATE_PER_S, MAX_AUTH_ATTEMPTS, HEARTBEAT_MS, MAX_BUFFERED_BYTES, MAX_PLAYERS, MOTD,
} from './config.js';
import { validName, validPassword, validClass, nameKey, hashPassword, verifyPassword, dummyVerify } from './auth.js';
import { newAccount } from './persistence.js';
import { isNum } from './util.js';

const AUTH_MESSAGES = {
  bad_name: 'Nom invalide : 3 à 16 caractères (lettres, chiffres ou _).',
  bad_password: 'Mot de passe invalide : 4 à 64 caractères.',
  bad_class: 'Classe inconnue.',
  name_taken: 'Ce nom est déjà pris.',
  wrong_credentials: 'Nom ou mot de passe incorrect.',
  already_online: 'Ce personnage est déjà connecté.',
  server_full: 'Le serveur est complet, réessayez plus tard.',
  bad_request: 'Requête invalide.',
};

class Session {
  constructor(ws, ip, ctx) {
    this.ws = ws;
    this.ip = ip;
    this.ctx = ctx;
    this.player = null;
    this.authBusy = false;
    this.authAttempts = 0;
    this.closed = false;
    this.alive = true;
    this.winStart = 0;
    this.winCount = 0;

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
    this.send({ t: S2C.KICK, msg });
    this.ctx.log.info(`${this.label()} expulsé : ${msg}`);
    setImmediate(() => { try { this.ws.close(4000, 'kick'); } catch { /* ignore */ } });
    this.closed = true;
  }

  label() {
    return this.player ? this.player.name : `connexion ${this.ip}`;
  }

  onMessage(data) {
    if (this.closed) return;
    const now = Date.now();
    if (now - this.winStart >= 1000) {
      this.winStart = now;
      this.winCount = 0;
    }
    if (++this.winCount > MSG_RATE_PER_S) return this.kick('Trop de messages envoyés.');
    const msg = decode(data);
    if (!msg) return;
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
    if (++this.authAttempts > MAX_AUTH_ATTEMPTS) return this.kick('Trop de tentatives de connexion.');
    this.authBusy = true;
    fn()
      .catch((err) => {
        this.ctx.game.reportError('auth', err);
        this.authErr('bad_request');
      })
      .finally(() => { this.authBusy = false; });
  }

  authErr(code) {
    this.send({ t: S2C.AUTH_ERR, code, msg: AUTH_MESSAGES[code] });
  }

  async register(msg) {
    const { store, game } = this.ctx;
    const { name, password, cls } = msg;
    if (!validName(name)) return this.authErr('bad_name');
    if (!validPassword(password)) return this.authErr('bad_password');
    if (!validClass(cls)) return this.authErr('bad_class');
    if (store.has(name)) return this.authErr('name_taken');
    if (game.players.size >= MAX_PLAYERS) return this.authErr('server_full');
    const { salt, hash } = await hashPassword(password);
    if (this.closed) return;
    if (store.has(name)) return this.authErr('name_taken'); // registered meanwhile
    if (game.players.size >= MAX_PLAYERS) return this.authErr('server_full');
    const account = store.create(newAccount(name, cls, salt, hash));
    store.save();
    this.ctx.log.info(`nouveau compte : ${name} (${CLASSES[cls].name})`);
    this.enter(account);
  }

  async login(msg) {
    const { store, game } = this.ctx;
    const { name, password } = msg;
    if (typeof name !== 'string' || typeof password !== 'string' || name.length > 64 || password.length > 256) {
      return this.authErr('bad_request');
    }
    const account = store.get(name);
    const ok = account ? await verifyPassword(password, account.salt, account.hash) : await dummyVerify(password);
    if (this.closed) return;
    if (!ok) return this.authErr('wrong_credentials');
    if (game.byName.has(nameKey(account.name))) return this.authErr('already_online');
    if (game.players.size >= MAX_PLAYERS) return this.authErr('server_full');
    this.enter(account);
  }

  enter(account) {
    const { game, log } = this.ctx;
    const p = game.addPlayer(account, this);
    this.player = p;
    this.send({ t: S2C.AUTH_OK, id: p.id, self: p.selfState(), tod: game.tod(), online: game.players.size, motd: MOTD });
    log.info(`+ ${p.name} (${CLASSES[p.cls].name} niv. ${p.level}) connecté — ${game.players.size} en ligne`);
  }

  onClose() {
    this.closed = true;
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

/** Attach the WebSocket endpoint to an http server. Returns { wss, close() }. */
export function attachNet(httpServer, ctx) {
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH, maxPayload: MAX_PAYLOAD });
  const sessions = new Set();

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress || '?';
    const s = new Session(ws, ip, ctx);
    sessions.add(s);
    ws.on('close', () => sessions.delete(s));
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

  return {
    wss,
    sessions,
    close() {
      clearInterval(heartbeat);
      for (const s of sessions) {
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
