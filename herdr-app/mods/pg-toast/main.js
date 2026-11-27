// Playground prototype: toasts that know their source. Set the layout root's
// "toast": "pg-toast" to draw every notification with it (Herdr's own and every notify()).
//
// Each toast works out where it came from (Calendar, Factory, Artifacts, Tasks, Lock-in,
// Jobs) from its props and wears that source's glyph and color. A thin bar along the
// bottom drains over the toast's timeout. A toast arrives with a small spring bounce
// and a flash of its color. Clicking runs its action, else opens its link (a Zoom link
// joins the call, an artifact link opens the page), else opens the source's panel.
// Everything the shipped toast does still works: icons, level dots, fitHeight and the
// "needs login" copy button.
//
// Opened with no notification (the palette's "Toast demo (playground)" runs
// mod.open {name: "pg-toast"}), it posts three sample toasts and closes itself.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { checking, closeOverlay, exec, home, layout, nextCommand, notify, props, run, settings, theme } from "herdr";

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };
const BAR_H = 3;

const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  return m ? "#" + m[1] + Math.round(a * (m[2] ? parseInt(m[2], 16) / 255 : 1) * 255).toString(16).padStart(2, "0") : hex;
};

// Source styles. Colors are the Rose Pine names, read from the theme's ANSI slots
// (rose is cyan, gold yellow, foam blue, iris magenta, love red, pine green) so a
// different theme still gets six distinct colors. `panel` is the side panel id in
// Parker's layouts that a click opens when the toast has no action or link.
const SOURCES = {
  calendar: { label: "Calendar", glyph: "◷", color: t => t.ansi6 ?? "#ebbcba", panel: "day-view" },
  factory: { label: "Factory", glyph: "⚙", color: t => t.ansi3 ?? "#f6c177", panel: "factory" },
  artifacts: { label: "Artifacts", glyph: "◆", color: t => t.ansi4 ?? "#9ccfd8", panel: "artifacts" },
  tasks: { label: "Tasks", glyph: "✓", color: t => t.ansi5 ?? "#c4a7e7", panel: "ops-tasks" },
  lockin: { label: "Lock-in", glyph: "◉", color: t => t.ansi1 ?? "#eb6f92", panel: "lock-in" },
  jobs: { label: "Jobs", glyph: "▸", color: t => t.ansi2 ?? "#31748f", panel: "jobs" },
};

// Which source a notification came from. notify() only carries title, body, level,
// icon, action and timeout, so an explicit `source` or `mod` is honored if Herdr ever
// passes one through, then the action's target, then words in the title and body.
export function sourceOf(p) {
  const explicit = String(p.source ?? p.mod ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const alias = { dayview: "calendar", opstasks: "tasks", task: "tasks", job: "jobs", artifact: "artifacts" };
  if (SOURCES[alias[explicit] ?? explicit]) return alias[explicit] ?? explicit;
  const target = String(p.action?.args?.name ?? p.action?.args?.child ?? p.action?.args?.mod ?? "").toLowerCase();
  for (const [key, s] of Object.entries(SOURCES)) if (target && (target === key || target === s.panel)) return key;
  const title = String(p.title ?? ""), text = `${title} ${p.body ?? ""}`;
  if (/^factory\b/i.test(title) || /^(Filed|Retrying|Answered) [A-Z]+-\d+/.test(title)) return "factory";
  if (/^(calendar|meeting)\b/i.test(title) || /zoom\.us\/|teams\.microsoft\.com\/|meet\.google\.com\//i.test(text) || /\b(call|meeting) (starts|in \d)/i.test(text)) return "calendar";
  if (/^artifacts?\b/i.test(title) || /claude\.ai\/(code\/)?artifacts?\b/i.test(text)) return "artifacts";
  if (/^lock-?in\b/i.test(title)) return "lockin";
  if (/^jobs?\b/i.test(title)) return "jobs";
  if (/^tasks?\b/i.test(title) || /\btask (due|overdue|done)\b/i.test(text)) return "tasks";
  return null;
}

// A link the toast carries: `url` if passed through, an action of the form
// {name: "open", args: {url}}, or the first http(s) link in the body or title.
export function linkOf(p) {
  if (typeof p.url === "string" && /^https?:\/\//.test(p.url)) return p.url;
  if (typeof p.action?.args?.url === "string") return p.action.args.url;
  return /https?:\/\/[^\s)>\]]+/.exec(`${p.body ?? ""} ${p.title ?? ""}`)?.[0] ?? null;
}

const linkLabel = (url, source) =>
  /zoom\.us\/|teams\.microsoft\.com\/|meet\.google\.com\//i.test(url) ? "Join call"
    : source === "artifacts" || /claude\.ai\//i.test(url) ? "Open page" : "Open link";

const find = (node, id) => {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) { const hit = find(child, id); if (hit) return hit; }
  return null;
};

