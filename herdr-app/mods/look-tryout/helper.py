#!/usr/bin/env python3
"""Look tryout's file and layout work, run as its own process.

    helper.py patch <path> '<json>'   merge keys into a JSON file, rewriting it in place
    helper.py restore '<json>'        put back the look the tryout changed
    helper.py keep '<json>'           make the shown look stick in every layout

Why a process: Herdr cancels a closing mod's tasks after 250 ms, while a process it already
started keeps running. Why in place: ~/.config/herdr-app/settings.json links into dotfiles, and
an atomic replace gives the target a new inode, after which Herdr stops seeing changes to it.

restore and keep take {settings, fonts, theme, layout, frost}: the real settings.json path, the
{font, ui_font} to write, the theme for `herdr-app do app.theme`, the layout the tryout ran in, and
the argv that rebuilds the Frosted layout (or null). keep also takes `base` (settings.base.json,
written so link.py merges the choice back in) and `layouts` (every layout whose theme to set).
"""
import json
import os
import subprocess
import sys
import time


def patch(path, changes):
    with open(path, "r+") as f:
        data = json.load(f)
        data.update(changes)
        f.seek(0)
        f.write(json.dumps(data, indent=2) + "\n")
        f.truncate()


def herdr(*args):
    return subprocess.run(["herdr-app", *args], capture_output=True, text=True)


def shown_layout():
    try:
        return json.loads(herdr("status").stdout).get("layout")
    except ValueError:
        return None


def wait_for_frost(limit=90):
    """A render the tryout started may still be running. Let it land first, or it would overwrite
    the restored layout when it finishes. Matches the shell wrapper too, which starts first."""
    end = time.time() + limit
    while time.time() < end:
        if subprocess.run(["pgrep", "-f", "herdr-app/frost"], capture_output=True).returncode != 0:
            return
        time.sleep(0.3)


def detach():
    """Fork and let the parent return, so the mod's exec (and its timeout) doesn't wait on us."""
    if os.fork() > 0:
        return False
    os.setsid()
    null = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(null, fd)
    return True


def restore_theme(name, layout, limit=1800):
    """app.theme sets the shown layout's theme. When a layout switch closed the window, wait in a
    detached child until the tryout's layout shows again, so the restore lands on it and not on the
    one switched to."""
    if not layout or shown_layout() == layout:
        herdr("do", "app.theme", json.dumps({"name": name}))
        return
    if not detach():
        return
    end = time.time() + limit
    while shown_layout() != layout and time.time() < end:
        time.sleep(2)
    if shown_layout() == layout:
        herdr("do", "app.theme", json.dumps({"name": name}))
    os._exit(0)


def write_fonts(job):
    if job.get("fonts") and job.get("settings"):
        patch(job["settings"], job["fonts"])


def restore(job):
    wait_for_frost()
    write_fonts(job)
    if job.get("frost"):
        subprocess.run(job["frost"], capture_output=True)
    if job.get("theme"):
        restore_theme(job["theme"], job.get("layout"))


def keep(job):
    wait_for_frost()
    write_fonts(job)
    if job.get("base"):
        patch(job["base"], {"theme": job["theme"], **(job.get("fonts") or {})})
    if job.get("frost"):
        subprocess.run(job["frost"], capture_output=True)
    # app.theme only reaches the shown layout, so visit each other layout briefly and come back.
    home = shown_layout()
    for name in job.get("layouts") or []:
        if name != home:
            herdr("do", "layout.switch", json.dumps({"name": name}))
            time.sleep(0.4)
            herdr("do", "app.theme", json.dumps({"name": job["theme"]}))
    if home:
        herdr("do", "layout.switch", json.dumps({"name": home}))
        time.sleep(0.4)
        herdr("do", "app.theme", json.dumps({"name": job["theme"]}))


def main():
    mode = sys.argv[1]
    if mode == "patch":
        patch(sys.argv[2], json.loads(sys.argv[3]))
    elif mode == "restore":
        restore(json.loads(sys.argv[2]))
    elif mode == "keep":
        keep(json.loads(sys.argv[2]))
    else:
        sys.exit(f"helper.py: unknown mode {mode}")


if __name__ == "__main__":
    main()
