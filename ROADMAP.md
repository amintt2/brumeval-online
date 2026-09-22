# Feuille de route — Brumeval Online

> **Vision** : un MMO *soulslike* dans le navigateur et sur ordinateur. Des combats exigeants et lisibles (attaques
> télégraphiées, esquive, endurance), des boss mémorables, une IA imprévisible, un monde vaste au style inspiré de
> *Zelda : Breath of the Wild* (couleurs douces, herbe qui ondule au vent), et tout ce qu'on attend d'un MMO :
> groupes, guildes, PvP, artisanat, donjons.
>
> Jeu en ligne : **https://brumel.mciut.fr/** — chaque version validée (tests + partie à deux) est poussée sur `main`.

## 1. Retours des joueurs, triés par importance

| Prio | Retour | Pourquoi cet ordre | Version |
|---|---|---|---|
| **P0** | **Anti-triche côté serveur** + sécurité (force brute, spam, speed hack, téléportation, bannissements, outils MJ) | Le jeu est public : un tricheur ou un bot gâche tout pour les autres | v0.2 |
| **P0** | **IA plus variée** (jamais deux fois le même comportement), **mobs qui foncent**, **mobs à distance**, **mage et archer trop forts** → rééquilibrage | Cœur du plaisir de jeu, retour direct des joueurs | v0.2 |
| **P0** | **Combat soulslike** : endurance, roulade d'esquive, attaques ennemies télégraphiées, boss à phases, pénalité de mort récupérable | C'est l'identité du jeu | v0.2 |
| **P0** | **Optimisation** serveur, réseau et rendu | Prérequis d'une carte plus grande et de plus de joueurs | v0.2 |
| **P1** | **Style Zelda** : herbe au vent, arbres qui ondulent, ciel/eau/lumière stylisés, **assets plus détaillés** | L'image du jeu | v0.2 (rendu + modèles) |
| **P1** | **Launcher avec mise à jour automatique**, applications **.exe / .dmg / AppImage** (multi-plateforme) + application web installable (PWA) | Diffusion du jeu | v0.2 |
| **P1** | **Carte plus grande avec plus de contenu** | Durée de vie | v0.3 |
| **P1** | **Groupes** (partage d'XP et de butin), **guildes**, **PvP** | Le « M » de MMO | v0.3 |
| **P1** | **Artisanat** (récolte, métiers, recettes, stations) | Économie et progression | v0.3 |

## 2. Ce qu'on attend d'un MMO : la liste étendue

**P1 — v0.3 « Le monde s'agrandit »**
- Carte de 800 × 800 m : 5 nouvelles régions (Marais de Brumenoire, Pics de Givreval, Désert de Sable-Rouge, Ruines d'Aldmar, Côte de Port-Salin), une 2ᵉ ville, des points d'intérêt, des coffres cachés
- Pierres de téléportation (voyage rapide) + carte du monde (touche M) avec brouillard de guerre
- Météo dynamique : pluie, orage, neige en montagne, tempête de sable, brume matinale
- Bestiaire : sanglier, araignée, scorpion, loup de givre, yéti, rôdeur des marais, chaman gobelin, archer squelette, bandit, spectre, troll ; boss liche, sorcière des marais, géant de givre, ver des sables
- Groupes jusqu'à 5 (invitation, chef, cadres de groupe, XP partagée à proximité, butin chacun son tour ou libre, chat de groupe)
- Guildes (création payante, rangs, chat de guilde, tag sous le nom, liste des membres) · liste d'amis · échange sécurisé entre joueurs
- PvP : duels (/duel), arène près du village, classement PvP ; zones sûres respectées
- Artisanat : minerais (cuivre, fer, mithril, cristal), plantes (herbe de brume, fleur de givre, pétale de braise), métiers Forge / Alchimie / Couture, recettes, qualité des objets fabriqués
- Progression : niveau max 30, emplacements casque, gants, bottes, anneau, amulette, objets à affixes aléatoires, ensembles, arbre de talents, nouvelles compétences par classe

**P2 — v0.4 « Aventures »**
- Donjons instanciés en groupe (Crypte d'Aldmar, Grotte gelée) avec boss et butin dédié
- Boss mondiaux et événements annoncés (invasion gobeline du village, éclipse)
- Montures (achat, invocation, vitesse accrue hors combat)
- Banque, hôtel des ventes, courrier entre joueurs
- Succès, titres affichés sous le nom, classements (niveau, PvP, boss)
- Quêtes journalières, réputation par faction, chaînes de quêtes scénarisées avec dialogues
- Personnalisation du personnage (coiffure, couleurs, visage) · émotes et bulles de chat
- Musique par région et ambiances sonores · paramètres complets (graphismes, touches, volume)
- Contrôles tactiles (mobile/tablette)

**P3 — v0.5 et après**
- Pêche, cuisine (buffs), logement, familiers, événements saisonniers
- Saisons PvP classées, guerres de guilde, sièges
- Traduction anglaise, serveurs multiples

## 3. Organisation du travail

Chaque vague est lancée en parallèle par une équipe d'agents IA. Chaque agent a sa **propre copie git** (worktree) et sa **branche** `waveN/<agent>`. Un agent de fusion rassemble les branches, puis une équipe de revue (sécurité, gameplay, performances) teste et corrige. Si tout passe, la version est publiée sur `main` (déploiement automatique).

### Vague 1 → v0.2 « Fondations & Âme »
| Agent | Mission |
|---|---|
| `anticheat` | Anti-triche et sécurité serveur, outils MJ, bannissements, journaux de sécurité |
| `combat-souls` | Endurance, roulade, sprint, attaques télégraphiées, IA variée et archétypes, boss Golem à phases, équilibrage, échos de mort |
| `netcode-perf` | Optimisation serveur et réseau, compression, sauvegarde par compte, `/health`, Docker, test de charge |
| `render-zelda` | Rendu style Zelda (herbe au vent, arbres qui ondulent, ciel, eau, post-traitement), terrain en tuiles, réglages graphiques |
| `launcher` | Launcher Electron avec mise à jour automatique, builds .exe/.dmg/AppImage via GitHub Actions, PWA |
| `assets-nature` | Végétation et roches détaillées, variantes par biome |
| `assets-town` | Bâtiments détaillés, taverne, forge, alchimie, moulin, pierre de téléportation, porte de donjon… |
| `assets-props` | Ruines, huttes, cabanes, points de récolte (minerais, plantes) |
| `assets-beasts` | Gluant, loup (améliorés), loup de givre, sanglier, araignée, scorpion |
| `assets-giants` | Golem (amélioré), yéti, rôdeur des marais, troll, géant de givre, ver des sables |
| `assets-characters` | Héros et PNJ plus détaillés, animation de roulade, nouveaux PNJ (forgeron, alchimiste, garde, aubergiste) |
| `assets-humanoids` | Chaman gobelin, archer squelette, bandit, spectre, liche, sorcière des marais |

### Vague 2 → v0.3 · Vague 3 → v0.4 : voir la section 2.

---

## 4. Contrats techniques de la vague 1 (référence pour les agents)

*(section en anglais : c'est la spécification que lisent les agents)*

### 4.1 Git & collaboration
- You work in your own git worktree. First command: `git switch -c wave1/<your-key>`. Commit often on that branch
  (`git add -A && git commit -m "..."`); your final state MUST be committed. Never push, never merge, never touch `main`.
- Run `npm install` once at the worktree root (node_modules is not shared between worktrees).
- Other agents change other parts of the same codebase in parallel. Minimise merge conflicts: put new logic in **new
  files**; in shared hot files (`shared/protocol.js`, `shared/data.js`, `server/src/game.js`, `server/src/net.js`,
  `client/src/main.js`, `client/src/state.js`, `client/src/ui/index.js`) make **small, additive edits** grouped under a
  comment like `// [combat-souls]`. Do not reformat or reorder existing code. Do not rename existing exports.
- Keep `npm test` and `npm run build` green on your branch. Update tests you break, add tests for what you add.
- Ports for manual runs are assigned per agent (see your prompt) — never use 3000/5173.

### 4.2 Save compatibility (the game is live — never lose a player's account)
- Accounts saved by v0.1 (`server/data/accounts.json`, fields: name, cls, salt, hash, level, xp, gold, hp, mp, inv, eq,
  quests, x, z, created, lastSeen) must load in v0.2 with sensible defaults for every new field.
- `netcode-perf` owns persistence: it moves to one file per account (`server/data/accounts/<nameKey>.json`), atomic
  writes of dirty accounts only, automatic one-time import of the legacy `accounts.json` (kept as backup
  `accounts.v1.bak.json`), and a `sanitizeAccount`-style migration step where every feature adds defaults.
  Other agents add new persistent fields through that single migration function (additive edit).

### 4.3 Protocol additions (all additive; `shared/protocol.js` stays the reference)
- **Stamina** (`combat-souls`): SelfState gains `st` (stamina) and `mst` (max stamina, default 100). Regen ≈ 35/s after
  0.8 s without spending. Costs: dodge roll 30, sprint 18/s, abilities may cost stamina (defined in `ABILITIES[*].st`).
- **Dodge roll** C2S `dodge` `{ dx, dz }` (unit direction). Server validates stamina + cooldown (~0.6 s), grants
  i-frames for 0.35 s and a movement burst (≈ 5 m over 0.55 s). Broadcast `fx { k: 'roll', src, dx, dz }`.
- **Sprint** C2S `sprint` `{ on: boolean }` → speed × 1.45 while stamina lasts (out of combat only? — designer's call).
- **Movement allowance contract** (shared by `combat-souls` and `anticheat`): the Player entity exposes
  `maxSpeedAt(nowMs)` → metres/second currently allowed (base speed, sprint, roll burst, slows…). The movement validator
  uses `player.maxSpeedAt?.(now) ?? player.stats.speed`. `combat-souls` implements `maxSpeedAt`; `anticheat`
  implements the validator.
- **Telegraphs** S2C `tele` `{ id, src, shape: 'circle'|'cone'|'line'|'ring', x, z, r, r2?, a, arc?, w?, len?, ms }`:
  a ground indicator for an attack that lands after `ms`. The server resolves the hit at impact time against the
  positions of the targets **then** (dodgeable; i-frames negate it). `tele` ids are unique; S2C `tele_end` `{ id }` on
  cancel (attacker died/staggered). Monster projectiles are also dodgeable (hit test at arrival).
- **Death echo** (`combat-souls`): on death a player drops an *écho* holding the XP of the current level (`xp` goes to
  0 for that level); an entity of kind `'echo'` (visible only to its owner) stays at the death spot; walking over it
  restores the XP; dying again before recovering destroys the old echo. Persisted with the account.
- **Snapshot deltas** (`netcode-perf`): dynamic EntState fields (`x z ry hp mhp s tg sl` and new ones) may be
  **omitted when unchanged** since the last snap sent to this client; the client keeps the previous value. The client
  store must merge field by field. WebSocket permessage-deflate enabled.
- **Security** (`anticheat`): `game.security.flag(player, code, weight, detail)` records a suspicion (other agents may
  call it through optional chaining `game.security?.flag?.(...)`). S2C `kick` `{ msg }` reused for bans.

### 4.4 Rendering conventions (`render-zelda` ↔ asset agents)
- Materials whose name starts with `Leaf`, `Foliage`, `Grass`, `Cloth` or `Banner` sway in the wind in the client
  (amplitude ∝ height above the model origin). Trunks, stone and metal never sway. Keep foliage in its own material.
- Zelda-like look: clean silhouettes, soft saturated palette, larger readable shapes, vertex colours allowed (the
  characters kit uses them), low roughness only for wet/metal surfaces. The client adds toon shading + rim light.
- Budgets (triangles): instanced vegetation ≤ 1500 (grass tufts are generated by the client, not by Blender); rocks ≤
  800; buildings ≤ 8000; heroes ≤ 6000; monsters ≤ 5000; bosses ≤ 12000. GLB ≤ 1.5 MB each.

### 4.5 Asset keys produced in wave 1 (wired into the game in wave 2 unless noted)
Clips: heroes `Idle Walk Attack Cast Hit Death` + **`Roll`** (0.55 s forward roll, ends standing) — used in v0.2.
Every monster: `Idle Walk Attack Hit Death` + **`Attack2`** (telegraphed heavy attack: 0.5–0.9 s visible wind-up then
strike, 1.2–1.6 s total) + **`Run`** (fast chase/charge loop). Ranged/casters add **`Shoot`** (≈ 0.8 s). Bosses add
**`Special`** (1.5–2.5 s: roar, phase change, big area attack). NPCs `Idle Walk`.

| Group (agent) | Keys |
|---|---|
| `nature` (assets-nature) | upgrade: tree_pine, tree_oak, tree_dead, rock_a, rock_b, bush, flowers · new: tree_birch, tree_willow, tree_pine_snow, tree_palm, cactus, rock_snow, rock_desert, cliff_a, cliff_b, reeds, mushrooms, log_fallen, stump |
| `structures` (assets-town) | upgrade: house, well, fence, lamp_post, crate, barrel, stall · new: house_b, tavern, forge, alchemy_table, workbench, windmill, watchtower, bridge, waypoint, dungeon_gate, chest, banner |
| `props` (assets-props) | upgrade: tent, gravestone, campfire · new: ruins_pillar, ruins_arch, ruins_wall, obelisk, swamp_hut, snow_cabin, desert_ruin, node_copper, node_iron, node_mithril, node_crystal, node_herb_brume, node_herb_givre, node_herb_braise |
| `creatures` (assets-beasts) | upgrade + new clips: slime, wolf · new: ice_wolf, boar, spider, scorpion |
| `giants` (assets-giants) | upgrade + new clips: golem · new: yeti, bog_lurker, troll, frost_giant (boss), sand_wyrm (boss) |
| `characters` (assets-characters) | upgrade + `Roll`: warrior, mage, ranger · upgrade: npc_elder, npc_merchant · + `Attack2`/`Run`: goblin, skeleton · new NPCs: npc_blacksmith, npc_alchemist, npc_guard, npc_innkeeper |
| `humanoids` (assets-humanoids) | new: goblin_shaman, skeleton_archer, bandit, wraith, lich (boss), swamp_hag (boss) |

Existing keys keep their file names so the current game picks up the upgraded models automatically; the client must
still tolerate a missing clip (e.g. `Roll`) with a procedural fallback.
