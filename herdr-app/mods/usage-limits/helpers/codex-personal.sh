# Runs on Omarchy through Herdr's machine connection. $1 is codex-limits.sh.
export HERDR_USAGE_CODEX_BIN="$HOME/.local/share/mise/shims/codex"
cd "$HOME" || exit 1
reply=$(timeout 20 sh -c "$1" codex-limits --live-only) || exit 1

printf '%s\n' "$reply" | jq -ce '
  def window: if . == null then null else {usedPercent, windowDurationMins, resetsAt} end;
  def bucket: if . == null then null else
    {limitId, limitName, primary: (.primary | window), secondary: (.secondary | window)}
  end;
  select(.id == 2 and .result != null)
  | {id, result: (.result | {
    rateLimits: (.rateLimits | bucket),
    rateLimitsByLimitId: (.rateLimitsByLimitId | if . == null then null else map_values(bucket) end)
  })}
' || exit 1
