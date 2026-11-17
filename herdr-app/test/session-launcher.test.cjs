const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

const home = '/home/parker';
const repos = `${home}/Documents/internal/repos`;
const kit = `${repos}/parker-agent-kit`;
const vault = `${repos}/devclarity-vault`;
const demo = `${repos}/raya-demo`;
const dotfiles = `${home}/dotfiles`;
const source = readFileSync(join(__dirname, '../mods/session-launcher/main.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export default class ', 'globalThis.Mod = class ');
const catalog = [kit, vault, dotfiles].map(folder => ({id: folder, folder, name: folder.split('/').pop(), description: folder}));
const defaultPlan = {project: kit, reason: 'Agent hooks belong in parker-agent-kit.', new_space: false, tab_name: 'focus-fix', split: 'none'};
function setup(plan = defaultPlan, overrides = {}) {
  const calls = [];
  const context = {View: class {}, home: () => home, appHome: () => '/config',
    focused: () => ({space: 'demo', cwd: demo}),
    spaces: () => [{id: 'demo', folder: demo}, {id: 'kit', folder: kit}],
    exec: async (command, args, options) => {
      calls.push({command, args, options});
      if (command === 'python3') return {code: 0, stdout: JSON.stringify(catalog)};
      if (command === 'claude') return {code: 0, stdout: JSON.stringify({structured_output: plan})};
      return {code: 0};
    },
    props: () => ({overlay: 'launcher'}), closeOverlay: () => {},
    knownAgents: async () => [{key: 'codex', installed: true, run: ['codex', '--no-daemon']}],
    terminals: () => [], run: (command, args) => calls.push({command, args}), ...overrides};
  vm.runInNewContext(source, context);
  return {mod: new context.Mod(), calls, context};
}
test('planner uses project descriptions, vault fallback and neutral cwd', async () => {
  const {mod, calls} = setup();
  await mod.plan('Fix agent hook focus');
  const call = calls.find(c => c.command === 'claude');
  assert.match(call.args.at(-1), /Herdr music mod, Spotify controls/);
  assert.match(call.args.at(-1), /Merely leaving a tab selected is never evidence/);
  assert.match(call.args.at(-1), /For general work or no identifiable software project, choose devclarity-vault/);
  assert.equal(call.options.cwd, home);
  assert.deepEqual(JSON.parse(call.args[call.args.indexOf('--json-schema') + 1]).properties.project.enum, catalog.map(p => p.id));
});
test('launch uses project Space even after focus switches', async () => {
  const {mod, calls, context} = setup();
  const result = await mod.plan('Fix agent hook focus');
  context.focused = () => ({space: 'unrelated', cwd: '/elsewhere'});
  await mod.launch(result, 'Fix agent hook focus', 'codex', {});
  assert.equal(calls.find(c => c.command === 'tab.new').args.space, 'kit');
});
test('rejects arbitrary folders, malformed routes and invalid layouts', async () => {
  for (const patch of [{project: '/home/parker/random'}, {split: 'left'}, {reason: ''}]) {
    const {mod} = setup({...defaultPlan, ...patch});
    await assert.rejects(mod.plan('Fix hooks'), /invalid project choice/);
  }
});
test('closed destination fails without silently creating a different Space', async () => {
  const {mod, context, calls} = setup();
  const result = await mod.plan('Fix hooks');
  context.spaces = () => [];
  await assert.rejects(mod.launch(result, 'Fix hooks', 'codex', {}), /changed or closed/);
  assert.equal(calls.some(c => c.command === 'space.new'), false);
});
test('music work launches in dotfiles while demo remains selected', async () => {
  const {mod, calls} = setup({...defaultPlan, project: dotfiles});
  const result = await mod.plan('Change the music mod');
  await mod.launch(result, 'Change the music mod', 'codex', {});
  const launch = calls.find(c => c.command === 'space.new');
  assert.equal(launch.args.folder, dotfiles);
  assert.equal(launch.args.machine, '');
});
test('remote spaces cannot be reused or supply a current folder', async () => {
  const {mod, calls} = setup(defaultPlan, {spaces: () => [{id: 'demo', folder: demo, machine: 'server'}, {id: 'remote', folder: kit, machine: 'server'}]});
  const result = await mod.plan('Fix hooks');
  assert.equal(result.space, 'new');
  assert.doesNotMatch(calls.find(c => c.command === 'claude').args.at(-1), /raya-demo/);
});
test('planner is told to always pick one project', async () => {
  const {mod, calls} = setup();
  await mod.plan('Fix hooks');
  const prompt = calls.find(c => c.command === 'claude').args.at(-1);
  assert.match(prompt, /Always choose exactly one project/);
  assert.doesNotMatch(prompt, /needs_choice/);
  assert.equal(JSON.parse(calls.find(c => c.command === 'claude').args[calls.find(c => c.command === 'claude').args.indexOf('--json-schema') + 1]).properties.needs_choice, undefined);
});
test('user override wins and Tasks Play supplies its default', async () => {
  const {mod, calls} = setup(defaultPlan);
  mod.override = dotfiles;
  mod.task = {folder: vault};
  const result = await mod.plan('Change this');
  assert.equal(result.folder, dotfiles);
  assert.match(calls.find(c => c.command === 'claude').args.at(-1), /Tasks Play default/);
});
test('pending and missing routes cannot launch', () => {
  for (const values of [{routing: true, route: defaultPlan}, {route: null}]) {
    const {mod, calls} = setup();
    Object.assign(mod, values);
    mod.start({spawn() { throw Error('must not launch'); }});
    assert.equal(calls.length, 0);
  }
});
test('typing during a routing call discards stale results and reroutes', async () => {
  const {mod} = setup();
  Object.assign(mod, {text: 'old request', extra: '', images: new Map(), revision: 0});
  const tasks = [];
  const cx = {notify() {}, sleep: async () => {}, spawn(fn) { tasks.push(fn(cx)); }};
  let count = 0;
  mod.plan = async request => {
    if (++count === 1) { mod.text = 'new request'; mod.scheduleRoute(cx); }
    return {reason: request};
  };
  mod.scheduleRoute(cx);
  await Promise.all(tasks);
  assert.equal(mod.route.reason, 'new request');
  assert.equal(count, 2);
  assert.equal(mod.routing, false);
});

test('current folder enters the catalog only for an explicit current-project reference', async () => {
  const {mod, calls} = setup({...defaultPlan, project: demo});
  const plan = await mod.plan('Fix tests in this repo');
  assert.equal(plan.folder, demo);
  const call = calls.find(c => c.command === 'claude');
  assert.ok(JSON.parse(call.args[call.args.indexOf('--json-schema') + 1]).properties.project.enum.includes(demo));
});
