import assert from 'node:assert/strict';
import { Cube, Shape, Group, CubeBricksProject, translateNode } from '../src/model.js';
import { actualTransformValue, applyTransform, displayedTransformVector, restoreTransform } from '../src/common/core/applied-transform.js';

for (const node of [
  new Cube({ position: [5, 2, -3], rotation: [20, 30, 0] }),
  new Shape({ origin: [5, 2, -3], rotation: [20, 30, 0] }),
  new Group({ pivot: [5, 2, -3], rotation: [20, 30, 0] })
]) {
  const field = node.type === 'group' ? 'transformPosition' : node.type === 'cube' ? 'position' : 'origin';
  const originalPosition = node.type === 'group' ? [...node.pivot] : [...node[field]];
  const originalRotation = [...node.rotation];
  assert.equal(applyTransform(node, 'position'), true);
  assert.equal(applyTransform(node, 'rotation'), true);
  assert.deepEqual(displayedTransformVector(node, field), [0, 0, 0]);
  assert.ok(displayedTransformVector(node, 'rotation').every(value => Math.abs(value) < 1e-9));
  assert.deepEqual(actualTransformValue(node, field, [2, 0, 0]), [7, 2, -3]);
  const rotated = actualTransformValue(node, 'rotation', [10, 0, 0]);
  assert.ok(rotated.every(Number.isFinite));
  node.rotation = rotated;
  assert.ok(Math.abs(displayedTransformVector(node, 'rotation')[0] - 10) < 1e-8);
  assert.ok(Math.abs(displayedTransformVector(node, 'rotation')[1]) < 1e-8);
  assert.equal(restoreTransform(node, 'position'), true);
  assert.equal(restoreTransform(node, 'rotation'), true);
  assert.deepEqual(displayedTransformVector(node, field), originalPosition);
  assert.deepEqual(displayedTransformVector(node, 'rotation'), rotated);
  node.rotation = originalRotation;
}

const cube = new Cube({ position: [4, 0, 1], rotation: [0, 45, 0] });
applyTransform(cube, 'position');
applyTransform(cube, 'rotation');
const project = new CubeBricksProject({ elements: [cube], groups: [] });
const reopened = new CubeBricksProject(JSON.parse(project.serialize()));
assert.deepEqual(displayedTransformVector(reopened.elements[0], 'position'), [0, 0, 0]);
assert.deepEqual(reopened.elements[0].position, [4, 0, 1]);
assert.deepEqual(reopened.elements[0].rotation, [0, 45, 0]);
const child = new Cube({ position: [3, 0, 0] });
const parent = new Group({ pivot: [0, 0, 0], children: [child.uid] });
applyTransform(child, 'position');
const nested = new CubeBricksProject({ elements: [child], groups: [parent] });
translateNode(nested, parent, [2, 0, 0]);
assert.deepEqual(displayedTransformVector(child, 'position'), [0, 0, 0]);
assert.deepEqual(displayedTransformVector(parent, 'transformPosition'), [2, 0, 0]);
console.log('Applied transform checks passed.');
