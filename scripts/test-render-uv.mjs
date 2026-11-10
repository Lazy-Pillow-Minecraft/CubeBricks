import assert from 'node:assert/strict';
import { normalizeTextureLayers } from '../src/common/core/texture-features.js';
import { createMirrorGuideController } from '../src/screen/mirror-guides.js';
import { facesRemainDepthSorted, sortFacesByDepth } from '../src/render/face-order.js';
import {
  createSignedCubeCorners,
  buildFaceBvh,
  cubeLifetimeScale,
  scaleAroundPoint,
  createAtlasFaceUvs,
  createBlockbenchFaceUvSlots,
  createBlockbenchFaceUvs,
  getBlockbenchBoxUv,
  getCubeFaceDisplayColor,
  getEffectiveInflate,
  getMinecraftRenderType,
  getSurfaceRenderMode,
  hasAssignedFaceTexture,
  isCubeFaceCulled,
  MinecraftRenderType,
  RenderPass,
  screenPolygonIntersectsRect,
  queryFaceBvh,
  refitFaceBvh,
  WebGLSceneRenderer
} from '../src/render/webgl-renderer.js';

{
  const uploads = [], draws = [];
  const renderer = Object.create(WebGLSceneRenderer.prototype);
  renderer.gl = { LINES: 1, STATIC_DRAW: 2 };
  renderer.gridBuffer = {};
  renderer.uploadBuffer = (_buffer, vertices) => uploads.push(vertices.length);
  renderer.drawBuffer = (_buffer, count) => draws.push(count);
  const project = { formatId: 'generic_model' };
  renderer.drawGrid(project, { grid: true, snap: 16 }, []);
  renderer.drawGrid(project, { grid: true, snap: 16 }, []);
  assert.equal(uploads.length, 1, 'camera changes reuse the merged grid buffer');
  assert.equal(draws.length, 2, 'fine, major and direction lines share one draw per frame');
  renderer.drawGrid(project, { grid: true, snap: 32 }, []);
  assert.equal(uploads.length, 2, 'changing snap resolution regenerates the grid');
}

{
  const calls = [];
  const renderer = Object.create(WebGLSceneRenderer.prototype);
  renderer.gl = { TRIANGLES: 4 };
  renderer.staticCache = { get faces() { throw new Error('opaque face tint must use merged buffers'); } };
  renderer.selectedCache = { triangles: Array(24) };
  renderer.visibleStaticTriangleBuffer = {};
  renderer.selectedTriangleBuffer = {};
  renderer.cubeBirthUids = new Set();
  renderer.ensureVisibleStaticBatches = () => ({ triangleCount: 12 });
  renderer.drawBuffer = (_buffer, _count, _primitive, _matrix, options) => calls.push(options.renderMode);
  renderer.drawBufferExcluding = (_buffer, _count, _excluded, _ranges, _primitive, _matrix, options) => calls.push(options.renderMode);
  renderer.drawMirrorInstances = () => {};
  renderer.drawCubeTransitions = () => {};
  const project = { formatId: 'generic_model', cullFaces: false };
  renderer.drawSurfaceGeometry(project, { faceDistinct: true, renderMode: 'textured' },
    getMinecraftRenderType(MinecraftRenderType.CUTOUT), new Set(), new Set(), [], {});
  assert.deepEqual(calls, [2, 2, 3, 3],
    'opaque face distinction draws texture and tint from cached merged geometry');
}

{
  const uploads = [], draws = [];
  const renderer = Object.create(WebGLSceneRenderer.prototype);
  renderer.gl = { TRIANGLES: 4, DYNAMIC_DRAW: 5 };
  renderer.orderedFaceBuffer = {};
  renderer.staticCache = {
    faces: [1, 2].map(depth => ({
      uid: `face_${depth}`,
      center: [0, 0, depth], vertices: Array(12).fill(depth)
    }))
  };
  renderer.selectedCache = { faces: [] };
  renderer.cubeBirthStartByUid = new Map();
  renderer.uploadBuffer = (_buffer, vertices) => uploads.push([...vertices]);
  renderer.drawBuffer = (_buffer, count) => draws.push(count);
  renderer.drawMirrorInstances = () => {};
  renderer.drawCubeTransitions = () => {};
  const project = { formatId: 'generic_model', cullFaces: false };
  const paint = cameraState => renderer.drawSurfaceGeometry(project, {
    faceDistinct: false, renderMode: 'textured', yaw: cameraState.forward[2] < 0 ? Math.PI : 0, pitch: 0
  },
    getMinecraftRenderType(MinecraftRenderType.TRANSLUCENT), new Set(), new Set(), [], cameraState);
  paint({ eye: [0, 0, 0], forward: [0, 0, 1] });
  const firstOrder = renderer.orderedFaceCache.faces;
  paint({ eye: [0, 0, 0], forward: [0, 0, 1] });
  assert.equal(uploads.length, 1, 'unchanged translucent face order reuses one GPU upload');
  assert.equal(renderer.orderedFaceCache.faces, firstOrder, 'stable order also skips rebuilding the sorted list');
  assert.deepEqual(draws, [2, 2]);
  paint({ eye: [0, 0, 0], forward: [0, 0, -1] });
  assert.equal(uploads.length, 2, 'a reversed camera order uploads the reordered faces');
  renderer.cubeBirthStartByUid.set('face_2', 0);
  paint({ eye: [0, 0, 0], forward: [0, 0, -1] });
  renderer.cubeBirthStartByUid.clear();
  paint({ eye: [0, 0, 0], forward: [0, 0, -1] });
  assert.equal(uploads.length, 4, 'a completed birth restores excluded faces to the cached order');
}

