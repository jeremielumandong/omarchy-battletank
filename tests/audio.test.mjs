// Pins the audio policy (docs/audio-architecture.md). The first group passes
// now: src/audio/cues.mjs is the design, not a stub. The "engine emits" group
// pins the three GameEvent kinds item (a) added to engine.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CUE_IDS,
  EVENT_CUES,
  PHASE_MUSIC,
  SUPERSEDES,
  TRACK_IDS,
  cuesFor,
  musicFor,
} from "../src/audio/cues.mjs";
import { createGame, emptyInput, step } from "../src/core/engine.mjs";
import { PHASE_TICKS, TILE } from "../src/core/constants.mjs";
import { levels } from "../src/levels/index.mjs";

// engine.mjs GameEvent kinds, plus the three item (a) adds.
const EVENT_KINDS = [
  "shot",
  "explosion",
  "tileDestroyed",
  "baseHit",
  "tankLost",
  "levelClear",
  "enemyDestroyed",
  "gameOver",
  "complete",
];
// engine.mjs Phase.
const PHASES = [
  "title",
  "levelStart",
  "playing",
  "paused",
  "confirmAbandon",
  "levelClear",
  "baseDestroyed",
  "gameOver",
  "complete",
];

const ev = (kind) => ({ kind, x: 0, y: 0 });

test("every GameEvent kind has one cue, and every cue has a kind", () => {
  assert.deepEqual(Object.keys(EVENT_CUES).sort(), [...EVENT_KINDS].sort());
  assert.deepEqual([...new Set(Object.values(EVENT_CUES))].sort(), [...CUE_IDS].sort());
});

test("cue and track ids are kebab-case file stems", () => {
  for (const id of [...CUE_IDS, ...TRACK_IDS]) assert.match(id, /^[a-z]+(-[a-z]+)*$/);
});

test("supersession names only known cues", () => {
  for (const [cue, swallowed] of Object.entries(SUPERSEDES)) {
    assert.ok(CUE_IDS.includes(cue), cue);
    for (const small of swallowed) assert.ok(CUE_IDS.includes(small), small);
  }
});

test("every Phase has music: a known track, or silence that is not playing", () => {
  assert.deepEqual(Object.keys(PHASE_MUSIC).sort(), [...PHASES].sort());
  for (const phase of PHASES) {
    const music = musicFor(phase);
    assert.equal(typeof music.playing, "boolean", phase);
    if (music.track === null) assert.equal(music.playing, false, phase);
    else assert.ok(TRACK_IDS.includes(music.track), phase);
  }
});

test("pause holds the battle track, so Resume continues it", () => {
  assert.deepEqual(musicFor("playing"), { track: "battle", playing: true });
  assert.deepEqual(musicFor("paused"), { track: "battle", playing: false });
  assert.deepEqual(musicFor("confirmAbandon"), { track: "battle", playing: false });
});

test("cuesFor plays each cue once per step, in first-seen order", () => {
  assert.deepEqual(cuesFor([ev("shot"), ev("tileDestroyed"), ev("shot")]), ["shot", "brick"]);
  assert.deepEqual(cuesFor([]), []);
});

test("a kill is one sound: the destroy cue swallows the hit", () => {
  assert.deepEqual(cuesFor([ev("explosion"), ev("enemyDestroyed")]), ["enemy-destroyed"]);
  assert.deepEqual(cuesFor([ev("explosion"), ev("tankLost")]), ["player-destroyed"]);
  assert.deepEqual(cuesFor([ev("explosion"), ev("gameOver")]), ["game-over"]);
  assert.deepEqual(cuesFor([ev("explosion")]), ["hit"]);
});

// A running shell can pair a fresh QML file with a stale cached .mjs, so
// neither side may assume the other's id list (docs/audio-architecture.md).
test("unknown kinds and phases are silent, never a throw", () => {
  assert.deepEqual(cuesFor([ev("bogus"), ev("toString"), ev("shot")]), ["shot"]);
  assert.deepEqual(musicFor("bogus"), { track: null, playing: false });
  assert.deepEqual(musicFor("constructor"), { track: null, playing: false });
});

