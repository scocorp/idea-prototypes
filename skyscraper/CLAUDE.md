# Skyscraper

Browser prototype of a vertical city-builder, seen from a fixed 45° yaw, 30° pitch orthographic camera.
You stack tiles on an N×N plot (8/12/16/20). Sunlight falls straight down, so whatever you build on top
of something takes its sun; the covered floors become an undercity that has to keep the luxurious top
running. The question this prototype answers: is the spatial optimisation puzzle fun?

TypeScript, Three.js, Vite. No framework for the UI (plain DOM).

## Commands

```bash
npm install
npm run dev        # Vite dev server with HMR
npm run check      # typecheck + tests + build (what CI runs)
npm test           # node --test, logic only (Node >= 22.18 runs .ts directly)
npm run build      # dist/index.html: one self-contained file, open it from disk
npm run docs       # regenerate doc/tiles.md from src/game/tiles.ts
```

## Layout

| Path | What |
|---|---|
| `src/game/` | Pure game logic, no DOM or Three.js. Safe to import from Node tests. |
| `src/game/tiles.ts` | Tile catalogue, eras and requirements as data. Most balance changes happen here. |
| `src/game/config.ts` | Tunables (side-light depth, lift range, cloud level, bridge payouts...). |
| `src/game/evaluate.ts` | Solves the whole tower each edit: light, fields, resource allocation. |
| `src/game/world.ts` | Occupancy grid and structural placement rules. |
| `src/game/state.ts` | Game state, actions (place/demolish), unlock progression. |
| `src/game/chronicle.ts` | Narrates before/after diffs into the chronicle and per-building logs. |
| `src/render/` | Three.js scene (`view.ts`), camera rig, voxel picking, procedural textures and props. |
| `src/ui/hud.ts` | DOM overlay: resources, palette, inspector, lenses, chronicle, dialogs. |
| `src/app.ts` | Controller: input, previews/forecasts, undo, autosave. `window.skyscraper` in the browser. |
| `test/` | `node:test` suites for game logic. |
| `doc/` | Agent-facing docs, see below. |

## Docs

- `doc/design.md`: the game design, why each system exists, open questions. Read before changing rules.
- `doc/architecture.md`: data flow, the evaluation algorithm and its invariants, rendering, persistence.
- `doc/tiles.md`: generated tile reference. Regenerate with `npm run docs` after editing tiles.

## Conventions

- `src/game` must stay free of DOM/Three.js imports so it can be tested in Node.
- Use `.ts` extensions in relative imports and only erasable TypeScript syntax (no enums, namespaces or
  parameter properties); Node strips types natively for tests.
- Placement only enforces structure (support, bounds, occupancy, placement rules). Functional needs
  (light, water...) never block placement; they decide whether a building operates.
- Game state is plain JSON and saved verbatim (localStorage + export). Bump `v` in `GameState` and
  handle migration in `save.ts` if the shape changes.
- Text from saves is untrusted: render it with `textContent`, never `innerHTML`.
- Browser hooks for quick experiments: `skyscraper.newTower(16, true)` (sandbox),
  `skyscraper.placeAt('lift', 5, 5, 0)`, `skyscraper.look({ lens: 'water', slice: 4, time: 'night' })`.
