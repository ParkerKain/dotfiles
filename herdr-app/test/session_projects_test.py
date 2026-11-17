import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("projects", Path(__file__).parents[1] / "mods/session-launcher/projects.py")
projects = importlib.util.module_from_spec(spec)
spec.loader.exec_module(projects)


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


if __name__ == "__main__":
    unittest.main()
