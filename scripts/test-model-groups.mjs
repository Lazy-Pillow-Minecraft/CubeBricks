import assert from 'node:assert/strict';
import { BezierElement, Cube, CurveNode, Group, NodeElement, Shape, CubeBricksProject, chooseKnifeCutAxis, exportBlockbench, getKnifeFaceAxes, importBlockbench, setPivotPreservingGeometry, splitCubeAt } from '../src/model.js';
import { applyGroupTransforms } from '../src/render/webgl-renderer.js';
import { ModelFormatRegistry } from '../src/core/model-format-registry.js';
import { ModelFormatId, createModelProjectData, modelFormatRegistry } from '../src/config/model-formats.js';

assert.equal(modelFormatRegistry.list().length, 8, 'built-in model formats are registered');
assert.deepEqual(modelFormatRegistry.list().filter(format => format.status === 'placeholder').map(format => format.id),
  [ModelFormatId.GENERIC, ModelFormatId.IMAGE], 'generic mesh and image editors remain explicit placeholders');
assert.equal(modelFormatRegistry.resolve('java_block').id, ModelFormatId.JAVA_BLOCK_ITEM);
assert.equal(modelFormatRegistry.resolve('geckolib_model').id, ModelFormatId.GECKOLIB);
const javaInitial = createModelProjectData(ModelFormatId.JAVA_BLOCK_ITEM);
assert.equal(javaInitial.formatId, ModelFormatId.JAVA_BLOCK_ITEM);
assert.deepEqual(javaInitial.snap, { subdivisions: 16 });
assert.deepEqual(javaInitial.textureSize, [16, 16]);
const bedrockInitial = createModelProjectData(ModelFormatId.BEDROCK_ENTITY);
const bedrockProject = new CubeBricksProject(bedrockInitial);
assert.equal(bedrockProject.formatId, ModelFormatId.BEDROCK_ENTITY);
assert.deepEqual(bedrockProject.textureSize, [64, 64]);
assert.equal(bedrockProject.uvMode, 'box');
assert.equal(bedrockProject.cullFaces, false);
assert.deepEqual(bedrockProject.snap, { subdivisions: 16 });
const bedrockRoundTrip = new CubeBricksProject(JSON.parse(bedrockProject.serialize()));
assert.equal(bedrockRoundTrip.formatId, ModelFormatId.BEDROCK_ENTITY, 'project format survives a cbmodel round trip');
assert.deepEqual(bedrockRoundTrip.snap, { subdivisions: 16 }, 'project standard snap survives a cbmodel round trip');

const filledPrism = new Shape({ parameters: { radius: 4, height: 8, sides: 8, cubeSize: 1, snapMode: 'cube' } });
assert.equal(filledPrism.toCubes().length, filledPrism.parameters.sides,
  'polygon prism uses one elongated cube for each polygon wall instead of voxel filling');
assert.ok(filledPrism.toCubes().every(cube => cube.size[0] === 1 && cube.size[2] >= 1),
  'polygon wall cubes preserve their requested thickness and span an entire side');
assert.ok(filledPrism.toCubes().every(cube => Math.abs(cube.size[2] - Math.round(cube.size[2])) < 1e-9),
  'cube-edge snapping applies to the generated wall cube length');
const boundsPrism = new Shape({ parameters: { radius: 4.3, height: 8, sides: 6, cubeSize: 1, snapMode: 'bounds' } });
assert.equal(boundsPrism.toCubes().length, 6, 'overall-edge snapping still produces one wall cube per side');

const planarCurve = new BezierElement({ nodes: [
  { position: [-4, 9, 0], handleOut: [2, 7, 0] },
  { position: [4, -3, 0], handleIn: [-2, -5, 0] }
] }, 2);
assert.ok(planarCurve.nodes.every(node => node.position[1] === 0 && node.handleIn[1] === 0 && node.handleOut[1] === 0),
  '2D bezier nodes and handles remain coplanar');
assert.ok(planarCurve.toCubes().length > 0, '2D bezier fits cube columns along the sampled curve');
const rotatedPlanarCurve = new BezierElement({ nodes: [
  { position: [0, 0, 0], rotation: [25, 90, -35], handleOut: [3, 0, 0] },
  { position: [6, 0, 0], handlesEnabled: false }
] }, 2);
assert.deepEqual(rotatedPlanarCurve.nodes[0].rotation, [0, 90, 0], '2D node rotation stays on the curve plane normal');
assert.ok(rotatedPlanarCurve.sampleCurve().some(sample => Math.abs(sample.point[2]) > .01),
  'node rotation turns its local bezier handle and changes the fitted curve');
