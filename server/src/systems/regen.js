// Player hp/mp regeneration (SPEC §4.9): combat rates for REGEN.restDelay s after damage dealt/taken.
import { REGEN } from '../../../shared/data.js';

export function updateRegen(game, dt, now) {
  for (const p of game.players.values()) {
    if (p.dead) continue;
    const inCombat = now - p.lastCombat < REGEN.restDelay * 1000;
    if (p.hp < p.mhp) {
      p.hp = Math.min(p.mhp, p.hp + p.mhp * (inCombat ? REGEN.hpCombat : REGEN.hpRest) * dt);
      if (p.hpShown() !== p.sentHp) p.markDirty('hp');
    }
    if (p.mp < p.mmp) {
      p.mp = Math.min(p.mmp, p.mp + p.mmp * (inCombat ? REGEN.mpCombat : REGEN.mpRest) * dt);
      if (p.mpShown() !== p.sentMp) p.markDirty('mp');
    }
  }
}
