// Brumeval Online — v0.3 open world: hand-authored macro layout (single source of truth).
// Coordinates = game coordinates in metres: x east, z SOUTH (north = -z, top of every map), y up.
// Brumeval village stays at (0, 0): every saved player position of v0.1/v0.2 remains valid.
// Elevations are metres above SEA LEVEL (sea = 0). The legacy 360 m square is lifted by LEGACY.lift.

// ------------------------------------------------------------------ frame
export const GRID = {
  size: 1025,            // samples per side (vertex grid, 1024 cells)
  step: 4.5,             // metres between samples
  x0: -2304,             // x of sample column 0  (= -512 * 4.5)
  z0: -2808,             // z of sample row 0     (= -624 * 4.5) -> Brumeval (0,0) is exactly sample (512, 624)
};
GRID.x1 = GRID.x0 + (GRID.size - 1) * GRID.step; // 2304
GRID.z1 = GRID.z0 + (GRID.size - 1) * GRID.step; // 1800
export const PLAYABLE = { x0: -2048, x1: 2048, z0: -2560, z1: 1536 }; // 4096 x 4096 m
export const HEIGHT_CODE = { offset: -60, scale: 0.01 };  // metres = u16 * 0.01 - 60  -> [-60, 595.35]
export const SEED = 7331;
export const CONTROL_CELL = 32;  // metres per control-map cell -> 144 x 144 cells

// ------------------------------------------------------------------ legacy starting square
export const LEGACY = { half: 180, keep: 170, blendTo: 450, lift: 45 };

// ------------------------------------------------------------------ broad lowland elevation (Gaussian-weighted Shepard mix)
// [x, z, h, radius]  — lowlands only; mountains, plateaus and volcano are added as landforms.
export const ANCHORS = [
  [0, 0, 45, 520],            // Val de Brumeval
  [-500, 200, 40, 450],
  [380, -350, 55, 420],       // Salinelle upper valley
  [-850, -450, 66, 560],      // Prairies de Mordoré
  [-600, -950, 84, 480],
  [-1000, -1150, 100, 380],
  [-250, 650, 34, 450],       // south hills
  [300, 650, 30, 420],
  [-650, 650, 22, 280],       // Lac des Songes basin
  [0, -1150, 96, 480],        // around the Aldmar plateau
  [0, -2050, 118, 650],       // Sylve ancienne
  [600, -1800, 110, 450],
  [-500, -1950, 150, 420],
  [650, -800, 58, 420],       // Landes de Ventfauve
  [1050, -700, 6, 420],       // Brumenoire wetlands
  [1400, -500, 4, 380],
  [800, -250, 32, 420],
  [1100, 250, 26, 450],
  [1300, -1500, 95, 450],     // Terres de Cendre
  [950, -1250, 70, 380],
  [1450, -2050, 150, 600],    // volcano foot
  [1800, -1000, 120, 320],    // Embruns hinterland
  [-1500, -2150, 225, 650],   // Givreval massif base
  [-1050, -1900, 180, 400],
  [-1950, -1700, 205, 420],
  [-1450, -1650, 190, 300],   // Rochegivre shelf
  [-1700, -700, 95, 520],     // under the Rougecrête plateau (plateau is a landform)
  [-1400, 850, 38, 620],      // Désert de Sable-Rouge
  [-1900, 950, 45, 480],
  [-950, 1000, 22, 380],
  [-1300, 400, 40, 250],      // Ambresable
];

