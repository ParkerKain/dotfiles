#!/usr/bin/env python3
"""Image background behind Herdr's panes, blurred by default, with translucent terminals and panels.

Usage:
  frost.py <image>            put this image behind the panes (blurred), rebuild the Frosted layout
  frost.py <image> --blur 0   the image sharp, unblurred
  frost.py <image> --desktop  also set it as the macOS desktop wallpaper (macOS only)
  frost.py --relayout         rebuild the Frosted layout from Parker, keeping its background
  frost.py ... --theme NAME   tint the glass from themes/NAME.json (kept for later runs; "none" for Rose Pine)
  frost.py --list             wallpapers in ~/Pictures/wallpapers (or ~/Wallpapers)
  frost.py --thumbs           rebuild the wallpaper picker's thumbnails and index (Cmd+Shift+B)

The Frosted layout is rebuilt from this machine's installed Parker layout on every run, so
it keeps up with Parker's blocks (and the panels this machine has) and only differs in look.
Run it through ./frost, which finds a Python with Pillow on either machine. Switch to it with Cmd+Shift+L or Settings > Look.
"""
import argparse
import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import machine  # noqa: E402
HOME = Path.home() / ".config/herdr-app"
# The work Mac keeps them in ~/Pictures/wallpapers; Omarchy in ~/Wallpapers.
WALLPAPERS = next((p for p in (Path.home() / "Pictures/wallpapers", Path.home() / "Wallpapers") if p.is_dir()),
                  Path.home() / "Pictures/wallpapers")
# The blurred image is rendered at this machine's display size ([herdr] screen in its manifest).
SCREEN = tuple(machine.manifest().get("herdr", {}).get("screen", (3024, 1964)))
# The picker's thumbnails. A real folder under mods/: Herdr doesn't load images through a symlink.
THUMBS = HOME / "mods/wallpaper-thumbs"
IMAGE_TYPES = {".jpg", ".jpeg", ".png"}

# Translucent overrides on top of the theme. Alpha is the last two hex digits.
LOOK = {
    "terminal_opacity": 0.5,
    "sidebar": "#19172480",
    "pane": "#2321362e",
    "colors": {"border": "#e0def426", "chrome": "#1917248c", "surface": "#2321368c", "background": "#2321368c", "muted": "#b5afc9", "dim": "#a29bb7"},
}


def theme_look(name, explicit=True):
    """The translucent overrides for a theme, derived from its colors. None keeps the Rose Pine LOOK."""
    if not name or name == "none":
        return LOOK
    path = HOME / "themes" / f"{name}.json"
    if not path.exists():
        if explicit:
            sys.exit(f"frost: no theme {path}")
        # A theme saved by an earlier run that has since gone: fall back rather than break every run.
        print(f"frost: saved theme {name} is gone, using the Rose Pine glass", file=sys.stderr)
        return LOOK
    t = json.loads(path.read_text())
    bg, fg, c = t["background"], t["foreground"], t.get("colors", {})
    chrome = c.get("chrome", mix(bg, "#000000", 0.2))
    # Over a busy wallpaper, secondary text needs to sit closer to the foreground than in the opaque theme.
    muted, dim = mix(c.get("muted", mix(fg, bg, 0.35)), fg, 0.35), mix(c.get("dim", mix(fg, bg, 0.5)), fg, 0.35)
    return {
        "terminal_opacity": LOOK["terminal_opacity"],
        "sidebar": chrome + "80",
        "pane": bg + "2e",
        "tint": bg,
        "colors": {"border": fg + "26", "chrome": chrome + "8c", "surface": bg + "8c", "background": bg + "8c",
                   "muted": muted, "dim": dim},
    }


def mix(a, b, amount):
    """a moved toward b by amount (0..1), as #rrggbb."""
    ca, cb = [int(a[i:i + 2], 16) for i in (1, 3, 5)], [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * amount):02x}" for x, y in zip(ca, cb))


def saved_choice():
    """What the last run picked: {path, blur, theme}, from the picker's current.json."""
    try:
        return json.loads((THUMBS / "current.json").read_text())
    except (OSError, ValueError):
        return {}


GLASS_PANELS = {"ops-tasks", "jobs", "day-view", "artifacts", "factory", "claude-usage"}


