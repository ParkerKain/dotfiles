import { View, div } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea } from "gpui-base";
import { appHome, checking, closeOverlay, exec, focused, home, knownAgents, nextCommand, pickFolder, props, readTextFile, theme, window, writeTextFile } from "herdr";

const HELPER = `${appHome()}/mods/session-launcher/projects.py`;
const JOBS = `${home()}/.cache/herdr-app/session-launcher`;
// projects.py leaves the request and error here when a background start fails.
const FAILED = `${home()}/.cache/herdr-app/session-launcher-failed.json`;

const mac = () => window()?.platform !== "linux";

// Writes the clipboard's image to a PNG file. Returns false when it holds no image.
async function saveClipboardImage(path) {
  if (!mac()) {
    // Wayland (Omarchy): wl-paste lists the clipboard's types and writes the PNG.
    const result = await exec("/bin/sh", ["-c", 'wl-paste --list-types | grep -qx image/png && wl-paste --type image/png > "$0" && echo ok', path], { timeout: 10000 });
    return result.code === 0 && result.stdout.trim() === "ok";
  }
  const script = [
    "try",
    "  set png to (the clipboard as «class PNGf»)",
    "on error",
    "  return \"none\"",
    "end try",
    `set f to open for access (POSIX file ${JSON.stringify(path)}) with write permission`,
    "set eof f to 0",
    "write png to f",
    "close access f",
    "return \"ok\""
  ].join("\n");
  const result = await exec("osascript", ["-e", script], { timeout: 10000 });
  return result.code === 0 && result.stdout.trim() === "ok";
}

