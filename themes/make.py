#!/usr/bin/env python3
"""Draw each theme's wallpapers (wallpaper.svg for a phone, wallpaper-wide.svg
for a computer's screen) from its colors.toml, in the style its theme.toml
names. Run it after changing a theme's colors or a style:

    python3 themes/make.py [theme...]

They stand in for Omarchy's own wallpapers until a host has downloaded them
(see CREDITS and backgrounds.py), or if it can't. The same theme always draws
the same picture: the randomness is seeded with its name."""
import math
import random
import sys
import tomllib
from pathlib import Path

HERE = Path(__file__).resolve().parent
SIZES = {"wallpaper.svg": (1290, 2796), "wallpaper-wide.svg": (2880, 1800)}


# ---- colors

def rgb(hx):
    hx = hx.strip().lstrip("#")
    return tuple(int(hx[i:i + 2], 16) for i in (0, 2, 4))


def hexc(c):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(x))) for x in c)


def mix(a, b, t):
    """a toward b by t (0..1), as hex."""
    a, b = rgb(a), rgb(b)
    return hexc(tuple(x + (y - x) * t for x, y in zip(a, b)))


def light(c):
    return sum(rgb(c)) / 3 > 140


def palette(theme):
    """The colors a wallpaper uses, with Omarchy's fallbacks."""
    c = tomllib.loads((theme / "colors.toml").read_text())
    p = {k: v for k, v in c.items() if isinstance(v, str) and v.startswith("#")}
    p.setdefault("background", c.get("color0", "#1a1b26"))
    p.setdefault("foreground", c.get("color7", "#a9b1d6"))
    for k, n in (("red", 1), ("green", 2), ("yellow", 3), ("blue", 4), ("magenta", 5), ("cyan", 6)):
        p.setdefault(k, c.get(f"color{n}", p["foreground"]))
    p.setdefault("accent", p["blue"])
    p.setdefault("orange", p["yellow"])
    p["mode"] = c.get("mode") or ("light" if light(p["background"]) else "dark")
    return p


# ---- SVG

class Svg:
    def __init__(self, w, h):
        self.w, self.h, self.defs, self.body, self.n = w, h, [], [], 0
        self.m = min(w, h)
        self.span = w / max(w, h) if h > w else 1.0     # a phone's: the middle of a wide one

    def id(self, kind):
        self.n += 1
        return f"{kind}{self.n}"

    def radial(self, stops, cx=0.5, cy=0.5, r=0.5, fx=None, fy=None):
        gid = self.id("r")
        focus = f' fx="{fx}" fy="{fy}"' if fx is not None else ""
        self.defs.append(f'<radialGradient id="{gid}" cx="{cx}" cy="{cy}" r="{r}"{focus}>'
                         + "".join(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a}"/>' for o, c, a in stops)
                         + "</radialGradient>")
        return f"url(#{gid})"

    def linear(self, stops, x1=0, y1=0, x2=0, y2=1):
        gid = self.id("l")
        self.defs.append(f'<linearGradient id="{gid}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">'
                         + "".join(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a}"/>' for o, c, a in stops)
                         + "</linearGradient>")
        return f"url(#{gid})"

    def add(self, s):
        self.body.append(s)

    def rect(self, fill, **kw):
        extra = "".join(f' {k.replace("_", "-")}="{v}"' for k, v in kw.items())
        self.add(f'<rect width="{self.w}" height="{self.h}" fill="{fill}"{extra}/>')

    def __str__(self):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
                f'width="{self.w}" height="{self.h}" preserveAspectRatio="xMidYMid slice">'
                f'<defs>{"".join(self.defs)}</defs>{"".join(self.body)}</svg>\n')


def path(points, close=True):
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in points)
    return d + (" Z" if close else "")


def smooth(points, close=False):
    """A curve through the points (Catmull-Rom, as cubic Béziers)."""
    pts = points
    d = f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"
    for i in range(len(pts) - 1):
        p0 = pts[i - 1] if i else pts[0]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[i + 2] if i + 2 < len(pts) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}"
    return d + (" Z" if close else "")


