import assert from 'node:assert/strict';
import { BezierElement, Cube, CurveNode, Group, NodeElement, Shape, CubeBricksProject, addModifier, bakeModifier, bakeProceduralShape, buildModifierRenderInstances, chooseKnifeCutAxis, exportBlockbench, getKnifeFaceAxes, getModifier, importBlockbench, setPivotPreservingGeometry, splitCubeAt } from '../src/model.js';
import { applyGroupTransforms } from '../src/render/webgl-renderer.js';
import { ModelFormatRegistry } from '../src/common/core/model-format-registry.js';
import { ModelFormatId, createModelProjectData, modelFormatRegistry } from '../src/common/config/model-formats.js';
import { DEFAULT_PLAYER_REFERENCE_TEXTURE, createPlayerReferenceProject } from '../src/assets/player-reference.js';
import { constrainCube, formatRules } from '../src/common/core/format-constraints.js';

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
const referenceProject = new CubeBricksProject({ referenceImages: {
  general: { name: 'layout.png', source: 'data:image/png;base64,AA==', naturalWidth: 320, naturalHeight: 180, offset: [14, -9], scale: .75 },
  x: [
    { name: 'side.png', source: 'data:image/png;base64,BB==', naturalWidth: 128, naturalHeight: 256, offset: [2, 3], scale: .0625 },
    { name: 'detail.png', source: 'data:image/png;base64,CC==', naturalWidth: 64, naturalHeight: 64, offset: [-4, 8], scale: .125 }
  ]
} });
const referenceRoundTrip = new CubeBricksProject(JSON.parse(referenceProject.serialize()));
assert.deepEqual(referenceRoundTrip.referenceImages.general[0].offset, [14, -9],
  'legacy single general-view references migrate into a list and survive a cbmodel round trip');
assert.equal(referenceRoundTrip.referenceImages.x[0].scale, .0625, 'axis-view reference scale survives a cbmodel round trip');
assert.equal(referenceRoundTrip.referenceImages.x.length, 2, 'each view can store multiple independent reference images');
assert.deepEqual(referenceRoundTrip.referenceImages.y, [], 'axis reference lists stay independent');
const playerReference = createPlayerReferenceProject();
assert.equal(playerReference.elements.length, 12, 'player reference keeps the supplied base and outer-layer cubes');
assert.equal(playerReference.groups.length, 8, 'player reference keeps its render-only pose hierarchy');
assert.equal(playerReference.outliner.length, 1, 'player reference has one isolated render root');
assert.deepEqual(playerReference.elements[0].position, [26.07136, 22.7476, 4.90878],
  'player reference preserves the supplied bbmodel coordinates instead of recentering them');
assert.ok(playerReference.elements[0].size.every(value => Math.abs(value - 7.4984) < 1e-9),
  'player reference uses the replacement bbmodel dimensions');
assert.deepEqual(playerReference.groups.find(group => group.uid === 'player_reference_root')?.pivot, [28.03969, 11.5, 8.65798],
  'player reference preserves the supplied root pivot');
assert.match(DEFAULT_PLAYER_REFERENCE_TEXTURE, /^data:image\/png;base64,/, 'player reference texture is bundled without a bbmodel asset');

const filledPrism = new Shape({ parameters: { radius: 4, height: 8, sides: 8, cubeSize: 1, snapMode: 'cube' } });
assert.equal(filledPrism.type, 'polygon_prism', 'polygon prisms use their own registered element marker');
assert.equal(filledPrism.toCubes().length, filledPrism.parameters.sides / 2,
  'a solid even-sided prism merges each opposite edge pair into one centre-spanning cube');
assert.ok(filledPrism.toCubes().every(cube => Math.abs(cube.pivot[0]) < 1e-9 && Math.abs(cube.pivot[2]) < 1e-9),
  'merged solid prism cubes pass directly through the centre');
const boundsPrism = new Shape({ parameters: { radius: 4.3, height: 8, sides: 6, cubeSize: 1, snapMode: 'bounds' } });
assert.equal(boundsPrism.toCubes().length, 3, 'overall-edge snapping retains opposite-edge merging for solid even prisms');
assert.ok(Math.abs(boundsPrism.toCubes()[0].size[2] - 2 * 4.3 * Math.cos(Math.PI / 6)) < 1e-9,
  'shape generation preserves exact stored dimensions instead of forcibly normalizing them');
const hollowPrism = new Shape({ parameters: { radius: 5, height: 8, sides: 8, cubeSize: 1,
  innerRadiusEnabled: true, innerRadius: 2, snapMode: 'cube' } });
assert.equal(hollowPrism.toCubes().length, 8, 'enabling an inner radius creates separate hollow wall cubes');
assert.ok(hollowPrism.toCubes().every(cube => Math.hypot(cube.pivot[0], cube.pivot[2]) > 0),
  'hollow wall cubes stop before reaching the centre');
const inwardDepthPrism = new Shape({ parameters: { radius: 5, height: 8, sides: 8, cubeSize: 1,
  innerRadiusEnabled: true, innerRadiusMode: 'depth', innerRadius: 2, snapMode: 'bounds' } });
const inwardDepthCubes = inwardDepthPrism.toCubes();
assert.ok(inwardDepthCubes.every(cube => Math.abs(cube.size[2] - 2) < 1e-7),
  'inner-radius depth mode interprets the value as each cube inward extension distance');

