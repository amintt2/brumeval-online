// Sky dome (HDR radiance): gradient + optional Blender HDRI layer (clouds, colour), sun with a Mie-like halo,
// moon, procedural clouds and a star field. Follows the camera.
// The same shader is rendered into a small cube map ("env pass": no sun disk / stars, ground bounce below the
// horizon) to build the image-based lighting, so the IBL always matches the visible sky.
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
uniform vec3 uGroundBounce;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uTime;
uniform float uNight;
uniform float uCover;
uniform float uSkyI;
uniform float uEnvPass;
uniform sampler2D uHdr0;
uniform sampler2D uHdr1;
uniform sampler2D uHdr2;
uniform sampler2D uHdr3;
uniform vec4 uHdrW;      // blend weights (already multiplied by each HDRI's normalisation)
uniform float uHdrMix;   // 0 = procedural only
uniform float uHdrClamp; // luminance clamp (removes the sun baked into the HDRIs)
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
vec2 equirect(vec3 d) {
  return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
}
vec3 hdrSample(vec3 d) {
  vec2 uv = equirect(d);
  // explicit gradients: the atan() wrap-around would otherwise pick the smallest mip along one column (a visible
  // seam line), and implicit derivatives are undefined inside the branches below
  vec2 uvW = vec2(fract(uv.x + 0.5), uv.y);
  vec2 gx = dFdx(uv), gy = dFdy(uv), gxW = dFdx(uvW), gyW = dFdy(uvW);
  if (dot(gxW, gxW) + dot(gyW, gyW) < dot(gx, gx) + dot(gy, gy)) { gx = gxW; gy = gyW; }
  vec3 c = vec3(0.0);
  if (uHdrW.x > 0.0) c += textureGrad(uHdr0, uv, gx, gy).rgb * uHdrW.x;
  if (uHdrW.y > 0.0) c += textureGrad(uHdr1, uv, gx, gy).rgb * uHdrW.y;
  if (uHdrW.z > 0.0) c += textureGrad(uHdr2, uv, gx, gy).rgb * uHdrW.z;
  if (uHdrW.w > 0.0) c += textureGrad(uHdr3, uv, gx, gy).rgb * uHdrW.w;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return l > uHdrClamp ? c * (uHdrClamp / l) : c;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = max(h, 0.0);
  vec3 col = mix(uHorizon, uTop, pow(up, 0.45));
  col = mix(col, uHorizon, exp(-up * 12.0) * 0.6);
  float sunVis = smoothstep(-0.16, 0.04, uSunDir.y);
  float sd = dot(d, uSunDir);
  // warm forward scattering around the sun: wide at dawn / dusk
  float low = 1.0 - smoothstep(0.0, 0.55, uSunDir.y);
  float scatter = pow(max(sd, 0.0), 4.0) * (0.35 + 0.65 * low) * sunVis;
  col += uSunColor * scatter * 0.28 * (1.0 - up * 0.6);
  // clouds (procedural): domain-warped fbm, soft edges, self-shadowing towards the sun, silver lining
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.2) * 0.85 + vec2(uTime * 0.0035, uTime * 0.0014);
    vec2 warp = vec2(fbm(uv * 0.6 + 11.3), fbm(uv * 0.6 + 3.7)) - 0.5;
    vec2 cuv = uv + warp * 0.7;
    float n = fbm(cuv);
    float c = smoothstep(uCover - 0.1, uCover + 0.36, n);
    vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.07;
    float ns = fbm(cuv + toSun);
    float lit = clamp(0.55 + (n - ns) * 5.0, 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, lit);
    cc += uSunColor * pow(max(sd, 0.0), 6.0) * 0.7 * sunVis * (1.0 - c * 0.6);
    col = mix(col, cc, c * smoothstep(0.0, 0.32, h) * 0.9);
  }
  col *= uSkyI;
  // HDRI layer (clouds and colour from the Blender skies), shaped by our own gradient so the time of day wins
  if (uHdrMix > 0.0) {
    vec3 hc = hdrSample(d);
    col = mix(col, hc, uHdrMix * smoothstep(-0.05, 0.08, h));
  }
  float horizonMask = smoothstep(-0.03, 0.02, h);
  if (uEnvPass < 0.5) {
    // sun disk + glow (HDR: this is what blooms and drives the light shafts)
    float disk = smoothstep(0.99955, 0.99975, sd);
    float glow = pow(max(sd, 0.0), 300.0) * 1.4 + pow(max(sd, 0.0), 28.0) * 0.22;
    col += uSunColor * (disk * 40.0 + glow * 2.0) * sunVis * horizonMask;
    // moon
    float md = dot(d, uMoonDir);
    float moonVis = smoothstep(-0.05, 0.06, uMoonDir.y) * uNight;
    float mdisk = smoothstep(0.99935, 0.99955, md);
    float crater = 0.82 + 0.18 * noise(d.xy * 900.0);
    col += vec3(0.78, 0.86, 1.0) * (mdisk * 6.0 * crater + pow(max(md, 0.0), 400.0) * 0.8 + pow(max(md, 0.0), 30.0) * 0.06) * moonVis * horizonMask;
    // below the horizon: fade to the fog colour (the terrain / mountains cover most of it)
    col = mix(col, uGround * uSkyI, smoothstep(0.0, -0.06, h));
  } else {
    // env pass: soft sun lobe only (the sharp highlight comes from the directional light), ground bounce below
    col += uSunColor * pow(max(sd, 0.0), 12.0) * 0.6 * sunVis * horizonMask;
    col = mix(col, uGroundBounce, smoothstep(0.02, -0.12, h));
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
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
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * a * vAlpha * 1.6, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function blackTexture() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

export class Sky {
  constructor(scene) {
    const black = blackTexture();
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uGroundBounce: { value: new THREE.Color(0.02, 0.02, 0.015) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uCloudLit: { value: new THREE.Color() },
      uCloudDark: { value: new THREE.Color() },
      uTime: { value: 0 },
      uNight: { value: 0 },
      uCover: { value: 0.5 },
      uSkyI: { value: 1 },
      uEnvPass: { value: 0 },
      uHdr0: { value: black },
      uHdr1: { value: black },
      uHdr2: { value: black },
      uHdr3: { value: black },
      uHdrW: { value: new THREE.Vector4() },
      uHdrMix: { value: 0 },
      uHdrClamp: { value: 8 },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'sky',
      uniforms: this.uniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      // drawn after the opaque scene at the far plane: early-z skips every pixel covered by the world
      depthTest: true,
      fog: false,
    });
    this.geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    this.dome = new THREE.Mesh(this.geometry, mat);
    this.dome.name = 'sky';
    this.dome.renderOrder = 900;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // env-pass twin (shares every uniform except uEnvPass)
    this.envUniforms = { ...this.uniforms, uEnvPass: { value: 1 } };
    const envMat = new THREE.ShaderMaterial({
      name: 'skyEnv',
      uniforms: this.envUniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.envDome = new THREE.Mesh(this.geometry, envMat);
    this.envDome.name = 'skyEnv';
    this.envDome.frustumCulled = false;

    // stars
    const N = 1800;
    const pos = new Float32Array(N * 3), size = new Float32Array(N), phase = new Float32Array(N);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
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
