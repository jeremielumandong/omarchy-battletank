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
import {
  ENEMY_TYPES,
  FIELD,
  GRID,
  Glyph,
  PHASE_TICKS,
  PLAYER,
  SHELL_SPEED_FACTOR,
  SPAWN_GLYPHS,
  SPAWN_INTERVAL,
  TILE,
  WAVE_ADVANCE_FRACTION,
} from "./constants.mjs";
import { loadLevels } from "./levels.mjs";
import { overlaps, tileAt, tilesUnder, TERRAIN } from "./collision.mjs";

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
 * Builds a new run sitting on the title screen. Calls loadLevels(levels) so a
 * malformed level throws here, when the game opens, and never mid-run.
 *
 * @param {unknown[]} levels  src/levels/index.mjs `levels`
 * @param {{ seed?: number }} [options]
 * @returns {GameState}
 */
export function createGame(levels, options = {}) {
  const loaded = loadLevels(levels);
  return {
    phase: "title",
    phaseTicks: 0,
    menuIndex: 0,
    levels: loaded,
    levelIndex: 0,
    tiles: new Array(GRID * GRID).fill(Glyph.EMPTY),
    lives: PLAYER.lives,
    player: null,
    respawnTicks: 0,
    enemies: [],
    waveIndex: 0,
    spawnQueue: [],
    spawnTicks: 0,
    shells: [],
    destroyed: 0,
    tick: 0,
    seed: options.seed ?? 1,
    prevInput: emptyInput(),
    events: [],
    // Not in the typedef, but plain data and load-bearing for spawning and
    // ids: the base tile, the level's spawn points, and a monotonic id
    // counter. Kept on GameState so a run never depends on wall-clock or
    // module-level mutable state (determinism, architecture.md "Boundary").
    nextId: 1,
    basePos: null,
    playerSpawn: null,
    enemySpawns: [],
    availableSniperPosts: [],
    spawnCursor: 0,
  };
}

/**
 * Advances `state` by exactly one tick (1 / TICK_RATE s) and returns it.
 *
 * @param {GameState} state
 * @param {InputState} input
 * @returns {GameState}
 */
export function step(state, input) {
  state.tick++;
  state.events = [];
  state.phaseTicks++;
  const edge = {
    dir: input.dir && input.dir !== state.prevInput.dir ? input.dir : null,
    fire: input.fire && !state.prevInput.fire,
    start: input.start && !state.prevInput.start,
    pause: input.pause && !state.prevInput.pause,
  };

  switch (state.phase) {
    case "title":
      if (edge.start) beginNewRun(state);
      break;
    case "levelStart":
      if (state.phaseTicks >= PHASE_TICKS.levelStart) enterPhase(state, "playing");
      break;
    case "playing":
      stepPlaying(state, input, edge);
      break;
    case "paused":
      stepPaused(state, edge);
      break;
    case "confirmAbandon":
      stepConfirmAbandon(state, edge);
      break;
    case "levelClear":
      if (state.phaseTicks >= PHASE_TICKS.levelClear) {
        if (state.levelIndex + 1 < state.levels.length) enterLevelStart(state, state.levelIndex + 1);
        else enterPhase(state, "complete");
      }
      break;
    case "baseDestroyed":
      if (state.phaseTicks >= PHASE_TICKS.baseDestroyed) enterPhase(state, "gameOver");
      break;
    case "gameOver":
      if (edge.start) beginNewRun(state);
      break;
    case "complete":
      // Terminal: game-design §6 gives it one action, "Return to Title,"
      // which is the overlay closing itself (Overlay.qml escapeCloses()).
      break;
  }

  state.prevInput = { dir: input.dir, fire: input.fire, start: input.start, pause: input.pause };
  return state;
}

// ---- phase transitions ----

function enterPhase(state, phase) {
  state.phase = phase;
  state.phaseTicks = 0;
}

