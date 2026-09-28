"""Soundtrack for the reel: synthesized from scratch, locked to the picture.

128 BPM, A minor, 8 bars = 15.000 s. Every sound effect is placed on the same
timestamps the renderer (index.html) uses for its animation events.

    python3 audio.py        -> soundtrack.wav (48 kHz, 16-bit stereo)
"""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
import wave

SR = 48000
DUR = 15.0
N = int(SR * DUR)
B = 60 / 128
BAR = 4 * B
rng = np.random.default_rng(26)

music = np.zeros((2, N))   # sidechained bus (bass, pads, arps)
drums = np.zeros((2, N))
sfx = np.zeros((2, N))
send = np.zeros((2, N))    # reverb send


# ---------------------------------------------------------------- utilities
def tt(d):
    return np.arange(int(d * SR)) / SR


def filt(x, fc, kind='low', order=2):
    if kind == 'band':
        wn = [max(20, fc[0]) / (SR / 2), min(SR / 2 - 100, fc[1]) / (SR / 2)]
    else:
        wn = min(max(fc, 20), SR / 2 - 100) / (SR / 2)
    return sosfilt(butter(order, wn, kind, output='sos'), x)


def sweep(x, f0, f1, kind='band', q=0.6, block=256):
    """Time-varying filter: cutoff glides exponentially f0 -> f1."""
    out = np.zeros_like(x)
    n = len(x)
    zi = None
    for i in range(0, n, block):
        f = f0 * (f1 / f0) ** (i / max(1, n - 1))
        if kind == 'band':
            sos = butter(1, [max(20, f * (1 - q / 2)) / (SR / 2), min(SR / 2 - 100, f * (1 + q / 2)) / (SR / 2)], 'band', output='sos')
        else:
            sos = butter(2, min(max(f, 20), SR / 2 - 100) / (SR / 2), kind, output='sos')
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        out[i:i + block], zi = sosfilt(sos, x[i:i + block], zi=zi)
    return out


def saw(ph):
    return 2 * (ph % 1.0) - 1


def osc_phase(freq, n):
    f = np.broadcast_to(freq, (n,)).astype(float)
    return np.cumsum(f) / SR


def place(bus, sig, t0, gain=1.0, pan=0.0, rev=0.0):
    i0 = int(round(t0 * SR))
    if i0 >= N:
        return
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        sig = np.stack([sig * np.cos(a), sig * np.sin(a)]) * np.sqrt(2)
    if i0 < 0:
        sig = sig[:, -i0:]
        i0 = 0
    n = min(sig.shape[1], N - i0)
    bus[:, i0:i0 + n] += sig[:, :n] * gain
    if rev:
        send[:, i0:i0 + n] += sig[:, :n] * gain * rev


