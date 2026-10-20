import assert from 'node:assert/strict';
import { findVertexSnapIntersections } from '../src/common/core/vertex-intersections.js';
import { WebGLSceneRenderer } from '../src/render/webgl-renderer.js';

const cube = (from, to) => [
  [from[0], from[1], from[2]], [to[0], from[1], from[2]], [to[0], to[1], from[2]], [from[0], to[1], from[2]],
  [from[0], from[1], to[2]], [to[0], from[1], to[2]], [to[0], to[1], to[2]], [from[0], to[1], to[2]]
];
const source = cube([0, 0, 0], [2, 2, 2]);
const face = [[1, -.2, -.2], [1, .2, -.2], [1, -.2, .2], [1, .2, .2]];

assert.deepEqual(findVertexSnapIntersections([source], [], [face]), [[1, 0, 0]],
  'a source edge crossing a bounded face creates one world-space snap point');
const obliqueHits = findVertexSnapIntersections([source], [], [
  [[1, -.2, -.2], [1.2, .2, -.2], [1, -.2, .2], [1.2, .2, .2]]
]);
assert.equal(obliqueHits.length, 1, 'an oblique face has one real crossing');
assert.ok(obliqueHits[0].every((value, axis) => Math.abs(value - [1.1, 0, 0][axis]) < 1e-9),
  'an oblique face is intersected in its own plane, not screen space');
assert.deepEqual(findVertexSnapIntersections([source], [], [face.map(point => [point[0], point[1] + 5, point[2]])]), [],
  'crossing the infinite plane outside the actual quad does not count');
assert.deepEqual(findVertexSnapIntersections([source], [cube([1, -1, 0], [1, 1, 0])], []), [[1, 0, 0]],
  'two actual 3D line segments crossing create one point');
assert.deepEqual(findVertexSnapIntersections([source], [cube([1, -1, 5], [1, 1, 5])], []), [],
  'lines crossing only in screen projection do not count');
assert.deepEqual(findVertexSnapIntersections([source], [cube([1, -1, 0], [1, 1, 0])], [face]), [[1, 0, 0]],
  'line-line and line-face hits at the same position share one marker');
assert.deepEqual(findVertexSnapIntersections([source], [], [[[0, -.2, -.2], [0, .2, -.2], [0, -.2, .2], [0, .2, .2]]]), [],
  'an existing source vertex is not relabelled as a new intersection');

const nodes = new Map([['group', { uid: 'group', type: 'group', visible: true }],
  ['source', { uid: 'source', type: 'cube', visible: true }], ['target', { uid: 'target', type: 'cube', visible: true }]]);
const project = {
  getNode: uid => nodes.get(uid),
  getGroupChain: () => [],
  getDescendantElementUids: uid => uid === 'group' ? ['source'] : []
};
const rendererState = {
  staticCache: {
    cubePoints: new Map([['source', [source]], ['target', [cube([1, -1, 0], [1, 1, 0])]]]),
    faces: [{ uid: 'source', quad: face }, { uid: 'target', quad: face }]
  },
  selectedCache: { cubePoints: new Map([['source', [source]]]), faces: [{ uid: 'source', quad: face }] },
  mirrorCache: { instances: [] },
  lastCameraInput: { modifierResultGhost: false }
};
const grouped = WebGLSceneRenderer.prototype.getVertexSnapIntersectionGeometry.call(rendererState, project, 'group');
assert.equal(grouped.sourceCubes.length, 1, 'the selected group contributes its child geometry once');
assert.equal(grouped.targetCubes.length, 1, 'surrounding elements remain targets');
assert.equal(grouped.targetQuads.length, 1, 'the selected group faces cannot intersect themselves');

console.log('Vertex intersection tests passed.');
