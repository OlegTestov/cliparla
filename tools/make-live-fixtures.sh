#!/bin/bash
# Speech fixtures for the live Gemini checks in tests/live/ (macOS: `say` writes a file, nothing is played).
#   keep-ru.wav   Russian with a filler and a self-correction
#   keep-en.wav   English with a filler and a self-correction
#   name-en.wav   English with a made-up name that the dictionary spells in a fixed way
set -euo pipefail
cd "$(dirname "$0")/.."
out=tests/fixtures/speech
tmp=$(mktemp -d)
mkdir -p "$out"
make() { # voice, text, file
  say -v "$1" -o "$tmp/s.aiff" "$2"
  afconvert -f WAVE -d LEI16@16000 -c 1 "$tmp/s.aiff" "$out/$3"
}
make Milena "Ну, эээ, отправь отчёт Анне в пятницу. Нет, вернее, в четверг днём." keep-ru.wav
make Samantha "Um, please send the report to Anna by Friday. Scratch that, by Thursday afternoon." keep-en.wav
make Samantha "Please ask Zorvath Quellin to review the draft before lunch." name-en.wav
rm -rf "$tmp"
ls -l "$out"
