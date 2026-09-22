// Renderer, scene, camera, lights, fog and the day/night cycle.
import * as THREE from 'three';
import { Sky } from './sky.js';
import { CAMERA, RENDER, URLP } from '../config.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, URLP.quality === 'low' ? 1 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = URLP.quality !== 'low';
  // PCFShadowMap is the soft (Vogel-disk filtered) PCF in three r18x; PCFSoftShadowMap was removed.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x0b0d12, 1);
  return renderer;
}

export function createCamera() {
  const cam = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);
  cam.position.set(0, 20, 30);
  return cam;
}

// ------------------------------------------------------------------ day / night palette
// Sky / fog colours are "screen" colours (shown untonemapped). Light colours are linear-ish artist values.
const KEYS = [
  { t: 0.0, top: '#03060f', hor: '#121a30', fog: '#111829', ground: '#0d1220', sun: '#ffb070', sunI: 0, moonI: 0.75,
    hemiSky: '#4a5f96', hemiGround: '#1d1f2a', hemiI: 0.75, dens: 0.0078, stars: 1, night: 1, cover: 0.62, cloudLit: '#2a3450', cloudDark: '#0e1322' },
  { t: 0.19, top: '#070d22', hor: '#1d2440', fog: '#1a2136', ground: '#131a2c', sun: '#ff9a60', sunI: 0, moonI: 0.6,
    hemiSky: '#4d5a8c', hemiGround: '#1f2029', hemiI: 0.72, dens: 0.0078, stars: 0.9, night: 1, cover: 0.6, cloudLit: '#343c5c', cloudDark: '#141a2c' },
  { t: 0.235, top: '#1e3160', hor: '#c9807a', fog: '#8a6f78', ground: '#4a3f4c', sun: '#ff8a4c', sunI: 0.6, moonI: 0.2,
    hemiSky: '#7a82b0', hemiGround: '#3a2f30', hemiI: 0.72, dens: 0.0068, stars: 0.35, night: 0.8, cover: 0.56, cloudLit: '#ffb08a', cloudDark: '#6a5570' },
  { t: 0.27, top: '#3d6cb0', hor: '#f3b98a', fog: '#d9b49a', ground: '#8a7a70', sun: '#ffb778', sunI: 1.9, moonI: 0,
    hemiSky: '#a9bde0', hemiGround: '#5a4a3c', hemiI: 0.85, dens: 0.0062, stars: 0, night: 0.35, cover: 0.54, cloudLit: '#ffe2c8', cloudDark: '#b09098' },
  { t: 0.33, top: '#3f7fd2', hor: '#bfdaf0', fog: '#b7d0e2', ground: '#9aaab4', sun: '#ffe7c4', sunI: 2.8, moonI: 0,
    hemiSky: '#bcd6f2', hemiGround: '#6a5a44', hemiI: 0.95, dens: 0.0056, stars: 0, night: 0, cover: 0.52, cloudLit: '#ffffff', cloudDark: '#c3cfdc' },
  { t: 0.5, top: '#2f72d6', hor: '#b8daf5', fog: '#b0d0e8', ground: '#9aacbc', sun: '#fff5e6', sunI: 3.1, moonI: 0,
    hemiSky: '#c6ddf6', hemiGround: '#6e5d46', hemiI: 1.0, dens: 0.0052, stars: 0, night: 0, cover: 0.5, cloudLit: '#ffffff', cloudDark: '#c8d4e2' },
  { t: 0.67, top: '#3a74c8', hor: '#cfdde6', fog: '#c6d4de', ground: '#a0a8b0', sun: '#ffe4bc', sunI: 2.7, moonI: 0,
    hemiSky: '#c0d2ea', hemiGround: '#6a5840', hemiI: 0.95, dens: 0.0056, stars: 0, night: 0, cover: 0.52, cloudLit: '#fff8ee', cloudDark: '#c4c8d4' },
  { t: 0.73, top: '#34508e', hor: '#f4a46c', fog: '#d49a7c', ground: '#86706a', sun: '#ff9c58', sunI: 1.8, moonI: 0,
    hemiSky: '#a39ec0', hemiGround: '#5a4232', hemiI: 0.85, dens: 0.0062, stars: 0, night: 0.35, cover: 0.55, cloudLit: '#ffc49a', cloudDark: '#8a6a78' },
  { t: 0.765, top: '#1b2654', hor: '#b86a62', fog: '#6e5262', ground: '#3e3242', sun: '#ff7040', sunI: 0.5, moonI: 0.15,
    hemiSky: '#6c6c9c', hemiGround: '#33272a', hemiI: 0.72, dens: 0.0068, stars: 0.35, night: 0.8, cover: 0.58, cloudLit: '#d07a6a', cloudDark: '#3a3048' },
  { t: 0.81, top: '#060b1e', hor: '#1c2240', fog: '#191f36', ground: '#121829', sun: '#ff9a60', sunI: 0, moonI: 0.6,
    hemiSky: '#4d5a8c', hemiGround: '#1f2029', hemiI: 0.72, dens: 0.0078, stars: 0.9, night: 1, cover: 0.6, cloudLit: '#343c5c', cloudDark: '#141a2c' },
];
const COLOR_FIELDS = ['top', 'hor', 'fog', 'ground', 'sun', 'hemiSky', 'hemiGround', 'cloudLit', 'cloudDark'];
const NUM_FIELDS = ['sunI', 'moonI', 'hemiI', 'dens', 'stars', 'night', 'cover'];
for (const k of KEYS) for (const f of COLOR_FIELDS) k[f] = new THREE.Color(k[f]);

