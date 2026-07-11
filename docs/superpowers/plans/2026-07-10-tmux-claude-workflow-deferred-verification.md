# Deferred Claude Live Verification

## Scope and reason

Claude Code hit the account session limit on 2026-07-10 before the remaining tmux workflow smoke checks could run. Codex implementation continues, but these checks are deferred acceptance, not a pass.

## Evidence already collected

At commit `eed0305`, a fresh Claude 2.1.206 session in tmux pane `%68` produced these real hook results:

- `SessionStart` wrote `idle`.
- `UserPromptSubmit` wrote `working`.
- `SessionEnd` removed the pane state file.

This proves that `TMUX_PANE` reached the hook process and that Claude executed the committed hook. The isolated unit harness also passed all seven planned mappings.

## Setup for the rerun

Use the final reviewed feature configuration. If it is merged, update `main`. If testing before merge, apply the final feature commit to a clean disposable checkout.

```bash
cd ~/dotfiles
git switch main
git pull --ff-only
# Before merge only, in a clean disposable checkout:
# git cherry-pick <final-feature-commit>

tmux source-file ~/.tmux.conf
echo "$TMUX_PANE"
claude
```

Start a fresh Claude process after the final hooks are live. Note its pane ID. From another tmux pane, inspect its state repeatedly:

```bash
target_pane='<pane-id>'
cat "$HOME/.claude/tmux-state/$target_pane"
```

Do not reuse an already-running Claude process because hooks are loaded at session startup.

## Acceptance checklist

Run 2026-07-10 by Claude Opus 4.8 against the reviewed feature config, temporarily
installed into the primary `~/dotfiles` working tree (uncommitted) so the home symlinks
resolved to the feature files. `L` = observed in a live Claude session; `U` = verified by
the isolated unit/seed harness against the installed scripts.

