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
- Hooks are configured in `~/.claude/settings.local.json` under `hooks.<Event>[].hooks[]` as `type: command`; a hook may be a shell command writing to an arbitrary file.
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
- Clear the minimap state dir on server start: `run-shell 'rm -f ~/.claude/tmux-state/*'` at config load. tmux restarts pane ids from `%0` on a fresh server, so state files orphaned by a crash (where `SessionEnd` never fired) would otherwise match unrelated new panes. Clearing on start closes that hole.

Prefix stays `C-b`. Existing settings (`mouse on`, vi mode, rose-pine, TPM) unchanged.

### Component 2 - Session shape

Default project session becomes two windows:

- **`Workspace`** - `main-vertical` layout: nvim in the large pane, an admin shell in the smaller pane.
- **`Claude`** - runs `claude`.

Additional Claude windows (`Claude-2`, ...) are added on demand (Component 3), not pre-created.

A creation-time layout toggle via the `MUX_LAYOUT` env var:

- unset / `default` - the two-window shape above.
- `wide` - a single window tiled as a pane grid (nvim + admin + Claude panes) for the ultrawide monitor at home. Implemented with ERB conditionals in the tmuxinator yml.

Usage: `mux start devclarity-vault` (default) vs `MUX_LAYOUT=wide mux start devclarity-vault` (grid). Caveat: the toggle is read only at session *creation* - `mux start` on an already-running session ignores it. The `wide` arm is the largest, most-duplicated diff and nothing else depends on it, so it is sequenced last (see Build order); the base Workspace + Claude reshape lands earlier.

Scope of change:

- Refactor all 9 tmuxinator configs in `~/dotfiles/.config/tmuxinator/*.yml` to the Workspace + Claude shape with the `MUX_LAYOUT` ERB conditional. `survey-benchmarking.yml` keeps its extra git-sync pane behavior, adapted to the new shape.
- Refactor the `nwt` worktree helper in `~/dotfiles/.zshrc` to produce the same Workspace + Claude shape.

### Component 3 - Claude launcher keybinds

- **`prefix + C`** (capital C): create a new window in the current session named `Claude` / `Claude-2` / ... (next free suffix), run `claude` in it, select it. Note: `C` is bound to `customize-mode -Z` by default, so this deliberately overrides that (lowercase `c` = new-window is untouched).
- **`qc` shell function** (bound also to `prefix + S`): the dedicated scratch session.
  - Creates or attaches a persistent session named `scratch`.
  - Opens a fresh `Claude` window in it, runs `claude`, jumps there (`switch-client` if inside tmux, else `attach`).
  - Root directory resolution (v1): `qc <dir>` sets the window root to `<dir>`; bare `qc` defaults to `$HOME`. A `gum choose` picker (dotfiles / pick-a-dir / research-from-$HOME) is a deferred nice-to-have, added only if the plain default is felt to be lacking.
  - The `prefix + S` binding must use a non-interactive switch mode. If a future picker is added, host it via `display-popup -E` (or a throwaway window), not a bare `run-shell` - a key binding's `run-shell` has no tty, so any interactive prompt (`gum`) would hang.

The global minimap (Component 4) is what makes it safe to put ad-hoc Claudes in `scratch` rather than the current project session - nothing gets lost.

### Component 4 - Global Claude minimap

**Trigger:** `prefix + g` runs `tmux display-popup -E claude-map`.

**State model:** a directory `~/.claude/tmux-state/` with one file per pane, named by pane id (e.g. `%22`). Each file holds a single line: `status<TAB>epoch<TAB>summary`, where `status` is one of `working | waiting-permission | waiting-input | idle`. `summary` is a short label (from `cwd` basename and/or notification type). The `epoch` (write time) lets the renderer demote a stale `working` to `idle` after a threshold - this is the recovery path for an Esc-interrupt, where no `Stop` fires and the pane would otherwise read `working` forever while shadowing the glyph fallback.

Writes are atomic: each hook writes a `mktemp` file in the same dir and `mv`s it into place, so a concurrent reader (minimap or status counter) never sees a torn or empty file. Parallel tool calls fire multiple `PreToolUse` hooks near-simultaneously; last-writer-wins is fine here, tearing is not.

**Hooks** (in `~/.claude/settings.local.json`) - each is a small shell command that reads stdin JSON + `$TMUX_PANE` and writes the state file for that pane:

- `SessionStart` -> `idle`.
- `UserPromptSubmit`, `PreToolUse`, `PostToolUse` -> `working`. `PostToolUse` is load-bearing: it clears `waiting-permission` the instant a tool is approved, so a long post-approval command does not keep reading as "still waiting" (nothing else fires until the next `PreToolUse`/`Stop`).
- `Notification` by `notification_type`: `permission_prompt` -> `waiting-permission`; `agent_needs_input` -> `waiting-input`; `idle_prompt` -> `idle` (it fires ~60s into a wait when `Stop` has usually already set idle - it must NOT escalate to a waiting status, or every quiet pane floats to the top of the waiting-first sort and the signal becomes noise); other types ignored.
- `Stop` -> `idle`.
- `SessionEnd` -> remove the state file.

Hooks only write when `$TMUX_PANE` is set (so they are no-ops outside tmux).

**Detection strategy (hybrid, recommended):** enumerate the *union* of two sources, so neither can hide a Claude the other sees.

