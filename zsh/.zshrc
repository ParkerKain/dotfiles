# Lines configured by zsh-newuser-install
# HISTFILE=~/.histfile
# HISTSIZE=1000
# SAVEHIST=1000
# bindkey -v
# # End of lines configured by zsh-newuser-install
# # The following lines were added by compinstall
# zstyle :compinstall filename '/home/parker/.zshrc'

autoload -Uz compinit
compinit

# End of lines added by compinstall
# Set the below environment variable to direct to your dotfiles directory
export CONFIG_ROOT=~/dotfiles

# This sets neovim to look in your config directory - not ~/.config/nvim
export XDG_CONFIG_HOME=$CONFIG_ROOT
export EDITOR="nvim"

# Load zshrc files from config directories.
for conf in $CONFIG_ROOT/zsh/devices/*; do
	echo "Sourcing ${conf} ..."
	source "${conf}"
done
unset conf

# Eza Configuration
alias l="eza --long --header --all --icons"

# Bat theming
export BAT_THEME="gruvbox-dark"

# Set up Starship
export STARSHIP_CONFIG="$CONFIG_ROOT/starship/starship.toml"
eval "$(starship init zsh)"

# Set up NVM
# export NVM_DIR="$HOME/dotfiles/nvm"
# [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
# [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