{
  const faces = Array.from({ length: 24 }, (_, index) => ({
    uid: `face_${index}`,
    quad: [[index * 3, 0, 0], [index * 3 + 1, 0, 0],
    [index * 3, 1, 0], [index * 3 + 1, 1, 0]]
  }));
  const tree = buildFaceBvh(faces);
  const ray = x => ({ origin: [x, .5, 10], direction: [0, 0, -1] });
  assert.deepEqual(queryFaceBvh(tree, ray(.5)).map(face => face.uid), ['face_0']);
  faces[0].quad = faces[0].quad.map(point => [point[0] + 100, point[1], point[2]]);
  assert.equal(refitFaceBvh(tree, new Set(['face_0'])), true);
  assert.deepEqual(queryFaceBvh(tree, ray(.5)), [], 'a refit removes the old hit region');
  assert.deepEqual(queryFaceBvh(tree, ray(100.5)).map(face => face.uid),
    queryFaceBvh(buildFaceBvh(faces), ray(100.5)).map(face => face.uid),
    'a refit finds moved faces exactly like a full rebuild');
}

{
  const probe = {
    lastViewport: { width: 200, height: 100 }, lastCameraInput: { zoom: 1 },
    lastCameraState: {
      projection: 'orthographic', eye: [0, 0, 10], forward: [0, 0, -1],
      right: [1, 0, 0], up: [0, 1, 0]
    }
  };
  const orthographic = WebGLSceneRenderer.prototype.rayAt.call(probe, 150, 50);
  assert.deepEqual(orthographic.direction, [0, 0, -1]);
  assert.ok(orthographic.origin[0] > 0, 'orthographic screen painting moves the ray origin');
  probe.lastCameraState.projection = 'perspective';
  const perspective = WebGLSceneRenderer.prototype.rayAt.call(probe, 150, 50);
  assert.deepEqual(perspective.origin, [0, 0, 10]);
  assert.ok(perspective.direction[0] > 0, 'perspective screen painting changes the ray direction');
}

{
  const renderer = { pickCurveNode: (_project, uid, _x, _y, _radius, excluded) => ({ uid, index: excluded === 1 ? 0 : 1 }) };
  const project = {
    getNode: uid => uid === 'visible' ? { uid, type: 'bezier3d', visible: true } : null,
    getGroupChain: () => []
  };
  const pick = WebGLSceneRenderer.prototype.pickUnselectedCurveNode;
  assert.equal(pick.call(renderer, project, 0, 0, null), null,
    'nodes of curves without visible selected markers cannot intercept a click');
  assert.deepEqual(pick.call(renderer, project, 0, 0, 'visible', 1), { uid: 'visible', index: 0 },
    'only an unselected node of the selected curve is eligible');
}

assert.equal(cubeLifetimeScale('birth', 0), 0);
assert.equal(cubeLifetimeScale('birth', 42), 1.05);
assert.equal(cubeLifetimeScale('birth', 60), 1);
assert.equal(cubeLifetimeScale('death', 0), 1);
assert.equal(cubeLifetimeScale('death', 18), 1.05);
assert.equal(cubeLifetimeScale('death', 60), 0);
const center = [7, -3, 11];
const centerMatrix = scaleAroundPoint(center, .25);
assert.deepEqual(center.map((value, axis) => centerMatrix[axis * 5] * value + centerMatrix[12 + axis]), center,
  'visual growth and shrink preserve the geometric center rather than the pivot');
