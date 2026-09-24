// [skilltree] Statuses on monsters (skilltree.json › statuses; docs/design/ARBRE_COMPETENCES.md §11):
//   brulure  30 % of the triggering hit over 3 s (0.5 s ticks), a stronger burn replaces a weaker one
//   froid    stacks (max 3), 3 s: −15 % move speed and −10 % attack speed per stack (boss: half)
//   gel      frozen 1–1.2 s (attack cancelled), then 8 s immunity; never on a boss
//   enracine cannot move (can still attack), then 8 s immunity; bosses get 2 Froid stacks instead
//   etourdi  stunned (attack cancelled), then 8 s immunity; never on a boss (only poise)
//   poison   stacks (3, 6 with « Vénéneux »): each 25 % of the caster's attack per second for 6 s, no poise
//   saignement (1) wounds: a % of the hit over a few seconds; (2) haemorrhage gauge: at 100 it bursts
//            (×1.5 of the hit + 6 % max hp; boss 2 %) and empties; it drains 10/s after 3 s without a new cut
//   marque   +x % damage taken from the marker · aveugle −20 % damage dealt · slow (filet) −x % move speed
//   debuff   defence −x % (Brise-garde), frontal guard removed
// DoT damage goes through damageMonster (threat, death, XP) without poise.
import { S2C, FX } from '../../../shared/protocol.js';
import { POISE } from '../../../shared/combat.js';

const TICK_MS = 500;
const CC_IMMUNITY_MS = 8000;
export const STATUS_FLAGS = { brulure: 1, froid: 2, gel: 4, enracine: 8, poison: 16, saignement: 32, marque: 64, etourdi: 128, aveugle: 256 };

let damageHook = null;
let staggerHook = null;
/** combat.js registers its damage function (avoids an import cycle). */
export function setStatusHooks({ damage, stagger }) {
  damageHook = damage;
  staggerHook = stagger;
}

function st(m) {
  if (!m.status) m.status = { poison: [], dots: [], bleedGauge: 0, bleedAt: -Infinity };
  return m.status;
}

const fx = (game, m, id, ms, n) => {
  const msg = { t: S2C.FX, k: FX.STATUS, tg: m.id, st: id, ms: Math.round(ms) };
  if (n) msg.n = n;
  game.broadcastNear(m.x, m.z, msg);
};

/**
 * Apply a status to monster `m` from player `src`. opts depend on the status:
 *   brulure { hit, pct?, dur? } · froid { stacks?, dur? } · gel { dur? } · enracine { dur? } · etourdi { dur? }
 *   poison { stacks?, perStackPerS?, dur?, atk, max? } · saignement { hit, total, dur } (wound)
 *   bleedBuild { add, hit } (gauge) · marque { pct, dur } · aveugle { dur } · slow { pct, dur } · debuff { defPct, dur, breakGuard }
 * Returns true when something was applied.
 */
