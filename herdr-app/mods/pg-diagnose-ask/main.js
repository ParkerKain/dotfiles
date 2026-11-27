// Playground prototype: the Diagnose question as a panel that drops down from the top of the
// work area (a floating block, like the Lock-in pins), instead of a popup under the pane
// header. Popups in a pane-header mod have no reliable position, so the header (pg-diagnose)
// only marks which pane is being asked about, and this panel does the asking: the agent's
// last line quoted, "What went wrong in <session>?", an input. Enter forks the pane the way
// diagnose-session does (herdr-delegate fork --pane <pane> -- <text>); Esc rolls it back up.
//
// Opened by `pg-diagnose-ask.open`, which pg-diagnose sends with the pane in
// shared("pg-diagnose.ask") = { pane, terminal, name, at }.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { checking, exec, hc, home, nextCommand, run, setShared, shared, theme } from "herdr";
import { lastLine } from "./lib/lastline.js";

const W = 760, H = 150;
const GROW_MS = 260;
const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  return m ? "#" + m[1] + Math.round(a * (m[2] ? parseInt(m[2], 16) / 255 : 1) * 255).toString(16).padStart(2, "0") : hex;
};
const solid = (hex) => (/^#[0-9a-f]{6}/i.test(hex ?? "") ? hex.slice(0, 7) + "fa" : hex);

export default class DiagnoseAsk extends View {
  init(_props, cx) {
    this.open = false; this.grown = false; this.busy = false; this.error = ""; this.quote = ""; this.target = null;
    this.input = InputState.new({ placeholder: "Describe the behavior you expected in one sentence" });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    if (checking()) return;
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "open") this.show(cx);
        else if (command === "close") this.hide(cx);
        cx.notify();
      }
    });
  }

  show(cx) {
    const ask = shared("pg-diagnose.ask");
    if (!ask?.pane || Date.now() - (ask.at ?? 0) > 3000) return;
    this.target = ask; this.error = ""; this.busy = false; this.quote = "";
    this.open = true; this.grown = false;
    this.input.set_value("");
    this.input.focus();
    // Phase flag: mount at height 0, then grow.
    cx.timer.after(30, cx => { if (this.open) { this.grown = true; cx.notify(); } });
    this.readQuote(cx);
  }

  hide(cx) {
    if (!this.open) return;
    this.grown = false;
    this.input.blur();
    setShared("pg-diagnose.ask", null);
    run("pg-diagnose.clear");
    cx.timer.after(GROW_MS + 30, cx => { if (!this.grown) { this.open = false; cx.notify(); } });
    cx.notify();
  }

  readQuote(cx) {
    const terminal = this.target?.terminal;
    if (!terminal) return;
    cx.spawn(async cx => {
      const r = await hc(["read", terminal, "--lines", "40"]).catch(() => null);
      if (!this.open) return;
      this.quote = r?.code === 0 ? lastLine(r.stdout) : "";
      cx.notify();
    });
  }

  submit(cx) {
    const feedback = this.input.value().trim();
    const pane = this.target?.pane;
    if (!feedback || !pane || this.busy) return;
    this.busy = true; this.error = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await exec(`${home()}/.local/bin/herdr-delegate`, ["fork", "--pane", pane, "--", feedback], { timeout: 90000 });
        if (r.code === 0) { this.busy = false; this.hide(cx); return; }
        this.error = r.stderr.trim() || "Herdr could not launch the diagnostic fork.";
      } catch (e) { this.error = String(e?.message ?? e); }
      this.busy = false;
      cx.notify();
    });
  }

  render() {
    if (!this.open) return div();
    const t = theme();
    const name = this.target?.name ?? "this session";
    const hint = this.error || (this.busy ? "Opening diagnostic fork…" : "↵ fork a diagnostic agent · esc cancel");
    return v_flex().id("pg-diagnose-ask").w(W).h(this.grown ? H : 0).overflow_hidden()
      .transition("height", { duration: GROW_MS, easing: "ease-out" })
      .bg(solid(t.chrome))
      .on_key_down((e, cx) => { if (e.key === "escape" && !this.busy) { this.hide(cx); cx.stop_propagation(); } })
      .child(v_flex().px(16).pt(12).pb(12).gap(9)
        .opacity(this.grown ? 1 : 0).transition("opacity", { duration: GROW_MS + 80, easing: "ease-out" })
        .child(h_flex().gap(8).items_start().min_w(0)
          .child(div().w(2).h(30).flex_none().rounded(1).bg(alpha(t.accent, 0.8)))
          .child(div().flex_1().min_w(0).h(30).overflow_hidden().text_size(11.5).italic().text_color(t.dim)
            .child(this.quote ? `“${this.quote}”` : "Reading the last line…")))
        .child(div().text_size(13).font_semibold().text_color(t.foreground).truncate().child(`What went wrong in ${name}?`))
        .child(div().px(8).py(5).rounded(7).border_1()
          .border_color(this.error ? t.blocked : alpha(t.accent, 0.7)).bg(t.background)
          .child(Input.new(this.input)))
        .child(div().text_size(11).truncate().text_color(this.error ? t.blocked : t.muted)
          .when(this.busy, el => el.loop("opacity", { from: 0.5, to: 1, period: 1200 }))
          .child(hint)));
  }
}
