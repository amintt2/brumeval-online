// [skilltree] World objects created by abilities: persistent ground zones (Mur de flammes, Nuage toxique, Pluie
// persistante, sol brûlant du Météore), ice walls (block monsters and their projectiles), traps (Piège à mâchoires),
// summons (Feu follet), ability movement of the player (leaps, lunges, blinks: server-authoritative destination),
// monster displacement (pull, knockback) and baits (Appât).
import { S2C, FX, PLAYER_RADIUS } from '../../../shared/protocol.js';
import { isWalkable, WORLD_LIMIT } from '../../../shared/world.js';
import { MAX_PENETRATION } from '../config.js';
import { dist, round2, round3 } from '../util.js';
import { applyStatus } from './status.js';

let seq = 0;
const zonesOf = (game) => (game.zones ||= new Map());

// ------------------------------------------------------------------ ground zones
/**
 * Persistent (or delayed) ground zone. sh = { shape, x, z, r?, r2?, a?, len?, w? }.
 * opts = { delay, now, impactOnly } — impactOnly: only the visual (the impact is resolved by the caller).
 */
export function addZone(game, p, spec, sh, opts = {}) {
  const now = opts.now ?? game.now();
  const id = ++seq;
  const delay = opts.delay || 0;
  const durMs = opts.impactOnly ? 0 : Math.round((spec.duration || 3) * 1000);
  const tickMs = Math.round((spec.tick || (spec.ticks ? (spec.duration || 3) / spec.ticks : 1)) * 1000);
  const z = {
    id, owner: p.id, spec, sh, start: now + delay, until: now + delay + durMs, next: now + delay + (opts.impactOnly ? 0 : tickMs), tickMs,
    impactOnly: !!opts.impactOnly,
  };
  const msg = { t: S2C.FX, k: FX.ZONE, id, src: p.id, ab: spec.id, shape: sh.shape, x: round2(sh.x), z: round2(sh.z), ms: durMs || delay };
  if (sh.r !== undefined) msg.r = round2(sh.r);
  if (sh.r2) msg.r2 = round2(sh.r2);
  if (sh.a !== undefined) msg.a = round3(sh.a);
  if (sh.len) msg.len = round2(sh.len);
  if (sh.w) msg.w = round2(sh.w);
  if (delay) msg.delay = delay;
  game.broadcastNear(sh.x, sh.z, msg);
  if (!opts.impactOnly) zonesOf(game).set(id, z);
  else game.schedule(delay, () => game.broadcastNear(sh.x, sh.z, { t: S2C.FX, k: FX.ZONE_END, id }));
  return z;
}

let areaImpact = null;
let monstersInShape = null;
let strikeHook = null;
/** abilities.js registers its area resolution (avoids an import cycle). */
export function setZoneHooks(h) {
  areaImpact = h.areaImpact;
  monstersInShape = h.monstersInShape;
  strikeHook = h.strike;
}

/** Per tick: zone ticks, walls and traps expiry / triggers, summons. */
export function updateZones(game, now) {
  const zones = zonesOf(game);
  for (const z of zones.values()) {
    const p = game.players.get(z.owner);
    if (z.kind === 'wall') {
      if (now >= z.until) endZone(game, z);
      continue;
    }
    if (z.kind === 'trap') {
      tickTrap(game, z, p, now);
      continue;
    }
    if (!p || p.dead || now >= z.until) {
      endZone(game, z);
      continue;
    }
    while (now >= z.next && z.next <= z.until) {
      z.next += z.tickMs;
      zoneTick(game, p, z, now);
    }
  }
  for (const p of game.players.values()) if (p.summon) tickSummon(game, p, now);
}

function zoneTick(game, p, z, now) {
  const spec = z.spec;
  // Nuage toxique: poison stacks + weaker enemies inside
  if (spec.id === 'nuage_toxique') {
    for (const m of monstersInShape(game, z.sh)) {
      applyStatus(game, m, p, 'poison', { stacks: Math.max(1, Math.round((spec.poisonPerS || 1) * (z.tickMs / 1000))), atk: p.stats.atk, dur: 6 });
      m.status.cloudUntil = now + z.tickMs + 100;
      m.status.cloudMod = spec.dmgDealtMod ?? -0.1;
      m.status.cloudAtk = spec.enemyAtkSpeed || 0; // Brume étouffante: −25 % attack speed → wind-ups ×1.25
    }
    return;
  }
  const per = spec.ticks ? spec.power : spec.power;
  areaImpact?.(game, p, spec, z.sh, now, per || 0.0001);
}

export function endZone(game, z) {
  const zones = zonesOf(game);
  if (!zones.delete(z.id)) return;
  game.broadcastNear(z.sh.x, z.sh.z, { t: S2C.FX, k: FX.ZONE_END, id: z.id });
}

