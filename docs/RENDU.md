# Rendu — Brumeval v0.2 « Âme sombre »

Ce document décrit le moteur de rendu du client (dossier `client/src/render/`) : l'éclairage inspiré d'*Elden Ring*
(heure dorée, brume, rayons de lumière, nuits lisibles), le terrain texturé en tuiles, l'herbe et les arbres qui
ondulent au vent, l'eau, les effets visuels Blender, le panneau de réglages graphiques et les mesures de
performances.

Tout ce qui vient des autres équipes (HDRI, textures, sprites d'effets, modèles avec LOD) est **optionnel** : quand un
fichier manque, le client utilise un remplaçant procédural, sans erreur ni requête 404 (voir « Contrat des fichiers »).

---

## 1. Vue d'ensemble

```
main.js ──► Graphics (graphics.js) ── réglages (quality.js) ◄── panneau « Graphismes » (ui/panels/settings.js)
              │
              ├─ Environment (scene.js)     cycle jour/nuit, palette, brouillard, soleil/lune
              │    ├─ Sky (sky.js)          dôme de ciel procédural + HDRI mélangés, nuages, étoiles
              │    ├─ EnvironmentLighting   IBL : capture du ciel en cube map → PMREM → scene.environment
              │    │  (envmap.js)
              │    └─ CascadedShadows       ombres en cascade (2 à 4) du soleil / de la lune
              │       (shadows.js)
              ├─ Terrain (terrain.js)       tuiles de 64 m × 3 LOD, splatting PBR 10 couches, triplanaire
              │    └─ terrainData.js        hauteurs, poids de splat, masque d'herbe (Web Worker)
              ├─ GrassField (grass.js)      herbe instanciée sur GPU autour de la caméra
              ├─ Water (terrain.js)         eau PBR : normales, profondeur, écume, reflets du ciel
              ├─ WorldObjects               décor instancié par tuile de 96 m et par LOD, vent, lanternes
              ├─ wind.js                    champ de vent partagé (herbe, feuillages, tissus)
              └─ PostPipeline (post.js)     HDR → AO → brouillard volumétrique + rayons → bloom → AgX
                                            → étalonnage → vignette + grain → SMAA
Effects (effects.js) ── Flipbooks (flipbooks.js)   effets Blender en planches de sprites, repli procédural
```

## 2. Éclairage « âme sombre »

- **Matériaux physiques** (MeshStandardMaterial) partout, y compris les personnages fusionnés (couleur, rugosité,
  métal et émission cuits dans les sommets : 1 appel de dessin par personnage).
- **Éclairage par image (IBL)** : le ciel (procédural + HDRI) est capturé dans une petite cube map HDR (128²),
  préfiltrée par PMREM et utilisée comme `scene.environment`. Elle est rafraîchie au plus toutes les 0,6 s, en
  réutilisant toutes les cibles de rendu.
- **HDRI Blender** `/env/sky_{day,golden,night,overcast}.hdr` : chargées si présentes, leur luminance est mesurée
  puis normalisée pour rester cohérente avec le soleil ; elles sont **mélangées selon la hauteur du soleil**
  (jour / heure dorée / nuit, et « couvert » pour la future météo). Le soleil peint dans l'HDRI est écrêté (le vrai
  soleil est la lumière directionnelle). Échantillonnage avec gradients explicites : pas de couture verticale.
- **Palette horaire** (scene.js, 10 clés) : couleurs du ciel, du brouillard, du soleil, intensités, exposition,
  densité de brume, force des rayons et du bloom. Aube et crépuscule longs et dorés, midi doux, nuit bleutée.
- **Nuit lisible** : la lune devient la lumière principale (bleu froid, ombres), l'exposition remonte, les lanternes
  et feux de camp s'allument (sprites HDR qui « bloom » + 3 lumières ponctuelles attribuées aux sources les plus
  proches du joueur), fenêtres des maisons émissives la nuit.
- **Ombres en cascade** (shadows.js) : N lumières directionnelles = N cascades d'UNE seule lumière (un patch global
  du shader choisit la cascade la plus fine, avec fondu entre cascades). Sphères englobantes stables et alignées sur
  les texels (pas de scintillement), cascades lointaines rafraîchies une image sur 2 à 4, petits objets (fleurs,
  caisses, clôtures…) seulement dans la première cascade. Pourquoi pas `three/addons/csm` : il remplace
  `onBeforeCompile` de chaque matériau (conflit avec le vent, la transparence de ligne de vue et le terrain) et
  garde une référence à chaque matériau cloné (fuite mémoire).
