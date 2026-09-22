// URL parameters and client-side tuning constants.
import { CLASSES } from '@shared/data.js';

const params = new URLSearchParams(location.search);
const num = (k) => {
  if (!params.has(k)) return null;
  const v = parseFloat(params.get(k));
  return Number.isFinite(v) ? v : null;
};

const clsParam = params.get('cls');
const todParam = num('tod');

export const URLP = {
  /** ?offline=1 → local simulation, no network. */
  offline: params.get('offline') === '1',
  /** ?cls=mage → class used by offline mode and autologin registration. */
  cls: clsParam && CLASSES[clsParam] ? clsParam : 'warrior',
  /** ?autologin=Nom → log in (or register) automatically with the password `test1234`. */
  autologin: params.get('autologin') || null,
  /** ?tod=0.9 → freeze the time of day (0 midnight, 0.5 noon). */
  tod: todParam === null ? null : ((todParam % 1) + 1) % 1,
  /** ?name=Nom → offline player name. */
  name: params.get('name') || null,
  /** ?quality=low → no shadows, pixel ratio 1. */
  quality: params.get('quality') === 'low' ? 'low' : 'high',
  /** ?mute=1 → no sound. */
  mute: params.get('mute') === '1',
};

export const AUTOLOGIN_PASSWORD = 'test1234';

export const CAMERA = {
  minDist: 3,
  maxDist: 28,
  startDist: 11,
  minPitch: -0.2,
  maxPitch: 1.35,
  startPitch: 0.42,
  fov: 55,
  near: 0.3,
  far: 1200,
};

export const RENDER = {
  shadowSize: 2048,
  shadowExtent: 60,
  chunkSize: 90,
  labelMaxDist: 55,
  lampLights: 3,
  fxLights: 2,
};
