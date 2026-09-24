// Local player movement: client-simulated with the same CollisionWorld as the server, camera-relative input,
// smooth facing, `move` messages at most MOVE_SEND_HZ while moving and once when stopping.
// [combat-souls] + dodge roll (Space), sprint (Shift), stamina prediction and attack recovery (commitment), all
// mirroring the server rules of shared/combat.js so that the server never has to correct a legitimate move.
import { C2S, MOVE_SEND_HZ, PLAYER_RADIUS } from '@shared/protocol.js';
import { STAMINA, ROLL, ROLL_SPEED, COMMIT, regenStamina } from '@shared/combat.js';
import { angleDelta } from '../state.js';

const SEND_MS = 1000 / MOVE_SEND_HZ;
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

export class LocalPlayer {
  constructor(collision, send) {
    this.collision = collision;
    this.send = send;
    this.x = 0; this.z = 0; this.ry = 0;
    this.targetRy = 0;
    this.moving = false;
    this.lastSendAt = 0;
    this.sentX = NaN; this.sentZ = NaN; this.sentRy = NaN;
    this.faceDirty = false;
    this._f = { x: 0, z: 0 };
    // [combat-souls]
    this.st = STAMINA.max;
    this.mst = STAMINA.max;
    // [skilltree] Roulade / Sprint are learnt in the tree (level 1: neither); main.js plugs the real test in
    this.knows = () => true;
    this.stSpentAt = -Infinity;
    this.sprintSent = false;
    this.exhausted = false;
    this.sprinting = false;
    this.roll = null;            // { t0, dx, dz }
    this.rollReady = 0;
    this.recoverUntil = 0;
    this.recoverSlow = 1;
    this.onRoll = null;          // (dx, dz) → play the roll animation
  }

  reset(x, z, ry = 0) {
    this.x = x; this.z = z; this.ry = ry; this.targetRy = ry;
    this.moving = false;
    this.sentX = x; this.sentZ = z; this.sentRy = ry;
    this.faceDirty = false;
    this.roll = null;
    this.recoverUntil = 0;
    this.sprintSent = false;
    this.exhausted = false;
  }

  /** Server rejected our movement: snap back immediately. */
  correct(x, z) {
    this.x = x; this.z = z;
    this.sentX = x; this.sentZ = z;
    this.roll = null;
  }

  /** Turn towards a world point (used when attacking while standing still). */
  faceTowards(x, z) {
    const dx = x - this.x, dz = z - this.z;
    if (dx * dx + dz * dz < 0.01) return;
    this.targetRy = Math.atan2(dx, dz);
    if (!this.moving) this.faceDirty = true;
  }

  // ---------------------------------------------------------------- [combat-souls] stamina & roll
  get rolling() { return !!this.roll; }

  /** Merge the authoritative stamina (server values are quantised: small differences are smoothed). */
  syncStamina(st, mst, now) {
    if (Number.isFinite(mst) && mst > 0) this.mst = mst;
    if (!Number.isFinite(st)) return;
    const d = st - this.st;
    if (Math.abs(d) > 7 || st <= 0 || st >= this.mst) this.st = st;
    else this.st += d * 0.5;
    if (d < -3) this.stSpentAt = now; // the server spent some (auto-attack…): regeneration restarts later
  }

  spend(amount, now) {
    if (!(amount > 0)) return;
    this.st = Math.max(0, this.st - amount);
    this.stSpentAt = now;
  }

  /** Attack commitment (same rule as the server): slowed during the recovery of an ability. */
  commit(ab, now) {
    const rec = ab?.rec ?? COMMIT.rec;
    if (!(rec > 0)) return;
    this.recoverUntil = Math.max(this.recoverUntil, now + rec * 1000);
    this.recoverSlow = ab?.recSlow ?? COMMIT.recSlow;
  }

  canRoll(now) {
    return !this.roll && now >= this.rollReady && this.st >= STAMINA.roll && this.knows('roulade');
  }

  /**
   * Dodge roll in the direction of the movement input (camera relative), else backwards.
   * Returns false (and does nothing) when it is not possible (stamina / cooldown).
   */
  tryRoll(axes, camFwd, now) {
    if (!this.canRoll(now)) return false;
    let dx = 0, dz = 0;
    if (axes.fx || axes.fz) {
      const rx = -camFwd.z, rz = camFwd.x;
      dx = camFwd.x * axes.fz + rx * axes.fx;
      dz = camFwd.z * axes.fz + rz * axes.fx;
    }
    let l = Math.hypot(dx, dz);
    if (l < 1e-4) { dx = -Math.sin(this.ry); dz = -Math.cos(this.ry); l = 1; }
    dx /= l; dz /= l;
    // position first (the server integrates the roll from the dodge message on)
    this._send(now, true);
    this.send({ t: C2S.DODGE, dx: round3(dx), dz: round3(dz) });
    this.roll = { t0: now, dx, dz };
    this.rollReady = now + ROLL.cdMs;
    this.spend(STAMINA.roll, now);
    this.recoverUntil = 0;
    this.targetRy = Math.atan2(dx, dz);
    this.ry = this.targetRy;
    this.onRoll?.(dx, dz);
    return true;
  }

