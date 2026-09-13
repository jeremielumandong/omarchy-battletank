import Quickshell
import Quickshell.Io
import QtQuick

// The real Audio.qml and AudioVoice.qml in the real quickshell binary, the
// one surface where Quickshell.Io loads. scripts/check.sh runs it with
// tests/quickshell/bin first on PATH, so every voice is the silent pw-play
// stub, and it prints "RESULT PASS" or "RESULT FAIL: <why>".
//
// Five times, as Overlay.qml does: open the Loader, start the title music and
// three cues, then close. Every voice must be a live child while open, and
// none may be left after the close. One cycle closes with the music held by
// pause, since a stopped process ignores SIGTERM. A missing file must stay
// silent after its first try.
ShellRoot {
  id: root

  // quickshell blackholes relative URLs outside this file's directory, so
  // check.sh passes the repo root.
  readonly property string audioQml: "file://" + Quickshell.env("BT_ROOT") + "/src/Audio.qml"
  property bool opened: false
  property int cycle: 0
  property int stage: 0
  property var steps: []

  function finish(verdict) {
    console.log("RESULT", verdict)
    Qt.exit(verdict === "PASS" ? 0 : 1)
  }

  // Counts this process's pw-play children: the stub execs sleep.
  function countChildren(then) {
    counter.then = then
    counter.running = true
  }

  Process {
    id: counter
    property var then: null
    command: ["sh", "-c", "ps --ppid $PPID -o comm= | grep -c '^sleep$' || true"]
    stdout: StdioCollector {
      onStreamFinished: counter.then(parseInt(text.trim(), 10))
    }
  }

  Loader {
    id: audio
    active: root.opened
    source: root.audioQml
  }

  Loader {
    id: broken
  }

  Timer {
    id: clock
    interval: 250
    repeat: true
    running: true
    onTriggered: root.tick()
  }

  function expect(what, want, then) {
    root.countChildren(function(got) {
      if (got !== want) root.finish("FAIL: cycle " + root.cycle + " " + what + ": " + got + " live voices, want " + want)
      else then()
    })
  }

  function tick() {
    if (counter.running) return
    switch (root.stage) {
    case 0:
      root.opened = true
      root.stage = 1
      break
    case 1:
      if (!audio.item) return root.finish("FAIL: Audio.qml did not load: " + Qt.createComponent(audio.source).errorString())
      if (!audio.item.player) return root.finish("FAIL: no voices: AudioVoice.qml did not load")
      audio.item.setMusic({ track: "title", playing: true })
      audio.item.playCues(["shot", "hit", "brick"])
      root.stage = 2
      break
    case 2:
      root.stage = -1
      root.expect("while open", 4, function() {
        if (root.cycle === 2) audio.item.setMusic({ track: "title", playing: false })
        root.stage = 3
      })
      break
    case 3:
      root.opened = false
      root.stage = 4
      break
    case 4:
      root.stage = -1
      root.expect("after close", 0, function() {
        root.cycle++
        root.stage = root.cycle < 5 ? 0 : 5
      })
      break
    case 5:
      broken.setSource(root.audioQml, { sfxDir: "file:///nonexistent/battletank/" })
      root.stage = 6
      break
    case 6:
      broken.item.playCues(["shot"])
      root.stage = 7
      break
    case 7:
      if (broken.item.pools["shot"].voices[0].broken !== true)
        return root.finish("FAIL: a missing file did not mark its voice broken")
      broken.item.playCues(["shot", "shot", "shot", "shot"])
      root.stage = -1
      root.expect("missing file", 0, function() {
        broken.source = ""
        root.finish("PASS")
      })
      break
    }
  }

  Timer {
    interval: 30000
    running: true
    onTriggered: root.finish("FAIL: timed out at cycle " + root.cycle + " stage " + root.stage)
  }
}
