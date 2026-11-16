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
    props: () => ({}), exec: async () => { throw Error('helper timed out'); },
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
test('Demo blocks every work panel shortcut and the wallpaper switcher', () => {
  const keys = JSON.parse(readFileSync(join(root, 'keys.json')));
  for (const [key, action] of Object.entries(keys.global)) {
    if (/^my-tabs.panel-/.test(action) || ['mod.open:wallpaper', 'mod.open:music'].includes(action)) {
      assert.equal(keys['layout:Demo'][key], 'terminal', key);
    }
  }
});
