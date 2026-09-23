# Pipeline Blender — kit partagé `assets/blender/kit/`

Direction artistique (ROADMAP §4.4–4.6) : **dark fantasy façon Elden Ring**, plus de low-poly. Pierre usée, bois
patiné, métal rouillé/gravé, cuir, tissu, fourrure, mousse. Le détail vient de **bonnes silhouettes** + **textures
cuites** (baseColor, normal, ORM, émissif) depuis des matériaux **procéduraux en nœuds**, dans les budgets web.

Tout est généré par script (Blender 5.0.1 headless), déterministe et relançable : `npm run assets -- <groupe>`.

---

## 1. Modules du kit

```python
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # -> assets/blender
import common as C
from kit import materials as M, gn, bake, lod, qa, render, gpu, export, rig
```

| Module | Rôle |
|---|---|
| `materials` | ~30 matériaux procéduraux paramétrables (nœuds de shader) + couches automatiques saleté / usure des arêtes / mousse |
| `gn` | constructeurs Geometry Nodes : déplacement, facettes de roche, usure, scatter, instances sur courbe, courbe → maillage, arbre récursif, remesh voxel, application des modificateurs |
| `bake` | UV (cartes organiques `CHARTS`, smart project, coutures auteur, lightmap ; marges, densité uniforme), bake Cycles GPU de chaque canal, bake high → low, ORM, matériaux glTF finaux, textures tuilables |
| `lod` | `<key>_lod1.glb` (~30 %), `<key>_lod2.glb` (~8 % ou imposteur pour les arbres) |
| `export` | export GLB (textures **WebP**, modificateurs appliqués, skins, toutes les Actions) + vérification des budgets |
| `qa` | contrôles automatiques (pièces flottantes, non-manifold, normales inversées, faces dégénérées/dupliquées, budgets, taille, **corps à travers les vêtements image par image**) |
| `render` | planches QA EEVEE (turntable 8 angles, fil de fer, normales, damier UV, poses de chaque clip) + visuel héros |
| `gpu` | Cycles HIP (RX 6650 XT) + **verrou inter-processus** (un seul bake/rendu GPU à la fois), repli CPU |
| `rig` | armature humanoïde (noms SPEC), skinning lissé, transfert de poids vers les vêtements, clips en quaternions |

Exemples complets et validés : `assets/blender/kit/samples/kit_rock.py` et `kit_humanoid.py`
(sorties dans `assets/previews/kit/`).

---

## 2. Gabarit d'un script de groupe

```python
# assets/blender/<groupe>/build.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bpy
import common as C
from kit import materials as M, gn, bake, lod, qa, render, export

args = C.parse_args()
KEYS = ["rock_a", "rock_b"]

def build_rock_a():
    # 1) forme de base (primitives, bmesh, courbes...) — origine au pied, face avant vers -Y, mètres
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1.0)
    base = bpy.context.object
    base.scale = (0.95, 0.78, 0.66); C.apply_transforms(base)
    base.data.materials.append(M.rock("Rock", seed=7, moss=0.45))
    # 2) haute définition procédurale (Geometry Nodes)
    high = base.copy(); high.data = base.data.copy(); bpy.context.scene.collection.objects.link(high)
    gn.planar_cuts(high, cuts=7, depth=(0.04, 0.14), seed=11, subdiv=3)
    gn.displace(high, strength=0.2, scale=1.5, detail=9, voronoi=0.45, strata=0.08)
    gn.apply(high); bpy.data.objects.remove(base)
    # 3) basse définition dans le budget
    low = high.copy(); low.data = high.data.copy(); bpy.context.scene.collection.objects.link(low)
    gn.decimate(low, 2600 / len(low.data.polygons)); gn.apply(low)
    low.name = "Rock"; high.name = "_RockHigh"          # "_" = jamais exporté
    # 4) bake high -> low (tous les canaux), puis suppression du high
    bake.bake_asset([low], "rock_a", size=1024, high=high, extrusion=0.06, max_ray=0.25,
                    uv_method="CHARTS")       # organique -> grandes cartes UV (SMART pour le dur)
    bpy.data.objects.remove(high)
    return [low]

for key in C.selected(args, KEYS):
    C.reset()
    objs = {"rock_a": build_rock_a}[key]()
    info = export.export_glb(key, args.out, objects=objs, budget="rock")
    lod.export_lods(key, objs, args.out)                        # modèles statiques d'environnement
    rep = qa.run(key, objs, budget="rock", expected=(1.8, 1.6, 1.2), glb=info)
    qa.save(rep, args.previews)                                 # assets/previews/<key>_qa.json
    if not args.no_preview:
        render.qa_sheets(key, objs, args.previews)              # planches + assets/previews/<key>.png
```

