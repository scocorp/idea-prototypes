// Controller: owns the game state, routes input, drives previews, undo, saving and the HUD.

import { UNDO_LIMIT } from './game/config.ts';
import { evaluate, L_SKY, type Evaluation } from './game/evaluate.ts';
import { clearLocal, deserialize, loadLocal, saveLocal, serialize } from './game/save.ts';
import { demolish, newGame, place, rename, withBuilding, type ActionResult } from './game/state.ts';
import { ERAS, RESOURCE_INFO, TILES, TILE_LIST } from './game/tiles.ts';
import { RESOURCES, type GameState, type Neighbor } from './game/types.ts';
import { checkDemolish, checkPlacement } from './game/world.ts';
import { LEVEL_H } from './render/camera.ts';
import { View, type FieldRegion, type GhostSpec, type Lens, type TimeMode } from './render/view.ts';
import { h, Hud, type Forecast } from './ui/hud.ts';

const LENS_ORDER: Lens[] = ['none', 'status', 'light', 'water', 'drain', 'heat', 'lift', 'appeal'];
const WELCOME_KEY = 'skyscraper.welcomed';

interface Target {
  x: number;
  y: number;
  z: number;
}

export class App {
  state: GameState;
  ev: Evaluation;
  private undoStack: GameState[] = [];
  private redoStack: GameState[] = [];
  private view: View;
  private hud: Hud;

  private tool: string | null = null;
  private rot = 0;
  private flip = false;
  private demolishMode = false;
  private lens: Lens = 'none';
  private slice: number | null = null;
  private shift = false;

  private mouse = { x: 0, y: 0, inside: false };
  private drag: { button: number; x: number; y: number; moved: boolean } | null = null;
  /** Drag-to-paint: while the left button is held with a plan selected, keep placing on one level. */
  private paint: { z: number; done: Set<string> } | null = null;
  private keys = new Set<string>();
  private hoverIdx = -1;
  private hoverNeighbor: Neighbor | null = null;
  private selectedId: number | null = null;
  private paletteHover: string | null = null;
  private target: Target | null = null;
  private previewKey = '';
  private forecast: Forecast | undefined;
  private lastInspectKey = '';

