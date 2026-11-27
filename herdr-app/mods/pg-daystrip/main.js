// Playground prototype: the day as a strip under the tab bar. Today's Outlook events sit
// on a 7am to 6pm line with a red now-line that moves each minute. The next meeting glows
// gold from 15 minutes out, and the chip on the right counts down to it (click joins its
// Zoom link). When today has nothing left, the strip shows the next day that has events.
// Clicking an event opens the Calendar panel on that day. Data comes from the kit's
// `day-view` CLI, which reads the Outlook calendar.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, exec, home, settings, theme, window } from "herdr";
import { addDays, clockOf, countdown, dayLabel, hasRest, hourLabel, iso, joinUrl, timed, windowOf } from "./lib/model.js";

const POLL_MS = 5 * 60 * 1000;
const LOOKAHEAD_DAYS = 7;
const cli = () => `${home()}/.local/bin/day-view`;
const open = (url) => exec("open", [url]);
const alpha = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex + Math.round(a * 255).toString(16).padStart(2, "0") : hex);
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
    this.now = nowMinutes(); this.width = 0;
    if (checking()) return;
    this.load(cx);
    cx.timer.every(POLL_MS, cx => { if (window()?.visible !== false) this.load(cx); });
    // The now-line moves on the minute, so the first tick waits for the next one.
    const toMinute = 60000 - (Date.now() % 60000) + 50;
    cx.timer.after(toMinute, cx => {
      this.tick(cx);
      cx.timer.every(60000, cx => this.tick(cx));
    });
  }

  tick(cx) {
    this.now = nowMinutes();
    // Past midnight, or the last event just ended: read again so the strip moves on.
    if (iso(new Date()) !== this.today || (this.date === this.today && !hasRest(this.events, this.now))) this.load(cx);
    cx.notify();
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const today = iso(new Date());
        let date = today, events = await readDay(today);
        if (!hasRest(events, nowMinutes())) {
          for (let i = 1; i <= LOOKAHEAD_DAYS; i++) {
            const d = addDays(today, i), ev = await readDay(d);
            if (timed(ev).length) { date = d; events = ev; break; }
          }
        }
        this.today = today; this.date = date; this.events = events;
        this.allDay = events.filter(e => e.all_day).map(e => e.title);
        this.error = null; this.loaded = true;
      } catch (e) { this.error = String(e?.message ?? e); }
      this.loading = false; this.now = nowMinutes();
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const zoom = Number(settings()?.zoom) || 1;
    const c = { event: t.ansi4 ?? t.accent, soon: t.ansi3 ?? t.working, live: t.ansi1 ?? t.blocked, free: t.dim };
    const isToday = this.date === this.today;
    const events = timed(this.events);
    const win = windowOf(this.events);
    const span = win.end - win.start, W = this.width;
    const x = (min) => Math.round(((Math.min(Math.max(min, win.start), win.end) - win.start) / span) * W);
    const cd = isToday ? countdown(this.events, this.now) : null;

    const frame = h_flex().id("pg-daystrip").size_full().min_w(0).px(8).pt(6).pb(2).text_size(11);
    const inner = h_flex().flex_1().min_w(0).h_full().rounded(10).border(1).border_color(t.border).bg(t.chrome).overflow_hidden();

    const label = v_flex().flex_none().w(92).h_full().justify_center().px(10).border_r(1).border_color(t.border)
      .child(div().font_semibold().text_color(t.foreground).child(isToday ? "Today" : dayLabel(this.date)))
      .child(div().text_size(10).text_color(t.dim).truncate().child(
        this.error ? "Calendar offline" : !this.loaded ? "Reading…" : isToday ? dayLabel(this.date) : "Next workday"));

    const ticks = [];
    for (let m = win.start; m <= win.end; m += 60) {
      ticks.push(div().absolute().left(x(m)).top(0).bottom(0).border_l(1).border_color(alpha(t.border, 0.7))
        .child(div().pl(3).text_size(9.5).text_color(t.dim).child(hourLabel(m))));
    }

    const block = (e, i) => {
      const live = isToday && e.start_min <= this.now && this.now < e.end_min;
      const soon = isToday && cd?.event === e && cd.tone === "soon";
      const free = e.kind === "free";
      const color = live ? c.live : soon ? c.soon : free ? c.free : c.event;
      const left = x(e.start_min), w = Math.max(6, x(e.end_min) - left - 2);
      return div().id(`ev-${i}`).absolute().left(left).w(w).top(17).bottom(5).rounded(5).overflow_hidden()
        .bg(alpha(color, free ? 0.12 : soon ? 0.32 : 0.26)).border_l(3).border_color(color)
        .cursor_pointer().hover(s => s.bg(alpha(color, 0.42)))
        .tooltip(`${e.title}\n${clockOf(e.start_min)} to ${clockOf(e.end_min)}${joinUrl(e) ? "\nClick to open the day in Calendar" : ""}`)
        .on_click(() => exec(cli(), ["show", this.date]))
        // The soon glow breathes on its own layer so the text stays steady.
        .when(soon, el => el.child(div().absolute().inset_0().bg(alpha(c.soon, 0.25)).loop("opacity", { from: 0, to: 1, period: 1600 })))
        .child(div().relative().px(5).pt(2).truncate().text_color(free ? t.dim : t.foreground).child(e.title));
    };

    const line = div().id("timeline").relative().flex_1().min_w(0).h_full().mx(8)
      .on_size_change((size, cx) => { const w = Math.round(size.width / zoom); if (w !== this.width) { this.width = w; cx.notify(); } })
      .children(ticks)
      // Time already gone today is shaded, so the strip reads as "what's left".
      .when(isToday && W > 0, el => el.child(div().absolute().left(0).top(14).bottom(3).w(x(this.now)).bg(alpha(t.background, 0.35))
        .transition("width", { duration: 1000, easing: "linear" })))
      .children(W > 0 ? events.map(block) : [])
      .when(isToday && W > 0 && this.now >= win.start && this.now <= win.end, el => el
        .child(div().id("now").absolute().left(x(this.now) - 1).top(12).bottom(2).w(2).rounded(1).bg(c.live)
          .transition("left", { duration: 1000, easing: "linear" }))
        .child(div().id("now-dot").absolute().left(x(this.now) - 4).top(9).w(8).h(8).rounded(4).bg(c.live)
          .transition("left", { duration: 1000, easing: "linear" })));

    const chip = this.chip(t, c, cd, isToday);
    return frame.child(inner.child(label).child(line).child(chip));
  }

  chip(t, c, cd, isToday) {
    const base = h_flex().id("chip").flex_none().w(210).h_full().items_center().gap(10).px(12).border_l(1).border_color(t.border);
    if (!isToday) {
      const first = timed(this.events).sort((a, b) => a.start_min - b.start_min)[0];
      return base.child(div().text_size(16).font_semibold().text_color(t.muted).child("Done"))
        .child(v_flex().min_w(0).child(div().truncate().text_color(t.foreground).child("Nothing left today"))
          .child(div().truncate().text_size(10).text_color(t.dim).child(first ? `First: ${clockOf(first.start_min)} ${first.title}` : "")));
    }
    const color = cd.tone === "live" ? c.live : cd.tone === "soon" ? c.soon : cd.tone === "clear" ? (t.ansi2 ?? t.done) : t.foreground;
    const url = joinUrl(cd.event);
    return base.cursor_pointer().hover(s => s.bg(t.hover))
      .tooltip(url ? "Click to join the call" : "Click to open Calendar")
      .on_click(() => (url ? open(url) : exec(cli(), ["show", this.date])))
      .child(div().flex_none().text_size(17).font_semibold().text_color(color)
        .when(cd.tone === "soon" || cd.tone === "live", el => el.loop("opacity", { from: 0.55, to: 1, period: 1400 }))
        .child(cd.big))
      .child(v_flex().min_w(0)
        .child(div().truncate().text_color(t.foreground).child(cd.title))
        .child(div().truncate().text_size(10).text_color(t.dim).child([cd.sub, url ? "click joins" : ""].filter(Boolean).join(" · "))));
  }
}
