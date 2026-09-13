// Paints one frame of a GameState onto a Canvas 2D context at logical
// resolution (SCREEN_W × SCREEN_H). Overlay.qml scales that up by a whole
// number. Rendering only reads state, so it can never change the game, and
// Node tests can check it with a recording fake context.
//
// Colors are a parameter, not a constant: Overlay.qml resolves omarchy's
// live active theme (the Quickshell `Color` singleton, `qs.Commons`) and
// passes the result in as `theme`. This file stays a plain, deterministic ES
// module with no Quickshell/QtQuick knowledge — scripts/check.sh enforces
// that for everything under src/render. See docs/game-design.md §5 and
// docs/architecture.md "Rendering" for which colors are theme-sourced and
// why the rest are fixed fallbacks.
//
// STUB: the graphics engineer implements the tiles, tanks, shells, HUD and
// phase banners. Until then it paints only the backdrop, so a summoned overlay
// is visibly alive.
import { SCREEN_H, SCREEN_W } from "../core/constants.mjs";

// Fallback palette: used for any theme key the caller doesn't supply, and
// for the game-specific colors omarchy's theme has no equivalent for
// (enemy types, terrain, base, shell — docs/game-design.md §5 explains why
// those stay fixed instead of being derived from the theme).
export const DEFAULT_THEME = Object.freeze({
  background: "#0A0A12",
  hudText: "#FFFFFF",
  hudAccent: "#00F0FF",
  hudDanger: "#FF2E4D",
  player: "#00F0FF",
  grunt: "#FF6A00",
  sniper: "#FFE600",
  hunter: "#B026FF",
  eliteRim: "#FFFFFF",
  brickFill: "#3A1220",
  brickEdge: "#FF3864",
  steelFill: "#1A2233",
  steelEdge: "#4DA6FF",
  waterFill: "#0F3057",
  waterEdge: "#00C2FF",
  base: "#39FF14",
  shellCore: "#FFFFFF",
});

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../core/engine.mjs").GameState} state
 * @param {Partial<typeof DEFAULT_THEME>} [theme] Live-resolved colors; any
 *   key left out falls back to DEFAULT_THEME.
 */
export function drawFrame(ctx, state, theme = DEFAULT_THEME) {
  // Qt's JS engine doesn't parse object-spread (docs/architecture.md
  // "Second risk"), so this merges with Object.assign instead of `{...}`.
  const palette = Object.assign({}, DEFAULT_THEME, theme);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
}
