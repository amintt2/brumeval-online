#!/usr/bin/env node
// Inspect one or more .glb files: size, meshes, triangles, materials, skins, animations
// and an approximate world-space bounding box (node transforms applied to accessor min/max).
// Usage: node scripts/inspect-glb.mjs client/public/models/*.glb [--json]
import fs from 'node:fs';
import path from 'node:path';

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  return { json: JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')), size: buf.length };
}

// Column-major 4x4 helpers
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const xf = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);

export function inspect(file) {
  const { json: g, size } = readGlb(file);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  const visit = (idx, parent) => {
    const n = g.nodes[idx];
    const m = mul(parent, trs(n));
    if (n.mesh !== undefined) {
      for (const p of g.meshes[n.mesh].primitives) {
        const acc = g.accessors[p.attributes.POSITION];
        const cnt = p.indices !== undefined ? g.accessors[p.indices].count : acc.count;
        if ((p.mode ?? 4) === 4) tris += cnt / 3;
        if (acc.min && acc.max) {
          for (let i = 0; i < 8; i++) {
            const c = [i & 1 ? acc.max[0] : acc.min[0], i & 2 ? acc.max[1] : acc.min[1], i & 4 ? acc.max[2] : acc.min[2]];
            // Skinned meshes are posed by their skeleton; the bind-pose mesh is authored in armature space.
            const w = n.skin !== undefined ? c : xf(m, c);
            for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); }
          }
        }
      }
    }
    for (const ch of n.children || []) visit(ch, m);
  };
  const scene = g.scenes?.[g.scene ?? 0];
  for (const r of scene?.nodes || []) visit(r, I());
  const r3 = (v) => v.map((x) => +x.toFixed(2));
  return {
    file: path.basename(file),
    kb: +(size / 1024).toFixed(1),
    nodes: g.nodes?.length || 0,
    meshes: (g.meshes || []).map((m) => m.name),
    triangles: Math.round(tris),
    materials: (g.materials || []).map((m) => m.name),
    skins: (g.skins || []).map((s) => ({ name: s.name, joints: s.joints.length })),
    bones: (g.skins?.[0]?.joints || []).map((j) => g.nodes[j].name),
    animations: (g.animations || []).map((a) => {
      let dur = 0;
      for (const s of a.samplers) dur = Math.max(dur, g.accessors[s.input].max?.[0] ?? 0);
      return { name: a.name, channels: a.channels.length, seconds: +dur.toFixed(2) };
    }),
    bbox: isFinite(min[0]) ? { min: r3(min), max: r3(max), size: r3(max.map((v, i) => v - min[i])) } : null,
  };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('inspect-glb.mjs')) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const files = args.filter((a) => a !== '--json');
  if (!files.length) { console.error('usage: node scripts/inspect-glb.mjs <file.glb>... [--json]'); process.exit(1); }
  const out = [];
  let failed = false;
  for (const f of files) {
    try { out.push(inspect(f)); } catch (e) { failed = true; out.push({ file: f, error: e.message }); }
  }
  if (asJson) console.log(JSON.stringify(out, null, 2));
  else for (const o of out) {
    if (o.error) { console.log(`✗ ${o.file}: ${o.error}`); continue; }
    console.log(`● ${o.file}  ${o.kb} KB  tris=${o.triangles}  nodes=${o.nodes}  materials=${o.materials.length}`);
    if (o.bbox) console.log(`    bbox size (x,y,z)=${o.bbox.size.join(', ')}  min=${o.bbox.min.join(', ')}  max=${o.bbox.max.join(', ')}`);
    if (o.skins.length) console.log(`    skin: ${o.skins[0].joints} joints [${o.bones.join(', ')}]`);
    if (o.animations.length) console.log(`    animations: ${o.animations.map((a) => `${a.name}(${a.seconds}s)`).join(', ')}`);
  }
  process.exit(failed ? 1 : 0);
}
