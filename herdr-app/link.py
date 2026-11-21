#!/usr/bin/env python3
"""Link this machine's Herdr setup from dotfiles, as its manifest says.

  python3 herdr-app/link.py            link everything for this machine
  python3 herdr-app/link.py --check    report what differs, change nothing (exit 1 if anything does)

What it does, from herdr-app/machines/<machine>.toml:

- keys.json: links machines/<machine>/keys.json.
- settings.json: merges settings.base.json and machines/<machine>/settings.json into
  Herdr's settings, keeping what Herdr writes itself (zoom, sizes you never set here).
- layouts: links each listed layout. Where a layout has panels whose mod this machine
  doesn't have (Tasks on Omarchy), it writes a copy without them instead.
- themes: links every theme.
- mods: links each listed mod, and removes links to dotfiles mods the machine no longer lists.
- ~/.local/bin/job: links the job engine, then rewrites the schedules of jobs and hooks
  that are turned on, so they point at the current engine.

Run it from ~/dotfiles, not a worktree: the links point at the checkout it runs from.
Existing files it replaces are moved to ~/.local/state/herdr-link/backups/.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import machine  # noqa: E402

machine.need_tomllib()


class Linker:
    def __init__(self, manifest, herdr_home, bin_dir, check):
        self.m = manifest
        self.home = herdr_home
        self.bin = bin_dir
        self.check = check
        self.changes = []
        self.backups = Path.home() / ".local/state/herdr-link/backups" / time.strftime("%Y%m%d-%H%M%S")

    def note(self, message):
        self.changes.append(message)
        print(("would " if self.check else "") + message)

    def backup(self, path):
        """Move a real file or folder aside before replacing it."""
        dest = self.backups / path.relative_to(Path.home()) if path.is_relative_to(Path.home()) else self.backups / path.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        path.rename(dest)
        print(f"moved aside {path} -> {dest}")

    def link(self, target, dest):
        if dest.is_symlink() and Path(os.readlink(dest)) == target:
            return
        self.note(f"link {dest} -> {target}")
        if self.check:
            return
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and not dest.is_symlink():
            self.backup(dest)
        # Replace by rename, so Herdr sees a new link (it misses edits behind an existing one).
        tmp = dest.with_name(f".{dest.name}.link-tmp")
        tmp.unlink(missing_ok=True)
        tmp.symlink_to(target)
        os.replace(tmp, dest)

    def write(self, dest, text):
        if not dest.is_symlink() and dest.is_file() and dest.read_text() == text:
            return
        self.note(f"write {dest}")
        if self.check:
            return
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.is_symlink():
            dest.unlink()
        tmp = dest.with_name(f".{dest.name}.link-tmp")
        tmp.write_text(text)
        os.replace(tmp, dest)

    def unlink(self, dest, why):
        self.note(f"remove {dest} ({why})")
        if not self.check:
            dest.unlink()

    # ---- pieces

    def machine_name(self):
        self.write(machine.NAME_FILE, self.m["name"] + "\n")

    def keys(self):
        self.link(self.m["dir"] / "keys.json", self.home / "keys.json")

    def settings(self):
        wanted = {}
        for path in (HERE / "settings.base.json", self.m["dir"] / "settings.json"):
            if path.exists():
                wanted.update(json.loads(path.read_text()))
        wanted = dict(expand_home(wanted))
        dest = self.home / "settings.json"
        # The Mac's settings.json links to an untracked file in ~/dotfiles; write through it.
        real = dest.resolve() if dest.is_symlink() else dest
        try:
            current = json.loads(real.read_text())
        except (OSError, ValueError):
            current = {}
        merged = {**current, **wanted}
        if merged != current:
            changed = sorted(k for k in wanted if current.get(k) != wanted[k])
            self.note(f"set {', '.join(changed)} in {real}")
            if not self.check:
                real.parent.mkdir(parents=True, exist_ok=True)
                real.write_text(json.dumps(merged, indent=2) + "\n")

    def layouts(self):
        drop = dropped_mods(self.m)
        for name in self.m["herdr"].get("layouts", []):
            source = HERE / "layouts" / f"{name}.json"
            layout = json.loads(source.read_text())
            trimmed = drop_panels(layout, drop)
            dest = self.home / "layouts" / f"{name}.json"
            if trimmed == layout:
                self.link(source, dest)
            else:
                self.write(dest, json.dumps(trimmed, indent=2) + "\n")

    def themes(self):
        for theme in sorted((HERE / "themes").glob("*.json")):
            self.link(theme, self.home / "themes" / theme.name)

    def mods(self):
        wanted = self.m["herdr"].get("mods", [])
        for name in wanted:
            source = HERE / "mods" / name
            if not (source / "mod.json").exists():
                sys.exit(f"link: {self.m['name']} lists mod '{name}', which isn't in {HERE / 'mods'}")
            self.link(source, self.home / "mods" / name)
        # A dotfiles mod this machine no longer lists: take its link away.
        folder = self.home / "mods"
        for dest in sorted(folder.iterdir()) if folder.is_dir() else []:
            if dest.is_symlink() and dest.name not in wanted and points_into(dest, HERE / "mods"):
                self.unlink(dest, f"not listed for {self.m['name']}")

    def engine(self):
        self.link(HERE / "jobs/job", self.bin / "job")
        if not (self.bin / "job").exists() and self.check:
            return
        # Turned-on jobs and hooks keep their schedule; rewrite it so it runs this engine.
        args = [sys.executable, str(HERE / "jobs/job"), "refresh"] + (["--check"] if self.check else [])
        out = subprocess.run(args, capture_output=True, text=True, env={**os.environ, "PARKER_MACHINE": self.m["name"]})
        for line in out.stdout.splitlines():
            print(line)
            if line.startswith(("would ", "rewrote ", "stale ")):
                self.changes.append(line)
        if out.returncode not in (0, 1):
            sys.exit(f"link: job refresh failed: {out.stderr.strip()}")

    def run(self):
        for step in (self.machine_name, self.keys, self.settings, self.layouts, self.themes, self.mods, self.engine):
            step()
        return self.changes


def expand_home(value) -> "dict | str | object":
    """'~/...' strings become absolute paths: Herdr reads settings literally."""
    if isinstance(value, dict):
        return {k: expand_home(v) for k, v in value.items()}
    if isinstance(value, str) and value.startswith("~/"):
        return str(Path.home() / value[2:])
    return value


def points_into(link, folder):
    target = Path(os.readlink(link))
    target = target if target.is_absolute() else link.parent / target
    # Compare without resolving the link, so a link to a deleted mod still counts.
    real_folder = folder.resolve()
    return any(str(target).startswith(str(f) + os.sep) for f in {folder, real_folder, Path.home() / "dotfiles/herdr-app/mods"})


def all_manifests():
    return [machine.manifest(p.stem) for p in sorted(machine.MACHINES.glob("*.toml"))]


def dropped_mods(manifest):
    """Mods some machine provides that this one doesn't: their layout blocks are removed."""
    ours = set(manifest["herdr"].get("mods", [])) | set(manifest["herdr"].get("external_mods", []))
    known = {p.parent.name for p in (HERE / "mods").glob("*/mod.json")}
    for other in all_manifests():
        known |= set(other["herdr"].get("external_mods", []))
    return known - ours