const dodecahedron = new Shape({ type: 'dodecahedron', name: 'dodecahedron', origin: [2, 3, 4], pivot: [1, 5, 2], parameters: { radius: 6, snapMode: 'edge' } });
assert.equal(dodecahedron.shapeType, 'dodecahedron', 'regular dodecahedra keep their own registered Shape type');
assert.equal(dodecahedron.toCubes().length, 60, 'a dodecahedron fits five cube plates across each of twelve faces');
assert.ok(dodecahedron.toCubes().every(cube => cube.size.every(Number.isFinite) && cube.rotation.every(Number.isFinite)),
  'dodecahedron cube fitting produces finite geometry and rotations');
const dodecahedronEdges = dodecahedron.toCubes().map(cube => cube.size[0]);
assert.ok(Math.max(...dodecahedronEdges) - Math.min(...dodecahedronEdges) < 1e-7,
  'every dodecahedron face is built from a regular pentagon instead of crossed diagonal edges');

const football = new Shape({ type: 'truncated_icosahedron', name: 'football', parameters: { radius: 8, snapMode: 'radius' } });
const footballCubes = football.toCubes();
assert.equal(football.shapeType, 'truncated_icosahedron', 'football Shapes use the truncated-icosahedron marker');
assert.equal(footballCubes.length, 120,
  'football hexagons merge their three opposite edge pairs while pentagons keep five cube plates');
const footballEdges = footballCubes.map(cube => cube.size[0]);
assert.ok(Math.max(...footballEdges) - Math.min(...footballEdges) < 1e-7,
  'every generated football edge has the same fitted length');
const shapeRoundTrip = new CubeBricksProject({ elements: [dodecahedron, football], outliner: [dodecahedron.uid, football.uid] });
const restoredShapes = new CubeBricksProject(JSON.parse(shapeRoundTrip.serialize()));
assert.deepEqual(restoredShapes.getNode(dodecahedron.uid).pivot, [1, 5, 2], 'Shape pivots survive a cbmodel round trip');
assert.equal(restoredShapes.getNode(football.uid).shapeType, 'truncated_icosahedron', 'football Shape type survives a cbmodel round trip');

const editedPrism = new Shape({
  uid: 'edited_prism',
  parameters: { radius: 4, height: 8, sides: 8 },
  preserveSubdivisionEdits: true,
  subdivisionEdits: {
    0: { positionDelta: [1, 0, 0], sizeDelta: [0, 2, 0], faces: { north: { uv: [1, 2, 5, 7], texture: '#0' } } }
  }
});
const editedPrismCube = editedPrism.toCubes()[0];
assert.equal(editedPrismCube.uid, 'edited_prism::subdivision::0', 'generated Shape cubes keep a stable subdivision identity');
assert.equal(editedPrismCube.position[0], editedPrism.toBaseCubes()[0].position[0] + 1,
  'subdivision position edits remain relative to regenerated Shape geometry');
assert.equal(editedPrismCube.size[1], 10, 'subdivision size edits are applied as non-destructive deltas');
assert.deepEqual(editedPrismCube.faces.north.uv, [1, 2, 5, 7], 'subdivision face UV overrides survive regeneration');
const transientCube = editedPrism.toCubes()[0];
const subdivisionProject = new CubeBricksProject({ elements: [editedPrism], outliner: [editedPrism.uid] });
subdivisionProject.elements.push(transientCube);
const subdivisionRoundTrip = JSON.parse(subdivisionProject.serialize());
assert.equal(subdivisionRoundTrip.elements.length, 1, 'temporary subdivision cubes never leak into cbmodel serialization');
assert.ok(subdivisionRoundTrip.elements[0].subdivisionEdits['0'], 'Shape subdivision edits are stored on the procedural element');

const planarCurve = new BezierElement({ nodes: [
  { position: [-4, 9, 0], handleOut: [2, 7, 0] },
  { position: [4, -3, 0], handleIn: [-2, -5, 0] }
] }, 2);
const defaultPlanarCurve = new BezierElement({}, 2);
assert.deepEqual(defaultPlanarCurve.nodes.map(node => node.position), [[0, 0, 0], [0, 0, 8]],
  'a new 2D curve starts as an eight-pixel vertical stroke in its local plane');
assert.deepEqual(defaultPlanarCurve.rotation, [-90, 0, 0],
  'the local 2D stroke faces the world Y axis without changing legacy curves');
assert.deepEqual(new BezierElement({}, 3).nodes.map(node => node.position), [[0, 0, 0], [0, 8, 0]],
  'a new 3D curve starts as an eight-pixel world-Y stroke');
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
const envelopeCurve = new BezierElement({
  variant: 'envelope', name: 'sleeve',
  nodes: [
    { position: [0, 0, 0], handlesEnabled: false, radius: 1 },
    { position: [4, 0, 0], handlesEnabled: false },
    { position: [8, 0, 0], handlesEnabled: false, radius: 3 }
  ],
  parameters: { radius: .5, segmentLength: 2, headAtStart: true, nestedBake: true }
}, 3);
const envelopeSamples = envelopeCurve.sampleCurve();
const samePathStandard = new BezierElement({ nodes: envelopeCurve.nodes.map(node => structuredClone(node)),
  parameters: { segmentLength: 2 } }, 3);
assert.equal(envelopeCurve.toCubes().length, samePathStandard.toCubes().length,
  'changing node radii does not add cube subdivisions along the curve');
assert.ok(Math.abs(envelopeSamples.find(sample => Math.abs(sample.point[0] - 4) < 1e-7).radius - .5) < 1e-7,
  'an unset node resolves to the overall curve radius even between custom-radius nodes');