def note(name):
    names = {'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'G#': -1, 'A': 0, 'A#': 1, 'B': 2}
    return 440 * 2 ** ((names[name[:-1]] + 12 * (int(name[-1]) - 4)) / 12)


# ---------------------------------------------------------------- instruments
def kick(d=0.5, punch=1.0):
    t = tt(d)
    f = 44 + 120 * np.exp(-t * 30)
    s = np.sin(2 * np.pi * osc_phase(f, len(t))) * np.exp(-t * 7.5)
    click = filt(rng.standard_normal(len(t)), 2500, 'high') * np.exp(-t * 350) * 0.35
    return np.tanh(1.6 * punch * (s + click))


def boom(d=2.6):
    t = tt(d)
    f = 30 + 70 * np.exp(-t * 5)
    s = np.sin(2 * np.pi * osc_phase(f, len(t))) * np.exp(-t * 1.5)
    n = filt(rng.standard_normal(len(t)), 700) * np.exp(-t * 6) * 0.9
    return np.tanh(1.8 * (s + n))


def clap(d=0.35):
    t = tt(d)
    n = rng.standard_normal(len(t))
    env = np.zeros(len(t))
    for k, o in enumerate([0, 0.011, 0.023]):
        env += np.where(t >= o, np.exp(-(t - o) * 140), 0) * (0.8 if k < 2 else 1)
    env += np.where(t >= 0.023, np.exp(-(t - 0.023) * 16) * 0.45, 0)
    return filt(n, (900, 6000), 'band') * env * 1.4


def snare(d=0.25, v=1.0):
    t = tt(d)
    body = np.sin(2 * np.pi * osc_phase(190 + 60 * np.exp(-t * 40), len(t))) * np.exp(-t * 22) * 0.6
    n = filt(rng.standard_normal(len(t)), 1500, 'high') * np.exp(-t * 16)
    return (body + n) * v


def hat(open_=False):
    d = 0.32 if open_ else 0.06
    t = tt(d)
    n = filt(rng.standard_normal(len(t)), 7500, 'high', 4)
    return n * np.exp(-t * (10 if open_ else 70))


def bass(freq, d):
    t = tt(d)
    ph = osc_phase(freq, len(t))
    s = 0.5 * saw(ph * 1.003) + 0.5 * saw(ph * 0.997) + 0.8 * np.sin(2 * np.pi * ph)
    env = np.minimum(1, t / 0.004) * np.exp(-t * 3.5) * np.minimum(1, (d - t) / 0.01)
    out = np.zeros(len(t))
    # plucky filter envelope, processed in blocks
    blk = 128
    zi = np.zeros((1, 2))
    for i in range(0, len(t), blk):
        fc = 180 + 1800 * np.exp(-t[i] * 14)
        sos = butter(2, fc / (SR / 2), 'low', output='sos')
        out[i:i + blk], zi = sosfilt(sos, s[i:i + blk], zi=zi)
    return np.tanh(out * env * 1.4)


def pad(freqs, d, bright=1400, att=0.35, rel=0.8):
    t = tt(d)
    L = np.zeros(len(t))
    R = np.zeros(len(t))
    for f in freqs:
        for k, det in enumerate([-0.011, -0.004, 0.004, 0.011]):
            s = saw(osc_phase(f * (1 + det), len(t)) + rng.random())
            (L if k % 2 == 0 else R)[:] += s
    env = np.minimum(1, t / att) * np.minimum(1, np.maximum(0, (d - t) / rel))
    L = filt(L, bright) * env
    R = filt(R, bright) * env
    return np.stack([L, R]) / (len(freqs) * 2.5)


def pluck(freq, d=0.32, bright=1.0):
    t = tt(d)
    ph = osc_phase(freq, len(t))
    s = saw(ph) * 0.6 + np.sign(np.sin(2 * np.pi * ph * 0.5)) * 0.25 + np.sin(2 * np.pi * ph * 2) * 0.2
    s = filt(s, 900 + 5000 * bright) * np.exp(-t * 11)
    return s * np.minimum(1, t / 0.002)


def stab(freqs, d=2.4):
    t = tt(d)
    L = np.zeros(len(t))
    R = np.zeros(len(t))
    for f in freqs:
        for k in range(7):
            det = (k - 3) * 0.0045
            s = saw(osc_phase(f * (1 + det), len(t)) + rng.random())
            L += s * (1 - k / 7)
            R += s * (k / 7)
    env = np.exp(-t * 1.6) * np.minimum(1, t / 0.003)
    L = filt(filt(L, 7000), 120, 'high') * env
    R = filt(filt(R, 7000), 120, 'high') * env
    return np.stack([L, R]) / (len(freqs) * 3.5)


def whoosh(d, f0, f1, shape='arc', q=0.9):
    t = tt(d)
    x = t / d
    n = sweep(rng.standard_normal(len(t)), f0, f1, 'band', q)
    env = {'arc': np.sin(np.pi * x) ** 2, 'rise': x ** 2.5, 'fall': (1 - x) ** 2}[shape]
    return n * env * 2.2


def riser(d, f0=180, f1=1500):
    t = tt(d)
    x = t / d
    n = sweep(rng.standard_normal(len(t)), 300, 9000, 'band', 0.5) * x ** 2 * 1.4
    f = f0 * (f1 / f0) ** (x ** 1.6)
    s = sum(saw(osc_phase(f * (1 + dt), len(t))) for dt in (-0.01, 0, 0.012)) / 3
    s = filt(s, 4000) * x ** 2.2 * 0.5
    return n + s


def crash(d=2.8):
    t = tt(d)
    n = filt(rng.standard_normal(len(t)), 4000, 'high')
    metal = sum(np.sin(2 * np.pi * f * t + rng.random() * 6) for f in (3120, 4270, 5930, 7310, 8870)) / 5
    return (n * 0.8 + metal * 0.35) * np.exp(-t * 1.9)


def ping(freq, d=1.2):
    t = tt(d)
    return (np.sin(2 * np.pi * freq * t) * np.exp(-t * 5) + 0.35 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t * 11)
            + 0.15 * np.sin(2 * np.pi * freq * 5.4 * t) * np.exp(-t * 20))