export function applyStatus(game, m, src, id, opts = {}) {
  if (!m || m.dead || m.invulnerable) return false;
  const now = game.now();
  const s = st(m);
  const boss = !!m.boss;
  switch (id) {
    case 'brulure': {
      const dur = (opts.dur ?? 3) * 1000;
      const total = Math.max(1, (opts.hit || 0) * (opts.pct ?? 0.3));
      const dps = total / (dur / 1000);
      if (s.burn && now < s.burn.until && s.burn.dps >= dps) return false;
      s.burn = { dps, until: now + dur, next: now + TICK_MS, src: src?.id || 0 };
      fx(game, m, id, dur);
      return true;
    }
    case 'froid': {
      const dur = (opts.dur ?? 3) * 1000;
      const max = opts.max ?? 3;
      const n = Math.min(max, (s.froid && now < s.froid.until ? s.froid.n : 0) + (opts.stacks ?? 1));
      s.froid = { n, until: now + dur };
      m.slowUntil = Math.max(m.slowUntil || 0, now + dur); // EntState.sl
      fx(game, m, id, dur, n);
      if (opts.toGel && n >= (opts.toGel.stacks || 3) && !boss) {
        s.froid = null;
        applyStatus(game, m, src, 'gel', { dur: opts.toGel.durS || 1.2 });
      }
      return true;
    }
    case 'gel':
    case 'etourdi': {
      if (boss) return false; // bosses are never frozen / stunned (only poise)
      const immKey = id === 'gel' ? 'gelImm' : 'stunImm';
      if (now < (s[immKey] || 0)) return false;
      const dur = (opts.dur ?? (id === 'gel' ? 1.1 : 1)) * 1000;
      s[id === 'gel' ? 'gel' : 'stun'] = { until: now + dur };
      s[immKey] = now + dur + CC_IMMUNITY_MS;
      staggerHook?.(game, m, dur, now);
      fx(game, m, id, dur);
      return true;
    }
    case 'enracine': {
      if (boss) return applyStatus(game, m, src, 'froid', { stacks: 2 });
      if (now < (s.rootImm || 0)) return false;
      const dur = (m.elite && opts.durElite ? opts.durElite : opts.dur ?? 1.5) * 1000;
      s.root = { until: now + dur };
      s.rootImm = now + dur + CC_IMMUNITY_MS;
      fx(game, m, id, dur);
      return true;
    }
    case 'poison': {
      const dur = (opts.dur ?? 6) * 1000;
      const max = opts.max ?? 3;
      const dps = (opts.atk || 0) * (opts.perStackPerS ?? 0.25);
      s.poison = s.poison.filter((x) => now < x.until);
      for (let i = 0; i < (opts.stacks ?? 1); i++) {
        if (s.poison.length >= max) s.poison.shift(); // the oldest stack is refreshed
        s.poison.push({ dps, until: now + dur, next: now + 1000, src: src?.id || 0 });
      }
      fx(game, m, id, dur, s.poison.length);
      return true;
    }
    case 'saignement': {
      const dur = (opts.dur ?? 6) * 1000;
      const total = Math.max(1, (opts.hit || 0) * (opts.total ?? 1));
      s.dots.push({ kind: 'saignement', dps: total / (dur / 1000), until: now + dur, next: now + TICK_MS, src: src?.id || 0 });
      fx(game, m, id, dur);
      return true;
    }
    case 'bleedBuild': {
      s.bleedGauge = (now - s.bleedAt > 3000 ? Math.max(0, s.bleedGauge - ((now - s.bleedAt - 3000) / 1000) * 10) : s.bleedGauge) + (opts.add || 0);
      s.bleedAt = now;
      if (s.bleedGauge >= 100) {
        s.bleedGauge = 0;
        const burst = Math.round((opts.hit || 0) * 1.5 + m.mhp * (boss ? 0.02 : 0.06));
        fx(game, m, 'saignement', 0, 100);
        if (src && damageHook) damageHook(game, m, src, burst, false, 'saignement', 0);
        return true;
      }
      return false;
    }
    case 'marque': {
      // one mark per player at a time
      if (src) for (const o of game.monsters.values()) if (o.status?.mark?.src === src.id && o !== m) o.status.mark = null;
      s.mark = { src: src?.id || 0, pct: opts.pct ?? 0.15, until: now + (opts.dur ?? 15) * 1000 };
      fx(game, m, id, (opts.dur ?? 15) * 1000);
      return true;
    }
    case 'aveugle':
      s.blind = { until: now + (opts.dur ?? 3) * 1000 };
      fx(game, m, id, (opts.dur ?? 3) * 1000);
      return true;
    case 'slow': {
      const dur = (opts.dur ?? 3) * 1000;
      s.slow = { pct: Math.min(0.9, opts.pct ?? 0.5) * (boss ? 0.5 : 1), until: now + dur };
      m.slowUntil = Math.max(m.slowUntil || 0, now + dur);
      return true;
    }
    case 'debuff': {
      s.debuff = { defPct: opts.defPct || 0, breakGuard: !!opts.breakGuard, until: now + (opts.dur ?? 6) * 1000 };
      return true;
    }
    default:
      return false;
  }
}

/** Movement speed multiplier (0 = cannot move). */
export function moveMult(m, now) {
  const s = m.status;
  if (!s) return 1;
  if ((s.gel && now < s.gel.until) || (s.stun && now < s.stun.until) || (s.root && now < s.root.until)) return 0;
  let k = 1;
  if (s.froid && now < s.froid.until) k *= 1 - 0.15 * s.froid.n * (m.boss ? 0.5 : 1);
  if (s.slow && now < s.slow.until) k *= 1 - s.slow.pct;
  if (m.baitSlow && now < m.baitSlow.until) k *= 1 - m.baitSlow.pct;
  return Math.max(0, k);
}

/** Attack speed factor applied to wind-ups (Froid: +10 % per stack, boss half). */
export function windupMult(m, now) {
  const s = m.status;
  if (!s?.froid || now >= s.froid.until) return 1;
  return 1 + 0.1 * s.froid.n * (m.boss ? 0.5 : 1);
}

/** Damage dealt multiplier (Aveuglé −20 %, toxic cloud −10 %). */
export function dealtMult(m, now) {
  const s = m.status;
  let k = 1;
  if (s?.blind && now < s.blind.until) k *= 0.8;
  if (s?.cloudUntil && now < s.cloudUntil) k *= 1 + (s.cloudMod || -0.1);
  return k;
}

