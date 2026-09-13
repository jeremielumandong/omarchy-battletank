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
// A frame is painted back to front: backdrop, HUD strip, playfield (terrain
// and base, shells, tanks), then the current phase's screen from
// PHASE_OVERLAY, which has one entry per Phase in engine.mjs so no screen gets
// improvised. Everything is filled rectangles and text, crisp at whole-number
// scale; the glow comes from Overlay.qml's MultiEffect, not from here. Blinks
// and pulses count state.tick, never the clock, so a frame is a pure function
// of (state, theme).
import { FIELD, GRID, Glyph, HUD_HEIGHT, SCREEN_H, SCREEN_W, TILE } from "../core/constants.mjs";

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

const FIELD_Y = HUD_HEIGHT; // the playfield sits under the HUD strip
const CENTER_X = SCREEN_W / 2;
const CENTER_Y = FIELD_Y + FIELD / 2;
// Mirrors engine.mjs SHELL_SIZE, which it doesn't export: a shell's hitbox.
const SHELL_SIZE = 4;

const TITLE_FONT = "bold 24px monospace";
const BIG_FONT = "bold 16px monospace";
const SMALL_FONT = "7px monospace";

// On-then-off half periods, in ticks. The Elite Hunter rim pulses at ~1 Hz
// (game-design §5); the respawn flicker is fast enough to read as "not solid".
const PULSE_TICKS = 30;
const FLICKER_TICKS = 4;
const blinkOn = (tick, halfPeriod) => Math.floor(tick / halfPeriod) % 2 === 0;

// Terrain glyph → palette keys plus the detail that tells the three apart
// even in a theme-less screenshot. EMPTY has no entry and paints nothing.
const TILE_STYLE = Object.freeze({
  [Glyph.BRICK]: { fill: "brickFill", edge: "brickEdge", detail: brickMortar },
  [Glyph.STEEL]: { fill: "steelFill", edge: "steelEdge", detail: steelPlate },
  [Glyph.WATER]: { fill: "waterFill", edge: "waterEdge", detail: waterShimmer },
});

// Tank kind → palette key. The Elite Hunter is a Hunter plus a rim.
const TANK_COLOR = Object.freeze({
  player: "player",
  grunt: "grunt",
  sniper: "sniper",
  hunter: "hunter",
  eliteHunter: "hunter",
});

// Tank sprite in 16 × 16 local px: two tracks and a hull along the axis of
// travel, a dark hatch, and a barrel toward `dir`.
const TANK_BODY = Object.freeze({
  vertical: [
    [1, 1, 3, 14],
    [12, 1, 3, 14],
    [4, 3, 8, 10],
  ],
  horizontal: [
    [1, 1, 14, 3],
    [1, 12, 14, 3],
    [3, 4, 10, 8],
  ],
});
const BARREL = Object.freeze({
  up: [7, 0, 2, 8],
  down: [7, 8, 2, 8],
  left: [0, 7, 8, 2],
  right: [8, 7, 8, 2],
});

const PAUSE_OPTIONS = ["RESUME", "RESTART LEVEL", "ABANDON RUN"];

