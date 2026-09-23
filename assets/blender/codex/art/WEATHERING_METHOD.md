# Choisir les masques selon la matière

Pour les illustrations CX-1, les masques représentent une cause d'usure et ne remplacent pas la forme de l'objet.

| Effet | Masque / bruit retenu | Usage |
|---|---|---|
| Relief | Ridged multifractal, déformation du domaine, érosion | Crêtes, cols, ravines et talus |
| Herbe | Bruit fractal à deux échelles, gradient de bordure | Densité et hauteur en taches, chemins dégagés |
| Vieille pierre | Noise fractal à grande échelle, bruit étiré, creux et hauteur | Nuances minérales, coulures et humidité près du sol ; joints conservés |
| Fer oxydé | Noise pour les nappes, Voronoi pour casser leurs limites, creux | Rouille localisée, rugosité accrue, métal moins réfléchissant dans les zones oxydées |
| Tissu ancien | Noise doux pour la décoloration, bruit fin étiré pour les fibres | Teinte et rugosité variées ; plis, ourlets abîmés et petites déchirures en géométrie |

Le White Noise indépendant par point sert à varier des objets ou des graines ; seul, il donne du grain aléatoire et ne décrit ni un ruissellement ni l'histoire d'une surface.

Références primaires consultées : [Noise et modes Musgrave dans Blender](https://developer.blender.org/docs/release_notes/4.1/rendering/), [Voronoi](https://docs.blender.org/manual/en/3.0/render/shader_nodes/textures/voronoi.html), [Ambient Occlusion](https://docs.blender.org/manual/en/latest/render/shader_nodes/input/ao.html). Les effets sont construits dans nos fichiers réservés ; la bibliothèque commune reste en lecture seule.
