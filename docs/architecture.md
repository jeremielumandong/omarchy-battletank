# Battletank architecture

Status: decided by @architect on 2026-09-13. Game rules, numbers, palette and
copy live in [`game-design.md`](game-design.md); this note covers how the game
is built and shipped.

## Decision

Battletank is an **omarchy shell plugin of kind `overlay`**, written in QML
(Qt Quick 6.11, run by Quickshell inside `omarchy-shell`) around a
**game core of plain ES modules** (`src/core/*.mjs`) that imports nothing from
Qt.
- QML owns the window, the keys, the frame clock and the painting.
- The core owns every rule: `step(state, input)` advances a plain-data
  `GameState` by one fixed 1/60 s tick.
- Levels are **data files** (`src/levels/NN.mjs`), validated once when the game
  opens.
- There is no third-party engine. The same `.mjs` files load in QML and in Node,
  so all game logic is tested with `node --test`, as the user's
  `arkane.fat-cat` and `arkane.screenhop` plugins already do.

**Rejected**
- **A web engine (Phaser/Kaboom) in a Chromium `--app` window.** It is not an
  omarchy plugin: the manifest contract loads QML entry points only
  (`/usr/share/omarchy/bin/omarchy-plugin-validate`). It would also add a browser
  process and a second runtime.
- **A native game (LÖVE, pygame, Rust + SDL) behind a `.desktop` launcher.** It is
  not a plugin either, and none of those toolchains is installed on the target
  machine.
- **`.json` level files.** QML cannot `import` JSON, and Qt 6.11 refuses local
  `XMLHttpRequest` reads by default ("Using GET on a local file is disabled by
  default"). JSON would need an async `FileView` path in QML and a second reader
  in Node.

## Boundary

The one interface this design introduces is the core API, which QML calls and
tests pin:

```js
// src/core/engine.mjs
export function createGame(levels, options = {}) {}  // -> GameState on "title"; throws on a bad level
export function step(state, input) {}                // one tick; mutates and returns state
export function emptyInput() {}                      // { dir: null, fire: false, start: false, pause: false }

// InputState: held levels, never edges.
// { dir: "up"|"down"|"left"|"right"|null, fire, start, pause }
// Phase: "title" | "levelStart" | "playing" | "paused" | "confirmAbandon"
//      | "levelClear" | "baseDestroyed" | "gameOver" | "complete"
```

The level file format is the data half of the same boundary:

```js
// src/levels/NN.mjs, validated by src/core/levels.mjs
export const level = {
  id: 1, name: "Training Ground",
  map: ["......1......", /* 13 rows of 13 glyphs */],
  speedMult: 1.0,
  waves: [{ enemies: [{ type: "grunt", count: 6 }] }],
  rules: { sniperRangeTiles: 6, hunterPairs: true },  // optional
};
```

The full typedefs (`GameState`, `Tank`, `Shell`, `GameEvent`) are in
`src/core/engine.mjs`. Nothing outside this repo changes. The plugin never
writes `~/.config/omarchy/*`: enabling it and binding keys are the user's own
steps (see README).

## Packaging, registration, launch

- **Packaging.** The repo root *is* the plugin folder: `manifest.json`
  (`schemaVersion: 1`, `id: "arkane.battletank"`, `kinds: ["overlay"]`,
  `entryPoints.overlay: "src/Overlay.qml"`). `omarchy plugin add <git-url>`
  clones it to `~/.config/omarchy/plugins/arkane.battletank/`.
  - Validation forbids symlinks and `..` in entry points, so every asset stays
    inside the repo.
- **Registration.** `omarchy plugin enable arkane.battletank` adds the id to
  `plugins[]` in `~/.config/omarchy/shell.json`. A disabled plugin cannot be
  summoned (`/usr/share/omarchy/shell/shell.qml:1162`).
- **Launch.** `omarchy-shell shell toggle arkane.battletank '{}'`.
  - The shell mounts `Overlay.qml`, injects `shell` and `manifest`
    (`shell.qml:1340-1345`), and calls `open(payloadJson)`.
  - `hide` calls `close()` and unloads it (`shell.qml:1192-1207`).
  - The README gives opt-in snippets for a menu row
    (`~/.config/omarchy/extensions/omarchy-menu.jsonc`) and a Hyprland bind.
- **No `keepLoaded`.** Hiding the overlay destroys it, and the run in progress
  with it. game-design §8 rules out saved progress, so nothing is lost that was
  promised.

## Game loop, input, collision, rendering

- **Loop** (`src/GameLoop.qml`, finished): `FrameAnimation` → accumulator →
  whole ticks at 60 Hz, at most 5 per frame. It runs only while
  `opened && !faulted`. Each tick calls `Engine.step`, and each frame that
  ticked repaints once.
- **Input** (`src/Overlay.qml`): the window is a `PanelWindow` on
  `WlrLayer.Overlay` with `WlrKeyboardFocus.Exclusive`, the same pattern as
  first-party `emojis/Emojis.qml:160-168`.
  - Key presses and releases (auto-repeat dropped) keep a direction *stack*
    and held flags, sampled once per tick as an `InputState`. The core derives
    edges from `state.prevInput`.
  - Keys: arrows or WASD move, Space or J fire, Enter starts, P pauses.
  - Esc pauses inside a level. On title, game over or complete it closes the
    overlay.
- **Collision.** Terrain is a 13×13 grid of 16 px tiles in `GameState.tiles`,
  matched against the `TERRAIN` table (`src/core/collision.mjs`, the
  game-design §1 matrix as data).
  - Four-direction movement with axis snapping means a tank overlaps at most
    two tiles, so the grid lookup is exact.
  - Tank against tank and shell against tank or shell use AABB checks. At
    about 30 entities an O(n²) pass is fine.
- **Rendering** (`src/render/draw.mjs`): `drawFrame(ctx, state, theme)` paints
  one `Canvas` at logical 208×224 (HUD plus playfield). The canvas is scaled
  by a whole number without smoothing.
  - Neon glow is a blurred `MultiEffect` copy under the crisp frame, so each
    colour glows in its own hue.
  - The renderer only reads state.
  - **Colors come from omarchy's live active theme, not a fixed palette.**
    `src/Overlay.qml` imports `qs.Commons` (the Quickshell `Color` singleton
    every omarchy-shell plugin reads — `/usr/share/omarchy/shell/Commons/
    Color.qml`, same pattern as first-party `emojis/Emojis.qml`). `Color` is
    populated from `~/.local/state/omarchy/current/theme/colors.toml` at
    startup and reassigned in place by `shell.qml`'s `applyTheme` IPC call on
    a theme switch, so `Overlay.qml` re-reading `Color.*` on every paint is
    enough to track live theme changes without polling a file.
  - `Overlay.qml.liveTheme()` maps the theme's 5 foundational roles onto the
    game's semantically-closest colors (background → `background`, player
    tank and HUD accent → `accent`, HUD text → `foreground`, HUD danger →
    `urgent`) and passes that plain object into `Draw.drawFrame`. Everything
    else `drawFrame` needs — enemy types, terrain, base, shell — has no
    theme equivalent (only 5 roles exist; 8+ simultaneous gameplay-semantic
    colors can't be derived from them without risking two enemy types
    becoming indistinguishable under some theme) and falls back to
    `Draw.DEFAULT_THEME`, the fixed neon literals from game-design §5.
  - `src/render/draw.mjs` itself stays theme-agnostic like the rest of
    `src/core`/`src/render`: it takes `theme` as a parameter and never
    imports Quickshell. `scripts/check.sh`'s plain-ES-module grep enforces
    that boundary the same way it does for `src/core`.