// Every Phase (engine.mjs) → what is painted on top of the field. Copy is
// game-design §7 verbatim.
const PHASE_OVERLAY = Object.freeze({
  title: drawTitle,
  levelStart: (ctx, state, palette) => banner(ctx, palette, `LEVEL ${state.levelIndex + 1}`, palette.hudAccent, []),
  playing: drawTankLost,
  paused: drawPaused,
  confirmAbandon: drawConfirmAbandon,
  levelClear: (ctx, state, palette) =>
    banner(ctx, palette, "LEVEL CLEAR", palette.hudAccent, [
      [`${state.destroyed} destroyed · ${state.lives} lives left`, palette.hudText],
    ]),
  baseDestroyed: (ctx, state, palette) => banner(ctx, palette, "BASE DESTROYED", palette.hudDanger, []),
  gameOver: (ctx, state, palette) =>
    banner(ctx, palette, "GAME OVER", palette.hudDanger, [
      [`Reached Level ${state.levelIndex + 1}. Press Start to try again.`, palette.hudText],
    ]),
  complete: (ctx, state, palette) =>
    banner(ctx, palette, "MISSION COMPLETE", palette.hudAccent, [
      [`All ${state.levels.length} levels cleared.`, palette.hudText],
    ]),
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
  ctx.textBaseline = "middle";
  // The title has no level loaded yet: nothing to show but the title itself.
  if (state.phase !== "title") {
    drawHud(ctx, state, palette);
    drawTerrain(ctx, state, palette);
    drawShells(ctx, state, palette);
    drawTanks(ctx, state, palette);
  }
  PHASE_OVERLAY[state.phase](ctx, state, palette);
}

// ---- HUD (game-design §5 "HUD layout") ----

function drawHud(ctx, state, palette) {
  const mid = HUD_HEIGHT / 2;
  label(ctx, `LIVES ×${state.lives}`, 3, mid, "left", state.lives <= 1 ? palette.hudDanger : palette.hudText);
  label(ctx, `LEVEL ${state.levelIndex + 1}/${state.levels.length}`, CENTER_X, mid, "center", palette.hudAccent);
  label(ctx, `ENEMIES ${enemiesRemaining(state)}`, SCREEN_W - 14, mid, "right", palette.hudText);
  ctx.fillStyle = baseLost(state) ? palette.hudDanger : palette.base;
  ctx.beginPath();
  ctx.arc(SCREEN_W - 6, mid, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.hudAccent;
  ctx.fillRect(0, HUD_HEIGHT - 1, SCREEN_W, 1);
}

/** On the field, queued in this wave, and every enemy of the waves still to come (game-design §5). */
function enemiesRemaining(state) {
  const waves = state.levels[state.levelIndex].waves;
  let remaining = state.enemies.length + state.spawnQueue.length;
  for (let w = state.waveIndex + 1; w < waves.length; w++) {
    for (const entry of waves[w].enemies) remaining += entry.count;
  }
  return remaining;
}

// The engine leaves the base tile in place when it's shot, so "destroyed" is
// read from the phase. A gameOver with lives left can only have come from
// baseDestroyed: running out of lives ends the run at 0.
function baseLost(state) {
  return state.phase === "baseDestroyed" || (state.phase === "gameOver" && state.lives > 0);
}

// ---- playfield ----

function drawTerrain(ctx, state, palette) {
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const glyph = state.tiles[row * GRID + col];
      const x = col * TILE;
      const y = FIELD_Y + row * TILE;
      if (glyph === Glyph.BASE) drawBase(ctx, x, y, baseLost(state) ? palette.hudDanger : palette.base);
      else if (TILE_STYLE[glyph]) drawTile(ctx, x, y, TILE_STYLE[glyph], palette, state.tick + col * 3);
    }
  }
}

function drawTile(ctx, x, y, style, palette, tick) {
  ctx.fillStyle = palette[style.fill];
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = palette[style.edge];
  box(ctx, x, y, TILE, TILE);
  style.detail(ctx, x, y, tick);
}

function brickMortar(ctx, x, y) {
  ctx.fillRect(x, y + 7, TILE, 1);
  ctx.fillRect(x + 8, y + 1, 1, 6);
  ctx.fillRect(x + 4, y + 8, 1, 7);
  ctx.fillRect(x + 12, y + 8, 1, 7);
}

function steelPlate(ctx, x, y) {
  box(ctx, x + 4, y + 4, 8, 8);
}

// A scanline drifting down the tile: water's "different rule" tell (§5).
function waterShimmer(ctx, x, y, tick) {
  ctx.fillRect(x + 3, y + 3 + (Math.floor(tick / 10) % 10), 10, 1);
}

function drawBase(ctx, x, y, color) {
  ctx.fillStyle = color;
  box(ctx, x + 1, y + 1, TILE - 2, TILE - 2);
  ctx.fillRect(x + 4, y + 4, 8, 8);
}

function drawShells(ctx, state, palette) {
  for (const shell of state.shells) {
    const owner = findTank(state, shell.ownerId);
    const y = FIELD_Y + shell.y;
    // A shell can outlive its firer; with no one to take a color from, it glows plain white.
    ctx.fillStyle = owner ? palette[TANK_COLOR[owner.kind]] : palette.shellCore;
    ctx.fillRect(shell.x, y, SHELL_SIZE, SHELL_SIZE);
    ctx.fillStyle = palette.shellCore;
    ctx.fillRect(shell.x + 1, y + 1, SHELL_SIZE - 2, SHELL_SIZE - 2);
  }
}

