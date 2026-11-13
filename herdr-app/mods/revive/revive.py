#!/usr/bin/env python3
"""Helper for the revive mod: finished herdr-core terminals, and how to bring one back.

  revive.py list          JSON list of recently finished terminals, newest first
  revive.py resume <t>    JSON {argv, how} that restores terminal <t>
"""
import glob
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

HOME = os.path.expanduser("~")
MAX_AGE_MS = 7 * 24 * 3600 * 1000
LIMIT = 60
NOISE = re.compile(r"^[\s─━-]*$|-- INSERT --|jobs SIGHUPed|^\s*⏵⏵|shift\+tab to cycle|· /effort")


def hc(*args):
    return subprocess.run(["hc", *args], capture_output=True, text=True).stdout


def read_screen(t):
    lines = [l.rstrip() for l in hc("read", t).splitlines()]
    return [l for l in lines if l.strip() and not NOISE.search(l)]


def kind_of(term, info, screen):
    agent = (term.get("agent") or "").lower()
    argv = " ".join(info.get("argv") or []).lower()
    text = "\n".join(screen)
    if agent.startswith("claude") or " claude " in f" {argv} " or "⏵⏵" in text or "✻ " in text:
        return "claude"
    title = info.get("title") or ""
    codex_title = title.endswith(" | " + os.path.basename(info.get("cwd") or "/"))
    if agent == "codex" or (info.get("argv") or [""])[0] == "codex" or " codex " in f" {argv} " or codex_title:
        return "codex"
    if agent in ("zsh", "bash", "fish", "sh"):
        return "shell"
    return None


def describe(term):
    t = term["address"]
    info = json.loads(hc("get", t, "--json") or "{}")
    labels = info.get("labels") or {}
    if labels.get("revive.restored") or labels.get("revive.hidden"):
        return None
    screen = read_screen(t)
    kind = kind_of(term, info, screen)
    if not kind:
        return None
    where = term.get("where") or labels.get("where") or ""
    return {
        "address": t,
        "kind": kind,
        "title": info.get("title") or term.get("name") or "",
        "name": term.get("name") or "",
        "where": where,
        "tab": where.split(" / ", 1)[-1] if " / " in where else "",
        "space": labels.get("herdr.space"),
        "cwd": info.get("cwd") or term.get("cwd") or HOME,
        "parent": term.get("parent"),
        "reason": term.get("reason") or "",
        "finished_ms": info.get("finished_ms") or 0,
        "preview": screen[-60:],
    }


def cmd_list():
    now = int(datetime.now().timestamp() * 1000)
    terms = [x for x in json.loads(hc("ls", "--all", "--json"))["terminals"] if x.get("state") == "finished"]
    with ThreadPoolExecutor(12) as pool:
        rows = [r for r in pool.map(describe, terms) if r and now - r["finished_ms"] < MAX_AGE_MS]
    rows.sort(key=lambda r: r["finished_ms"], reverse=True)
    print(json.dumps(rows[:LIMIT]))


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def user_texts(path):
    """Typed user prompts in a Claude transcript (not tool results or meta lines)."""
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if '"type":"user"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if d.get("type") != "user" or d.get("isMeta"):
                continue
            c = (d.get("message") or {}).get("content")
            if isinstance(c, str):
                yield norm(c)
            elif isinstance(c, list):
                for part in c:
                    if isinstance(part, dict) and part.get("type") == "text":
                        yield norm(part.get("text", ""))


def claude_session(info, screen):
    argv = info.get("argv") or []
    prompts = [norm(m.group(1)) for l in screen if (m := re.match(r"^\s*❯ (.+)", l))]
    prompts = [p for p in reversed(prompts) if len(p) > 3 and "SIGHUPed" not in p]
    if "claude" in argv and argv[-1] != "claude":
        prompts.append(norm(argv[-1]))
    probes = [p[:50] for p in prompts]
    if not probes:
        return None
    folder = os.path.join(HOME, ".claude", "projects", re.sub(r"[^A-Za-z0-9]", "-", info.get("cwd") or ""))
    since = (info.get("created_ms") or 0) / 1000 - 60
    files = [f for f in glob.glob(os.path.join(folder, "*.jsonl")) if os.path.getmtime(f) >= since]
    files.sort(key=os.path.getmtime, reverse=True)
    for probe in probes:
        for f in files:
            if any(probe in text for text in user_texts(f)):
                return os.path.basename(f)[:-6]
    return None


def codex_session(info):
    argv = info.get("argv") or []
    task = argv[1] if argv and argv[0] == "codex" and len(argv) > 1 else (argv[-1] if "codex" in argv else "")
    probe = json.dumps(norm(task)[:50])[1:-1] if task else ""
    start = datetime.fromtimestamp((info.get("created_ms") or 0) / 1000, timezone.utc) - timedelta(days=1)
    end = datetime.fromtimestamp((info.get("finished_ms") or info.get("created_ms") or 0) / 1000, timezone.utc)
    best = None
    day = start
    while day.date() <= end.date() + timedelta(days=1):
        for f in glob.glob(os.path.join(HOME, ".codex", "sessions", day.strftime("%Y/%m/%d"), "rollout-*.jsonl")):
            try:
                with open(f, encoding="utf-8", errors="replace") as fh:
                    meta = json.loads(fh.readline()).get("payload", {})
                    if meta.get("parent_thread_id") or meta.get("cwd") != info.get("cwd"):
                        continue
                    if probe and probe not in fh.read():
                        continue
            except (OSError, ValueError):
                continue
            ts = os.path.getmtime(f)
            if best is None or ts > best[0]:
                best = (ts, meta.get("id"))
        day += timedelta(days=1)
    return best and best[1]


def cmd_resume(t):
    info = json.loads(hc("get", t, "--json"))
    term = next((x for x in json.loads(hc("ls", "--all", "--json"))["terminals"] if x["address"] == t), {"address": t})
    screen = read_screen(t)
    kind = kind_of(term, info, screen)
    if kind == "claude":
        sid = claude_session(info, screen)
        out = {"argv": ["claude", "--resume", sid], "how": f"claude --resume {sid}"} if sid else \
              {"argv": ["claude", "--resume"], "how": "session not found: Claude's resume picker"}
    elif kind == "codex":
        sid = codex_session(info)
        out = {"argv": ["codex", "resume", sid], "how": f"codex resume {sid}"} if sid else \
              {"argv": ["codex", "resume"], "how": "session not found: Codex's resume picker"}
    else:
        out = {"argv": None, "how": "a new shell"}
    print(json.dumps(out))


if __name__ == "__main__":
    if sys.argv[1:2] == ["list"]:
        cmd_list()
    elif sys.argv[1:2] == ["resume"] and len(sys.argv) > 2:
        cmd_resume(sys.argv[2])
    else:
        sys.exit(__doc__)