// ------------------------------------------------------------------ coastline (LAND polygon, clockwise on the map)
export const COAST = [
  [-2800, -3300], [2150, -3300],
  [2060, -2600], [2000, -2250], [1935, -2080], [1985, -1960], [2070, -1800], [2020, -1500], [2100, -1250], [2085, -1150], [2060, -960], [2030, -820],
  [1960, -680], [1900, -560], [1720, -520], [1640, -430], [1700, -330], [1830, -240], [1910, -60], [1960, 90], [1900, 170], [1790, 190], [1760, 290], [1820, 380], [1720, 470],
  [1620, 520], [1540, 640], [1400, 720], [1300, 760], [1200, 860], [1100, 920], [980, 960], [880, 930], [800, 900], [740, 930], [700, 990], [640, 1080], [600, 1200],
  [540, 1250], [470, 1210], [400, 1150], [300, 1170], [180, 1230], [60, 1250], [-40, 1300], [-120, 1370], [-200, 1350], [-260, 1270], [-330, 1230], [-420, 1160],
  [-500, 1150], [-580, 1200], [-650, 1280], [-760, 1310], [-900, 1300], [-1050, 1340], [-1150, 1420], [-1250, 1470], [-1380, 1440], [-1500, 1380], [-1620, 1400],
  [-1750, 1470], [-1860, 1500], [-1960, 1430], [-2050, 1340], [-2150, 1300], [-2800, 1300],
];
// Stretches with sea cliffs instead of beaches: [x, z, radius, cliffiness 0..1]
export const COAST_CLIFFS = [
  [2050, -1150, 420, 1.0],  // Falaises des Embruns
  [2010, -2200, 350, 0.8],  // black cliffs under the volcano
  [-2050, 1320, 250, 0.7],  // desert headland
  [150, 1230, 160, 0.6],    // small chalk cliffs west of Port-Salin
];
// Shallow turquoise lagoons (sea floor -0.4 .. -3 m): [x, z, rx, rz]
export const LAGOONS = [
  [1600, 1150, 650, 480],
  [1250, 850, 260, 180],
  [-200, 1400, 260, 140],
  [-1850, 1420, 300, 120],
];
// Islands: [id, name, x, z, radius, summit, cliffiness]
export const ISLANDS = [
  ['azurine', "Île d'Azurine", 1620, 1150, 250, 46, 0.2],
  ['corail', 'Île du Corail', 1260, 1390, 120, 16, 0],
  ['epave', "Île de l'Épave", 1930, 1400, 150, 44, 0.2],   // lead pass : pentes praticables (zone rouge v0.3)
  ['mouettes', 'Île aux Mouettes', -170, 1450, 90, 24, 0.5],
  ['ilot_e', 'Îlot des Palmes', 1850, 860, 75, 11, 0],
  ['ilot_s', 'Îlot Nacré', 1420, 1480, 70, 9, 0],
  ['ilot_n', 'Îlot du Guet', 2000, 1030, 85, 28, 0.4],
];
// Walkable sandbars (water 0.4 m deep): polylines
export const SANDBARS = [
  [[1330, 800], [1430, 930], [1500, 1010]],
  [[1720, 1050], [1800, 930], [1840, 880]],
  [[1480, 1260], [1330, 1350]],
  [[1760, 1260], [1830, 1330], [1880, 1370]],   // Passe des Naufrageurs : Azurine -> Île de l'Épave (lead-designer pass)
];

// ------------------------------------------------------------------ mountain ranges: ridge polylines [x, z, crestHeight, halfWidth]
export const RIDGES = [
  { id: 'mur_nord', name: 'Murailles du Nord', pts: [[-2450, -2800, 470, 380], [-1300, -2830, 540, 380], [0, -2820, 500, 360], [900, -2830, 520, 360], [2300, -2800, 480, 360]] },
  { id: 'mur_ouest', name: 'Monts de Bordure', pts: [[-2420, -2800, 520, 360], [-2420, -1800, 470, 360], [-2440, -900, 400, 340], [-2460, -150, 330, 320]] },
  { id: 'givreval', name: 'Chaîne de Givreval', pts: [[-2250, -2480, 370, 330], [-1900, -2360, 350, 330], [-1650, -2250, 385, 340], [-1430, -2150, 300, 300], [-1250, -2060, 350, 300], [-1050, -2170, 290, 300], [-880, -2320, 270, 280], [-650, -2520, 300, 280]] },
  { id: 'givreval_sud', name: 'Contrefort de Blanchecorne', pts: [[-1900, -2360, 350, 300], [-1900, -1860, 315, 300], [-2020, -1520, 255, 280], [-2080, -1250, 215, 260]] },
  { id: 'loup', name: 'Crête du Loup', pts: [[-1250, -2060, 350, 240], [-1110, -1720, 262, 200], [-1070, -1510, 196, 170], [-1030, -1330, 218, 170], [-980, -1150, 120, 150]] },
  { id: 'suie', name: 'Échine de Suie', pts: [[850, -2750, 330, 260], [880, -2350, 230, 240], [930, -2080, 205, 220], [960, -1900, 142, 180], [1010, -1720, 168, 190], [1060, -1560, 118, 160]] },
  { id: 'calcinees', name: 'Crêtes Calcinées', pts: [[1450, -2050, 300, 260], [1780, -2330, 250, 260], [1950, -2650, 300, 260]] },
  { id: 'embruns', name: 'Monts des Embruns', pts: [[1600, -1480, 150, 260], [1850, -1160, 258, 260], [1900, -860, 205, 240], [1820, -640, 110, 180]] },
];
// Isolated summits (cones added on top): [id, name, x, z, height, radius]
export const PEAKS = [
  ['givrecime', 'Pic de Givrecime', -1650, -2250, 425, 280],
  ['dent', "Dent de l'Hiver", -1250, -2060, 360, 220],
  ['blanchecorne', 'Mont Blanchecorne', -1900, -1860, 322, 220],
  ['aiguille', 'Aiguille Grise', -880, -2320, 300, 190],
  ['corne_loup', 'Corne du Loup', -1110, -1720, 268, 160],
  ['guet', 'Mont Guet', -1030, -1330, 222, 130],
  ['ecumeur', 'Mont Écumeur', 1850, -1160, 264, 220],
  ['suie', 'Pic de Suie', 880, -2350, 236, 170],
];
// Volcano: cone with crater and a breach (lava spillway) toward `breach` angle (radians, atan2(dz, dx)).
export const VOLCANO = { id: 'brasier', name: 'Mont Brasier', x: 1450, z: -2050, base: 150, top: 430, R: 680, craterR: 95, craterDepth: 62, breach: Math.atan2(1, 1), breachWidth: 0.35 };

