// look-presets: the saved looks in herdr-app/looks/ (theme, fonts, Frosted wallpaper), with Enter
// to switch to one. herdr-app/look.py does the work: `look.py save <slug>` adds a preset from the
// look showing now, and `look.py apply <slug>` is what Enter runs.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, checking, closeOverlay, exec, props, theme, themes } from "herdr";

export default class LookPresets extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.items = [];
    this.current = null;
    this.sel = 0;
    this.error = "";
    if (checking()) return;
    cx.spawn(async cx => {
      try {
        // look.py sits two folders above this mod's real folder (herdr-app/mods/look-presets).
        const dir = (await exec("readlink", ["-f", `${appHome()}/mods/look-presets`])).stdout.trim();
        this.lookPy = dir.replace(/\/mods\/look-presets$/, "/look.py");
        const list = await exec("python3", [this.lookPy, "list", "--json"]);
        const now = await exec("python3", [this.lookPy, "current"]);
        this.items = JSON.parse(list.stdout || "[]");
        this.current = JSON.parse(now.stdout || "null");
        const at = this.items.findIndex(x => this.matches(x));
        if (at >= 0) this.sel = at;
        if (!this.items.length) this.error = "No presets yet. Save one with: python3 ~/dotfiles/herdr-app/look.py save <name>";
      } catch (e) {
        this.error = `Could not read presets: ${e?.message ?? e}`;
      }
      cx.notify();
    });
  }

  matches(x) {
    const c = this.current;
    return !!c && x.theme === c.theme && x.font === c.font && x.ui_font === c.ui_font
      && (x.wallpaper?.path ?? null) === (c.wallpaper?.path ?? null);
  }

  apply(i) {
    const x = this.items[i];
    if (!x || !this.lookPy) return;
    // Applying visits each layout to set its theme, which would close this popup anyway. The
    // process keeps running after the popup goes.
    exec("python3", [this.lookPy, "apply", x.slug], { timeout: 600000 });
    closeOverlay(props().overlay);
  }

  render() {
    const t = theme();
    const palette = Object.fromEntries(themes().map(th => [th.name, th.colors]));
    const key = s => div().px(5).rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.muted).child(s);
    const row = (x, i) => {
      const c = palette[x.theme] ?? {};
      const on = i === this.sel, now = this.matches(x);
      const swatch = col => div().w(12).h(12).rounded(3).bg(col ?? t.border).border_1().border_color(t.border);
      return h_flex().id(`p-${i}`).gap(10).items_center().px(10).py(8).rounded(8).cursor_pointer()
        .border_1().border_color(on ? t.accent : "#00000000").bg(on ? t.selected : "#00000000")
        .hover(s => s.bg(t.hover))
        .on_click(() => this.apply(i))
        .child(h_flex().gap(3).flex_none()
          .child(swatch(c.background)).child(swatch(c.accent)).child(swatch(c.ansi2)).child(swatch(c.ansi4)).child(swatch(c.ansi5)))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().gap(6).items_center()
            .child(div().text_size(13.5).font_semibold().truncate().child(x.name ?? x.slug))
            .when(now, el => el.child(div().text_size(10.5).text_color(t.accent).child("showing now"))))
          .child(div().text_size(11).text_color(t.muted).truncate()
            .child(`${x.theme} · ${x.font ?? "default font"} · ${x.ui_font ?? "default UI font"}`)));
    };
    return v_flex().id("look-presets").track_focus(this.handle).size_full().bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") closeOverlay(props().overlay);
        else if (k === "down" || k === "j") { this.sel = Math.min(this.items.length - 1, this.sel + 1); cx.notify(); }
        else if (k === "up" || k === "k") { this.sel = Math.max(0, this.sel - 1); cx.notify(); }
        else if (k === "enter") this.apply(this.sel);
        else return;
        cx.stop_propagation();
      })
      .child(div().px(14).py(10).border_b(1).border_color(t.border).text_size(13).font_semibold().child("Look presets"))
      .child(v_flex().id("list").flex_1().min_h(0).p(8).gap(4).overflow_y_scrollbar()
        .when(!!this.error, el => el.child(div().p(8).text_size(12).text_color(t.muted).child(this.error)))
        .children(this.items.map(row)))
      .child(h_flex().items_center().gap(5).px(14).py(7).border_t(1).border_color(t.border).text_size(10.5).text_color(t.dim)
        .child(key("↵")).child("switch").child(key("↑↓")).child("move").child(key("esc")).child("close")
        .child(div().flex_1())
        .child("save the current look: look.py save <name>"));
  }
}
