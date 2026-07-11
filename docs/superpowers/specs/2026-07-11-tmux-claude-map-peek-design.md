# tmux Claude minimap: color coding + top-right status peek - Design

Date: 2026-07-11
Repo: `~/dotfiles`
Status: approved design, pending implementation plan

## Problem

The global Claude minimap (`prefix + g`, see `2026-07-10-tmux-claude-workflow-design.md` Component 4) is an interactive fzf popup for hopping between Claude sessions - it works well for that, but it's centered, takes over the screen, and requires committing to picking something. There's no cheap way to just glance at "what's running and does anything need me" without opening the full picker. The existing status-bar counter (Component 5, `claude-waiting-count`) covers a sliver of this (a bare `◍ N waiting` count) but has no detail - no per-pane breakdown, no color, no way to see it on demand as a richer view.

## Goals

1. Add a second, smaller popup - a read-only, glanceable view of every Claude pane, positioned top-right, toggled independently of the big minimap.
2. Color-code status in both the big minimap and the new small popup, so urgency is visible at a glance, not just via icon/text.
3. Share the pane-enumeration/status logic between both views so detection/status bugs get fixed once.

## Non-goals

- Changing `prefix + g` / the big minimap's interaction model (still fzf, still jumps on Enter).
- Replacing the existing status-bar counter (`claude-waiting-count` stays as-is; it's a different, always-on glance surface).
- Session-level aggregation - this design keeps per-pane granularity (user's explicit choice) for the small popup, same as the big one.
- Multi-socket / multi-server support (inherits the non-goal from the parent design).

## Design

### Component 1 - Shared enumeration/status library

Extract the pane-scanning and status-resolution logic currently inlined in `claude-map` (reading `tmux list-panes -a`, cross-referencing `~/.claude/tmux-state/*`, computing status/icon/age per pane, the stale-`working` demotion, and pruning dead state files) into `~/dotfiles/.tmux/scripts/claude-map-lib`.

The lib is sourced (not executed standalone) by both consumers and exposes the row-building step as its unit of output: one line per live Claude pane, tab-delimited, sorted worst-status-first, now also carrying an ANSI color code alongside the existing icon/status/age fields.

**Color mapping** (applies identically in both consumers):

| status | color |
|---|---|
| `waiting-permission` | red |
| `waiting-input` | yellow |
| `working` | blue/cyan |
| `idle` | gray/default |

### Component 2 - `claude-map` (existing, refactored)

Sources `claude-map-lib` instead of inlining the scan. Behavior is unchanged (fzf popup, `prefix + g`, Enter jumps via `switch-client`), except:
- Rows now carry embedded ANSI color codes.
- `fzf` is invoked with `--ansi` so those colors render in the picker instead of showing as raw escape sequences.

### Component 3 - `claude-map-peek` (new)

A read-only renderer, same row data (same granularity, same sort order) as `claude-map`, but:
- No `fzf` - just prints the rows straight to the popup's terminal (colors render natively, no `--ansi` needed since there's no picker layer).
- Capped at 10 rows to keep the "small" footprint honest. If more than 10 live Claude panes exist, show the 10 worst-status rows plus a trailing line: `+N more - prefix+g for full list`. Never silently truncate without that line.
- Self-refreshes every 2s while open (matching the cadence class of the existing `status-interval 5` counter - fast enough to feel live, cheap enough not to matter). Exits immediately on any keypress.

### Component 4 - Toggle keybind (`prefix + G`)

`prefix + G` is bound to a small wrapper (`claude-map-peek-toggle`, or inlined directly in `.tmux.conf` if short enough) that:
1. Checks whether a `claude-map-peek` popup is already open for the current client.
2. If open, closes it (tmux's popup-close mechanism for the running client - exact flag TBD at implementation, tmux 3.6a is confirmed to support closing a client's active popup).
3. If not open, opens one via `display-popup`, anchored top-right (`-x 100%`, right-aligned; `-y 0`, top-aligned), width narrow enough to read a session/pane label plus status without wrapping, height sized to the row count (capped per Component 3).

This makes `prefix + G` a true toggle: press to show, press again (or any keypress while it's focused) to dismiss - no separate close keybind to remember.

### tmux.conf changes

- New `bind-key G` binding (Component 4). `prefix + g` (lowercase, existing) is untouched.
- No new global options needed; existing `STATE_DIR`, `status-interval`, and popup infrastructure from the parent design are reused as-is.

## File-by-file change summary

- `~/dotfiles/.tmux/scripts/claude-map-lib` (new) - shared enumeration, status resolution, color mapping, row formatting.
- `~/dotfiles/.tmux/scripts/claude-map` (refactor) - sources the lib, adds `--ansi` to the fzf invocation.
- `~/dotfiles/.tmux/scripts/claude-map-peek` (new) - static/refreshing colored renderer, row cap + overflow line.
- `~/dotfiles/.tmux/scripts/claude-map-peek-toggle` (new, or inlined) - open/close toggle logic for the small popup.
- `~/dotfiles/.tmux.conf` - `bind-key G` binding.

## Edge cases and risks

- **Refactor risk to the working minimap.** `claude-map` is already in production use; the extraction into `claude-map-lib` must not change its externally-visible behavior (row content, sort order, jump target) except for the added color. Verify with `CLAUDE_MAP_DRYRUN=1` (existing test hook) before and after the refactor to diff output.
- **Popup-close mechanism unconfirmed.** The exact tmux command/flag to close a running client's popup from a keybind needs a quick live check against 3.6a before Component 4 is built; if no direct close exists, fall back to the popup's own any-keypress-exits behavior (Component 3) and accept that `prefix + G` while a peek is open opens a second popup on top rather than truly toggling - noted as a fallback, not the target design.
- **Color rendering in fzf.** Requires `--ansi`; without it, escape codes would show as literal text in the picker. Must be verified visually during build, not just by reading code.
- **Terminal color support.** Assumes the terminal (Ghostty, per this repo's config) renders ANSI color in a tmux popup - safe assumption given the existing rose-pine tmux theme already relies on this, but worth a glance during smoke testing.

## Build order

1. Extract `claude-map-lib` from `claude-map`, verify via dry-run diff that behavior is unchanged.
2. Add color to the lib's row output; verify `claude-map`'s fzf view renders colors correctly with `--ansi`.
3. Build `claude-map-peek` (static renderer + row cap + overflow line) using the lib.
4. Build the toggle wrapper and `prefix + G` binding; confirm the popup-close mechanism live against tmux 3.6a, falling back per the noted risk if unavailable.

## Success criteria

- `prefix + g` still opens the big interactive minimap, now color-coded, with identical jump behavior.
- `prefix + G` opens a small, top-right, read-only, color-coded view of every live Claude pane, and pressing it again (or any key) closes it.
- Both views share one enumeration/status implementation - a detection fix in the lib fixes both at once.
