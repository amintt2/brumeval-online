# Brief pour Codex Astra — Brumeval Online

Tu rejoins le projet **Brumeval Online** : un MMORPG *soulslike* multijoueur dans le navigateur (serveur Node.js + client Three.js), en ligne sur https://brumel.mciut.fr (déployé depuis `main`). Dépôt local : `C:\Users\amin2\mmorpg`. Claude (Anthropic) et ses sous-agents travaillent **en même temps** sur le même dépôt. Ce document te dit **quoi faire**, **où écrire** et **comment communiquer** avec Claude.

À lire d'abord : `ROADMAP.md` (§4.4 direction artistique, §4.5 clés et animations, §4.6 règles du pipeline Blender), `SPEC.md` §3 et §5.3 (conventions), `docs/PIPELINE_BLENDER.md` et `assets/blender/kit/` (la boîte à outils Blender partagée, en cours de finition par Claude — utilisable en lecture seule).

## 1. Communication (obligatoire)

Dossier partagé **`C:\Users\amin2\mmorpg\coordination\`** (non versionné, toujours à ce chemin absolu, même si tu travailles dans une autre copie) :

| Fichier | Qui écrit | Contenu |
|---|---|---|
| `BOARD.md` | chacun **uniquement ses propres lignes** | Tableau des tâches : id, propriétaire, statut, dossiers réservés, branche |
| `codex-outbox.md` | **Codex seulement**, en ajout à la fin | Tes messages pour Claude |
| `claude-outbox.md` | **Claude seulement**, en ajout à la fin | Les messages de Claude pour toi |

Règles :
- Au début de chaque session et avant chaque tâche : lis `BOARD.md` et `claude-outbox.md`.
- Pour prendre une tâche : passe sa ligne à `en cours` avec la date, et poste un message dans `codex-outbox.md`.
- Format d'un message : `## AAAA-MM-JJ HH:MM — [CX-n] titre` puis quelques lignes : ce qui est fait, les fichiers livrés, les questions, ce qui est **prêt à fusionner** (branche + commit).
- Tu ne modifies jamais un dossier réservé par Claude (colonne « Dossiers » du tableau). Si tu as besoin d'un changement chez Claude, demande-le dans ta boîte d'envoi.
- Statuts possibles : `à faire` · `en cours` · `à relire` · `terminé` · `bloqué (raison)`.

## 2. Git

- Ne travaille jamais dans `C:\Users\amin2\mmorpg` lui-même : les agents Blender de Claude y écrivent des fichiers non commités. Crée ta propre copie :
  `git -C C:\Users\amin2\mmorpg worktree add C:\Users\amin2\mmorpg-codex -b codex/cx-1`
  (une branche par tâche : `codex/cx-2`, `codex/cx-3`…, créées depuis `main`).
- Commite souvent sur ta branche. **Ne pousse jamais `main`** : c'est Claude qui fusionne, teste et publie chaque version (`main` = le jeu en ligne).
- Quand une tâche est prête : statut `à relire` sur le tableau + message « prêt à fusionner : codex/cx-n @ <commit> ».

## 3. Conventions techniques (non négociables)

- **Direction artistique** : dark fantasy inspirée d'*Elden Ring* (pierre usée, bois patiné, métal rouillé et gravé, cuir, tissu, mousse ; lumière dramatique). Plus de low-poly.
- **Modèles du jeu** : glTF `.glb`, 1 unité = 1 m, le modèle regarde vers **−Y dans Blender** (= +Z dans le jeu), origine aux pieds / au centre de la base, sol à z = 0. Matériaux PBR uniquement (baseColor + normal + ORM + emissive), textures **cuites** depuis tes nœuds, exportées en **WebP**. Feuillage/cheveux/herbe = cartes alpha MASK. Matériaux qui bougent au vent : nommés `Leaf*`, `Foliage*`, `Grass*`, `Cloth*`, `Banner*`.
- **Budgets** (triangles LOD0 / texture / taille du GLB) : accessoires 1–5 k / 1024 / ≤ 2 Mo ; bâtiments et pièces de donjon 5–20 k / 1024–2048 / ≤ 5 Mo ; créatures 6–15 k / 2048 / ≤ 4 Mo. Les modèles statiques exportent aussi `<clé>_lod1.glb` (~30 %) et `<clé>_lod2.glb` (~8 %).
- **Modèles animés** : une armature nommée `Rig`, maille continue, poids lisses, rien qui traverse les vêtements dans aucune image (le bug de la robe du mage v0.1 : jambes à travers la robe, triangles séparés — à ne jamais reproduire), une action Blender par animation, noms exacts.
- **Reproductibilité** : sauvegarde le code Python que tu exécutes via Blender MCP dans `assets/blender/codex/<tâche>/build.py`, avec un `assets/blender/codex/build.py` qui lance chaque sous-dossier, pour que `npm run assets -- codex` puisse tout régénérer. Si une partie est faite à la main, commite aussi le `.blend` dans `assets/source/codex/` (≤ 20 Mo, compressé).
- **Contrôle qualité avant de livrer** : `node scripts/inspect-glb.mjs <fichier.glb>` (taille, triangles, os, animations), plus des rendus sous 8 angles, en fil de fer et avec l'orientation des faces, que tu regardes vraiment. Dépose-les dans `assets/previews/codex/`.
- Tout texte visible par les joueurs est en **français**.

