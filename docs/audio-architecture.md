# Battletank audio

Status: **draft** by @architect on 2026-09-13. The game makes no sound yet.

What exists today:
- **Drafted and tested:** the audio policy `src/audio/cues.mjs` and its pins
  `tests/audio.test.mjs` and `tests/qml/tst_audio_import.qml`.
- **Enforced:** `scripts/check.sh` now keeps `src/audio` as plain ES modules.
- **Not built:** `src/Audio.qml`, the assets, and the three engine events.

Game rules stay in [`architecture.md`](architecture.md) and
[`game-design.md`](game-design.md).

## Decision

Play audio **in-process with QtMultimedia**:
- `SoundEffect` voices, one small pool per cue, play the effects.
- One `MediaPlayer` with `loops: MediaPlayer.Infinite` plays the music.

All of it lives in `src/Audio.qml`, which `Overlay.qml` mounts through a
`Loader`. The core never sees any of it:
- It already reports what happened in `GameState.events`, "for effects and
  sound" (`src/core/engine.mjs:78-86`).
- The plain module `src/audio/cues.mjs` maps those events to cue ids and each
  phase to a music track.
- QML only plays the ids it is handed.

This is the rendering pattern again. `draw.mjs` reads state and paints.
`cues.mjs` reads state and names sounds.

**Rejected**
- **`Quickshell.Io` `Process` running `pw-play` or `mpv`.** That is one process
  per shot. Music started this way can outlive the overlay's unload
  (architecture.md "No `keepLoaded`"). `Quickshell.Io` does not load under
  `qmltestrunner`, so none of it could be tested headless. `mpv` is not an
  omarchy dependency.
- **QML diffing `phase` to decide what to play.** It moves game knowledge into
  QML, against `Overlay.qml:20`. It also misses a transition that starts and
  ends inside one multi-tick frame.

**Why this mechanism holds on this stack** (probed 2026-09-13, Qt 6.11.2,
quickshell 0.3.1):

| Fact | Proof |
|---|---|
| `SoundEffect` loads a 16-bit PCM WAV (`status` Ready), including inside the real `quickshell` binary | `qmltestrunner` probe; throwaway `quickshell -p` probe printed `status 2` (Ready) |
| `SoundEffect` rejects OGG (`status` Error, same as a missing file) | `qmltestrunner` probe |
| `MediaPlayer` loads OGG Vorbis (`LoadedMedia`) through the ffmpeg backend | `qmltestrunner` probe |
| A `Loader` whose file imports a missing module ends in `Loader.Error`, `item === null`, and its parent lives on | `qmltestrunner` probe |
| qt6-multimedia is on stock omarchy installs, but only through `omacut` in `omarchy-base.packages`. It is not a hard dependency of `omarchy` or `quickshell` | `pacman -Qi` |

The `Loader` is what makes the last row safe. Without QtMultimedia the game
runs silent. It does not fail to open.

## Boundary

The one interface this design introduces is the audio policy, pinned by
`tests/audio.test.mjs`:

```js
// src/audio/cues.mjs (written)
export function cuesFor(events) {}  // GameEvent[] -> CueId[]: once each, first-seen order, superseded cues dropped
export function musicFor(phase) {}  // Phase -> { track: TrackId|null, playing: boolean }
export const EVENT_CUES, PHASE_MUSIC, SUPERSEDES, CUE_IDS, TRACK_IDS;
```

It depends on three new `GameEvent` kinds. They are additive: no kind is
renamed, and events are in-memory only, so there is no migration.

```js
// src/core/engine.mjs GameEvent.kind, item (a):
//   ... | "enemyDestroyed" | "gameOver" | "complete"
```

The QML half is not written. Its contract:

