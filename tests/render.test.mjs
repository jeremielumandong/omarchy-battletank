// drawFrame against a recording fake context: which colors get painted where,
// and which words appear, for representative GameStates built by the real
// engine. Also proves the theme lookup path without a live omarchy-shell:
// drawFrame must paint whatever theme.* values it's given, and fall back to
// DEFAULT_THEME for anything the caller leaves out (Overlay.qml only resolves
// the live-sourced keys; the rest come from the fallback table).
// tests/qml/tst_render.qml checks the same frames as real Qt Canvas pixels.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THEME, drawFrame } from "../src/render/draw.mjs";
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

const render = (state, theme) => {
  const ctx = recordingCtx();
  drawFrame(ctx, state, theme);
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

// ---- theme lookup ----

test("drawFrame falls back to DEFAULT_THEME.background when no theme is given", () => {
  assert.ok(paintedWith(render(titleState()), DEFAULT_THEME.background));
});

test("a partial theme (only the live-sourced keys) still paints — missing keys default", () => {
  const calls = render(playingState(), { background: "#abcdef" });
  assert.ok(paintedWith(calls, "#abcdef"));
  assert.ok(paintedWith(calls, DEFAULT_THEME.brickFill));
});

test("switching the theme changes what gets painted, proving the lookup isn't baked in", () => {
  const themeA = render(titleState(), { ...DEFAULT_THEME, background: "#111111" });
  const themeB = render(titleState(), { ...DEFAULT_THEME, background: "#222222" });
  assert.ok(paintedWith(themeA, "#111111"));
  assert.ok(paintedWith(themeB, "#222222"));
  assert.ok(!paintedWith(themeA, "#222222"));
});

test("every live-sourced key reaches the pixels it names", () => {
  const live = { background: "#000001", hudText: "#000002", hudAccent: "#000003", hudDanger: "#000004", player: "#000005" };
  const state = playingState();
  state.lives = 1;
  const calls = render(state, live);
  const { player } = state;
  assert.deepEqual(rectColors(calls, 0, 0, 208, 224), ["#000001"]);
  assert.equal(textColor(calls, "ENEMIES 6"), "#000002");
  assert.equal(textColor(calls, "LEVEL 1/10"), "#000003");
  assert.equal(textColor(calls, "LIVES ×1"), "#000004");
  assert.deepEqual(trackColors(calls, player.x, player.y), ["#000005"]);
});

// ---- screens ----

test("title screen: title copy and a player tank, no HUD and no level", () => {
  const calls = render(titleState());
  assert.deepEqual(texts(calls), ["BATTLETANK", "PRESS START"]);
  assert.ok(paintedWith(calls, DEFAULT_THEME.player));
  assert.ok(!paintedWith(calls, DEFAULT_THEME.brickFill));
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

test("in-level: base status dot is green while the base stands", () => {
  const dot = draws(render(playingState())).find((d) => d.op === "fill");
  assert.equal(dot.fill, DEFAULT_THEME.base);
});

test("in-level: every terrain glyph paints its fill, edge and the base", () => {
  const state = playingState();
  const brick = state.tiles.indexOf("B");
  const [col, row] = [brick % GRID, Math.floor(brick / GRID)];
  let calls = render(state);
  assert.deepEqual(rectColors(calls, col * TILE, screenY(row), TILE, TILE), [DEFAULT_THEME.brickFill]);
  assert.ok(rectColors(calls, col * TILE, screenY(row), TILE, 1).includes(DEFAULT_THEME.brickEdge));
  const base = state.basePos;
  assert.deepEqual(rectColors(calls, base.x + 4, HUD_HEIGHT + base.y + 4, 8, 8), [DEFAULT_THEME.base]);

  state.tiles[0] = "S";
  state.tiles[1] = "W";
  calls = render(state);
  assert.deepEqual(rectColors(calls, 0, screenY(0), TILE, TILE), [DEFAULT_THEME.steelFill]);
  assert.ok(rectColors(calls, 0, screenY(0), TILE, 1).includes(DEFAULT_THEME.steelEdge));
  assert.deepEqual(rectColors(calls, TILE, screenY(0), TILE, TILE), [DEFAULT_THEME.waterFill]);
  assert.ok(rectColors(calls, TILE, screenY(0), TILE, 1).includes(DEFAULT_THEME.waterEdge));
});

test("in-level: the player and each enemy type paint in their own color", () => {
  const state = playingState();
  state.enemies = [enemy(901, "grunt", 0, 0), enemy(902, "sniper", 2, 0), enemy(903, "hunter", 4, 0)];
  const calls = render(state);
  assert.deepEqual(trackColors(calls, state.player.x, state.player.y), [DEFAULT_THEME.player]);
  assert.deepEqual(trackColors(calls, 0, 0), [DEFAULT_THEME.grunt]);
  assert.deepEqual(trackColors(calls, 2 * TILE, 0), [DEFAULT_THEME.sniper]);
  assert.deepEqual(trackColors(calls, 4 * TILE, 0), [DEFAULT_THEME.hunter]);
});

test("a shell has a white core and glows in its firer's color", () => {
  const state = playingState();
  state.enemies = [enemy(901, "grunt", 0, 0)];
  state.shells = [{ id: 950, ownerId: 901, x: 40, y: 40, dir: "down", speed: 2 }];
  const calls = render(state);
  assert.deepEqual(rectColors(calls, 40, HUD_HEIGHT + 40, 4, 4), [DEFAULT_THEME.grunt]);
  assert.deepEqual(rectColors(calls, 41, HUD_HEIGHT + 41, 2, 2), [DEFAULT_THEME.shellCore]);
});

test("the Elite Hunter is Hunter-colored with a white rim that pulses at ~1 Hz", () => {
  const state = playingState();
  state.enemies = [enemy(904, "eliteHunter", 3, 2, { hitsLeft: 2 })];
  state.tiles[2 * GRID + 3] = "."; // level 1 has brick here; a tank can't stand on it
  const rimTop = () => rectColors(render(state), 3 * TILE, screenY(2), TILE, 1);
  state.tick = 0;
  assert.deepEqual(trackColors(render(state), 3 * TILE, 2 * TILE), [DEFAULT_THEME.hunter]);
  assert.deepEqual(rimTop(), [DEFAULT_THEME.eliteRim]);
  state.tick = 30;
  assert.deepEqual(rimTop(), []);
  state.tick = 60;
  assert.deepEqual(rimTop(), [DEFAULT_THEME.eliteRim]);
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
  assert.deepEqual(trackColors(render(state), x, y), [DEFAULT_THEME.player]);
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
  assert.equal(textColor(calls, "RESTART LEVEL"), DEFAULT_THEME.hudAccent);
  assert.equal(textColor(calls, "RESUME"), DEFAULT_THEME.hudText);
  state.phase = "confirmAbandon";
  state.menuIndex = 0;
  calls = render(state);
  assert.equal(textColor(calls, "ABANDON RUN"), DEFAULT_THEME.hudDanger);
  assert.equal(textColor(calls, "KEEP PLAYING"), DEFAULT_THEME.hudText);
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
  assert.deepEqual(rectColors(calls, base.x + 4, HUD_HEIGHT + base.y + 4, 8, 8), [DEFAULT_THEME.hudDanger]);
  assert.equal(draws(calls).find((d) => d.op === "fill").fill, DEFAULT_THEME.hudDanger);
  // A lives-out Game Over (lives 0) says nothing against the base.
  state.phase = "gameOver";
  state.lives = 0;
  assert.equal(draws(render(state)).find((d) => d.op === "fill").fill, DEFAULT_THEME.base);
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
