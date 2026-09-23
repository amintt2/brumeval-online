# CX-2 — seconde passe dark fantasy, 53 icônes

21 objets actuels, l'or, 12 compétences et 19 objets v0.3. Noms conservés, 256 × 256 PNG RGBA : objets transparents et compétences sur une vignette sombre texturée.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --python-exit-code 1 --python assets/blender/codex/icons/build.py -- --samples 48
python assets/blender/codex/icons/review.py
```

Sélection : `--only slime_gel,ab_heal`. `--draft` écrit dans `previews/drafts/` sans remplacer les livrables ni le manifeste. Le rendu Cycles est calculé en 512 puis réduit en 256 par `finish.py` (Python + Pillow). Les compétences reçoivent un fond sombre, un grain déterministe et un halo mesuré. `BRUMEVAL_IMAGE_PYTHON` sélectionne l'interpréteur Pillow si nécessaire.

`second_pass.py` remodèle potions, gelée bouchée, peau de loup et compétences. `garments.py` fournit la robe plissée et la cotte de mailles. Les autres silhouettes historiques sont lues sans modification puis reçoivent des matériaux usés, une palette désaturée et un éclairage latéral avec reflets physiques. Les murs de verre et liquides sont réfractifs ; la grande potion n'a plus de cœur décoratif.

Le kit est lu dans `assets/blender/kit/`, via `BRUMEVAL_KIT_ROOT` (son dossier parent), ou dans le checkout principal pendant le développement. Aucun bytecode n'est écrit. Le verrou GPU partagé est respecté ; faire les lots GPU successivement évite les replis CPU.

`review.py` vérifie les 53 sorties, les références de `shared/data.js`, les dimensions, l'alpha et les marges. Il produit quatre planches nommées et les empreintes SHA-256. Images fixes : pas de GLB ni de LOD à exporter. Voir `REVIEW.md` pour la revue artistique et ses limites.

Le lanceur commun proposé se trouve dans la branche CX-1 ; Claude l'installe lors de l'intégration, hors des dossiers réservés à CX-2. Aucun code du jeu ni kit partagé n'a été modifié.
