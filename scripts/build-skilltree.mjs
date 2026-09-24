#!/usr/bin/env node
// [skilltree] Generates shared/skilltree.js from the design data docs/design/skilltree.json (the source of truth,
// produced by docs/design/tools/build_tree.mjs). The generated module is plain JS (no JSON import attributes) so
// that Node (server, tests) and Vite (client) load it the same way.
//
//   node scripts/build-skilltree.mjs          → rewrites shared/skilltree.js
//   node scripts/build-skilltree.mjs --check  → exit 1 if shared/skilltree.js is out of date (used by the tests)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = path.join(ROOT, 'docs', 'design', 'skilltree.json');
export const TARGET = path.join(ROOT, 'shared', 'skilltree.js');

/** Fields kept in the game build (the design history in meta.* stays in docs/). */
export function gameTree(src) {
  const { meta, rules, classes, regions, statuses, abilities, exclusiveGroups, nodes, keystones, migration } = src;
  return {
    meta: { title: meta.title, version: meta.version, units: meta.units },
    rules, classes, regions, statuses, abilities, exclusiveGroups, nodes, keystones, migration,
  };
}

export function render(src) {
  const tree = gameTree(src);
  return [
    '// GÉNÉRÉ par scripts/build-skilltree.mjs depuis docs/design/skilltree.json — ne pas modifier à la main.',
    '// [skilltree] L\'Arbre des Brumes : règles, capacités, nœuds (docs/design/ARBRE_COMPETENCES.md).',
    `const TREE = ${JSON.stringify(tree)};`,
    'export default TREE;',
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const out = render(src);
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
    if (cur !== out) {
      console.error('shared/skilltree.js n\'est pas à jour : lancez node scripts/build-skilltree.mjs');
      process.exit(1);
    }
    console.log('shared/skilltree.js à jour');
  } else {
    fs.writeFileSync(TARGET, out);
    console.log(`shared/skilltree.js écrit (${(out.length / 1024).toFixed(0)} Ko, ${src.nodes.length} nœuds, ${src.abilities.length} capacités)`);
  }
}
