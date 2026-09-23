// [combat-souls] Death echo (ROADMAP §4.3): on death the XP of the current level is dropped at the death spot
// as an entity of kind 'echo' only its owner sees. Walking over it restores the XP; dying again before that
// destroys it for good. Persisted with the account (`account.echo = { x, z, xp } | null`).
import { MAX_LEVEL } from '../../../shared/data.js';
import { S2C, FX } from '../../../shared/protocol.js';
import { ECHO } from '../../../shared/combat.js';
import { isWalkable } from '../../../shared/world.js';
import { Echo } from '../entities/echo.js';
import { round2 } from '../util.js';
import { grantXp } from './players.js';

const MAX_ECHO_XP = 10_000_000;

/** Validate a persisted echo (null when absent or unusable). */
export function sanitizeEcho(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { x, z } = raw;
  const xp = Math.floor(Number(raw.xp));
  if (!Number.isFinite(x) || !Number.isFinite(z) || !isWalkable(x, z)) return null;
  if (!(xp > 0) || xp > MAX_ECHO_XP) return null;
  return { x: round2(x), z: round2(z), xp };
}

function persist(game, p) {
  p.account.echo = p.echo ? { ...p.echo } : null;
  p.markDirty('echo');
  game.store?.markDirty();
}

export function spawnEchoEntity(game, p) {
  removeEchoEntity(game, p);
  if (!p.echo) return null;
  const e = new Echo(game.allocId(), p, p.echo.x, p.echo.z, p.echo.xp);
  game.addEntity(e);
  p.echoEnt = e;
  return e;
}

export function removeEchoEntity(game, p) {
  if (!p.echoEnt) return;
  game.removeEntity(p.echoEnt);
  p.echoEnt = null;
}

/** Login: bring back the persisted echo. */
export function restoreEcho(game, p) {
  if (p.echo) spawnEchoEntity(game, p);
}

/** Death: the previous echo is lost, the XP of the current level becomes the new echo. */
export function dropEcho(game, p) {
  const lost = p.echo;
  if (lost) {
    removeEchoEntity(game, p);
    game.notify(p, 'error', `Votre écho précédent s'est dissipé à jamais (${lost.xp} XP perdus).`);
  }
  p.echo = null;
  if (p.xp > 0 && p.level < MAX_LEVEL) {
    p.echo = { x: round2(p.x), z: round2(p.z), xp: p.xp };
    p.xp = 0;
    p.markDirty('xp');
    spawnEchoEntity(game, p);
    game.notify(p, 'info', `Votre écho (${p.echo.xp} XP) repose là où vous êtes tombé. Retrouvez-le avant de mourir à nouveau !`);
  }
  if (lost || p.echo) persist(game, p);
}

/** Owner walks over the echo: XP restored. */
export function recoverEcho(game, p) {
  const e = p.echo;
  if (!e) return;
  p.echo = null;
  removeEchoEntity(game, p);
  persist(game, p);
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.ECHO, src: p.id, v: e.xp });
  game.notify(p, 'info', 'Écho récupéré : votre expérience vous revient.');
  grantXp(game, p, e.xp);
}

export function updateEchoes(game) {
  for (const p of game.players.values()) {
    const e = p.echo;
    if (!e || p.dead) continue;
    const dx = p.x - e.x, dz = p.z - e.z;
    if (dx * dx + dz * dz <= ECHO.pickupR * ECHO.pickupR) recoverEcho(game, p);
  }
}
