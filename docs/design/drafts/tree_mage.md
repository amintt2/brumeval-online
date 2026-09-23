# Arbre des Brumes — région **Mage** et passerelle **Arcaniste sylvestre** (brouillon v0.3)

> Brouillon de conception rédigé pour être fusionné avec les autres régions (Survie, Guerrier, Rôdeur, passerelles).
> Données machine : `docs/design/drafts/tree_mage.json` (même contenu, mêmes identifiants, mêmes chiffres).
> Références contraignantes : ROADMAP §1 et §2 bis, `docs/EQUILIBRAGE.md` et `shared/combat.js` de la branche
> `wave1/combat-souls` (endurance 100, roulade 30, engagement `rec`/`recSlow`, déséquilibre).

## 1. Intention

Le mage de v0.1 était **trop fort** : il tuait tout avant le contact et se soignait gratuitement. En v0.2, l'engagement
des attaques et l'endurance l'ont ramené dans le rang (écart ≤ 9 % dans `EQUILIBRAGE.md`). L'arbre doit **garder ces
acquis** tout en rendant chaque mage unique.

Trois piliers, que chaque nœud respecte :

1. **Fragile.** Presque aucun PV dans l'arbre (seulement « Vigueur de l'érudit », +10 % au maximum). La défense du mage
   passe par des sorts à recharge longue (Armure de givre, Bouclier de mana, Mur de glace, Pas de brume), jamais par
   une réduction permanente.
2. **Engagement.** Les gros sorts ont un **temps d'incantation** (`cast`, le mage ralentit ou s'immobilise ; une
   roulade l'annule sans dépenser la mana) puis une **récupération** (`rec`). Les canalisations immobilisent et
   vident l'endurance. Les ultimes sont **télégraphiés** (le Météore marque le sol 1 s avant l'impact).
3. **Pression de mana.** Un enchaînement complet coûte environ 150 à 180 mana, pour 6 à 7 mana/s de régénération en
   combat au niveau 30 : le mage alterne sorts et attaque de base, il ne « vide » pas sa barre deux fois de suite.

Accessibilité : chaque branche lit comme une phrase (« Pyromancie : je brûle, puis je fais détoner ») ; chaque
compétence a **un seul** groupe de variantes au choix (2 ou 3 options), et l'attaque de base en a deux.

## 2. Place dans l'Arbre des Brumes

Repère global commun : `x` vers la droite, `y` vers le **haut**, angles dans le sens trigonométrique depuis +x
(Guerrier 90°, Mage 210°, Rôdeur 330°). L'interface (écran, `y` vers le bas) doit inverser `y`.

| Zone | Secteur | Rayon | Contenu |
|---|---|---|---|
| Nœud de départ Mage | 210° | 500 | « Éveil du mage » : Trait arcanique (gratuit à la création) |
| Tronc | 195°–225° | 460–500 | 2 variantes de forme de l'attaque de base, collées au départ |
| **Pyromancie** | axe 184° (170°–196°) | 570–1520 | Boule de feu → Mur de flammes → Souffle ardent / Embrasement → Météore |
| **Arcanes** | axe 210° (199°–224°) | 570–1520 | Soin → Pas de brume → Bouclier de mana / Salve d'éclats → Rayon astral |
| **Givre** | axe 236° (225°–247°) | 570–1520 | Nova de givre → Lance de glace → Mur de glace / Armure de givre → Blizzard |
| **Passerelle Arcaniste sylvestre** (`pont_mr`) | axe 270° (258°–282°) | 800–1190 | Flèche runique, Ronces givrées, Feu follet, « Arc des astres » |

Tout le secteur Mage tient entre **166° et 254°** et la passerelle entre **256° et 284°** : aucune intrusion dans la
passerelle Guerrier↔Mage (autour de 150°) ni dans la région Rôdeur (≥ 290°). Le générateur vérifie qu'aucun nœud
n'est à moins de 70 unités d'un autre et qu'aucun lien ne passe à moins de 35 unités d'un nœud tiers.

```
                         (Survie, r ≤ 400)
                                 ·
                         Éveil du mage (r 500, 210°)
             ┌───────────────────┼────────────────────┐
     Pyromancie 184°        Arcanes 210°          Givre 236° ──── p. Vigueur ──┐
  Boule de feu (660)        Soin (660)            Nova de givre (660)          │
  Flamme attisée (790)      Esprit vif (790)      Vigueur de l'érudit (790)    │  Passerelle
  Mur de flammes (880)      Pas de brume (880)    Lance de glace (880)         └─ Arcaniste sylvestre
  Braises tenaces (1010)    Méditation (1010)     Morsure du froid (1010)          (270°, r 800–1190)
  Souffle │ Embrasement     Bouclier │ Éclats     Mur de glace │ Armure              → Rôdeur (≥ 290°)
  Fournaise (1260) ─────── Clarté (1260) ──────── Cœur gelé (1260)   (liens croisés entre branches à r 1290)
  Météore (1380)            Rayon astral (1380)   Blizzard (1380)
  ◆ Cœur de braise (1520)   ◆ Grand rituel (1520) ◆ Hiver éternel (1520)
  ◆ Érudit martial          ◆ Pacte de la lune de sang (r 1430, côté Pyromancie)
    (r 1220, 170°, vers la Lame spirituelle)
```

Chaque branche suit le même gabarit, pour que l'arbre soit lisible d'un coup d'œil : **porte** (sort de v0.2 ou soin)
à r 660 → passif → **2ᵉ sort** → passif → **fourche** de deux sorts (r 1100, chacun avec sa paire de variantes) →
passifs latéraux et central → **ultime** (r 1380) → **clé de voûte** (r 1520). Les variantes et clés de voûte sont
toujours des **feuilles** : choisir une variante ne bloque jamais le chemin.

Raccords avec les autres brouillons (listés dans `links` et `meta.externalLinks` ; le synthétiseur ajoute le lien
retour de l'autre côté) :
- `mage_depart` ↔ **`sv_seuil_arcanes`** (Survie, (−355, −205)) — déjà attendu par le brouillon Survie.
- `mr_p_oeil_sylvestre` ↔ **`v_cueilleur`** (Rôdeur, r 900, 299°) — résout son lien `pont_mr:*`.
- `ma_p_flamme_attisee` ↔ **`pg_onde_tranchante`** (Lame spirituelle, r 860, 150°) — **proposé** : le brouillon
  Guerrier ne relie pas encore sa passerelle à la région Mage.

Le générateur vérifie aussi l'absence de chevauchement avec les nœuds et les liens des brouillons Survie, Guerrier
et Rôdeur (≥ 90 unités entre nœuds, ≥ 35 entre un lien et un nœud).

## 3. Règles propres au Mage

### 3.1 Attaque de base : Trait arcanique

Au niveau 1, le mage n'a **que** le Trait arcanique (neutre, arcane). Deux groupes de variantes le transforment :

- **Affinité** (`ma_g_bolt_affinite`, un seul choix, chaque option est dans sa branche, juste après la porte) :
  *Trait de feu* (brûlure — l'identité v0.2), *Trait de givre* (1 charge de Froid), *Trait d'éclat* (plus rapide, plus
  loin). Changer d'affinité n'exige pas de repartir de zéro : il suffit d'une réinitialisation.
- **Forme** (`ma_g_bolt_forme`, collée au nœud de départ) : *Traits jumeaux* ou *Trait perçant*.

Les deux groupes se combinent (ex. Traits jumeaux de givre). **Attaque chargée** (Fondamental) : maintenir 1 s
→ ×2,0, 14 de déséquilibre, 14 d'endurance, ralenti à 30 % pendant la charge ; l'affinité s'applique.

### 3.2 Statuts

| Statut | Effet | Sources |
|---|---|---|
| **Brûlure** | 30 % des dégâts du coup en 3 s (tics de 0,5 s) ; ne se cumule pas (la plus forte reste) sauf « Cœur de braise » (3 cumuls) | feu |
| **Froid** | charges (max 3, 3 s) : −15 % de vitesse de déplacement **et d'attaque** chacune ; boss : moitié d'effet | givre |
| **Gel** | immobilisé 1 à 1,2 s, attaque en cours annulée, puis **immunisé 8 s** ; **jamais sur un boss** | variantes de givre, « Hiver éternel » |
| **Aveuglé** | −20 % de dégâts infligés, 3 s | Cendres aveuglantes |
| **Enraciné** | ne se déplace plus (attaque encore à portée), immunisé 8 s ensuite ; pas sur les boss | Ronces givrées |
| **Marqué** | +12 % de dégâts subis du lanceur et de son groupe, 6 s | Flèche de marque |

### 3.3 Incantation, canalisation et soulslike

- `cast` : temps avant l'effet, pendant lequel le mage se déplace à `castSlow` (30 % par défaut, 0 pour Météore et
  Rayon astral). **Une roulade annule l'incantation, la mana n'est pas dépensée, la recharge ne démarre pas.** Une
  attaque ennemie télégraphiée qui touche le mage l'annule aussi (les coups légers non).
- `channel` : l'effet dure tant qu'on maintient la touche, avec un coût par seconde (mana **et** endurance pour le
  Souffle ardent et le Rayon astral) : impossible d'enchaîner canalisation complète puis roulade.
- `rec` / `recSlow` : engagement de v0.2 conservé et étendu à toutes les nouvelles compétences.
- Le **déséquilibre** (`poise`) reste faible sur les petits sorts et fort sur les sorts lents (Lance de glace 22,
  Météore 70, Grande comète 90) : le mage peut interrompre une attaque télégraphiée, mais en s'engageant.
- **Saut** : pas de sort en l'air (le mage n'est pas un acrobate) ; seule l'attaque de base non chargée part pendant
  un saut. **Garde** : au bâton, comme les autres armes (réglée par Survie) ; le Bouclier de mana est l'alternative
  propre au mage.

