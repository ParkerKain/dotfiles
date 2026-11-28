const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

const home = '/home/parker';
const kit = `${home}/Documents/internal/repos/parker-agent-kit`;
const source = readFileSync(join(__dirname, '../mods/session-launcher/main.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export default class ', 'globalThis.Mod = class ');
const route = {project: kit, folder: kit, project_name: 'parker-agent-kit', reason: 'Agent hooks belong in parker-agent-kit.', space: 'existing', space_id: 'kit'};

function setup(overrides = {}) {
  const calls = [];
  const files = new Map();
  const context = {View: class {}, home: () => home, appHome: () => '/config',
    focused: () => ({space: 'demo', cwd: '/elsewhere'}),
    exec: async (command, args, options) => {
      calls.push({command, args, options});
      if (command === 'python3' && args[1] === 'plan') return {code: 0, stdout: JSON.stringify(route), stderr: ''};
      return {code: 0, stdout: '', stderr: ''};
    },
    writeTextFile: async (path, text) => { files.set(path, text); return null; },
    readTextFile: async path => files.get(path) ?? null,
    props: () => ({overlay: 'launcher'}), closeOverlay: id => calls.push({command: 'closeOverlay', args: id}),
    knownAgents: async () => [{key: 'codex', installed: true, run: ['codex', '--no-daemon']}],
    ...overrides};
  vm.runInNewContext(source, context);
  const mod = new context.Mod();
  Object.assign(mod, {text: 'Fix hooks', extra: '', agent: 'codex', images: new Map(), revision: 0, route: null, override: null, task: null});
  return {mod, calls, files, context};
}

function runner() {
  const tasks = [];
  const cx = {notify() {}, sleep: async () => {}, spawn(fn) { tasks.push(fn(cx)); }};
  return {cx, settle: () => Promise.all(tasks)};
}

test('preview planning sends the request, origin, override and task to projects.py', async () => {
  const {mod, calls} = setup();
  mod.override = `${home}/dotfiles`;
  mod.task = {folder: kit, title: 'Ops task', slug: 'ops-task', ref: 'T-1', prompt: 'ignored'};
  assert.equal((await mod.plan('Fix hooks')).folder, kit);
  const call = calls.find(c => c.command === 'python3');
  assert.deepEqual([...call.args.slice(0, 2)], ['/config/mods/session-launcher/projects.py', 'plan']);
  assert.deepEqual(JSON.parse(call.args[2]), {request: 'Fix hooks', override: `${home}/dotfiles`,
    task: {folder: kit, title: 'Ops task', slug: 'ops-task', ref: 'T-1'}, origin: {space: 'demo', cwd: '/elsewhere'}});
});

test('planning errors surface the helper message', async () => {
  const {mod} = setup({exec: async () => ({code: 1, stdout: '', stderr: 'Folder does not exist: /x\n'})});
  await assert.rejects(mod.plan('Fix hooks'), /Folder does not exist: \/x/);
});

test('Start closes the window right away and hands routing to a detached helper', async () => {
  for (const preview of [null, route]) {
    const {mod, calls, files} = setup();
    mod.route = preview;
    const {cx, settle} = runner();
    mod.start(cx);
    mod.start(cx);
    await settle();
    assert.equal(calls.some(c => c.command === 'python3'), false, 'Start must not wait for routing');
    const detached = calls.filter(c => c.command === '/bin/sh');
    assert.equal(detached.length, 1);
    assert.match(detached[0].args[1], /^nohup python3 "\$0" start "\$1" .*&$/);
    const job = JSON.parse(files.get(detached[0].args[3]));
    assert.equal(job.request, 'Fix hooks');
    assert.deepEqual(job.plan, preview);
    assert.deepEqual(job.agent, {key: 'codex', run: ['codex', '--no-daemon', '-m', 'gpt-6.2-sol', '-c', 'model_reasoning_effort=medium']});
    assert.equal(calls.at(-1).command, 'closeOverlay');
  }
});

test('blank prompts cannot start', () => {
  const {mod, calls} = setup();
  mod.text = '   ';
  mod.start({spawn() { throw Error('must not start'); }});
  assert.equal(calls.length, 0);
});

test('a missing agent keeps the window open with an error and allows a retry', async () => {
  const {mod, calls} = setup({knownAgents: async () => []});
  const {cx, settle} = runner();
  mod.start(cx);
  await settle();
  assert.match(mod.error, /codex is not installed/);
  assert.equal(mod.busy, false);
  assert.equal(calls.some(c => c.command === 'closeOverlay' || c.command === '/bin/sh'), false);
});

test('a failed background start brings back its request and error', async () => {
  const {mod, files} = setup();
  mod.text = '';
  mod.input = {set_value(value) { this.value = value; }};
  mod.scheduleRoute = () => {};
  files.set(`${home}/.cache/herdr-app/session-launcher-failed.json`, JSON.stringify({request: 'Fix hooks', task: false, error: 'Planner unavailable'}));
  await mod.restoreFailed({notify() {}});
  assert.equal(mod.text, 'Fix hooks');
  assert.equal(mod.input.value, 'Fix hooks');
  assert.match(mod.error, /Planner unavailable/);
});

test('typing during a routing call discards stale results and reroutes', async () => {
  const {mod} = setup();
  mod.text = 'old request';
  const {cx, settle} = runner();
  let count = 0;
  mod.plan = async request => {
    if (++count === 1) { mod.text = 'new request'; mod.scheduleRoute(cx); }
    return {reason: request};
  };
  mod.scheduleRoute(cx);
  await settle();
  assert.equal(mod.route.reason, 'new request');
  assert.equal(count, 2);
  assert.equal(mod.routing, false);
});

test('number keys pick a model and then its effort, per agent', async () => {
  const {mod, files} = setup({knownAgents: async () => [
    {key: 'claude', installed: true, run: ['claude']}, {key: 'codex', installed: true, run: ['codex', '--no-daemon']}]});
  const focus = [];
  mod.handle = {focus: () => focus.push('menu')};
  mod.input = {focus: () => focus.push('prompt')};
  const cx = {notify() {}};
  mod.agent = 'claude';
  mod.toggleModelPicker(cx);
  assert.equal(mod.picking, 'model');
  assert.equal(focus.at(-1), 'menu', 'number keys must not type into the prompt');
  assert.equal(mod.pickNumber(9, cx), false);
  assert.equal(mod.pickNumber(2, cx), true);
  assert.equal(mod.picking, 'effort');
  assert.equal(mod.pickNumber(3, cx), true);
  assert.equal(mod.picking, null);
  assert.equal(focus.at(-1), 'prompt');
  assert.deepEqual([mod.models.claude.model.id, mod.models.claude.effort], ['sonnet', 'high']);
  assert.deepEqual([mod.models.codex.model.id, mod.models.codex.effort], ['gpt-6.2-sol', 'medium']);
  const {cx: run, settle} = runner();
  mod.text = 'Fix hooks';
  mod.start(run);
  await settle();
  const job = JSON.parse([...files.values()].at(-1));
  assert.deepEqual(job.agent.run, ['claude', '--model', 'sonnet', '--effort', 'high']);
});

test('a model without the current effort falls back to medium', () => {
  const {mod} = setup();
  mod.handle = {focus() {}};
  mod.input = {focus() {}};
  const cx = {notify() {}};
  mod.toggleModelPicker(cx);
  mod.pickNumber(1, cx);
  mod.pickNumber(6, cx);
  assert.equal(mod.models.codex.effort, 'ultra');
  mod.toggleModelPicker(cx);
  mod.pickNumber(4, cx);
  assert.deepEqual([mod.models.codex.model.id, mod.models.codex.effort], ['gpt-6-luna', 'medium']);
});

const cache = JSON.stringify({models: [
  {slug: 'gpt-6.1-sol', visibility: 'list', priority: 4, supported_reasoning_levels: [{effort: 'low'}, {effort: 'medium'}]},
  {slug: 'gpt-7-luna', visibility: 'list', priority: 3, supported_reasoning_levels: [{effort: 'low'}, {effort: 'high'}]},
  {slug: 'gpt-7-sol', display_name: 'GPT-7-Sol', visibility: 'list', priority: 1, supported_reasoning_levels: [{effort: 'low'}, {effort: 'medium'}, {effort: 'ultra'}]},
  {slug: 'gpt-reserve', visibility: 'hide', priority: 0, supported_reasoning_levels: [{effort: 'medium'}]}]});

test('Codex models come from its cache, newest per family, in its menu order', async () => {
  const {mod, files} = setup();
  files.set(`${home}/.codex/models_cache.json`, cache);
  mod.models = {codex: {model: {id: 'gpt-6.2-sol'}, effort: 'medium'}};
  await mod.loadCodexModels({notify() {}});
  assert.equal(JSON.stringify(mod.modelList('codex').map(m => [m.id, m.name, m.efforts])),
    JSON.stringify([['gpt-7-sol', 'Sol 7', ['low', 'medium', 'ultra']], ['gpt-7-luna', 'Luna 7', ['low', 'high']]]));
  assert.equal(mod.models.codex.model.id, 'gpt-7-sol');
  assert.equal(mod.models.codex.effort, 'medium');
});

test('a hand-picked Codex model survives the cache load, and a missing cache keeps the built-in list', async () => {
  const {mod, files} = setup();
  await mod.loadCodexModels({notify() {}});
  assert.equal(mod.modelList('codex')[0].id, 'gpt-6.2-sol');
  files.set(`${home}/.codex/models_cache.json`, cache);
  mod.codexTouched = true;
  mod.models = {codex: {model: {id: 'gpt-7-luna'}, effort: 'medium'}};
  await mod.loadCodexModels({notify() {}});
  assert.deepEqual([mod.models.codex.model.id, mod.models.codex.effort], ['gpt-7-luna', 'low']);
});
