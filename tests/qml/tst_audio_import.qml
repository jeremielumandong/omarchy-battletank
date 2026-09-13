import QtQuick
import QtTest
import "../../src/audio/cues.mjs" as Cues

// The audio policy runs in Qt's JS engine, which lags Node, so call it here
// as well as in tests/audio.test.mjs (same reason as tst_core_import.qml).
TestCase {
  name: "AudioCuesImport"

  function test_cues_run_inside_qml() {
    var cues = Cues.cuesFor([
      { kind: "shot", x: 0, y: 0 },
      { kind: "shot", x: 1, y: 1 },
      { kind: "explosion", x: 0, y: 0 },
      { kind: "enemyDestroyed", x: 0, y: 0 },
      { kind: "bogus", x: 0, y: 0 }
    ])
    compare(JSON.stringify(cues), JSON.stringify(["shot", "enemy-destroyed"]))
  }

  function test_music_runs_inside_qml() {
    compare(Cues.musicFor("playing").track, "battle")
    compare(Cues.musicFor("paused").playing, false)
    compare(Cues.musicFor("bogus").track, null)
    compare(Cues.TRACK_IDS.length, 2)
  }
}
