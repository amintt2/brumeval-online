// [skilltree] Temporary states on players: ability buffs (Rage, Bastion, Armure de givre, Lame enchantée…),
// absorb shields (Égide runique, Bouclier de mana), « Contre parfait » (after a perfect dodge / parry), Hallali,
// next-hit criticals (Pas de lame). Stored in p.buffs: Map(id -> { until, stats?, … }).
import { S2C, FX } from '../../../shared/protocol.js';

/** Add (or refresh) a buff. `data.stats` = { defPct, dmgPct, attackSpeedPct, dmgTakenPct, speedPct } fractions. */
export function addBuff(game, p, id, ms, data = {}) {
  const now = game.now();
  p.buffs.set(id, { ...data, id, until: now + ms });
  if (data.stats) p.recomputeStats();
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.BUFF, src: p.id, ab: id, ms: Math.round(ms) });
}

export function removeBuff(game, p, id) {
  const b = p.buffs.get(id);
  if (!b) return null;
  p.buffs.delete(id);
  if (b.stats) p.recomputeStats();
  return b;
}

export const hasBuff = (p, id, now) => {
  const b = p.buffs?.get(id);
  return !!b && now < b.until;
};

/** Sum of a numeric buff stat over the active buffs (expiry is handled by updateBuffs). */
export function buffStat(p, name) {
  let v = 0;
  if (!p.buffs) return 0;
  for (const b of p.buffs.values()) if (b.stats && typeof b.stats[name] === 'number') v += b.stats[name];
  return v;
}

/** Any active buff carrying the flag `name` (e.g. noRoll). */
export function buffFlag(p, name) {
  if (!p.buffs) return false;
  for (const b of p.buffs.values()) if (b.flags?.[name]) return true;
  return false;
}

/** Per tick: expire buffs. */
export function updateBuffs(game, now) {
  for (const p of game.players.values()) {
    if (!p.buffs?.size) continue;
    let restat = false;
    for (const [id, b] of p.buffs) {
      if (now < b.until) continue;
      p.buffs.delete(id);
      if (b.stats) restat = true;
    }
    if (restat) p.recomputeStats();
  }
}

/** Consume « Contre parfait » (first damaging ability after a perfect dodge / parry): multipliers or null. */
export function consumeRiposte(p, now, melee) {
  const b = p.buffs?.get('riposte_parfaite');
  if (!b || now >= b.until) return null;
  p.buffs.delete('riposte_parfaite');
  return { power: melee ? b.powerMult || 1.5 : b.powerMultNonMelee || b.powerMult || 1.5, poise: b.poiseAdd || 0 };
}
