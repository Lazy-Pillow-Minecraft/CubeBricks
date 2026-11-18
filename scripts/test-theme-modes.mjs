import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createThemeController } from '../src/screen/theme/controller.js';
import { DARK_THEME_PRESETS, LIGHT_THEME_PRESETS, THEME_PRESETS, THEME_COLOR_KEYS, resolveThemeMode, themeColors } from '../src/screen/theme/presets.js';
import { ConfigKey } from '../src/common/config/app-config.js';

assert.deepEqual(Object.keys(LIGHT_THEME_PRESETS).sort(), Object.keys(DARK_THEME_PRESETS).sort());
for (const name of Object.keys(DARK_THEME_PRESETS)) {
  assert.deepEqual(Object.keys(LIGHT_THEME_PRESETS[name]).sort(), [...THEME_COLOR_KEYS].sort());
  assert.notEqual(LIGHT_THEME_PRESETS[name]['--bg'], DARK_THEME_PRESETS[name]['--bg']);
}
for (const colors of [LIGHT_THEME_PRESETS.monochrome, DARK_THEME_PRESETS.monochrome]) {
  for (const value of Object.values(colors)) {
    const components = value.startsWith('#') ? value.slice(1).match(/../g) : value.match(/\d+/g).slice(0, 3);
    assert.equal(components[0], components[1]);
    assert.equal(components[1], components[2]);
  }
}
assert.equal(resolveThemeMode('system', false), 'light');
assert.equal(resolveThemeMode('system', true), 'dark');
assert.equal(resolveThemeMode('light', true), 'light');
assert.equal(resolveThemeMode('dark', false), 'dark');
assert.equal(Object.keys(THEME_PRESETS).length, 12);
for (const name of Object.keys(DARK_THEME_PRESETS)) {
  assert.equal(THEME_PRESETS[name].style, 'classic');
  assert.equal(THEME_PRESETS[`${name}-blocks`].style, 'blocks');
  for (const mode of ['light', 'dark']) assert.deepEqual(themeColors(name, mode), themeColors(`${name}-blocks`, mode));
}
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
assert.equal([...html.matchAll(/data-preset="/g)].length, 12);
assert.doesNotMatch(html, /data-theme-var="--(?:accent|bg|panel|viewport|selection-outline)"/);

const savedGlobals = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
const storage = new Map(), variables = new Map();
const style = { setProperty: (key, value) => variables.set(key, value) };
const root = { style, dataset: {} };
let systemListener, configListener, mode = 'system', renders = 0;
const system = {
  matches: false,
  addEventListener(event, listener) { assert.equal(event, 'change'); systemListener = listener; }
};
const configRegistry = {
  get(key) { assert.equal(key, ConfigKey.THEME_MODE); return mode; },
  subscribe(key, listener) { assert.equal(key, ConfigKey.THEME_MODE); configListener = listener; }
};
globalThis.localStorage = {
  getItem: key => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value)
};
globalThis.document = { documentElement: root };
globalThis.window = { matchMedia: () => system };
const options = {
  $: () => ({ dataset: {}, value: '', textContent: '' }), $$: () => [],
  configRegistry, hexToRgb: () => [0, 0, 0], sceneRenderer: { setSelectionOutline() {} },
  renderScene() { renders++; }, toast() {}
};
try {
  let controller = createThemeController(options);
  controller.loadTheme();
  assert.equal(root.dataset.colorScheme, 'light');
  controller.applyPreset('violet');
  assert.equal(variables.get('--bg'), LIGHT_THEME_PRESETS.violet['--bg']);
  controller.setThemeVar('--panel', '#faf0ff');
  controller.setThemeVar('--radius', '8px');
  system.matches = true;
  systemListener();
  assert.equal(root.dataset.colorScheme, 'dark');
  assert.equal(variables.get('--panel'), DARK_THEME_PRESETS.violet['--panel']);
  assert.equal(variables.get('--radius'), '8px');
  controller.setThemeVar('--panel', '#211122');
  mode = 'light';
  configListener();
  assert.equal(variables.get('--panel'), '#faf0ff');
  const beforeSystemChange = renders;
  systemListener();
  assert.equal(renders, beforeSystemChange, 'explicit modes ignore system changes');
  mode = 'dark';
  configListener();
  assert.equal(variables.get('--panel'), '#211122');
  mode = 'light';
  controller = createThemeController(options);
  controller.loadTheme();
  assert.equal(variables.get('--panel'), '#faf0ff', 'customizations and selected preset survive restart');
  controller.applyPreset('monochrome');
  assert.equal(variables.get('--accent'), '#000000');
  assert.equal(variables.get('--radius'), '8px');
  controller.applyPreset('violet-blocks');
  assert.equal(root.dataset.themeStyle, 'blocks');
  mode = 'dark';
  configListener();
  assert.equal(root.dataset.themeStyle, 'blocks');
  assert.equal(variables.get('--panel'), DARK_THEME_PRESETS.violet['--panel']);
  controller = createThemeController(options);
  controller.loadTheme();
  assert.equal(root.dataset.themeStyle, 'blocks', 'the block variant persists as its own theme');
  controller.applyPreset('violet');
  assert.equal(root.dataset.themeStyle, 'classic');

  storage.clear();
  mode = 'dark';
  storage.set('cubebricks.theme', JSON.stringify({
    ...DARK_THEME_PRESETS.violet, '--panel': '#222123', '--ui-scale': '110%'
  }));
  const migrated = createThemeController(options);
  migrated.loadTheme();
  assert.equal(variables.get('--panel'), '#222123');
  assert.ok(storage.has('cubebricks.theme.v2'));
  mode = 'light';
  configListener();
  assert.equal(variables.get('--panel'), LIGHT_THEME_PRESETS.violet['--panel']);
  assert.equal(style.fontSize, '23.1px');

  // Saving a choice must not depend on a successful scene refresh.
  storage.clear();
  let renderFailure = false;
  const withFaultyRenderer = createThemeController({ ...options, renderScene() {
    if (renderFailure) throw new Error('scene refresh failed');
  } });
  withFaultyRenderer.loadTheme();
  renderFailure = true;
  assert.throws(() => withFaultyRenderer.applyPreset('amber-blocks'), /scene refresh failed/);
  assert.equal(JSON.parse(storage.get('cubebricks.theme.v2')).preset, 'amber-blocks');

  // Desktop appearance survives a missing browser cache and restores mode too.
  storage.clear();
  storage.set('cubebricks.theme', JSON.stringify(DARK_THEME_PRESETS.moss));
  const disk = { preset: 'violet-blocks', mode: 'dark', overrides: { dark: {}, light: {} }, shared: { '--radius': '9px' }, updatedAt: Date.now() };
  const writes = [];
  configRegistry.set = (key, value) => { assert.equal(key, ConfigKey.THEME_MODE); mode = value; configListener(); };
  window.cubeBricksDesktop = { loadAppearance: async () => disk, saveAppearance: async value => writes.push(structuredClone(value)) };
  mode = 'light';
  const fromDisk = createThemeController(options);
  await fromDisk.loadTheme();
  assert.equal(root.dataset.themeStyle, 'blocks');
  assert.equal(root.dataset.colorScheme, 'dark');
  assert.equal(variables.get('--accent'), DARK_THEME_PRESETS.violet['--accent']);
  assert.equal(variables.get('--radius'), '9px');
  assert.equal(JSON.parse(storage.get('cubebricks.theme.v2')).preset, 'violet-blocks');
  assert.equal(writes.length, 0, 'legacy cache migration cannot overwrite an existing desktop choice');
  fromDisk.applyPreset('slate');
  assert.equal(writes.at(-1).preset, 'slate');

  storage.clear();
  let completeRead;
  window.cubeBricksDesktop.loadAppearance = () => new Promise(resolve => { completeRead = resolve; });
  const concurrent = createThemeController(options);
  const ready = concurrent.loadTheme();
  concurrent.applyPreset('amber-blocks');
  completeRead(disk);
  await ready;
  assert.equal(variables.get('--accent'), DARK_THEME_PRESETS.amber['--accent'], 'late disk read cannot overwrite a new choice');
} finally {
  for (const [name, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
}
console.log('Theme variants, live system switching, mode overrides, persistence and legacy migration passed.');
