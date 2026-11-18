import assert from 'node:assert/strict';
import { incrementNumber, nextSelectIndex, numericKind, numericStep, numericBounds } from '../src/screen/number-input/policy.js';
import { beginNumericEdit, endNumericEdit, claimNumericSnapshot, isNumericEditActive } from '../src/common/core/numeric-edit-session.js';

const field = (dataset = {}, attributes = {}, extra = {}) => ({ dataset,
  getAttribute: name => attributes[name] ?? null, closest: () => null, ...extra });
const snaps = {
  getSnapStep: event => event.shiftKey && event.ctrlKey ? 1 / 64 : event.shiftKey ? .25 : event.ctrlKey ? 2 : 1,
  getAngleSnapStep: event => event.shiftKey && event.ctrlKey ? .05 : event.shiftKey ? .5 : event.ctrlKey ? 15 : 2.5
};
for (const name of ['position', 'size', 'pivot', 'transformPosition', 'curve-node:2:handleOut']) {
  const input = field({ vector: name });
  assert.equal(numericStep(input, {}, snaps), 1);
  assert.equal(numericStep(input, { shiftKey: true }, snaps), .25);
  assert.equal(numericStep(input, { ctrlKey: true }, snaps), 2);
  assert.equal(numericStep(input, { shiftKey: true, ctrlKey: true }, snaps), 1 / 64);
}
for (const dataset of [{ vector: 'rotation' }, { vector: 'curve-node:2:rotation' },
  { modifierVector: 'nodes.uid.rotation' }, { operatorVector: 'anchor.rotation' },
  { curveNodeRoll: '1' }, { modifierField: 'rangeEnd' }, { parameter: 'angleStep' }]) {
  assert.equal(numericKind(field(dataset)), 'angle');
  assert.equal(numericStep(field(dataset), { ctrlKey: true }, snaps), 15);
}
assert.equal(numericStep(field({ uvCoordinate: '3' }), {}, snaps), 1);
assert.equal(numericStep(field({ parameter: 'sides' }, { step: '1' }), { shiftKey: true }, snaps), 1);
assert.equal(numericStep(field({}, { step: '.1' }), { shiftKey: true }, snaps), .025);
assert.equal(numericStep(field({}, { step: 'any' }), {}, snaps), 1);
assert.equal(numericStep(field({}, { step: '10' }), { shiftKey: true }, snaps), 3);
assert.equal(numericStep(field({ numericStep: '.1' }, { step: 'any' }), { shiftKey: true }, snaps), .025);
assert.equal(numericKind(field({ parameter: 'sides', numericStep: '1' }, { step: 'any' })), 'local');
assert.equal(numericKind(field({ parameter: 'width' }, { step: '1' }, { previousElementSibling: { tagName: 'B' } })), 'distance');
assert.deepEqual(numericBounds(field({}, { 'data-min': '3', max: '256' })), { min: 3, max: 256 });
assert.deepEqual(numericBounds(field()), { min: -Infinity, max: Infinity });
assert.equal(incrementNumber(.13, 1, .25), .25);
assert.equal(incrementNumber(.13, -1, .25), 0);
assert.equal(incrementNumber(-.13, 1, .25), 0);
assert.equal(incrementNumber(-.13, -1, .25), -.25);
assert.equal(incrementNumber(.3, 1, .1), .4);
assert.equal(incrementNumber(.3, -1, .1), .2);
assert.equal(incrementNumber(NaN, 1, 1, { min: 3 }), 3);
assert.equal(incrementNumber(100, 500, 1, { max: 100 }), 100);
assert.equal(incrementNumber(1, -5, .25, { min: .0001 }), .0001);
const options = [{}, { disabled: true }, { parentElement: { disabled: true } }, { hidden: true }, {}, { parentElement: { hidden: true } }];
assert.equal(nextSelectIndex(options, 0, 1), 4);
assert.equal(nextSelectIndex(options, 4, -1), 0);
assert.equal(nextSelectIndex(options, 4, 1), 4);
const project = {}, other = {};
const edit = beginNumericEdit(project);
assert.equal(isNumericEditActive(project), true);
assert.equal(isNumericEditActive(other), false);
assert.equal(claimNumericSnapshot(project, 'move'), true);
assert.equal(claimNumericSnapshot(project, 'move'), false);
assert.equal(claimNumericSnapshot(project, 'size'), true);
assert.equal(claimNumericSnapshot(other, 'move'), true);
endNumericEdit({});
assert.equal(isNumericEditActive(project), true);
endNumericEdit(edit);
assert.equal(isNumericEditActive(project), false);
assert.equal(claimNumericSnapshot(project, 'move'), true);
console.log('Number input snapping, limits, option navigation and undo grouping passed.');