// Shows a side panel the way my-tabs does (open only, never toggles it closed).
// Returns false when this layout has no such panel.
function openPanel(id) {
  const root = layout();
  if (!find(find(root, "panel-body"), id)) return false;
  run("layout.select", { stack: "panel-body", child: id });
  run("layout.show", { id: "panel" });
  return true;
}

export function postDemo() {
  notify({
    title: "Calendar: Discovery 1 starts in 5 min",
    body: "MLT · 10:30 to 11:30 (sample) https://zoom.us/j/1234567890",
    level: "info", timeout: 12000,
  });
  notify({
    title: "Factory: question on OPS-412",
    body: "Should archived resources keep their audit trail? (sample)",
    level: "warning", timeout: 10000,
  });
  notify({
    title: "Artifacts: Toast demo published",
    body: "Private page ready to share https://claude.ai/code/artifacts",
    level: "success", timeout: 8000,
  });
}

export default class SourceToast extends View {
  init(_props, cx) {
    this.born = Date.now();
    this.arrived = false;   // phase flag: first frame draws the "before" values, then motion runs
    this.draining = false;
    this.width = 0;
    if (checking()) return;
    const p = props() ?? {};
    // Opened by the palette with no notification: post the demo and close.
    if (!p.title && !p.body && p.overlay) {
      postDemo();
      closeOverlay(p.overlay);
      return;
    }
    cx.timer.after(30, cx => { this.arrived = true; cx.notify(); });
    cx.spawn(async cx => {
      for (;;) { if ((await nextCommand()) === "demo") postDemo(); cx.notify(); }
    });
  }

