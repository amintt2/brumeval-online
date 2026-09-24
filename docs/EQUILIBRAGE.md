# Équilibrage — combat « soulslike » (v0.2) et Arbre des Brumes (v0.3)

> Document de référence de l'agent `combat-souls`. Les chiffres ci-dessous sont produits par la simulation
> `tests/balance/sim.mjs` (`node tests/balance/sim.mjs` réimprime les tableaux) et vérifiés à chaque `npm test`
> par `server/test/balance.test.js`.

## 1. Le constat des joueurs

- **Mage et rôdeur trop forts** : en v0.1 on pouvait reculer en tirant sans aucune contrepartie (auto-attaque à
  distance en pleine course, aucune pénalité après un sort). Les monstres, lents et prévisibles, ne touchaient
  presque jamais un personnage à distance.
- **IA trop simple** : chaque monstre fonçait en ligne droite, frappait toutes les 1,5 s, recommençait.
- **Envie de difficulté à la Elden Ring** : attaques lisibles mais punitives, esquive, endurance, boss à phases.

## 2. Les nouvelles règles (résumé)

| Règle | Valeur | Où |
|---|---|---|
| Endurance max / régénération | 100 · 35 par seconde après 0,8 s sans dépense | `shared/combat.js` (`STAMINA`) |
| Roulade (Maj, appui court) | 30 d'endurance, 5 m en 0,55 s, invulnérable 0,35 s, 0,6 s entre deux roulades | `ROLL` |
| Sprint (Maj maintenue) | vitesse × 1,45, 18 d'endurance par seconde en mouvement | `STAMINA` |
| Engagement des attaques | après chaque capacité, 0,25 à 0,6 s à 25–50 % de la vitesse (`rec`, `recSlow`) | `ABILITIES[*]` |
| Coût d'endurance des capacités | 5 à 18 (`st`) — l'auto-attaque aussi | `ABILITIES[*].st` |
| Tir automatique à distance | seulement en se déplaçant à moins de 40 % de sa vitesse | `COMMIT.rangedMoveMax` |
| Déséquilibre (poise) | assez de dégâts de « poise » en 3,5 s ⇒ le monstre titube 0,9 s (boss 1,5 s) et son attaque est annulée ; puis 2 s d'insensibilité (pas de titubation en chaîne) | `POISE`, `ABILITIES[*].poise`, `MONSTERS[*].ai.poise` |
| Écho de mort | l'XP du niveau en cours reste sur place ; la récupérer en marchant dessus, perdue si on meurt avant | `ECHO` |

Les monstres télégraphient leurs attaques lourdes (zones rouges au sol) ; leurs coups légers ont un temps de
préparation (330 à 600 ms, avec un retard aléatoire propre à chaque individu) pendant lequel ils continuent de
poursuivre une cible qui recule : **reculer en tirant ne suffit plus**, il faut rouler au bon moment.

## 3. Méthode de simulation

`tests/balance/sim.mjs` rejoue des combats seul contre un monstre, 150 fois par affrontement, avec les vraies
données (`shared/data.js`) et les vraies formules (`computeDamage`, régénération, recharges, mana, endurance,
engagement, roulades, fenêtres de préparation, télégraphes, projectiles, déséquilibre, garde du squelette,
charges des loups, bonds des gluants, phases du golem). Le modèle est à une dimension (la distance entre le joueur
et le monstre), au pas de 50 ms.

