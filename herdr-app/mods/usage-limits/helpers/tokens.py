#!/usr/bin/env python3
"""Token totals per day and model from Claude Code and Codex session logs.

Prints one JSON object and exits:
  {"days": {"2026-11-17": {"claude": {"<model>": {...}}, "codex": {...}}}, "since": "<date>"}

Claude buckets: input, output, cacheRead, cacheWrite5m, cacheWrite1h, calls.
Codex buckets:  input (uncached), cached, output (reasoning included), reasoning, calls.

A model key gets "|long" when the request crossed the model's long-prompt price
tier and "|fast" for fast mode, so pricing (lib/tokens.js) stays out of here.
Only numbers leave this script. Usage: tokens.py [days]
"""
import glob
import json
import os
import sys
import time
from datetime import datetime, timedelta

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 31
# Prompts above these sizes bill at a higher rate (tokens in one request).
LONG_PROMPT = {"claude-haiku-5-5": 100_000, "gpt-6.1-sol": 272_000}

since = (datetime.now() - timedelta(days=DAYS - 1)).date()
cutoff = time.time() - (DAYS + 1) * 86400
days = {}


def day_of(ts):
    """ISO UTC timestamp → local YYYY-MM-DD, or None when outside the range."""
    try:
        d = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().date()
    except (AttributeError, ValueError):
        return None
    return d.isoformat() if d >= since else None


def bucket(day, tool, key, fields):
    b = days.setdefault(day, {}).setdefault(tool, {}).setdefault(key, {f: 0 for f in fields})
    return b


def recent(pattern):
    for f in glob.iglob(pattern, recursive=True):
        try:
            if os.path.getmtime(f) >= cutoff:
                yield f
        except OSError:
            pass


CLAUDE_FIELDS = ("input", "output", "cacheRead", "cacheWrite5m", "cacheWrite1h", "calls")


def claude():
    base = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    seen = set()  # a response is logged once per content block, sometimes in two files
    for path in recent(os.path.join(base, "projects", "**", "*.jsonl")):
        with open(path, "rb") as fh:
            for line in fh:
                if b'"usage"' not in line or b'"assistant"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                msg = d.get("message") or {}
                u = msg.get("usage")
                model = msg.get("model")
                if d.get("type") != "assistant" or not isinstance(u, dict) or not model or model.startswith("<"):
                    continue
                key = (msg.get("id"), d.get("requestId"))
                if key[0] and key in seen:
                    continue
                seen.add(key)
                day = day_of(d.get("timestamp"))
                if not day:
                    continue
                inp = u.get("input_tokens") or 0
                read = u.get("cache_read_input_tokens") or 0
                write = u.get("cache_creation_input_tokens") or 0
                split = u.get("cache_creation") or {}
                w1h = split.get("ephemeral_1h_input_tokens") or 0
                w5m = write - w1h if split else write
                # The tier goes by each request's prompt; server tools can make several per turn.
                prompts = [(i.get("input_tokens") or 0) + (i.get("cache_read_input_tokens") or 0) + (i.get("cache_creation_input_tokens") or 0)
                           for i in (u.get("iterations") or []) if isinstance(i, dict)] or [inp + read + write]
                name = model
                if model in LONG_PROMPT and max(prompts) > LONG_PROMPT[model]:
                    name += "|long"
                if u.get("speed") == "fast":
                    name += "|fast"
                b = bucket(day, "claude", name, CLAUDE_FIELDS)
                b["input"] += inp
                b["output"] += u.get("output_tokens") or 0
                b["cacheRead"] += read
                b["cacheWrite5m"] += max(0, w5m)
                b["cacheWrite1h"] += w1h
                b["calls"] += 1


CODEX_FIELDS = ("input", "cached", "output", "reasoning", "calls")
USAGE_KEYS = ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens")


def codex():
    base = os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex")
    files = list(recent(os.path.join(base, "sessions", "**", "rollout-*.jsonl")))
    files += list(recent(os.path.join(base, "archived_sessions", "**", "rollout-*.jsonl")))
    for path in files:
        model = None
        prev = None  # the running total: a token_count can repeat without a new call
        with open(path, "rb") as fh:
            for line in fh:
                if b'"turn_context"' in line:
                    try:
                        model = json.loads(line)["payload"].get("model") or model
                    except (ValueError, KeyError, AttributeError):
                        pass
                    continue
                if b'"token_count"' not in line:
                    continue
                try:
                    d = json.loads(line)
                    info = d["payload"]["info"]
                except (ValueError, KeyError, TypeError):
                    continue
                if not info:
                    continue
                total = info.get("total_token_usage") or {}
                last = info.get("last_token_usage") or {}
                cur = tuple(total.get(k) or 0 for k in USAGE_KEYS)
                if prev is not None and cur == prev:
                    continue
                if prev is not None and all(c >= p for c, p in zip(cur, prev)):
                    delta = tuple(c - p for c, p in zip(cur, prev))
                else:
                    delta = tuple(last.get(k) or 0 for k in USAGE_KEYS) if prev is not None else cur
                prev = cur
                day = day_of(d.get("timestamp"))
                if not day or not any(delta):
                    continue
                inp, cached, out, reasoning = delta
                name = model or "unknown"
                if name in LONG_PROMPT and (last.get("input_tokens") or inp) > LONG_PROMPT[name]:
                    name += "|long"
                b = bucket(day, "codex", name, CODEX_FIELDS)
                b["input"] += max(0, inp - cached)
                b["cached"] += cached
                b["output"] += out
                b["reasoning"] += reasoning
                b["calls"] += 1


claude()
codex()
json.dump({"since": since.isoformat(), "days": days}, sys.stdout, separators=(",", ":"))
sys.stdout.write("\n")
