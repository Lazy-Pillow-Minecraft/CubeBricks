import assert from 'node:assert/strict';
import { RecentModelHistory } from '../src/project/recent-model-history.js';
import { OrderedFaceMesh } from '../src/render/ordered-face-mesh.js';
import { CubeOverlapIndex } from '../src/model/cube-overlap-index.js';
import { LayerRasterRegions } from '../src/common/utils/layer-raster-regions.js';
import { Cube, Group, CubeBricksProject, addModifier } from '../src/model.js';
import { canPreviewRigidGroup } from '../src/editor/rigid-transform-preview.js';
import { createTransformInteraction } from '../src/editor/transform-interaction.js';
import { AppLanguage, translateUiKey } from '../src/common/config/app-config.js';

const data = x => ({ name: 'test', elements: [{ uid: 'cube', position: [x, 0, 0] }], groups: [], outliner: ['cube'], meta: { modifiedAt: String(x) } });
const text = x => JSON.stringify(data(x));
const history = new RecentModelHistory(text(0), []);
history.push(text(1), [], 'core.element.move');
history.push(text(2), [], 'core.element.rotate');
const snapshotData = x => ({ ...data(x), textures: [], textureGroups: [] });
assert.deepEqual(history.navigate('undo').data, snapshotData(1));
assert.deepEqual(history.navigate('undo').data, snapshotData(0));
assert.equal(history.navigate('undo'), null);
assert.deepEqual(history.navigate('redo').data, snapshotData(1));
history.push(text(3), [], 'core.element.property');
assert.equal(history.navigate('redo'), null, 'editing the preview forks from its visible head');
assert.equal(history.navigate('undo'), null, 'a new fork cannot preview an ancestor that retention may have pruned');
history.push(text(4), [], 'core.element.move');
const preview = history.navigate('undo');
assert.deepEqual(preview.changedUids, ['cube']);
preview.data.elements[0].position[0] = 99;
assert.equal(preview.matches(snapshotData(3)), true);
assert.equal(preview.matches(snapshotData(2)), false, 'disk result must agree with the preview');
history.navigate('redo');
history.push(text(4), [{ source: 'different texture' }], 'core.element.property');
assert.equal(history.navigate('undo').textureChanged, true, 'texture transactions keep exact local snapshots');
history.navigate('redo');
history.push(text(5), [{ source: 'different texture' }], 'core.texture.layer');
assert.equal(history.navigate('undo').data.elements[0].position[0], 4, 'every operation family uses the local history');
history.navigate('redo');
history.countLimit = 1; history.trim();
history.push(text(6), [{ source: 'different texture' }], 'core.element.move');
assert.equal(history.navigate('undo'), null, 'retention limit also bounds the local preview');
assert.equal(new RecentModelHistory(text(0), [], { byteLimit: 1 }).entries.length, 0);
const curveProject = new CubeBricksProject({ elements: [{ type: 'bezier3d', uid: 'curve', nodes: [
  { uid: 'start', position: [0, 0, 0], autoTangent: false, handleIn: [-2, 0, 0], handleOut: [2, 0, 0] },
  { uid: 'end', position: [0, 8, 0], autoTangent: false, handleIn: [-2, 0, 0], handleOut: [2, 0, 0] }
] }] });
const curveHistory = new RecentModelHistory(curveProject.serialize(), []);
curveProject.elements[0].nodes[0].handleOut[0] = 7;
curveHistory.push(curveProject.serialize(), [], 'core.element.property');
const curvePreview = curveHistory.navigate('undo'), immutable = JSON.stringify(curvePreview.data);
const restored = new CubeBricksProject(curvePreview.data);
restored.elements[0].nodes[0].handleOut[0] = 99;
assert.equal(JSON.stringify(curvePreview.data), immutable, 'restoring and editing never mutate cached node/handle snapshots');

const calls = [], gl = { ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2, STATIC_DRAW: 3, DYNAMIC_DRAW: 4,
  UNSIGNED_SHORT: 5, UNSIGNED_INT: 6, createBuffer: () => ({}), bindBuffer() {},
  bufferData: (target, bytes) => calls.push(['data', target, bytes]),
  bufferSubData: (target, offset, values) => calls.push(['sub', target, [...values]]) };