function findTank(state, id) {
  if (state.player && state.player.id === id) return state.player;
  for (const enemy of state.enemies) if (enemy.id === id) return enemy;
  return null;
}

function drawTanks(ctx, state, palette) {
  for (const enemy of state.enemies) {
    const color = palette[TANK_COLOR[enemy.kind]];
    // A sniper's white barrel is its 0.3 s aim-flash telegraph (game-design §3).
    const barrel = enemy.aimTicks > 0 ? palette.shellCore : color;
    drawTank(ctx, enemy.x, FIELD_Y + enemy.y, enemy.dir, color, barrel, palette);
    if (enemy.kind === "eliteHunter" && blinkOn(state.tick, PULSE_TICKS)) {
      ctx.fillStyle = palette.eliteRim;
      box(ctx, enemy.x, FIELD_Y + enemy.y, TILE, TILE);
    }
  }
  const player = state.player;
  if (player && (player.invulnerable === 0 || blinkOn(state.tick, FLICKER_TICKS))) {
    drawTank(ctx, player.x, FIELD_Y + player.y, player.dir, palette.player, palette.player, palette);
  }
}

function drawTank(ctx, x, y, dir, color, barrelColor, palette) {
  const body = dir === "left" || dir === "right" ? TANK_BODY.horizontal : TANK_BODY.vertical;
  ctx.fillStyle = color;
  for (const [dx, dy, w, h] of body) ctx.fillRect(x + dx, y + dy, w, h);
  ctx.fillStyle = palette.background;
  ctx.fillRect(x + 6, y + 6, 4, 4);
  const [bx, by, bw, bh] = BARREL[dir];
  ctx.fillStyle = barrelColor;
  ctx.fillRect(x + bx, y + by, bw, bh);
}

// ---- phase screens (game-design §6 "States") ----

function drawTitle(ctx, state, palette) {
  label(ctx, "BATTLETANK", CENTER_X, CENTER_Y - 36, "center", palette.hudAccent, TITLE_FONT);
  drawTank(ctx, CENTER_X - TILE / 2, CENTER_Y - TILE / 2, "up", palette.player, palette.player, palette);
  label(ctx, "PRESS START", CENTER_X, CENTER_Y + 28, "center", palette.hudText);
}

// "Tank Lost" is not a phase: the level runs on while the player waits to respawn.
function drawTankLost(ctx, state, palette) {
  if (!state.player && state.respawnTicks > 0) banner(ctx, palette, "TANK LOST", palette.hudDanger, []);
}

function drawPaused(ctx, state, palette) {
  const rows = PAUSE_OPTIONS.map((option, i) => [option, i === state.menuIndex ? palette.hudAccent : palette.hudText]);
  banner(ctx, palette, "PAUSED", palette.hudAccent, rows);
}

// The prompt is one sentence pair in §7; it is split at the sentence break
// because it is wider than the 208 px screen on one line.
function drawConfirmAbandon(ctx, state, palette) {
  banner(ctx, palette, null, palette.hudDanger, [
    ["Abandon this run?", palette.hudText],
    ["Your progress since Level 1 will be lost.", palette.hudText],
    ["ABANDON RUN", state.menuIndex === 0 ? palette.hudDanger : palette.hudText],
    ["KEEP PLAYING", state.menuIndex === 1 ? palette.hudAccent : palette.hudText],
  ]);
}

/**
 * A panel across the middle of the field: an optional big headline, then one
 * small centered line per [text, color] row.
 */
function banner(ctx, palette, headline, color, rows) {
  const head = headline ? 28 : 8;
  const height = head + 12 * rows.length + (rows.length > 0 ? 4 : 0);
  const top = Math.round(CENTER_Y - height / 2);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, top, SCREEN_W, height);
  ctx.restore();
  ctx.fillStyle = color;
  ctx.fillRect(0, top, SCREEN_W, 1);
  ctx.fillRect(0, top + height - 1, SCREEN_W, 1);
  if (headline) label(ctx, headline, CENTER_X, top + 14, "center", color, BIG_FONT);
  rows.forEach(([text, rowColor], i) => label(ctx, text, CENTER_X, top + head + 6 + 12 * i, "center", rowColor));
}

// ---- primitives ----

function label(ctx, text, x, y, align, color, font = SMALL_FONT) {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** A 1 px outline in the current fillStyle, as four rects so it stays pixel-exact at any scale. */
function box(ctx, x, y, w, h) {
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}
