// Game state transitions. State is plain JSON (saved as-is); every action returns a new state.

import { CHRONICLE_LIMIT, DEFAULT_GRID_SIZE } from './config.ts';
import { chronicleDiff, type Action } from './chronicle.ts';
import { evaluate, type Evaluation } from './evaluate.ts';
import { towerName } from './names.ts';
import { makeNeighbors } from './neighbors.ts';
import { hash32, mulberry32, randomSeed } from './rng.ts';
import { footprint } from './shapes.ts';
import { eraReached, ERAS, TILE_LIST, TILES } from './tiles.ts';
import type { Building, ChronicleEntry, GameState, Stats } from './types.ts';
import { checkDemolish, checkPlacement, World } from './world.ts';

export interface NewGameOptions {
  size?: number;
  seed?: number;
  name?: string;
  sandbox?: boolean;
}

export function newGame(opts: NewGameOptions = {}): GameState {
  const seed = opts.seed ?? randomSeed();
  const size = opts.size ?? DEFAULT_GRID_SIZE;
  const name = opts.name?.trim() || towerName(mulberry32(hash32(seed, 0x7a)));
  const sandbox = opts.sandbox ?? false;
  const state: GameState = {
    v: 1,
    name,
    seed,
    size,
    month: 0,
    nextId: 1,
    buildings: [],
    era: sandbox ? ERAS.length : 1,
    unlocked: TILE_LIST.filter((t) => sandbox || t.era === 1).map((t) => t.id),
    sandbox,
    neighbors: makeNeighbors(seed, size, name),
    chronicle: [],
    flags: [],
  };
  state.chronicle.push({
    m: 0,
    kind: 'info',
    text: sandbox
      ? `Sandbox: every plan for ${name} is on the table. ${size}×${size} plot.`
      : `An empty ${size}×${size} lot between the towers. Someone has already named it ${name}.`,
  });
  return state;
}

export interface ActionResult {
  state: GameState;
  ev: Evaluation;
  entries: ChronicleEntry[];
}

export type ActionOutcome = ActionResult | { error: string };

function clone(state: GameState): GameState {
  return structuredClone(state);
}

/** Unlock any eras/plans now earned. Mutates state; returns chronicle entries. */
export function updateUnlocks(state: GameState, stats: Stats): ChronicleEntry[] {
  const out: ChronicleEntry[] = [];
  while (state.era < ERAS.length && eraReached(ERAS[state.era]!, stats)) {
    state.era++;
  }
  const fresh = TILE_LIST.filter(
    (t) => t.era <= state.era && !state.unlocked.includes(t.id) && (!t.unlockExtra || t.unlockExtra.test(stats)),
  );
  if (fresh.length) {
    for (const t of fresh) state.unlocked.push(t.id);
    const eras = [...new Set(fresh.map((t) => t.era))].sort((a, b) => a - b);
    for (const e of eras) {
      const names = fresh.filter((t) => t.era === e).map((t) => t.name);
      out.push({
        m: state.month,
        kind: 'unlock',
        text: `A new era: ${ERAS[e - 1]!.name}. New plans: ${names.join(', ')}.`,
      });
    }
  }
  return out;
}

function finalize(prevState: GameState, prev: Evaluation, next: GameState, action: Action): ActionResult {
  next.month = prevState.month + 1;
  const ev = evaluate(next);
  const entries = chronicleDiff(prevState, prev, next, ev, action);
  entries.push(...updateUnlocks(next, ev.stats));
  next.chronicle = [...next.chronicle, ...entries].slice(-CHRONICLE_LIMIT);
  return { state: next, ev, entries };
}

export function makeBuilding(id: number, type: string, x: number, y: number, z: number, rot: number, flip: boolean, born: number): Building {
  const d = TILES[type]!;
  return { id, type, x, y, z, rot, flip, cells: footprint(d.shape, x, y, rot, flip), born, log: [] };
}

/** State with a hypothetical building in place (for previews). Does not advance time. */
export function withBuilding(
  state: GameState,
  type: string,
  x: number,
  y: number,
  z: number,
  rot: number,
  flip: boolean,
  replaces: number[],
): { state: GameState; id: number } {
  const id = state.nextId;
  const b = makeBuilding(id, type, x, y, z, rot, flip, state.month + 1);
  return {
    state: {
      ...state,
      nextId: id + 1,
      buildings: [...state.buildings.filter((o) => !replaces.includes(o.id)), b],
    },
    id,
  };
}

export function place(
  state: GameState,
  prev: Evaluation,
  type: string,
  x: number,
  y: number,
  z: number,
  rot: number,
  flip: boolean,
  replace: boolean,
): ActionOutcome {
  const check = checkPlacement(state, prev.world, type, x, y, z, rot, flip, replace);
  if (!check.ok) return { error: check.why ?? 'Cannot build here' };
  const next = clone(state);
  const id = next.nextId++;
  next.buildings = next.buildings.filter((b) => !check.replaces.includes(b.id));
  next.buildings.push(makeBuilding(id, type, x, y, z, rot, flip, state.month + 1));
  return finalize(state, prev, next, { kind: 'place', id });
}

export function demolish(state: GameState, prev: Evaluation, id: number): ActionOutcome {
  const b = state.buildings.find((o) => o.id === id);
  if (!b) return { error: 'Nothing there' };
  const why = checkDemolish(prev.world, b);
  if (why) return { error: why };
  const next = clone(state);
  next.buildings = next.buildings.filter((o) => o.id !== id);
  return finalize(state, prev, next, {
    kind: 'demolish', type: b.type, z: b.z, born: b.born, at: [b.cells[0]![0], b.cells[0]![1], b.z],
  });
}

export function rename(state: GameState, name: string): GameState {
  const next = clone(state);
  next.name = name.trim() || state.name;
  return next;
}

/** Structural sanity: drop buildings that overlap or float (used when loading foreign data). */
export function sanitizeBuildings(size: number, buildings: Building[]): Building[] {
  const sorted = [...buildings].sort((a, b) => a.z - b.z || a.id - b.id);
  const kept: Building[] = [];
  for (const b of sorted) {
    const world = new World(size, kept);
    const ok = b.cells.every(
      ([x, y]) => world.inBounds(x, y) && world.at(x, y, b.z) < 0 && (b.z === 0 || world.at(x, y, b.z - 1) >= 0),
    );
    if (ok) kept.push(b);
  }
  return kept;
}
