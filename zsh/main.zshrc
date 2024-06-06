# Aliases - shortcuts
alias dotfiles="cd ~/dotfiles"

# Open the crossword
crossword(){
        day=$(date +%d)
        month=$(date +%m)
        year=$(date +%Y)
        open https://www.nytimes.com/crosswords/game/daily/$year/$month/$day
        open https://www.nytimes.com/puzzles/stats
        open https://www.nytimes.com/games/wordle/index.html
        open https://guessthe.game/
        open https://guesstheaudio.com/
        open https://worldle.teuteuf.fr/
        open https://oec.world/en/tradle/
        open https://maps.google.com
        open https://www.nytimes.com/games/connections 
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
neofetch


