import assert from 'node:assert/strict';
import { Cube, Group, CubeBricksProject, chooseKnifeCutAxis, getKnifeFaceAxes, importBlockbench, setPivotPreservingGeometry, splitCubeAt } from '../src/model.js';
import { applyGroupTransforms } from '../src/render/webgl-renderer.js';

const project = importBlockbench({
  name: 'nested_test',
  resolution: { width: 32, height: 64 },
  elements: [{
    type: 'cube',
    uuid: 'cube-a',
    name: 'cube_a',
    from: [1, 2, 3],
    to: [5, 8, 10],
    origin: [2, 3, 4],
    rotation: [10, 20, 30],
    shade: false,
    mirror_uv: true
  }],
  outliner: [{
    uuid: 'root-group',
    name: 'root',
    origin: [0, 8, 0],
    children: [{
      uuid: 'child-group',
      name: 'child',
      origin: [0, 4, 0],
      children: ['cube-a']
    }]
  }]
});

assert.deepEqual(project.textureSize, [32, 64]);
assert.equal(project.renderType, 'cutout');
assert.equal(project.cullFaces, false);
assert.deepEqual(project.outliner, ['root-group']);
assert.deepEqual(project.getNode('cube-a').position, [1, 2, 3]);
assert.deepEqual(project.getNode('cube-a').size, [4, 6, 7]);
assert.equal(project.getNode('cube-a').shade, false);
assert.equal(project.getNode('cube-a').mirrorUv, true);
assert.deepEqual(project.getGroupChain('cube-a').map(group => group.uid), ['root-group', 'child-group']);
assert.deepEqual(project.getDescendantElementUids('root-group'), ['cube-a']);

const versionFiveProject = importBlockbench({
  meta: { format_version: '5.0', model_format: 'free' },
  render_type: 'minecraft:cutout_mipped',
  elements: [{ type: 'cube', uuid: 'cube-v5', from: [0, 0, 0], to: [2, 2, 2], origin: [1, 1, 1] }],
  groups: [
    { uuid: 'root-v5', name: 'root_v5', origin: [0, 0, 0], rotation: [0, 90, 0], visibility: true },
    { uuid: 'child-v5', name: 'child_v5', origin: [1, 0, 0], rotation: [0, 0, 90], visibility: true }
  ],
  outliner: [{ uuid: 'root-v5', children: [{ uuid: 'child-v5', children: ['cube-v5'] }] }]
});

assert.deepEqual(versionFiveProject.getNode('root-v5').rotation, [0, 90, 0]);
assert.equal(versionFiveProject.renderType, 'cutout_smooth');
assert.equal(versionFiveProject.cullFaces, false);
assert.equal(new CubeBricksProject({ modelType: 'java_block' }).cullFaces, true);
assert.deepEqual(versionFiveProject.getNode('child-v5').pivot, [1, 0, 0]);
assert.deepEqual(versionFiveProject.getGroupChain('cube-v5').map(group => group.uid), ['root-v5', 'child-v5']);
const transformed = applyGroupTransforms([2, 0, 0], versionFiveProject.getGroupChain('cube-v5'));
assert.ok(transformed.every((value, axis) => Math.abs(value - [0, 1, -1][axis]) < 1e-9));

const rotatePoint = (point, pivot, rotation) => {
  let [x, y, z] = point.map((value, axis) => value - pivot[axis]);
  const [rx, ry, rz] = rotation.map(value => value * Math.PI / 180);
  let c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z].map((value, axis) => value + pivot[axis]);
};
const almostEqual = (left, right) => left.every((value, axis) => Math.abs(value - right[axis]) < 1e-9);

const pivotCube = new Cube({ position: [1, 2, 3], size: [4, 5, 6], pivot: [2, 3, 4], rotation: [23, -41, 17] });
const pivotProject = new CubeBricksProject({ elements: [pivotCube], outliner: [pivotCube.uid] });
const cubeCornerBefore = rotatePoint(pivotCube.position, pivotCube.pivot, pivotCube.rotation);
setPivotPreservingGeometry(pivotProject, pivotCube, [6, -2, 8]);
const cubeCornerAfter = rotatePoint(pivotCube.position, pivotCube.pivot, pivotCube.rotation);
assert.ok(almostEqual(cubeCornerBefore, cubeCornerAfter), 'moving a cube pivot must not move its geometry');

