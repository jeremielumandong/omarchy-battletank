import QtQuick

// Fixed-timestep driver. Frames arrive at the monitor's rate (60, 144, or
// irregular), but the game must advance at exactly TICK_RATE so its speeds and
// timers mean the same thing on every screen. Frame time goes into an
// accumulator, and whole ticks come out.
//
// The loop is off whenever `running` is false. Overlay.qml binds that to
// `opened`, so a closed game costs the shared omarchy-shell nothing.
Item {
  id: root

  property bool running: false
  property real tickSeconds: 1 / 60
  // Caps catch-up after a stall (suspend, a long GC) at a few ticks, instead
  // of fast-forwarding the game through seconds nobody saw.
  property int maxTicksPerFrame: 5
  property real accumulator: 0
  readonly property bool ticking: frames.running

  // One game tick. Fired zero or more times per frame.
  signal tick()
  // Fired after a frame that produced at least one tick: repaint now.
  signal ticked()

  // Float frame times never sum exactly to tickSeconds, so allow a sliver.
  readonly property real epsilon: 1e-9

  function advance(frameSeconds) {
    root.accumulator = Math.min(root.accumulator + frameSeconds, root.tickSeconds * root.maxTicksPerFrame)
    var ticks = 0
    while (root.accumulator + root.epsilon >= root.tickSeconds) {
      root.accumulator -= root.tickSeconds
      root.tick()
      ticks++
    }
    if (ticks > 0) root.ticked()
    return ticks
  }

  onRunningChanged: root.accumulator = 0

  FrameAnimation {
    id: frames
    running: root.running
    onTriggered: root.advance(frameTime)
  }
}