/** Extra damage taken from `attacker` (Marque) and defence multiplier (Brise-garde). */
export function takenMult(m, attacker, now) {
  const s = m.status;
  if (!s?.mark || now >= s.mark.until || !attacker || s.mark.src !== attacker.id) return 1;
  return 1 + s.mark.pct;
}
export function defMult(m, now) {
  const s = m.status;
  return s?.debuff && now < s.debuff.until ? Math.max(0, 1 + s.debuff.defPct) : 1;
}
export const guardBroken = (m, now) => !!(m.status?.debuff && now < m.status.debuff.until && m.status.debuff.breakGuard);
export const froidStacks = (m, now) => (m.status?.froid && now < m.status.froid.until ? m.status.froid.n : 0);
export const isFrozen = (m, now) => !!(m.status?.gel && now < m.status.gel.until);
export const hasStatus = (m, id, now) => !!(statusFlags(m, now) & (STATUS_FLAGS[id] || 0));
export function consumeFroid(m) { if (m.status) m.status.froid = null; }

/** Remaining poison damage (Fléau) and burn damage (Embrasement) — then removed. */
export function detonate(m, now, what) {
  const s = m.status;
  if (!s) return 0;
  let total = 0;
  if (what === 'poison') {
    for (const x of s.poison) if (now < x.until) total += (x.dps * (x.until - now)) / 1000;
    s.poison = [];
  } else if (what === 'brulure' && s.burn && now < s.burn.until) {
    total = (s.burn.dps * (s.burn.until - now)) / 1000;
    s.burn = null;
  }
  return total;
}
export const poisonStacks = (m, now) => (m.status?.poison || []).filter((x) => now < x.until).length;

/** EntState.stt bit flags. */
export function statusFlags(m, now) {
  const s = m.status;
  if (!s) return 0;
  let f = 0;
  if (s.burn && now < s.burn.until) f |= 1;
  if (s.froid && now < s.froid.until) f |= 2;
  if (s.gel && now < s.gel.until) f |= 4;
  if (s.root && now < s.root.until) f |= 8;
  if (s.poison.some((x) => now < x.until)) f |= 16;
  if (s.dots.some((x) => now < x.until) || s.bleedGauge > 0) f |= 32;
  if (s.mark && now < s.mark.until) f |= 64;
  if (s.stun && now < s.stun.until) f |= 128;
  if (s.blind && now < s.blind.until) f |= 256;
  return f;
}

/** Per tick: DoTs, expiries. */
export function updateStatuses(game, now) {
  for (const m of game.monsters.values()) {
    const s = m.status;
    if (!s || m.dead) continue;
    if (m.invulnerable) { m.status = null; continue; } // leashing home: cleansed
    const src = (id) => game.players.get(id) || null;
    if (s.burn && now >= s.burn.next) {
      if (now >= s.burn.until + 1) s.burn = null;
      else {
        s.burn.next += TICK_MS;
        const p = src(s.burn.src);
        if (p && damageHook) damageHook(game, m, p, Math.max(1, Math.round((s.burn.dps * TICK_MS) / 1000)), false, 'brulure', 0);
      }
    }
    if (m.dead) continue;
    if (s.poison.length) {
      let dmg = 0, from = 0;
      for (const x of s.poison) {
        if (now >= x.next && now <= x.until + 1) { x.next += 1000; dmg += x.dps; from = x.src; }
      }
      s.poison = s.poison.filter((x) => now < x.until);
      const p = dmg > 0 ? src(from) : null;
      if (p && damageHook) damageHook(game, m, p, Math.max(1, Math.round(dmg * (m.poisonTakenMult || 1))), false, 'poison', 0);
    }
    if (m.dead) continue;
    if (s.dots.length) {
      for (const d of s.dots) {
        if (now < d.next || now > d.until + 1) continue;
        d.next += TICK_MS;
        const p = src(d.src);
        if (p && damageHook && !m.dead) damageHook(game, m, p, Math.max(1, Math.round((d.dps * TICK_MS) / 1000)), false, d.kind, 0);
      }
      s.dots = s.dots.filter((d) => now < d.until);
    }
    if (s.bleedGauge > 0 && now - s.bleedAt > 3000) {
      s.bleedGauge = Math.max(0, s.bleedGauge - 10 / 20);
    }
  }
}

/** Stun / freeze: the current attack is cancelled like a stagger (no poise hyper-armor). */
export function stunMonster(game, m, ms, now, cancel) {
  cancel?.(game, m);
  m.dash = null;
  m.act = { kind: 'stagger', until: now + ms };
  game.broadcastNear(m.x, m.z, { t: S2C.FX, k: FX.STAGGER, src: m.id, ms: Math.round(ms) });
}

export { POISE };
