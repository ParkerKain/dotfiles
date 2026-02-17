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

# New Worktree - creates git worktree + tmux session with Neovim, Admin, Claude windows
nwt() {
  # Check dependencies
  if ! command -v gum &> /dev/null; then
    echo "Error: gum is not installed. Install with: brew install gum"
    return 1
  fi

  if ! command -v tmux &> /dev/null; then
    echo "Error: tmux is not installed."
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
    "Session:   $branch_name (tmux)" \
    "" \
    "Windows:   Neovim | Admin | Claude"

  echo ""
  if ! gum confirm "Create worktree and tmux session?"; then
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

  # Resolve to absolute path for tmux
  dir_location=$(cd "$dir_location" && pwd)

  # Create or attach to tmux session
  local session_name="$branch_name"

  if tmux has-session -t="$session_name" 2>/dev/null; then
    gum style --foreground 214 "Session '$session_name' already exists. Switching..."
  else
    # Create new session with first window (Neovim)
    tmux new-session -d -s "$session_name" -n "Neovim" -c "$dir_location"
    tmux send-keys -t "${session_name}:Neovim" "nvim" Enter

    # Create Admin window
    tmux new-window -t "$session_name" -n "Admin" -c "$dir_location"

    # Create Claude window
    tmux new-window -t "$session_name" -n "Claude" -c "$dir_location"
    tmux send-keys -t "${session_name}:Claude" "claude" Enter

    # Select the first window (Neovim)
    tmux select-window -t "${session_name}:Neovim"

    gum style --foreground 212 "Worktree and session created! Switching..."
    sleep 0.5
  fi

  # Switch if inside tmux, attach if not
  if [[ -n "$TMUX" ]]; then
    tmux switch-client -t "$session_name"
  else
    tmux attach-session -t "$session_name"
  fi
}

# Set up uv
export PATH="$HOME/.local/bin:$PATH"

# Bat theming
export BAT_THEME="Catppuccin Mocha"

# Set up Starship
eval "$(starship init zsh)"

# Set up direnv
# eval "$(direnv hook zsh)"

. "$HOME/.cargo/env"

export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# . "$HOME/.local/bin/env"
export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"

# Added by Antigravity
export PATH="/Users/parker.kain/.antigravity/antigravity/bin:$PATH"
