import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("revive", Path(__file__).with_name("revive.py"))
revive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(revive)


def wrapped(*argv):
    return ["/bin/zsh", "-lic", '\"$@\"; exec \"$0\" -li', "/bin/zsh", *argv]


class ReviveTests(unittest.TestCase):
    def test_prompt_mentions_other_agent(self):
        for argv, expected in [
            (["codex", "--no-daemon", "Compare Claude Code and Codex"], "codex"),
            (["claude", "Compare codex and Claude Code"], "claude"),
        ]:
            for command in (argv, wrapped(*argv)):
                with self.subTest(command=command):
                    self.assertEqual(revive.kind_of({"agent": "zsh"}, {"argv": command}, []), expected)

    def test_reported_agent_overrides_screen_and_title(self):
        for agent, expected in [("codex", "codex"), ("claude-code", "claude")]:
            with self.subTest(agent=agent):
                info = {"argv": ["/bin/zsh"], "cwd": "/work", "title": "Task | work"}
                self.assertEqual(revive.kind_of({"agent": agent}, info, ["✻ old Claude screen"]), expected)

    def test_executable_overrides_screen(self):
        info = {"argv": ["/usr/local/bin/codex", "--no-daemon"]}
        self.assertEqual(revive.kind_of({"agent": "zsh"}, info, ["✻ old Claude screen"]), "codex")

    def test_shell_prompt_does_not_become_agent(self):
        info = {"argv": ["/bin/sh", "-c", "echo claude and codex"]}
        self.assertEqual(revive.kind_of({"agent": "sh"}, info, []), "shell")

    def test_title_and_screen_fallbacks(self):
        self.assertEqual(revive.kind_of({"agent": "zsh"}, {"cwd": "/work", "title": "Task | work"}, []), "codex")
        self.assertEqual(revive.kind_of({"agent": "zsh"}, {}, ["✻ Working"]), "claude")
        self.assertIsNone(revive.kind_of({}, {}, []))

    def test_codex_lookup_uses_prompt_after_no_daemon(self):
        with tempfile.TemporaryDirectory() as home:
            folder = Path(home) / ".codex/sessions/2026/11/15"
            folder.mkdir(parents=True)
            # The CLI flag is absent from the rollout. Only the prompt identifies it.
            (folder / "rollout-matching.jsonl").write_text(
                json.dumps({"payload": {"id": "matching-id", "cwd": "/work"}}) + "\n" +
                json.dumps({"prompt": "Compare Claude Code and Codex"}) + "\n"
            )
            (folder / "rollout-other.jsonl").write_text(
                json.dumps({"payload": {"id": "other-id", "cwd": "/work"}}) + "\n"
            )
            for argv in (["codex", "--no-daemon", "Compare Claude Code and Codex"], wrapped("codex", "--no-daemon", "Compare Claude Code and Codex")):
                with self.subTest(argv=argv), patch.object(revive, "HOME", home):
                    info = {"argv": argv, "cwd": "/work", "created_ms": 1794741233587, "finished_ms": 1794767182263}
                    self.assertEqual(revive.codex_session(info), "matching-id")

    def test_repeated_revive_keeps_session_id(self):
        sid = "019abcde-1234-1234-1234-123456789abc"
        self.assertEqual(revive.codex_session({"argv": wrapped("codex", "--no-daemon", "resume", sid)}), sid)

    def test_resume_plan_preserves_codex_and_no_daemon(self):
        for sid in ("matching-id", None):
            info = {"argv": wrapped("codex", "--no-daemon", "Compare Claude Code and Codex")}
            terms = {"terminals": [{"address": "t1", "agent": "zsh"}]}
            with self.subTest(sid=sid), patch.object(revive, "hc", side_effect=[json.dumps(info), json.dumps(terms)]), patch.object(revive, "read_screen", return_value=[]), patch.object(revive, "codex_session", return_value=sid), contextlib.redirect_stdout(io.StringIO()) as output:
                revive.cmd_resume("t1")
            expected = ["codex", "--no-daemon", "resume"] + ([sid] if sid else [])
            self.assertEqual(json.loads(output.getvalue())["argv"], expected)


if __name__ == "__main__":
    unittest.main()
