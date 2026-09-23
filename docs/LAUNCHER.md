# Launcher de bureau et application web installable

Brumeval Online se joue de trois façons, toutes sur la même version du jeu :

| Support | Comment | Mise à jour du jeu | Mise à jour de l'application |
|---|---|---|---|
| Navigateur | https://brumel.mciut.fr | à chaque déploiement de `main` | — |
| Application web (PWA) | bouton « Installer » du navigateur | à chaque déploiement (réseau d'abord) | automatique (service worker) |
| **Launcher** Windows / macOS / Linux | installateur `.exe`, `.dmg`, `.AppImage`, `.deb` | à chaque déploiement (le jeu est chargé depuis le serveur) | **automatique** via GitHub Releases |

Le launcher n'embarque pas le jeu : il affiche les nouvelles et l'état du serveur, puis ouvre le jeu dans une
fenêtre dédiée. Le jeu est donc toujours à jour ; seul le launcher lui-même a besoin d'être mis à jour.

---

## 1. Installer le launcher (joueurs)

Les installateurs sont sur https://github.com/amintt2/brumeval-online/releases/latest.

- **Windows** : `Brumeval-Launcher-Setup-X.Y.Z.exe` (installation par utilisateur, sans droits administrateur,
  raccourcis Bureau et menu Démarrer « Brumeval Online »). `Brumeval-Launcher-Portable-X.Y.Z.exe` se lance sans
  installation, mais ne se met pas à jour tout seul (il signale les nouvelles versions).
  Tant que l'exécutable n'est pas signé, Windows SmartScreen peut afficher « Windows a protégé votre ordinateur » :
  cliquez sur **Informations complémentaires**, puis **Exécuter quand même**.
- **macOS** : `Brumeval-Launcher-X.Y.Z-mac-arm64.dmg` (Apple Silicon, M1 et suivants) ou `…-mac-x64.dmg` (Intel).
  Ouvrez le `.dmg` et glissez l'application dans *Applications*. L'application n'étant pas signée, Gatekeeper
  refuse le premier lancement (« Apple ne peut pas vérifier… ») :
  - clic droit (ou Ctrl + clic) sur l'application → **Ouvrir** → **Ouvrir** ; ou
  - *Réglages Système → Confidentialité et sécurité* → **Ouvrir quand même** ; ou, dans un terminal :
    `xattr -dr com.apple.quarantine "/Applications/Brumeval Launcher.app"`.
- **Linux** : `Brumeval-Launcher-X.Y.Z-linux-x86_64.AppImage` (`chmod +x` puis double-clic ; se met à jour tout
  seul) ou `brumeval-launcher_X.Y.Z_amd64.deb` (`sudo apt install ./brumeval-launcher_*.deb`).

### Utilisation

- **JOUER** ouvre le jeu sur le serveur configuré (par défaut https://brumel.mciut.fr). Si le jeu est déjà ouvert,
  le bouton affiche « En jeu » et ramène sa fenêtre au premier plan.
- **F11** : plein écran (launcher et jeu). **F5** dans le jeu : recharger la page.
- **Options** (roue dentée) :
  - *URL du serveur* : autre serveur (test, serveur local `localhost:3000`…). « Par défaut » remet le serveur officiel.
  - *Plein écran* : le jeu démarre en plein écran.
  - *Fermer le launcher en jouant* : le launcher se ferme au lancement de la partie (l'application se quitte avec le jeu).
  - *Vider le cache* : efface le cache HTTP, le service worker et ses caches (modèles 3D), les shaders compilés
    du jeu. Les préférences enregistrées par le jeu (stockage local) sont conservées.
- La taille et la position des fenêtres sont mémorisées (et replacées si un écran a été débranché).
- Les liens externes (GitHub, site…) s'ouvrent dans le navigateur du système.

Fichiers de l'application (réglages `settings.json`, journal `logs/launcher.log`) :
Windows `%APPDATA%\Brumeval Launcher`, macOS `~/Library/Application Support/Brumeval Launcher`,
Linux `~/.config/Brumeval Launcher`.

### Mises à jour du launcher

Au démarrage, puis toutes les 4 heures, le launcher interroge les releases GitHub (`electron-updater`). Une
nouvelle version est téléchargée en arrière-plan (barre de progression en bas de la fenêtre) puis le bouton
**Redémarrer pour mettre à jour** l'installe. Sans clic, elle s'installe à la prochaine fermeture du launcher.

| Format | Mise à jour automatique |
|---|---|
| Windows NSIS (`Setup.exe`) | oui |
| Windows portable | non : bouton « Télécharger » vers la page des releases |
| Linux AppImage | oui |
| Linux `.deb` | oui (le mot de passe administrateur est demandé par `pkexec`) |
| macOS non signé | non : bouton « Télécharger » (Squirrel.Mac refuse d'installer une mise à jour non signée) |
| macOS signé et notarisé | oui, après avoir mis `"brumeval": { "macAutoUpdate": true }` dans `launcher/package.json` |

---

## 2. Développement

Le launcher est un **paquet npm séparé** dans `launcher/` : il ne fait pas partie des *workspaces* de la racine,
pour que l'installation du serveur de production ne télécharge jamais Electron.

```bash
cd launcher
npm install          # Electron, electron-builder, electron-updater, polices Cinzel / Alegreya Sans
npm start            # lance le launcher (mode développement : mises à jour désactivées)
npm test             # tests unitaires (URL, réglages, nouvelles, statut, messages d'erreur)
npm run smoke        # test de bout en bout sans fenêtre visible (voir ci-dessous)
npm run icons        # régénère les icônes PNG à partir de build/icon.svg
```

Pour jouer sur un serveur local, lancez `npm run dev` à la racine puis mettez `http://localhost:5173` (Vite)
ou `http://localhost:3000` (serveur de jeu) dans *Options → URL du serveur*. `Ctrl + Maj + I` ouvre les outils
de développement (uniquement hors version empaquetée).

### Organisation

```
launcher/
  package.json            dépendances, scripts, version du launcher
  electron-builder.yml    empaquetage (.exe, .dmg, .AppImage, .deb) et publication GitHub
  build/icon.svg          blason (source) → build/icon.png 1024 px + icônes PWA (npm run icons)
  scripts/
    prepare.cjs           copie dans src/renderer/vendor/ (ignoré par git) : illustrations des classes
                          (client/public/ui/class_*.png), blason, news.json de secours, polices
    render-icons.cjs      rasterisation du SVG avec Electron (sans fenêtre)
    smoke.cjs             test automatique
  src/main/               processus principal
    main.js               fenêtres, protocole brumeval://, sécurité, IPC, test automatique
    remote.js             nouvelles et état du serveur (réseau côté processus principal)
    updater.js            mise à jour automatique (electron-updater)
    store.js, log.js      réglages (écriture atomique) et journal
    lib/                  logique pure testée par node --test (URL, réglages, flux, erreurs)
  src/preload/launcher.js pont minimal window.brumeval (seule API exposée à l'interface)
  src/renderer/           interface du launcher (HTML/CSS/JS sans framework)
  test/                   tests unitaires
```

### Ce que le serveur de jeu publie pour le launcher

- `GET /news.json` (fichier `client/public/news.json`, copié dans `client/dist` par Vite) :

  ```json
  { "version": 1, "items": [ { "id": "v0.2", "date": "2026-09-23", "tag": "Mise à jour",
      "title": "…", "summary": "…", "body": ["ligne 1", "ligne 2"], "url": "https://… (optionnel)" } ] }
  ```

  Les nouvelles sont triées par date (la plus récente dépliée). Une entrée mal formée est ignorée. Si le serveur
  est injoignable, le launcher affiche la copie embarquée au moment du build, marquée « hors ligne ».
- `GET /api/status` puis `GET /health` (facultatifs) : JSON libre ; le launcher reconnaît notamment
  `players` / `online` / `playersOnline` (nombre, tableau ou `{ online, max }`), `maxPlayers`, `version`,
  `status: "maintenance"`, `ok: false`, `motd`. Si aucun des deux n'existe, le serveur est « En ligne » dès que
  la page du jeu répond. Le statut est rafraîchi toutes les 30 s, les nouvelles toutes les 10 min.

### Sécurité

- Toutes les fenêtres : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, `webSecurity`, pas de `<webview>`.
- L'interface du launcher est servie par un protocole privé `brumeval://launcher/` avec une CSP stricte
  (`default-src 'none'`, scripts/styles/polices/images locaux uniquement, `connect-src 'none'`) : elle ne touche
  jamais le réseau. Les appels réseau (nouvelles, statut) passent par le processus principal.
- Le pont `window.brumeval` n'expose que des fonctions précises ; chaque appel IPC vérifie qu'il vient de
  l'interface du launcher. Les réglages envoyés sont validés (URL http/https uniquement, sans identifiants).
- La fenêtre du jeu n'a **aucun** preload. Elle ne peut naviguer que sur l'origine du serveur configuré ;
  les autres liens et les `window.open` sont bloqués et ouverts dans le navigateur du système (http/https
  uniquement). Permissions accordées au seul serveur : plein écran, verrouillage du pointeur et du clavier,
  écriture dans le presse-papiers. Le jeu a sa propre session (`persist:brumeval-game`).
- Instance unique : relancer le launcher ramène la fenêtre existante.

### Test automatique

`npm run smoke` (après `npm run build` à la racine) démarre un serveur de jeu local sur le port 3205
(`SMOKE_PORT` pour en changer) avec un `DATA_DIR` temporaire, puis lance le launcher avec `LAUNCHER_SMOKE=1` :
fenêtres invisibles, profil temporaire, liens externes interceptés. Il vérifie l'isolation (pas de `require`
ni de `process` dans la page), la CSP (`eval` bloqué), le chargement des nouvelles et du statut, le bouton
JOUER, le titre de la page du jeu, le service worker (modèles en cache), le blocage des navigations et des
popups, le vidage du cache et la fermeture, puis quitte avec le code 0 (ou 1 et la raison).

- `npm run smoke:packaged` fait la même chose avec l'application empaquetée (`dist/win-unpacked`, …).
- `LAUNCHER_SMOKE_URL=https://brumel.mciut.fr npm run smoke` teste un serveur distant.
- `LAUNCHER_SMOKE_SHOTS=<dossier>` enregistre des captures de l'interface.

---

## 3. Construire les installateurs

```bash
cd launcher
npm run dist:win     # dist/Brumeval-Launcher-Setup-X.Y.Z.exe + Brumeval-Launcher-Portable-X.Y.Z.exe
npm run dist:mac     # dist/*.dmg + *.zip (x64 et arm64) — sur un Mac uniquement
npm run dist:linux   # dist/*.AppImage + *.deb — sur Linux (ou WSL)
```

`dist/` est ignoré par git : ne commitez jamais les binaires. Sans certificat, ajoutez
`CSC_IDENTITY_AUTO_DISCOVERY=false` pour éviter qu'electron-builder cherche une identité de signature.

## 4. Publier une nouvelle version du launcher

1. Augmentez `version` dans `launcher/package.json` (par ex. `0.2.1`), commitez sur `main`.
2. Créez et poussez le tag correspondant :

   ```bash
   git tag launcher-v0.2.1
   git push origin launcher-v0.2.1
   ```

3. Le workflow **Launcher** (`.github/workflows/launcher.yml`) :
   - vérifie que le tag correspond à la version du `package.json` ;
   - crée un brouillon de release `launcher-v0.2.1` ;
   - construit en parallèle Windows (`windows-latest`), macOS (`macos-latest`) et Linux (`ubuntu-latest`),
     et téléverse les installateurs **et** les fichiers `latest.yml`, `latest-mac.yml`, `latest-linux.yml`
     (+ `.blockmap`) dont electron-updater a besoin ;
   - lance le test automatique de l'application Windows empaquetée contre un serveur local ;
   - publie la release (`--latest`) seulement si tout a réussi.

   Les launchers installés trouvent la mise à jour au prochain démarrage (ou dans les 4 heures).
4. Un lancement manuel du workflow (*Actions → Launcher → Run workflow*) construit sans publier : les
   installateurs sont joints à l'exécution (artefacts, 14 jours).

Remarques :

- electron-updater lit la release marquée **Latest** du dépôt. Si le dépôt publie un jour d'autres releases
  (par ex. `v0.3.0` pour le jeu), publiez-les en *pre-release* ou sans l'option *Latest*, sinon les launchers
  ne trouveront plus leur `latest.yml`.
- Le dépôt doit être **public** pour que les launchers téléchargent les mises à jour sans jeton. Pour un dépôt
  privé, il faudrait un fournisseur `generic` (fichiers servis par https://brumel.mciut.fr) : changez `publish`
  dans `electron-builder.yml`.
- Le jeton `GITHUB_TOKEN` fourni par Actions suffit (permission `contents: write`), aucun secret à créer.
- La CI (`.github/workflows/ci.yml`) teste chaque push et pull request vers `main` : `npm ci`, `npm test`,
  `npm run build` à la racine, et les tests unitaires du launcher (sans télécharger Electron).

## 5. Signature du code

Sans signature, tout fonctionne mais les systèmes affichent des avertissements (SmartScreen, Gatekeeper) et la
mise à jour automatique est désactivée sur macOS. Le workflow signe automatiquement dès que ces secrets du
dépôt existent (*Settings → Secrets and variables → Actions*) :

| Secret | Rôle |
|---|---|
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | certificat de signature de code Windows (`.pfx` encodé en base64) et son mot de passe |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | certificat *Developer ID Application* (`.p12` en base64) et son mot de passe |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | notarisation Apple (compte Apple Developer, 99 $/an) |

- **Windows** : un certificat OV supprime l'avertissement « éditeur inconnu » ; la réputation SmartScreen
  s'acquiert avec le nombre de téléchargements (immédiate avec un certificat EV, qui exige une clé matérielle ou
  un service de signature dans le cloud comme Azure Trusted Signing).
- **macOS** : signature *Developer ID* + notarisation obligatoires pour ouvrir l'application sans manipulation
  et pour que Squirrel.Mac accepte les mises à jour. Une fois en place, mettez
  `"brumeval": { "macAutoUpdate": true }` dans `launcher/package.json` et publiez une nouvelle version.
- **Linux** : pas de signature nécessaire.

---

## 6. Application web installable (PWA)

- `client/public/manifest.webmanifest` : nom, icônes 192/512 (+ maskable), couleurs `#0b0d12`, affichage plein
  écran (fenêtre autonome sur ordinateur), orientation paysage.
- `client/public/sw.js` : service worker enregistré par `client/src/pwa.js` (import dynamique à la fin de
  `client/src/main.js`), jamais avec le serveur de développement Vite (rechargement à chaud intact).
  - `/models/`, `/icons/`, `/ui/`, `/pwa/` : **cache d'abord**, puis rafraîchissement en arrière-plan (un modèle
    mis à jour par un déploiement est utilisé au chargement suivant). Les 404 ne sont jamais mis en cache.
    À la première visite, la page transmet au service worker les fichiers déjà téléchargés.
  - pages (`index.html`), `/assets/` (JS/CSS de Vite), manifeste : **réseau d'abord** — les joueurs web ont
    toujours le dernier déploiement ; le cache ne sert qu'en cas de coupure.
  - `/ws`, `/news.json`, `/api/*`, `/health` et les autres origines ne sont jamais interceptés.
  - Caches versionnés (`brumeval-assets-v1`, `brumeval-pages-v1`) : augmentez `VERSION` dans `sw.js` quand la
    stratégie change, les anciens caches sont supprimés à l'activation.
- Dépannage : `https://brumel.mciut.fr/?sw=0` désinscrit le service worker et vide ses caches.
- Les icônes (`client/public/pwa/`) sont générées depuis `launcher/build/icon.svg` par `npm run icons` (dans `launcher/`).
