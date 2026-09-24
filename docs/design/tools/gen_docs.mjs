// Generates the three v0.3 design documents from the final data + the results of validate.mjs and balance.mjs:
//   docs/design/ARBRE_COMPETENCES.md, docs/design/OBJETS_ARTISANAT.md, docs/design/ASSET_REQUESTS.md
// Run: node docs/design/tools/gen_docs.mjs   (after build_tree.mjs and build_items.mjs)
// The prose is written here; every table comes from the JSON, so documents and data never disagree.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { points, reachCosts } from './lib/treelib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = path.resolve(HERE, '..');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DESIGN, f), 'utf8'));
const tree = load('skilltree.json');
const items = load('items.json');
const crafting = load('crafting.json');
const runJson = (script) => {
  try {
    return JSON.parse(execFileSync(process.execPath, [path.join(HERE, script), '--json'], { encoding: 'utf8' }));
  } catch (e) {
    return JSON.parse(e.stdout);
  }
};
const V = runJson('validate.mjs');
const B = runJson('balance.mjs');

// ------------------------------------------------------------------ helpers
const fr = (x, d = 2) => {
  if (typeof x !== 'number') return String(x ?? '—');
  const r = Number.isInteger(x) ? String(x) : String(+x.toFixed(d));
  return r.replace('.', ',');
};
const pct = (x, d = 0) => `${x > 0 ? '+' : ''}${fr(+(x * 100).toFixed(d))} %`;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const N = new Map(tree.nodes.map((n) => [n.id, n]));
const A = new Map(tree.abilities.map((a) => [a.id, a]));
const TYPE_FR = { root: 'Racine', skill: 'Compétence', variant: 'Variante', passive: 'Passif', keystone: 'Clé de voûte' };
const KIND_FR = {
  melee: 'mêlée', projectile: 'projectile', aoe_self: 'zone autour de soi', aoe_target: 'zone ciblée', self_heal: 'soin',
  buff: 'renfort', dash: 'déplacement', channel: 'canalisation', summon: 'invocation', debuff: 'marque', trap: 'piège',
  toggle: 'maintien', jump: 'saut', guard: 'garde', charge: 'charge',
};
const WEAPON_FR = { melee: 'arme de mêlée', arc: 'arc ou arbalète', dague: 'couteau de ceinture', focus: 'focalisateur (sinon −20 %)', focus_ou_arc: 'focalisateur ou arc', base: "arme de l'attaque de base", null: '—' };
const HOME_FR = (h) => (h == null ? 'tous (Survie)' : [].concat(h).map((c) => ({ warrior: 'Guerrier', mage: 'Mage', ranger: 'Rôdeur' })[c]).join(' + '));
const REGION_FR = Object.fromEntries(Object.entries(tree.regions).map(([k, v]) => [k, v.name]));
const BRANCH_FR = {
  coeur: 'Cœur', fondamentaux: 'Fondamentaux', sprint: 'Sprint', charge: 'Attaque chargée', endurance: 'Endurance et corps', garde: 'Garde',
  roulade: 'Roulade', saut: 'Saut', soutien: 'Soutien', seuil: 'Seuils', tronc: 'Tronc', gardien: 'Gardien', berserker: 'Berserker',
  maitre: "Maître d'armes", lame_spirituelle: 'Lame spirituelle', givre: 'Givre', arcanes: 'Arcanes', pyromancie: 'Pyromancie',
  arcaniste_sylvestre: 'Arcaniste sylvestre', origine: 'Départ', traqueur: 'Traqueur', tireur: 'Tireur', venin: 'Venin', chasseur: 'Chasseur',
};
const count = (arr, f) => arr.filter(f).length;
const byRegion = (r) => tree.nodes.filter((n) => n.region === r);
const typeCounts = (list) => ['skill', 'variant', 'passive', 'keystone'].map((t) => `${count(list, (n) => n.type === t)} ${TYPE_FR[t].toLowerCase()}${count(list, (n) => n.type === t) > 1 ? 's' : ''}`).join(', ').replace('clé de voûtes', 'clés de voûte').replace('compétences', 'compétences');

function costCell(n) {
  if (n.type === 'root') return '—';
  if (n.start) return `départ (${n.costs.warrior}/${n.costs.mage}/${n.costs.ranger})`;
  return `${n.costs.warrior}/${n.costs.mage}/${n.costs.ranger}`;
}
function nodeTable(list) {
  const rows = ['| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |', '|---|---|---|---|---|---|---|---|'];
  for (const n of list) {
    const extra = [];
    if (n.exclusiveGroup) extra.push(`groupe \`${n.exclusiveGroup}\``);
    if (n.minLevel) extra.push(`niv. ${n.minLevel} min.`);
    if (n.reqRegionPoints) extra.push(`${n.reqRegionPoints.min} points dans la région`);
    if (n.fondamental) extra.push('Fondamental');
    if (n.migrationGift) extra.push('offert aux personnages v0.2');
    const desc = esc(n.desc) + (extra.length ? ` *(${extra.join(' · ')})*` : '');
    rows.push(`| \`${n.id}\` | ${TYPE_FR[n.type]} | **${esc(n.name)}** | ${desc} | ${n.maxRank} | ${costCell(n)} | ${n.x}, ${n.y} | ${n.links.map((l) => `\`${l}\``).join(' ')} |`);
  }
  return rows.join('\n');
}
function vfxList(list) {
  const v = list.filter((n) => n.type === 'variant' && n.vfx);
  if (!v.length) return '';
  return '\n**Intentions visuelles des variantes** (pour les effets à produire) :\n\n' + v.map((n) => `- *${n.name}* (\`${n.id}\`) : ${n.vfx}`).join('\n') + '\n';
}
function engage(a) {
  const parts = [];
  if (a.windup) parts.push(`prép. ${fr(a.windup)} s`);
  if (a.cast) parts.push(`incant. ${fr(a.cast)} s`);
  if (a.channel) parts.push(`canal. ${fr(a.channel)} s`);
  if (a.rec != null) parts.push(`récup. ${fr(a.rec)} s${a.recSlow != null ? ` à ${Math.round(a.recSlow * 100)} %` : ''}`);
  return parts.join(' · ') || '—';
}
function powerCell(a) {
  if (a.heal) return `soin ${Math.round(a.heal * 100)} %`;
  if (typeof a.power !== 'number' || a.power === 0) return a.powerMax ? `×1,0 → ×${fr(a.powerMax)}` : '—';
  let s = `×${fr(a.power)}`;
  if (a.hits && a.hits > 1) s += ` ×${a.hits}`;
  if (a.channel && a.tick) s += ` par tic (${fr(a.tick)} s)`;
  if (a.dot?.total) s += ` + ${Math.round(a.dot.total * 100)} % en ${a.dot.dur} s`;
  return s;
}
function reach(a) {
  const p = [];
  if (a.range) p.push(`${fr(a.range)} m`);
  if (a.radius) p.push(`r ${fr(a.radius)} m`);
  return p.join(' / ') || '—';
}
function abilityTable(list) {
  const rows = ['| id | Nom | Type | Coût (mana + end.) | Recharge | Portée | Puissance | Poise | Engagement | Arme | Étiquettes | Origine |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const a of list) {
    const cost = `${a.mp || 0} + ${a.st || 0}${a.stPerS ? ` (${a.stPerS}/s)` : ''}${a.hpCost ? ` + ${Math.round(a.hpCost * 100)} % PV` : ''}`;
    rows.push(`| \`${a.id}\` | **${esc(a.name)}**${a.base ? ' *(base)*' : ''}${a.v02 ? ' *(v0.2)*' : ''} | ${KIND_FR[a.kind] || a.kind} | ${cost} | ${typeof a.cd === 'number' ? fr(a.cd) + ' s' : "celle de l'attaque de base"} | ${reach(a)} | ${powerCell(a)} | ${a.poise ?? '—'} | ${engage(a)} | ${WEAPON_FR[a.weapon] || a.weapon} | ${a.tags.join(', ')} | ${HOME_FR(a.home)} |`);
  }
  return rows.join('\n');
}
function abilityNotes(list) {
  return list.map((a) => `- **${a.name}** (\`${a.id}\`) — ${esc(a.desc)}${a.souls ? `\n  *Soulslike :* ${esc(a.souls)}` : ''}`).join('\n');
}
function abilitiesOf(region) {
  const ids = new Set(byRegion(region).filter((n) => n.type === 'skill' || n.start).flatMap((n) => n.effects.filter((e) => e.mod === 'unlock').map((e) => e.value)));
  return tree.abilities.filter((a) => ids.has(a.id));
}
function branchSections(region) {
  const out = [];
  const branches = [...new Set(byRegion(region).map((n) => n.branch))];
  for (const b of branches) {
    const list = byRegion(region).filter((n) => n.branch === b);
    out.push(`#### ${BRANCH_FR[b] || b} (${list.length} nœud${list.length > 1 ? "s" : ""})\n\n${nodeTable(list)}\n${vfxList(list)}`);
  }
  return out.join('\n');
}
const groupsOf = (region) => tree.exclusiveGroups.filter((g) => g.region === region);
function groupTable(region) {
  const rows = ['| Groupe | Capacité | Options (une seule au choix) |', '|---|---|---|'];
  for (const g of groupsOf(region)) rows.push(`| \`${g.id}\` | ${A.get(g.ability)?.name || g.ability} | ${g.nodes.map((id) => `${N.get(id).name} (\`${id}\`)`).join(' · ')} |`);
  return rows.join('\n');
}

// ------------------------------------------------------------------ balance tables
function balanceTables() {
  const s = B.summary;
  const lines = [];
  lines.push('| Niv. | Guerrier | Mage | Rôdeur | Écart max | Résultat |', '|---|---|---|---|---|---|');
  for (const L of [5, 15, 30]) {
    const x = s.levels[L];
    lines.push(`| ${L} | ${fr(x.classScore.warrior)} (${pct(x.deviationPct.warrior / 100, 1)}) | ${fr(x.classScore.mage)} (${pct(x.deviationPct.mage / 100, 1)}) | ${fr(x.classScore.ranger)} (${pct(x.deviationPct.ranger / 100, 1)}) | ${fr(x.maxDeviationPct, 1)} % | ${x.ok ? 'OK' : 'hors cible'} |`);
  }
  lines.push('', '| Niv. | Build | Points | PV | Attaque | Défense | DPS | Contrôle | Survie (s) | Victimes par vie | Écart au niveau |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of B.results) {
    const dev = r.hybrid ? '—' : `${pct(s.levels[r.L].buildDeviationPct[r.build] / 100, 1)}`;
    lines.push(`| ${r.L} | ${r.hybrid ? '*hybride* ' : ''}\`${r.build}\` | ${r.spent}/${r.budget} | ${r.stats.mhp} | ${r.stats.atk} | ${r.stats.def} | ${fr(r.dps, 1)} | ${Math.round(r.control * 100)} % | ${fr(r.ttd, 1)} | ${fr(r.kpl)} | ${dev} |`);
  }
  lines.push('', '| Hybride | Niv. | Victimes par vie | Meilleur pur de sa classe | Ratio | Cible 80–100 % |', '|---|---|---|---|---|---|');
  for (const h of s.hybrids) lines.push(`| \`${h.build}\` | ${h.L} | ${fr(h.kpl)} | \`${h.bestPure}\` (${fr(h.bestPureKpl)}) | ${fr(h.ratioPct, 1)} % | ${h.ok ? 'OK' : 'hors cible'} |`);
  return lines.join('\n');
}

