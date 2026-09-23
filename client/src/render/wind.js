// One wind field shared by the grass, the foliage of trees / bushes / flowers and cloth (banners, canopies).
// GLSL + shared uniforms: a slowly varying global direction and strength, low-frequency gusts travelling along the
// wind direction (you can watch them roll over the meadows), and a per-vertex flutter.
// Characters "bend" the grass around them through a small uniform array of benders.
import * as THREE from 'three';

export const MAX_BENDERS = 12;

export const WIND = {
  uWindTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
  uWindStrength: { value: 0.7 },
  uBenders: { value: Array.from({ length: MAX_BENDERS }, () => new THREE.Vector4(0, 0, 0, 0)) },
};

/** Declarations (uniforms + functions). Safe to include once per shader. */
export const WIND_PARS = /* glsl */ `
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
float bvWindHash(vec2 p) { p = fract(p * vec2(127.34, 311.71)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float bvWindNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bvWindHash(i), bvWindHash(i + vec2(1.0, 0.0)), f.x), mix(bvWindHash(i + vec2(0.0, 1.0)), bvWindHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
/** Gust intensity 0..1 at a world position (travelling along the wind). */
float bvGust(vec2 wp) {
  vec2 p = wp * 0.03 - uWindDir * uWindTime * 0.28;
  float g = bvWindNoise(p) * 0.65 + bvWindNoise(p * 2.3 + 7.1) * 0.35;
  return smoothstep(0.3, 0.85, g);
}
/**
 * Horizontal wind displacement at world position wp for a flexible element (xz metres per unit of bend).
 * phase: per-element random phase so neighbours don't move in lockstep.
 */
vec2 bvWind(vec2 wp, float phase) {
  float gust = bvGust(wp);
  float t = uWindTime;
  float sway = sin(t * 1.7 + phase * 6.2831 + dot(wp, vec2(0.21, 0.17))) * 0.5 + 0.5;
  float flutter = sin(t * 4.3 + phase * 11.0 + wp.x * 0.9) * 0.5 + sin(t * 6.1 + phase * 5.0 + wp.y * 1.1) * 0.25;
  float amount = uWindStrength * (0.22 + 0.78 * gust) * (0.55 + 0.45 * sway);
  vec2 side = vec2(-uWindDir.y, uWindDir.x);
  return uWindDir * amount + side * flutter * 0.18 * uWindStrength * (0.4 + gust);
}
`;

export const BENDER_PARS = /* glsl */ `
uniform vec4 uBenders[${MAX_BENDERS}];
/** Push away from characters (xz offset), falloff over each bender's radius. */
vec2 bvBend(vec2 wp) {
  vec2 push = vec2(0.0);
  for (int i = 0; i < ${MAX_BENDERS}; i++) {
    vec4 b = uBenders[i];
    if (b.z <= 0.0) continue;
    vec2 d = wp - b.xy;
    float l = length(d);
    float k = 1.0 - smoothstep(b.z * 0.3, b.z, l);
    push += (d / max(l, 0.05)) * k * b.w;
  }
  return push;
}
`;

/** Wind kinds by material name (ROADMAP §4.4) + a few legacy names of the v0.1 models. */
const KIND_RULES = [
  [/^(?:[a-z0-9]+_)*(grass|flower|petal|reed)/i, 'grass'],
  [/^(?:[a-z0-9]+_)*(leaf|leaves|foliage|needles|canopy)/i, 'leaf'],
  [/^(?:[a-z0-9]+_)*(cloth|banner|canvas|flag|sail)/i, 'cloth'],
];
/** Legacy names that must NOT move even though they contain a keyword (trunk / wood parts). */
const NEVER = /(bark|trunk|wood|stone|rock|iron|metal|stem|branch|log|pole)/i;

/** Wind kind of a material ('leaf' | 'grass' | 'cloth' | null). */
export function windKindOf(material) {
  const name = String(material?.name || '');
  if (!name || NEVER.test(name)) return null;
  for (const [re, kind] of KIND_RULES) if (re.test(name)) return kind;
  return null;
}

/** Amplitude (metres of sway at the top of a 1 m tall element, scaled by height) per kind. */
export const WIND_AMP = { leaf: 0.055, grass: 0.22, cloth: 0.12 };
export const WIND_KIND_CODE = { leaf: 1, grass: 2, cloth: 3 };
/** v0.1 models whose foliage material has no wind name: model key → kind. */
export const LEGACY_WIND = { bush: 'leaf', flowers: 'grass' };

/**
 * Wind parameters of one part: { kind, amp, base } or null. `bbox` = the part's bounding box (model space).
 * Leaves bend from the model origin (trunks stay still), grass / flowers from their own base, cloth hangs from
 * its top edge.
 */
export function windParamsFor(material, bbox, modelKey, modelHasNamedWind) {
  let kind = windKindOf(material);
  if (!kind && !modelHasNamedWind && LEGACY_WIND[modelKey] && !/(bark|trunk|wood|stone|rock|iron|metal|stem|branch|log)/i.test(material?.name || '')) {
    kind = LEGACY_WIND[modelKey];
  }
  if (!kind) return null;
  const base = kind === 'leaf' ? 0.1 : kind === 'cloth' ? (bbox ? bbox.max.y : 1) : Math.max(0, bbox ? bbox.min.y : 0);
  return { kind, amp: WIND_AMP[kind], base };
}

let _t = 0;
let _dirA = 0.65;
/** Per-frame update: time, slowly veering direction and breathing strength. */
export function updateWind(dt, time, benders) {
  _t = time;
  WIND.uWindTime.value = time;
  _dirA = 0.65 + Math.sin(time * 0.013) * 0.35 + Math.sin(time * 0.037) * 0.12;
  WIND.uWindDir.value.set(Math.cos(_dirA), Math.sin(_dirA));
  WIND.uWindStrength.value = 0.62 + 0.22 * Math.sin(time * 0.071) + 0.12 * Math.sin(time * 0.19 + 1.3);
  const arr = WIND.uBenders.value;
  let n = 0;
  if (benders) {
    for (const b of benders) {
      if (n >= MAX_BENDERS) break;
      arr[n++].set(b.x, b.z, b.r, b.s ?? 1);
    }
  }
  for (let i = n; i < MAX_BENDERS; i++) arr[i].set(0, 0, 0, 0);
}

export function windTime() {
  return _t;
}