const faces = [1, 2].map(value => ({ vertices: Array(72).fill(value) }));
const mesh = new OrderedFaceMesh(gl, {}, true);
assert.equal(mesh.update(faces, false).type, gl.UNSIGNED_SHORT);
calls.length = 0; mesh.update([...faces].reverse(), true);
assert.deepEqual(calls, [['sub', gl.ELEMENT_ARRAY_BUFFER, [6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5]]],
  'sorting changes only indices and preserves each complete triangle');
const big = [{ vertices: new Float32Array(65538 * 12) }];
assert.equal(new OrderedFaceMesh(gl, {}, false).update(big, false), null, 'WebGL without 32-bit indices keeps a safe fallback');
assert.equal(mesh.update(big, false).type, gl.UNSIGNED_INT);

const source = (points, size = [1, 1, 1]) => ({ points, cube: { size } });
const bounds = Array.from({ length: 8 }, (_, i) => [i & 1, i >> 1 & 1, i >> 2 & 1]);
const overlap = new CubeOverlapIndex(entry => entry.points), first = source(bounds);
overlap.add(overlap.key(first));
assert.equal(overlap.has(overlap.key(source([...bounds].reverse()))), true, 'winding does not affect duplicates');
assert.equal(overlap.has(overlap.key(source(bounds, [-1, 1, 1]))), false, 'negative geometry remains distinct');
assert.equal(overlap.has(overlap.key(source(bounds.map((point, index) => index === 0 ? [.2, .2, .2] : point)))), false,
  'equal bounds still require all eight vertices to match');
for (const matrix of [[[0, -1, 0], [1, 0, 0], [0, 0, -1]], [[1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[Math.cos(.3), 0, Math.sin(.3)], [0, 1, 0], [-Math.sin(.3), 0, Math.cos(.3)]]]) {
  const affine = { matrix, translation: [1.000005, -3.000005, .000005] };
  for (let iteration = 0; iteration < 30; iteration++) {
    const points = bounds.map(point => point.map((value, axis) => (value + iteration) * (axis + 1) / 7));
    const transformed = points.map(point => matrix.map((row, axis) => row.reduce((sum, value, col) => sum + value * point[col], affine.translation[axis])));
    const indexed = new CubeOverlapIndex(entry => entry.points);
    indexed.add(indexed.key(source(transformed)));
    assert.equal(indexed.has(indexed.key(source(points), affine)), true,
      'axis-permutation bounds and general rotations agree with exact transformed vertices');
  }
}

let reads = 0;
const pixels = new Uint8ClampedArray(8 * 8 * 4);
for (let i = 0; i < pixels.length; i++) pixels[i] = i % 255;
const raster = { width: 8, height: 8, getContext: () => ({
  createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
  getImageData: (x, y, width, height) => {
    reads++; const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) data.set(pixels.subarray(((row + y) * 8 + x) * 4, ((row + y) * 8 + x + width) * 4), row * width * 4);
    return { width, height, data };
  }
}) };
const regions = new LayerRasterRegions({ blockSize: 4, byteLimit: 128,
  readBlock: (source, ...args) => source.getContext('2d').getImageData(...args) }), region = { x: 3, y: 2, width: 2, height: 3 };
const result = regions.read(raster, region);
assert.ok(regions.bytes <= 128);
for (let y = 0; y < 3; y++) assert.deepEqual(result.data.slice(y * 8, (y + 1) * 8), pixels.slice(((y + 2) * 8 + 3) * 4, ((y + 2) * 8 + 5) * 4));
const small = { x: 0, y: 0, width: 1, height: 1 };
regions.read(raster, small); const before = reads; regions.read(raster, small);
assert.equal(reads, before, 'unchanged pixels reuse the decoded block');
pixels[0] = 231; regions.invalidate(raster, small);
assert.equal(regions.read(raster, small).data[0], 231, 'a live brush update invalidates its block immediately');
regions.invalidate(raster); assert.equal(regions.bytes, 0);

