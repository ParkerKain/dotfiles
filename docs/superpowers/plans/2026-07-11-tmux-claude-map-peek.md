# tmux Claude Minimap: Color Coding + Top-Right Status Peek Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small, read-only, top-right, color-coded "peek" view of every live Claude tmux pane (toggled via `prefix + G`), and color-code the existing interactive minimap (`prefix + g`), sharing one pane-enumeration implementation between both.

**Architecture:** Extract the pane-scanning/status-resolution logic already in `claude-map` into a sourced library, `claude-map-lib`, exposing one function (`claude_map_scan`) that both `claude-map` (fzf picker) and the new `claude-map-peek` (static colored renderer) call. Color is applied once, in the shared library, so both consumers get it for free.

**Tech Stack:** bash, tmux 3.6a, fzf. No new dependencies.

## Global Constraints

- tmux version on this machine is 3.6a - `display-popup -x R` (right-align) and `-y 0` (top-align) are available.
- State files live at `~/.claude/tmux-state/<pane_id>`, one line: `status<TAB>epoch<TAB>summary`. This plan only reads that format, never changes it.
- Color mapping (exact, from the approved design): `waiting-permission` = red, `waiting-input` = yellow, `working` = cyan, `idle` = gray.
- Peek popup row cap: 10 rows max, with an explicit `+N more - prefix+g for full list` line on overflow - never a silent truncation.
- Peek popup self-refreshes every 2s while open and exits immediately on any keypress.
- `prefix + g` (existing, lowercase) is unchanged in behavior; `prefix + G` (new) is the peek toggle.
- All scripts live in `~/dotfiles/.tmux/scripts/` and are stowed as-is (no separate build step - editing the file *is* deploying it, since `.tmux/scripts/` is already symlinked into place per this repo's model).

---

### Task 1: Extract `claude-map-lib` (behavior-preserving refactor, no color yet)

**Files:**
- Create: `.tmux/scripts/claude-map-lib`
- Modify: `.tmux/scripts/claude-map`

**Interfaces:**
- Produces: `claude_map_scan <rows_file>` - a function, sourced by callers, that overwrites `<rows_file>` with one line per live Claude pane, sorted worst-status-first, in the format `sort_key<TAB>status<TAB>rendered<TAB>pane_id` (no trailing newline issues; `rendered` has no embedded tabs or newlines). Also prunes `~/.claude/tmux-state/` of files whose pane is no longer live, as a side effect.

- [ ] **Step 1: Capture baseline output of the current `claude-map`**

Run:
```bash
CLAUDE_MAP_DRYRUN=1 ~/dotfiles/.tmux/scripts/claude-map > /tmp/claude-map-baseline.txt
cat /tmp/claude-map-baseline.txt
```
Expected: one line per currently-live Claude pane (at least the pane you're running this in), e.g. `⠿  dotfiles              some-title~                    working            3s`. Note the exact row count - you'll need it for Task 3.

- [ ] **Step 2: Write `claude-map-lib`**

```bash
#!/usr/bin/env bash
# claude-map-lib - shared pane enumeration + status resolution for
# claude-map and claude-map-peek. Sourced, not executed directly.

: "${CLAUDE_MAP_STATE_DIR:=$HOME/.claude/tmux-state}"
: "${CLAUDE_MAP_STALE_WORKING:=900}"
CLAUDE_MAP_VERSION_RE='^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$'

# claude_map_scan <rows_file>
# Writes one line per live Claude pane to <rows_file>, sorted worst-status-first:
#   sort_key<TAB>status<TAB>rendered<TAB>pane_id
# Prunes stale state files (pane no longer live) as a side effect.
claude_map_scan() {
  local rows_file="$1"
  local sep panes live now
  sep="$(printf '\037')"
  now="$(date +%s)"
  panes="$(mktemp)"; live="$(mktemp)"
  trap 'rm -f "$panes" "$live"' RETURN

  tmux list-panes -a -F \
    "#{pane_id}${sep}#{session_name}${sep}#{window_index}${sep}#{pane_index}${sep}#{pane_current_command}${sep}#{pane_title}${sep}#{pane_current_path}" \
    > "$panes"
  cut -d "$sep" -f1 "$panes" > "$live"

  if [ -d "$CLAUDE_MAP_STATE_DIR" ]; then
    for f in "$CLAUDE_MAP_STATE_DIR"/*; do
      [ -e "$f" ] || continue
      b="$(basename "$f")"
      case "$b" in .tmp.*) continue ;; esac
      grep -qx "$b" "$live" || rm -f "$f"
    done
  fi

  : > "$rows_file"
  while IFS="$sep" read -r pid sess win pane cmd title path; do
    status=""; ts=0; summary=""
    sf="$CLAUDE_MAP_STATE_DIR/$pid"
    if [ -f "$sf" ]; then
      IFS=$'\t' read -r status ts summary < "$sf" || true
      [ -n "${ts:-}" ] || ts=0
      printf '%s' "$ts" | grep -Eq '^[0-9]+$' || ts=0
      if [ "$status" = working ] && [ "$ts" -gt 0 ] && [ $(( now - ts )) -gt "$CLAUDE_MAP_STALE_WORKING" ]; then
        status=idle
      fi
    elif printf '%s' "$cmd" | grep -Eq "$CLAUDE_MAP_VERSION_RE"; then
      case "$title" in
        "✳"*) status=idle ;;
        *)    status=working ;;
      esac
      summary="$(basename "$path")"
    fi
    [ -n "$status" ] || continue

    case "$status" in
      waiting-permission) sk=0; icon="⏳" ;;
      waiting-input)      sk=1; icon="⏳" ;;
      idle)               sk=2; icon="✳" ;;
      working)            sk=3; icon="⠿" ;;
      *)                  sk=4; icon=" " ;;
    esac

    age="-"
    if [ "$ts" -gt 0 ]; then
      d=$(( now - ts ))
      if   [ "$d" -lt 60 ];   then age="${d}s"
      elif [ "$d" -lt 3600 ]; then age="$(( d / 60 ))m"
      else                         age="$(( d / 3600 ))h"
      fi
    fi

    slabel="$sess"
    [ "${#slabel}" -gt 20 ] && slabel="${slabel:0:19}~"

    case "$title" in
      [!A-Za-z0-9]*) ctitle="${title#* }" ;;
      *)             ctitle="$title" ;;
    esac
    [ -n "$ctitle" ] || ctitle="$(basename "$path")"
    [ "${#ctitle}" -gt 30 ] && ctitle="${ctitle:0:29}~"

    rendered="$(printf '%s  %-20s %-30s %-18s %-5s' "$icon" "$slabel" "$ctitle" "$status" "$age")"

    printf '%d\t%s\t%s\t%s\n' "$sk" "$status" "$rendered" "$pid" >> "$rows_file"
  done < "$panes"

  sort -n -o "$rows_file" "$rows_file"
}
```

- [ ] **Step 3: Make it executable-readable (source-only, but keep consistent perms)**

```bash
chmod 644 ~/dotfiles/.tmux/scripts/claude-map-lib
```

- [ ] **Step 4: Rewrite `claude-map` to source the lib**

Replace the full contents of `.tmux/scripts/claude-map` with:

```bash
#!/usr/bin/env bash
# claude-map - global minimap of Claude Code panes on the tmux server.
# Bound to prefix+g via display-popup. Enter jumps to the selected pane.
# CLAUDE_MAP_DRYRUN=1 prints rows and exits (test hook).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./claude-map-lib
source "$SCRIPT_DIR/claude-map-lib"

rows="$(mktemp)"
trap 'rm -f "$rows"' EXIT
claude_map_scan "$rows"

if [ ! -s "$rows" ]; then
  echo "No Claude sessions running."; sleep 1.2; exit 0
fi

if [ -n "${CLAUDE_MAP_DRYRUN:-}" ]; then
  cut -f3- "$rows"
  exit 0
fi

sel="$(cut -f3- "$rows" \
  | fzf --with-nth=1 --delimiter=$'\t' --reverse \
        --prompt='claude ▸ ' --header='enter: jump   esc: cancel')" || exit 0
[ -n "$sel" ] || exit 0
pid="$(printf '%s' "$sel" | awk -F'\t' '{print $NF}')"
[ -n "$pid" ] && tmux switch-client -t "$pid"
```

- [ ] **Step 5: Verify the refactor is behavior-preserving**

Run:
```bash
CLAUDE_MAP_DRYRUN=1 ~/dotfiles/.tmux/scripts/claude-map > /tmp/claude-map-after.txt
diff /tmp/claude-map-baseline.txt /tmp/claude-map-after.txt
```
Expected: no output (identical), or at most a 1-second difference in the trailing age column (e.g. `3s` vs `4s`) if a few seconds passed between the two captures - no other differences. If session names, titles, statuses, icons, or row order differ, the extraction introduced a regression; fix before proceeding.

- [ ] **Step 6: Commit**

```bash
cd ~/dotfiles
git add .tmux/scripts/claude-map-lib .tmux/scripts/claude-map
git commit -m "refactor(tmux): extract claude-map-lib for shared pane enumeration"
```

---

### Task 2: Add color coding to the shared lib and the fzf minimap

**Files:**
- Modify: `.tmux/scripts/claude-map-lib`
- Modify: `.tmux/scripts/claude-map`

**Interfaces:**
- Consumes: `claude_map_scan` from Task 1 (same signature, same rows-file format).
- Produces: `rendered` field (column 3 of the rows file) now contains ANSI color escape codes wrapping the row text, reset at the end. Consumers that print it to a real terminal (or pass `--ansi` to fzf) render it in color; consumers that don't will see literal escape bytes (not a concern here - both current consumers handle it correctly).

- [ ] **Step 1: Add color constants and apply them in `claude_map_scan`**

In `.tmux/scripts/claude-map-lib`, add near the top (after the existing `CLAUDE_MAP_VERSION_RE` line):

```bash
CLAUDE_MAP_COLOR_WAITING_PERMISSION=$'\033[31m'   # red
CLAUDE_MAP_COLOR_WAITING_INPUT=$'\033[33m'        # yellow
CLAUDE_MAP_COLOR_WORKING=$'\033[36m'              # cyan
CLAUDE_MAP_COLOR_IDLE=$'\033[90m'                 # gray
CLAUDE_MAP_COLOR_RESET=$'\033[0m'
```

Then replace the status `case` block:

```bash
    case "$status" in
      waiting-permission) sk=0; icon="⏳" ;;
      waiting-input)      sk=1; icon="⏳" ;;
      idle)               sk=2; icon="✳" ;;
      working)            sk=3; icon="⠿" ;;
      *)                  sk=4; icon=" " ;;
    esac
```

with:

```bash
    case "$status" in
      waiting-permission) sk=0; icon="⏳"; color="$CLAUDE_MAP_COLOR_WAITING_PERMISSION" ;;
      waiting-input)      sk=1; icon="⏳"; color="$CLAUDE_MAP_COLOR_WAITING_INPUT" ;;
      idle)               sk=2; icon="✳"; color="$CLAUDE_MAP_COLOR_IDLE" ;;
      working)            sk=3; icon="⠿"; color="$CLAUDE_MAP_COLOR_WORKING" ;;
      *)                  sk=4; icon=" "; color="" ;;
    esac
```

And replace the `rendered=` line:

```bash
    rendered="$(printf '%s  %-20s %-30s %-18s %-5s' "$icon" "$slabel" "$ctitle" "$status" "$age")"
```

with:

```bash
    rendered="$(printf '%s%s  %-20s %-30s %-18s %-5s%s' \
      "$color" "$icon" "$slabel" "$ctitle" "$status" "$age" "$CLAUDE_MAP_COLOR_RESET")"
```

- [ ] **Step 2: Verify escape codes are present**

Run:
```bash
CLAUDE_MAP_DRYRUN=1 ~/dotfiles/.tmux/scripts/claude-map | cat -v | head -3
```
Expected: each line starts with `^[[` (the visible form of ESC) followed by a color number (e.g. `^[[36m` for a working pane), and ends with `^[[0m` before the tab/pane-id.

- [ ] **Step 3: Add `--ansi` to the fzf invocation in `claude-map`**

Change:
```bash
sel="$(cut -f3- "$rows" \
  | fzf --with-nth=1 --delimiter=$'\t' --reverse \
        --prompt='claude ▸ ' --header='enter: jump   esc: cancel')" || exit 0
```
to:
```bash
sel="$(cut -f3- "$rows" \
  | fzf --ansi --with-nth=1 --delimiter=$'\t' --reverse \
        --prompt='claude ▸ ' --header='enter: jump   esc: cancel')" || exit 0
```

- [ ] **Step 4: Manual visual verification**

Inside a real tmux session, press `prefix + g`. Expected: the popup opens showing at least one row (this session), with color applied (e.g. cyan for `working`) rather than raw escape text. Press `Enter` on a row and confirm it still jumps to that pane (unchanged from before this task).

- [ ] **Step 5: Commit**

```bash
cd ~/dotfiles
git add .tmux/scripts/claude-map-lib .tmux/scripts/claude-map
git commit -m "feat(tmux): color-code claude-map status by urgency"
```

---

### Task 3: Build `claude-map-peek` (small top-right read-only view)

**Files:**
- Create: `.tmux/scripts/claude-map-peek`

**Interfaces:**
- Consumes: `claude_map_scan` from Task 1/2 (rows file format: `sort_key<TAB>status<TAB>rendered<TAB>pane_id`).
- Produces: a standalone executable script with no consumers yet (Task 4 wires it to a keybind). Supports `CLAUDE_MAP_DRYRUN=1` (render once and exit, test hook) and env overrides `CLAUDE_MAP_PEEK_MAX_ROWS` (default 10) and `CLAUDE_MAP_PEEK_REFRESH` (default 2, seconds).

- [ ] **Step 1: Write `claude-map-peek`**

```bash
#!/usr/bin/env bash
# claude-map-peek - small, read-only, top-right, color-coded view of every
# live Claude pane. Bound to prefix+G via display-popup - any keypress
# (including a repeat of prefix+G, since the popup captures all input)
# exits it immediately, giving toggle-like show/dismiss behavior.
# CLAUDE_MAP_DRYRUN=1 renders once and exits (test hook).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./claude-map-lib
source "$SCRIPT_DIR/claude-map-lib"

MAX_ROWS="${CLAUDE_MAP_PEEK_MAX_ROWS:-10}"
REFRESH_SECS="${CLAUDE_MAP_PEEK_REFRESH:-2}"

render() {
  local rows total shown
  rows="$(mktemp)"
  claude_map_scan "$rows"
  total="$(wc -l < "$rows" | tr -d ' ')"

  clear
  if [ "$total" -eq 0 ]; then
    echo "No Claude sessions running."
    rm -f "$rows"
    return
  fi

  shown=$total
  [ "$shown" -gt "$MAX_ROWS" ] && shown="$MAX_ROWS"

  cut -f3 "$rows" | head -n "$shown"
  if [ "$total" -gt "$MAX_ROWS" ]; then
    printf '+%d more - prefix+g for full list\n' "$(( total - MAX_ROWS ))"
  fi
  rm -f "$rows"
}

if [ -n "${CLAUDE_MAP_DRYRUN:-}" ]; then
  render
  exit 0
fi

while :; do
  render
  read -r -s -n 1 -t "$REFRESH_SECS" _ && exit 0
done
```

- [ ] **Step 2: Make it executable**

```bash
chmod 755 ~/dotfiles/.tmux/scripts/claude-map-peek
```

- [ ] **Step 3: Verify baseline (no cap) output matches the big minimap's rows**

Run:
```bash
CLAUDE_MAP_DRYRUN=1 ~/dotfiles/.tmux/scripts/claude-map-peek
```
Expected: same row(s) as `claude-map`'s dry-run output (Task 1 Step 1), colored, no overflow line (since live pane count is well under the default cap of 10).

- [ ] **Step 4: Verify the row cap and overflow line**

First find the current live pane count:
```bash
N=$(CLAUDE_MAP_DRYRUN=1 ~/dotfiles/.tmux/scripts/claude-map | wc -l | tr -d ' ')
echo "N=$N"
```

Force overflow by setting the cap one below that count:
```bash
CLAUDE_MAP_PEEK_MAX_ROWS=$(( N - 1 )) CLAUDE_MAP_DRYRUN=1 ~/dotfiles/.tmux/scripts/claude-map-peek
```
Expected: `N - 1` colored rows, followed by exactly one line: `+1 more - prefix+g for full list`.

Then confirm no overflow line when the cap exactly matches the count:
```bash
CLAUDE_MAP_PEEK_MAX_ROWS=$N CLAUDE_MAP_DRYRUN=1 ~/dotfiles/.tmux/scripts/claude-map-peek
```
Expected: `N` colored rows, no `+N more` line.

- [ ] **Step 5: Commit**

```bash
cd ~/dotfiles
git add .tmux/scripts/claude-map-peek
git commit -m "feat(tmux): add claude-map-peek, a read-only colored pane status view"
```

---

### Task 4: Wire `prefix + G` to open the peek popup, top-right

**Files:**
- Modify: `.tmux.conf`

**Interfaces:**
- Consumes: `.tmux/scripts/claude-map-peek` (Task 3), invoked directly by tmux - no new script needed. tmux's `display-popup` captures all keyboard input while a popup is focused, so a plain bind is sufficient: pressing `prefix + G` again while the peek is showing sends those keystrokes to `claude-map-peek`'s `read`, whose "any key exits" behavior (Task 3) closes it immediately, then a further `prefix + G` reopens fresh. No separate open/close query logic is needed.

- [ ] **Step 1: Add the keybind**

In `.tmux.conf`, immediately after the existing minimap line:

```
# Global Claude minimap
bind-key g display-popup -E -w 80% -h 60% "$HOME/.tmux/scripts/claude-map"
```

add:

```
# Small top-right Claude status peek (read-only, toggled by any keypress)
bind-key G display-popup -E -x R -y 0 -w 46 -h 12 "$HOME/.tmux/scripts/claude-map-peek"
```

- [ ] **Step 2: Reload tmux config**

```bash
tmux source-file ~/dotfiles/.tmux.conf
```
Expected: no errors printed.

- [ ] **Step 3: Manual smoke test - open**

Inside a live tmux session, press `prefix + G`. Expected: a small popup appears anchored to the top-right corner of the terminal, showing the same colored row(s) as `claude-map-peek`'s dry-run output from Task 3.

- [ ] **Step 4: Manual smoke test - live refresh**

While the popup from Step 3 is open, in another pane run a command that changes Claude state (e.g. trigger a permission prompt, or just wait ~2s and watch the age column tick up). Expected: within ~2 seconds the popup's content updates without needing to close/reopen it.

- [ ] **Step 5: Manual smoke test - dismiss**

While the popup is open, press any key (e.g. `q`, or `prefix + G` again). Expected: the popup closes immediately, returning focus to the pane you were in before Step 3.

- [ ] **Step 6: Commit**

```bash
cd ~/dotfiles
git add .tmux.conf
git commit -m "feat(tmux): bind prefix+G to the top-right claude-map-peek popup"
```
