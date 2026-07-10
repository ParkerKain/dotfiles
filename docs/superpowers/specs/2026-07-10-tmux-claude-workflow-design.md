# tmux + Claude Code Workflow - Design

Date: 2026-07-10
Repo: `~/dotfiles`
Status: approved design, pending implementation plan

## Problem

Claude Code is now the primary way of working, but the tmux setup was built around a fixed three-window-per-project model (Neovim / Admin / Claude). This causes friction:

- Spinning up an additional Claude session is manual and inconsistent.
- Windows conflate roles: "Neovim / Admin / Claude" breaks down once two of three windows are actually Claude.
- Ad-hoc Claude questions (e.g. a dotfiles question) get dumped into whatever project session is current, to avoid losing them.
- There is no way to see, at a glance, every Claude session running across all tmux sessions and which ones are waiting on input - the equivalent of a cloud-agents view, but local and global.

## Goals

1. Make spinning up a new Claude session one keystroke, both inside the current project session and as a standalone scratch session.
2. Collapse the editor + admin shell into a single "Workspace" window so windows are free to represent "how many Claudes am I running."
3. Provide a global minimap: one keypress shows every Claude session on the machine and which are waiting on the user, and jumps to any of them.
4. Keep the change incremental - preserve existing muscle memory (`C-b` prefix, `mux`, `nwt`) where possible.

## Non-goals

- Changing the prefix key (stays `C-b`).
- Replacing tmuxinator or nvim.
- Supporting multiple tmux servers / sockets in v1 (all work happens on the single default server; multi-socket is a noted future extension).
- Wrapping Claude Code's built-in `claude agents` view (it only lists background sessions, not the interactive foreground `claude` windows this workflow uses).

## Confirmed technical facts

These were verified against the live machine and the 2026 Claude Code docs; the design depends on them.

- **`$TMUX_PANE` is inherited by subprocesses of a pane's process.** A Bash subprocess of the running Claude process resolved `$TMUX_PANE=%22`. A Claude hook is the same kind of subprocess, so hooks can key state to the exact pane and the minimap can jump to it.
- **Claude panes self-identify with zero configuration:**
  - `pane_current_command` reports Claude's version string (e.g. `2.1.206`) rather than `zsh`/`nvim`. Detector: command matches `^[0-9]+\.[0-9]+\.[0-9]+$`.
  - `pane_title` already carries live state set by Claude Code: a braille spinner glyph (e.g. `⠐`) prefix means working; an asterisk `✳` prefix means idle/waiting. Captured by tmux for every pane on the server.
- **Claude Code hooks provide precise state transitions** (stdin JSON includes `session_id`, `cwd`, `hook_event_name`):
  - `UserPromptSubmit`, `PreToolUse` - actively working.
  - `Notification` - needs the user; `notification_type` distinguishes `permission_prompt`, `idle_prompt`, `agent_needs_input`, `agent_completed`, etc.
  - `Stop` - turn finished (effectively waiting for the user).
  - `SessionStart` / `SessionEnd` - lifecycle.
- Hooks are configured in `~/.claude/settings.json` under `hooks.<Event>[].hooks[]` as `type: command`; a hook may be a shell command writing to an arbitrary file.
- tmux version is 3.6a (supports `display-popup -E`).

## Design

Five components. #1-#4 are core; #5 is an easy optional add-on.

### Component 1 - tmux.conf foundations

Add to `~/dotfiles/.tmux.conf`:

- `set -g renumber-windows on` - closing a Claude window renumbers the rest, keeping "window count = live Claude count."
- `setw -g automatic-rename off` and `set -g allow-rename off` - keep our window names (`Workspace`, `Claude`, `Claude-2`) stable. Does not affect `pane_title`, which the minimap reads.
- `set -g history-limit 50000` - Claude output is long.
- `set -g focus-events on`.
- `set -g base-index 1` and `setw -g pane-base-index 1` - number keys line up with the first window being `1`.

Prefix stays `C-b`. Existing settings (`mouse on`, vi mode, rose-pine, TPM) unchanged.

### Component 2 - Session shape

Default project session becomes two windows:

- **`Workspace`** - `main-vertical` layout: nvim in the large pane, an admin shell in the smaller pane.
- **`Claude`** - runs `claude`.

Additional Claude windows (`Claude-2`, ...) are added on demand (Component 3), not pre-created.

A creation-time layout toggle via the `MUX_LAYOUT` env var:

- unset / `default` - the two-window shape above.
- `wide` - a single window tiled as a pane grid (nvim + admin + Claude panes) for the ultrawide monitor at home. Implemented with ERB conditionals in the tmuxinator yml.

Usage: `mux start devclarity-vault` (default) vs `MUX_LAYOUT=wide mux start devclarity-vault` (grid).

Scope of change:

- Refactor all 9 tmuxinator configs in `~/dotfiles/.config/tmuxinator/*.yml` to the Workspace + Claude shape with the `MUX_LAYOUT` ERB conditional. `survey-benchmarking.yml` keeps its extra git-sync pane behavior, adapted to the new shape.
- Refactor the `nwt` worktree helper in `~/dotfiles/.zshrc` to produce the same Workspace + Claude shape.

### Component 3 - Claude launcher keybinds

