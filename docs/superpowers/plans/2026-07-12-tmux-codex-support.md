# Codex support for the tmux agent map - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tmux minimap, chip ticker, and waiting-counter track Codex CLI panes alongside Claude Code panes, in one unified list, tagged `c·` (Claude) / `x·` (Codex).

**Architecture:** The system splits into a *writer* (a hook script that drops a per-pane state file) and *readers* (`claude-map-lib` plus two consumer scripts). Codex CLI exposes the same hook model as Claude Code, so we generalize the one writer to record which tool it is, add a `tool` field to the state-file schema, and teach the readers to read and display it. No new architecture.

**Tech Stack:** Bash, tmux, jq, fzf. Config: `~/.claude/settings.json` (Claude hooks), `~/.codex/hooks.json` (Codex hooks, new). Both are machine config outside this repo.

## Global Constraints

- **Voice:** Never use em-dashes or en-dashes anywhere (comments, commit messages, docs). Use a hyphen `-`. A `PostToolUse` voice hook blocks writes containing a long dash character.
- **State dir:** `~/.claude/tmux-state`, one file per tmux `pane_id`, overridable via `$CLAUDE_MAP_STATE_DIR` (used by tests). Keep it overridable in every script that touches it.
- **State-file schema (new):** tab-separated `tool<TAB>status<TAB>timestamp<TAB>summary`. `tool` is `claude` or `codex`.
- **Atomic writes:** the writer must write to a `.tmp.XXXXXX` temp file in the same dir and `mv -f` into place, so readers never see a torn file. Reader pruning skips `.tmp.*` names.
- **Status vocabulary:** `idle`, `working`, `waiting-input`, `waiting-permission`. Worst-first sort order and colors already defined in `claude-map-lib`; do not change them.
- **Tool tag letters:** `claude` -> `c`, `codex` -> `x`, unknown -> `?`.
- **No new launchers.** Visibility only.

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `.tmux/scripts/claude-state` | Hook writer. Maps a lifecycle event to a status and writes the state file. | Take `<tool>` as arg 1; add `PermissionRequest`; write `tool` field; honor `$CLAUDE_MAP_STATE_DIR`. |
| `.tmux/scripts/claude-map-lib` | Shared pane enumeration + status resolution. Sourced by both consumers. | Read `tool` from state files; add Codex fallback detection; add `tool` column to scan output; add `claude_map_tool_tag` helper; fold tag into rendered rows. |
| `.tmux/scripts/claude-map-statusline` | Renders the status-bar chip ticker. | Read `tool` column; prepend tag to chip label. |
| `.tmux/scripts/claude-map` | fzf minimap popup (`prefix+g`). | No direct edit needed - it renders via `claude_map_scan`, which the lib change already updates. Verify only. |
| `.tmux/scripts/claude-waiting-count` | `◍ N waiting` counter. | Status field moved from field 1 to field 2; update `cut`. |
| `~/.claude/settings.json` | Claude hook wiring (machine config). | Pass `claude` as the tool arg. |
| `~/.codex/hooks.json` | Codex hook wiring (machine config, new file). | Wire Codex events to `claude-state codex <event>`. |

## Test approach

There is no unit-test framework for these scripts. Tests are shell assertions that craft state files in a temp `$CLAUDE_MAP_STATE_DIR` and run the scripts in `CLAUDE_MAP_DRYRUN=1` mode. The readers only emit rows for state files whose name matches a **live** tmux pane, so tests use the current pane's id (`tmux display -p '#{pane_id}'`) as the filename. These tests must be run from inside a tmux session.

---

### Task 1: Generalize the writer (`claude-state`)

**Files:**
- Modify: `.tmux/scripts/claude-state` (full rewrite below)

**Interfaces:**
- Produces: an executable invoked as `claude-state <tool> <event>` reading hook JSON on stdin. Writes `$CLAUDE_MAP_STATE_DIR/<TMUX_PANE>` (default `~/.claude/tmux-state/<pane>`) containing `tool<TAB>status<TAB>epoch<TAB>summary`. No-op if `$TMUX_PANE` or `<tool>` is empty. Event->status map: `SessionStart`->idle; `UserPromptSubmit`/`PreToolUse`/`PostToolUse`->working; `Stop`->waiting-input; `PermissionRequest`->waiting-permission; `Notification` (Claude) uses `.notification_type`; `SessionEnd`->delete file.

