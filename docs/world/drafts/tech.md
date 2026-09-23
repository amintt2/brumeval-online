# Monde ouvert v0.3+ — cadre technique (brouillon « tech »)

> Brouillon du concepteur technique du monde. Il fixe **ce que le moteur sait faire** pour une très grande carte
> dans le navigateur, et **le cadre des hauteurs** dans lequel le cartographe place les régions (demande de
> l'utilisateur : « que le cartographe fasse la typologie des hauteurs »). Les valeurs d'altitude du §3 sont une
> **grille proposée** : le cartographe les confirme ou les ajuste région par région, le moteur s'adapte tant que les
> bornes techniques (§3.1) sont respectées.
>
> Sources lues : `ROADMAP.md` §1–2 bis et §4, `SPEC.md`, `shared/world.js`, `shared/data.js`, `shared/protocol.js`,
> `docs/CODEX_BRIEF.md`, branches `wave1-wip/render-souls` (`docs/RENDU.md`, `terrain.js`, `terrainData.js`,
> `worldObjects.js`, `sky.js`) et `wave1-wip/netcode-perf` (`server/src/aoi.js`, `snapshot.js`,
> `persistence.js`, `docs/PERFORMANCES.md`). Références visuelles de l'utilisateur (Zelda TotK) : décrites
> seulement, jamais copiées dans le dépôt.

---

## 0. Résumé des décisions

| Sujet | Décision |
|---|---|
| Taille | **4 096 × 4 096 m jouables** (16,8 km², ≈ 130 × la carte actuelle), océan jusqu'à l'horizon au-delà. Moteur conçu pour monter à 8 192 m sans refonte. |
| Brumeval | Reste en **(0, 0)**, au centre ; l'ancienne carte (±180 m) est **incrustée telle quelle** dans le nouveau monde (même x/z, relevée de +32 m). Aucune position de joueur n'est perdue. |
| Terrain | **Cuit hors ligne** (script Node) depuis une carte de contrôle + bruit multi-octave + érosion, puis **téléchargé** par le client en tuiles. Le client ne régénère jamais le relief (garantie d'identité client/serveur, même sur Firefox/Safari). |
| Hauteurs | `uint16`, pas de 1/64 m (1,56 cm), plage −96 m … +928 m ; relief utile de −60 à +620 m (§3). |
| Client | CDLOD instancié (5 niveaux), tuiles de données de 256 m, patchs de 64 m, carte globale 8 m toujours en mémoire, horizon + océan infini, imposteurs d'arbres, budget de chargement par image. |
| Serveur | Carte de hauteurs entière en mémoire (8 Mo), objets et collisions **générés par morceau de 64 m à la demande**, trois états de morceau (dormant / tiède / actif), apparitions qui dorment, grille AOI de 32 m inchangée. |
| Précision | Origine flottante par pas de 256 m côté client ; profondeur en deux tranches (proche / lointain). |
| Nuages | Couche volumétrique par lancer de rayons en basse résolution + reprojection temporelle, ombres de nuages au sol, couverture pilotée par la météo ; repli 2D sur les petites machines. |
| Météo | Serveur autoritaire par zone climatique, message additif `weather`. |

---

## 1. Taille du monde : recommandation et limites

### 1.1 Pourquoi 4 096 m

| Carte (côté) | Traversée à pied (6,5 m/s) | Au sprint (×1,45) | À cheval (v0.4, ≈ 13 m/s) | Ressenti |
|---|---|---|---|---|
| 360 m (v0.1–v0.2) | 55 s | 38 s | — | une clairière |
| 800 m (ancienne cible v0.3) | 2 min | 1 min 25 | — | une zone de MMO classique |
| 2 048 m | 5 min 15 | 3 min 40 | 2 min 40 | grand, mais on voit les bords |
| **4 096 m** | **10 min 30** | **7 min 15** | **5 min 15** | « super grand », à l'échelle d'un monde ouvert |
| 8 192 m | 21 min | 14 min 30 | 10 min 30 | trop vide tant que le contenu n'est pas là |

- 4 096 m donne l'échelle voulue (un désert en bas à gauche, une côte, une forêt, des montagnes, qu'on met plusieurs
  minutes à traverser) tout en restant **dans la zone de précision float32 sans astuce lourde** (±2 048 m, §7).
- La carte TotK de référence fait environ 12 km de côté mais repose sur le vol, le planeur et une console : dans un
  navigateur, avec un contenu produit par des agents, **la densité de contenu** est la vraie limite, pas le moteur.
- **Tout le relief est construit dès la v0.3** (le relief coûte peu) ; les régions s'**ouvrent par étapes**
  (v0.3 : centre + 5 régions de la feuille de route ; v0.4 : volcan, grande forêt, îles…). Une région fermée est
  visible au loin (silhouettes, nuages) mais barrée par du jeu (pont effondré, brume maudite, courant marin), jamais
  par un mur invisible nu.
- Densité cible pour ne pas faire un monde vide : **un point d'intérêt tous les 150–250 m**, une pierre de
  téléportation tous les 600–800 m (≈ 25–35 sur la carte), une ville ou un campement habité par région.

### 1.2 Limites techniques

| Limite | Valeur | D'où elle vient |
|---|---|---|
| Côté jouable max sans refonte | 8 192 m | index de morceau sur 8 bits signés par axe (128 morceaux de 64 m), précision float32 avec origine flottante |
| Côté jouable recommandé | 4 096 m | précision float32 (§7), taille des données (§12), contenu |
| Altitude | −96 m … +928 m (format), −60 … +620 m (usage) | `uint16` à 1/64 m ; caméra orbitale et brouillard |
| Pente marchable | ≤ 42° | serveur (§6.4) et animations |
| Distance de vue terrain | 5 km (Ultra), 3 km (Élevé), 1,6 km (Moyen), 900 m (Bas) | §4 et §13 |
| Objets statiques | ≈ 350 000 générés, ≤ 30 000 instances visibles | §4.4 |

---

## 2. Terrain déterministe : carte de contrôle → cuisson → tuiles

### 2.1 Principe

Aujourd'hui, `terrainHeight(x, z)` calcule du bruit à chaque appel, et le client appelle cette fonction à chaque
image (entités, caméra, effets). Sur 16,8 km² avec des montagnes érodées, ce n'est plus possible : le relief devient
une **donnée cuite une fois**, puis lue par interpolation bilinéaire en O(1).

```
docs/world/*.json (cartographe)          ← régions, lignes de crête, côtes, rivières, lacs, routes, POI (vecteurs)
        │  npm run world:control
        ▼
world/control.png  (256 × 256, 16 m/px)  ← relief de base, type de relief, biome, humidité, masque « ancienne carte »
        │  npm run world:bake (Node, déterministe, ≈ 30–60 s)
        ▼
world/out/height_2m.bin   2049² uint16   ← haute définition, découpée en tuiles pour le client
world/out/height_8m.bin    513² uint16   ← carte globale (horizon, carte du monde, serveur lointain)
world/out/material_2m.bin 2049² uint8    ← id de matériau dominant + masque herbe (pour le splat du client)
world/out/shore_sdf.bin    513² int8     ← distance signée au rivage (écume, vagues, sable humide)
world/out/tiles/<tx>_<tz>.bin            ← tuiles de 256 m (hauteurs + matériaux), noms à empreinte
world/out/map/*.webp                     ← carte du monde et minicarte (§11)
world/out/world.lock                     ← sha256 de chaque sortie + version du monde
```

- **Ce qui est versionné** : les JSON du cartographe, `control.png` (≈ 150 Ko), le script de cuisson et
  `world.lock`. Les sorties (≈ 20 Mo) sont **générées** : au `npm run dev`, dans le `Dockerfile` (étape de build,
  même version de Node), et vérifiées contre `world.lock` (un écart = build en échec). Le client les reçoit comme
  des fichiers statiques à empreinte (`Cache-Control: immutable`).
- **Pourquoi pas une génération côté client** : les fonctions `Math.sin/exp/pow` ne donnent pas les mêmes derniers
  bits dans tous les navigateurs. Un relief régénéré sur Safari pourrait différer de quelques millimètres du serveur,
  puis, après érosion (processus chaotique), de plusieurs mètres. Le client **lit** les mêmes octets que le serveur.
- `shared/world.js` garde ses exports (`terrainHeight`, `isWalkable`, `regionAt`, `WORLD_HALF`…) comme façade :
  `terrainHeight` devient une lecture bilinéaire de la grille chargée (serveur : grille complète ; client : tuile
  2 m si présente, sinon carte globale 8 m). Aucun appelant existant ne change.

### 2.2 La carte de contrôle (256 × 256, 16 m par pixel)

| Canal | Contenu | Exemple |
|---|---|---|
| R | altitude de base (0–255 → −60 … +620 m, courbe non linéaire, plus fine en bas) | plaines 40 m, plateau 180 m |
| G | **type de relief** (id, §3.3) | 3 = collines, 7 = dunes, 11 = volcan |
| B | biome (id) : prairie, forêt, marais, désert, toundra, côte tropicale, cendres… | pilote les matériaux, la végétation, la météo |
| A | rugosité / humidité (0–255) | amplitude du bruit, force de l'érosion, densité d'herbe |

- Le cartographe **ne peint pas de pixels** : il décrit le monde en JSON (polygones de régions, courbes de crête,
  tracé des côtes, rivières avec altitude de source et d'embouchure, lacs avec leur niveau). `world:control`
  rastérise ces vecteurs, et **lisse les frontières par champ de distance** (fondu de 64 à 160 m selon le couple de
  reliefs) pour qu'aucune couture ne se voie.
- Un masque spécial marque l'**ancienne carte** (carré ±200 m autour de Brumeval) : à l'intérieur, la hauteur de base
  est l'ancien `rawHeight` + les zones aplanies + les lacs actuels, **relevés de +32 m** ; un fondu de 200 à 260 m la
  raccorde aux plaines. L'ancienne chaîne de montagnes de bordure (145–180 m) est supprimée. Les routes, le village,
  le camp gobelin, le cimetière et l'antre du Golem restent aux mêmes x/z.

### 2.3 Cuisson (Node, une fois)

Pour chaque échantillon de la grille de 4 m (1 025², puis sur-échantillonnage à 2 m avec du détail) :

1. **Base** : altitude du canal R, interpolée en bicubique (pas d'escaliers de 16 m).
2. **Profil du type de relief** (§3.3) : chaque type définit une fonction
   `h = base + amp × forme(bruit) ` avec ses propres paramètres : octaves (3–8), fréquence, bruit « ridged »
   (crêtes), terrasses (plateaux et mesas), torsion de domaine (domain warp, pour des formes non répétitives),
   orientation (dunes alignées sur le vent dominant). Les types voisins se mélangent **par poids** (le fondu de la
   carte de contrôle), pas par seuil.
3. **Creusement** : rivières (profil en V ou en U selon le relief, lit dont l'altitude **décroît forcément** de la
   source à l'embouchure), canyons (spline + profil en marches), lacs (fond sous leur niveau d'eau), routes
   (aplanissement doux de 5 m de large, pente max 14°), zones aplanies des villes et camps.
4. **Érosion** : érosion hydraulique par gouttes (≈ 400 000 gouttes, 64 pas, sur la grille de 4 m) + érosion
   thermique (3 passes, angle de talus 38°) — force modulée par le canal A et par type de relief (forte en montagne
   et canyon, nulle dans les dunes et l'ancienne carte). Coût mesuré attendu en JS : 10–25 s. Sortie annexe : une
   carte de **ruissellement** (où l'eau a coulé) qui sert aux matériaux (ravines, éboulis, lits de galets).
5. **Détail 2 m** : bruit de 2 octaves de faible amplitude (≤ 0,4 m) ajouté après érosion, seulement hors routes et
   hors zones aplanies.
6. **Quantification** : `u16 = round((h + 96) × 64)` ; lecture `h = u16 / 64 − 96`.
7. **Dérivés** : carte globale 8 m (moyenne 4×4, **pas** un simple sous-échantillonnage, pour ne pas faire
   « vibrer » les sommets au loin), matériau dominant (règles du §3.4), distance signée au rivage, carte du monde.

Tout est calculé avec un PRNG entier (`mulberry32`, `hash2i` de `shared/noise.js`) et un ordre de parcours fixe :
deux cuissons avec la même version de Node donnent les mêmes octets (vérifié par `world.lock`).

### 2.4 Lecture rapide (partagée client / serveur)

```js
// shared/world/heightfield.js — O(1), sans allocation
heightAt(x, z)          // bilinéaire sur la meilleure grille disponible (2 m, sinon 8 m)
normalAt(x, z, out)     // différences centrées (pente, éclairage, glissade)
slopeAt(x, z)           // degrés
materialAt(x, z)        // id de matériau dominant (sons de pas, traces, effets)
landformAt(x, z), biomeAt(x, z)   // lecture de la carte de contrôle (16 m, plus proche voisin)
waterLevelAt(x, z)      // 0 pour la mer, niveau propre pour chaque lac / tronçon de rivière, -Infinity sinon
```

Le serveur appelle `heightAt` pour chaque mouvement validé, chaque projectile et chaque apparition : une lecture
bilinéaire coûte ≈ 20 ns, contre ≈ 2 µs pour le bruit actuel.

---

## 3. Typologie des hauteurs (cadre pour le cartographe)

### 3.1 Bornes et conventions

- **Niveau de la mer = 0 m** (aujourd'hui `WATER_LEVEL = −1,2` pour de petits lacs : il devient le niveau de
  l'océan ; chaque lac et chaque rivière a son propre niveau). L'ancienne carte, relevée de +32 m, a donc ses lacs
  à ≈ 30,8 m.
- **Point le plus haut conseillé : 600 m** (sommet du volcan ou du pic principal). Au-delà, la caméra orbitale et
  le brouillard écrasent la silhouette, et les pentes deviennent des murs sur 4 km. Un sommet de 500–600 m vu à 3 km
  sous-tend ≈ 10° : un vrai repère, comme les grandes montagnes de la référence (image 1, nord-est et nord-ouest).
- **Point le plus bas utile : −60 m** (fonds marins visibles dans l'eau claire des côtes tropicales, images 9–10).
- **Dénivelé local** : jamais plus de 120 m de dénivelé sur 200 m de distance en zone de combat (lisibilité des
  attaques télégraphiées au sol) ; les grandes parois sont réservées aux bords de régions et aux repères.
- **L'Arbre-Brume** (CX-10, ≈ 120 m) se pose sur une butte de 70–90 m : son sommet culmine à ≈ 200 m, visible de
  presque toute la carte, sans concurrencer les montagnes.

### 3.2 Étages d'altitude

| Étage | Altitude | Où (proposition) | Végétation et matériaux | Notes moteur |
|---|---|---|---|---|
| **Fonds marins** | −60 … −3 m | tout le sud et l'est, lagons | sable, herbiers, récifs (pas de collision : on ne nage pas en profondeur) | couleur d'eau selon la profondeur ; non marchable |
| **Estran, plages** | −3 … +4 m | côte de Port-Salin, îles tropicales, deltas | sable clair, galets, palmiers (`tree_palm`), roseaux | écume, sable mouillé, vagues ; marchable jusqu'à −0,8 m |
| **Basses terres** | 4 … 30 m | marais de l'est, prairies côtières, désert bas (sud-ouest) | boue, joncs, prairie grasse, dunes basses | zones plates : le brouillard de hauteur s'y accumule (marais) |
| **Terres moyennes** | 30 … 70 m | plaines centrales, ancienne carte (≈ 32–45 m), forêts | herbe haute et fleurs, chênes, bouleaux, champs dorés (image 3) | l'essentiel du jeu ; herbe dense, vent visible |
| **Collines et plateaux** | 70 … 160 m | ceinture autour des plaines, ruines, landes | herbe rase, rochers, ruines (image 4), forêt de brume (image 7) | points de vue vers les plaines ; premières falaises |
| **Hautes terres** | 160 … 280 m | plateau du désert (sud-ouest), hauts plateaux de l'ouest, canyon | roche rouge, mesas, grès ; landes froides au nord | terrasses ; canyons creusés de 60–120 m |
| **Montagnes** | 280 … 450 m | chaîne de Givreval (nord-ouest), flancs du volcan (nord-est) | pins enneigés (`tree_pine_snow`), éboulis, neige au-dessus de 330 m au nord, cendres à l'est | limite des arbres ≈ 330 m ; neige selon l'altitude **et** l'exposition (plus basse au nord) |
| **Sommets** | 450 … 620 m | un pic principal de Givreval, cône du volcan | neige et glace, roche nue, lave et cendres au volcan | peu marchables ; visibles de partout ; les nuages bas (§9) les accrochent |

### 3.3 Types de relief (canal G de la carte de contrôle)

Chaque type est un « profil » que la cuisson sait fabriquer ; le cartographe choisit les types et la cuisson se
charge des formes.

| Id | Type | Forme | Paramètres de cuisson | Exemple |
|---|---|---|---|---|
| 0 | **Plaine ondulée** | ondulations de 2–6 m sur 100–300 m | fBm 4 octaves, amp. 4 m, érosion faible | plaines centrales, prairie (images 2–3) |
| 1 | **Collines** | bosses de 15–40 m, vallons | fBm 5 octaves + torsion, érosion moyenne | ceinture des plaines |
| 2 | **Plateau à falaises** | dessus plat, bord abrupt de 20–60 m | terrasses 1–2 marches, bord « ridged » | ruines d'Aldmar, hauts plateaux |
| 3 | **Mesas et buttes** | colonnes à sommet plat, marches de grès | terrasses 3–5 marches, bruit cellulaire | hautes terres du désert |
| 4 | **Canyon** | gorge de 60–120 m, parois en marches | spline creusée + terrasses, érosion forte | frontière désert / plaines |
| 5 | **Montagne alpine** | crêtes vives, cirques, éboulis | multifractal « ridged » 7–8 octaves, érosion forte + thermique | Givreval |
| 6 | **Volcan** | cône à 25–35°, cratère, coulées | profil radial + ravines radiales + bruit, cratère creusé | nord-est |
| 7 | **Dunes** | crêtes allongées de 5–25 m, orientées au vent | bruit directionnel « ridged » + asymétrie (face au vent douce, face sous le vent 32°) | désert (image 6 : glisser sur les dunes) |
| 8 | **Marais** | presque plat, trous d'eau, îlots | seuil du bruit sous le niveau de l'eau local, amp. 1,5 m | marais de l'est |
| 9 | **Côte à falaises** | falaise de 15–40 m sur la mer, criques | profil d'arrêt brutal le long du rivage | nord-est, péninsules |
| 10 | **Côte basse et îles** | plages longues, lagons, îlots | profil doux vers −8 m, îles par bruit à seuil | sud tropical (images 9–10) |
| 11 | **Forêt de brume** | vallons encaissés, ravines, souches | collines + ravines d'écoulement accentuées | forêt perdue (image 7) |
| 12 | **Ancienne carte** | le relief actuel, relevé de +32 m | fonction héritée, aucune érosion | Brumeval et alentours |
| 13 | **Cuvette lacustre** | pente douce vers un lac | profil radial, niveau d'eau propre | grands lacs, cascades (image 5) |

### 3.4 Classes de pente (appliquées par le moteur partout)

| Pente | Classe | Effet de jeu | Rendu |
|---|---|---|---|
| 0–12° | **plat** | constructible (villes, camps, arènes de boss) | herbe pleine |
| 12–30° | **marchable** | normal | herbe, moins dense au-dessus de 25° |
| 30–42° | **raide** | on monte plus lentement (vitesse × 0,75 en montée) | terre, éboulis, herbe clairsemée |
| 42–55° | **glissade** | impossible à gravir (le serveur refuse la montée), on glisse en descendant | roche triplanaire |
| > 55° | **falaise** | mur | roche + modèles `cliff_a` / `cliff_b` posés par la cuisson pour casser la texture étirée |

Les arènes de boss et les zones de combat dense doivent être en classe « plat » ou « marchable » (lisibilité des
cercles et cônes télégraphiés au sol, projetés sur le terrain).

### 3.5 Ce que le cartographe livre

1. `docs/world/regions.json` : polygones de régions (nom français, biome, type de relief, étage, niveau de sécurité
   vert / jaune / rouge, palier T1–T6).
2. `docs/world/relief.json` : crêtes (polylignes + altitude), pics (x, z, h, rayon), côtes, rivières (source,
   embouchure, largeur), lacs (polygone + niveau), canyons, routes principales.
3. Pour chaque région : l'étage d'altitude et les types de relief retenus parmi §3.2–3.3.
4. Contrainte : les voisins directs ne diffèrent pas de plus de 2 étages sans une transition jouable (col, rampe,
   route en lacets, pont).

---

## 4. Diffusion en continu côté client

### 4.1 Découpage

| Unité | Taille | Rôle |
|---|---|---|
| Tuile de données | 256 m (16 × 16 sur la carte) | unité de téléchargement : 129² hauteurs (2 m) + matériaux + masque d'herbe |
| Patch de terrain | 64 m | nœud du quadtree CDLOD, 33 × 33 sommets, un seul maillage partagé |
| Morceau d'objets | 64 m (64 × 64 sur la carte) | génération déterministe des objets, collisions serveur |
| Lot d'instances | 128 m (2 × 2 morceaux) | regroupement pour les appels de dessin |
| Tuile d'herbe | 24 m | inchangé (render-souls) |

### 4.2 Terrain : CDLOD instancié

- Le terrain actuel (render-souls) fabrique une grille complète du monde dans un worker (240² échantillons pour
  360 m) : à 4 096 m ce serait 2 700² échantillons et ≈ 140 Mo de données. Il faut passer à un **quadtree CDLOD** :
  un seul maillage de patch 33 × 33, des **instances** par niveau (position, échelle, niveau), la hauteur lue dans le
  **vertex shader** depuis des textures, et un **morphing géométrique** entre niveaux (plus de jupes ni de fissures).
- Niveaux (distance ajustée par la distance d'affichage du réglage graphique) :

  | Niveau | Pas | Jusqu'à | Source des hauteurs |
  |---|---|---|---|
  | L0 | 2 m | 200 m | tuiles 2 m (tableau de textures R32F, 64 couches en mémoire) |
  | L1 | 4 m | 450 m | tuiles 2 m (lecture sur-échantillonnée) |
  | L2 | 8 m | 1 000 m | carte globale 8 m (513², toujours en mémoire, 1 Mo) |
  | L3 | 16 m | 2 200 m | carte globale 8 m |
  | L4 | 32 m | horizon (5 km) | carte globale 8 m |

- **Appels de dessin** : 1 par niveau et par passe (couleur + cascades d'ombre) ≈ 5 + 3 × 2 = 11 au total.
- **Matériau** : le splat PBR à 10 couches de render-souls est conservé, mais les poids viennent des tuiles
  (`material_2m`) au lieu d'être calculés sur toute la carte. Au-delà de 1 km : une **texture d'albédo globale**
  (1024², cuite, avec ombrage de relief doux) remplace le splat — le terrain lointain coûte une lecture de texture.
- **Tuile manquante** (pas encore téléchargée) : le terrain proche utilise la carte 8 m et un splat par biome, puis
  la tuile 2 m apparaît en fondu sur 0,4 s. Le joueur ne tombe jamais dans un trou (le serveur, lui, a tout).

### 4.3 Téléchargement, anneaux et priorités

- Anneau **obligatoire** : les 3 × 3 tuiles autour du joueur (768 m) avant de quitter l'écran de chargement.
- Anneau **anticipé** : 5 × 5 tuiles, triées par distance et **par direction de déplacement** (on précharge devant).
- Anneau **conservé** : 7 × 7 tuiles ; au-delà, les tuiles quittent la mémoire GPU (LRU, 64 couches max).
- Les fichiers sont servis en brotli, à empreinte, mis en cache par le navigateur **et** par le service worker de la
  PWA / du launcher (monde exploré = disponible hors ligne au lancement suivant).
- Téléportation : l'écran de chargement attend l'anneau obligatoire de la destination (≈ 150 Ko, < 1 s en ADSL).

### 4.4 Végétation et objets

- **Génération par morceau de 64 m**, fonction pure partagée client / serveur :
  `chunkObjects(cx, cz) → [{ type, x, z, ry, s, r }]`, graine = `hash2i(cx, cz, WORLD_SEED)`, échantillonnage en
  grille décalée (type Poisson) selon la densité du biome, du relief, de la pente, de l'altitude, de la distance aux
  routes et à l'eau. Les objets posés à la main (villes, camps, ruines, POI) viennent du JSON du cartographe et sont
  rangés dans le morceau qui contient leur centre.
- **Client** : la génération tourne dans le worker de terrain ; le thread principal reçoit des tableaux typés prêts à
  copier dans les tampons d'instances. Un morceau = 0,2–0,6 ms de worker.
- **Rendu** : un `InstancedMesh` par (espèce, LOD) et par lot de 128 m, comme aujourd'hui (render-souls : un appel par
  type et par tuile de 96 m) ; tampons **pré-alloués et recyclés** (liste libre), jamais recréés à chaque passage.
- **Distances** (× réglage) :

  | Objet | LOD0 | LOD1 | LOD2 | Imposteur | Disparaît |
  |---|---|---|---|---|---|
  | Arbres | 45 m | 110 m | 220 m | jusqu'à 1 200 m | au-delà : couleur de forêt dans l'albédo global |
  | Rochers, falaises | 50 m | 120 m | 400 m | — | 900 m (petits : 250 m) |
  | Bâtiments, repères | 60 m | 150 m | 2 000 m | l'Arbre-Brume : imposteur à l'infini | jamais (repères) |
  | Buissons, fleurs, caisses | 40 m | — | — | — | 105 m (inchangé) |

- **Imposteurs d'arbres** : imposteurs **octaédriques** (8 × 8 vues, atlas 2048² couleur + normale par espèce)
  rendus dans Blender par le kit (à ajouter au contrat §4.4 : `<clé>_impostor.webp` + `<clé>_impostor.json`). Au loin,
  on ne garde **qu'un arbre sur 3 à 6** (liste « lointaine » précalculée par tuile de 256 m, arbres agrandis de 20 %
  pour garder la couverture). Un imposteur = 2 triangles, 1 appel par espèce.
- **Masquage** : test de pyramide de vue par lot (et par cascade d'ombre), petits objets seulement dans la première
  cascade (inchangé), arbres lointains sans ombre portée (l'ombre des forêts lointaines est cuite dans l'albédo
  global).

### 4.5 Budget de chargement par image

| Travail sur le thread principal | Budget par image |
|---|---|
| Envoi d'une tuile de hauteurs au GPU (`texSubImage3D`, 66 Ko) | 1 tuile max |
| Création / remplissage d'instances | ≤ 4 000 instances copiées |
| Compilation de shader | aucune en jeu : tout est préchauffé à l'écran de chargement (`renderer.compileAsync`) |
| Chargement de GLB | décodage dans un worker ; mise en place ≤ 1 modèle par image |
| Total « diffusion » | ≤ 2 ms par image (mesuré ; le reste attend l'image suivante) |

### 4.6 Plafonds mémoire

| | Bas | Moyen | Élevé | Ultra |
|---|---|---|---|---|
| Tuiles de hauteurs en GPU | 25 | 36 | 49 | 64 |
| Mémoire GPU visée | ≤ 600 Mo | ≤ 1 Go | ≤ 1,5 Go | ≤ 2,5 Go |
| Tas JavaScript | ≤ 250 Mo | ≤ 300 Mo | ≤ 350 Mo | ≤ 400 Mo |
| Instances d'objets visibles | 8 000 | 15 000 | 22 000 | 30 000 |

- Les grands atlas (imposteurs, textures de terrain 1024²) passent en **KTX2 / Basis** (`KTX2Loader` de three, le
  transcodeur est servi depuis `node_modules`, pas depuis un CDN) : mémoire GPU divisée par 4 à 6.
- Les tuiles et morceaux quittant l'anneau conservé libèrent leurs tampons dans un pool de taille fixe (pas de
  croissance au fil d'une longue session, vérifié par `window.__game.stats()`).

---

## 5. Horizon, océan, eau douce

### 5.1 Au-delà de la carte

- La carte est une grande île-continent : **la mer au sud et à l'est** (côtes de la référence), des **montagnes au
  nord et à l'ouest** qui descendent vers une mer froide. Au-delà de ±2 048 m : l'océan infini, quelques îles
  décoratives lointaines (maillage simple dans la carte 8 m étendue à ±3 000 m) et le brouillard.
- Limite du jeu : ±2 048 m sur l'eau (courant marin qui ramène vers la côte + message « Les courants vous
  repoussent vers le rivage. ») ; dans les montagnes, la classe « falaise » suffit. `WORLD_LIMIT` devient 2 040.

### 5.2 Océan infini

- **Maillage centré sur la caméra** : anneaux concentriques (grille dense près de la caméra, de plus en plus lâche
  jusqu'à l'horizon), repositionné par pas entiers de sa maille (pas de glissement des vagues).
- **Vagues** : 4 à 6 vagues de Gerstner dans le vertex shader jusqu'à 400 m, puis seulement des normales ; direction
  et hauteur liées au vent de la météo (calme 0,3 m, tempête 2,5 m).
- **Couleur** : profondeur lue dans la carte de hauteurs → turquoise lumineux sur les hauts-fonds sableux (côte
  tropicale, images 9–10), bleu profond au large, vert-gris au nord froid ; réflexion du ciel par l'IBL (Fresnel),
  reflet du soleil net, **absorption** (on voit le fond jusqu'à ≈ 6 m).
- **Rivage** : la distance signée au rivage (`shore_sdf`) produit des **bandes d'écume qui avancent vers la plage**
  (`fract(sdf / longueur_onde − t)`), le sable mouillé qui sèche en retrait, et l'amortissement des vagues sur les
  hauts-fonds. L'écume existante (`/textures/foam.webp`) est réutilisée.
- **Coût** : 1 appel de dessin, ≈ 0,6 ms (Élevé, 1080p).

### 5.3 Lacs, rivières, cascades

- Lacs : un plan par lac à son niveau (même matériau, vagues faibles), découpé par morceau.
- Rivières : ruban maillé par morceau le long de la spline, UV qui défilent dans le sens du courant, écume aux
  rochers et aux changements de pente ; **cascades** (référence : la ville du désert entre palmiers et cascades,
  image 5) = maillage de nappe + flipbooks d'écume et de brume (`fog_wisps` de CX-6) + son.
- Le serveur connaît `waterLevelAt` : on marche dans l'eau jusqu'à 0,8 m de profondeur (vitesse × 0,6), au-delà
  c'est non marchable (pas de nage en v0.3).

---

## 6. Côté serveur

### 6.1 Données en mémoire

- Carte de hauteurs 2 m **complète** (2049² `uint16`, 8 Mo) + carte de contrôle + matériaux (4 Mo) : lecture O(1),
  aucune activation nécessaire pour le relief.
- Les objets (arbres, rochers, bâtiments) sont **générés à la demande** par morceau de 64 m, avec la même fonction
  que le client.

### 6.2 Morceaux : dormant, tiède, actif

| État | Condition | Contenu |
|---|---|---|
| **Dormant** | aucun joueur à moins de 384 m depuis 60 s | rien en mémoire, sauf l'état persistant du morceau (§6.6) |
| **Tiède** | un joueur à moins de 384 m | objets et grille de collision chargés, apparitions préparées, monstres créés mais endormis |
| **Actif** | un joueur à moins de 192 m | IA à pleine cadence (règle de sommeil de `aoi.js` inchangée : `WAKE_RADIUS = VIEW_RADIUS + 24`) |

- Passage dormant → tiède : génération + grille ≈ 0,3–0,8 ms par morceau, **étalé** (≤ 4 morceaux par tick,
  file d'attente par distance). Un joueur qui court à 9,4 m/s traverse un morceau en 7 s : la marge est large.
- Cache LRU des morceaux tièdes : 1 500 morceaux max (≈ 30 Mo) ; au-delà, les plus anciens redeviennent dormants.

### 6.3 Apparitions qui dorment

- Chaque zone d'apparition (`SPAWN_ZONES`, étendu) appartient à un morceau. Dormante, elle ne simule rien : elle
  garde son **compte** (vivants / morts) et les **horodatages absolus** de réapparition (`respawnAt`).
- Au réveil, elle recrée les monstres manquants dont `respawnAt` est passé, à des positions tirées dans sa zone
  (hors vue des joueurs si possible) ; les boss et élites gardent leur minuterie absolue (pas de « farm » en
  entrant / sortant).
- Un monstre qui poursuit un joueur **empêche** son morceau de s'endormir ; en entrant dans un morceau dormant il le
  réveille (ou il est ramené à sa laisse, règle actuelle `r + 18`).
- Coût attendu : sur 4 096 m, avec ≈ 4 000 monstres placés et 200 joueurs dispersés, ≈ 10–20 % des monstres sont
  en mémoire et ≈ 5 % éveillés.

### 6.4 Collisions et déplacements

- **Grille de collision par morceau** : cellules de 4 m, cercles des objets statiques (comme `CollisionWorld`
  aujourd'hui, mais un par morceau) ; une requête regarde le morceau courant et, près d'un bord, ses voisins (rayon
  d'objet max 8 m < marge).
- **Validation du mouvement** (contrat `anticheat`) : en plus de `isWalkable`, rejet d'une **montée** si la pente du
  segment dépasse 42°, et de toute arrivée sous l'eau profonde ; la vitesse autorisée (`maxSpeedAt`) intègre le
  facteur 0,75 en montée raide et 0,6 dans l'eau.
- **Lignes de vue** (monstres à distance, sorts) : parcours DDA de la carte de hauteurs (pas de 4 m) : les collines
  bloquent les tirs, ≈ 1 µs par test.
- **Apparitions et téléportations** : points sûrs précalculés par morceau (plat, sec, hors objet).

### 6.5 AOI et bande passante

- La grille AOI de 32 m (`server/src/aoi.js`) et `VIEW_RADIUS = 80` ne changent pas : la taille du monde ne coûte
  **rien** au réseau, seul compte le nombre d'entités proches. Les joueurs seront plus dispersés qu'aujourd'hui.
- **Option « deuxième anneau »** (à décider avec le rendu) : entre 80 et 300 m, seulement les grandes entités (boss,
  boss mondiaux, montures, repères animés) à 2 Hz, champs réduits (`x z ry s`) — évite qu'un géant de givre de 12 m
  apparaisse d'un coup devant un paysage vu à 3 km. Coût estimé ≤ 1 Ko/s par client.
- Les coordonnées envoyées grandissent de 1 à 2 caractères (±2 048 au lieu de ±160) : +3 % sur les snapshots,
  absorbé par la compression.

### 6.6 État persistant par morceau

- Petit et additif : fichier `server/data/world/state.json` (écriture atomique des seuls morceaux modifiés, comme les
  comptes) avec, par morceau : points de récolte épuisés (`respawnAt`), boss et élites (`respawnAt`), portes et
  leviers de monde, sacs de butin des zones rouges (10 min, perdus au redémarrage : acceptable), événements en cours.
- Ce qui est **par joueur** reste dans le compte : coffres ouverts, pierres de téléportation découvertes, brouillard
  de guerre (§11), quêtes.

---

## 7. Précision des coordonnées

- **Serveur** : nombres JavaScript 64 bits, aucun problème.
- **Client, sommets** : three calcule `modelViewMatrix` en 64 bits sur le processeur puis l'envoie en 32 bits :
  les positions sont déjà relatives à la caméra. À ±2 048 m le pas du float32 est 0,24 mm : suffisant.
- **Client, shaders en coordonnées monde** : c'est là que ça casse. L'herbe, le vent, l'anti-répétition du terrain et
  les effets utilisent la position monde dans des bruits et des hachages (`fract(sin(dot(p, …)) × 43758)`), qui
  dégénèrent dès quelques centaines de mètres (motifs, scintillement, herbe « figée » en blocs).
  → **Origine flottante** : la scène est décalée par pas de 256 m quand la caméra s'éloigne de plus de 512 m de
  l'origine courante ; les shaders reçoivent `uOrigin` (décalage entier) et calculent leurs bruits sur
  `mod(position + uOrigin, période)` avec des périodes entières (256, 1 024 m). Les hachages passent en entiers
  (`uint` en GLSL ES 3.0). Le rebasage coûte une mise à jour des matrices de la racine de scène : invisible.
- **Profondeur** : avec 5 km de vue, un tampon de profondeur classique (near 0,1) fait scintiller les montagnes.
  → near 0,3 (caméra à la troisième personne) et **deux tranches** : le lointain (terrain L2–L4, imposteurs, océan
  lointain) est dessiné d'abord avec near 350 / far 6 000, puis la profondeur est vidée et la scène proche dessinée
  avec near 0,3 / far 400. Si `EXT_clip_control` est disponible, profondeur inversée en float 32 bits et une seule
  tranche. Le post-traitement (brouillard, nuages, AO) reçoit une profondeur linéaire recomposée.

---

## 8. Brouillard et perspective aérienne

- Le brouillard de hauteur « volumétrique » de render-souls est gardé ; il gagne une **référence d'altitude par
  biome** (brume qui stagne dans les marais et la forêt de brume à 4–10 m au-dessus du sol, voile de chaleur au
  désert, air pur et bleuté en montagne) lue dans une petite texture de climat (64², 64 m/px).
- **Perspective aérienne** : au-delà de 800 m, teinte bleutée et désaturation selon la distance et l'altitude
  (l'air est plus clair en haut) : c'est elle qui donne l'échelle « Zelda » aux montagnes lointaines. Une table
  précalculée par image (32 × 32 × 16) suffit, ≈ 0,1 ms.

---

## 9. Nuages volumétriques (WebGL2)

### 9.1 Modèle

- **Une couche de nuages** entre 900 et 1 800 m d'altitude (au-dessus du plus haut sommet) + une **couche basse
  optionnelle** 420–700 m, seulement autour des sommets et en temps de pluie (« mer de nuages » vue depuis Givreval).
- Densité = **carte météo 2D** (256², couvre 16 km, défile avec le vent : couverture, type de nuage, précipitations)
  × **profil vertical** selon le type (cumulus, stratus, cumulonimbus d'orage) × **bruit 3D** de forme (Perlin-Worley
  128³ RGBA8, 8 Mo) − **bruit de détail** (Worley 32³, 128 Ko) sur les bords.
- Les textures 3D sont **générées sur le GPU au chargement** (rendu dans les couches d'une texture 3D, 128 appels une
  seule fois, ≈ 150 ms) : rien à télécharger. Préréglage Bas/Moyen : 64³.

### 9.2 Rendu

- Lancer de rayons dans un **tampon réduit** (¼ de la définition sur chaque axe à Élevé, soit 480 × 270 en 1080p),
  **gigue par bruit bleu** de l'origine du rayon, 24–48 pas primaires adaptatifs (grands pas dans le vide, petits dans
  les nuages), 4–6 pas vers le soleil pour l'ombrage, diffusion Henyey-Greenstein double lobe + « poudre » (bords
  argentés au soleil, cœur sombre des orages).
- **Reprojection temporelle** : l'image précédente est reprojetée (les nuages sont loin : reprojection par direction
  avec le mouvement du vent) et mélangée à 90 % ; rejet quand l'écart est trop grand (voisinage 3 × 3). Résultat
  stable, sans bruit, pour un coût de ¼ × ¼.
- **Sur-échantillonnage** vers la pleine définition avec la profondeur (les montagnes découpent proprement les
  nuages), composé **avant** le brouillard et les rayons de lumière (les nuages bouchent le soleil → les rayons
  divins passent entre eux, référence image 8).
- Les nuages entrent dans la capture IBL (cube map 128² rafraîchie toutes les 0,6 s) : un ciel couvert assombrit et
  bleuit toute la scène.
- Rayons arrêtés à la profondeur du terrain ; au-dessus de la couche (vue depuis un sommet), on voit la mer de nuages
  d'en haut.

### 9.3 Ombres de nuages

- Toutes les 4 images, une passe 256² intègre la densité le long de la direction du soleil au-dessus de la zone de
  3 km autour du joueur → **carte de transmittance** lue par le terrain, la végétation, l'eau et le brouillard (la
  lumière du soleil est multipliée). On voit les **ombres des nuages courir sur les plaines** avec le vent. Coût
  ≈ 0,1 ms. Même carte au préréglage Bas (calculée depuis la carte météo 2D seulement).

### 9.4 Coût par préréglage (estimation sur la machine de mesure de RENDU.md, RX 6650 XT, 1080p)

| | Bas | Moyen | Élevé | Ultra |
|---|---|---|---|---|
| Méthode | ciel 2D actuel (`sky.js`) + ombres de nuages depuis la carte météo | volumétrique ⅛ déf., 24 pas, bruit 64³ | volumétrique ¼ déf., 32 pas, 128³ | ¼ déf., 48 pas, 128³ + détail, couche basse |
| Temps GPU | 0,1 ms | 0,6 ms | 1,1 ms | 1,8 ms |
| Mémoire | 0,3 Mo | 2 Mo | 9 Mo | 9 Mo |

Si `EXT_color_buffer_float` manque ou si le test de démarrage mesure plus de 2,5 ms pour la passe : retour
automatique au mode Bas pour les nuages seulement.

---

## 10. Météo : points d'accroche

- **Serveur autoritaire**, par **zone climatique** (dérivée du biome de la carte de contrôle : tempéré, marais,
  désert, montagne, côte tropicale, volcan). Machine à états avec transitions de 30 à 90 s : `clair`, `nuageux`,
  `pluie`, `orage`, `neige`, `tempête de sable`, `brume`, `cendres` (volcan).
- **Protocole (additif)** : S2C `weather { z: zoneId, k: kind, i: intensité 0–1, w: [dx, dz, force], t: finMs }`
  envoyé à l'entrée dans une zone et à chaque changement ; le client garde la météo de chaque zone connue et
  **mélange** sur 200 m aux frontières.
- **Client** : couverture et type des nuages (carte météo), densité et couleur du brouillard, vent (herbe, arbres,
  vagues, dunes qui fument), sol mouillé (rugosité, flaques), effets CX-6 (`rain_streaks`, `snowflakes`,
  `sandstorm`, `lightning_flash`…), éclairs qui éclairent la scène, HDRI `sky_overcast`, sons.
- **Crochets de jeu** (à décider par le design, le moteur les expose) : visibilité réduite (tempête de sable :
  `VIEW_RADIUS` inchangé, mais brouillard à 60 m), sols glissants, monstres propres à une météo (spectres par temps
  de brume), bonus d'éléments (givre plus fort sous la neige).
- Heure du jour : `DAY_LENGTH_S` et `tod` inchangés (identiques partout sur la carte).

---

## 11. Minicarte et carte du monde

- Cuites avec le terrain (`world/out/map/`) à partir de la carte de hauteurs et de la carte de contrôle : **ombrage de
  relief** (lumière du nord-ouest), couleurs par biome, **courbes de niveau tous les 20 m** (maîtresses tous les
  100 m : elles montrent la typologie des hauteurs du §3), mer en dégradé de profondeur, rivières, routes, falaises
  hachurées. Style : **parchemin sépia** avec encre sombre (dans l'esprit de la référence, image 1), sans en copier le
  dessin.
- Pyramide de tuiles WebP 512 × 512 : niveaux 1 024² (4 m/px), 2 048² (2 m/px), 4 096² (1 m/px, minicarte) :
  ≈ 3,5 Mo au total, téléchargées à la demande.
- **Brouillard de guerre** : 64 × 64 cases de 64 m par compte = 4 096 bits = 512 octets (base64 dans le compte,
  migration additive) ; révélées dans un rayon de 150 m autour du joueur ; les pierres de téléportation révèlent
  400 m.
- Surcouches dessinées par le client : zones rouges (bordure rouge, §2 bis), noms de régions, pierres de
  téléportation, repères de quête, membres du groupe.

---

## 12. Tailles des données

| Donnée | Brut | Servi (brotli) | Chargé quand |
|---|---|---|---|
| Carte de contrôle | 256 Ko | 150 Ko | au démarrage (client et serveur) |
| Carte globale 8 m | 526 Ko | ≈ 300 Ko | au démarrage |
| Albédo global 1024² (KTX2) | 1 Mo | ≈ 700 Ko | au démarrage |
| Tuile de 256 m (hauteurs 129² + matériaux + herbe) | 50 Ko | ≈ 20 Ko | en jeu, anneaux du §4.3 |
| Toutes les tuiles (256) | 12,8 Mo | ≈ 5 Mo | jamais d'un coup |
| Cartes du monde (pyramide) | — | ≈ 3,5 Mo | à l'ouverture de la carte / minicarte |
| Imposteurs d'arbres (≈ 12 espèces, KTX2) | — | ≈ 6 Mo | au premier arbre lointain de l'espèce |
| **Premier chargement ajouté** | | **≈ 1,5 Mo** (+ anneau obligatoire 180 Ko) | |
| Serveur : mémoire monde | ≈ 45 Mo (hauteurs, matériaux, contrôle, cache de morceaux) | | |

---

## 13. Budgets de performance

### 13.1 Client (1080p, GPU moyen de référence RX 6650 XT ; « petit PC » = iGPU Intel Iris Xe / UHD 620)

| | Bas | Moyen | Élevé | Ultra |
|---|---|---|---|---|
| Images / s visées | 30 (petit PC) · 60 | 60 | 60 | 60 (144 si possible) |
| Temps GPU total | ≤ 14 ms | ≤ 12 ms | ≤ 13 ms | ≤ 15 ms |
| dont terrain | 1,0 | 1,5 | 2,0 | 2,5 |
| dont végétation + objets | 2,0 | 3,0 | 3,5 | 4,0 |
| dont ombres | 0 | 1,5 | 2,0 | 2,5 |
| dont nuages + ciel | 0,1 | 0,6 | 1,1 | 1,8 |
| dont eau | 0,3 | 0,5 | 0,6 | 0,8 |
| dont post-traitement | 0,5 | 2,0 | 2,5 | 2,5 |
| Appels de dessin (toutes passes) | ≤ 150 | ≤ 250 | ≤ 350 | ≤ 450 |
| Triangles | ≤ 1 M | ≤ 2 M | ≤ 3,5 M | ≤ 5 M |
| Distance d'affichage du terrain | 900 m | 1,6 km | 3 km | 5 km |
| CPU thread principal (jeu + rendu + diffusion) | ≤ 8 ms | ≤ 7 ms | ≤ 7 ms | ≤ 7 ms |

La résolution dynamique existante (55–100 %) reste le premier amortisseur.

### 13.2 Serveur (20 ticks/s, budget 50 ms)

| Mesure | Objectif |
|---|---|
| Tick p95, 200 joueurs dispersés sur la carte, ≈ 4 000 monstres placés | ≤ 10 ms |
| Tick p95, 100 joueurs dans une même foule (test actuel) | ≤ 5 ms (inchangé) |
| Activation de morceaux | ≤ 1 ms par tick (étalée) |
| Mémoire | ≤ 400 Mo RSS |
| Démarrage (chargement du monde cuit) | ≤ 2 s |

### 13.3 Réseau

- ≤ 20 Ko/s par client dans le pire cas (objectif actuel), ≤ 6 Ko/s en exploration ; le monde lui-même passe par
  HTTP (tuiles en cache), jamais par le WebSocket.

---

## 14. Migration des joueurs

1. Chaque compte gagne `wv` (version du monde, défaut 1) dans la migration unique `sanitizeAccount` (§4.2 de la
   feuille de route).
2. Au chargement d'un compte `wv < 2` : les positions de l'ancienne carte restent valides telles quelles (même x/z,
   l'altitude n'est jamais sauvegardée). Si la position n'est plus marchable (bord de l'ancienne chaîne de montagnes
   supprimée, rive modifiée), le joueur est placé au **point sûr le plus proche** (§6.4), à défaut au
   `SPAWN_POINT`.
3. Les échos de mort (`echo`) hors zone marchable sont déplacés de la même façon.
4. Le brouillard de guerre de la v0.3 est pré-révélé sur l'ancienne carte (les joueurs la connaissent déjà).
5. Test : la fixture v0.1 (`server/test/fixtures/v0.1/accounts.json`) doit charger sans perte, positions comprises.

---

## 15. Risques et replis

| Risque | Probabilité / impact | Repli |
|---|---|---|
| **Monde vide** : 16 km² trop grands pour le contenu disponible | élevé / élevé | ouverture par étapes (§1.1), densité de POI obligatoire par région avant ouverture, téléportation dense |
| Cuisson non reproductible (version de Node, ordre flottant) | moyen / élevé | `world.lock` vérifié au build ; version de Node figée dans le Dockerfile ; en dernier recours, versionner les sorties (Git LFS) |
| Petits PC (iGPU) sous 30 i/s | élevé / élevé | préréglage Bas : nuages 2D, pas d'ombres, CDLOD à 3 niveaux et 900 m, imposteurs dès 60 m, herbe à 30 %, résolution dynamique jusqu'à 50 % |
| Mémoire GPU saturée sur iGPU (mémoire partagée) → perte de contexte WebGL | moyen / élevé | plafonds du §4.6, KTX2 partout, écoute de `webglcontextlost` avec rechargement propre des ressources |
| Saccades en traversant les tuiles | moyen / moyen | budget par image (§4.5), préchargement dans la direction de marche, shaders préchauffés |
| Imposteurs qui « sautent » au changement de LOD | moyen / faible | fondu tramé (dithering) de 0,3 s entre LOD2 et imposteur |
| Motifs et scintillement des bruits en coordonnées monde | certain sans correctif / moyen | origine flottante + hachages entiers (§7) |
| Scintillement de profondeur au loin | certain sans correctif / moyen | deux tranches de profondeur ou profondeur inversée (§7) |
| Nuages volumétriques trop chers | moyen / moyen | détection au démarrage, repli 2D (§9.4) ; ombres de nuages gardées dans tous les cas |
| Grimpette sur les montagnes par tricherie (téléportation verticale, pentes) | moyen / moyen | validation de pente au serveur (§6.4), `security.flag` sur les montées refusées répétées |
| Zones d'apparition trop nombreuses réveillées à la fois (grosse foule qui court) | faible / moyen | activation étalée (≤ 4 morceaux par tick), priorité par distance |
| Téléchargement lent (mobile, ADSL) | moyen / faible | anneau obligatoire réduit à 1 tuile en réseau lent (`navigator.connection`), terrain 8 m en attendant |
| Travaux en parallèle sur `terrain.js` / `worldObjects.js` (render-souls) | certain / moyen | le CDLOD et la diffusion vont dans de **nouveaux fichiers** (`render/terrainStream.js`, `render/cdlod.js`, `render/clouds.js`, `render/ocean.js`) ; l'ancien terrain reste le repli tant que le nouveau n'est pas validé |

---

## 16. Ordre de réalisation proposé

1. `shared/world/heightfield.js` + format des tuiles + script `world:bake` (sans érosion) + façade `terrainHeight` —
   l'ancienne carte doit être **identique** à la v0.2 à +32 m près (test automatique sur 10 000 points).
2. Serveur : chargement du monde cuit, morceaux dormant / tiède / actif, collisions par morceau, validation de pente.
3. Client : CDLOD + diffusion des tuiles + origine flottante + deux tranches de profondeur.
4. Objets par morceau (client et serveur), imposteurs, albédo global.
5. Océan, rivières, lacs, rivage.
6. Carte de contrôle issue des JSON du cartographe, types de relief, érosion.
7. Nuages volumétriques, ombres de nuages, météo serveur.
8. Carte du monde, minicarte, brouillard de guerre, migration `wv`.
9. Test de charge « monde entier » (`tests/load.mjs --spread-world`) et mesures des §13.

Chaque étape garde `npm test` et `npm run build` au vert et peut être publiée seule.
