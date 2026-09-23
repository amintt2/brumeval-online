# Arbre des Brumes — région **Guerrier** et passerelle **Lame spirituelle** (brouillon)

> Brouillon de conception v0.3 pour le synthétiseur (`docs/design/ARBRE_COMPETENCES.md`). Données exactes :
> `docs/design/drafts/tree_warrior.json` (même contenu, généré à partir de la même source — le JSON fait foi en cas d’écart).
> Respecte les règles communes de ROADMAP §2 bis : niveau max 30, **35 points** au niveau 30, Fondamentaux au centre,
> un seul arbre commun, coût 1 / 2 / 3 points et **Inaptitude** hors de sa classe.

## 1. En bref

- **87 nœuds Guerrier** (17 compétences, 38 variantes, 26 passifs, 6 clés de voûte) + **13 nœuds de passerelle** Guerrier↔Mage (3 compétences, 7 variantes, 2 passifs, 1 clé de voûte).
- **19 capacités** : les 4 de la v0.2 (Frappe, Coup puissant, Tourbillon, Cri de guerre — mêmes id) + 12 nouvelles pour le Guerrier + 3 hybrides.
- Au niveau 1 le Guerrier n’a **que la Frappe**. Les trois capacités de la v0.2 sont à **1 ou 2 points** du départ : Coup puissant (1), puis Cri de guerre / Tourbillon / Estocade (2) — une par racine de branche.
- **Toutes les capacités ont au moins un groupe de variantes exclusives**, y compris la Frappe (deux groupes : *forme* et *cadence*).
- Un Guerrier pur dépense ~30 points hors Fondamentaux : il prend **environ un tiers** de sa région. Deux Guerriers de niveau 30 ne se ressemblent pas.
- Trois identités : **Gardien** (bouclier, blocage, protection du groupe), **Berserker** (rage, saignement, gros coups, vol de vie), **Maître d’armes** (rythme, critiques, estocs, mobilité sans invulnérabilité).

## 2. Place dans l’Arbre des Brumes

Repère global unique : **x vers la droite, y vers le haut**, centre de l’arbre en (0, 0) ; l’interface affiche `screenY = −y`.

```
                          Gardien (90°)
          Maître d'armes    ║    Berserker
              (114°)   ╲    ║    ╱  (66°)
                        ╲   ║   ╱                    rayon 820 → 1 490 : 8 anneaux (k = 0..7),
   Lame spirituelle      ╲  ║  ╱                     écart 95 entre anneaux, 74 entre voisins
   (pont_gm, 134–166°) ── Coup puissant (0, 640)
                              ║
                     Frappe = g_depart (0, 500)      ← départ du Guerrier
                              ║
                   [ Survie / Fondamentaux, r < 400 ]
```

- `g_depart` (0, 500) est **alloué gratuitement** à la création. Il est relié vers l’intérieur à *survie:porte_guerrier* (nœud du brouillon Survie, attendu vers (0, 400)).
- **Porte des Fondamentaux** : tant que le personnage n’a pas appris **3 Fondamentaux**, aucun autre nœud de la région Guerrier (ni de passerelle) n’est allouable — les variantes de Frappe comprises. Les Fondamentaux sont toujours allouables en premier.
- Les trois racines de branche partent de **Coup puissant** : c’est le tronc commun, 1 point.
- La région occupe l’angle 57°–124°. La passerelle Guerrier↔Mage occupe 134°–166° (rayon 770–1 180) : aucune collision possible avec la région Mage (au-delà de 175°) ni avec la passerelle Chasseur (vers 30°), qui se rattachera au Berserker (bord droit, ~60°).
- Le générateur vérifie : aucune paire de nœuds à moins de 62 unités, aucun lien qui passe à moins de 30 unités d’un autre nœud, aucun croisement de liens, tous les nœuds joignables depuis `g_depart`, et — sur 4 000 tirages aléatoires d’une option par groupe exclusif — aucun nœud rendu inaccessible par un choix de variante.
- **Passer par une variante** : quelques passifs sont reliés aux deux variantes d’un même groupe ; en prendre *une* suffit pour avancer. On ne peut jamais être bloqué par un choix exclusif.

## 3. Capacités

Colonnes : coût (mana + endurance), recharge, portée ou rayon, puissance (× attaque), poise infligée, **engagement** = armement / récupération à x % de la vitesse (règle de la v0.2 : pas de kite gratuit). Arme requise : `arme_melee` pour toutes les compétences d’arme ; aucune pour les cris et buffs.

| id | Nom | Type | Coût | Rech. | Portée | Puiss. | Poise | Engagement | Mots-clés |
|---|---|---|---|---|---|---|---|---|---|
| `strike` | **Frappe** *(base)* | melee | 5 end. | 1,3 s | 2,8 m | ×1,2 | 12 | 0,15 s / 0,25 s à 50 % | physique, melee |
| `heavy_blow` | **Coup puissant** *(v0.2)* | melee | 12 mana + 16 end. | 6 s | 2,8 m | ×2,8 | 42 | 0,35 s / 0,5 s à 30 % | physique, melee, lourd |
| `whirlwind` | **Tourbillon** *(v0.2)* | aoe_self | 20 mana + 18 end. | 10 s | r 4,5 m | ×1,7 | 24 | 0,2 s / 0,55 s à 35 % | physique, melee, zone |
| `war_cry` | **Cri de guerre** *(v0.2)* | self_heal | 15 mana | 25 s | — | soin 30 % | 0 | 0,3 s / 0,4 s à 50 % | soin, cri |
| `taunt` | **Provocation** | aoe_self | 10 mana | 14 s | r 8 m | 4 s | 0 | 0,2 s / 0,3 s à 50 % | cri, defense, groupe |
| `shield_bash` | **Coup de bouclier** | melee | 8 mana + 18 end. | 10 s | 2,2 m | ×1 | 55 | 0,12 s / 0,35 s à 40 % | physique, melee, defense, interruption |
| `riposte` | **Riposte** | melee | 12 end. | 3 s | 2,8 m | ×2,2 | 30 | 0,1 s / 0,3 s à 50 % | physique, melee, contre |
| `bastion` | **Bastion** | buff | 20 mana | 30 s | — | 6 s | 0 | 0,2 s / 0,3 s à 50 % | defense |
| `rage` | **Rage sanguinaire** | buff | 10 % PV | 35 s | — | 10 s | 0 | 0,3 s / 0,3 s à 50 % | rage |
| `leap_slam` | **Bond fracassant** | dash | 10 mana + 25 end. | 12 s | 7 m / r 3 m | ×1,6 | 50 | 0,15 s / 0,7 s à 20 % | physique, zone, mobilite, saut |
| `rend` | **Entaille** | melee | 8 mana + 14 end. | 8 s | 2,8 m | ×0,9 | 18 | 0,15 s / 0,3 s à 45 % | physique, melee, saignement |
| `execute` | **Exécution** | melee | 15 mana + 22 end. | 15 s | 2,8 m | ×2 | 35 | 0,3 s / 0,8 s à 20 % | physique, melee, lourd |
| `lunge` | **Estocade** | dash | 8 mana + 15 end. | 7 s | 4 m | ×1,6 | 25 | 0,1 s / 0,4 s à 35 % | physique, melee, mobilite, estoc |
| `blade_dance` | **Danse des lames** | channel | 12 mana + 20 end. | 10 s | 2,8 m | ×0,9 ×3 | 12 | 0,1 s / 0,45 s à 40 % | physique, melee, combo |
| `sunder` | **Brise-garde** | melee | 10 mana + 16 end. | 12 s | 2,8 m | ×1,1 | 70 | 0,25 s / 0,4 s à 35 % | physique, melee, lourd |
| `sidestep` | **Pas de lame** | dash | 18 end. | 6 s | 3 m | 0,25 s | 0 | 0 s / 0,1 s à 80 % | mobilite |
| `enchant_blade` | **Lame enchantée** | buff | 25 mana | 20 s | — | 12 s | 0 | 0,4 s / 0,3 s à 50 % | arcane, enchantement |
| `blade_wave` | **Onde tranchante** | projectile | 18 mana + 12 end. | 8 s | 10 m | ×1,3 | 14 | 0,3 s / 0,5 s à 25 % | arcane, projectile |
| `rune_aegis` | **Égide runique** | buff | 30 mana | 25 s | — | 6 s | 0 | 0,3 s / 0,3 s à 50 % | arcane, defense |

