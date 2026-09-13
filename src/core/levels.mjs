// The level format and its validator. This file is the design, not a stub:
// levels are data, and every rule a level must obey is checked here once, at
// load, so the engine can trust what it is given.
import {
  ENEMY_TYPES,
  GLYPHS,
  GRID,
  Glyph,
  OBSTACLE_GLYPHS,
  SPAWN_GLYPHS,
} from "./constants.mjs";

/**
 * One level, as authored in src/levels/NN.mjs. Plain data with no functions,
 * so the same object loads in Node tests and in QML unchanged.
 *
 * @typedef {Object} LevelDef
 * @property {number} id         1-based; must equal the level's position in src/levels/index.mjs.
 * @property {string} name
 * @property {string[]} map      GRID rows of GRID glyphs, top row first. See Glyph and SPAWN_GLYPHS.
 * @property {number} speedMult  Enemy speed multiplier, game-design §4 SpeedMult(L).
 * @property {Wave[]} waves      Spawned in order; a wave starts when the previous one thins out.
 * @property {LevelRules} [rules] Per-level behaviour switches from game-design §2 "New this level".
 */

/**
 * @typedef {Object} Wave
 * @property {{ type: EnemyTypeId, count: number }[]} enemies  Spawn order within the wave.
 */

/**
 * Behaviour switches, not new data kinds: a later level turns on a rule an
 * enemy already knows how to follow.
 *
 * @typedef {Object} LevelRules
 * @property {number} [sniperRangeTiles] Max straight-line firing range for snipers (level 6+).
 * @property {boolean} [hunterPairs]     Hunters spawn and advance in pairs (level 7+).
 */

/** @typedef {keyof typeof ENEMY_TYPES} EnemyTypeId */

const LEVEL_KEYS = ["id", "name", "map", "speedMult", "waves", "rules"];
const RULE_KEYS = ["sniperRangeTiles", "hunterPairs"];

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function countGlyph(map, glyph) {
  let n = 0;
  for (const row of map) for (const ch of row) if (ch === glyph) n++;
  return n;
}

/** Total enemies across every wave of a level. */
export function enemyTotal(level) {
  return level.waves.reduce(
    (sum, wave) => sum + wave.enemies.reduce((s, e) => s + e.count, 0),
    0,
  );
}

/** Share of the map covered by brick, steel or water (game-design §4 Density(L)). */
export function obstacleDensity(level) {
  const obstacles = OBSTACLE_GLYPHS.reduce((n, g) => n + countGlyph(level.map, g), 0);
  return obstacles / (GRID * GRID);
}

function validateMap(map, problems) {
  if (!Array.isArray(map) || map.length !== GRID) {
    problems.push(`map must be an array of ${GRID} rows`);
    return;
  }
  map.forEach((row, r) => {
    if (typeof row !== "string" || row.length !== GRID) {
      problems.push(`map row ${r} must be a string of ${GRID} glyphs`);
      return;
    }
    for (const ch of row) {
      if (!GLYPHS.includes(ch)) problems.push(`map row ${r} has unknown glyph '${ch}'`);
    }
  });
  if (problems.length > 0) return;

  const bases = countGlyph(map, Glyph.BASE);
  if (bases !== 1) problems.push(`map must have exactly one base '${Glyph.BASE}', found ${bases}`);
  const players = countGlyph(map, Glyph.PLAYER);
  if (players !== 1) problems.push(`map must have exactly one player spawn '${Glyph.PLAYER}', found ${players}`);

  // Spawn points are numbered from 1 without gaps, so "spawn 2" always means
  // the same place to whoever reads the map.
  let seenGap = false;
  for (const digit of SPAWN_GLYPHS) {
    const n = countGlyph(map, digit);
    if (n > 1) problems.push(`enemy spawn '${digit}' appears ${n} times`);
    if (n === 0) seenGap = true;
    else if (seenGap) problems.push(`enemy spawn '${digit}' used without the lower-numbered spawns`);
  }
  if (countGlyph(map, SPAWN_GLYPHS[0]) === 0) problems.push(`map needs at least enemy spawn '${SPAWN_GLYPHS[0]}'`);
}

