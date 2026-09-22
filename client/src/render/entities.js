// Entity views: cloned (skinned) models + animation, nameplates, hp bars, hit cylinders for picking,
// quest markers, corpse sinking, hit flash / slow tint, and the selection ring under the target.
import * as THREE from 'three';
import { CLASSES, MONSTERS, NPCS, QUESTS } from '@shared/data.js';
import { KIND } from '@shared/protocol.js';
import { terrainHeight } from '@shared/world.js';
import { Animator } from './animator.js';

const HIT_GEO = new THREE.CylinderGeometry(1, 1, 1, 10);
HIT_GEO.translate(0, 0.5, 0);
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
const WHITE = new THREE.Color(1, 1, 1);
const FROST = new THREE.Color(0.25, 0.55, 1.0);
const _c = new THREE.Color();

export function modelKeyFor(rec) {
  if (rec.m) return rec.m;
  if (rec.k === KIND.PLAYER) return CLASSES[rec.c]?.model || 'warrior';
  if (rec.k === KIND.MONSTER) return MONSTERS[rec.mt]?.model || 'slime';
  if (rec.k === KIND.NPC) return NPCS[rec.nk]?.model || 'npc_elder';
  return 'warrior';
}

function styleFor(key) {
  if (key === 'slime') return 'slime';
  if (key === 'wolf') return 'quadruped';
  if (key === 'golem') return 'golem';
  return 'humanoid';
}

/** Nominal movement speed of an entity (for the Walk clip time scale). */
function nominalSpeed(rec) {
  if (rec.k === KIND.PLAYER) return CLASSES[rec.c]?.speed || 6.5;
  if (rec.k === KIND.MONSTER) return MONSTERS[rec.mt]?.speed || 4;
  return 2;
}

/** Nameplate colour of a monster by level difference with the player. */
export function levelColor(monsterLevel, playerLevel) {
  const d = monsterLevel - playerLevel;
  if (d <= -5) return '#a3a3a3';
  if (d <= -2) return '#4fd65a';
  if (d <= 1) return '#ffe04a';
  if (d <= 3) return '#ff9a2e';
  return '#ff4040';
}

export class EntityView {
  constructor(rec, ctx) {
    this.rec = rec;
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = `ent${rec.id}`;
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.modelKey = null;
    this.inst = null;
    this.animator = null;
    this.height = 1.8;
    this.radius = 0.5;
    this.scale = 1;
    this.flash = 0;
    this.tint = 0;
    this.sink = 0;
    this.moveSpeed = 0;
    this.prevX = rec.x;
    this.prevZ = rec.z;
    this.animAcc = 0;
    this.spawnFade = 0;
    this.hit = new THREE.Mesh(HIT_GEO, HIT_MAT);
    this.hit.userData.entityId = rec.id;
    this.root.add(this.hit);
    this.plate = ctx.labels.addNameplate();
    this.buildModel();
    ctx.scene.add(this.root);
  }

  buildModel() {
    const rec = this.rec;
    if (this.inst) {
      this.pivot.remove(this.inst.object);
      this.animator?.dispose();
      this.ctx.assets.disposeInstance(this.inst);
    }
    const key = modelKeyFor(rec);
    this.modelKey = key;
    this.inst = this.ctx.assets.instantiate(key);
    this.pivot.add(this.inst.object);
    this.scale = rec.k === KIND.MONSTER ? rec.sc || 1 : 1;
    this.root.scale.setScalar(this.scale);
    this.height = this.inst.height;
    this.radius = Math.max(0.35, Math.min(this.inst.radius, key === 'golem' ? 1.8 : 0.9));
    this.animator = new Animator(this.inst.object, this.inst.clips, this.pivot, { style: styleFor(key), height: this.height });
    const hr = Math.max(0.5, this.radius * 1.05);
    this.hit.scale.set(hr, this.height * 1.05, hr);
    this.nominal = nominalSpeed(rec);
    rec.dirtyModel = false;
    rec.dirtyLabel = true;
    if (rec.dead) this.animator.setDeadPose();
  }

  /** World-space height of the top of the model. */
  get topY() {
    return this.root.position.y + this.height * this.scale;
  }

  refreshLabel(selfLevel, targeted) {
    const rec = this.rec;
    const p = this.plate;
    const isBoss = !!rec.b || !!MONSTERS[rec.mt]?.boss;
    p.setText(rec.n || '', rec.k === KIND.NPC ? '' : rec.lv);
    let color = '#ffffff';
    if (rec.isSelf) color = '#ffffff';
    else if (rec.k === KIND.PLAYER) color = '#8fd3ff';
    else if (rec.k === KIND.NPC) color = '#ffd24a';
    else if (rec.k === KIND.MONSTER) color = levelColor(rec.lv || 1, selfLevel || 1);
    p.setColor(color);
    p.toggle('boss', isBoss);
    p.toggle('friendly', rec.k === KIND.PLAYER);
    p.toggle('targeted', targeted);
    const damaged = rec.mhp > 0 && rec.hp < rec.mhp;
    p.toggle('show-hp', rec.k !== KIND.NPC && !rec.dead && (damaged || targeted));
    p.setHp(rec.mhp > 0 ? rec.hp / rec.mhp : 1);
    rec.dirtyLabel = false;
  }