## 4. Tes tâches — dossiers réservés pour toi

Ordre de priorité (mis à jour le 2026-09-23) : 3ᵉ passe de CX-2 → CX-3, CX-6, CX-9 (en cours) → **CX-12** (nouveau, prioritaire pour la v0.3) → CX-10 → CX-5 → CX-4 → CX-11 → CX-7 → CX-8.

| Id | Tâche | Livrables | Dossiers réservés |
|---|---|---|---|
| **CX-1** | **Logo et illustrations** — logo 3D « Brumeval Online » (blason + titre gravé, lumière dramatique) ; 4 fonds cinématiques 1920×1080 : village de Brumeval à l'heure dorée, cimetière la nuit, antre du Golem, forêt dans la brume ; bannière du launcher 1600×600. Pas de limite de polygones : ce sont des images fixes (Cycles, volumétrie, rayons de lumière). | `client/public/ui/art/logo.png` (2048, transparent) + `logo_512.png`, `bg_login.webp`, `bg_loading_1..3.webp`, `launcher_banner.webp` | `client/public/ui/art/`, `assets/blender/codex/art/` |
| **CX-2** | **Icônes v2 dark fantasy** — refaire les 21 icônes d'objets + `gold` + les 12 icônes de compétences (mêmes noms de fichiers, voir `shared/data.js` : `ITEMS[*].icon` et `ab_<id>`), en 256×256 PNG, style illustration Elden Ring (objet détaillé, lumière latérale ; fond transparent pour les objets, fond sombre texturé pour les compétences). Plus, pour la v0.3 : `ore_copper`, `ore_iron`, `ore_mithril`, `crystal_shard`, `herb_brume`, `herb_givre`, `herb_braise`, `ingot_copper`, `ingot_iron`, `ingot_mithril`, `leather_strip`, `cloth_bolt`, `potion_hp_m`, `potion_stamina`, `helm_iron`, `gloves_leather`, `boots_leather`, `ring_silver`, `amulet_bone`. | `client/public/icons/*.png` | `client/public/icons/`, `assets/blender/codex/icons/` |
| **CX-3** | **Équipement visible** (v0.3) — armes et boucliers en GLB séparés, à attacher à la main : `eq_sword_1..5`, `eq_greatsword_1..2`, `eq_staff_1..4`, `eq_bow_1..4`, `eq_shield_1..3`. Origine = point de prise en main, lame / hampe le long de +Z (Blender). | `client/public/models/eq_*.glb` | `assets/blender/codex/equipment/` |
| **CX-4** | **Kit de donjon « Crypte d'Aldmar »** (v0.4) — pièces modulaires sur une grille de 4 m : `dng_floor`, `dng_wall`, `dng_wall_corner`, `dng_doorway`, `dng_stairs`, `dng_pillar`, `dng_arch`, `dng_gate` (grille en fer, partie mobile séparée nommée `Gate`), `dng_sarcophagus`, `dng_altar`, `dng_candles` (émissif), `dng_torch` (émissif), `dng_bones`, `dng_chandelier`, `dng_chest`. | `client/public/models/dng_*.glb` (+ LOD) | `assets/blender/codex/dungeon/` |
| **CX-5** | **Port-Salin** (2ᵉ ville, v0.3) — `port_dock`, `port_pier_post`, `port_rowboat`, `port_sailboat`, `port_lighthouse` (lanterne émissive), `port_fisher_hut`, `port_fish_crates`, `port_net_rack`, `port_buoy`, `port_warehouse`, `port_crane`. | `client/public/models/port_*.glb` (+ LOD) | `assets/blender/codex/port/` |
| **CX-6** | **Effets météo** (v0.3) — planches d'animation rendues dans Blender (WebP avec transparence) : `rain_streaks`, `rain_splash`, `snowflakes`, `sandstorm`, `fog_wisps`, `lightning_flash`, `embers` + `manifest.json` au même format que `client/public/vfx/manifest.json` (`{ nom: { file, cols, rows, frames, fps, loop, blending, size } }`). | `client/public/vfx/weather/` | `client/public/vfx/weather/`, `assets/blender/codex/weather/` |
| **CX-7** | **Monture** (v0.4) — `mount_steed` « Destrier de brume » : cheval spectral original (crinière et queue émissives, armure légère), animations `Idle`, `Walk`, `Trot`, `Gallop`, `Jump`, `Hit`, `Death`. | `client/public/models/mount_steed.glb` | `assets/blender/codex/mount/` |
| **CX-8** | *(optionnel)* **Serveur MCP du projet** — `tools/brumeval-mcp/` (Node, SDK MCP officiel) avec les outils `board_read`, `board_update` (ta ligne seulement), `outbox_post`, `inspect_glb`, `build_assets(group, only)`, `render_preview(key)`, `server_status(url)`, `run_tests`. | `tools/brumeval-mcp/` | `tools/brumeval-mcp/` |

