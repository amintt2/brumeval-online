// Gradient sky dome with sun, moon, procedural clouds and a star field. Follows the camera.
import * as THREE from 'three';

const SKY_RADIUS = 900;

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const skyFrag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uTime;
uniform float uNight;
uniform float uCover;
varying vec3 vDir;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = max(h, 0.0);
  vec3 col = mix(uHorizon, uTop, pow(up, 0.5));
  col = mix(col, uHorizon, exp(-up * 14.0) * 0.55);
  float sunVis = smoothstep(-0.16, 0.04, uSunDir.y);
  float sd = dot(d, uSunDir);
  // warm scattering around the sun, strongest near the horizon (dawn / dusk)
  float scatter = pow(max(sd, 0.0), 5.0) * (1.0 - smoothstep(0.0, 0.5, uSunDir.y)) * sunVis;
  col += uSunColor * scatter * 0.35 * (1.0 - up * 0.7);
  // clouds
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.1) * 1.25 + vec2(uTime * 0.0045, uTime * 0.0018);
    float n = fbm(uv);
    float c = smoothstep(uCover, uCover + 0.28, n) * smoothstep(0.0, 0.22, h);
    float lit = smoothstep(0.35, 0.85, fbm(uv * 1.3 + 3.1));
    vec3 cc = mix(uCloudDark, uCloudLit, 0.35 + 0.65 * lit);
    cc += uSunColor * pow(max(sd, 0.0), 6.0) * 0.45 * sunVis;
    col = mix(col, cc, c * 0.88);
  }
  // sun disk + glow
  float horizonMask = smoothstep(-0.03, 0.02, h);
  float disk = smoothstep(0.99955, 0.99975, sd);
  float glow = pow(max(sd, 0.0), 220.0) * 0.9 + pow(max(sd, 0.0), 24.0) * 0.18;
  col += uSunColor * (disk * 4.0 + glow) * sunVis * horizonMask;
  // moon
  float md = dot(d, uMoonDir);
  float moonVis = smoothstep(-0.05, 0.06, uMoonDir.y) * uNight;
  float mdisk = smoothstep(0.99935, 0.99955, md);
  float crater = 0.85 + 0.15 * noise(d.xy * 900.0);
  col += vec3(0.92, 0.95, 1.0) * (mdisk * 1.3 * crater + pow(max(md, 0.0), 400.0) * 0.35 + pow(max(md, 0.0), 30.0) * 0.05) * moonVis * horizonMask;
  // below the horizon: fade to the ground / fog colour
  col = mix(col, uGround, smoothstep(0.0, -0.06, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const starVert = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uAlpha;
uniform float uPixelRatio;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99998;
  vec3 wp = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  float tw = 0.65 + 0.35 * sin(uTime * (1.3 + aPhase * 2.0) + aPhase * 40.0);
  vAlpha = uAlpha * tw * smoothstep(0.02, 0.22, wp.y);
  gl_PointSize = aSize * uPixelRatio;
}`;

const starFrag = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * a * vAlpha, 1.0);
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uCloudLit: { value: new THREE.Color() },
      uCloudDark: { value: new THREE.Color() },
      uTime: { value: 0 },
      uNight: { value: 0 },
      uCover: { value: 0.5 },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'sky',
      uniforms: this.uniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), mat);
    this.dome.name = 'sky';
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // stars
    const N = 1600;
    const pos = new Float32Array(N * 3), size = new Float32Array(N), phase = new Float32Array(N);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      // uniform on the upper hemisphere (and a bit below, rotated in)
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(th) * SKY_RADIUS * 0.95;
      pos[i * 3 + 1] = u * SKY_RADIUS * 0.95;
      pos[i * 3 + 2] = r * Math.sin(th) * SKY_RADIUS * 0.95;
      const b = rnd();
      size[i] = 0.8 + b * b * b * 2.6;
      phase[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.starUniforms = { uTime: { value: 0 }, uAlpha: { value: 0 }, uPixelRatio: { value: 1 } };
    const smat = new THREE.ShaderMaterial({
      name: 'stars',
      uniforms: this.starUniforms,
      vertexShader: starVert,
      fragmentShader: starFrag,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    this.stars = new THREE.Points(g, smat);
    this.stars.name = 'stars';
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    scene.add(this.stars);
  }

  setPixelRatio(pr) {
    this.starUniforms.uPixelRatio.value = pr;
  }

  update(camera, time, tod) {
    this.dome.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.stars.rotation.set(0.35, tod * Math.PI * 2, 0);
    this.uniforms.uTime.value = time;
    this.starUniforms.uTime.value = time;
    this.stars.visible = this.starUniforms.uAlpha.value > 0.01;
  }
}
