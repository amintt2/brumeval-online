# Journal des versions — Brumeval Online

## v0.2.0 — 23/09/2026 · Fondations & Âme

### Combat (à la manière d'un soulslike)
- **Endurance** : nouvelle jauge sous la barre de vie. Elle alimente la roulade, le sprint et les capacités, et se recharge dès que vous soufflez un instant. À zéro, vous êtes essoufflé jusqu'à récupérer un peu.
- **Roulade d'esquive** : appui court sur **Maj**. 5 m dans la direction du déplacement (en arrière sans direction), invulnérable un court instant, 30 d'endurance.
- **Sprint** : **Maj** maintenue (×1,45, consomme de l'endurance). Un appui court ne sprinte jamais, un appui long ne roule jamais.
- **Espace** est réservé au saut (v0.3) : il ne fait rien pour l'instant.
- **Engagement** : chaque capacité ralentit brièvement le lanceur et coûte de l'endurance ; les attaques automatiques à distance ne partent que si vous êtes (presque) à l'arrêt.
- **Attaques télégraphiées** : les coups puissants des monstres s'annoncent au sol (cercle, cône, ligne, anneau) avec une zone qui se remplit jusqu'à l'impact. Sortez-en ou roulez au bon moment. Les projectiles des monstres visent un point au sol et s'esquivent.
- **Retour de coups** : direction des dégâts sur le bord de l'écran, vignette quand la vie est basse, léger arrêt sur image aux coups lourds, barre de boss.
- **Rééquilibrage** : les trois classes sont désormais à moins de 15 % l'une de l'autre (Mage et Rôdeur étaient trop forts).

### Monstres
- **Nouvelle IA** : chaque type de monstre a son comportement (brute, chargeur, escarmoucheur, tireur, lanceur de sorts, meute…) et chaque individu son tempérament (réactivité, distance préférée, prudence). Ils tournent autour de vous, se replient, appellent leurs alliés, abandonnent la poursuite.
- **Élites** et **variantes** (gobelins lanceurs de javelots, occultistes…), repérables à leur nom.
- **Posture** : les gros coups font chanceler un monstre et annulent son attaque en préparation ; certains se protègent de face.
- **Golem ancien** : combat en plusieurs phases, nouvelles attaques à chaque phase, enragé sous 30 % de vie.

### Mort
- **Écho de mort** : à votre mort, l'expérience gagnée dans le niveau reste sur place sous forme d'écho (visible seulement par vous, indiqué sur la minicarte). Retournez le toucher pour la récupérer ; une seconde mort le fait disparaître.

### Graphismes
- Nouveau rendu : ciel et lumière d'ambiance qui suivent le soleil, ombres en cascade, occlusion ambiante, brume au sol et rayons de lumière, bloom, tonalité filmique, anticrénelage.
- Terrain retravaillé (couleurs par type de sol, roche sur les pentes, niveaux de détail), **herbe dense qui ondule au vent** et s'écarte sur votre passage, eau plus réaliste (profondeur, écume, reflets du ciel).
- **Réglages graphiques** (touche **O** ou bouton « Graphismes ») : préréglages Bas / Moyen / Élevé / Ultra, choix automatique au premier lancement, options séparées (ombres, herbe, distance, post-traitement, résolution dynamique, limite d'images par seconde).

### Launcher et application
- **Launcher Brumeval** pour ordinateur (actualités, état du serveur, bouton JOUER, options, mises à jour automatiques). Voir docs/LAUNCHER.md.
- Le jeu s'**installe comme une application** depuis le navigateur (bouton « Installer » de la barre d'adresse) et démarre plus vite grâce au cache.
- Après une mise à jour du serveur, le jeu vous propose de recharger la page.

### Serveur, réseau et sécurité
- Réseau optimisé : environ 10 fois moins de données échangées (compression, envoi des seules valeurs qui changent), serveur plus rapide avec beaucoup de joueurs.
- Sauvegarde **un fichier par personnage** et sauvegarde quotidienne complète ; les personnages de la v0.1 sont importés automatiquement, progression comprise.
- **Anti-triche** : vitesse, téléportation, traversée des murs et envois de messages abusifs sont détectés ; expulsion puis bannissement temporaire en cas de récidive. Les roulades et le sprint ne provoquent jamais de correction.
- Connexion protégée (tentatives limitées, noms réservés ou trompeurs refusés) ; les **nouveaux** personnages demandent un mot de passe d'au moins 6 caractères.
- Discussion : `/ignore` et `/unignore`, filtre anti-spam ; commandes de modération pour les maîtres du jeu (`/mj`).

## v0.1.1 — 23/09/2026 · Nouvelles icônes et illustrations

- **Nouvelles icônes** pour tous les objets et toutes les compétences, dans un style dark fantasy réaliste (rendues dans Blender par Codex) : potions lisibles même en petit, sorts de feu enflammés, flèches bien différenciées.
- Arrivée (pas encore affichés en jeu) : **logo et illustrations** des écrans de connexion et de chargement, **armes et boucliers visibles**, **effets météo**, **kit d'interface** dark fantasy. Ils seront branchés dans le jeu en v0.2 et v0.3.
- Documentation : feuille de route mise à jour (arbre de compétences, butin v2, échanges, zones rouges, monde ouvert), brief et coordination avec Codex.
