// Flat polyomino footprints. Every building occupies cells on a single level.
// (0,0) is the anchor cell: the cell under the cursor when placing.

export type Cell2 = readonly [number, number];

export const SHAPES = {
  I1: [[0, 0]],
  I2: [[0, 0], [1, 0]],
  I3: [[-1, 0], [0, 0], [1, 0]],
  L3: [[0, 0], [1, 0], [0, 1]],
  O4: [[0, 0], [1, 0], [0, 1], [1, 1]],
} as const satisfies Record<string, readonly Cell2[]>;

export type ShapeId = keyof typeof SHAPES;

export const SHAPE_LABEL: Record<ShapeId, string> = {
  I1: '1×1',
  I2: '1×2',
  I3: '1×3',
  L3: 'L',
  O4: '2×2',
};

/** Rotate (90° steps, counter-clockwise in grid space) then optionally mirror. */
export function transformShape(shape: readonly Cell2[], rot: number, flip: boolean): [number, number][] {
  const r = ((rot % 4) + 4) % 4;
  return shape.map(([x0, y0]) => {
    let x: number = flip ? -x0 : x0;
    let y: number = y0;
    for (let i = 0; i < r; i++) {
      const t = x;
      x = -y;
      y = t;
    }
    return [x + 0, y + 0]; // +0 normalises -0
  });
}

export function footprint(shape: ShapeId, ax: number, ay: number, rot: number, flip: boolean): [number, number][] {
  return transformShape(SHAPES[shape], rot, flip).map(([x, y]) => [ax + x, ay + y]);
}
