// French formatting helpers for moderation messages.

/** "45 s", "12 min", "2 h 5 min", "3 j 4 h". */
export function formatDuration(ms) {
  if (!(ms > 0)) return '0 s';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h} h ${rm} min` : `${h} h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} j ${rh} h` : `${d} j`;
}

const UNITS = {
  s: 1000, sec: 1000, seconde: 1000, secondes: 1000,
  m: 60_000, min: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, heure: 3_600_000, heures: 3_600_000,
  j: 86_400_000, d: 86_400_000, jour: 86_400_000, jours: 86_400_000,
  sem: 604_800_000, w: 604_800_000, semaine: 604_800_000, semaines: 604_800_000,
};
const PERMANENT = new Set(['perm', 'permanent', 'def', 'definitif', 'définitif', 'toujours']);

/**
 * Parse a moderation duration: "30m", "2h", "3j", "1sem", "90" (minutes), "perm".
 * @returns {number|null|undefined} ms, null for permanent, undefined if not a duration
 */
export function parseDuration(token) {
  if (typeof token !== 'string') return undefined;
  const t = token.trim().toLowerCase();
  if (PERMANENT.has(t)) return null;
  const m = /^(\d{1,6})([a-zé]*)$/.exec(t);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2] || 'min';
  if (!Object.prototype.hasOwnProperty.call(UNITS, unit) || n <= 0) return undefined;
  return Math.min(n * UNITS[unit], 10 * 365 * 86_400_000);
}

/** "définitivement" or "pour 2 h (encore 1 h 59 min)". */
export function banSpan(until, now) {
  return until === null ? 'définitivement' : `encore ${formatDuration(until - now)}`;
}
