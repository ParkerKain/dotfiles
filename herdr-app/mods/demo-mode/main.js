// demo-mode: Cmd+Shift+M toggles a clean screen for demos. On: remember the
// layout and space, show the "demo" space (made in ~/demo if missing) in the
// Demo layout, which has no sidebar, agent list, tab bar, panels or status bar.
// Off: back to the remembered layout and space. Opens as a 1px overlay, acts,
// and closes itself.
import { View, div } from "gpui-kit";
import { closeOverlay, exec, home, layouts, props, run, shared, spaces } from "herdr";

const DEMO_LAYOUT = "Demo";
const DEMO_SPACE = "demo";

function load() {
  try { return JSON.parse(localStorage.getItem("before") ?? "null"); } catch { return null; }
}

export default class DemoMode extends View {
  init(_props, cx) {
    // Close first: an open dialog would cover the demo screen.
    closeOverlay(props().overlay);
    cx.spawn(async () => this.toggle());
  }

  async toggle() {
    const all = spaces();
    if (shared("layout") === DEMO_LAYOUT) {
      const before = load();
      const layout = layouts().includes(before?.layout) ? before.layout : "Parker";
      run("layout.switch", { name: layout });
      if (before?.space && all.some(s => s.id === before.space)) run("space.select", { id: before.space });
      return;
    }
    const current = all.find(s => s.active);
    localStorage.setItem("before", JSON.stringify({ layout: shared("layout"), space: current?.id ?? null }));
    const demo = all.find(s => s.name === DEMO_SPACE);
    if (demo) run("space.select", { id: demo.id });
    else {
      const folder = `${home()}/demo`;
      await exec("mkdir", ["-p", folder]);
      run("space.new", { name: DEMO_SPACE, folder });
    }
    run("layout.switch", { name: DEMO_LAYOUT });
  }

  render() {
    return div();
  }
}
