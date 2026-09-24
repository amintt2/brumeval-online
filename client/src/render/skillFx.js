// [skilltree] Procedural visuals of L'Arbre des Brumes (docs/design/ARBRE_COMPETENCES.md, protocol FX [skilltree]):
// Fondamentaux (jump / landing, guard, block, parry, guard break, perfect counter, charged attack, stagger), ground
// zones (wall of fire, toxic cloud, blizzard, meteor mark…), traps and summons, buffs and shields, channels, ability
// movement trails, statuses, the « skill learnt » sparkle and the Renaissance ritual + its permanent spectral aura.
// Built on the pooled particles / decals / lights of render/effects.js; flipbooks (/vfx/manifest.json) when present.
import * as THREE from 'three';
import { FX, KIND } from '@shared/protocol.js';
import { ABILITIES } from '@shared/data.js';
import { terrainHeight } from '@shared/world.js';
import { renaissanceTitle, STATUS_DEFS } from '@shared/skills.js';
import { buildGeometry } from './telegraphs.js';

const col = (hex) => new THREE.Color(hex);
const C_GOLD = col('#ffd45a'), C_GOLD2 = col('#fff2b0'), C_WHITE = col('#ffffff'), C_DUST = col('#9c8a6e');
const C_GUARD = col('#bcd8ff'), C_PARRY = col('#fff0b0'), C_BREAK = col('#ff6a3a'), C_PERFECT = col('#8fe4ff');
const C_SPECTRAL = col('#bfe0ff'), C_SPECTRAL2 = col('#7fb4ff'), C_SMOKE = col('#3a3530');
const EL = { feu: '#ff6a1a', givre: '#8fdcff', arcane: '#c77dff', nature: '#8ee06a', poison: '#9be23a', saignement: '#ff3a3a', physique: '#e8dcc0' };
const STATUS_COLOR = { brulure: '#ff7a1a', froid: '#8fd8ff', gel: '#c8f2ff', enracine: '#8cc85a', poison: '#7ddc3a', saignement: '#e2303c', marque: '#ff6ad8', etourdi: '#ffd54a', aveugle: '#d0c8b0' };
const SHIELD_AB = new Set(['mana_shield', 'rune_aegis', 'frost_armor', 'bastion', 'riposte_parfaite']);

/** Element of an ability (colour family of its visuals). */
function elementOf(abId) {
  const tags = ABILITIES[abId]?.tags || [];
  for (const t of ['feu', 'givre', 'arcane', 'poison', 'nature', 'saignement']) if (tags.includes(t)) return t;
  return 'physique';
}
const colorOf = (abId) => col(EL[elementOf(abId)]);

// ------------------------------------------------------------------ zone shader
const zoneVert = /* glsl */ `
attribute float aF;
attribute float aS;
attribute float aA;
varying float vF;
varying float vS;
varying float vA;
void main() {
  vF = aF; vS = aS; vA = aA;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const zoneFrag = /* glsl */ `
