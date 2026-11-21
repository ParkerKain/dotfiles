import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, closeOverlay, props, readTextFile, theme, window } from "herdr";

// Keep descriptions here; resolve the actual keys from keys.json whenever the pane opens.
const GROUPS = [
  ["Launchers", [
    ["mod.open:keybind-help", "My shortcuts"],
    ["mod.open:wallpaper", "Wallpaper picker"],
    ["mod.open:music", "Music controls"],
    ["mod.open:session-launcher", "Session launcher"],
    ["mod.open:run-once", "Run a command"],
    ["mod.open:revive", "Revive a session"],
    ["mod.open:demo-mode", "Toggle demo mode"],
    ["mod.open:picker", "Picker"],
    ["app.palette", "Command palette"],
  ]],
  ["Sidebars", [
    ["my-tabs.panel-ops-tasks", "Tasks"],
    ["my-tabs.panel-jobs", "Jobs"],
    ["my-tabs.panel-day-view", "Calendar"],
    ["my-tabs.panel-artifacts", "Artifacts"],
    ["my-tabs.panel-call-sheet", "Call Sheet"],
    ["my-tabs.panel-factory", "Factory"],
    ["my-tabs.hints", "Pick a sidebar row"],
    ["space-sessions.hints", "Jump to a tab in Spaces"],
    ["my-tabs.refresh", "Refresh open sidebar"],
    ["layout.toggle:sidebar", "Toggle left sidebar"],
  ]],
  ["Navigation", [
    ["agent.next", "Next agent"],
    ["agent.prev", "Previous agent"],
    ["space.next", "Next space"],
    ["space.prev", "Previous space"],
    ["layout.switch", "Switch layout"],
  ]],
  ["Session launcher", [
    ["session-launcher.toggle-agent", "Toggle agent"],
    ["session-launcher.start", "Start session"],
  ]],
];

// ⌘⇧T on macOS; Ctrl+Shift+T on Linux, where keys.json's cmd is the Super key.
function showKey(binding) {
  const parts = binding.split(/-(?=.)/); // "ctrl--" is Ctrl and the minus key
  if (window()?.platform !== "linux") return parts.map(part => ({ cmd: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" })[part] ?? part.toUpperCase()).join("");
  const name = { cmd: "Super", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };
  return parts.map(part => name[part] ?? (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))).join("+");
}

export default class KeybindHelp extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.keys = null;
    this.error = "";
    cx.spawn(async cx => {
      try {
        this.keys = JSON.parse(await readTextFile(`${appHome()}/keys.json`));
      } catch (_error) {
        this.error = "Could not read keys.json";
      }
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const bindings = this.keys ?? {};
    const findKeys = action => Object.entries(bindings.global ?? {}).filter(([, value]) => value === action).map(([key]) => showKey(key));
    const row = ([action, label]) => {
      const keys = action.startsWith("session-launcher.")
        ? Object.entries(bindings["mod:session-launcher"] ?? {}).filter(([, value]) => value === action).map(([key]) => showKey(key))
        : findKeys(action);
      if (!keys.length) return null;
      return h_flex().id(action).items_center().justify_between().px(10).py(5).rounded(6)
        .hover(el => el.bg(t.hover))
        .child(div().text_size(13).text_color(t.foreground).child(label))
        .child(h_flex().gap(5).children(keys.map((key, i) => div().id(`${action}-${i}`).px(7).py(3).rounded(5)
          .bg(t.raised).border_1().border_color(t.border).text_size(12).text_color(t.muted).child(key))));
    };
    const sections = GROUPS.map(([heading, entries]) => {
      const rows = entries.map(row).filter(Boolean);
      if (!rows.length) return null;
      return v_flex().id(heading).gap(2)
        .child(div().px(10).pt(12).pb(4).text_size(11).font_semibold().text_color(t.accent).child(heading.toUpperCase()))
        .children(rows);
    }).filter(Boolean);
    return v_flex().id("keybind-help").track_focus(this.handle).size_full().bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
      })
      .child(h_flex().items_center().justify_between().px(18).py(12).border_b(1).border_color(t.border)
        .child(div().text_size(15).font_semibold().child("My shortcuts"))
        .child(div().text_size(11).text_color(t.dim).child("Esc to close")))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().px(12).py(6)
        .when(Boolean(this.error), el => el.child(div().p(10).text_color(t.blocked).child(this.error)))
        .when(!this.keys && !this.error, el => el.child(div().p(10).text_color(t.muted).child("Loading…")))
        .children(sections));
  }
}