function makePalette() {
  const p = {};
  for (const f of COLOR_FIELDS) p[f] = new THREE.Color();
  for (const f of NUM_FIELDS) p[f] = 0;
  return p;
}

function samplePalette(tod, out) {
  const n = KEYS.length;
  let a = KEYS[n - 1], b = KEYS[0], span, k;
  let i = 0;
  while (i < n && KEYS[i].t <= tod) i++;
  if (i === 0 || i === n) {
    a = KEYS[n - 1]; b = KEYS[0];
    span = 1 - a.t + b.t;
    k = (tod >= a.t ? tod - a.t : tod + 1 - a.t) / span;
  } else {
    a = KEYS[i - 1]; b = KEYS[i];
    span = b.t - a.t;
    k = (tod - a.t) / span;
  }
  k = k * k * (3 - 2 * k);
  for (const f of COLOR_FIELDS) out[f].copy(a[f]).lerp(b[f], k);
  for (const f of NUM_FIELDS) out[f] = a[f] + (b[f] - a[f]) * k;
  return out;
}

/** Lights, fog, sky and everything driven by the time of day. */
export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.palette = makePalette();
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.night = 0;
    this.tod = -1;

    scene.fog = new THREE.FogExp2(0xb0d0e8, 0.004);
    this.sky = new Sky(scene);
    this.sky.setPixelRatio(renderer.getPixelRatio());

    this.hemi = new THREE.HemisphereLight(0xc6ddf6, 0x6e5d46, 1.0);
    this.hemi.name = 'hemi';
    scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.name = 'sun';
    sun.castShadow = renderer.shadowMap.enabled;
    const E = RENDER.shadowExtent;
    sun.shadow.mapSize.set(RENDER.shadowSize, RENDER.shadowSize);
    Object.assign(sun.shadow.camera, { left: -E, right: E, top: E, bottom: -E, near: 1, far: 320 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.045;
    sun.shadow.radius = 2.2;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    this._tmp = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this.texel = (2 * E) / RENDER.shadowSize;
  }

  /** Update everything for time-of-day `tod` with the shadow box centred on `focus`. */
  update(tod, focus, camera, time) {
    const P = samplePalette(tod, this.palette);
    const a = (tod - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(a), Math.sin(a), 0.32).normalize();
    this.moonDir.set(-Math.cos(a) * 0.9, -Math.sin(a), 0.42).normalize();
    this.night = P.night;

    // sky
    const U = this.sky.uniforms;
    U.uTop.value.copy(P.top);
    U.uHorizon.value.copy(P.hor);
    U.uGround.value.copy(P.fog);
    U.uSunDir.value.copy(this.sunDir);
    U.uSunColor.value.copy(P.sun);
    U.uMoonDir.value.copy(this.moonDir);
    U.uNight.value = Math.max(P.stars, P.night * 0.8);
    U.uCover.value = P.cover;
    U.uCloudLit.value.copy(P.cloudLit);
    U.uCloudDark.value.copy(P.cloudDark);
    this.sky.starUniforms.uAlpha.value = P.stars;
    this.sky.update(camera, time, tod);

    // fog
    this.scene.fog.color.copy(P.fog);
    this.scene.fog.density = P.dens;

    // hemisphere
    this.hemi.color.copy(P.hemiSky);
    this.hemi.groundColor.copy(P.hemiGround);
    this.hemi.intensity = P.hemiI;

    // main directional light: the sun by day, the moon by night (swapped while both are dark)
    const sunI = P.sunI * smooth(-0.03, 0.12, this.sunDir.y);
    const moonI = P.moonI * smooth(-0.03, 0.12, this.moonDir.y);
    const L = this.sun;
    if (sunI >= moonI) {
      this.lightDir.copy(this.sunDir);
      L.color.copy(P.sun);
      L.intensity = sunI;
    } else {
      this.lightDir.copy(this.moonDir);
      L.color.setRGB(0.62, 0.72, 1.0);
      L.intensity = moonI;
    }
    // keep shadows sane at grazing angles
    if (this.lightDir.y < 0.2) {
      this.lightDir.y = 0.2;
      this.lightDir.normalize();
    }

    // shadow box follows the focus, snapped to shadow-map texels to avoid shimmering
    const up = this._up.set(0, 1, 0);
    const right = this._right.crossVectors(up, this.lightDir).normalize();
    const lup = this._up.crossVectors(this.lightDir, right).normalize();
    const t = this.texel;
    const pr = Math.round(focus.dot(right) / t) * t;
    const pu = Math.round(focus.dot(lup) / t) * t;
    const pd = focus.dot(this.lightDir);
    const c = this._tmp.copy(right).multiplyScalar(pr).addScaledVector(lup, pu).addScaledVector(this.lightDir, pd);
    L.target.position.copy(c);
    L.position.copy(c).addScaledVector(this.lightDir, 150);
    L.target.updateMatrixWorld();
    this.tod = tod;
  }
}

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