// ------------------------------------------------------------------ ice walls
/** Mur de glace: a segment (length len) centred on (x, z) along angle `a`, lasting spec.duration. */
export function addWall(game, p, spec, x, z, a, now) {
  const len = spec.len || 6;
  const hx = (Math.sin(a) * len) / 2, hz = (Math.cos(a) * len) / 2;
  const id = ++seq;
  const w = { id, kind: 'wall', owner: p.id, spec, ax: x - hx, az: z - hz, bx: x + hx, bz: z + hz, wid: spec.wid || 1.2, until: now + (spec.duration || 6) * 1000, sh: { x, z } };
  zonesOf(game).set(id, w);
  game.broadcastNear(x, z, { t: S2C.FX, k: FX.TRAP, id, src: p.id, ab: spec.id, x: round2(x), z: round2(z), a: round3(a), len, ms: Math.round((spec.duration || 6) * 1000) });
  return w;
}

function segInter(ax, az, bx, bz, cx, cz, dx, dz) {
  const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false;
  const u = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d;
  const v = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

/** Does a straight move / flight from a to b cross an ice wall? (monsters and their projectiles are stopped) */
export function wallBlocks(game, ax, az, bx, bz) {
  const zones = game.zones;
  if (!zones || !zones.size) return false;
  for (const w of zones.values()) {
    if (w.kind !== 'wall') continue;
    if (segInter(ax, az, bx, bz, w.ax, w.az, w.bx, w.bz)) return true;
  }
  return false;
}

// ------------------------------------------------------------------ traps
/** Piège à mâchoires: armed after `arm` s, bites the first monster in radius (root, damage), max `maxActive`. */
export function addTrap(game, p, spec, x, z, now) {
  const zones = zonesOf(game);
  const mine = [...zones.values()].filter((t) => t.kind === 'trap' && t.owner === p.id);
  while (mine.length >= (spec.maxActive || 2)) endZone(game, mine.shift());
  const id = ++seq;
  const t = { id, kind: 'trap', owner: p.id, spec, x, z, armAt: now + (spec.arm || 1) * 1000, until: now + (spec.lifetime || 30) * 1000, sh: { x, z } };
  zones.set(id, t);
  game.broadcastNear(x, z, { t: S2C.FX, k: FX.TRAP, id, src: p.id, ab: spec.id, x: round2(x), z: round2(z), ms: Math.round((spec.lifetime || 30) * 1000) });
  return t;
}

function tickTrap(game, t, p, now) {
  if (!p || now >= t.until) return endZone(game, t);
  if (now < t.armAt) return;
  const r = t.spec.radius || 1.2;
  let victim = null;
  for (const m of game.monsters.values()) {
    if (m.dead || m.invulnerable) continue;
    if (dist(t.x, t.z, m.x, m.z) <= r + m.radius) { victim = m; break; }
  }
  if (!victim) return;
  endZone(game, t);
  const spec = t.spec;
  const list = r > 2 ? [...game.monsters.values()].filter((m) => !m.dead && !m.invulnerable && dist(t.x, t.z, m.x, m.z) <= r + m.radius) : [victim];
  game.broadcastNear(t.x, t.z, { t: S2C.FX, k: FX.AOE, src: p.id, x: round2(t.x), z: round2(t.z), r, ab: spec.id });
  for (const m of list) {
    strikeHook?.(game, p, m, spec.power || 1.5, spec, now);
    if (m.dead) continue;
    if (spec.root > 0) {
      if (m.boss) applyStatus(game, m, p, 'slow', { pct: spec.bossSlow || 0.4, dur: spec.root });
      else applyStatus(game, m, p, 'enracine', { dur: spec.root, durElite: spec.rootElite || 1 });
    }
    if (spec.slow) applyStatus(game, m, p, 'slow', { pct: spec.slow.pct, dur: spec.slow.dur || 4 });
    // Piège de ronces: bleed per second while it lasts
    if (spec.bleedPerS > 0) applyStatus(game, m, p, 'saignement', { hit: spec.bleedPerS * 4, total: 1, dur: 4 });
  }
}

// ------------------------------------------------------------------ summons
/** Feu follet: fires a small bolt at the player's target every `period` s for `duration` s. */
export function setSummon(game, p, spec, now) {
  p.summon = { spec, until: now + (spec.duration || 15) * 1000, next: now + (spec.period || 1.5) * 1000 };
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.BUFF, src: p.id, ab: spec.id, ms: Math.round((spec.duration || 15) * 1000) });
}

function tickSummon(game, p, now) {
  const s = p.summon;
  if (p.dead || now >= s.until) { p.summon = null; return; }
  if (now < s.next) return;
  s.next += (s.spec.period || 1.5) * 1000;
  if (!(s.spec.power > 0)) return;
  const t = game.monsters.get(p.autoTarget || p.lastTargetId || 0);
  if (!t || t.dead || t.invulnerable || dist(p.x, p.z, t.x, t.z) > (s.spec.range || 16)) return;
  const ms = Math.max(30, Math.round((dist(p.x, p.z, t.x, t.z) / 18) * 1000));
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.PROJ, src: p.id, tg: t.id, ab: s.spec.id, ms });
  game.schedule(ms, () => {
    if (t.dead || game.players.get(p.id) !== p) return;
    strikeHook?.(game, p, t, s.spec.power, s.spec, game.now(), { noRiposte: true });
  });
}

