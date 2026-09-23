// Authoritative world state + fixed-rate tick loop.
import { MONSTERS } from '../../shared/data.js';
import { S2C, C2S, FX, TICK_RATE, SNAPSHOT_EVERY, DAY_LENGTH_S, VIEW_RADIUS } from '../../shared/protocol.js';
import { SPAWN_ZONES, NPC_SPAWNS, isWalkable, inVillage } from '../../shared/world.js';
import { CollisionWorld } from '../../shared/collision.js';
import { AOI_EXIT_MARGIN, CORRECT_MIN_INTERVAL_MS, MOVE_STATE_MS, START_TOD } from './config.js';
import { createLogger } from './log.js';
import { nameKey } from './auth.js';
import { Player } from './entities/player.js';
import { Monster } from './entities/monster.js';
import { Npc } from './entities/npc.js';
import { sendSnapshots } from './snapshot.js';
import { updateMonsters } from './systems/ai.js';
import { updateRegen } from './systems/regen.js';
import { handleAbility, handleStop, updateAutoAttacks } from './systems/combat.js';
import { handleRespawn, correctMsg } from './systems/players.js';
import { handleInteract, handleQuestAccept, handleQuestTurnin, handleBuy, handleSell, checkDialogDistance } from './systems/npc.js';
import { handleUseItem, handleEquip, handleUnequip, handleDrop } from './systems/items.js';
import { handleChat } from './chat.js';
import { has, isNum, normAngle, randInt, round4 } from './util.js';
import { aoiOf } from './aoi.js'; // [netcode-perf]

const TICK_MS = 1000 / TICK_RATE;
const EVENT_R2 = (VIEW_RADIUS + AOI_EXIT_MARGIN) ** 2;
const nearBuf = []; // [netcode-perf] reused grid query buffer for broadcastNear

export class Game {
  /**
   * @param {object} opts
   * @param {import('./persistence.js').AccountStore} [opts.store]
   * @param {() => number} [opts.clock]  monotonic ms clock (injectable for tests)
   * @param {() => number} [opts.rng]    [0,1) random source (injectable for tests)
   * @param {boolean} [opts.spawnMonsters=true]
   */
  constructor(opts = {}) {
    this.log = opts.log || createLogger({ quiet: true });
    this.store = opts.store || null;
    this.clock = opts.clock || (() => performance.now());
    this.rng = opts.rng || Math.random;
    this.collision = opts.collision || new CollisionWorld();

    this.entities = new Map();
    this.players = new Map();
    this.monsters = new Map();
    this.npcs = new Map();
    this.byName = new Map();
    this.nextId = 1;
    this.tickCount = 0;
    this.startedAt = this.clock();
    this.timers = [];
    this.timerSeq = 0;
    this.nextTimerAt = Infinity;
    this.loopHandle = null;
    this.tickStats = { n: 0, total: 0, max: 0, last: 0 };
    this.errorCount = 0;
    this.lastSlowWarn = -Infinity;

    for (const s of NPC_SPAWNS) this.addEntity(new Npc(this.allocId(), s.key, s.x, s.z, s.ry));
    if (opts.spawnMonsters !== false) {
      for (const zone of SPAWN_ZONES) for (let i = 0; i < zone.count; i++) this.spawnMonster(zone);
    }
  }

  now() { return this.clock(); }
  allocId() { return this.nextId++; }

  /** Time of day in [0, 1): 0 = midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  tod() {
    const t = START_TOD + (this.now() - this.startedAt) / 1000 / DAY_LENGTH_S;
    return round4(t - Math.floor(t));
  }

  // ------------------------------------------------------------------ entities
  addEntity(e) {
    this.entities.set(e.id, e);
    if (e instanceof Player) this.players.set(e.id, e);
    else if (e instanceof Monster) this.monsters.set(e.id, e);
    else if (e instanceof Npc) this.npcs.set(e.id, e);
  }

  removeEntity(e) {
    this.entities.delete(e.id);
    this.players.delete(e.id);
    this.monsters.delete(e.id);
    this.npcs.delete(e.id);
  }

  /** Random free, walkable point inside a spawn zone (never in the village). */
  randomPointInZone(zone, radius) {
    for (let i = 0; i < 40; i++) {
      const a = this.rng() * Math.PI * 2, d = Math.sqrt(this.rng()) * zone.r;
      const x = zone.x + Math.cos(a) * d, z = zone.z + Math.sin(a) * d;
      if (!isWalkable(x, z) || inVillage(x, z)) continue;
      if (this.collision.penetration(x, z, radius) > 0.01) continue;
      return { x, z };
    }
    return { x: zone.x, z: zone.z };
  }

