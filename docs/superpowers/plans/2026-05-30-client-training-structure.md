# Client Training Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a per-client isolated training environment system with a `training-ops` config repo, ERB tmuxinator session templates, and two interactive gum-powered shell functions (`new-training`, `train`).

**Architecture:** A new `training-ops` git repo holds training type definitions (`training-types/*.yml` — which repos to clone) and tmuxinator session templates (`sessions/*.yml` — ERB configs with `ENV['CLIENT']` placeholders). Two zsh functions use gum for interactive prompts: `new-training` clones repos into `~/Documents/clients/<client>/trainings/<training>/repos/` and `train` launches the client-scoped tmux session.

**Tech Stack:** zsh, gum 0.17 (`gum choose`, `gum filter`, `gum input`, `gum spin`, `gum confirm`), tmuxinator (ERB templates with `ENV['CLIENT']`), git

---

## File Map

**New repo: `~/Documents/internal/repos/training-ops/`**
- Create: `CLAUDE.md` — repo overview, conventions, how to add a new training type
- Create: `training-types/environment-setup.yml` — repos to clone for env setup training
- Create: `training-types/foundation-day-one.yml` — repos to clone for foundation day 1
- Create: `training-types/foundation-day-two.yml` — repos to clone for foundation day 2
- Create: `sessions/environment-setup.yml` — ERB tmuxinator template
- Create: `sessions/foundation-day-one.yml` — ERB tmuxinator template
- Create: `sessions/foundation-day-two.yml` — ERB tmuxinator template

**Dotfiles: `~/dotfiles/`**
- Create: `zsh/training.zshrc` — `new-training` and `train` shell functions (auto-sourced)
- Delete: `.config/tmuxinator/environment-setup.yml`
- Delete: `.config/tmuxinator/foundation-day-one.yml`
- Delete: `.config/tmuxinator/foundation-day-two.yml`

---

### Task 1: Initialize training-ops repo and write training type definitions

**Files:**
- Create: `~/Documents/internal/repos/training-ops/training-types/environment-setup.yml`
- Create: `~/Documents/internal/repos/training-ops/training-types/foundation-day-one.yml`
- Create: `~/Documents/internal/repos/training-ops/training-types/foundation-day-two.yml`

- [ ] **Step 1: Initialize the repo**

```bash
mkdir -p ~/Documents/internal/repos/training-ops/training-types
mkdir -p ~/Documents/internal/repos/training-ops/sessions
cd ~/Documents/internal/repos/training-ops
git init
```

Expected: `Initialized empty Git repository in .../training-ops/.git/`

- [ ] **Step 2: Write environment-setup training type**

Create `~/Documents/internal/repos/training-ops/training-types/environment-setup.yml`:

```yaml
name: environment-setup
repos:
  - name: environment-setup
    remote: https://github.com/devclarityai/environment-setup.git
  - name: demo-devclarity
    remote: https://github.com/devclarityai/demo-devclarity.git
```

- [ ] **Step 3: Write foundation-day-one training type**

Create `~/Documents/internal/repos/training-ops/training-types/foundation-day-one.yml`:

```yaml
name: foundation-day-one
repos:
  - name: devclarity-coding-tutorial
    remote: https://github.com/devclarityai/devclarity-coding-tutorial.git
  - name: demo-devclarity
    remote: https://github.com/devclarityai/demo-devclarity.git
```

- [ ] **Step 4: Write foundation-day-two training type**

Create `~/Documents/internal/repos/training-ops/training-types/foundation-day-two.yml`:

```yaml
name: foundation-day-two
repos:
  - name: demo-devclarity
    remote: https://github.com/devclarityai/demo-devclarity.git
```

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/internal/repos/training-ops
git add training-types/
git commit -m "Add training type definitions"
```

Expected: `3 files changed, 15 insertions(+)`

---

### Task 2: Write environment-setup session template

**Files:**
- Create: `~/Documents/internal/repos/training-ops/sessions/environment-setup.yml`

- [ ] **Step 1: Write the session template**

Create `~/Documents/internal/repos/training-ops/sessions/environment-setup.yml`:

```yaml
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

- [ ] **Step 2: Commit**

```bash
cd ~/Documents/internal/repos/training-ops
git add sessions/environment-setup.yml
git commit -m "Add environment-setup session template"
```

---

### Task 3: Write foundation-day-one session template

**Files:**
- Create: `~/Documents/internal/repos/training-ops/sessions/foundation-day-one.yml`

- [ ] **Step 1: Write the session template**

Create `~/Documents/internal/repos/training-ops/sessions/foundation-day-one.yml`:

```yaml
name: foundation-day-one-<%= ENV['CLIENT'] %>
root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/foundation-day-one/repos/devclarity-coding-tutorial

on_project_start: code ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/foundation-day-one/repos/devclarity-coding-tutorial

windows:
  - Neovim:
      root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/foundation-day-one/repos/devclarity-coding-tutorial
      layout: main-vertical
      panes:
        - nvim
  - Basics:
      root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/foundation-day-one/repos/devclarity-coding-tutorial
      panes:
        - |
          git fetch origin
          if [[ -n "$(git status --porcelain)" ]]; then
            echo "⚠️  WARNING: local changes in devclarity-coding-tutorial from last demo:"; git status --short
            read "confirm?Delete all local changes? [Y/n]: "
            [[ ! "$confirm" =~ ^[Nn]$ ]] && git checkout -f main && git reset --hard origin/main && git clean -fd || echo "Skipping cleanup — continuing with current state."
          else
            git checkout main && git pull
          fi
          git checkout -B devclarity
  - Advanced:
      root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/foundation-day-one/repos/demo-devclarity
      panes:
        - |
          git fetch origin
          if [[ -n "$(git status --porcelain)" ]]; then
            echo "⚠️  WARNING: local changes in demo-devclarity from last demo:"; git status --short
            read "confirm?Delete all local changes? [Y/n]: "
            [[ ! "$confirm" =~ ^[Nn]$ ]] && git checkout -f main && git reset --hard origin/main && git clean -fd || echo "Skipping cleanup — continuing with current state."
          else
            git checkout main && git pull
          fi
          git checkout -B devclarity
  - Claude:
      root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/foundation-day-one/repos/devclarity-coding-tutorial
      panes:
        - |
          claude plugins marketplace remove devclarity-plugins-private
          claude
```

- [ ] **Step 2: Commit**

```bash
cd ~/Documents/internal/repos/training-ops
git add sessions/foundation-day-one.yml
git commit -m "Add foundation-day-one session template"
```

---

### Task 4: Write foundation-day-two session template

**Files:**
- Create: `~/Documents/internal/repos/training-ops/sessions/foundation-day-two.yml`

- [ ] **Step 1: Write the session template**

Create `~/Documents/internal/repos/training-ops/sessions/foundation-day-two.yml`:

```yaml
name: foundation-day-two-<%= ENV['CLIENT'] %>
root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/foundation-day-two/repos/demo-devclarity

on_project_start: code ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/foundation-day-two/repos/demo-devclarity

windows:
  - Neovim:
      root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/foundation-day-two/repos/demo-devclarity
      layout: main-vertical
      panes:
        - nvim
  - Demo:
      root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/foundation-day-two/repos/demo-devclarity
      panes:
        - |
          git fetch origin
          if [[ -n "$(git status --porcelain)" ]]; then
            echo "⚠️  WARNING: local changes in demo-devclarity from last demo:"; git status --short
            read "confirm?Delete all local changes? [Y/n]: "
            [[ ! "$confirm" =~ ^[Nn]$ ]] && git checkout -f day-2-creation && git reset --hard origin/day-2-creation && git clean -fd || echo "Skipping cleanup — continuing with current state."
          else
            git checkout day-2-creation && git pull
          fi
          git checkout -B devclarity day-2-creation
  - Claude:
      root: ~/Documents/clients/<%= ENV['CLIENT'] %>/trainings/foundation-day-two/repos/demo-devclarity
      panes:
        - |
          claude plugins marketplace remove devclarity-plugins-private
          claude
```

- [ ] **Step 2: Commit**

```bash
cd ~/Documents/internal/repos/training-ops
git add sessions/foundation-day-two.yml
git commit -m "Add foundation-day-two session template"
```

---

### Task 5: Write CLAUDE.md and push training-ops to GitHub

**Files:**
- Create: `~/Documents/internal/repos/training-ops/CLAUDE.md`

- [ ] **Step 1: Write CLAUDE.md**

Create `~/Documents/internal/repos/training-ops/CLAUDE.md`:

