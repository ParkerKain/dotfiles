#!/usr/bin/env python3
"""Puts back the look Look tryout changed. Runs as one process so it finishes after the window goes.

    restore.py '<json>'

The JSON has `settings` (the real settings.json path), `fonts` ({font, ui_font} to write back),
`theme` (a theme name for `herdr-app do app.theme`, or null), `layout` (the layout the tryout ran
in) and `frost` (argv to rebuild the Frosted layout and wallpaper, or null).

Herdr cancels a closing mod's tasks after 250 ms, while a process it already started keeps
running, so the mod hands the whole restore to this script.
"""
import json
import os
import subprocess
import sys
import time


def wait_for_frost(limit=90):
    """A wallpaper render the tryout started may still be running. Let it land first, or it would
    overwrite the restored layout when it finishes."""
    end = time.time() + limit
    while time.time() < end:
        r = subprocess.run(["pgrep", "-f", "herdr-app/frost.py"], capture_output=True)
        if r.returncode != 0:
            return
        time.sleep(0.3)


def shown_layout():
    r = subprocess.run(["herdr-app", "status"], capture_output=True, text=True)
    try:
        return json.loads(r.stdout).get("layout")
    except ValueError:
        return None


def restore_theme(name, layout, limit=1800):
    """app.theme sets the shown layout's theme. When a layout switch closed the window, wait in a
    detached child until the tryout's layout shows again, so the restore lands on it and not on the
    one switched to (and the mod's exec timeout can't cut the wait short)."""
    if layout and shown_layout() != layout:
        if os.fork() > 0:
            return
        # Let go of the mod's output pipes, or its exec would wait for this child too.
        os.setsid()
        null = os.open(os.devnull, os.O_RDWR)
        for fd in (0, 1, 2):
            os.dup2(null, fd)
    end = time.time() + limit
    while layout and shown_layout() != layout and time.time() < end:
        time.sleep(2)
    if not layout or shown_layout() == layout:
        subprocess.run(["herdr-app", "do", "app.theme", json.dumps({"name": name})], capture_output=True)


def main():
    job = json.loads(sys.argv[1])
    wait_for_frost()
    fonts = job.get("fonts") or {}
    if fonts and job.get("settings"):
        path = job["settings"]
        with open(path) as f:
            data = json.load(f)
        data.update(fonts)
        tmp = f"{path}.look-tryout.tmp"
        with open(tmp, "w") as f:
            f.write(json.dumps(data, indent=2) + "\n")
        os.replace(tmp, path)
    if job.get("frost"):
        subprocess.run(job["frost"], capture_output=True)
    if job.get("theme"):
        restore_theme(job["theme"], job.get("layout"))


if __name__ == "__main__":
    main()
