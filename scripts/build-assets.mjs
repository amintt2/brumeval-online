#!/usr/bin/env node
// Build every 3D model / icon with Blender (headless). Each group has assets/blender/<group>/build.py.
// Usage: npm run assets [-- group1 group2 ...] [-- --only key1,key2] [--no-preview]
// Blender path: $BLENDER or the default Windows install location.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const BLENDER = process.env.BLENDER || (process.platform === 'win32'
  ? 'C:\Program Files\Blender Foundation\Blender 5.0\blender.exe'
  : 'blender');
const GROUPS = ['characters', 'creatures', 'nature', 'structures', 'icons'];

const argv = process.argv.slice(2);
const passthrough = [];
const groups = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--only') passthrough.push('--only', argv[++i]);
  else if (argv[i].startsWith('--')) passthrough.push(argv[i]);
  else groups.push(argv[i]);
}

let failed = 0;
for (const g of groups.length ? groups : GROUPS) {
  const script = path.join(ROOT, 'assets', 'blender', g, 'build.py');
  if (!fs.existsSync(script)) { console.warn(`! ${g}: ${script} not found, skipped`); continue; }
  console.log(`\n=== ${g} ===`);
  const t = Date.now();
  const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', ...passthrough], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.error(`✗ ${g} failed (exit ${r.status})`); }
  else console.log(`✓ ${g} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}
process.exit(failed ? 1 : 0);
