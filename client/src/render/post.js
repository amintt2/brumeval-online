// HDR post-processing pipeline (WebGL2, full-screen passes, every target reused):
//   scene (half-float colour + depth texture)
//   → ambient occlusion (SAO-style, half resolution, depth-aware blur in the composite)   [option "occlusion"]
//   → light shafts (radial march of the sky mask towards the sun, half resolution)        [option "brouillard"]
//   → composite: AO + volumetric-looking height fog (analytic integral, drifting density, sun in-scattering) + shafts
//   → bloom (13-tap downsample / tent upsample chain, soft threshold)
//   → exposure + AgX (punchy look) + colour grade (warm highlights / cool shadows) + vignette + film grain
//   → SMAA → screen (upscales when the dynamic resolution is below 1).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const quadVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `
float perspectiveDepthToViewZ(float depth, float near, float far) { return (near * far) / ((far - near) * depth - far); }
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform float uNear;
uniform float uFar;
vec3 viewPosAt(vec2 uv, float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 v = uProjInv * ndc;
  return v.xyz / v.w;
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

// ------------------------------------------------------------------ ambient occlusion
const aoFrag = /* glsl */ `
${COMMON}
uniform vec2 uTexel;      // full-resolution depth texel
uniform float uRadius;    // metres
uniform float uProjScale; // pixels per metre at 1 m
uniform float uIntensity;
varying vec2 vUv;
#define AO_SAMPLES 12
#define AO_TURNS 7.0
vec3 posAt(vec2 uv) { return viewPosAt(uv, textureLod(tDepth, uv, 0.0).x); }
void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPosAt(vUv, d);
  vec3 Pr = posAt(vUv + vec2(uTexel.x, 0.0)), Pl = posAt(vUv - vec2(uTexel.x, 0.0));
  vec3 Pu = posAt(vUv + vec2(0.0, uTexel.y)), Pd = posAt(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  float rPx = uRadius * uProjScale / max(0.1, -P.z);
  if (rPx < 1.5) { gl_FragColor = vec4(1.0); return; }
  rPx = min(rPx, 90.0);
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  float sum = 0.0;
  float r2 = uRadius * uRadius;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(AO_SAMPLES);
    float a = t * AO_TURNS * 6.2831853 + rot;
    vec2 suv = vUv + vec2(cos(a), sin(a)) * (rPx * t) * uTexel;
    vec3 S = posAt(suv);
    vec3 v = S - P;
    float vv = dot(v, v);
    float vn = dot(v, N);
    float f = max(r2 - vv, 0.0) / r2;
    sum += f * f * max((vn - 0.02 * -P.z * 0.02) / (0.01 + vv), 0.0) * max(0.0, 1.0 - vv / (r2 * 4.0) );
  }
  float ao = max(0.0, 1.0 - sum * uIntensity * 2.2 / float(AO_SAMPLES));
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;

// ------------------------------------------------------------------ light shafts
const shaftFrag = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uSunUv;
uniform float uAspect;
varying vec2 vUv;
#define SHAFT_SAMPLES 40
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec2 delta = (uSunUv - vUv);
  float dist = length(delta * vec2(uAspect, 1.0));
  delta *= 0.9 / float(SHAFT_SAMPLES);
  vec2 uv = vUv + delta * ign(gl_FragCoord.xy);
  float acc = 0.0;
  float w = 1.0;
  for (int i = 0; i < SHAFT_SAMPLES; i++) {
    float sky = step(0.99999, textureLod(tDepth, clamp(uv, 0.001, 0.999), 0.0).x);
    // only the sky around the sun emits
    float near = 1.0 - smoothstep(0.0, 0.55, length((uv - uSunUv) * vec2(uAspect, 1.0)));
    acc += sky * near * w;
    w *= 0.975;
    uv += delta;
  }
  float s = acc / float(SHAFT_SAMPLES);
  s *= 1.0 - smoothstep(0.4, 1.4, dist);
  gl_FragColor = vec4(s, s, s, 1.0);
}`;

// ------------------------------------------------------------------ composite (AO + height fog + shafts)
const compositeFrag = /* glsl */ `
${COMMON}
uniform sampler2D tColor;
uniform sampler2D tAO;
uniform sampler2D tShafts;
uniform vec2 uAoTexel;
uniform float uAO;
uniform float uFog;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uFogBase;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uShafts;
uniform float uTime;
uniform vec2 uWind;
varying vec2 vUv;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  bool sky = d >= 0.99999;
  // --- ambient occlusion (depth-aware 3x3 blur of the half-resolution AO)
  if (uAO > 0.5 && !sky) {
    float zc = perspectiveDepthToViewZ(d, uNear, uFar);
    float sum = 0.0, wsum = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)) * uAoTexel;
      float zs = perspectiveDepthToViewZ(textureLod(tDepth, vUv + o, 0.0).x, uNear, uFar);
      float w = 1.0 / (0.02 + abs(zs - zc) / max(1.0, -zc) * 40.0);
      sum += textureLod(tAO, vUv + o, 0.0).r * w;
      wsum += w;
    }
    float ao = sum / wsum;
    col *= mix(1.0, ao, 0.85);
  }
  if (uFog > 0.5) {
    // --- analytic exponential height fog along the view ray
    vec3 vp = viewPosAt(vUv, sky ? 0.9999 : d);
    vec3 wp = (uViewInv * vec4(vp, 1.0)).xyz;
    vec3 ray = wp - uCamPos;
    float len = length(ray);
    vec3 rd = ray / max(len, 1e-4);
    if (sky) len = 520.0;
    float cy = uCamPos.y - uFogBase;
    float dy = rd.y * len;
    float k = uFogFalloff;
    float heightTerm = abs(dy * k) > 1e-3 ? (1.0 - exp(-dy * k)) / (dy * k) : 1.0;
    // drifting density (clumps of mist rolling with the wind)
    vec2 np = (uCamPos.xz + rd.xz * min(len, 90.0) * 0.5) * 0.018 + uWind * uTime * 0.012;
    float clump = 0.7 + 0.6 * vnoise(np) * vnoise(np * 2.7 + 3.1);
    float optical = uFogDensity * clump * exp(-cy * k) * len * heightTerm;
    float trans = exp(-optical);
    // in-scattering: ambient fog colour + forward (Mie-like) scattering of the sun
    float mu = dot(rd, uSunDir);
    float g = 0.62;
    float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.0795775;
    vec3 inscatter = uFogColor + uSunColor * hg * 0.9;
    if (sky) trans = mix(1.0, trans, smoothstep(0.55, -0.02, rd.y)); // keep the zenith clear
    col = col * trans + inscatter * (1.0 - trans);
    // --- light shafts
    col += uSunColor * texture2D(tShafts, vUv).r * uShafts;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------ bloom
const bloomPrefilterFrag = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
vec3 karis(vec3 c) { return c / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)) * 0.25); }
void main() {
  // 4-tap box with Karis weighting (kills fireflies)
  vec3 a = texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  vec3 c = texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  vec3 d = texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  vec3 col = (karis(a) + karis(b) + karis(c) + karis(d)) * 0.25;
  col = min(col, vec3(60.0));
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(col * contrib, 1.0);
}`;

const bloomDownFrag = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  // 13-tap downsample (Call of Duty: Advanced Warfare)
  vec2 t = uTexel;
  vec3 a = texture2D(tColor, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(tColor, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(tColor, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(tColor, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(tColor, vUv).rgb;
  vec3 f = texture2D(tColor, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(tColor, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(tColor, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(tColor, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(tColor, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(tColor, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(tColor, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(tColor, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(col, 1.0);
}`;

const bloomUpFrag = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main() {
  // 3x3 tent upsample, blended additively onto the larger mip
  vec2 t = uTexel * uRadius;
  vec3 col = texture2D(tColor, vUv).rgb * 4.0;
  col += (texture2D(tColor, vUv + vec2(-t.x, 0.0)).rgb + texture2D(tColor, vUv + vec2(t.x, 0.0)).rgb
        + texture2D(tColor, vUv + vec2(0.0, -t.y)).rgb + texture2D(tColor, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  col += texture2D(tColor, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tColor, vUv + vec2(t.x, -t.y)).rgb
       + texture2D(tColor, vUv + vec2(-t.x, t.y)).rgb + texture2D(tColor, vUv + vec2(t.x, t.y)).rgb;
  gl_FragColor = vec4(col / 16.0, 1.0);
}`;

// ------------------------------------------------------------------ final: tone mapping + grade
const finalFrag = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;

const mat3 LIN_SRGB_TO_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 LIN_REC2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
// AgX (Blender / Filament) with a slightly punchy look
vec3 agx(vec3 color) {
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  color = LIN_SRGB_TO_REC2020 * color;
  color = inset * color;
  color = max(color, 1e-10);
  color = clamp((log2(color) - minEv) / (maxEv - minEv), 0.0, 1.0);
  color = agxContrast(color);
  // look: power + saturation (in AgX log space)
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(max(color, 0.0), vec3(1.12));
  color = luma + (color - luma) * 1.18;
  color = outset * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  color = LIN_REC2020_TO_SRGB * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec3 hdr = texture2D(tColor, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
  vec3 c = agx(hdr * uExposure);
  // colour grade (display-linear): split toning, contrast around mid grey, saturation
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float hi = smoothstep(0.25, 0.85, l);
  c *= mix(uShadowTint, uHighlightTint, hi);
  c = (c - 0.18) * uContrast + 0.18;
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(vec3(0.0), l + (c - l) * uSaturation);
  // vignette
  vec2 q = vUv - 0.5;
  q.x *= uResolution.x / uResolution.y;
  c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
  vec3 g = toSRGB(clamp(c, 0.0, 1.0));
  // film grain (in display space, strongest in the mid tones)
  float n = hash(gl_FragCoord.xy + fract(uTime * 13.37) * 311.0) - 0.5;
  g += n * uGrain * (1.0 - abs(l - 0.5) * 1.2);
  gl_FragColor = vec4(g, 1.0);
}`;

function rt(w, h, opts = {}) {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
    ...opts,
  });
  t.texture.generateMipmaps = false;
  return t;
}

function mat(fragmentShader, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: quadVert,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    ...extra,
  });
}

const BLOOM_LEVELS = 5;
const _v = new THREE.Vector3();

export class PostPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.width = 1;
    this.height = 1;
    this.options = { ao: true, fog: true };
    this.params = {
      exposure: 1,
      bloom: 0.9,
      bloomThreshold: 1.1,
      fogColor: new THREE.Color(0.7, 0.7, 0.7),
      fogDensity: 0.007,
      fogFalloff: 0.05,
      fogBase: -1.2,
      shafts: 0.6,
      sunDir: new THREE.Vector3(0, 1, 0),
      sunColor: new THREE.Color(1, 1, 1),
      night: 0,
    };
    const depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.sceneRT = rt(1, 1, { depthBuffer: true, depthTexture });
    this.aoRT = rt(1, 1, { type: THREE.UnsignedByteType });
    this.shaftRT = rt(1, 1, { type: THREE.UnsignedByteType });
    this.compRT = rt(1, 1);
    this.ldrRT = rt(1, 1, { type: THREE.UnsignedByteType });
    this.bloomRTs = Array.from({ length: BLOOM_LEVELS }, () => rt(1, 1));

    const common = () => ({
      tDepth: { value: depthTexture },
      uProjInv: { value: new THREE.Matrix4() },
      uViewInv: { value: new THREE.Matrix4() },
      uNear: { value: 0.3 },
      uFar: { value: 1200 },
    });
    this.aoMat = mat(aoFrag, {
      ...common(), uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.1 }, uProjScale: { value: 500 }, uIntensity: { value: 1.2 },
    });
    this.shaftMat = mat(shaftFrag, { tDepth: { value: depthTexture }, uSunUv: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
    this.compMat = mat(compositeFrag, {
      ...common(),
      tColor: { value: this.sceneRT.texture },
      tAO: { value: this.aoRT.texture },
      tShafts: { value: this.shaftRT.texture },
      uAoTexel: { value: new THREE.Vector2() },
      uAO: { value: 1 },
      uFog: { value: 1 },
      uCamPos: { value: new THREE.Vector3() },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0.007 },
      uFogFalloff: { value: 0.05 },
      uFogBase: { value: -1.2 },
      uSunDir: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color() },
      uShafts: { value: 0 },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
    });
    this.prefilterMat = mat(bloomPrefilterFrag, {
      tColor: { value: this.compRT.texture }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 },
    });
    this.downMat = mat(bloomDownFrag, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = mat(bloomUpFrag, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } }, {
      blending: THREE.AdditiveBlending, transparent: true,
    });
    this.finalMat = mat(finalFrag, {
      tColor: { value: this.compRT.texture },
      tBloom: { value: this.bloomRTs[0].texture },
      uBloom: { value: 0.06 },
      uExposure: { value: 1 },
      uSaturation: { value: 1.05 },
      uContrast: { value: 1.06 },
      uShadowTint: { value: new THREE.Vector3(0.93, 0.98, 1.08) },
      uHighlightTint: { value: new THREE.Vector3(1.06, 1.0, 0.9) },
      uVignette: { value: 0.28 },
      uGrain: { value: 0.022 },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
    });
    this.quad = new FullScreenQuad(this.aoMat);
    this.smaa = new SMAAPass();
    this.smaa.renderToScreen = true;
    this._sunNdc = new THREE.Vector3();
  }

  setOptions({ ao, fog }) {
    this.options.ao = !!ao;
    this.options.fog = !!fog;
  }

  /** Internal render size in device pixels. */
  setSize(w, h) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.sceneRT.setSize(w, h);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    this.aoRT.setSize(hw, hh);
    this.shaftRT.setSize(hw, hh);
    this.compRT.setSize(w, h);
    this.ldrRT.setSize(w, h);
    let bw = hw, bh = hh;
    for (const b of this.bloomRTs) {
      b.setSize(Math.max(1, bw), Math.max(1, bh));
      bw >>= 1; bh >>= 1;
    }
    this.smaa.setSize(w, h);
    this.aoMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.compMat.uniforms.uAoTexel.value.set(1 / hw, 1 / hh);
    this.finalMat.uniforms.uResolution.value.set(w, h);
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  /** Render `scene` through the whole pipeline to the screen. */
  render(scene, camera, time) {
    const r = this.renderer;
    const P = this.params;
    const prevAuto = r.autoClear;
    r.autoClear = true;
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);
    // full-screen passes overwrite their target (and the bloom upsample blends onto it): no clears
    r.autoClear = false;

    const projInv = camera.projectionMatrixInverse;
    for (const m of [this.aoMat, this.compMat]) {
      m.uniforms.uProjInv.value.copy(projInv);
      m.uniforms.uViewInv.value.copy(camera.matrixWorld);
      m.uniforms.uNear.value = camera.near;
      m.uniforms.uFar.value = camera.far;
    }
    const C = this.compMat.uniforms;
    // --- AO
    C.uAO.value = this.options.ao ? 1 : 0;
    if (this.options.ao) {
      this.aoMat.uniforms.uProjScale.value = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      this._pass(this.aoMat, this.aoRT);
    }
    // --- shafts (sun or moon position on screen)
    C.uFog.value = this.options.fog ? 1 : 0;
    let shafts = 0;
    if (this.options.fog && P.shafts > 0.01) {
      const s = this._sunNdc.copy(P.sunDir).multiplyScalar(500).add(camera.position).project(camera);
      camera.getWorldDirection(_v);
      const facing = _v.dot(P.sunDir);
      if (facing > 0.05 && s.z < 1) {
        const off = Math.max(Math.abs(s.x), Math.abs(s.y));
        shafts = P.shafts * THREE.MathUtils.smoothstep(facing, 0.05, 0.45) * (1 - THREE.MathUtils.smoothstep(off, 1.0, 1.9));
        if (shafts > 0.005) {
          this.shaftMat.uniforms.uSunUv.value.set(s.x * 0.5 + 0.5, s.y * 0.5 + 0.5);
          this.shaftMat.uniforms.uAspect.value = this.width / this.height;
          this._pass(this.shaftMat, this.shaftRT);
        }
      }
    }
    if (shafts <= 0.005) { shafts = 0; }
    // --- composite
    C.uCamPos.value.copy(camera.position);
    C.uFogColor.value.copy(P.fogColor);
    C.uFogDensity.value = P.fogDensity;
    C.uFogFalloff.value = P.fogFalloff;
    C.uFogBase.value = P.fogBase;
    C.uSunDir.value.copy(P.sunDir);
    C.uSunColor.value.copy(P.sunColor);
    C.uShafts.value = shafts;
    C.uTime.value = time;
    if (P.wind) C.uWind.value.copy(P.wind);
    this._pass(this.compMat, this.compRT);
    // --- bloom
    const B = this.bloomRTs;
    this.prefilterMat.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
    this.prefilterMat.uniforms.uThreshold.value = P.bloomThreshold;
    this.prefilterMat.uniforms.uKnee.value = P.bloomThreshold * 0.5;
    this._pass(this.prefilterMat, B[0]);
    for (let i = 1; i < B.length; i++) {
      this.downMat.uniforms.tColor.value = B[i - 1].texture;
      this.downMat.uniforms.uTexel.value.set(1 / B[i - 1].width, 1 / B[i - 1].height);
      this._pass(this.downMat, B[i]);
    }
    for (let i = B.length - 1; i > 0; i--) {
      this.upMat.uniforms.tColor.value = B[i].texture;
      this.upMat.uniforms.uTexel.value.set(1 / B[i].width, 1 / B[i].height);
      this._pass(this.upMat, B[i - 1]);
    }
    // --- final grade → LDR → SMAA → screen
    const F = this.finalMat.uniforms;
    F.uExposure.value = P.exposure;
    F.uBloom.value = P.bloom * 0.07;
    F.uTime.value = time;
    // nights: cooler shadows, less warmth
    const n = P.night;
    F.uShadowTint.value.set(0.94 - n * 0.04, 0.98, 1.07 + n * 0.06);
    F.uHighlightTint.value.set(1.07 - n * 0.06, 1.0, 0.9 + n * 0.08);
    F.uSaturation.value = 1.04 - n * 0.12;
    this._pass(this.finalMat, this.ldrRT);
    // SMAA's edge / weight passes discard pixels: they rely on the automatic clear
    r.autoClear = true;
    this.smaa.render(r, null, this.ldrRT);
    r.setRenderTarget(null);
    r.autoClear = prevAuto;
  }

  dispose() {
    for (const t of [this.sceneRT, this.aoRT, this.shaftRT, this.compRT, this.ldrRT, ...this.bloomRTs]) t.dispose();
    this.sceneRT.depthTexture?.dispose();
    for (const m of [this.aoMat, this.shaftMat, this.compMat, this.prefilterMat, this.downMat, this.upMat, this.finalMat]) m.dispose();
    this.quad.dispose();
    this.smaa.dispose();
  }
}
