# Movement Feel — Analysis

Discovery task: what specifically feels wrong about tank movement, and which
of {acceleration curves, input buffering, smooth deceleration} would help
most. This is analysis only — no engine, collision, or level changes. It
gates a future implementation task; game-design §1 (grid-aligned movement,
60px/sec baseline) and the collision/pathfinding rules are unchanged.

## Method

This ran as a non-interactive background agent: no display, no subjective
play session against the live omarchy overlay. Instead of a claim that can't
be backed up, the same state machine `GameLoop.qml` drives —
`src/core/engine.mjs`'s `step()` — was driven directly with `node
--input-type=module`, feeding scripted `InputState` sequences tick by tick.
That gives exact, reproducible numbers (px/tick, ticks-to-transition) for
every question the brief asks, which is strictly more precise than a
subjective impression for the responsiveness/axis/collision questions below.
It cannot stand in for genuinely subjective visual/audio polish (glow, flash,
flicker) — those are called out as unproven, not rounded up to a verdict.

Levels 1, 4, 7, 10 all share the same `moveTank`/`canOccupy` code path (level
data changes only `tiles` and `speedMult`); level 1 was driven directly, and
levels 4/7/10's obstacle density (35% / 50% / 65%, `docs/game-design.md` §2)
was used to reason about where the corridor-width-dependent finding below
gets worse, rather than re-deriving identical engine behavior four times.

## Findings

### 1. Responsiveness — not sluggish

`stepPlayer` (`src/core/engine.mjs:916-937`) reads `input.dir` every tick,
and `moveTank` rotates the tank the same tick a new direction is held:
pressing "right" from rest changes `tank.dir` and begins moving within one
tick (1/60s). `Overlay.qml`'s `heldDirs` (`src/Overlay.qml:37,109-112`) is a
last-pressed-wins stack sampled once per tick, so holding one direction and
tapping another, then releasing it, correctly resumes the still-held
direction. Verified via scripted `step()` sequences.

**Conclusion:** direction-change latency is not a real complaint here.
Input buffering would not fix a responsiveness problem, because there isn't
one to fix.

### 2. Axis-change snap — a verified logic bug, not just a tuning gap

`moveTank` (`src/core/engine.mjs:394-401`):

```js
if (isHorizontal(tank.dir) !== isHorizontal(dir)) {
  if (isHorizontal(tank.dir)) tank.y = Math.round(tank.y / TILE) * TILE;
  else tank.x = Math.round(tank.x / TILE) * TILE;
}
```

The surrounding comment, and game-design §1, both describe this as snapping
"the axis being left" — the axis the tank was just driving along, which is
the one that's off-grid. The code snaps the *other* axis instead: leaving
horizontal movement snaps `y` (which never moved while going left/right, and
was already aligned); leaving vertical movement snaps `x` (same problem in
reverse).

Reproduced with a scripted sequence (level 1, from spawn: "left" ×5, "up"
×3, "left" ×5), logging `x`/`y`/`dir` every tick:

- After 5 ticks left: `x=59` (5px off the 64 gridline), `y=192` (aligned).
- Turning "up": the branch fires on `y` (192 → 192, a no-op) instead of on
  `x`. `x` stays at 59 for the entire 3-tick vertical leg — the tank's 16px
  hitbox straddles tile columns 3 and 4 the whole time it drives "up".
- Turning "left" again: *now* `x` gets snapped (59 → 64) — correcting the
  *previous* leg's drift, one direction-change late.

This is a **one-turn-late correction**, not an unbounded drift or a
permanent stuck state (checked both: drove all four directions from a
mid-sequence position, and extended the alternating sequence — the tank
keeps moving and the lagging axis does eventually get fixed, just a turn
late). Whichever axis was just traveled on stays up to ~8px (half a tile,
worst case) out of grid alignment for the entirety of the *next* leg. This
contradicts the invariant the design doc claims for this code ("keeps
shells, walls, and tank hitboxes aligned to the grid at all times... exact
rather than approximate") and is untested — `tests/core.test.mjs` has no
case exercising player axis changes (only enemy tile-stepping, a different
and unaffected code path, `advance()`).

**Practical effect:** in the maze levels (2+, 30–65% obstacle density per
§2), a tank threading a sequence of tight turns can have its hitbox
overlapping an adjacent column/row it doesn't visually appear to occupy, for
the width of one full leg between turns — reading as "the tank catches on a
wall it shouldn't be touching" or "turns feel unreliable near corners." That
is a concrete, corridor-density-scaling candidate for what a player would
describe as "axis changes feel abrupt," distinct from the intentional
instant-snap behavior game-design §1 asks for.

This is a bug in movement code, not a change to collision rules or
pathfinding (`canOccupy`, `TERRAIN`, and enemy pathing are untouched by it),
so diagnosing it sits inside this task's scope even though fixing it is not
one of the three named tuning candidates and was **not** done here.
**Recommend filing it as its own fix, ahead of any acceleration/deceleration
work** — the "abrupt axis change" complaint an acceleration curve would be
asked to paper over may simply be this bug.

### 3. Collision stop — abrupt by design, not by omission

Driving the player into a wall: the tick `canOccupy` returns false,
`tank.moving` flips to `false` with **zero** partial movement (`x`/`y` delta
exactly 0 that tick and every tick after while still pressed into the wall).
This matches game-design §1's collision matrix exactly ("Movement blocked;
tank cannot enter the tile") — a hard block is the specified behavior, not a
missing feature.

**Implication for any fix:** softening this must not change which tile a
tank may occupy. It belongs in `src/render/draw.mjs` (a visual reaction to
`moving` flipping false against terrain), not in `engine.mjs`/`collision.mjs`
— consistent with "what not to touch: collision rules."

### 4. Sustained movement — genuinely no acceleration/deceleration state

The `Tank` typedef (`src/core/engine.mjs:57-68`) carries no velocity or ramp
field — only `x`, `y`, `dir`, `moving`. Every tick a held direction moves the
tank by exactly `PLAYER.speed` (`60/60 = 1px/tick`, `src/core/constants.mjs:46`)
or by zero; there's no intermediate state. This is the literal mechanism
behind "lacks acceleration," "feels stiff," and "sustained movement is
monotonous" — speed is binary (full baseline or stopped) every tick, with no
ramp on start, release, or (per finding 3) collision stop.

### 5. Edge cases to watch in a follow-up implementation

- Level 1's player spawn is boxed by brick on 3 sides — exercise any
  start-up acceleration ramp or input-buffering change against a spawn tile
  with an immediate adjacent wall, not just open field.
- Enemy movement (`advance()`/`driveEnemy`) is tile-stepping and never calls
  `moveTank`; it snaps per-tile by construction. Finding 2 is player-only.
  A fix to `moveTank`'s axis snap can't regress enemy movement (different
  code path) but should still be re-run against `tests/core.test.mjs`'s
  enemy tests, since both share `tiles`/`canOccupy`.
- Respawn (`PLAYER.respawnDelay` 1s, `invulnerable` 2s, `constants.mjs`)
  sets `state.player` to `null` briefly. Any acceleration ramp keyed off
  "ticks since motion started" must reset cleanly across a respawn rather
  than carrying over a stale value from the tank that just died.

## Unproven / left open

- Subjective visual/audio feel (glow, blur, explosion flash, whether the
  respawn flicker reads well) — not assessable without an actual display
  session; left `unproven`, not claimed either way.
- Whether the axis-snap bug (finding 2) is the dominant driver of any
  *specific* prior player complaint — no complaint text accompanied this
  brief beyond the named candidate list; this treats the bug as the most
  load-bearing discovered fact, not as confirmation of a particular report.
- Exact feel of a proposed acceleration curve — no curve was implemented or
  tuned (out of this task's scope); a follow-up implementation task would
  prototype and re-measure.

## Recommendation (priority order for a follow-up task)

1. **Fix the axis-snap bug** (`engine.mjs:394-401`, finding 2) first. It's a
   correctness fix against the code's own documented invariant, small (swap
   which branch snaps which axis), coverable by a deterministic test using
   the repro above, and may resolve what reads as "abrupt axis changes"
   without any feel/tuning work at all.
2. **Smooth deceleration cushion, visual-layer only**, in `draw.mjs`: react
   to a tank's `moving` flag flipping `false` against terrain with a brief
   visual settle, instead of easing the logical position — keeps the
   grid-exact stop game-design §1 requires.
3. **Short acceleration/deceleration ramp on start/release**, bounded to a
   few ticks and still resolving to the spec's 60px/s baseline — the named
   candidate most directly responsive to "lacks acceleration/deceleration."
   Independent of items 1 and 2.
4. **Input buffering** — lowest priority. Finding 1 shows responsiveness is
   already good at the input layer; buffering would mainly compensate for
   finding 2's corridor snagging, which is better fixed at the source
   (item 1).
