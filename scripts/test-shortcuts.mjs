import assert from 'node:assert/strict';

const listeners = new Map();
globalThis.window = {
  localStorage: null,
  addEventListener(type, callback) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(callback);
  }
};

const { ConfigKey, configRegistry } = await import('../src/common/config/app-config.js');
const { normalizeShortcutKey, shortcutFor, shortcutMatches, setShortcut, resetShortcut, resetAllShortcuts } = await import('../src/screen/shortcuts.js');
const event = (key, flags = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...flags });
const keydown = e => listeners.get('keydown').forEach(listener => listener(e));

assert.equal(normalizeShortcutKey('Control'), 'Ctrl');
assert.equal(shortcutFor('save'), 'Ctrl + S');
assert.equal(shortcutMatches(event('s', { ctrlKey: true }), 'save'), true);
assert.equal(shortcutMatches(event('s'), 'save'), false);
setShortcut('save', 'Alt + P');
assert.equal(shortcutMatches(event('p', { altKey: true }), 'save'), true);
assert.equal(shortcutMatches(event('s', { ctrlKey: true }), 'save'), false);
assert.equal(configRegistry.get(ConfigKey.SHORTCUTS).save, 'Alt + P');
resetShortcut('save');
assert.equal(shortcutFor('save'), 'Ctrl + S');

setShortcut('addShape', 'G + G');
keydown(event('g'));
keydown(event('g'));
assert.equal(shortcutMatches(event('g'), 'addShape'), true);
assert.equal(shortcutMatches(event('g'), 'paintFill'), false);
setShortcut('addShape', 'Ctrl + K + S');
keydown(event('k', { ctrlKey: true }));
keydown(event('s', { ctrlKey: true }));
assert.equal(shortcutMatches(event('s', { ctrlKey: true }), 'addShape'), true);
assert.equal(shortcutMatches(event('s', { ctrlKey: true }), 'save'), false);
resetAllShortcuts();
assert.equal(shortcutFor('addShape'), 'S');
console.log('Shortcut defaults, overrides, resets and multi-key combinations passed.');
