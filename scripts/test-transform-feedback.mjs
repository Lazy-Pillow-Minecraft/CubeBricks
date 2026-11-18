import assert from 'node:assert/strict';
import { Cube, CubeBricksProject } from '../src/model.js';
import { createTransformInteraction } from '../src/editor/transform-interaction.js';
import { transformFeedback, signedDragDistance } from '../src/editor/transform-feedback.js';

const formatSigned = value => `${value > 0 ? '+' : ''}${Number(value.toFixed(4))}`;
const options = { formatSigned };
assert.equal(signedDragDistance([-2, 0, 0]), -2);
assert.equal(signedDragDistance([0, 0, 0]), 0);
assert.equal(signedDragDistance([3, 4]), 5);
assert.equal(signedDragDistance([-4, 3]), -5);
for (const tool of ['move', 'pivot', 'resize', 'rotate']) {
  const edit = { tool, feedbackDelta: -2.5, get item() { throw Error('feedback must not inspect model geometry'); } };
  assert.equal(transformFeedback(edit, options), tool === 'rotate' ? '-2.5°' : '-2.5 px');
}

// Exercise the real transform path, including post-constraint feedback and
// rigid previews, so the display change cannot silently change the geometry.
const model = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [new Cube({ uid: 'cube',
  position: [10, 20, 30], size: [2, 4, 6], pivot: [8, 9, 10], rotation: [10, 20, 30] })], outliner: ['cube'] });
const node = model.getNode('cube');
const state = { project: model, dirty: true, zoom: 1, transformSpace: 'self', allowNegativeSize: false };
const ui = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
const interaction = createTransformInteraction({ state, $: () => ui, formatSigned,
  currentProjection: () => 'orthographic', snapValue: Math.round,
  snapAngle: (value, step) => Math.round(value / step) * step, getAngleSnapStep: () => 2.5,
  invalidateSelectionRenderGeometry() {}, syncInspectorValues() {}, translateModifierAnchorsFromSnapshot() {},
  isShapeElement: item => item.type === 'shape', sceneRenderer: { setSelectionPreviewTransform() {} },
  rotationMatrixAroundAxis: () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
});
function drag(tool, extra = {}) {
  return { item: node, tool, kind: 'axis', sign: 1, axisIndex: 0, targets: [{ node }],
    axis: { screen: [1, 0, 0], vector: [1, 0, 0], worldPerPixel: 1 }, storedAxis: [1, 0, 0],
    position: [10, 20, 30], size: [2, 4, 6], pivot: [8, 9, 10], rotation: [10, 20, 30],
    rect: { height: 600 }, selectionContext: { multiple: false }, ...extra };
}
function apply(edit, dx, dy = 0, event = { clientX: dx, clientY: dy }) {
  edit.pendingTransform = { dx, dy, event };
  interaction.applyPendingTransform(edit);
  return edit.tooltipText;
}
const resize = drag('resize');
assert.equal(apply(resize, 3), '+3 px');
assert.deepEqual(node.size, [5, 4, 6]);
assert.equal(apply(resize, -50), '-50 px', 'show drag amount rather than clamped geometry changes');
assert.deepEqual(node.size, [0, 4, 6]);
assert.equal(apply(resize, 3, 0, { clientX: 3, clientY: 0, altKey: true }), '+3 px', 'symmetric resizing still reports one handle distance');
assert.deepEqual(node.size, [8, 4, 6]);
const move = drag('move');
assert.equal(apply(move, -3), '-3 px');
assert.deepEqual(node.position, [7, 20, 30]);
assert.equal(apply(drag('move', { storedAxis: [.6, .8, 0] }), 5), '+5 px');
assert.deepEqual(node.position, [13, 24, 30], 'rotated-axis movement is still distributed into the model coordinates');
const rotation = () => drag('rotate', { kind: 'rotate', gizmoCenter: { x: 0, y: 0 },
  lastAngle: 0, accumulatedAngle: 0, rotationScreenSign: 1, rotationMode: 'euler', rotationAxis: [1, 0, 0] });
const event = { clientX: Math.cos(Math.PI / 6) * 100, clientY: Math.sin(Math.PI / 6) * 100 };
assert.equal(apply(rotation(), 0, 0, event), '+22.5°');
assert.deepEqual(node.rotation, [32.5, 20, 30]);
const preview = rotation();
preview.batchPreview = true;
preview.selectionContext.pivot = [0, 0, 0];
assert.equal(apply(preview, 0, 0, event), '+22.5°', 'rigid group previews still show an angle');
assert.deepEqual(node.rotation, [32.5, 20, 30], 'preview leaves model geometry untouched');
const rollNode = { roll: 90 };
const roll = rotation();
roll.axisIndex = 2;
roll.nodeRoll = 90;
roll.curveNodeContext = { curve: { dimension: 3 }, node: rollNode };
assert.equal(apply(roll, 0, 0, event), '+22.5°');
assert.equal(rollNode.roll, 112.5);
assert.equal(apply(drag('rotate', { axis: null, kind: 'free' }), 20, 10), '+7.5°');
console.log('Transform feedback reports one signed handle amount independently of object coordinates, clamping and symmetric scaling.');
