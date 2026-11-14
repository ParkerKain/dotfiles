import { View, div } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea } from "gpui-base";
import { closeOverlay, exec, focused, hc, home, knownAgents, nextCommand, openOverlay, panes, props, run, spaces, terminals, theme } from "herdr";

const REPOS = `${home()}/Documents/internal/repos`;
const VAULT = `${REPOS}/devclarity-vault`;
const schema = JSON.stringify({
  type: "object", additionalProperties: false,
  properties: {
    folder: { type: "string" },
    space: { type: "string", enum: ["current", "existing", "new"] },
    space_name: { type: "string" },
    tab_name: { type: "string" },
    split: { type: "string", enum: ["none", "right", "down"] }
  },
  required: ["folder", "space", "space_name", "tab_name", "split"]
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
    this.agent = "claude";
    this.busy = false;
    this.error = "";
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.input = TextareaState.new({ value: this.text, placeholder: "What do you want to work on?", rows: 4 });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; cx.notify(); });
    if (!task) this.input.focus();
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "start") this.start(cx);
        if (command === "toggle-agent") this.toggleAgent(cx);
      }
    });
    if (task) cx.timer.after(0, cx => this.start(cx));
  }

  toggleAgent(cx) {
    if (this.busy || this.task) return;
    this.agent = this.agent === "claude" ? "codex" : "claude";
    this.input.focus();
    cx.notify();
  }

  start(cx) {
    if (this.busy || !this.text.trim()) return;
    this.busy = true;
    this.error = "";
    const request = this.text.trim();
    const selectedAgent = this.agent;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const plan = await this.plan(request);
        await this.launch(plan, request, selectedAgent, cx);
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
    const folder = plan.folder || task?.folder || current?.cwd || VAULT;
    if (!folder.startsWith(`${home()}/`)) throw new Error("Session folder must be under your home directory.");
    const exists = await exec("test", ["-d", folder]);
    if (exists.code !== 0) throw new Error(`Folder does not exist: ${folder}`);
    return { ...plan, folder };
  }

  async launch(plan, request, selectedAgent, cx) {
    const matches = spaces().filter(s => !s.machine && s.folder === plan.folder);
    const target = plan.space === "existing" ? matches[0] : plan.space === "current" ? spaces().find(s => s.id === focused()?.space && !s.machine && s.folder === plan.folder) : null;
    const agents = await knownAgents();
    const agent = agents.find(a => a.installed && (a.key?.toLowerCase() === selectedAgent || a.name?.toLowerCase().includes(selectedAgent)));
    if (!agent) throw new Error(`${selectedAgent} is not installed in Herdr.`);
    const tabName = cleanName(this.task?.title || plan.tab_name, "New session");
    const argv = this.task?.slug && selectedAgent === "claude" ? [...agent.run, "-n", this.task.slug] : agent.run;
    const args = { name: tabName, folder: plan.folder, argv, task: request };
    const before = new Set(terminals().map(t => t.address));
    if (target) run("tab.new", { ...args, space: target.id });
    else run("space.new", { name: cleanName(plan.space_name, plan.folder.split("/").pop()), folder: plan.folder, tab: tabName, argv, task: request, machine: "" });
    if (this.task?.ref) await this.tag(before, argv[0], this.task.ref, cx);
    if (plan.split !== "none") run("pane.split", { direction: plan.split });
  }

  // Label the agent terminal this launch just made with its task, so the Tasks panel can
  // show the task as active while the session lives. Waits up to 10s for it to appear.
  async tag(before, program, ref, cx) {
    for (let i = 0; i < 40; i++) {
      const created = terminals().find(t => !before.has(t.address) && (!t.argv?.length || t.argv.includes(program)));
      if (created) { await hc(["label", created.address, `ops-task=${ref}`]).catch(() => null); return; }
      await cx.sleep(250);
    }
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    return v_flex().id("session-launcher").track_focus(this.handle).w_full().h_full().overflow_hidden().p(18).gap(12).bg(t.popover)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && !this.busy) { closeOverlay(p.overlay); cx.stop_propagation(); }
        if (e.key.toLowerCase() === "a" && e.modifiers.platform && e.modifiers.shift) { this.toggleAgent(cx); cx.stop_propagation(); }
        if (e.key.toLowerCase() === "s" && e.modifiers.platform && e.modifiers.shift) { this.start(cx); cx.stop_propagation(); }
      })
      .child(div().flex_shrink_0().text_size(17).font_semibold().text_color(t.foreground).child(this.task ? `Starting ${this.task.title}` : "New session"))
      .child(this.task
        ? div().flex_1().min_h(0).text_color(t.muted).child(this.busy ? "Choosing a space, agent, and layout…" : "Ready to launch")
        : Textarea.new(this.input).flex_1().min_h(0).p(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_color(t.foreground))
      .when(!this.task, el => el.child(h_flex().flex_shrink_0().flex_wrap().items_center().gap(8)
        .child(div().text_size(11).text_color(t.dim).child("Agent"))
        .child(div().cursor_pointer().px(9).py(4).rounded(6).bg(this.agent === "claude" ? t.selected : t.raised).text_color(this.agent === "claude" ? t.foreground : t.muted).child("Claude").on_click((_e, cx) => { if (this.agent !== "claude") this.toggleAgent(cx); }))
        .child(div().cursor_pointer().px(9).py(4).rounded(6).bg(this.agent === "codex" ? t.selected : t.raised).text_color(this.agent === "codex" ? t.foreground : t.muted).child("Codex").on_click((_e, cx) => { if (this.agent !== "codex") this.toggleAgent(cx); }))
        .child(div().text_size(11).text_color(t.dim).child("⌘⇧A switch agent · ⌘⇧S start · Enter adds a line"))))
      .when(Boolean(this.error), el => el.child(div().flex_shrink_0().text_color(t.blocked).child(this.error)))
      .child(h_flex().flex_shrink_0().justify_end().gap(10)
        .child(div().cursor_pointer().text_color(t.muted).child("Cancel").on_click(() => { if (!this.busy) closeOverlay(p.overlay); }))
        .when(!this.task || Boolean(this.error), el => el.child(div().cursor_pointer().px(12).py(7).rounded(7).bg(t.solid).text_color(t.solid_foreground).child(this.busy ? "Starting…" : "Start").on_click((_e, cx) => this.start(cx)))));
  }
}
