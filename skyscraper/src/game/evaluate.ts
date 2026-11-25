// Static evaluation of the whole tower: which buildings operate, and why not.
//
// There is no clock. After every edit the tower is solved to a self-consistent equilibrium:
//   1. Light is structural: open sky = top of its column; side light = an open face nearby.
//   2. Fields (water, drain, heat, lift, lamp, piped sun, appeal) are stamped by *active* emitters.
//      Relays (pumps, water towers, light pipes, lift shafts) only emit when fed, so every chain
//      must start at a real source (least fixed point; no phantom loops).
//   3. Pools (labor, skill, food, power, goods) are allocated in priority order: higher floors
//      first. When something runs short, the undercity goes without first.
// Phase A starts with everything active and switches off failures until stable (monotone).
// Phase B then greedily switches back on anything that now fits, which undoes over-eager
// cascades from Phase A. Negative appeal is counted for every *built* building (a cold boiler is
// still an eyesore), which keeps appeal monotone and both phases sound.

import { APPEAL, BRIDGE, CLOUD_LEVEL, LIFT_RANGE, MAX_LEVELS, SIDE_LIGHT_DEPTH, STRATA } from './config.ts';
import { RESOURCE_INFO, TILES } from './tiles.ts';
import {
  FIELDS,
  RESOURCES,
  type Building,
  type Emission,
  type Field,
  type GameState,
  type LightNeed,
  type Neighbor,
  type Resource,
  type Stats,
  type TileDef,
} from './types.ts';
import { World } from './world.ts';

export const L_SKY = 1;
export const L_SIDE = 2;
export const L_PIPE = 4;
export const L_LAMP = 8;

export type Stratum = 'under' | 'mid' | 'over';

export interface BridgeLink {
  neighbor: Neighbor;
  /** Their level at our bridge height (bridges are level), or null if above their roof. */
  stratum: Stratum | null;
}

export type ReasonCode =
  | 'light'
  | 'water'
  | 'drain'
  | 'heat'
  | 'lift'
  | 'appeal'
  | 'relay'
  | 'bridge'
  | `short:${Resource}`;

export interface Reason {
  code: ReasonCode;
  text: string;
}

export interface Evaluation {
  world: World;
  defs: TileDef[];
  /** Per building index (same order as state.buildings). */
  active: Uint8Array;
  reasons: Reason[][];
  appeal: Float32Array;
  prestige: Float32Array;
  makes: Partial<Record<Resource, number>>[];
  bridges: (BridgeLink | null)[];
  /** Per cell: light bitmask (L_SKY/L_SIDE for occupied cells, L_PIPE/L_LAMP anywhere). */
  light: Uint8Array;
  /** Per cell coverage, from the final active set. */
  fields: Record<Field, Uint8Array>;
  /** Per cell total appeal (intrinsic + emitted). */
  appealCell: Float32Array;
  stats: Stats;
  byId: Map<number, number>;
}

const zeroRes = (): Record<Resource, number> => ({ labor: 0, skill: 0, food: 0, power: 0, goods: 0 });

export function cellIndex(n: number, x: number, y: number, z: number): number {
  return (z * n + y) * n + x;
}

/** Which neighbour a perimeter cell faces (null for interior cells and corners). */
export function neighborFor(state: GameState, x: number, y: number): Neighbor | null {
  const n = state.size;
  const ex = x === 0 || x === n - 1;
  const ey = y === 0 || y === n - 1;
  if (ex === ey) return null;
  const side = x === 0 ? 'w' : x === n - 1 ? 'e' : y === 0 ? 'n' : 's';
  const along = ex ? y : x;
  const half = along < n / 2 ? 0 : 1;
  return state.neighbors.find((nb) => nb.side === side && nb.half === half) ?? null;
}

export function stratumAt(nb: Neighbor, z: number): Stratum | null {
  if (z >= nb.height) return null;
  const f = z / nb.height;
  return f < STRATA.under ? 'under' : f < STRATA.mid ? 'mid' : 'over';
}

