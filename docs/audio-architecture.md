# Battletank audio

Status: **built** on 2026-09-13. Designed by @architect, implemented by
@engineer.

What exists today:
- **Built and tested:** the audio policy `src/audio/cues.mjs`, the three
  engine events, `src/Audio.qml` and its `Overlay.qml` wiring. The pins are
  `tests/audio.test.mjs`, `tests/qml/tst_audio_import.qml` and
  `tests/qml/tst_audio.qml`.
- **Placeholder assets:** `assets/audio/`, synthesized with ffmpeg. Real
  sounds are still open item 1 below.
- **Enforced:** `scripts/check.sh` keeps `src/audio` as plain ES modules.

Game rules stay in [`architecture.md`](architecture.md) and
[`game-design.md`](game-design.md).

## Decision

Play audio **out of process, with `pw-play`** (revised 2026-09-13, see
"Why not in-process QtMultimedia" below):
- Each voice is a `Quickshell.Io` `Process` running
  `pw-play --volume V --media-role Game <file>` (`src/AudioVoice.qml`).
- Effects get one small pool of voices per cue, round-robin.
- One looping voice plays the music. It starts again when the file ends, and
  pause holds it with `SIGSTOP` and resumes it with `SIGCONT`.

All of it lives in `src/Audio.qml`, which `Overlay.qml` mounts through a
`Loader`. Destroying a `Process` SIGKILLs its child, so unloading the
overlay silences every voice. The core never sees any of it:
- It already reports what happened in `GameState.events`, "for effects and
  sound" (`src/core/engine.mjs:78-86`).
- The plain module `src/audio/cues.mjs` maps those events to cue ids and each
  phase to a music track.
- QML only plays the ids it is handed.

This is the rendering pattern again. `draw.mjs` reads state and paints.
`cues.mjs` reads state and names sounds.

**Rejected**
- **In-process QtMultimedia** (`SoundEffect` pools and a `MediaPlayer`, the
  first build). It wedged the shared shell. See below.
- **`mpv`.** It is not an omarchy dependency.
- **QML diffing `phase` to decide what to play.** It moves game knowledge into
  QML, against `Overlay.qml:20`. It also misses a transition that starts and
  ends inside one multi-tick frame.

**Why not in-process QtMultimedia.** The first build played through
QtMultimedia inside omarchy-shell. Twelve seconds into a live game, the
shell's main thread started spinning on "QSocketNotifier: Invalid socket …
disabling" and stopped responding, so the game could not be closed. That code
is Qt Multimedia 6.11.2's PipeWire backend, not ours, and the same wedge is
reported upstream for another omarchy plugin that uses `SoundEffect`. After
the first open, QtMultimedia keeps a process-global PipeWire client in the
shell for the rest of its life, so no `Audio.qml` teardown order can contain
it. The evidence is in the 2026-09-13 project lesson on this hang. The
exact trigger is still `unproven`: a private-PipeWire repro did not spin.
`check.sh` now rejects any `import QtMultimedia` under `src/`.

The old objections to `Process` no longer hold:
- **Outliving the overlay:** `~Process()` kills its child, and
  `tests/quickshell/tst_close_cycle.qml` proves no voice outlives a close.
- **Testing:** the QML suite injects `tests/qml/FakeVoice.qml`, and
  `check.sh` runs the real voice in the real `quickshell` binary.
- **Cost:** a 0.12 s shot ran from spawn to exit in 0.14 s. Each `play()` call
  forks a fresh `pw-play` child; the measured ~20ms overhead is small. With a
  4-voice pool, up to 4 shots run concurrently instead of serially, so the fork
  cost is distributed across parallel execution rather than blocking one voice
  at a time. This closes the audible-lag risk.

**Why this mechanism holds on this stack** (probed 2026-09-13, quickshell
0.3.1, pipewire 1.6.8):

| Fact | Proof |
|---|---|
| `pw-play` plays the WAV cues and the Ogg Vorbis tracks (libsndfile) | `quickshell -p` probe against a private PipeWire: exit 0 |
| An unreadable file exits 1, and a SIGTERM or SIGKILL shows as a crash exit | same probe: `exited 1 0`, `exited 15 1` |
| A missing binary never emits `started` or `exited`. `running` just drops | same probe |
| `running = false; running = true` restarts a running voice | same probe |
| `SIGSTOP` then `SIGCONT` resumes the tune where it stopped | 8 s track held 3 s, exited 0 after 11 s |
| `pw-play` ships in `pipewire-audio`, which `pipewire-pulse` and `pipewire-alsa` require | `pacman -Qi`. Where it is missing, each voice warns once and stays silent |

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

The QML half's contract:

```qml
// src/Audio.qml: voices from src/AudioVoice.qml, one pw-play child each.
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
  under about 1 s.
- **Music:** `assets/audio/music/<track-id>.ogg`, Ogg Vorbis. The voice starts
  it again when it ends, so each loop has a short gap of one `pw-play` spawn.
- **Names:** ids are kebab-case file stems, pinned by the test. Add ids; never
  rename one that has shipped.
- **Paths:** everything stays inside the repo, because plugin validation
  forbids symlinks and `..` (architecture.md "Packaging"). `Audio.qml`
  resolves files with `Qt.resolvedUrl("../assets/audio/sfx/")` and hands
  `pw-play` the local path.
- **Missing files:** `pw-play` exits 1 on a missing or bad file. That voice
  warns once and never spawns again. It is never a fault.

## Lifecycle

- The `Loader` is `active` only while the overlay is open and not faulted.
  Closing, faulting and `hide` all destroy every voice, and each destroyed
  `Process` SIGKILLs its `pw-play`, even one held by `SIGSTOP`. Nothing
  outlives the overlay (`tests/quickshell/tst_close_cycle.qml`).
- Opening creates the voices fresh. A voice spawns `pw-play` only when it
  plays.
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
  - A replaced `.wav` plays at once, since `pw-play` reads the file on every
    play.
- **Shipped updates:** after `omarchy plugin update`, the new sounds arrive
  with the next shell restart. The README says so.

## What can go wrong

**Worst case: sound breaking the game or the shared shell.** It happened once:
in-process QtMultimedia wedged the shell (see "Decision"). Guards:
- No audio runs in the shell process. `check.sh` rejects `import
  QtMultimedia` anywhere under `src/`.
- Every voice is a child process owned by the `Loader`'s item, and
  `tests/quickshell/tst_close_cycle.qml` proves none outlives five closes.
- The `Loader` confines a broken `Audio.qml` to `audio.item === null`. An
  `AudioVoice.qml` that cannot load leaves the game silent.
- `sound()` has its own `try`, separate from the engine `try`
  (`Overlay.qml:217-222`). A sound error warns once and never calls
  `root.fail()`.

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
4. **Machines without `pw-play`:** it ships in `pipewire-audio`, which omarchy
   pulls in only through `pipewire-pulse` and `pipewire-alsa`. Without it,
   each voice warns once and the game runs silent. Whether every stock
   install has it is `unproven`.
5. **Live proof of the fix:** after `omarchy restart shell`, open and close
   the game five times with sound on, then check that no `pw-play` is left
   and the shell still responds. It must run on an idle desktop or with the
   person's agreement.
