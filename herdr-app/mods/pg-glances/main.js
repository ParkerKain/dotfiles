// Playground prototype: panel glances in the status bar. Instead of a drawer or icons, the
// bottom row carries one short glance per panel (tasks due, next call, the reddest Lock-in
// session, Factory, artifacts). Nothing sits over a terminal. Clicking a glance opens its
// panel in the side column; the Lock-in glance opens the most urgent session's hub page.
// A glance that changes after the first read flashes once; one that needs you breathes.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { checking, exec, layout, run, theme, window as appWindow } from "herdr";
import { POLL_MS, SOURCES, alpha, find, isoToday } from "./lib/sources.js";

const SHOWN = ["ops-tasks", "day-view", "lock-in", "factory", "artifacts"];
const MAX_W = { "ops-tasks": 120, "day-view": 170, "lock-in": 170, factory: 150, artifacts: 140 };

// The status bar has room for a few words, so each glance gets a shorter label.
function short(id, g, raw) {
  if (!g) return null;
  if (id === "lock-in") {
    const flags = raw?.flags ?? [];
    const top = flags.find(f => f.urgency === "red") ?? flags[0];
    if (!top) return "All locked in";
    const code = (top.name.match(/^\[([^\]]+)\]/) ?? [])[1] ?? top.name.split(/\s+/)[0];
    const more = flags.length > 1 ? ` +${flags.length - 1}` : "";
    return `${code} ${top.days ?? ""}d${more}`;
  }
  if (id === "day-view") return g.title.replace(/^Next at /, "Next ");
  if (id === "factory") return g.title === "Factory quiet" ? "quiet" : g.title;
  if (id === "ops-tasks") return g.badge ? `${g.badge.text} due` : g.title;
  return g.title;
}

export default class Glances extends View {
  init(_props, cx) {
    this.raw = {}; this.glances = {}; this.errors = {}; this.busy = {}; this.flash = {}; this.seen = {};
    this.day = isoToday();
    if (checking()) return;
    this.load(cx);
    cx.timer.every(POLL_MS, cx => { if (appWindow()?.visible !== false) this.load(cx); });
    cx.timer.every(60000, cx => {
      if (appWindow()?.visible === false) return;
      if (isoToday() !== this.day) { this.day = isoToday(); this.load(cx); return; }
      const cal = SOURCES.find(s => s.id === "day-view");
      if (this.raw[cal.id]) { this.set(cal, cal.glance(this.raw[cal.id]), cx); cx.notify(); }
    });
  }

  load(cx) { for (const s of SOURCES) if (SHOWN.includes(s.id)) this.loadOne(s, cx); }

  loadOne(s, cx) {
    if (this.busy[s.id]) return;
    this.busy[s.id] = true;
    cx.spawn(async cx => {
      try { this.raw[s.id] = await s.read(); this.set(s, s.glance(this.raw[s.id]), cx); this.errors[s.id] = null; }
      catch (e) { this.errors[s.id] = String(e?.message ?? e); }
      this.busy[s.id] = false;
      cx.notify();
    });
  }

  // Stores a glance and flashes it when its label changed since the last read.
  set(s, g, cx) {
    this.glances[s.id] = g;
    const label = short(s.id, g, this.raw[s.id]);
    if (this.seen[s.id] !== undefined && this.seen[s.id] !== label) {
      this.flash[s.id] = true;
      cx.timer.after(60, cx => { this.flash[s.id] = false; cx.notify(); });
    }
    this.seen[s.id] = label;
  }

  open(s) {
    if (s.id === "lock-in") {
      const flags = this.raw[s.id]?.flags ?? [];
      const top = flags.find(f => f.urgency === "red") ?? flags[0];
      if (top?.hub_url) exec("open", [top.hub_url]);
      return;
    }
    if (!find(layout(), s.id)) return;
    run("layout.select", { stack: "panel-body", child: s.id });
    run("layout.show", { id: "panel" });
  }

  render() {
    const t = theme();
    const items = SOURCES.filter(s => SHOWN.includes(s.id)).map(s => this.item(s, t));
    const row = h_flex().id("pg-glances").size_full().min_w(0).items_center().pl(10).gap(2).text_size(11).overflow_hidden();
    items.forEach((el, i) => {
      if (i) row.child(div().flex_none().w(1).h(12).mx(4).bg(alpha(t.border, 0.9)));
      row.child(el);
    });
    return row;
  }

  item(s, t) {
    const g = this.glances[s.id], err = this.errors[s.id];
    const label = short(s.id, g, this.raw[s.id]) ?? (err ? "offline" : "…");
    const hot = g?.pulse;
    const color = hot ? (t.blocked ?? t.ansi1) : g?.tone === "working" ? (t.working ?? t.ansi3) : t.foreground;
    const flags = s.id === "lock-in" ? (this.raw[s.id]?.flags ?? []) : [];
    const tip = err ? `${s.name}: last read failed (${err})`
      : s.id === "lock-in" && flags.length ? flags.slice(0, 8).map(f => `${f.urgency === "red" ? "●" : "○"} ${f.name} · ${f.relative_label ?? ""}`).join("\n") + "\nClick opens the most urgent in Ops"
      : `${s.name}${g?.sub ? `: ${g.sub}` : ""}\nClick to open`;
    return h_flex().id(`gl-${s.id}`).relative().flex_none().max_w(MAX_W[s.id]).h(22).px(6).gap(5).items_center().rounded(6)
      .cursor_pointer().hover(st => st.bg(t.hover)).tooltip(tip).on_click(() => this.open(s))
      // The flash: drawn at full strength for one frame, then faded out.
      .child(div().id(`fl-${s.id}`).absolute().inset_0().rounded(6).bg(alpha(t.accent, 0.45))
        .opacity(this.flash[s.id] ? 1 : 0).transition("opacity", { duration: 1100, easing: "ease-out" }))
      .when(hot, el => el.child(div().flex_none().w(7).h(7).rounded(4).bg(t.blocked ?? t.ansi1)
        .loop("opacity", { from: 0.3, to: 1, period: 1200 })))
      .when(!hot, el => el.child(s.glyph ? div().flex_none().text_color(t.dim).child(s.glyph) : svg(s.icon).flex_none().size(12).text_color(t.dim)))
      .child(div().truncate().text_color(err ? t.dim : color).child(label));
  }
}
