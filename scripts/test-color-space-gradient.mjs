import assert from 'node:assert/strict';
import {
  changeColorSpaceMode, colorAtPosition, constrainColorPosition, createColorSpaceCurve,
  colorSpaceArcLengthPositions, gradientRatioToUniform, sampleColorSpaceGradient, sampleColorSpacePosition
} from '../src/ui/color-space-gradient.js';

const curve = createColorSpaceCurve(['#ff0000', '#0000ff']);
assert.equal(curve.mode, 'hsv_cube');
assert.equal(curve.nodes.length, 2);
assert.ok(curve.nodes.every(node => node.autoTangent && node.symmetricHandles));
assert.equal(sampleColorSpaceGradient(curve, 0), '#ff0000');
assert.equal(sampleColorSpaceGradient(curve, 1), '#0000ff');

const rgbCurve = createColorSpaceCurve(['#000000', '#ffffff'], 'rgb_cube');
rgbCurve.nodes[0].autoTangent = false;
rgbCurve.nodes[1].autoTangent = false;
rgbCurve.nodes[0].handleOut = [1, 0, 0];
rgbCurve.nodes[1].handleIn = [0, -1, 0];
const middle = sampleColorSpacePosition(rgbCurve, .5);
assert.ok(middle[0] > middle[1], 'Bezier samples positions in color space, not endpoint RGB interpolation');
assert.notEqual(sampleColorSpaceGradient(rgbCurve, .5), '#808080');

const originalStart = sampleColorSpaceGradient(curve, 0);
changeColorSpaceMode(curve, 'hsv_cylinder');
assert.equal(sampleColorSpaceGradient(curve, 0), originalStart);
assert.deepEqual(constrainColorPosition([2, 1.4, 0], 'hsv_cylinder'), [1, 1, 0]);
assert.equal(colorAtPosition([3, -2, 0], 'rgb_cube'), '#ff0000');

const previous = sampleColorSpaceGradient(rgbCurve, 1);
rgbCurve.nodes[1].position = [0, 0, 1];
rgbCurve.revision++;
assert.notEqual(sampleColorSpaceGradient(rgbCurve, 1), previous, 'editing a node invalidates gradient samples');

const distanceCurve = createColorSpaceCurve(['#000000', '#191919', '#ffffff'], 'rgb_cube');
distanceCurve.nodes.forEach(node => { node.handlesEnabled = false; });
distanceCurve.nodes[0].position = [0, 0, 0];
distanceCurve.nodes[1].position = [.1, 0, 0];
distanceCurve.nodes[2].position = [1, 0, 0];
const distances = colorSpaceArcLengthPositions(distanceCurve);
assert.ok(Math.abs(distances[1] - .1) < .001, 'curve-length mode divides by actual Bezier segment lengths');
assert.ok(Math.abs(gradientRatioToUniform(.1, distances) - .5) < .001, 'bar position maps to the correct curve node');
assert.ok(Math.abs(gradientRatioToUniform(.25, [0, .25, 1]) - .5) < .001, 'custom split maps to the selected node');
assert.equal(gradientRatioToUniform(0, [.2, .8]), 0, 'custom first stop can move in from the bar edge');
assert.equal(gradientRatioToUniform(1, [.2, .8]), 1, 'custom last stop can move in from the bar edge');

console.log('Color-space gradient tests passed.');