**Lecture soulslike** (pourquoi chaque capacité reste honnête) :

- **Frappe** — Coup court : sûr contre les brutes après leur attaque, trop faible pour déséquilibrer seul. Se charge (Fondamental « Attaque chargée ») : ×2,2 et poise 40 après 0,8 s de charge.
- **Coup puissant** — L’outil de punition : à placer dans la fenêtre de récupération d’un monstre. 42 de poise : un loup (24) titube d’un coup, un squelette (44) presque ; il en faut 4 pour le golem (150).
- **Tourbillon** — Anti-meute (loups, gobelins). 0,55 s de récupération : lancé au mauvais moment, on mange la charge suivante.
- **Cri de guerre** — Soin d’urgence non interruptible mais avec 0,7 s d’engagement total : à placer après une roulade, pas sous un télégraphe.
- **Provocation** — Les monstres provoqués changent de cible APRÈS leur attaque en cours (jamais d’annulation de télégraphe). Boss : 2 s seulement.
- **Coup de bouclier** — Interrompt la préparation d’une attaque LÉGÈRE (kind melee) d’un monstre non-boss. Les attaques télégraphiées ne sont interrompues que si la poise casse. Avec un bouclier en main gauche ; sinon coup de pommeau : puissance ×0,7, poise 40.
- **Riposte** — Utilisable 1 s après un coup bloqué avec la Garde (ou une parade parfaite). Récompense la lecture du rythme ennemi, sans jamais rendre invulnérable.
- **Bastion** — Pas d’invulnérabilité : −40 % seulement, pas de roulade pendant 6 s. Pensé pour encaisser une phase de boss en groupe.
- **Rage sanguinaire** — Coûte 10 % des PV actuels (jamais mortel). −20 % de défense : une erreur coûte plus cher.
- **Bond fracassant** — En l’air 0,45 s : passe au-dessus des ondes de choc au sol comme le Saut, mais ce n’est PAS une invulnérabilité (projectiles et coups hauts touchent). 0,7 s de récupération à l’atterrissage.
- **Entaille** — Dégâts différés : permet de rouler immédiatement après. Le saignement ignore la défense mais pas la garde frontale des squelettes (le coup initial y est soumis).
- **Exécution** — Très engageant (0,3 s d’armement + 0,8 s de récupération) : ne se place que sur un monstre déséquilibré ou en récupération.
- **Estocade** — Déplacement offensif SANS invulnérabilité : sert à combler une distance, pas à esquiver.
- **Danse des lames** — Annulable par une roulade entre deux coups (les coups restants sont perdus) : pas de verrouillage, mais pas d’esquive gratuite non plus.
- **Brise-garde** — Supprime la garde frontale (squelettes, boucliers) pendant 6 s. 70 de poise : l’ouverture idéale d’un combo.
- **Pas de lame** — AUCUNE invulnérabilité (contrairement à la roulade) : un pas bien lu évite le coup, un pas mal lu le prend en pleine face.
- **Lame enchantée** — Préparation 0,4 s bien visible : on l’active avant le combat ou pendant une ouverture.
- **Onde tranchante** — Un outil à mi-distance, pas un kite : 10 m, 8 s de recharge, 0,5 s de récupération à 25 % de vitesse.
- **Égide runique** — Absorbe 12 % des PV max + 25 % du mana max ; se brise d’un seul coup lourd de boss.

Mécaniques communes introduites ici :
- **Saignement** : dégâts physiques sur la durée qui ignorent la défense ; une instance par source et par capacité (la Frappe saignante cumule jusqu’à 3). Dégâts affichés en rouge sombre.
- **Critique garanti / prochain coup critique** : consommé par le prochain coup de mêlée qui touche.
- **Aérien** (Bond fracassant, comme le Saut) : passe au-dessus des ondes de choc au sol (`ring` du golem, cercles au sol marqués `ground`), **pas** des projectiles ni des coups de mêlée.
- **Aucune capacité du Guerrier ne donne d’invulnérabilité.** Seule la roulade (Survie) en donne.

## 4. Tronc commun (8 nœuds)

La Frappe et le Coup puissant ont chacun **trois formes exclusives** juste à côté du départ : dès le niveau 5 (le 4ᵉ point, juste après les 3 Fondamentaux), le Guerrier choisit « comment il frappe ».

