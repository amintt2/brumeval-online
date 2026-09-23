#!/usr/bin/env node
// Build every 3D model / icon with Blender (headless). Each group has assets/blender/<group>/build.py.
// Usage: npm run assets [-- group1 group2 ...] [-- --only key1,key2] [--no-preview]
// Blender path: $BLENDER or the default Windows install location.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLENDER = process.env.BLENDER || (process.platform === 'win32'
  ? String.raw`C:\Program Files\Blender Foundation\Blender 5.0\blender.exe`
  : 'blender');
// Every folder assets/blender/<group>/ that contains a build.py is a group (icons last: they may reuse models).
const GROUPS = fs.readdirSync(path.join(ROOT, 'assets', 'blender'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, 'assets', 'blender', d.name, 'build.py')))
  .map((d) => d.name)
  .sort((a, b) => (a === 'icons') - (b === 'icons') || a.localeCompare(b));

const argv = process.argv.slice(2);
const passthrough = [];
const groups = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--only') passthrough.push('--only', argv[++i]);
  else if (argv[i].startsWith('--')) passthrough.push(argv[i]);
  else groups.push(argv[i]);
}

// Opt-in groups: only built when named (`npm run assets -- codex`). The Codex renders are long Cycles jobs
// whose validated outputs are already committed; a plain `npm run assets` must not redo them.
const OPT_IN = new Set(['codex']);
let failed = 0;
for (const g of groups.length ? groups : GROUPS.filter((name) => !OPT_IN.has(name))) {
  const script = path.join(ROOT, 'assets', 'blender', g, 'build.py');
  if (!fs.existsSync(script)) { console.warn(`! ${g}: ${script} not found, skipped`); continue; }
  console.log(`\n=== ${g} ===`);
  const t = Date.now();
  const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', ...passthrough], { stdio: 'inherit' });
  if (r.error) { failed++; console.error(`✗ ${g} failed: ${r.error.message} (Blender: ${BLENDER}; set the BLENDER env var)`); }
  else if (r.status !== 0) { failed++; console.error(`✗ ${g} failed (exit ${r.status})`); }
  else console.log(`✓ ${g} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}
process.exit(failed ? 1 : 0);
