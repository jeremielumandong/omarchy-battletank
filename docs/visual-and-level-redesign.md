# Visual and Level Redesign — Gritty Retro Battletank

Status: spec, written by @product-designer. Not implemented. This doc
replaces §5's "Visual Theme (Neon)" palette in `docs/game-design.md` and
supersedes commit `aeef455` ("Source render colors from omarchy's live
active theme") as the palette source of truth. It also revises the level
layouts §2 describes for levels where the layout itself is broken, not just
under-decorated.

No code, collision, enemy AI, spawn logic, or audio is touched here or
implied. Every value below is meant to be copied into `src/render/draw.mjs`
or `src/levels/NN.mjs` verbatim by an engineer, without a design judgment
call left open.

---

## Part 1 — Visual Spec: a fixed, non-theme-sourced palette

### The problem, in the person's terms

The game currently reads its colors from whatever desktop theme the player
happens to have active (`docs/architecture.md` "Rendering", commit
`aeef455`). The player asked for the opposite: a game that looks like a
worn NES cartridge — gunmetal, brass, olive drab, brick, steel-blue — every
time, regardless of what theme their desktop is in. A theme-sourced HUD
accent in hot pink or a background that turns pastel-white under a light
theme both break the "old war machine" mood this game is going for. Fixing
this means deleting the dependency on the live theme entirely, not tuning
it.

### Direction

Pixel-silhouette sprites at NES proportions, flat-shaded (no glow, no bloom
— the `MultiEffect` glow pass `docs/architecture.md:116` describes should be
turned off for this look; that's a rendering-pipeline change, not a color
change, so it's called out here but not decided by this doc). Warm, dusty,
low-saturation colors on a near-black backdrop: think a tank yard at dusk,
not an arcade cabinet. No hue in this palette should read as "neon" —
every color below was chosen at reduced saturation on purpose.

### Palette table (drop into `DEFAULT_THEME`, `src/render/draw.mjs:27-45`)

This table is now the **only** palette. `Overlay.qml`'s `liveTheme()` call
(`docs/architecture.md:127-135`) becomes dead code once these are in place —
an engineer should stop calling it and pass no `theme` argument to
`drawFrame` at all (or pass this exact object), so `DEFAULT_THEME` is what
always renders. That wiring change is implementation, not decided here, but
the palette itself needs no theme lookup to be complete.

| Key (`DEFAULT_THEME` field) | Hex | What it paints | Notes |
|---|---|---|---|
| `background` | `#15140F` | Screen backdrop, banner scrim | Near-black warm charcoal, not blue-black — reads "oil and dust," not "space" |
| `hudText` | `#D9D3BE` | HUD primary text, non-selected menu rows, banner body lines | Bone/khaki white — never pure `#FFFFFF`, keeps the whole screen in one warm family |
| `hudAccent` | `#C8A94E` | HUD level readout, selected menu rows, non-danger banner headlines | Same hex as `player` — ties "the HUD element about you" to "you," matching the existing role (`docs/architecture.md:128-129`) |
| `hudDanger` | `#B8342A` | Low-lives HUD text, base-under-attack flash, danger banner headlines, destroyed-base dot | Muted brick-red, not fire-engine red — distinct enough from `brickEdge` (more orange) and `sniper` (more yellow) to still read as "alert" at a glance |
| `player` | `#C8A94E` | Player tank body and barrel | Brass/khaki-gold — the one warm metallic in a field of drab/steel colors, so it's still the most visually distinct tank without being neon |
| `grunt` | `#6B6E47` | Grunt enemy tank | Olive drab — baseline military green, the "generic soldier" of the palette |
| `sniper` | `#C2A876` | Sniper enemy tank | Desert tan/khaki — lighter and warmer than grunt, reads as "different unit" at a glance |
| `hunter` | `#46545E` | Hunter and Elite Hunter body | Dark slate steel-blue — the coldest, darkest tank color, matching its aggressive role |
| `eliteRim` | `#E0A030` | Elite Hunter's pulsing outline (Level 10) | Amber, not white — a warning-light color that still reads as "different" against the slate-blue hunter body without breaking the no-neon rule. Same pulse timing as today (`PULSE_TICKS = 30`, `draw.mjs:59,249`) — only the color changes |
| `brickFill` | `#5C2E1E` | Brick tile fill | Dark rust brown |
| `brickEdge` | `#9C5A3C` | Brick tile outline + mortar lines (`brickMortar`, `draw.mjs:203-208`, drawn in this color already since it fills with `style.edge` first) | Lighter red-brown, "sun-bleached brick" |
| `steelFill` | `#333F49` | Steel tile fill | Dark gunmetal blue-gray |
| `steelEdge` | `#7C93A0` | Steel tile outline + inset plate (`steelPlate`, `draw.mjs:210-212`) | Lighter cold steel-blue |
| `waterFill` | `#1E3A45` | Water tile fill | Deep teal-navy |
| `waterEdge` | `#4A90A0` | Water tile outline + shimmer scanline (`waterShimmer`, `draw.mjs:215-217`) | Muted steel-teal — the shimmer is still the "this one's different" tell, just not cyan-neon |
| `base` | `#B8B8A0` | Standing base/eagle | Weathered bone-silver, deliberately **not** close to `player`'s gold — the two must stay readable as different things (per the existing "read enemy type/terrain/threat at a glance" rule, `docs/game-design.md:213-214`) |
| `shellCore` | `#EDEAD9` | Shell/bullet bright center (`draw.mjs:230-234`) | Warm off-white, brightest value in the palette so shots always pop against the dark backdrop |

Shell "glow" is not a separate key — `drawShells` (`draw.mjs:225-235`)
already paints the outer square in the firer's tank color and the inner
square in `shellCore`; both are covered by the table above, no new key
needed.

### Terrain not implemented — explicitly out of scope, not silently dropped

The brief asked for forest/bushes and ice. Neither exists in this codebase:
`Glyph` (`src/core/constants.mjs:20-28`) defines only `EMPTY, BRICK, STEEL,
WATER, BASE, PLAYER, SNIPER_POST`, and `TILE_STYLE` (`draw.mjs:65-69`) only
styles `BRICK, STEEL, WATER`. This doc does not invent them — adding a new
terrain type is a code change (new glyph, new collision rule, new validator
case) well outside "replace the palette." If forest/ice terrain is wanted
later, it's a separate feature brief, not a color fill-in here.

### Phase banner colors — already fully covered, no new keys needed

Every entry in `PHASE_OVERLAY` (`draw.mjs:105-124`) draws using only
`background`, `hudAccent`, `hudDanger`, and `hudText` — all four already
specified above. Mapping, so nothing is improvised:

| Phase (banner) | Headline color | Body row color(s) |
|---|---|---|
| `title` | `hudAccent` (`BATTLETANK`) | `hudText` (`PRESS START`) |
| `levelStart` | `hudAccent` | — |
| `playing` → Tank Lost flash | `hudDanger` | — |
| `paused` | `hudAccent` | `hudAccent` (selected row), `hudText` (others) |
| `confirmAbandon` | none (no headline) | `hudText`, `hudText`, then `hudDanger`/`hudText` and `hudAccent`/`hudText` per selection |
| `levelClear` | `hudAccent` | `hudText` |
| `baseDestroyed` | `hudDanger` | — |
| `gameOver` | `hudDanger` | `hudText` |
| `complete` | `hudAccent` | `hudText` |

Banner backdrop in every case is `background` at 0.85 alpha (`draw.mjs:310`,
unchanged). No copy changes — this doc only touches color.

### What was decided not to do (Part 1)

- **Not turning off the neon glow pipeline.** The `MultiEffect` bloom
  (`docs/architecture.md:116`) is a rendering decision, not a palette
  decision; a flat gritty palette under a glow pass will look muddy, so an
  engineer should disable or reduce the glow when wiring this in, but that's
  their call to make and verify visually, not a color value this doc can
  specify.
- **Not inventing forest/ice colors.** Covered above — those tiles don't
  exist; adding them is a separate feature.
- **Not changing any copy, phase timing, or which banner shows when.** Only
  the four colors banners already use are being replaced with fixed hexes.
- **Not making `base` and `player` share a hue.** They used to be
  differentiated by theme accent vs. fixed neon green; now that both are
  fixed, they still need to read as different things at a glance, so they
  deliberately don't share the "warm metallic" family the way they
  incidentally might if picked carelessly.

---

## Part 2 — Level Design Audit and Revision

### The problem, in the person's terms

The player said "the level design is not good" with no specifics. Reading
all 10 level files and checking them against the collision rules the game
itself enforces (not just eyeballing the ASCII) turned up two defects that
aren't a matter of taste — they make the game **unplayable as authored**,
plus smaller convention gaps that are matters of polish.

### Method

Every claim below was checked by running a scratch script
(`.agentops/tasks/ag-01a09b391ebbc82ac24a9f234f/verify.mjs`) that imports
the real `validateLevel`/`obstacleDensity` from `src/core/levels.mjs` and
the real level data from `src/levels/index.mjs`, plus a flood-fill BFS
implementing the actual tank-blocking rule (brick, steel, and water all
block tank movement; only empty/marker tiles don't — `docs/game-design.md`
§1's collision matrix) and a straight-line shell-path check (steel is the
only permanent shell block; brick and water are eventually/always passable
to a shot — same matrix). No game code was created or modified; the script
only imports existing modules read-only. Command and result:

```
$ node .agentops/tasks/ag-01a09b391ebbc82ac24a9f234f/verify.mjs
=== defect A: reachability, shipped levels 1-10 ===
level 1 (Training Ground): playerReachableFromEnemySpawn=true   (131/169 tiles reachable — every open tile)
level 2 (Brick Maze):       playerReachableFromEnemySpawn=true
level 3 (Steel Yard):       playerReachableFromEnemySpawn=true
level 4 (Flood Zone):       playerReachableFromEnemySpawn=false (only 19 tiles reachable — spawn row plus dead-end pockets)
level 5 (Twin Spawn):       playerReachableFromEnemySpawn=false (19 tiles)
level 6 (Narrow Approach):  playerReachableFromEnemySpawn=false (13 tiles)
level 7 (Converging Lanes): playerReachableFromEnemySpawn=false (13 tiles)
level 8 (The Bastion):      playerReachableFromEnemySpawn=false (13 tiles)
level 9 (Triple Assault):   playerReachableFromEnemySpawn=false (13 tiles)
level 10 (Last Stand):      playerReachableFromEnemySpawn=false (13 tiles)

=== defect B: can a shell reach the base in a straight line, shipped levels 1-10 ===
levels 1-7: baseShellReachable=true
levels 8, 9, 10: baseShellReachable=false
```

### Defect A — 7 of 10 levels are unwinnable as authored

**Levels 4 through 10 physically trap the enemy spawn(s).** No tank —
enemy or player — can cross between the spawn side of the map and the
base/player side. `src/levels/06.mjs:12-16` and onward reuse a diagonal
brick/steel/water weave where rows 1 through (5, 6, 7, or 8, growing with
level number) contain **zero empty tiles across all 13 columns**; every
column has at least one Steel or Water cell in that band, and both are
permanent (Steel never breaks, tanks never cross water), so no amount of
shooting brick opens a path. Levels 4-5 (`src/levels/04.mjs`,
`05.mjs`) look less severe — their rows all keep `.` gaps — but the
gaps in consecutive rows are never column-aligned, so each one is an
isolated dead-end pocket off the spawn row rather than a corridor (confirmed
by the flood fill above: only 19 of 169 tiles are ever reached).

Concretely, this means: on levels 4-10, enemies spawned each wave can never
reach the player or the base. Depending on how the (unmodified) enemy AI
handles "no path exists," this is either a soft-lock (nothing ever
approaches, the level never ends) or a wasted difficulty curve (the numbers
in `docs/game-design.md` §2 — enemy count, speed, mix — never get
experienced, since no enemy ever gets close enough to matter). Either way,
this is why "the level design is not good" — it's not a matter of taste, 7
of the 10 levels don't function as levels.

**Why the existing test suite didn't catch this:** `tests/levels.test.mjs`
validates format, counts, and density (`src/core/levels.mjs:148-174`); it
has no reachability check. `node --test tests/levels.test.mjs` passes 23/23
today on the broken maps.

### Defect B — levels 8, 9, 10 have an indestructible base

Levels 8-10 share a base fortress of `.....N.N....." / "......B......" /
".....SSS....." / "....PSES....."` (`src/levels/08.mjs:19-22`, `09.mjs:19-22`,
`10.mjs:20-23`). The base is flanked left, right, and above by **Steel**,
not brick. Steel destroys any shell on contact and takes no damage
(`docs/game-design.md:56-62`); shells only travel in straight lines. Every
straight line to the base tile crosses that steel ring first, so the base
can never be destroyed by any amount of fire, from either side. This
silently removes one of the two documented lose conditions
(`docs/game-design.md:76-83`) for exactly the three hardest levels,
including the stated Level 10 capstone (`docs/game-design.md:98`) — the
level meant to be tensest is the one where the player literally cannot lose
the way the rules say they can.

Levels 1-7 use destructible brick (`BBB`/`PBEB`) for the same fortress role
and are fine — this is a defect introduced specifically at level 8, not
inherent to the "ring the base" idea.

### Lesser findings (polish, not functional bugs)

- **Levels 2-3's brick/steel corridors aren't left-right mirror
  symmetric**, unlike level 1 and unlike most original Battle City stages.
  Not a bug (both levels are fully connected — see the reachability data
  above), but a real convention gap given the brief specifically asks for
  "symmetric brick/steel/water placement." Fixed in the revision below.
- **The player always spawns immediately adjacent to the base** (one brick
  tile between `P` and `E`, every level, e.g. `01.mjs:22-23`). This is
  consistent across all 10 levels, so it's a deliberate convention, not an
  oversight — noted, not changed, since fixing it would touch all 10 maps
  for a minor genre-fidelity gain and the brief's two confirmed defects are
  the priority. Worth a look in a future pass.
- **The difficulty curve itself (enemy count/speed/mix, `docs/game-design.md`
  §2/§4) is sound** and is pinned by a passing test
  (`"levels follow the game-design §4 scaling rules"`). This revision does
  not touch enemy counts, speed multipliers, or wave composition — only
  map geometry. Escalating difficulty was already correctly designed; it's
  just never reached because of Defect A.

### Revised layout: Level 1 — Training Ground (no change)

Already correct: fully connected (every one of 131 non-obstacle tiles is
reachable from the enemy spawn), left-right mirror symmetric, brick-only
base fortress (breachable). Ship as authored
(`src/levels/01.mjs`, unchanged).

### Revised layout: Level 2 — Brick Maze

Keeps the original enemy roster, wave, and speed data (`src/levels/02.mjs`
lines for `speedMult`/`waves` — those numbers are sound, only the map
changes). New map is mirror-symmetric row by row and confirmed connected:

```
......1......
..B.B...B.B..
.B...B.B...B.
B..B..B..B..B
..B...N...B..
.B..B...B..B.
...B.B.B.B...
..B.B...B.B..
....B...B....
.............
.............
.....BBB.....
....PBEB.....
```

Verified: `validateLevel` reports zero problems; `obstacleDensity` = 20.1%
(target 25% ±5%, i.e. 20-30% — at the low edge, acceptable, nudge up 1-2
brick tiles along the symmetry axis if an engineer wants it centered);
`playerReachableFromEnemySpawn` = true; one `N` sniper post, matching the
one sniper the wave spawns.

### Revised layout: Level 3 — Steel Yard

Same treatment — original enemy/wave/speed data kept, map redesigned for
mirror symmetry and confirmed connectivity, now also confirmed the base
stays shell-reachable (brick fortress, unchanged from original):

```
......1......
..S.B.B.B.S..
.B...S.S...B.
S..B..B..B..S
..B...N...B..
.S..B.B.B..S.
.B.B.S.S.B.B.
..S.S...S.S..
..B.B...B.B..
...B.BBB.B...
.............
.....BBB.....
....PBEB.....
```

Verified: `validateLevel` reports zero problems; `obstacleDensity` = 26.6%
(target 30% ±5%, i.e. 25-35% — within range); `playerReachableFromEnemySpawn`
= true; `baseShellReachable` = true; one `N` sniper post against the
original two-sniper wave (rule requires posts ≤ snipers, 1 ≤ 2 holds).

### Pattern / checklist for levels 4-10

Apply every rule below to each of levels 4-10. None of them touch enemy
count, speed multiplier, wave count, or enemy mix — those numbers in
`docs/game-design.md` §2/§4 stay exactly as designed; only map geometry
changes.

1. **No sealed spawn.** After authoring or editing a map, flood-fill from
   every enemy spawn digit (`1`, `2`, `3`) treating Brick, Steel, Water, and
   Base as blocking and everything else (including markers `P`/`N`) as
   open. The player spawn tile `P` must be in the reachable set. This is
   the single check that catches both the levels-4-5 dead-end-pocket
   version of the defect and the levels-6-10 solid-band version — run it,
   don't eyeball it, since both looked "probably fine" by inspection and
   weren't.
2. **No fully-solid row or column band.** A stronger, cheaper pre-check
   before the flood fill: no row (and no set of consecutive rows) may
   contain zero `.`/marker tiles across all 13 columns. This is what broke
   levels 6-10 specifically.
3. **A periodic open collector row.** The reason 1-3 pass check #1 and 4-10
   don't isn't density, it's that 1-3 keep at least one mostly-open row
   (their row 10, and row 5-ish mid-maze gaps) every few rows, which lets
   otherwise-isolated diagonal-weave pockets connect to each other
   horizontally. When authoring a denser maze for higher levels, keep this
   collector-row rhythm instead of weaving diagonally all the way down —
   it's what makes the same visual density stay winnable.
4. **Base fortress stays brick, never steel.** Whatever ring or wall
   pattern guards the base (`BBB`/`PBEB` today), every tile immediately
   flanking the base in the row/column a shell could travel must be Brick,
   never Steel. Steel elsewhere in the level (as a maze obstacle, a choke
   point, cover) is fine and matches the game-design §2 "New this level"
   escalation (level 3+); only the base's own immediate cover must stay
   destructible so "Base Destroyed" remains a real threat at every level,
   including 10.
5. **Keep left-right mirror symmetry** for the maze/obstacle field, the way
   the revised levels 1-3 above do. Point markers (`P`, `N`, spawn digits)
   are exempt — a single spawn or post can't mirror itself; center-column
   placement is the natural symmetric spot for a lone marker when one is
   wanted there.
6. **Re-run the flood fill and the shell-line check after every edit**, not
   just once at the end — the levels-6-10 defect was introduced by
   incrementally adding one more "solid" row per level to an already-broken
   pattern; a per-edit check would have caught it at level 6 instead of
   shipping it five times.

### What was decided not to do (Part 2)

- **Not redesigning levels 4-10's maps in full.** The brief asks for 1-3 in
  full detail plus a pattern for the rest; hand-authoring seven more maps
  risks introducing new, unverified geometry into a spec that can't run the
  game to check it. The checklist above is concrete enough to apply and
  re-verify with the same script used here.
- **Not touching the player-spawn-adjacent-to-base convention.** Flagged as
  a minor genre-fidelity gap, not fixed — it's consistent across all 10
  levels today and changing it is a bigger, all-levels edit for a small
  gain, not one of the two confirmed defects.
- **Not changing difficulty numbers.** Enemy count, speed, wave count, and
  type mix are already correctly derived from `docs/game-design.md` §4's
  rules and pinned by a passing test — only the geometry that was
  preventing players from ever experiencing that curve is being fixed.
- **Not deciding how reachability gets enforced going forward** (e.g.
  whether `tests/levels.test.mjs` should gain an automated flood-fill
  check). That's a testing/engineering call, not a design one — flagging it
  here as a strong recommendation, since this defect shipped silently
  through the existing suite.

---

## Handoff

Two independent, engineer-ready units:

1. **Palette swap** (`src/render/draw.mjs`): replace `DEFAULT_THEME` with
   Part 1's table; stop passing a live theme into `drawFrame`. Small,
   mechanical, no judgment calls left.
2. **Level geometry fix** (`src/levels/02.mjs`, `03.mjs` — drop-in
   replacements above; `04.mjs`-`10.mjs` — apply the Part 2 checklist and
   re-run the reachability/shell-line checks). This is the higher-complexity
   item: it touches 9 of 10 level files and each one needs its own
   flood-fill/shell-line verification before merging, not just a visual
   read of the ASCII.

Not decided, and needs a person: whether to disable the neon glow
`MultiEffect` pass alongside the palette swap (Part 1), and whether
reachability checking belongs in the automated test suite going forward
(Part 2). Both are flagged above at the point they came up, not buried.
