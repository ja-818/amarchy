#!/usr/bin/env python3
"""amarchy's own chimes, made from nothing but sine waves (stdlib only), so
they're ours to ship. Run it to make them again, into this directory:

  sounds/make.py [dir]

ocean.oga and elementary.oga aren't made here; CREDITS says where they're from."""
import math, struct, sys, wave
from pathlib import Path

SR = 48000
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent)
OUT.mkdir(parents=True, exist_ok=True)


def note(n):  # MIDI note -> Hz
    return 440 * 2 ** ((n - 69) / 12)


def buf(seconds):
    return [0.0] * int(SR * seconds)


def add(out, start, voice):
    i0 = int(start * SR)
    for i, v in enumerate(voice):
        if i0 + i < len(out):
            out[i0 + i] += v


def partials(freq, spec, dur, attack=0.004):
    """spec: (ratio, amp, decay seconds) per partial; a smooth attack, exp decays."""
    n = int(dur * SR)
    out = [0.0] * n
    for ratio, amp, decay in spec:
        f = freq * ratio
        if f > SR / 2.2:
            continue
        w = 2 * math.pi * f / SR
        k = math.exp(-1 / (decay * SR))
        env = amp
        for i in range(n):
            out[i] += env * math.sin(w * i)
            env *= k
    a = int(attack * SR)
    for i in range(min(a, n)):
        out[i] *= 0.5 - 0.5 * math.cos(math.pi * i / a)
    return out


def fm(freq, ratio, index, decay, idecay, dur, amp=1.0, attack=0.003):
    """Two-operator FM: an electric-piano / tine kind of tone."""
    n = int(dur * SR)
    out = []
    a = int(attack * SR)
    for i in range(n):
        t = i / SR
        mod = index * math.exp(-t / idecay) * math.sin(2 * math.pi * freq * ratio * t)
        v = amp * math.exp(-t / decay) * math.sin(2 * math.pi * freq * t + mod)
        if i < a:
            v *= 0.5 - 0.5 * math.cos(math.pi * i / a)
        out.append(v)
    return out


def room(x, mix=0.18):
    """A small, soft room: a few damped feedback combs plus an allpass."""
    out = x + [0.0] * int(0.6 * SR)
    wet = [0.0] * len(out)
    for d_ms, g in ((29.7, 0.76), (37.1, 0.74), (41.1, 0.72), (43.7, 0.70)):
        d = int(d_ms / 1000 * SR)
        line = [0.0] * len(out)
        lp = 0.0
        for i in range(len(out)):
            fb = line[i - d] if i >= d else 0.0
            lp += 0.45 * (fb - lp)
            line[i] = out[i] + g * lp
            wet[i] += line[i] * 0.25
    return [d + mix * w for d, w in zip(out, wet)]


def write(name, x, peak=0.5):
    x = room(x)
    # trim the silent tail, fade the last 40ms
    m = max(abs(v) for v in x) or 1
    end = len(x)
    while end > 0 and abs(x[end - 1]) < m * 0.002:
        end -= 1
    x = x[:end]
    f = int(0.04 * SR)
    for i in range(min(f, len(x))):
        x[-1 - i] *= i / f
    x = [v / m * peak for v in x]
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(v * 32767)) for v in x))


VIBE = [(1, 1, 1.2), (4, 0.18, 0.3), (10, 0.04, 0.08)]
KALIMBA = [(1, 1, 0.45), (5.9, 0.22, 0.05), (2.0, 0.08, 0.2)]
BELL = [(1, 1, 0.35), (2.0, 0.3, 0.2), (3.0, 0.12, 0.1), (4.2, 0.06, 0.05)]


def sparkle(x, t, notes, step, amp=1.0, decay=1.0):
    """A quick run of small high bells."""
    for k, n in enumerate(notes):
        add(x, t + k * step, [amp * v for v in partials(note(n), [(r, a, d * decay) for r, a, d in BELL], 0.9)])


# kalimba: two plucks, a fifth apart
x = buf(1.2); add(x, 0, partials(note(81), KALIMBA, 1)); add(x, 0.13, partials(note(88), KALIMBA, 1))
write("kalimba", x)

# vibraphone: C E G, one after the other, ringing into a chord
x = buf(2.0)
for k, n in enumerate((72, 76, 79)):
    add(x, k * 0.09, partials(note(n), VIBE, 1.8))
write("vibraphone", x)

# tine: one FM bell note, a little bright
x = buf(1.8); add(x, 0, fm(note(81), 3.5, 2.2, 0.6, 0.05, 1.8)); write("tine", x)

# fairy: a twinkle, a beat, then a brighter run rising ("hey… listen!")
x = buf(1.6)
sparkle(x, 0.00, (93, 98), 0.045, 0.9)
sparkle(x, 0.30, (88, 91, 93, 96, 98, 100), 0.03, 0.8, 1.4)
write("fairy", x)

# herald: a knock of the staff, then two horn notes up a fourth (your assistant's)
HORN = [(1, 1, 0.7), (2, 0.55, 0.5), (3, 0.35, 0.35), (4, 0.2, 0.25), (5, 0.1, 0.18), (6, 0.05, 0.12)]
WOOD = [(1, 1, 0.03), (2.7, 0.5, 0.02), (5.2, 0.2, 0.01)]
x = buf(1.6)
add(x, 0, [0.7 * v for v in partials(820, WOOD, 0.15, attack=0.001)])
add(x, 0.09, [0.8 * v for v in partials(note(67), HORN, 0.5, attack=0.025)])
add(x, 0.24, partials(note(72), HORN, 1.3, attack=0.03))
write("herald", x)