## Layout

```
manifest.json            plugin contract (id is permanent)
src/Overlay.qml          entry: window, keys, loop wiring, fault panel
src/GameLoop.qml         fixed-timestep driver
src/core/                plain ES modules: constants, rng, levels (validator), collision, engine
src/levels/              index.mjs (order) + 01.mjs … 10.mjs (data)
src/render/draw.mjs      state → Canvas 2D
src/audio/cues.mjs       GameEvent → cue id, phase → music track (docs/audio-architecture.md)
src/Audio.qml            QtMultimedia playback, mounted by a Loader in Overlay.qml
assets/audio/            sfx/<cue>.wav, music/<track>.ogg
tests/*.test.mjs         node --test: level format, core interface + acceptance cases
tests/qml/               qmltestrunner: loop timing, QML import of core, audio wiring
scripts/check.sh         every check above, headless
```

## Migration

There is none, because nothing exists yet. `arkane.battletank` becomes a
directory name and a `shell.json` entry on every install, so it must never be
renamed; add an alias instead. There is no saved-game format.

## What can go wrong

**Worst case: the game hurting the desktop.** Plugins run unsandboxed inside
the one `omarchy-shell` process that also draws the bar and the lock screen.
Guards against a runaway game:
- The loop stops whenever the overlay is closed, and hiding unloads it.
- Every core call is wrapped in `try`. A throw stops the loop and shows a fault
  panel instead of reaching the shell.
- The core cannot touch Qt or the clock.

Tests that catch a regression:
- `tst_game_loop.qml` proves the frame driver is off unless `running`.
- `check.sh` rejects `keepLoaded` in the manifest.
- `check.sh` rejects Qt imports, `Math.random` and `Date.now` in the core.

**Second risk: Qt's JS engine lagging Node.** Code that passes `node --test`
can still throw in the shell. Qt 6.11 lacks `Array.prototype.flatMap`, and
`tst_core_import.qml` caught exactly that during scaffolding. Every change to
`src/core` must pass both suites (`scripts/check.sh`).

## Open (needs a person)

1. Proving the live shell behaviour (loop stops after `hide`, frame pacing,
   which monitor the overlay opens on, and — since the render task — that a
   real theme switch actually repaints the overlay's colors) means enabling
   the plugin in the user's running desktop. Verified so far only by source
   inspection of the `Color` singleton contract and a Node-level mock of the
   color lookup path (`tests/render.test.mjs`), not by a live theme switch.
2. A licence. The user's other plugins are MIT, but this repo has none until
   someone chooses.
