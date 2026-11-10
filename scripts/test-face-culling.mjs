import assert from 'node:assert/strict';
import { WebGLSceneRenderer, buildFaceBvh } from '../src/render/webgl-renderer.js';
import { faceAcceptsCameraInteraction } from '../src/render/face-culling.js';
import { createUvPreviewElement } from '../src/texture/culled-face-preview.js';
import { Cube } from '../src/model.js';

const face = (uid, z, front = true) => ({
  uid, faceName: 'north', cube: { faces: { north: {} } },
  quad: (front ? [[-1, 1], [1, 1], [-1, -1], [1, -1]]
    : [[1, 1], [-1, 1], [1, -1], [-1, -1]]).map(([x, y]) => [x, y, z])
});
const near = face('near-back', .5, false), far = face('far-front', 0);
const probe = (projection, selected = false) => {
  const renderer = Object.create(WebGLSceneRenderer.prototype);
  Object.assign(renderer, {
    lastCameraState: { projection, eye: [0, 0, 10], forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] },
    lastCameraInput: { zoom: 1 }, lastViewport: { width: 200, height: 200 },
    lastViewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    lastHelperPoints: new Map(), lastOwnerPoints: new Map(), lastLockedUids: new Set(), lastNodeByUid: new Map(),
    staticCache: { faces: selected ? [far] : [near, far], faceBvh: buildFaceBvh(selected ? [far] : [near, far]) },
    selectedCache: {
      ownerPoints: new Map(selected ? [[near.uid, []]] : []), faces: selected ? [near] : [],
      faceBvh: buildFaceBvh(selected ? [near] : [])
    },
    mirrorCache: { instances: [] }, paintExplodeOffsets: new Map()
  });
  return renderer;
};
const project = { formatId: 'generic_model', cullFaces: false, getNode: () => ({ type: 'cube' }) };
for (const projection of ['orthographic', 'perspective']) for (const selected of [false, true]) {
  const renderer = probe(projection, selected);
  project.cullFaces = false;
  project.formatId = 'generic_model';
  assert.equal(renderer.pickDetailed(project, 100, 100, true).uid, near.uid);
  project.cullFaces = true;
  assert.equal(renderer.pickDetailed(project, 100, 100, true).uid, far.uid,
    `${projection}: a discarded backface must not block a visible face`);
  assert.deepEqual(renderer.pickCoincident(project, 100, 100, true, true).map(hit => hit.uid), [far.uid],
    'paint and transparent-pixel sampling share the same culling policy');
  assert.deepEqual(renderer.selectInScreenRect(project, { x1: 0, y1: 0, x2: 200, y2: 200 }, true), [far.uid]);
  project.cullFaces = false;
  project.formatId = 'java_block_item';
  assert.equal(renderer.pickDetailed(project, 100, 100, true).uid, far.uid, 'Java always enforces backface culling');
  project.formatId = 'generic_model';
  for (const culled of [null, { enabled: false }, { texture: null }]) {
    near.cube.faces.north = culled;
    assert.equal(renderer.pickDetailed(project, 100, 100, true).uid, far.uid,
      'a changed explicit cull is ignored even before the BVH is rebuilt');
  }
  near.cube.faces.north = {};
  project.cullFaces = true;
  renderer.mirrorCache.instances.push({
    key: 'reflection', sourceUids: [near.uid], sourceUidSet: new Set([near.uid]),
    matrix: [[1, 0, 0], [0, 1, 0], [0, 0, -1]], translation: [0, 0, 1], reflected: true
  });
  const generated = renderer.pickDetailed(project, 100, 100, true, { includeGenerated: true });
  assert.equal(generated.generated, true, 'reflections use their corrected rendered winding');
  assert.equal(generated.uid, near.uid);
  assert.ok(renderer.pickCoincident(project, 100, 100, true, true, true).some(hit => hit.generated));
}
assert.equal(faceAcceptsCameraInteraction(near, project, { projection: 'perspective', eye: [0, 0, -10] }), true);

const cube = new Cube({
  faces: {
    north: { texture: null, uv: [4, 8, 0, 0], rotation: 90 },
    south: { texture: 'texture-a', uv: [0, 0, 4, 4] }, east: null, west: { enabled: false }
  }
});
const original = structuredClone(cube.faces);
for (const source of [cube, { type: 'bezier3d', toCubes: () => [cube] }]) {
  const preview = createUvPreviewElement(source);
  assert.equal(preview.hasCulledFaces, true);
  const generated = source === cube ? preview.element : preview.element.toCubes()[0];
  for (const name of ['north', 'east', 'west']) {
    assert.deepEqual(generated.faces[name], { enabled: true, _uvPreviewCulled: true },
      'preview placeholders carry no texture or UV orientation');
  }
  assert.deepEqual(generated.faces.south, cube.faces.south, 'ordinary faces retain their texture');
}
assert.deepEqual(cube.faces, original, 'preview generation never restores or modifies source geometry');
console.log('Face culling interaction and UV preview isolation passed.');
