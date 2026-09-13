// drawFrame against a recording fake context: which colors get painted where,
// and which words appear, for representative GameStates built by the real
// engine. Also pins the fixed retro palette and proves nothing outside it is
// ever painted.
// tests/qml/tst_render.qml checks the same frames as real Qt Canvas pixels.
import test from "node:test";
import assert from "node:assert/strict";
import { PALETTE, drawFrame } from "../src/render/draw.mjs";
import { createGame, emptyInput, step } from "../src/core/engine.mjs";
import { enemyTotal } from "../src/core/levels.mjs";
import { GRID, HUD_HEIGHT, PHASE_TICKS, TILE } from "../src/core/constants.mjs";
import { levels } from "../src/levels/index.mjs";

// Records every method call and property write, in order, as [name, ...args].
const recordingCtx = () => {
  const calls = [];
  return new Proxy(
    { calls },
    {
      get: (target, prop) => (prop in target ? target[prop] : (...args) => calls.push([prop, ...args])),
      set: (target, prop, value) => calls.push([prop, value]) > 0,
    },
  );
};

const render = (state) => {
  const ctx = recordingCtx();
  drawFrame(ctx, state);
  return ctx.calls;
};

// Each fillRect / fillText with the fillStyle in effect when it was made.
const draws = (calls) => {
  let fill = null;
  const out = [];
  for (const [op, ...args] of calls) {
    if (op === "fillStyle") fill = args[0];
    else if (op === "fillRect" || op === "fillText" || op === "fill") out.push({ op, args, fill });
  }
  return out;
};
const texts = (calls) => draws(calls).filter((d) => d.op === "fillText").map((d) => d.args[0]);
const textColor = (calls, text) => draws(calls).find((d) => d.op === "fillText" && d.args[0] === text)?.fill;
const rectColors = (calls, x, y, w, h) =>
  draws(calls)
    .filter((d) => d.op === "fillRect" && d.args[0] === x && d.args[1] === y && d.args[2] === w && d.args[3] === h)
    .map((d) => d.fill);
const paintedWith = (calls, color) => calls.some(([op, value]) => op === "fillStyle" && value === color);

// ---- states, from the real engine ----

const titleState = () => createGame(levels, { seed: 1 });
const levelStartState = () => {
  const state = createGame(levels, { seed: 1 });
  step(state, Object.assign(emptyInput(), { start: true }));
  return state;
};
const playingState = () => {
  const state = levelStartState();
  for (let t = 0; t < PHASE_TICKS.levelStart; t++) step(state, emptyInput());
  assert.equal(state.phase, "playing");
  return state;
};
const enemy = (id, kind, col, row, extra = {}) =>
  Object.assign(
    { id, kind, x: col * TILE, y: row * TILE, dir: "down", moving: false, cooldown: 60, hitsLeft: 1, invulnerable: 0, burstLeft: 0, aimTicks: 0 },
    extra,
  );
// Screen y of a playfield row: the field is drawn under the HUD strip.
const screenY = (row) => HUD_HEIGHT + row * TILE;
// The left track of a vertical tank, which is always painted in the tank's color.
const trackColors = (calls, x, y) => rectColors(calls, x + 1, HUD_HEIGHT + y + 1, 3, 14);

// ---- palette ----

test("the palette is the fixed retro table from game-design §5", () => {
  assert.deepEqual(PALETTE, {
    background: "#15140F",
    hudText: "#D9D3BE",
    hudAccent: "#C8A94E",
    hudDanger: "#B8342A",
    player: "#C8A94E",
    grunt: "#6B6E47",
    sniper: "#C2A876",
    hunter: "#46545E",
    eliteRim: "#E0A030",
    brickFill: "#5C2E1E",
    brickEdge: "#9C5A3C",
    steelFill: "#333F49",
    steelEdge: "#7C93A0",
    waterFill: "#1E3A45",
    waterEdge: "#4A90A0",
    base: "#B8B8A0",
    shellCore: "#EDEAD9",
  });
  assert.ok(Object.isFrozen(PALETTE));
});

