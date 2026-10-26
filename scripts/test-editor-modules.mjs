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
import { createElementCommands } from '../src/editor/element-commands.js';
import { createModelCaptureController } from '../src/render/model-capture.js';
import { createTextureTemplateController } from '../src/texture/template-controller.js';
import { createCameraController } from '../src/screen/camera-controller.js';
import { createOutlinerViewController } from '../src/screen/outliner-view.js';
import { verticalDropTarget } from '../src/screen/vertical-drop.js';
import { activeLayer, compositeLayers, createLayerGroup, insertLayerNearSelection, layerDisplayRows, layerEntryRaster, layerRasterCache, layerTreeItems, moveLayerEntry, normalizeTextureLayers, reorderLayerStack } from '../src/common/core/texture-features.js';
import { blendLayerImageData, blendLayerRgb, LAYER_BLEND_MODES } from '../src/common/core/layer-blend.js';
import { selectionAffectsModifierResults } from '../src/editor/workspace-coordinator.js';
import { Cube, Group, CubeBricksProject, addModifier } from '../src/model.js';

assert.equal(state.mode, 'edit');
assert.equal(state.transformSpace, 'self', 'new sessions default to local transform axes');
{
  const project = new CubeBricksProject({ elements: [], groups: [], outliner: [] });
  const creationState = { mode: 'edit', project, selectedUid: null, selectedUids: new Set(), collapsedGroups: new Set() };
  const commands = createElementCommands({ state: creationState,
    selectedNodeUids: () => [...creationState.selectedUids], topLevelSelectedUids: () => [...creationState.selectedUids],
    snapshot() {}, markDirty() {}, renderAll() {}, toast() {}, captureOutlinerRowPositions() { return []; },
    animateOutlinerReorder() {}, inspectorController: {} });
  commands.addCube();
  const groundCube = project.getNode(creationState.selectedUid);
  assert.deepEqual([groundCube.position, groundCube.size, groundCube.pivot],
    [[-1, 0, -1], [2, 2, 2], [0, 0, 0]], 'new cubes sit on the ground with a ground-level pivot');
  const parent = new Group({ pivot: [9, 5, -2], children: [] });
  project.groups.push(parent); project.outliner.push(parent.uid); project.invalidateHierarchyIndex();
  creationState.selectedUid = parent.uid; creationState.selectedUids = new Set([parent.uid]);
  commands.addCube();
  const child = project.getNode(creationState.selectedUid);
  assert.deepEqual([child.position, child.pivot], [[8, 5, -3], [9, 5, -2]],
    'new cubes inside a group share its pivot without sinking below their local ground');
}
const verticalRows = [
  { top: 20, height: 30 }, { top: 50, height: 30 }, { top: 80, height: 30 }
];
assert.deepEqual([verticalDropTarget(verticalRows, -100).index, verticalDropTarget(verticalRows, -100).position],
  [0, 'before'], 'vertical sorting clamps above the first row');
assert.deepEqual([verticalDropTarget(verticalRows, 95).index, verticalDropTarget(verticalRows, 95).position],
  [2, 'after'], 'vertical sorting uses row midpoints');
assert.deepEqual([verticalDropTarget(verticalRows, 500).index, verticalDropTarget(verticalRows, 500).position],
  [2, 'after'], 'vertical sorting clamps below the last row');
const layers = ['bottom', 'middle', 'top'].map(uid => ({ uid }));
assert.deepEqual(reorderLayerStack(layers, 'bottom', 'top', 'before').map(layer => layer.uid),
  ['middle', 'top', 'bottom'], 'layer drops follow the displayed top-to-bottom order');
assert.deepEqual(reorderLayerStack(layers, 'top', 'middle', 'after').map(layer => layer.uid),
  ['bottom', 'top', 'middle'], 'moving a top layer below the middle layer preserves every layer');
assert.equal(reorderLayerStack(layers, 'top', 'middle', 'before'), layers, 'no-op drop preserves the layer array');
const grouped = createLayerGroup(layers, 'middle', 'group', 'group_1');
assert.deepEqual(grouped.map(layer => [layer.uid, layer.parentUid || null]),
  [['bottom', null], ['middle', 'group'], ['group', null], ['top', null]],
  'group creation wraps the selected layer without changing its stack position');
assert.deepEqual(layerDisplayRows(grouped).map(row => [row.layer.uid, row.depth]),
  [['top', 0], ['group', 0], ['middle', 1], ['bottom', 0]]);
