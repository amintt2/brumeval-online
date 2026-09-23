// Renderer, camera, lights, fog, image-based lighting and the day/night cycle ("dark fantasy" golden-hour look).
import * as THREE from 'three';
import { Sky } from './sky.js';
import { CascadedShadows } from './shadows.js';
import { EnvironmentLighting } from './envmap.js';
import { CAMERA, URLP } from '../config.js';
import { getSettings, hasSavedSettings } from './quality.js';

export function createRenderer(canvas) {
  const settings = getSettings();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    // with post-processing the scene is anti-aliased by SMAA; MSAA on the default framebuffer would be wasted
    // (first launch: the preset is not known yet — the benchmark may pick one without post-processing)
    antialias: !settings.post || URLP.quality === 'low' || !hasSavedSettings(),
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, URLP.quality === 'low' ? 1 : settings.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = URLP.quality !== 'low';
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
// Colours are linear HDR radiance multipliers (hex values are converted from sRGB). Tuned for AgX + the grade.
//  top/hor: sky gradient · fog: fog / horizon haze · sun: sun (or moon) light colour
//  sunI / moonI: directional intensity · envI: IBL intensity · skyI: sky brightness · exposure: camera exposure
//  dens: fog density (1/m) · fogH: height falloff (1/m) · shafts: light-shaft strength · bloom: bloom strength
const KEYS = [
  { t: 0.0, top: '#03060f', hor: '#101a33', fog: '#0f1629', sun: '#ffb070', sunI: 0, moonI: 0.62,
    envI: 1.0, skyI: 1.0, exposure: 1.85, dens: 0.0105, fogH: 0.07, shafts: 0.35, bloom: 1.0,
    stars: 1, night: 1, cover: 0.62, cloudLit: '#28324c', cloudDark: '#0b0f1c' },
  { t: 0.19, top: '#060c20', hor: '#1a2442', fog: '#172039', sun: '#ff9a60', sunI: 0, moonI: 0.5,
    envI: 1.0, skyI: 1.0, exposure: 1.8, dens: 0.0115, fogH: 0.07, shafts: 0.3, bloom: 1.0,
    stars: 0.9, night: 1, cover: 0.6, cloudLit: '#323a5a', cloudDark: '#12182a' },
  { t: 0.235, top: '#1d2d58', hor: '#c67e6c', fog: '#8e6c70', sun: '#ff8448', sunI: 0.7, moonI: 0.12,
    envI: 1.0, skyI: 1.1, exposure: 1.45, dens: 0.0135, fogH: 0.06, shafts: 0.9, bloom: 1.1,
    stars: 0.3, night: 0.8, cover: 0.56, cloudLit: '#ffa47c', cloudDark: '#5e4a66' },
  { t: 0.27, top: '#34528c', hor: '#f0ae78', fog: '#d09c7c', sun: '#ffae62', sunI: 3.2, moonI: 0,
    envI: 0.72, skyI: 1.35, exposure: 1.12, dens: 0.0105, fogH: 0.055, shafts: 1.15, bloom: 1.1,
    stars: 0, night: 0.3, cover: 0.54, cloudLit: '#ffdcbc', cloudDark: '#a4808a' },
  { t: 0.33, top: '#3a68b0', hor: '#d9d0b8', fog: '#c2bca6', sun: '#ffe0b4', sunI: 3.9, moonI: 0,
    envI: 0.58, skyI: 1.55, exposure: 1.0, dens: 0.0072, fogH: 0.05, shafts: 0.55, bloom: 1.0,
    stars: 0, night: 0, cover: 0.52, cloudLit: '#fff6ea', cloudDark: '#b9bcc4' },
  { t: 0.5, top: '#2f63bb', hor: '#cfd3cc', fog: '#b6bdbc', sun: '#fff0da', sunI: 4.1, moonI: 0,
    envI: 0.55, skyI: 1.6, exposure: 0.95, dens: 0.006, fogH: 0.045, shafts: 0.35, bloom: 0.9,
    stars: 0, night: 0, cover: 0.5, cloudLit: '#ffffff', cloudDark: '#c2c8d2' },
  { t: 0.67, top: '#3564ae', hor: '#e0cfae', fog: '#c6ba9e', sun: '#ffdcaa', sunI: 3.9, moonI: 0,
    envI: 0.58, skyI: 1.5, exposure: 1.0, dens: 0.0072, fogH: 0.05, shafts: 0.6, bloom: 1.0,
    stars: 0, night: 0, cover: 0.52, cloudLit: '#fff4e2', cloudDark: '#bfb8b8' },
  { t: 0.73, top: '#2c4480', hor: '#f3985a', fog: '#d08a64', sun: '#ff9444', sunI: 3.1, moonI: 0,
    envI: 0.72, skyI: 1.35, exposure: 1.12, dens: 0.0105, fogH: 0.055, shafts: 1.25, bloom: 1.15,
    stars: 0, night: 0.3, cover: 0.55, cloudLit: '#ffbc8a', cloudDark: '#7e5e70' },
  { t: 0.765, top: '#141c42', hor: '#96504e', fog: '#4c3646', sun: '#ff6634', sunI: 0.65, moonI: 0.12,
    envI: 1.0, skyI: 1.1, exposure: 1.45, dens: 0.0125, fogH: 0.06, shafts: 0.8, bloom: 1.1,
    stars: 0.35, night: 0.8, cover: 0.58, cloudLit: '#c66e60', cloudDark: '#34283e' },
  { t: 0.81, top: '#050a1d', hor: '#182040', fog: '#161d35', sun: '#ff9a60', sunI: 0, moonI: 0.55,
    envI: 1.0, skyI: 1.0, exposure: 1.8, dens: 0.011, fogH: 0.07, shafts: 0.3, bloom: 1.0,
    stars: 0.9, night: 1, cover: 0.6, cloudLit: '#28324c', cloudDark: '#0b0f1c' },
];
const COLOR_FIELDS = ['top', 'hor', 'fog', 'sun', 'cloudLit', 'cloudDark'];
const NUM_FIELDS = ['sunI', 'moonI', 'envI', 'skyI', 'exposure', 'dens', 'fogH', 'shafts', 'bloom', 'stars', 'night', 'cover'];
for (const k of KEYS) for (const f of COLOR_FIELDS) k[f] = new THREE.Color(k[f]);
const MOON_COLOR = new THREE.Color('#9fb6ff');

function makePalette() {
  const p = {};
  for (const f of COLOR_FIELDS) p[f] = new THREE.Color();
  for (const f of NUM_FIELDS) p[f] = 0;
  return p;
}

export function samplePalette(tod, out = makePalette()) {
  const n = KEYS.length;
  let a, b, k;
  let i = 0;
  while (i < n && KEYS[i].t <= tod) i++;
  if (i === 0 || i === n) {
    a = KEYS[n - 1]; b = KEYS[0];
    const span = 1 - a.t + b.t;
    k = (tod >= a.t ? tod - a.t : tod + 1 - a.t) / span;
  } else {
    a = KEYS[i - 1]; b = KEYS[i];
    k = (tod - a.t) / (b.t - a.t);
  }
  k = k * k * (3 - 2 * k);
  for (const f of COLOR_FIELDS) out[f].copy(a[f]).lerp(b[f], k);
  for (const f of NUM_FIELDS) out[f] = a[f] + (b[f] - a[f]) * k;
  return out;
}

/** Lights, fog, sky, IBL and everything driven by the time of day. */
export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.palette = makePalette();
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.lightColor = new THREE.Color(1, 1, 1);
    this.lightIntensity = 0;
    this.night = 0;
    this.tod = -1;
    this.overcast = 0;
    this.fogColor = new THREE.Color();
    this.groundBounce = new THREE.Color();

    // classic fog (used when the volumetric fog of the post pass is off)
    scene.fog = new THREE.FogExp2(0xb0d0e8, 0.004);
    this.useClassicFog = true;
    this.sky = new Sky(scene);
    this.sky.setPixelRatio(renderer.getPixelRatio());
    this.shadows = new CascadedShadows(scene, renderer);
    this.shadows.configure(URLP.quality === 'low' ? 0 : 2, 110);
    this.ibl = new EnvironmentLighting(renderer, this.sky);
    scene.environmentIntensity = 1;
    this._t = new THREE.Color();
  }

  /** The main directional light (first shadow cascade). */
  get sun() {
    return this.shadows.light;
  }

  /** Apply graphics settings (shadow quality / distance, fog mode). */
  configure(settings, viewDistance) {
    this.shadows.configure(URLP.quality === 'low' ? 0 : settings.shadows, Math.min(160, 70 + viewDistance * 0.25));
    this.useClassicFog = !settings.fog;
  }

  /** Load the optional Blender HDRIs (never rejects). */
  async loadHdr() {
    const names = await this.ibl.load();
    this.ibl.update(0, this.scene, true);
    return names;
  }

  /** Update everything for time-of-day `tod` with the camera. */
  update(tod, focus, camera, time, dt = 0.016) {
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
    U.uSkyI.value = P.skyI;
    this.sky.starUniforms.uAlpha.value = P.stars;
    this.sky.update(camera, time, tod);

    // main directional light: the sun by day, the moon by night (swapped while both are dark)
    const sunI = P.sunI * smooth(-0.03, 0.12, this.sunDir.y);
    const moonI = P.moonI * smooth(-0.03, 0.12, this.moonDir.y);
    if (sunI >= moonI) {
      this.lightDir.copy(this.sunDir);
      this.lightColor.copy(P.sun);
      this.lightIntensity = sunI;
    } else {
      this.lightDir.copy(this.moonDir);
      this.lightColor.copy(MOON_COLOR);
      this.lightIntensity = moonI;
    }
    // keep shadows sane at grazing angles
    if (this.lightDir.y < 0.16) {
      this.lightDir.y = 0.16;
      this.lightDir.normalize();
    }
    this.shadows.update(camera, this.lightDir, this.lightColor, this.lightIntensity);

    // fog
    this.fogColor.copy(P.fog).multiplyScalar(P.skyI);
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.density = this.useClassicFog ? P.dens * 0.62 : 0;

    // IBL: ground bounce ≈ terrain albedo × (sun on the ground + sky)
    const lit = this.lightIntensity * Math.max(0, this.lightDir.y);
    this.groundBounce.setRGB(0.09, 0.085, 0.06).multiply(this._t.copy(this.lightColor).multiplyScalar(lit / Math.PI))
      .add(this._t.copy(P.hor).lerp(P.top, 0.5).multiplyScalar(0.12 * P.skyI));
    U.uGroundBounce.value.copy(this.groundBounce);
    this.ibl.setBlend(tod, this.overcast);
    this.scene.environmentIntensity = P.envI;
    this.ibl.update(dt, this.scene, this.tod < 0 || Math.abs(tod - this.tod) > 0.02);
    if (this.tod < 0 || Math.abs(tod - this.tod) > 0.02) this.tod = tod;
    else if (this.ibl.acc === 0) this.tod = tod;
  }
}

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
