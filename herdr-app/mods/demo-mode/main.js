// demo-mode: Cmd+Shift+M toggles the Demo layout (no sidebar; the tab bar shows
// Files and Changes only; notifications dropped) and back to the layout that
// was showing before. It stays in the current space, so open the space you're
// demoing (say, a customer folder in the vault) first. Opens as a 1px overlay,
// closes itself at once, then switches.
import { View, div } from "gpui-kit";
import { closeOverlay, layouts, props, run, shared } from "herdr";

const DEMO_LAYOUT = "Demo";

export default class DemoMode extends View {
  init() {
    // Close first: an open dialog would cover the demo screen.
    const id = props()?.overlay;
    if (id) closeOverlay(id);
    if (shared("layout") === DEMO_LAYOUT) {
      let before = null;
      try { before = localStorage.getItem("before"); } catch {}
      run("layout.switch", { name: layouts().includes(before) ? before : "Parker" });
    } else {
      try { localStorage.setItem("before", shared("layout")); } catch {}
      run("layout.switch", { name: DEMO_LAYOUT });
    }
  }

  render() {
    return div();
  }
}
