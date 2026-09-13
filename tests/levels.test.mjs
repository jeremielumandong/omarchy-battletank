import test from "node:test";
import assert from "node:assert/strict";
import { enemyTotal, loadLevels, obstacleDensity, validateLevel } from "../src/core/levels.mjs";
import { GRID } from "../src/core/constants.mjs";
import { levels } from "../src/levels/index.mjs";
import { level as level01 } from "../src/levels/01.mjs";

const problemsAfter = (mutate) => {
  const level = structuredClone(level01);
  mutate(level);
  return validateLevel(level);
};

test("every shipped level loads", () => {
  assert.equal(loadLevels(levels).length, levels.length);
});

test(
  "all 10 levels are authored",
  { todo: levels.length < 10 ? "levels 02-10 not authored yet" : false },
  () => assert.equal(levels.length, 10),
);

// game-design §4 is the source of truth for the curve. These pin each level's
// data to those rules, so the table and the files cannot drift apart.
test("levels follow the game-design §4 scaling rules", () => {
  for (const level of levels) {
    const L = level.id;
    assert.equal(enemyTotal(level), 5 + L + Math.floor(L / 3), `level ${L} enemy count`);
    assert.ok(Math.abs(level.speedMult - (1 + 0.04 * (L - 1))) < 1e-9, `level ${L} speedMult`);
    assert.equal(level.waves.length, L <= 4 ? 1 : L <= 8 ? 2 : 3, `level ${L} wave count`);
    const target = 0.2 + 0.05 * (L - 1);
    assert.ok(Math.abs(obstacleDensity(level) - target) <= 0.05, `level ${L} density ${obstacleDensity(level)} vs ${target}`);
  }
});

// ---- playability: the map must let the level be won and lost ----
// Tanks are blocked by brick, steel, water and the base; shells only by steel
// (game-design §1 matrix). Brick counts as a wall here even though it can be
// shot away: a map should not depend on enemies tunnelling to reach anyone.

const TANK_BLOCKING = ["B", "S", "W", "E"];
const cellsOf = (map, glyphs) => {
  const out = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) if (glyphs.includes(map[r][c])) out.push([r, c]);
  }
  return out;
};
// Where enemies enter: the three NES spawn slots (top-left, top-center,
// top-right), every spawn digit the map places, and the sniper posts.
const enemyEntries = (map) => [[0, 0], [0, (GRID - 1) / 2], [0, GRID - 1], ...cellsOf(map, ["1", "2", "3", "N"])];
const drivable = (map, [r, c]) => r >= 0 && r < GRID && c >= 0 && c < GRID && !TANK_BLOCKING.includes(map[r][c]);
const STEPS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/** Every tile a tank starting at `from` can drive to, as "r,c" keys. */
function reachableFrom(map, from) {
  const seen = new Set([from.join()]);
  const queue = [from];
  while (queue.length > 0) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of STEPS) {
      const next = [r + dr, c + dc];
      if (drivable(map, next) && !seen.has(next.join())) {
        seen.add(next.join());
        queue.push(next);
      }
    }
  }
  return seen;
}

// Each check returns the problem with one level's map, or null.
const PLAYABILITY = {
  "every enemy entry and sniper post can drive to the player spawn": (map) => {
    const [player] = cellsOf(map, ["P"]);
    const stuck = enemyEntries(map).filter((entry) => !drivable(map, entry) || !reachableFrom(map, entry).has(player.join()));
    return stuck.length > 0 ? `entries ${JSON.stringify(stuck)} cannot reach P` : null;
  },
  "an enemy can stand somewhere with a steel-free line of fire to the base": (map) => {
    const [base] = cellsOf(map, ["E"]);
    const reachable = reachableFrom(map, enemyEntries(map)[0]);
    for (const [dr, dc] of STEPS) {
      for (let r = base[0] + dr, c = base[1] + dc; r >= 0 && r < GRID && c >= 0 && c < GRID; r += dr, c += dc) {
        if (map[r][c] === "S") break;
        if (reachable.has(`${r},${c}`)) return null;
      }
    }
    return "no tile an enemy can reach has a steel-free line of fire to the base";
  },
  "the base's own cover is never steel": (map) => {
    const [[r, c]] = cellsOf(map, ["E"]);
    const steel = STEPS.filter(([dr, dc]) => map[r + dr]?.[c + dc] === "S");
    return steel.length > 0 ? `steel next to the base at ${JSON.stringify(steel)}` : null;
  },
  "no row is solid wall from edge to edge": (map) => {
    const solid = [...map.keys()].filter((r) => [...map[r]].every((ch) => TANK_BLOCKING.includes(ch)));
    return solid.length > 0 ? `solid rows ${solid}` : null;
  },
  "terrain is left-right mirror symmetric (markers excepted)": (map) => {
    const terrain = (ch) => (TANK_BLOCKING.includes(ch) ? ch : ".");
    const off = [...map.keys()].filter((r) => [...map[r]].some((ch, c) => terrain(ch) !== terrain(map[r][GRID - 1 - c])));
    return off.length > 0 ? `asymmetric rows ${off}` : null;
  },
};

