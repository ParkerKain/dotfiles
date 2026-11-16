const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

const home = '/home/parker';
const kit = `${home}/Documents/internal/repos/parker-agent-kit`;
const market = `${home}/Documents/internal/repos/dc-delivery-marketplace`;
const source = readFileSync(join(__dirname, '../mods/session-launcher/main.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export default class ', 'globalThis.Mod = class ');
function setup(plan, overrides = {}) {
  const calls = [];
  const context = {View: class {}, home: () => home,
    focused: () => ({space: 'market', cwd: market}),
    spaces: () => [{id: 'market', folder: market}, {id: 'kit', folder: kit}],
    exec: async (command, args) => {
      calls.push({command, args});
      if (command === 'ls') return {code: 0, stdout: 'dc-delivery-marketplace\nparker-agent-kit\n'};
      if (command === 'claude') return {code: 0, stdout: JSON.stringify({structured_output: plan})};
      return {code: 0};
    },
    knownAgents: async () => [{key: 'codex', installed: true, run: ['codex', '--no-daemon']}],
    terminals: () => [], run: (command, args) => calls.push({command, args}), ...overrides};
  vm.runInNewContext(source, context);
  return {mod: new context.Mod(), calls, context};
}
const plan = {folder: kit, space: 'existing', space_id: 'kit', space_name: '', tab_name: 'focus-fix', split: 'none'};

test('planner gets ownership rules and dotfiles outside the repos folder', async () => {
  const {mod, calls} = setup(plan);
  await mod.plan('Fix agent hook focus');
  const prompt = calls.find(c => c.command === 'claude').args.at(-1);
  assert.match(prompt, /Agent skills, hooks, agent CLIs and agent context belong in parker-agent-kit/);
  assert.match(prompt, /\/home\/parker\/dotfiles/);
  assert.match(prompt, /current folder only as a fallback/);
});
test('launch uses the planned project even after focus switches', async () => {
  const {mod, calls, context} = setup(plan);
  const result = await mod.plan('Fix agent hook focus');
  context.focused = () => ({space: 'unrelated', cwd: '/elsewhere'});
  await mod.launch(result, 'Fix agent hook focus', 'codex', {});
  assert.equal(calls.find(c => c.command === 'tab.new').args.space, 'kit');
});
test('rejects mismatched, missing and remote destinations', async () => {
  for (const space_id of ['market', 'missing', 'remote']) {
    const {mod} = setup({...plan, space_id}, {spaces: () => [
      {id: 'market', folder: market}, {id: 'remote', folder: kit, machine: 'server'}]});
    await assert.rejects(mod.plan('Fix hooks'), /does not match/);
  }
});
test('closed destination fails without silently creating a different Space', async () => {
  const {mod, context, calls} = setup(plan);
  const result = await mod.plan('Fix hooks');
  context.spaces = () => [];
  await assert.rejects(mod.launch(result, 'Fix hooks', 'codex', {}), /changed or closed/);
  assert.equal(calls.some(c => c.command === 'space.new'), false);
});
test('new project creates a local Space with its chosen folder', async () => {
  const destination = {...plan, folder: `${home}/dotfiles`, space: 'new', space_id: '', space_name: 'dotfiles'};
  const {mod, calls} = setup(destination);
  const result = await mod.plan('Fix New Session');
  await mod.launch(result, 'Fix New Session', 'codex', {});
  const launch = calls.find(c => c.command === 'space.new');
  assert.equal(launch.args.folder, `${home}/dotfiles`);
  assert.equal(launch.args.machine, '');
});
