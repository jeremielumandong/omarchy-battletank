#!/bin/bash

# Every check this repo has, in one command: the omarchy plugin contract, the
# pure core under Node, and the QML seams under headless Qt. None of it touches
# the running desktop shell.

set -euo pipefail
cd "$(dirname "$0")/.."

QT_BIN="${QT_BIN:-/usr/lib/qt6/bin}"

echo "== omarchy plugin contract"
omarchy-plugin-validate .
if ! jq -e 'has("keepLoaded") | not' manifest.json >/dev/null; then
  echo "manifest.json must not set keepLoaded: a hidden game must unload (docs/architecture.md)" >&2
  exit 1
fi

echo "== plain ES modules"
if grep -rnE "Quickshell|QtQuick|QtMultimedia|^\.pragma|Math\.random|Date\.now" src/core src/levels src/render src/audio |
  grep -vE '^[^:]+:[0-9]+:\s*//'; then
  echo "src/core, src/levels, src/render and src/audio must stay plain, deterministic ES modules" >&2
  exit 1
fi

echo "== no Qt Multimedia in the shell"
# In-process Qt Multimedia wedged the whole omarchy-shell. Sound plays through
# pw-play child processes instead (docs/audio-architecture.md "Decision").
if grep -rnE "^\s*import\s+QtMultimedia" src; then
  echo "src/ must not import QtMultimedia: it runs inside the shared shell process" >&2
  exit 1
fi

echo "== node"
node --test tests/*.test.mjs

echo "== qml"
QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}" "$QT_BIN/qmltestrunner" -input tests/qml

echo "== quickshell"
# The real AudioVoice.qml, whose Quickshell.Io qmltestrunner lacks. The stub
# pw-play on PATH keeps it silent.
out=$(PATH="$PWD/tests/quickshell/bin:$PATH" BT_ROOT="$PWD" QT_QPA_PLATFORM=offscreen \
  timeout -s KILL 60 quickshell -p tests/quickshell/tst_close_cycle.qml 2>&1) || true
if ! grep -q "RESULT PASS" <<<"$out"; then
  echo "$out" >&2
  echo "tests/quickshell/tst_close_cycle.qml failed" >&2
  exit 1
fi
grep "RESULT" <<<"$out"
