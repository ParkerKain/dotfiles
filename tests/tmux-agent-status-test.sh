#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/state"

cat > "$tmp/bin/tmux" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = list-panes ]; then
  printf '%%1\037work\0371\0370\037codex\037Codex\037/tmp/project\037Workspace\n'
  printf '%%2\037pi-work\0372\0371\037node\037π - pi-work\037/tmp/pi-project\037Pi-2\n'
  printf '%%3\037pi-custom\0373\0371\037node\037Knowledge Share email\037/tmp/custom-pi\037Pi\n'
fi
EOF
chmod +x "$tmp/bin/tmux"

export PATH="$tmp/bin:$PATH"
export CLAUDE_MAP_STATE_DIR="$tmp/state"
export TMUX_PANE='%1'

printf '{"cwd":"/tmp/project"}' | "$root/.tmux/scripts/claude-state" codex PermissionRequest
state="$(cut -f2 "$tmp/state/%1")"
[ "$state" = approval-pending ] || { echo "expected approval-pending, got $state"; exit 1; }

[ -z "$($root/.tmux/scripts/claude-waiting-count)" ]

printf 'codex\tworking\t1\tproject\n' > "$tmp/state/%1"
rows="$tmp/rows"
source "$root/.tmux/scripts/claude-map-lib"
claude_map_scan_raw "$rows"
awk -F '\t' '$2 == "working" { found = 1 } END { exit !found }' "$rows"
awk -F '\t' '$2 == "idle" && $3 == "pi" && $10 == "%2" { found = 1 } END { exit !found }' "$rows"
awk -F '\t' '$2 == "idle" && $3 == "pi" && $10 == "%3" { found = 1 } END { exit !found }' "$rows"

printf 'codex\tapproval-pending\t1\tproject\n' > "$tmp/state/%1"
"$root/.tmux/scripts/claude-map-statusline" 200 '%1' | grep -q 'bg=#9ccfd8'
