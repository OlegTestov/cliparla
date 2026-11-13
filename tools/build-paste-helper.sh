#!/bin/bash
# Builds the macOS helpers into native/build/ (universal arm64 + x86_64):
# cliparla-paste (Cmd+V) and cliparla-keys (hold-to-talk key reports).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(uname)" != "Darwin" ]; then
  echo "native helpers: macOS only, skipped"
  exit 0
fi

out=native/build
mkdir -p "$out"

# Every step is checked on its own: bash ignores `set -e` inside a function called after `||`
build_helper() {
  local name="$1" source="$2"
  if [ -f "$out/$name" ] && [ "$out/$name" -nt "$source" ] && [ "$out/$name" -nt tools/build-paste-helper.sh ]; then
    echo "$name is up to date"
    return 0
  fi
  for arch in arm64 x86_64; do
    swiftc -O -target "$arch-apple-macos11.0" "$source" -o "$out/$name-$arch" || return 1
  done
  lipo -create "$out/$name-arm64" "$out/$name-x86_64" -output "$out/$name" || return 1
  rm -f "$out/$name-arm64" "$out/$name-x86_64"
  echo "built $out/$name"
}

build_helper cliparla-paste native/paste-helper/main.swift
# In dev a missing key helper only costs hold-to-talk (dictation stays a toggle).
# Packaging still fails loudly: package.json mac.binaries lists cliparla-keys, so electron-builder
# stops when the file is missing.
if ! build_helper cliparla-keys native/key-helper/main.swift; then
  rm -f "$out/cliparla-keys" "$out/cliparla-keys-arm64" "$out/cliparla-keys-x86_64"
  echo "WARNING: key helper not built: hold-to-talk is off (packaging will fail until it builds)" >&2
fi