- [ ] **Step 1: Write the failing test**

Save as `/tmp/test-claude-state.sh` and make it the check for this task:

```bash
#!/usr/bin/env bash
set -eu
d="$(mktemp -d)"
CS="$HOME/.tmux/scripts/claude-state"

# Codex end-of-turn -> waiting-input, tool recorded, schema is 4 fields.
TMUX_PANE='%test1' CLAUDE_MAP_STATE_DIR="$d" bash "$CS" codex Stop <<<'{"cwd":"/tmp/api"}'
line="$(cat "$d/%test1")"
echo "got: $line"
[ "$(printf '%s' "$line" | cut -f1)" = codex ]          || { echo FAIL tool; exit 1; }
[ "$(printf '%s' "$line" | cut -f2)" = waiting-input ]  || { echo FAIL status; exit 1; }
[ "$(printf '%s' "$line" | cut -f4)" = api ]            || { echo FAIL summary; exit 1; }

# Codex permission prompt -> waiting-permission.
TMUX_PANE='%test2' CLAUDE_MAP_STATE_DIR="$d" bash "$CS" codex PermissionRequest <<<'{"cwd":"/tmp/api"}'
[ "$(cut -f2 "$d/%test2")" = waiting-permission ]       || { echo FAIL perm; exit 1; }

# Claude still works (Notification + notification_type).
TMUX_PANE='%test3' CLAUDE_MAP_STATE_DIR="$d" bash "$CS" claude Notification <<<'{"cwd":"/tmp/api","notification_type":"permission_prompt"}'
[ "$(cut -f1 "$d/%test3")" = claude ]                   || { echo FAIL claude-tool; exit 1; }
[ "$(cut -f2 "$d/%test3")" = waiting-permission ]       || { echo FAIL claude-perm; exit 1; }

# No tool arg -> no-op (no file written).
TMUX_PANE='%test4' CLAUDE_MAP_STATE_DIR="$d" bash "$CS" '' Stop <<<'{}' || true
[ ! -e "$d/%test4" ]                                    || { echo FAIL notool; exit 1; }

echo ALL PASS
rm -rf "$d"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash /tmp/test-claude-state.sh`
Expected: FAIL (current script takes `<event>` as arg 1, so `codex` is treated as the event and hits the `*) exit 0` no-op branch; no file written -> `FAIL tool` or a "No such file" error).

- [ ] **Step 3: Rewrite `claude-state`**

Replace the entire file with:

