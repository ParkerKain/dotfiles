#!/usr/bin/env python3
"""Git clean filter for herdr-app/settings.json.

Herdr rewrites settings.json whenever Cmd+= or Cmd+- changes the zoom, and it
reorders keys and writes 13 as 13.0. This drops zoom and normalizes the rest,
so git only sees settings Parker chose on purpose. Wired up by
`git config filter.herdr-settings.clean "python3 herdr-app/settings-clean.py"`
and the entry in .gitattributes.
"""
import json
import sys

raw = sys.stdin.read()
try:
    data = json.loads(raw)
except ValueError:
    sys.stdout.write(raw)  # leave a broken file alone so the diff shows it
    sys.exit(0)


def tidy(value):
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: tidy(v) for k, v in value.items()}
    if isinstance(value, list):
        return [tidy(v) for v in value]
    return value


data.pop("zoom", None)
sys.stdout.write(json.dumps(tidy(data), indent=2, sort_keys=True) + "\n")
