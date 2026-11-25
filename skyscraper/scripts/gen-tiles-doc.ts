// Prints doc/tiles.md from the tile catalogue so the reference never drifts from the code.
// Usage: npm run docs

import { SHAPE_LABEL } from '../src/game/shapes.ts';
import { describeNeeds, describeOutputs, describePlacement, ERAS, TILE_LIST } from '../src/game/tiles.ts';

const lines: string[] = [
  '# Tile reference',
  '',
  'Generated from `src/game/tiles.ts` by `npm run docs`. Do not edit by hand.',
  '',
];

for (const era of ERAS) {
  const tiles = TILE_LIST.filter((t) => t.era === era.n);
  const goal = era.parts.length ? era.parts.map((p) => `${p.label} ≥ ${p.target}`).join(', ') : 'start';
  lines.push(`## Era ${era.n}: ${era.name}`, '', `Unlocked by: ${goal}.`, '');
  lines.push('| Tile | Shape | Placement | Needs | Provides |', '|---|---|---|---|---|');
  for (const t of tiles) {
    const cell = (a: string[]) => (a.length ? a.join('<br>') : '–');
    lines.push(`| **${t.name}** (\`${t.id}\`) | ${SHAPE_LABEL[t.shape]} | ${cell(describePlacement(t))} | ${cell(describeNeeds(t))} | ${cell(describeOutputs(t))} |`);
  }
  lines.push('');
}

process.stdout.write(lines.join('\n'));
