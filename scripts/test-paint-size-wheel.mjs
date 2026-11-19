import assert from 'node:assert/strict';
import { createPaintSizeWheelHandler } from '../src/paint/size-wheel.js';
import { setShortcut, resetShortcut } from '../src/screen/shortcuts.js';

const scene = { contains: target => target === scene }, texture = { contains: target => target === texture };
const state = { mode: 'paint', tool: 'brush', paintBrushSize: 5,
  paintToolSettings: { line: { size: 9 }, rectangle: { size: 3 }, ellipse: { size: 4 } } };
const input = { value: '5' };
let cursors = 0, options = 0;
const wheel = createPaintSizeWheelHandler({ state, sceneCanvas: scene, texturePreview: texture, sizeInput: input,
  updateToolOptions: () => options++, updateTextureBrushCursor: () => cursors++ });
function roll(target, flags = {}) {
  const event = { target, shiftKey: true, deltaY: -100, deltaX: 0, deltaMode: 0, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...flags };
  const handled = wheel(event);
  return { handled, event };
}
assert.equal(roll(scene).handled, true); assert.equal(state.paintBrushSize, 6); assert.equal(input.value, '6');
assert.equal(cursors, 0, '3D wheel does not move the 2D cursor');
assert.equal(roll(texture).handled, true); assert.equal(state.paintBrushSize, 7); assert.equal(cursors, 1);
assert.equal(roll(texture, { deltaY: 100 }).event.stopped, true); assert.equal(state.paintBrushSize, 6);
assert.equal(roll(scene, { ctrlKey: true }).handled, true, 'Ctrl screen-space painting can also adjust size');
assert.equal(state.paintBrushSize, 7);
assert.equal(roll(texture, { shiftKey: false }).handled, false, 'normal 2D scrolling remains available');
assert.equal(roll(scene, { shiftKey: false, ctrlKey: true }).handled, false, 'normal camera zoom remains available');
assert.equal(roll(scene, { altKey: true }).handled, false, 'temporary eyedropper and palette wheel have priority');
assert.equal(roll({}).handled, false, 'side docks keep their own scrolling');
assert.equal(roll(scene, { defaultPrevented: true }).handled, false);
assert.equal(state.paintBrushSize, 7);
state.paintBrushSize = 64; assert.equal(roll(scene).event.defaultPrevented, true); assert.equal(state.paintBrushSize, 64);
roll(scene, { deltaY: 100 }); assert.equal(state.paintBrushSize, 63, 'reverse immediately at the limit');
state.paintBrushSize = 1; roll(scene, { deltaY: 100 }); assert.equal(state.paintBrushSize, 1);
roll(scene); assert.equal(state.paintBrushSize, 2);
roll(texture, { deltaY: 0, deltaX: -100 }); assert.equal(state.paintBrushSize, 3, 'Shift-remapped horizontal wheel deltas work');
const beforeTrackpad = state.paintBrushSize;
for (let index = 0; index < 7; index++) roll(scene, { deltaY: -5 });
assert.equal(state.paintBrushSize, beforeTrackpad);
roll(scene, { deltaY: -5 }); assert.equal(state.paintBrushSize, beforeTrackpad + 1);
for (const tool of ['line', 'rectangle', 'ellipse']) {
  state.tool = tool;
  const size = state.paintToolSettings[tool].size, brushSize = state.paintBrushSize;
  roll(texture); assert.equal(state.paintToolSettings[tool].size, size + 1); assert.equal(state.paintBrushSize, brushSize);
}
for (const tool of ['fill', 'eyedropper', 'gradient', 'paintSelection']) {
  state.tool = tool; assert.equal(roll(scene).handled, false, `${tool} has no editable stroke thickness here`);
}
state.tool = 'brush'; state.mode = 'edit'; assert.equal(roll(scene).handled, false, 'edit-mode Shift-wheel is unchanged');
state.mode = 'paint';
try {
  setShortcut('brushSizeWheel', 'Ctrl + Shift');
  assert.equal(roll(scene).handled, false); assert.equal(roll(scene, { ctrlKey: true }).handled, true);
  setShortcut('brushSizeWheel', ''); assert.equal(roll(scene).handled, false, 'the size gesture can be disabled');
} finally { resetShortcut('brushSizeWheel'); }
assert.ok(options > 0);
console.log('Brush wheel: 2D/3D input, bounds, trackpad accumulation, per-tool sizes, navigation and shortcut priority passed.');