```qml
// src/Audio.qml: the only file that imports QtMultimedia.
Item {
  property bool muted: false
  function playCues(cueIds) {}  // unknown id: one console.warn, never a throw
  function setMusic(music) {}   // no-op when unchanged; same track + playing:false pauses
}

// src/Overlay.qml additions
import "audio/cues.mjs" as Cues
Loader { id: audio; source: "Audio.qml"; active: root.opened && !root.faulted }
GameLoop {
  onTick: {
    try { Engine.step(root.game, root.currentInput()) } catch (e) { root.fail(e); return }
    root.sound(root.game)  // its own try: a sound error must never call fail()
  }
}
```

| Files that change | Files that do not |
|---|---|
| `src/Overlay.qml` (Loader, `sound()`), new `src/Audio.qml`, new `assets/audio/`, `engine.mjs` event pushes only (item a), README | `src/render/`, `src/levels/`, `src/core/collision.mjs`, the enemy AI in `engine.mjs`, `manifest.json` |

## Events, cues and music

| GameEvent kind | Pushed at | Cue (`assets/audio/sfx/<cue>.wav`) |
|---|---|---|
| `shot` | `engine.mjs` `fireShell` | `shot` |
| `explosion` | `engine.mjs:480`, every tank hit, lethal or not | `hit` |
| `tileDestroyed` | `resolveShell` | `brick` |
| `baseHit` | `resolveShell` | `base-destroyed` |
| `tankLost` | `engine.mjs:487`, a life lost with lives left | `player-destroyed` |
| `levelClear` | `engine.mjs:670` | `level-clear` |
| **`enemyDestroyed`** (new) | inside `if (tank.hitsLeft <= 0)`, `engine.mjs:491-495` | `enemy-destroyed` |
| **`gameOver`** (new) | beside both `enterPhase(state, "gameOver")`, `engine.mjs:484` and `:199` | `game-over` |
| **`complete`** (new) | beside `enterPhase(state, "complete")`, `engine.mjs:195` | `mission-complete` |

Supersession applies within one step. `enemy-destroyed`, `player-destroyed`
and `game-over` each swallow `hit`, so a kill is one boom and not two sounds.

The final death stays without `tankLost`, as today. `gameOver` covers it, so
"TANK LOST" never flashes before GAME OVER.

Music follows phase:

| Phase | Music |
|---|---|
| `title` | `title`, playing |
| `levelStart`, `playing` | `battle`, playing |
| `paused`, `confirmAbandon` | `battle`, held at its position |
| `levelClear`, `baseDestroyed`, `gameOver`, `complete` | silence, so the stinger plays alone |

## Assets

- **Effects:** `assets/audio/sfx/<cue-id>.wav`, 16-bit PCM, mono, 48 kHz,
  under about 1 s. `SoundEffect` plays WAV only (probe above).
- **Music:** `assets/audio/music/<track-id>.ogg`, Ogg Vorbis, looped by
  `MediaPlayer`, so it needs a seamless loop point.
- **Names:** ids are kebab-case file stems, pinned by the test. Add ids; never
  rename one that has shipped.
- **Paths:** everything stays inside the repo, because plugin validation
  forbids symlinks and `..` (architecture.md "Packaging"). `Audio.qml`
  resolves files with `Qt.resolvedUrl("../assets/audio/sfx/" + id + ".wav")`.
- **Missing files:** a missing or bad file leaves that voice in
  `SoundEffect.Error`. It plays nothing and warns once. It is never a fault.

## Lifecycle

- The `Loader` is `active` only while the overlay is open and not faulted.
  Closing, faulting and `hide` all destroy every voice and the player.
  Nothing outlives the overlay.
- Opening loads the voices fresh. Their load latency is `unproven`.
- `cuesFor` runs after **every** `Engine.step`, in `onTick`, never in
  `onTicked`:
  - `step` clears `events` first (`engine.mjs:167`).
  - A catch-up frame runs up to 5 steps (`GameLoop.qml:17`).
  - Draining once per frame would drop the first four ticks' sounds.
- `musicFor` may run each tick. `setMusic` ignores repeats.

## Module cache: no live reload, by design

