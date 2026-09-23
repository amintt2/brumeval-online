# Objets et artisanat — butin v2, épées, forge, métiers (v0.3)

> ⚠️ **Décisions du 23/09 prioritaires** : voir [`DECISIONS.md`](DECISIONS.md) (pas de roulade au niveau 1, marché intelligent à prix libres, **pas de réinitialisation : Renaissance au niveau 30**).


> **Document final de conception** (synthèse de `docs/design/drafts/items.*` et `crafting.*`, gardés en annexe).
> Données : `docs/design/items.json` (familles, bases, légendaires, consommables, ensembles, séries, affixes, raretés,
> tables de butin, forge, recyclage) et `docs/design/crafting.json` (matériaux, récolte, métiers, recettes, ensembles
> fabriqués, plans, règles). Générés par `node docs/design/tools/build_items.mjs`, vérifiés par `validate.mjs`.
> Répond aux retours : « on s'équipe vite et il n'y a rien de mieux », « beaucoup plus d'épées », « l'équipement du
> loup avec le butin du loup, le gluant pour les potions », « plus de mécaniques », « simple et accessible ».

## 1. En bref

- **293 objets de base** (dont 129 armes et **61 épées** de 8 familles), **10 légendaires**
  (dont 6 épées), **25 consommables**, **26 séries d'armure** (18 fabriquées avec bonus
  d'ensemble, 8 ensembles de butin), **19 affixes**, **5 raretés**, **6 paliers** jusqu'au niveau 30.
- **Plus aucune restriction de classe** : seul le niveau requis compte. L'arme donne des **étiquettes** qui débloquent les
  compétences de l'Arbre des Brumes ; l'armure a un **poids** (plaques, cuir, tissu).
- **Artisanat** : 56 matériaux (chaque monstre en lâche 1 à 3), 7 points de récolte, 3 métiers (Forge,
  Alchimie, Couture et tannerie) de 1 à 30, **194 recettes**, 18 plans d'ensemble, qualité aléatoire (Normale,
  Supérieure, Chef-d'œuvre) avec une **affixe signature** garantie. Les objets fabriqués utilisent **les mêmes formules**
  que le butin ; les légendaires ne se fabriquent jamais.
- **Forge +1 à +10** (jamais de destruction), **Retremper** un affixe, **Recyclage** en matériaux.
- **Tous les ids v0.1 restent valides** (13 équipements, 3 potions, 5 objets « junk » devenus matériaux).

## 2. Principes : simple et accessible

1. La couleur dit tout : blanc < vert < bleu < violet < orange.
2. L'infobulle compare toute seule avec l'objet porté, avec une ligne « DPS de l'attaque de base : 38 → 44 (+16 %) »
   qui rend honnête la comparaison entre une rapière rapide et un espadon lent.
3. Aucune règle cachée : effets d'arme, poids d'armure, bonus d'ensemble, chances de légendaire et compteur de
   malchance sont affichés.
4. Tout l'aléatoire (rareté, base, affixes, qualité, forge) est tiré par le serveur.
5. Rien ne se perd bêtement : la forge ne détruit jamais, un légendaire ne se recycle pas, la fabrication n'échoue jamais.

## 3. Raretés, paliers, formules

| Rareté | Couleur | Affixes | Stat de base | Vente |
|---|---|---|---|---|
| Commun | `#e8e8e8` | 0 | ×1 | ×1 |
| Inhabituel | `#3fd46a` | 1 | ×1,05 | ×2 |
| Rare | `#3f8cff` | 2 | ×1,1 | ×4 |
| Épique | `#b85cff` | 3 | ×1,15 | ×8 |
| Légendaire | `#ff9f1a` | 3 fixes | ×1,2 | ×20 |

| Palier | Nom | Niveaux | Régions | Allure |
|---|---|---|---|---|
| **T1** | Brumeval | 1–5 | village, plains_e, plains_sw, forest (lisière) | fer rouillé, bois clair, lin brut |
| **T2** | Forêt et camp gobelin | 5–10 | forest, goblins | acier sombre, cuir tanné, plumes, os gravés gobelins |
| **T3** | Cimetière | 10–15 | graveyard, lair | os, fer noirci, suaires, runes pâles |
| **T4** | Marais et désert | 15–20 | Marais de Brumenoire, Désert de Sable-Rouge, Côte de Port-Salin | bronze, chitine, cuir huilé, vase verdâtre |
| **T5** | Givreval | 20–25 | Pics de Givreval, Grotte gelée (donjon v0.4) | acier bleu, fourrure blanche, givre cristallin |
| **T6** | Aldmar et zones rouges | 25–30 | Ruines d'Aldmar, zones rouges, Crypte d'Aldmar (donjon v0.4) | or terni, runes ardentes, pourpre et noir |

Formules (`items.json › meta.formulas`) :
- `weaponAtk` : round((3 + 1.6 × lvl) × family.atk × rarity.baseMult × (1 + 0.04 × forge))
- `armorDef` : round((6 + 3.2 × lvl) × type.def × share[slot] × rarity.baseMult × (1 + 0.04 × forge)) ; share tête 0.22 / torse 0.40 / mains 0.18 / pieds 0.20
- `clothMana` : round((10 + 4 × lvl) × share[slot])
- `focusMana` : round((4 + 2 × lvl) × family.mp)
- `shield` : def = round(2 + 1.3 × lvl) ; blocage = min(90, 60 + lvl) %
- `affixValue` : interpolation linéaire entre range[1] et range[30] selon le niveau d’objet, tirage uniforme dans [min, max]
- `sell` : round((5 + 0.6 × lvl²) × rarity.sellMult) ; prix d’achat marchand = 4 × vente (Commun seulement) ; objets fabriqués : valeur des matériaux (crafting.json › rules.craftedSell)
- `baseAttackDps` : infobulle : attaque × puissance de l’attaque de base ÷ (recharge × family.cd) — pour comparer honnêtement une rapière et un espadon
- Dégâts : dégâts = atk × puissance × (0,85..1,15) × crit × K / (K + déf), K = 60 + 6 × max(0, niveau de l’attaquant − 10) (proposition v0.3 : les armures T5–T6 ne rendent pas invulnérable).

## 4. Armes : familles et étiquettes

| Famille | Mains | Attaque | Vitesse | Critique | Déséquilibre | Endurance | Étiquettes | Particularité | Bases |
|---|---|---|---|---|---|---|---|---|---|
| **Épée courte** `epee_courte` | 1 | ×0,85 | ×0,85 | +3 % | ×0,8 | ×0,8 | melee, lame | Rapide et économe, idéale avec un bouclier. | 5 |
| **Épée longue** `epee_longue` | 1 | ×1 | ×1 | — | ×1 | ×1 | melee, lame | La référence : aucun point faible, aucun point fort. | 11 |
| **Épée bâtarde** `epee_batarde` | 1 | ×1,15 | ×1,12 | — | ×1,25 | ×1,15 | melee, lame, lourde | Une main et demie : plus lourde, plus d’allonge, déséquilibre mieux. | 8 |
| **Rapière** `rapiere` | 1 | ×0,85 | ×0,85 | +8 % | ×0,6 | ×0,85 | melee, lame, estoc | Estoc : ignore 15 % de la défense de la cible. | 9 |
| **Cimeterre** `cimeterre` | 1 | ×0,9 | ×0,9 | +4 % | ×0,8 | ×0,9 | melee, lame, taille | Taille large : l’attaque de base touche jusqu’à 2 ennemis devant soi. | 5 |
| **Lame courbe** `lame_courbe` | 2 | ×1,1 | ×1 | +5 % | ×0,9 | ×1,05 | melee, lame, deux_mains, taille | +25 % de dégâts critiques. | 6 |
| **Espadon** `espadon` | 2 | ×1,45 | ×1,35 | — | ×1,8 | ×1,5 | melee, lame, deux_mains, lourde | Balayage : l’attaque de base touche tous les ennemis dans un arc de 120°. | 12 |
| **Épée runique** `epee_runique` | 1 | ×1 | ×1,05 | — | ×1 | ×1 | melee, lame, focalisateur_partiel | 25 % des dégâts de mêlée sont arcaniques ; les sorts lancés avec elle ne subissent que −10 % (au lieu de −20 %). | 5 |
| **Hache** `hache` | 1 | ×1,1 | ×1,1 | +2 % | ×1,3 | ×1,1 | melee, hache | Brise-garde : +50 % de dégâts contre une cible qui se protège (squelettes, boucliers, joueurs en Garde). | 6 |
| **Masse** `masse` | 1 | ×1,05 | ×1,15 | — | ×1,6 | ×1,15 | melee, masse, lourde | Écrasement : +20 % de dégâts contre les squelettes, golems et créatures à carapace. | 6 |
| **Lance** `lance` | 1 | ×1 | ×1,05 | +2 % | ×1 | ×1 | melee, lance, estoc | Allonge : frappe en ligne droite, touche 2 ennemis alignés. | 6 |
| **Dague** `dague` | 1 | ×0,7 | ×0,7 | +12 % | ×0,5 | ×0,7 | melee, dague, estoc | Dans le dos : ×1,5 dégâts sur une cible qui ne vous fait pas face. | 6 |
| **Bâton** `baton` | 2 | ×1,05 | ×1 | — | ×0,7 | ×1 | focalisateur, melee, deux_mains, baton | Sorts à pleine puissance ; peut aussi frapper au corps à corps (faible impact). | 13 |
| **Sceptre** `sceptre` | 1 | ×0,85 | ×0,9 | +2 % | ×0,8 | ×0,9 | focalisateur, melee, sceptre | Sorts à pleine puissance ; −10 % de temps de recharge des sorts. | 6 |
| **Arc court** `arc_court` | 2 | ×0,9 | ×0,85 | +3 % | ×0,8 | ×0,9 | distance, arc | Tir en mouvement jusqu’à 55 % de sa vitesse (au lieu de 40 %). | 9 |
| **Arc long** `arc_long` | 2 | ×1,1 | ×1,1 | +4 % | ×1 | ×1 | distance, arc | Portée maximale et précision, à l’arrêt. | 10 |
| **Arbalète** `arbalete` | 2 | ×1,4 | ×1,5 | +2 % | ×1,6 | ×1,2 | distance, arbalete, lourde | Carreau : ignore 20 % de la défense de la cible. | 6 |
| **Bouclier** `bouclier` | — | — | — | — | — | — | bouclier | En Garde : bloque « blocage » % des dégâts frontaux (sans bouclier : 50 %) ; coûte de l’endurance par coup bloqué. | 12 |
| **Grimoire** `grimoire` | — | — | — | — | — | — | focalisateur_secondaire, grimoire | Compte comme focalisateur : avec une arme de mêlée à une main, les sorts ne subissent que −10 %. | 13 |
| **Carquois** `carquois` | — | — | — | — | — | — | carquois | Bonus de critique et de dégâts pour les tirs. | 11 |

