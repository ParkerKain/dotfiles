# tmux agent status map (Claude Code + Codex)

Live status of every Claude Code / Codex CLI pane on the tmux server: a
minimap popup (`prefix+g`), a status-bar ticker (`prefix+G`), and a "N
waiting" counter in the right status. Status comes from each tool's own
lifecycle hooks, not polling or screen-scraping.

## How it works

- Both tools support hooks: shell commands they run on lifecycle events
  (session start, before/after a tool call, when they stop and wait on you),
  passing a JSON payload on stdin.
- `.tmux/scripts/claude-state` is the one script both tools' hooks call, as
  `claude-state <tool> <EVENT>` (`<tool>` is `claude` or `codex`). It reads
  `$TMUX_PANE`, maps the event to a status (`idle` / `working` /
  `waiting-input` / `waiting-permission`), and atomically writes
  `tool<TAB>status<TAB>timestamp<TAB>summary` to
  `~/.claude/tmux-state/<pane_id>`.
- `.tmux/scripts/claude-map-lib` (sourced, not run directly) lists all live
  tmux panes, joins each to its state file by pane ID, prunes stale/orphaned
  files, and falls back to guessing status from `pane_current_command` /
  title for panes with no state file yet.
- `claude-map` (fzf popup), `claude-map-statusline` (status-bar chips), and
  `claude-waiting-count` (right-status counter) all read that library.
- `.tmux.conf` clears `~/.claude/tmux-state/*` on server start, because tmux
  pane IDs restart from `%0` each new server and stale files would collide
  with new panes.

Claude and Codex fire mostly-aligned event names, with one difference:
Claude signals a permission prompt via `Notification`
(`.notification_type == "permission_prompt"`), Codex via a dedicated
`PermissionRequest` event. `claude-state` handles both in one script.

## Requirements

- tmux
- `jq`, `fzf` on `PATH`
- Claude Code and/or Codex CLI (the setup works with just one installed -
  you only add the hook block for the tool you use)

## Install

### 1. Get the scripts onto disk

Copy `claude-state`, `claude-map-lib`, `claude-map`, `claude-map-statusline`,
and `claude-waiting-count` to `~/.tmux/scripts/` and make them executable:

```sh
mkdir -p ~/.tmux/scripts
chmod +x ~/.tmux/scripts/claude-state ~/.tmux/scripts/claude-map \
         ~/.tmux/scripts/claude-map-statusline ~/.tmux/scripts/claude-waiting-count
```

(`claude-map-lib` is sourced, not executed, so it doesn't need the exec bit.)

If you keep them somewhere other than `~/.tmux/scripts`, update the hook
commands and `.tmux.conf` bindings below to match - nothing else assumes
that path except those two places.

### 2. Wire up Claude Code hooks

Add this to `~/.claude/settings.json` (merge into any existing `hooks` key -
don't replace it if you already have other hooks configured):

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" claude SessionStart" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" claude UserPromptSubmit" }] }],
    "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" claude PostToolUse" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" claude Notification" }] }],
    "Stop":              [{ "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" claude Stop" }] }],
    "SessionEnd":        [{ "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" claude SessionEnd" }] }]
  }
}
```

If you already have a `PostToolUse` matcher for something else (e.g. a
formatter hook), add the `claude-state` command as an additional entry in
that matcher's `hooks` array rather than a second `PostToolUse` key -
Claude Code merges by matcher, and a duplicate top-level key will silently
shadow one of them.

### 3. Wire up Codex hooks

Codex reads hooks from `~/.codex/hooks.json` (separate file, not
`config.toml`):

```json
{
  "hooks": {
    "SessionStart":      [{ "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex SessionStart" }] }],
    "UserPromptSubmit":  [{ "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex UserPromptSubmit" }] }],
    "PreToolUse":        [{ "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex PreToolUse" }] }],
    "PostToolUse":       [{ "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex PostToolUse" }] }],
    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex PermissionRequest" }] }],
    "Stop":              [{ "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex Stop" }] }],
    "SessionEnd":        [{ "hooks": [{ "type": "command", "command": "\"$HOME/.tmux/scripts/claude-state\" codex SessionEnd" }] }]
  }
}
```

The first time Codex runs after this file changes, it will prompt you to
trust each hook command - accept it. Codex then records a hash of the
command in `~/.codex/config.toml` under `[hooks.state]` on its own; that's
Codex's hook-trust bookkeeping, not something you write by hand, and it'll
prompt again any time the command text changes.

### 4. Add the tmux bindings

Add to `~/.tmux.conf`:

```tmux
# Clear minimap state on server start: pane ids restart from %0 on a fresh
# server, so files orphaned by a crash must not match new panes.
run-shell 'rm -f ~/.claude/tmux-state/* 2>/dev/null || true'

# Global agent minimap (prefix+g)
bind-key g display-popup -E -w 80% -h 60% "$HOME/.tmux/scripts/claude-map"

# Status ticker: prefix+G toggles a second status-bar line with one colored
# chip per live agent pane, left-aligned. Non-modal - panes keep focus.
set -g status-format[1] '#[align=left]#(~/.tmux/scripts/claude-map-statusline #{client_width} #{pane_id})'
bind-key G if-shell -F '#{==:#{status},2}' 'set -g status on' 'set -g status 2'
```

Optional - "N waiting" counter in the right status bar. This example uses
the rose-pine tmux theme's append hook; adjust for your own theme/status-right:

```tmux
set -g @rose_pine_status_right_append_section '#(~/.tmux/scripts/claude-waiting-count)'
```

Reload with `tmux source-file ~/.tmux.conf`, or restart your tmux server so
the pane-ID-reset cleanup runs.

### 5. Verify

- Open a Claude Code (or Codex) pane inside tmux, start a session.
- `cat ~/.claude/tmux-state/$TMUX_PANE` should show a line like
  `claude	working	1731500000	myproject` shortly after your first prompt.
- `prefix+g` should list the pane; `prefix+G` should show a colored chip for
  it in the second status line.

## Notes on adapting this elsewhere

- **Colors**: `claude-map-lib` hardcodes rose-pine "moon" hex values so the
  minimap and status-bar chips match. Cosmetic only - everything still
  works with a different theme, just won't match it until you edit the four
  `CLAUDE_MAP_COLOR_*` constants (and the palette block at the top of
  `claude-map-statusline`).
- **State dir**: defaults to `~/.claude/tmux-state`, overridable via
  `CLAUDE_MAP_STATE_DIR`. Kept under `~/.claude` even for Codex panes so
  there's one state directory regardless of which tool is running.
- **Adding a third tool**: give it a one-letter tag in
  `claude_map_tool_tag()` in `claude-map-lib`, add a case to the
  live/dead-pane check in `claude_map_scan_raw` (the block that verifies
  `pane_current_command` still matches the tool the state file claims), and
  point its hook config at `claude-state <newtool> <EVENT>` using whatever
  event names that tool's hook system exposes.