  constructor(root: HTMLElement) {
    const sceneEl = h('div');
    sceneEl.id = 'scene';
    root.append(sceneEl);
    this.view = new View(sceneEl);
    this.hud = new Hud(root, {
      pickTile: (id) => this.selectTool(id === this.tool ? null : id),
      hoverTile: (id) => {
        this.paletteHover = id;
        this.refreshInspector();
      },
      lens: (l) => this.setLens(l),
      rotate: (d) => this.rotate(d),
      slice: (d) => this.changeSlice(d),
      time: () => this.cycleTime(),
      undo: () => this.undo(),
      redo: () => this.redo(),
      demolishTool: () => this.toggleDemolish(),
      newGame: () => this.newGameDialog(),
      exportSave: () => this.exportSave(),
      importSave: (f) => void this.importSave(f),
      help: () => this.helpDialog(),
      rename: (name) => {
        this.state = rename(this.state, name);
        this.afterChange();
      },
      focus: (at) => this.focusCell(at),
    });

    this.state = loadLocal() ?? newGame();
    this.ev = evaluate(this.state);
    this.view.setWorld(this.state, this.ev, { fresh: true });
    this.hud.resetChronicleCursor(Math.max(0, this.state.chronicle.length - 1));
    this.renderAll();
    this.bindInput(sceneEl);
    this.loop();
    let welcomed = false;
    try {
      welcomed = localStorage.getItem(WELCOME_KEY) === '1';
    } catch {
      /* ignore */
    }
    if (!welcomed && this.state.buildings.length === 0) this.welcomeDialog();
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  private loop() {
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.keyPan(dt);
      this.view.frame(dt);
      if (this.mouse.inside && !this.drag) this.updateHover();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private keyPan(dt: number) {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    if (dx || dy) this.view.rig.pan(dx * 700 * dt, dy * 700 * dt, this.state.size);
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  private bindInput(el: HTMLElement) {
    const canvas = this.view.renderer.domElement;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.drag = { button: e.button, x: e.clientX, y: e.clientY, moved: false };
      if (e.button === 0 && this.tool && !this.shift) {
        this.updateHover();
        const t = this.target;
        if (t) {
          this.paint = { z: t.z, done: new Set([`${t.x},${t.y}`]) };
          this.tryPlace(t.x, t.y, t.z, true, true);
        }
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY, inside: true };
      if (this.paint) {
        const c = this.view.pickPlane(e.clientX, e.clientY, this.paint.z);
        const key = c ? `${c.x},${c.y}` : '';
        if (c && !this.paint.done.has(key)) {
          this.paint.done.add(key);
          this.tryPlace(c.x, c.y, this.paint.z, false, false);
        }
        return;
      }
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (!this.drag.moved && Math.hypot(dx, dy) > 4) this.drag.moved = true;
        if (this.drag.moved && (this.drag.button === 1 || this.drag.button === 2 || (this.drag.button === 0 && !this.tool && !this.demolishMode))) {
          this.view.rig.pan(dx, dy, this.state.size);
          this.drag.x = e.clientX;
          this.drag.y = e.clientY;
          el.style.cursor = 'grabbing';
        }
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      el.style.cursor = '';
      if (this.paint) {
        this.paint = null;
        this.previewKey = '';
        return;
      }
      if (!d || d.moved) return;
      if (e.button === 0) this.click();
      else if (e.button === 2) {
        if (this.tool || this.demolishMode) this.selectTool(null);
        else this.select(null);
      }
    });
    canvas.addEventListener('pointerleave', () => {
      this.mouse.inside = false;
      this.clearHover();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const ndc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
        this.view.rig.setZoom(this.view.rig.zoomTo * factor, ndc);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      if (e.key === 'Shift') this.shift = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.shift = false;
    });
  }

  private keyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (e.key === 'Shift') {
      this.shift = true;
      return;
    }
    if (this.hud.modalOpen) {
      if (e.key === 'Escape') this.hud.hideModal();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (k) {
      case 'escape':
        if (this.tool || this.demolishMode) this.selectTool(null);
        else this.select(null);
        break;
      case 'q':
        this.rotate(-1);
        break;
      case 'e':
        this.rotate(1);
        break;
      case 'r':
        this.rot = (this.rot + (e.shiftKey ? 3 : 1)) % 4;
        break;
      case 'f':
        this.flip = !this.flip;
        break;
      case '[':
        this.changeSlice(-1);
        break;
      case ']':
        this.changeSlice(1);
        break;
      case '\\':
        this.changeSlice('clear');
        break;
      case 'v': {
        const i = LENS_ORDER.indexOf(this.lens);
        this.setLens(LENS_ORDER[(i + (e.shiftKey ? LENS_ORDER.length - 1 : 1)) % LENS_ORDER.length]!);
        break;
      }
      case 'x':
        this.toggleDemolish();
        break;
      case 'delete':
      case 'backspace':
        if (this.selectedId !== null) this.doDemolish(this.selectedId);
        break;
      case 'n':
        this.cycleTime();
        break;
      case '?':
      case 'h':
        this.helpDialog();
        break;
      case 'home':
        this.view.frameTower();
        break;
      case 'pageup':
      case 'pagedown': {
        const rig = this.view.rig;
        rig.target.y = Math.max(0, Math.min(45, rig.target.y + (k === 'pageup' ? 3 : -3) * LEVEL_H));
        e.preventDefault();
        break;
      }
      case '+':
      case '=':
        this.view.rig.setZoom(this.view.rig.zoomTo * 1.25);
        break;
      case '-':
        this.view.rig.setZoom(this.view.rig.zoomTo / 1.25);
        break;
      default:
        if (['w', 'a', 's', 'd', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) {
          this.keys.add(k);
          e.preventDefault();
        }
        return;
    }
    this.previewKey = '';
  }

  // ── Hover & preview ────────────────────────────────────────────────────────

  private clearHover() {
    this.target = null;
    this.hoverIdx = -1;
    this.hoverNeighbor = null;
    this.view.setHover(-1);
    this.view.setGhost(null);
    this.view.setFieldRegions(this.selectedRegions());
    this.previewKey = '';
    this.refreshInspector();
  }

  private updateHover() {
    const hit = this.view.pick(this.mouse.x, this.mouse.y);
    const idx = hit && !hit.ground ? this.ev.world.at(hit.x, hit.y, hit.z) : -1;
    const nb = hit ? null : this.view.pickNeighbor(this.mouse.x, this.mouse.y);
    let target: Target | null = null;
    if (this.tool && hit) {
      target = this.shift && !hit.ground ? { x: hit.x, y: hit.y, z: hit.z } : { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
    }
    const key = `${this.tool}|${this.demolishMode}|${target ? `${target.x},${target.y},${target.z}` : '-'}|${this.rot}|${this.flip}|${this.shift}|${idx}|${nb?.name ?? ''}|${this.state.month}|${this.undoStack.length}`;
    if (key === this.previewKey) return;
    this.previewKey = key;
    this.target = target;
    this.hoverIdx = idx;
    this.hoverNeighbor = nb;
    this.view.setStrataVisible(this.tool === 'skybridge' || !!nb);

    if (this.tool) {
      this.view.setHover(-1);
      if (!target) {
        this.view.setGhost(null);
        this.view.setFieldRegions([]);
        this.forecast = undefined;
      } else {
        this.preview(this.tool, target);
      }
    } else {
      this.view.setGhost(null);
      this.view.setHover(idx);
      this.view.setFieldRegions(idx >= 0 ? this.regionsOf(idx) : this.selectedRegions());
      this.forecast = undefined;
    }
    this.refreshInspector();
  }

  private regionsOf(i: number): FieldRegion[] {
    const b = this.state.buildings[i];
    if (!b || !this.ev.active[i]) return [];
    return (this.ev.defs[i]!.emits ?? []).map((e) => ({ cells: b.cells, z: b.z, emission: e }));
  }

  private selectedRegions(): FieldRegion[] {
    if (this.selectedId === null) return [];
    const i = this.ev.byId.get(this.selectedId);
    return i === undefined ? [] : this.regionsOf(i);
  }

  private preview(type: string, t: Target) {
    const st = this.state;
    const pl = checkPlacement(st, this.ev.world, type, t.x, t.y, t.z, this.rot, this.flip, this.shift);
    if (!pl.ok) {
      this.view.setGhost({ type, cells: pl.cells, z: t.z, status: 'bad' });
      this.forecast = { z: t.z, placeWhy: pl.why, deltas: [], losses: [], gains: [] };
      this.view.setFieldRegions([]);
      return;
    }
    const { state: s2, id } = withBuilding(st, type, t.x, t.y, t.z, this.rot, this.flip, pl.replaces);
    const ev2 = evaluate(s2);
    this.forecast = { ...this.makeForecast(ev2, s2, id, pl.replaces), z: t.z };
    const ghost: GhostSpec = { type, cells: pl.cells, z: t.z, status: this.forecast.reasons?.length ? 'idle' : 'ok' };
    this.view.setGhost(ghost);
    this.view.setFieldRegions((TILES[type]!.emits ?? []).map((e) => ({ cells: pl.cells, z: t.z, emission: e })));
  }

  private makeForecast(ev2: Evaluation, s2: GameState, id: number, replaces: number[]): Forecast {
    const ev = this.ev;
    const i2 = ev2.byId.get(id)!;
    const deltas: Forecast['deltas'] = [];
    for (const r of RESOURCES) {
      const d = ev2.stats.made[r] - ev2.stats.used[r] - (ev.stats.made[r] - ev.stats.used[r]);
      if (d) deltas.push({ text: `${d > 0 ? '+' : ''}${d} ${RESOURCE_INFO[r].label}`, sign: Math.sign(d) });
    }
    for (const [cls, label] of [['laborer', 'laborers'], ['citizen', 'citizens'], ['elite', 'elites']] as const) {
      const d = ev2.stats.pop[cls] - ev.stats.pop[cls];
      if (d) deltas.push({ text: `${d > 0 ? '+' : ''}${d} ${label}`, sign: Math.sign(d) });
    }
    const dp = ev2.stats.prestige - ev.stats.prestige;
    if (dp) deltas.push({ text: `${dp > 0 ? '+' : ''}${dp} Prestige`, sign: Math.sign(dp) });
    const losses: string[] = [];
    const gains: string[] = [];
    const n = s2.size;
    for (const rid of replaces) {
      const b = this.state.buildings.find((o) => o.id === rid)!;
      losses.push(`Replaces the ${TILES[b.type]!.name} on L${b.z}`);
    }
    this.state.buildings.forEach((b, i) => {
      const j = ev2.byId.get(b.id);
      if (j === undefined) return;
      const name = `${TILES[b.type]!.name} (L${b.z})`;
      const sky = (e: Evaluation) => b.cells.some(([x, y]) => (e.light[(b.z * n + y) * n + x]! & L_SKY) !== 0);
      const lostSky = sky(ev) && !sky(ev2);
      if (ev.active[i] && !ev2.active[j]) losses.push(`${name} stops: ${ev2.reasons[j]![0]?.text ?? ''}`);
      else if (lostSky) losses.push(`${name} loses the open sky`);
      if (!ev.active[i] && ev2.active[j]) gains.push(`${name} starts working`);
    });
    const cap = (a: string[]) => (a.length > 7 ? [...a.slice(0, 6), `…and ${a.length - 6} more`] : a);
    return { reasons: ev2.active[i2] ? [] : ev2.reasons[i2], deltas, losses: cap(losses), gains: cap(gains) };
  }

  private refreshInspector() {
    const st = this.state;
    const ev = this.ev;
    if (this.hoverIdx >= st.buildings.length) this.hoverIdx = -1;
    if (this.paletteHover && this.paletteHover !== this.tool) {
      const key = `p|${this.paletteHover}|${st.month}`;
      if (key === this.lastInspectKey) return;
      this.lastInspectKey = key;
      this.hud.inspect(...this.hud.tileCard(TILES[this.paletteHover]!, st));
      return;
    }
    this.lastInspectKey = '';
    if (this.tool) {
      this.hud.inspect(...this.hud.tileCard(TILES[this.tool]!, st, this.target ? this.forecast : undefined));
    } else if (this.demolishMode && this.hoverIdx >= 0) {
      this.hud.inspect(...this.hud.buildingCard(st, ev, this.hoverIdx, checkDemolish(ev.world, st.buildings[this.hoverIdx]!)));
    } else if (this.hoverIdx >= 0) {
      this.hud.inspect(...this.hud.buildingCard(st, ev, this.hoverIdx));
    } else if (this.hoverNeighbor) {
      this.hud.inspect(...this.hud.neighborCard(st, ev, this.hoverNeighbor));
    } else if (this.selectedId !== null && ev.byId.has(this.selectedId)) {
      this.hud.inspect(...this.hud.buildingCard(st, ev, ev.byId.get(this.selectedId)!));
    } else {
      this.hud.inspect(...this.hud.idleCard(st, ev));
    }
    this.renderHint();
  }

  private renderHint() {
    const kb = (s: string) => h('kbd', null, s);
    if (this.tool) {
      const d = TILES[this.tool]!;
      const needsCover = d.needs.water || d.needs.drain || d.needs.heat || d.needs.lift;
      const dot = (c: string) => h('span', { style: `color:${c}` }, '■');
      this.hud.hint(
        `Placing ${d.name}: click or drag to build · `, kb('R'), ' rotate · ', kb('F'), ' flip · ', kb('Shift'), ' replace · ', kb('Esc'), ' stop',
        needsCover ? h('span', null, ' · plates: ', dot('#70e890'), ' covered ', dot('#50c8d8'), ' once its source runs ', dot('#f0b840'), ' partly') : null,
      );
    } else if (this.demolishMode) {
      this.hud.hint('Demolish: click a building with nothing on top · ', kb('Esc'), ' to stop');
    } else {
      this.hud.hint('Pick a plan on the left · drag to pan · wheel to zoom · ', kb('Q'), kb('E'), ' rotate · ', kb('['), kb(']'), ' cutaway · ', kb('V'), ' lens · ', kb('?'), ' help');
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private click() {
    if (this.tool) {
      const t = this.target;
      if (t) this.tryPlace(t.x, t.y, t.z, true, true);
      return;
    }
    if (this.demolishMode) {
      if (this.hoverIdx >= 0) this.doDemolish(this.state.buildings[this.hoverIdx]!.id);
      return;
    }
    this.select(this.hoverIdx >= 0 ? this.state.buildings[this.hoverIdx]!.id : null);
  }

  private tryPlace(x: number, y: number, z: number, loud: boolean, pushUndo: boolean): boolean {
    if (!this.tool) return false;
    const r = place(this.state, this.ev, this.tool, x, y, z, this.rot, this.flip, this.shift);
    if ('error' in r) {
      if (loud) this.hud.toast(r.error);
      return false;
    }
    this.commit(r, true, pushUndo);
    return true;
  }

  private rotate(dir: 1 | -1) {
    this.view.rig.rotate(dir);
    this.renderViewbar();
  }

  private doDemolish(id: number) {
    const r = demolish(this.state, this.ev, id);
    if ('error' in r) this.hud.toast(r.error);
    else {
      if (this.selectedId === id) this.selectedId = null;
      this.commit(r, false);
    }
  }

  private commit(r: ActionResult, placed: boolean, pushUndo = true) {
    const prev = this.ev;
    const prevEra = this.state.era;
    if (pushUndo) {
      this.undoStack.push(this.state);
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.state = r.state;
    this.ev = r.ev;
    const newB = placed ? this.state.buildings[this.state.buildings.length - 1] : undefined;
    this.view.setWorld(this.state, this.ev, { newIds: newB ? [newB.id] : [] });
    if (newB) {
      this.popups(prev, newB.cells[0]![0], newB.cells[0]![1], newB.z);
      this.view.dust(newB.cells, newB.z);
      this.sunLossPopups(prev);
    }
    if (this.state.era > prevEra) {
      const fresh = TILE_LIST.filter((t) => t.era > prevEra && t.era <= this.state.era).map((t) => t.name);
      this.hud.banner(`Era ${this.state.era}: ${ERAS[this.state.era - 1]!.name}`, `New plans: ${fresh.join(', ')}`);
    }
    this.afterChange();
  }

  private popups(prev: Evaluation, x: number, y: number, z: number) {
    const p = this.view.rig.toScreen(this.view.worldOf(x, y, z + 1));
    const items: [string, string][] = [];
    for (const r of RESOURCES) {
      const d = this.ev.stats.made[r] - this.ev.stats.used[r] - (prev.stats.made[r] - prev.stats.used[r]);
      if (d) items.push([`${d > 0 ? '+' : ''}${d} ${RESOURCE_INFO[r].icon}`, d > 0 ? '#9ef0a8' : '#ff9a9a']);
    }
    const dpop = this.ev.stats.pop.laborer + this.ev.stats.pop.citizen + this.ev.stats.pop.elite - (prev.stats.pop.laborer + prev.stats.pop.citizen + prev.stats.pop.elite);
    if (dpop) items.push([`${dpop > 0 ? '+' : ''}${dpop} people`, dpop > 0 ? '#ffe0a8' : '#ff9a9a']);
    const dp = this.ev.stats.prestige - prev.stats.prestige;
    if (dp) items.push([`${dp > 0 ? '+' : ''}${dp} ♛`, '#ffd27a']);
    items.slice(0, 5).forEach(([t, c], k) => this.hud.popup(t, p.x + (k % 2 ? 26 : -26) * (k ? 1 : 0), p.y - k * 16, c, k * 90));
  }

  /** Flag light-hungry buildings that just lost their open sky. */
  private sunLossPopups(prev: Evaluation) {
    const n = this.state.size;
    let k = 0;
    this.state.buildings.forEach((b, i) => {
      const pi = prev.byId.get(b.id);
      if (pi === undefined || !this.ev.defs[i]!.needs.light || k > 6) return;
      const had = b.cells.some(([x, y]) => (prev.light[(b.z * n + y) * n + x]! & L_SKY) !== 0);
      const has = b.cells.some(([x, y]) => (this.ev.light[(b.z * n + y) * n + x]! & L_SKY) !== 0);
      if (had && !has) {
        const p = this.view.rig.toScreen(this.view.worldOf(b.cells[0]![0], b.cells[0]![1], b.z + 0.5));
        this.hud.popup('☀ lost', p.x, p.y, '#ffb860', 150 + k++ * 80);
      }
    });
  }

  private afterChange() {
    saveLocal(this.state);
    // Building indices shift whenever the state changes: drop hover state, the next frame re-picks.
    this.hoverIdx = -1;
    this.hoverNeighbor = null;
    this.view.setHover(-1);
    this.previewKey = '';
    this.lastInspectKey = '';
    this.renderAll();
  }

  private renderAll() {
    this.hud.renderTop(this.state, this.ev);
    this.hud.renderPalette(this.state, this.ev, this.demolishMode ? null : this.tool);
    this.hud.renderLenses(this.lens);
    this.hud.renderChronicle(this.state.chronicle);
    this.renderViewbar();
    this.refreshInspector();
  }

  private renderViewbar() {
    this.hud.renderViewbar({
      slice: this.slice,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      time: this.view.timeMode,
      demolish: this.demolishMode,
      quadrant: this.view.rig.quadrant,
    });
  }

  private selectTool(id: string | null) {
    this.tool = id;
    this.demolishMode = false;
    this.previewKey = '';
    if (!id) {
      this.view.setGhost(null);
      this.view.setFieldRegions(this.selectedRegions());
    }
    this.view.setStrataVisible(id === 'skybridge');
    this.view.setNeedTool(id);
    this.hud.renderPalette(this.state, this.ev, id);
    this.renderViewbar();
    this.refreshInspector();
  }

  private toggleDemolish() {
    const on = !this.demolishMode;
    this.selectTool(null);
    this.demolishMode = on;
    this.renderViewbar();
    this.renderHint();
  }

  private select(id: number | null) {
    this.selectedId = id;
    this.view.setSelected(id);
    this.view.setFieldRegions(this.selectedRegions());
    this.refreshInspector();
  }

  private setLens(l: Lens) {
    this.lens = l;
    this.view.setLens(l);
    this.hud.renderLenses(l);
  }

  private changeSlice(d: number | 'clear') {
    const top = Math.max(0, this.ev.stats.maxZ);
    if (d === 'clear') this.slice = null;
    else if (this.slice === null) this.slice = d < 0 ? Math.max(0, top - 1) : null;
    else {
      const s = this.slice + d;
      this.slice = s >= top ? null : Math.max(0, s);
    }
    this.view.setSlice(this.slice);
    this.previewKey = '';
    this.renderViewbar();
  }

  private cycleTime() {
    const order: TimeMode[] = ['cycle', 'day', 'night'];
    this.view.timeMode = order[(order.indexOf(this.view.timeMode) + 1) % order.length]!;
    this.renderViewbar();
  }

  private undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.state);
    this.load(prev, false);
  }

  private redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.state);
    this.load(next, false);
  }

  private load(state: GameState, fresh: boolean) {
    this.state = state;
    this.ev = evaluate(state);
    if (this.selectedId !== null && !this.ev.byId.has(this.selectedId)) this.selectedId = null;
    this.view.setWorld(state, this.ev, { fresh });
    if (fresh) this.hud.resetChronicleCursor(state.chronicle.length);
    this.afterChange();
  }

  private focusCell([x, y, z]: [number, number, number]) {
    const p = this.view.worldOf(x, y, z);
    this.view.rig.target.set(p.x, p.y + LEVEL_H / 2, p.z);
    this.view.rig.recentre(this.state.size);
    this.view.rig.target.set(p.x, p.y + LEVEL_H / 2, p.z);
    const i = this.ev.world.at(x, y, z);
    if (i >= 0) this.select(this.state.buildings[i]!.id);
  }

  // ── Dialogs, save, load ────────────────────────────────────────────────────

  private startNew(size: number, name: string, seed: number | undefined, sandbox: boolean) {
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.selectTool(null);
    this.slice = null;
    this.view.setSlice(null);
    this.load(newGame({ size, name: name || undefined, seed, sandbox }), true);
  }

  private newGameDialog() {
    let size = this.state.size;
    const sizes = h('div', { class: 'sizes' });
    const renderSizes = () =>
      sizes.replaceChildren(
        ...[8, 12, 16, 20].map((s) =>
          h('button', { class: s === size ? 'on' : '', on: { click: () => ((size = s), renderSizes()) } }, `${s}×${s}`),
        ),
      );
    renderSizes();
    const name = h('input') as HTMLInputElement;
    name.type = 'text';
    name.placeholder = 'Leave blank for a generated name';
    const seed = h('input') as HTMLInputElement;
    seed.type = 'number';
    seed.placeholder = 'Random';
    const sandbox = h('input') as HTMLInputElement;
    sandbox.type = 'checkbox';
    this.hud.showModal(
      h('h2', null, 'New tower'),
      h('p', null, 'This replaces the current tower (it is only kept if you export it first).'),
      h('label', null, 'Plot size'),
      sizes,
      h('label', null, 'Name'),
      name,
      h('label', null, 'Seed (neighbouring towers)'),
      seed,
      h('label', { class: 'check' }, sandbox, 'Sandbox: every plan unlocked from the start'),
      h(
        'div',
        { class: 'actions' },
        h('button', { on: { click: () => this.hud.hideModal() } }, 'Cancel'),
        h('button', { class: 'primary', on: { click: () => (this.hud.hideModal(), this.startNew(size, name.value, seed.value ? Number(seed.value) >>> 0 : undefined, sandbox.checked)) } }, 'Break ground'),
      ),
    );
  }

  private welcomeDialog() {
    this.hud.showModal(
      h('h2', null, 'Skyscraper'),
      h('p', null, 'An empty lot between the towers. Build up, level by level. Light falls straight down: whatever you put on top of something takes its sun, and the old floor becomes the undercity.'),
      h('p', null, 'Start with Wells, Shanties and Allotments. Every building needs things (light, water, food, workers...) and provides things. Higher floors are always supplied first; when something runs short, the bottom goes without.'),
      h('p', null, 'Hover anything to see why it works or doesn’t. Before you click, the inspector forecasts what a placement will do, including whose sun it takes.'),
      h('div', { class: 'actions' }, h('button', { on: { click: () => (this.hud.hideModal(), this.helpDialog()) } }, 'Controls'), h('button', { class: 'primary', on: { click: () => this.hud.hideModal() } }, 'Begin')),
    );
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  private helpDialog() {
    const row = (k: string, v: string) => h('tr', null, h('td', null, ...k.split(' ').map((s) => h('kbd', null, s))), h('td', null, v));
    const box = h(
      'div',
      null,
      h('h2', null, 'How to play'),
      h('table', null,
        row('Click', 'Build the selected plan / pin a building'),
        row('Drag', 'With a plan selected: paint along that level'),
        row('Shift', 'Hold while placing to replace the building under the cursor'),
        row('R F', 'Rotate / flip the plan'),
        row('Q E', 'Rotate the view 90°'),
        row('Right-drag', 'Pan (left-drag also pans when no plan is selected)'),
        row('Wheel', 'Zoom'),
        row('WASD', 'Pan'),
        row('PgUp PgDn', 'Scroll up / down the tower'),
        row('Home', 'Frame the whole tower'),
        row('[ ] \\', 'Cutaway: hide levels above / show all'),
        row('V', 'Cycle lenses (status, light, water, drain, heat, lift, appeal)'),
        row('X Del', 'Demolish tool / demolish pinned building'),
        row('Ctrl+Z Ctrl+Y', 'Undo / redo'),
        row('N', 'Day, night or cycle'),
        row('Esc', 'Stop building / unpin'),
      ),
      h('h3', null, 'Rules of the tower'),
      h('ul', null,
        h('li', null, 'Every building needs support directly below. Remove from the top down, or Shift-replace in place.'),
        h('li', null, 'Open sky = nothing above. Side light = an open face next to it. Dark = neither. Light Pipes and Grow Lamps fake it.'),
        h('li', null, 'Water flows down from Rain Catchers and Water Towers, up from Pumps, and around Wells. Drains (Cesspits, Sewage Works) collect from above. Heat rises from Boilers, Foundries and Geothermal Bores.'),
        h('li', null, 'Labor, Skill, Food, Power and Goods are shared by the whole tower, but the highest floors are served first.'),
        h('li', null, 'Appeal: amenities raise it, industry and crowding lower it (even when idle). Height, open sky and the clouds help. Citizens and elites demand it.'),
        h('li', null, 'Skybridges link to neighbouring towers at the same level. Their undercity sends labor, their middle floors trade, their elite levels bring skill and prestige.'),
        h('li', null, 'Unlock eras by growing the population. Final goal: a Spire on L20 or higher.'),
      ),
      h('div', { class: 'actions' }, h('button', { class: 'primary', on: { click: () => this.hud.hideModal() } }, 'Close')),
    );
    box.id = 'help';
    this.hud.showModal(box);
  }

  private exportSave() {
    const blob = new Blob([serialize(this.state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const slug = this.state.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tower';
    a.download = `skyscraper-${slug}-y${1 + Math.floor(this.state.month / 12)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async importSave(file: File) {
    try {
      const st = deserialize(await file.text());
      if (this.state.buildings.length && !confirm(`Replace ${this.state.name} with ${st.name}?`)) return;
      this.undoStack = [];
      this.redoStack = [];
      this.load(st, true);
      this.hud.toast(`Loaded ${st.name}`);
    } catch (err) {
      this.hud.toast(`Import failed: ${(err as Error).message}`);
    }
  }

  // ── Console / test hooks (window.skyscraper) ────────────────────────────────

  reset() {
    clearLocal();
    this.startNew(this.state.size, '', undefined, false);
  }

  newTower(size = 16, sandbox = false, seed?: number) {
    this.startNew(size, '', seed, sandbox);
  }

  placeAt(type: string, x: number, y: number, z: number, rot = 0, flip = false, replace = false): string | null {
    const r = place(this.state, this.ev, type, x, y, z, rot, flip, replace);
    if ('error' in r) return r.error;
    this.commit(r, true);
    return null;
  }

  look(o: { lens?: Lens; slice?: number | null; rotate?: number; time?: TimeMode; zoom?: number; tool?: string | null }) {
    if (o.lens) this.setLens(o.lens);
    if (o.slice !== undefined) {
      this.slice = o.slice;
      this.view.setSlice(o.slice);
    }
    for (let i = 0; i < (o.rotate ?? 0); i++) this.view.rig.rotate(1);
    if (o.time) this.view.timeMode = o.time;
    if (o.zoom) this.view.rig.setZoom(o.zoom);
    if (o.tool !== undefined) this.selectTool(o.tool);
    this.renderViewbar();
  }
}