- **Post-traitement HDR** (post.js), une seule chaîne de cibles réutilisées :
  1. rendu de la scène en demi-flottant + texture de profondeur ;
  2. **occlusion ambiante** (type SAO/GTAO, demi-résolution, 12 échantillons, flou bilatéral) ;
  3. **rayons de lumière** (marche radiale du masque de ciel vers le soleil ou la lune, demi-résolution) ;
  4. **brouillard de hauteur « volumétrique »** : intégrale analytique le long du rayon, densité qui dérive avec le
     vent, diffusion avant (Henyey-Greenstein) de la lumière du soleil ;
  5. **bloom** (sous-échantillonnage 13 points, remontée en tente, seuil doux) : magie, lanternes, soleil ;
  6. **AgX** (courbe « punchy ») + étalonnage : hautes lumières chaudes, ombres froides (plus froides la nuit),
     contraste, saturation, **vignette** et **grain** légers ;
  7. **SMAA**.
  Sans post-traitement (préréglage Bas), le rendu est direct avec AgX, brouillard classique et MSAA.

## 3. Terrain

- **Données** (terrainData.js, dans un Web Worker) : grille de hauteurs lue depuis `shared/world.js`, poids des 10
  couches (herbe, sol forestier, terre, route, pavés, roche, neige, sable, boue, cendre) selon les régions, la
  pente, l'altitude, la distance aux routes, le rivage ; masque d'herbe (densité, couleur, hauteur).
- **Taille de carte** : tout dérive de `WORLD_HALF` / `REGIONS` / `ROADS` de `shared/world.js`. Testé avec
  `WORLD_HALF = 400` (carte de 800 × 800 m) : 169 tuiles, terrain prêt en 3,4 s, aucune erreur ; valeur remise à 180.
- **Tuiles de 64 m**, 3 niveaux de détail (pas de 1,5 / 3 / 6 m) choisis selon la distance avec hystérésis, jupes
  double face sous les bords (aucune fissure entre LOD), élimination hors champ et au-delà de la distance
  d'affichage.
- **Matériau PBR** : tableaux de textures (albedo / normale / ORM) de 512² (1024² en Ultra), les 3 couches les plus
  fortes par pixel, mélange tenant compte de la hauteur des textures, **triplanaire pour la roche** sur les pentes
  raides, anti-répétition (second échantillon tourné) + variation macro, sol mouillé au bord de l'eau, normales au
  pixel depuis la carte de hauteur.
- Couches manquantes (`/textures/terrain/<nom>_{albedo,normal,orm}.webp`) : générées procéduralement (tuilables)
  dans le worker. La chaîne de montagnes décorative autour de la carte utilise le même matériau.

## 4. Vent, herbe et végétation

- **Champ de vent unique** (wind.js) : direction qui tourne lentement, force qui respire, **rafales qui
  voyagent** dans le sens du vent (on les voit parcourir les prairies), frémissement par sommet.
- **Herbe** (grass.js) : tuiles de 24 m autour de la caméra, un seul appel instancié par tuile, aucune donnée par
  instance côté CPU (position, taille, couleur tirées de `gl_InstanceID` + cartes du terrain). LOD par tuile
  (moins de brins, moins de segments), disparition progressive en bordure, **l'herbe s'écarte des personnages**
  (joueur + 11 personnages les plus proches), translucidité à contre-jour. Atlas `/textures/grass_blades.webp`
  (cartes alpha) s'il existe, sinon brins géométriques.
- **Arbres, buissons, fleurs, tissus** : les matériaux nommés `Leaf*`, `Foliage*`, `Grass*`, `Cloth*`, `Banner*`
  (ROADMAP §4.4, aussi `oak_Leaves`…) ondulent avec le même vent ; amplitude selon la hauteur, les tissus pendent
  depuis leur bord haut. Troncs, pierre, métal ne bougent jamais. Les ombres suivent le mouvement (matériau de
  profondeur patché). Anciennes maquettes v0.1 : règle de compatibilité pour `bush` et `flowers`.
- Ailes de moulin (nœud `Sails*`) : tournent automatiquement.

## 5. Eau

