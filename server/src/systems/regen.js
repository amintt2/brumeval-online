// Player hp/mp regeneration (SPEC §4.9): combat rates for REGEN.restDelay s after damage dealt/taken.
import { REGEN } from '../../../shared/data.js';
import { stat } from '../../../shared/skills.js'; // [skilltree]

export function updateRegen(game, dt, now) {
  for (const p of game.players.values()) {
    if (p.dead) continue;
    const inCombat = now - p.lastCombat < REGEN.restDelay * 1000;
    if (p.hp < p.mhp) {
      // [skilltree] Rasoir (keystone): no out-of-combat regeneration
      const rest = p.tree && stat(p.tree, 'noOocHpRegen') ? REGEN.hpCombat : REGEN.hpRest;
      p.hp = Math.min(p.mhp, p.hp + p.mhp * (inCombat ? REGEN.hpCombat : rest) * dt);
      if (p.hpShown() !== p.sentHp) p.markDirty('hp');
    }
    if (p.mp < p.mmp) {
      const combatMp = REGEN.mpCombat * (1 + (p.tree ? stat(p.tree, 'mpRegenCombatPct') : 0)); // [skilltree] Méditation
      // [skilltree] Bouclier de mana: no mana regeneration while it is up
      if (!(p.buffs?.get('mana_shield')?.until > now)) p.mp = Math.min(p.mmp, p.mp + p.mmp * (inCombat ? combatMp : REGEN.mpRest) * dt);
      if (p.mpShown() !== p.sentMp) p.markDirty('mp');
    }
  }
}