def tick(freq=3000, d=0.03):
    t = tt(d)
    return np.sin(2 * np.pi * freq * t) * np.exp(-t * 140)


def blip(f0, f1, d=0.09):
    t = tt(d)
    f = f0 * (f1 / f0) ** (t / d)
    return np.sin(2 * np.pi * osc_phase(f, len(t))) * np.sin(np.pi * t / d) ** 0.5


def glitch(d):
    t = tt(d)
    out = np.zeros(len(t))
    seg = int(0.018 * SR)
    for i in range(0, len(t), seg):
        f = rng.choice([220, 440, 880, 1760, 3520, 110]) * (1 + rng.random() * 0.05)
        kind = rng.integers(3)
        tt_ = t[i:i + seg] - t[i]
        if kind == 0:
            s = np.sign(np.sin(2 * np.pi * f * tt_))
        elif kind == 1:
            s = rng.standard_normal(len(tt_))
        else:
            s = saw(f * tt_)
        out[i:i + seg] = np.round(s * 4) / 4 * (0.4 + 0.6 * rng.random())
    return filt(out, 9000) * 0.5


def shimmer(d, density=70, notes=('A6', 'C7', 'D7', 'E7', 'G7', 'A7')):
    t = tt(d)
    L = np.zeros(len(t))
    R = np.zeros(len(t))
    for _ in range(density):
        o = rng.random() * d * 0.92
        f = note(rng.choice(notes)) * (1 + (rng.random() - .5) * 0.004)
        g = tt(0.25)
        s = np.sin(2 * np.pi * f * g) * np.exp(-g * 18) * (0.3 + 0.7 * rng.random())
        i0 = int(o * SR)
        n = min(len(s), len(t) - i0)
        p = rng.random()
        L[i0:i0 + n] += s[:n] * np.sqrt(1 - p)
        R[i0:i0 + n] += s[:n] * np.sqrt(p)
    env = np.sin(np.pi * t / d) ** 0.7
    return np.stack([L * env, R * env]) * 0.25


# ---------------------------------------------------------------- arrangement
CH = {
    'Am': ['A3', 'C4', 'E4'], 'F': ['F3', 'A3', 'C4'], 'C': ['C4', 'E4', 'G4'], 'G': ['G3', 'B3', 'D4'],
}
ROOT = {'Am': 'A1', 'F': 'F1', 'C': 'C2', 'G': 'G1'}
bar_chord = ['Am', 'Am', 'F', 'C', 'Am', 'F', 'G', 'Am']
kick_times = []

# pads
place(music, pad([note(n) for n in CH['Am']], BAR + 0.3, bright=700, att=1.2), 0, 0.5, rev=0.4)
for b in (1, 2):
    place(music, pad([note(n) for n in CH[bar_chord[b]]], BAR + 0.2, bright=1100), b * BAR, 0.35, rev=0.3)
place(music, pad([note(n) for n in CH['C']] + [note('G2')], 2 * B + 0.3, bright=1600, att=0.3), 3 * BAR, 0.6, rev=0.5)
place(music, pad([note(n) for n in CH['G']] + [note('D5')], 2 * B, bright=2400, att=0.2, rel=0.05), 3 * BAR + 2 * B, 0.65, rev=0.5)
for b in (4, 5, 6):
    place(music, pad([note(n) for n in CH[bar_chord[b]]], BAR + 0.1, bright=1800), b * BAR, 0.4, rev=0.3)

