const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

// Loads the mod without Herdr: imports dropped, the view class and module functions left on the context.
function load(overrides = {}) {
  const code = readFileSync(join(__dirname, '..', 'mods', 'my-files', 'main.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default class ', 'globalThis.Mod = class ');
  const store = new Map();
  const context = {View: class {}, localStorage: {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)},
    theme: () => ({}), themes: () => [], settings: () => ({theme: 'rose-pine-moon', font_family: 'Mono'}), ...overrides};
  vm.runInNewContext(code, context);
  return context;
}

test('file types the editor has no grammar for use the closest one it has', () => {
  const {languageFor} = load();
  const cases = {
    'src/app/archive.service.ts': 'js', 'ui/Button.tsx': 'js', 'test/mods.test.cjs': 'js',
    'src/Core/Vault/ArchiveCiphersCommand.cs': 'c#', 'Api.csproj': 'xml',
    'machines/mac.toml': 'properties', '.env.local': 'properties', '.gitignore': 'properties',
    'app/views/resources/index.html.erb': 'erb', 'app/models/resource.rb': 'rb', 'lib/tasks/demo.rake': 'rb',
    'Gemfile': 'rb', 'Gemfile.lock': 'yaml', 'flake.lock': 'json', 'other.lock': 'lock', 'api.dockerfile': 'sh', '.envrc': 'sh', '.env': 'properties',
    'constructor': 'txt', 'a.constructor': 'constructor', '__proto__': 'txt', 'notes.': 'txt', '.bash_profile': 'sh', '.gitignore': 'properties', '.stow-local-ignore': 'properties', '.zshrc.local': 'sh', 'Jenkinsfile': 'groovy', 'nb.ipynb': 'json', '.hidden': 'hidden', 'Rakefile': 'rb', 'Makefile': 'makefile', 'Dockerfile': 'sh', 'docker/Dockerfile.dev': 'sh',
    '.zshrc': 'sh', 'zsh/main.zshrc': 'sh', 'link.py': 'py', 'styles/site.scss': 'css',
    'README.md': 'md', 'docs/guide.markdown': 'md', 'LICENSE': 'txt', 'C:\\repo\\Program.cs': 'c#',
  };
  for (const [path, language] of Object.entries(cases)) assert.equal(languageFor(path), language, path);
});

test('markdown is the only file type with a rendered view', () => {
  const {isMarkdown} = load();
  assert.equal(isMarkdown('README.md'), true);
  assert.equal(isMarkdown('skills/tokenmaxxing/SKILL.MD'), true);
  assert.equal(isMarkdown('notes.mdx'), true);
  assert.equal(isMarkdown('notes.txt'), false);
  assert.equal(isMarkdown('md'), false);
});

test('front matter comes off the top and the rest is left alone', () => {
  const {rendering} = load();
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(rendering('---\nname: x\ndescription: y\n---\n\n# Title\n')), {front: ['name: x', 'description: y'], body: '\n# Title\n'});
  assert.deepEqual(plain(rendering('---\r\nname: x\r\n---\r\nBody')), {front: ['name: x'], body: 'Body'});
  assert.deepEqual(plain(rendering('\uFEFF---\ndescription: |\n  ```\n  x\n  ```\n---\nBody')), {front: ['description: |', '  ```', '  x', '  ```'], body: 'Body'});
  assert.deepEqual(plain(rendering('---\n# note\n"title": x\n---\nBody')), {front: ['# note', '"title": x'], body: 'Body'});
  for (const text of ['# Title\n\n---\n\nText\n\n---\n', '---\nnever closed\n', '', 'Title\n---\nText\n---\n', '---\n\n# Title\n\ntext\n\n---\nmore'])
    assert.deepEqual(plain(rendering(text)), {front: null, body: text}, text);
});

test('a very long markdown file is cut before rendering', () => {
  const {rendering} = load();
  const {body} = rendering('a'.repeat(250000));
  assert.equal(body.length, 200000 + '\n\n… (file truncated)'.length);
  assert.match(body, /file truncated\)$/);
});

