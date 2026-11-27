#!/usr/bin/env python3
"""Link this machine's Herdr setup from dotfiles, as its manifest says.

  python3 herdr-app/link.py            link everything for this machine
  python3 herdr-app/link.py --check    report what differs, change nothing (exit 1 if anything does)

What it does, from herdr-app/machines/<machine>.toml:

- keys.json: links machines/<machine>/keys.json.
- settings.json: merges settings.base.json and machines/<machine>/settings.json into
  Herdr's settings, keeping what Herdr writes itself (zoom, sizes you never set here).
- layouts: links each listed layout. Where a layout has blocks whose mod this machine
  doesn't have (Tasks, the day strip, glances and the floating Lock-in on Omarchy), it
  writes a copy without them instead.
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
    def __init__(self, manifest, herdr_home, bin_dir, check, sandboxed=False):
        self.m = manifest
        self.home = herdr_home
        self.bin = bin_dir
        self.check = check
        self.sandboxed = sandboxed
        self.changes = []
        # A sandboxed run (tests) keeps everything under its own folders, never the real home.
        state = herdr_home / ".link-state" if sandboxed else Path.home() / ".local/state/herdr-link"
        self.backups = state / "backups" / time.strftime("%Y%m%d-%H%M%S")
        self.name_file = herdr_home.parent / "parker/machine" if sandboxed else machine.NAME_FILE

    def note(self, message):
        self.changes.append(message)
        print(("would " if self.check else "") + message)

    def backup(self, path):
        """Move a real file or folder aside before replacing it."""
        base = self.home.parent.parent if self.sandboxed else Path.home()
        dest = self.backups / path.relative_to(base) if path.is_relative_to(base) else self.backups / path.name
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

    def write(self, dest, text, backup=True):
        if not dest.is_symlink() and dest.is_file() and dest.read_text() == text:
            return
        self.note(f"write {dest}")
        if self.check:
            return
        replace_file(dest, text, self.backup if backup else None)

    def unlink(self, dest, why):
        self.note(f"remove {dest} ({why})")
        if not self.check:
            dest.unlink()

    # ---- pieces

    def machine_name(self):
        self.write(self.name_file, self.m["name"] + "\n", backup=False)

    def keys(self):
        self.link(self.m["dir"] / "keys.json", self.home / "keys.json")

    def settings(self):
        wanted = {}
        for path in (HERE / "settings.base.json", self.m["dir"] / "settings.json"):
            if path.exists():
                wanted = deep_merge(wanted, json.loads(path.read_text()))
        wanted = dict(expand_home(wanted))
        dest = self.home / "settings.json"
        # The Mac's settings.json links to an untracked file in ~/dotfiles; write through it.
        real = dest.resolve() if dest.is_symlink() else dest
        try:
            current = json.loads(real.read_text())
        except FileNotFoundError:
            current = {}
        except ValueError as exc:
            sys.exit(f"link: {real} isn't valid JSON ({exc}); fix it by hand, then run link.py again")
        if not isinstance(current, dict):
            sys.exit(f"link: {real} should hold a JSON object; fix it by hand, then run link.py again")
        merged = deep_merge(current, wanted)
        if merged != current:
            changed = sorted(k for k in wanted if current.get(k) != merged[k])
            self.note(f"set {', '.join(changed)} in {real}")
            if not self.check:
                replace_file(real, json.dumps(merged, indent=2) + "\n", self.backup if real.exists() else None)

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
        env = {**os.environ, "PARKER_MACHINE": self.m["name"]}
        if self.sandboxed:
            # Never the real scheduler or its folders from a sandboxed run.
            env["JOB_SCHEDULER"] = "none"
            state = self.home / ".link-state"
            for key, folder in (("JOB_LAUNCHD_DIR", "launchd"), ("JOB_SYSTEMD_DIR", "systemd"), ("JOB_STATE_DIR", "jobs")):
                env.setdefault(key, str(state / folder))
        out = subprocess.run(args, capture_output=True, text=True, env=env)
        for line in out.stdout.splitlines():
            print(line)
            if line.startswith(("would ", "rewrote ", "stale ")):
                self.changes.append(line)
        # 0: all current, 3: --check found drift (listed above). Anything else failed.
        if out.returncode not in (0, 3):
            sys.stderr.write(out.stderr)
            sys.exit(f"link: job refresh failed (exit {out.returncode}); the schedules named above kept their old version")

    def run(self):
        for step in (self.machine_name, self.keys, self.settings, self.layouts, self.themes, self.mods, self.engine):
            step()
        return self.changes


def replace_file(dest, text, backup=None):
    """Write by rename, so a half-written file never shows. backup moves the old one aside first."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_symlink():
        dest.unlink()
    elif dest.exists() and backup:
        backup_copy = dest.with_name(f".{dest.name}.link-old")
        backup_copy.write_bytes(dest.read_bytes())
        backup(backup_copy)
    tmp = dest.with_name(f".{dest.name}.link-tmp")
    tmp.write_text(text)
    os.replace(tmp, dest)


