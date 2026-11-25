// DOM overlay: top bar, goal, palette, inspector, lenses, chronicle, view controls, dialogs.
// Everything dynamic is inserted as text (never innerHTML) because saves can be imported.

import { dateLabel } from '../game/config.ts';
import { fmt, L_LAMP, L_PIPE, L_SIDE, L_SKY, stratumAt, type Evaluation, type Reason } from '../game/evaluate.ts';
import { SHAPES, SHAPE_LABEL } from '../game/shapes.ts';
import {
  CATEGORY_INFO,
  describeNeeds,
  describeOutputs,
  describePlacement,
  ERAS,
  FIELD_INFO,
  RESOURCE_INFO,
  TILE_LIST,
} from '../game/tiles.ts';
import { RESOURCES, type Category, type ChronicleEntry, type GameState, type Neighbor, type TileDef } from '../game/types.ts';
import type { Lens, TimeMode } from '../render/view.ts';
import { css } from '../render/textures.ts';

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: { class?: string; title?: string; on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>; style?: string } | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props?.class) el.className = props.class;
  if (props?.title) el.title = props.title;
  if (props?.style) el.setAttribute('style', props.style);
  for (const [ev, fn] of Object.entries(props?.on ?? {})) el.addEventListener(ev, fn as EventListener);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export interface HudCallbacks {
  pickTile(id: string): void;
  hoverTile(id: string | null): void;
  lens(l: Lens): void;
  rotate(dir: 1 | -1): void;
  slice(delta: number | 'clear'): void;
  time(): void;
  undo(): void;
  redo(): void;
  demolishTool(): void;
  newGame(): void;
  exportSave(): void;
  importSave(file: File): void;
  help(): void;
  rename(name: string): void;
  focus(at: [number, number, number]): void;
}

export interface Forecast {
  placeWhy?: string;
  reasons?: Reason[];
  deltas: { text: string; sign: number }[];
  losses: string[];
  gains: string[];
}

const ERA_TIPS: string[][] = [
  [
    'Dig a Well (ground only). It waters two tiles around it, on the ground and one floor up.',
    'Put Shanties inside that range. Each needs water and 1 Food, and gives 2 Labor.',
    'Dig Allotments in open sun. Each needs 1 Labor and gives 3 Food.',
    'Nothing runs alone: wells and allotments need hands, shanties need water and food.',
  ],
  [
    'Tenements need a drain: a Cesspit (ground only) drains its 3×3 up to L3.',
    'Wells only reach L1. A Rain Catcher on a roof waters the four floors below it, one tile around.',
    'Tenements also use Goods: build Workshops.',
  ],
  [
    'Apartments are L-shaped and every part needs a window: corners, facades and lightwells.',
    'They need appeal 1. Tenements, workshops and cesspits next to them spoil it; Gardens and Markets help.',
    'Solar wants the sky; Boiler Houses work anywhere but smoke out two floors above them.',
    'A Grow Lamp lets the Allotments around it grow in the dark.',
  ],
  [
    'Lifts are shafts from the ground up. Citizens from L5 need one within 3 tiles.',
    'Sewage Works drain eight floors above them; Pumps push water six floors up (they need water to start).',
    'Light Pipes carry the sun three floors down. Chain them for deeper farms.',
  ],
  [
    'Penthouses: L6+, open sky, lift within 3, appeal 4, water, drain, and a servant from below.',
    'Skybridges go on the plot edge and link to the neighbour they face, at the same level. Hover a neighbour to see its strata.',
    'Bathhouses need heat rising from a Boiler, Foundry or Geothermal Bore beneath them.',
  ],
  [
    'Above the clouds (L16) everything gains +2 appeal.',
    'Sky Villas want appeal 6 and a 2×2 roof at L12+.',
    'Crown the tower with a Spire on L20 or higher.',
  ],
];

