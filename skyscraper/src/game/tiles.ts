// The tile catalogue. Every rule a tile participates in is declared here as data; evaluate.ts
// interprets it. Numbers are first-pass guesses — see doc/design.md for the intent behind them.

import { LIFT_RANGE } from './config.ts';
import type { Category, Emission, Resource, Stats, TileDef } from './types.ts';

const T = (d: TileDef) => d;

export const TILES: Record<string, TileDef> = {
  // ── Era 1 · Settlement ────────────────────────────────────────────────────
  shanty: T({
    id: 'shanty', name: 'Shanty', category: 'housing', shape: 'I1', era: 1,
    needs: { water: true, pool: { food: 1 } },
    makes: { labor: 2 }, residents: { cls: 'laborer', n: 4 },
    look: { color: 0xb07a52, top: 0x8c6a4a, style: 'shack' },
    blurb: "Corrugated walls, a cooking fire, a family. It isn't much, but it's home.",
  }),
  allotment: T({
    id: 'allotment', name: 'Allotment', category: 'food', shape: 'I1', era: 1,
    needs: { light: 'grow', pool: { labor: 1 } },
    makes: { food: 3 },
    look: { color: 0x7a5a36, top: 0x6fa84a, style: 'soil', prop: 'crops' },
    blurb: 'Beans, greens and stubborn tomatoes. Needs sunlight, or a convincing substitute.',
  }),
  well: T({
    id: 'well', name: 'Well', category: 'utility', shape: 'I1', era: 1,
    place: { ground: true },
    needs: { pool: { labor: 1 } },
    emits: [{ field: 'water', r: 2, dz: [0, 1] }],
    look: { color: 0x8d8a80, top: 0x6f8fa8, style: 'stone', prop: 'wellhead' },
    blurb: 'A hand-dug well. Buckets go up one flight of stairs and no further.',
  }),

  // ── Era 2 · Tenements ─────────────────────────────────────────────────────
  tenement: T({
    id: 'tenement', name: 'Tenement', category: 'housing', shape: 'I2', era: 2,
    needs: { water: true, drain: true, pool: { food: 2, goods: 1 } },
    makes: { labor: 5 }, residents: { cls: 'laborer', n: 10 },
    emits: [{ field: 'appeal', r: 1, dz: [0, 0], value: -1 }],
    look: { color: 0xa0523d, top: 0x6e3b2e, style: 'brick' },
    blurb: 'Ten to a floor and the walls are thin. Needs a drain, and tools from the workshops.',
  }),
  cesspit: T({
    id: 'cesspit', name: 'Cesspit', category: 'utility', shape: 'I1', era: 2,
    place: { ground: true },
    needs: { pool: { labor: 1 } },
    emits: [
      { field: 'drain', r: 1, dz: [0, 3] },
      { field: 'appeal', r: 1, dz: [0, 1], value: -2 },
    ],
    look: { color: 0x6e6845, top: 0x4a4630, style: 'stone', prop: 'pit' },
    blurb: 'Out of sight, out of mind. Mostly. Drains the floors above it up to L3.',
  }),
  raincatcher: T({
    id: 'raincatcher', name: 'Rain Catcher', category: 'utility', shape: 'I1', era: 2,
    needs: { light: 'sky' },
    emits: [{ field: 'water', r: 1, dz: [-4, -1] }],
    look: { color: 0x5f86a8, top: 0x7fa6c8, style: 'utility', prop: 'funnel' },
    blurb: 'Funnels and barrels on the roof. Gravity carries the water down four floors.',
  }),
  workshop: T({
    id: 'workshop', name: 'Workshop', category: 'industry', shape: 'I2', era: 2,
    needs: { pool: { labor: 2 } },
    makes: { goods: 2 },
    emits: [{ field: 'appeal', r: 1, dz: [0, 0], value: -1 }],
    look: { color: 0xc08a3e, top: 0x8a6230, style: 'industrial', prop: 'vent' },
    blurb: 'Hammers, looms, solder. Loud, but someone has to make things.',
  }),

  // ── Era 3 · Citizens ──────────────────────────────────────────────────────
  apartment: T({
    id: 'apartment', name: 'Apartment', category: 'housing', shape: 'L3', era: 3,
    place: { minZ: 1 },
    needs: { light: 'window', water: true, drain: true, lift: 5, appeal: 1, pool: { food: 2, goods: 1 } },
    makes: { skill: 3 }, residents: { cls: 'citizen', n: 9 }, prestige: { base: 1 },
    look: { color: 0xe2d3b4, top: 0xb8a888, style: 'windows' },
    blurb: 'Clerks, nurses, engineers. Every room wants a window, and nobody wants a tenement next door.',
  }),
  garden: T({
    id: 'garden', name: 'Garden', category: 'amenity', shape: 'I1', era: 3,
    needs: { light: 'sky', pool: { labor: 1 } },
    emits: [{ field: 'appeal', r: 1, dz: [-1, 1], value: 2 }],
    look: { color: 0x7a6a4a, top: 0x4f9a4a, style: 'soil', prop: 'trees' },
    blurb: 'A few trees in the sun. Lifts the appeal of everything around it.',
  }),
  market: T({
    id: 'market', name: 'Market', category: 'amenity', shape: 'I2', era: 3,
    needs: { pool: { labor: 1, goods: 1 }, adjacent: { homes: true, count: 2, text: 'Needs 2 occupied homes next to it on its level' } },
    emits: [{ field: 'appeal', r: 2, dz: [-1, 1], value: 2 }],
    look: { color: 0xe08a3a, top: 0xa8643a, style: 'shop', prop: 'awning' },
    blurb: 'Stalls, noodles, gossip. Lives off the homes beside it and brings life to the floors around.',
  }),
  solar: T({
    id: 'solar', name: 'Solar Array', category: 'power', shape: 'I1', era: 3,
    needs: { light: 'sky' },
    makes: { power: 3 },
    look: { color: 0x4a5a6a, top: 0x2b4a7a, style: 'utility', prop: 'solar' },
    blurb: 'Clean power, but only under open sky, and the roof is in demand.',
  }),
  boiler: T({
    id: 'boiler', name: 'Boiler House', category: 'power', shape: 'I1', era: 3,
    needs: { pool: { labor: 2 } },
    makes: { power: 4 },
    emits: [
      { field: 'heat', r: 0, dz: [1, 2] },
      { field: 'appeal', r: 1, dz: [0, 2], value: -2 },
    ],
    look: { color: 0x4a4440, top: 0x3a3430, style: 'industrial', prop: 'chimney', glow: 0xff7a30 },
    blurb: 'Burns whatever the city throws away. Heat and smoke rise two floors.',
  }),
  growlamp: T({
    id: 'growlamp', name: 'Grow Lamp', category: 'food', shape: 'I1', era: 3,
    needs: { pool: { power: 1 } },
    emits: [{ field: 'lamp', r: 1, dz: [0, 0] }],
    look: { color: 0x6a4a7a, top: 0xb05bd6, style: 'utility', prop: 'lamp', glow: 0xd070ff },
    blurb: 'A violet sun for the eight plots around it. Allotments grow in the dark.',
  }),

  // ── Era 4 · Metropolis ────────────────────────────────────────────────────
  lift: T({
    id: 'lift', name: 'Lift', category: 'transit', shape: 'I1', era: 4,
    place: { stacksOnSelf: true },
    needs: {},
    relay: 'lift',
    emits: [{ field: 'lift', r: LIFT_RANGE, dz: [0, 0] }],
    look: { color: 0x7fd1e0, top: 0x9fe1f0, style: 'glass', prop: 'machine' },
    blurb: 'A shaft from the street up. Citizens from L5 and every elite need one within 3 tiles.',
  }),
  sewage: T({
    id: 'sewage', name: 'Sewage Works', category: 'utility', shape: 'O4', era: 4,
    needs: { pool: { labor: 2, skill: 1, power: 1 } },
    emits: [
      { field: 'drain', r: 2, dz: [1, 8] },
      { field: 'appeal', r: 1, dz: [0, 1], value: -3 },
    ],
    look: { color: 0x6b6a3e, top: 0x4e4d2e, style: 'industrial', prop: 'pit' },
    blurb: 'Everything above flows down to here: eight floors of it, two tiles either side.',
  }),
  pump: T({
    id: 'pump', name: 'Pump Station', category: 'utility', shape: 'I1', era: 4,
    needs: { pool: { power: 2 } },
    relay: 'water',
    emits: [{ field: 'water', r: 1, dz: [1, 6] }],
    look: { color: 0x4f7396, top: 0x3f5a76, style: 'utility', prop: 'machine' },
    blurb: 'Pushes water up six floors. It needs water to pump in the first place.',
  }),
  clinic: T({
    id: 'clinic', name: 'Clinic', category: 'amenity', shape: 'I2', era: 4,
    needs: { pool: { skill: 2, power: 1 } },
    emits: [{ field: 'appeal', r: 3, dz: [-2, 2], value: 3 }],
    look: { color: 0xd8eeea, top: 0xa8c8c4, style: 'windows', prop: 'cross' },
    blurb: 'Doctors from the middle floors. Everyone within reach sleeps easier.',
  }),
  foundry: T({
    id: 'foundry', name: 'Foundry', category: 'industry', shape: 'I3', era: 4,
    needs: { heat: true, pool: { labor: 4, skill: 1, power: 2 } },
    makes: { goods: 6 },
    emits: [
      { field: 'heat', r: 1, dz: [1, 3] },
      { field: 'appeal', r: 1, dz: [0, 3], value: -3 },
    ],
    look: { color: 0x5a4a42, top: 0x40342e, style: 'industrial', prop: 'chimneys', glow: 0xff6a20 },
    blurb: 'Fed by the boilers below, it melts metal into real money. Its own heat and soot climb three floors.',
  }),
  lightpipe: T({
    id: 'lightpipe', name: 'Light Pipe', category: 'food', shape: 'I1', era: 4,
    needs: {},
    relay: 'pipe',
    emits: [{ field: 'pipe', r: 0, dz: [-3, -1] }],
    look: { color: 0xe8d9a8, top: 0xf6d873, style: 'glass', prop: 'dome', glow: 0xffe9a0 },
    blurb: 'Mirrors in a polished shaft: carries sunlight three floors straight down. Chainable.',
  }),

  digester: T({
    id: 'digester', name: 'Biogas Digester', category: 'power', shape: 'I1', era: 4,
    needs: { pool: { labor: 1 }, adjacent: { tiles: ['sewage'], count: 1, text: 'Must touch a working Sewage Works' } },
    makes: { power: 4 },
    emits: [{ field: 'appeal', r: 1, dz: [0, 1], value: -2 }],
    look: { color: 0x5a6a3a, top: 0x4a5a2e, style: 'industrial', prop: 'tanks' },
    blurb: "The tower's leavings, fermented into power. Must sit against a Sewage Works.",
  }),

  // ── Era 5 · Overcity ──────────────────────────────────────────────────────
  penthouse: T({
    id: 'penthouse', name: 'Penthouse', category: 'housing', shape: 'I2', era: 5,
    place: { minZ: 6 },
    needs: {
      light: 'sky', water: true, drain: true, lift: true, appeal: 4,
      pool: { food: 2, goods: 2, power: 2, labor: 1 },
    },
    residents: { cls: 'elite', n: 2 }, prestige: { base: 6, perAppeal: 1 },
    look: { color: 0xf3ead2, top: 0xd8c48a, style: 'luxury', prop: 'pavilion' },
    blurb: 'Two residents, one view, many demands, including a servant from below.',
  }),
  bathhouse: T({
    id: 'bathhouse', name: 'Bathhouse', category: 'amenity', shape: 'I2', era: 5,
    needs: { water: true, heat: true, pool: { labor: 2 } },
    emits: [{ field: 'appeal', r: 2, dz: [-1, 1], value: 3 }],
    look: { color: 0x49b5b0, top: 0x2f8a86, style: 'stone', prop: 'pool' },
    blurb: 'Hot baths warmed by the furnaces below. Turns waste heat into appeal.',
  }),
  watertower: T({
    id: 'watertower', name: 'Water Tower', category: 'utility', shape: 'I1', era: 5,
    place: { cap: true },
    needs: {},
    relay: 'water',
    emits: [{ field: 'water', r: 2, dz: [-6, -1] }],
    look: { color: 0x7a6a5a, top: 0x9a6b44, style: 'utility', prop: 'tank' },
    blurb: 'Fill it from below and it waters six floors beneath it, two tiles either side. Nothing goes on top.',
  }),
  skybridge: T({
    id: 'skybridge', name: 'Skybridge', category: 'transit', shape: 'I1', era: 5,
    place: { edge: true, minZ: 1 },
    needs: { pool: { labor: 1 } },
    special: 'bridge',
    look: { color: 0x9fb3c8, top: 0x7f93a8, style: 'glass' },
    blurb: "Bridges are level. Link low into a giant and you reach its undercity; link high into a stub and you reach its elite.",
  }),
  skygarden: T({
    id: 'skygarden', name: 'Sky Garden', category: 'amenity', shape: 'L3', era: 5,
    place: { minZ: 8 },
    needs: { light: 'sky', water: true, pool: { labor: 1 } },
    prestige: { base: 3 },
    emits: [{ field: 'appeal', r: 2, dz: [-2, 1], value: 3 }],
    look: { color: 0x7a7a6a, top: 0x3fa86a, style: 'soil', prop: 'trees' },
    blurb: 'Trees eight floors up. The gardeners commute from the undercity.',
  }),

  // ── Era 6 · Spire ─────────────────────────────────────────────────────────
  skyvilla: T({
    id: 'skyvilla', name: 'Sky Villa', category: 'housing', shape: 'O4', era: 6,
    place: { minZ: 12 },
    needs: {
      light: 'sky', water: true, drain: true, lift: true, appeal: 6,
      pool: { food: 3, goods: 3, power: 3, labor: 2, skill: 1 },
    },
    residents: { cls: 'elite', n: 4 }, prestige: { base: 16, perAppeal: 2 },
    look: { color: 0xf7f4ee, top: 0xe8d8a8, style: 'luxury', prop: 'pool' },
    blurb: 'A private sky. Four residents, a staff of three, and an infinity pool.',
  }),
  geothermal: T({
    id: 'geothermal', name: 'Geothermal Bore', category: 'power', shape: 'O4', era: 6,
    place: { ground: true },
    needs: { pool: { labor: 2, skill: 2 } },
    makes: { power: 12 },
    emits: [{ field: 'heat', r: 1, dz: [1, 4] }],
    look: { color: 0x4b3b3b, top: 0x3a2a2a, style: 'industrial', prop: 'bore', glow: 0xff4a20 },
    blurb: "Taps the planet's heat from the lowest floor. Clean heat rises four levels.",
  }),
  obsdeck: T({
    id: 'obsdeck', name: 'Observation Deck', category: 'landmark', shape: 'I1', era: 6,
    place: { minZ: 12 },
    needs: { light: 'sky', lift: true, pool: { skill: 1 } },
    prestige: { base: 0, perLevel: 0.5 },
    emits: [{ field: 'appeal', r: 1, dz: [-1, 0], value: 2 }],
    look: { color: 0xa8d8f0, top: 0xc8e8f8, style: 'glass', prop: 'deck' },
    blurb: 'Tourists pay to see what the elites see every morning. Prestige grows with height.',
  }),
  capsule: T({
    id: 'capsule', name: 'Capsule Stack', category: 'housing', shape: 'I1', era: 6,
    needs: { water: true, drain: true, pool: { food: 2, goods: 1, power: 1 } },
    makes: { labor: 6 }, residents: { cls: 'laborer', n: 12 },
    emits: [{ field: 'appeal', r: 1, dz: [0, 0], value: -2 }],
    look: { color: 0x5b6b73, top: 0x46545c, style: 'capsule' },
    blurb: 'Twelve sleeping pods in a single tile. Needs no light at all.',
  }),
  spire: T({
    id: 'spire', name: 'Spire', category: 'landmark', shape: 'I1', era: 6,
    place: { minZ: 20, cap: true },
    needs: { light: 'sky', lift: true, pool: { skill: 4, power: 6 } },
    prestige: { base: 40 },
    look: { color: 0xe8c15a, top: 0xf0d080, style: 'luxury', prop: 'cone', glow: 0xffe0a0 },
    blurb: 'The crown. Visible from every tower in the city.',
  }),
};

