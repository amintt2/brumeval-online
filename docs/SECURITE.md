# Sécurité, anti-triche et modération

Brumeval Online est public : **rien de ce qu'envoie le client n'est digne de confiance**. Le serveur fait
autorité sur tout (position, combat, inventaire, or, quêtes) et chaque message reçu passe par plusieurs
barrières avant d'atteindre le jeu. Ce document décrit ces protections, leur réglage, les commandes des
maîtres du jeu (MJ) et la lecture du journal de sécurité.

Code : `server/src/security/` (cœur), `server/src/net.js` (connexions et authentification),
`server/src/movement.js` (déplacements), `server/src/chat.js` (discussion).

---

## 1. Vue d'ensemble

```
connexion WebSocket
  │  Origin autorisée ?  IP bannie ?  moins de 5 connexions pour cette IP ?
  ▼
message reçu
  │  budget global (60 msg/s, rafale 120) ── dépassé → expulsion « Trop de messages envoyés. »
  │  JSON valide ? schéma du type de message respecté ? pas de clé __proto__ / constructor ?
  │  budget du type de message (move, chat, ability…) ── dépassé → message ignoré
  ▼
authentification (register / login)
  │  verrouillage progressif par compte et par IP, message d'erreur générique
  │  nom filtré (réservé, injurieux, sosie), mot de passe ≥ 6 caractères (nouveaux comptes)
  │  compte banni ?
  ▼
jeu
  │  déplacements : budget de distance, téléportation, murs, hors du monde, mort
  │  actions : refus répétés (portée, recharge, cibles invalides) → suspicion
  │  économie : invariants d'inventaire et d'or vérifiés après chaque action
  │  discussion : silence, flood, répétitions, majuscules, liens, liste d'ignorés
  ▼
score de suspicion (par compte et par IP, décroissance exponentielle)
  → avertissement dans le journal → expulsion → bannissement temporaire en cas de récidive
```

## 2. Score de suspicion et sanctions automatiques