Normales `/textures/water_normal.webp` en deux couches qui défilent avec le vent (repli : vagues procédurales),
teinte selon la **profondeur** (lue dans la carte de hauteur du terrain), **écume** au rivage
(`/textures/foam.webp`, repli procédural) animée en vagues, reflets du ciel par l'IBL avec Fresnel, eau plus calme au
loin (pas de scintillement), couleurs de nuit.

## 6. Modèles

- Chargement générique des GLB (`/models/<clé>.glb`), filtrage anisotrope (4× à 16× selon le préréglage), espaces
  de couleur fixés par GLTFLoader (baseColor sRGB, normal/ORM linéaires).
- Décors statiques : sous-maillages fusionnés par matériau ; les matériaux unis sont regroupés en **un seul**
  (couleur/rugosité/métal/émission dans les sommets) → 1 appel par type et par tuile.
- **LOD** : `<clé>_lod1.glb` et `<clé>_lod2.glb` chargés s'ils existent (la liste des fichiers vient de
  `/asset-manifest.json`, généré par le plugin Vite `client/vite-asset-manifest.js`), choisis par tuile de 96 m
  selon la distance (45 m / 95 m × distance d'affichage). Petits objets masqués au-delà de 105 m.
- Instances d'entités : matériaux clonés libérés à la disparition ; géométries et textures partagées gardées.

## 7. Effets visuels (flipbooks Blender)

`/vfx/manifest.json` : `{ "<nom>": { file, cols, rows, frames, fps, loop, blending: "additive" | "normal", size } }`.
Chaque planche = **un seul InstancedMesh** (48 instances en réserve), tout est calculé dans le shader (image
courante avec fondu entre images, fondu d'entrée/sortie, croissance, dérive) : 0 coût CPU par effet, 0 appel de
dessin quand la planche n'a rien à afficher. Sprites face caméra ou posés au sol (cercles de runes), additifs
(assez lumineux pour le bloom) ou alpha (fumée, assombrie la nuit), atténués près de la caméra.

| Effet | Utilisé pour |
|---|---|
| `fire_loop` + `smoke_puff` | feux de camp (en boucle) |
| `fire_burst` | impact du Trait de feu, zones de feu |
| `explosion` + `smoke_puff` | Boule de feu |
| `frost_burst` | Nova de givre |
| `heal_aura` | Soin (suit la cible) |
| `slash_arc` | coups d'épée (remplace l'arc procédural) |
| `impact_spark` | coups reçus, flèches |
| `dust_puff` | Tourbillon, frappe du Golem, pluie de flèches, apparition / mort des monstres |
| `rune_circle` | incantations, montée de niveau, réapparition |
| `arcane_burst` | montée de niveau, Cri de guerre |
| `soul_wisp` | mort des squelettes et du Golem |
| `poison_cloud` | mort des gluants |
| `lightning_bolt` | disponible pour les futures capacités : `effects.flipbook('lightning_bolt', position, options)` |

Entrée invalide, fichier manquant ou manifeste absent : l'effet procédural d'origine est joué (aucune erreur).

## 8. Réglages graphiques (touche **O**, bouton ⚙ du menu)

| | Bas | Moyen | Élevé | Ultra |
|---|---|---|---|---|
| Ombres | non | 2 cascades 1024² | 3 cascades 2048² | 4 cascades 2048² |
| Occlusion ambiante | non | non | oui | oui |
| Brouillard volumétrique + rayons | non | oui | oui | oui |
| Herbe (densité) | 30 % | 60 % | 85 % | 100 % |
| Post-traitement (HDR, bloom, AgX, SMAA) | non (MSAA) | oui | oui | oui |
| Distance d'affichage | 70 % | 90 % | 110 % | 135 % |
| Résolution dynamique | oui | oui | oui | non |
| Définition max | 100 % | 100 % | 150 % | 200 % |
| Limite i/s | 60 | — | — | — |

- Chaque option se règle aussi séparément (le préréglage devient « Personnalisé ») ; enregistrement dans
  `localStorage` (`brumeval.graphics.v1`), valeurs corrompues corrigées.
- **Premier lancement** : court test de performance (8 images de chauffe puis 2 × 16 images mesurées au préréglage
  Élevé, ramenées à 1080p) + nom du GPU → préréglage initial. Bouton « Détection automatique » dans le panneau.
- **Résolution dynamique** : vise 85 % du budget d'image (temps GPU mesuré par `EXT_disjoint_timer_query` quand il
  existe), entre 55 % et 100 % de la définition.
