// [combat-souls] Boss phases. MONSTERS[type].ai.phases = hp thresholds, e.g. [0.66, 0.3]:
//   phase 1 (above 66 %) → phase 2 (new attacks unlock: attacks with `phase: 2`) → phase 3 = enrage
//   (faster, shorter cooldowns and wind-ups, combos). Each transition cancels the current attack, plays the
//   Special clip (FX phase) and tells the players in the fight.
import { S2C, FX } from '../../../../shared/protocol.js';
import { cancelTelegraphs } from './actions.js';

const PHASE_MS = 1900;

const PHASE_TEXT = {
  2: (n) => `${n} arrache des rochers du sol !`,
  3: (n) => `${n} entre dans une rage furieuse !`,
};

/** Phase that matches the current hp ratio. */
export function phaseFor(m) {
  const th = m.brain?.phases;
  if (!th) return 1;
  const ratio = m.hp / m.mhp;
  let ph = 1;
  th.forEach((t, i) => { if (ratio <= t) ph = i + 2; });
  return ph;
}

/** Called every combat tick: advance to the next phase when the hp threshold is crossed. */
export function checkPhase(game, m, now) {
  if (!m.brain?.phases) return false;
  const want = phaseFor(m);
  if (want <= m.phase) return false;
  m.phase = want;
  const last = m.brain.phases.length + 1;
  m.enraged = want >= last;
  cancelTelegraphs(game, m);
  m.dash = null;
  m.act = { kind: 'phase', until: now + PHASE_MS };
  m.poiseDmg = 0;
  game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.PHASE, src: m.id, ph: want, ms: PHASE_MS });
  const text = PHASE_TEXT[Math.min(want, 3)]?.(m.name);
  if (text) {
    for (const id of m.threat.keys()) {
      const p = game.players.get(id);
      if (p) game.notify(p, 'error', text);
    }
  }
  return true;
}
