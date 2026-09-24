// Brumeval Online v0.3 — contenu du monde (couche « design » posée sur la carte du cartographe).
// Source unique écrite à la main par le concepteur principal, fusionnée avec les mesures du générateur
// (tools/out/carto.json) par build_layout.mjs pour produire docs/world/world_layout.json.
// Coordonnées en mètres : x vers l'est, z vers le SUD (nord = −z), Brumeval en (0, 0).

// ------------------------------------------------------------------ typologie des hauteurs (cartographe = référence)
// Les étages sont calés sur la carte des hauteurs générée (mer 0 m, village 46 m, plateaux 150–260 m,
// sommets jouables ≤ 405 m, murailles de décor 470–575 m).  build_layout.mjs mesure la part de chaque étage
// dans chaque région.
export const ALTITUDE_BANDS = [
  { id: 'E0', name: 'Fonds marins', min: -60, max: -3, ground: 'sable immergé, herbiers, récifs', play: 'non praticable (pas de nage en v0.3)', color: '#1b4f7a' },
  { id: 'E1', name: 'Rivage', min: -3, max: 5, ground: 'plages, lagons, vasières, étangs du marais', play: 'gués ≤ 0,8 m, bancs de sable, pontons', color: '#e9dcae' },
  { id: 'E2', name: 'Basses terres', min: 5, max: 40, ground: 'prairies côtières, marais, désert bas, bords de lacs', play: 'grandes lignes de vue, routes, monture (v0.4), char à sable (v0.4)', color: '#9cc26a' },
  { id: 'E3', name: 'Terres moyennes', min: 40, max: 90, ground: 'Val de Brumeval (46 m), prairies dorées, landes, dunes hautes', play: "l'essentiel du jeu : herbe dense au vent, camps, arènes", color: '#b9c46c' },
  { id: 'E4', name: 'Hautes terres', min: 90, max: 160, ground: 'Sylve Ancienne, Bois des Égarés, plateau d’Aldmar, mesas', play: 'forêts, ruines, premiers belvédères', color: '#cdb877' },
  { id: 'E5', name: 'Plateaux', min: 160, max: 260, ground: 'Rougecrête (190 / 232 m), Rochegivre (201 m), Table du Géant', play: 'belvédères (révèlent la carte), vol plané v0.5', color: '#b98f62' },
  { id: 'E6', name: 'Montagne', min: 260, max: 400, ground: 'Pics de Givreval, cône du Mont Brasier, Mont Écumeur', play: 'cols, sentiers balisés, froid / chaleur', color: '#9a8f86' },
  { id: 'E7', name: 'Cimes et murailles', min: 400, max: 620, ground: 'Pic de Givrecime (≈ 405 m), Murailles du Nord (décor)', play: 'hors jeu sauf la cime de Givrecime', color: '#f2f4f7' },
];
// Limites de végétation reprises des règles de biome du générateur.
export const VEGETATION_LIMITS = {
  treeLine: { givreval: 212, sylve: 200, cendres: 150, default: 300 },
  snowLine: { givreval: 262, couronne: 262, other: null },
  note: 'Neige permanente seulement au nord-ouest ; plus bas vers le nord. Pente > 48° : roche (rouge à l’ouest).',
};
export const SLOPE_CLASSES = [
  { id: 'plat', maxDeg: 12, effect: 'constructible : villes, camps, arènes de boss', render: 'herbe pleine' },
  { id: 'marchable', maxDeg: 25, effect: 'normal', render: 'herbe, moins dense au-dessus de 20°' },
  { id: 'raide', maxDeg: 40, effect: 'montée ralentie (× 0,75)', render: 'terre, éboulis, herbe clairsemée (× 0,3)' },
  { id: 'glissade', maxDeg: 55, effect: 'impossible à gravir (refus serveur), on glisse en descendant', render: 'roche triplanaire' },
  { id: 'falaise', maxDeg: 90, effect: 'mur', render: 'roche + modèles cliff_* posés à la cuisson' },
];
export const WALKABLE_MAX_DEG = 40;
export const WADE_MAX_DEPTH = 0.8;
// Types de relief (ids = canal G de la carte de contrôle, TECH_MONDE §2).
export const RELIEF_TYPES = [
  [0, 'plaine', 'Plaine ondulée', 'ondulations de 2–6 m'],
  [1, 'collines', 'Collines', 'bosses de 15–45 m, vallons'],
  [2, 'plateau', 'Plateau à falaises', 'dessus plat, bord abrupt de 20–60 m, terrasses de 11 m à l’ouest'],
  [3, 'mesa', 'Mesas et buttes', 'tables isolées à bords raides'],
  [4, 'canyon', 'Canyon', 'gorge de 60–80 m, fond plat, parois à 66°'],
  [5, 'alpin', 'Montagne alpine', 'crêtes vives, cirques, éboulis'],
  [6, 'volcan', 'Volcan', 'cône concave, cratère de 62 m, brèche de coulée'],
  [7, 'dunes', 'Dunes', 'crêtes NNE–SSO de 8–18 m (25–40 m dans la Mer de Dunes), face au vent < 20°'],
  [8, 'marais', 'Marais', 'presque plat à 4 m, 45 % d’étangs'],
  [9, 'cote_falaise', 'Côte à falaises', 'falaises marines de 60–100 m'],
  [10, 'cote_basse', 'Côte basse et îles', 'plages à 3 %, lagons de 0,4–3 m, îlots, bancs de sable'],
  [11, 'foret_brume', 'Forêt de brume', 'cuvette fermée de 25 m où la brume stagne'],
  [12, 'ancienne_carte', 'Ancienne carte', 'le relief v0.1/v0.2 relevé de +45 m, sans érosion'],
  [13, 'cuvette_lac', 'Cuvette lacustre', 'pente douce vers un lac à niveau propre'],
];

// ------------------------------------------------------------------ couleurs de biome (carte, minicarte) — valeurs de la bible visuelle
export const BIOME_STYLE = {
  G: { color: '#79b04a', grass: 'grass_lush' }, O: { color: '#cfb24a', grass: 'grass_golden' }, M: { color: '#b8a55a', grass: 'grass_dry' },
  A: { color: '#d8b453', grass: 'grass_golden' }, F: { color: '#4f8a3a', grass: 'grass_lush' }, L: { color: '#4e7f6e', grass: 'grass_dark' },
  S: { color: '#eef3f8', grass: null }, R: { color: '#9a958c', grass: 'grass_dry' }, V: { color: '#4d4644', grass: null },
  W: { color: '#6a7a4a', grass: 'grass_dark' }, H: { color: '#c07a4a', grass: 'grass_dry' }, C: { color: '#a8583a', grass: null },
  D: { color: '#e6cc8e', grass: null }, T: { color: '#7fb45a', grass: 'grass_lush' }, K: { color: '#8f9a6a', grass: 'grass_dry' },
  B: { color: '#f0e4c4', grass: null }, Q: { color: '#1f6f9e', grass: null }, U: { color: '#3fc6c8', grass: null },
  Z: { color: '#4e9fb8', grass: null }, Y: { color: '#ff6a1a', grass: null },
};

