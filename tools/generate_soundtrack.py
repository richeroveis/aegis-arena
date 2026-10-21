"""Generate the 48 second stereo soundtrack for the AegisArena Milestone v1 demo.

Run from the repo root:

    python tools/generate_soundtrack.py

Writes tools/out/soundtrack.wav (48s, 44100 Hz, 16-bit stereo). The recorder
muxes it into the final H.264/AAC demo video with ffmpeg.
"""

from __future__ import annotations

import math
import pathlib
import struct
import wave

SAMPLE_RATE = 44100
DURATION = 48.0
OUT = pathlib.Path(__file__).resolve().parent / "out" / "soundtrack.wav"

# A minor, F major, C major, G major. Each chord lasts 12 seconds.
CHORDS = [
    [220.00, 261.63, 329.63],  # A minor
    [174.61, 220.00, 261.63],  # F major
    [261.63, 329.63, 392.00],  # C major
    [196.00, 246.94, 293.66],  # G major
]


def envelope(t: float, total: float) -> float:
    attack = min(1.0, t / 1.2)
    release = min(1.0, max(0.0, (total - t) / 2.0))
    return attack * release


def sample_at(t: float) -> tuple[float, float]:
    chord_index = min(len(CHORDS) - 1, int(t // 12.0))
    chord = CHORDS[chord_index]
    local = t - chord_index * 12.0
    env = envelope(t, DURATION)

    pad = 0.0
    for i, freq in enumerate(chord):
        detune = 1.0 + (i - 1) * 0.0015
        pad += math.sin(2.0 * math.pi * freq * detune * t) * 0.16
        pad += math.sin(2.0 * math.pi * freq * 0.5 * detune * t) * 0.05

    # Slow bass pulse on every half second.
    beat = t % 0.5
    bass_env = math.exp(-beat * 7.0)
    bass = math.sin(2.0 * math.pi * (chord[0] / 2.0) * t) * 0.22 * bass_env

    # Soft kick every second.
    kick_phase = t % 1.0
    kick = math.sin(2.0 * math.pi * (58.0 - 20.0 * kick_phase) * kick_phase) * math.exp(-kick_phase * 18.0) * 0.28

    # Airy sparkle in the last six seconds.
    sparkle = 0.0
    if t > DURATION - 6.0:
        fade = (t - (DURATION - 6.0)) / 6.0
        sparkle = math.sin(2.0 * math.pi * 880.0 * t) * 0.05 * fade

    left = (pad + bass) * env + kick + sparkle
    right = (pad * 0.92 + bass * 1.04) * env + kick + sparkle
    return left, right


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames = int(SAMPLE_RATE * DURATION)
    data = bytearray()
    peak = 0.0
    samples = []
    for n in range(frames):
        t = n / SAMPLE_RATE
        left, right = sample_at(t)
        left = max(-1.0, min(1.0, left))
        right = max(-1.0, min(1.0, right))
        peak = max(peak, abs(left), abs(right))
        samples.append((left, right))

    # Normalize to -3 dBFS for a consistent AAC encode.
    target = 0.707
    gain = (target / peak) if peak > 0 else 1.0
    for left, right in samples:
        li = int(max(-1.0, min(1.0, left * gain)) * 32767)
        ri = int(max(-1.0, min(1.0, right * gain)) * 32767)
        data += struct.pack("<hh", li, ri)

    with wave.open(str(OUT), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(bytes(data))

    print(f"wrote {OUT} ({DURATION:.0f}s, stereo, 44100 Hz)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
