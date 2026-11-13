import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, appHome, readTextFile, writeTextFile, props, theme, run, openOverlay, closeOverlay, shared, setShared, nextCommand, focused } from "herdr";

const REFRESH = "ops-tasks.refresh";
const HINTS = "ops-tasks.hints";
const cli = () => `${home()}/go/bin/ops-tasks`;
// Hand-dragged order, kept per task across refreshes and restarts.
const orderFile = () => `${appHome()}/ops-tasks-order.json`;
const keyOf = (task) => `${task.source}:${task.kind}:${task.id}`;
const CLEAR = "#00000000";
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

// Jump labels, easiest keys first. Rows past what single letters cover get two-letter
// labels behind reserved prefix letters, so no label is a prefix of another.
const KEYS = "asdfghjklqwertyuiopzxcvbnm";
function labels(n) {
  let p = 0;
  while (KEYS.length - p + p * KEYS.length < n && p < KEYS.length) p++;
  const singles = KEYS.slice(0, KEYS.length - p).split(""), out = singles.slice(0, n);
  for (const prefix of KEYS.slice(KEYS.length - p)) for (const k of KEYS) if (out.length < n) out.push(prefix + k);
  return out;
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
    // keys.json: ops-tasks.hints labels every row; a letter picks one, then 1/2/3 act on it.
    this.hinting = false; this.typed = ""; this.picked = null;
    // my-tabs.hints (Cmd+J) stamps this for whichever panel shows; a fresh stamp at
    // start means the key itself opened the panel.
    this.seenHints = shared(HINTS);
    if (this.seenHints && Date.now() - this.seenHints < 2000) cx.timer.after(0, cx => { this.startHints(); cx.notify(); });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "hints") this.startHints();
        cx.notify();
      }
    });
    // Drag to reorder: press a row, move past 4px, release on another row in the same section.
    this.order = []; this.orderText = null; this.drag = null; this.dropAt = null;
    cx.spawn(async cx => {
      this.orderText = await readTextFile(orderFile()).catch(() => null);
      try { this.order = JSON.parse(this.orderText ?? "[]"); } catch { this.order = []; }
      cx.notify();
    });
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

  startHints() {
    if (this.hinting) { this.endHints(); return; }
    this.returnPane = focused()?.pane ?? null;
    this.hinting = true; this.typed = ""; this.picked = null;
    this.handle.focus();
  }

  // Leave hint mode and hand the keyboard back to the pane that had it.
  endHints() {
    this.hinting = false; this.typed = ""; this.picked = null;
    if (this.returnPane) run("pane.focus", { pane: this.returnPane });
  }

  hintKey(key, cx) {
    if (key === "escape") { this.endHints(); return; }
    if (this.picked) {
      const task = this.picked;
      if (key === "1") { this.endHints(); this.start(task, cx); }
      else if (key === "2") { this.endHints(); this.openRedate(task); }
      else if (key === "3") { this.endHints(); this.openComplete(task); }
      return;
    }
    if (key === "backspace") { this.typed = this.typed.slice(0, -1); return; }
    if (!/^[a-z]$/.test(key)) return;
    const typed = this.typed + key, matches = this.hintMap.filter(([label]) => label.startsWith(typed));
    if (!matches.length) return;
    const exact = matches.find(([label]) => label === typed);
    if (exact) { this.picked = exact[1]; this.typed = ""; } else this.typed = typed;
  }

  saveOrder(keys) {
    this.order = keys;
    const text = JSON.stringify(keys);
    const write = async (retry) => {
      try { await writeTextFile(orderFile(), text, this.orderText); this.orderText = text; }
      catch (e) {
        // Another panel saved first: take its snapshot and write ours over it once.
        if (!retry) { this.orderText = await readTextFile(orderFile()).catch(() => null); return write(true); }
        this.error = `Could not save task order: ${e?.message ?? e}`;
      }
    };
    return write(false);
  }

  dragOver(task, g, e, cx) {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.active) { if (Math.abs(e.position.y - drag.y) < 4) return; drag.active = true; }
    const key = keyOf(task), after = e.local_position.y > e.bounds.height / 2;
    const next = drag.group === g && key !== drag.key ? { key, after } : null;
    if (next?.key !== this.dropAt?.key || next?.after !== this.dropAt?.after) { this.dropAt = next; cx.notify(); }
  }

  endDrag(cx) {
    const drag = this.drag, drop = this.dropAt;
    this.drag = null; this.dropAt = null;
    if (drag?.active && drop) {
      const keys = this.ordered.map(keyOf).filter(k => k !== drag.key);
      const at = keys.indexOf(drop.key);
      if (at >= 0) { keys.splice(drop.after ? at + 1 : at, 0, drag.key); cx.spawn(async cx => { await this.saveOrder(keys); cx.notify(); }); }
    }
    cx.notify();
  }

  openRedate(task) { openOverlay({ mod: "ops-tasks", kind: "dialog", width: 390, height: task.kind === "project" ? 210 : 190, props: { reschedule: task } }); }
  openComplete(task) { openOverlay({ mod: "ops-tasks", kind: "dialog", width: 390, height: 180, props: { complete: task } }); }

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
    const hints = shared(HINTS);
    if (hints !== this.seenHints) { this.seenHints = hints; cx.timer.after(0, cx => { this.startHints(); cx.notify(); }); }
    const now = new Date(), inDays = n => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
    const today = inDays(0), tomorrow = inDays(1), end = inDays(7);
    const groups = ["Overdue", "Today", "Tomorrow", "Upcoming", "Later", "No date"];
    const rows = Object.fromEntries(groups.map(g => [g, []]));
    for (const task of this.tasks) rows[group(task, today, tomorrow, end)].push(task);
    // Within a section, dragged tasks keep their place; tasks never dragged follow, in CLI order.
    const rank = new Map(this.order.map((k, i) => [k, i]));
    for (const g of groups) rows[g] = rows[g].map((task, i) => [rank.get(keyOf(task)) ?? this.order.length + i, task]).sort((a, b) => a[0] - b[0]).map(([, task]) => task);
    const heading = (g, first) => {
      const tone = t[TONE[g]] ?? t.muted;
      return h_flex().id(`heading-${g}`).px(5).gap(7).items_center().when(!first, el => el.mt(10))
        .child(div().w(3).h(13).rounded(2).bg(tone))
        .child(div().font_semibold().text_color(tone).child(g))
        .child(div().text_color(t.dim).child(String(rows[g].length)))
        .child(div().flex_1().h(1).bg(t.border));
    };
    // Clicking elsewhere takes the keyboard away: drop hint mode once focus has left.
    if (this.hinting) {
      const has = this.handle.is_focused();
      if (has) this.hadFocus = true;
      else if (this.hadFocus) { this.hinting = false; this.picked = null; this.typed = ""; }
    } else this.hadFocus = false;
    // Labels follow display order, so the nearest tasks get single letters.
    const ordered = this.ordered = groups.flatMap(g => rows[g]), names = labels(ordered.length);
    this.hintMap = ordered.map((task, i) => [names[i], task]);
    const labelOf = new Map(this.hintMap.map(([label, task]) => [task, label]));
    const badge = (task) => {
      const label = labelOf.get(task), live = label.startsWith(this.typed);
      return div().flex_none().px(4).rounded(3).font_semibold()
        .bg(live ? t.accent : t.border).text_color(live ? t.background : t.dim).child(label);
    };
    return v_flex().id("ops-tasks").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_size(12)
      .on_key_down((e, cx) => { if (!this.hinting) return; this.hintKey(e.key, cx); cx.stop_propagation(); cx.notify(); })
      .on_mouse_up("left", (_e, cx) => this.endDrag(cx))
      // A release outside the panel never reaches us, so leaving it cancels the drag.
      .on_hover((hovered, cx) => { if (!hovered && this.drag) { this.drag = null; this.dropAt = null; cx.notify(); } })
      .child(h_flex().h(40).px(12).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().text_color(t.foreground).child(this.hinting ? (this.picked ? "1 start · 2 move · 3 done · Esc" : `Pick a task${this.typed ? ` · ${this.typed}` : ""} · Esc`) : `Tasks · ${this.tasks.length}`))
        .child(div().id("refresh").cursor_pointer().text_color(t.muted).child(this.loading || Date.now() < (this.spinUntil ?? 0) ? svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.muted).spin(900) : "↻").on_click((_e, cx) => this.load(cx))))
      .when(this.error, el => el.child(div().p(10).text_color(t.blocked).child(this.error)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(8).children(groups.filter(g => rows[g].length).flatMap((g, i) => [
        heading(g, i === 0),
        ...rows[g].map(task => v_flex().id(`task-${task.source}-${task.kind}-${task.id}`).p(7).gap(3).rounded(6).hover(s => s.bg(t.hover))
          .border_t(2).border_b(2).border_color(CLEAR)
          .when(this.dropAt?.key === keyOf(task), el => this.dropAt.after ? el.border_b(2).border_color(t.accent) : el.border_t(2).border_color(t.accent))
          .when(this.drag?.active && this.drag.key === keyOf(task), el => el.opacity(0.4))
          .on_mouse_down("left", e => { this.drag = { key: keyOf(task), group: g, y: e.position.y, active: false }; })
          .on_mouse_move((e, cx) => this.dragOver(task, g, e, cx))
          .when(this.picked === task, el => el.bg(t.hover).border_1().border_color(t.accent))
          .child(h_flex().gap(5).items_center().when(this.hinting && !this.picked, el => el.child(badge(task))).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(`${task.status === "In progress" ? "▶ " : ""}${task.title}`))
            .child(div().cursor_pointer().text_color(t.accent).child("▶").on_click((_e, cx) => this.start(task, cx)))
            .child(div().id(`redate-${task.source}-${task.kind}-${task.id}`).cursor_pointer().child(svg("mods/workspace-chrome/clock.svg").size(12).text_color(t.muted)).on_click(() => this.openRedate(task)))
            .child(div().cursor_pointer().text_color(t.muted).child("✓").on_click(() => this.openComplete(task))))
          .child(h_flex().gap(8).text_color(t.dim)
            .child(div().flex_1().min_w(0).truncate().child(task.project_name || task.origin || ""))
            .when(g !== "Today" && g !== "Tomorrow" && g !== "No date", el => el.child(div().child(task.due_date || "")))))
      ])));
  }
}