assert.ok(envelopeSamples.some(sample => sample.point[0] > 0 && sample.point[0] < 4
  && sample.radius > .5 && sample.radius < 1),
  'cubes between custom and default-radius nodes receive intermediate radii');
assert.ok(envelopeSamples.some(sample => sample.point[0] > 4 && sample.point[0] < 8
  && sample.radius > .5 && sample.radius < 3),
  'cubes between default and custom-radius nodes receive intermediate radii');
const oneSidedEnvelope = new BezierElement({ variant: 'envelope',
  nodes: [{ position: [0, 0, 0], handlesEnabled: false, radius: 2 },
    { position: [4, 0, 0], handlesEnabled: false },
    { position: [8, 0, 0], handlesEnabled: false }],
  parameters: { radius: .75, segmentLength: 2 }
}, 2);
assert.equal(oneSidedEnvelope.sampleCurve().at(-1).radius, .75,
  'a missing radius on either side falls back to the overall curve radius');
const oneSidedCubes = oneSidedEnvelope.toCubes();
assert.ok(oneSidedCubes[0].size[0] > oneSidedCubes[1].size[0],
  'adjacent cubes taper when only the first node has a custom radius');
assert.ok(Math.abs(oneSidedCubes.at(-1).size[0] - 1.5) < 1e-7,
  'adjacent unset nodes retain the overall radius across their whole span');
assert.ok(envelopeCurve.toCubes()[0].size[0] < envelopeCurve.toCubes().at(-1).size[0],
  'fitted cube columns follow per-node radii');
const envelopeRoundTrip = new CubeBricksProject(JSON.parse(new CubeBricksProject({
  elements: [envelopeCurve], outliner: [envelopeCurve.uid]
}).serialize())).getNode(envelopeCurve.uid);
assert.equal(envelopeRoundTrip.variant, 'envelope', 'curve variant survives project serialization');
assert.equal(envelopeRoundTrip.nodes[1].radius, null, 'unset node radius survives project serialization');
const envelopeProject = new CubeBricksProject({ elements: [envelopeCurve], outliner: [envelopeCurve.uid] });
const envelopeBake = bakeProceduralShape(envelopeProject, envelopeCurve.uid);
assert.equal(envelopeBake.nestedGroups.length, envelopeBake.cubes.length - 1,
  'optional envelope bake nests one group level per subsequent segment');
assert.equal(envelopeBake.group.children[0], envelopeBake.cubes[0].uid,
  'the head segment occupies the outermost group');
assert.deepEqual(envelopeBake.nestedGroups[0].children[0], envelopeBake.cubes[1].uid,
  'subsequent segments descend into nested groups');
const reversedEnvelope = new BezierElement({ ...JSON.parse(JSON.stringify(envelopeCurve)), uid: 'reverse_envelope',
  parameters: { ...envelopeCurve.parameters, headAtStart: false } }, 3);
const reversedProject = new CubeBricksProject({ elements: [reversedEnvelope], outliner: [reversedEnvelope.uid] });
const reversedBake = bakeProceduralShape(reversedProject, reversedEnvelope.uid);
assert.equal(reversedBake.group.children[0], reversedBake.cubes.at(-1).uid,
  'tail-first direction reverses the nesting order without changing curve geometry');
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
const centredCurve = new BezierElement({ nodes: [
  { position: [-5, 0, 0], handlesEnabled: false },
  { position: [5, 0, 0], handlesEnabled: false }
], parameters: { segmentationMode: 'distance', segmentLength: 3 } }, 3);
const centredSamples = centredCurve.sampleCurve();
for (let index = 0; index < centredSamples.length; index++) {
  assert.ok(Math.abs(centredSamples[index].point[0] + centredSamples.at(-1 - index).point[0]) < 1e-7,
    'distance fitting expands symmetrically from the curve midpoint');
}
const centredCubes = centredCurve.toCubes();
assert.ok(centredCubes.some(cube => Math.abs(cube.pivot[0]) < 1e-7),
  'a symmetric curve receives a cube centred on its midpoint');
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
assert.equal(curveNode.symmetricHandles, true, 'new curve nodes use symmetric bezier handles by default');
const nodeElement = new NodeElement({ position: [1, 2, 3], handlesEnabled: true });
assert.equal(nodeElement.symmetricHandles, true, 'standalone node handles can use the same symmetric mode');
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

const culledCube = new Cube({
  uid: 'culled-cube',
  faces: {
    north: { uv: [0, 0, 4, 4], texture: null, _cubebricksCulledTexture: '#skin' },
    south: { uv: [4, 0, 8, 4], texture: '#skin' }
  }
});
const culledExport = exportBlockbench(new CubeBricksProject({ elements: [culledCube], outliner: [culledCube.uid] }));
assert.equal(culledExport.elements[0].faces.north.texture, null,
  'culled cube faces retain the Blockbench null-texture marker');
assert.equal('_cubebricksCulledTexture' in culledExport.elements[0].faces.north, false,
  'the editor-only cull restore texture does not leak into bbmodel export');

const mirrorCube = new Cube({ uid: 'mirror-cube', name: 'petal', position: [2, 0, 0], size: [2, 3, 1], pivot: [2, 0, 0] });
const overlappingCube = new Cube({ uid: 'overlap-cube', position: [-1, 0, 0], size: [2, 2, 2], pivot: [0, 0, 0] });
const overlapProject = new CubeBricksProject({ elements: [overlappingCube], outliner: [overlappingCube.uid] });
const overlapModifier = addModifier(overlapProject.getNode(overlappingCube.uid), 'symmetry');
assert.equal(overlapModifier.ignoreDuplicateCubes, true, 'new mirror modifiers enable overlap removal by default');
assert.equal(buildModifierRenderInstances(overlapProject).some(instance => instance.sourceUids.includes(overlappingCube.uid)), false,
  'an overlapping mirrored cube is excluded immediately');