- **`prefix + C`** (capital C; default lowercase `c` = new-window is preserved): create a new window in the current session named `Claude` / `Claude-2` / ... (next free suffix), run `claude` in it, select it.
- **`qc` shell function** (bound also to `prefix + S`): the dedicated scratch session.
  - Creates or attaches a persistent session named `scratch`.
  - Opens a fresh `Claude` window in it, runs `claude`, jumps there (`switch-client` if inside tmux, else `attach`).
  - Root directory resolution: `qc <dir>` sets the window root to `<dir>`; bare `qc` prompts via `gum choose` (e.g. `~/dotfiles`, "pick a dir", "none - research from $HOME"). Matches the observed reality that a scratch Claude sometimes has an obvious root and sometimes does not.

The global minimap (Component 4) is what makes it safe to put ad-hoc Claudes in `scratch` rather than the current project session - nothing gets lost.

### Component 4 - Global Claude minimap

**Trigger:** `prefix + g` runs `tmux display-popup -E claude-map`.

**State model:** a directory `~/.claude/tmux-state/` with one file per pane, named by pane id (e.g. `%22`). Each file holds a single line: `status<TAB>epoch<TAB>summary`, where `status` is one of `working | waiting-permission | waiting-input | idle | done`. `summary` is a short label (from `cwd` basename and/or notification type).

**Hooks** (in `~/.claude/settings.json`) - each is a small shell command that reads stdin JSON + `$TMUX_PANE` and writes the state file for that pane:

- `SessionStart` -> `working` (or `idle`).
- `UserPromptSubmit`, `PreToolUse` -> `working`.
- `Notification` -> `waiting-permission` if `notification_type` is `permission_prompt`, else `waiting-input`.
- `Stop` -> `idle`.
- `SessionEnd` -> remove the state file.

Hooks only write when `$TMUX_PANE` is set (so they are no-ops outside tmux).

**Detection strategy (hybrid, recommended):**

1. Enumerate candidate Claude panes: `tmux list-panes -a -F '#{pane_id}\t#{session_name}\t#{window_index}\t#{pane_index}\t#{pane_current_command}\t#{pane_title}\t#{pane_current_path}'`, keeping panes whose command matches the version regex OR whose title starts with a Claude glyph.
2. For each candidate, prefer its state file (precise). If none exists (e.g. a session that predates the hooks), infer status from the title glyph: braille spinner -> `working`, `✳` -> `idle`.
3. Prune state files whose pane id is no longer in `list-panes -a`.

**Presentation:** an `fzf` list, sorted waiting-first, one row per Claude pane:

```
⏳ personal-assistant:1   ~/pa      waiting: permission    2m
✳  scratch:1             ~/dotfiles idle                   5m
⠿  devclarity-vault:2    ~/dev...  working                 just now
```

**Action:** Enter jumps directly to the pane: `tmux switch-client -t <session>` then `select-window -t <session>:<window>` then `select-pane -t <pane_id>`. (Secondary actions such as kill/peek are possible but out of scope for v1.)

**Scripts** live in `~/dotfiles/.tmux/scripts/` (new dir): `claude-map` (the popup renderer) and the small hook writer(s), plus whatever helper `qc` and `prefix + C` share for next-name resolution.

### Component 5 - Status-bar waiting counter (optional)

Append to `status-right` a glanceable count read from `~/.claude/tmux-state/`, e.g. `◍ 2 waiting`, updated via `status-interval`. A single small script counts files whose status is `waiting-*`. Easy to drop or defer; no dependency from the other components.

## File-by-file change summary

- `~/dotfiles/.tmux.conf` - Component 1 options; `prefix + C`, `prefix + S`, `prefix + g` bindings; Component 5 `status-right` fragment.
- `~/dotfiles/.tmux/scripts/` (new) - `claude-map`, hook writer script(s), name-resolution helper, status-counter script.
- `~/dotfiles/.config/tmuxinator/*.yml` (9 files) - Workspace + Claude shape with `MUX_LAYOUT` ERB toggle.
- `~/dotfiles/.zshrc` - refactor `nwt` to the new shape; add `qc` function.
- `~/.claude/settings.json` - hook definitions. (Lives outside the dotfiles repo unless it is stowed; the plan will confirm whether this file is tracked and, if not, whether to add a tracked copy.)

## Edge cases and risks

- **Title glyphs are undocumented** and could change across Claude versions. Mitigation: hooks are the source of truth; the glyph is fallback only. If glyphs change, only pre-hook sessions degrade.
- **`$TMUX_PANE` in hooks is confirmed on this machine but undocumented.** If a future Claude version stops inheriting it, hooks can fall back to matching on `session_id` -> transcript, but v1 relies on the pane id. The plan should include a one-line smoke test of a hook writing `$TMUX_PANE`.
- **Stale state files** from crashes: pruned on each minimap open by intersecting with `list-panes -a`; `SessionEnd` also removes them.
- **Multiple tmux servers / sockets** are out of scope; the minimap sees only the default server. Noted for a future extension (iterate `tmux -L <socket>`).
- **`~/.claude/settings.json` is user-global**, shared across all repos - hooks must be cheap and must no-op cleanly when `$TMUX_PANE` is unset so non-tmux usage is unaffected.

## Success criteria

- One keystroke adds a Claude window to the current session; one command/keystroke opens a scratch Claude with an optional root.
- Project sessions come up as Workspace + Claude, with a `wide` grid option at creation.
- `prefix + g` lists every Claude pane on the server, marks which are waiting, and jumps to the selected one.
- Non-tmux Claude usage and other repos are unaffected by the global hooks.
