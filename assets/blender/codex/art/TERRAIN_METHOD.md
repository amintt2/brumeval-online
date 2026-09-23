# Terrain procédural : références et choix de construction

Consultation du 23 septembre 2026, suite au retour d'Amin.

- Blender, [A.N.T. Landscape](https://docs.blender.org/manual/en/4.0/addons/add_mesh/ant_landscape.html) : terrain subdivisé, familles de bruit, déplacement, masque de pente et outils d'érosion. Référence de méthode ; l'extension historique n'est pas une dépendance installée ici.
- QuadSpinner, [Erosion](https://docs.gaea.app/reference/nodes/simulate/erosion) et [Noises, Primitives, and Landscapes](https://docs.gaea.app/using/using-gaea/crafting-the-surface/noises-primitives-and-landscapes.html) : distinguer forme générale, détails et transport de sédiments ; le bruit seul ne donne pas une géologie convaincante. Notre code n'emploie pas Gaea et ne prétend pas reproduire son solveur.
- Blender, [Distribute Points on Faces](https://docs.blender.org/manual/en/4.3/modeling/geometry_nodes/point/distribute_points_on_faces.html) : distribution contrôlée par un champ de densité. Ici le générateur Python évalue le champ en coordonnées monde, avec bruit à deux échelles et déformation de domaine, puis applique les exclusions d'accès.

Le rendu final doit être relu en vue large, de profil et depuis l'arrière : une silhouette convaincante dans une seule caméra ne suffit pas. Le terrain reste un élément des illustrations CX-1, pas un niveau jouable exporté.
