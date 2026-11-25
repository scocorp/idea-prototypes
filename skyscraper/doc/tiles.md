# Tile reference

Generated from `src/game/tiles.ts` by `npm run docs`. Do not edit by hand.

## Era 1: Settlement

Unlocked by: start.

| Tile | Shape | Placement | Needs | Provides |
|---|---|---|---|---|
| **Shanty** (`shanty`) | 1×1 | – | Needs water<br>Uses 1 Food | Makes 2 Labor<br>Houses 4 laborers |
| **Allotment** (`allotment`) | 1×1 | – | Light: sun, piped sun or grow lamp<br>Uses 1 Labor | Makes 3 Food |
| **Well** (`well`) | 1×1 | Ground level only | Uses 1 Labor | Water: 2 tiles around, same level to 1 up |

## Era 2: Tenements

Unlocked by: Laborers housed ≥ 16.

| Tile | Shape | Placement | Needs | Provides |
|---|---|---|---|---|
| **Tenement** (`tenement`) | 1×2 | – | Needs water, drain<br>Uses 2 Food, 1 Goods | Makes 5 Labor<br>Houses 10 laborers<br>-1 Appeal: 1 tile around, same level |
| **Cesspit** (`cesspit`) | 1×1 | Ground level only | Uses 1 Labor | Drain: 1 tile around, same level to 3 up<br>-2 Appeal: 1 tile around, same level to 1 up |
| **Rain Catcher** (`raincatcher`) | 1×1 | – | Light: open sky | Water: 1 tile around, 1 to 4 down |
| **Workshop** (`workshop`) | 1×2 | – | Uses 2 Labor | Makes 2 Goods<br>-1 Appeal: 1 tile around, same level |

## Era 3: Citizens

Unlocked by: Laborers housed ≥ 50, Goods made ≥ 2, Highest working level ≥ 3.

| Tile | Shape | Placement | Needs | Provides |
|---|---|---|---|---|
| **Apartment** (`apartment`) | L | L1 or higher | Light: a window (open side or sky)<br>Needs water, drain, lift access from L5<br>Appeal ≥ 1<br>Uses 2 Food, 1 Goods | Makes 3 Skill<br>Houses 9 citizens<br>Prestige 1 |
| **Garden** (`garden`) | 1×1 | – | Light: open sky<br>Uses 1 Labor | +2 Appeal: 1 tile around, 1 down to 1 up |
| **Market** (`market`) | 1×2 | – | Uses 1 Labor, 1 Goods | +2 Appeal: 2 tiles around, 1 down to 1 up |
| **Solar Array** (`solar`) | 1×1 | – | Light: open sky | Makes 3 Power |
| **Boiler House** (`boiler`) | 1×1 | – | Uses 2 Labor | Makes 4 Power<br>Heat: this column, 1 to 2 up<br>-2 Appeal: 1 tile around, same level to 2 up |
| **Grow Lamp** (`growlamp`) | 1×1 | – | Uses 1 Power | Grow light: 1 tile around, same level |

## Era 4: Metropolis

Unlocked by: Citizens housed ≥ 18, Power made ≥ 6.

| Tile | Shape | Placement | Needs | Provides |
|---|---|---|---|---|
| **Lift** (`lift`) | 1×1 | On the ground or on top of another Lift | Shaft must run unbroken to the ground | Lift access: 3 tiles around, same level |
| **Sewage Works** (`sewage`) | 2×2 | – | Uses 2 Labor, 1 Skill, 1 Power | Drain: 2 tiles around, 1 to 8 up<br>-3 Appeal: 1 tile around, same level to 1 up |
| **Pump Station** (`pump`) | 1×1 | – | Uses 2 Power<br>Must itself be in water to operate | Water: 1 tile around, 1 to 6 up |
| **Clinic** (`clinic`) | 1×2 | – | Uses 2 Skill, 1 Power | +3 Appeal: 3 tiles around, 2 down to 2 up |
| **Foundry** (`foundry`) | 1×3 | – | Uses 4 Labor, 1 Skill, 2 Power | Makes 6 Goods<br>Heat: 1 tile around, 1 to 3 up<br>-3 Appeal: 1 tile around, same level to 3 up |
| **Light Pipe** (`lightpipe`) | 1×1 | – | Must itself be lit by open sky or a Light Pipe above | Piped sun: this column, 1 to 3 down |

## Era 5: Overcity

Unlocked by: Citizens housed ≥ 36, Highest working level ≥ 8.

| Tile | Shape | Placement | Needs | Provides |
|---|---|---|---|---|
| **Penthouse** (`penthouse`) | 1×2 | L6 or higher | Light: open sky<br>Needs water, drain, lift access<br>Appeal ≥ 4<br>Uses 2 Food, 2 Goods, 2 Power, 1 Labor | Houses 2 elites<br>Prestige 6 +1 per appeal above 4 |
| **Bathhouse** (`bathhouse`) | 1×2 | – | Needs water, heat from below<br>Uses 2 Labor | +3 Appeal: 2 tiles around, 1 down to 1 up |
| **Water Tower** (`watertower`) | 1×1 | Nothing can be built on top | Must itself be in water to operate | Water: 2 tiles around, 1 to 6 down |
| **Skybridge** (`skybridge`) | 1×1 | L1 or higher<br>On the plot edge (not a corner) | Uses 1 Labor | Links to the neighbouring tower it faces; effect depends on their stratum |
| **Sky Garden** (`skygarden`) | L | L8 or higher | Light: open sky<br>Needs water<br>Uses 1 Labor | Prestige 3<br>+3 Appeal: 2 tiles around, 2 down to 1 up |

## Era 6: Spire

Unlocked by: Elites housed ≥ 8, Prestige ≥ 60.

| Tile | Shape | Placement | Needs | Provides |
|---|---|---|---|---|
| **Sky Villa** (`skyvilla`) | 2×2 | L12 or higher | Light: open sky<br>Needs water, drain, lift access<br>Appeal ≥ 6<br>Uses 3 Food, 3 Goods, 3 Power, 2 Labor, 1 Skill | Houses 4 elites<br>Prestige 16 +2 per appeal above 6 |
| **Geothermal Bore** (`geothermal`) | 2×2 | Ground level only | Uses 2 Labor, 2 Skill | Makes 12 Power<br>Heat: 1 tile around, 1 to 4 up |
| **Observation Deck** (`obsdeck`) | 1×1 | L12 or higher | Light: open sky<br>Needs lift access<br>Uses 1 Skill | Prestige 0 +0.5 per level<br>+2 Appeal: 1 tile around, same level to 1 down |
| **Capsule Stack** (`capsule`) | 1×1 | – | Needs water, drain<br>Uses 2 Food, 1 Goods, 1 Power | Makes 6 Labor<br>Houses 12 laborers<br>-2 Appeal: 1 tile around, same level |
| **Spire** (`spire`) | 1×1 | L20 or higher<br>Nothing can be built on top | Light: open sky<br>Needs lift access<br>Uses 4 Skill, 6 Power | Prestige 40 |