  /** Spawn one monster of `zone` (new entity id every time). */
  spawnMonster(zone) {
    const def = MONSTERS[zone.monster];
    const level = randInt(this.rng, def.level[0], def.level[1]);
    const pt = this.randomPointInZone(zone, def.radius);
    const now = this.now();
    const m = new Monster(this.allocId(), zone.monster, level, zone, pt.x, pt.z, this.rng() * Math.PI * 2 - Math.PI, now);
    m.aiUntil = now + this.rng() * 5000;
    this.addEntity(m);
    this.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.RESPAWN, src: m.id });
    return m;
  }

  // ------------------------------------------------------------------ players
  /** Create the live player of an authenticated account. Sends nothing to the new player itself. */
  addPlayer(account, session) {
    const p = new Player(this.allocId(), account, session, this.now());
    this.addEntity(p);
    this.byName.set(nameKey(p.name), p);
    p.dirty.clear();
    this.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.RESPAWN, src: p.id }, p);
    this.systemChat(`${p.name} a rejoint Brumeval.`, { except: p });
    account.lastSeen = Date.now();
    this.store?.markDirty();
    return p;
  }

  /** Remove a player (disconnect): other clients get `gone`, the account is saved. */
  removePlayer(p) {
    if (this.players.get(p.id) !== p) return;
    p.syncAccount();
    this.removeEntity(p);
    this.byName.delete(nameKey(p.name));
    for (const m of this.monsters.values()) {
      m.threat.delete(p.id);
      if (m.target === p.id) m.target = 0;
    }
    this.systemChat(`${p.name} a quitté Brumeval.`);
    if (this.store) {
      this.store.markDirty();
      this.store.save();
    }
  }

  playerByName(name) {
    return typeof name === 'string' ? this.byName.get(nameKey(name)) || null : null;
  }

  /** Copy every online player into its account record. */
  syncAll() {
    for (const p of this.players.values()) p.syncAccount();
    if (this.players.size && this.store) this.store.markDirty();
  }

  // ------------------------------------------------------------------ messaging
  send(p, msg) { p.session.send(msg); }
  sendRaw(p, str) { p.session.sendRaw(str); }

  broadcast(msg, except = null) {
    const str = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except) p.session.sendRaw(str);
  }

  /** Send to every player whose area of interest contains (x, z). */
  broadcastNear(x, z, msg, except = null) {
    let str = null;
    // [netcode-perf] inside the tick players do not move, so the grid (synced once per tick) is exact for them
    const list = this.inTick ? aoiOf(this).playersNear(x, z, VIEW_RADIUS + AOI_EXIT_MARGIN, nearBuf, false) : this.players.values();
    for (const p of list) {
      if (p === except) continue;
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz > EVENT_R2) continue;
      if (str === null) str = JSON.stringify(msg);
      p.session.sendRaw(str);
    }
  }

  notify(p, kind, text) { p.session.send({ t: S2C.NOTIFY, kind, text }); }
  error(p, code, msg) { p.session.send({ t: S2C.ERR, code, msg }); }

  /** System chat line to everyone, to one player (`to`) or everyone but `except`. */
  systemChat(text, { to = null, except = null } = {}) {
    const msg = { t: S2C.CHAT, ch: 'system', text };
    if (to) this.send(to, msg);
    else this.broadcast(msg, except);
  }

  /** Snap the client back to its server position (throttled unless `force`). */
  sendCorrect(p, force = false) {
    const now = this.now();
    if (!force && now - p.lastCorrectAt < CORRECT_MIN_INTERVAL_MS) return;
    p.lastCorrectAt = now;
    this.send(p, correctMsg(p));
  }

  flushSelf(p) {
    const d = p.takeDirty();
    if (d) p.session.send({ t: S2C.SELF, ...d });
  }

  // ------------------------------------------------------------------ timers
  schedule(delayMs, fn) {
    const at = this.now() + delayMs;
    this.timers.push({ at, seq: this.timerSeq++, fn });
    if (at < this.nextTimerAt) this.nextTimerAt = at;
  }

  runTimers(now) {
    if (now < this.nextTimerAt) return;
    const due = [];
    const keep = [];
    let next = Infinity;
    for (const t of this.timers) {
      if (t.at <= now) due.push(t);
      else {
        keep.push(t);
        if (t.at < next) next = t.at;
      }
    }
    this.timers = keep;
    this.nextTimerAt = next;
    due.sort((a, b) => a.at - b.at || a.seq - b.seq);
    for (const t of due) {
      try { t.fn(); } catch (err) { this.reportError('timer', err); }
    }
  }

  // ------------------------------------------------------------------ input
  /** Dispatch an authenticated client message. Unknown types are ignored. */
  handleMessage(p, msg) {
    if (!has(HANDLERS, msg.t)) return;
    const h = HANDLERS[msg.t];
    h(this, p, msg);
    this.flushSelf(p);
  }

  handleMove(p, msg) {
    if (!isNum(msg.x) || !isNum(msg.z)) return;
    if (p.dead) return this.sendCorrect(p);
    const now = this.now();
    const to = { x: msg.x, z: msg.z };
    if (p.mv.check(to, now, p.stats.speed, this.collision)) return this.sendCorrect(p);
    if (Math.hypot(to.x - p.x, to.z - p.z) > 0.01) p.moveUntil = now + MOVE_STATE_MS;
    p.x = to.x;
    p.z = to.z;
    if (isNum(msg.ry)) p.ry = normAngle(msg.ry);
    p.mv.accept(to, now, p.stats.speed);
    checkDialogDistance(this, p);
  }

  // ------------------------------------------------------------------ loop
  tick() {
    const t0 = performance.now();
    const now = this.now();
    const dt = 1 / TICK_RATE;
    this.tickCount++;
    this.inTick = true; // [netcode-perf] grid queries may use the per-tick synced grid
    this.guard('timers', () => this.runTimers(now));
    this.guard('ai', () => updateMonsters(this, dt, now));
    this.guard('combat', () => updateAutoAttacks(this, now));
    this.guard('regen', () => updateRegen(this, dt, now));
    if (this.tickCount % SNAPSHOT_EVERY === 0) this.guard('snapshot', () => sendSnapshots(this, now));
    for (const p of this.players.values()) this.guard('self', () => this.flushSelf(p));
    this.inTick = false; // [netcode-perf]
    const ms = performance.now() - t0;
    const s = this.tickStats;
    s.n++; s.total += ms; s.last = ms;
    if (ms > s.max) s.max = ms;
    if (ms > TICK_MS && t0 - this.lastSlowWarn > 10_000) {
      this.lastSlowWarn = t0;
      this.log.warn(`tick ${this.tickCount} lent : ${ms.toFixed(1)} ms`);
    }
  }

  guard(label, fn) {
    try { fn(); } catch (err) { this.reportError(label, err); }
  }

  reportError(label, err) {
    this.errorCount++;
    if (this.errorCount <= 50 || this.errorCount % 100 === 0) this.log.error(`[${label}]`, err?.stack || err);
  }

  /** Start the fixed-rate loop (drift-compensated, catches up at most 5 ticks). */
  start() {
    if (this.loopHandle) return;
    let next = performance.now() + TICK_MS;
    const loop = () => {
      const now = performance.now();
      let n = 0;
      while (now >= next && n < 5) {
        this.tick();
        next += TICK_MS;
        n++;
      }
      if (now - next > 1000) next = now + TICK_MS; // hopelessly behind (e.g. debugger pause): resync
      this.loopHandle = setTimeout(loop, Math.max(1, next - performance.now()));
    };
    this.loopHandle = setTimeout(loop, TICK_MS);
  }

  stop() {
    if (this.loopHandle) clearTimeout(this.loopHandle);
    this.loopHandle = null;
  }

  /** Tick duration stats since the last call (ms). */
  takeTickStats() {
    const s = this.tickStats;
    const out = { ticks: s.n, avg: s.n ? s.total / s.n : 0, max: s.max, last: s.last };
    this.tickStats = { n: 0, total: 0, max: 0, last: s.last };
    return out;
  }
}

const HANDLERS = {
  [C2S.MOVE]: (g, p, m) => g.handleMove(p, m),
  [C2S.ABILITY]: handleAbility,
  [C2S.STOP]: handleStop,
  [C2S.CHAT]: handleChat,
  [C2S.INTERACT]: handleInteract,
  [C2S.QUEST_ACCEPT]: handleQuestAccept,
  [C2S.QUEST_TURNIN]: handleQuestTurnin,
  [C2S.BUY]: handleBuy,
  [C2S.SELL]: handleSell,
  [C2S.USE_ITEM]: handleUseItem,
  [C2S.EQUIP]: handleEquip,
  [C2S.UNEQUIP]: handleUnequip,
  [C2S.DROP]: handleDrop,
  [C2S.RESPAWN]: (g, p) => handleRespawn(g, p),
};
