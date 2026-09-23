# Demandes d'éléments visuels — v0.3 (arbre, objets, artisanat)

> Liste **exacte** de ce que les artistes (agents assets, Codex) doivent produire pour la v0.3, générée depuis
> `skilltree.json`, `items.json` et `crafting.json` par `node docs/design/tools/gen_docs.mjs` : chaque clé ci-dessous
> est référencée par les données. Conventions : icônes 256 × 256 PNG dans `client/public/icons/` (style CX-2 : objet
> détaillé sur fond transparent ; compétences sur fond sombre texturé ; lisibles à 40 px), modèles tenus en main
> `client/public/models/eq_*.glb` (conventions CX-3 : origine au point de prise, lame le long de +Z), effets en planches
> WebP + `client/public/vfx/manifest.json`. Déjà livrés et donc **non redemandés** : les 12 icônes `ab_*` de la v0.2,
> les icônes d'objets v0.1 et la liste v0.3 de CX-2, les modèles CX-3 et CX-3b, la liste CX-12.

## Priorité 0 — indispensable pour ouvrir l'arbre et le butin v2

### P0.1 Icônes de compétences : 53 nouvelles (`ab_<id>`)

`ab_roulade`, `ab_sprint`, `ab_saut`, `ab_attaque_sautee`, `ab_garde`, `ab_attaque_chargee`, `ab_riposte_parfaite`, `ab_taunt`, `ab_shield_bash`, `ab_riposte`, `ab_bastion`, `ab_rage`, `ab_leap_slam`, `ab_rend`, `ab_execute`, `ab_lunge`, `ab_blade_dance`, `ab_sunder`, `ab_sidestep`, `ab_enchant_blade`, `ab_blade_wave`, `ab_rune_aegis`, `ab_fire_wall`, `ab_flame_breath`, `ab_ignite`, `ab_meteor`, `ab_ice_lance`, `ab_ice_wall`, `ab_blizzard`, `ab_frost_armor`, `ab_blink`, `ab_mana_shield`, `ab_arcane_shards`, `ab_arcane_beam`, `ab_rune_arrow`, `ab_frost_brambles`, `ab_wisp`, `ab_fleche_assommante`, `ab_trait_fatal`, `ab_coup_de_dague`, `ab_marque_de_chasse`, `ab_bond_de_retrait`, `ab_piege_a_machoires`, `ab_filet`, `ab_hallali`, `ab_fleche_empoisonnee`, `ab_fleche_barbelee`, `ab_nuage_toxique`, `ab_entaille_venimeuse`, `ab_fleau`, `ab_javelot`, `ab_coup_epieu`, `ab_appat`

(65 capacités au total ; 12 icônes existent déjà.) Une icône par capacité ; les variantes
réutilisent l'icône de leur capacité avec un liseré turquoise ajouté par l'interface.

### P0.2 Interface de l'arbre (kit CX-9)

`tree_node_skill` (cercle doré 26 px), `tree_node_variant` (losange turquoise), `tree_node_passive` (petit cercle
14 px), `tree_node_keystone` (octogone pourpre 34 px), `tree_node_fondamental` (anneau blanc-or), `tree_core` (Cœur
des Brumes), états acquis / disponible (halo pulsé) / verrouillé, `tree_link` (3 largeurs), `tree_cost_badge` (pastille
orange 2 / 3), `tree_inapt` (icône « Inapte »), fonds de région `tree_bg_survie`, `tree_bg_guerrier`,
`tree_bg_mage`, `tree_bg_rodeur`, `tree_bg_pont` (dégradé), `skillbook_frame` (livre de compétences), et les
icônes d'action des Fondamentaux sans capacité propre si besoin (`ab_saut`, `ab_garde` sont déjà listées en P0.1).

### P0.3 Icônes d'équipement hors CX-12 : épées (25)

Chaque famille d'épée doit se reconnaître à 40 px (silhouettes CX-3b) :

`bastard_t1`, `bastard_t2`, `bastard_t3`, `bastard_t4`, `bastard_t5`, `bastard_t6`, `curved_t3`, `curved_t4`, `curved_t5`, `curved_t6`, `rapier_t1`, `rapier_t2`, `rapier_t3`, `rapier_t4`, `rapier_t6`, `runesword_t5`, `runesword_t6`, `scimitar_t2`, `scimitar_t3`, `scimitar_t4`, `scimitar_t5`, `scimitar_t6`, `shortsword_t1`, `shortsword_t2`, `shortsword_t5`

