// Small procedural textures drawn on canvases (no image files needed).
import * as THREE from 'three';

const cache = new Map();

function canvasTexture(key, size, draw, srgb = true) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  cache.set(key, tex);
  return tex;
}

/** Soft round glow (white centre fading to transparent). */
export function glowTexture() {
  return canvasTexture('glow', 128, (g, s) => {
    const r = s / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.28)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });
}

/** Four-pointed sparkle star. */
export function sparkTexture() {
  return canvasTexture('spark', 128, (g, s) => {
    const r = s / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r * 0.55);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = 'lighter';
    for (const [w, h] of [[s * 0.07, s * 0.98], [s * 0.98, s * 0.07]]) {
      const lg = g.createRadialGradient(r, r, 0, r, r, Math.max(w, h) / 2);
      lg.addColorStop(0, 'rgba(255,255,255,0.95)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.ellipse(r, r, w / 2, h / 2, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Soft smoke puff (for normal-blended dust). */
export function smokeTexture() {
  return canvasTexture('smoke', 128, (g, s) => {
    const r = s / 2;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const cx = r + Math.cos(a) * s * 0.12, cy = r + Math.sin(a) * s * 0.12;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, s * 0.36);
      grd.addColorStop(0, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
    }
  });
}