- Paramètres d'URL de test : `?gfx=bas|moyen|eleve|ultra` (force un préréglage sans l'enregistrer),
  `?quality=low` (rendu minimal).

## 9. Performances mesurées

Machine : Radeon RX 6650 XT, Chrome (ANGLE D3D11), écran 1920 × 1080 (échelle Windows 125 %). Pire cas sur 4
directions de caméra, résolution dynamique désactivée, décor v0.1. Temps GPU = requêtes de temps GPU.

| Préréglage | Définition rendue | Village : appels / temps GPU | Forêt : appels / temps GPU |
|---|---|---|---|
| Bas | 1920 × 1080 | 88 / 5,1 ms | 97 / 6,8 ms |
| Moyen | 1920 × 1080 | 152 / 9,4 ms | 202 / 8,8 ms |
| Élevé | 2400 × 1350 | 244 / 12,3 ms | 253 / 10,5 ms |
| Ultra | 2400 × 1350 | 190 / 12,1 ms | 288 / 12,1 ms |

- Objectif « ≥ 60 i/s en Moyen à 1080p sur un GPU moyen » : tenu avec une grande marge (≈ 9 ms). Le test
  automatique choisit **Élevé** sur la RX 6650 XT (8 ms mesurées).
- Objectif « < 300 appels de dessin dans le village » : tenu dans tous les préréglages (passes d'ombres et de
  post-traitement comprises). Leviers : tuiles d'herbe de 24 m, tuiles de décor de 96 m, fusion des matériaux,
  petits objets hors des cascades lointaines, cascades lointaines rafraîchies moins souvent.
  Les cascades lointaines sont déphasées : jamais deux d'entre elles ne sont redessinées dans la même image, donc
  l'image la plus chère reste proche de la moyenne (contrôle en mode hors ligne au village, 1536 × 864, 4 directions,
  pire image : Bas 78, Moyen 241, Élevé 251 appels ; Ultra 278 en ligne avec 27 personnages).
- Page ouverte dans un onglet de taille 0 × 0 (onglet en arrière-plan) : le rendu reprend la vraie taille dès qu'elle
  existe (sinon le rapport largeur/hauteur NaN désactivait l'élimination des ombres : plus de 480 appels).
- Mémoire : 40 à 75 textures GPU selon le préréglage, stable après des centaines d'effets (aucune fuite de
  géométrie, de texture ou de programme ; pools de taille fixe) ; la copie CPU des tableaux de textures du terrain
  est libérée après l'envoi au GPU.
- Console : aucune erreur ni avertissement (les simples *notes* du compilateur HLSL d'ANGLE sur les shaders de
  three.js sont rangées dans `shaderNotes`, voir graphics.js).

Mesurer soi-même : `window.__game.stats()` (fps, appels, triangles, temps GPU, échelle, préréglage…),
`window.__game.gfx.benchmark`, `window.__game.gfx.textureInfo` (ressources optionnelles trouvées).

## 10. Contrat des fichiers optionnels (équipes lookdev / assets)

| Fichier | Format | Repli si absent |
|---|---|---|
| `/env/sky_day.hdr`, `sky_golden.hdr`, `sky_night.hdr`, `sky_overcast.hdr` | Radiance HDR équirectangulaire | ciel procédural seul |
| `/textures/terrain/<couche>_{albedo,normal,orm}.webp` (10 couches) | albedo sRGB (alpha = hauteur, optionnel), normale OpenGL, ORM linéaire | couche procédurale |
| `/textures/grass_blades.webp` | atlas alpha, N colonnes de brins côte à côte | brins géométriques |
| `/textures/water_normal.webp`, `/textures/foam.webp` | tuilables, linéaires | vagues / écume procédurales |
| `/vfx/manifest.json` + planches | voir §7 (image 0 en haut à gauche, lignes de gauche à droite) | effets procéduraux |
| `/models/<clé>_lod1.glb`, `_lod2.glb` | GLB statique allégé | LOD 0 réutilisé |

## 11. Limites connues

- Pas de particules « douces » (fondu contre la profondeur) : la profondeur de la scène est la cible en cours
  d'écriture pendant le rendu des effets ; les sprites s'estompent près de la caméra à la place.
- Le couvercle de coffre animé (« Lid ») n'est pas encore animé : aucun coffre n'existe dans le jeu en v0.2 (le
  modèle s'affiche comme un décor statique).
- Désactiver le post-traitement en cours de partie n'active le MSAA qu'au prochain lancement (le panneau l'indique).
