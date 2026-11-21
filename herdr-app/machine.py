"""Which machine this is, and what that machine's Herdr setup holds.

Each machine has a manifest at herdr-app/machines/<name>.toml. The link script,
the job engine and the session launcher all read it through this module, so one
file decides what a machine installs, schedules and offers.

The machine name comes from, in order: $PARKER_MACHINE, the file
~/.config/parker/machine (written by link.py), or the platform (macOS -> mac,
Linux -> omarchy).
"""
import os
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python before 3.11 (macOS /usr/bin/python3)
    tomllib = None

HERE = Path(__file__).resolve().parent
MACHINES = HERE / "machines"
NAME_FILE = Path.home() / ".config/parker/machine"
PLATFORM_DEFAULTS = {"darwin": "mac", "linux": "omarchy"}


def need_tomllib():
    """Re-run the calling script under a Python that has tomllib, or exit with a reason."""
    if tomllib is not None:
        return
    for py in ("/opt/homebrew/bin/python3", "/usr/local/bin/python3"):
        if os.path.exists(py) and os.path.realpath(sys.executable) != os.path.realpath(py):
            os.execv(py, [py, *sys.argv])
    sys.exit("needs Python 3.11 or newer")


def name():
    env = os.environ.get("PARKER_MACHINE", "").strip()
    if env:
        return env
    try:
        saved = NAME_FILE.read_text().strip()
        if saved:
            return saved
    except OSError:
        pass
    try:
        return PLATFORM_DEFAULTS[sys.platform]
    except KeyError:
        sys.exit(f"no machine name for platform {sys.platform}; set PARKER_MACHINE")


def expand(path):
    return Path(os.path.expanduser(str(path)))


def manifest(machine=None):
    """The machine's manifest as a dict, with `name` and `dir` (its per-machine folder) added."""
    need_tomllib()
    machine = machine or name()
    path = MACHINES / f"{machine}.toml"
    if not path.exists():
        known = ", ".join(sorted(p.stem for p in MACHINES.glob("*.toml")))
        sys.exit(f"no manifest for machine '{machine}' at {path} (known: {known})")
    assert tomllib is not None
    data = tomllib.loads(path.read_text())
    data["name"] = machine
    data["dir"] = MACHINES / machine
    return data


if __name__ == "__main__":
    print(name())