test("every color painted comes from the palette, in every phase", () => {
  const phases = ["title", "levelStart", "playing", "paused", "confirmAbandon", "levelClear", "baseDestroyed", "gameOver", "complete"];
  const painted = new Set();
  const collect = (state) => {
    for (const [op, value] of render(state)) if (op === "fillStyle") painted.add(value);
  };
  collect(titleState());
  for (const phase of phases) {
    const state = playingState();
    state.phase = phase;
    state.tick = 0; // Elite Hunter rim is on
    state.tiles[0] = "S";
    state.tiles[1] = "W";
    state.enemies = [
      enemy(901, "grunt", 0, 0),
      enemy(902, "sniper", 2, 0, { aimTicks: 5 }),
      enemy(903, "hunter", 4, 0),
      enemy(904, "eliteHunter", 6, 0, { hitsLeft: 2 }),
    ];
    // One shell from a live firer, one that outlived its firer.
    state.shells = [
      { id: 950, ownerId: 901, x: 40, y: 40, dir: "down", speed: 2 },
      { id: 951, ownerId: 999, x: 60, y: 60, dir: "down", speed: 2 },
    ];
    collect(state);
  }
  const lost = playingState();
  lost.player = null;
  lost.respawnTicks = 30;
  collect(lost);

  const allowed = new Set(Object.values(PALETTE));
  for (const color of painted) assert.ok(allowed.has(color), `${color} is not a PALETTE color`);
  // And the states above really exercise the whole table, so the check isn't vacuous.
  assert.deepEqual([...painted].sort(), [...allowed].sort());
});

// ---- screens ----

test("title screen: title copy and a player tank, no HUD and no level", () => {
  const calls = render(titleState());
  assert.deepEqual(texts(calls), ["BATTLETANK", "PRESS START"]);
  assert.ok(paintedWith(calls, PALETTE.player));
  assert.ok(!paintedWith(calls, PALETTE.brickFill));
});

test("in-level: HUD reads lives, level and every enemy still to come", () => {
  const state = playingState();
  const calls = render(state);
  assert.equal(enemyTotal(state.levels[0]), 6);
  assert.deepEqual(texts(calls), ["LIVES ×3", "LEVEL 1/10", "ENEMIES 6"]);
  // One on the field, one no longer queued: 6 − 1 still to spawn + 1 alive.
  state.enemies = [enemy(900, "grunt", 0, 0)];
  state.spawnQueue = state.spawnQueue.slice(2);
  assert.ok(texts(render(state)).includes("ENEMIES 5"));
});

test("in-level: base status dot is base-colored while the base stands", () => {
  const dot = draws(render(playingState())).find((d) => d.op === "fill");
  assert.equal(dot.fill, PALETTE.base);
});

test("in-level: every terrain glyph paints its fill, edge and the base", () => {
  const state = playingState();
  const brick = state.tiles.indexOf("B");
  const [col, row] = [brick % GRID, Math.floor(brick / GRID)];
  let calls = render(state);
  assert.deepEqual(rectColors(calls, col * TILE, screenY(row), TILE, TILE), [PALETTE.brickFill]);
  assert.ok(rectColors(calls, col * TILE, screenY(row), TILE, 1).includes(PALETTE.brickEdge));
  const base = state.basePos;
  assert.deepEqual(rectColors(calls, base.x + 4, HUD_HEIGHT + base.y + 4, 8, 8), [PALETTE.base]);

  state.tiles[0] = "S";
  state.tiles[1] = "W";
  calls = render(state);
  assert.deepEqual(rectColors(calls, 0, screenY(0), TILE, TILE), [PALETTE.steelFill]);
  assert.ok(rectColors(calls, 0, screenY(0), TILE, 1).includes(PALETTE.steelEdge));
  assert.deepEqual(rectColors(calls, TILE, screenY(0), TILE, TILE), [PALETTE.waterFill]);
  assert.ok(rectColors(calls, TILE, screenY(0), TILE, 1).includes(PALETTE.waterEdge));
});

test("in-level: the player and each enemy type paint in their own color", () => {
  const state = playingState();
  state.enemies = [enemy(901, "grunt", 0, 0), enemy(902, "sniper", 2, 0), enemy(903, "hunter", 4, 0)];
  const calls = render(state);
  assert.deepEqual(trackColors(calls, state.player.x, state.player.y), [PALETTE.player]);
  assert.deepEqual(trackColors(calls, 0, 0), [PALETTE.grunt]);
  assert.deepEqual(trackColors(calls, 2 * TILE, 0), [PALETTE.sniper]);
  assert.deepEqual(trackColors(calls, 4 * TILE, 0), [PALETTE.hunter]);
});

test("a shell has a shellCore center and glows in its firer's color", () => {
  const state = playingState();
  state.enemies = [enemy(901, "grunt", 0, 0)];
  state.shells = [{ id: 950, ownerId: 901, x: 40, y: 40, dir: "down", speed: 2 }];
  const calls = render(state);
  assert.deepEqual(rectColors(calls, 40, HUD_HEIGHT + 40, 4, 4), [PALETTE.grunt]);
  assert.deepEqual(rectColors(calls, 41, HUD_HEIGHT + 41, 2, 2), [PALETTE.shellCore]);
});

