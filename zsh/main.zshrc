# Aliases - shortcuts
alias dotfiles="cd ~/dotfiles"

# Open the crossword
crossword() {
  urls=(
    "https://www.nytimes.com/crosswords/game/daily/$(date +%Y)/$(date +%m)/$(date +%d)"
    "https://www.nytimes.com/puzzles/stats"
    "https://www.nytimes.com/games/wordle/index.html"
    "https://guessthe.game/"
    "https://worldle.teuteuf.fr/"
    "https://oec.world/en/tradle/"
    "https://guesstheaudio.com/"
    "https://www.nytimes.com/games/connections"
    "https://bandle.app/"
    "https://maps.google.com"
  )

  for url in "${urls[@]}"; do
    open -a "Google Chrome" "$url"
  done
}

# Alias lazygit
alias lg='lazygit'

# Alias lazydocker
alias ld='lazydocker'

# ripgrep overriding standard grep
if type rg &> /dev/null; then
  export FZF_DEFAULT_COMMAND='rg --files'
  export FZF_DEFAULT_OPTS='-m --border --height 40%' 
fi

# Alias for taskwarrior tui
alias tt="taskwarrior-tui"

# Alias for tasks done in that last week
alias task-done="task end.after:today-1wk completed"

# Set up note taking stuff
export nt=~/.parknotes
alias nt='cd ~/.parknotes;nvim -o "$(rg --files -g '!archive/' $nt | fzf)"'
alias pks="parknotes"

# Print the cool neofetch thing
# neofetch

alias mux="tmuxinator"
