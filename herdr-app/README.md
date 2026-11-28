# herdr-app

Config for the Herdr desktop app on both of Parker's machines: the work Mac and Omarchy (personal, Linux). `link.py` links each machine's share into `~/.config/herdr-app/`.

Mods here change how Herdr looks or behaves for Parker. A mod that a skill or a parker-agent-kit CLI drives (Tasks, Calendar, Draft review, Report review, Artifacts, Meeting mode, Factory, Lock-in, the day strip and the status-bar glances) lives in parker-agent-kit beside that code, and its `scripts/link.sh` links it on the work Mac. See "What goes here versus dotfiles" in the kit README. The Jobs panel and its engine live here because both machines run them.

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
- Each listed layout links to `layouts/`. When a layout has blocks whose mod the machine lacks (on Omarchy the kit's side panels, the day strip, the glances and the floating Lock-in), `link.py` writes a copy without them instead, and the tab bar shows only the panels the layout has. A missing pane header mod falls back to Herdr's `pane`, and a missing toast mod to Herdr's own toast.
- Each listed mod links to `mods/<mod>`. Links to dotfiles mods a machine no longer lists are removed.
- `~/.local/bin/job` links to the job engine, and every job or hook that's turned on gets its schedule rewritten to run it.

Herdr picks up a relinked mod right away, because `link.py` replaces links by rename. After editing a mod's files behind an existing link, re-create its link the same way: `cd ~/.config/herdr-app/mods && ln -s "$(readlink <mod>)" .<mod>.tmp && mv -h .<mod>.tmp <mod>` (`mv -T` on Linux).

## Jobs and hooks

`jobs/job` runs scheduled agent jobs and hooks as Herdr sessions, and the Jobs panel (`mods/jobs`) shows them. Each machine reads only the sources in its manifest's `[jobs]`, so work jobs and hooks (parker-agent-kit `jobs/defs/`) stay on the Mac and personal jobs (`machines/omarchy/jobs/`) stay on Omarchy.

- A job file has `repo`, `agent` (`claude` or `codex`), `prompt` or `prompt_file`, and an optional `[schedule]` (`times = ["07:00"]`, optional `weekdays` with 1 = Monday). Its session opens in the Herdr space named by `space` (default `Jobs`, created when missing), so any first-run question it asks is visible.
- A hook file has `check = "<script>"` and `interval = <seconds>`. The script answers `check` and `status` (JSON `{ok, hooks: [{last_check, last_trigger}]}`), and the engine schedules the check.
- `job install <name>` writes a launchd plist on macOS (`com.parker.job.<name>`, `com.parker.hook.<name>`) or a systemd user timer on Linux (`parker-job-<name>`, `parker-hook-<name>`). The panel's Turn on and Turn off do the same.
- `job pause` and `job resume` (the panel's Pause button, and demo mode) make scheduled runs and checks skip. `job pause --until 2h` (or `HH:MM`, or `YYYY-MM-DD HH:MM`) lifts itself at that time.
- A `close_when_done` run, or any run whose session goes to `error`, always ends with an outcome in `~/.local/state/parker-jobs/<job>.outcome` and a second `runs.jsonl` line (status, turn, duration, outcome, closed). When the agent wrote none, the runner writes one such as `error: session ended with status error after 24s, 1 turn, no outcome reported`.
- launchd reads the time zone once, at boot. If the Mac's zone changes later (Location Services when traveling), scheduled jobs fire on the old zone's clock until a restart, and reinstalling the plists doesn't help. `job status`, `job list`, `job install` and the Jobs panel warn when that has happened.

Run `job --help` for every command.

## Files

- `layouts/Parker.json` - my layout (a clone of Herdr's `main`). Under the tab bar is the kit's day strip (`day-strip`, today's calendar with a countdown ring at its start and ‹ Today › to step days; clicking an event opens Meeting mode on that session). The status row has the kit's glances (`glances`) for Tasks, Calendar, Lock-in, Factory and Artifacts before the usage limits, and a glance click opens or closes that panel, so the tab bar drops those buttons. Lock-in floats at the top of the work area (`lock-in`) and shows nothing until asked: Cmd+Shift+S (`lock-in.pick`) or the Lock-in glance drops down the two-week line of pins and takes the keyboard. Panes wear `pane-header`, and toasts are `parker-toast`. The side panels are Files, Changes, Tasks, Jobs, Calendar, Artifacts, Factory and Claude usage.
- `layouts/Meeting.json` (Mac) - Meeting mode's screen: Parker with the kit's `call-sheet` (agenda, points of performance and notes together) filling most of the work area over the active tab, and no side panel. Cmd+Shift+K or "Meeting mode" in the palette (`mod.open` call-sheet) saves the current layout and switches here. Leaving goes back to it.
- `layouts/Demo.json` - demo mode's screen (Mac only). It's Parker without the sidebar, with the tab bar showing only Files and Changes and notifications dropped.
- `themes/` - 72 color themes for Herdr's theme picker (Settings > Look, or `Use a theme` in the command palette). `rose-pine-moon.json` is hand-tuned. The five jade and emerald themes (`jade-temple`, `emerald-night`, `celadon`, `malachite`, `jade-brass`) come from `themes/jade.py`, which checks every color's contrast before it writes them (edit a palette there and rerun). The rest are converted from Ghostty's bundled themes by `themes/import-ghostty.py` (edit its list and rerun).
- `frost` and `frost.py` - frosted-glass look. `--theme <name>` tints the glass and the blurred image from that theme's colors, and later runs (including the Wallpaper picker) keep it. `--theme none` goes back to the original Rose Pine glass. `./frost <wallpaper>` saves a blurred copy of the image, sized for the machine's display (`screen` in its manifest), to `backgrounds/` (`--blur 0` keeps it sharp) and rebuilds the generated Frosted layout from this machine's Parker layout. `./frost --relayout` rebuilds Frosted from Parker with the background it already has, for after Parker's blocks change. `--list` shows wallpapers in `~/Pictures/wallpapers` (Mac) or `~/Wallpapers` (Omarchy), and `--desktop` also sets the macOS wallpaper. `frost` finds a Python with Pillow (Homebrew's, or uv's on Omarchy).
- `mods/wallpaper` - wallpaper picker with thumbnails. Enter applies one behind the Frosted layout and switches to it, and `b` toggles blur. After adding wallpapers, run `./frost --thumbs`.
- `wallpapers/jade.py` - draws seven jade and emerald wallpapers into `~/Pictures/wallpapers/jade` (or `~/Wallpapers/jade`). Run `./frost --thumbs` afterwards so the picker lists them.
- `mods/look-tryout` - Look tryout, from the command palette. It steps through the jade themes, terminal fonts, UI fonts and (in Frosted) green wallpapers, applying each live. `y` and `n` record a verdict in `~/.config/herdr-app/data/look-tryout/verdicts.json` and move on, arrows browse, Tab switches round, `b` toggles blur, Enter keeps what's showing (and writes theme and fonts to `settings.base.json`), and Esc puts the original look back. Closing it any other way also restores, through `restore.py`. The fonts it offers are Homebrew casks (`font-geist-mono`, `font-monaspace` and the others listed in `main.js`), and it skips any that aren't installed.
- `look.py`, `looks/` and `mods/look-presets` - saved looks: a theme, terminal and UI fonts, and the Frosted wallpaper with its glass tint. "Look presets" in the command palette lists them and Enter switches to one (it sets the theme in Parker, Frosted, Meeting and Demo, writes the fonts to settings.json and settings.base.json, and re-renders the wallpaper). `python3 look.py save <slug> --name "<name>"` saves the look showing now, and `look.py apply <slug>` switches from a shell. `rose-pine-original` and `terafox-green` are the first two.
- `mods/session-launcher` - prompt-driven session launcher shared with Tasks Play. It routes to the repos in the manifest's `[launcher]` (work repos on the Mac, `~/Projects` on Omarchy). While it routes, chips show the repos the request could go to, and Tab or a click picks another. Effort is a stepped bar. Opened on its own (Cmd+Shift+N) it is a frameless window whose card rises over its own backdrop while its rows cascade in, and drops and fades on Cancel, Esc or a click outside. The kit's Tasks Play and Lock-in fix open it as a 560x300 dialog with a `task` prop, and then the card fills Herdr's dialog with no backdrop, its rows still cascading in. Start closes the window at once while `projects.py` routes and launches in a detached process, because closing the overlay ends the mod's script.
- `mods/keybind-help` - shows Parker's shortcuts from `keys.json`, in Mac or Linux notation. Escape closes it.
- `mods/my-tabs` - a clone of the shipped tab bar with buttons for the side panels the layout has, plus Music where the music mod is installed (with `props.demo`, Files and Changes only). In a layout with a `glances` block it drops the Tasks, Calendar, Artifacts and Factory buttons, while every `my-tabs.panel-<id>` command still works. Opening and closing a panel posts the shared `panel.motion` handshake, so Tasks and Artifacts cascade in and out. A new tab fades and rises into the bar.
- `mods/my-files` - a clone of the shipped Files panel. A file opens as highlighted source with long lines wrapped, and a markdown file opens as rendered text. `cmd-e` opens Files and `cmd-shift-g` opens Changes on the Mac (`alt-e` and `alt-shift-g` on Omarchy), in Demo too. The header's Wrap button (`cmd-shift-z` on the Mac, `alt-z` on Omarchy) switches to sideways scrolling, and Rendered and Source (`cmd-shift-v` on the Mac, `ctrl-shift-v` on Omarchy) switch a markdown file's view. Both choices are remembered, by each layout's copy of the panel. The keys work while the panel has the keyboard. Herdr's editor colors a fixed set of languages, so `EXTENSION` and `FILENAME` in `main.js` send other file types (TypeScript, C#, TOML, Dockerfile, dot files) to the closest one.
- `mods/space-sessions` - collapsible space groups with inset dividers between session rows, expanded by default. A session working a task gets a second line with the task's title (from the `ops-tasks` CLI, so none on Omarchy), and clicking it opens Tasks scrolled to that task (shared `ops-tasks.reveal`). When spaces live on more than one machine, they sit under a collapsible header per machine (this machine first, others by their `hc machine ls` host name), and a collapsed machine's tabs drop out of the jump hints.
- `mods/pane-header` - the pane header: icon, name, folder, status and hover buttons, as Herdr's `pane`. Cmd+Shift+I and "Diagnose" in the palette open the `diagnose-shortcut` mod, which dispatches `pane-header.diagnose`. The focused pane's header asks "What went wrong in <session>?" and quotes the agent's last line. Enter forks a diagnostic agent with `herdr-delegate fork`. Without `~/.local/bin/herdr-delegate` (Omarchy) Diagnose stays off.
- `mods/parker-toast` - notifications that know their source (Calendar, Factory, Artifacts, Tasks, Lock-in, Jobs): the source's glyph and color, a bar that drains over the timeout, and a click that runs the action, opens the link or opens the source's panel. "Toast demo" in the palette posts three samples.
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
