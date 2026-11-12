# herdr-app

Config for the Herdr desktop app. Each item is symlinked into `~/.config/herdr-app/`:

- `settings.json` - zoom, sounds, fonts, theme
- `layouts/Parker.json` - my layout (a clone of Herdr's `main`, with the usage limits status bar and the Tasks and Jobs panels)
- `mods/ops-tasks` - Tasks panel over the `ops-tasks` CLI
- `mods/jobs` - Jobs panel
- `mods/my-tabs` - a clone of the shipped tab bar with the Tasks and Jobs buttons
- `mods/usage-limits` - from github.com/nozikov/herdr-usage-limits (commit 19fda91)

To link on a new machine:

```sh
H=~/.config/herdr-app; D=~/dotfiles/herdr-app
ln -sf $D/settings.json $H/settings.json
ln -sf $D/layouts/Parker.json $H/layouts/Parker.json
for m in ops-tasks jobs my-tabs usage-limits; do ln -sfn $D/mods/$m $H/mods/$m; done
```
