# Monde v0.3 — assets par biome

> Liste finale des assets du grand monde, issue de la bible visuelle (`drafts/art.md`) et recalée sur les régions et
> les noms de [`MONDE.md`](MONDE.md). Budgets, LOD, matériaux et conventions : ROADMAP §4.4 et §4.6,
> `docs/PIPELINE_BLENDER.md`. Aucune image de référence n'est copiée ; aucune forme ni aucun nom n'est repris.

**Priorités** : **P0** = sans lui la région ne peut pas ouvrir (v0.3.0 pour ses régions) · **P1** = richesse attendue
à l'ouverture · **P2** = finitions (v0.3.x / v0.4).
**Propriétaires** : groupes Blender Claude — `nature` (assets-nature), `props` (assets-props), `structures`
(assets-town), `creatures` (assets-beasts), `giants` (assets-giants), `humanoids` (assets-humanoids), `lookdev`,
et `render-souls` pour l'intégration ; **Codex** = tâches `CX-*` de `docs/CODEX_BRIEF.md`.
« existe » = clé déjà produite en vague 1 (ROADMAP §4.5) : contrôle de palette seulement.

**Renommages** : les noms provisoires de la bible visuelle sont remplacés par ceux de la carte — Sablardent →
**Ambresable** (ville) / **Désert de Sable-Rouge** (région), Sylvemère → **Sylve Ancienne**, Mont Braisier →
**Mont Brasier**, Canyon des Tessons → **Canyon de l'Entaille**, Bois Perdus → **Bois des Égarés**.

---

## 1. Règles communes

- **Teinte par instance** : les matériaux `Leaf*`, `Foliage*`, `Grass*` sont exportés en couleur de base neutre et
  claire ; le client multiplie par la teinte du biome (§2). `tree_oak` sert au Val (vert), à Mordoré et Aldmar (or),
  à la Sylve (vert sombre), aux Égarés (noirâtre). Nouveau modèle seulement si la **silhouette** change.
- **Tout ce qui est végétal bouge** (vent, direction dominante par région : palmiers, dunes, herbe et neige soufflée
  vont dans le même sens).
- **Structures usées** : arêtes émoussées, saleté en pied de mur, mousse / lichen / sable / neige sur les faces
  horizontales selon le biome ; kits modulaires sur une grille de 4 m ; un bâtiment repère par ville.
- **Couleurs réservées** : orange `#FF7A1A` et rouge `#E0302A` jamais en grands aplats de sol (télégraphes et zones
  rouges) ; or-argent = Arbre-Brume et pierres ; cyan pâle `#7FF0E6` = runes d'Aldmar.
- **Contrôle visuel par biome** avant validation : vignette 64 px reconnaissable à sa couleur ; vue à 1 km (repère de
  la région + Arbre-Brume) ; télégraphe lisible au sol de jour et de nuit ; aube, midi, heure dorée, nuit ;
  60 i/s au réglage Moyen ; originalité.

---

## 2. Biomes : palettes, végétation, assets

Nuanciers *lumière / ton moyen / ombre* en sRGB. Herbe : brins par m² au plus près. Les clés en **gras** sont P0.

### 2.1 Val de Brumeval (`G`, prés verts) — v0.3.0
- Herbe `#9BD04A` / `#6FAE36` / `#3F7426` ; feuillage `#7DB443` / `#4F8A2E` / `#2E5220` ; calcaire `#C9C2AE` /
  `#9C9682` / `#5E5A4E` ; brouillard `#C8D8DC` (visibilité 900 m) ; lanternes `#FFB05A`.
- Herbe haute 0,5–0,8 m, 40/m², grandes vagues ; fleurs en taches tous les 15–25 m ; chênes en bosquets, bouleaux près
  de l'eau. Particules : pollen blanc, papillons.
- Assets : `tree_oak`, `tree_birch`, `rock_a/b`, `cliff_a`, `flowers`, `house`, `ruins_*` (existent) · `grass_tuft_lush` **P0** · **`prop_signpost`** P0 (poteau indicateur en bois à 1–4 flèches vierges, texte posé par le client ; teinte par biome ; ≈ 25 carrefours, MONDE §13.1).

### 2.2 Prairies de Mordoré, Rives des Songes, Landes de Ventfauve (`O`, `M`) — v0.3.0
- Herbe or `#F2CC3A` / `#D9A51C` / `#8E6A14` ; feuillage d'automne `#F7C54A` / `#E48C1E` / `#9A4E16` ; sol `#E0C184` ;
  accent bleu-violet `#8C9AE0` ; brouillard `#F1DDA8` (poussière dorée). Lande de Ventfauve : même base, plus sèche.
