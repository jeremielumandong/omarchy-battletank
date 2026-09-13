# Battletank

NES-style top-down tank battle for Omarchy: 10 levels, gritty retro graphics. It runs
as an Omarchy shell overlay plugin.

> Status: scaffold. The architecture, level format and tests exist; the game
> engine is not implemented yet. See [docs/architecture.md](docs/architecture.md).

## Install

```bash
omarchy plugin add <git-url-of-this-repo> --enable
```

## Play

```bash
omarchy-shell shell toggle arkane.battletank '{}'
```

Keys: arrows or WASD move, Space or J fire, Enter starts, P pauses. Esc
pauses during a level and closes the game from the title or end screens.

Optional launchers, added by you:

```jsonc
// ~/.config/omarchy/extensions/omarchy-menu.jsonc
"battletank": {"icon":"󰞇","label":"Battletank","action":"omarchy-shell shell toggle arkane.battletank '{}'"},
```

```lua
-- ~/.config/hypr/bindings.lua
o.bind("SUPER + ALT + T", "Battletank", "omarchy-shell shell toggle arkane.battletank '{}'")
```

## Develop

```bash
scripts/check.sh   # plugin contract, node --test, headless qmltestrunner
```

This needs Node 22 or newer and Qt 6 (`/usr/lib/qt6/bin/qmltestrunner`). Game
logic lives in `src/core/` as plain ES modules, and every change there must
pass both the Node and the QML suites.

Sound: `src/audio/cues.mjs` decides which event plays which cue and which
phase plays which music. `src/Audio.qml` plays them from
`assets/audio/sfx/<cue>.wav` and `assets/audio/music/<track>.ogg`, each through
a `pw-play` child process (`src/AudioVoice.qml`). QtMultimedia is banned from
`src/`, because inside the shell it wedged omarchy-shell. A running
shell caches the plugin's modules, so changed code or sounds, including after
`omarchy plugin update`, arrive only with the next `omarchy restart shell`.