// ======================================================================================== ARBRE_COMPETENCES.md
const st = V.stats;
const survie = byRegion('survie');
const regionsInfo = ['guerrier', 'mage', 'rodeur'].map((r) => `${REGION_FR[r]} ${byRegion(r).length}`).join(', ');
const reachWarrior = reachCosts(tree, 'warrior');
const reachMage = reachCosts(tree, 'mage');
const reachRanger = reachCosts(tree, 'ranger');
const v02Row = (cls, abIds, d) => abIds.map((ab) => {
  const n = tree.nodes.find((x) => x.type === 'skill' && x.ability === ab);
  return `${A.get(ab).name} ${d.get(n.id)} pt${d.get(n.id) > 1 ? 's' : ''}`;
}).join(', ');

const arbre = `# L'Arbre des Brumes — arbre de compétences v0.3

> ⚠️ **Décisions du 23/09 prioritaires** : voir [\`DECISIONS.md\`](DECISIONS.md) (pas de roulade au niveau 1, marché intelligent à prix libres, **pas de réinitialisation : Renaissance au niveau 30**).


> **Document final de conception** (synthèse des six brouillons de \`docs/design/drafts/\`, gardés en annexe).
> Données : \`docs/design/skilltree.json\` (un seul fichier : règles, capacités, ${tree.nodes.length} nœuds, clés de voûte, statuts).
> Outils : \`node docs/design/tools/build_tree.mjs\` (fusion des brouillons), \`validate.mjs\` (références, liens,
> coordonnées), \`balance.mjs\` (équilibrage rapide), \`gen_docs.mjs\` (ce document). **Toutes les tables sont générées
> depuis le JSON** : en cas de doute, le JSON fait foi.
> Répond aux retours des joueurs (ROADMAP §1 et §2 bis) : « un très grand arbre où l'on choisit où mettre ses points »,
> « une seule compétence au départ », « des variantes qui changent toutes les compétences, même l'attaque de base »,
> « des compétences de base que tout le monde apprend, comme sprint ou saut, puis on se spécialise », « un mage peut
> apprendre des compétences de guerrier, avec des pénalités et plus cher », « n'importe quelle touche pour n'importe
> quelle compétence », « simple et accessible ».

## 1. En bref (pour les joueurs)

- **Au niveau 1, vous n'avez que l'attaque de base de votre classe** : la Frappe (Guerrier), le Trait arcanique (Mage)
  ou le Tir (Rôdeur). À chaque niveau, vous gagnez **1 point** (plus 1 point bonus aux niveaux 5, 10, 15, 20, 25 et 30),
  soit **${points(30)} points au niveau 30**. Vous les placez **où vous voulez**.
- **D'abord les Fondamentaux**, au cœur de l'arbre, que tout le monde apprend : **Roulade, Sprint, Saut, Garde,
  Attaque chargée** (1 point chacun). Dès que vous en connaissez **3**, la région de votre classe s'ouvre et vous vous
  spécialisez.
- **Perdu ? Suivez le parcours conseillé** : jusqu'au niveau 10, chaque montée de niveau propose le prochain nœud
  (Roulade d'abord), en un clic (§3.2). Rien n'est définitif avant le niveau 10.
- **Un seul grand arbre pour tout le monde** : au centre la **Survie**, autour les régions **Guerrier** (en haut),
  **Mage** (en bas à gauche) et **Rôdeur** (en bas à droite), et entre elles trois **passerelles** hybrides :
  **Lame spirituelle** (Guerrier ↔ Mage), **Arcaniste sylvestre** (Mage ↔ Rôdeur), **Chasseur** (Rôdeur ↔ Guerrier).
- **Vous pouvez aller partout.** Mais hors de votre classe, vous n'avez « pas de don pour ça » : les nœuds coûtent
  **2 points** au lieu d'un (3 pour une clé de voûte) et ses compétences subissent l'**Inaptitude** : −25 % de
  puissance, +25 % de coût, +20 % de recharge. Plus besoin de refaire un personnage pour essayer autre chose (on garde
  quand même plusieurs personnages par compte).
- **Quatre sortes de nœuds** : les **compétences** (une nouvelle capacité), les **variantes** (elles transforment une
  capacité ; une seule par groupe, et **toutes** les capacités en ont, même l'attaque de base et la roulade), les
  **passifs** (petits bonus, parfois en 2 ou 3 rangs) et les **clés de voûte** (gros effet avec une vraie contrepartie).
- **Toutes les touches se changent** : barre de 8 emplacements, glisser-déposer depuis le livre de compétences (K),
  et Options › Touches.
- **Réinitialisation gratuite jusqu'au niveau 10**, puis contre de l'or chez le Maître des arts. Les personnages de la
  v0.2 gardent la roulade et le sprint et retrouvent automatiquement leurs 4 compétences.

## 2. Chiffres clés

| | |
|---|---|
| Nœuds | **${tree.nodes.length}** : ${typeCounts(tree.nodes)} (+ la racine) |
| Par zone | Survie ${survie.length} (Cœur + 5 Fondamentaux + ${survie.length - 6} nœuds d'anneau) · ${regionsInfo} · passerelles ${['pont_gm', 'pont_mr', 'pont_rg'].map((r) => `${REGION_FR[r]} ${byRegion(r).length}`).join(', ')} |
| Capacités | **${tree.abilities.length}** : ${tree.abilities.filter((a) => a.home === null).length} de Survie, ${tree.abilities.filter((a) => a.home === 'warrior').length} Guerrier, ${tree.abilities.filter((a) => a.home === 'mage').length} Mage, ${tree.abilities.filter((a) => a.home === 'ranger').length} Rôdeur, ${tree.abilities.filter((a) => Array.isArray(a.home)).length} de passerelle ; les 12 capacités de la v0.2 gardent leur id |
| Groupes de variantes exclusives | **${tree.exclusiveGroups.length}** (chaque capacité en a au moins un) |
| Clés de voûte | **${tree.keystones.length}** |
| Points au niveau 30 | ${points(30)} ; acheter tout l'arbre coûterait ${st.tree.fullTreeCost.warrior} (Guerrier) à ${st.tree.fullTreeCost.ranger} points (Rôdeur) : un personnage en prend environ un dixième |
| Capacités v0.2 depuis le départ | Guerrier : ${v02Row('warrior', ['heavy_blow', 'whirlwind', 'war_cry'], reachWarrior)} · Mage : ${v02Row('mage', ['fireball', 'frost_nova', 'heal'], reachMage)} · Rôdeur : ${v02Row('ranger', ['piercing_shot', 'rapid_fire', 'arrow_rain'], reachRanger)} (hors Fondamentaux) |

## 3. Règles du système

### 3.1 Points

- \`points(niveau) = (niveau − 1) + floor(niveau / 5)\` ; niveau maximum **30** (\`MAX_LEVEL\` passe de 20 à 30).

| Niveau | ${Object.keys(tree.rules.points.table).join(' | ')} |
|---|${Object.keys(tree.rules.points.table).map(() => '---').join('|')}|
| Points | ${Object.values(tree.rules.points.table).join(' | ')} |

- Rangs : certains passifs ont 2 ou 3 rangs ; chaque rang coûte le prix du nœud. Les points non dépensés se gardent.
- Ordre de grandeur d'un personnage de niveau 30 : Fondamentaux 5, Survie 5 à 9, sa région 18 à 25, le reste en
  passerelles ou chez une autre classe.

### 3.2 Porte des Fondamentaux

- Les 5 Fondamentaux sont reliés au **Cœur des Brumes** (racine toujours acquise) : ils s'apprennent sans lien avec le
  nœud de départ, dans n'importe quel ordre.
- **Tant qu'un personnage connaît moins de 3 Fondamentaux, il ne peut rien apprendre d'autre** (code d'erreur
  \`tree_gate\`, « Apprenez d'abord 3 Fondamentaux »). Un nouveau personnage apprend donc 3 Fondamentaux aux niveaux 2,
  3 et 4, puis se spécialise.
- Racines de connexité : le Cœur + le nœud de départ de sa classe. Tout autre nœud doit être relié à un nœud acquis.
- **Niveau 1 sans roulade** (décision) : le niveau 2 arrive après ~4 Gluants (100 XP), monstres passifs de la zone de
  départ ; la fenêtre de montée de niveau propose la Roulade en premier. Pas d'« esquive d'appoint ».

#### Parcours conseillé (niveaux 2 à 10, \`rules.guide\`)

${esc(tree.rules.guide.text)}

| Niveau | Guerrier | Mage | Rôdeur |
|---|---|---|---|
${tree.rules.guide.paths.warrior.map((st, i) => `| ${st.level} | ${['warrior', 'mage', 'ranger'].map((c) => { const p = tree.rules.guide.paths[c][i]; return p.nodes.map((id) => `**${tree.nodes.find((n) => n.id === id).name}**`).join(' + ') + ' — ' + esc(p.why); }).join(' | ')} |`).join('\n')}

### 3.3 Coûts : « pas de don pour ça »

| Nœud | Guerrier | Mage | Rôdeur |
|---|---|---|---|
${Object.entries(tree.rules.costs.matrix).map(([r, c]) => `| ${REGION_FR[r]} | ${c.warrior} | ${c.mage} | ${c.ranger} |`).join('\n')}
| Clé de voûte d'une autre classe ou d'une passerelle non voisine | 3 | 3 | 3 |
| Nœud de départ d'une autre classe (donne son attaque de base, avec Inaptitude) | 2 | 2 | 2 |

Chaque nœud du JSON porte son coût pour les trois classes (\`costs: { warrior, mage, ranger }\`) ; la vérité reste la
fonction pure \`nodeCost(node, cls)\` (\`docs/design/tools/lib/treelib.mjs\`, à reprendre dans \`shared/skills.js\`).

### 3.4 Inaptitude

- Chaque capacité a une origine \`home\` : \`'warrior'\`, \`'mage'\`, \`'ranger'\`, deux classes pour une passerelle, ou
  \`null\` (Survie : jamais d'Inaptitude).
- Hors de son origine : **puissance −25 %**, **mana et endurance +25 %** (arrondi au-dessus), **recharge +20 %**.
  Icône « Inapte » orange sur la capacité et dans l'infobulle.
- **Réductions** (elles s'additionnent, plafond **0,6** : il reste toujours au moins 40 % de la pénalité) :
${tree.rules.inaptitude.reducers.map((r) => `  - ${r}`).join('\n')}
- **Attaque de référence** : ${tree.rules.inaptitude.referenceAttack} Sans cette règle, un mage (attaque de base plus
  forte à haut niveau) frapperait plus fort au Tourbillon qu'un guerrier.
- Exemple : un Mage de niveau 18 qui prend le Tourbillon (×1,9, 20 mana, 18 endurance, 10 s) le lance à **×1,43**,
  **25 mana**, **23 endurance**, **12 s**, avec l'attaque d'un guerrier du même niveau, et seulement avec une arme de
  mêlée en main. Avec le *Serment de la lame spirituelle* (réduction 0,33) : ×1,58, 24 mana, 22 endurance, 11,3 s.

### 3.5 Armes requises

| Exigence (\`weapon\`) | Il faut | Sinon |
|---|---|---|
${Object.entries(tree.rules.weapon).map(([k, v]) => `| \`${k}\` | ${v.needs} | ${v.otherwise} |`).join('\n')}

