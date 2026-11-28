#!/usr/bin/env python3
"""Saved looks for Herdr: a theme, terminal and UI fonts, and the Frosted wallpaper with its glass.

    python3 herdr-app/look.py list [--json]       the presets in looks/
    python3 herdr-app/look.py current             the look showing now, as preset JSON
    python3 herdr-app/look.py save <slug> --name "Terafox green"
    python3 herdr-app/look.py apply <slug>

`apply` sets the theme in every one of Parker's layouts, writes the fonts to settings.json and
settings.base.json (so link.py keeps them), and re-renders the Frosted wallpaper with its glass.
It hands that work to the Look tryout helper, which already does the same for the tryout's keep.
The Look presets picker (command palette) runs this script.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOOKS = HERE / "looks"
HOME = Path.home() / ".config/herdr-app"
HELPER = HERE / "mods/look-tryout/helper.py"
LAYOUTS = ["Parker", "Frosted", "Meeting", "Demo"]


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def tilde(path):
    home = str(Path.home())
    return "~" + path[len(home):] if path and path.startswith(home + "/") else path


def current():
    """The look showing now: the Frosted (else Parker) layout's dark theme pick, settings.json's
    fonts, and the wallpaper the picker last applied."""
    settings = read_json(HOME / "settings.json", {})
    theme = settings.get("theme")
    for layout in ("Frosted", "Parker"):
        pick = (read_json(HOME / "layouts/.state" / f"{layout}.json", {}) or {}).get("theme")
        if isinstance(pick, dict) and pick.get("dark"):
            theme = pick["dark"]
            break
        if isinstance(pick, str):
            theme = pick
            break
    wall = read_json(HOME / "mods/wallpaper-thumbs/current.json", {}) or {}
    return {
        "theme": theme,
        "font": settings.get("font"),
        "ui_font": settings.get("ui_font"),
        "wallpaper": {"path": tilde(wall.get("path")), "blur": wall.get("blur", 0), "glass": wall.get("theme") or "none"}
        if wall.get("path") else None,
    }


def presets():
    out = []
    for f in sorted(LOOKS.glob("*.json")):
        look = read_json(f)
        if look:
            out.append({"slug": f.stem, **look})
    return out


def apply(slug):
    look = read_json(LOOKS / f"{slug}.json")
    if not look:
        sys.exit(f"look: no preset {slug} in {LOOKS}")
    wall = look.get("wallpaper")
    frost = None
    if wall and (HOME / "layouts/Frosted.json").exists():
        path = os.path.expanduser(wall["path"])
        if Path(path).exists():
            frost = [str(HERE / "frost"), path, "--blur", str(wall.get("blur", 0)), "--theme", wall.get("glass") or "none"]
        else:
            print(f"look: wallpaper {path} is missing, keeping the current one", file=sys.stderr)
    job = {
        "settings": os.path.realpath(HOME / "settings.json"),
        "base": str(HERE / "settings.base.json"),
        "theme": look["theme"],
        "fonts": {k: look[k] for k in ("font", "ui_font") if look.get(k)},
        "layouts": [l for l in LAYOUTS if (HOME / "layouts" / f"{l}.json").exists()],
        "frost": frost,
    }
    subprocess.run([sys.executable, str(HELPER), "keep", json.dumps(job)], check=True)
    print(f"applied {look.get('name', slug)}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    ls = sub.add_parser("list")
    ls.add_argument("--json", action="store_true")
    sub.add_parser("current")
    sv = sub.add_parser("save")
    sv.add_argument("slug")
    sv.add_argument("--name")
    ap = sub.add_parser("apply")
    ap.add_argument("slug")
    args = p.parse_args()

    if args.cmd == "list":
        items = presets()
        if args.json:
            print(json.dumps(items))
        else:
            for x in items:
                print(f"{x['slug']:24} {x.get('name', '')}  ({x['theme']}, {x.get('font')}, {x.get('ui_font')})")
    elif args.cmd == "current":
        print(json.dumps(current(), indent=2))
    elif args.cmd == "save":
        LOOKS.mkdir(exist_ok=True)
        look = {"name": args.name or args.slug.replace("-", " ").title(), **current()}
        (LOOKS / f"{args.slug}.json").write_text(json.dumps(look, indent=2) + "\n")
        print(f"saved looks/{args.slug}.json")
    elif args.cmd == "apply":
        apply(args.slug)


if __name__ == "__main__":
    main()
