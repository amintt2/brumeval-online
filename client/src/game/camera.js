// Third-person orbit camera: yaw/pitch drag, wheel zoom (3–28 m), smoothing, terrain avoidance, shake.
import * as THREE from 'three';
import { terrainHeight } from '@shared/world.js';
import { CAMERA } from '../config.js';

const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
/** Static objects the camera boom must not pass through (height above their base, metres at scale 1). */
const OCCLUDER_H = { house: 6.0, tent: 3.0, rock_b: 2.9, well: 2.9, stall: 2.7 };

export class OrbitCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI;
    this.pitch = CAMERA.startPitch;
    this.targetDist = CAMERA.startDist;
    this.dist = CAMERA.startDist;
    this.curDist = CAMERA.startDist;
    this.focus = new THREE.Vector3(0, 3, 0);
    this.lookAt = new THREE.Vector3();
    this.shakeAmt = 0;
    this.shakeTime = 0;
    this.shakeDur = 1;
    this.attractT = 0;
    this.occ = [];
    this.near = [];
  }

  /** Register big static objects (from generateWorldObjects) the camera should not clip into. */
  setOccluders(objects) {
    this.occ = objects
      .filter((o) => OCCLUDER_H[o.type] && o.r > 0)
      .map((o) => ({ x: o.x, z: o.z, r: o.r * 0.95, top: terrainHeight(o.x, o.z) + OCCLUDER_H[o.type] * o.s }));
  }

  _blocked(x, y, z) {
    if (terrainHeight(x, z) + 0.45 > y) return true;
    const near = this.near;
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      const dx = x - o.x, dz = z - o.z;
      if (dx * dx + dz * dz < o.r * o.r && y < o.top) return true;
    }
    return false;
  }

  rotate(dx, dy) {
    this.yaw -= dx * 0.0055;
    this.pitch = Math.min(CAMERA.maxPitch, Math.max(CAMERA.minPitch, this.pitch + dy * 0.0045));
  }

  zoom(dy) {
    const f = Math.exp(dy * 0.0012);
    this.targetDist = Math.min(CAMERA.maxDist, Math.max(CAMERA.minDist, this.targetDist * f));
  }

  shake(amount, dur) {
    if (amount > this.shakeAmt * (1 - this.shakeTime / this.shakeDur)) {
      this.shakeAmt = amount;
      this.shakeDur = dur;
      this.shakeTime = 0;
    }
  }

  /** Put the camera behind a character facing `ry`. */
  behind(ry) {
    this.yaw = ry + Math.PI;
  }

  /** Horizontal forward direction of the camera (unit x/z). */
  forward(out) {
    out.x = -Math.sin(this.yaw);
    out.z = -Math.cos(this.yaw);
    return out;
  }

  update(dt, target, snap = false) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 14);
    _p.set(target.x, target.y + 1.55, target.z);
    if (snap) this.focus.copy(_p);
    else this.focus.lerp(_p, k);
    this.dist += (this.targetDist - this.dist) * (snap ? 1 : 1 - Math.exp(-dt * 10));
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _dir.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    // shorten the boom if the terrain or a building is in the way
    const near = this.near;
    near.length = 0;
    const reach = this.dist + 8;
    for (const o of this.occ) {
      const dx = o.x - this.focus.x, dz = o.z - this.focus.z;
      if (dx * dx + dz * dz < reach * reach) near.push(o);
    }
    let allowed = this.dist;
    for (let f = 0.12; f <= 1.001; f += 0.06) {
      const d = this.dist * f;
      const x = this.focus.x + _dir.x * d, y = this.focus.y + _dir.y * d, z = this.focus.z + _dir.z * d;
      if (this._blocked(x, y, z)) {
        allowed = Math.max(CAMERA.minDist * 0.5, d - 0.5);
        break;
      }
    }
    if (allowed < this.curDist || snap) this.curDist = allowed;
    else this.curDist += (allowed - this.curDist) * (1 - Math.exp(-dt * 4));
    const cam = this.camera;
    cam.position.copy(this.focus).addScaledVector(_dir, this.curDist);
    const floor = terrainHeight(cam.position.x, cam.position.z) + 0.4;
    if (cam.position.y < floor) cam.position.y = floor;
    this.lookAt.copy(this.focus);
    this._applyShake(dt);
    cam.lookAt(this.lookAt);
  }

  _applyShake(dt) {
    if (this.shakeAmt <= 0) return;
    this.shakeTime += dt;
    const k = 1 - this.shakeTime / this.shakeDur;
    if (k <= 0) { this.shakeAmt = 0; return; }
    const a = this.shakeAmt * k * k;
    const t = this.shakeTime * 40;
    this.camera.position.x += Math.sin(t * 1.1) * a * 0.35;
    this.camera.position.y += Math.sin(t * 1.7 + 1) * a * 0.35;
    this.lookAt.y += Math.sin(t * 1.3 + 2) * a * 0.15;
  }

  /** Slow cinematic orbit around the village (login / loading background). */
  attract(dt) {
    this.attractT += dt;
    const a = this.attractT * 0.04 + 0.6;
    const cam = this.camera;
    cam.position.set(Math.cos(a) * 44, 0, Math.sin(a) * 44);
    cam.position.y = Math.max(terrainHeight(cam.position.x, cam.position.z) + 6, 15);
    this.lookAt.set(0, 3.5, 0);
    cam.lookAt(this.lookAt);
  }
}
