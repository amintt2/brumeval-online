// [combat-souls] Death echo of the local player (SelfState.echo): a glowing wisp at the death spot and a tall
// light beam visible from afar (no fog, no distance culling), so the player can find the way back to the XP.
import * as THREE from 'three';
import { terrainHeight } from '@shared/world.js';
import { glowTexture } from './textures.js';

const BEAM_H = 90;
const C_CORE = new THREE.Color('#bff6ff');
const C_WISP = new THREE.Color('#5fd8ff');
const C_WISP2 = new THREE.Color('#d8fbff');

const beamVert = /* glsl */ `
varying float vY;
varying float vU;
void main() {
  vY = uv.y; vU = uv.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const beamFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uAlpha;
varying float vY;
varying float vU;
void main() {
  float across = sin(vU * 3.14159265);          // brighter in the middle of each face
  float fade = pow(1.0 - vY, 1.6) * smoothstep(0.0, 0.02, vY);
  float flow = 0.75 + 0.25 * sin(vY * 60.0 - uTime * 3.0);
  float a = across * fade * flow * uAlpha;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export class EchoRenderer {
  /** ctx: { scene, effects } */
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'deathEcho';
    this.group.visible = false;
    this.uniforms = { uColor: { value: new THREE.Color('#66e0ff') }, uTime: { value: 0 }, uAlpha: { value: 0.55 } };
    const beamGeo = new THREE.CylinderGeometry(0.28, 0.5, BEAM_H, 12, 1, true);
    beamGeo.translate(0, BEAM_H / 2, 0);
    const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
      name: 'echoBeam',
      uniforms: this.uniforms,
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    }));
    beam.frustumCulled = false;
    beam.renderOrder = 6;
    this.beam = beam;
    this.wisp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: C_WISP, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false,
    }));
    this.wisp.scale.setScalar(1.6);
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: C_CORE, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false,
    }));
    this.core.scale.setScalar(0.6);
    this.group.add(beam, this.wisp, this.core);
    ctx.scene.add(this.group);
    this.echo = null;
    this.acc = 0;
  }

  /** SelfState.echo ({ x, z, xp } | null). */
  set(echo) {
    const e = echo && Number.isFinite(echo.x) && Number.isFinite(echo.z) ? echo : null;
    this.echo = e;
    this.group.visible = !!e;
    if (e) this.group.position.set(e.x, terrainHeight(e.x, e.z), e.z);
  }

  update(dt, time, focus) {
    if (!this.echo) return;
    this.uniforms.uTime.value = time;
    const g = this.group.position;
    const bob = Math.sin(time * 2.1) * 0.18;
    this.wisp.position.set(0, 1.2 + bob, 0);
    this.core.position.set(0, 1.2 + bob, 0);
    const pulse = 1 + Math.sin(time * 5) * 0.12;
    this.wisp.scale.setScalar(1.6 * pulse);
    // the beam fades a little when the player stands next to it (it would fill the screen)
    const d = focus ? Math.hypot(focus.x - g.x, focus.z - g.z) : 100;
    this.uniforms.uAlpha.value = 0.25 + 0.45 * Math.min(1, d / 30);
    // keep the beam a few pixels wide however far away it is
    const w = Math.max(1, d / 45);
    this.beam.scale.set(w, 1, w);
    // drifting motes around the wisp
    const fx = this.ctx.effects;
    if (fx && d < 60) {
      this.acc += dt;
      while (this.acc > 0.06) {
        this.acc -= 0.06;
        const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.6;
        fx.glow.emit(g.x + Math.cos(a) * r, g.y + 0.6 + Math.random() * 1.2, g.z + Math.sin(a) * r,
          -Math.sin(a) * 0.4, 0.5 + Math.random() * 0.5, Math.cos(a) * 0.4, Math.random() < 0.5 ? C_WISP : C_WISP2, 0.18, 1.1, -0.2, 0.6, 0.04);
      }
    }
  }
}
