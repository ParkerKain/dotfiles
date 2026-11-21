"""Tests for herdr-app/jobs/job: definitions, both schedulers, hooks, pause and per-machine sources.

Run: python3 -m unittest herdr-app/test/job_test.py
Nothing is loaded into launchd or systemd (JOB_SCHEDULER=none) and hc is a fake.
"""
import json
import os
import plistlib
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JOB = ROOT / "jobs/job"


class JobTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(subprocess.run, ["rm", "-rf", str(self.tmp)])
        self.defs = self.tmp / "defs"
        self.defs.mkdir()
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        bin_ = self.tmp / "bin"
        bin_.mkdir()
        # hc: every call answers an empty object, `get` reports nothing live.
        (bin_ / "hc").write_text("#!/bin/sh\necho '{}'\n")
        (bin_ / "hc").chmod(0o755)
        self.env = {**os.environ, "JOB_DEFS": str(self.defs), "JOB_STATE_DIR": str(self.tmp / "state"),
                    "JOB_SCHEDULER": "none", "JOB_LAUNCHD_DIR": str(self.tmp / "launchd"),
                    "JOB_SYSTEMD_DIR": str(self.tmp / "systemd"),
                    "JOB_PATH": f"{bin_}:{Path(sys.executable).parent}:/usr/bin:/bin"}

    def write(self, name, body, folder=None):
        path = (folder or self.defs) / f"{name}.toml"
        path.write_text(textwrap.dedent(body))
        return path

    def hook_script(self, name="hook.py", status=None, fail=False):
        """A hook script that records each check and answers status."""
        status = status or {"ok": True, "hooks": [{"last_check": {"ts": 1, "state": "ok", "result": "no new"}}]}
        script = self.defs / name
        script.write_text(textwrap.dedent(f"""\
            import json, sys, pathlib
            if sys.argv[1] == "check":
                pathlib.Path({str(self.tmp / 'checked')!r}).write_text("yes")
                print(json.dumps({{"ok": True, "triggered": 0}}))
            elif sys.argv[1] == "status":
                {"sys.exit('boom')" if fail else f"print(json.dumps({status!r}))"}
            """))
        return script

    def job(self, *args, env=None, check=True):
        out = subprocess.run([sys.executable, str(JOB), *args], capture_output=True, text=True,
                             env={**self.env, **(env or {})})
        if check and out.returncode != 0:
            self.fail(f"job {' '.join(args)} exited {out.returncode}: {out.stderr}")
        return out

    def weekly(self, name="weekly"):
        self.write(name, f"""\
            repo = "{self.repo}"
            agent = "claude"
            prompt = "do it"
            [schedule]
            times = ["05:00", "12:30"]
            weekdays = [1, 7]
            """)

    def hook(self, name="mail-inbox", **kw):
        self.hook_script(**kw)
        self.write(name, """\
            title = "Mail inbox"
            check = "hook.py"
            interval = 300
            """)

    # ---- definitions

    def test_lists_jobs_and_hooks_from_every_source(self):
        other = self.tmp / "other"
        other.mkdir()
        self.weekly()
        self.hook()
        self.write("manual", f'repo = "{self.repo}"\nagent = "codex"\nprompt = "x"\n', folder=other)
        out = self.job("list", env={"JOB_DEFS": f"{self.defs}{os.pathsep}{other}"}).stdout
        self.assertRegex(out, r"weekly\s+job\s+claude\s+05:00, 12:30 days \[1, 7\]")
        self.assertRegex(out, r"mail-inbox\s+hook\s+every 5 min")
        self.assertRegex(out, r"manual\s+job\s+codex\s+manual")

    def test_a_name_defined_twice_is_an_error(self):
        other = self.tmp / "other"
        other.mkdir()
        self.weekly()
        self.weekly_path = self.write("weekly", f'repo = "{self.repo}"\nagent = "claude"\nprompt = "x"\n', folder=other)
        out = self.job("list", env={"JOB_DEFS": f"{self.defs}{os.pathsep}{other}"})
        self.assertRegex(out.stdout, r"weekly\s+job\s+broken: 'weekly' is defined twice")

    def test_a_hook_needs_a_real_interval(self):
        self.hook_script()
        self.write("fast", 'check = "hook.py"\ninterval = 5\n')
        # A broken file is listed with its reason, not hidden, and doesn't stop the others.
        self.weekly()
        out = self.job("list").stdout
        self.assertRegex(out, r"fast\s+hook\s+broken: .*at least 60")
        self.assertIn("weekly", out)

    # ---- launchd

    def test_launchd_job_runs_at_each_time_and_weekday(self):
        self.weekly()
        self.job("install", "weekly", env={"JOB_SCHEDULER_FORMAT": "launchd"})
        plist = plistlib.loads((self.tmp / "launchd/com.parker.job.weekly.plist").read_bytes())
        self.assertEqual(plist["ProgramArguments"][-2:], ["run", "weekly"])
        # launchd counts Sunday as 0; job files use 1 = Monday ... 7 = Sunday.
        self.assertEqual(plist["StartCalendarInterval"], [
            {"Hour": 5, "Minute": 0, "Weekday": 1}, {"Hour": 5, "Minute": 0, "Weekday": 0},
            {"Hour": 12, "Minute": 30, "Weekday": 1}, {"Hour": 12, "Minute": 30, "Weekday": 0}])

    def test_launchd_hook_checks_every_interval_through_the_engine(self):
        self.hook()
        self.job("install", "mail-inbox", env={"JOB_SCHEDULER_FORMAT": "launchd"})
        plist = plistlib.loads((self.tmp / "launchd/com.parker.hook.mail-inbox.plist").read_bytes())
        self.assertEqual(plist["Label"], "com.parker.hook.mail-inbox")
        self.assertEqual(plist["ProgramArguments"][-2:], ["check", "mail-inbox"])
        self.assertEqual((plist["StartInterval"], plist["RunAtLoad"]), (300, True))

    # ---- systemd

    def test_systemd_job_timer_uses_calendar_times(self):
        self.weekly()
        self.job("install", "weekly", env={"JOB_SCHEDULER_FORMAT": "systemd"})
        timer = (self.tmp / "systemd/parker-job-weekly.timer").read_text()
        service = (self.tmp / "systemd/parker-job-weekly.service").read_text()
        self.assertIn("OnCalendar=Mon,Sun *-*-* 05:00:00\n", timer)
        self.assertIn("OnCalendar=Mon,Sun *-*-* 12:30:00\n", timer)
        self.assertIn("Persistent=true", timer)
        self.assertIn("WantedBy=timers.target", timer)
        self.assertRegex(service, r"ExecStart=\S+python\S* \S+/jobs/job run weekly\n")
        # The agent session belongs to herdr-core; ending the unit must not kill it.
        self.assertIn("KillMode=process", service)
        self.assertIn("TimeoutStartSec=infinity", service)

    def test_systemd_daily_job_has_no_weekday_prefix(self):
        self.write("daily", f'repo = "{self.repo}"\nagent = "codex"\nprompt = "x"\n[schedule]\ntimes = ["09:00"]\n')
        self.job("install", "daily", env={"JOB_SCHEDULER_FORMAT": "systemd"})
        self.assertIn("OnCalendar=*-*-* 09:00:00\n", (self.tmp / "systemd/parker-job-daily.timer").read_text())

    def test_systemd_hook_timer_repeats_after_each_check(self):
        self.hook()
        self.job("install", "mail-inbox", env={"JOB_SCHEDULER_FORMAT": "systemd"})
        timer = (self.tmp / "systemd/parker-hook-mail-inbox.timer").read_text()
        self.assertIn("OnUnitActiveSec=300", timer)
        self.assertIn("OnActiveSec=10", timer)
        self.assertIn("check mail-inbox", (self.tmp / "systemd/parker-hook-mail-inbox.service").read_text())

    def test_uninstall_removes_both_systemd_units(self):
        self.hook()
        env = {"JOB_SCHEDULER_FORMAT": "systemd"}
        self.job("install", "mail-inbox", env=env)
        self.job("uninstall", "mail-inbox", env=env)
        self.assertEqual(list((self.tmp / "systemd").iterdir()), [])

    def test_a_job_without_a_schedule_cannot_be_installed(self):
        self.write("manual", f'repo = "{self.repo}"\nagent = "claude"\nprompt = "x"\n')
        out = self.job("install", "manual", check=False)
        self.assertIn("no [schedule]", out.stderr)

    # ---- status

    def test_status_reports_jobs_hooks_and_what_is_loaded(self):
        self.weekly()
        self.hook()
        self.job("install", "mail-inbox")
        data = json.loads(self.job("status").stdout)
        self.assertTrue(data["ok"])
        job, = data["jobs"]
        self.assertEqual((job["name"], job["loaded"], job["times"], job["weekdays"]), ("weekly", False, ["05:00", "12:30"], [1, 7]))
        hook, = data["hooks"]
        self.assertEqual((hook["name"], hook["title"], hook["interval"], hook["loaded"]), ("mail-inbox", "Mail inbox", 300, True))
        self.assertEqual(hook["last_check"]["result"], "no new")
        self.assertIsNone(hook["error"])

    def test_a_failing_hook_status_shows_its_error_without_hiding_jobs(self):
        self.weekly()
        self.hook(fail=True)
        data = json.loads(self.job("status").stdout)
        self.assertEqual(len(data["jobs"]), 1)
        self.assertIn("hook.py", data["hooks"][0]["error"])

    # ---- running

    def test_check_skips_while_paused_and_runs_with_force(self):
        self.hook()
        self.job("pause", "--by", "demo")
        out = json.loads(self.job("check", "mail-inbox").stdout)
        self.assertEqual(out["result"], "paused")
        self.assertFalse((self.tmp / "checked").exists())
        self.job("check", "mail-inbox", "--force")
        self.assertTrue((self.tmp / "checked").exists())

    def test_resume_by_someone_else_keeps_the_pause(self):
        self.job("pause")
        self.assertIsNotNone(json.loads(self.job("resume", "--by", "demo").stdout)["paused"])
        self.assertIsNone(json.loads(self.job("resume").stdout)["paused"])

    def test_run_skips_while_paused(self):
        self.weekly()
        self.job("pause")
        out = json.loads(self.job("run", "weekly").stdout)
        self.assertEqual((out["started"], out["paused"]), (False, True))

    def test_run_and_check_refuse_the_other_kind(self):
        self.weekly()
        self.hook()
        self.assertIn("is a hook", self.job("run", "mail-inbox", check=False).stderr)
        self.assertIn("is a job", self.job("check", "weekly", check=False).stderr)

    # ---- machines

    def test_each_machine_sees_only_its_own_jobs(self):
        env = {k: v for k, v in self.env.items() if k != "JOB_DEFS"}
        home = self.tmp / "home"
        kit_defs = home / "Documents/internal/repos/parker-agent-kit/jobs/defs"
        kit_defs.mkdir(parents=True)
        (kit_defs / "client-brief.toml").write_text(f'repo = "{self.repo}"\nagent = "claude"\nprompt = "x"\n')
        (home / "dotfiles").symlink_to(ROOT.parent)

        def listed(machine):
            out = subprocess.run([sys.executable, str(JOB), "list"], capture_output=True, text=True,
                                 env={**env, "PARKER_MACHINE": machine, "HOME": str(home)})
            self.assertEqual(out.returncode, 0, out.stderr)
            return out.stdout
        self.assertIn("client-brief", listed("mac"))
        self.assertNotIn("dotfiles-check", listed("mac"))
        self.assertIn("dotfiles-check", listed("omarchy"))
        self.assertNotIn("client-brief", listed("omarchy"))

    # ---- review fixes

    def test_schedules_name_the_engine_in_home_dotfiles_not_this_checkout(self):
        self.weekly()
        out = self.job("unit", "weekly", env={"JOB_SCHEDULER_FORMAT": "systemd", "HOME": str(self.tmp)}).stdout
        self.assertIn(f"{self.tmp}/dotfiles/herdr-app/jobs/job run weekly", out)

    def test_real_installs_refuse_to_run_from_another_checkout(self):
        self.weekly()
        # HOME has no dotfiles, so this checkout isn't ~/dotfiles; it must stop before writing anything.
        out = self.job("install", "weekly", env={"JOB_SCHEDULER": "launchd", "HOME": str(self.tmp)}, check=False)
        self.assertIn("run this from ~/dotfiles", out.stderr)
        self.assertFalse((self.tmp / "launchd").exists())

    def test_refresh_rewrites_old_schedules_and_reports_with_exit_codes(self):
        self.weekly()
        self.hook()
        self.job("install", "weekly")
        self.job("install", "mail-inbox")
        plist = self.tmp / "launchd/com.parker.job.weekly.plist"
        if plist.exists():  # macOS format; on Linux the systemd files are checked instead
            plist.write_bytes(plist.read_bytes().replace(b"run", b"old"))
        else:
            unit = self.tmp / "systemd/parker-job-weekly.service"
            unit.write_text(unit.read_text().replace("run weekly", "old weekly"))
        self.assertEqual(self.job("refresh", "--check", check=False).returncode, 3)
        self.assertIn("rewrote the job schedule for weekly", self.job("refresh").stdout)
        self.assertEqual(self.job("refresh", "--check", check=False).returncode, 0)

    def test_refresh_keeps_going_past_a_broken_definition(self):
        self.weekly()
        self.write("aaa-broken", f'repo = "{self.repo}"\nagent = "claude"\nprompt = "x"\n[schedule]\ntimes = ["01:00"]\n')
        self.job("install", "aaa-broken")
        self.job("install", "weekly")
        (self.defs / "aaa-broken.toml").write_text('repo = "/nonexistent"\nagent = "claude"\nprompt = "x"\n[schedule]\ntimes = ["01:00"]\n')
        out = self.job("refresh", "--check", check=False)
        self.assertEqual(out.returncode, 4)
        self.assertIn("aaa-broken", out.stderr)

    def test_status_shows_a_broken_definition_on_its_own_row(self):
        self.weekly()
        self.write("gone", 'repo = "/nonexistent"\nagent = "claude"\nprompt = "x"\n')
        data = json.loads(self.job("status").stdout)
        rows = {r["name"]: r for r in data["jobs"]}
        self.assertIsNone(rows["weekly"]["error"])
        self.assertIn("not a folder", rows["gone"]["error"])

    def test_a_broken_hook_can_still_be_turned_off(self):
        self.hook()
        self.job("install", "mail-inbox", env={"JOB_SCHEDULER_FORMAT": "systemd"})
        (self.defs / "hook.py").unlink()
        self.job("uninstall", "mail-inbox", env={"JOB_SCHEDULER_FORMAT": "systemd"})
        self.assertEqual(list((self.tmp / "systemd").iterdir()), [])

    def test_malformed_files_become_broken_rows_not_crashes(self):
        self.weekly()
        self.write("badtime", f'repo = "{self.repo}"\nagent = "claude"\nprompt = "x"\n[schedule]\ntimes = ["7"]\n')
        self.write("nofile", f'repo = "{self.repo}"\nagent = "claude"\nprompt_file = "missing.md"\n')
        self.hook_script()
        self.write("badinterval", 'check = "hook.py"\ninterval = "abc"\n')
        self.write("unparsable", 'repo = [\n')
        data = json.loads(self.job("status").stdout)
        errors = {r["name"]: r["error"] for r in data["jobs"] + data["hooks"]}
        self.assertIsNone(errors["weekly"])
        self.assertIn("HH:MM", errors["badtime"])
        self.assertIn("missing.md", errors["nofile"])
        self.assertIn("badinterval", errors)
        self.assertIn("can't read", errors["unparsable"])

    def test_a_turned_on_job_that_lost_its_schedule_is_stale_not_failed(self):
        self.weekly()
        self.job("install", "weekly")
        self.write("weekly", f'repo = "{self.repo}"\nagent = "claude"\nprompt = "x"\n')
        out = self.job("refresh", "--check", check=False)
        self.assertEqual(out.returncode, 3)
        self.assertIn("has no [schedule] now (job uninstall weekly)", out.stdout)

    def test_a_schedule_whose_definition_changed_kind_is_stale_and_uninstall_removes_it(self):
        self.weekly()
        env = {"JOB_SCHEDULER_FORMAT": "systemd"}
        self.job("install", "weekly", env=env)
        self.hook_script()
        self.write("weekly", 'check = "hook.py"\ninterval = 300\n')
        out = self.job("refresh", "--check", env=env, check=False)
        self.assertEqual(out.returncode, 3)
        self.assertIn("defined as a hook now", out.stdout)
        self.job("uninstall", "weekly", env=env)
        self.assertEqual(list((self.tmp / "systemd").iterdir()), [])

    def test_a_hook_status_that_is_not_an_object_stays_on_its_row(self):
        self.weekly()
        self.hook(status=1)
        data = json.loads(self.job("status").stdout)
        self.assertIn("answered badly", data["hooks"][0]["error"])
        self.assertEqual(len(data["jobs"]), 1)

    def test_an_unparsable_definition_can_still_be_turned_off(self):
        self.hook()
        env = {"JOB_SCHEDULER_FORMAT": "systemd"}
        self.job("install", "mail-inbox", env=env)
        (self.defs / "mail-inbox.toml").write_text("check = [\n")
        self.job("uninstall", "mail-inbox", env=env)
        self.assertEqual(list((self.tmp / "systemd").iterdir()), [])

    def test_systemd_words_escape_percent_and_dollar(self):
        sys.path.insert(0, str(ROOT))
        import importlib.machinery, importlib.util
        loader = importlib.machinery.SourceFileLoader("job_engine", str(JOB))
        spec = importlib.util.spec_from_loader("job_engine", loader)
        engine = importlib.util.module_from_spec(spec)
        loader.exec_module(engine)
        self.assertEqual(engine.systemd_arg("PATH=/a b", exec_word=False), '"PATH=/a b"')
        self.assertEqual(engine.systemd_arg("50%$x"), "50%%$$x")
        self.assertEqual(engine.systemd_arg("$x", exec_word=False), "$x")
        self.assertEqual(engine.systemd_arg('say "hi"'), '"say \\"hi\\""')

if __name__ == "__main__":
    unittest.main()
