// Pane header: a copy of the shipped `pane` header mod (icon, name, folder, status, hover
// buttons) that also asks the Diagnose question. `pane-header.diagnose` (Cmd+Shift+I, or
// "Diagnose" in the palette) reaches every shown header copy, and only the copy for the
// focused pane acts on it. That pane's header turns dark and a dark panel grows down out of
// it, exactly as wide as the pane, over the top of its terminal: the agent's last line quoted,
// "What went wrong in <session>?", and an input. Enter forks the pane the way the kit's
// diagnose-session mod does (herdr-delegate fork --pane <pane> -- <text>). Esc, clicking away
// or `pane-header.close` rolls it back up. Without ~/.local/bin/herdr-delegate (Omarchy) the
// header is the plain pane header and Diagnose does nothing.
//
// How the panel is placed (each of these was checked on screen):
// - A header does not clip its children, but the terminal is painted after the header, so an
//   absolutely positioned child under the header row ends up behind the terminal's text.
// - A gpui-base Popup paints above the terminal, and it anchors to its trigger correctly in a
//   pane header: the panel's top-left lands on the header's bottom-left, in any pane.
// - A Popup also keeps its content inside the window. A panel wider than the room to the
//   right of the header is pushed left, as far as the window's left edge. So the width has to
//   be the header's real width in layout px, and nothing may be added to its position.
//   on_size_change reports the header's width in window px, which is layout px times zoom.
//
// Wire it with pane.header.content.mod = "pane-header" in the layout.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Popup, InputState, Input } from "gpui-base";
import { checking, exec, focused, hc, home, layout, nextCommand, panes, props, run, settings, theme } from "herdr";
import { lastLine } from "./lib/lastline.js";

const PANEL_H = 150;
const DELEGATE = () => `${home()}/.local/bin/herdr-delegate`;
const GROW_MS = 260;

