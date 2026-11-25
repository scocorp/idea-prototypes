import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { evaluate, L_SIDE, L_SKY, neighborFor, stratumAt } from '../src/game/evaluate.ts';
import { deserialize, serialize } from '../src/game/save.ts';
import { demolish, newGame, place, type ActionResult } from '../src/game/state.ts';
import type { GameState } from '../src/game/types.ts';
import { checkPlacement } from '../src/game/world.ts';

type Spec = [type: string, x: number, y: number, z: number, rot?: number];

/** Build a tower step by step (sandbox: every plan unlocked). */
function build(specs: Spec[], opts: { sandbox?: boolean; size?: number } = {}): ActionResult {
  let state = newGame({ size: opts.size ?? 8, seed: 42, sandbox: opts.sandbox ?? true });
  let ev = evaluate(state);
  let last: ActionResult = { state, ev, entries: [] };
  for (const [type, x, y, z, rot] of specs) {
    const r = place(state, ev, type, x, y, z, rot ?? 0, false, false);
    if ('error' in r) throw new Error(`place ${type} @${x},${y},${z}: ${r.error}`);
    state = r.state;
    ev = r.ev;
    last = r;
  }
  return last;
}

function find(r: ActionResult, type: string, x: number, y: number, z: number) {
  const i = r.state.buildings.findIndex((b) => b.type === type && b.z === z && b.cells.some(([cx, cy]) => cx === x && cy === y));
  assert.ok(i >= 0, `no ${type} at ${x},${y},${z}`);
  return { i, b: r.state.buildings[i]!, active: r.ev.active[i] === 1, reasons: r.ev.reasons[i]!.map((x) => x.code) };
}

// A self-sufficient starter: a well, three farms and four shanties around it.
const STARTER: Spec[] = [
  ['well', 3, 3, 0],
  ['allotment', 0, 0, 0], ['allotment', 1, 0, 0], ['allotment', 2, 0, 0],
  ['shanty', 2, 2, 0], ['shanty', 3, 2, 0], ['shanty', 4, 2, 0], ['shanty', 2, 3, 0],
];

describe('placement', () => {
  test('needs support below', () => {
    const r = build([['shanty', 0, 0, 0]]);
    const ok = checkPlacement(r.state, r.ev.world, 'shanty', 0, 0, 1, 0, false, false);
    const bad = checkPlacement(r.state, r.ev.world, 'shanty', 1, 0, 1, 0, false, false);
    assert.equal(ok.ok, true);
    assert.equal(bad.ok, false);
  });

  test('replacing cannot pull support from under the level above', () => {
    const r = build([['workshop', 0, 0, 0], ['shanty', 1, 0, 1]]);
    // Shift-replace only the left half of the workshop with a shanty: the right half holds L1 up.
    const c = checkPlacement(r.state, r.ev.world, 'shanty', 0, 0, 0, 0, false, true);
    assert.equal(c.ok, false);
    // Replacing it with something covering both cells is fine.
    const c2 = checkPlacement(r.state, r.ev.world, 'tenement', 0, 0, 0, 0, false, true);
    assert.equal(c2.ok, true);
  });

  test('demolish only from the top', () => {
    const r = build([['shanty', 0, 0, 0], ['shanty', 0, 0, 1]]);
    const bottom = find(r, 'shanty', 0, 0, 0).b;
    const res = demolish(r.state, r.ev, bottom.id);
    assert.ok('error' in res);
  });
});

describe('light', () => {
  test('covering a farm takes its sun', () => {
    const r = build([...STARTER, ['shanty', 0, 0, 1]]);
    const farm = find(r, 'allotment', 0, 0, 0);
    assert.equal(farm.active, false);
    assert.deepEqual(farm.reasons, ['light']);
    assert.ok(farm.b.log.some((e) => e.t === 'sun-lost'));
    assert.ok(r.entries.some((e) => e.kind === 'loss'));
  });

  test('side light only on open faces', () => {
    const specs: Spec[] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) specs.push(['shanty', x + 2, y + 2, 0]);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) specs.push(['shanty', x + 2, y + 2, 1]);
    const r = build(specs);
    const n = r.state.size;
    const at = (x: number, y: number, z: number) => r.ev.light[(z * n + y) * n + x]!;
    assert.equal(at(3, 3, 0) & (L_SKY | L_SIDE), 0, 'centre of a covered 3×3 is dark');
    assert.ok(at(2, 3, 0) & L_SIDE, 'edge of the block has side light');
    assert.ok(at(3, 3, 1) & L_SKY, 'roof has sky');
  });

  test('light pipe carries sun three floors down, and chains', () => {
    const specs: Spec[] = [];
    // Column (1,0): allotments with Light Pipes on L7 and L4. L7 lights L4-L6; the L4 pipe relays to L1-L3.
    for (const [t, z] of [['allotment', 0], ['allotment', 1], ['allotment', 2], ['allotment', 3], ['lightpipe', 4],
      ['allotment', 5], ['allotment', 6], ['lightpipe', 7]] as const) specs.push([t, 1, 0, z]);
    const r = build(specs);
    for (const z of [1, 2, 3, 5, 6]) {
      const f = find(r, 'allotment', 1, 0, z);
      assert.ok(!f.reasons.includes('light'), `allotment L${z} should be lit: ${f.reasons}`);
    }
    assert.ok(find(r, 'allotment', 1, 0, 0).reasons.includes('light'), 'L0 is out of reach');
  });
});

