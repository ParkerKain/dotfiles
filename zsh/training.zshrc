# Read a simple top-level scalar from a training-ops YAML file without requiring yq.
_training_top_level() {
  local file=$1
  local key=$2

  awk -v key="$key" '
    $0 ~ "^" key ":" {
      sub("^[^:]*:[[:space:]]*", "")
      sub(/[[:space:]]+#.*$/, "")
      print
      exit
    }
  ' "$file" | tr -d '"'
}

_training_validate_slug() {
  local label=$1
  local value=$2

  [[ -n $value && $value != . && $value != .. && $value =~ ^[a-zA-Z0-9._-]+$ ]] || {
    echo "$label must use only letters, numbers, dots, hyphens, or underscores (and cannot be . or ..)."
    return 1
  }
}

_training_tool_command() {
  local ops=$1
  local tool=$2
  local tool_file="$ops/tools/$tool.yml"

  [[ -f $tool_file ]] || return 1
  _training_top_level "$tool_file" command
}

_training_ensure_client_branch() {
  local repo=$1
  local client=$2
  local base_branch=$3
  local repo_name=$4

  if git -C "$repo" show-ref --verify --quiet "refs/heads/$client"; then
    return 0
  fi

  if [[ -n "$(git -C "$repo" status --porcelain)" ]]; then
    echo "Cannot create branch '$client' in $repo_name: repository has uncommitted work."
    return 1
  fi

  if [[ -n $base_branch ]]; then
    git -C "$repo" checkout "$base_branch" --quiet || {
      echo "Failed to checkout base branch '$base_branch' in $repo_name"
      return 1
    }
  fi
  git -C "$repo" checkout -b "$client" --quiet || {
    echo "Failed to create branch '$client' in $repo_name"
    return 1
  }
}

# Create or refresh the ignored per-client deck manifest in a cloned
# training-materials repo. Existing module edits are preserved; only the
# generated client/tool/presenter metadata is refreshed.
_training_write_manifest() {
  local materials=$1
  local deck_manifest=$2
  local client=$3
  local tool=$4
  local trainer=$5

  [[ -n $deck_manifest ]] || return 0

  local source="$materials/manifests/$deck_manifest.yml"
  if [[ ! -f $source ]]; then
    echo "Default deck manifest not found: $source"
    return 1
  fi

  local manifest_dir="$materials/manifests/local"
  local target="$manifest_dir/$client.yml"
  local input="$source"
  [[ -f $target ]] && input="$target"

  # Most decks use the short `copilot` tag; environment-setup is the
  # exception and uses the stored `github-copilot` tool name.
  local deck_tool="$tool"
  [[ $tool == github-copilot && $deck_manifest != environment-setup ]] && deck_tool=copilot

  mkdir -p "$manifest_dir"
  local tmp="$target.tmp.$$"
  awk -v client="$client" -v tool="$deck_tool" -v presenter="$trainer" '
    function emit_metadata() {
      print "client: " client
      print "tool: " tool
      print "presenter: " presenter
    }
    /^client:/ || /^tool:/ || /^presenter:/ { next }
    /^modules:/ && !emitted {
      emit_metadata()
      emitted = 1
    }
    { print }
    END {
      if (!emitted) emit_metadata()
    }
  ' "$input" > "$tmp" || {
    rm -f "$tmp"
    echo "Failed to prepare deck manifest: $target"
    return 1
  }

  mv "$tmp" "$target" || {
    rm -f "$tmp"
    echo "Failed to write deck manifest: $target"
    return 1
  }

  echo "  Deck manifest: $target"
}