```markdown
# training-ops

Configuration repo for DevClarity client training environments.

## What this repo is

Two things:
1. **Training type definitions** (`training-types/*.yml`) — what repos to clone for each training type
2. **Session templates** (`sessions/*.yml`) — tmuxinator ERB configs that set up the tmux environment before a training

The shell functions `new-training` and `train` (in `~/dotfiles/zsh/training.zshrc`) read from this repo.

## How it works

Client training data lives at:
```
~/Documents/clients/<client>/trainings/<training-type>/
├── presentations/    ← slides (manual copy)
└── repos/            ← git clones (created by new-training)
    ├── <repo-a>/
    └── <repo-b>/
```

### `new-training`

Interactive setup for a new client/training combination. Prompts for client (existing or new) and training type, then clones the repos defined in `training-types/<training>.yml` into the client's folder.

### `train`

Interactive session launcher. Prompts for client and training type (only shows training types that have been set up for that client), then runs:
`CLIENT=<client> tmuxinator start -p ~/Documents/internal/repos/training-ops/sessions/<training>.yml`

The ERB `<%= ENV['CLIENT'] %>` in session templates is resolved to the selected client name, so every path and session name is client-scoped. Two clients can run simultaneously without conflict.

## Adding a new training type

1. Add `training-types/<name>.yml` with the repos to clone
2. Add `sessions/<name>.yml` with the tmuxinator ERB template
3. Commit and push

## Training type YAML format

```yaml
name: <training-type>
repos:
  - name: <repo-directory-name>
    remote: https://github.com/devclarityai/<repo>.git
```

The `new-training` function parses this with grep/awk (no yq dependency required).
```

- [ ] **Step 2: Commit CLAUDE.md**

```bash
cd ~/Documents/internal/repos/training-ops
git add CLAUDE.md
git commit -m "Add CLAUDE.md"
```

- [ ] **Step 3: Create GitHub repo and push**

```bash
cd ~/Documents/internal/repos/training-ops
gh repo create devclarity-training-ops --private --source=. --remote=origin --push
```

Expected: GitHub URL printed, all commits pushed.

> Note: If you want this under the `devclarityai` org instead of your personal account, use `devclarityai/devclarity-training-ops` as the name.

---

### Task 6: Write the `new-training` shell function

**Files:**
- Create: `~/dotfiles/zsh/training.zshrc`

- [ ] **Step 1: Create `zsh/training.zshrc` with the `new-training` function**

Create `~/dotfiles/zsh/training.zshrc`:

```zsh
new-training() {
  local ops=~/Documents/internal/repos/training-ops
  local clients_dir=~/Documents/clients

  # Client selection: existing clients + "New client" option
  local items=()
  for d in "$clients_dir"/*/; do
    [[ -d $d ]] && items+=("$(basename "$d")")
  done
  items+=("+ New client")

  local client
  client=$(printf "%s\n" "${items[@]}" | gum choose --header "Select client:") || return 0

  if [[ $client == "+ New client" ]]; then
    client=$(gum input --placeholder "Client name (e.g. acmecorp)") || return 0
    [[ -z $client ]] && { echo "No client name entered."; return 1; }
  fi

  # Training type selection: from training-ops/training-types/
  local training
  training=$(ls "$ops/training-types/"*.yml 2>/dev/null \
    | xargs -I{} basename {} .yml \
    | gum choose --header "Select training type:") || return 0
  [[ -z $training ]] && { echo "No training type selected."; return 1; }

  local base=$clients_dir/$client/trainings/$training

  # Confirm (warn if already exists)
  if [[ -d $base ]]; then
    gum confirm "⚠️  $base already exists. Continue anyway?" || return 0
  else
    gum confirm "Set up $training for $client?" || return 0
  fi

  mkdir -p "$base/presentations" "$base/repos"

  # Parse repos from training type YAML and clone each
  local names=("${(@f)$(grep '  - name:' "$ops/training-types/$training.yml" | awk '{print $3}')}")
  local remotes=("${(@f)$(grep '    remote:' "$ops/training-types/$training.yml" | awk '{print $2}')}")

  for i in {1..${#names[@]}}; do
    gum spin --spinner dot --title "Cloning ${names[$i]}..." -- \
      git clone "${remotes[$i]}" "$base/repos/${names[$i]}" \
      || { echo "Failed to clone ${names[$i]} from ${remotes[$i]}"; return 1; }
  done

  echo ""
  gum style --foreground 212 "✓ $training set up for $client"
  echo "  Repos:         $base/repos/"
  echo "  Presentations: $base/presentations/"
}
```

- [ ] **Step 2: Source check — verify the file is auto-sourced**

`.zshrc` auto-sources all files in `~/dotfiles/zsh/`. Confirm `training.zshrc` will be picked up:

```bash
grep -n 'zsh/' ~/dotfiles/.zshrc | head -5
```

Expected: a line like `for f in $CONFIG_ROOT/zsh/*.zshrc` or similar glob. If it sources `zsh/main.zshrc` explicitly rather than globbing, add a source line for `training.zshrc` there instead.

- [ ] **Step 3: Reload shell and verify function is available**

```bash
source ~/dotfiles/.zshrc
type new-training
```

Expected: `new-training is a shell function`

- [ ] **Step 4: Commit**

```bash
cd ~/dotfiles
git add zsh/training.zshrc
git commit -m "Add new-training shell function"
```

---

### Task 7: Write the `train` shell function

**Files:**
- Modify: `~/dotfiles/zsh/training.zshrc`

- [ ] **Step 1: Append `train` function to `zsh/training.zshrc`**

Add to the bottom of `~/dotfiles/zsh/training.zshrc`:

```zsh
train() {
  local ops=~/Documents/internal/repos/training-ops
  local clients_dir=~/Documents/clients

  # Client selection: fuzzy filter over existing clients
  local client_items=()
  for d in "$clients_dir"/*/; do
    [[ -d $d ]] && client_items+=("$(basename "$d")")
  done

  if [[ ${#client_items[@]} -eq 0 ]]; then
    echo "No clients found in $clients_dir. Run new-training first."
    return 1
  fi

  local client
  client=$(printf "%s\n" "${client_items[@]}" | gum filter --header "Select client:") || return 0
  [[ -z $client ]] && return 0

  # Training selection: only show trainings set up for this client
  local trainings_dir=$clients_dir/$client/trainings
  if [[ ! -d $trainings_dir ]]; then
    echo "No trainings set up for $client. Run new-training first."
    return 1
  fi

  local training_items=()
  for d in "$trainings_dir"/*/; do
    [[ -d $d ]] && training_items+=("$(basename "$d")")
  done

  if [[ ${#training_items[@]} -eq 0 ]]; then
    echo "No trainings set up for $client. Run new-training first."
    return 1
  fi

  local training
  training=$(printf "%s\n" "${training_items[@]}" | gum choose --header "Select training:") || return 0
  [[ -z $training ]] && return 0

  local session=$ops/sessions/$training.yml
  if [[ ! -f $session ]]; then
    echo "No session template found: $session"
    return 1
  fi

  CLIENT=$client tmuxinator start -p "$session"
}
```

- [ ] **Step 2: Reload and verify both functions available**

```bash
source ~/dotfiles/.zshrc
type new-training && type train
```

Expected: both reported as shell functions.

- [ ] **Step 3: Commit**

```bash
cd ~/dotfiles
git add zsh/training.zshrc
git commit -m "Add train shell function"
```

---

### Task 8: Remove old tmuxinator configs from dotfiles

**Files:**
- Delete: `~/dotfiles/.config/tmuxinator/environment-setup.yml`
- Delete: `~/dotfiles/.config/tmuxinator/foundation-day-one.yml`
- Delete: `~/dotfiles/.config/tmuxinator/foundation-day-two.yml`

- [ ] **Step 1: Confirm non-training configs are present before deleting**

```bash
ls ~/dotfiles/.config/tmuxinator/
```

Expected: `automation.yml  demo-devclarity.yml  environment-setup.yml  foundation_day_one.yml  foundation_day_two.yml  survey-benchmarking.yml`

Files to keep (non-training sessions): `automation.yml`, `demo-devclarity.yml`, `survey-benchmarking.yml`. Delete the three training configs.

- [ ] **Step 2: Delete the training configs**

```bash
cd ~/dotfiles
git rm .config/tmuxinator/environment-setup.yml \
        .config/tmuxinator/foundation_day_one.yml \
        .config/tmuxinator/foundation_day_two.yml
```

> Note: filenames use underscores on disk (`foundation_day_one.yml`) but hyphens in the training-ops sessions (`foundation-day-one.yml`). The session templates in training-ops use hyphens — this is intentional and consistent with the `trainings/` directory naming.

- [ ] **Step 3: Commit**

```bash
cd ~/dotfiles
git commit -m "Remove training tmuxinator configs (moved to training-ops)"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Run `new-training` for a test client**

```bash
new-training
```

Walk through the prompts:
- Select `+ New client`, type `test-client`
- Select `environment-setup`
- Confirm

Expected: two repos cloned under `~/Documents/clients/test-client/trainings/environment-setup/repos/`, spinner shown per clone, done message printed.

Verify:

```bash
ls ~/Documents/clients/test-client/trainings/environment-setup/repos/
```

Expected: `demo-devclarity  environment-setup`

- [ ] **Step 2: Run `train` and verify it finds the session**

```bash
train
```

Walk through the prompts:
- `test-client` appears in the fuzzy filter — select it
- `environment-setup` appears in the training list — select it

Expected: tmuxinator starts a session named `environment-setup-test-client` with four windows (Neovim, environment-setup, demo-devclarity, Claude), each rooted at the client-specific repo paths.

- [ ] **Step 3: Verify session name is client-scoped**

```bash
tmux list-sessions
```

Expected: session named `environment-setup-test-client` (not just `environment-setup`), confirming ERB substitution worked.

- [ ] **Step 4: Clean up test client**

```bash
rm -rf ~/Documents/clients/test-client
tmux kill-session -t environment-setup-test-client 2>/dev/null
```