### P0.4 Matériaux (39 icônes `<id>`)

`slime_core`, `wolf_fang`, `boar_hide`, `boar_tusk`, `goblin_scrap`, `totem_feather`, `spider_silk`, `venom_gland`, `grave_dust`, `black_fletching`, `wraith_veil`, `soul_shard`, `bandit_cloth`, `chipped_blade`, `golem_stone`, `scorpion_chitin`, `scorpion_stinger`, `lurker_scale`, `bog_moss`, `hag_eye`, `wyrm_scale`, `wyrm_tooth`, `frost_pelt`, `icewolf_fang`, `yeti_fur`, `yeti_horn`, `frost_heart`, `troll_hide`, `troll_blood`, `rune_shard`, `phylactery_shard`, `scrap_metal`, `leather_scraps`, `cloth_scraps`, `wood_scraps`, `vial`, `linen`, `ash_wood`, `scarlet_mark`

### P0.5 Consommables, pierres, sacs, plans (18)

`potion_mp_m`, `oil_venom`, `oil_blessed`, `elixir_res_poison`, `potion_mp_l`, `potion_stamina_l`, `elixir_res_fire`, `oil_ember`, `elixir_res_frost`, `oil_frost`, `potion_hp_xl`, `elixir_regen`, `elixir_res_arcane`, `oil_rune`, `bag_medium`, `bag_large`, `bag_small`, plus `plan` (icône générique « Plan / Patron »).

## Priorité 1 — la v0.3 complète

### P1.1 Icônes d'équipement hors CX-12 : autres familles (41)

`axe_t1`, `axe_t2`, `axe_t3`, `axe_t4`, `axe_t5`, `axe_t6`, `crossbow_t1`, `crossbow_t2`, `crossbow_t3`, `crossbow_t4`, `crossbow_t5`, `crossbow_t6`, `dagger_t1`, `dagger_t2`, `dagger_t3`, `dagger_t4`, `dagger_t5`, `dagger_t6`, `longbow_t1`, `longbow_t3`, `longbow_t4`, `longbow_t5`, `longbow_t6`, `mace_t1`, `mace_t2`, `mace_t3`, `mace_t4`, `mace_t5`, `mace_t6`, `sceptre_t1`, `sceptre_t2`, `sceptre_t3`, `sceptre_t4`, `sceptre_t5`, `sceptre_t6`, `spear_t1`, `spear_t2`, `spear_t3`, `spear_t4`, `spear_t5`, `spear_t6`

### P1.2 Légendaires : 10 icônes et 10 modèles uniques