describe('fields and relays', () => {
  test('well waters two tiles around, ground and one floor up', () => {
    const r = build([['well', 3, 3, 0], ['allotment', 0, 0, 0], ['allotment', 1, 0, 0], ['shanty', 5, 3, 0], ['shanty', 5, 3, 1]]);
    const n = r.state.size;
    const wet = (x: number, y: number, z: number) => r.ev.fields.water[(z * n + y) * n + x] === 1;
    assert.equal(find(r, 'well', 3, 3, 0).active, true);
    assert.ok(wet(5, 3, 0) && wet(5, 3, 1) && wet(1, 1, 0));
    assert.ok(!wet(5, 3, 2) && !wet(6, 3, 0) && !wet(3, 3, 2));
  });

  test('pump and water tower cannot feed each other without a source', () => {
    const specs: Spec[] = [['solar', 7, 7, 0]];
    for (let z = 0; z < 5; z++) specs.push(['shanty', 0, 0, z]);
    specs.push(['pump', 0, 0, 5]);
    for (let z = 0; z < 8; z++) specs.push(['shanty', 1, 0, z]);
    specs.push(['watertower', 1, 0, 8]);
    const dry = build(specs);
    assert.deepEqual(find(dry, 'pump', 0, 0, 5).reasons, ['relay']);
    assert.deepEqual(find(dry, 'watertower', 1, 0, 8).reasons, ['relay']);
    // A rain catcher two floors above the pump (it waters 1-4 floors down) starts the chain.
    const wet = build([...specs, ['shanty', 0, 0, 6], ['raincatcher', 0, 0, 7]]);
    assert.equal(find(wet, 'pump', 0, 0, 5).active, true, 'pump is fed and powered');
    assert.equal(find(wet, 'watertower', 1, 0, 8).active, true, 'tower is filled by the pump');
  });

  test('lift shafts must be continuous from the ground', () => {
    const r = build([['lift', 0, 0, 0], ['lift', 0, 0, 1], ['shanty', 2, 0, 0]]);
    assert.equal(find(r, 'lift', 0, 0, 1).active, true);
    const bad = checkPlacement(r.state, r.ev.world, 'lift', 2, 0, 1, 0, false, false);
    assert.equal(bad.ok, false, 'a lift cannot start on top of a shanty');
    // Shift-replace the bottom of the shaft: the lift above loses its shaft.
    const broken = place(r.state, r.ev, 'shanty', 0, 0, 0, 0, false, true);
    assert.ok(!('error' in broken));
    if ('error' in broken) return;
    assert.deepEqual(find(broken, 'lift', 0, 0, 1).reasons, ['relay']);
  });
});

describe('economy', () => {
  test('starter settlement is self-sufficient', () => {
    const r = build(STARTER);
    assert.equal(r.ev.stats.inactive, 0, JSON.stringify(r.ev.reasons));
    assert.equal(r.ev.stats.pop.laborer, 16);
  });

  test('food shortage starves the lowest floors first', () => {
    // 3 farms feed 9 shanty-food; 10 shanties → one must starve, and it must be on the lowest floor.
    const specs: Spec[] = [...STARTER];
    specs.push(['shanty', 3, 4, 0], ['shanty', 4, 4, 0], ['shanty', 2, 4, 0]);
    specs.push(['shanty', 2, 2, 1], ['shanty', 3, 2, 1], ['shanty', 4, 2, 1]);
    const r = build(specs);
    const hungry = r.state.buildings.filter((_, i) => r.ev.reasons[i]!.some((x) => x.code === 'short:food'));
    assert.ok(hungry.length >= 1);
    assert.ok(hungry.every((b) => b.z === 0), 'only ground-floor shanties go hungry');
    for (const z of [1]) for (const x of [2, 3, 4]) assert.equal(find(r, 'shanty', x, 2, z).active, true);
  });

  test('phase B does not leave satisfiable buildings idle', () => {
    const r = build(STARTER);
    // Every inactive building must have a real reason.
    r.state.buildings.forEach((_, i) => {
      if (!r.ev.active[i]) assert.ok(r.ev.reasons[i]!.length > 0);
    });
  });
});

