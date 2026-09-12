#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoExtensionPath = fileURLToPath(
  new URL("../.pi/shared/extensions/tmux-status.ts", import.meta.url),
);
const extensionPath = process.env.PI_TMUX_STATUS_EXTENSION ?? repoExtensionPath;
const stateDir = await mkdtemp(join(tmpdir(), "pi-tmux-status-test-"));
const pane = "%pi-test";
const stateFile = join(stateDir, pane);

process.env.TMUX_PANE = pane;
process.env.CLAUDE_MAP_STATE_DIR = stateDir;

const handlers = new Map();
const pi = {
  on(event, handler) {
    handlers.set(event, handler);
  },
  getSessionName() {
    return "Pi test";
  },
};
const ctx = {
  cwd: "/tmp/pi-project",
  ui: {
    setTitle() {},
  },
};

async function status() {
  const [tool, state] = (await readFile(stateFile, "utf8")).trim().split("\t");
  return { tool, state };
}

async function assertStatus(expected) {
  assert.deepEqual(await status(), { tool: "pi", state: expected });
}

try {
  assert.ok(existsSync(extensionPath), `missing Pi extension: ${extensionPath}`);
  const { default: loadExtension } = await import(
    `${pathToFileURL(extensionPath).href}?test=${Date.now()}`,
  );
  loadExtension(pi);

  await handlers.get("session_start")({ type: "session_start" }, ctx);
  await assertStatus("idle");

  await handlers.get("agent_start")({ type: "agent_start" }, ctx);
  await assertStatus("working");

  // Other tools do not change the AskUserQuestion waiting state.
  await handlers.get("tool_execution_start")(
    { toolName: "bash", toolCallId: "bash-1", args: {} },
    ctx,
  );
  await assertStatus("working");

  // A question is yellow/countable while its external dialog is open.
  await handlers.get("tool_execution_start")(
    { toolName: "AskUserQuestion", toolCallId: "question-1", args: {} },
    ctx,
  );
  await assertStatus("waiting-input");

  // Keep the yellow state until all concurrently tracked questions finish.
  await handlers.get("tool_execution_start")(
    { toolName: "AskUserQuestion", toolCallId: "question-2", args: {} },
    ctx,
  );
  await handlers.get("tool_execution_end")(
    {
      toolName: "AskUserQuestion",
      toolCallId: "question-1",
      result: {},
      isError: false,
    },
    ctx,
  );
  await assertStatus("waiting-input");

  await handlers.get("tool_execution_end")(
    {
      toolName: "AskUserQuestion",
      toolCallId: "question-2",
      result: {},
      isError: false,
    },
    ctx,
  );
  await assertStatus("working");

  // A completed turn still settles to the normal yellow waiting-input state.
  await handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
  await assertStatus("waiting-input");

  await handlers.get("session_shutdown")({ type: "session_shutdown" }, ctx);
  assert.equal(existsSync(stateFile), false);

  console.log("Pi tmux status test passed");
} finally {
  await rm(stateDir, { recursive: true, force: true });
}