const cube = new Cube(), group = new Group({ children: [cube.uid] });
const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [cube], groups: [group], outliner: [group.uid] });
assert.equal(canPreviewRigidGroup(project, project.groups[0]), true);
project.renderType = 'translucent';
assert.equal(canPreviewRigidGroup(project, project.groups[0]), false, 'transparent groups retain their global face order');
project.renderType = 'cutout';
addModifier(project.elements[0], 'element_copy');
assert.equal(canPreviewRigidGroup(project, project.groups[0]), false, 'child modifier frames retain the evaluated path');
project.elements[0].modifiers = []; project.formatId = 'java_block_item';
assert.equal(canPreviewRigidGroup(project, project.groups[0]), false, 'constrained formats retain their bounds checks');

const movingProject = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [cube], groups: [group], outliner: [group.uid] });
const movingGroup = movingProject.groups[0]; movingProject.elements[0].modifiers = [];
const movingState = { project: movingProject, mode: 'edit', tool: 'move', dirty: true,
  zoom: 1, transformSpace: 'global', gizmoOrigin: [...movingGroup.pivot], gizmoCenter: { x: 0, y: 0 },
  gizmoAxes: [{ vector: [1, 0, 0], screen: [1, 0], screenPerWorld: [1, 0], worldPerPixel: 1, centerX: 0, centerY: 0 }] };
const element = { style: {}, classList: { add() {} }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
let matrix = null, invalidations = 0;
const selection = { nodes: [movingGroup], multiple: false, pivot: [...movingGroup.pivot], center: [0, 4, 0] };
const interaction = createTransformInteraction({ state: movingState, $: () => element, sceneCanvas: element,
  activeModifierAnchorContext: () => null, activeCurveNodeContext: () => null,
  getSelectionTransformContext: () => selection, selected: () => movingGroup, subdivisionOwner: () => null,
  captureTransformTarget: node => ({ node, worldAnchor: [...node.pivot], initialPivot: [...node.pivot] }),
  captureModifierAnchors: () => [], captureGroupMembers: () => [],
  sceneRenderer: { clearSelectionPreviewTransform() { matrix = null; }, beginTransformGhost() {},
    setSelectionPreviewTransform(value) { matrix = value; }, getCameraFrame: () => ({ forward: [0, 0, 1], worldPerPixel: 1 }) },
  snapValue: value => value, translationMatrix: delta => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...delta, 1],
  localDeltaFromWorld: (_target, delta) => delta,
  translateCapturedTarget: (target, delta) => { target.node.pivot = target.initialPivot.map((value, axis) => value + delta[axis]); },
  currentProjection: () => 'orthographic', formatSigned: String,
  invalidateSelectionRenderGeometry() { invalidations++; }, syncInspectorValues() {} });
interaction.startTransformDrag({ button: 0, clientX: 0, clientY: 0 }, 0, element, 'axis');
const movingDrag = movingState.dragging, oldPivot = [...movingGroup.pivot];
assert.equal(movingDrag.batchPreview, true);
movingDrag.pendingTransform = { dx: 4, dy: 0, event: { clientX: 4, clientY: 0 } };
interaction.applyPendingTransform(movingDrag);
assert.deepEqual(movingGroup.pivot, oldPivot, 'drag preview does not rewrite the group or its mesh');
assert.deepEqual(matrix.slice(12, 15), [4, 0, 0]);
assert.equal(invalidations, 0);
interaction.commitBatchTransform(movingDrag);
assert.deepEqual(movingGroup.pivot, oldPivot.map((value, axis) => value + (axis === 0 ? 4 : 0)));
assert.equal(matrix, null); assert.equal(invalidations, 1, 'release commits the group once');
assert.match(translateUiKey('ui.project-history-preview-mismatch', AppLanguage.SIMPLIFIED_CHINESE), /最近操作缓存与工作记录不一致/);
assert.match(translateUiKey('ui.project-history-preview-write-blocked', AppLanguage.ENGLISH), /Working history/);
console.log('Optimization cache and fallback tests passed.');