- Graminées 0,6–1,0 m + épis, 30/m² ; chênes et bouleaux dorés (teinte) ; saules et roseaux aux Songes.
- Assets : **`grass_tuft_golden`** P0 · `tree_oak_autumn` P1 (P0 = teinte) · `tree_willow`, `reeds` (existent) ·
  stèles noires de Ventfauve = `obelisk` teinté (existe) + VFX `rune_glow` P1 · `windmill` (existe) pour le Moulin.

### 2.3 Parvis de l'Arbre-Brume, Ruines et Cœur d'Aldmar (`A`) — v0.3.0
- Mêmes ors que 2.2 ; pierre `#A7A9A6` / `#7C8088` / `#454850`, lichen or `#D9C02A`, runes `#7FF0E6` ; brume dorée
  `#F2D98A` près de l'Arbre, feuillage de l'Arbre `#FFE8A8` / `#DDE6F0` (émissif).
- Forteresse en ruine : gros appareil gris, créneaux, escaliers monumentaux, **aucune toiture intacte**.
- Assets : **`landmark_brume_tree` + imposteur (Codex CX-10)** P0 · `ruins_pillar/arch/wall`, `obelisk` (existent) ·
  **kit Ruines d'Aldmar (Codex CX-14 proposé)** : `ruins_rampart`, `ruins_rampart_corner`, `ruins_tower_square`,
  `ruins_stairs_grand`, `ruins_block`, `ruins_standing_stone` (runes cyan émissives), `ruins_statue_broken` — P1
  (P0 si le Grand Escalier ne peut pas être fait avec les pièces existantes) · `red_zone_banner`, `brazier` (`props`)
  **P0** pour le Cœur d'Aldmar · VFX `pollen_gold` P1, `leaves_fall_gold` **P0**.

### 2.4 Désert de Sable-Rouge, Ambresable, Mer de Dunes (`D`, `H`) — v0.3.0
- Sable `#EED9A4` / `#D6B97E` / `#A58656` (ombres de dunes `#9C8470`) ; grès `#D9B88A` / `#B8905E` / `#7E5E3C` ; pisé
  `#D8C29A` ; palmes `#5E9150` / `#3F7446` / `#244A2E` ; eau des canaux `#5CC4D2` ; tissus brique `#B8402E`, safran
  `#E09A2E`, sarcelle `#2E8C8C` ; brouillard `#E8D6AC`, tempête : visibilité 60 m, `#C9A46A`.
- Soleil blanc, ombres bleu-violet `#6E7898`, chaleur qui ondule. Pas d'herbe sur les dunes ; oyat 0,5 touffe/m² sur
  le sable dur ; **palmiers et plantes basses seulement autour de l'eau** (oasis, Rivière et Oued d'Ambre, Ambresable) ;
  cactus sur les plateaux.
- Assets `nature` : `tree_palm`, `cactus`, `rock_desert` (existent) · **`tree_palm_bent`**, **`dune_grass`**,
  **`plant_bigleaf`**, **`cliff_sandstone`** (3 variantes) P0 · `tree_palm_cluster`, `cactus_round` + `cactus_flower`,
  `tree_acacia`, `plant_agave`, `rock_arch`, `rock_hoodoo` P1 · `tree_palm_young` P2.
