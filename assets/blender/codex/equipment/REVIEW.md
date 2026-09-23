# Relecture CX-3

La génération a été contrôlée sur les fichiers GLB réimportés, et non seulement sur les objets procéduraux de Blender. Chaque modèle dispose de huit angles, d'une planche de maillage, d'une planche de normales, d'un damier UV et d'aperçus des deux LOD. Le parent et un agent indépendant ont ouvert les images pendant la production.

## Corrections issues des images

- Le sol du studio masquait les pommeaux et le bas des hampes puisque l'origine est dans la main : studio sans sol.
- Les pointes de lame conservaient une épaisseur excessive : épaisseur réduite vers la pointe.
- Arc initial orienté transversalement : orientation corrigée pour décocher vers -Y Blender ; corde derrière la prise.
- Corde dessinée en V malgré l'état de repos : corde droite et recul des encoches pour conserver un band de 11 à 15 cm.
- Petites pierres d'arc détachées du bois : implantation sur la courbe réelle des branches.
- Cristaux de bâton : ajout d'une douille sous la pierre pour matérialiser son support.
- Rouille trop orange et grands aplats : désaturation et échelle de variation affinée.
- Occlusion trop forte autour des petites pièces : contribution réduite à 35 % dans l'ORM exporté, sans assombrir la couleur de base. Les contacts restent lisibles et se combinent mieux à l'éclairage du jeu.
- La décimation globale du kit détruisait les lames et poignées au LOD2 : réduction par composant avec contrôle de silhouette dans 26 directions. Les budgets réels et écarts à la cible sont consignés dans les rapports, sans masquer les avertissements.
- Raccord clair du cerclage : le tube forme maintenant une vraie boucle, sans faces de fermeture superposées.
- Arcs longs : dépliage CHARTS et contraste de couleur limité sur les surfaces très fines, pour supprimer les raccords de texture ; relief et rugosité conservés.
- Tangentes absentes à l'export initial à cause des faces à plus de quatre sommets : triangulation explicite et contrôle de l'attribut TANGENT dans chaque GLB. La réexportation des onze épées/bâtons a conservé exactement les octets des textures embarquées.

## Qualités et limites artistiques

Les armes possèdent des volumes continus, des tranchants plus clairs, des prises en cuir, une patine sobre et des détails encore lisibles aux vues latérales. Les boucliers et les têtes de bâton ont des silhouettes distinctes. Les huit angles permettent de repérer des défauts qu'une image unique aurait cachés.

Le résultat reste stylisé : certaines gardes sont lisses, les grandes épées restent proches des épées simples, le bois a un grain assez régulier et les cristaux sont opaques/facettés. Les surfaces métalliques montrent davantage une patine nuageuse que des micro-rayures photographiques. Ce n'est pas une équivalence de qualité avec les assets d'Elden Ring.

Les diagnostics conservent les alertes de coutures et de faces coplanaires aux raccords de petites pièces. Elles doivent être lues avec les vues finales ; un avertissement n'est pas transformé en réussite silencieuse. Le montage aux mains, les seuils de changement de LOD et l'éclairage du client restent du ressort de l'intégration par Claude.

## Livraison contrôlée

54 GLB validés : 18 modèles et 36 LOD. Les modèles de base comptent 1 288 à 2 780 triangles ; le plus gros pèse 483 460 octets. Après la retouche des arcs, l'ensemble des GLB pèse 10 032 676 octets. Une matière par fichier, textures WebP embarquées, positions/normales/UV/tangentes présentes et pivots à zéro. Les 126 PNG de contrôle sont décodables.

LOD1 : 30,0 à 38,2 % des triangles de base. LOD2 : 6,7 à 14,3 %. Ce dépassement ciblé de la cible initiale évite la disparition des pièces porteuses. Les contours de boucliers restent plus anguleux au LOD2 et nécessitent un seuil d'affichage lointain.

Zéro erreur dans les rapports source finaux. Les avertissements restants concernent surtout des îlots UV fragmentés, une occupation d'atlas faible sur certains arcs/boucliers, des écarts de texture locaux et quelques faces proches dans les assemblages de bâton. Ils restent dans `delivery-checks.json` et les rapports individuels ; l'utilisation mémoire des atlas peut encore être optimisée.

## Retouche des arcs demandée par Amin

Les quatre arcs semblaient trop proches dans la galerie. La progression devient bois sombre / bois cuivré / frêne clair avec dorures / branches largement dorées avec incrustations et cuir sombres. Les courbures sont également différenciées et le quatrième est plus épais. La version dorée conserve une rugosité et une patine procédurales ; sa silhouette et sa corde sont conservées aux LOD. Les rendus GLB, vues tournantes, normales et LOD ont été inspectés. Comparaisons dans `bows-current.jpg` et `bow-comparison.jpg` ; les anciennes vues sont archivées dans `bow-revision-before/`.