const CAT_ORDER: Category[] = ['housing', 'food', 'utility', 'power', 'industry', 'amenity', 'transit', 'landmark'];

const LENSES: { id: Lens; label: string; key?: string }[] = [
  { id: 'none', label: 'Normal' },
  { id: 'status', label: 'Status' },
  { id: 'light', label: 'Light' },
  { id: 'water', label: 'Water' },
  { id: 'drain', label: 'Drain' },
  { id: 'heat', label: 'Heat' },
  { id: 'lift', label: 'Lift' },
  { id: 'appeal', label: 'Appeal' },
];

const LEGENDS: Record<Lens, [string, string][]> = {
  none: [],
  status: [['#58c070', 'operating'], ['#e05050', 'idle']],
  light: [['#ffe066', 'open sky'], ['#ffa640', 'piped sun'], ['#9ec8e8', 'side light'], ['#c070f0', 'grow lamp'], ['#262b44', 'dark']],
  water: [[FIELD_INFO.water.css, 'watered'], ['#e05050', 'needs it, missing'], ['#3a3a46', 'not covered']],
  drain: [[FIELD_INFO.drain.css, 'drained'], ['#e05050', 'needs it, missing'], ['#3a3a46', 'not covered']],
  heat: [[FIELD_INFO.heat.css, 'heated'], ['#e05050', 'needs it, missing'], ['#3a3a46', 'not covered']],
  lift: [[FIELD_INFO.lift.css, 'lift access'], ['#e05050', 'needs it, missing'], ['#3a3a46', 'none']],
  appeal: [['#b02a2a', '−4'], ['#9a8a2a', '0'], ['#3aa05a', '+4'], ['#40c0a0', '+8']],
};

function swatch(d: TileDef): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 60;
  c.height = 60;
  const g = c.getContext('2d')!;
  const cells = SHAPES[d.shape].map(([x, y]) => [x, y] as [number, number]);
  const xs = cells.map((p) => p[0]);
  const ys = cells.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const hgt = Math.max(...ys) - Math.min(...ys) + 1;
  const s = Math.floor(52 / Math.max(w, hgt, 2));
  const ox = (60 - w * s) / 2;
  const oy = (60 - hgt * s) / 2;
  for (const [x, y] of cells) {
    const px = ox + (x - Math.min(...xs)) * s;
    const py = oy + (y - Math.min(...ys)) * s;
    g.fillStyle = css(d.look.color);
    g.fillRect(px + 1, py + 1, s - 2, s - 2);
    g.fillStyle = css(d.look.top ?? d.look.color);
    g.fillRect(px + 1, py + 1, s - 2, Math.max(4, s * 0.38));
  }
  return c;
}

export class Hud {
  readonly root: HTMLElement;
  private cb: HudCallbacks;
  private els: Record<string, HTMLElement> = {};
  private paletteButtons = new Map<string, HTMLButtonElement>();
  private toastTimer = 0;
  private bannerTimer = 0;
  private lastChronicle = 0;

  constructor(root: HTMLElement, cb: HudCallbacks) {
    this.root = root;
    this.cb = cb;
    const E = this.els;
    E.title = h('div', { class: 'panel', style: '' });
    E.title.id = 'title';
    E.resources = h('div', { class: 'panel' });
    E.resources.id = 'resources';
    E.goal = h('div', { class: 'panel' });
    E.goal.id = 'goal';
    E.top = h('div', null, E.title, E.resources);
    E.top.id = 'top';
    E.palette = h('div', { class: 'panel' });
    E.palette.id = 'palette';
    E.palette.addEventListener('mouseleave', () => cb.hoverTile(null));
    E.inspector = h('div', { class: 'panel' });
    E.inspector.id = 'inspector';
    E.lenses = h('div', { class: 'panel' });
    E.lenses.id = 'lenses';
    E.chronList = h('ol');
    E.chronicle = h('div', { class: 'panel' }, h('h3', null, 'Chronicle'), E.chronList);
    E.chronicle.id = 'chronicle';
    E.side = h('div', null, E.goal, E.inspector, E.lenses, E.chronicle);
    E.side.id = 'side';
    E.hint = h('div', { class: 'panel' });
    E.hint.id = 'hint';
    E.viewbar = h('div', { class: 'panel' });
    E.viewbar.id = 'viewbar';
    E.toast = h('div');
    E.toast.id = 'toast';
    E.popups = h('div');
    E.popups.id = 'popups';
    E.banner = h('div');
    E.banner.id = 'banner';
    E.modal = h('div');
    E.modal.id = 'modal';
    E.modal.addEventListener('mousedown', (e) => {
      if (e.target === E.modal) this.hideModal();
    });
    root.append(E.top, E.palette, E.side, E.hint, E.viewbar, E.toast, E.popups, E.banner, E.modal);
    this.buildViewbar();
  }

