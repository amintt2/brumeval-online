# Performances du serveur et du réseau (v0.2)

Ce document résume les optimisations de la vague 1 (`netcode-perf`) et les mesures avant / après, faites avec le
test de charge `tests/load.mjs`.

## Objectifs

| Mesure | Objectif | v0.1 | v0.2 |
|---|---|---|---|
| Durée du tick (p95), 100 joueurs dans une même foule | < 10 ms | 10,5 ms | **4,4 ms** |
| Débit reçu par client dans cette foule | < 20 Ko/s | 82,0 Ko/s | **8,2 Ko/s** |

Les deux objectifs sont atteints avec une large marge : 200 joueurs dans la même foule tiennent encore dans
15,6 Ko/s par client et 5,9 ms de tick moyen (budget : 50 ms à 20 ticks/s).

---

## Le test de charge

```bash
node tests/load.mjs                       # 100 bots, 60 s
node tests/load.mjs --bots 200 --seconds 30 --spread 30
node tests/load.mjs --monsters 1000       # monde beaucoup plus peuplé (1000 monstres de plus)
node tests/load.mjs --root <copie v0.1>   # même test contre une autre version du serveur (comparaison)
node tests/load.mjs --json res.json --check   # résultat JSON ; code de sortie 1 si les objectifs sont manqués
```

Le serveur tourne dans un processus enfant (son CPU est mesuré seul, threads de compression compris) avec un
dossier de données temporaire. Chaque bot crée un personnage (guerrier, mage ou rôdeur), marche jusqu'aux Plaines
d'Émeraude, puis pendant toute la durée : se déplace au hasard dans une foule de 22 m de rayon (le pire cas :
chaque client voit tous les autres), attaque les monstres proches, discute (≈ un message toutes les 10 s) et
ressuscite s'il meurt. Les compteurs démarrent une fois tout le monde arrivé.

Rapport : durée du tick p50/p95/p99/max (mesurée autour de `game.tick`), CPU du processus serveur en % d'un cœur,
RSS et tas, octets reçus par client et par seconde **sur le fil** (après compression) et avant compression,
messages et trames WebSocket par seconde, temps par phase du tick, monstres éveillés, snapshots différés.