# drums + bass
for b in (1, 2, 4, 5, 6):
    t0 = b * BAR
    chord = bar_chord[b]
    for k in range(4):
        tk = t0 + k * B
        if b == 6 and tk >= 12.95:
            continue
        kick_times.append(tk)
        place(drums, kick(), tk, 1.0)
        if k in (1, 3):
            place(drums, clap(), tk, 0.55, rev=0.25)
    for s16 in range(16):
        ts = t0 + s16 * B / 4
        if ts >= 12.95:
            continue
        if b >= 2 and s16 % 2 == 1:
            place(drums, hat(), ts, 0.16 if s16 % 4 == 3 else 0.1, pan=0.3)
        if b == 1 and s16 % 4 == 2:
            place(drums, hat(), ts, 0.14, pan=0.3)
        if b >= 4 and s16 % 4 == 2:
            place(drums, hat(True), ts, 0.13, pan=-0.25)
    root = note(ROOT[chord])
    if b in (1, 2):
        for k in range(4):
            place(music, bass(root * (2 if k == 3 else 1), B / 2 - 0.01), t0 + k * B + B / 2, 0.55)
    else:
        for s16 in range(16):
            ts = t0 + s16 * B / 4
            if s16 % 4 == 0 or ts >= 12.95:
                continue
            mult = 2 if s16 in (7, 14) else 1
            place(music, bass(root * mult, B / 4 - 0.006), ts, 0.5)

# arps (16ths through the chord, two octaves)
for b in (2, 4, 5, 6):
    tones = [note(n) * 2 for n in CH[bar_chord[b]]]
    seq = [tones[0], tones[1], tones[2], tones[0] * 2, tones[2], tones[1] * 2, tones[2] * 2, tones[1]]
    for s16 in range(16):
        ts = b * BAR + s16 * B / 4
        if ts >= 12.95:
            continue
        place(music, pluck(seq[s16 % 8], bright=0.4 + 0.6 * (s16 % 4 == 0)), ts, 0.13 if b == 2 else 0.1,
              pan=0.45 * np.sin(s16 * 1.3), rev=0.35)

# ---------------------------------------------------------------- sound design, synced to picture
# ACT 0 — the dot
t = tt(0.43)
fall = np.sin(2 * np.pi * osc_phase(1400 * (240 / 1400) ** (t / 0.43), len(t))) * (t / 0.43) ** 2 * 0.12
place(sfx, fall, 0.04)
place(drums, kick(0.6, 1.2), B, 1.0)
kick_times.append(B)
place(sfx, ping(note('E6')), B, 0.35, rev=0.8)
for i in range(6):
    place(sfx, tick(2500 + 1500 * rng.random(), 0.02), B + 0.05 + 0.12 * rng.random(), 0.08, pan=rng.random() * 2 - 1)
place(sfx, whoosh(0.28, 700, 7000, 'arc'), 0.9, 0.35)                    # snap into the timeline
for i in range(9):
    place(sfx, tick(4200, 0.02), 0.98 + i * 0.03, 0.06, pan=-0.8 + i * 0.2)  # keyframes pop


def inv_inoutcubic(y):
    lo, hi = 0.0, 1.0
    for _ in range(40):
        m = (lo + hi) / 2
        v = 4 * m ** 3 if m < .5 else 1 - (-2 * m + 2) ** 3 / 2
        lo, hi = (m, hi) if v < y else (lo, m)
    return lo