L'équipement n'est plus réservé à une classe (voir \`OBJETS_ARTISANAT.md\`) : c'est l'arme tenue qui débloque les
compétences d'arme. Un hybride doit donc s'équiper pour ses compétences (épée runique, grimoire, arc des astres…).

### 3.6 Garde-fous (appliqués par \`resolveAbility\`)

| Valeur | Borne |
|---|---|
| Bonus de dégâts de l'arbre (une seule enveloppe additive) | ≤ ${pct(tree.rules.caps.treeDamagePct)} |
| Invulnérabilité de roulade | ≤ ${tree.rules.caps.rollIframeMs} ms et ≤ ${Math.round(tree.rules.caps.rollIframeShareOfCd * 100)} % de sa recharge |
| Coût d'une roulade | ≥ ${tree.rules.caps.rollMinSt} (sauf clé *Danseur des brumes*, limitée par sa recharge de 1,8 s) |
| Endurance max / régénération / délai | ≤ ${tree.rules.caps.stMax} / ≤ ${tree.rules.caps.stRegenMax} par s / ≥ ${fr(tree.rules.caps.stRegenDelayMinMs / 1000)} s |
| Sprint | ≥ ${tree.rules.caps.sprintMinStPerS} endurance/s, ≤ ×${fr(tree.rules.caps.sprintMaxMult)} |
| Réduction de recharge | ≤ ${Math.round(tree.rules.caps.cdrMax * 100)} % |
| Garde à 100 % | seulement avec un bouclier et la clé *Mur vivant* (85 % contre un boss) |
| Équilibre permanent / résistances | ≤ ${tree.rules.caps.equilibreMax} / ≤ ${Math.round(tree.rules.caps.resistMax * 100)} % |
| Vol de vie | ≤ ${Math.round(tree.rules.caps.lifestealMax * 100)} % des dégâts de mêlée |
| Tir en mouvement | toujours limité à ${Math.round(tree.rules.caps.rangedMoveMax * 100)} % de la vitesse (aucune variante ne le lève) |
| Contrôle | Gel, Enracinement, étourdissement : immunité ${tree.rules.caps.ccImmunityS} s ensuite, jamais sur un boss (seulement du déséquilibre) |

Formule de dégâts proposée pour la v0.3 : ${tree.rules.damageFormula}. Jusqu'au niveau 10 rien ne change par rapport à
la v0.2 ; au-delà, les armures T5–T6 ne rendent pas intouchable.

## 4. Structure et coordonnées

- **Un seul repère** : ${tree.meta.frame}
- Survie : rayon 0 à ${st.survieMaxRadius}. Départs de classe au rayon 500 : \`guerrier_depart\` (0, 500),
  \`mage_depart\` (−433, −250), \`rodeur_depart\` (433, −250). Régions jusqu'au rayon ~1 500, passerelles entre 700 et 1 250.

| Zone | Angles occupés | Rayons |
|---|---|---|
${Object.entries(st.sectors).map(([r, s]) => `| ${REGION_FR[r]} | ${s.min}° à ${s.max > 360 ? s.max - 360 : s.max}° | ${s.rmin} à ${s.rmax} |`).join('\n')}

- Vérifié par \`validate.mjs\` : ${st.links} liens tous réciproques, **${st.linkCrossings} croisement**, deux nœuds jamais à
  moins de ${st.minNodeDistance.d} unités, aucun lien à moins de ${st.minLinkClearance.d} unités d'un nœud qui ne le concerne pas,
  tous les nœuds joignables depuis les trois départs, et sur ${st.exclusiveChoiceSamples.samples} tirages aléatoires d'une option par groupe
  exclusif, **${st.exclusiveChoiceSamples.blocked}** nœud rendu inaccessible : choisir une variante ne bloque jamais le chemin.

\`\`\`
                               Gardien (90°)
               Maître d'armes     ║     Berserker
         Lame spirituelle   ╲     ║     ╱    Chasseur
          (Guerrier↔Mage)     Coup puissant      (Rôdeur↔Guerrier)
                                  ║
                       guerrier_depart (0, 500)
                                  ║
                         Seuil de l'Acier
           Pyromancie ─ Seuil des    [ Cœur des Brumes ]    Seuil des Bois ─ Traqueur
        Mage  Arcanes    Arcanes      5 Fondamentaux          Tireur    Rôdeur
           Givre    mage_depart     anneau de Survie     rodeur_depart   Venin
                              ╲                         ╱
                           Arcaniste sylvestre (Mage↔Rôdeur, 270°)
\`\`\`

Jonctions entre brouillons (décidées à la synthèse) : Seuils de Survie ↔ nœuds de départ ; *Œil sylvestre*
(\`mr_p_oeil_sylvestre\`) ↔ *Cueilleur de brume* (\`ro_ve_cueilleur\`) ; *Onde tranchante* (\`gm_onde_tranchante\`) ↔
*Flamme attisée* (\`ma_p_flamme_attisee\`) ; *Dépeceur* (\`rg_depeceur\`) ↔ *Entaille* (\`gu_be_entaille\`).

## 5. Les Fondamentaux et la Survie

### 5.1 Les 5 Fondamentaux

Chaque Fondamental répond à une menace différente :

| Menace | Réponse | Coût |
|---|---|---|
| Coup télégraphié, projectile | **Roulade** (invulnérable ${A.get('roulade').iframeMs} ms) | ${A.get('roulade').st} endurance |
| Onde de choc au sol, balayage bas (télégraphe « rasant » \`lo\`, dessiné en ondes) | **Saut** (${A.get('saut').airMs} ms en l'air, sans invulnérabilité) | ${A.get('saut').st} endurance |
| Coups de face, enchaînements rapides | **Garde** (parade parfaite en variante) | endurance selon le coup |
| Distance à combler, fuite, voyage | **Sprint** (×${fr(A.get('sprint').mult)}) | ${A.get('sprint').stPerS}/s |
| Ouverture après une attaque ennemie, posture à briser | **Attaque chargée** (×1,0 → ×${fr(A.get('attaque_chargee').powerMax)}, poise ×${A.get('attaque_chargee').poiseMax}) | +${A.get('attaque_chargee').st} endurance |

- **Roulade** : identique à la v0.2 (30 endurance, 5 m en 0,55 s, 0,35 s d'invulnérabilité, 0,6 s entre deux).
- **Sprint** : identique à la v0.2 (×1,45, 18 endurance/s, utilisable en combat ; aucun tir en sprint).
- **Saut** (nouveau, touche C) : 15 endurance, décollage 0,05 s, **0,35 s en l'air**, réception 0,1 s à 50 %. En l'air,
  on évite **seulement** les attaques rasantes (\`lo\`). Pas d'escalade : le saut n'a aucune hauteur côté serveur et ne
  change pas la vitesse maximale surveillée par l'anti-triche. **Attaque sautée** : l'attaque de base en l'air ; en
  mêlée ×1,3 dégâts et ×1,5 poise en zone de 1,5 m à la réception ; à distance un seul projectile ×1,1 et la distance du
  saut est divisée par deux (pas de « kite aérien » : 27 d'endurance au total).
- **Garde** (E maintenue) : bloque de face (120°). Réduction : **bouclier = sa valeur de blocage (61 à 90 %)**, arme de
  mêlée 50 %, autre 30 % ; 100 % seulement avec la clé *Mur vivant*. Endurance par coup bloqué :
  \`min(60, 8 + 60 × dégâts bruts / PV max)\`, ×1,5 pour un coup télégraphié. Ne bloque ni les rasants (\`lo\`), ni les
  imblocables (\`nb\`), ni les sorts (\`mag\`) sauf avec la variante *Égide arcanique*. À 0 d'endurance : garde brisée.
- **Attaque chargée** : maintenir l'attaque de base (de n'importe quelle classe) 0,4 à 1,2 s : ×1,0 → ×1,8, poise
  jusqu'à ×2, +10 endurance, super-armure pendant les 0,3 dernières secondes. La recharge de l'attaque de base repart au
  relâchement : ce n'est **pas** un gain de DPS, c'est un gros coup au bon moment. L'arc se bande en 1 s et perce une
  cible à pleine charge.

### 5.2 Nouveaux marqueurs de télégraphes et vacillement du joueur

| Marqueur | Sens | Réponse | Dessin au sol |
|---|---|---|---|
| (aucun) | coup physique normal | roulade ou garde | décal rouge actuel |
| \`lo\` | rasant (onde, balayage bas) | **saut** ou roulade | ondes concentriques |
| \`nb\` | imblocable (séisme, empoignade) | roulade | bordure crénelée |
| \`mag\` | sort | roulade ; garde avec Égide | teinte violette, runes |

Données v0.2 à marquer : \`golem_stomp\` et \`golem_sweep\` → \`lo\`, \`golem_quake\` → \`nb\`, \`skel_curse\` → \`mag\`.
**Vacillement** : ${tree.statuses.find((s) => s.id === 'vacillement').desc}

### 5.3 L'anneau de Survie (${survie.length} nœuds, 1 point pour tout le monde)

${branchSections('survie')}

**Groupes de variantes de Survie** :

${groupTable('survie')}

**Capacités de Survie** :

${abilityTable([...new Set(abilitiesOf('survie').concat([A.get('attaque_sautee'), A.get('riposte_parfaite')]))])}

${abilityNotes(abilitiesOf('survie'))}

## 6. Guerrier (${byRegion('guerrier').length} nœuds : ${typeCounts(byRegion('guerrier'))})

Trois identités : **Gardien** (bouclier, blocage, protection du groupe), **Berserker** (rage, saignement, gros coups,
vol de vie), **Maître d'armes** (rythme, critiques, estocs, mobilité sans invulnérabilité). Le départ donne la
**Frappe** ; *Coup puissant* (à 1 point) ouvre les trois branches. Maîtrises d'épée : courte et longue (Gardien),
bâtarde et espadon (Berserker), rapière, cimeterre et lame courbe (Maître d'armes), épée runique (Lame spirituelle).
Les étourdissements et interruptions ne touchent jamais un boss.

### 6.1 Capacités

${abilityTable(abilitiesOf('guerrier'))}

${abilityNotes(abilitiesOf('guerrier'))}

### 6.2 Nœuds

${branchSections('guerrier')}

**Groupes de variantes** :

${groupTable('guerrier')}

## 7. Mage (${byRegion('mage').length} nœuds : ${typeCounts(byRegion('mage'))})

Fragile, engagé, sous pression de mana : les incantations sont annulées par une roulade, les canalisations immobiles
vident l'endurance, le Météore s'affiche au sol 1 s avant l'impact. Le **Trait arcanique** (id \`firebolt\` conservé)
est neutre ; son **Affinité** (feu, givre ou éclat, dans chaque branche) et sa **Forme** (jumeaux ou perçant, près du
départ) le transforment. Trois branches sur le même gabarit : **Pyromancie** (brûler puis faire détoner),
**Arcanes** (la pierre-astre : mana, soin, mobilité), **Givre** (ralentir puis briser). *Érudit martial* (clé de voûte
vers la Lame spirituelle) réduit l'Inaptitude des compétences de Guerrier.

### 7.1 Capacités

${abilityTable(abilitiesOf('mage'))}

${abilityNotes(abilitiesOf('mage'))}

### 7.2 Nœuds

${branchSections('mage')}

**Groupes de variantes** :

${groupTable('mage')}

## 8. Rôdeur (${byRegion('rodeur').length} nœuds : ${typeCounts(byRegion('rodeur'))})

Trois branches : **Tireur** (tirs chargés, perforation, critiques, ultime *Trait fatal*), **Traqueur** (mobilité,
pièges, marques, couteau de ceinture), **Venin** (poisons en charges, jauge de saignement, nuages). Le **Tir** a deux
groupes de variantes : *lesté* ou *véloce* près du départ, puis *ricochet*, *à bout portant* ou *pointes enduites*
dans les branches. Aucune variante ne lève la règle du tir à 40 % de la vitesse. Le seul recul outillé, le *Bond de
retrait*, coûte 28 d'endurance, 8 de mana, 10 s de recharge, 0,15 s d'invulnérabilité, et reste interdit juste après
une roulade. Ultimes et clés de voûte demandent des points dépensés dans la région (\`reqRegionPoints\`).

### 8.1 Capacités

${abilityTable(abilitiesOf('rodeur'))}

${abilityNotes(abilitiesOf('rodeur'))}

### 8.2 Nœuds

${branchSections('rodeur')}

**Groupes de variantes** :

${groupTable('rodeur')}

## 9. Les passerelles

Les compétences d'une passerelle comptent pour **ses deux classes** (pas d'Inaptitude pour elles) ; la troisième
classe paie 2 points par nœud, 3 pour la clé de voûte, et subit l'Inaptitude.

### 9.1 Lame spirituelle — Guerrier ↔ Mage (${byRegion('pont_gm').length} nœuds)

Lames enchantées (feu, givre ou arcane), *Onde tranchante*, *Égide runique*, maîtrise de l'épée runique (elle sert de
focalisateur sans pénalité) et le *Serment de la lame spirituelle* (Inaptitude Guerrier/Mage réduite d'un tiers, −10 %
PV et mana).

${abilityTable(abilitiesOf('pont_gm'))}

${abilityNotes(abilitiesOf('pont_gm'))}

${branchSections('pont_gm')}

${groupTable('pont_gm')}

### 9.2 Arcaniste sylvestre — Mage ↔ Rôdeur (${byRegion('pont_mr').length} nœuds)

Flèches runiques, ronces givrées, feu follet ; la clé *Arc des astres* fait compter l'arc comme un focalisateur.

${abilityTable(abilitiesOf('pont_mr'))}

${abilityNotes(abilitiesOf('pont_mr'))}

${branchSections('pont_mr')}

${groupTable('pont_mr')}

### 9.3 Chasseur — Rôdeur ↔ Guerrier (${byRegion('pont_rg').length} nœuds)

Javelots et lances, *Coup d'épieu*, appâts, deux armes (Ambidextrie) et la clé *Frénésie du chasseur*.

${abilityTable(abilitiesOf('pont_rg'))}

${abilityNotes(abilitiesOf('pont_rg'))}

${branchSections('pont_rg')}

${groupTable('pont_rg')}

## 10. Clés de voûte

| id | Nom | Zone | Gain | Contrepartie | Conditions |
|---|---|---|---|---|---|
${tree.keystones.map((k) => `| \`${k.id}\` | **${esc(k.name)}** | ${REGION_FR[k.region]} | ${esc(k.upside)} | ${esc(k.drawback)} | ${[k.minLevel ? `niveau ${k.minLevel}` : '', k.reqRegionPoints ? `${k.reqRegionPoints.min} points dans la région` : ''].filter(Boolean).join(', ') || '—'} |`).join('\n')}

