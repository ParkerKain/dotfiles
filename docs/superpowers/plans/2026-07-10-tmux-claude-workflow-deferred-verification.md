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

## Unchecked acceptance checklist

- [ ] Start a fresh Claude after the final hooks are live.
- [ ] Submit a prompt and observe `working`, then let the turn finish and observe `Stop` writing `idle`.
- [ ] Trigger a permission prompt and observe `waiting-permission`.
- [ ] Approve the prompt and confirm `PostToolUse` returns the pane to `working` during a long-running tool.
- [ ] Trigger `agent_needs_input` and observe `waiting-input`.
- [ ] Trigger `idle_prompt`, wait about 60 seconds, and confirm the state remains `idle`.
- [ ] Press Esc during a run, confirm it can strand the pane at `working`, then confirm `claude-map` demotes it after 900 seconds.
- [ ] End the Claude session and confirm `SessionEnd` removes the pane state file.
- [ ] Perform an Edit and confirm the existing voice-check hook still runs.
- [ ] Start Claude outside tmux and confirm it writes no pane state file.

Any failure reopens Task 2. A failure specifically involving stale demotion or map presentation also reopens Task 3.

## Completion record

- Date:
- Result: pending
- Notes:
