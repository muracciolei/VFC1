/**
 * VFC 1 — MINI ITALIA world definition.
 * A compressed, stylised Italy: ten cities, Alps, Apennines, lakes,
 * coastline, islands and a coherent road network.
 */

import { Vec2, RNG, dist2D, wrapAngle } from '../core/math';

export const WORLD = {
  minX: -2700,
  maxX: 2700,
  minZ: -3400,
  maxZ: 3400,
  seaLevel: 0,
  seed: 1969,
  chunkSize: 220,
  name: 'MINI ITALIA',
} as const;

export type CityStyle =
  | 'milano'
  | 'roma'
  | 'napoli'
  | 'torino'
  | 'firenze'
  | 'venezia'
  | 'bologna'
  | 'genova'
  | 'palermo'
  | 'bari';

export interface CityPalette {
  wall: string[];
  roof: string[];
  accent: string;
  glass: string;
  road: string;
}

export interface CityDef {
  id: CityStyle;
  name: string;
  region: string;
  x: number;
  z: number;
  radius: number;
  /** Grid rotation in radians. */
  angle: number;
  /** Base elevation, resolved from terrain at build time. */
  baseHeight: number;
  /** Approximate population label for the map. */
  population: string;
  style: CityStyle;
  palette: CityPalette;
  /** Building density 0..1 */
  density: number;
  /** Average building height multiplier. */
  heightScale: number;
  /** City is coastal (adds docks / sea walls). */
  coastal: boolean;
  landmark: string;
  description: string;
}

const PALETTES: Record<CityStyle, CityPalette> = {
  milano: {
    wall: ['#d8cbb4', '#c9bda9', '#b9ad99', '#e0d4bf', '#a99d8c', '#cfc3ae'],
    roof: ['#8a4b34', '#9a5a3e', '#7d4230', '#a8684a'],
    accent: '#b04a35',
    glass: '#26343d',
    road: '#3a3c3e',
  },
  roma: {
    wall: ['#c98f5a', '#d9a36d', '#b77c4c', '#e0b584', '#a96d42', '#d19a66'],
    roof: ['#9b4f33', '#a95c3a', '#8a442d', '#b46a45'],
    accent: '#8c3a24',
    glass: '#2d3233',
    road: '#42413d',
  },
  napoli: {
    wall: ['#d6c39b', '#c4ae83', '#b99f74', '#e0cfa8', '#9f8a63', '#cbb68d'],
    roof: ['#a05a3e', '#8d4b33', '#b06b4a'],
    accent: '#b3472f',
    glass: '#2f3538',
    road: '#3f4042',
  },
  torino: {
    wall: ['#d9d2c3', '#c6bfb0', '#b5ae9f', '#e4ddce', '#a39c8e'],
    roof: ['#7c4a38', '#8d5844', '#6d4030'],
    accent: '#7a6a4f',
    glass: '#2a3138',
    road: '#3d3f42',
  },
  firenze: {
    wall: ['#d8b98a', '#c9a774', '#e3c79b', '#b99667', '#d1b183'],
    roof: ['#a05a3a', '#8f4d31', '#b26945'],
    accent: '#7c4a2f',
    glass: '#33352f',
    road: '#46443f',
  },
  venezia: {
    wall: ['#d9b8a0', '#c9a184', '#e2c6ae', '#b98c6d', '#d4a98c'],
    roof: ['#94553c', '#a56246', '#834932'],
    accent: '#2f6d6a',
    glass: '#2c3a3d',
    road: '#4a4844',
  },
  bologna: {
    wall: ['#c8845c', '#b9714b', '#d3966c', '#a9603f', '#ca8a62'],
    roof: ['#9c4f34', '#ab5a3c', '#8a442c'],
    accent: '#8e3f28',
    glass: '#30302e',
    road: '#41403c',
  },
  genova: {
    wall: ['#cbb08a', '#b99a72', '#ddc39d', '#a78965', '#c3a67e'],
    roof: ['#7e4a36', '#8f5540', '#6c3d2c'],
    accent: '#3f5b52',
    glass: '#29343a',
    road: '#3b3d3f',
  },
  palermo: {
    wall: ['#dcc29a', '#c9ac81', '#e7d0a9', '#b6986f', '#d2b58a'],
    roof: ['#b06644', '#9c5739', '#c17651'],
    accent: '#a1452c',
    glass: '#30363a',
    road: '#43423e',
  },
  bari: {
    wall: ['#ddd0b8', '#cbbca2', '#e6dbc4', '#b8a88e', '#d3c4aa'],
    roof: ['#a55f42', '#925237', '#b66d4c'],
    accent: '#8a4a35',
    glass: '#2d363b',
    road: '#404142',
  },
};

