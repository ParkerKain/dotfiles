import { View, div } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea } from "gpui-base";
import { appHome, checking, closeOverlay, exec, focused, home, knownAgents, nextCommand, pickFolder, props, readTextFile, theme, window as appWindow, writeTextFile } from "herdr";

// Playground copy of session-launcher. Routing, launching and keys are the original's. Only the
// look changes: candidate repo chips while routing, a stepped effort bar, and a lift on Start.
const HELPER = `${appHome()}/mods/pg-launcher/projects.py`;
// The same job folder and failure file as session-launcher, so either launcher restores a failed start.
const JOBS = `${home()}/.cache/herdr-app/session-launcher`;
// projects.py leaves the request and error here when a background start fails.
const FAILED = `${home()}/.cache/herdr-app/session-launcher-failed.json`;

const mac = () => appWindow()?.platform !== "linux";

// Wait after the last keystroke before asking the router.
const ROUTE_DEBOUNCE = 400;
// How long the card takes to lift and fade before the overlay closes.
const LIFT_MS = 350;
// Most candidate chips shown at once (the router's pick, an override and the default always show).
const MAX_CHIPS = 6;
// Words too common to say anything about which repo owns a request.
const STOP = new Set(["the", "and", "for", "with", "this", "that", "from", "into", "what", "want", "make", "add",
  "fix", "new", "use", "can", "you", "please", "should", "would", "need", "about", "some", "all", "out", "get", "set"]);

// Scales a color's alpha, keeping any alpha it already has (layouts often set #rrggbbaa).
const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  return m ? "#" + m[1] + Math.round(a * (m[2] ? parseInt(m[2], 16) / 255 : 1) * 255).toString(16).padStart(2, "0") : hex;
};
const baseName = folder => String(folder ?? "").replace(/\/+$/, "").split("/").pop();

// What changed between two strings: the inserted text and how many characters were removed.
function diff(prev, next) {
  let a = 0;
  while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
  let b = 0;
  const limit = Math.min(prev.length, next.length) - a;
  while (b < limit && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
  return { at: a, inserted: next.slice(a, next.length - b), removed: prev.length - a - b };
}

// True when an edit looks like the textarea's own Tab indent (a tab or a run of spaces in one go).
// Tab picks the next repo here, so that edit is undone.
const isIndent = (prev, next) => {
  const d = diff(prev, next);
  return d.removed === 0 && /^(\t| {2,8})$/.test(d.inserted);
};

// Models the launcher offers for each agent, in the order their number keys pick them.
// The first entry in each list is the default, and both default to medium effort.
// Claude uses the CLI's family aliases, which always start the newest model in that family.
// Codex's list is replaced by codexModels() from Codex's own model cache when that file reads.
const MODELS = {
  claude: [
    { id: "opus", name: "Opus" },
    { id: "sonnet", name: "Sonnet" },
    { id: "fable", name: "Fable" },
    { id: "haiku", name: "Haiku" }
  ],
  codex: [
    { id: "gpt-6.2-sol", name: "Sol 6.2" },
    { id: "gpt-6.2-astra", name: "Astra 6.2" },
    { id: "gpt-6.1-terra", name: "Terra 6.1" },
    { id: "gpt-6-luna", name: "Luna 6", efforts: ["low", "medium", "high", "xhigh", "max"] }
  ]
};
const EFFORTS = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["low", "medium", "high", "xhigh", "max", "ultra"]
};
const DEFAULT_EFFORT = "medium";
const CODEX_CACHE = () => `${home()}/.codex/models_cache.json`;
const defaultChoice = (agent, models = MODELS[agent]) => {
  const model = models[0];
  const efforts = effortsFor(agent, model);
  return { model, effort: efforts.includes(DEFAULT_EFFORT) ? DEFAULT_EFFORT : efforts[0] };
};
const defaultModels = () => ({ claude: defaultChoice("claude"), codex: defaultChoice("codex") });
const effortsFor = (agent, model) => model.efforts ?? EFFORTS[agent];