  update(dt, now, camPos) {
    const rec = this.rec;
    const r = this.root;
    const gy = terrainHeight(rec.x, rec.z);
    // movement speed estimate (for locomotion)
    const dx = rec.x - this.prevX, dz = rec.z - this.prevZ;
    this.prevX = rec.x; this.prevZ = rec.z;
    const inst = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    this.moveSpeed += (Math.min(inst, 20) - this.moveSpeed) * Math.min(1, dt * 12);
    // corpse sinking
    let yOff = 0;
    if (rec.dead && rec.k === KIND.MONSTER && rec.deadAt) {
      const t = (now - rec.deadAt) / 1000 - 1.7;
      if (t > 0) yOff = -Math.min(1, t / 2.2) * (this.height * this.scale * 0.8 + 0.3);
    }
    r.position.set(rec.x, gy + yOff, rec.z);
    r.rotation.y = rec.ry;
    const camD = r.position.distanceTo(camPos);
    r.visible = camD < 140;
    // keep the pose consistent with the authoritative state (e.g. death seen out of range, respawn)
    if (rec.dead && !this.animator.dead) this.animator.play('Death');
    else if (!rec.dead && this.animator.dead) this.animator.revive();
    // animation (reduced rate far away)
    const moving = !rec.dead && this.moveSpeed > 0.45;
    this.animator.setMoving(moving, this.moveSpeed / this.nominal);
    this.animAcc += dt;
    const step = camD > 45 ? 1 / 15 : 0;
    if (r.visible && this.animAcc >= step) {
      this.animator.update(this.animAcc);
      this.animAcc = 0;
    }
    // hit flash / frost tint on the per-instance materials
    const wantTint = rec.sl ? 1 : 0;
    this.tint += (wantTint - this.tint) * Math.min(1, dt * 6);
    if (this.flash > 0 || this.tint > 0.01 || this._fx) {
      this.flash = Math.max(0, this.flash - dt * 5);
      const f = this.flash, t = this.tint;
      for (const m of this.inst.materials) {
        if (!m.emissive) continue;
        _c.copy(m.emissive).lerp(FROST, t * 0.6).lerp(WHITE, f * 0.75);
        m.mat.emissive.copy(_c);
        m.mat.emissiveIntensity = Math.max(m.ei, (f + t * 0.5) * 1.2);
      }
      this._fx = f > 0 || t > 0.01;
    }
    // nameplate anchor
    this.plate.anchor.set(rec.x, gy + yOff + this.height * this.scale + 0.3, rec.z);
    this.plate.visible = !(rec.dead && rec.k === KIND.MONSTER && now - rec.deadAt > 600);
  }

  dispose() {
    this.ctx.scene.remove(this.root);
    this.ctx.labels.removeNameplate(this.plate);
    this.animator?.dispose();
    if (this.inst) this.ctx.assets.disposeInstance(this.inst);
    this.inst = null;
  }
}

// ------------------------------------------------------------------ selection ring
const ringVert = /* glsl */ `
attribute float aU;
attribute float aR;
varying float vU;
varying float vR;
void main() {
  vU = aU; vR = aR;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ringFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
varying float vU;
varying float vR;
void main() {
  float edge = smoothstep(0.0, 0.25, vR) * smoothstep(1.0, 0.7, vR);
  float dash = 0.65 + 0.35 * smoothstep(0.3, 0.7, abs(fract(vU * 12.0 - uTime * 0.6) - 0.5) * 2.0);
  float a = edge * dash * uOpacity;
  gl_FragColor = vec4(uColor * (1.2 + vR * 0.4), a);
  #include <colorspace_fragment>
}`;

