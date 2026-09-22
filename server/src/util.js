// Small pure helpers: rounding, geometry, type checks, randomness.

export const round2 = (v) => Math.round(v * 100) / 100;
export const round3 = (v) => Math.round(v * 1000) / 1000;
export const round4 = (v) => Math.round(v * 10000) / 10000;

export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

/** Wrap an angle into [-PI, PI]. */
export function normAngle(a) {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
export const isStr = (v, max = Infinity) => typeof v === 'string' && v.length <= max;
/** Entity ids are positive safe integers. */
export const isId = (v) => Number.isSafeInteger(v) && v > 0;

export const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
export const randRange = (rng, lo, hi) => lo + rng() * (hi - lo);

/** Own-property lookup that never hits the prototype chain ("__proto__", "constructor"…). */
export const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