// ------------------------------------------------------------------ bestiaire
// Monstres existants (v0.1–v0.2) + clés de la vague 1 (ROADMAP §4.5) ; « rig » = modèle réutilisé.
export const NEW_MONSTERS = [
  // v0.3 : variantes sur des rigs existants (coût Blender faible) + le crabe (seul vrai nouveau modèle v0.3)
  { key: 'bandit_archer', name: 'Archer brigand', archetype: 'distance', levels: [12, 20], rig: 'bandit', version: 'v0.3', idea: 'couvre les brigands de mêlée' },
  { key: 'bandit_desert', name: 'Pillard des dunes', archetype: 'fonceur', levels: [15, 22], rig: 'bandit', version: 'v0.3', idea: 'cimeterre, jet de sable qui aveugle 1 s' },
  { key: 'pirate', name: 'Pillard des Salins', archetype: 'fonceur', levels: [9, 24], rig: 'bandit', version: 'v0.3', idea: 'abordage, baril explosif télégraphié' },
  { key: 'pirate_harpooner', name: 'Harponneur', archetype: 'distance', levels: [12, 24], rig: 'bandit', version: 'v0.3', idea: 'harpon qui attire (esquivable)' },
  { key: 'rift_lizard', name: 'Varan des failles', archetype: 'fonceur', levels: [15, 22], rig: 'wolf', version: 'v0.3', idea: 'charge en zigzag' },
  { key: 'husk', name: 'Dessiccé', archetype: 'brute', levels: [16, 28], rig: 'skeleton', version: 'v0.3', idea: 'sort du sable (annonce l’onde du Ver)' },
  { key: 'stone_guardian', name: 'Gardien de grès', archetype: 'brute', levels: [20, 28], rig: 'golem', version: 'v0.3', idea: 'golem des ruines et des failles, matériaux de grès' },
  { key: 'crab', name: 'Crabe-Rocher', archetype: 'brute', levels: [9, 24], rig: null, version: 'v0.3', idea: 'dos blindé : on apprend à contourner' },
  // v0.4 : vrais nouveaux modèles
  { key: 'toad_brute', name: 'Crapaud-buffle', archetype: 'brute', levels: [8, 20], rig: null, version: 'v0.4', idea: 'saut écrasant (cercle), langue qui attire' },
  { key: 'treant', name: 'Écorcier', archetype: 'brute', levels: [14, 18], rig: null, version: 'v0.4', idea: 'racines en ligne, faible au feu' },
  { key: 'wisp', name: 'Feu-Brume', archetype: 'distance', levels: [14, 18], rig: null, version: 'v0.4', idea: 'se téléporte, orbes lents' },
  { key: 'harpy', name: 'Harpie des falaises', archetype: 'distance', levels: [18, 24], rig: null, version: 'v0.4', idea: 'plumes en éventail, piqué en ligne, vole bas (≤ 4 m)' },
  { key: 'sea_serpent_whelp', name: 'Serpenteau des récifs', archetype: 'distance', levels: [14, 20], rig: null, version: 'v0.4', idea: 'immobile dans l’eau, crache en arc' },
  { key: 'salamander', name: 'Salamandre de braise', archetype: 'lanceur', levels: [22, 30], rig: null, version: 'v0.4', idea: 'crachat de feu, flaques persistantes' },
  { key: 'magma_golem', name: 'Golem de lave', archetype: 'brute', levels: [24, 30], rig: 'golem', version: 'v0.4', idea: 'marteau, lave au sol' },
  { key: 'ember_wisp', name: 'Braisillon', archetype: 'distance', levels: [22, 29], rig: 'wisp', version: 'v0.4', idea: 'variante rouge du Feu-Brume' },
  { key: 'crab_king', name: 'Le Roi-Carapace', archetype: 'boss', levels: [23, 23], rig: 'crab', version: 'v0.4', idea: 'carapace à briser, vagues en anneau' },
  { key: 'ember_matriarch', name: 'La Brasier-Mère', archetype: 'boss', levels: [30, 30], rig: 'salamander', version: 'v0.4', idea: 'souffle en cône, pluie de lave, caldeira qui se remplit' },
];