const spatialCurve = new BezierElement({ parameters: { segmentationMode: 'angle', angleStep: 5 } }, 3);
assert.ok(spatialCurve.toCubes().length > 0, '3D bezier supports angle-based cube fitting');
assert.ok(spatialCurve.nodes.every(node => node.autoTangent), 'new bezier nodes start with pen-style automatic tangents');
const autoMiddleCurve = new BezierElement({ nodes: [
  { position: [0, 0, 0] }, { position: [4, 2, 0] }, { position: [8, 0, 0] }
] }, 3);
const autoMiddle = autoMiddleCurve.resolvedNodeState(1);
assert.ok(autoMiddle.handleIn[0] < 0 && autoMiddle.handleOut[0] > 0,
  'an untouched middle node derives a smooth tangent from its neighbours');
const rolledCurve = new BezierElement({ nodes: [
  { position: [0, 0, 0], roll: 0 }, { position: [8, 0, 0], roll: 90 }
], parameters: { segmentLength: 2 } }, 3);
const rolledCubes = rolledCurve.toCubes();
assert.notDeepEqual(rolledCubes[0].rotation.map(value => Math.round(value * 1000)),
  rolledCubes.at(-1).rotation.map(value => Math.round(value * 1000)),
  '3D node roll interpolates into the fitted cube-column orientation');
const cornerCurve = new BezierElement({ nodes: [
  { position: [0, 0, 0], handlesEnabled: false },
  { position: [4, 0, 0], handlesEnabled: false },
  { position: [4, 0, 4], handlesEnabled: false }
], parameters: { thickness: 2, segmentationMode: 'distance', segmentLength: 4 } }, 3);
const cornerCubes = cornerCurve.toCubes();
assert.ok(cornerCubes.some(cube => cube.size[2] > 4),
  'cube columns extend around a bend to close the outside miter gap');
const curveNode = new CurveNode({ handlesEnabled: false });
assert.equal(curveNode.handlesEnabled, false, 'bezier handles are optional per node');
const nodeElement = new NodeElement({ position: [1, 2, 3], handlesEnabled: true });
assert.equal('pivot' in nodeElement, false, 'standalone nodes do not expose a pivot');
assert.equal('size' in nodeElement, false, 'standalone nodes do not expose resize dimensions');
const curveRoundTrip = new CubeBricksProject({ elements: [planarCurve, spatialCurve, nodeElement] });
const restoredCurveProject = new CubeBricksProject(JSON.parse(curveRoundTrip.serialize()));
assert.deepEqual(restoredCurveProject.elements.map(element => element.type), ['bezier2d', 'bezier3d', 'node']);
assert.equal(restoredCurveProject.elements[0].nodes.length, 2, 'curve nodes survive a cbmodel round trip');

const exportShape = new Shape({ name: 'wall_shape', parameters: { radius: 4, height: 8, sides: 5, cubeSize: 1 } });
const exportRoot = new Group({ name: 'root', children: [exportShape.uid] });
const exportProject = new CubeBricksProject({ name: 'bb_export', elements: [exportShape], groups: [exportRoot], outliner: [exportRoot.uid] });
const exportedBbmodel = exportBlockbench(exportProject);
assert.equal(exportedBbmodel.meta.format_version, '4.10');
assert.equal(exportedBbmodel.elements.filter(element => element.type === 'cube').length, 5,
  'procedural shapes export as generated Blockbench cubes');
assert.equal(exportedBbmodel.outliner[0].children[0].children.length, 5,
  'procedural shape cubes are wrapped in a named outliner group');
assert.equal(importBlockbench(exportedBbmodel).elements.filter(element => element.type === 'cube').length, 5,
  'exported procedural cube groups can be imported again');

const customFormats = new ModelFormatRegistry();
let registeredCustom = null;
customFormats.subscribe(event => { registeredCustom = event.format.id; });
customFormats.register({
  id: 'custom_voxel', name: 'Custom Voxel', blockbenchFormat: 'custom_voxel', snap: { subdivisions: 32 },
  defaults: { textureSize: [32, 32] },
  createProject: context => ({ name: context.name, formatData: { customSeed: 7 } })
});
assert.equal(registeredCustom, 'custom_voxel', 'custom format registration is observable by creation UIs');
assert.deepEqual(customFormats.createDefaults('custom_voxel', { name: 'factory_project' }), {
  textureSize: [32, 32], name: 'factory_project', formatData: { customSeed: 7 },
  formatId: 'custom_voxel', modelType: 'custom_voxel', snap: { subdivisions: 32 }
}, 'format factories can inject arbitrary initial project data');

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
assert.equal(project.formatId, ModelFormatId.GENERIC);
assert.deepEqual(project.snap, { subdivisions: 16 });
assert.deepEqual(project.outliner, ['root-group']);
assert.deepEqual(project.getNode('cube-a').position, [1, 2, 3]);
assert.deepEqual(project.getNode('cube-a').size, [4, 6, 7]);
assert.equal(project.getNode('cube-a').shade, false);
assert.equal(project.getNode('cube-a').mirrorUv, true);
assert.deepEqual(project.getGroupChain('cube-a').map(group => group.uid), ['root-group', 'child-group']);
assert.deepEqual(project.getDescendantElementUids('root-group'), ['cube-a']);