| id | Nom | Type | Effet | x, y | Relié à |
|---|---|---|---|---|---|
| `g_depart` | **Frappe** | Compétence | Point de départ du Guerrier : l’attaque de base, acquise au niveau 1. | 0, 500 | *survie:porte_guerrier* |
| `g_frappe_tournoyante` | **Frappe tournoyante** | Variante<br>groupe `frappe_forme` | La Frappe balaie un arc de 200° devant vous (rayon 3 m) ; puissance ×1,2 → ×0,95.<br>*Visuel : Traînée d’acier large et pâle en demi-lune, poussière soulevée au sol.* | -149, 487 | `g_depart` |
| `g_frappe_saignante` | **Frappe saignante** | Variante<br>groupe `frappe_forme` | La Frappe ouvre une plaie : saignement de 30 % de l’attaque sur 4 s (cumul jusqu’à 3).<br>*Visuel : Traînée rouge sombre, gerbe de gouttes à l’impact, petites marques rouges sur la cible par cumul.* | -141, 551 | `g_depart` |
| `g_frappe_eclair` | **Frappe éclair** | Variante<br>groupe `frappe_forme` | Frappe plus vive : recharge 1,3 → 1,0 s, puissance 1,2 → 1,0, endurance 5 → 4, récupération 0,25 → 0,18 s.<br>*Visuel : Traînée fine et blanche très courte, légère distorsion d’air derrière la lame.* | -106, 606 | `g_depart` |
| `g_coup_puissant` | **Coup puissant** | Compétence | Débloque Coup puissant (compétence de la v0.2). | 0, 640 | `g_depart` |
| `g_coup_fendoir` | **Coup fendoir** | Variante<br>groupe `coup_puissant_forme` | Coup puissant brise les gardes : poise 42 → 65 et ignore la garde frontale ; puissance 2,8 → 2,5.<br>*Visuel : Coup vertical, étincelles orange à l’impact et fissure brève au sol.* | 148, 614 | `g_coup_puissant` |
| `g_coup_ascendant` | **Coup ascendant** | Variante<br>groupe `coup_puissant_forme` | Coup puissant projette la cible de 3 m en arrière (non-boss) ; recharge 6 → 8 s.<br>*Visuel : Arc de bas en haut, souffle de vent qui repousse la brume.* | 123, 554 | `g_coup_puissant` |
| `g_coup_pommeau` | **Coup de pommeau** | Variante<br>groupe `coup_puissant_forme` | Plus court et plus sûr : armement 0,35 → 0,15 s, récupération 0,5 → 0,3 s, recharge 6 → 4 s, puissance 2,8 → 1,9.<br>*Visuel : Coup sec et court, onde de choc ronde et blanche à l’impact.* | 75, 510 | `g_coup_puissant` |

## 5. Branche **Gardien** (90°, 26 nœuds) — bouclier, blocage, protection

Fantaisie : le chevalier de Brumeval qui tient la ligne. Il bloque au lieu de rouler, punit par la Riposte et protège le groupe (Provocation, Serment). Synergies d’arme : **épée courte** et **épée longue** avec bouclier.

| id | Nom | Type | Effet | x, y | Relié à |
|---|---|---|---|---|---|
| `gd_cri` | **Cri de guerre** | Compétence | Débloque Cri de guerre (compétence de la v0.2). Racine du Gardien. | 0, 820 | `g_coup_puissant` |
| `gd_cri_ralliement` | **Cri de ralliement** | Variante<br>groupe `cri_forme` | Soigne aussi les membres du groupe à moins de 10 m de 15 % de leurs PV ; votre soin passe de 30 % à 22 %.<br>*Visuel : Onde dorée qui s’étend sur 10 m, halo doux sur les alliés touchés.* | 74, 817 | `gd_cri` |
| `gd_cri_effroi` | **Cri d’effroi** | Variante<br>groupe `cri_forme` | Soin 30 % → 15 % ; les monstres à moins de 6 m infligent −20 % de dégâts pendant 6 s (boss −10 %).<br>*Visuel : Onde rouge sombre, les ennemis touchés émettent une fumée noire brève.* | -74, 817 | `gd_cri` |
| `gd_cri_souffle` | **Second souffle** | Variante<br>groupe `cri_forme` | Rend 15 % des PV tout de suite puis 15 % sur 5 s, et 40 d’endurance ; recharge 25 → 22 s.<br>*Visuel : Buée blanche expirée, fines volutes vertes qui remontent le long du corps pendant 5 s.* | 0, 915 | `gd_cri` |
| `gd_garde_de_fer` | **Garde de fer** | Passif (3 rangs) | Les coups bloqués par la Garde coûtent 10 % d’endurance en moins par rang. | 74, 912 | `gd_cri` |
| `gd_constitution` | **Constitution** | Passif (3 rangs) | +4 % de PV max par rang. | -74, 912 | `gd_cri` |
| `gd_coup_bouclier` | **Coup de bouclier** | Compétence | Débloque Coup de bouclier. | 74, 1007 | `gd_garde_de_fer` |
| `gd_charge_bouclier` | **Charge au bouclier** | Variante<br>groupe `bouclier_forme` | Vous chargez 6 m avant l’impact ; poise 55 → 45, recharge 10 → 12 s.<br>*Visuel : Traînée de poussière derrière le guerrier, choc métallique avec éclats blancs.* | 148, 1095 | `gd_coup_bouclier` |
| `gd_bouclier_ecrasant` | **Bouclier écrasant** | Variante<br>groupe `bouclier_forme` | Puissance 1,0 → 1,6, étourdit 1,2 s les non-boss ; recharge 10 → 14 s.<br>*Visuel : Impact lourd, étoiles/étincelles tournoyant au-dessus de la cible étourdie.* | 74, 1103 | `gd_coup_bouclier` |
| `gd_riposte` | **Riposte** | Compétence | Débloque Riposte. | 0, 1010 | `gd_garde_de_fer`, `gd_constitution` |
| `gd_riposte_vengeresse` | **Riposte vengeresse** | Variante<br>groupe `riposte_forme` | Ajoute 60 % des dégâts bloqués par le dernier coup ; puissance 2,2 → 1,8.<br>*Visuel : La lame se couvre d’un reflet rouge-or au moment du blocage, décharge à l’impact.* | 0, 1105 | `gd_riposte` |
| `gd_riposte_desequilibre` | **Riposte déséquilibrante** | Variante<br>groupe `riposte_forme` | Plus de critique garanti, mais poise 30 → 90 : déséquilibre la plupart des monstres.<br>*Visuel : Coup d’épaule + lame, onde grise concentrique, la cible titube.* | -74, 1103 | `gd_riposte` |
| `gd_provocation` | **Provocation** | Compétence | Débloque Provocation. | -74, 1007 | `gd_constitution` |
| `gd_defi` | **Défi** | Variante<br>groupe `provocation_forme` | Une seule cible à 15 m, provoquée 6 s ; elle subit +10 % de dégâts de vos alliés.<br>*Visuel : Rayon rouge du guerrier à la cible, marque d’épée flottant au-dessus d’elle.* | -148, 1095 | `gd_provocation` |
| `gd_rempart_vivant` | **Rempart vivant** | Variante<br>groupe `provocation_forme` | Défense +15 % → −25 % de dégâts subis pendant 4 s, mais vitesse −30 %.<br>*Visuel : Aura de pierre grise autour du corps, anneau de runes au sol.* | -147, 999 | `gd_provocation` |
| `gd_maitrise_courte` | **Épée et bouclier** | Passif | Épée courte ou longue + bouclier : blocage +10 % de réduction et Frappe −10 % de recharge. | 74, 1198 | `gd_bouclier_ecrasant`, `gd_charge_bouclier`, `gd_riposte_vengeresse` |
| `gd_peau_de_pierre` | **Peau de pierre** | Passif (3 rangs) | +5 % de défense par rang. | 0, 1200 | `gd_riposte_vengeresse`, `gd_riposte_desequilibre` |
| `gd_sentinelle` | **Sentinelle** | Passif | Quand vous bloquez un coup, 3 % des PV max rendus (au plus une fois toutes les 2 s). | -74, 1198 | `gd_riposte_desequilibre`, `gd_defi`, `gd_peau_de_pierre` |
| `gd_maitrise_longue` | **Maîtrise de l’épée longue** | Passif | Épée longue : +8 % de dégâts et +0,3 m de portée de mêlée. | 74, 1293 | `gd_maitrise_courte` |
| `gd_bastion` | **Bastion** | Compétence | Débloque Bastion. | 0, 1295 | `gd_peau_de_pierre` |
| `gd_bastion_mobile` | **Bastion mobile** | Variante<br>groupe `bastion_forme` | −40 % → −25 % de dégâts subis, mais plus de ralentissement et la roulade reste permise.<br>*Visuel : Fines plaques de lumière grise qui suivent le corps au lieu d’un anneau au sol.* | 74, 1388 | `gd_bastion` |
| `gd_bastion_epineux` | **Bastion épineux** | Variante<br>groupe `bastion_forme` | Renvoie 30 % des dégâts de mêlée subis à l’attaquant pendant la durée.<br>*Visuel : Épines de fer spectrales jaillissant de l’armure à chaque coup reçu.* | -74, 1388 | `gd_bastion` |
| `gd_endurci` | **Souffle de vétéran** | Passif (3 rangs) | +5 d’endurance max par rang. | -74, 1293 | `gd_sentinelle` |
| `gd_inebranlable` | **Inébranlable** | Passif | Durée des étourdissements et renversements subis −30 %. | 0, 1390 | `gd_bastion` |
| `gd_ks_mur_vivant` | **Mur vivant** | Clé de voûte | Avec un bouclier, la Garde bloque 100 % des dégâts frontaux (85 % contre un boss). CONTREPARTIE : coups bloqués +30 % d’endurance, sprint impossible, roulade −40 % de distance. | 74, 1483 | `gd_inebranlable` |
| `gd_ks_serment` | **Serment du protecteur** | Clé de voûte | 20 % des dégâts subis par les membres du groupe à moins de 8 m sont redirigés vers vous ; +20 % de défense. CONTREPARTIE : −15 % de dégâts infligés. | -74, 1483 | `gd_inebranlable` |

