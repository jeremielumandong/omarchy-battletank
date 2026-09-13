import QtQuick
import QtTest
import "../../src/core/constants.mjs" as Constants
import "../../src/core/engine.mjs" as Engine
import "../../src/levels/index.mjs" as Levels
import "../../src/render/draw.mjs" as Draw

// drawFrame on the surface the overlay actually uses: Qt's Canvas 2D, in Qt's
// JS engine. tests/render.test.mjs proves which calls happen; this proves they
// run here and land as the expected pixels. Pixels are read with getImageData
// inside onPaint, because offscreen grabImage() of a Canvas comes back blank.
TestCase {
  name: "Render"
  when: windowShown
  width: Constants.SCREEN_W
  height: Constants.SCREEN_H

  Canvas {
    id: screen
    width: Constants.SCREEN_W
    height: Constants.SCREEN_H
    renderTarget: Canvas.Image
    renderStrategy: Canvas.Immediate

    property var game: null
    property var theme: Draw.DEFAULT_THEME
    property var probes: []
    property var samples: []
    property string error: ""
    property int paints: 0

    onPaint: {
      if (!game) return
      var ctx = getContext("2d")
      var out = []
      // getImageData addresses the backing image in device pixels: on a
      // scale-2 display (check.sh keeps the session's QT_QPA_PLATFORM) that is
      // twice the logical coordinates drawFrame paints in.
      var dpr = Screen.devicePixelRatio
      try {
        Draw.drawFrame(ctx, game, theme)
        for (var i = 0; i < probes.length; i++)
          out.push(hex(ctx.getImageData(probes[i][0] * dpr, probes[i][1] * dpr, 1, 1).data))
        error = ""
      } catch (e) {
        error = String(e)
      }
      samples = out
      paints++
    }
  }

  function hex(data) {
    var s = "#"
    for (var i = 0; i < 3; i++) {
      var h = data[i].toString(16)
      s += h.length < 2 ? "0" + h : h
    }
    return s.toUpperCase()
  }

  // Paints `game` and returns the "#RRGGBB" at each [x, y] in `probes`.
  function paint(game, theme, probes) {
    screen.game = game
    screen.theme = theme
    screen.probes = probes
    var before = screen.paints
    screen.requestPaint()
    tryVerify(function() { return screen.paints > before }, 3000, "canvas painted")
    compare(screen.error, "")
    return screen.samples
  }

  function titleState() {
    return Engine.createGame(Levels.levels, { seed: 1 })
  }

  function playingState() {
    var state = Engine.createGame(Levels.levels, { seed: 1 })
    var input = Engine.emptyInput()
    input.start = true
    Engine.step(state, input)
    for (var t = 0; t < Constants.PHASE_TICKS.levelStart; t++) Engine.step(state, Engine.emptyInput())
    compare(state.phase, "playing")
    return state
  }

  // The title tank sits centered on the field; its left track is at x + 1..3.
  function titleTrack() {
    return [Constants.SCREEN_W / 2 - Constants.TILE / 2 + 2, Constants.HUD_HEIGHT + Constants.FIELD / 2]
  }

  function test_title_backdrop_and_tank() {
    var px = paint(titleState(), Draw.DEFAULT_THEME, [[1, 1], titleTrack()])
    compare(px[0], Draw.DEFAULT_THEME.background)
    compare(px[1], Draw.DEFAULT_THEME.player)
  }

  function test_live_theme_reaches_the_pixels() {
    var px = paint(titleState(), { background: "#123456", player: "#ABCDEF" }, [[1, 1], titleTrack()])
    compare(px[0], "#123456")
    compare(px[1], "#ABCDEF")
  }

  function test_level_terrain_base_tank_and_hud() {
    var state = playingState()
    var T = Constants.TILE
    var top = Constants.HUD_HEIGHT
    var brick = state.tiles.indexOf("B")
    var bx = (brick % Constants.GRID) * T
    var by = top + Math.floor(brick / Constants.GRID) * T
    var px = paint(state, Draw.DEFAULT_THEME, [
      [bx, by],
      [bx + 2, by + 2],
      [state.basePos.x + 8, top + state.basePos.y + 8],
      [state.player.x + 2, top + state.player.y + 8],
      [Constants.SCREEN_W - 6, Constants.HUD_HEIGHT / 2],
    ])
    compare(px[0], Draw.DEFAULT_THEME.brickEdge)
    compare(px[1], Draw.DEFAULT_THEME.brickFill)
    compare(px[2], Draw.DEFAULT_THEME.base)
    compare(px[3], Draw.DEFAULT_THEME.player)
    compare(px[4], Draw.DEFAULT_THEME.base)
  }

  // Qt's engine only fails on code it runs, so every phase's screen runs here.
  function test_every_phase_paints_inside_qt() {
    var phases = ["title", "levelStart", "playing", "paused", "confirmAbandon", "levelClear", "baseDestroyed", "gameOver", "complete"]
    for (var i = 0; i < phases.length; i++) {
      var state = playingState()
      state.phase = phases[i]
      state.enemies = [{ id: 900, kind: "eliteHunter", x: 0, y: 0, dir: "left", moving: false, cooldown: 60, hitsLeft: 2, invulnerable: 0, burstLeft: 0, aimTicks: 0 }]
      state.shells = [{ id: 950, ownerId: 900, x: 40, y: 40, dir: "down", speed: 2 }]
      paint(state, Draw.DEFAULT_THEME, [])
    }
    var lost = playingState()
    lost.player = null
    lost.respawnTicks = 30
    paint(lost, Draw.DEFAULT_THEME, [])
  }
}