describe('bridges', () => {
  test('strata depend on the neighbour height', () => {
    const nb = { side: 'n', half: 0, name: 'X', height: 20, width: 4, depth: 4, gap: 5, shift: 0, hue: 0 } as const;
    assert.equal(stratumAt(nb, 2), 'under');
    assert.equal(stratumAt(nb, 10), 'mid');
    assert.equal(stratumAt(nb, 17), 'over');
    assert.equal(stratumAt(nb, 20), null);
  });

  test('each edge cell faces a neighbour; corners do not', () => {
    const s = newGame({ size: 8, seed: 1 });
    assert.equal(neighborFor(s, 0, 0), null);
    assert.equal(neighborFor(s, 3, 0)?.side, 'n');
    assert.equal(neighborFor(s, 7, 5)?.side, 'e');
    assert.equal(neighborFor(s, 7, 5)?.half, 1);
  });

  test('an undercity link brings labor', () => {
    let state: GameState = newGame({ size: 8, seed: 3, sandbox: true });
    const tall = state.neighbors.find((nb) => nb.side === 'n' && nb.half === 0)!;
    tall.height = 50;
    let ev = evaluate(state);
    for (const s of [['shanty', 1, 0, 0], ['skybridge', 1, 0, 1]] as const) {
      const r = place(state, ev, s[0], s[1], s[2], s[3], 0, false, false);
      if ('error' in r) throw new Error(r.error);
      state = r.state;
      ev = r.ev;
    }
    const i = state.buildings.findIndex((b) => b.type === 'skybridge');
    assert.equal(ev.active[i], 1, JSON.stringify(ev.reasons[i]));
    assert.equal(ev.bridges[i]?.stratum, 'under');
    assert.ok((ev.makes[i]!.labor ?? 0) >= 4);
  });
});

describe('progression and saves', () => {
  test('era 2 unlocks at 16 laborers', () => {
    const r = build(STARTER, { sandbox: false });
    assert.equal(r.state.era, 2);
    assert.ok(r.state.unlocked.includes('tenement'));
    assert.ok(r.state.chronicle.some((e) => e.kind === 'unlock'));
  });

  test('save round-trips', () => {
    const r = build(STARTER);
    const back = deserialize(serialize(r.state));
    assert.deepEqual(back, r.state);
  });
});

describe('overcity feasibility', () => {
  test('a penthouse can run: pump relay, sewage, lift, garden appeal, and three bridge strata', () => {
    let state: GameState = newGame({ size: 8, seed: 9, sandbox: true });
    const nb = (side: string, half: number) => state.neighbors.find((n) => n.side === side && n.half === half)!;
    nb('w', 0).height = 50; // undercity at our L1 → labor
    nb('n', 1).height = 7; // elite levels at our L6 → skill + prestige
    nb('e', 0).height = 4; // middle floors at our L2 → food + goods
    let ev = evaluate(state);
    const put = (t: string, x: number, y: number, z: number) => {
      const r = place(state, ev, t, x, y, z, 0, false, false);
      if ('error' in r) throw new Error(`${t}@${x},${y},${z}: ${r.error}`);
      state = r.state;
      ev = r.ev;
    };
    const shaft = (x: number, y: number, top: number) => {
      for (let z = 0; z <= top; z++) put('lift', x, y, z);
    };
    put('well', 1, 1, 0);
    put('pump', 2, 1, 0);
    put('sewage', 4, 4, 0);
    for (const [x, y] of [[6, 6], [7, 6], [6, 7]]) put('solar', x, y, 0);
    shaft(4, 2, 6);
    shaft(2, 2, 5);
    shaft(3, 2, 5);
    shaft(2, 3, 4);
    put('garden', 2, 3, 5);
    put('penthouse', 2, 2, 6);
    shaft(0, 1, 0);
    put('skybridge', 0, 1, 1);
    shaft(7, 1, 1);
    put('skybridge', 7, 1, 2);
    shaft(6, 0, 4);
    put('garden', 6, 0, 5);
    shaft(5, 0, 5);
    put('skybridge', 5, 0, 6);
    const at = (t: string) => state.buildings.map((b, i) => [b, i] as const).filter(([b]) => b.type === t);
    const [[, pi]] = at('penthouse') as [readonly [unknown, number]];
    assert.equal(ev.active[pi], 1, JSON.stringify(ev.reasons[pi]));
    const strata = at('skybridge').map(([, i]) => [ev.active[i], ev.bridges[i]?.stratum]);
    assert.deepEqual(strata, [[1, 'under'], [1, 'mid'], [1, 'over']]);
    assert.equal(ev.stats.pop.elite, 2);
    assert.ok(ev.stats.prestige >= 7, `prestige ${ev.stats.prestige}`);
  });
});