overlapProject.getNode(overlappingCube.uid).position[0] = 1;
assert.equal(buildModifierRenderInstances(overlapProject).some(instance => instance.sourceUids.includes(overlappingCube.uid)), true,
  'deduplication responds to changed source geometry without leaving a stale result');
const mirrorGroup = new Group({
  uid: 'mirror-group', name: 'wing', children: [mirrorCube.uid],
  mirror: { enabled: true, mode: 'axes', axes: { x: true, y: false, z: true }, wrapParent: false }
});
const mirrorProject = new CubeBricksProject({ elements: [mirrorCube], groups: [mirrorGroup], outliner: [mirrorGroup.uid] });
const projectMirrorGroup = mirrorProject.getNode(mirrorGroup.uid);
const symmetryModifier = getModifier(projectMirrorGroup, 'symmetry');
assert.ok(symmetryModifier, 'legacy group mirror data migrates into a symmetry modifier');
assert.deepEqual(symmetryModifier.anchor.position, projectMirrorGroup.pivot,
  'the symmetry modifier owns its control point instead of adding a scene node');
assert.equal(mirrorProject.elements.some(element => element.mirrorControllerFor === projectMirrorGroup.uid), false,
  'group symmetry no longer creates controller elements');
assert.deepEqual(projectMirrorGroup.children, [mirrorCube.uid], 'the modifier control point does not pollute group children');
const mirroredAxesBbmodel = exportBlockbench(mirrorProject);
assert.equal(mirroredAxesBbmodel.outliner.length, 4, 'two enabled Cartesian mirror axes expand to four groups');
const mirroredAxesPreview = buildModifierRenderInstances(mirrorProject);
assert.equal(mirroredAxesPreview.length, 3, 'viewport mirror preview omits the already-rendered identity instance');
assert.ok(mirroredAxesPreview.every(instance => instance.sourceUids.length === 1
  && instance.sourceUids[0] === mirrorCube.uid),
  'viewport mirror instances reuse source element ranges instead of generating duplicate cubes');
assert.equal(mirroredAxesPreview.filter(instance => instance.reflected).length, 2,
  'odd-axis mirror instances request front-face winding compensation');
assert.deepEqual(mirroredAxesBbmodel.outliner.map(group => group.name).sort(), [
  'left_before_wing', 'left_front_wing', 'right_before_wing', 'right_front_wing'
]);
assert.equal(mirroredAxesBbmodel.elements.length, 4, 'each Cartesian mirror instance receives its own cube UUID');
assert.ok(mirroredAxesBbmodel.elements.every(element => element.to.every((value, axis) => value >= element.from[axis])),
  'mirrored Blockbench cubes always export with non-negative dimensions');
assert.ok(mirroredAxesBbmodel.elements.every(element => !element.uuid.includes('mirror_axis')),
  'the embedded modifier control point is never exported as an element');
const mirroredAxisGroups = new Map(mirroredAxesBbmodel.outliner.map(group => [group.name, group]));
for (const groupName of ['left_front_wing', 'right_before_wing']) {
  const mirroredElement = mirroredAxesBbmodel.elements.find(element => element.uuid === mirroredAxisGroups.get(groupName).children[0]);
  assert.equal(mirroredElement.mirror_uv, true, 'odd-axis box-UV mirrors also mirror their texture layout');
}

const uvMirrorCube = new Cube({
  uid: 'uv-mirror-cube', name: 'uv_part', position: [1, 0, 0], size: [2, 3, 4], pivot: [1, 0, 0],
  uvMode: 'face',
  faces: {
    north: { uv: [1, 2, 5, 7], texture: '#north', rotation: 0 },
    east: { uv: [10, 20, 30, 40], texture: '#east', rotation: 0 },
    west: { uv: [50, 60, 70, 80], texture: '#west', rotation: 0 },
    up: { uv: [10, 20, 50, 80], texture: '#up', rotation: 90 }
  }
});
const uvMirrorGroup = new Group({
  uid: 'uv-mirror-group', name: 'uv_pair', children: [uvMirrorCube.uid],
  mirror: { enabled: true, mode: 'axes', axes: { x: true, y: false, z: false }, wrapParent: false }
});
const uvMirrorExport = exportBlockbench(new CubeBricksProject({
  elements: [uvMirrorCube], groups: [uvMirrorGroup], outliner: [uvMirrorGroup.uid]
}));
const reflectedUvGroup = uvMirrorExport.outliner.find(group => group.name === 'left_uv_pair');
const reflectedUvCube = uvMirrorExport.elements.find(element => element.uuid === reflectedUvGroup.children[0]);
assert.equal(reflectedUvCube.faces.east.texture, '#west', 'local-X reflection swaps east and west face textures');
assert.equal(reflectedUvCube.faces.west.texture, '#east', 'local-X reflection swaps the opposite face texture too');
assert.deepEqual(reflectedUvCube.faces.north.uv, [5, 2, 1, 7], 'unrotated explicit face UV mirrors horizontally');
assert.deepEqual(reflectedUvCube.faces.up.uv, [10, 80, 50, 20], '90-degree explicit face UV mirrors in its rotated horizontal axis');
const mirrorRoundTrip = new CubeBricksProject(JSON.parse(mirrorProject.serialize()));
assert.equal(mirrorRoundTrip.elements.filter(element => element.mirrorControllerFor === projectMirrorGroup.uid).length, 0,
  'cbmodel round trips keep modifier anchors embedded');