def noise(rng, n, rough, octaves=5, span=1.0):
    """n heights in -1..1, smooth at large scale and rough at small: a sum of
    sines with random phases. span: how much of a wide screen's width the n
    points cover, so a phone's narrower picture isn't squeezed into spikes."""
    waves = [(2 ** o * rng.uniform(0.8, 1.3), rng.uniform(0, 2 * math.pi), rough ** o) for o in range(octaves)]
    total = sum(a for _, _, a in waves)
    return [sum(a * math.sin(f * math.pi * (0.5 - span / 2 + span * i / (n - 1)) * 2 + ph) for f, ph, a in waves) / total
            for i in range(n)]


def vignette(s, p, strength=0.55):
    edge = mix(p["background"], "#000000", 0.35) if p["mode"] == "dark" else mix(p["background"], p["foreground"], 0.08)
    s.rect(s.radial([(0.55, edge, 0), (1, edge, strength)], r=0.75))


def stars(s, rng, p, count, top, bottom, color=None):
    color = color or (p["foreground"] if p["mode"] == "dark" else p["accent"])
    for _ in range(count):
        x, y = rng.uniform(0, s.w), rng.uniform(top, bottom)
        r = rng.choice((0.8, 1, 1.2, 1.5, 1.8, 2.4)) * s.m / 1290
        s.add(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r:.2f}" fill="{color}" opacity="{rng.uniform(0.25, 0.9):.2f}"/>')


# ---- styles

def aurora(s, p, rng):
    """Soft lights over the background: big glows in the theme's colors, and
    ribbons of light across them."""
    bg = p["background"]
    dark = p["mode"] == "dark"
    s.rect(s.linear([(0, mix(bg, "#000000", 0.25) if dark else bg, 1), (1, bg, 1)]))
    colors = [p["accent"], p["magenta"], p["cyan"], p["blue"], p["green"]]
    seen = []
    for c in colors:
        if all(sum(abs(a - b) for a, b in zip(rgb(c), rgb(o))) > 60 for o in seen):
            seen.append(c)
    spots = [(0.2, 0.15), (0.85, 0.35), (0.3, 0.7), (0.75, 0.9), (0.55, 0.5)]
    rng.shuffle(spots)
    big = max(s.w, s.h)
    for c, (x, y) in zip(seen, spots):
        r = big * rng.uniform(0.38, 0.55)
        a = 0.55 if dark else 0.42
        fill = s.radial([(0, c, a), (0.45, c, a * 0.35), (1, c, 0)])
        s.add(f'<circle cx="{x * s.w + rng.uniform(-0.05, 0.05) * s.w:.0f}" cy="{y * s.h:.0f}" r="{r:.0f}" fill="{fill}"/>')
    for i, c in enumerate(seen[:3]):
        y0 = s.h * (0.25 + 0.22 * i + rng.uniform(-0.05, 0.05))
        pts = [(x, y0 + n * s.h * 0.12) for x, n in
               zip([s.w * (k / 8 * 1.4 - 0.2) for k in range(9)], noise(rng, 9, 0.5, 3, span=s.span))]
        stroke = s.linear([(0, c, 0), (0.5, c, 0.22 if dark else 0.16), (1, c, 0)], x2=1, y2=0)
        s.add(f'<path d="{smooth(pts)}" fill="none" stroke="{stroke}" stroke-width="{s.m * 0.11:.0f}" '
              f'stroke-linecap="round"/>')
        s.add(f'<path d="{smooth(pts)}" fill="none" stroke="{stroke}" stroke-width="{s.m * 0.02:.0f}" '
              f'stroke-linecap="round"/>')
    if dark:
        stars(s, rng, p, 60, 0, s.h)
    vignette(s, p, 0.45 if dark else 0.3)


