// Pooled CPU particle system rendered as one THREE.Points draw call (typed arrays, no per-frame allocation).
import * as THREE from 'three';

const vert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  vColor = aColor;
  vAlpha = aAlpha * (1.0 - smoothstep(70.0, 130.0, dist));
  gl_PointSize = aSize * uScale / max(0.3, dist);
}`;

const fragAdd = /* glsl */ `
// [render-souls] linear inside the HDR pipeline, sRGB when drawn straight to the screen
vec3 toSRGB(vec3 c) { return linearToOutputTexel(vec4(max(c, vec3(0.0)), 1.0)).rgb; }
uniform sampler2D uMap;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(toSRGB(vColor) * a, 1.0);
}`;

const fragNormal = /* glsl */ `
uniform sampler2D uMap;
uniform float uLight;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * uLight, a);
  #include <colorspace_fragment>
}`;

export class ParticleSystem {
  constructor(scene, { max = 2000, texture, additive = true, name = 'particles' }) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 400 }, uMap: { value: texture }, uLight: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      name,
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: additive ? fragAdd : fragNormal,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
      toneMapped: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.name = name;
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 19;
    this.geometry = g;
    scene.add(this.points);
  }

  setViewport(heightPx, camera) {
    this.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  /**
   * Emit one particle. color = THREE.Color (linear). size in metres. sizeEnd defaults to size.
   */
  emit(x, y, z, vx, vy, vz, color, size, life, gravity = 0, drag = 0, sizeEnd = size, alpha = 1) {
    let i;
    if (this.count < this.max) i = this.count++;
    else i = (Math.random() * this.max) | 0; // overwrite a random one when saturated
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.s0[i] = size; this.s1[i] = sizeEnd; this.size[i] = size;
    this.a0[i] = alpha; this.alpha[i] = alpha;
    this.life[i] = life; this.age[i] = 0;
    this.grav[i] = gravity; this.drag[i] = drag;
  }

  _copy(from, to) {
    const f3 = from * 3, t3 = to * 3;
    for (let c = 0; c < 3; c++) {
      this.pos[t3 + c] = this.pos[f3 + c];
      this.vel[t3 + c] = this.vel[f3 + c];
      this.col[t3 + c] = this.col[f3 + c];
    }
    this.size[to] = this.size[from]; this.alpha[to] = this.alpha[from];
    this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from]; this.a0[to] = this.a0[from];
    this.life[to] = this.life[from]; this.age[to] = this.age[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) {
        n--;
        if (i !== n) this._copy(n, i);
        i--;
        continue;
      }
      const k = age / this.life[i];
      const i3 = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt; this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      // quick fade-in, smooth fade-out
      const fin = Math.min(1, age / 0.06);
      this.alpha[i] = this.a0[i] * fin * (k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45);
    }
    this.count = n;
    this.geometry.setDrawRange(0, n);
    if (n > 0) {
      this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, n * 3); this.aPos.needsUpdate = true;
      this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, n * 3); this.aCol.needsUpdate = true;
      this.aSize.clearUpdateRanges(); this.aSize.addUpdateRange(0, n); this.aSize.needsUpdate = true;
      this.aAlpha.clearUpdateRanges(); this.aAlpha.addUpdateRange(0, n); this.aAlpha.needsUpdate = true;
    }
  }

  clear() {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }
}
