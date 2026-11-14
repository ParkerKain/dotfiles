// Scheduled agent jobs and lightweight hooks from parker-agent-kit/jobs.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, theme, run, shared, focused } from "herdr";

const HINTS = "jobs.hints";
// Jump labels, easiest keys first; past single letters, two-letter labels behind reserved prefixes.
const KEYS = "asdfghjklqwertyuiopzxcvbnm";
function labels(n) {
  let p = 0;
  while (KEYS.length - p + p * KEYS.length < n && p < KEYS.length) p++;
  const out = KEYS.slice(0, KEYS.length - p).split("").slice(0, n);
  for (const prefix of KEYS.slice(KEYS.length - p)) for (const k of KEYS) if (out.length < n) out.push(prefix + k);
  return out;
}

const cli = () => `${home()}/Documents/internal/repos/parker-agent-kit/jobs/job`;
// One script per hook; each answers `status` with {ok, hooks: [...]} and takes check/install/uninstall.
const HOOK_SCRIPTS = () => ["mail_hook.py", "meeting_hook.py"].map((f) => `${home()}/Documents/internal/repos/parker-agent-kit/jobs/${f}`);
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATE = {
  working: ["Working", "working"], blocked: ["Needs you", "blocked"], done: ["Done", "done"],
  idle: ["Idle", "idle"], error: ["Error", "blocked"], ended: ["Closed", "dim"],
  gone: ["Closed", "dim"], "no status": ["Not started", "blocked"],
};

