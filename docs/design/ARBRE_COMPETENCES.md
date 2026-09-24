# L'Arbre des Brumes — arbre de compétences v0.3

> ⚠️ **Décisions du 23/09 prioritaires** : voir [`DECISIONS.md`](DECISIONS.md) (pas de roulade au niveau 1, marché intelligent à prix libres, **pas de réinitialisation : Renaissance au niveau 30**).


> **Document final de conception** (synthèse des six brouillons de `docs/design/drafts/`, gardés en annexe).
> Données : `docs/design/skilltree.json` (un seul fichier : règles, capacités, 318 nœuds, clés de voûte, statuts).
> Outils : `node docs/design/tools/build_tree.mjs` (fusion des brouillons), `validate.mjs` (références, liens,
> coordonnées), `balance.mjs` (équilibrage rapide), `gen_docs.mjs` (ce document). **Toutes les tables sont générées
> depuis le JSON** : en cas de doute, le JSON fait foi.
> Répond aux retours des joueurs (ROADMAP §1 et §2 bis) : « un très grand arbre où l'on choisit où mettre ses points »,
> « une seule compétence au départ », « des variantes qui changent toutes les compétences, même l'attaque de base »,
> « des compétences de base que tout le monde apprend, comme sprint ou saut, puis on se spécialise », « un mage peut
> apprendre des compétences de guerrier, avec des pénalités et plus cher », « n'importe quelle touche pour n'importe
> quelle compétence », « simple et accessible ».

## 1. En bref (pour les joueurs)

- **Au niveau 1, vous n'avez que l'attaque de base de votre classe** : la Frappe (Guerrier), le Trait arcanique (Mage)
  ou le Tir (Rôdeur). À chaque niveau, vous gagnez **1 point** (plus 1 point bonus aux niveaux 5, 10, 15, 20, 25 et 30),
  soit **35 points au niveau 30**. Vous les placez **où vous voulez**.
- **D'abord les Fondamentaux**, au cœur de l'arbre, que tout le monde apprend : **Roulade, Sprint, Saut, Garde,
  Attaque chargée** (1 point chacun). Dès que vous en connaissez **3**, la région de votre classe s'ouvre et vous vous
  spécialisez.
