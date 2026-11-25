# Skyscraper: design

## Pillars

1. **Vertical light is the scarce resource.** Every column has exactly one open-sky cell: its top. Building
   higher never creates more sky, it only moves it up. Everything that wants the sun (farms, solar,
   gardens, rain catchers, penthouses) competes for the same N² roof cells.
2. **Building over something working is a real decision.** You can stack on anything. The cost is
   whatever that tile needed from the sky, and the inspector forecasts it before you click.
3. **The top is propped up by the bottom.** Elites live where the sky is, need a great deal, and give
   only prestige. Labor, food, water, drains and heat come from the floors below. When anything runs
   short, the highest floors are supplied first and the undercity goes without.
4. **Spatial puzzle over spreadsheet.** Most rules are positional (adjacency, ranges, columns above and
   below). The global pools exist so that quantities matter, not to be the game.
5. **No clock.** The tower is solved to an equilibrium after every edit. Each edit is one month on the
   chronicle's calendar. Undo is free. This keeps the prototype about the puzzle, not waiting.

## Core rules

- **Structure.** Every cell needs a cell directly below it (or the ground). Buildings are flat polyominoes
  on one level (1×1, 1×2, 1×3, L, 2×2). Remove from the top down; Shift-place replaces in place, which is
  how a buried farm becomes a factory.
- **Light.** *Open sky*: nothing above. *Side light*: an open face on the same level, including lightwells
  left in the middle (depth tunable via `SIDE_LIGHT_DEPTH`). *Dark*: neither. Light Pipes carry sky three
  floors down (chainable); Grow Lamps light the 3×3 around them. Needs are checked on every cell of a
  building ("every room needs a window").
- **Fields** are boxes around a building: horizontal radius (Chebyshev) and a vertical range relative to
  its level. Water falls from Rain Catchers / Water Towers, rises from Pumps, spreads around Wells. Drains
  (Cesspits, Sewage Works) collect from above. Heat rises from Boilers, Foundries, Geothermal Bores. Lifts
  give access on their level. Relays (pumps, towers, light pipes, lift shafts) only work when fed, so every
  chain starts at a real source.
- **Pools**: Labor (laborers), Skill (citizens), Food, Power, Goods. Shared tower-wide, allocated highest
  floor first, then by era, then by age.
- **Appeal** per cell: +1 per 4 levels, +1 open sky, −1 dark, +2 above the clouds (L16), plus nearby
  amenities and minus nearby nuisances. Nuisances count even when the building is idle (a cold boiler is
  still an eyesore). Citizens need 1, penthouses 4, sky villas 6. Elite prestige grows with appeal above
  their need.
- **Bridges.** A Skybridge on a perimeter cell links to the neighbouring tower it faces, at the same level.
  Their strata by fraction of height: undercity (<40%) sends Labor, middle (<80%) trades Food and Goods,
  elite levels give Skill and Prestige but expect a lift and appeal 3 at your end. One bridge per
  neighbour, so the choice is *which level*.

## Progression

Six eras, each unlocked by population and production milestones (see `doc/tiles.md`):

1. **Settlement**: Shanty, Allotment, Well. Learn sun and water radius.
2. **Tenements**: Tenement (needs drains and goods), Cesspit, Rain Catcher, Workshop. Water now comes
   from above, drains from below: the first real vertical pressure.
3. **Citizens**: Apartment (L-shape, every cell needs a window, appeal 1, no tenement neighbours),
   Garden, Market, Solar, Boiler, Grow Lamp. Appeal and power arrive; farms can move indoors.
4. **Metropolis**: Lift, Sewage Works, Pump, Clinic, Foundry, Light Pipe. Infrastructure for height.
5. **Overcity**: Penthouse, Bathhouse (needs heat from below), Water Tower, Skybridge, Sky Garden.
6. **Spire**: Sky Villa, Geothermal Bore, Observation Deck, Capsule Stack, Spire (L20+, the crown).

Each era introduces 3 to 6 plans and at most two new systems, so complexity ramps rather than lands.

## Intended tensions (what makes it a puzzle)

- Roof cells: farms vs solar vs rain catchers vs gardens vs penthouses vs light pipes.
- Rain Catchers must sit *above* what they water, but whatever they water must not need the sky.
- Cesspits drain only to L3; tall towers need Sewage Works, which stink up their own floor.
- Apartments want facade cells and lightwells; tenements and workshops spoil their appeal.
- Heat for a Bathhouse comes with smoke: put appeal back with the bathhouse itself, or pay for clean
  geothermal heat at ground level.
- Every elite needs a servant (Labor) from below; inequality is shown as laborers per elite.
- Bridges: the same neighbour is labor at one height and prestige at another.

## Emergent storytelling

The chronicle diffs the tower before and after each edit: who lost the sun and to what, who went hungry
(always the lowest floors first), milestones, bridges, eras. Each building keeps a short biography shown
in the inspector ("Y2 Mar: lost the sun. Y3 Jan: stopped (Food shortage)").

## Presentation

Orthographic camera, 45° yaw, 30° pitch, 90° rotation over 0.5 s (Q/E). Cutaway hides levels above a
chosen one. Lenses recolour by status, light, water, drain, heat, lift or appeal. Ghost placement shows
the building's field volumes and a forecast. Day/night cycle with lit windows only in operating homes,
a cloud deck at L16, smoke from chimneys, lift cars, neighbouring towers that fade when they would block
the view, bridges reaching into the haze.

## Open questions

- Is a clockless equilibrium tense enough, or does it need a stock (money/materials) to make each
  placement cost something? Free undo makes it an optimisation sandbox rather than a survival game.
- Plot size sweet spot: 12 feels tight and readable; 16 gives room for districts; 20 may be tedious
  without multi-tile painting.
- Is "highest floor first" allocation the right cruelty? It is thematic but can cascade hard.
- Should lifts be required for laborers above some height? Currently "the stairs are for the poor".
- Do multi-cell shapes add enough? Candidates: T and S shapes, 2×3 landmarks.
- Neighbour towers are static. Should they grow, or offer contracts?

## Ideas backlog

- Glass tiles that pass light (greenhouses that can be stacked; atriums).
- Load-bearing strength: weak shanties cannot carry ten floors; foundations become a planning layer.
- Paint mode (drag to place many 1×1 tiles), blueprint copy/paste.
- Scenario seeds with goals ("house 40 elites on a 12×12 with no solar").
- Per-tile flavour names and residents; events (fire, strike, blackout) driven by sustained shortages.
- Sound: wind rising with height, rain on catchers, the undercity hum.
