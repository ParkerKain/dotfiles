// Scheduled agent jobs and lightweight hooks from parker-agent-kit/jobs.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, theme, run, shared } from "herdr";

const cli = () => `${home()}/Documents/internal/repos/parker-agent-kit/jobs/job`;
const mailHook = () => `${home()}/Documents/internal/repos/parker-agent-kit/jobs/mail_hook.py`;
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
    this.load(cx);
    cx.timer.every(60000, (cx) => this.load(cx));
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(cli(), ["status"], { timeout: 20000 });
        let data;
        try { data = JSON.parse(r.stdout); } catch { throw new Error(r.stderr.trim().split("\n").pop() || `job status exited ${r.code}`); }
        if (!data.ok) throw new Error(r.stderr.trim() || "job status failed");
        const h = await exec(mailHook(), ["status"], { timeout: 20000 });
        let hooks;
        try { hooks = JSON.parse(h.stdout); } catch { throw new Error(h.stderr.trim() || "hook status failed"); }
        if (!hooks.ok) throw new Error(h.stderr.trim() || "hook status failed");
        this.jobs = data.jobs; this.hooks = hooks.hooks; this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      this.loading = false;
      cx.notify();
    });
  }

  hookAction(command, cx) {
    if (this.starting) return;
    this.starting = "Mail inbox";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec(mailHook(), [command], { timeout: 90000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
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

  render(cx) {
    // my-tabs bumps this when the refresh key is pressed with Jobs showing.
    const latest = shared("jobs.refresh");
    if (latest !== this.seenRefresh) { this.seenRefresh = latest; this.load(cx); }
    const t = theme(), now = Date.now();
    const row = (job) => {
      const last = job.last;
      const [label, tone] = last ? (STATE[last.state] ?? [last.state, "dim"]) : ["Never run", "dim"];
      const starting = this.starting === job.name;
      return v_flex().id(`job-${job.name}`).p(8).gap(4).rounded(6).hover((s) => s.bg(t.hover))
        .when(last?.address, (el) => el.cursor_pointer().on_click(() => run("agent.focus", { terminal: last.address })))
        .child(h_flex().gap(6).items_center()
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
      return v_flex().id("hook-mail-inbox").p(8).gap(4).rounded(6).hover((s) => s.bg(t.hover))
        .child(h_flex().gap(6).items_center()
          .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(hook.name))
          .child(div().text_color(check?.state === "error" ? t.blocked : hook.loaded ? t.done : t.dim)
            .child(hook.loaded ? check?.state === "error" ? "Check failed" : "On" : "Off"))
          .child(div().id("hook-check-now").px(4).cursor_pointer().text_color(busy ? t.dim : t.accent).child(busy ? "Checking…" : "Check now")
            .on_click((_e, cx) => { cx.stop_propagation(); this.hookAction("check", cx); }))
          .child(div().id("hook-toggle").px(4).cursor_pointer().text_color(t.muted).child(hook.loaded ? "Turn off" : "Turn on")
            .on_click((_e, cx) => { cx.stop_propagation(); this.hookAction(hook.loaded ? "uninstall" : "install", cx); })))
        .child(div().text_color(t.muted).child(`Checks every ${hook.interval / 60} minutes`))
        .child(div().text_color(check?.state === "error" ? t.blocked : t.dim).child(checkText))
        .child(div().text_color(t.dim).child(fireText)
          .when(fired?.address, (el) => el.cursor_pointer().on_click(() => run("agent.focus", { terminal: fired.address }))));
    };
    return v_flex().id("jobs").size_full().min_h(0).bg(t.background).text_size(12)
      .child(h_flex().h(40).px(12).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().text_color(t.foreground).child("Jobs & Hooks"))
        .child(div().id("refresh").cursor_pointer().text_color(t.muted).child("↻").on_click((_e, cx) => this.load(cx))))
      .when(this.error, (el) => el.child(div().p(10).text_color(t.blocked).child(this.error)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(6)
        .child(div().p(4).font_semibold().text_color(t.foreground).child(`Jobs · ${this.jobs.length}`))
        .when(!this.jobs.length && !this.error, (el) => el.child(div().p(8).text_color(t.dim).child("No jobs yet. Add one to parker-agent-kit/jobs/defs.")))
        .children(this.jobs.map(row))
        .child(div().p(4).font_semibold().text_color(t.foreground).child(`Hooks · ${this.hooks.length}`))
        .children(this.hooks.map(hookRow)));
  }
}