def deep_merge(current, wanted):
    """wanted on top of current, merging nested objects (Herdr may add keys inside sounds)."""
    out = dict(current)
    for key, value in wanted.items():
        out[key] = deep_merge(current[key], value) if isinstance(value, dict) and isinstance(current.get(key), dict) else value
    return out


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
    """A copy of a layout tree without the mods in drop.

    Blocks whose mod is in drop go, whether they are children (side panels, bands, status
    blocks) or floating blocks. A dropped pane header mod becomes Herdr's shipped `pane`,
    and a dropped root toast mod is removed so Herdr's own toast draws.
    """
    node = dict(node)
    dropped = lambda c: isinstance(c.get("content"), dict) and c["content"].get("mod") in drop
    if "children" in node:
        kept = [drop_panels(c, drop) for c in node["children"] if not dropped(c)]
        node["children"] = kept
        if node.get("type") == "stack" and kept and node.get("active") not in {c.get("id") for c in kept}:
            node["active"] = kept[0].get("id")
    if "floating" in node:
        kept = [f for f in node["floating"] if not dropped(f)]
        if kept:
            node["floating"] = kept
        else:
            del node["floating"]
    header = (node.get("content") or {}).get("pane", {}).get("header") if isinstance(node.get("content"), dict) else None
    if isinstance(header, dict) and isinstance(header.get("content"), dict) and header["content"].get("mod") in drop:
        node["content"] = json.loads(json.dumps(node["content"]))
        node["content"]["pane"]["header"]["content"] = {"mod": "pane"}
    if node.get("toast") in drop:
        del node["toast"]
    return node


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--check", action="store_true", help="report what differs and change nothing")
    p.add_argument("--machine", help="link as this machine instead of detecting it")
    p.add_argument("--herdr-home", type=Path, help="Herdr's config folder (default ~/.config/herdr-app)")
    p.add_argument("--bin-dir", type=Path, help="where to link the job CLI (default ~/.local/bin)")
    args = p.parse_args()

    # Tests link into a temp folder and pass both; anything touching the real setup runs from ~/dotfiles.
    sandboxed = bool(args.herdr_home and args.bin_dir)
    if not sandboxed and (Path.home() / "dotfiles").resolve() != HERE.parent:
        sys.exit(f"link: run this from ~/dotfiles, not {HERE.parent}; links point at the checkout that runs it")
    manifest = machine.manifest(args.machine)
    platform = manifest.get("platform")
    if platform and platform != sys.platform and not os.environ.get("LINK_ANY_PLATFORM"):
        sys.exit(f"link: {manifest['name']} is a {platform} machine and this is {sys.platform}; check --machine")
    if args.machine:
        os.environ["PARKER_MACHINE"] = args.machine
    herdr_home = args.herdr_home or Path.home() / ".config/herdr-app"
    bin_dir = args.bin_dir or Path.home() / ".local/bin"
    print(f"{'Checking' if args.check else 'Linking'} Herdr for {manifest['name']}")
    changes = Linker(manifest, herdr_home, bin_dir, args.check, sandboxed).run()
    if not changes:
        print("Everything already matches.")
    sys.exit(1 if args.check and changes else 0)


if __name__ == "__main__":
    main()
