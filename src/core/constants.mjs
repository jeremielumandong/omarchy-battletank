// Numbers shared by the core, the renderer and the tests. Values tagged
// "game-design §N" come from docs/game-design.md: tune them there first, then
// here, so the doc stays the source of truth.
//
// Every duration is in ticks, not seconds. step() advances exactly one tick
// and never sees wall-clock time, which is what keeps a game replayable.

export const TICK_RATE = 60;
export const seconds = (s) => Math.round(s * TICK_RATE);

export const TILE = 16; // px per tile (game-design §1)
export const GRID = 13; // tiles per side (game-design §1)
export const FIELD = TILE * GRID; // 208 px square playfield
export const HUD_HEIGHT = 16; // single top strip (game-design §5)
export const SCREEN_W = FIELD;
export const SCREEN_H = HUD_HEIGHT + FIELD;

// NES Battle City's three enemy entry points: the top-left, top-center and
// top-right tiles, in the order a level's enemies take them. The engine skips
// a slot a tank is standing on (engine.mjs spawnEnemy).
export const ENEMY_SPAWN_SLOTS = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: Math.floor(GRID / 2) * TILE, y: 0 }),
  Object.freeze({ x: (GRID - 1) * TILE, y: 0 }),
]);

// Level map glyphs. Markers (P, N, 1-3) say where things start; createGame()
// turns them into EMPTY terrain, so only B/S/W/E ever reach GameState.tiles.
// The enemy-spawn digits 1-3 no longer place anything, since every enemy
// enters at ENEMY_SPAWN_SLOTS, but the level format still accepts them.
export const Glyph = Object.freeze({
  EMPTY: ".",
  BRICK: "B",
  STEEL: "S",
  WATER: "W",
  BASE: "E",
  PLAYER: "P",
  SNIPER_POST: "N",
});
export const SPAWN_GLYPHS = Object.freeze(["1", "2", "3"]);
export const OBSTACLE_GLYPHS = Object.freeze([Glyph.BRICK, Glyph.STEEL, Glyph.WATER]);
export const GLYPHS = Object.freeze([...Object.values(Glyph), ...SPAWN_GLYPHS]);

export const PLAYER = Object.freeze({
  lives: 3,
  speed: 60 / TICK_RATE, // px per tick
  fireCooldown: seconds(0.4),
  maxLiveShells: 1,
  respawnDelay: seconds(1),
  invulnerable: seconds(2),
});

// Shell speed = factor × the firing tank's speed (game-design §1).
export const SHELL_SPEED_FACTOR = 2.5;

// Keyed by the ids LevelDef.waves use. Adding an enemy type is adding a key
// here; the level validator rejects any id not in this table.
export const ENEMY_TYPES = Object.freeze({
  grunt: Object.freeze({ speedFactor: 1.0, fireCooldown: seconds(1.2), hits: 1 }),
  sniper: Object.freeze({
    speedFactor: 0.6,
    fireCooldown: seconds(2.0),
    hits: 1,
    shellSpeedFactor: 1.5,
    aimFlash: seconds(0.3),
  }),
  hunter: Object.freeze({
    speedFactor: 1.3,
    fireCooldown: seconds(1.8),
    hits: 1,
    burst: 2,
    burstGap: seconds(0.3),
  }),
  eliteHunter: Object.freeze({
    speedFactor: 1.3,
    fireCooldown: seconds(1.8),
    hits: 2,
    burst: 2,
    burstGap: seconds(0.3),
  }),
});

// The next wave starts when the live wave drops below this share of its size
// (game-design §4).
export const WAVE_ADVANCE_FRACTION = 1 / 3;

// How long each timed phase lasts (game-design §6).
export const PHASE_TICKS = Object.freeze({
  levelStart: seconds(1.5),
  levelClear: seconds(2),
  baseDestroyed: seconds(1.5),
});

// Not in game-design: the engineer's default spacing between enemy spawns.
export const SPAWN_INTERVAL = seconds(2);
