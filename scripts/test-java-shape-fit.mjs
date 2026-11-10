import assert from 'node:assert/strict';
import { Shape, BezierElement, CubeBricksProject, exportBlockbench } from '../src/model.js';
import { proceduralCubeWorld } from '../src/common/core/procedural-format.js';
import { formatRules } from '../src/common/core/format-constraints.js';
import { JavaBlockVersion } from '../src/common/core/java-block-version.js';
import { rotateVector, inverseRotateVector } from '../src/utils/math/rotation.js';
import { foldJavaCubeRotation } from '../src/utils/math/cube-quarter-turn.js';

const near = (actual, expected, label) => assert.ok(actual.every((value, axis) => Math.abs(value - expected[axis]) < 1e-6), label);
const worldCenter = cube => rotateVector(cube.position.map((value, axis) => value + cube.size[axis] / 2 - cube.pivot[axis]), cube.rotation)
  .map((value, axis) => value + cube.pivot[axis]);
const contains = (cube, point) => {
  const local = inverseRotateVector(point.map((value, axis) => value - cube.pivot[axis]), cube.rotation)
    .map((value, axis) => value + cube.pivot[axis]);
  return local.every((value, axis) => value >= Math.min(cube.position[axis], cube.position[axis] + cube.size[axis]) - 1e-6
    && value <= Math.max(cube.position[axis], cube.position[axis] + cube.size[axis]) + 1e-6);
};

for (const version of [JavaBlockVersion.LEGACY, JavaBlockVersion.SINGLE_AXIS]) {
  for (const rotation of [[0, 0, 0], [22.5, 0, 0], [13, 21, 8]]) {
    const project = new CubeBricksProject({
      formatId: 'java_block_item', formatData: { javaBlockVersion: version },
      elements: [new Shape({ origin: [0, 2, 0], rotation, parameters: { radius: 6, height: 8, sides: 12 } })]
    });
    const shape = project.elements[0], raw = shape.toBaseCubes(), cubes = shape.toCubes();
    assert.equal(cubes.length, raw.length, 'polygon fitting retains oriented edge beams, with no voxel fill');
    let rotated = 0;
    cubes.forEach((cube, index) => {
      near(cube.size, raw[index].size, 'snapping the polygon orientation must not expand its dimensions');
      const world = proceduralCubeWorld(shape, cube, project);
      near(worldCenter(world), worldCenter(proceduralCubeWorld(shape, raw[index], project)), 'polygon beams retain their physical centers');
      assert.equal(foldJavaCubeRotation(world, { ...formatRules(project), strict: true }), true);
      if (world.rotation.some(value => Math.abs(value) > 1e-6)) rotated++;
    });
    assert.ok(rotated >= cubes.length / 2, 'oblique polygon edges use the available legal rotations');
  }

  for (const [dimension, end, rotation] of [[2, [16, 0, 5], [-90, 0, 0]], [3, [16, 7, 4], [0, 0, 0]]]) {
    const project = new CubeBricksProject({
      formatId: 'java_block_item', formatData: { javaBlockVersion: version },
      elements: [new BezierElement({
        rotation, nodes: [{ position: [0, 0, 0] }, { position: end }],
        parameters: { thickness: 1, segmentationMode: 'angle', angleStep: 30 }
      }, dimension)]
    });
    const owner = project.elements[0], raw = owner.toBaseCubes(), cubes = owner.toCubes();
    const world = cubes.map(cube => proceduralCubeWorld(owner, cube, project));
    assert.ok(cubes.length >= raw.length && cubes.length <= 12, 'fit a sparse set of rotated beams instead of filling a voxel volume');
    for (const cube of cubes) near(cube.size.slice(0, 2), [1, 1], 'curve cross-section remains the requested thickness');
    const legal = exportBlockbench(project).elements;
    assert.ok(legal.some(cube => cube.rotation.some(value => Math.abs(value) > 1e-6)), 'curve export uses allowed nonzero angles');
    for (let index = 0; index <= 200; index++) {
      const point = rotateVector(end.map(value => value * index / 200), rotation);
      assert.ok(world.some(cube => contains(cube, point)), 'the fitted beams continuously cover the sampled three-dimensional path');
    }
    if (dimension === 2 && version === JavaBlockVersion.SINGLE_AXIS) assert.equal(cubes.length, raw.length,
      'arbitrary permitted planar angles need no additional segments');
    assert.equal(JSON.stringify(owner.toCubes()), JSON.stringify(cubes), 'repeated fitting is stable');
  }
}

const unrestricted = new CubeBricksProject({
  formatId: 'java_block_item', formatData: { javaBlockVersion: JavaBlockVersion.UNRESTRICTED },
  elements: [new BezierElement({
    nodes: [{ position: [0, 0, 0] }, { position: [16, 7, 4] }],
    parameters: { thickness: 1, segmentationMode: 'angle', angleStep: 30 }
  }, 3)]
});
const owner = unrestricted.elements[0], raw = owner.toBaseCubes(), cubes = owner.toCubes();
assert.equal(cubes.length, raw.length);
cubes.forEach((cube, index) => {
  near(cube.size, raw[index].size, 'unrestricted shapes retain original dimensions');
  near(cube.rotation, raw[index].rotation, 'unrestricted shapes retain original rotations');
});
const zeroRadius = new CubeBricksProject({
  elements: [new BezierElement({
    variant: 'envelope',
    nodes: [{ position: [0, 0, 0] }, { position: [16, 7, 4] }],
    parameters: { radius: 0, segmentationMode: 'angle' }
  }, 3)]
}).elements[0];
assert.equal(zeroRadius.toCubes().length, zeroRadius.toBaseCubes().length, 'zero-radius curves cannot create thousands of invisible fitting segments');
console.log('Java Shape fitting preserves beam thickness and centers, uses legal oblique angles, and continuously follows the 3D path.');