export const TILE_LIST: TileDef[] = Object.values(TILES);

export function tile(id: string): TileDef {
  const d = TILES[id];
  if (!d) throw new Error(`Unknown tile type: ${id}`);
  return d;
}

export interface GoalPart {
  label: string;
  get: (s: Stats) => number;
  target: number;
}

export interface Era {
  n: number;
  name: string;
  /** What reaching this era requires (all parts). */
  parts: GoalPart[];
}

const laborers: GoalPart['get'] = (s) => s.pop.laborer;
const citizens: GoalPart['get'] = (s) => s.pop.citizen;
const topLevel: GoalPart['get'] = (s) => Math.max(0, s.maxActiveZ);

/** Reaching an era unlocks every tile with that era number. Eras are sticky once reached. */
export const ERAS: Era[] = [
  { n: 1, name: 'Settlement', parts: [] },
  { n: 2, name: 'Tenements', parts: [{ label: 'Laborers housed', get: laborers, target: 16 }] },
  {
    n: 3, name: 'Citizens',
    parts: [
      { label: 'Laborers housed', get: laborers, target: 50 },
      { label: 'Goods made', get: (s) => s.made.goods, target: 2 },
      { label: 'Highest working level', get: topLevel, target: 3 },
    ],
  },
  {
    n: 4, name: 'Metropolis',
    parts: [
      { label: 'Citizens housed', get: citizens, target: 18 },
      { label: 'Power made', get: (s) => s.made.power, target: 6 },
    ],
  },
  {
    n: 5, name: 'Overcity',
    parts: [
      { label: 'Citizens housed', get: citizens, target: 36 },
      { label: 'Citizen happiness (avg appeal)', get: (s) => s.citizenAppeal, target: 2 },
      { label: 'Highest working level', get: topLevel, target: 8 },
    ],
  },
  {
    n: 6, name: 'Spire',
    parts: [
      { label: 'Elites housed', get: (s) => s.pop.elite, target: 8 },
      { label: 'Prestige', get: (s) => s.prestige, target: 50 },
    ],
  },
];

