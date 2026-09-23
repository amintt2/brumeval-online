# Bible visuelle du monde ouvert — Brumeval Online (brouillon v0.3)

> Rôle : directeur artistique « monde ». Ce document fixe **comment le grand monde doit avoir l'air** (biomes, lumière,
> brume, nuages, eau, relief) et **qui fabrique quoi** (liste d'assets, priorités, propriétaires).
> Il complète `ROADMAP.md` §2 (monde « à la Zelda ») et §4.4 (direction Elden Ring, conventions PBR / LOD / vent).
> Les chiffres de relief et la position exacte des régions appartiennent à la carte (brouillon du cartographe) :
> ici on décrit leur **lecture visuelle**. Tous les noms visibles par les joueurs sont en français.

**Références.** L'utilisateur a fourni 10 captures de *Zelda: Tears of the Kingdom* (carte du monde, prairie verte avec
ruines, prairie dorée d'automne, champ de ruines doré avec pierre lumineuse, ville du désert à palmiers et cascades,
char à sable sur les dunes, bois perdus dans la brume, forêt dense avec rayons de lumière, deux plages tropicales).
**Aucune image n'est copiée dans le dépôt** (droits d'auteur) et on ne reprend **aucun nom propre, aucun motif ni
aucune architecture reconnaissable** : on n'en extrait que des règles (couleurs, densités, rythmes, lumière).
Les teintes ci-dessous sont des valeurs relevées puis **ajustées à notre direction** (voir §1).

---

## 0. Résumé en dix règles

1. **Une couleur d'identité par biome**, lisible sur la minicarte et à 1 km : vert tendre (prairies), or (Champs
   d'Aldmar), sable ocre (désert), turquoise (côte), vert profond (grande forêt), bleu-vert brumeux (bois perdus),
   blanc bleuté (Givreval), noir-rouille (volcan), olive sourd (marais), rouge-orangé en strates (canyon).
2. **Détail et lumière Elden Ring, lisibilité Zelda** : matériaux PBR cuits (pierre usée, mousse, bois patiné), ombres
   profondes, brume en profondeur ; mais des aplats de couleur larges et une silhouette forte par zone.
3. **Saturation dosée** : les teintes d'identité sont gardées, mais la chroma des tons moyens baisse de 10 à 20 % par
   rapport aux références ; **un seul accent très saturé par vue** (fleurs, tissu, lanterne, rune).
4. **Ombres froides, lumières chaudes** le jour ; l'inverse la nuit (lune froide, feux chauds).
5. **Perspective atmosphérique forte** : à 400 m, le relief perd ~40 % de contraste et prend la couleur du brouillard
   du biome ; c'est ce qui donne l'échelle « immense ».
6. **La hauteur se lit** : bandes d'altitude avec végétation, roche et brume différentes (§3). Un relief doit se
   deviner à sa couleur même sans ombre.
7. **Un repère vertical par région**, visible de loin (tour, arche, pic, arbre, phare), plus l'Arbre-Brume visible de
   partout avec son halo doré.
8. **Tout ce qui est végétal bouge** (matériaux `Leaf*`, `Foliage*`, `Grass*`), et chaque biome a ses particules
   d'ambiance (pollen, feuilles, lucioles, sable, embruns, cendres).
9. **Nuages volumétriques** avec une signature par biome : tours de cumulus sur les prairies, voile de chaleur au
   désert, bancs bas sur la mer, plafond bas et mer de nuages en montagne, panache sombre au volcan.
10. **Réutiliser avant de créer** : une même essence d'arbre ou de roche sert plusieurs biomes grâce à une teinte par
    instance (§6.1). On ne modélise une variante que si la silhouette change.

---

## 1. Réconcilier Zelda et Elden Ring

| Aspect | Ce qu'on prend aux références Zelda | Ce qu'on garde d'Elden Ring (§4.4) | Règle Brumeval |
|---|---|---|---|
| Couleur | Biomes très typés, aplats lumineux, ciel bleu franc | Palette plus sourde, ocres, brume dorée | Teinte d'identité conservée, tons moyens désaturés, noirs jamais bouchés mais plus denses (valeur 12–20 %) |
| Matière | Formes simples, lecture immédiate | Pierre sculptée, érosion, mousse, lichen, bois fendu | Silhouettes simples + textures cuites détaillées (normal + ORM) ; pas de cel-shading, pas de contour |
| Herbe | Tapis dense, haut, qui ondule par vagues | Herbe plus sèche, touffes irrégulières | Densité Zelda, variation de hauteur et de teinte Elden Ring (3 teintes mélangées par touffe) |
| Lumière | Soleil haut et net, ombres portées lisibles | Heure dorée, rayons de lumière, contre-jour | Journée longue et lisible pour le combat ; aube et crépuscule plus longs que la réalité (≈ 25 % du cycle) pour le spectacle |
| Atmosphère | Brume teintée par biome (bleu-vert des bois perdus, voile de sable) | Brume volumétrique, halo de l'Arbre | Brouillard de hauteur + brouillard de distance, couleur par biome (§2), halo doré près de l'Arbre-Brume |
| Magie | Pierres lumineuses cyan | Or pâle, runes émissives | **Or-argent** = Arbre-Brume, points de téléportation, Brume ; **cyan pâle** = runes anciennes d'Aldmar (complémentaire de l'or des champs, donc lisible) ; **rouge-orangé** = danger (zones rouges, volcan) |

Contraintes combat (soulslike) : les attaques télégraphiées doivent rester lisibles partout. Aucun biome ne doit
utiliser l'**orange vif `#FF7A1A`** ni le **rouge `#E0302A`** en grands aplats de sol (réservés aux télégraphes et aux
zones rouges), sauf le volcan où les télégraphes passent au **blanc-cyan**.

---

## 2. Biomes : palettes, lumière, brume, végétation, roches, architecture

Format des nuanciers : *lumière / ton moyen / ombre*. Les couleurs de ciel et de brouillard sont en sRGB (le rendu les
convertit en linéaire). « Densité herbe » = brins par m² au LOD le plus proche (le client réduit avec la distance).

### 2.1 Val de Brumeval (région de départ, prairies tempérées) — réf. 2
- **Identité** : collines vertes douces, murets et ruines basses envahies de lierre, falaises calcaires claires, ciel
  bleu avec cumulus. Rassurant, mais avec la brume dorée qui rappelle le danger au loin.
