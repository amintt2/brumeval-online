#!/usr/bin/env node
// [skilltree] Coverage of l'Arbre des Brumes by the ability engine: every field that the tree data modifies
// (`mod: "<ability>.<field>"`) and every passive `stat` must be read by the engine (server/src/systems/*, shared/skills.js)
// or be listed as approximated / not simulated in EXOTIC (server/src/systems/abilities.js).
//   node scripts/skilltree-coverage.mjs   → prints the fields per status (docs/EQUILIBRAGE.md)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TREE from '../shared/skilltree.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = [
  'server/src/systems/abilities.js', 'server/src/systems/fundamentals.js', 'server/src/systems/zones.js',
  'server/src/systems/stamina.js', 'server/src/systems/combat.js', 'server/src/systems/status.js',
  'server/src/systems/skills.js', 'server/src/systems/players.js', 'server/src/systems/echo.js',
  'server/src/systems/regen.js', 'server/src/systems/items.js', 'shared/skills.js',
];

/** Stats read by name through a prefix (`dmgPct.${tag}`, `statusDurS.${id}`…). */
const PREFIXED = ['dmgPct.', 'stCostPct.', 'projSpeedPct.', 'statusDurS.', 'poisePct.', 'critTag.', 'critVsStatus.', 'dmgVsStatusPct.', 'costPct.', 'range.'];

export function coverage(exotic = {}) {
  const src = ENGINE.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const word = (w) => new RegExp(`(^|[^A-Za-z0-9_])${w.replace(/[.$]/g, (c) => `\\${c}`)}([^A-Za-z0-9_]|$)`).test(src);
  const mods = new Map();
  const stats = new Map();
  for (const n of TREE.nodes) {
    for (const e of n.effects || []) {
      if (e.mod && e.mod !== 'unlock') {
        const f = e.mod.split('.').slice(1)[0];
        if (!mods.has(f)) mods.set(f, new Set());
        mods.get(f).add(n.id);
      } else if (e.stat) {
        if (!stats.has(e.stat)) stats.set(e.stat, new Set());
        stats.get(e.stat).add(n.id);
      }
    }
  }
  const out = { engine: [], exotic: [], missing: [], stats: [], statsMissing: [] };
  for (const [f, nodes] of mods) {
    if (exotic[f]) out.exotic.push({ f, nodes: [...nodes], note: exotic[f] });
    else if (word(f)) out.engine.push({ f, nodes: [...nodes] });
    else out.missing.push({ f, nodes: [...nodes] });
  }
  for (const [s, nodes] of stats) {
    const read = src.includes(`'${s}'`) || PREFIXED.some((p) => s.startsWith(p) && src.includes(`\`${p}`));
    if (read) out.stats.push({ s, nodes: [...nodes] });
    else if (exotic[s]) out.exotic.push({ f: s, nodes: [...nodes], note: exotic[s] });
    else out.statsMissing.push({ s, nodes: [...nodes] });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { EXOTIC } = await import('../server/src/systems/abilities.js');
  const c = coverage(EXOTIC);
  console.log(`Champs de variantes lus par le moteur : ${c.engine.length}`);
  console.log(`Statistiques passives lues : ${c.stats.length}`);
  console.log(`Approchés ou non simulés (EXOTIC) : ${c.exotic.length}`);
  for (const e of c.exotic) console.log(`  ${e.f} — ${e.note} (${e.nodes.join(', ')})`);
  if (c.missing.length || c.statsMissing.length) {
    console.log('NON COUVERTS :');
    for (const m of c.missing) console.log(`  mod ${m.f} (${m.nodes.join(', ')})`);
    for (const m of c.statsMissing) console.log(`  stat ${m.s} (${m.nodes.join(', ')})`);
    process.exitCode = 1;
  }
}
