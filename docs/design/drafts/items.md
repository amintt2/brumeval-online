# Butin v2 — catalogue des objets (brouillon v0.3)

> Brouillon de l'agent « objets » pour la synthèse de `docs/design/OBJETS_ARTISANAT.md`.
> Source de vérité chiffrée : `docs/design/drafts/items.json` (clés `families`, `bases`, `uniques`, `sets`, `affixes`,
> `rarities`, `dropTables`, `forge`, `salvage`, plus `meta` pour les formules, les règles souples et la migration, et
> `lines` pour les séries d'armure). Tous les chiffres ci-dessous en sont tirés.
> Contraintes respectées : ROADMAP §1 et §2 bis (6 paliers, 5 raretés, affixes, forge +1 à +10, recyclage, ensembles),
> équilibrage v0.2 de `wave1/combat-souls` (endurance, roulade, déséquilibre, élites), ids v0.1 conservés.

## 0. En bref

- **9 emplacements** : arme, main gauche, tête, torse, mains, pieds, 2 anneaux, amulette.
- **Plus aucune restriction de classe** : n'importe qui porte n'importe quoi. Seul le **niveau requis** compte. Ce que
  l'on porte a des effets **visibles** : l'arme donne des **étiquettes** qui débloquent les compétences
  correspondantes de l'Arbre des Brumes, et l'armure a un **poids** (plaques / cuir / tissu) qui agit sur
  l'endurance, la roulade, le sprint et l'incantation.
- **6 paliers** (T1 → T6, niveaux 1 à 30), **5 raretés** à la couleur évidente, **19 affixes** dont la valeur grandit
  avec le niveau de l'objet.
- **18 familles d'armes** et de main gauche, dont **8 familles d'épées** : **36 épées** nommées (6 par palier),
  plus **6 épées légendaires** de boss (et 4 autres légendaires).
- **18 séries d'armure** (3 types × 6 paliers, 4 pièces chacune) : **10 séries d'artisanat** partagées avec le
  brouillon d'artisanat (`crafting.json`, mêmes ids) et **8 ensembles de butin** avec bonus à 2 et 4 pièces (boss,
  donjons, zones rouges, monstres rares).
- **Forge +1 à +10** avec 3 pierres de forge, **jamais de destruction** ; **Retremper** (changer un affixe) ;
  **Recyclage** en matériaux et essences.
- Au total : **196** objets de base, dont les 13 objets d'équipement v0.1 avec leurs ids.

## 1. Principes : simple et accessible

1. **La couleur dit tout** : blanc < vert < bleu < violet < orange. Plus d'affixes = meilleure couleur, sans exception.
2. **L'infobulle compare toute seule** avec l'objet porté au même emplacement (pour un anneau : le plus faible des
   deux). Gains en vert, pertes en rouge, et une ligne de synthèse : « Dégâts par seconde de l'attaque de base :
   38 → 44 (+16 %) ». Cette ligne rend honnête la comparaison entre une rapière rapide et un espadon lent.
3. **Aucune règle cachée** : chaque effet d'arme, de poids d'armure, de bonus d'ensemble ou de légendaire est écrit en
   toutes lettres dans l'infobulle. Les chances de butin des boss et le compteur de « malchance » sont affichés dans
   le journal de boss.
4. **Tout l'aléatoire est tiré par le serveur** (rareté, base, affixes, forge). Le client ne fait qu'afficher.
5. **Rien ne se perd bêtement** : la forge ne détruit jamais, un légendaire ne se recycle pas, recycler un objet Rare
   ou mieux demande une confirmation.

## 2. Raretés

| Rareté | Couleur | Affixes | Stat de base | Vente | Règle |
|---|---|---:|---:|---:|---|
| Commun | blanc `#e8e8e8` | 0 | ×1,00 | ×1 | vendu par les marchands |
| Inhabituel | vert `#3fd46a` | 1 | ×1,05 | ×2 | |
| Rare | bleu `#3f8cff` | 2 | ×1,10 | ×4 | = qualité « Supérieure » en artisanat |
| Épique | violet `#b85cff` | 3 | ×1,15 | ×8 | ensembles de butin ; = « Chef-d'œuvre » en artisanat |
| Légendaire | orange `#ff9f1a`, halo | 3 fixes | ×1,20 | ×20 | objet unique de boss, effet spécial fixe |

- Les couleurs des 4 premières raretés sont celles de `RARITY_COLORS` en v0.1 ; seule la légendaire est ajoutée.
- **Tirage des affixes** : pioche pondérée (`w`) parmi les affixes autorisés pour l'emplacement, sans doublon, au plus
  **un dégât élémentaire** (Braise / Givre / Arcane) et au plus **deux résistances** par objet. La valeur est tirée
  uniformément dans la fourchette du niveau d'objet (§8).
