// Movement validation (SPEC §4.6). The client simulates its own movement with CollisionWorld.move;
// the server accepts it when it is physically plausible.
import { isWalkable } from '../../shared/world.js';
import { PLAYER_RADIUS } from '../../shared/protocol.js';
import { MOVE_SPEED_FACTOR, MOVE_SLACK_M, MOVE_MAX_ELAPSED_S, MAX_PENETRATION } from './config.js';

/** Max distance allowed since the last accepted position after `elapsedMs` (the SPEC rule). */
export function maxMoveDistance(speed, elapsedMs) {
  const elapsed = Math.min(Math.max(elapsedMs, 0) / 1000, MOVE_MAX_ELAPSED_S);
  return speed * elapsed * MOVE_SPEED_FACTOR + MOVE_SLACK_M;
}

/**
 * Validate a move from the last accepted position `from` {x, z} to `to` {x, z} with the SPEC rule only.
 * Returns null when accepted, otherwise the reason: 'too_fast' | 'unwalkable' | 'blocked'.
 */
export function validateMove(from, to, elapsedMs, speed, collision) {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  if (d > maxMoveDistance(speed, elapsedMs)) return 'too_fast';
  return validateSpot(to, collision);
}

/** Destination checks: walkable and not inside an obstacle. */
export function validateSpot(to, collision) {
  if (!isWalkable(to.x, to.z)) return 'unwalkable';
  if (collision.penetration(to.x, to.z, PLAYER_RADIUS) >= MAX_PENETRATION) return 'blocked';
  return null;
}

/**
 * Sliding window used against sustained speed hacks: the per-message 0.6 m slack alone would let a client
 * sending at 15 Hz move ~2.7× faster than allowed. Over any window of at least WINDOW_MS the displacement must
 * stay within speed × elapsed × 1.35 + 0.6 (uncapped elapsed). Legitimate clients only exceed it if one
 * message was delayed ~1.1 s more than the later ones.
 */
export const WINDOW_MS = 3000;

/**
 * Per-player movement state.
 *
 * A move is accepted when its distance from the last accepted position fits EITHER the SPEC rule
 * (speed × min(elapsed, 1 s) × 1.35 + 0.6) OR the unused movement credit (a token bucket refilled at
 * speed × 1.35 per second, capped at the SPEC allowance for 1 s). The credit absorbs bursts of queued
 * messages after a network/server stall (elapsed ≈ 0 between them), e.g. from a low-fps client whose
 * steps exceed 0.6 m. The window rule above then bounds the long-term speed.
 */
export class MoveValidator {
  constructor(x, z, t) { this.reset(x, z, t); }

  /** Teleport / respawn: new reference position, full credit. */
  reset(x, z, t) {
    this.last = { x, z, t };
    this.history = [{ x, z, t }];
    this.credit = Infinity; // clamped to the cap on first use
    this.creditT = t;
  }

  creditAt(now, speed) {
    const cap = speed * MOVE_MAX_ELAPSED_S * MOVE_SPEED_FACTOR + MOVE_SLACK_M;
    return Math.min(cap, this.credit + speed * MOVE_SPEED_FACTOR * Math.max(0, now - this.creditT) / 1000);
  }

  /** Newest accepted position at least WINDOW_MS old (null if none). Prunes older entries. */
  anchor(now) {
    const h = this.history;
    while (h.length > 1 && h[1].t <= now - WINDOW_MS) h.shift();
    return h[0].t <= now - WINDOW_MS ? h[0] : null;
  }

  /** null if the move to `to` at time `now` is accepted, else the reason. Does not mutate. */
  check(to, now, speed, collision) {
    const d = Math.hypot(to.x - this.last.x, to.z - this.last.z);
    if (d > maxMoveDistance(speed, now - this.last.t) && d > this.creditAt(now, speed)) return 'too_fast';
    const spot = validateSpot(to, collision);
    if (spot) return spot;
    const a = this.anchor(now);
    if (a) {
      const allowed = speed * ((now - a.t) / 1000) * MOVE_SPEED_FACTOR + MOVE_SLACK_M;
      if (Math.hypot(to.x - a.x, to.z - a.z) > allowed) return 'too_fast';
    }
    return null;
  }

  accept(to, now, speed) {
    const d = Math.hypot(to.x - this.last.x, to.z - this.last.z);
    this.credit = Math.max(0, this.creditAt(now, speed) - d);
    this.creditT = now;
    this.last = { x: to.x, z: to.z, t: now };
    this.history.push(this.last);
  }
}