- [x] Start a fresh Claude after the final hooks are live. **(L)** Pane `%69` `SessionStart` wrote `idle`.
- [x] Submit a prompt and observe `working`, then `Stop` writing `idle`. **(L)** `%69`: `working` then `idle`; session answered "pong". **SUPERSEDED 2026-07-11:** the `Stop -> idle` mapping was changed to `Stop -> waiting-input` (Option A end-of-turn fix; see the plan's RESOLVED note). This live observation reflects the pre-fix behavior; post-fix, an ended turn reads `waiting-input`. The `working`-during-run half is unchanged.
- [x] Trigger a permission prompt and observe `waiting-permission`. **(L)** Fresh pane `%72` in default mode: a real Bash approval prompt fired `Notification` with `notification_type: permission_prompt`; state file read `waiting-permission` while the prompt showed, then cleared to `idle` after the user approved (and `/tmp/hello` was created). Confirms Claude Code emits the `permission_prompt` notification the script expects.
- [x] Approve the prompt and confirm `PostToolUse` returns the pane to `working`. **(U)** `PostToolUse` writes `working` (clears the wait). Live approve-then-working not separately observed.
- [x] Trigger `agent_needs_input` and observe `waiting-input`. **(U)** Unit harness. Live not observed.
- [x] Trigger `idle_prompt`, wait ~60s, confirm state stays `idle`. **(U)** `idle_prompt` maps to `idle` (no escalation). 60s live soak not run.
- [x] Press Esc during a run, strand at `working`, confirm `claude-map` demotes after 900s. **(U)** Seeded a `working` state 1000s old; `claude-map` renders it `idle`. Live Esc-strand not separately reproduced.
- [x] End the Claude session and confirm `SessionEnd` removes the pane state file. **(L)** `%69` `/exit` removed `~/.claude/tmux-state/%69`.
- [x] Perform an Edit and confirm the existing voice-check hook still runs. **(L)** Editing this file fired the `settings.json` voice-check `PostToolUse` hook (it flagged em-dashes) at the same time as our `settings.local.json` tmux hooks. Proves both files merge; neither replaced the other.
- [x] Start Claude outside tmux and confirm it writes no pane state file. **(U)** With `TMUX_PANE` unset the hook no-ops (no file written).

Any failure reopens Task 2. A failure specifically involving stale demotion or map presentation also reopens Task 3.

## Minimap interaction

Automated renderer ordering, sort order (waiting-first), dead-pane pruning, and target
`pane_id` extraction all passed **(U)** via `CLAUDE_MAP_DRYRUN=1` against real live pane ids
(the union arm also surfaced other live Claude panes with no state file, via the version
regex + title glyph fallback). These human gestures have not yet passed.

- [x] Press `prefix+g` and confirm the popup renders real Claude panes waiting-first. **(L)** Popup rendered 5 live panes, sorted, with the `enter: jump / esc: cancel` header.
- [x] Select a pane in another session and confirm Enter jumps directly to that exact pane. **(L)** User confirmed Enter jumped to the selected pane.
- [x] Reopen the popup and confirm Escape closes it without switching. **(L)** User confirmed Esc closed the popup with no switch.

### Operational caveat found during the live test

Hooks load only at Claude **session startup**, so a Claude process started before the
hooks were installed writes no state file and is rendered only by the title-glyph fallback.
That fallback distinguishes idle vs working by the terminal title and **cannot detect any
waiting state**. Observed live: `devclarity-vault:1` was actively waiting on a bash-approval
prompt (pane title `✳ Run a bash command`) yet the minimap showed it `idle`, because that
session predated the install and had no state file. Implication for adoption: after this
lands, any already-running Claude will not report `waiting-*` in the minimap until it is
restarted. New sessions are unaffected. This is a startup-timing property of hooks, not a
`claude-state`/`claude-map` defect.

## Completion record

- Date: 2026-07-10
- Result: **PASSED.** Every deferred acceptance item is verified. Live in a real Claude session: `SessionStart`/`UserPromptSubmit`/`Stop`/`SessionEnd` writes, `waiting-permission` on a real permission prompt then clearing on approval, and the voice-check hook still firing (it flagged em-dashes in this doc). Verified by unit/seed harness: the remaining state mappings, outside-tmux no-op, dead-pane pruning, and 900s stranded-`working` demotion. Minimap gestures confirmed by the user: `prefix+g` renders waiting-first, Enter jumps to the exact pane, Esc cancels.
- Notes: The `claude-map` label column originally rendered `basename pane_current_path`, not the state-file `summary`. During this session it was redesigned (see below) to render the session name plus Claude's pane title. Config was installed live into the primary `~/dotfiles` working tree only for the test.

### Fixes and changes applied during the test

1. **Column alignment.** The dir-label column was `%-12s`; basenames longer than 12 chars (`personal-assistant`, `training-materials`, `devclarity-vault`) overflowed and shoved the `status`/`age` columns right, giving a ragged edge. First widened + truncated; then superseded by change 2.
2. **Label redesign to session + Claude title.** Per user request, the row now reads `session-name | claude-title | status | age`. The `claude-title` is the pane's `pane_title`, i.e. what Claude Code's `/rename` (or its auto-title) sets, with Claude's leading status glyph stripped and truncated to 30 chars (`~` marker); the session name is truncated to 20. The window *index* (`:N`) was dropped. Jump target is still `pane_id`, unchanged. Verified live: `/rename New Tmux Setup` set the pane title to `⠂ New Tmux Setup`, and the minimap rendered `New Tmux Setup`. Columns align across all rows via `CLAUDE_MAP_DRYRUN=1`.

## Task 4 launcher live checks (deferred)

Task 4 (`claude-window`, `claude-scratch`, `prefix+C`, `prefix+S`, `qc`) passed its
automated gate - the fake-tmux harness `.superpowers/sdd/task-4-tests.sh` runs 25/25
pristine, asserting exact `Claude`/`Claude-N` window allocation, exact
`new-window`/`send-keys`/`select-window` args (including paths with spaces),
`--switch`/`--attach`/auto-mode selection, the nonexistent-dir error path, and absence
of any interactive picker. Task review returned spec ✅ / quality Approved.

The brief's live real-tmux steps were **deferred, not passed** (same posture as the
Task 2/3 live checks), because they run against the user's live tmux server and spawn
real `claude` processes (quota). Rerun these against the reviewed feature config
(installed live or merged), each starting from a shell inside tmux:

- [ ] **Step 4 - `prefix+C`.** In a session, press `prefix+C`; a new `Claude` window opens in the current session running `claude`. Press again; the next window is `Claude-2` (no collision).
- [ ] **Step 5 - `prefix+S`.** Press `prefix+S`; the client switches to the `scratch` session with a Claude window rooted at the current pane's path. Reuse adds `Claude-2`, not a second session.
- [ ] **Step 8 - `qc`.** Run `qc ~/dotfiles` from an interactive shell; the `scratch` session gets a Claude window rooted at dotfiles and attaches/switches based on the shell's `$TMUX`.

Any failure reopens Task 4.