- **Ensembles de butin** : toujours Épiques, affixes fixes à la valeur médiane, pour qu'un ensemble soit toujours
  prévisible. Objets fabriqués : la qualité donne la rareté (Normale = Inhabituel, Supérieure = Rare,
  Chef-d'œuvre = Épique), comme dans `crafting.json`.

## 3. Paliers et niveau d'objet

| Palier | Régions | Niveaux | Allure |
|---|---|---|---|
| **T1** | Brumeval, Plaines d'Émeraude, Prairie du Sud | 1–5 | fer rouillé, bois clair, lin brut |
| **T2** | Forêt des Murmures, camp gobelin | 5–10 | acier sombre, cuir tanné, plumes, os gravés |
| **T3** | Cimetière oublié, Antre du Golem | 10–15 | os, fer noirci, suaires, runes pâles |
| **T4** | Marais de Brumenoire, Désert de Sable-Rouge, Côte de Port-Salin | 15–20 | bronze, chitine, cuir huilé, vase |
| **T5** | Pics de Givreval, Grotte gelée (donjon v0.4) | 20–25 | acier bleu, fourrure blanche, givre |
| **T6** | Ruines d'Aldmar, zones rouges, Crypte d'Aldmar (donjon v0.4) | 25–30 | or terni, runes ardentes, pourpre et noir |

- **Niveau d'objet** = niveau du monstre (+2 en zone rouge, maximum 30). Il fixe la **valeur des affixes**.
- **Base tirée** parmi les bases du palier de ce niveau dont le niveau requis ≤ niveau d'objet : on ne ramasse jamais
  un objet qu'on ne peut pas porter à son niveau.
- **Niveau requis** = niveau de la base. Stats de base fixes par base (lisibles : « Épée de Brumenoire : 31
  d'attaque »), affixes variables.
- Chaque palier renouvelle **toutes** les bases : il y a toujours mieux à trouver jusqu'au niveau 30, puis la chasse
  continue avec les raretés, les ensembles, les légendaires et la forge (voir §12, « Courbe de progression »).

## 4. Armes : familles, sensations et étiquettes

Formule : **attaque = (3 + 1,6 × niveau) × multiplicateur de famille × rareté × forge**. Elle retombe sur les objets
v0.1 (Épée d'acier niv. 6 = 12 d'attaque). « Vitesse » multiplie la recharge de l'attaque de base (et la durée de
charge de l'**Attaque chargée**) ; « Déséquilibre » multiplie les dégâts de poise (v0.2) ; « Endurance » multiplie
le coût en endurance des compétences d'arme (`ABILITIES[*].st`).

| Famille | Mains | Attaque | Vitesse | Allonge / portée | Critique | Déséquilibre | Endurance | Étiquettes | Particularité |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| **Épée courte** `epee_courte` | 1 | ×0.85 | rapide (×0.85) | 2.5 m | +3 % | ×0.8 | ×0.8 | melee, lame | Rapide et économe, idéale avec un bouclier. |
| **Épée longue** `epee_longue` | 1 | ×1 | normale (×1) | 2.8 m | — | ×1 | ×1 | melee, lame | La référence : aucun point faible, aucun point fort. |
| **Épée bâtarde** `epee_batarde` | 1 | ×1.15 | un peu lente (×1.12) | 3 m | — | ×1.25 | ×1.15 | melee, lame, lourde | Une main et demie : plus lourde, plus d’allonge, déséquilibre mieux. |
| **Rapière** `rapiere` | 1 | ×0.85 | rapide (×0.85) | 3.1 m | +8 % | ×0.6 | ×0.85 | melee, lame, estoc | Estoc : ignore 15 % de la défense de la cible. |
| **Cimeterre** `cimeterre` | 1 | ×0.9 | rapide (×0.9) | 2.7 m | +4 % | ×0.8 | ×0.9 | melee, lame, taille | Taille large : l’attaque de base touche jusqu’à 2 ennemis devant soi. |
| **Lame courbe** `lame_courbe` | 2 | ×1.1 | normale (×1) | 2.9 m | +5 % | ×0.9 | ×1.05 | melee, lame, deux_mains, taille | +25 % de dégâts critiques. |
| **Espadon** `espadon` | 2 | ×1.45 | lente (×1.35) | 3.4 m | — | ×1.8 | ×1.5 | melee, lame, deux_mains, lourde | Balayage : l’attaque de base touche tous les ennemis dans un arc de 120°. |
| **Épée runique** `epee_runique` | 1 | ×1 | un peu lente (×1.05) | 2.8 m | — | ×1 | ×1 | melee, lame, focalisateur_partiel | 25 % des dégâts de mêlée sont arcaniques ; les sorts lancés avec elle ne subissent que −10 % (au lieu de −30 %). |
| **Hache** `hache` | 1 | ×1.1 | un peu lente (×1.1) | 2.6 m | +2 % | ×1.3 | ×1.1 | melee, hache | Brise-garde : +50 % de dégâts contre une cible qui se protège (squelettes, boucliers, joueurs en Garde). |
| **Masse** `masse` | 1 | ×1.05 | un peu lente (×1.15) | 2.5 m | — | ×1.6 | ×1.15 | melee, masse, lourde | Écrasement : +20 % de dégâts contre les squelettes, golems et créatures à carapace. |
| **Lance** `lance` | 1 | ×1 | un peu lente (×1.05) | 3.8 m | +2 % | ×1 | ×1 | melee, lance, estoc | Allonge : frappe en ligne droite, touche 2 ennemis alignés. |
| **Dague** `dague` | 1 | ×0.7 | rapide (×0.7) | 2.2 m | +12 % | ×0.5 | ×0.7 | melee, dague, estoc | Dans le dos : ×1,5 dégâts sur une cible qui ne vous fait pas face. |
| **Bâton** `baton` | 2 | ×1.05 | normale (×1) | 18 m | — | ×0.7 | ×1 | focalisateur, melee, deux_mains, baton | Sorts à pleine puissance ; peut aussi frapper au corps à corps (faible impact). |
| **Sceptre** `sceptre` | 1 | ×0.85 | rapide (×0.9) | 18 m | +2 % | ×0.8 | ×0.9 | focalisateur, melee, sceptre | Sorts à pleine puissance ; −10 % de temps de recharge des sorts. |
| **Arc court** `arc_court` | 2 | ×0.9 | rapide (×0.85) | 18 m | +3 % | ×0.8 | ×0.9 | distance, arc | Tir en mouvement jusqu’à 55 % de sa vitesse (au lieu de 40 %). |
| **Arc long** `arc_long` | 2 | ×1.1 | un peu lente (×1.1) | 24 m | +4 % | ×1 | ×1 | distance, arc | Portée maximale et précision, à l’arrêt. |
| **Arbalète** `arbalete` | 2 | ×1.4 | lente (×1.5) | 20 m | +2 % | ×1.6 | ×1.2 | distance, arbalete, lourde | Carreau : ignore 20 % de la défense de la cible. |

**Main gauche** (emplacement `offhand`) :

- **Bouclier** : défense + **blocage** (60 à 90 %). En **Garde** (Fondamental), un bouclier bloque ce pourcentage des
  dégâts frontaux au lieu de 50 % ; chaque coup bloqué coûte de l'endurance, 20 % de moins qu'en Garde à l'arme
  (`guardStamina` 0,8, coût exact fixé avec la Garde dans l'arbre).
- **Grimoire** : mana et un peu d'attaque ; compte comme focalisateur secondaire.
- **Carquois** : attaque et critique pour les tirs ; seule main gauche possible avec un arc ou une arbalète.
- Une arme à deux mains (lame courbe, espadon, bâton, arcs, arbalète) interdit bouclier et grimoire.

### 4.1 Étiquettes d'arme → compétences (lien avec l'Arbre des Brumes)

L'arme ne réserve plus rien à une classe : elle **donne des étiquettes**, et chaque compétence de l'arbre en demande
une. Une compétence dont l'étiquette manque est **grisée** dans la barre, avec « Demande : arme de mêlée ».

| Étiquette | Donnée par | Débloque (exemples, à aligner avec `ARBRE_COMPETENCES`) |
|---|---|---|
| `melee` | toutes les épées, haches, masses, lances, dagues, bâtons, sceptres | Frappe, Coup puissant, Tourbillon, attaques sautées |
| `lame` | les 8 familles d'épées | variantes de Frappe « saignante », « éclair » ; parade à la lame |
| `estoc` | rapière, lance, dague | variantes de percée (fente, estocade) |
| `taille` | cimeterre, lame courbe | variantes en arc (Frappe tournoyante) |
| `lourde` | épée bâtarde, espadon, masse, arbalète | variantes d'écrasement, Attaque chargée renforcée |
| `hache`, `masse`, `lance`, `dague` | la famille du même nom | nœuds propres à la famille (ex. Dans le dos pour la dague) |
| `distance`, `arc`, `arbalete` | arcs courts, arcs longs, arbalètes | Tir, Tir perçant, Pluie de flèches, Tir rapide |
| `focalisateur` | bâton, sceptre | sorts à pleine puissance |
| `focalisateur_partiel` / `focalisateur_secondaire` | épée runique / grimoire | sorts à −10 % seulement |
| `bouclier` | bouclier | Garde renforcée, Coup de bouclier, variantes de parade |

- **Sorts sans focalisateur** : possibles, mais **−30 %** de puissance. Un guerrier qui a appris Boule de feu peut la
  lancer l'épée à la main, moins bien qu'un mage avec un bâton — c'est le « pas de don pour ça » côté équipement,
  et il se cumule avec l'Inaptitude de l'arbre.
- **Attaque de base** : la Frappe devient celle de l'arme portée (mêlée avec une arme `melee`, Tir avec une arme
  `distance`, Trait de feu avec un `focalisateur` quand on vise à distance). Le choix de l'arme change donc la
  compétence de départ elle-même, ce que les variantes de l'arbre transforment ensuite.
- **Fondamentaux** : l'Attaque chargée dure `1 s × vitesse` de la famille (espadon lent, dague vive) ; l'attaque
  sautée inflige les dégâts de déséquilibre de la famille ×1,5 ; la Garde utilise le bouclier s'il y en a un, sinon
  l'arme (50 %).

## 5. Les épées : 36 épées nommées

Six épées par palier, en couvrant toutes les familles au fil de la progression (l'épée runique arrive en T3,
l'espadon en T2). Les épées de 3 ids v0.1 (`rusty_sword`, `steel_sword`, `runeblade`) gardent leur nom et leurs
chiffres. L'**implicite** est un affixe fixe propre à la base, affiché sous la stat principale (il s'ajoute aux
affixes de rareté).

| Palier | Épée | Famille | Niv. | Attaque | Implicite | id |
|---|---|---|---:|---:|---|---|
| T1 | Épée rouillée *(v0.1)* | Épée longue | 1 | 4 | — | `rusty_sword` |
| T1 | Glaive du milicien | Épée courte | 1 | 4 | — | `militia_gladius` |
| T1 | Coutelas du berger | Épée courte | 3 | 7 | Vitalité 13 | `shepherd_cutlass` |
| T1 | Rapière de l'écuyer | Rapière | 3 | 7 | — | `squire_rapier` |
| T1 | Épée de fer de Brumeval | Épée longue | 4 | 9 | Garde 2 | `brumeval_longsword` |
| T1 | Bâtarde du garde | Épée bâtarde | 5 | 13 | — | `guard_bastard` |
| T2 | Épée d'acier *(v0.1)* | Épée longue | 6 | 12 | — | `steel_sword` |
| T2 | Cimeterre gobelin | Cimeterre | 6 | 11 | — | `goblin_scimitar` |
| T2 | Rapière du duelliste | Rapière | 7 | 12 | Précision 2 | `duelist_rapier` |
| T2 | Lame des Murmures | Épée courte | 8 | 13 | Vitesse d'attaque 4 | `whisper_blade` |
| T2 | Bâtarde du chevalier errant | Épée bâtarde | 8 | 18 | — | `knight_errant_bastard` |
| T2 | Espadon du mercenaire | Espadon | 10 | 28 | — | `mercenary_greatsword` |
| T3 | Épée du fossoyeur | Épée longue | 11 | 21 | — | `gravedigger_sword` |
| T3 | Lame runique *(v0.1)* | Épée runique | 12 | 24 | — | `runeblade` |
| T3 | Aiguille d'os | Rapière | 12 | 19 | Précision 2 | `bone_needle` |
| T3 | Lame courbe du Veilleur | Lame courbe | 12 | 24 | — | `watcher_curved_blade` |
| T3 | Espadon sépulcral | Espadon | 13 | 35 | Équilibre 12 | `sepulchral_greatsword` |
| T3 | Cimeterre du Deuil | Cimeterre | 14 | 23 | — | `mourning_scimitar` |
| T4 | Épée de Brumenoire | Épée longue | 16 | 29 | Résistance au poison 8 | `brumenoire_longsword` |
| T4 | Cimeterre de Sable-Rouge | Cimeterre | 16 | 26 | — | `redsand_scimitar` |
| T4 | Lame courbe du nomade | Lame courbe | 17 | 33 | — | `nomad_curved_blade` |
| T4 | Rapière de Port-Salin | Rapière | 18 | 27 | — | `portsalin_rapier` |
| T4 | Bâtarde à dard | Épée bâtarde | 18 | 37 | Précision 3 | `stinger_bastard` |
| T4 | Espadon des Dunes | Espadon | 20 | 51 | — | `dune_greatsword` |
| T5 | Lame de Givreval | Épée longue | 21 | 37 | Résistance au givre 10 | `givreval_longsword` |
| T5 | Glaive du trappeur | Épée courte | 21 | 31 | — | `trapper_gladius` |
| T5 | Runes du Blizzard | Épée runique | 22 | 38 | Givre 9 | `blizzard_runes` |
| T5 | Fendeur des glaciers | Espadon | 23 | 58 | — | `glacier_cleaver` |
| T5 | Lame courbe de l'Aube froide | Lame courbe | 24 | 46 | — | `coldawn_curved_blade` |
| T5 | Bâtarde de la Sentinelle glacée | Épée bâtarde | 25 | 49 | — | `frozen_sentinel_bastard` |
| T6 | Épée d'Aldmar | Épée longue | 26 | 45 | — | `aldmar_longsword` |
| T6 | Rapière du Sang versé | Rapière | 27 | 39 | Vol de vie 3 | `bloodshed_rapier` |
| T6 | Cimeterre du Pillard écarlate | Cimeterre | 27 | 42 | — | `scarlet_raider_scimitar` |
| T6 | Épée runique des Anciens | Épée runique | 28 | 48 | Arcane 10 | `elder_runesword` |
| T6 | Espadon du Roi déchu | Espadon | 29 | 72 | — | `fallen_king_greatsword` |
| T6 | Lame courbe du Crépuscule | Lame courbe | 30 | 56 | — | `dusk_curved_blade` |

Les épées comptent **double** dans le tirage des armes (retour « beaucoup plus d'épées ») : environ une arme sur deux
qui tombe est une épée.

### 5.1 Les autres armes et la main gauche (une base par palier)

| Famille | T1 | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|---|
| **Hache** | Hachette de bûcheron (2, 7 att.) | Hache gobeline (7, 16 att.) | Hache du bourreau (12, 24 att.) | Hache de Brumenoire (17, 33 att.) | Hache de Givreval (22, 42 att.) | Hache du Pillard écarlate (27, 51 att.) |
| **Masse** | Gourdin clouté (2, 7 att.) | Masse du milicien (8, 17 att.) | Masse du Chapelain (13, 25 att.) | Masse de bronze des sables (18, 33 att.) | Masse du Glacier (23, 42 att.) | Masse du Roi déchu (28, 50 att.) |
| **Lance** | Épieu de chasse (3, 8 att.) | Lance forestière (8, 16 att.) | Pique sépulcrale (13, 24 att.) | Trident de Port-Salin (18, 32 att.) | Lance de la Sentinelle glacée (23, 40 att.) | Lance d'Aldmar (28, 48 att.) |
| **Dague** | Couteau à dépecer (1, 3 att.) | Dague gobeline (6, 9 att.) | Stylet du fossoyeur (11, 14 att.) | Dard de scorpion (16, 20 att.) | Croc de givre (21, 26 att.) | Miséricorde écarlate (26, 31 att.) |
| **Bâton** | Bâton d'apprenti (1, 5 att.)<br>Bâton de coudrier (4, 10 att.) | Bâton arcanique (6, 13 att.) | Bâton des braises (12, 26 att.) | Bâton de la tourbière (17, 32 att.) | Bâton de Cœur-de-givre (22, 40 att.) | Bâton des Anciens d'Aldmar (27, 49 att.) |
| **Sceptre** | Sceptre du novice (3, 7 att.) | Sceptre du chaman (8, 13 att.) | Sceptre funéraire (13, 20 att.) | Sceptre du mirage (18, 27 att.) | Sceptre de l'aurore (23, 34 att.) | Sceptre d'onyx d'Aldmar (28, 41 att.) |
| **Arc court** | Arc court (1, 4 att.)<br>Arc du braconnier (4, 8 att.) | Arc des Murmures (7, 13 att.) | Arc d'if du Cimetière (12, 20 att.) | Arc de corne du désert (17, 27 att.) | Arc du trappeur (22, 34 att.) | Arc court écarlate (27, 42 att.) |
| **Arc long** | Arc long du milicien (5, 12 att.) | Arc long (6, 12 att.) | Arc elfique (12, 25 att.) | Arc long des marais (18, 35 att.) | Arc long de Givreval (23, 44 att.) | Arc long d'Aldmar (28, 53 att.) |
| **Arbalète** | Arbalète de garde (4, 13 att.) | Arbalète gobeline (9, 24 att.) | Arbalète d'os (14, 36 att.) | Arbalète de Port-Salin (19, 47 att.) | Arbalète à cric du Nord (24, 58 att.) | Arbalète du Sang versé (29, 69 att.) |
| **Bouclier** | Bouclier de bois cerclé (1, 3 déf.) | Écu du milicien (6, 10 déf.) | Bouclier du Veilleur (11, 16 déf.) | Rondache de bronze (16, 23 déf.) | Pavois givré (21, 29 déf.) | Égide d'Aldmar (26, 36 déf.) |
| **Grimoire** | Carnet de l'apprenti (2, 14 mana) | Grimoire des Murmures (7, 29 mana) | Grimoire des lamentations (12, 44 mana) | Codex de la tourbière (17, 59 mana) | Grimoire gelé (22, 74 mana) | Codex d'Aldmar (27, 89 mana) |
| **Carquois** | Carquois de cuir (1) | Carquois forestier (6) | Carquois d'os (11) | Carquois de chitine (16) | Carquois de fourrure (21) | Carquois écarlate (26) |

Les ids v0.1 `apprentice_staff`, `arcane_staff`, `ember_staff`, `short_bow`, `long_bow`, `elven_bow` sont intégrés
comme bases de leur palier.

### 5.2 Bijoux

Un anneau et une amulette par palier, chacun avec un **implicite** ; les affixes de rareté font le reste. Deux
anneaux se portent en même temps (même base autorisée).

| Palier | Anneau | Amulette |
|---|---|---|
| T1 | Anneau de cuivre (niv. 2 · Vitalité 10) | Amulette de brume (niv. 3 · Endurance 5) |
| T2 | Anneau gobelin (niv. 7 · Précision 2) | Collier de crocs (niv. 8 · Force 4) |
| T3 | Anneau d'os (niv. 12 · Esprit 23) | Reliquaire (niv. 13 · Esprit 25) |
| T4 | Anneau de sable (niv. 17 · Force 6) | Scarabée d'ambre (niv. 18 · Souffle 8) |
| T5 | Anneau de givre (niv. 22 · Résistance au givre 10) | Larme de glace (niv. 23 · Vitalité 59) |
| T6 | Anneau d'Aldmar (niv. 27 · Force 9) | Sceau d'Aldmar (niv. 28 · Souffle 10) |

## 6. Armures

### 6.1 Le poids : des règles souples au lieu des classes

| Type | Défense (4 pièces, niv. 30) | Par pièce portée | Pour qui |
|---|---:|---|---|
| **Plaques** | ≈ 102 | −5 % de régénération d'endurance, −3 % de vitesse d'incantation, +1 d'endurance par **roulade** | on encaisse |
| **Cuir** | ≈ 61 | +3 % de régénération d'endurance, −3 % d'endurance en **sprint** | on esquive |
| **Tissu** | ≈ 36 (+ 130 mana) | +3 % de vitesse d'incantation (et mana sur chaque pièce) | on lance des sorts |

- Les effets se **cumulent pièce par pièce** : 2 pièces de plaques et 2 de tissu, c'est −10 % de régénération
  d'endurance et 0 % d'incantation. La fiche du personnage affiche le total (« Charge : 4 pièces de plaques —
  roulade 34 d'endurance, régénération 28/s »).
- Cela donne du sens aux **Fondamentaux** (Roulade, Sprint, Garde) : un personnage en plaques roule moins souvent
  mais bloque mieux ; en cuir, il roule et sprinte plus longtemps.
- Répartition de la défense : tête 22 %, torse 40 %, mains 18 %, pieds 20 %.
- La **Tunique de cuir** (`leather_tunic`, départ) et la **Robe de mage** (`mage_robe`) restent hors série.

### 6.2 Les 18 séries (3 types × 6 paliers)

Chaque série a 4 pièces : plaques = Heaume, Cuirasse, Gantelets, Solerets ; cuir = Capuche, Veste, Gants, Bottes ;
tissu = Capuchon, Robe, Mitaines, Chausses. Ex. « Cuirasse de la Garde de Brumeval », « Bottes en peau de loup ».
La **Cotte de mailles** (`chainmail`) est le torse de la série de la Milice, l'**Armure du golem** (`golem_plate`)
celui de l'ensemble du Golem ancien.

| Palier | Plaques | Cuir | Tissu |
|---|---|---|---|
| T1 Brumeval (1–5) | **…de la Milice** (niv. 3) — artisanat `crafting:militia`<br>15 déf. (4 pièces)<br><small>artisanat (Forge) · marchand · drop</small> | **…en peau de loup** (niv. 4) — artisanat `crafting:wolf`<br>11 déf. (4 pièces)<br><small>artisanat (Couture, fourrures de loup) · drop</small> | **…du Guetteur des brumes** (niv. 3) — artisanat `crafting:mistwatch`<br>5 déf. (4 pièces) · 22 mana<br><small>artisanat (Couture) · marchand · drop</small> |
| T2 Forêt et camp gobelin (5–10) | **…en ferraille gobeline** (niv. 7) — artisanat `crafting:scrap`<br>27 déf. (4 pièces)<br><small>artisanat (Forge) · drop</small> | **…en cuir de sanglier** (niv. 7) — artisanat `crafting:boar`<br>17 déf. (4 pièces)<br><small>artisanat (Couture) · drop</small> | **…du Chaman** (niv. 9) — ensemble *Parures du Chaman*<br>12 déf. (4 pièces) · 45 mana<br><small>drop (chaman gobelin)</small> |
| T3 Cimetière (10–15) | **…du Golem ancien** (niv. 14) — ensemble *Harnois du Golem ancien*<br>52 déf. (4 pièces)<br><small>boss (Golem) · pièces manquantes par artisanat (cœurs de golem)</small> | **…du Brigand** (niv. 13) — artisanat `crafting:bandit`<br>28 déf. (4 pièces)<br><small>artisanat (Couture) · drop (bandits)</small> | **…de l'Occultiste** (niv. 13) — ensemble *Linceul de l'Occultiste*<br>17 déf. (4 pièces) · 62 mana<br><small>drop (squelette occultiste)</small> |
| T4 Marais et désert (15–20) | **…en chitine du désert** (niv. 17) — artisanat `crafting:chitin`<br>60 déf. (4 pièces)<br><small>artisanat (Forge, chitine de scorpion) · drop</small> | **…du Rôdeur des marais** (niv. 18) — artisanat `crafting:lurker`<br>38 déf. (4 pièces)<br><small>artisanat (Couture) · drop</small> | **…de la Sorcière des marais** (niv. 19) — ensemble *Voiles de la Sorcière*<br>23 déf. (4 pièces) · 85 mana<br><small>boss (Sorcière des marais)</small> |
| T5 Givreval (20–25) | **…du Géant de givre** (niv. 24) — ensemble *Harnois du Géant de givre*<br>83 déf. (4 pièces)<br><small>boss (Géant de givre) · donjon Grotte gelée (v0.4)</small> | **…du Loup de givre** (niv. 23) — artisanat `crafting:icewolf`<br>49 déf. (4 pièces)<br><small>artisanat (Couture, fourrures de givre) · drop</small> | **…en toison de yéti** (niv. 24) — artisanat `crafting:fleece`<br>29 déf. (4 pièces) · 105 mana<br><small>artisanat (Couture, toison de yéti) · drop</small> |
| T6 Aldmar et zones rouges (25–30) | **…du Sang versé** (niv. 28) — ensemble *Harnois du Sang versé*<br>95 déf. (4 pièces)<br><small>zones rouges (Marques écarlates, élites)</small> | **…du Traqueur écarlate** (niv. 27) — ensemble *Cuir du Traqueur écarlate*<br>55 déf. (4 pièces)<br><small>zones rouges (Marques écarlates, élites)</small> | **…du Roi-Liche** (niv. 29) — ensemble *Robe du Roi-Liche*<br>35 déf. (4 pièces) · 126 mana<br><small>boss (Liche) · donjon Crypte d'Aldmar (v0.4)</small> |

### 6.3 Les 8 ensembles de butin (bonus à 2 et 4 pièces)

Deux familles de séries, pour ne pas tout mélanger :

- **Séries d'artisanat** (10 cases du tableau ci-dessus, plus 8 autres séries fabriquées décrites dans
  `crafting.json` : os ancien, soie tisse-venin, spectrale, tourbière, givre, runique d'Aldmar, troll, arcaniste) :
  mêmes ids de pièces (`wolf_helm`, `wolf_chest`, `wolf_gloves`, `wolf_boots`…). Leurs bonus d'ensemble et leur
  qualité (Normale → Inhabituel, Supérieure → Rare, Chef-d'œuvre → Épique) sont définis par le brouillon d'artisanat ;
  ce catalogue fournit seulement la formule de défense / mana et les fait aussi **tomber** des monstres de leur
  palier, avec une rareté aléatoire, sans bonus d'ensemble (seules les pièces fabriquées le portent).
- **Ensembles de butin** : ils ne se fabriquent pas (sauf pièces manquantes de boss). Toujours **Épiques**, 3 affixes
  fixes, bonus à 2 et 4 pièces :

| Ensemble | Type | Palier | Source | Rareté · affixes fixes | 2 pièces | 4 pièces |
|---|---|---|---|---|---|---|
| **Parures du Chaman** `shaman_set` | Tissu | T2 (niv. 9) | drop | Épique · Esprit, Braise, Incantation | +10 % de mana max. | Braises sacrées : vos sorts de feu ont 15 % de chances de ne rien coûter. |
| **Harnois du Golem ancien** `golem_set` | Plaques | T3 (niv. 14) | boss | Épique · Vitalité, Garde, Équilibre | +15 % de dégâts de déséquilibre. | Peau de pierre : la Garde coûte 30 % d’endurance en moins et protège aussi des coups par l’arrière. |
| **Linceul de l'Occultiste** `occultist_set` | Tissu | T3 (niv. 13) | drop | Épique · Esprit, Incantation, Résistance arcanique | +8 % de vitesse d’incantation. | Moisson d’âmes : chaque ennemi tué rend 5 % de votre mana. |
| **Voiles de la Sorcière** `hag_set` | Tissu | T4 (niv. 19) | boss | Épique · Esprit, Arcane, Résistance au poison | +10 % de résistance aux arcanes. | Maléfice : vos sorts affaiblissent la cible (−10 % de dégâts infligés pendant 5 s). |
| **Harnois du Géant de givre** `frost_giant_set` | Plaques | T5 (niv. 24) | boss | Épique · Vitalité, Garde, Résistance au givre | +10 % de PV max. | Parade glaciale : une parade parfaite libère une onde de givre (4 m, ralentit de 40 % pendant 2 s). |
| **Harnois du Sang versé** `bloodshed_set` | Plaques | T6 (niv. 28) | redzone | Épique · Vitalité, Force, Vol de vie | +3 % de vol de vie. | Rage du sang : sous 30 % de PV, +20 % de dégâts et +30 % de régénération d’endurance. |
| **Cuir du Traqueur écarlate** `scarlet_set` | Cuir | T6 (niv. 27) | redzone | Épique · Précision, Souffle, Célérité | Roulade : −15 % d’endurance. | Contre mortel : après une esquive parfaite, votre prochain coup (dans les 2 s) est un critique assuré. |
| **Robe du Roi-Liche** `lich_set` | Tissu | T6 (niv. 29) | boss | Épique · Esprit, Incantation, Résistance au givre | +15 % de mana max. | Phylactère : une fois toutes les 120 s, un coup mortel vous laisse à 1 PV avec 2 s d’invulnérabilité. |

- Les bonus sont écrits en entier dans l'infobulle, avec les pièces portées cochées (« 3/4 »).
- Les pièces de boss tombent une par une (35 % par victoire, pièce au hasard parmi les 4). Les pièces manquantes
  s'obtiennent aussi par artisanat avec le matériau unique du boss (Cœur de golem, Cœur de givre du Géant, Éclat de
  phylactère) : pas de malchance infinie.
- Les ensembles de **zone rouge** s'achètent avec des **Marques écarlates** (lâchées par tous les élites des zones
  rouges, 1 par élite et 5 par Champion écarlate) : 20 marques par pièce. Elles tombent dans le sac de butin à la
  mort, comme le reste du sac.

## 7. Légendaires : les objets uniques de boss

Chaque boss a **une épée légendaire** (plus un second légendaire pour 4 d'entre eux). Nom, affixes (haut de la
fourchette) et effet toujours identiques. **Chance affichée** dans le journal de boss, avec protection contre la
malchance : **+3 % par victoire sans légendaire** sur ce boss, remise à zéro quand il tombe.

| Légendaire | Famille | Niv. | Boss | Chance | Stats | Effet |
|---|---|---:|---|---:|---|---|
| **Fendroc, lame du Golem** `fendroc` | Espadon | 14 | golem | 12 % | 44 att. · Force 6, Vitalité 42, Équilibre 15 | Les attaques chargées libèrent une onde de choc au sol (rayon 3 m, 60 % des dégâts, déséquilibre ×2). |
| **Épine de la Sorcière** `hag_thorn` | Rapière | 19 | swamp_hag | 12 % | 34 att. · Précision 4, Vitesse d'attaque 6, Résistance au poison 10 | Les coups critiques empoisonnent : 40 % des dégâts du coup en 4 s, cumulable 3 fois. |
| **Croc du Ver des sables** `wyrm_fang` | Cimeterre | 20 | sand_wyrm | 12 % | 38 att. · Force 8, Souffle 9, Braise 9 | Après une esquive parfaite (roulade à travers une attaque), le prochain coup inflige +60 % de dégâts et rend 15 d’endurance. |
| **Brise-Montagne** `mountain_breaker` | Épée bâtarde | 24 | frost_giant | 12 % | 57 att. · Garde 8, Vitalité 68, Givre 10 | Parade parfaite (Garde au dernier instant) : renvoie 100 % des dégâts parés et fait tituber l’attaquant. |
| **Lame runique d'Aldmar** `aldmar_runeblade` | Épée runique | 29 | lich | 12 % | 59 att. · Force 11, Esprit 54, Givre 13 | Les coups critiques gèlent la cible 1 s (boss et joueurs : ralentis de 40 % pendant 2 s). 8 s de recharge par cible. |
| **Soif-de-Sang** `thirst` | Lame courbe | 30 | scarlet_champion | 10 % | 67 att. · Force 11, Précision 5, Vol de vie 4 | Vol de vie doublé ; chaque ennemi tué rend 8 % des PV et 20 d’endurance. En zone rouge seulement : +10 % de dégâts. |
| **Rempart du Golem** `golem_rampart` | Bouclier | 14 | golem | 10 % | 24 déf. · Garde 6, Vitalité 42, Équilibre 15 | Blocage 100 % ; bloquer un coup lourd (télégraphié) ne coûte pas d’endurance une fois toutes les 10 s. |
| **Grimoire de la Vase** `hag_grimoire` | Grimoire | 19 | swamp_hag | 10 % | 6 att. · Esprit 38, Incantation 6, Arcane 9 | Vos sorts de zone laissent une flaque de vase 4 s (ralentit de 30 %, dégâts arcaniques par seconde). |
| **Carreau-d'Hiver** `winter_bolt` | Arbalète | 24 | frost_giant | 10 % | 70 att. · Précision 4, Givre 10, Équilibre 19 | Chaque 3ᵉ carreau traverse les ennemis et les ralentit de 30 % pendant 2 s. |
| **Bâton du Roi-Liche** `lich_staff` | Bâton | 29 | lich | 10 % | 62 att. · Esprit 54, Incantation 8, Arcane 13 | Tuer un ennemi avec un sort relève un feu follet allié 10 s (attaque les ennemis proches, 30 % de votre attaque). |

- « Lame runique d'Aldmar » reprend l'exemple de la feuille de route (les critiques gèlent).
- Les effets des boss et des joueurs sont atténués contre les **boss** (ralentissement au lieu de gel) et en **JcJ**
  (durées ÷ 2), et c'est écrit dans l'infobulle.
- **Champion écarlate** : boss proposé pour les zones rouges (voir questions ouvertes) ; sinon Soif-de-Sang passe
  sur la Liche.

## 8. Affixes

Valeur = interpolation linéaire entre le niveau d'objet 1 et 30, tirée uniformément entre le minimum et le maximum.
Les pourcentages sont plafonnés côté serveur : critique total 50 %, vitesse d'attaque +30 %, vol de vie 10 %,
résistance 60 % par élément, vitesse de déplacement +15 %.

| Affixe | Effet | Niv. 1 | Niv. 15 | Niv. 30 | Emplacements |
|---|---|---:|---:|---:|---|
| **Force** `force` | +X attaque | 1–2 | 4–7 | 8–12 | weapon, offhand, hands, ring, amulet |
| **Garde** `garde` | +X défense | 1–2 | 4–6 | 7–11 | offhand, head, chest, hands, feet, ring |
| **Vitalité** `vitalite` | +X PV | 6–10 | 32–49 | 60–90 | offhand, head, chest, hands, feet, ring, amulet |
| **Esprit** `esprit` | +X mana | 5–8 | 22–33 | 40–60 | weapon:focalisateur, offhand, head, chest, hands, feet, ring, amulet |
| **Endurance** `endurance` | +X endurance max | 3–5 | 6–10 | 10–15 | head, chest, hands, feet, amulet |
| **Souffle** `souffle` | +X % régénération d’endurance | 3–5 | 5–8 | 8–12 | chest, feet, ring, amulet |
| **Précision** `precision` | +X % de chances de critique | 1–2 | 2–3 | 3–5 | weapon, hands, ring, amulet, offhand:carquois |
| **Vitesse d'attaque** `vitesse_attaque` | +X % de vitesse d’attaque | 2–3 | 4–5 | 6–8 | weapon, hands |
| **Incantation** `incantation` | +X % de vitesse d’incantation | 2–3 | 4–5 | 6–8 | weapon:focalisateur, head, offhand:grimoire, amulet |
| **Vol de vie** `vol_de_vie` | X % des dégâts infligés rendus en PV | 1–1 | 1–2 | 2–4 | weapon, ring, amulet |
| **Équilibre** `equilibre` | +X % de dégâts de déséquilibre | 5–8 | 10–16 | 15–25 | weapon, hands, offhand:bouclier |
| **Braise** `feu` | +X dégâts de feu par coup | 1–3 | 4–8 | 8–14 | weapon, ring |
| **Givre** `givre` | +X dégâts de givre par coup | 1–3 | 4–8 | 8–14 | weapon, ring |
| **Arcane** `arcane` | +X dégâts arcaniques par coup | 1–3 | 4–8 | 8–14 | weapon, ring |
| **Résistance au feu** `res_feu` | +X % de résistance au feu | 3–5 | 6–10 | 10–15 | offhand, head, chest, hands, feet, ring, amulet |
| **Résistance au givre** `res_givre` | +X % de résistance au givre | 3–5 | 6–10 | 10–15 | offhand, head, chest, hands, feet, ring, amulet |
| **Résistance arcanique** `res_arcane` | +X % de résistance aux arcanes | 3–5 | 6–10 | 10–15 | offhand, head, chest, hands, feet, ring, amulet |
| **Résistance au poison** `res_poison` | +X % de résistance au poison | 3–5 | 6–10 | 10–15 | offhand, head, chest, hands, feet, ring, amulet |
| **Célérité** `celerite` | +X % de vitesse de déplacement | 2–3 | 3–5 | 5–7 | feet |

- `weapon:focalisateur` = uniquement sur bâton, sceptre, épée runique ; `offhand:grimoire` / `offhand:carquois` /
  `offhand:bouclier` = seulement sur cette main gauche.
- Noms dans l'infobulle : l'affixe est affiché tel quel (« +7 attaque — Force »), sans préfixes/suffixes générés,
  pour rester lisible.
- Les dégâts élémentaires s'ajoutent à chaque coup (compétences comprises, une fois par cible) et passent par la
  défense puis par la résistance de la cible. Les monstres ont des résistances par type (squelettes : givre 30 %,
  gluants : poison 50 %, yétis : givre 50 %, liche : arcane 30 %) — à ajouter dans `MONSTERS`.

## 9. Butin : qui lâche quoi

### 9.1 Équipement

| | Monstre normal | Élite (5 %, v0.2) | Boss | Zone rouge |
|---|---|---|---|---|
| Chance d'équipement | 6 % | 30 % | 2 objets garantis (+1 par tranche de 3 joueurs en plus) | ×2 |
| Commun / Inhabituel / Rare / Épique | 70 / 22 / 7 / 1 | 40 / 38 / 17 / 5 | 0 / 30 / 45 / 25 | 45 / 33 / 17 / 5 (élites : 20 / 35 / 30 / 15) |

- **Emplacement** : arme 26, main gauche 8, tête 12, torse 12, mains 11, pieds 11, anneau 12, amulette 8.
- **Butin intelligent** (affiché dans le Codex) : 40 % des objets correspondent à la famille d'arme ou au type
  d'armure que porte celui qui ramasse. On trouve plus souvent ce qu'on utilise, sans jamais en être prisonnier.
- **Groupe** : chaque objet est attribué selon le mode de butin du groupe (v0.3) ; le butin intelligent vise celui
  qui le reçoit.
- Les potions v0.1 restent sur les gluants, loups, gobelins et squelettes aux mêmes taux.

### 9.2 Par monstre (matériaux, pierres, ensembles, légendaires)

| Monstre | Palier | Matériaux | Pierres de forge | Pièces d’ensemble / légendaires |
|---|---|---|---|---|
| `slime` | T1 | Gelée de gluant 50 % | brute 3 % | — |
| `wolf` | T1 | Fourrure de loup 45 % | brute 3 % | — |
| `goblin` | T2 | Babiole gobeline 40 % | brute 5 % | — |
| `goblin_shaman` | T2 | Plume de totem 40 %, Babiole gobeline 20 % | brute 5 % | Parures du Chaman 3 % |
| `boar` | T2 | Cuir de sanglier 50 %, Défense de sanglier 20 % | brute 5 % | — |
| `spider` | T2 | Soie d'araignée 45 %, Glande à venin 15 % | brute 5 % | — |
| `skeleton` | T3 | Os ancien 45 % | brute 5 %, taillée 1.5 % | occultiste : Linceul 4 % |
| `skeleton_archer` | T3 | Os ancien 40 % | brute 5 %, taillée 1.5 % | — |
| `wraith` | T3 | Voile spectral 35 % | brute 5 %, taillée 1.5 % | — |
| `golem` **(boss)** | T3 | Cœur de golem 100 % | taillée 100 %, ancestrale 20 % | Harnois du Golem ancien 35 %, Fendroc, lame du Golem 12 %, Rempart du Golem 10 % |
| `bog_lurker` | T4 | Mousse des tourbières 40 % | brute 4 %, taillée 3 % | — |
| `scorpion` | T4 | Chitine de scorpion 45 %, Dard de scorpion 15 % | brute 4 %, taillée 3 % | — |
| `bandit` | T4 | Étoffe de brigand 35 % | brute 4 %, taillée 3 % | — |
| `swamp_hag` **(boss)** | T4 | Mousse des tourbières 100 % | taillée 100 %, ancestrale 20 % | Voiles de la Sorcière 35 %, Épine de la Sorcière 12 %, Grimoire de la Vase 10 % |
| `sand_wyrm` **(boss)** | T4 | Écaille de ver des sables 100 % | taillée 100 %, ancestrale 20 % | Croc du Ver des sables 12 % |
| `ice_wolf` | T5 | Fourrure de givre 45 % | taillée 4 %, ancestrale 0.8 % | — |
| `yeti` | T5 | Toison de yéti 45 % | taillée 4 %, ancestrale 0.8 % | — |
| `troll` | T5 | Sang de troll 35 % | taillée 4 %, ancestrale 0.8 % | — |
| `frost_giant` **(boss)** | T5 | Cœur de givre éternel 100 % | taillée 100 %, ancestrale 50 % | Harnois du Géant de givre 35 %, Brise-Montagne 12 %, Carreau-d'Hiver 10 % |
| `lich` **(boss)** | T6 | Éclat de phylactère 100 % | taillée 100 %, ancestrale 50 % | Robe du Roi-Liche 35 %, Lame runique d'Aldmar 12 %, Bâton du Roi-Liche 10 % |
| `scarlet_champion` **(boss)** | T6 | Marque écarlate 100 % | taillée 100 %, ancestrale 50 % | Soif-de-Sang 10 % |

Les matériaux nouveaux (`boar_hide`, `spider_silk`, `scorpion_chitin`, `yeti_fur`, `scarlet_mark`…) sont proposés
ici ; leurs recettes sont du ressort du brouillon d'artisanat. Élites : chances de matériaux ×2 (`ELITE.drops`).

## 10. Forge, Retremper, Recyclage

### 10.1 Amélioration +1 à +10

Chez le forgeron (`npc_blacksmith`) ou à une station Forge. Chaque niveau donne **+4 % à la stat de base** (attaque,
défense, mana du grimoire et du tissu) ; les affixes ne changent pas. Le nom affiche le niveau : « Épée d'acier +3 ».

| Niveau | Pierres | Or (× niv. objet) | Réussite | Bonus de base |
|---:|---|---:|---:|---:|
| +1 | 1 × Pierre de forge brute | 5 | 100 % | +4 % |
| +2 | 1 × Pierre de forge brute | 8 | 100 % | +8 % |
| +3 | 2 × Pierre de forge brute | 12 | 100 % | +12 % |
| +4 | 2 × Pierre de forge brute | 16 | 100 % | +16 % |
| +5 | 2 × Pierre de forge taillée | 20 | 100 % | +20 % |
| +6 | 3 × Pierre de forge taillée | 26 | 90 % | +24 % |
| +7 | 3 × Pierre de forge taillée | 32 | 80 % | +28 % |
| +8 | 3 × Pierre de forge ancestrale | 40 | 70 % | +32 % |
| +9 | 4 × Pierre de forge ancestrale | 50 | 60 % | +36 % |
| +10 | 5 × Pierre de forge ancestrale | 60 | 50 % | +40 % |

- **Or** = colonne « Or » × niveau requis de l'objet (ex. +10 sur une épée niv. 30 : 1 800 pièces d'or).
- **Échec** : pierres et or consommés, l'objet reste **intact** (jamais détruit, jamais rétrogradé). Chaque échec
  ajoute +10 % de réussite à la tentative suivante sur ce même objet, affiché dans la fenêtre de forge.
- **Pierres** : brute (T1–T3, 3 à 5 % par monstre), taillée (à partir de T3, bosses), ancestrale (T5–T6, élites,
  bosses, zones rouges) ; aussi par recyclage et contre des Insignes de bandit.
- Un objet +10 vaut à peu près un palier de plus (+40 % contre +25 à +60 % de stat de base d'un palier à
  l'autre) : forger son objet préféré permet de le garder un palier de plus, mais pas de sauter toute la progression.

### 10.2 Retremper

Remplace **un affixe choisi** par un nouvel affixe aléatoire. Coût : 1 essence de la rareté de l'objet + 10 or × niveau.
Impossible sur les légendaires et les pièces d'ensemble (affixes fixes).

### 10.3 Recyclage

| Rareté | Matériau de base | Essence | Chance de pierre de forge |
|---|---|---|---:|
| Commun | 1–2 | — | 5 % |
| Inhabituel | 2–3 | Essence verdoyante | 10 % |
| Rare | 3–4 | Essence azurée | 20 % |
| Épique | 4–5 | Essence violine | 40 % |

- Matériau selon l'objet : **Ferraille** (armes de métal, boucliers, plaques, bijoux), **Chutes de cuir** (cuir,
  arcs, carquois), **Chutes d'étoffe** (tissu, grimoires), **Copeaux de bois précieux** (bâtons, sceptres).
  +1 à partir de T4.
- Un objet forgé rend 50 % des pierres dépensées. Les pièces d'ensemble rendent 1 essence violine + leur matériau
  d'artisanat. Les légendaires **ne se recyclent pas**.

## 11. Or et prix

- **Vente** = (5 + 0,6 × niveau²) × multiplicateur de rareté (1 / 2 / 4 / 8 / 20). Ex. Rare niv. 20 : 980 or ;
  Épique niv. 30 : 4 360 or.
- **Achat chez le marchand** = 4 × vente, **Commun seulement** : Brumeval vend T1–T2, Port-Salin T4 (les autres
  paliers se trouvent en jeu, s'achètent aux étals ou se fabriquent). Les prix v0.1 des objets existants restent
  identiques.
- Coût de la forge et de Retremper : voir §10. Taxe des étals : 5 % (ROADMAP).

## 12. Courbe de progression (pour répondre à « il n'y a rien de mieux »)

| Niveau | Ce qui s'améliore |
|---|---|
| 1–5 | 6 épées T1, séries T1, premier ensemble d'artisanat (loup) avec les fourrures de loup |
| 5–10 | changement de palier ; ensemble du Chaman ; premières pierres de forge ; Retremper |
| 10–15 | Golem : Fendroc, Rempart, ensemble du Golem ; épées runiques et lames courbes |
| 15–25 | 2 régions par palier, 3 boss et 5 légendaires, séries de chitine, de loup de givre et de toison de yéti |
| 25–30 | zones rouges : meilleurs taux, Marques écarlates, ensembles du Sang versé et du Traqueur, Liche |
| 30 | chasse aux Épiques bien tirés, aux 10 légendaires, forge +10, Retremper ; donjons v0.4 |

Stat de base : +25 à +60 % d'un palier au suivant (plus aux bas niveaux). Avec la rareté (+15 % en Épique), 3 affixes et la forge
(+40 %), un joueur a toujours une amélioration en vue.

## 13. Migration v0.1 → v0.3 (le jeu est en ligne)

- **Tous les ids v0.1 restent valides** : 13 équipements et tous les consommables / matériaux (`bases[*].legacy`).
- Un objet stocké comme simple id devient une instance `{ id, uid, r, il, a, f }` avec sa rareté v0.1
  (`legacyRarity`), son niveau comme niveau d'objet, des **affixes fixes** (`legacyAffixes`) qui reproduisent
  l'avantage qu'il avait (ex. `runeblade` épique : Force 5, Esprit 12, Arcane 4) et forge 0. Les stats de base
  v0.1 sont gardées quand elles dépassent la formule (Cotte de mailles 10 déf., Armure du golem 22 déf. + 60 PV) :
  **personne ne perd de puissance** à la mise à jour.
- `equipped.armor` → `equipped.chest` ; les nouveaux emplacements sont vides.
- Le champ `cls` disparaît ; `canUse(item, level)` ne vérifie plus que le niveau. Les objets v0.1 réservés (Robe de
  mage, Cotte de mailles…) deviennent portables par tous.
- Quête « Le Golem ancien » : `classItem` reste valide ; la récompense devient **au choix** entre les trois armes.
- Le marchand garde sa liste v0.1 et ajoute les Communs T1–T2.

## 14. Interface (à transmettre à l'agent interface)

- **Infobulle** : nom en couleur de rareté (+ niveau de forge), type (« Épée longue · une main »), niveau requis
  (rouge si trop haut), stat de base, implicite, affixes, effet de famille, effet légendaire / bonus d'ensemble,
  puis le **bloc de comparaison** automatique (différences en vert / rouge, DPS de l'attaque de base, variation des
  PV, de la défense, de l'endurance, des résistances).
- **Fiche du personnage** : poupée à 9 emplacements, total de charge d'armure, étiquettes d'arme actives.
- **Icônes** : une par base (`icon` = id) ; les 17 icônes v0.1 existent déjà. Bordure de la case à la couleur de
  la rareté, halo orange pour les légendaires. Les modèles 3D d'armes : un par famille et par palier suffisent
  (18 × 6), plus un modèle unique par légendaire (`model`).

## 15. Questions ouvertes pour la synthèse

1. **Formule de dégâts au niveau 30** : avec 4 pièces de plaques (≈ 102 déf.) + la défense de base (≈ 39), la
   constante `60` de `computeDamage` réduit les dégâts de 70 %. Proposition : `60 + 6 × niveau de l'attaquant`,
   à valider par `tests/balance/sim.mjs`.
2. **Champion écarlate** (boss de zone rouge pour Soif-de-Sang) : nouveau monstre à créer (modèle `bandit` agrandi) ou
   légendaire déplacé sur la Liche ?
3. **Alignement avec `crafting.json`** : ids de matériaux et de séries déjà repris (`wolf`, `boar`, `chitin`,
   `frost_pelt`, `frost_heart`, `phylactery_shard`…). Restent à trancher : (a) la formule de stats des pièces
   fabriquées (celle de ce catalogue, `meta.formulas`, est proposée comme référence unique) ; (b) le brouillon
   d'artisanat met la Milice en T1 et des bandits en T3, ce catalogue met la Cotte de mailles v0.1 (niv. 6) comme
   torse de la série de ferraille gobeline (T2) et les bandits en T4 ; (c) `scarlet_mark` et les essences /
   chutes de recyclage sont nouveaux ici ; (d) les armes fabriquées de `crafting.json` (`longsword_iron`,
   `greatsword_chitin`…) s'ajoutent aux 36 épées de butin : les classer dans les familles de §4.
4. **Monstres des régions v0.3** : les paliers de `dropTables.monsters` supposent sanglier / araignée / chaman en T2,
   squelette archer / spectre en T3, etc. — à confirmer avec le brouillon du monde.
5. **Modèles d'armes** : 18 familles × 6 paliers = 108 modèles serait trop ; proposition : un modèle par famille et
   par palier pour les épées (8 × 6 = 48, la demande des joueurs) et un modèle par famille teinté par palier pour
   le reste.
6. **Ensembles de donjon** : les donjons arrivent en v0.4 ; en v0.3 les ensembles du Géant de givre et du
   Roi-Liche ne viennent que des boss et de l'artisanat.
