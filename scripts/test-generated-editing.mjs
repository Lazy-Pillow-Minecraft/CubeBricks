import assert from 'node:assert/strict';
import test from 'node:test';
import { Cube, Group, CubeBricksProject, addModifier, buildModifierRenderInstances } from '../src/model.js';
import { sourceCubeEntries, sourceWorldVertices } from '../src/model/modifier-evaluation.js';
import { matrixMultiply, rotationMatrix } from '../src/model/transform-math.js';
import { generatedSelection, findGeneratedInstance, generatedPoint, generatedVector, sourcePoint, sourceVector } from '../src/common/core/modifier-selection.js';
import { createSelectionController } from '../src/editor/selection-controller.js';
import { createTransformContext } from '../src/editor/transform-context.js';
import { createTransformTargets } from '../src/editor/transform-targets.js';
import { createTransformInteraction } from '../src/editor/transform-interaction.js';
import { createGizmoController } from '../src/screen/gizmo-controller.js';
import { WebGLSceneRenderer } from '../src/render/webgl-renderer.js';
import { buildCameraState, projectScreenPoint, screenRay } from '../src/render/viewport-math.js';

const noop = () => {};
const near = (actual, expected, message) => assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) < 1e-5), `${message}: ${actual} vs ${expected}`);
const nearMatrix = (actual, expected, message) => near(actual.flat(), expected.flat(), message);
const shape = item => item?.type === 'shape';
function uiElement() {
  const attributes = new Map(), controls = { children: [] };
  return { style: {}, classList: { add: noop, remove: noop, contains: () => false }, children: [], childElementCount: 1,
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
    hasAttribute: key => attributes.has(key), querySelector: selector => selector === '[data-gizmo-controls]' ? controls : null,
    querySelectorAll: () => [], contains: () => false, setPointerCapture: noop, hasPointerCapture: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 700 }) };
}

