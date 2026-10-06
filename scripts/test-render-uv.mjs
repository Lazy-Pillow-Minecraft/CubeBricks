import assert from 'node:assert/strict';
import {
  createSignedCubeCorners,
  createBlockbenchFaceUvSlots,
  createBlockbenchFaceUvs,
  getBlockbenchBoxUv,
  getEffectiveInflate,
  getMinecraftRenderType,
  hasAssignedFaceTexture,
  MinecraftRenderType,
  RenderPass,
  screenPolygonIntersectsRect
} from '../src/render/webgl-renderer.js';

assert.equal(hasAssignedFaceTexture(undefined), false, 'a cube face without a texture stays untextured');
assert.equal(hasAssignedFaceTexture({ uv: [0, 0, 16, 16] }), false,
  'UV coordinates alone do not implicitly assign a texture');
assert.equal(hasAssignedFaceTexture({ texture: null }), false,
  'the explicit null marker remains distinct from a texture assignment');
assert.equal(hasAssignedFaceTexture({ texture: 0 }), true, 'an explicit texture index enables textured rendering');

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

console.log('Render UV rewrite tests passed.');