assert.ok(getModifier(mirrorRoundTrip.getNode(projectMirrorGroup.uid), 'symmetry'),
  'symmetry modifiers survive cbmodel round trips');

const legacyControllerProject = new CubeBricksProject({
  elements: [
    { type: 'cube', uid: 'legacy-part', name: 'legacy_part' },
    { type: 'node', uid: 'legacy-mirror-controller', name: 'mirror_axis', position: [3, 4, 5], rotation: [10, 20, 30], mirrorControllerFor: 'legacy-mirror-group' }
  ],
  groups: [{
    uid: 'legacy-mirror-group', name: 'legacy_group', children: ['legacy-part', 'legacy-mirror-controller'],
    mirror: { enabled: true, mode: 'axes', axes: { x: true, y: false, z: false }, controllerUid: 'legacy-mirror-controller' }
  }],
  outliner: ['legacy-mirror-group']
});
const migratedLegacyGroup = legacyControllerProject.getNode('legacy-mirror-group');
assert.deepEqual(getModifier(migratedLegacyGroup, 'symmetry').anchor,
  { position: [3, 4, 5], rotation: [10, 20, 30] },
  'legacy mirror controller transforms migrate into the embedded modifier anchor');
assert.equal(legacyControllerProject.getNode('legacy-mirror-controller'), null,
  'legacy mirror controller nodes are removed from the scene index');
assert.deepEqual(migratedLegacyGroup.children, ['legacy-part'],
  'legacy mirror controller nodes are removed from group children');

const objectMirrorCube = new Cube({ uid: 'object-mirror-cube', name: 'object_mirror', position: [2, 0, 0], size: [1, 2, 3], pivot: [2, 0, 0] });
const objectSymmetry = addModifier(objectMirrorCube, 'symmetry', {
  enabled: true, axes: { x: true, y: false, z: false }, wrapParent: false
});
assert.ok(objectSymmetry, 'compatible scene objects can attach a symmetry modifier');
const secondObjectSymmetry = addModifier(objectMirrorCube, 'symmetry', {
  enabled: true, axes: { x: false, y: false, z: true }, wrapParent: false
});
assert.ok(secondObjectSymmetry, 'symmetry modifiers can be attached repeatedly as an ordered stack');
const objectMirrorProject = new CubeBricksProject({ elements: [objectMirrorCube], outliner: [objectMirrorCube.uid] });
const objectMirrorPreview = buildModifierRenderInstances(objectMirrorProject);
assert.equal(objectMirrorPreview.length, 3,
  'the second symmetry modifier consumes both results of the first modifier');
assert.ok(objectMirrorPreview.every(instance => instance.sourceUids[0] === objectMirrorCube.uid),
  'stacked object symmetry continues to reuse the existing object mesh range');
const objectMirrorExport = exportBlockbench(objectMirrorProject);
assert.equal(objectMirrorExport.outliner.length, 4,
  'stacked object symmetry expands into the Cartesian product of both modifiers');
assert.equal(objectMirrorExport.elements.length, 4, 'stacked object symmetry exports one cube per final result');

const childStackCube = new Cube({ uid: 'child-stack-cube', position: [2, 0, 3], size: [1, 2, 1], pivot: [0, 0, 0] });
addModifier(childStackCube, 'symmetry', {
  enabled: true, axes: { x: true, y: false, z: false }, wrapParent: false,
  anchor: { position: [0, 0, 0] }
});
const parentStackGroup = new Group({ uid: 'parent-stack-group', name: 'stack_parent', children: [childStackCube.uid] });
addModifier(parentStackGroup, 'symmetry', {
  enabled: true, axes: { x: false, y: false, z: true }, wrapParent: false,
  anchor: { position: [0, 0, 0] }
});
const nestedStackProject = new CubeBricksProject({
  elements: [childStackCube], groups: [parentStackGroup], outliner: [parentStackGroup.uid]
});
assert.equal(buildModifierRenderInstances(nestedStackProject).length, 3,
  'group modifiers consume the already evaluated child modifier results in the viewport');
const nestedStackExport = exportBlockbench(nestedStackProject);
assert.equal(nestedStackExport.outliner.length, 2,
  'an unwrapped group modifier keeps one group for each of its own final branches');
assert.ok(nestedStackExport.outliner.every(group => group.children.length === 1
  && group.children[0].children.length === 2),
  'each group branch retains the child modifier group with both generated results');
assert.equal(nestedStackExport.elements.length, 4,
  'group export expands child and group modifier results instead of reading the raw child only');

const orderedStackCube = new Cube({ uid: 'ordered-stack-cube', position: [2, 0, 0], size: [1, 1, 1], pivot: [0, 0, 0] });
addModifier(orderedStackCube, 'symmetry', {
  enabled: true, axes: { x: true, y: false, z: false }, wrapParent: false,
  anchor: { position: [0, 0, 0] }
});
addModifier(orderedStackCube, 'symmetry', {
  enabled: true, axes: { x: true, y: false, z: false }, wrapParent: false,
  anchor: { position: [10, 0, 0] }
});
const orderedStackProject = new CubeBricksProject({ elements: [orderedStackCube], outliner: [orderedStackCube.uid] });
assert.ok(buildModifierRenderInstances(orderedStackProject).some(instance =>
  instance.matrix.every((row, rowIndex) => row.every((value, columnIndex) => Math.abs(value - (rowIndex === columnIndex ? 1 : 0)) < 1e-9))
  && Math.abs(instance.translation[0] - 20) < 1e-9),
  'later modifiers transform the geometry produced by earlier modifiers in stack order');

