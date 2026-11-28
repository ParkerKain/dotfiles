#!/usr/bin/env python3
"""Draws a set of jade and emerald wallpapers into ~/Pictures/wallpapers/jade (or ~/Wallpapers/jade).

    python3 herdr-app/wallpapers/jade.py                  # all of them
    python3 herdr-app/wallpapers/jade.py malachite-bands  # one by name

Needs numpy and Pillow: Homebrew's python3 on the Mac has both. On Omarchy run it with
`uv run --no-project --with numpy --with pillow python3 herdr-app/wallpapers/jade.py`.

They're generated rather than downloaded, so they carry no license and match the jade themes'
colors. Frosted blurs them, so each one is built from broad color fields first and detail second.
Afterwards run `herdr-app/frost --thumbs` so the Wallpaper picker sees them.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

W, H = 3840, 2400
OUT = next((p for p in (Path.home() / "Pictures/wallpapers", Path.home() / "Wallpapers") if p.is_dir()),
           Path.home() / "Pictures/wallpapers") / "jade"
RNG = np.random.default_rng(7)


def rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)


def grid():
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    return x / W, y / H


def smooth_noise(scale, seed):
    """Value noise: random cells blown up with bicubic smoothing, in 0..1."""
    r = np.random.default_rng(seed)
    cells = (r.random((max(2, int(H / scale)), max(2, int(W / scale)))) * 255).astype(np.uint8)
    im = Image.fromarray(cells).resize((W, H), Image.Resampling.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255


def fbm(seed, octaves=4, base=900):
    total, amp, norm = 0, 1.0, 0
    for o in range(octaves):
        total = total + amp * smooth_noise(base / 2 ** o, seed + o)
        norm += amp
        amp *= 0.5
    return total / norm


def blobs(bg, spots):
    """Soft colored light over a dark ground: spots are (x, y, radius, color, strength)."""
    x, y = grid()
    img = np.broadcast_to(rgb(bg), (H, W, 3)).copy()
    for cx, cy, r, c, s in spots:
        d = ((x - cx) ** 2 + ((y - cy) * H / W) ** 2) / r ** 2
        w = (np.exp(-d) * s)[..., None]
        img = img * (1 - w) + rgb(c) * w
    return img


def grain(img, amount=4.0):
    return img + RNG.normal(0, amount, img.shape[:2])[..., None]


def save(name, img):
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(OUT / f"{name}.jpg", quality=92)
    print(f"wrote {OUT / name}.jpg")


def aurora():
    img = blobs("#06110e", [(0.2, 0.25, 0.45, "#1a6e51", 0.55), (0.75, 0.15, 0.35, "#2fd08a", 0.2),
                            (0.6, 0.75, 0.5, "#0d4a3f", 0.6), (0.95, 0.6, 0.3, "#3fb7b0", 0.2)])
    x, y = grid()
    n = fbm(11, 3, 1400)
    # Curtains: two wide ribbons that sweep across, each a soft band with fine vertical rays inside.
    curtain = np.zeros_like(x)
    for k, (cy, amp, width) in enumerate(((0.3, 0.12, 0.09), (0.5, 0.08, 0.06))):
        center = cy + amp * np.sin(x * (2.2 + k) * np.pi + n * 3 + k)
        # Sharp-ish lower hem and a long fade upwards, as real curtains hang.
        band = np.where(y < center, np.exp(-((center - y) / (width * 2.2)) ** 2), np.exp(-((y - center) / (width * 0.5)) ** 2))
        rays = 0.6 + 0.4 * (np.sin((x * 70 + n * 12) * np.pi) * 0.5 + 0.5)
        curtain = np.maximum(curtain, band * rays * (0.9 - 0.3 * k))
    img = img * (1 - 0.6 * curtain[..., None]) + rgb("#7ef0c0") * 0.6 * curtain[..., None]
    save("jade-aurora", grain(img))


def emerald_mesh():
    x, y = grid()
    corners = [rgb("#0b3d2e"), rgb("#1aa36f"), rgb("#0a2f3a"), rgb("#7cc9a4")]
    n = fbm(21, 3, 1600) - 0.5
    u, v = np.clip(x + n * 0.35, 0, 1)[..., None], np.clip(y + n * 0.35, 0, 1)[..., None]
    img = (corners[0] * (1 - u) * (1 - v) + corners[1] * u * (1 - v) + corners[2] * (1 - u) * v + corners[3] * u * v)
    save("emerald-mesh", grain(img * 0.85, 3))


def malachite():
    x, y = grid()
    n = fbm(31, 5, 1100)
    # Concentric banding around a few centers, warped by noise: the look of cut malachite.
    d = np.minimum(np.hypot(x - 0.3, (y - 0.7) * H / W), np.hypot(x - 0.85, (y - 0.2) * H / W) * 1.2)
    bands = np.sin((d * 38 + n * 9) * np.pi) * 0.5 + 0.5
    fine = np.sin((d * 160 + n * 30) * np.pi) * 0.5 + 0.5
    t = (0.75 * bands + 0.25 * fine)[..., None]
    img = rgb("#04251a") * (1 - t) + rgb("#1ed387") * t * 0.8 + rgb("#04251a") * t * 0.2
    shade = (0.55 + 0.45 * fbm(37, 2, 2000))[..., None]
    save("malachite-bands", grain(img * shade, 3))


def topo():
    x, y = grid()
    h = fbm(41, 5, 1300)
    lines = np.abs(((h * 28) % 1) - 0.5)
    ink = np.clip(1 - lines / 0.05, 0, 1)
    major = np.clip(1 - np.abs(((h * 5.6) % 1) - 0.5) / 0.02, 0, 1)
    img = blobs("#0d1714", [(0.8, 0.8, 0.6, "#123a2e", 0.7), (0.1, 0.1, 0.5, "#0f2b26", 0.6)])
    line = np.maximum(ink * 0.35, major * 0.7)[..., None]
    img = img * (1 - line) + rgb("#5ccba0") * line
    save("jade-topo", grain(img, 2.5))


def ridges():
    x, y = grid()
    # Dark enough that the tab bar's text, over Frosted's translucent chrome, stays readable.
    sky = rgb("#4f8c77") * (1 - y[..., None]) + rgb("#1f4a3e") * y[..., None]
    img = sky.copy()
    layers = ["#3f7d68", "#2f6a57", "#225444", "#163d33", "#0b2620"]
    for i, c in enumerate(layers):
        base = 0.38 + i * 0.12
        line = base + 0.04 * np.sin(x[0] * (1.3 + 0.6 * i) * np.pi + i * 1.7) + 0.16 * (fbm(51 + i, 4, 900)[0] - 0.5)
        mask = (y > line[None, :]).astype(np.float32)
        mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)),
                          dtype=np.float32)[..., None] / 255
        img = img * (1 - mask) + rgb(c) * mask
        # Mist pooling at each ridge's foot.
        mist = np.exp(-((y - line[None, :] - 0.06) / 0.05) ** 2)[..., None] * 0.18
        img = img * (1 - mist) + rgb("#9fcfbd") * mist
    save("misty-ridges", grain(img, 3))


def celadon():
    x, y = grid()
    n = fbm(61, 4, 1500)
    t = (0.6 * y + 0.4 * n)[..., None]
    img = rgb("#5f8a78") * (1 - t) + rgb("#22403a") * t
    # Crackle: the edges of a Voronoi tiling (where the nearest two seeds are almost equally near),
    # nudged by noise so the cells aren't too straight. Worked out at quarter size, then scaled up.
    h4, w4 = H // 4, W // 4
    seeds = RNG.random((260, 2)) * [w4, h4]
    yy, xx = np.mgrid[0:h4, 0:w4].astype(np.float32)
    wob = np.asarray(Image.fromarray((fbm(67, 2, 300) * 255).astype(np.uint8)).resize((w4, h4)), dtype=np.float32) / 255 * 6
    d1 = np.full((h4, w4), 1e9, np.float32)
    d2 = np.full((h4, w4), 1e9, np.float32)
    for sx, sy in seeds:
        d = np.hypot(xx + wob - sx, yy - wob - sy)
        d2 = np.where(d < d1, d1, np.minimum(d2, d))
        d1 = np.minimum(d1, d)
    edge = np.clip(1 - (d2 - d1) / 1.6, 0, 1)
    edge = np.asarray(Image.fromarray((edge * 255).astype(np.uint8)).resize((W, H), Image.Resampling.BILINEAR), dtype=np.float32) / 255
    crack = (edge * 0.35)[..., None]
    img = img * (1 - crack) + rgb("#a9cfbd") * crack
    save("celadon-glaze", grain(img, 2))


def deep_forest():
    img = blobs("#050c0a", [(0.5, 1.1, 0.7, "#145c45", 0.9), (0.15, 0.4, 0.3, "#0e3b33", 0.6),
                            (0.85, 0.35, 0.25, "#1c6f5a", 0.5)])
    x, y = grid()
    # Straight diagonal shafts of sun through a canopy, uneven in width and strength, fading downwards.
    u = x * 0.8 + y * 0.45
    beams = np.zeros_like(x)
    for k, (pos, width, strength) in enumerate(((0.22, 0.012, 0.5), (0.31, 0.025, 0.35), (0.47, 0.008, 0.45),
                                                 (0.58, 0.03, 0.25), (0.74, 0.015, 0.4))):
        beams = np.maximum(beams, np.exp(-((u - pos) / width) ** 2) * strength)
    beams = beams * np.clip(1.1 - y, 0, 1) * (0.7 + 0.3 * fbm(81, 2, 900))
    img = img * (1 - beams[..., None]) + rgb("#9ce8c4") * beams[..., None]
    save("deep-forest-light", grain(img, 3))


ALL = {"jade-aurora": aurora, "emerald-mesh": emerald_mesh, "malachite-bands": malachite, "jade-topo": topo,
       "misty-ridges": ridges, "celadon-glaze": celadon, "deep-forest-light": deep_forest}

if __name__ == "__main__":
    for name in sys.argv[1:] or ALL:
        ALL[name]()
