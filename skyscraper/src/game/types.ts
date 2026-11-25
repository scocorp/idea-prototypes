import type { ShapeId } from './shapes.ts';

/** Building-wide pools: produced by active buildings, consumed by active buildings. */
export type Resource = 'labor' | 'skill' | 'food' | 'power' | 'goods';
export const RESOURCES: readonly Resource[] = ['labor', 'skill', 'food', 'power', 'goods'];

/** Spatial coverage fields: a cell is either covered or not. */
export type Field = 'water' | 'drain' | 'heat' | 'lift' | 'lamp' | 'pipe';
export const FIELDS: readonly Field[] = ['water', 'drain', 'heat', 'lift', 'lamp', 'pipe'];

/**
 * sky    = open sky directly above (top of its column)
 * window = sky, side light (an open face) or piped sunlight
 * grow   = sky, piped sunlight or a grow lamp
 */
export type LightNeed = 'sky' | 'window' | 'grow';

export type Category = 'housing' | 'food' | 'utility' | 'power' | 'industry' | 'amenity' | 'transit' | 'landmark';
export type SocialClass = 'laborer' | 'citizen' | 'elite';

/**
 * Emits a field into a box around the building: every cell within Chebyshev distance `r` of the
 * footprint (same x/y plane), on levels building.z + dz[0] .. building.z + dz[1].
 * Appeal emissions carry a signed `value`; each building counts once per target cell.
 */
export interface Emission {
  field: Field | 'appeal';
  r: number;
  dz: readonly [number, number];
  value?: number;
}

/** Visual style hints for the renderer. Pure data so game logic stays render-agnostic. */
export type FacadeStyle =
  | 'shack'
  | 'brick'
  | 'windows'
  | 'luxury'
  | 'industrial'
  | 'utility'
  | 'glass'
  | 'soil'
  | 'shop'
  | 'capsule'
  | 'stone';

export type PropKind =
  | 'crops'
  | 'solar'
  | 'funnel'
  | 'trees'
  | 'chimney'
  | 'chimneys'
  | 'tank'
  | 'dome'
  | 'cone'
  | 'pavilion'
  | 'lamp'
  | 'wellhead'
  | 'pool'
  | 'deck'
  | 'awning'
  | 'machine'
  | 'vent'
  | 'cross'
  | 'pit'
  | 'bore';

export interface Stats {
  pop: Record<SocialClass, number>;
  made: Record<Resource, number>;
  used: Record<Resource, number>;
  /** Buildings switched off for lack of each resource. */
  short: Record<Resource, number>;
  prestige: number;
  /** Highest level holding an active building (-1 if none). */
  maxActiveZ: number;
  /** Highest built level (-1 if none). */
  maxZ: number;
  activeCount: Record<string, number>;
  builtCount: Record<string, number>;
  total: number;
  inactive: number;
  bridges: number;
}

export interface TileDef {
  id: string;
  name: string;
  category: Category;
  shape: ShapeId;
  /** Era (1-based) in which the plan unlocks. */
  era: number;
  /** Extra condition on top of reaching the era. */
  unlockExtra?: { text: string; test: (s: Stats) => boolean };
  /** Structural placement rules (enforced when placing). */
  place?: {
    ground?: boolean;
    minZ?: number;
    /** On the plot perimeter, not a corner. */
    edge?: boolean;
    /** Only on the ground or directly on top of another of the same type. */
    stacksOnSelf?: boolean;
    /** Nothing may be built on top of it. */
    cap?: boolean;
  };
  /** Operating requirements (a building that misses any of these is inactive). */
  needs: {
    light?: LightNeed;
    water?: boolean;
    drain?: boolean;
    heat?: boolean;
    /** true = always needs lift access; number = needs it from that level upwards. */
    lift?: boolean | number;
    appeal?: number;
    pool?: Partial<Record<Resource, number>>;
  };
  makes?: Partial<Record<Resource, number>>;
  residents?: { cls: SocialClass; n: number };
  /** Prestige while active: base + perAppeal * (appeal above its need) + perLevel * z. */
  prestige?: { base: number; perAppeal?: number; perLevel?: number };
  emits?: readonly Emission[];
  /**
   * Relays only emit when fed by the same field (or, for 'pipe', by open sky), so chains must
   * start at a real source. 'lift' = a shaft that must be continuous down to the ground.
   */
  relay?: 'water' | 'pipe' | 'lift';
  special?: 'bridge';
  look: { color: number; top?: number; style: FacadeStyle; prop?: PropKind; glow?: number; height?: number };
  blurb: string;
}

export interface BuildingEvent {
  m: number;
  t: 'sun-lost' | 'sun-back' | 'stopped' | 'started';
  why?: string;
}

export interface Building {
  id: number;
  type: string;
  /** Anchor cell. */
  x: number;
  y: number;
  z: number;
  rot: number;
  flip: boolean;
  /** Absolute footprint cells (x, y) on level z. Derived from type/anchor/rot/flip. */
  cells: [number, number][];
  born: number;
  log: BuildingEvent[];
}

export type Side = 'n' | 'e' | 's' | 'w';

export interface Neighbor {
  side: Side;
  half: 0 | 1;
  name: string;
  /** Floors: levels 0 .. height-1. */
  height: number;
  width: number;
  depth: number;
  /** Gap between our plot edge and their facade, in tiles. */
  gap: number;
  /** Offset along our edge, in tiles, for visual variety. */
  shift: number;
  hue: number;
}

export type ChronicleKind = 'build' | 'loss' | 'unlock' | 'milestone' | 'shortage' | 'info' | 'bridge';

export interface ChronicleEntry {
  m: number;
  text: string;
  kind: ChronicleKind;
  at?: [number, number, number];
}

export interface GameState {
  v: 1;
  name: string;
  seed: number;
  size: number;
  month: number;
  nextId: number;
  buildings: Building[];
  /** Era reached (1-based). Sticky. */
  era: number;
  /** Tile ids whose plans are available. Sticky. */
  unlocked: string[];
  sandbox: boolean;
  neighbors: Neighbor[];
  chronicle: ChronicleEntry[];
  /** One-off milestone flags already announced. */
  flags: string[];
}