Chaque comportement anormal appelle `game.security.flag(joueur, code, poids, détail)` (les autres modules
peuvent l'appeler avec `game.security?.flag?.(…)`). Le poids s'ajoute au score du **compte** et à celui de
l'**adresse IP** ; les scores sont **divisés par deux toutes les 10 minutes**.

| Seuil | Réglage | Effet |
|---|---|---|
| 15 | `SUSPICION_WARN` | ligne `warn` dans le journal + avertissement dans la console (au plus 1 / min) |
| 50 | `SUSPICION_KICK` | expulsion « activité suspecte détectée » (un *strike*), le score est divisé par deux |
| 3 expulsions en 24 h | `SUSPICION_BAN_AFTER_KICKS`, `SUSPICION_STRIKE_WINDOW_H` | **bannissement temporaire automatique** du compte : 1 h, puis 2 h, 4 h… (doublé à chaque récidive, 30 jours max ; `AUTO_BAN_MIN`) |

Les administrateurs et MJ ne sont jamais sanctionnés automatiquement (ils sont seulement signalés).

Principaux codes et poids :

| Code | Poids | Signification |
|---|---|---|
| `speed` | 2 à 6 | déplacement plus rapide que le budget autorisé |
| `teleport` | 8 | un seul message couvre plus de max(5 m, vitesse × 0,8 s) |
| `out_of_bounds` | 10 | coordonnées hors du monde (±160 m) |
| `wall` | 4 | trajet qui traverse un obstacle (maison, rocher, arbre…) |
| `blocked` / `unwalkable` | 2 / 1 | destination dans un obstacle / dans l'eau profonde |
| `move_dead` | 1 | déplacements envoyés plus de 1,5 s après la mort |
| `bad_packet` | 1 à 5 | JSON invalide, champ hors schéma (5 : clé `__proto__` / `constructor`) |
| `rate` | 1 | messages d'un type au-delà de son budget (au plus 1 signalement / s) |
| `flood` | 10 | budget global dépassé (expulsion immédiate) |
| `brute_force` | 3 à 5 | échecs de connexion au-delà des essais gratuits, insistance pendant un verrouillage |
| `range_spam`, `cooldown_spam`, `target_spam`, `bad_request_spam`, `refusal_spam` | 1 à 3 | trop d'actions refusées en 10 s (hors de portée, capacité en recharge, cibles invalides…) |
| `chat_flood`, `chat_repeat`, `chat_link`, `chat_spam` | 1 à 3 | spam dans la discussion (voir §6) |

Un signalement n'est jamais émis pour un client honnête : les tests rejouent des milliers de déplacements
réalistes (gigue réseau, pics de latence de 150 à 300 ms, rafales de messages, images saccadées, sprint,
roulades, glissades le long des obstacles) et exigent **zéro correction et zéro signalement**.

## 3. Connexions

| Protection | Détail |
|---|---|
| **IP réelle** | Derrière un proxy inverse (nginx, Caddy…), l'IP vue par le serveur est celle du proxy. Avec `TRUST_PROXY=1`, le serveur lit l'en-tête `X-Forwarded-For` et prend l'adresse ajoutée par le proxy (la plus à droite) ; ce qui est à sa gauche peut être falsifié par le client et est ignoré. `TRUST_PROXY=2` pour deux proxys en chaîne (CDN + nginx). **Sans `TRUST_PROXY`, l'en-tête est ignoré** (et un avertissement s'affiche s'il est présent). |
| **Adresses locales** | `127.0.0.1` et `::1` ne sont soumises à aucune limite par IP (sinon, derrière un proxy sans `TRUST_PROXY`, tous les joueurs partageraient la même adresse et se bloqueraient mutuellement). Désactivable avec `SECURITY_EXEMPT_LOOPBACK=0`. |
| **Origin** | Les navigateurs envoient l'origine de la page. Sont acceptés : la même origine que le serveur (la page qu'il sert, quel que soit le domaine), `https://brumel.mciut.fr` (ou la liste `ALLOWED_ORIGINS`), `http(s)://localhost:*` et `127.0.0.1:*` (développement). Une autre origine reçoit `403` lors de la poignée de main. |
| **Clients sans Origin** | Refusés, sauf `ALLOW_NO_ORIGIN=1` (scripts, bots de test). Sous `node --test`, ils sont acceptés automatiquement ; `tests/lib/botClient.mjs` envoie `Origin: http://localhost`. |
| **Connexions par IP** | 5 au maximum (`MAX_CONN_PER_IP`). La 6ᵉ reçoit `kick` « Trop de connexions depuis votre adresse ». |
| **IP bannie** | `kick` avec la durée restante et la raison, puis fermeture. |
| **Délai de connexion** | Une connexion doit s'authentifier en 120 s (`AUTH_TIMEOUT_S`), sinon elle est fermée. |
| **Battement de cœur** | ping WebSocket toutes les 15 s : les connexions mortes sont coupées. |
| **Inactivité** | Expulsion après 30 min sans action de jeu (`IDLE_KICK_MIN`) ; les `ping` ne comptent pas. |
| **Taille des messages** | 8 Ko maximum (au-delà : fermeture 1009). |
| **Débit** | Global : 60 messages/s en moyenne, rafale de 120 (`MSG_RATE_PER_S`, `MSG_BURST`) → au-delà, expulsion. Par type : `move` 30/s (rafale 100), `ability` 12/s, `chat` 3/s (rafale 8), `login`/`register` 1/s (rafale 5)… voir `TYPE_LIMITS` dans `ratelimit.js`. Les messages en trop sont ignorés. |
| **Validation** | Chaque type connu a un schéma strict (`validate.js`) : nombres finis et bornés, emplacements entiers dans l'inventaire, quantités entières positives, chaînes bornées. Tous les messages : 16 clés max, profondeur 3, tableaux ≤ 32, chaînes ≤ 256 caractères (sauf le texte du chat), **aucune clé `__proto__`, `constructor` ou `prototype`**. Un message invalide est ignoré et signalé. |

## 4. Authentification

- **Message générique** : un nom inconnu et un mauvais mot de passe donnent la même réponse, « Nom ou mot de
  passe incorrect. », avec le même temps de calcul (scrypt factice). Un compte banni n'est révélé qu'avec le
  bon mot de passe.