## 6. Branche **Berserker** (66°, 27 nœuds) — rage, saignement, gros coups

Fantaisie : le guerrier des marches du nord qui paie en sang. Il gagne en force quand il est blessé, fait saigner et achève. Synergies d’arme : **espadon** et **épée bâtarde à deux mains**.

| id | Nom | Type | Effet | x, y | Relié à |
|---|---|---|---|---|---|
| `bk_tourbillon` | **Tourbillon** | Compétence | Débloque Tourbillon (compétence de la v0.2). Racine du Berserker. | 334, 749 | `g_coup_puissant` |
| `bk_tourbillon_sanglant` | **Tourbillon sanglant** | Variante<br>groupe `tourbillon_forme` | Chaque ennemi touché saigne (60 % de l’attaque sur 5 s) ; puissance 1,7 → 1,4.<br>*Visuel : Cercle de traînées rouge sombre, gouttes projetées en spirale.* | 400, 716 | `bk_tourbillon` |
| `bk_tourbillon_ambulant` | **Tourbillon ambulant** | Variante<br>groupe `tourbillon_forme` | Devient canalisé 2 s : 4 coups ×0,55, déplacement à 60 %, 10 d’endurance par seconde en plus.<br>*Visuel : Tornade d’acier grise continue, feuilles et brume aspirées.* | 438, 803 | `bk_tourbillon` |
| `bk_tourbillon_aspirant` | **Tourbillon aspirant** | Variante<br>groupe `tourbillon_forme` | Rayon 4,5 → 5,5 m et attire les ennemis de 2 m vers vous ; puissance 1,7 → 1,4.<br>*Visuel : Spirale de vent convergente, lignes d’air tirées vers le centre.* | 265, 776 | `bk_tourbillon` |
| `bk_soif` | **Soif de sang** | Passif (3 rangs) | +2 % de vol de vie sur les dégâts de mêlée par rang. | 372, 836 | `bk_tourbillon` |
| `bk_chair` | **Chair endurcie** | Passif (3 rangs) | +4 % de PV max par rang. | 303, 863 | `bk_tourbillon` |
| `bk_rage` | **Rage sanguinaire** | Compétence | Débloque Rage sanguinaire. | 411, 923 | `bk_soif` |
| `bk_rage_froide` | **Rage froide** | Variante<br>groupe `rage_forme` | Ne coûte plus de PV ni de défense : +15 % de dégâts et +10 % de critique.<br>*Visuel : Aura bleu-gris glacée, yeux qui luisent blanc.* | 449, 1009 | `bk_rage` |
| `bk_frenesie` | **Frénésie** | Variante<br>groupe `rage_forme` | Chaque ennemi tué prolonge la Rage de 3 s (20 s au plus).<br>*Visuel : Aura rouge qui s’intensifie à chaque élimination, braises qui tombent.* | 381, 1037 | `bk_rage` |
| `bk_entaille` | **Entaille** | Compétence | Débloque Entaille. | 477, 890 | `bk_soif` |
| `bk_entaille_profonde` | **Entaille profonde** | Variante<br>groupe `entaille_forme` | Saignement ×1,5 et 8 s au lieu de 6 s.<br>*Visuel : Plaie rouge plus épaisse, filets de sang qui persistent au sol.* | 580, 940 | `bk_entaille` |
| `bk_hemorragie` | **Hémorragie** | Variante<br>groupe `entaille_forme` | Sur une cible qui saigne déjà : consomme le saignement et inflige tout le reste d’un coup, +30 %.<br>*Visuel : Explosion de gouttes rouges en éventail à l’impact.* | 516, 977 | `bk_entaille` |
| `bk_bond` | **Bond fracassant** | Compétence | Débloque Bond fracassant. | 342, 950 | `bk_chair` |
| `bk_bond_predateur` | **Bond du prédateur** | Variante<br>groupe `bond_forme` | Portée 7 → 10 m, vise un ennemi et le fait saigner (50 % de l’attaque sur 4 s) ; rayon 3 → 2 m.<br>*Visuel : Trajectoire en arc avec traînée rouge, griffures au sol à l’impact.* | 272, 973 | `bk_bond` |
| `bk_onde_choc` | **Onde de choc** | Variante<br>groupe `bond_forme` | Rayon 3 → 4,5 m, ralentit de 40 % pendant 2 s ; puissance 1,6 → 1,3.<br>*Visuel : Anneau de terre soulevée, fissures radiales et nuage de poussière.* | 311, 1060 | `bk_bond` |
| `bk_maitrise_batarde` | **Maîtrise de la bâtarde** | Passif | Épée bâtarde à deux mains : +12 % de dégâts, +10 % de poise. | 619, 1028 | `bk_entaille_profonde`, `bk_plaie` |
| `bk_plaie` | **Plaies béantes** | Passif (3 rangs) | +10 % de dégâts de saignement par rang. | 555, 1064 | `bk_hemorragie`, `bk_entaille_profonde` |
| `bk_fureur` | **Fureur montante** | Passif | Chaque coup subi donne +3 % de dégâts pendant 5 s (5 cumuls). | 488, 1096 | `bk_rage_froide`, `bk_frenesie` |
| `bk_maitrise_espadon` | **Maîtrise de l’espadon** | Passif | Espadon : +15 % de poise infligée, Coup puissant et Bond fracassant +15 % de dégâts, endurance des attaques −10 %. | 420, 1124 | `bk_frenesie`, `bk_onde_choc`, `bk_fureur` |
| `bk_execution` | **Exécution** | Compétence | Débloque Exécution. | 527, 1183 | `bk_fureur`, `bk_plaie` |
| `bk_couperet` | **Couperet** | Variante<br>groupe `execution_forme` | Si Exécution tue, sa recharge est remise à zéro et vous regagnez 15 d’endurance.<br>*Visuel : Lame qui laisse une traînée noire-rouge, flash rouge au sol quand la recharge se réinitialise.* | 632, 1238 | `bk_execution` |
| `bk_decapitation` | **Décapitation** | Variante<br>groupe `execution_forme` | Armement 0,3 → 0,6 s bien visible, puissance 2,0 → 3,2, poise 35 → 90.<br>*Visuel : Lame levée au-dessus de la tête qui s’embrase de rouge pendant l’armement, impact en croissant géant.* | 497, 1298 | `bk_execution` |
| `bk_instinct` | **Instinct de survie** | Passif | Sous 30 % de PV : +25 % de régénération d’endurance. | 458, 1211 | `bk_maitrise_espadon` |
| `bk_carnage` | **Carnage** | Passif (3 rangs) | +3 % de dégâts de mêlée par rang. | 593, 1151 | `bk_maitrise_batarde` |
| `bk_briseur` | **Briseur d’os** | Passif | Les monstres déséquilibrés subissent +15 % de dégâts de vos coups. | 565, 1270 | `bk_execution` |
| `bk_ks_rasoir` | **Au fil du rasoir** | Clé de voûte | +3 % de dégâts par tranche de 10 % de PV manquants (max +27 %) et +3 % de vol de vie. CONTREPARTIE : soins reçus −30 % et plus de régénération de PV hors combat. | 671, 1325 | `bk_briseur` |
| `bk_ks_dechaine` | **Déchaîné** | Clé de voûte | +20 % de dégâts et +15 % de vitesse d’attaque. CONTREPARTIE : la Garde est impossible (ni blocage ni parade) et −10 % de défense. | 536, 1385 | `bk_briseur` |

