# Monde ouvert v0.3 — cadre technique

> Version finale du brouillon de l'architecte (`drafts/tech.md`), recalée sur les données réellement produites
> (`heightmap.png`, `world_layout.json`, voir [`MONDE.md`](MONDE.md) §0 et §2). **Aucune mesure n'a encore été
> faite** : les coûts, tailles et temps ci-dessous sont des estimations à confirmer pendant la réalisation (§12).
> Les agents de code gardent la main sur les noms de fichiers ; ce document fixe les contrats.

---

## 0. Décisions

| Sujet | Décision |
|---|---|
| Taille | 4 096 × 4 096 m jouables (x −2 048…2 048, z −2 560…1 536), océan jusqu'à l'horizon ; moteur prévu pour 8 192 m sans refonte |
| Source du relief | `docs/world/heightmap.png` : 1 025², pas de 4,5 m, 4 608 m de côté, `h = u16 × 0,01 − 60`, généré par `docs/world/tools/gen_world.mjs` (déterministe, vérifié octet pour octet) |
| Ancienne carte | mêmes x/z, relevée de **+45 m**, raccord arrondi 170 → 450 m (MONDE §2) ; l'ancienne muraille de bordure disparaît |
| Cuisson | un script Node **une fois** (au build) : tuiles 2 m (détail ajouté), carte globale 8 m, matériaux, distance au rivage, carte du monde. Le client **ne recalcule jamais** le relief |
| Codage | `u16`, 1 cm, −60…595 m, identique dans la source, les tuiles, le serveur |
| Pentes | marchable ≤ **40°** (montée refusée au-delà par le serveur), gué ≤ 0,8 m |
| Client | CDLOD instancié (5 niveaux), tuiles de données de 256 m, carte globale 8 m toujours en mémoire, imposteurs d'arbres, budget de diffusion ≤ 2 ms par image |
| Serveur | carte de hauteurs complète en mémoire, objets et collisions **par morceau de 64 m** (dormant / tiède / actif), apparitions qui dorment, AOI de 32 m et `VIEW_RADIUS = 80` inchangés |
| Précision | origine flottante par pas de 256 m ; profondeur en deux tranches (ou inversée si disponible) |
| Nuages | volumétriques en ¼ de définition + reprojection temporelle, ombres de nuages au sol ; repli 2D sur petits PC |
| Météo | serveur autoritaire par zone climatique, message additif `weather` |

---

## 1. Taille et limites

| Côté | À pied (6,5 m/s) | Sprint | Monture v0.4 (≈ 14 m/s) |
|---|---|---|---|
| 360 m (v0.1–v0.2) | 55 s | 38 s | — |
| **4 096 m (v0.3)** | **10 min 30** | **7 min 15** | **≈ 5 min** |
| 8 192 m (extension) | 21 min | 14 min 30 | ≈ 10 min |

| Limite | Valeur | Origine |
|---|---|---|
| Côté jouable max sans refonte | 8 192 m | index de morceau 8 bits signés par axe (128 × 64 m), float32 avec origine flottante |
| Altitudes | −60…595 m (codage) ; jeu ≤ 405 m, décor ≤ 574 m | `u16` au centimètre |
| Distance de vue du terrain | 5 km (Ultra), 3 km (Élevé), 1,6 km (Moyen), 900 m (Bas) | §3, §11 |
| Objets statiques | ≈ 350 000 générés, ≤ 30 000 instances visibles | §3.4 |

La vraie limite est la **densité de contenu** : un lieu tous les 150–250 m, une pierre tous les 600–800 m, une ville ou
un camp par région ouverte. D'où l'ouverture par étapes (MONDE §15).

---

## 2. Relief : source → cuisson → tuiles

### 2.1 Chaîne

