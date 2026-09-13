// Collision primitives. Terrain comes from a tile-grid lookup; tanks and
// shells use axis-aligned boxes. Four-direction movement with axis snapping
// (game-design §1) keeps every tank TILE-aligned on at least one axis, so a
// tank's box overlaps at most two tiles and a grid lookup is exact.
import { GRID, Glyph, TILE } from "./constants.mjs";

/**
 * The terrain half of the game-design §1 collision matrix, as data. Only these
 * glyphs exist in GameState.tiles.
 *   blocksTank: a tank may not enter the tile.
 *   shell:      what happens to a shell that reaches it.
 */
export const TERRAIN = Object.freeze({
  [Glyph.EMPTY]: Object.freeze({ blocksTank: false, shell: "pass" }),
  [Glyph.BRICK]: Object.freeze({ blocksTank: true, shell: "destroyTile" }),
  [Glyph.STEEL]: Object.freeze({ blocksTank: true, shell: "stop" }),
  [Glyph.WATER]: Object.freeze({ blocksTank: true, shell: "pass" }),
  [Glyph.BASE]: Object.freeze({ blocksTank: true, shell: "destroyBase" }),
});

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect  px, playfield coords, top-left origin */

/**
 * True when two boxes overlap by more than an edge.
 * @param {Rect} a
 * @param {Rect} b
 * @returns {boolean}
 */
export function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Glyph at tile (col, row), or null outside the playfield. Callers treat null
 * as solid: the field edge blocks tanks and removes shells.
 * @param {string[]} tiles  GameState.tiles, row-major, GRID × GRID
 * @param {number} col
 * @param {number} row
 * @returns {string|null}
 */
export function tileAt(tiles, col, row) {
  if (col < 0 || col >= GRID || row < 0 || row >= GRID) return null;
  return tiles[row * GRID + col];
}

/**
 * Every tile (col, row) that `rect` overlaps, in row-major order. That is at
 * most 2 tiles for an aligned tank and at most 4 for a shell. Positions are
 * fractional (enemy speeds are), so the far edge is exclusive: a box ending
 * exactly on a tile line does not touch the next tile, one ending 0.1 px past
 * it does.
 * @param {Rect} rect
 * @returns {{ col: number, row: number }[]}
 */
export function tilesUnder(rect) {
  const colStart = Math.floor(rect.x / TILE);
  const colEnd = Math.ceil((rect.x + rect.w) / TILE) - 1;
  const rowStart = Math.floor(rect.y / TILE);
  const rowEnd = Math.ceil((rect.y + rect.h) / TILE) - 1;
  const out = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) out.push({ col, row });
  }
  return out;
}
