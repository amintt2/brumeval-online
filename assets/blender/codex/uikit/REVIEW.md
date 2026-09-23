# Relecture visuelle — 23 septembre 2026

Les 27 rendus ont été examinés dans `previews/contact.png`, puis à des tailles d'usage dans `previews/in_context.png`. Les états de boutons se distinguent sans couleur vive ; les curseurs flèche, épée, bulle et main se reconnaissent à 32 px. Les remplissages restent distincts et les ouvertures de cadres réellement transparentes.

`previews/nine_slice.png` a été ouverte et inspectée : panneau étroit 310×440 et panneau large 700×220 conservent la taille des filigranes. Une première marge de bouton découpait l'ornement et l'étirait ; la marge est corrigée à 48 px. Les coins de panneaux utilisent 64 px et ceux d'emplacements 28 px. Les pixels du coin haut-gauche conservé sont également comparés automatiquement.

Le grain est volontairement discret pour préserver la lecture. La pierre se distingue surtout par des variations de valeur plus larges que le cuir. Le filigrane reste sobre ; il ne vise pas une densité décorative de menu AAA. Les curseurs main/bulle sont des silhouettes de petite taille, pas des miniatures réalistes. La mise en situation montre des emplacements vides pour isoler le rendu du kit ; elle n'est pas une capture du jeu intégré.

Rendu final : Cycles CPU, quatre threads, 48 échantillons, résolution double puis réduction Lanczos. Aucune occupation du GPU partagé. QA automatique : 27 actifs valides, dimensions et transparences attendues, coordonnées des points actifs et marges valides, empreintes des fichiers enregistrées dans `qa.json`.
