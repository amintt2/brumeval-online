// [combat-souls] Soulslike combat rules shared by the server (authoritative), the client (prediction, UI,
// telegraph decals) and the tests: stamina, dodge roll, sprint, attack commitment and telegraph geometry.
// Pure data + pure functions, no dependencies.

/** Stamina / dodge / sprint tuning (ROADMAP §4.3). Times in ms, distances in metres. */
export const STAMINA = {
  max: 100,            // SelfState.mst
  regen: 35,           // per second…
  regenDelayMs: 800,   // …after this long without spending
  roll: 30,            // cost of a dodge roll
  sprintPerS: 18,      // sprint drain per second while moving
  sprintMult: 1.45,    // speed multiplier while sprinting
  sprintMin: 8,        // sprint can only (re)start above this much stamina
  sprintGraceMs: 350,  // server keeps allowing sprint speed this long after exhaustion (latency)
};

export const ROLL = {
  ms: 550,             // duration of the movement burst
  dist: 5,             // distance covered by a full roll
  iframeMs: 350,       // invulnerability from the start of the roll
  cdMs: 600,           // minimum time between two rolls (from start to start)
  graceMs: 200,        // server keeps the roll speed allowance this long after the roll (latency)
};
/** Constant roll speed (m/s). */
export const ROLL_SPEED = ROLL.dist / (ROLL.ms / 1000);

/** Attack commitment defaults (overridden per ability with ABILITIES[*].rec / .recSlow). */
export const COMMIT = {
  rec: 0.3,            // seconds of recovery after using an ability
  recSlow: 0.3,        // fraction of the normal speed allowed during recovery
  rangedMoveMax: 0.4,  // ranged auto-attacks only fire while moving slower than this fraction of the base speed
};

/** Poise: damage over this window staggers a monster when it exceeds its poise. */
// immuneMs: hyper-armor after a stagger ends (poise damage is ignored), so a stagger cannot be chained forever
export const POISE = { windowMs: 3500, staggerMs: 900, bossStaggerMs: 1500, immuneMs: 2000 };

/** Death echo: the XP of the current level is dropped where the player died. */
export const ECHO = { pickupR: 1.8 };

/** Telegraph shapes (S2C `tele`). */
export const TELE_SHAPES = ['circle', 'cone', 'line', 'ring'];

const TWO_PI = Math.PI * 2;
function angDiff(a, b) {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d < -Math.PI) d += TWO_PI;
  return d;
}

/**
 * Is a circle of radius `pr` centred on (px, pz) touched by telegraph `t`?
 * Conventions (same as `ry`): angle `a` = atan2(dirX, dirZ), i.e. 0 faces +Z.
 *   circle: centre (x, z), radius r
 *   ring:   centre (x, z), outer radius r, inner (safe) radius r2
 *   cone:   apex (x, z), radius r, facing a, full opening angle arc (radians)
 *   line:   origin (x, z), direction a, length len, width w
 */
export function inTelegraph(t, px, pz, pr = 0) {
  const dx = px - t.x, dz = pz - t.z;
  const d = Math.hypot(dx, dz);
  switch (t.shape) {
    case 'circle':
      return d <= t.r + pr;
    case 'ring':
      return d <= t.r + pr && d >= (t.r2 || 0) - pr;
    case 'cone': {
      if (d > t.r + pr) return false;
      if (d <= pr) return true; // the body covers the apex (monsters keep their distance: nobody stands behind it)
      const half = (t.arc || Math.PI / 2) / 2;
      const tol = Math.asin(Math.min(1, pr / d));
      return Math.abs(angDiff(t.a || 0, Math.atan2(dx, dz))) <= half + tol;
    }
    case 'line': {
      const fx = Math.sin(t.a || 0), fz = Math.cos(t.a || 0);
      const along = dx * fx + dz * fz;
      const side = dx * fz - dz * fx;
      return along >= -pr && along <= (t.len || 0) + pr && Math.abs(side) <= (t.w || 1) / 2 + pr;
    }
    default:
      return false;
  }
}

/** Bounding radius of a telegraph around its (x, z) anchor (for area-of-interest broadcasts). */
export function telegraphReach(t) {
  if (t.shape === 'line') return Math.hypot(t.len || 0, (t.w || 1) / 2);
  return t.r || 0;
}

/** Stamina after `dtMs` of regeneration, given the time since the last spend. Pure helper (client + server). */
export function regenStamina(st, mst, sinceSpendMs, dtMs) {
  if (st >= mst || sinceSpendMs < STAMINA.regenDelayMs) return Math.min(st, mst);
  const eff = Math.min(dtMs, sinceSpendMs - STAMINA.regenDelayMs);
  return Math.min(mst, st + (STAMINA.regen * eff) / 1000);
}