## 7. Branche **Maître d’armes** (114°, 26 nœuds) — rythme, critiques, estocs

Fantaisie : le bretteur de la cour d’Aldmar. Enchaînements, placement, critiques, lecture de l’adversaire. Synergies d’arme : **rapière**, **cimeterre**, **lame courbe**. C’est la branche voisine de la passerelle Lame spirituelle (épée runique).

| id | Nom | Type | Effet | x, y | Relié à |
|---|---|---|---|---|---|
| `ma_estocade` | **Estocade** | Compétence | Débloque Estocade. Racine du Maître d’armes. | -334, 749 | `g_coup_puissant` |
| `ma_estocade_double` | **Estocade double** | Variante<br>groupe `estocade_forme` | Deux estocs rapides ×1,0 au lieu d’un seul ×1,6 ; poise 25 → 2×15.<br>*Visuel : Deux lignes de lumière blanche parallèles et fines.* | -400, 716 | `ma_estocade` |
| `ma_fente_foudroyante` | **Fente foudroyante** | Variante<br>groupe `estocade_forme` | Portée 4 → 6 m, critique +10 % → +25 % ; recharge 7 → 9 s.<br>*Visuel : Image rémanente du guerrier le long de la fente, éclair doré à la pointe.* | -438, 803 | `ma_estocade` |
| `ma_precision` | **Précision** | Passif (3 rangs) | +2 % de chances de critique par rang. | -372, 836 | `ma_estocade` |
| `ma_velocite` | **Vélocité** | Passif (3 rangs) | +4 % de vitesse d’attaque par rang (recharge de la Frappe). | -265, 776 | `ma_estocade` |
| `ma_cadence` | **Cadence** | Compétence | Ouvre les variantes de rythme de la Frappe (voir ci-dessous) et +5 % de dégâts de la Frappe. | -303, 863 | `ma_velocite` |
| `ma_troisieme_temps` | **Troisième temps** | Variante<br>groupe `frappe_cadence` | Chaque 3ᵉ Frappe enchaînée en 2 s inflige ×1,8 et 30 de poise.<br>*Visuel : 3ᵉ coup : grande taille horizontale avec un éclat argenté et un son de cloche.* | -272, 973 | `ma_cadence` |
| `ma_taille_pointe` | **Taille et pointe** | Variante<br>groupe `frappe_cadence` | La Frappe alterne taille et estoc : l’estoc a +0,8 m de portée et +15 % de critique.<br>*Visuel : Alternance de traînées en arc et de fines lignes droites.* | -342, 950 | `ma_cadence` |
| `ma_danse` | **Danse des lames** | Compétence | Débloque Danse des lames. | -411, 923 | `ma_precision`, `ma_cadence` |
| `ma_tempete_acier` | **Tempête d’acier** | Variante<br>groupe `danse_forme` | 5 coups ×0,6 au lieu de 3 ×0,9 ; endurance 20 → 26.<br>*Visuel : Multitude de traînées fines et blanches, étincelles continues.* | -449, 1009 | `ma_danse` |
| `ma_lame_finale` | **Lame finale** | Variante<br>groupe `danse_forme` | Le 3ᵉ coup inflige ×1,8 et 40 de poise.<br>*Visuel : Dernier coup : large croissant doré qui reste 0,3 s dans l’air.* | -381, 1037 | `ma_danse` |
| `ma_brise_garde` | **Brise-garde** | Compétence | Débloque Brise-garde. | -477, 890 | `ma_precision`, `ma_fente_foudroyante` |
| `ma_point_faible` | **Point faible** | Variante<br>groupe `brise_garde_forme` | La cible subit en plus +15 % de chances de critique de toutes les sources pendant 6 s.<br>*Visuel : Marque lumineuse en losange sur la cible, qui clignote.* | -580, 940 | `ma_brise_garde` |
| `ma_coup_de_taille` | **Coup de taille** | Variante<br>groupe `brise_garde_forme` | Frappe un arc de 120° (plusieurs cibles) ; poise 70 → 50.<br>*Visuel : Grand arc gris acier, éclats de métal projetés.* | -516, 977 | `ma_brise_garde` |
| `ma_maitrise_rapiere` | **Maîtrise de la rapière** | Passif | Rapière : +8 % de critique ; Estocade +1 m de portée. | -350, 1148 | `ma_lame_finale`, `ma_troisieme_temps` |
| `ma_coup_critique` | **Coups mortels** | Passif (3 rangs) | +10 % de dégâts critiques par rang. | -420, 1124 | `ma_lame_finale`, `ma_tempete_acier` |
| `ma_elan` | **Élan** | Passif | Chaque coup porté dans les 2 s du précédent : +2 % de dégâts (5 cumuls). | -488, 1096 | `ma_tempete_acier`, `ma_coup_de_taille` |
| `ma_maitrise_cimeterre` | **Maîtrise du cimeterre** | Passif | Cimeterre : les critiques font saigner (40 % de l’attaque sur 4 s). | -555, 1064 | `ma_point_faible`, `ma_coup_de_taille` |
| `ma_pas_de_lame` | **Pas de lame** | Compétence | Débloque Pas de lame. | -527, 1183 | `ma_elan`, `ma_coup_critique`, `ma_maitrise_cimeterre` |
| `ma_pas_fantome` | **Pas fantôme** | Variante<br>groupe `pas_forme` | Ne coûte plus d’endurance ; recharge 6 → 10 s.<br>*Visuel : Silhouette translucide laissée à la position de départ, qui se dissipe.* | -497, 1298 | `ma_pas_de_lame` |
| `ma_pas_tranchant` | **Pas tranchant** | Variante<br>groupe `pas_forme` | Inflige ×0,8 aux ennemis traversés ; distance 3 → 4 m.<br>*Visuel : Ligne de coupe horizontale sur le trajet, étincelles.* | -632, 1238 | `ma_pas_de_lame` |
| `ma_maitrise_courbe` | **Maîtrise de la lame courbe** | Passif | Lame courbe : Frappe −10 % de recharge, Danse des lames +1 coup. | -458, 1211 | `ma_coup_critique`, `ma_maitrise_rapiere` |
| `ma_jeu_jambes` | **Jeu de jambes** | Passif | Une roulade dans les 1,5 s après avoir touché coûte 20 % d’endurance en moins. | -593, 1151 | `ma_maitrise_cimeterre` |
| `ma_lecture` | **Lecture du combat** | Passif | Les coups critiques infligent +25 % de poise. | -565, 1270 | `ma_pas_de_lame` |
| `ma_ks_duelliste` | **Duelliste** | Clé de voûte | Si un seul ennemi est à moins de 8 m : +20 % de dégâts et +10 % de critique. CONTREPARTIE : −20 % de dégâts dès que 3 ennemis ou plus sont à moins de 8 m. | -536, 1385 | `ma_lecture` |
| `ma_ks_coups_mesures` | **Coups mesurés** | Clé de voûte | Chaque 4ᵉ coup est un critique garanti avec +50 % de dégâts critiques. CONTREPARTIE : vos autres coups ne sont jamais critiques. | -671, 1325 | `ma_lecture` |