Comportement « joueur raisonnable » (identique pour toutes les classes quand il s'applique) :

- **Guerrier** : marche au contact (le combat commence à 12 m), Coup puissant et Tourbillon dès qu'ils sont prêts,
  Frappe automatique, Cri de guerre sous 45 % de PV.
- **Mage / Rôdeur** : ouvrent à 16 m, gardent leurs distances en reculant à la vitesse qui autorise le tir,
  roulent pour se dégager quand un monstre les atteint au corps à corps (réussite 60 %), Soin du mage sous 50 %.
- **Tous** : roulent à travers 75 % des attaques télégraphiées, 60 % des projectiles et 30 % des coups légers
  (si l'endurance le permet), gardent 40 % de mana en réserve quand le monstre est déjà bien entamé.

**Efficacité** = XP gagnée par minute, en comptant le combat, 5 s de marche jusqu'au monstre suivant, le temps
de repos nécessaire pour récupérer les PV et la mana que la régénération n'a pas rendus, et 75 s de pénalité par
mort. C'est ce que ressent un joueur qui « farme » : tuer vite ne sert à rien si on doit ensuite s'asseoir.

**Objectif** : à chaque niveau (1, 5, 10, 14), les trois classes à ±15 % de l'efficacité moyenne.

## 4. Changements de valeurs

| Donnée | v0.1 | v0.2 | Pourquoi |
|---|---|---|---|
| Guerrier : attaque de base | 10 | 11 | le guerrier doit marcher jusqu'au contact et encaisser |
| Frappe (guerrier) | ×1,0, 1,4 s | ×1,2, 1,3 s | idem ; le corps à corps est plus risqué |
| Coup puissant | ×2,3 | ×2,8 (poise 42) | attaque lourde qui déséquilibre presque tout |
| Tourbillon | ×1,4 | ×1,7 | |
| Mage : attaque de base / par niveau | 11 / 2,5 | 9 / 2,7 | trop fort aux bas niveaux, identique vers le niveau 10 |
| Mage : mana de base | 120 | 95 | la Boule de feu à volonté tuait tout avant le contact |
| Trait de feu | ×0,95 | ×0,8 | |
| Boule de feu | ×2,5, 18 mana, 5 s | ×2,0, 20 mana, 6 s | |
| Rôdeur : mana de base | 70 | 80 | le rôdeur manquait de mana au niveau 1 |
| Tir / Tir perçant | ×0,95 / ×2,1 | ×0,85 / ×1,9 | |
| Loup : vitesse | 5,4 | 5,8 (course ×1,3 = 7,5 m/s) | « des monstres qui foncent » : plus rapides qu'un joueur qui ne sprinte pas |
| Squelette : vitesse | 4,6 | 4,2 | brute lente mais attaque lourde (×2,0) et garde frontale (−40 %) |
| Frappe (guerrier) : poise | — | 7 (au lieu de 12, v0.2.1) | l'attaque de base seule ne tient plus gluants et loups en titubation : le guerrier doit aussi esquiver |
| Gluant : Bond (slime_slam) | — | ×1,6 (au lieu de ×1,35, v0.2.1) | une raison lisible d'esquiver dès le niveau 1 |
| Loup : Ruée (wolf_lunge) | — | ×1,35 (au lieu de ×1,45, v0.2.1) | marche moins haute entre gluants et loups pour les lanceurs de sorts |
| Golem : PV / attaque | 2600 / 42 | 3000 / 46 | vrai boss à trois phases |

Les monstres de même type ne se ressemblent plus : variantes (gobelin lanceur 40 %, squelette occultiste 20 %),
élites (5 % : +80 % PV, +30 % dégâts, ×1,5 XP, ×2 or et chances de butin) et tempérament individuel (agressivité,
prudence, temps de réaction 150–600 ms, distance préférée, côté de contournement, patience).

## 5. Résultats

| Niv. | Classe | Adversaire | TTK (s) | Dégâts subis (% PV) | Morts | XP/min |
|---|---|---|---:|---:|---:|---:|
| 1 | Guerrier | Gluant niv. 1 | 2.1 | 0 % | 0 % | 99 |
| 1 | Guerrier | Gluant niv. 2 | 2.1 | 0 % | 0 % | 127 |
| 1 | Mage | Gluant niv. 1 | 1.7 | 0 % | 0 % | 135 |
| 1 | Mage | Gluant niv. 2 | 4.8 | 0 % | 0 % | 128 |
| 1 | Rôdeur | Gluant niv. 1 | 0.5 | 0 % | 0 % | 97 |
| 1 | Rôdeur | Gluant niv. 2 | 0.7 | 0 % | 0 % | 139 |
| 5 | Guerrier | Gluant niv. 3 | 2.1 | 0 % | 0 % | 123 |
| 5 | Guerrier | Loup gris niv. 5 | 2.8 | 4 % | 0 % | 220 |
| 5 | Guerrier | Gobelin niv. 5 | 5.3 | 10 % | 0 % | 274 |
| 5 | Guerrier | Gobelin (thrower) niv. 5 | 4.3 | 4 % | 0 % | 284 |
| 5 | Mage | Gluant niv. 3 | 1.3 | 0 % | 0 % | 237 |
| 5 | Mage | Loup gris niv. 5 | 6.1 | 1 % | 0 % | 256 |
| 5 | Mage | Gobelin niv. 5 | 9.7 | 3 % | 0 % | 278 |
| 5 | Mage | Gobelin (thrower) niv. 5 | 7.7 | 20 % | 0 % | 309 |
| 5 | Rôdeur | Gluant niv. 3 | 0.5 | 0 % | 0 % | 154 |
| 5 | Rôdeur | Loup gris niv. 5 | 5.7 | 0 % | 0 % | 242 |
| 5 | Rôdeur | Gobelin niv. 5 | 9.7 | 3 % | 0 % | 245 |
| 5 | Rôdeur | Gobelin (thrower) niv. 5 | 5.8 | 9 % | 0 % | 341 |
| 10 | Guerrier | Gobelin niv. 8 | 3.2 | 4 % | 0 % | 390 |
| 10 | Guerrier | Gobelin (thrower) niv. 8 | 3.0 | 3 % | 0 % | 393 |
| 10 | Guerrier | Squelette niv. 10 | 10.5 | 26 % | 0 % | 400 |
| 10 | Guerrier | Squelette (occultist) niv. 10 | 7.1 | 0 % | 0 % | 533 |
| 10 | Guerrier | Loup gris niv. 6 | 1.8 | 0 % | 0 % | 198 |
| 10 | Mage | Gobelin niv. 8 | 6.4 | 0 % | 0 % | 433 |
| 10 | Mage | Gobelin (thrower) niv. 8 | 6.4 | 14 % | 0 % | 400 |
| 10 | Mage | Squelette niv. 10 | 17.4 | 1 % | 0 % | 370 |
| 10 | Mage | Squelette (occultist) niv. 10 | 14.6 | 0 % | 0 % | 460 |
| 10 | Mage | Loup gris niv. 6 | 3.6 | 0 % | 0 % | 293 |
| 10 | Rôdeur | Gobelin niv. 8 | 6.0 | 0 % | 0 % | 405 |
| 10 | Rôdeur | Gobelin (thrower) niv. 8 | 2.7 | 3 % | 0 % | 545 |
| 10 | Rôdeur | Squelette niv. 10 | 17.9 | 1 % | 0 % | 314 |
| 10 | Rôdeur | Squelette (occultist) niv. 10 | 10.5 | 0 % | 0 % | 466 |
| 10 | Rôdeur | Loup gris niv. 6 | 0.7 | 0 % | 0 % | 288 |
| 14 | Guerrier | Squelette niv. 11 | 7.8 | 10 % | 0 % | 385 |
| 14 | Guerrier | Squelette (occultist) niv. 11 | 3.9 | 0 % | 0 % | 508 |
| 14 | Guerrier | Gobelin (thrower) niv. 8 | 2.9 | 2 % | 0 % | 221 |
| 14 | Mage | Squelette niv. 11 | 12.4 | 0 % | 0 % | 387 |
| 14 | Mage | Squelette (occultist) niv. 11 | 9.1 | 0 % | 0 % | 476 |
| 14 | Mage | Gobelin (thrower) niv. 8 | 2.8 | 4 % | 0 % | 341 |
| 14 | Rôdeur | Squelette niv. 11 | 11.6 | 1 % | 0 % | 336 |
| 14 | Rôdeur | Squelette (occultist) niv. 11 | 5.7 | 0 % | 0 % | 536 |
| 14 | Rôdeur | Gobelin (thrower) niv. 8 | 0.6 | 0 % | 0 % | 350 |

| Niv. | Guerrier | Mage | Rôdeur | Écart max à la moyenne |
|---|---:|---:|---:|---:|
| 1 | 113 | 132 | 118 | 9 % |
| 5 | 225 | 270 | 245 | 9 % |
| 10 | 383 | 391 | 403 | 3 % |
| 14 | 371 | 401 | 407 | 6 % |

| Boss (solo, niv. 14) | TTK (s) | Dégâts subis (% PV) | Morts |
|---|---:|---:|---:|
| Guerrier | 53.4 | 82 % | 0 % |
| Mage | 163.3 | 69 % | 0 % |
| Rôdeur | 103.4 | 21 % | 0 % |


Lecture :

- **Écart maximal : 9 %** (objectif ±15 %). Le mage reste un peu devant aux bas niveaux (il tue les gluants avant
  qu'ils n'arrivent) et le rôdeur un peu devant à haut niveau (il tue les lanceurs en une volée) ; le guerrier
  encaisse plus mais ne manque jamais de temps.
- Les classes à distance ne sont plus « gratuites » : elles subissent les lanceurs de javelots (9 à 20 % de PV par
  combat) et, quand leur roulade échoue, les brutes et les loups. Face au golem, le mage met près de trois minutes
  seul et perd plus des deux tiers de ses PV.
- Le **golem** reste faisable seul au niveau 14 par un joueur qui esquive bien (0 mort simulée avec 75 %
  d'esquives réussies), mais il est long et punitif : c'est un combat pensé pour être appris (phase 2 : rochers
  lancés en ligne ; phase 3 : rage, enchaînements séisme → onde de choc). Avec seulement 45 % des télégraphes
  esquivés, le guerrier et le mage encaissent plus que la totalité de leurs PV pendant le combat (109 % et
  116 %) et ne survivent que grâce au Cri de guerre / au Soin : la moindre erreur supplémentaire est fatale.

## 6. Limites connues du modèle

- Une seule dimension : pas de contournement, pas de terrain, pas de monstres multiples (les meutes de loups
  appelées par un hurlement sont plus dangereuses que ne le montre le tableau).
- Les probabilités d'esquive représentent un joueur correct ; un joueur débutant subira nettement plus de dégâts
  quelle que soit sa classe, ce qui est l'effet recherché.
- Les élites (5 %) ne sont pas incluses dans l'efficacité : ce sont des bonus risqués.

Pour rééquilibrer : modifier `shared/data.js`, relancer `node tests/balance/sim.mjs`, puis `npm test`
(le test `balance.test.js` échoue si une classe sort des ±15 %).

## 7. L'Arbre des Brumes (v0.3) — moteur, builds et mécaniques approchées

> Conception : `docs/design/ARBRE_COMPETENCES.md` et `docs/design/DECISIONS.md` (prioritaire). Données :
> `docs/design/skilltree.json`, copié tel quel dans `shared/skilltree.js` par `node scripts/build-skilltree.mjs`
> (un test vérifie que la copie est à jour). Règles pures partagées client/serveur : `shared/skills.js`.

### 7.1 Ce qui change pour le combat

- **Niveau 1 = attaque de base seulement** (décision du 23/09) : la Roulade, le Sprint, le Saut, la Garde et
  l'Attaque chargée s'apprennent dans l'arbre (1 point chacun). Un personnage v0.2 garde sa roulade, son sprint
  et ses 4 compétences (voir `docs/COMPTES.md`, « Migration v0.3 »).
- **Niveau max 30.** XP inchangée jusqu'au niveau 20, puis +10 % par niveau au-delà de 19 (×1,1 au niveau 20,
  ×2,0 au niveau 29). 1 point par niveau à partir du niveau 2, +1 tous les 5 niveaux : 35 points au niveau 30.
- **Moteur de compétences piloté par les données** (`server/src/systems/abilities.js`) : les 65 capacités et
  toutes leurs variantes passent par `resolveAbility` (variante → ajouts → multiplicateurs → enveloppe de dégâts de
  l'arbre plafonnée à +75 % → Inaptitude et attaque de référence → arme → garde-fous → clés de voûte). Types :
  mêlée (cible ou cône), projectile (nombre, éventail, perforation, explosion, éclats, ricochet, Fracas), zone
  autour de soi, zone au sol (retardée, persistante, ligne, anneau), soin (+ soin sur la durée, soin de groupe),
  renfort (statistiques, boucliers d'absorption, bouclier de mana), marque, déplacement (bond, fente, téléportation,
  pas de côté, bond arrière — destination calculée par le serveur), canalisation (coups ciblés, cône, cercle,
  rayon, tir visé), invocation (feu follet, mur de glace), piège.
- **Temps de préparation** : les coups ont maintenant leur `windup` de la conception (Frappe 0,15 s, Coup
  puissant 0,35 s, Tourbillon 0,2 s…) : le coup part, puis touche. Les **incantations** (`cast`) ne dépensent
  rien avant la fin : une roulade les annule sans coût (le Soin se place dans les fenêtres de récupération).
- **Statuts des monstres** (`server/src/systems/status.js`) : Brûlure, Froid (3 charges : −15 % de vitesse et
  préparations +10 % par charge), Gel, Enraciné, Étourdi (8 s d'immunité ensuite, jamais sur un boss), Poison
  (charges, aucun déséquilibre), Saignement (plaies + jauge d'hémorragie), Marqué, Aveuglé, ralentissements,
  Brise-garde (défense −25 %, garde frontale des squelettes supprimée). EntState `stt` les montre au client.
- **Fondamentaux** (`server/src/systems/fundamentals.js`) : Saut (Espace côté client) — 350 ms en l'air qui
  font passer au-dessus des attaques **rasantes** (`lo` : onde de choc et balayage du golem) mais pas des autres ;
  aucune vitesse en plus pour l'anti-triche (sauf Envol ×1,4) ; touché en l'air = vacillement à l'atterrissage.
  Garde (E maintenue) — 120° de face, 50 % avec une arme de mêlée, 30 % sinon, endurance `min(60, 8 + 60 ×
  dégâts / PV max)` (×1,5 contre un télégraphe), garde brisée à 0 (vacillement 1 s) ; ne bloque ni les rasants
  ni les imblocables (`nb` : séisme du golem) ni les sorts (`mag` : malédiction de l'occultiste) sauf avec
  l'Égide ; Parade parfaite (variante) dans les 180 ms. Attaque chargée — ×1,0 → ×1,8 et déséquilibre ×2 entre
  0,4 et 1,2 s, super-armure les 0,3 dernières secondes, recharge au relâchement.
- **Vacillement du joueur** : un coup télégraphié qui touche fait vaciller 0,4 s (boss 0,6 s), × (1 − Équilibre
  / 100) : ni attaque, ni roulade, ni garde, incantation annulée.
- **Inaptitude** : hors de sa classe, −25 % de puissance, +25 % de coût, +20 % de recharge, et l'attaque d'un
  personnage de la classe d'origine au même niveau (exemple de la conception vérifié par les tests : un mage de
  niveau 18 lance le Tourbillon à ×1,43, 25 mana, 23 endurance, 12 s). Chaque Renaissance retire 5 points de
  pénalité (0 % à la cinquième).
- **Équipement** : plus de restriction de classe (un hybride porte l'arme de ses compétences). Les armes portent
  des étiquettes (`wt` : `melee`, `une_main`, `focalisateur`, `distance`) et une famille ; une compétence d'arme
  sans la bonne arme est refusée (« Il faut une arme de mêlée. »), un sort sans focalisateur perd 20 %,
  l'attaque de base n'est jamais grisée (×0,8 à mains nues).

### 7.2 Simulation des builds (`node tests/balance/sim.mjs`)

Le modèle du §3 est étendu aux arbres : chaque build prend les 3 Fondamentaux (+ la Garde en mêlée), le chemin
le moins cher vers ses compétences, puis les passifs de ses branches (et, à défaut, ceux de Survie) jusqu'au
dernier point. Les capacités sont résolues par le **même code que le serveur** (`resolveAbility`, statistiques
de l'arbre, Inaptitude, arme). Les dégâts sur la durée sont comptés d'un bloc (brûlure +30 %, plaies, poison sur
6 s, jauge d'hémorragie). Les monstres sont ceux de la v0.2 portés au niveau du joueur (les régions de niveau 15
à 30 arrivent avec la refonte du monde). `server/test/balance.test.js` vérifie que chaque build place ses points,
peut utiliser toute sa barre avec son arme, tue en moins de 40 s et meurt dans au plus 10 % des combats.

| Build | Niv. 10 (XP/min) | Niv. 20 (XP/min) | Niv. 30 (XP/min) | Points niv. 30 | Barre (1 à 4) |
|---|---:|---:|---:|---:|---|
| Guerrier Gardien | 572 | 893 | 1106 | 35/35 | Frappe, Coup puissant, Coup de bouclier, Cri de guerre |
| Guerrier Berserker | 540 | 949 | 1401 | 35/35 | Frappe, Tourbillon, Entaille, Rage sanguinaire |
| Mage Pyromancien | 567 | 1088 | 1266 | 35/35 | Trait arcanique (Trait de feu), Boule de feu, Embrasement, Soin |
| Mage de Givre | 471 | 757 | 902 | 35/35 | Trait arcanique, Lance de glace, Nova de givre, Soin |
| Rôdeur Tireur | 587 | 1191 | 1582 | 35/35 | Tir, Tir perçant, Tir rapide, Pluie de flèches |
| Rôdeur Venin | 517 | 809 | 1117 | 35/35 | Tir, Flèche empoisonnée, Flèche barbelée, Marque du chasseur |
| Hybride Lame spirituelle (Guerrier → Mage) | 406 | 677 | 1157 | 35/35 | Frappe, Onde tranchante, Lame enchantée, Coup puissant |
| Hybride Mage de bataille (Mage + Tourbillon) | 637 | 899 | 995 | 35/35 | Trait arcanique, Tourbillon (Inapte), Boule de feu, Soin |

Au niveau 30 (monstres niveau 29) :

| Build | Squelette : TTK · dégâts subis | Occultiste : TTK · dégâts | Gobelin : TTK · dégâts | Morts |
|---|---|---|---|---:|
| Guerrier Gardien | 14,6 s · 22 % | 9,3 s · 0 % | 7,8 s · 10 % | 0 % |
| Guerrier Berserker | 10,8 s · 14 % | 7,8 s · 0 % | 4,7 s · 5 % | 0 % |
| Mage Pyromancien | 15,0 s · 1 % | 8,6 s · 0 % | 6,5 s · 0 % | 0 % |
| Mage de Givre | 19,1 s · 2 % | 17,1 s · 0 % | 10,7 s · 3 % | 0 % |
| Rôdeur Tireur | 11,5 s · 0 % | 5,7 s · 0 % | 3,8 s · 0 % | 0 % |
| Rôdeur Venin | 15,9 s · 1 % | 11,8 s · 0 % | 7,8 s · 1 % | 0 % |
| Hybride Lame spirituelle | 9,1 s · 12 % | 6,3 s · 0 % | 4,5 s · 2 % | 0 % |
| Hybride Mage de bataille | 14,8 s · 72 % | 6,9 s · 0 % | 6,6 s · 31 % | 3 % au squelette |

Les presets v0.2 (§5) donnent toujours un écart de 2 à 10 % entre les classes aux niveaux 1 à 14 avec les
valeurs v0.3 (Soin 25 % / 15 s avec 1 s d'incantation, Tourbillon ×1,9, Nova de givre à 2 charges de Froid…).

Lecture :

- Aucun build ne meurt en solo contre son niveau, sauf l'hybride mage au corps à corps (3 % contre la brute) :
  c'est le prix de l'Inaptitude et d'un mage sans armure au contact — l'hybride reste jouable mais n'est pas un
  « meilleur mage ».
- **Écart au niveau 30** : de −24 % (Mage de Givre) à +33 % (Rôdeur Tireur) autour de la moyenne. Le modèle
  ne compte pas la valeur défensive du Froid (monstres ralentis, préparations plus lentes) ni les monstres
  multiples où la Pluie de flèches et le Tourbillon valent plus : le Givre est sous-estimé, le Tireur surestimé
  (il tue les lanceurs en une volée). À surveiller avec les vraies régions de niveau 20 à 30 : pistes
  `ice_lance.power` 1,6 → 1,8 ou `ma_ks_hiver_eternel`, et `rapid_fire.cd` 9 → 10 s.
- Les hybrides de passerelle (Lame spirituelle) sont au niveau des builds purs (sans Inaptitude pour le
  guerrier) : c'est voulu par la conception.

### 7.3 Mécaniques approchées ou pas encore simulées

`node scripts/skilltree-coverage.mjs` liste, pour chaque champ modifié par les nœuds de l'arbre, s'il est lu par
le moteur ; un test échoue si un champ n'est ni lu ni listé ici (`EXOTIC` dans `server/src/systems/abilities.js`).
Au total : 105 champs de variantes et 92 statistiques passives lus par le moteur, 73 approchés ou non simulés.

**Approchés (✓)** : projectiles à tête chercheuse (touchent toujours), ricochet et éclats (sur les monstres
proches, sans trajectoire), attraction et recul instantanés, rayon qui suit l'orientation, Prison de glace (gel de
la cible au lieu d'un mur), salve en éventail, pluie de météores répartie autour du point, boule collante,
appât piégé, Bout portant, Riposte au couteau, Perce-cœur, Flèche d'arrêt, Point faible, Défi (marque), Venin
corrosif, Brume étouffante, Hémorragie, Épidémie, Fantôme des brumes (les monstres non-boss vous perdent 1,5 s),
Garde au couteau (via Contre parfait), Ronces givrées (dégâts d'un coup au lieu de 3 s).

**Pas encore simulés (✗)** : auras (Cri d'effroi, Armure de l'aurore), alternance taille / pointe, prolongation
de la Rage, effets « à la mort d'une cible », explosion de l'Égide brisée, conversion en mana, charges multiples
du Pas de brume, mur de flammes mobile, nuage rampant, éclats en orbite, leurre, interception et renvoi de
projectiles, épines / explosion / PV du Mur de glace, filet collant au sol, ajout des dégâts bloqués à la Riposte,
Bastion épineux, Pas tranchant, effets de groupe (pas encore de groupes), résistances au feu / givre / poison
(aucun monstre n'inflige encore ces éléments ; les sorts `mag` comptent comme arcane), poids d'armure, main
gauche (bouclier, grimoire, double arme — la clé Mur vivant ne s'active donc pas encore), récolte, affichage de
l'écho sur la carte et échos multiples. Le Mur de glace bloque les déplacements et les projectiles des monstres
mais pas les télégraphes (conforme : « une attaque télégraphiée le traverse »). La Renaissance se fait hors
combat (10 s) tant que l'Arbre-Brume n'existe pas dans le monde.

**Hors moteur, à faire côté client** (l'agent client) : touches (Espace = Saut, E = Garde, maintien de l'attaque de
base, 1 à 8), écran de l'arbre (N), livre (K), barre à 8 emplacements, rendu des nouveaux FX (`jump`, `land`,
`block`, `parry`, `guard_break`, `perfect`, `charge`, `charged`, `vacille`, `dash`, `zone`, `buff`, `channel`,
`status`, `trap`), décals `lo` / `nb` / `mag`, aura de Renaissance (`rb`).
