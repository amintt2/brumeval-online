# Revue CX-1 — seconde passe et inspections multiangles

Les illustrations et les scènes ont été retravaillées à partir des retours de Claude, puis des défauts repérés par Amin et trois sous-agents. Le logo approuvé reste strictement identique à la première passe.

## Ce qui change

Village : caméra basse, voyageur, lanternes, pavage continu, maisons différenciées, château sur plateau avec remparts, contreforts et accès. Falaise : masses irrégulières et éboulis, plus de nervures périodiques. Cimetière : chapelle ruinée ouverte, stèles variées, lanternes, corbeaux. Antre : repère humain, lumière latérale, colonnes cassées, poussières et arche continue. Forêt : racines plus courtes et enterrées, sous-bois, ligne d'arbres et relief au fond, stèle en pierre avec trois glyphes. Bannière : cadrage panoramique distinct et logo approuvé sur une zone sombre latérale.

## Correction signalée par Amin

La maison gauche avait été surélevée avec ses petites marches : elles flottaient devant le soubassement. L'élévation est réduite et l'escalier est reconstruit avec des volumes pleins depuis le terrain jusqu'au palier. Les cinq maisons suivent le même principe. Herbe et pierres sont exclues des accès.

`check_access.py` vérifie les vertices évalués après transformations et biseaux. Les cinq escaliers sont ancrés 1,5 cm sous le terrain ; les marches se recouvrent sans intervalle ; le haut du palier correspond au bas de la porte. Maison gauche : huit contremarches d'environ 16,16 cm. Trois vues proches vérifient également le raccord au sol et au seuil.

## Revue indépendante

23 vues : maison 3, château/falaise 8 avant et latérales + 3 arrière, cimetière 3, antre 3, forêt 3. Les premières captures et critiques sont conservées dans `previews/angles-before/`. Les planches corrigées sont dans `previews/angles/`. Voir `MULTIANGLE_REVIEW.md`, `ACCESS_AND_CLIFF_REVIEW.md` et `FINAL_SCENE_REVIEW.md` dans les dossiers indiqués.

Les critiques distinguent les corrections vérifiables des réserves artistiques. La composition et les accès progressent ; certains cylindres, appareils de pierre, végétaux et lumières restent trop réguliers pour prétendre atteindre la richesse d'Elden Ring. Cette livraison est une seconde passe à relire, pas une validation artistique de publication.

Ces scènes produisent des images fixes de CX-1. Le contrôle des marches porte sur les volumes représentés ; il ne valide pas la navigation ni les collisions d'un niveau jouable.

## Contrôles techniques

`review.py` contrôle les sept fichiers, leurs dimensions, le décodage, la transparence des logos et les empreintes SHA-256. Les logos sont également comparés octet par octet au commit `2afac69`. `check_access.json` conserve les mesures des cinq escaliers. Les scripts et les preuves restent exclusivement dans les dossiers réservés à CX-1.

Après chaque remise à zéro complète de Blender, le module GPU est rechargé pour réinitialiser son cache de préférences HIP. Ce contournement local a été signalé à Claude ; le kit partagé reste inchangé.
