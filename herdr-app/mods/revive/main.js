// revive: Cmd+Shift+R popup listing recently killed terminals (newest first) with the
// last screen of the selected one. Enter brings it back in a new tab: Claude and Codex
// sessions resume their conversation, shells reopen in their folder. revive.py does
// the lookups (hc for the terminals, ~/.claude and ~/.codex for session ids).
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { appHome, closeOverlay, exec, hc, notify, props, run, settings, spaces, theme } from "herdr";

const HELPER = `${appHome()}/mods/revive/revive.py`;
const KINDS = { claude: "Claude", codex: "Codex", shell: "Shell" };

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Codex titles its terminal "<task> | <folder>"; drop the folder.
function label(row) {
  const base = row.cwd.split("/").pop();
  const title = (row.title || row.name || "").replace(new RegExp(` \\| ${base}$`), "");
  return title || row.tab || row.address;
}

function tabName(row) {
  return /^\d*$/.test(row.tab) ? label(row).slice(0, 40) : row.tab;
}

export default class Revive extends View {
  init(_props, cx) {
    this.rows = [];
    this.selected = 0;
    this.loading = true;
    this.busy = false;
    this.error = "";
    this.list = ScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Filter killed sessions…" });
    this.input.on("change", (_e, cx) => { this.selected = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.restore(cx));
    this.input.focus();
    cx.spawn(async cx => {
      const r = await exec("python3", [HELPER, "list"], { timeout: 20000 });
      this.loading = false;
      if (r.code === 0) this.rows = JSON.parse(r.stdout);
      else this.error = r.stderr.trim().split("\n").pop() || "Could not list terminals.";
      cx.notify();
    });
  }

  visible() {
    const q = this.input.value().trim().toLowerCase();
    if (!q) return this.rows;
    return this.rows.filter(r => [label(r), r.where, r.kind, r.address].join(" ").toLowerCase().includes(q));
  }

  move(step, cx) {
    const n = this.visible().length;
    if (!n) return;
    this.selected = Math.min(n - 1, Math.max(0, this.selected + step));
    this.list.scroll_to_item(this.selected);
    cx.notify();
  }

  restore(cx) {
    const row = this.visible()[this.selected];
    if (!row || this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async cx => {
      const r = await exec("python3", [HELPER, "resume", row.address], { timeout: 30000 });
      if (r.code !== 0) {
        this.busy = false;
        this.error = r.stderr.trim().split("\n").pop() || "Could not find how to restore it.";
        cx.notify();
        return;
      }
      const plan = JSON.parse(r.stdout);
      const args = { name: tabName(row), folder: row.cwd };
      if (spaces().some(s => s.id === row.space)) args.space = row.space;
      if (plan.argv) args.argv = plan.argv;
      run("tab.new", args);
      await hc(["label", row.address, `revive.restored=${Date.now()}`]);
      notify({ title: `Restored ${label(row)}`, body: plan.how, level: "success", timeout: 4000 });
      closeOverlay(props().overlay);
    });
  }

  hide(cx) {
    const row = this.visible()[this.selected];
    if (!row) return;
    this.rows = this.rows.filter(r => r !== row);
    this.selected = Math.min(this.selected, Math.max(0, this.visible().length - 1));
    cx.notify();
    cx.spawn(async () => { await hc(["label", row.address, "revive.hidden=1"]); });
  }

  render() {
    const t = theme();
    const mono = settings().font || "JetBrains Mono";
    const rows = this.visible();
    const current = rows[this.selected];
    const kindColor = { claude: t.accent, codex: t.done, shell: t.muted };
    const key = (k) => div().px(5).rounded(4).border_1().border_color(t.border).text_size(11).text_color(t.muted).child(k);

    const row = (r, i) => {
      const sel = i === this.selected;
      return v_flex().id(`row-${r.address}`).gap(2).px(10).py(7).rounded(7).cursor_pointer()
        .bg(sel ? t.selected : t.popover).hover(s => s.bg(sel ? t.selected : t.hover))
        .on_click((_e, cx) => { if (this.selected === i) this.restore(cx); else { this.selected = i; cx.notify(); } })
        .child(h_flex().items_center().gap(8)
          .child(div().flex_none().w(46).text_size(11).text_color(kindColor[r.kind]).child(KINDS[r.kind]))
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(label(r)))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(r.finished_ms))))
        .child(div().pl(54).truncate().text_size(11).text_color(t.muted)
          .child([r.where, r.parent ? `sub-agent of ${r.parent}` : "", r.reason === "exited" ? "exited" : ""].filter(Boolean).join(" · ")));
    };

    const empty = (text) => div().p(14).text_size(13).text_color(t.muted).child(text);
    const list = this.loading ? [empty("Loading…")] : rows.length ? rows.map(row) : [empty(this.rows.length ? "No matches." : "Nothing killed in the last 7 days.")];

    const preview = current
      ? v_flex().flex_1().min_w(0).min_h(0).overflow_hidden().gap(8)
        .child(h_flex().items_center().gap(8).text_size(12).text_color(t.muted)
          .child(div().text_color(kindColor[current.kind]).child(KINDS[current.kind]))
          .child(div().truncate().child(`${current.address} · ${current.cwd.replace(/^\/Users\/[^/]+/, "~")}`)))
        .child(v_flex().id("preview").flex_1().min_h(0).overflow_y_scroll().justify_end().p(10).rounded(8)
          .bg(t.background).border_1().border_color(t.border)
          .font_family(mono).text_size(11.5).text_color(t.foreground)
          .children(current.preview.length ? current.preview.map((l, i) => div().id(`l${i}`).whitespace_nowrap().child(l))
            : [div().text_color(t.dim).child("(blank screen)")]))
      : v_flex().flex_1();

    return v_flex().id("revive").track_focus(this.handle).size_full().p(14).gap(10).bg(t.popover)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && !this.busy) { closeOverlay(props().overlay); cx.stop_propagation(); }
        if (e.key === "down" || (e.key === "n" && e.modifiers.control)) { this.move(1, cx); cx.stop_propagation(); }
        if (e.key === "up" || (e.key === "p" && e.modifiers.control)) { this.move(-1, cx); cx.stop_propagation(); }
        if (e.key === "backspace" && e.modifiers.platform) { this.hide(cx); cx.stop_propagation(); }
      })
      .child(h_flex().items_center().gap(10).px(10).py(7).rounded(8).border_1().border_color(t.input).bg(t.background)
        .child(div().text_size(15).text_color(this.busy ? t.working : t.accent).child(this.busy ? "…" : "↺"))
        .child(div().flex_1().text_size(15).child(Input.new(this.input))))
      .child(h_flex().flex_1().min_h(0).gap(12)
        .child(v_flex().id("rows").track_scroll(this.list).w("42%").flex_none().h_full().overflow_y_scroll().gap(2).children(list))
        .child(preview))
      .child(h_flex().items_center().justify_between().text_size(11).text_color(t.dim)
        .child(div().text_color(this.error ? t.blocked : t.dim).child(this.error || (this.busy ? "Restoring…" : `${rows.length} killed in the last 7 days`)))
        .child(h_flex().items_center().gap(5)
          .child(key("↑↓")).child("select").child(key("↵")).child("restore").child(key("⌘⌫")).child("hide").child(key("esc")).child("close")));
  }
}