assert.deepEqual(layerTreeItems(grouped).map(item => item.groupEnd ? `end:${item.groupEnd}` : item.layer.uid),
  ['top', 'group', 'middle', 'end:group', 'bottom'], 'layer groups expose a selectable rail footer');
assert.deepEqual(insertLayerNearSelection(grouped, { uid: 'new' }, 'group').map(layer => layer.uid),
  ['bottom', 'middle', 'new', 'group', 'top'], 'new layers append inside the selected group');
const nested = moveLayerEntry(grouped, 'top', 'group', 'inside');
assert.equal(nested.find(layer => layer.uid === 'top').parentUid, 'group');
const appendedToGroup = moveLayerEntry(grouped, 'top', 'group', 'inside-end');
assert.deepEqual(layerDisplayRows(appendedToGroup).map(row => [row.layer.uid, row.depth]),
  [['group', 0], ['middle', 1], ['top', 1], ['bottom', 0]],
  'dropping on a group footer appends at the visible bottom of that group');
assert.deepEqual(layerDisplayRows(moveLayerEntry(appendedToGroup, 'top', 'group', 'after')).map(row => [row.layer.uid, row.depth]),
  [['group', 0], ['middle', 1], ['top', 0], ['bottom', 0]],
  'dropping beyond the group rail places the layer outside the group');
assert.equal(moveLayerEntry(nested, 'group', 'top', 'inside'), nested, 'groups cannot move into descendants');
assert.equal(activeLayer({ layers: nested, activeLayerUid: 'group' }).uid, 'top',
  'painting from a selected group targets its highest child layer');
assert.deepEqual(layerDisplayRows(nested.map(layer => layer.uid === 'group' ? { ...layer, collapsed: true } : layer))
  .map(row => row.layer.uid), ['group', 'bottom'], 'collapsed layer groups hide descendants without deleting them');
assert.deepEqual(normalizeTextureLayers({ uuid: 'texture', layers: [
  { uid: 'leaf', parentUid: 'folder', source: 'data:image/png;base64,a' },
  { uid: 'folder', type: 'group', name: 'group_1', collapsed: true }
] }).map(layer => [layer.uid, layer.parentUid || null, layer.type || 'layer']),
[['leaf', 'folder', 'layer'], ['folder', null, 'group']], 'project import retains layer hierarchy');
{
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 1, height: 1,
    getContext: () => ({ drawImage() {}, save() {}, restore() {}, clearRect() {} }) }) };
  try {
    const editable = { width: 4, height: 4 };
    const asset = { layers: [
      { uid: 'painted', source: 'original', parentUid: 'folder', visible: true },
      { uid: 'folder', type: 'group', visible: true, opacity: 75, blendMode: 'normal' }
    ], activeLayerUid: 'painted', uvWidth: 4, uvHeight: 4 };
    compositeLayers(asset, editable);
    assert.notEqual(layerRasterCache.get('painted').canvas, editable,
      'a painted layer must not retain the reusable editable canvas by reference');
    editable.width = 1;
    assert.equal(layerRasterCache.get('painted').canvas.width, 4,
      'switching the editable canvas to another layer cannot resize the previous layer');
    assert.ok(layerEntryRaster(asset, 'folder'), 'a group exposes its live child composite as a layer raster');
  } finally {
    layerRasterCache.delete('painted');
    globalThis.document = originalDocument;
  }
}
assert.deepEqual(LAYER_BLEND_MODES.map(([key]) => key),
  ['normal', 'multiply', 'screen', 'add', 'subtract', 'hue', 'value', 'saturation', 'grayscale', 'tone_map']);
assert.deepEqual(blendLayerRgb([20, 100, 200], [200, 50, 10], 'multiply').map(Math.round), [16, 20, 8]);
assert.deepEqual(blendLayerRgb([20, 100, 200], [200, 50, 10], 'screen').map(Math.round), [204, 130, 202]);
assert.deepEqual(blendLayerRgb([20, 100, 200], [200, 50, 10], 'add'), [220, 150, 210]);
assert.deepEqual(blendLayerRgb([20, 100, 200], [200, 50, 10], 'subtract'), [0, 50, 190]);
assert.deepEqual(blendLayerRgb([100, 200, 100], [200, 50, 50], 'hue'), [200, 100, 100],
  'hue mode keeps lower saturation and value');
