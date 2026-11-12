import { View, div } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea } from "gpui-base";
import { closeOverlay, exec, focused, home, knownAgents, openOverlay, panes, props, run, spaces, theme } from "herdr";

const REPOS = `${home()}/Documents/internal/repos`;
const VAULT = `${REPOS}/devclarity-vault`;
const schema = JSON.stringify({
  type: "object", additionalProperties: false,
  properties: {
    folder: { type: "string" },
    space: { type: "string", enum: ["current", "existing", "new"] },
    space_name: { type: "string" },
    tab_name: { type: "string" },
    agent: { type: "string", enum: ["claude", "codex", "pi"] },
    split: { type: "string", enum: ["none", "right", "down"] }
  },
  required: ["folder", "space", "space_name", "tab_name", "agent", "split"]
});

function output(result) {
  if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || "Session planning failed.");
  const body = JSON.parse(result.stdout);
  if (body.is_error) throw new Error(body.result || "Session planning failed.");
  return body.structured_output ?? JSON.parse(body.result);
}

function cleanName(value, fallback) {
  return String(value || fallback).trim().slice(0, 60) || fallback;
}

export default class SessionLauncher extends View {
  init(_props, cx) {
    const task = props()?.task;
    this.task = task ?? null;
    this.text = task?.prompt ?? "";
    this.busy = false;
    this.error = "";
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.input = TextareaState.new({ value: this.text, placeholder: "What do you want to work on?", rows: 4 });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; cx.notify(); });
    if (!task) this.input.focus();
    if (task) cx.timer.after(0, cx => this.start(cx));
  }

  start(cx) {
    if (this.busy || !this.text.trim()) return;
    this.busy = true;
    this.error = "";
    const request = this.text.trim();
    cx.notify();
    cx.spawn(async cx => {
      try {
        const plan = await this.plan(request);
        await this.launch(plan, request);
        closeOverlay(props().overlay);
      } catch (error) {
        this.error = String(error?.message ?? error);
        this.busy = false;
        cx.notify();
      }
    });
  }

  async plan(request) {
    const current = focused();
    const available = await exec("ls", ["-1", REPOS]);
    if (available.code !== 0) throw new Error("Could not list local repositories.");
    const repoNames = available.stdout.split("\n").filter(Boolean);
    const allSpaces = spaces().map(s => ({ id: s.id, name: s.name, folder: s.folder, machine: s.machine }));
    const task = this.task;
    const instruction = [
      "Choose a Herdr session layout for this request. Return JSON only.",
      "Use a local folder that exists. Prefer the current folder for an unqualified request.",
      "Use an existing space when its folder matches. Create a new space for a different repo or when asked for one.",
      "A new tab is the default for new work. Use a split only when the request asks for a second pane or a shell/editor beside the agent.",
      "Choose Claude unless another agent is requested or there is a clear reason for Codex or Pi.",
      "Keep names short and recognizable. Do not plan shell commands or file edits.",
      `Current folder: ${current?.cwd || VAULT}`,
      `Repositories in ${REPOS}: ${repoNames.join(", ")}`,
      `Open spaces: ${JSON.stringify(allSpaces)}`,
      task ? `This is a Tasks Play request. Default folder: ${task.folder || VAULT}. Suggested tab name: ${task.title}.` : "",
      `Request:\n${request}`
    ].filter(Boolean).join("\n\n");
    const result = await exec("claude", ["-p", "--safe-mode", "--strict-mcp-config", "--tools", "", "--model", "haiku", "--effort", "low", "--no-session-persistence", "--max-budget-usd", "0.05", "--system-prompt", "Choose a valid Herdr session plan from the supplied context. Return only the requested JSON.", "--output-format", "json", "--json-schema", schema, instruction], { cwd: task?.folder || current?.cwd || VAULT, timeout: 120000 });
    const plan = output(result);
    if (!["current", "existing", "new"].includes(plan.space) || !["none", "right", "down"].includes(plan.split)) throw new Error("Session planner returned an invalid layout.");
    if (!["claude", "codex", "pi"].includes(plan.agent)) throw new Error("Session planner returned an unknown agent.");
    const folder = plan.folder || task?.folder || current?.cwd || VAULT;
    if (!folder.startsWith(`${home()}/`)) throw new Error("Session folder must be under your home directory.");
    const exists = await exec("test", ["-d", folder]);
    if (exists.code !== 0) throw new Error(`Folder does not exist: ${folder}`);
    return { ...plan, folder };
  }

  async launch(plan, request) {
    const matches = spaces().filter(s => !s.machine && s.folder === plan.folder);
    const target = plan.space === "existing" ? matches[0] : plan.space === "current" ? spaces().find(s => s.id === focused()?.space && !s.machine && s.folder === plan.folder) : null;
    const agents = await knownAgents();
    const agent = agents.find(a => a.installed && (a.key?.toLowerCase() === plan.agent || a.name?.toLowerCase().includes(plan.agent)));
    if (!agent) throw new Error(`${plan.agent} is not installed in Herdr.`);
    const tabName = cleanName(this.task?.title || plan.tab_name, "New session");
    const argv = this.task?.slug && plan.agent === "claude" ? [...agent.run, "-n", this.task.slug] : agent.run;
    const args = { name: tabName, folder: plan.folder, argv, task: request };
    if (target) run("tab.new", { ...args, space: target.id });
    else run("space.new", { name: cleanName(plan.space_name, plan.folder.split("/").pop()), folder: plan.folder, tab: tabName, argv, task: request, machine: "" });
    if (plan.split !== "none") run("pane.split", { direction: plan.split });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    return v_flex().id("session-launcher").track_focus(this.handle).w_full().h_full().p(18).gap(12).bg(t.popover)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && !this.busy) { closeOverlay(p.overlay); cx.stop_propagation(); }
        if (e.key === "enter" && (e.modifiers.platform || e.modifiers.control)) { this.start(cx); cx.stop_propagation(); }
      })
      .child(div().text_size(17).font_semibold().text_color(t.foreground).child(this.task ? `Starting ${this.task.title}` : "New session"))
      .child(this.task
        ? div().flex_1().text_color(t.muted).child(this.busy ? "Choosing a space, agent, and layout…" : "Ready to launch")
        : Textarea.new(this.input).flex_1().p(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_color(t.foreground))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).child(this.error)))
      .child(h_flex().justify_end().gap(10)
        .child(div().cursor_pointer().text_color(t.muted).child("Cancel").on_click(() => { if (!this.busy) closeOverlay(p.overlay); }))
        .when(!this.task || Boolean(this.error), el => el.child(div().cursor_pointer().px(12).py(7).rounded(7).bg(t.solid).text_color(t.solid_foreground).child(this.busy ? "Starting…" : "Start").on_click((_e, cx) => this.start(cx)))));
  }
}
