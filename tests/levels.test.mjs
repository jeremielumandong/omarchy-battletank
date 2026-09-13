import test from "node:test";
import assert from "node:assert/strict";
import { enemyTotal, loadLevels, obstacleDensity, validateLevel } from "../src/core/levels.mjs";
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
