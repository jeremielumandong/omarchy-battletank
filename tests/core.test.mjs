// Pins the core interface (docs/architecture.md, "Boundary"). The first group
// passes against the stubs; the rest were the engineer's acceptance bar for
// implementing engine.mjs, now closed.
import test from "node:test";
import assert from "node:assert/strict";
import { createGame, emptyInput, step } from "../src/core/engine.mjs";
import { nextRandom } from "../src/core/rng.mjs";
import { ENEMY_SPAWN_SLOTS, PHASE_TICKS, PLAYER, SPAWN_INTERVAL, TILE } from "../src/core/constants.mjs";
import { TERRAIN } from "../src/core/collision.mjs";
import { levels } from "../src/levels/index.mjs";

test("engine exposes createGame(levels, options) and step(state, input)", () => {
  assert.equal(typeof createGame, "function");
  assert.equal(createGame.length, 1);
  assert.equal(typeof step, "function");
  assert.equal(step.length, 2);
});

test("emptyInput is a neutral InputState", () => {
  assert.deepEqual(emptyInput(), { dir: null, fire: false, start: false, pause: false });
});

test("rng replays identically from the same seed", () => {
  const a = { seed: 42 };
  const b = { seed: 42 };
  const seqA = Array.from({ length: 5 }, () => nextRandom(a));
  const seqB = Array.from({ length: 5 }, () => nextRandom(b));
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((n) => n >= 0 && n < 1));
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, () => nextRandom({ seed: 43 })));
});

test("terrain table covers exactly the glyphs GameState.tiles may hold", () => {
  assert.deepEqual(Object.keys(TERRAIN).sort(), [".", "B", "E", "S", "W"]);
});

// ---- acceptance cases for the engineer's implementation ----


const fixture = (rows) => ({
  id: 1,
  name: "fixture",
  map: rows,
  speedMult: 1,
  waves: [{ enemies: [{ type: "grunt", count: 1 }] }],
});

// Open ground with the player on the left edge of row 6 and a brick directly
// above it. The enemy spawn sits far away in the top-right corner.
const OPEN = fixture([
  "............1",
  ".............",
  ".............",
  ".............",
  ".............",
  "B............",
  "P............",
  ".............",
  ".............",
  ".............",
  ".............",
  ".............",
  "......E......",
]);

const run = (state, input, ticks) => {
  for (let i = 0; i < ticks; i++) step(state, { ...emptyInput(), ...input });
  return state;
};

// Press Start on the title and wait out the level banner.
const intoPlaying = (state) => {
  run(state, { start: true }, 1);
  run(state, {}, PHASE_TICKS.levelStart + 1);
  return state;
};

test("createGame starts a run on the title screen", () => {
  const state = createGame(levels);
  assert.equal(state.phase, "title");
  assert.equal(state.lives, PLAYER.lives);
  assert.equal(state.levelIndex, 0);
});

test("createGame rejects malformed levels", () => {
  assert.throws(() => createGame([{ id: 1 }]), /invalid levels/);
});

