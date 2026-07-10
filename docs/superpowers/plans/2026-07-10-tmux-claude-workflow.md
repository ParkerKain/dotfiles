# tmux + Claude Code Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude Code the first-class unit of the tmux workflow - one keystroke to spawn a Claude, and one keystroke to see every Claude session on the machine and which are waiting on the user.

**Architecture:** Claude Code hooks write a per-pane state file keyed by `$TMUX_PANE`; a `display-popup` + fzf minimap reads those files (with a `pane_title` glyph fallback) and jumps to any pane. Session shape moves to a `Workspace` window (nvim + admin panes) plus on-demand `Claude` windows. All artifacts live in the `~/dotfiles` repo and are active immediately via existing stow symlinks.

**Tech Stack:** tmux 3.6a, bash (3.2-compatible scripts), zsh functions, jq, fzf, gum, tmuxinator (ERB), Claude Code hooks + settings.

## Global Constraints

- **tmux 3.6a** is the floor (uses `display-popup -E`, `switch-client -t <pane_id>`).
- **Scripts must run under macOS bash 3.2** - no `mapfile`, no `declare -A`, no `${var,,}`. Use `while read`, temp files, and `case`.
- **Editing the repo is live** - `~/.tmux` -> `dotfiles/.tmux`, `~/.tmux.conf` -> `dotfiles/.tmux.conf`, `~/.claude/settings.local.json` -> `dotfiles/.claude/settings.local.json` are symlinks. Apply tmux changes with `tmux source-file ~/.tmux.conf`; shell changes with `source ~/.zshrc`.
- **Never write `~/.claude/settings.json`** - it holds secrets and an existing voice-check hook. All new hooks go in the tracked `dotfiles/.claude/settings.local.json`, merged into its existing JSON.
- **`.claude/settings.local.json` is currently ignored by the broad `claude` gitignore rule.** Task 2 must either force-add it (`git add -f .claude/settings.local.json`) or first replace the broad ignore with precise Claude cache/state ignores. Do not let the hook config remain untracked.
- **Hooks must no-op when `$TMUX_PANE` is unset** so non-tmux Claude usage is unaffected.
- **State file format** (one line): `<status>\t<epoch>\t<summary>`, `status` in `working | waiting-permission | waiting-input | idle`. State dir: `~/.claude/tmux-state/`.
- **Pre-existing uncommitted edits** exist in `.zshrc` and `.config/nvim/` (unrelated to this plan). Any task that edits `.zshrc` must stage only its own hunks with `git add -p`, never `git add .zshrc` wholesale.
- **All commits** land on branch `feat/tmux-claude-workflow` in `~/dotfiles` and end with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Prefix stays `C-b`.**

---

## File Structure

| Path | Repo-relative | Responsibility |
|------|---------------|----------------|
| `.tmux.conf` | dotfiles | Global options, state-dir clear, keybinds (`prefix+g/C/S`), optional status-right |
| `.tmux/scripts/claude-state` | dotfiles (new) | Hook writer: event + stdin JSON + `$TMUX_PANE` -> state file |
| `.tmux/scripts/claude-map` | dotfiles (new) | Minimap: enumerate Claude panes, render fzf, jump |
| `.tmux/scripts/claude-window` | dotfiles (new) | Add a `Claude`/`Claude-N` window to the current session |
| `.tmux/scripts/claude-scratch` | dotfiles (new) | Create/attach the `scratch` session + a Claude window |
| `.tmux/scripts/claude-waiting-count` | dotfiles (new) | Count `waiting-*` state files for the status bar |
| `.claude/settings.local.json` | dotfiles | Hook registration (merged into existing JSON) |
| `.config/tmuxinator/*.yml` | dotfiles | 9 project configs -> Workspace + Claude shape + `MUX_LAYOUT` |
| `zsh/main.zshrc` | dotfiles | `qc` function |
| `.zshrc` | dotfiles | refactored `nwt` |

---

## Task 1: tmux.conf foundations

Small global options that later tasks rely on. Independently verifiable by sourcing and reading options back.

**Files:**
- Modify: `~/dotfiles/.tmux.conf`

**Interfaces:**
- Produces: base-index 1 windows; `automatic-rename`/`allow-rename` off (stable window names for `Claude-N`); `renumber-windows on`; the `~/.claude/tmux-state/` clear-on-start behavior consumed by Task 2/3.

- [ ] **Step 1: Add the options block**

Insert after line 5 (`setw -g mode-keys vi`) in `~/dotfiles/.tmux.conf`:

```tmux
# --- Claude workflow foundations ---
set -g base-index 1
setw -g pane-base-index 1
set -g renumber-windows on
setw -g automatic-rename off
set -g allow-rename off
set -g focus-events on
set -g history-limit 50000
# Clear minimap state on server start: pane ids restart from %0 on a fresh
# server, so files orphaned by a crash must not match new panes.
run-shell 'rm -f ~/.claude/tmux-state/* 2>/dev/null || true'
```

