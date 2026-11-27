// Playground prototype: the Command Deck. A floating drawer on the window's right edge
// (layout "floating" with "peek": 44) that replaces the icon cluster at the top right.
// Closed, it is a column of panel icons, each with its own signal: a count, a ring that
// closes as the next meeting nears, a pulsing dot for a red session. Hovered, it slides
// out into one line per panel. Clicking a line opens that panel in the side column.
//
// Data comes from the kit CLIs the panels already use: ops-tasks, day-view, lock-in,
// factory, claude-usage and artifacts. Each is read in the background every 5 minutes.
import { View, div, svg, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
// `window` from "herdr" would hide GPUI's global `window` (which has paint_path), so it is renamed.
import { checking, exec, home, layout, placement, run, settings, theme, window as appWindow } from "herdr";

const POLL_MS = 5 * 60 * 1000;
const ROW_H = 46;
const OPEN_W = 268;
const bin = (name) => `${home()}/.local/bin/${name}`;
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// Scales a color's alpha, keeping any alpha it already has (layouts often set #rrggbbaa).
const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  return m ? "#" + m[1] + Math.round(a * (m[2] ? parseInt(m[2], 16) / 255 : 1) * 255).toString(16).padStart(2, "0") : hex;
};
const clock = (min) => { const h = Math.floor(min / 60); return `${h % 12 || 12}:${String(min % 60).padStart(2, "0")}`; };

async function json(cmd, args, timeout = 45000) {
  const r = await exec(cmd, args, { timeout }).catch(e => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  let v = null;
  try { v = JSON.parse(r.stdout); } catch { /* below */ }
  if (!v || v.ok === false) throw new Error(v?.error?.message ?? (r.stderr.trim().split("\n").pop() || `${cmd} exited ${r.code}`));
  return v;
}

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) { const hit = find(child, id); if (hit) return hit; }
  return null;
}

// Each source: how to read it, and how to turn what it read into a glance.
// A glance is { title, sub, badge?: { text, tone }, ring?: 0..1, pulse?: bool, tone? }.
const SOURCES = [
  {
    id: "ops-tasks", icon: "mods/workspace-chrome/check.svg", name: "Tasks",
    async read() {
      const v = await json(`${home()}/go/bin/ops-tasks`, ["list", "--json"]);
      return v.data?.tasks ?? [];
    },
    glance(tasks) {
      const today = isoToday();
      // The CLI lists open tasks only.
      const open = tasks.filter(x => x.due_date && x.due_date <= today);
      const overdue = open.filter(x => x.due_date < today), late = overdue.length;
      return {
        title: open.length ? `${open.length} due today` : "Nothing due today",
        sub: late ? `${late} overdue · ${overdue[0].title}` : open[0]?.title ?? `${tasks.length} open in all`,
        badge: open.length ? { text: String(open.length), tone: late ? "blocked" : "working" } : null,
      };
    },
  },
  {
    id: "day-view", icon: "mods/day-view/calendar.svg", name: "Calendar",
    async read() { return (await json(bin("day-view"), ["day", isoToday()])).events ?? []; },
    glance(events) {
      const now = nowMinutes();
      const timed = events.filter(e => !e.all_day && !e.starts_before && !e.ends_after && e.kind !== "free" && e.kind !== "ooo" && e.end_min > now).sort((a, b) => a.start_min - b.start_min);
      const live = timed.find(e => e.start_min <= now);
      if (live) return { title: `On now · ${live.end_min - now}m left`, sub: live.title, ring: 1, tone: "blocked", pulse: true };
      const next = timed[0];
      if (!next) return { title: "Calendar clear", sub: "Nothing else today", ring: 0 };
      const mins = next.start_min - now;
      return {
        title: mins < 60 ? `${next.title.replace(/^\[[^\]]+\]\s*/, "").split(/\s+/).slice(0, 3).join(" ")} in ${mins}m` : `Next at ${clock(next.start_min)}`,
        sub: next.title,
        // The ring closes over the last hour before the meeting.
        ring: Math.max(0, Math.min(1, 1 - mins / 60)), tone: mins <= 15 ? "working" : "accent", pulse: mins <= 5,
      };
    },
  },
  {
    id: "lock-in", glyph: "✈", name: "Lock-in",
    async read() { return (await json(bin("lock-in"), ["flags"])).data ?? {}; },
    glance(r) {
      const flags = r.flags ?? [], red = flags.filter(f => f.urgency === "red");
      if (!flags.length) return { title: "All locked in", sub: "Every session is confirmed" };
      return {
        title: red.length ? `${red.length} red, ${flags.length - red.length} amber` : `${flags.length} not locked in`,
        sub: `${(red[0] ?? flags[0]).name} · ${(red[0] ?? flags[0]).relative_label ?? ""}`,
        badge: { text: String(red.length || flags.length), tone: red.length ? "blocked" : "working" }, pulse: red.length > 0,
      };
    },
  },
  {
    id: "factory", icon: "mods/factory/factory.svg", name: "Factory",
    async read() { return (await json(bin("factory"), ["status"])).data ?? {}; },
    glance(d) {
      const waiting = (d.waiting ?? []).length + (d.more ?? 0), mine = (d.mine ?? []).filter(m => !m.landed).length;
      if (waiting) return { title: `${waiting} waiting on you`, sub: d.waiting[0]?.title ?? "", badge: { text: String(waiting), tone: "blocked" }, pulse: true };
      return { title: "Factory quiet", sub: mine ? `${mine} of your tickets in flight` : "Nothing waits on you" };
    },
  },
  {
    id: "claude-usage", icon: "mods/claude-usage/gauge.svg", name: "Usage",
    async read() { return (await json(bin("claude-usage"), ["report"])).data ?? {}; },
    glance(d) {
      const me = (d.entries ?? []).find(e => e.is_me);
      if (!me) return { title: "Usage", sub: "No reading yet" };
      const over = me.percent > me.pace_percent;
      return {
        title: `${Math.round(me.percent)}% of the week`,
        sub: `pace ${Math.round(me.pace_percent)}% · resets ${me.resets_label}`,
        meter: { used: me.percent / 100, pace: me.pace_percent / 100 }, tone: over ? "blocked" : "done",
      };
    },
  },
  {
    id: "artifacts", icon: "mods/artifacts/layers.svg", name: "Artifacts",
    async read() {
      const r = await exec(bin("artifacts"), ["list"], { timeout: 30000 });
      if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || `artifacts exited ${r.code}`);
      return r.stdout.split("\n").filter(Boolean).map(l => l.split(/\s{2,}/));
    },
    glance(rows) {
      const today = isoToday(), fresh = rows.filter(r => r[0] === today);
      return { title: fresh.length ? `${fresh.length} published today` : `${rows.length} artifacts`, sub: rows[0]?.[2] ?? "", badge: fresh.length ? { text: String(fresh.length), tone: "accent" } : null };
    },
  },
];

