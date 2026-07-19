# tmux Codex Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent tmux from marking active Codex work idle or implying that automatic approval review requires user action.

**Architecture:** Keep the existing tab-separated per-pane state file format. Add `approval-pending` as a first-class lifecycle status, render it with the active palette, and stop mutating `working` state based only on age. A standalone Bash regression script will mock tmux pane discovery and test the hook writer, resolver, status line, and waiting counter end-to-end.

**Tech Stack:** Bash, tmux format output, jq, shell test script.

## Global Constraints

- Do not infer Codex approval mode from global, project, or runtime configuration.
- `PermissionRequest` must be neutral: it may represent manual approval or automatic approval review.
- A live pane with recorded `working` state remains `working` regardless of its state-file age.
- `waiting-*` remains reserved for states that require user input or permission.

---

### Task 1: Add executable regression coverage for state semantics

**Files:**

- Create: `tests/tmux-agent-status-test.sh`
- Test: `tests/tmux-agent-status-test.sh`

**Interfaces:**

- Consumes: `.tmux/scripts/claude-state`, `.tmux/scripts/claude-map-lib`, `.tmux/scripts/claude-map-statusline`, and `.tmux/scripts/claude-waiting-count`.
- Produces: an executable test command that exits zero only when the hook, map resolver, ticker renderer, and waiting counter follow the documented status contract.

- [ ] **Step 1: Write the failing regression test**

Create this executable test script. It sets an isolated state directory, provides a fake `tmux` command that reports one live Codex pane, and asserts the intended behavior.

```bash
#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/state"

cat > "$tmp/bin/tmux" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = list-panes ]; then
  printf '%%1\037work\0371\0370\037codex\037Codex\037/tmp/project\n'
fi
EOF
chmod +x "$tmp/bin/tmux"

export PATH="$tmp/bin:$PATH"
export CLAUDE_MAP_STATE_DIR="$tmp/state"
export TMUX_PANE='%1'

printf '{"cwd":"/tmp/project"}' | "$root/.tmux/scripts/claude-state" codex PermissionRequest
state="$(cut -f2 "$tmp/state/%1")"
[ "$state" = approval-pending ] || { echo "expected approval-pending, got $state"; exit 1; }

"$root/.tmux/scripts/claude-waiting-count" | grep -qx ''

printf 'codex\tworking\t1\tproject\n' > "$tmp/state/%1"
rows="$tmp/rows"
source "$root/.tmux/scripts/claude-map-lib"
claude_map_scan_raw "$rows"
awk -F '\t' '$2 == "working" { found = 1 } END { exit !found }' "$rows"

printf 'codex\tapproval-pending\t1\tproject\n' > "$tmp/state/%1"
"$root/.tmux/scripts/claude-map-statusline" 200 '%1' | grep -q 'bg=#9ccfd8'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash tests/tmux-agent-status-test.sh`

Expected: failure stating `expected approval-pending, got waiting-permission`.

- [ ] **Step 3: Commit the red test**

```bash
git add tests/tmux-agent-status-test.sh
git commit -m "test(tmux): cover neutral Codex approval status"
```

### Task 2: Implement neutral approval and persistent working states

**Files:**

- Modify: `.tmux/scripts/claude-state:26-59`
- Modify: `.tmux/scripts/claude-map-lib:5-14,69-75,101-106`
- Modify: `.tmux/scripts/claude-map-statusline:37-43`
- Modify: `.tmux/scripts/claude-waiting-count:7-12`

**Interfaces:**

- Consumes: `claude-state <tool> PermissionRequest` lifecycle calls and `tool<TAB>status<TAB>timestamp<TAB>summary` state records.
- Produces: `approval-pending` state records; `claude_map_scan_raw` rows containing `approval-pending`; a foam-colored active status chip; and a waiting counter that excludes that state.

- [ ] **Step 1: Replace the permission state in the hook writer**

In `.tmux/scripts/claude-state`, make the Codex permission event neutral:

```bash
  PermissionRequest)                        status=approval-pending ;;
```

Update the adjacent comments so they describe a neutral approval state rather than a user block.

- [ ] **Step 2: Keep working rows working and classify approval-pending as active**

In `.tmux/scripts/claude-map-lib`, remove the `CLAUDE_MAP_STALE_WORKING` default and the conditional that replaces old `working` with `idle`. Add this case before `waiting-input`:

```bash
      approval-pending)    sk=2; icon="⠿" ;;
```

Renumber the lower-priority sort keys so `idle` follows it and `working` remains the final active state. Preserve the existing liveness checks that delete records when the pane no longer runs the recorded tool.

- [ ] **Step 3: Render approval-pending as active and leave it out of the waiting counter**

In `.tmux/scripts/claude-map-statusline`, add:

```bash
    approval-pending)    bg="$FOAM";  fg="$BASE" ;;
```

In `.tmux/scripts/claude-waiting-count`, make the state directory honor the same override used by the map, then replace the wildcard classification with explicit user-waiting states:

```bash
dir="${CLAUDE_MAP_STATE_DIR:-$HOME/.claude/tmux-state}"

  case "$(cut -f2 "$f" 2>/dev/null)" in
    waiting-permission|waiting-input) n=$(( n + 1 )) ;;
  esac
```

- [ ] **Step 4: Run the regression test to verify it passes**

Run: `bash tests/tmux-agent-status-test.sh`

Expected: exit code 0 with no output.

- [ ] **Step 5: Run shell syntax checks**

Run: `bash -n .tmux/scripts/claude-state .tmux/scripts/claude-map-lib .tmux/scripts/claude-map-statusline .tmux/scripts/claude-waiting-count tests/tmux-agent-status-test.sh`

Expected: exit code 0 with no output.

- [ ] **Step 6: Commit the implementation**

```bash
git add .tmux/scripts/claude-state .tmux/scripts/claude-map-lib .tmux/scripts/claude-map-statusline .tmux/scripts/claude-waiting-count tests/tmux-agent-status-test.sh
git commit -m "fix(tmux): keep Codex approval status neutral"
```

### Task 3: Update the operator documentation

**Files:**

- Modify: `docs/tmux-agent-status.md:14-18,29-32,84-107,137-143`

**Interfaces:**

- Consumes: the implemented status names and existing hook configuration instructions.
- Produces: documentation that describes `approval-pending` as an active, neutral state and confirms that no auto-mode setup is required.

- [ ] **Step 1: Update the status description**

Replace the status list with:

```markdown
`idle` / `working` / `approval-pending` / `waiting-input` /
`waiting-permission`
```

Add: `Codex PermissionRequest becomes approval-pending. It denotes an approval in progress without asserting whether a person or the automatic reviewer will handle it.`

- [ ] **Step 2: Document long-running work behavior**

Add this sentence to the state-resolution description:

```markdown
Live `working` panes are not demoted based on elapsed time; later hooks and the pane liveness check determine their next state.
```

- [ ] **Step 3: Re-run the full verification set**

Run:

```bash
bash tests/tmux-agent-status-test.sh
bash -n .tmux/scripts/claude-state .tmux/scripts/claude-map-lib .tmux/scripts/claude-map-statusline .tmux/scripts/claude-waiting-count tests/tmux-agent-status-test.sh
git diff --check
```

Expected: every command exits 0; no output except any intentional test diagnostics.

- [ ] **Step 4: Commit the documentation**

```bash
git add docs/tmux-agent-status.md
git commit -m "docs(tmux): clarify Codex approval status"
```