const removedCache = {
  project: {}, triangles: new Array(12 * 12).fill(0), edges: new Array(12 * 4).fill(0),
  cubePoints: new Map([
    ['a', [[[0, 0, 0], [2, 2, 2]]]],
    ['b', [[[10, 0, 0], [12, 2, 2]]]]
  ]),
  cubeTriangleRanges: new Map([['a', [{ start: 0, count: 6 }]], ['b', [{ start: 6, count: 6 }]]]),
  cubeEdgeRanges: new Map([['a', [{ start: 0, count: 2 }]], ['b', [{ start: 2, count: 2 }]]])
};
const transitionProbe = {
  cubeTransitionRevision: -1, geometryRevision: 1, cubeTransitionSource: removedCache,
  cubeBirthMs: 60, cubeDeathMs: 60,
  cubeTransitions: [], cubeBirthUids: new Set(), cubeBirthStartByUid: new Map(),
  staticCache: { project: removedCache.project, cubePoints: new Map() },
  gl: { createBuffer: () => ({}), deleteBuffer: () => {} },
  uploadBuffer() {}
};
WebGLSceneRenderer.prototype.reconcileCubeTransitions.call(transitionProbe, removedCache.project);
assert.equal(transitionProbe.cubeTransitions.length, 1, 'multi-delete uses one visual batch');
assert.deepEqual(transitionProbe.cubeTransitions[0].center, [6, 1, 1],
  'the multi-delete batch shrinks around its combined geometric center');
assert.equal(transitionProbe.cubeTransitions[0].triangleCount, 12);

assert.equal(hasAssignedFaceTexture(undefined), false, 'a cube face without a texture stays untextured');
const importedLayers = normalizeTextureLayers({
  uuid: 'bb_texture', layers: [
    { name: 'base', data_url: 'data:image/png;base64,AA==', visible: true, opacity: 100 },
    { name: 'detail', data_url: 'data:image/png;base64,BB==', visible: true, opacity: 80 }
  ]
});
assert.equal(importedLayers.length, 2, 'Blockbench data_url layers are retained');
assert.equal(importedLayers[0].source, 'data:image/png;base64,AA==');
assert.equal('data_url' in importedLayers[0], false, 'pixel data is not duplicated in saved projects');
assert.equal(importedLayers[1].uid, 'bb_texture_layer_1');
assert.equal(normalizeTextureLayers({ layers: [{ name: 'missing pixels' }] }), null,
  'invalid layers fall back to the baked texture');
assert.equal(hasAssignedFaceTexture({ uv: [0, 0, 16, 16] }), false,
  'UV coordinates alone do not implicitly assign a texture');
assert.equal(hasAssignedFaceTexture({ texture: null }), false,
  'the explicit null marker remains distinct from a texture assignment');
assert.equal(hasAssignedFaceTexture({ texture: 0 }), true, 'an explicit texture index enables textured rendering');
assert.equal(isCubeFaceCulled({ texture: null }), true, 'a null texture marks a culled cube face');
assert.equal(isCubeFaceCulled({ texture: '#skin' }), false, 'a textured face remains renderable');
assert.equal(getSurfaceRenderMode('normal'), 4, 'normal display uses the texture-free normal shader branch');
assert.equal(getSurfaceRenderMode('textured'), 2, 'textured display keeps the texture sampling branch');
assert.deepEqual(getCubeFaceDisplayColor('#336699', 'north'), [0.2, 0.4, 0.6],
  'solid display keeps the element display colour even when a face has no texture');

assert.equal(screenPolygonIntersectsRect([
  { x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }
], { x1: 20, y1: 20, x2: 40, y2: 40 }), true, 'selection rectangle intersects a projected face');
assert.equal(screenPolygonIntersectsRect([
  { x: 0, y: 18 }, { x: 50, y: 18 }, { x: 50, y: 22 }, { x: 0, y: 22 }
], { x1: 20, y1: 10, x2: 30, y2: 30 }), true, 'selection rectangle inside a projected face is detected');
assert.equal(screenPolygonIntersectsRect([
  { x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }
], { x1: 20, y1: 20, x2: 40, y2: 40 }), false, 'separate projected geometry is not selected');

const rectangle = [0, 0, 16, 16];
assert.deepEqual(createBlockbenchFaceUvs(rectangle, [16, 16]), [
  [0, 1], [0, 0], [1, 1],
  [0, 0], [1, 0], [1, 1]
], 'Blockbench 0,2,1 / 2,3,1 triangle slots');

assert.deepEqual(createBlockbenchFaceUvs(rectangle, [16, 16], 90), [
  [0, 0], [1, 0], [0, 1],
  [1, 0], [1, 1], [0, 1]
], 'Blockbench 90-degree UV slot rotation');

assert.deepEqual(createBlockbenchFaceUvSlots([0, 0, 16, 8], 90), [
  [0, 8], [0, 0], [16, 8], [16, 0]
], 'UV preview orientation uses the same rotated slots as textured rendering');

assert.deepEqual(createBlockbenchFaceUvs([16, 0, 0, 16], [16, 16]), [
  [1, 1], [1, 0], [0, 1],
  [1, 0], [0, 0], [0, 1]
], 'reversed U rectangle');

assert.deepEqual(createAtlasFaceUvs([0, 0, 16, 8], 0,
  { x: 32, y: 8, width: 16, height: 8 }, [64, 32]), [
  [.5, .75], [.5, .5], [.75, .75],
  [.5, .5], [.75, .5], [.75, .75]
], 'per-face texture UVs are remapped into their own runtime atlas rectangle');
assert.deepEqual(createAtlasFaceUvs([0, 0, 16, 8], 0,
  { x: 32, y: 8, width: 64, height: 32, uvWidth: 16, uvHeight: 8 }, [128, 64]), [
  [.25, .875], [.25, .375], [.75, .875],
  [.25, .375], [.75, .375], [.75, .875]
], 'high-density PNGs scale logical Blockbench UV units before atlas placement');