export default class Deck extends View {
  init(_props, cx) {
    this.raw = {}; this.glances = {}; this.errors = {}; this.busy = {};
    this.day = isoToday();
    if (checking()) return;
    this.load(cx);
    cx.timer.every(POLL_MS, cx => { if (appWindow()?.visible !== false) this.load(cx); });
    // The calendar ring and countdown move with the clock. Each minute recomputes them from
    // the events already read, and only a new day reads Outlook again.
    cx.timer.every(60000, cx => {
      if (appWindow()?.visible === false) return;
      if (isoToday() !== this.day) { this.day = isoToday(); this.load(cx); return; }
      const cal = SOURCES.find(s => s.id === "day-view");
      if (this.raw[cal.id]) { this.glances[cal.id] = cal.glance(this.raw[cal.id]); cx.notify(); }
    });
  }

  load(cx) { for (const s of SOURCES) this.loadOne(s, cx); }

  loadOne(s, cx) {
    if (this.busy[s.id]) return;
    this.busy[s.id] = true;
    cx.spawn(async cx => {
      try { this.raw[s.id] = await s.read(); this.glances[s.id] = s.glance(this.raw[s.id]); this.errors[s.id] = null; }
      catch (e) { this.errors[s.id] = String(e?.message ?? e); }
      this.busy[s.id] = false;
      cx.notify();
    });
  }

  openPanel(s) {
    // Lock-in lives in the radar band, so its row hands the keyboard to the radar's letters.
    if (s.id === "lock-in") { run("pg-radar.pick"); return; }
    if (!find(layout(), s.id)) return;
    run("layout.select", { stack: "panel-body", child: s.id });
    run("layout.show", { id: "panel" });
  }

  render() {
    const t = theme();
    const p = placement();
    const mirror = p?.edge !== "left"; // on the right edge the icons sit on the right
    const zoom = Number(settings()?.zoom) || 1;
    return v_flex().id("pg-deck").w(OPEN_W).py(6).gap(2).text_size(11.5)
      .children(SOURCES.map(s => this.row(s, t, mirror, zoom)));
  }