Ordre obligatoire : **construire → baker → exporter → LOD → QA → planches**. Le bake remplace les matériaux
procéduraux par des matériaux glTF (textures) ; l'export et les planches montrent donc exactement ce que verra le
client.

---

## 3. Matériaux procéduraux (`kit.materials`)

Toutes les fonctions renvoient un `bpy.types.Material` construit en nœuds, se terminant par **un** Principled BSDF.
Paramètres communs : `name`, `color`/`color2` (hex sRGB `"#6b665d"`), `scale` (fréquence), `seed`,
`coords` (`"OBJECT"` 3D par défaut, `"BOX"` projection boîte pour briques/planches/tuiles, `"UV"`),
`dirt` (crasse dans les creux : AO), `wear` (usure des arêtes : Bevel + attribut `wear`), `moss` (mousse sur les
faces tournées vers le haut + creux + attribut `moss`), `bump`.

| Famille | Fonctions |
|---|---|
| Pierre | `stone_blocks`, `rock` (strates, fissures, lichen), `cobblestone`, `slate`, `plaster`, `runes` (pierre + runes émissives) |
| Bois / végétal | `wood_planks`, `wood` (poutres), `bark(kind="oak"/"pine"/"birch"/"dead")`, `thatch`, `roof_tiles`, `moss` |
| Métal | `metal(kind="iron"/"steel"/"gold"/"bronze"/"copper"/"silver"/"blackiron", rust=, grime=, wear=)`, `engraved_metal(pattern="filigree"/"runes"/"bands", glow=)` |
| Organique | `leather`, `cloth(kind="wool"/"linen"/"silk"/"burlap", pattern_color=, hem_dirt=)`, `fur`, `skin(kind="human"/"orc"/"undead"/"troll")`, `bone` |
| Sol / éléments | `mud`, `snow`, `ice`, `sand` |
| Magie | `crystal`, `magic`, `emissive` |
| Cartes alpha | `leaf_card(kind="oak"/"birch"/"willow"/"fern"/"pine"/"grass")`, `fur_card` |

**Vent** : le client fait onduler les matériaux dont le nom commence par `Leaf`, `Foliage`, `Grass`, `Cloth`,
`Banner`. Gardez ces matériaux à part (le bake les garde dans leur **propre jeu de textures**, avec leur nom).
Troncs, pierre, métal : autres noms.

Propriétés lues par le bake : `mat["kit_group"]` (jeu de textures ; défaut `"Main"`, ou le nom pour vent/alpha),
`mat["kit_bake"]` (`"atlas"` = UV uniques, `"tile"` = cartes alpha qui gardent leurs UV et partagent une texture).

Couches pilotées par la géométrie : `gn.edge_wear(obj)` écrit les attributs `wear`/`cavity`,
`gn.store_up_mask(obj, "moss")` écrit `moss` ; les matériaux les lisent automatiquement.

---

## 4. Geometry Nodes (`kit.gn`) — « des nœuds partout »

| Fonction | Usage |
|---|---|
| `displace(obj, strength, scale, detail, voronoi, strata, subdiv)` | relief bruit + voronoi + strates |
| `planar_cuts(obj, cuts, depth, seed, subdiv)` | facettes de roche fracturée, ruines, cristaux (plans de coupe) |
| `edge_wear(obj)` / `store_up_mask(obj, "moss")` | attributs pour les shaders |
| `scatter(target, instance(s), density, up_min, attr_mask, scale, embed, distance_min, seed)` | mousse, cailloux, rivets, touffes, champignons… (liste/collection = choix aléatoire) |
| `instance_on_curve(curve, inst, spacing, alternate=90)` | chaînes, planches, tuiles, briques le long d'un chemin |
| `make_curve(splines)` + `curve_to_mesh(curve, radius, taper, profile)` | branches, racines, cordes, queues, cornes |
| `branch_tree(seed, height, ...)` | générateur récursif (splines + pointes pour les feuilles) → `make_curve` + `curve_to_mesh` + `points_object` + `instance_on_points` |
| `voxel_remesh(obj, voxel)` | fusionner des primitives en **un** maillage continu étanche (corps, créatures) |
| `bevel`, `weighted_normals`, `solidify`, `decimate` | modificateurs usuels |
| `apply(obj)` / `remove(template)` / `remove_templates()` | appliquer (courbes → maillage), nettoyer les gabarits |

