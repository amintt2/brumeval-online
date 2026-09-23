// Test helpers: a Game with a manual clock, fake sessions that record every message, player factories.
import { Game } from '../src/game.js';
import { newAccount } from '../src/persistence.js';
import { mulberry32 } from '../../shared/noise.js';
import { SPAWN_ZONES } from '../../shared/world.js';
import { setupMonster } from '../src/systems/ai/brain.js';

export class FakeSession {
  constructor(ip = '203.0.113.7') { this.msgs = []; this.closed = false; this.ip = ip; this.kicked = null; }
  send(m) { this.msgs.push(JSON.parse(JSON.stringify(m))); }
  kick(msg) { if (this.closed) return; this.send({ t: 'kick', msg }); this.kicked = msg; this.closed = true; }
  sendRaw(s) { this.msgs.push(JSON.parse(s)); }
  of(t, pred = () => true) { return this.msgs.filter((m) => m.t === t && pred(m)); }
  last(t, pred = () => true) { const a = this.of(t, pred); return a[a.length - 1]; }
  notes(kind) { return this.of('notify', (m) => !kind || m.kind === kind).map((m) => m.text); }
  errs() { return this.of('err').map((m) => m.code); }
  clear() { this.msgs = []; }
}

/** Game with a controllable clock (game.clockRef.t, ms) and deterministic rng. */
export function makeGame({ spawnMonsters = false, seed = 1, rng } = {}) {
  const clockRef = { t: 100_000 };
  const game = new Game({ clock: () => clockRef.t, rng: rng || mulberry32(seed), spawnMonsters });
  game.clockRef = clockRef;
  return game;
}

/** Advance the clock by `ms`, running one tick per 50 ms. */
export function advance(game, ms) {
  const n = Math.max(1, Math.round(ms / 50));
  for (let i = 0; i < n; i++) {
    game.clockRef.t += 50;
    game.tick();
  }
}

let counter = 0;
/** Create an online player. `over` overrides account fields (level, x, z, gold, inv, eq, quests…). */
export function addPlayer(game, { name, cls = 'warrior', ...over } = {}) {
  const acc = newAccount(name || `Joueur${++counter}`, cls, 'aa', 'bb');
  Object.assign(acc, over);
  const s = new FakeSession();
  const p = game.addPlayer(acc, s);
  s.clear();
  return p;
}

/** Teleport a player (also resets movement validation state). */
export function place(game, p, x, z) {
  p.x = x; p.z = z;
  p.mv.reset(x, z, game.now());
}

export const slimeZone = SPAWN_ZONES.find((z) => z.monster === 'slime');
export const zoneOf = (type) => SPAWN_ZONES.find((z) => z.monster === type);

/**
 * Spawn a monster of `type` at (x, z) (defaults to its zone centre). It stays idle unless provoked.
 * [combat-souls] never an elite unless asked; `ai` = { seed, variant, elite } re-configures its AI.
 */
export function spawnAt(game, type, x, z, ai = {}) {
  const zone = zoneOf(type);
  const m = game.spawnMonster(zone);
  setupMonster(game, m, { elite: false, ...ai });
  m.x = m.homeX = x ?? zone.x;
  m.z = m.homeZ = z ?? zone.z;
  m.aiUntil = Infinity;
  return m;
}

/** rng that always returns `v` (e.g. 0.99 = no crit, max roll; 0 = crit, min roll). */
export const constRng = (v) => () => v;
