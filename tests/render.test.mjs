// Proves the theme lookup path without a live omarchy-shell: drawFrame must
// paint whatever theme.* values it's given, and fall back to DEFAULT_THEME
// for anything the caller leaves out (Overlay.qml only resolves the
// live-sourced keys; the rest come from the fallback table).
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THEME, drawFrame } from "../src/render/draw.mjs";

const recordingCtx = () => {
  const calls = [];
  return {
    calls,
    set fillStyle(value) {
      calls.push(["fillStyle", value]);
    },
    fillRect(...args) {
      calls.push(["fillRect", ...args]);
    },
  };
};

const paintedWith = (calls, color) => calls.some(([op, value]) => op === "fillStyle" && value === color);

test("drawFrame falls back to DEFAULT_THEME.background when no theme is given", () => {
  const ctx = recordingCtx();
  drawFrame(ctx, {});
  assert.ok(paintedWith(ctx.calls, DEFAULT_THEME.background));
});

test("a partial theme (only the live-sourced keys) still paints — missing keys default", () => {
  const ctx = recordingCtx();
  drawFrame(ctx, {}, { background: "#abcdef" });
  assert.ok(paintedWith(ctx.calls, "#abcdef"));
});

test("switching the theme changes what gets painted, proving the lookup isn't baked in", () => {
  const themeA = recordingCtx();
  const themeB = recordingCtx();
  drawFrame(themeA, {}, { ...DEFAULT_THEME, background: "#111111" });
  drawFrame(themeB, {}, { ...DEFAULT_THEME, background: "#222222" });
  assert.ok(paintedWith(themeA.calls, "#111111"));
  assert.ok(paintedWith(themeB.calls, "#222222"));
  assert.ok(!paintedWith(themeA.calls, "#222222"));
});