function fixture(kind = 'axes', projection = 'orthographic') {
  const project = new CubeBricksProject({ formatId: 'bedrock_entity',
    elements: [new Cube({ uid: 'cube', position: [2, 0, 1], size: [2, 4, 6], pivot: [3, 2, 4], rotation: [15, 20, 30] })],
    groups: [new Group({ uid: 'group', pivot: [-2, 1, 0], rotation: [7, -23, 11], children: ['cube'] })], outliner: ['group'] });
  const node = project.getNode('cube'), group = project.getNode('group');
  if (kind === 'copy' || kind === 'stack') {
    const copy = addModifier(node, 'element_copy', {}, project);
    copy.nodes[0].position = [12, 0, -4];
    copy.nodes[0].rotation = [-10, 40, 20];
  }
  if (kind !== 'copy') addModifier(group, 'symmetry', {
    mode: kind === 'stack' ? 'axes' : kind, axes: { x: true, y: false, z: false }, copies: 3,
    anchor: { position: [0, 0, 0], rotation: [13, 22, 4] }, ignoreDuplicateCubes: false
  }, project);
  const instances = buildModifierRenderInstances(project);
  const instance = instances.find(entry => (kind === 'axes' || kind === 'mandala' || kind === 'stack' ? entry.reflected : true)
    && (kind === 'stack' ? entry.copyNodeUid : true));
  assert.ok(instance, `fixture has a ${kind} instance`);
  const state = { project, mode: 'edit', tool: 'move', selectedUid: 'cube', selectedUids: new Set(['cube']),
    selectedGenerated: generatedSelection({ uid: 'cube', instanceKey: instance.key, variantKey: instance.selectionKeys.cube[0] }),
    selectedCurveNodeIndex: null, selectedModifierUid: null, selectedModifierNodeUid: null,
    transformSpace: 'self', rotationMode: 'pose', multiTransformMode: 'unified', scaleHandleMode: 'bounds',
    modifierResultGhost: false, allowNegativeSize: true, zoom: 1, history: [], dirty: true, collapsedGroups: new Set(), outlinerRows: [] };
  const element = uiElement();
  const selected = () => project.getNode(state.selectedUid);
  const selectedElementUids = () => [...state.selectedUids].flatMap(uid => project.getNode(uid)?.type === 'group' ? project.getDescendantElementUids(uid) : [uid]);
  const selectedTopLevelNodes = () => [...state.selectedUids].map(uid => project.getNode(uid));
  const worldPoints = uid => project.getNode(uid)?.type === 'group'
    ? project.getDescendantElementUids(uid).flatMap(worldPoints)
    : sourceCubeEntries(project, project.getNode(uid)).flatMap(sourceWorldVertices);
  const center = uid => [0, 1, 2].map(axis => {
    const values = worldPoints(uid).map(point => point[axis]);
    return (Math.min(...values) + Math.max(...values)) / 2;
  });
  const viewport = { width: 900, height: 700 };
  const camera = { projection, yaw: .7, pitch: .4, panX: 0, panY: 0, zoom: 1, target: generatedPoint(instance, center('cube')) };
  const cameraFrame = buildCameraState(camera, 900 / 700, 900, 700);
  const renderer = Object.assign(Object.create(WebGLSceneRenderer.prototype), {
    mirrorCache: { project, instances }, lastCameraInput: { modifierResultGhost: false },
    projectPoint: point => projectScreenPoint(point, cameraFrame.matrix, 900, 700), getCameraFrame: () => cameraFrame,
    getScreenRay: (x, y) => screenRay(x, y, viewport, cameraFrame, camera),
    getSelectionBounds: () => ({ center: center(selected().uid) }), getGeometryCenter: (_project, uid) => center(uid),
    getSelectionProjectionExtent: (_project, _selection, origin, axis) => Math.max(...worldPoints(selected().uid).map(point =>
      Math.abs(point.reduce((sum, value, i) => sum + (value - origin[i]) * axis[i], 0)))),
    clearSelectionPreviewTransform: noop, beginTransformGhost: noop, endTransformGhost: noop, commitSelectionGeometry: noop,
    invalidateMirrorGeometry: noop, setSelectionPreviewTransform: () => { throw Error('generated drags use evaluated source transforms'); }
  });
  let context;
  const targets = createTransformTargets({ state, isShapeElement: shape, subdivisionOwner: () => null,
    getTransformPivot: item => context.getTransformPivot(item), getTransformAxes: item => context.getTransformAxes(item) });
  context = createTransformContext({ state, $: () => element, $$: () => [], sceneRenderer: renderer,
    deepestCommonSelectionGroup: () => group, isBezierElement: () => false, isShapeElement: shape, selected,
    selectedElementUids, selectedTopLevelNodes, subdivisionOwner: () => null });
  const gizmo = createGizmoController({ state, $: () => element, sceneCanvas: element, sceneRenderer: renderer, selected,
    isBezierElement: () => false, isShapeElement: shape, ...context, isEffectivelyLocked: () => false,
    selectedMirrorGuideGroup: () => null, finiteWorldGuideMarkup: () => '' });
  const interaction = createTransformInteraction({ state, $: () => element, sceneCanvas: element, sceneRenderer: renderer,
    selectionMarquee: { classList: { remove: noop } }, ...context, ...targets, intersectRayPlane: gizmo.intersectRayPlane,
    selected, selectedElementUids, isBezierElement: () => false, isShapeElement: shape, subdivisionOwner: () => null,
    snapValue: value => Math.round(value), snapShapeDimension: (_item, _key, value) => Math.round(value),
    snapAngle: (value, step) => Math.round(value / step) * step, getAngleSnapStep: () => 2.5,
    currentProjection: () => projection, viewportSelectionMode: () => 'replace',
    updateToolOptions: noop, renderScene: noop, renderInspector: noop, freezeCubeUvs: noop,
    syncInspectorValues: noop, invalidateSelectionRenderGeometry: noop,
    clearSelectionTransformContext: context.clearCache, formatSigned: value => String(value), markDirty: noop,
    snapshot: id => state.history.push(id), toast: noop, selectItem: (...args) => selection.selectItem(...args) });
  const selection = createSelectionController({ state, $$: () => [], outliner: element, inspector: element,
    inspectorController: {}, sceneRenderer: renderer, selected, renderOutlinerWindow: noop, renderOutliner: noop,
    invalidateSelectionRenderGeometry: noop, updateToolOptions: noop, renderInspector: noop, renderScene: noop,
    renderTextureUvOverlay: noop, updateSelectionLabels: noop, cancelKnifeSelection: noop });
  function start(tool, axis = 0, kind = tool === 'rotate' ? 'rotate' : 'axis', sign = 1) {
    state.tool = tool;
    context.clearCache();
    gizmo.updateTransformGizmo();
    const event = { button: 0, clientX: state.gizmoCenter.x + 40, clientY: state.gizmoCenter.y, pointerId: 1 };
    interaction.startTransformDrag(event, axis, element, kind, sign, null);
    return state.dragging;
  }
  return { project, node, group, state, instance, renderer, context, targets, gizmo, interaction, selection, element, start, center };
}