const head = { uv: [0, 0], size: [8, 10, 8], mirrorUv: false };
assert.deepEqual(getBlockbenchBoxUv(head, 'east'), [0, 8, 8, 18]);
assert.deepEqual(getBlockbenchBoxUv(head, 'north'), [8, 8, 16, 18]);
assert.deepEqual(getBlockbenchBoxUv(head, 'west'), [16, 8, 24, 18]);
assert.deepEqual(getBlockbenchBoxUv(head, 'south'), [24, 8, 32, 18]);
assert.deepEqual(getBlockbenchBoxUv(head, 'up'), [16, 8, 8, 0]);
assert.deepEqual(getBlockbenchBoxUv(head, 'down'), [24, 0, 16, 8]);

const mirrored = { uv: [0, 40], size: [4, 16, 4], mirrorUv: true };
assert.deepEqual(getBlockbenchBoxUv(mirrored, 'east'), [12, 44, 8, 60]);
assert.deepEqual(getBlockbenchBoxUv(mirrored, 'west'), [4, 44, 0, 60]);
assert.deepEqual(getBlockbenchBoxUv(mirrored, 'north'), [8, 44, 4, 60]);

const negative = { uv: [0, 0], size: [-8, 10, -8], mirrorUv: false };
assert.deepEqual(getBlockbenchBoxUv(negative, 'north'), [8, 8, 16, 18], 'negative sizes keep positive box-UV spans');
assert.deepEqual(createSignedCubeCorners([4, 5, 6], [-2, 3, -4], .5), [
  [4.5, 4.5, 6.5], [1.5, 4.5, 6.5], [1.5, 8.5, 6.5], [4.5, 8.5, 6.5],
  [4.5, 4.5, 1.5], [1.5, 4.5, 1.5], [1.5, 8.5, 1.5], [4.5, 8.5, 1.5]
], 'negative cube axes retain their signed corner orientation');
assert.equal(getEffectiveInflate({ inflate: .25 }, [{ inflate: .5 }, { inflate: 1.25 }]), 2,
  'nested group inflation adds to the element inflation');

const cornerHandedness = corners => {
  const edge = index => corners[index].map((value, axis) => value - corners[0][axis]);
  const [x, y, z] = [edge(1), edge(3), edge(4)];
  return (x[1] * y[2] - x[2] * y[1]) * z[0]
    + (x[2] * y[0] - x[0] * y[2]) * z[1]
    + (x[0] * y[1] - x[1] * y[0]) * z[2];
};
const positiveCorners = createSignedCubeCorners([0, 0, 0], [2, 3, 4]);
const negativeXCorners = createSignedCubeCorners([0, 0, 0], [-2, 3, 4]);
assert.equal(Math.sign(cornerHandedness(negativeXCorners)), -Math.sign(cornerHandedness(positiveCorners)),
  'one negative axis reverses cube winding instead of being normalized back to positive');

assert.deepEqual(Object.values(MinecraftRenderType), [
  'solid', 'solid_smooth', 'cutout', 'cutout_smooth', 'translucent', 'translucent_smooth'
]);
assert.deepEqual(getMinecraftRenderType('solid'), {
  pass: RenderPass.SOLID, smooth: false, alphaMode: 0, blend: false, cull: true, depthWrite: true
});
assert.deepEqual(getMinecraftRenderType('cutout_smooth'), {
  pass: RenderPass.CUTOUT, smooth: true, alphaMode: 1, blend: false, cull: true, depthWrite: true
});
assert.deepEqual(getMinecraftRenderType('translucent'), {
  pass: RenderPass.TRANSLUCENT, smooth: false, alphaMode: 2, blend: true, cull: false, depthWrite: true
});

{
  const renderer = {
    lastOwnerPoints: new Map([
      ['a', [[-2, 1, 4], [2, 5, 8]]],
      ['b', [[4, -3, -2], [6, 3, 2]]]
    ])
  };
  const project = {
    getNode: uid => uid === 'group' ? { type: 'group' } : null,
    getDescendantElementUids: () => ['a', 'b']
  };
  assert.deepEqual(WebGLSceneRenderer.prototype.getGeometryCenter.call(renderer, project, 'group'), [2, 1, 3],
    'group geometry center uses the bounds of all child vertices');
}