```
docs/world/tools/world_spec.mjs   (formes : ancres, crêtes, sommets, volcan, plateaux, mesas, dunes, marais, côtes,
        │                          îles, lacs, rivières, routes, villes, régions)
        ▼  node docs/world/tools/gen_world.mjs  (≈ 40 s, graine 7331)
docs/world/heightmap.png (1 025², 4,5 m)  +  tools/out/carto.json (mesures, carte de contrôle 32 m)
        ▼  node docs/world/tools/build_layout.mjs  (+ tools/content_spec.mjs)
docs/world/world_layout.json   ← vecteurs, régions, carte de contrôle : ce que lit la cuisson
        ▼  npm run world:bake   (à écrire, vague 2 ; Node, déterministe)
world/out/height_2m/<tx>_<tz>.bin    tuiles de 256 m : 129² u16 (2 m) + matériaux u8 + masque d'herbe
world/out/height_8m.bin              577² u16 (8 m), carte globale (horizon, serveur lointain, carte du monde)
world/out/material_2m, shore_sdf     matériau dominant, distance signée au rivage (écume, sable mouillé)
world/out/map/*.webp                 pyramide de la carte du monde (§10)
world/out/world.lock                 sha256 de chaque sortie + version du monde
```

Façonnage de `gen_world.mjs`, dans l'ordre : basses terres et distance à la côte → crêtes et sommets (ridged) →
volcan → plateaux et mesas (terrasses) → dunes et marais → côte, îles, bancs de sable → érosion par gouttes (masquée,
nulle sur l'ancienne carte et les dunes) → ravins → lacs (bords sans fuite) → rivières (lit forcé décroissant,
méandres) → replats des villes → routes (profil faisable en pente, moyenne déblai/remblai, ponts automatiques) →
réapplication de l'ancienne carte → classification eau/pente → régions et biomes → contrôles d'accès (Dijkstra).

### 2.2 Cuisson (`world:bake`)

1. Lecture bicubique de la source 4,5 m → grille 2 m (2 305²) ; les routes, replats et lits de rivières sont repris
   depuis `world_layout.json` (vecteurs) pour rester nets à 2 m.
2. Détail ≤ 0,4 m (bruit entier `hash2i`), hors routes, replats et ancienne carte (qui reste identique à la v0.2 + 45 m).
3. Matériau dominant par échantillon : biome (carte de contrôle, fondu 64–160 m) × étage (MONDE §3.1) × pente (§3.2).
4. Carte globale 8 m par **moyenne 4 × 4** (pas un sous-échantillonnage : les sommets ne « vibrent » pas au loin).
5. Distance signée au rivage, carte du monde, `world.lock`.

- **Versionné** : `docs/world/**` (sources, ≈ 3 Mo), le script de cuisson et `world.lock`. **Généré** au build Docker
  (même version de Node, épinglée) et au `npm run dev`, vérifié contre `world.lock` (écart = build en échec). Repli si la
  cuisson devient non reproductible : versionner les sorties avec Git LFS.
- **Pourquoi pas côté client** : `Math.sin/exp/pow` ne donnent pas les mêmes derniers bits selon les navigateurs, et
  l'érosion amplifie l'écart. Client et serveur lisent **les mêmes octets**.

### 2.3 Lecture (partagée client / serveur)

```js
// shared/world/heightfield.js — O(1), sans allocation
heightAt(x, z)        // bilinéaire sur la meilleure grille disponible (2 m, sinon 8 m)
normalAt(x, z, out)   slopeAt(x, z)   materialAt(x, z)
biomeAt(x, z)  regionAt(x, z)  landformAt(x, z)   // carte de contrôle (32 m, plus proche voisin)
waterLevelAt(x, z)    // 0 pour la mer, niveau propre pour chaque lac, étang et tronçon de rivière, -Infinity sinon
```

`shared/world.js` garde ses exports (`terrainHeight`, `isWalkable`, `regionAt`…) comme façade ; `WORLD_LIMIT` devient
2 040. Une lecture bilinéaire ≈ 20 ns contre ≈ 2 µs pour le bruit actuel.

---

## 3. Diffusion côté client

### 3.1 Découpage

