// Animation controller: locomotion (Idle / Walk, cross-faded) + one-shots (Attack, Cast, Hit, Death).
// Any missing clip (or a primitive fallback model with no clips at all) is replaced by a small procedural
// motion applied to a dedicated pivot node, so every entity always reacts visibly.
import * as THREE from 'three';

const FADE = 0.15;
const PROC_DUR = { Attack: 0.45, Cast: 0.7, Hit: 0.32, Death: 0.9 };
const ease = (k) => 1 - (1 - k) * (1 - k);

export class Animator {
  /**
   * @param {THREE.Object3D} model  cloned model (mixer root)
   * @param {Map<string, THREE.AnimationClip>} clips
   * @param {THREE.Object3D} pivot  node between the entity root and the model, for procedural motion
   * @param {object} opts { style: 'humanoid'|'slime'|'quadruped'|'golem', height }
   */
  constructor(model, clips, pivot, opts = {}) {
    this.pivot = pivot;
    this.style = opts.style || 'humanoid';
    this.height = opts.height || 1.8;
    this.mixer = clips && clips.size ? new THREE.AnimationMixer(model) : null;
    this.actions = new Map();
    if (this.mixer) {
      for (const [name, clip] of clips) {
        const a = this.mixer.clipAction(clip);
        this.actions.set(name, a);
      }
    }
    this.baseName = 'Idle';
    this.baseAction = null;
    this.speedRatio = 1;
    this.one = null;          // current one-shot { name, action, t, dur }
    this.dead = false;
    this.t = Math.random() * 10;
    this.phase = Math.random() * Math.PI * 2;
    this.walkBlend = 0;
    // start idle at a random time so crowds don't breathe in sync
    const idle = this.actions.get('Idle');
    if (idle) {
      idle.play();
      idle.time = Math.random() * idle.getClip().duration;
      this.baseAction = idle;
    }
  }

  has(name) {
    return this.actions.has(name);
  }

  /** Locomotion state; ratio scales the Walk clip speed (1 = nominal). */
  setMoving(moving, ratio = 1) {
    this.speedRatio = Math.min(1.8, Math.max(0.55, ratio));
    const name = moving ? 'Walk' : 'Idle';
    if (name === this.baseName) return;
    this.baseName = name;
    if (this.dead) return;
    this._applyBase(FADE);
  }

  _baseTarget() {
    return this.actions.get(this.baseName) || this.actions.get('Idle') || null;
  }

  _applyBase(fade) {
    const want = this._baseTarget();
    if (want === this.baseAction) return;
    const prev = this.baseAction;
    this.baseAction = want;
    if (this.one && this.one.action) {
      // a one-shot owns the pose right now: swap silently, it will fade back into `want`
      if (prev) prev.stop();
      return;
    }
    if (want) {
      want.reset();
      want.setEffectiveWeight(1);
      want.fadeIn(fade).play();
    }
    if (prev) prev.fadeOut(fade);
  }

  /** Play a one-shot clip. Returns true if a real clip was used. */
  play(name) {
    if (this.dead && name !== 'Death') return false;
    if (name === 'Hit' && this.one && (this.one.name === 'Attack' || this.one.name === 'Cast' || this.one.name === 'Death')) return false;
    if (name === 'Death') this.dead = true;
    const a = this.actions.get(name);
    if (this.one && this.one.action && this.one.action !== a) this.one.action.fadeOut(0.08);
    if (a) {
      a.reset();
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.setEffectiveTimeScale(1);
      a.setEffectiveWeight(1);
      a.fadeIn(0.08).play();
      if (this.baseAction) this.baseAction.fadeOut(0.08);
      this.one = { name, action: a, t: 0, dur: a.getClip().duration };
      return true;
    }
    this.one = { name, action: null, t: 0, dur: PROC_DUR[name] || 0.4 };
    return false;
  }

