import assert from 'node:assert/strict';
import {
  ColorSpaceCurveViewport, changeColorSpaceMode, colorAtPosition, constrainColorPosition, createColorSpaceCurve,
  colorSpaceArcLengthPositions, gradientRatioToUniform, sampleColorSpaceGradient, sampleColorSpacePosition
} from '../src/screen/color-space-gradient.js';

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

let previewDraws = 0, previewBlits = 0;
const preview = Object.create(ColorSpaceCurveViewport.prototype);
preview.yaw = 0; preview.pitch = .5; preview.perspective = false;
preview.canvas = { clientWidth: 500 };
preview.context = { drawImage: () => previewBlits++ };
preview.spacePreviewRenderer = {
  canvas: {}, program: {}, key: null, position: 0, color: 1, stride: 24,
  meshes: new Map(['rgb_cube', 'hsv_cube', 'hsv_cylinder'].map(mode => [mode,
    { vertexBuffer: {}, indexBuffer: {}, indexCount: 12 }])),
  gl: { COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 2, TRIANGLES: 4, UNSIGNED_SHORT: 5, ARRAY_BUFFER: 6,
    ELEMENT_ARRAY_BUFFER: 7, FLOAT: 8, useProgram() {}, bindBuffer() {}, vertexAttribPointer() {},
    uniform3fv() {}, uniform1f() {}, clear() {}, drawElements() { previewDraws++; } }
};
preview.drawMergedSpacePreview('hsv_cylinder');
preview.drawMergedSpacePreview('hsv_cylinder');
assert.equal(previewDraws, 1, 'unchanged preview reuses its merged mesh frame');
assert.equal(previewBlits, 2, 'preview frame is composited in one draw each time');
preview.yaw = .2;
preview.drawMergedSpacePreview('hsv_cylinder');
assert.equal(previewDraws, 2, 'camera change updates the merged mesh projection');
preview.drawMergedSpacePreview('rgb_cube');
assert.equal(previewDraws, 3, 'RGB cube switches to its own prebuilt mesh');
preview.drawMergedSpacePreview('hsv_cube');
assert.equal(previewDraws, 4, 'HSV cube switches to its own prebuilt mesh');
preview.drawMergedSpacePreview('hsv_cube');
assert.equal(previewDraws, 4, 'unchanged HSV cube does not redraw its mesh');

const gizmo = Object.create(ColorSpaceCurveViewport.prototype);
gizmo.canvas = { clientWidth: 500, clientHeight: 500, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
gizmo.context = { beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, save() {}, restore() {} };
gizmo.yaw = -.72; gizmo.pitch = .5; gizmo.perspective = false; gizmo.axisMode = 'all';
gizmo.drag = null; gizmo.hover = null; gizmo.selected = 0;
gizmo.curve = { mode: 'rgb_cube' };
gizmo.line = () => {};
for (const zoom of [.45, 1, 3]) {
  gizmo.zoom = zoom; gizmo.hitTargets = [];
  gizmo.drawGizmo([.5, .5, .5]);
  const origin = gizmo.project([.5, .5, .5]);
  assert.ok(gizmo.hitTargets.every(target => Math.abs(Math.hypot(target.x - origin.x, target.y - origin.y) - 54) < .001),
    'straight gizmo handles keep a constant screen length when zoom changes');
}
gizmo.curve.mode = 'hsv_cylinder'; gizmo.zoom = .45; gizmo.hitTargets = [];
let hueArc = null;
gizmo.line = points => { if (points.length === 31) hueArc = points; };
gizmo.drawGizmo([.03, .5, 0]);
assert.ok(hueArc, 'cylinder hue handle remains visible away from the center');
const arcSpan = Math.atan2(hueArc.at(-1)[2], hueArc.at(-1)[0]) - Math.atan2(hueArc[0][2], hueArc[0][0]);
assert.ok(Math.abs(arcSpan - Math.PI) < .001, 'cylinder hue handle stops at a 180-degree arc');
for (const perspective of [false, true]) {
  gizmo.perspective = perspective;
  const point = [.6, .5, .2], projected = gizmo.project(point);
  const onPlane = gizmo.pointerOnCylinderPlane({ clientX: projected.x, clientY: projected.y }, point[1]);
  assert.ok(onPlane.every((value, axis) => Math.abs(value - point[axis]) < 1e-6),
    'hue dragging projects the pointer onto its cylinder plane in both camera modes');
}

console.log('Color-space gradient tests passed.');