// The newest model in each Codex family (Sol, Astra, Terra, Luna), in Codex's own menu order.
// Returns null when the cache is missing or unreadable, so the built-in list stays.
function codexModels(text) {
  let models;
  try { models = JSON.parse(text ?? "")?.models; } catch { return null; }
  if (!Array.isArray(models)) return null;
  const families = new Set();
  const list = models
    .filter(m => m?.slug && m.visibility === "list")
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
    .filter(m => {
      const family = m.slug.split("-").at(-1);
      if (families.has(family)) return false;
      families.add(family);
      return true;
    })
    .slice(0, 9)
    .map(m => {
      const named = /^gpt-([\d.]+)-([a-z]+)$/i.exec(m.slug);
      const efforts = (m.supported_reasoning_levels ?? []).map(l => l?.effort).filter(Boolean);
      return { id: m.slug, name: named ? `${named[2][0].toUpperCase()}${named[2].slice(1)} ${named[1]}` : (m.display_name ?? m.slug),
        ...(efforts.length ? { efforts } : {}) };
    });
  return list.length ? list : null;
}

// The flags that start each agent CLI on the chosen model and effort.
function modelFlags(agent, choice) {
  if (agent === "claude") return ["--model", choice.model.id, "--effort", choice.effort];
  if (agent === "codex") return ["-m", choice.model.id, "-c", `model_reasoning_effort=${choice.effort}`];
  return [];
}

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
    // Model and effort per agent, so switching agents keeps each one's choice.
    this.models = defaultModels();
    this.modelLists = { ...MODELS };
    // Model picker step: null when closed, then "model", then "effort".
    this.picking = null;
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
    // Candidate chips: the repos projects.py can route to, the router's own pick for the current
    // request (kept so Tab can come back to it), and the default folder.
    this.catalog = [];
    this.autoRoute = null;
    this.defaultFolder = null;
    this.leaving = false;
    this.lastValue = this.input.value();
    this.lastContent = this.input.content();
    this.input.on("change", (_e, cx) => {
      const value = this.input.value();
      if (value === this.lastValue) return;
      // Tab inside the textarea indents before the key reaches this view. Undo it and pick instead.
      if (!this.busy && !this.picking && isIndent(this.lastValue, value) && this.candidates().length > 1) {
        const d = diff(this.lastValue, value);
        const sel = this.input.selected_range();
        const back = n => (n > d.at ? Math.max(d.at, n - d.inserted.length) : n);
        this.input.set_value(this.lastContent);
        this.input.set_selected_range({ start: back(sel.start), end: back(sel.end) });
        this.cyclePick(1, cx);
        return;
      }
      this.lastValue = value;
      this.lastContent = this.input.content();
      if (task) this.extra = value; else this.text = value;
      this.error = "";
      this.scheduleRoute(cx);
      cx.notify();
    });
    this.input.on("paste_other", (_e, cx) => this.pasteImage(cx));
    this.input.focus();
    if (!checking() && this.text.trim()) this.scheduleRoute(cx);
    if (!checking()) {
      // Usually cached by Herdr. Fetching now keeps Start from waiting on the agent check.
      this.agents = knownAgents().catch(() => null);
      if (!task) cx.spawn(async cx => this.restoreFailed(cx));
      cx.spawn(async cx => this.loadCodexModels(cx));
      // The machine's default folder (vault on the work Mac, Documents on Omarchy) and starting agent.
      cx.spawn(async cx => {
        const r = await exec("python3", [HELPER, "default"], { timeout: 10000 }).catch(() => null);
        let machine = null;
        try { machine = JSON.parse(r?.stdout ?? ""); } catch { /* keep the built-in defaults */ }
        if (machine?.name) this.defaultName = machine.name;
        if (machine?.folder) this.defaultFolder = machine.folder;
        // Omarchy starts on Codex, where it's signed in. Only before anything is chosen by hand.
        if (machine?.agent && machine.agent !== this.agent && !this.agentTouched && !this.busy && ["claude", "codex"].includes(machine.agent)) this.agent = machine.agent;
        cx.notify();
      });
      cx.spawn(async cx => {
        const r = await exec("python3", [HELPER, "catalog"], { timeout: 10000 }).catch(() => null);
        try { this.catalog = JSON.parse(r?.stdout ?? "[]"); } catch { this.catalog = []; }
        cx.notify();
      });
    }
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "start") this.start(cx);
        if (command === "toggle-agent") this.toggleAgent(cx);
        if (command === "toggle-model") this.toggleModelPicker(cx);
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
    this.closeModelPicker(cx);
  }

  // Swaps in Codex's current model list. Keeps a model already picked by hand if it's still listed.
  async loadCodexModels(cx) {
    const list = codexModels(await readTextFile(CODEX_CACHE()).catch(() => null));
    if (!list) return;
    this.modelLists = { ...(this.modelLists ?? MODELS), codex: list };
    const picked = this.codexTouched && list.find(m => m.id === this.models.codex.model.id);
    if (picked) {
      const efforts = effortsFor("codex", picked);
      this.models.codex = { model: picked, effort: efforts.includes(this.models.codex.effort) ? this.models.codex.effort : defaultChoice("codex", [picked]).effort };
    } else {
      this.models.codex = defaultChoice("codex", list);
    }
    cx.notify();
  }

  modelList(agent = this.agent) {
    return (this.modelLists ?? MODELS)[agent];
  }

  choice() {
    this.models ??= defaultModels();
    return this.models[this.agent] ?? null;
  }

  // Opens the numbered model list. Focus moves off the prompt so number keys pick instead of typing.
  toggleModelPicker(cx) {
    if (this.busy) return;
    if (this.picking) { this.closeModelPicker(cx); return; }
    this.picking = "model";
    this.handle.focus();
    cx.notify();
  }

  closeModelPicker(cx) {
    this.picking = null;
    this.input.focus();
    cx.notify();
  }

  // Number keys pick a model, then its effort. Returns true when the key was used.
  pickNumber(n, cx) {
    const choice = this.choice();
    if (!this.picking || !choice) return false;
    if (this.picking === "model") {
      const model = this.modelList()[n - 1];
      if (!model) return false;
      if (this.agent === "codex") this.codexTouched = true;
      const efforts = effortsFor(this.agent, model);
      this.models[this.agent] = { model, effort: efforts.includes(choice.effort) ? choice.effort : defaultChoice(this.agent, [model]).effort };
      this.picking = "effort";
      cx.notify();
      return true;
    }
    const effort = effortsFor(this.agent, choice.model)[n - 1];
    if (!effort) return false;
    choice.effort = effort;
    if (this.agent === "codex") this.codexTouched = true;
    this.closeModelPicker(cx);
    return true;
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
          await cx.sleep(ROUTE_DEBOUNCE);
          if (this.busy) break;
          if (revision !== this.revision) continue;
          if (!this.text.trim()) break;
          // Tab back to the router's own pick restores its cached route; nothing left to ask.
          if (this.route) break;
          try {
            const request = this.request();
            const plan = await this.resolveRoute(request, revision);
            if (this.busy) break;
            if (revision !== this.revision) continue;
            this.route = plan;
            if (!this.override) this.autoRoute = { request, route: plan };
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

  // The repos worth showing for this request: a cheap word match against the catalog, plus the
  // router's pick, any override and the default folder. The router alone decides the destination.
  candidates() {
    const request = this.request();
    if (!request.trim()) return [];
    const words = [...new Set(request.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [])].filter(w => !STOP.has(w));
    const scored = (this.catalog ?? []).map(p => {
      const name = p.name.toLowerCase();
      const about = String(p.description ?? "").toLowerCase();
      let score = 0;
      for (const w of words) score += name === w || name.includes(w) || (name.length > 3 && w.includes(name)) ? 3 : about.includes(w) ? 1 : 0;
      return { p, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.p);
    const auto = this.autoRoute?.request === request ? this.autoRoute.route.folder : null;
    const must = [auto, this.route?.folder, this.override, this.defaultFolder].filter(Boolean);
    const list = [];
    const add = folder => {
      if (!folder || list.some(p => p.folder === folder)) return;
      const known = (this.catalog ?? []).find(p => p.folder === folder);
      list.push(known ?? { name: baseName(folder), folder });
    };
    for (const p of scored) { if (list.length >= MAX_CHIPS - must.length) break; add(p.folder); }
    for (const folder of must) add(folder);
    return list;
  }

  // Tab and Shift+Tab: move the pick along the chips. The original's override path then plans it.
  cyclePick(direction, cx) {
    if (this.busy) return;
    const list = this.candidates();
    if (list.length < 2) return;
    this.tabAt = Date.now();
    const picked = this.override ?? this.route?.folder;
    const at = list.findIndex(p => p.folder === picked);
    const next = at < 0 ? list[direction > 0 ? 0 : list.length - 1] : list[(at + direction + list.length) % list.length];
    this.pickChip(next.folder, cx);
  }

  pickChip(folder, cx) {
    if (this.busy) return;
    const auto = this.autoRoute?.request === this.request() ? this.autoRoute.route : null;
    if (auto && auto.folder === folder) {
      // Back on the router's own pick: drop the override and reuse its route.
      this.override = null;
      this.revision++;
      this.route = auto;
      this.error = "";
      cx.notify();
      return;
    }
    if (this.override === folder && this.route?.folder === folder) return;
    this.override = folder;
    this.scheduleRoute(cx);
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
    // The card lifts and fades while the job is written; the overlay closes once both are done.
    this.leaving = true;
    const liftStarted = Date.now();
    const selectedAgent = this.agent;
    // A non-null route is always current: scheduleRoute clears it on every edit or folder change.
    const job = { ...this.payload(this.request()), plan: this.route };
    cx.notify();
    cx.spawn(async cx => {
      try {
        const agents = (await this.agents) ?? await knownAgents();
        const agent = agents.find(a => a.installed && (a.key?.toLowerCase() === selectedAgent || a.name?.toLowerCase().includes(selectedAgent)));
        if (!agent) throw new Error(`${selectedAgent} is not installed in Herdr.`);
        const choice = this.models?.[selectedAgent] ?? defaultModels()[selectedAgent];
        job.agent = { key: selectedAgent, run: [...agent.run, ...(choice ? modelFlags(selectedAgent, choice) : [])] };
        const path = `${JOBS}/${Date.now()}.json`;
        await exec("mkdir", ["-p", JOBS]);
        await writeTextFile(path, JSON.stringify(job), null);
        const started = await exec("/bin/sh", ["-c", 'nohup python3 "$0" start "$1" >>"$2" 2>&1 </dev/null &', HELPER, path, `${JOBS}/start.log`]);
        if (started.code !== 0) throw new Error(started.stderr.trim() || "Could not start the session in the background.");
        const rest = LIFT_MS - (Date.now() - liftStarted);
        if (rest > 0) await cx.sleep(rest);
        closeOverlay(props().overlay);
      } catch (error) {
        this.error = String(error?.message ?? error);
        this.busy = false;
        this.leaving = false;
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

  // Sets the effort from a click on the bar outside the picker.
  setEffort(effort, cx) {
    const choice = this.choice();
    if (this.busy || !choice) return;
    choice.effort = effort;
    if (this.agent === "codex") this.codexTouched = true;
    cx.notify();
  }

  // Effort as a stepped bar: one segment per level (five for Claude), filled up to the choice.
  // While picking, the segments are larger and numbered for the number keys.
  effortBar(t, choice, numbered) {
    const efforts = effortsFor(this.agent, choice.model);
    const at = efforts.indexOf(choice.effort);
    return h_flex().id("effort-bar").flex_shrink_0().items_center().gap(3).children(efforts.map((effort, i) => {
      const on = i <= at;
      return h_flex().id(`effort-${i}`).relative().cursor_pointer().items_center().justify_center().overflow_hidden()
        .w(numbered ? 26 : 14).h(numbered ? 18 : 8).rounded(numbered ? 4 : 2).bg(t.raised)
        .hover(s => s.bg(t.hover))
        .child(div().id(`effort-fill-${i}`).absolute().top(0).left(0).size_full().bg(i === at ? t.accent : alpha(t.accent, 0.55))
          .opacity(on ? 1 : 0).transition("opacity", { duration: 160, delay: on ? i * 35 : 0, easing: "ease-out" }))
        .when(numbered, el => el.child(div().relative().text_size(10).font_semibold()
          .text_color(on ? t.accent_foreground : t.muted).child(String(i + 1))))
        .on_click((_e, cx) => { if (this.picking === "effort") this.pickNumber(i + 1, cx); else this.setEffort(effort, cx); });
    }));
  }

  // The current model and effort, and while picking, the numbered options for the current step.
  modelRow(t) {
    const choice = this.choice();
    const row = h_flex().flex_shrink_0().flex_wrap().items_center().gap(8)
      .child(div().text_size(11).text_color(t.dim).child("Model"));
    if (!choice) return row;
    const hint = text => div().text_size(11).text_color(t.dim).child(text);
    const chip = (n, label, selected) => div().cursor_pointer().px(9).py(4).rounded(6)
      .bg(selected ? t.selected : t.raised).text_color(selected ? t.foreground : t.muted)
      .child(`${n} ${label}`).on_click((_e, cx) => { if (!this.busy) this.pickNumber(n, cx); });
    if (this.picking === "model") return row
      .children(this.modelList().map((model, i) => chip(i + 1, model.name, model.id === choice.model.id)))
      .child(hint("Press a number · Esc keeps it"));
    if (this.picking === "effort") return row
      .child(div().text_size(12).text_color(t.foreground).child(choice.model.name))
      .child(this.effortBar(t, choice, true))
      // The level's name shows only here, so the numbers mean something while choosing.
      .child(hint(`${choice.effort} · Press a number · Enter keeps it`));
    return row
      .child(div().cursor_pointer().px(9).py(4).rounded(6).bg(t.raised).text_color(t.foreground)
        .child(choice.model.name).on_click((_e, cx) => this.toggleModelPicker(cx)))
      .child(this.effortBar(t, choice, false))
      .child(hint(mac() ? "⌘⇧M change model" : "Ctrl+Shift+M change model"));
  }

  // The candidate repos as chips. They shimmer, out of step, while the router works, and the
  // repo it picked lights up. A Tab or click override lights at once while its tab is planned.
  chips(t) {
    const list = this.candidates();
    if (!list.length) return null;
    const picked = this.override ?? this.route?.folder ?? null;
    const pending = this.routing && !this.route;
    return h_flex().id("chips").flex_shrink_0().flex_wrap().items_center().gap(6)
      .children(list.map((p, i) => {
        const lit = p.folder === picked;
        const settled = lit && this.route?.folder === p.folder;
        const shimmer = pending && !lit;
        return h_flex().id(`chip-${i}`).relative().cursor_pointer().items_center().gap(6).px(9).py(4).rounded(999)
          .overflow_hidden().border_1().border_color(lit ? t.accent : alpha(t.border, 0.6)).bg(t.raised)
          .opacity(shimmer || lit || !picked ? 1 : 0.6)
          .when(shimmer, el => el.loop("opacity", { from: 0.3, to: 1, period: 1100 + i * 190 }))
          .child(div().id(`chip-glow-${i}`).absolute().top(0).left(0).size_full().bg(alpha(t.accent, 0.2))
            .opacity(lit ? 1 : 0).transition("opacity", { duration: 260, easing: "ease-out" }))
          .when(lit, el => el.child(div().id(`chip-dot-${i}`).relative().w(6).h(6).rounded(3).bg(t.accent)
            .when(!settled, d => d.loop("opacity", { from: 0.3, to: 1, period: 900 }))))
          .child(div().relative().text_size(12).text_color(lit ? t.foreground : t.muted).child(p.name))
          .on_click((_e, cx) => this.pickChip(p.folder, cx));
      }))
      .when(list.length > 1, el => el.child(div().text_size(11).text_color(t.dim).child("Tab picks another")));
  }

  destination() {
    if (this.route) return `Destination · ${this.route.project_name}`;
    if (this.override && (this.routing || this.busy)) return `Destination · ${baseName(this.override)} · planning the tab…`;
    if (this.routing || (this.busy && this.text.trim())) return "Routing…";
    return `Destination · ${this.defaultName ?? "the default folder"} by default`;
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const canStart = !this.busy && Boolean(this.text.trim());
    return v_flex().id("pg-launcher").track_focus(this.handle).w_full().h_full().overflow_hidden().bg(t.popover)
      .on_key_down((e, cx) => {
        if (this.picking && !e.modifiers.platform && !e.modifiers.control && /^[1-9]$/.test(e.key)) { if (this.pickNumber(Number(e.key), cx)) cx.stop_propagation(); return; }
        if (this.picking && (e.key === "escape" || e.key === "enter")) { this.closeModelPicker(cx); cx.stop_propagation(); return; }
        // Tab and Shift+Tab move the pick when they reach here (the textarea's indent path is in init).
        if (e.key === "tab" && !this.picking && !e.modifiers.platform && !e.modifiers.control && this.candidates().length > 1) {
          if (Date.now() - (this.tabAt ?? 0) > 80) this.cyclePick(e.modifiers.shift ? -1 : 1, cx);
          cx.stop_propagation();
          return;
        }
        if (e.key === "escape" && !this.busy) { closeOverlay(p.overlay); cx.stop_propagation(); }
        if (e.key.toLowerCase() === "m" && e.modifiers.platform && e.modifiers.shift) { this.toggleModelPicker(cx); cx.stop_propagation(); }
        if (e.key.toLowerCase() === "a" && e.modifiers.platform && e.modifiers.shift) { this.toggleAgent(cx); cx.stop_propagation(); }
        if (e.key.toLowerCase() === "s" && e.modifiers.platform && e.modifiers.shift) { this.start(cx); cx.stop_propagation(); }
        // Ctrl+V pastes an image, as in Claude Code. ⌘V reaches pasteImage through the textarea's paste_other.
        // On Linux Ctrl+V is the textarea's own paste, which already reaches paste_other.
        if (mac() && e.key.toLowerCase() === "v" && e.modifiers.control && !e.modifiers.platform) { this.pasteImage(cx); cx.stop_propagation(); }
      })
      // The card: everything inside lifts and fades on Start, then the overlay closes.
      .child(v_flex().id("card").relative().size_full().p(18).gap(12)
        .top(this.leaving ? -18 : 0).transition("top", { duration: LIFT_MS, easing: "ease-in" })
        .opacity(this.leaving ? 0 : 1).transition("opacity", { duration: LIFT_MS, easing: "ease-in" })
        // One line: a long Tasks Play title wrapped in the fixed-height dialog and squeezed the prompt to nothing.
        .child(div().flex_shrink_0().min_w(0).truncate().text_size(17).font_semibold().text_color(t.foreground).child(this.task ? `Starting ${this.task.title}` : "New session"))
        // Keep padding outside the native editor so its scroll viewport matches its visible height.
        // The minimum keeps the prompt clickable however much the rows below wrap.
        .child(v_flex().flex_1().min_h(72).p(10).rounded(8).border_1().border_color(t.input).bg(t.background)
          .child(Textarea.new(this.input).flex_1().min_h(0).w_full().text_color(t.foreground)))
        .when(this.candidates().length > 0, el => el.child(this.chips(t)))
        .child(h_flex().flex_shrink_0().flex_wrap().items_center().gap(8)
          .child(div().text_size(11).text_color(t.dim).child("Agent"))
          .child(div().cursor_pointer().px(9).py(4).rounded(6).bg(this.agent === "claude" ? t.selected : t.raised).text_color(this.agent === "claude" ? t.foreground : t.muted).child("Claude").on_click((_e, cx) => { this.agentTouched = true; if (this.agent !== "claude") this.toggleAgent(cx); }))
          .child(div().cursor_pointer().px(9).py(4).rounded(6).bg(this.agent === "codex" ? t.selected : t.raised).text_color(this.agent === "codex" ? t.foreground : t.muted).child("Codex").on_click((_e, cx) => { this.agentTouched = true; if (this.agent !== "codex") this.toggleAgent(cx); }))
          .child(div().text_size(11).text_color(t.dim).child(mac() ? "⌘⇧A switch agent · ⌘⇧S start · ⌘V or ⌃V pastes an image" : "Ctrl+Shift+A switch agent · Ctrl+Shift+S start · Ctrl+V pastes an image")))
        .child(this.modelRow(t))
        .child(v_flex().flex_shrink_0().gap(4)
          .child(h_flex().items_center().gap(8)
            .child(div().flex_1().text_size(12).text_color(t.foreground).child(this.destination()))
            .child(div().cursor_pointer().text_size(12).text_color(t.accent).child("Change folder").on_click((_e, cx) => this.changeFolder(cx)))
            .when(Boolean(this.override), el => el.child(div().cursor_pointer().text_size(12).text_color(t.accent).child("Auto").on_click((_e, cx) => { if (!this.busy) { this.override = null; this.scheduleRoute(cx); } }))))
          .when(Boolean(this.route), el => el.child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(this.route.reason))))
        .when(Boolean(this.error), el => el.child(div().flex_shrink_0().text_color(t.blocked).child(this.error)))
        .child(h_flex().flex_shrink_0().justify_end().gap(10)
          .child(div().cursor_pointer().text_color(t.muted).child("Cancel").on_click(() => { if (!this.busy) closeOverlay(p.overlay); }))
          .child(div().cursor_pointer().px(12).py(7).rounded(7).bg(canStart ? t.solid : t.raised).text_color(canStart ? t.solid_foreground : t.muted).child(this.busy ? "Starting…" : this.error ? "Retry" : "Start").on_click((_e, cx) => this.start(cx)))));
  }
}