Machine de mesure : Intel Core i5-10400F (6 cœurs / 12 threads), Windows 11, Node.js 22.19. La machine était
partagée avec d'autres tâches pendant les mesures : les maxima et les p99 varient d'un essai à l'autre
(jusqu'à ×2) ; les médianes et les débits sont stables.

---

## Résultats

### Scénario 1 — 100 joueurs dans une même foule (60 s, ≈ 60 monstres)

| | v0.1 | v0.2 |
|---|---|---|
| Tick p50 | 4,97 ms | **1,84 ms** |
| Tick p95 | 10,49 ms | **4,38 ms** |
| Tick p99 | 15,23 ms | **4,79 ms** |
| Tick max | 27,6 ms | 10,6 ms |
| Tick moyen | 4,24 ms | 1,83 ms |
| CPU serveur (% d'un cœur) | 19,0 % | 28,4 % ¹ |
| RSS / tas | 163 Mo / 38 Mo | 177 Mo / 20 Mo |
| Reçu par client, sur le fil | 82,0 Ko/s | **8,2 Ko/s** (−90 %) |
| Reçu par client, avant compression | 81,9 Ko/s | 30,8 Ko/s (−62 %) |
| Messages / trames par seconde et par client | 34,8 / 34,8 | 35,0 / 21,7 |

Phases du tick v0.2 (ms par tick, moyenne) : snapshots 1,38 · IA 0,26 · minuteries 0,03 · état personnel 0,03 ·
combat 0,01 · régénération 0,01.

¹ Le CPU en plus est celui de la compression permessage-deflate, qui tourne dans les threads de libuv et
**pas** dans la boucle du jeu (le tick, lui, est 2,3 fois plus court). Sans compression (`WS_COMPRESSION=0`) :
17,1 % de CPU mais 30,5 Ko/s par client. Réglage retenu : niveau 1 (voir plus bas).

### Scénario 2 — 100 joueurs et 1000 monstres de plus (60 s)

Monde très dense (≈ 1 monstre pour 100 m² sur la carte actuelle de 320 × 320 m) : chaque joueur voit environ
100 joueurs et 200 monstres, dont beaucoup combattent la foule.

| | v0.1 | v0.2 |
|---|---|---|
| Tick p50 | 20,42 ms | **9,18 ms** |
| Tick p95 | 50,16 ms | **15,80 ms** |
| Tick p99 | 86,95 ms | **18,14 ms** |
| Tick moyen | 20,80 ms | 6,76 ms |
| CPU serveur | 50,8 % | 49,9 % |
| Reçu par client, sur le fil | 223,9 Ko/s | **17,3 Ko/s** (−92 %) |
| Reçu par client, avant compression | 223,7 Ko/s | 62,8 Ko/s |
| Trames par seconde et par client | 93,4 | 28,8 |

En v0.1 le tick moyen consommait 40 % du budget et le p95 le dépassait : le jeu aurait ralenti. En v0.2 le monde
peut grossir d'un ordre de grandeur. Phases v0.2 : snapshots 5,49 · IA 1,08 (1040 monstres, dont 648 éveillés : la
petite carte met presque tout le monde près d'un joueur ; sur la carte de 800 × 800 m prévue en vague 2, la
grande majorité dormira).

### Scénario 3 — 200 joueurs dans une même foule (30 s, rayon 30 m)

Tick p50 4,59 ms · p95 13,42 ms · moyenne 5,86 ms · CPU 76,9 % · 15,6 Ko/s par client (58,7 Ko/s avant
compression). Aucune déconnexion. Au-delà, c'est le nombre de joueurs **visibles** qui coûte (chaque client
reçoit l'état des 200 autres) ; des joueurs répartis sur la carte coûtent beaucoup moins cher.

### Chargement de la page (client compilé)

| Fichiers | Taille brute | brotli (servi) | gzip |
|---|---|---|---|
| JavaScript (2) | 892 Ko | 227 Ko | 250 Ko |
| CSS | 63 Ko | 13 Ko | 14 Ko |
| Modèles 3D `.glb` (27) | 4 287 Ko | 784 Ko | 900 Ko |
| Icônes `.png` (40, déjà compressées) | 1 287 Ko | 1 287 Ko | — |
| **Total du premier chargement** | **6,5 Mo** | **2,3 Mo** | |

Aux visites suivantes, les bundles de `/assets/` (empreinte dans le nom) viennent du cache du navigateur sans
aucune requête, et les modèles/icônes sont revalidés par `ETag` (réponse `304` vide).

---

## Ce qui a été fait

### Réseau

- **Deltas de snapshots champ par champ** (`server/src/snapshot.js`, ROADMAP §4.3) : un champ dynamique
  (`x z ry hp mhp s tg sl` et ceux ajoutés par les autres fonctionnalités) n'est envoyé que s'il a changé depuis le
  snapshot précédent ; une entité immobile et intacte n'apparaît plus du tout dans `ents`. Le delta d'une entité
  est sérialisé **une seule fois** par tour et partagé par tous les clients qui la connaissent. Filet de sécurité :
  chaque entité est renvoyée entière toutes les 50 rondes (5 s), décalées par id. Le client
  (`client/src/state.js`) fusionne champ par champ et prolonge sur place la trajectoire des entités absentes du
  snapshot (pas d'interpolation étirée).
- **Quantification** : positions au 5 cm, angles au 0,02 rad (≈ 1°) : les micro-mouvements ne coûtent rien.
- **permessage-deflate** (`server/src/wsout.js`) : fenêtre 16 Ko (le contexte des snapshots précédents rend les
  deltas très compressibles), seuil 128 octets, niveau 1. Mesures à 100 clients : le niveau 3 donne ≈ 6 %
  d'octets en moins pour ≈ 20 % de CPU de compression en plus — pas rentable. Réglable par `WS_DEFLATE_LEVEL`,
  désactivable par `WS_COMPRESSION=0`.
- **Trames `batch`** : un client qui se connecte avec `/ws?batch=1` (le client web, les bots) reçoit tous les
  messages d'un même tick dans une seule trame `{"t":"batch","m":[…]}` (−38 % de trames, meilleure compression).
  Le client les dépile de façon transparente ; les autres clients reçoivent des messages simples comme avant.
- **Congestion** : un client dont la connexion a plus de 256 Ko en attente (lien lent, compression en retard)
  saute les tours de snapshot au lieu d'accumuler ; il reçoit l'état complet dès que sa connexion se vide. La
  mémoire reste bornée et la chaîne de deltas n'est jamais rompue (compteur `net.snapshotsSkipped` dans `/health`).

### CPU du serveur

- **Grille spatiale** (`server/src/aoi.js`, cellules de 32 m) : toutes les recherches « entités autour d'un
  point » (zones d'intérêt des snapshots, aggro des monstres, dégâts de zone) ne parcourent plus que les
  cellules voisines au lieu de toutes les entités (la discussion, elle, est globale : pas de recherche).
  Mise à jour incrémentale quand une entité change de cellule.
- **Sommeil des monstres** : un monstre sans joueur à moins de ≈ 100 m (et qui ne combat pas) est mis à jour à
  basse fréquence (2 Hz au lieu de 20) ; il se réveille dès qu'un joueur approche. Prépare la carte de 800 × 800 m de la vague 2.
- **Moins d'allocations par tick** : tampons de requêtes réutilisés, fragments JSON des clés mis en cache,
  sérialisation des snapshots par concaténation de chaînes pré-calculées.
- **Profileur du tick** (`server/src/perf.js`) : p50/p95/p99/max sur une fenêtre glissante, temps par phase
  (minuteries, IA, combat, régénération, snapshots, état personnel), compteur de ticks hors budget, avertissement
  « tick lent » dans le journal si le p95 dépasse 25 ms. Exposé dans `GET /health`.

### Sauvegardes (ROADMAP §4.2)

Un fichier par compte (`accounts/<nom>.json`), écrits de façon atomique et **seulement s'ils ont changé**, en
arrière-plan (entrées/sorties asynchrones : la boucle du jeu n'attend jamais le disque). Avec 100 joueurs
connectés, une sauvegarde périodique n'écrit que les comptes réellement modifiés au lieu de réécrire tout le
fichier `accounts.json`. Import automatique de l'ancien fichier v0.1, sauvegardes quotidiennes gzip (7 jours).

### HTTP

brotli/gzip des fichiers texte et des modèles `.glb` (résultat gardé en mémoire), `Cache-Control: immutable`
pour `/assets/*`, `ETag` + `304` pour le reste, `no-cache` pour `index.html`, endpoints `/health`,
`/api/status`, `/api/version`. Détails dans [DEPLOIEMENT.md](DEPLOIEMENT.md).

---

## Pistes pour la suite

- Au-delà de ≈ 200 joueurs visibles les uns des autres, la sérialisation des snapshots domine : on pourra réduire
  la fréquence des entités lointaines (par exemple 5 Hz au-delà de 40 m) sans changer le protocole.
- `game.broadcastNear` (effets visuels envoyés aux joueurs proches) parcourt encore tous les joueurs : négligeable
  à 200 joueurs (quelques microsecondes par tick), à passer sur la grille au-delà de ≈ 500.
- Un format binaire n'apporterait aujourd'hui qu'environ 30 % de plus après compression : pas prioritaire.
