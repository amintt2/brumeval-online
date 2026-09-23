// Geometry helpers for loaded models.
//  - isFaceted(): true when a mesh was exported flat-shaded (every triangle's vertex normals = its face normal);
//  - smoothNormals(): crease-angle smoothing of a non-indexed geometry: curved surfaces (robes, sleeves, hats,
//    barrels, trunks…) become smooth while real edges (box corners, roof ridges) stay sharp.
// The v0.1 characters were exported faceted, which made robes look "made of triangles".
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _n = new THREE.Vector3();

/** Fraction of triangles (0..1) whose three vertex normals equal the face normal (non-indexed geometry). */
export function facetedRatio(geo) {
  const p = geo.attributes.position, nrm = geo.attributes.normal;
  if (!p || !nrm || geo.index) return 0;
  const tris = Math.floor(p.count / 3);
  if (!tris) return 0;
  let flat = 0, checked = 0;
  const step = Math.max(1, Math.floor(tris / 400));
  for (let t = 0; t < tris; t += step) {
    const i = t * 3;
    _a.fromBufferAttribute(p, i); _b.fromBufferAttribute(p, i + 1); _c.fromBufferAttribute(p, i + 2);
    _n.crossVectors(_ab.subVectors(_b, _a), _ac.subVectors(_c, _a));
    const len = _n.length();
    if (len < 1e-10) continue;
    _n.divideScalar(len);
    checked++;
    let same = true;
    for (let k = 0; k < 3; k++) {
      const d = _n.x * nrm.getX(i + k) + _n.y * nrm.getY(i + k) + _n.z * nrm.getZ(i + k);
      if (d < 0.999) { same = false; break; }
    }
    if (same) flat++;
  }
  return checked ? flat / checked : 0;
}

export const isFaceted = (geo, threshold = 0.9) => facetedRatio(geo) >= threshold;

/**
 * Crease-angle normal smoothing, in place, for a NON-indexed geometry. Vertices sharing a position (quantised)
 * average the (area-weighted) normals of the faces within `creaseDeg` of their own face.
 */
export function smoothNormals(geo, creaseDeg = 42) {
  const p = geo.attributes.position;
  if (!p || geo.index) return geo;
  const count = p.count;
  const tris = Math.floor(count / 3);
  const faceN = new Float32Array(tris * 3);
  const faceA = new Float32Array(tris);
  for (let t = 0; t < tris; t++) {
    const i = t * 3;
    _a.fromBufferAttribute(p, i); _b.fromBufferAttribute(p, i + 1); _c.fromBufferAttribute(p, i + 2);
    _n.crossVectors(_ab.subVectors(_b, _a), _ac.subVectors(_c, _a));
    const len = _n.length();
    faceA[t] = len;
    if (len > 1e-12) _n.divideScalar(len);
    faceN[t * 3] = _n.x; faceN[t * 3 + 1] = _n.y; faceN[t * 3 + 2] = _n.z;
  }
  // group vertices by quantised position
  const q = 1e4;
  const groups = new Map();
  for (let v = 0; v < count; v++) {
    const key = `${Math.round(p.getX(v) * q)},${Math.round(p.getY(v) * q)},${Math.round(p.getZ(v) * q)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(v);
  }
  const cos = Math.cos(THREE.MathUtils.degToRad(creaseDeg));
  const out = new Float32Array(count * 3);
  for (const g of groups.values()) {
    for (const v of g) {
      const tv = Math.floor(v / 3);
      const fx = faceN[tv * 3], fy = faceN[tv * 3 + 1], fz = faceN[tv * 3 + 2];
      let sx = 0, sy = 0, sz = 0;
      for (const u of g) {
        const tu = Math.floor(u / 3);
        const ux = faceN[tu * 3], uy = faceN[tu * 3 + 1], uz = faceN[tu * 3 + 2];
        if (fx * ux + fy * uy + fz * uz < cos) continue;
        const w = faceA[tu];
        sx += ux * w; sy += uy * w; sz += uz * w;
      }
      const l = Math.hypot(sx, sy, sz);
      if (l > 1e-12) { out[v * 3] = sx / l; out[v * 3 + 1] = sy / l; out[v * 3 + 2] = sz / l; }
      else { out[v * 3] = fx; out[v * 3 + 1] = fy; out[v * 3 + 2] = fz; }
    }
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return geo;
}
