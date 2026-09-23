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

## Reprise de l'herbe — 23 septembre 2026

Les cartes alpha à petits brins alignés sont remplacées, pour ces illustrations fixes, par des rubans géométriques courbés et effilés. Chaque centre propose jusqu'à 168 brins répartis dans un rayon de 45 à 85 cm ; un champ continu de bruit à deux échelles module leur probabilité et leur hauteur. Largeur 1,8 à 4,2 cm. La bordure du chemin est atténuée progressivement. Quatre nuances sobres et des orientations indépendantes évitent le motif de peigne. Les racines et pointes sont exclues des chemins et accès aux maisons. Le flux aléatoire des autres éléments est préservé.

`python assets/blender/codex/art/grass_comparison.py` reconstruit la comparaison village / maison / forêt (`previews/grass-comparison.jpg`). Les anciennes captures correspondantes sont conservées dans `previews/grass-before/`. Cette géométrie de rendu n'est pas un asset temps réel exporté pour le jeu.

## Relief procédural

`terrain.py` remplace le socle circulaire et les montagnes ellipsoïdes du village : grilles de hauteur, bruit fractal déformé, simulation simplifiée de pluie/transport de sédiments et relaxation des talus. Le plateau de fondation et la rampe sont protégés. Voir `TERRAIN_METHOD.md` pour les références et `GRASS_REVIEW.md` pour les réserves artistiques. `grass_density.py` exporte la carte de densité procédurale ; le noir correspond au chemin et aux zones clairsemées, le blanc aux zones fournies. Les exclusions des bâtiments s'appliquent ensuite.

## Raccord aux fondations

`foundation_contact.py` crée le groupe Geometry Nodes `CastleFoundationContact`. Les emprises porteuses sont extraites des objets du château évalués en coordonnées monde. Le groupe combine proximité XY, échantillonnage de hauteur et raycast vertical pour sélectionner la base la plus haute lorsque plusieurs emprises se superposent. Le terrain monte uniquement, avec 6 cm de recouvrement et une transition bruitée de 1,5 à 2 m. Portes, arches, herses et rampes ne servent pas de sources de remplissage.

Les emprises sont recalculées à la génération de la scène. Après une modification manuelle des bâtiments, relancer le générateur pour les actualiser. `check_contacts.py` vérifie le terrain évalué : contacts des deux tours, plateforme avant, absence de creusement et passage inchangé. Résultat dans `contact-check.json`.

`weathering.py` choisit les masques selon pierre, fer et tissu ; deux bannières à géométrie légèrement abîmée sont fixées aux remparts. Voir `WEATHERING_METHOD.md`. Les gros plans sont régénérés avec `angles.py -- --only cliff --details --samples 24`, dans `previews/weathering/`.