// ------------------------------------------------------------------ régions (ids = ceux du générateur, world_spec.mjs)
// m(key, lvMin, lvMax, note?) ; weather : [kind, poids] parmi clair, nuageux, pluie, orage, neige, tempete_sable, brume, cendres
const m = (key, a, b, note) => ({ key, levels: [a, b], ...(note ? { note } : {}) });
export const REGION_CONTENT = {
  brumeval: {
    relief: ['ancienne_carte', 'plaine', 'collines'], version: 'v0.1', brumillons: 14,
    weather: [['clair', 5], ['brume', 3], ['pluie', 2]],
    ambiance: 'Brume dorée au lever du soleil, fumée des cheminées, herbe haute en vagues ; l’Arbre-Brume au nord sur son plateau.',
    monsters: [m('slime', 1, 3), m('wolf', 3, 6), m('boar', 4, 7, 'lisière est'), m('goblin', 5, 8), m('goblin_shaman', 6, 8), m('spider', 6, 9, 'Forêt des Murmures'), m('skeleton', 8, 11, 'Cimetière oublié')],
    miniBosses: [{ name: 'Gluant-Roi', model: 'slime', lvl: 4, x: -150, z: 120, desc: 'se divise en 3 à 50 % PV' }, { name: 'Chef Gorgrat', model: 'goblin', lvl: 9, x: -100, z: -8, desc: 'sonne le cor à 60 % PV (renforts)' }],
    bosses: [{ key: 'golem', name: 'Golem ancien', lvl: 14, x: 118, z: -132, desc: 'boss existant, premier jalon ; conseillé à partir du niveau 12' }],
    harvest: ['node_copper', 'node_herb_brume'],
  },
  mordore: {
    relief: ['plaine', 'collines', 'cuvette_lac'], version: 'v0.3', brumillons: 14,
    weather: [['clair', 6], ['nuageux', 2], ['orage', 2]],
    ambiance: 'Prairie dorée d’automne perpétuel, grands ciels, lignes de vue de 1 à 2 km vers les falaises rouges.',
    monsters: [m('boar', 5, 9), m('wolf', 5, 8), m('bandit', 7, 12), m('bandit_archer', 9, 12), m('slime', 5, 7, 'gluant doré')],
    miniBosses: [{ name: 'Vieille-Hure', model: 'boar', lvl: 10, x: -560, z: -300, desc: 'charge qui arrache les clôtures' }],
    bosses: [], harvest: ['node_copper', 'node_iron', 'node_herb_brume'],
  },
  songes: {
    relief: ['cuvette_lac', 'plaine', 'cote_basse'], version: 'v0.3', brumillons: 10,
    weather: [['clair', 5], ['brume', 3], ['pluie', 2]],
    ambiance: 'Lac calme qui reflète le ciel, saules, roseaux, brume à l’aube ; plages de l’Anse au sud.',
    monsters: [m('slime', 6, 9, 'gluant d’eau'), m('spider', 7, 11), m('bandit', 8, 12), m('crab', 9, 12, 'Anse des Songes')],
    miniBosses: [{ name: 'La Tisseuse des Saules', model: 'spider', lvl: 12, x: -820, z: 800, desc: 'toiles au sol qui ralentissent' }],
    bosses: [], harvest: ['node_copper', 'node_herb_brume'],
  },
  port_salin: {
    relief: ['cote_basse', 'plaine', 'cote_falaise'], version: 'v0.3', brumillons: 12,
    weather: [['clair', 6], ['nuageux', 2], ['pluie', 1], ['orage', 1]],
    ambiance: 'Sable blanc crème, eau turquoise, falaises blanches à l’ouest, lanternes du port le soir.',
    monsters: [m('crab', 9, 13), m('pirate', 10, 14), m('bandit', 9, 12, 'contrebandiers'), m('boar', 8, 10, 'arrière-pays')],
    miniBosses: [{ name: 'Capitaine Sel-Amer', model: 'pirate', lvl: 14, x: 340, z: 1120, desc: 'baril explosif + harpon' }],
    bosses: [], harvest: ['node_iron', 'node_herb_brume', 'sel_marin'],
  },
  ventfauve: {
    relief: ['collines', 'plaine'], version: 'v0.3', brumillons: 10,
    weather: [['clair', 5], ['nuageux', 3], ['orage', 2]],
    ambiance: 'Lande dorée battue par le vent, stèles noires qui luisent la nuit, silhouette d’un colosse endormi.',
    monsters: [m('skeleton', 9, 13), m('skeleton_archer', 10, 14), m('wraith', 11, 14, 'la nuit'), m('boar', 8, 11)],
    miniBosses: [], bosses: [{ key: 'troll', name: 'Colosse des Stèles', lvl: 15, x: 800, z: -420, desc: 'troll endormi au milieu de la lande (réf. image 2) : on choisit de le réveiller' }],
    harvest: ['node_iron', 'node_crystal'],
  },
  sylve: {
    relief: ['collines', 'foret_brume'], version: 'v0.3', brumillons: 16,
    weather: [['clair', 4], ['brume', 3], ['pluie', 3]],
    ambiance: 'Cathédrale d’arbres géants, rayons de lumière dans une brume verte, fougères, souches.',
    monsters: [m('wolf', 10, 13), m('spider', 11, 15), m('boar', 10, 12), m('goblin', 11, 14), m('goblin_shaman', 12, 15)],
    miniBosses: [{ name: 'Croc-Pâle', model: 'wolf', lvl: 13, x: -480, z: -1720, desc: 'meute de 4, hurlement qui étourdit' }, { name: 'La Tisseuse', model: 'spider', lvl: 16, x: 700, z: -2180, desc: 'cocons et pluie d’araignées' }],
    bosses: [], harvest: ['node_copper', 'node_iron', 'node_herb_brume', 'champignon_brume'],
  },
  arbre: {
    relief: ['plateau'], version: 'v0.3', brumillons: 6,
    weather: [['clair', 6], ['brume', 4]],
    ambiance: 'Brume dorée au ras du sol, feuillage or-argent de l’Arbre-Brume, pollen lumineux, grand escalier de pierre.',
    monsters: [m('skeleton', 12, 16), m('skeleton_archer', 13, 17), m('wraith', 14, 18, 'la nuit')],
    miniBosses: [{ name: 'Le Porte-Bannière', model: 'skeleton', lvl: 17, x: -40, z: -905, desc: 'garde le haut du Grand Escalier ; bannière qui renforce les squelettes' }],
    bosses: [], harvest: ['node_crystal', 'node_herb_brume'],
  },
  egares: {
    relief: ['foret_brume'], version: 'v0.3', brumillons: 16,
    weather: [['brume', 7], ['pluie', 2], ['clair', 1]],
    ambiance: 'Brume bleu-vert épaisse (vue 25–40 m), arbres morts noueux, lanternes à suivre, feux follets.',
    monsters: [m('wraith', 14, 18), m('spider', 14, 17), m('wolf', 14, 16, 'loups de brume'), m('treant', 15, 18, 'v0.4'), m('wisp', 14, 17, 'v0.4')],
    miniBosses: [{ name: 'La Dame Grise', model: 'wraith', lvl: 18, x: -60, z: -2120, desc: 'se dédouble dans la brume (v0.4 : remplacée par L’Écorce-Mère, écorcier géant)' }],
    bosses: [], harvest: ['node_crystal', 'node_herb_brume', 'champignon_brume'],
  },
  brumenoire: {
    relief: ['marais'], version: 'v0.3', brumillons: 12,
    weather: [['brume', 5], ['pluie', 3], ['orage', 2]],
    ambiance: 'Eau sombre et verdâtre, pontons, saules pleureurs, lanternes vertes, lucioles la nuit.',
    monsters: [m('bog_lurker', 15, 20), m('spider', 15, 18), m('wraith', 16, 19), m('goblin_shaman', 15, 18, 'chamans vasards'), m('toad_brute', 16, 20, 'v0.4')],
    miniBosses: [{ name: 'Le Noyeur', model: 'bog_lurker', lvl: 18, x: 1250, z: -500, desc: 'gardien de la région : tire sous l’eau' }],
    bosses: [{ key: 'swamp_hag', name: 'Sorcière des marais', lvl: 20, x: 1330, z: -760, desc: 'Sceau de Vase ; hutte sur pilotis' }],
    harvest: ['node_iron', 'node_herb_brume', 'roseau'],
  },
  sable_rouge: {
    relief: ['dunes', 'mesa', 'cuvette_lac'], version: 'v0.3', brumillons: 16,
    weather: [['clair', 6], ['tempete_sable', 3], ['nuageux', 1]],
    ambiance: 'Dunes ocre, palmiers, oasis turquoise, chutes fines au pied des falaises rouges, chaleur qui ondule.',
    monsters: [m('scorpion', 15, 19), m('bandit_desert', 16, 20), m('husk', 17, 21), m('rift_lizard', 16, 20)],
    miniBosses: [{ name: 'Scorpion-Empereur', model: 'scorpion', lvl: 20, x: -1150, z: 1000, desc: 'queue en arc, s’enfouit' }],
    bosses: [{ key: 'sand_wyrm', name: 'Ver des sables', lvl: 21, x: -1500, z: 980, desc: 'Sceau d’Ambre ; arène du Creux du Ver, en bordure de la Mer de Dunes' }],
    harvest: ['node_iron', 'node_herb_braise', 'pulpe_cactus'],
  },
  rougecrete: {
    relief: ['plateau', 'mesa', 'canyon'], version: 'v0.3', brumillons: 14,
    weather: [['clair', 6], ['nuageux', 2], ['tempete_sable', 1], ['orage', 1]],
    ambiance: 'Terrasses de roche rouge, genévriers, vent qui siffle, vue sur tout l’ouest depuis la Table du Géant.',
    monsters: [m('bandit', 16, 20), m('bandit_archer', 16, 20), m('rift_lizard', 17, 21), m('wolf', 16, 18), m('troll', 21, 22, 'rare, sur la Table')],
    miniBosses: [{ name: 'Maraude la Borgne', model: 'bandit', lvl: 20, x: -1650, z: -1100, desc: 'cheffe des brigands, primes au Fort du Couchant' }, { name: 'Troll des Mesas', model: 'troll', lvl: 22, x: -1850, z: -800, desc: 'sur la Table du Géant' }],
    bosses: [], harvest: ['node_iron', 'node_mithril', 'node_herb_givre'],
  },
  entaille: {
    relief: ['canyon'], version: 'v0.3', brumillons: 10,
    weather: [['clair', 7], ['nuageux', 2], ['orage', 1]],
    ambiance: 'Strates rouges et ocre, rivière verte au fond, pont suspendu, fresques d’Aldmar dans la paroi.',
    monsters: [m('scorpion', 18, 21), m('rift_lizard', 18, 22), m('bandit', 18, 20), m('harpy', 19, 22, 'v0.4')],
    miniBosses: [{ name: 'Gardien de la Faille', model: 'stone_guardian', lvl: 22, x: -1480, z: -1150, desc: 'gardien de région (golem de grès)' }],
    bosses: [], harvest: ['node_iron', 'node_crystal', 'node_herb_braise'],
  },
  embruns: {
    relief: ['cote_falaise', 'alpin'], version: 'v0.3', brumillons: 10,
    weather: [['nuageux', 4], ['pluie', 3], ['orage', 2], ['clair', 1]],
    ambiance: 'Falaises de 60–100 m battues par les embruns, lande rase, phare blanc à lanterne chaude.',
    monsters: [m('crab', 18, 22), m('bandit', 18, 21), m('troll', 22, 24, 'rare'), m('harpy', 20, 24, 'v0.4')],
    miniBosses: [{ name: 'Brise-Coque', model: 'troll', lvl: 24, x: 1840, z: -1300, desc: 'lance des rochers depuis la falaise (v0.4 : Reine des Harpies)' }],
    bosses: [], harvest: ['node_iron', 'node_mithril', 'sel_marin'],
  },
  azurine: {
    relief: ['cote_basse'], version: 'v0.3', brumillons: 16,
    weather: [['clair', 7], ['nuageux', 2], ['orage', 1]],
    ambiance: 'Lagons turquoise, sable clair, palmiers penchés, îles rondes à portée de vue, bancs de sable à gué.',
    monsters: [m('crab', 12, 17), m('pirate', 13, 18), m('pirate_harpooner', 14, 18), m('sea_serpent_whelp', 15, 18, 'v0.4')],
    miniBosses: [{ name: 'Amiral Crève-Voile', model: 'pirate', lvl: 18, x: 1560, z: 1060, desc: 'sur l’Île d’Azurine' }],
    bosses: [{ key: 'crab_king', name: 'Le Roi-Carapace', lvl: 23, x: 1300, z: 1380, desc: 'boss mondial annoncé (v0.4), Île du Corail' }],
    harvest: ['node_iron', 'sel_marin', 'corail_ecume'],
  },
  givreval: {
    relief: ['alpin', 'cuvette_lac'], version: 'v0.3', brumillons: 16,
    weather: [['neige', 5], ['clair', 3], ['nuageux', 2]],
    ambiance: 'Crêtes aiguës, neige qui fume sur les arêtes, sapins enneigés, lac gelé, mer de nuages sous les pics.',
    monsters: [m('ice_wolf', 20, 23), m('yeti', 21, 25), m('troll', 22, 25), m('wraith', 20, 23, 'spectres gelés')],
    miniBosses: [{ name: 'Crinière-de-Givre', model: 'ice_wolf', lvl: 23, x: -1060, z: -1560, desc: 'garde le Col du Loup Blanc' }],
    bosses: [{ key: 'frost_giant', name: 'Géant de givre', lvl: 25, x: -1470, z: -1960, desc: 'Sceau de Givre ; arène du Cirque du Géant, sous le Lac Glacé' }],
    harvest: ['node_mithril', 'node_crystal', 'node_herb_givre'],
  },
  couronne: {
    relief: ['alpin'], version: 'v0.3', brumillons: 6,
    weather: [['neige', 6], ['clair', 2], ['nuageux', 2]],
    ambiance: 'Glacier suspendu, vent qui arrache la neige des arêtes, bannières rouges déchirées aux bornes.',
    monsters: [m('yeti', 25, 29, 'élites'), m('ice_wolf', 25, 28), m('troll', 26, 30)],
    miniBosses: [{ name: 'Le Veilleur des Cimes', model: 'yeti', lvl: 29, x: -1700, z: -2330, desc: 'élite de zone rouge, butin T6' }],
    bosses: [], harvest: ['node_mithril', 'node_crystal', 'node_herb_givre'],
  },
  cendres: {
    relief: ['volcan', 'collines', 'cote_falaise'], version: 'v0.4', brumillons: 12,
    weather: [['cendres', 5], ['nuageux', 3], ['clair', 2]],
    ambiance: 'Pentes noires, fumerolles jaunes, ciel orangé, plage de sable noir au débouché du Cendreux.',
    monsters: [m('salamander', 22, 26), m('magma_golem', 24, 26), m('troll', 22, 25), m('ember_wisp', 22, 25)],
    miniBosses: [{ name: 'Le Forgeron des Cendres', model: 'magma_golem', lvl: 26, x: 1200, z: -1450, desc: 'gardien de région' }],
    bosses: [], harvest: ['node_mithril', 'node_herb_braise', 'obsidienne'],
  },
  coeur_brasier: {
    relief: ['volcan'], version: 'v0.4', brumillons: 6,
    weather: [['cendres', 7], ['nuageux', 3]],
    ambiance: 'Cratère noir, lac de lave, lumière rouge par en dessous, braises dans l’air.',
    monsters: [m('salamander', 26, 30, 'élites'), m('magma_golem', 27, 30), m('ember_wisp', 26, 29)],
    miniBosses: [],
    bosses: [{ key: 'ember_matriarch', name: 'La Brasier-Mère', lvl: 30, x: 1400, z: -2000, desc: 'Sceau de Braise, en groupe' }],
    harvest: ['node_mithril', 'node_crystal', 'obsidienne'],
  },
  aldmar: {
    relief: ['plateau'], version: 'v0.3', brumillons: 8,
    weather: [['clair', 5], ['brume', 3], ['orage', 2]],
    ambiance: 'Herbe dorée, remparts effondrés, pierres dressées aux runes cyan qui pulsent, lichen or.',
    monsters: [m('skeleton', 24, 27, 'chevaliers'), m('skeleton_archer', 24, 27), m('wraith', 25, 28), m('stone_guardian', 25, 28)],
    miniBosses: [{ name: 'Sénéchal Vorn', model: 'skeleton', lvl: 28, x: -330, z: -1180, desc: 'chevalier squelette, garde les Remparts du Couchant' }],
    bosses: [], harvest: ['node_mithril', 'node_crystal', 'node_herb_braise'],
  },
  coeur_aldmar: {
    relief: ['plateau'], version: 'v0.3', brumillons: 6,
    weather: [['brume', 4], ['orage', 3], ['clair', 3]],
    ambiance: 'Filtre de zone rouge : désaturation, brouillard rouille, braseros et bannières déchirées.',
    monsters: [m('skeleton', 27, 30, 'élites'), m('skeleton_archer', 27, 30), m('wraith', 27, 30), m('troll', 28, 30), m('stone_guardian', 28, 30)],
    miniBosses: [],
    bosses: [{ key: 'champion', name: 'Champion écarlate', lvl: 30, x: 250, z: -1300, desc: 'Arène Écarlate, fin de jeu JcJ/JcE (modèle à définir, v0.4)' }],
    harvest: ['node_mithril', 'node_crystal'],
  },
  mer_dunes: {
    relief: ['dunes'], version: 'v0.3', brumillons: 6,
    weather: [['tempete_sable', 5], ['clair', 5]],
    ambiance: 'Dunes géantes de 25–40 m contre l’océan, squelette du Grand Ver, bannières rouges.',
    monsters: [m('husk', 22, 28, 'élites'), m('scorpion', 22, 26), m('bandit_desert', 23, 27)],
    miniBosses: [{ name: 'Couvée du Ver', model: 'sand_wyrm', lvl: 27, x: -1880, z: 1140, desc: 'petit ver (échelle 0,5), élite' }],
    bosses: [], harvest: ['node_mithril', 'node_herb_braise'],
  },
  epave: {
    relief: ['cote_basse', 'cote_falaise'], version: 'v0.3', brumillons: 4,
    weather: [['clair', 5], ['orage', 3], ['nuageux', 2]],
    ambiance: 'Épave géante échouée, falaises, lanternes des naufrageurs ; zone rouge petite et facultative.',
    monsters: [m('pirate', 20, 24, 'Naufrageurs'), m('pirate_harpooner', 20, 24), m('crab', 19, 22)],
    miniBosses: [{ name: 'La Veuve des Naufrageurs', model: 'pirate', lvl: 24, x: 1950, z: 1440, desc: 'cheffe des Naufrageurs, butin T5 (+2 niveaux d’objet)' }],
    bosses: [], harvest: ['node_crystal', 'corail_ecume'],
  },
};

