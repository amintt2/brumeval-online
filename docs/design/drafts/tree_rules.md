# L'Arbre des Brumes — règles du système (spécification pour les développeurs)

> Brouillon v0.3, commun à tous les brouillons d'arbre (`tree_survie`, `tree_guerrier`, `tree_mage`, `tree_rodeur`,
> passerelles). Contraignant pour la fusion : les brouillons de région doivent respecter les formats et règles ci-dessous.
> Référence de conception : ROADMAP.md §1 (retours joueurs) et §2 bis (arbre de compétences).

## 1. Principes

- **Un seul grand arbre commun** pour tous les personnages. Au niveau 1, un personnage n'a **que l'attaque de base de
  sa classe**. Chaque niveau donne des points que **le joueur place où il veut**. Plus aucune amélioration automatique
  des compétences.
- **Fondamentaux d'abord** (Roulade, Sprint, Saut, Garde, Attaque chargée), puis on se spécialise : la région de sa
  classe s'ouvre après 3 Fondamentaux.
- **On peut aller partout** : un mage peut apprendre des compétences de guerrier, mais il n'a « pas de don pour ça » :
  cela coûte plus cher et fonctionne moins bien.
- **Simple et accessible** : infobulles qui calculent tout, aperçu avant validation, réinitialisation gratuite
  jusqu'au niveau 10, aucune règle cachée.
- **Tout est validé par le serveur** avec le même code pur que le client (`shared/skills.js`).

## 2. Économie de points

- Niveau maximum **30** (`MAX_LEVEL` passe de 20 à 30).
- `points(L) = (L − 1) + floor(L / 5)` : 1 point par niveau à partir du niveau 2, plus 1 point bonus aux niveaux
  5, 10, 15, 20, 25 et 30.

| Niveau | 1 | 2 | 3 | 4 | 5 | 10 | 15 | 20 | 25 | 30 |
|---|---|---|---|---|---|---|---|---|---|---|
| Points | 0 | 1 | 2 | 3 | 5 | 11 | 17 | 23 | 29 | **35** |

- Rangs : certains nœuds ont 2 ou 3 rangs (`maxRank` ≤ 3) ; chaque rang coûte le coût du nœud.
- Les points non dépensés se gardent sans limite. Le nœud de départ de sa classe est acquis gratuitement au niveau 1.
- Ordre de grandeur : Fondamentaux 5 points, Survie 5–9, région de classe 18–25, passerelles/autres classes le reste.

## 3. Structure et coordonnées

| Zone | `region` | Où (repère global) | Taille |
|---|---|---|---|
| Cœur + Fondamentaux + anneau de Survie | `survie` | rayon 0–460 autour de (0, 0) | 5 + 34 nœuds |
| Guerrier | `guerrier` | départ `guerrier_depart` à (0, 500), angle 90° ; région jusqu'au rayon ~1500, secteur 50°–130° | ~70 |
| Mage | `mage` | départ `mage_depart` à (−433, −250), angle 210° ; secteur 170°–250° | ~70 |
| Rôdeur | `rodeur` | départ `rodeur_depart` à (433, −250), angle 330° ; secteur 290°–10° | ~70 |
| Lame spirituelle (Guerrier ↔ Mage) | `pont_gm` | angle ~150°, rayon 700–1200 | ~10 |
| Arcaniste sylvestre (Mage ↔ Rôdeur) | `pont_mr` | angle ~270°, rayon 700–1200 | ~10 |
| Chasseur (Rôdeur ↔ Guerrier) | `pont_rg` | angle ~30°, rayon 700–1200 | ~10 |

- Repère : **x vers la droite, y vers le haut**, angles en degrés dans le sens trigonométrique depuis +x.
  L'interface affiche `(x, −y)`.
- Chaque région a 3 branches en éventail à partir de son nœud de départ ; ses secteurs ne débordent pas de ±40° autour
  de son angle, pour laisser la place aux passerelles (secteurs ±20° autour de 30°, 150°, 270°).
- Préfixes d'id conseillés : `fond_`, `sv_`, `ks_` (Survie) ; `gu_`, `ma_`, `ro_` (classes) ; `gm_`, `mr_`, `rg_`
  (passerelles). Les ids d'abilities existantes de la v0.2 sont conservés (`strike`, `heavy_blow`, `firebolt`…).
- Liens **non orientés** : si A liste B, B liste A (vérifié par un test). Un lien vers un nœud d'un autre brouillon est
  permis (ex. Seuils → `guerrier_depart`).

