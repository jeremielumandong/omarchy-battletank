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
  ENEMY_SPAWN_SLOTS,
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
  seconds,
} from "./constants.mjs";
import { loadLevels } from "./levels.mjs";
import { overlaps, tileAt, tilesUnder, TERRAIN } from "./collision.mjs";
import { nextRandom } from "./rng.mjs";

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
    // ids: the base tile, the level's player spawn and sniper posts, the next
    // ENEMY_SPAWN_SLOTS index, and a monotonic id counter. Kept on GameState
    // so a run never depends on wall-clock or module-level mutable state
    // (determinism, architecture.md "Boundary").
    nextId: 1,
    basePos: null,
    playerSpawn: null,
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
  const sniperPosts = [];
  for (let row = 0; row < GRID; row++) {
    const line = level.map[row];
    for (let col = 0; col < GRID; col++) {
      const ch = line[col];
      if (ch === Glyph.PLAYER) playerSpawn = { x: col * TILE, y: row * TILE };
      else if (ch === Glyph.SNIPER_POST) sniperPosts.push({ x: col * TILE, y: row * TILE });
      else if (!SPAWN_GLYPHS.includes(ch)) {
        tiles[row * GRID + col] = ch;
        if (ch === Glyph.BASE) basePos = { x: col * TILE, y: row * TILE };
      }
    }
  }
  return { tiles, playerSpawn, basePos, sniperPosts };
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
    blockedTicks: 0,
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
//
// Enemies path over the tile grid. pathCosts() is a distance field: what it
// costs to reach a goal tile from every tile. An enemy picks a direction only
// while it sits exactly on a tile, then drives the whole tile, so its turns
// never need the axis snap. (The snap is what made the old greedy mover undo
// its own progress every tick.) Brick is passable at a price: an enemy whose
// next step is brick stops and shoots it.

// Not game-design numbers. BRICK_PATH_COST: how many open tiles a brick on a
// path is worth, for the stop to shoot through it. BLOCKED_PATIENCE: ticks an
// enemy waits behind another tank before it tries another way.
const BRICK_PATH_COST = 4;
const BLOCKED_PATIENCE = seconds(0.75);
const DIRS = Object.freeze(["up", "left", "right", "down"]);
const REVERSE = Object.freeze({ up: "down", down: "up", left: "right", right: "left" });

/** The tile holding the centre of a TILE × TILE box at `pos`. */
const tileOf = (pos) => ({ col: Math.floor((pos.x + TILE / 2) / TILE), row: Math.floor((pos.y + TILE / 2) / TILE) });
const indexOf = (tile) => tile.row * GRID + tile.col;
const neighbour = (tile, dir) => ({ col: tile.col + DIR_DELTA[dir].dx, row: tile.row + DIR_DELTA[dir].dy });
const isAligned = (tank) => tank.x % TILE === 0 && tank.y % TILE === 0;

/** What driving into `tile` adds to a path: 1 on open ground, more for brick, Infinity where no tank goes. */
function enterCost(tiles, tile) {
  const glyph = tileAt(tiles, tile.col, tile.row);
  if (glyph === null) return Infinity;
  if (glyph === Glyph.BRICK) return 1 + BRICK_PATH_COST;
  return TERRAIN[glyph].blocksTank ? Infinity : 1;
}

/**
 * Dijkstra from `goal`: costs[i] is the cheapest path from tile i to `goal`,
 * Infinity where there is none. The goal itself is enterable even when solid,
 * so a path can end on the base. 169 tiles make a linear scan for the next
 * tile cheap enough to redo every tick.
 */
function pathCosts(tiles, goal) {
  const costs = new Array(GRID * GRID).fill(Infinity);
  const done = new Array(GRID * GRID).fill(false);
  const goalIndex = indexOf(goal);
  costs[goalIndex] = 0;
  for (;;) {
    let best = -1;
    for (let i = 0; i < costs.length; i++) {
      if (!done[i] && costs[i] < Infinity && (best < 0 || costs[i] < costs[best])) best = i;
    }
    if (best < 0) return costs;
    done[best] = true;
    const tile = { col: best % GRID, row: Math.floor(best / GRID) };
    const step = best === goalIndex ? 1 : enterCost(tiles, tile);
    if (step === Infinity) continue;
    for (const dir of DIRS) {
      const next = neighbour(tile, dir);
      if (tileAt(tiles, next.col, next.row) === null) continue;
      costs[indexOf(next)] = Math.min(costs[indexOf(next)], costs[best] + step);
    }
  }
}

