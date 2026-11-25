// Emergent storytelling: diff the tower before/after each edit and narrate what changed.
// Also appends to each building's personal log (shown in the inspector).

import { CLOUD_LEVEL } from './config.ts';
import { bridgeMakes, bridgePrestige, L_SKY, type Evaluation, type Stratum } from './evaluate.ts';
import { plural } from './names.ts';
import { hash32, mulberry32, pick } from './rng.ts';
import { TILES } from './tiles.ts';
import type { Building, ChronicleEntry, GameState } from './types.ts';

export type Action =
  | { kind: 'place'; id: number }
  | { kind: 'demolish'; type: string; z: number; born: number; at: [number, number, number] };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function describeGroup(bs: Building[]): string {
  const byType = new Map<string, Building[]>();
  for (const b of bs) {
    const list = byType.get(b.type) ?? [];
    list.push(b);
    byType.set(b.type, list);
  }
  return joinList(
    [...byType.entries()].map(([type, list]) => {
      const name = TILES[type]!.name;
      const zs = list.map((b) => b.z);
      const lo = Math.min(...zs);
      const hi = Math.max(...zs);
      const where = lo === hi ? `L${lo}` : `L${lo}–L${hi}`;
      return list.length === 1 ? `the ${name} on ${where}` : `${list.length} ${plural(name, list.length)} on ${where}`;
    }),
  );
}

function sunlit(ev: Evaluation, b: Building): boolean {
  const n = ev.world.n;
  return b.cells.some(([x, y]) => (ev.light[(b.z * n + y) * n + x]! & L_SKY) !== 0);
}

const STRATUM_LABEL: Record<Stratum, string> = { under: 'undercity', mid: 'middle floors', over: 'elite levels' };

const FIRST: Record<string, (z: number) => string> = {
  shanty: () => 'Settlers raise the first Shanty on the empty lot.',
  allotment: () => 'The first Allotment is dug. Beans by summer.',
  well: () => 'A Well is dug. The water is cold and clean.',
  tenement: (z) => `The first Tenement goes up on L${z}, ten to a floor.`,
  cesspit: () => 'A Cesspit is dug. Nobody speaks of it.',
  raincatcher: (z) => `Barrels and funnels on L${z}: the first Rain Catcher.`,
  apartment: (z) => `Citizens arrive: the first Apartment on L${z}, with a window in every room.`,
  boiler: (z) => `The Boiler House on L${z} is lit. Smoke climbs the facade.`,
  lift: () => 'The first Lift shaft is sunk. Stairs are for other people now.',
  lightpipe: (z) => `A Light Pipe on L${z} carries the sun down into the dark.`,
  penthouse: (z) => `The first Penthouse on L${z}. Its residents will want for nothing; someone below will see to that.`,
  skyvilla: (z) => `A Sky Villa on L${z}. The tower has a summit worth the name.`,
  spire: (z) => `The Spire is raised on L${z}. Across the city, people look up.`,
  capsule: () => 'The first Capsule Stack. Twelve people sleep where four used to.',
};

const LOST_SUN = [
  (what: string, by: string) => `${cap(what)} lost the sun beneath the new ${by}.`,
  (what: string, by: string) => `The new ${by} casts ${what} into shadow.`,
  (what: string, by: string) => `${cap(what)} will not see the sky again: a ${by} now stands above.`,
];

const STOPPED: Record<string, (list: string) => string> = {
  'short:food': (l) => `Food ran short: ${l} went hungry. The upper floors ate first.`,
  'short:labor': (l) => `Not enough hands: ${l} fell idle.`,
  'short:skill': (l) => `Not enough skilled workers: ${l} shut.`,
  'short:power': (l) => `Brownout: ${l} lost power.`,
  'short:goods': (l) => `Goods ran out before they reached ${l}.`,
  water: (l) => `${cap(l)} ran dry.`,
  drain: (l) => `${cap(l)} backed up with nowhere to drain.`,
  light: (l) => `${cap(l)} went dark.`,
  heat: (l) => `${cap(l)} went cold.`,
  lift: (l) => `${cap(l)} lost lift access.`,
  appeal: (l) => `${cap(l)} lost its appeal; the residents moved out.`,
  relay: (l) => `${cap(l)} stopped working.`,
  bridge: (l) => `${cap(l)} lost its link.`,
  adjacent: (l) => `${cap(l)} lost the neighbours it depends on.`,
};

const firstCell = (b: Building): [number, number, number] => [b.cells[0]![0], b.cells[0]![1], b.z];

