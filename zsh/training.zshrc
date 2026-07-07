new-training() {
  local ops=~/Documents/internal/repos/training-ops
  local vault_dir=~/Documents/internal/repos/devclarity-vault/personal/40-customers

  [[ -d $ops ]] || { echo "training-ops not found at $ops"; return 1; }

  # Client selection: existing clients (excluding _* dirs) + "New client" option
  local items=()
  for d in "$vault_dir"/*(N/); do
    local name="$(basename "$d")"
    [[ $name == _* ]] && continue
    items+=("$name")
  done
  items+=("+ New client")

  local client
  client=$(printf "%s\n" "${items[@]}" | gum choose --header "Select client:") || return 0

  if [[ $client == "+ New client" ]]; then
    client=$(gum input --placeholder "Client name (e.g. acmecorp)") || return 0
    [[ -z $client ]] && { echo "No client name entered."; return 1; }
    [[ $client =~ ^[a-zA-Z0-9._-]+$ ]] || { echo "Client name must use only letters, numbers, dots, hyphens, or underscores."; return 1; }
    mkdir -p "$vault_dir/$client"
    cp "$vault_dir/_template/overview.md" "$vault_dir/$client/overview.md"
  fi

  # Tool selection: stored preference shown first
  local all_tools=("claude-code" "cursor" "github-copilot")
  local stored_tool
  stored_tool=$(cat "$vault_dir/$client/.tool" 2>/dev/null)

  local tool_items=()
  if [[ -n $stored_tool && -f "$ops/tools/$stored_tool.yml" ]]; then
    tool_items=("$stored_tool")
    for t in "${all_tools[@]}"; do
      [[ $t != $stored_tool ]] && tool_items+=("$t")
    done
  else
    tool_items=("${all_tools[@]}")
  fi

  local tool
  tool=$(printf "%s\n" "${tool_items[@]}" | gum choose --header "Select AI tool:") || return 0
  [[ -z $tool ]] && { echo "No tool selected."; return 1; }

  # Trainer selection: stored preference pre-populates the input
  local stored_trainer
  stored_trainer=$(cat "$vault_dir/$client/.trainer" 2>/dev/null)

  local trainer
  trainer=$(gum input --header "Trainer name:" --placeholder "e.g. parker" --value "${stored_trainer:-}") || return 0
  [[ -z $trainer ]] && { echo "No trainer name entered."; return 1; }

  # Training type selection: from training-ops/training-types/
  local training
  training=$(ls "$ops/training-types/"*.yml 2>/dev/null \
    | xargs -I{} basename {} .yml \
    | gum choose --header "Select training type:") || return 0
  [[ -z $training ]] && { echo "No training type selected."; return 1; }

  local base=$vault_dir/$client/$training

  # Confirm (warn if already exists)
  if [[ -d $base ]]; then
    gum confirm "⚠️  $base already exists. Continue anyway?" || return 0
  else
    gum confirm "Set up $training for $client using $tool?" || return 0
  fi

  mkdir -p "$base/repos"

  # Store preferences
  echo "$tool" > "$vault_dir/$client/.tool"
  echo "$trainer" > "$vault_dir/$client/.trainer"

  # Parse repos from training type YAML and clone each
  local names=("${(@f)$(grep '  - name:' "$ops/training-types/$training.yml" | awk '{print $3}')}")
  local remotes=("${(@f)$(grep '    remote:' "$ops/training-types/$training.yml" | awk '{print $2}')}")
  local base_branch
  base_branch=$(grep '^base_branch:' "$ops/training-types/$training.yml" | awk '{print $2}')
  [[ -z ${names[1]} ]] && { echo "No repos defined in $training training type."; return 1; }

  # Parse delete list for selected tool
  local delete_list=("${(@f)$(grep '  - ' "$ops/tools/$tool.yml" | awk '{print $2}')}")
  [[ -z ${delete_list[1]} ]] && delete_list=()

  for i in {1..${#names[@]}}; do
    local repo_path="$base/repos/${names[$i]}"

    gum spin --spinner dot --title "Cloning ${names[$i]}..." -- \
      git clone "${remotes[$i]}" "$repo_path" \
      || { echo "Failed to clone ${names[$i]} from ${remotes[$i]}"; return 1; }

    # training-materials is a shared presentation repo — skip branching and config cleanup
    if [[ "${names[$i]}" == "training-materials" ]]; then
      continue
    fi

    # Create client-named branch (off base_branch if specified, otherwise default)
    if [[ -n $base_branch ]]; then
      git -C "$repo_path" checkout "$base_branch" --quiet \
        || { echo "Failed to checkout base branch '$base_branch' in ${names[$i]}"; return 1; }
    fi
    git -C "$repo_path" checkout -B "$client" --quiet \
      || { echo "Failed to create branch '$client' in ${names[$i]}"; return 1; }

    # Delete non-tool config files
    for item in "${delete_list[@]}"; do
      [[ -e "$repo_path/$item" ]] && rm -rf "$repo_path/$item"
    done

    # Commit if anything was deleted
    if [[ -n "$(git -C "$repo_path" status --porcelain)" ]]; then
      git -C "$repo_path" add -u
      git -C "$repo_path" commit -m "Remove non-${tool} AI tool configs" --quiet
    fi
  done

  echo ""
  gum style --foreground 212 "✓ $training set up for $client"
  echo "  Tool:    $tool"
  echo "  Trainer: $trainer"
  echo "  Repos:   $base/repos/"
}

train() {
  local ops=~/Documents/internal/repos/training-ops
  local vault_dir=~/Documents/internal/repos/devclarity-vault/personal/40-customers

  [[ -d $ops ]] || { echo "training-ops not found at $ops"; return 1; }

  # Client selection: existing clients (excluding _* dirs)
  local client_items=()
  for d in "$vault_dir"/*(N/); do
    local name="$(basename "$d")"
    [[ $name == _* ]] && continue
    client_items+=("$name")
  done

  if [[ ${#client_items[@]} -eq 0 ]]; then
    echo "No clients found in $vault_dir. Run new-training first."
    return 1
  fi

  local client
  client=$(printf "%s\n" "${client_items[@]}" | gum filter --header "Select client:") || return 0
  [[ -z $client ]] && return 0

  # Training selection: only dirs that contain a repos/ subdirectory
  local training_items=()
  for d in "$vault_dir/$client"/*(N/); do
    [[ -d "$d/repos" ]] && training_items+=("$(basename "$d")")
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

  local trainer
  trainer=$(cat "$vault_dir/$client/.trainer" 2>/dev/null)
  if [[ -z $trainer ]]; then
    echo "No trainer set for $client. Run new-training to configure."
    return 1
  fi

  local tool
  tool=$(cat "$vault_dir/$client/.tool" 2>/dev/null)

  CLIENT=$client TRAINER=$trainer TOOL=$tool tmuxinator start -p "$session"
}
