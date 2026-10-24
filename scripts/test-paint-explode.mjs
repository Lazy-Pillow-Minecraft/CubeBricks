import assert from 'node:assert/strict';
import { buildPaintExplodeOffsets, applyPaintExplodeOffsets } from '../src/render/paint-explode.js';

const project = {
  outliner: ['left', 'middle', 'right'],
  groups: [
    { uid: 'left', children: ['a'] },
    { uid: 'middle', children: ['b'] },
    { uid: 'right', children: ['c'] }
  ]
};
const corners = new Map([
  ['a', [[-2, 0, 0], [0, 1, 1]]],
  ['b', [[-1, 0, 0], [1, 1, 1]]],
  ['c', [[0, 0, 0], [2, 1, 1]]]
]);
const offsets = buildPaintExplodeOffsets(project, corners, 2);
const interval = uid => [corners.get(uid)[0][0] + (offsets.get(uid)?.[0] || 0),
  corners.get(uid)[1][0] + (offsets.get(uid)?.[0] || 0)];
assert.ok(interval('a')[1] + 2 <= interval('b')[0]);
assert.ok(interval('b')[1] + 2 <= interval('c')[0]);
assert.equal((interval('a')[0] + interval('c')[1]) / 2, 0);
assert.equal(offsets.get('a')[0], -offsets.get('c')[0]);

const nested = {
  outliner: ['outer-left', 'outer-right'],
  groups: [
    { uid: 'outer-left', children: ['inner-left', 'inner-right'] },
    { uid: 'inner-left', children: ['d'] },
    { uid: 'inner-right', children: ['e'] },
    { uid: 'outer-right', children: ['f'] }
  ]
};
const nestedCorners = new Map([
  ['d', [[0, 0, 0], [2, 2, 2]]],
  ['e', [[0, 0, 0], [2, 2, 2]]],
  ['f', [[0, 0, 0], [2, 2, 2]]]
]);
const nestedOffsets = buildPaintExplodeOffsets(nested, nestedCorners, 2);
const nestedInterval = uid => [0 + (nestedOffsets.get(uid)?.[0] || 0),
  2 + (nestedOffsets.get(uid)?.[0] || 0)];
const left = [nestedInterval('d')[0], nestedInterval('e')[1]];
const right = nestedInterval('f');
assert.ok(nestedInterval('d')[1] + 2 <= nestedInterval('e')[0]);
assert.ok(left[1] + 2 <= right[0]);

const zMirrors = new Map([
  ['a', [[-1, 0, -2], [1, 2, 0]]],
  ['c', [[-1, 0, 0], [1, 2, 2]]]
]);
const zOffsets = buildPaintExplodeOffsets({ outliner: ['left', 'right'], groups: [
  { uid: 'left', children: ['a'] }, { uid: 'right', children: ['c'] }
] }, zMirrors, 2);
assert.equal(zOffsets.get('a')[0], 0);
assert.equal(zOffsets.get('c')[0], 0);
assert.equal(zOffsets.get('a')[2], -zOffsets.get('c')[2]);
assert.ok(zMirrors.get('a')[1][2] + zOffsets.get('a')[2] + 2
  <= zMirrors.get('c')[0][2] + zOffsets.get('c')[2]);

const quad = [[-2, 0, 0], [0, 0, 0], [-2, 1, 0], [0, 1, 0]];
const geometry = {
  triangles: [-2, ...Array(11).fill(0)], edges: [-2, ...Array(11).fill(0)], helpers: [],
  triangleRanges: new Map([['a', { start: 0, count: 1 }]]),
  edgeRanges: new Map([['a', { start: 0, count: 1 }]]), helperRanges: new Map(),
  ownerPoints: new Map([['a', quad]]),
  faces: [{ uid: 'a', quad, center: [-1, .5, 0] }]
};
applyPaintExplodeOffsets(geometry, offsets);
assert.equal(geometry.faces[0].modelQuad[0][0], -2);
assert.equal(geometry.faces[0].quad[0][0], -2 + offsets.get('a')[0]);
assert.equal(geometry.triangles[0], -2 + offsets.get('a')[0]);
assert.equal(geometry.faces[0].center[0], -1 + offsets.get('a')[0]);
console.log('Paint explode layout and original-coordinate preservation passed.');