{
  const renderer = Object.create(WebGLSceneRenderer.prototype);
  const buffer = {};
  const draws = [];
  renderer.gl = { LINES: 1 };
  renderer.selectedWireBuffer = buffer;
  renderer.selectedCache = { cubeEdgeRanges: new Map(), edgeRanges: new Map([['hidden', { start: 3, count: 3 }]]) };
  renderer.cubeBirthStartByUid = new Map();
  renderer.drawBuffer = (_buffer, _count, _primitive, _matrix, options) => draws.push(options);
  renderer.drawBufferExcluding(buffer, 12, new Set(['hidden']), renderer.selectedCache.edgeRanges, 1, null);
  renderer.drawBufferExcluding(buffer, 12, new Set(['hidden']), renderer.selectedCache.edgeRanges, 1, null);
  assert.deepEqual(draws[0].ranges, [{ start: 0, count: 3 }, { start: 6, count: 6 }]);
  assert.equal(draws[1].ranges, draws[0].ranges, 'unchanged exclusion ranges are reused');
  renderer.drawBufferExcluding(buffer, 12, new Set(), renderer.selectedCache.edgeRanges, 1, null);
  assert.equal(draws[2].ranges, undefined, 'an empty exclusion draws the full buffer');
  const locked = new Set(['hidden']);
  renderer.cubeBirthUids = new Set(['born']);
  const combined = renderer.selectedExcludedUids(locked);
  assert.deepEqual([...combined], ['hidden', 'born']);
  assert.equal(renderer.selectedExcludedUids(locked), combined, 'a stable lock and birth state reuses its exclusion set');
}

{
  const renderer = {
    lastOwnerPoints: new Map([
      ['visible', [[-2, -1, -3], [2, -1, -3], [-2, 3, 3], [2, 3, 3]]],
      ['hidden', [[1000, 1000, 1000]]]
    ])
  };
  const project = {
    elements: [{ uid: 'visible', visible: true }, { uid: 'hidden', visible: false }],
    groups: []
  };
  const camera = { yaw: 0, pitch: 0, zoom: 1, projection: 'orthographic', target: [100, 100, 100], panX: 80, panY: -20 };
  const fitted = WebGLSceneRenderer.prototype.fitCameraToVisibleModel.call(renderer, project, camera, 1);
  assert.deepEqual(fitted.target, [0, 1, 0], 'offscreen framing recenters on visible model geometry');
  assert.equal(fitted.panX, 0, 'offscreen framing clears viewport panning');
  assert.equal(fitted.panY, 0, 'offscreen framing clears viewport panning');
  assert.ok(fitted.zoom > 0 && fitted.zoom < 10, 'offscreen framing computes a usable zoom');
}

{
  const calls = [];
  const gl = {
    FRAMEBUFFER: 1, COLOR_BUFFER_BIT: 2, DEPTH_BUFFER_BIT: 4, TRIANGLES: 6,
    bindFramebuffer: () => calls.push('target'), viewport: () => {}, clearColor: () => {},
    clearDepth: () => {}, clear: () => {}, colorMask: () => {}
  };
  const renderer = {
    gl, mirrorCache: { instances: [{}] }, lockedFramebuffer: {}, lastCameraState: {},
    ensureLockedLayerTarget: () => calls.push('layer'),
    drawGrid: () => calls.push('grid'),
    drawPlayerReference: () => calls.push('player'),
    drawSurfaceGeometry: () => calls.push('base'),
    drawMirrorInstances: (...args) => {
      assert.equal(args[2], gl.TRIANGLES);
      assert.equal(args[4].opacity, undefined, 'modifier faces are not individually faded');
      assert.equal(args[4].blend, false, 'overlapping modifier faces resolve in one layer');
      assert.equal(args[5].ghostOnly, true);
      calls.push('generated');
    },
    compositeLockedLayer: camera => {
      assert.equal(camera.lockedDefaultAlpha, 75);
      assert.equal(camera.lockedHoverFade, false);
      calls.push('composite');
    }
  };
  WebGLSceneRenderer.prototype.drawModifierGhostOverlay.call(renderer,
    { cullFaces: true }, { modifierResultGhost: true, renderMode: 'textured', grid: true },
    getMinecraftRenderType('cutout'), new Set(), new Set(), [], null, 100, 100);
  assert.deepEqual(calls, ['layer', 'target', 'grid', 'player', 'base', 'generated', 'composite']);
  assert.doesNotThrow(() => WebGLSceneRenderer.prototype.drawMirrorInstances.call(
    { lastCameraInput: { modifierResultGhost: true } }, new Set(), new Set(), gl.TRIANGLES, []),
    'ordinary passes skip generated instances while the isolated layer owns them');
}

