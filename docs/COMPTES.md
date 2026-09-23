# Comptes, personnages, sessions et clés d'accès

Depuis la v0.2, Brumeval Online sépare le **compte** (qui se connecte) des **personnages** (qui jouent).

## Pour les joueurs

- **Un compte** = un nom de compte + un mot de passe (6 à 64 caractères). Il contient **jusqu'à 5 personnages**.
- Après la connexion, l'**écran des personnages** affiche pour chacun : nom, classe, niveau, zone, dernière partie,
  et un aperçu 3D du personnage sélectionné. Boutons : **Jouer** (ou Entrée, ou double-clic), **Créer un
  personnage**, **Supprimer** (il faut taper le nom du personnage pour confirmer), **Compte**, **Se déconnecter**.
- Les noms de personnages sont **uniques sur tout le serveur** (sans tenir compte des majuscules ni des accents
  trompeurs) : c'est à eux qu'on chuchote (`/w nom message`). Un même personnage ne peut pas être en jeu deux fois.
- **Changer de personnage** en jeu : Échap → Menu → « Changer de personnage » (le personnage est sauvegardé et
  quitte le monde).
- **Anciens joueurs** : chaque personnage de la v0.1 est devenu un compte du **même nom**, avec le **même mot de
  passe**, contenant ce personnage avec toute sa progression (niveau, expérience, or, sac, équipement, quêtes,
  position, écho de mort…).

### Rester connecté

La case « Rester connecté » (cochée par défaut dans le launcher, décochée par défaut dans un navigateur, votre
choix est retenu) mémorise la connexion sur cet appareil pendant **30 jours après la dernière utilisation**. Au
lancement suivant, le jeu ouvre directement l'écran des personnages avec le dernier joué présélectionné.

- « Se déconnecter » oublie la connexion de cet appareil.
- « Compte » → « Se déconnecter partout » oublie tous les appareils et ferme les autres connexions ouvertes.
- Changer de mot de passe déconnecte tous les autres appareils mémorisés.

### Clés d'accès (passkeys)

Une clé d'accès remplace le mot de passe par l'empreinte, le visage ou le code de votre appareil (Windows Hello,
Touch ID / Face ID, Android, gestionnaire de mots de passe, clé de sécurité USB/NFC…).

- Après une connexion par mot de passe, le jeu propose « Ajouter une clé d'accès (passkey) » (bouton « Plus tard »
  pour masquer l'offre ; elle reste disponible dans **Compte**).
- Pour se connecter : « Se connecter avec une passkey » sur l'écran de connexion — **pas besoin de taper son nom**,
  l'appareil propose les clés enregistrées pour le site.