def orb(s, p, rng):
    """One sphere of the accent in a quiet room, its rings around it."""
    bg, fg, accent = p["background"], p["foreground"], p["accent"]
    dark = p["mode"] == "dark"
    s.rect(s.linear([(0, bg, 1), (1, mix(bg, fg, 0.06), 1)]))
    cx, cy = s.w * 0.5, s.h * (0.4 if s.h > s.w else 0.46)
    r = s.m * 0.27
    for k in range(1, 9):
        rr = r * (1 + k * 0.32)
        s.add(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{rr:.0f}" fill="none" stroke="{fg}" '
              f'stroke-opacity="{0.09 - k * 0.008:.3f}" stroke-width="{s.m * 0.0025:.1f}"/>')
    glow = s.radial([(0, accent, 0.28), (1, accent, 0)])
    s.add(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{r * 2.2:.0f}" fill="{glow}"/>')
    shade = s.radial([(0, fg, 0.16), (1, fg, 0)])
    s.add(f'<ellipse cx="{cx:.0f}" cy="{cy + r * 1.18:.0f}" rx="{r * 0.95:.0f}" ry="{r * 0.16:.0f}" fill="{shade}"/>')
    hi = mix(accent, "#ffffff", 0.55)
    lo = mix(accent, fg if not dark else "#000000", 0.45)
    ball = s.radial([(0, hi, 1), (0.55, accent, 1), (1, lo, 1)], cx=0.5, cy=0.5, r=0.62, fx=0.36, fy=0.3)
    s.add(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{r:.0f}" fill="{ball}"/>')
    # A small moon of the second color.
    second = p["magenta"] if p["magenta"] != accent else p["cyan"]
    mx, my, mr = cx + r * 1.55, cy - r * 1.1, r * 0.16
    moon = s.radial([(0, mix(second, "#ffffff", 0.5), 1), (1, second, 1)], fx=0.35, fy=0.3)
    s.add(f'<circle cx="{mx:.0f}" cy="{my:.0f}" r="{mr:.0f}" fill="{moon}"/>')
    vignette(s, p, 0.25)


def ridges(s, p, rng):
    """Mountain ridges going back into haze, under a low sun or moon."""
    bg, fg, accent = p["background"], p["foreground"], p["accent"]
    dark = p["mode"] == "dark"
    horizon = s.h * (0.5 if s.h > s.w else 0.45)
    sky_top = mix(bg, "#000000", 0.3) if dark else bg
    haze = mix(bg, accent, 0.45)
    s.rect(s.linear([(0, sky_top, 1), (horizon / s.h, haze, 1), (1, bg, 1)]))
    sun = p["yellow"] if dark else p["orange"]
    sx, sy, sr = s.w * 0.68, horizon - s.h * 0.12, s.m * 0.075
    s.add(f'<circle cx="{sx:.0f}" cy="{sy:.0f}" r="{sr * 6:.0f}" fill="{s.radial([(0, sun, 0.35), (1, sun, 0)])}"/>')
    s.add(f'<circle cx="{sx:.0f}" cy="{sy:.0f}" r="{sr:.0f}" fill="{mix(sun, "#ffffff", 0.35)}"/>')
    if dark:
        stars(s, rng, p, 90, 0, horizon * 0.8)
    layers = 6
    near = mix(bg, "#000000", 0.45) if dark else mix(bg, fg, 0.25)
    for i in range(layers):
        t = i / (layers - 1)
        base = horizon + (s.h - horizon) * (0.02 + 0.8 * t ** 1.3)
        amp = s.h * (0.07 + 0.05 * (1 - t)) * (1.25 if s.h > s.w else 1)
        n = 140
        hs = noise(rng, n, 0.55, 6, span=s.span)
        pts = [(s.w * k / (n - 1), base - amp * (0.6 + v)) for k, v in enumerate(hs)]
        pts += [(s.w, s.h), (0, s.h)]
        color = mix(mix(haze, bg, 0.25), near, t ** 0.8)
        s.add(f'<path d="{path(pts)}" fill="{color}"/>')
        # A mist in the valleys behind the next ridge.
        if i < layers - 1:
            mist = s.linear([(0, haze, 0), (1, haze, 0.18 * (1 - t))])
            s.add(f'<rect x="0" y="{base - amp:.0f}" width="{s.w}" height="{amp * 1.6:.0f}" fill="{mist}"/>')
    vignette(s, p, 0.35)


def waves(s, p, rng):
    """Rolling waves under a pale moon, their crests caught in light."""
    bg, fg = p["background"], p["foreground"]
    blue, cyan, accent = p["blue"], p["cyan"], p["accent"]
    horizon = s.h * (0.42 if s.h > s.w else 0.38)
    s.rect(s.linear([(0, mix(bg, "#000000", 0.3), 1), (horizon / s.h, mix(bg, blue, 0.3), 1), (1, bg, 1)]))
    stars(s, rng, p, 70, 0, horizon * 0.85)
    mx, my, mr = s.w * 0.3, horizon * 0.48, s.m * 0.11
    moon = mix(accent if light(accent) else fg, "#ffffff", 0.15)
    s.add(f'<circle cx="{mx:.0f}" cy="{my:.0f}" r="{mr * 4:.0f}" fill="{s.radial([(0, moon, 0.25), (1, moon, 0)])}"/>')
    s.add(f'<circle cx="{mx:.0f}" cy="{my:.0f}" r="{mr:.0f}" fill="{moon}" opacity="0.92"/>')
    rows = 9
    for i in range(rows):
        t = i / (rows - 1)
        base = horizon + (s.h - horizon) * (t ** 1.25) * 0.95
        amp = s.m * (0.02 + 0.07 * t)
        n = 90
        hs = noise(rng, n, 0.6, 5, span=s.span)
        pts = [(s.w * (k / (n - 1) * 1.1 - 0.05), base - amp * v) for k, v in enumerate(hs)]
        body = mix(mix(bg, blue if i % 2 else cyan, 0.55 - 0.35 * t), "#000000", 0.25 * t)
        fill = s.linear([(0, body, 1), (1, mix(body, bg, 0.6), 1)])
        s.add(f'<path d="{smooth(pts)} L{s.w * 1.05:.0f},{s.h} L{-s.w * 0.05:.0f},{s.h} Z" fill="{fill}"/>')
        s.add(f'<path d="{smooth(pts)}" fill="none" stroke="{fg}" stroke-opacity="{0.12 + 0.2 * (1 - t):.2f}" '
              f'stroke-width="{s.m * (0.002 + 0.004 * t):.1f}"/>')
    vignette(s, p, 0.4)


def synth(s, p, rng):
    """A striped sun going down behind a grid that runs to the horizon."""
    bg, accent = p["background"], p["accent"]
    hot, warm = (p["red"], p["yellow"]) if p["red"] != p["green"] else (p["cyan"], p["accent"])
    if sum(rgb(p["green"])) > sum(rgb(p["red"])) and rgb(accent)[1] > rgb(accent)[0]:
        hot, warm = p["cyan"], accent          # a green theme: a green sun
    horizon = s.h * (0.56 if s.h > s.w else 0.6)
    s.rect(s.linear([(0, mix(bg, "#000000", 0.4), 1), (horizon / s.h * 0.9, mix(bg, hot, 0.28), 1),
                     (horizon / s.h, mix(bg, warm, 0.4), 1), (horizon / s.h + 0.001, mix(bg, "#000000", 0.35), 1),
                     (1, mix(bg, "#000000", 0.2), 1)]))
    stars(s, rng, p, 110, 0, horizon * 0.75)
    cx, r = s.w / 2, s.m * 0.3
    cy = horizon - r * 0.35
    s.add(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{r * 2.2:.0f}" fill="{s.radial([(0, warm, 0.35), (1, warm, 0)])}"/>')
    mask = s.id("m")
    bands = []
    for k in range(7):
        y = cy - r * (0.3 - k * 0.1)
        bands.append(f'<rect x="{cx - r:.0f}" y="{y:.0f}" width="{2 * r:.0f}" height="{r * (0.014 + k * 0.009):.1f}" fill="#000"/>')
    s.defs.append(f'<mask id="{mask}"><rect width="{s.w}" height="{s.h}" fill="#fff"/>{"".join(bands)}'
                  f'<rect x="0" y="{horizon:.0f}" width="{s.w}" height="{s.h}" fill="#000"/></mask>')
    sun = s.linear([(0, mix(warm, "#ffffff", 0.25), 1), (1, hot, 1)])
    s.add(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{r:.0f}" fill="{sun}" mask="url(#{mask})"/>')
    line = accent
    w = s.m * 0.003
    glow = s.linear([(0, line, 0.55), (1, line, 0)])
    s.add(f'<rect x="0" y="{horizon - s.m * 0.004:.0f}" width="{s.w}" height="{s.m * 0.05:.0f}" fill="{glow}"/>')
    rows = 16
    for k in range(1, rows):
        y = horizon + (s.h - horizon) * (k / rows) ** 2.2
        s.add(f'<line x1="0" y1="{y:.1f}" x2="{s.w}" y2="{y:.1f}" stroke="{line}" '
              f'stroke-opacity="{0.25 + 0.5 * k / rows:.2f}" stroke-width="{w * (0.6 + k / rows):.1f}"/>')
    spread = 26
    for k in range(-spread, spread + 1):
        x = cx + k * s.m * 0.16
        s.add(f'<line x1="{cx + k * s.m * 0.012:.1f}" y1="{horizon:.0f}" x2="{x:.1f}" y2="{s.h}" stroke="{line}" '
              f'stroke-opacity="0.55" stroke-width="{w:.1f}"/>')
    fade = s.linear([(0, mix(bg, "#000000", 0.35), 0.85), (0.35, mix(bg, "#000000", 0.35), 0)])
    s.add(f'<rect x="0" y="{horizon:.0f}" width="{s.w}" height="{s.h - horizon:.0f}" fill="{fade}"/>')
    vignette(s, p, 0.35)


def dunes(s, p, rng):
    """Smooth dunes in warm light, one over the other."""
    bg, fg, accent = p["background"], p["foreground"], p["accent"]
    warm = p["orange"]
    s.rect(s.linear([(0, mix(bg, "#000000", 0.2), 1), (0.45, mix(bg, warm, 0.22), 1), (1, bg, 1)]))
    sx, sy, sr = s.w * 0.3, s.h * (0.3 if s.h > s.w else 0.28), s.m * 0.14
    s.add(f'<circle cx="{sx:.0f}" cy="{sy:.0f}" r="{sr * 4:.0f}" fill="{s.radial([(0, warm, 0.3), (1, warm, 0)])}"/>')
    s.add(f'<circle cx="{sx:.0f}" cy="{sy:.0f}" r="{sr:.0f}" fill="{mix(accent, fg, 0.3)}" opacity="0.9"/>')
    layers = 6
    for i in range(layers):
        t = i / (layers - 1)
        base = s.h * (0.42 + 0.5 * t ** 1.1)
        n = 7
        hs = noise(rng, n, 0.5, 2, span=s.span)
        pts = [(s.w * (k / (n - 1) * 1.3 - 0.15), base + s.h * 0.08 * v) for k, v in enumerate(hs)]
        top = mix(mix(bg, accent, 0.5 - 0.3 * t), fg, 0.12 * (1 - t))
        bottom = mix(bg, "#000000", 0.2 + 0.25 * t)
        fill = s.linear([(0, top, 1), (0.6, bottom, 1)])
        s.add(f'<path d="{smooth(pts)} L{s.w * 1.15:.0f},{s.h} L{-s.w * 0.15:.0f},{s.h} Z" fill="{fill}"/>')
        s.add(f'<path d="{smooth(pts)}" fill="none" stroke="{mix(accent, fg, 0.4)}" stroke-opacity="{0.35 * (1 - t) + 0.1:.2f}" '
              f'stroke-width="{s.m * 0.003:.1f}"/>')
    vignette(s, p, 0.4)


def contours(s, p, rng):
    """A topographic map: hills drawn in fine lines, one of them in the accent."""
    bg, fg, accent = p["background"], p["foreground"], p["accent"]
    s.rect(s.linear([(0, bg, 1), (1, mix(bg, "#000000" if p["mode"] == "dark" else fg, 0.08), 1)]))
    big = math.hypot(s.w, s.h)
    hills = [(s.w * rng.uniform(0.25, 0.45), s.h * rng.uniform(0.25, 0.4)),
             (s.w * rng.uniform(0.6, 0.85), s.h * rng.uniform(0.6, 0.8))]
    s.add(f'<circle cx="{hills[0][0]:.0f}" cy="{hills[0][1]:.0f}" r="{s.m * 0.7:.0f}" '
          f'fill="{s.radial([(0, accent, 0.14), (1, accent, 0)])}"/>')
    pick = rng.randrange(4, 9)
    for h_i, (cx, cy) in enumerate(hills):
        phases = [rng.uniform(0, 2 * math.pi) for _ in range(4)]
        rings = 34 if h_i == 0 else 22
        for k in range(1, rings):
            r = big * 0.022 * k * (1.0 if h_i == 0 else 0.8)
            pts = []
            for j in range(96):
                a = 2 * math.pi * j / 96
                wob = (1 + 0.13 * math.sin(3 * a + phases[0] + k * 0.08) + 0.07 * math.sin(5 * a + phases[1] - k * 0.05)
                       + 0.04 * math.sin(2 * a + phases[2]) + 0.025 * math.sin(7 * a + phases[3] + k * 0.11))
                pts.append((cx + math.cos(a) * r * wob, cy + math.sin(a) * r * wob))
            pts.append(pts[0])
            if h_i == 0 and k == pick:
                s.add(f'<path d="{smooth(pts, True)}" fill="none" stroke="{accent}" stroke-opacity="0.8" '
                      f'stroke-width="{s.m * 0.003:.1f}"/>')
            else:
                major = k % 5 == 0
                s.add(f'<path d="{smooth(pts, True)}" fill="none" stroke="{fg}" '
                      f'stroke-opacity="{0.2 if major else 0.09}" stroke-width="{s.m * (0.0022 if major else 0.0014):.1f}"/>')
    vignette(s, p, 0.5)


def starfield(s, p, rng):
    """Deep space: stars, and the edge of a planet with the light on its rim."""
    bg, fg, accent = p["background"], p["foreground"], p["accent"]
    s.rect(s.linear([(0, mix(bg, "#000000", 0.45), 1), (1, bg, 1)]))
    neb = p["blue"] if p["blue"] != accent else p["magenta"]
    s.add(f'<ellipse cx="{s.w * 0.7:.0f}" cy="{s.h * 0.3:.0f}" rx="{s.m * 0.9:.0f}" ry="{s.m * 0.45:.0f}" '
          f'fill="{s.radial([(0, neb, 0.16), (1, neb, 0)])}" transform="rotate(-25 {s.w * 0.7:.0f} {s.h * 0.3:.0f})"/>')
    stars(s, rng, p, 420, 0, s.h, fg)
    for _ in range(9):
        x, y = rng.uniform(0, s.w), rng.uniform(0, s.h * 0.6)
        r = s.m * rng.uniform(0.012, 0.022)
        s.add(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r:.1f}" fill="{s.radial([(0, fg, 0.9), (0.15, fg, 0.5), (1, fg, 0)])}"/>')
    pr = max(s.w, s.h) * (1.1 if s.h > s.w else 0.95)
    px, py = s.w * 0.5, s.h * (0.84 if s.h > s.w else 0.78) + pr
    s.add(f'<circle cx="{px:.0f}" cy="{py:.0f}" r="{pr * 1.06:.0f}" '
          f'fill="{s.radial([(0.9, accent, 0.0), (0.94, accent, 0.35), (1, accent, 0)])}"/>')
    body = s.radial([(0, mix(bg, "#000000", 0.6), 1), (0.97, mix(bg, accent, 0.18), 1), (1, mix(accent, "#ffffff", 0.3), 1)])
    s.add(f'<circle cx="{px:.0f}" cy="{py:.0f}" r="{pr:.0f}" fill="{body}"/>')
    vignette(s, p, 0.4)


STYLES = {"aurora": aurora, "orb": orb, "ridges": ridges, "waves": waves, "synth": synth, "dunes": dunes,
          "contours": contours, "stars": starfield}


def make(theme):
    meta = tomllib.loads((theme / "theme.toml").read_text())
    p = palette(theme)
    for name, (w, h) in SIZES.items():
        s = Svg(w, h)
        STYLES[meta["wallpaper"]](s, p, random.Random(f"{theme.name} {meta['wallpaper']}"))
        (theme / name).write_text(str(s))


def main(names):
    themes = [HERE / n for n in names] if names else sorted(d for d in HERE.iterdir() if (d / "theme.toml").is_file())
    for t in themes:
        make(t)
        print(t.name)


if __name__ == "__main__":
    main(sys.argv[1:])
