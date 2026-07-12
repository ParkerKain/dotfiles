# Codex support for the tmux agent map

**Date:** 2026-07-12
**Status:** Approved design, ready for implementation plan

## Problem

The tmux minimap (`prefix+g`), the status-bar chip ticker (`status-format[1]`),
and the `◍ N waiting` counter track live **Claude Code** panes only. They read
per-pane state files written by a Claude Code hook. Codex CLI (v0.144.1,
already installed) is now used alongside Claude, but is invisible to all of it.

Goal: surface Codex panes in the same views as Claude panes, in a single
unified list, with a small per-tool tag so the two are distinguishable.

## Non-goals

- **No launchers.** `prefix+C` (new Claude window) and `prefix+S` (Claude
  scratch) get no Codex equivalents. Scope is visibility only; Codex sessions
  are started manually.
- No rename of the `claude-*` script family. The names stay; only behavior
  generalizes. (Cosmetic churn across `.tmux.conf`, `settings.json`, and docs
  is not worth it.)
- No new unit tests. None exist for these scripts today; verification is live.

## Why this is cheap

Codex CLI exposes the same hook model as Claude Code: a `hooks.json`
(`~/.codex/hooks.json`, same command + stdin-JSON shape) with lifecycle events
`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`,
`PostToolUse`, `Stop`, `SessionEnd`, and payloads carrying `cwd`. The system
already splits into **writers** (hook scripts) and **readers**
(`claude-map-lib` + two consumers). We add a second writer path and one `tool`
dimension to the readers. No architectural change.

## Design

### Architecture

- **Writer** - generalize `claude-state` to take the tool as its first arg:
  `claude-state <tool> <event>`. One script serves both tools: Claude emits
  `Notification` (with `notification_type`), Codex emits a dedicated
  `PermissionRequest` event. The two event sets are disjoint, so a single union
  `case` handles both with no conflict. Filename stays `claude-state`.
- **Wiring** - Claude hooks in `~/.claude/settings.json` change from
  `claude-state <event>` to `claude-state claude <event>`. A new
  `~/.codex/hooks.json` wires Codex's events to `claude-state codex <event>`.
  (`~/.codex/hooks.json` is machine config, not stowed from this repo; document
  its contents in the plan so it can be recreated.)
- **Readers** - `claude-map-lib` scans the one shared state dir
  (`~/.claude/tmux-state`, unchanged), reads a `tool` field per file, and gains
  Codex fallback detection. Both consumers render a `c·` / `x·` prefix.

### State-file schema

Files gain a leading `tool` field:

```
tool<TAB>status<TAB>timestamp<TAB>summary
```

Single shared dir (`~/.claude/tmux-state`). Pruning is keyed by `pane_id` and
is tool-agnostic, so it is unchanged. A pane runs at most one agent, so there
is no cross-tool collision on a pane_id.

### Codex event → status mapping

Mirrors the model documented in `claude-state` for Claude:

| Codex event      | status              |
|------------------|---------------------|
| `SessionStart`   | idle                |
| `UserPromptSubmit` / `PreToolUse` / `PostToolUse` | working |
| `PermissionRequest` | waiting-permission |
| `Stop`           | waiting-input       |
| `SessionEnd`     | remove state file   |

Notes:
- Codex's dedicated `PermissionRequest` is cleaner than Claude's overloaded
  `Notification`; no `notification_type` parsing needed for Codex.
- `summary = basename(cwd)`, same as Claude; Codex payloads carry `cwd`.
- End-of-turn semantics match Claude: `Stop` → `waiting-input` (a turn that
  ended by asking a question and one that ended by finishing both mean "waiting
  on the user", and hooks cannot distinguish them).

### Reader changes (`claude-map-lib`)

- **Tool from state file** - read the new leading `tool` field directly.
- **Fallback** (pane running an agent, no state file yet):
  - Claude: unchanged - `pane_current_command` matches the semver regex;
    `✳`-prefixed title → idle, else working.
  - Codex: new branch - `pane_current_command == "codex"` (verified: native
    binary named `codex`). No reliable Codex title convention, so fallback
    status defaults to **idle** (present, state unknown); real status takes
    over once hooks fire.
  - The semver regex and the `codex` literal cannot collide, so detection
    order is safe.
- **Raw scan output** (`claude_map_scan_raw`) gains a `tool` column. Both
  consumers read it. `claude_map_scan` (rendered rows for the fzf minimap)
  folds the prefix into its rendered label.

### Rendering

- **Ticker chips** (`claude-map-statusline`): label becomes
  `<tool>·<sess>:<win>.<pane> <age>` after the status icon, e.g.
  `⠿ c·dotfiles:2.1 5m` / `⏳ x·api:1.0 12s`. Status color/icon logic, the
  focused-pane `▸` marker, and the width-budget / `+N` overflow logic are all
  unchanged.
- **Minimap** (`claude-map`): same `c·` / `x·` prefix folded into the row.
- **Waiting counter** (`claude-waiting-count`): already reads only the status
  field (`waiting-*`), which is tool-agnostic. With the schema change the
  status moves from field 1 to field 2 - update the `cut -f` index. No
  behavior change otherwise (counts both tools).

## Verification (live)

1. Start a Codex session in a tmux pane. Confirm `~/.claude/tmux-state/<pane>`
   appears with a leading `codex` field.
2. Drive it: idle on start → working during a tool call → `waiting-permission`
   on a permission prompt → `waiting-input` at end of turn. Watch the ticker
   chip color/icon track each transition.
3. Confirm a Claude pane still renders correctly alongside the Codex one, each
   with the right `c·` / `x·` tag.
4. Confirm `prefix+g` minimap shows both, tagged.
5. Confirm the `◍ N waiting` counter counts a waiting Codex pane.
6. Sanity-check the two live unknowns: Codex `pane_current_command` is `codex`,
   and its hook payload carries `cwd`.

## Files touched

- `.tmux/scripts/claude-state` - add tool arg; add `PermissionRequest` case;
  write `tool` field.
- `.tmux/scripts/claude-map-lib` - read `tool` field; Codex fallback; add
  `tool` column to scan output; fold prefix into rendered rows.
- `.tmux/scripts/claude-map-statusline` - render `c·`/`x·` prefix.
- `.tmux/scripts/claude-map` - render `c·`/`x·` prefix.
- `.tmux/scripts/claude-waiting-count` - update `cut` field index for schema.
- `~/.claude/settings.json` (machine config) - hooks pass `claude` as tool arg.
- `~/.codex/hooks.json` (machine config, new) - wire Codex events to
  `claude-state codex <event>`.
