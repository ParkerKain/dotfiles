// Playground prototype: a corner clock for the next call. It floats in the bottom-right
// corner of the work area, and only while a call is close: it fades in 15 minutes before
// your next busy event, its ring drains to zero, and it leaves a couple of minutes after
// the call starts. The rest of the time it renders nothing, so Herdr hides the block.
// Clicking joins the Zoom (or Teams or Meet) link, else opens the Calendar panel on today.
// `pg-clock.demo` (in the command palette) shows it for two minutes with a sample call.
import { View, div, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, exec, home, nextCommand, settings, theme, window as appWindow } from "herdr";
import { busy, clockOf, iso, joinUrl, timed } from "./lib/model.js";

const POLL_MS = 5 * 60 * 1000;
const LEAD_MIN = 15;      // show this long before a call
const STAY_MIN = 2;       // and this long after it starts
const RING = 46;
const cli = () => `${home()}/.local/bin/day-view`;
const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  return m ? "#" + m[1] + Math.round(a * (m[2] ? parseInt(m[2], 16) / 255 : 1) * 255).toString(16).padStart(2, "0") : hex;
};
const nowSec = () => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); };

// The call to show at `sec` (seconds since midnight), or null.
export function pick(events, sec) {
  const calls = timed(events).filter(busy).sort((a, b) => a.start_min - b.start_min);
  return calls.find(e => sec >= (e.start_min - LEAD_MIN) * 60 && sec < (e.start_min + STAY_MIN) * 60) ?? null;
}

export default class CornerClock extends View {
  init(_props, cx) {
    this.events = []; this.today = iso(new Date()); this.loading = false;
    this.sec = nowSec(); this.demoUntil = 0; this.shown = false; this.visibleId = null;
    if (checking()) return;
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "demo") { this.demoUntil = Date.now() + 120000; this.demoStart = Math.floor(nowSec() / 60) + 12; }
        else if (command === "refresh") this.load(cx);
        this.tick(cx);
      }
    });
    this.load(cx);
    cx.timer.every(POLL_MS, cx => { if (appWindow()?.visible !== false) this.load(cx); });
    // Ticks every 5 seconds so the ring drains smoothly enough at this size.
    cx.timer.every(5000, cx => this.tick(cx));
  }

  tick(cx) {
    this.sec = nowSec();
    if (iso(new Date()) !== this.today) { this.today = iso(new Date()); this.load(cx); }
    this.sync(cx);
    cx.notify();
  }

  // Phase flag: a newly shown call first draws at opacity 0, then fades in a frame later.
  sync(cx) {
    const e = this.current();
    const key = e ? `${e.title}@${e.start_min}` : null;
    if (key === this.visibleId) return;
    this.visibleId = key; this.shown = false;
    if (key) cx.timer.after(40, cx => { if (this.visibleId === key) { this.shown = true; cx.notify(); } });
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      const r = await exec(cli(), ["day", iso(new Date())], { timeout: 30000 }).catch(() => ({ stdout: "" }));
      try { const v = JSON.parse(r.stdout); if (v?.ok) this.events = v.events ?? []; } catch { /* keep the last read */ }
      this.loading = false;
      this.sync(cx);
      cx.notify();
    });
  }

  current() {
    if (Date.now() < this.demoUntil) {
      return { title: "[MLT] Discovery 1 (sample)", start_min: this.demoStart, end_min: this.demoStart + 60, kind: "busy", location: "" };
    }
    return pick(this.events, this.sec);
  }

  render() {
    const t = theme();
    const e = this.current();
    if (!e) return div();

    const zoom = Number(settings()?.zoom) || 1;
    const left = e.start_min * 60 - this.sec;              // seconds to the start, negative once live
    const live = left <= 0;
    const value = live ? 0 : Math.min(1, left / (LEAD_MIN * 60));
    const color = live ? (t.blocked ?? t.ansi1) : left <= 5 * 60 ? (t.blocked ?? t.ansi1) : (t.working ?? t.ansi3);
    const url = joinUrl(e);
    const big = live ? "now" : String(Math.ceil(left / 60));

    const panel = h_flex().id("pg-clock").gap(10).px(10).py(6).items_center().cursor_pointer()
      .opacity(this.shown ? 1 : 0).transition("opacity", { duration: 500, easing: "ease-out" })
      .tooltip(url ? "Click to join the call" : "Click to open Calendar")
      .on_click(() => (url ? exec("open", [url]) : exec(cli(), ["show", iso(new Date())])))
      .child(this.ring(t, value, color, zoom, big, live))
      .child(v_flex().w(150).min_w(0).text_size(11)
        .child(div().truncate().font_semibold().text_color(t.foreground).child(e.title.replace(/^\[[^\]]+\]\s*/, "")))
        .child(div().truncate().text_size(10).text_color(t.dim).child(`${clockOf(e.start_min)} · ${url ? "click joins" : "click opens Calendar"}`)));
    return panel;
  }

  ring(t, value, color, zoom, big, live) {
    const c = RING / 2, r = RING / 2 - 4, w = 5;  // paint_path takes layout px here (zoom applied by Herdr)
    const full = (b) => b.move_to(c, c - r).arc_to(r, r, 0, false, true, c, c + r).arc_to(r, r, 0, false, true, c, c - r);
    const a = 2 * Math.PI * value;
    const arc = value >= 0.999 ? full(PathBuilder.stroke(w))
      : PathBuilder.stroke(w).move_to(c, c - r).arc_to(r, r, 0, value > 0.5, true, c + r * Math.sin(a), c - r * Math.cos(a));
    return div().relative().flex_none().w(RING).h(RING)
      .child(window.paint_path(full(PathBuilder.stroke(w)).build(), alpha(t.border, 0.9)).absolute().top(0).left(0).size_full())
      .when(value > 0.004, el => el.child(window.paint_path(arc.build(), color).absolute().top(0).left(0).size_full()))
      .child(div().absolute().inset_0().flex().items_center().justify_center()
        .text_size(big.length > 2 ? 11 : 15).font_semibold().text_color(live ? color : t.foreground)
        .when(live, el => el.loop("opacity", { from: 0.5, to: 1, period: 1200 }))
        .child(big));
  }
}