- **Exigences des compétences** (règle commune avec l'arbre) : les compétences « melee » de l'arbre demandent une arme portant l'étiquette melee sans l'étiquette focalisateur (le bâton et le sceptre ne suffisent pas, sauf clé de voûte Érudit martial) ; les compétences « dague » du Rôdeur utilisent le couteau de ceinture : toujours disponibles avec une arme « distance » (dégâts de l'arme ×0,8) ou une arme de mêlée à une main ;
  sort lancé sans focalisateur : −20 % de puissance ; avec une épée runique (focalisateur_partiel) ou un grimoire en main gauche : −10 % ; bâton ou sceptre : pleine puissance (règle commune avec l'Arbre des Brumes).
- Une arme à deux mains interdit bouclier et grimoire ; arcs et arbalètes n'acceptent que le carquois.
- La Garde (Fondamental) utilise la valeur de **blocage** du bouclier (61 à 90 %) ; sans bouclier, 50 % avec une arme
  de mêlée, 30 % sinon.

### 4.1 Les épées (61 bases + 6 légendaires)

Répartition : Épée courte 5, Épée longue 11, Épée bâtarde 8, Rapière 9, Cimeterre 5, Lame courbe 6, Espadon 12, Épée runique 5.

| Palier | Épée | id | Famille | Niv. | Attaque | Origine | Icône / modèle |
|---|---|---|---|---|---|---|---|
| T1 | **Épée rouillée** | `rusty_sword` | Épée longue | 1 | 4 | v0.1 · butin | `rusty_sword` · `eq_sword_1` |
| T1 | **Glaive du milicien** | `militia_gladius` | Épée courte | 1 | 4 | butin | `shortsword_t1` · `eq_shortsword_1` |
| T1 | **Épée courte de cuivre** | `shortsword_copper` | Épée courte | 1 | 4 | artisanat | `shortsword_t1` · `eq_shortsword_1` |
| T1 | **Coutelas du berger** | `shepherd_cutlass` | Épée courte | 3 | 7 | butin | `shortsword_t1` · `eq_shortsword_1` |
| T1 | **Rapière de l'écuyer** | `squire_rapier` | Rapière | 3 | 7 | butin | `rapier_t1` · `eq_rapier_1` |
| T1 | **Épée de fer de Brumeval** | `brumeval_longsword` | Épée longue | 4 | 9 | butin | `sword_t1` · `eq_sword_1` |
| T1 | **Épée longue de la milice** | `longsword_militia` | Épée longue | 4 | 9 | artisanat | `sword_t1` · `eq_sword_1` |
| T1 | **Grande épée du garde** | `greatsword_warden` | Espadon | 4 | 14 | artisanat | `greatsword_t1` · `eq_greatsword_1` |
| T1 | **Bâtarde du garde** | `guard_bastard` | Épée bâtarde | 5 | 13 | butin | `bastard_t1` · `eq_bastard_1` |
| T2 | **Épée d'acier** | `steel_sword` | Épée longue | 6 | 12 | v0.1 · butin | `steel_sword` · `eq_sword_2` |
| T2 | **Cimeterre gobelin** | `goblin_scimitar` | Cimeterre | 6 | 11 | artisanat | `scimitar_t2` · `eq_scimitar_1` |
| T2 | **Rapière du duelliste** | `duelist_rapier` | Rapière | 7 | 12 | butin | `rapier_t2` · `eq_rapier_1` |
| T2 | **Rapière de l'éclaireur** | `rapier_scout` | Rapière | 7 | 12 | artisanat | `rapier_t2` · `eq_rapier_1` |
| T2 | **Lame des Murmures** | `whisper_blade` | Épée courte | 8 | 13 | butin | `shortsword_t2` · `eq_shortsword_1` |
| T2 | **Bâtarde du chevalier errant** | `knight_errant_bastard` | Épée bâtarde | 8 | 18 | butin | `bastard_t2` · `eq_bastard_1` |
| T2 | **Épée longue de fer** | `longsword_iron` | Épée longue | 9 | 17 | artisanat | `sword_t2` · `eq_sword_2` |
| T2 | **Fendoir du sanglier** | `greatsword_boar` | Espadon | 9 | 25 | artisanat | `greatsword_t2` · `eq_greatsword_2` |
| T2 | **Espadon du mercenaire** | `mercenary_greatsword` | Espadon | 10 | 28 | butin | `greatsword_t2` · `eq_greatsword_2` |
| T3 | **Épée du fossoyeur** | `gravedigger_sword` | Épée longue | 11 | 21 | butin | `sword_t3` · `eq_sword_3` |
| T3 | **Lame runique** | `runeblade` | Épée runique | 12 | 24 | v0.1 · butin | `runeblade` · `eq_runesword_2` |
| T3 | **Aiguille d'os** | `bone_needle` | Rapière | 12 | 19 | butin | `rapier_t3` · `eq_rapier_2` |
| T3 | **Lame courbe du Veilleur** | `watcher_curved_blade` | Lame courbe | 12 | 24 | butin | `curved_t3` · `eq_curved_2` |
| T3 | **Épée bâtarde d'os** | `bastard_bone` | Épée bâtarde | 12 | 26 | artisanat | `bastard_t3` · `eq_bastard_2` |
| T3 | **Espadon sépulcral** | `sepulchral_greatsword` | Espadon | 13 | 35 | butin | `greatsword_t3` · `eq_greatsword_3` |
| T3 | **Lame courbe du brigand** | `curved_bandit` | Lame courbe | 13 | 26 | artisanat | `curved_t3` · `eq_curved_2` |
| T3 | **Cimeterre du Deuil** | `mourning_scimitar` | Cimeterre | 14 | 23 | butin | `scimitar_t3` · `eq_scimitar_2` |
| T3 | **Rapière spectrale** | `rapier_wraith` | Rapière | 14 | 22 | artisanat | `rapier_t3` · `eq_rapier_2` |
| T3 | **Espadon du fossoyeur** | `greatsword_gravedigger` | Espadon | 14 | 37 | artisanat | `greatsword_t3` · `eq_greatsword_3` |
| T4 | **Lame du golem** | `bastard_golem` | Épée bâtarde | 15 | 31 | artisanat | `bastard_t4` · `eq_bastard_2` |
| T4 | **Épée de Brumenoire** | `brumenoire_longsword` | Épée longue | 16 | 29 | butin | `sword_t4` · `eq_sword_4` |
| T4 | **Cimeterre de Sable-Rouge** | `redsand_scimitar` | Cimeterre | 16 | 26 | artisanat | `scimitar_t4` · `eq_scimitar_2` |
| T4 | **Lame courbe du nomade** | `nomad_curved_blade` | Lame courbe | 17 | 33 | butin | `curved_t4` · `eq_curved_2` |
| T4 | **Rapière de Port-Salin** | `portsalin_rapier` | Rapière | 18 | 27 | butin | `rapier_t4` · `eq_rapier_2` |
| T4 | **Bâtarde à dard** | `stinger_bastard` | Épée bâtarde | 18 | 37 | butin | `bastard_t4` · `eq_bastard_2` |
| T4 | **Rapière au dard** | `rapier_stinger` | Rapière | 18 | 27 | artisanat | `rapier_t4` · `eq_rapier_2` |
| T4 | **Épée longue des tourbières** | `longsword_bog` | Épée longue | 19 | 33 | artisanat | `sword_t4` · `eq_sword_4` |
| T4 | **Grande lame de chitine** | `greatsword_chitin` | Espadon | 19 | 48 | artisanat | `greatsword_t4` · `eq_greatsword_3` |
| T4 | **Espadon des Dunes** | `dune_greatsword` | Espadon | 20 | 51 | butin | `greatsword_t4` · `eq_greatsword_3` |
| T5 | **Cimeterre du ver** | `scimitar_wyrm` | Cimeterre | 20 | 32 | artisanat | `scimitar_t5` · `eq_scimitar_3` |
| T5 | **Lame de Givreval** | `givreval_longsword` | Épée longue | 21 | 37 | butin | `sword_t5` · `eq_sword_5` |
| T5 | **Glaive du trappeur** | `trapper_gladius` | Épée courte | 21 | 31 | butin | `shortsword_t5` · `eq_shortsword_3` |
| T5 | **Runes du Blizzard** | `blizzard_runes` | Épée runique | 22 | 38 | butin | `runesword_t5` · `eq_runesword_3` |
| T5 | **Épée longue de givre** | `longsword_frost` | Épée longue | 22 | 38 | artisanat | `sword_t5` · `eq_sword_5` |
| T5 | **Fendeur des glaciers** | `glacier_cleaver` | Espadon | 23 | 58 | butin | `greatsword_t5` · `eq_greatsword_4` |
| T5 | **Bâtarde du loup de givre** | `bastard_icewolf` | Épée bâtarde | 23 | 46 | artisanat | `bastard_t5` · `eq_bastard_3` |
| T5 | **Lame courbe de l'Aube froide** | `coldawn_curved_blade` | Lame courbe | 24 | 46 | butin | `curved_t5` · `eq_curved_3` |
| T5 | **Lame courbe en corne** | `curved_horn` | Lame courbe | 24 | 46 | artisanat | `curved_t5` · `eq_curved_3` |
| T5 | **Espadon de mithril** | `greatsword_mithril` | Espadon | 24 | 60 | artisanat | `greatsword_t5` · `eq_greatsword_4` |
| T5 | **Bâtarde de la Sentinelle glacée** | `frozen_sentinel_bastard` | Épée bâtarde | 25 | 49 | butin | `bastard_t5` · `eq_bastard_3` |
| T6 | **Espadon du géant** | `greatsword_giant` | Espadon | 25 | 62 | artisanat | `greatsword_t6` · `eq_greatsword_5` |
| T6 | **Épée d'Aldmar** | `aldmar_longsword` | Épée longue | 26 | 45 | butin | `sword_t6` · `eq_sword_6` |
| T6 | **Rapière du Sang versé** | `bloodshed_rapier` | Rapière | 27 | 39 | butin | `rapier_t6` · `eq_rapier_3` |
| T6 | **Cimeterre du Pillard écarlate** | `scarlet_raider_scimitar` | Cimeterre | 27 | 42 | butin | `scimitar_t6` · `eq_scimitar_3` |
| T6 | **Épée runique d'Aldmar** | `runesword_aldmar` | Épée runique | 27 | 46 | artisanat | `runesword_t6` · `eq_runesword_3` |
| T6 | **Rapière de mithril** | `rapier_mithril` | Rapière | 27 | 39 | artisanat | `rapier_t6` · `eq_rapier_3` |
| T6 | **Épée runique des Anciens** | `elder_runesword` | Épée runique | 28 | 48 | butin | `runesword_t6` · `eq_runesword_3` |
| T6 | **Espadon runique** | `greatsword_rune` | Espadon | 28 | 69 | artisanat | `greatsword_t6` · `eq_greatsword_5` |
| T6 | **Espadon du Roi déchu** | `fallen_king_greatsword` | Espadon | 29 | 72 | butin | `greatsword_t6` · `eq_greatsword_5` |
| T6 | **Épée bâtarde du veilleur** | `bastard_watcher` | Épée bâtarde | 29 | 57 | artisanat | `bastard_t6` · `eq_bastard_3` |
| T6 | **Lame courbe du Crépuscule** | `dusk_curved_blade` | Lame courbe | 30 | 56 | butin | `curved_t6` · `eq_curved_3` |
| T6 | **Épée runique du phylactère** | `runesword_phylactery` | Épée runique | 30 | 51 | artisanat | `runesword_t6` · `eq_runesword_3` |

### 4.2 Les autres armes et la main gauche

| Famille | Bases (palier : nom `id` niveau) |
|---|---|
| Hache | T1 : Hachette de bûcheron `woodcutter_hatchet` 2 · T2 : Hache gobeline `goblin_axe` 7 · T3 : Hache du bourreau `headsman_axe` 12 · T4 : Hache de Brumenoire `brumenoire_axe` 17 · T5 : Hache de Givreval `givreval_axe` 22 · T6 : Hache du Pillard écarlate `scarlet_raider_axe` 27 |
| Masse | T1 : Gourdin clouté `studded_club` 2 · T2 : Masse du milicien `militia_mace` 8 · T3 : Masse du Chapelain `chaplain_mace` 13 · T4 : Masse de bronze des sables `sandbronze_mace` 18 · T5 : Masse du Glacier `glacier_maul` 23 · T6 : Masse du Roi déchu `fallen_king_mace` 28 |
| Lance | T1 : Épieu de chasse `hunting_spear` 3 · T2 : Lance forestière `forest_spear` 8 · T3 : Pique sépulcrale `sepulchral_pike` 13 · T4 : Trident de Port-Salin `portsalin_trident` 18 · T5 : Lance de la Sentinelle glacée `sentinel_spear` 23 · T6 : Lance d'Aldmar `aldmar_spear` 28 |
| Dague | T1 : Couteau à dépecer `skinning_knife` 1 · T2 : Dague gobeline `goblin_dagger` 6 · T3 : Stylet du fossoyeur `gravedigger_stiletto` 11 · T4 : Dard de scorpion `scorpion_sting` 16 · T5 : Croc de givre `frost_fang` 21 · T6 : Miséricorde écarlate `scarlet_misericorde` 26 |
| Bâton | T1 : Bâton d'apprenti `apprentice_staff` 1 · T1 : Bâton des brumes `staff_mist` 3* · T1 : Bâton de coudrier `hazel_staff` 4 · T2 : Bâton arcanique `arcane_staff` 6 · T2 : Bâton-totem `staff_totem` 8* · T3 : Bâton des braises `ember_staff` 12 · T3 : Bâton d'éclats d'âme `staff_soul` 13* · T4 : Bâton de la tourbière `peatbog_staff` 17 · T4 : Bâton de braise `staff_ember` 18* · T5 : Bâton de Cœur-de-givre `frostheart_staff` 22 · T5 : Bâton de fleur de givre `staff_frost` 23* · T6 : Bâton des Anciens d'Aldmar `aldmar_elder_staff` 27 · T6 : Bâton runique `staff_rune` 28* |
| Sceptre | T1 : Sceptre du novice `novice_scepter` 3 · T2 : Sceptre du chaman `shaman_scepter` 8 · T3 : Sceptre funéraire `funeral_scepter` 13 · T4 : Sceptre du mirage `mirage_scepter` 18 · T5 : Sceptre de l'aurore `aurora_scepter` 23 · T6 : Sceptre d'onyx d'Aldmar `aldmar_onyx_scepter` 28 |
| Arc court | T1 : Arc court `short_bow` 1 · T1 : Arc de frêne `bow_ash` 1* · T1 : Arc du braconnier `poacher_bow` 4 · T2 : Arc des Murmures `whisper_bow` 7 · T2 : Arc à corde de soie `bow_silk` 8* · T3 : Arc d'if du Cimetière `yew_bow` 12 · T4 : Arc de corne du désert `horn_bow` 17 · T5 : Arc du trappeur `trapper_bow` 22 · T6 : Arc court écarlate `scarlet_shortbow` 27 |
| Arc long | T1 : Arc long du milicien `militia_longbow` 5 · T2 : Arc long `long_bow` 6 · T3 : Arc elfique `elven_bow` 12 · T3 : Arc à empenne noire `bow_fletch` 13* · T4 : Arc long des marais `marsh_longbow` 18 · T4 : Arc des marais `bow_bog` 18* · T5 : Arc long de Givreval `givreval_longbow` 23 · T5 : Arc en corne de yéti `bow_horn` 23* · T6 : Arc long d'Aldmar `aldmar_longbow` 28 · T6 : Arc runique `bow_rune` 28* |
| Arbalète | T1 : Arbalète de garde `guard_crossbow` 4 · T2 : Arbalète gobeline `goblin_crossbow` 9 · T3 : Arbalète d'os `bone_crossbow` 14 · T4 : Arbalète de Port-Salin `portsalin_crossbow` 19 · T5 : Arbalète à cric du Nord `northern_crossbow` 24 · T6 : Arbalète du Sang versé `bloodshed_crossbow` 29 |
| Bouclier | T1 : Bouclier de bois cerclé `banded_shield` 1 · T1 : Écu de la milice `shield_militia` 3* · T2 : Écu du milicien `militia_heater` 6 · T2 : Pavois de ferraille `shield_scrap` 8* · T3 : Bouclier du Veilleur `watcher_shield` 11 · T3 : Bouclier d'os `shield_bone` 12* · T4 : Rondache de bronze `bronze_buckler` 16 · T4 : Écu de chitine `shield_chitin` 17* · T5 : Pavois givré `frosted_pavise` 21 · T5 : Pavois du yéti `shield_yeti` 22* · T6 : Égide d'Aldmar `aldmar_aegis` 26 · T6 : Rempart d'Aldmar `shield_aldmar` 28* |
| Grimoire | T1 : Carnet de l'apprenti `apprentice_notebook` 2 · T1 : Grimoire du novice `tome_novice` 3* · T2 : Grimoire des Murmures `whisper_grimoire` 7 · T2 : Grimoire de soie `tome_silk` 9* · T3 : Grimoire des lamentations `lament_grimoire` 12 · T3 : Codex spectral `tome_wraith` 14* · T4 : Codex de la tourbière `peatbog_codex` 17 · T4 : Herbier de la tourbière `tome_bog` 19* · T5 : Grimoire de la sorcière `tome_hag` 20* · T5 : Grimoire gelé `frozen_grimoire` 22 · T5 : Grimoire des neiges `tome_snow` 24* · T6 : Codex d'Aldmar `aldmar_codex` 27 · T6 : Grimoire d'Aldmar `tome_aldmar` 29* |
| Carquois | T1 : Carquois de cuir `leather_quiver` 1 · T1 : Carquois en peau de loup `quiver_wolf` 4* · T2 : Carquois forestier `forest_quiver` 6 · T2 : Carquois du chasseur `quiver_boar` 7* · T3 : Carquois d'os `bone_quiver` 11 · T3 : Carquois du fossoyeur `quiver_fletch` 12* · T4 : Carquois de chitine `chitin_quiver` 16* · T5 : Carquois de fourrure `fur_quiver` 21 · T5 : Carquois de toison `quiver_fleece` 22* · T6 : Carquois écarlate `scarlet_quiver` 26 · T6 : Carquois en peau de troll `quiver_troll` 27* |

\* = fabriqué (existe aussi en butin sans bonus d'ensemble).

### 4.3 Légendaires (objets uniques de boss)

| Légendaire | id | Famille | Niv. | Boss | Chance | Effet |
|---|---|---|---|---|---|---|
| **Fendroc, lame du Golem** | `fendroc` | Espadon | 14 | golem | 12 % (+3 %/échec) | Les attaques chargées libèrent une onde de choc au sol (rayon 3 m, 60 % des dégâts, déséquilibre ×2). |
| **Épine de la Sorcière** | `hag_thorn` | Rapière | 19 | swamp_hag | 12 % (+3 %/échec) | Les coups critiques empoisonnent : 40 % des dégâts du coup en 4 s, cumulable 3 fois. |
| **Croc du Ver des sables** | `wyrm_fang` | Cimeterre | 20 | sand_wyrm | 12 % (+3 %/échec) | Après une esquive parfaite (roulade à travers une attaque), le prochain coup inflige +60 % de dégâts et rend 15 d’endurance. |
| **Brise-Montagne** | `mountain_breaker` | Épée bâtarde | 24 | frost_giant | 12 % (+3 %/échec) | Parade parfaite (Garde au dernier instant) : renvoie 100 % des dégâts parés et fait tituber l’attaquant. |
| **Lame runique d'Aldmar** | `aldmar_runeblade` | Épée runique | 29 | lich | 12 % (+3 %/échec) | Les coups critiques gèlent la cible 1 s (boss et joueurs : ralentis de 40 % pendant 2 s). 8 s de recharge par cible. |
| **Soif-de-Sang** | `thirst` | Lame courbe | 30 | scarlet_champion | 10 % (+3 %/échec) | Vol de vie doublé ; chaque ennemi tué rend 8 % des PV et 20 d’endurance. En zone rouge seulement : +10 % de dégâts. |
| **Rempart du Golem** | `golem_rampart` | Bouclier | 14 | golem | 10 % (+3 %/échec) | Blocage 100 % ; bloquer un coup lourd (télégraphié) ne coûte pas d’endurance une fois toutes les 10 s. |
| **Grimoire de la Vase** | `hag_grimoire` | Grimoire | 19 | swamp_hag | 10 % (+3 %/échec) | Vos sorts de zone laissent une flaque de vase 4 s (ralentit de 30 %, dégâts arcaniques par seconde). |
| **Carreau-d'Hiver** | `winter_bolt` | Arbalète | 24 | frost_giant | 10 % (+3 %/échec) | Chaque 3ᵉ carreau traverse les ennemis et les ralentit de 30 % pendant 2 s. |
| **Bâton du Roi-Liche** | `lich_staff` | Bâton | 29 | lich | 10 % (+3 %/échec) | Tuer un ennemi avec un sort relève un feu follet allié 10 s (attaque les ennemis proches, 30 % de votre attaque). |

Le **Champion écarlate** (`scarlet_champion`, boss de zone rouge, niveau 28–30) est créé pour porter *Soif-de-Sang* :
il reprend le modèle du bandit, agrandi et teinté (voir `ASSET_REQUESTS.md`).

## 5. Armures

- Poids, pièce par pièce : **Plaques** — Beaucoup de défense. Chaque pièce : −5 % de régénération d’endurance, −3 % de vitesse d’incantation, +1 d’endurance par roulade. ; **Cuir** — Équilibré. Chaque pièce : +3 % de régénération d’endurance, −3 % d’endurance dépensée en sprint. ; **Tissu** — Peu de défense mais du mana (valeur propre à chaque pièce). Chaque pièce : +3 % de vitesse d’incantation.
- 4 pièces par série (tête, torse, mains, pieds), défense répartie 22 / 40 / 18 / 20 %.

### 5.1 Toutes les séries

| Série | Type | Palier | Niv. | Origine | Pièces | Bonus 2 / 4 pièces |
|---|---|---|---|---|---|---|
| `militia` de la Milice | plaques | T1 | 3 | artisanat (Forge) · marchand · drop | `militia_helm` `militia_chest` `militia_gloves` `militia_boots` | +5 % de PV max. / Tenir la ligne : bloquer avec la Garde coûte 20 % d'endurance en moins. |
| `mistwatch` du Guetteur des brumes | tissu | T1 | 3 | artisanat (Couture) · marchand · drop | `mistwatch_helm` `mistwatch_chest` `mistwatch_gloves` `mistwatch_boots` | +8 % de mana max. / Voile de brume : sous 30 % de PV, votre prochaine roulade laisse un nuage qui réduit de 20 % les dégâts subis pendant 3 s (une fois par minute). |
| `wolf` en peau de loup | cuir | T1 | 4 | artisanat (Couture, fourrures de loup) · drop | `wolf_helm` `wolf_chest` `wolf_gloves` `wolf_boots` | +4 % de chances de critique. / Instinct de meute : après une roulade, la prochaine attaque dans les 2 s inflige +20 % de dégâts. |
| `scrap` en ferraille gobeline | plaques | T2 | 7 | artisanat (Forge) · drop | `scrap_helm` `chainmail` `scrap_gloves` `scrap_boots` | +5 % de défense. / Rafistolé : chaque coup reçu rend 1 % des PV max (au plus une fois par seconde). |
| `boar` en cuir de sanglier | cuir | T2 | 7 | artisanat (Couture) · drop | `boar_helm` `boar_chest` `boar_gloves` `boar_boots` | +10 % d'équilibre (on titube moins). / Charge : la première attaque après 1 s de sprint inflige +40 % de dégâts d'équilibre (poise). |
| `shaman` du Chaman | tissu | T2 | 9 | drop (chaman gobelin) | `shaman_helm` `shaman_chest` `shaman_gloves` `shaman_boots` | +10 % de mana max. / Braises sacrées : vos sorts de feu ont 15 % de chances de ne rien coûter. |
| `silk` Tenue de soie tisse-venin | tissu | T2 | 9 | artisanat (Couture et tannerie) | `silk_helm` `silk_chest` `silk_gloves` `silk_boots` | +10 % de résistance au poison. / Toile : vos sorts ont 10 % de chances d'engluer la cible (ralentie de 30 % pendant 2 s). |
| `bone` Armure d'os ancien | plaques | T3 | 12 | artisanat (Forge) | `bone_helm` `bone_chest` `bone_gloves` `bone_boots` | +15 % de dégâts contre les morts-vivants. / Ossature : toutes les 20 s, la première attaque télégraphiée qui vous touche est réduite de 30 %. |
| `bandit` du Brigand | cuir | T3 | 13 | artisanat (Couture) · drop (bandits) | `bandit_helm` `bandit_chest` `bandit_gloves` `bandit_boots` | +5 % de vitesse d'attaque. / Coup bas : +15 % de chances de critique en frappant un ennemi dans le dos. |
| `occultist` de l'Occultiste | tissu | T3 | 13 | drop (squelette occultiste) | `occultist_helm` `occultist_chest` `occultist_gloves` `occultist_boots` | +8 % de vitesse d’incantation. / Moisson d’âmes : chaque ennemi tué rend 5 % de votre mana. |
| `golem` du Golem ancien | plaques | T3 | 14 | boss (Golem) · pièces manquantes par artisanat (cœurs de golem) | `golem_helm` `golem_plate` `golem_gloves` `golem_boots` | +15 % de dégâts de déséquilibre. / Peau de pierre : la Garde coûte 30 % d’endurance en moins et protège aussi des coups par l’arrière. |
| `wraith` Tenue spectrale | tissu | T3 | 14 | artisanat (Couture et tannerie) | `wraith_helm` `wraith_chest` `wraith_gloves` `wraith_boots` | +8 % de dégâts d'arcane. / Évanescence : l'invulnérabilité de la roulade dure 0,1 s de plus. |
| `chitin` en chitine du désert | plaques | T4 | 17 | artisanat (Forge, chitine de scorpion) · drop | `chitin_helm` `chitin_chest` `chitin_gloves` `chitin_boots` | +10 % de résistance au feu. / Épines : renvoie 10 % des dégâts de mêlée subis à l'attaquant. |
| `lurker` du Rôdeur des marais | cuir | T4 | 18 | artisanat (Couture) · drop | `lurker_helm` `lurker_chest` `lurker_gloves` `lurker_boots` | +10 % de régénération d'endurance. / Amphibie : le sprint coûte 25 % d'endurance en moins et la boue ne vous ralentit plus. |
| `hag` de la Sorcière des marais | tissu | T4 | 19 | boss (Sorcière des marais) | `hag_helm` `hag_chest` `hag_gloves` `hag_boots` | +10 % de résistance aux arcanes. / Maléfice : vos sorts affaiblissent la cible (−10 % de dégâts infligés pendant 5 s). |
| `bog` Atours de la tourbière | tissu | T4 | 19 | artisanat (Couture et tannerie) | `bog_helm` `bog_chest` `bog_gloves` `bog_boots` | +10 % de régénération de mana. / Miasmes : vos sorts de zone laissent une flaque toxique pendant 3 s. |
| `frost` Harnois de givre | plaques | T5 | 22 | artisanat (Forge) | `frost_helm` `frost_chest` `frost_gloves` `frost_boots` | +10 % de résistance au givre. / Cœur gelé : subir un coup critique gèle l'attaquant 1 s (une fois toutes les 15 s). |
| `icewolf` du Loup de givre | cuir | T5 | 23 | artisanat (Couture, fourrures de givre) · drop | `icewolf_helm` `icewolf_chest` `icewolf_gloves` `icewolf_boots` | +5 % de chances de critique. / Meute blanche : après une roulade, la prochaine attaque dans les 2 s inflige +25 % de dégâts sous forme de givre. |
| `frost_giant` du Géant de givre | plaques | T5 | 24 | boss (Géant de givre) · donjon Grotte gelée (v0.4) | `frost_giant_helm` `frost_giant_chest` `frost_giant_gloves` `frost_giant_boots` | +10 % de PV max. / Parade glaciale : une parade parfaite libère une onde de givre (4 m, ralentit de 40 % pendant 2 s). |
| `fleece` en toison de yéti | tissu | T5 | 24 | artisanat (Couture, toison de yéti) · drop | `fleece_helm` `fleece_chest` `fleece_gloves` `fleece_boots` | +8 % de dégâts de givre. / Blizzard intérieur : les compétences de givre coûtent 15 % de mana en moins. |
| `scarlet_stalker` du Traqueur écarlate | cuir | T6 | 27 | zones rouges (Marques écarlates, élites) | `scarlet_stalker_helm` `scarlet_stalker_chest` `scarlet_stalker_gloves` `scarlet_stalker_boots` | Roulade : −15 % d’endurance. / Contre mortel : après une esquive parfaite, votre prochain coup (dans les 2 s) est un critique assuré. |
| `aldmar` Harnois runique d'Aldmar | plaques | T6 | 27 | artisanat (Forge) | `aldmar_helm` `aldmar_chest` `aldmar_gloves` `aldmar_boots` | +8 % de défense. / Rune de garde : bloquer une attaque avec la Garde rend 10 d'endurance. |
| `bloodshed` du Sang versé | plaques | T6 | 28 | zones rouges (Marques écarlates, élites) | `bloodshed_helm` `bloodshed_chest` `bloodshed_gloves` `bloodshed_boots` | +3 % de vol de vie. / Rage du sang : sous 30 % de PV, +20 % de dégâts et +30 % de régénération d’endurance. |
| `troll` Ensemble du troll | cuir | T6 | 28 | artisanat (Couture et tannerie) | `troll_helm` `troll_chest` `troll_gloves` `troll_boots` | +8 % de PV max. / Chair de troll : sous 40 % de PV, régénère 1 % des PV max par seconde, même en combat. |
| `lich` du Roi-Liche | tissu | T6 | 29 | boss (Liche) · donjon Crypte d'Aldmar (v0.4) | `lich_helm` `lich_chest` `lich_gloves` `lich_boots` | +15 % de mana max. / Phylactère : une fois toutes les 120 s, un coup mortel vous laisse à 1 PV avec 2 s d’invulnérabilité. |
| `arcanist` Tenue de l'arcaniste d'Aldmar | tissu | T6 | 29 | artisanat (Couture et tannerie) | `arcanist_helm` `arcanist_chest` `arcanist_gloves` `arcanist_boots` | +8 % de dégâts d'arcane. / Surcharge runique : toutes les 5 compétences lancées, la suivante ne coûte pas de mana. |

### 5.2 Ensembles de butin (Épiques, affixes fixes)

| Ensemble | id | Palier | Source | Bonus 2 pièces | Bonus 4 pièces |
|---|---|---|---|---|---|
| **Parures du Chaman** | `shaman_set` | T2 | drop (chaman gobelin) | +10 % de mana max. | Braises sacrées : vos sorts de feu ont 15 % de chances de ne rien coûter. |
| **Harnois du Golem ancien** | `golem_set` | T3 | boss (Golem) · pièces manquantes par artisanat (cœurs de golem) | +15 % de dégâts de déséquilibre. | Peau de pierre : la Garde coûte 30 % d’endurance en moins et protège aussi des coups par l’arrière. |
| **Linceul de l'Occultiste** | `occultist_set` | T3 | drop (squelette occultiste) | +8 % de vitesse d’incantation. | Moisson d’âmes : chaque ennemi tué rend 5 % de votre mana. |
| **Voiles de la Sorcière** | `hag_set` | T4 | boss (Sorcière des marais) | +10 % de résistance aux arcanes. | Maléfice : vos sorts affaiblissent la cible (−10 % de dégâts infligés pendant 5 s). |
| **Harnois du Géant de givre** | `frost_giant_set` | T5 | boss (Géant de givre) · donjon Grotte gelée (v0.4) | +10 % de PV max. | Parade glaciale : une parade parfaite libère une onde de givre (4 m, ralentit de 40 % pendant 2 s). |
| **Harnois du Sang versé** | `bloodshed_set` | T6 | zones rouges (Marques écarlates, élites) | +3 % de vol de vie. | Rage du sang : sous 30 % de PV, +20 % de dégâts et +30 % de régénération d’endurance. |
| **Cuir du Traqueur écarlate** | `scarlet_set` | T6 | zones rouges (Marques écarlates, élites) | Roulade : −15 % d’endurance. | Contre mortel : après une esquive parfaite, votre prochain coup (dans les 2 s) est un critique assuré. |
| **Robe du Roi-Liche** | `lich_set` | T6 | boss (Liche) · donjon Crypte d'Aldmar (v0.4) | +15 % de mana max. | Phylactère : une fois toutes les 120 s, un coup mortel vous laisse à 1 PV avec 2 s d’invulnérabilité. |

## 6. Affixes

| Affixe | id | Effet | Niv. 1 | Niv. 30 | Emplacements |
|---|---|---|---|---|---|
| Force | `force` | +{v} attaque | 1–2 | 8–12 | weapon, offhand, hands, ring, amulet |
| Garde | `garde` | +{v} défense | 1–2 | 7–11 | offhand, head, chest, hands, feet, ring |
| Vitalité | `vitalite` | +{v} PV | 6–10 | 60–90 | offhand, head, chest, hands, feet, ring, amulet |
| Esprit | `esprit` | +{v} mana | 5–8 | 40–60 | weapon:focalisateur, offhand, head, chest, hands, feet, ring, amulet |
| Endurance | `endurance` | +{v} endurance max | 3–5 | 10–15 | head, chest, hands, feet, amulet |
| Souffle | `souffle` | +{v} % régénération d’endurance | 3–5 | 8–12 | chest, feet, ring, amulet |
| Précision | `precision` | +{v} % de chances de critique | 1–2 | 3–5 | weapon, hands, ring, amulet, offhand:carquois |
| Vitesse d'attaque | `vitesse_attaque` | +{v} % de vitesse d’attaque | 2–3 | 6–8 | weapon, hands |
| Incantation | `incantation` | +{v} % de vitesse d’incantation | 2–3 | 6–8 | weapon:focalisateur, head, offhand:grimoire, amulet |
| Vol de vie | `vol_de_vie` | {v} % des dégâts infligés rendus en PV | 1–1 | 2–4 | weapon, ring, amulet |
| Équilibre | `equilibre` | +{v} % de dégâts de déséquilibre | 5–8 | 15–25 | weapon, hands, offhand:bouclier |
| Braise | `feu` | +{v} dégâts de feu par coup | 1–3 | 8–14 | weapon, ring |
| Givre | `givre` | +{v} dégâts de givre par coup | 1–3 | 8–14 | weapon, ring |
| Arcane | `arcane` | +{v} dégâts arcaniques par coup | 1–3 | 8–14 | weapon, ring |
| Résistance au feu | `res_feu` | +{v} % de résistance au feu | 3–5 | 10–15 | offhand, head, chest, hands, feet, ring, amulet |
| Résistance au givre | `res_givre` | +{v} % de résistance au givre | 3–5 | 10–15 | offhand, head, chest, hands, feet, ring, amulet |
| Résistance arcanique | `res_arcane` | +{v} % de résistance aux arcanes | 3–5 | 10–15 | offhand, head, chest, hands, feet, ring, amulet |
| Résistance au poison | `res_poison` | +{v} % de résistance au poison | 3–5 | 10–15 | offhand, head, chest, hands, feet, ring, amulet |
| Célérité | `celerite` | +{v} % de vitesse de déplacement | 2–3 | 5–7 | feet |

## 7. Butin : qui lâche quoi

- Chance d'équipement : 6 % par monstre normal, 30 % par élite, garanti : 2 objets (+1 par tranche de 3 joueurs du groupe au-delà du premier) ;
  zones rouges ×2. Butin intelligent : 40 % des objets tombés correspondent à la famille d’arme ou au type d’armure que porte celui qui ramasse (règle affichée dans le Codex).
- Poids des raretés :
  - normal : Commun 70, Inhabituel 22, Rare 7, Épique 1
  - elite : Commun 40, Inhabituel 38, Rare 17, Épique 5
  - boss : Commun 0, Inhabituel 30, Rare 45, Épique 25
  - redZone : Commun 45, Inhabituel 33, Rare 17, Épique 5
  - redZoneElite : Commun 20, Inhabituel 35, Rare 30, Épique 15
- Paliers et niveaux des monstres : ceux de l'artisanat font foi (bandits **T3**, niveaux 11–15 ; trolls **T6**,
  niveaux 25–29). Élites de zone rouge : table en plus (Fragment runique d'Aldmar 25 %, Éclat de cristal 30 %, Marque écarlate 20 %).

| Monstre | Palier | Niveaux | Matériaux [chance, quantité] | Pierres | Ensembles / légendaires |
|---|---|---|---|---|---|
| `slime` | T1 | 1–3 | Gelée de gluant 55 % ×1–2 · Cœur de gluant 6 % ×1 | Pierre de forge brute 3 % | — |
| `wolf` | T1 | 3–6 | Fourrure de loup 50 % ×1 · Croc de loup 30 % ×1–2 | Pierre de forge brute 3 % | — |
| `goblin` | T2 | 5–8 | Babiole gobeline 40 % ×1 · Ferraille gobeline 35 % ×1–2 | Pierre de forge brute 5 % | — |
| `goblin_shaman` | T2 | 6–9 | Plume de totem 45 % ×1 · Babiole gobeline 30 % ×1 | Pierre de forge brute 5 % | Parures du Chaman 3 % |
| `boar` | T2 | 4–7 | Cuir de sanglier 50 % ×1 · Défense de sanglier 25 % ×1 | Pierre de forge brute 5 % | — |
| `spider` | T2 | 7–10 | Soie d'araignée 55 % ×1–2 · Glande à venin 25 % ×1 | Pierre de forge brute 5 % | — |
| `skeleton` | T3 | 8–11 | Os ancien 45 % ×1 · Poussière de tombe 30 % ×1–2 | Pierre de forge brute 5 % · Pierre de forge taillée 2 % | — |
| `skeleton_archer` | T3 | 9–12 | Empenne noire 40 % ×1–2 · Os ancien 35 % ×1 · Poussière de tombe 20 % ×1 | Pierre de forge brute 5 % · Pierre de forge taillée 2 % | — |
| `wraith` | T3 | 12–15 | Voile spectral 50 % ×1 · Éclat d'âme 12 % ×1 | Pierre de forge brute 5 % · Pierre de forge taillée 2 % | — |
| `golem` (boss) | T3 | 14–14 | Cœur de golem 100 % ×1 · Pierre animée 100 % ×3–5 · Éclat de cristal 50 % ×2–3 | Pierre de forge taillée 100 % · Pierre de forge ancestrale 20 % | Harnois du Golem ancien 35 % · Fendroc, lame du Golem 12 % · Rempart du Golem 10 % |
| `bog_lurker` | T4 | 15–19 | Écaille des marais 50 % ×1–2 · Mousse des tourbières 40 % ×1–2 | Pierre de forge brute 4 % · Pierre de forge taillée 3 % | — |
| `scorpion` | T4 | 15–18 | Chitine de scorpion 50 % ×1–2 · Dard de scorpion 25 % ×1 | Pierre de forge brute 4 % · Pierre de forge taillée 3 % | — |
| `bandit` | T3 | 11–15 | Étoffe de brigand 50 % ×1–2 · Lame ébréchée 30 % ×1 | Pierre de forge brute 4 % · Pierre de forge taillée 3 % | — |
| `swamp_hag` (boss) | T4 | 19–19 | Œil de la sorcière 100 % ×1 · Mousse des tourbières 100 % ×3–5 · Éclat d'âme 50 % ×1–2 | Pierre de forge taillée 100 % · Pierre de forge ancestrale 20 % | Voiles de la Sorcière 35 % · Épine de la Sorcière 12 % · Grimoire de la Vase 10 % |
| `sand_wyrm` (boss) | T4 | 20–20 | Écaille de ver des sables 100 % ×4–6 · Dent du ver des sables 60 % ×1 · Chitine de scorpion 100 % ×2–4 | Pierre de forge taillée 100 % · Pierre de forge ancestrale 20 % | Croc du Ver des sables 12 % |
| `ice_wolf` | T5 | 20–23 | Fourrure de givre 50 % ×1 · Croc de loup de givre 30 % ×1–2 | Pierre de forge taillée 4 % · Pierre de forge ancestrale 1 % | — |
| `yeti` | T5 | 22–25 | Toison de yéti 55 % ×1–2 · Corne de yéti 20 % ×1 | Pierre de forge taillée 4 % · Pierre de forge ancestrale 1 % | — |
| `troll` | T6 | 25–29 | Peau de troll 50 % ×1 · Sang de troll 25 % ×1 · Fragment runique d'Aldmar 8 % ×1 | Pierre de forge taillée 4 % · Pierre de forge ancestrale 1 % | — |
| `frost_giant` (boss) | T5 | 25–25 | Cœur de givre éternel 100 % ×1 · Éclat de cristal 100 % ×3–5 · Croc de loup de givre 100 % ×2–3 | Pierre de forge taillée 100 % · Pierre de forge ancestrale 50 % | Harnois du Géant de givre 35 % · Brise-Montagne 12 % · Carreau-d'Hiver 10 % |
| `lich` (boss) | T6 | 30–30 | Éclat de phylactère 100 % ×1 · Éclat d'âme 100 % ×3–5 · Fragment runique d'Aldmar 100 % ×2–4 | Pierre de forge taillée 100 % · Pierre de forge ancestrale 50 % | Robe du Roi-Liche 35 % · Lame runique d'Aldmar 12 % · Bâton du Roi-Liche 10 % |
| `scarlet_champion` (boss) | T6 | 28–30 | Marque écarlate 100 % ×3–5 · Fragment runique d'Aldmar 50 % ×1–2 · Éclat de cristal 50 % ×1–2 | Pierre de forge taillée 100 % · Pierre de forge ancestrale 50 % | Soif-de-Sang 10 % |

## 8. Artisanat

### 8.1 Métiers, récolte, progression

- **3 métiers**, tous accessibles à tous : **Forge** (`forge`, Maître Bertram `npc_blacksmith`), **Alchimie**
  (`alchemy_table`, Ysolde `npc_alchemist`), **Couture et tannerie** (`workbench`, Maud la tanneuse, nouveau modèle
  `npc_tanner`).
- **Récolte sans outil** : maintenir E 2 s ; filon grisé 3 min pour tout votre compte (tous vos personnages), les autres joueurs peuvent encore le récolter ; partagé et double en zone rouge.

| Point de récolte | Modèle | Donne | Palier |
|---|---|---|---|
| Filon de cuivre | `node_copper` | 2–3 × Minerai de cuivre | T1 |
| Filon de fer | `node_iron` | 2–3 × Minerai de fer | T2 |
| Filon de mithril | `node_mithril` | 1–2 × Minerai de mithril | T5 |
| Amas de cristal | `node_crystal` | 1–2 × Éclat de cristal | T3 |
| Touffe d'herbe de brume | `node_herb_brume` | 2–3 × Herbe de brume | T1 |
| Pétales de braise | `node_herb_braise` | 1–3 × Pétale de braise | T4 |
| Fleur de givre | `node_herb_givre` | 1–3 × Fleur de givre | T5 |

- XP de métier : `30 + 12 × niveau` pour passer au suivant (6 090 XP de 1 à 30) ; première fabrication d'une recette ×3.
- **Qualité** : Normale → Inhabituel, Supérieure (18 % de base) → Rare, Chef-d'œuvre (3 %) → Épique ; plafonds 45 % et
  15 % avec le niveau de métier et un éclat de cristal en catalyseur ; une **affixe signature** par recette.
- Fabriqué = butin du même palier (mêmes formules), un Chef-d'œuvre vaut un Épique, **jamais de légendaire**.
- Apprentissage : recettes de départ, maître du métier (10 + niveau² po, ×2 pour un plan), plans d'ensemble (4 pièces
  d'un coup, de plus en plus en butin), plans de boss (20 %, jamais légendaires), pièces manquantes des ensembles de boss
  à la première victoire.
- **Revente** : un objet fabriqué se revend au marchand pour **la valeur de ses matériaux** (colonne « Revente » des
  recettes), quelle que soit sa qualité ; entre joueurs, prix libre. Recyclé, il ne rend que des chutes.
- Puits d'or : frais de station (1 + ⌊niveau² / 12⌋ po), recettes, ingrédients des maîtres, taxe des étals de 5 %.

### 8.2 Les deux exemples des joueurs

**Ensemble du loup** (`wolf`, cuir, niveau 4, plan chez Maud à 52 po) — bonus 2 pièces : +4 % de chances de critique ;
4 pièces : Instinct de meute : après une roulade, la prochaine attaque dans les 2 s inflige +20 % de dégâts.

| Pièce | id | Ingrédients |
|---|---|---|
| Capuche du loup | `wolf_helm` | 3 Fourrure de loup, 1 Croc de loup, 2 Lanières de cuir |
| Pelisse du loup | `wolf_chest` | 5 Fourrure de loup, 2 Croc de loup, 3 Lanières de cuir |
| Gants du loup | `wolf_gloves` | 3 Fourrure de loup, 1 Croc de loup, 2 Lanières de cuir |
| Bottes du loup | `wolf_boots` | 3 Fourrure de loup, 1 Croc de loup, 2 Lanières de cuir |

**Potions de gluant** (Alchimie) :

| Niv. | Recette | Ingrédients | Produit |
|---|---|---|---|
| 1 | Petite potion de soin | 2 Gelée de gluant, 1 Fiole de verre | `potion_hp_s` : Rend 60 PV. |
| 4 | Tonique d'endurance | 1 Gelée de gluant, 1 Herbe de brume, 1 Croc de loup, 1 Fiole de verre | `potion_stamina` : Rend 60 d'endurance et +30 % de régénération d'endurance pendant 15 s. |
| 7 | Potion de soin moyenne | 3 Gelée de gluant, 2 Herbe de brume, 1 Fiole de verre | `potion_hp_m` : Rend 140 PV. |
| 9 | Huile venimeuse | 2 Glande à venin, 1 Gelée de gluant, 1 Fiole de verre | `oil_venom` : Arme : les coups empoisonnent (4 % de l'attaque par s pendant 4 s). 10 min. |
| 14 | Grande potion de soin | 2 Gelée de gluant, 1 Cœur de gluant, 2 Herbe de brume, 1 Fiole de verre | `potion_hp_l` : Rend 220 PV. |
| 18 | Huile de braise | 3 Pétale de braise, 1 Gelée de gluant, 1 Fiole de verre | `oil_ember` : Arme : +8 % des dégâts convertis en feu, qui brûle 3 s. 10 min. |
| 25 | Potion de soin suprême | 1 Sang de troll, 2 Fleur de givre, 1 Cœur de gluant, 1 Fiole de verre | `potion_hp_xl` : Rend 400 PV. |

Toutes les potions de soin et de mana partagent une recharge de 20 s (0,8 s pour boire, annulée par une roulade) : la fiole reste un choix tactique, comme dans un soulslike.

### 8.3 Matériaux (56)

| Matériau | id | Origine | Palier | Sources | Utilisé dans (recettes) |
|---|---|---|---|---|---|
| Gelée de gluant | `slime_gel` | monster | T1 | slime 55 % | 11 |
| Cœur de gluant | `slime_core` | monster | T1 | slime 6 % | 4 |
| Fourrure de loup | `wolf_pelt` | monster | T1 | wolf 50 % | 7 |
| Croc de loup | `wolf_fang` | monster | T1 | wolf 30 % | 7 |
| Cuir de sanglier | `boar_hide` | monster | T2 | boar 50 % | 6 |
| Défense de sanglier | `boar_tusk` | monster | T2 | boar 25 % | 7 |
| Babiole gobeline | `goblin_trinket` | monster | T2 | goblin 40 % · goblin_shaman 30 % | 3 |
| Ferraille gobeline | `goblin_scrap` | monster | T2 | goblin 35 % | 7 |
| Plume de totem | `totem_feather` | monster | T2 | goblin_shaman 45 % | 3 |
| Soie d'araignée | `spider_silk` | monster | T2 | spider 55 % | 10 |
| Glande à venin | `venom_gland` | monster | T2 | spider 25 % | 8 |
| Os ancien | `ancient_bone` | monster | T3 | skeleton 45 % · skeleton_archer 35 % | 9 |
| Poussière de tombe | `grave_dust` | monster | T3 | skeleton 30 % · skeleton_archer 20 % | 7 |
| Empenne noire | `black_fletching` | monster | T3 | skeleton_archer 40 % | 2 |
| Voile spectral | `wraith_veil` | monster | T3 | wraith 50 % | 7 |
| Éclat d'âme | `soul_shard` | monster | T3 | wraith 12 % · swamp_hag 50 % · lich 100 % | 20 |
| Étoffe de brigand | `bandit_cloth` | monster | T3 | bandit 50 % | 5 |
| Lame ébréchée | `chipped_blade` | monster | T3 | bandit 30 % | 2 |
| Cœur de golem | `golem_core` | boss | T3 | golem 100 % | 5 |
| Pierre animée | `golem_stone` | boss | T3 | golem 100 % | 6 |
| Chitine de scorpion | `scorpion_chitin` | monster | T4 | scorpion 50 % · sand_wyrm 100 % | 9 |
| Dard de scorpion | `scorpion_stinger` | monster | T4 | scorpion 25 % | 8 |
| Écaille des marais | `lurker_scale` | monster | T4 | bog_lurker 50 % | 7 |
| Mousse des tourbières | `bog_moss` | monster | T4 | bog_lurker 40 % · swamp_hag 100 % | 14 |
| Œil de la sorcière | `hag_eye` | boss | T4 | swamp_hag 100 % | 1 |
| Écaille de ver des sables | `wyrm_scale` | boss | T4 | sand_wyrm 100 % | 1 |
| Dent du ver des sables | `wyrm_tooth` | boss | T4 | sand_wyrm 60 % | 1 |
| Fourrure de givre | `frost_pelt` | monster | T5 | ice_wolf 50 % | 6 |
| Croc de loup de givre | `icewolf_fang` | monster | T5 | ice_wolf 30 % · frost_giant 100 % | 14 |
| Toison de yéti | `yeti_fur` | monster | T5 | yeti 55 % | 7 |
| Corne de yéti | `yeti_horn` | monster | T5 | yeti 20 % | 4 |
| Cœur de givre éternel | `frost_heart` | boss | T5 | frost_giant 100 % | 5 |
| Peau de troll | `troll_hide` | monster | T6 | troll 50 % | 9 |
| Sang de troll | `troll_blood` | monster | T6 | troll 25 % | 7 |
| Fragment runique d'Aldmar | `rune_shard` | monster | T6 | troll 8 % · lich 100 % · élites de zone rouge 25 % · scarlet_champion 50 % | 20 |
| Éclat de phylactère | `phylactery_shard` | boss | T6 | lich 100 % | 5 |
| Minerai de cuivre | `ore_copper` | gathered | T1 | — | 1 |
| Minerai de fer | `ore_iron` | gathered | T2 | — | 1 |
| Minerai de mithril | `ore_mithril` | gathered | T5 | — | 1 |
| Éclat de cristal | `crystal_shard` | gathered | T3 | golem 50 % · frost_giant 100 % · élites de zone rouge 30 % · scarlet_champion 50 % | 32 |
| Herbe de brume | `herb_brume` | gathered | T1 | — | 12 |
| Pétale de braise | `herb_braise` | gathered | T4 | — | 9 |
| Fleur de givre | `herb_givre` | gathered | T5 | — | 9 |
| Lingot de cuivre | `ingot_copper` | refined | T1 | — | 12 |
| Lingot de fer | `ingot_iron` | refined | T2 | — | 43 |
| Lingot de mithril | `ingot_mithril` | refined | T5 | — | 29 |
| Lanières de cuir | `leather_strip` | refined | T1 | — | 63 |
| Rouleau de tissu | `cloth_bolt` | refined | T1 | — | 37 |
| Ferraille | `scrap_metal` | salvage | T1 | — | 1 |
| Chutes de cuir | `leather_scraps` | salvage | T1 | — | 1 |
| Chutes d'étoffe | `cloth_scraps` | salvage | T1 | — | 1 |
| Copeaux de bois précieux | `wood_scraps` | salvage | T1 | — | 1 |
| Fiole de verre | `vial` | vendor | T1 | — | 19 |
| Toile de lin | `linen` | vendor | T1 | — | 1 |
| Bois de frêne | `ash_wood` | vendor | T1 | — | 15 |
| Marque écarlate | `scarlet_mark` | monster | T6 | scarlet_champion 100 % · élites de zone rouge 20 % | 1 |

### 8.4 Consommables

| Objet | id | Type | Effet | Icône |
|---|---|---|---|---|
| Pierre de forge brute | `forge_stone_rough` | forge_stone | Amélioration +1 à +4 | `forge_stone_1` |
| Pierre de forge taillée | `forge_stone_cut` | forge_stone | Amélioration +5 à +7 | `forge_stone_2` |
| Pierre de forge ancestrale | `forge_stone_ancestral` | forge_stone | Amélioration +8 à +10 | `forge_stone_3` |
| Petite potion de soin | `potion_hp_s` | potion | Rend 60 PV. | `potion_hp_s` |
| Potion de mana | `potion_mp_s` | potion | Rend 70 points de mana. | `potion_mp_s` |
| Tonique d'endurance | `potion_stamina` | potion | Rend 60 d'endurance et +30 % de régénération d'endurance pendant 15 s. | `potion_stamina` |
| Potion de soin moyenne | `potion_hp_m` | potion | Rend 140 PV. | `potion_hp_m` |
| Potion de mana moyenne | `potion_mp_m` | potion | Rend 150 points de mana. | `potion_mp_m` |
| Huile venimeuse | `oil_venom` | oil | Arme : les coups empoisonnent (4 % de l'attaque par s pendant 4 s). 10 min. | `oil_venom` |
| Huile consacrée | `oil_blessed` | oil | Arme : +20 % de dégâts contre les morts-vivants (squelettes, spectres, liche). 10 min. | `oil_blessed` |
| Élixir de contrepoison | `elixir_res_poison` | elixir | +25 % de résistance au poison et guérit les poisons. 10 min. | `elixir_res_poison` |
| Grande potion de soin | `potion_hp_l` | potion | Rend 220 PV. | `potion_hp_l` |
| Grande potion de mana | `potion_mp_l` | potion | Rend 260 points de mana. | `potion_mp_l` |
| Grand tonique d'endurance | `potion_stamina_l` | potion | Rend toute l'endurance et +50 % de régénération d'endurance pendant 20 s. | `potion_stamina_l` |
| Élixir ignifuge | `elixir_res_fire` | elixir | +25 % de résistance au feu. 10 min. | `elixir_res_fire` |
| Huile de braise | `oil_ember` | oil | Arme : +8 % des dégâts convertis en feu, qui brûle 3 s. 10 min. | `oil_ember` |
| Élixir de chaleur | `elixir_res_frost` | elixir | +25 % de résistance au givre ; immunité au gel pendant 10 min. | `elixir_res_frost` |
| Huile de givre | `oil_frost` | oil | Arme : +8 % des dégâts convertis en givre, ralentit de 15 %. 10 min. | `oil_frost` |
| Potion de soin suprême | `potion_hp_xl` | potion | Rend 400 PV. | `potion_hp_xl` |
| Élixir de régénération | `elixir_regen` | elixir | Rend 2 % des PV max par seconde pendant 20 s (même en combat). | `elixir_regen` |
| Élixir de garde-âme | `elixir_res_arcane` | elixir | +25 % de résistance aux arcanes et aux ténèbres. 10 min. | `elixir_res_arcane` |
| Huile runique | `oil_rune` | oil | Arme : +8 % des dégâts convertis en arcane et +4 % de critique. 10 min. | `oil_rune` |
| Besace de voyageur | `bag_medium` | bag | +8 cases | `bag_medium` |
| Grand sac en toison | `bag_large` | bag | +12 cases | `bag_large` |
| Sacoche de cuir | `bag_small` | bag | +4 cases | `bag_small` |

### 8.5 Recettes

#### Forge (93)

| Niv. | Recette | Ingrédients | Produit | Revente (po) | Apprise |
|---|---|---|---|---|---|
| 1 | Fondre du cuivre | 2 Minerai de cuivre | `ingot_copper` | — | départ |
| 1 | Épée courte de cuivre | 3 Lingot de cuivre, 1 Lanières de cuir | `shortsword_copper` | 25 | départ |
| 3 | Casque de la milice | 3 Lingot de cuivre, 1 Lanières de cuir | `militia_helm` | 25 | plan `plan_militia` |
| 3 | Cuirasse de la milice | 5 Lingot de cuivre, 2 Lanières de cuir | `militia_chest` | 43 | plan `plan_militia` |
| 3 | Gantelets de la milice | 3 Lingot de cuivre, 1 Lanières de cuir | `militia_gloves` | 25 | plan `plan_militia` |
| 3 | Solerets de la milice | 3 Lingot de cuivre, 1 Lanières de cuir | `militia_boots` | 25 | plan `plan_militia` |
| 3 | Bâton des brumes | 3 Bois de frêne, 1 Lingot de cuivre, 1 Cœur de gluant | `staff_mist` | 22 | maître 19 po |
| 3 | Écu de la milice | 2 Bois de frêne, 2 Lingot de cuivre, 1 Lanières de cuir | `shield_militia` | 20 | maître 19 po |
| 3 | Anneau de cuivre | 2 Lingot de cuivre, 1 Cœur de gluant | `copper_ring` | 26 | maître 19 po |
| 4 | Épée longue de la milice | 4 Lingot de cuivre, 1 Lanières de cuir, 1 Croc de loup | `longsword_militia` | 38 | maître 26 po |
| 4 | Grande épée du garde | 6 Lingot de cuivre, 2 Lanières de cuir, 1 Bois de frêne | `greatsword_warden` | 51 | maître 26 po |
| 5 | Amulette de crocs | 4 Croc de loup, 1 Lanières de cuir, 1 Lingot de cuivre | `amulet_wolf` | 35 | maître 35 po |
| 6 | Fondre du fer | 2 Minerai de fer | `ingot_iron` | — | maître 46 po |
| 6 | Refondre la ferraille de recyclage | 3 Ferraille | `ingot_iron` | — | maître 46 po |
| 7 | Refondre de la ferraille | 3 Ferraille gobeline | `ingot_iron` | — | maître 59 po |
| 7 | Heaume de ferraille | 3 Lingot de fer, 2 Ferraille gobeline, 1 Lanières de cuir | `scrap_helm` | 55 | plan `plan_scrap` |
| 7 | Plastron de ferraille | 5 Lingot de fer, 3 Ferraille gobeline, 2 Lanières de cuir | `chainmail` | 91 | plan `plan_scrap` |
| 7 | Gantelets de ferraille | 3 Lingot de fer, 2 Ferraille gobeline, 1 Lanières de cuir | `scrap_gloves` | 55 | plan `plan_scrap` |
| 7 | Grèves de ferraille | 3 Lingot de fer, 2 Ferraille gobeline, 1 Lanières de cuir | `scrap_boots` | 55 | plan `plan_scrap` |
| 7 | Rapière de l'éclaireur | 3 Lingot de fer, 1 Lanières de cuir, 1 Glande à venin | `rapier_scout` | 55 | maître 59 po |
| 7 | Chevalière gobeline | 3 Babiole gobeline, 1 Lingot de fer | `ring_goblin` | 46 | maître 59 po |
| 8 | Pierre de forge brute | 2 Lingot de cuivre, 1 Éclat de cristal | `forge_stone_rough` | — | maître 74 po |
| 8 | Cimeterre gobelin | 4 Ferraille gobeline, 2 Lingot de fer, 1 Babiole gobeline | `goblin_scimitar` | 61 | maître 74 po |
| 8 | Bâton-totem | 3 Bois de frêne, 2 Plume de totem, 1 Lingot de fer | `staff_totem` | 40 | maître 74 po |
| 8 | Pavois de ferraille | 4 Ferraille gobeline, 2 Lingot de fer, 1 Bois de frêne | `shield_scrap` | 51 | maître 74 po |
| 9 | Épée longue de fer | 4 Lingot de fer, 1 Lanières de cuir, 1 Défense de sanglier | `longsword_iron` | 65 | maître 91 po |
| 9 | Fendoir du sanglier | 6 Lingot de fer, 2 Défense de sanglier, 2 Lanières de cuir | `greatsword_boar` | 104 | maître 91 po |
| 9 | Talisman-totem | 2 Plume de totem, 2 Babiole gobeline, 1 Lingot de fer | `amulet_totem` | 59 | maître 91 po |
| 11 | Refondre des lames ébréchées | 2 Lame ébréchée | `ingot_iron` | — | maître 131 po |
| 12 | Heaume d'os | 3 Os ancien, 2 Lingot de fer, 1 Poussière de tombe | `bone_helm` | 84 | plan `plan_bone` |
| 12 | Cuirasse d'os | 5 Os ancien, 3 Lingot de fer, 2 Poussière de tombe | `bone_chest` | 139 | plan `plan_bone` |
| 12 | Gantelets d'os | 3 Os ancien, 2 Lingot de fer, 1 Poussière de tombe | `bone_gloves` | 84 | plan `plan_bone` |
| 12 | Solerets d'os | 3 Os ancien, 2 Lingot de fer, 1 Poussière de tombe | `bone_boots` | 84 | plan `plan_bone` |
| 12 | Épée bâtarde d'os | 4 Lingot de fer, 2 Os ancien, 1 Lanières de cuir | `bastard_bone` | 88 | maître 154 po |
| 12 | Bouclier d'os | 3 Os ancien, 2 Lingot de fer, 1 Lanières de cuir | `shield_bone` | 78 | maître 154 po |
| 12 | Anneau d'os gravé | 2 Os ancien, 1 Lingot de fer, 1 Éclat de cristal | `ring_bone` | 60 | maître 154 po |
| 13 | Lame courbe du brigand | 3 Lingot de fer, 2 Lame ébréchée, 1 Étoffe de brigand | `curved_bandit` | 67 | maître 179 po |
| 13 | Bâton d'éclats d'âme | 3 Bois de frêne, 1 Éclat d'âme, 2 Voile spectral | `staff_soul` | 61 | maître 179 po |
| 14 | Rapière spectrale | 3 Lingot de fer, 2 Voile spectral, 1 Éclat de cristal | `rapier_wraith` | 82 | maître 206 po |
| 14 | Espadon du fossoyeur | 6 Lingot de fer, 2 Os ancien, 2 Poussière de tombe | `greatsword_gravedigger` | 130 | maître 206 po |
| 14 | Amulette d'os | 2 Os ancien, 1 Éclat d'âme, 1 Lanières de cuir | `amulet_bone` | 66 | maître 206 po |
| 14 | Heaume du Golem ancien | 1 Cœur de golem, 3 Pierre animée, 4 Lingot de fer | `golem_helm` | — | boss_victory |
| 14 | Armure du golem | 2 Cœur de golem, 6 Pierre animée, 8 Lingot de fer | `golem_plate` | — | boss_victory |
| 14 | Gantelets du Golem ancien | 1 Cœur de golem, 3 Pierre animée, 4 Lingot de fer | `golem_gloves` | — | boss_victory |
| 14 | Solerets du Golem ancien | 1 Cœur de golem, 3 Pierre animée, 4 Lingot de fer | `golem_boots` | — | boss_victory |
| 15 | Lame du golem | 1 Cœur de golem, 4 Pierre animée, 6 Lingot de fer, 2 Éclat de cristal | `bastard_golem` | 358 | boss |
| 16 | Pierre de forge taillée | 3 Lingot de fer, 3 Éclat de cristal, 1 Pierre animée | `forge_stone_cut` | — | maître 266 po |
| 17 | Heaume de chitine | 3 Chitine de scorpion, 2 Lingot de fer, 1 Dard de scorpion | `chitin_helm` | 86 | plan `plan_chitin` |
| 17 | Carapace de chitine | 5 Chitine de scorpion, 3 Lingot de fer, 2 Dard de scorpion | `chitin_chest` | 145 | plan `plan_chitin` |
| 17 | Gantelets de chitine | 3 Chitine de scorpion, 2 Lingot de fer, 1 Dard de scorpion | `chitin_gloves` | 86 | plan `plan_chitin` |
| 17 | Grèves de chitine | 3 Chitine de scorpion, 2 Lingot de fer, 1 Dard de scorpion | `chitin_boots` | 86 | plan `plan_chitin` |
| 17 | Cimeterre de Sable-Rouge | 4 Lingot de fer, 1 Dard de scorpion, 2 Chitine de scorpion | `redsand_scimitar` | 98 | maître 299 po |
| 17 | Écu de chitine | 3 Chitine de scorpion, 2 Lingot de fer, 1 Lanières de cuir | `shield_chitin` | 72 | maître 299 po |
| 17 | Anneau au dard | 1 Dard de scorpion, 2 Lingot de fer, 1 Éclat de cristal | `ring_stinger` | 59 | maître 299 po |
| 18 | Rapière au dard | 3 Lingot de fer, 2 Dard de scorpion, 1 Lanières de cuir | `rapier_stinger` | 79 | drop |
| 18 | Bâton de braise | 3 Bois de frêne, 3 Pétale de braise, 1 Éclat de cristal | `staff_ember` | 48 | maître 334 po |
| 19 | Épée longue des tourbières | 5 Lingot de fer, 2 Écaille des marais, 1 Mousse des tourbières | `longsword_bog` | 105 | maître 371 po |
| 19 | Grande lame de chitine | 6 Lingot de fer, 3 Chitine de scorpion, 2 Lanières de cuir | `greatsword_chitin` | 128 | maître 371 po |
| 19 | Amulette des tourbières | 2 Écaille des marais, 2 Mousse des tourbières, 1 Éclat de cristal | `amulet_bog` | 67 | maître 371 po |
| 20 | Fondre du mithril | 2 Minerai de mithril | `ingot_mithril` | — | maître 410 po |
| 20 | Cimeterre du ver | 1 Dent du ver des sables, 5 Écaille de ver des sables, 8 Lingot de fer, 2 Dard de scorpion | `scimitar_wyrm` | 540 | boss |
| 22 | Heaume de givre | 2 Lingot de mithril, 2 Croc de loup de givre, 1 Éclat de cristal | `frost_helm` | 135 | plan `plan_frost` |
| 22 | Cuirasse de givre | 3 Lingot de mithril, 3 Croc de loup de givre, 2 Éclat de cristal | `frost_chest` | 210 | plan `plan_frost` |
| 22 | Gantelets de givre | 2 Lingot de mithril, 2 Croc de loup de givre, 1 Éclat de cristal | `frost_gloves` | 135 | plan `plan_frost` |
| 22 | Solerets de givre | 2 Lingot de mithril, 2 Croc de loup de givre, 1 Éclat de cristal | `frost_boots` | 135 | plan `plan_frost` |
| 22 | Épée longue de givre | 3 Lingot de mithril, 2 Croc de loup de givre, 1 Lanières de cuir | `longsword_frost` | 162 | maître 494 po |
| 22 | Pavois du yéti | 2 Lingot de mithril, 2 Toison de yéti, 1 Corne de yéti | `shield_yeti` | 142 | maître 494 po |
| 22 | Anneau de givre | 1 Lingot de mithril, 1 Croc de loup de givre, 2 Éclat de cristal | `frost_ring` | 90 | maître 494 po |
| 23 | Bâtarde du loup de givre | 4 Lingot de mithril, 2 Croc de loup de givre, 1 Fourrure de givre | `bastard_icewolf` | 214 | drop |
| 23 | Bâton de fleur de givre | 3 Bois de frêne, 3 Fleur de givre, 2 Éclat de cristal | `staff_frost` | 75 | maître 539 po |
| 24 | Lame courbe en corne | 3 Lingot de mithril, 2 Corne de yéti, 1 Lanières de cuir | `curved_horn` | 170 | maître 586 po |
| 24 | Espadon de mithril | 6 Lingot de mithril, 2 Éclat de cristal, 2 Lanières de cuir | `greatsword_mithril` | 266 | maître 586 po |
| 24 | Amulette en corne de yéti | 2 Corne de yéti, 1 Lingot de mithril, 1 Éclat de cristal | `amulet_yeti` | 105 | maître 586 po |
| 24 | Heaume du Géant de givre | 1 Cœur de givre éternel, 4 Lingot de mithril, 2 Éclat de cristal | `frost_giant_helm` | — | boss_victory |
| 24 | Cuirasse du Géant de givre | 2 Cœur de givre éternel, 8 Lingot de mithril, 4 Éclat de cristal | `frost_giant_chest` | — | boss_victory |
| 24 | Gantelets du Géant de givre | 1 Cœur de givre éternel, 4 Lingot de mithril, 2 Éclat de cristal | `frost_giant_gloves` | — | boss_victory |
| 24 | Solerets du Géant de givre | 1 Cœur de givre éternel, 4 Lingot de mithril, 2 Éclat de cristal | `frost_giant_boots` | — | boss_victory |
| 25 | Espadon du géant | 1 Cœur de givre éternel, 8 Lingot de mithril, 4 Croc de loup de givre, 4 Éclat de cristal | `greatsword_giant` | 752 | boss |
| 25 | Pierre ancestrale (marques écarlates) | 4 Marque écarlate, 2 Pierre de forge taillée | `forge_stone_ancestral` | — | maître 400 po |
| 26 | Pierre de forge ancestrale | 3 Lingot de mithril, 5 Éclat de cristal, 1 Fragment runique d'Aldmar | `forge_stone_ancestral` | — | drop |
| 27 | Heaume runique | 3 Lingot de mithril, 1 Fragment runique d'Aldmar, 1 Éclat de cristal | `aldmar_helm` | 189 | plan `plan_aldmar` |
| 27 | Cuirasse runique | 5 Lingot de mithril, 2 Fragment runique d'Aldmar, 2 Éclat de cristal | `aldmar_chest` | 340 | plan `plan_aldmar` |
| 27 | Gantelets runiques | 3 Lingot de mithril, 1 Fragment runique d'Aldmar, 1 Éclat de cristal | `aldmar_gloves` | 189 | plan `plan_aldmar` |
| 27 | Solerets runiques | 3 Lingot de mithril, 1 Fragment runique d'Aldmar, 1 Éclat de cristal | `aldmar_boots` | 189 | plan `plan_aldmar` |
| 27 | Épée runique d'Aldmar | 4 Lingot de mithril, 2 Fragment runique d'Aldmar, 2 Éclat de cristal | `runesword_aldmar` | 302 | drop |
| 27 | Rapière de mithril | 3 Lingot de mithril, 2 Éclat de cristal, 1 Lanières de cuir | `rapier_mithril` | 148 | maître 739 po |
| 27 | Anneau runique | 1 Lingot de mithril, 1 Fragment runique d'Aldmar, 2 Éclat de cristal | `ring_rune` | 128 | maître 739 po |
| 28 | Espadon runique | 7 Lingot de mithril, 2 Fragment runique d'Aldmar, 2 Lanières de cuir | `greatsword_rune` | 394 | drop |
| 28 | Bâton runique | 3 Bois de frêne, 2 Fragment runique d'Aldmar, 2 Éclat d'âme | `staff_rune` | 183 | drop |
| 28 | Rempart d'Aldmar | 4 Lingot de mithril, 1 Fragment runique d'Aldmar, 1 Peau de troll | `shield_aldmar` | 236 | maître 794 po |
| 29 | Épée bâtarde du veilleur | 5 Lingot de mithril, 1 Fragment runique d'Aldmar, 1 Peau de troll | `bastard_watcher` | 274 | drop |
| 29 | Amulette de sang de troll | 2 Sang de troll, 1 Lingot de mithril, 2 Éclat de cristal | `amulet_troll` | 128 | maître 851 po |
| 30 | Épée runique du phylactère | 1 Éclat de phylactère, 6 Fragment runique d'Aldmar, 10 Lingot de mithril, 6 Éclat d'âme | `runesword_phylactery` | 1320 | boss |

#### Alchimie (19)

| Niv. | Recette | Ingrédients | Produit | Revente (po) | Apprise |
|---|---|---|---|---|---|
| 1 | Petite potion de soin | 2 Gelée de gluant, 1 Fiole de verre | `potion_hp_s` | — | départ |
| 2 | Potion de mana | 2 Herbe de brume, 1 Fiole de verre | `potion_mp_s` | — | maître 14 po |
| 4 | Tonique d'endurance | 1 Gelée de gluant, 1 Herbe de brume, 1 Croc de loup, 1 Fiole de verre | `potion_stamina` | — | maître 26 po |
| 7 | Potion de soin moyenne | 3 Gelée de gluant, 2 Herbe de brume, 1 Fiole de verre | `potion_hp_m` | — | maître 59 po |
| 9 | Potion de mana moyenne | 3 Herbe de brume, 1 Plume de totem, 1 Fiole de verre | `potion_mp_m` | — | maître 91 po |
| 9 | Huile venimeuse | 2 Glande à venin, 1 Gelée de gluant, 1 Fiole de verre | `oil_venom` | — | maître 91 po |
| 11 | Huile consacrée | 2 Poussière de tombe, 1 Éclat de cristal, 1 Fiole de verre | `oil_blessed` | — | maître 131 po |
| 12 | Élixir de contrepoison | 1 Glande à venin, 2 Herbe de brume, 1 Fiole de verre | `elixir_res_poison` | — | maître 154 po |
| 14 | Grande potion de soin | 2 Gelée de gluant, 1 Cœur de gluant, 2 Herbe de brume, 1 Fiole de verre | `potion_hp_l` | — | maître 206 po |
| 15 | Grande potion de mana | 3 Herbe de brume, 1 Éclat d'âme, 1 Fiole de verre | `potion_mp_l` ×2 | — | maître 235 po |
| 16 | Grand tonique d'endurance | 2 Mousse des tourbières, 1 Pétale de braise, 1 Fiole de verre | `potion_stamina_l` | — | maître 266 po |
| 17 | Élixir ignifuge | 1 Chitine de scorpion, 2 Mousse des tourbières, 1 Fiole de verre | `elixir_res_fire` | — | maître 299 po |
| 18 | Huile de braise | 3 Pétale de braise, 1 Gelée de gluant, 1 Fiole de verre | `oil_ember` | — | maître 334 po |
| 21 | Élixir de chaleur | 2 Pétale de braise, 1 Croc de loup de givre, 1 Fiole de verre | `elixir_res_frost` | — | maître 451 po |
| 22 | Huile de givre | 3 Fleur de givre, 1 Croc de loup de givre, 1 Fiole de verre | `oil_frost` | — | maître 494 po |
| 25 | Potion de soin suprême | 1 Sang de troll, 2 Fleur de givre, 1 Cœur de gluant, 1 Fiole de verre | `potion_hp_xl` ×2 | — | maître 635 po |
| 27 | Élixir de régénération | 2 Sang de troll, 2 Herbe de brume, 1 Fiole de verre | `elixir_regen` | — | drop |
| 28 | Élixir de garde-âme | 2 Éclat d'âme, 1 Fragment runique d'Aldmar, 1 Fiole de verre | `elixir_res_arcane` | — | drop |
| 29 | Huile runique | 1 Fragment runique d'Aldmar, 2 Éclat de cristal, 2 Fleur de givre, 1 Fiole de verre | `oil_rune` | — | drop |

#### Couture et tannerie (82)

| Niv. | Recette | Ingrédients | Produit | Revente (po) | Apprise |
|---|---|---|---|---|---|
| 1 | Tanner une fourrure de loup | 1 Fourrure de loup | `leather_strip` ×2 | — | départ |
| 1 | Tisser du lin | 2 Toile de lin | `cloth_bolt` | — | départ |
| 1 | Recoudre des chutes de cuir | 2 Chutes de cuir | `leather_strip` | — | départ |
| 1 | Retisser des chutes d'étoffe | 2 Chutes d'étoffe | `cloth_bolt` | — | départ |
| 1 | Arc de frêne | 3 Bois de frêne, 1 Lanières de cuir | `bow_ash` | 7 | départ |
| 3 | Recoller des copeaux | 2 Copeaux de bois précieux | `ash_wood` | — | maître 19 po |
| 3 | Capuchon du guetteur | 2 Rouleau de tissu, 2 Herbe de brume, 1 Gelée de gluant | `mistwatch_helm` | 19 | plan `plan_mistwatch` |
| 3 | Robe du guetteur | 3 Rouleau de tissu, 3 Herbe de brume, 2 Gelée de gluant | `mistwatch_chest` | 30 | plan `plan_mistwatch` |
| 3 | Mitaines du guetteur | 2 Rouleau de tissu, 2 Herbe de brume, 1 Gelée de gluant | `mistwatch_gloves` | 19 | plan `plan_mistwatch` |
| 3 | Sandales du guetteur | 2 Rouleau de tissu, 2 Herbe de brume, 1 Gelée de gluant | `mistwatch_boots` | 19 | plan `plan_mistwatch` |
| 3 | Grimoire du novice | 1 Rouleau de tissu, 1 Lanières de cuir, 2 Gelée de gluant | `tome_novice` | 15 | maître 19 po |
| 4 | Capuche du loup | 3 Fourrure de loup, 1 Croc de loup, 2 Lanières de cuir | `wolf_helm` | 35 | plan `plan_wolf` |
| 4 | Pelisse du loup | 5 Fourrure de loup, 2 Croc de loup, 3 Lanières de cuir | `wolf_chest` | 59 | plan `plan_wolf` |
| 4 | Gants du loup | 3 Fourrure de loup, 1 Croc de loup, 2 Lanières de cuir | `wolf_gloves` | 35 | plan `plan_wolf` |
| 4 | Bottes du loup | 3 Fourrure de loup, 1 Croc de loup, 2 Lanières de cuir | `wolf_boots` | 35 | plan `plan_wolf` |
| 4 | Carquois en peau de loup | 2 Fourrure de loup, 2 Lanières de cuir | `quiver_wolf` | 22 | maître 26 po |
| 5 | Tanner un cuir de sanglier | 1 Cuir de sanglier | `leather_strip` ×3 | — | maître 35 po |
| 5 | Sacoche de cuir | 6 Lanières de cuir, 2 Fourrure de loup | `bag_small` | — | maître 35 po |
| 7 | Tisser de la soie | 3 Soie d'araignée | `cloth_bolt` ×2 | — | maître 59 po |
| 7 | Masque du sanglier | 2 Cuir de sanglier, 1 Défense de sanglier, 2 Lanières de cuir | `boar_helm` | 33 | plan `plan_boar` |
| 7 | Brigandine du sanglier | 3 Cuir de sanglier, 2 Défense de sanglier, 3 Lanières de cuir | `boar_chest` | 54 | plan `plan_boar` |
| 7 | Gants du sanglier | 2 Cuir de sanglier, 1 Défense de sanglier, 2 Lanières de cuir | `boar_gloves` | 33 | plan `plan_boar` |
| 7 | Bottes du sanglier | 2 Cuir de sanglier, 1 Défense de sanglier, 2 Lanières de cuir | `boar_boots` | 33 | plan `plan_boar` |
| 7 | Carquois du chasseur | 2 Cuir de sanglier, 2 Lanières de cuir | `quiver_boar` | 24 | maître 59 po |
| 8 | Arc à corde de soie | 3 Bois de frêne, 3 Soie d'araignée, 1 Défense de sanglier | `bow_silk` | 36 | maître 74 po |
| 9 | Voile de soie | 2 Rouleau de tissu, 2 Soie d'araignée, 1 Glande à venin | `silk_helm` | 38 | plan `plan_silk` |
| 9 | Robe de soie | 3 Rouleau de tissu, 3 Soie d'araignée, 2 Glande à venin | `silk_chest` | 63 | plan `plan_silk` |
| 9 | Gants de soie | 2 Rouleau de tissu, 2 Soie d'araignée, 1 Glande à venin | `silk_gloves` | 38 | plan `plan_silk` |
| 9 | Chaussons de soie | 2 Rouleau de tissu, 2 Soie d'araignée, 1 Glande à venin | `silk_boots` | 38 | plan `plan_silk` |
| 9 | Grimoire de soie | 2 Rouleau de tissu, 1 Lanières de cuir, 1 Glande à venin | `tome_silk` | 26 | maître 91 po |
| 12 | Carquois du fossoyeur | 3 Lanières de cuir, 3 Empenne noire | `quiver_fletch` | 42 | maître 154 po |
| 13 | Capuche du brigand | 2 Étoffe de brigand, 3 Lanières de cuir, 1 Lingot de fer | `bandit_helm` | 45 | plan `plan_bandit` |
| 13 | Gilet du brigand | 3 Étoffe de brigand, 5 Lanières de cuir, 2 Lingot de fer | `bandit_chest` | 76 | plan `plan_bandit` |
| 13 | Gants du brigand | 2 Étoffe de brigand, 3 Lanières de cuir, 1 Lingot de fer | `bandit_gloves` | 45 | plan `plan_bandit` |
| 13 | Bottes du brigand | 2 Étoffe de brigand, 3 Lanières de cuir, 1 Lingot de fer | `bandit_boots` | 45 | plan `plan_bandit` |
| 13 | Arc à empenne noire | 4 Bois de frêne, 3 Empenne noire, 2 Soie d'araignée | `bow_fletch` | 50 | maître 179 po |
| 14 | Capuchon spectral | 2 Rouleau de tissu, 2 Voile spectral, 1 Éclat d'âme | `wraith_helm` | 68 | plan `plan_wraith` |
| 14 | Robe spectrale | 3 Rouleau de tissu, 3 Voile spectral, 2 Éclat d'âme | `wraith_chest` | 117 | plan `plan_wraith` |
| 14 | Gants spectraux | 2 Rouleau de tissu, 2 Voile spectral, 1 Éclat d'âme | `wraith_gloves` | 68 | plan `plan_wraith` |
| 14 | Chaussures spectrales | 2 Rouleau de tissu, 2 Voile spectral, 1 Éclat d'âme | `wraith_boots` | 68 | plan `plan_wraith` |
| 14 | Codex spectral | 2 Rouleau de tissu, 2 Voile spectral, 1 Poussière de tombe | `tome_wraith` | 48 | maître 206 po |
| 14 | Besace de voyageur | 8 Lanières de cuir, 4 Rouleau de tissu, 4 Soie d'araignée | `bag_medium` | — | maître 206 po |
| 17 | Carquois de chitine | 2 Chitine de scorpion, 2 Lanières de cuir | `chitin_quiver` | 36 | maître 299 po |
| 18 | Capuche d'écailles | 3 Écaille des marais, 2 Lanières de cuir, 1 Mousse des tourbières | `lurker_helm` | 62 | plan `plan_lurker` |
| 18 | Brigandine d'écailles | 5 Écaille des marais, 3 Lanières de cuir, 2 Mousse des tourbières | `lurker_chest` | 106 | plan `plan_lurker` |
| 18 | Gants d'écailles | 3 Écaille des marais, 2 Lanières de cuir, 1 Mousse des tourbières | `lurker_gloves` | 62 | plan `plan_lurker` |
| 18 | Bottes d'écailles | 3 Écaille des marais, 2 Lanières de cuir, 1 Mousse des tourbières | `lurker_boots` | 62 | plan `plan_lurker` |
| 18 | Arc des marais | 4 Bois de frêne, 2 Écaille des marais, 2 Soie d'araignée | `bow_bog` | 48 | maître 334 po |
| 19 | Coiffe de la tourbière | 3 Rouleau de tissu, 2 Mousse des tourbières, 1 Pétale de braise | `bog_helm` | 49 | plan `plan_bog` |
| 19 | Robe de la tourbière | 5 Rouleau de tissu, 3 Mousse des tourbières, 2 Pétale de braise | `bog_chest` | 81 | plan `plan_bog` |
| 19 | Gants de la tourbière | 3 Rouleau de tissu, 2 Mousse des tourbières, 1 Pétale de braise | `bog_gloves` | 49 | plan `plan_bog` |
| 19 | Bottines de la tourbière | 3 Rouleau de tissu, 2 Mousse des tourbières, 1 Pétale de braise | `bog_boots` | 49 | plan `plan_bog` |
| 19 | Herbier de la tourbière | 2 Rouleau de tissu, 3 Mousse des tourbières, 1 Pétale de braise | `tome_bog` | 56 | maître 371 po |
| 20 | Grimoire de la sorcière | 1 Œil de la sorcière, 6 Rouleau de tissu, 6 Mousse des tourbières, 2 Éclat d'âme | `tome_hag` | 382 | boss |
| 22 | Carquois de toison | 2 Toison de yéti, 2 Lanières de cuir | `quiver_fleece` | 48 | maître 494 po |
| 23 | Capuche du loup de givre | 3 Fourrure de givre, 1 Croc de loup de givre, 2 Lanières de cuir | `icewolf_helm` | 84 | plan `plan_icewolf` |
| 23 | Pelisse du loup de givre | 5 Fourrure de givre, 2 Croc de loup de givre, 3 Lanières de cuir | `icewolf_chest` | 146 | plan `plan_icewolf` |
| 23 | Gants du loup de givre | 3 Fourrure de givre, 1 Croc de loup de givre, 2 Lanières de cuir | `icewolf_gloves` | 84 | plan `plan_icewolf` |
| 23 | Bottes du loup de givre | 3 Fourrure de givre, 1 Croc de loup de givre, 2 Lanières de cuir | `icewolf_boots` | 84 | plan `plan_icewolf` |
| 23 | Arc en corne de yéti | 2 Corne de yéti, 3 Bois de frêne, 3 Soie d'araignée | `bow_horn` | 79 | drop |
| 24 | Capuchon de toison | 2 Rouleau de tissu, 2 Toison de yéti, 1 Fleur de givre | `fleece_helm` | 64 | plan `plan_fleece` |
| 24 | Mante de toison | 3 Rouleau de tissu, 3 Toison de yéti, 2 Fleur de givre | `fleece_chest` | 103 | plan `plan_fleece` |
| 24 | Moufles de toison | 2 Rouleau de tissu, 2 Toison de yéti, 1 Fleur de givre | `fleece_gloves` | 64 | plan `plan_fleece` |
| 24 | Bottes fourrées | 2 Rouleau de tissu, 2 Toison de yéti, 1 Fleur de givre | `fleece_boots` | 64 | plan `plan_fleece` |
| 24 | Grimoire des neiges | 2 Rouleau de tissu, 2 Fleur de givre, 1 Fourrure de givre | `tome_snow` | 56 | maître 586 po |
| 24 | Grand sac en toison | 6 Toison de yéti, 6 Rouleau de tissu, 6 Lanières de cuir | `bag_large` | — | drop |
| 25 | Tanner une peau de troll | 1 Peau de troll | `leather_strip` ×5 | — | maître 635 po |
| 27 | Carquois en peau de troll | 2 Peau de troll, 2 Lanières de cuir | `quiver_troll` | 56 | maître 739 po |
| 28 | Masque du troll | 2 Peau de troll, 1 Sang de troll, 3 Lanières de cuir | `troll_helm` | 90 | plan `plan_troll` |
| 28 | Brigandine du troll | 3 Peau de troll, 2 Sang de troll, 5 Lanières de cuir | `troll_chest` | 152 | plan `plan_troll` |
| 28 | Gants du troll | 2 Peau de troll, 1 Sang de troll, 3 Lanières de cuir | `troll_gloves` | 90 | plan `plan_troll` |
| 28 | Bottes du troll | 2 Peau de troll, 1 Sang de troll, 3 Lanières de cuir | `troll_boots` | 90 | plan `plan_troll` |
| 28 | Arc runique | 4 Bois de frêne, 2 Fragment runique d'Aldmar, 1 Peau de troll | `bow_rune` | 148 | drop |
| 29 | Capuchon de l'arcaniste | 3 Rouleau de tissu, 1 Fragment runique d'Aldmar, 1 Éclat d'âme | `arcanist_helm` | 105 | plan `plan_arcanist` |
| 29 | Robe de l'arcaniste | 5 Rouleau de tissu, 2 Fragment runique d'Aldmar, 2 Éclat d'âme | `arcanist_chest` | 205 | plan `plan_arcanist` |
| 29 | Gants de l'arcaniste | 3 Rouleau de tissu, 1 Fragment runique d'Aldmar, 1 Éclat d'âme | `arcanist_gloves` | 105 | plan `plan_arcanist` |
| 29 | Souliers de l'arcaniste | 3 Rouleau de tissu, 1 Fragment runique d'Aldmar, 1 Éclat d'âme | `arcanist_boots` | 105 | plan `plan_arcanist` |
| 29 | Grimoire d'Aldmar | 3 Rouleau de tissu, 2 Fragment runique d'Aldmar, 1 Éclat d'âme | `tome_aldmar` | 165 | drop |
| 29 | Couronne du Roi-Liche | 1 Éclat de phylactère, 4 Rouleau de tissu, 3 Éclat d'âme | `lich_helm` | — | boss_victory |
| 29 | Robe du Roi-Liche | 2 Éclat de phylactère, 8 Rouleau de tissu, 6 Éclat d'âme | `lich_chest` | — | boss_victory |
| 29 | Gants du Roi-Liche | 1 Éclat de phylactère, 4 Rouleau de tissu, 3 Éclat d'âme | `lich_gloves` | — | boss_victory |
| 29 | Souliers du Roi-Liche | 1 Éclat de phylactère, 4 Rouleau de tissu, 3 Éclat d'âme | `lich_boots` | — | boss_victory |

## 9. Forge, Retremper, recyclage

- **Amélioration +1 à +10** : +4 % de statistiques de base par niveau ; pierres : Pierre de forge brute (`forge_stone_rough`, +1 à +4), Pierre de forge taillée (`forge_stone_cut`, +5 à +7), Pierre de forge ancestrale (`forge_stone_ancestral`, +8 à +10). Échec : les pierres et l’or sont consommés, l’objet reste intact (jamais détruit, jamais rétrogradé). Chaque échec ajoute +10 % de réussite à la tentative suivante sur ce même objet (affiché).
- **Retremper** : Remplace UN affixe choisi par un nouvel affixe aléatoire (même règles de tirage). Les autres affixes sont conservés. Coût : essence de la rareté de l’objet × 1, 10 po par niveau d'objet ; impossible sur les légendaires et les pièces d'ensemble.
- **Recyclage** : Donne des matériaux selon le type d’objet et une essence selon la rareté. Un objet forgé rend 50 % des pierres dépensées (arrondi inférieur). ; les légendaires ne se recyclent pas. Objet fabriqué (drapeau « crafted ») : 1–2 chutes de son type, ni essence ni pierre (sauf 50 % des pierres de forge dépensées). Sinon, fabriquer un ensemble du loup pour le recycler transformait des fourrures en essences violines. Pièces d'ensemble de butin (Épiques) : 1 essence violine. Pièces d'ensemble fabriquées : règle des objets fabriqués (chutes seulement).

## 10. Décisions de synthèse

1. **Un seul catalogue** : les 194 recettes produisent des ids qui existent tous dans `items.json`
   (bases, consommables) ou `crafting.json` (matériaux). Les 152 objets propres à l'artisanat ont maintenant
   une base calculée avec les formules du butin. Cinq doublons de nom ont été fusionnés (`copper_ring`,
   `goblin_scimitar`, `redsand_scimitar`, `chitin_quiver`, `frost_ring`).
2. **Matériaux définis une seule fois** (`crafting.json › materials`) ; les tables de butin ne donnent que
   `[id, chance, [min, max]]`. Ajout de la **Marque écarlate** (`scarlet_mark`, Champion écarlate et élites de zone
   rouge), échangeable contre une pierre de forge ancestrale.
3. **Paliers des monstres** : ceux de l'artisanat (bandits T3, trolls T6).
4. **Sorts sans focalisateur : −20 %** (règle de l'arbre ; le brouillon objets disait −30 %).
5. **Icônes** : familles Codex CX-12 (`sword_t3`, `helm_plate_t2`…) pour toutes les bases sauf les ids v0.1 (icônes
   existantes) et les légendaires (`uq_<id>`). **Modèles tenus en main** : nommage CX-3 / CX-3b (`eq_<famille>_<n>`),
   champ `model` sur chaque arme et main gauche.
6. **Potions** : recharge commune de 20 s ; potion suprême 520 → 400 PV (équilibrage).
7. **Trois métiers pour tous** (accessibilité), sacs dans 2 emplacements dédiés (+4 / +8 / +12, 48 cases au plus).

### 10 bis. Relecture critique : économie

| Cible | Changement | Pourquoi |
|---|---|---|
| vente des objets fabriqués | valeur des matériaux (recipe.vendorValue) | Revendus avec la formule du butin, les objets fabriqués rapportaient jusqu'à ×7.6 la valeur de leurs matériaux et frais : fabriquer pour le marchand imprimait de l'or. |
| recyclage des objets fabriqués | chutes seulement, ni essence ni pierre | Une Capuche du loup (3 fourrures) rendait 2 fourrures + 1 essence violine : les essences épiques devenaient une ressource de palier 1. |
| récolte | filon grisé par compte | Changer de personnage multipliait la récolte par le nombre de personnages du compte. |

Vérifié sans changement : la forge ne crée rien (pierres et or consommés, 50 % des pierres rendues au recyclage), les
recettes de pierres coûtent plus que la valeur de revente de la pierre, aucune recette ne se fait avec les seuls
matériaux vendus par les marchands, les légendaires ne se recyclent pas, filons partagés en zone rouge (premier arrivé).

## 11. Questions ouvertes

1. Formule de défense `K = 60 + 6 × max(0, niveau − 10)` (sinon les plaques T6 réduisent ~70 % des dégâts) : à simuler.
2. Nombre d'objets : 293 bases, c'est beaucoup pour l'interface ; on peut masquer les familles non-épées de T1
   dans les boutiques. À juger en test.
3. Prix des plans et chances de plans en butin à caler sur le revenu d'or réel de la v0.3.
4. Ensembles de donjon (Géant de givre, Roi-Liche) : seulement boss + artisanat tant que les donjons (v0.4) n'existent pas.
5. Le squelette (niveaux 8–11) est à cheval sur T2 et T3 (seul avertissement de `validate.mjs`).

## Annexe — brouillons

`docs/design/drafts/items.md`, `items.json`, `crafting.md`, `crafting.json` : justifications et tableaux d'origine.