/** Narrate the change from (prevState, prev) to (state, ev). Mutates building logs and flags in `state`. */
export function chronicleDiff(
  prevState: GameState,
  prev: Evaluation,
  state: GameState,
  ev: Evaluation,
  action: Action,
): ChronicleEntry[] {
  const m = state.month;
  const rand = mulberry32(hash32(state.seed, m, 0xc4));
  const out: ChronicleEntry[] = [];
  const flags = new Set(state.flags);
  const flag = (f: string) => {
    if (flags.has(f)) return false;
    flags.add(f);
    return true;
  };

  const newIdx = action.kind === 'place' ? ev.byId.get(action.id) : undefined;
  const newB = newIdx !== undefined ? state.buildings[newIdx] : undefined;

  if (newB && newIdx !== undefined) {
    const d = TILES[newB.type]!;
    if (flag(`first:${newB.type}`)) {
      const f = FIRST[newB.type];
      out.push({ m, kind: 'build', text: f ? f(newB.z) : `The first ${d.name} goes up on L${newB.z}.`, at: firstCell(newB) });
    }
    if (!ev.active[newIdx]) newB.log.push({ m, t: 'stopped', why: ev.reasons[newIdx]![0]?.text });
  } else if (action.kind === 'demolish') {
    const years = Math.floor((m - action.born) / 12);
    if (years >= 2) {
      out.push({ m, kind: 'info', text: `The ${TILES[action.type]!.name} on L${action.z} came down after ${years} years.`, at: action.at });
    }
  }

  const lostSun: Building[] = [];
  const stopped = new Map<string, Building[]>();
  const started: Building[] = [];
  const bridgesUp: number[] = [];
  state.buildings.forEach((b, i) => {
    if (b === newB) {
      if (ev.active[i] && ev.bridges[i]?.stratum) bridgesUp.push(i);
      return;
    }
    const pi = prev.byId.get(b.id);
    if (pi === undefined) return;
    const pb = prevState.buildings[pi]!;
    const wasSun = sunlit(prev, pb);
    const isSun = sunlit(ev, b);
    if (wasSun && !isSun) {
      if (TILES[b.type]!.needs.light) lostSun.push(b);
      b.log.push({ m, t: 'sun-lost' });
    } else if (!wasSun && isSun) {
      b.log.push({ m, t: 'sun-back' });
    }
    const wasOn = prev.active[pi] === 1;
    const isOn = ev.active[i] === 1;
    if (wasOn && !isOn) {
      const r = ev.reasons[i]![0];
      b.log.push({ m, t: 'stopped', why: r?.text });
      const key = r?.code ?? 'relay';
      const list = stopped.get(key) ?? [];
      list.push(b);
      stopped.set(key, list);
    } else if (!wasOn && isOn) {
      b.log.push({ m, t: 'started' });
      started.push(b);
      if (ev.bridges[i]?.stratum) bridgesUp.push(i);
    }
  });

  if (lostSun.length) {
    const by = newB ? TILES[newB.type]!.name : 'construction';
    out.push({ m, kind: 'loss', text: pick(rand, LOST_SUN)(describeGroup(lostSun), by), at: firstCell(lostSun[0]!) });
  }
  for (const [code, list] of stopped) {
    const rest = code === 'light' ? list.filter((b) => !lostSun.includes(b)) : list;
    if (!rest.length) continue;
    const f = STOPPED[code] ?? STOPPED.relay!;
    out.push({ m, kind: code.startsWith('short:') ? 'shortage' : 'loss', text: f(describeGroup(rest)), at: firstCell(rest[0]!) });
  }
  if (started.length) {
    out.push({
      m, kind: 'info',
      text: `${cap(describeGroup(started))} ${started.length > 1 ? 'are' : 'is'} up and running.`,
      at: firstCell(started[0]!),
    });
  }
  for (const i of bridgesUp) {
    const b = state.buildings[i]!;
    const link = ev.bridges[i]!;
    const s = link.stratum!;
    const mk = bridgeMakes(link.neighbor, s);
    const effect =
      s === 'under'
        ? `${mk.labor} Labor commute in`
        : s === 'mid'
          ? `${mk.food} Food and ${mk.goods} Goods in trade`
          : `${mk.skill} Skill and ${bridgePrestige(link.neighbor, s)} Prestige`;
    out.push({
      m, kind: 'bridge',
      text: `A skybridge on L${b.z} now reaches ${link.neighbor.name}'s ${STRATUM_LABEL[s]} (their L${b.z} of ${link.neighbor.height}): ${effect}.`,
      at: firstCell(b),
    });
  }

  const s = ev.stats;
  for (const k of [5, 10, 15, 20, 25, 30, 35]) {
    if (s.maxActiveZ >= k && flag(`height:${k}`)) out.push({ m, kind: 'milestone', text: `The tower now stands ${k + 1} storeys tall.` });
  }
  if (s.maxActiveZ >= CLOUD_LEVEL && flag('clouds')) {
    out.push({ m, kind: 'milestone', text: 'The tower pierces the cloud deck. Up here the sun always shines; below, it rains on everyone else.' });
  }
  const pop = s.pop.laborer + s.pop.citizen + s.pop.elite;
  for (const k of [25, 50, 100, 200, 400, 800, 1600]) {
    if (pop >= k && flag(`pop:${k}`)) {
      out.push({ m, kind: 'milestone', text: `Population passes ${k}: ${s.pop.laborer} laborers, ${s.pop.citizen} citizens, ${s.pop.elite} elites.` });
    }
  }
  if (s.pop.elite > 0 && flag('class:elite')) {
    out.push({ m, kind: 'milestone', text: 'The first elites move in. They will need food, goods, power, water, drains, a lift, a view, and a servant.' });
  }
  for (const k of [6, 12, 24, 48]) {
    if (s.pop.elite >= k && flag(`ratio:${k}`)) {
      const r = (s.pop.laborer / s.pop.elite).toFixed(1);
      out.push({ m, kind: 'milestone', text: `${s.pop.elite} elites now live at the top. For every one of them, ${r} laborers keep the lights on.` });
    }
  }
  state.flags = [...flags];
  return out;
}
