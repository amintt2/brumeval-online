# Cartographie du monde v0.3 : topographie et grandes régions (brouillon du cartographe)

> Demande de l'utilisateur : « un monde ouvert à la Zelda, **super grand et varié** : le désert à palmiers en bas à
> gauche, un côté prairie, un côté mer, un côté forêt… », et que **le cartographe dessine la topographie** (le relief
> et ses courbes de niveau), comme sur la carte de référence.
>
> Livrables de ce brouillon (tous générés par un script Node **déterministe**, relançable) :
>
> | Fichier | Contenu |
> |---|---|
> | `topo.png` | **Carte topographique** 2048 × 2048 (2,25 m/px) : ombrage du relief, teintes d'altitude et de biome, courbes tous les 10 m (50 m en gras), eau, routes, zones rouges, sommets, cols, villes, waypoints, donjons |
> | `heightmap.png` + `heightmap.json` | **Carte des hauteurs du monde entier** : PNG 16 bits, 1025 × 1025 échantillons, 4,5 m entre échantillons, `mètres = valeur × 0,01 − 60` |
> | `carto.json` | Régions, villes, waypoints, donjons, sommets et cols mesurés, rivières (profil de surface), lacs (niveaux), côtes, îles, routes (longueur, pente, ponts), temps de trajet, **carte de contrôle 144 × 144 (32 m)** |
> | `tools/world_spec.mjs` | La **source unique** faite à la main : ancres d'altitude, lignes de crête, sommets, volcan, plateaux, mesas, côte, lagons, îles, rivières, lacs, ravins, routes, régions |
> | `tools/gen_world.mjs` | Le générateur (façonnage → érosion → lacs → rivières → villes → routes → contrôles → sorties) |
> | `tools/render_topo.mjs`, `png.mjs`, `font.mjs` | Rendu de la carte, encodeur PNG et petite police, sans dépendance |
> | `tools/out/` | Pour la relecture : `slope.png` (carte des pentes), `crop_*.png` (zooms), `last_run.log` |
>
> Regénérer (≈ 4 à 7 min, dont 1 min de rendu) : `node docs/world/drafts/tools/gen_world.mjs`
> (`--quick` : 1 seul trajet calculé et carte 1024 px ; `--no-render` : sans image).

---

## 1. Taille et repère

### 1.1 Recommandation : 4,1 × 4,1 km jouables, prêts à passer à 8 × 8 km

| | Valeur | Raisonnement |
|---|---|---|
| Zone jouable | **x ∈ [−2048, 2048], z ∈ [−2560, 1536]** : 4096 × 4096 m (16,8 km², ≈ 130 fois la carte actuelle) | Même chiffre que l'architecte technique (`tech.md` §1) |
| Carte des hauteurs | x ∈ [−2304, 2304], z ∈ [−2808, 1800] : 4608 m, soit 256 m de décor en plus de chaque côté (mer au sud et à l'est, murailles de montagnes au nord et à l'ouest) | On voit l'horizon sans pouvoir y aller |
| Brumeval | reste en **(0, 0)**, au centre-sud (à 1,5 km du bord sud et 2,5 km du bord nord) | Aucune position enregistrée ne change |
| Traversée à pied | bord à bord : 4,1 km / 6,5 m/s ≈ **10,5 min** ; diagonale ≈ 15 min | Assez pour « partir à l'aventure » sans lasser, avec 26 pierres de téléportation |
| Sprint | 9,4 m/s en pointe, mais l'endurance (100, −18/s, +35/s après 0,8 s) donne **≈ 8,3 m/s en moyenne** en alternant sprint et course | Calcul dans `carto.json → travel.speeds` |
| Monture (v0.4) | 14 m/s visés → traversée en ≈ 5 min | Le monde reste « grand » même à cheval, sans être vide |
| Passage à 8 × 8 km | on **ajoute des tuiles** de hauteurs autour (même format, même repère) ; l'index des morceaux de 64 m tient sur ±64 par axe (`tech.md`) | Les nouvelles terres se posent **au-delà des murailles du nord et de l'ouest** (on ouvre un col) et **au large** (archipel lointain au sud-est, accessible en bateau depuis Port-Salin) |

Comparaison : la carte de référence (TotK) fait ≈ 12 km de côté mais repose sur le vol et l'escalade. Sans planeur ni
escalade, 4 km bien remplis se parcourent comme 8 à 10 km chez Zelda ; le relief (cols, plateaux, canyons) allonge
volontairement les trajets à pied (chemins réels = 1,05 à 1,2 fois la ligne droite, voir §9).

### 1.2 Repère et transformation des anciennes positions

- Mêmes conventions que `shared/world.js` : x vers l'est, **z vers le sud** (le nord est en haut, −z), y vers le haut,
  unité = 1 m. **Aucune transformation de x/z** : les comptes enregistrés (x, z) restent valides, Brumeval, le camp
  gobelin, le cimetière et l'antre du Golem ne bougent pas.
- Altitude : le **niveau de la mer vaut 0**. L'ancien carré de 360 m est **relevé de +45 m** (`LEGACY.lift`) : le
  village est à 46,2 m, sur la plaine qui descend doucement vers la mer (1,2 km au sud). Les positions enregistrées
  n'ont pas de y (il est recalculé), rien à migrer.
