import QtQuick
import QtTest
import "../../src"
import "../../src/audio/cues.mjs" as Cues
import "../../src/core/constants.mjs" as Constants
import "../../src/core/engine.mjs" as Engine
import "../../src/levels/index.mjs" as Levels
import "voices.mjs" as Voices

// Audio.qml as Overlay.qml mounts it: behind a Loader, fed after every
// Engine.step. Overlay.qml imports Quickshell, which does not load here, so
// this file repeats its wiring (sound() and onTick) next to the real Engine
// and GameLoop. Voices are FakeVoice.qml, because AudioVoice.qml needs
// Quickshell.Io; tests/quickshell/tst_close_cycle.qml runs the real one.
TestCase {
  id: testCase
  name: "Audio"
  when: windowShown

  readonly property url fakeVoice: Qt.resolvedUrl("FakeVoice.qml")
  property var game: null
  property var input: ({ dir: null, fire: false, start: false, pause: false })
  property int shotSteps: 0
  property int shotCues: 0
  property bool opened: false

  Loader {
    id: audio
    Component.onCompleted: setSource(Qt.resolvedUrl("../../src/Audio.qml"), { voiceSource: testCase.fakeVoice })
  }

  Loader {
    id: broken
  }

  // Mounted the way Overlay.qml mounts it: active follows the overlay.
  Loader {
    id: cycled
    active: testCase.opened
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

  // tests/audio.test.mjs checks that each of these files exists.
  function test_every_cue_and_track_has_voices_on_its_file() {
    compare(audio.status, Loader.Ready)
    compare(sorted(Object.keys(audio.item.poolSizes)), sorted(Cues.CUE_IDS))
    compare(sorted(audio.item.trackIds), sorted(Cues.TRACK_IDS))
    for (var cue in audio.item.poolSizes) {
      var voices = audio.item.pools[cue].voices
      compare(voices.length, audio.item.poolSizes[cue], cue)
      for (var i = 0; i < voices.length; i++) {
        verify(voices[i].file.endsWith("/assets/audio/sfx/" + cue + ".wav"), voices[i].file)
        verify(voices[i].file.indexOf("file:") !== 0, "pw-play takes a path, not a URL")
        compare(voices[i].volume, audio.item.effectsVolume)
      }
    }
    verify(audio.item.player.loops)
    compare(audio.item.player.volume, audio.item.musicVolume)
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
    verify(a.player.file.endsWith("/music/title.ogg"))
    verify(a.player.running && !a.player.held)

    a.setMusic(Cues.musicFor("playing"))
    verify(a.player.file.endsWith("/music/battle.ogg"))
    verify(a.player.running && !a.player.held)
    var plays = a.player.plays

    a.setMusic(Cues.musicFor("paused"))
    verify(a.player.held, "pause holds the tune")
    verify(a.player.file.endsWith("/music/battle.ogg"))

    a.setMusic(Cues.musicFor("playing"))
    verify(a.player.running && !a.player.held)
    compare(a.player.plays, plays, "resume continues the tune, not a restart")
    a.setMusic(Cues.musicFor("playing"))
    compare(a.player.plays, plays)

    a.setMusic(Cues.musicFor("gameOver"))
    verify(!a.player.running)
    compare(a.music.track, null)
  }

  function test_unknown_ids_are_silent_never_a_throw() {
    audio.item.playCues(["bogus", "toString", "shot"])
    compare(testCase.shotCues, 1)
    audio.item.setMusic({ track: "bogus", playing: true })
    compare(audio.item.music.track, null)
    verify(!audio.item.player.running)
  }

  function test_a_failing_voice_warns_once_and_never_throws() {
    broken.setSource(Qt.resolvedUrl("../../src/Audio.qml"), {
      voiceSource: testCase.fakeVoice,
      sfxDir: "file:///nonexistent/battletank/",
      musicDir: "file:///nonexistent/battletank/"
    })
    compare(broken.status, Loader.Ready)
    var voice = broken.item.pools["shot"].voices[0]
    verify(voice.file.indexOf("/nonexistent/battletank/shot.wav") === 0, voice.file)
    voice.failed("cannot play " + voice.file)
    voice.failed("cannot play " + voice.file)
    compare(Object.keys(broken.item.warned).length, 1)
    broken.item.playCues(["shot", "hit", "game-over"])
    broken.item.setMusic({ track: "battle", playing: true })
    verify(broken.item !== null)
    broken.source = ""
  }

  // Where voices cannot be made at all (AudioVoice.qml failing to load, as
  // it does here without Quickshell.Io), the game still runs, silent.
  function test_no_voices_means_silence_never_a_throw() {
    ignoreWarning(new RegExp("cannot load .*AudioVoice\\.qml"))
    broken.source = Qt.resolvedUrl("../../src/Audio.qml")
    compare(broken.status, Loader.Ready)
    compare(broken.item.player, null)
    var cues = 0
    broken.item.played.connect(function() { cues++ })
    broken.item.playCues(["shot", "game-over"])
    broken.item.setMusic({ track: "title", playing: true })
    compare(cues, 0)
    compare(broken.item.music.track, "title")
    broken.source = ""
  }

  // The user's hang: open with sound, close, five times. Every voice must
  // die with the Loader, so nothing that plays sound outlives the overlay.
  function test_closing_the_overlay_destroys_every_voice() {
    var before = Voices.live.count
    cycled.setSource(Qt.resolvedUrl("../../src/Audio.qml"), { voiceSource: testCase.fakeVoice })
    cycled.active = Qt.binding(function() { return testCase.opened })
    for (var i = 0; i < 5; i++) {
      testCase.opened = true
      tryVerify(function() { return cycled.item !== null }, 1000, "cycle " + i + " opens")
      compare(cycled.item.voiceSource, testCase.fakeVoice, "reopening keeps the voice")
      cycled.item.setMusic(Cues.musicFor("title"))
      if (i === 2) cycled.item.setMusic({ track: "title", playing: false })
      cycled.item.playCues(["shot", "hit", "brick"])
      verify(cycled.item.player.running, "cycle " + i + " music")
      compare(cycled.item.player.held, i === 2, "cycle " + i + " held")
      compare(Voices.live.count - before, 17, "cycle " + i + ": 16 effect voices and the music")
      testCase.opened = false
      compare(cycled.item, null)
      tryCompare(Voices.live, "count", before, 1000, "cycle " + i + ": no voice outlives the close")
    }
    cycled.source = ""
  }
}