test("the Elite Hunter is Hunter-colored with an amber rim that pulses at ~1 Hz", () => {
  const state = playingState();
  state.enemies = [enemy(904, "eliteHunter", 3, 2, { hitsLeft: 2 })];
  state.tiles[2 * GRID + 3] = "."; // level 1 has brick here; a tank can't stand on it
  const rimTop = () => rectColors(render(state), 3 * TILE, screenY(2), TILE, 1);
  state.tick = 0;
  assert.deepEqual(trackColors(render(state), 3 * TILE, 2 * TILE), [PALETTE.hunter]);
  assert.deepEqual(rimTop(), [PALETTE.eliteRim]);
  state.tick = 30;
  assert.deepEqual(rimTop(), []);
  state.tick = 60;
  assert.deepEqual(rimTop(), [PALETTE.eliteRim]);
  // A plain Hunter never gets the rim.
  state.enemies[0].kind = "hunter";
  state.tick = 0;
  assert.deepEqual(rimTop(), []);
});

test("a respawned player flickers while invulnerable", () => {
  const state = playingState();
  const { x, y } = state.player;
  state.player.invulnerable = 60;
  state.tick = 0;
  assert.deepEqual(trackColors(render(state), x, y), [PALETTE.player]);
  state.tick = 4;
  assert.deepEqual(trackColors(render(state), x, y), []);
});

// Phase → the game-design §7 copy it must show.
const PHASE_COPY = {
  levelStart: ["LEVEL 1"],
  paused: ["PAUSED", "RESUME", "RESTART LEVEL", "ABANDON RUN"],
  confirmAbandon: ["Abandon this run?", "Your progress since Level 1 will be lost.", "ABANDON RUN", "KEEP PLAYING"],
  levelClear: ["LEVEL CLEAR", "0 destroyed · 3 lives left"],
  baseDestroyed: ["BASE DESTROYED"],
  gameOver: ["GAME OVER", "Reached Level 1. Press Start to try again."],
  complete: ["MISSION COMPLETE", "All 10 levels cleared."],
};

for (const [phase, copy] of Object.entries(PHASE_COPY)) {
  test(`${phase} screen shows its copy over the HUD`, () => {
    const state = playingState();
    state.phase = phase;
    const shown = texts(render(state));
    for (const line of copy) assert.ok(shown.includes(line), `${phase} is missing "${line}": ${JSON.stringify(shown)}`);
    assert.ok(shown.includes("LIVES ×3"));
  });
}

test("the abandon prompt is game-design §7's sentence, split only to fit the screen", () => {
  const state = playingState();
  state.phase = "confirmAbandon";
  const shown = texts(render(state));
  assert.equal(shown.slice(-4, -2).join(" "), "Abandon this run? Your progress since Level 1 will be lost.");
});

test("menus highlight the selected row", () => {
  const state = playingState();
  state.phase = "paused";
  state.menuIndex = 1;
  let calls = render(state);
  assert.equal(textColor(calls, "RESTART LEVEL"), PALETTE.hudAccent);
  assert.equal(textColor(calls, "RESUME"), PALETTE.hudText);
  state.phase = "confirmAbandon";
  state.menuIndex = 0;
  calls = render(state);
  assert.equal(textColor(calls, "ABANDON RUN"), PALETTE.hudDanger);
  assert.equal(textColor(calls, "KEEP PLAYING"), PALETTE.hudText);
});

test("TANK LOST shows while the player waits to respawn, and only then", () => {
  const state = playingState();
  assert.ok(!texts(render(state)).includes("TANK LOST"));
  state.player = null;
  state.respawnTicks = 30;
  assert.ok(texts(render(state)).includes("TANK LOST"));
});

test("a destroyed base turns the base tile and the status dot to danger", () => {
  const state = playingState();
  state.phase = "baseDestroyed";
  const calls = render(state);
  const base = state.basePos;
  assert.deepEqual(rectColors(calls, base.x + 4, HUD_HEIGHT + base.y + 4, 8, 8), [PALETTE.hudDanger]);
  assert.equal(draws(calls).find((d) => d.op === "fill").fill, PALETTE.hudDanger);
  // A lives-out Game Over (lives 0) says nothing against the base.
  state.phase = "gameOver";
  state.lives = 0;
  assert.equal(draws(render(state)).find((d) => d.op === "fill").fill, PALETTE.base);
});

test("drawFrame never changes the state it paints, in any phase", () => {
  const phases = ["title", "levelStart", "playing", "paused", "confirmAbandon", "levelClear", "baseDestroyed", "gameOver", "complete"];
  for (const phase of phases) {
    const state = playingState();
    state.phase = phase;
    state.enemies = [enemy(901, "sniper", 0, 0, { aimTicks: 5 }), enemy(904, "eliteHunter", 3, 2, { hitsLeft: 2 })];
    state.shells = [{ id: 950, ownerId: 901, x: 40, y: 40, dir: "down", speed: 2 }];
    const before = structuredClone(state);
    render(state);
    assert.deepEqual(state, before, phase);
  }
});
