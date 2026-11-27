// Renders the mods each machine shares with stubbed gpui and herdr APIs, using that
// machine's real keys.json and layout, and checks what the tab bar offers.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const root = join(__dirname, '..');

function element(log, ids = []) {
  const self = new Proxy(function () {}, {get(_t, key) {
    return (...args) => {
      if (key === 'tooltip') log.push(args[0]);
      if (key === 'id') ids.push(args[0]);
      if (key === 'when' && args[0]) return args[1](self);
      return self;
    };
  }});
  return self;
}

// The layout link.py writes for a machine: panel blocks whose mod it lacks are dropped.
function trimmed(keep) {
  const layout = JSON.parse(readFileSync(join(root, 'layouts/Parker.json')));
  const walk = node => {
    if (node.id === 'panel-body') node.children = node.children.filter(c => keep.includes(c.id));
    (node.children ?? []).forEach(walk);
  };
  walk(layout);
  return layout;
}

function render(name, {platform, keysFile, layout, setup, props = {}, ids = []}) {
  const keysJson = JSON.parse(readFileSync(join(root, keysFile)));
  const tooltips = [];
  const el = () => element(tooltips, ids);
  const theme = new Proxy({}, {get: () => '#000'});
  const code = readFileSync(join(root, 'mods', name, 'main.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default class ', 'globalThis.Mod = class ');
  const context = {View: class {}, div: el, svg: el, image: el, h_flex: el, v_flex: el,
    ScrollHandle: {new: el}, TextareaState: {new: el}, Textarea: {new: el}, InputState: {new: el}, Input: {new: el},
    appHome: () => '/c', home: () => '/h', checking: () => false, exec: async () => ({code: 1, stdout: '', stderr: ''}),
    spaces: () => [{id: 's1', active: true, tabs: [{id: 't1', active: true, name: 'a'}]}], panes: () => [], focused: () => null,
    run: () => {}, openOverlay: () => {}, closeOverlay: () => {}, theme: () => theme, window: () => ({platform, buttons: false}), appWindow: () => ({platform, buttons: false}),
    shared: () => null, setShared: () => {}, layout: () => layout, settings: () => ({}), nextCommand: () => new Promise(() => {}),
    props: () => props, layouts: () => ['Parker'], readTextFile: async () => JSON.stringify(keysJson), knownAgents: async () => [],
    keys: () => Object.entries(keysJson).flatMap(([section, map]) => Object.entries(map).map(([keys, action]) => ({section, keys, action}))),
    localStorage: {getItem: () => null, setItem() {}}};
  vm.runInNewContext(code, context);
  const mod = new context.Mod();
  const cx = {notify() {}, spawn() {}, focus_handle: () => ({focus() {}, is_focused: () => false}), timer: {every() {}, after() {}}, stop_propagation() {}};
  mod.init({}, cx);
  setup?.(mod, keysJson);
  mod.render(cx);
  return tooltips;
}

const MAC = {platform: 'macos', keysFile: 'machines/mac/keys.json', layout: trimmed(['files', 'changes', 'ops-tasks', 'jobs', 'day-view', 'artifacts', 'call-sheet', 'factory', 'claude-usage'])};
const OMARCHY = {platform: 'linux', keysFile: 'machines/omarchy/keys.json', layout: trimmed(['files', 'changes', 'jobs'])};
const jobs = mod => {
  mod.jobs = [{name: 'a', agent: 'claude', times: ['05:00'], weekdays: [1, 2, 3, 4, 5], next: 1, loaded: true, last: null, error: null}];
  mod.hooks = [{name: 'mail-inbox', title: 'Mail inbox', interval: 300, loaded: true, last_check: null, last_trigger: null, error: 'boom'}];
};

test('the Mac tab bar leaves the glanced panels to the status bar and keeps the rest with their shortcuts', () => {
  assert.deepEqual(render('my-tabs', MAC).filter(t => /  /.test(t)),
    ['Files  ⌘E', 'Changes  ⇧⌘G', 'Jobs  ⇧⌘J', 'Usage  ⇧⌘U']);
});

test('without a glances block the Mac tab bar keeps every work panel', () => {
  const layout = JSON.parse(JSON.stringify(MAC.layout));
  const walk = node => { node.children = (node.children ?? []).filter(c => c.id !== 'glances'); node.children.forEach(walk); };
  walk(layout);
  assert.deepEqual(render('my-tabs', {...MAC, layout}).filter(t => /  /.test(t)),
    ['Files  ⌘E', 'Changes  ⇧⌘G', 'Tasks  ⇧⌘T', 'Jobs  ⇧⌘J', 'Calendar  ⇧⌘C', 'Artifacts  ⇧⌘A', 'Factory  ⇧⌘F', 'Usage  ⇧⌘U']);
});

test('the Omarchy tab bar shows only the panels its layout has, in Linux notation', () => {
  assert.deepEqual(render('my-tabs', OMARCHY), ['Files  Alt+E', 'Changes  Alt+Shift+G', 'Jobs  Ctrl+Shift+J']);
});

for (const [machine, setup] of [['Mac', MAC], ['Omarchy', OMARCHY]]) {
  for (const name of ['jobs', 'keybind-help', 'session-launcher']) {
    test(`${name} renders on the ${machine}`, () => {
      render(name, {...setup, setup: name === 'jobs' ? jobs : name === 'keybind-help' ? (mod, keys) => { mod.keys = keys; } : null});
    });
  }
}

test('shortcut help shows a key that ends in minus', () => {
  render('keybind-help', {...OMARCHY, setup: (mod, keys) => { mod.keys = {...keys, global: {...keys.global, 'ctrl--': 'mod.open:revive'}}; }});
});

test('the session launcher draws its own backdrop and unroll, with or without a caller\'s task', () => {
  const own = [], task = [];
  render('session-launcher', {...MAC, ids: own});
  render('session-launcher', {...MAC, ids: task, props: {overlay: 'o1', task: {title: 'Fix lock-in', prompt: 'Lock in the session'}}});
  assert.ok(own.includes('backdrop') && own.includes('clip'));
  assert.ok(task.includes('backdrop') && task.includes('clip'));
});