// ------------------------------------------------------------------ villes, avant-postes et camps (services)
export const SERVICES = {
  brumeval: { services: ['forge', 'alchimie', 'couture', 'etals_marche', 'banque', 'auberge', 'maitre_des_arts', 'arene_duel', 'pierre'], version: 'v0.1' },
  port_salin: { services: ['forge', 'alchimie', 'couture', 'etals_marche', 'banque', 'auberge', 'capitainerie', 'pierre'], version: 'v0.3', codex: 'CX-5' },
  ambresable: { services: ['forge', 'alchimie', 'etals_marche', 'banque', 'auberge', 'loueur_chars_v0.4', 'pierre'], version: 'v0.3', codex: 'CX-13 (proposé)' },
  rochegivre: { services: ['forge', 'alchimie', 'banque', 'auberge', 'pierre'], version: 'v0.3', codex: 'CX-15 (proposé)' },
  clairsaule: { services: ['couture', 'alchimie', 'auberge', 'pierre'], version: 'v0.3' },
  relais_mordore: { services: ['marchand', 'feu', 'ecurie_v0.4'], version: 'v0.3' },
  poste_cendres: { services: ['marchand', 'feu', 'forge', 'banque_de_campagne'], version: 'v0.4' },
  phare: { services: ['marchand', 'feu'], version: 'v0.3' },
};
// Camps : petits lieux habités sans zone verte (pas de nivellement dans la carte : posés sur un replat < 12°).
export const CAMPS = [
  { id: 'sanctuaire_veilleuse', name: 'Sanctuaire de la Veilleuse', x: -95, z: -1135, region: 'arbre', services: ['echange_brumillons', 'feu', 'pierre'], safeRadius: 45, version: 'v0.3' },
  { id: 'hameau_saules', name: 'Hameau des Saules', x: -430, z: 560, region: 'songes', services: ['alchimie', 'feu'], version: 'v0.3' },
  { id: 'pilotis_brumenoire', name: 'Pilotis de Brumenoire', x: 1120, z: -860, region: 'brumenoire', services: ['alchimie', 'guerisseuse', 'feu'], version: 'v0.3', onWater: true, note: 'village sur pilotis : planchers à 1,5 m au-dessus de 0,7 m d’eau' },
  { id: 'fort_couchant', name: 'Fort du Couchant', x: -1567, z: -707, region: 'rougecrete', services: ['forge', 'primes', 'feu'], version: 'v0.3' },
  { id: 'camp_grandes_portes', name: 'Camp des Grandes Portes', x: 0, z: -1250, region: 'arbre', services: ['marchand', 'feu'], version: 'v0.3' },
];