function beginNewRun(state) {
  state.lives = PLAYER.lives;
  state.destroyed = 0;
  enterLevelStart(state, 0);
}

/** Loads `levelIndex` fresh (tiles, spawns, player, waves) and opens its banner. */
function enterLevelStart(state, levelIndex) {
  state.levelIndex = levelIndex;
  const level = state.levels[levelIndex];
  const parsed = parseLevel(level);
  state.tiles = parsed.tiles;
  state.basePos = parsed.basePos;
  state.playerSpawn = parsed.playerSpawn;
  state.enemySpawns = parsed.enemySpawns;
  state.availableSniperPosts = parsed.sniperPosts;
  state.spawnCursor = 0;
  state.player = makePlayerTank(state, parsed.playerSpawn);
  state.respawnTicks = 0;
  state.enemies = [];
  state.shells = [];
  state.waveIndex = 0;
  state.spawnQueue = flattenWave(level.waves[0]);
  state.spawnTicks = 0;
  enterPhase(state, "levelStart");
}

function stepPaused(state, edge) {
  if (edge.pause) {
    enterPhase(state, "playing");
    return;
  }
  if (edge.dir === "up") state.menuIndex = (state.menuIndex + 2) % 3;
  else if (edge.dir === "down") state.menuIndex = (state.menuIndex + 1) % 3;
  if (edge.fire || edge.start) {
    if (state.menuIndex === 0) enterPhase(state, "playing");
    else if (state.menuIndex === 1) enterLevelStart(state, state.levelIndex);
    else {
      state.menuIndex = 0;
      enterPhase(state, "confirmAbandon");
    }
  }
}

function stepConfirmAbandon(state, edge) {
  if (edge.dir === "up" || edge.dir === "down") state.menuIndex = state.menuIndex === 0 ? 1 : 0;
  if (edge.fire || edge.start) {
    if (state.menuIndex === 0) enterPhase(state, "title");
    else enterPhase(state, "playing");
  }
}

// ---- level parsing ----

/** Splits a level's map into terrain tiles plus where things start (game-design §1, constants.mjs Glyph). */
function parseLevel(level) {
  const tiles = new Array(GRID * GRID).fill(Glyph.EMPTY);
  let playerSpawn = null;
  let basePos = null;
  const enemySpawns = [];
  const sniperPosts = [];
  for (let row = 0; row < GRID; row++) {
    const line = level.map[row];
    for (let col = 0; col < GRID; col++) {
      const ch = line[col];
      const spawnIndex = SPAWN_GLYPHS.indexOf(ch);
      if (ch === Glyph.PLAYER) playerSpawn = { x: col * TILE, y: row * TILE };
      else if (ch === Glyph.SNIPER_POST) sniperPosts.push({ x: col * TILE, y: row * TILE });
      else if (spawnIndex >= 0) enemySpawns[spawnIndex] = { x: col * TILE, y: row * TILE };
      else {
        tiles[row * GRID + col] = ch;
        if (ch === Glyph.BASE) basePos = { x: col * TILE, y: row * TILE };
      }
    }
  }
  return { tiles, playerSpawn, basePos, enemySpawns, sniperPosts };
}

/** One wave's enemy types, spawn order preserved. No flatMap: Qt 6.11 lacks it (tst_core_import.qml). */
function flattenWave(wave) {
  const out = [];
  for (const entry of wave.enemies) {
    for (let i = 0; i < entry.count; i++) out.push(entry.type);
  }
  return out;
}

function waveTotal(wave) {
  let total = 0;
  for (const entry of wave.enemies) total += entry.count;
  return total;
}

// ---- tanks ----

const DIR_DELTA = Object.freeze({
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
});
const isHorizontal = (dir) => dir === "left" || dir === "right";
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const tankRect = (tank) => ({ x: tank.x, y: tank.y, w: TILE, h: TILE });
const shellRect = (shell) => ({ x: shell.x, y: shell.y, w: SHELL_SIZE, h: SHELL_SIZE });

