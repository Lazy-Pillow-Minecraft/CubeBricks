import assert from 'node:assert/strict';
import { Cube, Shape, CubeBricksProject, addModifier, exportBlockbench, importBlockbench } from '../src/model.js';
import {
  formatRules, constrainCube, projectSizeBounds, bedrockSizeIsValid, bedrockLimitBox,
  captureFormatGeometry, keepFormatEditWithinLimit, javaBlockSizeIsValid, constrainProject
} from '../src/common/core/format-constraints.js';

const java = new CubeBricksProject({ formatId: 'java_block_item' });
const javaRules = formatRules(java);
assert.equal(javaRules.forceCullFaces, true);
const diagonal = new Cube({
  position: [29, -20, -18], size: [8, 8, 8],
  pivot: [29, -20, -18], rotation: [0, 45, 0]
});
constrainCube(diagonal, javaRules);
assert.deepEqual(diagonal.position, [24, -16, -16]);
assert.deepEqual(diagonal.rotation, [0, 45, 0]);
assert.deepEqual(diagonal.size, [8, 8, 8]);
java.elements.push(diagonal);
assert.equal(javaBlockSizeIsValid(java), true);
const legacyTurn = new Cube({ rotation: [0, 90, 0] });
constrainCube(legacyTurn, javaRules);
assert.deepEqual(legacyTurn.rotation, [0, 0, 0], 'whole quarter turns are baked instead of being clamped to 45 degrees');

const unbounded = new CubeBricksProject({ formatId: 'java_block_item',
  formatData: { javaBlockBoundsEnabled: false }, elements: [new Cube({ uid: 'large',
    position: [-100, 50, 80], size: [70, 2, -90], pivot: [0, 0, 0], uvMode: 'face' })] });
const unboundedRules = formatRules(unbounded), large = unbounded.getNode('large');
constrainCube(large, unboundedRules);
assert.deepEqual(large.position, [-100, 50, 80]);
assert.deepEqual(large.size, [70, 2, -90]);
assert.equal(unboundedRules.javaBlockBounds, false);
assert.equal(unboundedRules.forceCullFaces, true);
assert.equal(unboundedRules.allowBoxUv, false);
assert.equal(unboundedRules.singleAxisRotation, true, 'disabling position limits does not disable version-specific rotation rules');
const freelyMoved = captureFormatGeometry([large]);
large.position[0] = 500;
assert.equal(keepFormatEditWithinLimit(unbounded, freelyMoved), true);
assert.equal(large.position[0], 500);
assert.equal(unbounded.getFormatDomain(), null);
const saved = new CubeBricksProject(JSON.parse(unbounded.serialize()));
assert.equal(saved.formatData.javaBlockBoundsEnabled, false);
const largeBb = exportBlockbench(unbounded);
assert.equal(largeBb.java_block_bounds, false);
assert.deepEqual(largeBb.elements[0].from, large.position, 'bbmodel export does not reapply disabled region limits');
assert.equal(importBlockbench(largeBb).formatData.javaBlockBoundsEnabled, false);

const importCube = (from, to, extra = {}) => importBlockbench({ meta: { model_format: 'java_block' },
  elements: [{ uuid: 'imported', type: 'cube', from, to, origin: [0, 0, 0], ...extra }] });
for (const [from, to] of [[[-20, 0, 0], [-18, 2, 2]], [[0, 0, 0], [60, 2, 2]], [[70, 2, 2], [-20, 0, 0]]]) {
  const imported = importCube(from, to);
  assert.equal(imported.formatData.javaBlockBoundsEnabled, false, 'out-of-range bbmodels opt out before fitting');
  constrainProject(imported);
  assert.deepEqual(imported.elements[0].position, from);
  assert.deepEqual(imported.elements[0].size, to.map((value, axis) => value - from[axis]));
}
assert.equal(importCube([24, 0, 0], [32, 8, 8], { rotation: [0, 45, 0] }).formatData.javaBlockBoundsEnabled,
  true, 'a rotated visual corner outside the box does not invalidate legal Java from/to coordinates');
const metadata = importBlockbench({ meta: { model_format: 'java_block' },
  _cubebricksFormatData: { javaBlockBoundsEnabled: true },
  elements: [{ type: 'cube', from: [100, 0, 0], to: [102, 2, 2] }] });
assert.equal(metadata.formatData.javaBlockBoundsEnabled, false, 'oversized geometry takes precedence over stale import metadata');

const owner = new Cube({ uid: 'modifier', size: [2, 2, 2], position: [0, 0, 0], pivot: [0, 0, 0] });
addModifier(owner, 'element_copy').nodes[0].position = [100, 0, 0];
const modifierProject = new CubeBricksProject({ formatId: 'java_block_item',
  formatData: { javaBlockBoundsEnabled: false }, elements: [owner] });
constrainProject(modifierProject);
assert.deepEqual(modifierProject.getNode('modifier').modifiers[0].nodes[0].position, [100, 0, 0]);
const shape = new Shape({ uid: 'distant-shape', origin: [100, 0, 0], parameters: { sides: 4, radius: 3, height: 4 } });
const shapeProject = new CubeBricksProject({ formatId: 'java_block_item',
  formatData: { javaBlockBoundsEnabled: false }, elements: [shape] });
const source = shapeProject.getNode(shape.uid), fitted = source.toCubes(shapeProject);
assert.ok(fitted.length);
assert.ok(fitted.some(cube => shapeProject.getProceduralFormatBox(source, cube).position[0] > 32),
  'procedural cube fitting obeys the project region-limit switch');
assert.ok(exportBlockbench(shapeProject).elements.some(cube => cube.from[0] > 32));

const bedrock = new CubeBricksProject({
  formatId: 'bedrock_block', elements: [
    { type: 'cube', position: [-8, 0, -8], size: [16, 16, 16], pivot: [0, 8, 0] }
  ]
});
assert.equal(bedrockSizeIsValid(projectSizeBounds(bedrock)), true);
assert.deepEqual(bedrockLimitBox(projectSizeBounds(bedrock)).min, [-15, -7, -15]);
const cube = bedrock.elements[0];
const before = captureFormatGeometry([cube]);
cube.size[0] = 31;
assert.equal(keepFormatEditWithinLimit(bedrock, before), false);
assert.deepEqual(cube.size, [16, 16, 16]);
cube.position[0] = 20;
assert.equal(bedrockSizeIsValid(projectSizeBounds(bedrock)), false);
cube.position[0] = 7;
cube.size[0] = 15;
assert.equal(bedrockSizeIsValid(projectSizeBounds(bedrock)), true);
cube.size[0] = 16;
assert.equal(bedrockSizeIsValid(projectSizeBounds(bedrock)), false);
cube.position[0] = -8;
cube.size[0] = 16;
cube.position[1] = 15;
cube.size[1] = 1;
assert.equal(bedrockSizeIsValid(projectSizeBounds(bedrock)), true);
cube.position[1] = 16;
assert.equal(bedrockSizeIsValid(projectSizeBounds(bedrock)), false);

const rotated = new CubeBricksProject({
  formatId: 'bedrock_block', elements: [
    { type: 'cube', position: [-1, 0, -1], size: [2, 2, 2], pivot: [0, 0, 0], rotation: [0, 45, 0] }
  ]
});
const bounds = projectSizeBounds(rotated);
assert.ok(bounds.max[0] > 1.4 && bounds.min[0] < -1.4);
console.log('format limit checks passed');
