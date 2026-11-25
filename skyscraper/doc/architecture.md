# Skyscraper: architecture

## Data flow

```
input (app.ts) ──place/demolish──▶ state.ts ──▶ evaluate.ts ──▶ chronicle.ts
      │                              │              │
      │                              ▼              ▼
      └──────── preview ───▶ withBuilding()+evaluate()  ──▶ forecast (hud.ts)
                                     │
                     view.ts (Three.js) + hud.ts (DOM) render state + evaluation
```

- `GameState` (types.ts) is plain JSON: buildings with anchor, rotation, flip and derived cells, plus
  era, unlocked plans, neighbours, chronicle and milestone flags. Actions clone it (`structuredClone`).
- `evaluate(state)` is pure and recomputed from scratch after every edit and for every hover preview.
  It returns per-building `active` / `reasons` / `appeal` / `prestige`, per-cell `light`, `fields` and
  `appealCell`, and aggregate `stats`. A 900-building tower evaluates in a few milliseconds.
- `app.ts` keeps the current `(state, evaluation)` pair, an undo stack of states, and autosaves to
  localStorage after each change.

## Evaluation algorithm (evaluate.ts)

1. **Structural light** per occupied cell: sky if nothing above, side if any cell within
   `SIDE_LIGHT_DEPTH` (Manhattan, same level) is open or off-plot.
2. **Static nuisances**: negative appeal is stamped for every built building, active or not.
3. **Phase A (switch off)**: start with every building active. Repeat until nothing changes:
   compute fields from the active set (relays by least fixed point), switch off buildings with unmet
   local needs, then allocate pools in priority order (z desc, era desc, id asc) and switch off
   consumers that do not fit. Everything here only shrinks, so it terminates.
4. **Phase B (switch back on)**: greedily reactivate, in priority order, anything whose local needs now
   pass and whose pool needs fit in the current slack. Activation only adds supply and positive
   fields, so it never breaks an already-active building. This undoes over-eager cascades from Phase A.
5. **Final pass**: recompute fields, explain every idle building, aggregate stats, prestige, bridges.

Invariants worth keeping:
- Appeal must stay monotone in the active set. That is why negative appeal is counted for idle
  buildings too. A positive-and-negative emitter that only counts while active would break Phase A/B
  soundness.
- Relays must not be able to feed each other without a source (tested: pump ⇄ water tower).
- Allocation order is part of the design ("higher floors first"), not an implementation detail.

## Rendering (src/render)

- `View` owns the Three.js scene. Buildings are drawn as one `InstancedMesh` per (tile type, active)
  with a 6-material box: procedural canvas facade (+ window glow map for night), roof, bottom.
  Cells of the same building butt together; different buildings get a small gap.
- Roof props (crops, solar, tanks, chimneys...) are merged vertex-coloured geometries, instanced per
  kind, only drawn on open-sky cells. Glowing parts are a separate unlit mesh.
- Lenses swap tile meshes for one plain instanced mesh coloured per cell, plus translucent plates on
  each column's next free cell for field lenses.
- Cutaway hides levels above the slice and draws them as faint glass; picking ignores them.
- Picking is an exact voxel DDA (`pick.ts`) against the occupancy grid, not mesh raycasts. The hit
  face's normal gives the placement target; Shift targets the hit cell itself (replace).
- `CameraRig`: orthographic, fixed pitch, yaw animated over 0.5 s with an ease, zoom to cursor,
  grab-and-drag pan that re-centres the pivot along the view axis so rotation stays around the plot.
- Neighbour towers, bridge spans, a cloud deck, chimney smoke and lift cars are cosmetic and rebuilt
  from state. Towers between the camera and the plot fade out.

## Persistence

- Autosave: `localStorage['skyscraper.save.v1']` after every change. Export/import is the same JSON.
- `deserialize` validates types, recomputes building cells from type/anchor/rotation, drops overlapping
  or floating buildings, and regenerates neighbours if missing.

## Adding a tile

1. Add a `TileDef` to `TILES` in `src/game/tiles.ts` (shape, era, placement, needs, makes, emits, look).
2. If it needs behaviour the data model cannot express, extend `evaluate.ts` (see `special`, `relay`).
3. New prop? Add a `PropKind` in types.ts and a model in `render/props.ts`. New facade style? `textures.ts`.
4. Optional chronicle line in `chronicle.ts` `FIRST`.
5. `npm run docs` to refresh `doc/tiles.md`; add a test if it introduces a rule.

## Build and CI

- `vite build` with `vite-plugin-singlefile` emits one self-contained `dist/index.html`.
- `.github/workflows/skyscraper.yml` runs typecheck, tests and build on every push/PR touching
  `skyscraper/`, uploads `skyscraper.html` as an artifact, and on `main` refreshes the
  `skyscraper-latest` pre-release with the file attached.