Icônes : `uq_fendroc`, `uq_hag_thorn`, `uq_wyrm_fang`, `uq_mountain_breaker`, `uq_aldmar_runeblade`, `uq_thirst`, `uq_golem_rampart`, `uq_hag_grimoire`, `uq_winter_bolt`, `uq_lich_staff`.
Modèles : `eq_uq_fendroc`, `eq_uq_hag_thorn`, `eq_uq_wyrm_fang`, `eq_uq_mountain_breaker`, `eq_uq_aldmar_runeblade`, `eq_uq_thirst`, `eq_uq_golem_rampart`, `eq_uq_hag_grimoire`, `eq_uq_winter_bolt`, `eq_uq_lich_staff` (6 épées d'abord : Fendroc, Épine de la Sorcière, Croc du Ver des sables,
Brise-Montagne, Lame runique d'Aldmar, Soif-de-Sang).

### P1.3 Modèles d'armes supplémentaires (8)

Un 3ᵉ aspect pour chaque famille d'épée (paliers T5–T6), une 6ᵉ épée longue et un 5ᵉ espadon (T6) : `eq_bastard_3`, `eq_curved_3`, `eq_greatsword_5`, `eq_rapier_3`, `eq_runesword_3`, `eq_scimitar_3`, `eq_shortsword_3`, `eq_sword_6`.
Correspondance palier → modèle : champ `model` de chaque base dans `items.json` (53 clés utilisées, toutes les autres
existent déjà en CX-3 / CX-3b).

### P1.4 Icônes de clés de voûte (23)

`ks_danseur`, `ks_dernier_souffle`, `ks_touche_a_tout`, `ks_mur_vivant`, `ks_serment_guerrier`, `ks_rasoir`, `ks_dechaine`, `ks_duelliste`, `ks_coups_mesures`, `ks_serment_lame`, `ks_coeur_de_braise`, `ks_grand_rituel`, `ks_pacte_sang_lune`, `ks_hiver_eternel`, `ks_arc_des_astres`, `ks_erudit_martial`, `ks_posture_archer`, `ks_au_plus_pres`, `ks_proie_unique`, `ks_fantome_brumes`, `ks_veneneux`, `ks_sang_pour_sang`, `ks_frenesie`

### P1.5 Effets visuels des variantes et des statuts

Les 146 variantes ont chacune une intention visuelle (texte `vfx` dans `skilltree.json`, reprise dans
`ARBRE_COMPETENCES.md`). Familles d'effets à produire (nombre de variantes qui les utilisent) :

| Famille | Variantes (estimation par mots-clés) | Contenu |
|---|---|---|
| `vfx_fire` | 18 | braises, traînée de feu, explosion, mur de flammes, jet en cône, cendres, météore + cratère |
| `vfx_frost` | 12 | éclats, anneau au sol, bloc de gel, lance, mur de glace à pics, aurore, blizzard |
| `vfx_arcane` | 16 | sphère neutre, pierre-astre bleu-violet, poussière d'étoiles, faille, rayon, comète, runes |
| `vfx_nature` | 20 | ronces givrées, feu follet, flèche runique verte |
| `vfx_blood` | 11 | gouttes, traînée rouge sombre, éclatement de la jauge d'hémorragie |
| `vfx_poison` | 8 | nuage toxique, gouttes vert acide, fléau |
| `vfx_steel` | 54 | traînées d'acier (demi-lune, estoc, tourbillon), étincelles de parade |
| `vfx_impact` | 52 | poussière, onde de choc, fissures, bond fracassant |
| `vfx_motion` | 22 | pas de l'ombre (clignement), silhouettes de brume, sillage de sprint |
| `vfx_shield` | 5 | égide arcanique, égide runique, bastion |
| `vfx_heal` | 14 | glyphe de soin doré, cri de ralliement |

Indicateurs de statut au-dessus des monstres et des joueurs, lisibles de loin : `status_brulure`, `status_froid_1`,
`status_froid_2`, `status_froid_3`, `status_gel`, `status_saignement` (+ jauge d'hémorragie sous la barre de vie),
`status_poison_1` à `status_poison_6`, `status_marque`, `status_aveugle`, `status_enracine`, `status_vacille`,
`status_super_armure` (éclat de pleine charge). Télégraphes au sol : `tele_lo` (ondes concentriques), `tele_nb`
(bordure crénelée), `tele_mag` (violet runique). Fondamentaux : `fx_jump_land`, `fx_guard_block`, `fx_parry`,
`fx_perfect_dodge`, `fx_charge` / `fx_charged`, `fx_guard_break`.

### P1.6 Entités et personnages nouveaux

| Clé | Groupe | Description |
|---|---|---|
| `npc_master` | characters | Maître des arts (réinitialisation de l'arbre), village de Brumeval |
| `npc_tanner` | characters | Maud la tanneuse (Couture et tannerie) — à défaut, `npc_merchant` recoloré |
| `scarlet_champion` | humanoids | Champion écarlate, boss de zone rouge : modèle du bandit agrandi (×1,3), armure pourpre et noire, `Attack2` + `Special` |
| `trap_jaws`, `trap_net`, `bait_lure` | props | piège à mâchoires, filet au sol, appât (entités serveur du Traqueur et du Chasseur) |
| `ice_wall`, `fire_wall` | vfx / props | Mur de glace (obstacle temporaire à pics) et Mur de feu du Mage |
| `wisp` | vfx | feu follet flottant (bleu-vert, variante braise orange) |
| `meteor_crater` | vfx | cratère fumant du Météore |

## Priorité 2 — finitions

- Icônes de passifs génériques par famille de statistique pour l'infobulle (104 statistiques
  regroupables en ~12 : PV, endurance, mana, critique, dégâts par élément, résistances, garde, roulade, potions, écho).
- Animations de personnages : `Jump` (0,35 s en l'air + réception), `Guard` (boucle), `Parry`, `Charge` (boucle) et
  `ChargedRelease`, `JumpAttack`, `Stagger` (vacillement 0,4 s) pour `warrior`, `mage`, `ranger` ; repli
  procédural si un clip manque.
- Aperçu 3D des objets dans l'infobulle (rendu des modèles `eq_*`).
