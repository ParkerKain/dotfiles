# Client Training Structure Design

**Date:** 2026-05-30
**Status:** Approved

## Problem

All demo repos live in `~/Documents/internal/repos/` and are shared across all clients and training sessions. tmuxinator configs in dotfiles point to these shared paths. Running the same training type for two clients in one day (or across days without careful cleanup) risks one session clobbering another's state. Presentations are disconnected from their training repos.

## Goals

- Each client/training combination has fully isolated repos
- Presentations live alongside (but separated from) their training repos
- tmuxinator session setup is automated and client-scoped
- All training configuration lives in one version-controlled repo with CLAUDE.md context

---

## Folder Structure (per client, per training)

```
~/Documents/clients/<client>/
├── <client-briefing>.md
├── assessment/
├── opening-report/
├── survey-results/
└── trainings/
    └── <training-type>/
        ├── presentations/          ← slides go here
        └── repos/
            ├── <repo-a>/           ← full git clone
            └── <repo-b>/           ← full git clone
```

### Example: LivTech environment-setup

```
~/Documents/clients/livtech/trainings/environment-setup/
├── presentations/
│   └── livtech_env_setup.pptx
└── repos/
    ├── environment-setup/
    └── demo-devclarity/
```

The existing `livtech/presentations/environment_setup/livtech_env_setup.pptx` moves to the new location above. The top-level `presentations/` folder in the client directory is no longer needed for training slides.

---

## The `training-ops` Repo

A new private git repo (`devclarity-training-ops`) cloned to `~/Documents/internal/repos/training-ops/`.

```
training-ops/
├── CLAUDE.md                        ← explains full setup: conventions, shell functions, how templates work
├── training-types/
│   ├── environment-setup.yml        ← defines which repos to clone + their remotes
│   ├── foundation-day-one.yml
│   └── foundation-day-two.yml
└── sessions/
    ├── environment-setup.yml        ← tmuxinator ERB template
    ├── foundation-day-one.yml
    └── foundation-day-two.yml
```

### Training type definition format

```yaml
# training-types/environment-setup.yml
name: environment-setup
repos:
  - name: environment-setup
    remote: git@github.com:devclarity/environment-setup.git
  - name: demo-devclarity
    remote: git@github.com:devclarity/demo-devclarity.git
```

Adding a new training type = adding one file in `training-types/` and one in `sessions/`.

### Session template format

tmuxinator ERB templates using `<%= ENV['CLIENT'] %>` for all client-specific paths. Session names are client-scoped so two sessions can run simultaneously.

```yaml
# sessions/environment-setup.yml
name: environment-setup-<%= ENV['CLIENT'] %>
root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/environment-setup/repos/demo-devclarity

on_project_start: code ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/environment-setup/repos/demo-devclarity

windows:
  - Neovim:
      root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/environment-setup/repos/demo-devclarity
      layout: main-vertical
      panes:
        - nvim
  - environment-setup:
      root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/environment-setup/repos/environment-setup
      panes:
        - |
          git checkout main && git fetch origin
          [[ -n "$(git status --porcelain)" ]] && { echo "⚠️  WARNING: local changes in environment-setup:"; git status --short; }; git pull
  - demo-devclarity:
      root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/environment-setup/repos/demo-devclarity
      panes:
        - |
          git fetch origin
          if [[ -n "$(git status --porcelain)" ]]; then
            echo "⚠️  WARNING: local changes from last demo:"; git status --short
            read "confirm?Delete all local changes? [Y/n]: "
            [[ ! "$confirm" =~ ^[Nn]$ ]] && git checkout -f main && git reset --hard origin/main && git clean -fd || echo "Skipping cleanup."
          else
            git checkout main && git pull
          fi
          git checkout -B devclarity
          find .claude/skills -mindepth 1 -delete 2>/dev/null; rm -f CLAUDE.md
          git add -A && git commit -m "setting up for demo" || echo "Nothing to commit"
  - Claude:
      root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/environment-setup/repos/demo-devclarity
      panes:
        - |
          claude plugins marketplace remove devclarity-plugins-private
          claude
```

---

## Shell Functions

Two new functions added to `zsh/training.zshrc` (auto-sourced by `.zshrc` from `zsh/`).

Both functions are fully interactive — no arguments required. `gum` is used for all prompts.

### `new-training`

One-time setup per client per training type. Creates folder structure and clones repos.

**Interaction flow:**
1. **Client selection** — `gum choose` over existing directories in `~/Documents/clients/` plus a `+ New client` option. If `+ New client` is chosen, fall through to `gum input` for a free-text name.
2. **Training type selection** — `gum choose` over YAML filenames in `training-ops/training-types/` (strips `.yml` extension for display).
3. **Confirmation** — `gum confirm` showing the full path that will be created before doing anything.
4. **Repo cloning** — clones each repo defined in the training type YAML into `repos/`, with a `gum spin` spinner per clone.
5. **Done message** — prints the path and reminds user to add presentation files.

If the target directory already exists, warn and ask to confirm before proceeding.

### `train`

Run immediately before a training. Starts the tmuxinator session for that client.

**Interaction flow:**
1. **Client selection** — `gum filter` over existing directories in `~/Documents/clients/` (fuzzy search, keyboard-navigable).
2. **Training type selection** — `gum choose` over subdirectories of `~/Documents/clients/<client>/trainings/` (only shows training types actually set up for that client, preventing sessions for uncloned repos).
3. **Launch** — calls `CLIENT=<client> tmuxinator start -p training-ops/sessions/<training>.yml`.

---

## dotfiles Changes

- Remove from `.config/tmuxinator/`: `environment-setup.yml`, `foundation-day-one.yml`, `foundation-day-two.yml`
- Keep in `.config/tmuxinator/`: `automation.yml`, `survey-benchmarking.yml` (non-training sessions)
- Add `new-training` and `train` functions to zsh config

---

## Out of Scope

- Migrating existing LiveTech repos from `~/Documents/internal/repos/` (can be done manually or left as-is; old configs still work for internal use)
- Automating presentation file placement (manual copy after `new-training`)
- YAML parsing library choice for `new-training` (yq is preferred if available; fallback to grep)
