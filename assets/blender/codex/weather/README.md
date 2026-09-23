# CX-6 — effets météo

Sept planches WebP RGBA rendues dans Blender Cycles, livrées dans `client/public/vfx/weather/`. Les images sont générées par le code, sans ressources téléchargées. Les séquences comprennent 144 images au total.

## Régénération

Depuis la racine de cette worktree :

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --threads 4 --factory-startup --python-exit-code 1 --python assets/blender/codex/weather/build.py -- --cpu --samples 16
```

Pour une seule planche, ajouter `--only fog_wisps`. `--prototype` produit seulement quatre images de contrôle par effet, sans toucher aux planches livrées. La définition finale est de 256 pixels par cellule, rendue à 512 pixels puis réduite avec Lanczos. `--frame-size` et `--supersample` permettent de modifier ces paramètres.

Le mode GPU est disponible en retirant `--cpu` ; il utilise le verrou partagé du kit. Après chaque `C.reset()`, le module GPU est rechargé pour éviter de conserver un contexte HIP périmé. Les rendus légers peuvent rester entièrement sur CPU.

Le kit et `common.py` sont lus depuis `assets/blender/`. Si le kit n'est pas encore fusionné dans la branche, `BRUMEVAL_KIT_ROOT` peut indiquer le dossier Blender partagé ; la valeur de secours locale est `C:/Users/amin2/mmorpg/assets/blender`. Aucun fichier n'y est écrit.

`pack.py` nécessite Python, Pillow et NumPy. `BRUMEVAL_IMAGE_PYTHON` permet de choisir cet interpréteur ; sinon le script utilise le runtime Python fourni par Codex lorsqu'il existe, puis Python sur PATH. L'assemblage ne fabrique pas de nouvelle géométrie ni de nouvel effet : il réduit les images Blender, conserve l'alpha, assemble les cellules et crée les aperçus.

## Contrat des textures

- `file` est relatif à `client/public/`, par exemple `vfx/weather/fog_wisps.webp`.
- Les cellules se lisent de gauche à droite, puis de haut en bas. Il y a quatre colonnes et quatre ou six lignes.
- `size` désigne la largeur et la hauteur suggérées du panneau dans le monde, en mètres. `frameSize` vaut 256.
- `normal` utilise l'alpha droit. `additive` attend un mélange de type `SrcAlpha / One`, avec `premultipliedAlpha=false`, `depthWrite=false` et `transparent=true`.
- Pour Three.js avec `Texture.flipY=true`, la cellule `(c,r)` utilise `repeat=(1/cols,1/rows)` et `offset=(c/cols,1-(r+1)/rows)`.
- Désactiver les mipmaps de la planche et utiliser un filtrage linéaire pour éviter les mélanges entre cellules. Chaque cellule possède au moins trois pixels de transparence de sécurité.
- Les cinq effets continus sont périodiques. Les séquences ponctuelles commencent et finissent transparentes ; il faut les supprimer après la dernière image, sans boucler.
- `rain_splash` est une éclaboussure en vue oblique à placer sur un panneau orienté vers la caméra. Son `anchorUV=[0.5,0.6125]` donne le point d'impact, dans la cellule, avec origine en haut à gauche, U vers la droite et V vers le bas. Cet ancrage numérique prime sur `anchor="center"`, conservé pour les lecteurs anciens. Avec un `THREE.Sprite`, utiliser `sprite.center.set(u,1-v)` : la position du sprite correspond alors à l'impact. Avec un panneau centré, relever son centre de `(v-0.5)*size`, soit **0,135 m** à la taille de 1,2 m. L'aperçu HTML aligne ce point avec le repère au sol. Ce n'est pas un décal horizontal prêt à projeter sur le sol.

## Construction visuelle

| Effet | Mouvement et bruit |
|---|---|
| `rain_streaks` | Gouttes inclinées de tailles variables, deux vitesses, arrivée et départ fondus dans les bords. |
| `rain_splash` | Deux rides elliptiques et gouttes balistiques ; un événement de 0,67 seconde. |
| `snowflakes` | Chute lente, dérive sinusoïdale, rotation de cristaux à six branches et petits flocons secondaires. |
| `sandstorm` | Turbulence fractale déformée, période 4D fermée et grains entraînés latéralement. |
| `fog_wisps` | Deux échelles de bruit 4D, déformation du domaine et structures allongées horizontalement. |
| `lightning_flash` | Tracé ramifié fixe, trois impulsions électriques et diffusion lumineuse faible ; un événement de 0,67 seconde. |
| `embers` | Ascension périodique, dérive, scintillement, petites traînées et halos orangés. |

## Relecture

Ouvrir `previews/animation.html` : les sept animations utilisent les véritables planches livrées et leur manifeste. Les effets ponctuels y sont rejoués avec une pause uniquement pour faciliter la relecture. Les fichiers `previews/*-frames.jpg` montrent toutes les images ; les WebP animés montrent leur composition sur un damier sombre.

`qa.json` contient les dimensions, sommes SHA-256, poids, temps de rendu et d'assemblage, énergie alpha par image, absence de coupure sur les bords et comparaison du raccord de boucle aux différences entre images adjacentes. L'alpha reste sans perte pour les sept effets. La brume et le sable utilisent un RGB WebP qualité 90, avec erreur moyenne RGB pondérée par l'alpha inférieure à 0,0015 ; les cinq autres effets sont intégralement sans perte. Les aperçus et mesures relisent les fichiers WebP réellement livrés.

L'intégration client demeure à faire par Claude : aucun consommateur de planches météo n'est présent sur cette branche. Il faudra gérer le placement, la densité, l'occultation et le déclenchement des impacts. Ce sont des panneaux animés, pas une simulation volumétrique dans le navigateur. Les tests de fichiers ne remplacent pas la relecture en situation dans le jeu.
