// Movement validation (SPEC §4.6, hardened in v0.2). The client simulates its own movement with
// CollisionWorld.move; the server accepts it when it is physically plausible and flags what is not.
//
// Distance budget (token bucket): every accepted move spends its length; the budget refills at
// `allowed speed × RATE_TOLERANCE` and holds at most `allowed speed × BURST_S + BURST_SLACK_M`. The allowed
// speed is `player.maxSpeedAt(now)` when the entity provides it (sprint, roll, slows — ROADMAP §4.3), else
// `stats.speed`; it is held at its recent peak for SPEED_HOLD_MS so late messages of a sprint/roll still fit.
// Network jitter only shifts *when* moves arrive, never how far the client really went: with a budget of
// BURST_S seconds, lag spikes up to that long are absorbed without a single correction, while the long-term
// speed can never exceed the allowed speed by more than RATE_TOLERANCE.
//
// Per move we also detect: teleports (one message covering more than a legit client can in one frame
// batch), out-of-bounds coordinates, destinations inside obstacles / deep water, and paths crossing an
// obstacle (segment vs circle sweep). Rejections send a `correct`; the first rejection after the client was
// in sync is flagged to the security layer, the following ones (messages already in flight) are not.
import { isWalkable, WORLD_LIMIT } from '../../shared/world.js';
import { PLAYER_RADIUS } from '../../shared/protocol.js';
import { MOVE_SPEED_FACTOR, MOVE_SLACK_M, MOVE_MAX_ELAPSED_S, MAX_PENETRATION, MOVE_STATE_MS } from './config.js';
import { checkDialogDistance } from './systems/npc.js';
import { isNum, normAngle } from './util.js';

/** Long-term speed tolerance (clock drift between client and server, rounding). */
export const RATE_TOLERANCE = 1.1;
/** Seconds of movement the budget can hold: absorbs lag spikes / message bursts up to this long. */
export const BURST_S = 1.5;
export const BURST_SLACK_M = 1.0;
/** The allowed speed is held at its peak this long (late messages of a sprint or a roll). */
export const SPEED_HOLD_MS = 700;
/** A single message may not move more than max(TELEPORT_MIN_M, peak speed × TELEPORT_S). */
export const TELEPORT_MIN_M = 5;
export const TELEPORT_S = 0.8;
/** Crossing an obstacle deeper than this (m, and 45 % of its combined radius) is walking through it. */
export const WALL_MIN_DEPTH = 0.3;
export const WALL_DEPTH_RATIO = 0.45;
/** After a correction / server teleport, rejected moves are not flagged until the client is back in sync. */
export const SYNC_RADIUS_M = 2;
export const GRACE_MAX_MS = 2500;
/** Moves received this long after death are flagged (earlier ones were in flight). */
export const DEAD_MOVE_GRACE_MS = 1500;

/** Max distance allowed since the last accepted position after `elapsedMs` (the v0.1 SPEC rule, kept for tools). */
export function maxMoveDistance(speed, elapsedMs) {
  const elapsed = Math.min(Math.max(elapsedMs, 0) / 1000, MOVE_MAX_ELAPSED_S);
  return speed * elapsed * MOVE_SPEED_FACTOR + MOVE_SLACK_M;
}

/**
 * Stateless check of a single move with the v0.1 SPEC rule (tools / tests).
 * Returns null when accepted, otherwise 'too_fast' | 'unwalkable' | 'out_of_bounds' | 'blocked' | 'wall'.
 */
export function validateMove(from, to, elapsedMs, speed, collision) {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  if (d > maxMoveDistance(speed, elapsedMs)) return 'too_fast';
  return validateSpot(to, collision) || sweepObstacles(from, to, collision);
}

/** Is (x, z) walkable, tolerating the 1 cm rounding of positions sent by clients? */
function walkableRounded(x, z) {
  if (isWalkable(x, z)) return true;
  const e = 0.02;
  return isWalkable(x + e, z) || isWalkable(x - e, z) || isWalkable(x, z + e) || isWalkable(x, z - e);
}