- **Ville d'Ambresable — Codex CX-13 (proposé)**, grille 4 m : **`desert_wall`, `desert_wall_corner`, `desert_gate`
  (arc brisé), `desert_house_a`, `desert_house_b`, `desert_canal`** P0 ; `desert_tower_basin` (tour-bassin d'où tombe
  un filet d'eau : bâtiment repère), `desert_stairs`, `desert_awning` (`Cloth*`), `desert_well`, `desert_market`,
  `desert_lantern`, `desert_pottery`, `sand_sled` (char à sable, décor puis v0.4) P1. Rien ne rappelle la ville de la
  référence (pas de statue géante, pas de piliers en forme de jambes).
- Mer de Dunes : squelette du Grand Ver (`props`, P1, vertèbres modulaires), `red_zone_banner`, `brazier`.
- VFX : **`sand_gust`**, **`waterfall_sheet`**, **`waterfall_mist`** P0 (Chutes d'Ambresable) · `heat_haze` P1.

### 2.5 Côte de Port-Salin, Archipel d'Azurine, Île de l'Épave (`T`, `B`) — v0.3.0 / v0.3.1
- Sable sec `#F2E8D0` / `#DCCFB2` / `#B4A68A`, mouillé `#C8B898` ; eau : écume `#F4FAF7` → `#9FEADB` → lagon `#3FC6C8` →
  `#1E8FB0` → `#15557E` → `#0C2E4E` ; falaises `#A7A8A2` / `#7E807C` / `#4A4C4A` ; végétation `#5F9A4A` ; crépuscule
  horizon `#F2C0A8`, nuages lilas `#C9B3D6` ; brume de mer basse le matin.
- Herbe dure 0,3 m, 15/m² en haut de plage ; palmiers penchés tous dans le sens du vent ; plantes tropicales au pied
  des falaises ; pins parasols sur les caps de l'est.
- Assets `nature` : **`tree_palm_bent`**, **`plant_bigleaf`**, **`rock_coast`**, **`cliff_coast`** P0 ·
  `tree_palm_cluster`, `plant_fern_palm`, `rock_sea_stack` P1 · `tree_pine_sea` P2.
- **Port-Salin — Codex CX-5** (dans la file) : `port_dock`, `port_pier_post`, `port_rowboat`, `port_sailboat`,
  `port_lighthouse` (repère), `port_fisher_hut`, `port_fish_crates`, `port_net_rack`, `port_buoy`, `port_warehouse`,
  `port_crane` **P0** ; ajouts proposés `port_stilt_house`, `port_lantern_string`, `port_market_stall` P1.
- `shipwreck` (épave géante de l'Épave, `props`) P1 (v0.3.1) ; `red_zone_banner`.
- VFX : **`sea_spray`**, **`shore_foam`** P0 · `seagulls` P2.

### 2.6 Sylve Ancienne et Clairsaule (`F`) — v0.3.0
- Canopée rétro-éclairée `#B7D95A`, moyenne `#6F9E36`, ombre `#2C4A22` ; fougères `#7AB040` / `#4E8030` ; tronc moussu
  `#6E7A44` / `#4E5634` / `#2E3222` ; humus `#4A3A26` ; rayons `#F2E9A8` ; brouillard vert `#9DBF7A` (120–180 m).
- Lumière directe à 25 % sous le couvert, taches de soleil (`foliage_cookie`). Un géant tous les 25–40 m, le reste en
  arbres moyens ; herbe 30/m² en clairière, 10/m² sous le couvert ; pins en lisière nord.
- Assets : **`tree_ancient`** (25–35 m, LOD + imposteur), **`plant_fern`** P0 · `tree_beech`, `root_arch`,
  `rock_mossy_boulder` P1 · `log_fallen`, `stump`, `mushrooms`, `tree_pine` (existent) · `druid_altar` P2 ·
  Clairsaule : `house`, `house_b`, `tavern` teintés bois sombre (existent) · VFX `godray_motes`, `leaves_fall_green` P1.

### 2.7 Bois des Égarés (`L`) — v0.3.0
- Brume `#7FB7B0` / `#4E7F7E` (vue 25–40 m, plus dense jusqu'à 4 m du sol) ; herbe `#5C8A45` / `#3E6B38` / `#22402A`,
  0,4 m, 25/m² ; écorce morte `#5A605C` / `#3E4442` / `#22282A` ; feux follets `#CFF7E8` ; soleil × 0,35, pas de rayons
  nets. La brume s'éclaircit (× 0,3) sur le bon chemin.
- Assets : **`tree_dead_gnarled`** P0 · `tree_dead`, `tree_willow` teinté (existent) · lanternes du Sentier = `lamp_post`
  teinté (existe) · VFX **`wisp_lost`** P0, `fireflies` P1.

### 2.8 Marais de Brumenoire (`W`) — v0.3.0
- Eau `#4A5A3E` → `#243020` (opaque, reflets forts), lentilles `#8AA83A`, boue `#5A4A34` ; roseaux `#A8A060` ; saules
  `#6E8A4A` ; brouillard `#8A9A80` dense sur 0–2 m. Roseaux 1,2 m (5/m²) + herbe humide 0,3 m.
- Assets : `reeds`, `tree_willow`, `swamp_hut` (existent) · `tree_mangrove`, `plant_lily`, `swamp_boardwalk`,
  `swamp_lantern` (verre vert `#9AE070`) P1 — **`swamp_boardwalk` P0** pour les Pilotis et les Passerelles ·
  VFX `fireflies` P1, `swamp_bubbles` P2.

### 2.9 Hauts-Plateaux de Rougecrête et Canyon de l'Entaille (`H`, `C`) — v0.3.1
- Strates `#D38B55` / `#B5653A` / `#8C4A2E` / `#E0B888` ; rivière verte `#4E9A88` ; brouillard `#E0B89A` léger.
- Genévriers, touffes sèches, rares cactus ; ponts de corde, arches naturelles.
- Assets : **`cliff_canyon`** (modulaire, strates) P0 v0.3.1 · `bridge_rope` (Pont de l'Entaille), `cairn`,
  `rock_hoodoo`, `rock_arch` P1 · `tree_juniper` P2 · Fort du Couchant : `watchtower`, `fence`, `tent` (existent).

### 2.10 Pics de Givreval, Couronne de Givre, Rochegivre (`S`, `R`) — v0.3.1
- Neige `#F4F7FA` / `#C9D8E8` / `#8EA6C4` (ombres bleues obligatoires) ; glace `#A8DCEC` / `#5FA8C8` ; granite `#8A8E94`
  / `#5A6470` / `#2E343C` ; sapins `#3E5E4A` / `#24402E` ; ciel plus sombre et pur ; blizzard : 40 m. Herbe rase jaunie
  `#B0A870` sous la limite des arbres (212 m), rien au-dessus de la limite des neiges (262 m).
- Assets : `tree_pine_snow`, `rock_snow`, `snow_cabin` (existent) · **`cliff_granite`** P0 v0.3.1 · `tree_larch`,
  `rock_ice`, `snow_cornice`, `rock_scree`, `cairn` P1 · `shrub_alpine` P2 · **Rochegivre — Codex CX-15 (proposé)** :
  `snow_house`, `snow_longhall` (repère), `snow_palisade`, `snow_bridge`, `snow_banner` (`Banner*`, laine rouge sombre
  `#8A2E2A`) P1 · Grotte gelée : CX-11 (v0.4) · VFX `snow_blow` P1.

### 2.11 Falaises des Embruns (`K`) — v0.3.0 (ouverte dès la v0.3.0 pour la tranche 20–24 ; ne coûte que des réemplois)
- Lande rase `#8F9A6A`, falaises marines grises ; phare blanc à lanterne chaude.
- Assets : `cliff_coast`, `rock_sea_stack` (voir 2.5) · phare = `port_lighthouse` (CX-5) · `sea_spray`.

### 2.12 Terres de Cendre et Cœur du Brasier (`V`, `Y`) — v0.4
- Cendre `#5A5452` / `#3A3634` / `#1E1A1A` ; basalte `#3A3434` / `#241F20` ; soufre `#D8C040` ; lave émissive
  `#FF6A1A` (cœur `#FFD27A`), croûte `#2A1410` ; ciel `#5A4A58` → `#C07048` ; brouillard `#6E5A52`. Télégraphes en
  **blanc-cyan** ici.
- Assets : `rock_basalt`, `cliff_basalt`, `rock_lava_crust`, `tree_charred` P2 (P0 de la v0.4) · VFX `embers` (CX-6),
  `ash_fall`, `lava_bubble` P2.

---

## 3. Terrain (textures) — `lookdev`, mélange — `render-souls`

Format existant `textures/terrain/<clé>_albedo|normal|orm|height.webp`, tuilable, 1 024 ou 2 048 ; 4 à 6 couches par
biome mélangées par altitude (étages MONDE §3.1) + pente (§3.2) + masque de biome + chemins.

| Clé | Biomes | Prio |
|---|---|---|
| `grass_lush` (≈ `grass` actuel) | Val, Sylve | P0 (existe) |
| `grass_golden` | Mordoré, Songes, Aldmar | P0 |
| `dirt_path` | routes, sentiers | P0 |
| `forest_floor` | Sylve, Égarés | P0 |
| `sand_dune`, `sandstone` | désert, canyon | P0 |
| `sand_beach`, `sand_wet` | côtes, îles | P0 |
| `rock_cliff` | Val, côte | P0 |
| `mud` | marais | P0 (marais ouvert en v0.3.0) |
| `grass_dry`, `cobble`, `moss`, `pebbles` | côte, plateaux, villes, ruines, rivières | P1 |
| `rock_red_strata`, `granite`, `snow`, `ice` | Rougecrête, Entaille, Givreval | P1 (P0 de la v0.3.1) |
| `ash`, `basalt` | volcan | P2 (P0 de la v0.4) |
| `caustics.webp`, `foliage_cookie.webp` | eau peu profonde, sous-bois | P1 |

Touffes d'herbe instanciées (`nature`, **P0**) : `grass_tuft_lush`, `grass_tuft_golden`, `grass_tuft_dry`,
`grass_tuft_dark` ; teintes base / pointe : Val `#4F8A2E` / `#B6DC5E` · Aldmar `#B8861A` / `#F7D860` · Sylve `#3E6E2A` /
`#9CC84A` · Égarés `#22402A` / `#6A9A5A` · désert (oyat) `#9A8A50` / `#D8CC8A` · côte `#6E8A4A` / `#C8C88A` · Givreval
`#7A7040` / `#C8BC80` · marais `#5A6A3A` / `#B0AA6A` · volcan `#5A4A3A` / `#9A8A6A`.

---

## 4. Ciels, nuages, eau — `lookdev` (textures), `render-souls` (moteur)

- **Nuages** (moteur : TECH_MONDE §8) — **P0** : `env/clouds/cloud_shape.webp` (Perlin-Worley 128³ en atlas 2D, si la
  génération GPU n'est pas retenue), `cloud_detail.webp` (32³), `weather_map.webp` (couverture / type sur le monde) ;
  repli Bas : `cloud_layers_*.webp` + `cumulus_impostor_*.webp` P1.
- Signature par biome (couche principale 600–1 600 m, couche basse 180–550 m) :

| Région | Type | Couverture | Base / sommet | Jour | Heure dorée |
|---|---|---|---|---|---|
| Val, Mordoré, Aldmar | tours de cumulus | 25–40 % | 650 / 1 400 m | blanc, dessous `#A8B4C8` | sommets `#FFD8A0`, dessous `#8A7A98` |
| Côtes, mer | cumulus plats + bancs bas | 20–30 % | bancs 180–400 m, cumulus 650 m | blanc, dessous `#B8C8D8` | rose `#F2C0A8`, lilas `#C9B3D6` |
| Désert | voile d'altitude, cirrus | 5–15 % | 1 200 / 1 600 m | `#F2EEE4` translucide | or pâle `#F2D8A8` |
| Sylve | cumulus + brume dans la canopée | 35 % | 650 / 1 300 m | blanc | or chaud |
| Givreval | plafond bas + **mer de nuages sous les pics** | 60–80 % | 300 / 550 m (couche basse) | blanc bleuté `#E8F0F8` | alpenglow `#F2A0A0` |
| Volcan | panache sombre + cendres | 50 % | 350 / 1 400 m | `#4A4040` | dessous rouge `#C05030` |
| Marais | stratus gris | 70 % | 200 / 450 m | `#B0B8B0` | `#C8B090` terne |
| Orage (météo) | cumulonimbus | 90 % | 600 / 1 600 m | `#5A6068` | — |

- **Ciels HDR** (format `env/manifest.json`) : **`sky_dawn`, `sky_dusk`** P0 (cycle) ; `sky_storm`, `sky_desert`,
  `sky_snow` P1 ; `sky_ash` P2.
- **Eau** : shader profondeur / turquoise, houle, écume, carte de flux des rivières (`render-souls` **P0**) ; textures
  `water_normal_a/b.webp`, `foam.webp` (existe), `caustics.webp`, `flow_noise.webp` (`lookdev`, P0 sauf caustiques P1).
- Lumière : 6 moments (aube, matin, midi, heure dorée, crépuscule, nuit), aube et crépuscule ≈ 25 % d'un cycle
  proposé de 48 min (à confirmer) ; réglage par région = colonne `ambiance` de `world_layout.json`.

---

## 5. VFX — `lookdev` (planches Blender, format `client/public/vfx/manifest.json`)

Déjà validés (Codex CX-6) : `rain_streaks`, `rain_splash`, `snowflakes`, `sandstorm`, `fog_wisps`, `lightning_flash`,
`embers`.

| Clé | Où | Prio |
|---|---|---|
| `sand_gust` | dunes | P0 |
| `sea_spray`, `shore_foam` | côtes | P0 |
| `waterfall_sheet`, `waterfall_mist` | Chutes d'Ambresable, cascades | P0 |
| `leaves_fall_gold` | Mordoré, Aldmar | P0 |
| `wisp_lost` | Bois des Égarés | P0 |
| `leaves_fall_green`, `fireflies`, `godray_motes`, `pollen_gold`, `snow_blow`, `heat_haze`, `rune_glow` | Sylve, marais, Arbre-Brume, Givreval, désert, Aldmar | P1 |
| `ash_fall`, `lava_bubble`, `swamp_bubbles`, `seagulls`, `butterflies` | volcan, marais, côtes, Val | P2 |

---

## 6. Créatures (nouveaux monstres de MONDE §4.3)

| Clé | Propriétaire | Base | Version | Prio |
|---|---|---|---|---|
| `bandit_archer`, `bandit_desert`, `pirate`, `pirate_harpooner` | `humanoids` | variantes du rig `bandit` (tenue, arme, teinte) | v0.3 | P0 (`pirate` pour Port-Salin, `bandit_desert` pour le désert) |
| `rift_lizard` | `creatures` | rig `wolf` | v0.3 | P1 |
| `husk` | `humanoids` | rig `skeleton` + sable | v0.3 | P0 (annonce l'onde du Ver) |
| `stone_guardian` | `giants` | rig `golem`, matériaux de grès | v0.3 | P1 |
| `crab` | `creatures` | **nouveau modèle** (seul vrai nouveau de la v0.3) | v0.3 | P0 |
| `toad_brute`, `treant`, `wisp`, `harpy`, `sea_serpent_whelp`, `salamander` | `creatures` / `giants` | nouveaux | v0.4 | P2 |
| `magma_golem`, `ember_wisp`, `crab_king`, `ember_matriarch` | `giants` / `creatures` | rigs `golem`, `wisp`, `crab`, `salamander` | v0.4 | P2 |

Clips : contrat ROADMAP §4.5 (`Attack2` télégraphié, `Run`, `Shoot`, `Special` pour les boss).

---

## 7. Récapitulatif par propriétaire

| Propriétaire | P0 (v0.3.0) | P1 | P2 |
|---|---|---|---|
| `nature` | `grass_tuft_*`, `tree_palm_bent`, `dune_grass`, `plant_bigleaf`, `cliff_sandstone`, `rock_coast`, `cliff_coast`, `tree_ancient`, `plant_fern`, `tree_dead_gnarled` ; v0.3.1 : `cliff_canyon`, `cliff_granite` | `tree_palm_cluster`, `cactus_round`, `tree_acacia`, `plant_agave`, `rock_arch`, `rock_hoodoo`, `plant_fern_palm`, `rock_sea_stack`, `tree_oak_autumn`, `tree_beech`, `root_arch`, `rock_mossy_boulder`, `tree_mangrove`, `plant_lily`, `tree_larch`, `rock_ice`, `snow_cornice`, `rock_scree` | `tree_palm_young`, `shrub_alpine`, `tree_charred`, `tree_juniper`, `tree_pine_sea`, `rock_basalt`, `cliff_basalt`, `rock_lava_crust` |
| `props` / `structures` | `swamp_boardwalk`, `red_zone_banner`, `brazier`, `prop_signpost` | `bridge_rope`, `cairn`, `swamp_lantern`, squelette du Grand Ver, `shipwreck` | `druid_altar` |
| `creatures` / `giants` / `humanoids` | `crab`, `pirate`, `bandit_desert`, `husk` | `bandit_archer`, `pirate_harpooner`, `rift_lizard`, `stone_guardian` | monstres v0.4 |
| `lookdev` | textures de terrain P0, `cloud_*`, `weather_map`, `sky_dawn`, `sky_dusk`, eau, VFX P0 | textures P1, ciels P1, VFX P1, imposteurs de nuages | `sky_ash`, VFX P2 |
| `render-souls` | CDLOD + diffusion, océan, nuages volumétriques + ombres, mélange altitude/pente/biome, brouillard par biome, teinte par instance | imposteurs octaédriques (contrat §4.4 à étendre), cascades | — |
| **Codex** | **CX-10** Arbre-Brume, **CX-5** Port-Salin, **CX-13** Ambresable (proposé, murs / maisons / porte / canal) | CX-13 (reste), **CX-14** Ruines d'Aldmar (proposé), **CX-15** Rochegivre (proposé), ajouts CX-5 | CX-11 Grotte gelée, CX-4 Crypte, CX-7 monture (v0.4) |

Ordre Codex proposé (à valider par l'utilisateur) : après CX-3b et CX-12 déjà en cours → **CX-10 → CX-5 → CX-13 →
CX-14 → CX-15**, puis CX-4, CX-11, CX-7 (le désert est le biome le plus demandé).