  /** Back to life (player respawn). */
  revive() {
    this.dead = false;
    if (this.one && this.one.action) this.one.action.stop();
    this.one = null;
    for (const a of this.actions.values()) a.stop();
    this.baseAction = null;
    this._applyBase(0);
    this.pivot.position.set(0, 0, 0);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.scale.set(1, 1, 1);
  }

  /** Jump straight to the end of the death pose (entity first seen as a corpse). */
  setDeadPose() {
    this.play('Death');
    if (this.one) {
      if (this.one.action) this.one.action.time = this.one.dur;
      this.one.t = this.one.dur;
    }
  }

  update(dt) {
    this.t += dt;
    const one = this.one;
    if (one) {
      one.t += dt;
      if (one.action && one.name !== 'Death' && one.t >= one.dur - FADE) {
        // fade back into locomotion
        one.action.fadeOut(FADE);
        const base = this._baseTarget();
        this.baseAction = base;
        if (base) {
          base.reset();
          base.setEffectiveWeight(1);
          base.fadeIn(FADE).play();
        }
        this.one = null;
      } else if (!one.action && one.name !== 'Death' && one.t >= one.dur) {
        this.one = null;
      }
    }
    if (this.baseAction && this.baseName === 'Walk' && this.actions.has('Walk')) {
      this.baseAction.setEffectiveTimeScale(this.speedRatio);
    }
    if (this.mixer) this.mixer.update(dt);
    this._procedural(dt);
  }

  _procedural(dt) {
    const p = this.pivot;
    const h = this.height;
    let py = 0, rx = 0, rz = 0, sx = 1, sy = 1;
    const walkingProc = !this.dead && this.baseName === 'Walk' && !this.actions.has('Walk');
    this.walkBlend += ((walkingProc ? 1 : 0) - this.walkBlend) * Math.min(1, dt * 10);
    if (this.walkBlend > 0.001) {
      this.phase += dt * 9 * this.speedRatio;
      const s = Math.sin(this.phase);
      if (this.style === 'slime') {
        py += Math.abs(s) * 0.22 * h * this.walkBlend;
        sy *= 1 + (Math.abs(s) - 0.5) * 0.25 * this.walkBlend;
      } else {
        py += Math.abs(s) * 0.05 * h * this.walkBlend;
        rz += s * 0.05 * this.walkBlend;
        rx += 0.06 * this.walkBlend;
      }
    }
    if (!this.dead && !this.actions.has('Idle')) {
      const b = Math.sin(this.t * 2.2);
      if (this.style === 'slime') { sy *= 1 + b * 0.06; sx *= 1 - b * 0.03; }
      else sy *= 1 + b * 0.012;
    }
    const one = this.one;
    if (one && !one.action) {
      const k = Math.min(1, one.t / one.dur);
      const bell = Math.sin(k * Math.PI);
      switch (one.name) {
        case 'Attack':
          if (this.style === 'slime') { sy *= 1 - bell * 0.3; sx *= 1 + bell * 0.2; py += bell * 0.15 * h; }
          else rx += bell * 0.4;
          break;
        case 'Cast':
          rx -= bell * 0.18;
          py += bell * 0.08 * h;
          sy *= 1 + bell * 0.05;
          break;
        case 'Hit':
          rx -= bell * 0.22;
          sy *= 1 - bell * 0.05;
          break;
        case 'Death': {
          const e = ease(k);
          if (this.style === 'slime') { sy *= 1 - 0.75 * e; sx *= 1 + 0.35 * e; }
          else if (this.style === 'quadruped') { rz += (Math.PI / 2) * e; py += 0.25 * h * e; }
          else { rx -= (Math.PI / 2) * e; py += 0.12 * e; }
          break;
        }
      }
    }
    p.position.y = py;
    p.rotation.x = rx;
    p.rotation.z = rz;
    p.scale.set(sx, sy, sx);
  }

  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
    }
  }
}