globalThis.document = { activeElement: null, getElementById: () => null };

for (const kind of ['axes', 'radial', 'mandala', 'copy', 'stack']) {
  test(`${kind}: virtual click selects the editable source; branch survives frame changes`, () => {
    const f = fixture(kind);
    f.state.selectedUid = null;
    f.state.selectedUids = new Set();
    const selected = f.state.selectedGenerated;
    f.state.dragging = { type: 'selection-box', generatedHit: { ...selected, generated: true,
      copyNodeUid: f.instance.copyNodeUid, copyOwnerUid: f.instance.copyOwnerUid, copyModifierUid: f.instance.copyModifierUid } };
    f.interaction.endPointerDrag({ type: 'pointerup', currentTarget: f.element });
    assert.equal(f.state.selectedUid, f.node.uid);
    assert.deepEqual([...f.state.selectedUids], [f.node.uid]);
    assert.equal(f.state.selectedModifierUid, null, 'surface clicks edit the source, while explicit copy-node controls remain separate');
    f.group.rotation = [28, 9, -3];
    f.node.pivot = [4, 1, 7];
    const instances = buildModifierRenderInstances(f.project);
    const next = findGeneratedInstance(instances, f.state.selectedGenerated);
    assert.ok(next, 'stable modifier/node path resolves the same branch after recomputing its affine matrix');
    assert.notEqual(next.key, selected.instanceKey);
    f.selection.selectItem(f.node.uid);
    assert.equal(f.state.selectedGenerated, null, 'selecting a source from the list returns to its own handles');
  });
  for (const projection of ['orthographic', 'perspective']) test(`${kind}/${projection}: gizmo frame and move/scale inputs map to the source`, () => {
    const f = fixture(kind, projection);
    const before = [...f.node.position];
    const drag = f.start('move');
    near(f.state.gizmoOrigin, generatedPoint(f.instance, f.center('cube')), 'handle origin follows the generated geometry');
    near(f.state.gizmoAxes[0].vector, generatedVector(f.instance, f.context.getTransformAxes(f.node)[0]), 'handle axes follow the generated orientation');
    const worldDelta = sourceVector(f.instance, drag.axis.vector.map(value => value * 3));
    const localDelta = f.targets.localDeltaFromWorld(drag.targets[0], worldDelta);
    const dx = drag.axis.screen[0] * 3 / drag.axis.worldPerPixel;
    const dy = -drag.axis.screen[1] * 3 / drag.axis.worldPerPixel;
    f.interaction.applyTransformDrag(drag, dx, dy, { clientX: dx, clientY: dy });
    near(f.node.position, before.map((value, axis) => value + localDelta[axis]), 'move writes the inverse-transformed delta to the source');
    assert.equal(f.project.elements.length, 1, 'editing a virtual result does not bake new elements');
    assert.equal(drag.batchPreview, false);
    f.state.dragging = null;
    const size = [...f.node.size];
    const scale = f.start('resize');
    f.interaction.applyTransformDrag(scale, scale.axis.screen[0] * 2 / scale.axis.worldPerPixel,
      -scale.axis.screen[1] * 2 / scale.axis.worldPerPixel, {});
    near(f.node.size, [size[0] + 2, size[1], size[2]], 'scale changes the corresponding source axis');
  });
  test(`${kind}: reflected rotation and precise angles follow the generated ring`, () => {
    for (const mode of ['euler', 'pose']) {
      const f = fixture(kind);
      f.state.rotationMode = mode;
      const initial = matrixMultiply(rotationMatrix(f.group.rotation), rotationMatrix(f.node.rotation));
      const drag = f.start('rotate');
      f.interaction.applyExactRotation(drag, 30);
      if (mode === 'euler') near(f.node.rotation, [15 + (f.instance.reflected ? -30 : 30), 20, 30], 'Euler angle maps back with correct handedness');
      else {
        const displayTurn = f.targets.rotationMatrixAroundAxis(drag.axis.vector, 30, [0, 0, 0]);
        const matrix = [0, 1, 2].map(row => [0, 1, 2].map(column => displayTurn[column * 4 + row]));
        nearMatrix(matrixMultiply(f.instance.matrix, matrixMultiply(rotationMatrix(f.group.rotation), rotationMatrix(f.node.rotation))),
          matrixMultiply(matrix, matrixMultiply(f.instance.matrix, initial)), 'pose rotation is conjugated through the instance');
      }
      f.node.rotation = [15, 20, 30];
      drag.rotationPlaneAxis = null;
      drag.gizmoCenter = { x: 0, y: 0 };
      drag.lastAngle = 0;
      drag.accumulatedAngle = 0;
      drag.rotationScreenSign = 1;
      f.interaction.applyTransformDrag(drag, 0, 0, { clientX: 50, clientY: Math.sqrt(3) * 50 });
      assert.equal(drag.feedbackDelta, 45, 'feedback keeps the visible drag direction rather than the reflected source sign');
      if (mode === 'euler') near(f.node.rotation, [15 + (f.instance.reflected ? -45 : 45), 20, 30], 'dragged Euler ring uses the same handedness as exact input');
    }
  });
  test(`${kind}: free moves, plane moves, pivot moves and negative resize handles use the same source frame`, () => {
    {
      const f = fixture(kind, 'perspective');
      const before = [...f.node.position];
      const drag = f.start('move', null, 'free');
      const displayTarget = drag.freeMoveStart.map((value, axis) => value + f.renderer.getCameraFrame().right[axis] * 3);
      const pointer = f.renderer.projectPoint(displayTarget);
      const worldDelta = sourceVector(f.instance, displayTarget.map((value, axis) => value - drag.freeMoveStart[axis]));
      const local = f.targets.localDeltaFromWorld(drag.targets[0], worldDelta);
      f.interaction.applyTransformDrag(drag, pointer.x - drag.x, pointer.y - drag.y, { clientX: pointer.x, clientY: pointer.y });
      near(f.node.position, before.map((value, axis) => Math.round(value + local[axis])), 'free movement maps the screen plane back to source space');
    }
    {
      const f = fixture(kind);
      f.state.tool = 'move';
      f.gizmo.updateTransformGizmo();
      const before = [...f.node.position];
      f.interaction.startTransformDrag({ button: 0, clientX: f.state.gizmoCenter.x, clientY: f.state.gizmoCenter.y },
        null, f.element, 'plane', 1, null, '0-1', [0, 1], [1, 1]);
      const drag = f.state.dragging;
      const delta = drag.planeAxes[0].worldAxis.map((value, axis) => value * 2 + drag.planeAxes[1].worldAxis[axis] * 3);
      const pointer = f.renderer.projectPoint(drag.planeDragStart.map((value, axis) => value + delta[axis]));
      const local = f.targets.localDeltaFromWorld(drag.targets[0], sourceVector(f.instance, delta));
      f.interaction.applyTransformDrag(drag, 0, 0, { clientX: pointer.x, clientY: pointer.y });
      near(f.node.position, before.map((value, axis) => value + local[axis]), 'plane handles map both axes back to the source');
    }
    {
      const f = fixture(kind);
      const before = sourceCubeEntries(f.project, f.node).flatMap(sourceWorldVertices);
      const drag = f.start('pivot');
      const expected = drag.pivot.map((value, axis) => value + drag.storedAxis[axis] * 2);
      f.interaction.applyTransformDrag(drag, drag.axis.screen[0] * 2 / drag.axis.worldPerPixel,
        -drag.axis.screen[1] * 2 / drag.axis.worldPerPixel, {});
      near(f.node.pivot, expected, 'pivot handle updates the source pivot');
      const after = sourceCubeEntries(f.project, f.node).flatMap(sourceWorldVertices);
      before.forEach((point, i) => near(after[i], point, 'pivot movement preserves source geometry'));
    }
    {
      const f = fixture(kind);
      const before = [...f.node.position], size = [...f.node.size];
      const drag = f.start('resize', 0, 'axis', -1);
      f.interaction.applyTransformDrag(drag, drag.axis.screen[0] * 2 / drag.axis.worldPerPixel,
        -drag.axis.screen[1] * 2 / drag.axis.worldPerPixel, {});
      near(f.node.size, [size[0] + 2, size[1], size[2]], 'negative handle changes the intended source size');
      near(f.node.position, before.map((value, axis) => value + drag.storedAxis[axis] * 2), 'negative-handle anchor compensation is inverse transformed');
    }
  });
}