  get modalOpen(): boolean {
    return this.els.modal!.classList.contains('show');
  }

  // ── Top bar ────────────────────────────────────────────────────────────────

  renderTop(state: GameState, ev: Evaluation) {
    const E = this.els;
    const s = ev.stats;
    const name = h('div', { class: 'name', title: 'Click to rename' }, state.name);
    name.addEventListener('click', () => {
      const v = prompt('Name your tower', state.name);
      if (v !== null) this.cb.rename(v);
    });
    E.title!.replaceChildren(
      name,
      h('div', { class: 'sub' }, `${dateLabel(state.month)} · Era ${state.era}: ${ERAS[state.era - 1]!.name}${state.sandbox ? ' · Sandbox' : ''}`),
    );
    const chips: Node[] = [];
    for (const r of RESOURCES) {
      const info = RESOURCE_INFO[r];
      const free = s.made[r] - s.used[r];
      const short = s.short[r] > 0;
      const used = s.made[r] > 0 || s.used[r] > 0 || short;
      chips.push(
        h(
          'div',
          {
            class: `chip${short ? ' short' : ''}${used ? '' : ' locked'}`,
            title: `${info.label}: ${s.made[r]} made, ${s.used[r]} used${short ? `. ${s.short[r]} building(s) idle for lack of it` : ''}`,
          },
          h('div', { class: 'k' }, h('span', { style: `color:${info.color}` }, info.icon), info.label),
          h('div', { class: 'v' }, String(free), h('small', null, ` / ${s.made[r]}`)),
        ),
      );
    }
    chips.push(h('div', { class: 'sep' }));
    const pop: [string, number, string][] = [
      ['Laborers', s.pop.laborer, '#e0a070'],
      ['Citizens', s.pop.citizen, '#a0b8ff'],
      ['Elites', s.pop.elite, '#f0c860'],
    ];
    for (const [label, v, color] of pop) {
      chips.push(h('div', { class: 'chip' }, h('div', { class: 'k' }, h('span', { style: `color:${color}` }, '●'), label), h('div', { class: 'v' }, String(v))));
    }
    const ratio = s.pop.elite > 0 ? (s.pop.laborer / s.pop.elite).toFixed(1) : '–';
    chips.push(
      h('div', { class: 'chip', title: 'Laborers per elite' }, h('div', { class: 'k' }, 'Inequality'), h('div', { class: 'v' }, ratio, h('small', null, ' : 1'))),
      h('div', { class: 'sep' }),
      h('div', { class: 'chip', title: 'Score: elite homes, landmarks and elite bridges' }, h('div', { class: 'k' }, h('span', { style: 'color:#f0c860' }, '♛'), 'Prestige'), h('div', { class: 'v' }, String(s.prestige))),
      h('div', { class: 'chip', title: 'Highest working level' }, h('div', { class: 'k' }, 'Height'), h('div', { class: 'v' }, `L${Math.max(0, s.maxActiveZ)}`)),
    );
    E.resources!.replaceChildren(...chips);
    this.renderGoal(state, ev);
  }

