/**
 * pi-auto-update — reports the result of the profile launcher preflight.
 *
 * pi-work and pi-personal run `pi update --all` before starting Pi, then pass
 * the result through PI_AUTO_UPDATE_STATUS_FILE. Doing the update before Pi
 * starts is intentional: it lets the running session use the updated Pi core
 * and extension resources instead of waiting for the next launch.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { env, stderr } from "node:process";

const STATUS_FILE_ENV = "PI_AUTO_UPDATE_STATUS_FILE";
const STATUS_KEY = "pi-auto-update";
const MAX_SUMMARY_LENGTH = 240;

type UpdateStatus = "success" | "failure" | "skipped";

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function summarize(output: string): string | undefined {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return undefined;

  const summary = lines.slice(-3).join(" | ");
  return summary.length > MAX_SUMMARY_LENGTH
    ? `…${summary.slice(-(MAX_SUMMARY_LENGTH - 1))}`
    : summary;
}

function report(
  ctx: ExtensionContext,
  message: string,
  type: "info" | "warning" | "error",
  status: string,
): void {
  ctx.ui.setStatus(STATUS_KEY, status);

  if (ctx.hasUI) {
    ctx.ui.notify(message, type);
  } else {
    stderr.write(`[pi-auto-update] ${message}\n`);
  }
}

export default function (pi: ExtensionAPI) {
  let reported = false;

  pi.on("session_start", async (event, ctx) => {
    // Only report the preflight for the initial process startup. Reloads and
    // session switches should not repeat the notification.
    if (reported || event.reason !== "startup") return;
    reported = true;

    const statusFile = env[STATUS_FILE_ENV]?.trim();
    if (!statusFile) return;

    let raw: string;
    try {
      raw = await readFile(statusFile, "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      report(
        ctx,
        `Pi auto-update could not report its result: ${detail}`,
        "error",
        "✗ Pi auto-update report failed",
      );
      return;
    }

    const [rawStatus, ...outputLines] = raw.split(/\r?\n/);
    const status = rawStatus?.trim() as UpdateStatus;
    const detail = summarize(outputLines.join("\n"));

    if (status === "success") {
      report(
        ctx,
        `Pi auto-update completed successfully for this session${detail ? ` — ${detail}` : "."}`,
        "info",
        "✓ Pi auto-update complete",
      );
      return;
    }

    if (status === "skipped") {
      report(
        ctx,
        `Pi auto-update was skipped${detail ? ` — ${detail}` : "."}`,
        "warning",
        "– Pi auto-update skipped",
      );
      return;
    }

    if (status === "failure") {
      report(
        ctx,
        `Pi auto-update failed; this session is using the available installation${detail ? ` — ${detail}` : "."}`,
        "error",
        "✗ Pi auto-update failed",
      );
      return;
    }

    report(
      ctx,
      `Pi auto-update returned an unrecognized status: ${rawStatus?.trim() || "(empty)"}`,
      "error",
      "✗ Pi auto-update status invalid",
    );
  });
}