// Plateaus: polygon with cliff edges.  top = [h at centroid], tilt = [dh/dx, dh/dz], edge = cliff width (m)
export const PLATEAUS = [
  { id: 'aldmar', name: "Plateau d'Aldmar", top: 148, tilt: [0.0, 0.004], edge: 22, dome: 10, terrace: 0,
    poly: [[-430, -1160], [-370, -1330], [-200, -1450], [20, -1480], [230, -1410], [340, -1240], [330, -1030], [230, -900], [20, -840], [-200, -860], [-360, -960]] },
  { id: 'rougecrete', label: [-1700, -300], name: 'Hauts-Plateaux de Rougecrête', top: 188, tilt: [0.012, -0.006], edge: 34, dome: 0, terrace: 11,
    poly: [[-2400, -1480], [-1600, -1420], [-1260, -1390], [-1180, -1250], [-1215, -960], [-1250, -700], [-1290, -420], [-1170, -240], [-1150, -60], [-1220, 110], [-1460, 175], [-1760, 120], [-2060, 210], [-2400, 200]] },
  { id: 'rougecrete_haut', name: 'Haut-Rougecrête', top: 232, tilt: [0.01, -0.004], edge: 26, dome: 0, terrace: 11,
    poly: [[-2400, -1470], [-1950, -1440], [-1820, -1250], [-1880, -1060], [-2010, -880], [-2120, -600], [-2400, -520]] },
];
// Mesas: [id, name, x, z, radius, topHeight]  (cliff edges, flat tops)
export const MESAS = [
  ['table_geant', 'Table du Géant', -1850, -800, 170, 258],
  ['enclume_1', 'Les Trois Enclumes', -2000, 520, 95, 128],
  ['enclume_2', null, -1860, 470, 60, 112],
  ['enclume_3', null, -1930, 640, 55, 104],
  ['sentinelle', 'Sentinelle Rouge', -1120, 720, 70, 92],
  ['colonne', 'Colonne des Vents', -1560, 560, 45, 96],
  ['tour_sel', 'Tour de Sel', -1600, 1150, 60, 70],
];
// Basins (depressions) : [id, x, z, rx, rz, depth]
export const BASINS = [
  ['egares', -100, -2050, 280, 230, 26],   // Bois des Égarés: a foggy bowl in the forest
];

// ------------------------------------------------------------------ water
// Lakes: water level (m) + ellipse.  Bed = level - depth at the centre.
export const LAKES = [
  { id: 'songes', name: 'Lac des Songes', x: -650, z: 650, rx: 235, rz: 165, level: 18, depth: 9 },
  { id: 'glace', name: 'Lac Glacé', x: -1450, z: -2150, rx: 120, rz: 90, level: 254.5, depth: 8, dam: 10 },  // moraine
  { id: 'oasis_ambre', name: "Oasis d'Ambresable", x: -1300, z: 360, rx: 75, rz: 55, level: 37.5, depth: 4 },
  { id: 'oasis_mirages', name: 'Oasis des Mirages', x: -1760, z: 760, rx: 45, rz: 38, level: 0, depth: 3, dam: 12 },  // level 0 = auto (terrain - 2)
  { id: 'oasis_palmes', name: 'Puits des Palmes', x: -1000, z: 980, rx: 38, rz: 30, level: 0, depth: 3 },
  { id: 'vermeil', name: 'Lac Vermeil', x: -1020, z: -260, rx: 110, rz: 80, level: 73.5, depth: 6, dam: 16 },  // Digue du Lac Vermeil (levée naturelle)
  { id: 'miroir_aldmar', name: "Bassin des Rois", x: 120, z: -1080, rx: 50, rz: 35, level: 0, depth: 3 },
  { id: 'lave', name: 'Lac de lave du Brasier', x: 1450, z: -2050, rx: 30, rz: 30, level: 0, depth: 4, lava: true },   // lead pass : anneau de 30 m autour du lac pour l'arène
];
export const WETLAND = { id: 'brumenoire', level: 4.0, poly: [[650, -1150], [1000, -1330], [1320, -1330], [1620, -1280], [1720, -620], [1800, -420], [1500, -200], [1000, -260], [700, -600]] };

