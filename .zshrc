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

. "$HOME/.local/bin/env"
