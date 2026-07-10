# fzf shell integration — fuzzy Ctrl-R history search, Ctrl-T file picker, Alt-C cd.
# Guarded so machines without fzf installed don't error on login.
command -v fzf >/dev/null && source <(fzf --zsh)

# Tune the Ctrl-R history picker.
export FZF_CTRL_R_OPTS="--height=40% --reverse --preview 'echo {}' --preview-window=down:3:wrap"
