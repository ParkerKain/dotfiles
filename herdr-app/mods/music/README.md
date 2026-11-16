# Music controls

Open Music in Herdr's tab bar or press Cmd+Shift+U. Escape closes the controls while Music keeps playing. The button appears in Parker and Frosted. Demo passes the shortcut to the terminal.

## First setup

1. Choose Open Music to sign in, then use Music's Account menu to sign into your Apple Music subscription.
2. Choose Connect to Music in Herdr and accept the macOS automation prompt if shown.
3. Choose Open in Music beside a Lofi Girl preset and add the original curator playlist to your library.
4. Choose Link in Herdr, find that library playlist and select it.
5. Choose Play beside the linked preset when you want to listen.

Connecting grants playback control. It does not sign you in or verify a subscription. Opening the popup before Connect sends no Music Apple events. Only Music handles account credentials.

## Playback and playlists

- Play/pause controls Music's current playback, including music started outside Herdr.
- Playing a preset replaces Music's current queue, and its identity is confirmed when Music exposes the matching library playlist.
- Volume changes Music's own volume in steps of five without changing system volume.
- Add library playlist creates a shortcut to any library playlist, with its name as the label.
- Link or Relink chooses an explicit library playlist, with an ID suffix to distinguish duplicate names.
- Arrow keys and Enter select a playlist in the linking list, and Escape returns to the controls.
- Up and down buttons reorder shortcuts, while Remove only deletes the shortcut in Herdr.
- Shortcuts persist across popups, layouts and Herdr restarts in the versioned `music.config` shared value.

The bundled presets link to [Lofi Girl's official curator page](https://music.apple.com/us/curator/lofi-girl/1568752863) and its study, jazz, house, autumn and Christmas playlists. Keep the original curator playlist in your library rather than copying its tracks into a new playlist. Updates remain managed by Music. New seasonal playlists can be added as new shortcuts. Apple Music's playlists may differ from the YouTube broadcasts.

Music can stay hidden during normal use and continues across spaces, layout changes and Herdr quitting while Music remains running. Initial sign-in and playlist setup use Music's own window. The controls never start playback on launch, opening or reload.

## Recovery

If automation is denied, use System Settings > Privacy & Security > Automation to allow Music access for the application named in the original permission prompt, then choose Retry connection. The exact application attribution depends on Herdr's execution chain. The mod stops automatic requests after denial.

If a command times out, it may already have reached Music. Choose Refresh to read the current state before retrying. The mod never repeats a mutation automatically. If Music has no resumable queue, choose a linked preset. If a preset was deleted or re-added in Music, Relink it because the library ID can change.

If playback does not start, Open Music to check sign-in, subscription, library sync and content availability. The mod cannot determine those conditions from a generic stopped playback state.

## Implementation and verification

The native GPUI popup runs a local Python helper, which uses the installed JXA Music dictionary through osascript. Python 3 is supplied by the existing developer-tools installation on this Mac. A kernel file lock serializes helper calls across popup instances. Each request has a deadline, and all arguments are passed as data. No network server, extra player or Apple developer account is needed.

Status is read every five seconds while the popup is open and connected. Read errors stop polling until an explicit refresh or reconnection. An already-dispatched action can finish after the popup closes. The popup's native checker suppresses helper calls and setup writes.

Run these checks from the dotfiles worktree:

```sh
node --test herdr-app/test/*.test.cjs
/usr/bin/python3 herdr-app/test/music_control_test.py
herdr-app check herdr-app/mods/music
herdr-app check herdr-app/mods/my-tabs
herdr-app check herdr-app/mods/keybind-help
```

## Rollback

Revert the Music changes to the tab bar, shortcut and help, remove the `~/.config/herdr-app/mods/music` symlink, then reload the changed mods. Existing Music playlists and playback are preserved. Automation permission can be removed separately in System Settings.