// Rivers: authored bed elevations (m) at vertices, enforced monotonic downstream and below the terrain.
// type: canyon (steep walls) | valley (gentle) ; depth = water depth at the centre (> 0.8 m = not wadeable)
export const RIVERS = [
  { id: 'ambre', name: "Rivière d'Ambre", type: 'canyon', width: 26, depth: 1.4, pts: [
    [-1450, -2060, 252], [-1480, -1900, 222], [-1510, -1760, 200], [-1545, -1520, 178], [-1520, -1300, 158], [-1470, -1050, 146],
    [-1440, -800, 136], [-1410, -560, 127], [-1385, -300, 118], [-1370, -40, 110], [-1360, 70, 105], [-1352, 86, 52],
    [-1330, 200, 44], [-1310, 330, 36.5]] },
  { id: 'oued_ambre', name: "Oued d'Ambre", type: 'valley', width: 18, depth: 0.6, pts: [
    [-1320, 400, 36], [-1440, 620, 26], [-1620, 930, 14], [-1760, 1180, 4], [-1830, 1420, -3]] },
  { id: 'argentine', name: "L'Argentine", type: 'valley', width: 20, depth: 1.3, pts: [
    [-880, -1980, 205], [-860, -1780, 168], [-850, -1580, 138], [-820, -1350, 112], [-830, -1100, 90], [-870, -850, 74],
    [-820, -560, 60], [-720, -250, 46], [-660, 100, 32], [-640, 380, 22], [-650, 520, 17], [-600, 820, 15], [-540, 980, 11],
    [-470, 1130, 4], [-450, 1300, -3]] },
  { id: 'ru_brumes', name: 'Ru des Brumes', type: 'valley', width: 10, depth: 0.5, pts: [
    [-420, -1880, 150], [-560, -1600, 128], [-700, -1420, 118], [-820, -1350, 112]] },
  { id: 'brumeuse', name: 'La Brumeuse', type: 'valley', width: 24, depth: 1.5, pts: [
    [-60, -1930, 92], [130, -1760, 86], [380, -1520, 72], [560, -1330, 56], [720, -1100, 34], [880, -900, 14], [1080, -730, 3.4],
    [1350, -560, 2.8], [1560, -430, 2], [1700, -400, 0.5], [1860, -390, -3]] },
  { id: 'salinelle', name: 'La Salinelle', type: 'valley', width: 16, depth: 1.2, pts: [
    [360, -780, 74], [420, -500, 54], [440, -220, 42], [420, 120, 32], [460, 420, 22], [560, 700, 12], [660, 880, 4], [720, 980, -2]] },
  { id: 'cendreux', name: 'Le Cendreux', type: 'canyon', width: 12, depth: 0.6, pts: [
    [1700, -1830, 150], [1870, -1780, 60], [1990, -1790, 10], [2100, -1800, -3]] },
  { id: 'torrent_givre', name: 'Torrent du Givre', type: 'canyon', width: 10, depth: 0.5, pts: [
    [-1900, -1640, 232], [-1720, -1560, 196], [-1545, -1520, 178]] },
];
// Dry ravines / side canyons (carved like canyons, no water): bed heights at vertices, walls = wall slope
export const RAVINES = [
  { id: 'rav_rouge_1', name: 'Ravin des Échos', width: 18, wall: 1.8, pts: [[-1180, -900, 96], [-1300, -950, 122], [-1420, -960, 146], [-1560, -1020, 175], [-1680, -1060, 196]] },
  { id: 'rav_rouge_2', name: 'Gorge Sèche', width: 20, wall: 1.9, pts: [[-1180, -545, 92], [-1300, -590, 120], [-1420, -625, 150], [-1520, -660, 172], [-1620, -700, 192]] },
  { id: 'rav_rouge_3', name: 'Ravin des Vents', width: 22, wall: 1.6, pts: [[-1600, 150, 48], [-1640, 0, 120], [-1700, -200, 162], [-1760, -420, 178]] },
  { id: 'rav_rouge_4', name: 'Couloir du Sud', width: 14, wall: 2.0, pts: [[-2000, 230, 60], [-2030, 60, 150], [-2080, -120, 190]] },
  { id: 'rav_sylve_1', name: 'Combe aux Racines', width: 20, wall: 0.7, pts: [[700, -2350, 160], [600, -2150, 120], [470, -1950, 100]] },
  { id: 'rav_sylve_2', name: 'Val des Mousses', width: 24, wall: 0.6, pts: [[-600, -2420, 190], [-450, -2250, 150], [-330, -2080, 108]] },
  { id: 'rav_givre_1', name: 'Val du Glacier', width: 40, wall: 0.8, pts: [[-1700, -2080, 300], [-1760, -1920, 250], [-1720, -1760, 222], [-1700, -1600, 205]] },
  { id: 'rav_embruns', name: 'Gorge des Embruns', width: 16, wall: 1.6, pts: [[1640, -720, 50], [1700, -780, 72], [1780, -860, 104], [1880, -960, 140], [1960, -1000, 152]] },
];
// Waterfalls (documentation + VFX anchors): [id, name, x, z, top, bottom]
export const WATERFALLS = [
  ['chute_ambre', "Chutes d'Ambresable", -1356, 78, 105, 52],
];

