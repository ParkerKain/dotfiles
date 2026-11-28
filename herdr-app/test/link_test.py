"""Tests for herdr-app/link.py: per-machine keys, settings, layouts, mods and the job CLI.

Run: python3 -m unittest herdr-app/test/link_test.py
Each test links into a temp home; nothing outside it changes and no scheduler is touched.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINK = ROOT / "link.py"
sys.path.insert(0, str(ROOT))
import link  # noqa: E402

WORK_PANELS = {"ops-tasks", "day-view", "artifacts", "call-sheet", "factory", "claude-usage"}
# Kit mods outside the side panel: the day strip band, the glances status block, the
# floating Lock-in and Meeting mode.
KIT_MODS = WORK_PANELS | {"day-strip", "glances", "lock-in"}


def mods_in(layout):
    """Every mod a layout names: blocks, floating blocks, the pane header and the toast."""
    found, stack = set(), [layout]
    while stack:
        node = stack.pop()
        content = node.get("content") if isinstance(node.get("content"), dict) else {}
        if content.get("mod"):
            found.add(content["mod"])
        header = content.get("pane", {}).get("header", {}).get("content", {})
        if header.get("mod"):
            found.add(header["mod"])
        if node.get("toast"):
            found.add(node["toast"])
        stack.extend(node.get("children", []) + node.get("floating", []))
    return found


def panel_ids(layout):
    ids, stack = [], [layout]
    while stack:
        node = stack.pop()
        if node.get("id") == "panel-body":
            return [c["id"] for c in node["children"]], node.get("active")
        stack.extend(node.get("children", []))
    return ids, None


class LinkTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(subprocess.run, ["rm", "-rf", str(self.tmp)])
        self.herdr = self.tmp / ".config/herdr-app"
        (self.herdr / "mods").mkdir(parents=True)
        self.bin = self.tmp / ".local/bin"

    def run_link(self, machine, *args):
        env = {**os.environ, "HOME": str(self.tmp), "JOB_SCHEDULER": "none", "LINK_ANY_PLATFORM": "1",
               "JOB_LAUNCHD_DIR": str(self.tmp / "launchd"), "JOB_SYSTEMD_DIR": str(self.tmp / "systemd")}
        env.pop("PARKER_MACHINE", None)
        return subprocess.run([sys.executable, str(LINK), "--machine", machine, "--herdr-home", str(self.herdr),
                               "--bin-dir", str(self.bin), *args], capture_output=True, text=True, env=env)

    def ok(self, machine, *args):
        out = self.run_link(machine, *args)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        return out.stdout

    def test_omarchy_gets_shared_look_and_its_own_keys_mods_and_layout(self):
        (self.herdr / "keys.json").write_text('{"global": {}}')
        (self.herdr / "settings.json").write_text('{"zoom": 1.5, "font_ligatures": false}')
        self.ok("omarchy")
        # Keys: Omarchy's own file; the one Herdr wrote is moved aside, not lost.
        self.assertEqual(Path(os.readlink(self.herdr / "keys.json")), ROOT / "machines/omarchy/keys.json")
        self.assertTrue(list((self.herdr / ".link-state/backups").rglob("keys.json")))
        # Settings: shared look merged in, Herdr's own zoom kept, ~ expanded.
        settings = json.loads((self.herdr / "settings.json").read_text())
        self.assertEqual((settings["zoom"], settings["theme"], settings["font_ligatures"]), (1.5, "rose-pine-moon", True))
        self.assertEqual(settings["sounds"]["done"], f"{self.tmp}/dotfiles/herdr/sounds/rising-two-note.mp3")
        self.assertNotIn("font_size", settings)
        # Layout: a written copy with Jobs but none of the work Mac's panels.
        parker = self.herdr / "layouts/Parker.json"
        self.assertFalse(parker.is_symlink())
        panels, active = panel_ids(json.loads(parker.read_text()))
        self.assertIn("jobs", panels)
        self.assertFalse(WORK_PANELS & set(panels))
        self.assertIn(active, panels)
        # No kit-only block is left anywhere in Omarchy's copy, and every mod it names is one Omarchy has.
        named = mods_in(json.loads(parker.read_text()))
        self.assertFalse(KIT_MODS & named)
        omarchy_mods = {p.name for p in (self.herdr / "mods").iterdir()}
        self.assertLessEqual(named - {"workspace-chrome", "pane"}, omarchy_mods)
        self.assertFalse((self.herdr / "layouts/Demo.json").exists())
        self.assertFalse((self.herdr / "layouts/Meeting.json").exists())
        # Mods: shared ones linked, Mac-only ones not.
        mods = {p.name for p in (self.herdr / "mods").iterdir()}
        self.assertTrue({"jobs", "session-launcher", "wallpaper", "my-tabs"} <= mods)
        self.assertFalse({"music", "demo-mode", "run-once"} & mods)
        self.assertTrue((self.herdr / "themes/rose-pine-moon.json").is_symlink())
        self.assertEqual(Path(os.readlink(self.bin / "job")), ROOT / "jobs/job")
        self.assertEqual((self.tmp / ".config/parker/machine").read_text(), "omarchy\n")  # herdr-home's sibling

    def test_a_second_run_changes_nothing(self):
        self.ok("omarchy")
        self.assertIn("Everything already matches", self.ok("omarchy"))
        self.assertEqual(self.run_link("omarchy", "--check").returncode, 0)

    def test_check_reports_drift_and_changes_nothing(self):
        out = self.run_link("omarchy", "--check")
        self.assertEqual(out.returncode, 1)
        self.assertIn("would link", out.stdout)
        self.assertFalse((self.herdr / "keys.json").exists())

    def test_mac_links_every_layout_and_its_mac_only_mods(self):
        self.ok("mac")
        self.assertEqual(Path(os.readlink(self.herdr / "layouts/Parker.json")), ROOT / "layouts/Parker.json")
        self.assertTrue((self.herdr / "layouts/Demo.json").is_symlink())
        self.assertTrue({"music", "demo-mode", "jobs"} <= {p.name for p in (self.herdr / "mods").iterdir()})
        self.assertEqual(json.loads((self.herdr / "settings.json").read_text())["font_size"], 13.0)

    def test_a_dotfiles_mod_the_machine_no_longer_lists_is_unlinked_and_others_are_kept(self):
        (self.herdr / "mods/music").symlink_to(ROOT / "mods/music")
        (self.herdr / "mods/ops-tasks").symlink_to(self.tmp / "kit/herdr-mods/ops-tasks")
        out = self.ok("omarchy")
        self.assertIn("remove", out)
        self.assertFalse((self.herdr / "mods/music").is_symlink())
        self.assertTrue((self.herdr / "mods/ops-tasks").is_symlink())

    def test_settings_write_through_a_settings_link(self):
        real = self.tmp / "dotfiles-settings.json"
        real.write_text('{"zoom": 1.2}')
        (self.herdr / "settings.json").symlink_to(real)
        self.ok("mac")
        self.assertTrue((self.herdr / "settings.json").is_symlink())
        self.assertEqual(json.loads(real.read_text())["theme"], "rose-pine-moon")

    def test_drop_panels_moves_the_active_panel_to_one_that_remains(self):
        layout = {"id": "root", "children": [{"id": "panel-body", "type": "stack", "active": "ops-tasks", "children": [
            {"id": "files", "content": {"mod": "my-files"}}, {"id": "ops-tasks", "content": {"mod": "ops-tasks"}}]}]}
        trimmed = link.drop_panels(layout, {"ops-tasks"})
        self.assertEqual(panel_ids(trimmed), (["files"], "files"))
        self.assertEqual(len(layout["children"][0]["children"]), 2)  # the original is untouched

    def test_drop_panels_drops_floating_blocks_and_falls_back_for_header_and_toast(self):
        layout = {"id": "root", "toast": "parker-toast", "children": [
            {"id": "work-body", "floating": [{"id": "lock-in", "content": {"mod": "lock-in"}}], "children": [
                {"id": "main", "content": {"tab": "active", "pane": {"header": {"content": {"mod": "pane-header"}, "height": 30}}}}]}]}
        trimmed = link.drop_panels(layout, {"lock-in", "pane-header", "parker-toast"})
        self.assertNotIn("toast", trimmed)
        body = trimmed["children"][0]
        self.assertNotIn("floating", body)
        self.assertEqual(body["children"][0]["content"]["pane"]["header"], {"content": {"mod": "pane"}, "height": 30})
        # The original is untouched.
        self.assertEqual(layout["children"][0]["children"][0]["content"]["pane"]["header"]["content"]["mod"], "pane-header")
        self.assertEqual(link.drop_panels(layout, set()), layout)

    def test_refuses_to_run_from_a_checkout_other_than_home_dotfiles(self):
        env = {**os.environ, "HOME": str(self.tmp)}
        # --herdr-home alone isn't a sandbox: without --bin-dir it would still touch the real setup.
        out = subprocess.run([sys.executable, str(LINK), "--check", "--herdr-home", str(self.herdr)],
                             capture_output=True, text=True, env=env)
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("run this from ~/dotfiles", out.stderr)

    def test_invalid_settings_stop_the_link_and_stay_untouched(self):
        (self.herdr / "settings.json").write_text('{"zoom": 1.2,}')
        out = self.run_link("omarchy")
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("isn't valid JSON", out.stderr)
        self.assertEqual((self.herdr / "settings.json").read_text(), '{"zoom": 1.2,}')

    def test_settings_merge_keeps_keys_herdr_adds_inside_objects(self):
        (self.herdr / "settings.json").write_text('{"sounds": {"volume": 0.4}}')
        self.ok("omarchy")
        sounds = json.loads((self.herdr / "settings.json").read_text())["sounds"]
        self.assertEqual((sounds["volume"], sounds["enabled"]), (0.4, True))
        self.assertTrue(list((self.herdr / ".link-state/backups").rglob(".settings.json.link-old")))

    def test_a_hand_edited_layout_copy_is_backed_up_before_it_is_rewritten(self):
        self.ok("omarchy")
        (self.herdr / "layouts/Parker.json").write_text('{"edited": true}')
        self.ok("omarchy")
        saved = list((self.herdr / ".link-state/backups").rglob(".Parker.json.link-old"))
        self.assertEqual(saved[0].read_text(), '{"edited": true}')

    def test_a_failed_schedule_refresh_fails_the_link(self):
        (self.tmp / "systemd").mkdir()
        (self.tmp / "launchd").mkdir()
        # A schedule for a job whose definition can't load: refresh exits 4 and link must say so.
        defs = self.tmp / "dotfiles/herdr-app/machines/omarchy/jobs"
        defs.mkdir(parents=True)
        (defs / "broken.toml").write_text('repo = "/nonexistent"\nagent = "codex"\nprompt = "x"\n')
        (self.tmp / "systemd/parker-job-broken.timer").write_text("")
        (self.tmp / "launchd/com.parker.job.broken.plist").write_text("")
        out = self.run_link("omarchy")
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("job refresh failed", out.stderr)

    def test_a_sandboxed_link_never_touches_schedules_outside_it(self):
        agents = self.tmp / "Library/LaunchAgents"
        agents.mkdir(parents=True)
        old = agents / "com.parker.job.demo.plist"
        old.write_text("old")
        env = {**os.environ, "HOME": str(self.tmp), "LINK_ANY_PLATFORM": "1"}
        for key in ("JOB_SCHEDULER", "JOB_LAUNCHD_DIR", "JOB_SYSTEMD_DIR", "JOB_STATE_DIR", "JOB_DEFS", "PARKER_MACHINE"):
            env.pop(key, None)
        subprocess.run([sys.executable, str(LINK), "--machine", "omarchy", "--herdr-home", str(self.herdr),
                        "--bin-dir", str(self.bin)], capture_output=True, text=True, env=env)
        self.assertEqual(old.read_text(), "old")

    def test_settings_that_are_not_an_object_stop_the_link(self):
        (self.herdr / "settings.json").write_text("null")
        out = self.run_link("omarchy")
        self.assertIn("should hold a JSON object", out.stderr)

    def test_refuses_a_machine_from_another_platform(self):
        other = "omarchy" if sys.platform == "darwin" else "mac"
        env = {**os.environ, "HOME": str(self.tmp)}
        out = subprocess.run([sys.executable, str(LINK), "--machine", other, "--herdr-home", str(self.herdr),
                              "--bin-dir", str(self.bin)], capture_output=True, text=True, env=env)
        self.assertIn("check --machine", out.stderr)


if __name__ == "__main__":
    unittest.main()
