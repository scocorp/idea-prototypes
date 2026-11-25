// Three.js scene: the tower (instanced per tile type), roof props, lenses, cutaway, ghost
// preview, field volumes, neighbouring towers, bridges, clouds, smoke, lift cars, day/night.

import * as THREE from 'three';
import { CLOUD_LEVEL, MAX_LEVELS, STRATA } from '../game/config.ts';
import { L_LAMP, L_PIPE, L_SIDE, L_SKY, potentialCoverage, type Evaluation } from '../game/evaluate.ts';
import { hash32, mulberry32 } from '../game/rng.ts';
import { FIELD_INFO, TILES } from '../game/tiles.ts';
import type { Building, Emission, Field, GameState, Neighbor, PropKind, TileDef } from '../game/types.ts';
import { CameraRig, LEVEL_H } from './camera.ts';
import { pickVoxel, type Hit } from './pick.ts';
import { propModel } from './props.ts';
import { groundTexture, neighborTextures, puffTexture, tileTextures } from './textures.ts';

export type Lens = 'none' | 'status' | 'light' | 'water' | 'drain' | 'heat' | 'lift' | 'appeal';
export type TimeMode = 'cycle' | 'day' | 'night';

export interface GhostSpec {
  type: string;
  cells: [number, number][];
  z: number;
  /** ok = would operate, idle = can build but would not operate, bad = cannot build. */
  status: 'ok' | 'idle' | 'bad';
}

export interface FieldRegion {
  cells: [number, number][];
  z: number;
  emission: Emission;
}

const GAP = 0.035;
const VGAP = 0.05;
const DIM = new THREE.Color(0x8c8494);

interface AnimInst {
  mesh: THREE.InstancedMesh;
  index: number;
  base: THREE.Matrix4;
  id: number;
}

interface Puff {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  grow: number;
  size: number;
  alpha: number;
}

