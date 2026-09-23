// Shader patches for the shared static-scenery materials (applied once, uniforms shared and updated per frame):
//  - "see-through": fragments of trees / houses / rocks lying on the line of sight between the camera and the
//    player are dither-discarded, so the character never disappears behind the foliage;
//  - "wind": foliage / grass / cloth sway with the shared wind field (wind.js). The amplitude grows with the
//    height above the model origin; trunks, stone and metal never move (their materials are not patched).
// Both are also applied to the shadow depth material of swaying parts so their shadows move with them.
import * as THREE from 'three';
import { WIND, WIND_PARS } from './wind.js';

export const SEE_THROUGH = {
  uSTCam: { value: new THREE.Vector3() },
  uSTTarget: { value: new THREE.Vector3() },
  uSTRadius: { value: 0 },
  uWindTime: WIND.uWindTime,
};

const VERT_DECL = `#include <common>\nvarying vec3 vSTWorld;\n${WIND_PARS}`;

/**
 * kind: 'leaf' | 'grass' | 'cloth' (constants baked in the shader) or 'attr' (per-vertex attribute
 * aWind = (kind code 0 none / 1 leaf / 2 grass / 3 cloth, amplitude, base height) — merged models);
 * amp: metres of sway per metre of height; base: height where the sway starts (cloth: its top edge).
 */
function windCode(kind, amp, base) {
  let params;
  if (kind === 'attr') {
    params = `float wKind = aWind.x; float wAmp = aWind.y; float wBase = aWind.z;
  if (wKind < 0.5) wAmp = 0.0;
  float wH = wKind > 2.5 ? max(0.0, wBase - transformed.y) : max(0.0, transformed.y - wBase);
  float wFlK = wKind > 2.5 ? 0.35 : wKind > 1.5 ? 0.2 : 0.08;
  float wBendH = wKind < 1.5 ? wH * wH / max(0.5, wH + 1.0) : wH;`;
  } else {
    const flutter = kind === 'cloth' ? '0.35' : kind === 'grass' ? '0.2' : '0.08';
    params = `float wAmp = ${amp.toFixed(4)};
  float wH = ${kind === 'cloth' ? `max(0.0, ${base.toFixed(3)} - transformed.y)` : `max(0.0, transformed.y - ${base.toFixed(3)})`};
  float wFlK = ${flutter};
  float wBendH = ${kind === 'leaf' ? 'wH * wH / max(0.5, wH + 1.0)' : 'wH'};`;
  }
  return `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    vec3 wOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float wScale = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  #else
    vec3 wOrigin = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
    float wScale = 1.0;
  #endif
  ${params}
  float wPhase = fract(wOrigin.x * 0.137 + wOrigin.z * 0.071);
  vec2 wv = bvWind(wOrigin.xz + transformed.xz * 0.2, wPhase);
  // bend (quadratic with the height for leaves) + a small per-vertex flutter
  float wBend = wBendH * wAmp / max(wScale, 0.3);
  float wFl = sin(uWindTime * 5.3 + dot(transformed, vec3(3.1, 2.3, 2.7)) + wPhase * 6.28) * wFlK * wH * wAmp * uWindStrength;
  // wind is in world space: rotate it into the object's space (instances are only rotated around Y)
  #ifdef USE_INSTANCING
    mat3 wRot = mat3(instanceMatrix) / max(wScale, 1e-4);
    vec3 wLocal = transpose(wRot) * vec3(wv.x, 0.0, wv.y);
  #else
    vec3 wLocal = vec3(wv.x, 0.0, wv.y);
  #endif
  transformed.x += wLocal.x * wBend + wFl;
  transformed.z += wLocal.z * wBend + wFl * 0.6;
  transformed.y += wFl * 0.3 - wBend * 0.15 * length(wv);
}`;
}