export class SelectionRing {
  constructor(scene) {
    this.SEG = 56;
    const n = (this.SEG + 1) * 2;
    this.pos = new Float32Array(n * 3);
    const u = new Float32Array(n), rr = new Float32Array(n);
    const idx = [];
    for (let i = 0; i <= this.SEG; i++) {
      u[i * 2] = u[i * 2 + 1] = i / this.SEG;
      rr[i * 2] = 0; rr[i * 2 + 1] = 1;
      if (i < this.SEG) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    g.setAttribute('aR', new THREE.BufferAttribute(rr, 1));
    g.setIndex(idx);
    this.uniforms = { uColor: { value: new THREE.Color(1, 0.3, 0.2) }, uTime: { value: 0 }, uOpacity: { value: 0.9 } };
    const m = new THREE.ShaderMaterial({
      name: 'selectionRing',
      uniforms: this.uniforms,
      vertexShader: ringVert,
      fragmentShader: ringFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'selectionRing';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this._x = NaN; this._z = NaN; this._r = 0;
  }

  setColor(hex) {
    this.uniforms.uColor.value.set(hex);
  }

  /** Show the ring at (x, z) with radius r (conforms to the terrain). */
  show(x, z, r, time) {
    this.mesh.visible = true;
    this.uniforms.uTime.value = time;
    if (Math.abs(x - this._x) < 0.02 && Math.abs(z - this._z) < 0.02 && r === this._r) return;
    this._x = x; this._z = z; this._r = r;
    const inner = r * 0.78, outer = r * 1.05;
    for (let i = 0; i <= this.SEG; i++) {
      const a = (i / this.SEG) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      for (let j = 0; j < 2; j++) {
        const rad = j ? outer : inner;
        const px = x + c * rad, pz = z + s * rad;
        const k = (i * 2 + j) * 3;
        this.pos[k] = px;
        this.pos[k + 1] = terrainHeight(px, pz) + 0.06;
        this.pos[k + 2] = pz;
      }
    }
    this.aPos.needsUpdate = true;
  }

  hide() {
    this.mesh.visible = false;
  }
}

// ------------------------------------------------------------------ renderer of all entities
export class EntityRenderer {
  constructor(ctx, state) {
    this.ctx = ctx;           // { scene, assets, labels }
    this.state = state;
    this.views = new Map();
    this.hitMeshes = [];
    this.ring = new SelectionRing(ctx.scene);
    this.targetId = 0;
    this._selfLevel = 1;
    state.on('add', (rec) => this.ensure(rec));
    state.on('remove', (rec) => this.remove(rec.id));
    state.on('self', (self) => {
      if (self && self.level !== this._selfLevel) {
        this._selfLevel = self.level;
        for (const v of this.views.values()) v.rec.dirtyLabel = true;
      }
      this.refreshMarkers();
    });
  }

  ensure(rec) {
    let v = this.views.get(rec.id);
    if (!v) {
      if (!rec.k) return null; // not enough info yet
      v = new EntityView(rec, this.ctx);
      rec.view = v;
      this.views.set(rec.id, v);
      this.hitMeshes.push(v.hit);
      if (rec.k === KIND.NPC) this.refreshMarkers();
    } else if (rec.dirtyModel) {
      v.buildModel();
    }
    return v;
  }

  remove(id) {
    const v = this.views.get(id);
    if (!v) return;
    v.dispose();
    this.views.delete(id);
    const i = this.hitMeshes.indexOf(v.hit);
    if (i >= 0) this.hitMeshes.splice(i, 1);
    v.rec.view = null;
    if (this.targetId === id) this.targetId = 0;
  }

  clear() {
    for (const id of [...this.views.keys()]) this.remove(id);
  }

  get(id) {
    return this.views.get(id) || null;
  }

  /** Quest markers above quest-giver NPCs: "?" if a quest can be turned in, "!" if one is available. */
  refreshMarkers() {
    const self = this.state.self;
    for (const v of this.views.values()) {
      const rec = v.rec;
      if (rec.k !== KIND.NPC) continue;
      let marker = null;
      const npc = NPCS[rec.nk];
      if (self && npc && npc.quests) {
        const qs = self.quests || {};
        let ready = false, avail = false;
        for (const qid of npc.quests) {
          const q = QUESTS[qid];
          const st = qs[qid]?.state;
          if (st === 'ready') ready = true;
          else if (!st && (!q.requires || qs[q.requires]?.state === 'done') && self.level >= q.lvl) avail = true;
        }
        marker = ready ? '?' : avail ? '!' : null;
      }
      v.plate.setMarker(marker);
    }
  }

  playAnim(id, name) {
    const v = this.views.get(id);
    if (v) v.animator.play(name);
    return v;
  }

  flash(id, amount = 1) {
    const v = this.views.get(id);
    if (v) { v.flash = Math.max(v.flash, amount); v._fx = true; }
  }

  update(dt, now, camera, time) {
    const rt = this.state.renderTime(now);
    const camPos = camera.position;
    for (const rec of this.state.entities.values()) {
      let v = rec.view;
      if (!v || rec.dirtyModel) v = this.ensure(rec);
      if (!v) continue;
      if (!rec.isSelf) rec.interpolate(rt);
      v.update(dt, now, camPos);
      if (rec.dirtyLabel) v.refreshLabel(this._selfLevel, rec.id === this.targetId);
    }
    // selection ring
    const t = this.targetId ? this.views.get(this.targetId) : null;
    if (t) {
      const rec = t.rec;
      const hex = rec.k === KIND.MONSTER ? '#ff4a36' : rec.k === KIND.NPC ? '#ffc93a' : '#4fa8ff';
      if (this._ringHex !== hex) { this._ringHex = hex; this.ring.setColor(hex); }
      this.ring.show(rec.x, rec.z, Math.max(0.7, t.radius * t.scale * 1.25), time);
    } else {
      this.ring.hide();
    }
  }

  setTarget(id) {
    const prev = this.views.get(this.targetId);
    if (prev) prev.rec.dirtyLabel = true;
    this.targetId = id || 0;
    const v = this.views.get(this.targetId);
    if (v) v.rec.dirtyLabel = true;
  }
}