const indexedProject = new CubeBricksProject({
  elements: [new Cube({ uid: 'indexed-a' }), new Cube({ uid: 'indexed-b' })],
  groups: [new Group({ uid: 'indexed-group', children: ['indexed-a'] })],
  outliner: ['indexed-group', 'indexed-b']
});
assert.equal(indexedProject.getNode('indexed-b').uid, 'indexed-b', 'node index resolves flat multi-selection entries');
indexedProject.elements.push(new Cube({ uid: 'indexed-c' }));
assert.equal(indexedProject.getNode('indexed-c').uid, 'indexed-c', 'node index refreshes after direct additions');
indexedProject.getNode('indexed-group').children.push('indexed-b');
indexedProject.outliner = indexedProject.outliner.filter(uid => uid !== 'indexed-b');
indexedProject.invalidateHierarchyIndex();
assert.equal(indexedProject.getParentGroup('indexed-b').uid, 'indexed-group', 'parent index refreshes after reparenting');
assert.deepEqual(Object.keys(JSON.parse(indexedProject.serialize())).filter(key => key.startsWith('_')), [],
  'runtime indexes are never serialized');

const freshFlags = new Cube();
assert.equal(freshFlags.autoUv, true, 'new cubes enable auto UV');
assert.equal(freshFlags.exported, true, 'new cubes participate in future conversions');
assert.equal(freshFlags.locked, false, 'new cubes are unlocked');
const texturedFlags = new Cube({ faces: { north: { texture: '#skin' } } });
assert.equal(texturedFlags.autoUv, false, 'textured cubes disable auto UV on import');
const excludedCube = new Cube({ exported: false, locked: true });
const flagProject = new CubeBricksProject({ elements: [excludedCube], outliner: [excludedCube.uid] });
const flagRoundTrip = new CubeBricksProject(JSON.parse(flagProject.serialize()));
assert.equal(flagRoundTrip.elements.length, 1, 'conversion export flag never removes elements from cbmodel');
assert.equal(flagRoundTrip.getNode(excludedCube.uid).exported, false);
assert.equal(flagRoundTrip.getNode(excludedCube.uid).locked, true);

const importedFlags = importBlockbench({
  elements: [
    { type: 'cube', uuid: 'flags-off', from: [0, 0, 0], to: [1, 1, 1], autouv: 0, export: 0, locked: 1, visibility: 0 },
    { type: 'cube', uuid: 'flags-on', from: [1, 0, 0], to: [2, 1, 1], autouv: 2, export: 1, locked: 0, visibility: 1 }
  ],
  outliner: [{ uuid: 'flags-group', autouv: 0, export: 0, locked: 1, visibility: 0, children: ['flags-off', 'flags-on'] }]
});
assert.deepEqual(
  ['autoUv', 'exported', 'locked', 'visible'].map(key => importedFlags.getNode('flags-off')[key]),
  [false, false, true, false],
  'numeric Blockbench flags are inherited as booleans'
);
assert.deepEqual(
  ['autoUv', 'exported', 'locked', 'visible'].map(key => importedFlags.getNode('flags-on')[key]),
  [true, true, false, true],
  'nonzero Blockbench autouv remains enabled'
);
assert.deepEqual(
  ['autoUv', 'exported', 'locked', 'visible'].map(key => importedFlags.getNode('flags-group')[key]),
  [false, false, true, false],
  'Blockbench group flags are inherited directly'
);

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

const groupAppearance = new Group({ inflate: 1.5, shade: false });
assert.equal(groupAppearance.inflate, 1.5);
assert.equal(groupAppearance.shade, false);
const groupAppearanceProject = new CubeBricksProject({ groups: [groupAppearance], outliner: [groupAppearance.uid] });
const restoredGroupAppearance = new CubeBricksProject(JSON.parse(groupAppearanceProject.serialize())).groups[0];
assert.equal(restoredGroupAppearance.inflate, 1.5, 'group inflation survives a cbmodel round trip');
assert.equal(restoredGroupAppearance.shade, false, 'group shading survives a cbmodel round trip');

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
