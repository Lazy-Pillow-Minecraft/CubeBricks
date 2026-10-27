import assert from 'node:assert/strict';
import { Cube, CubeBricksProject } from '../src/model.js';
import {
  formatRules, constrainCube, projectSizeBounds, bedrockSizeIsValid, bedrockLimitBox,
  captureFormatGeometry, keepFormatEditWithinLimit, javaBlockSizeIsValid
} from '../src/common/core/format-constraints.js';

const java = new CubeBricksProject({ formatId: 'java_block_item' });
const javaRules = formatRules(java);
assert.equal(javaRules.forceCullFaces, true);
const diagonal = new Cube({ position: [29, -20, -18], size: [8, 8, 8],
  pivot: [29, -20, -18], rotation: [0, 45, 0] });
constrainCube(diagonal, javaRules);
assert.deepEqual(diagonal.position, [24, -16, -16]);
assert.deepEqual(diagonal.rotation, [0, 45, 0]);
assert.deepEqual(diagonal.size, [8, 8, 8]);
java.elements.push(diagonal);
assert.equal(javaBlockSizeIsValid(java), true);
const legacyTurn = new Cube({ rotation: [0, 90, 0] });
constrainCube(legacyTurn, javaRules);
assert.deepEqual(legacyTurn.rotation, [0, 45, 0]);

const bedrock = new CubeBricksProject({ formatId: 'bedrock_block', elements: [
  { type: 'cube', position: [-8, 0, -8], size: [16, 16, 16], pivot: [0, 8, 0] }
] });
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

const rotated = new CubeBricksProject({ formatId: 'bedrock_block', elements: [
  { type: 'cube', position: [-1, 0, -1], size: [2, 2, 2], pivot: [0, 0, 0], rotation: [0, 45, 0] }
] });
const bounds = projectSizeBounds(rotated);
assert.ok(bounds.max[0] > 1.4 && bounds.min[0] < -1.4);
console.log('format limit checks passed');
