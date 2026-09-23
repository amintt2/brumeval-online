// Player-side game rules: XP & level-ups, healing, death/respawn, loot delivery.
import { MAX_LEVEL } from '../../../shared/data.js';
import { S2C, FX } from '../../../shared/protocol.js';
import { SPAWN_POINT } from '../../../shared/world.js';
import { applyXp } from '../progression.js';
import { addItem, formatItem } from '../inventory.js';
import { round2 } from '../util.js';
import { closeDialog } from './npc.js';

/** Give XP (handles several level-ups at once; no XP at max level). */
export function grantXp(game, p, amount) {
  amount = Math.floor(amount);
  if (!(amount > 0) || p.level >= MAX_LEVEL) return;
  const r = applyXp(p.level, p.xp, amount);
  game.notify(p, 'xp', `+${amount} XP`);
  p.xp = r.xp;
  p.markDirty('xp');
  if (r.gained > 0) {
    p.level = r.level;
    p.staticVer++;               // `lv` changed -> resend static fields to every client
    p.recomputeStats();
    if (!p.dead) {
      p.hp = p.mhp;
      p.mp = p.mmp;
    }
    p.markDirty('level', 'xpNext', 'hp', 'mp', 'mhp', 'mmp', 'stats');
    game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.LEVEL, src: p.id });
    game.notify(p, 'level', `Niveau ${p.level} atteint !`);
    game.systemChat(`${p.name} a atteint le niveau ${p.level} !`);
    game.log.info(`${p.name} atteint le niveau ${p.level}`);
    game.store?.markDirty();
  }
}

/** Heal a player by `amount` (clamped), broadcasting `heal` + fx HEAL. Returns the amount really healed. */
export function healPlayer(game, p, amount, abId) {
  if (p.dead) return 0;
  const before = p.hp;
  p.hp = Math.min(p.mhp, p.hp + amount);
  const v = Math.round(p.hp - before);
  p.markDirty('hp');
  game.broadcastNear(p.x, p.z, { t: S2C.HEAL, tg: p.id, v, hp: p.hpShown() });
  const fx = { t: S2C.FX, k: FX.HEAL, tg: p.id };
  if (abId) fx.ab = abId;
  game.broadcastNear(p.x, p.z, fx);
  return v;
}

/** Monster (or other source) damages a player. */
export function damagePlayer(game, p, src, amount, crit, abId) {
  if (p.dead) return;
  p.hp -= amount;
  p.lastCombat = game.now();
  p.markDirty('hp');
  const msg = { t: S2C.DMG, src: src ? src.id : 0, tg: p.id, v: amount, crit: !!crit, hp: p.hp <= 0 ? 0 : Math.max(1, Math.ceil(p.hp)) };
  if (abId) msg.ab = abId;
  game.broadcastNear(p.x, p.z, msg);
  if (p.hp <= 0) killPlayer(game, p, src);
}

export function killPlayer(game, p, killer) {
  if (p.dead) return;
  p.dead = true;
  p.hp = 0;
  p.autoTarget = 0;
  p.markDirty('dead', 'hp');
  game.broadcastNear(p.x, p.z, { t: S2C.DEATH, id: p.id, by: killer ? killer.id : 0 });
  game.notify(p, 'error', killer ? `Vous avez été vaincu par ${killer.name}.` : 'Vous êtes mort.');
  closeDialog(game, p);
  for (const m of game.monsters.values()) {
    m.threat.delete(p.id);
    if (m.target === p.id) m.target = 0;
  }
}

/** C2S respawn: only while dead; back to SPAWN_POINT with full hp/mp. */
export function handleRespawn(game, p) {
  if (!p.dead) return;
  const now = game.now();
  p.dead = false;
  p.hp = p.mhp;
  p.mp = p.mmp;
  p.x = SPAWN_POINT.x;
  p.z = SPAWN_POINT.z;
  p.ry = SPAWN_POINT.ry;
  p.mv.reset(p.x, p.z, now);
  p.moveUntil = 0;
  p.lastCombat = -Infinity;
  p.markDirty('dead', 'hp', 'mp', 'x', 'z', 'ry');
  game.sendCorrect(p, true);
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.RESPAWN, src: p.id });
  game.notify(p, 'info', 'Vous êtes de retour au village de Brumeval.');
}

/**
 * Put loot into the inventory. What does not fit is lost (with a notify).
 * Returns the quantity added.
 */
export function giveItem(game, p, id, qty) {
  const added = addItem(p.inv, id, qty);
  if (added > 0) {
    p.markDirty('inv');
    game.notify(p, 'loot', `Vous avez obtenu : ${formatItem(id, added)}`);
  }
  if (added < qty) game.notify(p, 'error', `Inventaire plein — objet perdu : ${formatItem(id, qty - added)}`);
  return added;
}

export function giveGold(game, p, amount) {
  if (!(amount > 0)) return;
  p.gold += amount;
  p.markDirty('gold');
  game.notify(p, 'gold', `+${amount} pièce${amount > 1 ? 's' : ''} d'or`);
}

export const correctMsg = (p) => ({ t: S2C.CORRECT, x: round2(p.x), z: round2(p.z) });
