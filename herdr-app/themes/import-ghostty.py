#!/usr/bin/env python3
"""Convert a curated set of Ghostty's bundled themes into Herdr theme files.

Usage: python3 import-ghostty.py
Writes <slug>.json next to this script. Edit THEMES to add or drop one, then rerun.
"""
import json
import re
from pathlib import Path

GHOSTTY = Path("/Applications/Ghostty.app/Contents/Resources/ghostty/themes")
OUT = Path(__file__).resolve().parent

# Ghostty theme name -> Herdr theme name. rose-pine-moon is hand-tuned and kept as is.
THEMES = {
    # Rose Pine and Catppuccin
    "Rose Pine": "rose-pine",
    "Rose Pine Dawn": "rose-pine-dawn",
    "Catppuccin Mocha": "catppuccin-mocha",
    "Catppuccin Macchiato": "catppuccin-macchiato",
    "Catppuccin Frappe": "catppuccin-frappe",
    "Catppuccin Latte": "catppuccin-latte",
    # Soft pastel darks in the same family
    "TokyoNight Moon": "tokyonight-moon",
    "TokyoNight Storm": "tokyonight-storm",
    "TokyoNight Night": "tokyonight-night",
    "TokyoNight Day": "tokyonight-day",
    "Kanagawa Wave": "kanagawa-wave",
    "Kanagawa Dragon": "kanagawa-dragon",
    "Kanagawa Lotus": "kanagawa-lotus",
    "Kanso Ink": "kanso-ink",
    "Kanso Zen": "kanso-zen",
    "Poimandres": "poimandres",
    "Poimandres Storm": "poimandres-storm",
    "Everblush": "everblush",
    "Mellow": "mellow",
    "Miasma": "miasma",
    # Nightfox family
    "Nightfox": "nightfox",
    "Duskfox": "duskfox",
    "Nordfox": "nordfox",
    "Terafox": "terafox",
    "Carbonfox": "carbonfox",
    "Dawnfox": "dawnfox",
    # Cool blues
    "Nord": "nord",
    "Iceberg Dark": "iceberg-dark",
    "Night Owl": "night-owl",
    "Moonfly": "moonfly",
    "Material Ocean": "material-ocean",
    "Oceanic Next": "oceanic-next",
    "Horizon": "horizon",
    "Embark": "embark",
    # Warm and earthy
    "Everforest Dark Hard": "everforest-dark",
    "Everforest Light Med": "everforest-light",
    "Gruvbox Dark": "gruvbox-dark",
    "Gruvbox Material Dark": "gruvbox-material-dark",
    "Gruvbox Light": "gruvbox-light",
    "Melange Dark": "melange-dark",
    "Melange Light": "melange-light",
    "Zenburn": "zenburn",
    "Srcery": "srcery",
    "Sonokai": "sonokai",
    # Classics
    "Dracula": "dracula",
    "Monokai Pro": "monokai-pro",
    "Monokai Pro Ristretto": "monokai-pro-ristretto",
    "One Half Dark": "one-half-dark",
    "One Half Light": "one-half-light",
    "Tomorrow Night Eighties": "tomorrow-night-eighties",
    "iTerm2 Solarized Dark": "solarized-dark",
    "iTerm2 Solarized Light": "solarized-light",
    "Selenized Dark": "selenized-dark",
    "Ayu Mirage": "ayu-mirage",
    "Ayu": "ayu-dark",
    "Ayu Light": "ayu-light",
    "GitHub Dark Dimmed": "github-dark-dimmed",
    "GitHub Light Default": "github-light",
    # Minimal and high contrast
    "Oxocarbon": "oxocarbon",
    "Vesper": "vesper",
    "Flexoki Dark": "flexoki-dark",
    "Flexoki Light": "flexoki-light",
    "Modus Vivendi": "modus-vivendi",
    "Modus Operandi": "modus-operandi",
    "Doom One": "doom-one",
    # Loud
    "Synthwave": "synthwave",
}

HEX = re.compile(r"#?([0-9a-fA-F]{6})")


def color(value):
    m = HEX.search(value)
    return f"#{m.group(1).lower()}" if m else None


def mix(a, b, t):
    pa = [int(a[i : i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i : i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(pa, pb))


def convert(path):
    keys: dict[str, str | None] = {}
    ansi: list[str | None] = [None] * 16
    for line in path.read_text().splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, _, value = (s.strip() for s in line.partition("="))
        if key == "palette":
            idx, _, c = value.partition("=")
            if idx.strip().isdigit() and int(idx) < 16:
                ansi[int(idx)] = color(c)
        else:
            keys[key] = color(value)
    bg, fg = keys["background"], keys["foreground"]
    if None in ansi:
        raise ValueError(f"{path.name}: missing palette entries")
    return {
        "background": bg,
        "foreground": fg,
        "selection": keys.get("selection-background") or mix(bg, fg, 0.25),
        "cursor": keys.get("cursor-color") or fg,
        "ansi": ansi,
    }


def main():
    for name, slug in THEMES.items():
        theme = convert(GHOSTTY / name)
        (OUT / f"{slug}.json").write_text(json.dumps(theme, indent=2) + "\n")
    print(f"wrote {len(THEMES)} themes to {OUT}")


if __name__ == "__main__":
    main()
