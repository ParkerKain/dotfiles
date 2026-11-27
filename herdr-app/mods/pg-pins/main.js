// Playground prototype: Lock-in as pins on a two-week line, shown only when asked (round 3
// pick A). It's a floating block at the top of the work area that renders nothing until
// `pg-pins.pick` (Cmd+Shift+S in Playground, or the status-bar glance). Then a line from
// today to two weeks out drops down under the day strip, one pin per session not locked in,
// each with a letter. A letter starts a fix in the session launcher (Shift+letter opens the
// session in Ops); Esc, or a pick, tucks the line away and hands the keyboard back.
// Data: the kit's `lock-in flags`, read every 5 minutes.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { checking, exec, focused, home, nextCommand, openOverlay, run, settings, theme, window as appWindow } from "herdr";
import { decode, fixTask, hintFor, hintIndex } from "./lib/model.js";

const POLL_MS = 5 * 60 * 1000;
const SPAN_DAYS = 14;
const W = 880, H = 72;      // layout px
const PAD = 22;
const DROP_MS = 220;
const cli = () => `${home()}/.local/bin/lock-in`;
const vault = () => `${home()}/Documents/internal/repos/devclarity-vault`;
const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  return m ? "#" + m[1] + Math.round(a * (m[2] ? parseInt(m[2], 16) / 255 : 1) * 255).toString(16).padStart(2, "0") : hex;
};
const code = (name) => (String(name).match(/^\[([^\]]+)\]/) ?? [])[1] ?? String(name).split(/\s+/)[0];

// Sessions sharing a day stack upward so their labels don't collide.
export function place(flags) {
  const perDay = {};
  return flags
    .filter(f => f.days != null && f.days <= SPAN_DAYS)
    .sort((a, b) => a.days - b.days)
    .map(f => { const n = perDay[f.days] = (perDay[f.days] ?? 0) + 1; return { flag: f, x: PAD + ((W - 2 * PAD) * Math.max(0, f.days)) / SPAN_DAYS, row: n - 1 }; });
}

export default class Pins extends View {
  init(_props, cx) {
    this.report = null; this.error = null; this.loading = false;
    this.open = false; this.dropped = false; this.returnPane = null;
    this.handle = cx.focus_handle();
    if (checking()) return;
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "pick" || command === "toggle") { if (this.open) this.close(cx); else this.show(cx); }
        else if (command === "refresh") this.load(cx);
        cx.notify();
      }
    });
    this.load(cx);
    cx.timer.every(POLL_MS, cx => { if (appWindow()?.visible !== false) this.load(cx); });
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      const r = await exec(cli(), ["flags"], { timeout: 45000 }).catch(e => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
      const { report, error } = decode(r.stdout, r.stderr, r.code);
      if (report) this.report = report;
      this.error = error; this.loading = false;
      cx.notify();
    });
  }

  flags() { return (this.report?.flags ?? []).slice().sort((a, b) => (a.days ?? 99) - (b.days ?? 99)); }

  show(cx) {
    this.open = true; this.dropped = false;
    this.returnPane = focused()?.pane ?? null;
    this.handle.focus();
    // Phase flag: mount at height 0, then drop to full height.
    cx.timer.after(30, cx => { if (this.open) { this.dropped = true; cx.notify(); } });
    this.load(cx);
  }

  close(cx) {
    this.dropped = false;
    if (this.handle.is_focused() && this.returnPane) run("pane.focus", { pane: this.returnPane });
    cx.timer.after(DROP_MS + 20, cx => { if (!this.dropped) { this.open = false; cx.notify(); } });
    cx.notify();
  }

  fix(flag, cx) {
    this.close(cx);
    openOverlay({ mod: "session-launcher", kind: "dialog", width: 560, height: 300, props: { task: fixTask(flag, vault()) } });
  }

  key(e, cx) {
    const flags = this.flags();
    const i = hintIndex(e.key, flags.length);
    if (e.keystroke === "escape") this.close(cx);
    else if (e.keystroke === "r") this.load(cx);
    else if (!e.modifiers.platform && !e.modifiers.control && !e.modifiers.alt && i >= 0) {
      if (e.modifiers.shift) { exec("open", [flags[i].hub_url]); this.close(cx); } else this.fix(flags[i], cx);
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    if (!this.open) return div();
    const t = theme();
    const flags = this.flags();
    const hintOf = new Map(flags.map((f, i) => [f.id, hintFor(i)]));
    const placed = place(flags);
    const later = flags.length - placed.length;
    const tone = (f) => f.urgency === "red" ? (t.blocked ?? t.ansi1) : f.days <= 7 ? (t.working ?? t.ansi3) : (t.ansi5 ?? t.accent);
    const axisY = H - 20;
    const tick = (d, label) => div().absolute().left(PAD + ((W - 2 * PAD) * d) / SPAN_DAYS - 20).w(40).top(axisY + 5)
      .flex().justify_center().text_size(9.5).text_color(t.dim).child(label);

    const pins = placed.map(({ flag: f, x, row }) => {
      const color = tone(f), hint = hintOf.get(f.id);
      const top = axisY - 18 - row * 17;
      return div().id(`pin-${f.id}`).absolute().left(Math.round(x) - 60).w(120).top(top).h(16)
        .flex().flex_col().items_center()
        .cursor_pointer().on_click((_e, cx) => this.fix(f, cx))
        .tooltip([f.name, `${f.when_label ?? ""} · ${f.relative_label ?? ""}`, f.short_reason || f.reason, "Click or letter: fix · Shift+letter: open in Ops"].filter(Boolean).join("\n"))
        .child(h_flex().gap(4).items_center().text_size(10.5)
          .when(Boolean(hint), el => el.child(div().px(3).rounded(3).bg(t.accent).text_color(t.background).font_semibold().text_size(9.5).child(hint)))
          .child(div().whitespace_nowrap().text_color(color).font_semibold().child(code(f.name))));
    });
    const dots = placed.filter(p => p.row === 0).map(({ flag: f, x }) =>
      div().absolute().left(Math.round(x) - 5).top(axisY - 4).w(10).h(10).rounded(5).bg(tone(f)).border_2().border_color(t.background)
        .when(f.urgency === "red", el => el.loop("opacity", { from: 0.35, to: 1, period: 1200 })));

    return div().id("pg-pins").track_focus(this.handle).relative().w(W)
      .h(this.dropped ? H : 0).overflow_hidden().transition("height", { duration: DROP_MS, easing: "ease-out" })
      .on_key_down((e, cx) => this.key(e, cx))
      .child(div().absolute().left(PAD).right(PAD).top(axisY).h(2).rounded(1).bg(alpha(t.foreground, 0.25)))
      .child(tick(0, "today")).child(tick(7, "+7d")).child(tick(14, "+14d"))
      .children(dots).children(pins)
      .child(div().absolute().right(8).top(4).text_size(9.5).text_color(t.dim)
        .child(this.error ? "Lock-in offline" : later > 0 ? `+${later} later · esc` : "letter fixes · esc"));
  }
}