## 8. Passerelle Guerrier ↔ Mage : **Lame spirituelle** (13 nœuds)

Fantaisie : le chevalier-mage qui grave des runes sur sa lame. Coût **1 point pour un Guerrier ou un Mage**, 2 pour un Rôdeur (sa clé de voûte : 3). Les capacités de la passerelle sont de classe `hybrid_gm` : **pas d’Inaptitude** pour Guerrier et Mage, Inaptitude pleine pour le Rôdeur. Elles demandent une **arme de mêlée** (Lame enchantée, Onde tranchante) : un Mage qui les veut doit s’équiper d’une épée — l’épée runique lui sert alors aussi de focus (voir Maîtrise de l’épée runique).

- Entrée côté Guerrier : `pg_flux_martial`, relié à **Brise-garde** (`ma_brise_garde`, Maître d’armes) → 6 points depuis le départ.
- Entrée côté Mage : `pg_egide` (**Égide runique**, compétence défensive utile au Mage), avec un lien externe *mage:pont_gm_entree* que le brouillon Mage doit placer vers (−1 000, 200) environ (angle ~170°, rayon ~1 000).

| id | Nom | Type | Effet | x, y | Relié à |
|---|---|---|---|---|---|
| `pg_flux_martial` | **Flux martial** | Passif | Chaque coup de mêlée qui touche rend 1 point de mana (au plus 4 par seconde). | -611, 633 | `ma_brise_garde` |
| `pg_lame_enchantee` | **Lame enchantée** | Compétence | Débloque Lame enchantée. | -762, 617 | `pg_flux_martial` |
| `pg_lame_ardente` | **Lame ardente** | Variante<br>groupe `lame_enchantee_element` | Élément feu : les coups brûlent (20 % de l’attaque sur 3 s, 3 cumuls).<br>*Visuel : Flammes orange léchant le tranchant, braises à chaque taille.* | -794, 740 | `pg_lame_enchantee` |
| `pg_lame_givre` | **Lame de givre** | Variante<br>groupe `lame_enchantee_element` | Élément givre : chaque coup ralentit de 10 % pendant 3 s (2 cumuls, 20 %).<br>*Visuel : Givre cristallin sur la lame, éclats de glace et buée bleue à l’impact.* | -884, 654 | `pg_lame_enchantee` |
| `pg_lame_arcanique` | **Lame arcanique** | Variante<br>groupe `lame_enchantee_element` | Élément arcane : bonus 35 % → 25 %, mais chaque coup rend 2 mana.<br>*Visuel : Runes violettes qui glissent le long de la lame, étincelles violettes.* | -931, 537 | `pg_lame_enchantee` |
| `pg_onde_tranchante` | **Onde tranchante** | Compétence | Débloque Onde tranchante. | -745, 430 | `pg_flux_martial` |
| `pg_croissant` | **Croissant de lune** | Variante<br>groupe `onde_forme` | Onde en cône de 90° sur 7 m qui touche tout ; puissance 1,3 → 1,1.<br>*Visuel : Croissant bleu pâle qui s’élargit en avançant.* | -627, 464 | `pg_onde_tranchante` |
| `pg_lance_spectrale` | **Lance spectrale** | Variante<br>groupe `onde_forme` | Portée 10 → 16 m, puissance 1,3 → 1,6 ; recharge 8 → 12 s.<br>*Visuel : Longue lame fantôme violette et fine, traînée de particules.* | -695, 331 | `pg_onde_tranchante` |
| `pg_maitrise_runique` | **Maîtrise de l’épée runique** | Passif | Épée runique : +10 % de dégâts élémentaires, et elle sert de focus sans pénalité aux sorts (au lieu de −20 %). | -978, 660 | `pg_lame_arcanique`, `pg_lame_givre`, `pg_lame_ardente` |
| `pg_egide` | **Égide runique** | Compétence | Débloque Égide runique. | -896, 344 | `pg_onde_tranchante`, `pg_lame_arcanique`, *mage:pont_gm_entree* |
| `pg_egide_renvoi` | **Égide éclatante** | Variante<br>groupe `egide_forme` | Quand le bouclier se brise, il explose : ×1,2 de dégâts arcaniques dans un rayon de 4 m.<br>*Visuel : Sphère de runes qui se fissure puis éclate en éclats violets.* | -1014, 310 | `pg_egide` |
| `pg_egide_mana` | **Égide du savant** | Variante<br>groupe `egide_forme` | Absorbe 12 % PV + 25 % mana → 40 % du mana max, et rend 20 % des dégâts absorbés en mana.<br>*Visuel : Sphère bleue translucide, les coups reçus y laissent des ondulations.* | -873, 218 | `pg_egide` |
| `pg_ks_serment` | **Serment de la lame spirituelle** | Clé de voûte | La pénalité d’Inaptitude des compétences de Guerrier ET de Mage est divisée par deux. CONTREPARTIE : −10 % de PV max et −10 % de mana max. | -1094, 442 | `pg_maitrise_runique`, `pg_egide_renvoi` |