  private renderGoal(state: GameState, ev: Evaluation) {
    const s = ev.stats;
    const g = this.els.goal!;
    const next = ERAS[state.era];
    if (next) {
      g.replaceChildren(
        h('div', { class: 'h' }, 'Next era: ', h('b', null, next.name)),
        ...next.parts.map((p) => {
          const v = p.get(s);
          const done = v >= p.target;
          return h(
            'div',
            { class: `row${done ? ' done' : ''}` },
            h('span', null, `${p.label} ${Math.min(v, p.target)}/${p.target}`),
            h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, (100 * Math.max(0, v)) / p.target)}%` })),
          );
        }),
      );
      return;
    }
    const crowned = (s.activeCount.spire ?? 0) > 0;
    g.replaceChildren(
      h('div', { class: 'h' }, crowned ? 'The tower is crowned. ' : 'Final goal: ', h('b', null, crowned ? 'Now push Prestige higher' : 'Raise a Spire on L20+')),
      h('div', { class: `row${crowned ? ' done' : ''}` }, h('span', null, `Prestige ${s.prestige} · Height L${Math.max(0, s.maxActiveZ)}`)),
    );
  }

  // ── Palette ────────────────────────────────────────────────────────────────

  renderPalette(state: GameState, ev: Evaluation, tool: string | null) {
    const P = this.els.palette!;
    const s = ev.stats;
    if (!this.paletteButtons.size || P.dataset.era !== String(state.era) || P.dataset.unl !== String(state.unlocked.length)) {
      P.replaceChildren();
      this.paletteButtons.clear();
      for (const cat of CAT_ORDER) {
        const tiles = TILE_LIST.filter((t) => t.category === cat).sort((a, b) => a.era - b.era);
        if (!tiles.length) continue;
        const info = CATEGORY_INFO[cat];
        const box = h('div', { class: 'cat' }, h('h3', { style: `color:${info.color}` }, h('i', { style: `background:${info.color}` }), info.label));
        for (const t of tiles) {
          const unlocked = state.sandbox || state.unlocked.includes(t.id);
          const era = ERAS[t.era - 1]!;
          const btn = h(
            'button',
            {
              class: `tile${unlocked ? '' : ' locked'}`,
              title: unlocked ? '' : `Unlocks with era ${t.era}: ${era.name} (${era.parts.map((p) => `${p.label} ${p.target}`).join(', ')})`,
              on: {
                click: () => unlocked && this.cb.pickTile(t.id),
                mouseenter: () => this.cb.hoverTile(t.id),
              },
            },
            swatch(t),
            h('div', { class: 'nm' }, h('b', null, t.name), h('span', null, unlocked ? SHAPE_LABEL[t.shape] + (t.place?.ground ? ' · ground' : t.place?.minZ ? ` · L${t.place.minZ}+` : '') : `🔒 Era ${t.era}`)),
            h('span', { class: 'ct' }),
          );
          this.paletteButtons.set(t.id, btn);
          box.append(btn);
        }
        P.append(box);
      }
      P.dataset.era = String(state.era);
      P.dataset.unl = String(state.unlocked.length);
    }
    for (const [id, btn] of this.paletteButtons) {
      btn.classList.toggle('on', id === tool);
      const built = s.builtCount[id] ?? 0;
      const act = s.activeCount[id] ?? 0;
      const ct = btn.querySelector('.ct') as HTMLElement;
      ct.textContent = built ? (act === built ? String(built) : `${act}/${built}`) : '';
      ct.classList.toggle('bad', act < built);
      ct.title = built ? `${act} of ${built} operating` : '';
    }
  }

  // ── Inspector ──────────────────────────────────────────────────────────────

  inspect(...nodes: Child[]) {
    this.els.inspector!.replaceChildren(...(nodes.filter(Boolean) as Node[]));
  }

  tileCard(d: TileDef, state: GameState, forecast?: Forecast): Node[] {
    const unlocked = state.sandbox || state.unlocked.includes(d.id);
    const out: Node[] = [
      h('h2', null, d.name, h('span', { class: 'tag' }, `${CATEGORY_INFO[d.category].label} · ${SHAPE_LABEL[d.shape]}`)),
      h('div', { class: 'blurb' }, d.blurb),
    ];
    if (!unlocked) {
      const era = ERAS[d.era - 1]!;
      out.push(h('div', { class: 'status warn' }, `Locked until era ${d.era}: ${era.name}`, h('ul', null, ...era.parts.map((p) => h('li', null, `${p.label}: ${p.target}`)))));
    }
    const place = describePlacement(d);
    const needs = describeNeeds(d);
    const outs = describeOutputs(d);
    if (place.length) out.push(h('div', { class: 'sec' }, 'Placement'), h('ul', { class: 'lines' }, ...place.map((t) => h('li', null, t))));
    if (needs.length) out.push(h('div', { class: 'sec' }, 'Needs'), h('ul', { class: 'lines' }, ...needs.map((t) => h('li', null, t))));
    if (outs.length) out.push(h('div', { class: 'sec' }, 'Provides'), h('ul', { class: 'lines' }, ...outs.map((t) => h('li', null, t))));
    if (forecast) out.push(...this.forecastNodes(forecast));
    return out;
  }

  private forecastNodes(f: Forecast): Node[] {
    const out: Node[] = [h('div', { class: 'sec' }, 'If built here')];
    if (f.placeWhy) {
      out.push(h('div', { class: 'status bad' }, `Can't build: ${f.placeWhy}`));
      return out;
    }
    if (f.reasons && f.reasons.length) {
      out.push(h('div', { class: 'status warn' }, 'Would sit idle:', h('ul', null, ...f.reasons.map((r) => h('li', null, r.text)))));
    } else {
      out.push(h('div', { class: 'status ok' }, 'Would operate'));
    }
    if (f.deltas.length) {
      out.push(h('div', { class: 'delta' }, ...f.deltas.map((d) => h('span', { class: d.sign > 0 ? 'pos' : d.sign < 0 ? 'neg' : '' }, d.text))));
    }
    if (f.losses.length || f.gains.length) {
      out.push(
        h(
          'ul',
          { class: 'lines fc' },
          ...f.losses.map((t) => h('li', { class: 'loss' }, `⚠ ${t}`)),
          ...f.gains.map((t) => h('li', { class: 'gain' }, `✓ ${t}`)),
        ),
      );
    }
    return out;
  }

  buildingCard(state: GameState, ev: Evaluation, i: number, demolishWhy?: string | null): Node[] {
    const b = state.buildings[i]!;
    const d = ev.defs[i]!;
    const n = state.size;
    const active = ev.active[i] === 1;
    const out: Node[] = [
      h('h2', null, d.name, h('span', { class: 'tag' }, `L${b.z} · ${CATEGORY_INFO[d.category].label}`)),
    ];
    if (active) out.push(h('div', { class: 'status ok' }, 'Operating'));
    else out.push(h('div', { class: 'status bad' }, 'Idle', h('ul', null, ...ev.reasons[i]!.map((r) => h('li', null, r.text)))));

    let lightBits = 0;
    for (const [x, y] of b.cells) lightBits |= ev.light[(b.z * n + y) * n + x]!;
    const light = lightBits & L_SKY ? 'Open sky' : lightBits & L_PIPE ? 'Piped sun' : lightBits & L_SIDE ? 'Side light' : lightBits & L_LAMP ? 'Grow lamp' : 'Dark';
    const has = (f: 'water' | 'drain' | 'heat' | 'lift') => b.cells.some(([x, y]) => ev.fields[f][(b.z * n + y) * n + x] === 1);
    const pills = (['water', 'drain', 'heat', 'lift'] as const).map((f) => {
      const yes = has(f);
      return h('span', { class: `pill ${yes ? 'yes' : 'no'}`, style: yes ? `background:${FIELD_INFO[f].css}` : '' }, FIELD_INFO[f].label);
    });
    const rows: [string, Child][] = [
      ['Light', light],
      ['Appeal', `${fmt(Math.round(ev.appeal[i]! * 10) / 10)}${d.needs.appeal !== undefined ? ` (needs ${d.needs.appeal})` : ''}`],
      ['Here', h('div', { class: 'pills' }, ...pills)],
    ];
    const makes = Object.entries(ev.makes[i] ?? {}).filter(([, v]) => v);
    if (makes.length) rows.push(['Makes', makes.map(([r, v]) => `${v} ${RESOURCE_INFO[r as keyof typeof RESOURCE_INFO].label}`).join(', ')]);
    const uses = Object.entries(d.needs.pool ?? {});
    if (uses.length) rows.push(['Uses', uses.map(([r, v]) => `${v} ${RESOURCE_INFO[r as keyof typeof RESOURCE_INFO].label}`).join(', ')]);
    if (d.residents) rows.push(['Home to', `${d.residents.n} ${d.residents.cls}s${active ? '' : ' (empty)'}`]);
    if (ev.prestige[i]) rows.push(['Prestige', String(ev.prestige[i])]);
    const link = ev.bridges[i];
    if (link) {
      rows.push([
        'Links to',
        link.stratum
          ? `${link.neighbor.name}'s ${link.stratum === 'under' ? 'undercity' : link.stratum === 'mid' ? 'middle floors' : 'elite levels'} (their L${b.z} of ${link.neighbor.height})`
          : `nothing: ${link.neighbor.name} has only ${link.neighbor.height} floors`,
      ]);
    }
    out.push(h('dl', null, ...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])));

    const log: string[] = [`${dateLabel(b.born)}: built`];
    for (const e of b.log.slice(-8)) {
      const t = e.t === 'sun-lost' ? 'lost the sun' : e.t === 'sun-back' ? 'saw the sky again' : e.t === 'stopped' ? `stopped (${e.why ?? '?'})` : 'started working';
      log.push(`${dateLabel(e.m)}: ${t}`);
    }
    out.push(h('div', { class: 'sec' }, 'History'), h('ul', { class: 'lines log' }, ...log.map((t) => h('li', null, t))));
    out.push(
      h(
        'div',
        { class: 'keys' },
        demolishWhy === undefined ? '' : demolishWhy ? `Can't demolish: ${demolishWhy}` : 'Click to demolish',
        demolishWhy === undefined ? 'Click to pin · Shift+place to replace · Del to demolish' : '',
      ),
    );
    return out;
  }