penta = ['A5', 'C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'D7', 'E7']
for i in range(9):  # playhead crossing each keyframe: pitched ticks
    tp = 1.0 + inv_inoutcubic((0.02 + 0.1 * i) / 0.84) * 0.38
    place(sfx, ping(note(penta[i]), 0.25), tp, 0.09, pan=-0.8 + i * 0.2, rev=0.3)
place(sfx, whoosh(0.47, 180, 5000, 'rise'), 1.40, 0.45, rev=0.2)
place(sfx, crash(0.5)[::-1] * np.linspace(0, 1, int(0.5 * SR)) ** 2, BAR - 0.5, 0.25)

# ACT 1 — one slam per word
for k in range(4):
    tk = BAR + k * B
    place(sfx, boom(0.35) * 0.5, tk, 0.5)
    place(sfx, filt(rng.standard_normal(int(0.12 * SR)), 3000) * np.exp(-tt(0.12) * 30), tk, 0.25, rev=0.3)
place(sfx, whoosh(0.3, 5000, 300, 'fall'), BAR + B, 0.35)                 # FRAME blur-zoom
t = tt(0.26)
place(sfx, np.sin(2 * np.pi * osc_phase(600 * 4 ** (t / 0.26), len(t))) * 0.25 * np.sin(np.pi * t / 0.26), BAR + B + 0.04, 0.4)  # box draw
for i in range(8):
    place(sfx, tick(5000, 0.015), BAR + B + 0.22 + i * 0.012, 0.07)
place(sfx, ping(note('A5'), 0.9), BAR + 2 * B, 0.3, rev=0.6)             # "on"
place(sfx, whoosh(0.22, 400, 2500, 'arc'), BAR + 2 * B - 0.02, 0.4, pan=-0.4)
for k in range(3):                                                         # PURPOSE slices
    place(sfx, whoosh(0.2, 3000, 800, 'fall'), BAR + 3 * B + k * 0.04, 0.35, pan=(-0.6, 0.6, -0.6)[k])
place(sfx, blip(380, 950, 0.08), BAR + 3 * B + 0.09, 0.4)                 # the period pops
place(sfx, whoosh(0.28, 200, 6000, 'rise'), 3.47, 0.5, rev=0.3)           # iris

# ACT 2 — grid waves
for k in range(4):
    place(sfx, whoosh(0.4, 2500, 9000, 'fall', 0.5), 2 * BAR + k * B, 0.12, pan=0.0)
t = tt(0.46)                                                               # implosion: suck-in
place(sfx, sweep(rng.standard_normal(len(t)), 8000, 200, 'band', 0.8) * (t / 0.46) ** 3 * 2.2, 5.14, 0.55)
place(sfx, np.sin(2 * np.pi * osc_phase(200 * 5 ** (t / 0.46), len(t))) * (t / 0.46) ** 3 * 0.25, 5.14, 1)

# ACT 3 — the blob & the build
t = tt(1.0)
place(sfx, np.sin(2 * np.pi * osc_phase(90 * (45 / 90) ** t, len(t))) * np.exp(-t * 3) * 0.9, 3 * BAR, 0.8, rev=0.3)
place(sfx, whoosh(0.7, 150, 900, 'fall'), 3 * BAR, 0.45, rev=0.4)
for k in (1, 2, 3):
    tp = 3 * BAR + k * B
    t = tt(0.4)
    place(drums, np.sin(2 * np.pi * 52 * t) * np.exp(-t * 9) * np.minimum(1, t / 0.005), tp, 0.7)
place(sfx, riser(1.6), 5.9, 0.95, rev=0.3)
roll = []
tr = 6.5625
while tr < 7.47:
    roll.append(tr)
    tr += B / 2 if tr < 7.03 else (B / 4 if tr < 7.27 else B / 8)
for i, tr in enumerate(roll):
    place(drums, snare(0.2, 0.25 + 0.75 * (i / len(roll)) ** 1.5), tr, 0.75, rev=0.2)
place(sfx, crash(0.9)[::-1] * np.linspace(0, 1, int(0.9 * SR)) ** 3, 7.5 - 0.9, 0.35)

# ACT 4 — THE DROP
T = 4 * BAR
place(sfx, boom(), T, 1.1, rev=0.2)
place(sfx, crash(), T, 0.5, rev=0.4)
place(sfx, stab([note(n) for n in ('A2', 'E3', 'A3', 'C4', 'E4', 'A4')], 1.8), T, 0.8, rev=0.5)
place(sfx, whoosh(0.9, 6000, 150, 'fall', 1.2), T, 0.6)
place(sfx, shimmer(1.1, 90), 7.85, 0.6, rev=0.6)
place(sfx, whoosh(0.3, 800, 6000, 'arc'), 8.5, 0.25)
for i in range(12):
    place(sfx, tick(1800 + 300 * (i % 4), 0.018), 8.55 + i * 0.025, 0.08, pan=-0.5 + i / 12)

# ACT 5 — systems
for k in range(4):
    place(sfx, whoosh(0.3, 400, 3000, 'arc'), 9.22 + k * 0.05, 0.28, pan=(-0.7, 0.7, -0.4, 0.4)[k])
for tf in (9.55, 10.02, 10.49, 10.96):
    place(sfx, tick(1400, 0.02), tf, 0.35)
    place(sfx, tick(2600, 0.02), tf + 0.05, 0.25)
place(sfx, tick(900, 0.03), 10.26, 0.6)
place(sfx, ping(note('E6'), 0.5), 10.34, 0.22, rev=0.5)
place(sfx, ping(note('A6'), 0.8), 10.42, 0.22, rev=0.5)
place(sfx, whoosh(0.45, 300, 2000, 'arc'), 10.08, 0.35)
place(sfx, whoosh(0.45, 200, 4000, 'rise'), 10.78, 0.45)
place(sfx, whoosh(0.4, 3000, 200, 'fall', 1.2), 11.15, 0.55, rev=0.2)

# ACT 6 — velocity
place(sfx, crash(1.4), 6 * BAR, 0.3, rev=0.3)
for k in range(4):
    tk = 6 * BAR + k * B
    place(sfx, boom(0.35) * 0.5, tk, 0.45)
    t = tt(0.4)
    place(sfx, np.sin(2 * np.pi * osc_phase(1200 * (150 / 1200) ** (t / 0.4), len(t))) * np.sin(np.pi * t / 0.4) * 0.2, tk + 0.1, 1, pan=(k % 2) * 1.2 - 0.6)
place(sfx, riser(1.0, 300, 2400), 11.95, 0.5)
roll = []
tr = 6 * BAR + 2 * B
while tr < 12.93:
    roll.append(tr)
    tr += B / 4 if tr < 12.66 else B / 8
for i, tr in enumerate(roll):
    place(drums, snare(0.15, 0.3 + 0.7 * i / len(roll)), tr, 0.45)
for a, b in ((3.66, 3.78), (7.42, 7.5), (11.12, 11.3), (11.7, 11.76), (12.17, 12.23), (12.62, 12.72), (12.88, 12.95)):
    place(sfx, glitch(b - a), a, 0.35)

# ACT 7 — final hit
T = 7 * BAR
place(drums, kick(0.8, 1.3), T, 1.0)
place(sfx, boom(), T, 1.1, rev=0.25)
place(sfx, crash(3.0), T, 0.45, rev=0.5)
place(sfx, stab([note(n) for n in ('A2', 'E3', 'B3', 'C4', 'E4', 'A4', 'B4')], 2.2), T, 0.85, rev=0.7)
place(music, pad([note(n) for n in ('A3', 'C4', 'E4', 'B4')], 15 - T, bright=1600, att=0.05, rel=1.4), T, 0.35, rev=0.6)
for i, n in enumerate(['A5', 'C6', 'E6', 'E6', 'C6', 'A5']):  # letters land
    place(sfx, pluck(note(n) * 2, 0.2, 0.3), T + 0.14 + abs(i - 2.5) * 0.035, 0.12, pan=-0.7 + i * 0.28, rev=0.5)
place(sfx, whoosh(0.4, 500, 2500, 'arc'), T + 0.34, 0.18)
for i in range(10):
    place(sfx, tick(2200 + 200 * (i % 3), 0.016), T + 0.45 + i * 0.04, 0.05)
place(sfx, whoosh(0.55, 2000, 10000, 'arc', 0.5), 13.95, 0.25, rev=0.4)
place(sfx, ping(note('A6'), 0.9), 14.2, 0.15, rev=0.7)
place(sfx, blip(700, 1400, 0.1), 14.86, 0.3, rev=0.4)

# ---------------------------------------------------------------- mix
tn = np.arange(N) / SR
sc = np.ones(N)
for k in kick_times:
    m = tn >= k
    sc[m] = np.minimum(sc[m], 1 - 0.75 * np.exp(-(tn[m] - k) * 11))
mix_ = music * sc + drums + sfx

ir_t = tt(2.2)
ir = np.stack([filt(rng.standard_normal(len(ir_t)), 6000) * np.exp(-ir_t * 3.2) for _ in range(2)])
ir[:, :int(0.012 * SR)] = 0
wet = np.stack([fftconvolve(send[c], ir[c])[:N] for c in range(2)])
wet /= np.max(np.abs(wet)) + 1e-9
mix_ = mix_ + wet * 0.12 * np.max(np.abs(mix_))

# the breath before the final hit: hard silence 12.95 -> 13.125
gate = np.ones(N)
a, b = int(12.955 * SR), int(13.12 * SR)
gate[a:b] = 0
r = int(0.004 * SR)
gate[a - r:a] = np.linspace(1, 0, r)
mix_ *= gate
mix_[:, -int(0.03 * SR):] *= np.linspace(1, 0, int(0.03 * SR))

mix_ = filt(mix_, 25, 'high')
peak = np.max(np.abs(mix_))
mix_ = np.tanh(mix_ / peak * 1.6) / np.tanh(1.6)
mix_ *= 10 ** (-1 / 20) / np.max(np.abs(mix_))

pcm = (mix_.T * 32767).astype('<i2')
with wave.open('soundtrack.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('soundtrack.wav', pcm.shape[0] / SR, 's')
