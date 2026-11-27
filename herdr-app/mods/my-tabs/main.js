import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { appHome, checking, exec, spaces, panes, focused, run, openOverlay, theme, window, shared, setShared, layout, settings, nextCommand, props, keys } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Panel buttons, in tab-bar order. A machine shows only the panels its layout has
// (link.py drops the ones whose mod isn't installed there, like Tasks on Omarchy).
const WORK_PANELS = [
  ["ops-tasks", "Tasks", "mods/workspace-chrome/check.svg"],
  ["jobs", "Jobs", "mods/workspace-chrome/clock.svg"],
  ["day-view", "Calendar", "mods/day-view/calendar.svg"],
  ["artifacts", "Artifacts", "mods/artifacts/layers.svg"],
  ["call-sheet", "Call", "mods/call-sheet/clipboard.svg"],
  ["factory", "Factory", "mods/factory/factory.svg"],
  ["claude-usage", "Usage", "mods/claude-usage/gauge.svg"],
];

// The key bound to an action in keys.json, written the way this platform writes it:
// ⇧⌘T on macOS, Ctrl+Shift+T elsewhere. Null when nothing is bound.
function keyFor(action, platform) {
  const binding = (keys?.() ?? []).find(k => k.section === "global" && k.action === action)?.keys;
  if (!binding) return null;
  const parts = binding.split(/-(?=.)/); // "ctrl--" is Ctrl and the minus key
  if (platform === "macos") {
    const order = ["ctrl", "alt", "shift", "cmd"], sym = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" };
    const mods = order.filter(m => parts.includes(m)).map(m => sym[m]).join("");
    return mods + parts.filter(p => !order.includes(p)).join("-").toUpperCase();
  }
  const name = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super" };
  return parts.map(p => name[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join("+");
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    try { this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { this.panels = {}; }
    if (!this.panels || typeof this.panels !== "object" || Array.isArray(this.panels)) this.panels = {};
    this.musicReading = false;
    this.hasMusic = false;
    if (!checking()) {
      cx.spawn(async cx => {
        const r = await exec("test", ["-e", `${appHome()}/mods/music/mod.json`]).catch(() => null);
        this.hasMusic = r?.code === 0;
        cx.notify();
      });
      this.refreshMusic(cx);
      cx.timer.every(8000, cx => this.refreshMusic(cx));
    }
    // Keys (keys.json): my-tabs.panel-<id> toggles a side panel like its button, and
    // my-tabs.open-<id> only opens it (for links from other mods);
    // my-tabs.refresh reloads whichever panel is showing.
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command.startsWith("panel-")) this.togglePanel(command.slice(6), cx);
        if (command.startsWith("open-")) this.togglePanel(command.slice(5), cx, true);
        if (command === "refresh") this.refreshPanel();
        if (command === "hints") this.hintPanel();
        if (command === "zoom-panel") this.zoomPanel();
        cx.notify();
      }
    });
  }

  // Keep the pill accurate even when the popup is closed, without launching Music.
  refreshMusic(cx) {
    if (checking() || this.musicReading || props()?.demo) return;
    const config = shared("music.config");
    if (!config?.connected) return;
    this.musicReading = true;
    cx.spawn(async cx => {
      try {
        const result = await exec("/usr/bin/python3", [`${appHome()}/mods/music/music-control.py`, '{"action":"status"}'], {timeout: 28000});
        const reply = JSON.parse(result.stdout);
        if (reply.error?.code === "busy") return;
        if (reply.error?.code === "permission_denied") {
          setShared("music.config", {...shared("music.config"), connected: false});
        }
        const playback = reply.ok ? reply.state?.playback || "stopped" : "unknown";
        const old = shared("music.playback");
        if (old?.playback !== playback || Date.now() - (old?.at || 0) > 20000)
          setShared("music.playback", {playback, at: Date.now()});
      } catch (_) {
        if (shared("music.playback")?.playback !== "unknown")
          setShared("music.playback", {playback: "unknown", at: Date.now()});
      } finally { this.musicReading = false; }
    });
  }

  // Layout mods are outside the tab's pane tree, so pane.zoom cannot expand them.
  // Shared state survives a tab-bar reload while the panel fills the work area.
  restorePanelZoom() {
    const key = `my-tabs.panel-zoom.${shared("layout")}`;
    const saved = shared(key);
    if (!saved) return false;
    const root = JSON.parse(JSON.stringify(layout()));
    const main = find(root, "main"), panel = find(root, "panel");
    if (main && panel) {
      for (const [node, fields] of [[main, saved.main], [panel, saved.panel]]) {
        for (const [field, value] of Object.entries(fields)) {
          if (value === null) delete node[field];
          else node[field] = value;
        }
      }
      run("layout.set", { layout: root });
    }
    setShared(key, null);
    return true;
  }

  zoomPanel() {
    if (this.restorePanelZoom()) return;
    const root = JSON.parse(JSON.stringify(layout()));
    const main = find(root, "main"), panel = find(root, "panel");
    if (!main || !panel || panel.hidden) return;
    const fields = (node, names) => Object.fromEntries(names.map(name => [name, node[name] ?? null]));
    setShared(`my-tabs.panel-zoom.${shared("layout")}`, {
      space: focused()?.space,
      main: fields(main, ["hidden"]),
      panel: fields(panel, ["size", "min", "max"]),
    });
    main.hidden = true;
    panel.size = { weight: 1 };
    delete panel.min;
    delete panel.max;
    run("layout.set", { layout: root });
  }

  togglePanel(id, cx, openOnly = false) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!body?.children?.some(child => child.id === id)) return;
    const showing = panel && !panel.hidden && body?.active === id;
    if (openOnly && showing) return;
    this.restorePanelZoom();
    if (showing) run("layout.hide", { id: "panel" });
    else {
      const previous = id === "call-sheet" ? focused() : null;
      run("layout.select", { stack: "panel-body", child: id });
      run("layout.show", { id: "panel" });
      if (id === "call-sheet") {
        const at = Date.now(), tab = previous?.tab;
        const opening = { at, pane: previous?.pane ?? null, terminal: previous?.terminal ?? null, tab: tab ?? null };
        setShared("call-sheet.open", opening);
        const entryPane = panes().filter(p => p.tab === tab).at(-1)?.pane;
        const stillOpen = () => {
          const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
          return panel && !panel.hidden && body?.active === "call-sheet" && focused()?.tab === tab && shared("call-sheet.open")?.at === at;
        };
        cx.timer.after(150, cx => {
          if (!stillOpen()) return;
          // The newly shown mod must render before pane.go can hand it focus.
          setShared("call-sheet.open", { ...opening, ready: true });
          if (entryPane) run("pane.focus", { pane: entryPane });
          cx.timer.after(50, () => {
            if (!stillOpen()) return;
            setShared("call-sheet.open", { ...opening, ready: true, handoff: true });
            run("pane.go", { direction: "right" });
          });
        });
      }
    }
  }

  // Tasks, Jobs, Calendar and Artifacts reload when their "<id>.refresh" shared key changes.
  refreshPanel() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (panel && !panel.hidden && body?.active) setShared(`${body.active}.refresh`, Date.now());
  }

  // Keyboard row picking: the showing panel watches "<id>.hints" and labels its rows.
  // A closed panel opens first; its copy may only start now, so it honors a recent stamp.
  hintPanel() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!body?.active) return;
    if (!panel || panel.hidden) run("layout.show", { id: "panel" });
    setShared(`${body.active}.hints`, Date.now());
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const zoom = shared(`my-tabs.panel-zoom.${shared("layout")}`);
    if (zoom && (zoom.space !== space.id || panel.hidden)) this.restorePanelZoom();
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    // The Demo layout passes {demo: true}: Files and Changes only, none of the work panels.
    const demo = Boolean(props()?.demo);
    const inLayout = new Set((body?.children ?? []).map(child => child.id));
    const workPanels = WORK_PANELS.filter(([id]) => inLayout.has(id));
    const enabled = demo ? ["files", "changes"] : [...new Set([...(shared("workspace.panels") ?? ["files", "changes"]), ...workPanels.map(([id]) => id)])];
    this.syncPanel(space, panel, body, enabled);
    // Icon-only buttons with a tooltip. The open panel widens to show its name,
    // and a panel can publish "<id>.badge" ({count} or {dot: true, tone}) for a mark.
    // An open button shows the count inline after its name; an icon-only one in its
    // corner. Both stay inside the button so the next one can't draw over them.
    const badge = (id, inline) => {
      const b = shared(`${id}.badge`);
      if (!b || (!b.dot && !(b.count > 0))) return null;
      const color = t[b.tone] ?? t.accent;
      if (!(b.count > 0)) return div().absolute().top(3).right(3).size(6).rounded(3).bg(color);
      // The corner badge rises above the button's top edge, clear of the icon, and stays
      // within the 3px gap so the next button can't cover it.
      const text = b.count > 99 ? "99+" : String(b.count), size = inline ? 16 : 12;
      return div().when(!inline, el => el.absolute().top(-5).right(-2))
        .h(size).min_w(size).when(text.length > 1, el => el.px(inline ? 5 : 3)).rounded(size / 2).bg(color).text_color(t.canvas)
        .text_size(inline ? 10.5 : 8).flex().flex_none().items_center().justify_center().child(text);
    };
    const iconButton = (id, label, icon, key, { on = false, tint = null, action }) => {
      const mark = badge(id, on);
      return h_flex().id(`panel-${id}`).relative().h(26).min_w(26).flex_none().items_center().justify_center().gap(5).rounded(6)
        .when(on, el => el.px(8)).text_size(12)
        .bg(on ? t.selected : t.chrome).text_color(tint ?? (on ? t.foreground : t.muted))
        .hover(s => s.bg(t.hover).text_color(tint ?? t.foreground)).on_mouse_down("left", stop)
        .tooltip(key ? `${label}  ${key}` : label).accessibility_label(label)
        .on_click(action).child(svg(icon).size(14))
        .when(on, el => el.child(label))
        .when(Boolean(mark), el => el.child(mark));
    };
    const panelButton = (id, label, icon, key) => iconButton(id, label, icon, key, {
      on: panel && !panel.hidden && body?.active === id,
      action: (_e, cx) => this.togglePanel(id, cx),
    });
    const divider = id => div().id(id).w(1).h(14).mx(4).flex_none().bg(t.border);
    const music = shared("music.playback");
    const playback = shared("music.config")?.connected && Date.now() - (music?.at || 0) < 30000 ? music?.playback : "unknown";
    const musicPlaying = playback === "playing";
    const musicIcon = playback === "paused" ? "paused" : musicPlaying ? "playing" : "music";
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files") || enabled.includes("changes"), el => el.child(divider("divider-workspace")))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(!demo, el => el
        .when(workPanels.length, el => el.child(divider("divider-work")))
        .children(workPanels.map(([id, label, icon]) => panelButton(id, label, icon, keyFor(`my-tabs.panel-${id}`, w?.platform))))
        // Music is Mac-only: the button shows where the music mod is installed.
        .when(this.hasMusic, el => el
          .child(divider("divider-ambient"))
          .child(iconButton("music", musicPlaying ? "Music (playing)" : "Music", `mods/music/${musicIcon}.svg`, keyFor("mod.open:music", w?.platform), {
            tint: musicPlaying ? t.accent : null,
            action: () => run("mod.open", { name: "music" }),
          }))))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