// ------------------------------------------------------------------ settlements, waypoints, dungeons, landmarks
// Towns: flattened to their centre height (after shaping). safe = green zone radius.
export const TOWNS = [
  { id: 'brumeval', name: 'Brumeval', kind: 'village (départ)', x: 0, z: 0, r: 32, legacy: true },
  { id: 'port_salin', name: 'Port-Salin', kind: 'ville portuaire', x: 690, z: 870, r: 90, flat: 60 },
  { id: 'ambresable', name: 'Ambresable', kind: 'ville du désert (oasis)', x: -1240, z: 400, r: 85, flat: 70 },
  { id: 'rochegivre', name: 'Rochegivre', kind: 'village de montagne', x: -1360, z: -1640, r: 60, flat: 55 },
  { id: 'clairsaule', name: 'Clairsaule', kind: 'hameau forestier', x: 450, z: -1860, r: 50, flat: 45 },
];
export const OUTPOSTS = [
  { id: 'relais_mordore', name: 'Relais de Mordoré', x: -760, z: -560, r: 25, flat: 30 },
  { id: 'poste_cendres', name: 'Poste des Cendres', x: 975, z: -1535, r: 22, flat: 26 },
  { id: 'phare', name: 'Phare des Embruns', x: 1985, z: -1010, r: 18, flat: 20 },
];
export const LANDMARKS = [
  { id: 'arbre_brume', name: "L'Arbre-Brume", x: -120, z: -1200, r: 70, knoll: 178, note: 'CX-10 landmark_brume_tree (~120 m) : cime à ~300 m d’altitude' },
];
export const WAYPOINTS = [
  ['wp_brumeval', 'Place de Brumeval', 0, 8],
  ['wp_mordore', 'Carrefour de Mordoré', -740, -520],
  ['wp_gue_argentine', "Gué de l'Argentine", -850, -1000],
  ['wp_porte_aldmar', "Porte Sud d'Aldmar", -30, -790],
  ['wp_arbre', "Sanctuaire de l'Arbre-Brume", -60, -1120],
  ['wp_lisiere', 'Lisière des Égarés', -90, -1770],
  ['wp_clairsaule', 'Clairsaule', 450, -1840],
  ['wp_col_loup', 'Col du Loup Blanc', -1080, -1500],
  ['wp_rochegivre', 'Rochegivre', -1330, -1620],
  ['wp_lac_glace', 'Lac Glacé', -1505, -2072],
  ['wp_blanchecorne', 'Belvédère de Blanchecorne', -1760, -1960],
  ['wp_table', 'Table du Géant', -1860, -800],
  ['wp_entaille', "Pont de l'Entaille", -1420, -760],
  ['wp_ambresable', 'Ambresable', -1240, 420],
  ['wp_mirages', 'Oasis des Mirages', -1680, 715],
  ['wp_songes', 'Rives des Songes', -470, 470],
  ['wp_anse', 'Anse des Songes', -600, 1090],
  ['wp_port_salin', 'Port-Salin', 690, 850],
  ['wp_palmes', 'Plage des Palmes', 1240, 720],
  ['wp_azurine', "Île d'Azurine", 1600, 1110],
  ['wp_ventfauve', 'Landes de Ventfauve', 640, -700],
  ['wp_brumenoire', 'Pontons de Brumenoire', 1150, -820],
  ['wp_delta', 'Delta de la Brumeuse', 1627, -293],
  ['wp_phare', 'Phare des Embruns', 1960, -1000],
  ['wp_cendres', 'Poste des Cendres', 995, -1515],
  // lead pass : couverture (aucun point jouable à plus de ≈ 700 m d'une pierre)
  ['wp_aiguille', "Pied de l'Aiguille Grise", -700, -2300],
  ['wp_clairiere_nord', 'Clairière du Nord', 150, -2380],
  ['wp_plage_noire', 'Plage noire du Cendreux', 1900, -1830],
  ['wp_cretes', 'Crêtes Calcinées', 1750, -2380],
  ['wp_palais', 'Palais-Mirage', -1300, 1250],
  ['wp_mines', 'Mines de Rougecrête', -1680, -420],
  ['wp_ajoncs', 'Lande des Ajoncs', 850, 80],
  ['wp_brasier', 'Flanc du Brasier', 1200, -1780],
];
export const DUNGEONS = [
  ['crypte_aldmar', "Crypte d'Aldmar", 110, -1260, 'v0.4 (CX-4) — sous les ruines, zone rouge'],
  ['grotte_gelee', 'Grotte gelée', -1560, -2040, 'v0.4 (CX-11) — au bord du Lac Glacé'],
  ['forge_brasier', 'Forge engloutie du Brasier', 1560, -1950, 'dans la brèche du cratère (lave)'],
  ['tombeau_sables', 'Tombeau des Sables', -1693, 1067, 'arène du Ver des sables au-dessus'],
  ['antre_sorciere', 'Antre de la Sorcière des marais', 1330, -760, 'hutte sur pilotis, boss swamp_hag'],
  ['grotte_marees', 'Grotte des Marées', 1850, 1292, "Île de l'Épave, par la Passe des Naufrageurs (banc de sable)"],
  ['mines_rougecrete', 'Mines de Rougecrête', -1740, -380, 'filons de fer et de mithril'],
  ['antre_golem', 'Antre du Golem', 118, -132, 'existant (v0.1), région de départ'],
];

