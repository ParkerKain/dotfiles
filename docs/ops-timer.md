# ops-timer: Toggl Track in the tmux status bar

A right-status chip beside `claude-waiting-count` showing the running Toggl
timer, and three tmux bindings to start, stop, or pick a task to track. A
one-minute launchd job keeps the chip's data fresh without a network call on
every status-bar redraw.

## How it works

- The chip runs `ops-tasks track status --format tmux`, which reads a display
  cache at `~/.local/state/ops-tasks/timer.json` and computes elapsed time
  locally. It makes no network call itself, which matters at a five second
  `status-interval` across several clients.
- A separate launchd job runs `ops-tasks track sync` once a minute (and once
  at load). That is the only thing that talks to Toggl and writes the cache.
- The window's task comes from `@ops-task-ref`, a tmux window option stamped
  by the ops-tasks TUI when it opens a harness window. `prefix+t` reads that
  option, so starting a timer on a harness window needs no picker.
- Nothing starts a timer on its own except a calendar meeting (handled inside
  `ops-tasks track sync`, not by this tmux glue). A manual timer you started
  yourself is never stopped by the sync.

## Requirements

- tmux
- `ops-tasks` on `PATH` (installed via `go install ./cmd/ops-tasks`, normally
  at `~/go/bin/ops-tasks`)
- A `[toggl]` table configured in `ops-tasks`'s config, with a Toggl API
  token. Until that exists, `ops-tasks track status` prints nothing and exits
  0 - that is the correct, expected state, not a bug.

## Install

### 1. Get the script onto disk

`.tmux/scripts/ops-timer-status` ships in this repo. Make sure it is
executable:

```sh
chmod +x ~/.tmux/scripts/ops-timer-status
```

### 2. Wire up `.tmux.conf`

The right-status append (near the existing `claude-waiting-count` line):

```tmux
set -g @rose_pine_status_right_append_section '#(~/.tmux/scripts/ops-timer-status)#(~/.tmux/scripts/claude-waiting-count)'
```

The three bindings (near the `prefix+G` block):

```tmux
bind-key t   display-popup -E -w 60 -h 12 'ops-tasks track start --window'
bind-key T   run-shell 'ops-tasks track stop'
bind-key M-t display-popup -E -w 80 -h 20 'ops-tasks track start'
```

**Note: this replaces the default `prefix+t` binding (`clock-mode`).** That
default is gone on this machine in favor of the timer. `display-popup -E`
gives the create-offer a TTY, which is why `prefix+t` is a popup and
`prefix+T` is not.

Reload with `tmux source-file ~/.tmux.conf`.

### 3. Install the launchd job

```bash
cp Library/LaunchAgents/com.devclarity.ops-tasks-track.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.devclarity.ops-tasks-track.plist
```

Verify:

```bash
launchctl print gui/$(id -u)/com.devclarity.ops-tasks-track | head -20
```

Wait a minute, then confirm the display cache is being written:

```bash
ls -l ~/.local/state/ops-tasks/timer.json
cat /tmp/ops-tasks-track.err
```

### 4. Verify

- The right status bar shows `◌ untracked` or nothing, depending on the hour
  and whether Toggl is configured.
- Press `prefix+t` in a window the ops-tasks TUI opened; the bar should
  change to the running timer within five seconds.

## Troubleshooting

- **A dim chip** means the sync has not run in three minutes. Check:

  ```bash
  launchctl print gui/$(id -u)/com.devclarity.ops-tasks-track
  cat /tmp/ops-tasks-track.err
  ```

- **No chip at all** and Toggl is unconfigured: expected, not a fault. The
  script and `ops-tasks track status` both stay silent until a `[toggl]`
  table with a token is added to the config.
- **The job is not loaded**: `launchctl print` returns nothing. Re-run the
  `bootstrap` command from Install step 3.

## Uninstall (fully reversible)

Unload and remove the launchd job:

```bash
launchctl bootout gui/$(id -u)/com.devclarity.ops-tasks-track
rm ~/Library/LaunchAgents/com.devclarity.ops-tasks-track.plist
```

Remove the tmux bindings and status chip: delete the three `bind-key t` /
`bind-key T` / `bind-key M-t` lines and the `ops-timer-status` half of the
`@rose_pine_status_right_append_section` value from `~/.tmux.conf`, then
`tmux source-file ~/.tmux.conf`. `prefix+t` reverts to tmux's built-in
`clock-mode` once its `bind-key t` line is removed.

Nothing else on the machine depends on either the chip or the job; removing
them leaves `ops-tasks` itself untouched.