A running omarchy-shell caches every imported `.mjs` by URL for its whole
life. A "Local plugin changed, reloading" event rebuilds the QML tree but keeps
the stale modules. Toggling or re-enabling the plugin does not help. Only
`omarchy restart shell` does (project lesson, 2026-09-13). So:

- **No file watching and no hot reload.** Nothing in audio watches a file or
  re-reads a table at runtime. An edited cue table, a new asset or a changed
  `Audio.qml` counts as unshipped until the shell restarts.
- **Both sides tolerate a version skew.** A reload can pair a fresh
  `Audio.qml` with a stale `cues.mjs`:
  - `cuesFor` and `musicFor` ignore unknown kinds and phases (tested).
  - `Audio.qml` ignores unknown cue ids with one warning.
  - A missing file only silences its cue.
- **The dev loop is headless.**
  - Iterate with `scripts/check.sh`. `node` and `qmltestrunner` start a fresh
    process each run, so no cache is involved.
  - Before any live listen, run `omarchy restart shell`. Do not trust what a
    long-lived shell plays.
  - Treat replacing a `.wav` the same way. Whether `SoundEffect` caches
    samples by URL across a reload is `unproven`, and the design does not
    depend on it either way.
- **Shipped updates:** after `omarchy plugin update`, the new sounds arrive
  with the next shell restart. The README says so.

## What can go wrong

**Worst case: sound breaking the game or the shared shell.** Guards:
- The `Loader` confines a missing module or a broken `Audio.qml` to
  `audio.item === null`.
- `sound()` has its own `try`, separate from the engine `try`
  (`Overlay.qml:217-222`). A sound error warns once and never calls
  `root.fail()`.
- The core cannot import QtMultimedia: `check.sh` greps `src/audio` too, and
  a planted import is rejected.

**Second risk: silent drops.**
- The multi-tick drain is the likely bug. `tst_audio.qml` catches it: a
  5-tick frame with fire held must produce as many `shot` cues as it produced
  `shot` events.
- A new event kind with no cue is the other. "every event a real run emits
  has a cue" in `tests/audio.test.mjs` catches it.

## How an engineer implements this

**Item (a), core events. Routine, small.** In `engine.mjs`:
- Push `enemyDestroyed` with the tank's x/y in the kill branch.
- Push `gameOver` at both game-over transitions. A small `enterGameOver(state)`
  helper keeps them in one place.
- Push `complete` at the final clear, following the existing `levelClear` push
  (`:670`).
- Add the kinds to the `GameEvent` typedef.

It is done when the four `todo` cases in `tests/audio.test.mjs` pass. Then
remove their `todo` option.

**Item (b), audio subsystem. Moderate.**
1. Write `src/Audio.qml` to the contract above:
   - a pool of `SoundEffect` voices per cue, round-robin (`shot` 4, `hit` 3,
     `brick` 3, the rest 1)
   - one `MediaPlayer` + `AudioOutput`
   - a `muted` property
2. Wire it in `Overlay.qml`: the `Loader` and `sound()` in `onTick`.
3. Add placeholder assets under `assets/audio/`.
4. Add `tests/qml/tst_audio.qml`:
   - It mounts `Audio.qml` through a `Loader` next to `Engine` and `GameLoop`,
     wired as `Overlay.qml` does.
   - It proves the multi-tick drain.
   - It proves an unknown cue and a missing file neither throw nor fault.
5. Add a line to the README Develop section and to the architecture.md Layout
   section.

Done when `scripts/check.sh` passes, then after `omarchy restart shell` a person
hears each cue once in a live run.

## Open (needs a person)

1. **Assets:** who makes the sounds and music, and under what licence. The
   repo has none yet (architecture.md "Open").
2. **Mute key:** whether to have one. Proposal: `M`, in-session only, since
   game-design §8 rules out saved settings.
3. **Volumes:** default levels. Proposal: effects 0.6, music 0.35.
4. **Machines without a pulse server:** `pipewire-pulse` is in
   `omarchy-other.packages`, not base. What Qt's audio output does without it
   is `unproven`. The expected result is silence, not a crash.