| Unité | Taille | Rôle |
|---|---|---|
| Tuile de données | 256 m (18 × 18 sur la grille de 4 608 m) | téléchargement : hauteurs 2 m + matériaux + herbe |
| Patch de terrain | 64 m | nœud CDLOD, 33 × 33 sommets, un seul maillage partagé |
| Morceau d'objets | 64 m | génération déterministe des objets, collisions serveur |
| Lot d'instances | 128 m | regroupement des appels de dessin |
| Tuile d'herbe | 24 m | inchangé (render-souls) |

### 3.2 Terrain CDLOD

Le terrain actuel (grille complète dans un worker) ne passe pas à 4 km (≈ 140 Mo). Passage à un **quadtree CDLOD** :
maillage de patch unique, instances par niveau, hauteur lue dans le vertex shader, morphing entre niveaux.

| Niveau | Pas | Jusqu'à | Source |
|---|---|---|---|
| L0 | 2 m | 200 m | tuiles 2 m (tableau de textures, 64 couches max) |
| L1 | 4 m | 450 m | tuiles 2 m |
| L2 | 8 m | 1 000 m | carte globale 8 m (toujours en mémoire) |
| L3 | 16 m | 2 200 m | carte globale 8 m |
| L4 | 32 m | horizon | carte globale 8 m |

