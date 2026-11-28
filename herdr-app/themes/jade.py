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
                 "#6f8379", "#f29a96", "#84dfba", "#f0d596", "#9cc4ec", "#d6b5ea", "#93e0dc", "#f1f5ee"],
        "colors": {"chrome": "#0e1613", "canvas": "#0b120f", "surface": "#16211d", "accent": "#5ccba0",
                   "accent_foreground": "#08140f", "border": "#23312c", "selected": "#26392f",
                   "hover": "#1c2a25", "muted": "#93a69c", "dim": "#6f8379"},
    },
    # Cool and punchy: blue-black ground with a vivid emerald and electric secondaries.
    "emerald-night": {
        "background": "#0d1416", "foreground": "#d8e4e6", "selection": "#1d4038", "cursor": "#2fd08a",
        "ansi": ["#18252a", "#ff6b7a", "#2fd08a", "#f2c94c", "#5aa9ff", "#b48cff", "#3fd4d4", "#cfdde0",
                 "#667d84", "#ff8a96", "#5fe3a8", "#ffdc7a", "#85c1ff", "#cbaaff", "#74e6e6", "#eef6f7"],
        "colors": {"chrome": "#091012", "canvas": "#070c0e", "surface": "#111a1d", "accent": "#2fd08a",
                   "accent_foreground": "#04140c", "border": "#1c292d", "selected": "#1a3330",
                   "hover": "#152226", "muted": "#8aa0a6", "dim": "#667d84"},
    },
    # Soft porcelain: low-saturation slate-green, pale celadon accent, pastel syntax.
    "celadon": {
        "background": "#1d2623", "foreground": "#d4dccf", "selection": "#31473a", "cursor": "#9fd1b5",
        "ansi": ["#28332f", "#e0a09a", "#9fd1b5", "#d8c48f", "#98b8d3", "#c4aacd", "#96cdc6", "#cdd5c8",
                 "#7f8f87", "#e9b2ac", "#b6e0c8", "#e6d4a4", "#afcae1", "#d3bcda", "#acdad3", "#e8ede4"],
        "colors": {"chrome": "#18201d", "canvas": "#141b18", "surface": "#212b28", "accent": "#9fd1b5",
                   "accent_foreground": "#12201a", "border": "#2c3833", "selected": "#2c3c35",
                   "hover": "#26322d", "muted": "#9eaca3", "dim": "#7f8f87"},
    },
    # High contrast: near-black ground, bright text, saturated malachite and gold.
    "malachite": {
        "background": "#0a0f0d", "foreground": "#eef4ec", "selection": "#1d4a35", "cursor": "#1ed387",
        "ansi": ["#17211c", "#ff5f5f", "#1ed387", "#f5c542", "#4da6ff", "#d07cff", "#2ee6d0", "#dfe8e2",
                 "#728a7e", "#ff8787", "#5ef0ad", "#ffd96a", "#7cc0ff", "#e3a5ff", "#6ff3e1", "#ffffff"],
        "colors": {"chrome": "#060a08", "canvas": "#040706", "surface": "#0e1512", "accent": "#1ed387",
                   "accent_foreground": "#02120a", "border": "#1c2822", "selected": "#173527",
                   "hover": "#131d18", "muted": "#a3b3aa", "dim": "#728a7e"},
    },
    # Warm: olive-espresso ground, jade accent with brass and copper (closest to Rose Pine's warmth).
    "jade-brass": {
        "background": "#1a1c17", "foreground": "#e6e1d3", "selection": "#37473a", "cursor": "#5fc9a2",
        "ansi": ["#262920", "#e0816d", "#5fc9a2", "#d9b061", "#86aecd", "#cc9fc2", "#74c1b5", "#dcd6c6",
                 "#827e6d", "#ec9a87", "#86dcbb", "#e8c582", "#a0c2dd", "#dcb5d3", "#95d4ca", "#f3eee2"],
        "colors": {"chrome": "#151712", "canvas": "#11130f", "surface": "#1f221b", "accent": "#5fc9a2",
                   "accent_foreground": "#0d1a14", "border": "#2c2f25", "selected": "#2c3a2f",
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
    if contrast(t["ansi"][0], bg) < 1.1:
        problems.append(f"{name}: ansi0 is too close to the background to show as a block")
    return problems


def main():
    problems = [p for name, t in THEMES.items() for p in check(name, t)]
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