{
  const oldCube = { uid: 'cube_a', type: 'cube', visible: true };
  const newCube = { uid: 'cube_a', type: 'cube', visible: true };
  const project = {
    formatId: 'generic_model', textureSize: [16, 16], elements: [newCube], groups: [],
    getNode: uid => uid === 'cube_a' ? newCube : null
  };
  const renderer = Object.create(WebGLSceneRenderer.prototype);
  const changedFace = { uid: 'cube_a', cube: oldCube };
  const untouchedFace = { uid: 'unrelated', cube: {} };
  const indexedFaces = new Proxy([changedFace, untouchedFace], {
    get(target, key) {
      if (key === Symbol.iterator) throw new Error('journal patch must not scan every face');
      return Reflect.get(target, key);
    }
  });
  renderer.staticCache = {
    project: {
      formatId: 'generic_model', textureSize: [16, 16],
      elements: [oldCube], groups: [], getNode: uid => uid === 'cube_a' ? oldCube : null
    },
    paintExplode: false, faceDistinct: false, faces: indexedFaces,
    facesByUid: new Map([['cube_a', [changedFace]], ['unrelated', [untouchedFace]]])
  };
  renderer.geometryRevision = 3;
  renderer.selectionRevision = 5;
  renderer.mirrorRevision = 2;
  renderer.commitSelectionGeometry = (target, selection) => {
    assert.equal(target, project);
    assert.deepEqual([...selection], ['cube_a']);
    return true;
  };
  assert.equal(renderer.restoreJournalGeometry(project, ['cube_a'], new Set(), 'edit'), true);
  assert.equal(renderer.staticCache.project, project);
  assert.equal(renderer.staticCache.faces[0].cube, newCube);
  assert.notEqual(renderer.staticCache.faces[1].cube, newCube, 'an unaffected face keeps its original Cube');
  assert.equal(renderer.staticCache.revision, renderer.geometryRevision);
  assert.equal(renderer.selectedCache, null);
  const shape = { ...newCube, type: 'shape' };
  assert.equal(renderer.restoreJournalGeometry({ ...project, elements: [shape], getNode: () => shape },
    ['cube_a'], new Set(), 'edit'), false);
}

{
  const cube = { uid: 'cube_a', type: 'cube', visible: true };
  const oldGroup = { uid: 'group_a', type: 'group', visible: true, children: ['cube_a'], pivot: [0, 0, 0] };
  const newGroup = { ...oldGroup, pivot: [2, 0, 0] };
  const makeProject = group => ({
    formatId: 'generic_model', textureSize: [16, 16],
    elements: [cube], groups: [group], getNode: uid => uid === cube.uid ? cube : uid === group.uid ? group : null
  });
  const oldProject = makeProject(oldGroup), newProject = makeProject(newGroup);
  const renderer = Object.create(WebGLSceneRenderer.prototype);
  renderer.staticCache = {
    project: oldProject, paintExplode: false, faceDistinct: false,
    faces: [{ uid: cube.uid, cube }]
  };
  renderer.geometryRevision = renderer.selectionRevision = renderer.mirrorRevision = 0;
  renderer.commitSelectionGeometry = (_project, changed) => {
    assert.deepEqual([...changed], ['cube_a']);
    return true;
  };
  assert.equal(renderer.restoreJournalGeometry(newProject, ['group_a'], new Set(['group_a']), 'edit'), true,
    'group transforms patch descendant geometry without rebuilding the entire scene');
}

{
  const guide = createMirrorGuideController({
    state: {}, sceneRenderer: { getCameraFrame: () => ({ forward: [0, 0, 1] }) },
    projectViewportPoint: point => ({ x: point[0], y: point[1], depth: 0, behind: false }),
    addScaled3: (point, direction, scale) => point.map((value, axis) => value + direction[axis] * scale),
    clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))
  });
  const markup = guide.finiteWorldGuideMarkup([0, 0, 0], [1, 0, 0], 'mirror-axis-line');
  assert.match(markup, /<path /);
  assert.doesNotMatch(markup, /<line /);
  assert.ok((markup.match(/<path /g) || []).length <= 12,
    'fading guide segments share SVG paths instead of one DOM node per segment');
}