export function eraReached(e: Era, s: Stats): boolean {
  return e.parts.every((p) => p.get(s) >= p.target);
}

export const CATEGORY_INFO: Record<Category, { label: string; color: string }> = {
  housing: { label: 'Homes', color: '#e0a070' },
  food: { label: 'Food & Light', color: '#8fcf6a' },
  utility: { label: 'Water & Waste', color: '#6fb0e0' },
  power: { label: 'Power', color: '#f0d050' },
  industry: { label: 'Industry', color: '#d09060' },
  amenity: { label: 'Amenities', color: '#e080c0' },
  transit: { label: 'Transit', color: '#80d8e8' },
  landmark: { label: 'Landmarks', color: '#f0c860' },
};

export const RESOURCE_INFO: Record<Resource, { label: string; icon: string; color: string }> = {
  labor: { label: 'Labor', icon: '⚒', color: '#e0a070' },
  skill: { label: 'Skill', icon: '✎', color: '#a0b8ff' },
  food: { label: 'Food', icon: '❦', color: '#8fcf6a' },
  power: { label: 'Power', icon: 'ϟ', color: '#f0d050' },
  goods: { label: 'Goods', icon: '▣', color: '#d09060' },
};

export const FIELD_INFO: Record<Emission['field'], { label: string; color: number; css: string }> = {
  water: { label: 'Water', color: 0x3a8fe0, css: '#3a8fe0' },
  drain: { label: 'Drain', color: 0x9a7a3a, css: '#b8904a' },
  heat: { label: 'Heat', color: 0xff6a30, css: '#ff6a30' },
  lift: { label: 'Lift access', color: 0x40e0e0, css: '#40e0e0' },
  lamp: { label: 'Grow light', color: 0xc060ff, css: '#c060ff' },
  pipe: { label: 'Piped sun', color: 0xffc040, css: '#ffc040' },
  appeal: { label: 'Appeal', color: 0xff80c0, css: '#ff80c0' },
};

