// Which sound each GameEvent plays, and which music each Phase plays. This
// file is the whole audio policy: Overlay.qml drains GameState.events after
// every Engine.step and asks cuesFor() and musicFor() what to play, and
// src/Audio.qml only turns the ids it gets into QtMultimedia playback.
//
// It stays a plain, deterministic ES module with no Quickshell, QtQuick or
// QtMultimedia knowledge (scripts/check.sh enforces that for src/audio), so
// Node tests pin it, and a machine without QtMultimedia loses the sound but
// never the game. See docs/audio-architecture.md.
//
// Ids are asset file stems: cue "shot" plays assets/audio/sfx/shot.wav and
// track "battle" plays assets/audio/music/battle.ogg. They name files on
// disk, so add new ids instead of renaming old ones.

/**
 * @typedef {"shot" | "hit" | "brick" | "base-destroyed" | "player-destroyed"
 *   | "enemy-destroyed" | "level-clear" | "game-over" | "mission-complete"} CueId
 */

/** @typedef {"title" | "battle"} TrackId */

/**
 * @typedef {Object} Music
 * @property {TrackId|null} track  null is silence.
 * @property {boolean} playing     false holds the track at its position, so
 *                                 Resume continues the tune instead of
 *                                 restarting it.
 */

export const CUE_IDS = Object.freeze([
  "shot",
  "hit",
  "brick",
  "base-destroyed",
  "player-destroyed",
  "enemy-destroyed",
  "level-clear",
  "game-over",
  "mission-complete",
]);

export const TRACK_IDS = Object.freeze(["title", "battle"]);

// One entry per GameEvent kind in engine.mjs. tests/audio.test.mjs fails when
// a real run emits a kind with no entry, so a new event cannot go silently
// unheard. enemyDestroyed, gameOver and complete are the kinds the engine
// does not emit yet (docs/audio-architecture.md, item a).
export const EVENT_CUES = Object.freeze({
  shot: "shot",
  explosion: "hit", // any tank hit, including a non-lethal Elite Hunter hit
  tileDestroyed: "brick",
  baseHit: "base-destroyed",
  tankLost: "player-destroyed", // a life lost with lives left; the last one is gameOver
  enemyDestroyed: "enemy-destroyed",
  levelClear: "level-clear",
  gameOver: "game-over",
  complete: "mission-complete",
});

// In one step, a bigger sound swallows the smaller one it already contains:
// a kill is one boom, not a hit with a boom on top. The engine pushes
// "explosion" for every hit, lethal or not (engine.mjs destroyTank), so the
// kill cues must drop it.
export const SUPERSEDES = Object.freeze({
  "enemy-destroyed": Object.freeze(["hit"]),
  "player-destroyed": Object.freeze(["hit"]),
  "game-over": Object.freeze(["hit"]),
});

const SILENCE = Object.freeze({ track: null, playing: false });
const TITLE = Object.freeze({ track: "title", playing: true });
const BATTLE = Object.freeze({ track: "battle", playing: true });
const BATTLE_HELD = Object.freeze({ track: "battle", playing: false });

// One entry per Phase in engine.mjs. The end screens are silent so their
// stingers (level-clear, game-over, mission-complete) play alone.
export const PHASE_MUSIC = Object.freeze({
  title: TITLE,
  levelStart: BATTLE,
  playing: BATTLE,
  paused: BATTLE_HELD,
  confirmAbandon: BATTLE_HELD,
  levelClear: SILENCE,
  baseDestroyed: SILENCE,
  gameOver: SILENCE,
  complete: SILENCE,
});

const has = (table, key) => Object.prototype.hasOwnProperty.call(table, key);

/**
 * The cues one step's events play: each cue at most once, in first-seen
 * order, minus the cues something bigger in the same step supersedes. An
 * unknown kind plays nothing rather than throwing, because a running shell
 * can pair a freshly reloaded QML file with this module's stale cached copy
 * (docs/audio-architecture.md "Module cache").
 *
 * @param {import("../core/engine.mjs").GameEvent[]} events  GameState.events, read right after one step()
 * @returns {CueId[]}
 */
export function cuesFor(events) {
  const cues = [];
  for (const event of events) {
    if (!has(EVENT_CUES, event.kind)) continue;
    const cue = EVENT_CUES[event.kind];
    if (cues.indexOf(cue) < 0) cues.push(cue);
  }
  const swallowed = [];
  for (const cue of cues) if (has(SUPERSEDES, cue)) swallowed.push(...SUPERSEDES[cue]);
  return cues.filter((cue) => swallowed.indexOf(cue) < 0);
}

/**
 * The music a phase wants. Music is a function of phase, not of events, so
 * pausing, resuming, restarting a level and closing the overlay need no
 * bookkeeping beyond asking again. An unknown phase is silence.
 *
 * @param {import("../core/engine.mjs").Phase} phase
 * @returns {Music}
 */
export function musicFor(phase) {
  return has(PHASE_MUSIC, phase) ? PHASE_MUSIC[phase] : SILENCE;
}
