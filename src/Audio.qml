import QtQuick

// Plays the sounds src/audio/cues.mjs names, and decides nothing. Overlay.qml
// mounts this file through a Loader and, after every Engine.step, hands it
// Cues.cuesFor(events) and Cues.musicFor(phase). Every voice is a pw-play
// child process (AudioVoice.qml). Nothing under src/ imports Qt Multimedia:
// inside the shared shell process it wedged the whole shell
// (docs/audio-architecture.md "Decision").
//
// Nothing here may throw into the game. An unknown cue or track id, or a
// file that will not play, warns once and plays nothing, because a running
// shell can pair this file with a stale cached cues.mjs (the design's
// "Module cache" section).
Item {
  id: root

  property bool muted: false
  property real effectsVolume: 0.6
  property real musicVolume: 0.35
  // Where ids resolve to files, and what a voice is. Only tests point these
  // elsewhere: AudioVoice.qml needs Quickshell.Io, which qmltestrunner lacks.
  property url sfxDir: Qt.resolvedUrl("../assets/audio/sfx/")
  property url musicDir: Qt.resolvedUrl("../assets/audio/music/")
  property url voiceSource: Qt.resolvedUrl("AudioVoice.qml")

  // Voices per cue. A cue that can repeat before it ends gets several, so a
  // new shot does not cut off the one before it.
  readonly property var poolSizes: ({
    "shot": 4,
    "hit": 3,
    "brick": 3,
    "base-destroyed": 1,
    "player-destroyed": 1,
    "enemy-destroyed": 1,
    "level-clear": 1,
    "game-over": 1,
    "mission-complete": 1
  })
  readonly property var trackIds: ["title", "battle"]

  // CueId -> { voices: AudioVoice[], next: int }, built once on load.
  property var pools: ({})
  // The music voice, or null when voices cannot be made.
  property var player: null
  property var music: ({ track: null, playing: false })
  property var warned: ({})

  // Once per cue handed to a voice. Tests count these.
  signal played(string cue)

  function warnOnce(key, text) {
    if (root.warned[key]) return
    root.warned[key] = true
    console.warn("arkane.battletank audio:", text)
  }

  function playCues(cueIds) {
    for (var i = 0; i < cueIds.length; i++) {
      var cue = cueIds[i]
      if (!Object.prototype.hasOwnProperty.call(root.pools, cue)) {
        root.warnOnce("cue " + cue, "unknown cue \"" + cue + "\"")
        continue
      }
      var pool = root.pools[cue]
      if (pool.voices.length === 0) continue
      var voice = pool.voices[pool.next]
      pool.next = (pool.next + 1) % pool.voices.length
      voice.play()
      root.played(cue)
    }
  }

  // Music is a function of phase, so this runs every tick and ignores
  // repeats. The same track with playing: false holds it, so Resume
  // continues the tune instead of restarting it.
  function setMusic(next) {
    var track = next && root.trackIds.indexOf(next.track) >= 0 ? next.track : null
    if (next && next.track && track === null)
      root.warnOnce("track " + next.track, "unknown track \"" + next.track + "\"")
    var playing = track !== null && next.playing === true
    var previous = root.music.track
    if (track === previous && playing === root.music.playing) return
    root.music = { track: track, playing: playing }
    if (!root.player) return
    if (track !== previous) {
      root.player.stop()
      root.player.file = track === null ? "" : root.localPath(root.musicDir) + track + ".ogg"
    }
    if (playing) root.player.resume()
    else root.player.pause()
  }

  // pw-play takes a path, not a URL.
  function localPath(dir) {
    return decodeURIComponent(String(dir).replace(/^file:\/\//, ""))
  }

  function makeVoice(component, file, volume, loops) {
    var voice = component.createObject(root, { file: file, loops: loops })
    voice.volume = Qt.binding(function() { return volume() })
    voice.muted = Qt.binding(function() { return root.muted })
    voice.failed.connect(function(text) { root.warnOnce(text, text) })
    return voice
  }

  Component.onCompleted: {
    var component = Qt.createComponent(root.voiceSource)
    var ready = component.status === Component.Ready
    if (!ready) root.warnOnce("voice", "cannot load " + root.voiceSource + ": " + component.errorString())
    var effects = function() { return root.effectsVolume }
    var pools = {}
    for (var cue in root.poolSizes) {
      var voices = []
      for (var n = 0; ready && n < root.poolSizes[cue]; n++)
        voices.push(root.makeVoice(component, root.localPath(root.sfxDir) + cue + ".wav", effects, false))
      pools[cue] = { voices: voices, next: 0 }
    }
    root.pools = pools
    if (ready) root.player = root.makeVoice(component, "", function() { return root.musicVolume }, true)
  }
}
