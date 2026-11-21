#!/bin/sh
# Install a shared setting without replacing Omarchy's existing config.
set -eu

usage() {
    printf '%s\n' 'Usage: ./install-omarchy.sh [--check] git|neovim'
}

check_only=false
case "${1:-}" in
    -h|--help) usage; exit 0 ;;
    --check) check_only=true; shift ;;
esac

if [ "$#" -ne 1 ]; then
    usage >&2
    exit 2
fi

dotfiles=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
config_home=${XDG_CONFIG_HOME:-"$HOME/.config"}

check_link() {
    source=$1
    dest=$2
    if [ ! -e "$source" ]; then
        printf 'Missing shared setting at %s\n' "$source" >&2
        return 1
    fi
    if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$source" ]; then
        return 0
    fi
    if [ -e "$dest" ] || [ -L "$dest" ]; then
        printf 'Keeping the existing setting at %s\n' "$dest" >&2
        return 1
    fi
}

install_link() {
    source=$1
    dest=$2
    if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$source" ]; then
        printf 'Already linked %s\n' "$dest"
    elif "$check_only"; then
        printf 'Would link %s to %s\n' "$dest" "$source"
    else
        mkdir -p "$(dirname -- "$dest")"
        ln -s "$source" "$dest"
        printf 'Linked %s to %s\n' "$dest" "$source"
    fi
}

case "$1" in
    git)
        git_ignore="$config_home/git/ignore"
        if excludes=$(git config --global --includes --path --get core.excludesFile); then
            if [ "$excludes" != "$git_ignore" ]; then
                printf 'Keeping your Git excludes file at %s\n' "$excludes" >&2
                exit 1
            fi
        elif [ "$?" -ne 1 ]; then
            exit 1
        fi
        check_link "$dotfiles/.config/git/ignore" "$git_ignore"
        install_link "$dotfiles/.config/git/ignore" "$git_ignore"
        ;;
    neovim)
        profile="$config_home/parker-nvim"
        nvim_source="$dotfiles/.config/nvim"
        check_link "$nvim_source/init.lua" "$profile/init.lua"
        check_link "$nvim_source/lua" "$profile/lua"
        install_link "$nvim_source/init.lua" "$profile/init.lua"
        install_link "$nvim_source/lua" "$profile/lua"
        ;;
    *) usage >&2; exit 2 ;;
esac