// ------------------------------------------------------------------ roads (polylines through towns/waypoints). grade = max slope
export const ROADS = [
  { id: 'voie_royale', name: 'Voie Royale', cls: 'main', grade: 0.10, maxCut: 30, maxFill: 26, pts: [[-4, -30], [-40, -175], [-40, -450], [-30, -790], [-50, -900], [-80, -1010], [-60, -1120]] },
  { id: 'route_mordore', name: 'Route de Mordoré', cls: 'main', grade: 0.10, pts: [[-92, -8], [-180, -20], [-450, -160], [-740, -520], [-850, -1000]] },
  { id: 'route_col', name: 'Route du Col du Loup', cls: 'trail', grade: 0.2, pts: [[-850, -1000], [-940, -1220], [-1010, -1400], [-1070, -1510], [-1180, -1580], [-1330, -1620]] },
  { id: 'sentier_glace', name: 'Sentier du Lac Glacé', cls: 'trail', grade: 0.22, pts: [[-1330, -1620], [-1370, -1760], [-1410, -1900], [-1470, -1950], [-1490, -2010], [-1505, -2072]] },  // lead pass: suit le vallon de l'Ambre au lieu de trancher la moraine
  { id: 'sentier_blanchecorne', name: 'Sentier de Blanchecorne', cls: 'trail', grade: 0.25, pts: [[-1410, -1900], [-1560, -1880], [-1660, -1900], [-1760, -1960]] },
  { id: 'route_sud_ouest', name: 'Route des Sables', cls: 'main', grade: 0.10, pts: [[-30, 50], [-200, 260], [-470, 440], [-880, 390], [-1100, 420], [-1240, 420]] },
  { id: 'piste_mirages', name: 'Piste des Mirages', cls: 'trail', grade: 0.15, pts: [[-1240, 420], [-1480, 600], [-1700, 760]] },
  { id: 'escalier_entaille', name: "Escalier de l'Entaille", cls: 'trail', grade: 0.25, maxCut: 40, maxFill: 25, pts: [[-1240, 420], [-1300, 250], [-1330, 150], [-1380, 60], [-1380, -300], [-1440, -760], [-1500, -1200], [-1545, -1500], [-1330, -1620]] },
  { id: 'sentier_table', name: 'Sentier de la Table', cls: 'trail', grade: 0.25, pts: [[-1440, -760], [-1650, -820], [-1860, -800]] },
  { id: 'porte_rougecrete', name: 'Chemin de la Gorge Sèche', cls: 'trail', grade: 0.22, pts: [[-740, -520], [-900, -440], [-1080, -430], [-1200, -560], [-1350, -600], [-1500, -650], [-1440, -760]] },
  { id: 'route_port', name: 'Route de Port-Salin', cls: 'main', grade: 0.10, pts: [[70, 28], [250, 160], [440, 300], [600, 620], [690, 850]] },
  { id: 'route_cote', name: 'Chemin des Falaises', cls: 'trail', grade: 0.15, pts: [[690, 850], [400, 1080], [0, 1150], [-350, 1170], [-600, 1090], [-560, 950], [-470, 470]] },
  { id: 'route_palmes', name: 'Route des Palmes', cls: 'main', grade: 0.10, pts: [[690, 850], [980, 800], [1240, 720], [1330, 800]] },
  { id: 'route_est', name: 'Route de l\'Est', cls: 'main', grade: 0.10, pts: [[70, 28], [300, -80], [440, -120], [640, -700], [900, -900], [1150, -820], [1400, -560], [1620, -300]] },
  { id: 'route_phare', name: 'Route du Phare', cls: 'trail', grade: 0.3, pts: [[1400, -560], [1620, -690], [1700, -780], [1780, -860], [1880, -960], [1960, -1000]] },
  { id: 'route_cendres', name: 'Route des Cendres', cls: 'main', grade: 0.12, pts: [[640, -700], [800, -1150], [900, -1400], [975, -1535]] },
  { id: 'sentier_brasier', name: 'Sentier du Brasier', cls: 'trail', grade: 0.3, pts: [[975, -1535], [1150, -1560], [1260, -1650], [1200, -1780]] },
  { id: 'coulee', name: 'Sentier de la Coulée', cls: 'trail', grade: 0.35, pts: [[1200, -1780], [1330, -1700], [1520, -1700], [1700, -1760], [1640, -1860], [1560, -1940]] },
  { id: 'route_foret', name: 'Route de la Sylve', cls: 'main', grade: 0.12, maxCut: 30, maxFill: 26, pts: [[-60, -1120], [-20, -1300], [0, -1470], [-40, -1620], [-90, -1770], [150, -1760], [450, -1840], [800, -1900], [960, -1900], [975, -1535]] },
  { id: 'rampe_est_aldmar', name: "Rampe de l'Est", cls: 'trail', grade: 0.14, maxCut: 30, maxFill: 20, pts: [[440, -120], [420, -600], [330, -780], [220, -950], [110, -1080]] },
  { id: 'lac_gue', name: 'Chemin du Gué', cls: 'trail', grade: 0.15, pts: [[-740, -520], [-470, 470]] },
];
export const ROAD_HALF = { main: 4, trail: 2.5 };