export function bridgeMakes(nb: Neighbor, s: Stratum): Partial<Record<Resource, number>> {
  if (s === 'under') return { labor: BRIDGE.underLaborBase + Math.floor(nb.height / 10) * BRIDGE.underLaborPerTenFloors };
  if (s === 'mid') return { food: BRIDGE.midFood, goods: BRIDGE.midGoods };
  return { skill: BRIDGE.overSkill };
}

export function bridgePrestige(nb: Neighbor, s: Stratum): number {
  return s === 'over' ? Math.floor(nb.height / 4) * BRIDGE.overPrestigePerFourFloors : 0;
}

function meetsLight(need: LightNeed, l: number): boolean {
  if (need === 'sky') return (l & L_SKY) !== 0;
  if (need === 'window') return (l & (L_SKY | L_SIDE | L_PIPE)) !== 0;
  return (l & (L_SKY | L_PIPE | L_LAMP)) !== 0;
}

export function evaluate(state: GameState): Evaluation {
  const n = state.size;
  const B = state.buildings;
  const NB = B.length;
  const world = new World(n, B);
  const defs = B.map((b) => TILES[b.type]!);
  const NC = n * n * MAX_LEVELS;
  const idx = (x: number, y: number, z: number) => (z * n + y) * n + x;
  const byId = new Map<number, number>();
  B.forEach((b, i) => byId.set(b.id, i));

  // ── Structural light ─────────────────────────────────────────────────────
  const light = new Uint8Array(NC);
  const openAt = (x: number, y: number, z: number) => !world.inBounds(x, y) || world.at(x, y, z) < 0;
  for (const b of B) {
    for (const [x, y] of b.cells) {
      let l = 0;
      if (world.at(x, y, b.z + 1) < 0) l |= L_SKY;
      search: for (let dy = -SIDE_LIGHT_DEPTH; dy <= SIDE_LIGHT_DEPTH; dy++) {
        for (let dx = -SIDE_LIGHT_DEPTH; dx <= SIDE_LIGHT_DEPTH; dx++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d === 0 || d > SIDE_LIGHT_DEPTH) continue;
          if (openAt(x + dx, y + dy, b.z)) {
            l |= L_SIDE;
            break search;
          }
        }
      }
      light[idx(x, y, b.z)] = l;
    }
  }

  // ── Stamping helpers ─────────────────────────────────────────────────────
  function forEachCellInRange(b: Building, e: Emission, fn: (c: number) => void) {
    const z0 = Math.max(0, b.z + e.dz[0]);
    const z1 = Math.min(MAX_LEVELS - 1, b.z + e.dz[1]);
    if (z0 > z1) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of b.cells) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const x0 = Math.max(0, minX - e.r), x1 = Math.min(n - 1, maxX + e.r);
    const y0 = Math.max(0, minY - e.r), y1 = Math.min(n - 1, maxY + e.r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let near = false;
        for (const [cx, cy] of b.cells) {
          if (Math.max(Math.abs(cx - x), Math.abs(cy - y)) <= e.r) { near = true; break; }
        }
        if (!near) continue;
        for (let z = z0; z <= z1; z++) fn(idx(x, y, z));
      }
    }
  }

  // Nuisances count for every built building, operating or not.
  const appealNeg = new Float32Array(NC);
  B.forEach((b, i) => {
    for (const e of defs[i]!.emits ?? []) {
      if (e.field === 'appeal' && (e.value ?? 0) < 0) forEachCellInRange(b, e, (c) => (appealNeg[c] += e.value!));
    }
  });

  const intrinsicAppeal = (x: number, y: number, z: number, occupied: boolean) => {
    let a = Math.floor(z / APPEAL.levelsPerPoint);
    if (z >= CLOUD_LEVEL) a += APPEAL.clouds;
    if (occupied) {
      const l = light[idx(x, y, z)]!;
      if (l & L_SKY) a += APPEAL.sky;
      else if (!(l & L_SIDE)) a += APPEAL.dark;
    }
    return a;
  };

  // ── Bridges ──────────────────────────────────────────────────────────────
  const bridges: (BridgeLink | null)[] = B.map((b, i) => {
    if (defs[i]!.special !== 'bridge') return null;
    const [x, y] = b.cells[0]!;
    const nb = neighborFor(state, x, y);
    return nb ? { neighbor: nb, stratum: stratumAt(nb, b.z) } : null;
  });
  const makesOf = (i: number): Partial<Record<Resource, number>> => {
    if (defs[i]!.special === 'bridge') {
      const link = bridges[i];
      return link?.stratum ? bridgeMakes(link.neighbor, link.stratum) : {};
    }
    return defs[i]!.makes ?? {};
  };
  const poolOf = (i: number) => defs[i]!.needs.pool ?? {};

  // Higher floors first; then fancier eras; then seniority.
  const prio = [...Array(NB).keys()].sort(
    (a, b) => B[b]!.z - B[a]!.z || defs[b]!.era - defs[a]!.era || B[a]!.id - B[b]!.id,
  );
  const rank = new Int32Array(NB);
  prio.forEach((i, r) => (rank[i] = r));

  // ── Fields from the current active set ───────────────────────────────────
  const active = new Uint8Array(NB).fill(1);
  const fields = Object.fromEntries(FIELDS.map((f) => [f, new Uint8Array(NC)])) as Record<Field, Uint8Array>;
  const appealPos = new Float32Array(NC);
  const fed = new Uint8Array(NB);
  const lifts = prio.filter((i) => defs[i]!.relay === 'lift').reverse(); // bottom-up
  const pipes = prio.filter((i) => defs[i]!.relay === 'pipe'); // top-down
  const pumps = prio.filter((i) => defs[i]!.relay === 'water');

  const emit = (i: number) => {
    for (const e of defs[i]!.emits ?? []) {
      if (e.field === 'appeal') {
        if ((e.value ?? 0) > 0) forEachCellInRange(B[i]!, e, (c) => (appealPos[c] += e.value!));
      } else {
        const f = fields[e.field];
        forEachCellInRange(B[i]!, e, (c) => (f[c] = 1));
      }
    }
  };

  const relayInput = (i: number): boolean => {
    const b = B[i]!;
    const d = defs[i]!;
    if (d.relay === 'lift') {
      if (b.z === 0) return true;
      const [x, y] = b.cells[0]!;
      const below = world.at(x, y, b.z - 1);
      return below >= 0 && defs[below]!.relay === 'lift' && fed[below] === 1;
    }
    if (d.relay === 'pipe') {
      return b.cells.some(([x, y]) => (light[idx(x, y, b.z)]! & L_SKY) !== 0 || fields.pipe[idx(x, y, b.z)] === 1);
    }
    return b.cells.some(([x, y]) => fields.water[idx(x, y, b.z)] === 1);
  };

  function computeFields() {
    for (const f of FIELDS) fields[f].fill(0);
    appealPos.fill(0);
    fed.fill(0);
    for (let i = 0; i < NB; i++) if (active[i] && !defs[i]!.relay) emit(i);
    for (const i of lifts) {
      if (active[i] && relayInput(i)) { fed[i] = 1; emit(i); }
    }
    for (const group of [pipes, pumps]) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const i of group) {
          if (active[i] && !fed[i] && relayInput(i)) { fed[i] = 1; emit(i); changed = true; }
        }
      }
    }
  }

  const buildingAppeal = (i: number): number => {
    const b = B[i]!;
    let s = 0;
    for (const [x, y] of b.cells) {
      const c = idx(x, y, b.z);
      s += appealPos[c]! + appealNeg[c]! + intrinsicAppeal(x, y, b.z, true);
    }
    return s / b.cells.length;
  };

  const coverName = (b: Building): string => {
    for (const [x, y] of b.cells) {
      const above = world.at(x, y, b.z + 1);
      if (above >= 0) return `${TILES[B[above]!.type]!.name} above`;
    }
    return '';
  };

  function localFailures(i: number): Reason[] {
    const d = defs[i]!;
    const b = B[i]!;
    const need = d.needs;
    const out: Reason[] = [];
    const cs = b.cells.map(([x, y]) => idx(x, y, b.z));
    if (need.light) {
      const ok = cs.every((c) => meetsLight(need.light!, light[c]! | (fields.pipe[c] ? L_PIPE : 0) | (fields.lamp[c] ? L_LAMP : 0)));
      if (!ok) {
        const cover = coverName(b);
        const text =
          need.light === 'sky'
            ? `Needs open sky${cover ? ` (${cover})` : ''}`
            : need.light === 'window'
              ? 'Needs a window on every part: an open side, open sky or piped sun'
              : `Needs sun, a Light Pipe or a Grow Lamp${cover ? ` (${cover})` : ''}`;
        out.push({ code: 'light', text });
      }
    }
    if (need.water && !cs.some((c) => fields.water[c])) {
      out.push({ code: 'water', text: 'No water: needs a Well, Rain Catcher, Pump or Water Tower in range' });
    }
    if (need.drain && !cs.some((c) => fields.drain[c])) {
      out.push({ code: 'drain', text: 'No drain: needs a Cesspit or Sewage Works below' });
    }
    if (need.heat && !cs.some((c) => fields.heat[c])) {
      out.push({ code: 'heat', text: 'No heat: needs a Boiler, Foundry or Geothermal Bore beneath' });
    }
    const liftNeeded = need.lift === true || (typeof need.lift === 'number' && b.z >= need.lift);
    if (liftNeeded && !cs.some((c) => fields.lift[c])) {
      out.push({ code: 'lift', text: `No lift within ${LIFT_RANGE} tiles` });
    }
    if (need.appeal !== undefined) {
      const a = buildingAppeal(i);
      if (a < need.appeal) out.push({ code: 'appeal', text: `Appeal ${fmt(a)}, needs ${need.appeal}` });
    }
    if (d.relay && !(active[i] ? fed[i] : relayInput(i))) {
      const text =
        d.relay === 'lift'
          ? 'Shaft broken: needs a working Lift directly below'
          : d.relay === 'pipe'
            ? 'No light to channel: needs open sky or a Light Pipe above'
            : 'Dry: needs water reaching this spot to pump or store';
      out.push({ code: 'relay', text });
    }
    if (d.special === 'bridge') {
      const link = bridges[i];
      if (!link) out.push({ code: 'bridge', text: 'No neighbouring tower faces this edge' });
      else if (!link.stratum) {
        out.push({ code: 'bridge', text: `Above ${link.neighbor.name}'s roof (they have ${link.neighbor.height} floors)` });
      } else {
        for (let j = 0; j < NB; j++) {
          if (j === i || !active[j] || bridges[j]?.neighbor !== link.neighbor) continue;
          if (!active[i] || rank[j]! < rank[i]!) {
            out.push({ code: 'bridge', text: `${link.neighbor.name} is already linked by another bridge` });
            break;
          }
        }
        if (link.stratum === 'over') {
          if (!cs.some((c) => fields.lift[c])) out.push({ code: 'lift', text: 'Their elites expect a lift at the bridge' });
          const a = buildingAppeal(i);
          if (a < BRIDGE.overAppeal) out.push({ code: 'appeal', text: `Their elites expect appeal ${BRIDGE.overAppeal} (here: ${fmt(a)})` });
        }
      }
    }
    return out;
  }

  const shortReason = (r: Resource): Reason => ({
    code: `short:${r}`,
    text: `${RESOURCE_INFO[r].label} shortage (higher floors are supplied first)`,
  });

  // ── Phase A: switch off failures until stable ────────────────────────────
  const reasons: Reason[][] = B.map(() => []);
  for (let iter = 0; iter < 500; iter++) {
    computeFields();
    let changed = false;
    for (let i = 0; i < NB; i++) {
      if (!active[i]) continue;
      const f = localFailures(i);
      if (f.length) { active[i] = 0; reasons[i] = f; changed = true; }
    }
    const supply = zeroRes();
    for (let i = 0; i < NB; i++) if (active[i]) addTo(supply, makesOf(i), 1);
    for (const i of prio) {
      if (!active[i]) continue;
      const need = poolOf(i);
      const lacking = RESOURCES.filter((r) => (need[r] ?? 0) > supply[r] + 1e-9);
      if (lacking.length) { active[i] = 0; reasons[i] = lacking.map(shortReason); changed = true; }
      else addTo(supply, need, -1);
    }
    if (!changed) break;
  }

  // ── Phase B: switch back on whatever now fits ────────────────────────────
  for (let iter = 0; iter < 500; iter++) {
    computeFields();
    const slack = zeroRes();
    for (let i = 0; i < NB; i++) {
      if (!active[i]) continue;
      addTo(slack, makesOf(i), 1);
      addTo(slack, poolOf(i), -1);
    }
    let any = false;
    for (const i of prio) {
      if (active[i] || localFailures(i).length) continue;
      const need = poolOf(i);
      if (RESOURCES.some((r) => (need[r] ?? 0) > slack[r] + 1e-9)) continue;
      active[i] = 1;
      addTo(slack, need, -1);
      addTo(slack, makesOf(i), 1);
      any = true;
    }
    if (!any) break;
  }

  // ── Final: fields, reasons, stats ────────────────────────────────────────
  computeFields();
  const slack = zeroRes();
  for (let i = 0; i < NB; i++) {
    if (!active[i]) continue;
    addTo(slack, makesOf(i), 1);
    addTo(slack, poolOf(i), -1);
  }
  const stats: Stats = {
    pop: { laborer: 0, citizen: 0, elite: 0 },
    made: zeroRes(),
    used: zeroRes(),
    short: zeroRes(),
    prestige: 0,
    maxActiveZ: -1,
    maxZ: -1,
    activeCount: {},
    builtCount: {},
    total: NB,
    inactive: 0,
    bridges: 0,
  };
  const appeal = new Float32Array(NB);
  const prestige = new Float32Array(NB);
  const makes: Partial<Record<Resource, number>>[] = [];
  for (let i = 0; i < NB; i++) {
    const d = defs[i]!;
    const b = B[i]!;
    appeal[i] = buildingAppeal(i);
    stats.builtCount[d.id] = (stats.builtCount[d.id] ?? 0) + 1;
    stats.maxZ = Math.max(stats.maxZ, b.z);
    if (active[i]) {
      reasons[i] = [];
      const mk = makesOf(i);
      makes.push(mk);
      addTo(stats.made, mk, 1);
      addTo(stats.used, poolOf(i), 1);
      stats.activeCount[d.id] = (stats.activeCount[d.id] ?? 0) + 1;
      stats.maxActiveZ = Math.max(stats.maxActiveZ, b.z);
      if (d.residents) stats.pop[d.residents.cls] += d.residents.n;
      let p = 0;
      if (d.prestige) {
        p = d.prestige.base;
        if (d.prestige.perAppeal) p += d.prestige.perAppeal * Math.max(0, appeal[i]! - (d.needs.appeal ?? 0));
        if (d.prestige.perLevel) p += d.prestige.perLevel * b.z;
      }
      const link = bridges[i];
      if (link?.stratum) {
        p += bridgePrestige(link.neighbor, link.stratum);
        stats.bridges++;
      }
      prestige[i] = Math.floor(p);
      stats.prestige += prestige[i]!;
    } else {
      makes.push({});
      stats.inactive++;
      const f = localFailures(i);
      if (f.length) reasons[i] = f;
      else {
        const need = poolOf(i);
        const lacking = RESOURCES.filter((r) => (need[r] ?? 0) > slack[r] + 1e-9);
        reasons[i] = lacking.length ? lacking.map(shortReason) : [{ code: 'relay', text: 'Idle' }];
      }
      for (const r of reasons[i]!) if (r.code.startsWith('short:')) stats.short[r.code.slice(6) as Resource]++;
    }
  }

  // Per-cell light and appeal for lenses and previews.
  const appealCell = new Float32Array(NC);
  for (let z = 0; z < MAX_LEVELS; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const c = idx(x, y, z);
        if (fields.pipe[c]) light[c] |= L_PIPE;
        if (fields.lamp[c]) light[c] |= L_LAMP;
        appealCell[c] = appealPos[c]! + appealNeg[c]! + intrinsicAppeal(x, y, z, world.occ[c] !== 0);
      }
    }
  }

  return { world, defs, active, reasons, appeal, prestige, makes, bridges, light, fields, appealCell, stats, byId };
}

function addTo(acc: Record<Resource, number>, v: Partial<Record<Resource, number>>, sign: number) {
  for (const r of RESOURCES) acc[r] += sign * (v[r] ?? 0);
}

export function fmt(a: number): string {
  return Number.isInteger(a) ? String(a) : a.toFixed(1);
}