- **Herbe** `#9BD04A` / `#6FAE36` / `#3F7426` · **feuillage** `#7DB443` / `#4F8A2E` / `#2E5220`
- **Sol / chemin** `#B89A6A` / `#8C7048` / `#5A4630` · **roche calcaire** `#C9C2AE` / `#9C9682` / `#5E5A4E`, mousse `#8DAF4E`
- **Eau** lac `#4E9FB8` → profond `#1E5A78` · **ciel** zénith `#5E9FE0`, horizon `#CFE4F0` · **brouillard** `#C8D8DC`, densité faible (visibilité 900 m)
- **Herbe** : haute (0,5–0,8 m), dense (40/m²), ondule en grandes vagues visibles (vent fort, période 4–6 s).
  Fleurs blanches et jaunes en taches (`flowers`), 1 tache tous les 15–25 m.
- **Arbres** : `tree_oak` (dominant), `tree_birch` près de l'eau, bosquets de 3–7 arbres, jamais en ligne.
- **Roches** : `rock_a`, `rock_b`, `cliff_a` (calcaire clair avec mousse sur le dessus).
- **Architecture** : maisons à colombages, toits d'ardoise, murets de pierre sèche, ruines de tours rondes (reprend
  `house`, `ruins_*`). Poteaux-lanternes chaudes `#FFB05A`.

### 2.2 Champs d'Aldmar (ruines dorées, automne perpétuel) — réf. 3 et 4
- **Identité** : herbe or, arbres aux feuilles jaune-orangé, grands blocs de pierre grise couverts de lichen jaune,
  ruines crénelées, pierres dressées gravées de runes cyan qui pulsent. Lumière de fin d'après-midi même à midi (le
  soleil y est légèrement plus bas : astuce de teinte, pas de géométrie).