const VERT_CODE = `#include <project_vertex>
{
  vec4 stW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    stW = instanceMatrix * stW;
  #endif
  vSTWorld = (modelMatrix * stW).xyz;
}`;
const FRAG_DECL = `#include <common>
varying vec3 vSTWorld;
uniform vec3 uSTCam;
uniform vec3 uSTTarget;
uniform float uSTRadius;`;
const FRAG_CODE = `#include <clipping_planes_fragment>
if (uSTRadius > 0.0) {
  vec3 ab = uSTTarget - uSTCam;
  float len2 = max(dot(ab, ab), 1e-4);
  float len = sqrt(len2);
  float t = clamp(dot(vSTWorld - uSTCam, ab) / len2, 0.0, 1.0);
  float along = t * len;
  if (along < len - 0.7) {
    float r = uSTRadius * mix(0.45, 1.0, t);
    float d = length(vSTWorld - (uSTCam + ab * t));
    float fade = 1.0 - smoothstep(r * 0.55, r, d);
    fade *= smoothstep(0.4, 1.4, along);
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (ign < fade * 0.92) discard;
  }
}`;

function windUniforms(sh) {
  for (const [k, v] of Object.entries(WIND)) sh.uniforms[k] = v;
}

/**
 * Patch a (shared) static material.
 * opts: { seeThrough = true, wind: null | 'leaf' | 'grass' | 'cloth', amp (sway per metre), base (height where
 * the sway starts, metres) }. wind = 'attr': per-vertex aWind attribute (merged models, amp ignored).
 */
export function patchStaticMaterial(material, opts = {}) {
  if (!material || material.userData.staticPatch) return;
  if (!material.isMeshStandardMaterial && !material.isMeshLambertMaterial && !material.isMeshPhongMaterial) return;
  const see = opts.seeThrough !== false;
  const wind = opts.wind || null;
  const amp = opts.amp || 0;
  const base = opts.base ?? 0.1;
  if (!see && !wind) return;
  material.userData.staticPatch = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (sh, r) => {
    prev.call(material, sh, r);
    sh.uniforms.uSTCam = SEE_THROUGH.uSTCam;
    sh.uniforms.uSTTarget = SEE_THROUGH.uSTTarget;
    sh.uniforms.uSTRadius = see ? SEE_THROUGH.uSTRadius : { value: 0 };
    windUniforms(sh);
    let v = sh.vertexShader.replace('#include <common>', wind === 'attr' ? `${VERT_DECL}
attribute vec3 aWind;` : VERT_DECL).replace('#include <project_vertex>', VERT_CODE);
    if (wind && amp > 0) v = v.replace('#include <begin_vertex>', windCode(wind, amp, base));
    sh.vertexShader = v;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', FRAG_DECL).replace('#include <clipping_planes_fragment>', FRAG_CODE);
  };
  const key = `|static:${see ? 1 : 0}:${wind || '-'}:${amp.toFixed(4)}:${base.toFixed(3)}`;
  material.customProgramCacheKey = () => `${prevKey.call(material)}${key}`;
  material.needsUpdate = true;
  if (wind && amp > 0) material.userData.windDepth = makeWindDepthMaterial(material, wind, amp, base);
}

/** Depth material with the same sway (for shadows of foliage / cloth, keeps alpha-tested leaves cut out). */
function makeWindDepthMaterial(src, kind, amp, base) {
  const m = new THREE.MeshDepthMaterial();
  m.map = src.map || null;
  m.alphaMap = src.alphaMap || null;
  m.alphaTest = src.alphaTest || 0;
  m.side = src.side;
  m.onBeforeCompile = (sh) => {
    windUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_PARS}${kind === 'attr' ? '\nattribute vec3 aWind;' : ''}`)
      .replace('#include <begin_vertex>', windCode(kind, amp, base));
  };
  m.customProgramCacheKey = () => `winddepth:${kind}:${amp.toFixed(4)}:${base.toFixed(3)}`;
  return m;
}

/** Back-compat helper: see-through only. */
export function applySeeThrough(material) {
  patchStaticMaterial(material, { seeThrough: true });
}

/** Per frame: line of sight from the camera to the player's chest (radius 0 disables). The wind clock is in wind.js. */
export function updateSeeThrough(camPos, target, radius) {
  SEE_THROUGH.uSTCam.value.copy(camPos);
  SEE_THROUGH.uSTTarget.value.copy(target);
  SEE_THROUGH.uSTRadius.value = radius;
}
