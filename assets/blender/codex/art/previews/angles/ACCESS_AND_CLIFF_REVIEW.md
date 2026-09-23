# Relecture après corrections — accès et falaise

## Auberge : trois captures examinées

`house-01-entree`, `house-02-profil` et `house-03-sol` ont été ouvertes individuellement, puis leur planche vérifiée. Les trois nouvelles captures du 23 septembre à partir de 10:16:39 ont été réexaminées après correction de végétation.

- Aucun jour visible sous les marches, aucune marche manifestement flottante dans ces trois images. Le profil montre des contremarches pleines descendant jusqu'au terrain. Les ombres de contact ne doivent pas être interprétées seules comme un défaut de géométrie.
- Le dernier palier atteint visuellement le bas de porte; la continuité d'accès est nette de face et de profil. La perspective basse ne montre pas de trou entre palier et seuil.
- Le contrôle `check_access.json` corrobore cette lecture : auberge à huit marches de 0,16156 m, première élévation 0,14656 m au-dessus du terrain de référence, delta palier/seuil nul, recouvrement de 0,07350 m. Les cinq maisons passent les contrôles de sommets évalués après transformations.
- Limite : il s'agit d'un accès visuel à une façade fermée, pas d'une validation de collision ni d'un intérieur accessible. Le contrôle ne couvre pas les graviers et la végétation.
- La nouvelle série confirme la correction d'exclusion de végétation : les marches et le palier sont dégagés. Aucun gros brin ne les traverse dans les trois angles.
- Défauts visuels résiduels : joints de maçonnerie très gros et réguliers, ensemble encore très propre et peu érodé; petites touffes d'herbe raides et souvent parallèles autour du bâtiment. Ces points ne remettent pas en cause le contact sol/escalier observé.

## Falaise corrigée

- **01 village :** accès à l'auberge maintenant explicite; château doté d'une entrée et d'une rampe visibles. Maçonnerie moins grossière sur la forteresse. En revanche, la lumière reste très uniforme et le fond montagneux ressemble à des masses isolées, peu reliées au terrain. La composition est lisible, mais l'échelle et la sobriété géométrique continuent à évoquer un décor stylisé.
- **02 front bas :** entrée, herse et rampe nettement plus crédibles que la façade initiale aveugle. La répétition en strates ondulées de la falaise a disparu. La roche reste assez lisse et grise; le rempart central forme une grande surface peu articulée. La maison au premier plan masque une partie des raccords d'accès, donc ce cadrage ne suffit pas à valider la jonction de rampe.
- **03 gauche :** silhouette de la falaise désormais irrégulière, gros éboulis à sa base et accès architectural perceptibles. Le cadre élargi évite de couper les tours. Les rainures verticales très douces et les bords arrondis évoquent encore une surface sculptée simple, peu fracturée. Les montagnes de fond dominent le château et leur pied termine brutalement sur un sol horizontal. Connexion de rampe encore difficile à lire à cette distance.
- **04 droite :** les volées de marches et le changement de direction se lisent clairement. Le socle paraît supporté; pas de section manifestement suspendue dans le vide. La partie haute de la circulation reste en partie masquée par le relief rocheux et la perspective.
- **05 strates :** la disparition de l'ancien millefeuille périodique est confirmée de près. La grande forme est améliorée. Le microrelief reste fin et très horizontal, presque comme un grain de bois; il manque des fractures et différences de matière à plusieurs échelles.
- **06 remparts :** entrée, plateforme, contreforts et meurtrières cohérents. Le bas de la rampe est hors cadre; cette vue ne démontre donc pas sa continuité complète. La maçonnerie et les créneaux restent très réguliers et propres.
- **07 silhouette :** la chapelle latérale et les contreforts enrichissent la silhouette. Pas de trou accidentel visible. La répétition des tours cylindriques et la faible usure architecturale restent les principales limites artistiques.
- **08 ensemble :** le dernier rendu (`pass2-verified.log`) corrige la coupe des deux grandes tours : leurs sommets sont entiers, avec une marge confortable au-dessus. Masse et socle cohérents. Un arbre masque encore une partie de la rampe.
- Ces huit angles ont été réouverts après la relance complète GPU (série débutant à 10:16). Ils montrent une amélioration structurelle, pas encore une validation artistique de niveau Elden Ring. La lumière reste claire et uniforme, les plans lointains manquent de séparation atmosphérique.
- **09 arrière gauche :** la silhouette entière est visible et le contre-jour apporte une lumière plus intéressante; chapelle, meurtrières et contreforts enrichissent réellement le dos. Le matériau est toutefois très sombre, donc cette vue juge mieux les masses que leur texture.
- **10 arrière :** l'image noire initiale est corrigée. Le rendu final de `pass2-back-final.log`, horodaté 10:30:21, conserve désormais toutes les pointes avec environ 95 pixels de ciel au-dessus de la plus haute. Volumes visibles et pas de caméra dans la roche. Le contre-jour masque encore une partie des matériaux.
- **11 arrière droite :** le rendu final de `pass2-back-final.log`, horodaté 10:30:28, conserve désormais toutes les pointes avec environ 110 pixels de ciel au-dessus de la plus haute. Maçonnerie visible en lumière rasante, contreforts continus et roche sans ancien motif en vagues. Une limite droite du terrain reste visible à l'arrière-plan.
- Les trois nouvelles vues arrière ont été ouvertes. La meilleure vue de silhouette arrière est 09. Les planches `house-sheet.png`, `cliff-sheet.png` et `cliff_back-sheet.png` ont été régénérées depuis la série corrigée; aucun fichier de comparaison `angles-before` n'a été remplacé.

## Dernière série complète — `pass2-verified.log`

Le journal contient 23 captures terminées puis `Blender quit`. Les six planches ont été régénérées depuis cette série; les archives `angles-before` sont inchangées.

- **Cimetière :** arche désormais continue, sans voussoirs séparés. La chapelle présente une ouverture traversante, murs ruinés et charpente interrompue : le défaut de cube fermé est corrigé. Les stèles montrent plus de variété. Restent un sol bleu-gris très uniforme, de petites touffes répétitives, une lumière générale plate et une écorce cellulaire très visible en angle 02.
- **Antre :** arche continue et solide; lumière plus sombre, sujet mieux détaché que dans la première série. Colonnes désormais ébréchées, mais leur couronne de pointes apparaît encore régulière et artificielle. Les grandes lignes cyan du golem continuent à dominer la matière. Le disque de diffusion lumineuse reste visible en hauteur. Le cadrage entrée 01 reste le plus complet grâce au voyageur donnant l'échelle.
- **Forêt :** amélioration la plus nette : horizon cassé par du relief et une végétation plus profonde; stèle avec trois glyphes distincts sur une vraie surface de pierre, disparition du bruit blanc lumineux; racines moins envahissantes, fin du disque de projecteur très net au sol. Les trois angles sont cohérents. Restent une écorce stylisée et des bouquets de végétation assez répétitifs. L'angle 01 reste le meilleur ensemble, 03 sert à juger le monument.
- Contrôle final ici : captures de cadrage 08/10/11 ouvertes individuellement et neuf nouvelles vues de scènes revues sur les planches. Les illustrations publiques finales sont contrôlées séparément par le parent.
- Complément final : les deux vues arrière reprises à 10:30 ont été ouvertes individuellement; les trois cadrages 08/10/11 ne coupent plus les sommets. La planche arrière a été régénérée une dernière fois depuis ces fichiers.