const LIGHT_TEXT = { sky: 'open sky', window: 'a window (open side or sky)', grow: 'sun, piped sun or grow lamp' };

/** Human-readable requirement lines for a tile, derived from its definition. */
export function describeNeeds(d: TileDef): string[] {
  const out: string[] = [];
  const n = d.needs;
  if (n.light) out.push(`Light: ${LIGHT_TEXT[n.light]}`);
  const cov: string[] = [];
  if (n.water) cov.push('water');
  if (n.drain) cov.push('drain');
  if (n.heat) cov.push('heat from below');
  if (n.lift === true) cov.push('lift access');
  else if (typeof n.lift === 'number') cov.push(`lift access from L${n.lift}`);
  if (cov.length) out.push(`Needs ${cov.join(', ')}`);
  if (n.appeal !== undefined) out.push(`Appeal ≥ ${n.appeal}`);
  if (n.adjacent) out.push(n.adjacent.text);
  const pool = Object.entries(n.pool ?? {});
  if (pool.length) out.push('Uses ' + pool.map(([r, v]) => `${v} ${RESOURCE_INFO[r as Resource].label}`).join(', '));
  if (d.relay === 'water') out.push('Must itself be in water to operate');
  if (d.relay === 'pipe') out.push('Must itself be lit by open sky or a Light Pipe above');
  if (d.relay === 'lift') out.push('Shaft must run unbroken to the ground');
  return out;
}