### 3.4 Arme requise (« focalisateur »)

Tous les sorts de la région Mage demandent un **focalisateur** : bâton ou sceptre en main principale, ou **grimoire en
main gauche**. Sans focalisateur, −20 % de puissance. La Flèche runique demande un arc ou une arbalète (sinon elle est
grisée) ; les Ronces givrées acceptent un focalisateur ou un arc ; le Feu follet ne demande rien.

### 3.5 Personnages de v0.2 (migration)

Un mage de v0.2 possède Trait de feu, Boule de feu, Nova de givre et Soin. À la mise à jour :
1. Roulade et Sprint lui sont donnés gratuitement (règle commune) ; **Attaque chargée** est pré-placée (3ᵉ Fondamental).
2. Bouton « Reprendre mon style » (`meta.suggestedPath`) : `ma_fireball`, `ma_v_bolt_feu` (son Trait redevient un
   Trait de feu), `ma_frost_nova`, `ma_heal`. Coût : 5 points avec le 3ᵉ Fondamental, soit le niveau 5 (4 + 1 bonus).
3. Recommandation : si un personnage migré a moins de 5 points, lui accorder des **points d'héritage** pour que
   personne ne perde une compétence qu'il avait. Réinitialisation gratuite dans tous les cas.
4. L'identifiant de capacité **`firebolt` est conservé** (règle de `tree_rules.md` §3) : il désigne désormais le
   Trait arcanique, dont la variante `ma_v_bolt_feu` rend l'effet de feu. Les raccourcis enregistrés restent valides.

## 4. Les compétences (19)

Unités : puissance = multiplicateur de l'attaque ; mètres ; secondes ; engagement = durée (vitesse autorisée).
Les valeurs de v0.2 sont conservées pour Boule de feu et Nova de givre ; le **Soin est affaibli** (35 % instantané
toutes les 8 s → 30 % en 1 s de canalisation toutes les 12 s).

| id | Nom | Type | Origine | Mana | Endu. | Rech. (s) | Incant. / canal. (s) | Engag. (s) | Portée / rayon (m) | Puiss. | Déséq. | Étiquettes | Arme |
|---|---|---|---|---:|---:|---:|---|---:|---|---:|---:|---|---|
| `firebolt` | **Trait arcanique** (base) | projectile | Mage | 0 | 7 | 1,6 | 0 | 0,35 (30 %) | portée 18 | 0,8 | 3 | arcane, projectile, sort | focalisateur |
| `fireball` | **Boule de feu** (v0.2) | projectile | Mage | 20 | 14 | 6 | 0,35 | 0,6 (25 %) | portée 18 | 2 | 16 | feu, projectile, zone, sort | focalisateur |
| `fire_wall` | **Mur de flammes** | aoe_target | Mage | 28 | 12 | 16 | 0,5 | 0,5 (30 %) | portée 14, long. 7 | 0,35 /tic 0,5 s | 2 | feu, zone, controle, sort | focalisateur |
| `flame_breath` | **Souffle ardent** | channel | Mage | 10 + 10/s | 6 + 12/s | 10 | 0,2 / 2 | 0,4 (30 %) | rayon 6 | 0,3 /tic 0,25 s | 3 | feu, zone, canalisation, sort | focalisateur |
| `ignite` | **Embrasement** | aoe_target | Mage | 22 | 10 | 12 | 0,3 | 0,45 (30 %) | portée 16, rayon 4 | 0,6 | 18 | feu, zone, sort | focalisateur |
| `meteor` | **Météore** | aoe_target | Mage | 50 | 20 | 35 | 1,2 | 0,9 (25 %) | portée 20, rayon 4 | 4,2 | 70 | feu, zone, sort | focalisateur |
| `frost_nova` | **Nova de givre** (v0.2) | aoe_self | Mage | 25 | 16 | 12 | 0 | 0,45 (30 %) | rayon 6 | 1,1 | 10 | givre, zone, controle, sort | focalisateur |
| `ice_lance` | **Lance de glace** | projectile | Mage | 16 | 12 | 5 | 0,4 | 0,5 (25 %) | portée 20 | 1,5 | 22 | givre, projectile, sort | focalisateur |
| `ice_wall` | **Mur de glace** | summon | Mage | 30 | 14 | 24 | 0,4 | 0,5 (30 %) | portée 10, long. 6 | 0 | 0 | givre, defense, controle, sort | focalisateur |
| `blizzard` | **Blizzard** | channel | Mage | 15 + 12/s | 10 | 18 | 0,3 / 3 | 0,4 (30 %) | portée 18, rayon 5 | 0,25 /tic 0,5 s | 2 | givre, zone, canalisation, controle, sort | focalisateur |
| `frost_armor` | **Armure de givre** | buff | Mage | 25 | 0 | 25 | 0,3 | 0,3 (50 %) | — | 0 | 0 | givre, defense, buff, sort | focalisateur |
| `heal` | **Soin** (v0.2) | self_heal | Mage | 24 | 0 | 12 | 1 | 0,3 (50 %) | — | soin 30 % | 0 | arcane, soin, sort | focalisateur |
| `blink` | **Pas de brume** | dash | Mage | 18 | 20 | 7 | 0 | 0,25 (50 %) | portée 7 | 0 | 0 | arcane, mobilite, sort | focalisateur |
| `mana_shield` | **Bouclier de mana** | buff | Mage | 10 | 0 | 22 | 0 | 0,2 (50 %) | — | 0 | 0 | arcane, defense, buff, sort | focalisateur |
| `arcane_shards` | **Salve d'éclats** | projectile | Mage | 22 | 12 | 8 | 0,5 | 0,45 (30 %) | portée 18 | 0,4 ×5 | 4 | arcane, projectile, sort | focalisateur |
| `arcane_beam` | **Rayon astral** | channel | Mage | 12 + 14/s | 10 + 8/s | 20 | 0,6 / 2,5 | 0,7 (25 %) | portée 18 | 0,45 /tic 0,25 s | 5 | arcane, zone, canalisation, sort | focalisateur |
| `rune_arrow` | **Flèche runique** | projectile | Mage + Rôdeur | 14 | 10 | 5 | 0,3 | 0,45 (30 %) | portée 22 | 1,4 | 12 | arcane, projectile, arc, arc | arc / arbalète |
| `frost_brambles` | **Ronces givrées** | aoe_target | Mage + Rôdeur | 20 | 10 | 16 | 0,4 | 0,45 (30 %) | portée 16, rayon 3,5 | 0,8 | 6 | nature, givre, zone, controle, sort | focalisateur ou arc |
| `wisp` | **Feu follet** | summon | Mage + Rôdeur | 30 | 0 | 30 | 0,5 | 0,4 (30 %) | portée 16 | 0,3 | 1 | arcane, nature, invocation | aucune |

