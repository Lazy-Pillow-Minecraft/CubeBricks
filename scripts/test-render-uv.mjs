import assert from 'node:assert/strict';
import { normalizeTextureLayers } from '../src/common/core/texture-features.js';
import {
  createSignedCubeCorners,
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
  WebGLSceneRenderer
} from '../src/render/webgl-renderer.js';

{
  const renderer = { pickCurveNode: (_project, uid, _x, _y, _radius, excluded) => ({ uid, index: excluded === 1 ? 0 : 1 }) };
  const project = { getNode: uid => uid === 'visible' ? { uid, type: 'bezier3d', visible: true } : null,
    getGroupChain: () => [] };
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
const importedLayers = normalizeTextureLayers({ uuid: 'bb_texture', layers: [
  { name: 'base', data_url: 'data:image/png;base64,AA==', visible: true, opacity: 100 },
  { name: 'detail', data_url: 'data:image/png;base64,BB==', visible: true, opacity: 80 }
] });
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
  const renderer = { lastOwnerPoints: new Map([
    ['visible', [[-2, -1, -3], [2, -1, -3], [-2, 3, 3], [2, 3, 3]]],
    ['hidden', [[1000, 1000, 1000]]]
  ]) };
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

console.log('Render UV rewrite tests passed.');
