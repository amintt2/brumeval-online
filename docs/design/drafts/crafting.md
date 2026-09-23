# Artisanat — préconception v0.3 (brouillon)

> Brouillon du concepteur « artisanat ». Données complètes : `docs/design/drafts/crafting.json`
> (`materials`, `monsterDrops`, `nodes`, `professions`, `recipes`, plus `sets`, `plans`, `rules`, `newItemIds`).
> Ce document suit `ROADMAP.md` §1 et §2 bis (butin v2, 6 paliers, 5 raretés, forge +1 à +10, étals du marché, zones rouges).
> Les tableaux en fin de document sont générés à partir du JSON : en cas d'écart, le JSON fait foi.

## 1. Ce que les joueurs ont demandé, et la réponse

| Retour | Réponse de l'artisanat |
|---|---|
| « De l'artisanat, par exemple l'équipement du loup avec le butin du loup, plus d'autres choses pour l'armure » | Chaque monstre lâche 1 à 3 **matériaux à thème**. **Ensemble du loup** = fourrure + crocs + lanières de cuir (§ 9). Il y a 18 ensembles de 4 pièces, un par type d'armure et par palier. |
| « Du gluant pour les potions » | **Gelée de gluant** → Petite potion de soin dès le niveau 1 de l'Alchimie, puis elle entre dans les potions moyennes, grandes et suprêmes (le **cœur de gluant**, plus rare, les renforce). |
| « Plus de mécaniques, que chaque monstre ait un intérêt » | Les 55 matériaux servent tous dans au moins une recette (vérifié par le script). Les monstres de haut niveau lâchent les matériaux des meilleurs objets fabriqués, et les boss ceux des plans de boss. |
| « Beaucoup plus d'épées » | La Forge fabrique **27 épées et espadons** (8 familles : courte, longue, bâtarde, rapière, cimeterre, lame courbe, espadon, épée runique) sur les 6 paliers, dont 4 armes de boss. Elles s'ajoutent aux épées du butin. |
| « On s'équipe vite et il n'y a rien de mieux » | Il y a un objectif d'artisanat à chaque palier. La qualité est aléatoire (un Chef-d'œuvre vaut un Épique), les ensembles ont des bonus à 2 et 4 pièces, et les plans rares tombent en butin. |
| « Simple et accessible » | 3 métiers, tous accessibles à tous. On récolte sans outil. Une recette = une liste d'ingrédients et un bouton *Fabriquer*. Il n'y a pas de sous-composants en cascade (un seul niveau d'affinage : lingot, lanières, tissu). Il n'y a pas de durabilité. |

## 2. Principes

1. **Une seule boucle** : *chasser / récolter → atelier du village → s'équiper ou vendre au marché*.
2. **Tout se lit d'un coup d'œil** : l'infobulle d'un matériau dit **qui le lâche** et **à quoi il sert** (« Utilisé dans : Ensemble du loup, Tonique d'endurance… »).
3. **Pas de piège** : la fabrication n'échoue jamais. Seule la **qualité** varie, et elle ne descend jamais sous Normale.
4. **Fabriqué ≈ butin du même palier, jamais au-dessus d'un légendaire** (§ 7).
5. **Tout s'échange** : les matériaux, les plans et les objets fabriqués se vendent aux étals et s'échangent de joueur à joueur. Aucun objet n'est lié.
6. **Le serveur valide tout** : il vérifie les ingrédients, le niveau du métier, la recette connue, la distance à la station, l'état hors combat et l'or. C'est le serveur qui tire la qualité.

## 3. Matériaux

- On ajoute un nouveau `type: 'material'` à `ITEMS`, avec des piles de 50 (10 pour les matériaux de boss).
- **Les ids v0.1 sont conservés** : `slime_gel`, `wolf_pelt`, `goblin_trinket`, `ancient_bone` et `golem_core` passent de `junk` à `material`, avec les mêmes noms, icônes et prix de revente. Les stocks des joueurs sont donc valorisés sans migration. La migration doit juste tolérer les deux types dans l'inventaire.
- Il y a 6 origines :
  - **monstre** : 1 à 3 matériaux à thème par espèce ;
  - **boss** : 100 % de chances, en quantité ;
  - **récolte** : minerais, cristal, plantes ;
  - **affinage** : lingots, lanières de cuir, rouleaux de tissu ;
  - **PNJ** : fiole, toile de lin, bois de frêne, 2 à 4 po. Ce sont de petits puits d'or qui évitent de devoir récolter du bois ou du sable ;
  - **recyclage** : les chutes définies par `items.json` (`scrap_metal`, `leather_scraps`, `cloth_scraps`, `wood_scraps`). L'artisanat les reconvertit en lingots de fer, lanières, tissu et bois (recettes `r_salvage_*`), ce qui ferme la boucle entre butin inutile et fabrication.
- Chaque matériau appartient à un palier de T1 à T6, affiché par une petite pastille dans l'infobulle.
- Les **élites** (5 %, v0.2) doublent les chances de matériaux. Les **zones rouges** les doublent aussi (+100 %, § 2 bis), et leurs élites ont une table en plus : **fragment runique d'Aldmar** et **éclat de cristal**. Les fragments runiques n'existent qu'en zone rouge, sur les trolls et sur la liche.
- Taux (détail dans `monsterDrops`) :
  - matériau principal : 45 à 55 % ;
  - secondaire : 20 à 40 % ;
  - rare (cœur, éclat d'âme) : 6 à 12 %.

Les **potions** que lâchent les monstres en v0.1 restent. L'artisanat en produit davantage, et moins cher.

## 4. Récolte

| Point de récolte (modèle) | Donne | Palier | Régions | Bonus |
|---|---|---:|---|---|
| Filon de cuivre (`node_copper`) | 2–3 minerais de cuivre | T1 | Plaines d'Émeraude, Prairie du Sud, Forêt des Murmures | éclat de cristal 3 % |
| Filon de fer (`node_iron`) | 2–3 minerais de fer | T2 | Camp gobelin, Cimetière, désert, marais, Aldmar | cristal 5 % |
| Filon de mithril (`node_mithril`) | 1–2 minerais de mithril | T5 | Givreval, Aldmar, zones rouges | cristal 8 % |
| Amas de cristal (`node_crystal`) | 1–2 éclats de cristal | T3 | Antre du Golem, Givreval, Aldmar, zones rouges | — |
| Herbe de brume (`node_herb_brume`) | 2–3 herbes de brume | T1 | plaines, forêt, cimetière, marais | — |
| Pétales de braise (`node_herb_braise`) | 1–3 pétales | T4 | désert de Sable-Rouge, Aldmar | — |
| Fleur de givre (`node_herb_givre`) | 1–3 fleurs | T5 | Pics de Givreval | — |

- **Tout le monde récolte tout**, sans outil ni métier : on maintient **[E] pendant 2 s**, et un coup reçu interrompt la récolte.
- **Filons personnels** : un filon que vous avez récolté est grisé **pour vous seul** pendant 3 min. Personne ne « vole » un filon, et c'est plus simple à coder qu'une ressource partagée.
- **En zone rouge**, les filons sont **partagés** (premier arrivé), mais donnent **le double**. C'est du risque contre récompense.
- Chaque récolte donne 2 XP au métier lié (minerai et cristal pour la Forge, plantes pour l'Alchimie), jusqu'au niveau 10 du métier. Ce petit coup de pouce aide à démarrer.
- Densité suggérée : 6 à 10 points par région et par type, placés près des routes et des camps de monstres, jamais dans le village.

## 5. Les trois métiers

| Métier | Station (modèle v0.2) | Maître (PNJ) | Fabrique |
|---|---|---|---|
| **Forge** | `forge` | Maître Bertram (`npc_blacksmith`) | lingots, épées et espadons, bâtons, boucliers, armures de **plaques**, anneaux et amulettes, **pierres de forge** |
| **Alchimie** | `alchemy_table` | Ysolde l'alchimiste (`npc_alchemist`) | potions de soin, de mana et d'endurance, élixirs de résistance, huiles d'arme |
| **Couture et tannerie** | `workbench` | Maud la tanneuse (modèle à confirmer) | lanières de cuir, rouleaux de tissu, armures de **cuir** et de **tissu**, arcs, carquois, grimoires, **sacs** |

- **Un personnage peut apprendre les trois métiers**, gratuitement, en parlant au maître. Comme pour l'arbre des compétences, il n'y a pas de choix définitif qui piège le joueur. Le temps de montée et le coût des matériaux poussent naturellement à se spécialiser et à échanger.
- Les armes suivent le matériau et non la classe : un mage forgeron fabrique des épées, puisque l'équipement n'est plus réservé à une classe (§ 2 bis).

### 5.1 Progression de 1 à 30

- **XP pour passer au niveau suivant** = 30 + 12 × niveau. Il faut 42 XP pour passer du niveau 1 au 2, et **6 090 XP** au total pour atteindre 30.
- **XP d'une fabrication** = 8 + 2 × niveau de la recette, multiplié selon la couleur de la recette. Les recettes d'affinage donnent 4 XP de base.
- **Couleur** de la recette, selon l'écart entre le niveau du métier et celui de la recette :

  | Couleur | Écart | Multiplicateur d'XP |
  |---|---|---:|
  | orange | < 3 | ×1 |
  | jaune | 3 à 5 | ×0,6 |
  | verte | 6 à 9 | ×0,25 |
  | grise | 10 et plus | ×0 |

- **Découverte** : la première fabrication de chaque recette donne ×3 XP. Varier les recettes rapporte donc plus que d'en répéter une.
- Un joueur qui suit les recettes au plus juste monte à 30 en **80 à 140 fabrications** selon le métier (simulé par le script). En pratique, avec les matériaux à trouver, cela prend autant de temps que la montée du personnage de 1 à 30. Le niveau du métier suit le niveau du personnage sans jamais le bloquer.
- **Paliers de métier** :

  | Niveau | Titre | Avantage |
  |---:|---|---|
  | 1 | Apprenti | recettes de départ |
  | 10 | Compagnon | +5 % de chances de qualité Supérieure, fabrication en série jusqu'à ×20 (×5 avant) |
  | 20 | Maître | +3 % de chances de Chef-d'œuvre, le recyclage rend 1 matériau de plus |
  | 30 | Grand maître | titre affiché (« Grand maître forgeron »…), −25 % de frais de station, et **Retremper** (défini dans `items.json`) à moitié prix sur les objets qu'on a fabriqués soi-même |

- **Règle simple** : une recette de niveau N produit un objet de niveau N, et demande le métier au niveau N.

## 6. Stations et interface

- Il y a une station de chaque métier au **village de Brumeval** (les modèles `forge`, `alchemy_table` et `workbench` sont prévus en vague 1), et une autre série à **Port-Salin**. On utilise une station **à moins de 4 m, hors combat**, en zone sûre.
- **Panneau d'atelier**, ouvert en cliquant sur la station :
  - à gauche, les recettes connues, triées par niveau et filtrables (*Tout / Fabricable maintenant / Armes / Armures / Consommables*) ;
  - à droite, les ingrédients avec « possédé / requis », en vert si c'est complet et en rouge sinon ;
  - un aperçu de l'objet (infobulle de comparaison § 2 bis) avec les **chances de qualité** en clair : « Normale 79 % · Supérieure 18 % · Chef-d'œuvre 3 % » ;
  - une case **Catalyseur** facultative (éclat de cristal) ;
  - les boutons *Fabriquer*, *×5* et *Tout*.
- Pour chaque ingrédient manquant, un bouton **« Chercher au marché »** ouvre les étals filtrés sur ce matériau.
- Une fabrication dure **1,5 s**, avec une barre de progression. Une série s'annule si l'on s'éloigne ou si l'on est attaqué.
- Des **frais de station** en or sont affichés à côté du bouton (§ 10).

## 7. Qualité, affixes et place face au butin

| Qualité | Probabilité de base | Rareté obtenue | Affixes | Stats de base | Consommables |
|---|---:|---|---:|---:|---|
| **Normale** | le reste | Inhabituel (vert) | 1 (la signature) | ×1,05 | quantité normale |
| **Supérieure** | 18 % | Rare (bleu) | 2 | ×1,10 | +1 exemplaire |
| **Chef-d'œuvre** | 3 % | Épique (violet) | 3 | ×1,15 | +2 exemplaires |

Le multiplicateur de stats de base est celui de la rareté obtenue dans `items.json`. Les légendaires sont à ×1,20.

- **Ce qui augmente les chances** :
  - chaque niveau de métier au-dessus de la recette, jusqu'à 10 niveaux : +1,5 % Supérieure et +0,5 % Chef-d'œuvre ;
  - le catalyseur (1 éclat de cristal) : +10 % et +4 % ;
  - Compagnon : +5 % Supérieure ; Maître : +3 % Chef-d'œuvre.
- **Plafonds** : 45 % et 15 %.
- **Tirage** : Chef-d'œuvre d'abord, sinon Supérieure, sinon Normale. Pour les **plans de boss**, la qualité est au moins Supérieure.
- **Affixe signature** : chaque recette garantit une affixe de thème, par exemple Précision pour le loup, Garde pour la milice, Givre pour le Harnois de givre. Les autres affixes sont tirées dans une courte liste propre à la recette (`affixPool`). Le joueur sait donc **ce qu'il vise** : c'est l'avantage de l'artisanat sur le butin, qui est entièrement aléatoire.
- **Valeurs** : les affixes et les stats de base suivent **exactement** les formules du butin (`items.json`, `meta.formulas`), au niveau d'objet de la recette. Le JSON d'artisanat ne donne que la famille (`output.family`, par exemple `epee_longue` ; `output.armor` : `plaques`, `cuir` ou `tissu`) et le niveau d'objet (`output.ilvl`).
- **Face au butin** :
  - un objet Normal vaut un objet Inhabituel lâché au même niveau ;
  - le fabriqué moyen (≈ 20 % de Supérieure) vaut un peu mieux que le butin courant, mais **coûte** des matériaux et de l'or ;
  - un Chef-d'œuvre équivaut à un Épique de butin.
- **Les légendaires restent au-dessus**, et **ne se fabriquent jamais** : base ×1,20, affixes en haut de fourchette et effet unique. Aucune recette ne peut ajouter d'effet légendaire.
- **Ensembles de boss** (`golem_set`, `frost_giant_set`, `lich_set` dans `items.json`) : les **pièces manquantes** se fabriquent avec le matériau unique du boss (cœur de golem, cœur de givre éternel, éclat de phylactère). La recette s'apprend automatiquement à la première victoire sur le boss. Ces pièces sont Épiques, avec des affixes fixes, sans tirage de qualité. Cela évite une malchance sans fin.
- Les **18 séries fabriquées** ont des bonus à 2 et 4 pièces **modestes** (+4 à +10 % d'une stat, puis un petit effet de jeu). Seules les pièces **fabriquées** portent ce bonus. Les mêmes bases tombent aussi en butin, mais sans bonus d'ensemble (règle de `items.json`). Les ensembles de boss et de zone rouge (conception objets) sont Épiques et ont des bonus plus forts.
- **Amélioration à la forge (+1 à +10)** : elle s'applique pareil au butin et au fabriqué. La Forge fabrique les pierres :
  - *Pierre de forge brute* (+1 à +4, niveau 8) ;
  - *taillée* (+5 à +7, niveau 16, demande une Pierre animée du Golem) ;
  - *ancestrale* (+8 à +10, niveau 26, demande un fragment runique).

  Les ids sont `forge_stone_rough`, `forge_stone_cut` et `forge_stone_ancestral`, comme dans `items.json`. Les pierres se trouvent aussi en jeu. Le coût en or, le taux de réussite et Retremper relèvent de `items.json`.
- Les objets Supérieurs et Chefs-d'œuvre portent la mention **« Fabriqué par <nom> »**. C'est une petite fierté et un repère au marché.

## 8. Apprendre les recettes

| Source | Quoi | Exemple |
|---|---|---|
| **Départ** (en apprenant le métier) | 2 à 3 recettes par métier | Forge : Fondre du cuivre, Épée courte de cuivre · Alchimie : Petite potion de soin · Couture : Tanner une fourrure de loup, Tisser du lin, Arc de frêne |
| **Maître du métier (PNJ)** | toutes les recettes de base des paliers T1 à T5 et une partie de T6 | Potion de soin moyenne, 59 po au niveau 7 |
| **Plans d'ensemble** (un objet « Plan : … » ou « Patron : … » apprend **les 4 pièces** d'un coup) | au PNJ jusqu'à T2, puis de plus en plus en **butin** | Plan : Armure d'os ancien, 1,2 % sur les squelettes · Patron : Ensemble du loup de givre, 1 % sur les loups de givre |
| **Butin de monstre** (recettes à l'unité) | quelques armes et élixirs de palier haut | Rapière au dard (scorpion), Élixir de régénération (troll) |
| **Plans de boss** | 1 arme de boss par boss, 20 % de chances par victoire, qualité au moins Supérieure (jamais légendaire) | Lame du golem, Cimeterre du ver, Grimoire de la sorcière, Espadon du géant, Épée runique du phylactère |
| **Victoire sur un boss** | pièces manquantes de l'ensemble du boss | Heaume du Golem ancien : 1 cœur de golem, 3 pierres animées, 4 lingots de fer |

- Prix au PNJ : 10 + niveau² po pour une recette, le double pour un plan d'ensemble. Par exemple 26 po au niveau 4, 235 po au niveau 15 et 851 po au niveau 29.
- Les **plans sont des objets** qui s'échangent et se vendent aux étals. Un joueur chanceux peut vendre un plan rare, ce qui crée un vrai marché.
- On pourrait proposer une petite quête de découverte par maître, « Premier ouvrage » (fabriquer son premier objet), qui rapporte 1 recette de plus et quelques matériaux. C'est facultatif.

## 9. Les deux exemples demandés

**Ensemble du loup** (cuir, niveau 4, plan à 52 po chez Maud la tanneuse, Couture niveau 4)

| Pièce | Ingrédients |
|---|---|
| Capuche du loup | 3 fourrures de loup, 1 croc de loup, 2 lanières de cuir |
| Pelisse du loup | 5 fourrures, 2 crocs, 3 lanières |
| Gants du loup | 3 fourrures, 1 croc, 2 lanières |
| Bottes du loup | 3 fourrures, 1 croc, 2 lanières |

- Les lanières se tannent au même établi : 1 fourrure de loup donne 2 lanières.
- L'ensemble complet demande **≈ 19 fourrures et 5 crocs**, soit environ **40 loups** (15 à 20 min seul, moins en groupe).
- Affixe signature : **Précision**.
- Bonus 2 pièces : +4 % de chances de critique.
- Bonus 4 pièces : **Instinct de meute**, la prochaine attaque dans les 2 s qui suivent une roulade inflige +20 % de dégâts. C'est un bonus soulslike, qui récompense l'esquive réussie.
- Au palier T5, l'**Ensemble du loup de givre** en est la suite logique (4 pièces : +25 % de dégâts de givre).

**Potions de gluant** (Alchimie)

| Niv. | Recette | Ingrédients | Effet |
|---:|---|---|---|
| 1 | Petite potion de soin | 2 gelées de gluant + 1 fiole | 60 PV |
| 7 | Potion de soin moyenne | 3 gelées + 2 herbes de brume + 1 fiole | 140 PV |
| 14 | Grande potion de soin | 2 gelées + **1 cœur de gluant** + 2 herbes + 1 fiole | 220 PV |
| 25 | Potion de soin suprême (×2) | sang de troll + 2 fleurs de givre + cœur de gluant + fiole | 520 PV |

- Le **Tonique d'endurance** (niveau 4 : gelée + herbe de brume + croc de loup) rend 60 d'endurance et accélère sa régénération. C'est la potion « soulslike » par excellence.
- La qualité **Supérieure** donne une potion de plus, **Chef-d'œuvre** deux de plus.
- Une petite potion revient à ≈ 2,4 gluants tués + 2 po de fiole. Elle coûte 10 po chez la marchande, donc fabriquer vaut le coup dès le niveau 1.

## 10. Économie

**Sources d'or liées à l'artisanat** :
- la revente des matériaux au PNJ, à prix bas volontairement : c'est un plancher pour le marché ;
- la vente aux étals entre joueurs.

**Puits d'or** (pour que l'or ne s'accumule pas) :

| Puits | Montant |
|---|---|
| Frais de station, par fabrication | 1 + ⌊niveau² / 12⌋ po : 1 au niveau 1, 9 au niveau 10, 34 au niveau 20, 76 au niveau 30. Consommables et affinage : ÷4. |
| Recettes et plans chez les PNJ | 10 + niveau² po, ×2 pour un plan |
| Ingrédients vendus par les PNJ | fiole 2 po, lin 3 po, bois de frêne 4 po |
| Recyclage | frais de station du niveau de l'objet |
| Taxe des étals | 5 %, déjà prévue |

**Recyclage et Retremper** : les règles sont dans `items.json` (`salvage`, `forge.retemper`), avec des chutes et des essences selon la rareté, et sans recyclage des légendaires. L'artisanat ajoute seulement les recettes de reconversion des chutes (`r_salvage_*`). Le butin inutile devient ainsi une matière première.

**Étals du marché** :
- nouvelle catégorie **Matériaux**, avec des sous-filtres (*Métal, Cuir et tissu, Alchimie, Monstre par palier*) ;
- catégorie **Plans et recettes**, avec le filtre « Je ne la connais pas encore » ;
- les objets fabriqués affichent leur qualité et la mention « Fabriqué par » ;
- l'infobulle d'un matériau au marché indique **son prix de revente au PNJ**, pour éviter les arnaques ;
- plus tard (v0.4), des **commandes** permettraient d'acheter une fabrication en fournissant ses matériaux (hors périmètre ici).

**Zones rouges** :
- matériaux doublés et filons partagés à double rendement ;
- **fragments runiques** exclusifs, nécessaires aux meilleures recettes T6 et à la pierre de forge runique ;
- à la mort en zone rouge, les matériaux du sac tombent avec le reste. C'est le vrai risque de farmer là-bas, et une raison de passer souvent à la **banque**.

## 11. Intégration technique (pour les agents de la vague 2)

- `shared/crafting.js` (nouveau fichier) contient `MATERIALS` (fusionnés dans `ITEMS`), `NODES`, `PROFESSIONS`, `RECIPES`, `CRAFT_SETS`, et les formules pures `profXpToNext(l)`, `craftXp(recipe, profLvl, firstTime)`, `qualityChances(recipe, profLvl, catalyst)`, `rollQuality(chances, r)` et `stationFee(lvl, consumable)`.
  - Le client s'en sert pour l'affichage.
  - Le serveur s'en sert pour faire autorité.
- `MONSTERS[*].drops` : on ajoute les entrées de `monsterDrops` (champ `qty: [min, max]` nouveau, 1 par défaut) de façon additive.
- **Protocole** (additif) :
  - C2S `craft { recipe, qty, catalyst }` ;
  - C2S `gather { node }` ;
  - C2S `learn_recipe { slot }` pour utiliser un plan ;
  - C2S `salvage { slot }` ;
  - S2C `craft_result { item, qty, quality }` ;
  - la liste `nodes` part dans l'état initial, et `node_cd { id, until }` est personnel au joueur.
- **Sauvegarde** : on ajoute `prof: { forge: {lvl, xp}, alchemy: {...}, tailoring: {...} }`, `recipes: string[]` et `bags: [itemId|null, itemId|null]`.
  - Valeurs par défaut dans la migration : métiers non appris et listes vides.
  - Les objets fabriqués sont des instances : `{ id, q: 'normal'|'superior'|'masterwork', ilvl, affixes[], by }`, dans le même format que le butin v2.
- **Sacs** : 2 emplacements de sac. Sacoche +4, Besace +8, Grand sac +12, soit 24 + 24 = 48 cases au maximum.
- **Anti-triche** :
  - le serveur vérifie la distance à la station et à la ressource, et l'état hors combat ;
  - il impose un temps minimal entre deux récoltes (2 s) et entre deux fabrications (1,5 s) ;
  - il appelle `game.security?.flag?.(...)` si les requêtes arrivent trop vite.
- **Icônes** : les matériaux utilisent leur id comme icône (déjà demandées dans CX-2 : `ore_*`, `herb_*`, `ingot_*`, `leather_strip`, `cloth_bolt`, `crystal_shard`, `potion_stamina`, `potion_hp_m`). L'équipement reprend les familles de CX-12 (`sword_tN`, `greatsword_tN`, `helm_leather_tN`…), déjà renseignées dans `output.icon`. **Il manque des icônes** pour les autres matériaux de monstre (≈ 30), les huiles et élixirs, les sacs et les plans (voir la question 3).

## 12. Coordination avec la conception des objets et des armes

Le brouillon `docs/design/drafts/items.json` a été lu et **aligné** :

- **50 ids d'objets en commun** : les pièces des séries fabriquées `<série>_helm|chest|gloves|boots`, avec deux ids v0.1 conservés : `chainmail` pour le torse de ferraille et `golem_plate` pour le Golem. La série et son bonus relèvent de l'artisanat ; la formule de défense et de mana, de `items.json`.
- **Familles d'armes** : `output.family` reprend les ids de `items.json` (`epee_courte`, `epee_longue`, `epee_batarde`, `rapiere`, `cimeterre`, `lame_courbe`, `espadon`, `epee_runique`, `baton`, `arc_court`, `arc_long`, `bouclier`, `grimoire`, `carquois`). Les bijoux et les sacs utilisent `anneau`, `amulette` et `sac`, qui sont des bases et non des familles côté objets.
- **Affixes** : les ids viennent de `items.json` (`feu`, `givre`, `arcane`, `celerite`…).
- **Pierres de forge, recyclage, Retremper** : les ids et les règles viennent de `items.json`.
- **Deux matériaux renommés** pour éviter une collision :
  - `icewolf_fang` (le croc de loup de givre), parce que `frost_fang` est une dague T5 ;
  - `wyrm_tooth` (la dent du ver des sables), parce que `wyrm_fang` est le légendaire du Ver des sables.
- **Ids produits** : le JSON les répartit en `itemIdsSharedWithItemsDraft` (50) et `itemIdsOnlyHere` (124 : armes et bijoux fabriqués, consommables, pierres, sacs, pièces des 8 autres séries). La liste complète est aussi en fin de document. Les armes suivent le schéma `<famille>_<thème>` (`longsword_iron`), les armures `<série>_<pièce>` (`wolf_chest`). Le champ `output.base` (anglais, par exemple `longsword`) est gardé pour les icônes CX-12, et `output.family` sert pour les stats.
- **Consommables v0.1 réutilisés** : `potion_hp_s`, `potion_hp_l`, `potion_mp_s`.

## 13. Questions ouvertes

1. **Trois métiers pour tous** : est-ce trop généreux ? L'autre option est de limiter à 2 métiers par personnage pour forcer l'échange. On a choisi « trois » pour rester accessible.
2. **Niveaux et régions du bestiaire v0.3** : ils sont indicatifs ici (sanglier 4–7, araignée 7–10, bandit 11–15, spectre 12–15, scorpion 15–18, rôdeur 15–19, sorcière 19, ver 20, loup de givre 20–23, yéti 22–25, géant 25, troll 25–29, liche 30). Si la conception du monde les place ailleurs, il faut décaler les paliers des matériaux.
3. **Icônes à ajouter** : ≈ 30 matériaux de monstre, 7 huiles et élixirs, 3 sacs et 1 icône générique de plan. C'est une nouvelle tâche Codex (CX-13 ?) ou une extension de CX-2.
4. **Modèle de la tanneuse** : `npc_merchant` recoloré, ou un nouveau `npc_tanner` à ajouter à `assets-characters` ?
5. **Personnalisation des sacs** : ils prennent des emplacements dédiés (proposé) plutôt que des cases d'inventaire.
6. **Paliers des monstres** : ce brouillon met les **bandits en T3** (niveaux 11 à 15, Ensemble du brigand niveau 13) et les **trolls en T6** (Aldmar, 25 à 29). `items.json` met les bandits en T4 et les trolls en T5. Il faut trancher avec le brouillon du monde ; le décalage ne change que le palier des matériaux concernés.
7. **Armes fabriquées** : 58 armes et objets de main gauche, plus 12 bijoux, propres à l'artisanat s'ajoutent aux armes de butin de `items.json`. Est-ce trop ? On peut garder seulement les épées et les armes de boss si le catalogue devient trop chargé.

## Annexes — tableaux générés depuis `crafting.json`

### Forge

| Niv. | Recette | Sortie | Ingrédients | Apprise | Frais |
|---:|---|---|---|---|---:|
| 1 | Fondre du cuivre | `ingot_copper` | 2 Minerai de cuivre | départ | 1 |
| 1 | Épée courte de cuivre | `shortsword_copper` | 3 Lingot de cuivre, 1 Lanières de cuir | départ | 1 |
| 3 | Bâton des brumes | `staff_mist` | 3 Bois de frêne, 1 Lingot de cuivre, 1 Cœur de gluant | PNJ (19 po) | 1 |
| 3 | Écu de la milice | `shield_militia` | 2 Bois de frêne, 2 Lingot de cuivre, 1 Lanières de cuir | PNJ (19 po) | 1 |
| 3 | Anneau de cuivre | `ring_copper` | 2 Lingot de cuivre, 1 Cœur de gluant | PNJ (19 po) | 1 |
| 4 | Épée longue de la milice | `longsword_militia` | 4 Lingot de cuivre, 1 Lanières de cuir, 1 Croc de loup | PNJ (26 po) | 2 |
| 4 | Grande épée du garde | `greatsword_warden` | 6 Lingot de cuivre, 2 Lanières de cuir, 1 Bois de frêne | PNJ (26 po) | 2 |
| 5 | Amulette de crocs | `amulet_wolf` | 4 Croc de loup, 1 Lanières de cuir, 1 Lingot de cuivre | PNJ (35 po) | 3 |
| 6 | Fondre du fer | `ingot_iron` | 2 Minerai de fer | PNJ (46 po) | 1 |
| 6 | Refondre la ferraille de recyclage | `ingot_iron` | 3 Ferraille | PNJ (46 po) | 1 |
| 7 | Refondre de la ferraille | `ingot_iron` | 3 Ferraille gobeline | PNJ (59 po) | 2 |
| 7 | Rapière de l'éclaireur | `rapier_scout` | 3 Lingot de fer, 1 Lanières de cuir, 1 Glande à venin | PNJ (59 po) | 5 |
| 7 | Chevalière gobeline | `ring_goblin` | 3 Babiole gobeline, 1 Lingot de fer | PNJ (59 po) | 5 |
| 8 | Pierre de forge brute | `forge_stone_rough` | 2 Lingot de cuivre, 1 Éclat de cristal | PNJ (74 po) | 2 |
| 8 | Cimeterre gobelin | `scimitar_goblin` | 4 Ferraille gobeline, 2 Lingot de fer, 1 Babiole gobeline | PNJ (74 po) | 6 |
| 8 | Bâton-totem | `staff_totem` | 3 Bois de frêne, 2 Plume de totem, 1 Lingot de fer | PNJ (74 po) | 6 |
| 8 | Pavois de ferraille | `shield_scrap` | 4 Ferraille gobeline, 2 Lingot de fer, 1 Bois de frêne | PNJ (74 po) | 6 |
| 9 | Épée longue de fer | `longsword_iron` | 4 Lingot de fer, 1 Lanières de cuir, 1 Défense de sanglier | PNJ (91 po) | 7 |
| 9 | Fendoir du sanglier | `greatsword_boar` | 6 Lingot de fer, 2 Défense de sanglier, 2 Lanières de cuir | PNJ (91 po) | 7 |
| 9 | Talisman-totem | `amulet_totem` | 2 Plume de totem, 2 Babiole gobeline, 1 Lingot de fer | PNJ (91 po) | 7 |
| 11 | Refondre des lames ébréchées | `ingot_iron` | 2 Lame ébréchée | PNJ (131 po) | 3 |
| 12 | Épée bâtarde d'os | `bastard_bone` | 4 Lingot de fer, 2 Os ancien, 1 Lanières de cuir | PNJ (154 po) | 13 |
| 12 | Bouclier d'os | `shield_bone` | 3 Os ancien, 2 Lingot de fer, 1 Lanières de cuir | PNJ (154 po) | 13 |
| 12 | Anneau d'os gravé | `ring_bone` | 2 Os ancien, 1 Lingot de fer, 1 Éclat de cristal | PNJ (154 po) | 13 |
| 13 | Lame courbe du brigand | `curved_bandit` | 3 Lingot de fer, 2 Lame ébréchée, 1 Étoffe de brigand | PNJ (179 po) | 15 |
| 13 | Bâton d'éclats d'âme | `staff_soul` | 3 Bois de frêne, 1 Éclat d'âme, 2 Voile spectral | PNJ (179 po) | 15 |
| 14 | Rapière spectrale | `rapier_wraith` | 3 Lingot de fer, 2 Voile spectral, 1 Éclat de cristal | PNJ (206 po) | 17 |
| 14 | Espadon du fossoyeur | `greatsword_gravedigger` | 6 Lingot de fer, 2 Os ancien, 2 Poussière de tombe | PNJ (206 po) | 17 |
| 14 | Amulette d'os | `amulet_bone` | 2 Os ancien, 1 Éclat d'âme, 1 Lanières de cuir | PNJ (206 po) | 17 |
| 14 | Heaume du Golem ancien | `golem_helm` | 1 Cœur de golem, 3 Pierre animée, 4 Lingot de fer | victoire sur Golem ancien | 17 |
| 14 | Armure du golem | `golem_plate` | 2 Cœur de golem, 6 Pierre animée, 8 Lingot de fer | victoire sur Golem ancien | 17 |
| 14 | Gantelets du Golem ancien | `golem_gloves` | 1 Cœur de golem, 3 Pierre animée, 4 Lingot de fer | victoire sur Golem ancien | 17 |
| 14 | Solerets du Golem ancien | `golem_boots` | 1 Cœur de golem, 3 Pierre animée, 4 Lingot de fer | victoire sur Golem ancien | 17 |
| 15 | Lame du golem | `bastard_golem` | 1 Cœur de golem, 4 Pierre animée, 6 Lingot de fer, 2 Éclat de cristal | boss Golem ancien (20 %) | 19 |
| 16 | Pierre de forge taillée | `forge_stone_cut` | 3 Lingot de fer, 3 Éclat de cristal, 1 Pierre animée | PNJ (266 po) | 6 |
| 17 | Cimeterre de Sable-Rouge | `scimitar_sands` | 4 Lingot de fer, 1 Dard de scorpion, 2 Chitine de scorpion | PNJ (299 po) | 25 |
| 17 | Écu de chitine | `shield_chitin` | 3 Chitine de scorpion, 2 Lingot de fer, 1 Lanières de cuir | PNJ (299 po) | 25 |
| 17 | Anneau au dard | `ring_stinger` | 1 Dard de scorpion, 2 Lingot de fer, 1 Éclat de cristal | PNJ (299 po) | 25 |
| 18 | Rapière au dard | `rapier_stinger` | 3 Lingot de fer, 2 Dard de scorpion, 1 Lanières de cuir | butin scorpion (1 %) | 28 |
| 18 | Bâton de braise | `staff_ember` | 3 Bois de frêne, 3 Pétale de braise, 1 Éclat de cristal | PNJ (334 po) | 28 |
| 19 | Épée longue des tourbières | `longsword_bog` | 5 Lingot de fer, 2 Écaille des marais, 1 Mousse des tourbières | PNJ (371 po) | 31 |
| 19 | Grande lame de chitine | `greatsword_chitin` | 6 Lingot de fer, 3 Chitine de scorpion, 2 Lanières de cuir | PNJ (371 po) | 31 |
| 19 | Amulette des tourbières | `amulet_bog` | 2 Écaille des marais, 2 Mousse des tourbières, 1 Éclat de cristal | PNJ (371 po) | 31 |
| 20 | Fondre du mithril | `ingot_mithril` | 2 Minerai de mithril | PNJ (410 po) | 9 |
| 20 | Cimeterre du ver | `scimitar_wyrm` | 1 Dent du ver des sables, 5 Écaille de ver des sables, 8 Lingot de fer, 2 Dard de scorpion | boss Ver des sables (20 %) | 34 |
| 22 | Épée longue de givre | `longsword_frost` | 3 Lingot de mithril, 2 Croc de loup de givre, 1 Lanières de cuir | PNJ (494 po) | 41 |
| 22 | Pavois du yéti | `shield_yeti` | 2 Lingot de mithril, 2 Toison de yéti, 1 Corne de yéti | PNJ (494 po) | 41 |
| 22 | Anneau de givre | `ring_frost` | 1 Lingot de mithril, 1 Croc de loup de givre, 2 Éclat de cristal | PNJ (494 po) | 41 |
| 23 | Bâtarde du loup de givre | `bastard_icewolf` | 4 Lingot de mithril, 2 Croc de loup de givre, 1 Fourrure de givre | butin loup de givre (1 %) | 45 |
| 23 | Bâton de fleur de givre | `staff_frost` | 3 Bois de frêne, 3 Fleur de givre, 2 Éclat de cristal | PNJ (539 po) | 45 |
| 24 | Lame courbe en corne | `curved_horn` | 3 Lingot de mithril, 2 Corne de yéti, 1 Lanières de cuir | PNJ (586 po) | 49 |
| 24 | Espadon de mithril | `greatsword_mithril` | 6 Lingot de mithril, 2 Éclat de cristal, 2 Lanières de cuir | PNJ (586 po) | 49 |
| 24 | Amulette en corne de yéti | `amulet_yeti` | 2 Corne de yéti, 1 Lingot de mithril, 1 Éclat de cristal | PNJ (586 po) | 49 |
| 24 | Heaume du Géant de givre | `frost_giant_helm` | 1 Cœur de givre éternel, 4 Lingot de mithril, 2 Éclat de cristal | victoire sur Géant de givre | 49 |
| 24 | Cuirasse du Géant de givre | `frost_giant_chest` | 2 Cœur de givre éternel, 8 Lingot de mithril, 4 Éclat de cristal | victoire sur Géant de givre | 49 |
| 24 | Gantelets du Géant de givre | `frost_giant_gloves` | 1 Cœur de givre éternel, 4 Lingot de mithril, 2 Éclat de cristal | victoire sur Géant de givre | 49 |
| 24 | Solerets du Géant de givre | `frost_giant_boots` | 1 Cœur de givre éternel, 4 Lingot de mithril, 2 Éclat de cristal | victoire sur Géant de givre | 49 |
| 25 | Espadon du géant | `greatsword_giant` | 1 Cœur de givre éternel, 8 Lingot de mithril, 4 Croc de loup de givre, 4 Éclat de cristal | boss Géant de givre (20 %) | 53 |
| 26 | Pierre de forge ancestrale | `forge_stone_ancestral` | 3 Lingot de mithril, 5 Éclat de cristal, 1 Fragment runique d'Aldmar | butin troll / élite de zone rouge (1 %) | 15 |
| 27 | Épée runique d'Aldmar | `runesword_aldmar` | 4 Lingot de mithril, 2 Fragment runique d'Aldmar, 2 Éclat de cristal | butin élite de zone rouge (1 %) | 61 |
| 27 | Rapière de mithril | `rapier_mithril` | 3 Lingot de mithril, 2 Éclat de cristal, 1 Lanières de cuir | PNJ (739 po) | 61 |
| 27 | Anneau runique | `ring_rune` | 1 Lingot de mithril, 1 Fragment runique d'Aldmar, 2 Éclat de cristal | PNJ (739 po) | 61 |
| 28 | Espadon runique | `greatsword_rune` | 7 Lingot de mithril, 2 Fragment runique d'Aldmar, 2 Lanières de cuir | butin élite de zone rouge (1 %) | 66 |
| 28 | Bâton runique | `staff_rune` | 3 Bois de frêne, 2 Fragment runique d'Aldmar, 2 Éclat d'âme | butin élite de zone rouge (1 %) | 66 |
| 28 | Rempart d'Aldmar | `shield_aldmar` | 4 Lingot de mithril, 1 Fragment runique d'Aldmar, 1 Peau de troll | PNJ (794 po) | 66 |
| 29 | Épée bâtarde du veilleur | `bastard_watcher` | 5 Lingot de mithril, 1 Fragment runique d'Aldmar, 1 Peau de troll | butin troll (1 %) | 71 |
| 29 | Amulette de sang de troll | `amulet_troll` | 2 Sang de troll, 1 Lingot de mithril, 2 Éclat de cristal | PNJ (851 po) | 71 |
| 30 | Épée runique du phylactère | `runesword_phylactery` | 1 Éclat de phylactère, 6 Fragment runique d'Aldmar, 10 Lingot de mithril, 6 Éclat d'âme | boss Liche (20 %) | 76 |

### Alchimie

| Niv. | Recette | Sortie | Ingrédients | Apprise | Frais |
|---:|---|---|---|---|---:|
| 1 | Petite potion de soin | `potion_hp_s` | 2 Gelée de gluant, 1 Fiole de verre | départ | 1 |
| 2 | Potion de mana | `potion_mp_s` | 2 Herbe de brume, 1 Fiole de verre | PNJ (14 po) | 1 |
| 4 | Tonique d'endurance | `potion_stamina` | 1 Gelée de gluant, 1 Herbe de brume, 1 Croc de loup, 1 Fiole de verre | PNJ (26 po) | 1 |
| 7 | Potion de soin moyenne | `potion_hp_m` | 3 Gelée de gluant, 2 Herbe de brume, 1 Fiole de verre | PNJ (59 po) | 2 |
| 9 | Potion de mana moyenne | `potion_mp_m` | 3 Herbe de brume, 1 Plume de totem, 1 Fiole de verre | PNJ (91 po) | 2 |
| 9 | Huile venimeuse | `oil_venom` | 2 Glande à venin, 1 Gelée de gluant, 1 Fiole de verre | PNJ (91 po) | 2 |
| 11 | Huile consacrée | `oil_blessed` | 2 Poussière de tombe, 1 Éclat de cristal, 1 Fiole de verre | PNJ (131 po) | 3 |
| 12 | Élixir de contrepoison | `elixir_res_poison` | 1 Glande à venin, 2 Herbe de brume, 1 Fiole de verre | PNJ (154 po) | 4 |
| 14 | Grande potion de soin | `potion_hp_l` | 2 Gelée de gluant, 1 Cœur de gluant, 2 Herbe de brume, 1 Fiole de verre | PNJ (206 po) | 5 |
| 15 | Grande potion de mana | `potion_mp_l` ×2 | 3 Herbe de brume, 1 Éclat d'âme, 1 Fiole de verre | PNJ (235 po) | 5 |
| 16 | Grand tonique d'endurance | `potion_stamina_l` | 2 Mousse des tourbières, 1 Pétale de braise, 1 Fiole de verre | PNJ (266 po) | 6 |
| 17 | Élixir ignifuge | `elixir_res_fire` | 1 Chitine de scorpion, 2 Mousse des tourbières, 1 Fiole de verre | PNJ (299 po) | 7 |
| 18 | Huile de braise | `oil_ember` | 3 Pétale de braise, 1 Gelée de gluant, 1 Fiole de verre | PNJ (334 po) | 7 |
| 21 | Élixir de chaleur | `elixir_res_frost` | 2 Pétale de braise, 1 Croc de loup de givre, 1 Fiole de verre | PNJ (451 po) | 10 |
| 22 | Huile de givre | `oil_frost` | 3 Fleur de givre, 1 Croc de loup de givre, 1 Fiole de verre | PNJ (494 po) | 11 |
| 25 | Potion de soin suprême | `potion_hp_xl` ×2 | 1 Sang de troll, 2 Fleur de givre, 1 Cœur de gluant, 1 Fiole de verre | PNJ (635 po) | 14 |
| 27 | Élixir de régénération | `elixir_regen` | 2 Sang de troll, 2 Herbe de brume, 1 Fiole de verre | butin troll (2 %) | 16 |
| 28 | Élixir de garde-âme | `elixir_res_arcane` | 2 Éclat d'âme, 1 Fragment runique d'Aldmar, 1 Fiole de verre | butin Liche / élite de zone rouge (2 %) | 17 |
| 29 | Huile runique | `oil_rune` | 1 Fragment runique d'Aldmar, 2 Éclat de cristal, 2 Fleur de givre, 1 Fiole de verre | butin élite de zone rouge (2 %) | 18 |

### Couture et tannerie

| Niv. | Recette | Sortie | Ingrédients | Apprise | Frais |
|---:|---|---|---|---|---:|
| 1 | Tanner une fourrure de loup | `leather_strip` ×2 | 1 Fourrure de loup | départ | 1 |
| 1 | Tisser du lin | `cloth_bolt` | 2 Toile de lin | départ | 1 |
| 1 | Recoudre des chutes de cuir | `leather_strip` | 2 Chutes de cuir | départ | 1 |
| 1 | Retisser des chutes d'étoffe | `cloth_bolt` | 2 Chutes d'étoffe | départ | 1 |
| 1 | Arc de frêne | `bow_ash` | 3 Bois de frêne, 1 Lanières de cuir | départ | 1 |
| 3 | Recoller des copeaux | `ash_wood` | 2 Copeaux de bois précieux | PNJ (19 po) | 1 |
| 3 | Grimoire du novice | `tome_novice` | 1 Rouleau de tissu, 1 Lanières de cuir, 2 Gelée de gluant | PNJ (19 po) | 1 |
| 4 | Carquois en peau de loup | `quiver_wolf` | 2 Fourrure de loup, 2 Lanières de cuir | PNJ (26 po) | 2 |
| 5 | Tanner un cuir de sanglier | `leather_strip` ×3 | 1 Cuir de sanglier | PNJ (35 po) | 1 |
| 5 | Sacoche de cuir | `bag_small` | 6 Lanières de cuir, 2 Fourrure de loup | PNJ (35 po) | 1 |
| 7 | Tisser de la soie | `cloth_bolt` ×2 | 3 Soie d'araignée | PNJ (59 po) | 2 |
| 7 | Carquois du chasseur | `quiver_boar` | 2 Cuir de sanglier, 2 Lanières de cuir | PNJ (59 po) | 5 |
| 8 | Arc à corde de soie | `bow_silk` | 3 Bois de frêne, 3 Soie d'araignée, 1 Défense de sanglier | PNJ (74 po) | 6 |
| 9 | Grimoire de soie | `tome_silk` | 2 Rouleau de tissu, 1 Lanières de cuir, 1 Glande à venin | PNJ (91 po) | 7 |
| 12 | Carquois du fossoyeur | `quiver_fletch` | 3 Lanières de cuir, 3 Empenne noire | PNJ (154 po) | 13 |
| 13 | Arc à empenne noire | `bow_fletch` | 4 Bois de frêne, 3 Empenne noire, 2 Soie d'araignée | PNJ (179 po) | 15 |
| 14 | Codex spectral | `tome_wraith` | 2 Rouleau de tissu, 2 Voile spectral, 1 Poussière de tombe | PNJ (206 po) | 17 |
| 14 | Besace de voyageur | `bag_medium` | 8 Lanières de cuir, 4 Rouleau de tissu, 4 Soie d'araignée | PNJ (206 po) | 5 |
| 17 | Carquois de chitine | `quiver_chitin` | 2 Chitine de scorpion, 2 Lanières de cuir | PNJ (299 po) | 25 |
| 18 | Arc des marais | `bow_bog` | 4 Bois de frêne, 2 Écaille des marais, 2 Soie d'araignée | PNJ (334 po) | 28 |
| 19 | Herbier de la tourbière | `tome_bog` | 2 Rouleau de tissu, 3 Mousse des tourbières, 1 Pétale de braise | PNJ (371 po) | 31 |
| 20 | Grimoire de la sorcière | `tome_hag` | 1 Œil de la sorcière, 6 Rouleau de tissu, 6 Mousse des tourbières, 2 Éclat d'âme | boss Sorcière des marais (20 %) | 34 |
| 22 | Carquois de toison | `quiver_fleece` | 2 Toison de yéti, 2 Lanières de cuir | PNJ (494 po) | 41 |
| 23 | Arc en corne de yéti | `bow_horn` | 2 Corne de yéti, 3 Bois de frêne, 3 Soie d'araignée | butin yéti (1 %) | 45 |
| 24 | Grimoire des neiges | `tome_snow` | 2 Rouleau de tissu, 2 Fleur de givre, 1 Fourrure de givre | PNJ (586 po) | 49 |
| 24 | Grand sac en toison | `bag_large` | 6 Toison de yéti, 6 Rouleau de tissu, 6 Lanières de cuir | butin yéti (1 %) | 13 |
| 25 | Tanner une peau de troll | `leather_strip` ×5 | 1 Peau de troll | PNJ (635 po) | 14 |
| 27 | Carquois en peau de troll | `quiver_troll` | 2 Peau de troll, 2 Lanières de cuir | PNJ (739 po) | 61 |
| 28 | Arc runique | `bow_rune` | 4 Bois de frêne, 2 Fragment runique d'Aldmar, 1 Peau de troll | butin élite de zone rouge (1 %) | 66 |
| 29 | Grimoire d'Aldmar | `tome_aldmar` | 3 Rouleau de tissu, 2 Fragment runique d'Aldmar, 1 Éclat d'âme | butin Liche / élite de zone rouge (1 %) | 71 |
| 29 | Couronne du Roi-Liche | `lich_helm` | 1 Éclat de phylactère, 4 Rouleau de tissu, 3 Éclat d'âme | victoire sur Liche | 71 |
| 29 | Robe du Roi-Liche | `lich_chest` | 2 Éclat de phylactère, 8 Rouleau de tissu, 6 Éclat d'âme | victoire sur Liche | 71 |
| 29 | Gants du Roi-Liche | `lich_gloves` | 1 Éclat de phylactère, 4 Rouleau de tissu, 3 Éclat d'âme | victoire sur Liche | 71 |
| 29 | Souliers du Roi-Liche | `lich_boots` | 1 Éclat de phylactère, 4 Rouleau de tissu, 3 Éclat d'âme | victoire sur Liche | 71 |

### Ensembles

| Niv. | Ensemble | Métier | Pièces (casque · torse · mains · pieds) | Ingrédients du casque | Plan | 2 pièces | 4 pièces |
|---:|---|---|---|---|---|---|---|
| 3 | **Ensemble de la milice** (plaques) | Forge | Casque de la milice · Cuirasse de la milice · Gantelets de la milice · Solerets de la milice | 3 Lingot de cuivre, 1 Lanières de cuir | PNJ (38 po) | +5 % de PV max. | Tenir la ligne : bloquer avec la Garde coûte 20 % d'endurance en moins. |
| 4 | **Ensemble du loup** (cuir) | Couture et tannerie | Capuche du loup · Pelisse du loup · Gants du loup · Bottes du loup | 3 Fourrure de loup, 1 Croc de loup, 2 Lanières de cuir | PNJ (52 po) | +4 % de chances de critique. | Instinct de meute : après une roulade, la prochaine attaque dans les 2 s inflige +20 % de dégâts. |
| 3 | **Tenue du guetteur des brumes** (tissu) | Couture et tannerie | Capuchon du guetteur · Robe du guetteur · Mitaines du guetteur · Sandales du guetteur | 2 Rouleau de tissu, 2 Herbe de brume, 1 Gelée de gluant | PNJ (38 po) | +8 % de mana max. | Voile de brume : sous 30 % de PV, votre prochaine roulade laisse un nuage qui réduit de 20 % les dégâts subis pendant 3 s (une fois par minute). |
| 7 | **Harnois de ferraille gobeline** (plaques) | Forge | Heaume de ferraille · Plastron de ferraille · Gantelets de ferraille · Grèves de ferraille | 3 Lingot de fer, 2 Ferraille gobeline, 1 Lanières de cuir | PNJ (118 po) | +5 % de défense. | Rafistolé : chaque coup reçu rend 1 % des PV max (au plus une fois par seconde). |
| 7 | **Ensemble du sanglier** (cuir) | Couture et tannerie | Masque du sanglier · Brigandine du sanglier · Gants du sanglier · Bottes du sanglier | 2 Cuir de sanglier, 1 Défense de sanglier, 2 Lanières de cuir | PNJ (118 po) | +10 % d'équilibre (on titube moins). | Charge : la première attaque après 1 s de sprint inflige +40 % de dégâts d'équilibre (poise). |
| 9 | **Tenue de soie tisse-venin** (tissu) | Couture et tannerie | Voile de soie · Robe de soie · Gants de soie · Chaussons de soie | 2 Rouleau de tissu, 2 Soie d'araignée, 1 Glande à venin | PNJ (182 po) | +10 % de résistance au poison. | Toile : vos sorts ont 10 % de chances d'engluer la cible (ralentie de 30 % pendant 2 s). |
| 12 | **Armure d'os ancien** (plaques) | Forge | Heaume d'os · Cuirasse d'os · Gantelets d'os · Solerets d'os | 3 Os ancien, 2 Lingot de fer, 1 Poussière de tombe | butin squelette / archer squelette (1.2 %) | +15 % de dégâts contre les morts-vivants. | Ossature : toutes les 20 s, la première attaque télégraphiée qui vous touche est réduite de 30 %. |
| 13 | **Ensemble du brigand** (cuir) | Couture et tannerie | Capuche du brigand · Gilet du brigand · Gants du brigand · Bottes du brigand | 2 Étoffe de brigand, 3 Lanières de cuir, 1 Lingot de fer | butin bandit (1.2 %) | +5 % de vitesse d'attaque. | Coup bas : +15 % de chances de critique en frappant un ennemi dans le dos. |
| 14 | **Tenue spectrale** (tissu) | Couture et tannerie | Capuchon spectral · Robe spectrale · Gants spectraux · Chaussures spectrales | 2 Rouleau de tissu, 2 Voile spectral, 1 Éclat d'âme | PNJ (412 po) | +8 % de dégâts d'arcane. | Évanescence : l'invulnérabilité de la roulade dure 0,1 s de plus. |
| 17 | **Carapace du désert** (plaques) | Forge | Heaume de chitine · Carapace de chitine · Gantelets de chitine · Grèves de chitine | 3 Chitine de scorpion, 2 Lingot de fer, 1 Dard de scorpion | butin scorpion (1 %) | +10 % de résistance au feu. | Épines : renvoie 10 % des dégâts de mêlée subis à l'attaquant. |
| 18 | **Ensemble du rôdeur des marais** (cuir) | Couture et tannerie | Capuche d'écailles · Brigandine d'écailles · Gants d'écailles · Bottes d'écailles | 3 Écaille des marais, 2 Lanières de cuir, 1 Mousse des tourbières | PNJ (668 po) | +10 % de régénération d'endurance. | Amphibie : le sprint coûte 25 % d'endurance en moins et la boue ne vous ralentit plus. |
| 19 | **Atours de la tourbière** (tissu) | Couture et tannerie | Coiffe de la tourbière · Robe de la tourbière · Gants de la tourbière · Bottines de la tourbière | 3 Rouleau de tissu, 2 Mousse des tourbières, 1 Pétale de braise | butin rôdeur des marais / Sorcière des marais (1 %) | +10 % de régénération de mana. | Miasmes : vos sorts de zone laissent une flaque toxique pendant 3 s. |
| 22 | **Harnois de givre** (plaques) | Forge | Heaume de givre · Cuirasse de givre · Gantelets de givre · Solerets de givre | 2 Lingot de mithril, 2 Croc de loup de givre, 1 Éclat de cristal | PNJ (988 po) | +10 % de résistance au givre. | Cœur gelé : subir un coup critique gèle l'attaquant 1 s (une fois toutes les 15 s). |
| 23 | **Ensemble du loup de givre** (cuir) | Couture et tannerie | Capuche du loup de givre · Pelisse du loup de givre · Gants du loup de givre · Bottes du loup de givre | 3 Fourrure de givre, 1 Croc de loup de givre, 2 Lanières de cuir | butin loup de givre (1 %) | +5 % de chances de critique. | Meute blanche : après une roulade, la prochaine attaque dans les 2 s inflige +25 % de dégâts sous forme de givre. |
| 24 | **Mantes de toison** (tissu) | Couture et tannerie | Capuchon de toison · Mante de toison · Moufles de toison · Bottes fourrées | 2 Rouleau de tissu, 2 Toison de yéti, 1 Fleur de givre | butin yéti (1 %) | +8 % de dégâts de givre. | Blizzard intérieur : les compétences de givre coûtent 15 % de mana en moins. |
| 27 | **Harnois runique d'Aldmar** (plaques) | Forge | Heaume runique · Cuirasse runique · Gantelets runiques · Solerets runiques | 3 Lingot de mithril, 1 Fragment runique d'Aldmar, 1 Éclat de cristal | butin élite de zone rouge (1 %) | +8 % de défense. | Rune de garde : bloquer une attaque avec la Garde rend 10 d'endurance. |
| 28 | **Ensemble du troll** (cuir) | Couture et tannerie | Masque du troll · Brigandine du troll · Gants du troll · Bottes du troll | 2 Peau de troll, 1 Sang de troll, 3 Lanières de cuir | butin troll (1 %) | +8 % de PV max. | Chair de troll : sous 40 % de PV, régénère 1 % des PV max par seconde, même en combat. |
| 29 | **Tenue de l'arcaniste d'Aldmar** (tissu) | Couture et tannerie | Capuchon de l'arcaniste · Robe de l'arcaniste · Gants de l'arcaniste · Souliers de l'arcaniste | 3 Rouleau de tissu, 1 Fragment runique d'Aldmar, 1 Éclat d'âme | butin Liche / élite de zone rouge (1 %) | +8 % de dégâts d'arcane. | Surcharge runique : toutes les 5 compétences lancées, la suivante ne coûte pas de mana. |

### Matériaux

| Id | Nom | Palier | Origine |
|---|---|---:|---|
| `slime_gel` | Gelée de gluant | T1 | gluant 55 % (1–2) · *id v0.1* |
| `slime_core` | Cœur de gluant | T1 | gluant 6 % |
| `wolf_pelt` | Fourrure de loup | T1 | loup gris 50 % · *id v0.1* |
| `wolf_fang` | Croc de loup | T1 | loup gris 30 % (1–2) |
| `boar_hide` | Cuir de sanglier | T2 | sanglier 50 % |
| `boar_tusk` | Défense de sanglier | T2 | sanglier 25 % |
| `goblin_trinket` | Babiole gobeline | T2 | gobelin 40 %, chaman gobelin 30 % · *id v0.1* |
| `goblin_scrap` | Ferraille gobeline | T2 | gobelin 35 % (1–2) |
| `totem_feather` | Plume de totem | T2 | chaman gobelin 45 % |
| `spider_silk` | Soie d'araignée | T2 | araignée 55 % (1–2) |
| `venom_gland` | Glande à venin | T2 | araignée 25 % |
| `ancient_bone` | Os ancien | T3 | squelette 45 %, archer squelette 35 % · *id v0.1* |
| `grave_dust` | Poussière de tombe | T3 | squelette 30 % (1–2), archer squelette 20 % |
| `black_fletching` | Empenne noire | T3 | archer squelette 40 % (1–2) |
| `wraith_veil` | Voile spectral | T3 | spectre 50 % |
| `soul_shard` | Éclat d'âme | T3 | spectre 12 %, Sorcière des marais 50 % (1–2), Liche 100 % (3–5) |
| `bandit_cloth` | Étoffe de brigand | T3 | bandit 50 % (1–2) |
| `chipped_blade` | Lame ébréchée | T3 | bandit 30 % |
| `golem_core` | Cœur de golem | T3 | Golem ancien 100 % · *id v0.1* |
| `golem_stone` | Pierre animée | T3 | Golem ancien 100 % (3–5) |
| `scorpion_chitin` | Chitine de scorpion | T4 | scorpion 50 % (1–2), Ver des sables 100 % (2–4) |
| `scorpion_stinger` | Dard de scorpion | T4 | scorpion 25 % |
| `lurker_scale` | Écaille des marais | T4 | rôdeur des marais 50 % (1–2) |
| `bog_moss` | Mousse des tourbières | T4 | rôdeur des marais 40 % (1–2), Sorcière des marais 100 % (3–5) |
| `hag_eye` | Œil de la sorcière | T4 | Sorcière des marais 100 % |
| `wyrm_scale` | Écaille de ver des sables | T4 | Ver des sables 100 % (4–6) |
| `wyrm_tooth` | Dent du ver des sables | T4 | Ver des sables 60 % |
| `frost_pelt` | Fourrure de givre | T5 | loup de givre 50 % |
| `icewolf_fang` | Croc de loup de givre | T5 | loup de givre 30 % (1–2), Géant de givre 100 % (2–3) |
| `yeti_fur` | Toison de yéti | T5 | yéti 55 % (1–2) |
| `yeti_horn` | Corne de yéti | T5 | yéti 20 % |
| `frost_heart` | Cœur de givre éternel | T5 | Géant de givre 100 % |
| `troll_hide` | Peau de troll | T6 | troll 50 % |
| `troll_blood` | Sang de troll | T6 | troll 25 % |
| `rune_shard` | Fragment runique d'Aldmar | T6 | troll 8 %, Liche 100 % (2–4), élite de zone rouge 25 % (1–2) |
| `phylactery_shard` | Éclat de phylactère | T6 | Liche 100 % |
| `ore_copper` | Minerai de cuivre | T1 | récolte |
| `ore_iron` | Minerai de fer | T2 | récolte |
| `ore_mithril` | Minerai de mithril | T5 | récolte |
| `crystal_shard` | Éclat de cristal | T3 | récolte, Golem ancien 50 % (2–3), Géant de givre 100 % (3–5), élite de zone rouge 30 % (1–2) |
| `herb_brume` | Herbe de brume | T1 | récolte |
| `herb_braise` | Pétale de braise | T4 | récolte |
| `herb_givre` | Fleur de givre | T5 | récolte |
| `ingot_copper` | Lingot de cuivre | T1 | affinage |
| `ingot_iron` | Lingot de fer | T2 | affinage |
| `ingot_mithril` | Lingot de mithril | T5 | affinage |
| `leather_strip` | Lanières de cuir | T1 | affinage |
| `cloth_bolt` | Rouleau de tissu | T1 | affinage |
| `scrap_metal` | Ferraille | T1 | recyclage (items.json) |
| `leather_scraps` | Chutes de cuir | T1 | recyclage (items.json) |
| `cloth_scraps` | Chutes d'étoffe | T1 | recyclage (items.json) |
| `wood_scraps` | Copeaux de bois précieux | T1 | recyclage (items.json) |
| `vial` | Fiole de verre | T1 | PNJ 2 po |
| `linen` | Toile de lin | T1 | PNJ 3 po |
| `ash_wood` | Bois de frêne | T1 | PNJ 4 po |

### Ids d'objets produits

**Déjà définis dans `items.json`** (50) : `militia_helm`, `militia_chest`, `militia_gloves`, `militia_boots`, `wolf_helm`, `wolf_chest`, `wolf_gloves`, `wolf_boots`, `mistwatch_helm`, `mistwatch_chest`, `mistwatch_gloves`, `mistwatch_boots`, `scrap_helm`, `scrap_gloves`, `scrap_boots`, `boar_helm`, `boar_chest`, `boar_gloves`, `boar_boots`, `bandit_helm`, `bandit_chest`, `bandit_gloves`, `bandit_boots`, `chitin_helm`, `chitin_chest`, `chitin_gloves`, `chitin_boots`, `lurker_helm`, `lurker_chest`, `lurker_gloves`, `lurker_boots`, `icewolf_helm`, `icewolf_chest`, `icewolf_gloves`, `icewolf_boots`, `fleece_helm`, `fleece_chest`, `fleece_gloves`, `fleece_boots`, `golem_helm`, `golem_gloves`, `golem_boots`, `frost_giant_helm`, `frost_giant_chest`, `frost_giant_gloves`, `frost_giant_boots`, `lich_helm`, `lich_chest`, `lich_gloves`, `lich_boots`

**Propres à l'artisanat, à ajouter au catalogue** (124) : `forge_stone_rough`, `forge_stone_cut`, `forge_stone_ancestral`, `potion_stamina`, `potion_hp_m`, `potion_mp_m`, `oil_venom`, `oil_blessed`, `elixir_res_poison`, `potion_mp_l`, `potion_stamina_l`, `elixir_res_fire`, `oil_ember`, `elixir_res_frost`, `oil_frost`, `potion_hp_xl`, `elixir_regen`, `elixir_res_arcane`, `oil_rune`, `silk_helm`, `silk_chest`, `silk_gloves`, `silk_boots`, `bone_helm`, `bone_chest`, `bone_gloves`, `bone_boots`, `wraith_helm`, `wraith_chest`, `wraith_gloves`, `wraith_boots`, `bog_helm`, `bog_chest`, `bog_gloves`, `bog_boots`, `frost_helm`, `frost_chest`, `frost_gloves`, `frost_boots`, `aldmar_helm`, `aldmar_chest`, `aldmar_gloves`, `aldmar_boots`, `troll_helm`, `troll_chest`, `troll_gloves`, `troll_boots`, `arcanist_helm`, `arcanist_chest`, `arcanist_gloves`, `arcanist_boots`, `shortsword_copper`, `longsword_militia`, `greatsword_warden`, `staff_mist`, `shield_militia`, `ring_copper`, `amulet_wolf`, `bow_ash`, `quiver_wolf`, `tome_novice`, `rapier_scout`, `scimitar_goblin`, `longsword_iron`, `greatsword_boar`, `staff_totem`, `shield_scrap`, `ring_goblin`, `amulet_totem`, `bow_silk`, `quiver_boar`, `tome_silk`, `bastard_bone`, `curved_bandit`, `rapier_wraith`, `greatsword_gravedigger`, `staff_soul`, `shield_bone`, `ring_bone`, `amulet_bone`, `bow_fletch`, `quiver_fletch`, `tome_wraith`, `bag_medium`, `scimitar_sands`, `rapier_stinger`, `longsword_bog`, `greatsword_chitin`, `staff_ember`, `shield_chitin`, `ring_stinger`, `amulet_bog`, `bow_bog`, `quiver_chitin`, `tome_bog`, `longsword_frost`, `bastard_icewolf`, `curved_horn`, `greatsword_mithril`, `staff_frost`, `shield_yeti`, `ring_frost`, `amulet_yeti`, `bow_horn`, `quiver_fleece`, `tome_snow`, `bag_large`, `runesword_aldmar`, `rapier_mithril`, `bastard_watcher`, `greatsword_rune`, `staff_rune`, `shield_aldmar`, `ring_rune`, `amulet_troll`, `bow_rune`, `quiver_troll`, `tome_aldmar`, `bag_small`, `bastard_golem`, `tome_hag`, `scimitar_wyrm`, `greatsword_giant`, `runesword_phylactery`