- **Perdu ? Suivez le parcours conseillé** : jusqu'au niveau 10, chaque montée de niveau propose le prochain nœud
  (Roulade d'abord), en un clic (§3.2). Rien n'est définitif avant le niveau 10.
- **Un seul grand arbre pour tout le monde** : au centre la **Survie**, autour les régions **Guerrier** (en haut),
  **Mage** (en bas à gauche) et **Rôdeur** (en bas à droite), et entre elles trois **passerelles** hybrides :
  **Lame spirituelle** (Guerrier ↔ Mage), **Arcaniste sylvestre** (Mage ↔ Rôdeur), **Chasseur** (Rôdeur ↔ Guerrier).
- **Vous pouvez aller partout.** Mais hors de votre classe, vous n'avez « pas de don pour ça » : les nœuds coûtent
  **2 points** au lieu d'un (3 pour une clé de voûte) et ses compétences subissent l'**Inaptitude** : −25 % de
  puissance, +25 % de coût, +20 % de recharge. Plus besoin de refaire un personnage pour essayer autre chose (on garde
  quand même plusieurs personnages par compte).
- **Quatre sortes de nœuds** : les **compétences** (une nouvelle capacité), les **variantes** (elles transforment une
  capacité ; une seule par groupe, et **toutes** les capacités en ont, même l'attaque de base et la roulade), les
  **passifs** (petits bonus, parfois en 2 ou 3 rangs) et les **clés de voûte** (gros effet avec une vraie contrepartie).
- **Toutes les touches se changent** : barre de 8 emplacements, glisser-déposer depuis le livre de compétences (K),
  et Options › Touches.
- **Réinitialisation gratuite jusqu'au niveau 10**, puis contre de l'or chez le Maître des arts. Les personnages de la
  v0.2 gardent la roulade et le sprint et retrouvent automatiquement leurs 4 compétences.

## 2. Chiffres clés

| | |
|---|---|
| Nœuds | **318** : 63 compétences, 146 variantes, 85 passifs, 23 clés de voûte (+ la racine) |
| Par zone | Survie 40 (Cœur + 5 Fondamentaux + 34 nœuds d'anneau) · Guerrier 87, Mage 75, Rôdeur 77 · passerelles Lame spirituelle 13, Arcaniste sylvestre 12, Chasseur 14 |
| Capacités | **65** : 7 de Survie, 16 Guerrier, 16 Mage, 17 Rôdeur, 9 de passerelle ; les 12 capacités de la v0.2 gardent leur id |
| Groupes de variantes exclusives | **66** (chaque capacité en a au moins un) |
| Clés de voûte | **23** |
| Points au niveau 30 | 35 ; acheter tout l'arbre coûterait 606 (Guerrier) à 625 points (Rôdeur) : un personnage en prend environ un dixième |
| Capacités v0.2 depuis le départ | Guerrier : Coup puissant 1 pt, Tourbillon 2 pts, Cri de guerre 2 pts · Mage : Boule de feu 1 pt, Nova de givre 1 pt, Soin 1 pt · Rôdeur : Tir perçant 2 pts, Tir rapide 2 pts, Pluie de flèches 4 pts (hors Fondamentaux) |

## 3. Règles du système

### 3.1 Points

- `points(niveau) = (niveau − 1) + floor(niveau / 5)` ; niveau maximum **30** (`MAX_LEVEL` passe de 20 à 30).

| Niveau | 1 | 2 | 3 | 4 | 5 | 10 | 15 | 20 | 25 | 30 |
|---|---|---|---|---|---|---|---|---|---|---|
| Points | 0 | 1 | 2 | 3 | 5 | 11 | 17 | 23 | 29 | 35 |

- Rangs : certains passifs ont 2 ou 3 rangs ; chaque rang coûte le prix du nœud. Les points non dépensés se gardent.
- Ordre de grandeur d'un personnage de niveau 30 : Fondamentaux 5, Survie 5 à 9, sa région 18 à 25, le reste en
  passerelles ou chez une autre classe.

### 3.2 Porte des Fondamentaux

- Les 5 Fondamentaux sont reliés au **Cœur des Brumes** (racine toujours acquise) : ils s'apprennent sans lien avec le
  nœud de départ, dans n'importe quel ordre.
- **Tant qu'un personnage connaît moins de 3 Fondamentaux, il ne peut rien apprendre d'autre** (code d'erreur
  `tree_gate`, « Apprenez d'abord 3 Fondamentaux »). Un nouveau personnage apprend donc 3 Fondamentaux aux niveaux 2,
  3 et 4, puis se spécialise.
- Racines de connexité : le Cœur + le nœud de départ de sa classe. Tout autre nœud doit être relié à un nœud acquis.
- **Niveau 1 sans roulade** (décision) : le niveau 2 arrive après ~4 Gluants (100 XP), monstres passifs de la zone de
  départ ; la fenêtre de montée de niveau propose la Roulade en premier. Pas d'« esquive d'appoint ».

#### Parcours conseillé (niveaux 2 à 10, `rules.guide`)

À chaque montée de niveau jusqu'au niveau 10, la fenêtre propose le prochain nœud du parcours conseillé de la classe (un clic : « Apprendre »). Le joueur peut toujours choisir autre chose ; le parcours reprend au nœud suivant encore libre. Pas de réinitialisation : chaque point est définitif jusqu'à la Renaissance (niveau 30).

| Niveau | Guerrier | Mage | Rôdeur |
|---|---|---|---|
| 2 | **Roulade** — Esquiver les coups télégraphiés. | **Roulade** — Esquiver les coups télégraphiés. | **Roulade** — Esquiver les coups télégraphiés. |
| 3 | **Garde** — Bloquer les coups de face. | **Sprint** — Garder ses distances. | **Sprint** — Garder ses distances. |
| 4 | **Sprint** — La région du Guerrier s’ouvre. | **Saut** — La région du Mage s’ouvre. | **Saut** — La région du Rôdeur s’ouvre. |
| 5 | **Coup puissant** + **Cri de guerre** — Un gros coup et un soin. | **Boule de feu** + **Soin** — Dégâts de zone et soin. | **Main sûre** + **Tir perçant** — Plus de dégâts et un tir qui traverse. |
| 6 | **Tourbillon** — Contre les groupes. | **Nova de givre** — Repousser ce qui vous colle. | **Tir rapide** — Une rafale de trois flèches. |
| 7 | **Attaque chargée** — Briser les postures. | **Trait de feu** — Le Trait arcanique devient Trait de feu. | **Attaque chargée** — Bander l’arc pour un gros tir. |
| 8 | **Saut** — Sauter les ondes de choc. | **Attaque chargée** — Un trait chargé pour briser les postures. | **Œil exercé** — Plus de critiques. |
| 9 | **Frappe éclair** — Première variante de la Frappe. | **Seuil des Arcanes** — Plus de mana. | **Pluie de flèches** — Une zone contre les groupes. |
| 10 | **Seuil de l'Acier** + **Alchimiste de fortune** — Plus de PV et des potions plus fortes. Ensuite : choisissez Gardien, Berserker ou Maître d’armes. | **Récupération** + **Souplesse** — Endurance. Ensuite : choisissez Pyromancie, Givre ou Arcanes. | **Seuil des Bois** + **Peau de brume** — Critique et résistances. Ensuite : choisissez Tireur, Traqueur ou Venin. |

### 3.3 Coûts : « pas de don pour ça »

| Nœud | Guerrier | Mage | Rôdeur |
|---|---|---|---|
| Survie | 1 | 1 | 1 |
| Guerrier | 1 | 2 | 2 |
| Mage | 2 | 1 | 2 |
| Rôdeur | 2 | 2 | 1 |
| Lame spirituelle | 1 | 1 | 2 |
| Arcaniste sylvestre | 2 | 1 | 1 |
| Chasseur | 1 | 2 | 1 |
| Clé de voûte d'une autre classe ou d'une passerelle non voisine | 3 | 3 | 3 |
| Nœud de départ d'une autre classe (donne son attaque de base, avec Inaptitude) | 2 | 2 | 2 |

Chaque nœud du JSON porte son coût pour les trois classes (`costs: { warrior, mage, ranger }`) ; la vérité reste la
fonction pure `nodeCost(node, cls)` (`docs/design/tools/lib/treelib.mjs`, à reprendre dans `shared/skills.js`).

### 3.4 Inaptitude

- Chaque capacité a une origine `home` : `'warrior'`, `'mage'`, `'ranger'`, deux classes pour une passerelle, ou
  `null` (Survie : jamais d'Inaptitude).
- Hors de son origine : **puissance −25 %**, **mana et endurance +25 %** (arrondi au-dessus), **recharge +20 %**.
  Icône « Inapte » orange sur la capacité et dans l'infobulle.
- **Réductions** (elles s'additionnent, plafond **0,6** : il reste toujours au moins 40 % de la pénalité) :
  - ks_touche_a_tout (0,5, toutes classes)
  - gm_ks_serment (0,33, capacités Guerrier et Mage)
  - ma_ks_erudit_martial (0,5, capacités Guerrier)
  - rg_frere_armes (0,15, Guerrier ↔ Rôdeur)
- **Attaque de référence** : Une capacité hors classe utilise min(attaque du personnage, attaque qu'aurait un personnage de sa classe d'origine au même niveau avec le même équipement). Sans cette règle, un mage (attaque de base plus
  forte à haut niveau) frapperait plus fort au Tourbillon qu'un guerrier.
- Exemple : un Mage de niveau 18 qui prend le Tourbillon (×1,9, 20 mana, 18 endurance, 10 s) le lance à **×1,43**,
  **25 mana**, **23 endurance**, **12 s**, avec l'attaque d'un guerrier du même niveau, et seulement avec une arme de
  mêlée en main. Avec le *Serment de la lame spirituelle* (réduction 0,33) : ×1,58, 24 mana, 22 endurance, 11,3 s.

### 3.5 Armes requises

| Exigence (`weapon`) | Il faut | Sinon |
|---|---|---|
| `melee` | arme portant l'étiquette « melee » et pas « focalisateur » (épées, haches, masses, lances, dagues) ; bâton et sceptre seulement avec la clé « Érudit martial » | grisée |
| `arc` | arme portant l'étiquette « distance » (arc court, arc long, arbalète) | grisée |
| `dague` | couteau de ceinture : toujours disponible avec une arme « distance » (dégâts de l’arme ×0,8) ou une arme de mêlée à une main | grisée |
| `focus` | focalisateur (bâton, sceptre) : pleine puissance ; épée runique ou grimoire en main gauche : −10 % | −20 % de puissance |
| `focus_ou_arc` | focalisateur ou arme « distance » | −20 % de puissance |
| `base` | l'arme de l'attaque de base utilisée | — |
| `null` | rien | — |

L'équipement n'est plus réservé à une classe (voir `OBJETS_ARTISANAT.md`) : c'est l'arme tenue qui débloque les
compétences d'arme. Un hybride doit donc s'équiper pour ses compétences (épée runique, grimoire, arc des astres…).

### 3.6 Garde-fous (appliqués par `resolveAbility`)

| Valeur | Borne |
|---|---|
| Bonus de dégâts de l'arbre (une seule enveloppe additive) | ≤ +75 % |
| Invulnérabilité de roulade | ≤ 450 ms et ≤ 75 % de sa recharge |
| Coût d'une roulade | ≥ 12 (sauf clé *Danseur des brumes*, limitée par sa recharge de 1,8 s) |
| Endurance max / régénération / délai | ≤ 180 / ≤ 55 par s / ≥ 0,5 s |
| Sprint | ≥ 10 endurance/s, ≤ ×1,65 |
| Réduction de recharge | ≤ 30 % |
| Garde à 100 % | seulement avec un bouclier et la clé *Mur vivant* (85 % contre un boss) |
| Équilibre permanent / résistances | ≤ 60 / ≤ 60 % |
| Vol de vie | ≤ 9 % des dégâts de mêlée |
| Tir en mouvement | toujours limité à 40 % de la vitesse (aucune variante ne le lève) |
| Contrôle | Gel, Enracinement, étourdissement : immunité 8 s ensuite, jamais sur un boss (seulement du déséquilibre) |

Formule de dégâts proposée pour la v0.3 : dégâts = atk × puissance × (0,85..1,15) × crit × K / (K + déf), K = 60 + 6 × max(0, niveau de l’attaquant − 10). Jusqu'au niveau 10 rien ne change par rapport à
la v0.2 ; au-delà, les armures T5–T6 ne rendent pas intouchable.

## 4. Structure et coordonnées

- **Un seul repère** : x vers la droite, y vers le HAUT ; angles trigonométriques depuis +x (Guerrier 90°, Mage 210°, Rôdeur 330°). L'interface affiche (x, −y).
- Survie : rayon 0 à 460. Départs de classe au rayon 500 : `guerrier_depart` (0, 500),
  `mage_depart` (−433, −250), `rodeur_depart` (433, −250). Régions jusqu'au rayon ~1 500, passerelles entre 700 et 1 250.

| Zone | Angles occupés | Rayons |
|---|---|---|
| Guerrier | 58° à 122° | 500 à 1485 |
| Lame spirituelle | 134° à 166° | 770 à 1180 |
| Mage | 170° à 247° | 464 à 1520 |
| Arcaniste sylvestre | 258° à 282° | 804 à 1190 |
| Rôdeur | 297° à 10° | 500 à 1480 |
| Chasseur | 15° à 40° | 790 à 1225 |

- Vérifié par `validate.mjs` : 363 liens tous réciproques, **0 croisement**, deux nœuds jamais à
  moins de 64 unités, aucun lien à moins de 35 unités d'un nœud qui ne le concerne pas,
  tous les nœuds joignables depuis les trois départs, et sur 2000 tirages aléatoires d'une option par groupe
  exclusif, **0** nœud rendu inaccessible : choisir une variante ne bloque jamais le chemin.

```
                               Gardien (90°)
               Maître d'armes     ║     Berserker
         Lame spirituelle   ╲     ║     ╱    Chasseur
          (Guerrier↔Mage)     Coup puissant      (Rôdeur↔Guerrier)
                                  ║
                       guerrier_depart (0, 500)
                                  ║
                         Seuil de l'Acier
           Pyromancie ─ Seuil des    [ Cœur des Brumes ]    Seuil des Bois ─ Traqueur
        Mage  Arcanes    Arcanes      5 Fondamentaux          Tireur    Rôdeur
           Givre    mage_depart     anneau de Survie     rodeur_depart   Venin
                              ╲                         ╱
                           Arcaniste sylvestre (Mage↔Rôdeur, 270°)
```

Jonctions entre brouillons (décidées à la synthèse) : Seuils de Survie ↔ nœuds de départ ; *Œil sylvestre*
(`mr_p_oeil_sylvestre`) ↔ *Cueilleur de brume* (`ro_ve_cueilleur`) ; *Onde tranchante* (`gm_onde_tranchante`) ↔
*Flamme attisée* (`ma_p_flamme_attisee`) ; *Dépeceur* (`rg_depeceur`) ↔ *Entaille* (`gu_be_entaille`).

## 5. Les Fondamentaux et la Survie

### 5.1 Les 5 Fondamentaux

Chaque Fondamental répond à une menace différente :

| Menace | Réponse | Coût |
|---|---|---|
| Coup télégraphié, projectile | **Roulade** (invulnérable 350 ms) | 30 endurance |
| Onde de choc au sol, balayage bas (télégraphe « rasant » `lo`, dessiné en ondes) | **Saut** (350 ms en l'air, sans invulnérabilité) | 15 endurance |
| Coups de face, enchaînements rapides | **Garde** (parade parfaite en variante) | endurance selon le coup |
| Distance à combler, fuite, voyage | **Sprint** (×1,45) | 18/s |
| Ouverture après une attaque ennemie, posture à briser | **Attaque chargée** (×1,0 → ×1,8, poise ×2) | +10 endurance |

- **Roulade** : identique à la v0.2 (30 endurance, 5 m en 0,55 s, 0,35 s d'invulnérabilité, 0,6 s entre deux).
- **Sprint** : identique à la v0.2 (×1,45, 18 endurance/s, utilisable en combat ; aucun tir en sprint).
- **Saut** (nouveau, touche C) : 15 endurance, décollage 0,05 s, **0,35 s en l'air**, réception 0,1 s à 50 %. En l'air,
  on évite **seulement** les attaques rasantes (`lo`). Pas d'escalade : le saut n'a aucune hauteur côté serveur et ne
  change pas la vitesse maximale surveillée par l'anti-triche. **Attaque sautée** : l'attaque de base en l'air ; en
  mêlée ×1,3 dégâts et ×1,5 poise en zone de 1,5 m à la réception ; à distance un seul projectile ×1,1 et la distance du
  saut est divisée par deux (pas de « kite aérien » : 27 d'endurance au total).
- **Garde** (E maintenue) : bloque de face (120°). Réduction : **bouclier = sa valeur de blocage (61 à 90 %)**, arme de
  mêlée 50 %, autre 30 % ; 100 % seulement avec la clé *Mur vivant*. Endurance par coup bloqué :
  `min(60, 8 + 60 × dégâts bruts / PV max)`, ×1,5 pour un coup télégraphié. Ne bloque ni les rasants (`lo`), ni les
  imblocables (`nb`), ni les sorts (`mag`) sauf avec la variante *Égide arcanique*. À 0 d'endurance : garde brisée.
- **Attaque chargée** : maintenir l'attaque de base (de n'importe quelle classe) 0,4 à 1,2 s : ×1,0 → ×1,8, poise
  jusqu'à ×2, +10 endurance, super-armure pendant les 0,3 dernières secondes. La recharge de l'attaque de base repart au
  relâchement : ce n'est **pas** un gain de DPS, c'est un gros coup au bon moment. L'arc se bande en 1 s et perce une
  cible à pleine charge.

### 5.2 Nouveaux marqueurs de télégraphes et vacillement du joueur

| Marqueur | Sens | Réponse | Dessin au sol |
|---|---|---|---|
| (aucun) | coup physique normal | roulade ou garde | décal rouge actuel |
| `lo` | rasant (onde, balayage bas) | **saut** ou roulade | ondes concentriques |
| `nb` | imblocable (séisme, empoignade) | roulade | bordure crénelée |
| `mag` | sort | roulade ; garde avec Égide | teinte violette, runes |

Données v0.2 à marquer : `golem_stomp` et `golem_sweep` → `lo`, `golem_quake` → `nb`, `skel_curse` → `mag`.
**Vacillement** : Nouveau : un coup télégraphié qui touche fait vaciller le joueur 0,4 s (boss 0,6 s) — ni attaque, ni roulade, ni garde. Durée × (1 − Équilibre / 100). Annule une incantation en cours. Garde brisée : 1 s.

### 5.3 L'anneau de Survie (40 nœuds, 1 point pour tout le monde)

#### Cœur (1 nœud)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `coeur` | Racine | **Cœur des Brumes** | Racine de l'arbre, toujours acquise. Les Fondamentaux s'y rattachent. | 1 | — | 0, 0 | `fond_garde` `fond_charge` `fond_roulade` `fond_saut` `fond_sprint` |

#### Fondamentaux (5 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `fond_garde` | Compétence | **Garde** | Débloque la Garde : bloquer de face au prix d'endurance. *(Fondamental)* | 1 | 1/1/1 | 0, 110 | `coeur` `sv_bras` |
| `fond_roulade` | Compétence | **Roulade** | Débloque la Roulade d'esquive. *(Fondamental · offert aux personnages v0.2)* | 1 | 1/1/1 | -65, -89 | `coeur` `sv_souplesse` |
| `fond_saut` | Compétence | **Saut** | Débloque le Saut et l'Attaque sautée. *(Fondamental)* | 1 | 1/1/1 | 65, -89 | `coeur` `sv_jarret` |
| `fond_charge` | Compétence | **Attaque chargée** | Débloque l'Attaque chargée : maintenir l'attaque de base. *(Fondamental)* | 1 | 1/1/1 | -105, 34 | `coeur` `sv_concentration` |
| `fond_sprint` | Compétence | **Sprint** | Débloque le Sprint. *(Fondamental · offert aux personnages v0.2)* | 1 | 1/1/1 | 105, 34 | `coeur` `sv_foulee` |

#### Sprint (4 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `sv_foulee` | Passif | **Foulée légère** | Le sprint consomme 1,5 endurance/s de moins par rang. | 3 | 1/1/1 | 190, 62 | `sv_peau` `sv_souffle` `fond_sprint` `sv_elan` `sv_course_feutree` `sv_course_vent` |
| `sv_course_vent` | Variante | **Course du vent** | Hors combat depuis 5 s, le sprint passe de ×1,45 à ×1,65 (voyage). En combat, sprint normal. *(groupe `sprint_style`)* | 1 | 1/1/1 | 254, 159 | `sv_foulee` |
| `sv_elan` | Variante | **Élan** | Après 0,8 s de sprint, l'attaque de base devient un Assaut : bond de 3 m vers la cible, ×1,4, +25 de déséquilibre, +10 d'endurance, récupération 0,45 s. *(groupe `sprint_style`)* | 1 | 1/1/1 | 299, 21 | `sv_foulee` |
| `sv_course_feutree` | Variante | **Course feutrée** | Sprint ×1,45 → ×1,35 mais −30 % d’endurance par seconde, et les monstres vous remarquent à 60 % de leur distance habituelle. *(groupe `sprint_style`)* | 1 | 1/1/1 | 285, 93 | `sv_foulee` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Course du vent* (`sv_course_vent`) : Stries de vent blanches le long du corps, cape et cheveux plaqués vers l'arrière (hors combat seulement).
- *Élan* (`sv_elan`) : Traînée de poussière derrière les pieds pendant le sprint, puis bond en avant avec stries de vitesse et impact en éventail d'étincelles.
- *Course feutrée* (`sv_course_feutree`) : Fine brume basse qui s'enroule autour des pieds ; plus aucune particule de pas.

#### Attaque chargée (4 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `sv_concentration` | Passif | **Concentration** | Temps de charge −10 % par rang. | 2 | 1/1/1 | -190, 62 | `sv_vigueur` `sv_recuperation` `fond_charge` `sv_charge_vive` `sv_charge_ecrasante` `sv_eventail` |
| `sv_charge_vive` | Variante | **Charge vive** | Attaque chargée pleine en 0,8 s au lieu de 1,2 s ; puissance max ×1,8 → ×1,55, déséquilibre max ×2 → ×1,6. *(groupe `charge_style`)* | 1 | 1/1/1 | -254, 159 | `sv_concentration` |
| `sv_eventail` | Variante | **Éventail** | Attaque chargée : arc de 180° en mêlée ; à distance, 3 projectiles en éventail de 30° (×0,6 de la charge chacun, un seul par ennemi) ; déséquilibre par cible −40 %. *(groupe `charge_style`)* | 1 | 1/1/1 | -299, 21 | `sv_concentration` |
| `sv_charge_ecrasante` | Variante | **Frappe écrasante** | Attaque chargée pleine en 1,6 s ; puissance max ×2,2, déséquilibre ×3, super-armure 0,5 s ; récupération 0,5 → 0,7 s. *(groupe `charge_style`)* | 1 | 1/1/1 | -285, 93 | `sv_concentration` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Charge vive* (`sv_charge_vive`) : Pulsations lumineuses rapides sur l'arme (3 éclats courts au lieu d'une montée lente).
- *Éventail* (`sv_eventail`) : Arc d'étincelles en demi-cercle devant le personnage ; à distance, trois traînées lumineuses en éventail.
- *Frappe écrasante* (`sv_charge_ecrasante`) : Lueur rouge-or profonde, air qui ondule de chaleur ; à pleine charge, fissures au sol autour des pieds ; impact avec onde de choc.

#### Endurance et corps (5 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `sv_recuperation` | Passif | **Récupération** | +3 endurance régénérée par seconde par rang ; au rang 3, la régénération reprend 0,15 s plus tôt. | 3 | 1/1/1 | -190, -62 | `sv_concentration` `sv_souplesse` `sv_seuil_arcanes` |
| `sv_peau` | Passif | **Peau de brume** | +4 % de résistance au feu, au givre, aux arcanes et au poison par rang. | 3 | 1/1/1 | 190, -62 | `sv_jarret` `sv_foulee` `sv_seuil_bois` |
| `sv_aplomb` | Passif | **Aplomb** | +10 d'Équilibre par rang (réduit la durée des vacillements). | 3 | 1/1/1 | 0, -200 | `sv_souplesse` `sv_jarret` `sv_longue_esquive` |
| `sv_souffle` | Passif | **Souffle profond** | +8 endurance maximale par rang. | 3 | 1/1/1 | 118, 162 | `sv_foulee` `sv_bras` `sv_alchimiste` |
| `sv_vigueur` | Passif | **Vigueur** | +4 % de points de vie maximum par rang. | 3 | 1/1/1 | -118, 162 | `sv_bras` `sv_concentration` `sv_appel_echo` |

#### Garde (4 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `sv_bras` | Passif | **Bras solide** | Par rang : −6 % d'endurance par coup bloqué et +3 points de réduction (sans dépasser 90 %, ou 100 % avec Mur vivant). | 3 | 1/1/1 | 0, 200 | `sv_souffle` `sv_vigueur` `fond_garde` `sv_parade` `sv_garde_fer` `sv_egide` |
| `sv_garde_fer` | Variante | **Garde de fer** | Garde : −35 % d’endurance par coup bloqué, +15 points de réduction (plafonds inchangés), mais on se déplace à 35 % au lieu de 55 %. *(groupe `garde_style`)* | 1 | 1/1/1 | 0, 300 | `sv_bras` |
| `sv_parade` | Variante | **Parade parfaite** | Lever la garde dans les 180 ms avant l’impact annule le coup, inflige 60 de déséquilibre et donne Contre parfait 1,5 s (prochain coup ×2, ×1,5 à distance). Garde levée en 0,25 s au lieu de 0,15 s. *(groupe `garde_style`)* | 1 | 1/1/1 | 73, 291 | `sv_bras` |
| `sv_egide` | Variante | **Égide arcanique** | La garde devient un demi-dôme de 180° qui réduit TOUS les dégâts de 75 %, sorts compris ; −20 % d’endurance par coup bloqué, mais 6 mana par coup. *(groupe `garde_style`)* | 1 | 1/1/1 | -73, 291 | `sv_bras` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Garde de fer* (`sv_garde_fer`) : Reflet gris acier sur l'arme ou le bouclier, posture plus basse ; étincelles grises à chaque blocage.
- *Parade parfaite* (`sv_parade`) : Gerbe d'étincelles dorées et onde de choc circulaire au point de contact, « clang » métallique ; l'attaquant clignote et recule d'un pas.
- *Égide arcanique* (`sv_egide`) : Demi-dôme translucide bleu pâle couvert de runes hexagonales devant le personnage ; il se fissure et scintille à chaque impact.

#### Roulade (6 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `sv_souplesse` | Passif | **Souplesse** | La roulade coûte 2 endurance de moins par rang (toutes variantes). | 3 | 1/1/1 | -118, -162 | `sv_recuperation` `sv_aplomb` `fond_roulade` `sv_pas_ombre` `sv_roulade_lourde` `sv_esquive_parfaite` |
| `sv_esquive_parfaite` | Variante | **Esquive parfaite** | Esquiver un coup dans les 150 dernières ms avant l'impact rend 15 d'endurance (jamais plus que le coût de la roulade : rien avec Danseur des brumes) et donne Contre parfait 1 s : prochain coup ×1,5 et +20 de déséquilibre. *(groupe `roulade_style`)* | 1 | 1/1/1 | -112, -278 | `sv_souplesse` |
| `sv_roulade_lourde` | Variante | **Roulade lourde** | Roulade de 4 m en 0,65 s (invulnérable à partir de 50 ms), 34 d’endurance ; +50 d’Équilibre pendant 0,4 s après, poids d’armure ignoré, 15 de déséquilibre à 1,5 m à l’arrivée. *(groupe `roulade_style`)* | 1 | 1/1/1 | -176, -243 | `sv_souplesse` |
| `sv_pas_ombre` | Variante | **Pas de l'ombre** | La roulade devient un bond d’ombre de 3 m en 0,15 s : invulnérable 0,2 s (au lieu de 0,35 s), 22 d’endurance, action possible après 0,25 s, recharge 0,5 s. *(groupe `roulade_style`)* | 1 | 1/1/1 | -230, -193 | `sv_souplesse` |
| `sv_longue_esquive` | Passif | **Longue esquive** | +40 ms d'invulnérabilité par rang, pour toutes les variantes de roulade. | 2 | 1/1/1 | 0, -330 | `sv_aplomb` `ks_danseur` |
| `ks_danseur` | Clé de voûte | **Danseur des brumes** | Les roulades ne coûtent plus d'endurance, mais on ne peut rouler qu'une fois toutes les 1,8 s et l'endurance maximale baisse de 25. *(niv. 10 min.)* | 1 | 1/1/1 | 0, -430 | `sv_longue_esquive` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Esquive parfaite* (`sv_esquive_parfaite`) : Sur esquive parfaite : image rémanente dorée à l'endroit du coup, éclair de brume blanche et tintement cristallin ; l'arme luit d'or tant que la Riposte est active.
- *Roulade lourde* (`sv_roulade_lourde`) : Roulade d'épaule lourde ; à l'arrivée, anneau de poussière de 1,5 m et marque d'impact au sol ; léger tremblement de caméra pour le lanceur.
- *Pas de l'ombre* (`sv_pas_ombre`) : Le corps se dissout en brume noir-violet (0,1 s), réapparaît 3 m plus loin dans une bouffée de fumée ; une silhouette fantôme reste 0,3 s au point de départ. Pas de clip Roll : clip Idle + fondu du matériau.

#### Saut (3 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `sv_jarret` | Passif | **Jarret d'acier** | Par rang : le saut coûte 3 endurance de moins et l'atterrissage dure 25 ms de moins. | 2 | 1/1/1 | 118, -162 | `sv_aplomb` `sv_peau` `fond_saut` `sv_frappe_plongeante` `sv_envol` |
| `sv_frappe_plongeante` | Variante | **Frappe plongeante** | Attaque sautée : ×1,3 → ×1,7, déséquilibre ×1,5 → ×2,5, zone 1,5 → 2,5 m (projectile : explosion de 1,5 m) ; réception 0,3 → 0,45 s, à 20 % de vitesse. *(groupe `saut_style`)* | 1 | 1/1/1 | 145, -262 | `sv_jarret` |
| `sv_envol` | Variante | **Envol** | Saut : 0,35 → 0,55 s en l’air, distance ×1,4, réception 0,1 → 0,05 s ; coûte 3 d’endurance de plus (18). *(groupe `saut_style`)* | 1 | 1/1/1 | 205, -219 | `sv_jarret` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Frappe plongeante* (`sv_frappe_plongeante`) : Arc de lame vers le bas avec traînée lumineuse, fissure au sol (décal 2,5 m) et anneau de poussière ; pour un projectile : petite explosion de 1,5 m à l'impact.
- *Envol* (`sv_envol`) : Tourbillon d'air et de brume sous les pieds au décollage, légère traînée pendant le vol.

#### Soutien (5 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `sv_alchimiste` | Passif | **Alchimiste de fortune** | Les potions sont 15 % plus efficaces par rang. | 2 | 1/1/1 | 194, 267 | `sv_souffle` `sv_seuil_acier` `ks_dernier_souffle` |
| `sv_appel_echo` | Passif | **Appel de l'écho** | Votre écho se ramasse à 4 m, apparaît sur la carte et la minicarte et brille à travers la brume. | 1 | 1/1/1 | -194, 267 | `sv_vigueur` `sv_seuil_acier` `sv_echo_tenace` |
| `sv_echo_tenace` | Passif | **Écho tenace** | Mourir avant d'avoir récupéré son écho ne le détruit plus : il garde la moitié de son XP (2 échos au maximum). | 1 | 1/1/1 | -355, 205 | `sv_appel_echo` |
| `ks_dernier_souffle` | Clé de voûte | **Dernier souffle** | Une fois toutes les 120 s (240 s contre un joueur), un coup mortel vous laisse à 1 PV avec 0,6 s d'invulnérabilité et 30 d'endurance. En contrepartie : −12 % de PV maximum. *(niv. 15 min.)* | 1 | 1/1/1 | 340, 247 | `sv_alchimiste` |
| `ks_touche_a_tout` | Clé de voûte | **Touche-à-tout** | Les pénalités d'Inaptitude sont réduites de moitié ; en contrepartie, les compétences de votre propre classe perdent 8 % de puissance. *(niv. 10 min.)* | 1 | 1/1/1 | 457, -48 | `sv_seuil_bois` |

#### Seuils (3 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `sv_seuil_arcanes` | Passif | **Seuil des Arcanes** | Passage vers la région du Mage. +6 % de mana maximum. | 1 | 1/1/1 | -355, -205 | `sv_recuperation` `mage_depart` |
| `sv_seuil_bois` | Passif | **Seuil des Bois** | Passage vers la région du Rôdeur. +2 % de chances de coup critique. | 1 | 1/1/1 | 355, -205 | `sv_peau` `rodeur_depart` `ks_touche_a_tout` |
| `sv_seuil_acier` | Passif | **Seuil de l'Acier** | Passage vers la région du Guerrier. +5 % de points de vie maximum. | 1 | 1/1/1 | 0, 410 | `sv_alchimiste` `sv_appel_echo` `guerrier_depart` |


**Groupes de variantes de Survie** :

| Groupe | Capacité | Options (une seule au choix) |
|---|---|---|
| `roulade_style` | Roulade | Pas de l'ombre (`sv_pas_ombre`) · Roulade lourde (`sv_roulade_lourde`) · Esquive parfaite (`sv_esquive_parfaite`) |
| `sprint_style` | Sprint | Élan (`sv_elan`) · Course feutrée (`sv_course_feutree`) · Course du vent (`sv_course_vent`) |
| `saut_style` | Saut | Frappe plongeante (`sv_frappe_plongeante`) · Envol (`sv_envol`) |
| `garde_style` | Garde | Parade parfaite (`sv_parade`) · Garde de fer (`sv_garde_fer`) · Égide arcanique (`sv_egide`) |
| `charge_style` | Attaque chargée | Charge vive (`sv_charge_vive`) · Frappe écrasante (`sv_charge_ecrasante`) · Éventail (`sv_eventail`) |

**Capacités de Survie** :

| id | Nom | Type | Coût (mana + end.) | Recharge | Portée | Puissance | Poise | Engagement | Arme | Étiquettes | Origine |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `roulade` | **Roulade** | déplacement | 0 + 30 | 0,6 s | — | — | 0 | — | — | mobilite, defense | tous (Survie) |
| `sprint` | **Sprint** | maintien | 0 + 0 (18/s) | 0 s | — | — | 0 | — | — | mobilite | tous (Survie) |
| `saut` | **Saut** | saut | 0 + 15 | 0,5 s | — | — | 0 | — | — | mobilite, defense | tous (Survie) |
| `attaque_sautee` | **Attaque sautée** | mêlée | 0 + 5 | celle de l'attaque de base | r 1,5 m | — | — | — | arme de l'attaque de base | physique, zone | tous (Survie) |
| `garde` | **Garde** | garde | 0 + 0 | 0 s | — | — | 0 | — | — | defense | tous (Survie) |
| `attaque_chargee` | **Attaque chargée** | charge | 0 + 10 | celle de l'attaque de base | — | ×1,0 → ×1,8 | — | récup. 0,5 s à 30 % | arme de l'attaque de base | physique | tous (Survie) |
| `riposte_parfaite` | **Contre parfait** | renfort | 0 + 0 | celle de l'attaque de base | — | — | — | — | — | physique | tous (Survie) |

- **Roulade** (`roulade`) — Une roulade d'esquive : invulnérable un court instant, elle traverse les coups télégraphiés.
  *Soulslike :* Engagement total pendant 0,55 s (aucune action, direction fixée). Les i-frames annulent tout coup résolu dans la fenêtre (télégraphes, projectiles, coups légers). Aucune résistance au vacillement pendant la roulade. 3 roulades d'affilée vident une jauge de 100.
- **Sprint** (`sprint`) — Courir plus vite tant que l'endurance le permet.
  *Soulslike :* Utilisable en combat. Toute attaque, garde, charge ou saut coupe le sprint. La régénération d'endurance est bloquée pendant le sprint. Les attaques de base à distance restent impossibles en sprint (règle v0.2 : moins de 40 % de la vitesse).
- **Saut** (`saut`) — Un petit saut qui passe au-dessus des ondes de choc au sol et permet une attaque sautée.
  *Soulslike :* Aucune i-frame : en l'air, on esquive seulement les attaques marquées « rasantes » (lo). Direction et vitesse figées au décollage (pas de contrôle en l'air). Pas d'escalade : le saut ne franchit ni mur, ni clôture, ni falaise (aucune composante verticale côté serveur). Touché en l'air = vacillement 0,4 s à l'atterrissage.
- **Attaque sautée** (`attaque_sautee`) — Appuyer sur l'attaque de base en l'air : le coup tombe à l'atterrissage.
  *Soulslike :* Mêlée : zone de 1,5 m au point d'atterrissage, ×1,3 dégâts, ×1,5 poise. Distance (tir, trait) : un seul projectile ×1,1 tiré au sommet du saut ; la distance horizontale du saut est alors divisée par deux (pas de kite aérien). Comme l'Attaque chargée, la recharge de l'attaque de base ne repart qu'après la réception : ce n'est pas un gain de DPS, c'est un outil de déséquilibre et d'esquive des rasants. Récupération 0,3 s à 30 % de vitesse après l'atterrissage.
- **Garde** (`garde`) — Lever son arme ou son bouclier pour encaisser les coups de face au prix d'endurance.
  *Soulslike :* Bloque les coups de face (120°) : mêlée, projectiles physiques, télégraphes cône/ligne/cercle-bond. Ne bloque PAS les attaques rasantes (lo, à sauter) ni les imparables (nb : sorts, empoignades, séismes de boss). À 0 d'endurance : garde brisée, vacillement 1 s et le reste des dégâts passe. Pas de vacillement sur un coup bloqué.
- **Attaque chargée** (`attaque_chargee`) — Maintenir l'attaque de base pour la charger : plus de dégâts et un gros déséquilibre.
  *Soulslike :* Charge possible seulement quand l'attaque de base est prête ; la recharge repart au relâchement, donc le DPS reste celui de l'attaque automatique : c'est un outil de rupture de posture (poise ×2) et de punition, pas un gain de DPS. Relâché avant 0,4 s = attaque normale. Puissance linéaire de ×1,0 à ×1,8 entre 0,4 et 1,2 s. Plein : éclat visuel + super-armure les 0,3 dernières secondes. Touché pendant la charge (hors super-armure) = charge perdue, sans coût. Relâche automatique à 2 s.

## 6. Guerrier (87 nœuds : 16 compétences, 38 variantes, 27 passifs, 6 clés de voûte)

Trois identités : **Gardien** (bouclier, blocage, protection du groupe), **Berserker** (rage, saignement, gros coups,
vol de vie), **Maître d'armes** (rythme, critiques, estocs, mobilité sans invulnérabilité). Le départ donne la
**Frappe** ; *Coup puissant* (à 1 point) ouvre les trois branches. Maîtrises d'épée : courte et longue (Gardien),
bâtarde et espadon (Berserker), rapière, cimeterre et lame courbe (Maître d'armes), épée runique (Lame spirituelle).
Les étourdissements et interruptions ne touchent jamais un boss.

### 6.1 Capacités

| id | Nom | Type | Coût (mana + end.) | Recharge | Portée | Puissance | Poise | Engagement | Arme | Étiquettes | Origine |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `strike` | **Frappe** *(base)* | mêlée | 0 + 5 | 1,3 s | 2,8 m | ×1,2 | 12 | prép. 0,15 s · récup. 0,25 s à 50 % | arme de mêlée | physique, melee | Guerrier |
| `heavy_blow` | **Coup puissant** *(v0.2)* | mêlée | 12 + 16 | 6 s | 2,8 m | ×2,8 | 42 | prép. 0,35 s · récup. 0,5 s à 30 % | arme de mêlée | physique, melee, lourd | Guerrier |
| `whirlwind` | **Tourbillon** *(v0.2)* | zone autour de soi | 20 + 18 | 10 s | r 4,5 m | ×1,9 | 24 | prép. 0,2 s · récup. 0,55 s à 35 % | arme de mêlée | physique, melee, zone | Guerrier |
| `war_cry` | **Cri de guerre** *(v0.2)* | soin | 15 + 0 | 25 s | — | soin 30 % | — | prép. 0,3 s · récup. 0,4 s à 50 % | — | soin, cri | Guerrier |
| `taunt` | **Provocation** | zone autour de soi | 10 + 0 | 14 s | r 8 m | — | — | prép. 0,2 s · récup. 0,3 s à 50 % | — | cri, defense, groupe | Guerrier |
| `shield_bash` | **Coup de bouclier** | mêlée | 8 + 18 | 12 s | 2,2 m | ×1,3 | 48 | prép. 0,12 s · récup. 0,35 s à 40 % | arme de mêlée | physique, melee, defense, interruption | Guerrier |
| `riposte` | **Riposte** | mêlée | 0 + 12 | 3 s | 2,8 m | ×1,9 | 30 | prép. 0,1 s · récup. 0,3 s à 50 % | arme de mêlée | physique, melee, contre | Guerrier |
| `bastion` | **Bastion** | renfort | 20 + 0 | 30 s | — | — | — | prép. 0,2 s · récup. 0,3 s à 50 % | — | defense | Guerrier |
| `rage` | **Rage sanguinaire** | renfort | 0 + 0 + 10 % PV | 30 s | — | — | — | prép. 0,3 s · récup. 0,3 s à 50 % | — | rage | Guerrier |
| `leap_slam` | **Bond fracassant** | déplacement | 10 + 25 | 12 s | 7 m / r 3 m | ×1,6 | 50 | prép. 0,15 s · récup. 0,7 s à 20 % | arme de mêlée | physique, zone, mobilite, saut, melee | Guerrier |
| `rend` | **Entaille** | mêlée | 8 + 14 | 8 s | 2,8 m | ×1 + 180 % en 6 s | 18 | prép. 0,15 s · récup. 0,3 s à 45 % | arme de mêlée | physique, melee, saignement | Guerrier |
| `execute` | **Exécution** | mêlée | 15 + 22 | 15 s | 2,8 m | ×2 | 35 | prép. 0,3 s · récup. 0,8 s à 20 % | arme de mêlée | physique, melee, lourd | Guerrier |
| `lunge` | **Estocade** | déplacement | 8 + 15 | 7 s | 4 m | ×1,6 | 25 | prép. 0,1 s · récup. 0,4 s à 35 % | arme de mêlée | physique, melee, mobilite, estoc | Guerrier |
| `blade_dance` | **Danse des lames** | canalisation | 12 + 20 | 10 s | 2,8 m | ×0,9 ×3 | 12 | prép. 0,1 s · récup. 0,45 s à 40 % | arme de mêlée | physique, melee, combo | Guerrier |
| `sunder` | **Brise-garde** | mêlée | 10 + 16 | 12 s | 2,8 m | ×1,1 | 70 | prép. 0,25 s · récup. 0,4 s à 35 % | arme de mêlée | physique, melee, lourd | Guerrier |
| `sidestep` | **Pas de lame** | déplacement | 0 + 18 | 6 s | 3 m | — | — | récup. 0,1 s à 80 % | arme de mêlée | mobilite, melee | Guerrier |

- **Frappe** (`strike`) — Attaque de base au corps à corps, rapide et sûre.
  *Soulslike :* Coup court : sûr contre les brutes après leur attaque, trop faible pour déséquilibrer seul. Se charge (Fondamental « Attaque chargée ») : ×2,2 et poise 40 après 0,8 s de charge.
- **Coup puissant** (`heavy_blow`) — Un coup lourd, lent à armer, qui fait vaciller presque tout.
  *Soulslike :* L’outil de punition : à placer dans la fenêtre de récupération d’un monstre. 42 de poise : un loup (24) titube d’un coup, un squelette (44) presque ; il en faut 4 pour le golem (150).
- **Tourbillon** (`whirlwind`) — Une rotation complète qui frappe tous les ennemis proches.
  *Soulslike :* Anti-meute (loups, gobelins). 0,55 s de récupération : lancé au mauvais moment, on mange la charge suivante.
- **Cri de guerre** (`war_cry`) — Un rugissement qui rend 30 % des PV.
  *Soulslike :* Soin d’urgence non interruptible mais avec 0,7 s d’engagement total : à placer après une roulade, pas sous un télégraphe.
- **Provocation** (`taunt`) — Force les monstres proches à vous attaquer et durcit votre défense.
  *Soulslike :* Les monstres provoqués changent de cible APRÈS leur attaque en cours (jamais d’annulation de télégraphe). Boss : 2 s seulement.
- **Coup de bouclier** (`shield_bash`) — Un coup sec qui interrompt une attaque légère en préparation.
  *Soulslike :* Interrompt la préparation d’une attaque LÉGÈRE (kind melee) d’un monstre non-boss. Les attaques télégraphiées ne sont interrompues que si la poise casse.
- **Riposte** (`riposte`) — Juste après avoir bloqué un coup, une contre-attaque critique.
  *Soulslike :* Utilisable 1 s après un coup bloqué avec la Garde (ou une parade parfaite). Récompense la lecture du rythme ennemi, sans jamais rendre invulnérable.
- **Bastion** (`bastion`) — Vous plantez vos pieds : dégâts subis fortement réduits, mais vous êtes lent.
  *Soulslike :* Pas d’invulnérabilité : −40 % seulement, pas de roulade pendant 6 s. Pensé pour encaisser une phase de boss en groupe.
- **Rage sanguinaire** (`rage`) — Vous sacrifiez du sang pour frapper plus fort et plus vite.
  *Soulslike :* Coûte 10 % des PV actuels (jamais mortel). −10 % de défense : une erreur coûte plus cher.
- **Bond fracassant** (`leap_slam`) — Un bond de 7 m qui retombe en onde de choc.
  *Soulslike :* En l’air 0,45 s : passe au-dessus des ondes de choc au sol comme le Saut, mais ce n’est PAS une invulnérabilité (projectiles et coups hauts touchent). 0,7 s de récupération à l’atterrissage.
- **Entaille** (`rend`) — Une taille qui ouvre une plaie : saignement pendant 6 s.
  *Soulslike :* Dégâts différés : permet de rouler immédiatement après. Le saignement ignore la défense mais pas la garde frontale des squelettes (le coup initial y est soumis).
- **Exécution** (`execute`) — Un coup d’achèvement dévastateur contre un ennemi affaibli.
  *Soulslike :* Très engageant (0,3 s d’armement + 0,8 s de récupération) : ne se place que sur un monstre déséquilibré ou en récupération.
- **Estocade** (`lunge`) — Une fente de 4 m qui transperce en ligne droite.
  *Soulslike :* Déplacement offensif SANS invulnérabilité : sert à combler une distance, pas à esquiver.
- **Danse des lames** (`blade_dance`) — Trois tailles rapides enchaînées ; on peut se déplacer entre les coups.
  *Soulslike :* Annulable par une roulade entre deux coups (les coups restants sont perdus) : pas de verrouillage, mais pas d’esquive gratuite non plus.
- **Brise-garde** (`sunder`) — Un coup qui ouvre la garde : défense ennemie −25 % pendant 6 s.
  *Soulslike :* Supprime la garde frontale (squelettes, boucliers) pendant 6 s. 70 de poise : l’ouverture idéale d’un combo.
- **Pas de lame** (`sidestep`) — Un pas de côté vif ; le prochain coup dans 1,5 s est critique.
  *Soulslike :* AUCUNE invulnérabilité (contrairement à la roulade) : un pas bien lu évite le coup, un pas mal lu le prend en pleine face.

### 6.2 Nœuds

#### Tronc (8 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `guerrier_depart` | Compétence | **Frappe** | Point de départ du Guerrier : l’attaque de base, acquise au niveau 1. | 1 | départ (0/2/2) | 0, 500 | `sv_seuil_acier` `gu_frappe_tournoyante` `gu_frappe_saignante` `gu_frappe_eclair` `gu_coup_puissant` |
| `gu_frappe_tournoyante` | Variante | **Frappe tournoyante** | La Frappe balaie un arc de 200° devant vous (rayon 3 m) ; puissance ×1,2 → ×0,95. *(groupe `frappe_forme`)* | 1 | 1/2/2 | -149, 487 | `guerrier_depart` |
| `gu_coup_pommeau` | Variante | **Coup de pommeau** | Plus court et plus sûr : armement 0,35 → 0,15 s, récupération 0,5 → 0,3 s, recharge 6 → 4 s, puissance 2,8 → 1,9. *(groupe `coup_puissant_forme`)* | 1 | 1/2/2 | 75, 510 | `gu_coup_puissant` |
| `gu_coup_ascendant` | Variante | **Coup ascendant** | Coup puissant projette la cible de 3 m en arrière (non-boss) ; recharge 6 → 8 s. *(groupe `coup_puissant_forme`)* | 1 | 1/2/2 | 123, 554 | `gu_coup_puissant` |
| `gu_frappe_saignante` | Variante | **Frappe saignante** | La Frappe ouvre une plaie : saignement de 30 % de l’attaque sur 4 s (cumul jusqu’à 3). *(groupe `frappe_forme`)* | 1 | 1/2/2 | -141, 551 | `guerrier_depart` |
| `gu_frappe_eclair` | Variante | **Frappe éclair** | Frappe plus vive : recharge 1,3 → 1,0 s, puissance 1,2 → 1,0, endurance 5 → 4, récupération 0,25 → 0,18 s. *(groupe `frappe_forme`)* | 1 | 1/2/2 | -106, 606 | `guerrier_depart` |
| `gu_coup_fendoir` | Variante | **Coup fendoir** | Coup puissant brise les gardes : poise 42 → 65 et ignore la garde frontale ; puissance 2,8 → 2,5. *(groupe `coup_puissant_forme`)* | 1 | 1/2/2 | 148, 614 | `gu_coup_puissant` |
| `gu_coup_puissant` | Compétence | **Coup puissant** | Débloque Coup puissant (compétence de la v0.2). | 1 | 1/2/2 | 0, 640 | `guerrier_depart` `gu_coup_fendoir` `gu_coup_ascendant` `gu_coup_pommeau` `gu_ga_cri` `gu_be_tourbillon` `gu_md_estocade` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Frappe tournoyante* (`gu_frappe_tournoyante`) : Traînée d’acier large et pâle en demi-lune, poussière soulevée au sol.
- *Coup de pommeau* (`gu_coup_pommeau`) : Coup sec et court, onde de choc ronde et blanche à l’impact.
- *Coup ascendant* (`gu_coup_ascendant`) : Arc de bas en haut, souffle de vent qui repousse la brume.
- *Frappe saignante* (`gu_frappe_saignante`) : Traînée rouge sombre, gerbe de gouttes à l’impact, petites marques rouges sur la cible par cumul.
- *Frappe éclair* (`gu_frappe_eclair`) : Traînée fine et blanche très courte, légère distorsion d’air derrière la lame.
- *Coup fendoir* (`gu_coup_fendoir`) : Coup vertical, étincelles orange à l’impact et fissure brève au sol.

#### Gardien (26 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `gu_ga_cri` | Compétence | **Cri de guerre** | Débloque Cri de guerre (compétence de la v0.2). Racine du Gardien. | 1 | 1/2/2 | 0, 820 | `gu_coup_puissant` `gu_ga_cri_ralliement` `gu_ga_cri_effroi` `gu_ga_cri_souffle` `gu_ga_garde_de_fer` `gu_ga_constitution` |
| `gu_ga_cri_ralliement` | Variante | **Cri de ralliement** | Soigne aussi les membres du groupe à moins de 10 m de 15 % de leurs PV ; votre soin passe de 30 % à 22 %. *(groupe `cri_forme`)* | 1 | 1/2/2 | 74, 817 | `gu_ga_cri` |
| `gu_ga_cri_effroi` | Variante | **Cri d’effroi** | Soin 30 % → 15 % ; les monstres à moins de 6 m infligent −20 % de dégâts pendant 6 s (boss −10 %). *(groupe `cri_forme`)* | 1 | 1/2/2 | -74, 817 | `gu_ga_cri` |
| `gu_ga_garde_de_fer` | Passif | **Poigne de fer** | Les coups bloqués par la Garde coûtent 10 % d’endurance en moins par rang. | 3 | 1/2/2 | 74, 912 | `gu_ga_cri` `gu_ga_coup_bouclier` `gu_ga_riposte` |
| `gu_ga_constitution` | Passif | **Constitution** | +3,5 % de PV max par rang. | 3 | 1/2/2 | -74, 912 | `gu_ga_cri` `gu_ga_riposte` `gu_ga_provocation` |
| `gu_ga_cri_souffle` | Variante | **Second souffle** | Rend 15 % des PV tout de suite puis 15 % sur 5 s, et 40 d’endurance ; recharge 25 → 22 s. *(groupe `cri_forme`)* | 1 | 1/2/2 | 0, 915 | `gu_ga_cri` |
| `gu_ga_coup_bouclier` | Compétence | **Coup de bouclier** | Débloque Coup de bouclier. | 1 | 1/2/2 | 74, 1007 | `gu_ga_garde_de_fer` `gu_ga_charge_bouclier` `gu_ga_bouclier_ecrasant` |
| `gu_ga_provocation` | Compétence | **Provocation** | Débloque Provocation. | 1 | 1/2/2 | -74, 1007 | `gu_ga_constitution` `gu_ga_defi` `gu_ga_rempart_vivant` |
| `gu_ga_rempart_vivant` | Variante | **Rempart vivant** | Défense +15 % → −25 % de dégâts subis pendant 4 s, mais vitesse −30 %. *(groupe `provocation_forme`)* | 1 | 1/2/2 | -147, 999 | `gu_ga_provocation` |
| `gu_ga_riposte` | Compétence | **Riposte** | Débloque Riposte. | 1 | 1/2/2 | 0, 1010 | `gu_ga_garde_de_fer` `gu_ga_constitution` `gu_ga_riposte_vengeresse` `gu_ga_riposte_desequilibre` |
| `gu_ga_charge_bouclier` | Variante | **Charge au bouclier** | Vous chargez 6 m avant l’impact ; poise 48 → 40, recharge 12 → 14 s. *(groupe `bouclier_forme`)* | 1 | 1/2/2 | 148, 1095 | `gu_ga_coup_bouclier` `gu_ga_maitrise_courte` |
| `gu_ga_defi` | Variante | **Défi** | Une seule cible à 15 m, provoquée 6 s ; elle subit +10 % de dégâts de vos alliés. *(groupe `provocation_forme`)* | 1 | 1/2/2 | -148, 1095 | `gu_ga_provocation` `gu_ga_sentinelle` |
| `gu_ga_riposte_vengeresse` | Variante | **Riposte vengeresse** | Ajoute 60 % des dégâts bloqués par le dernier coup ; puissance 1,9 → 1,55. *(groupe `riposte_forme`)* | 1 | 1/2/2 | 0, 1105 | `gu_ga_riposte` `gu_ga_maitrise_courte` `gu_ga_peau_de_pierre` |
| `gu_ga_bouclier_ecrasant` | Variante | **Bouclier écrasant** | Puissance 1,0 → 1,6, étourdit 1,2 s les non-boss ; recharge 12 → 16 s. *(groupe `bouclier_forme`)* | 1 | 1/2/2 | 74, 1103 | `gu_ga_coup_bouclier` `gu_ga_maitrise_courte` |
| `gu_ga_riposte_desequilibre` | Variante | **Riposte déséquilibrante** | Plus de critique garanti, mais poise 30 → 90 : déséquilibre la plupart des monstres. *(groupe `riposte_forme`)* | 1 | 1/2/2 | -74, 1103 | `gu_ga_riposte` `gu_ga_peau_de_pierre` `gu_ga_sentinelle` |
| `gu_ga_peau_de_pierre` | Passif | **Peau de pierre** | +5 % de défense par rang. | 3 | 1/2/2 | 0, 1200 | `gu_ga_riposte_vengeresse` `gu_ga_riposte_desequilibre` `gu_ga_sentinelle` `gu_ga_bastion` |
| `gu_ga_maitrise_courte` | Passif | **Épée et bouclier** | Épée courte ou longue + bouclier : blocage +10 % de réduction et Frappe −10 % de recharge. | 1 | 1/2/2 | 74, 1198 | `gu_ga_bouclier_ecrasant` `gu_ga_charge_bouclier` `gu_ga_riposte_vengeresse` `gu_ga_maitrise_longue` |
| `gu_ga_sentinelle` | Passif | **Sentinelle** | Quand vous bloquez un coup, 3 % des PV max rendus (au plus une fois toutes les 2 s). | 1 | 1/2/2 | -74, 1198 | `gu_ga_riposte_desequilibre` `gu_ga_defi` `gu_ga_peau_de_pierre` `gu_ga_endurci` |
| `gu_ga_bastion` | Compétence | **Bastion** | Débloque Bastion. | 1 | 1/2/2 | 0, 1295 | `gu_ga_peau_de_pierre` `gu_ga_bastion_mobile` `gu_ga_bastion_epineux` `gu_ga_inebranlable` |
| `gu_ga_maitrise_longue` | Passif | **Maîtrise de l’épée longue** | Épée longue : +8 % de dégâts et +0,3 m de portée de mêlée. | 1 | 1/2/2 | 74, 1293 | `gu_ga_maitrise_courte` |
| `gu_ga_endurci` | Passif | **Souffle de vétéran** | +5 d’endurance max par rang. | 3 | 1/2/2 | -74, 1293 | `gu_ga_sentinelle` |
| `gu_ga_bastion_mobile` | Variante | **Bastion mobile** | −40 % → −25 % de dégâts subis, mais plus de ralentissement et la roulade reste permise. *(groupe `bastion_forme`)* | 1 | 1/2/2 | 74, 1388 | `gu_ga_bastion` |
| `gu_ga_bastion_epineux` | Variante | **Bastion épineux** | Renvoie 30 % des dégâts de mêlée subis à l’attaquant pendant la durée. *(groupe `bastion_forme`)* | 1 | 1/2/2 | -74, 1388 | `gu_ga_bastion` |
| `gu_ga_inebranlable` | Passif | **Inébranlable** | Durée des étourdissements et renversements subis −30 %. | 1 | 1/2/2 | 0, 1390 | `gu_ga_bastion` `gu_ga_ks_mur_vivant` `gu_ga_ks_serment` |
| `gu_ga_ks_mur_vivant` | Clé de voûte | **Mur vivant** | Avec un bouclier, la Garde bloque 100 % des dégâts frontaux (85 % contre un boss). CONTREPARTIE : coups bloqués +30 % d’endurance, sprint impossible, roulade −40 % de distance. | 1 | 1/3/3 | 74, 1483 | `gu_ga_inebranlable` |
| `gu_ga_ks_serment` | Clé de voûte | **Serment du protecteur** | 20 % des dégâts subis par les membres du groupe à moins de 8 m sont redirigés vers vous ; +20 % de défense. CONTREPARTIE : −15 % de dégâts infligés. | 1 | 1/3/3 | -74, 1483 | `gu_ga_inebranlable` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Cri de ralliement* (`gu_ga_cri_ralliement`) : Onde dorée qui s’étend sur 10 m, halo doux sur les alliés touchés.
- *Cri d’effroi* (`gu_ga_cri_effroi`) : Onde rouge sombre, les ennemis touchés émettent une fumée noire brève.
- *Second souffle* (`gu_ga_cri_souffle`) : Buée blanche expirée, fines volutes vertes qui remontent le long du corps pendant 5 s.
- *Rempart vivant* (`gu_ga_rempart_vivant`) : Aura de pierre grise autour du corps, anneau de runes au sol.
- *Charge au bouclier* (`gu_ga_charge_bouclier`) : Traînée de poussière derrière le guerrier, choc métallique avec éclats blancs.
- *Défi* (`gu_ga_defi`) : Rayon rouge du guerrier à la cible, marque d’épée flottant au-dessus d’elle.
- *Riposte vengeresse* (`gu_ga_riposte_vengeresse`) : La lame se couvre d’un reflet rouge-or au moment du blocage, décharge à l’impact.
- *Bouclier écrasant* (`gu_ga_bouclier_ecrasant`) : Impact lourd, étoiles/étincelles tournoyant au-dessus de la cible étourdie.
- *Riposte déséquilibrante* (`gu_ga_riposte_desequilibre`) : Coup d’épaule + lame, onde grise concentrique, la cible titube.
- *Bastion mobile* (`gu_ga_bastion_mobile`) : Fines plaques de lumière grise qui suivent le corps au lieu d’un anneau au sol.
- *Bastion épineux* (`gu_ga_bastion_epineux`) : Épines de fer spectrales jaillissant de l’armure à chaque coup reçu.

#### Berserker (27 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `gu_be_tourbillon_aspirant` | Variante | **Tourbillon aspirant** | Rayon 4,5 → 5,5 m et attire les ennemis de 2 m vers vous ; puissance 1,9 → 1,6. *(groupe `tourbillon_forme`)* | 1 | 1/2/2 | 265, 776 | `gu_be_tourbillon` |
| `gu_be_tourbillon` | Compétence | **Tourbillon** | Débloque Tourbillon (compétence de la v0.2). Racine du Berserker. | 1 | 1/2/2 | 334, 749 | `gu_coup_puissant` `gu_be_tourbillon_sanglant` `gu_be_tourbillon_ambulant` `gu_be_tourbillon_aspirant` `gu_be_soif` `gu_be_chair` |
| `gu_be_tourbillon_sanglant` | Variante | **Tourbillon sanglant** | Chaque ennemi touché saigne (80 % de l’attaque sur 5 s) ; puissance 1,9 → 1,6. *(groupe `tourbillon_forme`)* | 1 | 1/2/2 | 400, 716 | `gu_be_tourbillon` |
| `gu_be_chair` | Passif | **Chair endurcie** | +5 % de PV max par rang. | 3 | 1/2/2 | 303, 863 | `gu_be_tourbillon` `gu_be_bond` |
| `gu_be_tourbillon_ambulant` | Variante | **Tourbillon ambulant** | Devient canalisé 2 s : 4 coups ×0,55, déplacement à 60 %, 10 d’endurance par seconde en plus. *(groupe `tourbillon_forme`)* | 1 | 1/2/2 | 438, 803 | `gu_be_tourbillon` |
| `gu_be_soif` | Passif | **Soif de sang** | +3 % de vol de vie sur les dégâts de mêlée par rang. | 3 | 1/2/2 | 372, 836 | `gu_be_tourbillon` `gu_be_rage` `gu_be_entaille` |
| `gu_be_bond` | Compétence | **Bond fracassant** | Débloque Bond fracassant. | 1 | 1/2/2 | 342, 950 | `gu_be_chair` `gu_be_bond_predateur` `gu_be_onde_choc` |
| `gu_be_entaille` | Compétence | **Entaille** | Débloque Entaille. | 1 | 1/2/2 | 477, 890 | `gu_be_soif` `gu_be_entaille_profonde` `gu_be_hemorragie` `rg_depeceur` |
| `gu_be_bond_predateur` | Variante | **Bond du prédateur** | Portée 7 → 10 m, vise un ennemi et le fait saigner (50 % de l’attaque sur 4 s) ; rayon 3 → 2 m. *(groupe `bond_forme`)* | 1 | 1/2/2 | 272, 973 | `gu_be_bond` |
| `gu_be_rage` | Compétence | **Rage sanguinaire** | Débloque Rage sanguinaire. | 1 | 1/2/2 | 411, 923 | `gu_be_soif` `gu_be_rage_froide` `gu_be_frenesie` |
| `gu_be_rage_froide` | Variante | **Rage froide** | Ne coûte plus de PV ni de défense : +15 % de dégâts et +10 % de critique. *(groupe `rage_forme`)* | 1 | 1/2/2 | 449, 1009 | `gu_be_rage` `gu_be_fureur` |
| `gu_be_entaille_profonde` | Variante | **Entaille profonde** | Saignement ×1,5 et 8 s au lieu de 6 s. *(groupe `entaille_forme`)* | 1 | 1/2/2 | 580, 940 | `gu_be_entaille` `gu_be_maitrise_batarde` `gu_be_plaie` |
| `gu_be_onde_choc` | Variante | **Onde de choc** | Rayon 3 → 4,5 m, ralentit de 40 % pendant 2 s ; puissance 1,6 → 1,3. *(groupe `bond_forme`)* | 1 | 1/2/2 | 311, 1060 | `gu_be_bond` `gu_be_maitrise_espadon` |
| `gu_be_frenesie` | Variante | **Frénésie** | Chaque ennemi tué prolonge la Rage de 3 s (20 s au plus). *(groupe `rage_forme`)* | 1 | 1/2/2 | 381, 1037 | `gu_be_rage` `gu_be_fureur` `gu_be_maitrise_espadon` |
| `gu_be_hemorragie` | Variante | **Hémorragie** | Sur une cible qui saigne déjà : consomme le saignement et inflige tout le reste d’un coup, +30 %. *(groupe `entaille_forme`)* | 1 | 1/2/2 | 516, 977 | `gu_be_entaille` `gu_be_plaie` |
| `gu_be_fureur` | Passif | **Fureur montante** | Chaque coup subi donne +3 % de dégâts pendant 5 s (5 cumuls). | 1 | 1/2/2 | 488, 1096 | `gu_be_rage_froide` `gu_be_frenesie` `gu_be_maitrise_espadon` `gu_be_execution` |
| `gu_be_maitrise_espadon` | Passif | **Maîtrise de l’espadon** | Espadon : +15 % de poise infligée, Coup puissant et Bond fracassant +15 % de dégâts, endurance des attaques −10 %. | 1 | 1/2/2 | 420, 1124 | `gu_be_frenesie` `gu_be_onde_choc` `gu_be_fureur` `gu_be_instinct` |
| `gu_be_maitrise_batarde` | Passif | **Maîtrise de la bâtarde** | Épée bâtarde à deux mains : +12 % de dégâts, +10 % de poise. | 1 | 1/2/2 | 619, 1028 | `gu_be_entaille_profonde` `gu_be_plaie` `gu_be_carnage` |
| `gu_be_plaie` | Passif | **Plaies béantes** | +10 % de dégâts de saignement par rang. | 3 | 1/2/2 | 555, 1064 | `gu_be_hemorragie` `gu_be_entaille_profonde` `gu_be_maitrise_batarde` `gu_be_execution` |
| `gu_be_instinct` | Passif | **Instinct de survie** | Sous 30 % de PV : +25 % de régénération d’endurance. | 1 | 1/2/2 | 458, 1211 | `gu_be_maitrise_espadon` |
| `gu_be_carnage` | Passif | **Carnage** | +3 % de dégâts de mêlée par rang. | 3 | 1/2/2 | 593, 1151 | `gu_be_maitrise_batarde` |
| `gu_be_execution` | Compétence | **Exécution** | Débloque Exécution. | 1 | 1/2/2 | 527, 1183 | `gu_be_fureur` `gu_be_plaie` `gu_be_couperet` `gu_be_decapitation` `gu_be_briseur` |
| `gu_be_decapitation` | Variante | **Décapitation** | Armement 0,3 → 0,6 s bien visible, puissance 2,0 → 3,2, poise 35 → 90. *(groupe `execution_forme`)* | 1 | 1/2/2 | 497, 1298 | `gu_be_execution` |
| `gu_be_couperet` | Variante | **Couperet** | Si Exécution tue, sa recharge est remise à zéro et vous regagnez 15 d’endurance. *(groupe `execution_forme`)* | 1 | 1/2/2 | 632, 1238 | `gu_be_execution` |
| `gu_be_briseur` | Passif | **Briseur d’os** | Les monstres déséquilibrés subissent +15 % de dégâts de vos coups. | 1 | 1/2/2 | 565, 1270 | `gu_be_execution` `gu_be_ks_rasoir` `gu_be_ks_dechaine` |
| `gu_be_ks_dechaine` | Clé de voûte | **Déchaîné** | +20 % de dégâts et +15 % de vitesse d’attaque. CONTREPARTIE : la Garde est impossible (ni blocage ni parade) et −10 % de défense. | 1 | 1/3/3 | 536, 1385 | `gu_be_briseur` |
| `gu_be_ks_rasoir` | Clé de voûte | **Au fil du rasoir** | +3 % de dégâts par tranche de 10 % de PV manquants (max +27 %) et +3 % de vol de vie. CONTREPARTIE : soins reçus −30 % et plus de régénération de PV hors combat. | 1 | 1/3/3 | 671, 1325 | `gu_be_briseur` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Tourbillon aspirant* (`gu_be_tourbillon_aspirant`) : Spirale de vent convergente, lignes d’air tirées vers le centre.
- *Tourbillon sanglant* (`gu_be_tourbillon_sanglant`) : Cercle de traînées rouge sombre, gouttes projetées en spirale.
- *Tourbillon ambulant* (`gu_be_tourbillon_ambulant`) : Tornade d’acier grise continue, feuilles et brume aspirées.
- *Bond du prédateur* (`gu_be_bond_predateur`) : Trajectoire en arc avec traînée rouge, griffures au sol à l’impact.
- *Rage froide* (`gu_be_rage_froide`) : Aura bleu-gris glacée, yeux qui luisent blanc.
- *Entaille profonde* (`gu_be_entaille_profonde`) : Plaie rouge plus épaisse, filets de sang qui persistent au sol.
- *Onde de choc* (`gu_be_onde_choc`) : Anneau de terre soulevée, fissures radiales et nuage de poussière.
- *Frénésie* (`gu_be_frenesie`) : Aura rouge qui s’intensifie à chaque élimination, braises qui tombent.
- *Hémorragie* (`gu_be_hemorragie`) : Explosion de gouttes rouges en éventail à l’impact.
- *Décapitation* (`gu_be_decapitation`) : Lame levée au-dessus de la tête qui s’embrase de rouge pendant l’armement, impact en croissant géant.
- *Couperet* (`gu_be_couperet`) : Lame qui laisse une traînée noire-rouge, flash rouge au sol quand la recharge se réinitialise.

#### Maître d'armes (26 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `gu_md_velocite` | Passif | **Vélocité** | +4 % de vitesse d’attaque par rang (recharge de la Frappe). | 3 | 1/2/2 | -265, 776 | `gu_md_estocade` `gu_md_cadence` |
| `gu_md_estocade` | Compétence | **Estocade** | Débloque Estocade. Racine du Maître d’armes. | 1 | 1/2/2 | -334, 749 | `gu_coup_puissant` `gu_md_estocade_double` `gu_md_fente_foudroyante` `gu_md_precision` `gu_md_velocite` |
| `gu_md_estocade_double` | Variante | **Estocade double** | Deux estocs rapides ×1,0 au lieu d’un seul ×1,6 ; poise 25 → 2×15. *(groupe `estocade_forme`)* | 1 | 1/2/2 | -400, 716 | `gu_md_estocade` |
| `gu_md_cadence` | Passif | **Cadence** | Ouvre les variantes de rythme de la Frappe (voir ci-dessous) et +5 % de dégâts de la Frappe. | 1 | 1/2/2 | -303, 863 | `gu_md_velocite` `gu_md_troisieme_temps` `gu_md_taille_pointe` `gu_md_danse` |
| `gu_md_fente_foudroyante` | Variante | **Fente foudroyante** | Portée 4 → 6 m, critique +10 % → +25 % ; recharge 7 → 9 s. *(groupe `estocade_forme`)* | 1 | 1/2/2 | -438, 803 | `gu_md_estocade` `gu_md_brise_garde` |
| `gu_md_precision` | Passif | **Précision** | +2 % de chances de critique par rang. | 3 | 1/2/2 | -372, 836 | `gu_md_estocade` `gu_md_danse` `gu_md_brise_garde` |
| `gu_md_taille_pointe` | Variante | **Taille et pointe** | La Frappe alterne taille et estoc : l’estoc a +0,8 m de portée et +15 % de critique. *(groupe `frappe_cadence`)* | 1 | 1/2/2 | -342, 950 | `gu_md_cadence` |
| `gu_md_brise_garde` | Compétence | **Brise-garde** | Débloque Brise-garde. | 1 | 1/2/2 | -477, 890 | `gu_md_precision` `gu_md_fente_foudroyante` `gu_md_point_faible` `gu_md_coup_de_taille` `gm_flux_martial` |
| `gu_md_troisieme_temps` | Variante | **Troisième temps** | Chaque 3ᵉ Frappe enchaînée en 2 s inflige ×1,8 et 30 de poise. *(groupe `frappe_cadence`)* | 1 | 1/2/2 | -272, 973 | `gu_md_cadence` `gu_md_maitrise_rapiere` |
| `gu_md_danse` | Compétence | **Danse des lames** | Débloque Danse des lames. | 1 | 1/2/2 | -411, 923 | `gu_md_precision` `gu_md_cadence` `gu_md_tempete_acier` `gu_md_lame_finale` |
| `gu_md_tempete_acier` | Variante | **Tempête d’acier** | 5 coups ×0,6 au lieu de 3 ×0,9 ; endurance 20 → 26. *(groupe `danse_forme`)* | 1 | 1/2/2 | -449, 1009 | `gu_md_danse` `gu_md_coup_critique` `gu_md_elan` |
| `gu_md_point_faible` | Variante | **Point faible** | La cible subit en plus +15 % de chances de critique de toutes les sources pendant 6 s. *(groupe `brise_garde_forme`)* | 1 | 1/2/2 | -580, 940 | `gu_md_brise_garde` `gu_md_maitrise_cimeterre` |
| `gu_md_lame_finale` | Variante | **Lame finale** | Le 3ᵉ coup inflige ×1,8 et 40 de poise. *(groupe `danse_forme`)* | 1 | 1/2/2 | -381, 1037 | `gu_md_danse` `gu_md_maitrise_rapiere` `gu_md_coup_critique` |
| `gu_md_coup_de_taille` | Variante | **Coup de taille** | Frappe un arc de 120° (plusieurs cibles) ; poise 70 → 50. *(groupe `brise_garde_forme`)* | 1 | 1/2/2 | -516, 977 | `gu_md_brise_garde` `gu_md_elan` `gu_md_maitrise_cimeterre` |
| `gu_md_elan` | Passif | **Enchaînement** | Chaque coup porté dans les 2 s du précédent : +2 % de dégâts (5 cumuls). | 1 | 1/2/2 | -488, 1096 | `gu_md_tempete_acier` `gu_md_coup_de_taille` `gu_md_pas_de_lame` |
| `gu_md_coup_critique` | Passif | **Coups mortels** | +10 % de dégâts critiques par rang. | 3 | 1/2/2 | -420, 1124 | `gu_md_lame_finale` `gu_md_tempete_acier` `gu_md_pas_de_lame` `gu_md_maitrise_courbe` |
| `gu_md_maitrise_cimeterre` | Passif | **Maîtrise du cimeterre** | Cimeterre : les critiques font saigner (40 % de l’attaque sur 4 s). | 1 | 1/2/2 | -555, 1064 | `gu_md_point_faible` `gu_md_coup_de_taille` `gu_md_pas_de_lame` `gu_md_jeu_jambes` |
| `gu_md_maitrise_rapiere` | Passif | **Maîtrise de la rapière** | Rapière : +8 % de critique ; Estocade +1 m de portée. | 1 | 1/2/2 | -350, 1148 | `gu_md_lame_finale` `gu_md_troisieme_temps` `gu_md_maitrise_courbe` |
| `gu_md_maitrise_courbe` | Passif | **Maîtrise de la lame courbe** | Lame courbe : Frappe −10 % de recharge, Danse des lames +1 coup. | 1 | 1/2/2 | -458, 1211 | `gu_md_coup_critique` `gu_md_maitrise_rapiere` |
| `gu_md_jeu_jambes` | Passif | **Jeu de jambes** | Une roulade dans les 1,5 s après avoir touché coûte 20 % d’endurance en moins. | 1 | 1/2/2 | -593, 1151 | `gu_md_maitrise_cimeterre` |
| `gu_md_pas_de_lame` | Compétence | **Pas de lame** | Débloque Pas de lame. | 1 | 1/2/2 | -527, 1183 | `gu_md_elan` `gu_md_coup_critique` `gu_md_maitrise_cimeterre` `gu_md_pas_fantome` `gu_md_pas_tranchant` `gu_md_lecture` |
| `gu_md_pas_fantome` | Variante | **Pas fantôme** | Ne coûte plus d’endurance ; recharge 6 → 10 s. *(groupe `pas_forme`)* | 1 | 1/2/2 | -497, 1298 | `gu_md_pas_de_lame` |
| `gu_md_pas_tranchant` | Variante | **Pas tranchant** | Inflige ×0,8 aux ennemis traversés ; distance 3 → 4 m. *(groupe `pas_forme`)* | 1 | 1/2/2 | -632, 1238 | `gu_md_pas_de_lame` |
| `gu_md_lecture` | Passif | **Lecture du combat** | Les coups critiques infligent +25 % de poise. | 1 | 1/2/2 | -565, 1270 | `gu_md_pas_de_lame` `gu_md_ks_duelliste` `gu_md_ks_coups_mesures` |
| `gu_md_ks_duelliste` | Clé de voûte | **Duelliste** | Si un seul ennemi est à moins de 8 m : +20 % de dégâts et +10 % de critique. CONTREPARTIE : −20 % de dégâts dès que 3 ennemis ou plus sont à moins de 8 m. | 1 | 1/3/3 | -536, 1385 | `gu_md_lecture` |
| `gu_md_ks_coups_mesures` | Clé de voûte | **Coups mesurés** | Chaque 4ᵉ coup est un critique garanti avec +50 % de dégâts critiques. CONTREPARTIE : vos autres coups ne sont jamais critiques. | 1 | 1/3/3 | -671, 1325 | `gu_md_lecture` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Estocade double* (`gu_md_estocade_double`) : Deux lignes de lumière blanche parallèles et fines.
- *Fente foudroyante* (`gu_md_fente_foudroyante`) : Image rémanente du guerrier le long de la fente, éclair doré à la pointe.
- *Taille et pointe* (`gu_md_taille_pointe`) : Alternance de traînées en arc et de fines lignes droites.
- *Troisième temps* (`gu_md_troisieme_temps`) : 3ᵉ coup : grande taille horizontale avec un éclat argenté et un son de cloche.
- *Tempête d’acier* (`gu_md_tempete_acier`) : Multitude de traînées fines et blanches, étincelles continues.
- *Point faible* (`gu_md_point_faible`) : Marque lumineuse en losange sur la cible, qui clignote.
- *Lame finale* (`gu_md_lame_finale`) : Dernier coup : large croissant doré qui reste 0,3 s dans l’air.
- *Coup de taille* (`gu_md_coup_de_taille`) : Grand arc gris acier, éclats de métal projetés.
- *Pas fantôme* (`gu_md_pas_fantome`) : Silhouette translucide laissée à la position de départ, qui se dissipe.
- *Pas tranchant* (`gu_md_pas_tranchant`) : Ligne de coupe horizontale sur le trajet, étincelles.


**Groupes de variantes** :

| Groupe | Capacité | Options (une seule au choix) |
|---|---|---|
| `frappe_forme` | Frappe | Frappe tournoyante (`gu_frappe_tournoyante`) · Frappe saignante (`gu_frappe_saignante`) · Frappe éclair (`gu_frappe_eclair`) |
| `coup_puissant_forme` | Coup puissant | Coup fendoir (`gu_coup_fendoir`) · Coup ascendant (`gu_coup_ascendant`) · Coup de pommeau (`gu_coup_pommeau`) |
| `cri_forme` | Cri de guerre | Cri de ralliement (`gu_ga_cri_ralliement`) · Cri d’effroi (`gu_ga_cri_effroi`) · Second souffle (`gu_ga_cri_souffle`) |
| `bouclier_forme` | Coup de bouclier | Charge au bouclier (`gu_ga_charge_bouclier`) · Bouclier écrasant (`gu_ga_bouclier_ecrasant`) |
| `riposte_forme` | Riposte | Riposte vengeresse (`gu_ga_riposte_vengeresse`) · Riposte déséquilibrante (`gu_ga_riposte_desequilibre`) |
| `provocation_forme` | Provocation | Défi (`gu_ga_defi`) · Rempart vivant (`gu_ga_rempart_vivant`) |
| `bastion_forme` | Bastion | Bastion mobile (`gu_ga_bastion_mobile`) · Bastion épineux (`gu_ga_bastion_epineux`) |
| `tourbillon_forme` | Tourbillon | Tourbillon sanglant (`gu_be_tourbillon_sanglant`) · Tourbillon ambulant (`gu_be_tourbillon_ambulant`) · Tourbillon aspirant (`gu_be_tourbillon_aspirant`) |
| `rage_forme` | Rage sanguinaire | Rage froide (`gu_be_rage_froide`) · Frénésie (`gu_be_frenesie`) |
| `entaille_forme` | Entaille | Entaille profonde (`gu_be_entaille_profonde`) · Hémorragie (`gu_be_hemorragie`) |
| `bond_forme` | Bond fracassant | Bond du prédateur (`gu_be_bond_predateur`) · Onde de choc (`gu_be_onde_choc`) |
| `execution_forme` | Exécution | Couperet (`gu_be_couperet`) · Décapitation (`gu_be_decapitation`) |
| `estocade_forme` | Estocade | Estocade double (`gu_md_estocade_double`) · Fente foudroyante (`gu_md_fente_foudroyante`) |
| `frappe_cadence` | Frappe | Troisième temps (`gu_md_troisieme_temps`) · Taille et pointe (`gu_md_taille_pointe`) |
| `danse_forme` | Danse des lames | Tempête d’acier (`gu_md_tempete_acier`) · Lame finale (`gu_md_lame_finale`) |
| `brise_garde_forme` | Brise-garde | Point faible (`gu_md_point_faible`) · Coup de taille (`gu_md_coup_de_taille`) |
| `pas_forme` | Pas de lame | Pas fantôme (`gu_md_pas_fantome`) · Pas tranchant (`gu_md_pas_tranchant`) |

## 7. Mage (75 nœuds : 16 compétences, 38 variantes, 16 passifs, 5 clés de voûte)

Fragile, engagé, sous pression de mana : les incantations sont annulées par une roulade, les canalisations immobiles
vident l'endurance, le Météore s'affiche au sol 1 s avant l'impact. Le **Trait arcanique** (id `firebolt` conservé)
est neutre ; son **Affinité** (feu, givre ou éclat, dans chaque branche) et sa **Forme** (jumeaux ou perçant, près du
départ) le transforment. Trois branches sur le même gabarit : **Pyromancie** (brûler puis faire détoner),
**Arcanes** (la pierre-astre : mana, soin, mobilité), **Givre** (ralentir puis briser). *Érudit martial* (clé de voûte
vers la Lame spirituelle) réduit l'Inaptitude des compétences de Guerrier.

### 7.1 Capacités

| id | Nom | Type | Coût (mana + end.) | Recharge | Portée | Puissance | Poise | Engagement | Arme | Étiquettes | Origine |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `firebolt` | **Trait arcanique** *(base)* | projectile | 0 + 7 | 1,6 s | 18 m | ×0,8 | 3 | récup. 0,35 s à 30 % | focalisateur (sinon −20 %) | arcane, projectile, sort | Mage |
| `fireball` | **Boule de feu** *(v0.2)* | projectile | 20 + 14 | 6 s | 18 m | ×2 | 16 | incant. 0,35 s · récup. 0,6 s à 25 % | focalisateur (sinon −20 %) | feu, projectile, zone, sort | Mage |
| `fire_wall` | **Mur de flammes** | zone ciblée | 28 + 12 | 16 s | 14 m | ×0,35 | 2 | incant. 0,5 s · récup. 0,5 s à 30 % | focalisateur (sinon −20 %) | feu, zone, controle, sort | Mage |
| `flame_breath` | **Souffle ardent** | canalisation | 10 + 6 (12/s) | 10 s | r 6 m | ×0,3 par tic (0,25 s) | 3 | incant. 0,2 s · canal. 2 s · récup. 0,4 s à 30 % | focalisateur (sinon −20 %) | feu, zone, canalisation, sort | Mage |
| `ignite` | **Embrasement** | zone ciblée | 22 + 10 | 12 s | 16 m / r 4 m | ×0,45 | 18 | incant. 0,3 s · récup. 0,45 s à 30 % | focalisateur (sinon −20 %) | feu, zone, sort | Mage |
| `meteor` | **Météore** | zone ciblée | 50 + 20 | 35 s | 20 m / r 4 m | ×4,2 | 70 | incant. 1,2 s · récup. 0,9 s à 25 % | focalisateur (sinon −20 %) | feu, zone, sort | Mage |
| `frost_nova` | **Nova de givre** *(v0.2)* | zone autour de soi | 25 + 16 | 12 s | r 6 m | ×1,3 | 10 | récup. 0,45 s à 30 % | focalisateur (sinon −20 %) | givre, zone, controle, sort | Mage |
| `ice_lance` | **Lance de glace** | projectile | 16 + 12 | 5 s | 20 m | ×2,4 | 22 | incant. 0,4 s · récup. 0,5 s à 25 % | focalisateur (sinon −20 %) | givre, projectile, sort | Mage |
| `ice_wall` | **Mur de glace** | invocation | 30 + 14 | 24 s | 10 m | — | 0 | incant. 0,4 s · récup. 0,5 s à 30 % | focalisateur (sinon −20 %) | givre, defense, controle, sort | Mage |
| `blizzard` | **Blizzard** | canalisation | 15 + 10 | 18 s | 18 m / r 5 m | ×0,35 par tic (0,5 s) | 2 | incant. 0,3 s · canal. 3 s · récup. 0,4 s à 30 % | focalisateur (sinon −20 %) | givre, zone, canalisation, controle, sort | Mage |
| `frost_armor` | **Armure de givre** | renfort | 25 + 0 | 25 s | — | — | 0 | incant. 0,3 s · récup. 0,3 s à 50 % | focalisateur (sinon −20 %) | givre, defense, buff, sort | Mage |
| `heal` | **Soin** *(v0.2)* | soin | 24 + 0 | 15 s | — | soin 25 % | 0 | incant. 1 s · récup. 0,3 s à 50 % | focalisateur (sinon −20 %) | arcane, soin, sort | Mage |
| `blink` | **Pas de brume** | déplacement | 18 + 20 | 7 s | 7 m | — | 0 | récup. 0,25 s à 50 % | focalisateur (sinon −20 %) | arcane, mobilite, sort | Mage |
| `mana_shield` | **Bouclier de mana** | renfort | 10 + 0 | 22 s | — | — | 0 | récup. 0,2 s à 50 % | focalisateur (sinon −20 %) | arcane, defense, buff, sort | Mage |
| `arcane_shards` | **Salve d'éclats** | projectile | 22 + 12 | 8 s | 18 m | ×0,4 ×5 | 4 | incant. 0,5 s · récup. 0,45 s à 30 % | focalisateur (sinon −20 %) | arcane, projectile, sort | Mage |
| `arcane_beam` | **Rayon astral** | canalisation | 12 + 10 (8/s) | 20 s | 18 m | ×0,45 par tic (0,25 s) | 5 | incant. 0,6 s · canal. 2,5 s · récup. 0,7 s à 25 % | focalisateur (sinon −20 %) | arcane, zone, canalisation, sort | Mage |

- **Trait arcanique** (`firebolt`) — Projectile d'énergie brute. Ses variantes lui donnent le feu, le givre ou l'éclat des astres.
  *Soulslike :* Tir automatique seulement à < 40 % de la vitesse (COMMIT.rangedMoveMax) ; 0,35 s d'engagement.
- **Boule de feu** (`fireball`) — Une boule de feu qui explose à l'impact et embrase les ennemis proches.
  *Soulslike :* Temps d'incantation 0,35 s : lancée trop tard, elle part pendant la préparation ennemie et on encaisse le coup.
- **Mur de flammes** (`fire_wall`) — Dresse une ligne de feu qui brûle tout ce qui la traverse pendant 5 s.
  *Soulslike :* Les monstres traversent le mur (ils ne le contournent pas) : c'est une zone de dégâts, pas un rempart. Puissance par tic de 0,5 s.
- **Souffle ardent** (`flame_breath`) — Canalise un cône de flammes devant soi, jusqu'à 2 s.
  *Soulslike :* Vide l'endurance (12/s) : impossible de rouler juste après une canalisation complète. Relâcher la touche arrête le souffle.
- **Embrasement** (`ignite`) — Fait détoner les brûlures des ennemis dans la zone : dégâts immédiats égaux à 120 % de la brûlure restante.
  *Soulslike :* Sans brûlure sur la cible, ne fait que ×0,45 : il faut préparer le terrain.
- **Météore** (`meteor`) — Appelle un rocher enflammé du ciel. Il s'écrase 1 s après l'incantation sur la zone marquée.
  *Soulslike :* Le mage est immobile 1,2 s puis la zone est télégraphiée 1 s (cercle orange visible par tous, y compris en JcJ). Idéal pendant la récupération d'un boss.
- **Nova de givre** (`frost_nova`) — Une onde de givre autour de soi qui inflige 2 charges de Froid aux ennemis proches.
  *Soulslike :* Instantanée : c'est le sort de dégagement du mage. 2 charges de Froid = −30 % de déplacement et −20 % de vitesse d’attaque (v0.2 : −50 %).
- **Lance de glace** (`ice_lance`) — Une lance de glace. Sur une cible Gelée ou à 2 charges de Froid ou plus : Fracas (×1,6), qui consomme le Froid.
  *Soulslike :* Gros dégâts de déséquilibre pour un sort à distance (22) : interrompt les préparations des petits monstres.
- **Mur de glace** (`ice_wall`) — Érige un mur de glace (6 m) qui bloque les monstres et les projectiles pendant 6 s.
  *Soulslike :* PV du mur = 40 % des PV max du mage. Un boss le brise d'un seul coup, une attaque télégraphiée le traverse. Pas de mur infranchissable.
- **Blizzard** (`blizzard`) — Canalise une tempête de neige sur une zone (3 s max) : chaque tic ajoute 1 charge de Froid.
  *Soulslike :* Immobile pendant la canalisation ; rouler l'arrête.
- **Armure de givre** (`frost_armor`) — Pendant 8 s : +20 % de défense et chaque ennemi qui vous frappe au corps à corps reçoit 1 charge de Froid.
  *Soulslike :* Ne protège pas de la mort en un coup : le mage reste fragile, l'armure achète une erreur, pas deux.
- **Soin** (`heal`) — Canalise 1 s pour rendre 25 % de vos PV.
  *Soulslike :* v0.2 : 35 % instantané toutes les 8 s (trop fort). Une roulade annule le soin (la mana n'est pas dépensée) : on se soigne dans les fenêtres de récupération ennemies, comme une fiole.
- **Pas de brume** (`blink`) — Se téléporte de 7 m dans la direction du mouvement (0,15 s d'invulnérabilité).
  *Soulslike :* Moins d'invulnérabilité que la roulade (0,15 s contre 0,35 s) mais plus de distance ; ne traverse pas les murs ni les murs de glace ; partage 0,6 s de délai avec la roulade.
- **Bouclier de mana** (`mana_shield`) — Pendant 6 s, 40 % des dégâts subis sont prélevés sur la mana (1,5 mana par point) au lieu des PV.
  *Soulslike :* La régénération de mana est coupée pendant le bouclier ; il se brise à 0 mana. Le mage paie sa survie avec ses sorts.
- **Salve d'éclats** (`arcane_shards`) — Lance 5 éclats de pierre-astre qui cherchent leur cible (×0,4 chacun).
  *Soulslike :* Les éclats partent en éventail puis convergent : ils touchent les cibles qui bougent mais pas derrière un obstacle.
- **Rayon astral** (`arcane_beam`) — Après 0,6 s d'incantation, canalise un rayon de 18 m pendant 2,5 s qui transperce tout.
  *Soulslike :* Immobile et orienté : un monstre qui contourne le mage le sort du rayon. Coût total ≈ 47 mana pour 2,5 s.

### 7.2 Nœuds

#### Tronc (3 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `ma_v_bolt_jumeaux` | Variante | **Traits jumeaux** | Tire 2 traits à ±5° (×0,5 chacun, ×1,0 si les deux touchent). Endurance 7 → 9. *(groupe `ma_g_bolt_forme`)* | 1 | 2/1/2 | -447, -125 | `mage_depart` |
| `ma_v_bolt_percant` | Variante | **Trait perçant** | Traverse la première cible (×0,6 sur la seconde). Déséquilibre 3 → 6, recharge 1,6 → 1,8 s. *(groupe `ma_g_bolt_forme`)* | 1 | 2/1/2 | -332, -325 | `mage_depart` |
| `mage_depart` | Compétence | **Éveil du mage** | Nœud de départ du Mage (gratuit, acquis à la création) : Trait arcanique. Ses voisins s'ouvrent après 3 Fondamentaux. | 1 | départ (2/0/2) | -433, -250 | `sv_seuil_arcanes` `ma_v_bolt_jumeaux` `ma_v_bolt_percant` `ma_fireball` `ma_heal` `ma_frost_nova` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Traits jumeaux* (`ma_v_bolt_jumeaux`) : Deux traits plus fins qui s'enroulent l'un autour de l'autre.
- *Trait perçant* (`ma_v_bolt_percant`) : Aiguille d'énergie allongée, onde annulaire au passage.

#### Givre (22 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `ma_v_bolt_givre` | Variante | **Trait de givre** | Le Trait devient du givre : puissance 0,8 → 0,7, un trait sur deux inflige 1 charge de Froid (2,5 s). *(groupe `ma_g_bolt_affinite`)* | 1 | 2/1/2 | -257, -514 | `ma_frost_nova` |
| `ma_frost_nova` | Compétence | **Nova de givre** | Une onde de givre autour de soi qui inflige 2 charges de Froid aux ennemis proches. | 1 | 2/1/2 | -369, -547 | `mage_depart` `ma_v_nova_glaciale` `ma_v_nova_eclats` `ma_v_bolt_givre` `ma_p_vigueur_erudit` |
| `ma_v_nova_eclats` | Variante | **Nova d'éclats** | Puissance 1,3 → 1,8, rayon 6 → 4,5 m, n'applique qu'1 charge de Froid. *(groupe `ma_g_frost_nova`)* | 1 | 2/1/2 | -329, -658 | `ma_frost_nova` |
| `ma_v_nova_glaciale` | Variante | **Nova glaciale** | Gèle 1 s les ennemis non-boss qui avaient déjà du Froid ; les autres reçoivent 2 charges. Recharge 12 → 16 s. *(groupe `ma_g_frost_nova`)* | 1 | 2/1/2 | -487, -552 | `ma_frost_nova` |
| `ma_p_vigueur_erudit` | Passif | **Vigueur de l'érudit** | +5 % de PV maximum par rang. | 2 | 2/1/2 | -442, -655 | `ma_frost_nova` `ma_ice_lance` `mr_p_seve_arcanique` |
| `ma_ice_lance` | Compétence | **Lance de glace** | Une lance de glace. Sur une cible Gelée ou à 2 charges de Froid ou plus : Fracas (×1,6), qui consomme le Froid. | 1 | 2/1/2 | -492, -730 | `ma_p_vigueur_erudit` `ma_v_lance_trio` `ma_v_lance_glacier` `ma_p_morsure_froid` |
| `ma_v_lance_trio` | Variante | **Triple lance** | 3 lances en éventail de 20° (×1,1 chacune) ; le Fracas ne s'applique qu'à la première qui touche. *(groupe `ma_g_ice_lance`)* | 1 | 2/1/2 | -604, -726 | `ma_ice_lance` |
| `ma_v_lance_glacier` | Variante | **Lance-glacier** | Traverse tous les ennemis sur 20 m ; puissance 2,4 → 2,1, incantation 0,4 → 0,7 s. *(groupe `ma_g_ice_lance`)* | 1 | 2/1/2 | -447, -832 | `ma_ice_lance` |
| `ma_p_morsure_froid` | Passif | **Morsure du froid** | +4 % de dégâts de givre par rang. | 3 | 2/1/2 | -565, -837 | `ma_ice_lance` `ma_ice_wall` `ma_frost_armor` |
| `ma_v_wall_prison` | Variante | **Prison de glace** | Au lieu d'un mur, enferme un monstre non-boss 2,5 s (il ne peut ni agir ni subir de dégâts). Recharge 24 → 28 s. *(groupe `ma_g_ice_wall`)* | 1 | 2/1/2 | -742, -742 | `ma_ice_wall` |
| `ma_v_armor_carapace` | Variante | **Carapace** | Plus de bonus de défense : absorbe entièrement un coup (jusqu'à 25 % des PV max) puis se brise. *(groupe `ma_g_frost_armor`)* | 1 | 2/1/2 | -410, -966 | `ma_frost_armor` |
| `ma_ice_wall` | Compétence | **Mur de glace** | Érige un mur de glace (6 m) qui bloque les monstres et les projectiles pendant 6 s. | 1 | 2/1/2 | -706, -850 | `ma_p_morsure_froid` `ma_v_wall_prison` `ma_v_wall_herisse` `ma_p_hiver_long` `ma_p_coeur_gele` |
| `ma_frost_armor` | Compétence | **Armure de givre** | Pendant 8 s : +20 % de défense et chaque ennemi qui vous frappe au corps à corps reçoit 1 charge de Froid. | 1 | 2/1/2 | -524, -973 | `ma_p_morsure_froid` `ma_v_armor_carapace` `ma_v_armor_aurore` `ma_p_peau_de_givre` `ma_p_coeur_gele` |
| `ma_v_wall_herisse` | Variante | **Mur hérissé** | PV du mur −30 % ; chaque coup de mêlée contre lui renvoie ×0,4 et 1 charge de Froid ; il explose en se brisant (×0,8 dans 3 m). *(groupe `ma_g_ice_wall`)* | 1 | 2/1/2 | -823, -844 | `ma_ice_wall` |
| `ma_v_armor_aurore` | Variante | **Aurore boréale** | Plus de bonus de défense : les ennemis à moins de 3 m reçoivent 1 charge de Froid par seconde. *(groupe `ma_g_frost_armor`)* | 1 | 2/1/2 | -475, -1079 | `ma_frost_armor` |
| `ma_p_coeur_gele` | Passif | **Cœur gelé** | +8 % de dégâts contre les cibles ralenties par rang. | 3 | 2/1/2 | -705, -1045 | `ma_ice_wall` `ma_frost_armor` `ma_blizzard` |
| `ma_p_hiver_long` | Passif | **Hiver long** | Vos charges de Froid durent 0,5 s de plus par rang. | 2 | 2/1/2 | -861, -963 | `ma_ice_wall` `ma_p_poids_des_astres` |
| `ma_p_peau_de_givre` | Passif | **Peau de givre** | +5 % de défense par rang. | 2 | 2/1/2 | -571, -1159 | `ma_frost_armor` |
| `ma_blizzard` | Compétence | **Blizzard** | Canalise une tempête de neige sur une zone (3 s max) : chaque tic ajoute 1 charge de Froid. | 1 | 2/1/2 | -772, -1144 | `ma_p_coeur_gele` `ma_v_blizzard_errant` `ma_v_blizzard_oeil` `ma_ks_hiver_eternel` |
| `ma_v_blizzard_errant` | Variante | **Tempête errante** | Le blizzard vous suit (rayon 4 m) et vous pouvez marcher à 50 % ; tics −20 %. *(groupe `ma_g_blizzard`)* | 1 | 2/1/2 | -888, -1138 | `ma_blizzard` |
| `ma_v_blizzard_oeil` | Variante | **Œil du blizzard** | Rayon 5 → 3,5 m, tics +40 % ; à la fin, gèle 1 s les non-boss à 3 charges. *(groupe `ma_g_blizzard`)* | 1 | 2/1/2 | -722, -1250 | `ma_blizzard` |
| `ma_ks_hiver_eternel` | Clé de voûte | **Hiver éternel** | À 3 charges de Froid, un monstre non-boss est Gelé 1,2 s (puis immunisé 8 s) ; un boss subit +25 % de déséquilibre pendant 3 s ; vos dégâts de givre augmentent de 20 %. En contrepartie : vos dégâts de feu −40 % et votre vitesse −8 %. | 1 | 3/1/3 | -850, -1260 | `ma_blizzard` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Trait de givre* (`ma_v_bolt_givre`) : Écharde de glace bleu pâle, brume froide.
- *Nova d'éclats* (`ma_v_nova_eclats`) : Éclats de glace tranchants projetés en étoile.
- *Nova glaciale* (`ma_v_nova_glaciale`) : Les ennemis sont pris dans des blocs de glace.
- *Triple lance* (`ma_v_lance_trio`) : Trois lances fines en éventail.
- *Lance-glacier* (`ma_v_lance_glacier`) : Longue stalactite qui laisse une traînée de givre au sol.
- *Prison de glace* (`ma_v_wall_prison`) : Bloc de glace autour du monstre, qui craque avant de céder.
- *Carapace* (`ma_v_armor_carapace`) : Coquille de glace translucide qui éclate.
- *Mur hérissé* (`ma_v_wall_herisse`) : Mur couvert de pics de glace.
- *Aurore boréale* (`ma_v_armor_aurore`) : Rubans d'aurore verte et bleue autour du mage.
- *Tempête errante* (`ma_v_blizzard_errant`) : Tourbillon de neige centré sur le mage.
- *Œil du blizzard* (`ma_v_blizzard_oeil`) : Vortex dense en spirale, éclatement de glace à la fin.

#### Arcanes (26 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `ma_v_bolt_eclat` | Variante | **Trait d'éclat** | Reste arcanique ; vitesse 22 → 32 m/s, portée 18 → 22 m, puissance 0,8 → 0,85. *(groupe `ma_g_bolt_affinite`)* | 1 | 2/1/2 | -531, -220 | `ma_heal` |
| `ma_heal` | Compétence | **Soin** | Canalise 1 s pour rendre 25 % de vos PV. | 1 | 2/1/2 | -572, -330 | `mage_depart` `ma_v_heal_remanence` `ma_v_heal_sursaut` `ma_v_heal_cercle` `ma_v_bolt_eclat` `ma_p_esprit_vif` |
| `ma_v_heal_cercle` | Variante | **Cercle de soin** | Soigne aussi les alliés à 6 m (20 % chacun ; vous 25 %). Canalisation 1 → 1,4 s. *(groupe `ma_g_heal`)* | 1 | 2/1/2 | -483, -464 | `ma_heal` |
| `ma_v_heal_sursaut` | Variante | **Sursaut** | Soin instantané de 20 % (pas de canalisation), recharge 15 s. *(groupe `ma_g_heal`)* | 1 | 2/1/2 | -585, -447 | `ma_heal` |
| `ma_v_heal_remanence` | Variante | **Rémanence** | Soin sur la durée : 35 % en 6 s, sans canalisation (on peut agir). Recharge 15 → 18 s. *(groupe `ma_g_heal`)* | 1 | 2/1/2 | -680, -283 | `ma_heal` |
| `ma_p_esprit_vif` | Passif | **Esprit vif** | +6 % de mana maximale par rang. | 3 | 2/1/2 | -684, -395 | `ma_heal` `ma_blink` |
| `ma_blink` | Compétence | **Pas de brume** | Se téléporte de 7 m dans la direction du mouvement (0,15 s d'invulnérabilité). | 1 | 2/1/2 | -762, -440 | `ma_p_esprit_vif` `ma_v_blink_leurre` `ma_v_blink_dechirure` `ma_v_blink_redouble` `ma_p_meditation` |
| `ma_v_blink_redouble` | Variante | **Pas redoublé** | 2 charges (9 s chacune) mais 5 m au lieu de 7. *(groupe `ma_g_blink`)* | 1 | 2/1/2 | -836, -292 | `ma_blink` |
| `ma_v_blink_dechirure` | Variante | **Déchirure** | À l'arrivée : ×0,6 d'arcane dans 2,5 m et 12 de déséquilibre. *(groupe `ma_g_blink`)* | 1 | 2/1/2 | -767, -552 | `ma_blink` |
| `ma_v_blink_leurre` | Variante | **Double spectral** | Laisse un double 2 s qui attire les monstres non-boss. Recharge 7 → 10 s. *(groupe `ma_g_blink`)* | 1 | 2/1/2 | -862, -388 | `ma_blink` |
| `ma_p_meditation` | Passif | **Méditation** | +10 % de régénération de mana en combat par rang. | 3 | 2/1/2 | -875, -505 | `ma_blink` `ma_mana_shield` `ma_arcane_shards` |
| `ma_v_shards_orbite` | Variante | **Éclats en orbite** | Les éclats tournent autour de vous 6 s et partent seuls vers les ennemis à moins de 5 m (1 toutes les 0,6 s). *(groupe `ma_g_arcane_shards`)* | 1 | 2/1/2 | -792, -688 | `ma_arcane_shards` |
| `ma_v_shield_miroir` | Variante | **Égide miroir** | Pendant les 0,6 premières secondes, renvoie les projectiles (60 % des dégâts) ; durée 6 → 3 s. *(groupe `ma_g_mana_shield`)* | 1 | 2/1/2 | -992, -342 | `ma_mana_shield` |
| `ma_arcane_shards` | Compétence | **Salve d'éclats** | Lance 5 éclats de pierre-astre qui cherchent leur cible (×0,4 chacun). | 1 | 2/1/2 | -898, -645 | `ma_p_meditation` `ma_v_shards_orbite` `ma_v_shards_concentree` `ma_p_poids_des_astres` `ma_p_clarte` |
| `ma_mana_shield` | Compétence | **Bouclier de mana** | Pendant 6 s, 40 % des dégâts subis sont prélevés sur la mana (1,5 mana par point) au lieu des PV. | 1 | 2/1/2 | -1008, -455 | `ma_p_meditation` `ma_v_shield_miroir` `ma_v_shield_rempart` `ma_p_doigts_agiles` `ma_p_clarte` |
| `ma_v_shield_rempart` | Variante | **Rempart** | Absorption 40 → 60 %, mais −30 % de vitesse pendant le bouclier. *(groupe `ma_g_mana_shield`)* | 1 | 2/1/2 | -1110, -398 | `ma_mana_shield` |
| `ma_v_shards_concentree` | Variante | **Salve concentrée** | Les 5 éclats fusionnent en une seule pointe : ×2,2, déséquilibre 25, sans guidage. *(groupe `ma_g_arcane_shards`)* | 1 | 2/1/2 | -900, -762 | `ma_arcane_shards` |
| `ma_p_clarte` | Passif | **Clarté** | +5 % de dégâts d'arcane par rang. | 3 | 2/1/2 | -1091, -630 | `ma_mana_shield` `ma_arcane_shards` `ma_arcane_beam` |
| `ma_p_doigts_agiles` | Passif | **Doigts agiles** | −6 % de temps d'incantation par rang (pas la récupération). | 2 | 2/1/2 | -1196, -488 | `ma_mana_shield` `ma_p_etincelle` `ma_ks_pacte_sang_lune` |
| `ma_p_poids_des_astres` | Passif | **Poids des astres** | +15 % de dégâts de déséquilibre des sorts par rang. | 2 | 2/1/2 | -1021, -792 | `ma_arcane_shards` `ma_p_hiver_long` `ma_p_focalisation` |
| `ma_arcane_beam` | Compétence | **Rayon astral** | Après 0,6 s d'incantation, canalise un rayon de 18 m pendant 2,5 s qui transperce tout. | 1 | 2/1/2 | -1195, -690 | `ma_p_clarte` `ma_v_beam_balayage` `ma_v_beam_comete` `ma_ks_grand_rituel` |
| `ma_ks_pacte_sang_lune` | Clé de voûte | **Pacte de la lune de sang** | Quand la mana manque, le sort se paie en PV (1 PV par point de mana manquant) ; refusé si cela vous ferait passer sous 10 % de PV. En contrepartie : mana maximale −25 % et potions de mana deux fois moins efficaces. | 1 | 3/1/3 | -1339, -501 | `ma_p_doigts_agiles` |
| `ma_p_focalisation` | Passif | **Focalisation** | −5 % de coût en mana de tous vos sorts par rang. | 2 | 2/1/2 | -1104, -909 | `ma_p_poids_des_astres` |
| `ma_v_beam_balayage` | Variante | **Rayon balayant** | Vous pouvez pivoter (45°/s) pendant le rayon ; durée 2,5 → 2 s. *(groupe `ma_g_arcane_beam`)* | 1 | 2/1/2 | -1297, -633 | `ma_arcane_beam` |
| `ma_v_beam_comete` | Variante | **Grande comète** | Plus de canalisation : incantation 1,4 s puis un seul tir colossal (×4,0, déséquilibre 90) sur 18 m. Mana 45. *(groupe `ma_g_arcane_beam`)* | 1 | 2/1/2 | -1197, -807 | `ma_arcane_beam` |
| `ma_ks_grand_rituel` | Clé de voûte | **Grand rituel** | Vos sorts (hors attaque de base) gagnent +35 % de puissance et +50 % de déséquilibre. En contrepartie, leurs incantations durent 50 % plus longtemps (au moins +0,3 s) et leur récupération 30 % de plus. | 1 | 3/1/3 | -1316, -760 | `ma_arcane_beam` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Trait d'éclat* (`ma_v_bolt_eclat`) : Éclat de pierre-astre bleu-violet, traînée de poussière d'étoiles.
- *Cercle de soin* (`ma_v_heal_cercle`) : Grand glyphe circulaire au sol, colonnes de lumière sur les alliés.
- *Sursaut* (`ma_v_heal_sursaut`) : Éclair de lumière bref, étincelles dorées.
- *Rémanence* (`ma_v_heal_remanence`) : Lucioles bleu-vert qui montent lentement autour du mage.
- *Pas redoublé* (`ma_v_blink_redouble`) : Deux éclairs bleus successifs plus courts.
- *Déchirure* (`ma_v_blink_dechirure`) : Faille violette qui se referme d'un coup sec.
- *Double spectral* (`ma_v_blink_leurre`) : Image rémanente translucide qui s'effrite.
- *Éclats en orbite* (`ma_v_shards_orbite`) : Cinq pierres lumineuses en orbite.
- *Égide miroir* (`ma_v_shield_miroir`) : Panneau hexagonal miroitant qui flashe au renvoi.
- *Rempart* (`ma_v_shield_rempart`) : Dôme épais et opaque, runes qui tournent.
- *Salve concentrée* (`ma_v_shards_concentree`) : Une longue pointe de pierre-astre.
- *Rayon balayant* (`ma_v_beam_balayage`) : Rayon qui balaie, arc brûlé au sol.
- *Grande comète* (`ma_v_beam_comete`) : Comète de pierre-astre avec traînée de ciel étoilé.

#### Pyromancie (24 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `ma_v_bolt_feu` | Variante | **Trait de feu** | Le Trait devient du feu (tag feu) et inflige Brûlure (30 % du coup en 3 s). Retour de l'identité v0.2. *(groupe `ma_g_bolt_affinite`)* | 1 | 2/1/2 | -574, 35 | `ma_fireball` |
| `ma_fireball` | Compétence | **Boule de feu** | Une boule de feu qui explose à l'impact et embrase les ennemis proches. | 1 | 2/1/2 | -658, -46 | `mage_depart` `ma_v_fireball_grande` `ma_v_fireball_chapelet` `ma_v_fireball_collante` `ma_v_bolt_feu` `ma_p_flamme_attisee` |
| `ma_v_fireball_collante` | Variante | **Boule collante** | Se colle à la cible et explose après 1,5 s : ×2,6, déséquilibre 16 → 34 ; ne touche qu'elle. *(groupe `ma_g_fireball`)* | 1 | 2/1/2 | -660, 114 | `ma_fireball` |
| `ma_v_fireball_grande` | Variante | **Grande boule de feu** | Puissance 2,0 → 2,8, explosion 2 → 3,5 m (60 %), incantation 0,35 → 0,8 s, mana 20 → 30, vitesse 16 → 12 m/s. *(groupe `ma_g_fireball`)* | 1 | 2/1/2 | -735, 44 | `ma_fireball` |
| `ma_v_fireball_chapelet` | Variante | **Chapelet de braises** | À l'impact (×1,5), se divise en 3 braises qui retombent à 3 m (×0,5 chacune, brûlure). *(groupe `ma_g_fireball`)* | 1 | 2/1/2 | -722, -146 | `ma_fireball` |
| `ma_p_flamme_attisee` | Passif | **Flamme attisée** | +3 % de dégâts de feu par rang. | 3 | 2/1/2 | -788, -55 | `ma_fireball` `ma_fire_wall` `gm_onde_tranchante` |
| `ma_fire_wall` | Compétence | **Mur de flammes** | Dresse une ligne de feu qui brûle tout ce qui la traverse pendant 5 s. | 1 | 2/1/2 | -878, -61 | `ma_p_flamme_attisee` `ma_v_fire_wall_cercle` `ma_v_fire_wall_vague` `ma_p_braises_tenaces` |
| `ma_v_fire_wall_cercle` | Variante | **Cercle de flammes** | Le mur devient un anneau de 3 m de rayon centré sur vous ; durée 5 → 4 s. *(groupe `ma_g_fire_wall`)* | 1 | 2/1/2 | -944, 29 | `ma_fire_wall` |
| `ma_v_fire_wall_vague` | Variante | **Vague de flammes** | Le mur avance de 10 m à 4 m/s et touche chaque ennemi une fois (×1,2, brûlure) ; ne persiste pas. *(groupe `ma_g_fire_wall`)* | 1 | 2/1/2 | -931, -160 | `ma_fire_wall` |
| `ma_p_braises_tenaces` | Passif | **Braises tenaces** | Vos brûlures durent 1 s de plus par rang (même total de dégâts par seconde). | 2 | 2/1/2 | -1008, -70 | `ma_fire_wall` `ma_flame_breath` `ma_ignite` |
| `ma_v_breath_dragon` | Variante | **Souffle du dragon** | Cône 6 → 9 m mais 70 → 50°, tics +25 %, endurance 12 → 18 par seconde. *(groupe `ma_g_flame_breath`)* | 1 | 2/1/2 | -1041, 128 | `ma_flame_breath` |
| `ma_v_ignite_contagion` | Variante | **Contagion** | Les brûlures consommées se propagent (brûlure complète) aux ennemis à 4 m des cibles. *(groupe `ma_g_ignite`)* | 1 | 2/1/2 | -1014, -271 | `ma_ignite` |
| `ma_flame_breath` | Compétence | **Souffle ardent** | Canalise un cône de flammes devant soi, jusqu'à 2 s. | 1 | 2/1/2 | -1105, 33 | `ma_p_braises_tenaces` `ma_v_breath_dragon` `ma_v_breath_cendres` `ma_p_sang_chaud` `ma_p_fournaise` |
| `ma_ignite` | Compétence | **Embrasement** | Fait détoner les brûlures des ennemis dans la zone : dégâts immédiats égaux à 120 % de la brûlure restante. | 1 | 2/1/2 | -1090, -186 | `ma_p_braises_tenaces` `ma_v_ignite_contagion` `ma_v_ignite_detonation` `ma_p_etincelle` `ma_p_fournaise` |
| `ma_v_breath_cendres` | Variante | **Cendres aveuglantes** | Tics −30 %, les ennemis touchés sont Aveuglés (−20 % de dégâts, 3 s). *(groupe `ma_g_flame_breath`)* | 1 | 2/1/2 | -1172, 129 | `ma_flame_breath` |
| `ma_v_ignite_detonation` | Variante | **Détonation** | 160 % de la brûlure restante au lieu de 120 %, déséquilibre +30, mais rayon 4 → 2,5 m. *(groupe `ma_g_ignite`)* | 1 | 2/1/2 | -1143, -290 | `ma_ignite` |
| `ma_ks_erudit_martial` | Clé de voûte | **Érudit martial** | Votre bâton ou sceptre compte comme une arme de mêlée : les compétences de mêlée ne sont plus grisées (−15 % de puissance au bâton). L'Inaptitude des compétences de Guerrier est réduite de moitié. En contrepartie, vos sorts coûtent 10 % de mana en plus. | 1 | 3/1/3 | -1198, 217 | `ma_p_sang_chaud` |
| `ma_p_fournaise` | Passif | **Fournaise** | +4 % de dégâts de feu par rang. | 3 | 2/1/2 | -1257, -88 | `ma_flame_breath` `ma_ignite` `ma_meteor` |
| `ma_p_sang_chaud` | Passif | **Sang chaud** | Vos sorts de feu coûtent 10 % d'endurance en moins. | 1 | 2/1/2 | -1289, 85 | `ma_flame_breath` `ma_ks_erudit_martial` |
| `ma_p_etincelle` | Passif | **Étincelle** | +3 % de chances de critique contre les cibles qui brûlent, par rang. | 2 | 2/1/2 | -1265, -264 | `ma_ignite` `ma_p_doigts_agiles` |
| `ma_meteor` | Compétence | **Météore** | Appelle un rocher enflammé du ciel. Il s'écrase 1 s après l'incantation sur la zone marquée. | 1 | 2/1/2 | -1377, -96 | `ma_p_fournaise` `ma_v_meteor_pluie` `ma_v_meteor_astre` `ma_ks_coeur_de_braise` |
| `ma_v_meteor_pluie` | Variante | **Pluie de météores** | 3 météores plus petits (×1,6, rayon 2,5 m) tombent au hasard dans 6 m en 1,5 s. *(groupe `ma_g_meteor`)* | 1 | 2/1/2 | -1443, -1 | `ma_meteor` |
| `ma_v_meteor_astre` | Variante | **Astre déchu** | Puissance 4,2 → 5,5, déséquilibre 70 → 110, incantation 1,2 → 1,8 s, mana 50 → 65. *(groupe `ma_g_meteor`)* | 1 | 2/1/2 | -1430, -200 | `ma_meteor` |
| `ma_ks_coeur_de_braise` | Clé de voûte | **Cœur de braise** | Vos brûlures se cumulent jusqu'à 3 fois (chacune avec sa durée) et vos dégâts de feu augmentent de 20 %. En contrepartie, vous subissez 15 % de dégâts en plus. | 1 | 3/1/3 | -1516, -106 | `ma_meteor` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Trait de feu* (`ma_v_bolt_feu`) : Braise orange, traînée d'étincelles.
- *Boule collante* (`ma_v_fireball_collante`) : Boule qui s'accroche et pulse de plus en plus vite avant d'exploser.
- *Grande boule de feu* (`ma_v_fireball_grande`) : Sphère deux fois plus grosse, fumée lourde, explosion en champignon.
- *Chapelet de braises* (`ma_v_fireball_chapelet`) : La boule éclate en trois braises qui décrivent des arcs.
- *Cercle de flammes* (`ma_v_fire_wall_cercle`) : Anneau de feu autour du mage.
- *Vague de flammes* (`ma_v_fire_wall_vague`) : Mur de feu qui déferle comme une vague.
- *Souffle du dragon* (`ma_v_breath_dragon`) : Long jet de flammes, gueule de dragon esquissée dans le feu.
- *Contagion* (`ma_v_ignite_contagion`) : Filaments de feu qui relient les ennemis.
- *Cendres aveuglantes* (`ma_v_breath_cendres`) : Nuage de cendres grises et braises.
- *Détonation* (`ma_v_ignite_detonation`) : Flash blanc puis colonne de feu.
- *Pluie de météores* (`ma_v_meteor_pluie`) : Trois rochers en feu en traînées obliques.
- *Astre déchu* (`ma_v_meteor_astre`) : Énorme météore à traînée rouge et or, cratère persistant.


**Groupes de variantes** :

| Groupe | Capacité | Options (une seule au choix) |
|---|---|---|
| `ma_g_bolt_forme` | Trait arcanique | Traits jumeaux (`ma_v_bolt_jumeaux`) · Trait perçant (`ma_v_bolt_percant`) |
| `ma_g_fireball` | Boule de feu | Grande boule de feu (`ma_v_fireball_grande`) · Chapelet de braises (`ma_v_fireball_chapelet`) · Boule collante (`ma_v_fireball_collante`) |
| `ma_g_bolt_affinite` | Trait arcanique | Trait de feu (`ma_v_bolt_feu`) · Trait d'éclat (`ma_v_bolt_eclat`) · Trait de givre (`ma_v_bolt_givre`) |
| `ma_g_fire_wall` | Mur de flammes | Cercle de flammes (`ma_v_fire_wall_cercle`) · Vague de flammes (`ma_v_fire_wall_vague`) |
| `ma_g_flame_breath` | Souffle ardent | Souffle du dragon (`ma_v_breath_dragon`) · Cendres aveuglantes (`ma_v_breath_cendres`) |
| `ma_g_ignite` | Embrasement | Contagion (`ma_v_ignite_contagion`) · Détonation (`ma_v_ignite_detonation`) |
| `ma_g_meteor` | Météore | Pluie de météores (`ma_v_meteor_pluie`) · Astre déchu (`ma_v_meteor_astre`) |
| `ma_g_heal` | Soin | Rémanence (`ma_v_heal_remanence`) · Sursaut (`ma_v_heal_sursaut`) · Cercle de soin (`ma_v_heal_cercle`) |
| `ma_g_blink` | Pas de brume | Double spectral (`ma_v_blink_leurre`) · Déchirure (`ma_v_blink_dechirure`) · Pas redoublé (`ma_v_blink_redouble`) |
| `ma_g_mana_shield` | Bouclier de mana | Égide miroir (`ma_v_shield_miroir`) · Rempart (`ma_v_shield_rempart`) |
| `ma_g_arcane_shards` | Salve d'éclats | Éclats en orbite (`ma_v_shards_orbite`) · Salve concentrée (`ma_v_shards_concentree`) |
| `ma_g_arcane_beam` | Rayon astral | Rayon balayant (`ma_v_beam_balayage`) · Grande comète (`ma_v_beam_comete`) |
| `ma_g_frost_nova` | Nova de givre | Nova glaciale (`ma_v_nova_glaciale`) · Nova d'éclats (`ma_v_nova_eclats`) |
| `ma_g_ice_lance` | Lance de glace | Triple lance (`ma_v_lance_trio`) · Lance-glacier (`ma_v_lance_glacier`) |
| `ma_g_ice_wall` | Mur de glace | Prison de glace (`ma_v_wall_prison`) · Mur hérissé (`ma_v_wall_herisse`) |
| `ma_g_frost_armor` | Armure de givre | Carapace (`ma_v_armor_carapace`) · Aurore boréale (`ma_v_armor_aurore`) |
| `ma_g_blizzard` | Blizzard | Tempête errante (`ma_v_blizzard_errant`) · Œil du blizzard (`ma_v_blizzard_oeil`) |

## 8. Rôdeur (77 nœuds : 17 compétences, 37 variantes, 17 passifs, 6 clés de voûte)

Trois branches : **Tireur** (tirs chargés, perforation, critiques, ultime *Trait fatal*), **Traqueur** (mobilité,
pièges, marques, couteau de ceinture), **Venin** (poisons en charges, jauge de saignement, nuages). Le **Tir** a deux
groupes de variantes : *lesté* ou *véloce* près du départ, puis *ricochet*, *à bout portant* ou *pointes enduites*
dans les branches. Aucune variante ne lève la règle du tir à 40 % de la vitesse. Le seul recul outillé, le *Bond de
retrait*, coûte 28 d'endurance, 8 de mana, 10 s de recharge, 0,15 s d'invulnérabilité, et reste interdit juste après
une roulade. Ultimes et clés de voûte demandent des points dépensés dans la région (`reqRegionPoints`).

### 8.1 Capacités

| id | Nom | Type | Coût (mana + end.) | Recharge | Portée | Puissance | Poise | Engagement | Arme | Étiquettes | Origine |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `shot` | **Tir** *(base)* | projectile | 0 + 7 | 1,3 s | 20 m | ×0,85 | 3 | récup. 0,35 s à 30 % | arc ou arbalète | physique, projectile, arc | Rôdeur |
| `piercing_shot` | **Tir perçant** | projectile | 12 + 14 | 6 s | 22 m | ×1,7 | 14 | prép. 0,25 s · récup. 0,55 s à 25 % | arc ou arbalète | physique, projectile, arc, perforation | Rôdeur |
| `rapid_fire` | **Tir rapide** | canalisation | 15 + 14 | 9 s | 20 m | ×0,77 ×3 | 3 | canal. 0,6 s · récup. 0,6 s à 30 % | arc ou arbalète | physique, projectile, arc | Rôdeur |
| `arrow_rain` | **Pluie de flèches** | zone ciblée | 22 + 16 | 12 s | 20 m / r 5 m | ×1,2 | 8 | récup. 0,5 s à 30 % | arc ou arbalète | physique, zone, arc | Rôdeur |
| `fleche_assommante` | **Flèche assommante** | projectile | 10 + 18 | 10 s | 18 m | ×1,1 | 55 | prép. 0,45 s · récup. 0,6 s à 25 % | arc ou arbalète | physique, projectile, arc, controle | Rôdeur |
| `trait_fatal` | **Trait fatal** | canalisation | 35 + 25 | 40 s | 32 m | ×4 | 70 | canal. 1,5 s · récup. 0,8 s à 20 % | arc ou arbalète | physique, projectile, arc, perforation | Rôdeur |
| `coup_de_dague` | **Coup de dague** | mêlée | 0 + 12 | 4 s | 2,4 m | ×0,8 ×2 | 14 | prép. 0,15 s · récup. 0,3 s à 50 % | couteau de ceinture | physique, melee, dague | Rôdeur |
| `marque_de_chasse` | **Marque du chasseur** | marque | 10 + 0 | 12 s | 25 m | — | 0 | récup. 0,2 s à 60 % | — | marque, chasse | Rôdeur |
| `bond_de_retrait` | **Bond de retrait** | déplacement | 8 + 28 | 10 s | 6 m | ×0,6 | 3 | récup. 0,35 s à 40 % | arc ou arbalète | mobilite, arc, projectile | Rôdeur |
| `piege_a_machoires` | **Piège à mâchoires** | piège | 12 + 10 | 14 s | 3 m / r 1,2 m | ×1,5 | 30 | récup. 0,5 s à 0 % | — | physique, piege, controle | Rôdeur |
| `filet` | **Filet lesté** | projectile | 14 + 12 | 16 s | 12 m | ×0,3 | 10 | prép. 0,3 s · récup. 0,45 s à 30 % | — | controle, projectile, chasse | Rôdeur |
| `hallali` | **Hallali** | renfort | 25 + 0 | 60 s | — | — | 0 | prép. 0,3 s · récup. 0,4 s à 50 % | — | buff, chasse, marque | Rôdeur |
| `fleche_empoisonnee` | **Flèche empoisonnée** | projectile | 10 + 10 | 5 s | 20 m | ×0,8 | 3 | prép. 0,15 s · récup. 0,4 s à 30 % | arc ou arbalète | poison, projectile, arc | Rôdeur |
| `fleche_barbelee` | **Flèche barbelée** | projectile | 12 + 12 | 7 s | 20 m | ×1,2 | 8 | prép. 0,2 s · récup. 0,45 s à 30 % | arc ou arbalète | saignement, projectile, arc | Rôdeur |
| `nuage_toxique` | **Nuage toxique** | zone ciblée | 24 + 14 | 18 s | 16 m / r 4 m | — | 0 | récup. 0,55 s à 30 % | — | poison, zone | Rôdeur |
| `entaille_venimeuse` | **Entaille venimeuse** | mêlée | 8 + 16 | 8 s | 2,6 m | ×1,1 | 12 | prép. 0,2 s · récup. 0,35 s à 40 % | couteau de ceinture | poison, saignement, melee, dague | Rôdeur |
| `fleau` | **Fléau** | zone autour de soi | 30 + 10 | 35 s | r 12 m | — | 20 | prép. 0,4 s · récup. 0,6 s à 30 % | — | poison, saignement, zone | Rôdeur |

- **Tir** (`shot`) — Tir à l'arc de base.
  *Soulslike :* Attaque de base. Ne part qu'en se déplaçant à ≤ 40 % de sa vitesse (COMMIT.rangedMoveMax). Chargée (Fondamental « Attaque chargée ») : on bande l'arc 0,4 à 1 s en marchant à 25 %, ×1,6 → ×2,4, 18 de poise, perce 1 ennemi à pleine charge.
- **Tir perçant** (`piercing_shot`) — Une flèche lourde qui ignore 30 % de l'armure et transperce un premier ennemi.
  *Soulslike :* Compétence v0.2 conservée. 0,25 s de visée visible, puis 0,55 s de relâchement : à lancer pendant la récupération d'un monstre, pas pendant sa préparation.
- **Tir rapide** (`rapid_fire`) — Trois flèches en succession rapide.
  *Soulslike :* Compétence v0.2 conservée. Canalisée 0,6 s (marche à 30 %) : une roulade l'interrompt (les flèches restantes sont perdues, pas le coût).
- **Pluie de flèches** (`arrow_rain`) — Une pluie de flèches sur la zone ciblée.
  *Soulslike :* Compétence v0.2 conservée. Les flèches tombent 0,6 s après le tir (cercle visible au sol pour tous) : récompense l'anticipation de la position d'un monstre.
- **Flèche assommante** (`fleche_assommante`) — Une flèche à tête ronde qui déséquilibre ; +50 % de poise si elle touche un ennemi en pleine préparation d'attaque.
  *Soulslike :* Réponse aux télégraphes : 55 de poise déséquilibre en un coup loups (24), gobelins (28) et squelettes (44) ; pas le golem (150). 0,45 s de visée : il faut tirer dès le début de la préparation.
- **Trait fatal** (`trait_fatal`) — Vous visez 1,5 s, immobile, puis décochez un trait qui traverse tout sur 32 m.
  *Soulslike :* Ultime du Tireur. Immobile pendant la visée : une roulade l'annule et rend 50 % de la mana. Pensé pour la fenêtre de récupération d'un boss (golem : 0,9 s de récupération après son coup au sol « golem_slam »), jamais pour le kiting.
- **Coup de dague** (`coup_de_dague`) — Deux coups de couteau rapides ; votre prochain Tir dans les 2 s inflige +20 % de dégâts.
  *Soulslike :* L'option de mêlée du rôdeur : rapide (0,15 s) mais courte (2,4 m). Le couteau de ceinture est toujours là : utilisable avec un arc (dégâts de l'arme ×0,8) ou avec n'importe quelle arme de mêlée à une main.
- **Marque du chasseur** (`marque_de_chasse`) — Marque une cible 15 s : elle subit +15 % de vos dégâts et reste visible à travers la brume. Une seule marque à la fois.
  *Soulslike :* Instantanée, sans arme requise. En JcJ : +5 %. Plusieurs nœuds du Traqueur et du Chasseur s'appuient sur la cible marquée.
- **Bond de retrait** (`bond_de_retrait`) — Un bond de 6 m en arrière, puis un Tir à ×0,6 en retombant.
  *Soulslike :* Le seul recul « outillé » du rôdeur, et il coûte cher : 28 d'endurance + 8 de mana, 10 s de recharge, seulement 0,15 s d'invulnérabilité (contre 0,35 s pour la roulade). Impossible dans les 0,5 s qui suivent une roulade (pas de double fuite).
- **Piège à mâchoires** (`piege_a_machoires`) — Pose un piège (armé en 1 s) qui mord le premier ennemi : ×1,5 et immobilisé 2 s (élites 1 s, boss : ralentis de 40 %).
  *Soulslike :* On s'agenouille 0,5 s pour le poser (immobile) : il se pose AVANT le combat ou derrière soi, jamais sous un monstre en pleine attaque. 2 pièges maximum. JcJ : immobilisation 1 s.
- **Filet lesté** (`filet`) — Lance un filet qui ralentit de 60 % pendant 3 s ; il brise net la charge d'un ennemi qui s'élance.
  *Soulslike :* Contre-télégraphe : touché pendant la préparation d'une charge en ligne (loup, sanglier, troll), l'attaque est annulée et le monstre déséquilibré (sauf boss). Portée courte (12 m) : il faut laisser venir.
- **Hallali** (`hallali`) — Sonne l'hallali 10 s : +20 % de dégâts contre la cible marquée, roulades −30 % d'endurance, chaque coup sur la proie rend 3 d'endurance.
  *Soulslike :* Ultime du Traqueur : une fenêtre d'agression, pas d'invulnérabilité. Le cor se sonne (0,3 s) : à placer pendant la récupération d'un boss.
- **Flèche empoisonnée** (`fleche_empoisonnee`) — Une flèche qui ajoute une charge de poison (×0,25 par seconde pendant 6 s, jusqu'à 3 charges).
  *Soulslike :* Dégâts dans la durée : laisse le temps d'esquiver au lieu de tirer. Les dégâts de poison n'infligent pas de poise.
- **Flèche barbelée** (`fleche_barbelee`) — Ajoute 30 de saignement. À 100, la plaie éclate : ×1,5 + 6 % des PV max (boss 2 %, joueurs 4 %).
  *Soulslike :* Saignement façon soulslike : une jauge sous la barre de vie qui se vide de 10/s après 3 s sans nouvelle entaille. Récompense l'agression continue.
- **Nuage toxique** (`nuage_toxique`) — Une fiole qui éclate en nuage de 4 m pendant 6 s : 1 charge de poison par seconde, et les ennemis dedans infligent −10 % de dégâts.
  *Soulslike :* Zone de contrôle, pas de dégâts directs. La fiole est lancée à la main : pas d'arc requis. Aucun dégât aux alliés.
- **Entaille venimeuse** (`entaille_venimeuse`) — Un revers de dague en arc (×1,1) : 2 charges de poison, 20 de saignement, puis un petit saut de 2 m en arrière.
  *Soulslike :* Le petit saut n'a PAS d'invulnérabilité : il sort de l'allonge d'un coup léger, pas d'une attaque télégraphiée.
- **Fléau** (`fleau`) — Tous vos poisons dans un rayon de 12 m éclatent : 150 % des dégâts restants tout de suite, +50 de saignement, et 1 charge se propage à 4 m.
  *Soulslike :* Ultime du Venin : 0,4 s de geste visible, puis 0,6 s de récupération. Ne fait rien sans préparation (poisons déjà posés).

### 8.2 Nœuds

#### Départ (3 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `rodeur_depart` | Compétence | **Éveil du Rôdeur** | Nœud de départ du Rôdeur (gratuit) : donne l'attaque de base Tir. Les nœuds voisins s'ouvrent après 3 Fondamentaux. | 1 | départ (2/2/0) | 433, -250 | `sv_seuil_bois` `ro_tir_leste` `ro_tir_veloce` `ro_ti_main_sure` `ro_tq_pied_leger` `ro_ve_herboriste` |
| `ro_tir_leste` | Variante | **Tir lesté** | Tir : ×0,85 → ×1,1, poise 3 → 8, recharge 1,3 → 1,6 s, récupération 0,35 → 0,45 s. *(groupe `var_tir_forme`)* | 1 | 2/2/1 | 385, -374 | `rodeur_depart` |
| `ro_tir_veloce` | Variante | **Tir véloce** | Tir : ×0,85 → ×0,68, recharge 1,3 → 1,0 s, endurance 7 → 6. La règle de tir à ≤ 40 % de vitesse est inchangée. *(groupe `var_tir_forme`)* | 1 | 2/2/1 | 517, -147 | `rodeur_depart` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Tir lesté* (`ro_tir_leste`) : Flèche plus épaisse à empennage noir ; impact avec petite gerbe de poussière et léger recul de la cible.
- *Tir véloce* (`ro_tir_veloce`) : Flèche fine, traînée d'air pâle très courte ; corde qui vibre plus vite (animation Attack accélérée ×1,3).

#### Traqueur (26 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `ro_tq_pied_leger` | Passif | **Pied léger** | +3 % de vitesse de déplacement et −5 % d'endurance dépensée en sprint par rang. | 2 | 2/2/1 | 606, -129 | `rodeur_depart` `ro_tq_marque` `ro_tq_coup_de_dague` |
| `ro_tq_coup_de_dague` | Compétence | **Coup de dague** | Deux coups de couteau rapides ; votre prochain Tir dans les 2 s inflige +20 % de dégâts. | 1 | 2/2/1 | 698, -49 | `ro_tq_pied_leger` `ro_tq_dague_saignante` `ro_tq_riposte_couteau` `ro_tq_bout_portant` |
| `ro_tq_marque` | Compétence | **Marque du chasseur** | Marque une cible 15 s : elle subit +15 % de vos dégâts et reste visible à travers la brume. Une seule marque à la fois. | 1 | 2/2/1 | 692, -198 | `ro_tq_pied_leger` `ro_tq_marque_sang` `ro_tq_marque_meute` `ro_tq_acrobate` |
| `ro_tq_bout_portant` | Variante | **Tir à bout portant** | Tir : +45 % de dégâts à moins de 6 m, −20 % au-delà de 12 m. Exclusif avec « Tir ricochet » et « Pointes enduites ». *(groupe `var_tir_approche`)* | 1 | 2/2/1 | 711, 126 | `ro_tq_coup_de_dague` |
| `ro_tq_riposte_couteau` | Variante | **Riposte au couteau** | Coup de dague : dans les 0,4 s après une roulade réussie (esquive d'un coup) ou une Garde, critique garanti et +20 de poise. *(groupe `var_dague`)* | 1 | 2/2/1 | 769, 89 | `ro_tq_coup_de_dague` |
| `ro_tq_dague_saignante` | Variante | **Dague saignante** | Coup de dague : chaque coup ajoute 20 de saignement ; dégâts ×0,7+×0,9 → ×0,6+×0,8. *(groupe `var_dague`)* | 1 | 2/2/1 | 785, -14 | `ro_tq_coup_de_dague` |
| `ro_tq_marque_meute` | Variante | **Marque de la meute** | Marque du chasseur : les +15 % s'appliquent aussi aux dégâts de vos alliés ; durée 15 → 10 s. *(groupe `var_marque`)* | 1 | 2/2/1 | 797, -112 | `ro_tq_marque` |
| `ro_tq_marque_sang` | Variante | **Marque de sang** | Marque du chasseur : bonus +15 % → +6 %, mais la cible marquée accumule +30 % de saignement. *(groupe `var_marque`)* | 1 | 2/2/1 | 781, -203 | `ro_tq_marque` |
| `ro_tq_acrobate` | Passif | **Acrobate** | Saut : +0,1 s en l'air ; un Tir pendant le saut décoche 2 flèches à ×0,6 (tir aérien), suivi de 0,3 s de réception. | 1 | 2/2/1 | 886, -125 | `ro_tq_marque` `ro_tq_bond_retrait` `ro_tq_piege` `rg_instinct_chasseur` |
| `ro_tq_piege` | Compétence | **Piège à mâchoires** | Pose un piège (armé en 1 s) qui mord le premier ennemi : ×1,5 et immobilisé 2 s (élites 1 s, boss : ralentis de 40 %). | 1 | 2/2/1 | 964, -34 | `ro_tq_acrobate` `ro_tq_piege_ronces` `ro_tq_piege_explosif` `ro_tq_garde_couteau` |
| `ro_tq_bond_retrait` | Compétence | **Bond de retrait** | Un bond de 6 m en arrière, puis un Tir à ×0,6 en retombant. | 1 | 2/2/1 | 940, -217 | `ro_tq_acrobate` `ro_tq_salto_tireur` `ro_tq_bond_lateral` `ro_tq_garde_couteau` |
| `ro_tq_piege_explosif` | Variante | **Piège à poudre** | Piège : explose sur 3 m (×2,2, 45 de poise), sans immobilisation. *(groupe `var_piege`)* | 1 | 2/2/1 | 1052, 74 | `ro_tq_piege` |
| `ro_tq_salto_tireur` | Variante | **Salto tireur** | Bond de retrait : le tir final devient un Tir chargé complet (×1,6, 18 de poise) ; endurance 28 → 34. *(groupe `var_bond`)* | 1 | 2/2/1 | 1014, -291 | `ro_tq_bond_retrait` |
| `ro_tq_piege_ronces` | Variante | **Piège de ronces** | Piège : n'immobilise plus ; zone de 3 m qui ralentit de 50 % pendant 4 s et ajoute 10 de saignement par seconde. *(groupe `var_piege`)* | 1 | 2/2/1 | 1056, -39 | `ro_tq_piege` |
| `ro_tq_bond_lateral` | Variante | **Bond latéral** | Bond de retrait : dans n'importe quelle direction, 5 m, plus de tir ; recharge 10 → 8 s. *(groupe `var_bond`)* | 1 | 2/2/1 | 1059, -198 | `ro_tq_bond_retrait` |
| `ro_tq_garde_couteau` | Passif | **Garde du couteau** | Garde avec un arc en main : le couteau de ceinture pare, −20 % d'endurance par coup bloqué ; une parade parfaite (si apprise) enchaîne un Coup de dague à ×2,5. | 1 | 2/2/1 | 1139, -120 | `ro_tq_bond_retrait` `ro_tq_piege` `ro_tq_au_plus_pres` `ro_tq_filet` `ro_tq_instinct` |
| `ro_tq_au_plus_pres` | Clé de voûte | **Au plus près** | À moins de 3 m, votre Tir devient automatiquement un enchaînement de 2 coups de dague (×0,8 + ×1,0, 12 de poise) et vos compétences « dague » font +30 % de dégâts. (Demande 8 points dépensés dans la région Rôdeur.) *(8 points dans la région)* | 1 | 3/3/1 | 1146, 100 | `ro_tq_garde_couteau` |
| `ro_tq_filet` | Compétence | **Filet lesté** | Lance un filet qui ralentit de 60 % pendant 3 s ; il brise net la charge d'un ennemi qui s'élance. | 1 | 2/2/1 | 1212, -236 | `ro_tq_garde_couteau` `ro_tq_filet_acier` `ro_tq_filet_collant` `ro_tq_proie_unique` `ro_tq_hallali` |
| `ro_tq_instinct` | Passif | **Instinct du traqueur** | La zone télégraphiée des attaques de votre cible marquée apparaît 0,15 s plus tôt. | 1 | 2/2/1 | 1235, -22 | `ro_tq_garde_couteau` `ro_tq_hallali` |
| `ro_tq_filet_acier` | Variante | **Filet d'acier** | Filet lesté : immobilise 1,5 s au lieu de ralentir (boss : ralentit seulement), recharge 16 → 22 s. *(groupe `var_filet`)* | 1 | 2/2/1 | 1263, -370 | `ro_tq_filet` |
| `ro_tq_filet_collant` | Variante | **Filet collant** | Filet lesté : se déploie au sol en zone de 3 m pendant 5 s, ralentit de 50 % tout ce qui y entre. *(groupe `var_filet`)* | 1 | 2/2/1 | 1309, -207 | `ro_tq_filet` |
| `ro_tq_hallali` | Compétence | **Hallali** | Sonne l'hallali 10 s : +20 % de dégâts contre la cible marquée, roulades −30 % d'endurance, chaque coup sur la proie rend 3 d'endurance. (Demande 10 points dépensés dans la région Rôdeur.) *(10 points dans la région)* | 1 | 2/2/1 | 1365, -119 | `ro_tq_filet` `ro_tq_instinct` `ro_tq_hallali_sanglant` `ro_tq_hallali_meute` `ro_tq_fantome_brumes` |
| `ro_tq_proie_unique` | Clé de voûte | **Proie unique** | Votre Marque ne s'efface plus avant la mort de la cible et son bonus passe à +24 %. (Demande 12 points dépensés dans la région Rôdeur.) *(12 points dans la région)* | 1 | 3/3/1 | 1339, -409 | `ro_tq_filet` |
| `ro_tq_hallali_sanglant` | Variante | **Hallali sanglant** | Hallali : +30 % d'accumulation de saignement pendant l'effet ; durée 10 → 8 s. *(groupe `var_hallali`)* | 1 | 2/2/1 | 1423, -303 | `ro_tq_hallali` |
| `ro_tq_hallali_meute` | Variante | **Hallali de meute** | Hallali : les alliés à 15 m reçoivent la moitié des effets. *(groupe `var_hallali`)* | 1 | 2/2/1 | 1455, 0 | `ro_tq_hallali` |
| `ro_tq_fantome_brumes` | Clé de voûte | **Fantôme des brumes** | Une roulade qui évite un coup (esquive parfaite) vous rend invisible 1,5 s : les monstres perdent votre trace (élites 0,75 s ; les boss ne vous perdent jamais ; JcJ : 0,8 s, silhouette visible à 5 m). Recharge interne 8 s. (Demande 14 points dépensés dans la région Rôdeur.) *(14 points dans la région)* | 1 | 3/3/1 | 1472, -155 | `ro_tq_hallali` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Tir à bout portant* (`ro_tq_bout_portant`) : À courte distance, bouffée de poussière au départ et impact plus lourd, flèche à peine visible.
- *Riposte au couteau* (`ro_tq_riposte_couteau`) : Éclair blanc sur la lame et bref ralenti visuel (0,08 s) quand la riposte est déclenchée.
- *Dague saignante* (`ro_tq_dague_saignante`) : Lame qui laisse une traînée rouge sombre ; gouttes de sang stylisées à l'impact.
- *Marque de la meute* (`ro_tq_marque_meute`) : Marque dorée en tête de loup, visible par tout le groupe, avec un halo au sol autour de la cible.
- *Marque de sang* (`ro_tq_marque_sang`) : Marque en forme de griffe rouge sang qui goutte au-dessus de la cible.
- *Piège à poudre* (`ro_tq_piege_explosif`) : Petit baril de poudre noire ; explosion orangée courte avec fumée grise et éclats de bois.
- *Salto tireur* (`ro_tq_salto_tireur`) : Salto arrière complet, l'arc bandé à l'envers ; flèche chargée qui laisse une traînée brillante.
- *Piège de ronces* (`ro_tq_piege_ronces`) : Ronces noires qui jaillissent du sol en cercle et s'enroulent autour des jambes.
- *Bond latéral* (`ro_tq_bond_lateral`) : Glissade basse avec traînée de feuilles mortes et de brume au ras du sol.
- *Filet d'acier* (`ro_tq_filet_acier`) : Mailles métalliques qui scintillent ; la cible est plaquée au sol, poids aux coins du filet.
- *Filet collant* (`ro_tq_filet_collant`) : Toile de corde enduite de résine luisante étalée au sol, fils qui s'étirent sous les pas.
- *Hallali sanglant* (`ro_tq_hallali_sanglant`) : Cor en corne noire ; halo rouge autour des armes du rôdeur pendant l'effet.
- *Hallali de meute* (`ro_tq_hallali_meute`) : Onde sonore dorée qui s'étend en anneau ; petite icône de cor au-dessus des alliés touchés.

#### Tireur (24 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `ro_ti_main_sure` | Passif | **Main sûre** | +5 % de dégâts des compétences d'arc par rang. | 3 | 2/2/1 | 537, -310 | `rodeur_depart` `ro_ti_tir_percant` `ro_ti_tir_rapide` |
| `ro_ti_tir_percant` | Compétence | **Tir perçant** | Une flèche lourde qui ignore 30 % de l'armure et transperce un premier ennemi. | 1 | 2/2/1 | 582, -423 | `ro_ti_main_sure` `ro_ti_trait_breche` `ro_ti_tir_traversant` `ro_ti_oeil_exerce` |
| `ro_ti_tir_rapide` | Compétence | **Tir rapide** | Trois flèches en succession rapide. | 1 | 2/2/1 | 658, -293 | `ro_ti_main_sure` `ro_ti_salve_eventail` `ro_ti_rafale` `ro_ti_oeil_exerce` |
| `ro_ti_tir_traversant` | Variante | **Tir traversant** | Tir perçant : traverse TOUS les ennemis en ligne sur 26 m (−10 % de dégâts par ennemi traversé). *(groupe `var_tir_percant`)* | 1 | 2/2/1 | 675, -399 | `ro_ti_tir_percant` |
| `ro_ti_trait_breche` | Variante | **Trait de brèche** | Tir perçant : ne transperce plus, mais la cible perd 25 % de défense pendant 5 s (boss 15 %). *(groupe `var_tir_percant`)* | 1 | 2/2/1 | 630, -493 | `ro_ti_tir_percant` |
| `ro_ti_rafale` | Variante | **Rafale soutenue** | Tir rapide : 5 flèches sur 1 s (×0,57 chacune), marche à 20 % pendant la rafale, mana 15 → 20. *(groupe `var_tir_rapide`)* | 1 | 2/2/1 | 752, -274 | `ro_ti_tir_rapide` |
| `ro_ti_salve_eventail` | Variante | **Salve en éventail** | Tir rapide : les 3 flèches partent ensemble en éventail de 30° (×0,66 chacune, 6 de poise chacune), sans canalisation. *(groupe `var_tir_rapide`)* | 1 | 2/2/1 | 743, -339 | `ro_ti_tir_rapide` |
| `ro_ti_oeil_exerce` | Passif | **Œil exercé** | +2 % de chances de coup critique par rang. | 3 | 2/2/1 | 779, -450 | `ro_ti_tir_percant` `ro_ti_tir_rapide` `ro_ti_pluie` `ro_ti_fleche_assommante` |
| `ro_ti_fleche_assommante` | Compétence | **Flèche assommante** | Une flèche à tête ronde qui déséquilibre ; +50 % de poise si elle touche un ennemi en pleine préparation d'attaque. | 1 | 2/2/1 | 904, -403 | `ro_ti_oeil_exerce` `ro_ti_fracassante` `ro_ti_fleche_arret` `ro_ti_tir_tendu` |
| `ro_ti_pluie` | Compétence | **Pluie de flèches** | Une pluie de flèches sur la zone ciblée. | 1 | 2/2/1 | 801, -582 | `ro_ti_oeil_exerce` `ro_ti_averse_acier` `ro_ti_pluie_persistante` `ro_ti_tir_tendu` |
| `ro_ti_fracassante` | Variante | **Flèche fracassante** | Flèche assommante : poise 55 → 80, ×1,1 → ×1,4, recharge 10 → 14 s. *(groupe `var_assommante`)* | 1 | 2/2/1 | 925, -516 | `ro_ti_fleche_assommante` |
| `ro_ti_fleche_arret` | Variante | **Flèche d'arrêt** | Flèche assommante : si elle touche pendant une préparation télégraphiée, l'attaque est annulée net (hors boss : +100 % de poise au lieu de +50 %). Poise de base 55 → 40. *(groupe `var_assommante`)* | 1 | 2/2/1 | 1001, -405 | `ro_ti_fleche_assommante` |
| `ro_ti_averse_acier` | Variante | **Averse d'acier** | Pluie de flèches : rayon 5 → 3 m, ×1,2 → ×1,8, poise 8 → 28. *(groupe `var_pluie`)* | 1 | 2/2/1 | 839, -680 | `ro_ti_pluie` |
| `ro_ti_pluie_persistante` | Variante | **Pluie persistante** | Pluie de flèches : dure 3 s (4 vagues ×0,45), rayon 5,5 m, ralentit de 30 % tant qu'on reste dedans. *(groupe `var_pluie`)* | 1 | 2/2/1 | 916, -620 | `ro_ti_pluie` |
| `ro_ti_tir_tendu` | Passif | **Tir tendu** | +8 % de vitesse des projectiles et +1 m de portée des tirs à l'arc par rang. | 2 | 2/2/1 | 1013, -585 | `ro_ti_pluie` `ro_ti_fleche_assommante` `ro_ti_tir_ricochet` `ro_ti_sang_froid` `ro_ti_carquois_profond` `ro_ti_trait_fatal` |
| `ro_ti_sang_froid` | Passif | **Sang-froid** | Tir chargé (Attaque chargée) : charge 25 % plus rapide, et la pleine charge perce 2 ennemis au lieu d'1. | 1 | 2/2/1 | 1089, -440 | `ro_ti_tir_tendu` `ro_ti_point_faible` |
| `ro_ti_tir_ricochet` | Variante | **Tir ricochet** | Tir : la flèche rebondit sur 1 ennemi à moins de 6 m (×0,5). Exclusif avec « Pointes enduites » et « Tir à bout portant ». *(groupe `var_tir_approche`)* | 1 | 2/2/1 | 926, -723 | `ro_ti_tir_tendu` |
| `ro_ti_carquois_profond` | Passif | **Carquois profond** | +8 mana max et −6 % de coût en mana des compétences d'arc par rang. | 2 | 2/2/1 | 1010, -761 | `ro_ti_tir_tendu` `ro_ti_tir_de_maitre` |
| `ro_ti_point_faible` | Passif | **Défaut de la cuirasse** | +6 % de dégâts critiques par rang. | 2 | 2/2/1 | 1193, -434 | `ro_ti_sang_froid` |
| `ro_ti_trait_fatal` | Compétence | **Trait fatal** | Vous visez 1,5 s, immobile, puis décochez un trait qui traverse tout sur 32 m. (Demande 10 points dépensés dans la région Rôdeur.) *(10 points dans la région)* | 1 | 2/2/1 | 1111, -616 | `ro_ti_tir_tendu` `ro_ti_visee_eclair` `ro_ti_perce_coeur` `ro_ti_posture_archer` |
| `ro_ti_perce_coeur` | Variante | **Perce-cœur** | Trait fatal : contre une cible déséquilibrée, ×1,6 et critique garanti ; visée 1,5 → 1,7 s. *(groupe `var_trait_fatal`)* | 1 | 2/2/1 | 1153, -721 | `ro_ti_trait_fatal` |
| `ro_ti_visee_eclair` | Variante | **Visée éclair** | Trait fatal : visée 1,5 → 0,9 s, ×4,0 → ×2,9. *(groupe `var_trait_fatal`)* | 1 | 2/2/1 | 1233, -575 | `ro_ti_trait_fatal` |
| `ro_ti_tir_de_maitre` | Passif | **Tir de maître** | +10 % de dégâts contre les élites et les boss. | 1 | 2/2/1 | 1049, -881 | `ro_ti_carquois_profond` |
| `ro_ti_posture_archer` | Clé de voûte | **Posture de l'archer** | Après 0,6 s sans bouger : +20 % de chances de critique et Tir chargé / Trait fatal se chargent 30 % plus vite. (Demande 12 points dépensés dans la région Rôdeur.) *(12 points dans la région)* | 1 | 3/3/1 | 1281, -710 | `ro_ti_trait_fatal` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Tir traversant* (`ro_ti_tir_traversant`) : Longue traînée blanche rectiligne qui persiste 0,4 s, anneau de choc à chaque ennemi traversé.
- *Trait de brèche* (`ro_ti_trait_breche`) : Pointe dentelée noire ; à l'impact, éclats de métal et une fissure lumineuse orangée sur l'armure de la cible pendant 5 s.
- *Rafale soutenue* (`ro_ti_rafale`) : Rafale : petites étincelles sur la corde à chaque flèche, douilles de plumes qui tombent au sol.
- *Salve en éventail* (`ro_ti_salve_eventail`) : Trois flèches simultanées, trois traînées fines qui s'écartent ; l'arc est tenu à l'horizontale.
- *Flèche fracassante* (`ro_ti_fracassante`) : Tête de pierre qui éclate à l'impact en fragments ; onde sourde et la cible recule d'un pas.
- *Flèche d'arrêt* (`ro_ti_fleche_arret`) : Flèche à tête de fer en croissant ; à l'annulation, la zone télégraphiée rouge se brise en éclats de verre.
- *Averse d'acier* (`ro_ti_averse_acier`) : Colonne serrée de flèches d'acier qui s'abattent d'un coup ; cratère de poussière et éclats.
- *Pluie persistante* (`ro_ti_pluie_persistante`) : Flèches qui restent plantées dans le sol en hérissant la zone ; vagues successives en pluie fine.
- *Tir ricochet* (`ro_ti_tir_ricochet`) : Étincelle blanche au premier impact puis arc de lumière vers la seconde cible.
- *Perce-cœur* (`ro_ti_perce_coeur`) : Pendant la visée, un cœur rouge pulse sur la cible ; à l'impact, gerbe rouge sombre et ralenti de 0,1 s.
- *Visée éclair* (`ro_ti_visee_eclair`) : Viseur réduit, flèche qui s'embrase de blanc très vite ; traînée courte et sèche.

#### Venin (24 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `ro_ve_herboriste` | Passif | **Herboriste** | +5 % de dégâts de poison et de saignement par rang. | 2 | 2/2/1 | 415, -461 | `rodeur_depart` `ro_ve_fleche_empoisonnee` `ro_ve_fleche_barbelee` |
| `ro_ve_fleche_empoisonnee` | Compétence | **Flèche empoisonnée** | Une flèche qui ajoute une charge de poison (×0,25 par seconde pendant 6 s, jusqu'à 3 charges). | 1 | 2/2/1 | 387, -595 | `ro_ve_herboriste` `ro_ve_venin_paralysant` `ro_ve_venin_corrosif` `ro_ve_mithridatisation` |
| `ro_ve_fleche_barbelee` | Compétence | **Flèche barbelée** | Ajoute 30 de saignement. À 100, la plaie éclate : ×1,5 + 6 % des PV max (boss 2 %, joueurs 4 %). | 1 | 2/2/1 | 493, -511 | `ro_ve_herboriste` `ro_ve_barbes_profondes` `ro_ve_plaie_ouverte` `ro_ve_mithridatisation` |
| `ro_ve_barbes_profondes` | Variante | **Barbes profondes** | Flèche barbelée : saignement 30 → 45, dégâts ×1,0 → ×0,8. *(groupe `var_fleche_barbelee`)* | 1 | 2/2/1 | 487, -605 | `ro_ve_fleche_barbelee` |
| `ro_ve_plaie_ouverte` | Variante | **Plaie ouverte** | Flèche barbelée : quand la plaie éclate, la cible subit +12 % de dégâts pendant 6 s. *(groupe `var_fleche_barbelee`)* | 1 | 2/2/1 | 575, -556 | `ro_ve_fleche_barbelee` |
| `ro_ve_venin_paralysant` | Variante | **Venin paralysant** | Flèche empoisonnée : chaque charge ralentit de 8 % (24 % à 3 charges), dégâts du poison −20 %. *(groupe `var_fleche_empoisonnee`)* | 1 | 2/2/1 | 363, -713 | `ro_ve_fleche_empoisonnee` |
| `ro_ve_venin_corrosif` | Variante | **Venin corrosif** | Flèche empoisonnée : chaque charge retire 5 % de défense à la cible, dégâts du poison −10 %. *(groupe `var_fleche_empoisonnee`)* | 1 | 2/2/1 | 436, -671 | `ro_ve_fleche_empoisonnee` |
| `ro_ve_mithridatisation` | Passif | **Mithridatisation** | Les poisons et saignements que vous subissez durent 30 % moins longtemps ; +5 % de résistance aux dégâts de poison. | 1 | 2/2/1 | 560, -692 | `ro_ve_fleche_empoisonnee` `ro_ve_fleche_barbelee` `ro_ve_cueilleur` `ro_ve_entaille` `ro_ve_nuage` |
| `ro_ve_cueilleur` | Passif | **Cueilleur de brume** | Récolte : +20 % de chances d'herbe en plus ; vos potions de soin rendent +10 %. (Point d'accroche vers la passerelle Arcaniste sylvestre.) | 1 | 2/2/1 | 436, -787 | `ro_ve_mithridatisation` `mr_p_oeil_sylvestre` |
| `ro_ve_nuage` | Compétence | **Nuage toxique** | Une fiole qui éclate en nuage de 4 m pendant 6 s : 1 charge de poison par seconde, et les ennemis dedans infligent −10 % de dégâts. | 1 | 2/2/1 | 656, -728 | `ro_ve_mithridatisation` `ro_ve_brume_etouffante` `ro_ve_nuage_rampant` `ro_ve_pointes_enduites` `ro_ve_contagion` |
| `ro_ve_entaille` | Compétence | **Entaille venimeuse** | Un revers de dague en arc (×1,1) : 2 charges de poison, 20 de saignement, puis un petit saut de 2 m en arrière. | 1 | 2/2/1 | 505, -840 | `ro_ve_mithridatisation` `ro_ve_entaille_profonde` `ro_ve_entaille_fuyante` `ro_ve_saigneur` `ro_ve_contagion` |
| `ro_ve_entaille_fuyante` | Variante | **Entaille fuyante** | Entaille venimeuse : saut arrière 2 → 4 m avec 0,15 s d'invulnérabilité, recharge 8 → 10 s. *(groupe `var_entaille`)* | 1 | 2/2/1 | 600, -825 | `ro_ve_entaille` |
| `ro_ve_nuage_rampant` | Variante | **Nuage rampant** | Nuage toxique : dérive à 1,5 m/s vers l'ennemi empoisonné le plus proche ; rayon 4 → 3 m. *(groupe `var_nuage`)* | 1 | 2/2/1 | 745, -700 | `ro_ve_nuage` |
| `ro_ve_entaille_profonde` | Variante | **Lame barbelée** | Entaille venimeuse : plus de poison, mais saignement 20 → 45. *(groupe `var_entaille`)* | 1 | 2/2/1 | 502, -945 | `ro_ve_entaille` |
| `ro_ve_brume_etouffante` | Variante | **Brume étouffante** | Nuage toxique : les ennemis dedans attaquent 25 % plus lentement (préparations allongées d'autant) ; durée 6 → 4 s. *(groupe `var_nuage`)* | 1 | 2/2/1 | 730, -803 | `ro_ve_nuage` |
| `ro_ve_contagion` | Passif | **Épidémie** | Quand un ennemi empoisonné meurt, ses charges de poison passent à un ennemi à moins de 5 m. | 1 | 2/2/1 | 730, -901 | `ro_ve_entaille` `ro_ve_nuage` `ro_ve_virulence` |
| `ro_ve_pointes_enduites` | Variante | **Pointes enduites** | Tir : un tir sur trois ajoute une charge de poison. Exclusif avec « Tir ricochet » et « Tir à bout portant ». *(groupe `var_tir_approche`)* | 1 | 2/2/1 | 834, -806 | `ro_ve_nuage` |
| `ro_ve_saigneur` | Passif | **Saigneur** | +8 % d'accumulation de saignement par rang. | 3 | 2/2/1 | 632, -973 | `ro_ve_entaille` `ro_ve_sang_pour_sang` |
| `ro_ve_virulence` | Passif | **Virulence** | +10 % de dégâts par seconde du poison par rang. | 2 | 2/2/1 | 787, -971 | `ro_ve_contagion` `ro_ve_fleau` |
| `ro_ve_sang_pour_sang` | Clé de voûte | **Sang pour sang** | Chaque plaie qui éclate sous vos coups vous rend 8 % de vos PV max (au plus une fois toutes les 4 s). (Demande 8 points dépensés dans la région Rôdeur.) *(8 points dans la région)* | 1 | 3/3/1 | 630, -1091 | `ro_ve_saigneur` |
| `ro_ve_fleau` | Compétence | **Fléau** | Tous vos poisons dans un rayon de 12 m éclatent : 150 % des dégâts restants tout de suite, +50 de saignement, et 1 charge se propage à 4 m. (Demande 10 points dépensés dans la région Rôdeur.) *(10 points dans la région)* | 1 | 2/2/1 | 825, -1056 | `ro_ve_virulence` `ro_ve_fleau_devorant` `ro_ve_fleau_propage` `ro_ve_veneneux` |
| `ro_ve_fleau_devorant` | Variante | **Fléau dévorant** | Fléau : vous soigne de 20 % des dégâts qu'il inflige ; recharge 35 → 45 s. *(groupe `var_fleau`)* | 1 | 2/2/1 | 938, -1079 | `ro_ve_fleau` |
| `ro_ve_fleau_propage` | Variante | **Fléau propagé** | Fléau : propagation 4 → 7 m, dégâts immédiats 150 % → 100 %. *(groupe `var_fleau`)* | 1 | 2/2/1 | 800, -1186 | `ro_ve_fleau` |
| `ro_ve_veneneux` | Clé de voûte | **Vénéneux** | Le poison se cumule jusqu'à 6 charges au lieu de 3, et le saignement s'accumule 30 % plus vite. (Demande 14 points dépensés dans la région Rôdeur.) *(14 points dans la région)* | 1 | 3/3/1 | 1065, -1028 | `ro_ve_fleau` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Barbes profondes* (`ro_ve_barbes_profondes`) : Pointe à crochets multiples ; la flèche reste plantée et suinte.
- *Plaie ouverte* (`ro_ve_plaie_ouverte`) : À l'éclatement, entaille rouge lumineuse qui reste visible 6 s sur la cible.
- *Venin paralysant* (`ro_ve_venin_paralysant`) : Poison bleu-violet ; la cible laisse des traînées de brume lente derrière elle.
- *Venin corrosif* (`ro_ve_venin_corrosif`) : Poison vert acide qui fume et ronge : petites bulles et taches corrodées sur l'armure.
- *Entaille fuyante* (`ro_ve_entaille_fuyante`) : Nuage de brume verte laissé à l'endroit du coup pendant que le rôdeur bondit en arrière.
- *Nuage rampant* (`ro_ve_nuage_rampant`) : Nuage qui avance en volutes, laissant une traînée d'herbe flétrie au sol.
- *Lame barbelée* (`ro_ve_entaille_profonde`) : Revers large avec trainée rouge épaisse ; pas de brume verte.
- *Brume étouffante* (`ro_ve_brume_etouffante`) : Nuage plus dense, gris-vert, presque opaque ; les silhouettes des monstres dedans toussent.
- *Pointes enduites* (`ro_ve_pointes_enduites`) : Une flèche sur trois a une pointe verte luisante et laisse une petite traînée de brume.
- *Fléau dévorant* (`ro_ve_fleau_devorant`) : Filaments verts qui remontent des cibles jusqu'au rôdeur.
- *Fléau propagé* (`ro_ve_fleau_propage`) : Chaque cible éclate en spores vertes qui volent vers les ennemis voisins.


**Groupes de variantes** :

| Groupe | Capacité | Options (une seule au choix) |
|---|---|---|
| `var_tir_forme` | Tir | Tir lesté (`ro_tir_leste`) · Tir véloce (`ro_tir_veloce`) |
| `var_tir_percant` | Tir perçant | Trait de brèche (`ro_ti_trait_breche`) · Tir traversant (`ro_ti_tir_traversant`) |
| `var_tir_rapide` | Tir rapide | Salve en éventail (`ro_ti_salve_eventail`) · Rafale soutenue (`ro_ti_rafale`) |
| `var_pluie` | Pluie de flèches | Averse d'acier (`ro_ti_averse_acier`) · Pluie persistante (`ro_ti_pluie_persistante`) |
| `var_assommante` | Flèche assommante | Flèche fracassante (`ro_ti_fracassante`) · Flèche d'arrêt (`ro_ti_fleche_arret`) |
| `var_tir_approche` | Tir | Tir ricochet (`ro_ti_tir_ricochet`) · Tir à bout portant (`ro_tq_bout_portant`) · Pointes enduites (`ro_ve_pointes_enduites`) |
| `var_trait_fatal` | Trait fatal | Visée éclair (`ro_ti_visee_eclair`) · Perce-cœur (`ro_ti_perce_coeur`) |
| `var_marque` | Marque du chasseur | Marque de sang (`ro_tq_marque_sang`) · Marque de la meute (`ro_tq_marque_meute`) |
| `var_dague` | Coup de dague | Dague saignante (`ro_tq_dague_saignante`) · Riposte au couteau (`ro_tq_riposte_couteau`) |
| `var_bond` | Bond de retrait | Salto tireur (`ro_tq_salto_tireur`) · Bond latéral (`ro_tq_bond_lateral`) |
| `var_piege` | Piège à mâchoires | Piège de ronces (`ro_tq_piege_ronces`) · Piège à poudre (`ro_tq_piege_explosif`) |
| `var_filet` | Filet lesté | Filet d'acier (`ro_tq_filet_acier`) · Filet collant (`ro_tq_filet_collant`) |
| `var_hallali` | Hallali | Hallali sanglant (`ro_tq_hallali_sanglant`) · Hallali de meute (`ro_tq_hallali_meute`) |
| `var_fleche_empoisonnee` | Flèche empoisonnée | Venin paralysant (`ro_ve_venin_paralysant`) · Venin corrosif (`ro_ve_venin_corrosif`) |
| `var_fleche_barbelee` | Flèche barbelée | Barbes profondes (`ro_ve_barbes_profondes`) · Plaie ouverte (`ro_ve_plaie_ouverte`) |
| `var_entaille` | Entaille venimeuse | Lame barbelée (`ro_ve_entaille_profonde`) · Entaille fuyante (`ro_ve_entaille_fuyante`) |
| `var_nuage` | Nuage toxique | Brume étouffante (`ro_ve_brume_etouffante`) · Nuage rampant (`ro_ve_nuage_rampant`) |
| `var_fleau` | Fléau | Fléau dévorant (`ro_ve_fleau_devorant`) · Fléau propagé (`ro_ve_fleau_propage`) |

## 9. Les passerelles

Les compétences d'une passerelle comptent pour **ses deux classes** (pas d'Inaptitude pour elles) ; la troisième
classe paie 2 points par nœud, 3 pour la clé de voûte, et subit l'Inaptitude.

### 9.1 Lame spirituelle — Guerrier ↔ Mage (13 nœuds)

Lames enchantées (feu, givre ou arcane), *Onde tranchante*, *Égide runique*, maîtrise de l'épée runique (elle sert de
focalisateur sans pénalité) et le *Serment de la lame spirituelle* (Inaptitude Guerrier/Mage réduite d'un tiers, −10 %
PV et mana).

| id | Nom | Type | Coût (mana + end.) | Recharge | Portée | Puissance | Poise | Engagement | Arme | Étiquettes | Origine |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `enchant_blade` | **Lame enchantée** | renfort | 20 + 0 | 20 s | — | — | — | prép. 0,4 s · récup. 0,3 s à 50 % | arme de mêlée | arcane, enchantement, melee | Guerrier + Mage |
| `blade_wave` | **Onde tranchante** | projectile | 13 + 12 | 7 s | 10 m | ×1,8 | 14 | prép. 0,3 s · récup. 0,5 s à 25 % | arme de mêlée | arcane, projectile, melee | Guerrier + Mage |
| `rune_aegis` | **Égide runique** | renfort | 30 + 0 | 25 s | — | — | — | prép. 0,3 s · récup. 0,3 s à 50 % | — | arcane, defense | Guerrier + Mage |

- **Lame enchantée** (`enchant_blade`) — Votre lame s’embrase d’énergie : chaque coup de mêlée ajoute des dégâts arcaniques.
  *Soulslike :* Préparation 0,4 s bien visible : on l’active avant le combat ou pendant une ouverture.
- **Onde tranchante** (`blade_wave`) — Une taille qui projette une lame d’énergie traversant les ennemis.
  *Soulslike :* Un outil à mi-distance, pas un kite : 10 m, 8 s de recharge, 0,5 s de récupération à 25 % de vitesse.
- **Égide runique** (`rune_aegis`) — Un bouclier de runes absorbe les dégâts pendant 6 s.
  *Soulslike :* Absorbe 12 % des PV max + 25 % du mana max ; se brise d’un seul coup lourd de boss.

#### Lame spirituelle (13 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `gm_lance_spectrale` | Variante | **Lance spectrale** | Portée 10 → 16 m, puissance 1,8 → 2,2 ; recharge 7 → 11 s. *(groupe `onde_forme`)* | 1 | 1/1/2 | -695, 331 | `gm_onde_tranchante` |
| `gm_croissant` | Variante | **Croissant de lune** | Onde en cône de 90° sur 7 m qui touche tout ; puissance 1,8 → 1,55. *(groupe `onde_forme`)* | 1 | 1/1/2 | -627, 464 | `gm_onde_tranchante` |
| `gm_onde_tranchante` | Compétence | **Onde tranchante** | Débloque Onde tranchante. | 1 | 1/1/2 | -745, 430 | `gm_flux_martial` `gm_croissant` `gm_lance_spectrale` `gm_egide` `ma_p_flamme_attisee` |
| `gm_flux_martial` | Passif | **Flux martial** | Chaque coup de mêlée qui touche rend 1 point de mana (au plus 4 par seconde). | 1 | 1/1/2 | -611, 633 | `gu_md_brise_garde` `gm_lame_enchantee` `gm_onde_tranchante` |
| `gm_egide_mana` | Variante | **Égide du savant** | Absorbe 12 % PV + 25 % mana → 40 % du mana max, et rend 20 % des dégâts absorbés en mana. *(groupe `egide_forme`)* | 1 | 1/1/2 | -873, 218 | `gm_egide` |
| `gm_egide` | Compétence | **Égide runique** | Débloque Égide runique. | 1 | 1/1/2 | -896, 344 | `gm_onde_tranchante` `gm_lame_arcanique` `gm_egide_renvoi` `gm_egide_mana` |
| `gm_lame_enchantee` | Compétence | **Lame enchantée** | Débloque Lame enchantée. | 1 | 1/1/2 | -762, 617 | `gm_flux_martial` `gm_lame_ardente` `gm_lame_givre` `gm_lame_arcanique` |
| `gm_egide_renvoi` | Variante | **Égide éclatante** | Quand le bouclier se brise, il explose : ×1,2 de dégâts arcaniques dans un rayon de 4 m. *(groupe `egide_forme`)* | 1 | 1/1/2 | -1014, 310 | `gm_egide` `gm_ks_serment` |
| `gm_lame_arcanique` | Variante | **Lame arcanique** | Élément arcane : bonus 50 % → 40 %, mais chaque coup rend 2 mana. *(groupe `lame_enchantee_element`)* | 1 | 1/1/2 | -931, 537 | `gm_lame_enchantee` `gm_maitrise_runique` `gm_egide` |
| `gm_lame_ardente` | Variante | **Lame ardente** | Élément feu : les coups brûlent (20 % de l’attaque sur 3 s, 3 cumuls). *(groupe `lame_enchantee_element`)* | 1 | 1/1/2 | -794, 740 | `gm_lame_enchantee` `gm_maitrise_runique` |
| `gm_lame_givre` | Variante | **Lame de givre** | Élément givre : chaque coup ralentit de 10 % pendant 3 s (2 cumuls, 20 %). *(groupe `lame_enchantee_element`)* | 1 | 1/1/2 | -884, 654 | `gm_lame_enchantee` `gm_maitrise_runique` |
| `gm_maitrise_runique` | Passif | **Maîtrise de l’épée runique** | Épée runique : +15 % de dégâts élémentaires, et elle sert de focus sans pénalité aux sorts (au lieu de −20 %). | 1 | 1/1/2 | -978, 660 | `gm_lame_arcanique` `gm_lame_givre` `gm_lame_ardente` `gm_ks_serment` |
| `gm_ks_serment` | Clé de voûte | **Serment de la lame spirituelle** | La pénalité d’Inaptitude des compétences de Guerrier ET de Mage est réduite d’un tiers. CONTREPARTIE : −10 % de PV max et −10 % de mana max. | 1 | 1/1/3 | -1094, 442 | `gm_maitrise_runique` `gm_egide_renvoi` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Lance spectrale* (`gm_lance_spectrale`) : Longue lame fantôme violette et fine, traînée de particules.
- *Croissant de lune* (`gm_croissant`) : Croissant bleu pâle qui s’élargit en avançant.
- *Égide du savant* (`gm_egide_mana`) : Sphère bleue translucide, les coups reçus y laissent des ondulations.
- *Égide éclatante* (`gm_egide_renvoi`) : Sphère de runes qui se fissure puis éclate en éclats violets.
- *Lame arcanique* (`gm_lame_arcanique`) : Runes violettes qui glissent le long de la lame, étincelles violettes.
- *Lame ardente* (`gm_lame_ardente`) : Flammes orange léchant le tranchant, braises à chaque taille.
- *Lame de givre* (`gm_lame_givre`) : Givre cristallin sur la lame, éclats de glace et buée bleue à l’impact.


| Groupe | Capacité | Options (une seule au choix) |
|---|---|---|
| `lame_enchantee_element` | Lame enchantée | Lame ardente (`gm_lame_ardente`) · Lame de givre (`gm_lame_givre`) · Lame arcanique (`gm_lame_arcanique`) |
| `onde_forme` | Onde tranchante | Croissant de lune (`gm_croissant`) · Lance spectrale (`gm_lance_spectrale`) |
| `egide_forme` | Égide runique | Égide éclatante (`gm_egide_renvoi`) · Égide du savant (`gm_egide_mana`) |

### 9.2 Arcaniste sylvestre — Mage ↔ Rôdeur (12 nœuds)

Flèches runiques, ronces givrées, feu follet ; la clé *Arc des astres* fait compter l'arc comme un focalisateur.

| id | Nom | Type | Coût (mana + end.) | Recharge | Portée | Puissance | Poise | Engagement | Arme | Étiquettes | Origine |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `rune_arrow` | **Flèche runique** | projectile | 10 + 10 | 5 s | 22 m | ×1,7 | 12 | incant. 0,3 s · récup. 0,45 s à 30 % | arc ou arbalète | arcane, projectile, arc | Mage + Rôdeur |
| `frost_brambles` | **Ronces givrées** | zone ciblée | 20 + 10 | 16 s | 16 m / r 3,5 m | ×1 | 6 | incant. 0,4 s · récup. 0,45 s à 30 % | focalisateur ou arc | nature, givre, zone, controle, sort | Mage + Rôdeur |
| `wisp` | **Feu follet** | invocation | 30 + 0 | 30 s | 16 m | ×0,4 | 1 | incant. 0,5 s · récup. 0,4 s à 30 % | — | arcane, nature, invocation | Mage + Rôdeur |

- **Flèche runique** (`rune_arrow`) — Une flèche gravée d'une rune qui perce la première cible et inflige des dégâts d'arcane.
  *Soulslike :* Demande un arc ou une arbalète (sans arc, la compétence est grisée). Tir engagé comme les tirs du rôdeur.
- **Ronces givrées** (`frost_brambles`) — Des ronces couvertes de givre jaillissent du sol et enracinent les ennemis 1,5 s (×1,0 sur 3 s).
  *Soulslike :* Les boss ne sont pas enracinés : 2 charges de Froid à la place. Un monstre ne peut être enraciné qu'une fois toutes les 8 s.
- **Feu follet** (`wisp`) — Invoque un feu follet pendant 15 s qui tire un petit trait d'arcane (×0,4) sur votre cible toutes les 1,5 s.
  *Soulslike :* Le follet n'attire pas l'aggro et ne peut pas être ciblé ; il suit la cible verrouillée par le joueur.

#### Arcaniste sylvestre (12 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `mr_p_seve_arcanique` | Passif | **Sève arcanique** | +6 % de dégâts d'arcane et de nature par rang. | 2 | 2/1/1 | -150, -790 | `ma_p_vigueur_erudit` `mr_rune_arrow` |
| `mr_p_oeil_sylvestre` | Passif | **Œil sylvestre** | +4 % de chances de critique des projectiles par rang. | 2 | 2/1/1 | 150, -790 | `mr_rune_arrow` `ro_ve_cueilleur` |
| `mr_rune_arrow` | Compétence | **Flèche runique** | Une flèche gravée d'une rune qui perce la première cible et inflige des dégâts d'arcane. | 1 | 2/1/1 | 0, -890 | `mr_p_seve_arcanique` `mr_p_oeil_sylvestre` `mr_v_arrow_eclatee` `mr_v_arrow_marque` `mr_frost_brambles` `mr_wisp` |
| `mr_v_arrow_eclatee` | Variante | **Flèche éclatée** | Ne perce plus : à l'impact, 3 éclats d'arcane (×0,35) frappent les ennemis à 4 m. *(groupe `mr_g_rune_arrow`)* | 1 | 2/1/1 | -100, -950 | `mr_rune_arrow` |
| `mr_v_arrow_marque` | Variante | **Flèche de marque** | La cible est Marquée 6 s : +12 % de dégâts subis de votre part et de votre groupe (non cumulable). *(groupe `mr_g_rune_arrow`)* | 1 | 2/1/1 | 100, -950 | `mr_rune_arrow` |
| `mr_v_brambles_epines` | Variante | **Ronces à épines** | Enracinement 1,5 → 0,8 s, dégâts ×2 et Saignement (tag saignement). *(groupe `mr_g_frost_brambles`)* | 1 | 2/1/1 | -215, -1000 | `mr_frost_brambles` |
| `mr_v_wisp_braise` | Variante | **Follet de braise** | Le follet devient du feu : ses traits infligent Brûlure, un tir toutes les 2 s au lieu de 1,5 s. *(groupe `mr_g_wisp`)* | 1 | 2/1/1 | 215, -1000 | `mr_wisp` |
| `mr_frost_brambles` | Compétence | **Ronces givrées** | Des ronces couvertes de givre jaillissent du sol et enracinent les ennemis 1,5 s (×1,0 sur 3 s). | 1 | 2/1/1 | -110, -1040 | `mr_rune_arrow` `mr_v_brambles_epines` `mr_v_brambles_nord` `mr_ks_arc_des_astres` |
| `mr_wisp` | Compétence | **Feu follet** | Invoque un feu follet pendant 15 s qui tire un petit trait d'arcane (×0,4) sur votre cible toutes les 1,5 s. | 1 | 2/1/1 | 110, -1040 | `mr_rune_arrow` `mr_v_wisp_braise` `mr_v_wisp_gardien` `mr_ks_arc_des_astres` |
| `mr_v_brambles_nord` | Variante | **Ronces du Nord** | N'enracine plus : 3 charges de Froid, rayon 3,5 → 5 m. *(groupe `mr_g_frost_brambles`)* | 1 | 2/1/1 | -215, -1130 | `mr_frost_brambles` |
| `mr_v_wisp_gardien` | Variante | **Follet gardien** | Le follet n'attaque plus : il intercepte un projectile ennemi toutes les 4 s. *(groupe `mr_g_wisp`)* | 1 | 2/1/1 | 215, -1130 | `mr_wisp` |
| `mr_ks_arc_des_astres` | Clé de voûte | **Arc des astres** | Votre arc ou arbalète compte comme un focalisateur (plus de −20 % sur vos sorts) et vos sorts de projectile volent 20 % plus vite. En contrepartie : +15 % de coût d'endurance sur vos tirs et vos sorts. | 1 | 3/1/1 | 0, -1190 | `mr_frost_brambles` `mr_wisp` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Flèche éclatée* (`mr_v_arrow_eclatee`) : Rune qui éclate en trois fragments lumineux.
- *Flèche de marque* (`mr_v_arrow_marque`) : Sceau vert lumineux au-dessus de la cible.
- *Ronces à épines* (`mr_v_brambles_epines`) : Ronces rouge sombre, épines luisantes.
- *Follet de braise* (`mr_v_wisp_braise`) : Flamme orange dansante.
- *Ronces du Nord* (`mr_v_brambles_nord`) : Tapis de ronces blanches de givre.
- *Follet gardien* (`mr_v_wisp_gardien`) : Follet blanc qui tourne autour du mage et éclate en bouclier.


| Groupe | Capacité | Options (une seule au choix) |
|---|---|---|
| `mr_g_rune_arrow` | Flèche runique | Flèche éclatée (`mr_v_arrow_eclatee`) · Flèche de marque (`mr_v_arrow_marque`) |
| `mr_g_frost_brambles` | Ronces givrées | Ronces à épines (`mr_v_brambles_epines`) · Ronces du Nord (`mr_v_brambles_nord`) |
| `mr_g_wisp` | Feu follet | Follet de braise (`mr_v_wisp_braise`) · Follet gardien (`mr_v_wisp_gardien`) |

### 9.3 Chasseur — Rôdeur ↔ Guerrier (14 nœuds)

Javelots et lances, *Coup d'épieu*, appâts, deux armes (Ambidextrie) et la clé *Frénésie du chasseur*.

| id | Nom | Type | Coût (mana + end.) | Recharge | Portée | Puissance | Poise | Engagement | Arme | Étiquettes | Origine |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `javelot` | **Javelot de chasse** | projectile | 0 + 20 | 8 s | 16 m | ×1,8 | 35 | prép. 0,5 s · récup. 0,5 s à 30 % | — | physique, projectile, lance, chasse | Rôdeur + Guerrier |
| `coup_epieu` | **Coup d'épieu** | déplacement | 6 + 22 | 9 s | 4,5 m | ×1,6 | 30 | récup. 0,5 s à 30 % | arme de mêlée | physique, melee, mobilite, lance | Rôdeur + Guerrier |
| `appat` | **Appât** | zone ciblée | 10 + 5 | 30 s | 10 m / r 12 m | — | 0 | récup. 0,4 s à 50 % | — | controle, chasse | Rôdeur + Guerrier |

- **Javelot de chasse** (`javelot`) — Lance le javelot de chasse porté au dos (aucune munition) : ×1,8, 35 de poise. +25 % avec une lance équipée.
  *Soulslike :* Élan visible de 0,5 s, tir en cloche : un outil d'ouverture pour le rôdeur comme pour le guerrier. Utilisable avec n'importe quelle arme.
- **Coup d'épieu** (`coup_epieu`) — Une fente de 4,5 m qui se termine par un coup d'estoc (×1,6). Une lance allonge la fente de 1,5 m.
  *Soulslike :* Aucune invulnérabilité : c'est une ouverture, pas une esquive. Demande une arme de mêlée (lance, épée, dague).
- **Appât** (`appat`) — Lance un appât : les bêtes à 12 m (loups, sangliers, araignées, yétis…) s'acharnent dessus 3 s (élites 1,5 s, boss insensibles).
  *Soulslike :* Un « souffle » pour se replacer ou relever un allié, sans effet en JcJ ni sur les humanoïdes. Les bêtes reprennent leur cible ensuite.

#### Chasseur (14 nœuds)

| id | Type | Nom | Effet | Rangs | Coût G/M/R | (x, y) | Liens |
|---|---|---|---|---|---|---|---|
| `rg_instinct_chasseur` | Passif | **Instinct du chasseur** | +8 % de dégâts contre les bêtes (loups, sangliers, araignées, scorpions, yétis…). | 1 | 1/2/1 | 755, 231 | `ro_tq_acrobate` `rg_javelot` |
| `rg_javelot_harpon` | Variante | **Javelot harpon** | Javelot : attire une cible non-boss de 4 m vers vous (ou vous tire de 4 m vers une grande cible) ; ×1,8 → ×1,2. *(groupe `var_javelot`)* | 1 | 1/2/1 | 700, 425 | `rg_javelot` |
| `rg_javelot` | Compétence | **Javelot de chasse** | Lance le javelot de chasse porté au dos (aucune munition) : ×1,8, 35 de poise. +25 % avec une lance équipée. | 1 | 1/2/1 | 810, 344 | `rg_instinct_chasseur` `rg_javelot_harpon` `rg_javelot_leste` `rg_estocade` `rg_depeceur` |
| `rg_depeceur` | Passif | **Dépeceur** | +20 % de chances d'obtenir un matériau de plus sur les bêtes (fourrures, crocs, chitine). (Point d'accroche côté Guerrier.) | 1 | 1/2/1 | 689, 579 | `rg_javelot` `gu_be_entaille` |
| `rg_javelot_leste` | Variante | **Javelot lesté** | Javelot : poise 35 → 60, dégâts +20 %, élan 0,5 → 0,7 s. *(groupe `var_javelot`)* | 1 | 1/2/1 | 918, 298 | `rg_javelot` |
| `rg_estocade` | Compétence | **Coup d'épieu** | Une fente de 4,5 m qui se termine par un coup d'estoc (×1,6). Une lance allonge la fente de 1,5 m. | 1 | 1/2/1 | 861, 458 | `rg_javelot` `rg_estocade_balayante` `rg_estocade_sanglier` `rg_appat` `rg_ambidextrie` `rg_frere_armes` |
| `rg_estocade_sanglier` | Variante | **Charge du sanglier** | Estocade : fente 4,5 → 7 m, poise 30 → 50, endurance 22 → 30. *(groupe `var_estocade`)* | 1 | 1/2/1 | 847, 579 | `rg_estocade` |
| `rg_estocade_balayante` | Variante | **Estocade balayante** | Estocade : se termine par un balayage à 180° (rayon 3 m) ; ×1,6 → ×1,2. *(groupe `var_estocade`)* | 1 | 1/2/1 | 965, 365 | `rg_estocade` |
| `rg_frere_armes` | Passif | **Frère d'armes** | Rôdeur : l'Inaptitude de vos compétences Guerrier « mêlée » passe de 25 % à 10 %. Guerrier : idem pour les compétences Rôdeur « arc ». | 1 | 1/2/1 | 962, 533 | `rg_estocade` `rg_frenesie` |
| `rg_appat` | Compétence | **Appât** | Lance un appât : les bêtes à 12 m (loups, sangliers, araignées, yétis…) s'acharnent dessus 3 s (élites 1,5 s, boss insensibles). | 1 | 1/2/1 | 1087, 374 | `rg_estocade` `rg_appat_piege` `rg_appat_sanglant` |
| `rg_ambidextrie` | Passif | **Ambidextrie** | Avec une arme de mêlée à une main en main gauche (dague, épée courte) : vos attaques de base de mêlée ajoutent un coup à ×0,35. −10 % de régénération d'endurance. | 1 | 1/2/1 | 906, 708 | `rg_estocade` |
| `rg_frenesie` | Clé de voûte | **Frénésie du chasseur** | Chaque coup de mêlée qui touche rend 4 d'endurance (une fois par attaque, jamais plus de la moitié de ce qu'elle a coûté). (Demande 5 points dépensés dans la passerelle Chasseur.) *(5 points dans la région)* | 1 | 1/3/1 | 1050, 582 | `rg_frere_armes` |
| `rg_appat_sanglant` | Variante | **Appât sanglant** | Appât : les bêtes qui s'y acharnent subissent +15 % de dégâts pendant 6 s. *(groupe `var_appat`)* | 1 | 1/2/1 | 1183, 317 | `rg_appat` |
| `rg_appat_piege` | Variante | **Appât piégé** | Appât : explose au bout des 3 s (×1,2, 3 m) et ajoute 2 charges de poison. *(groupe `var_appat`)* | 1 | 1/2/1 | 1119, 498 | `rg_appat` |

**Intentions visuelles des variantes** (pour les effets à produire) :

- *Javelot harpon* (`rg_javelot_harpon`) : Corde tendue visible entre le rôdeur et la cible, qui claque en se rétractant.
- *Javelot lesté* (`rg_javelot_leste`) : Javelot à tête de pierre cerclée de fer ; impact lourd qui soulève terre et herbe.
- *Charge du sanglier* (`rg_estocade_sanglier`) : Traînée de poussière et silhouette fantomatique de sanglier pendant la charge.
- *Estocade balayante* (`rg_estocade_balayante`) : Arc de lumière pâle en demi-cercle au bout de la fente.
- *Appât sanglant* (`rg_appat_sanglant`) : Morceau de viande sanglante ; les bêtes attirées ont des yeux rouges luisants.
- *Appât piégé* (`rg_appat_piege`) : Carcasse ficelée qui gonfle puis éclate en nuage verdâtre.


| Groupe | Capacité | Options (une seule au choix) |
|---|---|---|
| `var_javelot` | Javelot de chasse | Javelot harpon (`rg_javelot_harpon`) · Javelot lesté (`rg_javelot_leste`) |
| `var_estocade` | Coup d'épieu | Estocade balayante (`rg_estocade_balayante`) · Charge du sanglier (`rg_estocade_sanglier`) |
| `var_appat` | Appât | Appât piégé (`rg_appat_piege`) · Appât sanglant (`rg_appat_sanglant`) |

## 10. Clés de voûte

| id | Nom | Zone | Gain | Contrepartie | Conditions |
|---|---|---|---|---|---|
| `ks_danseur` | **Danseur des brumes** | Survie | Roulades gratuites en endurance (toutes variantes). | Recharge de roulade 1,8 s au lieu de 0,6 s ; −25 endurance maximale. | niveau 10 |
| `ks_dernier_souffle` | **Dernier souffle** | Survie | Survit à un coup mortel toutes les 120 s (240 s en JcJ) : 1 PV, 0,6 s d'invulnérabilité, 30 d'endurance. | −12 % de PV maximum en permanence. | niveau 15 |
| `ks_touche_a_tout` | **Touche-à-tout** | Survie | Pénalités d'Inaptitude divisées par deux (−12,5 % puissance, +12,5 % coût, +10 % recharge). | −8 % de puissance pour toutes les compétences de votre propre classe. | niveau 10 |
| `gu_ga_ks_mur_vivant` | **Mur vivant** | Guerrier | Avec un bouclier, la Garde bloque 100 % des dégâts frontaux (85 % contre un boss). | coups bloqués +30 % d’endurance, sprint impossible, roulade −40 % de distance. | — |
| `gu_ga_ks_serment` | **Serment du protecteur** | Guerrier | 20 % des dégâts subis par les membres du groupe à moins de 8 m sont redirigés vers vous ; +20 % de défense. | −15 % de dégâts infligés. | — |
| `gu_be_ks_rasoir` | **Au fil du rasoir** | Guerrier | +3 % de dégâts par tranche de 10 % de PV manquants (max +27 %) et +3 % de vol de vie. | soins reçus −30 % et plus de régénération de PV hors combat. | — |
| `gu_be_ks_dechaine` | **Déchaîné** | Guerrier | +20 % de dégâts et +15 % de vitesse d’attaque. | la Garde est impossible (ni blocage ni parade) et −10 % de défense. | — |
| `gu_md_ks_duelliste` | **Duelliste** | Guerrier | Si un seul ennemi est à moins de 8 m : +20 % de dégâts et +10 % de critique. | −20 % de dégâts dès que 3 ennemis ou plus sont à moins de 8 m. | — |
| `gu_md_ks_coups_mesures` | **Coups mesurés** | Guerrier | Chaque 4ᵉ coup est un critique garanti avec +50 % de dégâts critiques. | vos autres coups ne sont jamais critiques. | — |
| `gm_ks_serment` | **Serment de la lame spirituelle** | Lame spirituelle | La pénalité d’Inaptitude des compétences de Guerrier ET de Mage est réduite d’un tiers. | −10 % de PV max et −10 % de mana max. | — |
| `ma_ks_coeur_de_braise` | **Cœur de braise** | Mage | Brûlures cumulables jusqu’à 3 fois (durées séparées) ; +20 % de dégâts de feu. | +15 % de dégâts subis de toutes sources. | — |
| `ma_ks_grand_rituel` | **Grand rituel** | Mage | Sorts (hors attaque de base) : +35 % de puissance, +50 % de déséquilibre. | Incantations +50 % (au moins +0,3 s), récupération +30 %. | — |
| `ma_ks_pacte_sang_lune` | **Pacte de la lune de sang** | Mage | Sans assez de mana, le sort se paie en PV (1 PV par mana manquante), refusé sous 10 % de PV. | Mana maximale −25 %, potions de mana −50 %. | — |
| `ma_ks_hiver_eternel` | **Hiver éternel** | Mage | 3 charges de Froid gèlent un non-boss 1,2 s (immunité 8 s) ; un boss subit +25 % de déséquilibre 3 s ; +20 % de dégâts de givre. | Dégâts de feu −40 %, vitesse −8 %. | — |
| `mr_ks_arc_des_astres` | **Arc des astres** | Arcaniste sylvestre | L'arc ou l'arbalète compte comme focalisateur ; sorts de projectile +20 % de vitesse. | +15 % de coût d’endurance des tirs et des sorts. | — |
| `ma_ks_erudit_martial` | **Érudit martial** | Mage | Bâton/sceptre = arme de mêlée (−15 %) ; Inaptitude des compétences de Guerrier ÷ 2 (se cumule avec Touche-à-tout, plancher 40 %). | Sorts +10 % de mana. | — |
| `ro_ti_posture_archer` | **Posture de l'archer** | Rôdeur | Après 0,6 s sans bouger : +20 % de chances de critique et Tir chargé / Trait fatal se chargent 30 % plus vite. (Demande 12 points dépensés dans la région Rôdeur.) | Bouger annule la posture, et vos roulades coûtent +10 d'endurance. | 12 points dans la région |
| `ro_tq_au_plus_pres` | **Au plus près** | Rôdeur | À moins de 3 m, votre Tir devient automatiquement un enchaînement de 2 coups de dague (×0,8 + ×1,0, 12 de poise) et vos compétences « dague » font +30 % de dégâts. (Demande 8 points dépensés dans la région Rôdeur.) | Vos compétences d'arc infligent −15 % de dégâts. | 8 points dans la région |
| `ro_tq_proie_unique` | **Proie unique** | Rôdeur | Votre Marque ne s'efface plus avant la mort de la cible et son bonus passe à +24 %. (Demande 12 points dépensés dans la région Rôdeur.) | −15 % de dégâts contre tout ce qui n'est pas marqué ; changer de proie coûte 30 s de recharge à la Marque. | 12 points dans la région |
| `ro_tq_fantome_brumes` | **Fantôme des brumes** | Rôdeur | Esquive parfaite = invisible 1,5 s (élites 0,75 s, jamais contre un boss ; JcJ 0,8 s). Recharge interne 8 s. | −15 % de PV max. | 14 points dans la région |
| `ro_ve_veneneux` | **Vénéneux** | Rôdeur | Le poison se cumule jusqu'à 6 charges au lieu de 3, et le saignement s'accumule 30 % plus vite. (Demande 14 points dépensés dans la région Rôdeur.) | Vos dégâts directs (hors poison et saignement) sont réduits de 20 %. | 14 points dans la région |
| `ro_ve_sang_pour_sang` | **Sang pour sang** | Rôdeur | Une plaie qui éclate vous rend 8 % de vos PV max (une fois toutes les 4 s au plus). | Vos potions de soin rendent 50 % de moins. | 8 points dans la région |
| `rg_frenesie` | **Frénésie du chasseur** | Chasseur | Chaque attaque de mêlée qui touche rend 4 d'endurance (au plus la moitié de son coût). | Vos compétences à distance coûtent 40 % d'endurance en plus. | 5 points dans la région |

## 11. Statuts

| id | Nom | Effet |
|---|---|---|
| `brulure` | Brûlure | Inflige 30 % des dégâts du coup déclencheur en 3 s (tics de 0,5 s). Ne se cumule pas : une nouvelle brûlure remplace la précédente si elle est plus forte. |
| `froid` | Froid | Charges (max 3), 3 s : −15 % de vitesse de déplacement et −10 % de vitesse d’attaque par charge. Boss : moitié d’effet. |
| `gel` | Gel | Immobilisé 1 à 1,2 s (attaque en cours annulée), puis immunisé au Gel 8 s. Les boss ne gèlent jamais. |
| `aveugle` | Aveuglé | −20 % de dégâts infligés pendant 3 s. |
| `enracine` | Enraciné | Ne peut plus se déplacer (peut encore attaquer à portée), puis immunisé 8 s. |
| `marque` | Marqué | +12 % de dégâts subis de la part du lanceur et de son groupe. |
| `saignement` | Saignement | Deux effets sous un même nom. (1) Plaie : un coup « saignant » inflige un pourcentage de ses dégâts en quelques secondes (ex. Entaille : 180 % en 6 s). (2) Jauge d'hémorragie sous la barre de vie : chaque coup saignant ajoute des points (Flèche barbelée 30) ; à 100 la plaie éclate (×1,5 du coup + 6 % des PV max ; boss 2 %, joueurs 4 %) et la jauge se vide. Elle redescend de 10/s après 3 s sans nouvelle entaille. |
| `poison` | Empoisonné | Charges (3 au maximum, 6 avec « Vénéneux ») : chaque charge inflige 25 % de l'attaque du lanceur par seconde pendant 6 s. Le poison n'inflige jamais de déséquilibre (poise). |
| `vacillement` | Vacillement (joueur) | Nouveau : un coup télégraphié qui touche fait vaciller le joueur 0,4 s (boss 0,6 s) — ni attaque, ni roulade, ni garde. Durée × (1 − Équilibre / 100). Annule une incantation en cours. Garde brisée : 1 s. |

## 12. Équilibrage

### 12.1 Méthode (`node docs/design/tools/balance.mjs`)

- Deux constructions plausibles par classe (Gardien et Berserker ; Pyromancien et Mage de givre ; Tireur et Venin) aux
  niveaux 5, 15 et 30, avec un équipement typique du palier (Inhabituel au niveau 5, Rare ensuite, niveau d'objet =
  niveau), et deux hybrides aux niveaux 15 et 30 : **Mage lame spirituelle** (épée runique + grimoire, Tourbillon du
  Guerrier) et **Rôdeur de givre** (Arcaniste sylvestre + Lance de glace du Mage).
- Chaque construction est complétée par les chemins les moins chers et **validée par `validateTree`** (points, porte,
  liens, variantes exclusives) : ce sont des allocations légales.
- Combat solo de 60 s contre un monstre de référence du même niveau, au pas de 0,05 s : recharges, mana, endurance
  (30 gardés pour une roulade), engagement (préparation + incantation + canalisation + récupération), renforts, soins,
  une potion du palier toutes les 20 s, brûlures (non cumulables) et poisons (charges plafonnées), Froid et
  déséquilibre du monstre (contrôle), vol de vie, garde.
- **Victimes par vie** = (DPS / PV du monstre) × temps avant de mourir. L'**exposition** de chaque classe (la part des
  coups du monstre qui la touchent : la mêlée reste au contact, le mage et le rôdeur non) est calibrée **une seule fois**
  sur le kit v0.2 (préréglage de migration + armes v0.2) aux niveaux 5, 10 et 14, que la simulation v0.2
  (`tests/balance/sim.mjs`, `docs/EQUILIBRAGE.md`) mesurait à ±9 %. Exposition obtenue : Guerrier 1,799, Mage 0,47, Rôdeur 0,72.
- Cibles : classes (moyenne de leurs deux constructions) à **±15 %** à chaque niveau, aucune construction à plus de
  ±25 % de la moyenne ; hybrides entre **80 % et 100 %** de la meilleure construction pure de leur classe.
- Ce modèle est une **vérification rapide**, pas la simulation de combat : elle devra être refaite avec
  `tests/balance/sim.mjs` étendu à l'arbre (les profils ci-dessus sont prêts à y être repris).

### 12.2 Résultats (HORS CIBLE)

| Niv. | Guerrier | Mage | Rôdeur | Écart max | Résultat |
|---|---|---|---|---|---|
| 5 | 5,51 (-3,4 %) | 6,03 (+5,7 %) | 5,57 (-2,4 %) | 5,7 % | OK |
| 15 | 7,37 (-7,1 %) | 9,34 (+17,6 %) | 7,1 (-10,5 %) | 17,6 % | hors cible |
| 30 | 9,46 (-4,9 %) | 10,55 (+6,2 %) | 9,81 (-1,3 %) | 6,2 % | hors cible |

| Niv. | Build | Points | PV | Attaque | Défense | DPS | Contrôle | Survie (s) | Victimes par vie | Écart au niveau |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | `g_gardien` | 5/5 | 219 | 34 | 41 | 34,9 | 27 % | 33,6 | 6,51 | +14,2 % |
| 15 | `g_gardien` | 17/17 | 467 | 77 | 102 | 100,8 | 32 % | 43,4 | 8,76 | +10,3 % |
| 30 | `g_gardien` | 35/35 | 832 | 141 | 221 | 215,5 | 24 % | 42,2 | 9,29 | -6,6 % |
| 5 | `g_berserker` | 5/5 | 219 | 39 | 32 | 34,3 | 30 % | 23,7 | 4,51 | -20,9 % |
| 15 | `g_berserker` | 17/17 | 465 | 90 | 80 | 109,1 | 20 % | 27,4 | 5,99 | -24,6 % |
| 30 | `g_berserker` | 35/35 | 894 | 166 | 136 | 321,9 | 32 % | 29,3 | 9,63 | -3,2 % |
| 5 | `m_pyro` | 5/5 | 146 | 34 | 13 | 28,5 | 0 % | 44,5 | 7,05 | +23,6 % |
| 15 | `m_pyro` | 17/17 | 279 | 83 | 33 | 90,7 | 11 % | 41,1 | 7,45 | -6,1 % |
| 30 | `m_pyro` | 35/35 | 536 | 156 | 61 | 255,8 | 8 % | 33,1 | 8,65 | -13 % |
| 5 | `m_givre` | 5/5 | 146 | 34 | 13 | 18,4 | 5 % | 49 | 5,01 | -12,1 % |
| 15 | `m_givre` | 17/17 | 307 | 83 | 33 | 112,8 | 16 % | 49,7 | 11,22 | +41,4 % |
| 30 | `m_givre` | 35/35 | 584 | 156 | 67 | 209,7 | 31 % | 58,2 | 12,46 | +25,3 % |
| 5 | `r_tireur` | 5/5 | 173 | 36 | 21 | 30,9 | 0 % | 30,4 | 5,22 | -8,5 % |
| 15 | `r_tireur` | 17/17 | 336 | 85 | 52 | 98,3 | 0 % | 32,1 | 6,32 | -20,3 % |
| 30 | `r_tireur` | 35/35 | 651 | 157 | 96 | 265,9 | 9 % | 34,9 | 9,47 | -4,7 % |
| 5 | `r_venin` | 5/5 | 173 | 33 | 21 | 35 | 0 % | 30,4 | 5,92 | +3,7 % |
| 15 | `r_venin` | 17/17 | 336 | 79 | 52 | 122,6 | 0 % | 32,1 | 7,88 | -0,7 % |
| 30 | `r_venin` | 35/35 | 651 | 145 | 96 | 320,7 | 0 % | 31 | 10,16 | +2,2 % |
| 15 | *hybride* `h_lame_spirituelle` | 17/17 | 279 | 82 | 33 | 99,4 | 8 % | 40,4 | 8,02 | — |
| 30 | *hybride* `h_lame_spirituelle` | 35/35 | 469 | 153 | 61 | 257,5 | 12 % | 35,6 | 9,35 | — |
| 15 | *hybride* `h_rodeur_givre` | 17/17 | 336 | 85 | 52 | 107,2 | 8 % | 34,8 | 7,45 | — |
| 30 | *hybride* `h_rodeur_givre` | 35/35 | 610 | 157 | 96 | 281,2 | 3 % | 29,8 | 8,54 | — |

| Hybride | Niv. | Victimes par vie | Meilleur pur de sa classe | Ratio | Cible 80–100 % |
|---|---|---|---|---|---|
| `h_lame_spirituelle` | 15 | 8,02 | `m_givre` (11,22) | 71,5 % | hors cible |
| `h_lame_spirituelle` | 30 | 9,35 | `m_givre` (12,46) | 75 % | hors cible |
| `h_rodeur_givre` | 15 | 7,45 | `r_venin` (7,88) | 94,5 % | OK |
| `h_rodeur_givre` | 30 | 8,54 | `r_venin` (10,16) | 84,1 % | OK |

Lecture : le Gardien est la construction la plus sûre et le Berserker la plus risquée (même classe, ±20 %), le Mage
de givre domine vers le niveau 15 par le contrôle et le pyromancien au niveau 30 par les dégâts ; les hybrides sont
viables (72 à 95 % du meilleur pur) mais jamais meilleurs, parce qu'ils paient les nœuds 2 points et gardent au moins
une partie de l'Inaptitude.

### 12.3 Changements d'équilibrage appliqués aux brouillons (84)

| Cible | Changement et raison |
|---|---|
| `heal` | Soin : 30 % toutes les 12 s donnait au mage une survie solo très supérieure aux autres classes dès le niveau 15. |
| `ma_v_heal_remanence` | Suit la nouvelle recharge du Soin (15 s). |
| `ma_v_heal_sursaut` | Recharge explicite, alignée sur le Soin de base. |
| `frost_nova` | Nova de givre : 3 charges de Froid d’un coup (−45 % de vitesse d’attaque) rendaient le mage de givre presque intouchable au contact. |
| `statut froid` | Le contrôle du givre réduisait les dégâts subis de plus de 30 % en continu. |
| `marque_de_chasse` | Marque du chasseur : l’outil principal du Rôdeur en solo (+10 % → +15 %). |
| `ro_ti_main_sure` | Main sûre : +4 % → +5 % par rang (enveloppe de dégâts du Rôdeur au niveau du Guerrier et du Mage). |
| `ro_ti_oeil_exerce` | Œil exercé : +2 % → +3 % de critique par rang. |
| `gu_be_chair` | Chair endurcie : +4 % → +5 % de PV par rang. |
| `gu_be_soif` | Soif de sang : +2 % → +3 % de vol de vie par rang (plafond global inchangé : 9 %). |
| `ice_lance` | Lance de glace : ×1,5 → ×1,6 (la branche Givre manquait de dégâts au niveau 30). |
| `ma_v_lance_trio` | Trio : suit la hausse de la Lance (×0,7 → ×0,75 par lance). |
| `blizzard` | Blizzard : ×0,25 → ×0,35 par tic. |
| `frost_nova` | Nova de givre : ×1,1 → ×1,3 (compense la charge de Froid retirée). |
| `trait_fatal` | Trait fatal : ×5,0 → ×4,0 (toujours le plus gros coup du jeu, mais le Tireur dépassait la cible de 25 % au niveau 30). |
| `shield_bash` | Coup de bouclier : recharge 10 → 12 s (le Gardien étourdissait presque en continu). |
| `gu_ga_charge_bouclier` | Suit la recharge du Coup de bouclier. |
| `gu_ga_bouclier_ecrasant` | Suit la recharge du Coup de bouclier. |
| `rage` | Rage sanguinaire : +25 % → +30 % de dégâts, recharge 35 → 30 s (le Berserker restait 30 % sous le Gardien). |
| `ma_v_bolt_givre` | Trait de givre : 1 charge de Froid tous les 2 traits (et non à chaque trait) : le Froid permanent au niveau 15 rendait le mage de givre intouchable. |
| `ro_ti_posture_archer` | Posture de l’archer : +30 % → +20 % de critique à l’arrêt. |
| `ro_ti_point_faible` | Point faible : +12 % → +10 % de dégâts critiques par rang. |
| `fleche_barbelee` | Flèche barbelée : 35 → 30 de saignement (le Venin dépassait la cible au niveau 30). |
| `rage` | Rage sanguinaire : −20 % → −10 % de défense. |
| `blade_wave` | Onde tranchante : ×1,3 → ×1,7 (attaque signature de la Lame spirituelle ; l’hybride restait à 60 % d’un mage pur). |
| `rune_arrow` | Flèche runique : ×1,4 → ×1,7 (signature de l’Arcaniste sylvestre, sans Inaptitude pour Mage et Rôdeur). |
| `frost_brambles` | Ronces givrées : ×0,8 → ×1,0 sur 3 s. |
| `ma_p_coeur_gele` | Cœur gelé : +5 % → +8 % de dégâts contre les cibles ralenties par rang. |
| `garde` | Garde : un bouclier bloque sa valeur de blocage (61 à 90 %, items.json) au lieu de 100 % ; arme de mêlée 70 → 50 %, autre 50 → 30 %. Seule la clé Mur vivant atteint 100 %. |
| `whirlwind` | Tourbillon : ×1,7 → ×1,9 (racine du Berserker, qui restait 27 % sous le Gardien au niveau 15). |
| `frost_armor` | Armure de givre : +25 % → +20 % de défense. |
| `gm_maitrise_runique` | Maîtrise runique : +10 % → +15 % de dégâts élémentaires avec une épée runique. |
| `gm_ks_serment` | Serment de la lame spirituelle : Inaptitude divisée par deux → réduite d’un tiers (l’hybride Guerrier/Mage dépassait le mage pur au niveau 30). |
| `mr_p_seve_arcanique` | Sève arcanique : +4 % → +6 % par rang. |
| `mr_p_oeil_sylvestre` | Œil sylvestre : +3 % → +4 % de critique des projectiles par rang. |
| `gu_be_tourbillon_sanglant` | Tourbillon sanglant : suit la hausse du Tourbillon (×1,6, saignement 80 %). |
| `riposte` | Riposte : ×2,2 → ×1,9 (critique garanti : le Gardien dépassait la cible de 25 %). |
| `ma_ks_coeur_de_braise` | Cœur de braise : +15 % → +20 % de dégâts de feu (le mage restait 15 % sous les autres classes au niveau 30). |
| `mr_ks_arc_des_astres` | Arc des astres : plus de −15 % de mana, mais +15 % (au lieu de +10 %) d’endurance sur les tirs et sorts : l’hybride Rôdeur/givre, à court de mana, restait à 70 % d’un pur. |
| `ma_ks_hiver_eternel` | Hiver éternel : gagne +20 % de dégâts de givre (le mage de givre manquait de dégâts au niveau 30 ; la Lance de glace reste à ×1,6). |
| `rage` | Rage sanguinaire : durée 10 → 12 s. |
| `enchant_blade` | Lame enchantée : +35 % → +40 % de dégâts sur les coups de mêlée et l’Onde tranchante. |
| `gm_lame_arcanique` | Suit la Lame enchantée (+30 % avec l’élément arcane). |
| `gu_ga_constitution` | Constitution : +4 % → +3,5 % de PV par rang (le Gardien restait 25 % au-dessus au niveau 15). |
| `shield_bash` | Coup de bouclier : poise 55 → 48 (le Gardien déséquilibrait presque en continu au niveau 15). |
| `gu_be_tourbillon_aspirant` | Suit le Tourbillon ×1,9. |
| `gu_be_entaille_profonde` | Suit l’Entaille (saignement ×1,5 : 180 % → 270 %). |
| `gu_ga_charge_bouclier` | Suit le Coup de bouclier (poise 48). |
| `gu_ga_riposte_vengeresse` | Suit la Riposte ×1,9. |
| `gm_lance_spectrale` | Suit l’Onde tranchante ×1,7. |
| `gm_croissant` | Suit l’Onde tranchante ×1,7. |
| `ma_v_nova_eclats` | Suit la Nova de givre ×1,3. |
| `ma_v_lance_glacier` | Suit la Lance de glace ×1,6. |
| `ro_ve_barbes_profondes` | Suit la Flèche barbelée (30 de saignement). |
| `ro_ti_visee_eclair` | Suit le Trait fatal ×4,0. |
| `rune_arrow` | Flèche runique : 14 → 10 mana. |
| `wisp` | Feu follet : ×0,3 → ×0,4 par trait. |
| `blade_wave` | Onde tranchante : recharge 8 → 7 s. |
| `gm_lance_spectrale` | Suit la recharge de l’Onde (7 s). |
| `rend` | Entaille : ×0,9 → ×1,0 et saignement 180 % de l’attaque en 6 s (outil principal du Berserker avant le niveau 20). |
| `ice_lance` | Lance de glace : ×1,6 → ×2,4 (le Mage de Givre restait 24 % sous la moyenne au niveau 30). |
| `ma_v_lance_glacier` | Suit la Lance de glace ×2,4. |
| `ma_v_lance_trio` | Suit la Lance de glace ×2,4 (×0,75 → ×1,1 par lance). |
| `rapid_fire` | Tir rapide : ×0,8 → ×0,77 par flèche (Main sûre, dans le préréglage des Rôdeurs v0.2, compense : aucun vétéran n’y perd). |
| `ro_ti_rafale` | Suit le Tir rapide ×0,77. |
| `ro_ti_salve_eventail` | Suit le Tir rapide ×0,77. |
| `arrow_rain` | Pluie de flèches : ×1,25 → ×1,2 (compensé par Main sûre pour les vétérans). |
| `ro_ti_averse_acier` | Suit la Pluie de flèches ×1,2. |
| `piercing_shot` | Tir perçant : ×1,9 → ×1,7 (il ignore désormais 30 % de l’armure et transperce : au moins aussi fort qu’en v0.2 sur une cible en armure). |
| `ro_ti_oeil_exerce` | Œil exercé : +3 % → +2 % de critique par rang (le Tireur dépassait la moyenne de 31 % au niveau 20). |
| `ro_ti_point_faible` | Défaut de la cuirasse : +10 % → +6 % de dégâts critiques par rang. |
| `fleche_empoisonnee` | Flèche empoisonnée : ×0,6 → ×0,8 (le Venin remonte vers la moyenne). |
| `fleche_barbelee` | Flèche barbelée : ×1,0 → ×1,2. |
| `shield_bash` | Coup de bouclier : ×1,0 → ×1,3 (le Gardien restait sous la moyenne au niveau 30). |
| `ignite` | Embrasement : 150 % → 120 % de la brûlure restante, ×0,6 → ×0,45 sans brûlure (le Pyromancien dépassait la moyenne de 19 % au niveau 20). |
| `ma_v_ignite_detonation` | Suit l’Embrasement (120 %). |
| `ma_p_flamme_attisee` | Flamme attisée : +4 % → +3 % de dégâts de feu par rang. |
| `ma_p_fournaise` | Fournaise : +5 % → +4 % de dégâts de feu par rang. |
| `rage` | Rage sanguinaire : +30 % → +25 % de dégâts (le Berserker dépassait la moyenne de 18 % au niveau 30). |
| `blade_wave` | Onde tranchante : ×1,7 → ×1,8, mana 18 → 13 (la Lame spirituelle, à court de mana, restait 25 % sous la moyenne au niveau 20). |
| `gm_lance_spectrale` | Suit l’Onde tranchante ×1,8. |
| `gm_croissant` | Suit l’Onde tranchante ×1,8. |
| `enchant_blade` | Lame enchantée : +40 % → +50 %, mana 25 → 20. |
| `gm_lame_arcanique` | Suit la Lame enchantée (+40 % avec l’élément arcane). |

Les valeurs exactes avant / après de chaque changement sont dans `skilltree.json › meta.balanceChanges`.

Côté objets : la potion de soin suprême passe de 520 à **400 PV** et **toutes les potions partagent une recharge de
20 s** (voir `OBJETS_ARTISANAT.md`).

## 13. Validation (`node docs/design/tools/validate.mjs`)

Résultat : **OK**, 0 erreur, 1 avertissement (monstre skeleton : niveaux 8,11 hors du palier T3 10,15).

Contrôles de l'arbre : ids uniques ; liens existants et réciproques ; coûts cohérents avec `nodeCost` ; 5 Fondamentaux
reliés au Cœur ; porte des 3 Fondamentaux appliquée ; chaque départ donne une seule capacité (l'attaque de base) ;
tailles des régions et passerelles ; chaque passerelle reliée à ses deux régions ; tout nœud joignable par les trois
classes ; capacités v0.2 à 4 points au plus ; chaque capacité débloquée quelque part et dotée d'au moins un groupe
de variantes ; chaque variante avec son intention visuelle ; chaque clé de voûte avec gain et contrepartie ;
vocabulaire des effets (104 statistiques décrites dans `effectVocabulary`) ; géométrie (distances, liens,
croisements, secteurs) ; tirages de variantes ; préréglages de migration valides aux niveaux 1, 3, 5 et 20.

Coût maximal pour atteindre une zone depuis son départ (Dijkstra, sans la porte) :

| Classe | Survie | Guerrier | Lame spirituelle | Mage | Arcaniste sylvestre | Rôdeur | Chasseur |
|---|---|---|---|---|---|---|---|
| Guerrier | 5 | 9 | 9 | 23 | 19 | 23 | 9 |
| Mage | 5 | 26 | 6 | 8 | 6 | 23 | 23 |
| Rôdeur | 5 | 26 | 19 | 23 | 8 | 8 | 8 |

## 14. Données, serveur et interface

### 14.1 Format (`skilltree.json`)

- `rules` (points, porte, coûts, Inaptitude, armes, garde-fous, réinitialisation, migration, barre, touches),
  `classes`, `regions`, `statuses`, `abilities`, `exclusiveGroups`, `nodes`, `keystones`, `migration`,
  `effectVocabulary`, `meta.balanceChanges`.
- Nœud : `{ id, region, branch, type, name, desc, x, y, links, maxRank, costs, start?, fondamental?, migrationGift?,
  minLevel?, reqRegionPoints?, ability?, exclusiveGroup?, effects, vfx? }`.
- Effet : `{ stat | mod, op: 'add' | 'mul' | 'set', value, perRank?, atRank?, cap?, final?, when? }`. `mod` vaut
  `"<idCapacité>.<champ>"` ou `"unlock"`. **Toutes les valeurs relatives sont des fractions** (0,04 = +4 %) ; `mul`
  s'additionne à un multiplicateur (valeur finale = base × (1 + Σ mul)).
- Résolution d'une capacité (`resolveAbility`, pure, partagée client/serveur) : base → variante (`set`) → `add` →
  `mul` → statistiques du personnage (enveloppe de dégâts plafonnée) → Inaptitude et attaque de référence → pénalité
  d'arme → garde-fous → effets `final`.

### 14.2 Validation serveur et protocole

- État persistant : `skills: { ver, alloc: { nodeId: rang }, gift: ['fond_roulade', 'fond_sprint'], legacyFloor, rb, affinity, loadout: [8] }`.
- `validateTree(cls, level, alloc, gift)` vérifie l'état complet : ids, rangs, niveau minimum, points, groupe
  exclusif, porte, points dans la région, connexité, variante de capacité connue (implémentation de référence :
  `docs/design/tools/lib/treelib.mjs`). Codes : `tree_unknown`, `tree_points`, `tree_gate`, `tree_link`,
  `tree_exclusive`, `tree_rank`, `tree_level`, `tree_req`, `tree_variant`, `tree_combat`, `tree_gold`, `tree_npc`, `loadout_bad`.
- Messages (additifs) : C2S `skill_alloc { add: [{ id, r? }] }` (tout ou rien), `skill_respec { mode, id?, npc? }`,
  `loadout { slots }`, `ability { slot, tg?, x?, z?, ph?: 'start' | 'release' }`, `jump { dx, dz }`, `guard { on }`,
  `settings { keys }` ; S2C `skills { pts, spent, alloc, gift, loadout }`, FX `jump`, `land`, `guard`,
  `block`, `parry`, `perfect`, `charge`, `charged`, `vacille`, `guard_break`, télégraphes `lo`/`nb`/`mag`.
- Limites : 5 messages d'arbre par seconde, 64 nœuds par message (au-delà : `security.flag(player, 'tree_spam', 1)`).
  Le serveur ne fait jamais confiance aux valeurs du client : il résout la capacité et vérifie l'arme à chaque usage.

### 14.3 Pas de réinitialisation ; migration

- Aucune réinitialisation (DECISIONS.md §3) : la Renaissance, au niveau 30, rend tous les points.
- **Personnages v0.2** : Roulade et Sprint placés d'office et offerts (ils comptent pour la porte, sans coûter de point : un avantage permanent des vétérans), un plancher de points (Guerrier 4, Mage 6, Rôdeur 6 : le coût du préréglage) tant que points(niveau) est plus petit, et le préréglage « Reprendre mon style » appliqué automatiquement à la première connexion : chacun retrouve ses 4 compétences v0.2 (le Mage garde un Soin de 35 % avec la variante Rémanence). Pas de réinitialisation : la Renaissance au niveau 30 la remplace.

| Classe | Préréglage « Reprendre mon style » | Points |
|---|---|---|
| Guerrier | Garde, Coup puissant, Cri de guerre, Tourbillon | 4 |
| Mage | Saut, Boule de feu, Trait de feu, Nova de givre, Soin, Rémanence | 6 |
| Rôdeur | Saut, Main sûre, Tir perçant, Tir rapide, Œil exercé, Pluie de flèches | 6 |

### 14.4 Barre d'action, livre et touches

- **8 emplacements** (touches 1 à 8), un par personnage, sauvegardés sur le serveur ; **livre de compétences** (K)
  avec les valeurs résolues (variante, passifs, Inaptitude en orange) et **glisser-déposer** ; potions dans la barre
  (par défaut 5 et 6, comme en v0.2). Toute action se réassigne (Options › Touches), souris et combinaisons comprises ;
  touches enregistrées par code physique (AZERTY/QWERTY).

| Action | Touche par défaut |
|---|---|
| roulade | ShiftLeft (appui court) |
| sprint | ShiftLeft (maintenir) |
| saut | Space |
| garde | KeyE (maintenir) |
| attaque_chargee | maintenir l'attaque de base |
| slots | Digit1..Digit8 |
| arbre | KeyN |
| livre | KeyK |
| carte | KeyM |
| cible | Tab |

### 14.5 Écran de l'arbre (touche N)

Canevas 2D déplaçable et zoomable (0,3 à 2,0), mini-carte, recherche (Ctrl+F), chemin le moins cher au survol
(Dijkstra sur les coûts du personnage), **aperçu avant validation** (rien n'est dépensé sans « Valider (n points) »).
Formes par type : compétence = grand cercle doré, variante = losange turquoise (les variantes d'un groupe reliées par
un arc pointillé), passif = petit cercle avec « 1/3 », clé de voûte = octogone pourpre, Fondamental = anneau blanc-or.
Fond teinté par région (Guerrier #c0392b, Mage #2e6fd8, Rôdeur #2e9e4f, Survie brume neutre, passerelles en dégradé).
Coût 2 ou 3 en pastille orange « Pas de don : 2 points, Inaptitude −25 % ». Lisible en 1280 × 720.

## 15. Décisions de synthèse

1. **Repère** : y vers le haut pour tous ; le brouillon Rôdeur (y écran) a été retourné.
2. **Ids** : départs `guerrier_depart`, `mage_depart`, `rodeur_depart` ; préfixes `gu_` (Guerrier : `gu_ga_`
   Gardien, `gu_be_` Berserker, `gu_md_` Maître d'armes), `gm_`, `ma_`, `mr_`, `ro_` (`ro_ti_`, `ro_tq_`,
   `ro_ve_`), `rg_`, `sv_`, `fond_`, `ks_`. La *Riposte* de Survie devient **Contre parfait**
   (`riposte_parfaite`) et l'*Estocade* du Chasseur **Coup d'épieu** (`coup_epieu`), pour ne pas avoir deux
   compétences du même nom.
3. **Cadence** (`gu_md_cadence`) devient un passif qui porte le 2ᵉ groupe de variantes de la Frappe.
4. **Effets** : un seul vocabulaire, fractions partout (les brouillons Survie et Mage étaient en points de pourcentage).
5. **Attaque chargée** : les chiffres du brouillon Survie font foi pour toutes les classes (×1,8 max) ; l'arc garde
   sa charge en 1 s et sa perforation.
6. **Garde** : un bouclier bloque sa valeur de blocage d'`items.json` (61 à 90 %), pas 100 %.
7. **Inaptitude** : réductions additionnées, plafond 0,6 ; *Serment de la lame spirituelle* ramené à un tiers.
8. **Départ d'une autre classe** : 2 points, donne son attaque de base avec Inaptitude. Un non-mage qui prend
   `mage_depart` peut prendre les variantes de forme du Trait arcanique (2 points chacune).
9. **Migration** : points plancher (`legacyFloor`) pour que les personnages v0.2 de bas niveau retrouvent leurs 4
   compétences.
10. **Mise en page** : 16 variantes du brouillon Rôdeur légèrement déplacées et un lien retiré
    (`ro_tq_acrobate`–`ro_tq_coup_de_dague`) pour qu'aucun lien ne passe sur un nœud.

## 15 bis. Relecture critique (joueur débutant, vétéran soulslike, exploiteur)

Changements appliqués après la synthèse (`skilltree.json › meta.criticChanges`, code : fin de `build_tree.mjs`) :

| Cible | Changement | Pourquoi |
|---|---|---|
| `sv_esquive_parfaite` | remboursement plafonné au coût payé | Avec Danseur des brumes (roulade gratuite), chaque esquive parfaite créait 15 d’endurance : endurance infinie. |
| `ro_tq_fantome_brumes` | sans effet sur les boss, moitié sur les élites | Un boss qui perd sa cible 1,5 s toutes les 8 s = 19 % du combat sans danger. |
| `ro_ve_sang_pour_sang` | recharge interne 4 s | Dans un groupe de monstres, les plaies éclatent en série : 8 % de PV par cible, soin quasi continu. |
| `rg_frenesie` | remboursement ≤ 50 % du coût de l’attaque | Frappe éclair (4 d’endurance) + 4 rendus = attaques gratuites : toute l’endurance restait pour les roulades. |
| `ks_dernier_souffle` | recharge 240 s contre un joueur | En zone rouge, une seconde vie garantie par combat décidait trop de duels. |
| `attaque_sautee` | recharge de l’attaque de base après la réception | Sauter à chaque attaque donnait ×1,3 (×1,7 avec Frappe plongeante) de DPS et une zone pour 20 d’endurance. |
| `sv_eventail` | un seul projectile par cible | À bout portant, les 3 projectiles ×0,6 touchaient la même cible : ×1,8 de plus que la charge normale. |
| `survie (13 variantes)` | descriptions chiffrées | Les variantes de Survie étaient seulement qualitatives (« bien plus fort ») : impossible à comparer sans wiki. |
| `gu_md_elan` | Élan → Enchaînement | Même nom qu’un autre nœud (Élan, Garde de fer, Entaille profonde, Point faible, Contagion). |
| `gu_ga_garde_de_fer` | Garde de fer → Poigne de fer | Même nom qu’un autre nœud (Élan, Garde de fer, Entaille profonde, Point faible, Contagion). |
| `ro_ve_entaille_profonde` | Entaille profonde → Lame barbelée | Même nom qu’un autre nœud (Élan, Garde de fer, Entaille profonde, Point faible, Contagion). |
| `ro_ti_point_faible` | Point faible → Défaut de la cuirasse | Même nom qu’un autre nœud (Élan, Garde de fer, Entaille profonde, Point faible, Contagion). |
| `ro_ve_contagion` | Contagion → Épidémie | Même nom qu’un autre nœud (Élan, Garde de fer, Entaille profonde, Point faible, Contagion). |
| `rules.guide` | parcours conseillé niveaux 2 à 10 pour chaque classe | Un nouveau joueur ne peut pas lire 318 nœuds : un clic par niveau suffit, sans wiki. |

Vérifié sans changement : aucune invulnérabilité permanente (roulade ≤ 450 ms et ≤ 75 % de sa recharge, Danseur
1,8 s), tir en mouvement toujours ≤ 40 % de la vitesse, immobilisations suivies de 8 s d'immunité et jamais sur un
boss, vol de vie ≤ 9 %, réduction de recharge ≤ 30 %, Garde à 100 % seulement avec bouclier + Mur vivant (85 % contre
un boss) et toujours payée en endurance.

## 16. Questions ouvertes

1. **Vacillement du joueur**, marqueurs `lo` / `nb` / `mag`, Mur de glace qui bloque les monstres, pièges, filets
   et appâts comme entités serveur, interruption des incantations par un coup télégraphié : nouvelles mécaniques à
   valider par l'équipe combat (des replis sont décrits dans les brouillons).
2. **Formule de défense** `K = 60 + 6 × max(0, niveau − 10)` et **recharge commune des potions (20 s)** : à confirmer
   par la simulation de combat.
3. **Touches par défaut** du Saut (C) et de la Garde (E maintenue) : le clic droit sert déjà à cibler et attaquer.
4. **Rendements décroissants des immobilisations en JcJ** (2 en 6 s → insensible 6 s) : règle commune à confirmer.
5. Coût de réinitialisation (25 × niveau) à caler sur le revenu en or de la v0.3 ; courbe d'XP au-delà du niveau 20.
6. Refaire l'équilibrage avec `tests/balance/sim.mjs` étendu aux profils de §12 (le modèle rapide ne simule ni les
   déplacements ni les boss).

## Annexe — brouillons

Les brouillons d'origine restent dans `docs/design/drafts/` : `tree_rules.md`, `tree_survie.*`, `tree_warrior.*`,
`tree_mage.*`, `tree_ranger.*` (et `items.*`, `crafting.*` pour les objets). Ils contiennent les justifications
détaillées de chaque branche ; ce document et `skilltree.json` font foi en cas d'écart.