function validateWaves(waves, problems) {
  if (!Array.isArray(waves) || waves.length === 0) {
    problems.push("waves must be a non-empty array");
    return;
  }
  waves.forEach((wave, w) => {
    if (!isPlainObject(wave) || !Array.isArray(wave.enemies) || wave.enemies.length === 0) {
      problems.push(`wave ${w} must have a non-empty enemies array`);
      return;
    }
    wave.enemies.forEach((entry, i) => {
      if (!isPlainObject(entry) || !has(ENEMY_TYPES, entry.type)) {
        problems.push(`wave ${w} entry ${i} has unknown enemy type '${entry && entry.type}'`);
      }
      if (!isPlainObject(entry) || !isPositiveInt(entry.count)) {
        problems.push(`wave ${w} entry ${i} count must be a positive integer`);
      }
    });
  });
}

function validateRules(rules, problems) {
  if (rules === undefined) return;
  if (!isPlainObject(rules)) {
    problems.push("rules must be an object");
    return;
  }
  for (const key of Object.keys(rules)) {
    if (!RULE_KEYS.includes(key)) problems.push(`unknown rule '${key}'`);
  }
  if (has(rules, "sniperRangeTiles") && !isPositiveInt(rules.sniperRangeTiles)) {
    problems.push("rules.sniperRangeTiles must be a positive integer");
  }
  if (has(rules, "hunterPairs") && typeof rules.hunterPairs !== "boolean") {
    problems.push("rules.hunterPairs must be a boolean");
  }
}

/**
 * Every reason `level` is not a valid LevelDef. An empty array means valid.
 * Unknown keys are errors, so a typo like `speedmult` fails loudly instead of
 * silently falling back to a default.
 *
 * @param {unknown} level
 * @returns {string[]}
 */
export function validateLevel(level) {
  const problems = [];
  if (!isPlainObject(level)) return ["level must be an object"];

  for (const key of Object.keys(level)) {
    if (!LEVEL_KEYS.includes(key)) problems.push(`unknown key '${key}'`);
  }
  if (!isPositiveInt(level.id)) problems.push("id must be a positive integer");
  if (typeof level.name !== "string" || level.name.length === 0) problems.push("name must be a non-empty string");
  if (typeof level.speedMult !== "number" || !(level.speedMult > 0)) problems.push("speedMult must be a positive number");

  validateMap(level.map, problems);
  validateWaves(level.waves, problems);
  validateRules(level.rules, problems);

  if (problems.length === 0) {
    const posts = countGlyph(level.map, Glyph.SNIPER_POST);
    // A loop, not flatMap: Qt 6.11's JS engine has no Array.prototype.flatMap
    // (tests/qml/tst_core_import.qml caught it).
    let snipers = 0;
    for (const wave of level.waves) {
      for (const e of wave.enemies) if (e.type === "sniper") snipers += e.count;
    }
    if (posts > snipers) problems.push(`map has ${posts} sniper posts but the waves hold only ${snipers} snipers`);
  }
  return problems;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * Validates the ordered level list and returns it deep-frozen. Throws one
 * Error naming every problem in every level, so a broken level fails when the
 * game opens rather than mid-run.
 *
 * @param {unknown[]} levels
 * @returns {readonly LevelDef[]}
 */
export function loadLevels(levels) {
  if (!Array.isArray(levels) || levels.length === 0) throw new Error("levels: expected a non-empty array");
  const problems = [];
  levels.forEach((level, i) => {
    const label = `level ${i + 1}`;
    for (const problem of validateLevel(level)) problems.push(`${label}: ${problem}`);
    if (isPlainObject(level) && level.id !== i + 1) {
      problems.push(`${label}: id is ${level.id}, expected ${i + 1} (ids follow index.mjs order)`);
    }
  });
  if (problems.length > 0) throw new Error(`invalid levels:\n  ${problems.join("\n  ")}`);
  // Freeze a copy, never the objects the level modules export. A JSON copy is
  // enough because a LevelDef is plain data by definition, and it works the
  // same in Node and in Qt's JS engine.
  return deepFreeze(levels.map((level) => JSON.parse(JSON.stringify(level))));
}