```bash
#!/usr/bin/env bash
# claude-state - agent-state hook writer for the tmux minimap.
# Usage (as a hook command): claude-state <tool> <EVENT>
#   <tool>  short agent tag recorded in the state file (claude|codex).
#   <EVENT> lifecycle event name from the agent's hook system.
# Reads hook JSON on stdin; writes $CLAUDE_MAP_STATE_DIR/<pane_id>
# (default ~/.claude/tmux-state/<pane_id>).
# No-op when not inside tmux ($TMUX_PANE unset) or when <tool> is empty.
set -u

tool="${1:-}"
event="${2:-}"
pane="${TMUX_PANE:-}"
[ -n "$pane" ] || exit 0
[ -n "$tool" ] || exit 0

dir="${CLAUDE_MAP_STATE_DIR:-$HOME/.claude/tmux-state}"
mkdir -p "$dir"
file="$dir/$pane"

payload="$(cat 2>/dev/null || true)"
cwd="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$cwd" ] || cwd="$PWD"
summary="$(basename "$cwd")"

# Event -> status. Claude Code and Codex CLI share most lifecycle events and
# differ only in how they signal a mid-turn user block: Claude emits
# Notification (with .notification_type), Codex emits a dedicated
# PermissionRequest event. Those names are disjoint, so one case serves both.
#
# End-of-turn model: both agents fire Stop at the end of every turn whether the
# turn ended by asking a question or by finishing work, and hooks cannot tell
# the two apart. Both mean "waiting on the user for their next move" ->
# waiting-input. Being order-independent, this also avoids a late Stop
# clobbering a waiting-permission back to idle. The one mid-turn user-block we
# can surface is the explicit permission event (Notification/permission_prompt
# for Claude, PermissionRequest for Codex).
case "$event" in
  SessionStart)                             status=idle ;;
  UserPromptSubmit|PreToolUse|PostToolUse)  status=working ;;
  Stop)                                     status=waiting-input ;;
  PermissionRequest)                        status=waiting-permission ;;
  Notification)
    ntype="$(printf '%s' "$payload" | jq -r '.notification_type // empty' 2>/dev/null || true)"
    case "$ntype" in
      permission_prompt) status=waiting-permission ;;
      agent_needs_input) status=waiting-input ;;
      idle_prompt)       status=waiting-input ;;
      *)                 exit 0 ;;
    esac
    summary="$summary ($ntype)"
    ;;
  SessionEnd)  rm -f "$file"; exit 0 ;;
  *)           exit 0 ;;
esac

# Atomic write: temp in same dir + mv, so readers never see a torn file.
tmp="$(mktemp "$dir/.tmp.XXXXXX")"
printf '%s\t%s\t%s\t%s\n' "$tool" "$status" "$(date +%s)" "$summary" > "$tmp"
mv -f "$tmp" "$file"
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash /tmp/test-claude-state.sh`
Expected: `ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add .tmux/scripts/claude-state
git commit -m "feat(tmux): make claude-state tool-aware for codex support

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Teach the reader lib the `tool` dimension (`claude-map-lib`)

**Files:**
- Modify: `.tmux/scripts/claude-map-lib`

**Interfaces:**
- Consumes: state files in the Task 1 schema (`tool<TAB>status<TAB>ts<TAB>summary`).
- Produces:
  - `claude_map_tool_tag <tool>` -> prints a single char (`c`/`x`/`?`).
  - `claude_map_scan_raw <file>` line format gains a `tool` column in position 3:
    `sort_key<TAB>status<TAB>tool<TAB>icon<TAB>session<TAB>title<TAB>age<TAB>window<TAB>pane<TAB>pane_id`.
  - `claude_map_scan <file>` rendered rows fold the tag into the visible label
    (`<tag>·<session>:<win>.<pane>`); its output columns are unchanged
    (`sort_key<TAB>status<TAB>rendered<TAB>pane_id`).
  - Codex fallback: a live pane whose `pane_current_command` is exactly `codex`
    and has no state file is reported as `idle`, `tool=codex`.

- [ ] **Step 1: Write the failing test**

Save as `/tmp/test-claude-map-lib.sh`:

```bash
#!/usr/bin/env bash
set -eu
SCRIPT_DIR="$HOME/.tmux/scripts"
source "$SCRIPT_DIR/claude-map-lib"

# Helper mapping exists and is correct.
[ "$(claude_map_tool_tag codex)"  = x ] || { echo FAIL tag-x; exit 1; }
[ "$(claude_map_tool_tag claude)" = c ] || { echo FAIL tag-c; exit 1; }
[ "$(claude_map_tool_tag bogus)"  = '?' ] || { echo FAIL tag-?; exit 1; }

# Craft a codex state file for THIS live pane and scan.
d="$(mktemp -d)"; p="$(tmux display -p '#{pane_id}')"
printf 'codex\tworking\t%s\tapi\n' "$(date +%s)" > "$d/$p"
out="$(mktemp)"
CLAUDE_MAP_STATE_DIR="$d" claude_map_scan_raw "$out"
row="$(grep -F "	$p" "$out" || true)"
echo "raw: $row"
# Field 3 is the tool column.
[ "$(printf '%s' "$row" | cut -f3)" = codex ] || { echo FAIL raw-tool; exit 1; }