≈ 11 appels de dessin (5 niveaux + cascades d'ombre). Le splat PBR à 10 couches de render-souls est conservé près du
joueur ; au-delà de 1 km, une **albédo globale** 1 024² cuite (avec couleur de forêt et ombrage doux) le remplace.
Tuile absente : carte 8 m + splat par biome, puis fondu de 0,4 s ; on ne tombe jamais dans un trou.

### 3.3 Anneaux de téléchargement

Obligatoire 3 × 3 tuiles (768 m) avant de quitter l'écran de chargement ; anticipé 5 × 5, trié par distance **et
direction de marche** ; conservé 7 × 7 (LRU au-delà). Fichiers brotli à empreinte (`immutable`), en cache navigateur
et service worker (PWA / launcher). Téléportation : attendre l'anneau obligatoire de la destination (≈ 150 Ko).

### 3.4 Végétation et objets

- `chunkObjects(cx, cz) → [{type, x, z, ry, s, r}]`, fonction pure partagée client / serveur, graine
  `hash2i(cx, cz, WORLD_SEED)`, échantillonnage Poisson selon biome, étage, pente, distance aux routes et à l'eau
  (densités : ASSETS_MONDE §2). Les objets posés à la main viennent de `world_layout.json`.
- Client : génération dans le worker de terrain (0,2–0,6 ms par morceau), `InstancedMesh` par (espèce, LOD, lot),
  tampons pré-alloués et recyclés.

| Objet | LOD0 | LOD1 | LOD2 | Imposteur | Au-delà |
|---|---|---|---|---|---|
| Arbres | 45 m | 110 m | 220 m | jusqu'à 1 200 m | couleur de forêt dans l'albédo globale |
| Rochers, falaises | 50 m | 120 m | 400 m | — | 900 m (petits : 250 m) |
| Bâtiments, repères | 60 m | 150 m | 2 000 m | Arbre-Brume : imposteur à l'infini | jamais |
| Buissons, fleurs | 40 m | — | — | — | 105 m |

- **Imposteurs octaédriques** (8 × 8 vues, atlas couleur + normale) rendus par le kit Blender : ajout proposé au contrat
  ROADMAP §4.4 (`<clé>_impostor.webp` + `.json`). Au loin, un arbre sur 3 à 6 (agrandi de 20 %). Fondu tramé 0,3 s.

### 3.5 Budgets

| Travail du thread principal | Par image |
|---|---|
| Envoi d'une tuile au GPU | 1 max |
| Instances copiées | ≤ 4 000 |
| Compilation de shader | aucune en jeu (préchauffage à l'écran de chargement) |
| Mise en place de GLB | ≤ 1 (décodage en worker) |
| **Total diffusion** | **≤ 2 ms** |

| | Bas | Moyen | Élevé | Ultra |
|---|---|---|---|---|
| Tuiles 2 m en GPU | 25 | 36 | 49 | 64 |
| Mémoire GPU visée | ≤ 600 Mo | ≤ 1 Go | ≤ 1,5 Go | ≤ 2,5 Go |
| Tas JavaScript | ≤ 250 Mo | ≤ 300 Mo | ≤ 350 Mo | ≤ 400 Mo |
| Instances visibles | 8 000 | 15 000 | 22 000 | 30 000 |

Grands atlas en KTX2 / Basis (transcodeur servi localement, pas de CDN). Pools de taille fixe : pas de croissance
mémoire au fil d'une longue session.

---

## 4. Horizon, océan, eau douce

- **Au-delà de la carte** : mer au sud et à l'est, murailles de montagnes au nord et à l'ouest (dans la source jusqu'à
  574 m). Au-delà de ±2 048 m sur l'eau : courant qui ramène au rivage (« Les courants vous repoussent vers le
  rivage. »). Îles décoratives lointaines dans la carte 8 m étendue.
- **Océan infini** : anneaux concentriques centrés sur la caméra, déplacés par pas entiers de maille ; 4–6 vagues de
  Gerstner jusqu'à 400 m puis normales seules ; hauteur liée au vent de la météo (0,3 à 2,5 m). **Couleur selon la
  profondeur** lue dans le relief : écume `#F4FAF7` → hauts-fonds `#9FEADB` → lagon `#3FC6C8` → chenal `#1E8FB0` →
  large `#15557E` → grand fond `#0C2E4E` ; absorption (fond visible jusqu'à ≈ 6 m), Fresnel IBL, reflet du soleil.
  Rivage : bandes d'écume qui avancent (`fract(sdf / longueur − t)`), sable mouillé, amortissement sur les hauts-fonds.
  1 appel, ≈ 0,6 ms (Élevé).
- **Lacs** : un plan par lac à son `level` ; **étangs du marais** : plan à 4 m découpé par le polygone ; **lave** :
  même maillage, matériau émissif. **Rivières** : ruban le long de `surfaceProfile` (niveau décroissant), UV qui
  défilent, écume aux ruptures de pente ; **cascades** : nappe + flipbooks `waterfall_sheet`, `waterfall_mist`.
- Serveur : `waterLevelAt` ; on marche jusqu'à 0,8 m (vitesse × 0,6), au-delà non marchable (pas de nage en v0.3).

---

## 5. Précision

- Serveur : nombres 64 bits, rien à faire.
- Client, sommets : matrices calculées en 64 bits par three, envoyées relatives à la caméra (0,24 mm à 2 km).
- Client, shaders en coordonnées monde (herbe, vent, anti-répétition, effets) : **origine flottante** par pas de
  256 m quand la caméra s'éloigne de plus de 512 m ; `uOrigin` entier, bruits sur `mod(p + uOrigin, période)` avec
  des périodes entières (256, 1 024 m), hachages en `uint` (GLSL ES 3.0).
- Profondeur : near 0,3 ; deux tranches (lointain near 350 / far 6 000 puis proche near 0,3 / far 400) ; profondeur
  inversée en float 32 bits si `EXT_clip_control` est disponible.

---

## 6. Serveur

### 6.1 Mémoire

Carte de hauteurs 2 m complète (2 305² u16 ≈ 10,6 Mo) + carte de contrôle + matériaux : lecture O(1), aucune
activation nécessaire pour le relief. Objets générés à la demande par morceau de 64 m.

### 6.2 Morceaux

| État | Condition | Contenu |
|---|---|---|
| Dormant | aucun joueur à moins de 384 m depuis 60 s | seulement l'état persistant du morceau |
| Tiède | un joueur à moins de 384 m | objets, grille de collision, apparitions préparées, monstres endormis |
| Actif | un joueur à moins de 192 m | IA à pleine cadence (règle `aoi.js` : `WAKE_RADIUS = VIEW_RADIUS + 24`) |

Dormant → tiède : 0,3–0,8 ms par morceau, **≤ 4 morceaux par tick**, file triée par distance ; LRU de 1 500 morceaux
tièdes (≈ 30 Mo).

### 6.3 Apparitions qui dorment

Chaque zone d'apparition appartient à un morceau ; dormante, elle garde ses comptes et des **horodatages absolus**
`respawnAt`. Au réveil, elle recrée les manquants échus (hors vue si possible) ; boss et élites gardent leur minuterie
absolue (pas de farm en entrant / sortant). Un monstre qui poursuit empêche son morceau de s'endormir. Attendu :
≈ 4 000 monstres placés, 10–20 % en mémoire, ≈ 5 % éveillés avec 200 joueurs dispersés.

### 6.4 Collisions et déplacements

Grille de collision de 4 m par morceau (cercles des objets statiques). Validation du mouvement (contrat `anticheat`) :
montée refusée au-delà de **40°**, arrivée refusée sous l'eau profonde (> 0,8 m), `maxSpeedAt` intègre × 0,75 en montée
raide et × 0,6 dans l'eau ; `security.flag` sur les montées refusées répétées. Lignes de vue : DDA sur la carte de
hauteurs (4 m), ≈ 1 µs. Points sûrs précalculés par morceau (plat, sec, hors objet) pour apparitions et téléportations.

### 6.5 AOI et réseau

La grille AOI de 32 m et `VIEW_RADIUS = 80` ne changent pas : la taille du monde ne coûte rien au réseau. Coordonnées
à 4 chiffres (+3 % sur les instantanés, absorbé par la compression). **Option à décider avec le rendu** : un
« deuxième anneau » 80–300 m à 2 Hz pour les grandes entités seulement (boss, montures, repères animés ; champs
`x z ry s`), ≤ 1 Ko/s par client, pour qu'un géant de 12 m n'apparaisse pas d'un coup devant un paysage vu à 3 km.

### 6.6 État persistant

`server/data/world/state.json` (écriture atomique des seuls morceaux modifiés) : filons épuisés, boss et élites
(`respawnAt`), portes et leviers, sacs de butin des zones rouges (perdus au redémarrage : acceptable), événements. Par
joueur (dans le compte) : coffres ouverts, pierres découvertes, brouillard de guerre, Brumillons trouvés, quêtes.

---

## 7. Brouillard et perspective aérienne

Brouillard de hauteur de render-souls conservé, avec **référence d'altitude et couleur par biome** (brume au ras des
marais et du Bois des Égarés, voile de chaleur au désert, air pur en montagne) lues dans une texture de climat 72²
(64 m/px, cuite depuis la carte de contrôle). Au-delà de 800 m, **perspective aérienne** (bleuissement, désaturation,
plus claire en altitude) : c'est elle qui donne l'échelle aux montagnes lointaines. Table 32 × 32 × 16 par image,
≈ 0,1 ms. L'imposteur de l'Arbre-Brume ignore 60 % du brouillard lointain (repère toujours visible).

---

## 8. Nuages volumétriques et météo

### 8.1 Nuages

- **Couche principale** 600–1 600 m au-dessus de la mer (base de 600 à 900 m selon le biome, au-dessus du plus haut
  sommet jouable de 405 m) ; **couche basse** facultative 180–550 m, seulement là où la carte météo la demande :
  bancs sur la mer, **mer de nuages** sous les pics de Givreval, panache du volcan, stratus du marais, brume dans la
  canopée (valeurs par biome : ASSETS_MONDE §4, qui recale le brouillon artistique sur ces deux couches).
- Densité = **carte météo 2D** (256², couvre 16 km, défile avec le vent : couverture, type, précipitations) × profil
  vertical par type (cumulus, stratus, cumulonimbus) × bruit 3D Perlin-Worley 128³ − détail Worley 32³. Textures 3D
  **générées sur le GPU** au chargement (≈ 150 ms), rien à télécharger ; 64³ en Bas/Moyen.
- Rendu : lancer de rayons en ¼ de définition (480 × 270 en 1080p), gigue par bruit bleu, 24–48 pas adaptatifs,
  4–6 pas vers le soleil, Henyey-Greenstein double lobe + effet « poudre » (bords argentés) ; **reprojection
  temporelle** à 90 % ; sur-échantillonnage guidé par la profondeur ; composé avant le brouillard et les rayons de
  lumière (les rayons divins passent entre les nuages) ; les nuages entrent dans la capture IBL.
- **Ombres de nuages** : toutes les 4 images, carte de transmittance 256² sur 3 km autour du joueur, lue par terrain,
  végétation, eau et brouillard : les ombres courent sur les plaines. ≈ 0,1 ms, aussi en Bas.
- Signature par biome (couverture, altitude, couleurs) : ASSETS_MONDE §4.

| | Bas | Moyen | Élevé | Ultra |
|---|---|---|---|---|
| Méthode | ciel 2D actuel (`sky.js`) + ombres depuis la carte météo | volumétrique ⅛ déf., 24 pas, 64³ | ¼ déf., 32 pas, 128³ | ¼ déf., 48 pas, 128³ + détail, couche basse |
| Temps GPU | 0,1 ms | 0,6 ms | 1,1 ms | 1,8 ms |
| Mémoire | 0,3 Mo | 2 Mo | 9 Mo | 9 Mo |

Sans `EXT_color_buffer_float`, ou si le test de démarrage mesure plus de 2,5 ms : retour automatique au mode Bas pour
les nuages seulement.

### 8.2 Météo

- **Serveur autoritaire**, par zone climatique dérivée du biome (tempéré, marais, désert, montagne, côte tropicale,
  volcan) ; états `clair`, `nuageux`, `pluie`, `orage`, `neige`, `tempete_sable`, `brume`, `cendres`, tirés selon
  `regions[].weather` (poids), transitions de 30–90 s.
- Protocole additif : S2C `weather { z, k, i (0–1), w [dx, dz, force], t (fin, ms) }` à l'entrée dans une zone et à
  chaque changement ; le client mélange sur 200 m aux frontières.
- Client : nuages, brouillard, vent (herbe, arbres, vagues, dunes qui fument), sol mouillé, effets CX-6
  (`rain_streaks`, `snowflakes`, `sandstorm`, `lightning_flash`…), HDRI `sky_overcast`, sons.
- Crochets de jeu (exposés par le moteur, décidés par le gameplay) : brouillard à 60 m en tempête de sable
  (`VIEW_RADIUS` inchangé), sols glissants, monstres propres à une météo, froid au-dessus de 300 m à Givreval.
- Heure du jour identique partout (`DAY_LENGTH_S`, `tod`).

---

## 9. Carte du monde et minicarte

- Cuites avec le terrain depuis `heightmap.png` + `world_layout.json`, dans l'esprit de `docs/world/carte_monde.png`
  (rendu par `tools/render_map.mjs`, réutilisable par la cuisson) : couleurs de biome, ombrage nord-ouest, courbes
  (10 m, 50 m appuyées), mer en dégradé de profondeur, rivières, routes, symboles de végétation. En jeu, le texte et
  les marqueurs sont **dessinés par le client** (pas cuits) pour rester nets et traduisibles.
- Pyramide WebP 512² : 1 024² (4,5 m/px), 2 048², 4 096² (minicarte) ≈ 3,5 Mo, à la demande.
- **Brouillard de guerre** : 64 × 64 cases de 64 m = 512 octets par compte (base64, migration additive) ; révélé dans
  150 m autour du joueur, 400 m par pierre, région entière par belvédère ; pré-révélé sur l'ancienne carte.
- Surcouches : zones rouges, noms de régions, villes, pierres, donjons, quêtes, groupe, repère personnel.

---

## 10. Tailles des données

| Donnée | Brut | Servi | Chargé |
|---|---|---|---|
| Carte de contrôle + régions (`world_layout.json` allégé) | ≈ 250 Ko | ≈ 60 Ko | démarrage (client, serveur) |
| Carte globale 8 m | 666 Ko | ≈ 350 Ko | démarrage |
| Albédo globale 1 024² (KTX2) | 1 Mo | ≈ 700 Ko | démarrage |
| Tuile de 256 m | ≈ 50 Ko | ≈ 20 Ko | en jeu (anneaux) |
| Toutes les tuiles (324) | ≈ 16 Mo | ≈ 6,5 Mo | jamais d'un coup |
| Cartes du monde | — | ≈ 3,5 Mo | à l'ouverture de la carte |
| Imposteurs (≈ 12 espèces, KTX2) | — | ≈ 6 Mo | au premier arbre lointain de l'espèce |
| **Premier chargement ajouté** | | **≈ 1,1 Mo** + anneau obligatoire ≈ 180 Ko | |
| Serveur, mémoire monde | ≈ 50 Mo | | |

---

## 11. Budgets de performance (à mesurer)

Client 1080p, GPU de référence RX 6650 XT ; petit PC = iGPU Iris Xe / UHD 620. Le réglage **Bas est le plancher** : téléphones et
tablettes restent hors budget en v0.3 (contrôles tactiles prévus plus tard, ROADMAP) ; une détection au premier
lancement choisit le réglage et propose Bas sur iGPU.

| | Bas | Moyen | Élevé | Ultra |
|---|---|---|---|---|
| Images / s | 30 (petit PC) · 60 | 60 | 60 | 60 (144 si possible) |
| GPU total | ≤ 14 ms | ≤ 12 ms | ≤ 13 ms | ≤ 15 ms |
| dont terrain / végétation / ombres | 1,0 / 2,0 / 0 | 1,5 / 3,0 / 1,5 | 2,0 / 3,5 / 2,0 | 2,5 / 4,0 / 2,5 |
| dont nuages / eau / post | 0,1 / 0,3 / 0,5 | 0,6 / 0,5 / 2,0 | 1,1 / 0,6 / 2,5 | 1,8 / 0,8 / 2,5 |
| Appels de dessin | ≤ 150 | ≤ 250 | ≤ 350 | ≤ 450 |
| Triangles | ≤ 1 M | ≤ 2 M | ≤ 3,5 M | ≤ 5 M |
| Vue du terrain | 900 m | 1,6 km | 3 km | 5 km |
| CPU thread principal | ≤ 8 ms | ≤ 7 ms | ≤ 7 ms | ≤ 7 ms |

Serveur (20 ticks/s) : tick p95 ≤ 10 ms avec 200 joueurs dispersés et ≈ 4 000 monstres placés ; ≤ 5 ms pour 100 joueurs
en foule (inchangé) ; activation ≤ 1 ms par tick ; ≤ 400 Mo RSS ; démarrage ≤ 2 s. Réseau : ≤ 20 Ko/s par client au
pire, ≤ 6 Ko/s en exploration ; le monde passe par HTTP, jamais par le WebSocket.

---

## 12. Risques et replis

| Risque | Prob. / impact | Repli |
|---|---|---|
| **Monde vide** | élevé / élevé | ouverture par étapes (MONDE §15), densité de lieux vérifiée par `validate.mjs` avant d'ouvrir une région, pierres denses |
| Cuisson non reproductible | moyen / élevé | `world.lock` au build, Node épinglé ; en dernier recours sorties en Git LFS |
| Petits PC sous 30 i/s | élevé / élevé | Bas : nuages 2D, pas d'ombres, CDLOD 3 niveaux et 900 m, imposteurs dès 60 m, herbe 30 %, résolution dynamique jusqu'à 50 % |
| Mémoire GPU saturée (iGPU) → perte de contexte | moyen / élevé | plafonds §3.5, KTX2, `webglcontextlost` géré avec rechargement propre |
| Saccades en traversant les tuiles | moyen / moyen | budget par image, préchargement devant, shaders préchauffés |
| Scintillement des bruits en coordonnées monde | certain sans correctif | origine flottante + hachages entiers (§5) |
| Scintillement de profondeur au loin | certain sans correctif | deux tranches ou profondeur inversée (§5) |
| Nuages trop chers | moyen / moyen | détection au démarrage, repli 2D ; ombres de nuages gardées |
| Triche en montagne | moyen / moyen | validation de pente au serveur, `security.flag` |
| Réveil massif de morceaux | faible / moyen | ≤ 4 morceaux par tick, priorité par distance |
| Réseau lent | moyen / faible | anneau obligatoire réduit à 1 tuile (`navigator.connection`), 8 m en attendant |
| Travaux parallèles sur `terrain.js` / `worldObjects.js` | certain / moyen | le nouveau système va dans de **nouveaux fichiers** (`render/terrainStream.js`, `render/cdlod.js`, `render/clouds.js`, `render/ocean.js`) ; l'ancien terrain reste le repli |

---

## 13. Ordre de réalisation

1. `shared/world/heightfield.js`, format des tuiles, `world:bake` depuis `heightmap.png` + `world_layout.json`, façade
   `terrainHeight` ; test : l'ancienne carte identique à la v0.2 à +45 m près sur 10 000 points (|x|, |z| ≤ 160).
2. Serveur : monde cuit, morceaux dormant / tiède / actif, collisions par morceau, validation de pente, migration `wv`.
3. Client : CDLOD, diffusion des tuiles, origine flottante, deux tranches de profondeur.
4. Objets par morceau (client et serveur), imposteurs, albédo globale.
5. Océan, lacs, rivières, rivage.
6. Nuages volumétriques, ombres de nuages, météo serveur.
7. Carte du monde, minicarte, brouillard de guerre.
8. Test de charge « monde entier » (`tests/load.mjs --spread-world`) et mesures du §11.

Chaque étape garde `npm test` et `npm run build` au vert et peut être publiée seule.

---

## 14. Indépendance vis-à-vis du moteur

Les données du monde ne dépendent pas de three.js : `heightmap.png` est un PNG 16 bits standard et
`world_layout.json` un JSON documenté (MONDE §0.3), tous deux produits par des scripts Node sans dépendance. Si le
projet change un jour de moteur (question posée par l'utilisateur : Godot ou Unreal), ce travail se réimporte :
- **Godot 4** : la carte des hauteurs s'importe dans un terrain (extension type Terrain3D, qui accepte les PNG
  16 bits) ; les JSON se lisent en GDScript pour poser villes, pierres, routes et régions.
- **Unreal Engine 5** : l'outil Landscape importe les PNG 16 bits, mais attend des côtés comme 1 009, 2 017 ou 4 033
  échantillons ; il faut rééchantillonner la source (1 025² sur 4 608 m) : 1 009² (≈ 4,6 m) pour un essai, 2 017²
  (≈ 2,3 m) ou 4 033² (≈ 1,1 m, avec le détail ajouté de la cuisson) pour le jeu. Échelle verticale à régler selon le
  codage `h = u16 × 0,01 − 60`.
- **Le serveur Node autoritaire se garde** quel que soit le moteur : il ne dépend que de la carte des hauteurs et du
  layout, et parle WebSocket + JSON (`shared/protocol.js`), ce que Godot et Unreal savent faire. Un changement de
  moteur ne remplace que le **client** (rendu, entrée, interface, diffusion des tuiles), à condition de réécrire dans
  le langage du moteur les règles partagées que le client exécute aujourd'hui en JavaScript (`shared/` : prédiction
  des déplacements, combat, pentes).
- Ce qui ne se transpose pas : le code client three.js, la diffusion par tuiles HTTP telle que décrite ici (chaque
  moteur a son propre système de monde ouvert) et le jeu **dans le navigateur sans installation** : Godot 4 exporte
  pour le web mais avec un rendu simplifié (pas de nuages volumétriques ni de brouillard volumétrique en export web),
  Unreal 5 n'exporte plus pour le web ; les deux imposent alors le lanceur ou un téléchargement.
