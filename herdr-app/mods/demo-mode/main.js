// demo-mode: Cmd+Shift+M toggles the Demo layout (no sidebar; the tab bar shows
// Files and Changes only; notifications dropped) and back to the layout that
// was showing before. Entering Demo pauses scheduled jobs and hooks (`job pause
// --by demo`, shown in the Jobs panel); leaving resumes them unless the pause was
// made by hand. It stays in the current space, so open the space you're
// demoing (say, a customer folder in the vault) first. Opens as a 1px overlay,
// closes itself at once, then switches.
import { View, div } from "gpui-kit";
import { checking, closeOverlay, exec, home, layouts, props, run, setShared, shared } from "herdr";

const DEMO_LAYOUT = "Demo";
// The job engine (herdr-app/jobs/job), linked here by link.py.
const JOB = () => `${home()}/.local/bin/job`;

// Pause or resume jobs, then tell the Jobs panel to reload. A failure must not block the switch.
function jobs(command) {
  exec(JOB(), [command, "--by", "demo"], { timeout: 20000 })
    .then(() => setShared("jobs.refresh", Date.now()))
    .catch(() => {});
}

export default class DemoMode extends View {
  init() {
    if (checking()) return;
    // Close first: an open dialog would cover the demo screen.
    const id = props()?.overlay;
    if (id) closeOverlay(id);
    if (shared("layout") === DEMO_LAYOUT) {
      let before = null;
      try { before = localStorage.getItem("before"); } catch {}
      run("layout.switch", { name: layouts().includes(before) ? before : "Parker" });
      jobs("resume");
    } else {
      try { localStorage.setItem("before", shared("layout")); } catch {}
      jobs("pause");
      run("layout.switch", { name: DEMO_LAYOUT });
    }
  }

  render() {
    return div();
  }
}
