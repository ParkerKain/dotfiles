// Playground prototype: the Diagnose question asked in the pane header.
// A copy of the `pane` header mod (icon, name, folder, status, hover buttons) that also
// answers `pg-diagnose.diagnose`. Every shown header copy gets the command, and only the
// copy for the focused pane acts on it. That copy's header turns into the question:
// "What went wrong in <session>?", an input, and the agent's last line quoted. Enter
// forks the pane exactly the way the diagnose-session mod does (herdr-delegate fork
// --pane <pane> -- <text>). Esc, or clicking away, collapses it.
//
// The question stays inside the header row itself. An earlier version drew a gpui-base Popup
// under the header, but a popup in a header mod has no reliable position (it landed at the
// window's edge or across two panes), so the row swaps its contents instead: a tinted row
// with the question, an input, and the agent's last line on the right.
//
// Wire it with pane.header.content.mod = "pg-diagnose" and a key such as
// "cmd-shift-i": "pg-diagnose.diagnose". It's also in the palette as "Diagnose in header".

import { View, div, svg, image } from "gpui-kit";
import { h_flex, InputState, Input } from "gpui-base";
import { checking, exec, focused, hc, home, layout, nextCommand, panes, props, run, settings, theme } from "herdr";
import { lastLine } from "./lib/lastline.js";

const GROW_MS = 180;
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
    this.open = false;      // panel mounted
    this.grown = false;     // panel at full height (a frame after mounting, so it animates)
    this.busy = false;
    this.error = "";
    this.quote = "";
    this.openedAt = 0;
    this.input = InputState.new({ placeholder: "Describe the behavior you expected in one sentence" });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.on("blur", (_e, cx) => {
      if (this.open && !this.busy && Date.now() - this.openedAt > 400) this.collapse(cx);
    });
    if (checking()) return;
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "diagnose" && targetPane() === props()?.pane) this.expand(cx);
        cx.notify();
      }
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  expand(cx) {
    if (this.open) { this.input.focus(); return; }
    this.open = true; this.grown = false; this.busy = false; this.error = "";
    this.quote = ""; this.openedAt = Date.now();
    this.input.set_value("");
    this.input.focus();
    cx.timer.after(16, cx => { if (this.open) { this.grown = true; cx.notify(); } });
    this.readQuote(cx);
  }

  collapse(cx) {
    if (!this.open) return;
    this.grown = false;
    this.input.blur();
    cx.notify();
    cx.timer.after(GROW_MS + 20, cx => { if (!this.grown) { this.open = false; cx.notify(); } });
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
        const result = await exec(`${home()}/.local/bin/herdr-delegate`,
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
    if (this.open) return this.asking(t, p, name, pic, bottom);
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }

  // The header while asking: tinted, with the question, the input and the agent's last line.
  // It fades in over the normal header (opacity, a frame after it mounts).
  asking(t, p, name, pic, bottom) {
    const hint = this.error || (this.busy ? "Opening diagnostic fork…" : "↵ fork · esc");
    return h_flex()
      .id(`pane-ask-${p.pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(alpha(t.accent, 0.16))
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      .border_color(t.accent)
      .text_size(12)
      .opacity(this.grown ? 1 : 0)
      .transition("opacity", { duration: GROW_MS, easing: "ease-out" })
      .on_key_down((e, cx) => {
        if (e.key === "escape" && !this.busy) { this.collapse(cx); cx.stop_propagation(); }
      })
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().font_semibold().text_color(t.foreground).child(`What went wrong in ${name}?`))
      .child(div().flex_1().min_w(120).h(22).px(8).flex().items_center().rounded(6).border_1()
        .border_color(this.error ? t.blocked : alpha(t.accent, 0.7)).bg(t.background)
        .child(Input.new(this.input)))
      .when(Boolean(this.quote), el => el.child(div().flex_shrink_1().min_w(0).max_w(320).truncate().italic().text_size(11).text_color(t.dim)
        .tooltip(this.quote).child(`last: “${this.quote}”`)))
      .child(div().flex_none().text_size(11).text_color(this.error ? t.blocked : t.muted)
        .when(this.busy, el => el.loop("opacity", { from: 0.5, to: 1, period: 1200 }))
        .child(hint));
  }
}
