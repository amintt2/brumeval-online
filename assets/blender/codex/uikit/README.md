# CX-9 — Kit d'interface Brumeval

27 PNG RGBA rendus depuis des reliefs et matériaux Blender Cycles : cuir et pierre sombres, métal doré patiné, reflets sobres. Les textes sont volontairement absents des textures pour préserver localisation, accessibilité et taille dynamique. La mise en situation comporte uniquement des textes français.

## Régénération

Depuis la racine du dépôt :

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --threads 4 --python-exit-code 1 --python assets/blender/codex/uikit/build.py -- --samples 48
python assets/blender/codex/uikit/review.py
```

`--only panel_leather,button_hover` limite les clés ; `--draft` écrit dans `previews/drafts` sans modifier le manifeste public. Chaque texture est rendue à deux fois sa taille finale puis réduite par Lanczos avec Pillow. Aucune illustration externe ni image générative. Python accessible par `python` doit avoir Pillow ; `BRUMEVAL_IMAGE_PYTHON` peut pointer vers cet interpréteur. Le module partagé `kit/gpu.py` est utilisé en lecture seule, rechargé après chaque remise à zéro Blender. `BRUMEVAL_FORCE_CPU=1` force un rendu CPU. Le dispatcher commun peut appeler ce `build.py` comme les autres groupes ; son installation reste à la charge de Claude.

## Intégration du manifeste

`client/public/ui/kit/manifest.json` contient `assets`, indexé par clé stable. Chaque entrée donne `file`, `size` en pixels source et `alpha`. `slice` nomme explicitement `top/right/bottom/left` en pixels source ; les coins doivent conserver leur taille, les bandes se redimensionnent sur un axe, le centre sur deux axes. En CSS, utiliser ces valeurs dans `border-image-slice` et `border-image-width`, avec `fill` pour panneaux/boutons. Ne pas utiliser `fill` pour les cadres transparents.

- Panneaux : `panel_leather`, `panel_stone`, 512², coins 64 px ; `content_inset` indique une marge sûre pour le texte.
- Ornement indépendant : `corner`, orientation haut-gauche ; rotation CSS pour les autres coins. `border_h` et `border_v` prolongent les bordures sans étirer les extrémités.
- Boutons : `button_normal`, `button_hover`, `button_pressed`. Le libellé reste un élément HTML accessible ; le kit n'assure pas la gestion du focus ou de l'état désactivé.
- Barres : trois `bar_frame_*` transparents avec `aperture=[x,y,width,height]` et trois `bar_fill_*`. Redimensionner le remplissage à l'ouverture complète, puis le masquer horizontalement selon la valeur. Ne pas rétrécir toute la texture selon la valeur, pour conserver les détails de bord.
- `slot_item`, `slot_skill` : cadres 128² avec ouverture transparente. Placer le contenu sous le cadre, limité à `aperture`.
- `minimap_ring` : anneau transparent 512², ouverture circulaire indiquée en pixels. Les directions/repères de carte sont dynamiques et ne sont pas intégrés à la texture.
- `tooltip` et `separator` : infobulle extensible et ornement horizontal.
- `cursor_{normal,attack,talk,grab}_{32,64}` : huit PNG. `hotspot` est fourni à la taille réelle du fichier. Pour un curseur CSS standard, préférer la version 32 ; la version 64 est destinée au DPI élevé ou à un curseur de jeu dessiné à l'écran.

Exemple : `cursor: url('/ui/kit/cursor_attack_32.png') 4 4, crosshair;`.

## Contrôle qualité et limites

`review.py` vérifie dimensions, RGBA, transparence centrale des cadres, opacité centrale des panneaux, validité des marges et hotspots ; il écrit `qa.json` avec les empreintes SHA-256. `previews/contact.png` montre tout le kit ; `in_context.png` montre des usages à tailles pratiques, dont curseurs 32/64 ; `nine_slice.png` vérifie les panneaux étirés.

Les matériaux et l'éclairage sont figés dans les PNG. Ce kit est un habillage d'interface, pas un ensemble de modèles 3D navigables : les vues de côté, LOD et GLB ne s'appliquent pas. Les formes des curseurs restent volontairement simples à 32 px. Le grain du cuir/pierre est discret pour ne pas concurrencer les textes. Les previews ne sont pas une intégration au client réel ; comportements clavier, contrastes finaux des libellés et alignement dans l'interface devront être vérifiés par Claude lors de l'intégration.
