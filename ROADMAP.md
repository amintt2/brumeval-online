# Feuille de route — Brumeval Online

> **Vision** : un MMO *soulslike* dans le navigateur et sur ordinateur. Des combats exigeants et lisibles (attaques
> télégraphiées, esquive, endurance), des boss mémorables, une IA imprévisible, un monde vaste en *dark fantasy*
> inspiré d'*Elden Ring* (matériaux détaillés, lumière dramatique, brume dorée) avec une végétation animée par le vent, et tout ce qu'on attend d'un MMO :
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
| **P1** | **Style dark fantasy à la Elden Ring** : modèles Blender bien plus détaillés (textures PBR, Geometry Nodes), lumière dramatique ; herbe et arbres au vent ; effets visuels rendus dans Blender ; contrôle visuel de chaque modèle (plus de robe qui traverse le corps) | L'image du jeu | v0.2 (rendu + modèles) |
| **P1** | **Launcher avec mise à jour automatique**, applications **.exe / .dmg / AppImage** (multi-plateforme) + application web installable (PWA) | Diffusion du jeu | v0.2 |
| **P1** | **Carte plus grande avec plus de contenu** | Durée de vie | v0.3 |
| **P1** | **Groupes** (partage d'XP et de butin), **guildes**, **PvP** | Le « M » de MMO | v0.3 |
| **P1** | **Artisanat** (récolte, métiers, recettes, stations) | Économie et progression | v0.3 |
| **P0 v0.3** | **Très grand arbre de compétences** : à chaque niveau, *on choisit* où mettre ses points (fini les améliorations automatiques) ; on commence avec **une seule compétence** (l'attaque de base) ; des **variantes** qui transforment toutes les compétences, même l'attaque de base ; **raccourcis librement assignables** | « Super important » pour les joueurs : c'est ce qui rend chaque personnage unique | v0.3 |
| **P0 v0.3** | **Artisanat à partir du butin des monstres** : fourrures de loup + autres matériaux → armures du loup ; gelée de gluant → potions, etc. ; **beaucoup plus d'épées** | Plus de mécaniques, chaque monstre a un intérêt | v0.3 |
| **P0 v0.3** | **Bien plus de variété d'équipement** : « on s'équipe vite et il n'y a rien de mieux ». Paliers d'objets par zone jusqu'au niveau 30, 5 raretés, affixes aléatoires, objets uniques de boss, ensembles, amélioration à la forge (+1 à +10) | Sans objectif d'équipement, on arrête de jouer | v0.3 |
| **P0 v0.3** | **Échanger son butin simplement** : échange direct entre joueurs, **étals du marché** pour vendre son butin (même hors ligne), banque | Économie entre joueurs, simple et accessible | v0.3 |
| **P0 v0.3** | **Zones rouges** : JcJ libre ; à la mort (joueur ou monstre), on lâche son butin dans un sac que tout le monde peut ramasser ; en échange, bien plus d'XP et de butin | Tension, risque contre récompense | v0.3 |

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
- Progression : niveau max 30, arbre de talents, nouvelles compétences par classe — et le **butin v2** (section 2 bis)
- Économie : échange direct, **étals du marché**, banque, courrier (section 2 bis)
- **Zones rouges** à JcJ libre et butin perdu à la mort (section 2 bis)

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

## 2 bis. Préconception v0.3 : butin, échanges, zones rouges (retours joueurs du 23/09)

Principe : **simple et accessible** — une infobulle qui compare tout seule, des raretés à la couleur évidente, pas de règles cachées.

**Butin v2**
- Niveau d'objet = niveau du monstre ou de la zone ; niveau max des joueurs : 30.
- 5 raretés : Commun (blanc, 0 affixe) · Inhabituel (vert, 1) · Rare (bleu, 2) · Épique (violet, 3) · Légendaire (orange : objet unique de boss avec un effet spécial, ex. « Lame runique d'Aldmar : les coups critiques gèlent »).
- Affixes aléatoires dont la valeur dépend du niveau d'objet : Force (attaque), Garde (défense), Vitalité (PV), Esprit (mana), Endurance, Précision (critique), Vitesse d'attaque, Vol de vie, Équilibre, dégâts de feu / givre / arcane, résistances.
- Emplacements : arme, main gauche (bouclier / grimoire / carquois), tête, torse, mains, pieds, 2 anneaux, amulette. Types d'armure : plaques (guerrier), cuir (rôdeur), tissu (mage).
- 6 paliers, chacun avec son allure visuelle : **T1** Brumeval (niv. 1–5) · **T2** Forêt et camp gobelin (5–10) · **T3** Cimetière (10–15) · **T4** Marais et désert (15–20) · **T5** Givreval (20–25) · **T6** Aldmar et zones rouges (25–30).
- Ensembles de 2 et 4 pièces (donjons, zones rouges) ; **amélioration à la forge** de +1 à +10 avec des pierres de forge trouvées en jeu ; **recyclage** des objets en matériaux.
- Infobulle de comparaison automatique avec l'objet porté (gains en vert, pertes en rouge).

**Arbre de compétences** (conception détaillée : `docs/design/ARBRE_COMPETENCES.md`)
- Au niveau 1, chaque classe n'a **que son attaque de base**. Chaque niveau donne **1 point** (plus 1 point bonus tous les 5 niveaux), à placer où l'on veut.
- Un **très grand arbre par classe** (3 branches par classe, plus une branche commune « Survie » pour l'endurance, la roulade et les déplacements) : nœuds de **nouvelles compétences**, nœuds de **variantes** (au choix, exclusives, qui transforment une compétence, **y compris l'attaque de base et la roulade**, ex. « Frappe → Frappe tournoyante / Frappe saignante / Frappe éclair »), petits bonus passifs, et **clés de voûte** (gros effets avec contrepartie).
- **Réinitialisation** accessible : gratuite jusqu'au niveau 10, puis contre de l'or chez le Maître des arts. Les personnages existants reçoivent leurs points et une réinitialisation gratuite à la mise à jour.
- **Raccourcis libres** : barre d'action à 8 emplacements, glisser-déposer depuis le livre de compétences, et toutes les touches réassignables dans les Options.
- Tout est validé par le serveur (points, prérequis, variantes).

**Artisanat de butin et armes** (conception détaillée : `docs/design/OBJETS_ARTISANAT.md`)
- Chaque monstre lâche des matériaux utiles : **fourrure de loup** → ensemble du loup ; **gelée de gluant** → potions ; babioles gobelines → bijoux ; os anciens → armure d'os ; chitine de scorpion, fourrure de yéti, cœur de golem → paliers supérieurs et légendaires.
- 3 métiers simples (**Forge**, **Alchimie**, **Couture**) aux stations du village. Les recettes s'apprennent auprès des PNJ ou en butin. La qualité est aléatoire (Normale, Supérieure, Chef-d'œuvre).
- **Beaucoup plus d'épées** : plusieurs familles (épée courte, longue, bâtarde, rapière, cimeterre, lame courbe, espadon, épée runique…) qui changent la vitesse, la portée et le critique, sur les 6 paliers, plus des épées uniques de boss.

**Échanges**
- **Échange direct** : fenêtre à deux, double confirmation, toute modification annule la confirmation, joueurs à moins de 8 m, hors combat.
- **Étals du marché** (place du marché de Brumeval, puis Port-Salin) : on dépose ses objets avec un prix, ils se vendent **même quand on est hors ligne** ; recherche et filtres (emplacement, rareté, niveau, classe, prix) ; taxe de 5 % pour retirer de l'or du jeu ; l'argent arrive à la banque.
- **Banque** : coffre personnel en ville (40 emplacements, extensible). Indispensable avec les zones rouges.

**Zones rouges**
- 3 niveaux de sécurité : **vert** (villes : aucun combat) · **jaune** (JcE ; JcJ seulement en duel ou à l'arène ; mort = écho d'XP comme en v0.2) · **rouge** (JcJ libre, régions de haut niveau 15+).
- **Mort en zone rouge** (tué par un joueur ou un monstre) : tout le sac + 50 % de l'or porté tombent dans un **sac de butin** au sol, que tout le monde peut piller pendant 10 min. **Recommandation retenue par défaut** : l'équipement porté est conservé, pour rester accessible. Un réglage serveur permet le mode « tout perdre ».
- Récompenses : +50 % d'XP, +100 % de chances de butin, raretés supérieures, élites et ressources exclusives, meilleur palier (T6).
- Signalisation : bordure rouge sur la carte et la minicarte, bannière d'avertissement à l'entrée, confirmation la première fois, et 5 s de protection en entrant (pas d'embuscade à la frontière).

## 3. Organisation du travail

Chaque vague est lancée en parallèle par une équipe d'agents IA. Chaque groupe de modèles passe par : création → contrôle visuel par un agent « directeur artistique » → corrections. Chaque agent a sa **propre copie git** (worktree) et sa **branche** `waveN/<agent>`. Un agent de fusion rassemble les branches, puis une équipe de revue (sécurité, gameplay, performances) teste et corrige. Si tout passe, la version est publiée sur `main` (déploiement automatique).

### Vague 1 → v0.2 « Fondations & Âme »
| Agent | Mission |
|---|---|
| `anticheat` | Anti-triche et sécurité serveur, outils MJ, bannissements, journaux de sécurité |
| `combat-souls` | Endurance, roulade, sprint, attaques télégraphiées, IA variée et archétypes, boss Golem à phases, équilibrage, échos de mort |
| `netcode-perf` | Optimisation serveur et réseau, compression, sauvegarde par compte, `/health`, Docker, test de charge |
| `render-souls` | Rendu dark fantasy (éclairage PBR + IBL, ombres en cascade, occlusion ambiante, brouillard volumétrique, rayons de lumière), herbe et arbres au vent, terrain texturé en tuiles, niveaux de détail, effets visuels Blender, réglages graphiques |
| `blender-kit` | Boîte à outils Blender partagée : matériaux procéduraux en nœuds, Geometry Nodes, cuisson des textures sur GPU, LOD, contrôles qualité automatiques |
| `lookdev` | Ciels HDR pour l'éclairage, textures de sol, effets visuels (feu, fumée, magie, entailles…) rendus dans Blender |
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
- **Code agents** work in their own git worktree. First command: `git switch -c wave1/<your-key>`. Commit often on that
  branch (`git add -A && git commit -m "..."`); your final state MUST be committed. Never push, never merge, never touch `main`.
- **Blender agents** (`blender-kit`, `lookdev`, `assets-*`) work directly in the main checkout, each in its own folder
  (`assets/blender/<group>/`) and on its own output keys, **without committing** (the merge agent commits the assets).
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

### 4.4 Art direction & rendering conventions (`render-souls` ↔ asset agents)
**Art direction (updated by the user): dark fantasy inspired by *Elden Ring*** — detailed, believable PBR materials
(worn stone, weathered wood, rusted/engraved metal, leather, cloth, fur, moss), dramatic atmospheric lighting
(golden-hour haze, god rays, volumetric fog, deep shadows, bloom on magic), plus the wind-animated grass and trees the
players asked for. **Not low-poly anymore.** This is still a browser game: detail comes from baked textures (normal,
roughness, AO) and good shapes, within budgets, with LODs.
- Materials whose name starts with `Leaf`, `Foliage`, `Grass`, `Cloth` or `Banner` sway in the wind in the client
  (amplitude ∝ height above the model origin). Trunks, stone and metal never sway. Keep foliage in its own material.
- glTF PBR only: baseColor + normal + ORM (occlusion/roughness/metallic) + emissive, textures exported as WebP.
  Leaves/grass/hair cards use alpha MASK. Procedural shader nodes are **baked** to these textures (glTF cannot carry
  node graphs).
- Budgets (LOD0 triangles / texture size / GLB size): heroes & humanoid monsters 8–15 k / 2048 / ≤ 4 MB; beasts 6–15 k /
  2048 / ≤ 4 MB; bosses 20–40 k / 2048 / ≤ 8 MB; buildings 5–20 k / 1024–2048 / ≤ 5 MB; rocks & props 1–5 k / 1024 /
  ≤ 2 MB; instanced vegetation 2–6 k / 1024 atlas / ≤ 2 MB. Static environment models also export
  `<key>_lod1.glb` (~30 %) and `<key>_lod2.glb` (~8 %, or an impostor card for trees) next to `<key>.glb`.
- Shared look-dev outputs: `client/public/env/` (sky HDRIs for image-based lighting), `client/public/textures/terrain/`
  (tileable PBR ground sets), `client/public/vfx/` (flipbook atlases + `manifest.json`).

### 4.6 Blender pipeline rules (all asset agents — see docs/PIPELINE_BLENDER.md)
- Use the shared kit `assets/blender/kit/` (procedural shader-node materials, Geometry Nodes builders, baking, LODs,
  QA renders). **Use nodes as much as possible**: Geometry Nodes for scattering (leaves, moss, pebbles, rivets, bricks,
  roof tiles, planks, fur cards), curves (branches, roots, ropes, chains, tails), displacement and wear; shader nodes
  for every material, then bake.
- **Continuous, clean meshes**: no loose floating triangles, no holes, no inverted normals, no z-fighting, no
  interpenetrating shells visible from outside, manifold where it matters. Characters: one continuous body mesh +
  clothing meshes with **smooth skin weights** (automatic/proximity weights, not rigid per part); body geometry hidden
  under clothing is deleted or shrunk so **nothing pokes through in any animation frame** (e.g. the v0.1 mage robe
  was made of separate triangles and the legs went through it — never again).
- Mandatory QA before finishing a model: turntable sheet (8 angles), wireframe overlay, face-orientation (normals)
  check, UV checker, and pose sheets of every clip at several frames; automated checks from the kit (loose parts,
  non-manifold edges, flipped normals, body-through-cloth penetration per frame, bbox, texture sizes, GLB size).

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
