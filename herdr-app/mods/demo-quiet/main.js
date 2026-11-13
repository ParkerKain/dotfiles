// demo-quiet: the Demo layout's notification mod. It drops every notification
// (agent finished, needs you, ...) so no session or space name shows mid-demo.
import { View, div } from "gpui-kit";
import { closeOverlay, props } from "herdr";

export default class DemoQuiet extends View {
  init() { const id = props()?.overlay; if (id) closeOverlay(id); }
  render() { return div(); }
}