def frost(src: Path, blur: float, tint: str, tint_amount: float) -> Path:
    im = Image.open(src).convert("RGB")
    # Sharp mode keeps the source resolution and lets Herdr fit it to the window.
    if blur > 0:
        scale = max(SCREEN[0] / im.width, SCREEN[1] / im.height)
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
        left, top = (im.width - SCREEN[0]) // 2, (im.height - SCREEN[1]) // 2
        im = im.crop((left, top, left + SCREEN[0], top + SCREEN[1]))
        # Blur small first: much faster than a huge radius at full size, same look.
        small = im.resize((SCREEN[0] // 4, SCREEN[1] // 4), Image.Resampling.LANCZOS)
        small = small.filter(ImageFilter.GaussianBlur(blur / 4))
        im = small.resize(SCREEN, Image.Resampling.LANCZOS)
    im = ImageEnhance.Color(im).enhance(1.15)
    im = Image.blend(im, Image.new("RGB", im.size, tint), tint_amount)
    out_dir = HOME / "backgrounds"
    out_dir.mkdir(exist_ok=True)
    for old in out_dir.glob("frosted-*.jpg"):
        old.unlink()
    # A new image path makes Herdr reload pixels instead of reusing its cached image.
    encoded = io.BytesIO()
    im.save(encoded, format="JPEG", quality=92)
    data = encoded.getvalue()
    digest = hashlib.sha256(data).hexdigest()[:12]
    out = out_dir / f"frosted-{src.stem.replace(' ', '-')}-{digest}.jpg"
    out.write_bytes(data)
    return out


def build_layout(background: Path, look=LOOK) -> None:
    # The installed copy: link.py writes one without the panels this machine lacks.
    layout = json.loads((HOME / "layouts/Parker.json").read_text())
    layout.pop("cloned_from", None)
    layout["background"] = {"image": str(background.relative_to(HOME)), "fit": "cover"}
    layout["terminal_opacity"] = look["terminal_opacity"]
    layout["colors"] = {**layout.get("colors", {}), **look["colors"]}

    def walk(node):
        if node.get("id") == "sidebar":
            node["background"] = look["sidebar"]
        pane = node.get("content", {}).get("pane") if isinstance(node.get("content"), dict) else None
        if pane:
            pane["background"] = look["pane"]
        # Panel mods paint theme().background, which stays opaque. With glass they paint chrome instead.
        if node.get("id") in GLASS_PANELS:
            node["content"]["props"] = {**node["content"].get("props", {}), "glass": True}
        for child in node.get("children", []):
            walk(child)

    walk(layout)
    # Written to the Herdr home directly: it is generated, so it isn't kept in dotfiles.
    (HOME / "layouts/Frosted.json").write_text(json.dumps(layout, indent=2) + "\n")


def current_background() -> Path:
    """The background the Frosted layout shows now, so a relayout keeps the wallpaper choice."""
    try:
        image = json.loads((HOME / "layouts/Frosted.json").read_text())["background"]["image"]
    except (OSError, ValueError, KeyError, TypeError):
        sys.exit("frost: no Frosted layout with a background yet; pick a wallpaper first (frost <image>)")
    path = HOME / image
    if not path.exists():
        sys.exit(f"frost: the Frosted background {path} is missing; pick a wallpaper again (frost <image>)")
    return path


def wallpapers() -> list[Path]:
    seen, out = set(), []
    for f in sorted(WALLPAPERS.rglob("*")):
        if f.suffix.lower() in IMAGE_TYPES and f.stem not in seen:
            seen.add(f.stem)
            out.append(f)
    return out


def build_thumbs() -> None:
    THUMBS.mkdir(parents=True, exist_ok=True)
    for old in THUMBS.glob("*.jpg"):
        old.unlink()
    index = []
    for i, f in enumerate(wallpapers()):
        im = Image.open(f).convert("RGB")
        im.draft("RGB", (640, 400))
        scale = max(320 / im.width, 200 / im.height)
        im = im.resize((round(im.width * scale) + 1, round(im.height * scale) + 1), Image.Resampling.LANCZOS)
        left, top = (im.width - 320) // 2, (im.height - 200) // 2
        thumb = THUMBS / f"{i:03d}.jpg"
        im.crop((left, top, left + 320, top + 200)).save(thumb, quality=85)
        index.append({"path": str(f), "name": f.stem.replace("-", " "), "group": f.parent.name,
                      "thumb": str(thumb.relative_to(HOME))})
    (THUMBS / "index.json").write_text(json.dumps(index, indent=1) + "\n")
    print(f"{len(index)} thumbnails in {THUMBS}")


def set_desktop(src: Path) -> None:
    if sys.platform != "darwin":
        sys.exit("--desktop sets the macOS desktop wallpaper only")
    script = f'tell application "System Events" to tell every desktop to set picture to POSIX file "{src}"'
    subprocess.run(["osascript", "-e", script], check=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("image", nargs="?", type=Path)
    p.add_argument("--blur", type=float, default=90, help="blur radius in screen px, 0 for sharp (default 90)")
    p.add_argument("--tint", help="color mixed over the blur (default: the theme's background, else rose-pine-moon base)")
    p.add_argument("--theme", help="theme in themes/ whose colors tint the glass; 'none' for the Rose Pine look")
    p.add_argument("--tint-amount", type=float, default=0.2, help="0..1 (default 0.2)")
    p.add_argument("--desktop", action="store_true", help="also set the sharp wallpaper on the macOS desktop")
    p.add_argument("--list", action="store_true")
    p.add_argument("--thumbs", action="store_true")
    p.add_argument("--relayout", action="store_true", help="rebuild the Frosted layout from Parker, keeping its background")
    args = p.parse_args()

    saved = saved_choice()
    theme = args.theme if args.theme is not None else saved.get("theme")
    look = theme_look(theme, explicit=args.theme is not None)

    def remember(**changes):
        THUMBS.mkdir(parents=True, exist_ok=True)
        (THUMBS / "current.json").write_text(json.dumps({**saved, **changes, "theme": theme}) + "\n")

    if args.relayout:
        bg = current_background()
        build_layout(bg, look)
        if args.theme is not None:
            remember()
        print(f"rebuilt Frosted from Parker with {bg.name}" + (f" and the {theme} theme" if theme else ""))
        return

    if args.thumbs:
        build_thumbs()
        return
    if args.list or not args.image:
        for f in wallpapers():
            print(f)
        return
    src = args.image.expanduser().resolve()
    bg = frost(src, args.blur, args.tint or look.get("tint", "#232136"), args.tint_amount)
    build_layout(bg, look)
    if args.desktop:
        set_desktop(src)
    remember(path=str(src), blur=args.blur)
    print(f"frosted {src.name} -> {bg}")


if __name__ == "__main__":
    main()
