// The game core: the one interface between game logic and the QML shell.
//
// Why this shape:
// - GameState is plain data (no functions, classes or Qt objects), so Node
//   tests can build, compare and snapshot it, and QML only reads it.
// - step() advances exactly one tick at TICK_RATE and never reads a clock.
//   GameLoop.qml converts real frame time into whole ticks. Given the same seed
//   and the same inputs, two runs are identical.
// - Every screen in game-design §6 is a Phase, including the pause menu and
//   the abandon confirmation. QML therefore draws what the state says and
//   never keeps game rules of its own.
// - step() mutates `state` in place and returns it. At 60 Hz, copying the
//   world every tick buys nothing a test cannot get from structuredClone().
//
// STUB: createGame() and step() bodies are the engineer's.
// docs/architecture.md is the spec; tests/core.test.mjs holds the cases they
// must pass.

/** @typedef {"up" | "down" | "left" | "right"} Dir */

/**
 * What the player is pressing this tick, as held levels, not edges. step()
 * derives edges ("fire was just pressed") by comparing against
 * state.prevInput, which keeps auto-repeat and key timing out of QML.
 *
 * @typedef {Object} InputState
 * @property {Dir|null} dir  The most recently pressed direction still held. QML
 *                           keeps the stack, so two directions at once cannot
 *                           be represented.
 * @property {boolean} fire
 * @property {boolean} start  Title / Game Over / menu confirm.
 * @property {boolean} pause  Toggles Paused while in a level.
 */

/**
 * @typedef {"title" | "levelStart" | "playing" | "paused" | "confirmAbandon"
 *   | "levelClear" | "baseDestroyed" | "gameOver" | "complete"} Phase
 * game-design §6 "States". "Tank Lost" is not a phase: the level keeps running
 * while the player is dead, tracked by GameState.respawnTicks.
 */

/**
 * @typedef {Object} Tank
 * @property {number} id
 * @property {"player" | import("./levels.mjs").EnemyTypeId} kind
 * @property {number} x          px, playfield coords, top-left of a TILE × TILE box
 * @property {number} y
 * @property {Dir} dir           The player spawns facing "up".
 * @property {boolean} moving
 * @property {number} cooldown   Ticks until it may fire again.
 * @property {number} hitsLeft
 * @property {number} invulnerable  Ticks left of respawn invulnerability.
 */

/**
 * @typedef {Object} Shell
 * @property {number} id
 * @property {number} ownerId  The Tank id that fired it. Its glow colour follows the owner.
 * @property {number} x
 * @property {number} y
 * @property {Dir} dir
 * @property {number} speed    px per tick
 */

/**
 * One-shot things that happened during the last step(), for effects and
 * sound. Cleared at the start of every step().
 *
 * @typedef {Object} GameEvent
 * @property {"shot" | "explosion" | "tileDestroyed" | "baseHit" | "tankLost" | "levelClear"} kind
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} GameState
 * @property {Phase} phase
 * @property {number} phaseTicks     Ticks spent in the current phase.
 * @property {number} menuIndex      Selected row in paused / confirmAbandon.
 * @property {readonly import("./levels.mjs").LevelDef[]} levels  From loadLevels(), frozen.
 * @property {number} levelIndex     0-based index into levels.
 * @property {string[]} tiles        GRID × GRID row-major terrain; only glyphs in collision.TERRAIN.
 * @property {number} lives
 * @property {Tank|null} player      null while dead.
 * @property {number} respawnTicks
 * @property {Tank[]} enemies        On the field now.
 * @property {number} waveIndex
 * @property {import("./levels.mjs").EnemyTypeId[]} spawnQueue  Not yet spawned in the current wave.
 * @property {number} spawnTicks     Ticks until the next spawn.
 * @property {Shell[]} shells
 * @property {number} destroyed      Enemies destroyed this run (Game Over stats).
 * @property {number} tick           Ticks since createGame().
 * @property {number} seed           rng.mjs state.
 * @property {InputState} prevInput
 * @property {GameEvent[]} events
 */

/** @returns {InputState} The input of a player touching nothing. */
export function emptyInput() {
  return { dir: null, fire: false, start: false, pause: false };
}

/**
 * STUB: engineer implements. Builds a new run sitting on the title screen.
 * Must call loadLevels(levels) so a malformed level throws here, when the
 * game opens, and never mid-run.
 *
 * @param {unknown[]} levels  src/levels/index.mjs `levels`
 * @param {{ seed?: number }} [options]
 * @returns {GameState}
 */
export function createGame(levels, options = {}) {
  throw new Error("STUB: engine.createGame not implemented");
}

/**
 * STUB: engineer implements. Advances `state` by exactly one tick
 * (1 / TICK_RATE s) and returns it.
 *
 * @param {GameState} state
 * @param {InputState} input
 * @returns {GameState}
 */
export function step(state, input) {
  throw new Error("STUB: engine.step not implemented");
}