/** This tick's distance fields: to the base, and to the player while alive. */
function enemyPaths(state) {
  return {
    base: pathCosts(state.tiles, tileOf(state.basePos)),
    player: state.player ? pathCosts(state.tiles, tileOf(state.player)) : null,
  };
}

/**
 * The first step of the cheapest path from `enemy`'s tile along `costs`, or
 * null when none leads to the goal. Ties keep the current heading, otherwise
 * the seeded RNG breaks them, so enemies do not all file down the same lane.
 */
function pathDir(state, enemy, costs) {
  const here = tileOf(enemy);
  let best = Infinity;
  let choices = [];
  for (const dir of DIRS) {
    const next = neighbour(here, dir);
    if (tileAt(state.tiles, next.col, next.row) === null) continue;
    const rest = costs[indexOf(next)];
    const cost = rest === 0 ? 1 : enterCost(state.tiles, next) + rest;
    if (cost < best) {
      best = cost;
      choices = [dir];
    } else if (cost === best) {
      choices.push(dir);
    }
  }
  if (best === Infinity) return null;
  if (choices.includes(enemy.dir)) return enemy.dir;
  return choices[Math.floor(nextRandom(state) * choices.length)];
}

/** Any open direction, keeping the current heading while it is open: for an enemy with no path. */
function wanderDir(state, enemy) {
  const here = tileOf(enemy);
  const open = DIRS.filter((dir) => enterCost(state.tiles, neighbour(here, dir)) === 1);
  if (open.includes(enemy.dir)) return enemy.dir;
  return open.length > 0 ? open[Math.floor(nextRandom(state) * open.length)] : null;
}

/**
 * Moves `enemy` up to `speed` px along `dir`, stopping exactly on the next
 * tile line so its next decision starts aligned. Only called aligned or along
 * the current axis, so it never needs moveTank's snap. Returns whether it moved.
 */
function advance(state, enemy, dir, speed) {
  const { dx, dy } = DIR_DELTA[dir];
  const from = dx !== 0 ? enemy.x : enemy.y;
  const line = dx + dy > 0 ? (Math.floor(from / TILE) + 1) * TILE : (Math.ceil(from / TILE) - 1) * TILE;
  const to = Math.abs(line - from) <= speed ? line : from + (dx + dy) * speed;
  const rect = { x: dx !== 0 ? to : enemy.x, y: dy !== 0 ? to : enemy.y, w: TILE, h: TILE };
  enemy.dir = dir;
  enemy.moving = canOccupy(rect, state.tiles, otherTanks(state, enemy), tankRect(enemy));
  if (enemy.moving) {
    enemy.x = rect.x;
    enemy.y = rect.y;
  }
  return enemy.moving;
}

/**
 * One tick of enemy movement. Mid-tile, it finishes the tile it started, or
 * backs out once a tank has blocked it for BLOCKED_PATIENCE. On a tile it
 * takes `dir` (null: wander): open ground it drives into, brick it stops and
 * shoots, a solid goal such as the base it faces and waits at, and a tank in
 * the way it waits behind, then drives around.
 */
