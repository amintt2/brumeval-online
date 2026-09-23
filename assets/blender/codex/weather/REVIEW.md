# Relecture CX-6

Les sept planches d'images ont été ouvertes et examinées après le rendu final : 144 images, Cycles CPU, 16 échantillons à 512 pixels puis réduction à 256 pixels. Les contrôles de `qa.json` passent : dimensions et nombres d'images, alpha transparent sur trois pixels de bord, événements ponctuels transparents au début et à la fin, raccords de boucle et compression WebP sans perte.

Constats visuels : les gouttes sont fines et inclinées ; l'éclaboussure s'élargit puis disparaît ; les flocons dérivent avec des tailles distinctes ; le sable comporte une nappe plus chaude et des grains horizontaux ; la brume est froide et allongée ; l'éclair conserve ses ramifications pendant ses trois impulsions ; les braises montent avec un cœur et un halo discrets. La palette et l'opacité sont volontairement sobres pour superposer plusieurs panneaux sans saturer l'écran.

L'aperçu HTML charge les véritables atlas. Sa syntaxe JavaScript a été vérifiée ; les images et raccords ont été contrôlés sur planches et par mesures, mais l'animation n'a pas encore été validée dans le moteur du jeu.

Limites connues : le tracé d'éclair est une seule variante ; il faudra varier sa position, sa taille et son orientation. L'éclaboussure est vue en perspective et nécessite un panneau orienté vers la caméra. La neige reste fine à 256 pixels. Ces ressources ne gèrent pas l'occultation par les toits, la profondeur, les collisions ou l'éclairage global de l'éclair : ce sont des responsabilités du client. Le rendu des nappes demeure celui de panneaux transparents et ne remplace pas un volume 3D lors d'une rotation de caméra.

Les sept textures représentent environ 4,03 Mo, dont l'essentiel provient de la brume et du sable sans perte. Le chargement à la demande évite de payer ce coût pour chaque région. Aucun budget explicite plus bas n'a été fixé pour CX-6.
