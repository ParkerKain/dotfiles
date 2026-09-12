# Pi account profiles
# Each profile keeps its own auth.json and sessions while sharing the extension stack.
# Codex keeps a separate auth home, so log into each one once:
#   mkdir -p "$HOME/.codex-work"
#   CODEX_HOME="$HOME/.codex-work" codex login
#   CODEX_HOME="$HOME/.codex" codex login

# Run the update before launching Pi so the process that becomes the session
# starts with the new Pi core and package resources. The shared extension reads
# the result file and reports it inside the newly started session.
_pi_launch_with_auto_update() {
  local agent_dir="$1"
  local codex_home="$2"
  shift 2

  local status_file output_file update_status update_exit pi_exit skip_reason
  local arg
  skip_reason=""

  if [[ -n "${PI_SKIP_AUTO_UPDATE:-}" ]]; then
    skip_reason="PI_SKIP_AUTO_UPDATE is set"
  elif [[ -n "${PI_OFFLINE:-}" ]]; then
    skip_reason="PI_OFFLINE is set"
  else
    for arg in "$@"; do
      if [[ "$arg" == "--offline" ]]; then
        skip_reason="--offline was requested"
        break
      fi
    done
  fi

  if ! mkdir -p "$agent_dir"; then
    print -u2 -- "[pi-auto-update] Could not access $agent_dir; starting Pi without an update result."
    PI_CODING_AGENT_DIR="$agent_dir" CODEX_HOME="$codex_home" command pi "$@"
    return $?
  fi

  status_file=$(mktemp "$agent_dir/.pi-auto-update-status.XXXXXX") || {
    print -u2 -- "[pi-auto-update] Could not create a status file; starting Pi without an update result."
    PI_CODING_AGENT_DIR="$agent_dir" CODEX_HOME="$codex_home" command pi "$@"
    return $?
  }
  output_file="${status_file}.output"

  if [[ -n "$skip_reason" ]]; then
    update_status="skipped"
    printf '%s\n%s\n' "$update_status" "$skip_reason" > "$status_file"
  else
    print -r -- "[pi-auto-update] Updating Pi and extensions..."
    PI_CODING_AGENT_DIR="$agent_dir" CODEX_HOME="$codex_home" command pi update --all > "$output_file" 2>&1
    update_exit=$?
    if (( update_exit == 0 )); then
      update_status="success"
    else
      update_status="failure"
    fi
    {
      print -r -- "$update_status"
      cat "$output_file"
    } > "$status_file"
  fi

  case "$update_status" in
    success)
      rehash
      print -r -- "[pi-auto-update] Completed successfully; launching Pi."
      ;;
    skipped)
      print -r -- "[pi-auto-update] Skipped ($skip_reason); launching Pi."
      ;;
    failure)
      print -u2 -- "[pi-auto-update] Failed; launching Pi with the available installation."
      if [[ -s "$output_file" ]]; then
        tail -n 8 "$output_file" >&2
      fi
      ;;
  esac

  PI_CODING_AGENT_DIR="$agent_dir" \
    CODEX_HOME="$codex_home" \
    PI_AUTO_UPDATE_STATUS_FILE="$status_file" \
    command pi "$@"
  pi_exit=$?

  rm -f "$status_file" "$output_file"
  return $pi_exit
}

pi-work() {
  _pi_launch_with_auto_update "$HOME/.pi/agent-work" "$HOME/.codex-work" "$@"
}

pi-personal() {
  _pi_launch_with_auto_update "$HOME/.pi/agent-personal" "$HOME/.codex" "$@"
}
