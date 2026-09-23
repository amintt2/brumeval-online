# Contenu du monde v0.3 — brouillon

> **Statut** : brouillon de conception (agent « contenu du monde »). Données complètes et lisibles par machine dans
> `docs/world/drafts/content.json` (17 régions, 99 lieux nommés, 17 nouveaux monstres, 8 boss, 8 donjons, trame,
> collectible, zones rouges, déplacements, difficulté).
> **Coordination** : aucun brouillon `docs/world/drafts/carto.*` n'existait au moment de l'écriture. Les **ids de
> région** et les **classes d'altitude** (§ 2) sont donc définis ici ; le cartographe peut les renommer ou les
> déplacer, il suffit de garder la correspondance d'ids. Coordonnées en mètres, **nord = −Z**, monde de **4 × 4 km**
> (x et z dans [−2000, 2000]), comme le demande `ROADMAP.md` § 2.

## 0. En bref

- La demande : un monde ouvert **très grand et très varié** façon Zelda, avec le **désert à palmiers en bas à gauche**,
  un côté prairie, un côté mer, un côté forêt, et des nuages volumétriques. Plus la **typologie des hauteurs** : chaque
  région reçoit une classe d'altitude et un type de relief (§ 2), qui décident de ce qu'on y fait (belvédères, neige,
  vol plané plus tard, embuscades).
- **Le Val de Brumeval garde la carte actuelle** (360 × 360 m) **aux mêmes coordonnées**. Les positions sauvegardées
  des joueurs restent valides, et le Golem reste le premier jalon (niv. 14).
- **La progression part du centre** et monte vers les bords : 1–8 au centre, 15–21 sur la ceinture (marais, côte,
  désert), 20–25 en Givreval, 24–30 à Aldmar et Cendremont.
- **La trame principale** : la Brume-Noire suinte des ruines d'Aldmar. Quatre **Sceaux** gardés par quatre boss
  corrompus (Sorcière, Ver, Géant, Brasier-Mère) se font **dans l'ordre qu'on veut**, puis le Roi-Liche. C'est la
  structure « quatre régions, un château » des grands mondes ouverts, avec nos noms et notre histoire.
- **Collectible** : les **Brumillons** (238), petits esprits de brume cachés derrière des micro-énigmes, échangés à
  l'Arbre-Brume contre de la place de sac et de banque.

## 1. Ce qu'on retient des images de référence (sans rien copier)

