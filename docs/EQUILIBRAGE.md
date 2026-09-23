# Équilibrage — combat « soulslike » (v0.2)

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
| Roulade (Espace) | 30 d'endurance, 5 m en 0,55 s, invulnérable 0,35 s, 0,6 s entre deux roulades | `ROLL` |
| Sprint (Maj) | vitesse × 1,45, 18 d'endurance par seconde en mouvement | `STAMINA` |
| Engagement des attaques | après chaque capacité, 0,25 à 0,6 s à 25–50 % de la vitesse (`rec`, `recSlow`) | `ABILITIES[*]` |
| Coût d'endurance des capacités | 5 à 18 (`st`) — l'auto-attaque aussi | `ABILITIES[*].st` |
| Tir automatique à distance | seulement en se déplaçant à moins de 40 % de sa vitesse | `COMMIT.rangedMoveMax` |
| Déséquilibre (poise) | assez de dégâts de « poise » en 3,5 s ⇒ le monstre titube 0,9 s (boss 1,5 s) et son attaque est annulée | `POISE`, `ABILITIES[*].poise`, `MONSTERS[*].ai.poise` |
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
