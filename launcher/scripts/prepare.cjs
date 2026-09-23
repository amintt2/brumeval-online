// Copies the files the launcher UI reuses from the rest of the project into src/renderer/vendor/ (git-ignored):
//   - hero art rendered by Blender for the game (client/public/ui/class_*.png)
//   - the crest (build/icon.svg)
//   - the bundled fallback news (client/public/news.json)
//   - Cinzel / Alegreya Sans web fonts (@fontsource, SIL Open Font License)
// Runs automatically before `npm start`, `npm run smoke` and every packaging command.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LAUNCHER = path.resolve(__dirname, '..');
const ROOT = path.resolve(LAUNCHER, '..');
const OUT = path.join(LAUNCHER, 'src', 'renderer', 'vendor');

const copies = [
  ['client/public/ui/class_warrior.png', 'art/class_warrior.png'],
  ['client/public/ui/class_mage.png', 'art/class_mage.png'],
  ['client/public/ui/class_ranger.png', 'art/class_ranger.png'],
  ['client/public/news.json', 'news.json'],
  ['launcher/build/icon.svg', 'crest.svg'],
];

const fontDir = (pkg) => path.join(LAUNCHER, 'node_modules', '@fontsource', pkg, 'files');
const fonts = [
  ['cinzel', 'cinzel-latin-500-normal.woff2'],
  ['cinzel', 'cinzel-latin-700-normal.woff2'],
  ['cinzel', 'cinzel-latin-800-normal.woff2'],
  ['alegreya-sans', 'alegreya-sans-latin-400-normal.woff2'],
  ['alegreya-sans', 'alegreya-sans-latin-500-normal.woff2'],
  ['alegreya-sans', 'alegreya-sans-latin-700-normal.woff2'],
  ['alegreya-sans', 'alegreya-sans-latin-400-italic.woff2'],
];

let missing = 0;
function copy(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`introuvable : ${path.relative(ROOT, src)}`);
    missing++;
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const [src, dest] of copies) copy(path.join(ROOT, src), path.join(OUT, dest));
for (const [pkg, file] of fonts) copy(path.join(fontDir(pkg), file), path.join(OUT, 'fonts', file));

if (missing) {
  console.error(`prepare : ${missing} fichier(s) manquant(s) (lancez « npm install » dans launcher/).`);
  process.exit(1);
}
console.log(`prepare : ressources copiées dans ${path.relative(ROOT, OUT)}`);
