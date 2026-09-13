// Pins the core interface (docs/architecture.md, "Boundary"). The first group
// passes against the stubs; the rest were the engineer's acceptance bar for
// implementing engine.mjs, now closed.
import test from "node:test";
import assert from "node:assert/strict";
import { createGame, emptyInput, step } from "../src/core/engine.mjs";
import { nextRandom } from "../src/core/rng.mjs";
import { ENEMY_SPAWN_SLOTS, PHASE_TICKS, PLAYER, SPAWN_INTERVAL, TILE } from "../src/core/constants.mjs";
import { TERRAIN, tilesUnder } from "../src/core/collision.mjs";
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
    cooldown: 1e9, hitsLeft: 1, invulnerable: 0, burstLeft: 0, aimTicks: 0, blockedTicks: 0,
  }));
  state.enemies.push(...parked);
  run(state, {}, 10);
  assert.equal(state.enemies.length, 3);
  assert.deepEqual(state.spawnQueue, ["grunt"]);
});

test("a sniper post a tank stands on is skipped; the sniper falls back to a free slot", () => {
  const level = OPEN_FIELD(1);
  level.map = [...level.map];
  level.map[5] = ".....N.......";
  level.waves = [{ enemies: [{ type: "sniper", count: 1 }] }];
  const state = toFirstSpawn(createGame([level]));
  const post = state.availableSniperPosts[0];
  state.spawnQueue = ["sniper"];
  state.spawnTicks = 1;
  state.enemies.push({
    id: 900, kind: "grunt", x: post.x, y: post.y, dir: "down", moving: false,
    cooldown: 1e9, hitsLeft: 1, invulnerable: 0, burstLeft: 0, aimTicks: 0, blockedTicks: 0,
  });
  run(state, {}, 5);
  assert.equal(state.enemies.length, 2);
  const sniper = state.enemies.find((e) => e.kind === "sniper");
  assert.ok(sniper, "sniper should have spawned despite the post being occupied");
  assert.ok(slotOf(sniper) >= 0, "sniper falls back to one of the three slots, not stacked on the post");
  assert.ok(!overlapping(state.enemies[0], sniper));
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

// ---- enemy AI: pathing, shooting through brick, facing the target ----

/** Steps until `done(state)` or `limit` ticks; returns the ticks taken, or Infinity. */
const ticksUntil = (state, done, limit, input = {}) => {
  for (let i = 1; i <= limit; i++) {
    run(state, input, 1);
    if (done(state)) return i;
  }
  return Infinity;
};

const withoutPlayer = (state) => {
  state.player = null;
  state.respawnTicks = 1e9;
  return state;
};

// A steel wall across the field with one gap on the far right. Enemies enter
// top-left; the base and the player are straight below them, past the wall.
const WALLED = fixture([
  "1............",
  ".............",
  ".............",
  ".............",
  ".............",
  "SSSSSSSSSSSS.",
  ".............",
  ".............",
  ".............",
  ".............",
  ".............",
  ".............",
  "E...........P",
]);

test("a grunt paths around a wall to the base instead of stalling against it", () => {
  // Before: the greedy mover only ever tried "down" and sat on the steel forever.
  const state = withoutPlayer(toFirstSpawn(createGame([WALLED])));
  const took = ticksUntil(state, (s) => s.phase === "baseDestroyed", 60 * 30);
  assert.ok(took < Infinity, `base still standing; grunt at ${JSON.stringify(state.enemies.map((e) => [e.x, e.y]))}`);
});

test("a hunter paths around a wall and hits the player", () => {
  const level = { ...WALLED, map: [...WALLED.map], waves: [{ enemies: [{ type: "hunter", count: 1 }] }] };
  level.map[12] = "P...........E";
  level.map[11] = "...........SS";
  const state = toFirstSpawn(createGame([level]));
  const took = ticksUntil(state, (s) => s.lives < PLAYER.lives, 60 * 30);
  assert.ok(took < Infinity, `player never hit; hunter at ${JSON.stringify(state.enemies.map((e) => [e.x, e.y]))}`);
});

test("enemies shoot through brick: level 1's base falls with nobody defending it", () => {
  // Before: in 3600 ticks level 1's grunts fired 0 shells and broke 0 bricks.
  const state = withoutPlayer(toFirstSpawn(createGame([levels[0]])));
  let bricks = 0;
  const took = ticksUntil(
    state,
    (s) => {
      bricks += s.events.filter((e) => e.kind === "tileDestroyed").length;
      return s.phase === "baseDestroyed";
    },
    60 * 90,
  );
  assert.ok(bricks > 0, "no brick broken");
  assert.ok(took < Infinity, "base still standing after 90 s");
});

test("an enemy whose spawn is walled below drives on instead of jittering in place", () => {
  // Before: every tick turned down (snapping x back to 0), hit the steel,
  // then moved right 1 px, so the grunt sat at x=0..1 forever.
  const level = fixture([
    "1............",
    "SS...........",
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
    "P.....E......",
  ]);
  const state = withoutPlayer(toFirstSpawn(createGame([level])));
  run(state, {}, 60);
  assert.ok(state.enemies[0].x >= 2 * TILE || state.enemies[0].y > 0, `grunt at (${state.enemies[0].x}, ${state.enemies[0].y})`);
});

const SNIPER_ROW = {
  ...fixture([
    "............1",
    "N...........P",
    ".............",
    ".............",
    ".............",
    ".............",
    ".............",
    ".............",
    ".............",
    ".............",
    ".............",
    "...........SS",
    "...........SE",
  ]),
  waves: [{ enemies: [{ type: "sniper", count: 1 }] }],
};

test("a sniper turns to fire along its row at the player", () => {
  // Before: it kept its spawn heading and fired every shell downward.
  const state = toFirstSpawn(createGame([SNIPER_ROW]));
  const dirs = new Set();
  for (let i = 0; i < 300; i++) {
    state.player.invulnerable = 10_000;
    run(state, {}, 1);
    const sniper = state.enemies[0];
    for (const shell of state.shells) if (sniper && shell.ownerId === sniper.id) dirs.add(shell.dir);
  }
  assert.deepEqual([...dirs], ["right"]);
});

test("an enemy holds fire while another enemy stands between it and its target", () => {
  const state = intoPlaying(createGame([OPEN]));
  state.levels = [{ ...state.levels[0], speedMult: 1e-9 }];
  state.player.invulnerable = 10_000;
  state.player.x = 6 * TILE;
  state.player.y = 10 * TILE;
  const grunt = (id, row, cooldown) => ({
    id, kind: "grunt", x: 6 * TILE, y: row * TILE, dir: "down", moving: false,
    cooldown, hitsLeft: 1, invulnerable: 0, burstLeft: 0, aimTicks: 0, blockedTicks: 0,
  });
  const shooter = grunt(900, 2, 0);
  const inTheWay = grunt(901, 5, 1e9);
  state.enemies = [shooter, inTheWay];
  const shooterShells = () => state.shells.filter((s) => s.ownerId === shooter.id).length;
  run(state, {}, 30);
  assert.equal(shooterShells(), 0);
  assert.equal(state.enemies.length, 2);
  inTheWay.x = 0;
  run(state, {}, 2);
  assert.equal(shooterShells(), 1);
});

test("no tank ever overlaps a wall or another tank across all ten levels", () => {
  for (const level of levels) {
    const state = toFirstSpawn(createGame([asLevelOne(level)], { seed: level.id }));
    for (let i = 0; i < 60 * 40 && state.phase === "playing"; i++) {
      if (state.player) state.player.invulnerable = 10_000;
      run(state, {}, 1);
      const tanks = state.player ? [state.player, ...state.enemies] : state.enemies;
      for (const tank of tanks) {
        for (const { col, row } of tilesUnder({ x: tank.x, y: tank.y, w: TILE, h: TILE })) {
          assert.ok(!TERRAIN[state.tiles[row * 13 + col]].blocksTank, `level ${level.id} tick ${i}: tank ${tank.id} inside a wall`);
        }
      }
      for (let a = 0; a < tanks.length; a++) {
        for (let b = a + 1; b < tanks.length; b++) {
          assert.ok(!overlapping(tanks[a], tanks[b]), `level ${level.id} tick ${i}: tanks ${tanks[a].id} and ${tanks[b].id} overlap`);
        }
      }
    }
  }
});