## 4. Coûts et « pas de don »

### 4.1 Coût d'un nœud selon la classe du personnage

| Nœud | Guerrier | Mage | Rôdeur |
|---|---|---|---|
| Survie (dont Fondamentaux, Seuils, clés de voûte de Survie) | 1 | 1 | 1 |
| Région Guerrier | **1** | 2 | 2 |
| Région Mage | 2 | **1** | 2 |
| Région Rôdeur | 2 | 2 | **1** |
| `pont_gm` (Lame spirituelle) | 1 | 1 | 2 |
| `pont_mr` (Arcaniste sylvestre) | 2 | 1 | 1 |
| `pont_rg` (Chasseur) | 1 | 2 | 1 |
| Clé de voûte d'une **autre** classe (ou d'une passerelle non voisine) | 3 | 3 | 3 |
| Nœud de départ d'une autre classe | 2 (donne l'attaque de base de cette classe, avec Inaptitude) | | |

Fonction pure : `nodeCost(node, cls)` ; le coût d'un rang est ce même coût.

### 4.2 Inaptitude

- Chaque capacité a une classe d'origine `home` : `'warrior' | 'mage' | 'ranger'`, une liste pour les passerelles
  (`['warrior', 'mage']`), ou `null` (Fondamentaux, Survie : jamais d'Inaptitude).
- Si la classe du personnage n'est pas dans `home` : **puissance −25 %**, **coût en mana et en endurance +25 %**
  (arrondi à l'unité supérieure), **recharge +20 %**. La capacité affiche une icône « Inapte » orange.
- Réductions : `inaptitudeMult` (somme des réductions, ex. *Touche-à-tout* −0,5, *Érudit martial* dans la région Mage,
  etc.). **Plancher : il reste toujours au moins 40 % de la pénalité** (−10 % puissance, +10 % coût, +8 % recharge).
- **Attaque de référence** (pour que l'Inaptitude soit vraiment ressentie) : une capacité hors classe utilise
  `min(atk du personnage, atk qu'aurait un personnage de sa classe d'origine au même niveau avec le même équipement)`.
  Sans cette règle, un mage (atk de base 9 + 2,7/niv.) frapperait plus fort au Tourbillon qu'un guerrier
  (11 + 2,2/niv.) à haut niveau.
- Les variantes et passifs d'une capacité hors classe s'appliquent normalement (après la pénalité, voir §7.3).

### 4.3 Armes requises (par étiquette de capacité)

| Étiquette | Il faut | Sinon |
|---|---|---|
| `melee` (épées, haches, masses, lances…) | une arme de mêlée | capacité grisée (inutilisable) |
| `arc` | un arc ou une arbalète | grisée |
| `sort` | un focus : bâton, sceptre ou grimoire (main gauche) | **−20 % de puissance** |
| Fondamentaux, attaque de base de sa classe | rien | — |

Les passerelles peuvent assouplir ces règles (ex. Lame spirituelle : « une épée compte comme un focus à −10 % »).
L'équipement n'est plus réservé à une classe (§2 bis de la feuille de route) : le poids d'armure fait la différence.

### 4.4 Exemples

**Maëlle, mage niveau 18** (17 + 3 = **20 points**) veut le Tourbillon du guerrier.

1. Fondamentaux : Roulade, Sprint, Saut = 3 points. Région Mage : 10 points. Reste 7.
2. Chemin par la passerelle Lame spirituelle (voisine du Mage : 1 point par nœud) : 3 nœuds = 3 points. On arrive
   au bord de la région Guerrier, où chaque nœud coûte 2 : si le Tourbillon est à 2 nœuds de là, 4 points. Total 20.
   Autre chemin par le centre : Survie → Seuil de l'Acier (≈ 4 nœuds à 1) → `guerrier_depart` (2) → Tourbillon
   (2 nœuds à 2) = 10 points : plus cher, mais les nœuds de Survie servent aussi.
3. Son Tourbillon (base : ×1,7, 20 mana, 18 endurance, 10 s) devient : **×1,275**, **25 mana**, **23 endurance**,
   **12 s**, et utilise l'attaque de référence du guerrier (≈ 48 + arme au lieu de 55 + arme).
4. Il faut une **arme de mêlée** : avec son bâton, le Tourbillon est grisé. Si elle prend une épée, ses sorts perdent
   20 % (plus de focus), sauf si elle a pris le nœud de Lame spirituelle qui fait compter l'épée comme focus.
5. Bilan : pour ~7 points, un Tourbillon à 75 % des dégâts de celui d'un guerrier pur, 25 % plus cher et 20 % plus
   lent à revenir, sur un personnage bien plus fragile au contact. Viable et amusant, jamais meilleur que l'original.

**Tomas, rôdeur niveau 12** (11 + 2 = 13 points) : un nœud d'Arcaniste sylvestre (`pont_mr`, voisin : 1 point),
« Flèche de givre », `home: ['mage', 'ranger']` → **aucune Inaptitude**. Le même rôdeur dans Lame spirituelle
(`pont_gm`, non voisin) paie 2 points par nœud et subit l'Inaptitude.

**Guerrier niveau 25** qui veut une clé de voûte du Mage : 3 points, plus le chemin (2 par nœud Mage).

## 5. Fondamentaux, déblocage de la région, migration

- Les 5 nœuds `fondamental: true` sont reliés à la racine `coeur` (toujours acquise, non allouable) : ils
  s'apprennent **sans adjacence**, dans n'importe quel ordre.
- **Porte des 3 Fondamentaux** : tant que le personnage a moins de 3 Fondamentaux, il ne peut allouer que des
  Fondamentaux. Ensuite, tout nœud relié à un nœud acquis est disponible (région de classe, Survie, et au-delà).
- Racines de connexité d'un personnage : `coeur` + le nœud de départ de sa classe.
- **Nouveau personnage** : niveau 1 = attaque de base seulement ; niveaux 2–4 : 3 Fondamentaux ; niveau 5 : 2 points
  dans sa région (les capacités v0.2 de la classe doivent être à 1–2 nœuds du départ).
- **Personnages existants (v0.2, niveaux 1–20)** à la première connexion en v0.3 :
  - `fond_roulade` et `fond_sprint` **offerts** (liste `gift`, coût 0, non remboursables, comptent pour la porte) ;
  - tous leurs points `points(L)` disponibles, rien d'autre alloué ;
  - **une réinitialisation gratuite** en réserve (`respecFree: 1`) ;
  - un bouton « **Reprendre mon style** » propose en aperçu le chemin le moins cher vers les 3 capacités v0.2 de leur
    classe (les brouillons de classe fournissent `suggestedPath`) ; le joueur valide ou modifie.
  - Barre d'action : attaque de base en 1, potions en 5 et 6 (comme en v0.2).

## 6. Réinitialisation

- **Jusqu'au niveau 10 inclus** : gratuite, depuis la fenêtre de l'arbre, n'importe où hors combat.
- **Après le niveau 10** : chez le **Maître des arts** (nouveau PNJ au village, `npc_master` ; modèle à demander à
  assets-characters), contre de l'or :
  - réinitialisation complète : **25 × niveau** pièces d'or (500 au niveau 20, 750 au niveau 30) ;
  - retrait d'un seul nœud **feuille** (dont le retrait garde l'arbre valide) : **5 × niveau × coût du nœud**.
- La réinitialisation gratuite de migration (`respecFree`) s'utilise n'importe où, une fois.
- Les nœuds offerts (`gift`) restent. Changer de variante = retirer l'ancienne (feuille) puis prendre la nouvelle.
- Après une réinitialisation, les emplacements de la barre dont la capacité n'est plus connue sont vidés.
- Pas de réinitialisation en combat, mort, ou en zone rouge.

## 7. Format des données

### 7.1 Fichier d'arbre (fusion des brouillons → `shared/tree.js` ou `shared/tree.json`)

```js
{
  abilities: [{
    id, name, desc,               // FR
    kind,                         // melee | projectile | aoe_self | aoe_target | self_heal | buff | dash | channel |
                                  // summon | toggle | jump | guard | charge
    home,                         // 'warrior' | 'mage' | 'ranger' | [..] | null
    mp, st, cd, range?, radius?, power?, poise?, rec?, recSlow?, ...,
    tags: ['feu', 'givre', 'arcane', 'physique', 'saignement', 'poison', 'projectile', 'zone', 'mobilite',
           'defense', 'melee', 'arc', 'sort', ...],
    souls,                        // texte : engagement, interaction avec les télégraphes, poise
  }],
  nodes: [{
    id, region, branch, type,     // type: 'root' | 'skill' | 'variant' | 'passive' | 'keystone'
    name, desc, x, y, links: [],
    maxRank,                      // 1..3
    cost?,                        // informatif ; la vérité est nodeCost(node, cls)
    fondamental?, migrationGift?, minLevel?,
    ability?,                     // skill : capacité débloquée ; variant : capacité modifiée
    exclusiveGroup?,              // variantes : une seule par groupe
    requires?: [nodeId],          // prérequis supplémentaires hors adjacence (rare)
    effects: [Effect],
    vfx?,                         // intention visuelle (variantes)
  }],
  keystones: [{ id, name, upside, drawback, intent, minLevel? }],
}
```

### 7.2 Effets

`{ stat | mod, op, value, perRank?, atRank?, cap?, final? }`

- `stat` : statistique du personnage (`mhp`, `mmp`, `mst`, `stRegen`, `stRegenDelayMs`, `equilibre`, `crit`,
  `atkPct`, `resFeu`, `resGivre`, `resArcane`, `resPoison`, `potionPct`, `echoPickupR`, `echoOnMap`, `echoKeepOld`,
  `echoMax`, `cheatDeath`, `inaptitudeMult`, `ownClassPowerPct`, `dmgPct.<tag>` …).
- `mod` : champ d'une capacité, `"<abilityId>.<champ>"` (ex. `roulade.iframeMs`), ou `unlock` (value = id de capacité).
- `op` : `add` (ajoute), `pct` (pourcentage d'une stat), `mul` (ajoute à un multiplicateur : valeur finale =
  base × (1 + Σ mul)), `set` (remplace ; utilisé par les variantes).
- `perRank: true` : multiplié par le rang ; `atRank: n` : seulement à partir du rang n ; `cap` : borne ;
  `final: true` : appliqué en dernier, rien ne le modifie ensuite (clés de voûte).

### 7.3 Résolution d'une capacité : `resolveAbility(char, abilityId)` (pure, partagée)

1. Valeurs de base (`abilities[id]`).
2. Variante choisie du groupe (`set`).
3. `add` des passifs, puis `mul` (additionnés entre eux), puis bonus de stats du personnage.
4. Inaptitude (§4.2) puis pénalité d'arme (§4.3).
5. Garde-fous globaux (§11), puis effets `final`.

Le client affiche exactement ce résultat dans les infobulles, le livre et l'aperçu.

## 8. Contrat de validation serveur

État persistant par personnage (ajouté par la fonction de migration de comptes) :

```js
skills: {
  ver: 1,                    // version de l'arbre ; si elle change sans compatibilité → réinitialisation gratuite
  alloc: { [nodeId]: rank }, // nœuds achetés (le départ de classe et `coeur` sont implicites)
  gift: ['fond_roulade', 'fond_sprint'],
  respecFree: 0 | 1,
  loadout: [slot0..slot7],   // id de capacité, id d'objet consommable, ou null
}
```

`validateTree(cls, level, alloc, gift) → { ok, code?, node? }` (pure, `shared/skills.js`) vérifie **l'état complet** :

1. Chaque id existe, n'est pas `root`, et n'est pas le départ d'une autre classe sans chemin.
2. `1 ≤ rank ≤ maxRank` ; `level ≥ minLevel`.
3. `Σ nodeCost(node, cls) × rank` (hors `gift`) `≤ points(level)`.
4. Au plus un nœud par `exclusiveGroup`.
5. Porte : s'il y a un nœud non fondamental acquis, au moins 3 Fondamentaux (offerts compris).
6. **Connexité** : parcours en largeur depuis `{coeur, <classe>_depart}` sur les nœuds acquis ; tous doivent être
   atteints.
7. Variantes : leur capacité est débloquée ; `requires` satisfaits.

Règles de message :
- `skill_alloc` : le serveur applique la liste **dans l'ordre** sur une copie, valide l'état final, puis **tout ou
  rien**. Ajout uniquement (jamais de retrait par ce message).
- `skill_respec` : vérifie niveau / PNJ à moins de 5 m / or / hors combat ; retire ; revalide.
- Limites : 5 messages d'arbre par seconde, 64 nœuds par message ; au-delà, `security.flag(player, 'tree_spam', 1)`.
- Codes d'erreur (`S2C err`, message FR) : `tree_unknown`, `tree_points`, `tree_gate` (« Apprenez d'abord 3
  Fondamentaux »), `tree_link` (« Ce nœud n'est relié à rien de ce que vous connaissez »), `tree_exclusive`,
  `tree_rank`, `tree_level`, `tree_combat`, `tree_gold`, `tree_npc`, `loadout_bad`.
- Au chargement d'un compte : `validateTree` ; s'il échoue (arbre modifié par une mise à jour), réinitialisation
  complète gratuite + message système.
- Utilisation d'une capacité : le serveur vérifie qu'elle est **débloquée**, applique `resolveAbility`, et l'arme
  requise. Il ne fait jamais confiance aux valeurs du client.

## 9. Protocole (additions, `shared/protocol.js`)

```js
// C2S
SKILL_ALLOC: 'skill_alloc',     // { add: [{ id, r? }] }  r = rang visé (défaut : +1). Tout ou rien.
SKILL_RESPEC: 'skill_respec',   // { mode: 'all' | 'node', id?, npc? }  npc = entité Maître des arts (sauf gratuit)
LOADOUT: 'loadout',             // { slots: [8 × (abilityId | 'item:<itemId>' | null)] }
ABILITY: 'ability',             // { slot: 0..7, tg?, x?, z?, ph?: 'start' | 'release' }  (ph pour l'Attaque chargée)
JUMP: 'jump',                   // { dx, dz }  direction figée au décollage (0,0 = sur place)
GUARD: 'guard',                 // { on: boolean }
SETTINGS: 'settings',           // { keys: { action: code } }  touches, sauvegardées par compte
// existants v0.2 : dodge { dx, dz }, sprint { on }

// S2C
SKILLS: 'skills',               // { pts, spent, alloc, gift, respecFree, loadout }  à la connexion et après chaque changement
// SelfState : + equilibre, + riposte (ms restantes | 0), + air (1 en l'air), + guard (1 garde levée)
// FX : jump { src, dx, dz } · land { src, r? } · guard { src, on } · block { src, tg } · parry { src, tg }
//      perfect { src } (esquive parfaite) · charge { src, ms } · charged { src } (pleine charge)
//      vacille { src, ms } · guard_break { src }
// tele : + lo?, nb?, mag? (voir tree_survie.md §5)
```

- `ability.slot` désigne l'emplacement de la **barre du serveur** (le serveur connaît le `loadout`) ; le clic droit
  sur un monstre utilise toujours l'attaque de base, où qu'elle soit rangée.
- Compatibilité : les clients v0.2 envoient `slot 0..3` ; le serveur v0.3 garde le même sens (emplacements 1 à 4).
- Le saut ne change pas `maxSpeedAt` ; l'anti-triche ignore la hauteur (purement visuelle).

## 10. Barre d'action, livre et touches

- **Barre de 8 emplacements** (touches 1 à 8 par défaut), un `loadout` **par personnage**, sauvegardé sur le serveur.
- **Livre de compétences** (touche K) : toutes les capacités débloquées, avec leurs valeurs résolues (variante,
  passifs, Inaptitude en orange) ; **glisser-déposer** vers la barre ; clic droit sur un emplacement = le vider ;
  cadenas pour éviter les déplacements accidentels. Les potions se rangent aussi dans la barre.
- Par défaut : 1 attaque de base, 2–4 compétences dans l'ordre d'apprentissage, **5 potion de soin, 6 potion de mana**
  (habitude v0.2), 7–8 libres. Une nouvelle compétence apprise va dans le premier emplacement libre.
- **Options › Touches** : toute action est réassignable, y compris les boutons de souris (milieu, 4, 5) et les
  combinaisons avec Maj / Ctrl / Alt. Conflit = avertissement et échange proposé. « Rétablir par défaut ».
  Touches enregistrées par `code` physique (AZERTY/QWERTY), libellé affiché via `navigator.keyboard.getLayoutMap()`
  quand il existe. Sauvegarde : par compte sur le serveur (`settings`), copie locale en `localStorage`.

| Action | Défaut |
|---|---|
| Se déplacer | ZQSD / WASD (touches physiques) |
| Roulade | Espace |
| Sprint | Maj gauche (maintenir) |
| Saut | C |
| Garde | E (maintenir) |
| Attaque chargée | maintenir la touche (ou le clic droit) de l'attaque de base |
| Barre 1–8 | 1–8 |
| Cible suivante | Tab |
| Arbre des Brumes | N |
| Livre de compétences | K |
| Carte | M |

## 11. Garde-fous d'équilibrage (appliqués par `resolveAbility`)

| Valeur | Borne |
|---|---|
| Invulnérabilité de roulade | ≤ 450 ms et ≤ 75 % de la recharge de roulade |
| Coût d'une roulade | ≥ 12 (sauf effet `final` de clé de voûte) |
| Endurance max / régénération / délai | ≤ 180 / ≤ 55 par s / ≥ 0,5 s |
| Sprint | consommation ≥ 10/s, vitesse ≤ ×1,65 |
| Réduction de recharge | ≤ 30 % |
| Réduction des dégâts en garde | 100 % seulement avec un bouclier |
| Équilibre permanent / résistances | ≤ 60 / ≤ 60 % |
| Tir en mouvement | toujours limité à 40 % de la vitesse (aucune variante ne le lève) |
| Inaptitude | au moins 40 % de la pénalité reste |

Intentions (à vérifier avec `tests/balance/sim.mjs`) : classes pures à ±15 % d'efficacité aux niveaux 5, 15 et 30 ;
un hybride optimisé à 85–95 % d'un pur au niveau 30 ; aucun parcours ne dépasse le pur de sa classe principale.

## 12. Interface de l'arbre (touche N)

- Plein écran, **canevas 2D** déplaçable (glisser) et zoomable (molette, 0,3 à 2,0) ; double-clic = recentrer sur
  son nœud de départ ; mini-carte de l'arbre en bas à droite ; ouverture centrée sur ses nœuds acquis.
- **Lisible en 1280 × 720** : panneau de détail à droite (320 px), police ≥ 12 px ; les noms s'affichent à partir du
  zoom 0,8 ou au survol ; le reste est lisible par les formes.
- **Formes et couleurs par type** (la forme suffit, pour les daltoniens) :
  - compétence : grand cercle doré (26 px) avec l'icône ;
  - variante : losange turquoise ; les variantes d'un même groupe sont reliées par un arc pointillé, celle choisie est
    pleine, les autres grisées avec un cadenas ;
  - passif : petit cercle gris-bleu (14 px) avec les rangs « 1/3 » ;
  - clé de voûte : octogone pourpre (34 px) ;
  - Fondamentaux : anneau blanc-or, et le Cœur des Brumes au centre.
  - Fond teinté par région : Guerrier rouge (#c0392b), Mage bleu (#2e6fd8), Rôdeur vert (#2e9e4f), Survie brume
    neutre, passerelles en dégradé des deux couleurs.
- **États** : acquis (plein, lumineux), disponible (contour qui pulse), verrouillé (40 % d'opacité). Liens : acquis =
  trait doré de 3 px, disponible = 2 px clair, autres = 1 px sombre. Coût 2 ou 3 en pastille orange, avec la mention
  « Pas de don : 2 points, Inaptitude −25 % ».
- **Recherche** (champ en haut, Ctrl+F) : les nœuds dont le nom, la description ou les étiquettes correspondent
  s'illuminent ; Entrée = aller au suivant.
- **Chemin** : survoler un nœud non disponible dessine le chemin le moins cher (Dijkstra sur les coûts du
  personnage) et affiche son coût total.
- **Aperçu avant validation** : un clic ajoute le nœud (ou tout le chemin) en aperçu, avec les points restants, les
  statistiques avant → après (gains en vert) ; **Valider (n points)** envoie un seul `skill_alloc` ; **Annuler** vide
  l'aperçu. Rien n'est dépensé sans validation.
- Infobulle : nom, type, coût pour ce personnage, effets par rang, valeurs résolues de la capacité, arme requise
  (en rouge si l'arme équipée ne convient pas), variantes concurrentes.
- À chaque montée de niveau : notification « +1 point de compétence » et pastille sur l'icône de l'arbre ; au
  niveau 2, conseil « Apprenez la Roulade ».
- Performances : ~300 nœuds, redessin seulement quand la vue ou l'état change.

## 13. Questions ouvertes pour la synthèse

1. Ids exacts des nœuds de départ de classe (`guerrier_depart`, `mage_depart`, `rodeur_depart` proposés) et des
   abilities de base existantes (`strike`, `firebolt`, `shot`).
2. Règle de l'attaque de référence (§4.2) ou séparation Force / Esprit dans la conception des objets ?
3. Vacillement du joueur (tree_survie.md §4) : validé par l'équipe combat ?
4. Coût de réinitialisation (25 × niveau) à caler sur l'économie de la v0.3 (or gagné par heure au niveau 20–30).
5. `MAX_LEVEL` 20 → 30 et courbe d'XP au-delà du niveau 20 (hors périmètre de ce brouillon).