Les graphes réalisent leurs instances : le résultat est un maillage normal, bakeable et exportable. Les objets
gabarits sont masqués au rendu (`kit_template`) et ne sont jamais exportés.

---

## 5. Bake (`kit.bake`)

`bake.bake_asset(objs, key, size, high=None, ...)` :

1. applique les modificateurs (sauf Armature) ; les maillages skinnés sont bakés en pose de repos ;
2. regroupe les matériaux par `kit_group` ;
3. UV (couche `UVBake`, renommée `UVMap`) selon `uv_method` :
   - `"CHARTS"` — **organique** (roches, falaises, troncs, créatures, corps, vêtements) : les faces sont regroupées
     par normale **lissée** en ~6 grandes cartes (les arêtes > ~70° ne sont jamais traversées : coque extérieure,
     ourlet et coque intérieure d'un vêtement solidifié restent séparés), les fragments < 40 faces sont fusionnés,
     les petites pièces fermées (touffes, cailloux) coupées en deux, puis dépliage *minimum stretch* ; les faces
     non résolues ou repliées (triangles UV miroir) sont reprojetées. Rocher : 432 îlots (smart) → 42 ;
   - `"SMART"` (défaut) — surfaces dures (planches, blocs, bâtiments, armes) ;
   - `"SEAMS"` — coutures marquées à la main / par GN + *minimum stretch* ;
   - `"LIGHTMAP"` — très simples maillages uniquement.
   Puis densité de texels uniforme + pack avec marges. Les faces des autres groupes sont **masquées** pendant le
   pack (sinon elles réservaient de la place : atlas du corps rempli à 5 % seulement avant correctif) ;
4. bake Cycles de chaque canal en **re-câblant l'entrée du Principled vers une Emission** (fiable pour métal,
   émissif, alpha), puis NORMAL (bump du shader et/ou high → low) et AO ;
5. assemble l'ORM (R = AO, G = rugosité, B = métal) avec numpy, construit le matériau glTF final
   (textures → Principled, Normal Map, `glTF Material Output`/Occlusion, alpha « clip » via Math Round) ;
6. remplace les matériaux ; une seule couche UV.