  row(s, t, mirror, zoom) {
    const g = this.glances[s.id], err = this.errors[s.id];
    const tone = (name) => t[name] ?? t.accent;
    // Badges are bright in both appearances, so their text is always the darker theme color.
    const badgeInk = settings()?.dark ? t.background : t.foreground;
    const tile = div().id(`tile-${s.id}`).relative().flex_none().w(30).h(30).rounded(8).bg(t.hover)
      .flex().items_center().justify_center()
      .child(s.glyph ? div().text_size(14).text_color(t.foreground).child(s.glyph) : svg(s.icon).size(15).text_color(t.foreground))
      .when(g?.ring != null && g.ring > 0, el => el.child(div().absolute().inset_0()
        .when(Boolean(g.pulse), r => r.loop("opacity", { from: 0.4, to: 1, period: 1000 }))
        .child(ring(t, g.ring, tone(g.tone ?? "accent"), zoom))))
      .when(Boolean(g?.badge), el => el.child(div().absolute().top(-5).right(-6).min_w(16).h(16).px(4).rounded(8)
        .bg(tone(g.badge.tone)).text_color(badgeInk).text_size(9.5).font_semibold().flex().items_center().justify_center()
        .when(Boolean(g.pulse), b => b.loop("opacity", { from: 0.45, to: 1, period: 1100 }))
        .child(g.badge.text)))
      // A failed read keeps the last glance but marks it as old.
      .when(Boolean(err), el => el.child(div().absolute().bottom(-2).right(-2).w(7).h(7).rounded(4).bg(t.dim)));

    const text = v_flex().flex_1().min_w(0).justify_center()
      .child(div().truncate().font_semibold().text_color(g?.tone === "blocked" ? tone("blocked") : t.foreground).child(g?.title ?? (err ? `${s.name} offline` : s.name)))
      .child(g?.meter ? meter(t, g.meter, tone(g.tone ?? "done"), s.id) : div().truncate().text_size(10.5).text_color(t.dim).child(g?.sub ?? (err ? err : "Reading…")))
      .when(Boolean(g?.meter), el => el.child(div().truncate().text_size(10).text_color(t.dim).child(g.sub)));

    const row = h_flex().id(`row-${s.id}`).h(ROW_H).items_center().gap(10).pl(mirror ? 12 : 7).pr(mirror ? 7 : 12)
      .cursor_pointer().hover(st => st.bg(t.hover)).rounded(8)
      .tooltip(err ? `${s.name}: last read failed (${err})` : s.id === "lock-in" ? "Lock-in: click to pick a session in the radar" : `${s.name}: click to open`)
      .on_click(() => this.openPanel(s));
    return mirror ? row.child(text).child(tile) : row.child(tile).child(text);
  }
}

// A ring around the tile that closes as `value` goes from 0 to 1, drawn from the top clockwise.
function ring(t, value, color, zoom) {
  const size = 30, c = size / 2, r = size / 2 - 1.5;  // layout px: Herdr applies zoom to paint_path (seen at zoom 1.6)
  const full = (b) => b.move_to(c, c - r).arc_to(r, r, 0, false, true, c, c + r).arc_to(r, r, 0, false, true, c, c - r);
  const a = 2 * Math.PI * Math.min(value, 1);
  const arc = value >= 0.999 ? full(PathBuilder.stroke(2))
    : PathBuilder.stroke(2).move_to(c, c - r).arc_to(r, r, 0, value > 0.5, true, c + r * Math.sin(a), c - r * Math.cos(a));
  return div().absolute().top(0).left(0).size_full()
    .child(window.paint_path(full(PathBuilder.stroke(2)).build(), alpha(t.border, 0.8)).absolute().top(0).left(0).size_full())
    .child(window.paint_path(arc.build(), color).absolute().top(0).left(0).size_full());
}

// A thin bar with the week used and a gold tick where on-pace would be.
function meter(t, m, color, id) {
  const W = 150;
  return div().relative().w(W).h(6).my(3).rounded(3).bg(t.hover)
    .child(div().id(`meter-${id}`).absolute().left(0).top(0).bottom(0).w(Math.round(W * Math.min(1, m.used))).rounded(3).bg(color)
      .transition("width", { duration: 600, easing: "ease-out" }))
    .child(div().absolute().left(Math.round(W * Math.min(1, m.pace)) - 1).top(-2).bottom(-2).w(2).bg(t.working ?? t.ansi3));
}
