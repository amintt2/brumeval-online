// Shader patches for the shared static-scenery materials (applied once, uniforms shared and updated per frame):
//  - "see-through": fragments of trees / houses / rocks lying on the line of sight between the camera and the
//    player are dither-discarded, so the character never disappears behind the foliage;
//  - "wind": foliage sways gently (amplitude grows with height; phase from the instance position).
// The shadow pass uses depth materials and is not affected.
import * as THREE from 'three';

export const SEE_THROUGH = {
  uSTCam: { value: new THREE.Vector3() },
  uSTTarget: { value: new THREE.Vector3() },
  uSTRadius: { value: 0 },
  uWindTime: { value: 0 },
};

const VERT_DECL = '#include <common>\nvarying vec3 vSTWorld;\nuniform float uWindTime;';
const VERT_WIND = `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    vec3 wOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  #else
    vec3 wOrigin = vec3(0.0);
  #endif
  float wH = max(0.0, transformed.y - WIND_BASE);
  float wPhase = uWindTime * 1.7 + wOrigin.x * 0.37 + wOrigin.z * 0.23;
  float gust = 0.75 + 0.25 * sin(uWindTime * 0.31 + wOrigin.x * 0.05);
  transformed.x += sin(wPhase) * wH * WIND_AMP * gust;
  transformed.z += cos(wPhase * 0.83) * wH * WIND_AMP * 0.6 * gust;
}`;
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

function makePatch(windAmp, windBase) {
  return (sh) => {
    sh.uniforms.uSTCam = SEE_THROUGH.uSTCam;
    sh.uniforms.uSTTarget = SEE_THROUGH.uSTTarget;
    sh.uniforms.uSTRadius = SEE_THROUGH.uSTRadius;
    sh.uniforms.uWindTime = SEE_THROUGH.uWindTime;
    let v = sh.vertexShader.replace('#include <common>', VERT_DECL).replace('#include <project_vertex>', VERT_CODE);
    if (windAmp > 0) v = v.replace('#include <begin_vertex>', VERT_WIND.replace(/WIND_AMP/g, windAmp.toFixed(4)).replace(/WIND_BASE/g, windBase.toFixed(3)));
    sh.vertexShader = v;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', FRAG_DECL).replace('#include <clipping_planes_fragment>', FRAG_CODE);
  };
}

/**
 * Patch a (shared) static material.
 * opts: { seeThrough = true, wind = 0 (sway per metre of height), windBase = 0.8 (height where sway starts) }.
 */
export function patchStaticMaterial(material, opts = {}) {
  if (!material || material.userData.staticPatch) return;
  if (!material.isMeshStandardMaterial && !material.isMeshLambertMaterial && !material.isMeshPhongMaterial) return;
  const see = opts.seeThrough !== false;
  const wind = opts.wind || 0;
  const windBase = opts.windBase ?? 0.8;
  if (!see && !wind) return;
  material.userData.staticPatch = true;
  const patch = makePatch(wind, windBase);
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (sh, r) => {
    prev.call(material, sh, r);
    patch(sh);
    if (!see) {
      // keep the uniform declared but never active for this material
      sh.uniforms.uSTRadius = { value: 0 };
    }
  };
  const key = `|static:${see ? 1 : 0}:${wind.toFixed(4)}:${windBase.toFixed(3)}`;
  material.customProgramCacheKey = () => `${prevKey.call(material)}${key}`;
  material.needsUpdate = true;
}

/** Back-compat helper: see-through only. */
export function applySeeThrough(material) {
  patchStaticMaterial(material, { seeThrough: true });
}

/** Per frame: line of sight from the camera to the player's chest (radius 0 disables) + wind clock. */
export function updateSeeThrough(camPos, target, radius, time = 0) {
  SEE_THROUGH.uSTCam.value.copy(camPos);
  SEE_THROUGH.uSTTarget.value.copy(target);
  SEE_THROUGH.uSTRadius.value = radius;
  SEE_THROUGH.uWindTime.value = time;
}
