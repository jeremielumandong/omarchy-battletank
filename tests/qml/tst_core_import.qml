import QtQuick
import QtTest
import "../../src/core/engine.mjs" as Engine
import "../../src/core/levels.mjs" as LevelFormat
import "../../src/levels/index.mjs" as Levels
import "../../src/render/draw.mjs" as Draw

// The seam the whole design stands on: the plain ES modules Node tests are
// the same files QML loads, with nested relative imports, in Qt's JS engine.
// Qt's engine lags Node (it has no Array.prototype.flatMap, for one), and it
// only fails on code it actually runs, so these tests call every export
// rather than just importing it.
TestCase {
  name: "CoreImport"

  function test_levels_validate_inside_qml() {
    var loaded = LevelFormat.loadLevels(Levels.levels)
    verify(loaded.length >= 1)
    compare(loaded[0].id, 1)
    verify(Object.isFrozen(loaded[0].map))
    for (var i = 0; i < loaded.length; i++) {
      verify(LevelFormat.enemyTotal(loaded[i]) > 0)
      verify(LevelFormat.obstacleDensity(loaded[i]) >= 0)
    }
  }

  function test_validator_reports_problems_inside_qml() {
    var problems = LevelFormat.validateLevel({ id: 1, name: "x", map: [], speedMult: 1, waves: [], bogus: true })
    verify(problems.length >= 3, JSON.stringify(problems))
  }

  // Skips while engine.mjs is a stub. It switches on by itself once
  // createGame stops throwing, and runs the real engine inside Qt's JS engine.
  function test_engine_runs_inside_qml() {
    var state
    try {
      state = Engine.createGame(Levels.levels, { seed: 1 })
    } catch (e) {
      if (String(e.message).indexOf("STUB:") === 0) skip("engine not implemented yet")
      throw e
    }
    var input = Engine.emptyInput()
    input.start = true
    Engine.step(state, input)
    input.start = false
    input.fire = true
    for (var t = 0; t < 600; t++) Engine.step(state, input)
    compare(state.tick, 601)
  }

  function test_engine_and_renderer_export_the_interface() {
    compare(typeof Engine.createGame, "function")
    compare(typeof Engine.step, "function")
    compare(Engine.emptyInput().dir, null)
    compare(typeof Draw.drawFrame, "function")
  }
}
