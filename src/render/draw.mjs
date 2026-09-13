// Paints one frame of a GameState onto a Canvas 2D context at logical
// resolution (SCREEN_W × SCREEN_H). Overlay.qml scales that up by a whole
// number. Rendering only reads state, so it can never change the game, and
// Node tests can check it with a recording fake context.
//
// Palette and HUD layout: docs/game-design.md §5.
//
// STUB: the graphics engineer implements the tiles, tanks, shells, HUD and
// phase banners. Until then it paints only the backdrop, so a summoned overlay
// is visibly alive.
import { SCREEN_H, SCREEN_W } from "../core/constants.mjs";

export const BACKGROUND = "#0A0A12";

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../core/engine.mjs").GameState} state
 */
export function drawFrame(ctx, state) {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
}