- **Trait arcanique** — Projectile d'énergie brute. Ses variantes lui donnent le feu, le givre ou l'éclat des astres. *Soulslike :* Tir automatique seulement à < 40 % de la vitesse (COMMIT.rangedMoveMax) ; 0,35 s d'engagement. *VFX :* Petite sphère blanc-bleu pâle, traînée de brume.
- **Boule de feu** — Une boule de feu qui explose à l'impact et embrase les ennemis proches. *Soulslike :* Temps d'incantation 0,35 s : lancée trop tard, elle part pendant la préparation ennemie et on encaisse le coup. *VFX :* Sphère orange tourbillonnante, explosion + anneau de braises.
- **Mur de flammes** — Dresse une ligne de feu qui brûle tout ce qui la traverse pendant 5 s. *Soulslike :* Les monstres traversent le mur (ils ne le contournent pas) : c'est une zone de dégâts, pas un rempart. Puissance par tic de 0,5 s. *VFX :* Rideau de flammes bas, fumée noire, sol calciné (décalque 5 s).
- **Souffle ardent** — Canalise un cône de flammes devant soi, jusqu'à 2 s. *Soulslike :* Vide l'endurance (12/s) : impossible de rouler juste après une canalisation complète. Relâcher la touche arrête le souffle. *VFX :* Jet de flammes en cône depuis la main, particules d'étincelles.
- **Embrasement** — Fait détoner les brûlures des ennemis dans la zone : dégâts immédiats égaux à 150 % de la brûlure restante. *Soulslike :* Sans brûlure sur la cible, ne fait que ×0,6 : il faut préparer le terrain. *VFX :* Chaque cible brûlante éclate en gerbe de flammes (flash blanc-orange).
- **Météore** — Appelle un rocher enflammé du ciel. Il s'écrase 1 s après l'incantation sur la zone marquée. *Soulslike :* Le mage est immobile 1,2 s puis la zone est télégraphiée 1 s (cercle orange visible par tous, y compris en JcJ). Idéal pendant la récupération d'un boss. *VFX :* Cercle orange au sol, rocher incandescent en chute, cratère fumant.
- **Nova de givre** — Une onde de givre autour de soi qui inflige 3 charges de Froid aux ennemis proches. *Soulslike :* Instantanée : c'est le sort de dégagement du mage. 3 charges de Froid = −45 % de vitesse (v0.2 : −50 %). *VFX :* Anneau de givre au sol qui s'étend, cristaux, souffle blanc.
- **Lance de glace** — Une lance de glace. Sur une cible Gelée ou à 2 charges de Froid ou plus : Fracas (×1,6), qui consomme le Froid. *Soulslike :* Gros dégâts de déséquilibre pour un sort à distance (22) : interrompt les préparations des petits monstres. *VFX :* Lance de glace translucide, éclats bleus au Fracas.
- **Mur de glace** — Érige un mur de glace (6 m) qui bloque les monstres et les projectiles pendant 6 s. *Soulslike :* PV du mur = 40 % des PV max du mage. Un boss le brise d'un seul coup, une attaque télégraphiée le traverse. Pas de mur infranchissable. *VFX :* Blocs de glace qui jaillissent du sol, fissures qui s'étendent quand il est frappé.
- **Blizzard** — Canalise une tempête de neige sur une zone (3 s max) : chaque tic ajoute 1 charge de Froid. *Soulslike :* Immobile pendant la canalisation ; rouler l'arrête. *VFX :* Nuage tourbillonnant, flocons denses, givre qui recouvre le sol.
- **Armure de givre** — Pendant 8 s : +25 % de défense et chaque ennemi qui vous frappe au corps à corps reçoit 1 charge de Froid. *Soulslike :* Ne protège pas de la mort en un coup : le mage reste fragile, l'armure achète une erreur, pas deux. *VFX :* Givre cristallin sur les épaules et les bras, halo bleu froid.
- **Soin** — Canalise 1 s pour rendre 30 % de vos PV. *Soulslike :* v0.2 : 35 % instantané toutes les 8 s (trop fort). Une roulade annule le soin (la mana n'est pas dépensée) : on se soigne dans les fenêtres de récupération ennemies, comme une fiole. *VFX :* Glyphe doré sous les pieds, lumière qui monte en spirale.
- **Pas de brume** — Se téléporte de 7 m dans la direction du mouvement (0,15 s d'invulnérabilité). *Soulslike :* Moins d'invulnérabilité que la roulade (0,15 s contre 0,35 s) mais plus de distance ; ne traverse pas les murs ni les murs de glace ; partage 0,6 s de délai avec la roulade. *VFX :* Silhouette qui se dissout en brume bleue, réapparition avec un souffle d'étincelles.
- **Bouclier de mana** — Pendant 6 s, 40 % des dégâts subis sont prélevés sur la mana (1,5 mana par point) au lieu des PV. *Soulslike :* La régénération de mana est coupée pendant le bouclier ; il se brise à 0 mana. Le mage paie sa survie avec ses sorts. *VFX :* Sphère hexagonale bleu-violet translucide, ondulations aux impacts.
- **Salve d'éclats** — Lance 5 éclats de pierre-astre qui cherchent leur cible (×0,4 chacun). *Soulslike :* Les éclats partent en éventail puis convergent : ils touchent les cibles qui bougent mais pas derrière un obstacle. *VFX :* Cinq pierres bleu-violet lumineuses, traînées de poussière d'étoiles (façon pierre d'éclat).
- **Rayon astral** — Après 0,6 s d'incantation, canalise un rayon de 18 m pendant 2,5 s qui transperce tout. *Soulslike :* Immobile et orienté : un monstre qui contourne le mage le sort du rayon. Coût total ≈ 47 mana pour 2,5 s. *VFX :* Rayon bleu-violet épais, anneaux runiques à la source, sol strié de lumière.
- **Flèche runique** — Une flèche gravée d'une rune qui perce la première cible et inflige des dégâts d'arcane. *Soulslike :* Demande un arc ou une arbalète (sans arc, la compétence est grisée). Tir engagé comme les tirs du rôdeur. *VFX :* Flèche entourée d'une rune verte et bleue qui tourne, traînée de feuilles lumineuses.
- **Ronces givrées** — Des ronces couvertes de givre jaillissent du sol et enracinent les ennemis 1,5 s (×0,8 sur 3 s). *Soulslike :* Les boss ne sont pas enracinés : 2 charges de Froid à la place. Un monstre ne peut être enraciné qu'une fois toutes les 8 s. *VFX :* Ronces noires couvertes de givre qui sortent du sol en spirale, éclats de glace.
- **Feu follet** — Invoque un feu follet pendant 15 s qui tire un petit trait d'arcane (×0,3) sur votre cible toutes les 1,5 s. *Soulslike :* Le follet n'attire pas l'aggro et ne peut pas être ciblé ; il suit la cible verrouillée par le joueur. *VFX :* Petite flamme bleu-vert flottante à l'épaule, trajectoires sinueuses.

## 5. Les branches

### 5.1 Pyromancie — « je brûle, puis je fais détoner »

Dégâts de zone et dégâts sur la durée. Boucle : appliquer la Brûlure (Trait de feu, Boule de feu, Mur, Souffle),
puis **Embrasement** pour en encaisser le reste d'un coup. Le Météore est l'ultime le plus puissant du mage, mais le
plus engagé (1,2 s immobile + 1 s de télégraphe). Clé de voûte **Cœur de braise** : brûlures cumulables, au prix de
+15 % de dégâts subis — le pyromancien le plus fort est aussi le plus fragile.

### 5.2 Arcanes — « la pierre-astre » (inspiration *glintstone*)

Projectiles précis, mobilité et gestion de la mana. C'est la branche la plus « technique » : Pas de brume (0,15 s
d'invulnérabilité seulement, donc un outil de placement, pas une deuxième roulade), Égide miroir (fenêtre de 0,6 s
qui renvoie les projectiles : une parade de mage), Rayon astral ou Grande comète. Elle porte aussi le **Soin** et deux
clés de voûte utiles à toutes les branches : **Grand rituel** (sorts +35 % mais lents) et **Pacte de la lune de sang**
(payer en PV quand la mana manque).

### 5.3 Givre — « je ralentis, puis je brise »

Contrôle. Les charges de Froid (max 3) ralentissent déplacement **et attaques** ; la **Lance de glace** consomme 2
charges ou plus pour un Fracas ×1,6. Le Gel n'existe qu'en variante ou avec **Hiver éternel**, toujours avec 8 s
d'immunité et jamais sur un boss (qui subit à la place +25 % de déséquilibre) : on contrôle un groupe, on ne verrouille
pas un monstre à l'infini. C'est la branche la plus sûre (Vigueur, Peau de givre, Armure) et la moins explosive.

### 5.4 Passerelle Mage ↔ Rôdeur : « Arcaniste sylvestre »

Magie et nature, flèches enchantées. Coûte **1 point** au Mage et au Rôdeur, **2** au Guerrier. Entrées :
`mr_p_seve_arcanique` (côté Mage, relié à « Vigueur de l'érudit » de la branche Givre) et `mr_p_oeil_sylvestre`
(côté Rôdeur, relié à `v_cueilleur`). Trois compétences hybrides (`home: ['mage', 'ranger']`, donc **sans
Inaptitude** pour ces deux classes) : Flèche runique, Ronces givrées, Feu follet. Clé de voûte **Arc des astres** :
l'arc compte comme un focalisateur, contre −15 % de mana et +10 % d'endurance sur les tirs et sorts. Elle ne réduit
pas l'Inaptitude : c'est le rôle de « Touche-à-tout » (Survie), qu'on ne duplique pas. Un arcaniste sylvestre joue
donc **arc + grimoire** ou **arc + Arc des astres**.

### 5.5 Érudit martial (région Mage, prévu par `tree_rules.md` §4.2)

Clé de voûte isolée au bord de la Pyromancie, du côté de la Lame spirituelle (r 1220, 170°, reliée à « Sang
chaud ») : le bâton compte comme une arme de mêlée (−15 %) et l'Inaptitude des compétences de Guerrier est divisée
par deux, contre +10 % de coût en mana sur les sorts. Pour un non-mage, elle coûte 3 points et ne sert presque à rien :
c'est bien une clé de mage de bataille.


## 6. Tous les nœuds (87)

Type, rangs, groupe exclusif, effet chiffré, coordonnées (repère y vers le haut) et liens non orientés. Les intentions visuelles des variantes sont dans le JSON (`vfx`), les effets machine dans `effects`.

### Tronc — 3 nœuds

| id | Type | Nom | Rangs | Groupe | Effet | (x, y) | Liens |
|---|---|---|---:|---|---|---|---|
| `mage_depart` | Compétence (départ) | **Éveil du mage** | 1 |  | Nœud de départ du Mage (gratuit, acquis à la création) : Trait arcanique. Ses voisins s'ouvrent après 3 Fondamentaux. | (-433, -250) | `sv_seuil_arcanes`* `ma_v_bolt_jumeaux` `ma_v_bolt_percant` `ma_fireball` `ma_heal` `ma_frost_nova` |
| `ma_v_bolt_jumeaux` | Variante | **Traits jumeaux** | 1 | `ma_g_bolt_forme` | Tire 2 traits à ±5° (×0,5 chacun, ×1,0 si les deux touchent). Endurance 7 → 9. | (-447, -125) | `mage_depart` |
| `ma_v_bolt_percant` | Variante | **Trait perçant** | 1 | `ma_g_bolt_forme` | Traverse la première cible (×0,6 sur la seconde). Déséquilibre 3 → 6, recharge 1,6 → 1,8 s. | (-332, -325) | `mage_depart` |

### Pyromancie — 24 nœuds

| id | Type | Nom | Rangs | Groupe | Effet | (x, y) | Liens |
|---|---|---|---:|---|---|---|---|
| `ma_fireball` | Compétence | **Boule de feu** | 1 |  | Une boule de feu qui explose à l'impact et embrase les ennemis proches. | (-658, -46) | `mage_depart` `ma_v_fireball_grande` `ma_v_fireball_chapelet` `ma_v_fireball_collante` `ma_v_bolt_feu` `ma_p_flamme_attisee` |
| `ma_v_fireball_grande` | Variante | **Grande boule de feu** | 1 | `ma_g_fireball` | Puissance 2,0 → 2,8, explosion 2 → 3,5 m (60 %), incantation 0,35 → 0,8 s, mana 20 → 30, vitesse 16 → 12 m/s. | (-735, 44) | `ma_fireball` |
| `ma_v_fireball_chapelet` | Variante | **Chapelet de braises** | 1 | `ma_g_fireball` | À l'impact (×1,5), se divise en 3 braises qui retombent à 3 m (×0,5 chacune, brûlure). | (-722, -146) | `ma_fireball` |
| `ma_v_fireball_collante` | Variante | **Boule collante** | 1 | `ma_g_fireball` | Se colle à la cible et explose après 1,5 s : ×2,6, déséquilibre 16 → 34 ; ne touche qu'elle. | (-660, 114) | `ma_fireball` |
| `ma_v_bolt_feu` | Variante | **Trait de feu** | 1 | `ma_g_bolt_affinite` | Le Trait devient du feu (tag feu) et inflige Brûlure (30 % du coup en 3 s). Retour de l'identité v0.2. | (-574, 35) | `ma_fireball` |
| `ma_p_flamme_attisee` | Passif | **Flamme attisée** | 3 |  | +4 % de dégâts de feu par rang. | (-788, -55) | `ma_fireball` `pg_onde_tranchante`* `ma_fire_wall` |
| `ma_fire_wall` | Compétence | **Mur de flammes** | 1 |  | Dresse une ligne de feu qui brûle tout ce qui la traverse pendant 5 s. | (-878, -61) | `ma_p_flamme_attisee` `ma_v_fire_wall_cercle` `ma_v_fire_wall_vague` `ma_p_braises_tenaces` |
| `ma_v_fire_wall_cercle` | Variante | **Cercle de flammes** | 1 | `ma_g_fire_wall` | Le mur devient un anneau de 3 m de rayon centré sur vous ; durée 5 → 4 s. | (-944, 29) | `ma_fire_wall` |
| `ma_v_fire_wall_vague` | Variante | **Vague de flammes** | 1 | `ma_g_fire_wall` | Le mur avance de 10 m à 4 m/s et touche chaque ennemi une fois (×1,2, brûlure) ; ne persiste pas. | (-931, -160) | `ma_fire_wall` |
| `ma_p_braises_tenaces` | Passif | **Braises tenaces** | 2 |  | Vos brûlures durent 1 s de plus par rang (même total de dégâts par seconde). | (-1008, -70) | `ma_fire_wall` `ma_flame_breath` `ma_ignite` |
| `ma_flame_breath` | Compétence | **Souffle ardent** | 1 |  | Canalise un cône de flammes devant soi, jusqu'à 2 s. | (-1105, 33) | `ma_p_braises_tenaces` `ma_v_breath_dragon` `ma_v_breath_cendres` `ma_p_sang_chaud` `ma_p_fournaise` |
| `ma_ignite` | Compétence | **Embrasement** | 1 |  | Fait détoner les brûlures des ennemis dans la zone : dégâts immédiats égaux à 150 % de la brûlure restante. | (-1090, -186) | `ma_p_braises_tenaces` `ma_v_ignite_contagion` `ma_v_ignite_detonation` `ma_p_etincelle` `ma_p_fournaise` |
| `ma_v_breath_dragon` | Variante | **Souffle du dragon** | 1 | `ma_g_flame_breath` | Cône 6 → 9 m mais 70 → 50°, tics +25 %, endurance 12 → 18 par seconde. | (-1041, 128) | `ma_flame_breath` |
| `ma_v_breath_cendres` | Variante | **Cendres aveuglantes** | 1 | `ma_g_flame_breath` | Tics −30 %, les ennemis touchés sont Aveuglés (−20 % de dégâts, 3 s). | (-1172, 129) | `ma_flame_breath` |
| `ma_v_ignite_contagion` | Variante | **Contagion** | 1 | `ma_g_ignite` | Les brûlures consommées se propagent (brûlure complète) aux ennemis à 4 m des cibles. | (-1014, -271) | `ma_ignite` |
| `ma_v_ignite_detonation` | Variante | **Détonation** | 1 | `ma_g_ignite` | 200 % de la brûlure restante au lieu de 150 %, déséquilibre +30, mais rayon 4 → 2,5 m. | (-1143, -290) | `ma_ignite` |
| `ma_p_sang_chaud` | Passif | **Sang chaud** | 1 |  | Vos sorts de feu coûtent 10 % d'endurance en moins. | (-1289, 85) | `ma_flame_breath` `ma_ks_erudit_martial` |
| `ma_p_etincelle` | Passif | **Étincelle** | 2 |  | +3 % de chances de critique contre les cibles qui brûlent, par rang. | (-1265, -264) | `ma_ignite` `ma_p_doigts_agiles` |
| `ma_p_fournaise` | Passif | **Fournaise** | 3 |  | +5 % de dégâts de feu par rang. | (-1257, -88) | `ma_flame_breath` `ma_ignite` `ma_meteor` |
| `ma_meteor` | Compétence | **Météore** | 1 |  | Appelle un rocher enflammé du ciel. Il s'écrase 1 s après l'incantation sur la zone marquée. | (-1377, -96) | `ma_p_fournaise` `ma_v_meteor_pluie` `ma_v_meteor_astre` `ma_ks_coeur_de_braise` |
| `ma_v_meteor_pluie` | Variante | **Pluie de météores** | 1 | `ma_g_meteor` | 3 météores plus petits (×1,6, rayon 2,5 m) tombent au hasard dans 6 m en 1,5 s. | (-1443, -1) | `ma_meteor` |
| `ma_v_meteor_astre` | Variante | **Astre déchu** | 1 | `ma_g_meteor` | Puissance 4,2 → 5,5, déséquilibre 70 → 110, incantation 1,2 → 1,8 s, mana 50 → 65. | (-1430, -200) | `ma_meteor` |
| `ma_ks_coeur_de_braise` | Clé de voûte | **Cœur de braise** | 1 |  | Vos brûlures se cumulent jusqu'à 3 fois (chacune avec sa durée) et vos dégâts de feu augmentent de 15 %. En contrepartie, vous subissez 15 % de dégâts en plus. | (-1516, -106) | `ma_meteor` |
| `ma_ks_erudit_martial` | Clé de voûte | **Érudit martial** | 1 |  | Votre bâton ou sceptre compte comme une arme de mêlée : les compétences de mêlée ne sont plus grisées (−15 % de puissance au bâton). L'Inaptitude des compétences de Guerrier est réduite de moitié. En contrepartie, vos sorts coûtent 10 % de mana en plus. | (-1198, 217) | `ma_p_sang_chaud` |

### Arcanes — 26 nœuds

| id | Type | Nom | Rangs | Groupe | Effet | (x, y) | Liens |
|---|---|---|---:|---|---|---|---|
| `ma_heal` | Compétence | **Soin** | 1 |  | Canalise 1 s pour rendre 30 % de vos PV. | (-572, -330) | `mage_depart` `ma_v_heal_remanence` `ma_v_heal_sursaut` `ma_v_heal_cercle` `ma_v_bolt_eclat` `ma_p_esprit_vif` |
| `ma_v_heal_remanence` | Variante | **Rémanence** | 1 | `ma_g_heal` | Soin sur la durée : 35 % en 6 s, sans canalisation (on peut agir). Recharge 12 → 16 s. | (-680, -283) | `ma_heal` |
| `ma_v_heal_sursaut` | Variante | **Sursaut** | 1 | `ma_g_heal` | Soin instantané de 20 % (pas de canalisation), recharge 12 s. | (-585, -447) | `ma_heal` |
| `ma_v_heal_cercle` | Variante | **Cercle de soin** | 1 | `ma_g_heal` | Soigne aussi les alliés à 6 m (20 % chacun ; vous 30 %). Canalisation 1 → 1,4 s. | (-483, -464) | `ma_heal` |
| `ma_v_bolt_eclat` | Variante | **Trait d'éclat** | 1 | `ma_g_bolt_affinite` | Reste arcanique ; vitesse 22 → 32 m/s, portée 18 → 22 m, puissance 0,8 → 0,85. | (-531, -220) | `ma_heal` |
| `ma_p_esprit_vif` | Passif | **Esprit vif** | 3 |  | +6 % de mana maximale par rang. | (-684, -395) | `ma_heal` `ma_blink` |
| `ma_blink` | Compétence | **Pas de brume** | 1 |  | Se téléporte de 7 m dans la direction du mouvement (0,15 s d'invulnérabilité). | (-762, -440) | `ma_p_esprit_vif` `ma_v_blink_leurre` `ma_v_blink_dechirure` `ma_v_blink_redouble` `ma_p_meditation` |
| `ma_v_blink_leurre` | Variante | **Double spectral** | 1 | `ma_g_blink` | Laisse un double 2 s qui attire les monstres non-boss. Recharge 7 → 10 s. | (-862, -388) | `ma_blink` |
| `ma_v_blink_dechirure` | Variante | **Déchirure** | 1 | `ma_g_blink` | À l'arrivée : ×0,6 d'arcane dans 2,5 m et 12 de déséquilibre. | (-767, -552) | `ma_blink` |
| `ma_v_blink_redouble` | Variante | **Pas redoublé** | 1 | `ma_g_blink` | 2 charges (9 s chacune) mais 5 m au lieu de 7. | (-836, -292) | `ma_blink` |
| `ma_p_meditation` | Passif | **Méditation** | 3 |  | +10 % de régénération de mana en combat par rang. | (-875, -505) | `ma_blink` `ma_mana_shield` `ma_arcane_shards` |
| `ma_mana_shield` | Compétence | **Bouclier de mana** | 1 |  | Pendant 6 s, 40 % des dégâts subis sont prélevés sur la mana (1,5 mana par point) au lieu des PV. | (-1008, -455) | `ma_p_meditation` `ma_v_shield_miroir` `ma_v_shield_rempart` `ma_p_doigts_agiles` `ma_p_clarte` |
| `ma_arcane_shards` | Compétence | **Salve d'éclats** | 1 |  | Lance 5 éclats de pierre-astre qui cherchent leur cible (×0,4 chacun). | (-898, -645) | `ma_p_meditation` `ma_v_shards_orbite` `ma_v_shards_concentree` `ma_p_poids_des_astres` `ma_p_clarte` |
| `ma_v_shield_miroir` | Variante | **Égide miroir** | 1 | `ma_g_mana_shield` | Pendant les 0,6 premières secondes, renvoie les projectiles (60 % des dégâts) ; durée 6 → 3 s. | (-992, -342) | `ma_mana_shield` |
| `ma_v_shield_rempart` | Variante | **Rempart** | 1 | `ma_g_mana_shield` | Absorption 40 → 60 %, mais −30 % de vitesse pendant le bouclier. | (-1110, -398) | `ma_mana_shield` |
| `ma_v_shards_orbite` | Variante | **Éclats en orbite** | 1 | `ma_g_arcane_shards` | Les éclats tournent autour de vous 6 s et partent seuls vers les ennemis à moins de 5 m (1 toutes les 0,6 s). | (-792, -688) | `ma_arcane_shards` |
| `ma_v_shards_concentree` | Variante | **Salve concentrée** | 1 | `ma_g_arcane_shards` | Les 5 éclats fusionnent en une seule pointe : ×2,2, déséquilibre 25, sans guidage. | (-900, -762) | `ma_arcane_shards` |
| `ma_p_doigts_agiles` | Passif | **Doigts agiles** | 2 |  | −6 % de temps d'incantation par rang (pas la récupération). | (-1196, -488) | `ma_mana_shield` `ma_p_etincelle` `ma_ks_pacte_sang_lune` |
| `ma_p_poids_des_astres` | Passif | **Poids des astres** | 2 |  | +15 % de dégâts de déséquilibre des sorts par rang. | (-1021, -792) | `ma_arcane_shards` `ma_p_hiver_long` `ma_p_focalisation` |
| `ma_p_clarte` | Passif | **Clarté** | 3 |  | +5 % de dégâts d'arcane par rang. | (-1091, -630) | `ma_mana_shield` `ma_arcane_shards` `ma_arcane_beam` |
| `ma_arcane_beam` | Compétence | **Rayon astral** | 1 |  | Après 0,6 s d'incantation, canalise un rayon de 18 m pendant 2,5 s qui transperce tout. | (-1195, -690) | `ma_p_clarte` `ma_v_beam_balayage` `ma_v_beam_comete` `ma_ks_grand_rituel` |
| `ma_v_beam_balayage` | Variante | **Rayon balayant** | 1 | `ma_g_arcane_beam` | Vous pouvez pivoter (45°/s) pendant le rayon ; durée 2,5 → 2 s. | (-1297, -633) | `ma_arcane_beam` |
| `ma_v_beam_comete` | Variante | **Grande comète** | 1 | `ma_g_arcane_beam` | Plus de canalisation : incantation 1,4 s puis un seul tir colossal (×4,0, déséquilibre 90) sur 18 m. Mana 45. | (-1197, -807) | `ma_arcane_beam` |
| `ma_ks_grand_rituel` | Clé de voûte | **Grand rituel** | 1 |  | Vos sorts (hors attaque de base) gagnent +35 % de puissance et +50 % de déséquilibre. En contrepartie, leurs incantations durent 50 % plus longtemps (au moins +0,3 s) et leur récupération 30 % de plus. | (-1316, -760) | `ma_arcane_beam` |
| `ma_ks_pacte_sang_lune` | Clé de voûte | **Pacte de la lune de sang** | 1 |  | Quand la mana manque, le sort se paie en PV (1 PV par point de mana manquant) ; refusé si cela vous ferait passer sous 10 % de PV. En contrepartie : mana maximale −25 % et potions de mana deux fois moins efficaces. | (-1339, -501) | `ma_p_doigts_agiles` |
| `ma_p_focalisation` | Passif | **Focalisation** | 2 |  | −5 % de coût en mana de tous vos sorts par rang. | (-1104, -909) | `ma_p_poids_des_astres` |

### Givre — 22 nœuds

| id | Type | Nom | Rangs | Groupe | Effet | (x, y) | Liens |
|---|---|---|---:|---|---|---|---|
| `ma_frost_nova` | Compétence | **Nova de givre** | 1 |  | Une onde de givre autour de soi qui inflige 3 charges de Froid aux ennemis proches. | (-369, -547) | `mage_depart` `ma_v_nova_glaciale` `ma_v_nova_eclats` `ma_v_bolt_givre` `ma_p_vigueur_erudit` |
| `ma_v_nova_glaciale` | Variante | **Nova glaciale** | 1 | `ma_g_frost_nova` | Gèle 1 s les ennemis non-boss qui avaient déjà du Froid ; les autres reçoivent 3 charges. Recharge 12 → 16 s. | (-487, -552) | `ma_frost_nova` |
| `ma_v_nova_eclats` | Variante | **Nova d'éclats** | 1 | `ma_g_frost_nova` | Puissance 1,1 → 1,6, rayon 6 → 4,5 m, n'applique qu'1 charge de Froid. | (-329, -658) | `ma_frost_nova` |
| `ma_v_bolt_givre` | Variante | **Trait de givre** | 1 | `ma_g_bolt_affinite` | Le Trait devient du givre : puissance 0,8 → 0,7, inflige 1 charge de Froid (2,5 s). | (-257, -514) | `ma_frost_nova` |
| `ma_p_vigueur_erudit` | Passif | **Vigueur de l'érudit** | 2 |  | +5 % de PV maximum par rang. | (-442, -655) | `ma_frost_nova` `ma_ice_lance` `mr_p_seve_arcanique` |
| `ma_ice_lance` | Compétence | **Lance de glace** | 1 |  | Une lance de glace. Sur une cible Gelée ou à 2 charges de Froid ou plus : Fracas (×1,6), qui consomme le Froid. | (-492, -730) | `ma_p_vigueur_erudit` `ma_v_lance_trio` `ma_v_lance_glacier` `ma_p_morsure_froid` |
| `ma_v_lance_trio` | Variante | **Triple lance** | 1 | `ma_g_ice_lance` | 3 lances en éventail de 20° (×0,7 chacune) ; le Fracas ne s'applique qu'à la première qui touche. | (-604, -726) | `ma_ice_lance` |
| `ma_v_lance_glacier` | Variante | **Lance-glacier** | 1 | `ma_g_ice_lance` | Traverse tous les ennemis sur 20 m ; puissance 1,5 → 1,3, incantation 0,4 → 0,7 s. | (-447, -832) | `ma_ice_lance` |
| `ma_p_morsure_froid` | Passif | **Morsure du froid** | 3 |  | +4 % de dégâts de givre par rang. | (-565, -837) | `ma_ice_lance` `ma_ice_wall` `ma_frost_armor` |
| `ma_ice_wall` | Compétence | **Mur de glace** | 1 |  | Érige un mur de glace (6 m) qui bloque les monstres et les projectiles pendant 6 s. | (-706, -850) | `ma_p_morsure_froid` `ma_v_wall_prison` `ma_v_wall_herisse` `ma_p_hiver_long` `ma_p_coeur_gele` |
| `ma_frost_armor` | Compétence | **Armure de givre** | 1 |  | Pendant 8 s : +25 % de défense et chaque ennemi qui vous frappe au corps à corps reçoit 1 charge de Froid. | (-524, -973) | `ma_p_morsure_froid` `ma_v_armor_carapace` `ma_v_armor_aurore` `ma_p_peau_de_givre` `ma_p_coeur_gele` |
| `ma_v_wall_prison` | Variante | **Prison de glace** | 1 | `ma_g_ice_wall` | Au lieu d'un mur, enferme un monstre non-boss 2,5 s (il ne peut ni agir ni subir de dégâts). Recharge 24 → 28 s. | (-742, -742) | `ma_ice_wall` |
| `ma_v_wall_herisse` | Variante | **Mur hérissé** | 1 | `ma_g_ice_wall` | PV du mur −30 % ; chaque coup de mêlée contre lui renvoie ×0,4 et 1 charge de Froid ; il explose en se brisant (×0,8 dans 3 m). | (-823, -844) | `ma_ice_wall` |
| `ma_v_armor_carapace` | Variante | **Carapace** | 1 | `ma_g_frost_armor` | Plus de bonus de défense : absorbe entièrement un coup (jusqu'à 25 % des PV max) puis se brise. | (-410, -966) | `ma_frost_armor` |
| `ma_v_armor_aurore` | Variante | **Aurore boréale** | 1 | `ma_g_frost_armor` | Plus de bonus de défense : les ennemis à moins de 3 m reçoivent 1 charge de Froid par seconde. | (-475, -1079) | `ma_frost_armor` |
| `ma_p_hiver_long` | Passif | **Hiver long** | 2 |  | Vos charges de Froid durent 0,5 s de plus par rang. | (-861, -963) | `ma_ice_wall` `ma_p_poids_des_astres` |
| `ma_p_peau_de_givre` | Passif | **Peau de givre** | 2 |  | +5 % de défense par rang. | (-571, -1159) | `ma_frost_armor` |
| `ma_p_coeur_gele` | Passif | **Cœur gelé** | 3 |  | +5 % de dégâts contre les cibles ralenties par rang. | (-705, -1045) | `ma_ice_wall` `ma_frost_armor` `ma_blizzard` |
| `ma_blizzard` | Compétence | **Blizzard** | 1 |  | Canalise une tempête de neige sur une zone (3 s max) : chaque tic ajoute 1 charge de Froid. | (-772, -1144) | `ma_p_coeur_gele` `ma_v_blizzard_errant` `ma_v_blizzard_oeil` `ma_ks_hiver_eternel` |
| `ma_v_blizzard_errant` | Variante | **Tempête errante** | 1 | `ma_g_blizzard` | Le blizzard vous suit (rayon 4 m) et vous pouvez marcher à 50 % ; tics −20 %. | (-888, -1138) | `ma_blizzard` |
| `ma_v_blizzard_oeil` | Variante | **Œil du blizzard** | 1 | `ma_g_blizzard` | Rayon 5 → 3,5 m, tics +40 % ; à la fin, gèle 1 s les non-boss à 3 charges. | (-722, -1250) | `ma_blizzard` |
| `ma_ks_hiver_eternel` | Clé de voûte | **Hiver éternel** | 1 |  | À 3 charges de Froid, un monstre non-boss est Gelé 1,2 s (puis immunisé 8 s) ; un boss subit +25 % de déséquilibre pendant 3 s. En contrepartie : vos dégâts de feu −40 % et votre vitesse −8 %. | (-850, -1260) | `ma_blizzard` |

### Passerelle Arcaniste sylvestre (`pont_mr`) — 12 nœuds

| id | Type | Nom | Rangs | Groupe | Effet | (x, y) | Liens |
|---|---|---|---:|---|---|---|---|
| `mr_p_seve_arcanique` | Passif | **Sève arcanique** | 2 |  | +4 % de dégâts d'arcane et de nature par rang. | (-150, -790) | `ma_p_vigueur_erudit` `mr_rune_arrow` |
| `mr_p_oeil_sylvestre` | Passif | **Œil sylvestre** | 2 |  | +3 % de chances de critique des projectiles par rang. | (150, -790) | `v_cueilleur`* `mr_rune_arrow` |
| `mr_rune_arrow` | Compétence | **Flèche runique** | 1 |  | Une flèche gravée d'une rune qui perce la première cible et inflige des dégâts d'arcane. | (0, -890) | `mr_p_seve_arcanique` `mr_p_oeil_sylvestre` `mr_v_arrow_eclatee` `mr_v_arrow_marque` `mr_frost_brambles` `mr_wisp` |
| `mr_v_arrow_eclatee` | Variante | **Flèche éclatée** | 1 | `mr_g_rune_arrow` | Ne perce plus : à l'impact, 3 éclats d'arcane (×0,35) frappent les ennemis à 4 m. | (-100, -950) | `mr_rune_arrow` |
| `mr_v_arrow_marque` | Variante | **Flèche de marque** | 1 | `mr_g_rune_arrow` | La cible est Marquée 6 s : +12 % de dégâts subis de votre part et de votre groupe (non cumulable). | (100, -950) | `mr_rune_arrow` |
| `mr_frost_brambles` | Compétence | **Ronces givrées** | 1 |  | Des ronces couvertes de givre jaillissent du sol et enracinent les ennemis 1,5 s (×0,8 sur 3 s). | (-110, -1040) | `mr_rune_arrow` `mr_v_brambles_epines` `mr_v_brambles_nord` `mr_ks_arc_des_astres` |
| `mr_wisp` | Compétence | **Feu follet** | 1 |  | Invoque un feu follet pendant 15 s qui tire un petit trait d'arcane (×0,3) sur votre cible toutes les 1,5 s. | (110, -1040) | `mr_rune_arrow` `mr_v_wisp_braise` `mr_v_wisp_gardien` `mr_ks_arc_des_astres` |
| `mr_v_brambles_epines` | Variante | **Ronces à épines** | 1 | `mr_g_frost_brambles` | Enracinement 1,5 → 0,8 s, dégâts ×2 et Saignement (tag saignement). | (-215, -1000) | `mr_frost_brambles` |
| `mr_v_brambles_nord` | Variante | **Ronces du Nord** | 1 | `mr_g_frost_brambles` | N'enracine plus : 3 charges de Froid, rayon 3,5 → 5 m. | (-215, -1130) | `mr_frost_brambles` |
| `mr_v_wisp_braise` | Variante | **Follet de braise** | 1 | `mr_g_wisp` | Le follet devient du feu : ses traits infligent Brûlure, un tir toutes les 2 s au lieu de 1,5 s. | (215, -1000) | `mr_wisp` |
| `mr_v_wisp_gardien` | Variante | **Follet gardien** | 1 | `mr_g_wisp` | Le follet n'attaque plus : il intercepte un projectile ennemi toutes les 4 s. | (215, -1130) | `mr_wisp` |
| `mr_ks_arc_des_astres` | Clé de voûte | **Arc des astres** | 1 |  | Votre arc ou arbalète compte comme un focalisateur (plus de −20 % sur vos sorts) et vos sorts de projectile volent 20 % plus vite. En contrepartie : mana maximale −15 % et +10 % de coût d'endurance sur vos tirs et vos sorts. | (0, -1190) | `mr_frost_brambles` `mr_wisp` |

`*` = nœud d'un autre brouillon (raccord à ajouter des deux côtés par le synthétiseur).

## 7. Clés de voûte

| id | Nom | Effet | Contrepartie | Coût Mage / autres |
|---|---|---|---|---|
| `ma_ks_coeur_de_braise` | Cœur de braise | Brûlures cumulables ×3 (durées séparées), +15 % de dégâts de feu | +15 % de dégâts subis | 1 / 3 |
| `ma_ks_grand_rituel` | Grand rituel | Sorts (hors attaque de base) +35 % de puissance, +50 % de déséquilibre | Incantations +50 % (au moins +0,3 s), récupération +30 % | 1 / 3 |
| `ma_ks_pacte_sang_lune` | Pacte de la lune de sang | Sans assez de mana, le sort se paie en PV (1 PV par mana manquante), refusé sous 10 % de PV | Mana max −25 %, potions de mana −50 % | 1 / 3 |
| `ma_ks_hiver_eternel` | Hiver éternel | 3 charges de Froid ⇒ Gel 1,2 s (immunité 8 s) ; boss : +25 % de déséquilibre subi 3 s | Dégâts de feu −40 %, vitesse −8 % | 1 / 3 |
| `ma_ks_erudit_martial` | Érudit martial | Bâton/sceptre = arme de mêlée (−15 %), Inaptitude des compétences de Guerrier ÷ 2 (plancher de 40 % des règles) | Sorts +10 % de mana | 1 / 3 |
| `mr_ks_arc_des_astres` | Arc des astres (passerelle) | L'arc ou l'arbalète compte comme focalisateur ; sorts de projectile +20 % de vitesse | Mana max −15 %, +10 % d'endurance sur tirs et sorts | Mage/Rôdeur 1, Guerrier 3 (passerelle non voisine, règles §4.1) |

Aucune clé ne donne d'invulnérabilité, d'endurance infinie ou de soin passif. Le Pacte ne peut pas tuer son porteur
(plancher de 10 %) mais le laisse à la merci du prochain coup : c'est un pari, pas une sécurité.

## 8. Exemples de profils (points : niveau N ⇒ N − 1 + ⌊N/5⌋)

| Niveau (points) | Pyromancien | Cryomancien | Astromancien |
|---|---|---|---|
| **5 (5)** | Roulade, Sprint, Attaque chargée · Boule de feu · Nova de givre | Roulade, Sprint, Garde · Nova de givre · Trait de givre | Roulade, Sprint, Attaque chargée · Soin · Trait d'éclat |
| **15 (17)** | + Saut, Garde · Trait de feu, Grande boule, Soin, Flamme attisée ×2, Mur de flammes, Braises tenaces, Embrasement + Détonation, Fournaise ×1 | + Saut, Attaque chargée · Nova glaciale, Vigueur ×2, Lance de glace + Triple lance, Morsure ×2, Armure de givre + Carapace, Soin | + Saut, Garde · Esprit vif ×2, Pas de brume + Déchirure, Méditation ×2, Salve d'éclats + Salve concentrée, Bouclier de mana |
| **30 (35)** | 5 Fondamentaux + 3 Survie · toute la ligne Pyromancie jusqu'à Cœur de braise (22 points : Trait de feu, Grande boule, Vague de flammes, Souffle du dragon, Contagion, Étincelle ×2, Fournaise ×3, Astre déchu) · Nova de givre, Soin + Sursaut, Esprit vif ×2 | 5 + 3 · toute la ligne Givre jusqu'à Hiver éternel (22 : Nova glaciale, Triple lance, Prison de glace, Carapace, Hiver long ×2, Cœur gelé ×3, Œil du blizzard) · Soin + Rémanence, Esprit vif ×3 | 5 + 3 · toute la ligne Arcanes jusqu'à Grand rituel (25 : Sursaut, Trait d'éclat, Déchirure, Égide miroir, Salve concentrée, Grande comète, Doigts agiles ×2, Poids des astres ×2, Clarté ×3) · Nova de givre, Focalisation ×1 |

Hybride **Arcaniste sylvestre** (mage, niveau 30, arc + grimoire) : 5 Fondamentaux + 2 Survie · Nova de givre, Trait
de givre, Vigueur ×2, Soin + Sursaut, Esprit vif ×1 (7) · passerelle complète utile : Sève arcanique ×2, Flèche
runique + Marque, Ronces givrées + Ronces du Nord, Feu follet + Braise, Arc des astres (9) · Rôdeur à 2 points
(Inaptitude −25 %, ou −12,5 % avec Touche-à-tout en Survie) : Tir perçant + une variante + un passif d'arc ×2 (≈ 12). Il a beaucoup d'outils mais **aucun** passif de dégâts
profond ni l'ultime ou la clé de voûte d'une branche : plus polyvalent, moins fort qu'un pur (objectif respecté).

## 9. Équilibrage

**Budget de puissance.** Chaque branche offre au maximum, en passifs :

| Branche | Dégâts | Autres |
|---|---|---|
| Pyromancie | +27 % feu, +6 % critique sur cible brûlante, brûlures +2 s | −10 % d'endurance sur les sorts de feu |
| Givre | +12 % givre, +15 % contre cible ralentie | +10 % PV, +10 % défense, Froid +1 s |
| Arcanes | +15 % arcane | +18 % mana, +30 % régénération de mana, −12 % d'incantation, +30 % de déséquilibre, −10 % de coût |

La Pyromancie a le plus de dégâts bruts, le Givre la meilleure survie, les Arcanes la meilleure économie de mana et la
meilleure clé de voûte « générale » (Grand rituel). Objectif repris de `EQUILIBRAGE.md` : les trois profils purs
**à ±15 % d'efficacité (XP/min)** aux niveaux 5, 15 et 30, et chaque profil pur Mage à ±15 % des purs Guerrier et
Rôdeur.

**Mana.** Niveau 30 : 95 + 12 × 29 = 443 mana (523 avec Esprit vif ×3), régénération en combat 1,5 %/s ≈ 6,6/s
(≈ 10/s avec Méditation ×3). Enchaînement pyromancien complet (Grande boule 30, Mur 28, Embrasement 22, Souffle ≈ 30,
Astre déchu 65) ≈ **175 mana** : deux enchaînements vident la barre, ensuite 20 à 30 s d'attaque de base.

**Endurance.** Les sorts gardent leur coût d'endurance de v0.2 (7 à 20) : après une Boule de feu (14) et une Lance
(12), il reste de quoi rouler une seule fois. Les canalisations Souffle ardent (12/s) et Rayon astral (8/s) empêchent
de rouler juste après une canalisation complète.

**Pas de don (autres classes).** Exemple : un Guerrier niveau 15 prend Boule de feu → 2 points, ×2,0 × 0,75
(Inaptitude) × 0,8 (sans focalisateur) = **×1,2**, 25 mana, recharge 7,2 s, pour ~96 mana au total : 3 lancers par
combat. Un Rôdeur prend Nova de givre → ×0,66 avec son arc (×0,77 avec Touche-à-tout ; ×0,96 s'il prend aussi Arc des
astres, qui supprime le −20 % d'arme, mais il a alors payé 2 points de clés de voûte et perdu 15 % de mana).
Rappel des règles : une capacité hors classe utilise l'attaque de référence de sa classe d'origine, donc un Guerrier
ne lance pas une Boule de feu plus forte qu'un Mage. Utile, jamais meilleur que le
mage pur.

**Ce qui empêche de banaliser le combat.**

| Risque | Garde-fou |
|---|---|
| Contrôle infini (Gel, Prison, Racines) | Immunité 8 s après chaque Gel/Enracinement, jamais sur les boss, Prison = cible invulnérable aussi |
| Kiting à distance | Engagement v0.2 conservé, incantations annulées par la roulade, canalisations immobiles |
| Mur de glace infranchissable | PV = 40 % des PV du mage, un boss le brise d'un coup, les télégraphes le traversent |
| Double esquive (Pas de brume + roulade) | 0,15 s d'invulnérabilité seulement, délai de 0,6 s partagé avec la roulade, 20 d'endurance |
| Bouclier de mana permanent | Recharge 22 s, régénération de mana coupée, se brise à 0 mana |
| Déséquilibre en boucle sur les boss | Astre déchu (110) × Grand rituel (1,5) × Poids des astres (1,3) ≈ 214 > 150 (Golem) : un déséquilibre toutes les **35 s** au mieux, après 1,8 s d'incantation immobile |
| Soin gratuit | 1 s de canalisation annulée par la roulade ; variantes instantanées plus faibles (20 %) ou lentes (6 s) |

**À faire par l'agent d'équilibrage** : étendre `tests/balance/sim.mjs` pour accepter une liste de nœuds (profil) et
simuler les trois profils purs ci-dessus + l'hybride, aux niveaux 5, 15 et 30, contre les monstres v0.3. Les valeurs
de ce brouillon sont une première passe cohérente avec v0.2, pas un résultat de simulation.

## 10. Effets visuels à produire

Chaque variante a une intention visuelle (`vfx` dans le JSON). Regroupement pour l'agent `lookdev` (effets rendus dans
Blender) : **feu** (braise, boule, explosion, mur, vague, jet en cône, cendres, météore + cratère), **givre** (écharde,
anneau au sol, blocs de gel, lance, mur de glace à pics, aurore, blizzard), **arcane** (sphère neutre, pierre-astre bleu-
violet et poussière d'étoiles, faille violette, dôme hexagonal, rayon, comète, glyphe de soin doré), **nature** (rune
verte, ronces givrées, feu follet). Les états Brûlure, Froid (1 à 3 charges), Gel, Marqué ont besoin d'un indicateur
sur le monstre, lisible de loin.

## 11. Questions ouvertes

1. Raccords : `mage_depart` ↔ `sv_seuil_arcanes` et `mr_p_oeil_sylvestre` ↔ `v_cueilleur` sont cohérents avec les
   brouillons Survie et Rôdeur ; **`ma_p_flamme_attisee` ↔ `pg_onde_tranchante` est une proposition** à faire
   accepter au brouillon Guerrier (sa passerelle n'a pas d'accroche côté Mage).
   Écarts relevés chez les voisins, à corriger à la synthèse : le brouillon Rôdeur est en **y écran (vers le bas)**
   alors que les règles imposent y vers le haut ; le brouillon Guerrier utilise le préfixe `ma_` (réservé au Mage par
   les règles) pour sa branche Maître d'armes et `g_depart` au lieu de `guerrier_depart`. Aucun id n'entre en
   collision aujourd'hui (vérifié), mais il faudrait renommer.
2. **Grimoire en main gauche = focalisateur**, compatible avec un arc (à la place du carquois) : à valider avec le
   brouillon objets/artisanat, c'est ce qui rend l'Arcaniste sylvestre jouable.
3. Un non-mage qui prend `mage_depart` (2 points, règles §4.1) obtient le Trait arcanique avec l'Inaptitude et
   l'exigence de focalisateur ; peut-il aussi prendre les variantes de forme qui y sont collées (2 points chacune) ?
   Proposé : oui.
9. Nouvelles statistiques introduites par ce brouillon (`meta.newStats`) : à ajouter à `resolveAbility` et à la
   liste de §7.2 des règles (`dmgPct.<élément>`, `statusDurS.*`, `castTimePct`, `bloodMagic`, `froidToGel`,
   `focusFromBow`, `meleeFromStaff`…).
4. **Interruption des incantations par les attaques télégraphiées** : le serveur n'a pas encore de notion
   d'interruption côté joueur ; à ajouter avec l'arbre (simple : un coup télégraphié qui touche annule `cast`).
5. **Mur de glace** : il faut un obstacle dynamique dans le déplacement des monstres (serveur) ; version de repli :
   une zone que les monstres ne franchissent qu'en la brisant.
6. Points d'héritage pour les mages migrés de moins de niveau 5 (voir 3.5).
7. Le Soin affaibli (30 % en 1 s, recharge 12 s) doit être validé par la simulation : c'était la source principale de
   survie du mage en v0.2 contre le Golem.
8. Chiffres de l'Attaque chargée à harmoniser avec le brouillon Survie (ici ×2,0 pour 1 s de charge).
