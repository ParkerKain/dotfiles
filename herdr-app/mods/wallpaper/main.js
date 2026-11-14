// wallpaper: Cmd+Shift+B popup to pick the image behind the Frosted layout.
// Reads the thumbnails and index that `frost.py --thumbs` writes to mods/wallpaper-thumbs,
// and applies a pick by running frost.py, then switches to the Frosted layout.
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { closeOverlay, exec, home, props, readTextFile, run, theme } from "herdr";

const COLS = 4;
const GROUPS = ["digital", "photo", "rose-pine", "art"];
const LABELS = { digital: "Digital", photo: "Photos", "rose-pine": "Rose Pine", art: "Paintings and prints" };

export default class Wallpaper extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.scroll = ScrollHandle.new();
    this.items = [];
    this.rows = [];
    this.sel = 0;
    this.blur = 0;
    this.current = null;
    this.busy = false;
    this.error = "";
    cx.spawn(async cx => {
      const dir = `${home()}/.config/herdr-app/mods/wallpaper-thumbs`;
      const index = JSON.parse((await readTextFile(`${dir}/index.json`)) || "[]");
      const cur = JSON.parse((await readTextFile(`${dir}/current.json`)) || "null");
      const rank = g => (GROUPS.indexOf(g) + 1 || GROUPS.length + 1);
      this.items = index.sort((a, b) => rank(a.group) - rank(b.group));
      if (cur) { this.current = cur.path; this.blur = cur.blur ? 90 : 0; }
      this.layoutRows();
      const at = this.items.findIndex(w => w.path === this.current);
      if (at >= 0) this.sel = at;
      if (!this.items.length) this.error = "No thumbnails yet. Run: python3 ~/dotfiles/herdr-app/frost.py --thumbs";
      cx.notify();
      this.reveal();
    });
  }

  // Scroll children are rows: a group heading, then rows of COLS cards. rowOf maps item -> row.
  layoutRows() {
    this.rows = [];
    this.rowOf = [];
    let group = null, row = null;
    this.items.forEach((w, i) => {
      if (w.group !== group) {
        group = w.group;
        this.rows.push({ heading: LABELS[group] ?? group });
        row = null;
      }
      if (!row || row.items.length === COLS) { row = { items: [] }; this.rows.push(row); }
      row.items.push(i);
      this.rowOf[i] = this.rows.length - 1;
    });
  }

  reveal() { if (this.rowOf?.[this.sel] !== undefined) this.scroll.scroll_to_item(this.rowOf[this.sel]); }

  // Up/down move to the card in the same column of the previous/next row, across group headings.
  step(dir) {
    const r = this.rowOf[this.sel], col = this.rows[r].items.indexOf(this.sel);
    for (let k = r + dir; k >= 0 && k < this.rows.length; k += dir) {
      const items = this.rows[k].items;
      if (items) return items[Math.min(col, items.length - 1)];
    }
    return this.sel;
  }

  move(next, cx) {
    this.sel = Math.max(0, Math.min(this.items.length - 1, next));
    this.reveal();
    cx.notify();
  }

  apply(i, cx) {
    const w = this.items[i];
    if (!w || this.busy) return;
    this.busy = true;
    this.sel = i;
    this.error = "";
    cx.notify();
    cx.spawn(async cx => {
      const r = await exec("python3", [`${home()}/dotfiles/herdr-app/frost.py`, w.path, "--blur", String(this.blur)], { timeout: 60000 });
      this.busy = false;
      if (r.code !== 0) {
        this.error = (r.stderr.trim() || r.stdout.trim()).split("\n").pop();
      } else {
        this.current = w.path;
        run("layout.switch", { name: "Frosted" });
      }
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const key = k => div().px(5).rounded(4).border_1().border_color(t.border).text_size(11).text_color(t.muted).child(k);
    const card = i => {
      const w = this.items[i], selected = i === this.sel, current = w.path === this.current;
      return v_flex().id(`w-${i}`).w(178).gap(5).p(5).rounded(9).cursor_pointer()
        .border_2().border_color(selected ? t.accent : "#00000000")
        .bg(selected ? t.selected : "#00000000")
        .hover(s => s.bg(t.hover))
        .child(image(w.thumb).w(166).h(104).rounded(6))
        .child(h_flex().gap(5).items_center().text_size(11.5)
          .child(div().flex_1().truncate().text_color(selected ? t.foreground : t.muted).child(w.name))
          .when(current, el => el.child(div().text_color(t.accent).child("●"))))
        .on_click((_e, cx) => this.apply(i, cx));
    };
    const rows = this.rows.map((r, k) => r.heading
      ? div().id(`h-${k}`).pt(k ? 14 : 2).pb(4).px(6).text_size(12).font_semibold().text_color(t.dim).child(r.heading)
      : h_flex().id(`r-${k}`).gap(6).children(r.items.map(card)));

    return v_flex().id("wallpaper").track_focus(this.handle).size_full().bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") closeOverlay(props().overlay);
        else if (k === "left") this.move(this.sel - 1, cx);
        else if (k === "right") this.move(this.sel + 1, cx);
        else if (k === "up") this.move(this.step(-1), cx);
        else if (k === "down") this.move(this.step(1), cx);
        else if (k === "enter") this.apply(this.sel, cx);
        else if (k === "b") { this.blur = this.blur ? 0 : 90; cx.notify(); }
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center().justify_between().px(16).py(11).border_b(1).border_color(t.border)
        .child(h_flex().items_center().gap(8).text_size(14).font_semibold()
          .child("Wallpaper")
          .child(div().text_size(12).font_normal().text_color(t.dim).child(`${this.items.length}`)))
        .child(h_flex().id("blur").items_center().gap(6).cursor_pointer().px(9).py(3).rounded(6)
          .border_1().border_color(this.blur ? t.accent : t.border).text_size(12)
          .text_color(this.blur ? t.accent : t.muted)
          .child(this.blur ? "Frosted (blur on)" : "Sharp (blur off)")
          .on_click((_e, cx) => { this.blur = this.blur ? 0 : 90; cx.notify(); })))
      .child(div().id("grid").flex_1().min_h(0).px(10).py(8).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(rows))
      .child(h_flex().items_center().justify_between().px(16).py(8).border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(this.error ? div().text_color(t.blocked).truncate().child(this.error)
          : this.busy ? div().text_color(t.working).child("Applying…")
          : div().truncate().child(this.items[this.sel]?.name ?? ""))
        .child(h_flex().items_center().gap(5)
          .child(key("↵")).child("apply").child(key("←↑↓→")).child("move")
          .child(key("b")).child("blur").child(key("esc")).child("close")));
  }
}
