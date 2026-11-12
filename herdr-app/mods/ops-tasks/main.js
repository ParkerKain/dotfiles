import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, appHome, readTextFile, props, theme, run, openOverlay, closeOverlay, shared, setShared } from "herdr";

const REFRESH = "ops-tasks.refresh";
const cli = () => `${home()}/go/bin/ops-tasks`;
const refArgs = (task) => ["--source", task.source, "--kind", task.kind, "--id", String(task.id)];
const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function decode(result) {
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw new Error(result.stderr.trim() || result.stdout.trim() || `ops-tasks exited ${result.code}`); }
  if (!value.ok || result.code !== 0) throw new Error(value.error?.message || result.stderr.trim() || `ops-tasks exited ${result.code}`);
  return value.data;
}

function group(task, today, tomorrow, end) {
  const date = task.due_date;
  if (!date) return "No date";
  if (date < today) return "Overdue";
  if (date === today) return "Today";
  if (date === tomorrow) return "Tomorrow";
  return date <= end ? "Upcoming" : "Later";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const parseDay = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");
// "Monday, July 26th", plus the year when it isn't this year.
function longDate(date) {
  const year = date.getFullYear() === new Date().getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${ordinal(date.getDate())}${year}`;
}
function relative(date) {
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((date - today) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

// Section colors (theme tokens): the nearer the due date, the louder the heading.
const TONE = { Overdue: "blocked", Today: "accent", Tomorrow: "working", Upcoming: "muted", Later: "dim", "No date": "dim" };

export default class OpsTasks extends View {
  init(_props, cx) {
    this.confirm = props()?.complete ?? null;
    this.redate = props()?.reschedule ?? null;
    this.handle = cx.focus_handle();
    if (this.confirm) { this.handle.focus(); return; }
    if (this.redate) {
      // A task with no due date starts from today.
      const now = new Date();
      this.original = this.redate.due_date || null;
      this.day = this.original ? parseDay(this.original) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
      this.handle.focus();
      return;
    }
    this.tasks = []; this.error = null; this.loading = false; this.workDir = null;
    this.seenRefresh = shared(REFRESH);
    this.load(cx);
    cx.timer.every(120000, cx => this.load(cx));
  }

  load(cx) {
    // A load that never returns must not block every later refresh: after 60s, start a new one.
    if (this.loading && Date.now() - this.loadStarted < 60000) return;
    this.loading = true;
    this.loadStarted = Date.now();
    // Show the spinner for at least 600ms; notify on the next tick since load can run from render.
    this.spinUntil = Date.now() + 600; cx.timer.after(0, cx => cx.notify());
    const id = this.loadId = (this.loadId ?? 0) + 1;
    cx.spawn(async cx => {
      try {
        const data = decode(await exec(cli(), ["list", "--json"]));
        if (id !== this.loadId) return;
        this.tasks = data.tasks ?? [];
        this.error = null;
      } catch (e) { if (id !== this.loadId) return; this.error = String(e?.message ?? e); }
      this.loading = false;
      cx.notify();
      cx.timer.after(Math.max(0, this.spinUntil - Date.now()), cx => cx.notify());
    });
  }

  async directory() {
    if (this.workDir) return this.workDir;
    const config = await readTextFile(`${home()}/.config/ops-tasks/config.toml`);
    const line = config?.split("\n").find(s => /^\s*work_dir\s*=/.test(s));
    const configured = line?.match(/^\s*work_dir\s*=\s*["']([^"']+)["']/)?.[1];
    const env = configured ? null : await exec("printenv", ["OPS_TASKS_WORK_DIR"]).catch(() => null);
    const value = configured || (env?.code === 0 ? env.stdout.trim() : null);
    this.workDir = value ? value.replace(/^~(?=\/|$)/, home()).replace(/^\$HOME(?=\/|$)/, home()) : `${home()}/Documents/internal/repos/devclarity-vault`;
    return this.workDir;
  }

  start(task, cx) {
    cx.spawn(async cx => {
      try {
        const data = decode(await exec(cli(), ["prompt", ...refArgs(task), "--json"]));
        openOverlay({ mod: "session-launcher", kind: "dialog", width: 560, height: 255, props: { task: { title: task.title, prompt: data.prompt, slug: data.slug, folder: await this.directory() } } });
        this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  complete(cx) {
    const task = this.confirm;
    cx.spawn(async cx => {
      try {
        decode(await exec(cli(), ["complete", ...refArgs(task), "--yes", "--json"]));
        setShared(REFRESH, Date.now());
        closeOverlay(props().overlay);
      } catch (e) { this.error = String(e?.message ?? e); cx.notify(); }
    });
  }

  shift(days, cx) {
    this.day = new Date(this.day.getFullYear(), this.day.getMonth(), this.day.getDate() + days);
    cx.notify();
  }

  reschedule(cx) {
    const task = this.redate, due = localDay(this.day);
    if (this.saving) return;
    if (due === this.original) { closeOverlay(props().overlay); return; }
    this.saving = true; cx.notify();
    // A project task's date gets manually pinned; the dialog shows that warning before Enter.
    const pin = task.kind === "project" ? ["--allow-manual-pin"] : [];
    cx.spawn(async cx => {
      try {
        decode(await exec(cli(), ["reschedule", ...refArgs(task), "--due", due, "--yes", ...pin, "--json"]));
        setShared(REFRESH, Date.now());
        closeOverlay(props().overlay);
      } catch (e) { this.saving = false; this.error = String(e?.message ?? e); cx.notify(); }
    });
  }

  renderRedate(t) {
    const changed = localDay(this.day) !== this.original;
    const arrow = (label, days) => div().id(`shift-${days}`).cursor_pointer().px(8).rounded(4).text_color(t.muted).hover(s => s.bg(t.hover)).child(label).on_click((_e, cx) => this.shift(days, cx));
    return v_flex().id("ops-redate").track_focus(this.handle).size_full().p(16).gap(10).bg(t.popover)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "up") this.shift(1, cx);
        else if (e.key === "down") this.shift(-1, cx);
        else if (e.key === "enter") this.reschedule(cx);
        else return;
        cx.stop_propagation();
      })
      .child(div().truncate().text_color(t.muted).child(this.redate.title))
      .child(h_flex().items_center().gap(8)
        .child(v_flex().items_center().child(arrow("▲", 1)).child(arrow("▼", -1)))
        .child(v_flex().gap(2)
          .child(div().text_size(16).text_color(changed ? t.accent : t.foreground).child(longDate(this.day)))
          .child(div().text_color(t.dim).child(`${relative(this.day)}${this.original ? ` · was ${longDate(parseDay(this.original))}` : " · no date set"}`))))
      .when(this.redate.kind === "project", el => el.child(div().text_color(t.working).child("Pins the date: it stops following its session.")))
      .when(this.error, el => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().justify_end().gap(12).items_center()
        .child(div().flex_1().text_color(t.dim).child("↑↓ day · Enter save · Esc cancel"))
        .child(div().cursor_pointer().child("Cancel").on_click(() => closeOverlay(props().overlay)))
        .child(div().cursor_pointer().text_color(t.accent).child(this.saving ? "Saving…" : "Save").on_click((_e, cx) => this.reschedule(cx))));
  }

  render(cx) {
    const t = theme();
    if (this.redate) return this.renderRedate(t);
    if (this.confirm) return v_flex().id("ops-confirm").track_focus(this.handle).size_full().p(16).gap(12).bg(t.popover)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } else if (e.key === "enter") { this.complete(cx); cx.stop_propagation(); } })
      .child(div().text_size(16).text_color(t.foreground).child("Complete task?"))
      .child(div().flex_1().text_color(t.muted).child(this.confirm.title))
      .when(this.error, el => el.child(div().text_color(t.blocked).child(this.error)))
      .child(h_flex().justify_end().gap(12)
        .child(div().cursor_pointer().child("Cancel").on_click(() => closeOverlay(props().overlay)))
        .child(div().cursor_pointer().text_color(t.accent).child("Complete").on_click((_e, cx) => this.complete(cx))));

    const latest = shared(REFRESH);
    if (latest !== this.seenRefresh) { this.seenRefresh = latest; this.load(cx); }
    const now = new Date(), inDays = n => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
    const today = inDays(0), tomorrow = inDays(1), end = inDays(7);
    const groups = ["Overdue", "Today", "Tomorrow", "Upcoming", "Later", "No date"];
    const rows = Object.fromEntries(groups.map(g => [g, []]));
    for (const task of this.tasks) rows[group(task, today, tomorrow, end)].push(task);
    const heading = (g, first) => {
      const tone = t[TONE[g]] ?? t.muted;
      return h_flex().id(`heading-${g}`).px(5).gap(7).items_center().when(!first, el => el.mt(10))
        .child(div().w(3).h(13).rounded(2).bg(tone))
        .child(div().font_semibold().text_color(tone).child(g))
        .child(div().text_color(t.dim).child(String(rows[g].length)))
        .child(div().flex_1().h(1).bg(t.border));
    };
    return v_flex().id("ops-tasks").size_full().min_h(0).bg(t.background).text_size(12)
      .child(h_flex().h(40).px(12).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().text_color(t.foreground).child(`Tasks · ${this.tasks.length}`))
        .child(div().id("refresh").cursor_pointer().text_color(t.muted).child(this.loading || Date.now() < (this.spinUntil ?? 0) ? svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.muted).spin(900) : "↻").on_click((_e, cx) => this.load(cx))))
      .when(this.error, el => el.child(div().p(10).text_color(t.blocked).child(this.error)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(8).children(groups.filter(g => rows[g].length).flatMap((g, i) => [
        heading(g, i === 0),
        ...rows[g].map(task => v_flex().id(`task-${task.source}-${task.kind}-${task.id}`).p(7).gap(3).rounded(6).hover(s => s.bg(t.hover))
          .child(h_flex().gap(5).items_center().child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(`${task.status === "In progress" ? "▶ " : ""}${task.title}`))
            .child(div().cursor_pointer().text_color(t.accent).child("▶").on_click((_e, cx) => this.start(task, cx)))
            .child(div().id(`redate-${task.source}-${task.kind}-${task.id}`).cursor_pointer().child(svg("mods/workspace-chrome/clock.svg").size(12).text_color(t.muted)).on_click(() => openOverlay({ mod: "ops-tasks", kind: "dialog", width: 390, height: task.kind === "project" ? 210 : 190, props: { reschedule: task } })))
            .child(div().cursor_pointer().text_color(t.muted).child("✓").on_click(() => openOverlay({ mod: "ops-tasks", kind: "dialog", width: 390, height: 180, props: { complete: task } }))))
          .child(h_flex().gap(8).text_color(t.dim)
            .child(div().flex_1().min_w(0).truncate().child(task.project_name || task.origin || ""))
            .when(g !== "Today" && g !== "Tomorrow" && g !== "No date", el => el.child(div().child(task.due_date || "")))))
      ])));
  }
}
