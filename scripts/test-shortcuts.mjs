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
const { normalizeShortcutKey, shortcutEventKey, shortcutFor, shortcutMatches, shortcutHeld, shortcutTriggerReleased,
  setShortcut, resetShortcut, resetAllShortcuts } = await import('../src/screen/shortcuts.js');
const { captureShortcutInput, commitShortcutInput } = await import('../src/screen/shortcut-settings.js');
const event = (key, flags = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...flags });
const keydown = e => listeners.get('keydown').forEach(listener => listener(e));
const mouse = (button, flags = {}) => ({ button, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...flags });

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
setShortcut('save', '');
assert.equal(shortcutFor('save'), '', 'an explicitly empty binding does not fall back to its default');
assert.equal(shortcutMatches(event('s', { ctrlKey: true }), 'save'), false);
assert.equal(shortcutTriggerReleased(event(''), 'save'), false);
assert.equal(configRegistry.get(ConfigKey.SHORTCUTS).save, '');
resetShortcut('save');
assert.equal(shortcutMatches(event('g'), 'addGroup'), true);
assert.equal(shortcutMatches(event('g', { shiftKey: true }), 'groupSelected'), true);
assert.equal(shortcutMatches(event('g', { shiftKey: true }), 'addGroup'), false);

assert.equal(shortcutEventKey(mouse(3)), 'Mouse4');
assert.equal(shortcutEventKey(mouse(4)), 'Mouse5');
assert.equal(shortcutEventKey(mouse(0)), '');
setShortcut('undo', 'Ctrl + Mouse4');
assert.equal(shortcutMatches(mouse(3, { ctrlKey: true }), 'undo'), true);
assert.equal(shortcutMatches(mouse(3), 'undo'), false);
setShortcut('temporaryEyedropper', 'Mouse5');
listeners.get('mousedown').forEach(listener => listener(mouse(4)));
assert.equal(shortcutHeld('temporaryEyedropper'), true);
assert.equal(shortcutTriggerReleased(mouse(4), 'temporaryEyedropper'), true);
listeners.get('mouseup').forEach(listener => listener(mouse(4)));
assert.equal(shortcutHeld('temporaryEyedropper'), false);

const input = {
  value: shortcutFor('undo'), dataset: { shortcutInput: 'undo', capturing: 'ready' },
  blur() { commitShortcutInput(this); }
};
const record = value => captureShortcutInput(input, {
  ...value, preventDefault() {}, stopImmediatePropagation() {}
});
record(mouse(3, { shiftKey: true }));
assert.equal(input.value, 'Shift + Mouse4', 'the first side button replaces the old binding, retaining held modifiers');
record(mouse(4, { shiftKey: true }));
record(event('Enter'));
assert.equal(shortcutFor('undo'), 'Shift + Mouse4 + Mouse5');
input.dataset.capturing = 'ready';
record(event('Escape'));
assert.equal(shortcutFor('undo'), '', 'Esc clears and commits rather than binding Escape');
assert.equal(input.value, '');
assert.equal(configRegistry.get(ConfigKey.SHORTCUTS).undo, '');
resetShortcut('undo');
assert.equal(shortcutFor('undo'), 'Ctrl + Z');

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
console.log('Shortcut defaults, empty bindings, side buttons, recording, resets and multi-key combinations passed.');
