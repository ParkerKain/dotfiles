const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const root = join(__dirname, '..');
function load(name, overrides = {}) {
  const code = readFileSync(join(root, 'mods', name, 'main.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default class ', 'globalThis.Mod = class ');
  const context = {View: class {}, home: () => '/home/parker', appHome: () => '/config',
    props: () => ({}), shared: () => null, exec: async () => { throw Error('helper timed out'); },
    ...overrides};
  vm.runInNewContext(code, context);
  return new context.Mod();
}
function tasks() {
  const pending = [];
  const cx = {notify() {}, spawn(fn) { pending.push(fn(cx)); }};
  return {cx, done: () => Promise.all(pending)};
}
test('wallpaper arrows are safe before loading and on an empty library', () => {
  const mod = load('wallpaper');
  Object.assign(mod, {sel: 0, rowOf: [], rows: []});
  assert.equal(mod.step(1), 0);
  assert.equal(mod.step(-1), 0);
});
for (const name of ['wallpaper', 'run-once', 'revive']) {
  test(`${name} recovers from a rejected helper`, async () => {
    const mod = load(name);
    const {cx, done} = tasks();
    if (name === 'wallpaper') { mod.items = [{path: '/wallpaper.jpg'}]; mod.apply(0, cx); }
    if (name === 'run-once') mod.run('demo-on', cx);
    if (name === 'revive') { mod.visible = () => [{address: 't1'}]; mod.selected = 0; mod.restore(cx); }
    await done();
    assert.equal(mod.busy, false);
    assert.match(mod.error, /helper timed out/);
  });
}
test('Demo checks never switch layouts or pause jobs', () => {
  load('demo-mode', {checking: () => true}).init();
});
test('tab bar ignores panels absent from the current layout', () => {
  const mod = load('my-tabs', {layout: () => ({id: 'panel-body', children: [{id: 'files'}]})});
  mod.togglePanel('call-sheet', {});
});

test('Music pill polling waits for explicit connection and skips Demo', () => {
  const mod = load('my-tabs', {checking: () => false, shared: () => null});
  mod.refreshMusic({spawn() { throw Error('must not poll before Connect'); }});
  const demo = load('my-tabs', {checking: () => false, shared: () => ({connected: true}), props: () => ({demo: true})});
  demo.refreshMusic({spawn() { throw Error('must not poll in Demo'); }});
});

test('Music pill tracks external playback changes without issuing mutations', async () => {
  const state = new Map([['music.config', {connected: true}]]);
  const mod = load('my-tabs', {checking: () => false, shared: key => state.get(key), setShared: (key, value) => state.set(key, value),
    exec: async (_cmd, args) => { assert.equal(JSON.parse(args[1]).action, 'status'); return {stdout: JSON.stringify({ok: true, state: {playback: 'paused'}})}; }});
  const {cx, done} = tasks();
  mod.refreshMusic(cx); await done();
  assert.equal(state.get('music.playback').playback, 'paused');
  assert.equal(mod.musicReading, false);
});
test('Demo blocks every work panel shortcut and the wallpaper switcher', () => {
  const keys = JSON.parse(readFileSync(join(root, 'machines/mac/keys.json')));
  for (const [key, action] of Object.entries(keys.global)) {
    // Files and Changes are the two panels Demo shows, so their keys stay live there.
    if (['my-tabs.panel-files', 'my-tabs.panel-changes'].includes(action)) assert.equal(keys['layout:Demo'][key], undefined, key);
    else if (/^my-tabs.panel-/.test(action) || ['mod.open:wallpaper', 'mod.open:music'].includes(action)) {
      assert.equal(keys['layout:Demo'][key], 'terminal', key);
    }
  }
  const opened = Object.values(keys.global);
  assert.ok(opened.includes('my-tabs.panel-files') && opened.includes('my-tabs.panel-changes'));
});

test('panel zoom fills the work area and restores its width after reload', () => {
  let tree = {id: 'root', children: [
    {id: 'main'},
    {id: 'panel', size: {px: 417}, min: 280, max: 900, children: [{id: 'panel-body', active: 'artifacts'}]},
  ]};
  const original = JSON.stringify(tree);
  const state = new Map([['layout', 'Parker']]);
  const api = {layout: () => tree, focused: () => ({space: 's1'}),
    shared: key => state.get(key), setShared: (key, value) => state.set(key, value),
    run: (command, args) => { assert.equal(command, 'layout.set'); tree = args.layout; }};
  load('my-tabs', api).zoomPanel();
  assert.equal(tree.children[0].hidden, true);
  assert.equal(tree.children[1].size.weight, 1);
  assert.equal(tree.children[1].max, undefined);
  load('my-tabs', api).zoomPanel();
  assert.deepEqual(JSON.parse(JSON.stringify(tree)), JSON.parse(original));
});
test('panel zoom ignores a hidden panel', () => {
  load('my-tabs', {layout: () => ({children: [{id: 'main'}, {id: 'panel', hidden: true}]})}).zoomPanel();
});
test('every work panel gets the zoom shortcut while terminal zoom stays native', () => {
  const keys = JSON.parse(readFileSync(join(root, 'machines/mac/keys.json')));
  assert.equal(keys.global['cmd-shift-enter'], 'pane.zoom');
  for (const name of ['my-files', 'my-changes', 'ops-tasks', 'jobs', 'day-view', 'artifacts', 'call-sheet', 'factory', 'claude-usage']) {
    assert.equal(keys[`mod:${name}`]['cmd-shift-enter'], 'my-tabs.zoom-panel');
  }
});

test('Omarchy keys only open mods Omarchy installs, and its panels zoom on its pane-zoom key', () => {
  const keys = JSON.parse(readFileSync(join(root, 'machines/omarchy/keys.json')));
  const manifest = readFileSync(join(root, 'machines/omarchy.toml'), 'utf8');
  const mods = JSON.parse(manifest.match(/\nmods = (\[[^\]]*\])/)[1].replace(/,\s*\]/, ']'));
  for (const action of Object.values(keys.global)) {
    const opened = action.match(/^mod\.open:(.+)$/)?.[1];
    if (opened && opened !== 'picker') assert.ok(mods.includes(opened), action);
    const panel = action.match(/^my-tabs\.panel-(.+)$/)?.[1];
    // The Files and Changes panels are the my-files and my-changes mods.
    if (panel) assert.ok(mods.includes({files: 'my-files', changes: 'my-changes'}[panel] ?? panel), action);
  }
  const zoom = Object.entries(keys.global).find(([, action]) => action === 'pane.zoom')[0];
  for (const name of ['my-files', 'my-changes', 'jobs']) assert.equal(keys[`mod:${name}`][zoom], 'my-tabs.zoom-panel');
});
