# Décisions du joueur-producteur — prioritaires sur les autres documents

Ces décisions ont été prises par l'utilisateur le 23/09/2026 après lecture de la conception v0.3. **Elles remplacent** les passages contraires de `ARBRE_COMPETENCES.md` et de `OBJETS_ARTISANAT.md`.

## 1. Pas de roulade au niveau 1
On garde la conception : au niveau 1, seulement l'attaque de base. La Roulade s'apprend avec le premier point (niveau 2), comme les autres Fondamentaux.

## 2. Prix libres entre joueurs, avec un marché « intelligent » qui s'équilibre tout seul
- Chez les marchands PNJ, un objet fabriqué se revend pour la valeur de ses matériaux (aucune création d'or).
- Entre joueurs, le prix est libre, mais le marché aide à trouver le juste prix :
  - **Historique des prix** : pour chaque objet (base + rareté + palier), prix médian des ventes des 7 derniers jours, avec un petit graphique.
  - **Prix suggéré** au moment de mettre en vente (médiane récente, avec une fourchette basse et haute). Un prix hors fourchette (moins de 30 % ou plus de 300 % de la médiane) demande une confirmation, pour éviter les erreurs et les arnaques.
  - **Ordres d'achat** : un acheteur fixe un prix maximum pour un objet, et le serveur les associe automatiquement aux annonces compatibles, même quand les deux joueurs sont hors ligne.
  - **Prix de rachat PNJ dynamiques** : si beaucoup d'exemplaires d'un objet ont été revendus au marchand récemment, son prix de rachat baisse temporairement, puis remonte.
  - **Garde-fous** : taxe de 5 % sur les ventes et frais de dépôt de 1 % non remboursables (contre le spam d'annonces), nombre d'annonces limité par joueur, médiane robuste qui ignore les ventes isolées et les petits volumes (anti-manipulation), et toutes les transactions sont validées par le serveur.

## 3. Pas de réinitialisation de l'arbre : la **Renaissance**
La réinitialisation contre de l'or chez le Maître des arts est **supprimée**, ainsi que la gratuité jusqu'au niveau 10. À la place :
- **La Renaissance** est disponible au **niveau 30**, par un rituel au pied de l'Arbre-Brume.
- **Effets** : le personnage revient au **niveau 1** et **tous ses points sont rendus**, y compris les Fondamentaux : il doit **tout rechoisir** en remontant. Il garde son équipement, son or, son inventaire, sa banque, ses quêtes terminées et ses métiers. L'équipement dont le niveau requis est trop haut ne peut plus être porté jusqu'à ce qu'il ait regagné le niveau.
- **Bonus de Renaissance**, cumulables et permanents, jusqu'à 5 Renaissances (« Né de la Brume I à V ») :
  - **+15 % d'XP permanents** par Renaissance (+75 % à la cinquième).
  - **Inaptitude réduite** de 5 points par Renaissance : −25 % → −20 % → … → 0 % à la cinquième.
  - **Classe d'affinité** : dès la 2ᵉ Renaissance, on choisit une autre classe dont les nœuds ne coûtent plus que **1 point** au lieu de 2 (une nouvelle classe tous les 2 cycles).
  - **+1 point de compétence** bonus par Renaissance.
  - Un **titre** et une **aura visuelle** (brume spectrale) qui montrent le nombre de Renaissances.
- Les personnages existants (v0.2) n'ont pas besoin de réinitialisation : ils reçoivent leurs points pour leur niveau actuel et la migration place d'office les Fondamentaux qu'ils utilisaient déjà (roulade, sprint).

## 4. Touches par défaut (décidé le 23/09)
- **Espace = Saut** (plus naturel).
- **Maj : appui court = Roulade, maintien = Sprint** (comme Elden Ring). Cette disposition s'applique **dès la v0.2**, qui n'a pas encore le saut : Espace n'y fait rien, ou sert provisoirement de roulade pendant une période de transition si les joueurs le demandent.
- **Garde = E maintenue** par défaut.
- Clic gauche = attaque de base / sélection, clic droit = cibler et attaquer, 1 à 8 = barre d'action.
- **Toutes les touches sont réassignables** dans Options > Commandes (clavier et boutons de souris). Chaque touche du menu d'aide et de l'interface affiche la touche réellement assignée.

## 5. Monde ouvert (décidé le 24/09)
- **Ruines d'Aldmar gardées aux niveaux 24-28**, visibles depuis le départ derrière leurs falaises (frisson soulslike, comme le château au centre de Zelda).
- **Toute la carte est présente dès la v0.3.0** (relief, rivières, horizon, Arbre-Brume visibles de partout), **mais les régions pas encore terminées sont gardées par la Brume** :
  - en avançant dans une région fermée, un brouillard surnaturel s'épaissit progressivement jusqu'à ne plus rien voir (le son s'étouffe, la minicarte se brouille) ;
  - passé un seuil, le joueur est **désorienté puis ramené doucement vers la sortie** (fondu, il se retrouve tourné vers la lisière d'où il vient), comme s'il s'était perdu : **la Brume repousse les intrus** ;
  - aucun mur invisible, aucun message technique : c'est un élément du monde (des PNJ en parlent : « la Brume ne laisse passer personne vers le nord… pour l'instant ») ;
  - quand une région ouvre dans une mise à jour, sa Brume se lève (événement annoncé).
- **Deux zones rouges dès la v0.3.0** : la Mer de Dunes et le Cœur d'Aldmar.
- **Cycle jour/nuit d'environ 48 min** validé (avec les secrets liés à l'heure).
- Moteur : les données du monde restent indépendantes du moteur (client Unreal possible plus tard).