export const CITIES: CityDef[] = [
  {
    id: 'torino',
    name: 'TORINO',
    region: 'PIEMONTE',
    x: -1080,
    z: -2480,
    radius: 300,
    angle: 0.08,
    baseHeight: 0,
    population: '870K',
    style: 'torino',
    palette: PALETTES.torino,
    density: 0.85,
    heightScale: 1.05,
    coastal: false,
    landmark: 'mole',
    description: 'Viali eleganti, portici e la Mole sullo sfondo delle Alpi.',
  },
  {
    id: 'milano',
    name: 'MILANO',
    region: 'LOMBARDIA',
    x: -430,
    z: -2380,
    radius: 330,
    angle: -0.12,
    baseHeight: 0,
    population: '1.4M',
    style: 'milano',
    palette: PALETTES.milano,
    density: 0.95,
    heightScale: 1.25,
    coastal: false,
    landmark: 'duomo',
    description: 'Il cuore economico: grattacieli, moda, traffico e soldi.',
  },
  {
    id: 'venezia',
    name: 'VENEZIA',
    region: 'VENETO',
    x: 1010,
    z: -2130,
    radius: 250,
    angle: 0.35,
    baseHeight: 0,
    population: '260K',
    style: 'venezia',
    palette: PALETTES.venezia,
    density: 0.8,
    heightScale: 0.8,
    coastal: true,
    landmark: 'campanile',
    description: 'Canali, ponti e calli. L’acqua entra nella città.',
  },
  {
    id: 'bologna',
    name: 'BOLOGNA',
    region: 'EMILIA-ROMAGNA',
    x: 140,
    z: -1690,
    radius: 270,
    angle: 0.02,
    baseHeight: 0,
    population: '390K',
    style: 'bologna',
    palette: PALETTES.bologna,
    density: 0.9,
    heightScale: 1.1,
    coastal: false,
    landmark: 'towers',
    description: 'Portici rossi, torri medievali e studenti per strada.',
  },
  {
    id: 'genova',
    name: 'GENOVA',
    region: 'LIGURIA',
    x: -1190,
    z: -930,
    radius: 240,
    angle: 0.55,
    baseHeight: 0,
    population: '580K',
    style: 'genova',
    palette: PALETTES.genova,
    density: 0.88,
    heightScale: 1.15,
    coastal: true,
    landmark: 'port',
    description: 'Il porto, i caruggi e le strade che scendono al mare.',
  },
  {
    id: 'firenze',
    name: 'FIRENZE',
    region: 'TOSCANA',
    x: 260,
    z: -1120,
    radius: 250,
    angle: -0.18,
    baseHeight: 0,
    population: '380K',
    style: 'firenze',
    palette: PALETTES.firenze,
    density: 0.82,
    heightScale: 0.95,
    coastal: false,
    landmark: 'duomo',
    description: 'Pietra, arte e tetti di terracotta sotto il sole toscano.',
  },
  {
    id: 'roma',
    name: 'ROMA',
    region: 'LAZIO',
    x: 120,
    z: -240,
    radius: 350,
    angle: 0.12,
    baseHeight: 0,
    population: '2.8M',
    style: 'roma',
    palette: PALETTES.roma,
    density: 0.92,
    heightScale: 1.05,
    coastal: false,
    landmark: 'colosseo',
    description: 'Monumenti, viali larghi e il caos eterno della capitale.',
  },
  {
    id: 'napoli',
    name: 'NAPOLI',
    region: 'CAMPANIA',
    x: -500,
    z: 980,
    radius: 300,
    angle: 0.28,
    baseHeight: 0,
    population: '950K',
    style: 'napoli',
    palette: PALETTES.napoli,
    density: 1,
    heightScale: 1.2,
    coastal: true,
    landmark: 'vesuvio',
    description: 'Vicoli densi, panni stesi e il Vesuvio che guarda il golfo.',
  },
  {
    id: 'bari',
    name: 'BARI',
    region: 'PUGLIA',
    x: 1250,
    z: 680,
    radius: 260,
    angle: -0.3,
    baseHeight: 0,
    population: '320K',
    style: 'bari',
    palette: PALETTES.bari,
    density: 0.85,
    heightScale: 0.95,
    coastal: true,
    landmark: 'lungomare',
    description: 'Il lungomare adriatico e il vento del sud.',
  },
  {
    id: 'palermo',
    name: 'PALERMO',
    region: 'SICILIA',
    x: -280,
    z: 2280,
    radius: 280,
    angle: 0.2,
    baseHeight: 0,
    population: '670K',
    style: 'palermo',
    palette: PALETTES.palermo,
    density: 0.9,
    heightScale: 1.05,
    coastal: true,
    landmark: 'cattedrale',
    description: 'Mercati, cupole e il mare africano oltre i tetti.',
  },
];

