// Persistence: localStorage autosave plus JSON import/export. Saves are the GameState verbatim.

import { GRID_SIZES } from './config.ts';
import { makeNeighbors } from './neighbors.ts';
import { makeBuilding, sanitizeBuildings } from './state.ts';
import { TILES } from './tiles.ts';
import type { Building, ChronicleEntry, GameState } from './types.ts';

const KEY = 'skyscraper.save.v1';

export function saveLocal(state: GameState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function loadLocal(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? deserialize(raw) : null;
  } catch {
    return null;
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

/** Parse and validate a save. Throws with a readable message if it is unusable. */
export function deserialize(text: string): GameState {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('Not a JSON file');
  }
  if (!o || typeof o !== 'object' || o.v !== 1) throw new Error('Not a Skyscraper save (version 1)');
  const size = o.size as number;
  if (!(GRID_SIZES as readonly number[]).includes(size)) throw new Error(`Unsupported plot size: ${String(o.size)}`);
  const seed = int(o.seed, 0, 0xffffffff) ?? 1;
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, 60) : 'Unnamed Tower';
  const month = int(o.month, 0, 1e7) ?? 0;

  const rawBuildings = Array.isArray(o.buildings) ? (o.buildings as Record<string, unknown>[]) : [];
  const buildings: Building[] = [];
  let maxId = 0;
  for (const rb of rawBuildings) {
    if (!rb || typeof rb !== 'object' || typeof rb.type !== 'string' || !TILES[rb.type]) continue;
    const id = int(rb.id, 1, 1e9);
    const x = int(rb.x, 0, size - 1);
    const y = int(rb.y, 0, size - 1);
    const z = int(rb.z, 0, 1000);
    const rot = int(rb.rot, 0, 3) ?? 0;
    if (id === null || x === null || y === null || z === null) continue;
    const b = makeBuilding(id, rb.type, x, y, z, rot, rb.flip === true, int(rb.born, 0, 1e7) ?? 0);
    if (Array.isArray(rb.log)) b.log = (rb.log as Building['log']).filter((e) => e && typeof e.m === 'number').slice(-40);
    buildings.push(b);
    maxId = Math.max(maxId, id);
  }

  const unlocked = Array.isArray(o.unlocked) ? (o.unlocked as unknown[]).filter((u): u is string => typeof u === 'string' && !!TILES[u]) : [];
  const chronicle = Array.isArray(o.chronicle)
    ? (o.chronicle as ChronicleEntry[]).filter((e) => e && typeof e.text === 'string' && typeof e.m === 'number')
    : [];
  const neighbors = Array.isArray(o.neighbors) && o.neighbors.length === 8 ? (o.neighbors as GameState['neighbors']) : makeNeighbors(seed, size, name);

  return {
    v: 1,
    name,
    seed,
    size,
    month,
    nextId: Math.max(maxId + 1, int(o.nextId, 1, 1e9) ?? 1),
    buildings: sanitizeBuildings(size, buildings),
    era: int(o.era, 1, 99) ?? 1,
    unlocked: unlocked.length ? unlocked : ['shanty', 'allotment', 'well'],
    sandbox: o.sandbox === true,
    neighbors,
    chronicle,
    flags: Array.isArray(o.flags) ? (o.flags as unknown[]).filter((f): f is string => typeof f === 'string') : [],
  };
}
