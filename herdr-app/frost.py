#!/usr/bin/env python3
"""Image background behind Herdr's panes, blurred by default, with translucent terminals and panels.

Usage:
  frost.py <image>            put this image behind the panes (blurred), rebuild the Frosted layout
  frost.py <image> --blur 0   the image sharp, unblurred
  frost.py <image> --desktop  also set it as the macOS desktop wallpaper
  frost.py --list             wallpapers in ~/Pictures/wallpapers

The Frosted layout is rebuilt from layouts/Parker.json on every run, so it keeps up with
Parker's blocks and only differs in look. Switch to it with Cmd+Shift+L or Settings > Look.
"""
import argparse
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

HERE = Path(__file__).resolve().parent
HOME = Path.home() / ".config/herdr-app"
WALLPAPERS = Path.home() / "Pictures/wallpapers"
SCREEN = (3024, 1964)  # built-in display, px

# Translucent overrides on top of the theme. Alpha is the last two hex digits.
LOOK = {
    "terminal_opacity": 0.5,
    "sidebar": "#19172480",
    "pane": "#2321362e",
    "colors": {"border": "#e0def426", "chrome": "#1917248c", "surface": "#2321368c", "background": "#2321368c"},
}


GLASS_PANELS = {"ops-tasks", "jobs", "day-view", "artifacts"}


def frost(src: Path, blur: float, tint: str, tint_amount: float) -> Path:
    im = Image.open(src).convert("RGB")
    scale = max(SCREEN[0] / im.width, SCREEN[1] / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
    left, top = (im.width - SCREEN[0]) // 2, (im.height - SCREEN[1]) // 2
    im = im.crop((left, top, left + SCREEN[0], top + SCREEN[1]))
    # Blur small first: much faster than a huge radius at full size, same look.
    small = im.resize((SCREEN[0] // 4, SCREEN[1] // 4), Image.Resampling.LANCZOS)
    small = small.filter(ImageFilter.GaussianBlur(blur / 4))
    im = small.resize(SCREEN, Image.Resampling.LANCZOS)
    im = ImageEnhance.Color(im).enhance(1.15)
    im = Image.blend(im, Image.new("RGB", SCREEN, tint), tint_amount)
    out_dir = HOME / "backgrounds"
    out_dir.mkdir(exist_ok=True)
    for old in out_dir.glob("frosted-*.jpg"):
        old.unlink()
    out = out_dir / f"frosted-{src.stem.replace(' ', '-')}.jpg"
    im.save(out, quality=92)
    return out


def build_layout(background: Path) -> None:
    layout = json.loads((HERE / "layouts/Parker.json").read_text())
    layout.pop("cloned_from", None)
    layout["background"] = {"image": str(background.relative_to(HOME)), "fit": "cover"}
    layout["terminal_opacity"] = LOOK["terminal_opacity"]
    layout["colors"] = {**layout.get("colors", {}), **LOOK["colors"]}

    def walk(node):
        if node.get("id") == "sidebar":
            node["background"] = LOOK["sidebar"]
        pane = node.get("content", {}).get("pane") if isinstance(node.get("content"), dict) else None
        if pane:
            pane["background"] = LOOK["pane"]
        # Panel mods paint theme().background, which stays opaque. With glass they paint chrome instead.
        if node.get("id") in GLASS_PANELS:
            node["content"]["props"] = {**node["content"].get("props", {}), "glass": True}
        for child in node.get("children", []):
            walk(child)

    walk(layout)
    # Written to the Herdr home directly: it is generated, so it isn't kept in dotfiles.
    (HOME / "layouts/Frosted.json").write_text(json.dumps(layout, indent=2) + "\n")


def set_desktop(src: Path) -> None:
    script = f'tell application "System Events" to tell every desktop to set picture to POSIX file "{src}"'
    subprocess.run(["osascript", "-e", script], check=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("image", nargs="?", type=Path)
    p.add_argument("--blur", type=float, default=90, help="blur radius in screen px, 0 for sharp (default 90)")
    p.add_argument("--tint", default="#232136", help="color mixed over the blur (default rose-pine-moon base)")
    p.add_argument("--tint-amount", type=float, default=0.2, help="0..1 (default 0.35)")
    p.add_argument("--desktop", action="store_true", help="also set the sharp wallpaper on the macOS desktop")
    p.add_argument("--list", action="store_true")
    args = p.parse_args()

    if args.list or not args.image:
        for f in sorted(WALLPAPERS.rglob("*")):
            if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".heic"}:
                print(f)
        return
    src = args.image.expanduser().resolve()
    bg = frost(src, args.blur, args.tint, args.tint_amount)
    build_layout(bg)
    if args.desktop:
        set_desktop(src)
    print(f"frosted {src.name} -> {bg}")


if __name__ == "__main__":
    main()
