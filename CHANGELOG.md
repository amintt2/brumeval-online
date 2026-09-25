# Journal des versions — Brumeval Online

## v0.3.0-a1 — correctif

- Les touches **5 à 8** de la barre d'action et l'**attaque chargée** ne sont plus refusées par le serveur, et
  « Confirmer » dans l'Arbre des Brumes accepte jusqu'à **64 nœuds** en une fois (un personnage de niveau 30 a 35 points).

## v0.3.0-a — L'Arbre des Brumes (interface du jeu)

- **Écran de l'Arbre des Brumes** (touche **N**, bouton « Arbre » et menu principal) : les 318 nœuds en plein écran,
  qu'on déplace à la souris et qu'on zoome à la molette. Régions colorées (Guerrier, Mage, Rôdeur, Survie, passerelles),
  une forme par type de nœud (compétence, variante, passif à rangs, clé de voûte, Fondamental), nœuds acquis, disponibles
  ou verrouillés, pastille orange « pas de don » (2 ou 3 points) et alerte d'Inaptitude.
- **Infobulles chiffrées** : ce que change le nœud sur la compétence (avant → après), son coût, ses conditions, et
  pourquoi il est verrouillé. **Recherche** (Ctrl+F), **chemin le moins cher** au survol, puis en un clic.
- **Rien n'est dépensé sans « Confirmer »** : les nœuds choisis restent en attente (clic droit pour en retirer un).
  **Parcours conseillé** : jusqu'au niveau 10, un clic propose les nœuds de votre classe (Roulade d'abord).
- **Renaissance** au niveau 30, depuis l'arbre : explication, bonus, choix de la classe d'affinité, double confirmation.
- **Livre de compétences** (touche **K**) : vos compétences avec leurs vraies valeurs (variantes, passifs, Inaptitude
  en orange), les Fondamentaux et leurs touches, les potions ; **glisser-déposer** sur la barre d'action.
- **Barre d'action à 8 emplacements** (touches 1 à 8), enregistrée sur le serveur ; glisser une entrée hors de la barre
  la retire. Les Fondamentaux (Roulade, Saut, Garde, Sprint) s'affichent à côté avec leur touche.
- **Nouvelles touches** : Espace = Saut, Maj = Roulade (appui court) / Sprint (maintien), E = Garde (maintenue),
  maintenir 1 = Attaque chargée. **Toutes les touches se changent** dans Options › Commandes (clavier et boutons de
  souris, conflits signalés, retour aux touches par défaut) ; l'aide et la barre montrent les touches choisies.
- **Montée de niveau** : « +1 point de compétence » avec un bouton vers l'arbre et le nœud conseillé ; la première
  fois, un petit tutoriel explique les Fondamentaux. Le bouton « Arbre » affiche vos points à dépenser.
- **Effets visuels** : saut, pose de garde, blocage et parade parfaite, garde brisée, lueur de l'attaque chargée,
  vacillement, zones au sol (mur de feu, nuage toxique, blizzard, météore), pièges, boucliers, canalisations, bonds,
  statuts (brûlure, froid, gel, poison, saignement, marque…) en icônes sur les monstres et dans le cadre de la cible,
  aura et titre « Né de la Brume ». Les télégraphes **rasants** ont des vagues, les **imblocables** une bordure
  crénelée, les **sorts** des runes violettes.

## v0.3.0 (en préparation) — L'Arbre des Brumes (moteur serveur)

- **L'Arbre des Brumes** : un seul grand arbre de 318 nœuds pour tout le monde. Au niveau 1, seulement l'attaque de
  base ; 1 point par niveau (+1 tous les 5 niveaux), **35 points au niveau 30**. D'abord 3 **Fondamentaux**
  (Roulade, Sprint, Saut, Garde, Attaque chargée), puis la région de votre classe, les passerelles hybrides… ou une
  autre classe, plus chère et avec une pénalité d'**Inaptitude**. Tout est vérifié par le serveur.
