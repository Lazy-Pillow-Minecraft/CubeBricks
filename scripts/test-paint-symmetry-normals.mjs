import assert from 'node:assert/strict';
import { createPaintSymmetryController, paintSymmetryRelationCache } from '../src/paint/symmetry-relations.js';

const UV_SLOTS = [[0, 0], [1, 0], [0, 1], [1, 1]];
const FACE_EDGES = [[0, 1], [1, 3], [2, 3], [0, 2]];
const FRAME = { origin: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };

function relationsForFaces(faces, uid, { mode = 'axes', angles = [] } = {}) {
  const operator = { uid, type: 'paint_symmetry', enabled: true, mode, axes: { x: true } };
  const owner = { uid: `${uid}-group`, type: 'group', operators: [operator] };
  const cubes = new Map(faces.map(face => [face.uid, { uid: face.uid, type: 'cube', faces: {} }]));
  const state = {
    project: {
      groups: [owner], elements: [...cubes.values()],
      getDescendantElementUids: () => [...cubes.keys()], getNode: key => cubes.get(key) || owner
    }
  };
  const controller = createPaintSymmetryController({
    state,
    sceneRenderer: {
      getFaceQuadsForUids: wanted => faces.filter(face => wanted.has(face.uid)),
      paintExplodeOffsets: new Map()
    },
    faceUvPixelSlots: () => UV_SLOTS,
    symmetryModifierAngles: () => angles, mirrorControllerWorldFrame: () => FRAME,
    barycentricPoint: () => [1, 0, 0], renderInspector() {}, PAINT_FACE_EDGES: FACE_EDGES
  });
  const source = faces[0];
  const hit = { ...source, cube: cubes.get(source.uid), point: source.facePoints[0], modelPoint: source.facePoints[0] };
  const result = controller.paintSymmetryRelatedHits(hit);
  paintSymmetryRelationCache.delete(uid);
  return result;
}

const source = {
  uid: 'source', cubeUid: 'source', faceName: 'east',
  facePoints: [[1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]]
};
const matching = {
  uid: 'matching', cubeUid: 'matching', faceName: 'west',
  facePoints: [[-1, 0, 1], [-1, 0, 0], [-1, 1, 1], [-1, 1, 0]]
};
const backwards = {
  uid: 'backwards', cubeUid: 'backwards', faceName: 'east',
  facePoints: [[-1, 0, 0], [-1, 0, 1], [-1, 1, 0], [-1, 1, 1]]
};
assert.deepEqual(relationsForFaces([source, matching, backwards], 'normal-candidates').map(hit => hit.uid),
  ['source', 'matching'], 'a coincident back face must not receive the mirrored paint stroke');

const onPlane = {
  uid: 'on-plane', cubeUid: 'on-plane', faceName: 'up',
  facePoints: [[-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]]
};
assert.equal(relationsForFaces([onPlane], 'normal-in-face').length, 2,
  'reflection within one face still paints both sides of that face');
assert.equal(relationsForFaces([onPlane], 'normal-radial', { mode: 'radial', angles: [0, 90, 180, 270] }).length, 4,
  'radial copies of a centered face map back onto the same face');
assert.equal(relationsForFaces([onPlane], 'normal-mandala', { mode: 'mandala', angles: [0, 90, 180, 270] }).length, 8,
  'mandala rotations and reflections can all map onto the source face');

console.log('Paint symmetry face normal tests passed.');
