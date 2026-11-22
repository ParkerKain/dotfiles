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
    theme: () => ({}), settings: () => ({theme: 'rose-pine-moon', font_family: 'Mono'}), ...overrides};
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
    'Gemfile': 'rb', 'Gemfile.lock': 'yaml', 'Rakefile': 'rb', 'Makefile': 'makefile', 'Dockerfile': 'sh', 'docker/Dockerfile.dev': 'sh',
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

test('front matter renders as a code block and the rest is left alone', () => {
  const {renderable} = load();
  assert.equal(renderable('---\nname: x\ndescription: y\n---\n\n# Title\n'), '```yaml\nname: x\ndescription: y\n```\n\n\n# Title\n');
  assert.equal(renderable('---\r\nname: x\r\n---\r\nBody'), '```yaml\nname: x\n```\n\nBody');
  assert.equal(renderable('# Title\n\n---\n\nText\n\n---\n'), '# Title\n\n---\n\nText\n\n---\n');
  assert.equal(renderable('---\nnever closed\n'), '---\nnever closed\n');
  assert.equal(renderable(''), '');
});

test('a very long markdown file is cut before rendering', () => {
  const {renderable} = load();
  const out = renderable('a'.repeat(250000));
  assert.equal(out.length < 201000, true);
  assert.match(out, /file truncated\)$/);
});

test('syntax colors cover every slot and Rosé Pine themes use their own arrangement', () => {
  const {syntaxColors} = load();
  const t = {dim: 'dim', muted: 'muted'};
  for (let i = 0; i < 16; i++) t[`ansi${i}`] = `a${i}`;
  const slots = ['keyword', 'string', 'comment', 'function', 'type', 'number', 'constant', 'variable', 'operator', 'punctuation', 'boolean', 'string.escape'];
  for (const name of ['graphite', 'rose-pine-moon', '', undefined]) {
    const colors = syntaxColors(t, name);
    assert.deepEqual(Object.keys(colors).sort(), [...slots].sort(), String(name));
    for (const slot of slots) assert.equal(typeof colors[slot], 'string', `${name} ${slot}`);
  }
  assert.equal(syntaxColors(t, 'graphite').keyword, 'a5');
  assert.equal(syntaxColors(t, 'rose-pine-dawn').keyword, 'a2');
});

test('the theme name follows the appearance when a layout names a light and dark pair', () => {
  assert.equal(load().themeName(), 'rose-pine-moon');
  assert.equal(load({settings: () => ({theme: {light: 'rose-pine-dawn', dark: 'rose-pine'}, dark: true})}).themeName(), 'rose-pine');
  assert.equal(load({settings: () => ({theme: {light: 'rose-pine-dawn', dark: 'rose-pine'}, dark: false})}).themeName(), 'rose-pine-dawn');
  assert.equal(load({settings: () => ({})}).themeName(), '');
});

// A panel with a markdown file loaded, and every editor it makes recorded.
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
  assert.equal(context.saved('wrap'), true);
  context.save('wrap', false);
  assert.equal(context.saved('wrap'), false);
  assert.equal(context.saved('rendered'), true);
  const broken = load({localStorage: {getItem() { throw Error('no storage'); }, setItem() { throw Error('no storage'); }}});
  assert.equal(broken.saved('wrap'), true);
  broken.save('wrap', false);
});

test('a source preview longer than the limit is cut', () => {
  const {mod, made} = panel('big.log', 'x'.repeat(400001));
  mod.build();
  assert.match(made[0].options.value, /\n… \(file truncated\)$/);
  assert.equal(made[0].options.value.length, 400000 + '\n… (file truncated)'.length);
});
