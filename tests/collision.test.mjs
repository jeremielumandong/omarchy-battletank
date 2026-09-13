import test from "node:test";
import assert from "node:assert/strict";
import { tilesUnder } from "../src/core/collision.mjs";
import { TILE } from "../src/core/constants.mjs";

const box = (x, y, w = TILE, h = TILE) => ({ x, y, w, h });

test("tilesUnder: a tile-aligned tank covers exactly its own tile", () => {
  assert.deepEqual(tilesUnder(box(16, 32)), [{ col: 1, row: 2 }]);
});

test("tilesUnder: an integer offset tank covers the two tiles it straddles", () => {
  assert.deepEqual(tilesUnder(box(20, 32)), [{ col: 1, row: 2 }, { col: 2, row: 2 }]);
});

// Regression: enemy speeds are fractional (speedMult 1.04 × type factor), so a
// grunt stepping right from x=0 reaches x=16.64. Its box then spans
// 16.64..32.64 and is 0.64 px into column 2, but `floor((x + w - 1) / TILE)`
// assumed integer coordinates and reported only column 1, so the brick at
// column 2 did not block it.
test("tilesUnder: a box with a fractional edge includes the tile it just entered", () => {
  assert.deepEqual(tilesUnder(box(16.64, 0)), [{ col: 1, row: 0 }, { col: 2, row: 0 }]);
  assert.deepEqual(tilesUnder(box(0, 16.5)), [{ col: 0, row: 1 }, { col: 0, row: 2 }]);
});

test("tilesUnder: a shell grazing a tile edge by a fraction of a pixel is on that tile", () => {
  assert.deepEqual(tilesUnder(box(28.4, 6, 4, 4)), [{ col: 1, row: 0 }, { col: 2, row: 0 }]);
});