- Raccord : `w = 1 − smoothstep(170, 450, max(|x|, |z|, 0,8·√(x²+z²)))`, puis
  `h = lerp(carte, ancienneHauteur(x, z) + 45, w)`. Dans |x|, |z| ≤ 160 (l'ancien `WORLD_LIMIT`) : w ≥ 0,99,
  le relief est celui d'aujourd'hui. La forme arrondie du fondu évite qu'on devine un carré dans le paysage.
  L'ancienne muraille de bordure (145–180 m) disparaît. Les 3 anciens lacs ont leur eau à −1,2 + 45 = **43,8 m**.
- ⚠ À arbitrer avec `tech.md` §2.2, qui propose +32 m et un fondu 200→260 m : j'ai choisi **+45 m** pour que la
  Salinelle et la route de Port-Salin aient une pente naturelle jusqu'à la mer, et un fondu **plus large** (170→450 m)
  parce qu'un fondu de 60 m laissait un carré visible sur la carte. Un seul chiffre à changer dans `world_spec.mjs`.

---

## 2. Vue d'ensemble : la géographie en une phrase par côté

Le monde est une **grande terre inclinée du nord-ouest (haut, froid) vers le sud-est (bas, tropical)**, comme la
carte de référence : les neiges et le volcan au nord, les prairies au centre, la mer et ses îles au sud et à l'est,
le désert en bas à gauche.

- **Nord-ouest** — les **Pics de Givreval** : chaîne enneigée de 300 à 400 m, lac glaciaire, village de Rochegivre.
- **Nord** — la **Sylve Ancienne**, forêt vallonnée à 100–160 m, avec au centre la cuvette brumeuse des **Bois des Égarés**.
- **Nord-est** — le **Mont Brasier**, volcan de 380 m à cratère de lave, et les **Terres de Cendre**.
- **Centre** — le **plateau d'Aldmar** (falaises de 50 m), ses ruines dorées et **l'Arbre-Brume** au sommet (≈ 300 m
  d'altitude à la cime) : on le voit de partout.
- **Ouest** — les **Hauts-Plateaux de Rougecrête**, roche rouge en terrasses à 190–260 m, fendus du nord au sud par le
  **Canyon de l'Entaille**.
- **Sud-ouest (en bas à gauche)** — le **Désert de Sable-Rouge** : dunes, palmiers, oasis, ville d'**Ambresable** au pied
  des chutes, **Mer de Dunes** géantes au bord de l'océan.
- **Centre et centre-ouest** — les **prairies** : Val de Brumeval (départ), Prairies de Mordoré dorées, Rives du Lac des Songes.
- **Est** — les **Landes de Ventfauve**, puis le **Marais de Brumenoire** au niveau de la mer et les **Falaises des Embruns**.
- **Sud et sud-est** — la **mer** : Côte de Port-Salin (plages, falaises blanches, port) et l'**Archipel d'Azurine**
  (lagons turquoise, palmiers, îles reliées par des bancs de sable).

### Ce qu'on retient des images de référence (sans rien copier)

| Image | À retenir pour Brumeval |
|---|---|
| 1 (carte du monde) | Une quinzaine de régions **lisibles par leur relief** ; des **rivières qui partent des montagnes et finissent toutes en mer** ; montagnes aux bords, plaine au centre ; hauts plateaux désertiques à l'ouest ; marais à l'est ; côte découpée et îles au sud-est ; un repère central (le château → pour nous le plateau d'Aldmar et l'Arbre-Brume) |
| 2 (prairie, ruines, grand monstre) | Grandes étendues ouvertes où un monstre géant se voit de loin → Mordoré et Ventfauve gardent des **lignes de vue de 1 à 2 km** (collines basses, pas de murs) |
| 3 (prairie dorée d'automne) | Palette **or et ambre** des Prairies de Mordoré et des Landes de Ventfauve |
| 4 (champ de ruines doré, pierre lumineuse) | Le plateau d'Aldmar : herbes dorées, **pierres-runes qui brillent** comme repères de nuit |
| 5 (ville du désert, palmiers, cascades) | Ambresable **au pied d'une falaise**, alimentée par des **chutes** (les Chutes d'Ambresable, 53 m) et des canaux |
| 6 (char à sable sur les dunes) | Dunes **longues et régulières**, versant au vent en pente douce (< 20°), à parcourir en ligne droite sur 1 km |
| 7 (bois perdus dans la brume) | Bois des Égarés : une **cuvette** fermée où la brume stagne, sentiers qui tournent |
| 8 (forêt avec rayons de soleil) | Sylve Ancienne : sol ondulé, combes, arbres géants, trouées de lumière |
| 9 et 10 (plages tropicales) | Lagons **turquoise peu profonds** (0,4 à 3 m), sable clair, palmiers, îles rondes à portée de vue |

---

## 3. Les régions

Ordre = priorité de test (la première qui contient le point gagne ; sinon la plus proche). Formes exactes dans
`carto.json → regions[].shape` ; aires et altitudes **mesurées** sur la carte générée. Danger : **vert** = ville sûre,
**jaune** = JcE, **rouge** = JcJ libre + sac de butin (ROADMAP §2 bis).

| id | Nom | Biome | Niveaux | Danger | Palier | Aire | Altitude (min / moy / max) | Repères |
|---|---|---|---|---|---|---|---|---|
| `brumeval` | **Val de Brumeval** (départ) | prés verts | 1–10 | jaune (village vert) | T1–T3 | 0,96 km² | 34 / 53 / 112 m | village, Forêt des Murmures, camp gobelin, cimetière, antre du Golem (inchangés) |
| `mordore` | **Prairies de Mordoré** | prairie dorée | 5–12 | jaune | T1–T2 | 1,30 | 25 / 78 / 200 | Relais de Mordoré, Lac Vermeil, Gué de l'Argentine |
| `songes` | **Rives du Lac des Songes** | prairie dorée | 6–12 | jaune | T2 | 0,70 | 0 / 26 / 48 | Lac des Songes, Anse des Songes, Île aux Mouettes |
| `port_salin` | **Côte de Port-Salin** | côte tropicale | 8–14 | jaune (ville verte) | T2 | 1,84 | 0 / 28 / 57 | Port-Salin, embouchure de la Salinelle, falaises blanches |
| `ventfauve` | **Landes de Ventfauve** | lande dorée | 8–14 | jaune | T2 | 0,52 | 8 / 50 / 150 | vallée de la Salinelle, Rampe de l'Est d'Aldmar |
| `sylve` | **Sylve Ancienne** | forêt ancienne | 10–16 | jaune (hameau vert) | T2–T3 | 1,79 | 48 / 122 / 325 | Clairsaule, combes, source de la Brumeuse |
| `azurine` | **Archipel d'Azurine** | côte tropicale | 12–18 | jaune | T3 | 1,75 | 0 / 15 / 48 | Île d'Azurine, lagons, Chaussée des Sables, Plage des Palmes |
| `egares` | **Bois des Égarés** | bois perdus | 14–18 | jaune | T3 | 0,21 | 91 / 105 / 127 | cuvette brumeuse de 25 m, labyrinthe |
| `brumenoire` | **Marais de Brumenoire** | marais | 15–20 | jaune | T4 | 1,03 | 4 / 12 / 128 | pontons, Antre de la Sorcière, delta de la Brumeuse |
| `sable_rouge` | **Désert de Sable-Rouge** | dunes | 15–22 | jaune (ville verte) | T4 | 1,33 | 0 / 44 / 189 | **Ambresable**, Oasis des Mirages, Trois Enclumes, dunes à char à sable |
| `rougecrete` | **Hauts-Plateaux de Rougecrête** | roche rouge, mesas | 16–22 | jaune | T4 | 1,12 | 47 / 189 / 260 | Table du Géant, Mines, Gorge Sèche |
| `entaille` | **Canyon de l'Entaille** | canyon | 18–22 | jaune | T4 | 0,24 | 54 / 159 / 198 | Rivière d'Ambre, Pont de l'Entaille, Chutes d'Ambresable |
| `embruns` | **Falaises des Embruns** | lande côtière | 18–24 | jaune | T4–T5 | 0,40 | 0 / 138 / 289 | Mont Écumeur, Phare des Embruns, falaises marines |
| `givreval` | **Pics de Givreval** | neige, rocaille, pins | 20–25 | jaune (village vert) | T5 | 1,28 | 122 / 232 / 383 | **Rochegivre**, Lac Glacé, Grotte gelée, Dent de l'Hiver, Col du Loup Blanc |
| `cendres` | **Terres de Cendre** | cendres volcaniques | 22–26 | jaune | T5–T6 | 0,98 | 1 / 171 / 283 | Poste des Cendres, Échine de Suie, plage noire du Cendreux |
| `arbre` | **Sanctuaire de l'Arbre-Brume** | champ de ruines doré | 20–30 | **jaune** (îlot de répit dans Aldmar) | T6 | 0,04 | 141 / 173 / 178 | l'Arbre-Brume, waypoint |
| `aldmar` | **Ruines d'Aldmar** | champ de ruines doré | 25–30 | **rouge** | T6 | 0,40 | 77 / 145 / 173 | plateau à falaises, Crypte d'Aldmar, pierres-runes, Bassin des Rois |
| `couronne` | **Couronne de Givre** | neige | 25–30 | **rouge** | T6 | 0,21 | 226 / 325 / 405 | Pic de Givrecime, Géant de givre |
| `coeur_brasier` | **Cœur du Brasier** | cendres | 26–30 | **rouge** | T6 | 0,32 | 151 / 302 / 379 | cratère, lac de lave, Forge engloutie |
| `mer_dunes` | **Mer de Dunes** | dunes | 22–28 | **rouge** | T6 | 0,27 | 1 / 38 / 79 | dunes de 25–40 m, Ver des sables, Tombeau des Sables |
| `epave` | **Île de l'Épave** | côte tropicale | 22–28 | **rouge** | T6 | 0,09 | 0 / 49 / 66 | épave géante, Grotte des Marées (accès en barque) |

Progression : on part du centre-sud (niv. 1–10), on s'écarte en anneaux (prairies et côte 5–14, forêt et archipel
10–18, marais, désert, plateaux 15–22, montagnes et volcan 20–26) ; les **5 zones rouges** (25–30) sont les **cœurs**
des régions extrêmes (sommet, cratère, grand erg, île) plus **Aldmar au centre**, comme le château de la référence :
visible dès le niveau 1, atteignable seulement bien plus tard, et entouré de falaises qui le signalent. Le sanctuaire
de l'Arbre-Brume est un îlot jaune au milieu (on peut y aller voir l'arbre sans être en JcJ, 110 m de rayon, 5 s de
protection à l'entrée comme prévu en §2 bis).

---

## 4. La topographie (livrable principal)

### 4.1 Méthode de façonnage (dans `gen_world.mjs`, dans cet ordre)

1. **Altitude de base des basses terres** : mélange de Shepard à noyau gaussien de 31 ancres (x, z, altitude, rayon)
   posées à la main (plaine 45–85 m, désert 35–45 m, marais 4–6 m…), plus des **collines** (bruit fBm tordu par
   « domain warp » + bruit « ridged » doux : 20 à 45 m d'amplitude, calmées près du départ, nulles dans le marais,
   remplacées par les dunes dans le désert).
2. **Chaînes de montagnes** : 8 lignes de crête (polylignes avec altitude de crête et demi-largeur à chaque sommet),
   profil en cloche, distance tordue pour éviter les « tubes », puis 8 **sommets** coniques et un bruit ridged de
   5 octaves (±45 m) qui dessine les arêtes et les contreforts.
3. **Volcan** : cône concave (150 → 430 m sur 680 m de rayon), ravines radiales, cratère de 95 m de rayon et 62 m de
   profondeur, **brèche** au sud-est (la coulée) qui descend du fond du cratère vers la Forge engloutie.
4. **Plateaux** (Aldmar, Rougecrête, Haut-Rougecrête) : polygones à **bord en falaise** (22–34 m de large, bruité),
   sommet incliné, légèrement bombé ou **en terrasses de 11 m** (roche rouge), **éboulis** au pied des falaises.
   **Mesas** : 7 tables à bords raides dans le désert et sur le plateau. **Cuvette** des Bois des Égarés (−26 m).
5. **Dunes** (désert) : profil asymétrique (70 % de pente douce au vent, 30 % de pente raide sous le vent), crêtes
   orientées NNE-SSO (vent dominant d'ouest-nord-ouest), longueur d'onde 170–300 m, hauteur 8–18 m, **25–40 m dans
   la Mer de Dunes** et contre le bord ouest ; aplani autour d'Ambresable et des oasis.
6. **Marais** : niveau 4 m ± 3 m : tout ce qui passe sous 4 m devient un étang (≈ 45 % de la surface du marais).
7. **Côte** : distance signée au polygone côtier + 3 octaves de bruit (±60 m) ; **plages** en pente de 3 % sur
   ~280 m ; **falaises marines** là où c'est marqué (Embruns, sous le volcan, cap du désert, falaises blanches) ;
   fonds marins jusqu'à −45 m ; **lagons** à −0,4…−3 m ; **7 îles** (plates et sableuses, ou à falaises) ; **3 bancs
   de sable** marchables (0,4 m d'eau) vers l'archipel.
8. **Érosion hydraulique par gouttes** : 380 000 gouttes, 70 pas, pinceau de rayon 2, pondérée par un masque
   (forte en montagne et aux bords des plateaux, nulle dans les dunes, le marais, la mer et l'ancienne carte). Elle
   creuse les ravines des versants et dépose des cônes d'éboulis.
9. **Ravins secs** (8) : combes et gorges taillées dans les plateaux et les versants ; **ce sont les accès naturels**
   aux plateaux (Gorge Sèche, Ravin des Échos, Ravin des Vents) et à la côte des Embruns.
10. **Lacs** : lit en cuvette sous le niveau d'eau + **rebord relevé** (jusqu'à +4 m) pour que l'eau ne « flotte »
    jamais au-dessus du sol.
11. **Rivières** : altitudes du lit écrites à la main, puis **forcées sous le terrain et strictement décroissantes**
    de la source à la mer ; méandres ajoutés de façon déterministe ; profil **en canyon** (fond plat, berges sèches de
    10–20 m, parois à 66°) ou **en vallée** (plaine alluviale, versants à ~9°) ; 7 rivières + l'oued.
12. **Villes, avant-postes, butte de l'Arbre** : aplanissement à l'altitude moyenne du terrain autour (moins de
    déblais/remblais), avec un fondu.
13. **Routes** : profil = terrain lissé, puis **pente limitée** (10 % routes, 14–35 % sentiers) : on calcule deux
    profils faisables (favorisant le déblai, et le remblai) et on prend leur moyenne, qui reste faisable et équilibre
    déblai et remblai ; **ponts** automatiques là où une route croise une rivière (le lit n'est pas remblayé).
14. **Ancienne carte** réappliquée à la fin (après chaque passe qui aurait pu la toucher).

### 4.2 Chaînes, sommets et cols (altitudes **mesurées** sur la carte)

| Relief | Où | Altitudes | Rôle |
|---|---|---|---|
| **Murailles du Nord** | tout le bord nord (z ≈ −2800) | 470–575 m | fond de décor, limite infranchissable |
| **Monts de Bordure** | bord ouest | 330–520 m | limite ouest, se perd dans la Mer de Dunes au sud |
| **Chaîne de Givreval** | de (−2250, −2480) à (−650, −2520) | crête 270–385 m | frontière nord-ouest ; neige au-dessus de 262 m |
| **Contrefort de Blanchecorne** | éperon sud de Givreval | 215–320 m | sépare Givreval de Rougecrête |
| **Crête du Loup** | de la Dent de l'Hiver vers Mordoré | 120–315 m | sépare la vallée de l'Argentine de celle de l'Ambre ; franchie au **Col du Loup Blanc** |
| **Échine de Suie** | entre Sylve et Terres de Cendre | 140–330 m | frontière forêt / cendres ; franchie au **Col des Cendres** |
| **Crêtes Calcinées** | du volcan vers la côte nord-est | 250–300 m | ferment les Cendres au nord |
| **Monts des Embruns** | côte est | 110–289 m | falaises marines ; franchis par la **Brèche des Embruns** |

| Sommet | x, z | Altitude | | Col / passage | x, z | Altitude |
|---|---|---|---|---|---|---|
| **Pic de Givrecime** (zone rouge) | −1650, −2250 | ≈ 382–405 m | | **Col du Loup Blanc** (Mordoré → Rochegivre) | −1070, −1510 | 181 m |
| **Mont Brasier** (bord du cratère) | 1450, −2050 | 379 m (fond 317 m, lave) | | **Col des Cendres** (Sylve → Cendres) | 960, −1900 | 151 m |
| **Dent de l'Hiver** | −1250, −2060 | 356 m | | **Brèche des Embruns** (marais → phare) | 1760, −760 | 78 m |
| **Aiguille Grise** | −880, −2320 | 331 m | | **Gorge Sèche** (Mordoré → plateau de Rougecrête) | −1420, −625 | 130 m |
| **Mont Blanchecorne** | −1900, −1860 | 320 m | | **Escalier d'Ambresable** (désert → canyon, à côté des chutes) | −1330, 150 | 47 → 105 m |
| **Corne du Loup** | −1110, −1720 | 315 m | | | | |
| **Mont Écumeur** | 1850, −1160 | 289 m | | | | |
| **Pic de Suie** | 880, −2350 | 280 m | | | | |
| **Table du Géant** (mesa) | −1850, −800 | 260 m | | | | |
| **Mont Guet** | −1030, −1330 | 200 m | | | | |
| **Butte de l'Arbre-Brume** | −120, −1200 | 178 m (+ arbre de 120 m) | | | | |

Remarque : la demande parlait de sommets « 250–400 m » : c'est respecté (le Pic de Givrecime oscille entre 382 et
405 m selon l'échantillon exact de la cime). Les Murailles du Nord, plus hautes (≈ 500–575 m), ne sont que du décor.

### 4.3 Plateaux, mesas, canyons, vallées

- **Plateau d'Aldmar** (centre) : 148 m ± 10, **falaises de 45–55 m** tout autour, sauf **3 rampes** : la **Voie
  Royale** au sud (depuis Brumeval, grand escalier taillé), la **Rampe de l'Est** (depuis la Salinelle) et la **route
  de la Sylve** au nord. Sur le plateau : ruines, **Bassin des Rois** (155,5 m) et, au sud-ouest, la butte de
  l'Arbre-Brume (178 m). Vue de la cime de l'arbre (≈ 300 m) : tout le monde jusqu'aux deux mers.
- **Hauts-Plateaux de Rougecrête** (ouest) : deux étages, **190 m** puis **Haut-Rougecrête 232 m** à l'ouest, en
  terrasses de 11 m ; **escarpement est** de 90–100 m au-dessus de Mordoré, **escarpement sud** de 140 m au-dessus du
  désert. On y monte par la **Gorge Sèche** et le **Ravin des Échos** (depuis Mordoré), le **Ravin des Vents** (depuis
  le désert) et l'**Escalier d'Ambresable** (depuis la ville).
- **Canyon de l'Entaille** : la Rivière d'Ambre traverse tout le plateau du nord au sud dans une gorge de **60 à 80 m**
  de profondeur, fond plat avec des berges sèches de chaque côté (on le remonte à pied, 2,2 km, du désert jusqu'à
  Rochegivre), le **Pont de l'Entaille** le franchit à mi-chemin, et il se termine par les **Chutes d'Ambresable**
  (105 → 52 m) qui alimentent l'oasis de la ville.
- **Mesas du désert** : les Trois Enclumes (129 m), la Colonne des Vents, la Sentinelle Rouge (93 m), la Tour de Sel :
  repères et belvédères ; la **Table du Géant** (260 m) sur le plateau est le meilleur point de vue de l'ouest.
- **Vallées** : l'**Argentine** (de Givreval au Lac des Songes puis à la mer, 3,5 km), la **Brumeuse** (de la Sylve
  au marais puis au delta, 2,6 km), la **Salinelle** (du pied d'Aldmar à Port-Salin, 1,9 km).
- **Cuvette des Égarés** : 25 m sous la forêt autour, fermée : la brume y stagne (météo « brume » permanente).

### 4.4 Eau : rivières, lacs, côtes, îles

| Rivière | Type | Source → embouchure (surface) | Longueur | Traversable à pied |
|---|---|---|---|---|
| **Rivière d'Ambre** | canyon | Lac Glacé (253 m) → oasis d'Ambresable (34 m), avec les chutes | 2,4 km | non (1,4 m) : pont de l'Entaille, gués aux berges |
| **Oued d'Ambre** | vallée | oasis (35 m) → mer au sud-ouest | 1,2 km | oui (0,6 m) |
| **L'Argentine** | vallée | Givreval (≈ 160 m) → Lac des Songes (18 m) → Anse des Songes | 3,5 km | non (1,3 m) : 3 ponts |
| **Ru des Brumes** | vallée | Sylve ouest → Argentine | 0,7 km | oui |
| **La Brumeuse** | vallée | Bois des Égarés (94 m) → marais → delta | 2,6 km | non (1,5 m) : ponts, pontons |
| **La Salinelle** | vallée | pied d'Aldmar (67 m) → baie de Port-Salin | 1,9 km | non (1,2 m) : 2 ponts |
| **Le Cendreux** | canyon | flanc est du volcan → plage noire | 0,4 km | oui |
| **Torrent du Givre** | canyon | Blanchecorne → Rivière d'Ambre | 0,4 km | oui |

Lacs : **Lac des Songes** (18 m, 470 × 330 m), **Lac Glacé** (256 m), **Oasis d'Ambresable** (37,5 m), **Oasis des
Mirages** (50,5 m), **Puits des Palmes** (32,2 m), **Lac Vermeil** (75,2 m), **Bassin des Rois** (155,5 m), **lac de
lave** du Brasier (317 m), + les 3 petits lacs de l'ancienne carte (43,8 m) et les étangs du marais (4 m).

Côtes : **plages** sur presque toute la côte sud et dans l'archipel ; **falaises** aux Embruns (60–100 m), sous le
volcan (plage noire) et au cap du désert ; **Anse des Songes**, **baie de Port-Salin** (le port est au fond, à
l'embouchure de la Salinelle), **delta de la Brumeuse**. Îles : **Azurine** (46 m, la grande, reliée à la Plage des
Palmes par la **Chaussée des Sables**), Corail, Épave (62 m, zone rouge, en barque), Mouettes, Îlot des Palmes, Îlot
Nacré, Îlot du Guet.

### 4.5 Règles de pente et hauteurs de jeu

| Règle | Valeur | Utilisation |
|---|---|---|
| Marchable | pente **< 40°** (tan = 0,84) — `tech.md` propose 42°, à trancher, l'écart est faible | serveur : refuser un pas qui monte plus raide ; client : glissade |
| Falaise | **> 55°** | barrière naturelle ; le rendu y met de la roche (`cliff_a/b`) au lieu d'herbe |
| Gué | eau **≤ 0,8 m** | au-delà : infranchissable (pas de nage en v0.3) → ponts et gués |
| Bords des régions | les frontières entre régions de niveaux différents passent par une **falaise, une crête ou une rivière profonde**, avec **au moins un passage** (col, rampe, gorge, pont) | le joueur sait qu'il change de région |
| Pas de « mur absurde » | contrôlé : depuis Brumeval, **toutes** les villes, avant-postes, waypoints et donjons (sauf la Grotte des Marées, prévue en barque) sont **accessibles à pied** en respectant 40° et les gués | calcul de chemins sur la grille de 4,5 m (§9) |
| Répartition des pentes (terres jouables) | < 10° : 54 % · 10–25° : 28 % · 25–40° : 10 % · 40–55° : 5 % · > 55° : 3 % | `carto.json → slopeRules` et `tools/out/slope.png` |

**Du générateur au jeu** (client et serveur doivent lire **les mêmes octets**) :

- `terrainHeight(x, z)` = lecture **bilinéaire** de la carte cuite (4,5 m ici ; l'architecte la ré-échantillonne à
  4 m puis 2 m avec ≤ 0,4 m de détail), sauf dans l'ancienne carte où l'on garde la formule actuelle + 45 m (fondu §1.2).
  Les sorties de ce brouillon ne remplacent pas `world:bake` : elles en sont la **référence visuelle et les données
  d'entrée** (vecteurs de `world_spec.mjs`, niveaux d'eau, profils des rivières et des routes).
- Eau : niveau de la mer 0 ; chaque lac a son niveau (`carto.json → lakes`) ; chaque rivière a un **profil de surface**
  échantillonné tous les 60 m (`rivers[].surfaceProfile`) pour un ruban d'eau ; le marais a un niveau unique de 4 m.
  `isWalkable` : pente < 40° **et** profondeur d'eau ≤ 0,8 m (ou sur un pont).
- `WATER_LEVEL` global disparaît au profit de `waterLevelAt(x, z)` (mer 0, lac, rivière, marais).
- Codage de `heightmap.png` : `hauteur = valeur × 0,01 − 60` (de −60 à 595 m, précision 1 cm) ; échantillon (i, j) à
  `x = −2304 + 4,5 i`, `z = −2808 + 4,5 j` ; ligne 0 = nord ; Brumeval = échantillon (512, 624). Convertible sans perte
  vers le format de `tech.md` (uint16 au 1/64 m, −96…928 m).

---

## 5. Carte de contrôle (32 m par case)

`carto.json → controlMap` : **144 × 144 cases de 32 m** couvrant toute la carte des hauteurs (x0 = −2304,
z0 = −2808), lignes du nord au sud, un caractère par case :

| Couche | Codage | Usage |
|---|---|---|
| `biome` | lettre, voir `biomes` : G prés de Brumeval, O prairie dorée, M lande dorée, A ruines dorées, F forêt, L bois perdus, S neige, R rocaille, V cendres, W marais, H roche rouge, C canyon/falaise rouge, D dunes, T côte tropicale / palmeraie d'oasis, K lande côtière, B plage, Q mer, U lagon, Z lac/rivière, Y lave | matériaux du sol, végétation, météo, musique |
| `region` | caractère → `regions[].char` | nom affiché, niveau, danger |
| `elev` | altitude moyenne (m, entier) | relief de base pour un générateur qui ne lirait pas la carte des hauteurs |
| `water` | 0 sec · 1 mer · 2 lagon · 3 lac · 4 rivière · 5 étang du marais · 6 lave (majoritaire à plus d'un tiers) | eau, sons, pêche (v0.5) |
| `net` | masque : 1 route · 2 rivière · 4 pont | placement des objets (rien sur les routes), ponts à construire |

Règles de biome appliquées par-dessus la région : neige > 262 m et rocaille 212–262 m à Givreval ; pente > 48° →
roche (rouge dans l'ouest) ; plage dans les 55 premiers mètres de côte sous 5 m (sauf falaises) ; palmeraie autour des
oasis ; cendres / landes mêlées aux Terres de Cendre. Pour la carte `control.png` de 16 m de `tech.md`, il suffit de
rastériser les mêmes vecteurs (`world_spec.mjs`) à 16 m : les données sont prévues pour.

---

## 6. Villes, avant-postes, repère

| Ville | Type | x, z | Altitude | Rayon sûr (vert) | Site |
|---|---|---|---|---|---|
| **Brumeval** | village de départ | 0, 0 | 46 m | 32 m (inchangé) | plaine centrale, 6 routes en étoile |
| **Port-Salin** | ville portuaire (2ᵉ ville, marché, banque) | 690, 870 | 6 m | 90 m | fond de baie, embouchure de la Salinelle, quais au sud-est ; bateau vers l'Île de l'Épave |
| **Ambresable** | ville du désert | −1240, 400 | 39,5 m | 85 m | oasis au pied des Chutes d'Ambresable, palmiers, canaux, falaise rouge derrière |
| **Rochegivre** | village de montagne | −1360, −1640 | 201 m | 60 m | replat de la vallée de l'Ambre, sous la Dent de l'Hiver |
| **Clairsaule** | hameau forestier | 450, −1860 | 110 m | 50 m | clairière de la Sylve, à l'est de la Brumeuse |

Avant-postes (pas de zone verte, un marchand et un feu) : **Relais de Mordoré** (−760, −560 ; écurie des montures en
v0.4), **Poste des Cendres** (1010, −1620), **Phare des Embruns** (1985, −1010). Repère : **l'Arbre-Brume** en
(−120, −1200), pied à 178 m, cime à ≈ 300 m (modèle CX-10).

## 7. Pierres de téléportation (26) et donjons (8)

Waypoints (altitude mesurée) : Place de Brumeval (0, 8 — 46 m) · Carrefour de Mordoré (−740, −520 — 64 m) · Gué de
l'Argentine (−850, −1000 — 85 m) · Porte Sud d'Aldmar (−30, −790 — 112 m) · Sanctuaire de l'Arbre-Brume (−60, −1120 —
157 m) · Lisière des Égarés (−90, −1770 — 110 m) · Clairsaule (450, −1840) · Col du Loup Blanc (−1080, −1500 — 179 m) ·
Rochegivre (−1330, −1620 — 202 m) · Lac Glacé (−1380, −2080 — 254 m) · Belvédère de Blanchecorne (−1760, −1960 —
254 m) · Table du Géant (−1860, −800 — 250 m) · Pont de l'Entaille (−1440, −760 — 135 m) · Ambresable (−1240, 420) ·
Oasis des Mirages (−1700, 760 — 52 m, en zone rouge : à déplacer au bord si l'on veut un point sûr) · Rives des Songes
(−470, 470 — 36 m) · Anse des Songes (−600, 1090 — 11 m) · Port-Salin (690, 850) · Plage des Palmes (1240, 720 — 9 m) ·
Île d'Azurine (1600, 1110 — 44 m) · Landes de Ventfauve (640, −700 — 25 m) · Pontons de Brumenoire (1150, −820 — 4 m) ·
Delta de la Brumeuse (1620, −300 — 3,5 m) · Phare des Embruns (1960, −1000 — 155 m) · Poste des Cendres (1010, −1600 —
112 m) · Flanc du Brasier (1200, −1780 — 239 m). Maillage : aucun point jouable n'est à plus de ≈ 700 m d'une pierre.

| Donjon | x, z | Région | Remarque |
|---|---|---|---|
| **Crypte d'Aldmar** | 110, −1260 | Aldmar (rouge) | v0.4, kit CX-4 |
| **Grotte gelée** | −1560, −2040 | Couronne de Givre | v0.4, kit CX-11, au bord du Lac Glacé |
| **Forge engloutie du Brasier** | 1560, −1950 | Cœur du Brasier | au bout du Sentier de la Coulée, dans la brèche du cratère |
| **Tombeau des Sables** | −1700, 1060 | Mer de Dunes | arène du Ver des sables au-dessus |
| **Antre de la Sorcière** | 1330, −760 | Brumenoire | hutte sur pilotis, boss sorcière des marais |
| **Grotte des Marées** | 1950, 1330 | Île de l'Épave | seul lieu **sans accès à pied** : barque depuis Port-Salin |
| **Mines de Rougecrête** | −1740, −380 | Rougecrête | filons de fer et de mithril |
| **Antre du Golem** | 118, −132 | Val de Brumeval | existant |

## 8. Routes

21 tracés (`carto.json → roads`, avec longueur, pente max, déblai/remblai max et ponts). Routes principales
(4 m de demi-largeur, pente ≤ 10–12 %) : **Voie Royale** (Brumeval → Aldmar → Arbre-Brume, 1,1 km), **Route de
Mordoré**, **Route des Sables** (→ Ambresable), **Route de Port-Salin**, **Route des Palmes**, **Route de l'Est**
(→ marais → delta), **Route des Cendres**, **Route de la Sylve** (Aldmar → Clairsaule → Col des Cendres). Sentiers
(2,5 m, pente ≤ 14–35 %) : Col du Loup, Lac Glacé, Blanchecorne, Mirages, Escalier et fond de l'Entaille, Table du
Géant, Gorge Sèche, Chemin des Falaises (côte sud), Phare, Brasier, Coulée, Rampe de l'Est, Chemin du Gué.

Passages taillés à habiller (déblai ou remblai > 20 m, ce sont des lieux, pas des défauts) : le **Grand Escalier**
de la Voie Royale et la **Rampe de l'Est** (tranchée de 30 m dans la falaise d'Aldmar), la descente nord de la route de
la Sylve, la Route des Cendres (remblai sur le ravin de la Brumeuse), le Sentier du Lac Glacé (51 m de déblai près du
lac : à reprendre en lacets), la Coulée et le Sentier de la Table (rampes de mesa).

## 9. Temps de trajet (chemins réels sur la carte générée)

Calculés par plus court chemin sur la grille de 4,5 m, pente < 40°, gués ≤ 0,8 m, ponts ; la vitesse baisse en montée
(−10 % par 10 % de pente) et hors route. Course 6,5 m/s ; « sprint » = moyenne 8,3 m/s avec l'endurance ; monture 14 m/s.

| Trajet | Ligne droite | Chemin | À pied | Sprint | Monture |
|---|---|---|---|---|---|
| Brumeval → Port-Salin | 1,11 km | 1,20 km | 3,2 min | 2,5 | 1,4 |
| Brumeval → Ambresable | 1,30 km | 1,46 km | 3,9 min | 3,1 | 1,7 |
| Brumeval → Rochegivre | 2,13 km | 2,19 km | 6,7 min | 5,3 | 2,6 |
| Brumeval → Clairsaule | 1,91 km | 2,25 km | 6,3 min | 5,0 | 2,7 |
| Brumeval → Sanctuaire de l'Arbre-Brume | 1,12 km | 1,15 km | 3,3 min | 2,6 | 1,4 |
| Brumeval → Pontons de Brumenoire | 1,41 km | 1,58 km | 4,3 min | 3,4 | 1,9 |
| Brumeval → Poste des Cendres | 1,91 km | 2,06 km | 6,2 min | 4,8 | 2,5 |
| Brumeval → Phare des Embruns | 2,23 km | 2,51 km | 7,6 min | 6,0 | 3,0 |
| Brumeval → Île d'Azurine | 1,95 km | 2,05 km | 5,9 min | 4,6 | 2,4 |
| Brumeval → Lac Glacé | 2,50 km | 2,68 km | 8,2 min | 6,4 | 3,2 |
| Brumeval → Forge engloutie (cratère) | 2,50 km | 2,64 km | 8,7 min | 6,9 | 3,1 |
| Port-Salin → Ambresable | 1,99 km | 2,12 km | 6,0 min | 4,7 | 2,5 |
| Port-Salin → Rochegivre (le plus long entre villes) | 3,24 km | 3,39 km | 10,0 min | 7,9 | 4,0 |
| Ambresable → Rochegivre (par le canyon) | 2,04 km | 2,19 km | 6,2 min | 4,9 | 2,6 |
| Ambresable → Clairsaule | 2,82 km | 3,13 km | 9,1 min | 7,1 | 3,7 |
| Rochegivre → Clairsaule | 1,82 km | 2,17 km | 6,3 min | 4,9 | 2,6 |

Tous les trajets depuis chaque ville vers chaque lieu : `carto.json → travel.fromHubs`.

## 10. Contrôles effectués et limites connues

- ✅ Toutes les villes, avant-postes, waypoints et donjons sont atteignables à pied depuis Brumeval, sauf la Grotte
  des Marées (voulu : barque).
- ✅ Chaque rivière descend strictement jusqu'à la mer ou à un lac (lit forcé et vérifié) ; les villes ne sont pas
  inondées ; les lacs ont un rebord (le Lac Vermeil et le Lac Glacé ont encore quelques cases « à fuite » :
  126 et 16 cases de 4,5 m au bord aval, à reprendre à la main ou en abaissant leur niveau de 1 m).
- ✅ L'ancienne carte est intacte à ±0,5 % près dans |x|, |z| ≤ 160.
- ⚠ Résolution 4,5 m : les lacets serrés et les escaliers ne tiennent pas dans la grille ; les routes raides sont des
  rampes taillées (voir §8). Le passage à 2 m (`tech.md`) les rendra propres.
- ⚠ À trancher avec l'architecte : relèvement de l'ancienne carte (+45 m ici, +32 m chez lui), pente marchable (40°/42°),
  pas de la grille (4,5 m pour couvrir 4 608 m ici, 4 m pour 4 096 m chez lui : il faut alors 1 153 échantillons ou
  une marge de mer générée à part).
- ⚠ Le waypoint de l'Oasis des Mirages est dans la Mer de Dunes (zone rouge) : le déplacer ou garder volontairement
  une pierre « à risque ».
- Idées pour la suite : grottes et arches naturelles (non représentables dans une carte des hauteurs, à poser en
  modèles), glaciers sur la face nord de Givrecime, cascades supplémentaires sur l'escarpement de Rougecrête, îles
  lointaines pour l'extension 8 km.