  _staminaTick(dt, now, sprintMoving) {
    if (sprintMoving) {
      this.st = Math.max(0, this.st - STAMINA.sprintPerS * dt);
      this.stSpentAt = now;
      if (this.st <= 0) this.exhausted = true;
    } else if (this.st < this.mst) {
      this.st = regenStamina(this.st, this.mst, now - this.stSpentAt, dt * 1000);
    }
    if (this.exhausted && this.st >= STAMINA.sprintMin) this.exhausted = false;
  }

  /**
   * @param axes { fx, fz } camera-relative input
   * @param camFwd { x, z } camera forward on the ground plane
   * @param sprintHeld sprint key held ([combat-souls])
   */
  update(dt, axes, camFwd, speed, canMove, now, sprintHeld = false) {
    let dx = 0, dz = 0;
    if (canMove && (axes.fx || axes.fz)) {
      const rx = -camFwd.z, rz = camFwd.x;
      dx = camFwd.x * axes.fz + rx * axes.fx;
      dz = camFwd.z * axes.fz + rz * axes.fx;
      const l = Math.hypot(dx, dz);
      if (l > 1e-4) { dx /= l; dz /= l; } else { dx = dz = 0; }
    }
    // [combat-souls] sprint request (the server applies the same stamina rules)
    const wantSprint = canMove && sprintHeld && !this.exhausted && this.st > 0 && this.knows('sprint');
    if (wantSprint !== this.sprintSent) {
      this.sprintSent = wantSprint;
      this.send({ t: C2S.SPRINT, on: wantSprint });
    }
    const wasMoving = this.moving;
    if (this.roll && canMove) {
      // dodge roll: fixed direction and speed, input ignored
      const el = now - this.roll.t0;
      const target = (ROLL_SPEED * Math.min(el, ROLL.ms)) / 1000;
      this._step(this.roll.dx, this.roll.dz, Math.min(target - (this.roll.done || 0), ROLL_SPEED * 0.1));
      this.roll.done = target;
      this.moving = true;
      if (el >= ROLL.ms) this.roll = null;
      this._staminaTick(dt, now, false);
    } else {
      if (!canMove) this.roll = null;
      this.moving = dx !== 0 || dz !== 0;
      const sprinting = this.moving && wantSprint;
      this.sprinting = sprinting;
      if (this.moving) {
        let mult = sprinting ? STAMINA.sprintMult : 1;
        if (now < this.recoverUntil) mult = Math.min(mult, this.recoverSlow);
        this._step(dx, dz, speed * mult * Math.min(dt, 0.1));
        this.targetRy = Math.atan2(dx, dz);
      }
      this._staminaTick(dt, now, sprinting);
    }
    // smooth turning
    const d = angleDelta(this.ry, this.targetRy);
    this.ry += d * Math.min(1, dt * 14);
    if (Math.abs(d) < 0.002) this.ry = this.targetRy;

    // network
    if (this.moving) {
      if (now - this.lastSendAt >= SEND_MS) this._send(now);
    } else if (wasMoving) {
      this._send(now, true);
    } else if (this.faceDirty && now - this.lastSendAt >= 150 && Math.abs(angleDelta(this.ry, this.targetRy)) < 0.05) {
      this.faceDirty = false;
      this._send(now, true);
    }
  }

  _step(dx, dz, total) {
    if (!(total > 0)) return;
    const steps = Math.max(1, Math.ceil(total / 0.5));
    const sx = (dx * total) / steps, sz = (dz * total) / steps;
    for (let i = 0; i < steps; i++) {
      const p = this.collision.move(this.x, this.z, this.x + sx, this.z + sz, PLAYER_RADIUS);
      this.x = p.x; this.z = p.z;
    }
  }

  _send(now, final = false) {
    const x = round2(this.x), z = round2(this.z);
    const ry = round3(final ? this.targetRy : this.ry);
    if (x === this.sentX && z === this.sentZ && ry === this.sentRy) return;
    this.lastSendAt = now;
    this.sentX = x; this.sentZ = z; this.sentRy = ry;
    this.send({ t: C2S.MOVE, x, z, ry });
  }
}
