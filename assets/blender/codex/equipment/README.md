# CX-3 — équipement en main

18 modèles, chacun avec LOD1 et LOD2. Production Blender 5.0.1, kit partagé en lecture seule.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' -b --factory-startup --threads 4 --python-exit-code 1 --python assets/blender/codex/equipment/build.py
python assets/blender/codex/equipment/verify.py
```

`-- --only eq_sword_1` permet une reconstruction ciblée. `--geometry-only` est un aperçu de travail sans cuisson/export ; ne constitue pas une livraison. `--no-sheets` omet seulement les vues QA. `--lod-only` reconstruit les LOD depuis les GLB LOD0 ; `--finalize` réexporte aussi les tangentes du LOD0 réimporté avant cette étape.
Si le kit n'est pas encore fusionné, `BRUMEVAL_KIT_ROOT` désigne le dossier `assets/blender` partagé (repli local par défaut sur `C:/Users/amin2/mmorpg/assets/blender`). Aucun changement du kit, du dispatcher, du jeu ou de données partagé n'est inclus.

## Contrat d'intégration

- Unités mètres. Pivot local `(0,0,0)` au milieu de la prise. Lame/hampe en **+Z Blender**, donc **+Y glTF** ; avant **-Y Blender**, donc **+Z glTF**.
- Arcs bandés au repos, corde derrière la prise. Bouclier devant la main, poignée à l'origine. Modèles statiques : animation de corde/décoche non incluse.
- Progression visuelle des arcs : 1 bois sombre, 2 bois cuivré, 3 frêne clair avec dorures, 4 branches dorées et incrustations sombres. Courbure et épaisseur augmentées sur les paliers supérieurs ; le modèle royal utilise une finition or PBR, pas seulement une petite garniture de poignée.
- `eq_sword_1..5`, `eq_greatsword_1..2`, `eq_staff_1..4`, `eq_bow_1..4`, `eq_shield_1..3` ; suffixes `_lod1`, `_lod2`.
- Propositions de correspondance : épée rouillée→sword1, acier→sword2, runeblade→sword3 ; apprenti→staff1, arcanique→staff2, braises→staff3 ; arc court→bow1, long→bow2, elfique→bow3. Les autres variantes sont destinées à l'équipement futur ; Claude décide des clés de gameplay.
- PBR baseColor/normal/ORM, émission pour pierres. WebP embarqué, une matière par modèle. Cibles LOD1 ≈30 % et LOD2 ≈8 %, textures 512/256. Les quotas par pièce peuvent dépasser ces cibles pour préserver les silhouettes ; ratios réels et avertissements sont inscrits dans les rapports. Le LOD2 retire les petits décors filaires et rivets, conserve les éléments structurels.

## Matières et contrôle

Métal : corrosion fractale irrégulière, grains fins, rayures anisotropes, cavités et arêtes du kit. La rouille est désaturée, les fils de lame ont une matière moins corrodée. Bois : grain orienté dans la longueur, veines et fissures ; cuir : pores fins et usure, lacet géométrique ; bronze : patine et gravure procédurale. Pas de bruit uniforme appliqué indistinctement à tous les matériaux.

Les vues QA montrent les GLB réimportés et leurs matériaux cuits : 8 angles, fil de fer, orientation des faces et damier UV. Le sol du studio est supprimé pour ne pas cacher le pommeau sous l'origine. `verify.py` relit les binaires GLB et les textures, vérifie budgets, pivots, tangentes et niveaux de détail, et produit `previews/review.html` et `delivery-checks.json`. Les avertissements de coutures restent explicitement dans chaque rapport. Les LOD sont revus après export, avec contrôle géométrique de la silhouette de chaque pièce dans 26 directions.

Limites : rendu dark fantasy encore stylisé, modèles sans déformation ni collision spécifique. Le montage exact sur les mains et le passage des LOD doivent être vérifiés avec les personnages du jeu lors de l'intégration. Les détails des gravures disparaissent naturellement à distance.