test("GameState is plain data", () => {
  const state = intoPlaying(createGame([OPEN]));
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test("step is deterministic for a seed and an input sequence", () => {
  const play = () => run(intoPlaying(createGame(levels, { seed: 7 })), { dir: "left", fire: true }, 300);
  assert.deepEqual(play(), play());
});

test("Start leads through levelStart into playing", () => {
  const state = createGame([OPEN]);
  run(state, { start: true }, 1);
  assert.equal(state.phase, "levelStart");
  run(state, {}, PHASE_TICKS.levelStart + 1);
  assert.equal(state.phase, "playing");
});

test("the player covers 60 px in 60 ticks on open ground", () => {
  const state = intoPlaying(createGame([OPEN]));
  const x0 = state.player.x;
  run(state, { dir: "right" }, 60);
  assert.equal(state.player.x - x0, 60);
  assert.equal(state.player.y, 6 * TILE);
});

const overlapping = (a, b) =>
  a.x < b.x + TILE && b.x < a.x + TILE && a.y < b.y + TILE && b.y < a.y + TILE;

// Regression: canOccupy rejected every rect touching another tank, including
// one the mover already overlapped, so two tanks that ever overlapped (an
// enemy spawned onto an occupied spawn point) could never move apart again.
test("a tank that already overlaps another can drive out of it", () => {
  const state = intoPlaying(createGame([OPEN]));
  state.player.invulnerable = 10_000;
  // Stacked exactly, as spawning onto an occupied spawn point left them.
  const enemy = state.enemies[0];
  enemy.x = state.player.x;
  enemy.y = state.player.y;
  const y0 = state.player.y;
  run(state, { dir: "down" }, 20);
  assert.ok(state.player.y > y0, `player stayed at y=${state.player.y}`);
});

test("tanks stay solid to each other: the player stops at an enemy, never inside it", () => {
  const state = intoPlaying(createGame([OPEN]));
  state.player.invulnerable = 10_000;
  const enemy = state.enemies[0];
  enemy.x = 0;
  enemy.y = 9 * TILE;
  for (let i = 0; i < 90; i++) {
    run(state, { dir: "down" }, 1);
    for (const e of state.enemies) assert.ok(!overlapping(state.player, e), `overlap at tick ${i}`);
  }
});

test("a player shell destroys the brick it hits", () => {
  const state = intoPlaying(createGame([OPEN]));
  assert.equal(state.player.dir, "up");
  run(state, { fire: true }, 1);
  run(state, {}, 30);
  assert.equal(state.tiles[5 * 13 + 0], ".");
});

// ---- enemy spawning: the three fixed NES Battle City slots ----

const asLevelOne = (level) => ({ ...structuredClone(level), id: 1 });

// Like intoPlaying, but stops before the first playing tick, which is the
// tick the first enemy spawns in.
const toFirstSpawn = (state) => {
  run(state, { start: true }, 1);
  run(state, {}, PHASE_TICKS.levelStart);
  assert.equal(state.phase, "playing");
  assert.equal(state.enemies.length, 0);
  return state;
};

/**
 * Steps `ticks` with an invulnerable player and returns each enemy as first
 * seen. Enemies move in the tick they spawn, so a spawn point is matched
 * within one tick's travel (under 2 px at every speed the levels use).
 */
function recordSpawns(state, ticks) {
  const seen = new Map();
  for (let i = 0; i < ticks && state.phase === "playing"; i++) {
    if (state.player) state.player.invulnerable = 10_000;
    run(state, {}, 1);
    for (const e of state.enemies) {
      if (!seen.has(e.id)) seen.set(e.id, { kind: e.kind, x: e.x, y: e.y, tick: state.tick });
    }
  }
  return [...seen.values()];
}
const near = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 2;
const slotOf = (spawn) => ENEMY_SPAWN_SLOTS.findIndex((slot) => near(slot, spawn));

const glyphPositions = (level, glyph) => {
  const out = [];
  level.map.forEach((line, row) => [...line].forEach((ch, col) => ch === glyph && out.push({ x: col * TILE, y: row * TILE })));
  return out;
};

test("the three spawn slots are the top-left, top-center and top-right tiles", () => {
  assert.deepEqual(ENEMY_SPAWN_SLOTS, [{ x: 0, y: 0 }, { x: 6 * TILE, y: 0 }, { x: 12 * TILE, y: 0 }]);
});

test("every enemy on every level enters at one of the three slots (a sniper may take its post)", () => {
  const used = new Set();
  for (const level of levels) {
    const posts = glyphPositions(level, "N");
    const spawns = recordSpawns(toFirstSpawn(createGame([asLevelOne(level)])), 60 * 60);
    assert.ok(spawns.length >= 3, `level ${level.id}: only ${spawns.length} spawns`);
    for (const spawn of spawns) {
      const slot = slotOf(spawn);
      const onPost = spawn.kind === "sniper" && posts.some((post) => near(post, spawn));
      assert.ok(slot >= 0 || onPost, `level ${level.id}: ${spawn.kind} entered at (${spawn.x}, ${spawn.y})`);
      if (slot >= 0) used.add(slot);
    }
  }
  assert.deepEqual([...used].sort(), [0, 1, 2]);
});

// Open ground; the base is walled in by steel so no enemy can end the level
// before the spawns under test have happened.
const OPEN_FIELD = (count, extra = {}) => ({
  ...fixture([
    ".............",
    ".............",
    ".............",
    ".............",
    ".............",
    ".............",
    ".............",
    ".............",
    ".............",
    ".............",
    "1............",
    "...........SS",
    "P..........SE",
  ]),
  waves: [{ enemies: [{ type: "grunt", count }] }],
  ...extra,
});

test("spawns cycle left, center, right, left", () => {
  const spawns = recordSpawns(toFirstSpawn(createGame([OPEN_FIELD(4)])), SPAWN_INTERVAL * 3 + 10);
  assert.deepEqual(spawns.map(slotOf), [0, 1, 2, 0]);
});

test("a slot a tank stands on is skipped, never spawned onto", () => {
  const level = OPEN_FIELD(1);
  level.map = [...level.map];
  level.map[0] = "P............";
  level.map[12] = "...........SE";
  const state = toFirstSpawn(createGame([level]));
  const spawns = recordSpawns(state, 5);
  assert.deepEqual(spawns.map(slotOf), [1]);
  assert.ok(!overlapping(state.player, state.enemies[0]));
});

test("with every slot occupied the next enemy waits instead of stacking", () => {
  const state = intoPlaying(createGame([OPEN_FIELD(4)]));
  // Park three enemies on the slots, frozen, so the fourth has nowhere to go.
  state.enemies = [];
  state.spawnQueue = ["grunt"];
  state.spawnTicks = 1;
  state.levels = [{ ...state.levels[0], speedMult: 1e-9 }];
  const parked = ENEMY_SPAWN_SLOTS.map((slot, i) => ({
    id: 900 + i, kind: "grunt", x: slot.x, y: slot.y, dir: "down", moving: false,
    cooldown: 1e9, hitsLeft: 1, invulnerable: 0, burstLeft: 0, aimTicks: 0,
  }));
  state.enemies.push(...parked);
  run(state, {}, 10);
  assert.equal(state.enemies.length, 3);
  assert.deepEqual(state.spawnQueue, ["grunt"]);
});

test("paired hunters enter together at consecutive slots", () => {
  const level = {
    ...OPEN_FIELD(1),
    waves: [{ enemies: [{ type: "hunter", count: 2 }] }],
    rules: { hunterPairs: true },
  };
  const spawns = recordSpawns(toFirstSpawn(createGame([level])), 5);
  assert.deepEqual(spawns.map(slotOf), [0, 1]);
  assert.equal(spawns[0].tick, spawns[1].tick);
});