- **Verrouillage progressif** : par compte (5 essais gratuits, puis 1 s, 2 s, 4 s… jusqu'à 5 min) et par IP
  (8 essais gratuits, jusqu'à 15 min). Le compteur est oublié après 15 min sans échec et remis à zéro à la
  connexion réussie. Le verrouillage s'applique aussi aux noms qui n'existent pas (pas d'énumération).
  Réponse : `auth_err` code `rate_limit`, « Trop de tentatives de connexion. Réessayez dans … ».
- **12 tentatives au maximum par connexion**, puis expulsion.
- **Création de comptes** : 5 par IP et par heure (`ACCOUNTS_PER_IP_PER_HOUR`).
- **Mot de passe** : 6 caractères minimum pour les **nouveaux** comptes. Les comptes existants créés avec
  4 ou 5 caractères se connectent toujours.
- **Noms interdits** (nouveaux comptes uniquement) :
  - mots réservés à l'équipe : `admin`, `modérateur`, `brumeval`, `système`, `serveur`, `staff`, `support`,
    `officiel`… n'importe où dans le nom, et `mj`, `gm`, `mod`, `modo`, `dev`, `root`… comme mot entier
    (`GM_Bob`, `BobMJ`, `ModoLuc` sont refusés, `Sigmund` ou `Hamjo` sont acceptés) ;
  - une petite liste d'insultes françaises et anglaises (y compris en « leet » : `sal0pe`) ;
  - les sosies d'un personnage existant : même nom aux accents, à la casse, aux `_` près, ou avec
    `l/1/i` et `o/0` confondus (`Élodie` / `Elodie`, `B0b` / `Bob`).
  - Les listes sont dans `server/src/security/names.js`.

## 5. Déplacements (`server/src/movement.js`)

Le client simule son propre déplacement ; le serveur vérifie chaque message `move` :

- **Budget de distance** (seau à jetons) : chaque déplacement accepté consomme sa longueur ; le budget se
  remplit à `vitesse autorisée × 1,1` et contient au plus `vitesse × 1,5 s + 1 m`. La vitesse autorisée est
  `joueur.maxSpeedAt(maintenant)` (sprint, roulade, ralentissements — contrat du ROADMAP §4.3) ou, à défaut,
  `stats.speed` ; elle est maintenue à son maximum récent pendant 0,7 s pour les messages en retard.
  Conséquence : un pic de latence jusqu'à ~1,5 s ne provoque **aucune** correction, alors qu'un tricheur ne
  peut jamais aller durablement plus de 10 % plus vite que permis.
- **Téléportation** : un message qui couvre plus de max(5 m, vitesse × 0,8 s) est refusé.
- **Hors du monde** : coordonnées au-delà de ±160 m.
- **Obstacles** : destination dans un obstacle ou dans l'eau profonde, ou **trajet qui traverse** un
  obstacle (test segment / cercle ; glisser le long d'un obstacle n'est jamais pris pour une traversée).
- **Mort** : les déplacements reçus plus de 1,5 s après la mort sont signalés.

Un déplacement refusé renvoie `correct { x, z }` (le client revient à la dernière position acceptée). Seul le
premier refus est signalé : les messages déjà en route sont refusés sans signalement jusqu'à ce que le client
se resynchronise (ou 2,5 s). Après une téléportation par le serveur (réapparition, `/tp`), la même tolérance
s'applique. **Tout module qui déplace un joueur côté serveur doit appeler `p.mv.reset(x, z, game.now())`.**

## 6. Discussion

- Caractères de contrôle, inversions bidirectionnelles, **caractères invisibles** (espaces de largeur nulle,
  BOM, trait d'union conditionnel…) et accumulations de diacritiques (« zalgo ») sont supprimés. Rien n'est
  échappé en HTML côté serveur : le client affiche le texte avec `textContent`.
- **Débit** : 5 messages / 5 s.
- **Répétition** : le même message (à la casse et à la ponctuation près) une 3ᵉ fois en 30 s est refusé.
- **Majuscules** : un message de plus de 10 lettres écrit à plus de 70 % en majuscules est remis en minuscules.
  Les répétitions d'un même caractère sont limitées à 5 (« nooooooooon » → « nooooon »).
- **Liens** : `http://…`, `www.…` et les domaines (`site.com`, `discord.gg/…`, `site (point) com`) sont
  refusés, sauf la liste blanche `CHAT_LINK_WHITELIST` (par défaut `brumel.mciut.fr`).
- **Silence automatique** : 3 infractions (flood, répétition, lien) en une minute → silence de 2 min, puis
  10 min, 1 h, 24 h aux récidives suivantes. Le silence est enregistré sur le compte (une reconnexion ne
  l'annule pas). Un joueur réduit au silence peut toujours utiliser les commandes (`/who`, `/help`…).
- **Liste d'ignorés** (enregistrée sur le compte, 100 noms max) : `/ignore nom`, `/unignore nom`, `/ignore`
  seul pour voir la liste. Les messages généraux et les chuchotements d'un joueur ignoré ne sont plus reçus
  (l'expéditeur n'en est pas averti).

## 7. Économie

- Après **chaque** action d'un joueur, et toutes les 2 s pour tous les joueurs, le serveur vérifie :
  or entier entre 0 et 10 000 000 (`MAX_GOLD`) ; inventaire de 24 emplacements ; objets connus ; quantités
  entières entre 1 et la taille de pile (1 pour l'équipement) ; aucun emplacement partagé par deux cases
  (duplication) ; équipement valide.
- En production, une anomalie est **corrigée** et écrite dans le journal (`type: "invariant"`) et dans la
  console. Dans les tests (`node --test`) ou avec `SECURITY_ASSERT=1`, elle **lève une erreur** pour que le
  bogue soit trouvé immédiatement.
- Les quantités négatives, non entières ou `NaN` sont rejetées dès la validation du message.

## 8. Rôles et commandes des maîtres du jeu

**Rôles** :
- **administrateur** : noms listés dans `ADMIN_NAMES` (séparés par des virgules, insensibles à la casse), ou
  rôle `admin` enregistré sur le compte. **Créez d'abord le compte, puis ajoutez son nom à `ADMIN_NAMES`** :
  un nom listé qui n'existe pas encore ne peut pas être créé (personne ne peut « réserver » un nom
  d'administrateur libre) ;
- **maître du jeu (MJ)** : rôle `gm` enregistré sur le compte, donné par un administrateur avec `/role`.

Un joueur sans rôle qui tape une commande de modération reçoit exactement « Commande inconnue », comme pour une
faute de frappe. À la connexion, un membre de l'équipe voit son rôle ; `/help` lui rappelle `/mj`.

| Commande | Rôle | Effet |
|---|---|---|
| `/mj` | MJ | liste des commandes de modération |
| `/kick nom [raison]` | MJ | expulse un joueur connecté |
| `/ban nom [durée] [raison]` | MJ | bannit le compte (connecté ou non) ; durée `30m`, `2h`, `3j`, `1sem`, `perm` (permanent par défaut) |
| `/banip nom\|IP [durée] [raison]` | admin | bannit l'adresse IP (celle du joueur connecté ou sa dernière connue) et expulse tous les joueurs de cette adresse ; refuse les adresses locales |
| `/unban nom\|IP` | MJ (IP : admin) | lève un bannissement |
| `/bans` | MJ | bannissements en cours (les IP ne sont listées qu'aux administrateurs) |
| `/mute nom durée [raison]` | MJ | réduit au silence (`10m`, `1h`, `1j`, `perm`…) |
| `/unmute nom` | MJ | rend la parole |
| `/tp x z` | MJ | se téléporte aux coordonnées |
| `/tp nom` | MJ | fait venir un joueur à côté de soi |
| `/tpto nom` | MJ | va à côté d'un joueur |
| `/announce message` | MJ | annonce à tous les joueurs (notification + ligne de discussion) ; alias `/annonce` |
| `/inspect nom` | MJ | classe, niveau, rôle, en ligne ou non, score de suspicion (et IP pour les administrateurs), silence, bannissement, signalements récents |
| `/who` | tous | joueurs en ligne ; les administrateurs voient aussi les adresses IP |
| `/role nom joueur\|mj\|admin` | admin | change le rôle enregistré d'un compte (`ADMIN_NAMES` reste prioritaire) |

Un MJ ne peut pas sanctionner un autre membre de l'équipe ; personne ne peut se cibler soi-même. Les commandes
de l'équipe ne sont pas soumises à la limite de débit de la discussion. **Chaque commande est enregistrée**
dans le journal de sécurité (`type: "gm"`) et dans la console (`[MJ] …`).

## 9. Journal de sécurité

Fichier : `<DATA_DIR>/security.log` (par défaut `server/data/security.log`), **une ligne JSON par
événement**. Quand il dépasse 5 Mo (`SECURITY_LOG_MAX_MB`) il devient `security.log.1`, l'ancien `.1`
devient `.2`, etc. (3 fichiers gardés, `SECURITY_LOG_KEEP`). Les répétitions d'un même signalement sont
regroupées (au plus une ligne toutes les 2 s, le champ `suppressed` compte les lignes omises).

Exemples :

```json
{"ts":"2026-09-23T14:02:11.482Z","type":"flag","code":"teleport","w":8,"score":8,"name":"Tricheur","ip":"198.51.100.7","detail":{"d":30,"max":5.2}}
{"ts":"2026-09-23T14:02:40.003Z","type":"kick","auto":true,"target":"Tricheur","ip":"198.51.100.7","code":"speed","score":51.2,"strikes":1}
{"ts":"2026-09-23T14:05:02.120Z","type":"ban","auto":true,"target":"Tricheur","ban":"account","until":"2026-09-23T15:05:02.120Z","reason":"triche détectée (teleport)"}
{"ts":"2026-09-23T14:06:13.550Z","type":"gm","by":"Amin","role":"admin","cmd":"unban","target":"Tricheur","removed":1}
{"ts":"2026-09-23T14:07:00.000Z","type":"auth","result":"fail","name":"victime","ip":"203.0.113.5","fails":6}
```

Types : `flag` (signalement), `warn` (seuil d'avertissement), `kick` / `ban` (sanctions automatiques),
`gm` (commande de l'équipe), `auth` (inscription, connexion, échec, nom refusé, compte banni), `conn`
(connexion refusée : origine, trop de connexions), `chat` (silence automatique), `invariant` (anomalie
d'inventaire corrigée).

Lire le journal :

```bash
# les 20 derniers événements
tail -n 20 server/data/security.log
# tout ce qui concerne un joueur (jq)
jq -c 'select(.name == "Tricheur" or .target == "Tricheur")' server/data/security.log
# les expulsions et bannissements automatiques
jq -c 'select(.type == "kick" or .type == "ban")' server/data/security.log
# les commandes des MJ
jq -c 'select(.type == "gm")' server/data/security.log
```

```powershell
# PowerShell
Get-Content server\data\security.log -Tail 20
Get-Content server\data\security.log | ConvertFrom-Json | Where-Object { $_.type -eq 'gm' } | Format-Table ts, by, cmd, target
```

En jeu, `/inspect nom` résume l'état d'un joueur sans ouvrir le fichier.

## 10. Bannissements et levée d'un bannissement

Les bannissements sont enregistrés dans `<DATA_DIR>/bans.json` :

```json
{
 "version": 1,
 "bans": [
  { "id": 3, "type": "account", "key": "tricheur", "name": "Tricheur", "until": 1790175902120,
    "reason": "speedhack", "author": "Amin", "created": 1790168702120, "auto": false },
  { "id": 4, "type": "ip", "key": "198.51.100.7", "until": null, "reason": "robots", "author": "Amin", "created": 1790168800000 }
 ],
 "offenses": { "tricheur": 1 }
}
```

`until` est un horodatage en millisecondes (`null` = définitif) ; les bannissements expirés sont retirés
automatiquement. `offenses` compte les bannissements automatiques d'un compte (la durée du suivant double).

Lever un bannissement :
1. **en jeu** (recommandé) : `/unban nom` ou `/unban 198.51.100.7` (IP : administrateurs) ;
2. **à la main** : arrêter le serveur, supprimer l'entrée dans `bans.json`, redémarrer. (Le fichier est
   réécrit par le serveur à chaque modification : ne pas l'éditer pendant qu'il tourne.) Pour « pardonner »
   complètement, supprimer aussi la clé du compte dans `offenses`.

Un compte banni qui essaie de se connecter reçoit `auth_err` code `banned` : « Ce compte est banni encore
2 h. Raison : speedhack. » Un joueur banni pendant qu'il joue reçoit `kick` avec le même message.

## 11. Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `TRUST_PROXY` | `0` | nombre de proxys inverses de confiance devant le serveur (`1` derrière nginx) : active la lecture de `X-Forwarded-For` |
| `ALLOWED_ORIGINS` | `https://brumel.mciut.fr` | origines autorisées, séparées par des virgules ; `*` désactive le contrôle. La même origine que le serveur est toujours acceptée |
| `ALLOW_LOCALHOST_ORIGINS` | `1` | accepte `http(s)://localhost:*` et `127.0.0.1:*` |
| `ALLOW_NO_ORIGIN` | `0` (`1` sous `node --test`) | accepte les clients sans en-tête `Origin` (scripts, bots) |
| `ADMIN_NAMES` | *(vide)* | noms des administrateurs, séparés par des virgules |
| `MAX_CONN_PER_IP` | `5` | connexions simultanées par IP |
| `SECURITY_EXEMPT_LOOPBACK` | `1` | pas de limite par IP pour 127.0.0.1 / ::1 |
| `AUTH_TIMEOUT_S` | `120` | délai pour s'authentifier |
| `IDLE_KICK_MIN` | `30` | expulsion pour inactivité |
| `MSG_RATE_PER_S` / `MSG_BURST` | `60` / `120` | budget global de messages par connexion |
| `LOGIN_FREE_FAILS_ACCOUNT` / `LOGIN_FREE_FAILS_IP` | `5` / `8` | échecs gratuits avant verrouillage |
| `LOGIN_BACKOFF_BASE_MS` | `1000` | premier verrouillage (doublé à chaque échec) |
| `LOGIN_BACKOFF_MAX_ACCOUNT_S` / `LOGIN_BACKOFF_MAX_IP_S` | `300` / `900` | verrouillage maximal |
| `LOGIN_FORGET_MIN` | `15` | oubli des échecs après ce délai |
| `ACCOUNTS_PER_IP_PER_HOUR` | `5` | créations de comptes par IP et par heure |
| `SUSPICION_HALF_LIFE_MIN` | `10` | demi-vie des scores de suspicion |
| `SUSPICION_WARN` / `SUSPICION_KICK` | `15` / `50` | seuils d'avertissement et d'expulsion |
| `SUSPICION_BAN_AFTER_KICKS` / `SUSPICION_STRIKE_WINDOW_H` | `3` / `24` | expulsions avant bannissement automatique, et fenêtre |
| `AUTO_BAN_MIN` | `60` | durée du premier bannissement automatique (doublée à chaque récidive) |
| `SECURITY_LOG_MAX_MB` / `SECURITY_LOG_KEEP` | `5` / `3` | rotation du journal |
| `CHAT_LINK_WHITELIST` | `brumel.mciut.fr` | domaines autorisés dans la discussion |
| `MAX_GOLD` | `10000000` | or maximal d'un personnage |
| `SECURITY_ASSERT` | `0` (`1` sous `node --test`) | une anomalie d'inventaire lève une erreur au lieu d'être corrigée |

Exemple de déploiement derrière nginx :

```bash
TRUST_PROXY=1 ADMIN_NAMES=Amin PORT=3000 npm start
```

```nginx
location /ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Si le jeu est aussi servi depuis une autre adresse (application de bureau chargeant une page locale, test sur
le réseau local…), ajouter son origine à `ALLOWED_ORIGINS`.

## 12. Tests

- `server/test/security.test.js` : seaux à jetons, verrouillage progressif, validation des messages et
  pollution de prototype, IP et `X-Forwarded-For`, origines, filtre de noms, durées, bannissements
  (persistance, expiration, fichier corrompu), rotation du journal, scores et escalade, limites de connexion,
  refus répétés, invariants d'économie, champs de compte.
- `server/test/anticheat-movement.test.js` : rejeu de plus de 15 000 déplacements réalistes (gigue, pics de
  latence, rafales, saccades, sprint, roulades, village, camp, cimetière) → **zéro correction, zéro
  signalement** ; speed hack, téléportation, hors du monde, traversée de maison, déplacement après la mort,
  tolérance après téléportation par le serveur, contrat `maxSpeedAt`.
- `server/test/moderation.test.js` : nettoyage du texte, liens, répétitions, flood et silence automatique,
  `/ignore`, toutes les commandes de l'équipe, commandes refusées aux joueurs.
- `server/test/security-net.test.js` : contre le vrai serveur — origines, 5 connexions par IP, IP bannie,
  force brute, règles d'inscription, anciens mots de passe courts, bannissement persistant après redémarrage,
  délai d'authentification, expulsion pour inactivité, paquets malformés / trop gros / flood.
- `tests/security.mjs` (lancé par `npm test`) : scénario de bout en bout — un joueur honnête au réseau
  capricieux ne reçoit aucune correction ni aucun signalement, puis speed hack, téléportation, traversée de
  maison, paquets malformés, paquet de 10 Ko, commande MJ par un joueur, noms interdits, force brute, flood,
  expulsion puis bannissement automatique d'un tricheur récidiviste, outils d'administration.
