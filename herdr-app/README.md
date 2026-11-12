# herdr-app

Config for the Herdr desktop app. Each item is symlinked into `~/.config/herdr-app/`:

- `settings.json` - zoom, sounds, fonts, theme
- `layouts/Parker.json` - my layout (a clone of Herdr's `main`, with the usage limits status bar and the Tasks and Jobs panels)
- `mods/ops-tasks` - Tasks panel over the `ops-tasks` CLI
- `mods/session-launcher` - prompt-driven session launcher shared with Tasks Play
- `keys.json` - binds Cmd+Shift+N to the session launcher and Cmd+Shift+E to run-once
- `mods/run-once` - Cmd+Shift+E popup: type one command (demo-on, demo-off), it runs in zsh and closes
- `mods/jobs` - Jobs panel
- `mods/revive` - Cmd+Shift+R popup: recently killed terminals with their last screen; Enter resumes the Claude/Codex session (or reopens the shell) in a new tab
- `mods/my-tabs` - a clone of the shipped tab bar with the Tasks and Jobs buttons
- `mods/usage-limits` - from github.com/nozikov/herdr-usage-limits (commit 19fda91)

To link on a new machine:

```sh
H=~/.config/herdr-app; D=~/dotfiles/herdr-app
ln -sf $D/settings.json $H/settings.json
ln -sf $D/keys.json $H/keys.json
ln -sf $D/layouts/Parker.json $H/layouts/Parker.json
for m in ops-tasks jobs my-tabs usage-limits session-launcher run-once revive; do ln -sfn $D/mods/$m $H/mods/$m; done
```