## 11. Statuts

| id | Nom | Effet |
|---|---|---|
${tree.statuses.map((s) => `| \`${s.id}\` | ${s.name} | ${esc(s.desc)} |`).join('\n')}

## 12. Équilibrage

### 12.1 Méthode (\`node docs/design/tools/balance.mjs\`)

- Deux constructions plausibles par classe (Gardien et Berserker ; Pyromancien et Mage de givre ; Tireur et Venin) aux
  niveaux 5, 15 et 30, avec un équipement typique du palier (Inhabituel au niveau 5, Rare ensuite, niveau d'objet =
  niveau), et deux hybrides aux niveaux 15 et 30 : **Mage lame spirituelle** (épée runique + grimoire, Tourbillon du
  Guerrier) et **Rôdeur de givre** (Arcaniste sylvestre + Lance de glace du Mage).
- Chaque construction est complétée par les chemins les moins chers et **validée par \`validateTree\`** (points, porte,
  liens, variantes exclusives) : ce sont des allocations légales.
- Combat solo de 60 s contre un monstre de référence du même niveau, au pas de 0,05 s : recharges, mana, endurance
  (30 gardés pour une roulade), engagement (préparation + incantation + canalisation + récupération), renforts, soins,
  une potion du palier toutes les 20 s, brûlures (non cumulables) et poisons (charges plafonnées), Froid et
  déséquilibre du monstre (contrôle), vol de vie, garde.
- **Victimes par vie** = (DPS / PV du monstre) × temps avant de mourir. L'**exposition** de chaque classe (la part des
  coups du monstre qui la touchent : la mêlée reste au contact, le mage et le rôdeur non) est calibrée **une seule fois**
  sur le kit v0.2 (préréglage de migration + armes v0.2) aux niveaux 5, 10 et 14, que la simulation v0.2
  (\`tests/balance/sim.mjs\`, \`docs/EQUILIBRAGE.md\`) mesurait à ±9 %. Exposition obtenue : ${Object.entries(B.summary.calibration).map(([c, v]) => `${({ warrior: 'Guerrier', mage: 'Mage', ranger: 'Rôdeur' })[c]} ${fr(v.exposure, 3)}`).join(', ')}.
- Cibles : classes (moyenne de leurs deux constructions) à **±15 %** à chaque niveau, aucune construction à plus de
  ±25 % de la moyenne ; hybrides entre **80 % et 100 %** de la meilleure construction pure de leur classe.
- Ce modèle est une **vérification rapide**, pas la simulation de combat : elle devra être refaite avec
  \`tests/balance/sim.mjs\` étendu à l'arbre (les profils ci-dessus sont prêts à y être repris).

### 12.2 Résultats (${B.summary.ok ? 'toutes les cibles atteintes' : 'HORS CIBLE'})

${balanceTables()}

Lecture : le Gardien est la construction la plus sûre et le Berserker la plus risquée (même classe, ±20 %), le Mage
de givre domine vers le niveau 15 par le contrôle et le pyromancien au niveau 30 par les dégâts ; les hybrides sont
viables (${Math.round(Math.min(...B.summary.hybrids.map((h) => h.ratioPct)))} à ${Math.round(Math.max(...B.summary.hybrids.map((h) => h.ratioPct)))} % du meilleur pur) mais jamais meilleurs, parce qu'ils paient les nœuds 2 points et gardent au moins
une partie de l'Inaptitude.

### 12.3 Changements d'équilibrage appliqués aux brouillons (${tree.meta.balanceChanges.length})

| Cible | Changement et raison |
|---|---|
${tree.meta.balanceChanges.map((c) => `| \`${c.target}\` | ${esc(c.why)} |`).join('\n')}