| Réf. | Ce qu'on prend | Où chez nous |
|---|---|---|
| 1 (carte du monde) | Une quinzaine de régions **lisibles de loin** : chacune a une couleur, un relief et une silhouette. Désert + hauts plateaux au sud-ouest, grandes plaines au centre, grande forêt au nord, volcan au nord-est, neige au nord-ouest, marais à l'est, côtes au sud et à l'est, rivières qui descendent vers la mer. | Toute la disposition (§ 3) |
| 2 (prairie, ruines, grand monstre) | Un **géant endormi** au milieu d'un champ ouvert : on le voit de loin, on choisit de le réveiller. | Colosse des Stèles |
| 3 (prairie dorée d'automne) | Herbes hautes dorées, arbres roux, grand ciel. | Prairies Dorées |
| 4 (champ de ruines dorées, pierre lumineuse) | Ruines dans l'herbe dorée, **stèle qui luit** = aimant visuel qui raconte l'histoire. | Plaine des Stèles |
| 5 (ville du désert, palmiers, cascades) | Une ville nichée dans un canyon **avec de l'eau** au milieu du sable : le contraste. | Ambrefont |
| 6 (char à voile sur les dunes) | Un **déplacement propre au biome** : rapide, joyeux, seulement sur le sable. | Char à voile (v0.4) |
| 7 (bois perdus dans la brume) | Brouillard qui réduit la vue, **suivre des lanternes** pour ne pas être ramené au départ. | Bois des Égarés |
| 8 (forêt luxuriante, rayons) | Rayons de lumière dans le feuillage, mousse, clairières lumineuses. | Grande Forêt des Murmures |
| 9, 10 (plages tropicales) | Eau turquoise, sable clair, palmiers, îles à gué. | Côte des Salins, Archipel de l'Écume |

Direction artistique inchangée : la **matière et la lumière** d'*Elden Ring* (PBR cuit, brume, lumière volumétrique),
avec la **variété et les biomes lumineux** de Zelda. Chaque région a donc une **lumière signature** (colonne
« ambiance » du JSON) pour que `render-souls` règle le brouillard, le ciel IBL et la couleur du soleil par région.

## 2. Typologie des hauteurs

L'altitude est comptée depuis le niveau de la mer (0 m). Les valeurs sont indicatives : c'est la **carte
topographique du cartographe** qui fait foi. Le jeu actuel a un terrain de −5 à +40 m ; le Val de Brumeval se pose
donc comme une **cuvette à 10–30 m**, et le reste du monde s'élève autour.

| Classe | Nom | Altitude | Ce qu'on y fait |
|---|---|---|---|
| **A0** | Fonds | −40 à 0 m | Mer, lagons, lits de lac. Eau profonde non praticable en v0.3 ; gués ≤ 0,8 m praticables. |
| **A1** | Littoral et berges | 0 à 8 m | Plages, deltas, pilotis. Brume basse le matin, marées visuelles (coffres à marée basse). |
| **A2** | Basses terres | 8 à 40 m | Plaines, prairies, fonds de vallée. Grand ciel, herbe au vent, routes principales, monture. |
| **A3** | Collines et bois | 40 à 120 m | Relief ondulé, forêts, landes. Lignes de vue coupées : embuscades et découvertes. |
| **A4** | Plateaux et mesas | 120 à 250 m | Dessus plats ceinturés de falaises (`cliff_a`, `cliff_b`), accès par 2 à 4 rampes. Belvédères, futur vol plané. |
| **A5** | Montagne | 250 à 500 m | Pentes raides, éboulis, cols. Au-dessus de 350 m en Givreval : neige au sol et « Froid mordant ». |
| **A6** | Hauts sommets | 500 à 750 m | Pics de Givreval (≈ 680 m), cône de Cendremont (≈ 720 m). Seulement par des chemins balisés. |

**Types de relief** : cuvette · plaine · vallonné · plateau · mesa · canyon · falaise côtière · dunes · delta ·
massif · cône volcanique · archipel (définitions dans le JSON, `reliefTypes`).

**Règles de jeu liées à la hauteur**
- **Belvédères** : chaque région a au moins un point en A4 ou plus (tour, souche, statue, mesa) qui révèle la région
  sur la carte (brouillard de guerre, touche M).
- **Lisibilité** : plus on monte, plus on s'éloigne du centre, plus c'est dangereux. Le relief raconte la progression.
- **Pente** : au-delà de 45° le terrain n'est pas praticable (le serveur le refuse, comme l'eau profonde). Les
  falaises A4 sont donc de vrais murs, ouverts seulement par des rampes. C'est ce qui canalise les joueurs vers les
  gardiens et les points d'intérêt.
- **Froid et chaleur** : au-dessus de 350 m en Givreval, perte lente d'endurance max sans soupe ni feu de camp ; à
  Cendremont, pareil sans résistance au feu. Effets doux et affichés, jamais mortels.
- **Plus tard** : le vol plané (v0.5) part des classes A4 et plus ; la distance planée dépend de la hauteur.