# Rendered scan shows the x· tag.
CLAUDE_MAP_STATE_DIR="$d" claude_map_scan "$out"
grep -q 'x·' "$out" || { echo FAIL rendered-tag; exit 1; }

echo ALL PASS
rm -rf "$d" "$out"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash /tmp/test-claude-map-lib.sh`
Expected: FAIL at `FAIL tag-x` (function undefined -> empty output).

- [ ] **Step 3: Add the tag helper**

At the top of `claude-map-lib`, after the color definitions (after the `CLAUDE_MAP_COLOR_RESET` line, before `claude_map_scan_raw`), add:

```bash
# claude_map_tool_tag <tool> -> single-char display tag.
claude_map_tool_tag() {
  case "$1" in
    claude) printf 'c' ;;
    codex)  printf 'x' ;;
    *)      printf '?' ;;
  esac
}
```

- [ ] **Step 4: Read the `tool` field and add Codex fallback**

In `claude_map_scan_raw`, replace the per-pane resolution block. Change the initializer line:

```bash
    status=""; ts=0; summary=""
```

to:

```bash
    status=""; ts=0; summary=""; tool=""
```

Replace the state-file read line:

```bash
      IFS=$'\t' read -r status ts summary < "$sf" || true
```

with:

```bash
      IFS=$'\t' read -r tool status ts summary < "$sf" || true
```

Replace the fallback `elif` block:

```bash
    elif printf '%s' "$cmd" | grep -Eq "$CLAUDE_MAP_VERSION_RE"; then
      case "$title" in
        "✳"*) status=idle ;;
        *)    status=working ;;
      esac
      summary="$(basename "$path")"
    fi
```

with (adds the Codex branch and tags each fallback with its tool):

```bash
    elif printf '%s' "$cmd" | grep -Eq "$CLAUDE_MAP_VERSION_RE"; then
      case "$title" in
        "✳"*) status=idle ;;
        *)    status=working ;;
      esac
      summary="$(basename "$path")"
      tool=claude
    elif [ "$cmd" = codex ]; then
      # Codex has no reliable title convention; report present/unknown as idle
      # until its hooks fire and record real status.
      status=idle
      summary="$(basename "$path")"
      tool=codex
    fi
```

Immediately after the `[ -n "$status" ] || continue` line, add a tool default:

```bash
    [ -n "$tool" ] || tool="?"
```

- [ ] **Step 5: Add the `tool` column to the raw output**

Replace the `printf` at the end of the loop:

```bash
    printf '%d\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$sk" "$status" "$icon" "$slabel" "$ctitle" "$age" "$win" "$pane" "$pid" >> "$rows_file"
```

with (inserts `$tool` after `$status`):

```bash
    printf '%d\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$sk" "$status" "$tool" "$icon" "$slabel" "$ctitle" "$age" "$win" "$pane" "$pid" >> "$rows_file"
```

- [ ] **Step 6: Fold the tag into rendered rows (`claude_map_scan`)**

In `claude_map_scan`, replace the read line:

```bash
  while IFS=$'\t' read -r sk status icon slabel ctitle age win pane pid; do
```

with (adds `tool` in position 3 to match the new raw format):

```bash
  while IFS=$'\t' read -r sk status tool icon slabel ctitle age win pane pid; do
```

Replace the label-building line:

```bash
    slabel="${slabel}:${win}.${pane}"
```

with:

```bash
    slabel="$(claude_map_tool_tag "$tool")·${slabel}:${win}.${pane}"
```

Bump the slabel column width in the render `printf` so the 2-char tag prefix does not eat the title column. Replace:

```bash
    rendered="$(printf '%s%s  %-23s %-30s %-18s %-5s%s' \
      "$color" "$icon" "$slabel" "$ctitle" "$status" "$age" "$CLAUDE_MAP_COLOR_RESET")"
```

with (`%-23s` -> `%-25s`):

```bash
    rendered="$(printf '%s%s  %-25s %-30s %-18s %-5s%s' \
      "$color" "$icon" "$slabel" "$ctitle" "$status" "$age" "$CLAUDE_MAP_COLOR_RESET")"