test('syntax colors cover every slot and Rosé Pine themes use their own arrangement', () => {
  const {syntaxColors} = load();
  const t = {dim: 'dim', muted: 'muted', foreground: 'fg'};
  for (let i = 0; i < 16; i++) t[`ansi${i}`] = `a${i}`;
  const slots = ['keyword', 'string', 'comment', 'function', 'type', 'number', 'constant', 'variable', 'operator', 'punctuation', 'boolean', 'string.escape'];
  for (const name of ['graphite', 'rose-pine-moon', '', undefined]) {
    const colors = syntaxColors(t, name);
    assert.deepEqual(Object.keys(colors).sort(), [...slots].sort(), String(name));
    for (const slot of slots) assert.equal(typeof colors[slot], 'string', `${name} ${slot}`);
  }
  assert.equal(syntaxColors(t, 'graphite').keyword, 'a5');
  assert.equal(syntaxColors(t, 'rose-pine-dawn').keyword, 'a2');
  assert.equal(syntaxColors(t, 'rose-pine').variable, 'fg');
});

test('the theme name follows the appearance when a layout names a light and dark pair', () => {
  assert.equal(load().themeName(), 'rose-pine-moon');
  assert.equal(load({settings: () => ({theme: {light: 'rose-pine-dawn', dark: 'rose-pine'}, dark: true})}).themeName(), 'rose-pine');
  assert.equal(load({settings: () => ({theme: {light: 'rose-pine-dawn', dark: 'rose-pine'}, dark: false})}).themeName(), 'rose-pine-dawn');
  assert.equal(load({settings: () => ({})}).themeName(), '');
  const picked = load({theme: () => ({ansi1: 'r', ansi2: 'g', ansi3: 'y', ansi4: 'b', ansi5: 'm', ansi6: 'c'}), settings: () => ({theme: 'graphite'}),
    themes: () => [{name: 'nord', colors: {ansi1: 'x'}}, {name: 'rose-pine-dawn', colors: {ansi1: 'r', ansi2: 'g', ansi3: 'y', ansi4: 'b', ansi5: 'm', ansi6: 'c'}}]});
  assert.equal(picked.themeName(), 'rose-pine-dawn');
});

// A panel with a file loaded, and every editor it makes recorded.
function panel(file, text) {
  const made = [];
  const context = load({EditorState: {new: options => { const state = {options, released: false, release() { this.released = true; }}; made.push(state); return state; }}});
  const mod = new context.Mod();
  Object.assign(mod, {wrap: true, rendered: true, file, text, code: null});
  return {mod, made};
}

test('markdown opens rendered with no editor, and Source makes one', () => {
  const {mod, made} = panel('README.md', '# Hi');
  mod.build();
  assert.equal(mod.showsRendered(), true);
  assert.equal(made.length, 0);
  mod.setRendered(false);
  assert.equal(mod.showsRendered(), false);
  assert.equal(made.length, 1);
  assert.equal(made[0].options.language, 'md');
  assert.equal(made[0].options.soft_wrap, true);
  assert.equal(made[0].options.readonly, true);
  mod.setRendered(true);
  assert.equal(made[0].released, true);
  assert.equal(mod.code, null);
  assert.equal(mod.markdown.body, '# Hi');
});

test('turning wrap off makes a new editor and releases the old one', () => {
  const {mod, made} = panel('app/models/resource.rb', 'class Resource; end');
  mod.build();
  assert.equal(mod.showsRendered(), false);
  assert.equal(made[0].options.soft_wrap, true);
  mod.setWrap(false);
  assert.equal(made.length, 2);
  assert.equal(made[0].released, true);
  assert.equal(made[1].options.soft_wrap, false);
  assert.equal(mod.code, made[1]);
});

test('wrap and rendered choices are remembered, and default to on', () => {
  const context = load();
  assert.equal(context.preference('wrap'), true);
  context.remember('wrap', false);
  assert.equal(context.preference('wrap'), false);
  assert.equal(context.preference('rendered'), true);
  const broken = load({localStorage: {getItem() { throw Error('no storage'); }, setItem() { throw Error('no storage'); }}});
  assert.equal(broken.preference('wrap'), true);
  broken.remember('wrap', false);
});

test('a source preview longer than the limit is cut', () => {
  const {mod, made} = panel('big.log', 'x'.repeat(400001));
  mod.build();
  assert.match(made[0].options.value, /\n… \(file truncated\)$/);
  assert.equal(made[0].options.value.length, 400000 + '\n… (file truncated)'.length);
});

