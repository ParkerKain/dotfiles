const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const root = join(__dirname, '..');
const presets = JSON.parse(readFileSync(join(root, 'mods/music/presets.json')));
const connected = {version: 1, connected: true, presets};

function element() {
  const node = {children: [], attrs: {}, click: null};
  let proxy;
  proxy = new Proxy(node, {get(target, key) {
    if (key === 'node') return node;
    if (key === 'when') return (condition, fn) => condition ? fn(proxy) : proxy;
    if (key === 'child') return value => { node.children.push(value); return proxy; };
    if (key === 'children') return values => { node.children.push(...values); return proxy; };
    if (key === 'on_click') return fn => { node.click = fn; return proxy; };
    return (...args) => { node.attrs[key] = args; return proxy; };
  }});
  return proxy;
}

function find(root, id) {
  if (root?.node?.attrs.id?.[0] === id) return root.node;
  if (typeof root !== 'object' || !root) return null;
  for (const child of root.node?.children || []) { const result = find(child, id); if (result) return result; }
  return null;
}

function load(options = {}) {
  const state = new Map([['music.config', options.config ?? connected]]);
  const tasks = [];
  const timers = [];
  const calls = [];
  const cx = {notify() {}, focus_handle: () => ({focus() {}}),
    spawn(fn) { tasks.push(fn(cx)); },
    timer: {every(ms, fn) { timers.push(fn); }, after(ms, fn) { timers.push(fn); }}};
  const input = {on() {}, value: () => '', focus() {}, set_value() {}};
  const context = {View: class {}, checking: () => options.checking || false,
    div: element, h_flex: element, v_flex: element, svg: element, image: element, theme: () => ({}), Input: {new: element},
    SliderState: {new: () => ({on() {}, set_value() {}})}, Slider: {new: element}, SliderTrack: {new: element}, SliderIndicator: {new: element}, SliderThumb: {new: element},
    appHome: () => '/config', props: () => ({overlay: 'test'}),
    shared: key => state.get(key), setShared: (key, value) => state.set(key, value),
    InputState: {new: () => input}, ScrollHandle: {new: () => ({scroll_to_item() {}})},
    readTextFile: async () => JSON.stringify(presets),
    exec: async (cmd, args) => { calls.push({cmd, args}); return options.reply ? options.reply(cmd, args) : {stdout: JSON.stringify({ok: true, state: {running: false}})}; },
    closeOverlay() {}};
  const code = readFileSync(join(root, 'mods/music/main.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default class ', 'globalThis.Mod = class ');
  vm.runInNewContext(code, context);
  const mod = new context.Mod();
  return {mod, cx, calls, state, timers, async done() { for (let i = 0; i < tasks.length; i++) await tasks[i]; }};
}

test('native check never invokes Music, opens apps or writes shared config', async () => {
  const a = load({checking: true, config: null});
  a.mod.init({}, a.cx);
  a.mod.act('connect', null, a.cx);
  a.mod.openMusic(null, a.cx);
  await a.done();
  assert.equal(a.calls.length, 0);
});

test('first opening and timers never request permission before Connect', async () => {
  const a = load({config: {version: 1, connected: false, presets}});
  a.mod.init({}, a.cx);
  await a.done();
  a.timers.forEach(fn => fn(a.cx));
  await a.done();
  assert.equal(a.calls.length, 0);
});

test('explicit Connect succeeds without inferring subscription or sign-in', async () => {
  const a = load({config: {version: 1, connected: false, presets}});
  a.mod.init({}, a.cx); await a.done();
  a.mod.act('connect', null, a.cx); await a.done();
  assert.equal(a.state.get('music.config').connected, true);
  assert.match(a.mod.note, /Sign in/);
  assert.equal(a.mod.state.running, false);
});

test('revoked permission stops future automatic reads', async () => {
  const a = load({reply: async () => ({stdout: JSON.stringify({ok: false, error: {code: 'permission_denied', message: 'Denied'}})})});
  a.mod.init({}, a.cx); await a.done();
  const n = a.calls.length;
  a.timers.forEach(fn => fn(a.cx)); await a.done();
  assert.equal(a.state.get('music.config').connected, false);
  assert.equal(a.calls.length, n);
});

test('timeout does not retry mutations and requires reconciliation', async () => {
  const a = load();
  a.mod.init({}, a.cx); await a.done();
  a.mod.request = async () => { throw {code: 'timeout', message: 'uncertain'}; };
  a.mod.act('next', null, a.cx); await a.done();
  assert.equal(a.mod.reconcile, true);
  assert.equal(a.mod.busy, false);
  a.mod.act('next', null, a.cx); await a.done();
  assert.equal(a.calls.length, 1);
});

test('a generic playing state never confirms a different playlist', async () => {
  const a = load(); a.mod.init({}, a.cx); await a.done();
  a.mod.request = async () => ({state: {playback: 'playing', playlist: {id: 'OTHER'}}});
  a.mod.requested = {id: '1234567890ABCDEF', label: 'House'};
  a.mod.pendingChecks = 0;
  a.mod.refresh(a.cx); await a.done();
  assert.match(a.mod.note, /could not be confirmed/);
});

test('linking and removal update shared presets without library mutations', async () => {
  const a = load(); a.mod.init({}, a.cx); await a.done();
  a.mod.target = presets[0]; a.mod.playlists = [{id: '1234567890ABCDEF', name: 'Study'}];
  a.mod.linkSelected(a.cx);
  assert.equal(a.state.get('music.config').presets[0].id, '1234567890ABCDEF');
  const n = a.calls.length;
  a.mod.changePreset(presets[0], null, a.cx);
  assert.equal(a.state.get('music.config').presets.length, presets.length - 1);
  assert.equal(a.calls.length, n);
});

function bridge(request, app) {
  const code = readFileSync(join(root, 'mods/music/music-control.js'), 'utf8');
  const context = {Application: () => new Proxy(app, {set(target, key, value) {
    // JXA property setters retain their callable getters.
    target[key] = ['shuffleEnabled', 'soundVolume'].includes(key) ? () => value : value;
    return true;
  }})}; vm.createContext(context);
  vm.runInContext(code, context);
  return JSON.parse(context.run([JSON.stringify(request)]));
}

test('status of closed Music sends no Apple events and never launches', () => {
  const app = {running: () => false, launch() { throw Error('must not launch'); }, version() { throw Error('must not send Apple events'); }};
  assert.equal(bridge({action: 'status'}, app).state.running, false);
});

test('bridge does not substitute an old queue for a missing playlist', () => {
  const app = {running: () => true, version: () => '1', playlists: {whose: () => () => []}, play() { throw Error('must not play'); }};
  assert.equal(bridge({action: 'play-playlist', value: '1234567890ABCDEF'}, app).error.code, 'playlist_missing');
});

test('bridge rejects empty queue and recognizes automation denial', () => {
  const app = {running: () => true, version: () => '1', currentTrack() {throw Error('no track');}, play() {throw Error('must not play');}};
  assert.equal(bridge({action: 'play'}, app).error.code, 'no_queue');
  app.version = () => {throw {number: -1743};};
  assert.equal(bridge({action: 'connect'}, app).error.code, 'permission_denied');
});

test('saved curator playlists appear alongside user playlists', () => {
  const playlist = (kind, name, id) => ({class: () => kind, name: () => name, persistentID: () => id});
  const app = {running: () => true, version: () => '1', playlists: () => [
    playlist('libraryPlaylist', 'Library', '0000000000000005'),
    playlist('userPlaylist', 'My playlist', '1234567890ABCDEF'),
    playlist('subscriptionPlaylist', 'Lofi Girl', '11DDB9A4CA21D3ED')
  ]};
  assert.deepEqual(bridge({action: 'list-playlists'}, app).playlists.map(p => p.name), ['Lofi Girl', 'My playlist']);
});

test('preset playback resolves saved subscription playlists', () => {
  let played = null;
  const saved = {tracks: () => [{}]};
  const collection = () => [saved];
  collection.whose = query => { assert.equal(query.persistentID, '11DDB9A4CA21D3ED'); return () => [saved]; };
  const app = {running: () => true, version: () => '1', playlists: collection,
    play: p => { played = p; }, playerState: () => 'playing', soundVolume: () => 25, shuffleEnabled: () => false,
    currentTrack: () => ({name: () => 'Song', artist: () => 'Artist'}),
    currentPlaylist: () => ({name: () => 'Lofi Girl', persistentID: () => '11DDB9A4CA21D3ED'})};
  assert.equal(bridge({action: 'play-playlist', value: '11DDB9A4CA21D3ED'}, app).state.playlist.id, '11DDB9A4CA21D3ED');
  assert.equal(played, saved);
});

test('default player shows transport and stop while playlists require Change playlist', async () => {
  const a = load(); a.mod.init({}, a.cx); await a.done();
  a.mod.updateState({running: true, playback: 'playing', volume: 40, track: {name: 'Song', artist: 'Artist'}});
  let tree = a.mod.render();
  assert.ok(find(tree, 'music-stop'));
  assert.ok(find(tree, 'music-next'));
  assert.equal(find(tree, 'music-presets'), null);
  find(tree, 'music-change-playlist').click({}, a.cx);
  tree = a.mod.render();
  assert.ok(find(tree, 'music-presets'));
  assert.equal(find(tree, 'music-stop'), null);
  find(tree, 'music-back-player').click({}, a.cx);
  assert.ok(find(a.mod.render(), 'music-stop'));
});

test('stop uses the stop command and publishes a stopped pill state', async () => {
  const a = load(); a.mod.init({}, a.cx); await a.done();
  a.mod.updateState({running: true, playback: 'playing', track: {name: 'Song'}});
  let action;
  a.mod.request = async value => { action = value; return {state: {running: true, playback: 'stopped'}}; };
  find(a.mod.render(), 'music-stop').click({}, a.cx); await a.done();
  assert.equal(action, 'stop');
  assert.equal(a.state.get('music.playback').playback, 'stopped');
});

test('Music stop and previous call the native transport without clearing playlists', () => {
  let stopped = false, previous = false;
  const app = {running: () => true, version: () => '1', stop: () => { stopped = true; }, previousTrack: () => { previous = true; },
    playerState: () => 'stopped', soundVolume: () => 25, shuffleEnabled: () => false};
  assert.equal(bridge({action: 'stop'}, app).state.playback, 'stopped');
  assert.equal(bridge({action: 'previous'}, app).ok, true);
  assert.ok(stopped && previous);
});

test('resuming playback enables song shuffle before play', () => {
  let played = false;
  const app = {running: () => true, version: () => '1', currentTrack: () => ({name: () => 'Song'}),
    shuffleEnabled: () => false, playerState: () => 'playing', soundVolume: () => 25,
    play() { assert.equal(app.shuffleEnabled(), true); assert.equal(app.shuffleMode, 'songs'); played = true; }};
  assert.equal(bridge({action: 'play'}, app).ok, true);
  assert.ok(played);
});

test('the player keeps artwork response tied to the current song', async () => {
  const a = load(); a.mod.init({}, a.cx); await a.done();
  let release;
  a.mod.request = () => new Promise(resolve => { release = resolve; });
  a.mod.artTrack = 'OLD';
  a.mod.loadArtwork('OLD', a.cx);
  a.mod.artTrack = 'NEW'; a.mod.artwork = null;
  release({artwork: 'data/music/artwork/OLD.jpg'}); await a.done();
  assert.equal(a.mod.artwork, null);
});
