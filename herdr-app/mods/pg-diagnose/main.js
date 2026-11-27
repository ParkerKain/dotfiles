// Playground prototype: the Diagnose question asked in the pane header.
// A copy of the `pane` header mod (icon, name, folder, status, hover buttons) that also
// answers `pg-diagnose.diagnose`. Every shown header copy gets the command, and only the
// copy for the focused pane acts on it. That copy's header turns into the question:
// "What went wrong in <session>?", an input, and the agent's last line quoted. Enter
// forks the pane exactly the way the diagnose-session mod does (herdr-delegate fork
// --pane <pane> -- <text>). Esc, or clicking away, collapses it.
//
// The question itself is asked by pg-diagnose-ask, a panel that drops down from the top of
// the work area (a floating block, so its position is reliable). A popup under the header
// could not learn where the pane sits. This header marks the pane being asked about: an
// accent edge, a tint and a "Diagnosing" chip, until the panel closes (pg-diagnose.clear).
//
// Wire it with pane.header.content.mod = "pg-diagnose" and a key such as
// "cmd-shift-i": "pg-diagnose.diagnose". It's also in the palette as "Diagnose in header".

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { checking, focused, home, layout, nextCommand, panes, props, run, setShared, theme } from "herdr";

const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  return m ? "#" + m[1] + Math.round(a * (m[2] ? parseInt(m[2], 16) / 255 : 1) * 255).toString(16).padStart(2, "0") : hex;
};

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

export default class DiagnoseHeader extends View {
  init(_props, cx) {
    this.hovered = false;
    this.asking = false;
    if (checking()) return;
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "diagnose" && targetPane() === props()?.pane) this.ask();
        else if (command === "clear") this.asking = false;
        cx.notify();
      }
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  // Marks this pane and hands the question to the drop-down panel.
  ask() {
    const p = this.me();
    if (!p?.terminal) return;
    this.asking = true;
    setShared("pg-diagnose.ask", { pane: p.pane, terminal: p.terminal, name: nameOf(p), at: Date.now() });
    run("pg-diagnose-ask.open");
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
      .child(svg(`mods/pg-diagnose/${icon}.svg`).size(14));
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
    const row = h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      .border_color(this.asking ? t.accent : t.border)
      .when(this.asking, el => el.bg(alpha(t.accent, 0.14)))
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.asking, el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.accent).text_size(10.5).font_semibold().text_color(t.background).child("Diagnosing ↑")))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
    return row;
  }

}