// ------------------------------------------------------------------ lieux nommés (points d'intérêt)
// type : belvedere | ruine | repere | sanctuaire | camp_monstres | grotte | cascade | pont | arene | epave | stele | source
// Un belvédère révèle la région sur la carte (brouillard de guerre).  version = quand il est posé dans le monde.
const p = (id, region, type, name, x, z, version = 'v0.3', desc = '') => ({ id, region, type, name, x, z, version, desc });
export const POIS = [
  // Val de Brumeval (lieux existants conservés aux mêmes x/z)
  p('vb_village', 'brumeval', 'repere', 'Village de Brumeval', 0, 0, 'v0.1', 'départ, zone verte'),
  p('vb_camp_gobelin', 'brumeval', 'camp_monstres', 'Camp gobelin', -100, -8, 'v0.1'),
  p('vb_cimetiere', 'brumeval', 'ruine', 'Cimetière oublié', 88, -88, 'v0.1'),
  p('vb_foret_murmures', 'brumeval', 'repere', 'Forêt des Murmures', 10, -92, 'v0.1'),
  p('vb_moulin', 'brumeval', 'repere', 'Moulin des Trois-Ailes', 230, 230, 'v0.3', 'meunier, quêtes de récolte'),
  p('vb_tour_guet', 'brumeval', 'belvedere', 'Tour de guet du Val', -260, -330, 'v0.3', 'première tour à gravir'),
  p('vb_stele', 'brumeval', 'stele', "Stèle d'Éveil", 120, -420, 'v0.3', 'premier souvenir d’Aldmar'),
  p('vb_mine', 'brumeval', 'grotte', 'Mine de Cuivrefond', -350, -560, 'v0.4', 'petit donjon niv. 6–8'),
  // Prairies de Mordoré
  p('mo_menhirs', 'mordore', 'stele', 'Cercle des Sept Menhirs', -620, -860, 'v0.3', 'énigme des ombres à midi'),
  p('mo_meules', 'mordore', 'camp_monstres', 'Meules des Brigands', -900, -80, 'v0.3'),
  p('mo_digue', 'mordore', 'repere', 'Digue du Lac Vermeil', -1010, -140, 'v0.3', 'levée naturelle qui retient le lac'),
  p('mo_hure', 'mordore', 'arene', 'Bauge de la Vieille-Hure', -560, -300, 'v0.3'),
  p('mo_guet', 'mordore', 'belvedere', 'Mont Guet', -1035, -1323, 'v0.3', '200 m, vue sur Rougecrête et Givreval'),
  // Rives du Lac des Songes
  p('so_temple', 'songes', 'grotte', 'Temple englouti', -658, 843, 'v0.4', 'donjon niv. 12–15'),
  p('so_anse', 'songes', 'repere', 'Anse des Songes', -600, 1090),
  p('so_ponton', 'songes', 'belvedere', 'Ponton des Brumes', -400, 700, 'v0.3', 'belvédère sur le lac'),
  p('so_saules', 'songes', 'arene', 'Nid de la Tisseuse des Saules', -820, 800),
  // Côte de Port-Salin
  p('ps_port', 'port_salin', 'repere', 'Port-Salin', 690, 870),
  p('ps_falaises', 'port_salin', 'belvedere', 'Falaises Blanches', 60, 1130, 'v0.3'),
  p('ps_crique', 'port_salin', 'camp_monstres', 'Crique des Contrebandiers', 340, 1120),
  p('ps_embouchure', 'port_salin', 'repere', 'Embouchure de la Salinelle', 745, 960),
  p('ps_tour', 'port_salin', 'ruine', 'Tour du Guet côtier', 460, 560),
  // Landes de Ventfauve
  p('ve_grande_stele', 'ventfauve', 'stele', "Grande Stèle d'Aldmar", 620, -460, 'v0.3', 'chapitre III'),
  p('ve_colosse', 'ventfauve', 'arene', 'Colosse des Stèles', 800, -420),
  p('ve_caveau', 'ventfauve', 'ruine', 'Caveau aux Braseros', 520, -920),
  p('ve_rampe', 'ventfauve', 'repere', "Pied de la Rampe de l'Est", 430, -560),
  // Sylve Ancienne
  p('sy_souche', 'sylve', 'belvedere', 'Souche du Géant', 200, -1650, 'v0.3', 'belvédère intérieur'),
  p('sy_lucioles', 'sylve', 'source', 'Source aux Lucioles', 650, -1580, 'v0.3', 'la nuit'),
  p('sy_croc', 'sylve', 'arene', 'Tanière de Croc-Pâle', -480, -1720),
  p('sy_tisseuse', 'sylve', 'arene', 'Nid de la Tisseuse', 700, -2180),
  p('sy_aiguille', 'givreval', 'belvedere', 'Aiguille Grise', -742, -2461, 'v0.3', '331 m'),
  // Parvis de l'Arbre-Brume
  p('ar_arbre', 'arbre', 'repere', "L'Arbre-Brume", -120, -1200, 'v0.3', 'CX-10, cime à ≈ 300 m'),
  p('ar_escalier', 'arbre', 'repere', 'Grand Escalier de la Voie Royale', -40, -880),
  p('ar_racines', 'arbre', 'grotte', "Racines de l'Arbre-Brume", -200, -1260, 'v0.4', 'donjon niv. 14–18'),
  // Ruines d'Aldmar et Cœur d'Aldmar
  p('al_remparts', 'aldmar', 'ruine', 'Remparts du Couchant', -350, -1100),
  p('al_tour', 'aldmar', 'belvedere', 'Tour Brisée', -330, -1300),
  p('al_porte_est', 'aldmar', 'ruine', "Porte de l'Est", 250, -940),
  p('ca_portes', 'coeur_aldmar', 'ruine', 'Grandes Portes', 75, -1200, 'v0.3', 'fermées par 4 Sceaux'),
  p('ca_bassin', 'aldmar', 'source', 'Bassin des Rois', 120, -1080),
  p('ca_arene', 'coeur_aldmar', 'arene', 'Arène Écarlate', 250, -1300),
  // Bois des Égarés
  p('eg_lanternes', 'egares', 'repere', 'Sentier des Lanternes', -120, -1900),
  p('eg_coeur', 'egares', 'sanctuaire', 'Cœur de la Brume', -100, -2060),
  p('eg_dame', 'egares', 'arene', 'Clairière de la Dame Grise', -60, -2120),
  // Marais de Brumenoire
  p('br_antre', 'brumenoire', 'arene', 'Antre de la Sorcière', 1330, -760),
  p('br_mares', 'brumenoire', 'repere', 'Mares aux Feux', 1000, -1000),
  p('br_passerelles', 'brumenoire', 'pont', 'Passerelles effondrées', 1450, -1000),
  p('br_noyeur', 'brumenoire', 'arene', 'Fosse du Noyeur', 1250, -500),
  p('br_delta', 'brumenoire', 'repere', 'Delta de la Brumeuse', 1620, -300),
  // Désert de Sable-Rouge
  p('sr_ville', 'sable_rouge', 'repere', 'Ambresable', -1240, 400),
  p('sr_mirages', 'sable_rouge', 'source', 'Oasis des Mirages', -1830, 760),
  p('sr_enclumes', 'sable_rouge', 'belvedere', 'Les Trois Enclumes', -2000, 520),
  p('sr_colonne', 'sable_rouge', 'belvedere', 'Colonne des Vents', -1560, 560),
  p('sr_sentinelle', 'sable_rouge', 'belvedere', 'Sentinelle Rouge', -1120, 720),
  p('sr_miroirs', 'sable_rouge', 'ruine', 'Temple aux Miroirs', -1300, 820),
  p('sr_palmes', 'sable_rouge', 'source', 'Puits des Palmes', -1000, 920),
  p('sr_creux', 'sable_rouge', 'arene', 'Creux du Ver', -1450, 1000),
  p('sr_palais', 'sable_rouge', 'ruine', 'Palais-Mirage', -1350, 1200, 'v0.3', 'visible seulement à midi'),
  // Mer de Dunes (rouge)
  p('md_squelette', 'mer_dunes', 'repere', 'Squelette du Grand Ver', -1900, 1150),
  p('md_tour_sel', 'mer_dunes', 'belvedere', 'Tour de Sel', -1600, 1150),
  // Hauts-Plateaux de Rougecrête
  p('rc_table', 'rougecrete', 'belvedere', 'Table du Géant', -1850, -800, 'v0.3', '260 m, meilleur point de vue de l’ouest'),
  p('rc_tour', 'rougecrete', 'belvedere', 'Tour des Quatre-Vents', -1850, -1250),
  p('rc_repaire', 'rougecrete', 'camp_monstres', 'Repaire de Maraude', -1650, -1100),
  p('rc_gorge', 'entaille', 'repere', 'Gorge Sèche', -1420, -625),
  // Canyon de l'Entaille
  p('en_pont', 'entaille', 'pont', "Pont de l'Entaille", -1440, -760),
  p('en_chutes', 'entaille', 'cascade', "Chutes d'Ambresable", -1356, 78, 'v0.3', '53 m'),
  p('en_fresques', 'entaille', 'ruine', "Fresques d'Aldmar", -1470, -400),
  p('en_gardien', 'entaille', 'arene', 'Seuil du Gardien', -1471, -1146),
  // Falaises des Embruns
  p('em_phare', 'embruns', 'belvedere', 'Phare des Embruns', 1985, -1010),
  p('em_ecumeur', 'embruns', 'belvedere', 'Mont Écumeur', 1872, -1147, 'v0.3', '289 m'),
  p('em_breche', 'embruns', 'repere', 'Brèche des Embruns', 1760, -760),
  p('em_aire', 'embruns', 'arene', 'Aire de Brise-Coque', 1780, -1280),
  // Archipel d'Azurine
  p('az_palmes', 'port_salin', 'repere', 'Plage des Palmes', 1240, 720),
  p('az_chaussee', 'azurine', 'pont', 'Chaussée des Sables', 1430, 930, 'v0.3', 'banc de sable à gué'),
  p('az_ile', 'azurine', 'belvedere', "Sommet d'Azurine", 1620, 1150),
  p('az_corail', 'azurine', 'arene', 'Île du Corail', 1270, 1400, 'v0.4', 'Roi-Carapace'),
  p('az_ilot', 'azurine', 'repere', 'Îlot des Palmes', 1850, 860),
  // Île de l'Épave (rouge)
  p('ep_epave', 'epave', 'epave', 'Épave géante', 1950, 1440),
  p('ep_passe', 'epave', 'pont', 'Passe des Naufrageurs', 1830, 1320, 'v0.3', 'banc de sable'),
  // Pics de Givreval
  p('gi_col', 'givreval', 'repere', 'Col du Loup Blanc', -1070, -1510),
  p('gi_lac', 'givreval', 'repere', 'Lac Glacé', -1450, -2020, 'v0.3', 'glace qui craque'),
  p('gi_cirque', 'givreval', 'arene', 'Cirque du Géant', -1520, -1840),
  p('gi_blanchecorne', 'givreval', 'belvedere', 'Belvédère de Blanchecorne', -1760, -1960),
  p('gi_dent', 'givreval', 'belvedere', "Dent de l'Hiver", -1242, -2079, 'v0.3', '356 m'),
  // Couronne de Givre (rouge)
  p('co_givrecime', 'couronne', 'belvedere', 'Pic de Givrecime', -1660, -2268, 'v0.3', '≈ 382–405 m, plus haut sommet jouable'),
  p('co_glacier', 'couronne', 'repere', 'Glacier suspendu', -1800, -2380),
  // Terres de Cendre et Cœur du Brasier (v0.4)
  p('ce_col', 'cendres', 'repere', 'Col des Cendres', 960, -1900, 'v0.4'),
  p('ce_fumerolles', 'cendres', 'repere', 'Champ de Fumerolles', 1200, -1450, 'v0.4'),
  p('ce_plage', 'cendres', 'repere', 'Plage noire du Cendreux', 1960, -1830, 'v0.4'),
  p('ce_suie', 'cendres', 'belvedere', 'Pic de Suie', 891, -2434, 'v0.4', '280 m'),
  p('cb_cratere', 'coeur_brasier', 'arene', 'Caldeira de la Brasier-Mère', 1400, -2000, 'v0.4'),
];