test('keys act only on what the header offers', () => {
  const ruby = panel('app/models/resource.rb', 'class Resource; end');
  ruby.mod.build();
  ruby.mod.command('toggle-rendered');
  assert.equal(ruby.mod.rendered, true);
  assert.equal(ruby.made.length, 1);
  ruby.mod.command('toggle-wrap');
  assert.equal(ruby.mod.wrap, false);
  const markdown = panel('README.md', '# Hi');
  markdown.mod.build();
  markdown.mod.command('toggle-wrap');
  assert.equal(markdown.mod.wrap, true);
  markdown.mod.command('toggle-rendered');
  assert.equal(markdown.mod.rendered, false);
  const empty = panel(null, null);
  empty.mod.command('toggle-wrap');
  empty.mod.command('toggle-rendered');
  assert.deepEqual([empty.mod.wrap, empty.mod.rendered, empty.made.length], [true, true, 0]);
});

test('an editor that cannot be made shows an error in place of the preview', () => {
  const context = load({EditorState: {new() { throw Error('no grammar'); }}});
  const mod = new context.Mod();
  Object.assign(mod, {wrap: true, rendered: true, file: 'a.rb', text: 'x', code: null});
  mod.setWrap(false);
  assert.equal(mod.fileError, 'Cannot preview this file');
  assert.equal(mod.code, null);
});

test('a preview recovers after a failed editor', () => {
  let fail = true;
  const context = load({EditorState: {new() { if (fail) throw Error('no grammar'); return {release() {}}; }}});
  const mod = new context.Mod();
  Object.assign(mod, {wrap: true, rendered: true, file: 'README.md', text: '# Hi', code: null});
  mod.build();
  mod.setRendered(false);
  assert.equal(mod.fileError, 'Cannot preview this file');
  mod.command('toggle-rendered');
  assert.equal(mod.fileError, null);
  assert.equal(mod.markdown.body, '# Hi');
  fail = false;
  mod.setRendered(false);
  assert.equal(mod.fileError, null);
  assert.notEqual(mod.code, null);
});

test('picking the view that already shows keeps its editor', () => {
  const {mod, made} = panel('README.md', '# Hi');
  mod.rendered = false;
  mod.build();
  mod.setRendered(false);
  mod.setWrap(true);
  assert.equal(made.length, 1);
  assert.equal(made[0].released, false);
  mod.close();
  assert.equal(made[0].released, true);
});

const nowhere = {spaces: () => [], panes: () => [], focused: () => null};

// show() with a file read that the test controls.
async function shown(path, read) {
  const made = [];
  const context = load({...nowhere, readTextFile: read, EditorState: {new: options => { made.push(options); return {release() {}}; }}});
  const mod = new context.Mod();
  // What the panel's context key is with no space or pane focused.
  const key = JSON.stringify({on: null});
  Object.assign(mod, {wrap: true, rendered: true, root: '/repo', on: null, context: {key}, code: null});
  const pending = [];
  const cx = {notify() {}, spawn(fn) { pending.push(fn(cx)); }};
  mod.show(path, cx);
  return {mod, made, cx, context, done: () => Promise.all(pending)};
}
test('opening a file shows its source, and a missing or binary file says why not', async () => {
  const source = await shown('a.rb', async path => { assert.equal(path, '/repo/a.rb'); return 'puts 1'; });
  await source.done();
  assert.equal(source.made[0].value, 'puts 1');
  assert.equal(source.mod.fileError, null);
  const gone = await shown('a.rb', async () => null);
  await gone.done();
  assert.match(gone.mod.fileError, /no longer available/);
  const binary = await shown('a.bin', async () => 'a\0b');
  await binary.done();
  assert.match(binary.mod.fileError, /Binary file/);
  assert.equal(binary.made.length, 0);
  const unreadable = await shown('a.rb', async () => { throw Error('too large'); });
  await unreadable.done();
  assert.match(unreadable.mod.fileError, /Cannot preview/);
});

test('a slow file read does not replace the file opened after it', async () => {
  let release;
  const first = await shown('slow.rb', path => path.endsWith('slow.rb') ? new Promise(resolve => { release = () => resolve('slow'); }) : Promise.resolve('fast'));
  first.mod.show('fast.rb', first.cx);
  release();
  await first.done();
  assert.equal(first.mod.file, 'fast.rb');
  assert.equal(first.mod.text, 'fast');
  assert.deepEqual(first.made.map(options => options.value), ['fast']);
});