assert.deepEqual(blendLayerRgb([100, 200, 100], [200, 50, 50], 'saturation'), [50, 200, 50],
  'saturation mode keeps lower hue and value');
assert.deepEqual(blendLayerRgb([100, 200, 100], [100, 25, 25], 'value'), [50, 100, 50],
  'value mode keeps lower hue and saturation');
const lowerPixel = new Uint8ClampedArray([20, 100, 200, 255]);
blendLayerImageData(lowerPixel, new Uint8ClampedArray([200, 50, 10, 255]), 50, 'multiply');
assert.deepEqual([...lowerPixel], [18, 60, 104, 255], 'blend strength leaves the lower pixel visible');
const transparentLower = new Uint8ClampedArray([0, 0, 0, 0]);
blendLayerImageData(transparentLower, new Uint8ClampedArray([200, 50, 10, 128]), 100, 'hue');
assert.deepEqual([...transparentLower], [200, 50, 10, 128], 'a layer remains visible without a lower pixel');
const visualGray = color => color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
const baseColor = [60, 120, 190], upperColor = [220, 40, 35];
assert.ok(Math.abs(visualGray(blendLayerRgb(baseColor, upperColor, 'grayscale')) - visualGray(upperColor)) < 1,
  'gray blend transfers visual luminance');
assert.notDeepEqual(blendLayerRgb(baseColor, upperColor, 'value').map(Math.round),
  blendLayerRgb(baseColor, upperColor, 'grayscale').map(Math.round), 'HSV value is not visual grayscale');
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
assert.deepEqual(dockPanelRegistry.list().map(panel => panel.id), ['texture', 'uvPreview', 'inspector', 'outliner', 'bottom', 'layers', 'paintOperators']);
assert.equal(dockPanelRegistry.get('layers').defaultStackWith, 'outliner');
assert.equal(dockPanelRegistry.get('paintOperators').defaultStackWith, 'inspector');
assert.deepEqual(dockPanelRegistry.get('paintOperators').modes, ['paint']);
const outlinerCube = new Cube({ uid: 'outliner-cube' });
const innerGroup = new Group({ uid: 'outliner-inner', children: [outlinerCube.uid] });
const outerGroup = new Group({ uid: 'outliner-outer', children: [innerGroup.uid] });
const outlinerProject = new CubeBricksProject({ elements: [outlinerCube], groups: [innerGroup, outerGroup], outliner: [outerGroup.uid] });
const virtualWindow = { style: {}, innerHTML: '' };
const outlinerView = { scrollTop: 0, clientHeight: 300, innerHTML: '' };
const outlinerState = { project: outlinerProject, selectedUids: new Set(), selectedCurveNodeIndex: null,
  collapsedGroups: new Set(), mode: 'edit', outlinerDetailed: false };
const outlinerController = createOutlinerViewController({ state: outlinerState,
  $: selector => selector === '#outlinerSearch' ? { value: '' } : virtualWindow,
  outliner: outlinerView, LOCATOR_ICON_SHAPES: '', selected: () => null,
  selectedElementUids: () => [], isBezierElement: () => false, isShapeElement: () => false,
  escapeHtml: String, escapeAttribute: String });
outlinerController.renderOutliner();
assert.deepEqual(outlinerState.outlinerRows.map(row => [row.node?.uid || row.groupUid, row.top, row.height]),
  [[outerGroup.uid, 0, 31], [innerGroup.uid, 31, 31], [outlinerCube.uid, 62, 31],
    [innerGroup.uid, 93, 16], [outerGroup.uid, 109, 16]],
  'nested groups have a half-row drop area after their contents');
assert.match(outlinerView.innerHTML, /height:218px/, 'the hierarchy reserves three full blank rows after its 125px content');
assert.match(virtualWindow.innerHTML, /data-group-end="outliner-inner"/, 'nested group footer is rendered as a drop target');
assert.match(virtualWindow.innerHTML, /class="outliner-tree-line ends-here" data-group-line-uid="outliner-inner"/,
  'the nested group line terminates at its own footer without ending the parent line');
assert.match(virtualWindow.innerHTML, /data-group-line-uid="outliner-outer"/,
  'ancestor guide lines continue through nested rows');
outlinerState.selectedUids.add(outerGroup.uid);
outlinerState.outlinerWindowStart = -1;
outlinerController.renderOutlinerWindow();
assert.doesNotMatch(virtualWindow.innerHTML, /is-selected-group-line/,
  'a selected group keeps normal rails until the pointer hovers over one');
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
