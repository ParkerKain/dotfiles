# Shared dotfiles on Omarchy

Keep this checkout at a stable path on Omarchy. From the checkout, preview and apply each setup independently.

## Git ignore rules

```sh
./install-omarchy.sh --check git
./install-omarchy.sh git
```

Git reads the linked ignore file from `$XDG_CONFIG_HOME/git/ignore` or `~/.config/git/ignore`. If you already have an ignore file, add the rules from [the shared ignore file](../.config/git/ignore) to yours. Git identity and credentials stay in your machine's Git config.

## Neovim

```sh
./install-omarchy.sh --check neovim
./install-omarchy.sh neovim
NVIM_APPNAME=parker-nvim nvim
```

The `parker-nvim` profile uses the shared Lua settings with its own plugin data and cache. Run plain `nvim` for Omarchy's default profile. On first launch, the shared profile uses Git to download its plugins.