```

- [ ] **Step 7: Run to verify it passes**

Run: `bash /tmp/test-claude-map-lib.sh`
Expected: `ALL PASS`

- [ ] **Step 8: Commit**

```bash
git add .tmux/scripts/claude-map-lib
git commit -m "feat(tmux): read tool field and detect codex panes in the map lib

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Render the tool tag in the chip ticker (`claude-map-statusline`)

**Files:**
- Modify: `.tmux/scripts/claude-map-statusline`

**Interfaces:**
- Consumes: `claude_map_scan_raw` rows with the `tool` column in position 3 (Task 2).
- Produces: each chip label reads `<tag>·<session>:<win>.<pane> <age>` after the status icon (e.g. `⠿ c·dotfiles:2.1 5m`, `⏳ x·api:1.0 12s`). Colors, focused-pane `▸` marker, and width/overflow logic unchanged.

- [ ] **Step 1: Write the failing test**

Save as `/tmp/test-statusline.sh`:

```bash
#!/usr/bin/env bash
set -eu
d="$(mktemp -d)"; p="$(tmux display -p '#{pane_id}')"
printf 'codex\tworking\t%s\tapi\n' "$(date +%s)" > "$d/$p"
out="$(CLAUDE_MAP_STATE_DIR="$d" CLAUDE_MAP_DRYRUN=1 "$HOME/.tmux/scripts/claude-map-statusline" 200)"
echo "out: $out"
printf '%s' "$out" | grep -q 'x·' || { echo FAIL no-tag; exit 1; }
echo ALL PASS
rm -rf "$d"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash /tmp/test-statusline.sh`
Expected: FAIL `no-tag` (label has no `x·` prefix yet; also the read misaligns because it lacks the `tool` column, so output is garbled or empty).

- [ ] **Step 3: Read the `tool` column and prepend the tag**

In `claude-map-statusline`, replace the read line:

```bash
while IFS=$'\t' read -r sk status icon sess ctitle age win pane pid; do
```

with (adds `tool` in position 3):

```bash
while IFS=$'\t' read -r sk status tool icon sess ctitle age win pane pid; do
```

Replace the label line:

```bash
  label="${marker}${icon} ${sess}:${win}.${pane} ${age}"
```

with:

```bash
  label="${marker}${icon} $(claude_map_tool_tag "$tool")·${sess}:${win}.${pane} ${age}"
```

(`claude_map_tool_tag` is available because the script already `source`s `claude-map-lib` at the top.)

- [ ] **Step 4: Run to verify it passes**

Run: `bash /tmp/test-statusline.sh`
Expected: `ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add .tmux/scripts/claude-map-statusline
git commit -m "feat(tmux): show per-tool tag on status ticker chips

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Fix the waiting counter for the new schema (`claude-waiting-count`)

**Files:**
- Modify: `.tmux/scripts/claude-waiting-count`

**Interfaces:**
- Consumes: state files in the Task 1 schema (status is now field 2).
- Produces: prints `◍ N waiting ` where N counts state files whose status (field 2) starts with `waiting-`, across both tools. Prints nothing when N is 0.

- [ ] **Step 1: Write the failing test**

Save as `/tmp/test-waiting-count.sh`:

```bash
#!/usr/bin/env bash
set -eu
d="$(mktemp -d)"
printf 'codex\twaiting-input\t%s\tapi\n'      "$(date +%s)" > "$d/%wc1"
printf 'claude\tworking\t%s\tweb\n'           "$(date +%s)" > "$d/%wc2"
printf 'claude\twaiting-permission\t%s\tcli\n' "$(date +%s)" > "$d/%wc3"
# Note: claude-waiting-count hardcodes ~/.claude/tmux-state, so point it at $d
# by symlinking is overkill; instead run it with a patched dir via env. The
# script reads $dir from a literal path, so the test overrides HOME.
out="$(HOME="$d/home" bash -c '
  mkdir -p "$HOME/.claude/tmux-state"
  cp '"$d"'/%wc* "$HOME/.claude/tmux-state/"
  "'"$HOME"'/.tmux/scripts/claude-waiting-count"
