# herdr-app

Config for the Herdr desktop app. Each item is symlinked into `~/.config/herdr-app/`.

Mods here change how Herdr looks or behaves for Parker. A mod that a skill or a parker-agent-kit CLI drives (Calendar, Jobs, Draft review, Report review, Artifacts) lives in parker-agent-kit beside that code, and its `scripts/link.sh` links it. See "What goes here versus dotfiles" in the kit README.


- `settings.json` - zoom, sounds, fonts, theme
- `layouts/Parker.json` - my layout (a clone of Herdr's `main`, with the usage limits status bar and the Tasks, Jobs and Calendar panels)
- Tasks panel (`ops-tasks` mod) - source in parker-agent-kit `tasks/herdr-mod/ops-tasks`, linked by its `scripts/link.sh`
- `mods/session-launcher` - prompt-driven session launcher shared with Tasks Play, where it takes optional extra instructions appended to the task prompt
- Calendar panel (`day-view` mod) - source in parker-agent-kit `calendar/herdr-mod/day-view`, symlinked into `~/.config/herdr-app/mods/day-view`. Cmd+Shift+C toggles it
- `themes/` - 67 color themes for Herdr's theme picker (Settings > Look, or `Use a theme` in the Cmd+Shift+P palette). `rose-pine-moon.json` is hand-tuned, the rest are converted from Ghostty's bundled themes by `themes/import-ghostty.py` (edit its list and rerun)
- `frost.py` - frosted-glass look: `python3 frost.py <wallpaper>` saves a blurred copy of the image to `backgrounds/` (`--blur 0` keeps it sharp) and rebuilds the generated Frosted layout from Parker.json with translucent terminals and panels. `--list` shows wallpapers in `~/Pictures/wallpapers`, `--desktop` also sets it as the macOS wallpaper
- `keys.json` - binds Cmd+Shift+N to the session launcher, Cmd+Shift+E to run-once and Cmd+Shift+M to demo mode
- `layouts/Demo.json` - demo mode's screen: Parker without the sidebar, the tab bar showing Files and Changes in place of Tasks, Jobs and Artifacts, and notifications dropped
- `mods/demo-mode` - Cmd+Shift+M toggles demo mode: the Demo layout in the current space (open the space you're demoing first), and back to the previous layout. While Demo shows, the keys that jump to other agents, spaces, layouts or the picker go to the terminal instead
- `mods/demo-quiet` - the Demo layout's notification mod, which drops every notification so no session name shows mid-demo
- `mods/run-once` - Cmd+Shift+E popup: type one command (demo-on, demo-off), it runs in zsh and closes
- Jobs panel (`jobs` mod) - source in parker-agent-kit `jobs/herdr-mod/jobs`, linked by the kit's `link.sh`
- `mods/revive` - Cmd+Shift+R popup: recently killed terminals with their last screen; Enter resumes the Claude/Codex session (or reopens the shell) in a new tab
- `mods/my-tabs` - a clone of the shipped tab bar with the Tasks and Jobs buttons (with `props.demo`, Files and Changes only)
- `mods/usage-limits` - from github.com/nozikov/herdr-usage-limits (commit 19fda91)

To link on a new machine:

```sh
H=~/.config/herdr-app; D=~/dotfiles/herdr-app
ln -sf $D/settings.json $H/settings.json
ln -sf $D/keys.json $H/keys.json
ln -sf $D/layouts/Parker.json $H/layouts/Parker.json
ln -sf $D/layouts/Demo.json $H/layouts/Demo.json
for t in $D/themes/*.json; do ln -sf $t $H/themes/; done
for m in my-tabs usage-limits session-launcher run-once revive demo-mode demo-quiet; do ln -sfn $D/mods/$m $H/mods/$m; done
```

Herdr does not hot-reload edits behind a symlinked mod folder. After editing a mod here, run `touch -h ~/.config/herdr-app/mods/<name>` to reload it.