## 9. Clés de voûte

| id | Nom | Effet et contrepartie | Coût Guerrier | Coût autre classe |
|---|---|---|---|---|
| `gd_ks_mur_vivant` | **Mur vivant** | Avec un bouclier, la Garde bloque 100 % des dégâts frontaux (85 % contre un boss). CONTREPARTIE : coups bloqués +30 % d’endurance, sprint impossible, roulade −40 % de distance. | 1 | 3 |
| `gd_ks_serment` | **Serment du protecteur** | 20 % des dégâts subis par les membres du groupe à moins de 8 m sont redirigés vers vous ; +20 % de défense. CONTREPARTIE : −15 % de dégâts infligés. | 1 | 3 |
| `bk_ks_rasoir` | **Au fil du rasoir** | +3 % de dégâts par tranche de 10 % de PV manquants (max +27 %) et +3 % de vol de vie. CONTREPARTIE : soins reçus −30 % et plus de régénération de PV hors combat. | 1 | 3 |
| `bk_ks_dechaine` | **Déchaîné** | +20 % de dégâts et +15 % de vitesse d’attaque. CONTREPARTIE : la Garde est impossible (ni blocage ni parade) et −10 % de défense. | 1 | 3 |
| `ma_ks_duelliste` | **Duelliste** | Si un seul ennemi est à moins de 8 m : +20 % de dégâts et +10 % de critique. CONTREPARTIE : −20 % de dégâts dès que 3 ennemis ou plus sont à moins de 8 m. | 1 | 3 |
| `ma_ks_coups_mesures` | **Coups mesurés** | Chaque 4ᵉ coup est un critique garanti avec +50 % de dégâts critiques. CONTREPARTIE : vos autres coups ne sont jamais critiques. | 1 | 3 |
| `pg_ks_serment` | **Serment de la lame spirituelle** | La pénalité d’Inaptitude des compétences de Guerrier ET de Mage est divisée par deux. CONTREPARTIE : −10 % de PV max et −10 % de mana max. | 1 | 1 (Mage) / 3 (Rôdeur) |

Chaque clé de voûte est au bout de sa branche (9 points depuis le départ, soit **au plus tôt vers le niveau 11** avec les 3 Fondamentaux obligatoires) et **les deux clés d’une même branche sont reliées au même nœud** : on peut prendre les deux, mais elles se contredisent volontairement (Mur vivant ↔ Serment : défense solo contre défense de groupe ; Au fil du rasoir ↔ Déchaîné ; Duelliste ↔ Coups mesurés se cumulent mais Duelliste pénalise les combats de meute).

## 10. Familles d’épées (synergies)

| Famille | Profil suggéré | Nœud(s) qui en profitent |
|---|---|---|
| Épée courte | 1 main, +15 % de vitesse, −0,3 m, +3 % crit., poise ×0,8, bouclier | Épée et bouclier (`gd_maitrise_courte`) |
| Épée longue | 1 main, référence | Épée et bouclier, Maîtrise de l’épée longue (`gd_maitrise_longue`) |
| Épée bâtarde | 1 ou 2 mains ; à 2 mains +12 % dégâts, poise ×1,2 | Maîtrise de la bâtarde (`bk_maitrise_batarde`) |
| Rapière | 1 main, −10 % dégâts, +0,4 m, +8 % crit., poise ×0,6 | Maîtrise de la rapière (`ma_maitrise_rapiere`), Taille et pointe |
| Cimeterre | 1 main, +8 % vitesse, +4 % crit., 5 % de saigner | Maîtrise du cimeterre (`ma_maitrise_cimeterre`), Frappe saignante |
| Lame courbe | 2 mains, +5 % dégâts, +5 % vitesse, +5 % crit. | Maîtrise de la lame courbe (`ma_maitrise_courbe`) |
| Espadon | 2 mains, +30 % dégâts, −25 % vitesse, +0,6 m, poise ×1,6, +30 % endurance des attaques | Maîtrise de l’espadon (`bk_maitrise_espadon`), Coup fendoir, Décapitation |
| Épée runique | 1 main, +10 % élémentaire, +15 mana, focus à −10 % | Maîtrise de l’épée runique (`pg_maitrise_runique`), Lame enchantée |

Les profils sont des **suggestions** pour `OBJETS_ARTISANAT.md`, qui fait foi. Chaque famille a **au moins un nœud** qui la rend intéressante, sans qu’aucun nœud n’interdise les autres armes (les maîtrises sont de simples passifs conditionnels).

## 11. Parcours types (Guerrier pur)

Points disponibles : niv. 5 = **5**, niv. 15 = **17**, niv. 30 = **35** (dont 5 Fondamentaux).

