import assert from 'node:assert/strict';

const listeners = new Map();
globalThis.window = {
  localStorage: null,
  addEventListener(type, callback, options) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push({ callback, capture: options === true || options?.capture === true });
  }
};
globalThis.Element = class {
  constructor(input = false) { this.input = input; }
  closest(selector) { return this.input && selector.includes('input,') ? this : null; }
  contains(target) { return target === this; }
};
const viewport = new Element(), outliner = new Element(), textInput = new Element(true);
let dialogOpen = false;
globalThis.document = {
  activeElement: viewport, body: new Element(), querySelector: () => dialogOpen ? {} : null
};
const { setShortcut, shortcutHeld } = await import('../src/screen/shortcuts.js');
const { bindWorkspaceShortcuts } = await import('../src/screen/workspace-shortcuts.js');
const calls = [], state = { mode: 'edit', tool: 'move' };
let sampling = false;
bindWorkspaceShortcuts({
  state, viewport, outliner, $: () => new Element(), uvEditorController: {},
  closeShapeCreateMenu() {}, addEmptyGroup() { calls.push('empty'); }, groupSelected() { calls.push('group'); },
  setTool(tool) { calls.push(tool); state.tool = tool; },
  beginTemporaryEyedropper() { sampling = true; return true; },
  endTemporaryEyedropper() { const wasSampling = sampling; sampling = false; return wasSampling; },
  undo() { calls.push('undo'); },
  selectAllElements(options) { calls.push(options.groupsOnly ? 'select-groups' : 'select-elements'); }
});
function fire(type, values = {}) {
  const event = {
    target: viewport, defaultPrevented: false, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; }, ...values
  };
  const ordered = [...(listeners.get(type) || [])].sort((left, right) => Number(right.capture) - Number(left.capture));
  for (const { callback } of ordered) { callback(event); if (event.stopped) break; }
  return event;
}
fire('keydown', { key: 'g' });
fire('keydown', { key: 'g', shiftKey: true });
assert.deepEqual(calls, ['empty', 'group']);
fire('keydown', { key: 'g', repeat: true });
assert.equal(calls.length, 2, 'holding G does not create repeated empty groups');
document.activeElement = textInput;
fire('keydown', { key: 'g', target: textInput });
assert.equal(calls.length, 2, 'typing into a field does not create a group');
document.activeElement = viewport;
dialogOpen = true;
fire('keydown', { key: 'g' });
assert.equal(calls.length, 2, 'an open dialog does not create model groups');
dialogOpen = false;
state.mode = 'paint';
fire('keydown', { key: 'g' });
fire('keydown', { key: 'g', shiftKey: true });
assert.deepEqual(calls, ['empty', 'group', 'fill'], 'G remains the paint bucket in Paint mode');

state.mode = 'edit';
setShortcut('addGroup', 'Mouse4');
const pointer = fire('pointerdown', { button: 3 });
assert.equal(pointer.stopped, true, 'a side-button press never starts a viewport drag');
fire('mousedown', { button: 3 });
assert.equal(calls.at(-1), 'empty', 'mouse side buttons execute workspace actions');
setShortcut('groupSelected', 'Ctrl + Mouse5');
fire('mousedown', { button: 4, ctrlKey: true });
assert.equal(calls.at(-1), 'group', 'side buttons accept keyboard modifiers');
const count = calls.length;
fire('mousedown', { button: 4 });
assert.equal(calls.length, count, 'side buttons still require their configured modifiers');
setShortcut('undo', 'Mouse4');
document.activeElement = textInput;
fire('mousedown', { button: 3 });
assert.equal(calls.length, count, 'side-button project undo respects focused text fields');
document.activeElement = viewport;
setShortcut('temporaryEyedropper', 'Mouse5');
fire('mousedown', { button: 4 });
assert.equal(sampling, true);
assert.equal(shortcutHeld('temporaryEyedropper'), true);
const release = fire('mouseup', { button: 4 });
assert.equal(sampling, false, 'releasing the side button restores the original tool');
assert.equal(shortcutHeld('temporaryEyedropper'), false);
assert.equal(release.defaultPrevented, true, 'side-button release suppresses browser history navigation');
assert.equal(fire('auxclick', { button: 4 }).defaultPrevented, true);
state.mode = 'animate';
document.activeElement = outliner;
const beforeIndexActions = calls.length;
for (const values of [
  { key: 'Delete' }, { key: 'c', ctrlKey: true }, { key: 'x', ctrlKey: true },
  { key: 'v', ctrlKey: true }, { key: 'd', ctrlKey: true }, { key: 'c' }, { key: 's' }
]) {
  assert.equal(fire('keydown', { target: outliner, ...values }).defaultPrevented, true);
}
assert.equal(calls.length, beforeIndexActions, 'animation hierarchy shortcuts cannot edit the model');
fire('keydown', { target: outliner, key: 'a', ctrlKey: true });
assert.equal(calls.at(-1), 'select-groups', 'animation hierarchy selects groups rather than hidden elements');
state.mode = 'edit';
fire('keydown', { target: outliner, key: 'a', ctrlKey: true });
assert.equal(calls.at(-1), 'select-elements', 'normal hierarchy selection stays unchanged');
console.log('Group shortcuts, mode and focus guards, mouse-side-button dispatch and temporary tools passed.');
