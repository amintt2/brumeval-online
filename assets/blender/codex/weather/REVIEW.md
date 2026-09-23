# Relecture CX-6

Les sept planches d'images ont été ouvertes et examinées après le rendu final : 144 images, Cycles CPU, 16 échantillons à 512 pixels puis réduction à 256 pixels. Les contrôles de `qa.json` passent : dimensions et nombres d'images, alpha transparent sur trois pixels de bord, événements ponctuels transparents au début et à la fin, raccords de boucle et alpha sans perte. Une relecture indépendante a confirmé ces points, avec des ratios raccord/variation adjacente entre 0,926 et 1,165 pour les cinq boucles.

Constats visuels : les gouttes sont fines et inclinées ; l'éclaboussure s'élargit puis disparaît ; les flocons dérivent avec des tailles distinctes ; le sable comporte une nappe plus chaude et des grains horizontaux ; la brume est froide et allongée ; l'éclair conserve ses ramifications pendant ses trois impulsions ; les braises montent avec un cœur et un halo discrets. La palette et l'opacité sont volontairement sobres pour superposer plusieurs panneaux sans saturer l'écran.

L'aperçu HTML charge les véritables atlas. Sa syntaxe JavaScript a été vérifiée ; les images et raccords ont été contrôlés sur planches et par mesures, mais l'animation n'a pas encore été validée dans le moteur du jeu.

Limites connues : le tracé d'éclair est une seule variante ; il faudra varier sa position, sa taille et son orientation. L'éclaboussure est vue en perspective et nécessite un panneau orienté vers la caméra. La neige reste fine à 256 pixels. Ces ressources ne gèrent pas l'occultation par les toits, la profondeur, les collisions ou l'éclairage global de l'éclair : ce sont des responsabilités du client. Le rendu des nappes demeure celui de panneaux transparents et ne remplace pas un volume 3D lors d'une rotation de caméra.

Un essai RGB qualité 90 de la brume et du sable a réduit leurs poids sans changer un seul pixel d'alpha. La comparaison côte à côte n'a pas montré de bandes visibles ; l'erreur RGB moyenne pondérée par l'alpha est d'environ 0,0009 sur une échelle de 0 à 1. Ces deux compressions sont retenues. Les sept textures passent d'environ 4,03 Mo à **1,78 Mo**, les cinq autres textures restant intégralement sans perte. Le chargement à la demande demeure conseillé.

Le manifeste donne désormais `anchorUV=[0.5,0.6125]` pour l'éclaboussure, et la prévisualisation aligne ce point sur le repère au sol. Cet ancrage évite le décalage vertical de 0,135 m qu'aurait produit un placement au centre du panneau.