{
  const calls = [];
  const gl = {
    ARRAY_BUFFER: 1, TEXTURE_2D: 2, TEXTURE0: 10, TEXTURE1: 11, TEXTURE2: 12,
    TRIANGLES: 3, FLOAT: 4, DEPTH_TEST: 5, LEQUAL: 6, CULL_FACE: 7,
    CW: 8, CCW: 9, BLEND: 13,
    useProgram: program => calls.push(['program', program]),
    bindBuffer: () => {}, uniformMatrix4fv: (location) => calls.push(['matrix', location]),
    uniform1i: (location, value) => calls.push(['int', location, value]),
    uniform1f: (location, value) => calls.push(['float', location, value]),
    uniform2f: () => {}, uniform4fv: () => {}, activeTexture: () => {},
    bindTexture: () => {}, enableVertexAttribArray: () => {},
    vertexAttribPointer: () => calls.push(['attribute']),
    depthMask: () => {}, enable: () => {}, disable: () => {}, depthFunc: () => {},
    frontFace: () => {}, drawArrays: () => {}
  };
  const renderer = Object.create(WebGLSceneRenderer.prototype);
  Object.assign(renderer, {
    gl, program: 'surface', currentProgram: 'surface', texture: {},
    matrixLocation: 'view', modelTransformLocation: 'model',
    previewShadeLocation: 'shade', renderModeLocation: 'mode', alphaModeLocation: 'alpha',
    opacityLocation: 'opacity', colorOverrideLocation: 'override',
    paintPixelGridLocation: 'grid', paintGridSizeLocation: 'gridSize',
    selectionActiveLocation: 'selection', selectionTexelLocation: 'texel',
    selectionPixelRadiusLocation: 'radius', selectionPhaseLocation: 'phase',
    selectionStripeViewportLocation: 'viewport',
    positionLocation: 0, colorLocation: 1, normalLocation: 2, uvLocation: 3,
    previewShade: true, paintPixelGrid: false, paintSelectionActive: false
  });
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const firstBuffer = {};
  renderer.drawBuffer(firstBuffer, 6, gl.TRIANGLES, matrix, { renderMode: 2 });
  const firstUniforms = calls.filter(call => call[0] === 'matrix' || call[0] === 'int' || call[0] === 'float').length;
  const firstAttributes = calls.filter(call => call[0] === 'attribute').length;
  renderer.drawBuffer(firstBuffer, 6, gl.TRIANGLES, [...matrix], { renderMode: 2 });
  assert.equal(calls.filter(call => call[0] === 'matrix' || call[0] === 'int' || call[0] === 'float').length,
    firstUniforms, 'unchanged camera and material uniforms are not resent per draw');
  assert.equal(calls.filter(call => call[0] === 'attribute').length, firstAttributes,
    'the same GPU buffer keeps its vertex attribute pointers');
  renderer.drawBuffer({}, 6, gl.TRIANGLES, matrix, { renderMode: 2 });
  assert.equal(calls.filter(call => call[0] === 'attribute').length, firstAttributes + 4,
    'a different GPU buffer updates all vertex attribute pointers');
  renderer.paintSelectionActive = true;
  renderer.selectionMaskTexture = {};
  renderer.selectionStripeTexture = {};
  renderer.selectionMaskSize = [16, 16];
  renderer.drawBuffer({}, 6, gl.TRIANGLES, matrix, { renderMode: 3 });
  assert.ok(calls.some(call => call[0] === 'int' && call[1] === 'mode' && call[2] === 3));
  assert.ok(calls.some(call => call[0] === 'int' && call[1] === 'selection' && call[2] === 1));
  renderer.paintSelectionActive = false;
  renderer.drawBuffer({}, 6, gl.TRIANGLES, matrix, { renderMode: 2 });
  assert.ok(calls.some(call => call[0] === 'int' && call[1] === 'selection' && call[2] === 0),
    'turning paint selection off updates the shader guard');
}

{
  const renderer = Object.create(WebGLSceneRenderer.prototype);
  const project = { formatId: 'java_block_item', elements: [] };
  let uploads = 0, draws = 0;
  renderer.gl = { LINES: 1 };
  renderer.geometryRevision = renderer.selectionRevision = renderer.mirrorRevision = 0;
  renderer.formatLimitGuideBuffer = {};
  renderer.uploadBuffer = () => { uploads++; };
  renderer.drawBuffer = () => { draws++; };
  renderer.drawFormatLimitGuide(project, { mode: 'edit' }, []);
  renderer.drawFormatLimitGuide(project, { mode: 'edit' }, []);
  assert.equal(uploads, 1, 'camera-only frames reuse the format-limit GPU buffer');
  assert.equal(draws, 2, 'the cached guide is still drawn on every camera frame');
  renderer.geometryRevision++;
  renderer.drawFormatLimitGuide(project, { mode: 'edit' }, []);
  assert.equal(uploads, 2, 'editing geometry refreshes the format-limit guide');
}

{
  const near = { center: [0, 0, 2] }, far = { center: [0, 0, 8] };
  const equalA = { center: [0, 0, 4] }, equalB = { center: [1, 0, 4] };
  const eye = [0, 0, 0], forward = [0, 0, 1];
  assert.deepEqual(sortFacesByDepth([near, equalA, far, equalB], eye, forward),
    [far, equalA, equalB, near], 'translucent faces retain source order at equal depth');
  assert.equal(facesRemainDepthSorted([far, equalA, near], eye, forward), true);
  assert.equal(facesRemainDepthSorted([far, equalA, equalB], eye, forward), true,
    'coplanar faces retain the previous order without repeated GPU uploads');
  assert.equal(facesRemainDepthSorted([far, near, equalA], eye, forward), false);
  const coplanar = Array.from({ length: 1024 }, (_, index) => ({ center: [index, 0, 4] }));
  assert.equal(facesRemainDepthSorted(sortFacesByDepth(coplanar, eye, forward), eye, forward), true,
    'large aligned face sets do not force a new sort every frame');
}