- **Niveau maximum 30** (l'XP jusqu'au niveau 20 ne change pas).
- **Nouveaux Fondamentaux** : le **Saut** passe au-dessus des ondes de choc du golem ; la **Garde** bloque les coups
  de face au prix d'endurance (Parade parfaite en variante) ; l'**Attaque chargée** (maintenir l'attaque de base)
  brise les postures.
- **65 compétences** et leurs variantes, avec brûlure, froid, gel, poison, saignement, marques, pièges, murs de
  glace, zones au sol… Les télégraphes indiquent désormais les attaques **rasantes** (à sauter), **imblocables** et
  les **sorts**. Un coup télégraphié qui touche fait **vaciller** un instant.
- **Barre d'action à 8 emplacements**, enregistrée sur le serveur ; une compétence apprise s'y place toute seule.
- **Pas de réinitialisation : la Renaissance.** Au niveau 30, retour au niveau 1 avec tous les points rendus, en
  gardant équipement, or, sac et quêtes, et des bonus permanents (jusqu'à 5 fois) : +15 % d'XP, Inaptitude réduite,
  classe d'affinité, +1 point, titre « Né de la Brume » et aura.
- **L'équipement n'est plus réservé à une classe** : un hybride porte l'arme de ses compétences.
- **Vos personnages v0.2 ne perdent rien** : roulade et sprint offerts, leurs 4 compétences sur les mêmes touches,
  et les points de leur niveau à placer (docs/COMPTES.md, « Migration v0.3 »).

## v0.2.1 — correctifs

### Sécurité des comptes
- **Ajouter une clé d'accès redemande le mot de passe** si vous ne l'avez pas tapé dans les 10 dernières minutes (par exemple après une connexion par « Rester connecté ») : un appareil mémorisé ne suffit plus à installer une clé d'accès durable.
- **Changer de mot de passe** ferme aussi les autres connexions ouvertes, et peut **supprimer toutes les clés d'accès** en même temps (case cochée par défaut quand le compte en a).
- Des échecs de connexion envoyés depuis d'autres adresses ne bloquent plus votre connexion par mot de passe depuis votre appareil habituel.

### Combat
- **Zones télégraphiées à l'heure** : la zone se remplit en tenant compte de votre latence, une roulade lancée quand elle est pleine arrive à temps au serveur.
- **Bonds et charges** : le gluant et le loup partent pendant la fin de leur préparation et arrivent **avec** le coup (plus de coup reçu d'un monstre encore à 5 m). Le gluant atterrit contre vous, plus sur vous.
- Les monstres ne se tiennent plus **dans** le corps du joueur.
- **Déséquilibre** : la frappe du guerrier déséquilibre moins (poise 7 au lieu de 12) et un monstre qui vient de tituber est insensible au déséquilibre 2 s : l'attaque de base seule ne tient plus gluants et loups à la merci, il faut aussi esquiver.
- Le Bond du gluant frappe plus fort (×1,6), la Ruée du loup un peu moins (×1,35).
- Message de mort : « Vous avez été vaincu (Loup gris). »

## v0.2.0 — 23/09/2026 · Fondations & Âme

### Comptes et personnages
- **Un compte, jusqu'à 5 personnages** : un nom de compte et un mot de passe, puis un écran de **sélection des personnages** (nom, classe, niveau, zone, dernière partie, aperçu 3D du personnage sur un piédestal). Créez un autre personnage ou changez de classe sans créer de nouveau compte.
- Vos anciens personnages sont conservés : chacun devient un compte **du même nom, avec le même mot de passe**, contenant ce personnage avec toute sa progression.
- **Rester connecté** : case à cocher (cochée par défaut dans le launcher). Au prochain lancement, vous arrivez directement sur vos personnages, le dernier joué présélectionné : appuyez sur **Entrée** pour jouer.
- **Clés d'accès (passkeys)** : connectez-vous sans mot de passe avec l'empreinte, le visage ou le code de votre appareil (« Se connecter avec une passkey »). Proposé après une connexion par mot de passe, et à tout moment dans **Compte**.
- **Compte** : clés d'accès (ajouter, renommer, supprimer), changement de mot de passe, « Se déconnecter partout ».
- **Changer de personnage** sans quitter le jeu, supprimer un personnage (en tapant son nom pour confirmer).
- Détails : docs/COMPTES.md.

### Menus et carte
- **Menu principal** (**Échap** quand aucune fenêtre n'est ouverte, ou bouton « Menu » sous la minicarte) : Reprendre, Carte, Options, Compte, Changer de personnage, Se déconnecter, Quitter (dans le launcher).
- **Carte du monde** (touche **M** ou bouton « Carte ») : régions, village, camps, routes, lacs, personnages, objectifs de vos quêtes en cours, joueurs proches, votre position et votre orientation. Zoom à la molette, déplacement en glissant, **clic pour poser un repère** (visible aussi sur la minicarte), clic droit pour le retirer.
- **Options** (touche **O**) : graphismes, **volume du son** et commandes. Le son ne se coupe plus avec **M** (qui ouvre la carte) mais dans Options.
- Nouveaux écrans de connexion et de chargement illustrés (logo et artworks).

### Site web
- Sur le site, une carte propose de **télécharger le launcher** pour votre système (Windows, macOS, Linux) — performances, mises à jour automatiques, plein écran — ou de **jouer directement dans le navigateur**. Elle peut être masquée ; l'installation de l'application web est proposée quand le navigateur le permet.

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