  click(p, source, url) {
    if (p.action?.name && p.action.name !== "open") run(p.action.name, p.action.args ?? {});
    else if (url) exec("open", [url]);
    else if (source === "calendar") { if (!openPanel("day-view")) exec(`${home()}/.local/bin/day-view`, ["show", new Date().toISOString().slice(0, 10)]); }
    else if (source && SOURCES[source].panel) openPanel(SOURCES[source].panel);
    closeOverlay(p.overlay);
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const zoom = Number(settings()?.zoom) || 1;
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    const source = login ? null : sourceOf(p);
    const s = source ? SOURCES[source] : null;
    const url = login ? null : linkOf(p);
    const color = s ? s.color(t) : t[DOT[p.level] ?? "accent"];
    // The link is shown as a chip, so it comes out of the body text.
    const body = url && typeof p.body === "string" ? p.body.replace(url, "").replace(/\s+$/, "") : p.body;
    const text = (value) => p.fitHeight
      ? div().child(value)
      : div().truncate().child(typeof value === "string" ? value.split("\n", 1)[0] : value);

    const timeout = Number(p.timeout) > 0 ? Number(p.timeout) : 0;
    // Start draining once the width is known and the first full-width frame is drawn.
    if (timeout && this.width && this.arrived && !this.draining) {
      cx.timer.after(20, cx => { this.drainMs = Math.max(1, timeout - (Date.now() - this.born)); this.draining = true; cx.notify(); });
    }

    const badge = p.icon
      ? image(p.icon).w(18).h(18).flex_none()
      : s
        ? div().flex_none().size(24).rounded(6).bg(alpha(color, 0.18)).border_1().border_color(alpha(color, 0.5))
          .flex().items_center().justify_center().text_size(13).text_color(color).child(s.glyph)
        : div().size(8).rounded(4).flex_none().bg(color);

    const content = h_flex()
      .id("pg-toast-content")
      .relative()
      .when(p.fitHeight, el => el.w_full().min_h(70).py(12))
      .when(!p.fitHeight, el => el.size_full())
      .top(this.arrived ? 0 : 10).spring("top", { response: 420, damping: 0.42 })
      .opacity(this.arrived ? 1 : 0).transition("opacity", { duration: 160, easing: "ease-out" })
      .pl(s ? 14 : 18).pr(18).gap(12).items_center()
      .child(badge)
      .child(
        v_flex()
          .flex_1()
          .overflow_hidden()
          .when(Boolean(s), el => el.child(div().text_size(10).font_semibold().text_color(alpha(color, 0.9)).child(s.label.toUpperCase())))
          .child(text(login ? `${login[1]} needs a login: run` : (s ? stripPrefix(p.title, s.label) : p.title) ?? "").font_semibold().text_size(13).text_color(t.foreground))
          .when(!login && Boolean(body), el => el.child(text(body).text_size(12).text_color(t.muted)))
          .when(Boolean(login), el => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(12).text_color(t.muted).child(command))
            .child(div().id("toast-login-copy").flex_none().px(6).py(3).rounded(4).bg(t.raised)
              .text_size(12).text_color(t.foreground).cursor_pointer().hover(st => st.bg(t.hover))
              .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
              .child(this.copied ? "Copied" : "Copy")))),
      )
      .when(Boolean(url), el => el.child(div().flex_none().px(8).py(3).rounded(4)
        .bg(alpha(color, 0.16)).text_size(11).font_semibold().text_color(color).child(linkLabel(url, source))));

    return div()
      .id("toast")
      .relative()
      .overflow_hidden()
      .when(p.fitHeight, el => el.w_full().flex_none())
      .when(!p.fitHeight, el => el.size_full())
      .bg(t.popover)
      .cursor_pointer()
      .hover(st => st.bg(t.hover))
      .when(Boolean(url || p.action?.name || s), el => el.tooltip(url ? linkLabel(url, source) : p.action?.name ? "Click to go there" : `Click to open ${s.label}`))
      .on_size_change((size, cx) => { const w = Math.round(size.width / zoom); if (w !== this.width) { this.width = w; cx.notify(); } })
      .on_click(() => this.click(p, source, url))
      // A stripe of the source color on the left edge.
      .when(Boolean(s), el => el.child(div().absolute().left(0).top(0).bottom(0).w(3).bg(color)))
      .child(content)
      // The arrival flash: a wash of the source color that fades out once.
      .child(div().absolute().inset_0().bg(alpha(color, 0.3))
        .opacity(this.arrived ? 0 : 1).transition("opacity", { duration: 700, easing: "ease-out" }))
      // The timeout bar: full width, then drains to nothing over what is left of the timeout.
      .when(timeout > 0 && this.width > 0, el => el.child(div().id("pg-toast-bar").absolute().left(0).bottom(0).h(BAR_H)
        .bg(alpha(color, 0.85))
        .w(this.draining ? 0 : this.width)
        .transition("width", { duration: this.drainMs ?? Math.max(1, timeout), easing: "linear" })));
  }
}

// "Factory: question on OPS-412" reads as "question on OPS-412" under a FACTORY label.
function stripPrefix(title, label) {
  if (typeof title !== "string") return title;
  const m = new RegExp(`^${label.replace("-", "-?")}s?:\\s*`, "i").exec(title);
  return m ? title.slice(m[0].length) : title;
}
