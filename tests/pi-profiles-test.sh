#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/.pi/agent-work" "$tmp/.pi/agent-personal"

cat > "$tmp/bin/pi" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = update ]; then
  printf 'fake update output\n'
  exit "${FAKE_PI_UPDATE_EXIT:-0}"
fi

{
  printf 'profile=%s\n' "${PI_CODING_AGENT_DIR##*/}"
  printf 'status:\n'
  if [ -n "${PI_AUTO_UPDATE_STATUS_FILE:-}" ] && [ -f "$PI_AUTO_UPDATE_STATUS_FILE" ]; then
    cat "$PI_AUTO_UPDATE_STATUS_FILE"
  fi
} > "$FAKE_PI_FINAL_LOG"
EOF
chmod +x "$tmp/bin/pi"

success_log="$tmp/success.log"
success_output="$tmp/success.output"
HOME="$tmp" PATH="$tmp/bin:$PATH" FAKE_PI_UPDATE_EXIT=0 FAKE_PI_FINAL_LOG="$success_log" \
  zsh -f -c 'source "$1"; pi-work hello' _ "$root/zsh/pi-profiles.zshrc" > "$success_output"
grep -qx 'profile=agent-work' "$success_log"
grep -q '^success$' "$success_log"
grep -q '\[pi-auto-update\] Completed successfully' "$success_output"

failure_log="$tmp/failure.log"
failure_stderr="$tmp/failure.stderr"
HOME="$tmp" PATH="$tmp/bin:$PATH" FAKE_PI_UPDATE_EXIT=7 FAKE_PI_FINAL_LOG="$failure_log" \
  zsh -f -c 'source "$1"; pi-personal hello' _ "$root/zsh/pi-profiles.zshrc" 2> "$failure_stderr"
grep -qx 'profile=agent-personal' "$failure_log"
grep -q '^failure$' "$failure_log"
grep -q '\[pi-auto-update\] Failed' "$failure_stderr"

skip_log="$tmp/skip.log"
skip_output="$tmp/skip.output"
HOME="$tmp" PATH="$tmp/bin:$PATH" PI_SKIP_AUTO_UPDATE=1 FAKE_PI_FINAL_LOG="$skip_log" \
  zsh -f -c 'source "$1"; pi-personal hello' _ "$root/zsh/pi-profiles.zshrc" > "$skip_output"
grep -q '^skipped$' "$skip_log"
grep -q '\[pi-auto-update\] Skipped' "$skip_output"

if find "$tmp/.pi" -type f -name '.pi-auto-update-status.*' -print -quit | grep -q .; then
  echo 'auto-update status files were not cleaned up' >&2
  exit 1
fi

echo "Pi profile auto-update test passed"