function driveEnemy(state, enemy, speed, dir) {
  if (!isAligned(enemy)) {
    if (advance(state, enemy, enemy.dir, speed)) enemy.blockedTicks = 0;
    else if (++enemy.blockedTicks > BLOCKED_PATIENCE) {
      enemy.blockedTicks = 0;
      advance(state, enemy, REVERSE[enemy.dir], speed);
    }
    return;
  }
  const heading = dir || wanderDir(state, enemy);
  if (!heading) {
    enemy.moving = false;
    return;
  }
  const next = neighbour(tileOf(enemy), heading);
  const glyph = tileAt(state.tiles, next.col, next.row);
  if (glyph === Glyph.BRICK || glyph === null || TERRAIN[glyph].blocksTank) {
    enemy.dir = heading;
    enemy.moving = false;
    if (glyph === Glyph.BRICK) enemyFire(state, enemy, speed, TILE);
    return;
  }
  if (advance(state, enemy, heading, speed)) {
    enemy.blockedTicks = 0;
  } else if (++enemy.blockedTicks > BLOCKED_PATIENCE) {
    enemy.blockedTicks = 0;
    const here = tileOf(enemy);
    const others = DIRS.filter((d) => d !== heading && enterCost(state.tiles, neighbour(here, d)) === 1);
    if (others.length > 0) advance(state, enemy, others[Math.floor(nextRandom(state) * others.length)], speed);
  }
}

/** Whether another enemy stands within `reach` px ahead of `enemy`'s muzzle, in its own shell's way. */
function friendlyInLane(state, enemy, reach) {
  const muzzle = muzzleFor(enemy);
  const { dx, dy } = DIR_DELTA[enemy.dir];
  const lane = {
    x: dx < 0 ? muzzle.x - reach : muzzle.x,
    y: dy < 0 ? muzzle.y - reach : muzzle.y,
    w: SHELL_SIZE + Math.abs(dx) * reach,
    h: SHELL_SIZE + Math.abs(dy) * reach,
  };
  return state.enemies.some((other) => other.id !== enemy.id && overlaps(lane, tankRect(other)));
}

/**
 * Fires `enemy`'s shot in its facing, `reach` px at whatever it aims at,
 * unless it is cooling down or another enemy is in the way. Hunters open a
 * burst. Snipers never call this: they aim first (stepSniper).
 */
function enemyFire(state, enemy, speed, reach) {
  if (enemy.cooldown > 0 || friendlyInLane(state, enemy, reach)) return;
  const def = ENEMY_TYPES[enemy.kind];
  fireShell(state, enemy, speed * SHELL_SPEED_FACTOR);
  enemy.burstLeft = def.burst ? def.burst - 1 : 0;
  enemy.cooldown = enemy.burstLeft > 0 ? def.burstGap : def.fireCooldown;
}

/**
 * Turns `enemy` to face `target` when the two share a clear row or column and
 * the turn needs no snap (aligned, or already facing it). Returns whether it
 * now faces the target.
 */
function faceIfInSight(state, enemy, target) {
  if (!hasLineOfSight(state, enemy, target)) return false;
  const from = tileOf(enemy);
  const to = tileOf(target);
  if (from.col === to.col && from.row === to.row) return false;
  const dir = from.col === to.col ? (to.row > from.row ? "down" : "up") : to.col > from.col ? "right" : "left";
  if (dir !== enemy.dir) {
    if (!isAligned(enemy)) return false;
    enemy.dir = dir;
  }
  return true;
}

/** Heads for the base, or for the player when the player is the shorter path; shoots either on sight. */
function stepGrunt(state, enemy, speed, paths) {
  const here = indexOf(tileOf(enemy));
  const chasePlayer = paths.player !== null && paths.player[here] < paths.base[here];
  if (enemy.cooldown <= 0) {
    let targets = [state.basePos];
    if (state.player) targets = chasePlayer ? [state.player, state.basePos] : [state.basePos, state.player];
    const seen = targets.find((target) => faceIfInSight(state, enemy, target));
    if (seen) enemyFire(state, enemy, speed, manhattan(enemy, seen));
  }
  driveEnemy(state, enemy, speed, pathDir(state, enemy, chasePlayer ? paths.player : paths.base));
}

// Not a game-design number (only "closes to short range" is specified):
// how close, in tiles, before a sniper retreats.
const SNIPER_RETREAT_TILES = 3;

