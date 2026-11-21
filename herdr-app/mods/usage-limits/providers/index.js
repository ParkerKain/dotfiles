import claude from "./claude.js";
import codex from "./codex.js";
import { errorReport } from "../lib/report.js";

export const TOKEN_PROVIDERS = [claude, codex];
// Order here is the order in the status bar, the panel and the settings popup.
export const PROVIDERS = [...TOKEN_PROVIDERS, {
  ...codex,
  id: "codex-personal",
  name: "Codex Personal",
  panelOnly: true, // on Omarchy: shown in the hover panel, never on the bar
  helper: "helpers/codex-personal.sh",
  remote: true,
  parse(text, now) {
    const report = codex.parse(text, now);
    return report.status === "ok"
      ? { ...report, source: "Omarchy" }
      : errorReport("Omarchy", "Couldn't read limits from Omarchy", now);
  },
}];