test("every event a real run emits has a cue", () => {
  const state = createGame(levels, { seed: 7 });
  const dirs = ["left", "up", "right", "down"];
  const seen = new Set();
  step(state, { ...emptyInput(), start: true });
  for (let t = 0; t < 3000; t++) {
    step(state, { ...emptyInput(), dir: dirs[Math.floor(t / 90) % 4], fire: t % 2 === 0 });
    for (const event of state.events) seen.add(event.kind);
  }
  assert.ok(seen.has("shot"));
  for (const kind of seen) assert.ok(Object.hasOwn(EVENT_CUES, kind), `no cue for "${kind}"`);
});

// ---- engine emits: acceptance cases for item (a) ----

// The same field as tests/core.test.mjs OPEN: player on row 6 at the left
// edge, the base at row 12 column 6, one grunt spawning top-right.
const OPEN = {
  id: 1,
  name: "fixture",
  speedMult: 1,
  waves: [{ enemies: [{ type: "grunt", count: 1 }] }],
  map: [
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
  ],
};

const kindsOver = (state, ticks) => {
  const kinds = [];
  for (let t = 0; t < ticks; t++) {
    step(state, emptyInput());
    for (const event of state.events) kinds.push(event.kind);
  }
  return kinds;
};

const playingWithOneEnemy = () => {
  const state = createGame([OPEN], { seed: 1 });
  step(state, { ...emptyInput(), start: true });
  kindsOver(state, PHASE_TICKS.levelStart + 1);
  for (let t = 0; t < 600 && state.enemies.length === 0; t++) step(state, emptyInput());
  assert.equal(state.phase, "playing");
  assert.equal(state.enemies.length, 1);
  return state;
};

// A still shell already inside its target resolves on the next step, so the
// cases below do not depend on aim or enemy AI.
const shellAt = (state, owner, x, y) =>
  state.shells.push({ id: state.nextId++, ownerId: owner.id, x, y, dir: "up", speed: 0 });
const shellInside = (state, owner, tank) => shellAt(state, owner, tank.x + 6, tank.y + 6);

const kindsOf = (state) => state.events.map((event) => event.kind);

test("a life lost with lives left still emits tankLost", () => {
  const state = playingWithOneEnemy();
  shellInside(state, state.enemies[0], state.player);
  step(state, emptyInput());
  assert.equal(state.phase, "playing");
  assert.ok(kindsOf(state).includes("tankLost"));
});

test("engine emits enemyDestroyed on a kill, not on a non-lethal hit", () => {
  const state = playingWithOneEnemy();
  const enemy = state.enemies[0];
  enemy.hitsLeft = 2;
  shellInside(state, state.player, enemy);
  step(state, emptyInput());
  assert.equal(state.destroyed, 0);
  assert.deepEqual(kindsOf(state), ["explosion"]);

  shellInside(state, state.player, enemy);
  step(state, emptyInput());
  assert.equal(state.destroyed, 1);
  assert.ok(kindsOf(state).includes("enemyDestroyed"));
});

test("engine emits gameOver, and no tankLost, on the last life", () => {
  const state = playingWithOneEnemy();
  state.lives = 1;
  shellInside(state, state.enemies[0], state.player);
  step(state, emptyInput());
  assert.equal(state.phase, "gameOver");
  assert.ok(kindsOf(state).includes("gameOver"));
  assert.ok(!kindsOf(state).includes("tankLost"));
});

test("engine emits gameOver once when a destroyed base reaches Game Over", () => {
  const state = playingWithOneEnemy();
  shellAt(state, state.player, 6 * TILE + 6, 12 * TILE + 6);
  step(state, emptyInput());
  assert.equal(state.phase, "baseDestroyed");
  assert.ok(!kindsOf(state).includes("gameOver"));
  const kinds = kindsOver(state, PHASE_TICKS.baseDestroyed);
  assert.equal(state.phase, "gameOver");
  assert.deepEqual(kinds.filter((kind) => kind === "gameOver"), ["gameOver"]);
});

test("engine emits complete once after the last level clears", () => {
  const state = playingWithOneEnemy();
  shellInside(state, state.player, state.enemies[0]);
  step(state, emptyInput());
  assert.equal(state.phase, "levelClear");
  const kinds = kindsOver(state, PHASE_TICKS.levelClear);
  assert.equal(state.phase, "complete");
  assert.deepEqual(kinds.filter((kind) => kind === "complete"), ["complete"]);
});