export const CITY_BY_ID: Record<string, CityDef> = Object.fromEntries(CITIES.map((c) => [c.id, c]));

/* ------------------------------------------------------------------ */
/* Land masses                                                         */
/* ------------------------------------------------------------------ */

export const MAINLAND: Vec2[] = [
  { x: -1560, z: -3080 },
  { x: -980, z: -3160 },
  { x: -380, z: -3190 },
  { x: 180, z: -3140 },
  { x: 700, z: -3000 },
  { x: 1100, z: -2750 },
  { x: 1290, z: -2480 },
  { x: 1180, z: -2300 },
  { x: 1240, z: -2020 },
  { x: 1360, z: -1700 },
  { x: 1470, z: -1320 },
  { x: 1550, z: -940 },
  { x: 1610, z: -540 },
  { x: 1660, z: -120 },
  { x: 1710, z: 300 },
  { x: 1780, z: 560 },
  { x: 1690, z: 830 },
  { x: 1520, z: 940 },
  { x: 1380, z: 900 },
  { x: 1310, z: 740 },
  { x: 1230, z: 900 },
  { x: 1120, z: 1080 },
  { x: 960, z: 1240 },
  { x: 760, z: 1390 },
  { x: 520, z: 1520 },
  { x: 250, z: 1590 },
  { x: -20, z: 1550 },
  { x: -230, z: 1430 },
  { x: -380, z: 1270 },
  { x: -500, z: 1120 },
  { x: -620, z: 1010 },
  { x: -760, z: 930 },
  { x: -840, z: 760 },
  { x: -900, z: 520 },
  { x: -980, z: 250 },
  { x: -1070, z: -80 },
  { x: -1160, z: -430 },
  { x: -1250, z: -780 },
  { x: -1340, z: -1080 },
  { x: -1440, z: -1400 },
  { x: -1540, z: -1760 },
  { x: -1660, z: -2150 },
  { x: -1740, z: -2520 },
  { x: -1700, z: -2840 },
];

export const SICILY: Vec2[] = [
  { x: -610, z: 2180 },
  { x: -420, z: 2070 },
  { x: -120, z: 2030 },
  { x: 200, z: 2080 },
  { x: 440, z: 2200 },
  { x: 570, z: 2400 },
  { x: 560, z: 2600 },
  { x: 420, z: 2800 },
  { x: 200, z: 2930 },
  { x: -80, z: 2960 },
  { x: -340, z: 2880 },
  { x: -540, z: 2720 },
  { x: -650, z: 2500 },
  { x: -670, z: 2320 },
];

export const LAND_MASSES: Vec2[][] = [MAINLAND, SICILY];

/** Alpine and Apennine ridge control points. */
export const MOUNTAIN_RIDGES: Array<{ points: Vec2[]; height: number; width: number }> = [
  {
    // Alps
    points: [
      { x: -1900, z: -3000 },
      { x: -1200, z: -3250 },
      { x: -500, z: -3150 },
      { x: 200, z: -3180 },
      { x: 800, z: -3020 },
      { x: 1350, z: -2750 },
    ],
    height: 300,
    width: 520,
  },
  {
    // Western Alps spur
    points: [
      { x: -1750, z: -2550 },
      { x: -1550, z: -2850 },
      { x: -1250, z: -3050 },
    ],
    height: 240,
    width: 380,
  },
  {
    // Apennines spine
    points: [
      { x: -1050, z: -1450 },
      { x: -720, z: -1150 },
      { x: -320, z: -720 },
      { x: 60, z: -300 },
      { x: 280, z: 180 },
      { x: 250, z: 650 },
      { x: 60, z: 1120 },
    ],
    height: 175,
    width: 300,
  },
  {
    // Calabrian ridge
    points: [
      { x: -250, z: 1250 },
      { x: 0, z: 1400 },
      { x: 180, z: 1500 },
    ],
    height: 120,
    width: 220,
  },
  {
    // Sicilian interior
    points: [
      { x: -300, z: 2350 },
      { x: 50, z: 2550 },
      { x: 260, z: 2700 },
    ],
    height: 140,
    width: 260,
  },
];