const bakeSource = new Cube({ uid: 'bake-source', name: 'bake_source', position: [2, 0, 0], size: [2, 2, 2], pivot: [0, 0, 0] });
const bakedFirstModifier = addModifier(bakeSource, 'symmetry', {
  enabled: true, axes: { x: true, y: false, z: false }, anchor: { position: [0, 0, 0] }
});
const preservedSecondModifier = addModifier(bakeSource, 'symmetry', {
  enabled: true, axes: { x: false, y: false, z: true }, anchor: { position: [0, 0, 0] }
});
const bakeProject = new CubeBricksProject({ elements: [bakeSource], outliner: [bakeSource.uid] });
const bakeResult = bakeModifier(bakeProject, bakeProject.getNode(bakeSource.uid), bakedFirstModifier.uid);
assert.ok(bakeResult && bakeProject.getNode(bakeResult.rootUid)?.type === 'group', 'baking creates a real grouped result');
assert.equal(bakeProject.getNode(bakeSource.uid), null, 'baking replaces the procedural source instead of leaving doubled geometry');
assert.equal(bakeProject.elements.filter(element => element.type === 'cube').length, 2, 'a single-axis symmetry bakes exactly two physical cubes');
assert.deepEqual(bakeProject.getNode(bakeResult.rootUid).modifiers.map(modifier => modifier.uid), [preservedSecondModifier.uid],
  'baking one modifier preserves the other modifier in the stack');

symmetryModifier.mode = 'radial';
symmetryModifier.copies = 4;
symmetryModifier.wrapParent = true;
const radialBbmodel = exportBlockbench(mirrorProject);
assert.equal(radialBbmodel.outliner[0].children.length, 4, 'radial export creates exactly N rotated groups');
assert.deepEqual(radialBbmodel.outliner[0].children.map(group => group.name), ['wing_1', 'wing_2', 'wing_3', 'wing_4']);
symmetryModifier.mode = 'mandala';
symmetryModifier.copies = 3;
const mandalaBbmodel = exportBlockbench(mirrorProject);
assert.equal(mandalaBbmodel.outliner[0].children.length, 6, 'mandala export creates a rotated and reflected pair for every axis');
assert.deepEqual(mandalaBbmodel.outliner[0].children.map(group => group.name),
  ['wing_1', 'wing_2', 'wing_3', 'wing_4', 'wing_5', 'wing_6']);
assert.equal(importBlockbench(mandalaBbmodel).elements.filter(element => element.type === 'cube').length, 6,
  'expanded mandala groups remain valid when the exported bbmodel is imported again');

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
assert.equal(freshFlags.uvMode, 'box', 'new cubes use box UV mode');
assert.equal(freshFlags.uvNormalized, true, 'new cubes normalize template UV size by default');
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
const uvFlagCube = new Cube({ uid: 'uv-flags', uvMode: 'face', uvNormalized: false });
const uvFlagProject = new CubeBricksProject({ elements: [uvFlagCube], outliner: [uvFlagCube.uid] });
const uvFlagRoundTrip = new CubeBricksProject(JSON.parse(uvFlagProject.serialize()));
assert.equal(uvFlagRoundTrip.getNode('uv-flags').uvMode, 'face');
assert.equal(uvFlagRoundTrip.getNode('uv-flags').uvNormalized, false, 'UV normalization survives cbmodel round trips');

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

const pivotShape = new Shape({ type: 'dodecahedron', origin: [3, -2, 5], pivot: [4, 1, 2], rotation: [17, 31, -9], parameters: { radius: 4 } });
const pivotShapeProject = new CubeBricksProject({ elements: [pivotShape], outliner: [pivotShape.uid] });
const shapePointBefore = rotatePoint(pivotShape.toBaseCubes()[0].position.map((value, axis) => value + pivotShape.origin[axis]), pivotShape.pivot, pivotShape.rotation);
setPivotPreservingGeometry(pivotShapeProject, pivotShape, [-2, 6, 3]);
const shapePointAfter = rotatePoint(pivotShape.toBaseCubes()[0].position.map((value, axis) => value + pivotShape.origin[axis]), pivotShape.pivot, pivotShape.rotation);
assert.ok(almostEqual(shapePointBefore, shapePointAfter), 'moving a Shape pivot must not move its generated geometry');

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

const uvOnlyImport = importBlockbench({
  name: 'uv_only', textures: [{ id: 'skin', uuid: 'texture_skin' }],
  elements: [{ type: 'cube', uuid: 'uv_cube', from: [0, 0, 0], to: [4, 4, 4],
    box_uv: false, faces: {
      north: { uv: [0, 0, 4, 4] },
      south: { uv: [0, 0, 4, 4], texture: null },
      east: { uv: [0, 0, 4, 4], texture: '#other' },
      west: { uv: [0, 0, 4, 4], enabled: false }
    } }], outliner: ['uv_cube']
});
assert.equal(uvOnlyImport.elements[0].faces.north.texture, '#skin', 'UV-only imported faces use the first texture');
assert.equal(uvOnlyImport.elements[0].faces.south.texture, null, 'explicitly culled faces stay culled');
assert.equal(uvOnlyImport.elements[0].faces.east.texture, '#other', 'explicit texture references stay unchanged');
assert.equal(uvOnlyImport.elements[0].faces.west.texture, undefined, 'disabled faces are not assigned a texture');
const boxUvOnlyImport = importBlockbench({
  textures: [{ id: 'skin' }],
  elements: [{ type: 'cube', uuid: 'box_cube', from: [0, 0, 0], to: [4, 4, 4], box_uv: true, uv_offset: [0, 0] }],
  outliner: ['box_cube']
});
assert.equal(Object.keys(boxUvOnlyImport.elements[0].faces).length, 6, 'box-UV-only cubes receive six default-textured faces');
assert.ok(Object.values(boxUvOnlyImport.elements[0].faces).every(face => face.texture === '#skin'));