export function describePlacement(d: TileDef): string[] {
  const p = d.place ?? {};
  const out: string[] = [];
  if (p.ground) out.push('Ground level only');
  if (p.minZ) out.push(`L${p.minZ} or higher`);
  if (p.edge) out.push('On the plot edge (not a corner)');
  if (p.stacksOnSelf) out.push('On the ground or on top of another ' + d.name);
  if (p.cap) out.push('Nothing can be built on top');
  return out;
}

function dzText(dz: readonly [number, number]): string {
  const [a, b] = dz;
  if (a === 0 && b === 0) return 'same level';
  if (a >= 0) return a === b ? `${a} up` : `${a === 0 ? 'same level' : a} to ${b} up`;
  if (b <= 0) return a === b ? `${-a} down` : `${b === 0 ? 'same level' : -b} to ${-a} down`;
  return `${-a} down to ${b} up`;
}

export function describeOutputs(d: TileDef): string[] {
  const out: string[] = [];
  const makes = Object.entries(d.makes ?? {});
  if (makes.length) out.push('Makes ' + makes.map(([r, v]) => `${v} ${RESOURCE_INFO[r as Resource].label}`).join(', '));
  if (d.residents) out.push(`Houses ${d.residents.n} ${d.residents.cls}s`);
  if (d.prestige) {
    const p = d.prestige;
    const bits = [`${p.base}`];
    if (p.perAppeal) bits.push(`+${p.perAppeal} per appeal above ${d.needs.appeal ?? 0}`);
    if (p.perLevel) bits.push(`+${p.perLevel} per level`);
    out.push(`Prestige ${bits.join(' ')}`);
  }
  for (const e of d.emits ?? []) {
    const info = FIELD_INFO[e.field];
    const what = e.field === 'appeal' ? `${e.value! > 0 ? '+' : ''}${e.value} Appeal` : info.label;
    const reach = e.r === 0 ? 'this column' : `${e.r} tile${e.r > 1 ? 's' : ''} around`;
    out.push(`${what}: ${reach}, ${dzText(e.dz)}`);
  }
  if (d.special === 'bridge') out.push('Links to the neighbouring tower it faces; effect depends on their stratum');
  return out;
}
