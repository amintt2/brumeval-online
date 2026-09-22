// Local player movement: client-simulated with the same CollisionWorld as the server, camera-relative input,
// smooth facing, `move` messages at most MOVE_SEND_HZ while moving and once when stopping.
import { C2S, MOVE_SEND_HZ, PLAYER_RADIUS } from '@shared/protocol.js';
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
  }

  reset(x, z, ry = 0) {
    this.x = x; this.z = z; this.ry = ry; this.targetRy = ry;
    this.moving = false;
    this.sentX = x; this.sentZ = z; this.sentRy = ry;
    this.faceDirty = false;
  }

  /** Server rejected our movement: snap back immediately. */
  correct(x, z) {
    this.x = x; this.z = z;
    this.sentX = x; this.sentZ = z;
  }

  /** Turn towards a world point (used when attacking while standing still). */
  faceTowards(x, z) {
    const dx = x - this.x, dz = z - this.z;
    if (dx * dx + dz * dz < 0.01) return;
    this.targetRy = Math.atan2(dx, dz);
    if (!this.moving) this.faceDirty = true;
  }

  /**
   * @param axes { fx, fz } camera-relative input
   * @param camFwd { x, z } camera forward on the ground plane
   */
  update(dt, axes, camFwd, speed, canMove, now) {
    let dx = 0, dz = 0;
    if (canMove && (axes.fx || axes.fz)) {
      const rx = -camFwd.z, rz = camFwd.x;
      dx = camFwd.x * axes.fz + rx * axes.fx;
      dz = camFwd.z * axes.fz + rz * axes.fx;
      const l = Math.hypot(dx, dz);
      if (l > 1e-4) { dx /= l; dz /= l; } else { dx = dz = 0; }
    }
    const wasMoving = this.moving;
    this.moving = dx !== 0 || dz !== 0;
    if (this.moving) {
      let total = speed * Math.min(dt, 0.1);
      const steps = Math.max(1, Math.ceil(total / 0.5));
      const sx = (dx * total) / steps, sz = (dz * total) / steps;
      for (let i = 0; i < steps; i++) {
        const p = this.collision.move(this.x, this.z, this.x + sx, this.z + sz, PLAYER_RADIUS);
        this.x = p.x; this.z = p.z;
      }
      this.targetRy = Math.atan2(dx, dz);
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

  _send(now, final = false) {
    const x = round2(this.x), z = round2(this.z);
    const ry = round3(final ? this.targetRy : this.ry);
    if (x === this.sentX && z === this.sentZ && ry === this.sentRy) return;
    this.lastSendAt = now;
    this.sentX = x; this.sentZ = z; this.sentRy = ry;
    this.send({ t: C2S.MOVE, x, z, ry });
  }
}