def drop_panels(node, drop):
    """A copy of a layout tree without blocks whose mod is in drop."""
    node = dict(node)
    if "children" in node:
        kept = [drop_panels(c, drop) for c in node["children"]
                if not (isinstance(c.get("content"), dict) and c["content"].get("mod") in drop)]
        node["children"] = kept
        if node.get("type") == "stack" and kept and node.get("active") not in {c.get("id") for c in kept}:
            node["active"] = kept[0].get("id")
    return node


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--check", action="store_true", help="report what differs and change nothing")
    p.add_argument("--machine", help="link as this machine instead of detecting it")
    p.add_argument("--herdr-home", type=Path, help="Herdr's config folder (default ~/.config/herdr-app)")
    p.add_argument("--bin-dir", type=Path, help="where to link the job CLI (default ~/.local/bin)")
    args = p.parse_args()

    if not args.herdr_home and (Path.home() / "dotfiles").resolve() != HERE.parent:
        sys.exit(f"link: run this from ~/dotfiles, not {HERE.parent}; links point at the checkout that runs it")
    manifest = machine.manifest(args.machine)
    if args.machine:
        os.environ["PARKER_MACHINE"] = args.machine
    herdr_home = args.herdr_home or Path.home() / ".config/herdr-app"
    bin_dir = args.bin_dir or Path.home() / ".local/bin"
    print(f"{'Checking' if args.check else 'Linking'} Herdr for {manifest['name']}")
    changes = Linker(manifest, herdr_home, bin_dir, args.check).run()
    if not changes:
        print("Everything already matches.")
    sys.exit(1 if args.check and changes else 0)


if __name__ == "__main__":
    main()
