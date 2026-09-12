/**
 * tmux-status — pi extension that writes pane state files for the shared
 * tmux minimap / status-line integration (used by claude-map, claude-map-statusline,
 * and claude-waiting-count). Writes to the same state directory as Claude Code
 * and Codex so pi panes appear alongside them automatically.
 *
 * State file format (~/.claude/tmux-state/<pane_id>):
 *   pi<TAB>status<TAB>unix_ts<TAB>summary
 *
 * Install: copy to ~/.pi/agent/extensions/tmux-status.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { env } from "node:process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_DIR =
  env.CLAUDE_MAP_STATE_DIR?.trim() || join(homedir(), ".claude", "tmux-state");
const TOOL = "pi";
const ASK_USER_QUESTION_TOOL = "AskUserQuestion";

function paneId(): string | undefined {
  return env.TMUX_PANE?.trim() || undefined;
}

function stateFile(): string | undefined {
  const pid = paneId();
  return pid ? join(STATE_DIR, pid) : undefined;
}

async function ensureDir(): Promise<void> {
  if (!existsSync(STATE_DIR)) {
    await mkdir(STATE_DIR, { recursive: true });
  }
}

async function writeState(
  status: string,
  cwd: string,
): Promise<void> {
  const file = stateFile();
  if (!file) return;

  await ensureDir();

  const summary = basename(cwd);
  const ts = Math.floor(Date.now() / 1000);

  await writeFile(file, `${TOOL}\t${status}\t${ts}\t${summary}\n`, "utf-8");
}

async function removeState(): Promise<void> {
  const file = stateFile();
  if (!file) return;
  try {
    await unlink(file);
  } catch {
    // File may already be gone; ignore.
  }
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // No tmux? No-op.
  if (!paneId()) return;

  // AskUserQuestion is an external custom tool. While its dialog is open,
  // Pi's agent is still running, so agent_start/agent_settled alone leaves
  // the pane marked working instead of yellow/waiting-input.
  const pendingAskUserQuestions = new Set<string>();

  // Pi's default title is "π - <session> - <cwd>". The minimap uses the
  // tmux pane title, so keep it to the session name alone, like Claude Code.
  const setSessionTitle = (ctx: { ui: { setTitle(title: string): void } }) => {
    ctx.ui.setTitle(pi.getSessionName()?.trim() || "Pi");
  };

  pi.on("session_start", async (_event, ctx) => {
    pendingAskUserQuestions.clear();
    setSessionTitle(ctx);
    await writeState("idle", ctx.cwd);
  });

  pi.on("session_info_changed", async (_event, ctx) => {
    setSessionTitle(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    pendingAskUserQuestions.clear();
    await writeState("working", ctx.cwd);
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    if (event.toolName !== ASK_USER_QUESTION_TOOL) return;
    pendingAskUserQuestions.add(event.toolCallId);
    await writeState("waiting-input", ctx.cwd);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (event.toolName !== ASK_USER_QUESTION_TOOL) return;
    const wasPending = pendingAskUserQuestions.delete(event.toolCallId);
    if (wasPending && pendingAskUserQuestions.size === 0) {
      await writeState("working", ctx.cwd);
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    pendingAskUserQuestions.clear();
    await writeState("waiting-input", ctx.cwd);
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    pendingAskUserQuestions.clear();
    await removeState();
  });
}
