# Battletank — Game Design Doc

Single-player, NES-style top-down tank battle. 10 hand-authored levels, neon
visual theme. This doc is the spec an engineer builds against; it contains no
code. Numbers marked "default" are the designer's chosen starting values —
tune them in playtesting, but the *rules that generate them* (Difficulty
Scaling Rules) should stay the source of truth so the curve doesn't drift
level to level.

The repo had no existing code, UI, or docs at the time of writing, so nothing
here is inherited convention — this doc *is* the convention going forward.

## 1. Core Mechanics

### Playfield

- Grid: 13×13 tiles, 16px per tile (logical unit; renderer may scale up).
  This matches the genre reference (Battle City / Tank 1990) and keeps
  collision and enemy pathing simple to reason about.
- One player tank, one **Base** (see below), a mix of destructible/
  indestructible terrain, and a level-defined roster of enemy tanks.
- Enemies enter at three fixed spawn slots, as in NES Battle City: the
  top-left, top-center and top-right tiles, taken in turn (left, center,
  right) as the roster spawns. A slot a tank stands on is skipped; with all
  three occupied the next enemy waits. A Sniper with a free sniper post
  starts on the post instead. The spawn digits in level maps no longer place
  anything.

### Movement & rotation

- Four-directional only: Up, Down, Left, Right. No diagonal movement, no
  free rotation.
- Pressing a direction rotates the tank to face that direction instantly
  (no turn animation delay) and begins moving that way.
- Movement is continuous in pixels along the current axis, at a constant
  speed (default **60px/sec** baseline, see Difficulty Scaling for the
  per-level multiplier). It is not a hard tile-to-tile teleport.
- Changing axis (e.g. moving Right, then pressing Up) snaps the tank to the
  nearest tile-aligned line on the axis being left before it starts moving
  on the new axis. This keeps shells, walls, and tank hitboxes aligned to
  the grid at all times, which is what makes the collision rules below exact
  rather than approximate.

### Shooting

- One fire button. Tapping it fires if the cooldown has elapsed; holding it
  down does not auto-repeat.
- Player fire cooldown: **0.4s**, default. Only **1 player shell may be live
  on screen at a time** — firing again before the current shell is destroyed
  or off-screen does nothing (classic genre constraint; keeps shots
  meaningful instead of spray-and-pray).
- Shell speed: **2.5×** current tank speed, default. Shells travel in a
  straight line from the firing tank's facing until they hit something or
  leave the playfield.

### Collision