| **CX-9** | **Kit d'interface dark fantasy** (v0.2/v0.3) — textures rendues dans Blender pour habiller l'interface : fond de panneau (cuir sombre / pierre, 512×512, découpable en 9 parties), coins et bordures en filigrane doré (PNG transparent), boutons (normal / survol / pressé), cadres de barres PV / mana / endurance + textures de remplissage, cadre d'emplacement d'objet et de compétence (128), anneau de minicarte (512), fond d'infobulle, ornements séparateurs, curseurs 32/64 px (normal, attaque = épée, parler = bulle, ramasser = main). Avec un `manifest.json` qui donne les marges de découpe en 9 parties. | `client/public/ui/kit/` | `client/public/ui/kit/`, `assets/blender/codex/uikit/` |
| **CX-10** | **L'Arbre-Brume** (v0.3) — repère colossal visible de toute la carte (≈ 120 m, dans l'esprit de l'Arbre-Monde d'Elden Ring mais original) : tronc torsadé, racines géantes, feuillage lumineux or-argent (émissif, matériau `Leaf*`), brume dorée. Budget LOD0 ≤ 40 k triangles + `_lod1` / `_lod2` + une carte « imposteur » pour le lointain. Clé `landmark_brume_tree`. | `client/public/models/landmark_brume_tree*.glb` | `assets/blender/codex/landmark/` |
| **CX-11** | **Kit « Grotte gelée »** (v0.4, 2ᵉ donjon) — pièces sur la grille de 4 m : `ice_floor`, `ice_wall`, `ice_wall_corner`, `ice_entrance`, `ice_pillar` (stalagmite), `ice_icicles`, `ice_crystal` (émissif bleu), `ice_bridge`, `ice_frozen_warrior` (guerrier pris dans la glace), `ice_chest`. | `client/public/models/ice_*.glb` (+ LOD) | `assets/blender/codex/icecave/` |

| **CX-12** | **Icônes de l'équipement v0.3** (butin v2 : voir `ROADMAP.md` §2 bis) — familles d'icônes 256×256 PNG générées de façon procédurale, **une allure visuelle par palier** (T1 fer brut et cuir usé → T2 acier et fourrure → T3 argent terni et os → T4 bronze patiné et écailles → T5 acier bleui et givre → T6 or noirci, runes d'Aldmar émissives). Pour chaque palier `t1`…`t6` : armes `sword_tN`, `greatsword_tN`, `staff_tN`, `bow_tN` ; main gauche `shield_tN`, `tome_tN`, `quiver_tN` ; armures `helm_<plate|leather|cloth>_tN`, `chest_…_tN`, `gloves_…_tN`, `boots_…_tN` ; bijoux `ring_tN`, `amulet_tN` (21 icônes × 6 = 126). Plus `forge_stone_1`, `forge_stone_2`, `forge_stone_3` (pierres de forge), `loot_bag` (sac de butin des zones rouges), `bank_chest`, `market_stall`, `trade`. La lisibilité à 40 px est obligatoire (planche de contrôle réduite). | `client/public/icons/*.png` | `client/public/icons/` (préfixes ci-dessus), `assets/blender/codex/gear_icons/` |

L'intégration dans le jeu (code, `shared/data.js`, interface) est faite par Claude : tu livres les fichiers et tu le signales dans ta boîte d'envoi.
