#!/bin/bash
# Makes the four audio fixtures of tests/speech-level.test.ts (macOS: `say` writes a file, nothing is played).
#   silence.wav       digital silence
#   noise.wav         room noise, peak 0.01
#   quiet-speech.wav  speech scaled to peak 0.03 (about -30 dBFS: someone speaking softly, far from the mic)
#   speech.wav        speech at its natural level (peak about 0.75)
set -euo pipefail
cd "$(dirname "$0")/.."
out=tests/fixtures/speech
tmp=$(mktemp -d)
mkdir -p "$out"
say -v Samantha -o "$tmp/s.aiff" "Please send the report to Anna by Friday afternoon."
afconvert -f WAVE -d LEI16@8000 -c 1 "$tmp/s.aiff" "$out/speech.wav"
python3 - "$out" <<'PY'
import random, struct, sys, wave
out = sys.argv[1]
src = wave.open(f"{out}/speech.wav")
rate, n = src.getframerate(), src.getnframes()
samples = list(struct.unpack(f"<{n}h", src.readframes(n)))
peak = max(abs(x) for x in samples)

def write(name, data):
    with wave.open(f"{out}/{name}", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(struct.pack(f"<{len(data)}h", *data))

write("silence.wav", [0] * n)
random.seed(1)
noise = [random.gauss(0, 1) for _ in range(n)]
top = max(abs(x) for x in noise)
write("noise.wav", [int(x / top * 0.01 * 32768) for x in noise])
write("quiet-speech.wav", [int(x / peak * 0.03 * 32768) for x in samples])
PY
rm -rf "$tmp"
ls -l "$out"