function clock(ts) {
  const d = new Date(ts * 1000);
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

function day(ts, now) {
  const d = new Date(ts * 1000), n = new Date(now);
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((midnight(d) - midnight(n)) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return DAYS[d.getDay() || 7];
}

function schedule(job) {
  if (!job.times.length) return "Manual";
  const times = job.times.map((t) => {
    const [h, m] = t.split(":").map(Number);
    return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "a" : "p"}`;
  }).join(", ");
  const d = job.weekdays;
  const days = !d.length ? "daily" : d.join() === "1,2,3,4,5" ? "weekdays" : d.map((x) => DAYS[x]).join(" ");
  return `${times} ${days}`;
}

export default class Jobs extends View {
  init(_props, cx) {
    this.jobs = []; this.hooks = []; this.error = null; this.loading = false; this.starting = null;
    this.handle = cx.focus_handle();
    this.hinting = false; this.typed = ""; this.picked = null; this.hintMap = [];
    // Opened by the hint key itself: a stamp from the last two seconds means start labelled.
    this.seenHints = shared(HINTS);
    if (this.seenHints && Date.now() - this.seenHints < 2000) cx.timer.after(0, cx => { this.startHints(); cx.notify(); });
    this.load(cx);
    cx.timer.every(60000, (cx) => this.load(cx));
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    // Show the spinner for at least 600ms; notify on the next tick since load can run from render.
    this.spinUntil = Date.now() + 600; cx.timer.after(0, cx => cx.notify());
    cx.spawn(async (cx) => {
      try {
        const r = await exec(cli(), ["status"], { timeout: 20000 });
        let data;
        try { data = JSON.parse(r.stdout); } catch { throw new Error(r.stderr.trim().split("\n").pop() || `job status exited ${r.code}`); }
        if (!data.ok) throw new Error(r.stderr.trim() || "job status failed");
        // A failing hook script shows its error without hiding the other hooks.
        const hooks = [], errors = [];
        for (const script of HOOK_SCRIPTS()) {
          const h = await exec(script, ["status"], { timeout: 20000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
          let out = null;
          try { out = JSON.parse(h.stdout); } catch { /* reported below */ }
          if (out?.ok) hooks.push(...out.hooks.map((hook) => ({ ...hook, script })));
          else errors.push(`${script.split("/").pop()}: ${h.stderr.trim() || "status failed"}`);
        }
        this.jobs = data.jobs; this.hooks = hooks; this.error = errors.length ? errors.join("\n") : null;
      } catch (e) { this.error = String(e?.message ?? e); }
      this.loading = false;
      cx.notify();
      cx.timer.after(Math.max(0, this.spinUntil - Date.now()), cx => cx.notify());
    });
  }

  hookAction(hook, command, cx) {
    if (this.starting) return;
    this.starting = hook.name;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec(hook.script, [command], { timeout: 90000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
      let out = {};
      try { out = JSON.parse(r.stdout); } catch { /* reported below */ }
      this.error = out.ok ? null : (out.error || r.stderr.trim() || `${command} failed`);
      this.starting = null;
      this.load(cx);
    });
  }

  start(job, cx) {
    if (this.starting) return;
    this.starting = job.name;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec(cli(), ["run", job.name], { timeout: 90000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
      let out = {};
      try { out = JSON.parse(r.stdout); } catch { /* reported below */ }
      this.error = out.started ? null : (out.why || r.stderr.trim() || `could not start ${job.name}`);
      this.starting = null;
      this.loading = false;
      this.load(cx);
    });
  }

  // The picked row's number keys: [key, label, action].
  actions(item) {
    if (item.kind === "hook") {
      const hook = item.hook;
      return [["1", "check now", cx => this.hookAction(hook, "check", cx)], ["2", hook.loaded ? "turn off" : "turn on", cx => this.hookAction(hook, hook.loaded ? "uninstall" : "install", cx)]];
    }
    const job = item.job, address = job.last?.address;
    return [["1", "run", cx => this.start(job, cx)], ...(address ? [["2", "go to session", () => run("agent.focus", { terminal: address })]] : [])];
  }

  startHints() {
    if (this.hinting) { this.endHints(); return; }
    this.returnPane = focused()?.pane ?? null;
    this.hinting = true; this.typed = ""; this.picked = null;
    this.handle.focus();
  }

  endHints(restore = true) {
    this.hinting = false; this.typed = ""; this.picked = null;
    if (restore && this.returnPane) run("pane.focus", { pane: this.returnPane });
  }

  hintKey(key, cx) {
    if (key === "escape") { this.endHints(); return; }
    if (this.picked) {
      const action = this.actions(this.picked).find(([k]) => k === key);
      // "go to session" moves focus itself, so don't send it back to the old pane.
      if (action) { this.endHints(action[1] !== "go to session"); action[2](cx); }
      return;
    }
    if (key === "backspace") { this.typed = this.typed.slice(0, -1); return; }
    if (!/^[a-z]$/.test(key)) return;
    const typed = this.typed + key, matches = this.hintMap.filter(([label]) => label.startsWith(typed));
    if (!matches.length) return;
    const exact = matches.find(([label]) => label === typed);
    if (exact) { this.picked = exact[1]; this.typed = ""; } else this.typed = typed;
  }

  render(cx) {
    // my-tabs bumps this when the refresh key is pressed with Jobs showing.
    const latest = shared("jobs.refresh");
    if (latest !== this.seenRefresh) { this.seenRefresh = latest; this.load(cx); }
    const hints = shared(HINTS);
    if (hints !== this.seenHints) { this.seenHints = hints; cx.timer.after(0, cx => { this.startHints(); cx.notify(); }); }
    if (this.hinting) {
      if (this.handle.is_focused()) this.hadFocus = true;
      else if (this.hadFocus) this.endHints(false);
    } else this.hadFocus = false;
    const t = theme(), now = Date.now();
    const items = [...this.jobs.map(job => ({ kind: "job", job })), ...this.hooks.map(hook => ({ kind: "hook", hook }))];
    // Keep the picked row across reloads by matching its name.
    if (this.picked) this.picked = items.find(i => i.kind === this.picked.kind && (i.job ?? i.hook).name === (this.picked.job ?? this.picked.hook).name) ?? null;
    const names = labels(items.length);
    this.hintMap = items.map((item, i) => [names[i], item]);
    const labelOf = new Map(items.map((item, i) => [item.job ?? item.hook, names[i]]));
    const badge = (key) => {
      const label = labelOf.get(key), live = label?.startsWith(this.typed);
      return div().flex_none().px(4).rounded(3).font_semibold().bg(live ? t.accent : t.border).text_color(live ? t.background : t.dim).child(label ?? "");
    };
    const isPicked = (key) => this.picked && (this.picked.job ?? this.picked.hook) === key;
    const mark = (el, key) => el.when(this.hinting && !this.picked, el => el.child(badge(key)));
    const ring = (el, key) => el.when(isPicked(key), el => el.bg(t.hover).border_1().border_color(t.accent));
    const legend = this.picked ? this.actions(this.picked).map(([k, label]) => `${k} ${label}`).join(" · ") + " · Esc" : `Pick a job${this.typed ? ` · ${this.typed}` : ""} · Esc`;
    const row = (job) => {
      const last = job.last;
      const [label, tone] = last ? (STATE[last.state] ?? [last.state, "dim"]) : ["Never run", "dim"];
      const starting = this.starting === job.name;
      return ring(v_flex().id(`job-${job.name}`).p(8).gap(4).rounded(6).hover((s) => s.bg(t.hover)), job)
        .when(last?.address, (el) => el.cursor_pointer().on_click(() => run("agent.focus", { terminal: last.address })))
        .child(mark(h_flex().gap(6).items_center(), job)
          .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(job.name))
          .child(div().text_color(t[tone] ?? t.dim).child(starting ? "Starting…" : label))
          .child(div().id(`run-${job.name}`).px(4).cursor_pointer().text_color(starting ? t.dim : t.accent).child("▶")
            .on_click((_e, cx) => { cx.stop_propagation(); this.start(job, cx); })))
        .child(h_flex().gap(8).text_color(t.muted)
          .child(div().flex_1().min_w(0).truncate().child(`${schedule(job)} · ${job.agent}`))
          .when(job.times.length && !job.loaded, (el) => el.child(div().text_color(t.blocked).child("not loaded"))))
        .child(h_flex().gap(8).text_color(t.dim)
          .child(div().flex_1().min_w(0).truncate().child(last ? `Last ${day(last.ts, now)} ${clock(last.ts)}` : "Last: never"))
          .when(job.next && job.loaded, (el) => el.child(div().child(`Next ${day(job.next, now)} ${clock(job.next)}`))));
    };
    const hookRow = (hook) => {
      const check = hook.last_check, fired = hook.last_trigger;
      const busy = this.starting === hook.name;
      const checkText = check ? `Checked ${day(check.ts, now)} ${clock(check.ts)} · ${check.result}` : "Never checked";
      const fireText = fired ? `Triggered ${day(fired.ts, now)} ${clock(fired.ts)} · ${fired.subject}` : "Never triggered";
      return ring(v_flex().id(`hook-${hook.name}`).p(8).gap(4).rounded(6).hover((s) => s.bg(t.hover)), hook)
        .child(mark(h_flex().gap(6).items_center(), hook)
          .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(hook.name))
          .child(div().text_color(check?.state === "error" ? t.blocked : hook.loaded ? t.done : t.dim)
            .child(hook.loaded ? check?.state === "error" ? "Check failed" : "On" : "Off"))
          .child(div().id("hook-check-now").px(4).cursor_pointer().text_color(busy ? t.dim : t.accent).child(busy ? "Checking…" : "Check now")
            .on_click((_e, cx) => { cx.stop_propagation(); this.hookAction(hook, "check", cx); }))
          .child(div().id("hook-toggle").px(4).cursor_pointer().text_color(t.muted).child(hook.loaded ? "Turn off" : "Turn on")
            .on_click((_e, cx) => { cx.stop_propagation(); this.hookAction(hook, hook.loaded ? "uninstall" : "install", cx); })))
        .child(div().text_color(t.muted).child(`Checks every ${hook.interval / 60} minutes`))
        .child(div().text_color(check?.state === "error" ? t.blocked : t.dim).child(checkText))
        .child(div().text_color(t.dim).child(fireText)
          .when(fired?.address, (el) => el.cursor_pointer().on_click(() => run("agent.focus", { terminal: fired.address }))));
    };
    return v_flex().id("jobs").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_size(12)
      .on_key_down((e, cx) => { if (!this.hinting) return; this.hintKey(e.key, cx); cx.stop_propagation(); cx.notify(); })
      .child(h_flex().h(40).px(12).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(this.hinting ? legend : "Jobs & Hooks"))
        .child(div().id("refresh").cursor_pointer().text_color(t.muted).child(this.loading || Date.now() < (this.spinUntil ?? 0) ? svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.muted).spin(900) : "↻").on_click((_e, cx) => this.load(cx))))
      .when(this.error, (el) => el.child(div().p(10).text_color(t.blocked).child(this.error)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(6)
        .child(div().p(4).font_semibold().text_color(t.foreground).child(`Jobs · ${this.jobs.length}`))
        .when(!this.jobs.length && !this.error, (el) => el.child(div().p(8).text_color(t.dim).child("No jobs yet. Add one to parker-agent-kit/jobs/defs.")))
        .children(this.jobs.map(row))
        .child(div().p(4).font_semibold().text_color(t.foreground).child(`Hooks · ${this.hooks.length}`))
        .children(this.hooks.map(hookRow)));
  }
}
