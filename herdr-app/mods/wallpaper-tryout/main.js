// wallpaper-tryout: the "Try wallpapers" palette entry. It opens Look tryout as its window, on the
// Wallpaper round, and closes itself. Look tryout does the rest (live preview, yes/no, keep, restore).
import { View, div } from "gpui-kit";
import { checking, closeOverlay, openOverlay, props, run, shared, theme } from "herdr";

export default class WallpaperTryout extends View {
  init() {
    if (checking()) return;
    const open = shared("look-tryout.open");
    if (typeof open === "number" && Date.now() - open < 45000) run("look-tryout.focus");
    else openOverlay({ mod: "look-tryout", props: { window: true, round: "wallpaper" }, kind: "window", key: "look-tryout", width: 500, height: 460 });
    closeOverlay(props().overlay);
  }

  render() {
    return div().size_full().bg(theme().popover);
  }
}
