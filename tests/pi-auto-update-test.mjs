#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const extensionPath = fileURLToPath(
  new URL("../.pi/shared/extensions/pi-auto-update.ts", import.meta.url),
);

assert.ok(existsSync(extensionPath), `missing Pi extension: ${extensionPath}`);

async function runCase(rawStatus, expectedType, expectedStatus, expectedText) {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-auto-update-test-"));
  const statusFile = join(stateDir, "status");
  await writeFile(statusFile, rawStatus, "utf8");
  process.env.PI_AUTO_UPDATE_STATUS_FILE = statusFile;

  const handlers = new Map();
  const notifications = [];
  const statuses = [];
  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
      setStatus(key, value) {
        statuses.push({ key, value });
      },
    },
  };

  try {
    const { default: loadExtension } = await import(
      `${pathToFileURL(extensionPath).href}?test=${Date.now()}-${Math.random()}`,
    );
    loadExtension(pi);

    await handlers.get("session_start")({
      type: "session_start",
      reason: "startup",
    }, ctx);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].type, expectedType);
    assert.match(notifications[0].message, expectedText);
    assert.deepEqual(statuses, [
      { key: "pi-auto-update", value: expectedStatus },
    ]);

    // Session reloads must not repeat the startup report.
    await handlers.get("session_start")({
      type: "session_start",
      reason: "reload",
    }, ctx);
    assert.equal(notifications.length, 1);
  } finally {
    delete process.env.PI_AUTO_UPDATE_STATUS_FILE;
    await rm(stateDir, { recursive: true, force: true });
  }
}

await runCase(
  "success\nUpdated packages\nUpdated pi from 0.1.0 to 0.2.0\n",
  "info",
  "✓ Pi auto-update complete",
  /completed successfully.*Updated pi from 0\.1\.0 to 0\.2\.0/,
);

await runCase(
  "failure\nError: network unavailable\n",
  "error",
  "✗ Pi auto-update failed",
  /failed.*network unavailable/,
);

console.log("Pi auto-update extension test passed");
