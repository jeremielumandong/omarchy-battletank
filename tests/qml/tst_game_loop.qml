import QtQuick
import QtTest
import "../../src"

// GameLoop is the only timing code in the game. These tests pin its promise:
// a fixed tick rate at any frame rate, bounded catch-up, and no work at all
// while not running.
TestCase {
  name: "GameLoop"
  when: windowShown

  GameLoop {
    id: loop
    property int ticks: 0
    onTick: ticks++
  }

  function init() {
    loop.running = false
    loop.accumulator = 0
    loop.ticks = 0
  }

  function test_60hz_frames_give_60_ticks_per_second() {
    for (var i = 0; i < 60; i++) loop.advance(1 / 60)
    compare(loop.ticks, 60)
  }

  function test_144hz_frames_give_60_ticks_per_second() {
    for (var i = 0; i < 144; i++) loop.advance(1 / 144)
    compare(loop.ticks, 60)
  }

  function test_long_frame_is_clamped() {
    compare(loop.advance(1.0), loop.maxTicksPerFrame)
    verify(loop.accumulator < loop.tickSeconds)
  }

  function test_frame_driver_follows_running() {
    verify(!loop.ticking)
    loop.running = true
    verify(loop.ticking)
    loop.running = false
    verify(!loop.ticking)
  }

  function test_frames_tick_only_while_running() {
    loop.running = true
    tryVerify(function() { return loop.ticks > 0 }, 2000, "frames drive ticks while running")
    loop.running = false
    var stopped = loop.ticks
    wait(200)
    compare(loop.ticks, stopped)
  }
}
