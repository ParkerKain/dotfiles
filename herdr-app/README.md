# herdr-app

Config for the Herdr desktop app on both of Parker's machines: the work Mac and Omarchy (personal, Linux). `link.py` links each machine's share into `~/.config/herdr-app/`.

Mods here change how Herdr looks or behaves for Parker. A mod that a skill or a parker-agent-kit CLI drives (Tasks, Calendar, Draft review, Report review, Artifacts, Call Sheet, Factory) lives in parker-agent-kit beside that code, and its `scripts/link.sh` links it on the work Mac. See "What goes here versus dotfiles" in the kit README. The Jobs panel and its engine live here because both machines run them.

## How the two machines split

| Layer | Where | Example |
|-------|-------|---------|
| Shared by both | `settings.base.json`, `themes/`, `layouts/`, most of `mods/`, `jobs/` | theme, fonts, sounds, tab bar, session launcher, job engine |
| Per machine | `machines/<machine>/` | `keys.json` (Cmd on the Mac, Alt and Ctrl+Shift on Omarchy), font size |
| What each machine installs | `machines/<machine>.toml` | which mods and layouts it links, its job sources, its launcher repos |

`machine.py` decides which machine this is: `$PARKER_MACHINE`, else `~/.config/parker/machine` (written by `link.py`), else macOS is `mac` and Linux is `omarchy`.

### Rules for a new piece

- Same on both machines: put it in the shared files and list the mod in both manifests.
- Same idea but different OS plumbing: one shared mod or CLI that branches on the platform (`window().platform` in a mod, `sys.platform` in Python), like the job engine (launchd or systemd) and the session launcher (osascript or notify-send).
- Only makes sense on one machine: list it in that machine's manifest only. `music`, `demo-mode`, `demo-quiet` and `run-once` are Mac-only.
- Driven by DevClarity work data: put it in parker-agent-kit and add it to `external_mods` in `machines/mac.toml`, so the Mac's layouts keep its panel.

## Linking

```sh
python3 ~/dotfiles/herdr-app/link.py --check   # what differs, changes nothing
python3 ~/dotfiles/herdr-app/link.py           # link this machine
```

On Omarchy, `./install-omarchy.sh herdr` runs the same thing. Run it from `~/dotfiles` (it refuses to run from a worktree, since links point at the checkout that runs it). It moves files it replaces to `~/.local/state/herdr-link/backups/`.

- `keys.json` links to `machines/<machine>/keys.json`.
- `settings.json` gets `settings.base.json` and `machines/<machine>/settings.json` merged in. Herdr writes zoom and other settings there itself, and the merge keeps those. On the Mac the file is an untracked `herdr-app/settings.json` that `~/.config/herdr-app/settings.json` links to.
- Each listed layout links to `layouts/`. When a layout has panels whose mod the machine lacks (Tasks, Calendar, Artifacts, Call Sheet and Factory on Omarchy), `link.py` writes a copy without them instead, and the tab bar shows only the panels the layout has.
- Each listed mod links to `mods/<mod>`. Links to dotfiles mods a machine no longer lists are removed.
- `~/.local/bin/job` links to the job engine, and every job or hook that's turned on gets its schedule rewritten to run it.

Herdr picks up a relinked mod right away, because `link.py` replaces links by rename. After editing a mod's files behind an existing link, re-create its link the same way: `cd ~/.config/herdr-app/mods && ln -s "$(readlink <mod>)" .<mod>.tmp && mv -h .<mod>.tmp <mod>` (`mv -T` on Linux).

## Jobs and hooks

`jobs/job` runs scheduled agent jobs and hooks as Herdr sessions, and the Jobs panel (`mods/jobs`) shows them. Each machine reads only the sources in its manifest's `[jobs]`, so work jobs and hooks (parker-agent-kit `jobs/defs/`) stay on the Mac and personal jobs (`machines/omarchy/jobs/`) stay on Omarchy.