| Région | Classe | Min / typique / max | Relief |
|---|---|---|---|
| Val de Brumeval | A2 | 6 / 20 / 70 | cuvette, vallonné |
| Prairies Dorées | A2 | 10 / 25 / 55 | plaine, vallonné |
| Lac de Verre-Lune | A1 | −12 / 8 / 60 | cuvette, delta |
| Grande Forêt des Murmures | A3 | 30 / 70 / 140 | vallonné |
| Plaine des Stèles | A2 | 15 / 35 / 80 | plaine, vallonné |
| Marches du Couchant | A3 | 50 / 110 / 220 | vallonné, plateau |
| Bois des Égarés | A3 | 60 / 110 / 180 | vallonné |
| Gorges de la Faille-Rouge | A4 | 40 / 140 / 230 | canyon, plateau |
| Marais de Brumenoire | A1 | −3 / 4 / 30 | delta, plaine |
| Côte des Salins | A1 | −20 / 5 / 60 | falaise côtière, plaine |
| Archipel de l'Écume | A1 | −30 / 6 / 90 | archipel |
| Falaises des Embruns | A4 | 0 / 90 / 160 | falaise côtière, plateau |
| Désert de Sable-Rouge | A2 | 10 / 35 / 90 | dunes, mesa |
| Hauts-Plateaux Ocres | A4 | 120 / 220 / 420 | mesa, plateau |
| Pics de Givreval | A5 | 180 / 380 / 680 | massif |
| Ruines d'Aldmar | A4 | 120 / 180 / 260 | plateau |
| Cendremont | A6 | 120 / 350 / 720 | cône volcanique |

## 3. Disposition et courbe de niveaux

```
            OUEST (−X)                                                        EST (+X)
 NORD  ┌──────────────────────────────────────────────────────────────────────────────┐
 (−Z)  │  PICS DE GIVREVAL        BOIS DES          RUINES           CENDREMONT         │
       │  20–25  A5               ÉGARÉS 12–16      D'ALDMAR         26–30  A6  ROUGE   │
       │  Géant de givre          (Arbre-Brume)     24–29 A4 ROUGE   Brasier-Mère       │
       │                                                                                │
       │  MARCHES DU COUCHANT      GRANDE FORÊT DES MURMURES          MARAIS DE          │
       │  11–15  A3                6–12  A3                           BRUMENOIRE 15–19   │
       │                                            PLAINE DES        Sorcière           │
       │                           VAL DE BRUMEVAL  STÈLES 9–14                         │
       │  HAUTS-PLATEAUX OCRES     1–8 (+Golem 14)  (Colosse)          FALAISES DES      │
       │  19–23  A4                                                   EMBRUNS 17–21 A4   │
       │                 LAC DE VERRE-LUNE   PRAIRIES DORÉES                             │
       │  GORGES DE LA   6–11  A1            4–9  A2                                     │
       │  FAILLE-ROUGE                                                                  │
       │  14–18 A4        DÉSERT DE          CÔTE DES SALINS            ARCHIPEL DE      │
       │                  SABLE-ROUGE        15–19 (Port-Salin)         L'ÉCUME 19–23    │
 SUD   │                  16–21 (Ver)        ~~~~~~~~ mer ~~~~~~~~      Roi-Carapace     │
 (+Z)  └──────────────────────────────────────────────────────────────────────────────┘
```

- Rivières : la **Brumeline** descend de Givreval, traverse le Val (pont existant) et le Lac de Verre-Lune, puis
  rejoint la mer au sud. La **Salise** descend de Cendremont, traverse le marais et se jette dans la mer de l'Est.
- L'**Arbre-Brume** (CX-10, ≈ 120 m) se dresse au cœur du Bois des Égarés (−650, −1320). On le voit de toute la
  carte : c'est la boussole du joueur.
- Paliers d'objets (items.md) : T1 Val et prairies · T2 forêt, lac, Stèles · T3 Marches, Bois des Égarés, Gorges ·
  T4 marais, désert, côte, Embruns · T5 Givreval, Hauts-Plateaux · T6 Aldmar, Cendremont.

## 4. Les régions

Chaque région a dans le JSON : centre et rayon, niveaux, palier, sécurité, altitude, relief, météo pondérée, ambiance,
monstres (clé, niveaux, archétype), mini-boss, boss mondial, villes et services, lieux nommés (6 en moyenne), points de
récolte, nombre de Brumillons, déplacements et quêtes. Résumé :

| Région (id) | Niv. | Monstres | Mini-boss / boss | Ville, services | Temps forts |
|---|---|---|---|---|---|
| Val de Brumeval (`val_brumeval`) | 1–8 | gluant, loup, sanglier, gobelin, chaman, squelette | Gluant-Roi 4, Chef Gorgrat 9 / **Golem 14** | **Brumeval** : forge, alchimie, couture, étals, banque, auberge, Maître des arts, arène | Moulin, tour de guet, Mine de Cuivrefond (v0.4) |
| Prairies Dorées (`prairies_dorees`) | 4–9 | sanglier, loup, bandit, gluant doré | Vieille-Hure 9 | Relais des Épis : alchimie, auberge | Cercle des Sept Menhirs (énigme d'ombres à midi), meules des bandits |
| Lac de Verre-Lune (`lac_verrelune`) | 6–11 | gluant d'eau, araignée, crapaud-buffle*, bandit | Mère-Crapaud 11 | Hameau des Saules : alchimie | Temple englouti (donjon v0.4), cascade et grotte derrière |
| Grande Forêt des Murmures (`grande_foret`) | 6–12 | loup, araignée, sanglier, gobelin, chaman | Croc-Pâle 11, La Tisseuse 12 | Poste de la Veilleuse : couture | Souche du Géant (belvédère intérieur), Source aux Lucioles (la nuit) |
| Plaine des Stèles (`plaine_steles`) | 9–14 | squelette, archer squelette, spectre (la nuit), sanglier | **Colosse des Stèles 14** (troll endormi) | — | Grande Stèle d'Aldmar (chapitre III), caveau aux braseros |
| Marches du Couchant (`marches_couchant`) | 11–15 | bandit, archer brigand*, loup, gobelin | Maraude la Borgne 15 | Fort du Couchant : forge | Tour des Quatre-Vents, repaire sur plateau, arène JcJ secondaire |
| Bois des Égarés (`bois_egares`) | 12–16 | spectre, écorcier*, feu-brume*, araignée | L'Écorce-Mère 16 | Sanctuaire de l'Arbre-Brume : échange des Brumillons | **Arbre-Brume**, Sentier des Lanternes, Racines (donjon v0.4) |
| Gorges de la Faille-Rouge (`gorges_faille`) | 14–18 | scorpion, varan*, bandit, harpie* | Gardien de la Faille 18 (golem de grès) | — | Pont suspendu gardé, fresques d'Aldmar, corniches à sauts |
| Marais de Brumenoire (`marais_brumenoire`) | 15–19 | rôdeur des marais, araignée, spectre, chaman vasard, crapaud | Le Noyeur 18 / **Sorcière des marais 19** | Pilotis : alchimie, guérisseuse | Passerelles qui s'effondrent, mares aux feux |
| Côte des Salins (`cote_salins`) | 15–19 | crabe*, pillard*, harponneur*, contrebandier | Capitaine Sel-Amer 19 | **Port-Salin** : 2ᵉ ville complète | Phare, lagon turquoise, épave à marée basse, Grotte des Contrebandiers (v0.4) |
| Falaises des Embruns (`cote_embruns`) | 17–21 | harpie, crabe, bandit, troll (rare) | Reine des Harpies 21 | — | Aire au bord du vide, crique par l'escalier de falaise |
| Désert de Sable-Rouge (`desert_sablerouge`) | 16–21 | scorpion, dessiccé*, pillard des dunes*, varan | Scorpion-Empereur 20 / **Ver des sables 20** | **Ambrefont** (ville à cascades) : forge, alchimie, étals, auberge | Oasis des Sept-Palmes, temple aux miroirs, Palais-Mirage (visible à midi) |
| Hauts-Plateaux Ocres (`hauts_ocres`) | 19–23 | harpie, troll, loup de givre, varan | Troll des Mesas 23 | Camp des Vents : couture | Ponts de corde entre mesas, Mesa du Guetteur |
| Archipel de l'Écume (`archipel_ecume`) | 19–23 | crabe, pillard, harponneur, serpenteau* | Amiral Crève-Voile 23 / **Roi-Carapace 23*** | — | Banc de sable du Passeur (à gué), **zone rouge** des Naufrageurs |
| Pics de Givreval (`pics_givreval`) | 20–25 | loup de givre, yéti, troll, spectre gelé | Crinière-de-Givre 24 / **Géant de givre 24** | Refuge : forge, auberge | **Grotte gelée** (v0.4), lac gelé qui craque, Col des Aurores |
| Ruines d'Aldmar (`plateau_aldmar`) | 24–29 | chevalier squelette, archer, spectre, troll, golem gardien | Sénéchal Vorn 28 / **Champion écarlate 30*** | — | Grandes Portes, **Crypte d'Aldmar** (Roi-Liche, v0.4), **zone rouge** du Cœur |
| Cendremont (`cendremont`) | 26–30 | salamandre*, golem de lave*, troll, braisillon* | Forgeron des Cendres 29 / **Brasier-Mère 30*** | Camp de la Cendre : forge, banque de campagne | Caldeira, fumerolles, **zone rouge** sur tout le cône |

\* = nouveau monstre proposé (§ 5).

**Densité des lieux** : un point d'intérêt tous les **150 à 250 m** de marche. Les 99 lieux **nommés** du JSON sont
l'ossature (6 par région en moyenne). On complète avec des **gabarits génériques** placés par la génération du monde
jusqu'à la bonne densité (≈ 12 à 20 par région) :
- petit camp de monstres + coffre (commun) ;
- ruine mineure (`ruins_pillar`, `ruins_wall`) + Brumillon ;
- coffre caché (derrière une cascade, sous un pont, en haut d'un rocher) ;
- point de vue avec banc (révèle 150 m de brouillard) ;
- feu de camp de voyageur (PNJ errant, rumeur qui pointe vers un lieu nommé) ;
- groupe de filons (3 à 5 points de récolte du biome).

## 5. Nouveaux monstres (compléments de biome)

Ils complètent le bestiaire v0.3 (sanglier, araignée, scorpion, loup de givre, yéti, rôdeur des marais, troll, chaman
gobelin, archer squelette, bandit, spectre ; boss liche, sorcière, géant, ver). **La moitié réutilise un rig
existant** pour limiter le coût Blender.

| Clé | Nom | Archétype | Niv. | Régions | Idée de combat | Modèle |
|---|---|---|---|---|---|---|
| `toad_brute` | Crapaud-buffle | brute | 8–18 | lac, marais | Saut écrasant (cercle), langue qui attire | nouveau |
| `treant` | Écorcier | brute | 13–16 | Bois des Égarés | Racines en ligne, faible au feu | nouveau |
| `wisp` | Feu-Brume | distance | 12–15 | Bois des Égarés | Se téléporte, tire des orbes | petit mesh émissif + VFX |
| `bandit_archer` | Archer brigand | distance | 12–17 | Marches, Gorges | Couvre les brigands de mêlée | variante bandit |
| `rift_lizard` | Varan des failles | fonceur | 14–21 | Gorges, désert, mesas | Charge en zigzag | rig loup |
| `harpy` | Harpie des mesas | distance | 16–23 | Gorges, Embruns, mesas | Plumes en éventail, piqué en ligne ; vole bas (≤ 4 m) pour rester touchable | nouveau |
| `husk` | Dessiccé | brute | 17–21 | désert | Sort du sable (préfigure l'onde du Ver) | rig humanoïde |
| `bandit_desert` | Pillard des dunes | fonceur | 16–20 | désert | Cimeterre, jet de sable | variante bandit |
| `crab` | Crabe-Rocher | brute | 15–22 | côtes, archipel | Dos blindé : on apprend à contourner | nouveau |
| `pirate` | Pillard des Salins | fonceur | 16–23 | côte, archipel | Abordage, barils explosifs | variante bandit |
| `pirate_harpooner` | Harponneur | distance | 16–23 | côte, archipel | Harpon qui attire (esquivable) | variante bandit |
| `sea_serpent_whelp` | Serpenteau des récifs | distance | 21–23 | archipel | Immobile dans l'eau, crache en arc | nouveau (simple) |
| `salamander` | Salamandre de braise | lanceur de sorts | 26–30 | Cendremont | Crachat de feu, flaques persistantes | nouveau |
| `magma_golem` | Golem de lave | brute | 27–30 | Cendremont | Marteau, lave au sol | rig golem, matériaux émissifs |
| `ember_wisp` | Braisillon | distance | 26–29 | Cendremont | Variante rouge du Feu-Brume | variante wisp |
| `crab_king` | **Le Roi-Carapace** (boss) | boss | 23 | archipel | Carapace à briser, vagues en anneau | rig crabe × 4 |
| `ember_matriarch` | **La Brasier-Mère** (boss) | boss | 30 | Cendremont | Souffle en cône, pluie de lave, caldeira qui se remplit | rig salamandre × 5 |

À ajouter à ROADMAP § 4.5 (vague suivante) : `toad_brute`, `treant`, `harpy`, `crab`, `salamander` (vrais nouveaux
modèles), puis les variantes. Les matériaux de butin proposés (écaille de varan, plumes de harpie, carapace,
obsidienne…) sont à reprendre par le brouillon d'artisanat.

## 6. Boss et jalons (dur mais juste)

| Jalon | Boss | Niv. | Où | Rôle |
|---|---|---:|---|---|
| 1 | Golem ancien | 14 | Antre du Golem (Val) | Fin de l'apprentissage (existant) |
| 2 | Sorcière des marais **ou** Ver des sables | 19–20 | Marais / désert | Premiers Sceaux |
| — | Roi-Carapace | 23 | Archipel | Boss mondial annoncé, optionnel |
| 3 | Géant de givre | 24 | Givreval | Sceau de Givre |
| 4 | Brasier-Mère | 30 | Cendremont (zone rouge) | Sceau de Braise, en groupe |
| Fin | Roi-Liche d'Aldmar | 30 | Crypte d'Aldmar (donjon) | Fin de la trame |
| Fin | Champion écarlate | 30 | Arène Écarlate (zone rouge) | Fin de jeu JcJ/JcE (proposé dans items.md) |

**Courbe de difficulté**
- 1–8 : un seul télégraphe par monstre, monstres seuls ou par deux.
- 8–15 : groupes de 3 avec un tireur, premiers enchaînements de 2 coups.
- 15–22 : le terrain compte (eau qui ralentit, bords de falaise), lanceurs de sorts et brutes mélangés, élites plus
  fréquentes.
- 22–30 : enchaînements de 3 coups, feintes, zones rouges, boss à 3 phases.

**Règles d'équité**
- Toujours une pierre de passage et un feu de repos avant une arène de boss.
- Un **voile de brume** à l'entrée des arènes : on sait qu'on entre, et l'écho de mort tombe devant le voile.
- Un mini-boss « gardien » à l'entrée de chaque région de palier supérieur (Gardien de la Faille, Le Noyeur…) : si
  on le bat, on est prêt pour la région.
- Au bord des routes, les monstres sont au niveau minimum de la région, et les niveaux montent quand on s'en éloigne.
- Chaque boss a un **télégraphe signature appris avant** sur un monstre normal de sa région (l'onde souterraine du
  Ver est déjà celle des Dessiccés, les racines de l'Écorce-Mère celles des Écorciers).

## 7. Trame principale : « Le Chant de l'Arbre-Brume »

| Chap. | Titre | Régions | Niv. | Résumé |
|---|---|---|---|---|
| I | La Brume se lève | Val | 1–14 | Chaîne d'Aldric (existante). Le cœur du Golem porte une rune d'or : « l'Arbre se meurt ». |
| II | La Veilleuse | Forêt, Bois des Égarés | 10–15 | On suit les lanternes jusqu'à l'Arbre-Brume. Son esprit, la Veilleuse, révèle que la Brume-Noire suinte d'Aldmar, retenue jadis par quatre Sceaux dont les gardiens ont été corrompus. |
| III | La mémoire d'Aldmar | Plaine des Stèles | 11–15 | Les stèles montrent des souvenirs de la chute d'Aldmar et indiquent les Sceaux. |
| IV | Les quatre Sceaux (ordre libre) | Marais, désert, Givreval, Cendremont | 15–30 | Vase (Sorcière), Ambre (Ver), Givre (Géant), Braise (Brasier-Mère). Chaque Sceau rallumé ouvre un pan des Grandes Portes d'Aldmar. |
| V | Le Roi-Liche | Aldmar | 27–30 | Avec 3 Sceaux, les Portes s'ouvrent ; la Crypte mène au Roi-Liche. **En v0.3 la trame s'arrête aux Portes** (« à suivre ») parce que la Crypte est un donjon v0.4. |

Quêtes secondaires : 2 à 3 petites chaînes par région (liste dans le JSON, `quests`), et des **primes répétables**
(Fort du Couchant) en attendant les journalières v0.4.

## 8. Donjons

| Donjon | Région | Niv. | Boss | Kit | Version |
|---|---|---:|---|---|---|
| Mine de Cuivrefond | Val | 6–8 | Contremaître gobelin | `dng_*` + filons | v0.4 |
| Temple englouti de Verre-Lune | Lac | 12–15 | La Nixe du lac | `dng_*` + eau | v0.4 |
| Racines de l'Arbre-Brume | Bois des Égarés | 14–16 | Le Ver-Racine | kit racines (nouveau) | v0.4 |
| Grotte des Contrebandiers | Côte des Salins | 16–18 | Capitaine Sel-Amer | `dng_*` + `port_*` | v0.4 |
| Terrier du Ver | Désert | 20–22 | Couvée du Ver | kit sable (nouveau) | v0.5 |
| **Grotte gelée** | Givreval | 22–25 | Yéti ancestral, Écho du Géant | `ice_*` (CX-11) | v0.4 |
| **Crypte d'Aldmar** | Aldmar | 27–30 | Roi-Liche d'Aldmar | `dng_*` (CX-4) | v0.4 |
| Forge Engloutie | Cendremont | 29–30 | Le Premier Forgeron | `dng_*` + lave | v0.5 |

En v0.3, les entrées sont **placées dans le monde** (porte `dungeon_gate` fermée, texte « Scellé par la Brume ») pour
préparer les joueurs.

## 9. Villes et services

| Ville | Région | Services | Version |
|---|---|---|---|
| **Brumeval** | Val | forge, alchimie, couture, étals du marché, banque, auberge, Maître des arts, arène de duel, pierre de passage | v0.3 |
| **Port-Salin** | Côte des Salins | forge, alchimie, couture, étals, banque, auberge, capitainerie (bateaux v0.5) | v0.3 (CX-5) |
| **Ambrefont** | Désert | forge, alchimie, étals, auberge, loueur de chars à voile (v0.4) | v0.3 en avant-poste, ville complète v0.4 |
| Relais des Épis, Hameau des Saules, Poste de la Veilleuse, Fort du Couchant, Pilotis de Brumenoire, Refuge de Givreval, Camp des Vents, Camp de la Cendre, Sanctuaire de l'Arbre-Brume | — | 1 à 3 services + pierre de passage | v0.3 |

Les avant-postes n'ont **pas de banque** (sauf le Camp de la Cendre, « banque de campagne » au pied de la zone rouge) :
c'est ce qui donne du sens aux retours en ville avec les zones rouges.

## 10. Récolte par biome

Points déjà prévus (`crafting.md`) : `node_copper` (Val, prairies, forêt, lac), `node_iron` (Stèles, Marches, Gorges,
marais, côtes, désert), `node_mithril` (mesas, Givreval, Aldmar, Cendremont), `node_crystal` (Stèles, Bois des
Égarés, Gorges, Givreval, Aldmar, Cendremont), `node_herb_brume` (centre, forêt, marais), `node_herb_braise` (Gorges,
désert, Aldmar, Cendremont), `node_herb_givre` (mesas, Givreval).

Propositions en plus (à valider avec l'artisanat) : roseaux (lac, marais), champignons de brume (forêts), sel marin et
corail d'écume (côtes), pulpe de cactus (désert, potion de fraîcheur), obsidienne (Cendremont, forge T6).

## 11. Collectible : les Brumillons

- **238 Brumillons** (12 à 18 par région), petits esprits de brume ronds et timides.
- On les trouve en résolvant une **micro-énigme** : soulever une pierre, allumer une lanterne, finir une petite course,
  toucher une cible, suivre un feu follet, atteindre un sommet, regarder une stèle à la bonne heure.
- On les échange auprès de la **Veilleuse**, au Sanctuaire de l'Arbre-Brume.

| Brumillons | Récompense |
|---:|---|
| 5 | +2 emplacements de sac |
| 15 | +2 emplacements de sac |
| 30 | +10 emplacements de banque |
| 60 | Titre « Ami des Brumillons » |
| 100 | Cape de brume (cosmétique, tissu au vent) |
| 150 | Familier Brumillon (cosmétique, v0.5) |
| 238 | Titre « Gardien de l'Arbre » + teinture dorée |

Technique : entité statique personnelle, comme les filons personnels. Le compte garde la liste des ids trouvés.

## 12. Zones rouges

| Zone | Région | Niv. | Récompenses |
|---|---|---:|---|
| Îlots des Naufrageurs | Archipel | 19–23 | T4/T5 (+2 niveaux d'objet), doublons, filons de cristal doubles. **Petite et facultative** : on goûte au risque avant le niveau 25. |
| Cœur d'Aldmar | Aldmar | 25–30 | T6, fragments runiques, ensembles runiques, Champion écarlate (Soif-de-Sang) |
| Cône de Cendremont | Cendremont | 26–30 | T6, mithril double, obsidienne, Brasier-Mère |

Les règles de `ROADMAP.md` § 2 bis s'appliquent : bordure rouge, bannière, 5 s de protection en entrant. Les camps de
base (Camp de la Cendre, Grandes Portes) restent **jaunes**.

## 13. Météo par région

Chaque région a une météo pondérée (`weather` dans le JSON), rendue avec les effets de CX-6 (`rain_streaks`,
`snowflakes`, `sandstorm`, `fog_wisps`, `lightning_flash`, `embers`) et les **nuages volumétriques** demandés.
Exemples : Bois des Égarés = brouillard épais 60 % ; désert = canicule 50 % et tempête de sable 30 % (la carte se
brouille) ; Givreval = neige 45 % et blizzard 25 % ; Cendremont = pluie de cendres 50 % et braises 30 % ; côtes = embruns
et tempêtes. Les nuages doivent être **visibles de loin** : on voit l'orage arriver sur les Stèles depuis le Val.

## 14. Déplacements : v0.3 et plus tard

| Déplacement | Version |
|---|---|
| Pierres de passage (1–2 par région + villes), belvédères qui révèlent la carte | **v0.3** |
| Saut, sprint, roulade ; gués, bancs de sable, ponts de corde, troncs couchés | **v0.3** |
| Monture « Destrier de brume » (CX-7) | v0.4 |
| Char à voile des dunes (Ambrefont, sable seulement) | v0.4 |
| Fumerolles et geysers qui propulsent (Cendremont, marais) | v0.4 |
| Barque et voilier (Port-Salin ↔ archipel, lac) | v0.5 |
| Vol plané « Aile de toile » depuis les tours et mesas (A4 et plus) | v0.5 |

## 15. Questions ouvertes

1. **Taille réelle en v0.3** : 4 × 4 km, c'est 123 fois la carte actuelle. Proposition : livrer d'abord **l'anneau
   intérieur** (Val, Prairies, Lac, Forêt, Stèles, Marches, Bois des Égarés, soit environ 2 × 2 km), puis la ceinture
   (marais, côte, désert) et enfin les bords.
2. Les **ids de région** et les altitudes doivent être alignés avec la carte du cartographe (`carto.*`, absente pour
   l'instant).
3. Le Golem reste niv. 14 dans la région de départ : on garde ce pic (identité « soulslike ») ou on le déplace ?
   Proposition : on le garde, et la quête le recommande seulement à partir du niveau 12, comme aujourd'hui.
4. Les niveaux du bestiaire donnés dans `crafting.md` (spectre 12–15, scorpion 15–18…) collent à ce brouillon, sauf
   le **troll** : on le rencontre dès 20 (Embruns, mesas), pas seulement de 25 à 29. Les matériaux du troll doivent
   donc exister à plusieurs niveaux.
5. Monture en zone rouge et en donjon : autorisée ou non ?
6. Il faut des légendaires pour le Roi-Carapace et la Brasier-Mère (à ajouter à `items.md` § 7).