new-training() {
  local ops=~/Documents/internal/repos/training-ops
  local vault_dir=~/Documents/internal/repos/devclarity-vault/personal/40-customers

  [[ -d $ops ]] || { echo "training-ops not found at $ops"; return 1; }
  [[ -d $vault_dir ]] || { echo "Vault customer directory not found at $vault_dir"; return 1; }

  # Client selection: existing clients (excluding _* dirs) + "New client" option.
  local items=()
  local d
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
    _training_validate_slug "Client name" "$client" || return 1
    mkdir -p "$vault_dir/$client"
    if [[ ! -f "$vault_dir/_template/overview.md" ]]; then
      echo "Customer template not found: $vault_dir/_template/overview.md"
      return 1
    fi
    cp "$vault_dir/_template/overview.md" "$vault_dir/$client/overview.md" || return 1
  fi

  # Validate both newly entered and existing-client selections before using
  # the value in filesystem paths and tmuxinator templates.
  _training_validate_slug "Client name" "$client" || return 1

  # Tool selection: stored preference shown first.
  local all_tools=("claude-code" "cursor" "github-copilot")
  local stored_tool
  stored_tool=$(cat "$vault_dir/$client/.tool" 2>/dev/null)

  local tool_items=()
  local t
  if [[ -n $stored_tool && -f "$ops/tools/$stored_tool.yml" ]]; then
    tool_items+=("$stored_tool")
    for t in "${all_tools[@]}"; do
      [[ $t != $stored_tool ]] && tool_items+=("$t")
    done
  else
    tool_items=("${all_tools[@]}")
  fi

  local tool
  tool=$(printf "%s\n" "${tool_items[@]}" | gum choose --header "Select AI tool:") || return 0
  [[ -z $tool ]] && { echo "No tool selected."; return 1; }
  [[ -f "$ops/tools/$tool.yml" ]] || { echo "Unsupported AI tool: $tool"; return 1; }

  # Trainer selection: stored preference pre-populates the input.
  local stored_trainer
  stored_trainer=$(cat "$vault_dir/$client/.trainer" 2>/dev/null)

  local trainer
  trainer=$(gum input --header "Trainer name:" --placeholder "e.g. parker" --value "${stored_trainer:-}") || return 0
  [[ -z $trainer ]] && { echo "No trainer name entered."; return 1; }
  _training_validate_slug "Trainer name" "$trainer" || return 1

  # Training type selection: from training-ops/training-types/.
  local training_items=()
  local training_file
  for training_file in "$ops/training-types/"*.yml(N); do
    training_items+=("${training_file:t:r}")
  done
  [[ ${#training_items[@]} -gt 0 ]] || { echo "No training types found in $ops/training-types."; return 1; }

  local training
  training=$(printf "%s\n" "${training_items[@]}" | gum choose --header "Select training type:") || return 0
  [[ -z $training ]] && { echo "No training type selected."; return 1; }
  _training_validate_slug "Training name" "$training" || return 1

  local type_file="$ops/training-types/$training.yml"
  [[ -f $type_file ]] || { echo "Training type not found: $type_file"; return 1; }

  local base="$vault_dir/$client/$training"

  # Confirm (warn if already exists).
  if [[ -d $base ]]; then
    gum confirm "⚠️  $base already exists. Reuse existing repos?" || return 0
  else
    gum confirm "Set up $training for $client using $tool?" || return 0
  fi

  mkdir -p "$base/repos"

  # Store client-wide preferences.
  printf '%s\n' "$tool" > "$vault_dir/$client/.tool"
  printf '%s\n' "$trainer" > "$vault_dir/$client/.trainer"

  # Parse repos from the training type YAML and clone each one.
  local names=("${(@f)$(awk '/^  - name:/ {print $3}' "$type_file")}")
  local remotes=("${(@f)$(awk '/^    remote:/ {print $2}' "$type_file")}")
  local base_branch
  base_branch=$(_training_top_level "$type_file" base_branch)
  local deck_manifest
  deck_manifest=$(_training_top_level "$type_file" deck_manifest)

  [[ -n ${names[1]} ]] || { echo "No repos defined in $training training type."; return 1; }
  [[ ${#names[@]} -eq ${#remotes[@]} ]] || {
    echo "Training type $training has mismatched repo names and remotes."
    return 1
  }

  local delete_list=("${(@f)$(awk '/^  - / {print $2}' "$ops/tools/$tool.yml")}")
  local i
  for i in {1..${#names[@]}}; do
    local repo_name="${names[$i]}"
    local remote="${remotes[$i]}"
    local repo_path="$base/repos/$repo_name"

    if [[ -e $repo_path ]]; then
      git -C "$repo_path" rev-parse --git-dir >/dev/null 2>&1 || {
        echo "Cannot reuse $repo_path: it is not a git repository."
        return 1
      }
      if [[ $repo_name != training-materials ]]; then
        _training_ensure_client_branch "$repo_path" "$client" "$base_branch" "$repo_name" || return 1
      fi
      echo "  Reusing existing $repo_name (leaving its work untouched)"
      continue
    fi

    gum spin --spinner dot --title "Cloning $repo_name..." -- \
      git clone "$remote" "$repo_path" || {
        echo "Failed to clone $repo_name from $remote"
        return 1
      }

    # training-materials is a shared presentation repo: keep its default branch
    # and do not apply client tool-config cleanup.
    if [[ $repo_name == training-materials ]]; then
      continue
    fi

    # Create the client branch off an optional training-specific base branch.
    _training_ensure_client_branch "$repo_path" "$client" "$base_branch" "$repo_name" || return 1

    # Delete non-tool config files.
    local item
    for item in "${delete_list[@]}"; do
      [[ -n $item && -e "$repo_path/$item" ]] && rm -rf "$repo_path/$item"
    done

    # Commit if anything was deleted.
    if [[ -n "$(git -C "$repo_path" status --porcelain)" ]]; then
      git -C "$repo_path" add -u || {
        echo "Failed to stage tool-config cleanup in $repo_name"
        return 1
      }
      git -C "$repo_path" commit -m "Remove non-${tool} AI tool configs" --quiet || {
        echo "Failed to commit tool-config cleanup in $repo_name"
        return 1
      }
    fi
  done

  _training_write_manifest "$base/repos/training-materials" "$deck_manifest" "$client" "$tool" "$trainer" || return 1

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
  [[ -d $vault_dir ]] || { echo "Vault customer directory not found at $vault_dir"; return 1; }

  # Client selection: existing clients (excluding _* dirs).
  local client_items=()
  local d
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
  _training_validate_slug "Client name" "$client" || return 1

  # Training selection: only dirs that contain a repos/ subdirectory.
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
  _training_validate_slug "Training name" "$training" || return 1

  local session="$ops/sessions/$training.yml"
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
  if [[ -z $tool ]]; then
    echo "No AI tool set for $client. Run new-training to configure."
    return 1
  fi

  local tool_command
  tool_command=$(_training_tool_command "$ops" "$tool")
  if [[ -z $tool_command ]]; then
    echo "No launch command configured for AI tool '$tool'."
    return 1
  fi
  if ! command -v "$tool_command" >/dev/null 2>&1; then
    echo "AI tool '$tool' requires '$tool_command' on PATH."
    return 1
  fi

  # Refresh/create the local manifest without replacing any manual module edits.
  local type_file="$ops/training-types/$training.yml"
  local deck_manifest
  if [[ -f $type_file ]]; then
    deck_manifest=$(_training_top_level "$type_file" deck_manifest)
  fi
  _training_write_manifest \
    "$vault_dir/$client/$training/repos/training-materials" \
    "$deck_manifest" "$client" "$tool" "$trainer" || return 1

  CLIENT="$client" TRAINER="$trainer" TOOL="$tool" TOOL_COMMAND="$tool_command" tmuxinator start -p "$session"
}