- **Compte** liste vos clés (date d'ajout, dernière utilisation) : renommer, supprimer, en ajouter (10 au maximum).
- Fonctionne dans Chrome, Edge, Firefox et Safari récents, et dans le launcher (Windows Hello sous Windows). Le site
  doit être en **HTTPS** (ou `http://localhost` en développement).

## Pour les administrateurs

### Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `RP_ID` | hôte de la requête WebSocket sans le port (`localhost` en développement) | Domaine des clés d'accès (« relying party »). En production : `brumel.mciut.fr`. Une clé créée pour un domaine ne fonctionne que sur ce domaine et ses sous-domaines : **ne changez plus cette valeur** une fois des clés enregistrées. Si l'hôte vu par le serveur ne correspond pas à l'origine de la page (proxy qui réécrit `Host`) et que `RP_ID` n'est pas défini, l'hôte de l'origine de la page est utilisé. |
| `ALLOWED_ORIGINS` | `https://brumel.mciut.fr` | Origines web autorisées (voir docs/SECURITE.md). Ce sont aussi les origines acceptées dans les réponses WebAuthn, en plus de l'origine de la page qui a ouvert la connexion. |
| `ACCOUNTS_PER_IP_PER_HOUR` | `5` | Créations de comptes par adresse IP et par heure. |
| `LOGIN_FREE_FAILS_*`, `LOGIN_BACKOFF_*` | voir docs/SECURITE.md | Limitation des tentatives (mot de passe, jetons et clés d'accès). |

Derrière nginx, transmettez l'en-tête `Host` (`proxy_set_header Host $host;`) ou définissez `RP_ID`.
Le launcher charge le site en HTTPS : les clés d'accès y fonctionnent comme dans le navigateur.

### Stockage

Un fichier par **compte** : `DATA_DIR/accounts/<compte en minuscules>.json` (écriture atomique, sauvegarde
quotidienne compressée dans `backups/`). Schéma v3 :

```json
{
  "v": 3, "login": "Nom", "salt": "…", "hash": "…", "uid": "…",
  "role": "gm", "lastIp": "…", "created": 0, "lastSeen": 0, "lastChar": "a1b2c3d4e5f6",
  "chars": [ { "id": "a1b2c3d4e5f6", "name": "Nom", "cls": "warrior", "level": 9, "xp": 410, "gold": 1234,
               "inv": [], "eq": {}, "quests": {}, "x": 52.5, "z": 28.25, "echo": null, "…": "…" } ],
  "sessions": [ { "id": "…", "h": "sha256 du jeton", "created": 0, "exp": 0, "used": 0, "ua": "…" } ],
  "passkeys": [ { "id": "identifiant", "pk": "clé publique COSE", "counter": 3, "transports": ["internal"],
                  "label": "Chrome sur Windows", "created": 0, "used": 0 } ],
  "deleted": [ "personnages supprimés (10 derniers), pour une restauration manuelle" ]
}
```

- Les mots de passe sont hachés avec scrypt ; les jetons « Rester connecté » (256 bits aléatoires) ne sont stockés
  que **hachés** (SHA-256) ; les clés d'accès ne stockent que la **clé publique**.
- **Migration** (automatique au démarrage, `migrateAccount` dans `server/src/persistence.js`) : `accounts.json`
  (v0.1) et les fichiers par personnage (v0.2) deviennent des comptes v3 avec un seul personnage. Les fichiers v0.2
  d'origine sont copiés une fois dans `DATA_DIR/accounts.v2.bak/` avant d'être réécrits.
- **Restaurer un personnage supprimé** : serveur arrêté, déplacer l'entrée de `deleted` vers `chars` dans le
  fichier du compte (en retirant `deletedAt`), à condition que son nom soit encore libre.
- Rôles (`/role`) : le rôle est enregistré sur le compte (il vaut pour tous ses personnages). `ADMIN_NAMES`
  accepte des noms de compte ou de personnage.
- Un bannissement visant un personnage (`/ban nom`) bloque la connexion à tout son compte.

### Protocole (résumé, détails dans `shared/protocol.js`)

```
register { name, password, remember? }        → account_ok { account, chars, token?, method }
login { name, password, remember }            → account_ok
login_token { token }                         → account_ok { token: nouveau jeton }   (rotation à chaque usage)
passkey_login_options {} → passkey_options → passkey_login_verify { resp, remember? } → account_ok
char_create { name, cls } / char_delete { id, confirm } → account_ok (liste à jour)  | account_err
char_select { id }                            → auth_ok (inchangé : le reste du jeu est identique)
char_logout {}                                → account_ok (retour à la sélection)
logout {} / logout_all {}                     → logged_out
passkey_reg_options {} → passkey_options → passkey_reg_verify { resp, label? } → account_ok
passkey_rename / passkey_delete / password_change / account_get → account_ok | account_err
```

Compatibilité : un client de la version précédente (`register { name, password, cls }`, ou `login` **sans** champ
`remember`) crée ou ouvre le compte et entre directement dans le monde avec le personnage du même nom (ou le dernier
joué), comme avant. Les bots de test (`tests/bot.mjs`, `tests/security.mjs`, `tests/load.mjs`) utilisent ce chemin.

### Sécurité

- Identifiants de personnage acceptés uniquement s'ils appartiennent au compte connecté (sinon `not_found` et
  signalement `foreign_char`).
- Limites par connexion et par type de message (`server/src/security/ratelimit.js`), tentatives de connexion
  limitées par IP et par compte avec attente croissante ; jetons inconnus (`token_guess`) et clés d'accès refusées
  (`passkey_fail`) sont signalés au système de suspicion (docs/SECURITE.md).
- Défis WebAuthn : un par connexion, à usage unique, valables 3 minutes ; origine, RP ID, signature, compteur de
  signature et identifiant utilisateur (« user handle ») sont vérifiés par `@simplewebauthn/server`.

### Tests

`server/test/accounts.test.js` : migrations v0.1 / v0.2 (fixtures), cycle de vie des jetons, personnages (création,
unicité des noms, limite de 5, appartenance, suppression confirmée), changement de personnage, clients anciens,
changement de mot de passe, et passkeys de bout en bout avec un **authentificateur logiciel** (ES256, attestation
« none ») : inscription, connexion, mauvaise origine, mauvais défi, défi rejoué, signature invalide, compteur
rejoué, user handle d'un autre compte, clé inconnue ou supprimée. `tests/bot.mjs` joue le parcours complet.
