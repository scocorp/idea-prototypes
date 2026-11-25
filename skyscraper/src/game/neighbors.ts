// The towers around our plot. They are never built by the player; they exist to be bridged to.
// Two per side, each facing one half of that edge.

import { uniqueTowerName } from './names.ts';
import { hash32, mulberry32, shuffle } from './rng.ts';
import type { Neighbor, Side } from './types.ts';

const BASE_HEIGHTS = [7, 10, 14, 19, 26, 34, 44, 58];

export function makeNeighbors(seed: number, size: number, ownName: string): Neighbor[] {
  const rand = mulberry32(hash32(seed, 0x6e6562));
  const heights = shuffle(rand, [...BASE_HEIGHTS]).map((h) => h + Math.floor(rand() * 3) - 1);
  const used = new Set<string>([ownName]);
  const out: Neighbor[] = [];
  let k = 0;
  for (const side of ['n', 'e', 's', 'w'] as Side[]) {
    for (const half of [0, 1] as const) {
      out.push({
        side,
        half,
        name: uniqueTowerName(rand, used),
        height: heights[k++]!,
        width: Math.max(3, Math.round((size / 2) * (0.55 + rand() * 0.35))),
        depth: 4 + Math.floor(rand() * 6),
        gap: 5 + Math.floor(rand() * 4),
        shift: rand() * 2 - 1,
        hue: rand(),
      });
    }
  }
  return out;
}