  neighborCard(state: GameState, ev: Evaluation, nb: Neighbor): Node[] {
    const under = Math.ceil(nb.height * 0.4);
    const mid = Math.ceil(nb.height * 0.8);
    const linkedBy = state.buildings.findIndex((_, i) => ev.active[i] && ev.bridges[i]?.neighbor === nb);
    const side = { n: 'north', e: 'east', s: 'south', w: 'west' }[nb.side];
    return [
      h('h2', null, nb.name, h('span', { class: 'tag' }, `${nb.height} floors · ${side}`)),
      h('div', { class: 'blurb' }, 'A neighbouring tower. Bridges are level: a Skybridge on your L# reaches their L#.'),
      h(
        'dl',
        null,
        h('dt', null, 'Undercity'), h('dd', null, `L0–L${under - 1}: commuting labor`),
        h('dt', null, 'Middle'), h('dd', null, `L${under}–L${mid - 1}: trade (food, goods)`),
        h('dt', null, 'Elite'), h('dd', null, `L${mid}–L${nb.height - 1}: skill and prestige (needs a lift and appeal 3 at your end)`),
      ),
      h('div', { class: `status ${linkedBy >= 0 ? 'ok' : 'warn'}` }, linkedBy >= 0 ? `Linked from your L${state.buildings[linkedBy]!.z} (${stratumAt(nb, state.buildings[linkedBy]!.z)})` : 'Not linked. Build a Skybridge on the edge facing it.'),
    ];
  }