const childCube = new Cube({ position: [2, 0, 0], size: [2, 2, 2], pivot: [3, 1, 1] });
const pivotGroup = new Group({ pivot: [0, 0, 0], rotation: [0, 55, 0], children: [childCube.uid] });
const groupProject = new CubeBricksProject({ elements: [childCube], groups: [pivotGroup], outliner: [pivotGroup.uid] });
const projectChild = groupProject.getNode(childCube.uid), projectGroup = groupProject.getNode(pivotGroup.uid);
const groupCornerBefore = applyGroupTransforms(projectChild.position, [projectGroup]);
setPivotPreservingGeometry(groupProject, projectGroup, [4, 1, -3]);
const groupCornerAfter = applyGroupTransforms(projectChild.position, [projectGroup]);
assert.ok(almostEqual(groupCornerBefore, groupCornerAfter), 'moving a group pivot must not move descendant geometry');

const cutCube = new Cube({ position: [8, 0, 0], size: [-8, 4, 4], pivot: [4, 2, 2] });
const cutSecond = splitCubeAt(cutCube, 0, 3);
assert.deepEqual(cutCube.size, [-5, 4, 4]);
assert.deepEqual(cutSecond.position, [3, 0, 0]);
assert.deepEqual(cutSecond.size, [-3, 4, 4]);
assert.equal(splitCubeAt(cutCube, 0, 8), null);

const texturedCutCube = new Cube({
  position: [0, 0, 0], size: [10, 6, 4], pivot: [5, 3, 2], uvMode: 'face',
  faces: {
    north: { uv: [0, 0, 100, 60], texture: '#skin', rotation: 0 },
    south: { uv: [0, 0, 100, 60], texture: '#skin', rotation: 0 },
    east: { uv: [4, 8, 20, 32], texture: '#east', rotation: 90 },
    west: { uv: [6, 10, 18, 34], texture: '#west', enabled: false }
  }
});
const texturedCutSecond = splitCubeAt(texturedCutCube, 0, 4);
assert.deepEqual(texturedCutCube.faces.north.uv, [60, 0, 100, 60], 'north UV keeps the signed-X start segment');
assert.deepEqual(texturedCutSecond.faces.north.uv, [0, 0, 60, 60], 'north UV continues seamlessly on the second segment');
assert.deepEqual(texturedCutCube.faces.south.uv, [0, 0, 40, 60], 'south UV keeps the signed-X start segment');
assert.deepEqual(texturedCutSecond.faces.south.uv, [40, 0, 100, 60], 'south UV continues seamlessly on the second segment');
assert.deepEqual(texturedCutCube.faces.east, texturedCutSecond.faces.east, 'new east-facing cut surface inherits east face content');
assert.deepEqual(texturedCutCube.faces.west, texturedCutSecond.faces.west, 'new west-facing cut surface inherits west face content');
assert.equal(texturedCutSecond.faces.west.enabled, false, 'directional face visibility is preserved on the cut surface');
assert.ok(Object.values(texturedCutCube.faces).every(face => Array.isArray(face.uv) && face.uv.length === 4),
  'implicit box UV faces are materialized before cutting');

const rotatedUvCube = new Cube({
  position: [0, 0, 0], size: [10, 6, 4], uvMode: 'face',
  faces: { up: { uv: [10, 20, 50, 80], texture: '#top', rotation: 90 } }
});
const rotatedUvSecond = splitCubeAt(rotatedUvCube, 0, 4);
assert.deepEqual(rotatedUvCube.faces.up.uv, [10, 56, 50, 80], 'rotated face UV crops along its rotated V direction');
assert.deepEqual(rotatedUvSecond.faces.up.uv, [10, 20, 50, 56], 'rotated face UV remains continuous after the cut');
assert.equal(rotatedUvSecond.faces.up.rotation, 90, 'face UV rotation survives cutting');

const knifeCube = new Cube({ position: [0, 0, 0], size: [10, 10, 10] });
assert.deepEqual(getKnifeFaceAxes('north'), { normal: 2, horizontal: 0, vertical: 1 });
assert.equal(chooseKnifeCutAxis([3, 4, 0], [3.1, 8, 0], 'north', knifeCube), 0, 'a point near the vertical guide chooses an X cut');
assert.equal(chooseKnifeCutAxis([3, 4, 0], [8, 4.1, 0], 'north', knifeCube), 1, 'a point near the horizontal guide chooses a Y cut');
assert.equal(chooseKnifeCutAxis([0, 4, 0], [.1, 8, 0], 'north', knifeCube), 1, 'a boundary cut is rejected in favour of the other valid axis');
assert.equal(chooseKnifeCutAxis([0, 0, 0], [1, 1, 0], 'north', knifeCube), null, 'two boundary coordinates cannot define a cut');

console.log('Model group import tests passed.');