// ------------------------------------------------------------------ regions (first polygon match wins; order = priority)
// danger: vert (safe) | jaune (PvE) | rouge (free PvP, loot bag). tier = loot tier (ROADMAP §2 bis)
export const BIOMES = {
  G: 'Prés verts de Brumeval', O: 'Prairie dorée', A: 'Champ de ruines doré', F: 'Forêt ancienne', L: 'Bois perdus (brume)',
  S: 'Neige et glace', R: 'Rocaille alpine', V: 'Cendres volcaniques', W: 'Marais', H: 'Roche rouge / mesas', C: 'Canyon',
  D: 'Dunes', T: 'Côte tropicale', K: 'Lande côtière / falaises', B: 'Plage', M: 'Lande dorée', Q: 'Mer', U: 'Lagon', Z: 'Lac', Y: 'Lave',
};
export const REGIONS = [
  // Lead-designer pass: the south-west half of the plateau (Voie Royale + Arbre-Brume) is a yellow pilgrim zone for the
  // story (chap. II, niv. 12-18); only the north-east "Cœur d'Aldmar" is red.  The sanctuary itself is green (layout).
  { id: 'arbre', label: [-250, -1290], name: "Parvis de l'Arbre-Brume", biome: 'A', lv: [12, 18], danger: 'jaune', tier: 'T3',
    poly: [[-160, -790], [45, -790], [40, -1000], [10, -1150], [20, -1300], [45, -1500], [-80, -1510], [-120, -1340], [-270, -1330], [-280, -1090], [-160, -1050]],
    landmarks: ["L'Arbre-Brume", 'Sanctuaire de la Veilleuse', 'Grand Escalier de la Voie Royale'] },
  { id: 'coeur_aldmar', label: [200, -1330], name: "Cœur d'Aldmar", biome: 'A', lv: [27, 30], danger: 'rouge', tier: 'T6',
    poly: [[60, -1510], [250, -1440], [380, -1240], [370, -1020], [150, -1010], [60, -1150]],
    landmarks: ["Crypte d'Aldmar", 'Bassin des Rois', 'Grandes Portes'] },
  { id: 'aldmar', label: [-330, -1080], name: "Ruines d'Aldmar", biome: 'A', lv: [24, 28], danger: 'jaune', tier: 'T6', plateau: 'aldmar',
    landmarks: ['Plateau à falaises de 50 m', 'Pierres-runes luisantes', "Rampe de l'Est"] },
  { id: 'couronne', label: [-1650, -2440], name: 'Couronne de Givre', biome: 'S', lv: [25, 30], danger: 'rouge', tier: 'T6', circle: [-1720, -2320, 220],
    landmarks: ['Pic de Givrecime (≈ 395 m)', 'Glacier suspendu', 'Élites de givre'] },
  { id: 'coeur_brasier', label: [1450, -2330], name: 'Cœur du Brasier', biome: 'V', lv: [26, 30], danger: 'rouge', tier: 'T6', circle: [1450, -2050, 320],
    landmarks: ['Cratère et lac de lave', 'Forge engloutie'] },
  { id: 'mer_dunes', name: 'Mer de Dunes', biome: 'D', lv: [22, 28], danger: 'rouge', tier: 'T6', circle: [-1830, 1080, 280],
    landmarks: ['Grandes dunes de 25 m', 'Ver des sables (boss)', 'Tombeau des Sables'] },
  { id: 'epave', label: [1780, 1560], name: "Île de l'Épave", biome: 'T', lv: [19, 24], danger: 'rouge', tier: 'T5', circle: [1930, 1400, 190],
    landmarks: ['Épave géante', 'Grotte des Marées', 'Passe des Naufrageurs'] },
  { id: 'egares', name: 'Bois des Égarés', biome: 'L', lv: [14, 18], danger: 'jaune', tier: 'T3',
    poly: [[-360, -2250], [100, -2300], [190, -2050], [60, -1850], [-250, -1840], [-390, -2000]], landmarks: ['Labyrinthe de brume', 'Cuvette de 25 m'] },
  { id: 'entaille', label: [-1420, -1150], name: "Canyon de l'Entaille", biome: 'C', lv: [18, 22], danger: 'jaune', tier: 'T4',
    poly: [[-1620, -1330], [-1430, -1330], [-1330, -620], [-1290, 90], [-1430, 90], [-1500, -620]], landmarks: ["Rivière d'Ambre", "Pont de l'Entaille", "Chutes d'Ambresable"] },
  { id: 'brumeval', label: [60, -420], name: 'Val de Brumeval', biome: 'G', lv: [1, 10], danger: 'jaune', tier: 'T1-T3',
    poly: [[-430, -720], [260, -760], [390, -460], [420, -100], [300, 400], [-150, 450], [-450, 250]],
    landmarks: ['Village de Brumeval', 'Forêt des Murmures', 'Camp gobelin', 'Cimetière oublié', 'Antre du Golem'] },
  { id: 'mordore', name: 'Prairies de Mordoré', biome: 'O', lv: [5, 12], danger: 'jaune', tier: 'T1-T2',
    poly: [[-1180, -1330], [-430, -1300], [-430, -720], [-450, 250], [-650, 360], [-1150, 330], [-1200, -300]],
    landmarks: ['Relais de Mordoré', 'Lac Vermeil', "Gué de l'Argentine"] },
  { id: 'ventfauve', name: 'Landes de Ventfauve', biome: 'M', lv: [8, 14], danger: 'jaune', tier: 'T2',
    poly: [[260, -760], [340, -1240], [620, -1200], [760, -600], [1000, -260], [880, -80], [420, -100], [390, -460]],
    landmarks: ['Vallée de la Salinelle', "Rampe de l'Est"] },
  { id: 'sylve', name: 'Sylve Ancienne', biome: 'F', lv: [10, 16], danger: 'jaune', tier: 'T2-T3',
    poly: [[-720, -2560], [830, -2560], [900, -2100], [1000, -1700], [700, -1300], [340, -1240], [-370, -1330], [-430, -1300], [-760, -1650]],
    landmarks: ['Clairsaule', 'Arbres géants', 'Source de la Brumeuse'] },
  { id: 'givreval', label: [-1150, -2420], name: 'Pics de Givreval', biome: 'S', lv: [20, 25], danger: 'jaune', tier: 'T5',
    poly: [[-2048, -2560], [-720, -2560], [-760, -1650], [-1000, -1430], [-1260, -1390], [-2048, -1470]],
    landmarks: ['Rochegivre', 'Lac Glacé', 'Grotte gelée', "Dent de l'Hiver", 'Col du Loup Blanc'] },
  { id: 'cendres', label: [1250, -1450], name: 'Terres de Cendre', biome: 'V', lv: [22, 26], danger: 'jaune', tier: 'T5-T6',
    poly: [[830, -2560], [2048, -2560], [2048, -1520], [1620, -1460], [1300, -1360], [1000, -1360], [1000, -1700], [900, -2100]],
    landmarks: ['Mont Brasier (≈ 430 m)', 'Poste des Cendres', 'Échine de Suie', 'Plage noire du Cendreux'] },
  { id: 'brumenoire', name: 'Marais de Brumenoire', biome: 'W', lv: [15, 20], danger: 'jaune', tier: 'T4',
    poly: WETLAND_POLY(), landmarks: ['Pontons', 'Antre de la Sorcière', 'Delta de la Brumeuse'] },
  { id: 'embruns', name: 'Falaises des Embruns', biome: 'K', lv: [18, 24], danger: 'jaune', tier: 'T4-T5',
    poly: [[1620, -1460], [2048, -1520], [2048, -440], [1800, -420], [1720, -620]], landmarks: ['Mont Écumeur', 'Phare des Embruns', 'Falaises de 60 m'] },
  { id: 'rougecrete', label: [-1700, -300], name: 'Hauts-Plateaux de Rougecrête', biome: 'H', lv: [16, 22], danger: 'jaune', tier: 'T4',
    poly: [[-2048, -1470], [-1260, -1390], [-1180, -1330], [-1200, -300], [-1150, 110], [-1460, 175], [-1760, 120], [-2048, 210]],
    landmarks: ['Table du Géant', 'Mines de Rougecrête', 'Rampe de Rougecrête'] },
  { id: 'sable_rouge', label: [-1450, 800], name: 'Désert de Sable-Rouge', biome: 'D', lv: [15, 22], danger: 'jaune', tier: 'T4',
    poly: [[-2048, 210], [-1760, 120], [-1460, 175], [-1150, 110], [-900, 360], [-860, 820], [-820, 1360], [-2048, 1400]],
    landmarks: ['Ambresable', 'Oasis des Mirages', 'Les Trois Enclumes', 'Dunes pour le char à sable'] },
  { id: 'songes', label: [-560, 900], name: 'Rives du Lac des Songes', biome: 'O', lv: [6, 12], danger: 'jaune', tier: 'T2',
    poly: [[-900, 360], [-450, 250], [-150, 450], [-250, 900], [-330, 1300], [-820, 1360], [-860, 820]], landmarks: ['Lac des Songes', 'Anse des Songes', 'Île aux Mouettes'] },
  { id: 'port_salin', name: 'Côte de Port-Salin', biome: 'T', lv: [8, 14], danger: 'jaune', tier: 'T2',
    poly: [[-150, 450], [300, 400], [420, -100], [880, -80], [1100, 300], [1300, 760], [900, 1100], [900, 1536], [-330, 1536], [-250, 900]],
    landmarks: ['Port-Salin', 'Embouchure de la Salinelle', 'Falaises blanches'] },
  { id: 'azurine', name: "Archipel d'Azurine", biome: 'T', lv: [12, 18], danger: 'jaune', tier: 'T3',
    poly: [[1000, -260], [1500, -200], [1800, -420], [2048, -440], [2048, 1536], [900, 1536], [900, 1100], [1300, 760], [1100, 300]],
    landmarks: ["Île d'Azurine", 'Lagons turquoise', 'Chaussée des Sables', 'Plage des Palmes'] },
];
function WETLAND_POLY() { return [[650, -1150], [1000, -1330], [1320, -1330], [1620, -1280], [1720, -620], [1800, -420], [1500, -200], [1000, -260], [700, -600]]; }

export const PASSES = [
  ['col_loup', 'Col du Loup Blanc', -1070, -1510],
  ['col_cendres', 'Col des Cendres', 960, -1900],
  ['breche_embruns', 'Brèche des Embruns', 1760, -760],
  ['gorge_seche', 'Gorge Sèche', -1420, -625],
  ['escalier_ambre', "Escalier d'Ambresable", -1330, 150],
];