/** Destination checks: inside the world, walkable and not inside an obstacle. */
export function validateSpot(to, collision) {
  if (Math.abs(to.x) > WORLD_LIMIT + 0.05 || Math.abs(to.z) > WORLD_LIMIT + 0.05) return 'out_of_bounds';
  if (!walkableRounded(to.x, to.z)) return 'unwalkable';
  if (collision.penetration(to.x, to.z, PLAYER_RADIUS) >= MAX_PENETRATION) return 'blocked';
  return null;
}

/**
 * Segment vs circle sweep: does the straight path from `a` to `b` go through an obstacle?
 * Sliding along a round obstacle produces chords that only graze it (depth ≈ step² / 8r), so only deep
 * crossings are reported. Returns 'wall' or null.
 */
export function sweepObstacles(a, b, collision) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return null;
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  for (const o of collision.query(mx, mz, len / 2 + PLAYER_RADIUS + 0.1)) {
    const rho = o.r + PLAYER_RADIUS;
    // closest point of the segment to the obstacle centre
    const t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / (len * len)));
    const cx = a.x + dx * t, cz = a.z + dz * t;
    const depth = rho - Math.hypot(o.x - cx, o.z - cz);
    if (depth > Math.max(WALL_MIN_DEPTH, rho * WALL_DEPTH_RATIO)) return 'wall';
  }
  return null;
}

/**
 * Per-player movement state (distance budget + resync grace).
 */
export class MoveValidator {
  constructor(x, z, t) { this.reset(x, z, t); }

  /** Server-side teleport / respawn / correction: new reference position, full budget, grace until resync. */
  reset(x, z, t) {
    this.last = { x, z, t };
    this.budget = Infinity; // clamped to the capacity on first use
    this.budgetT = t;
    this.samples = [];      // [{ t, v }] allowed-speed samples, for the peak hold
    this.graceFrom(x, z, t);
    this.deadSince = null;
    this.rejections = 0;
  }

  /** Rejected moves are not flagged until a move lands within SYNC_RADIUS_M of (x, z) or GRACE_MAX_MS pass. */
  graceFrom(x, z, t) {
    this.sync = { x, z };
    this.graceUntil = t + GRACE_MAX_MS;
  }

  inGrace(now) { return this.sync !== null && now < this.graceUntil; }

  /** Allowed speed held at its recent peak. Records the sample. */
  peakSpeed(now, speed) {
    const s = this.samples;
    while (s.length && now - s[0].t > SPEED_HOLD_MS) s.shift();
    if (!s.length || s[s.length - 1].v !== speed || now - s[s.length - 1].t > 100) s.push({ t: now, v: speed });
    let peak = speed;
    for (const e of s) if (e.v > peak) peak = e.v;
    return peak;
  }

  capacity(peak) { return peak * BURST_S + BURST_SLACK_M; }

  /** Budget available at `now` for this peak speed. */
  budgetAt(now, peak) {
    const refill = peak * RATE_TOLERANCE * Math.max(0, now - this.budgetT) / 1000;
    return Math.min(this.capacity(peak), this.budget + refill);
  }