{
  const renderer = Object.create(WebGLSceneRenderer.prototype);
  const project = { renderType: 'translucent' };
  let depthReads = 0;
  const faces = Array.from({ length: 64 }, (_, index) => ({
    uid: `face_${index}`, get center() {
      depthReads++;
      return [index, 0, 4];
    },
    vertices: Array(72).fill(0)
  }));
  let uploads = 0;
  renderer.gl = { TRIANGLES: 1 };
  renderer.staticCache = { faces };
  renderer.selectedCache = { faces: [] };
  renderer.cubeBirthStartByUid = new Map();
  renderer.currentDynamicElementKey = renderer.currentLockedKey = '';
  renderer.orderedFaceBuffer = {};
  renderer.uploadBuffer = () => { uploads++; };
  renderer.drawBuffer = renderer.drawMirrorInstances = renderer.drawCubeTransitions = () => {};
  const camera = { renderMode: 'textured', faceDistinct: true, yaw: 0, pitch: 0 };
  const frame = { eye: [0, 0, 0], forward: [0, 0, 1] };
  renderer.drawSurfaceGeometry(project, camera, getMinecraftRenderType('translucent'),
    new Set(), new Set(), [], frame);
  depthReads = 0;
  renderer.drawSurfaceGeometry(project, camera, getMinecraftRenderType('translucent'),
    new Set(), new Set(), [], frame);
  assert.equal(uploads, 1, 'coplanar translucent faces keep their GPU order buffer across camera frames');
  assert.equal(depthReads, 0, 'camera pan and zoom keep translucent order without rescanning faces');
  camera.yaw = .1;
  renderer.drawSurfaceGeometry(project, camera, getMinecraftRenderType('translucent'),
    new Set(), new Set(), [], frame);
  assert.ok(depthReads > 0, 'camera rotation still checks face depths');
  assert.equal(uploads, 1, 'unchanged depth order does not reupload its GPU buffer');
}

{
  const renderer = Object.create(WebGLSceneRenderer.prototype);
  const instance = { sourceUids: ['cube_a'], reflected: true, transform: [] };
  let transforms = 0;
  const draws = [];
  renderer.gl = { TRIANGLES: 1, LINES: 2 };
  renderer.lastCameraInput = { mode: 'paint', paintExplode: true, modifierResultGhost: false };
  renderer.mirrorCache = { instances: [instance] };
  renderer.staticCache = { triangleRanges: new Map([['cube_a', { start: 3, count: 6 }]]) };
  renderer.selectedCache = { triangleRanges: new Map() };
  renderer.staticTriangleBuffer = {};
  renderer.paintExplodeOffsets = new Map([['cube_a', [2, 0, 0]]]);
  renderer.cubeBirthStartByUid = new Map();
  renderer.geometryRevision = renderer.selectionRevision = 1;
  renderer.currentDynamicElementKey = renderer.currentLockedKey = '';
  renderer.paintExplodeInstanceTransform = () => {
    transforms++;
    return [transforms];
  };
  renderer.drawBuffer = (_buffer, count, _primitive, _matrix, options) => draws.push({ count, options });
  const draw = () => renderer.drawMirrorInstances(new Set(), new Set(), renderer.gl.TRIANGLES, []);
  draw();
  draw();
  assert.equal(transforms, 1, 'camera frames reuse exploded modifier range and transform batches');
  assert.deepEqual(draws.map(entry => entry.count), [6, 6]);
  assert.equal(draws[1].options.flipWinding, true);
  renderer.paintExplodeOffsets = new Map([['cube_a', [3, 0, 0]]]);
  draw();
  assert.equal(transforms, 2, 'changing explode offsets refreshes modifier batches');
}

{
  const renderer = Object.create(WebGLSceneRenderer.prototype);
  const instance = { sourceUids: ['cube_a'], reflected: false, transform: [] };
  const draws = [];
  renderer.gl = { TRIANGLES: 1, LINES: 2 };
  renderer.lastCameraInput = { modifierResultGhost: false, mode: 'edit' };
  renderer.mirrorCache = { instances: [instance], rangeCache: new Map() };
  renderer.staticCache = { triangleRanges: new Map([['cube_a', { start: 2, count: 6 }]]) };
  renderer.selectedCache = { triangleRanges: new Map() };
  renderer.staticTriangleBuffer = {};
  renderer.cubeBirthStartByUid = new Map();
  renderer.geometryRevision = renderer.selectionRevision = 1;
  renderer.currentDynamicElementKey = renderer.currentLockedKey = '';
  renderer.drawBuffer = (_buffer, count) => draws.push(count);
  renderer.drawMirrorInstances(new Set(), new Set(), renderer.gl.TRIANGLES, []);
  renderer.drawMirrorInstances(new Set(), new Set(), renderer.gl.TRIANGLES, []);
  assert.deepEqual(draws, [6, 6], 'ordinary modifier batches retain their cached vertex count');
}

console.log('Render UV rewrite tests passed.');
