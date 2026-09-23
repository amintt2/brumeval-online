# Déploiement de Brumeval Online

Le serveur de jeu est un seul processus Node.js 22 : il sert le client compilé (`client/dist`), le WebSocket du jeu
(`/ws`) et une petite API JSON (`/health`, `/api/status`, `/api/version`). Il n'a besoin d'aucune base de données :
les comptes sont des fichiers JSON dans `DATA_DIR`.

Trois façons de le faire tourner :

1. [Docker](#1-docker) (recommandé) ;
2. [Node.js directement](#2-nodejs-directement-systemd-ou-pm2), avec systemd ou pm2 ;
3. dans les deux cas, derrière un [proxy inverse](#3-proxy-inverse-https) (nginx ou Caddy) pour le HTTPS.

---

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port HTTP et WebSocket (`/ws`) |
| `DATA_DIR` | `server/data` | Dossier des sauvegardes : `accounts/`, `backups/`, `accounts.v1.bak.json` |
| `STATIC_DIR` | `client/dist` | Dossier du client compilé |
| `TRUST_PROXY` | `0` | Nombre de proxys inverses de confiance devant le serveur (`1` derrière nginx/Caddy). Voir [plus bas](#trust_proxy) |
| `MAX_PLAYERS` | `100` | Nombre maximal de joueurs connectés simultanément |
| `WS_COMPRESSION` | activée | `0` désactive la compression WebSocket permessage-deflate |
| `WS_DEFLATE_LEVEL` | `3` | Niveau de compression WebSocket (1 = rapide … 9 = plus compact) |

Les chemins relatifs sont résolus depuis la racine du dépôt.

---

## 1. Docker

L'image est construite en plusieurs étapes : compilation du client avec Vite, installation des seules dépendances
d'exécution du serveur (`ws`), puis image finale `node:22-alpine` (≈ 60 Mo + les modèles 3D) qui tourne sous
l'utilisateur non privilégié `node`.

### Avec docker compose

```bash
docker compose up -d --build      # construit l'image et démarre le serveur sur le port 3000
docker compose logs -f            # journaux
docker compose ps                 # état, dont le résultat du healthcheck (healthy / unhealthy)
docker compose down               # arrêt propre (les comptes sont enregistrés avant la sortie)
```

`docker-compose.yml` lit trois variables facultatives (dans l'environnement ou un fichier `.env` à côté) :

```dotenv
BRUMEVAL_PORT=3000   # port publié sur l'hôte
TRUST_PROXY=1        # 1 si un proxy inverse est devant (recommandé), 0 sinon
MAX_PLAYERS=100
```

Si le proxy inverse tourne sur la même machine, publiez le port uniquement en local :
`"127.0.0.1:${BRUMEVAL_PORT:-3000}:3000"` dans `docker-compose.yml`.

### Avec docker seul

```bash
docker build -t brumeval .
docker run -d --name brumeval --restart unless-stopped \
  -p 3000:3000 -e TRUST_PROXY=1 \
  -v brumeval-data:/app/server/data \
  brumeval
```

- **Volume** : `/app/server/data` contient toutes les sauvegardes. Sans volume, les comptes disparaissent avec le
  conteneur.
- **Healthcheck** : toutes les 30 s, `wget http://127.0.0.1:$PORT/health`. Le conteneur passe `unhealthy` si le
  serveur ne répond plus.
- **Arrêt** : `docker stop` envoie `SIGTERM` ; le serveur enregistre tous les comptes, ferme les connexions puis
  s'arrête (moins de 5 s). Ne forcez pas un `docker kill`.

### Reprendre des comptes existants dans Docker

Copiez l'ancien dossier de données dans le volume, **serveur arrêté** :

```bash
docker compose stop
docker run --rm -v brumeval-data:/data -v "$PWD/server/data:/src:ro" alpine \
  sh -c 'cp -a /src/. /data/ && chown -R 1000:1000 /data'
docker compose start
```

Un ancien `accounts.json` (format v0.1) est importé automatiquement au démarrage (voir
[Sauvegardes](#4-sauvegardes-et-restauration)).

### Mise à jour

```bash
git pull
docker compose up -d --build
```

Les joueurs connectés sont déconnectés quelques secondes ; le client se reconnecte tout seul et affiche
« Nouvelle version disponible — recharger » quand la version du serveur ou du client a changé.

---

## 2. Node.js directement (systemd ou pm2)

Prérequis : Node.js **22** ou plus récent.

```bash
git clone <dépôt> /opt/brumeval && cd /opt/brumeval
npm ci
npm run build          # compile le client dans client/dist
npm start              # http://localhost:3000
```

### systemd

`/etc/systemd/system/brumeval.service` :

```ini
[Unit]
Description=Brumeval Online (serveur de jeu)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=brumeval
WorkingDirectory=/opt/brumeval
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=TRUST_PROXY=1
Environment=DATA_DIR=/var/lib/brumeval
ExecStart=/usr/bin/node server/src/index.js
# SIGTERM : le serveur enregistre les comptes puis s'arrête
KillSignal=SIGTERM
TimeoutStopSec=20
Restart=on-failure
RestartSec=3
# durcissement
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/brumeval
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /var/lib/brumeval --create-home brumeval
sudo systemctl daemon-reload
sudo systemctl enable --now brumeval
journalctl -u brumeval -f
```

Mise à jour : `git pull && npm ci && npm run build && sudo systemctl restart brumeval`.

### pm2

```bash
npm install -g pm2
PORT=3000 TRUST_PROXY=1 pm2 start server/src/index.js --name brumeval --kill-timeout 15000
pm2 save && pm2 startup        # redémarrage automatique au démarrage de la machine
pm2 logs brumeval
```

Gardez **une seule instance** (pas de mode cluster) : l'état du monde vit en mémoire dans le processus.

---

## 3. Proxy inverse (HTTPS)

Le proxy termine le TLS et transmet tout au serveur de jeu, y compris la **mise à niveau WebSocket** de `/ws`
(en-têtes `Upgrade` et `Connection`). Réglez ensuite `TRUST_PROXY=1`.

### Caddy (le plus simple : certificat HTTPS automatique)

```caddyfile
brumel.example.fr {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

Caddy transmet les WebSockets et ajoute `X-Forwarded-For` sans configuration supplémentaire.

### nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name brumel.example.fr;
    ssl_certificate     /etc/letsencrypt/live/brumel.example.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/brumel.example.fr/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 120s;      # le serveur envoie un ping WebSocket toutes les 15 s
        proxy_send_timeout 120s;
    }
}

server {
    listen 80;
    server_name brumel.example.fr;
    return 301 https://$host$request_uri;
}
```

Le serveur compresse déjà lui-même (brotli/gzip pour les fichiers, permessage-deflate pour le WebSocket) : inutile
d'activer `gzip on` dans nginx. Si le proxy recompresse quand même, rien ne casse.

### TRUST_PROXY

Le serveur utilise l'adresse IP des joueurs pour les limites anti-abus et les journaux.

- `TRUST_PROXY=0` (défaut) : l'adresse de la connexion TCP est utilisée et `X-Forwarded-For` est **ignoré** (n'importe
  qui peut l'inventer). À utiliser quand le port du jeu est exposé directement.
- `TRUST_PROXY=1` : un proxy de confiance est devant ; l'adresse du joueur est la dernière entrée qu'il a ajoutée à
  `X-Forwarded-For`. **Ne l'activez que si le port 3000 n'est pas joignable depuis Internet** (sinon un joueur
  pourrait choisir son adresse).
- `TRUST_PROXY=2`, `3`… : plusieurs proxys en chaîne (par exemple Cloudflare puis nginx).

---

## 4. Sauvegardes et restauration

Contenu de `DATA_DIR` :

```
DATA_DIR/
├── accounts/<nom>.json           un fichier par compte (nom en minuscules)
├── backups/comptes-AAAA-MM-JJ.json.gz   sauvegarde quotidienne de tous les comptes (7 jours conservés)
└── accounts.v1.bak.json          ancien fichier v0.1, conservé après l'import automatique
```

- **Écriture** : toutes les 10 s, seuls les comptes modifiés sont réécrits, de façon atomique (fichier temporaire,
  `fsync`, renommage) — une coupure de courant laisse toujours l'ancienne ou la nouvelle version, jamais un fichier
  à moitié écrit. Les comptes sont aussi enregistrés à chaque déconnexion et à l'arrêt du serveur.
- **Migration v0.1** : au premier démarrage d'une version ≥ 0.2, `DATA_DIR/accounts.json` est importé
  automatiquement (un fichier par compte), puis renommé en `accounts.v1.bak.json`. Chaque compte passe par
  `migrateAccount()` qui donne une valeur par défaut à tout nouveau champ : les anciennes sauvegardes restent
  toujours lisibles.
- **Sauvegardes quotidiennes** : une archive gzip par jour dans `backups/` (vérifiée toutes les heures et au
  démarrage), au format de l'ancien `accounts.json`. Les 7 plus récentes sont gardées.
- **Sauvegarde hors machine** (recommandée) : copiez régulièrement `backups/` ailleurs, par exemple
  `rsync -a /var/lib/brumeval/backups/ sauvegarde@autre-machine:brumeval/` dans un cron, ou pour Docker :

  ```bash
  docker run --rm -v brumeval-data:/data:ro -v "$PWD:/out" alpine \
    tar czf /out/brumeval-$(date +%F).tar.gz -C /data .
  ```

### Restaurer une sauvegarde quotidienne

Serveur **arrêté** :

```bash
cd "$DATA_DIR"
mv accounts accounts.avant-restauration          # garde l'état actuel de côté
gunzip -c backups/comptes-2026-09-20.json.gz > accounts.json
# redémarrez le serveur : accounts.json est importé automatiquement comme une migration v0.1
```

Pour restaurer **un seul** compte, supprimez seulement `accounts/<nom>.json` (les autres fichiers sont plus récents
et gardés tels quels), placez l'archive décompressée en `accounts.json` puis redémarrez : seuls les comptes absents
de `accounts/` sont importés.

Un fichier de compte illisible est mis de côté (`<nom>.json.corrompu-<date>`) avec un message dans le journal, sans
empêcher le démarrage.

---

## 5. Supervision

| Point d'accès | Contenu |
|---|---|
| `GET /health` | État détaillé : `status` (`ok`, ou `degraded` si le p95 du tick dépasse 50 ms), version, build du client, temps de fonctionnement, joueurs, monstres (dont éveillés), durées du tick p50/p95/p99, débit sortant par client, sauvegardes, mémoire |
| `GET /api/status` | Pour le launcher et les pages publiques : `online`, `max`, `version`, `build`, `motd` (CORS ouvert) |
| `GET /api/version` | `{ version, build }` : les clients web s'en servent pour savoir s'il faut recharger |

Exemple de surveillance externe : `curl -fsS https://brumel.example.fr/health | jq .status`.

Le journal affiche toutes les 5 minutes une ligne d'état (joueurs, tick moyen et p95, débit sortant) et un
avertissement « tick lent » si le p95 du tick dépasse la moitié de son budget (25 ms).

---

## 6. Cache HTTP et mises à jour du client

- `/assets/*` (fichiers de Vite dont le nom contient une empreinte) : `Cache-Control: public, max-age=31536000,
  immutable` — téléchargés une seule fois.
- `index.html`, `/models`, `/icons`, `/ui` : `no-cache` + `ETag` : le navigateur revalide et reçoit `304 Not
  Modified` tant que rien n'a changé.
- Les fichiers texte (et les modèles `.glb`) sont servis compressés en brotli ou gzip ; la version compressée est
  gardée en mémoire.
- Après un redéploiement, la réponse `auth_ok` porte la nouvelle version (`ver`, `build`) : le client reconnecté
  affiche « Nouvelle version disponible — recharger ».
