# Arbre des Brumes : région du Rôdeur et passerelle du Chasseur (brouillon v0.3)

> Brouillon du concepteur de l'arbre du Rôdeur, à fusionner dans `docs/design/ARBRE_COMPETENCES.md`.
> Les données complètes (compétences, nœuds, coordonnées, liens, effets chiffrés) sont dans `tree_ranger.json`, **généré à partir de la même source que les tableaux ci-dessous**.
> Base de travail : `shared/data.js` et `shared/combat.js` de la branche `wave1/combat-souls`, ainsi que `docs/EQUILIBRAGE.md` (endurance 100, régénération 35/s, roulade 30 d'endurance et 0,35 s d'invulnérabilité, tir automatique seulement à ≤ 40 % de la vitesse, poise).

## 1. Intention

Le retour des joueurs sur la v0.1 est clair : le rôdeur était **trop fort parce qu'il pouvait reculer en tirant sans rien risquer**. La v0.2 a déjà ajouté l'endurance, l'engagement après chaque tir et le tir seulement en marchant lentement. L'arbre ne doit rien rendre de tout ça. Il doit plutôt donner au rôdeur **d'autres façons de gagner que la fuite** :

1. **Se placer plutôt que fuir.** Les meilleurs tirs demandent d'être immobile (Trait fatal, Posture de l'archer), ou proche (Tir à bout portant, Au plus près), ou de viser juste dans une fenêtre précise (Flèche d'arrêt pendant une préparation, Perce-cœur sur une cible déséquilibrée).
2. **Répondre aux télégraphes.** Le Rôdeur est la classe qui *interrompt* : Flèche assommante (55 de poise), Flèche d'arrêt (annule une attaque télégraphiée), Filet (brise une charge en ligne), Piège (immobilise avant l'arrivée), Instinct du traqueur (voit les zones 0,15 s plus tôt).
3. **Des options au corps à corps.** Le couteau de ceinture (Coup de dague, Entaille venimeuse, Garde du couteau) est toujours là, même avec un arc. La clé de voûte « Au plus près » en fait un vrai style de jeu.
4. **Des fuites qui coûtent.** Le Bond de retrait est le seul recul outillé : 28 d'endurance, 8 de mana, 10 s de recharge, 0,15 s d'invulnérabilité seulement, et interdit juste après une roulade. Aucun nœud ne donne d'invulnérabilité durable, d'endurance infinie ni de tir en courant.

## 2. Rappel des règles communes (appliquées ici)

