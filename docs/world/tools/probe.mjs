// Petit outil de relecture : imprime une grille d'altitudes (m) autour d'un point.  node docs/world/tools/probe.mjs x z [demi-largeur] [pas]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { decodeGray16 } from './png.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { w, data } = decodeGray16(fs.readFileSync(path.join(HERE, '..', 'heightmap.png')));
const H = (x, z) => { const i = Math.round((x + 2304) / 4.5), j = Math.round((z + 2808) / 4.5); return data[j * w + i] * 0.01 - 60; };
const [cx, cz, hw = 200, st = 20] = process.argv.slice(2).map(Number);
let out = '        ' + Array.from({ length: Math.floor(2 * hw / st) + 1 }, (_, c) => String(cx - hw + c * st).padStart(5)).join('') + '\n';
for (let z = cz - hw; z <= cz + hw; z += st) { let r = String(z).padStart(7) + ' '; for (let x = cx - hw; x <= cx + hw; x += st) r += String(Math.round(H(x, z))).padStart(5); out += r + '\n'; }
console.log(out);