Les valeurs exactes avant / après de chaque changement sont dans \`skilltree.json › meta.balanceChanges\`.

Côté objets : la potion de soin suprême passe de 520 à **400 PV** et **toutes les potions partagent une recharge de
20 s** (voir \`OBJETS_ARTISANAT.md\`).

## 13. Validation (\`node docs/design/tools/validate.mjs\`)

Résultat : **${V.ok ? 'OK' : 'ÉCHEC'}**, ${V.errors.length} erreur, ${V.warnings.length} avertissement${V.warnings.length > 1 ? 's' : ''}${V.warnings.length ? ` (${V.warnings.map(esc).join(' ; ')})` : ''}.

Contrôles de l'arbre : ids uniques ; liens existants et réciproques ; coûts cohérents avec \`nodeCost\` ; 5 Fondamentaux
reliés au Cœur ; porte des 3 Fondamentaux appliquée ; chaque départ donne une seule capacité (l'attaque de base) ;
tailles des régions et passerelles ; chaque passerelle reliée à ses deux régions ; tout nœud joignable par les trois
classes ; capacités v0.2 à 4 points au plus ; chaque capacité débloquée quelque part et dotée d'au moins un groupe
de variantes ; chaque variante avec son intention visuelle ; chaque clé de voûte avec gain et contrepartie ;
vocabulaire des effets (${st.tree.stats} statistiques décrites dans \`effectVocabulary\`) ; géométrie (distances, liens,
croisements, secteurs) ; tirages de variantes ; préréglages de migration valides aux niveaux 1, 3, 5 et 20.

Coût maximal pour atteindre une zone depuis son départ (Dijkstra, sans la porte) :

| Classe | ${Object.keys(st.reach.warrior.maxCostByRegion).map((r) => REGION_FR[r]).join(' | ')} |
|---|${Object.keys(st.reach.warrior.maxCostByRegion).map(() => '---').join('|')}|
${['warrior', 'mage', 'ranger'].map((c) => `| ${({ warrior: 'Guerrier', mage: 'Mage', ranger: 'Rôdeur' })[c]} | ${Object.values(st.reach[c].maxCostByRegion).join(' | ')} |`).join('\n')}

## 14. Données, serveur et interface

### 14.1 Format (\`skilltree.json\`)

- \`rules\` (points, porte, coûts, Inaptitude, armes, garde-fous, réinitialisation, migration, barre, touches),
  \`classes\`, \`regions\`, \`statuses\`, \`abilities\`, \`exclusiveGroups\`, \`nodes\`, \`keystones\`, \`migration\`,
  \`effectVocabulary\`, \`meta.balanceChanges\`.
- Nœud : \`{ id, region, branch, type, name, desc, x, y, links, maxRank, costs, start?, fondamental?, migrationGift?,
  minLevel?, reqRegionPoints?, ability?, exclusiveGroup?, effects, vfx? }\`.
- Effet : \`{ stat | mod, op: 'add' | 'mul' | 'set', value, perRank?, atRank?, cap?, final?, when? }\`. \`mod\` vaut
  \`"<idCapacité>.<champ>"\` ou \`"unlock"\`. **Toutes les valeurs relatives sont des fractions** (0,04 = +4 %) ; \`mul\`
  s'additionne à un multiplicateur (valeur finale = base × (1 + Σ mul)).
- Résolution d'une capacité (\`resolveAbility\`, pure, partagée client/serveur) : base → variante (\`set\`) → \`add\` →
  \`mul\` → statistiques du personnage (enveloppe de dégâts plafonnée) → Inaptitude et attaque de référence → pénalité
  d'arme → garde-fous → effets \`final\`.

### 14.2 Validation serveur et protocole

- État persistant : \`skills: { ver, alloc: { nodeId: rang }, gift: ['fond_roulade', 'fond_sprint'], legacyFloor, rb, affinity, loadout: [8] }\`.
- \`validateTree(cls, level, alloc, gift)\` vérifie l'état complet : ids, rangs, niveau minimum, points, groupe
  exclusif, porte, points dans la région, connexité, variante de capacité connue (implémentation de référence :
  \`docs/design/tools/lib/treelib.mjs\`). Codes : \`tree_unknown\`, \`tree_points\`, \`tree_gate\`, \`tree_link\`,
  \`tree_exclusive\`, \`tree_rank\`, \`tree_level\`, \`tree_req\`, \`tree_variant\`, \`tree_combat\`, \`tree_gold\`, \`tree_npc\`, \`loadout_bad\`.
- Messages (additifs) : C2S \`skill_alloc { add: [{ id, r? }] }\` (tout ou rien), \`skill_respec { mode, id?, npc? }\`,
  \`loadout { slots }\`, \`ability { slot, tg?, x?, z?, ph?: 'start' | 'release' }\`, \`jump { dx, dz }\`, \`guard { on }\`,
  \`settings { keys }\` ; S2C \`skills { pts, spent, alloc, gift, loadout }\`, FX \`jump\`, \`land\`, \`guard\`,
  \`block\`, \`parry\`, \`perfect\`, \`charge\`, \`charged\`, \`vacille\`, \`guard_break\`, télégraphes \`lo\`/\`nb\`/\`mag\`.
- Limites : 5 messages d'arbre par seconde, 64 nœuds par message (au-delà : \`security.flag(player, 'tree_spam', 1)\`).
  Le serveur ne fait jamais confiance aux valeurs du client : il résout la capacité et vérifie l'arme à chaque usage.

### 14.3 Pas de réinitialisation ; migration

- Aucune réinitialisation (DECISIONS.md §3) : la Renaissance, au niveau 30, rend tous les points.
- **Personnages v0.2** : ${tree.rules.migration.text}

| Classe | Préréglage « Reprendre mon style » | Points |
|---|---|---|
${Object.entries(tree.migration.presets).map(([c, p]) => `| ${({ warrior: 'Guerrier', mage: 'Mage', ranger: 'Rôdeur' })[c]} | ${p.nodes.map((id) => N.get(id).name).join(', ')} | ${p.cost} |`).join('\n')}

### 14.4 Barre d'action, livre et touches

- **8 emplacements** (touches 1 à 8), un par personnage, sauvegardés sur le serveur ; **livre de compétences** (K)
  avec les valeurs résolues (variante, passifs, Inaptitude en orange) et **glisser-déposer** ; potions dans la barre
  (par défaut 5 et 6, comme en v0.2). Toute action se réassigne (Options › Touches), souris et combinaisons comprises ;
  touches enregistrées par code physique (AZERTY/QWERTY).

| Action | Touche par défaut |
|---|---|
${Object.entries(tree.rules.keys).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

### 14.5 Écran de l'arbre (touche N)

Canevas 2D déplaçable et zoomable (0,3 à 2,0), mini-carte, recherche (Ctrl+F), chemin le moins cher au survol
(Dijkstra sur les coûts du personnage), **aperçu avant validation** (rien n'est dépensé sans « Valider (n points) »).
Formes par type : compétence = grand cercle doré, variante = losange turquoise (les variantes d'un groupe reliées par
un arc pointillé), passif = petit cercle avec « 1/3 », clé de voûte = octogone pourpre, Fondamental = anneau blanc-or.
Fond teinté par région (Guerrier ${tree.classes.warrior.color}, Mage ${tree.classes.mage.color}, Rôdeur ${tree.classes.ranger.color}, Survie brume neutre, passerelles en dégradé).
Coût 2 ou 3 en pastille orange « Pas de don : 2 points, Inaptitude −25 % ». Lisible en 1280 × 720.

## 15. Décisions de synthèse

1. **Repère** : y vers le haut pour tous ; le brouillon Rôdeur (y écran) a été retourné.
2. **Ids** : départs \`guerrier_depart\`, \`mage_depart\`, \`rodeur_depart\` ; préfixes \`gu_\` (Guerrier : \`gu_ga_\`
   Gardien, \`gu_be_\` Berserker, \`gu_md_\` Maître d'armes), \`gm_\`, \`ma_\`, \`mr_\`, \`ro_\` (\`ro_ti_\`, \`ro_tq_\`,
   \`ro_ve_\`), \`rg_\`, \`sv_\`, \`fond_\`, \`ks_\`. La *Riposte* de Survie devient **Contre parfait**
   (\`riposte_parfaite\`) et l'*Estocade* du Chasseur **Coup d'épieu** (\`coup_epieu\`), pour ne pas avoir deux
   compétences du même nom.
3. **Cadence** (\`gu_md_cadence\`) devient un passif qui porte le 2ᵉ groupe de variantes de la Frappe.
4. **Effets** : un seul vocabulaire, fractions partout (les brouillons Survie et Mage étaient en points de pourcentage).
5. **Attaque chargée** : les chiffres du brouillon Survie font foi pour toutes les classes (×1,8 max) ; l'arc garde
   sa charge en 1 s et sa perforation.
6. **Garde** : un bouclier bloque sa valeur de blocage d'\`items.json\` (61 à 90 %), pas 100 %.
7. **Inaptitude** : réductions additionnées, plafond 0,6 ; *Serment de la lame spirituelle* ramené à un tiers.
8. **Départ d'une autre classe** : 2 points, donne son attaque de base avec Inaptitude. Un non-mage qui prend
   \`mage_depart\` peut prendre les variantes de forme du Trait arcanique (2 points chacune).
9. **Migration** : points plancher (\`legacyFloor\`) pour que les personnages v0.2 de bas niveau retrouvent leurs 4
   compétences.
10. **Mise en page** : ${'16'} variantes du brouillon Rôdeur légèrement déplacées et un lien retiré
    (\`ro_tq_acrobate\`–\`ro_tq_coup_de_dague\`) pour qu'aucun lien ne passe sur un nœud.

## 15 bis. Relecture critique (joueur débutant, vétéran soulslike, exploiteur)

Changements appliqués après la synthèse (\`skilltree.json › meta.criticChanges\`, code : fin de \`build_tree.mjs\`) :

| Cible | Changement | Pourquoi |
|---|---|---|
${tree.meta.criticChanges.map((c) => `| \`${esc(c.target)}\` | ${esc(c.what)} | ${esc(c.why)} |`).join('\n')}

Vérifié sans changement : aucune invulnérabilité permanente (roulade ≤ 450 ms et ≤ 75 % de sa recharge, Danseur
1,8 s), tir en mouvement toujours ≤ 40 % de la vitesse, immobilisations suivies de 8 s d'immunité et jamais sur un
boss, vol de vie ≤ 9 %, réduction de recharge ≤ 30 %, Garde à 100 % seulement avec bouclier + Mur vivant (85 % contre
un boss) et toujours payée en endurance.

## 16. Questions ouvertes

1. **Vacillement du joueur**, marqueurs \`lo\` / \`nb\` / \`mag\`, Mur de glace qui bloque les monstres, pièges, filets
   et appâts comme entités serveur, interruption des incantations par un coup télégraphié : nouvelles mécaniques à
   valider par l'équipe combat (des replis sont décrits dans les brouillons).
2. **Formule de défense** \`K = 60 + 6 × max(0, niveau − 10)\` et **recharge commune des potions (20 s)** : à confirmer
   par la simulation de combat.
3. **Touches par défaut** du Saut (C) et de la Garde (E maintenue) : le clic droit sert déjà à cibler et attaquer.
4. **Rendements décroissants des immobilisations en JcJ** (2 en 6 s → insensible 6 s) : règle commune à confirmer.
5. Coût de réinitialisation (25 × niveau) à caler sur le revenu en or de la v0.3 ; courbe d'XP au-delà du niveau 20.
6. Refaire l'équilibrage avec \`tests/balance/sim.mjs\` étendu aux profils de §12 (le modèle rapide ne simule ni les
   déplacements ni les boss).

## Annexe — brouillons

Les brouillons d'origine restent dans \`docs/design/drafts/\` : \`tree_rules.md\`, \`tree_survie.*\`, \`tree_warrior.*\`,
\`tree_mage.*\`, \`tree_ranger.*\` (et \`items.*\`, \`crafting.*\` pour les objets). Ils contiennent les justifications
détaillées de chaque branche ; ce document et \`skilltree.json\` font foi en cas d'écart.
`;

fs.writeFileSync(path.join(DESIGN, 'ARBRE_COMPETENCES.md'), arbre);

// ======================================================================================== OBJETS_ARTISANAT.md
const bases = items.bases;
const fam = items.families;
const swordFams = Object.entries(fam).filter(([, f]) => f.group === 'épée').map(([k]) => k);
const TIERS = items.dropTables.tiers;
const mats = crafting.materials;
const matName = (id) => mats.find((m) => m.id === id)?.name || items.consumables[id]?.name || bases[id]?.name || id;
const itemName = (id) => bases[id]?.name || items.uniques[id]?.name || items.consumables[id]?.name || matName(id);
const affixName = (id) => items.affixes[id]?.name || id;