  idleCard(state: GameState, ev: Evaluation): Node[] {
    const counts = new Map<string, number>();
    state.buildings.forEach((_, i) => {
      if (ev.active[i]) return;
      const r = ev.reasons[i]![0];
      if (r) counts.set(r.text.split(':')[0]!.split('(')[0]!.trim(), (counts.get(r.text.split(':')[0]!.split('(')[0]!.trim()) ?? 0) + 1);
    });
    const out: Node[] = [h('h2', null, state.name), h('div', { class: 'blurb' }, 'Pick a plan on the left to build. Hover anything to inspect it. Light falls straight down: whatever you build on top of something takes its sun.')];
    const tips = ERA_TIPS[Math.min(state.era, ERA_TIPS.length) - 1]!;
    out.push(h('div', { class: 'sec' }, `Era ${state.era}: ${ERAS[state.era - 1]!.name}`), h('ul', { class: 'lines' }, ...tips.map((t) => h('li', null, t))));
    if (counts.size) {
      out.push(h('div', { class: 'sec' }, `Idle buildings (${ev.stats.inactive})`), h('ul', { class: 'lines' }, ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => h('li', null, `${v} × ${k}`))));
    } else if (state.buildings.length) {
      out.push(h('div', { class: 'status ok' }, 'Every building is operating.'));
    }
    out.push(h('div', { class: 'keys' }, 'Press ', h('kbd', null, '?'), ' for controls and rules.'));
    return out;
  }

  // ── Lenses, chronicle, hint, viewbar ───────────────────────────────────────

  renderLenses(active: Lens) {
    const L = this.els.lenses!;
    L.replaceChildren(
      ...LENSES.map((l) => h('button', { class: l.id === active ? 'on' : '', on: { click: () => this.cb.lens(l.id) } }, l.label)),
      h('div', { class: 'legend' }, ...LEGENDS[active].map(([c, t]) => h('span', null, h('i', { style: `background:${c}` }), t))),
    );
    (L.lastChild as HTMLElement).id = 'legend';
  }

  renderChronicle(entries: ChronicleEntry[]) {
    const ol = this.els.chronList!;
    const fresh = entries.length - this.lastChronicle;
    this.lastChronicle = entries.length;
    const shown = entries.slice(-120).reverse();
    ol.replaceChildren(
      ...shown.map((e, k) =>
        h(
          'li',
          {
            class: `${e.kind}${e.at ? ' at' : ''}${k < fresh && fresh < 10 ? ' fresh' : ''}`,
            title: e.at ? 'Click to look' : '',
            on: e.at ? { click: () => this.cb.focus(e.at!) } : {},
          },
          h('span', { class: 'd' }, dateLabel(e.m)),
          e.text,
        ),
      ),
    );
  }

  resetChronicleCursor(n: number) {
    this.lastChronicle = n;
  }

  hint(...parts: Child[]) {
    this.els.hint!.replaceChildren(...(parts.filter(Boolean) as Node[]));
  }

  private viewEls: Record<string, HTMLElement> = {};

  private buildViewbar() {
    const cb = this.cb;
    const V = this.viewEls;
    const btn = (label: string, title: string, fn: () => void) => h('button', { title, on: { click: fn } }, label);
    V.compass = h('div', null);
    V.compass.id = 'compass';
    for (const s of ['n', 'e', 's', 'w']) V.compass.append(h('span', { class: s }, s.toUpperCase()));
    V.sliceLabel = h('b', { title: 'Click to show all levels', on: { click: () => cb.slice('clear') } }, 'off');
    V.undo = btn('↶', 'Undo (Ctrl+Z)', () => cb.undo());
    V.redo = btn('↷', 'Redo (Ctrl+Y)', () => cb.redo());
    V.time = btn('◐', 'Day/night (N)', () => cb.time());
    V.demolish = btn('✖ Demolish', 'Demolish tool (X)', () => cb.demolishTool());
    const file = h('input', null) as HTMLInputElement;
    file.type = 'file';
    file.accept = '.json,application/json';
    file.style.display = 'none';
    file.addEventListener('change', () => {
      if (file.files?.[0]) cb.importSave(file.files[0]);
      file.value = '';
    });
    this.els.viewbar!.append(
      btn('⟲', 'Rotate view left (Q)', () => cb.rotate(-1)),
      V.compass,
      btn('⟳', 'Rotate view right (E)', () => cb.rotate(1)),
      h('div', { class: 'slice', title: 'Cutaway: hide the levels above ( [ and ], \\ to clear)' }, 'Cutaway', btn('−', 'Lower cutaway ([)', () => cb.slice(-1)), V.sliceLabel, btn('+', 'Raise cutaway (])', () => cb.slice(1))),
      V.undo,
      V.redo,
      V.demolish,
      V.time,
      btn('New', 'New tower', () => cb.newGame()),
      btn('Export', 'Download this tower as JSON', () => cb.exportSave()),
      btn('Import', 'Load a tower from JSON', () => file.click()),
      btn('?', 'Help (?)', () => cb.help()),
      file,
    );
  }

  renderViewbar(o: { slice: number | null; canUndo: boolean; canRedo: boolean; time: TimeMode; demolish: boolean; quadrant: number }) {
    const V = this.viewEls;
    V.sliceLabel!.textContent = o.slice === null ? 'off' : `L${o.slice}`;
    (V.undo as HTMLButtonElement).disabled = !o.canUndo;
    (V.redo as HTMLButtonElement).disabled = !o.canRedo;
    V.time!.textContent = o.time === 'cycle' ? '◐' : o.time === 'day' ? '☀' : '☾';
    V.time!.title = `Time: ${o.time} (N to change)`;
    V.demolish!.classList.toggle('on', o.demolish);
    // Compass: screen spots clockwise from top-right. At quadrant 0 (camera yaw 45°) grid north
    // (world -Z) is top-right; each +90° of yaw moves every label one spot clockwise.
    const spots: [number, number][] = [[88, 12], [88, 88], [12, 88], [12, 12]];
    ['n', 'e', 's', 'w'].forEach((s, k) => {
      const p = spots[(k + o.quadrant) % 4]!;
      const el = V.compass!.querySelector(`.${s}`) as HTMLElement;
      el.style.left = `${p[0]}%`;
      el.style.top = `${p[1]}%`;
    });
  }

  // ── Feedback ───────────────────────────────────────────────────────────────

  toast(msg: string) {
    const t = this.els.toast!;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 2200);
  }

  popup(text: string, x: number, y: number, color: string, delay = 0) {
    const el = h('div', { class: 'pop', style: `left:${x}px;top:${y}px;color:${color};animation-delay:${delay}ms;opacity:0` }, text);
    this.els.popups!.append(el);
    window.setTimeout(() => el.remove(), 1600 + delay);
  }

  banner(title: string, text: string) {
    const b = this.els.banner!;
    b.replaceChildren(h('b', null, title), h('span', null, text));
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), 4200);
  }

  showModal(...nodes: Child[]) {
    const box = h('div', { class: 'box panel' }, ...nodes);
    this.els.modal!.replaceChildren(box);
    this.els.modal!.classList.add('show');
  }

  hideModal() {
    this.els.modal!.classList.remove('show');
    this.els.modal!.replaceChildren();
  }
}
