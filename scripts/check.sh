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
if grep -rnE "Quickshell|QtQuick|^\.pragma|Math\.random|Date\.now" src/core src/levels src/render |
  grep -vE '^[^:]+:[0-9]+:\s*//'; then
  echo "src/core, src/levels and src/render must stay plain, deterministic ES modules" >&2
  exit 1
fi

echo "== node"
node --test tests/*.test.mjs

echo "== qml"
QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}" "$QT_BIN/qmltestrunner" -input tests/qml