function makePlayerTank(state, spawn) {
  return {
    id: state.nextId++,
    kind: "player",
    x: spawn.x,
    y: spawn.y,
    dir: "up",
    moving: false,
    cooldown: 0,
    hitsLeft: 1,
    invulnerable: 0,
  };
}

function makeEnemyTank(state, type, pos) {
  const def = ENEMY_TYPES[type];
  return {
    id: state.nextId++,
    kind: type,
    x: pos.x,
    y: pos.y,
    dir: "down",
    moving: false,
    cooldown: def.fireCooldown,
    hitsLeft: def.hits,
    invulnerable: 0,
    burstLeft: 0,
    aimTicks: 0,
  };
}

function otherTanks(state, tank) {
  const all = state.player ? [state.player, ...state.enemies] : state.enemies;
  return all.filter((t) => t.id !== tank.id);
}

/**
 * Whether a tank may move into `rect`. A tank it already overlaps at `from`
 * does not block it: otherwise two stacked tanks could never drive apart.
 */
function canOccupy(rect, tiles, blockers, from) {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > FIELD || rect.y + rect.h > FIELD) return false;
  for (const { col, row } of tilesUnder(rect)) {
    const glyph = tileAt(tiles, col, row);
    if (glyph === null || TERRAIN[glyph].blocksTank) return false;
  }
  for (const other of blockers) {
    const box = tankRect(other);
    if (overlaps(rect, box) && !overlaps(from, box)) return false;
  }
  return true;
}

/**
 * Moves `tank` one tick in `dir` at `speed` px/tick. Changing axis snaps the
 * axis being left to the nearest tile line first (game-design §1), so shells,
 * walls and hitboxes stay grid-aligned. Returns whether it actually moved.
 */
function moveTank(tank, dir, speed, tiles, blockers) {
  if (tank.dir !== dir) {
    if (isHorizontal(tank.dir) !== isHorizontal(dir)) {
      if (isHorizontal(tank.dir)) tank.y = Math.round(tank.y / TILE) * TILE;
      else tank.x = Math.round(tank.x / TILE) * TILE;
    }
    tank.dir = dir;
  }
  const { dx, dy } = DIR_DELTA[dir];
  const nx = tank.x + dx * speed;
  const ny = tank.y + dy * speed;
  const rect = { x: nx, y: ny, w: TILE, h: TILE };
  if (!canOccupy(rect, tiles, blockers, tankRect(tank))) {
    tank.moving = false;
    return false;
  }
  tank.x = nx;
  tank.y = ny;
  tank.moving = true;
  return true;
}

/** Greedy step toward (or, given a point past `tank`, away from) `target`: try the axis with the larger gap first. */
function moveToward(tank, target, speed, tiles, blockers) {
  const dx = target.x - tank.x;
  const dy = target.y - tank.y;
  const horizontalFirst = Math.abs(dx) >= Math.abs(dy);
  const horizontalDir = dx === 0 ? null : dx > 0 ? "right" : "left";
  const verticalDir = dy === 0 ? null : dy > 0 ? "down" : "up";
  const dirs = horizontalFirst ? [horizontalDir, verticalDir] : [verticalDir, horizontalDir];
  for (const dir of dirs) {
    if (dir && moveTank(tank, dir, speed, tiles, blockers)) return;
  }
  tank.moving = false;
}

