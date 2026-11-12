import { View, div } from "gpui-kit";
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

function group(task, today, end) {
  const date = task.due_date;
  if (!date) return "No date";
  if (date < today) return "Overdue";
  if (date === today) return "Today";
  return date <= end ? "Upcoming" : "Later";
}

export default class OpsTasks extends View {
  init(_props, cx) {
    this.confirm = props()?.complete ?? null;
    this.handle = cx.focus_handle();
    if (this.confirm) { this.handle.focus(); return; }
    this.tasks = []; this.error = null; this.loading = false; this.workDir = null;
    this.seenRefresh = shared(REFRESH);
    this.load(cx);
    cx.timer.every(120000, cx => this.load(cx));
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const data = decode(await exec(cli(), ["list", "--json"]));
        this.tasks = data.tasks ?? [];
        this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      this.loading = false;
      cx.notify();
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
        run("tab.new", { name: task.title.slice(0, 42), folder: await this.directory(), argv: ["claude", "-n", data.slug], task: data.prompt });
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

  render(cx) {
    const t = theme();
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
    const today = localDay(new Date()), end = localDay(new Date(Date.now() + 7 * 86400000));
    const groups = ["Overdue", "Today", "Upcoming", "Later", "No date"];
    const rows = Object.fromEntries(groups.map(g => [g, []]));
    for (const task of this.tasks) rows[group(task, today, end)].push(task);
    return v_flex().id("ops-tasks").size_full().min_h(0).bg(t.background).text_size(12)
      .child(h_flex().h(40).px(12).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().text_color(t.foreground).child(`Tasks · ${this.tasks.length}`))
        .child(div().id("refresh").cursor_pointer().text_color(t.muted).child("↻").on_click(() => this.load(cx))))
      .when(this.error, el => el.child(div().p(10).text_color(t.blocked).child(this.error)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(8).children(groups.flatMap(g => rows[g].length ? [
        div().id(`heading-${g}`).px(5).text_color(t.dim).font_semibold().child(`${g} · ${rows[g].length}`),
        ...rows[g].map(task => v_flex().id(`task-${task.source}-${task.kind}-${task.id}`).p(7).gap(3).rounded(6).hover(s => s.bg(t.hover))
          .child(h_flex().gap(5).items_center().child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(`${task.status === "In progress" ? "▶ " : ""}${task.title}`))
            .child(div().cursor_pointer().text_color(t.accent).child("▶").on_click((_e, cx) => this.start(task, cx)))
            .child(div().cursor_pointer().text_color(t.muted).child("✓").on_click(() => openOverlay({ mod: "ops-tasks", kind: "dialog", width: 390, height: 180, props: { complete: task } }))))
          .child(h_flex().gap(8).text_color(t.dim)
            .child(div().flex_1().min_w(0).truncate().child(task.project_name || task.origin || ""))
            .when(g !== "Today" && g !== "No date", el => el.child(div().child(task.due_date || "")))))
      ] : [])));
  }
}