/** The open neighbouring tile that puts the most distance between a sniper and the player, if any is farther. */
function retreatDir(state, enemy) {
  const here = tileOf(enemy);
  const gap = (tile) => Math.abs(tile.col * TILE - state.player.x) + Math.abs(tile.row * TILE - state.player.y);
  let best = null;
  let bestGap = gap(here);
  for (const dir of DIRS) {
    const next = neighbour(here, dir);
    if (enterCost(state.tiles, next) === 1 && gap(next) > bestGap) {
      best = dir;
      bestGap = gap(next);
    }
  }
  return best;
}

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
  const retreat = manhattan(enemy, state.player) / TILE < SNIPER_RETREAT_TILES ? retreatDir(state, enemy) : null;
  if (retreat || !isAligned(enemy)) driveEnemy(state, enemy, speed, retreat);
  else enemy.moving = false;
  const maxRange = (level.rules && level.rules.sniperRangeTiles) || GRID;
  if (
    enemy.cooldown <= 0 &&
    tileDistance(enemy, state.player) <= maxRange &&
    faceIfInSight(state, enemy, state.player)
  ) {
    enemy.aimTicks = ENEMY_TYPES.sniper.aimFlash;
  }
}

/** Paths to the player (never the base) and bursts on sight; stands still while a burst is under way. */
function stepHunter(state, enemy, speed, paths) {
  const def = ENEMY_TYPES[enemy.kind];
  if (enemy.burstLeft > 0) {
    if (enemy.cooldown <= 0) {
      fireShell(state, enemy, speed * SHELL_SPEED_FACTOR);
      enemy.burstLeft--;
      enemy.cooldown = enemy.burstLeft > 0 ? def.burstGap : def.fireCooldown;
    }
    enemy.moving = false;
    return;
  }
  if (enemy.cooldown <= 0 && state.player && faceIfInSight(state, enemy, state.player)) {
    enemyFire(state, enemy, speed, manhattan(enemy, state.player));
  }
  driveEnemy(state, enemy, speed, paths.player ? pathDir(state, enemy, paths.player) : null);
}

function stepEnemy(state, enemy, level, paths) {
  if (enemy.cooldown > 0) enemy.cooldown--;
  const speed = enemySpeed(level, enemy.kind);
  if (enemy.kind === "sniper") stepSniper(state, enemy, level, speed);
  else if (enemy.kind === "hunter" || enemy.kind === "eliteHunter") stepHunter(state, enemy, speed, paths);
  else stepGrunt(state, enemy, speed, paths);
}

// ---- spawning and waves ----

/**
 * Puts a `type` enemy on the field and returns whether it could. A sniper
 * takes a free sniper post. Every other enemy takes the next of the three
 * ENEMY_SPAWN_SLOTS in rotation, skipping any slot a tank stands on; with all
 * three occupied it returns false and the spawn waits.
 */
function spawnEnemy(state, type) {
  if (type === "sniper" && state.availableSniperPosts.length > 0) {
    state.enemies.push(makeEnemyTank(state, type, state.availableSniperPosts.shift()));
    return true;
  }
  const tanks = allTanks(state);
  for (let i = 0; i < ENEMY_SPAWN_SLOTS.length; i++) {
    const cursor = (state.spawnCursor + i) % ENEMY_SPAWN_SLOTS.length;
    const slot = ENEMY_SPAWN_SLOTS[cursor];
    if (tanks.some((tank) => overlaps(tankRect(slot), tankRect(tank)))) continue;
    state.spawnCursor = (cursor + 1) % ENEMY_SPAWN_SLOTS.length;
    state.enemies.push(makeEnemyTank(state, type, slot));
    return true;
  }
  return false;
}

function stepSpawning(state) {
  if (state.spawnQueue.length === 0 || state.spawnTicks > 0) {
    if (state.spawnTicks > 0) state.spawnTicks--;
    return;
  }
  const level = state.levels[state.levelIndex];
  const type = state.spawnQueue[0];
  if (!spawnEnemy(state, type)) return;
  state.spawnQueue.shift();
  // Hunters spawn and advance in pairs from level 7 on (game-design §2/§3).
  const pair = type === "hunter" && level.rules && level.rules.hunterPairs && state.spawnQueue[0] === "hunter";
  if (pair && spawnEnemy(state, "hunter")) state.spawnQueue.shift();
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
  if (state.enemies.length > 0) {
    const paths = enemyPaths(state);
    for (const enemy of state.enemies) stepEnemy(state, enemy, level, paths);
  }
  stepShells(state);
  maybeAdvanceWave(state);
}