test('group selections use the generated group frame, while ghost mode disables it', () => {
  const f = fixture('axes');
  const hit = f.state.selectedGenerated;
  f.selection.selectItem(f.group.uid, { generated: generatedSelection(hit, f.group.uid) });
  const drag = f.start('rotate');
  near(f.state.gizmoOrigin, generatedPoint(f.instance, f.context.getTransformPivot(f.group)), 'group pivot is transformed to the selected result');
  assert.ok(drag.generatedFrame);
  f.state.dragging = null;
  f.state.modifierResultGhost = true;
  assert.equal(f.start('move').generatedFrame, null, 'ghost results cannot supply editing frames');
});

test('opening a generated context menu preserves a multi-selection of source elements', () => {
  const f = fixture('axes');
  f.state.selectedUids = new Set([f.node.uid, f.group.uid]);
  f.selection.selectItem(f.node.uid, { preserveSelection: true, generated: f.state.selectedGenerated });
  assert.deepEqual([...f.state.selectedUids], [f.node.uid, f.group.uid]);
  assert.equal(f.state.selectedGenerated.uid, f.node.uid);
});

test('toolbox shows exactly one center scale handle and hides it for instant-action categories', () => {
  for (const projection of ['orthographic', 'perspective']) {
    const f = fixture('axes', projection);
    f.state.tool = 'toolbox'; f.state.toolboxCategory = 'scale';
    f.gizmo.updateTransformGizmo();
    assert.equal((f.element.innerHTML.match(/class="gizmo-control /g) || []).length, 1);
    assert.ok(f.element.innerHTML.includes('data-kind="toolbox-scale"'));
    assert.deepEqual(f.state.gizmoAxes, []);
    for (const category of ['flip', 'rotate', 'center']) {
      f.state.toolboxCategory = category; f.gizmo.updateTransformGizmo();
      assert.ok(f.element.hasAttribute('hidden'));
    }
  }
});

test('inverted outline remains limited to the selected virtual branch and respects deduplicated cube ranges', () => {
  const f = fixture('axes');
  const draws = [];
  Object.assign(f.renderer, {
    selectionOutline: [.2, .4, .7], gl: { LINES: 1 }, staticWireBuffer: 'static', selectedWireBuffer: 'selected',
    staticCache: {}, selectedCache: { edgeRanges: new Map([['cube', { start: 1, count: 24 }]]),
      cubeEdgeRanges: new Map([['cube', [{ start: 5, count: 12 }]]]) },
    drawBuffer: (...args) => draws.push(args)
  });
  f.instance.cubeIndices.cube = [0];
  f.renderer.drawGeneratedSelection(f.state.selectedGenerated, []);
  assert.equal(draws.length, 1);
  assert.equal(draws[0][1], 12);
  near(draws[0][4].colorOverride, [.8, .6, .3, 1], 'outline keeps inverted theme colors');
  f.renderer.lastCameraInput.modifierResultGhost = true;
  f.renderer.drawGeneratedSelection(f.state.selectedGenerated, []);
  assert.equal(draws.length, 1);
});
