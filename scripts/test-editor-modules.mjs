import assert from 'node:assert/strict';
import { state } from '../src/editor/state.js';
import { TOOL_REGISTRY } from '../src/editor/tool-registry.js';
import { DOCK_PANEL_DEFINITIONS } from '../src/screen/dock-definitions.js';
import { rgbToHsv, hsvToRgb, insetControlRatio } from '../src/screen/color-picker/math.js';
import { minimumTemplatePackingSide, packTemplateRectangles } from '../src/utils/template-packer.js';
import { quaternionFromEuler, eulerFromQuaternion } from '../src/utils/math/rotation.js';
import { createPaletteController } from '../src/screen/palette/controller.js';
import { createColorPickerController } from '../src/screen/color-picker/controller.js';
import { createReferenceImageController } from '../src/screen/reference-images.js';
import { createMirrorGuideController } from '../src/screen/mirror-guides.js';
import { createPaintSymmetryController } from '../src/paint/symmetry-relations.js';
import { createKnifeController } from '../src/editor/knife-controller.js';
import { createModelCaptureController } from '../src/render/model-capture.js';
import { createTextureTemplateController } from '../src/texture/template-controller.js';
import { createCameraController } from '../src/screen/camera-controller.js';

assert.equal(state.mode, 'edit');
assert.ok(TOOL_REGISTRY.brush.modes.includes('paint'));
assert.equal(DOCK_PANEL_DEFINITIONS.find(panel => panel.id === 'texture').defaultDock, 'left');
for (const factory of [createReferenceImageController, createMirrorGuideController,
  createPaintSymmetryController, createKnifeController, createModelCaptureController,
  createTextureTemplateController, createCameraController]) assert.equal(typeof factory, 'function');
assert.deepEqual(hsvToRgb(...rgbToHsv([255, 0, 0])), [255, 0, 0]);
assert.equal(insetControlRatio(2, 0, 100), 0);
const rectangles = [{ width: 8, height: 4 }, { width: 3, height: 3 }, { width: 2, height: 2 }];
assert.ok(minimumTemplatePackingSide(rectangles, 1) >= 9);
const packed = packTemplateRectangles(rectangles, 1);
assert.equal(packed.placements.size, rectangles.length);
for (let left = 0; left < rectangles.length; left++) for (let right = left + 1; right < rectangles.length; right++) {
  const a = packed.placements.get(rectangles[left]), b = packed.placements.get(rectangles[right]);
  assert.ok(a.x + rectangles[left].width + 1 <= b.x || b.x + rectangles[right].width + 1 <= a.x
    || a.y + rectangles[left].height + 1 <= b.y || b.y + rectangles[right].height + 1 <= a.y);
}
assert.ok(eulerFromQuaternion(quaternionFromEuler([10, 20, 30])).every((value, index) =>
  Math.abs(value - [10, 20, 30][index]) < 1e-6));

const previousStorage = globalThis.localStorage;
const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
try {
  const noop = () => {};
  const palette = createPaletteController({ state, $: noop, $$: noop, clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    escapeHtml: String, escapeAttribute: String, hexToRgb: noop, snapshot: noop, renderPaintGradientPreview: noop,
    setPaintColor: noop, updatePaintColorPickerVisual: noop, renderPaintColorPicker: noop, renderInspector: noop,
    toast: noop, selected: noop, noteJournalOperation: noop, markDirty: noop, renderAll: noop });
  assert.equal(palette.paletteRows.length, 3);
  palette.compact = true;
  palette.saveCompactPreference();
  assert.equal(memory.get('cubebricks.palette-compact.v1'), 'true');
  const picker = createColorPickerController({ state, inspector: {}, hexToRgb: noop, setPaintColor: noop,
    renderPaintColorHistory: noop, recordPaintColorHistory: noop, renderInspector: noop, setTool: noop,
    addPaintSwatchToSelection: noop });
  assert.equal(typeof picker.renderPaintColorPicker, 'function');
} finally {
  if (previousStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = previousStorage;
}

console.log('Editor module tests passed.');
