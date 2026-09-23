# CX-2 — icônes dark fantasy, passe finale ciblée

21 objets actuels, l'or, 12 compétences et 19 objets v0.3. Noms conservés, 256 × 256 PNG RGBA : objets transparents et compétences sur une vignette sombre texturée.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --python-exit-code 1 --python assets/blender/codex/icons/build.py -- --samples 48
python assets/blender/codex/icons/review.py
python assets/blender/codex/icons/review40.py
```

Sélection : `--only slime_gel,ab_heal`. `--draft` écrit dans `previews/drafts/` sans remplacer les livrables ni le manifeste. Le rendu Cycles est calculé en 512 puis réduit en 256 par `finish.py` (Python + Pillow). Les compétences reçoivent un fond sombre, un grain déterministe et un halo mesuré. `BRUMEVAL_IMAGE_PYTHON` sélectionne l'interpréteur Pillow si nécessaire.

`second_pass.py` remodèle potions, gelée bouchée, peau de loup et compétences. `garments.py` fournit la robe plissée et la cotte de mailles. Les autres silhouettes historiques sont lues sans modification puis reçoivent des matériaux usés, une palette désaturée et un éclairage latéral avec reflets physiques. Les murs de verre et liquides sont réfractifs ; la grande potion n'a plus de cœur décoratif.

`final_pass.py` traite seulement les douze icônes de la dernière demande de Claude : les cinq potions, `firebolt`, `fireball`, les quatre tirs de flèches et `heavy_blow`. Il différencie les silhouettes des fioles (ronde, poire, flasque plate), éclaire les liquides de l'intérieur et utilise des reflets de sources étroites. Les sorts de feu sont orange; les tirs montrent une flèche, une plaque perforée, trois flèches en éventail ou une pluie vers une cible au sol. Le marteau possède une traînée épaisse et une onde d'impact. Les 41 autres images sont conservées à l'identique.

`review40.py` assemble toute la collection à **40 × 40 pixels réels**, les douze comparaisons avant/après et une planche de détail avec fonds sombre et clair. `--draft` remplace seulement les douze cases ciblées par les rendus temporaires. La comparaison lit la version `47da7ad` via Git.

Le kit est lu dans `assets/blender/kit/`, via `BRUMEVAL_KIT_ROOT` (son dossier parent), ou dans le checkout principal pendant le développement. Aucun bytecode n'est écrit. Le verrou GPU partagé est respecté ; faire les lots GPU successivement évite les replis CPU.

`review.py` vérifie les 53 sorties, les références de `shared/data.js`, les dimensions, l'alpha et les marges. Il produit quatre planches nommées et les empreintes SHA-256. Images fixes : pas de GLB ni de LOD à exporter. Voir `REVIEW.md` pour la revue artistique et ses limites.

Le lanceur commun proposé se trouve dans la branche CX-1 ; Claude l'installe lors de l'intégration, hors des dossiers réservés à CX-2. Aucun code du jeu ni kit partagé n'a été modifié.
