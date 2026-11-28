#!/usr/bin/env python3
"""Draws flat, simple nature wallpapers into ~/Pictures/wallpapers/flat (or ~/Wallpapers/flat).

    python3 herdr-app/wallpapers/flat.py              # all of them
    python3 herdr-app/wallpapers/flat.py pine-valley  # one by name

The style follows the green mountains wallpaper Parker picked for Terafox: hard-edged layered
shapes, gradient skies, a few stars, and Terafox's teal, peach, rose and blue. Each scene is drawn
at twice the size and scaled down, which gives clean antialiased edges. Needs Pillow (Homebrew's
python3 has it). Run `herdr-app/frost --thumbs` afterwards so the Wallpaper picker lists them.
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

W, H = 3840, 2160
S = 2  # supersampling factor
OUT = next((p for p in (Path.home() / "Pictures/wallpapers", Path.home() / "Wallpapers") if p.is_dir()),
           Path.home() / "Pictures/wallpapers") / "flat"


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def mix(a, b, t):
    a, b = rgb(a) if isinstance(a, str) else a, rgb(b) if isinstance(b, str) else b
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def sky(stops):
    """Vertical gradient through (position 0..1, color) stops."""
    w, h = W * S, H * S
    col = Image.new("RGB", (1, h))
    px = col.load()
    for y in range(h):
        t = y / (h - 1)
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if p0 <= t <= p1:
                px[0, y] = mix(c0, c1, (t - p0) / (p1 - p0 or 1))
                break
    return col.resize((w, h))


class Scene:
    def __init__(self, stops, seed):
        self.img = sky(stops)
        self.d = ImageDraw.Draw(self.img)
        self.r = random.Random(seed)

    def P(self, x, y):
        return (x * W * S, y * H * S)

    def poly(self, pts, color):
        self.d.polygon([self.P(x, y) for x, y in pts], fill=rgb(color) if isinstance(color, str) else color)

    def circle(self, x, y, r, color):
        cx, cy = self.P(x, y)
        rr = r * H * S
        self.d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=rgb(color) if isinstance(color, str) else color)

    def stars(self, n, top, bottom, color="#fff6ee", size=(0.0012, 0.0024)):
        for _ in range(n):
            self.circle(self.r.random(), self.r.uniform(top, bottom), self.r.uniform(*size), color)

    def glow(self, x, y, r, color, strength=0.35):
        """A soft halo, drawn on its own layer and blurred."""
        layer = Image.new("L", self.img.size, 0)
        ld = ImageDraw.Draw(layer)
        cx, cy = self.P(x, y)
        rr = r * H * S
        ld.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=round(255 * strength))
        layer = layer.filter(ImageFilter.GaussianBlur(rr * 0.6))
        self.img.paste(Image.new("RGB", self.img.size, rgb(color)), mask=layer)
        self.d = ImageDraw.Draw(self.img)

    def crescent(self, x, y, r, color, offset=0.38):
        """A moon disc with an offset disc cut out of it, through a mask so the sky shows through."""
        mask = Image.new("L", self.img.size, 0)
        md = ImageDraw.Draw(mask)
        cx, cy = self.P(x, y)
        rr = r * H * S
        md.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=255)
        ox, oy = cx + rr * offset * 1.6, cy - rr * offset * 0.6
        r2 = rr * 0.92
        md.ellipse([ox - r2, oy - r2, ox + r2, oy + r2], fill=0)
        self.img.paste(Image.new("RGB", self.img.size, rgb(color)), mask=mask)
        self.d = ImageDraw.Draw(self.img)

    def peak(self, x, y, half, base, light, dark):
        """A faceted peak: lit left face, shaded right face, as in the picked wallpaper."""
        self.poly([(x - half, base), (x, y), (x, base)], light)
        self.poly([(x, y), (x + half, base), (x, base)], dark)

    def ridge(self, peaks, base, light, dark):
        for x, y, half in peaks:
            self.peak(x, y, half, base, light, dark)

    def hills(self, base, amp, waves, color, phase=0.0, steps=240):
        pts = [(0, 1.01)]
        for i in range(steps + 1):
            x = i / steps
            y = base - sum(a * math.sin(x * f * math.pi + phase + k) for k, (a, f) in enumerate(waves)) * amp
            pts.append((x, y))
        pts.append((1, 1.01))
        self.poly(pts, color)
        return pts

    def pine(self, x, base, h, color, tiers=3):
        w = h * 0.42 * H / W
        for i in range(tiers):
            top = base - h * (1 - i * 0.22)
            bottom = base - h * (0.38 - i * 0.16)
            ww = w * (0.6 + 0.4 * (i + 1) / tiers)
            self.poly([(x - ww, bottom), (x, top), (x + ww, bottom)], color)
        self.poly([(x - w * 0.08, base), (x - w * 0.08, base - h * 0.12), (x + w * 0.08, base - h * 0.12), (x + w * 0.08, base)], color)

    def forest(self, line, height, color, count, jitter=0.35):
        for i in range(count):
            x = (i + self.r.uniform(-jitter, jitter)) / (count - 1)
            y = line(x)
            self.pine(x, y + 0.01, height * self.r.uniform(0.7, 1.25), color)

    def save(self, name):
        OUT.mkdir(parents=True, exist_ok=True)
        out = self.img.resize((W, H), Image.Resampling.LANCZOS)
        out.save(OUT / f"{name}.png", optimize=True)
        print(f"wrote {OUT / name}.png")


def line_of(pts):
    """y on a polyline from Scene.hills at x, for planting trees along it."""
    inner = pts[1:-1]

    def f(x):
        i = min(len(inner) - 2, max(0, int(x * (len(inner) - 1))))
        (x0, y0), (x1, y1) = inner[i], inner[i + 1]
        return y0 + (y1 - y0) * ((x - x0) / ((x1 - x0) or 1))
    return f


def peaks_dusk():
    s = Scene([(0, "#2b2a4a"), (0.45, "#ad5c7c"), (0.75, "#fda47f"), (1, "#fda47f")], 1)
    s.stars(70, 0.02, 0.35)
    s.crescent(0.78, 0.16, 0.05, "#fff1e0")
    layers = [("#6f8f99", "#5f7f8a", 0.62), ("#4f7a80", "#426b72", 0.72), ("#2f5a60", "#264d53", 0.84), ("#183a3f", "#122f34", 0.96)]
    for k, (light, dark, base) in enumerate(layers):
        peaks = [(x / 6 + s.r.uniform(-0.05, 0.05), base - s.r.uniform(0.18, 0.32) * (1 - k * 0.12), s.r.uniform(0.16, 0.26)) for x in range(-1, 8)]
        s.ridge(peaks, 1.01, light, dark)
    s.save("peaks-at-dusk")


def teal_peaks():
    s = Scene([(0, "#f0a78a"), (0.5, "#9ec7b8"), (1, "#5fbfb0")], 2)
    s.stars(30, 0.02, 0.3)
    layers = [("#4fb7a6", "#45a99a", 0.55), ("#38a394", "#2f9587", 0.68), ("#24877a", "#1d7a6e", 0.82), ("#14665d", "#105a52", 0.97)]
    for k, (light, dark, base) in enumerate(layers):
        peaks = [(x / 5 + s.r.uniform(-0.06, 0.06), base - s.r.uniform(0.2, 0.34), s.r.uniform(0.18, 0.3)) for x in range(-1, 7)]
        s.ridge(peaks, 1.01, light, dark)
    s.save("teal-peaks")


def pine_valley():
    s = Scene([(0, "#fbd0b0"), (0.55, "#f4b394"), (1, "#e89a80")], 3)
    s.glow(0.5, 0.42, 0.18, "#fff0d8", 0.5)
    s.circle(0.5, 0.42, 0.09, "#fff3e2")
    far = s.hills(0.55, 0.05, [(1, 1.3), (0.5, 3.1)], "#8db8ad")
    s.forest(line_of(far), 0.06, "#7aa59b", 34)
    mid = s.hills(0.68, 0.06, [(1, 1.7), (0.4, 4.3)], "#4f8a80", phase=1)
    s.forest(line_of(mid), 0.1, "#3f786f", 22)
    near = s.hills(0.84, 0.05, [(1, 1.1), (0.6, 2.7)], "#21544c", phase=2.2)
    s.forest(line_of(near), 0.2, "#173f39", 11, jitter=0.45)
    s.save("pine-valley")


def lake_reflection():
    s = Scene([(0, "#1f3c4a"), (0.5, "#5a93aa"), (0.62, "#a1cdd8"), (1, "#a1cdd8")], 4)
    s.stars(40, 0.02, 0.25)
    horizon = 0.6
    peaks = [(0.12, 0.3, 0.2), (0.33, 0.36, 0.17), (0.52, 0.24, 0.24), (0.74, 0.33, 0.2), (0.93, 0.27, 0.2)]
    s.ridge([(x, y, h) for x, y, h in peaks], horizon, "#7aa4a1", "#5f8b88")
    s.ridge([(x + 0.07, y + 0.12, h * 0.8) for x, y, h in peaks], horizon, "#3f6f6b", "#335f5b")
    # The lake: the scene above the horizon, flipped and dimmed, with a few flat ripples.
    top = s.img.crop((0, 0, W * S, int(horizon * H * S)))
    water = top.transpose(Image.Transpose.FLIP_TOP_BOTTOM).resize((W * S, int((1 - horizon) * H * S)))
    water = Image.blend(water, Image.new("RGB", water.size, rgb("#1f3c4a")), 0.35)
    s.img.paste(water, (0, int(horizon * H * S)))
    s.d = ImageDraw.Draw(s.img)
    s.circle(0.3, 0.2, 0.035, "#f5f1e6")
    for _ in range(26):
        x, y = s.r.random(), s.r.uniform(horizon + 0.03, 0.98)
        w = s.r.uniform(0.03, 0.12)
        s.poly([(x, y), (x + w, y), (x + w, y + 0.004), (x, y + 0.004)], mix("#a1cdd8", "#1f3c4a", 0.4))
    s.save("lake-reflection")


def mint_dunes():
    s = Scene([(0, "#f6c6b0"), (0.5, "#f3d8c4"), (1, "#e8e2cf")], 5)
    s.circle(0.72, 0.3, 0.07, "#fda47f")
    colors = ["#a9d2c4", "#7fbcac", "#56a594", "#368a7a", "#1f6b5f"]
    for k, c in enumerate(colors):
        s.hills(0.5 + k * 0.1, 0.06, [(1, 0.9 + k * 0.3), (0.35, 2.4)], c, phase=k * 1.3)
    s.save("mint-dunes")


def night_forest():
    s = Scene([(0, "#0c1a20"), (0.6, "#1d3b44"), (1, "#2f5560")], 6)
    s.stars(160, 0.0, 0.55, size=(0.0009, 0.002))
    s.glow(0.66, 0.26, 0.16, "#cfe6e2", 0.3)
    s.circle(0.66, 0.26, 0.085, "#e6f0ea")
    rows = [("#2a4c53", 0.66, 0.1, 40), ("#1d3a40", 0.76, 0.15, 26), ("#10262b", 0.9, 0.24, 14)]
    for color, base, h, n in rows:
        s.poly([(0, base), (1, base), (1, 1.01), (0, 1.01)], color)
        s.forest(lambda x, b=base: b, h, color, n)
    s.save("night-forest")


def island():
    s = Scene([(0, "#ad5c7c"), (0.45, "#fda47f"), (0.62, "#fdd0a8"), (1, "#fdd0a8")], 7)
    horizon = 0.64
    s.glow(0.5, horizon, 0.22, "#fff0d0", 0.45)
    s.circle(0.5, horizon - 0.02, 0.1, "#fff1dc")
    s.poly([(0, horizon), (1, horizon), (1, 1.01), (0, 1.01)], "#3f7f86")
    for k in range(9):
        y = horizon + 0.02 + k * k * 0.0045
        w = (0.09 - k * 0.008) * s.r.uniform(0.7, 1.1)
        cx = 0.5 + s.r.uniform(-0.01, 0.01)
        s.poly([(cx - w, y), (cx + w, y), (cx + w, y + 0.006), (cx - w, y + 0.006)], "#fbc9a0")
    s.poly([(0.22, horizon + 0.005), (0.27, horizon - 0.03), (0.36, horizon - 0.04), (0.42, horizon + 0.005)], "#1f4a4c")
    for x, h in ((0.27, 0.16), (0.3, 0.22), (0.33, 0.18), (0.36, 0.12)):
        s.pine(x, horizon - 0.02, h, "#1f4a4c")
    s.save("island-sunset")


def waves():
    s = Scene([(0, "#a1cdd8"), (0.5, "#e8d9cc"), (1, "#fdb292")], 8)
    s.circle(0.24, 0.24, 0.07, "#fda47f")
    for k, c in enumerate(["#8ec3c2", "#6fb0ad", "#4f9996", "#367f7d", "#22625f", "#154a48"]):
        base = 0.5 + k * 0.09
        pts = [(0, 1.01)]
        for i in range(401):
            x = i / 400
            crest = (math.sin((x * (3 + k * 0.5) + k * 0.37) * 2 * math.pi) * 0.5 + 0.5) ** 3
            pts.append((x, base - crest * 0.04))
        pts.append((1, 1.01))
        s.poly(pts, c)
    s.save("flat-waves")


def misty_hills():
    s = Scene([(0, "#dfe9e4"), (1, "#b8d4cc")], 10)
    s.circle(0.62, 0.3, 0.06, "#fdb292")
    for k, c in enumerate(["#a6c9bf", "#8bb8ad", "#6fa59a", "#538f84", "#3a786e", "#255e56"]):
        s.hills(0.42 + k * 0.1, 0.05, [(1, 1.1 + k * 0.25), (0.45, 2.9 + k * 0.4)], c, phase=k * 0.9)
    for _ in range(5):
        x, y = s.r.uniform(0.15, 0.85), s.r.uniform(0.12, 0.3)
        w = 0.008
        s.d.line([s.P(x - w * 1.3, y - w), s.P(x, y), s.P(x + w * 1.3, y - w)], fill=rgb("#40645c"), width=6 * S)
    s.save("misty-hills")


ALL = {"peaks-at-dusk": peaks_dusk, "teal-peaks": teal_peaks, "pine-valley": pine_valley,
       "lake-reflection": lake_reflection, "mint-dunes": mint_dunes, "night-forest": night_forest,
       "island-sunset": island, "flat-waves": waves, "misty-hills": misty_hills}

if __name__ == "__main__":
    for name in sys.argv[1:] or ALL:
        ALL[name]()