// Accès particuliers (le contrôle à pied les signale sans les compter comme erreurs) et replats à tailler à la cuisson du terrain.
const POI_NOTES = {
  sr_enclumes: { access: 'sommet de mesa : vu de loin en v0.3, atteint en vol plané (v0.5)' },
  sr_sentinelle: { access: 'sommet de mesa : vu de loin en v0.3, atteint en vol plané (v0.5)' },
  cb_cratere: { bake: 'plateforme de 40 m à niveler dans la caldeira (v0.4)' },
  em_aire: { bake: 'replat de 30 m à tailler dans la falaise (v0.3)' },
};
for (const q of POIS) Object.assign(q, POI_NOTES[q.id] || {});
// Corrections de placement des objets posés par le générateur (tools/out/carto.json), appliquées par build_layout.mjs.
export const PLACEMENT_OVERRIDES = {
  poste_cendres: { x: 1003, z: -1507, why: 'pente de 48° au point du générateur' },
  wp_delta: { region: 'brumenoire', why: 'le delta est dans le marais' },
  grotte_marees: { x: 1880, z: 1292, why: 'entrée hors de l’eau, sur la plage de l’Épave' },
};

// ------------------------------------------------------------------ donjons (entrées posées dans le monde dès la v0.3, « Scellé par la Brume »)
export const DUNGEON_CONTENT = {
  antre_golem: { kind: 'arène ouverte', levels: [12, 14], boss: 'Golem ancien', version: 'v0.1', kit: 'existant' },
  antre_sorciere: { kind: 'arène ouverte', levels: [18, 20], boss: 'Sorcière des marais', version: 'v0.3', kit: 'swamp_hut' },
  crypte_aldmar: { kind: 'instance', levels: [27, 30], boss: "Roi-Liche d'Aldmar", version: 'v0.4', kit: 'CX-4 dng_*' },
  grotte_gelee: { kind: 'instance', levels: [22, 25], boss: 'Yéti ancestral, Écho du Géant', version: 'v0.4', kit: 'CX-11 ice_*' },
  mines_rougecrete: { kind: 'instance', levels: [18, 21], boss: 'Contremaître Rouille (troll)', version: 'v0.4', kit: 'dng_* + filons' },
  grotte_marees: { kind: 'instance', levels: [20, 24], boss: 'Capitaine Sel-Amer (revenu)', version: 'v0.4', kit: 'dng_* + port_*' },
  tombeau_sables: { kind: 'instance', levels: [24, 28], boss: 'La Couvée du Ver', version: 'v0.5', kit: 'kit sable (nouveau)' },
  forge_brasier: { kind: 'instance', levels: [29, 30], boss: 'Le Premier Forgeron', version: 'v0.5', kit: 'dng_* + lave' },
};
// Donjons ajoutés par le contenu (entrées marquées aussi dans POIS).
export const EXTRA_DUNGEONS = [
  { id: 'mine_cuivrefond', name: 'Mine de Cuivrefond', x: -350, z: -560, region: 'brumeval', kind: 'instance', levels: [6, 8], boss: 'Contremaître gobelin', version: 'v0.4', kit: 'dng_* + filons' },
  { id: 'temple_englouti', name: 'Temple englouti', x: -658, z: 843, region: 'songes', kind: 'instance', levels: [12, 15], boss: 'La Nixe du lac', version: 'v0.4', kit: 'dng_* + eau' },
  { id: 'racines_arbre', name: "Racines de l'Arbre-Brume", x: -200, z: -1260, region: 'arbre', kind: 'instance', levels: [14, 18], boss: 'Le Ver-Racine', version: 'v0.4', kit: 'kit racines (nouveau)' },
];