| Build | Niveau 5 (5 pts) | Niveau 15 (17 pts) | Niveau 30 (35 pts) |
|---|---|---|---|
| **Rempart** (Gardien) | Roulade, Garde, Sprint · Coup puissant · Cri de guerre | + Saut, Attaque chargée · Garde de fer ×2, Coup de bouclier (Bouclier écrasant), Riposte (Riposte vengeresse), Épée et bouclier, Peau de pierre · Cri d’effroi + 1 point libre | + Peau de pierre ×3, Bastion (Bastion épineux), Inébranlable, **Mur vivant**, Maîtrise de l’épée longue, Constitution ×3, Provocation (Défi) + ~6 nœuds de Survie |
| **Boucher** (Berserker) | Roulade, Sprint, Saut · Coup puissant · Tourbillon | + Garde, Attaque chargée · Frappe saignante, Tourbillon sanglant, Soif ×2, Entaille (Hémorragie), Plaies béantes ×2, Rage (Frénésie) | + Soif ×3, Fureur montante, Exécution (Couperet), Briseur d’os, **Au fil du rasoir**, Maîtrise de l’espadon, Bond fracassant (Onde de choc), Chair ×2 + Survie |
| **Bretteur** (Maître d’armes) | Roulade, Sprint, Garde · Coup puissant · Estocade | + Saut, Attaque chargée · Frappe éclair, Vélocité ×2, Cadence (Troisième temps), Précision ×2, Danse des lames (Lame finale), Coups mortels | + Coups mortels ×3, Brise-garde (Point faible), Élan, Maîtrise de la rapière, Pas de lame (Pas tranchant), Lecture du combat, **Coups mesurés** + Survie |

À niveau 5, les trois builds ont 2 capacités actives en plus de la Frappe — comme un Guerrier de la v0.2 au niveau 1–4, qui en avait 4 : la montée en puissance est plus lente au début, c’est voulu (on apprend d’abord à rouler et à bloquer).

## 12. Équilibrage

- **Référence** : la simulation `tests/balance/sim.mjs` (docs/EQUILIBRAGE.md, branche combat-souls). Cible inchangée : à niveaux 5 / 15 / 30, les trois classes pures à **±15 %** d’XP/min, et un boss solo faisable mais punitif.
- **Budget de dégâts** : additionner tous les bonus `dmgPct` de l’arbre dans **une seule enveloppe additive** (pas de multiplication entre passifs). Un Berserker de niveau 30 cumule au mieux ~+60 % hors Rage (Carnage 9, Plaies 30 sur le saignement seulement, Fureur 15, Briseur 15 conditionnel, clé de voûte ≤ 27) — à comparer aux +X % des arbres Mage/Rôdeur. Proposition : **plafond de +75 % de dégâts issus de l’arbre**, affiché dans la fiche de personnage.
- **Défense** : Peau de pierre ×3 (+15 %), Constitution ×3 (+12 % PV), Bastion, Mur vivant. Mur vivant bloque tout de face, mais chaque coup bloqué coûte de l’endurance (+30 %) : sous un enchaînement du golem (séisme → onde de choc en anneau, qui arrive de partout), le Gardien doit **encore rouler** — et sa roulade fait 3 m au lieu de 5.
- **Pas d’endurance infinie** : aucun nœud ne réduit le coût de la roulade de plus de 20 % (Jeu de jambes, conditionnel) ; Souffle de vétéran donne au plus +15 d’endurance max ; Pas fantôme (0 endurance) est limité par ses 10 s de recharge.
- **Pas d’invulnérabilité** : Bastion −40 % au mieux, Égide runique se brise, Pas de lame sans i-frames, Bond fracassant « aérien » seulement contre les ondes au sol.
- **Vol de vie** : 6 % (Soif) + 3 % (Rasoir) = 9 % de la mêlée au maximum, contrebalancé par −30 % de soins reçus avec Au fil du rasoir.
- **Contrôle** : étourdissements et interruptions uniquement sur les **non-boss** ; sur un boss, ils ne font que de la poise.

## 13. Hybrides : quand un Mage ou un Rôdeur vient chercher l’acier

- **Mage** qui veut Coup puissant : `g_coup_puissant` coûte **2 points**, subit l’Inaptitude (puissance 2,8 → 2,1, 15 mana au lieu de 12, 20 d’endurance au lieu de 16, recharge 7,2 s) et demande une arme de mêlée. Plus intéressant pour lui : la **Lame spirituelle** à 1 point, entrée par l’Égide runique.
- **Chemin d’accès** : un Mage atteint la région Guerrier soit par la passerelle (Égide → Onde → Flux martial → Brise-garde, à 2 points chacun une fois dans la région), soit par Survie → `survie:porte_guerrier` → `g_depart`. **Proposition** : `g_depart` n’est alloué gratuitement que pour le Guerrier ; pour les autres classes il coûte 2 points et donne l’accès à la Frappe (attaque de base du Guerrier, avec Inaptitude).
- **Rôdeur** : la région Guerrier est à 2 points, la Lame spirituelle aussi ; la future passerelle Chasseur (Rôdeur↔Guerrier) doit se raccrocher au **Berserker** vers `bk_tourbillon_sanglant` / `bk_entaille_profonde` (saignement, chasse) — c’est le point le plus à droite de la région (x ≈ 400–620, y ≈ 715–1 030).
- **Garde-fou** : un hybride Guerrier/Mage de niveau 30 avec Serment de la lame spirituelle a −10 % de PV **et** de mana et une Inaptitude réduite de moitié seulement ; il paie donc toujours ses sorts ~12 % plus cher. Il doit être amusant (Lame enchantée + Boule de feu), pas meilleur qu’un pur.

## 14. Migration des Guerriers de la v0.2

1. À la mise à jour, chaque Guerrier existant reçoit ses points (niveau − 1 + bonus tous les 5 niveaux), **Roulade et Sprint gratuits** (ils ne comptent pas dans les points), et une réinitialisation gratuite.
2. **Préréglage automatique** pour ne rien retirer au joueur : si ses points le permettent, le serveur alloue Garde (3ᵉ Fondamental, pour ouvrir la région), `g_coup_puissant`, `gd_cri` et `bk_tourbillon` — soit 4 points : il retrouve ses 4 capacités de la v0.2 dès le niveau 5. Le reste est libre.
3. Les raccourcis de la v0.2 (touches 1–4) sont réassignés aux mêmes capacités.

## 15. Questions ouvertes pour le synthétiseur

- Le nœud **Touche-à-tout** (réduction générale de l’Inaptitude) est attendu en Survie ; la Lame spirituelle a sa propre clé de voûte (Serment de la lame spirituelle) qui ne vaut que pour Guerrier/Mage. Vérifier qu’elles ne se cumulent pas au-delà de −75 % de pénalité.
- Valeurs de base de la **Garde** (réduction, endurance par coup bloqué, fenêtre de parade) : définies par le brouillon Survie ; les passifs Gardien sont exprimés en pourcentage de ces valeurs.
- **Nombre de nœuds** : 87 au lieu de ~70, surtout parce que chaque capacité a son groupe de variantes (38). On peut retirer Vélocité, Carnage et Souffle de vétéran (doublons de Survie) si l’arbre total est trop dense.
- `ma_cadence` est un nœud « compétence » sans nouvelle capacité (il porte le 2ᵉ groupe de variantes de la Frappe) : à garder comme type `skill` ou à passer en `passive` selon l’interface.