export const VOLCANOES = [
  { x: 300, z: 2680, radius: 240, height: 230 }, // Etna-like
  { x: -450, z: 1080, radius: 190, height: 170 }, // Vesuvio-like
];

export const LAKE = { x: -690, z: -2810, radius: 175, waterLevel: 18 };

/* ------------------------------------------------------------------ */
/* Points of interest                                                  */
/* ------------------------------------------------------------------ */

export type POIKind =
  | 'safehouse'
  | 'garage'
  | 'gunshop'
  | 'hospital'
  | 'police'
  | 'shop'
  | 'airport'
  | 'port'
  | 'gas'
  | 'viewpoint'
  | 'collectible'
  | 'mission'
  | 'race'
  | 'taxi'
  | 'landmark';

export interface POI {
  id: string;
  name: string;
  kind: POIKind;
  x: number;
  z: number;
  cityId: string;
  description?: string;
}

function localPoint(city: CityDef, ox: number, oz: number): { x: number; z: number } {
  const c = Math.cos(city.angle);
  const s = Math.sin(city.angle);
  return { x: city.x + ox * c - oz * s, z: city.z + ox * s + oz * c };
}

export const POIS: POI[] = [];

/**
 * Ids of the POIs generated inside a city. These are snapped onto the street
 * grid at build time; hand-placed landmarks (airports, coastlines, …) keep
 * their coordinates.
 */
export const CITY_POI_IDS = new Set<string>();

function addPOI(
  city: CityDef,
  id: string,
  name: string,
  kind: POIKind,
  ox: number,
  oz: number,
  description = '',
): void {
  const p = localPoint(city, ox, oz);
  POIS.push({ id, name, kind, x: p.x, z: p.z, cityId: city.id, description });
  CITY_POI_IDS.add(id);
}

for (const city of CITIES) {
  addPOI(city, `${city.id}_safehouse`, `Casa sicura — ${city.name}`, 'safehouse', -city.radius * 0.42, city.radius * 0.38, 'Salva i progressi e recupera energia.');
  addPOI(city, `${city.id}_garage`, `Garage — ${city.name}`, 'garage', city.radius * 0.46, -city.radius * 0.3, 'Ripara e custodisci i veicoli.');
  addPOI(city, `${city.id}_gunshop`, `Armeria — ${city.name}`, 'gunshop', -city.radius * 0.5, -city.radius * 0.1, 'Armi e munizioni, senza domande.');
  addPOI(city, `${city.id}_police`, `Questura — ${city.name}`, 'police', city.radius * 0.28, city.radius * 0.44, 'Meglio non entrare con le stelle accese.');
  addPOI(city, `${city.id}_hospital`, `Ospedale — ${city.name}`, 'hospital', -city.radius * 0.2, -city.radius * 0.5, 'Cura le ferite. A pagamento.');
  addPOI(city, `${city.id}_shop`, `Emporio — ${city.name}`, 'shop', city.radius * 0.5, city.radius * 0.22, 'Provviste, mappe e caffè.');
  addPOI(city, `${city.id}_gas`, `Distributore — ${city.name}`, 'gas', city.radius * 0.62, city.radius * 0.58, 'Rifornisci il veicolo.');
  addPOI(city, `${city.id}_mission`, `Contatti — ${city.name}`, 'mission', -city.radius * 0.3, -city.radius * 0.35, 'Lavori disponibili in zona.');
  if (city.coastal) {
    addPOI(city, `${city.id}_port`, `Porto — ${city.name}`, 'port', city.radius * 0.66, city.radius * 0.66, 'Container, gru e affari loschi.');
  }
}

// Airports and long-distance landmarks
POIS.push(
  { id: 'airport_malpensa', name: 'Aeroporto di Malpensa', kind: 'airport', x: -900, z: -2600, cityId: 'milano', description: 'Pista e terminal. Zona sorvegliata.' },
  { id: 'airport_fiumicino', name: 'Aeroporto di Fiumicino', kind: 'airport', x: 620, z: -30, cityId: 'roma', description: 'Il principale scalo del centro Italia.' },
  { id: 'lake_como', name: 'Lago di Como', kind: 'viewpoint', x: LAKE.x, z: LAKE.z + 260, cityId: 'milano', description: 'Ville, tornanti e acqua calma.' },
  { id: 'stelvio', name: 'Passo dello Stelvio', kind: 'race', x: 240, z: -2820, cityId: 'milano', description: 'Tornanti leggendari tra le Alpi.' },
  { id: 'amalfi', name: 'Costiera Amalfitana', kind: 'viewpoint', x: -420, z: 1210, cityId: 'napoli', description: 'Strade strette sopra il mare.' },
  { id: 'etna', name: 'Etna', kind: 'viewpoint', x: 300, z: 2680, cityId: 'palermo', description: 'Il vulcano visto da mezzo mondo.' },
  { id: 'vesuvio', name: 'Vesuvio', kind: 'viewpoint', x: -450, z: 1080, cityId: 'napoli', description: 'Fumo, pietra nera e panorama sul golfo.' },
  { id: 'porto_genova', name: 'Porto di Genova', kind: 'port', x: -1290, z: -1010, cityId: 'genova', description: 'Il porto più grande del paese.' },
  { id: 'bari_lungomare', name: 'Lungomare di Bari', kind: 'viewpoint', x: 1300, z: 790, cityId: 'bari', description: 'Passeggiata sull’Adriatico.' },
);