One-hit-kill for every tank in the game (player and enemy alike) — no HP
bars, see [§8](#8-what-we-decided-not-to-do-and-why) for why. Full matrix:

| A | B | Result |
|---|---|---|
| Shell | Brick wall | Brick tile destroyed; shell destroyed |
| Shell | Steel wall | Shell destroyed; steel unaffected |
| Shell | Water | No effect; shell passes through |
| Shell | Base | Base destroyed → **Base Destroyed** state ([§6](#6-winlose-conditions)) |
| Shell | Any tank (player or enemy) | Tank destroyed instantly, unless the tank is currently invulnerable ([below](#lives--health)) |
| Shell | Shell | Both destroyed on contact, regardless of owner |
| Tank | Brick / Steel wall | Movement blocked; tank cannot enter the tile |
| Tank | Water | Movement blocked (water stops tanks but not shells) |
| Tank | Base | Movement blocked; a tank cannot drive onto its own base tile |
| Tank | Tank | Movement blocked; tanks are solid to each other |

### Lives & health

- The player starts each game with **3 lives**, tracked for the whole run,
  not per level.
- Losing a life: tank explodes (~0.5s animation), life count decrements,
  tank respawns at the level's player spawn point after a **1s** delay, then
  is **invulnerable for 2s** (visibly flickering) so it can't be immediately
  re-hit while re-orienting.
- Losing the last life → **Game Over** ([§6](#6-winlose-conditions)).
- The **Base** is a separate, always-one-hit structure the player defends
  (an eagle/bunker in genre terms). It has no health bar — it is either
  standing or destroyed. Base destroyed ends the game immediately,
  regardless of lives remaining. This gives the player two distinct ways to
  lose (attrition via lives, or one lapse in base defense), which is what
  makes "win/lose conditions" per level worth designing in depth rather than
  being a single flat rule.

## 2. Level Progression (Levels 1–10)

| Level | Enemies | Grunt / Sniper / Hunter | Speed ×  | Obstacle density | Map complexity | New this level |
|---|---|---|---|---|---|---|
| 1 | 6 | 100 / 0 / 0 | 1.00 | 20% | Open layout, single spawn, brick ring around base | — (tutorial) |
| 2 | 7 | 90 / 10 / 0 | 1.04 | 25% | Brick maze corridors | Sniper enemy |
| 3 | 9 | 80 / 20 / 0 | 1.08 | 30% | Steel wall clusters added | Steel (indestructible) terrain |
| 4 | 10 | 55 / 30 / 15 | 1.12 | 35% | Water hazards added | Hunter enemy; water terrain |
| 5 | 11 | 40 / 30 / 30 | 1.16 | 40% | Two spawn points, symmetric maze | Multi-wave spawning (2 waves) |
| 6 | 13 | 25 / 30 / 45 | 1.20 | 45% | Narrower base-approach corridors | Sniper engagement range increases |
| 7 | 14 | 15 / 30 / 55 | 1.24 | 50% | Multiple lanes converge on base | Hunters spawn and approach in pairs |
| 8 | 15 | 15 / 30 / 55 | 1.28 | 55% | Base ringed by steel, one brick choke point | Fixed Sniper pair guards the choke point |
| 9 | 17 | 15 / 30 / 55 | 1.32 | 60% | Two spawn points, 3 waves | Three-wave spawning |
| 10 | 18 | 15 / 30 / 55 | 1.36 | 65% | Full mix: brick + steel + water combined | Elite Hunter (2-hit kill) capstone enemy |

Enemy mix intentionally plateaus at Level 7 (15/30/55) — from there on,
difficulty comes from count, speed, and density climbing further, not from
further composition change. That's a deliberate, stated rule, not a gap in
the table (see [§4](#4-difficulty-scaling-rules)).

## 3. Enemy Types

### Grunt (introduced Level 1)

The baseline enemy. Teaches the core loop before anything else is added.

- **Behavior:** advances toward the Base (its default target) or the player
  tank if the player is closer, using simple wall-avoiding pathing. Fires
  whenever it has direct line-of-sight to its target.
- **Speed:** 1.0× the level's base enemy speed (i.e. tracks the level
  Speed × column directly).
- **Fire cooldown:** 1.2s. **Hits to destroy:** 1.

### Sniper (introduced Level 2)

Punishes standing still in a straight line; teaches the player to break
line-of-sight instead of trading shots.

- **Behavior:** holds its position rather than advancing. Only repositions
  (retreats) if the player tank closes to short range. Fires only when it
  has a clear straight-line shot along its row or column, preceded by a
  **0.3s aim-flash** telegraph before the shot fires.
- **Speed:** 0.6× Grunt speed (slow when it does reposition).
- **Fire cooldown:** 2.0s. **Shell speed:** 1.5× normal shell speed.
  **Hits to destroy:** 1.
- **Level 6+ change:** engagement range (the max straight-line distance at
  which it will fire) increases — this is the stated "new mechanic" for
  Level 6, not a new enemy type.

### Hunter (introduced Level 4)

The aggressor. Forces the player to keep moving instead of camping near the
base.

- **Behavior:** actively pathfinds toward the player tank specifically (not
  the Base), attempting to flank rather than approach head-on.
- **Speed:** 1.3× Grunt speed.
- **Fire pattern:** burst of 2 shots, 0.3s apart, then an 1.8s cooldown
  before the next burst. **Hits to destroy:** 1.
- **Level 7+ change:** Hunters spawn and advance in coordinated pairs
  (stated Level 7 mechanic).
- **Elite Hunter (Level 10 only):** identical behavior and fire pattern, but
  takes **2 hits** to destroy, and renders with a pulsing white rim over its
  base color so the player can immediately tell it's the tougher variant
  (see [§5](#5-visual-theme-neon)). Exactly one appears, as the level's
  capstone encounter, spawned last among its wave.

## 4. Difficulty Scaling Rules

These formulas generate the Level Progression table in §2. The table is
derived data — if a level's numbers ever need to change, change the rule
here first so the whole curve moves together.

- **Enemy count:** `EnemyCount(L) = 5 + L + floor(L / 3)`
- **Speed multiplier:** `SpeedMult(L) = 1.00 + 0.04 × (L − 1)`
- **Obstacle density:** `Density(L) = 20% + 5% × (L − 1)`
- **Sniper share:** `0` for L = 1; `min(30%, 10% × (L − 1))` for L ≥ 2
- **Hunter share:** `0` for L ≤ 3; `min(55%, 15% × (L − 3))` for L ≥ 4
- **Grunt share:** `100% − SniperShare(L) − HunterShare(L)`
- **Waves:** 1 wave for L 1–4, 2 waves for L 5–8, 3 waves for L 9–10. A wave
  spawns once the previous wave's enemies drop below a third of that wave's
  count, not only once it's fully cleared — keeps pressure continuous
  instead of leaving a dead calm between waves.

Applying `SniperShare`/`HunterShare`/`GruntShare` to `EnemyCount(L)` and
rounding to the nearest whole enemy produces the roster counts in §2.

## 5. Visual Theme (Neon)

Direction: pixel-silhouette sprites (NES-resolution proportions) rendered
with a thin neon bloom/glow outline — closer to a vector arcade cabinet
(Tempest, Geometry Wars) crossed with Battle City's readability than to
flat retro pixel art. Dark near-black backdrop so every neon color pops.

### Palette

Not a fixed palette: colors come from omarchy's live active theme where a
theme has an equivalent role, and from a fixed fallback otherwise. This
replaced an earlier draft of this section that hardcoded all fifteen hex
values regardless of the user's theme — see docs/architecture.md
"Rendering" for how the lookup works. The hexes below are the fallback
values (`DEFAULT_THEME` in `src/render/draw.mjs`), shown so this doc still
reads as a concrete spec; the "Source" column says whether a given element
actually uses that hex or is overridden live.

| Element | Fallback hex | Source | Notes |
|---|---|---|---|
| Background / void | `#0A0A12` | Theme `background` | Near-black navy is only the fallback for a theme with no active override; a light theme's background applies here too |
| Player tank | `#00F0FF` | Theme `accent` | The theme's one "this is the highlight" role — always the most visually distinct thing on screen |
| Grunt enemy | `#FF6A00` | Fixed | Neon orange. No theme role fits a specific enemy type; see "Why enemy/terrain colors stay fixed" below |
| Sniper enemy | `#FFE600` | Fixed | Neon yellow |
| Hunter enemy | `#B026FF` | Fixed | Neon violet |
| Elite Hunter rim (L10) | `#FFFFFF` pulsing over `#B026FF` | Fixed | Pulses ~1Hz; the "this one's different" tell |
| Brick (destructible) | fill `#3A1220`, edge `#FF3864` | Fixed | Warm neon red-pink edge on dark fill |
| Steel (indestructible) | fill `#1A2233`, edge `#4DA6FF` | Fixed | Cool blue-grey, reads as "hard" against brick's warm red |
| Water | fill `#0F3057`, animated edge `#00C2FF` | Fixed | Edge shimmer/scanline animation signals "different rule" (blocks tanks, not shells) |
| Base | `#39FF14` | Fixed | Neon green — the one thing on the map that must never turn red until it's already destroyed |
| Shell / projectile | core `#FFFFFF`, glow = firer's color | Fixed | Glow color lets the player read a shot's origin at a glance without checking the HUD |
| HUD text (primary) | `#FFFFFF` | Theme `foreground` | |
| HUD accent | `#00F0FF` | Theme `accent` | Matches player color, ties HUD to "you" |
| HUD danger | `#FF2E4D` | Theme `urgent` | Low lives, base-under-attack flash; `urgent` is already omarchy's "needs attention" role |

**Why enemy/terrain colors stay fixed.** omarchy's theme only exposes 5
foundational roles (`background`, `foreground`, `accent`, `urgent`,
`muted`) — enough for one "you" color and a text/background pair, not
enough to derive 8+ simultaneous, mutually distinct gameplay colors from.
Deriving them algorithmically from an arbitrary theme risks two enemy
types (or brick vs. steel) landing too close to tell apart under some
theme, which breaks the whole point of this section: reading enemy type,
terrain, and threat "at a glance... without checking the HUD." So these
stay the fixed neon literals above regardless of the active theme; only
the colors with a direct theme-role equivalent (background, player/HUD
accent, HUD text, HUD danger) follow the live theme.

### HUD layout

Single top strip, gameplay field fills the rest of the screen (no bottom
bar — keeps the play area maximal, matches NES-era top-HUD convention):

```
┌─────────────────────────────────────────────────────────┐
│  LIVES ×3        LEVEL 03/10        ENEMIES 07      (●)  │
├─────────────────────────────────────────────────────────┤
│                                                           │
│                     [ playfield ]                        │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

- **Lives** (top-left): small cyan tank-silhouette icons ×3, not a numeral
  alone — recognizable at a glance mid-fight.
- **Level** (top-center): current / total, e.g. `LEVEL 03/10`.
- **Enemies remaining** (top-right): live numeral counter, decrements as
  enemies are destroyed, including not-yet-spawned enemies in later waves.
- **Base status dot** `(●)` (far right): green, matches Base color; flashes
  red for 0.5s on any hit the Base's surrounding brick takes (an early
  warning, since the Base itself has no health bar and one hit ends the
  run) — reason: a person who is not watching the base tile directly still
  needs a signal that it's under threat.

## 6. Win/Lose Conditions

### Per level

- **Win:** every enemy allotted to the level (`EnemyCount(L)`, across all
  its waves) is destroyed, the Base still stands, and the player has ≥1 life
  remaining. Advances to the next level.
- **Setback (not level-ending):** the player's tank is destroyed. If lives
  remain, respawn and continue the same level with its remaining enemies
  and wave state intact.
- **Lose (run-ending):** either the player loses their last life, or the
  Base is destroyed at any life count. Both end the entire run, not just
  the level — there is no per-level retry or checkpoint (see
  [§8](#8-what-we-decided-not-to-do-and-why)).

### Overall

- **Game Complete:** clearing Level 10.
- **Game Over:** losing the run per the rule above, on any level. The next
  attempt restarts from Level 1.

### States

Every state a run can be in, so none of them get improvised at build time:

| State | What the person sees | What they can do |
|---|---|---|
| Title (first thing seen) | Title screen, static | Press Start |
| Level Start | Level number banner, ~1.5s, gameplay frozen | Nothing — auto-advances |
| In-Level | Live HUD, enemies active | Move, aim, fire |
| Tank Lost (setback) | Explosion anim (~0.5s), life count ticks down, brief flash | Nothing during the ~1s respawn delay; then resumes control, invulnerable 2s |
| Level Clear (success) | "Level clear" banner ~2s with enemies-destroyed / lives-left tally | Nothing — auto-advances to next Level Start |
| Base Destroyed (destructive, terminal) | Immediate freeze, "Base destroyed" overlay ~1.5s | Nothing — always proceeds to Game Over; there is no undo once this triggers, so the message must make the cause unambiguous |
| Game Over (terminal) | Final stats: level reached, enemies destroyed | Restart from Level 1, or quit to Title |
| Game Complete (terminal, whole game) | Final stats, distinct screen from a per-level clear | Return to Title |
| Paused | "Paused" overlay, gameplay frozen | Resume, Restart Level, or Abandon Run |
| Abandon Run confirm (destructive, mid-run) | Confirmation naming what is lost | Abandon Run, or Keep Playing |

## 7. Copy (verbatim)

| Where | Text |
|---|---|
| Title screen | `BATTLETANK` |
| Title screen prompt | `PRESS START` |
| Level start banner | `LEVEL {n}` |
| HUD — lives | `LIVES ×{n}` |
| HUD — level | `LEVEL {n}/10` |
| HUD — enemies | `ENEMIES {n}` |
| Tank lost flash | `TANK LOST` |
| Level clear banner | `LEVEL CLEAR` |
| Level clear tally | `{destroyed} destroyed · {lives} lives left` |
| Base destroyed overlay | `BASE DESTROYED` |
| Game over headline | `GAME OVER` |
| Game over subtext | `Reached Level {n}. Press Start to try again.` |
| Game complete headline | `MISSION COMPLETE` |
| Game complete subtext | `All 10 levels cleared.` |
| Pause overlay | `PAUSED` |
| Pause option — resume | `RESUME` |
| Pause option — restart | `RESTART LEVEL` |
| Pause option — quit | `ABANDON RUN` |
| Abandon confirm prompt | `Abandon this run? Your progress since Level 1 will be lost.` |
| Abandon confirm — confirm | `ABANDON RUN` |
| Abandon confirm — cancel | `KEEP PLAYING` |

Every button that ends the run in progress is labeled with what it destroys
(`ABANDON RUN`, not `QUIT` or `OK`) per this doc's own copy rule.

## 8. What We Decided Not to Do, and Why

- **No power-ups** (shield, speed boost, extra shell capacity). Keeps this
  doc's scope to exactly the mechanics and progression the brief asked for.
  Clean extension point for later — the collision and HUD sections don't
  need to change shape to add one.
- **No 2-player mode.** The genre reference (Battle City) supports it, but
  the brief and the empty repo both describe a single-player game; adding
  a second player multiplies the state table (§6) for no asked-for benefit.
- **No persistent save, high score, or leaderboard.** There is no backend
  or storage layer in this repo yet. A run always restarts at Level 1 on
  Game Over, matching NES-era arcade convention rather than inventing a
  persistence requirement nobody asked for.
- **No procedural level generation.** All 10 levels are hand-specified in
  §2 so the difficulty curve is exactly the one designed and tested here.
  Procedural generation is a legitimate future direction, but it would
  fight this doc's whole point, which is a curve an engineer can build
  against directly.
- **No tank selection or cosmetic customization.** One player tank, one
  look, consistent with the single-craft convention of the genre reference.
- **No diagonal movement.** Four-direction-only is a genre convention
  (Battle City) and it is what keeps the collision matrix in §1 exact
  instead of approximate — diagonal movement would require sub-tile
  collision math this doc doesn't specify.
- **No numeric health/armor for any tank.** One-hit-kill (two for the
  single Level 10 Elite Hunter) keeps "who can I still shoot safely" legible
  at a glance on an NES-style HUD, instead of needing per-tank health bars
  that this visual theme (§5) doesn't have room for.