- A job file has `repo`, `agent` (`claude` or `codex`), `prompt` or `prompt_file`, and an optional `[schedule]` (`times = ["07:00"]`, optional `weekdays` with 1 = Monday). Its session opens in the Herdr space named by `space` (default `Jobs`, created when missing), so any first-run question it asks is visible.
- A hook file has `check = "<script>"` and `interval = <seconds>`. The script answers `check` and `status` (JSON `{ok, hooks: [{last_check, last_trigger}]}`), and the engine schedules the check.
- `job install <name>` writes a launchd plist on macOS (`com.parker.job.<name>`, `com.parker.hook.<name>`) or a systemd user timer on Linux (`parker-job-<name>`, `parker-hook-<name>`). The panel's Turn on and Turn off do the same.
- `job pause` and `job resume` (the panel's Pause button, and demo mode) make scheduled runs and checks skip.

Run `job --help` for every command.

## Files

- `layouts/Parker.json` - my layout (a clone of Herdr's `main`, with the usage limits status bar and the side panels).
- `layouts/Demo.json` - demo mode's screen (Mac only). It's Parker without the sidebar, with the tab bar showing only Files and Changes and notifications dropped.
- `themes/` - 67 color themes for Herdr's theme picker (Settings > Look, or `Use a theme` in the command palette). `rose-pine-moon.json` is hand-tuned, the rest are converted from Ghostty's bundled themes by `themes/import-ghostty.py` (edit its list and rerun).
- `frost` and `frost.py` - frosted-glass look. `./frost <wallpaper>` saves a blurred copy of the image, sized for the machine's display (`screen` in its manifest), to `backgrounds/` (`--blur 0` keeps it sharp) and rebuilds the generated Frosted layout from this machine's Parker layout. `--list` shows wallpapers in `~/Pictures/wallpapers` (Mac) or `~/Wallpapers` (Omarchy), and `--desktop` also sets the macOS wallpaper. `frost` finds a Python with Pillow (Homebrew's, or uv's on Omarchy).
- `mods/wallpaper` - wallpaper picker with thumbnails. Enter applies one behind the Frosted layout and switches to it, and `b` toggles blur. After adding wallpapers, run `./frost --thumbs`.
- `mods/session-launcher` - prompt-driven session launcher shared with Tasks Play. It routes to the repos in the manifest's `[launcher]` (work repos on the Mac, `~/Projects` on Omarchy). Start closes the window at once while `projects.py` routes and launches in a detached process, because closing the overlay ends the mod's script.
- `mods/keybind-help` - shows Parker's shortcuts from `keys.json`, in Mac or Linux notation. Escape closes it.
- `mods/my-tabs` - a clone of the shipped tab bar with buttons for the side panels the layout has, plus Music where the music mod is installed (with `props.demo`, Files and Changes only).
- `mods/my-files` - a clone of the shipped Files panel. A file opens as highlighted source with long lines wrapped, and a markdown file opens as rendered text. The header's Wrap button (`cmd-shift-z` on the Mac, `alt-z` on Omarchy) switches to sideways scrolling, and Rendered and Source (`cmd-shift-v` on the Mac, `ctrl-shift-v` on Omarchy) switch a markdown file's view. Both choices are remembered, by each layout's copy of the panel. The keys work while the panel has the keyboard. Herdr's editor colors a fixed set of languages, so `EXTENSION` and `FILENAME` in `main.js` send other file types (TypeScript, C#, TOML, Dockerfile, dot files) to the closest one.
- `mods/space-sessions` - collapsible space groups with inset dividers between session rows, expanded by default.
- `mods/revive` - recently killed terminals with their last screen. Enter resumes the Claude or Codex session (or reopens the shell) in a new tab.
- `mods/usage-limits` - from github.com/nozikov/herdr-usage-limits (commit 19fda91). It fills the whole status row, with the machine and branch on the left and the limits on the right.
- `mods/jobs` - the Jobs and Hooks panel (see above).
- `mods/music` (Mac) - Apple Music controls and Lofi Girl playlist shortcuts. Start with [Music setup](mods/music/README.md) when signed out.
- `mods/demo-mode` (Mac) - toggles demo mode, which shows the Demo layout in the current space and pauses jobs. Toggling again goes back to the previous layout. While Demo shows, the keys that jump to other agents, spaces, layouts or the picker go to the terminal instead.
- `mods/demo-quiet` (Mac) - the Demo layout's notification mod, which drops every notification so no session name shows mid-demo.
- `mods/run-once` (Mac) - a popup that runs one zsh command (demo-on, demo-off) and closes.

To enable **Codex Personal** on the Mac's usage limits, put Omarchy's machine name from `hc machine ls` in `~/.config/herdr-app/data/usage-limits/personal-machine`. The mod uses Herdr's existing connection and Omarchy's signed-in Codex via mise. Codex Personal shows only in the hover panel, not on the bar.

## Tests

```sh
python3 -m unittest herdr-app/test/job_test.py herdr-app/test/link_test.py herdr-app/test/session_projects_test.py herdr-app/test/music_control_test.py
node --test herdr-app/test/*.cjs
```