- Niveau max 30. 1 point par niveau à partir du niveau 2, plus 1 point bonus tous les 5 niveaux : **5 points au niveau 5, 17 au niveau 15, 35 au niveau 30**.
- Le Rôdeur commence sur **Éveil du Rôdeur** (`rodeur_origine`), gratuit, qui donne **Tir**. Ses voisins ne s'ouvrent qu'après **3 Fondamentaux** (Roulade, Sprint, Saut, Garde, Attaque chargée).
- **Coûts.** Pour un Rôdeur, tout coûte 1 point ici. Pour un Guerrier, la passerelle Chasseur coûte 1 point, la région Rôdeur 2 points et ses clés de voûte 3 points. Pour un Mage, la région Rôdeur coûte 2 points et les clés de voûte 3. La passerelle Chasseur n'est pas voisine du Mage, donc elle lui coûte 2 points.
- **Inaptitude** sur les compétences d'une autre classe : −25 % de puissance, +25 % de coût, +20 % de recharge. Les compétences de la passerelle Chasseur sont **hybrides** : pas d'Inaptitude pour le Rôdeur ni pour le Guerrier, mais une Inaptitude pour le Mage. « Frère d'armes » (sur la passerelle) réduit l'Inaptitude croisée Rôdeur ↔ Guerrier de 25 % à 10 %, pour les compétences qu'il couvre.
- **Armes requises par étiquette.** `arc` : un arc ou une arbalète. `dague` : le couteau de ceinture, utilisable avec un arc (dégâts de l'arme ×0,8) ou avec une arme de mêlée à une main. Les compétences `mêlée` / `lance` demandent une arme de mêlée. Pièges, filets, fioles, cor, marque et javelot de chasse : aucune arme requise.
- **Ultimes et clés de voûte** : il faut un nombre minimum de points dépensés dans la région (`reqPoints` dans le JSON). Sinon, un ultime serait accessible dès 7 points.

## 3. Disposition (repère global)

- Coordonnées **écran** : x vers la droite, **y vers le bas**. `x = r·cos θ`, `y = −r·sin θ`, donc 90° est en haut (Guerrier), 210° en bas à gauche (Mage) et 330° en bas à droite (Rôdeur). Chaque nœud a aussi `polar: { r, deg }` dans le JSON.
- **Départ** `rodeur_origine` en (433, 250), soit r = 500 et θ = 330°. Les deux variantes de forme du Tir sont juste à côté (r = 540).
- **Trois branches** en éventail de r = 620 à r = 1480 :
  - **Venin** entre 297° et 319°, côté Mage : son nœud d'accroche `v_cueilleur` (r = 900, 299°) est relié à la passerelle Arcaniste sylvestre (≈ 270°).
  - **Tireur** entre 320° et 341°, au centre.
  - **Traqueur** entre 343° et 366° (soit 6°), côté Guerrier : son nœud `q_acrobate` ouvre la passerelle Chasseur.
- **Passerelle Chasseur** (`pont_rg`) entre 15° et 40°, de r = 790 à r = 1225. Elle entre par `c_instinct_chasseur` (relié à `q_acrobate`) et touche le Guerrier par `c_depeceur` (r = 900, 40°), à relier au nœud Guerrier le plus proche.
- Distance minimale entre deux nœuds : 78 unités (vérifiée par le script). Une variante est toujours une **feuille** : on ne passe jamais par une variante exclusive pour avancer.
- Liens externes, notés `survie:*`, `pont_mr:*` et `guerrier:*` dans le JSON : c'est au synthétiseur de les résoudre (voir `meta.externalLinks`).

```
                      (Guerrier 90°)
                            │
             passerelle Chasseur 15°–40°
                     ╲
   Survie ── Éveil ──┬── Traqueur (343°–366°) ──► Hallali, Fantôme des brumes
      (r<400)  (r500)├── Tireur   (320°–341°) ──► Trait fatal, Posture de l'archer
                     └── Venin    (297°–319°) ──► Fléau, Vénéneux
                             ╲
                  passerelle Arcaniste sylvestre (≈270°, conçue côté Mage)
```

## 4. Vue d'ensemble

| Zone | Nœuds | Compétences | Variantes | Passifs | Clés de voûte |
|---|---:|---:|---:|---:|---:|
| Départ | 3 | 1 (Tir) | 2 | 0 | 0 |
| Tireur | 24 | 5 | 11 (dont Tir ricochet) | 7 | 1 |
| Traqueur | 26 | 6 | 13 (dont Tir à bout portant) | 4 | 3 |
| Venin | 24 | 5 | 11 (dont Pointes enduites) | 6 | 2 |
| **Région Rôdeur** | **77** | **17** | **37** | **17** | **6** |
| Passerelle Chasseur | 14 | 3 | 6 | 4 | 1 |

**Toutes les compétences ont au moins un groupe de variantes exclusives**, y compris l'attaque de base. Le **Tir** en a même deux :
- `var_tir_forme`, près du départ : **Tir lesté** ou **Tir véloce** ;
- `var_tir_approche`, un nœud dans chaque branche : **Tir ricochet** (Tireur), **Tir à bout portant** (Traqueur) ou **Pointes enduites** (Venin).

Les variantes de la **roulade** sont dans l'anneau Survie : pas de doublon ici. Les nœuds Rôdeur qui touchent aux Fondamentaux sont **Acrobate** (Saut), **Garde du couteau** (Garde et parade), **Sang-froid** (Attaque chargée), **Pied léger** (Sprint) et **Fantôme des brumes** (esquive parfaite).

Les quatre compétences v0.2 du rôdeur existent toutes : **Tir** au départ, **Tir perçant** et **Tir rapide** à 2 points, **Pluie de flèches** à 4 points.

## 5. Départ : l'attaque de base « Tir »

Le Tir se **charge** grâce au Fondamental « Attaque chargée » : on maintient la touche pour bander l'arc. La **forme** du Tir se choisit tout de suite (Tir lesté ou Tir véloce), et son **approche** plus loin, dans l'une des trois branches.

| Compétence (id) | Type | Mana | End. | Rech. | Portée / rayon | Puissance | Poise | Engagement | Étiquettes | Arme |
|---|---|---:|---:|---:|---|---|---:|---|---|---|
| **Tir** (`shot`) | projectile | 0 | 7 | 1,3 s | 20 m | ×0,85 | 3 | récup. 0,35 s à 30 % | physique, projectile, arc | arc / arbalète |

- **Tir** — Tir à l'arc de base. *Soulslike :* Attaque de base. Ne part qu'en se déplaçant à ≤ 40 % de sa vitesse (COMMIT.rangedMoveMax). Chargée (Fondamental « Attaque chargée ») : on bande l'arc 0,4 à 1 s en marchant à 25 %, ×1,6 → ×2,4, 18 de poise, perce 1 ennemi à pleine charge.

| Nœud (id) | Type | Rangs | Effet | Groupe exclusif | x, y | Liens | Pts min. |
|---|---|---:|---|---|---|---|---:|
| **Éveil du Rôdeur** (`rodeur_origine`) | Compétence | 1 | Nœud de départ du Rôdeur (gratuit) : donne l'attaque de base Tir. Les nœuds voisins s'ouvrent après 3 Fondamentaux. |  | 433, 250 | `survie:*porte_rodeur` | 0 |
| **Tir lesté** (`tir_leste`) | Variante | 1 | Tir : ×0,85 → ×1,1, poise 3 → 8, recharge 1,3 → 1,6 s, récupération 0,35 → 0,45 s. | var_tir_forme | 401, 361 | `rodeur_origine` | 1 |
| **Tir véloce** (`tir_veloce`) | Variante | 1 | Tir : ×0,85 → ×0,68, recharge 1,3 → 1,0 s, endurance 7 → 6. La règle de tir à ≤ 40 % de vitesse est inchangée. | var_tir_forme | 514, 167 | `rodeur_origine` | 1 |

Intention visuelle des variantes (pour les effets) :

- *Tir lesté* : Flèche plus épaisse à empennage noir ; impact avec petite gerbe de poussière et léger recul de la cible.
- *Tir véloce* : Flèche fine, traînée d'air pâle très courte ; corde qui vibre plus vite (animation Attack accélérée ×1,3).

## 6. Branche Tireur : tirs chargés, perforation, critiques

Le Tireur gagne **en restant sur place au bon moment**. Il perce les armures, interrompt les attaques télégraphiées d'une flèche et achève les cibles déséquilibrées d'un Trait fatal. Sa clé de voûte le récompense quand il est immobile et le punit quand il roule.

| Compétence (id) | Type | Mana | End. | Rech. | Portée / rayon | Puissance | Poise | Engagement | Étiquettes | Arme |
|---|---|---:|---:|---:|---|---|---:|---|---|---|
| **Tir perçant** (`piercing_shot`) | projectile | 12 | 14 | 6 s | 22 m | ×1,9 | 14 | prép. 0,25 s · récup. 0,55 s à 25 % | physique, projectile, arc, perforation | arc / arbalète |
| **Tir rapide** (`rapid_fire`) | channel | 15 | 14 | 9 s | 20 m | ×0,8 ×3 coups | 3 | canal. 0,6 s · récup. 0,6 s à 30 % | physique, projectile, arc | arc / arbalète |
| **Pluie de flèches** (`arrow_rain`) | aoe_target | 22 | 16 | 12 s | 20 m · r 5 m | ×1,25 | 8 | récup. 0,5 s à 30 % | physique, zone, arc | arc / arbalète |
| **Flèche assommante** (`fleche_assommante`) | projectile | 10 | 18 | 10 s | 18 m | ×1,1 | 55 | prép. 0,45 s · récup. 0,6 s à 25 % | physique, projectile, arc, contrôle | arc / arbalète |
| **Trait fatal** (`trait_fatal`) | channel | 35 | 25 | 40 s | 32 m | ×5,0 | 70 | canal. 1,5 s · récup. 0,8 s à 20 % | physique, projectile, arc, perforation | arc / arbalète |

- **Tir perçant** — Une flèche lourde qui ignore 30 % de l'armure et transperce un premier ennemi. *Soulslike :* Compétence v0.2 conservée. 0,25 s de visée visible, puis 0,55 s de relâchement : à lancer pendant la récupération d'un monstre, pas pendant sa préparation.
- **Tir rapide** — Trois flèches en succession rapide. *Soulslike :* Compétence v0.2 conservée. Canalisée 0,6 s (marche à 30 %) : une roulade l'interrompt (les flèches restantes sont perdues, pas le coût).
- **Pluie de flèches** — Une pluie de flèches sur la zone ciblée. *Soulslike :* Compétence v0.2 conservée. Les flèches tombent 0,6 s après le tir (cercle visible au sol pour tous) : récompense l'anticipation de la position d'un monstre.
- **Flèche assommante** — Une flèche à tête ronde qui déséquilibre ; +50 % de poise si elle touche un ennemi en pleine préparation d'attaque. *Soulslike :* Réponse aux télégraphes : 55 de poise déséquilibre en un coup loups (24), gobelins (28) et squelettes (44) ; pas le golem (150). 0,45 s de visée : il faut tirer dès le début de la préparation.
- **Trait fatal** — Vous visez 1,5 s, immobile, puis décochez un trait qui traverse tout sur 32 m. *Soulslike :* Ultime du Tireur. Immobile pendant la visée : une roulade l'annule et rend 50 % de la mana. Pensé pour la fenêtre de récupération d'un boss (golem : 0,9 s de récupération après son coup au sol « golem_slam »), jamais pour le kiting.

| Nœud (id) | Type | Rangs | Effet | Groupe exclusif | x, y | Liens | Pts min. |
|---|---|---:|---|---|---|---|---:|
| **Main sûre** (`t_main_sure`) | Passif | 3 | +4 % de dégâts des compétences d'arc par rang. |  | 537, 310 | `rodeur_origine` | 1 |
| **Tir perçant** (`t_tir_percant`) | Compétence | 1 | Une flèche lourde qui ignore 30 % de l'armure et transperce un premier ennemi. |  | 582, 423 | `t_main_sure` | 2 |
| **Trait de brèche** (`t_trait_breche`) | Variante | 1 | Tir perçant : ne transperce plus, mais la cible perd 25 % de défense pendant 5 s (boss 15 %). | var_tir_percant | 630, 493 | `t_tir_percant` | 3 |
| **Tir traversant** (`t_tir_traversant`) | Variante | 1 | Tir perçant : traverse TOUS les ennemis en ligne sur 26 m (−10 % de dégâts par ennemi traversé). | var_tir_percant | 678, 424 | `t_tir_percant` | 3 |
| **Tir rapide** (`t_tir_rapide`) | Compétence | 1 | Trois flèches en succession rapide. |  | 658, 293 | `t_main_sure` | 2 |
| **Salve en éventail** (`t_salve_eventail`) | Variante | 1 | Tir rapide : les 3 flèches partent ensemble en éventail de 30° (×0,7 chacune, 6 de poise chacune), sans canalisation. | var_tir_rapide | 719, 351 | `t_tir_rapide` | 3 |
| **Rafale soutenue** (`t_rafale`) | Variante | 1 | Tir rapide : 5 flèches sur 1 s (×0,6 chacune), marche à 20 % pendant la rafale, mana 15 → 20. | var_tir_rapide | 752, 274 | `t_tir_rapide` | 3 |
| **Œil exercé** (`t_oeil_exerce`) | Passif | 3 | +2 % de chances de coup critique par rang. |  | 779, 450 | `t_tir_percant`, `t_tir_rapide` | 3 |
| **Pluie de flèches** (`t_pluie`) | Compétence | 1 | Une pluie de flèches sur la zone ciblée. |  | 801, 582 | `t_oeil_exerce` | 4 |
| **Averse d'acier** (`t_averse_acier`) | Variante | 1 | Pluie de flèches : rayon 5 → 3 m, ×1,25 → ×1,9, poise 8 → 28. | var_pluie | 839, 680 | `t_pluie` | 5 |
| **Pluie persistante** (`t_pluie_persistante`) | Variante | 1 | Pluie de flèches : dure 3 s (4 vagues ×0,45), rayon 5,5 m, ralentit de 30 % tant qu'on reste dedans. | var_pluie | 906, 588 | `t_pluie` | 5 |
| **Flèche assommante** (`t_fleche_assommante`) | Compétence | 1 | Une flèche à tête ronde qui déséquilibre ; +50 % de poise si elle touche un ennemi en pleine préparation d'attaque. |  | 904, 403 | `t_oeil_exerce` | 4 |
| **Flèche fracassante** (`t_fracassante`) | Variante | 1 | Flèche assommante : poise 55 → 80, ×1,1 → ×1,4, recharge 10 → 14 s. | var_assommante | 954, 507 | `t_fleche_assommante` | 5 |
| **Flèche d'arrêt** (`t_fleche_arret`) | Variante | 1 | Flèche assommante : si elle touche pendant une préparation télégraphiée, l'attaque est annulée net (hors boss : +100 % de poise au lieu de +50 %). Poise de base 55 → 40. | var_assommante | 1001, 405 | `t_fleche_assommante` | 5 |
| **Tir tendu** (`t_tir_tendu`) | Passif | 2 | +8 % de vitesse des projectiles et +1 m de portée des tirs à l'arc par rang. |  | 1013, 585 | `t_pluie`, `t_fleche_assommante` | 5 |
| **Tir ricochet** (`t_tir_ricochet`) | Variante | 1 | Tir : la flèche rebondit sur 1 ennemi à moins de 6 m (×0,5). Exclusif avec « Pointes enduites » et « Tir à bout portant ». | var_tir_approche | 926, 723 | `t_tir_tendu` | 6 |
| **Sang-froid** (`t_sang_froid`) | Passif | 1 | Tir chargé (Attaque chargée) : charge 25 % plus rapide, et la pleine charge perce 2 ennemis au lieu d'1. |  | 1089, 440 | `t_tir_tendu` | 6 |
| **Carquois profond** (`t_carquois_profond`) | Passif | 2 | +8 mana max et −6 % de coût en mana des compétences d'arc par rang. |  | 1010, 761 | `t_tir_tendu` | 6 |
| **Trait fatal** (`t_trait_fatal`) | Compétence | 1 | Vous visez 1,5 s, immobile, puis décochez un trait qui traverse tout sur 32 m. (Demande 10 points dépensés dans la région Rôdeur.) |  | 1111, 616 | `t_tir_tendu` | 6 |
| **Visée éclair** (`t_visee_eclair`) | Variante | 1 | Trait fatal : visée 1,5 → 0,9 s, ×5,0 → ×3,6. | var_trait_fatal | 1233, 575 | `t_trait_fatal` | 7 |
| **Perce-cœur** (`t_perce_coeur`) | Variante | 1 | Trait fatal : contre une cible déséquilibrée, ×1,6 et critique garanti ; visée 1,5 → 1,7 s. | var_trait_fatal | 1153, 721 | `t_trait_fatal` | 7 |
| **Point faible** (`t_point_faible`) | Passif | 2 | +12 % de dégâts critiques par rang. |  | 1193, 434 | `t_sang_froid` | 7 |
| **Tir de maître** (`t_tir_de_maitre`) | Passif | 1 | +10 % de dégâts contre les élites et les boss. |  | 1049, 881 | `t_carquois_profond` | 7 |
| **Posture de l'archer** (`t_posture_archer`) | Clé de voûte | 1 | Après 0,6 s sans bouger : +30 % de chances de critique et Tir chargé / Trait fatal se chargent 30 % plus vite. (Demande 12 points dépensés dans la région Rôdeur.) **Contrepartie :** Bouger annule la posture, et vos roulades coûtent +10 d'endurance. |  | 1281, 710 | `t_trait_fatal` | 7 |

Intention visuelle des variantes (pour les effets) :

- *Trait de brèche* : Pointe dentelée noire ; à l'impact, éclats de métal et une fissure lumineuse orangée sur l'armure de la cible pendant 5 s.
- *Tir traversant* : Longue traînée blanche rectiligne qui persiste 0,4 s, anneau de choc à chaque ennemi traversé.
- *Salve en éventail* : Trois flèches simultanées, trois traînées fines qui s'écartent ; l'arc est tenu à l'horizontale.
- *Rafale soutenue* : Rafale : petites étincelles sur la corde à chaque flèche, douilles de plumes qui tombent au sol.
- *Averse d'acier* : Colonne serrée de flèches d'acier qui s'abattent d'un coup ; cratère de poussière et éclats.
- *Pluie persistante* : Flèches qui restent plantées dans le sol en hérissant la zone ; vagues successives en pluie fine.
- *Flèche fracassante* : Tête de pierre qui éclate à l'impact en fragments ; onde sourde et la cible recule d'un pas.
- *Flèche d'arrêt* : Flèche à tête de fer en croissant ; à l'annulation, la zone télégraphiée rouge se brise en éclats de verre.
- *Tir ricochet* : Étincelle blanche au premier impact puis arc de lumière vers la seconde cible.
- *Visée éclair* : Viseur réduit, flèche qui s'embrase de blanc très vite ; traînée courte et sèche.
- *Perce-cœur* : Pendant la visée, un cœur rouge pulse sur la cible ; à l'impact, gerbe rouge sombre et ralenti de 0,1 s.

## 7. Branche Traqueur : mobilité, pièges, marques, dague

Le Traqueur **choisit sa proie** (Marque), **prépare le terrain** (pièges et filets) et **se bat de près** avec le couteau. Sa mobilité coûte cher et ne remplace jamais la roulade. Ses clés de voûte : Au plus près (rôdeur de mêlée), Proie unique (duel) et Fantôme des brumes (esquive parfaite).

| Compétence (id) | Type | Mana | End. | Rech. | Portée / rayon | Puissance | Poise | Engagement | Étiquettes | Arme |
|---|---|---:|---:|---:|---|---|---:|---|---|---|
| **Coup de dague** (`coup_de_dague`) | melee | 0 | 12 | 4 s | 2,4 m | ×0,7 + ×0,9 | 14 | prép. 0,15 s · récup. 0,3 s à 50 % | physique, mêlée, dague | couteau (arc) ou mêlée 1 main |
| **Marque du chasseur** (`marque_de_chasse`) | debuff | 10 | 0 | 12 s | 25 m | — | 0 | récup. 0,2 s à 60 % | marque, chasse | — |
| **Bond de retrait** (`bond_de_retrait`) | dash | 8 | 28 | 10 s | 6 m | ×0,6 | 3 | récup. 0,35 s à 40 % | mobilité, arc, projectile | arc / arbalète |
| **Piège à mâchoires** (`piege_a_machoires`) | trap | 12 | 10 | 14 s | 3 m · r 1,2 m | ×1,5 | 30 | récup. 0,5 s à 0 % | physique, piège, contrôle | — |
| **Filet lesté** (`filet`) | projectile | 14 | 12 | 16 s | 12 m | ×0,3 | 10 | prép. 0,3 s · récup. 0,45 s à 30 % | contrôle, projectile, chasse | — |
| **Hallali** (`hallali`) | buff | 25 | 0 | 60 s | — | — | 0 | prép. 0,3 s · récup. 0,4 s à 50 % | buff, chasse, marque | — |

- **Coup de dague** — Deux coups de couteau rapides ; votre prochain Tir dans les 2 s inflige +20 % de dégâts. *Soulslike :* L'option de mêlée du rôdeur : rapide (0,15 s) mais courte (2,4 m). Le couteau de ceinture est toujours là : utilisable avec un arc (dégâts de l'arme ×0,8) ou avec n'importe quelle arme de mêlée à une main.
- **Marque du chasseur** — Marque une cible 15 s : elle subit +10 % de vos dégâts et reste visible à travers la brume. Une seule marque à la fois. *Soulslike :* Instantanée, sans arme requise. En JcJ : +5 %. Plusieurs nœuds du Traqueur et du Chasseur s'appuient sur la cible marquée.
- **Bond de retrait** — Un bond de 6 m en arrière, puis un Tir à ×0,6 en retombant. *Soulslike :* Le seul recul « outillé » du rôdeur, et il coûte cher : 28 d'endurance + 8 de mana, 10 s de recharge, seulement 0,15 s d'invulnérabilité (contre 0,35 s pour la roulade). Impossible dans les 0,5 s qui suivent une roulade (pas de double fuite).
- **Piège à mâchoires** — Pose un piège (armé en 1 s) qui mord le premier ennemi : ×1,5 et immobilisé 2 s (élites 1 s, boss : ralentis de 40 %). *Soulslike :* On s'agenouille 0,5 s pour le poser (immobile) : il se pose AVANT le combat ou derrière soi, jamais sous un monstre en pleine attaque. 2 pièges maximum. JcJ : immobilisation 1 s.
- **Filet lesté** — Lance un filet qui ralentit de 60 % pendant 3 s ; il brise net la charge d'un ennemi qui s'élance. *Soulslike :* Contre-télégraphe : touché pendant la préparation d'une charge en ligne (loup, sanglier, troll), l'attaque est annulée et le monstre déséquilibré (sauf boss). Portée courte (12 m) : il faut laisser venir.
- **Hallali** — Sonne l'hallali 10 s : +20 % de dégâts contre la cible marquée, roulades −30 % d'endurance, chaque coup sur la proie rend 3 d'endurance. *Soulslike :* Ultime du Traqueur : une fenêtre d'agression, pas d'invulnérabilité. Le cor se sonne (0,3 s) : à placer pendant la récupération d'un boss.