/** True when `from` and `to` share a tile row or column with no wall between them (what a shell would actually hit). */
function hasLineOfSight(state, from, to) {
  const colA = Math.floor((from.x + TILE / 2) / TILE);
  const rowA = Math.floor((from.y + TILE / 2) / TILE);
  const colB = Math.floor((to.x + TILE / 2) / TILE);
  const rowB = Math.floor((to.y + TILE / 2) / TILE);
  if (colA !== colB && rowA !== rowB) return false;
  const stepCol = Math.sign(colB - colA);
  const stepRow = Math.sign(rowB - rowA);
  let col = colA + stepCol;
  let row = rowA + stepRow;
  while (col !== colB || row !== rowB) {
    const glyph = tileAt(state.tiles, col, row);
    if (glyph === null) return false;
    const blocksShell = TERRAIN[glyph].shell === "stop" || TERRAIN[glyph].shell === "destroyTile";
    if (blocksShell) return false;
    col += stepCol;
    row += stepRow;
  }
  return true;
}

/** Tile distance along the shared row/col a line-of-sight check already confirmed. */
function tileDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / TILE;
}

/** Baseline 60px/s (PLAYER.speed) scaled by the level's SpeedMult(L) and the enemy type's own factor (game-design §3-4). */
function enemySpeed(level, type) {
  return PLAYER.speed * level.speedMult * ENEMY_TYPES[type].speedFactor;
}

// ---- shells ----

// Small relative to a TILE so a shell reads as a bolt, not another tank; not
// itself a game-design number (only shell *speed* is specified there).
const SHELL_SIZE = 4;

function muzzleFor(tank) {
  const cx = tank.x + TILE / 2;
  const cy = tank.y + TILE / 2;
  switch (tank.dir) {
    case "up":
      return { x: cx - SHELL_SIZE / 2, y: tank.y - SHELL_SIZE };
    case "down":
      return { x: cx - SHELL_SIZE / 2, y: tank.y + TILE };
    case "left":
      return { x: tank.x - SHELL_SIZE, y: cy - SHELL_SIZE / 2 };
    default:
      return { x: tank.x + TILE, y: cy - SHELL_SIZE / 2 };
  }
}

function fireShell(state, tank, speed) {
  const { x, y } = muzzleFor(tank);
  state.shells.push({ id: state.nextId++, ownerId: tank.id, x, y, dir: tank.dir, speed });
  state.events.push({ kind: "shot", x, y });
}

function allTanks(state) {
  return state.player ? [state.player, ...state.enemies] : state.enemies;
}

function destroyTank(state, tank) {
  state.events.push({ kind: "explosion", x: tank.x, y: tank.y });
  if (tank.kind === "player") {
    state.player = null;
    state.lives--;
    if (state.lives <= 0) enterPhase(state, "gameOver");
    else {
      state.respawnTicks = PLAYER.respawnDelay;
      state.events.push({ kind: "tankLost", x: tank.x, y: tank.y });
    }
    return;
  }
  tank.hitsLeft--;
  if (tank.hitsLeft <= 0) {
    state.enemies = state.enemies.filter((e) => e.id !== tank.id);
    state.destroyed++;
  }
}

/** Moves one shell, then resolves it against terrain (game-design §1 matrix) and tanks. Returns whether it survives. */
function resolveShell(state, shell) {
  const { dx, dy } = DIR_DELTA[shell.dir];
  shell.x += dx * shell.speed;
  shell.y += dy * shell.speed;
  const rect = shellRect(shell);

  for (const { col, row } of tilesUnder(rect)) {
    const glyph = tileAt(state.tiles, col, row);
    if (glyph === null) return false; // field edge: solid to shells too
    const terrain = TERRAIN[glyph];
    if (terrain.shell === "destroyTile") {
      state.tiles[row * GRID + col] = Glyph.EMPTY;
      state.events.push({ kind: "tileDestroyed", x: col * TILE, y: row * TILE });
      return false;
    }
    if (terrain.shell === "stop") return false;
    if (terrain.shell === "destroyBase") {
      state.events.push({ kind: "baseHit", x: rect.x, y: rect.y });
      enterPhase(state, "baseDestroyed");
      return false;
    }
  }

  for (const tank of allTanks(state)) {
    if (tank.id === shell.ownerId || tank.invulnerable > 0) continue;
    if (overlaps(rect, tankRect(tank))) {
      destroyTank(state, tank);
      return false;
    }
  }
  return true;
}