// ------------------------------------------------------------------ trame, collectible, déplacements
export const STORY = [
  { chapter: 'I', title: 'La Brume se lève', regions: ['brumeval'], levels: [1, 14], version: 'v0.1', summary: 'Chaîne d’Aldric (existante). Le cœur du Golem porte une rune d’or : « l’Arbre se meurt ».' },
  { chapter: 'II', title: 'La Veilleuse', regions: ['sylve', 'arbre'], levels: [10, 15], version: 'v0.3', summary: 'On monte la Voie Royale jusqu’à l’Arbre-Brume. Son esprit, la Veilleuse, révèle que la Brume-Noire suinte du Cœur d’Aldmar, retenue jadis par quatre Sceaux.' },
  { chapter: 'III', title: "La mémoire d'Aldmar", regions: ['ventfauve', 'egares'], levels: [11, 18], version: 'v0.3', summary: 'Les stèles de Ventfauve et le Cœur de la Brume montrent la chute d’Aldmar et désignent les quatre gardiens corrompus.' },
  { chapter: 'IV', title: 'Les quatre Sceaux (ordre libre)', regions: ['brumenoire', 'sable_rouge', 'givreval', 'coeur_brasier'], levels: [18, 30], version: 'v0.3 (3 Sceaux) + v0.4 (Braise)', summary: 'Vase (Sorcière, 20), Ambre (Ver, 21), Givre (Géant, 25), Braise (Brasier-Mère, 30, v0.4). Chaque Sceau rallumé ouvre un pan des Grandes Portes.' },
  { chapter: 'V', title: 'Le Roi-Liche', regions: ['coeur_aldmar'], levels: [27, 30], version: 'v0.4', summary: 'Avec 3 Sceaux, les Grandes Portes s’ouvrent sur la Crypte d’Aldmar. En v0.3 la trame s’arrête devant les Portes (« à suivre »).' },
];
export const COLLECTIBLE = {
  name: 'Brumillons', npc: 'la Veilleuse (Sanctuaire de la Veilleuse)',
  puzzles: ['soulever une pierre', 'allumer une lanterne', 'petite course contre la montre', 'toucher une cible', 'suivre un feu follet', 'atteindre un sommet', 'regarder une stèle à la bonne heure'],
  rewards: [[5, '+2 emplacements de sac'], [15, '+2 emplacements de sac'], [30, '+10 emplacements de banque'], [60, 'Titre « Ami des Brumillons »'], [100, 'Cape de brume (cosmétique)'], [150, 'Familier Brumillon (v0.5)'], [240, 'Titre « Gardien de l’Arbre » + teinture dorée']],
};
export const TRAVERSAL = [
  ['Pierres de téléportation (26) et belvédères qui révèlent la carte', 'v0.3'],
  ['Saut, sprint, roulade ; gués ≤ 0,8 m, bancs de sable, ponts, pontons', 'v0.3'],
  ['Monture « Destrier de brume » (CX-7), 14 m/s hors combat, interdite en donjon', 'v0.4'],
  ['Char à sable des dunes (Ambresable, sable seulement)', 'v0.4'],
  ['Fumerolles et geysers qui propulsent (Cendres, marais)', 'v0.4'],
  ['Barque et voilier (Port-Salin ↔ archipel, lac)', 'v0.5'],
  ['Vol plané « Aile de toile » depuis les étages E5 et plus', 'v0.5'],
];
// Ouverture des régions (le relief entier existe dès la v0.3 ; une région fermée est visible mais barrée par le jeu).
export const OPENING = {
  brumeval: 'v0.3.0', mordore: 'v0.3.0', songes: 'v0.3.0', port_salin: 'v0.3.0', ventfauve: 'v0.3.0', sylve: 'v0.3.0', egares: 'v0.3.0',
  arbre: 'v0.3.0', aldmar: 'v0.3.0', coeur_aldmar: 'v0.3.0', brumenoire: 'v0.3.0', sable_rouge: 'v0.3.0', mer_dunes: 'v0.3.0',
  embruns: 'v0.3.0', // seule région jaune 18–24 ouverte en v0.3.0 : comble le creux 22–24 entre Sable-Rouge (≤ 22) et Aldmar (24+)
  givreval: 'v0.3.1', couronne: 'v0.3.1', rougecrete: 'v0.3.1', entaille: 'v0.3.1', azurine: 'v0.3.1', epave: 'v0.3.1',
  cendres: 'v0.4', coeur_brasier: 'v0.4',
};
// Barrières de jeu des régions fermées (jamais un mur invisible nu).
export const CLOSED_BY = {
  givreval: 'Col du Loup Blanc enseveli (avalanche) jusqu’à la v0.3.1', couronne: 'derrière Givreval',
  rougecrete: 'Gorge Sèche obstruée par un éboulement', entaille: 'Pont de l’Entaille effondré',
  azurine: 'Chaussée des Sables recouverte (grande marée)', epave: 'derrière Azurine',
  cendres: 'Col des Cendres : nuée ardente permanente (dégâts de zone) jusqu’à la v0.4', coeur_brasier: 'derrière les Terres de Cendre',
};
// Niveau conseillé des pierres « de région » : sert au contrôle de la courbe de niveaux (validate.mjs).
export const HUBS = ['brumeval', 'port_salin', 'ambresable', 'rochegivre', 'clairsaule'];
