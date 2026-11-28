import { View, div } from "gpui-kit";
import { checking, closeOverlay, props, run } from "herdr";

export default class DiagnoseShortcut extends View {
  init() {
    if (checking() || !props()?.overlay) return;
    // Herdr's keyboard dispatcher misses pane headers. Its command API reaches them.
    closeOverlay(props().overlay);
    run("pane-header.diagnose");
  }

  render() {
    return div();
  }
}