export const SAFEHOUSES = POIS.filter((p) => p.kind === 'safehouse');
export const GARAGES = POIS.filter((p) => p.kind === 'garage');
export const GUNSHOPS = POIS.filter((p) => p.kind === 'gunshop');

/* ------------------------------------------------------------------ */
/* Region lookup                                                       */
/* ------------------------------------------------------------------ */

export function nearestCity(x: number, z: number): CityDef {
  let best = CITIES[0];
  let bestD = Infinity;
  for (const c of CITIES) {
    const d = dist2D(x, z, c.x, c.z);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function regionNameAt(x: number, z: number): { name: string; city: CityDef | null } {
  const city = nearestCity(x, z);
  if (dist2D(x, z, city.x, city.z) < city.radius * 1.35) {
    return { name: `${city.name} · ${city.region}`, city };
  }
  if (z < -2700) return { name: 'ALPI', city: null };
  if (z > 2050) return { name: 'SICILIA', city: null };
  if (z > 850 && x < -250) return { name: 'COSTIERA AMALFITANA', city: null };
  if (z > 600 && x > 900) return { name: 'PUGLIA', city: null };
  if (x < -1000 && z < -300) return { name: 'LIGURIA', city: null };
  if (x > 800) return { name: 'ADRIATICO', city: null };
  if (x < -800) return { name: 'TIRRENO', city: null };
  return { name: 'CAMPAGNA ITALIANA', city: null };
}

/** City-specific yaw of the main avenue. */
export function cityAvenueAngle(city: CityDef): number {
  return city.angle + Math.PI * 0.5;
}

/** Spawn point for a new game (Milano back street). */
export const PLAYER_SPAWN = { x: -516, z: -2270, yaw: 0.2 };

/** Deterministic per-city RNG. */
export function cityRng(city: CityDef): RNG {
  let h = 2166136261;
  for (let i = 0; i < city.id.length; i++) {
    h ^= city.id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return new RNG((h ^ WORLD.seed) >>> 0);
}

export function cityDistance(a: CityDef, b: CityDef): number {
  return dist2D(a.x, a.z, b.x, b.z);
}

export function angleTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, -(toZ - fromZ));
}

/** The ordered highway itinerary used to build the main road backbone. */
export const HIGHWAY_ROUTES: string[][] = [
  ['torino', 'milano', 'venezia'],
  ['milano', 'bologna', 'firenze', 'roma', 'napoli'],
  ['torino', 'genova', 'firenze'],
  ['bologna', 'genova'],
  ['roma', 'bari'],
  ['napoli', 'bari'],
  ['bari', 'napoli'],
];

/** Sicily is connected by a ferry route (handled by gameplay, not road). */
export const FERRY_ROUTE = { from: { x: 620, z: 1560 }, to: { x: 120, z: 2120 } };

export const REGION_COLORS: Record<string, string> = {
  milano: '#c9bda9',
  roma: '#c98f5a',
  napoli: '#d6c39b',
  torino: '#d9d2c3',
  firenze: '#d8b98a',
  venezia: '#d9b8a0',
  bologna: '#c8845c',
  genova: '#cbb08a',
  palermo: '#dcc29a',
  bari: '#ddd0b8',
};

export function cityLabelPosition(city: CityDef): { x: number; z: number } {
  return { x: city.x, z: city.z - city.radius * 1.1 };
}

export function isOnLand(x: number, z: number): boolean {
  // cheap test using nearest city? Caller should use terrain sampler for accurate result.
  const c = nearestCity(x, z);
  return dist2D(x, z, c.x, c.z) < c.radius * 2.2 || (z < -2600 && z > -3250);
}

export function normalizeYaw(yaw: number): number {
  return wrapAngle(yaw);
}
