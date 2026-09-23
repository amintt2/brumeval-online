# L'Arbre des Brumes — le centre : Fondamentaux et Survie

> Brouillon v0.3 (conception, rien n'est implémenté). Données : `docs/design/drafts/tree_survie.json`.
> Règles globales (points, coûts, validation, protocole, interface) : `docs/design/drafts/tree_rules.md`.
> Valeurs de départ reprises de la v0.2 (`shared/combat.js` et `docs/EQUILIBRAGE.md` sur `wave1/combat-souls`) :
> endurance 100, régénération 35/s après 0,8 s, roulade 30 / 5 m / 0,55 s / 0,35 s d'invulnérabilité / 0,6 s de recharge,
> sprint ×1,45 pour 18/s.

## 1. En bref

- Au **centre** de l'arbre commun se trouvent les **5 Fondamentaux**, que tout personnage apprend en premier :
  **Roulade, Sprint, Saut, Garde, Attaque chargée**. Chacun coûte 1 point. Ils s'apprennent **sans être reliés**
  au nœud de départ de la classe (ils sont rattachés au *Cœur des Brumes*, la racine toujours acquise).
- La région de sa classe (et le reste de la Survie) **s'ouvre après 3 Fondamentaux**, donc au niveau 4 pour un
  nouveau personnage (1 point par niveau à partir du niveau 2). On se spécialise ensuite.
- Autour, l'**anneau de Survie** (34 nœuds, **1 point pour tout le monde**) : améliorations et **variantes
  exclusives** de chaque Fondamental, endurance, vie, équilibre, résistances, potions, écho de mort, 3 clés de voûte
  et 3 **Seuils** qui mènent aux nœuds de départ des trois classes.
- Les personnages de la v0.2 reçoivent **Roulade et Sprint gratuitement** (ils les avaient déjà) : il leur suffit
  d'un Fondamental de plus pour ouvrir leur région.

Chaque Fondamental répond à une menace différente, pour que les choix soient lisibles :

| Menace | Réponse | Coût typique |
|---|---|---|
| Tout coup télégraphié ou projectile | **Roulade** (invulnérabilité) | 30 endurance |
| Onde de choc au sol, balayage bas (télégraphe « rasant », dessiné en ondes) | **Saut** | 15 endurance |
| Coups physiques de face, enchaînements rapides | **Garde** (et Parade en variante) | endurance selon le coup |
| Distance à combler, fuite, voyage | **Sprint** | 18/s |
| Ouverture après une attaque ennemie, posture à briser | **Attaque chargée** | +10 endurance |

## 2. Les Fondamentaux en détail

### 2.1 Roulade (`fond_roulade` → capacité `roulade`) — touche par défaut : Espace
Identique à la v0.2 (les joueurs connaissent déjà) :
- **30 endurance**, 5 m en 0,55 s, **invulnérable 0,35 s** dès le départ, 0,6 s entre deux roulades.
- Engagement total : direction fixée, aucune action pendant 0,55 s. Refusée sous 30 d'endurance.
- Les i-frames annulent tout coup **résolu** pendant la fenêtre : télégraphes (résolus à l'impact), projectiles
  (résolus à l'arrivée), coups légers. Même tolérance réseau que la v0.2 (`ROLL.graceMs`).
- Aucune protection contre le vacillement (voir §4) en dehors de la fenêtre d'invulnérabilité.
- Poids d'armure (conception objets) : les plaques pourront augmenter le coût (+15 % proposé) ; la variante *Roulade
  lourde* annule ce malus.
- Sans ce nœud (nouveau personnage niveau 1) : pas de roulade. On s'écarte des télégraphes en marchant (le bond du
  gluant laisse 0,95 s pour sortir d'un cercle de 2,2 m). La fenêtre de montée de niveau conseille la Roulade en premier.

### 2.2 Sprint (`fond_sprint` → `sprint`) — Maj maintenue
- Vitesse **×1,45**, **18 endurance/s** en mouvement, démarre au-dessus de 8 d'endurance. Utilisable en combat.
- La régénération d'endurance est suspendue pendant le sprint ; attaquer, garder, charger ou sauter coupe le sprint.
- Les attaques à distance restent impossibles en sprint (règle v0.2 : tir seulement sous 40 % de la vitesse).

### 2.3 Saut (`fond_saut` → `saut` + `attaque_sautee`) — nouveau, touche par défaut : C
- **15 endurance**, recharge 0,5 s. Décollage 0,05 s, **0,35 s en l'air**, réception 0,1 s à 50 % de vitesse.
  Hauteur visuelle 0,6 m. Direction et vitesse figées au décollage : on saute sur place ou dans sa course
  (≈ 2,3 m en marchant, ≈ 3,3 m en sprintant).
- **Aucune invulnérabilité.** En l'air, on évite **uniquement les attaques rasantes** : un télégraphe marqué `lo`
  (anneau d'onde de choc, balayage bas) qui se résout pendant qu'on est en l'air ne touche pas. Dans les données
  v0.2 : *golem_stomp* (anneau) et *golem_sweep* (balayage en cône) deviennent rasants. Nouveaux monstres v0.3
  concernés : balayage de queue du ver des sables, piétinement du géant de givre et du troll, charge du sanglier (à
  valider avec les concepteurs de monstres).
- Les télégraphes rasants sont dessinés différemment (anneaux d'ondes concentriques qui partent du centre) pour
  qu'on apprenne vite : « ondes au sol = on saute ».
- **Pas d'escalade** : le saut n'a aucune composante verticale côté serveur ; il ne franchit ni mur, ni clôture, ni
  falaise, et n'augmente pas `maxSpeedAt` (pas de faille pour l'anti-triche).
- Touché en l'air par un coup non rasant : dégâts normaux + vacillement 0,4 s à la réception.
- **Attaque sautée** : appuyer sur l'attaque de base en l'air.
  - Mêlée : le coup tombe à la réception, zone de 1,5 m, **×1,3 dégâts, ×1,5 poise**, +5 endurance (en plus du coût
    de l'attaque de base), récupération 0,3 s à 30 % de vitesse.
  - Distance (tir, trait de feu) : un seul projectile **×1,1** tiré au sommet du saut ; la distance horizontale du
    saut est alors **divisée par deux**. Le coût total (15 + 7 + 5 = 27 endurance) empêche le « kite aérien ».
  - Relance la recharge de l'attaque de base.

### 2.4 Garde (`fond_garde` → `garde`) — E maintenue
- Montée de garde 0,15 s ; bloque les coups **de face (120°)**. Déplacement à 55 % ; régénération d'endurance à 40 %.
- Réduction des dégâts selon ce que l'on tient : **bouclier 100 %**, **arme de mêlée 70 %**, autre (bâton, arc,
  mains nues) **50 %** (« garde de fortune »).
- Coût en endurance par coup bloqué : `min(60, 8 + 60 × dégâts bruts / PV max)`, **×1,5 pour un coup télégraphié**.
  Exemple : un coup de squelette de 30 dégâts bruts contre un guerrier niv. 10 (292 PV) → 8 + 6 = 14 endurance ;
  son coup lourd télégraphié (60 bruts) → (8 + 12) × 1,5 = 30.
- Bloque : mêlée, projectiles physiques, télégraphes cône / ligne / cercle de bond.
  Ne bloque **pas** : les rasants (`lo`, il faut sauter ou rouler), les **imblocables** (`nb` : séismes de boss,
  empoignades), les **sorts** (`mag` : malédiction de l'occultiste…) sauf avec *Égide arcanique*.
- À 0 d'endurance : **garde brisée**, vacillement 1 s, et la part non absorbée du coup passe.
- Un coup bloqué ne fait jamais vaciller. Impossible de lever la garde pendant la récupération d'une attaque.

### 2.5 Attaque chargée (`fond_charge` → `attaque_chargee`) — maintenir la touche de l'attaque de base
- Fonctionne avec **l'attaque de base de n'importe quelle classe** (Frappe, Trait de feu, Tir, et les attaques de
  base d'autres classes apprises). Déplacement à 40 % pendant la charge.
- Charge possible seulement si l'attaque de base est prête. Relâchée avant 0,4 s = attaque normale.
  Puissance de **×1,0 à ×1,8** entre 0,4 et **1,2 s** (linéaire), poise jusqu'à **×2**, +10 endurance.
  Pleine charge : éclat sur l'arme et **super-armure** pendant les 0,3 dernières secondes (pas de vacillement).
  Relâche automatique à 2 s. Récupération 0,5 s à 30 % de vitesse.
- Mêlée : +0,5 m de portée. Projectile : +30 % de vitesse, taille ×1,5.
- Touché pendant la charge hors super-armure : charge perdue (aucun coût).
- **Pourquoi ce n'est pas un gain de DPS** : la recharge de l'attaque de base repart au relâchement. Frappe
  automatique = ×1,2 toutes les 1,3 s (0,92 × atk/s) ; Frappe chargée = ×2,16 en 1,2 + 1,3 s (0,86 × atk/s). On
  gagne un gros coup au bon moment (fenêtre de punition, 24 de poise d'un coup pour la Frappe) et on le paie en
  endurance et en exposition.

## 3. L'anneau de Survie

### 3.1 Disposition (repère global : x à droite, y vers le haut ; l'interface inverse y)

- **Cœur des Brumes** (0, 0), racine non allouable.
- **Fondamentaux** en pentagone, rayon 110 : Garde 90° (vers le Guerrier), Attaque chargée 162°, Roulade 234°,
  Saut 306°, Sprint 18°.
- **Anneau intérieur**, rayon 200, fermé en boucle (10 nœuds) : un passif d'amélioration sur l'angle de chaque
  Fondamental, alterné avec un passif général (Souffle profond 54°, Vigueur 126°, Récupération 198°, Aplomb 270°,
  Peau de brume 342°).
- **Variantes exclusives**, rayon 300, en éventail (±14°) derrière le passif de leur Fondamental.
- **Couronne extérieure**, rayon 330–460 : soutien (potions, écho), Longue esquive, 3 clés de voûte et les 3
  **Seuils** (rayon 410, sur l'angle de chaque classe), reliés aux nœuds de départ `guerrier_depart` (0, 500),
  `mage_depart` (−433, −250) et `rodeur_depart` (433, −250).
- Écart minimal entre deux nœuds : 73 unités ; aucun nœud à moins de 52 unités d'un lien qui ne le concerne pas ;
  rayon maximal 460 (Touche-à-tout), toujours à ≥ 90 du nœud de départ le plus proche. Les passerelles commencent à 700.

```
                         guerrier_depart (0,500)
                                 |
                         Seuil de l'Acier (0,410)
              Alchimiste ---/         \--- Appel de l'écho --- Écho tenace
   Dernier souffle              Parade · Garde de fer · Égide
        Souffle profond ---- Bras solide ---- Vigueur
  Sprint variantes  \          Garde           /  Charge variantes
     Foulée légère -- Sprint     (Cœur)     Att. chargée -- Concentration
   Touche-à-tout      \ Saut           Roulade /
 Seuil des Bois -- Peau de brume        Récupération -- Seuil des Arcanes
      rodeur_depart   Jarret -- Aplomb -- Souplesse       mage_depart
            Plongeante · Envol  Longue esquive  Ombre · Lourde · Parfaite
                                Danseur des brumes
```

### 3.2 Liste des nœuds (tous à 1 point ; « rg » = rangs maximum)

**Fondamentaux** (sans adjacence, 1 point, pas de prérequis)

| id | Nom | Effet |
|---|---|---|
| `fond_roulade` | Roulade | débloque `roulade` — offert aux personnages v0.2 |
| `fond_sprint` | Sprint | débloque `sprint` — offert aux personnages v0.2 |
| `fond_saut` | Saut | débloque `saut` et `attaque_sautee` |
| `fond_garde` | Garde | débloque `garde` |
| `fond_charge` | Attaque chargée | débloque `attaque_chargee` |

**Passifs d'amélioration** (anneau intérieur, sur l'angle de leur Fondamental)

| id | Nom | rg | Effet par rang | Maximum |
|---|---|---|---|---|
| `sv_souplesse` | Souplesse | 3 | roulade −2 endurance | 30 → 24 |
| `sv_foulee` | Foulée légère | 3 | sprint −1,5 endurance/s | 18 → 13,5 |
| `sv_jarret` | Jarret d'acier | 2 | saut −3 endurance, réception −25 ms | 15 → 9, 100 → 50 ms |
| `sv_bras` | Bras solide | 3 | garde −6 % d'endurance par coup, +3 points de réduction (≤ 100 %) | −18 %, arme 79 % |
| `sv_concentration` | Concentration | 2 | temps de charge −10 % | 1,2 → 0,96 s |

**Passifs généraux**

| id | Nom | rg | Effet par rang | Maximum |
|---|---|---|---|---|
| `sv_souffle` | Souffle profond | 3 | +8 endurance maximale | 124 |
| `sv_vigueur` | Vigueur | 3 | +4 % PV maximum | +12 % |
| `sv_recuperation` | Récupération | 3 | +3 endurance/s ; au rang 3, régénération 0,15 s plus tôt | 44/s après 0,65 s |
| `sv_aplomb` | Aplomb | 3 | +10 Équilibre (§4) | 30 |
| `sv_peau` | Peau de brume | 3 | +4 % résistance feu, givre, arcanes, poison | +12 % |
| `sv_alchimiste` | Alchimiste de fortune | 2 | potions +15 % | +30 % |
| `sv_appel_echo` | Appel de l'écho | 1 | écho ramassé à 4 m (au lieu de 1,8), affiché sur la carte et la minicarte, visible à travers la brume | — |
| `sv_echo_tenace` | Écho tenace | 1 | mourir avant de récupérer son écho ne le détruit plus : l'ancien garde 50 % de son XP (2 échos max) | — |
| `sv_longue_esquive` | Longue esquive | 2 | +40 ms d'invulnérabilité (toutes variantes de roulade) | 350 → 430 ms |

**Seuils** (vers les régions de classe ; 1 point pour tout le monde, le nœud de départ derrière coûte 2 s'il n'est
pas celui de votre classe)

| id | Nom | Effet | Relié à |
|---|---|---|---|
| `sv_seuil_acier` | Seuil de l'Acier | +5 % PV max | Alchimiste, Appel de l'écho, `guerrier_depart` |
| `sv_seuil_arcanes` | Seuil des Arcanes | +6 % mana max | Récupération, `mage_depart` |
| `sv_seuil_bois` | Seuil des Bois | +2 % de critique | Peau de brume, Touche-à-tout, `rodeur_depart` |

### 3.3 Variantes (une seule par groupe exclusif ; changer = réinitialisation)

**Groupe `roulade_style` — la roulade elle-même** (derrière Souplesse)

| id | Nom | Changement exact | Intention visuelle (VFX) |
|---|---|---|---|
| `sv_pas_ombre` | Pas de l'ombre | Bond de **3 m en 0,15 s**, invulnérable **0,2 s**, **22** endurance, recharge 0,5 s, on peut agir après 0,25 s. | Le corps se dissout en brume noir-violet et réapparaît 3 m plus loin dans une bouffée de fumée ; silhouette fantôme 0,3 s au départ. Pas de clip Roll (fondu du matériau). |
| `sv_roulade_lourde` | Roulade lourde | **4 m en 0,65 s**, invulnérable 0,35 s à partir de 0,05 s, **34** endurance ; **+50 Équilibre** jusqu'à 0,4 s après la roulade ; ignore le malus de poids d'armure ; à l'arrivée, 15 de poise aux ennemis à 1,5 m (sans dégâts). | Roulade d'épaule lourde, anneau de poussière de 1,5 m et marque d'impact au sol à l'arrivée, léger tremblement de caméra. |
| `sv_esquive_parfaite` | Esquive parfaite | Roulade normale ; si un coup est annulé dans les **150 premières ms** : **+15 endurance** rendue et **Riposte** 1 s (prochaine compétence qui inflige des dégâts : ×1,5 et +20 poise). | Image rémanente dorée à l'endroit du coup, éclair de brume blanche, tintement cristallin ; l'arme luit d'or tant que la Riposte est active. |

**Groupe `sprint_style`** (derrière Foulée légère)

| id | Nom | Changement exact | VFX |
|---|---|---|---|
| `sv_elan` | Élan | Après 0,8 s de sprint, l'attaque de base devient un **Assaut** : bond de 3 m **vers la cible uniquement** puis coup ×1,4, +25 poise, +10 endurance, récupération 0,45 s. Fonctionne aussi pour une attaque de base à distance (le bond rapproche, il ne sert jamais à fuir). | Traînée de poussière pendant le sprint, bond avec stries de vitesse, impact en éventail d'étincelles. |
| `sv_course_feutree` | Course feutrée | Sprint **×1,35** (au lieu de ×1,45), consommation **−30 %** (12,6/s), les monstres vous remarquent à **60 %** de leur distance habituelle pendant le sprint. | Fine brume basse autour des pieds, plus de particules de pas. |
| `sv_course_vent` | Course du vent | **Hors combat** (5 s sans infliger ni subir de dégâts) : sprint **×1,65**. En combat : sprint normal. | Stries de vent blanches le long du corps, cape plaquée vers l'arrière (hors combat seulement). |

**Groupe `saut_style`** (derrière Jarret d'acier)

| id | Nom | Changement exact | VFX |
|---|---|---|---|
| `sv_frappe_plongeante` | Frappe plongeante | Attaque sautée **×1,7** (au lieu de ×1,3), zone **2,5 m**, poise **×2,5** ; à distance, le projectile explose sur 1,5 m ; réception 0,45 s à 20 % de vitesse. | Arc de lame vers le bas, fissure au sol de 2,5 m, anneau de poussière ; petite explosion pour un projectile. |
| `sv_envol` | Envol | **0,55 s** en l'air (au lieu de 0,35), distance ×1,4, réception 0,05 s, +3 endurance par saut. | Tourbillon d'air et de brume sous les pieds au décollage, légère traînée. |

**Groupe `garde_style`** (derrière Bras solide)

| id | Nom | Changement exact | VFX |
|---|---|---|---|
| `sv_parade` | Parade parfaite | Lever la garde dans les **180 ms** avant l'impact : **0 dégât, 0 endurance**, l'attaquant subit **60 de poise** (fait tituber gluants, loups, gobelins, squelettes ; 40 % de la jauge du golem) et **Riposte** 1,5 s (prochaine attaque de mêlée ×2,0, autre ×1,5). En échange, la garde normale monte en **0,25 s**. Parables : mêlée et télégraphes cône / ligne non `nb`, non `lo` ; projectiles seulement avec un bouclier. | Gerbe d'étincelles dorées et onde de choc circulaire au point de contact, « clang » métallique ; l'attaquant clignote et recule d'un pas. |
| `sv_garde_fer` | Garde de fer | Endurance par coup **−35 %**, réduction **+15 points** (arme 85 %, fortune 65 %, bouclier 100 %), déplacement en garde **35 %**. | Reflet gris acier sur l'arme ou le bouclier, posture plus basse, étincelles grises à chaque blocage. |
| `sv_egide` | Égide arcanique | La garde devient un **bouclier magique** : réduction **75 % de tout**, y compris les sorts (`mag`), sur **180°** ; endurance par coup −20 % et **6 mana** par coup bloqué (sans mana : garde normale). Ne bloque toujours ni `lo` ni `nb`. | Demi-dôme translucide bleu pâle couvert de runes hexagonales, qui se fissure et scintille à chaque impact. |

**Groupe `charge_style`** (derrière Concentration)

| id | Nom | Changement exact | VFX |
|---|---|---|---|
| `sv_charge_vive` | Charge vive | Pleine charge en **0,8 s**, puissance max **×1,55**, poise **×1,6**. | Trois pulsations lumineuses rapides sur l'arme. |
| `sv_charge_ecrasante` | Frappe écrasante | Pleine charge en **1,6 s**, **×2,2**, poise **×3**, récupération 0,7 s, super-armure sur les **0,5** dernières secondes. | Lueur rouge-or, air qui ondule de chaleur, fissures au sol à pleine charge, onde de choc à l'impact. |
| `sv_eventail` | Éventail | Mêlée : arc de **180°** ; distance : **3 projectiles** en éventail de 30°, chacun à 60 % de la puissance chargée ; poise par cible −40 %. | Arc d'étincelles en demi-cercle ; trois traînées lumineuses en éventail. |

### 3.4 Clés de voûte (1 point, niveau minimum)

| id | Nom | Niv. | Gain | Contrepartie |
|---|---|---|---|---|
| `ks_danseur` | Danseur des brumes | 10 | Roulades gratuites (toutes variantes) | Recharge de roulade **1,8 s** ; −25 endurance max. Plus de chaînes de roulades. |
| `ks_dernier_souffle` | Dernier souffle | 15 | Une fois toutes les 120 s, un coup mortel laisse à 1 PV + 0,6 s d'invulnérabilité + 30 endurance | −12 % PV max en permanence |
| `ks_touche_a_tout` | Touche-à-tout | 10 | Pénalités d'Inaptitude divisées par deux (−12,5 % puissance, +12,5 % coût, +10 % recharge) | −8 % de puissance pour les compétences de **votre** classe |

## 4. Nouveau : l'Équilibre du joueur et le vacillement

Les monstres ont une jauge de poise depuis la v0.2, mais pas les joueurs. Pour que « l'équilibre » ait un sens
(Aplomb, Roulade lourde, super-armure de l'Attaque chargée), on propose :

- Un coup **télégraphié** qui touche fait **vaciller** le joueur **0,4 s** (boss : 0,6 s) : pas d'attaque, de roulade
  ni de garde, mouvement à 0. Les coups légers ne font jamais vaciller (pas de blocage en chaîne injuste).
- **Équilibre** (stat `equilibre`, 0 par défaut) : durée × (1 − Équilibre / 100). Plafond permanent **60**
  (Aplomb 30 + objets : plaques, affixe « Équilibre »). Les bonus temporaires (Roulade lourde +50) peuvent dépasser
  le plafond ; **la super-armure** (fin de charge) annule le vacillement.
- FX `vacille { src, ms }` (clip Hit). Garde brisée : 1 s, sans réduction par l'Équilibre.

Si l'équipe combat refuse ce système, remplacer Aplomb par « −4 % de dégâts subis des attaques télégraphiées par rang »
et retirer l'Équilibre de la Roulade lourde (poise d'arrivée seulement).

## 5. Nouveaux marqueurs de télégraphes (proposition pour `S2C tele`)

| Marqueur | Sens | Réponse | Dessin au sol |
|---|---|---|---|
| (aucun) | coup physique normal | roulade, garde (parade si mêlée/cône/ligne) | décal rouge actuel |
| `lo: 1` | rasant (onde de choc, balayage bas) | **saut** ou roulade ; garde inutile | ondes concentriques qui partent du centre |
| `nb: 1` | imblocable (séisme, empoignade) | roulade uniquement (ou sortir de la zone) | bordure épaisse et crénelée |
| `mag: 1` | sort | roulade ; garde seulement avec Égide | teinte violette, runes |

Données v0.2 à marquer : `golem_stomp` → `lo`, `golem_sweep` → `lo`, `golem_quake` → `nb`, `skel_curse` → `mag`.

## 6. Parcours conseillés (35 points au niveau 30)

La Survie complète coûterait **50 points** : impossible de tout prendre, il faut choisir. Un personnage type y met
**5 Fondamentaux + 5 à 9 points**, et garde 20 à 25 points pour sa classe et les passerelles.

- **Guerrier « duelliste »** : niv. 2 Roulade, 3 Garde, 4 Attaque chargée → région Guerrier. Plus tard : Bras solide,
  **Parade parfaite**, Aplomb ×2, Frappe écrasante, Saut (pour le golem).
- **Mage** : Roulade, Sprint, Saut → région Mage. Plus tard : Souplesse, **Pas de l'ombre**, Récupération, Garde +
  **Égide arcanique** (se protège des sorts), Peau de brume.
- **Rôdeur** : Roulade, Sprint, Saut → région Rôdeur. Plus tard : **Esquive parfaite**, Longue esquive,
  Foulée légère + **Course feutrée**, Attaque chargée + **Éventail** (3 flèches).
- **Explorateur** : Sprint + **Course du vent**, Appel de l'écho, Écho tenace.

## 7. Équilibrage : garde-fous

- Invulnérabilité : au maximum 430 ms sur une roulade de 550 ms, et jamais plus de 75 % de la recharge — pas d'invulnérabilité permanente : chaque
  roulade coûte au moins 12 d'endurance (plancher, sauf *Danseur des brumes* qui la limite par une recharge de 1,8 s).
  Avec Souplesse ×3, Souffle profond ×3 et Récupération ×3 : 124 d'endurance, 44/s → 5 roulades de suite puis
  2,8 s à reconstituer : l'endurance reste le facteur limitant.
- Pas d'endurance infinie : régénération plafonnée à 55/s, délai minimal 0,5 s, sprint jamais sous 10/s.
- Kite limité : le tir reste interdit au-dessus de 40 % de la vitesse ; l'attaque sautée à distance divise la distance
  du saut par deux et coûte 27 d'endurance ; l'Assaut d'Élan ne rapproche que de la cible.
- Égalité des classes : les Fondamentaux sont identiques pour tous. La Garde avantage la mêlée, l'Égide la rend utile au
  mage ; Frappe plongeante, Éventail et Esquive parfaite servent aussi les classes à distance.
- À ajouter à `tests/balance/sim.mjs` : garde (blocage des coups légers, parade à 50 % de réussite), attaque chargée
  sur les fenêtres de récupération des monstres, saut sur les rasants du golem ; rejouer les niveaux 5, 15 et 30 avec
  les parcours ci-dessus.

## 8. Questions ouvertes

1. Touches par défaut du Saut (C) et de la Garde (E maintenue) : à confirmer (le clic droit sert déjà à cibler et
   attaquer).
2. Vacillement du joueur (§4) : nouveau système à valider par l'équipe combat.
3. *Dernier souffle* en JcJ (zones rouges, duels) : désactivé ou recharge doublée ?
4. Nouveau personnage niveau 1 sans roulade : acceptable (les monstres niv. 1–2 laissent le temps de marcher hors
   des cercles), ou offrir une « Esquive d'appoint » (pas de côté de 1,5 m sans invulnérabilité) ?