  /**
   * null if the move to `to` at `now` is accepted, else { reason, detail }.
   * Reasons: 'out_of_bounds' | 'teleport' | 'speed' | 'unwalkable' | 'blocked' | 'wall'.
   * Only records the speed sample (no other mutation).
   */
  check(to, now, speed, collision) {
    if (!isNum(to.x) || !isNum(to.z)) return { reason: 'out_of_bounds', detail: { x: to.x, z: to.z } };
    if (Math.abs(to.x) > WORLD_LIMIT + 0.05 || Math.abs(to.z) > WORLD_LIMIT + 0.05) {
      return { reason: 'out_of_bounds', detail: { x: round(to.x), z: round(to.z) } };
    }
    const peak = this.peakSpeed(now, speed);
    const d = Math.hypot(to.x - this.last.x, to.z - this.last.z);
    const teleport = Math.max(TELEPORT_MIN_M, peak * TELEPORT_S);
    if (d > teleport) return { reason: 'teleport', detail: { d: round(d), max: round(teleport) } };
    const avail = this.budgetAt(now, peak);
    if (d > avail) return { reason: 'speed', detail: { d: round(d), budget: round(avail), v: round(peak) } };
    const spot = validateSpot(to, collision);
    if (spot) return { reason: spot, detail: { x: round(to.x), z: round(to.z) } };
    if (sweepObstacles(this.last, to, collision)) {
      return { reason: 'wall', detail: { from: [round(this.last.x), round(this.last.z)], to: [round(to.x), round(to.z)] } };
    }
    return null;
  }

  accept(to, now, speed) {
    const peak = this.peakSpeed(now, speed);
    const d = Math.hypot(to.x - this.last.x, to.z - this.last.z);
    this.budget = Math.max(0, this.budgetAt(now, peak) - d);
    this.budgetT = now;
    this.last = { x: to.x, z: to.z, t: now };
    if (this.sync && Math.hypot(to.x - this.sync.x, to.z - this.sync.z) <= SYNC_RADIUS_M) this.sync = null;
  }
}

/** Suspicion weight of a rejected move. */
export const MOVE_FLAG_WEIGHT = {
  out_of_bounds: 10,
  teleport: 8,
  wall: 4,
  speed: 2,
  blocked: 2,
  unwalkable: 1,
  dead: 1,
};

/** Speed currently allowed to the player (ROADMAP §4.3 contract), m/s. */
export function allowedSpeed(p, now) {
  const v = typeof p.maxSpeedAt === 'function' ? p.maxSpeedAt(now) : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : p.stats.speed;
}

/** C2S move { x, z, ry }: validate, apply or correct, flag cheats. */
export function handleMoveMsg(game, p, msg) {
  if (!isNum(msg.x) || !isNum(msg.z)) return;
  const now = game.now();
  const mv = p.mv;
  if (p.dead) {
    const d = Math.hypot(msg.x - p.x, msg.z - p.z);
    if (mv.deadSince === null) mv.deadSince = now;
    else if (d > 0.3 && now - mv.deadSince > DEAD_MOVE_GRACE_MS) {
      game.security?.flag?.(p, 'move_dead', MOVE_FLAG_WEIGHT.dead, { d: round(d) });
    }
    return game.sendCorrect(p);
  }
  mv.deadSince = null;
  const to = { x: msg.x, z: msg.z };
  const speed = allowedSpeed(p, now);
  const bad = mv.check(to, now, speed, game.collision);
  if (bad) {
    mv.rejections++;
    if (!mv.inGrace(now)) {
      const w = bad.reason === 'speed' ? Math.min(6, MOVE_FLAG_WEIGHT.speed + (bad.detail.d - bad.detail.budget) / 2) : MOVE_FLAG_WEIGHT[bad.reason] || 1;
      game.security?.flag?.(p, bad.reason, w, bad.detail);
      // the client is out of sync until one of its moves lands next to the corrected position; the moves
      // already in flight are rejected without being flagged again (the grace is not extended by them)
      mv.graceFrom(p.x, p.z, now);
    }
    return game.sendCorrect(p);
  }
  if (Math.hypot(to.x - p.x, to.z - p.z) > 0.01) p.moveUntil = now + MOVE_STATE_MS;
  p.x = to.x;
  p.z = to.z;
  if (isNum(msg.ry)) p.ry = normAngle(msg.ry);
  mv.accept(to, now, speed);
  checkDialogDistance(game, p);
}

const round = (v) => Math.round(v * 100) / 100;
