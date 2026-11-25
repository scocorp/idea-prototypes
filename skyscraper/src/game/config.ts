// Tunables. Rules live in tiles.ts / evaluate.ts; the numbers that shape how the rules feel live here.

/** Hard ceiling on levels (z). Level 0 is the ground ("G"). */
export const MAX_LEVELS = 40;
export const GRID_SIZES = [8, 12, 16, 20] as const;
export const DEFAULT_GRID_SIZE = 16;

/**
 * How far daylight reaches in from an open side, in tiles (Manhattan, same level).
 * 1 = only facade tiles get side light. 2 = facade tiles and the ring just inside them.
 */
export const SIDE_LIGHT_DEPTH = 1;

/** Lift access radius (Chebyshev, same level). */
export const LIFT_RANGE = 3;

/** Level at which the tower passes through the cloud deck. */
export const CLOUD_LEVEL = 16;

/** Intrinsic appeal of a cell, added on top of what nearby buildings emit. */
export const APPEAL = {
  levelsPerPoint: 4, // +1 appeal per this many levels of height
  sky: 1, // open sky above
  dark: -1, // no natural light at all
  clouds: 2, // at or above CLOUD_LEVEL
};

/** A neighbour tower's floors are split into strata by fraction of its height. */
export const STRATA = { under: 0.4, mid: 0.8 };

export const BRIDGE = {
  underLaborBase: 4,
  underLaborPerTenFloors: 1,
  midFood: 3,
  midGoods: 3,
  overSkill: 3,
  overPrestigePerFourFloors: 1,
  overAppeal: 3,
};

export const UNDO_LIMIT = 200;
export const CHRONICLE_LIMIT = 400;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dateLabel(month: number): string {
  return `Y${1 + Math.floor(month / 12)} ${MONTHS[month % 12]}`;
}