function familyTable() {
  const rows = ['| Famille | Mains | Attaque | Vitesse | Critique | Déséquilibre | Endurance | Étiquettes | Particularité | Bases |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const [id, f] of Object.entries(fam)) {
    const n = Object.values(bases).filter((b) => b.family === id).length;
    rows.push(`| **${f.name}** \`${id}\` | ${f.hands ?? '—'} | ${f.atk ? '×' + fr(f.atk) : '—'} | ${f.cd ? '×' + fr(f.cd) : '—'} | ${f.crit ? pct(f.crit) : '—'} | ${f.poise ? '×' + fr(f.poise) : '—'} | ${f.st ? '×' + fr(f.st) : '—'} | ${(f.tags || []).join(', ')} | ${esc(f.special || f.feel || '')} | ${n} |`);
  }
  return rows.join('\n');
}
function swordTable() {
  const rows = ['| Palier | Épée | id | Famille | Niv. | Attaque | Origine | Icône / modèle |', '|---|---|---|---|---|---|---|---|'];
  const list = Object.entries(bases).filter(([, b]) => swordFams.includes(b.family)).sort((a, b) => a[1].lvl - b[1].lvl);
  for (const [id, b] of list) rows.push(`| ${b.tier} | **${esc(b.name)}** | \`${id}\` | ${fam[b.family].name} | ${b.lvl} | ${b.atk} | ${b.crafted ? (b.legacy ? 'v0.1 · artisanat' : 'artisanat') : b.legacy ? 'v0.1 · butin' : 'butin'} | \`${b.icon}\` · \`${b.model}\` |`);
  return rows.join('\n');
}
function uniqueTable() {
  const rows = ['| Légendaire | id | Famille | Niv. | Boss | Chance | Effet |', '|---|---|---|---|---|---|---|'];
  for (const [id, u] of Object.entries(items.uniques)) rows.push(`| **${esc(u.name)}** | \`${id}\` | ${fam[u.family]?.name || u.family} | ${u.lvl} | ${u.boss} | ${Math.round(u.chance * 100)} % (+3 %/échec) | ${esc(u.effect)} |`);
  return rows.join('\n');
}
function otherWeaponsTable() {
  const rows = ['| Famille | Bases (palier : nom `id` niveau) |', '|---|---|'];
  for (const [fid, f] of Object.entries(fam)) {
    if (swordFams.includes(fid)) continue;
    const list = Object.entries(bases).filter(([, b]) => b.family === fid).sort((a, b) => a[1].lvl - b[1].lvl);
    rows.push(`| ${f.name} | ${list.map(([id, b]) => `${b.tier} : ${esc(b.name)} \`${id}\` ${b.lvl}${b.crafted ? '*' : ''}`).join(' · ')} |`);
  }
  return rows.join('\n') + '\n\n\\* = fabriqué (existe aussi en butin sans bonus d\'ensemble).';
}
function linesTable() {
  const rows = ['| Série | Type | Palier | Niv. | Origine | Pièces | Bonus 2 / 4 pièces |', '|---|---|---|---|---|---|---|'];
  const csets = Object.fromEntries(crafting.sets.map((s) => [s.id, s]));
  for (const [id, l] of Object.entries(items.lines).sort((a, b) => a[1].lvl - b[1].lvl)) {
    const cs = csets[id];
    const loot = l.set ? items.sets[l.set] : null;
    const bonus = cs ? `${esc(cs.bonus2)} / ${esc(cs.bonus4)}` : loot ? `${esc(loot.bonus['2'])} / ${esc(loot.bonus['4'])}` : '—';
    rows.push(`| \`${id}\` ${esc(l.name)} | ${l.type} | ${l.tier} | ${l.lvl} | ${esc(l.source)} | ${Object.values(l.pieces).map((p) => `\`${p}\``).join(' ')} | ${bonus} |`);
  }
  return rows.join('\n');
}
function lootSetsTable() {
  const rows = ['| Ensemble | id | Palier | Source | Bonus 2 pièces | Bonus 4 pièces |', '|---|---|---|---|---|---|'];
  for (const [id, s] of Object.entries(items.sets)) rows.push(`| **${esc(s.name)}** | \`${id}\` | ${s.tier} | ${esc(items.lines[s.line]?.source || '')} | ${esc(s.bonus['2'])} | ${esc(s.bonus['4'])} |`);
  return rows.join('\n');
}
function affixTable() {
  const rows = ['| Affixe | id | Effet | Niv. 1 | Niv. 30 | Emplacements |', '|---|---|---|---|---|---|'];
  for (const [id, a] of Object.entries(items.affixes)) rows.push(`| ${a.name} | \`${id}\` | ${esc(a.fmt)} | ${a.range['1'].join('–')} | ${a.range['30'].join('–')} | ${(a.slots || []).join(', ')} |`);
  return rows.join('\n');
}
function monstersTable() {
  const rows = ['| Monstre | Palier | Niveaux | Matériaux [chance, quantité] | Pierres | Ensembles / légendaires |', '|---|---|---|---|---|---|'];
  for (const [id, d] of Object.entries(items.dropTables.monsters)) {
    rows.push(`| \`${id}\`${d.boss ? ' (boss)' : ''} | ${d.tier} | ${d.lvl.join('–')} | ${(d.materials || []).map(([m, c, q]) => `${matName(m)} ${Math.round(c * 100)} %${q ? ` ×${[...new Set([].concat(q))].join('–')}` : ''}`).join(' · ')} | ${(d.stones || []).map(([s, c]) => `${matName(s)} ${Math.round(c * 100)} %`).join(' · ') || '—'} | ${[...(d.setPieces || []).map(([s, c]) => `${items.sets[s].name} ${Math.round(c * 100)} %`), ...(d.uniques || []).map(([u, c]) => `${items.uniques[u].name} ${Math.round(c * 100)} %`)].join(' · ') || '—'} |`);
  }
  return rows.join('\n');
}
function materialsTable() {
  const rows = ['| Matériau | id | Origine | Palier | Sources | Utilisé dans (recettes) |', '|---|---|---|---|---|---|'];
  for (const m of mats) {
    const used = crafting.recipes.filter((r) => r.inputs.some(([i]) => i === m.id)).length;
    const src = (m.sources || []).map((s) => (s.monster ? `${s.monster} ${Math.round(s.ch * 100)} %` : s.redZoneElite ? `élites de zone rouge ${Math.round(s.ch * 100)} %` : s.node || s.from || '')).filter(Boolean).join(' · ');
    rows.push(`| ${esc(m.name)} | \`${m.id}\` | ${m.kind} | T${m.tier} | ${src || '—'} | ${used} |`);
  }
  return rows.join('\n');
}
function recipesTable(prof) {
  const rows = ['| Niv. | Recette | Ingrédients | Produit | Revente (po) | Apprise |', '|---|---|---|---|---|---|'];
  for (const r of crafting.recipes.filter((x) => x.prof === prof).sort((a, b) => a.lvl - b.lvl)) {
    const learn = r.learn?.from === 'start' ? 'départ' : r.learn?.from === 'trainer' ? `maître ${r.learn.price ?? ''} po` : r.learn?.plan ? `plan \`${r.learn.plan}\`` : r.learn?.from || '—';
    rows.push(`| ${r.lvl} | ${esc(r.name)} | ${r.inputs.map(([i, q]) => `${q} ${matName(i)}`).join(', ')} | \`${r.output.item}\`${r.output.qty > 1 ? ` ×${r.output.qty}` : ''} | ${r.vendorValue ?? '—'} | ${learn} |`);
  }
  return rows.join('\n');
}
function consumablesTable() {
  const rows = ['| Objet | id | Type | Effet | Icône |', '|---|---|---|---|---|'];
  for (const [id, c] of Object.entries(items.consumables)) rows.push(`| ${esc(c.name)} | \`${id}\` | ${c.type} | ${esc(c.effect || c.use || (c.bagSlots ? `+${c.bagSlots} cases` : c.levels ? `forge +${c.levels.join(' à +')}` : ''))} | \`${c.icon}\` |`);
  return rows.join('\n');
}
const wolf = crafting.sets.find((s) => s.id === 'wolf');
const wolfRecipes = wolf.pieces.map((p) => crafting.recipes.find((r) => r.output.item === p));
const slimeRecipes = crafting.recipes.filter((r) => r.prof === 'alchemy' && r.inputs.some(([i]) => i === 'slime_gel' || i === 'slime_core'));
const ist = V.stats.items;

const objets = `# Objets et artisanat — butin v2, épées, forge, métiers (v0.3)

> ⚠️ **Décisions du 23/09 prioritaires** : voir [\`DECISIONS.md\`](DECISIONS.md) (pas de roulade au niveau 1, marché intelligent à prix libres, **pas de réinitialisation : Renaissance au niveau 30**).


> **Document final de conception** (synthèse de \`docs/design/drafts/items.*\` et \`crafting.*\`, gardés en annexe).
> Données : \`docs/design/items.json\` (familles, bases, légendaires, consommables, ensembles, séries, affixes, raretés,
> tables de butin, forge, recyclage) et \`docs/design/crafting.json\` (matériaux, récolte, métiers, recettes, ensembles
> fabriqués, plans, règles). Générés par \`node docs/design/tools/build_items.mjs\`, vérifiés par \`validate.mjs\`.
> Répond aux retours : « on s'équipe vite et il n'y a rien de mieux », « beaucoup plus d'épées », « l'équipement du
> loup avec le butin du loup, le gluant pour les potions », « plus de mécaniques », « simple et accessible ».

## 1. En bref

- **${ist.bases} objets de base** (dont ${ist.weapons} armes et **${ist.swords} épées** de ${ist.swordFamilies} familles), **${ist.uniques} légendaires**
  (dont ${ist.uniqueSwords} épées), **${ist.consumables} consommables**, **${ist.lines} séries d'armure** (${crafting.sets.length} fabriquées avec bonus
  d'ensemble, ${ist.lootSets} ensembles de butin), **${ist.affixes} affixes**, **5 raretés**, **6 paliers** jusqu'au niveau 30.
- **Plus aucune restriction de classe** : seul le niveau requis compte. L'arme donne des **étiquettes** qui débloquent les
  compétences de l'Arbre des Brumes ; l'armure a un **poids** (plaques, cuir, tissu).
- **Artisanat** : ${ist.materials} matériaux (chaque monstre en lâche 1 à 3), 7 points de récolte, 3 métiers (Forge,
  Alchimie, Couture et tannerie) de 1 à 30, **${ist.recipes} recettes**, ${ist.plans} plans d'ensemble, qualité aléatoire (Normale,
  Supérieure, Chef-d'œuvre) avec une **affixe signature** garantie. Les objets fabriqués utilisent **les mêmes formules**
  que le butin ; les légendaires ne se fabriquent jamais.
- **Forge +1 à +10** (jamais de destruction), **Retremper** un affixe, **Recyclage** en matériaux.
- **Tous les ids v0.1 restent valides** (13 équipements, 3 potions, 5 objets « junk » devenus matériaux).

## 2. Principes : simple et accessible

1. La couleur dit tout : blanc < vert < bleu < violet < orange.
2. L'infobulle compare toute seule avec l'objet porté, avec une ligne « DPS de l'attaque de base : 38 → 44 (+16 %) »
   qui rend honnête la comparaison entre une rapière rapide et un espadon lent.
3. Aucune règle cachée : effets d'arme, poids d'armure, bonus d'ensemble, chances de légendaire et compteur de
   malchance sont affichés.
4. Tout l'aléatoire (rareté, base, affixes, qualité, forge) est tiré par le serveur.
5. Rien ne se perd bêtement : la forge ne détruit jamais, un légendaire ne se recycle pas, la fabrication n'échoue jamais.

## 3. Raretés, paliers, formules

| Rareté | Couleur | Affixes | Stat de base | Vente |
|---|---|---|---|---|
${Object.values(items.rarities).map((r) => `| ${r.name} | \`${r.color}\` | ${r.affixes}${r.fixedAffixes ? ' fixes' : ''} | ×${fr(r.baseMult)} | ×${r.sellMult} |`).join('\n')}

| Palier | Nom | Niveaux | Régions | Allure |
|---|---|---|---|---|
${Object.entries(TIERS).map(([t, v]) => `| **${t}** | ${v.name} | ${v.lvl.join('–')} | ${v.regions.join(', ')} | ${v.look} |`).join('\n')}

Formules (\`items.json › meta.formulas\`) :
${Object.entries(items.meta.formulas).map(([k, v]) => `- \`${k}\` : ${v}`).join('\n')}
- Dégâts : ${items.meta.damageFormula}.

## 4. Armes : familles et étiquettes

${familyTable()}

- **Exigences des compétences** (règle commune avec l'arbre) : ${items.meta.softRules.meleeRequirement} ; ${items.meta.softRules.beltKnife} ;
  ${items.meta.softRules.spellsWithoutFocus}
- Une arme à deux mains interdit bouclier et grimoire ; arcs et arbalètes n'acceptent que le carquois.
- La Garde (Fondamental) utilise la valeur de **blocage** du bouclier (61 à 90 %) ; sans bouclier, 50 % avec une arme
  de mêlée, 30 % sinon.

### 4.1 Les épées (${ist.swords} bases + ${ist.uniqueSwords} légendaires)

Répartition : ${Object.entries(ist.swordsByFamily).map(([f, n]) => `${fam[f].name} ${n}`).join(', ')}.

${swordTable()}

### 4.2 Les autres armes et la main gauche

${otherWeaponsTable()}

### 4.3 Légendaires (objets uniques de boss)

${uniqueTable()}

Le **Champion écarlate** (\`scarlet_champion\`, boss de zone rouge, niveau 28–30) est créé pour porter *Soif-de-Sang* :
il reprend le modèle du bandit, agrandi et teinté (voir \`ASSET_REQUESTS.md\`).

## 5. Armures

- Poids, pièce par pièce : ${Object.values(items.meta.softRules.armor).map((a) => `**${a.name}** — ${a.desc}`).join(' ; ')}
- 4 pièces par série (tête, torse, mains, pieds), défense répartie 22 / 40 / 18 / 20 %.

### 5.1 Toutes les séries

${linesTable()}

### 5.2 Ensembles de butin (Épiques, affixes fixes)

${lootSetsTable()}

## 6. Affixes

${affixTable()}

## 7. Butin : qui lâche quoi

- Chance d'équipement : ${items.dropTables.equipment.chance.normal * 100} % par monstre normal, ${items.dropTables.equipment.chance.elite * 100} % par élite, ${items.dropTables.equipment.chance.boss} ;
  zones rouges ×${items.dropTables.equipment.chance.redZoneMult}. Butin intelligent : ${esc(items.dropTables.equipment.smartLoot || '')}
- Poids des raretés :
${Object.entries(items.dropTables.equipment.rarityWeights).map(([k, w]) => `  - ${k} : ${Object.entries(w).map(([r, x]) => `${items.rarities[r].name} ${x}`).join(', ')}`).join('\n')}
- Paliers et niveaux des monstres : ceux de l'artisanat font foi (bandits **T3**, niveaux 11–15 ; trolls **T6**,
  niveaux 25–29). Élites de zone rouge : table en plus (${items.dropTables.redZoneElite.drops.map(([m, c]) => `${matName(m)} ${Math.round(c * 100)} %`).join(', ')}).

${monstersTable()}

## 8. Artisanat

### 8.1 Métiers, récolte, progression

- **3 métiers**, tous accessibles à tous : **Forge** (\`forge\`, Maître Bertram \`npc_blacksmith\`), **Alchimie**
  (\`alchemy_table\`, Ysolde \`npc_alchemist\`), **Couture et tannerie** (\`workbench\`, Maud la tanneuse, nouveau modèle
  \`npc_tanner\`).
- **Récolte sans outil** : maintenir E 2 s ; filon grisé 3 min pour tout votre compte (tous vos personnages), les autres joueurs peuvent encore le récolter ; partagé et double en zone rouge.

| Point de récolte | Modèle | Donne | Palier |
|---|---|---|---|
${crafting.nodes.map((n) => `| ${n.name} | \`${n.model}\` | ${n.qty.join('–')} × ${matName(n.item)} | T${n.tier} |`).join('\n')}

