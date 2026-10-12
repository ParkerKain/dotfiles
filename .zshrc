# Lines configured by zsh-newuser-install
HISTFILE=~/.histfile
HISTSIZE=1000
SAVEHIST=1000
# bindkey -v
# # End of lines configured by zsh-newuser-install
# # The following lines were added by compinstall
# zstyle :compinstall filename '/home/parker/.zshrc'

autoload -Uz compinit
compinit

# End of lines added by compinstall
# Set the below environment variable to direct to your dotfiles directory
export CONFIG_ROOT=~
export XDG_CONFIG_HOME=$HOME/.config

export EDITOR="nvim"
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

# Load zshrc files from config directories.
for conf in $CONFIG_ROOT/zsh/*; do
	echo "Sourcing ${conf} ..."
	source "${conf}"
done
unset conf

# Eza Configuration
alias l="eza --long --header --all --icons"
# alias l="ls -alhoFr | rg -v '\./$'"

# Set up uv
export PATH="$HOME/.local/bin:$PATH"

# Bat theming
export BAT_THEME="Catppuccin Mocha"

# Set up Starship
eval "$(starship init zsh)"

# Set up direnv
eval "$(direnv hook zsh)"

. "$HOME/.cargo/env"

export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# . "$HOME/.local/bin/env"
export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"

# Added by Antigravity
export PATH="/Users/parker.kain/.antigravity/antigravity/bin:$PATH"
eval "$(rbenv init - zsh)"
unset GEM_HOME
export PATH=$PATH:$HOME/.maestro/bin

# Pi-only local Alloy routing; leaves Claude Code routing unchanged.
if [[ -r "$HOME/.config/devclarity/pi-alloy/pi-shell.zsh" ]]; then
  source "$HOME/.config/devclarity/pi-alloy/pi-shell.zsh"
fi

# herdr resumes Pi by typing `pi --session <path>` into a fresh shell, which
# loses the pi-work/pi-personal profile env. Route a resume back to the profile
# that owns the session file.
(( $+functions[pi] )) && functions -c pi _pi_base
pi() {
  if [[ "$1" == --session ]]; then
    case "$2" in
      "$HOME"/.pi/agent-work/*) pi-work "$@"; return ;;
      "$HOME"/.pi/agent-personal/*) pi-personal "$@"; return ;;
    esac
  fi
  if (( $+functions[_pi_base] )); then _pi_base "$@"; else command pi "$@"; fi
}

# Use Vim-style command-line editing (Esc for command mode).
bindkey -v