const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  return m ? "#" + m[1] + Math.round(a * (m[2] ? parseInt(m[2], 16) / 255 : 1) * 255).toString(16).padStart(2, "0") : hex;
};
// Frosted's theme colors are translucent. The panel sits over terminal text, so it is opaque.
const solid = (hex) => (/^#[0-9a-f]{6}/i.test(hex ?? "") ? hex.slice(0, 7) : hex);

// Match the first visible tab frame, including the active child of a stack.
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter(child => !child.hidden);
    children = [visible.find(child => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// The pane to ask about: the focused pane, or (when focus is in a palette or a fresh tab that
// hasn't reported a pane yet) the pane marked focused in the focused tab, else its only pane.
function targetPane() {
  const f = focused();
  if (f?.pane) return f.pane;
  const inTab = panes().filter(p => p.tab === f?.tab && p.terminal);
  return (inTab.find(p => p.focused) ?? (inTab.length === 1 ? inTab[0] : null))?.pane ?? null;
}

const nameOf = (p) => p.name || ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";

export default class PaneHeader extends View {
  init(_props, cx) {
    this.hovered = false;
    this.open = false;      // panel mounted
    this.grown = false;     // panel at full height (a moment after mounting, so it animates)
    this.closing = false;   // rolling back up, still mounted
    this.busy = false;
    this.error = "";
    this.quote = null;      // null while the last line is being read
    this.openedAt = 0;
    this.size = null;       // the header's size in window px, from on_size_change
    this.input = InputState.new({ placeholder: "Describe the behavior you expected in one sentence" });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.typing = false;    // the input has the keyboard
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    // Clicking away closes it. The guard skips the blur that can arrive while it opens.
    this.input.on("blur", (_e, cx) => {
      this.typing = false;
      if (this.open && !this.busy && Date.now() - this.openedAt > 400) this.collapse(cx);
      cx.notify();
    });
    // Diagnose needs herdr-delegate (the kit's, on the work Mac). Until it's found, it stays off.
    this.canDiagnose = false;
    if (checking()) return;
    cx.spawn(async cx => {
      const r = await exec("test", ["-x", DELEGATE()]).catch(() => null);
      this.canDiagnose = r?.code === 0;
      cx.notify();
    });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "diagnose") {
          if (targetPane() === props()?.pane) this.expand(cx);
          else this.collapse(cx);   // the question moved to another pane
        } else if (command === "close") this.collapse(cx);
        cx.notify();
      }
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  expand(cx) {
    if (!this.canDiagnose || !this.me()?.terminal) return;
    if (this.open && !this.closing) { this.input.focus(); return; }
    this.open = true; this.closing = false; this.grown = false; this.busy = false; this.error = "";
    this.quote = null; this.openedAt = Date.now();
    this.input.set_value("");
    this.input.focus();
    // Mount at height 0, then grow.
    cx.timer.after(30, cx => { if (this.open && !this.closing) { this.grown = true; cx.notify(); } });
    this.readQuote(cx);
  }

  collapse(cx) {
    if (!this.open || this.closing) return;
    this.closing = true;
    this.grown = false;
    this.input.blur();
    cx.notify();
    // Unmount once it has rolled up, unless it was asked again in the meantime.
    cx.timer.after(GROW_MS + 30, cx => { if (this.closing) { this.open = false; this.closing = false; cx.notify(); } });
  }

  readQuote(cx) {
    const terminal = props()?.terminal;
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
    const pane = props()?.pane;
    if (!feedback || !pane || this.busy) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await exec(DELEGATE(),
          ["fork", "--pane", pane, "--", feedback], { timeout: 90000 });
        if (result.code === 0) {
          this.busy = false;
          this.collapse(cx);
          return;
        }
        this.error = result.stderr.trim() || "Herdr could not launch the diagnostic fork.";
      } catch (error) {
        this.error = String(error?.message ?? error);
      }
      this.busy = false;
      cx.notify();
    });
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/pane-header/${icon}.svg`).size(14));
  }

  // The header's width in layout px. on_size_change reports window px (layout px times zoom).
  width() {
    const zoom = Number(settings()?.zoom) || 1;
    return this.size?.width > 0 ? this.size.width / zoom : 0;
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = nameOf(p);
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    const dark = solid(t.chrome);
    const width = this.width();
    const row = h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(this.open ? dark : t.background)
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      // While asking, the header and the panel are one dark surface with no line between them.
      .border_color(this.open ? dark : t.border)
      .text_size(12)
      .on_size_change((size, cx) => {
        if (size.width === this.size?.width && size.height === this.size?.height) return;
        this.size = size;
        cx.notify();
      })
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.open, el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(alpha(t.accent, 0.2)).text_size(10.5).font_semibold().text_color(t.accent).child("Diagnosing")))
      .when(this.hovered && !this.open, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
    // The Popup pins the panel's corner to the header's corner. No offset is added: see the
    // notes at the top of this file.
    return Popup.new(`pane-diag-${pane}`, row)
      .size_full()
      .anchor(bottom ? "bottom_left" : "top_left")
      .when(this.open && width > 0, el => el.content(this.panel(t, name, bottom, dark, width)));
  }

  // The panel that grows out of the header: dark and opaque, the agent's last line quoted,
  // the question and the input.
  panel(t, name, bottom, dark, width) {
    const hint = this.error || (this.busy ? "Opening diagnostic fork…" : "↵ fork a diagnostic agent · esc cancel");
    return v_flex()
      .id(`pane-diag-panel-${props()?.pane}`)
      .w(width)
      .h(this.grown ? PANEL_H : 0)
      .transition("height", { duration: GROW_MS, easing: "ease-out" })
      .overflow_hidden()
      .bg(dark)
      .border_color(alpha(t.accent, 0.7))
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      .shadow_lg()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_key_down((e, cx) => { if (e.key === "escape" && !this.busy) { this.collapse(cx); cx.stop_propagation(); } })
      .child(v_flex().px(14).pt(8).pb(12).gap(9)
        .opacity(this.grown ? 1 : 0).transition("opacity", { duration: GROW_MS + 80, easing: "ease-out" })
        .child(h_flex().gap(8).items_start().min_w(0)
          .child(div().w(2).h(30).flex_none().rounded(1).bg(alpha(t.accent, 0.8)))
          .child(div().flex_1().min_w(0).h(30).overflow_hidden().text_size(11.5).italic().text_color(t.dim)
            .child(this.quote ? `“${this.quote}”` : this.quote === null ? "Reading the last line…" : "This session has no last line to quote.")))
        .child(div().text_size(13).font_semibold().text_color(t.foreground).truncate().child(`What went wrong in ${name}?`))
        .child(div().px(8).py(5).rounded(7).border_1().text_size(13)
          .border_color(this.error ? t.blocked : this.typing ? alpha(t.accent, 0.8) : t.border).bg(alpha(t.foreground, 0.06))
          .child(Input.new(this.input)))
        .child(div().text_size(11).truncate().text_color(this.error ? t.blocked : t.muted)
          .when(this.busy, el => el.loop("opacity", { from: 0.5, to: 1, period: 1200 }))
          .child(hint)));
  }
}
