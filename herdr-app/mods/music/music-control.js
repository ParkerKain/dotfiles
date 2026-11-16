// Run by music-control.py through osascript. Fixed source, arguments are JSON data.
function run(argv) {
  function fail(code, message) { return {ok: false, error: {code: code, message: message}}; }
  function optional(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }
  try {
    var request = JSON.parse(argv[0]);
    var music = Application('/System/Applications/Music.app');
    if (!music.running()) {
      if (request.action === 'connect' || request.action === 'play-playlist') music.launch();
      else return JSON.stringify({ok: true, state: {running: false, playback: 'stopped', track: null, playlist: null}});
    }
    // All Apple events occur after the UI's explicit Connect step.
    var version = music.version();
    function status() {
      return {running: true, version: version, playback: music.playerState(),
        volume: music.soundVolume(), shuffle: music.shuffleEnabled(),
        track: optional(function () { var t = music.currentTrack(); return {name: t.name(), artist: t.artist()}; }, null),
        playlist: optional(function () { var p = music.currentPlaylist(); return {id: p.persistentID(), name: p.name()}; }, null)};
    }
    switch (request.action) {
      case 'connect': case 'status': break;
      case 'list-playlists':
        // Saved curator playlists are subscriptionPlaylist, not userPlaylist.
        return JSON.stringify({ok: true, playlists: music.playlists().filter(function (p) {
          return ['userPlaylist', 'subscriptionPlaylist'].indexOf(p.class()) !== -1;
        }).map(function (p) {
          return {id: p.persistentID(), name: p.name()};
        }).sort(function (a, b) { return a.name.localeCompare(b.name); })});
      case 'play-playlist':
        var matches = music.playlists.whose({persistentID: request.value})();
        if (matches.length !== 1) return JSON.stringify(fail('playlist_missing', 'This playlist is no longer in Music. Link it again.'));
        if (!matches[0].tracks().length) return JSON.stringify(fail('playlist_empty', 'This playlist has no available tracks. Open Music to check sign-in and library sync.'));
        music.play(matches[0]);
        break;
      case 'play':
        if (!optional(function () { return music.currentTrack().name(); }, null))
          return JSON.stringify(fail('no_queue', 'Choose a linked playlist to start listening.'));
        music.play(); break;
      case 'pause': music.pause(); break;
      case 'next': music.nextTrack(); break;
      case 'set-volume': music.soundVolume = request.value; break;
      case 'set-shuffle': music.shuffleEnabled = request.value; break;
      default: return JSON.stringify(fail('invalid_request', 'Unknown Music action.'));
    }
    return JSON.stringify({ok: true, state: status()});
  } catch (error) {
    var number = Number(error.number);
    var code = number === -1743 || number === -1744 ? 'permission_denied' : number === -1712 ? 'timeout' : 'music_error';
    return JSON.stringify(fail(code, code === 'permission_denied'
      ? 'Allow Music control in System Settings > Privacy & Security > Automation, then choose Retry connection.'
      : String(error.message || error)));
  }
}
