import assert from 'node:assert/strict';
import { CubeBricksProject, exportBlockbench, importBlockbench } from '../src/model.js';
import { getBlockbenchBoxUv } from '../src/common/core/geometry-utils.js';

const directions = ['north', 'south', 'east', 'west', 'up', 'down'];
const geometry = { size: [3.6, 2.4, 4.8], uv: [9, 12], boxUvFloor: true };
const faces = Object.fromEntries(directions.map(direction =>
  [direction, { uv: getBlockbenchBoxUv(geometry, direction), texture: '#skin' }]));
const source = {
  meta: { model_format: 'bedrock', box_uv: true },
  textures: [{ id: 'skin' }],
  elements: [{
    type: 'cube', uuid: 'fractional_box', from: [0, 0, 0], to: geometry.size,
    box_uv: true, uv_offset: geometry.uv, faces
  }],
  outliner: ['fractional_box']
};

const project = importBlockbench(source);
const cube = project.elements[0];
assert.equal(cube.uvMode, 'box');
assert.equal(cube.boxUvFloor, true, 'fractional Blockbench box UVs retain the integer layout rule');
for (const direction of directions) {
  assert.deepEqual(getBlockbenchBoxUv(cube, direction), faces[direction].uv);
  assert.equal(cube.faces[direction].uv, undefined, 'verified box faces use live geometry');
}

const reopened = new CubeBricksProject(JSON.parse(project.serialize()));
assert.equal(reopened.elements[0].boxUvFloor, true, 'the layout rule survives CBModel storage');
assert.deepEqual(getBlockbenchBoxUv(reopened.elements[0], 'north'), faces.north.uv);

const exported = exportBlockbench(project).elements[0];
assert.equal(exported.box_uv, false, 'fractional box dimensions export with explicit UV rectangles');
for (const direction of directions) assert.deepEqual(exported.faces[direction].uv, faces[direction].uv);

const edited = structuredClone(source);
edited.elements[0].faces.north.uv[0] += 2;
const editedCube = importBlockbench(edited).elements[0];
assert.equal(editedCube.uvMode, 'face', 'edited UV rectangles override the declared box flag');
assert.deepEqual(editedCube.faces.north.uv, edited.elements[0].faces.north.uv);

const declaredFace = structuredClone(source);
declaredFace.elements[0].box_uv = false;
assert.equal(importBlockbench(declaredFace).elements[0].uvMode, 'face');

const exact = structuredClone(source);
exact.elements[0].faces = Object.fromEntries(directions.map(direction => [direction, {
  uv: getBlockbenchBoxUv({ size: geometry.size, uv: geometry.uv }, direction), texture: '#skin'
}]));
assert.equal(importBlockbench(exact).elements[0].boxUvFloor, undefined,
  'a format with fractional box UVs preserves its original precision');

console.log('Blockbench box UV import and export checks passed.');
