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
export CONFIG_ROOT=~
export XDG_CONFIG_HOME=$HOME/.config

# This sets neovim to look in your config directory - not ~/.config/nvim
export EDITOR="nvim"

# Load zshrc files from config directories.
for conf in $CONFIG_ROOT/zsh/*; do
	echo "Sourcing ${conf} ..."
	source "${conf}"
done
unset conf

# Eza Configuration
# alias l="eza --long --header --all --icons"

export EXA_COLORS="\
uu=36:\
gu=37:\
sn=32:\
sb=32:\
da=34:\
ur=34:\
uw=35:\
ux=36:\
ue=36:\
gr=34:\
gw=35:\
gx=36:\
tr=34:\
tw=35:\
tx=36:"

# New ls settings
alias l="ls -alhoFr | rg -v '\./$'"

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
