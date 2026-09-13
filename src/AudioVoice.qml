import QtQuick
import Quickshell.Io

// One voice: a pw-play child process playing one file. Audio.qml owns every
// voice, so unloading the overlay destroys them, and a destroyed Process
// kills its child: no sound outlives the game. Sound plays out of process on
// purpose. Qt Multimedia inside the shared shell process wedged it
// (docs/audio-architecture.md "Decision").
//
// A voice that cannot play, because pw-play is missing or its file will not
// open, reports failed() once and stays silent after that.
Process {
  id: voice

  property string file: ""
  property real volume: 1
  property bool muted: false
  // Music: start again from the top whenever the file ends.
  property bool loops: false

  // Held with SIGSTOP by pause(), so resume() continues where it stopped.
  property bool held: false
  property bool wanted: false
  property bool everStarted: false
  property bool broken: false

  signal failed(string text)

  command: ["pw-play", "--volume", String(voice.volume), "--media-role", "Game", voice.file]

  // From the top. A voice still sounding gets SIGTERM, then starts again.
  function play() {
    voice.wanted = true
    voice.release()
    if (voice.muted || voice.broken || voice.file === "") return
    voice.running = false
    voice.running = true
  }

  function pause() {
    if (voice.running && !voice.held) {
      voice.signal(19)  // SIGSTOP
      voice.held = true
    }
  }

  // Continues a held voice, or starts one that is not sounding.
  function resume() {
    if (voice.held) voice.release()
    else if (!voice.running) voice.play()
  }

  function stop() {
    voice.wanted = false
    voice.release()
    voice.running = false
  }

  // A stopped process ignores SIGTERM until it continues.
  function release() {
    if (!voice.held) return
    voice.held = false
    if (voice.running) voice.signal(18)  // SIGCONT
  }

  function fail(text) {
    voice.broken = true
    voice.wanted = false
    voice.failed(text)
  }

  onStarted: voice.everStarted = true
  // A missing binary never starts and never exits: running just drops.
  onRunningChanged: {
    if (!voice.running && !voice.everStarted && !voice.broken) voice.fail("cannot run pw-play")
  }
  onExited: function(exitCode, exitStatus) {
    voice.held = false
    if (exitStatus !== 0) return  // killed by stop(), play() or teardown
    if (exitCode !== 0) voice.fail("cannot play " + voice.file)
    else if (voice.loops && voice.wanted && !voice.muted) Qt.callLater(voice.play)
  }
  onMutedChanged: {
    if (voice.muted) {
      voice.release()
      voice.running = false
    } else if (voice.loops && voice.wanted) {
      voice.play()
    }
  }
}
