// Playground prototype: the day as a strip under the tab bar. Today's Outlook events sit
// on a 7am to 6pm line with a red now-line that moves each minute. The next meeting glows
// gold from 15 minutes out, and the ring at the strip's start counts down to it (click joins
// its Zoom link). The strip always opens on today; ‹ and › at its right end step through
// days and Today comes back. When today is clear, the ring says when the next call is.
// Clicking an event opens the Calendar panel on that day. Data comes from the kit's
// `day-view` CLI, which reads the Outlook calendar.
import { View, div, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, exec, home, settings, theme, window as appWindow } from "herdr";
import { addDays, allDay, busy, clockOf, countdown, dayLabel, hasRest, hourLabel, iso, joinUrl, stack, timed, windowOf } from "./lib/model.js";

const POLL_MS = 5 * 60 * 1000;
const LOOKAHEAD_DAYS = 7;
const cli = () => `${home()}/.local/bin/day-view`;
const open = (url) => exec("open", [url]);
// Scales a color's alpha, keeping any alpha it already has (layouts often set #rrggbbaa).
const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  return m ? "#" + m[1] + Math.round(a * (m[2] ? parseInt(m[2], 16) / 255 : 1) * 255).toString(16).padStart(2, "0") : hex;
};
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

async function readDay(date) {
  const r = await exec(cli(), ["day", date], { timeout: 30000 }).catch(e => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  let v = null;
  try { v = JSON.parse(r.stdout); } catch { /* below */ }
  if (!v?.ok) throw new Error(v?.error?.message ?? (r.stderr.trim().split("\n").pop() || `day-view exited ${r.code}`));
  return v.events ?? [];
}

export default class DayStrip extends View {
  init(_props, cx) {
    this.date = iso(new Date()); this.today = this.date; this.events = []; this.allDay = [];
    this.error = null; this.loading = false; this.loaded = false;
    this.now = nowMinutes(); this.width = 0; this.retryAt = 0;
    if (checking()) return;
    this.load(cx);
    cx.timer.every(POLL_MS, cx => { if (appWindow()?.visible !== false) this.load(cx); });
    // The now-line moves on the minute, so the first tick waits for the next one.
    const toMinute = 60000 - (Date.now() % 60000) + 50;
    cx.timer.after(toMinute, cx => {
      this.tick(cx);
      cx.timer.every(60000, cx => this.tick(cx));
    });
  }

  tick(cx) {
    const before = this.now;
    this.now = nowMinutes();
    // Read again only when the day turns over or today's last event has just ended, so a
    // quiet week doesn't re-scan Outlook every minute. After an error, wait for the next poll.
    const dayTurned = iso(new Date()) !== this.today;
    if (dayTurned) this.offset = 0;
    const justEnded = this.date === this.today && hasRest(this.events, before) && !hasRest(this.events, this.now);
    if ((dayTurned || justEnded) && Date.now() >= this.retryAt) this.load(cx);
    cx.notify();
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const today = iso(new Date());
        const date = addDays(today, this.offset ?? 0), events = await readDay(date);
        // Today with nothing left: look ahead once for the next call, for the ring's hint.
        let next = null;
        if (date === today && !hasRest(events, nowMinutes())) {
          for (let i = 1; i <= LOOKAHEAD_DAYS && !next; i++) {
            const d = addDays(today, i), first = timed(await readDay(d)).filter(busy).sort((a, b) => a.start_min - b.start_min)[0];
            if (first) next = { date: d, first };
          }
        }
        if (date !== addDays(today, this.offset ?? 0)) return; // stepped again meanwhile
        this.today = today; this.date = date; this.events = events; this.next = next;
        this.allDay = allDay(events);
        this.error = null; this.loaded = true; this.retryAt = 0;
      } catch (e) { this.error = String(e?.message ?? e); this.retryAt = Date.now() + POLL_MS; }
      this.loading = false; this.now = nowMinutes();
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const zoom = Number(settings()?.zoom) || 1;
    // Theme status colors first: themes tune them for both light and dark.
    const c = { event: t.ansi4 ?? t.accent, soon: t.working ?? t.ansi3, live: t.blocked ?? t.ansi1, free: t.dim };
    const isToday = this.date === this.today;
    const events = timed(this.events);
    const win = windowOf(this.events);
    const span = win.end - win.start, W = this.width;
    const x = (min) => Math.round(((Math.min(Math.max(min, win.start), win.end) - win.start) / span) * W);
    const cd = isToday ? countdown(this.events, this.now) : null;

    const frame = h_flex().id("pg-daystrip").size_full().min_w(0).px(8).pt(4).pb(2).text_size(11);
    const inner = h_flex().flex_1().min_w(0).h_full().rounded(10).border(1).border_color(t.border).bg(t.chrome).overflow_hidden();

    const ticks = [];
    for (let m = win.start; m <= win.end; m += 60) {
      ticks.push(div().absolute().left(x(m)).top(0).bottom(0).border_l(1).border_color(alpha(t.border, 0.7))
        .child(div().pl(3).text_size(9.5).text_color(t.dim).child(hourLabel(m))));
    }

    const block = ({ event: e, lane, lanes }, i) => {
      const live = isToday && e.start_min <= this.now && this.now < e.end_min;
      const soon = isToday && cd?.event === e && cd.tone === "soon";
      const free = e.kind === "free" || e.kind === "ooo";
      const color = live ? c.live : soon ? c.soon : free ? c.free : c.event;
      const left = x(e.start_min), w = Math.max(6, x(e.end_min) - left - 2);
      // Two overlapping events split the row: the first on top, the second below.
      const rowTop = 13, rowH = 21, h = lanes === 2 ? rowH / 2 - 1 : rowH;
      return div().id(`ev-${i}`).absolute().left(left).w(w).top(rowTop + (lane ? rowH / 2 + 1 : 0)).h(h).rounded(5).overflow_hidden()
        .bg(alpha(color, free ? 0.12 : soon ? 0.32 : 0.26)).border_l(3).border_color(color)
        .cursor_pointer().hover(s => s.bg(alpha(color, 0.42)))
        .tooltip(`${e.title}\n${clockOf(e.start_min)} to ${clockOf(e.end_min)}\nClick to open the day in Calendar`)
        .on_click(() => exec(cli(), ["show", this.date]))
        // The soon glow breathes on its own layer so the text stays steady.
        .when(soon, el => el.child(div().absolute().inset_0().bg(alpha(c.soon, 0.25)).loop("opacity", { from: 0, to: 1, period: 1600 })))
        .child(div().relative().px(5).pt(2).truncate().text_color(free ? t.dim : t.foreground).child(e.title));
    };

    const line = div().id("timeline").relative().flex_1().min_w(0).h_full().mx(8)
      .on_size_change((size, cx) => { const w = Math.round(size.width / zoom); if (w !== this.width) { this.width = w; cx.notify(); } })
      .children(ticks)
      // Time already gone today is shaded, so the strip reads as "what's left".
      // A light foreground wash shades the past the same way in light and dark themes.
      .when(isToday && W > 0, el => el.child(div().id("past").absolute().left(0).top(14).bottom(3).w(x(this.now)).bg(alpha(t.foreground, 0.06))
        .transition("width", { duration: 1000, easing: "linear" })))
      .children(W > 0 ? stack(events).map(block) : [])
      .when(isToday && W > 0 && this.now >= win.start && this.now <= win.end, el => el
        .child(div().id("now").absolute().left(x(this.now) - 1).top(12).bottom(2).w(2).rounded(1).bg(c.live)
          .transition("left", { duration: 1000, easing: "linear" }))
        .child(div().id("now-dot").absolute().left(x(this.now) - 4).top(9).w(8).h(8).rounded(4).bg(c.live)
          .transition("left", { duration: 1000, easing: "linear" })));

    // The countdown ring sits at the strip's start (round 2 pick C); the old right-hand chip is gone.
    return frame.child(inner.child(this.lead(t, c, cd, isToday)).child(line.opacity(this.stepping ? 0.25 : 1).transition("opacity", { duration: 180, easing: "ease-out" })).child(this.nav(t)));
  }

  // ‹ Today › at the strip's end. Stepping fades the line while the day is read.
  nav(t) {
    const btn = (id, label, tip, on) => div().id(id).flex_none().h(22).px(label.length > 1 ? 7 : 6).flex().items_center().justify_center()
      .rounded(6).text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_click((_e, cx) => on(cx)).child(label);
    const off = this.offset ?? 0;
    return h_flex().id("nav").flex_none().h_full().items_center().gap(2).px(6).border_l(1).border_color(t.border)
      .child(btn("prev", "‹", "Previous day", cx => this.step(-1, cx)))
      .when(off !== 0, el => el.child(btn("today", "Today", "Back to today", cx => this.step(-off, cx))))
      .child(btn("next", "›", "Next day", cx => this.step(1, cx)));
  }

  step(by, cx) {
    if (!by) return;
    this.offset = (this.offset ?? 0) + by;
    this.stepping = true;
    cx.notify();
    this.loading = false; // a newer day wins over a read still running
    this.load(cx);
    const wait = (cx) => { if (this.date === addDays(this.today, this.offset)) { this.stepping = false; cx.notify(); } else cx.timer.after(60, wait); };
    cx.timer.after(60, wait);
  }

  // The strip's start: a ring that fills over the last hour before the next call, with the
  // minutes inside, and the call's name beside it. Live, the ring shows the call's time left.
  lead(t, c, cd, isToday) {
    const base = h_flex().id("lead").flex_none().w(190).h_full().items_center().gap(8).pl(8).pr(10).border_r(1).border_color(t.border);
    const ooo = this.allDay.some(e => e.kind === "ooo");
    const note = this.error ? "Calendar offline" : !this.loaded ? "Reading…" : ooo ? "Out of office" : null;
    if (!isToday || !cd) {
      const first = timed(this.events).sort((a, b) => a.start_min - b.start_min)[0];
      return base.child(this.ring(t, 0, t.dim, "–"))
        .child(v_flex().min_w(0).child(div().truncate().font_semibold().text_color(t.foreground).child(isToday ? "Today" : dayLabel(this.date)))
          .child(div().truncate().text_size(10).text_color(t.dim).child(note ?? (first ? `First ${clockOf(first.start_min)} ${first.title}` : "No calls"))));
    }
    const e = cd.event;
    const mins = e ? e.start_min - this.now : null;
    let value = 0, color = c.event, big = "";
    if (cd.tone === "live") { value = (this.now - e.start_min) / Math.max(1, e.end_min - e.start_min); color = c.live; big = "on"; }
    else if (cd.tone === "clear") { value = 1; color = t.done ?? t.ansi2; big = "✓"; }
    else { value = Math.max(0, 1 - mins / 60); color = cd.tone === "soon" ? c.soon : c.event; big = mins < 60 ? String(mins) : `${Math.floor(mins / 60)}h`; }
    const url = joinUrl(e);
    const name = cd.tone === "clear" ? "Clear" : String(e?.title ?? "").replace(/^\[[^\]]+\]\s*/, "");
    return base.cursor_pointer().hover(s => s.bg(t.hover))
      .tooltip(e ? `${e.title}\n${clockOf(e.start_min)} to ${clockOf(e.end_min)}\n${url ? "Click to join the call" : "Click to open Calendar"}` + (this.allDay.length ? `\n\nAll day: ${this.allDay.map(a => a.title).join(", ")}` : "") : "Nothing else today")
      .on_click((_e, cx) => (url ? open(url) : cd.tone === "clear" && this.next ? this.step(Math.round((Date.parse(this.next.date) - Date.parse(this.today)) / 86400000), cx) : exec(cli(), ["show", this.date])))
      .child(this.ring(t, value, color, big, cd.tone === "soon" || cd.tone === "live"))
      .child(v_flex().min_w(0)
        .child(div().truncate().font_semibold().text_color(t.foreground).child(name))
        .child(div().truncate().text_size(10).text_color(note ? (t.working ?? t.dim) : t.dim).child(note ?? (cd.tone === "clear"
          ? (this.next ? `Next ${dayLabel(this.next.date)} ${clockOf(this.next.first.start_min)}` : "Nothing else today")
          : [cd.sub, url ? "click joins" : ""].filter(Boolean).join(" · ")))));
  }

  ring(t, value, color, big, breathe) {
    const S = 30, cx0 = S / 2, r = S / 2 - 3, w = 3.5;
    const full = (b) => b.move_to(cx0, cx0 - r).arc_to(r, r, 0, false, true, cx0, cx0 + r).arc_to(r, r, 0, false, true, cx0, cx0 - r);
    const v = Math.max(0, Math.min(1, value)), a = 2 * Math.PI * v;
    const arc = v >= 0.999 ? full(PathBuilder.stroke(w))
      : PathBuilder.stroke(w).move_to(cx0, cx0 - r).arc_to(r, r, 0, v > 0.5, true, cx0 + r * Math.sin(a), cx0 - r * Math.cos(a));
    return div().id("ring").relative().flex_none().w(S).h(S)
      .child(window.paint_path(full(PathBuilder.stroke(w)).build(), alpha(t.border, 0.9)).absolute().top(0).left(0).size_full())
      .when(v > 0.01, el => el.child(div().absolute().inset_0().when(breathe, b => b.loop("opacity", { from: 0.5, to: 1, period: 1400 }))
        .child(window.paint_path(arc.build(), color).absolute().top(0).left(0).size_full())))
      .child(div().absolute().inset_0().flex().items_center().justify_center()
        .text_size(big.length > 2 ? 9 : 11).font_semibold().text_color(t.foreground).child(big));
  }
}
