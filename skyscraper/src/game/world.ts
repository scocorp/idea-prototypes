// Occupancy grid + structural placement rules (support, bounds, replacement).
// Functional requirements (light, water, ...) never block placement; they only decide whether a
// building operates. See evaluate.ts.

import { MAX_LEVELS } from './config.ts';
import { footprint } from './shapes.ts';
import { TILES } from './tiles.ts';
import type { Building, GameState } from './types.ts';

export class World {
  readonly n: number;
  readonly buildings: readonly Building[];
  /** Building index + 1 per cell; 0 = empty. Index = (z * n + y) * n + x. */
  readonly occ: Int32Array;

  constructor(size: number, buildings: readonly Building[]) {
    this.n = size;
    this.buildings = buildings;
    this.occ = new Int32Array(size * size * MAX_LEVELS);
    buildings.forEach((b, i) => {
      for (const [x, y] of b.cells) this.occ[this.idx(x, y, b.z)] = i + 1;
    });
  }

  idx(x: number, y: number, z: number): number {
    return (z * this.n + y) * this.n + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.n && y < this.n;
  }

  /** Building index at a cell, or -1 (also for out-of-range cells). */
  at(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y) || z < 0 || z >= MAX_LEVELS) return -1;
    return this.occ[this.idx(x, y, z)]! - 1;
  }

  /** Highest occupied level in a column, or -1. */
  top(x: number, y: number): number {
    for (let z = MAX_LEVELS - 1; z >= 0; z--) if (this.at(x, y, z) >= 0) return z;
    return -1;
  }
}

export interface Placement {
  ok: boolean;
  why?: string;
  cells: [number, number][];
  z: number;
  /** Ids of buildings this placement would replace. */
  replaces: number[];
}

/** Can `type` go at anchor (ax, ay) on level z? `replace` allows overwriting buildings on that level. */
export function checkPlacement(
  state: GameState,
  world: World,
  type: string,
  ax: number,
  ay: number,
  z: number,
  rot: number,
  flip: boolean,
  replace: boolean,
): Placement {
  const def = TILES[type];
  const cells = def ? footprint(def.shape, ax, ay, rot, flip) : [];
  const fail = (why: string): Placement => ({ ok: false, why, cells, z, replaces: [] });
  if (!def) return fail('Unknown building');
  if (!state.sandbox && !state.unlocked.includes(type)) return fail('Plans not unlocked yet');
  if (z < 0) return fail('Below ground');
  if (z >= MAX_LEVELS) return fail(`The sky stops at L${MAX_LEVELS - 1}`);
  const n = world.n;
  for (const [x, y] of cells) if (!world.inBounds(x, y)) return fail('Off the plot');

  const p = def.place ?? {};
  if (p.ground && z !== 0) return fail('Ground level only');
  if (p.minZ !== undefined && z < p.minZ) return fail(`Must be on L${p.minZ} or higher`);
  if (p.edge) {
    for (const [x, y] of cells) {
      const ex = x === 0 || x === n - 1;
      const ey = y === 0 || y === n - 1;
      if (!ex && !ey) return fail('Must be on the plot edge, facing a neighbour');
      if (ex && ey) return fail('Not on a corner: a bridge needs one clear direction');
    }
  }

  const replaced = new Set<number>();
  for (const [x, y] of cells) {
    const o = world.at(x, y, z);
    if (o >= 0) {
      if (!replace) return fail('Occupied (hold Shift to replace)');
      replaced.add(o);
    }
  }
  if (replaced.size) {
    const mine = new Set(cells.map(([x, y]) => `${x},${y}`));
    for (const bi of replaced) {
      const b = world.buildings[bi]!;
      if (b.type === type && b.cells.length === cells.length && b.cells.every(([x, y]) => mine.has(`${x},${y}`))) {
        return fail(`Already a ${def.name}`);
      }
      for (const [x, y] of b.cells) {
        if (!mine.has(`${x},${y}`) && world.at(x, y, z + 1) >= 0) {
          return fail(`Part of the ${TILES[b.type]!.name} it replaces holds up the level above`);
        }
      }
    }
  }

  for (const [x, y] of cells) {
    if (z > 0) {
      const below = world.at(x, y, z - 1);
      if (below < 0) return fail('Needs support directly below');
      const bb = world.buildings[below]!;
      const bd = TILES[bb.type]!;
      if (bd.place?.cap) return fail(`Nothing can be built on a ${bd.name}`);
      if (p.stacksOnSelf && bb.type !== type) return fail(`Must start on the ground or on another ${def.name}`);
    }
    if (p.cap && world.at(x, y, z + 1) >= 0) return fail(`Nothing may sit on a ${def.name}`);
  }

  return { ok: true, cells, z, replaces: [...replaced].map((i) => world.buildings[i]!.id) };
}

/** Why a building can't be demolished, or null if it can. */
export function checkDemolish(world: World, b: Building): string | null {
  for (const [x, y] of b.cells) {
    if (world.at(x, y, b.z + 1) >= 0) return 'Something is built on top of it; remove that first (or Shift-replace this)';
  }
  return null;
}
