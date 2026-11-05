import assert from 'node:assert/strict';
import { Cube, CubeBricksProject, addModifier, buildModifierRenderInstances, exportBlockbench, importBlockbench } from '../src/model.js';
import { createSignedCubeCorners } from '../src/render/webgl-renderer.js';
import { createBlockbenchFaceUvSlots, rotatePoint, rescaleRotationPoint, isCubeFaceCulled } from '../src/common/core/geometry-utils.js';
import { formatRules, constrainCube, captureFormatGeometry } from '../src/common/core/format-constraints.js';
import { JavaBlockVersion, blockbenchJavaVersion } from '../src/common/core/java-block-version.js';
import { quaternionFromEuler, quaternionMultiply, eulerFromQuaternion } from '../src/utils/math/rotation.js';
import { createTransformInteraction } from '../src/editor/transform-interaction.js';
import { encodeNativeJson, decodeNativeJson } from '../src/model/formats/native-json.js';
import { applyTransform, displayedTransformVector } from '../src/common/core/applied-transform.js';

const layouts = { south: [7, 6, 4, 5], north: [2, 3, 1, 0], east: [6, 2, 5, 1], west: [3, 7, 0, 4], up: [3, 2, 7, 6], down: [4, 5, 0, 1] };
const faces = Object.fromEntries(Object.keys(layouts).map((name, index) => [name, name === 'south' ? null : {
  texture: `#${index}`, uv: index % 2 ? [6, 2, 1, 8] : [1, 8, 6, 2], rotation: index % 4 * 90, cullface: name,
  ...(name === 'east' ? { enabled: false } : {})
}]));
const near = (a, b) => a.every((value, index) => Math.abs(value - b[index]) < 1e-5);
function surfaces(cube) {
  const points = createSignedCubeCorners(cube.position, cube.size, cube.inflate)
    .map(point => rescaleRotationPoint(point, cube.pivot, cube.rotation, cube.rescale))
    .map(point => rotatePoint(point, cube.pivot, cube.rotation));
  return Object.entries(layouts).flatMap(([name, slots]) => {
    const face = cube.faces?.[name]; if (isCubeFaceCulled(face)) return [];
    const uv = createBlockbenchFaceUvSlots(face.uv, face.rotation);
    const quad = slots.map(slot => points[slot]);
    const u = quad[2].map((value, axis) => value - quad[0][axis]), v = quad[1].map((value, axis) => value - quad[0][axis]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return [{ texture: face.texture, normal: normal.map(value => value / Math.hypot(...normal)),
      vertices: quad.map((point, slot) => [...point, ...uv[slot]]) }];
  });
}
function sameGeometry(actual, expected, message) {
  assert.equal(actual.length, expected.length, `${message}: culled faces stay culled`);
  for (const face of expected) {
    const same = actual.some(other => other.texture === face.texture && near(other.normal, face.normal)
      && face.vertices.every(vertex => other.vertices.some(point => near(point, vertex))));
    assert.ok(same, `${message}: geometry, winding and UVs agree`);
  }
}
const rules = formatRules({ formatId: 'java_block_item' });
const angles = [0, 90, 180, 270], signSets = [[1, 1, 1], [-1, 1, 1], [1, -1, -1], [-1, -1, -1]];
for (const x of angles) for (const y of angles) for (const z of angles) for (const residualAxis of [0, 1, 2]) {
  const residual = [0, 0, 0]; residual[residualAxis] = 22.5;
  const rotation = eulerFromQuaternion(quaternionMultiply(quaternionFromEuler(residual), quaternionFromEuler([x, y, z])));
  for (const signs of signSets) {
    const cube = new Cube({ position: [2, 3, 4], size: [2, 3, 4].map((value, axis) => value * signs[axis]),
      pivot: [6, 8, 10], rotation, uvMode: 'face', faces, inflate: .15 });
    const expected = surfaces(cube), context = `${x}/${y}/${z}, residual ${residualAxis}, signs ${signs}`;
    constrainCube(cube, rules);
    sameGeometry(surfaces(cube), expected, context);
    assert.ok(cube.rotation.filter(value => Math.abs(value) > 1e-7).length <= 1);
    assert.ok(cube.rotation.every(value => Math.abs(value) <= 45 && Math.abs(value / 22.5 - Math.round(value / 22.5)) < 1e-7));
    const once = JSON.stringify(cube); constrainCube(cube, rules);
    assert.equal(JSON.stringify(cube), once, 'normalization is idempotent');
  }
}
for (const rotation of [[0, 67.5, 0], [90, 22.5, 0], [22.5, 90, 0], [-180, 0, 112.5]]) {
  const cube = new Cube({ position: [5, 6, 7], size: [-2, 3, 4], pivot: [6, 8, 10], rotation,
    uvMode: 'face', faces, rescale: true, inflate: .1 });
  const expected = surfaces(cube); constrainCube(cube, rules);
  sameGeometry(surfaces(cube), expected, `rescale ${rotation}`);
}
const arbitrary = new Cube({ position: [2, 3, 4], size: [2, 3, 4], pivot: [6, 8, 10],
  rotation: [90, 37, 180], faces, uvMode: 'face' });
const arbitraryGeometry = surfaces(arbitrary);
constrainCube(arbitrary, formatRules({ formatId: 'java_block_item', formatData: { javaBlockVersion: JavaBlockVersion.SINGLE_AXIS } }));
sameGeometry(surfaces(arbitrary), arbitraryGeometry, 'single-axis versions preserve arbitrary fractional angles');
const unlimited = new Cube({ rotation: [90, 37, 18] });
constrainCube(unlimited, formatRules({ formatId: 'java_block_item', formatData: { javaBlockVersion: JavaBlockVersion.UNRESTRICTED } }));
assert.deepEqual(unlimited.rotation, [90, 37, 18]);
const applied = new Cube({ position: [2, 3, 4], size: [2, 3, 4], pivot: [6, 8, 10], rotation: [90, 22.5, 0], faces, uvMode: 'face' });
applyTransform(applied, 'rotation'); applyTransform(applied, 'position');
const appliedGeometry = surfaces(applied); constrainCube(applied, rules);
sameGeometry(surfaces(applied), appliedGeometry, 'applied transforms');
assert.ok(near(displayedTransformVector(applied, 'rotation'), [0, 0, 0]), 'applied rotation remains zero in the inspector');
assert.ok(near(displayedTransformVector(applied, 'position'), [0, 0, 0]), 'applied position remains zero in the inspector');

for (const type of ['symmetry', 'element_copy']) {
  const cube = new Cube({ uid: 'attached', position: [2, 3, 4], size: [-2, 3, 4], pivot: [6, 8, 10],
    rotation: [90, 22.5, 0], uvMode: 'face', faces });
  const modifier = addModifier(cube, type, { ignoreDuplicateCubes: false,
    anchor: { position: [5, 2, 7], rotation: [11, 17, 31] } });
  if (type === 'element_copy') modifier.nodes = [{ uid: 'node', position: [16, 6, 3], rotation: [13, 29, 23] }];
  const project = new CubeBricksProject({ elements: [cube], outliner: [cube.uid] });
  const rendered = () => {
    const base = surfaces(project.getNode(cube.uid));
    return [...base, ...buildModifierRenderInstances(project).flatMap(instance => base.map(face => ({
      texture: face.texture, normal: instance.matrix.map(row => row.reduce((sum, value, axis) => sum + value * face.normal[axis], 0)),
      vertices: face.vertices.map(vertex => [...instance.matrix.map((row, axis) => row.reduce((sum, value, component) => sum + value * vertex[component], instance.translation[axis])), ...vertex.slice(3)])
    })))];
  };
  const expected = rendered(); constrainCube(project.getNode(cube.uid), rules);
  sameGeometry(rendered(), expected, `attached ${type}`);
}

for (const version of Object.values(JavaBlockVersion)) {
  const project = new CubeBricksProject({ formatId: 'java_block_item', formatData: { javaBlockVersion: version } });
  const bb = exportBlockbench(project);
  assert.equal(bb.java_block_version, blockbenchJavaVersion(version));
  assert.equal(bb.meta.format_version, '4.10', 'Minecraft version never overwrites the bbmodel container version');
  assert.equal(importBlockbench(bb).formatData.javaBlockVersion, version);
  const native = decodeNativeJson({ format_version: bb.java_block_version, elements: [] });
  assert.equal(importBlockbench(native).formatData.javaBlockVersion, version, 'native import retains an explicitly chosen version');
}
assert.equal(importBlockbench({ meta: { model_format: 'java_block' }, elements: [] }).formatData.javaBlockVersion, JavaBlockVersion.LEGACY);

const nativeCube = new Cube({ uid: 'native', position: [2, 3, 4], size: [-2, 3, 4], pivot: [6, 8, 10],
  rotation: [22.5, 90, 0], faces, uvMode: 'face' });
const nativeBb = exportBlockbench(new CubeBricksProject({ elements: [nativeCube], outliner: [nativeCube.uid] }),
  Array.from({ length: 6 }, (_, index) => ({ id: String(index), uuid: `texture-${index}`, uvWidth: 16, uvHeight: 16 })));
const json = encodeNativeJson(nativeBb, Array.from({ length: 6 }, (_, index) => ({ resource: `demo:${index}` })), 'java_block_item');
assert.ok(json.elements[0].rotation.axis && Math.abs(json.elements[0].rotation.angle) <= 45);
assert.throws(() => encodeNativeJson({ ...nativeBb, elements: [{ ...nativeBb.elements[0], rotation: [20, 17, 11] }] }, [], 'java_block_item'),
  /不能导出/, 'native export rejects fractional multi-axis poses that cannot be represented exactly');

// A drag is always recomputed from its initial geometry, including UVs. Crossing
// 90 degrees repeatedly and then returning to the starting angle cannot roll twice.
const draggingCube = new Cube({ position: [2, 3, 4], size: [2, 3, 4], pivot: [6, 8, 10], faces, uvMode: 'face' });
const project = new CubeBricksProject({ elements: [draggingCube], outliner: [draggingCube.uid] });
const node = project.getNode(draggingCube.uid), baseline = structuredClone(node);
const ui = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
const interaction = createTransformInteraction({ state: { project, dirty: true }, $: () => ui,
  getAngleSnapStep: () => 22.5, snapAngle: (value, step) => Math.round(value / step) * step,
  formatSigned: String, invalidateSelectionRenderGeometry() {}, syncInspectorValues() {}, sceneRenderer: {} });
const drag = { item: node, targets: [{ node }], kind: 'rotate', tool: 'rotate', axisIndex: 1,
  axis: { vector: [0, 1, 0], worldPerPixel: 1 }, gizmoCenter: { x: 0, y: 0 }, lastAngle: 0, accumulatedAngle: 0,
  rotationScreenSign: 1, rotationMode: 'euler', rotation: [0, 0, 0], selectionContext: { multiple: false },
  javaRotationGeometry: captureFormatGeometry([node]) };
for (const degrees of [...Array.from({ length: 25 }, (_, index) => index * 16), ...Array.from({ length: 24 }, (_, index) => 368 - index * 16)]) {
  const radians = degrees * Math.PI / 180;
  drag.pendingTransform = { dx: 0, dy: 0, event: { clientX: Math.cos(radians) * 100, clientY: Math.sin(radians) * 100 } };
  interaction.applyPendingTransform(drag);
  const expected = new Cube({ ...baseline, rotation: [0, Math.round(degrees * .75 / 22.5) * 22.5, 0] });
  sameGeometry(surfaces(node), surfaces(expected), `continuous drag ${degrees}`);
}
assert.deepEqual(node.position, baseline.position);
assert.deepEqual(node.size, baseline.size);
assert.deepEqual(node.faces, baseline.faces);
console.log('Java quarter turns preserve geometry/UVs, continuous drags, native export and bbmodel version segments.');