function stepShells(state) {
  state.shells = state.shells.filter((shell) => resolveShell(state, shell));
  // Shell vs shell: both destroyed on contact, regardless of owner.
  const survivors = [];
  for (let i = 0; i < state.shells.length; i++) {
    const a = state.shells[i];
    const rectA = shellRect(a);
    let hit = false;
    for (let j = 0; j < state.shells.length; j++) {
      if (i === j) continue;
      const b = state.shells[j];
      if (overlaps(rectA, shellRect(b))) {
        hit = true;
        break;
      }
    }
    if (!hit) survivors.push(a);
  }
  state.shells = survivors;
}

// ---- enemy AI (game-design §3) ----

function closerTarget(state, enemy) {
  if (!state.player) return state.basePos;
  return manhattan(enemy, state.player) < manhattan(enemy, state.basePos) ? state.player : state.basePos;
}

function stepGrunt(state, enemy, speed) {
  const target = closerTarget(state, enemy);
  moveToward(enemy, target, speed, state.tiles, otherTanks(state, enemy));
  if (enemy.cooldown <= 0 && hasLineOfSight(state, enemy, target)) {
    fireShell(state, enemy, speed * SHELL_SPEED_FACTOR);
    enemy.cooldown = ENEMY_TYPES.grunt.fireCooldown;
  }
}

// Not a game-design number (only "closes to short range" is specified):
// how close, in tiles, before a sniper retreats.
const SNIPER_RETREAT_TILES = 3;

function stepSniper(state, enemy, level, speed) {
  if (enemy.aimTicks > 0) {
    enemy.aimTicks--;
    if (enemy.aimTicks === 0 && state.player) {
      fireShell(state, enemy, speed * SHELL_SPEED_FACTOR * ENEMY_TYPES.sniper.shellSpeedFactor);
      enemy.cooldown = ENEMY_TYPES.sniper.fireCooldown;
    }
    return;
  }
  if (!state.player) {
    enemy.moving = false;
    return;
  }
  if (manhattan(enemy, state.player) / TILE < SNIPER_RETREAT_TILES) {
    const away = {
      x: enemy.x + Math.sign(enemy.x - state.player.x || 1) * TILE,
      y: enemy.y + Math.sign(enemy.y - state.player.y || 1) * TILE,
    };
    moveToward(enemy, away, speed, state.tiles, otherTanks(state, enemy));
  } else {
    enemy.moving = false;
  }
  const maxRange = (level.rules && level.rules.sniperRangeTiles) || GRID;
  if (
    enemy.cooldown <= 0 &&
    hasLineOfSight(state, enemy, state.player) &&
    tileDistance(enemy, state.player) <= maxRange
  ) {
    enemy.aimTicks = ENEMY_TYPES.sniper.aimFlash;
  }
}

function stepHunter(state, enemy, speed) {
  const def = ENEMY_TYPES[enemy.kind];
  if (state.player) moveToward(enemy, state.player, speed, state.tiles, otherTanks(state, enemy));
  else enemy.moving = false;

  if (enemy.burstLeft > 0) {
    if (enemy.cooldown <= 0) {
      fireShell(state, enemy, speed * SHELL_SPEED_FACTOR);
      enemy.burstLeft--;
      enemy.cooldown = enemy.burstLeft > 0 ? def.burstGap : def.fireCooldown;
    }
    return;
  }
  if (enemy.cooldown <= 0 && state.player && hasLineOfSight(state, enemy, state.player)) {
    fireShell(state, enemy, speed * SHELL_SPEED_FACTOR);
    enemy.burstLeft = def.burst - 1;
    enemy.cooldown = enemy.burstLeft > 0 ? def.burstGap : def.fireCooldown;
  }
}