- [ ] **Step 2: Reload and verify options**

Run:
```bash
tmux source-file ~/.tmux.conf && \
tmux show-options -g | grep -E 'base-index|renumber-windows|history-limit|focus-events' && \
tmux show-options -gw | grep -E 'automatic-rename|allow-rename|pane-base-index'
```
Expected: `base-index 1`, `renumber-windows on`, `history-limit 50000`, `focus-events on`, `automatic-rename off`, `allow-rename off`, `pane-base-index 1`.

- [ ] **Step 3: Verify the state-dir clear ran without error**

Run: `tmux source-file ~/.tmux.conf; echo "exit=$?"`
Expected: `exit=0` (the `run-shell` no-ops cleanly whether or not the dir exists).

- [ ] **Step 4: Commit**

```bash
cd ~/dotfiles && git add .tmux.conf && \
git commit -m "$(printf 'feat(tmux): workflow foundations (base-index, renumber, titles, state clear)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: Hook state machine (the core bet)

Write per-pane state on every Claude state transition. This is the smallest, riskiest artifact - validate it before building any UI.

**Files:**
- Create: `~/dotfiles/.tmux/scripts/claude-state`
- Modify: `~/dotfiles/.claude/settings.local.json`
- Test (manual): a live Claude session

**Interfaces:**
- Produces: files `~/.claude/tmux-state/<pane_id>` with line `<status>\t<epoch>\t<summary>`. Consumed by Task 3 (`claude-map`) and Task 7 (`claude-waiting-count`).

- [ ] **Step 1: Write the hook script**

Create `~/dotfiles/.tmux/scripts/claude-state`:

```bash
#!/usr/bin/env bash
# claude-state - Claude Code hook writer for the tmux minimap.
# Usage (as a hook command): claude-state <EVENT>
# Reads hook JSON on stdin; writes ~/.claude/tmux-state/<pane_id>.
# No-op when not inside tmux ($TMUX_PANE unset).
set -u

event="${1:-}"
pane="${TMUX_PANE:-}"
[ -n "$pane" ] || exit 0

dir="$HOME/.claude/tmux-state"
mkdir -p "$dir"
file="$dir/$pane"

payload="$(cat 2>/dev/null || true)"
cwd="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$cwd" ] || cwd="$PWD"
summary="$(basename "$cwd")"

case "$event" in
  SessionStart)                 status=idle ;;
  UserPromptSubmit|PreToolUse|PostToolUse) status=working ;;
  Stop)                         status=idle ;;
  Notification)
    ntype="$(printf '%s' "$payload" | jq -r '.notification_type // empty' 2>/dev/null || true)"
    case "$ntype" in
      permission_prompt) status=waiting-permission ;;
      agent_needs_input) status=waiting-input ;;
      idle_prompt)       status=idle ;;
      *)                 exit 0 ;;
    esac
    summary="$summary ($ntype)"
    ;;
  SessionEnd)  rm -f "$file"; exit 0 ;;
  *)           exit 0 ;;
esac

# Atomic write: temp in same dir + mv, so readers never see a torn file.
tmp="$(mktemp "$dir/.tmp.XXXXXX")"
printf '%s\t%s\t%s\n' "$status" "$(date +%s)" "$summary" > "$tmp"
mv -f "$tmp" "$file"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x ~/dotfiles/.tmux/scripts/claude-state`

- [ ] **Step 3: Write failing unit checks (script behavior, no live Claude)**

Run each and compare:

```bash
S=~/.tmux/scripts/claude-state
# permission prompt -> waiting-permission
echo '{"cwd":"/Users/parker/dotfiles","notification_type":"permission_prompt"}' | TMUX_PANE=%zz "$S" Notification
cut -f1,3 ~/.claude/tmux-state/%zz     # expect: waiting-permission<TAB>dotfiles (permission_prompt)

# tool starts -> working
echo '{"cwd":"/Users/parker/dotfiles"}' | TMUX_PANE=%zz "$S" PreToolUse
cut -f1 ~/.claude/tmux-state/%zz       # expect: working

# approved tool clears the wait -> working (Blocker 1 regression guard)
echo '{"cwd":"/Users/parker/dotfiles"}' | TMUX_PANE=%zz "$S" PostToolUse
cut -f1 ~/.claude/tmux-state/%zz       # expect: working

# idle notification must NOT escalate -> idle
echo '{"cwd":"/x","notification_type":"idle_prompt"}' | TMUX_PANE=%zz "$S" Notification
cut -f1 ~/.claude/tmux-state/%zz       # expect: idle

# turn end -> idle
echo '{"cwd":"/x"}' | TMUX_PANE=%zz "$S" Stop
cut -f1 ~/.claude/tmux-state/%zz       # expect: idle

