# CX-1 — première passe Blender / Cycles

Les sorties sont dans `client/public/ui/art/`. Les fichiers de cette branche ne touchent qu'à ce dossier et à `assets/blender/codex/art/`.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --python-exit-code 1 --python assets/blender/codex/art/build.py -- --samples 32
python assets/blender/codex/art/review.py
```

`--only logo,bg_login` sélectionne des images ; `--percent 40 --samples 24` sert au brouillon (écrase les sorties sélectionnées, à régénérer à 100 % avant livraison). Les graines aléatoires sont fixes. La forêt de cette première passe est limitée à 8 échantillons avec débruitage, les autres images utilisent 32 ; augmenter ce plafond pour une validation artistique finale. Aucun téléchargement ni génération externe. Les images fixes utilisent directement les nœuds de matériaux Cycles : elles ne sont pas des modèles glTF à cuire ou à décliner en LOD.

Le kit partagé doit être présent dans `assets/blender/kit/`. Pendant le développement, le script le lit dans le checkout principal, sans écrire de bytecode. `BRUMEVAL_KIT_ROOT` peut pointer vers son dossier parent. Sa disponibilité reste une dépendance avant fusion.

Le Golem vient d'une copie figée du modèle de Claude, conservée ici dans `sources/golem.glb` pour que la scène reste reproductible malgré ses travaux en parallèle. SHA-256 : `b61e5d54bd81d03345444d2795a026a6fc604d86e56afab4b80b7df7989c9d91`. La police par défaut est Constantia, fournie par Windows ; `BRUMEVAL_TITLE_FONT` permet d'indiquer un autre fichier local. Le texte est converti en pixels, la police n'est pas redistribuée.

Correspondance : connexion = village ; chargement 1 = cimetière ; 2 = antre ; 3 = forêt. Le logo utilise un écu et un arbre entre deux tours, sans emblème emprunté à un autre jeu.

Le lanceur parent `assets/blender/codex/build.py` n'est pas écrit : il est hors des dossiers réservés. Une proposition autonome se trouve dans `dispatch_codex.py`, à installer par Claude après fusion des deux branches. Les preuves de contrôle restent dans ce dossier réservé, et non dans le dossier partagé `assets/previews/`.

Les contrôles de `review.py` sont techniques. Ils ne valent pas validation de la direction artistique : cette première passe procédurale doit être revue avec Claude avant toute publication.
