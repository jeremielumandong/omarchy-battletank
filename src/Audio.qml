import QtQuick
import QtMultimedia

// Plays the sounds src/audio/cues.mjs names, and decides nothing. Overlay.qml
// mounts this file through a Loader and, after every Engine.step, hands it
// Cues.cuesFor(events) and Cues.musicFor(phase). It is the only file that
// imports QtMultimedia: where that module is missing, the Loader ends in
// Error and the game runs silent (docs/audio-architecture.md).
//
// Nothing here may throw into the game. An unknown cue or track id, or a
// file that will not load, warns once and plays nothing, because a running
// shell can pair this file with a stale cached cues.mjs (the design's
// "Module cache" section).
Item {
  id: root

  property bool muted: false
  property real effectsVolume: 0.6
  property real musicVolume: 0.35
  // Where ids resolve to files. Only tests point these elsewhere.
  property url sfxDir: Qt.resolvedUrl("../assets/audio/sfx/")
  property url musicDir: Qt.resolvedUrl("../assets/audio/music/")

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

  // CueId -> { voices: SoundEffect[], next: int }, built once on load.
  property var pools: ({})
  property var music: ({ track: null, playing: false })
  property var warned: ({})
  readonly property alias player: player

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
      var voice = pool.voices[pool.next]
      pool.next = (pool.next + 1) % pool.voices.length
      voice.play()
      root.played(cue)
    }
  }

  // Music is a function of phase, so this runs every tick and ignores
  // repeats. The same track with playing: false pauses it, so Resume
  // continues the tune instead of restarting it.
  function setMusic(next) {
    var track = next && root.trackIds.indexOf(next.track) >= 0 ? next.track : null
    if (next && next.track && track === null)
      root.warnOnce("track " + next.track, "unknown track \"" + next.track + "\"")
    var playing = track !== null && next.playing === true
    if (track === root.music.track && playing === root.music.playing) return
    if (track !== root.music.track) {
      player.stop()
      player.source = track === null ? "" : String(root.musicDir) + track + ".ogg"
    }
    root.music = { track: track, playing: playing }
    if (playing) player.play()
    else if (track !== null) player.pause()
  }

  Component {
    id: voiceComponent
    SoundEffect {
      volume: root.effectsVolume
      muted: root.muted
      onStatusChanged: {
        if (status === SoundEffect.Error) root.warnOnce("file " + source, "cannot load " + source)
      }
    }
  }

  MediaPlayer {
    id: player
    loops: MediaPlayer.Infinite
    audioOutput: AudioOutput {
      volume: root.musicVolume
      muted: root.muted
    }
    onErrorOccurred: function(error, errorString) {
      root.warnOnce("music " + source, errorString)
    }
  }

  Component.onCompleted: {
    var pools = {}
    for (var cue in root.poolSizes) {
      var voices = []
      for (var n = 0; n < root.poolSizes[cue]; n++)
        voices.push(voiceComponent.createObject(root, { source: String(root.sfxDir) + cue + ".wav" }))
      pools[cue] = { voices: voices, next: 0 }
    }
    root.pools = pools
  }
}
