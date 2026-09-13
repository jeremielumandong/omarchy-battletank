import Quickshell
import Quickshell.Wayland
import QtQuick
import QtQuick.Effects
import "audio/cues.mjs" as Cues
import "core/constants.mjs" as Constants
import "core/engine.mjs" as Engine
import "levels/index.mjs" as Levels
import "render/draw.mjs" as Draw

// Plugin entry point (manifest.json entryPoints.overlay).
//
// omarchy-shell owns the lifecycle: `summon` loads this file and calls
// open(), and `hide` calls close() and then unloads it. manifest.json sets no
// `keepLoaded`, so hiding destroys the instance, its loop, and the run in
// progress (see /usr/share/omarchy/shell/shell.qml summon/hide and the
// Loader's `active` binding).
//
// This file owns only window, keys, loop and paint. Game rules live in
// core/engine.mjs, and QML never decides anything about the game.
//
// STUB: wiring is complete, but Engine.createGame and Engine.step still
// throw. Until they are implemented, open() shows the fault panel.
Item {
  id: root

  // Injected by the host (shell.qml panel Loader onLoaded).
  property var shell: null
  property var manifest: null

  property bool opened: false
  property var game: null
  property bool faulted: false
  property string faultText: ""
  property bool soundFailed: false

  // Held input. heldDirs is a stack, so the most recent direction wins.
  property var heldDirs: []
  property bool fireHeld: false
  property bool startHeld: false
  property bool pauseHeld: false

  function open(payloadJson) {
    root.opened = true
    if (!root.game && !root.faulted) {
      try {
        root.game = Engine.createGame(Levels.levels)
      } catch (e) {
        root.fail(e)
      }
    }
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
    root.releaseAll()
  }

  function dismiss() {
    root.close()
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "arkane.battletank")
  }

  // A throw in the core must not escape into the shared shell process. Stop
  // the loop, log once, and show the reason.
  function fail(error) {
    root.faulted = true
    root.faultText = String((error && error.message) || error)
    console.warn("arkane.battletank:", root.faultText)
  }

  function releaseAll() {
    root.heldDirs = []
    root.fireHeld = false
    root.startHeld = false
    root.pauseHeld = false
  }

  function currentInput() {
    return {
      dir: root.heldDirs.length > 0 ? root.heldDirs[root.heldDirs.length - 1] : null,
      fire: root.fireHeld,
      start: root.startHeld,
      pause: root.pauseHeld
    }
  }

  // Esc closes the game from screens where nothing is at stake. In a level it
  // pauses instead, so a stray Esc cannot throw away a run.
  function escapeCloses() {
    if (root.faulted || !root.game) return true
    var phase = root.game.phase
    return phase === "title" || phase === "gameOver" || phase === "complete"
  }

  function directionFor(key) {
    switch (key) {
    case Qt.Key_Up: case Qt.Key_W: return "up"
    case Qt.Key_Down: case Qt.Key_S: return "down"
    case Qt.Key_Left: case Qt.Key_A: return "left"
    case Qt.Key_Right: case Qt.Key_D: return "right"
    }
    return null
  }

  function setKey(key, down) {
    var dir = root.directionFor(key)
    if (dir) {
      var rest = root.heldDirs.filter(function(d) { return d !== dir })
      root.heldDirs = down ? rest.concat([dir]) : rest
      return true
    }
    switch (key) {
    case Qt.Key_Space: case Qt.Key_J: root.fireHeld = down; return true
    case Qt.Key_Return: case Qt.Key_Enter: root.startHeld = down; return true
    case Qt.Key_P: root.pauseHeld = down; return true
    case Qt.Key_Escape:
      if (down && root.escapeCloses()) root.dismiss()
      else root.pauseHeld = down
      return true
    }
    return false
  }

  // Sound is optional. Every voice is a pw-play child process owned by
  // Audio.qml, and where voices cannot play the game runs silent. Closing or
  // faulting destroys every voice and kills its process
  // (docs/audio-architecture.md).
  Loader {
    id: audio
    active: root.opened && !root.faulted
    source: "Audio.qml"
  }

  // Runs after every step, not once per frame: step() clears events, and a
  // catch-up frame runs several steps. A sound error warns once and never
  // reaches fail(): the game plays on without it.
  function sound(game) {
    if (!audio.item) return
    try {
      audio.item.playCues(Cues.cuesFor(game.events))
      audio.item.setMusic(Cues.musicFor(game.phase))
    } catch (e) {
      if (!root.soundFailed) console.warn("arkane.battletank: sound:", String((e && e.message) || e))
      root.soundFailed = true
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: Draw.PALETTE.background

    WlrLayershell.namespace: "arkane-battletank"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true

      Keys.onPressed: function(event) {
        if (event.isAutoRepeat) { event.accepted = true; return }
        event.accepted = root.setKey(event.key, true)
      }
      Keys.onReleased: function(event) {
        if (event.isAutoRepeat) { event.accepted = true; return }
        event.accepted = root.setKey(event.key, false)
      }

      // The game is drawn at NES-like logical resolution and scaled by a
      // whole number with no smoothing, so pixels stay square and crisp.
      Item {
        id: stage
        width: Constants.SCREEN_W
        height: Constants.SCREEN_H
        anchors.centerIn: parent
        scale: Math.max(1, Math.floor(Math.min(parent.width / width, parent.height / height)))

        // Glow: a blurred copy under the crisp frame, so every colour glows
        // in its own hue. The graphics item tunes blur and brightness.
        MultiEffect {
          anchors.fill: screen
          source: screen
          blurEnabled: true
          blurMax: 16
          blur: 0.6
          brightness: 0.1
        }

        Canvas {
          id: screen
          anchors.fill: parent
          smooth: false
          onPaint: {
            if (root.game) Draw.drawFrame(getContext("2d"), root.game)
          }
        }
      }

      Text {
        visible: root.faulted
        anchors.centerIn: parent
        width: Math.min(parent.width - 64, 900)
        wrapMode: Text.Wrap
        color: Draw.PALETTE.hudDanger
        font.family: "monospace"
        text: "Battletank stopped: " + root.faultText + "\n\nEsc to close."
      }
    }

    GameLoop {
      id: loop
      running: root.opened && !root.faulted && root.game !== null
      onTick: {
        try {
          Engine.step(root.game, root.currentInput())
        } catch (e) {
          root.fail(e)
          return
        }
        root.sound(root.game)
      }
      onTicked: screen.requestPaint()
    }
  }
}