// ------------------------------------------------------------------ player ability movement
/**
 * Move the player to (x, z) over `ms` (leap, lunge, blink…). The destination is clamped by the scenery on the server;
 * the movement validator gets the allowance (maxSpeedAt), and the position is set at arrival (+ `correct`).
 * opts = { ab, iframeMs, airborne }. onArrive(x, z) runs at arrival.
 */
export function dashPlayer(game, p, tx, tz, ms, opts = {}, onArrive = null) {
  const now = game.now();
  const dest = clampPath(game, p.x, p.z, tx, tz);
  const d = dist(p.x, p.z, dest.x, dest.z);
  const dur = Math.max(0, ms);
  p.dashUntil = now + dur;
  p.dashSpeed = dur > 0 ? d / (dur / 1000) : 0;
  if (opts.iframeMs > 0) p.iframeUntil = Math.max(p.iframeUntil || 0, now + opts.iframeMs);
  if (opts.airborne) {
    p.airFrom = now;
    p.airUntil = now + dur;
  }
  p.moveUntil = Math.max(p.moveUntil, now + dur);
  p.ry = Math.atan2(tx - p.x, tz - p.z);
  game.broadcastNear(p.x, p.z, { t: S2C.FX, k: FX.DASH, src: p.id, x: round2(dest.x), z: round2(dest.z), ms: dur, ab: opts.ab });
  const arrive = () => {
    if (p.dead || game.players.get(p.id) !== p) return;
    p.x = dest.x;
    p.z = dest.z;
    p.mv.reset(p.x, p.z, game.now());
    game.sendCorrect(p, true);
    onArrive?.(p.x, p.z);
  };
  if (dur > 0) game.schedule(dur, arrive);
  else arrive();
  return dest;
}

/** Last free point on the straight path (walkable, not inside an obstacle). */
export function clampPath(game, x0, z0, x1, z1) {
  const d = dist(x0, z0, x1, z1);
  const steps = Math.max(1, Math.ceil(d / 0.25));
  let bx = x0, bz = z0;
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps, z = z0 + ((z1 - z0) * i) / steps;
    if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT || !isWalkable(x, z)) break;
    if (game.collision.penetration(x, z, PLAYER_RADIUS) >= MAX_PENETRATION) break;
    if (wallBlocks(game, bx, bz, x, z)) break;
    bx = x; bz = z;
  }
  return { x: bx, z: bz };
}

/** Knockback (d > 0: away from (x, z)) or pull (d < 0: towards it) of a monster, clamped by the scenery. */
export function pushMonster(game, m, x, z, d) {
  if (m.dead || m.boss) return;
  const a = Math.atan2(m.x - x, m.z - z);
  const cur = dist(m.x, m.z, x, z);
  const len = d < 0 ? -Math.min(-d, Math.max(0, cur - m.radius - PLAYER_RADIUS - 0.3)) : d;
  const r = game.collision.move(m.x, m.z, m.x + Math.sin(a) * len, m.z + Math.cos(a) * len, m.radius);
  if (!isWalkable(r.x, r.z)) return;
  m.x = r.x;
  m.z = r.z;
}

/** Appât: beasts within the radius fixate on the bait for `duration` s (elites half, bosses immune). */
const BEASTS = new Set(['wolf', 'slime']);
export function baitMonsters(game, p, x, z, spec, now) {
  const r = spec.radius || 12;
  game.broadcastNear(x, z, { t: S2C.FX, k: FX.ZONE, id: ++seq, src: p.id, ab: spec.id, shape: 'circle', x: round2(x), z: round2(z), r: 0.8, ms: Math.round((spec.duration || 3) * 1000) });
  for (const m of game.monsters.values()) {
    if (m.dead || m.boss || !BEASTS.has(m.type) || dist(x, z, m.x, m.z) > r) continue;
    m.bait = { x, z, until: now + (spec.duration || 3) * 1000 * (m.elite ? 0.5 : 1) };
  }
  if (spec.explode) {
    game.schedule((spec.duration || 3) * 1000, () => {
      for (const m of [...game.monsters.values()].filter((o) => !o.dead && dist(x, z, o.x, o.z) <= (spec.explode.radius || 3) + o.radius)) {
        strikeHook?.(game, p, m, spec.explode.power || 1.2, spec, game.now(), { noRiposte: true });
        if (spec.explode.poisonStacks && !m.dead) applyStatus(game, m, p, 'poison', { stacks: spec.explode.poisonStacks, atk: p.stats.atk, dur: 6 });
      }
    });
  }
}