for (const shapeType of ['polygon_prism', 'dodecahedron', 'truncated_icosahedron']) {
  const source = new Shape({ shapeType, name: `${shapeType}_source`, origin: [10, 5, -2], pivot: [2, 3, 4], rotation: [8, 35, -5],
    subdivisionEdits: { 0: { faces: { north: { uv: [1, 2, 5, 6], texture: '#skin' } } } } });
  const sibling = new Cube({ name: 'sibling' });
  const parent = new Group({ name: 'parent', children: [sibling.uid, source.uid], pivot: [3, 0, 0], rotation: [0, 20, 0] });
  const project = new CubeBricksProject({ elements: [source, sibling], groups: [parent], outliner: [parent.uid] });
  const original = project.getNode(source.uid);
  addModifier(original, 'symmetry', { enabled: false });
  // Baking must preserve the geometry shown by the active format. Java's
  // legacy rotation limits are already applied to generated cubes in preview.
  const expected = constrainCube(original.toCubes()[0], formatRules(project));
  const result = bakeProceduralShape(project, source.uid);
  assert.ok(result?.cubes.length > 0, `${shapeType} can be baked`);
  assert.deepEqual(project.getNode(parent.uid).children, [sibling.uid, result.group.uid], 'baked group keeps the original sibling position');
  assert.deepEqual(result.group.rotation, original.rotation, 'owner rotation moves to the baked group');
  assert.deepEqual(result.group.pivot, original.pivot, 'owner pivot moves to the baked group');
  assert.deepEqual(result.cubes[0].position, expected.position.map((value, axis) => value + original.origin[axis]));
  assert.deepEqual(result.cubes[0].pivot, expected.pivot.map((value, axis) => value + original.origin[axis]));
  const originalStart = expected.position.map((value, axis) => value + original.origin[axis]);
  const originalCubePivot = expected.pivot.map((value, axis) => value + original.origin[axis]);
  const originalWorldPoint = applyGroupTransforms(
    rotatePoint(rotatePoint(originalStart, originalCubePivot, expected.rotation), original.pivot, original.rotation),
    [parent]
  );
  const bakedWorldPoint = applyGroupTransforms(
    rotatePoint(result.cubes[0].position, result.cubes[0].pivot, result.cubes[0].rotation),
    [parent, result.group]
  );
  assert.ok(almostEqual(originalWorldPoint, bakedWorldPoint), 'baking preserves geometry through parent and owner rotations');
  assert.deepEqual(result.cubes[0].faces, expected.faces, 'baking keeps subdivided UV and face data');
  assert.equal(result.group.modifiers.length, original.modifiers.length, 'owner modifiers move to the baked group');
  assert.equal(project.getNode(source.uid), null, 'the procedural source is replaced');
}

const nestedBakeCube = new Cube({ uid: 'nested-bake-cube', name: 'part',
  position: [3, 2, 1], size: [2, 3, 4], pivot: [1, 0, 0], rotation: [0, 0, 15], inflate: .25 });
const nestedBakeInner = new Group({ uid: 'nested-bake-inner', name: 'finger', pivot: [2, 1, 0],
  rotation: [25, 0, 0], inflate: .5, children: [nestedBakeCube.uid] });
const nestedBakeOuter = new Group({ uid: 'nested-bake-outer', name: 'hand', pivot: [1, 0, 2],
  rotation: [0, 20, 0], inflate: .75, children: [nestedBakeInner.uid] });
const nestedBakeOwner = new Group({ uid: 'nested-bake-owner', name: 'arm',
  inflate: 1, children: [nestedBakeOuter.uid] });
const nestedBakeModifier = addModifier(nestedBakeOwner, 'symmetry', {
  enabled: true, mode: 'axes', axes: { x: true, y: false, z: false },
  anchor: { position: [0, 0, 0] }, wrapParent: false
});
const nestedBakeProject = new CubeBricksProject({
  elements: [nestedBakeCube], groups: [nestedBakeOwner, nestedBakeOuter, nestedBakeInner],
  outliner: [nestedBakeOwner.uid]
});
const nestedBakeExport = exportBlockbench(nestedBakeProject);
assert.deepEqual(nestedBakeExport.outliner.map(group => group.name), ['right_arm', 'left_arm'],
  'direct bbmodel export uses the same baking branches without changing the open project');
