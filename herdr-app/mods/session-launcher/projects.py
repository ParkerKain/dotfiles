"""Discover canonical repositories and record session routing decisions."""
import datetime
import json
from pathlib import Path
import sys


def catalog(home):
    descriptions = json.loads(Path(__file__).with_name("projects.json").read_text())
    repos = home / "Documents/internal/repos"
    # Linked worktrees have a .git file. Offer the owning checkout instead.
    folders = [p for p in repos.iterdir() if p.is_dir() and (p / ".git").is_dir()]
    folders.append(home / "dotfiles")
    projects = []
    for folder in sorted(set(folders)):
        description = descriptions.get(folder.name)
        if not description:
            readme = next((p for p in [folder / "README.md", folder / "README"] if p.is_file()), None)
            description = readme.read_text(errors="replace")[:1000] if readme else folder.name
        projects.append(dict(id=str(folder), name=folder.name, folder=str(folder), description=description))
    return projects


if __name__ == "__main__":
    if sys.argv[1] == "catalog":
        print(json.dumps(catalog(Path.home())))
    elif sys.argv[1] == "log":
        record = json.loads(sys.argv[2])
        record["time"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        path = Path.home() / ".cache/herdr-app/session-routing.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as stream:
            stream.write(json.dumps(record) + "\n")
    else:
        raise SystemExit("Unknown action")
