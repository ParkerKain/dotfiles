new-training() {
  local ops=~/Documents/internal/repos/training-ops
  local clients_dir=~/Documents/clients

  [[ -d $ops ]] || { echo "training-ops not found at $ops"; return 1; }

  # Client selection: existing clients + "New client" option
  local items=()
  for d in "$clients_dir"/*(N/); do
    [[ -d $d ]] && items+=("$(basename "$d")")
  done
  items+=("+ New client")

  local client
  client=$(printf "%s\n" "${items[@]}" | gum choose --header "Select client:") || return 0

  if [[ $client == "+ New client" ]]; then
    client=$(gum input --placeholder "Client name (e.g. acmecorp)") || return 0
    [[ -z $client ]] && { echo "No client name entered."; return 1; }
  fi

  # Tool selection: stored preference shown first
  local all_tools=("claude-code" "cursor" "github-copilot")
  local stored_tool
  stored_tool=$(cat "$clients_dir/$client/.tool" 2>/dev/null)

  local tool_items=()
  if [[ -n $stored_tool ]]; then
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
    gum confirm "Set up $training for $client using $tool?" || return 0
  fi

  mkdir -p "$base/presentations" "$base/repos"

  # Store tool preference (directory now exists)
  echo "$tool" > "$clients_dir/$client/.tool"

  # Parse repos from training type YAML and clone each
  local names=("${(@f)$(grep '  - name:' "$ops/training-types/$training.yml" | awk '{print $3}')}")
  local remotes=("${(@f)$(grep '    remote:' "$ops/training-types/$training.yml" | awk '{print $2}')}")
  [[ -z ${names[1]} ]] && { echo "No repos defined in $training training type."; return 1; }

  # Parse delete list for selected tool
  local delete_list=("${(@f)$(grep '  - ' "$ops/tools/$tool.yml" | awk '{print $2}')}")
  [[ -z ${delete_list[1]} ]] && delete_list=()

  for i in {1..${#names[@]}}; do
    local repo_path="$base/repos/${names[$i]}"

    gum spin --spinner dot --title "Cloning ${names[$i]}..." -- \
      git clone "${remotes[$i]}" "$repo_path" \
      || { echo "Failed to clone ${names[$i]} from ${remotes[$i]}"; return 1; }

    # Create client-named branch
    git -C "$repo_path" checkout -B "$client" --quiet \
      || { echo "Failed to create branch '$client' in ${names[$i]}"; return 1; }

    # Delete non-tool config files
    for item in "${delete_list[@]}"; do
      [[ -e "$repo_path/$item" ]] && rm -rf "$repo_path/$item"
    done

    # Commit if anything was deleted
    if [[ -n "$(git -C "$repo_path" status --porcelain)" ]]; then
      git -C "$repo_path" add -u --quiet
      git -C "$repo_path" commit -m "Remove non-${tool} AI tool configs" --quiet
    fi
  done

  echo ""
  gum style --foreground 212 "✓ $training set up for $client"
  echo "  Tool:          $tool"
  echo "  Repos:         $base/repos/"
  echo "  Presentations: $base/presentations/"
}

train() {
  local ops=~/Documents/internal/repos/training-ops
  local clients_dir=~/Documents/clients

  [[ -d $ops ]] || { echo "training-ops not found at $ops"; return 1; }

  # Client selection: fuzzy filter over existing clients
  local client_items=()
  for d in "$clients_dir"/*(N/); do
    client_items+=("$(basename "$d")")
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
  for d in "$trainings_dir"/*(N/); do
    training_items+=("$(basename "$d")")
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
