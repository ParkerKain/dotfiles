import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("projects", Path(__file__).parents[1] / "mods/session-launcher/projects.py")
projects = importlib.util.module_from_spec(spec)
spec.loader.exec_module(projects)

DEFAULT_ROUTE = {"project": "kit", "reason": "Agent hooks belong in parker-agent-kit.", "new_space": False, "tab_name": "focus-fix", "split": "none"}


class CatalogTest(unittest.TestCase):
    def test_only_canonical_repos_and_dotfiles_are_offered(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            repos = home / "Documents/internal/repos"
            for name in ["devclarity-vault", "other", "linked", "notes"]:
                (repos / name).mkdir(parents=True)
            (repos / "devclarity-vault/.git").mkdir()
            (repos / "other/.git").mkdir()
            (repos / "other/README.md").write_text("Other project overview")
            (repos / "linked/.git").write_text("gitdir: elsewhere")
            (repos / "CLAUDE.md").write_text("Parent instructions")
            rows = {row["name"]: row for row in projects.catalog(home)}
            self.assertEqual(set(rows), {"devclarity-vault", "other", "dotfiles"})
            self.assertIn("Default", rows["devclarity-vault"]["description"])
            self.assertIn("music mod", rows["dotfiles"]["description"])
            self.assertEqual(rows["other"]["description"], "Other project overview")
            json.dumps(list(rows.values()))


class PlanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        repos = self.home / "Documents/internal/repos"
        for name in ["parker-agent-kit", "devclarity-vault", "raya-demo"]:
            (repos / name / ".git").mkdir(parents=True)
        (self.home / "dotfiles").mkdir()
        self.kit, self.vault, self.demo = (str(repos / n) for n in ["parker-agent-kit", "devclarity-vault", "raya-demo"])
        self.dotfiles = str(self.home / "dotfiles")
        self.spaces = [{"id": "demo", "folder": self.demo}, {"id": "kit", "folder": self.kit}]
        self.asked = []

    def tearDown(self):
        self.tmp.cleanup()

    def plan(self, request, route=None, **payload):
        route = {**DEFAULT_ROUTE, "project": self.kit, **(route or {})}

        def ask(instruction, schema, home):
            self.asked.append({"instruction": instruction, "schema": json.loads(schema), "home": home})
            return route
        payload = {"request": request, "origin": {"space": "demo", "cwd": self.demo}, **payload}
        return projects.plan(payload, home=self.home, spaces=payload.pop("spaces", self.spaces), ask=ask)

    def test_planner_uses_project_descriptions_vault_fallback_and_neutral_cwd(self):
        self.plan("Fix agent hook focus")
        call = self.asked[0]
        self.assertIn("Herdr music mod, Spotify controls", call["instruction"])
        self.assertIn("Merely leaving a tab selected is never evidence", call["instruction"])
        self.assertIn("For general work or no identifiable software project, choose devclarity-vault", call["instruction"])
        self.assertIn("Always choose exactly one project", call["instruction"])
        self.assertEqual(call["home"], self.home)
        self.assertEqual(set(call["schema"]["properties"]["project"]["enum"]), {self.kit, self.vault, self.demo, self.dotfiles})

    def test_uses_the_project_space(self):
        route = self.plan("Fix agent hook focus")
        self.assertEqual((route["folder"], route["space"], route["space_id"]), (self.kit, "existing", "kit"))

    def test_rejects_arbitrary_folders_malformed_routes_and_invalid_layouts(self):
        for patch in [{"project": "/home/parker/random"}, {"split": "left"}, {"reason": ""}]:
            with self.assertRaisesRegex(RuntimeError, "invalid project choice"):
                self.plan("Fix hooks", patch)

    def test_remote_spaces_cannot_be_reused_or_supply_a_current_folder(self):
        remote = [{"id": "demo", "folder": self.demo, "machine": "server"}, {"id": "remote", "folder": self.kit, "machine": "server"}]
        route = self.plan("Fix hooks in this repo", spaces=remote)
        self.assertEqual(route["space"], "new")
        self.assertIn("Current local project: none", self.asked[0]["instruction"])

    def test_user_override_wins_and_tasks_play_supplies_its_default(self):
        route = self.plan("Change this", override=self.dotfiles, task={"folder": self.vault})
        self.assertEqual(route["folder"], self.dotfiles)
        self.assertIn("Tasks Play default", self.asked[0]["instruction"])

    def test_current_folder_enters_the_catalog_only_for_an_explicit_reference(self):
        current = str(self.home / "elsewhere-demo")
        Path(current).mkdir()
        demo_only = [{"id": "demo", "folder": current}]
        self.plan("Fix hooks", spaces=demo_only, origin={"space": "demo", "cwd": current})
        self.assertNotIn(current, self.asked[-1]["schema"]["properties"]["project"]["enum"])
        route = self.plan("Fix tests in this repo", {"project": current}, spaces=demo_only, origin={"space": "demo", "cwd": current})
        self.assertEqual(route["folder"], current)


class LaunchTest(unittest.TestCase):
    route = {"folder": "/h/kit", "space": "existing", "space_id": "kit", "space_name": "kit", "tab_name": "focus-fix", "split": "none"}
    payload = {"request": "Fix hooks", "agent": {"key": "codex", "run": ["codex", "--no-daemon"]}}

    def launch(self, route=None, payload=None, spaces=None, addresses=lambda: {}):
        calls = []
        projects.launch({**self.route, **(route or {})}, {**self.payload, **(payload or {})}, do=lambda c, a: calls.append((c, a)),
                        spaces=[{"id": "kit", "folder": "/h/kit"}] if spaces is None else spaces, addresses=addresses, wait=lambda: None)
        return calls

    def test_launch_uses_the_planned_space(self):
        calls = self.launch()
        self.assertEqual(calls, [("tab.new", {"name": "focus-fix", "folder": "/h/kit", "argv": ["codex", "--no-daemon"], "task": "Fix hooks", "space": "kit"})])

    def test_closed_destination_fails_without_creating_a_different_space(self):
        with self.assertRaisesRegex(RuntimeError, "changed or closed"):
            self.launch(spaces=[])

    def test_new_space_is_local_and_split_follows(self):
        calls = self.launch({"space": "new", "space_id": "", "folder": "/h/dotfiles", "space_name": "dotfiles", "split": "right"})
        self.assertEqual(calls[0][0], "space.new")
        self.assertEqual((calls[0][1]["folder"], calls[0][1]["machine"]), ("/h/dotfiles", ""))
        self.assertEqual(calls[1], ("pane.split", {"direction": "right"}))

    def test_tasks_play_names_the_claude_session_and_labels_the_terminal(self):
        seen = iter([{"t1": "/x"}, {"t1": "/x"}, {"t1": "/x", "t2": "/h/kit"}])
        labels = []
        original = projects.subprocess.run
        projects.subprocess.run = lambda argv, **_: labels.append(argv)
        try:
            calls = self.launch(payload={"agent": {"key": "claude", "run": ["claude"]}, "task": {"title": "Ops task", "slug": "ops-task", "ref": "T-1"}},
                                addresses=lambda: next(seen))
        finally:
            projects.subprocess.run = original
        self.assertEqual(calls[0][1]["argv"], ["claude", "-n", "ops-task"])
        self.assertEqual(calls[0][1]["name"], "Ops task")
        self.assertEqual(labels, [["hc", "label", "t2", "ops-task=T-1"]])


if __name__ == "__main__":
    unittest.main()