1. Snapshot all panes: `tmux list-panes -a -F '#{pane_id}\t#{session_name}\t#{window_index}\t#{pane_index}\t#{pane_current_command}\t#{pane_title}\t#{pane_current_path}'`.
2. Candidate set = (panes with a state file in `~/.claude/tmux-state/`) UNION (panes whose command matches the version regex `^[0-9]+\.[0-9]+\.[0-9]+$` or whose title starts with a Claude glyph). The state-file arm catches Claude wrapped by another process - e.g. inside `nvim :terminal`, where `pane_current_command` is `nvim` and nvim owns the title - which the command/glyph arm alone would miss.
3. Status resolution per candidate: if a state file exists, use it (precise), applying the stale-`working` demotion from the epoch. If not, fall back to the title glyph - but ONLY when the command regex also matches, so a lingering `✳ ...` title on a plain shell pane (claude exited, shell survived) does not resurrect as a ghost idle Claude.
4. Prune state files whose pane id is no longer in the `list-panes -a` snapshot.

**Presentation:** an `fzf` list, sorted waiting-first, one row per Claude pane:

```
⏳ personal-assistant:1   ~/pa      waiting: permission    2m
✳  scratch:1             ~/dotfiles idle                   5m
⠿  devclarity-vault:2    ~/dev...  working                 just now
```

**Action:** Enter jumps directly to the pane with a single command: `tmux switch-client -t <pane_id>`. In 3.6a a pane target for `switch-client` changes session, window, and pane in one step - this avoids a three-command sequence that would race `renumber-windows on` (a window closing between the list snapshot and Enter shifts indexes, so a `select-window` by index lands on the wrong window). (Secondary actions such as kill/peek are possible but out of scope for v1.)

**Scripts** live in `~/dotfiles/.tmux/scripts/` (new dir): `claude-map` (the popup renderer) and the small hook writer(s), plus whatever helper `qc` and `prefix + C` share for next-name resolution.

### Component 5 - Status-bar waiting counter (optional)

Append to `status-right` a glanceable count read from `~/.claude/tmux-state/`, e.g. `◍ 2 waiting`, updated via `status-interval`. A single small script counts files whose status is `waiting-*`. Easy to drop or defer; no dependency from the other components.

## File-by-file change summary

- `~/dotfiles/.tmux.conf` - Component 1 options; `prefix + C`, `prefix + S`, `prefix + g` bindings; Component 5 `status-right` fragment.
- `~/dotfiles/.tmux/scripts/` (new) - `claude-map`, hook writer script(s), name-resolution helper, status-counter script.
- `~/dotfiles/.config/tmuxinator/*.yml` (9 files) - Workspace + Claude shape with `MUX_LAYOUT` ERB toggle.
- `~/dotfiles/zsh/main.zshrc` - add `qc` function.
- `~/dotfiles/.zshrc` - refactor `nwt` to the new shape.
- `~/dotfiles/.claude/settings.local.json` - hook definitions. It is stowed to `~/.claude/settings.local.json`; because the repo currently ignores `.claude/` via the broad `claude` gitignore rule, the implementation must force-add it or narrow the ignore rule.

## Edge cases and risks

- **Title glyphs are undocumented** and could change across Claude versions. Mitigation: hooks are the source of truth; the glyph is fallback only. If glyphs change, only pre-hook sessions degrade.
- **`$TMUX_PANE` in hooks.** tmux documents that it passes the pane id to the pane's child process via `$TMUX_PANE`, and the live test confirmed a subprocess inherits it; the only residual risk is Claude Code sanitizing hook env, which the smoke test covers. If a future version drops it, hooks can fall back to matching `session_id` -> transcript, but v1 relies on the pane id.
- **Esc / interrupt strands `working`.** If the user interrupts and no `Stop` fires, the state file stays `working` and shadows the glyph fallback. Mitigated by the epoch-based stale-`working` demotion in the renderer. The smoke test must walk an interrupt explicitly.
- **Pane-id reuse across a server restart.** Within one server's life pane ids are never reused, so the key is safe; but a fresh server restarts ids from `%0`, and files orphaned by a crash could match new panes. Handled by clearing the state dir on server start (Component 1). Live-prune only catches ids absent from `list-panes -a`, which cannot catch this case.
- **Stale state files** during a session: pruned on each minimap open by intersecting with `list-panes -a`; `SessionEnd` also removes them.
- **Multiple tmux servers / sockets** are out of scope; the minimap sees only the default server. Noted for a future extension (iterate `tmux -L <socket>`).
- **`~/.claude/settings.local.json` is user-global**, shared across all repos - hooks must be cheap and must no-op cleanly when `$TMUX_PANE` is unset so non-tmux usage is unaffected.

## Build order

Risk is concentrated in the hook state machine, which is also the smallest artifact. Build and validate in this order so the core bet is proven before any UI or churn:

1. **Hooks + state dir + smoke tests.** Confirm `$TMUX_PANE` reaches the hook env, then walk one session through the full cycle - prompt -> tool -> permission prompt -> approve -> long tool -> `Stop` -> ~60s idle -> Esc interrupt - `cat`-ing the state file at each step. This surfaces the state-machine issues before any consumer exists.
2. **`claude-map` popup + jump.** The payoff; known-good pattern (`display-popup -E` + fzf + `switch-client`). Exercises union enumeration, glyph fallback, epoch demotion, and pruning.
3. **Launcher keybinds** (`prefix + C`, `qc` / `prefix + S`), including the tty handling for the picker.
4. **tmuxinator + `nwt` refactor** to Workspace + Claude. Mechanical, biggest churn, zero dependency on the minimap - doing it earlier would be cost without de-risking. Roll the `wide` ERB toggle out after the base reshape is proven.
5. **Status-bar counter** (Component 5) whenever; optional.

## Success criteria

- One keystroke adds a Claude window to the current session; one command/keystroke opens a scratch Claude with an optional root.
- Project sessions come up as Workspace + Claude, with a `wide` grid option at creation.
- `prefix + g` lists every Claude pane on the server, marks which are waiting, and jumps to the selected one.
- Non-tmux Claude usage and other repos are unaffected by the global hooks.
