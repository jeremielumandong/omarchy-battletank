import QtQuick
import QtMultimedia
import QtTest
import "../../src"
import "../../src/audio/cues.mjs" as Cues
import "../../src/core/constants.mjs" as Constants
import "../../src/core/engine.mjs" as Engine
import "../../src/levels/index.mjs" as Levels

// Audio.qml as Overlay.qml mounts it: behind a Loader, fed after every
// Engine.step. Overlay.qml imports Quickshell, which does not load here, so
// this file repeats its wiring (sound() and onTick) next to the real Engine
// and GameLoop. Voices are muted so the suite stays quiet on a desktop.
TestCase {
  id: testCase
  name: "Audio"
  when: windowShown

  property var game: null
  property var input: ({ dir: null, fire: false, start: false, pause: false })
  property int shotSteps: 0
  property int shotCues: 0

  Loader {
    id: audio
    source: "../../src/Audio.qml"
    onLoaded: item.muted = true
  }

  Loader {
    id: broken
    onLoaded: item.muted = true
  }

  Connections {
    target: audio.item
    function onPlayed(cue) {
      if (cue === "shot") testCase.shotCues++
    }
  }

  function sound(game) {
    audio.item.playCues(Cues.cuesFor(game.events))
    audio.item.setMusic(Cues.musicFor(game.phase))
  }

  GameLoop {
    id: loop
    onTick: {
      Engine.step(testCase.game, testCase.input)
      if (testCase.game.events.some(function(e) { return e.kind === "shot" })) testCase.shotSteps++
      testCase.sound(testCase.game)
    }
  }

  function init() {
    audio.item.setMusic({ track: null, playing: false })
    testCase.shotSteps = 0
    testCase.shotCues = 0
  }

  function sorted(list) {
    return JSON.stringify(Array.prototype.slice.call(list).sort())
  }

  function test_every_cue_and_track_has_a_file_that_loads() {
    compare(audio.status, Loader.Ready)
    compare(sorted(Object.keys(audio.item.poolSizes)), sorted(Cues.CUE_IDS))
    compare(sorted(audio.item.trackIds), sorted(Cues.TRACK_IDS))
    tryVerify(function() {
      for (var cue in audio.item.pools) {
        var voices = audio.item.pools[cue].voices
        for (var i = 0; i < voices.length; i++)
          if (voices[i].status !== SoundEffect.Ready) return false
      }
      return true
    }, 5000, "every voice reaches Ready")
    for (var t = 0; t < Cues.TRACK_IDS.length; t++) {
      audio.item.setMusic({ track: Cues.TRACK_IDS[t], playing: true })
      tryVerify(function() {
        var status = audio.item.player.mediaStatus
        return status === MediaPlayer.LoadedMedia || status === MediaPlayer.BufferedMedia
      }, 5000, Cues.TRACK_IDS[t] + " loads")
    }
  }

  // step() clears events, and a catch-up frame runs up to 5 steps. Draining
  // once per frame would hear only the last step of each.
  function test_a_multi_tick_frame_plays_every_steps_shot() {
    testCase.game = Engine.createGame(Levels.levels, { seed: 3 })
    testCase.input = { dir: null, fire: false, start: true, pause: false }
    loop.advance(loop.tickSeconds)
    testCase.input = { dir: null, fire: false, start: false, pause: false }
    for (var i = 0; i <= Constants.PHASE_TICKS.levelStart; i++) loop.advance(loop.tickSeconds)
    compare(testCase.game.phase, "playing")
    compare(audio.item.music.track, "battle")

    testCase.shotSteps = 0
    testCase.shotCues = 0
    for (var frame = 0; frame < 40; frame++) {
      testCase.input = { dir: null, fire: frame % 2 === 0, start: false, pause: false }
      compare(loop.advance(loop.tickSeconds * loop.maxTicksPerFrame), loop.maxTicksPerFrame)
    }
    verify(testCase.shotSteps > 0, "the player fired")
    compare(testCase.shotCues, testCase.shotSteps)
  }

  function test_music_follows_phase_and_pause_holds_it() {
    var a = audio.item
    a.setMusic(Cues.musicFor("title"))
    verify(String(a.player.source).endsWith("/music/title.ogg"))
    tryCompare(a.player, "playbackState", MediaPlayer.PlayingState)

    a.setMusic(Cues.musicFor("playing"))
    verify(String(a.player.source).endsWith("/music/battle.ogg"))
    tryCompare(a.player, "playbackState", MediaPlayer.PlayingState)

    a.setMusic(Cues.musicFor("paused"))
    tryCompare(a.player, "playbackState", MediaPlayer.PausedState)
    verify(String(a.player.source).endsWith("/music/battle.ogg"))

    a.setMusic(Cues.musicFor("playing"))
    tryCompare(a.player, "playbackState", MediaPlayer.PlayingState)
    a.setMusic(Cues.musicFor("playing"))
    compare(a.player.playbackState, MediaPlayer.PlayingState)

    a.setMusic(Cues.musicFor("gameOver"))
    tryCompare(a.player, "playbackState", MediaPlayer.StoppedState)
    compare(a.music.track, null)
  }

  function test_unknown_ids_are_silent_never_a_throw() {
    audio.item.playCues(["bogus", "toString", "shot"])
    compare(testCase.shotCues, 1)
    audio.item.setMusic({ track: "bogus", playing: true })
    compare(audio.item.music.track, null)
    compare(audio.item.player.playbackState, MediaPlayer.StoppedState)
  }

  function test_missing_files_neither_throw_nor_fault() {
    broken.setSource(Qt.resolvedUrl("../../src/Audio.qml"), {
      sfxDir: "file:///nonexistent/battletank/",
      musicDir: "file:///nonexistent/battletank/"
    })
    compare(broken.status, Loader.Ready)
    tryVerify(function() {
      return broken.item.pools["shot"].voices[0].status === SoundEffect.Error
    }, 5000, "a missing file leaves its voice in Error")
    broken.item.playCues(["shot", "hit", "game-over"])
    broken.item.setMusic({ track: "battle", playing: true })
    wait(100)
    verify(broken.item !== null)
    broken.source = ""
  }
}
