import concurrent.futures
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location('music_control', Path(__file__).parents[1] / 'mods/music/music-control.py')
music = importlib.util.module_from_spec(spec)
spec.loader.exec_module(music)


class ControlTests(unittest.TestCase):
    def test_validation_precedes_execution(self):
        for request in [{'action': 'unknown'}, {'action': 'set-volume', 'value': True},
                        {'action': 'set-volume', 'value': 101}, {'action': 'set-shuffle', 'value': 'yes'},
                        {'action': 'play-playlist', 'value': 'name"; shell()'}]:
            with self.subTest(request=request), self.assertRaises(ValueError):
                music.call(request, runner=lambda *a, **k: self.fail('executed invalid request'))

    def test_data_is_passed_as_argv(self):
        def runner(argv, **kwargs):
            self.assertEqual(json.loads(argv[-1]), {'action': 'play-playlist', 'value': '1234567890ABCDEF'})
            self.assertNotIn('shell', kwargs)
            return subprocess.CompletedProcess(argv, 0, '{"ok":true}', '')
        with tempfile.TemporaryDirectory() as root:
            self.assertTrue(music.call({'action': 'play-playlist', 'value': '1234567890ABCDEF'}, runner, root)['ok'])

    def test_timeout_is_uncertain_and_not_retried(self):
        count = []
        def runner(*args, **kwargs):
            count.append(1)
            raise subprocess.TimeoutExpired('osascript', 25)
        with tempfile.TemporaryDirectory() as root:
            reply = music.call({'action': 'next'}, runner, root)
            self.assertEqual(reply['error']['code'], 'timeout')
            self.assertEqual(len(count), 1)

    def test_cross_instance_lock_and_release(self):
        started, release = threading.Event(), threading.Event()
        def runner(*args, **kwargs):
            started.set()
            release.wait(3)
            return subprocess.CompletedProcess([], 0, '{"ok":true}', '')
        with tempfile.TemporaryDirectory() as root, concurrent.futures.ThreadPoolExecutor() as pool:
            first = pool.submit(music.call, {'action': 'next'}, runner, root)
            self.assertTrue(started.wait(1))
            second = music.call({'action': 'pause'}, lambda *a, **k: self.fail('concurrent command'), root)
            self.assertEqual(second['error']['code'], 'busy')
            release.set()
            self.assertTrue(first.result()['ok'])
            self.assertTrue(music.call({'action': 'status'}, runner, root)['ok'])

    def test_corrupt_bridge_response_is_actionable(self):
        with tempfile.TemporaryDirectory() as root:
            reply = music.call({'action': 'status'}, lambda *a, **k: subprocess.CompletedProcess([], 0, 'null', ''), root)
            self.assertEqual(reply['error']['code'], 'bridge_error')


if __name__ == '__main__':
    unittest.main()
