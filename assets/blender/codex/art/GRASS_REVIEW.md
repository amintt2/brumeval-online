# Relecture terrain et végétation — 23 septembre 2026

Retours d'Amin : herbe trop fine et clairsemée, montagnes et colline trop sculptées, répartition végétale trop uniforme.

## Réalisation

- Brins courbés plus larges, touffes superposées, hauteur et densité pilotées par bruit à plusieurs échelles avec déformation du domaine. Les bordures se raréfient progressivement ; les accès restent exclus.
- Montagnes continues : ridged multifractal Blender, déformation à plusieurs échelles, crêtes et cols variables, érosion hydraulique simplifiée avec transport/dépôt et relaxation des talus.
- Socle : relief préexistant dont seules les fondations sont nivelées ; petits décrochements, détails de surface et fragments au pied des pentes. Matériau partagé conservé, modulé par pente et altitude.

## Relecture indépendante et corrections

Trois itérations examinées en vue du village et de profil. Le premier essai trop blanc et en mur continu a été rejeté ; le second gardait des pentes molles et masquait l'accès. La troisième version améliore les contours, le raccord au terrain et la lecture de la rampe.

L'angle droit montre la volée inférieure, le palier, la volée supérieure et la porte en continuité, sans tronçon enterré ni trou apparent. Les marches de la maison restent dégagées. Le sous-agent critique confirme le progrès de la densité et la disparition des petits peignes d'herbe.

Réserves conservées : les reliefs présentent encore des formes arrondies et bosselées ; les plans de fracture ne donnent pas encore une géologie de haute fidélité. L'architecture demeure stylisée. La méthode procédurale ne vaut pas, à elle seule, validation artistique Elden Ring. Le sentier forestier garde une tache lumineuse à bord assez net.

Ces images sont les illustrations fixes CX-1 ; aucune modification des modèles temps réel, collisions ou niveaux du jeu.
Contrôle supplémentaire du raccord village/terrain : la première version remontait de 20 à 33 cm sous les deux maisons du fond. Le relief est maintenant maintenu sous le sol du village jusqu'à y=55 m, puis raccordé progressivement sur 12 m. `check_settlement_terrain.py` confirme le niveau -0,065 m aux centres et approches de ces deux maisons ; le terrain original est à -0,05 m. Ce contrôle géométrique ne simule pas le déplacement d'un joueur.

## Complément demandé : usure et liaison des fondations

Deux bannières délavées sont fixées aux remparts, avec plis, ourlets irréguliers et petites déchirures géométriques. La pierre conserve ses joints et reçoit des variations minérales, coulures et humidité ; la herse reçoit une oxydation localisée. Les gros plans permettent de juger ces effets sans dépendre de la caméra lointaine.

Le nœud de contact corrige le vide sous les structures porteuses, y compris lorsque leurs empreintes se chevauchent. Contrôle sur le vrai château : 2 830 sommets relevés, correction maximale 1,425 m, aucun déplacement négatif, passage central inchangé. Voir `contact-check.json`. Il reste des limites artistiques : pierre encore régulière et relief arrondi par endroits ; ces corrections ne valent pas une validation globale du style Elden Ring.

Relecture finale de 23 vues et 3 gros plans : aucun gros vide visible sous les tours et à la jonction roche/plateforme ; accès continu jusqu'à la herse. Les cadrages `cemetery-02-tombes` et `forest-02-racines` ont été déplacés pour retirer une obstruction du premier plan : leur ancienne capture n'est donc pas une comparaison à caméra identique. Les vues arrière restent des vues de diagnostic d'un décor d'illustration, avec un sol lointain plat et des limites de décor visibles. La pierre et les déchirures des bannières demeurent trop régulières pour qualifier le résultat de photoréaliste.
