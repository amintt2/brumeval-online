# CX-2 — icônes Cycles 256 × 256

53 fichiers : les 21 objets actuels, l'or, 12 compétences et 19 objets v0.3. Noms existants conservés, objets transparents, compétences sur fond de pierre sombre. Silhouettes historiques réutilisées en lecture seule ; matériaux procéduraux du kit, éclairage latéral, arêtes adoucies et nouveaux objets générés par script.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --python-exit-code 1 --python assets/blender/codex/icons/build.py -- --samples 48
python assets/blender/codex/icons/review.py
```

Sélection : `--only ore_copper,ab_heavy_blow`. Le kit doit être disponible dans `assets/blender/kit/`, ou via `BRUMEVAL_KIT_ROOT` (dossier parent du kit). En développement, le checkout principal est un repli en lecture seule. Le script désactive les fichiers bytecode. Le verrou GPU partagé est respecté.

`review.py` vérifie les 53 sorties, les références de `shared/data.js`, les dimensions, le canal alpha et les marges. Il génère des planches nommées dans `previews/` et un rapport SHA-256. Ce sont des images fixes, pas des GLB exportés : aucun LOD, squelette ou contrôle `inspect-glb` à livrer pour les icônes.

Les validations techniques ne remplacent pas la revue artistique. Cette première passe doit être relue avant publication. L'intégration du lanceur parent `assets/blender/codex/build.py` est demandée à Claude dans l'outbox : elle est hors des deux dossiers réservés à CX-2.
