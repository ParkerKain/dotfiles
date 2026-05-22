# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Personal dotfiles for macOS. Configs are symlinked (or copied) from here into their expected locations. There is no build system or install script — changes take effect by editing files directly (since they're already symlinked) or by re-sourcing the relevant shell file.

## Structure

| Path | Purpose |
|------|---------|
| `.zshrc` | Main zsh entry point — sources all files in `zsh/` and sets core env vars |
| `zsh/main.zshrc` | Aliases and shell functions loaded by `.zshrc` |
| `.tmux.conf` | tmux config — uses TPM, rose-pine/tmux theme |
| `.config/nvim/` | Neovim config — lazy.nvim plugin manager, LSPs via native `vim.lsp` |
| `.config/starship.toml` | Starship prompt (Nerd Font icons) |
| `.config/ghostty/config` | Ghostty terminal config |
| `.config/alacritty/` | Alacritty terminal — theme variants in separate files, imported via `alacritty.toml` |
| `.config/aerospace/` | AeroSpace tiling WM config |
| `.config/helix/` | Helix editor config |
| `.config/zellij/` | Zellij multiplexer — named layout files in `layouts/` |
| `.config/k9s/` | k9s Kubernetes TUI — Catppuccin skins |

## Key shell details

`CONFIG_ROOT` defaults to `~` in `.zshrc`. All files under `$CONFIG_ROOT/zsh/` are auto-sourced at login, so adding a new `.zshrc` file to `zsh/` is enough to activate it.

`nwt` (New Worktree) — defined in `.zshrc`. Creates a git worktree + tmux session with three windows: Neovim, Admin, Claude. Requires `gum` and `tmux`.

## Neovim plugin architecture

Plugins live in `.config/nvim/lua/plugins/` as individual files, loaded via `{ import = "plugins" }` in `lazy.lua`. LSPs are configured with native `vim.lsp.config` / `vim.lsp.enable` (Neovim 0.10+), not nvim-lspconfig. Leader key is `<Space>`, local leader is `\`.

Key plugins: blink.nvim (completion), telescope, oil.nvim (file explorer), codecompanion, conform (formatting), snacks.nvim, noice.nvim, gitsigns, trouble.nvim, whichkey, render-markdown.

## Applying changes

- **Shell**: `source ~/.zshrc` or open a new terminal.
- **tmux**: `tmux source-file ~/.tmux.conf` or prefix + `I` to install new TPM plugins.
- **Neovim**: Changes take effect on next launch; run `:Lazy sync` for plugin changes.
- **Starship / Ghostty / Alacritty**: Changes take effect immediately on next shell/terminal start.

## Ignored from git

Machine-specific files excluded via `.gitignore`: `work_mac.zshrc`, `arch.zshrc`, `lazygit/`, `lazydocker/`, `nvm/`, `.tmux/plugins/`, `claude/`, and others. Add machine-specific config to a gitignored file rather than committing it here.
