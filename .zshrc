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

# New Worktree - creates a git worktree and opens it as a herdr workspace via hp
nwt() {
  # Check dependencies
  if ! command -v gum &> /dev/null; then
    echo "Error: gum is not installed. Install with: brew install gum"
    return 1
  fi


  # Check if we're in a git repo
  local git_root
  git_root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [[ -z "$git_root" ]]; then
    echo "Error: Not in a git repository."
    return 1
  fi

  # Get branch name (required)
  local branch_name
  branch_name=$(gum input --placeholder "Branch name (required)" --header "Branch Name")
  if [[ -z "$branch_name" ]]; then
    echo "Error: Branch name is required."
    return 1
  fi

  # Get directory name (defaults to branch name)
  local dir_name
  dir_name=$(gum input --placeholder "Directory name" --value "$branch_name" --header "Directory Name")
  if [[ -z "$dir_name" ]]; then
    dir_name="$branch_name"
  fi

  # Get directory location (defaults to ../{dir_name} relative to git root)
  local default_location="${git_root}/../${dir_name}"
  local dir_location
  dir_location=$(gum input --placeholder "Directory location" --value "$default_location" --header "Directory Location")
  if [[ -z "$dir_location" ]]; then
    dir_location="$default_location"
  fi

  # Check if branch exists
  local branch_exists=false
  if git show-ref --verify --quiet "refs/heads/$branch_name" 2>/dev/null; then
    branch_exists=true
  fi

  # Show confirmation
  echo ""
  gum style --border normal --padding "1 2" --border-foreground 212 \
    "$(gum style --foreground 212 'New Worktree Configuration')" \
    "" \
    "Branch:    $branch_name $($branch_exists && echo '(existing)' || echo '(new)')" \
    "Directory: $dir_location" \
    "Workspace: $branch_name (herdr)" \
    "" \
    "Windows:   Workspace (nvim+admin) | Claude"

  echo ""
  if ! gum confirm "Create worktree and herdr workspace?"; then
    echo "Cancelled."
    return 0
  fi

  # Create the worktree
  echo ""
  gum spin --spinner dot --title "Creating worktree..." -- sleep 0.5

  if $branch_exists; then
    if ! git worktree add "$dir_location" "$branch_name" 2>&1; then
      echo "Error: Failed to create worktree."
      return 1
    fi
  else
    if ! git worktree add -b "$branch_name" "$dir_location" 2>&1; then
      echo "Error: Failed to create worktree."
      return 1
    fi
  fi

  # Lay out the worktree like a project (Workspace + Claude tabs); hp focuses
  # an existing workspace with the same name and attaches when outside herdr.
  hp -d "$dir_location" "$branch_name"
}

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