- XP de métier : \`30 + 12 × niveau\` pour passer au suivant (6 090 XP de 1 à 30) ; première fabrication d'une recette ×3.
- **Qualité** : Normale → Inhabituel, Supérieure (18 % de base) → Rare, Chef-d'œuvre (3 %) → Épique ; plafonds 45 % et
  15 % avec le niveau de métier et un éclat de cristal en catalyseur ; une **affixe signature** par recette.
- Fabriqué = butin du même palier (mêmes formules), un Chef-d'œuvre vaut un Épique, **jamais de légendaire**.
- Apprentissage : recettes de départ, maître du métier (10 + niveau² po, ×2 pour un plan), plans d'ensemble (4 pièces
  d'un coup, de plus en plus en butin), plans de boss (20 %, jamais légendaires), pièces manquantes des ensembles de boss
  à la première victoire.
- **Revente** : un objet fabriqué se revend au marchand pour **la valeur de ses matériaux** (colonne « Revente » des
  recettes), quelle que soit sa qualité ; entre joueurs, prix libre. Recyclé, il ne rend que des chutes.
- Puits d'or : frais de station (1 + ⌊niveau² / 12⌋ po), recettes, ingrédients des maîtres, taxe des étals de 5 %.

### 8.2 Les deux exemples des joueurs

**Ensemble du loup** (\`wolf\`, cuir, niveau ${wolf.lvl}, ${esc(wolf.learn?.from === 'trainer' ? `plan chez Maud à ${wolf.learn.price} po` : '')}) — bonus 2 pièces : ${esc(wolf.bonus2.replace(/.$/, ''))} ;
4 pièces : ${esc(wolf.bonus4)}

| Pièce | id | Ingrédients |
|---|---|---|
${wolfRecipes.map((r) => `| ${esc(r.name)} | \`${r.output.item}\` | ${r.inputs.map(([i, q]) => `${q} ${matName(i)}`).join(', ')} |`).join('\n')}

**Potions de gluant** (Alchimie) :

| Niv. | Recette | Ingrédients | Produit |
|---|---|---|---|
${slimeRecipes.map((r) => `| ${r.lvl} | ${esc(r.name)} | ${r.inputs.map(([i, q]) => `${q} ${matName(i)}`).join(', ')} | \`${r.output.item}\` : ${esc(items.consumables[r.output.item]?.effect || r.output.effect || '')} |`).join('\n')}

${esc(items.meta.potionCooldown)}

### 8.3 Matériaux (${mats.length})

${materialsTable()}

### 8.4 Consommables

${consumablesTable()}

### 8.5 Recettes

#### Forge (${ist.recipesByProf.forge})

${recipesTable('forge')}

#### Alchimie (${ist.recipesByProf.alchemy})

${recipesTable('alchemy')}

#### Couture et tannerie (${ist.recipesByProf.tailoring})

${recipesTable('tailoring')}

## 9. Forge, Retremper, recyclage

- **Amélioration +1 à +10** : ${typeof items.forge.perLevel === 'number' ? pct(items.forge.perLevel) : esc(items.forge.perLevel)} de statistiques de base par niveau ; pierres : ${Object.entries(items.dropTables.stones).map(([id, s]) => `${s.name} (\`${id}\`, +${s.levels.join(' à +')})`).join(', ')}. ${esc(items.forge.failure)}
- **Retremper** : ${esc(items.forge.retemper.desc || items.forge.retemper)} Coût : ${esc(items.forge.retemper.cost?.essence || '')}, ${items.forge.retemper.cost?.goldPerItemLevel ?? ''} po par niveau d'objet ; impossible sur les légendaires et les pièces d'ensemble.
- **Recyclage** : ${esc(items.salvage.rule)} ; les légendaires ne se recyclent pas. ${esc(items.salvage.crafted)} ${esc(items.salvage.setPieces)}

## 10. Décisions de synthèse

1. **Un seul catalogue** : les ${crafting.recipes.length} recettes produisent des ids qui existent tous dans \`items.json\`
   (bases, consommables) ou \`crafting.json\` (matériaux). Les ${Object.values(bases).filter((b) => b.crafted && !b.legacy).length} objets propres à l'artisanat ont maintenant
   une base calculée avec les formules du butin. Cinq doublons de nom ont été fusionnés (\`copper_ring\`,
   \`goblin_scimitar\`, \`redsand_scimitar\`, \`chitin_quiver\`, \`frost_ring\`).
2. **Matériaux définis une seule fois** (\`crafting.json › materials\`) ; les tables de butin ne donnent que
   \`[id, chance, [min, max]]\`. Ajout de la **Marque écarlate** (\`scarlet_mark\`, Champion écarlate et élites de zone
   rouge), échangeable contre une pierre de forge ancestrale.
3. **Paliers des monstres** : ceux de l'artisanat (bandits T3, trolls T6).
4. **Sorts sans focalisateur : −20 %** (règle de l'arbre ; le brouillon objets disait −30 %).
5. **Icônes** : familles Codex CX-12 (\`sword_t3\`, \`helm_plate_t2\`…) pour toutes les bases sauf les ids v0.1 (icônes
   existantes) et les légendaires (\`uq_<id>\`). **Modèles tenus en main** : nommage CX-3 / CX-3b (\`eq_<famille>_<n>\`),
   champ \`model\` sur chaque arme et main gauche.
6. **Potions** : recharge commune de 20 s ; potion suprême 520 → 400 PV (équilibrage).
7. **Trois métiers pour tous** (accessibilité), sacs dans 2 emplacements dédiés (+4 / +8 / +12, 48 cases au plus).

### 10 bis. Relecture critique : économie

| Cible | Changement | Pourquoi |
|---|---|---|
${items.meta.criticChanges.map((c) => `| ${esc(c.target)} | ${esc(c.what)} | ${esc(c.why)} |`).join('\n')}

Vérifié sans changement : la forge ne crée rien (pierres et or consommés, 50 % des pierres rendues au recyclage), les
recettes de pierres coûtent plus que la valeur de revente de la pierre, aucune recette ne se fait avec les seuls
matériaux vendus par les marchands, les légendaires ne se recyclent pas, filons partagés en zone rouge (premier arrivé).

## 11. Questions ouvertes

1. Formule de défense \`K = 60 + 6 × max(0, niveau − 10)\` (sinon les plaques T6 réduisent ~70 % des dégâts) : à simuler.
2. Nombre d'objets : ${ist.bases} bases, c'est beaucoup pour l'interface ; on peut masquer les familles non-épées de T1
   dans les boutiques. À juger en test.
3. Prix des plans et chances de plans en butin à caler sur le revenu d'or réel de la v0.3.
4. Ensembles de donjon (Géant de givre, Roi-Liche) : seulement boss + artisanat tant que les donjons (v0.4) n'existent pas.
5. Le squelette (niveaux 8–11) est à cheval sur T2 et T3 (seul avertissement de \`validate.mjs\`).

## Annexe — brouillons

\`docs/design/drafts/items.md\`, \`items.json\`, \`crafting.md\`, \`crafting.json\` : justifications et tableaux d'origine.
`;
fs.writeFileSync(path.join(DESIGN, 'OBJETS_ARTISANAT.md'), objets);

// ======================================================================================== ASSET_REQUESTS.md
const EXISTING_ICONS = new Set(fs.readdirSync(path.resolve(DESIGN, '../../client/public/icons')).map((f) => f.replace(/\.png$/, '')));
const CX2_V03 = ['ore_copper', 'ore_iron', 'ore_mithril', 'crystal_shard', 'herb_brume', 'herb_givre', 'herb_braise', 'ingot_copper', 'ingot_iron', 'ingot_mithril', 'leather_strip', 'cloth_bolt', 'potion_hp_m', 'potion_stamina', 'helm_iron', 'gloves_leather', 'boots_leather', 'ring_silver', 'amulet_bone'];
const covered = (icon) => EXISTING_ICONS.has(icon) || CX2_V03.includes(icon);
const CX12 = new Set();
for (let t = 1; t <= 6; t++) {
  for (const k of ['sword', 'greatsword', 'staff', 'bow', 'shield', 'tome', 'quiver', 'ring', 'amulet']) CX12.add(`${k}_t${t}`);
  for (const p of ['helm', 'chest', 'gloves', 'boots']) for (const a of ['plate', 'leather', 'cloth']) CX12.add(`${p}_${a}_t${t}`);
}
for (const k of ['forge_stone_1', 'forge_stone_2', 'forge_stone_3', 'loot_bag', 'bank_chest', 'market_stall', 'trade']) CX12.add(k);
const gearIcons = new Set();
for (const b of Object.values(bases)) gearIcons.add(b.icon);
const newGearIcons = [...gearIcons].filter((i) => !CX12.has(i) && !covered(i)).sort();
const newFamilyIcons = newGearIcons.filter((i) => /_t\d$/.test(i));
const swordFamilyIcons = newFamilyIcons.filter((i) => /^(shortsword|bastard|rapier|scimitar|curved|runesword)_t/.test(i));
const otherFamilyIcons = newFamilyIcons.filter((i) => !swordFamilyIcons.includes(i));
const uniqueIcons = Object.values(items.uniques).map((u) => u.icon);
const matIcons = mats.map((m) => m.icon).filter((i) => !covered(i));
const consIcons = Object.values(items.consumables).map((c) => c.icon).filter((i) => !covered(i) && !CX12.has(i));
const abIcons = tree.abilities.map((a) => a.icon);
const abNew = abIcons.filter((i) => !EXISTING_ICONS.has(i));
const ksIcons = tree.keystones.map((k) => k.icon);
const EXISTING_MODELS = new Set();
for (let i = 1; i <= 5; i++) EXISTING_MODELS.add(`eq_sword_${i}`);
for (let i = 1; i <= 4; i++) ['greatsword', 'staff', 'bow'].forEach((k) => EXISTING_MODELS.add(`eq_${k}_${i}`));
for (let i = 1; i <= 3; i++) EXISTING_MODELS.add(`eq_shield_${i}`);
for (const k of ['shortsword', 'bastard', 'rapier', 'scimitar', 'curved', 'runesword', 'axe', 'mace', 'spear', 'dagger', 'sceptre', 'tome', 'crossbow', 'quiver']) for (let i = 1; i <= 2; i++) EXISTING_MODELS.add(`eq_${k}_${i}`);
const usedModels = new Set(Object.values(bases).filter((b) => b.model).map((b) => b.model));
const newModels = [...usedModels].filter((m) => !EXISTING_MODELS.has(m)).sort();
const uniqueModels = Object.values(items.uniques).map((u) => u.model);