- **Herbe** `#F2CC3A` / `#D9A51C` / `#8E6A14` · **feuillage** `#F7C54A` / `#E48C1E` / `#9A4E16`
- **Sol** `#E0C184` / `#B99658` / `#7A6036` · **pierre** `#A7A9A6` / `#7C8088` / `#454850`, **lichen or** `#D9C02A`
- **Accent fleurs** bleu-violet `#8C9AE0` (en petites taches, contraste complémentaire de l'or) · **runes** émissif `#7FF0E6`
- **Ciel** zénith `#6FB6EA`, horizon `#E6F1F2` · **brouillard** `#F1DDA8` (poussière dorée), densité faible à moyenne
- **Herbe** : graminées hautes et fines (0,6–1,0 m) + épis, 30/m², touffes irrégulières laissant voir la terre claire.
- **Arbres** : chênes d'automne (`tree_oak` teinté en P0, `tree_oak_autumn` en P1), bouleaux dorés (`tree_birch` teinté).
- **Roches** : blocs taillés éboulés (`ruins_block`), `ruins_pillar`, `ruins_wall`, `ruins_arch`, `obelisk` (runes cyan).
- **Architecture** : forteresse d'Aldmar en ruine — gros appareil de pierre grise, créneaux, escaliers monumentaux,
  **aucune toiture intacte**, lichen doré sur les faces horizontales (règle de mousse du kit, couleur or).

### 2.3 Désert de Sablardent et oasis (sud-ouest) — réf. 5 et 6
- **Identité** : dunes ocre à ondulations fines, plateaux de grès sculptés par le vent (piliers, arches, corniches),
  ville fortifiée en pisé autour d'une oasis, **eau qui tombe en cascades fines depuis les rochers** et court dans
  des canaux, palmiers en alignements, tissus colorés tendus (auvents, voiles).
- **Sable** `#EED9A4` / `#D6B97E` / `#A58656` (ombre des dunes légèrement violacée `#9C8470`)
- **Grès** `#D9B88A` / `#B8905E` / `#7E5E3C` · **pisé** `#D8C29A` / `#BFA478` / `#8A7452`
- **Palmes** `#5E9150` / `#3F7446` / `#244A2E` · **tronc** `#8A6A46` / `#6A5034` · **cactus** `#6E9A5A` / `#4E7442`
- **Eau des canaux** `#5CC4D2` (très claire, fond de sable visible) · **tissus d'accent** rouge brique `#B8402E`,
  safran `#E09A2E`, sarcelle `#2E8C8C`
- **Ciel** zénith `#78A8D8` (un peu passé), horizon `#E4D8B8` (voile de sable) · **brouillard** `#E8D6AC`,
  densité moyenne à l'horizon, forte pendant les tempêtes de sable (visibilité 60 m, teinte `#C9A46A`)
- **Lumière** : soleil blanc très fort, ombres courtes et nettes bleu-violet `#6E7898`, **chaleur qui ondule** au
  ras du sol (distorsion écran, 0 à 1 selon l'heure) ; nuits froides, bleu profond, étoiles très visibles.
- **Végétation** : pas d'herbe sur les dunes ; touffes d'oyat (`dune_grass`) très clairsemées (0,5/m²) sur le sable
  dur ; palmiers et plantes basses (`plant_agave`) seulement autour de l'eau ; cactus sur les plateaux rocheux.
- **Arbres** : `tree_palm` (droit), `tree_palm_bent` (courbé), `tree_palm_cluster` (3 troncs), `tree_acacia` (plateaux).
- **Roches** : `rock_desert`, `cliff_sandstone` (strates horizontales), `rock_arch` (arche naturelle), `rock_hoodoo`
  (cheminée de fée).
- **Architecture** : kit « Sablardent » (§7.3) — murs épais arrondis, terrasses, portes en arc brisé, tours surmontées
  de bassins d'où tombent des filets d'eau, marchés couverts de toiles. **Rien ne doit ressembler** à la ville de
  la référence : pas de statue géante, pas de piliers en forme de jambes.

### 2.4 Côte de Port-Salin et lagons (sud et est) — réf. 9 et 10
- **Identité** : sable blanc crème, eau turquoise dont la couleur **dépend de la profondeur**, bancs de sable,
  palmiers penchés vers la mer, falaises grises avec cavités, îlots au loin, village de pêcheurs en bois sur pilotis.
- **Sable sec** `#F2E8D0` / `#DCCFB2` / `#B4A68A` · **sable mouillé** `#C8B898` · **galets** `#9A968C`
- **Eau** (du bord vers le large) : écume `#F4FAF7` → très peu profond `#9FEADB` → lagon `#3FC6C8` → chenal `#1E8FB0`
  → large `#15557E` → grand fond `#0C2E4E`
- **Falaises** `#A7A8A2` / `#7E807C` / `#4A4C4A` avec traînées sombres d'humidité · **végétation côtière** `#5F9A4A`
- **Ciel** zénith `#5E9CE0`, horizon `#DCEAF2` ; au crépuscule horizon `#F2C0A8` et nuages `#C9B3D6` (lilas)
- **Brouillard** `#D8E8EE`, faible le jour ; **brume de mer** basse le matin (bande de 0 à 6 m au-dessus de l'eau)
- **Herbe** : aucune sur le sable ; herbe dure courte (0,3 m, 15/m²) en haut de plage ; plantes tropicales (`plant_fern_palm`, `plant_bigleaf`) au pied des falaises.
- **Arbres** : `tree_palm_bent` (dominant, tous penchés dans la même direction : celle du vent dominant de la côte),
  `tree_palm_cluster`, `tree_pine_sea` (pins parasols sur les caps rocheux, côte est plus tempérée).
- **Roches** : `rock_coast` (arrondie, polie par l'eau), `cliff_coast`, `rock_sea_stack` (aiguille dans la mer).
- **Architecture** : kit Codex **CX-5 Port-Salin** — bois gris-argent délavé `#9A9488`, cordages, toits de bardeaux
  bleu-gris `#5E6E7A`, touches de peinture turquoise et rouge passé, phare blanc à lanterne chaude.
  Les pontons s'avancent sur l'eau turquoise ; lanternes suspendues le soir.

### 2.5 Grande Forêt de Sylvemère (nord-centre) — réf. 8
- **Identité** : cathédrale végétale — troncs énormes couverts de mousse, racines tentaculaires, sous-bois de fougères
  et d'herbe haute, **rayons de lumière** obliques qui traversent une brume verte, souches, sentiers de dalles.
- **Canopée** rétro-éclairée `#B7D95A`, moyenne `#6F9E36`, ombre `#2C4A22` · **fougères** `#7AB040` / `#4E8030`
- **Tronc moussu** `#6E7A44` / `#4E5634` / `#2E3222` · **écorce nue** `#6A5A48` · **sol** humus `#4A3A26`, feuilles mortes `#7A5A30`
- **Rayons** `#F2E9A8` (additifs, faibles) · **brouillard** `#9DBF7A` (vert), densité moyenne, visibilité 120–180 m
- **Lumière** : sous le couvert, lumière directe à 25 % ; ambiance verte ; taches de soleil au sol (gobos : texture
  de cookie de feuillage projetée par la lumière directionnelle, voir §9).
- **Herbe** : herbe haute et souple 0,6 m, 30/m² dans les clairières, 10/m² sous le couvert + fougères 1/m².
- **Arbres** : `tree_ancient` (géant moussu, 25–35 m, P0), `tree_oak`, `tree_beech` (fût lisse gris), `tree_pine` en
  lisière nord. Densité : 1 géant tous les 25–40 m, le reste rempli par les arbres moyens.
- **Sol** : `log_fallen`, `stump`, `mushrooms`, `root_arch` (racine en arche qu'on traverse), `plant_fern`.
- **Architecture** : très rare ; autels de pierre moussus, cabanes de druides en bois courbe, lanternes-champignons.

### 2.6 Bois Perdus / Bois de Brumenoire (clairière cachée, nord de la forêt) — réf. 7
- **Identité** : brume bleu-vert épaisse qui cache le chemin, arbres morts noueux aux branches griffues, silhouettes
  de ruines à peine visibles, feux follets, lumière diffuse sans ombre franche. Inquiétant mais pas horrifique.
- **Brume** `#7FB7B0` (claire) / `#4E7F7E` (profonde) · **herbe** `#5C8A45` / `#3E6B38` / `#22402A`
- **Écorce morte** `#5A605C` / `#3E4442` / `#22282A` · **mousse bleutée** `#6A8A70` · **feux follets** émissif `#CFF7E8`
- **Densité de brouillard** élevée : visibilité 25–40 m, **plus dense au ras du sol** (brouillard de hauteur jusqu'à 4 m)
- **Lumière** : soleil voilé (intensité × 0,35), ambiance teintée cyan, **pas de rayons nets**, lueurs ponctuelles.
- **Herbe** : moyenne (0,4 m), 25/m², légèrement bleutée ; buissons sombres (`bush` teinté).
- **Arbres** : `tree_dead_gnarled` (grand, torsadé, P0), `tree_dead`, `tree_willow` teinté sombre près de l'eau.
- **Mécanique visuelle** : la brume se lève (densité × 0,3) quand on suit le bon chemin (effet géré par le client).

### 2.7 Pics de Givreval (nord-ouest, haute montagne)
- **Identité** : crêtes aiguës, neige qui fume sur les arêtes, forêts de sapins enneigés en contrebas, cabanes de
  rondins, lacs gelés, **mer de nuages** sous les sommets.
- **Neige** `#F4F7FA` / `#C9D8E8` / `#8EA6C4` (ombres bleues obligatoires) · **glace** `#A8DCEC` / `#5FA8C8`
- **Roche** granite `#8A8E94` / `#5A6470` / `#2E343C` · **sapins** `#3E5E4A` / `#24402E` · **lichen** `#9AA07A`
- **Ciel** zénith `#4A86D0` (plus sombre et plus pur en altitude), horizon `#DCE6EE` · **brouillard** `#D6E4EE`
- **Lumière** : très forte réverbération (ambiance × 1,3 sur la neige), soleil blanc froid ; blizzard : visibilité 40 m.
- **Végétation** : herbe rase jaunie `#B0A870` sous 380 m (voir §3), rien au-dessus ; `tree_pine_snow`, `tree_larch` (mélèze doré), `shrub_alpine`.
- **Roches** : `rock_snow`, `cliff_granite`, `rock_ice`, corniches de neige `snow_cornice`.
- **Architecture** : village de montagne (§7.4) — rondins sombres, toits de lauzes lourds chargés de neige,
  cheminées fumantes, bannières de laine rouge sombre `#8A2E2A` (accent unique).

### 2.8 Mont Braisier (volcan, nord-est)
- **Identité** : pente noire de cendre, coulées de lave figée, rivières de lave qui éclairent le relief par dessous,
  panache de fumée, pluie de cendres, ciel orangé. Zone de haut niveau (T5/T6).
- **Cendre** `#5A5452` / `#3A3634` / `#1E1A1A` · **basalte** `#3A3434` / `#241F20` · **soufre** `#D8C040`
- **Lave** émissif `#FF6A1A` (cœur `#FFD27A`), croûte `#2A1410` · **braises** `#FF9A3A`
- **Ciel** zénith `#5A4A58`, horizon `#C07048` · **brouillard** `#6E5A52`, densité moyenne, rougi près de la lave
- **Lumière** : soleil filtré orangé, lumière de rebond rouge depuis le bas près des coulées (lumières ponctuelles
  bakées dans l'émissif + quelques lumières dynamiques).
- **Végétation** : presque rien — `tree_charred` (arbre calciné), touffes d'herbe sèche `#8A7A5A` en bordure.
- **Roches** : `rock_basalt` (orgues hexagonales), `rock_lava_crust`, `cliff_basalt`.
- **Télégraphes** : ici en blanc-cyan (voir §1).

### 2.9 Marais de Brumenoire (est)
- **Identité** : eau stagnante sombre et verdâtre, îlots de boue, roseaux, saules pleureurs, arbres morts, lentilles
  d'eau, cabanes sur pilotis, brume basse, lucioles la nuit.
- **Eau** `#4A5A3E` → profond `#243020` (opaque, reflets forts) · **lentilles** `#8AA83A` · **boue** `#5A4A34` / `#3A2E22`
- **Roseaux** `#A8A060` / `#7A7440` · **saules** `#6E8A4A` / `#44602E` · **bois pourri** `#4A4036`
- **Ciel** zénith `#7A90A0`, horizon `#B8C0A8` · **brouillard** `#8A9A80`, dense au ras de l'eau (0–2 m)
- **Végétation** : `reeds` en massifs, `tree_willow`, `tree_mangrove` (racines-échasses, P1), `plant_lily` (nénuphars).
- **Architecture** : `swamp_hut` (existant), pontons de planches, lanternes de verre vert `#9AE070`.

### 2.10 Canyon des Tessons et hauts plateaux (entre désert et prairies)
- **Identité** : falaises à strates rouges et ocre, gorges étroites, ponts de corde, arches naturelles, rivière verte
  au fond.
- **Strates** `#D38B55` / `#B5653A` / `#8C4A2E` / `#E0B888` (alternance) · **rivière** `#4E9A88`
- **Brouillard** `#E0B89A` léger · **végétation** : genévriers (`tree_juniper`), touffes sèches, rares cactus.
- **Roches** : `cliff_canyon` (modulaire, strates), `rock_hoodoo`, `rock_arch`.

### 2.11 Arbre-Brume (repère central, CX-10) et zones rouges
- Autour de l'Arbre : **brume dorée** `#F2D98A` en couche basse, feuillage or-argent émissif `#FFE8A8` / `#DDE6F0`,
  particules de pollen lumineux. Visible de partout : sa couleur doit rester **au-dessus du brouillard lointain**
  (l'imposteur ignore le brouillard à 60 %).
- **Zones rouges** (PvP) : aucune palette propre, mais un filtre : désaturation × 0,7, brouillard teinté `#6A2A24`,
  bordure marquée par des bannières déchirées rouge sombre et des braseros.

---

## 3. Typologie des hauteurs : comment le relief se lit à l'œil

> Demande de l'utilisateur : « que le cartographe fasse la typologie des hauteurs ». La carte (brouillon du
> cartographe) fixe les altitudes réelles et les formes ; cette section donne à chaque type de relief **son traitement
> visuel**, pour que les deux documents se répondent. Si les seuils chiffrés du cartographe diffèrent, **ce sont les
> siens qui font foi** : on garde l'ordre des bandes et on recale les nombres.

### 3.1 Bandes d'altitude (seuils proposés pour une carte de 4 × 4 km)

| Bande | Altitude (m) | Sol / texture dominante | Végétation | Roche | Brume |
|---|---|---|---|---|---|
| **Fonds marins** | < −2 | sable immergé, algues | — | `rock_coast` immergé | couleur de l'eau selon profondeur (§5) |
| **Rivage** | −2 à 3 | sable, galets, vase (marais) | palmiers, roseaux | galets polis | brume de mer 0–6 m au matin |
| **Basses terres** | 3 à 40 | herbe, sable, boue | prairies, marais, oasis | blocs isolés | brouillard de vallée à l'aube (sous 20 m) |
| **Collines** | 40 à 120 | herbe + terre | bosquets, forêts | affleurements moussus | faible |
| **Plateaux / mesas** | 120 à 250 | herbe rase, grès, dalles | arbres isolés, arbustes | falaises à strates sur les bords | faible, vent visible |
| **Moyenne montagne** | 250 à 380 | roche + herbe alpine | conifères, mélèzes | éboulis, falaises | bancs de nuages accrochés aux flancs |
| **Limite des arbres** | ≈ 380 | transition | derniers pins, rabougris | | |
| **Haute montagne** | 380 à 520 | roche nue, névés | lichens | granite, crêtes | **plafond nuageux** vers 450 m |
| **Neiges éternelles** | > 520 (Givreval) · jamais au sud | neige, glace | — | rochers enneigés | neige soufflée sur les arêtes |

Règles liées :
- **La limite des arbres et la limite des neiges baissent vers le nord** (−60 m à Givreval, +80 m au désert, où il
  n'y a pas de neige). Le mélange de textures de terrain se fait selon **altitude + pente + biome**, pas selon
  l'altitude seule.
- **Pente > 40°** : toujours de la roche (texture de falaise du biome), jamais d'herbe, même en basse altitude.
  **Pente 25–40°** : mélange roche + sol, herbe clairsemée (densité × 0,3). Replats en haut des falaises : herbe
  ou mousse (lecture « sommet »).
- **Perspective aérienne** : plus un sommet est loin, plus il prend la couleur du ciel du biome ; un sommet enneigé
  garde toujours son blanc (il sert de repère).

### 3.2 Formes de relief et leur signature visuelle

| Forme | Où | Signature visuelle | Assets |
|---|---|---|---|
| **Pic / aiguille** | Givreval, volcan | silhouette triangulaire, neige ou fumée au sommet, visible à 2 km | terrain + `cliff_granite`, `snow_cornice` |
| **Crête** | entre régions | ligne dentelée, neige soufflée, sentier en lacets | `cliff_granite`, `rock_snow` |
| **Plateau / mesa** | hauts plateaux, désert | dessus plat herbeux ou sableux, bords verticaux à strates | `cliff_sandstone`, `cliff_canyon` |
| **Falaise** | côte, canyon, montagne | face verticale texturée, cascade éventuelle, base d'éboulis | `cliff_*` du biome + `rock_scree` |
| **Canyon / gorge** | Canyon des Tessons | strates colorées, fond ombragé, rivière, ponts | `cliff_canyon`, `bridge_rope` |
| **Vallée** | prairies, forêt | rivière au fond, brouillard à l'aube, routes | terrain |
| **Col** | passages entre régions | encoche dans la crête, cairns, porte ou tour de guet | `cairn`, `watchtower` |
| **Dune** | désert | crête douce côté vent, pente raide côté abri, ondulations fines (normale de détail) | terrain `sand` + `dune_ripple` |
| **Colline** | Val de Brumeval | rondeurs herbeuses, ruine ou arbre isolé au sommet | terrain + `ruins_*` |
| **Cuvette / lac** | partout | eau calme, berge de roseaux ou de galets | eau + `reeds` |
| **Cratère / caldeira** | Mont Braisier | anneau noir, lueur rouge au centre, fumée | `cliff_basalt`, lave |
| **Falaise marine / île** | côte | aiguilles dans l'eau, écume à la base | `rock_sea_stack`, `cliff_coast` |

**Point de vue** : chaque sommet accessible offre une vue dégagée sur au moins deux régions (c'est la récompense de
l'escalade). Le cartographe place les points de vue ; l'art s'engage à laisser ces axes libres d'arbres.

---

## 4. Lumière par moment de la journée

Les ciels existants (`client/public/env/manifest.json`) : `sky_day`, `sky_golden`, `sky_night`, `sky_overcast`.
Le cycle proposé (durée totale ≈ 48 min réelles) :

| Moment | Part du cycle | Soleil (couleur / élévation) | Ombres | Brouillard | Nuages | Ambiance |
|---|---|---|---|---|---|---|
| **Aube** | 10 % | `#FFB88A` / 0–8° | longues, bleu-violet | brouillard de vallée dense, rosé `#E8C8C0` | bas, roses dessous | calme, oiseaux, rosée scintillante |
| **Matinée** | 15 % | `#FFF0D8` / 8–35° | nettes, bleutées | se dissipe | cumulus se forment | clair, lisible |
| **Midi** | 20 % | `#FFFFFF` / 35–70° | courtes, les plus sombres | minimum | tours de cumulus | combat lisible, couleurs franches |
| **Après-midi / heure dorée** | 15 % | `#FFC878` → `#FF9A48` / 25–5° | longues, chaudes | or `#F2D09A`, rayons de lumière | bords dorés, dessous gris-violet | **l'image signature du jeu** |
| **Crépuscule / heure bleue** | 10 % | sous l'horizon, ciel `#F29A6A` → `#4A5AA0` | aucune franche | lilas `#9A8AB0` | rose puis gris | lanternes s'allument (émissifs × 1) |
| **Nuit** | 30 % | lune `#9AB8E8` / intensité 0,15 | douces, bleues | bleu nuit `#1E2A40` | gris-bleu éclairés par la lune | feux, lucioles, runes plus visibles |

Modificateurs par biome (multiplient ou teintent la base) :
- **Désert** : midi plus blanc, ombres plus violettes ; nuit plus claire (sable qui réfléchit), étoiles × 1,5.
- **Côte** : aube et crépuscule plus saturés (roses et lilas), reflet du soleil sur la mer (spéculaire fort).
- **Grande forêt** : ambiance verte × 0,6, rayons de lumière actifs de 8 h à 17 h.
- **Bois perdus** : moment de la journée presque invisible (brume), nuit plus sombre, feux follets.
- **Givreval** : ambiance × 1,3, ombres bleues saturées, heure dorée très rose sur la neige (alpenglow `#F2A0A0`).
- **Volcan** : ciel orangé toute la journée, nuit rougeoyante.
- **Marais** : lumière plate, brume permanente, lucioles la nuit.

Météo (VFX CX-6 déjà validés : `rain_streaks`, `rain_splash`, `snowflakes`, `sandstorm`, `fog_wisps`,
`lightning_flash`, `embers`) : chaque biome a une météo « signature » — pluie d'orage (prairies, forêt), tempête de
sable (désert), blizzard (Givreval), pluie de cendres (volcan), brume (marais, bois perdus), grain de mer (côte).

---

## 5. Eau

| Type | Couleur (peu profond → profond) | Surface | Bord | Effets |
|---|---|---|---|---|
| **Lagon turquoise** | `#9FEADB` → `#3FC6C8` → `#1E8FB0` | petites vagues, très transparente (fond visible jusqu'à 4 m), caustiques au fond | sable mouillé sombre, bande d'écume qui avance et recule | caustiques animées, reflets du ciel faibles |
| **Mer profonde** | `#1E8FB0` → `#15557E` → `#0C2E4E` | houle (2 ou 3 ondes de Gerstner), crêtes d'écume | déferlantes sur les rochers | embruns, écume, mouettes |
| **Lac** | `#6EB0B8` → `#2E6A80` | calme, reflet net du ciel et des arbres | roseaux, galets | nénuphars, brume à l'aube |
| **Rivière** | `#7AC0B0` → `#3A7A80` | carte de flux (sens du courant), écume dans les rapides | galets, sable | éclaboussures sur les rochers |
| **Marais** | `#4A5A3E` → `#243020` (opaque) | quasi immobile, lentilles d'eau | vase | bulles, brume basse |
| **Canaux du désert** | `#5CC4D2` | calme et clair | pierre taillée | filets d'eau qui tombent |
| **Lave** | émissif `#FFD27A` → `#FF6A1A`, croûte `#2A1410` | lente, croûte qui se fragmente | roche noire rougeoyante | braises, chaleur, fumée |

**Cascades** : deux couches — une nappe (maillage en ruban avec texture de coulée qui défile, `Waterfall*`) et un
nuage d'embruns en bas (VFX `waterfall_mist`) + arc-en-ciel discret quand le soleil est dans le dos du joueur (option).
Les cascades du désert sont **fines et hautes** (filets), celles des montagnes **larges et blanches**.

La profondeur de l'eau doit être lisible pour le joueur : **zone non praticable = bleu nettement plus sombre**
(`isWalkable` → la limite se voit).

---

## 6. Végétation, herbe et vent

### 6.1 Teinte par instance (économie d'assets)
Chaque matériau `Leaf*` / `Foliage*` / `Grass*` exporté en baseColor **neutre et assez clair**, le client multiplie par
une teinte d'instance choisie selon le biome. Une même essence couvre ainsi plusieurs biomes :
`tree_oak` → vert (Val) · or (Aldmar, en attendant `tree_oak_autumn`) · vert sombre (forêt) · noirâtre (bois perdus).
On ne crée un nouveau modèle que si la **silhouette** change (palmier courbé, arbre géant, arbre mort torsadé).

### 6.2 Herbe par biome (touffes instanciées, matériau `Grass*`)

| Biome | Type | Hauteur | Densité (brins/m², proche) | Teintes (base / pointe) | Vent |
|---|---|---|---|---|---|
| Val de Brumeval | herbe haute souple | 0,5–0,8 m | 40 | `#4F8A2E` / `#B6DC5E` | fort, vagues larges |
| Champs d'Aldmar | graminées + épis | 0,6–1,0 m | 30 | `#B8861A` / `#F7D860` | moyen, épis qui se balancent |
| Grande forêt | herbe douce + fougères | 0,6 m | 30 clairière / 10 couvert | `#3E6E2A` / `#9CC84A` | faible |
| Bois perdus | herbe moyenne | 0,4 m | 25 | `#22402A` / `#6A9A5A` | très faible |
| Désert | oyat (touffes isolées) | 0,5 m | 0,5 (touffes) | `#9A8A50` / `#D8CC8A` | fort, rafales |
| Côte | herbe dure | 0,3 m | 15 | `#6E8A4A` / `#C8C88A` | fort, constant (vent de mer) |
| Givreval | herbe rase jaunie | 0,15 m | 20 | `#7A7040` / `#C8BC80` | fort |
| Marais | roseaux + herbe humide | 1,2 m / 0,3 m | 5 / 20 | `#5A6A3A` / `#B0AA6A` | faible |
| Volcan | touffes sèches | 0,3 m | 2 | `#5A4A3A` / `#9A8A6A` | chaud, irrégulier |

Le vent a une **direction dominante par région** (fixée avec le cartographe) : palmiers penchés, dunes, herbe et
neige soufflée l'indiquent tous dans le même sens.

### 6.3 Particules d'ambiance (toujours actives, coût faible)
Val : pollen blanc, papillons · Aldmar : feuilles dorées qui tombent, poussière lumineuse · Forêt : particules dans
les rayons, feuilles vertes · Bois perdus : feux follets, spores · Désert : grains de sable rasants · Côte : embruns,
mouettes · Givreval : neige soufflée · Volcan : cendres, braises · Marais : lucioles, bulles, moustiques (points noirs).

---

## 7. Architecture par région

### 7.1 Règles communes
- Toutes les structures sont **usées** : arêtes émoussées, saleté en bas des murs, mousse/lichen/sable/neige sur les
  faces horizontales selon le biome (couche automatique du kit, couleur du biome).
- Grille de 4 m pour les kits modulaires (comme CX-4 et CX-11) ; pièces qui s'emboîtent sans jointure visible.
- Chaque ville a **un bâtiment repère** visible de loin (phare, tour-fontaine, beffroi…).

### 7.2 Style par lieu
| Lieu | Matériaux | Formes | Accent |
|---|---|---|---|
| Brumeval | colombages, ardoise, pierre sèche | toits pentus, pignons | lanternes chaudes, bannière de la Brume |
| Port-Salin (CX-5) | bois délavé, cordages, bardeaux | pilotis, pontons, entrepôts | phare, filets, peinture turquoise |
| Sablardent (ville du désert) | pisé, grès, tissus | murs épais arrondis, terrasses, arcs brisés, bassins en hauteur | toiles rouge/safran/sarcelle, filets d'eau |
| Village de Givreval | rondins sombres, lauzes | toits lourds, murs bas, cheminées | fumée, bannières laine rouge sombre |
| Ruines d'Aldmar | pierre grise en gros appareil | créneaux, tours carrées, escaliers monumentaux | runes cyan, lichen or |
| Marais | bois pourri, chaume | pilotis, cabanes basses | lanternes vertes |
| Camp gobelin / bandits | peaux, pieux, bric-à-brac | palissades | crânes, feux |

---

## 8. Nuages volumétriques et ciels

### 8.1 Rendu (pour `render-souls`, proposition)
Couche de nuages en *ray-marching* à basse résolution (¼ d'écran, reprojection temporelle), entre 180 m et 900 m
au-dessus du niveau de la mer, pilotée par : une texture de bruit 3D (forme), un bruit de détail (érosion des bords),
une **carte météo** 2D couvrant le monde (couverture + type de nuage par région). Réglage « bas » : dôme de ciel
avec cartes de nuages peintes (couches qui défilent) + imposteurs de cumulus. Les nuages projettent des **ombres
mouvantes** sur le terrain (même carte, échantillonnée au sol) : c'est l'effet le plus rentable pour l'échelle.

### 8.2 Look par biome et moment

| Région | Type | Couverture | Base / sommet | Couleur jour | Couleur heure dorée |
|---|---|---|---|---|---|
| Prairies, Aldmar | tours de cumulus | 25–40 % | 250 / 800 m | blanc `#FFFFFF`, dessous `#A8B4C8` | sommets `#FFD8A0`, dessous `#8A7A98` |
| Côte, mer | cumulus plats + bancs bas | 20–30 % | 150 / 400 m | blanc, dessous `#B8C8D8` | rose `#F2C0A8`, lilas `#C9B3D6` |
| Désert | voile d'altitude, cirrus | 5–15 % | 700 / 900 m | `#F2EEE4` translucide | or pâle `#F2D8A8` |
| Grande forêt | cumulus + brume basse dans la canopée | 35 % | 250 / 700 m | blanc | or chaud |
| Givreval | plafond bas + **mer de nuages** sous les pics | 60–80 % | 350 / 550 m | blanc bleuté `#E8F0F8` | rose alpenglow `#F2A0A0` |
| Volcan | panache sombre + nuages de cendre | 50 % | 300 / 900 m | `#4A4040` | dessous rouge `#C05030` (lave) |
| Marais | stratus gris | 70 % | 200 / 400 m | `#B0B8B0` | `#C8B090` terne |
| Tempête (météo) | cumulonimbus | 90 % | 150 / 900 m | `#5A6068` | — |

### 8.3 Textures de ciel à produire (lookdev)
Nouveaux ciels HDR (même format que `env/manifest.json`) : `sky_dawn`, `sky_dusk`, `sky_storm`, `sky_desert`,
`sky_snow`, `sky_ash` (volcan). Textures de nuages : `env/clouds/cloud_shape.webp` (bruit Perlin-Worley 128³ rangé
en atlas 2D), `env/clouds/cloud_detail.webp` (32³), `env/clouds/weather_map.webp` (couverture/type sur le monde),
`env/clouds/cloud_layers_*.webp` (couches peintes pour le réglage bas), `env/clouds/cumulus_impostor_*.webp`.

---

## 9. Textures de terrain par biome

Format identique à l'existant (`textures/terrain/grass_albedo|normal|orm|height.webp`, tuilables, 1024 ou 2048).
Chaque biome utilise 4 à 6 couches mélangées selon altitude + pente + masque de biome + chemins.

| Jeu (clé) | Biomes | Priorité |
|---|---|---|
| `grass_lush` (≈ `grass` actuel) | Val, forêt | P0 (existe) |
| `grass_golden` | Aldmar | P0 |
| `grass_dry` | côte, plateaux, canyon | P1 |
| `dirt_path` | routes, sentiers | P0 |
| `cobble` | villes | P1 |
| `forest_floor` (humus + feuilles) | forêt, bois perdus | P0 |
| `moss` | forêt, bois perdus, ruines | P1 |
| `sand_dune` (ondulations fines) | désert | P0 |
| `sand_beach` / `sand_wet` | côte | P0 |
| `sandstone` (strates) | désert, canyon | P0 |
| `rock_cliff` (calcaire) | Val, côte | P0 |
| `rock_red_strata` | canyon | P1 |
| `granite` | Givreval, montagne | P1 |
| `snow` / `ice` | Givreval | P1 |
| `mud` | marais | P1 |
| `ash` / `basalt` | volcan | P2 |
| `pebbles` | rivières, rivage | P1 |

Plus deux textures d'effet : `caustics.webp` (flipbook caustiques pour l'eau peu profonde) et
`foliage_cookie.webp` (projection de taches de feuillage en forêt).

---

## 10. Liste des assets à produire (nouveaux biomes)

Priorités : **P0** = nécessaire pour que le biome existe à l'ouverture de la carte v0.3 ; **P1** = richesse attendue à
la sortie v0.3 ; **P2** = finitions v0.3.x / v0.4. Propriétaires : agents Claude Blender (noms de la vague 1 : 
`assets-nature`, `assets-props`, `assets-town`, `lookdev`, `render-souls`) ou **Codex** (tâches `CX-*`, voir
`docs/CODEX_BRIEF.md`). Budgets et LOD : ROADMAP §4.4. Les clés **déjà existantes** sont marquées (existe).

### 10.1 Végétation — `assets-nature` (Claude)

| Clé | Description | Biome | Prio |
|---|---|---|---|
| `tree_palm` (existe) | palmier droit | désert, côte | P0 (contrôle qualité) |
| `tree_palm_bent` | palmier courbé vers la mer, tronc annelé | côte, oasis | P0 |
| `tree_palm_cluster` | touffe de 3 palmiers de hauteurs différentes | côte, oasis | P1 |
| `tree_palm_young` | jeune palmier bas (1,5 m) | oasis, côte | P2 |
| `cactus` (existe) | cactus à bras | désert | P0 (contrôle) |
| `cactus_round` | cactus en boule + `cactus_flower` émissif léger | désert | P1 |
| `tree_acacia` | acacia en parasol | plateaux, désert | P1 |
| `dune_grass` | touffe d'oyat (`Grass*`) | désert, dunes côtières | P0 |
| `plant_agave` | agave / aloès | désert | P1 |
| `plant_bigleaf` | plante tropicale à grandes feuilles | côte, oasis | P0 |
| `plant_fern_palm` | petit palmier-fougère | côte | P1 |
| `tree_oak_autumn` | chêne à feuillage d'automne (nouvelle couronne plus clairsemée) | Aldmar | P1 (P0 = teinte) |
| `tree_ancient` | arbre géant moussu 25–35 m, racines, LOD imposteur | grande forêt | P0 |
| `tree_beech` | hêtre au fût lisse gris | forêt | P1 |
| `plant_fern` | fougère (touffe) | forêt, bois perdus | P0 |
| `root_arch` | racine géante en arche (traversable) | forêt | P1 |
| `tree_dead_gnarled` | arbre mort torsadé à branches griffues | bois perdus, marais | P0 |
| `tree_mangrove` | arbre à racines-échasses | marais | P1 |
| `plant_lily` | nénuphars et lentilles | marais, lacs | P1 |
| `tree_larch` | mélèze doré | Givreval (moyenne montagne) | P1 |
| `shrub_alpine` | arbuste bas rabougri | haute montagne | P2 |
| `tree_charred` | arbre calciné | volcan | P2 |
| `tree_juniper` | genévrier tordu | canyon | P2 |
| `tree_pine_sea` | pin parasol | caps de la côte est | P2 |
| `grass_tuft_<biome>` | touffes d'herbe pour l'instanciation (`lush`, `golden`, `dry`, `dark`) | tous | P0 (lien avec `render-souls`) |

### 10.2 Roches et falaises — `assets-nature` (Claude)

| Clé | Description | Prio |
|---|---|---|
| `rock_desert` (existe), `cliff_a` (existe) | contrôle de cohérence avec les palettes | P0 |
| `cliff_sandstone` | falaise de grès à strates horizontales, modulaire (3 variantes) | P0 |
| `rock_arch` | arche naturelle de grès | P1 |
| `rock_hoodoo` | cheminée de fée | P1 |
| `rock_coast` | rocher arrondi poli par la mer | P0 |
| `cliff_coast` | falaise marine grise avec cavités | P0 |
| `rock_sea_stack` | aiguille rocheuse dans la mer | P1 |
| `cliff_granite` | falaise de granite (montagne) | P1 |
| `rock_scree` | éboulis (dalle d'instances) | P1 |
| `rock_ice`, `snow_cornice` | bloc de glace, corniche de neige | P1 |
| `cliff_canyon` | falaise à strates rouges, modulaire | P1 |
| `rock_basalt`, `cliff_basalt` | orgues basaltiques | P2 |
| `rock_lava_crust` | croûte de lave (émissif dans les fissures) | P2 |
| `rock_mossy_boulder` | gros bloc moussu de forêt | P1 |

### 10.3 Structures

**Codex** (travail Blender détaillé, kits modulaires) :

| Tâche | Contenu | Prio |
|---|---|---|
| **CX-5 Port-Salin** (déjà dans la file) | `port_*` — ajouter en complément proposé : `port_stilt_house` (maison sur pilotis), `port_lantern_string` (guirlande de lanternes), `port_market_stall` | P0 |
| **CX-10 Arbre-Brume** (déjà dans la file) | `landmark_brume_tree` + imposteur ; halo et brume dorée gérés par le client | P0 |
| *Proposition* **CX-13 Sablardent** (ville du désert) | kit grille 4 m : `desert_wall`, `desert_wall_corner`, `desert_gate` (arc brisé), `desert_house_a`, `desert_house_b`, `desert_tower_basin` (tour-bassin avec filet d'eau), `desert_stairs`, `desert_awning` (toile, matériau `Cloth*`), `desert_canal`, `desert_well`, `desert_market`, `desert_lantern` (émissif), `desert_pottery`, `sand_sled` (char à sable, décor ou future monture) | P0 (murs, maisons, porte, canal) / P1 (reste) |
| *Proposition* **CX-14 Ruines d'Aldmar** | kit grille 4 m : `ruins_rampart`, `ruins_rampart_corner`, `ruins_tower_square`, `ruins_stairs_grand`, `ruins_block` (bloc éboulé), `ruins_standing_stone` (pierre dressée, runes cyan émissives, remplace le rôle de l'`obelisk` pour les points de repère), `ruins_statue_broken` | P1 |
| *Proposition* **CX-15 Village de Givreval** | `snow_house`, `snow_longhall`, `snow_palisade`, `snow_bridge`, `snow_banner` (`Banner*`) — complète `snow_cabin` | P1 |

**Claude** (`assets-props` / `assets-town`) :

| Clé | Description | Prio |
|---|---|---|
| `desert_ruin` (existe), `swamp_hut` (existe), `snow_cabin` (existe), `ruins_pillar/arch/wall` (existent), `obelisk` (existe) | contrôle palette + usure par biome | P0 |
| `bridge_rope` | pont de corde (canyon) | P1 |
| `cairn` | cairn de pierres (cols, sentiers de montagne) | P1 |
| `swamp_boardwalk` | ponton de planches modulaire | P1 |
| `swamp_lantern` | lanterne de verre vert (émissif) | P1 |
| `druid_altar` | autel de pierre moussu | P2 |
| `shipwreck` | épave échouée sur la plage | P2 |
| `red_zone_banner`, `brazier` | marqueurs des zones rouges | P1 |

### 10.4 Terrain, ciels, nuages — `lookdev` (Claude), rendu — `render-souls` (Claude)
- Jeux de textures de terrain : tableau §9 (`lookdev`).
- Ciels `sky_dawn`, `sky_dusk`, `sky_storm`, `sky_desert`, `sky_snow`, `sky_ash` (`lookdev`, P1 ; `sky_dawn`/`sky_dusk` P0 pour le cycle).
- Textures de nuages `env/clouds/*` (`lookdev`, P0) ; moteur de nuages volumétriques + ombres de nuages (`render-souls`, P0).
- Eau : shader profondeur/turquoise, houle, écume de rivage, carte de flux des rivières, caustiques (`render-souls`
  P0 ; textures `water_normal_a/b.webp`, `foam.webp`, `caustics.webp`, `flow_noise.webp` par `lookdev`).
- Mélange de terrain altitude + pente + biome (§3) et brouillard de hauteur par biome (`render-souls`, P0).
- Table de réglages par biome (couleurs de brouillard, teintes d'herbe, vent, particules) : un fichier de données
  proposé `shared/biomes.js` ou `client/src/biomes.json` — **à décider par les agents de code**, ce document fournit
  les valeurs.

### 10.5 VFX (planches Blender, format `client/public/vfx/manifest.json`) — `lookdev` (Claude)
Déjà validés par Codex (CX-6) : `rain_streaks`, `rain_splash`, `snowflakes`, `sandstorm`, `fog_wisps`,
`lightning_flash`, `embers`.

| Clé | Description | Prio |
|---|---|---|
| `sand_gust` | rafale de sable rasante (dunes) | P0 |
| `sea_spray` | embruns sur les rochers | P0 |
| `shore_foam` | écume de vague (texture qui avance/recule) | P0 |
| `waterfall_sheet` | coulée de cascade (texture défilante pour la nappe `Waterfall*`) | P0 |
| `waterfall_mist` | embruns au pied des cascades | P0 |
| `leaves_fall_gold` / `leaves_fall_green` | feuilles qui tombent | P0 / P1 |
| `fireflies` | lucioles (marais, bois, nuit) | P1 |
| `godray_motes` | poussière dans les rayons de lumière | P1 |
| `wisp_lost` | feu follet bleu-vert | P0 (bois perdus) |
| `pollen_gold` | pollen lumineux (Arbre-Brume, Aldmar) | P1 |
| `snow_blow` | neige soufflée sur les arêtes | P1 |
| `ash_fall` | pluie de cendres | P2 |
| `lava_bubble` | bulle de lave qui éclate | P2 |
| `swamp_bubbles` | bulles de marais | P2 |
| `heat_haze` | ondulation de chaleur (texture de distorsion, pas un flipbook) | P1 |
| `seagulls` / `butterflies` | petits oiseaux et papillons en cartes animées | P2 |
| `rune_glow` | pulsation cyan des pierres d'Aldmar | P1 |

### 10.6 Répartition résumée
- **Claude Blender** : végétation et roches de tous les biomes (`assets-nature`), petits props et marqueurs
  (`assets-props`), terrain, ciels, nuages, eau, VFX (`lookdev`), intégration rendu (`render-souls`).
- **Codex** : kits de ville et d'architecture détaillés — Port-Salin (CX-5), Arbre-Brume (CX-10), et, si validé,
  Sablardent (CX-13), Ruines d'Aldmar (CX-14), Village de Givreval (CX-15). Ordre conseillé après CX-10 et CX-5 :
  **CX-13 → CX-14 → CX-15** (le désert est le biome le plus demandé par l'utilisateur).

---

## 11. Contrôle visuel (directeur artistique)
Pour chaque biome, avant validation :
1. **Vignette 64 px** d'une vue typique : le biome doit se reconnaître à sa seule couleur.
2. **Vue lointaine à 1 km** : on voit le repère vertical de la région et l'Arbre-Brume.
3. **Test de télégraphe** : une attaque télégraphiée est lisible sur le sol du biome, de jour comme de nuit.
4. **Quatre moments** (aube, midi, heure dorée, nuit) rendus côte à côte.
5. **Performance** : densité d'herbe et d'arbres respectée au réglage « moyen » (60 i/s visés sur machine moyenne).
6. **Originalité** : aucune forme, aucun nom ni aucun motif ne doit rappeler directement les références.
