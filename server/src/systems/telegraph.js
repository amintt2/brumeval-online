// [combat-souls] Telegraphed attacks: a ground shape is announced (S2C `tele`), the hit is resolved `ms` later
// against the positions of the targets THEN (so it can be dodged by moving out or by rolling through it with
// i-frames). Generic over attackers and targets: `hostilesOf` decides who can be hit (players today; PvP later
// only has to extend it with a faction / duel check).
import { KIND, S2C, FX, PLAYER_RADIUS } from '../../../shared/protocol.js';
import { inTelegraph, TELE_SHAPES } from '../../../shared/combat.js';
import { inVillage } from '../../../shared/world.js';
import { round2, round3 } from '../util.js';

/** True while `e` is invulnerable (dodge roll i-frames). */
export const inIframes = (e, now) => now < (e.iframeUntil || 0);

/** Entities that `src` may damage. Players are never hit inside the village (safe zone). */
export function hostilesOf(game, src) {
  const out = [];
  if (!src || src.kind === KIND.MONSTER) {
    for (const p of game.players.values()) if (!p.dead && !inVillage(p.x, p.z)) out.push(p);
  } else if (src.kind === KIND.PLAYER) {
    for (const m of game.monsters.values()) if (!m.dead && !m.invulnerable) out.push(m);
  }
  return out;
}

const radiusOf = (e) => (e.kind === KIND.PLAYER ? PLAYER_RADIUS : e.radius || 0.5);

// [skilltree] fundamentals.js registers the perfect dodge (roll i-frames) and the airborne test (Saut vs `lo`)
const hooks = { dodged: null, airborne: null };
export function setTelegraphHooks(h) { Object.assign(hooks, h); }

export class TelegraphSystem {
  constructor(game) {
    this.game = game;
    this.active = new Map(); // id -> telegraph
    this.seq = 0;
  }

  /**
   * Announce a telegraph and schedule its resolution.
   * @param src    attacker entity (the telegraph is cancelled if it dies or is removed)
   * @param shape  { shape, x, z, r?, r2?, a?, arc?, w?, len? }
   * @param ms     delay until impact
   * @param opts   { ab?, clip?, lo?, nb?, mag?, onHit(target), onImpact(hits[]) }
   *               [skilltree] lo = rasant (airborne targets are missed), nb = imblocable, mag = spell
   * @returns telegraph id
   */
  start(src, shape, ms, opts = {}) {
    if (!TELE_SHAPES.includes(shape.shape)) throw new Error(`forme de télégraphe inconnue : ${shape.shape}`);
    const id = ++this.seq;
    const t = {
      id, src, shape: shape.shape,
      x: shape.x, z: shape.z, r: shape.r || 0, r2: shape.r2 || 0, a: shape.a || 0, arc: shape.arc || 0,
      w: shape.w || 0, len: shape.len || 0,
      at: this.game.now() + ms, opts,
    };
    this.active.set(id, t);
    const msg = { t: S2C.TELE, id, src: src ? src.id : 0, shape: t.shape, x: round2(t.x), z: round2(t.z), r: round2(t.r), a: round3(t.a), ms: Math.round(ms) };
    if (t.shape === 'ring') msg.r2 = round2(t.r2);
    if (t.shape === 'cone') msg.arc = round3(t.arc);
    if (t.shape === 'line') { msg.w = round2(t.w); msg.len = round2(t.len); }
    if (opts.ab) msg.ab = opts.ab;
    if (opts.clip) msg.clip = opts.clip;
    if (opts.lo) msg.lo = 1; // [skilltree]
    if (opts.nb) msg.nb = 1;
    if (opts.mag) msg.mag = 1;
    this.game.broadcastNear(t.x, t.z, msg);
    this.game.schedule(ms, () => this.resolve(id));
    return id;
  }

  /** Impact: hit every hostile inside the shape now. Returns the entities hit (null if cancelled). */
  resolve(id) {
    const t = this.active.get(id);
    if (!t) return null;
    this.active.delete(id);
    const game = this.game;
    const src = t.src;
    if (src && (src.dead || game.entities.get(src.id) !== src)) return null;
    const now = game.now();
    const hits = [];
    for (const e of hostilesOf(game, src)) {
      if (!inTelegraph(t, e.x, e.z, radiusOf(e))) continue;
      if (inIframes(e, now)) {
        if (e.kind === KIND.PLAYER && hooks.dodged) hooks.dodged(game, e, now);
        else game.broadcastNear(e.x, e.z, { t: S2C.FX, k: FX.DODGE, tg: e.id });
        continue;
      }
      // [skilltree] a jump clears « rasant » attacks (shockwaves, low sweeps)
      if (t.opts.lo && e.kind === KIND.PLAYER && hooks.airborne?.(e, now)) {
        game.broadcastNear(e.x, e.z, { t: S2C.FX, k: FX.DODGE, tg: e.id });
        continue;
      }
      hits.push(e);
      t.opts.onHit?.(e);
    }
    t.opts.onImpact?.(hits);
    return hits;
  }

  /** Cancel a pending telegraph (S2C tele_end). */
  cancel(id) {
    const t = this.active.get(id);
    if (!t) return false;
    this.active.delete(id);
    this.game.broadcastNear(t.x, t.z, { t: S2C.TELE_END, id });
    return true;
  }

  /** Cancel every pending telegraph of `src`. */
  cancelAllOf(src) {
    for (const t of [...this.active.values()]) if (t.src === src) this.cancel(t.id);
  }

  get size() { return this.active.size; }
}

/** The game's telegraph system (created on first use). */
export function telegraphs(game) {
  if (!game.telegraphs) game.telegraphs = new TelegraphSystem(game);
  return game.telegraphs;
}
