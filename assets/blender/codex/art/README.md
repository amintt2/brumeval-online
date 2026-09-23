# CX-1 — seconde passe et revue multiangle

Sorties : `client/public/ui/art/`. Code, sources figées et preuves de revue : `assets/blender/codex/art/`. Aucune écriture dans les dossiers de Claude.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --python-exit-code 1 --python assets/blender/codex/art/build.py -- --samples 48
python assets/blender/codex/art/review.py
```

`--only bg_login,bg_loading_1` sélectionne les images. `--draft --percent 45 --samples 16` écrit exclusivement dans `previews/drafts/`. Les deux logos validés sont conservés si présents : ils ne sont pas recalculés pendant les itérations sur les décors. Pour un checkout sans logos, le générateur historique reste disponible.

`cinematics.py` contient les nouvelles scènes : caméra à hauteur humaine, relief continu, accès aux bâtiments, château, ruine ouverte, sous-bois et éclairage. `compose_banner.py` assemble le logo approuvé sur un cadrage panoramique distinct avec une zone sombre latérale. Ce traitement déterministe utilise Python et Pillow ; `BRUMEVAL_IMAGE_PYTHON` permet de choisir cet interpréteur.

## Captures extérieures

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --python-exit-code 1 --python assets/blender/codex/art/angles.py -- --only cliff,cliff_back,house,cemetery,lair,forest --samples 24
python assets/blender/codex/art/scene_angle_sheets.py
```

Huit vues avant/latérales du château, trois arrière, trois de l'accès à la maison et trois par autre scène. Les rendus vont dans `previews/angles/`. La revue demandée par Amin porte sur la géométrie sous plusieurs angles, les raccords au sol, l'échelle, les matériaux et la lumière. Voir `MULTIANGLE_REVIEW.md`. Les illustrations finales restent des images fixes, pas des niveaux jouables.

## Dépendances

Le kit partagé est utilisé en lecture seule, sans bytecode. Il doit être présent dans `assets/blender/kit/` ; pendant le développement, le script se replie sur le checkout principal. `BRUMEVAL_KIT_ROOT` peut pointer vers son dossier parent. Les graines géométriques sont fixes. Ne pas lancer plusieurs rendus GPU simultanément ; le verrou du kit protège le GPU mais un délai trop court entraîne un repli CPU coûteux.

Le Golem est une copie figée du modèle de Claude : `sources/golem.glb`, SHA-256 `b61e5d54bd81d03345444d2795a026a6fc604d86e56afab4b80b7df7989c9d91`. Police du logo : Constantia Windows, remplaçable avec `BRUMEVAL_TITLE_FONT` ; aucune police redistribuée.

Le lanceur commun proposé est `dispatch_codex.py`. Claude l'installe hors de nos dossiers lors de la fusion. Les contrôles de `review.py` vérifient formats, dimensions, transparence et empreintes ; ils ne remplacent pas une validation artistique.

Galerie avant/après : `python assets/blender/codex/art/make_gallery.py`, puis ouvrir `previews/review.html`. Les vues de contrôle peuvent être filtrées par `--views 10-arriere,11-arriere-droite`.