')" || true
echo "out: [$out]"
[ "$out" = "◍ 2 waiting " ] || { echo FAIL count; exit 1; }
echo ALL PASS
rm -rf "$d"
```

Note: the real `$HOME` in the sub-shell is remapped, so reference the script by its real path. Simpler alternative if the above quoting is fiddly - run the script's core logic against `$d` directly by copying the script and editing `dir`. Either way the assertion is: exactly 2 of the 3 files count.

- [ ] **Step 2: Run to verify it fails**

Run: `bash /tmp/test-waiting-count.sh`
Expected: FAIL `count`. The current script reads `cut -f1` (now the `tool` field, e.g. `codex`/`claude`), which never matches `waiting-*`, so it prints nothing and the assertion fails.

- [ ] **Step 3: Update the field index**

In `claude-waiting-count`, replace:

```bash
  case "$(cut -f1 "$f" 2>/dev/null)" in waiting-*) n=$(( n + 1 )) ;; esac
```

with (status moved to field 2):

```bash
  case "$(cut -f2 "$f" 2>/dev/null)" in waiting-*) n=$(( n + 1 )) ;; esac
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash /tmp/test-waiting-count.sh`
Expected: `ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add .tmux/scripts/claude-waiting-count
git commit -m "fix(tmux): read status from field 2 in the waiting counter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire the hooks (Claude tool arg + new Codex hooks.json)

**Files:**
- Modify: `~/.claude/settings.json` (machine config, not in this repo)
- Create: `~/.codex/hooks.json` (machine config, not in this repo)

**Interfaces:**
- Consumes: the `claude-state <tool> <event>` CLI from Task 1.
- Produces: Claude hooks pass `claude` as arg 1; Codex hooks call `claude-state codex <event>` for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`, `SessionEnd`.

- [ ] **Step 1: Update the Claude hook commands**

In `~/.claude/settings.json`, every `claude-state` command currently reads `"...claude-state\" <Event>"`. Insert the tool arg `claude` before the event in each. The six commands become:

```json
"command": "\"$HOME/.tmux/scripts/claude-state\" claude PostToolUse"
"command": "\"$HOME/.tmux/scripts/claude-state\" claude SessionStart"
"command": "\"$HOME/.tmux/scripts/claude-state\" claude UserPromptSubmit"
"command": "\"$HOME/.tmux/scripts/claude-state\" claude Notification"
"command": "\"$HOME/.tmux/scripts/claude-state\" claude Stop"
"command": "\"$HOME/.tmux/scripts/claude-state\" claude SessionEnd"
```

(Leave the `voice-check.sh` PostToolUse hook untouched.)

- [ ] **Step 2: Verify the settings file is still valid JSON**

Run: `jq . ~/.claude/settings.json >/dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: Create `~/.codex/hooks.json`**

Write this file (the `\"$HOME/...\"` form mirrors the Claude config so the path survives word-splitting):

```json
{
  "hooks": {
    "SessionStart":      [ { "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex SessionStart" } ] } ],
    "UserPromptSubmit":  [ { "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex UserPromptSubmit" } ] } ],
    "PreToolUse":        [ { "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex PreToolUse" } ] } ],
    "PostToolUse":       [ { "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex PostToolUse" } ] } ],
    "PermissionRequest": [ { "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex PermissionRequest" } ] } ],
    "Stop":              [ { "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex Stop" } ] } ],
    "SessionEnd":        [ { "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex SessionEnd" } ] } ]
  }
}
```

- [ ] **Step 4: Verify the Codex hooks file is valid JSON**

Run: `jq . ~/.codex/hooks.json >/dev/null && echo OK`
Expected: `OK`

- [ ] **Step 5: Reload tmux to clear stale state files**

The state-file schema changed (a `tool` field was prepended). Old-format files misparse until rewritten. `.tmux.conf` clears `~/.claude/tmux-state/*` on server start, so reload clears them:

Run: `tmux source-file ~/.tmux.conf`
Then restart any already-running Claude sessions so they write new-schema files (or clear manually: `rm -f ~/.claude/tmux-state/*`).

- [ ] **Step 6: Commit (repo files only)**

`~/.claude/settings.json` and `~/.codex/hooks.json` live outside this repo, so there is nothing to commit here. Record the Codex hooks.json contents in the plan (done above) so the machine config can be recreated. No commit for this task.

---

### Task 6: Live end-to-end verification with Codex

**Files:** none (verification only)

This is the only step that exercises the two runtime unknowns: that Codex's `pane_current_command` is `codex` and that its hook payload carries `cwd`.

- [ ] **Step 1: Confirm the process name**

In a tmux pane, start Codex: `codex`. From another pane run:

Run: `tmux list-panes -a -F '#{pane_current_command}' | sort -u`
Expected: `codex` appears in the list. (If it shows something else, e.g. a wrapper name, update the `[ "$cmd" = codex ]` fallback branch in `claude-map-lib` to match the real value and re-run Task 2's test.)

- [ ] **Step 2: Confirm a state file is written with the codex tool**

With Codex running and having taken at least one action (so a hook fired):

Run: `for f in ~/.claude/tmux-state/*; do echo "$f: $(cat "$f")"; done`
Expected: at least one file whose contents start with `codex<TAB>`. If Codex prompts to trust the hooks on first run, approve it (Codex requires persisted hook trust; the `--dangerously-bypass-hook-trust` flag exists only for automation).

- [ ] **Step 3: Confirm the summary came from cwd**

Expected: the 4th field of the codex state file is the basename of the Codex session's working directory (not the literal `PWD` of the hook). If it is wrong, Codex is not sending `cwd`; fall back is `$PWD` of the hook process, which is acceptable but note it.

- [ ] **Step 4: Watch the status transitions in the ticker**

With the second status line visible (`prefix+G` toggles it if hidden), drive the Codex session and confirm the `x·` chip tracks:
- idle (`✳`, gray) right after start,
- working (`⠿`, cyan) during a tool call,
- waiting-permission (`⏳`, red/love) on an approval prompt,
- waiting-input (`⏳`, gold) when the turn ends.

- [ ] **Step 5: Confirm coexistence and the minimap**

Expected: a Claude pane and a Codex pane show side by side, tagged `c·` and `x·`. Open the minimap with `prefix+g`; both appear, tagged, worst-status first. The `◍ N waiting` section counts a waiting Codex pane.

- [ ] **Step 6: Final commit / cleanup**

Remove the temp test scripts:

Run: `rm -f /tmp/test-claude-state.sh /tmp/test-claude-map-lib.sh /tmp/test-statusline.sh /tmp/test-waiting-count.sh`

No repo changes in this task beyond what earlier tasks committed. If Step 1 required changing the fallback match string, that edit was committed under Task 2.

---

## Self-Review

**Spec coverage:**
- Unified tool-tagged view -> Tasks 2, 3 (tag in raw + both renderers). ✓
- Generalized single writer + `PermissionRequest` -> Task 1. ✓
- State-file schema with `tool` field -> Task 1 (write), Task 2 (read). ✓
- Codex fallback detection (`pane_current_command == codex`) -> Task 2, verified Task 6. ✓
- Rendering `c·`/`x·` in ticker and minimap -> Tasks 3 and 2 (minimap via lib). ✓
- Waiting counter schema fix -> Task 4. ✓
- Hook wiring (Claude arg + new Codex hooks.json) -> Task 5. ✓
- Live unknowns (process name, cwd) -> Task 6. ✓
- No launchers -> not in scope, no task. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test shows assertions and expected output.

**Type/name consistency:** `claude_map_tool_tag` defined in Task 2, used in Tasks 2 and 3. `tool` column is position 3 in `claude_map_scan_raw` output; readers in Tasks 2 (`claude_map_scan`) and 3 (`claude-map-statusline`) both read it in position 3. Schema `tool<TAB>status<TAB>ts<TAB>summary` is written in Task 1 and read in Tasks 2 and 4 (status = field 2). Consistent.