/** A tiny gull silhouette, wings up (0) or down (1). */
function birdTexture(frame: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.beginPath();
  const wy = frame === 0 ? 3 : 12;
  g.moveTo(2, wy);
  g.quadraticCurveTo(9, frame === 0 ? 2 : 13, 16, 9);
  g.quadraticCurveTo(23, frame === 0 ? 2 : 13, 30, wy);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** White disc whose alpha fades to 0 at the rim, so the street block floats in the haze. */
function discFade(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 40, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class View {
  readonly rig = new CameraRig();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly container: HTMLElement;

  private state!: GameState;
  private ev!: Evaluation;
  private n = 16;

  private readonly towerGroup = new THREE.Group();
  private readonly propGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  private readonly cityGroup = new THREE.Group();
  private readonly fxGroup = new THREE.Group();
  private readonly lensGroup = new THREE.Group();
  private readonly needGroup = new THREE.Group();
  private needTool: string | null = null;

  private readonly boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  private readonly mats = new Map<string, THREE.Material[]>();
  private readonly glowMats: THREE.MeshLambertMaterial[] = [];
  private readonly propMats = {
    on: new THREE.MeshLambertMaterial({ vertexColors: true }),
    off: new THREE.MeshLambertMaterial({ vertexColors: true, color: DIM }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
  private readonly lensMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  private readonly sliceMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false });
  private readonly plateMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
  private readonly fieldMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14, depthWrite: false });

  private lens: Lens = 'none';
  private slice: number | null = null;
  private ghost: GhostSpec | null = null;
  private fieldRegions: FieldRegion[] = [];
  private hoverIdx = -1;
  private selectedId: number | null = null;
  private showStrata = false;

  private anims = new Map<number, number>();
  private animInst: AnimInst[] = [];
  private clock = 0;

  private neighborMeshes: { nb: Neighbor; mesh: THREE.Mesh; strata: THREE.Mesh[]; opacity: number; mat: THREE.MeshLambertMaterial[] }[] = [];
  private clouds: { sprite: THREE.Sprite; angle: number; radius: number; y: number; speed: number; base: number }[] = [];
  private puffs: Puff[] = [];
  private emitters: { pos: THREE.Vector3; color: number; acc: number; rate: number }[] = [];
  private liftCars: { mesh: THREE.Mesh; top: number; phase: number; speed: number }[] = [];
  private birds: { sprite: THREE.Sprite; angle: number; radius: number; dy: number; speed: number; phase: number }[] = [];
  private birdTex: THREE.Texture[] = [];
  private summit = new THREE.Vector3(0, 2, 0);
  private readonly puffTex = puffTexture();
  private ground: THREE.Mesh | null = null;

  private readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x806850, 1.0);
  private readonly key = new THREE.DirectionalLight(0xffffff, 1.4);
  timeMode: TimeMode = 'cycle';
  dayT = 0.36;
  private nightFactor = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);
    this.scene.add(this.towerGroup, this.propGroup, this.lensGroup, this.needGroup, this.overlayGroup, this.cityGroup, this.fxGroup);
    this.scene.add(this.hemi, this.key, this.key.target);
    this.scene.fog = new THREE.Fog(0xcfe0ea, 520, 640);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.rig.resize(w, h);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setWorld(state: GameState, ev: Evaluation, opts: { newIds?: number[]; fresh?: boolean } = {}) {
    const fresh = opts.fresh || !this.state || this.state.seed !== state.seed || this.state.size !== state.size;
    this.state = state;
    this.ev = ev;
    this.n = state.size;
    if (fresh) {
      this.buildCity();
      this.rig.viewHeight = this.n * 1.15 + 6;
      this.frameTower(true);
      const near = 500 + this.n * 0.6;
      (this.scene.fog as THREE.Fog).near = near;
      (this.scene.fog as THREE.Fog).far = near + 46;
      this.anims.clear();
    }
    for (const id of opts.newIds ?? []) this.anims.set(id, this.clock);
    this.rebuild();
  }

  /** Centre and zoom so the whole tower fits. */
  frameTower(instant = false) {
    const top = this.ev ? Math.max(0, this.ev.stats.maxZ + 1) : 0;
    const need = 0.866 * top * LEVEL_H + 0.707 * this.n + 4;
    const zoom = THREE.MathUtils.clamp(this.rig.viewHeight / need, 0.3, 1.15);
    this.rig.target.set(0, Math.max(1.5, top * LEVEL_H * 0.5), 0);
    this.rig.setZoom(zoom);
    if (instant) this.rig.zoom = zoom;
  }

  setLens(lens: Lens) {
    this.lens = lens;
    this.rebuild();
  }

  setSlice(level: number | null) {
    this.slice = level;
    this.rebuild();
  }

  /** Show where a plan's coverage needs (water, drain, heat, lift) are met on each column's next free cell. */
  setNeedTool(type: string | null) {
    this.needTool = type;
    this.buildNeedPlates();
  }

  /** Cell under the cursor on the floor plane of level z (for drag-painting a level). */
  pickPlane(clientX: number, clientY: number, z: number): { x: number; y: number } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = this.rig.ray(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = (z * LEVEL_H - ray.origin.y) / ray.direction.y;
    const x = Math.floor(ray.origin.x + ray.direction.x * t + this.n / 2);
    const y = Math.floor(ray.origin.z + ray.direction.z * t + this.n / 2);
    return x >= 0 && y >= 0 && x < this.n && y < this.n ? { x, y } : null;
  }

  setGhost(g: GhostSpec | null) {
    this.ghost = g;
    this.rebuildOverlay();
  }

  setFieldRegions(r: FieldRegion[]) {
    this.fieldRegions = r;
    this.rebuildOverlay();
  }

  setHover(buildingIndex: number) {
    if (buildingIndex === this.hoverIdx) return;
    this.hoverIdx = buildingIndex;
    this.rebuildOverlay();
  }

  setSelected(id: number | null) {
    this.selectedId = id;
    this.rebuildOverlay();
  }

  setStrataVisible(v: boolean) {
    this.showStrata = v;
    for (const nm of this.neighborMeshes) for (const s of nm.strata) s.visible = v;
  }

  pick(clientX: number, clientY: number): Hit | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((clientX - r.left) / r.width) * 2 - 1;
    const ndcY = -((clientY - r.top) / r.height) * 2 + 1;
    const ray = this.rig.ray(ndcX, ndcY);
    const world = this.ev.world;
    const slice = this.slice;
    return pickVoxel(ray, this.n, MAX_LEVELS, LEVEL_H, (x, y, z) => (slice === null || z <= slice) && world.at(x, y, z) >= 0);
  }

  /** Which neighbour tower (if any) is under the cursor. */
  pickNeighbor(clientX: number, clientY: number): Neighbor | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = this.rig.ray(ndc.x, ndc.y);
    const rc = new THREE.Raycaster(ray.origin, ray.direction);
    const meshes = this.neighborMeshes.filter((m) => m.opacity > 0.5).map((m) => m.mesh);
    const hit = rc.intersectObjects(meshes, false)[0];
    return hit ? (this.neighborMeshes.find((m) => m.mesh === hit.object)?.nb ?? null) : null;
  }

  /** A little puff of dust around a freshly placed building. */
  dust(cells: [number, number][], z: number) {
    for (const [x, y] of cells) {
      for (let k = 0; k < 4; k++) {
        if (this.puffs.length > 260) return;
        const a = Math.random() * Math.PI * 2;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, color: 0xe8e0d0, transparent: true, opacity: 0, depthWrite: false }));
        s.position.set(x + 0.5 - this.n / 2 + Math.cos(a) * 0.45, z * LEVEL_H + 0.08, y + 0.5 - this.n / 2 + Math.sin(a) * 0.45);
        s.scale.setScalar(0.2);
        this.fxGroup.add(s);
        this.puffs.push({ sprite: s, age: 0, life: 0.7 + Math.random() * 0.3, vx: Math.cos(a) * 0.9, vy: 0.25, vz: Math.sin(a) * 0.9, grow: 0.35, size: 0.2, alpha: 0.7 });
      }
    }
  }

  worldOf(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x + 0.5 - this.n / 2, z * LEVEL_H, y + 0.5 - this.n / 2);
  }

  get night(): number {
    return this.nightFactor;
  }

  // ── Materials ──────────────────────────────────────────────────────────────

  private materialsFor(d: TileDef, active: boolean): THREE.Material[] {
    const key = `${d.id}|${active ? 1 : 0}`;
    let m = this.mats.get(key);
    if (m) return m;
    const t = tileTextures(d);
    const glassy = d.look.style === 'glass' && d.relay === 'lift';
    const common = glassy ? { transparent: true, opacity: 0.55, depthWrite: false } : {};
    const side = new THREE.MeshLambertMaterial({ map: t.side, ...common });
    const top = new THREE.MeshLambertMaterial({ map: t.top, ...common });
    if (active && t.glow) {
      side.emissiveMap = t.glow;
      side.emissive = new THREE.Color(0xffffff);
      side.emissiveIntensity = 0;
      this.glowMats.push(side);
    }
    if (!active) {
      side.color = DIM.clone();
      top.color = DIM.clone();
    }
    const bottom = new THREE.MeshLambertMaterial({ color: 0x302c30 });
    m = [side, side, top, bottom, side, side];
    this.mats.set(key, m);
    return m;
  }

  // ── Rebuild: tower, props, lens, bridges, lifts, smoke emitters ────────────

  private cellBox(b: Building, x: number, y: number, m: THREE.Matrix4) {
    const world = this.ev.world;
    const same = (dx: number, dy: number) => {
      const o = world.at(x + dx, y + dy, b.z);
      return o >= 0 && this.state.buildings[o]!.id === b.id;
    };
    const x0 = same(-1, 0) ? 0 : GAP;
    const x1 = same(1, 0) ? 0 : GAP;
    const y0 = same(0, -1) ? 0 : GAP;
    const y1 = same(0, 1) ? 0 : GAP;
    const sx = 1 - x0 - x1;
    const sz = 1 - y0 - y1;
    const h = LEVEL_H - VGAP;
    const cx = x - this.n / 2 + x0 + sx / 2;
    const cz = y - this.n / 2 + y0 + sz / 2;
    m.makeScale(sx, h, sz).setPosition(cx, b.z * LEVEL_H + h / 2, cz);
  }

  private clearGroup(g: THREE.Group) {
    for (const c of [...g.children]) {
      g.remove(c);
      if (c instanceof THREE.InstancedMesh) c.dispose();
    }
  }

  private rebuild() {
    if (!this.state) return;
    this.clearGroup(this.towerGroup);
    this.clearGroup(this.propGroup);
    this.clearGroup(this.lensGroup);
    this.animInst = [];
    const B = this.state.buildings;
    const ev = this.ev;
    const n = this.n;
    const slice = this.slice;
    const lensOn = this.lens !== 'none';

    const groups = new Map<string, { d: TileDef; active: boolean; items: { m: THREE.Matrix4; id: number }[] }>();
    const sliced: THREE.Matrix4[] = [];
    const lensItems: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const m = new THREE.Matrix4();
    B.forEach((b, i) => {
      const d = ev.defs[i]!;
      const active = ev.active[i] === 1;
      for (const [x, y] of b.cells) {
        this.cellBox(b, x, y, m);
        if (slice !== null && b.z > slice) {
          sliced.push(m.clone());
          continue;
        }
        if (lensOn) {
          lensItems.push({ m: m.clone(), c: this.lensColor(i, x, y, b.z) });
          continue;
        }
        const key = `${d.id}|${active ? 1 : 0}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { d, active, items: [] }));
        g.items.push({ m: m.clone(), id: b.id });
      }
    });

    for (const g of groups.values()) {
      const mesh = new THREE.InstancedMesh(this.boxGeo, this.materialsFor(g.d, g.active), g.items.length);
      mesh.frustumCulled = false;
      g.items.forEach((it, k) => {
        mesh.setMatrixAt(k, it.m);
        if (this.anims.has(it.id)) this.animInst.push({ mesh, index: k, base: it.m, id: it.id });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (g.d.relay === 'lift') mesh.renderOrder = 2;
      this.towerGroup.add(mesh);
    }
    if (sliced.length) {
      const mesh = new THREE.InstancedMesh(this.boxGeo, this.sliceMat, sliced.length);
      mesh.frustumCulled = false;
      sliced.forEach((mm, k) => mesh.setMatrixAt(k, mm));
      mesh.renderOrder = 3;
      this.towerGroup.add(mesh);
    }
    if (lensItems.length) {
      const mesh = new THREE.InstancedMesh(this.boxGeo, this.lensMat, lensItems.length);
      mesh.frustumCulled = false;
      lensItems.forEach((it, k) => {
        mesh.setMatrixAt(k, it.m);
        mesh.setColorAt(k, it.c);
      });
      this.lensGroup.add(mesh);
    }
    if (lensOn) this.buildPlates();
    else this.buildProps();
    this.buildNeedPlates();
    this.buildBridges();
    this.buildLifts();
    this.rebuildOverlay();
    let top = -1;
    B.forEach((b) => {
      if (b.z > top) {
        top = b.z;
        const [x, y] = b.cells[0]!;
        this.summit.set(x + 0.5 - n / 2, (b.z + 1) * LEVEL_H, y + 0.5 - n / 2);
      }
    });
    if (top < 0) this.summit.set(0, 1, 0);
  }

  private lensColor(i: number, x: number, y: number, z: number): THREE.Color {
    const ev = this.ev;
    const c = new THREE.Color();
    const idx = (z * this.n + y) * this.n + x;
    const d = ev.defs[i]!;
    switch (this.lens) {
      case 'status':
        return c.setHex(ev.active[i] ? 0x58c070 : 0xe05050);
      case 'light': {
        const l = ev.light[idx]!;
        return c.setHex(l & L_SKY ? 0xffe066 : l & L_PIPE ? 0xffa640 : l & L_SIDE ? 0x9ec8e8 : l & L_LAMP ? 0xc070f0 : 0x262b44);
      }
      case 'appeal': {
        const a = ev.appealCell[idx]!;
        const t = THREE.MathUtils.clamp((a + 4) / 12, 0, 1);
        return c.setHSL(0.0 + t * 0.36, 0.65, 0.3 + t * 0.25);
      }
      default: {
        const f = this.lens as Field;
        const covered = ev.fields[f][idx] === 1;
        const needs = f === 'water' ? d.needs.water : f === 'drain' ? d.needs.drain : f === 'heat' ? d.needs.heat : f === 'lift' ? !!d.needs.lift : false;
        if (covered) return c.setHex(FIELD_INFO[f].color).multiplyScalar(needs ? 1 : 0.55);
        return c.setHex(needs ? 0xe05050 : 0x3a3a46);
      }
    }
  }

  /** Lens helper: translucent plates where the next building in each column would sit. */
  private buildPlates() {
    if (this.lens === 'none' || this.lens === 'status' || this.lens === 'light') return;
    const ev = this.ev;
    const n = this.n;
    const items: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const z = ev.world.top(x, y) + 1;
        if (z >= MAX_LEVELS || (this.slice !== null && z > this.slice + 1)) continue;
        const idx = (z * n + y) * n + x;
        const c = new THREE.Color();
        if (this.lens === 'appeal') {
          const a = ev.appealCell[idx]!;
          const t = THREE.MathUtils.clamp((a + 4) / 12, 0, 1);
          c.setHSL(t * 0.36, 0.65, 0.35 + t * 0.2);
        } else {
          if (!ev.fields[this.lens as Field][idx]) continue;
          c.setHex(FIELD_INFO[this.lens as Field].color);
        }
        const m = new THREE.Matrix4().makeScale(0.86, 0.02, 0.86).setPosition(x + 0.5 - n / 2, z * LEVEL_H + 0.012, y + 0.5 - n / 2);
        items.push({ m, c });
      }
    }
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(this.boxGeo, this.plateMat, items.length);
    mesh.frustumCulled = false;
    items.forEach((it, k) => {
      mesh.setMatrixAt(k, it.m);
      mesh.setColorAt(k, it.c);
    });
    this.lensGroup.add(mesh);
  }

  private buildNeedPlates() {
    for (const c of [...this.needGroup.children]) {
      this.needGroup.remove(c);
      if (c instanceof THREE.InstancedMesh) c.dispose();
    }
    const d = this.needTool ? TILES[this.needTool] : undefined;
    if (!d || !this.state || this.lens !== 'none') return;
    const ev = this.ev;
    const n = this.n;
    const items: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const potential: Partial<Record<Field, Uint8Array>> = {};
    for (const f of ['water', 'drain', 'heat', 'lift'] as const) potential[f] = potentialCoverage(this.state, f);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const z = ev.world.top(x, y) + 1;
        if (z >= MAX_LEVELS || (this.slice !== null && z > this.slice + 1)) continue;
        if (d.place?.ground && z !== 0) continue;
        if (d.place?.minZ !== undefined && z < d.place.minZ) continue;
        const want: Field[] = [];
        if (d.needs.water) want.push('water');
        if (d.needs.drain) want.push('drain');
        if (d.needs.heat) want.push('heat');
        if (d.needs.lift === true || (typeof d.needs.lift === 'number' && z >= d.needs.lift)) want.push('lift');
        if (!want.length) continue;
        const idx = (z * n + y) * n + x;
        const live = want.filter((f) => ev.fields[f][idx] === 1).length;
        const maybe = want.filter((f) => ev.fields[f][idx] === 1 || potential[f]![idx] === 1).length;
        if (!maybe) continue;
        const c = new THREE.Color(live === want.length ? 0x70e890 : maybe === want.length ? 0x50c8d8 : 0xf0b840);
        items.push({ m: new THREE.Matrix4().makeScale(0.8, 0.02, 0.8).setPosition(x + 0.5 - n / 2, z * LEVEL_H + 0.014, y + 0.5 - n / 2), c });
      }
    }
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(this.boxGeo, this.plateMat, items.length);
    mesh.frustumCulled = false;
    items.forEach((it, k) => {
      mesh.setMatrixAt(k, it.m);
      mesh.setColorAt(k, it.c);
    });
    this.needGroup.add(mesh);
  }

  private buildProps() {
    const ev = this.ev;
    const B = this.state.buildings;
    const n = this.n;
    const byKey = new Map<string, { kind: PropKind; active: boolean; items: { m: THREE.Matrix4; id: number }[] }>();
    const add = (kind: PropKind, active: boolean, m: THREE.Matrix4, id: number) => {
      const key = `${kind}|${active ? 1 : 0}`;
      let g = byKey.get(key);
      if (!g) byKey.set(key, (g = { kind, active, items: [] }));
      g.items.push({ m, id });
    };
    this.emitters = [];
    B.forEach((b, i) => {
      const d = ev.defs[i]!;
      const kind = d.look.prop;
      if (!kind) return;
      if (this.slice !== null && b.z > this.slice) return;
      const active = ev.active[i] === 1;
      const top = (b.z + 1) * LEVEL_H - VGAP;
      const sky = b.cells.map(([x, y]) => (ev.light[(b.z * n + y) * n + x]! & L_SKY) !== 0);
      const model = propModel(kind);
      const rotY = (b.rot * Math.PI) / 2;
      if (model.stretch && sky.every(Boolean) && b.cells.length !== 3) {
        const xs = b.cells.map((c) => c[0]);
        const ys = b.cells.map((c) => c[1]);
        const w = Math.max(...xs) - Math.min(...xs) + 1;
        const dd = Math.max(...ys) - Math.min(...ys) + 1;
        const cx = (Math.max(...xs) + Math.min(...xs)) / 2 + 0.5 - n / 2;
        const cz = (Math.max(...ys) + Math.min(...ys)) / 2 + 0.5 - n / 2;
        add(kind, active, new THREE.Matrix4().makeScale(w, 1, dd).setPosition(cx, top, cz), b.id);
        return;
      }
      b.cells.forEach(([x, y], k) => {
        if (!sky[k]) return;
        const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x + 0.5 - n / 2, top, y + 0.5 - n / 2);
        add(kind, active, m, b.id);
        if (active && (kind === 'chimney' || kind === 'chimneys' || kind === 'bore')) {
          const local = kind === 'chimney' ? new THREE.Vector3(0.2, 0.75, -0.15) : new THREE.Vector3(0, 1.05, 0);
          local.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
          this.emitters.push({
            pos: new THREE.Vector3(x + 0.5 - n / 2, top, y + 0.5 - n / 2).add(local),
            color: kind === 'bore' ? 0xf4f4f4 : kind === 'chimneys' ? 0x5a5550 : 0x8a8580,
            acc: Math.random(),
            rate: kind === 'chimneys' ? 2.2 : 1.4,
          });
        }
      });
    });
    for (const g of byKey.values()) {
      const model = propModel(g.kind);
      const base = new THREE.InstancedMesh(model.base, g.active ? this.propMats.on : this.propMats.off, g.items.length);
      base.frustumCulled = false;
      g.items.forEach((it, k) => {
        base.setMatrixAt(k, it.m);
        if (this.anims.has(it.id)) this.animInst.push({ mesh: base, index: k, base: it.m, id: it.id });
      });
      this.propGroup.add(base);
      if (model.glow && g.active) {
        const glow = new THREE.InstancedMesh(model.glow, this.propMats.glow, g.items.length);
        glow.frustumCulled = false;
        g.items.forEach((it, k) => {
          glow.setMatrixAt(k, it.m);
          if (this.anims.has(it.id)) this.animInst.push({ mesh: glow, index: k, base: it.m, id: it.id });
        });
        this.propGroup.add(glow);
      }
    }
  }

  private buildBridges() {
    for (const c of [...this.cityGroup.children]) if (c.userData.bridge) this.cityGroup.remove(c);
    const n = this.n;
    this.state.buildings.forEach((b, i) => {
      const link = this.ev.bridges[i];
      if (!link) return;
      if (this.slice !== null && b.z > this.slice) return;
      const nb = link.neighbor;
      const [x, y] = b.cells[0]!;
      const dir = nb.side === 'n' ? [0, -1] : nb.side === 's' ? [0, 1] : nb.side === 'w' ? [-1, 0] : [1, 0];
      const len = nb.gap + 0.1;
      const edge = new THREE.Vector3(x + 0.5 - n / 2 + dir[0]! * 0.5, 0, y + 0.5 - n / 2 + dir[1]! * 0.5);
      const active = this.ev.active[i] === 1 && !!link.stratum;
      const color = active ? 0xc8d4e0 : 0x8a6a6a;
      const g = new THREE.Group();
      g.userData.bridge = true;
      const yb = b.z * LEVEL_H + 0.22;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color }));
      const alongX = dir[0] !== 0;
      deck.scale.set(alongX ? len : 0.46, 0.09, alongX ? 0.46 : len);
      deck.position.set(edge.x + (dir[0]! * len) / 2, yb, edge.z + (dir[1]! * len) / 2);
      g.add(deck);
      const glass = new THREE.MeshLambertMaterial({ color: active ? 0xa8e0f8 : 0x806868, transparent: true, opacity: 0.55, depthWrite: false });
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), glass);
        rail.scale.set(alongX ? len : 0.03, 0.26, alongX ? 0.03 : len);
        rail.position.set(deck.position.x + (alongX ? 0 : s * 0.22), yb + 0.17, deck.position.z + (alongX ? s * 0.22 : 0));
        g.add(rail);
      }
      if (active) {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), glass);
        roof.scale.set(alongX ? len : 0.46, 0.03, alongX ? 0.46 : len);
        roof.position.set(deck.position.x, yb + 0.31, deck.position.z);
        g.add(roof);
      }
      this.cityGroup.add(g);
    });
  }

  private buildLifts() {
    for (const c of this.liftCars) this.fxGroup.remove(c.mesh);
    this.liftCars = [];
    const ev = this.ev;
    const tops = new Map<string, number>();
    this.state.buildings.forEach((b, i) => {
      if (ev.defs[i]!.relay !== 'lift' || !ev.active[i]) return;
      const [x, y] = b.cells[0]!;
      const k = `${x},${y}`;
      tops.set(k, Math.max(tops.get(k) ?? 0, b.z));
    });
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    for (const [k, top] of tops) {
      if (top < 1) continue;
      const [x, y] = k.split(',').map(Number) as [number, number];
      const mesh = new THREE.Mesh(this.boxGeo, mat);
      mesh.scale.set(0.42, LEVEL_H * 0.6, 0.42);
      mesh.position.set(x + 0.5 - this.n / 2, 0, y + 0.5 - this.n / 2);
      this.fxGroup.add(mesh);
      const r = mulberry32(hash32(x, y, top));
      this.liftCars.push({ mesh, top, phase: r() * 10, speed: 0.12 + r() * 0.08 });
    }
  }

  // ── Overlays: ghost, field volumes, highlights ─────────────────────────────

  private rebuildOverlay() {
    if (!this.state) return;
    for (const c of [...this.overlayGroup.children]) {
      this.overlayGroup.remove(c);
      if (c instanceof THREE.InstancedMesh) c.dispose();
    }
    const n = this.n;
    const cellM = (x: number, y: number, z: number, grow = 0) =>
      new THREE.Matrix4()
        .makeScale(1 - 2 * GAP + grow, LEVEL_H - VGAP + grow, 1 - 2 * GAP + grow)
        .setPosition(x + 0.5 - n / 2, z * LEVEL_H + (LEVEL_H - VGAP) / 2, y + 0.5 - n / 2);

    // Field volumes.
    const cols: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    for (const reg of this.fieldRegions) {
      const e = reg.emission;
      const z0 = Math.max(0, reg.z + e.dz[0]);
      const z1 = Math.min(MAX_LEVELS - 1, reg.z + e.dz[1]);
      if (z0 > z1) continue;
      const color = new THREE.Color(e.field === 'appeal' ? ((e.value ?? 0) >= 0 ? 0x60e0a0 : 0xff5050) : FIELD_INFO[e.field].color);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (!reg.cells.some(([cx, cy]) => Math.max(Math.abs(cx - x), Math.abs(cy - y)) <= e.r)) continue;
          const h = (z1 - z0 + 1) * LEVEL_H;
          cols.push({ m: new THREE.Matrix4().makeScale(0.96, h - 0.02, 0.96).setPosition(x + 0.5 - n / 2, z0 * LEVEL_H + h / 2, y + 0.5 - n / 2), c: color });
        }
      }
    }
    if (cols.length) {
      const mesh = new THREE.InstancedMesh(this.boxGeo, this.fieldMat, cols.length);
      mesh.frustumCulled = false;
      cols.forEach((it, k) => {
        mesh.setMatrixAt(k, it.m);
        mesh.setColorAt(k, it.c);
      });
      mesh.renderOrder = 4;
      this.overlayGroup.add(mesh);
    }

    // Ghost of the building being placed.
    if (this.ghost) {
      const g = this.ghost;
      const d = TILES[g.type]!;
      const tint = g.status === 'ok' ? 0xc8ffd0 : g.status === 'idle' ? 0xffd890 : 0xff7070;
      const edge = g.status === 'ok' ? 0x80ffa0 : g.status === 'idle' ? 0xffc040 : 0xff5050;
      const mats = this.materialsFor(d, true).map((mm) => {
        const c = (mm as THREE.MeshLambertMaterial).clone();
        c.transparent = true;
        c.opacity = g.status === 'bad' ? 0.45 : 0.8;
        c.color = new THREE.Color(tint);
        c.depthWrite = false;
        c.emissiveIntensity = 0;
        return c;
      });
      const mesh = new THREE.InstancedMesh(this.boxGeo, mats, g.cells.length);
      mesh.frustumCulled = false;
      g.cells.forEach(([x, y], k) => mesh.setMatrixAt(k, cellM(x, y, g.z)));
      mesh.renderOrder = 5;
      this.overlayGroup.add(mesh);
      const lineMat = new THREE.LineBasicMaterial({ color: edge, transparent: true, opacity: 0.95, depthTest: false });
      for (const [x, y] of g.cells) {
        const l = new THREE.LineSegments(this.edgeGeo, lineMat);
        l.applyMatrix4(cellM(x, y, g.z, 0.02));
        l.renderOrder = 6;
        this.overlayGroup.add(l);
      }
    }

    // Hover / selection outlines.
    const outline = (b: Building, color: number) => {
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false });
      for (const [x, y] of b.cells) {
        const l = new THREE.LineSegments(this.edgeGeo, mat);
        l.applyMatrix4(cellM(x, y, b.z, 0.03));
        l.renderOrder = 6;
        this.overlayGroup.add(l);
      }
    };
    const hb = this.state.buildings[this.hoverIdx];
    if (hb && !this.ghost) outline(hb, 0xffe080);
    const sb = this.selectedId !== null ? this.state.buildings.find((b) => b.id === this.selectedId) : undefined;
    if (sb) outline(sb, 0xffffff);
  }

  // ── City: ground, neighbours, clouds ───────────────────────────────────────

  private buildCity() {
    this.clearGroup(this.cityGroup);
    for (const c of this.clouds) this.fxGroup.remove(c.sprite);
    this.clouds = [];
    const n = this.n;
    const R = n / 2 + 26;
    const city = new THREE.Mesh(
      new THREE.CircleGeometry(R, 64),
      new THREE.MeshLambertMaterial({ color: 0x3c4448, map: discFade(), transparent: true, depthWrite: false }),
    );
    city.rotation.x = -Math.PI / 2;
    city.position.y = -0.03;
    city.renderOrder = -1;
    this.cityGroup.add(city);
    const street = new THREE.Mesh(new THREE.PlaneGeometry(n + 3, n + 3), new THREE.MeshLambertMaterial({ color: 0x2c3034 }));
    street.rotation.x = -Math.PI / 2;
    street.position.y = -0.02;
    this.cityGroup.add(street);
    const curb = new THREE.Mesh(new THREE.BoxGeometry(n + 0.5, 0.06, n + 0.5), new THREE.MeshLambertMaterial({ color: 0x8a8a84 }));
    curb.position.y = -0.03;
    this.cityGroup.add(curb);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(n, n), new THREE.MeshLambertMaterial({ map: groundTexture(n) }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0.002;
    this.cityGroup.add(this.ground);

    // Neighbouring towers.
    this.neighborMeshes = [];
    const { side: facade, glow } = neighborTextures(this.state.seed);
    for (const nb of this.state.neighbors) {
      const H = nb.height * LEVEL_H;
      const alongX = nb.side === 'n' || nb.side === 's';
      const w = nb.width;
      const d = nb.depth;
      const halfCenter = (nb.half === 0 ? n / 4 : (3 * n) / 4) - n / 2 + nb.shift * Math.max(0, n / 2 - w) * 0.5;
      const off = n / 2 + nb.gap + d / 2;
      const pos =
        nb.side === 'n' ? new THREE.Vector3(halfCenter, H / 2, -off)
        : nb.side === 's' ? new THREE.Vector3(halfCenter, H / 2, off)
        : nb.side === 'w' ? new THREE.Vector3(-off, H / 2, halfCenter)
        : new THREE.Vector3(off, H / 2, halfCenter);
      const tint = new THREE.Color().setHSL(0.56 + nb.hue * 0.1 - 0.05, 0.1 + nb.hue * 0.08, 0.62 + nb.hue * 0.1);
      const sideTex = facade.clone();
      sideTex.repeat.set(Math.max(1, Math.round(w / 2)), nb.height / 16);
      sideTex.needsUpdate = true;
      const glowTex = glow.clone();
      glowTex.repeat.copy(sideTex.repeat);
      glowTex.needsUpdate = true;
      const sideMat = new THREE.MeshLambertMaterial({ map: sideTex, color: tint, emissiveMap: glowTex, emissive: 0xffffff, emissiveIntensity: 0, transparent: true, opacity: 1 });
      const roofMat = new THREE.MeshLambertMaterial({ color: tint.clone().multiplyScalar(0.8), transparent: true, opacity: 1 });
      this.glowMats.push(sideMat);
      const geo = new THREE.BoxGeometry(alongX ? w : d, H, alongX ? d : w);
      const mesh = new THREE.Mesh(geo, [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat]);
      mesh.position.copy(pos);
      this.cityGroup.add(mesh);
      const strata: THREE.Mesh[] = [];
      const bands: [number, number, number][] = [
        [0, STRATA.under, 0xa07040],
        [STRATA.under, STRATA.mid, 0x40b0b0],
        [STRATA.mid, 1, 0xf0c850],
      ];
      for (const [a, bnd, color] of bands) {
        const z0 = Math.ceil(a * nb.height);
        const z1 = Math.ceil(bnd * nb.height);
        if (z1 <= z0) continue;
        const h = (z1 - z0) * LEVEL_H;
        const band = new THREE.Mesh(
          new THREE.BoxGeometry((alongX ? w : d) + 0.3, h - 0.05, (alongX ? d : w) + 0.3),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false }),
        );
        band.position.set(pos.x, z0 * LEVEL_H + h / 2, pos.z);
        band.visible = this.showStrata;
        band.renderOrder = 1;
        this.cityGroup.add(band);
        strata.push(band);
      }
      this.neighborMeshes.push({ nb, mesh, strata, opacity: 1, mat: [sideMat, roofMat] });
    }

    // Cloud deck around the plot.
    const rand = mulberry32(hash32(this.state.seed, 77));
    const cloudMat = new THREE.SpriteMaterial({ map: this.puffTex, color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, fog: false });
    for (let i = 0; i < 34; i++) {
      const s = new THREE.Sprite(cloudMat.clone());
      const size = 3 + rand() * 6;
      s.scale.set(size * 1.6, size * 0.7, 1);
      const c = {
        sprite: s,
        angle: rand() * Math.PI * 2,
        radius: n * 0.75 + 2 + rand() * (n * 0.6 + 8),
        y: (CLOUD_LEVEL - 0.6 + rand() * 1.4) * LEVEL_H,
        speed: (0.01 + rand() * 0.02) * (rand() < 0.5 ? 1 : -1),
        base: 0.35 + rand() * 0.35,
      };
      this.clouds.push(c);
      this.fxGroup.add(s);
    }

    // A small flock that circles whatever is highest.
    for (const b of this.birds) this.fxGroup.remove(b.sprite);
    this.birds = [];
    if (!this.birdTex.length) this.birdTex = [birdTexture(0), birdTexture(1)];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.birdTex[0], color: 0x2a2a30, transparent: true, depthWrite: false }));
      s.scale.set(0.42, 0.21, 1);
      this.fxGroup.add(s);
      this.birds.push({ sprite: s, angle: rand() * Math.PI * 2, radius: 1.6 + rand() * 2.8, dy: 1.4 + rand() * 1.8, speed: (0.35 + rand() * 0.25) * (i % 3 ? 1 : -1), phase: rand() * 10 });
    }
  }

  // ── Per-frame ──────────────────────────────────────────────────────────────

  frame(dt: number) {
    this.clock += dt;
    this.rig.update(dt);
    this.updateDayNight(dt);
    this.updateAnims();
    this.updateNeighbors(dt);
    this.updateClouds(dt);
    this.updateSmoke(dt);
    this.updateLifts();
    this.updateBirds(dt);
    this.renderer.render(this.scene, this.rig.camera);
  }

  private updateAnims() {
    if (!this.anims.size) return;
    const touched = new Set<THREE.InstancedMesh>();
    const m = new THREE.Matrix4();
    const done: number[] = [];
    for (const a of this.animInst) {
      const t0 = this.anims.get(a.id);
      if (t0 === undefined) continue;
      const t = Math.min(1, (this.clock - t0) / 0.28);
      const k = 1 - t;
      const off = k * k * 0.9;
      m.copy(a.base);
      m.elements[13]! += off;
      a.mesh.setMatrixAt(a.index, m);
      touched.add(a.mesh);
      if (t >= 1) done.push(a.id);
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
    for (const [id, t0] of this.anims) if (this.clock - t0 > 0.3) this.anims.delete(id);
    void done;
  }

  private updateDayNight(dt: number) {
    if (this.timeMode === 'cycle') this.dayT = (this.dayT + dt / 240) % 1;
    else {
      const goal = this.timeMode === 'day' ? 0.5 : 0.0;
      let diff = goal - this.dayT;
      if (diff > 0.5) diff -= 1;
      if (diff < -0.5) diff += 1;
      this.dayT = (this.dayT + diff * Math.min(1, dt * 2) + 1) % 1;
    }
    const sun = Math.sin(2 * Math.PI * (this.dayT - 0.25));
    const day = THREE.MathUtils.smoothstep(sun, -0.2, 0.3);
    const dusk = Math.max(0, 1 - Math.abs(sun) / 0.35) * (1 - Math.abs(day - 0.5) * 0.6);
    this.nightFactor = 1 - day;
    this.hemi.intensity = 0.55 + 0.75 * day;
    this.hemi.color.setRGB(0.32 + 0.43 * day, 0.38 + 0.47 * day, 0.6 + 0.4 * day);
    this.hemi.groundColor.setRGB(0.18 + 0.32 * day, 0.16 + 0.26 * day, 0.2 + 0.13 * day);
    this.key.intensity = 0.25 + 1.35 * day;
    this.key.color.setRGB(1, 0.9 - dusk * 0.3, 0.8 - dusk * 0.45);
    // Key light follows the camera so faces always read: top bright, left lit, right in shade.
    const yaw = this.rig.yaw - Math.PI / 4 + 0.35;
    this.key.position.set(Math.sin(yaw) * 10 - Math.cos(yaw) * 6, 16, Math.cos(yaw) * 10 + Math.sin(yaw) * 6).add(this.rig.target);
    this.key.target.position.copy(this.rig.target);
    for (const m of this.glowMats) m.emissiveIntensity = this.nightFactor * 1.15;
    const topDay = new THREE.Color(0x5b9bd8);
    const botDay = new THREE.Color(0xd6e8f2);
    const topNight = new THREE.Color(0x070b18);
    const botNight = new THREE.Color(0x1b2440);
    const topDusk = new THREE.Color(0x3a3570);
    const botDusk = new THREE.Color(0xf0a070);
    const top = topNight.clone().lerp(topDay, day).lerp(topDusk, dusk * 0.7);
    const bot = botNight.clone().lerp(botDay, day).lerp(botDusk, dusk * 0.8);
    this.container.style.background = `linear-gradient(to bottom, #${top.getHexString()} 0%, #${bot.getHexString()} 100%)`;
    (this.scene.fog as THREE.Fog).color.copy(bot);
    const cloudTint = new THREE.Color(0x404860).lerp(new THREE.Color(0xffffff), day).lerp(new THREE.Color(0xffb890), dusk * 0.5);
    for (const c of this.clouds) (c.sprite.material as THREE.SpriteMaterial).color.copy(cloudTint);
  }

  private updateNeighbors(dt: number) {
    const v = this.rig.viewDirFlat;
    for (const nm of this.neighborMeshes) {
      const p = new THREE.Vector2(nm.mesh.position.x, nm.mesh.position.z).normalize();
      // Toward the camera = opposite to the view direction.
      const front = -(p.x * v.x + p.y * v.y);
      const goal = front > 0.25 ? 0.1 : 1;
      nm.opacity += (goal - nm.opacity) * Math.min(1, dt * 6);
      for (const mat of nm.mat) {
        mat.opacity = nm.opacity;
        mat.depthWrite = nm.opacity > 0.95;
      }
      nm.mesh.renderOrder = nm.opacity < 0.95 ? 7 : 0;
      for (const s of nm.strata) s.visible = this.showStrata && nm.opacity > 0.5;
    }
  }

  private updateClouds(dt: number) {
    const v = this.rig.viewDirFlat;
    for (const c of this.clouds) {
      c.angle += c.speed * dt;
      const x = Math.cos(c.angle) * c.radius;
      const z = Math.sin(c.angle) * c.radius;
      c.sprite.position.set(x, c.y, z);
      const front = -(Math.cos(c.angle) * v.x + Math.sin(c.angle) * v.y);
      const mat = c.sprite.material as THREE.SpriteMaterial;
      mat.opacity = c.base * (front > 0.2 ? 0.25 : 1);
    }
  }

  private updateSmoke(dt: number) {
    for (const e of this.emitters) {
      e.acc += dt * e.rate;
      while (e.acc > 1 && this.puffs.length < 220) {
        e.acc -= 1;
        const mat = new THREE.SpriteMaterial({ map: this.puffTex, color: e.color, transparent: true, opacity: 0.5, depthWrite: false });
        const s = new THREE.Sprite(mat);
        s.position.copy(e.pos);
        s.scale.setScalar(0.18);
        this.fxGroup.add(s);
        this.puffs.push({ sprite: s, age: 0, life: 2.6 + Math.random(), vx: (Math.random() - 0.5) * 0.12 + 0.12, vy: 0.55, vz: (Math.random() - 0.5) * 0.12, grow: 0.5 + Math.random() * 0.3, size: 0.18, alpha: 0.5 });
      }
      if (e.acc > 1) e.acc = 1;
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]!;
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.fxGroup.remove(p.sprite);
        p.sprite.material.dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.position.y += p.vy * (1 - t * 0.4) * dt;
      p.sprite.scale.setScalar(p.size + t * p.grow);
      p.sprite.material.opacity = p.alpha * (1 - t) * Math.min(1, t * 6);
    }
  }

  private updateBirds(dt: number) {
    const night = this.nightFactor > 0.6;
    for (const b of this.birds) {
      b.angle += b.speed * dt;
      const flap = Math.floor((this.clock * 7 + b.phase) % 2);
      const mat = b.sprite.material as THREE.SpriteMaterial;
      if (mat.map !== this.birdTex[flap]) {
        mat.map = this.birdTex[flap]!;
        mat.needsUpdate = true;
      }
      b.sprite.visible = !night && this.slice === null;
      b.sprite.position.set(
        this.summit.x + Math.cos(b.angle) * b.radius,
        this.summit.y + b.dy + Math.sin(this.clock * 0.9 + b.phase) * 0.25,
        this.summit.z + Math.sin(b.angle) * b.radius,
      );
    }
  }

  private updateLifts() {
    for (const c of this.liftCars) {
      const s = (Math.sin(this.clock * c.speed * Math.PI * 2 / Math.max(1, c.top / 4) + c.phase) + 1) / 2;
      const eased = s * s * (3 - 2 * s);
      c.mesh.position.y = eased * c.top * LEVEL_H + LEVEL_H * 0.32;
      c.mesh.visible = this.slice === null || c.mesh.position.y < (this.slice + 1) * LEVEL_H;
    }
  }
}