vec3 toSRGB(vec3 c) { return linearToOutputTexel(vec4(max(c, vec3(0.0)), 1.0)).rgb; }
uniform vec3 uColor;
uniform float uTime;
uniform float uFade;
uniform float uMarkMode;
uniform float uShape;
varying float vF;
varying float vS;
varying float vA;
void main() {
  float outer = 1.0 - vF;
  float side = 1.0 - abs(vS);
  float border = outer;
  if (uShape > 1.5) border = min(border, side * 3.0);
  if (uShape > 2.5) border = min(side * 2.0, min(outer, vF * 6.0));
  float edge = 1.0 - smoothstep(0.0, 0.07, border);
  float swirl = 0.5 + 0.5 * sin(vF * 11.0 - uTime * 2.4 + sin(vA * 25.0 + uTime) * 1.3);
  float a = 0.12 + swirl * 0.14 + edge * 0.55;
  if (uMarkMode > 0.5) {
    // meteor mark / delayed impact: pulsing target
    float pulse = 0.5 + 0.5 * sin(uTime * 9.0);
    a = 0.08 + edge * (0.6 + 0.4 * pulse) + step(0.5, fract(vA * 16.0 - uTime)) * edge * 0.3;
  }
  gl_FragColor = vec4(toSRGB(uColor) * a * uFade, 1.0);
}`;
const SHAPE_ID = { circle: 0, ring: 1, cone: 2, line: 3 };

// ------------------------------------------------------------------ bubble shader (shields)
const bubbleVert = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const bubbleFrag = /* glsl */ `
vec3 toSRGB(vec3 c) { return linearToOutputTexel(vec4(max(c, vec3(0.0)), 1.0)).rgb; }
uniform vec3 uColor;
uniform float uFade;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(vN, vV)), 2.4);
  float band = 0.85 + 0.15 * sin(vN.y * 18.0 + uTime * 3.0);
  gl_FragColor = vec4(toSRGB(uColor) * f * band * 0.9 * uFade, 1.0);
}`;

export class SkillFx {
  /** fx = the Effects instance (particles, decals, lights, flipbooks, labels, entities). */
  constructor(fx) {
    this.fx = fx;
    this.E = fx.ctx.entities;
    this.scene = fx.scene;
    this.time = 0;
    this.zones = new Map();     // id -> { mesh, u, ab, el, shape, x, z, r, a, len, w, until, markUntil, acc, trap }
    this.follows = [];          // { id, kind: 'buff'|'channel'|'charge'|'perfect'|'trail', ab, color, t0, until, acc, bubble? }
    this.bubbles = [];
    const bg = new THREE.SphereGeometry(1, 24, 16);
    for (let i = 0; i < 6; i++) {
      const u = { uColor: { value: new THREE.Color() }, uFade: { value: 0 }, uTime: { value: 0 } };
      const mat = new THREE.ShaderMaterial({
        name: 'shieldBubble', uniforms: u, vertexShader: bubbleVert, fragmentShader: bubbleFrag,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
      });
      const mesh = new THREE.Mesh(bg, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 22;
      this.scene.add(mesh);
      this.bubbles.push({ mesh, u, busy: false });
    }
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this.auraAcc = 0;
  }

  _near(p, d = 50) { return this.fx._near(p, d); }
  _text(id, text, cls, h = 0.35) { this.fx._text(id, text, cls, h); }

  // ---------------------------------------------------------------- events
  handle(m) {
    const fx = this.fx;
    const E = this.E;
    const p = this._v;
    switch (m.k) {
      case FX.JUMP: {
        const v = E.get(m.src);
        if (!v) break;
        v.startJump(m.ms || 400);
        if (fx.point(m.src, 0.02, p)) {
          for (let i = 0; i < 8; i++) {
            const a = Math.random() * Math.PI * 2;
            fx.smoke.emit(p.x, p.y + 0.05, p.z, Math.cos(a) * 1.1, 0.3, Math.sin(a) * 1.1, C_DUST, 0.45, 0.55, 0, 2.2, 1.0, 0.4);
          }
          fx._sound('jump', p);
        }
        break;
      }
      case FX.LAND: {
        if (!fx.point(m.src, 0.02, p)) break;
        const r = m.r || 0;
        fx._dustRing(p.x, p.z, Math.max(0.6, r * 0.7), r ? 7 : 4, r ? 0.9 : 0.5);
        for (let i = 0; i < (r ? 22 : 10); i++) {
          const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * (r ? r * 2 : 1.5);
          fx.smoke.emit(p.x, p.y + 0.08, p.z, Math.cos(a) * s, 0.25 + Math.random() * 0.4, Math.sin(a) * s, C_DUST, r ? 0.7 : 0.45, 0.7, 0, 2.2, 1.3, 0.45);
        }
        if (r) {
          fx._decal(p.x, p.z, r, col('#ffc070'), fx.STYLE.slam, 0.9, 0.2);
          fx._burst(fx.smoke, p, col('#7d7a74'), 10, 5, 0.2, 0.7, 12, 0.2, 3, 0.2);
          if (m.src === fx.ctx.state.selfId) fx.ctx.shake(0.25, 0.3);
        }
        fx._sound('land', p);
        break;
      }
      case FX.BLOCK: {
        if (fx.point(m.src, 0.62, p)) {
          const v = E.get(m.src);
          if (v) { p.x += Math.sin(v.rec.ry) * 0.5; p.z += Math.cos(v.rec.ry) * 0.5; }
          fx.flip.play('impact_spark', p, { size: 1.1, color: C_GUARD });
          fx._burst(fx.spark, p, C_GUARD, 12, 4.5, 0.16, 0.28, 6);
          fx._burst(fx.glow, p, C_GUARD, 6, 1.5, 0.3, 0.25, 0, 3);
          fx._sound('block', p);
        }
        this._text(m.src, m.v > 0 ? `Bloqué (${m.v})` : 'Bloqué', 'guard', 0.1);
        break;
      }
      case FX.PARRY: {
        if (fx.point(m.src, 0.62, p)) {
          fx._light(p, C_PARRY, 30, 0.35);
          fx.flip.play('arcane_burst', p, { size: 2.2, color: C_PARRY });
          fx._burst(fx.spark, p, C_PARRY, 26, 7, 0.22, 0.4, 5);
          fx._burst(fx.glow, p, C_GOLD, 14, 3, 0.4, 0.35, 0, 3);
          fx._sound('parry', p);
        }
        if (m.src === fx.ctx.state.selfId || m.tg === fx.ctx.state.selfId) fx.hitstop(90);
        this._text(m.src, 'Parade parfaite !', 'parry', 0.2);
        E.playAnim(m.tg, 'Hit', { force: true });
        break;
      }
      case FX.GUARD_BREAK: {
        E.get(m.src)?.poseFor('stagger', m.ms || 1000);
        if (fx.point(m.src, 0.62, p)) {
          fx._burst(fx.spark, p, C_BREAK, 22, 6, 0.2, 0.45, 7);
          fx._sound('stagger', p);
        }
        this._text(m.src, 'Garde brisée !', 'broken', 0.25);
        if (m.src === fx.ctx.state.selfId) fx.ctx.shake(0.35, 0.35);
        break;
      }
      case FX.PERFECT: {
        if (fx.point(m.src, 0.5, p)) {
          fx._light(p, C_PERFECT, 22, 0.5);
          fx._burst(fx.glow, p, C_PERFECT, 24, 3, 0.3, 0.6, -1, 1.5);
          fx._sound('dodge', p);
        }
        this._text(m.src, 'Contre parfait !', 'perfect', 0.3);
        this._follow(m.src, 'perfect', null, C_PERFECT, Math.min(3000, m.ms || 1200));
        break;
      }
      case FX.VACILLE:
        E.get(m.src)?.poseFor('stagger', m.ms || 400);
        this._text(m.src, 'Vacille', 'stagger', 0.2);
        break;
      case FX.CHARGE: {
        const v = E.get(m.src);
        v?.poseFor('charge', 2400);
        this._stopFollow(m.src, 'charge');
        this._follow(m.src, 'charge', m.ab, C_GOLD, 2400, { full: Math.max(200, m.ms || 1200) });
        if (fx.point(m.src, 0.5, p)) fx._sound('charge', p);
        break;
      }
      case FX.CHARGED: {
        E.get(m.src)?.poseFor('charge', 0);
        this._stopFollow(m.src, 'charge');
        if (!(m.lvl >= 0)) break; // cancelled
        const lvl = Math.max(0, Math.min(1, m.lvl));
        if (fx.point(m.src, 0.6, p)) {
          const c = C_GOLD.clone().lerp(C_WHITE, lvl * 0.5);
          fx._light(p, c, 10 + lvl * 25, 0.35);
          fx._burst(fx.glow, p, c, Math.round(10 + lvl * 26), 3 + lvl * 4, 0.3, 0.4, 0, 3);
          fx._burst(fx.spark, p, C_GOLD2, Math.round(6 + lvl * 16), 5 + lvl * 4, 0.18, 0.35, 6);
          if (lvl >= 0.99) this._text(m.src, 'Pleine charge !', 'crit', 0.25);
          fx._sound('charged', p);
        }
        break;
      }
      case FX.DASH: {
        const v = E.get(m.src);
        if (!v) break;
        const c = colorOf(m.ab);
        const blink = !(m.ms > 20);
        if (fx.point(m.src, 0.5, p)) {
          fx._burst(fx.glow, p, c, blink ? 24 : 10, blink ? 3 : 1.5, 0.3, 0.45, 0, 2);
          if (blink) fx.flip.play('arcane_burst', p, { size: 2, color: c });
          fx._sound(blink ? 'cast' : 'roll', p);
        }
        if (blink && Number.isFinite(m.x)) {
          this._v2.set(m.x, terrainHeight(m.x, m.z) + 0.9, m.z);
          fx._burst(fx.glow, this._v2, c, 24, 3, 0.3, 0.5, 0, 2);
        } else {
          if (ABILITIES[m.ab]?.kind === 'dash' && !v.rec.isSelf) v.animator.play('Roll', { timeScale: 0.55 / Math.max(0.15, (m.ms || 300) / 1000) });
          if (m.ab === 'leap_slam') v.startJump(m.ms || 500, 1.6);
          this._follow(m.src, 'trail', m.ab, c, (m.ms || 300) + 80);
        }
        break;
      }
      case FX.ZONE:
        this._zone(m, false);
        break;
      case FX.TRAP:
        this._zone({ ...m, shape: 'circle', r: m.ab === 'ice_wall' ? 1.6 : m.ab === 'wisp' ? 0.6 : 0.9, ms: 60_000 }, true);
        break;
      case FX.ZONE_END:
        this._endZone(m.id);
        break;
      case FX.BUFF: {
        const c = colorOf(m.ab);
        const shield = SHIELD_AB.has(m.ab) || (ABILITIES[m.ab]?.tags || []).includes('bouclier');
        if (fx.point(m.src, 0.02, p)) {
          fx._decal(p.x, p.z, 1.8, c, fx.STYLE.ring, 0.8, 0.3);
          this._v2.set(p.x, p.y + 1, p.z);
          fx._burst(fx.glow, this._v2, c, 20, 2.5, 0.3, 0.6, -0.5, 2);
          fx._light(this._v2, c, 14, 0.5);
          fx._sound(m.ab === 'war_cry' || m.ab === 'rage' || m.ab === 'hallali' ? 'warcry' : 'cast', p);
        }
        E.playAnim(m.src, 'Cast');
        this._follow(m.src, 'buff', m.ab, c, Math.min(30_000, m.ms || 3000), { shield });
        break;
      }
      case FX.CHANNEL: {
        const c = colorOf(m.ab);
        this._stopFollow(m.src, 'channel');
        this._follow(m.src, 'channel', m.ab, c, Math.min(12_000, m.ms || 2000));
        E.playAnim(m.src, ABILITIES[m.ab]?.tags?.includes('arc') ? 'Attack' : 'Cast');
        if (fx.point(m.src, 0.6, p)) fx._sound(elementOf(m.ab) === 'givre' ? 'frostcast' : 'cast', p);
        break;
      }
      case FX.CHANNEL_END:
        this._stopFollow(m.src, 'channel');
        break;
      case FX.STATUS: {
        const name = STATUS_DEFS.get(m.st)?.name?.replace(/ \(joueur\)$/, '') || '';
        const c = col(STATUS_COLOR[m.st] || '#ffffff');
        if (fx.point(m.tg, 0.6, p)) fx._burst(m.st === 'poison' ? fx.smoke : fx.glow, p, c, 10, 1.6, m.st === 'poison' ? 0.5 : 0.25, 0.5, -0.4, 2, 0.3);
        if (name && m.tg !== fx.ctx.state.selfId) {
          const v = E.get(m.tg);
          if (v) {
            fx.ctx.labels.spawnText(m.n > 1 ? `${name} ×${m.n}` : name, this._v2.set(v.rec.x, v.topY + 0.5, v.rec.z), 'status');
          }
        }
        if (m.st === 'gel') E.flash(m.tg, 1);
        break;
      }
      case FX.SKILL:
        if (fx.point(m.src, 0.1, p)) {
          for (let i = 0; i < 30; i++) {
            const a = (i / 30) * Math.PI * 4, r = 0.7;
            fx.spark.emit(p.x + Math.cos(a) * r, p.y + (i / 30) * 1.8, p.z + Math.sin(a) * r, -Math.sin(a) * 0.6, 1.4, Math.cos(a) * 0.6,
              i % 2 ? C_GOLD : C_SPECTRAL, 0.24, 1.0, -0.2, 0.8, 0.06);
          }
          fx._sound('skill', p);
        }
        break;
      case FX.RENAISSANCE: {
        if (fx.point(m.src, 0, p)) {
          fx._pillar(m.src, C_SPECTRAL, 11, 1.4, 3.4);
          fx._decal(p.x, p.z, 5, C_SPECTRAL2, fx.STYLE.ring, 2.4, 0.5);
          fx.flip.play('rune_circle', p, { size: 6, color: C_SPECTRAL, ground: true, life: 3 });
          for (let i = 0; i < 90; i++) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * 2.2;
            fx.smoke.emit(p.x + Math.cos(a) * r, p.y + 0.2, p.z + Math.sin(a) * r, Math.cos(a) * 0.6, 0.6 + Math.random() * 1.4, Math.sin(a) * 0.6, C_SPECTRAL, 1.2, 2.6, -0.2, 0.6, 2.6, 0.35);
          }
          this._v2.set(p.x, p.y + 2, p.z);
          fx._light(this._v2, C_SPECTRAL, 40, 2.5);
          fx._sound('renaissance', p);
        }
        this._text(m.src, renaissanceTitle(m.n || 1) || 'Renaissance', 'renaissance', 0.8);
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- follow emitters (buffs, channels, charge…)
  _follow(id, kind, ab, color, ms, extra = {}) {
    const f = { id, kind, ab, color, t0: this.time, until: this.time + ms / 1000, acc: 0, ...extra };
    if (extra.shield) {
      const b = this.bubbles.find((q) => !q.busy);
      if (b) {
        b.busy = true;
        b.mesh.visible = true;
        b.u.uColor.value.copy(color);
        f.bubble = b;
      }
    }
    this.follows.push(f);
    return f;
  }

  _stopFollow(id, kind) {
    for (const f of this.follows) if (f.id === id && f.kind === kind) f.until = Math.min(f.until, this.time);
  }

  // ---------------------------------------------------------------- zones, traps, summons
  _zone(m, trap) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
    this._endZone(m.id, true);
    const shape = SHAPE_ID[m.shape] !== undefined ? m.shape : 'circle';
    const t = { shape, x: m.x, z: m.z, r: Math.max(0.4, m.r || 2), a: m.a || 0, arc: m.arc, len: m.len, w: m.w };
    const el = elementOf(m.ab);
    const u = {
      uColor: { value: colorOf(m.ab) }, uTime: { value: this.time }, uFade: { value: 0 }, uMarkMode: { value: m.delay > 0 ? 1 : 0 },
      uShape: { value: SHAPE_ID[shape] },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'skillZone', uniforms: u, vertexShader: zoneVert, fragmentShader: zoneFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false, toneMapped: false,
    });
    const mesh = new THREE.Mesh(buildGeometry(t), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    const now = this.time;
    const delay = Math.max(0, (m.delay || 0) / 1000);
    this.zones.set(m.id, {
      mesh, u, ab: m.ab, el, t, trap, acc: 0, t0: now,
      markUntil: now + delay, until: now + delay + Math.max(0.2, (m.ms || 3000) / 1000), ending: 0,
    });
    const p = this._v.set(m.x, terrainHeight(m.x, m.z) + 0.3, m.z);
    if (this._near(p)) this.fx._sound(trap ? 'click' : 'zone', p);
  }

  _endZone(id, instant = false) {
    const z = this.zones.get(id);
    if (!z) return;
    if (instant) {
      this.scene.remove(z.mesh);
      z.mesh.geometry.dispose();
      z.mesh.material.dispose();
      this.zones.delete(id);
    } else if (!z.ending) {
      z.ending = this.time;
      z.until = Math.min(z.until, this.time + 0.35);
    }
  }

  /** Random point inside a zone shape (into out). */
  _pointIn(t, out) {
    let x = t.x, z = t.z;
    if (t.shape === 'line') {
      const along = Math.random() * (t.len || 4), across = (Math.random() - 0.5) * (t.w || 1);
      const sa = Math.sin(t.a), ca = Math.cos(t.a);
      x += sa * along + ca * across; z += ca * along - sa * across;
    } else if (t.shape === 'cone') {
      const half = (t.arc || Math.PI / 2) / 2;
      const ang = t.a + (Math.random() * 2 - 1) * half, rr = Math.sqrt(Math.random()) * t.r;
      x += Math.sin(ang) * rr; z += Math.cos(ang) * rr;
    } else {
      const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * t.r;
      x += Math.sin(ang) * rr; z += Math.cos(ang) * rr;
    }
    return out.set(x, terrainHeight(x, z), z);
  }

  _emitZone(z, dt) {
    const fx = this.fx;
    const t = z.t;
    const area = t.shape === 'line' ? (t.len || 4) * (t.w || 1) : Math.PI * t.r * t.r * (t.shape === 'cone' ? (t.arc || 1.57) / 6.28 : 1);
    const rate = z.trap ? 3 : Math.min(60, 4 + area * 1.6);
    z.acc += dt * rate;
    const c = z.u.uColor.value;
    const p = this._v3;
    while (z.acc > 1) {
      z.acc -= 1;
      this._pointIn(t, p);
      switch (z.el) {
        case 'feu':
          fx.glow.emit(p.x, p.y + 0.15, p.z, (Math.random() - 0.5) * 0.4, 1.4 + Math.random() * 1.6, (Math.random() - 0.5) * 0.4, Math.random() < 0.5 ? c : C_GOLD, 0.4, 0.7, -0.4, 0.8, 0.08);
          if (Math.random() < 0.15) fx.smoke.emit(p.x, p.y + 1, p.z, 0, 0.8, 0, C_SMOKE, 0.7, 1.6, -0.1, 0.4, 1.6, 0.3);
          break;
        case 'givre':
          fx.spark.emit(p.x, p.y + 2.5 + Math.random() * 1.5, p.z, (Math.random() - 0.5) * 1.5, -2.5, (Math.random() - 0.5) * 1.5, Math.random() < 0.5 ? c : C_WHITE, 0.2, 1.1, 0.5, 0.2, 0.1);
          break;
        case 'poison':
        case 'nature':
          fx.smoke.emit(p.x, p.y + 0.3, p.z, (Math.random() - 0.5) * 0.4, 0.25, (Math.random() - 0.5) * 0.4, c, 1.1, 1.8, 0, 0.6, 2.2, 0.4);
          break;
        case 'arcane':
          fx.glow.emit(p.x, p.y + 0.2, p.z, 0, 0.8 + Math.random(), 0, c, 0.25, 0.9, -0.2, 0.5, 0.05);
          break;
        default:
          fx.smoke.emit(p.x, p.y + 0.1, p.z, (Math.random() - 0.5) * 0.5, 0.2, (Math.random() - 0.5) * 0.5, C_DUST, 0.5, 0.9, 0, 1.5, 0.9, 0.35);
      }
    }
    if (z.ab === 'wisp' && Math.random() < dt * 20) {
      fx.glow.emit(t.x + (Math.random() - 0.5) * 0.2, terrainHeight(t.x, t.z) + 1.3 + Math.sin(this.time * 3) * 0.15, t.z + (Math.random() - 0.5) * 0.2, 0, 0.2, 0, c, 0.5, 0.35, 0, 1, 0.1);
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt, time) {
    this.time = time;
    const fx = this.fx;
    const E = this.E;
    const p = this._v;
    // zones
    for (const [id, z] of this.zones) {
      if (time >= z.until) { this._endZone(id, true); continue; }
      const marking = time < z.markUntil;
      if (!marking && z.u.uMarkMode.value > 0.5) {
        z.u.uMarkMode.value = 0;
        // delayed impact (meteor): explosion when the mark ends
        this._v2.set(z.t.x, terrainHeight(z.t.x, z.t.z) + 0.5, z.t.z);
        if (!fx.flip.play('explosion', this._v2, { size: z.t.r * 2.2 })) fx._burst(fx.glow, this._v2, z.u.uColor.value, 50, z.t.r * 2.5, 0.6, 0.7, -1, 2.5, 1);
        fx._light(this._v2, z.u.uColor.value, 50, 0.6);
        fx._sound('explode', this._v2);
        if (fx._near(this._v2, 30)) fx.ctx.shake(0.35, 0.5);
      }
      const k = Math.min(1, (time - z.t0) * 5);
      const fadeOut = Math.min(1, (z.until - time) / 0.35);
      z.u.uFade.value = Math.min(1, Math.max(0.05, k)) * fadeOut;
      z.u.uTime.value = time;
      if (!marking && fx._near(this._v2.set(z.t.x, 0, z.t.z), 55)) this._emitZone(z, dt);
    }
    // follow emitters
    for (let i = this.follows.length - 1; i >= 0; i--) {
      const f = this.follows[i];
      const v = E.get(f.id);
      if (time >= f.until || !v || v.rec.dead) {
        if (f.bubble) { f.bubble.busy = false; f.bubble.mesh.visible = false; }
        this.follows.splice(i, 1);
        continue;
      }
      const rec = v.rec;
      const top = v.height * v.scale;
      const y0 = v.root.position.y;
      f.acc += dt;
      if (f.bubble) {
        const b = f.bubble;
        const life = f.until - f.t0, el = time - f.t0;
        b.mesh.position.set(rec.x, y0 + top * 0.5, rec.z);
        b.mesh.scale.setScalar(Math.max(0.7, top * 0.62) * (1 + Math.sin(time * 4) * 0.02));
        b.u.uFade.value = Math.min(1, el / 0.15) * Math.min(1, (life - el) / 0.3);
        b.u.uTime.value = time;
      }
      if (!fx._near(p.set(rec.x, 0, rec.z), 55)) continue;
      switch (f.kind) {
        case 'buff':
          while (f.acc > 0.09) {
            f.acc -= 0.09;
            const a = Math.random() * Math.PI * 2, r = 0.45 + Math.random() * 0.2;
            fx.glow.emit(rec.x + Math.cos(a) * r, y0 + Math.random() * top * 0.9, rec.z + Math.sin(a) * r, 0, 0.6 + Math.random() * 0.5, 0, f.color, 0.18, 0.7, -0.2, 0.8, 0.04);
          }
          break;
        case 'perfect':
          while (f.acc > 0.06) {
            f.acc -= 0.06;
            const a = Math.random() * Math.PI * 2;
            fx.glow.emit(rec.x + Math.cos(a) * 0.5, y0 + top * (0.3 + Math.random() * 0.6), rec.z + Math.sin(a) * 0.5, -Math.cos(a) * 0.3, 0.5, -Math.sin(a) * 0.3, f.color, 0.2, 0.45, 0, 1, 0.05);
          }
          break;
        case 'charge': {
          const lvl = Math.min(1, (time - f.t0) / (f.full / 1000));
          const every = 0.05 - lvl * 0.03;
          while (f.acc > every) {
            f.acc -= every;
            // motes converge on the weapon hand (front right of the body)
            const hx = rec.x + Math.sin(rec.ry) * 0.35 + Math.cos(rec.ry) * 0.3, hz = rec.z + Math.cos(rec.ry) * 0.35 - Math.sin(rec.ry) * 0.3;
            const hy = y0 + top * 0.55;
            const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 0.5;
            fx.glow.emit(hx + Math.cos(a) * r, hy + (Math.random() - 0.5) * 0.6, hz + Math.sin(a) * r, -Math.cos(a) * r * 2.5, 0, -Math.sin(a) * r * 2.5,
              lvl >= 1 ? C_WHITE : C_GOLD, 0.16 + lvl * 0.16, 0.35, 0, 0, 0.05);
            if (lvl >= 1 && Math.random() < 0.3) fx.spark.emit(hx, hy, hz, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, C_GOLD2, 0.14, 0.3, 3);
          }
          break;
        }
        case 'channel': {
          const el = elementOf(f.ab);
          const forward = f.ab === 'flame_breath' || f.ab === 'arcane_beam' || f.ab === 'rapid_fire' || f.ab === 'trait_fatal';
          while (f.acc > 0.035) {
            f.acc -= 0.035;
            if (forward) {
              const spread = f.ab === 'flame_breath' ? 0.5 : 0.06;
              const a = rec.ry + (Math.random() - 0.5) * spread;
              const s = f.ab === 'flame_breath' ? 7 : 16;
              fx.glow.emit(rec.x + Math.sin(rec.ry) * 0.5, y0 + top * 0.6, rec.z + Math.cos(rec.ry) * 0.5, Math.sin(a) * s, (Math.random() - 0.3) * 0.6, Math.cos(a) * s,
                f.color, f.ab === 'flame_breath' ? 0.5 : 0.22, f.ab === 'flame_breath' ? 0.5 : 0.6, 0, f.ab === 'flame_breath' ? 1.5 : 0.1, f.ab === 'flame_breath' ? 1.1 : 0.12);
            } else {
              const a = time * 6 + Math.random() * 0.8, r = 0.55;
              fx.glow.emit(rec.x + Math.cos(a) * r, y0 + top * (0.4 + Math.random() * 0.4), rec.z + Math.sin(a) * r, -Math.sin(a) * 1.2, 0.5, Math.cos(a) * 1.2, el === 'physique' ? C_GOLD : f.color, 0.2, 0.5, 0, 1, 0.05);
            }
          }
          break;
        }
        case 'trail':
          while (f.acc > 0.02) {
            f.acc -= 0.02;
            fx.glow.emit(rec.x + (Math.random() - 0.5) * 0.3, y0 + top * (0.2 + Math.random() * 0.6), rec.z + (Math.random() - 0.5) * 0.3, 0, 0.2, 0, f.color, 0.35, 0.35, 0, 2, 0.1);
          }
          break;
        default:
          break;
      }
    }
    // permanent per-entity visuals: Renaissance aura, guard shimmer
    this.auraAcc += dt;
    if (this.auraAcc >= 0.08) {
      const step = this.auraAcc;
      this.auraAcc = 0;
      for (const v of E.views.values()) {
        const rec = v.rec;
        if (rec.k !== KIND.PLAYER || rec.dead || !v.root.visible) continue;
        const guard = v.animator?.pose?.guard || 0;
        if (!(rec.rb > 0) && guard < 0.5) continue;
        if (!fx._near(p.set(rec.x, 0, rec.z), 45)) continue;
        const y0 = v.root.position.y;
        const top = v.height * v.scale;
        if (rec.rb > 0 && Math.random() < step * (2.5 + rec.rb * 1.2)) {
          // spectral mist drifting around the feet + a few rising motes (brighter with each Renaissance)
          const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.4;
          fx.smoke.emit(rec.x + Math.cos(a) * r, y0 + 0.15, rec.z + Math.sin(a) * r, -Math.sin(a) * 0.3, 0.12, Math.cos(a) * 0.3, C_SPECTRAL, 0.8, 1.8, 0, 0.8, 1.5, 0.22 + rec.rb * 0.04);
          if (Math.random() < 0.3 + rec.rb * 0.1) fx.glow.emit(rec.x + Math.cos(a) * 0.4, y0 + 0.2, rec.z + Math.sin(a) * 0.4, 0, 0.7 + Math.random() * 0.5, 0, C_SPECTRAL2, 0.14, 1.4, -0.1, 0.4, 0.04);
        }
        if (guard >= 0.5) {
          // guard shimmer: a faint arc in front of the body
          const a = rec.ry + (Math.random() - 0.5) * 1.6;
          fx.glow.emit(rec.x + Math.sin(a) * 0.62, y0 + top * (0.25 + Math.random() * 0.55), rec.z + Math.cos(a) * 0.62, 0, 0.05, 0, C_GUARD, 0.22, 0.3, 0, 0.5, 0.12);
        }
      }
    }
  }

  clear() {
    for (const id of [...this.zones.keys()]) this._endZone(id, true);
    for (const f of this.follows) if (f.bubble) { f.bubble.busy = false; f.bubble.mesh.visible = false; }
    this.follows.length = 0;
  }
}