// VFX families from the variants' visual intents
const VFX_FAMILIES = [
  ['vfx_fire', /flamm|feu|braise|brûl|incandesc|cendre|embras|météore|lave|ardent/i],
  ['vfx_frost', /givre|glace|gel|neige|froid|blizzard|cristal/i],
  ['vfx_arcane', /arcan|rune|astre|étoile|violet|pierre-astre|glyphe|mana/i],
  ['vfx_nature', /ronce|vert|follet|sève|feuill|mousse|nature/i],
  ['vfx_blood', /sang|saign|rouge sombre|plaie/i],
  ['vfx_poison', /poison|venin|toxique|vert acide|nuage/i],
  ['vfx_steel', /acier|lame|tranch|étincel|métal|traînée/i],
  ['vfx_impact', /poussière|onde|impact|choc|sol|cratère|fissure/i],
  ['vfx_motion', /flou|silhouette|trace|fantôme|ombre|brume|sillage/i],
  ['vfx_shield', /bouclier|dôme|égide|barrière|hexagon/i],
  ['vfx_heal', /soin|dor[ée]|lumière|halo/i],
];
const vfxOf = (txt) => VFX_FAMILIES.filter(([, re]) => re.test(txt)).map(([k]) => k);
const variantVfx = tree.nodes.filter((n) => n.type === 'variant' && n.vfx);
const famUse = Object.fromEntries(VFX_FAMILIES.map(([k]) => [k, 0]));
for (const n of variantVfx) for (const k of vfxOf(n.vfx)) famUse[k]++;
const list = (arr) => arr.map((x) => `\`${x}\``).join(', ');

const assets = `# Demandes d'éléments visuels — v0.3 (arbre, objets, artisanat)

> Liste **exacte** de ce que les artistes (agents assets, Codex) doivent produire pour la v0.3, générée depuis
> \`skilltree.json\`, \`items.json\` et \`crafting.json\` par \`node docs/design/tools/gen_docs.mjs\` : chaque clé ci-dessous
> est référencée par les données. Conventions : icônes 256 × 256 PNG dans \`client/public/icons/\` (style CX-2 : objet
> détaillé sur fond transparent ; compétences sur fond sombre texturé ; lisibles à 40 px), modèles tenus en main
> \`client/public/models/eq_*.glb\` (conventions CX-3 : origine au point de prise, lame le long de +Z), effets en planches
> WebP + \`client/public/vfx/manifest.json\`. Déjà livrés et donc **non redemandés** : les 12 icônes \`ab_*\` de la v0.2,
> les icônes d'objets v0.1 et la liste v0.3 de CX-2, les modèles CX-3 et CX-3b, la liste CX-12.

## Priorité 0 — indispensable pour ouvrir l'arbre et le butin v2

### P0.1 Icônes de compétences : ${abNew.length} nouvelles (\`ab_<id>\`)

${list(abNew)}

(${abIcons.length} capacités au total ; ${abIcons.length - abNew.length} icônes existent déjà.) Une icône par capacité ; les variantes
réutilisent l'icône de leur capacité avec un liseré turquoise ajouté par l'interface.

### P0.2 Interface de l'arbre (kit CX-9)

\`tree_node_skill\` (cercle doré 26 px), \`tree_node_variant\` (losange turquoise), \`tree_node_passive\` (petit cercle
14 px), \`tree_node_keystone\` (octogone pourpre 34 px), \`tree_node_fondamental\` (anneau blanc-or), \`tree_core\` (Cœur
des Brumes), états acquis / disponible (halo pulsé) / verrouillé, \`tree_link\` (3 largeurs), \`tree_cost_badge\` (pastille
orange 2 / 3), \`tree_inapt\` (icône « Inapte »), fonds de région \`tree_bg_survie\`, \`tree_bg_guerrier\`,
\`tree_bg_mage\`, \`tree_bg_rodeur\`, \`tree_bg_pont\` (dégradé), \`skillbook_frame\` (livre de compétences), et les
icônes d'action des Fondamentaux sans capacité propre si besoin (\`ab_saut\`, \`ab_garde\` sont déjà listées en P0.1).

### P0.3 Icônes d'équipement hors CX-12 : épées (${swordFamilyIcons.length})

Chaque famille d'épée doit se reconnaître à 40 px (silhouettes CX-3b) :

${list(swordFamilyIcons)}

### P0.4 Matériaux (${matIcons.length} icônes \`<id>\`)

${list(matIcons)}

### P0.5 Consommables, pierres, sacs, plans (${consIcons.length + 1})

${list(consIcons)}, plus \`plan\` (icône générique « Plan / Patron »).

## Priorité 1 — la v0.3 complète

### P1.1 Icônes d'équipement hors CX-12 : autres familles (${otherFamilyIcons.length})

${list(otherFamilyIcons)}

### P1.2 Légendaires : ${uniqueIcons.length} icônes et ${uniqueModels.length} modèles uniques

Icônes : ${list(uniqueIcons)}.
Modèles : ${list(uniqueModels)} (6 épées d'abord : Fendroc, Épine de la Sorcière, Croc du Ver des sables,
Brise-Montagne, Lame runique d'Aldmar, Soif-de-Sang).

### P1.3 Modèles d'armes supplémentaires (${newModels.length})

Un 3ᵉ aspect pour chaque famille d'épée (paliers T5–T6), une 6ᵉ épée longue et un 5ᵉ espadon (T6) : ${list(newModels)}.
Correspondance palier → modèle : champ \`model\` de chaque base dans \`items.json\` (${usedModels.size} clés utilisées, toutes les autres
existent déjà en CX-3 / CX-3b).

### P1.4 Icônes de clés de voûte (${ksIcons.length})

${list(ksIcons)}

### P1.5 Effets visuels des variantes et des statuts

Les ${variantVfx.length} variantes ont chacune une intention visuelle (texte \`vfx\` dans \`skilltree.json\`, reprise dans
\`ARBRE_COMPETENCES.md\`). Familles d'effets à produire (nombre de variantes qui les utilisent) :

| Famille | Variantes (estimation par mots-clés) | Contenu |
|---|---|---|
| \`vfx_fire\` | ${famUse.vfx_fire} | braises, traînée de feu, explosion, mur de flammes, jet en cône, cendres, météore + cratère |
| \`vfx_frost\` | ${famUse.vfx_frost} | éclats, anneau au sol, bloc de gel, lance, mur de glace à pics, aurore, blizzard |
| \`vfx_arcane\` | ${famUse.vfx_arcane} | sphère neutre, pierre-astre bleu-violet, poussière d'étoiles, faille, rayon, comète, runes |
| \`vfx_nature\` | ${famUse.vfx_nature} | ronces givrées, feu follet, flèche runique verte |
| \`vfx_blood\` | ${famUse.vfx_blood} | gouttes, traînée rouge sombre, éclatement de la jauge d'hémorragie |
| \`vfx_poison\` | ${famUse.vfx_poison} | nuage toxique, gouttes vert acide, fléau |
| \`vfx_steel\` | ${famUse.vfx_steel} | traînées d'acier (demi-lune, estoc, tourbillon), étincelles de parade |
| \`vfx_impact\` | ${famUse.vfx_impact} | poussière, onde de choc, fissures, bond fracassant |
| \`vfx_motion\` | ${famUse.vfx_motion} | pas de l'ombre (clignement), silhouettes de brume, sillage de sprint |
| \`vfx_shield\` | ${famUse.vfx_shield} | égide arcanique, égide runique, bastion |
| \`vfx_heal\` | ${famUse.vfx_heal} | glyphe de soin doré, cri de ralliement |

Indicateurs de statut au-dessus des monstres et des joueurs, lisibles de loin : \`status_brulure\`, \`status_froid_1\`,
\`status_froid_2\`, \`status_froid_3\`, \`status_gel\`, \`status_saignement\` (+ jauge d'hémorragie sous la barre de vie),
\`status_poison_1\` à \`status_poison_6\`, \`status_marque\`, \`status_aveugle\`, \`status_enracine\`, \`status_vacille\`,
\`status_super_armure\` (éclat de pleine charge). Télégraphes au sol : \`tele_lo\` (ondes concentriques), \`tele_nb\`
(bordure crénelée), \`tele_mag\` (violet runique). Fondamentaux : \`fx_jump_land\`, \`fx_guard_block\`, \`fx_parry\`,
\`fx_perfect_dodge\`, \`fx_charge\` / \`fx_charged\`, \`fx_guard_break\`.

### P1.6 Entités et personnages nouveaux

| Clé | Groupe | Description |
|---|---|---|
| \`npc_master\` | characters | Maître des arts (réinitialisation de l'arbre), village de Brumeval |
| \`npc_tanner\` | characters | Maud la tanneuse (Couture et tannerie) — à défaut, \`npc_merchant\` recoloré |
| \`scarlet_champion\` | humanoids | Champion écarlate, boss de zone rouge : modèle du bandit agrandi (×1,3), armure pourpre et noire, \`Attack2\` + \`Special\` |
| \`trap_jaws\`, \`trap_net\`, \`bait_lure\` | props | piège à mâchoires, filet au sol, appât (entités serveur du Traqueur et du Chasseur) |
| \`ice_wall\`, \`fire_wall\` | vfx / props | Mur de glace (obstacle temporaire à pics) et Mur de feu du Mage |
| \`wisp\` | vfx | feu follet flottant (bleu-vert, variante braise orange) |
| \`meteor_crater\` | vfx | cratère fumant du Météore |

## Priorité 2 — finitions

- Icônes de passifs génériques par famille de statistique pour l'infobulle (${Object.keys(tree.effectVocabulary.stats).length} statistiques
  regroupables en ~12 : PV, endurance, mana, critique, dégâts par élément, résistances, garde, roulade, potions, écho).
- Animations de personnages : \`Jump\` (0,35 s en l'air + réception), \`Guard\` (boucle), \`Parry\`, \`Charge\` (boucle) et
  \`ChargedRelease\`, \`JumpAttack\`, \`Stagger\` (vacillement 0,4 s) pour \`warrior\`, \`mage\`, \`ranger\` ; repli
  procédural si un clip manque.
- Aperçu 3D des objets dans l'infobulle (rendu des modèles \`eq_*\`).
`;
fs.writeFileSync(path.join(DESIGN, 'ASSET_REQUESTS.md'), assets);

console.log('ARBRE_COMPETENCES.md, OBJETS_ARTISANAT.md, ASSET_REQUESTS.md écrits.');
console.log(`validate : ${V.ok ? 'OK' : 'ÉCHEC'} · balance : ${B.summary.ok ? 'OK' : 'HORS CIBLE'}`);
console.log(`icônes : ${abNew.length} ab_, ${swordFamilyIcons.length}+${otherFamilyIcons.length} familles, ${matIcons.length} matériaux, ${consIcons.length} consommables, ${uniqueIcons.length} uniques, ${ksIcons.length} clés · modèles : ${newModels.length} + ${uniqueModels.length}`);
