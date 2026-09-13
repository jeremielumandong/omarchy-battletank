import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui as Ui

// Plugin entry point (manifest.json entryPoints.barWidget).
//
// Toggles the same overlay the SUPER+SPACE menu row opens (Overlay.qml),
// via the in-process shell API the host injects into root.bar for every
// bar-widget instance (root.bar.shell.toggle), rather than shelling out to
// `omarchy-shell shell toggle`. root.moduleName is the plugin id the host
// sets on every live instance, so it doubles as the toggle target.
Ui.BarWidget {
  id: root
  moduleName: "arkane.battletank"

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Ui.BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰞇"
    tooltipText: "Battletank"
    onPressed: function(button) {
      if (button === Qt.LeftButton) root.bar.shell.toggle(root.moduleName, "{}")
    }
  }
}