for (const [rule, check] of Object.entries(PLAYABILITY)) {
  test(`every level: ${rule}`, () => {
    const failures = levels.map((level) => [level.id, check(level.map)]).filter(([, problem]) => problem);
    assert.deepEqual(failures, []);
  });
}

test("loadLevels returns frozen copies and leaves the modules untouched", () => {
  const [loaded] = loadLevels([level01]);
  assert.ok(Object.isFrozen(loaded));
  assert.ok(Object.isFrozen(loaded.map));
  assert.ok(Object.isFrozen(loaded.waves[0].enemies[0]));
  assert.ok(!Object.isFrozen(level01));
});

test("loadLevels requires ids to follow index order", () => {
  const second = { ...structuredClone(level01), id: 3 };
  assert.throws(() => loadLevels([level01, second]), /level 2: id is 3, expected 2/);
});

test("loadLevels rejects an empty list", () => {
  assert.throws(() => loadLevels([]), /non-empty array/);
});

const malformed = [
  ["unknown top-level key", (l) => { l.speedmult = 1; }, /unknown key 'speedmult'/],
  ["missing name", (l) => { delete l.name; }, /name must be/],
  ["short map", (l) => { l.map.pop(); }, /array of 13 rows/],
  ["narrow row", (l) => { l.map[3] = "..."; }, /row 3 must be a string of 13/],
  ["unknown glyph", (l) => { l.map[1] = "......X......"; }, /unknown glyph 'X'/],
  ["no base", (l) => { l.map[12] = "....PBBB....."; }, /exactly one base/],
  ["two player spawns", (l) => { l.map[1] = "P............"; }, /exactly one player spawn/],
  ["no enemy spawn", (l) => { l.map[0] = "............."; }, /at least enemy spawn '1'/],
  ["spawn 2 without 1", (l) => { l.map[0] = "......2......"; }, /'2' used without/],
  ["duplicate spawn", (l) => { l.map[1] = "1............"; }, /'1' appears 2 times/],
  ["unknown enemy type", (l) => { l.waves[0].enemies[0].type = "boss"; }, /unknown enemy type 'boss'/],
  ["zero count", (l) => { l.waves[0].enemies[0].count = 0; }, /count must be a positive integer/],
  ["empty waves", (l) => { l.waves = []; }, /waves must be a non-empty array/],
  ["unknown rule", (l) => { l.rules = { hunterPair: true }; }, /unknown rule 'hunterPair'/],
  ["bad rule value", (l) => { l.rules = { sniperRangeTiles: 0 }; }, /sniperRangeTiles must be/],
  ["sniper post without sniper", (l) => { l.map[1] = "N............"; }, /1 sniper posts but the waves hold only 0/],
];

for (const [name, mutate, expected] of malformed) {
  test(`rejects: ${name}`, () => {
    const problems = problemsAfter(mutate);
    assert.ok(problems.some((p) => expected.test(p)), `got ${JSON.stringify(problems)}`);
  });
}

test("accepts every glyph and rule the format defines", () => {
  const problems = problemsAfter((l) => {
    l.map[1] = "S.W.N...2..3.";
    l.waves.push({ enemies: [{ type: "sniper", count: 1 }, { type: "eliteHunter", count: 1 }] });
    l.rules = { sniperRangeTiles: 6, hunterPairs: true };
  });
  assert.deepEqual(problems, []);
});
