#!/usr/bin/env python3
"""Bounded, serialized Music Apple events. No credentials or library writes."""
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time

ACTIONS = {'connect', 'status', 'list-playlists', 'play-playlist', 'play', 'pause', 'next', 'set-volume', 'set-shuffle'}


def validate(request):
    if not isinstance(request, dict) or request.get('action') not in ACTIONS:
        raise ValueError('Unknown Music action.')
    action, value = request['action'], request.get('value')
    if action == 'play-playlist' and (not isinstance(value, str) or not re.fullmatch(r'[0-9A-Fa-f]{16}', value)):
        raise ValueError('Select a library playlist to link.')
    if action == 'set-volume' and (type(value) is not int or not 0 <= value <= 100):
        raise ValueError('Music volume must be an integer from 0 to 100.')
    if action == 'set-shuffle' and type(value) is not bool:
        raise ValueError('Shuffle must be true or false.')
    return {'action': action, **({'value': value} if action in {'play-playlist', 'set-volume', 'set-shuffle'} else {})}


def failure(code, message):
    return {'ok': False, 'error': {'code': code, 'message': message}}


def call(request, runner=subprocess.run, lock_root=None):
    request = validate(request)
    # Kernel flock survives popup churn and releases automatically on process exit.
    root = Path(lock_root or tempfile.gettempdir()) / ('herdr-music-%s' % os.getuid())
    root.mkdir(mode=0o700, exist_ok=True)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        return failure('lock_error', 'Music control lock is unavailable.')
    fd = os.open(str(root / 'control.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        deadline = time.monotonic() + 1
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    return failure('busy', 'Another Music command is finishing. Refresh before trying again.')
                time.sleep(0.05)
        try:
            result = runner(['/usr/bin/osascript', '-l', 'JavaScript',
                             str(Path(__file__).with_suffix('.js')), json.dumps(request)],
                            capture_output=True, text=True, timeout=25)
        except subprocess.TimeoutExpired:
            return failure('timeout', 'Music did not respond. The action may have completed. Refresh before retrying.')
        if result.returncode:
            return failure('bridge_error', 'Music control could not finish. Open Music, then retry connection. ' + result.stderr.strip()[-250:])
        try:
            reply = json.loads(result.stdout)
            if not isinstance(reply, dict) or type(reply.get('ok')) is not bool:
                raise ValueError()
            return reply
        except (ValueError, TypeError):
            return failure('bridge_error', 'Music returned an unreadable response. Refresh before retrying.')
    finally:
        os.close(fd)


def main():
    try:
        if len(sys.argv) != 2:
            raise ValueError('Expected one Music request.')
        result = call(json.loads(sys.argv[1]))
    except (ValueError, TypeError) as error:
        result = failure('invalid_request', str(error))
    except OSError:
        result = failure('bridge_error', 'Could not run Music control. Check the helper installation.')
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
