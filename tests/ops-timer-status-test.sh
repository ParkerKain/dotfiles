#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root/.tmux/scripts/ops-timer-status"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1 & 2: ops-tasks not on PATH - exits 0 and prints nothing.
out="$(PATH=/nonexistent "$script")"
rc=$?
[ "$rc" -eq 0 ] || { echo "expected exit 0 with no ops-tasks, got $rc"; exit 1; }
[ -z "$out" ] || { echo "expected no output with no ops-tasks, got: $out"; exit 1; }

# 3: ops-tasks on PATH but `track status` fails - still exits 0.
mkdir -p "$tmp/fail-bin"
cat > "$tmp/fail-bin/ops-tasks" <<'EOF'
#!/bin/sh
exit 1
EOF
chmod +x "$tmp/fail-bin/ops-tasks"
out="$(PATH="$tmp/fail-bin:$PATH" "$script")"
rc=$?
[ "$rc" -eq 0 ] || { echo "expected exit 0 when ops-tasks fails, got $rc"; exit 1; }

# 4: ops-tasks succeeds - its output passes through.
mkdir -p "$tmp/ok-bin"
cat > "$tmp/ok-bin/ops-tasks" <<'EOF'
#!/bin/sh
echo "ops-timer-test-marker"
EOF
chmod +x "$tmp/ok-bin/ops-tasks"
out="$(PATH="$tmp/ok-bin:$PATH" "$script")"
[[ "$out" == *"ops-timer-test-marker"* ]] || { echo "expected marker in output, got: $out"; exit 1; }

echo "ok"