export default class SessionLauncher extends View {
  init(_props, cx) {
    const task = props()?.task;
    this.task = task ?? null;
    this.text = task?.prompt ?? "";
    // Tasks Play: optional extra instructions appended to the task's prompt.
    this.extra = "";
    this.agent = "claude";
    this.busy = false;
    this.error = "";
    this.origin = focused();
    this.route = null;
    this.override = null;
    this.routing = false;
    this.revision = 0;
    this.pendingRoute = null;
    // Pasted images: "[Image #N]" chip text -> saved PNG path.
    this.images = new Map();
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.input = TextareaState.new({ value: task ? "" : this.text, placeholder: task ? "Anything to add to the prompt? (optional)" : "What do you want to work on?", rows: 4 });
    this.input.on("change", (_e, cx) => { if (task) this.extra = this.input.value(); else this.text = this.input.value(); this.error = ""; this.scheduleRoute(cx); cx.notify(); });
    this.input.on("paste_other", (_e, cx) => this.pasteImage(cx));
    this.input.focus();
    if (!checking() && this.text.trim()) this.scheduleRoute(cx);
    if (!checking()) {
      // Usually cached by Herdr. Fetching now keeps Start from waiting on the agent check.
      this.agents = knownAgents().catch(() => null);
      if (!task) cx.spawn(async cx => this.restoreFailed(cx));
      // The machine's default folder (vault on the work Mac, Documents on Omarchy) and starting agent.
      cx.spawn(async cx => {
        const r = await exec("python3", [HELPER, "default"], { timeout: 10000 }).catch(() => null);
        let machine = null;
        try { machine = JSON.parse(r?.stdout ?? ""); } catch { /* keep the built-in defaults */ }
        if (machine?.name) this.defaultName = machine.name;
        // Omarchy starts on Codex, where it's signed in. Only before anything is chosen by hand.
        if (machine?.agent && machine.agent !== this.agent && !this.agentTouched && ["claude", "codex"].includes(machine.agent)) this.agent = machine.agent;
        cx.notify();
      });
    }
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "start") this.start(cx);
        if (command === "toggle-agent") this.toggleAgent(cx);
      }
    });
  }

  pasteImage(cx) {
    if (this.busy) return;
    cx.spawn(async cx => {
      const dir = `${home()}/.cache/herdr-app/pasted-images`;
      const path = `${dir}/${Date.now()}.png`;
      await exec("mkdir", ["-p", dir]);
      if (!(await saveClipboardImage(path))) { this.error = "The clipboard has no image to paste."; cx.notify(); return; }
      const label = `[Image #${this.images.size + 1}]`;
      this.images.set(label, path);
      this.input.replace_with_token({ id: label, text: label, label });
      this.error = "";
      cx.notify();
    });
  }

  // Swaps each image chip still in the text for the image's file path, so the agent can open it.
  withImages(text) {
    let out = text;
    for (const [label, path] of this.images) out = out.split(label).join(`${label} (${path})`);
    return out;
  }

  toggleAgent(cx) {
    if (this.busy) return;
    this.agentTouched = true;
    this.agent = this.agent === "claude" ? "codex" : "claude";
    this.input.focus();
    cx.notify();
  }

  request() {
    const text = this.withImages(this.text.trim());
    const extra = this.task ? this.withImages(this.extra.trim()) : "";
    return extra ? `${text}\n\nAdditional instructions from me:\n${extra}` : text;
  }

  scheduleRoute(cx) {
    this.revision++;
    this.route = null;
    if (this.routing || this.busy) return;
    this.routing = true;
    cx.spawn(async cx => {
      try {
        for (;;) {
          const revision = this.revision;
          await cx.sleep(900);
          if (this.busy) break;
          if (revision !== this.revision) continue;
          if (!this.text.trim()) break;
          try {
            const plan = await this.resolveRoute(this.request(), revision);
            if (this.busy) break;
            if (revision !== this.revision) continue;
            this.route = plan;
            this.error = "";
          } catch (error) {
            if (this.busy) break;
            if (revision !== this.revision) continue;
            this.error = String(error?.message ?? error);
          }
          break;
        }
      } finally { this.routing = false; cx.notify(); }
    });
    cx.notify();
  }

  resolveRoute(request, revision) {
    if (this.pendingRoute?.revision === revision) return this.pendingRoute.promise;
    const pending = { revision, promise: this.plan(request).finally(() => {
      if (this.pendingRoute === pending) this.pendingRoute = null;
    }) };
    this.pendingRoute = pending;
    return pending.promise;
  }

  changeFolder(cx) {
    if (this.busy) return;
    cx.spawn(async cx => {
      try {
        const folder = await pickFolder({ prompt: "Use for this session" });
        if (folder && !this.busy) { this.override = folder; this.scheduleRoute(cx); }
      } catch (error) { this.error = String(error?.message ?? error); cx.notify(); }
    });
  }

  // What projects.py needs to route this request: everything but the agent's command.
  payload(request) {
    const origin = this.origin ?? focused();
    const task = this.task && { folder: this.task.folder, title: this.task.title, slug: this.task.slug, ref: this.task.ref };
    return { request, override: this.override, task: task || null, origin: origin ? { space: origin.space, cwd: origin.cwd } : null };
  }

  // Closes the window right away. projects.py routes and launches in a detached process, because
  // closing the overlay ends this script and any work it is still doing.
  start(cx) {
    if (this.busy || !this.text?.trim()) return;
    this.busy = true;
    this.error = "";
    const selectedAgent = this.agent;
    // A non-null route is always current: scheduleRoute clears it on every edit or folder change.
    const job = { ...this.payload(this.request()), plan: this.route };
    cx.notify();
    cx.spawn(async cx => {
      try {
        const agents = (await this.agents) ?? await knownAgents();
        const agent = agents.find(a => a.installed && (a.key?.toLowerCase() === selectedAgent || a.name?.toLowerCase().includes(selectedAgent)));
        if (!agent) throw new Error(`${selectedAgent} is not installed in Herdr.`);
        job.agent = { key: selectedAgent, run: agent.run };
        const path = `${JOBS}/${Date.now()}.json`;
        await exec("mkdir", ["-p", JOBS]);
        await writeTextFile(path, JSON.stringify(job), null);
        const started = await exec("/bin/sh", ["-c", 'nohup python3 "$0" start "$1" >>"$2" 2>&1 </dev/null &', HELPER, path, `${JOBS}/start.log`]);
        if (started.code !== 0) throw new Error(started.stderr.trim() || "Could not start the session in the background.");
        closeOverlay(props().overlay);
      } catch (error) {
        this.error = String(error?.message ?? error);
        this.busy = false;
        cx.notify();
      }
    });
  }

  async plan(request) {
    const result = await exec("python3", [HELPER, "plan", JSON.stringify(this.payload(request))], { timeout: 150000 });
    if (result.code !== 0) throw new Error(result.stderr.trim() || "Session planning failed.");
    return JSON.parse(result.stdout);
  }

  // Brings back the request and error from a background start that failed after the window closed.
  async restoreFailed(cx) {
    const saved = await readTextFile(FAILED);
    if (!saved) return;
    await exec("rm", ["-f", FAILED]);
    const failed = JSON.parse(saved);
    if (!failed.task && failed.request && !this.text.trim()) {
      this.text = failed.request;
      this.input.set_value(failed.request);
      this.scheduleRoute(cx);
    }
    this.error = `The last session didn't start: ${failed.error}`;
    cx.notify();
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const canStart = !this.busy && Boolean(this.text.trim());
    const choosing = !this.route && (this.routing || this.busy) && Boolean(this.text.trim() || this.busy);
    return v_flex().id("session-launcher").track_focus(this.handle).w_full().h_full().overflow_hidden().p(18).gap(12).bg(t.popover)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && !this.busy) { closeOverlay(p.overlay); cx.stop_propagation(); }
        if (e.key.toLowerCase() === "a" && e.modifiers.platform && e.modifiers.shift) { this.toggleAgent(cx); cx.stop_propagation(); }
        if (e.key.toLowerCase() === "s" && e.modifiers.platform && e.modifiers.shift) { this.start(cx); cx.stop_propagation(); }
        // Ctrl+V pastes an image, as in Claude Code. ⌘V reaches pasteImage through the textarea's paste_other.
        // On Linux Ctrl+V is the textarea's own paste, which already reaches paste_other.
        if (mac() && e.key.toLowerCase() === "v" && e.modifiers.control && !e.modifiers.platform) { this.pasteImage(cx); cx.stop_propagation(); }
      })
      .child(div().flex_shrink_0().text_size(17).font_semibold().text_color(t.foreground).child(this.task ? `Starting ${this.task.title}` : "New session"))
      // Keep padding outside the native editor so its scroll viewport matches its visible height.
      .child(v_flex().flex_1().min_h(0).p(10).rounded(8).border_1().border_color(t.input).bg(t.background)
        .child(Textarea.new(this.input).flex_1().min_h(0).w_full().text_color(t.foreground)))
      .child(h_flex().flex_shrink_0().flex_wrap().items_center().gap(8)
        .child(div().text_size(11).text_color(t.dim).child("Agent"))
        .child(div().cursor_pointer().px(9).py(4).rounded(6).bg(this.agent === "claude" ? t.selected : t.raised).text_color(this.agent === "claude" ? t.foreground : t.muted).child("Claude").on_click((_e, cx) => { if (this.agent !== "claude") this.toggleAgent(cx); }))
        .child(div().cursor_pointer().px(9).py(4).rounded(6).bg(this.agent === "codex" ? t.selected : t.raised).text_color(this.agent === "codex" ? t.foreground : t.muted).child("Codex").on_click((_e, cx) => { if (this.agent !== "codex") this.toggleAgent(cx); }))
        .child(div().text_size(11).text_color(t.dim).child(mac() ? "⌘⇧A switch agent · ⌘⇧S start · ⌘V or ⌃V pastes an image" : "Ctrl+Shift+A switch agent · Ctrl+Shift+S start · Ctrl+V pastes an image")))
      .child(v_flex().flex_shrink_0().gap(4)
        .child(h_flex().items_center().gap(8)
          .child(div().flex_1().text_size(12).text_color(t.foreground).child(choosing ? "Choosing destination…" : this.route ? `Destination · ${this.route.project_name}` : `Destination · ${this.defaultName ?? "the default folder"} by default`))
          .child(div().cursor_pointer().text_size(12).text_color(t.accent).child("Change folder").on_click((_e, cx) => this.changeFolder(cx)))
          .when(Boolean(this.override), el => el.child(div().cursor_pointer().text_size(12).text_color(t.accent).child("Auto").on_click((_e, cx) => { if (!this.busy) { this.override = null; this.scheduleRoute(cx); } }))))
        .when(Boolean(this.route), el => el.child(div().text_size(11).text_color(t.muted).child(this.route.reason))))
      .when(Boolean(this.error), el => el.child(div().flex_shrink_0().text_color(t.blocked).child(this.error)))
      .child(h_flex().flex_shrink_0().justify_end().gap(10)
        .child(div().cursor_pointer().text_color(t.muted).child("Cancel").on_click(() => { if (!this.busy) closeOverlay(p.overlay); }))
        .child(div().cursor_pointer().px(12).py(7).rounded(7).bg(canStart ? t.solid : t.raised).text_color(canStart ? t.solid_foreground : t.muted).child(this.busy ? "Starting…" : this.error ? "Retry" : "Start").on_click((_e, cx) => this.start(cx))));
  }
}