function stepEnemy(state, enemy, level) {
  if (enemy.cooldown > 0) enemy.cooldown--;
  const speed = enemySpeed(level, enemy.kind);
  if (enemy.kind === "sniper") stepSniper(state, enemy, level, speed);
  else if (enemy.kind === "hunter" || enemy.kind === "eliteHunter") stepHunter(state, enemy, speed);
  else stepGrunt(state, enemy, speed);
}

// ---- spawning and waves ----

function spawnEnemyAt(state, type) {
  let pos;
  if (type === "sniper" && state.availableSniperPosts.length > 0) {
    pos = state.availableSniperPosts.shift();
  } else {
    pos = state.enemySpawns[state.spawnCursor % state.enemySpawns.length];
    state.spawnCursor++;
  }
  state.enemies.push(makeEnemyTank(state, type, pos));
}

function stepSpawning(state) {
  if (state.spawnQueue.length === 0 || state.spawnTicks > 0) {
    if (state.spawnTicks > 0) state.spawnTicks--;
    return;
  }
  const level = state.levels[state.levelIndex];
  const type = state.spawnQueue.shift();
  spawnEnemyAt(state, type);
  // Hunters spawn and advance in pairs from level 7 on (game-design §2/§3).
  if (type === "hunter" && level.rules && level.rules.hunterPairs && state.spawnQueue[0] === "hunter") {
    state.spawnQueue.shift();
    spawnEnemyAt(state, "hunter");
  }
  state.spawnTicks = SPAWN_INTERVAL;
}

/** Starts the next wave, or clears the level once the last wave is empty (game-design §4). */
function maybeAdvanceWave(state) {
  if (state.phase !== "playing") return;
  const level = state.levels[state.levelIndex];
  if (state.spawnQueue.length > 0) return;
  const isLastWave = state.waveIndex >= level.waves.length - 1;
  if (state.enemies.length === 0) {
    if (isLastWave) {
      state.events.push({ kind: "levelClear", x: 0, y: 0 });
      enterPhase(state, "levelClear");
    } else {
      state.waveIndex++;
      state.spawnQueue = flattenWave(level.waves[state.waveIndex]);
      state.spawnTicks = 0;
    }
    return;
  }
  if (!isLastWave && state.enemies.length < waveTotal(level.waves[state.waveIndex]) * WAVE_ADVANCE_FRACTION) {
    state.waveIndex++;
    state.spawnQueue = flattenWave(level.waves[state.waveIndex]);
    state.spawnTicks = 0;
  }
}

function stepPlayer(state, input, edge) {
  if (!state.player) {
    if (state.respawnTicks > 0) {
      state.respawnTicks--;
      if (state.respawnTicks === 0) {
        state.player = makePlayerTank(state, state.playerSpawn);
        state.player.invulnerable = PLAYER.invulnerable;
      }
    }
    return;
  }
  const player = state.player;
  if (player.invulnerable > 0) player.invulnerable--;
  if (player.cooldown > 0) player.cooldown--;
  if (input.dir) moveTank(player, input.dir, PLAYER.speed, state.tiles, otherTanks(state, player));
  else player.moving = false;
  const liveShells = state.shells.reduce((n, s) => n + (s.ownerId === player.id ? 1 : 0), 0);
  if (edge.fire && player.cooldown <= 0 && liveShells < PLAYER.maxLiveShells) {
    fireShell(state, player, PLAYER.speed * SHELL_SPEED_FACTOR);
    player.cooldown = PLAYER.fireCooldown;
  }
}

function stepPlaying(state, input, edge) {
  if (edge.pause) {
    state.menuIndex = 0;
    enterPhase(state, "paused");
    return;
  }
  const level = state.levels[state.levelIndex];
  stepPlayer(state, input, edge);
  stepSpawning(state);
  for (const enemy of state.enemies) stepEnemy(state, enemy, level);
  stepShells(state);
  maybeAdvanceWave(state);
}
