// Pure XP / level arithmetic.
import { MAX_LEVEL, xpToNext } from '../../shared/data.js';

/**
 * Add `amount` XP to (level, xp). Handles several level-ups at once; at MAX_LEVEL xp stays 0.
 * Returns { level, xp, gained } where gained = number of levels gained.
 */
export function applyXp(level, xp, amount) {
  if (level >= MAX_LEVEL) return { level: MAX_LEVEL, xp: 0, gained: 0 };
  let gained = 0;
  xp += Math.max(0, Math.floor(amount));
  while (level < MAX_LEVEL && xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level++;
    gained++;
  }
  if (level >= MAX_LEVEL) xp = 0;
  return { level, xp, gained };
}