| Nœud (id) | Type | Rangs | Effet | Groupe exclusif | x, y | Liens | Pts min. |
|---|---|---:|---|---|---|---|---:|
| **Pied léger** (`q_pied_leger`) | Passif | 2 | +3 % de vitesse de déplacement et −5 % d'endurance dépensée en sprint par rang. |  | 606, 129 | `rodeur_origine` | 1 |
| **Marque du chasseur** (`q_marque`) | Compétence | 1 | Marque une cible 15 s : elle subit +10 % de vos dégâts et reste visible à travers la brume. Une seule marque à la fois. |  | 692, 198 | `q_pied_leger` | 2 |
| **Marque de sang** (`q_marque_sang`) | Variante | 1 | Marque du chasseur : bonus +10 % → +6 %, mais la cible marquée accumule +30 % de saignement. | var_marque | 781, 195 | `q_marque` | 3 |
| **Marque de la meute** (`q_marque_meute`) | Variante | 1 | Marque du chasseur : les +10 % s'appliquent aussi aux dégâts de vos alliés ; durée 15 → 10 s. | var_marque | 797, 112 | `q_marque` | 3 |
| **Coup de dague** (`q_coup_de_dague`) | Compétence | 1 | Deux coups de couteau rapides ; votre prochain Tir dans les 2 s inflige +20 % de dégâts. |  | 698, 49 | `q_pied_leger` | 2 |
| **Dague saignante** (`q_dague_saignante`) | Variante | 1 | Coup de dague : chaque coup ajoute 20 de saignement ; dégâts ×0,7+×0,9 → ×0,6+×0,8. | var_dague | 785, 14 | `q_coup_de_dague` | 3 |
| **Riposte au couteau** (`q_riposte_couteau`) | Variante | 1 | Coup de dague : dans les 0,4 s après une roulade réussie (esquive d'un coup) ou une Garde, critique garanti et +20 de poise. | var_dague | 781, -82 | `q_coup_de_dague` | 3 |
| **Tir à bout portant** (`q_bout_portant`) | Variante | 1 | Tir : +45 % de dégâts à moins de 6 m, −20 % au-delà de 12 m. Exclusif avec « Tir ricochet » et « Pointes enduites ». | var_tir_approche | 879, -46 | `q_coup_de_dague` | 3 |
| **Acrobate** (`q_acrobate`) | Passif | 1 | Saut : +0,1 s en l'air ; un Tir pendant le saut décoche 2 flèches à ×0,6 (tir aérien), suivi de 0,3 s de réception. |  | 886, 125 | `q_marque`, `q_coup_de_dague` | 3 |
| **Bond de retrait** (`q_bond_retrait`) | Compétence | 1 | Un bond de 6 m en arrière, puis un Tir à ×0,6 en retombant. |  | 940, 217 | `q_acrobate` | 4 |
| **Salto tireur** (`q_salto_tireur`) | Variante | 1 | Bond de retrait : le tir final devient un Tir chargé complet (×1,6, 18 de poise) ; endurance 28 → 34. | var_bond | 1014, 291 | `q_bond_retrait` | 5 |
| **Bond latéral** (`q_bond_lateral`) | Variante | 1 | Bond de retrait : dans n'importe quelle direction, 5 m, plus de tir ; recharge 10 → 8 s. | var_bond | 1039, 183 | `q_bond_retrait` | 5 |
| **Piège à mâchoires** (`q_piege`) | Compétence | 1 | Pose un piège (armé en 1 s) qui mord le premier ennemi : ×1,5 et immobilisé 2 s (élites 1 s, boss : ralentis de 40 %). |  | 964, 34 | `q_acrobate` | 4 |
| **Piège de ronces** (`q_piege_ronces`) | Variante | 1 | Piège : n'immobilise plus ; zone de 3 m qui ralentit de 50 % pendant 4 s et ajoute 10 de saignement par seconde. | var_piege | 1054, 55 | `q_piege` | 5 |
| **Piège à poudre** (`q_piege_explosif`) | Variante | 1 | Piège : explose sur 3 m (×2,2, 45 de poise), sans immobilisation. | var_piege | 1052, -74 | `q_piege` | 5 |
| **Garde du couteau** (`q_garde_couteau`) | Passif | 1 | Garde avec un arc en main : le couteau de ceinture pare, −20 % d'endurance par coup bloqué ; une parade parfaite (si apprise) enchaîne un Coup de dague à ×2,5. |  | 1139, 120 | `q_bond_retrait`, `q_piege` | 5 |
| **Au plus près** (`q_au_plus_pres`) | Clé de voûte | 1 | À moins de 3 m, votre Tir devient automatiquement un enchaînement de 2 coups de dague (×0,8 + ×1,0, 12 de poise) et vos compétences « dague » font +30 % de dégâts. (Demande 8 points dépensés dans la région Rôdeur.) **Contrepartie :** Vos compétences d'arc infligent −15 % de dégâts. |  | 1146, -100 | `q_garde_couteau` | 6 |
| **Filet lesté** (`q_filet`) | Compétence | 1 | Lance un filet qui ralentit de 60 % pendant 3 s ; il brise net la charge d'un ennemi qui s'élance. |  | 1212, 236 | `q_garde_couteau` | 6 |
| **Filet d'acier** (`q_filet_acier`) | Variante | 1 | Filet lesté : immobilise 1,5 s au lieu de ralentir (boss : ralentit seulement), recharge 16 → 22 s. | var_filet | 1274, 365 | `q_filet` | 7 |
| **Filet collant** (`q_filet_collant`) | Variante | 1 | Filet lesté : se déploie au sol en zone de 3 m pendant 5 s, ralentit de 50 % tout ce qui y entre. | var_filet | 1309, 207 | `q_filet` | 7 |
| **Instinct du traqueur** (`q_instinct`) | Passif | 1 | La zone télégraphiée des attaques de votre cible marquée apparaît 0,15 s plus tôt. |  | 1235, 22 | `q_garde_couteau` | 6 |
| **Proie unique** (`q_proie_unique`) | Clé de voûte | 1 | Votre Marque ne s'efface plus avant la mort de la cible et son bonus passe à +24 %. (Demande 12 points dépensés dans la région Rôdeur.) **Contrepartie :** −15 % de dégâts contre tout ce qui n'est pas marqué ; changer de proie coûte 30 s de recharge à la Marque. |  | 1339, 409 | `q_filet` | 7 |
| **Hallali** (`q_hallali`) | Compétence | 1 | Sonne l'hallali 10 s : +20 % de dégâts contre la cible marquée, roulades −30 % d'endurance, chaque coup sur la proie rend 3 d'endurance. (Demande 10 points dépensés dans la région Rôdeur.) |  | 1365, 119 | `q_filet`, `q_instinct` | 7 |
| **Hallali sanglant** (`q_hallali_sanglant`) | Variante | 1 | Hallali : +30 % d'accumulation de saignement pendant l'effet ; durée 10 → 8 s. | var_hallali | 1423, 303 | `q_hallali` | 8 |
| **Hallali de meute** (`q_hallali_meute`) | Variante | 1 | Hallali : les alliés à 15 m reçoivent la moitié des effets. | var_hallali | 1455, 0 | `q_hallali` | 8 |
| **Fantôme des brumes** (`q_fantome_brumes`) | Clé de voûte | 1 | Une roulade qui évite un coup (esquive parfaite) vous rend invisible 1,5 s : les monstres perdent votre trace (JcJ : 0,8 s, silhouette visible à 5 m). Recharge interne 8 s. (Demande 14 points dépensés dans la région Rôdeur.) **Contrepartie :** −15 % de PV max. |  | 1472, 155 | `q_hallali` | 8 |

Intention visuelle des variantes (pour les effets) :

- *Marque de sang* : Marque en forme de griffe rouge sang qui goutte au-dessus de la cible.
- *Marque de la meute* : Marque dorée en tête de loup, visible par tout le groupe, avec un halo au sol autour de la cible.
- *Dague saignante* : Lame qui laisse une traînée rouge sombre ; gouttes de sang stylisées à l'impact.
- *Riposte au couteau* : Éclair blanc sur la lame et bref ralenti visuel (0,08 s) quand la riposte est déclenchée.
- *Tir à bout portant* : À courte distance, bouffée de poussière au départ et impact plus lourd, flèche à peine visible.
- *Salto tireur* : Salto arrière complet, l'arc bandé à l'envers ; flèche chargée qui laisse une traînée brillante.
- *Bond latéral* : Glissade basse avec traînée de feuilles mortes et de brume au ras du sol.
- *Piège de ronces* : Ronces noires qui jaillissent du sol en cercle et s'enroulent autour des jambes.
- *Piège à poudre* : Petit baril de poudre noire ; explosion orangée courte avec fumée grise et éclats de bois.
- *Filet d'acier* : Mailles métalliques qui scintillent ; la cible est plaquée au sol, poids aux coins du filet.
- *Filet collant* : Toile de corde enduite de résine luisante étalée au sol, fils qui s'étirent sous les pas.
- *Hallali sanglant* : Cor en corne noire ; halo rouge autour des armes du rôdeur pendant l'effet.
- *Hallali de meute* : Onde sonore dorée qui s'étend en anneau ; petite icône de cor au-dessus des alliés touchés.

## 8. Branche Venin : poisons, saignements, nuages toxiques

Le Venin **gagne dans la durée**. Ses poisons ne déséquilibrent pas, il faut donc esquiver en attendant qu'ils fassent effet. Les saignements récompensent l'agression continue, puisque la jauge redescend si on s'arrête. Il contrôle les groupes avec ses nuages. Sa branche touche la passerelle Arcaniste sylvestre et l'artisanat (Cueilleur de brume).

| Compétence (id) | Type | Mana | End. | Rech. | Portée / rayon | Puissance | Poise | Engagement | Étiquettes | Arme |
|---|---|---:|---:|---:|---|---|---:|---|---|---|
| **Flèche empoisonnée** (`fleche_empoisonnee`) | projectile | 10 | 10 | 5 s | 20 m | ×0,6 | 3 | prép. 0,15 s · récup. 0,4 s à 30 % | poison, projectile, arc | arc / arbalète |
| **Flèche barbelée** (`fleche_barbelee`) | projectile | 12 | 12 | 7 s | 20 m | ×1,0 | 8 | prép. 0,2 s · récup. 0,45 s à 30 % | saignement, projectile, arc | arc / arbalète |
| **Nuage toxique** (`nuage_toxique`) | aoe_target | 24 | 14 | 18 s | 16 m · r 4 m | — | 0 | récup. 0,55 s à 30 % | poison, zone | — |
| **Entaille venimeuse** (`entaille_venimeuse`) | melee | 8 | 16 | 8 s | 2,6 m | ×1,1 | 12 | prép. 0,2 s · récup. 0,35 s à 40 % | poison, saignement, mêlée, dague | couteau (arc) ou mêlée 1 main |
| **Fléau** (`fleau`) | aoe_self | 30 | 10 | 35 s | r 12 m | — | 20 | prép. 0,4 s · récup. 0,6 s à 30 % | poison, saignement, zone | — |

- **Flèche empoisonnée** — Une flèche qui ajoute une charge de poison (×0,25 par seconde pendant 6 s, jusqu'à 3 charges). *Soulslike :* Dégâts dans la durée : laisse le temps d'esquiver au lieu de tirer. Les dégâts de poison n'infligent pas de poise.
- **Flèche barbelée** — Ajoute 35 de saignement. À 100, la plaie éclate : ×1,5 + 6 % des PV max (boss 2 %, joueurs 4 %). *Soulslike :* Saignement façon soulslike : une jauge sous la barre de vie qui se vide de 10/s après 3 s sans nouvelle entaille. Récompense l'agression continue.
- **Nuage toxique** — Une fiole qui éclate en nuage de 4 m pendant 6 s : 1 charge de poison par seconde, et les ennemis dedans infligent −10 % de dégâts. *Soulslike :* Zone de contrôle, pas de dégâts directs. La fiole est lancée à la main : pas d'arc requis. Aucun dégât aux alliés.
- **Entaille venimeuse** — Un revers de dague en arc (×1,1) : 2 charges de poison, 20 de saignement, puis un petit saut de 2 m en arrière. *Soulslike :* Le petit saut n'a PAS d'invulnérabilité : il sort de l'allonge d'un coup léger, pas d'une attaque télégraphiée.
- **Fléau** — Tous vos poisons dans un rayon de 12 m éclatent : 150 % des dégâts restants tout de suite, +50 de saignement, et 1 charge se propage à 4 m. *Soulslike :* Ultime du Venin : 0,4 s de geste visible, puis 0,6 s de récupération. Ne fait rien sans préparation (poisons déjà posés).

| Nœud (id) | Type | Rangs | Effet | Groupe exclusif | x, y | Liens | Pts min. |
|---|---|---:|---|---|---|---|---:|
| **Herboriste** (`v_herboriste`) | Passif | 2 | +5 % de dégâts de poison et de saignement par rang. |  | 415, 461 | `rodeur_origine` | 1 |
| **Flèche empoisonnée** (`v_fleche_empoisonnee`) | Compétence | 1 | Une flèche qui ajoute une charge de poison (×0,25 par seconde pendant 6 s, jusqu'à 3 charges). |  | 387, 595 | `v_herboriste` | 2 |
| **Venin paralysant** (`v_venin_paralysant`) | Variante | 1 | Flèche empoisonnée : chaque charge ralentit de 8 % (24 % à 3 charges), dégâts du poison −20 %. | var_fleche_empoisonnee | 363, 713 | `v_fleche_empoisonnee` | 3 |
| **Venin corrosif** (`v_venin_corrosif`) | Variante | 1 | Flèche empoisonnée : chaque charge retire 5 % de défense à la cible, dégâts du poison −10 %. | var_fleche_empoisonnee | 436, 671 | `v_fleche_empoisonnee` | 3 |
| **Flèche barbelée** (`v_fleche_barbelee`) | Compétence | 1 | Ajoute 35 de saignement. À 100, la plaie éclate : ×1,5 + 6 % des PV max (boss 2 %, joueurs 4 %). |  | 493, 511 | `v_herboriste` | 2 |
| **Barbes profondes** (`v_barbes_profondes`) | Variante | 1 | Flèche barbelée : saignement 35 → 50, dégâts ×1,0 → ×0,8. | var_fleche_barbelee | 514, 613 | `v_fleche_barbelee` | 3 |
| **Plaie ouverte** (`v_plaie_ouverte`) | Variante | 1 | Flèche barbelée : quand la plaie éclate, la cible subit +12 % de dégâts pendant 6 s. | var_fleche_barbelee | 575, 556 | `v_fleche_barbelee` | 3 |
| **Mithridatisation** (`v_mithridatisation`) | Passif | 1 | Les poisons et saignements que vous subissez durent 30 % moins longtemps ; +5 % de résistance aux dégâts de poison. |  | 560, 692 | `v_fleche_empoisonnee`, `v_fleche_barbelee` | 3 |
| **Cueilleur de brume** (`v_cueilleur`) | Passif | 1 | Récolte : +20 % de chances d'herbe en plus ; vos potions de soin rendent +10 %. (Point d'accroche vers la passerelle Arcaniste sylvestre.) |  | 436, 787 | `v_mithridatisation`, `pont_mr:*` | 4 |
| **Entaille venimeuse** (`v_entaille`) | Compétence | 1 | Un revers de dague en arc (×1,1) : 2 charges de poison, 20 de saignement, puis un petit saut de 2 m en arrière. |  | 505, 840 | `v_mithridatisation` | 4 |
| **Entaille profonde** (`v_entaille_profonde`) | Variante | 1 | Entaille venimeuse : plus de poison, mais saignement 20 → 45. | var_entaille | 502, 945 | `v_entaille` | 5 |
| **Entaille fuyante** (`v_entaille_fuyante`) | Variante | 1 | Entaille venimeuse : saut arrière 2 → 4 m avec 0,15 s d'invulnérabilité, recharge 8 → 10 s. | var_entaille | 583, 897 | `v_entaille` | 5 |
| **Nuage toxique** (`v_nuage`) | Compétence | 1 | Une fiole qui éclate en nuage de 4 m pendant 6 s : 1 charge de poison par seconde, et les ennemis dedans infligent −10 % de dégâts. |  | 656, 728 | `v_mithridatisation` | 4 |
| **Brume étouffante** (`v_brume_etouffante`) | Variante | 1 | Nuage toxique : les ennemis dedans attaquent 25 % plus lentement (préparations allongées d'autant) ; durée 6 → 4 s. | var_nuage | 673, 832 | `v_nuage` | 5 |
| **Nuage rampant** (`v_nuage_rampant`) | Variante | 1 | Nuage toxique : dérive à 1,5 m/s vers l'ennemi empoisonné le plus proche ; rayon 4 → 3 m. | var_nuage | 743, 770 | `v_nuage` | 5 |
| **Pointes enduites** (`v_pointes_enduites`) | Variante | 1 | Tir : un tir sur trois ajoute une charge de poison. Exclusif avec « Tir ricochet » et « Tir à bout portant ». | var_tir_approche | 834, 806 | `v_nuage` | 5 |
| **Saigneur** (`v_saigneur`) | Passif | 3 | +8 % d'accumulation de saignement par rang. |  | 632, 973 | `v_entaille` | 5 |
| **Contagion** (`v_contagion`) | Passif | 1 | Quand un ennemi empoisonné meurt, ses charges de poison passent à un ennemi à moins de 5 m. |  | 730, 901 | `v_entaille`, `v_nuage` | 5 |
| **Virulence** (`v_virulence`) | Passif | 2 | +10 % de dégâts par seconde du poison par rang. |  | 787, 971 | `v_contagion` | 6 |
| **Fléau** (`v_fleau`) | Compétence | 1 | Tous vos poisons dans un rayon de 12 m éclatent : 150 % des dégâts restants tout de suite, +50 de saignement, et 1 charge se propage à 4 m. (Demande 10 points dépensés dans la région Rôdeur.) |  | 825, 1056 | `v_virulence` | 7 |
| **Fléau dévorant** (`v_fleau_devorant`) | Variante | 1 | Fléau : vous soigne de 20 % des dégâts qu'il inflige ; recharge 35 → 45 s. | var_fleau | 938, 1079 | `v_fleau` | 8 |
| **Fléau propagé** (`v_fleau_propage`) | Variante | 1 | Fléau : propagation 4 → 7 m, dégâts immédiats 150 % → 100 %. | var_fleau | 800, 1186 | `v_fleau` | 8 |
| **Vénéneux** (`v_veneneux`) | Clé de voûte | 1 | Le poison se cumule jusqu'à 6 charges au lieu de 3, et le saignement s'accumule 30 % plus vite. (Demande 14 points dépensés dans la région Rôdeur.) **Contrepartie :** Vos dégâts directs (hors poison et saignement) sont réduits de 20 %. |  | 1065, 1028 | `v_fleau` | 8 |
| **Sang pour sang** (`v_sang_pour_sang`) | Clé de voûte | 1 | Chaque plaie qui éclate sous vos coups vous rend 8 % de vos PV max. (Demande 8 points dépensés dans la région Rôdeur.) **Contrepartie :** Vos potions de soin rendent 50 % de moins. |  | 630, 1091 | `v_saigneur` | 6 |

Intention visuelle des variantes (pour les effets) :

- *Venin paralysant* : Poison bleu-violet ; la cible laisse des traînées de brume lente derrière elle.
- *Venin corrosif* : Poison vert acide qui fume et ronge : petites bulles et taches corrodées sur l'armure.
- *Barbes profondes* : Pointe à crochets multiples ; la flèche reste plantée et suinte.
- *Plaie ouverte* : À l'éclatement, entaille rouge lumineuse qui reste visible 6 s sur la cible.
- *Entaille profonde* : Revers large avec trainée rouge épaisse ; pas de brume verte.
- *Entaille fuyante* : Nuage de brume verte laissé à l'endroit du coup pendant que le rôdeur bondit en arrière.
- *Brume étouffante* : Nuage plus dense, gris-vert, presque opaque ; les silhouettes des monstres dedans toussent.
- *Nuage rampant* : Nuage qui avance en volutes, laissant une traînée d'herbe flétrie au sol.
- *Pointes enduites* : Une flèche sur trois a une pointe verte luisante et laisse une petite traînée de brume.
- *Fléau dévorant* : Filaments verts qui remontent des cibles jusqu'au rôdeur.
- *Fléau propagé* : Chaque cible éclate en spores vertes qui volent vers les ennemis voisins.

## 9. Passerelle Chasseur (Rôdeur ↔ Guerrier) : lances, deux armes, chasse aux bêtes

Cette passerelle coûte 1 point au Rôdeur et au Guerrier, et ses compétences n'ont d'Inaptitude pour aucun des deux. Elle donne au rôdeur **une vraie mêlée**, avec la lance et une arme dans chaque main, et au guerrier **une attaque à distance** (le javelot). Elle a aussi un thème de chasse aux bêtes, relié à l'artisanat : Dépeceur donne plus de fourrures de loup pour l'ensemble du loup.

| Compétence (id) | Type | Mana | End. | Rech. | Portée / rayon | Puissance | Poise | Engagement | Étiquettes | Arme |
|---|---|---:|---:|---:|---|---|---:|---|---|---|
| **Javelot de chasse** (`javelot`) | projectile | 0 | 20 | 8 s | 16 m | ×1,8 | 35 | prép. 0,5 s · récup. 0,5 s à 30 % | physique, projectile, lance, chasse | toutes |
| **Estocade** (`estocade`) | dash | 6 | 22 | 9 s | 4,5 m | ×1,6 | 30 | récup. 0,5 s à 30 % | physique, mêlée, mobilité, lance | arme de mêlée |
| **Appât** (`appat`) | aoe_target | 10 | 5 | 30 s | 10 m · r 12 m | — | 0 | récup. 0,4 s à 50 % | contrôle, chasse | — |

- **Javelot de chasse** — Lance le javelot de chasse porté au dos (aucune munition) : ×1,8, 35 de poise. +25 % avec une lance équipée. *Soulslike :* Élan visible de 0,5 s, tir en cloche : un outil d'ouverture pour le rôdeur comme pour le guerrier. Utilisable avec n'importe quelle arme.
- **Estocade** — Une fente de 4,5 m qui se termine par un coup d'estoc (×1,6). Une lance allonge la fente de 1,5 m. *Soulslike :* Aucune invulnérabilité : c'est une ouverture, pas une esquive. Demande une arme de mêlée (lance, épée, dague).
- **Appât** — Lance un appât : les bêtes à 12 m (loups, sangliers, araignées, yétis…) s'acharnent dessus 3 s (élites 1,5 s, boss insensibles). *Soulslike :* Un « souffle » pour se replacer ou relever un allié, sans effet en JcJ ni sur les humanoïdes. Les bêtes reprennent leur cible ensuite.

| Nœud (id) | Type | Rangs | Effet | Groupe exclusif | x, y | Liens | Pts min. |
|---|---|---:|---|---|---|---|---:|
| **Instinct du chasseur** (`c_instinct_chasseur`) | Passif | 1 | +8 % de dégâts contre les bêtes (loups, sangliers, araignées, scorpions, yétis…). |  | 755, -231 | `q_acrobate` | 4 |
| **Javelot de chasse** (`c_javelot`) | Compétence | 1 | Lance le javelot de chasse porté au dos (aucune munition) : ×1,8, 35 de poise. +25 % avec une lance équipée. |  | 810, -344 | `c_instinct_chasseur` | 5 |
| **Javelot harpon** (`c_javelot_harpon`) | Variante | 1 | Javelot : attire une cible non-boss de 4 m vers vous (ou vous tire de 4 m vers une grande cible) ; ×1,8 → ×1,2. | var_javelot | 746, -466 | `c_javelot` | 6 |
| **Javelot lesté** (`c_javelot_leste`) | Variante | 1 | Javelot : poise 35 → 60, dégâts +20 %, élan 0,5 → 0,7 s. | var_javelot | 918, -298 | `c_javelot` | 6 |
| **Estocade** (`c_estocade`) | Compétence | 1 | Une fente de 4,5 m qui se termine par un coup d'estoc (×1,6). Une lance allonge la fente de 1,5 m. |  | 861, -458 | `c_javelot` | 6 |
| **Estocade balayante** (`c_estocade_balayante`) | Variante | 1 | Estocade : se termine par un balayage à 180° (rayon 3 m) ; ×1,6 → ×1,2. | var_estocade | 976, -414 | `c_estocade` | 7 |
| **Charge du sanglier** (`c_estocade_sanglier`) | Variante | 1 | Estocade : fente 4,5 → 7 m, poise 30 → 50, endurance 22 → 30. | var_estocade | 889, -577 | `c_estocade` | 7 |
| **Dépeceur** (`c_depeceur`) | Passif | 1 | +20 % de chances d'obtenir un matériau de plus sur les bêtes (fourrures, crocs, chitine). (Point d'accroche côté Guerrier.) |  | 689, -579 | `c_javelot`, `guerrier:*` | 6 |
| **Appât** (`c_appat`) | Compétence | 1 | Lance un appât : les bêtes à 12 m (loups, sangliers, araignées, yétis…) s'acharnent dessus 3 s (élites 1,5 s, boss insensibles). |  | 1087, -374 | `c_estocade` | 7 |
| **Appât piégé** (`c_appat_piege`) | Variante | 1 | Appât : explose au bout des 3 s (×1,2, 3 m) et ajoute 2 charges de poison. | var_appat | 1119, -498 | `c_appat` | 8 |
| **Appât sanglant** (`c_appat_sanglant`) | Variante | 1 | Appât : les bêtes qui s'y acharnent subissent +15 % de dégâts pendant 6 s. | var_appat | 1183, -317 | `c_appat` | 8 |
| **Ambidextrie** (`c_ambidextrie`) | Passif | 1 | Avec une arme de mêlée à une main en main gauche (dague, épée courte) : vos attaques de base de mêlée ajoutent un coup à ×0,35. −10 % de régénération d'endurance. |  | 906, -708 | `c_estocade` | 7 |
| **Frère d'armes** (`c_frere_armes`) | Passif | 1 | Rôdeur : l'Inaptitude de vos compétences Guerrier « mêlée » passe de 25 % à 10 %. Guerrier : idem pour les compétences Rôdeur « arc ». |  | 962, -533 | `c_estocade` | 7 |
| **Frénésie du chasseur** (`c_frenesie`) | Clé de voûte | 1 | Chaque coup de mêlée qui touche rend 4 d'endurance (une fois par attaque). (Demande 5 points dépensés dans la passerelle Chasseur.) **Contrepartie :** Vos compétences à distance coûtent 40 % d'endurance en plus. |  | 1050, -582 | `c_frere_armes` | 8 |

Intention visuelle des variantes (pour les effets) :

- *Javelot harpon* : Corde tendue visible entre le rôdeur et la cible, qui claque en se rétractant.
- *Javelot lesté* : Javelot à tête de pierre cerclée de fer ; impact lourd qui soulève terre et herbe.
- *Estocade balayante* : Arc de lumière pâle en demi-cercle au bout de la fente.
- *Charge du sanglier* : Traînée de poussière et silhouette fantomatique de sanglier pendant la charge.
- *Appât piégé* : Carcasse ficelée qui gonfle puis éclate en nuage verdâtre.
- *Appât sanglant* : Morceau de viande sanglante ; les bêtes attirées ont des yeux rouges luisants.

## 10. Équilibrage

### 10.1 Enveloppe de puissance (contrat avec les arbres Guerrier et Mage)

La somme des passifs de dégâts qu'une branche pure peut réunir au niveau 30 reste **autour de +40 %** de dégâts effectifs contre un boss, clé de voûte comprise. Pour le Tireur pur, cela donne :

| Source | Effet | Gain effectif estimé |
|---|---|---:|
| Main sûre ×3 | +12 % sur les compétences d'arc | +12 % |
| Œil exercé ×3, Point faible ×2 | +6 % de critique (15 → 21 %) et +24 % de dégâts critiques | ≈ +9 % |
| Tir de maître | +10 % contre les élites et les boss | +10 % (boss) |
| Posture de l'archer | +30 % de critique, **seulement immobile** | ≈ +12 % (sur ~50 % du temps immobile face au golem) |
| **Total** | | **≈ +40 à +45 %** |

Les branches Venin (+10 % poison et saignement, +20 % virulence, Vénéneux avec −20 % de dégâts directs) et Traqueur (+10 % de la Marque, Hallali +20 % pendant 10 s sur 60 s, Au plus près avec +30 % dague mais −15 % arc) visent la même enveloppe. Le reste de leur puissance passe par l'**utilité** : contrôle, groupe et survie.

Les compétences actives gardent l'échelle v0.2 : Tir ×0,85, Tir perçant ×1,9, Pluie de flèches ×1,25. Les nouvelles s'y calent avec le même rapport entre dégâts et engagement : plus une compétence frappe fort, plus sa préparation ou sa récupération est longue.

### 10.2 Constructions de référence (pour la simulation `tests/balance/sim.mjs`)

| Niveau | Points | Rôdeur « Tireur » pur | Rôdeur « Traqueur » pur | Rôdeur « Venin » pur |
|---|---:|---|---|---|
| 5 | 5 | 3 Fondamentaux (Roulade, Sprint, Garde) · Main sûre · Tir perçant | 3 Fond. · Pied léger · Coup de dague | 3 Fond. · Herboriste · Flèche empoisonnée |
| 15 | 17 | 5 Fond. · Tir véloce · Main sûre ×2 · Tir perçant + Tir traversant · Tir rapide · Œil exercé · Pluie de flèches + Averse d'acier · Flèche assommante + Flèche d'arrêt | 5 Fond. · Tir lesté · Pied léger · Marque + Marque de sang · Dague + Riposte · Acrobate · Bond + Salto · Piège + Piège à poudre · Garde du couteau | 5 Fond. · Tir lesté · Herboriste ×2 · Empoisonnée + Corrosif · Barbelée + Plaie ouverte · Mithridatisation · Entaille + Profonde · Nuage |
| 30 | 35 | … + Tir tendu ×2 · Sang-froid · Point faible ×2 · Trait fatal + Perce-cœur · Tir de maître · Carquois · Posture de l'archer (+ 4 points en Survie) | … + Filet + Filet d'acier · Instinct · Hallali + Hallali sanglant · Au plus près · Proie unique (+ Survie) | … + Nuage rampant · Pointes enduites · Saigneur ×3 · Contagion · Virulence ×2 · Fléau + Fléau propagé · Vénéneux (+ Survie) |

**Objectif**, comme dans `EQUILIBRAGE.md` : chaque construction pure à ±15 % de l'XP par minute moyenne des trois classes aux niveaux 5, 15 et 30. Au niveau 5, chaque classe a son attaque de base plus 1 compétence. C'est volontairement plus pauvre que la v0.2, où le rôdeur avait 4 compétences dès le départ : les monstres de niveau 1 à 5 doivent être tués **avec l'attaque de base et la roulade**. La simulation doit le confirmer, et sinon il faudra baisser les PV des gluants et des loups.

### 10.3 Hybrides : viables, pas meilleurs

- **Rôdeur « Chasseur » (hybride Guerrier)** au niveau 30 : 5 Fondamentaux, 12 points de Tireur/Traqueur, 10 points sur la passerelle Chasseur (Javelot, Estocade, Frère d'armes, Ambidextrie, Frénésie…), puis 8 points en région Guerrier, soit **4 nœuds seulement**, par exemple Coup puissant et un passif. Avec Frère d'armes, le Coup puissant perd 10 % de puissance au lieu de 25 %. Il est plus solide en mêlée qu'un Tireur pur, mais son arc est moins bon : pas de Trait fatal ni de Posture, et Frénésie ajoute +40 % d'endurance sur les tirs.
- **Mage prenant des tirs** : 2 points par nœud, Inaptitude pleine (Tir perçant à ×1,43 au lieu de ×1,9, 15 de mana au lieu de 12). Il lui faut aussi **un arc** pour tirer, donc −20 % sur ses sorts sans focus. L'hybride se paie deux fois : en points et en équipement. C'est voulu.
- La passerelle Chasseur coûte 1 point au Rôdeur et au Guerrier. C'est la porte d'entrée naturelle des deux classes vers l'autre, et elle leur donne des options (lance, javelot, bêtes) plutôt que de la puissance brute.

### 10.4 Garde-fous soulslike (à vérifier en revue)

| Risque | Garde-fou |
|---|---|
| Recul en tirant (v0.1) | Aucun nœud ne lève la règle du tir à ≤ 40 % de vitesse. Tir véloce raccourcit la recharge, pas la règle. Le tir aérien d'Acrobate impose 0,3 s de réception. |
| Fuite gratuite | Bond de retrait : 28 d'endurance + 8 de mana, 10 s de recharge, 0,15 s d'invulnérabilité, bloqué 0,5 s après une roulade. Entaille fuyante : 0,15 s. Fantôme des brumes : seulement après une esquive **parfaite**, recharge interne de 8 s, −15 % de PV max. |
| Contrôle permanent | Piège : 2 au maximum, 2 s d'immobilisation (élites 1 s, boss : ralentissement). Filet d'acier : 1,5 s toutes les 22 s. En JcJ, toute immobilisation dure au plus 1 s, et 2 immobilisations en 6 s rendent la cible insensible pendant 6 s (rendements décroissants à appliquer côté serveur). |
| Poison qui tue sans risque | Poison sans poise, les charges ont un plafond (3, ou 6 avec Vénéneux et −20 % de dégâts directs), Fléau demande 10 points dans la région et ne fait rien sans préparation. |
| Endurance infinie | Hallali : 3 d'endurance par coup, 10 s toutes les 60 s. Frénésie : 4 par coup de mêlée, mais +40 % sur les tirs. Aucun nœud ne touche à la régénération de base, à part la baisse de 10 % d'Ambidextrie. |
| Soin infini | Sang pour sang : 8 % des PV par plaie qui éclate (il faut 100 de saignement, soit 2 à 3 Flèches barbelées), avec des potions divisées par deux. Fléau dévorant : 20 % des dégâts, toutes les 45 s. |

## 11. Personnages v0.2 et raccourcis

- Les rôdeurs v0.2 reçoivent tous leurs points, **Roulade et Sprint gratuits** (ils les avaient déjà), et une réinitialisation gratuite. Pour retrouver exactement leurs 4 compétences v0.2, il leur faut 5 points : Main sûre, Tir perçant, Tir rapide, Œil exercé et Pluie de flèches.
- Le Rôdeur a jusqu'à **20 compétences actives possibles** (17 de région + 3 de passerelle), pour une barre de **8 emplacements** librement assignables. Il faut donc choisir, et c'est le but. L'attaque de base occupe un emplacement comme les autres.

## 12. Questions ouvertes pour le synthétiseur

1. **Lance et main gauche** : la passerelle Chasseur suppose une famille d'armes « lance » et des armes de main gauche (dague, épée courte) pour Ambidextrie. Il faut l'accord du concepteur de `OBJETS_ARTISANAT.md`.
2. **États de saignement et de poison** : ce sont de nouveaux systèmes serveur (jauge de saignement sous la barre de vie, charges de poison). Les noms `saignement` et `poison` doivent être communs aux trois arbres.
3. **« Esquive parfaite » et Saut** : Fantôme des brumes, Riposte au couteau et Acrobate dépendent des définitions de l'arbre Survie (roulade qui évite un coup pendant son invulnérabilité ; saut de 0,35 s).
4. **Pièges, filets au sol et appâts** : ce sont de nouvelles entités serveur de courte durée, avec leurs modèles et effets (mâchoires d'acier, ronces, baril de poudre, carcasse). Il faut les ajouter à la liste des éléments visuels de la v0.3.
5. **Invisibilité en JcJ** (Fantôme des brumes) : on peut la garder à 0,8 s avec la silhouette visible à 5 m, ou la désactiver en zone rouge. Recommandation : la garder, puisque la condition d'esquive parfaite la rend rare.
6. **Rendements décroissants des immobilisations en JcJ** : ils doivent être communs à toutes les classes, y compris aux sorts de gel du Mage.