for (const branch of nestedBakeExport.outliner) {
  const side = branch.name.split('_')[0];
  assert.equal(branch.children[0]?.name, `${side}_hand`, 'bbmodel export retains the named child group');
  assert.equal(branch.children[0]?.children[0]?.name, `${side}_finger`,
    'bbmodel export retains the named grandchild group');
  assert.equal(typeof branch.children[0]?.children[0]?.children[0], 'string',
    'bbmodel geometry stays inside the original subgroup tree');
}
assert.deepEqual(nestedBakeOwner.children, [nestedBakeOuter.uid], 'export does not mutate the source hierarchy');
const sourceCenter = nestedBakeCube.position.map((value, axis) => value + nestedBakeCube.size[axis] / 2);
const sourceWorldCenter = applyGroupTransforms(
  rotatePoint(sourceCenter, nestedBakeCube.pivot, nestedBakeCube.rotation),
  [nestedBakeOwner, nestedBakeOuter, nestedBakeInner]
);
const worldCorners = (cube, groups) => {
  const corners = [];
  for (const x of [cube.position[0], cube.position[0] + cube.size[0]])
    for (const y of [cube.position[1], cube.position[1] + cube.size[1]])
      for (const z of [cube.position[2], cube.position[2] + cube.size[2]])
        corners.push(applyGroupTransforms(rotatePoint([x, y, z], cube.pivot, cube.rotation), groups));
  return corners;
};
const sourceCorners = worldCorners(nestedBakeCube, [nestedBakeOwner, nestedBakeOuter, nestedBakeInner]);
for (const branch of nestedBakeExport.outliner) {
  const hand = branch.children[0];
  const finger = hand.children[0];
  const exported = nestedBakeExport.elements.find(element => element.uuid === finger.children[0]);
  assert.equal(exported.inflate, 2.5, 'exported cubes retain the combined inflation of all preserved groups');
  const exportedCube = new Cube({
    position: exported.from,
    size: exported.to.map((value, axis) => value - exported.from[axis]),
    pivot: exported.origin,
    rotation: exported.rotation
  });
  const exportedCorners = worldCorners(exportedCube, [branch, hand, finger].map(group => ({
    pivot: group.origin, rotation: group.rotation
  })));
  const expected = sourceCorners.map(point => branch.name === 'left_arm'
    ? [-point[0], point[1], point[2]] : point);
  assert.ok(expected.every(point => exportedCorners.some(corner =>
    corner.every((value, axis) => Math.abs(value - point[axis]) < 1e-4))),
  'direct bbmodel export preserves nested rotated cube geometry on both sides');
}
const nestedBakeResult = bakeModifier(nestedBakeProject, nestedBakeOwner, nestedBakeModifier.uid);
assert.equal(nestedBakeResult.groupUids.length, 7, 'baking retains two copies of both nested group levels');
const bakedArm = nestedBakeProject.getNode(nestedBakeResult.rootUid);
assert.deepEqual(bakedArm.children.map(uid => nestedBakeProject.getNode(uid).name), ['right_arm', 'left_arm']);
for (const [branchName, expectedCenter] of [
  ['right_arm', sourceWorldCenter], ['left_arm', [-sourceWorldCenter[0], sourceWorldCenter[1], sourceWorldCenter[2]]]
]) {
  const branch = nestedBakeProject.getNode(bakedArm.children.find(uid => nestedBakeProject.getNode(uid).name === branchName));
  const side = branchName.split('_')[0];
  const hand = nestedBakeProject.getNode(branch.children[0]);
  const finger = nestedBakeProject.getNode(hand.children[0]);
  const cube = nestedBakeProject.getNode(finger.children[0]);
  assert.equal(hand.name, `${side}_hand`, 'baked child groups use the mirrored side prefix');
  assert.equal(finger.name, `${side}_finger`, 'baked grandchild groups keep their level and prefix');
  assert.equal(cube.type, 'cube', 'baked geometry remains inside the original nested group path');
  const center = cube.position.map((value, axis) => value + cube.size[axis] / 2);
  const worldCenter = applyGroupTransforms(rotatePoint(center, cube.pivot, cube.rotation),
    nestedBakeProject.getGroupChain(cube.uid));
  assert.ok(worldCenter.every((value, axis) => Math.abs(value - expectedCenter[axis]) < 1e-4),
    'baking keeps nested rotated geometry in place on both sides');
  const expectedCorners = sourceCorners.map(point => branchName === 'left_arm' ? [-point[0], point[1], point[2]] : point);
  const actualCorners = worldCorners(cube, nestedBakeProject.getGroupChain(cube.uid));
  assert.ok(expectedCorners.every(expected => actualCorners.some(actual =>
    actual.every((value, axis) => Math.abs(value - expected[axis]) < 1e-4))),
  'baking retains all nested cube corners after reflection, not just their centre');
}
const radialBakeCube = new Cube({ uid: 'radial-bake-cube' });
const radialBakeChild = new Group({ uid: 'radial-bake-child', name: 'coil', children: [radialBakeCube.uid] });
const radialBakeOwner = new Group({ uid: 'radial-bake-owner', name: 'wheel', children: [radialBakeChild.uid] });
const radialBakeModifier = addModifier(radialBakeOwner, 'symmetry', {
  enabled: true, mode: 'radial', copies: 3
});
const radialBakeProject = new CubeBricksProject({
  elements: [radialBakeCube], groups: [radialBakeOwner, radialBakeChild], outliner: [radialBakeOwner.uid]
});
const radialBakeResult = bakeModifier(radialBakeProject, radialBakeOwner, radialBakeModifier.uid);
const radialBakedRoot = radialBakeProject.getNode(radialBakeResult.rootUid);
assert.deepEqual(radialBakedRoot.children.map(uid => radialBakeProject.getNode(uid).name),
  ['wheel_1', 'wheel_2', 'wheel_3']);
assert.deepEqual(radialBakedRoot.children.map(uid =>
  radialBakeProject.getNode(radialBakeProject.getNode(uid).children[0]).name),
['coil_1', 'coil_2', 'coil_3'], 'radial baking applies the numbered suffix to retained child groups');

console.log('Model group import tests passed.');