Options utiles : `high=` (objet(s) haute définition, pris en compte pour **tous** les canaux),
`extrusion`/`max_ray` (cage), `ao_samples`, `ao_in_base` (**0 par défaut** : l'AO va dans l'ORM, pas d'éclairage
dans l'albédo ; ≤ 0.15 au maximum pour un petit accessoire), `tex_dir` (copies PNG pour inspection),
`group_sizes={"Leaf_oak": 512}`, `uv_method="CHARTS"` (organique).

**Anti-coutures (règles appliquées par le kit, à respecter dans vos scripts)** :

- Les motifs procéduraux sont en coordonnées **Object** (3D) par défaut, jamais en espace UV d'atlas : les deux
  côtés d'une couture UV lisent donc la même valeur. N'utilisez `coords_mode="UV"` que pour des cartes (feuilles,
  fourrure) ou des UV auteur continus.
- Avant le bake, `bake.pin_uv()` fait lire aux shaders la couche UV auteur **explicitement** (nœuds UV Map) et la
  couche `UVBake` devient la couche active **et** de rendu : le repère tangent du bake NORMAL est exactement celui
  du matériau final.
- High → low : **tout ce qui n'existe que dans le low** (touffes de mousse, sangles, rivets ajoutés après coup)
  doit porter `obj["kit_bake_direct"] = 1` et être passé dans `objs` : il est baké directement sur lui-même puis
  composité dans le même atlas (masque de couverture UV). Sinon les rayons du low ne trouvent rien dans le high →
  normales « arc-en-ciel » et couleurs fausses au contact (c'était la couture visible du premier rocher).
  Joignez ensuite (`C.join`) après le bake pour garder un seul draw call.
- Marges : `uv_margin=0.006` (≈ 6 px en 1024) et `px_margin=8` (extension des bords) ; ne descendez pas en dessous.

Textures tuilables (terrain, trim sheets) : `bake.bake_tileable(material, "ground_mud", size=1024, world_size=2.0,
out_dir=...)` (décalage + fondu pour des bords sans couture).

Temps de bake mesurés GPU vs CPU : voir §9.

---

## 6. Personnages et vêtements (`kit.rig` + `kit.qa`)

Règles (ROADMAP §4.6) : **un maillage de corps continu**, vêtements en maillages séparés, **poids lissés**, et rien
ne doit traverser les vêtements, dans aucune image d'aucun clip.

Recette validée (`samples/kit_humanoid.py`) :

1. `arm = rig.humanoid_armature(1.8)` : os de la SPEC (`root, hips, spine, chest, neck, head, upper_arm.L/R, …`).
2. Corps continu : squelette de sommets + modificateur **Skin** + Subsurf, ou primitives + `gn.voxel_remesh`.
3. Vêtements : faces du corps gonflées le long des normales (tunique, manches), jupe/robe par profil de
   révolution évasé avec plis, ceinture qui cache la jonction. Épaisseur : `gn.solidify(obj, 0.008, offset=-1)`
   (étiquette la coque intérieure `kit_shell`, ignorée par la QA).
4. `rig.bind(body, arm)` (poids automatiques + lissage laplacien + ≤ 4 influences) ;
   `rig.transfer_weights(body_copy, robe, arm, smooth=25)` : la robe suit le corps **d'un seul tenant**
   (lissage fort = pas de déchirure entre les jambes). Transférer depuis une **copie complète** du corps.
5. Clips : `rig.clip(arm, "Walk", [(1, A), (7, PASS), (13, B), (19, PASS2), ("loop", 25)], cyclic=True)`,
   poses = `{os: (x°, y°, z°)}` ou `{os: {"rot": .., "loc": ..}}`, `rig.mirror_pose` pour le pas opposé.
   Chaque clé pose **tous** les os (aucun clip n'hérite d'un autre). Anticipation, amorti, poids !
6. **Toujours** : `qa.delete_covered_body(body, [tunique, robe])` : supprime le corps caché sous les vêtements,
   rentre les sommets restants de quelques mm, supprime les petits îlots orphelins.
7. `qa.run(key, meshes, budget="hero", skin=dict(body=body, cloths=[...], armature=arm, frames=13))`.
   Le test « corps à travers les vêtements » : les sommets du corps couverts au repos doivent rester derrière la
   surface du vêtement dans chaque image échantillonnée de chaque clip. En cas d'échec, le rapport donne les clips,
   les images et des positions d'exemple. Contrôle négatif fait : une jupe rigide sur les hanches échoue bien
   (101 sommets de jambe dehors pendant la marche).

---

## 7. QA obligatoire avant de finir un modèle

1. `qa.run(...)` → **0 FAIL**. Les WARN sont à lire (ex. bords ouverts du corps sous les vêtements = normal).
   `qa.check_seams` (appelé par `run`) compare, le long de **chaque couture UV**, baseColor / AO / rugosité / métal
   et la normale du normal map **décodée en espace objet** avec le repère tangent de chaque côté, extrapolées
   jusqu'à l'arête ; la référence est la même mesure sur les arêtes internes aux îlots. FAIL si la plupart des
   coutures diffèrent (bug de bake systématique) ou si certaines sont nettement visibles ; le rapport donne
   `worst_at` (positions monde) pour aller regarder. Validé par injection : +35 % de luminosité sur la moitié de
   l'atlas → FAIL ; bake propre → 0 FAIL. Les arêtes dures (normales séparées) sont exclues pour l'AO/normal.
   **Test par paire d'îlots** (« une face beaucoup plus claire que sa voisine ») : pour chaque paire d'îlots UV
   partageant ≥ 6 arêtes, la différence **signée** moyenne le long de toute la frontière (luminance, AO, vecteur
   normal en espace objet) : le bruit de texture s'annule, un décalage de bake non. FAIL au-delà de 0,035 de
   luminance / 0,08 d'AO / 8° de normale. Validé : `+8 %` injecté sur un seul îlot → FAIL ; rocher et humanoïde
   propres → PASS. Exclus (réels, pas des coutures) : AO sur arêtes courbes (> 25°), zones de contact (AO < 0,5),
   petites pièces fermées ; faces « fil » de < 5 texels.
   `qa.check_uvs` : texels **superposés** (FAIL), triangles UV miroir/repliés, îlots « éclats » de 1–2 faces,
   et `check_atlas` : couverture et chevauchement **entre objets** partageant une texture.
2. `render.qa_sheets(key, objs, out_dir)` puis **REGARDER** chaque image avec l'outil Read :
   - `<key>_turntable.png` : 8 angles, silhouette, matières crédibles, pas de trou, pas de flottant ;
   - `<key>_wire.png` : topologie (densité là où il faut, pas de triangles isolés) ;
   - `<key>_normals.png` : **tout doit être bleu**. Du rouge = face arrière visible = erreur ;
   - `<key>_uv.png` : damier régulier (taille de carreaux uniforme, pas d'étirement) ;
   - `<key>_poses.png` : chaque clip à 6 instants ; rien ne traverse, pieds au sol, poses lisibles ;
   - `<key>.png` : visuel héros (pour les previews).
3. `node scripts/inspect-glb.mjs <fichier.glb>` : bbox, triangles, os, noms et durées exactes des clips, taille.
   Re-QA d'un GLB exporté sans reconstruire :
   `blender -b --factory-startup --python assets/blender/kit/samples/qa_glb.py -- <fichier.glb> [--budget prop]`
   (`--inject-seam` = auto-test du détecteur, doit échouer). Doute sur une « couture » visible :
   `.../samples/seam_diag.py -- <fichier.glb> [sortie.png]` → planche COMPLET / ALBÉDO / AO / NORMAL MAP / GÉOMÉTRIE /
   ÎLOTS UV sous la même caméra : une couture de bake apparaît comme une ligne dans un panneau texture qui suit une
   frontière du panneau îlots ; sinon c'est de la géométrie sous la lumière (cas du premier `kit_rock.png` :
   facette de fracture du high tournée vers l'ombre, voir `assets/previews/kit/kit_rock_seamdiag.png`).
4. Budgets (ROADMAP §4.4) :

| Catégorie (`budget=`) | Triangles LOD0 | Texture max | GLB max |
|---|---|---|---|
| `hero` / `humanoid` / `npc` | 8–15 k | 2048 | 4 Mo |
| `beast` | 6–15 k | 2048 | 4 Mo |
| `boss` | 20–40 k | 2048 | 8 Mo |
| `building` | 5–20 k | 1024–2048 | 5 Mo |
| `prop` / `rock` | 1–5 k | 1024 | 2 Mo |
| `vegetation` | 2–6 k | atlas 1024 | 2 Mo |

Modèles statiques d'environnement : exporter aussi `<key>_lod1.glb` et `<key>_lod2.glb` (`lod.export_lods`,
`impostor_lod2=True` pour les arbres). Les LOD réduisent aussi les textures (`tex_scale=(0.5, 0.25)` par défaut) :
rocher 626 Ko → LOD1 233 Ko → LOD2 84 Ko.

Éclairage des planches : soleil doré 2,6 + ciel 0,14 + contre-jour, calibré pour qu'un albédo 0,18 face au soleil
reste gris moyen (AgX). Une face au soleil nettement plus claire que sa voisine à l'ombre est donc de la lumière,
pas une couture ; en cas de doute, lisez les chiffres de `check_seams`.

---

## 8. GPU et parallélisme

Plusieurs agents lancent Blender en même temps. `kit.gpu` pose un verrou fichier
(`%TEMP%/brumeval_gpu.lock`, « pid heure ») : **un seul** bake Cycles GPU à la fois ; les autres attendent jusqu'à
240 s puis passent sur CPU. Un verrou est considéré périmé si le processus est mort ou s'il a plus de 20 min.
Les planches EEVEE prennent aussi le verrou (attente max 120 s, puis rendu quand même).
`BRUMEVAL_FORCE_CPU=1` force le CPU. Ne jamais lancer de serveur sur les ports 3000/5173.

**Correctif (signalé par Codex)** : `common.reset()` appelle `read_factory_settings()`, qui **efface les préférences
Cycles** (type de périphérique HIP, GPU cochés). L'ancien `kit.gpu` gardait en cache « HIP OK » et tout bake après le
premier reset tournait silencieusement sur CPU. Désormais `gpu.enable_hip()` revérifie les préférences à chaque
appel (`gpu.prefs_ok()`) et les ré-applique si besoin (log « preferences were reset … re-enabled ») ; `gpu.device()`
refuse d'annoncer « GPU » si Cycles n'est pas réellement configuré. Test de non-régression :
`blender -b --factory-startup --python assets/blender/kit/samples/kit_gpu_selftest.py` → `[gpu-selftest] PASS`
(code de sortie 1 sinon). Ne mettez **jamais** `gpu._state["hip"]` à True vous-même.

---

## 9. Temps de bake mesurés (GPU vs CPU)

Rocher `kit_rock` : atlas 1024², source 123 k triangles → cible 3,6 k triangles de roche (high → low) + 1 k de
touffes de mousse (bake direct composité), mesuré le 2026-09-23 après le correctif des coutures.

| Passe | GPU HIP (RX 6650 XT) | CPU |
|---|---|---|
| baseColor (16 éch.) | 3,5–4,5 s | 18,3 s |
| rugosité | 2,1–2,7 s | 14,2 s |
| métal | 0,9–1,0 s | 1,1 s |
| normal (high → low + direct) | 3,7 s | 36,9 s |
| AO (96 éch.) | 13–14 s | 196 s |
| **bake complet** | ≈ 42 s | 287 s |
| **script complet** (géométrie + bake + export + LOD + QA + planches) | 77 s | 308 s (sans planches) |

Après le passage aux UV `CHARTS` (42 îlots au lieu de 432), même rocher, GPU : base 3,6 s, rugosité 2,0 s,
métal 0,8 s, normal 3,6 s, AO 9,8 s → **bake ≈ 20 s, script complet 51 s**.

Le GPU est ≈ 7× plus rapide sur le bake complet (AO ≈ 14×, normal ≈ 10×) : gardez le GPU pour les bakes, le
verrou évite les collisions ; le repli CPU reste utilisable pour un accessoire.
Humanoïde `kit_humanoid` (2 jeux 1024², AO 64 éch.) : bake complet ≈ 28–40 s GPU. Planches QA EEVEE : ≈ 0,4 s par vue.

---

## 10. Dépannage (pièges réels rencontrés en 5.0.1)

| Symptôme | Cause / solution |
|---|---|
| Texture « camouflage » à taches noires/blanches dans l'AO | le high-poly était visible pendant le bake AO et occultait le low → le kit le masque automatiquement |
| Taches claires partout sur une roche | usure des arêtes sur une géométrie bruitée : `wear` bas (0.1–0.15) pour les roches |
| Damier / moiré sur le tissu | un tissage réel est plus fin qu'un texel : garder le tissage très discret (déjà réglé dans `cloth`) |
| Crash `EXCEPTION_ACCESS_VIOLATION` dans `rna_MeshEdge_select_set` | `mesh.edges.foreach_set("select")` sur un maillage créé en Python : passer par bmesh (le kit le fait) |
| `'NoneType' has no attribute select_set` | objet supprimé encore listé dans `view_layer.objects` : itérer `scene.objects` |
| `Action.fcurves` absent | API « slotted actions » : utiliser `pose_bone.keyframe_insert()` (le kit : `rig.clip`) |
| Os en rotation Euler ignorée | les pose bones sont en QUATERNION : `rig.pose` convertit |
| Test vêtements faux positifs | coque intérieure du Solidify : utiliser `gn.solidify` (étiquette `kit_shell`) ; petits îlots de corps restant sous les vêtements : `delete_covered_body` les supprime |
| Planches rendues dans une pose animée | le kit remet l'armature au repos après les poses ; pensez-y dans vos scripts |
| Moss / clumps saturés « bonbons » | couleurs de mousse sombres et olive (défauts du kit), `embed` pour les enfoncer dans la surface |
| Le rendu ne montre pas mes textures | les planches doivent être faites **après** `bake_asset` (sinon les nœuds Cycles-only n'apparaissent pas pareil dans EEVEE) |
| Une face beaucoup plus claire que sa voisine, arête nette | (1) normales « arc-en-ciel » aux bords des îlots du normal map : géométrie présente dans le low mais pas dans le high → `kit_bake_direct` ; (2) facette plane géante (`planar_cuts` trop profonds) éclairée de face : cassez-la (`depth` 0.02–0.07 + `displace`) ; (3) vérifiez `qa.check_seams` |
| Rugosité / couleur différente de part et d'autre d'une couture | motif en espace UV d'atlas : repasser en `coords_mode="OBJECT"` |
| Bakes subitement très lents après le 1er modèle d'un script | préférences Cycles effacées par `C.reset()` : corrigé dans `kit.gpu` (voir §8), lancez `kit_gpu_selftest.py` |
| Des centaines de petits îlots UV, atlas « confettis » | smart project sur une surface bruitée : `uv_method="CHARTS"` (QA : « fragmented UVs ») |
| Ourlet / manche en escalier, triangles « déchirés » au bord d'un vêtement découpé dans le corps | alignez les sommets du bord sur une ligne d'ourlet avant de gonfler (voir `kit_humanoid.py`) |
| Warning glTF « More than one shader node tex image used for a texture » | ORM partagé (occlusion + rugosité/métal dans la même image) : bénin, une seule texture ORM est écrite |
