// run-once: a popup that runs one command in an interactive zsh (so .zshrc
// functions like demo-on/demo-off exist), then closes. Up/down cycles recent
// commands; on failure the output stays visible.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { closeOverlay, exec, home, props, theme } from "herdr";

const recent = ["demo-on", "demo-off"];

export default class RunOnce extends View {
  init(_props, cx) {
    this.busy = false;
    this.error = "";
    this.cursor = -1;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "demo-on, demo-off, ..." });
    this.input.on("change", (_e, cx) => { this.error = ""; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.run(this.input.value(), cx));
    this.input.focus();
  }

  recall(step, cx) {
    this.cursor = (this.cursor + step + recent.length) % recent.length;
    this.input.set_value(recent[this.cursor]);
    cx.notify();
  }

  run(text, cx) {
    const cmd = text.trim();
    if (this.busy || !cmd) return;
    this.busy = true;
    this.error = "";
    const i = recent.indexOf(cmd);
    if (i >= 0) recent.splice(i, 1);
    recent.unshift(cmd);
    cx.notify();
    cx.spawn(async cx => {
      const r = await exec("zsh", ["-ic", cmd], { cwd: home(), timeout: 120000 });
      this.busy = false;
      if (r.code === 0) { closeOverlay(props().overlay); return; }
      const out = (r.stderr.trim() || r.stdout.trim()).split("\n").slice(-3).join("\n");
      this.error = `exit ${r.code}${out ? `: ${out}` : ""}`;
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const chip = (name) => div().cursor_pointer().px(9).py(4).rounded(6).bg(t.raised).text_color(t.muted).child(name)
      .on_click((_e, cx) => { this.input.set_value(name); this.run(name, cx); });
    return v_flex().id("run-once").track_focus(this.handle).w_full().h_full().p(16).gap(10).bg(t.popover)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && !this.busy) { closeOverlay(props().overlay); cx.stop_propagation(); }
        if (e.key === "up") { this.recall(1, cx); cx.stop_propagation(); }
        if (e.key === "down") { this.recall(-1, cx); cx.stop_propagation(); }
      })
      .child(Input.new(this.input))
      .child(h_flex().items_center().gap(8)
        .child(chip("demo-on"))
        .child(chip("demo-off"))
        .child(div().text_size(11).text_color(t.dim).child(this.busy ? "Running…" : "Enter runs · ↑↓ recent · Esc closes")))
      .when(Boolean(this.error), el => el.child(div().text_size(12).text_color(t.blocked).child(this.error)));
  }
}
