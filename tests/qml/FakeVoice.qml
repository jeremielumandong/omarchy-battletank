import QtQuick
import "voices.mjs" as Voices

// AudioVoice.qml's interface without a pw-play child: Quickshell.Io does not
// load under qmltestrunner. It records what Audio.qml asks for, and counts
// itself in Voices.live so a test can see every voice die with the Loader.
QtObject {
  id: voice

  property string file: ""
  property real volume: 1
  property bool muted: false
  property bool loops: false

  // What AudioVoice.qml's child process would be doing.
  property bool running: false
  property bool held: false
  property int plays: 0

  signal failed(string text)

  function play() {
    if (voice.muted || voice.file === "") return
    voice.plays++
    voice.running = true
    voice.held = false
  }
  function pause() {
    if (voice.running) voice.held = true
  }
  function resume() {
    if (voice.held) voice.held = false
    else if (!voice.running) voice.play()
  }
  function stop() {
    voice.running = false
    voice.held = false
  }

  Component.onCompleted: Voices.live.count++
  Component.onDestruction: Voices.live.count--
}
