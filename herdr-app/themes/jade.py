#!/usr/bin/env python3
"""Writes the five jade/emerald Herdr themes and checks they read well.

    python3 herdr-app/themes/jade.py           # check, then write themes/<name>.json
    python3 herdr-app/themes/jade.py --check   # check only, write nothing

Each palette is hand-picked. The checks use WCAG contrast ratios against the terminal
background, so a tweak that makes a color hard to read fails here instead of in a pane.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ansi order: black red green yellow blue magenta cyan white, then the bright eight.
# colors: Herdr's panel colors (see herdr.d.ts theme()). The rest are derived by Herdr.
THEMES = {
    # Balanced and calm: green-black ground, ivory text, a true jade accent.
    "jade-temple": {
        "background": "#121b18", "foreground": "#dfe6dc", "selection": "#2b4a3d", "cursor": "#5ccba0",
        "ansi": ["#1f2b27", "#e87d7d", "#5ccba0", "#e3c27a", "#7aaee0", "#c49be0", "#6fcfcf", "#d5ddd3",
                 "#6f8379", "#f29a96", "#84dfba", "#f0d596", "#9cc4ec", "#d6b5ea", "#9ce4f0", "#f1f5ee"],
        "colors": {"chrome": "#0e1613", "canvas": "#0b120f", "surface": "#16211d", "accent": "#5ccba0",
                   "accent_foreground": "#08140f", "border": "#23312c", "selected": "#26392f",
                   "hover": "#1c2a25", "muted": "#93a69c", "dim": "#6f8379"},
    },
    # Cool and punchy: navy-black ground with a vivid emerald and electric blue and violet.
    "emerald-night": {
        "background": "#0b1220", "foreground": "#dbe4f0", "selection": "#163a3a", "cursor": "#34d399",
        "ansi": ["#16203a", "#ff6b81", "#34d399", "#f5c76a", "#60a5fa", "#a78bfa", "#2dd4bf", "#cbd5e1",
                 "#64748b", "#ff8fa0", "#6ee7b7", "#fcd98f", "#93c5fd", "#c4b5fd", "#50e8e0", "#f1f5f9"],
        "colors": {"chrome": "#080d18", "canvas": "#060a13", "surface": "#0f1729", "accent": "#34d399",
                   "accent_foreground": "#03140d", "border": "#1b2540", "selected": "#1a2f3a",
                   "hover": "#141d33", "muted": "#94a3b8", "dim": "#6b7a90"},
    },
    # Soft porcelain: low-saturation slate-green, pale celadon accent, pastel syntax.
    "celadon": {
        "background": "#1d2623", "foreground": "#d4dccf", "selection": "#31473a", "cursor": "#9fd1b5",
        "ansi": ["#28332f", "#e0a09a", "#9fd1b5", "#d8c48f", "#93a6e6", "#dba6c6", "#8fc3d8", "#cdd5c8",
                 "#7f8f87", "#e9b2ac", "#b6e0c8", "#e6d4a4", "#adbcf0", "#e6bcd5", "#89d9e7", "#e8ede4"],
        "colors": {"chrome": "#18201d", "canvas": "#141b18", "surface": "#212b28", "accent": "#9fd1b5",
                   "accent_foreground": "#12201a", "border": "#2c3833", "selected": "#2c3c35",
                   "hover": "#26322d", "muted": "#9eaca3", "dim": "#7f8f87"},
    },
    # High contrast: true-black ground, bright text, a yellow-leaning malachite green and gold.
    "malachite": {
        "background": "#070807", "foreground": "#f2f5ef", "selection": "#1f4424", "cursor": "#3ddc6e",
        "ansi": ["#161a16", "#ff5c5c", "#3ddc6e", "#ffc53d", "#4da3ff", "#e07cff", "#2ee0c8", "#e3e8e0",
                 "#7a8a7c", "#ff8585", "#7cf09a", "#ffd970", "#82bfff", "#eca8ff", "#72f0dc", "#ffffff"],
        "colors": {"chrome": "#030403", "canvas": "#020302", "surface": "#0d100d", "accent": "#3ddc6e",
                   "accent_foreground": "#031407", "border": "#1d241d", "selected": "#183219",
                   "hover": "#121712", "muted": "#a9b5a8", "dim": "#7a8a7c"},
    },
    # Warm: olive-espresso ground, an olive-leaning jade with brass and copper (closest to Rose Pine).
    "jade-brass": {
        "background": "#1a1c17", "foreground": "#e6e1d3", "selection": "#3a4732", "cursor": "#8cc77f",
        "ansi": ["#262920", "#e0816d", "#8cc77f", "#d9b061", "#8da3e0", "#cc9fc2", "#6fb5c4", "#dcd6c6",
                 "#827e6d", "#ec9a87", "#a9dc9c", "#e8c582", "#a9bbee", "#dcb5d3", "#8fd8cf", "#f3eee2"],
        "colors": {"chrome": "#151712", "canvas": "#11130f", "surface": "#1f221b", "accent": "#8cc77f",
                   "accent_foreground": "#121a0e", "border": "#2c2f25", "selected": "#2f3a29",
                   "hover": "#24271f", "muted": "#a8a392", "dim": "#827e6d"},
    },
}


def lum(hex_color):
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def lab(hex_color):
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = [((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92 for c in rgb]
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = [v ** (1 / 3) if v > 0.008856 else 7.787 * v + 16 / 116 for v in (x, y, z)]
    return 116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])


def delta_e(a, b):
    return sum((p - q) ** 2 for p, q in zip(lab(a), lab(b))) ** 0.5


# ANSI pairs that sit side by side in syntax and git output, so they must look clearly different.
DISTINCT_PAIRS = [(2, 6), (4, 6), (4, 5), (1, 5), (10, 14), (12, 14)]


def check(name, t):
    """Returns a list of problems. Thresholds: body text 4.5 (WCAG AA), comments 3.5, hints 3."""
    bg, fg, c = t["background"], t["foreground"], t["colors"]
    rules = [
        ("foreground on background", fg, bg, 10),
        ("foreground on selection", fg, t["selection"], 7),
        ("foreground on chrome", fg, c["chrome"], 10),
        ("accent on background", c["accent"], bg, 6),
        ("accent on chrome", c["accent"], c["chrome"], 6),
        ("accent_foreground on accent", c["accent_foreground"], c["accent"], 6),
        ("muted on chrome", c["muted"], c["chrome"], 5),
        ("muted on selected", c["muted"], c["selected"], 4.5),
        ("dim on chrome", c["dim"], c["chrome"], 3.5),
        ("foreground on selected", fg, c["selected"], 8),
        ("ansi8 (comments) on background", t["ansi"][8], bg, 3.5),
        ("ansi8 on selection", t["ansi"][8], t["selection"], 2.2),
    ]
    for i in list(range(1, 8)) + list(range(9, 16)):
        rules.append((f"ansi{i} on background", t["ansi"][i], bg, 4.5))
        rules.append((f"ansi{i} on ansi0", t["ansi"][i], t["ansi"][0], 4))
    problems = [f"{name}: {label} is {contrast(a, b):.2f}, needs {need}" for label, a, b, need in rules
                if contrast(a, b) < need]
    # Hover, selected and border must step away from the chrome they sit on, or rows don't show.
    for key, need in (("hover", 1.08), ("selected", 1.25), ("border", 1.15)):
        r = contrast(c[key], c["chrome"])
        if r < need:
            problems.append(f"{name}: {key} vs chrome is {r:.2f}, needs {need}")
    for i, j in DISTINCT_PAIRS:
        d = delta_e(t["ansi"][i], t["ansi"][j])
        if d < 20:
            problems.append(f"{name}: ansi{i} and ansi{j} are too alike (delta E {d:.1f}, needs 20)")
    if contrast(t["ansi"][0], bg) < 1.1:
        problems.append(f"{name}: ansi0 is too close to the background to show as a block")
    return problems


def main():
    problems = [p for name, t in THEMES.items() for p in check(name, t)]
    # The five should look like five themes: accents or backgrounds apart from each other.
    names = list(THEMES)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            da = delta_e(THEMES[a]["colors"]["accent"], THEMES[b]["colors"]["accent"])
            db = delta_e(THEMES[a]["background"], THEMES[b]["background"])
            if da < 10 and db < 8:
                problems.append(f"{a} and {b} look alike: accent delta E {da:.1f}, background {db:.1f}")
    for p in problems:
        print(p)
    if problems:
        sys.exit(1)
    print(f"{len(THEMES)} themes pass")
    if "--check" in sys.argv:
        return
    for name, t in THEMES.items():
        (HERE / f"{name}.json").write_text(json.dumps(t, indent=2) + "\n")
        print(f"wrote themes/{name}.json")


if __name__ == "__main__":
    main()