# no tmux -> no file written
rm -f ~/.claude/tmux-state/%noenv
echo '{}' | env -u TMUX_PANE "$S" PreToolUse
test ! -e ~/.claude/tmux-state/%noenv && echo "OK: no-op outside tmux"

# session end -> file removed
echo '{}' | TMUX_PANE=%zz "$S" SessionEnd
test ! -e ~/.claude/tmux-state/%zz && echo "OK: SessionEnd removed file"
```
Before the script exists / is wired, Step 3 fails (file missing or wrong status). After Step 1-2 it passes every line. Clean up: `rm -f ~/.claude/tmux-state/%zz`.

- [ ] **Step 4: Register the hooks (merge into settings.local.json)**

Edit `~/dotfiles/.claude/settings.local.json` to add a top-level `"hooks"` key alongside the existing `"permissions"` key. Final file:

```json
{
  "permissions": {
    "allow": [
      "Read(//Users/parker/**)",
      "Read(//Users/parker/.config/**)",
      "WebFetch(domain:nikitabobko.github.io)"
    ]
  },
  "hooks": {
    "SessionStart":     [ { "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" SessionStart" } ] } ],
    "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" UserPromptSubmit" } ] } ],
    "PreToolUse":       [ { "matcher": "*", "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" PreToolUse" } ] } ],
    "PostToolUse":      [ { "matcher": "*", "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" PostToolUse" } ] } ],
    "Notification":     [ { "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" Notification" } ] } ],
    "Stop":             [ { "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" Stop" } ] } ],
    "SessionEnd":       [ { "hooks": [ { "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" SessionEnd" } ] } ]
  }
}
```

- [ ] **Step 5: Validate JSON**

Run: `jq empty ~/.claude/settings.local.json && echo "valid JSON"`
Expected: `valid JSON`.

- [ ] **Step 6: Live integration smoke test (manual, in a real Claude pane)**

In a tmux pane running a **fresh** `claude` (start a new session so the new hooks load):
1. Note the pane id: `echo $TMUX_PANE` (e.g. `%22`).
2. Submit any prompt. In another pane: `cat ~/.claude/tmux-state/%22` -> status `working` while it runs.
3. Let it finish. Re-`cat` -> `idle`.
4. Trigger a permission prompt (e.g. a command needing approval). Re-`cat` -> `waiting-permission`.
5. Approve it; while the tool runs -> `working` (confirms `PostToolUse` clears the wait).
6. Press Esc to interrupt mid-run. Re-`cat` -> likely still `working` (no `Stop`); this is the stranded-`working` case Task 3's demotion handles. Note the timestamp.
7. Confirm the **existing voice-check hook still fires** on an Edit (proves settings.local.json merged, not replaced settings.json).

**Fallback if step 6/7 reveal a problem:**
- If `~/.claude/tmux-state/$TMUX_PANE` is never written from a live session, `$TMUX_PANE` is not reaching the hook env. Remedy: change the hook commands to resolve the pane via `$(tmux display-message -p '#{pane_id}')` instead of `$TMUX_PANE`, inside `claude-state`.
- If the voice-check hook stopped firing, settings.local.json's `hooks` replaced rather than merged settings.json's. Remedy: move this `hooks` block into `~/.claude/settings.json` instead, appending the tmux `PostToolUse` entry to the existing `PostToolUse` array there (do NOT touch its `env`/secrets). Note in a commit message that settings.json is untracked and this block must be re-added on a new machine.

- [ ] **Step 7: Commit**

```bash
cd ~/dotfiles && git add .tmux/scripts/claude-state && \
git add -f .claude/settings.local.json && \
git diff --cached --name-only | grep -Fx .claude/settings.local.json && \
git commit -m "$(printf 'feat(claude): per-pane state hooks for the tmux minimap\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```
Use `git add -f` because the repo currently ignores `.claude/settings.local.json` via the broad `claude` ignore rule. The `grep` is a guard: if the hook config is not staged, stop instead of committing a partial implementation.

---

## Task 3: Global Claude minimap

Popup that lists every Claude pane, waiting-first, and jumps on Enter.

**Files:**
- Create: `~/dotfiles/.tmux/scripts/claude-map`
- Modify: `~/dotfiles/.tmux.conf` (bind `prefix+g`)

**Interfaces:**
- Consumes: state files from Task 2; `tmux list-panes -a` fields.
- Produces: `prefix+g` popup. `CLAUDE_MAP_DRYRUN=1 claude-map` prints sorted rows without fzf (for testing).

- [ ] **Step 1: Write the minimap script**

Create `~/dotfiles/.tmux/scripts/claude-map`:

```bash
#!/usr/bin/env bash
# claude-map - global minimap of Claude Code panes on the tmux server.
# Bound to prefix+g via display-popup. Enter jumps to the selected pane.
# CLAUDE_MAP_DRYRUN=1 prints rows and exits (test hook).
set -u

STATE_DIR="$HOME/.claude/tmux-state"
STALE_WORKING=900   # seconds; older 'working' shows as idle (interrupt recovery)
VERSION_RE='^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$'
now="$(date +%s)"

panes="$(mktemp)"; live="$(mktemp)"; rows="$(mktemp)"
trap 'rm -f "$panes" "$live" "$rows"' EXIT

tmux list-panes -a -F \
  '#{pane_id}	#{session_name}	#{window_index}	#{pane_index}	#{pane_current_command}	#{pane_title}	#{pane_current_path}' \
  > "$panes"
cut -f1 "$panes" > "$live"

# Prune state files whose pane is gone.
if [ -d "$STATE_DIR" ]; then
  for f in "$STATE_DIR"/*; do
    [ -e "$f" ] || continue
    b="$(basename "$f")"
    case "$b" in .tmp.*) continue ;; esac
    grep -qx "$b" "$live" || rm -f "$f"
  done
fi

while IFS=$'\t' read -r pid sess win pane cmd title path; do
  status=""; ts=0; summary=""
  sf="$STATE_DIR/$pid"
  if [ -f "$sf" ]; then
    IFS=$'\t' read -r status ts summary < "$sf" || true
    [ -n "${ts:-}" ] || ts=0
    if [ "$status" = working ] && [ $(( now - ts )) -gt "$STALE_WORKING" ]; then
      status=idle
    fi
  elif printf '%s' "$cmd" | grep -Eq "$VERSION_RE"; then
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
  if printf '%s' "$ts" | grep -Eq '^[0-9]+$' && [ "$ts" -gt 0 ]; then
    d=$(( now - ts ))
    if   [ "$d" -lt 60 ];   then age="${d}s"
    elif [ "$d" -lt 3600 ]; then age="$(( d / 60 ))m"
    else                         age="$(( d / 3600 ))h"
    fi
  fi

  printf '%d\t%s  %-22s %-12s %-18s %-5s\t%s\n' \
    "$sk" "$icon" "$sess:$win" "$(basename "$path")" "$status" "$age" "$pid" >> "$rows"
done < "$panes"

if [ ! -s "$rows" ]; then
  echo "No Claude sessions running."; sleep 1.2; exit 0
fi

if [ -n "${CLAUDE_MAP_DRYRUN:-}" ]; then
  sort -n "$rows" | cut -f2-
  exit 0
fi

sel="$(sort -n "$rows" | cut -f2- \
  | fzf --with-nth=1 --delimiter=$'\t' --reverse \
        --prompt='claude ▸ ' --header='enter: jump   esc: cancel')" || exit 0
[ -n "$sel" ] || exit 0
pid="$(printf '%s' "$sel" | awk -F'\t' '{print $NF}')"
[ -n "$pid" ] && tmux switch-client -t "$pid"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x ~/dotfiles/.tmux/scripts/claude-map`

- [ ] **Step 3: Test rendering + sort order with seeded state (dry run)**

```bash
mkdir -p ~/.claude/tmux-state
# Use real, currently-live pane ids so rows are emitted:
tmux list-panes -a -F '#{pane_id}' | head -3 > /tmp/pids
P1=$(sed -n 1p /tmp/pids); P2=$(sed -n 2p /tmp/pids); P3=$(sed -n 3p /tmp/pids)
printf 'working\t%s\tvault\n'            "$now"                 > ~/.claude/tmux-state/$P1
printf 'waiting-permission\t%s\tpa\n'    "$(date +%s)"          > ~/.claude/tmux-state/$P2
printf 'idle\t%s\tdotfiles\n'            "$(( $(date +%s)-120 ))" > ~/.claude/tmux-state/$P3
CLAUDE_MAP_DRYRUN=1 ~/.tmux/scripts/claude-map
```
Expected: three rows, `waiting-permission` first (⏳), then `idle`, then `working`; ages shown; the `pa` row on top. Cleanup: `rm -f ~/.claude/tmux-state/$P1 ~/.claude/tmux-state/$P2 ~/.claude/tmux-state/$P3`.

- [ ] **Step 4: Test pruning of dead panes**

```bash
printf 'idle\t%s\tghost\n' "$(date +%s)" > "$HOME/.claude/tmux-state/%99999"
CLAUDE_MAP_DRYRUN=1 ~/.tmux/scripts/claude-map >/dev/null
test ! -e "$HOME/.claude/tmux-state/%99999" && echo "OK: pruned dead pane"
```
Expected: `OK: pruned dead pane` (`%99999` is not in `list-panes -a`).

- [ ] **Step 5: Bind prefix+g**

Add to `~/dotfiles/.tmux.conf` (after the foundations block from Task 1):

```tmux
# Global Claude minimap
bind-key g display-popup -E -w 80% -h 60% "$HOME/.tmux/scripts/claude-map"
```

- [ ] **Step 6: Reload and test the live popup + jump**

Run: `tmux source-file ~/.tmux.conf`
Then press `prefix + g`. Expected: a popup lists the real Claude panes (this session shows at least one), sorted waiting-first. Select a different session's Claude and press Enter -> the client switches to that session/window/pane. Esc closes with no change.

- [ ] **Step 7: Commit**

```bash
cd ~/dotfiles && git add .tmux/scripts/claude-map .tmux.conf && \
git commit -m "$(printf 'feat(tmux): prefix+g global Claude minimap popup\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: Claude launcher keybinds

`prefix+C` adds a Claude window to the current session; `qc` / `prefix+S` opens a scratch-session Claude.

**Files:**
- Create: `~/dotfiles/.tmux/scripts/claude-window`
- Create: `~/dotfiles/.tmux/scripts/claude-scratch`
- Modify: `~/dotfiles/.tmux.conf` (bind `prefix+C`, `prefix+S`)
- Modify: `~/dotfiles/zsh/main.zshrc` (add `qc`)

**Interfaces:**
- Consumes: `automatic-rename off` from Task 1 (stable `Claude-N` names).
- Produces: `claude-window <session> <cwd>` (new Claude window in target session), `claude-scratch [--switch|--attach] [dir]` (scratch session + Claude window). `qc [dir]` wraps `claude-scratch`.

- [ ] **Step 1: Write claude-window**

Create `~/dotfiles/.tmux/scripts/claude-window`:

```bash
#!/usr/bin/env bash
# claude-window - add a Claude / Claude-N window to the target session.
set -u
sess="${1:?usage: claude-window <session> <cwd>}"
cwd="${2:?usage: claude-window <session> <cwd>}"
name="Claude"; n=2
while tmux list-windows -t "$sess" -F '#W' | grep -qx "$name"; do
  name="Claude-$n"; n=$(( n + 1 ))
done
tmux new-window -t "$sess" -n "$name" -c "$cwd"
tmux send-keys -t "$sess:$name" 'claude' Enter
tmux select-window -t "$sess:$name"
```

- [ ] **Step 2: Write claude-scratch**

Create `~/dotfiles/.tmux/scripts/claude-scratch`:

```bash
#!/usr/bin/env bash
# claude-scratch [--switch|--attach] [dir] - open a Claude window in the
# persistent 'scratch' session (default dir: $HOME).
set -u
mode="auto"
case "${1:-}" in
  --switch) mode="switch"; shift ;;
  --attach) mode="attach"; shift ;;
esac
root="${1:-$HOME}"
root="$(cd "$root" 2>/dev/null && pwd)" || { echo "claude-scratch: no such dir: ${1:-$HOME}" >&2; exit 1; }
sess="scratch"

if ! tmux has-session -t "$sess" 2>/dev/null; then
  tmux new-session -d -s "$sess" -n "Claude" -c "$root"
  tmux send-keys -t "$sess:Claude" 'claude' Enter
else
  name="Claude"; n=2
  while tmux list-windows -t "$sess" -F '#W' | grep -qx "$name"; do
    name="Claude-$n"; n=$(( n + 1 ))
  done
  tmux new-window -t "$sess" -n "$name" -c "$root"
  tmux send-keys -t "$sess:$name" 'claude' Enter
  tmux select-window -t "$sess:$name"
fi

if [ "$mode" = switch ] || { [ "$mode" = auto ] && [ -n "${TMUX:-}" ]; }; then
  tmux switch-client -t "$sess"
else
  tmux attach -t "$sess"
fi
```

- [ ] **Step 3: Make both executable**

Run: `chmod +x ~/dotfiles/.tmux/scripts/claude-window ~/dotfiles/.tmux/scripts/claude-scratch`

- [ ] **Step 4: Test claude-window in an isolated session**

```bash
tmux new-session -d -s _t4 -c ~ -n Workspace
~/.tmux/scripts/claude-window _t4 "$HOME"
tmux list-windows -t _t4 -F '#W'   # expect: Workspace, Claude
~/.tmux/scripts/claude-window _t4 "$HOME"
tmux list-windows -t _t4 -F '#W'   # expect: Workspace, Claude, Claude-2
tmux kill-session -t _t4
```
Expected: second run produces `Claude-2` (no name collision). (Running from a script context, `claude` will try to start in the new window; that is fine - the assertion is on window names.)

- [ ] **Step 5: Test claude-scratch creates and reuses the session**

```bash
tmux kill-session -t scratch 2>/dev/null || true
TMUX= ~/.tmux/scripts/claude-scratch --attach ~/dotfiles >/dev/null 2>&1 &
sleep 1; tmux list-windows -t scratch -F '#W'   # expect: Claude
~/.tmux/scripts/claude-scratch --switch ~ >/dev/null 2>&1 || true
tmux list-windows -t scratch -F '#W'            # expect: Claude, Claude-2
tmux kill-session -t scratch
```
Expected: reuse adds `Claude-2` rather than a second session. (The background `&` avoids the `attach` blocking the test when run outside tmux.)

- [ ] **Step 6: Add the zsh wrapper**

Add to `~/dotfiles/zsh/main.zshrc` (near the other aliases; keeps `.zshrc` untouched to avoid its pre-existing unstaged hunks):

```bash
# qc - quick Claude in the persistent 'scratch' session. Optional dir (default $HOME).
qc() { ~/.tmux/scripts/claude-scratch "${1:-$HOME}"; }
```

- [ ] **Step 7: Bind prefix+C and prefix+S**

Add to `~/dotfiles/.tmux.conf`:

```tmux
# Claude launchers
bind-key C run-shell "$HOME/.tmux/scripts/claude-window '#S' '#{pane_current_path}'"
bind-key S run-shell "$HOME/.tmux/scripts/claude-scratch --switch '#{pane_current_path}'"
```

- [ ] **Step 8: Reload and smoke test**

```bash
tmux source-file ~/.tmux.conf && source ~/.zshrc
```
Then: press `prefix + C` -> a new `Claude` window opens in the current session running `claude`. Press `prefix + S` -> switches to the `scratch` session with a Claude window rooted at the current pane path. Run `qc ~/dotfiles` from a shell -> scratch session gets a Claude window rooted at dotfiles and attaches/switches based on the interactive shell's `$TMUX`. Clean up scratch afterward if desired: `tmux kill-session -t scratch`.

- [ ] **Step 9: Commit**

```bash
cd ~/dotfiles && git add .tmux/scripts/claude-window .tmux/scripts/claude-scratch .tmux.conf zsh/main.zshrc && \
git commit -m "$(printf 'feat(tmux): prefix+C new Claude window; qc / prefix+S scratch Claude\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: Session shape - tmuxinator + nwt refactor (base)

Move the 9 project configs and `nwt` to the `Workspace` (nvim + admin) + `Claude` shape. Mechanical; no dependency on the minimap.

**Files:**
- Modify: `~/dotfiles/.config/tmuxinator/*.yml` (9 files)
- Modify: `~/dotfiles/.zshrc` (`nwt` window creation) - stage only these hunks

**Interfaces:**
- Produces: sessions with window 1 `Workspace` (main-vertical: nvim + admin shell) and window 2 `Claude`.

- [ ] **Step 1: Rewrite the 8 standard configs**

For each of these files, set the body to the canonical template below, changing only `name:` and `root:`:

| File | name | root |
|------|------|------|
| `automation.yml` | automation | `~/Documents/internal/repos/automation` |
| `dance-app.yml` | dance-app | `~/Documents/personal/repos/dance-app` |
| `demo-devclarity.yml` | demo-devclarity | `~/Documents/internal/repos/demo-devclarity` |
| `devclarity-vault.yml` | devclarity-vault | `~/Documents/internal/repos/devclarity-vault` |
| `dotfiles.yml` | dotfiles | `~/dotfiles` |
| `training-materials.yml` | training-materials | `~/Documents/internal/repos/training-materials` |
| `training-ops.yml` | training-ops | `~/Documents/internal/repos/training-ops` |
| `transcript-machine.yml` | transcript-machine | `~/Documents/internal/repos/transcript-machine` |

Canonical template (example shows `devclarity-vault`):

```yaml
name: devclarity-vault
root: ~/Documents/internal/repos/devclarity-vault

windows:
  - Workspace:
      layout: main-vertical
      panes:
        - nvim
        -
  - Claude:
      panes:
        - claude
```

For `demo-devclarity.yml` only, preserve its existing extra line directly under `root:`:
```yaml
on_project_start: code ~/Documents/internal/repos/demo-devclarity
```

- [ ] **Step 2: Rewrite survey-benchmarking.yml (keeps its git-sync pane as a third window)**

Set `~/dotfiles/.config/tmuxinator/survey-benchmarking.yml` to:

```yaml
name: survey-benchmarking
root: ~/Documents/internal/repos/survey-benchmarking

windows:
  - Workspace:
      layout: main-vertical
      panes:
        - nvim
        -
  - Sync:
      panes:
        - |
          git checkout main && git fetch origin
          [[ -n "$(git status --porcelain)" ]] && { echo "⚠️  WARNING: local changes in survey-benchmarking:"; git status --short; }; git pull
  - Claude:
      panes:
        - claude
```

- [ ] **Step 3: Verify all configs parse**

Run: `for f in ~/dotfiles/.config/tmuxinator/*.yml; do echo "== $f"; tmuxinator debug "$(basename "${f%.yml}")" >/dev/null && echo ok || echo FAIL; done`
Expected: `ok` for every file. (`tmuxinator debug` renders the config without starting it.)

- [ ] **Step 4: Live-test one session shape**

```bash
tmux kill-session -t devclarity-vault 2>/dev/null || true
mux start devclarity-vault
tmux list-windows -t devclarity-vault -F '#I #W'      # expect: 1 Workspace, 2 Claude
tmux list-panes  -t devclarity-vault:Workspace -F '#P #{pane_current_command}'  # expect two panes, one nvim
```
Expected: window 1 `Workspace` with nvim + shell panes, window 2 `Claude`.

- [ ] **Step 5: Refactor nwt to the same shape**

In `~/dotfiles/.zshrc`, replace the window-creation block (currently the `tmux new-session ... Neovim`, `Admin`, `Claude` sequence, lines ~124-136) with:

```bash
    # Create new session with the Workspace window (nvim + admin split)
    tmux new-session -d -s "$session_name" -n "Workspace" -c "$dir_location"
    tmux send-keys -t "${session_name}:Workspace" "nvim" Enter
    tmux split-window -h -t "${session_name}:Workspace" -c "$dir_location"
    tmux select-layout -t "${session_name}:Workspace" main-vertical
    tmux select-pane -t "${session_name}:Workspace.1"

    # Create Claude window
    tmux new-window -t "$session_name" -n "Claude" -c "$dir_location"
    tmux send-keys -t "${session_name}:Claude" "claude" Enter

    # Select the Workspace window
    tmux select-window -t "${session_name}:Workspace"
```

Also update the confirmation banner line `"Windows:   Neovim | Admin | Claude"` to `"Windows:   Workspace (nvim+admin) | Claude"`.

- [ ] **Step 6: Stage only the nwt hunks and test**

```bash
source ~/.zshrc
# Dry check: nwt requires a git repo + gum prompts; verify the function loads:
type nwt >/dev/null && echo "nwt loaded"
```
Expected: `nwt loaded`. (Full worktree creation is interactive via gum; a manual run in a scratch repo is the real test.)

- [ ] **Step 7: Commit (stage nwt hunk only)**

```bash
cd ~/dotfiles && git add .config/tmuxinator/*.yml && git add -p .zshrc && \
git commit -m "$(printf 'feat(tmux): Workspace+Claude session shape for tmuxinator and nwt\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```
At the `git add -p` prompt, stage only the `nwt` window-creation and banner hunks; leave any pre-existing `.zshrc` changes unstaged.

---

## Task 6: Wide-layout MUX_LAYOUT toggle

Creation-time env toggle for the ultrawide grid. Sequenced after the base reshape is proven.

**Files:**
- Modify: `~/dotfiles/.config/tmuxinator/*.yml` (add ERB conditional)

**Interfaces:**
- Consumes: the base configs from Task 5.
- Produces: `MUX_LAYOUT=wide mux start <name>` -> a single `Workspace` window, `tiled`, with nvim + admin + claude panes.

- [ ] **Step 1: Wrap each standard config body in the ERB conditional**

For each standard config, replace the `windows:` block with (example `devclarity-vault`):

```yaml
name: devclarity-vault
root: ~/Documents/internal/repos/devclarity-vault

<% if ENV['MUX_LAYOUT'] == 'wide' %>
windows:
  - Workspace:
      layout: tiled
      panes:
        - nvim
        -
        - claude
<% else %>
windows:
  - Workspace:
      layout: main-vertical
      panes:
        - nvim
        -
  - Claude:
      panes:
        - claude
<% end %>
```

For `survey-benchmarking.yml`, the `wide` arm adds the sync command as a fourth pane; keep the `else` arm as the three-window shape from Task 5 Step 2.

- [ ] **Step 2: Verify both arms render**

```bash
tmuxinator debug devclarity-vault >/dev/null && echo "default ok"
MUX_LAYOUT=wide tmuxinator debug devclarity-vault >/dev/null && echo "wide ok"
```
Expected: `default ok` and `wide ok`.

- [ ] **Step 3: Live-test the wide layout**

```bash
tmux kill-session -t dotfiles 2>/dev/null || true
MUX_LAYOUT=wide mux start dotfiles
tmux list-windows -t dotfiles -F '#I #W'   # expect a single window: 1 Workspace
tmux list-panes -t dotfiles:Workspace | wc -l   # expect 3
tmux kill-session -t dotfiles
```
Expected: one `Workspace` window with three panes.

- [ ] **Step 4: Commit**

```bash
cd ~/dotfiles && git add .config/tmuxinator/*.yml && \
git commit -m "$(printf 'feat(tmux): MUX_LAYOUT=wide grid toggle for tmuxinator configs\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 7: Status-bar waiting counter (optional)

Glanceable count of waiting Claudes in the status bar.

**Files:**
- Create: `~/dotfiles/.tmux/scripts/claude-waiting-count`
- Modify: `~/dotfiles/.tmux.conf`

**Interfaces:**
- Consumes: state files from Task 2.
- Produces: `◍ N waiting ` appended to `status-right` when N > 0.

- [ ] **Step 1: Write the counter script**

Create `~/dotfiles/.tmux/scripts/claude-waiting-count`:

```bash
#!/usr/bin/env bash
# claude-waiting-count - print "◍ N waiting " when N Claude panes await input.
set -u
dir="$HOME/.claude/tmux-state"
[ -d "$dir" ] || exit 0
n=0
for f in "$dir"/*; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in .tmp.*) continue ;; esac
  case "$(cut -f1 "$f" 2>/dev/null)" in waiting-*) n=$(( n + 1 )) ;; esac
done
[ "$n" -gt 0 ] && printf '◍ %d waiting ' "$n"
exit 0
```

- [ ] **Step 2: Make executable and test**

```bash
chmod +x ~/dotfiles/.tmux/scripts/claude-waiting-count
mkdir -p ~/.claude/tmux-state
printf 'waiting-permission\t%s\tx\n' "$(date +%s)" > "$HOME/.claude/tmux-state/%wa"
printf 'working\t%s\ty\n' "$(date +%s)" > "$HOME/.claude/tmux-state/%wb"
~/.tmux/scripts/claude-waiting-count   # expect: ◍ 1 waiting
rm -f "$HOME/.claude/tmux-state/%wa" "$HOME/.claude/tmux-state/%wb"
~/.tmux/scripts/claude-waiting-count   # expect: (no output)
```

- [ ] **Step 3: Append to status-right while keeping TPM last**

Add near the bottom of `~/dotfiles/.tmux.conf`, **before** the final `run '~/.tmux/plugins/tpm/tpm'` line. Keep TPM as the last line; if rose-pine overwrites `status-right`, switch this to the theme's append option instead of moving config after TPM.

```tmux
set -g status-interval 5
set -ga status-right " #(~/.tmux/scripts/claude-waiting-count)"
```

- [ ] **Step 4: Reload and verify**

```bash
tmux source-file ~/.tmux.conf
printf 'waiting-permission\t%s\tx\n' "$(date +%s)" > "$HOME/.claude/tmux-state/$(tmux list-panes -F '#{pane_id}' | head -1)"
```
Wait up to 5s; expect `◍ 1 waiting` at the right of the status bar. Remove the seeded file afterward. If rose-pine overwrites it, move the `set -ga status-right` into a `set -agF status-right` invocation or a `@rose_pine_status_right_append` option per the theme's README; keep the TPM line last and note the finding in the commit.

- [ ] **Step 5: Commit**

```bash
cd ~/dotfiles && git add .tmux/scripts/claude-waiting-count .tmux.conf && \
git commit -m "$(printf 'feat(tmux): status-bar counter of waiting Claude sessions\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Self-Review

**Spec coverage:**
- Component 1 (foundations) -> Task 1. ✓
- Component 2 (session shape) -> Task 5 (base) + Task 6 (wide toggle). ✓
- Component 3 (launcher keybinds `prefix+C`, `qc`/`prefix+S`) -> Task 4. ✓
- Component 4 (minimap: hooks + state model + popup + jump) -> Task 2 (hooks/state) + Task 3 (popup/jump). ✓
- Component 5 (status counter) -> Task 7. ✓
- Spec build order (hooks first, tmuxinator churn late, status last): Tasks ordered foundations -> hooks -> minimap -> launchers -> reshape -> wide -> counter. Foundations precede hooks because they are zero-risk scaffolding; the risky hook state machine is validated in Task 2 before any UI. ✓
- Edge cases: `PostToolUse` clear (Task 2 Step 3 + Step 6.5), `idle_prompt`->idle (Task 2 Step 3), stranded-`working` demotion (Task 3 script + Task 2 Step 6.6), union enumeration (Task 3 script: state-file arm ∪ command/glyph arm), ghost-title guard (glyph fallback gated on version regex), atomic writes (Task 2 script `mktemp`+`mv`), pane-id reuse (Task 1 state clear), single-command jump (Task 3 `switch-client -t $pid`), tty for picker (deferred with the gum picker; `prefix+S` uses a non-interactive script in v1). ✓

**Placeholder scan:** every code step contains complete content; the 9-config repetition is expressed as one template + a name/root table (differences are only those two fields), which is explicit, not a "similar to Task N" placeholder. No TBD/TODO.

**Type/name consistency:** script names (`claude-state`, `claude-map`, `claude-window`, `claude-scratch`, `claude-waiting-count`), state dir (`~/.claude/tmux-state/`), file format (`status\tepoch\tsummary`), status vocabulary (`working`, `waiting-permission`, `waiting-input`, `idle`), and the `CLAUDE_MAP_DRYRUN` test hook are consistent across Tasks 2, 3, 7. Window names `Workspace`/`Claude`/`Claude-N` consistent across Tasks 4, 5, 6.
