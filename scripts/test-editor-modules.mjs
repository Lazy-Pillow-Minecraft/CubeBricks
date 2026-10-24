import assert from 'node:assert/strict';
import { state } from '../src/editor/state.js';
import { TOOL_REGISTRY } from '../src/editor/tool-registry.js';
import { DOCK_PANEL_DEFINITIONS } from '../src/screen/dock-definitions.js';
import { DockPanelRegistry } from '../src/screen/docks/registry.js';
import { dockPanelRegistry } from '../src/screen/docks/builtin.js';
import { DockManager } from '../src/screen/dock-manager.js';
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
import { selectionAffectsModifierResults } from '../src/editor/workspace-coordinator.js';
import { Cube, Group, CubeBricksProject, addModifier } from '../src/model.js';

assert.equal(state.mode, 'edit');
assert.equal(state.transformSpace, 'self', 'new sessions default to local transform axes');
const child = new Cube({ uid: 'modifier-test-child' });
const parent = new Group({ uid: 'modifier-test-parent', children: [child.uid] });
const modifierProject = new CubeBricksProject({ elements: [child], groups: [parent], outliner: [parent.uid] });
const symmetry = addModifier(modifierProject.getNode(parent.uid), 'symmetry');
assert.equal(symmetry.ignoreDuplicateCubes, true, 'new symmetry modifiers deduplicate by default');
assert.equal(selectionAffectsModifierResults(modifierProject, [child.uid]), true,
  'editing a child refreshes its parent modifier result');
symmetry.enabled = false;
assert.equal(selectionAffectsModifierResults(modifierProject, [child.uid]), false,
  'disabled parent modifiers do not force a result rebuild');
assert.ok(TOOL_REGISTRY.brush.modes.includes('paint'));
assert.equal(DOCK_PANEL_DEFINITIONS.find(panel => panel.id === 'texture').defaultDock, 'left');
assert.deepEqual(dockPanelRegistry.list().map(panel => panel.id), ['texture', 'uvPreview', 'inspector', 'outliner', 'bottom', 'layers']);
assert.equal(dockPanelRegistry.get('layers').defaultStackWith, 'outliner');
const localDockRegistry = new DockPanelRegistry();
localDockRegistry.register({ id: 'sample', index: 2, modes: ['edit'], defaultDock: 'right',
  defaultPosition: { x: 1, y: 2 }, defaultSize: { width: 200, height: 100 } });
assert.throws(() => localDockRegistry.register({ id: 'sample', index: 3, modes: ['edit'], defaultDock: 'left' }), /already registered/);
assert.throws(() => localDockRegistry.register({ id: 'second', index: 2, modes: ['edit'], defaultDock: 'left' }), /unique integer index/);
const dockHarness = Object.create(DockManager.prototype);
const makeDockPanel = (id, dock, width, height) => ({ id, index: width, state: {
  dock, x: width, y: height, width, height, collapsed: false, stackId: null, stackOrder: 0, stackActive: false
}, element: { after() {} } });
const hostDock = makeDockPanel('host', 'right', 292, 340);
const incomingDock = makeDockPanel('incoming', 'left', 236, 620);
const secondIncomingDock = makeDockPanel('secondIncoming', 'floating', 300, 240);
dockHarness.panels = new Map([hostDock, incomingDock, secondIncomingDock].map(panel => [panel.id, panel]));
dockHarness.applyPanelState = () => {};
dockHarness.syncStacks = () => {};
dockHarness.refreshZones = () => {};
dockHarness.renumberZone = () => {};
dockHarness.joinStack(incomingDock, hostDock, [incomingDock, secondIncomingDock]);
assert.deepEqual([incomingDock, secondIncomingDock].map(panel => [panel.state.dock, panel.state.width, panel.state.height]),
  [['right', 292, 340], ['right', 292, 340]], 'receiving dock determines shared stack geometry');
dockHarness.leaveStack(incomingDock);
assert.equal(hostDock.state.dock, 'right', 'the dock left in place retains the shared state');
assert.equal(secondIncomingDock.state.stackId, hostDock.state.stackId, 'the remaining tabs stay together');
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
