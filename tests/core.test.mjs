// Pins the core interface (docs/architecture.md, "Boundary"). The first group
// passes against the stubs. The `todo` group is the engineer's acceptance bar:
// implement until those pass, then delete their `todo` option.
import test from "node:test";
import assert from "node:assert/strict";
import { createGame, emptyInput, step } from "../src/core/engine.mjs";
import { nextRandom } from "../src/core/rng.mjs";
import { PHASE_TICKS, PLAYER, TILE } from "../src/core/constants.mjs";
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

const TODO = "engine not implemented yet (docs/architecture.md)";

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

test("createGame starts a run on the title screen", { todo: TODO }, () => {
  const state = createGame(levels);
  assert.equal(state.phase, "title");
  assert.equal(state.lives, PLAYER.lives);
  assert.equal(state.levelIndex, 0);
});

test("createGame rejects malformed levels", { todo: TODO }, () => {
  assert.throws(() => createGame([{ id: 1 }]), /invalid levels/);
});

test("GameState is plain data", { todo: TODO }, () => {
  const state = intoPlaying(createGame([OPEN]));
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test("step is deterministic for a seed and an input sequence", { todo: TODO }, () => {
  const play = () => run(intoPlaying(createGame(levels, { seed: 7 })), { dir: "left", fire: true }, 300);
  assert.deepEqual(play(), play());
});

test("Start leads through levelStart into playing", { todo: TODO }, () => {
  const state = createGame([OPEN]);
  run(state, { start: true }, 1);
  assert.equal(state.phase, "levelStart");
  run(state, {}, PHASE_TICKS.levelStart + 1);
  assert.equal(state.phase, "playing");
});

test("the player covers 60 px in 60 ticks on open ground", { todo: TODO }, () => {
  const state = intoPlaying(createGame([OPEN]));
  const x0 = state.player.x;
  run(state, { dir: "right" }, 60);
  assert.equal(state.player.x - x0, 60);
  assert.equal(state.player.y, 6 * TILE);
});

test("a player shell destroys the brick it hits", { todo: TODO }, () => {
  const state = intoPlaying(createGame([OPEN]));
  assert.equal(state.player.dir, "up");
  run(state, { fire: true }, 1);
  run(state, {}, 30);
  assert.equal(state.tiles[5 * 13 + 0], ".");
});
