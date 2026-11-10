import assert from 'node:assert/strict';
import { Cube, Group, Shape, BezierElement, CubeBricksProject, addModifier, bakeModifier, bakeProceduralShape,
  exportBlockbench, importBlockbench, buildModifierRenderInstances } from '../src/model.js';
import { rotatePoint, applyGroupTransforms } from '../src/common/core/geometry-utils.js';
import { shapeRegistry } from '../src/shapes/builtins.js';
import { FormatConstraintDefinition } from '../src/common/core/format-hooks.js';
import { constrainNode, constrainProject, formatRules, projectSizeBounds, bedrockSizeIsValid, javaBlockSizeIsValid } from '../src/common/core/format-constraints.js';
import { proceduralCubeWorld, constrainElementCube } from '../src/common/core/procedural-format.js';
import { JavaBlockVersion } from '../src/common/core/java-block-version.js';
import { foldJavaCubeRotation } from '../src/utils/math/cube-quarter-turn.js';
import { modifierRegistry } from '../src/common/config/modifiers.js';
import { ModifierRegistry } from '../src/common/core/modifier-registry.js';
import { createUvPreviewElement } from '../src/texture/culled-face-preview.js';

function assertGeometry(actual, expected, message) {
  assert.equal(actual.length, expected.length, message + ': vertex count');
  const remaining = [...actual];
  for (const point of expected) {
    const index = remaining.findIndex(candidate => candidate.every((value, axis) => Math.abs(value - point[axis]) < 1e-5));
    assert.ok(index >= 0, message + ': missing vertex ' + point.join(','));
    remaining.splice(index, 1);
  }
}
function geometry(project, modifiers = false) {
  const cubePoints = new Map();
  for (const element of project.elements) {
    if (['node', 'locator'].includes(element.type)) continue;
    const procedural = typeof element.toCubes === 'function', cubes = procedural ? element.toCubes(project) : [constrainElementCube(project, element)];
    const offset = procedural ? element.origin : [0, 0, 0], groups = project.getGroupChain(element.uid);
    cubePoints.set(element.uid, cubes.map(cube => Array.from({ length: 8 }, (_, mask) => {
      let point = cube.position.map((value, axis) => value + offset[axis] + ((mask >> axis) & 1) * cube.size[axis]);
      point = rotatePoint(point, cube.pivot.map((value, axis) => value + offset[axis]), cube.rotation);
      if (procedural) point = rotatePoint(point, element.pivot || element.origin, element.rotation);
      return applyGroupTransforms(point, groups);
    })));
  }
  const points = [...cubePoints.values()].flat(2);
  if (modifiers) for (const instance of buildModifierRenderInstances(project)) for (const uid of instance.sourceUids) {
    const cubes = cubePoints.get(uid) || [];
    for (const index of instance.cubeIndices[uid] || cubes.map((_, index) => index)) for (const point of cubes[index]) points.push(instance.matrix.map((row, axis) => row.reduce((sum, value, col) => sum + value * point[col], instance.translation[axis])));
  }
  return points;
}
function shape(type, variant = 'standard') {
  if (type.startsWith('bezier')) return new BezierElement({ uid: type + variant, variant, origin: [0, 2, 0],
    rotation: type === 'bezier2d' ? [-90, 0, 0] : [0, 0, 0],
    nodes: [{ position: [0, 0, 0] }, { position: [3, type === 'bezier2d' ? 0 : 4, 5] }, { position: [-1, type === 'bezier2d' ? 0 : 8, 9] }],
    parameters: { thickness: 1.4, radius: .8, segmentLength: 2.6, segmentationMode: 'distance' } }, type === 'bezier2d' ? 2 : 3);
  return new Shape({ uid: type, type, origin: [0, 2, 0], rotation: [13, 21, 8],
    parameters: { radius: 3.3, height: 6.7, sides: 7 } });
}
const definitions = ['polygon_prism', 'bezier2d', 'bezier3d', 'dodecahedron', 'truncated_icosahedron'];
assert.equal(new FormatConstraintDefinition().constrainFormat({}, {}), undefined);
assert.equal(new FormatConstraintDefinition().supportsFormat({}), true);

for (const version of Object.values(JavaBlockVersion)) for (const type of definitions) {
  const source = shape(type), parent = new Group({ uid: 'parent', pivot: [0, 2, 0], rotation: [15, 24, -10], children: [source.uid] });
  const project = new CubeBricksProject({ formatId: 'java_block_item', formatData: { javaBlockVersion: version },
    elements: [source], groups: [parent], outliner: [parent.uid] });
  const owner = project.getNode(source.uid), rules = formatRules(project);
  if (type.includes('hedron') && rules.singleAxisRotation) {
    assert.equal(owner.toCubes().length, 0, 'unsupported low-version polyhedra do not generate illegal cubes');
    assert.throws(() => exportBlockbench(project), /不支持/); continue;
  }
  const before = JSON.stringify(project), cubes = owner.toCubes();
  assert.ok(cubes.length, type + ': generated geometry remains available');
  for (const cube of cubes) {
    const world = proceduralCubeWorld(owner, cube, project);
    assert.equal(cube.uvMode, 'face');
    if (rules.singleAxisRotation) assert.equal(foldJavaCubeRotation(world, { ...rules, strict: true }), true, 'quarter turns can be consumed without changing geometry');
    if (rules.singleAxisRotation) assert.ok(world.rotation.filter(value => Math.abs(value) > 1e-5).length <= 1, type + ': global rotation uses one axis');
    if (rules.rotationStep) assert.ok(world.rotation.every(value => Math.abs(value / 22.5 - Math.round(value / 22.5)) < 1e-5));
    assert.ok(world.position.every((value, axis) => Math.min(value, value + world.size[axis]) >= -16 - 1e-5 && Math.max(value, value + world.size[axis]) <= 32 + 1e-5));
  }
  const preview = geometry(project), bb = exportBlockbench(project);
  assert.ok(bb.elements.every(cube => !cube.box_uv));
  assertGeometry(geometry(importBlockbench(bb)), preview, `${type}/${version}: Java preview and export use the same fitted geometry`);
  assert.equal(JSON.stringify(project), before, 'format evaluation and export do not edit the source document');
  const baked = bakeProceduralShape(project, owner.uid);
  assert.ok(baked); assertGeometry(geometry(project), preview, `${type}/${version}: manual bake preserves the preview`);
}

for (const type of definitions) for (const variant of type.startsWith('bezier') ? ['standard', 'envelope'] : ['standard']) {
  const source = shape(type, variant), parent = new Group({ uid: 'parent', rotation: [11, -17, 23], children: [source.uid] });
  const project = new CubeBricksProject({ formatId: 'modded_entity', elements: [source], groups: [parent], outliner: [parent.uid] });
  const owner = project.getNode(source.uid), before = JSON.stringify(project), preview = geometry(project);
  assert.ok(owner.toCubes().every(cube => cube.uvMode === 'box' && cube.autoUv && cube.size.every(Number.isInteger)));
  const bb = exportBlockbench(project);
  assert.ok(bb.elements.every(cube => cube.box_uv && cube.rotation.every(value => Math.abs(value) < 1e-5)
    && cube.to.every((value, axis) => Math.abs(value - cube.from[axis] - Math.round(value - cube.from[axis])) < 1e-6)));
  assertGeometry(geometry(importBlockbench(bb)), preview, `${type}/${variant}: entity bones preserve fitted column orientations`);
  assert.equal(JSON.stringify(project), before);
  bakeProceduralShape(project, owner.uid);
  assert.ok(project.elements.every(cube => cube.rotation.every(value => Math.abs(value) < 1e-5)));
  assertGeometry(geometry(project), preview, `${type}/${variant}: manual entity bake matches preview`);
}

for (const formatId of ['java_block_item', 'bedrock_block', 'modded_entity']) {
  const cube = new Cube({ uid: 'source', position: [-2, 0, -1], size: [4, 3, 2], pivot: [0, 0, 0], rotation: [0, 22.5, 0] });
  const group = new Group({ uid: 'root', children: [cube.uid] });
  const project = new CubeBricksProject({ formatId, elements: [cube], groups: [group], outliner: [group.uid] });
  const root = project.getNode(group.uid);
  const radial = addModifier(root, 'symmetry', { mode: 'radial', copies: 3, ignoreDuplicateCubes: false }, project);
  const copy = addModifier(root, 'element_copy', {}, project);
  copy.nodes[0].position = [100, 50, -100]; copy.nodes[0].rotation = [13, 27, 39];
  constrainProject(project);
  if (formatId === 'java_block_item') { assert.equal(radial.copies, 4); assert.ok(javaBlockSizeIsValid(project)); }
  if (formatId === 'bedrock_block') assert.ok(bedrockSizeIsValid(projectSizeBounds(project)), 'modifier results participate in the dynamic Bedrock bounds');
  const preview = geometry(project, true), bb = exportBlockbench(project);
  assertGeometry(geometry(importBlockbench(bb)), preview, formatId + ': stacked modifier export matches the constrained preview');
  bakeModifier(project, root, radial.uid);
  assertGeometry(geometry(project, true), preview, formatId + ': baking one modifier retains the remaining stack');
}

for (const type of definitions) {
  const source = shape(type);
  source.origin = [100, 120, -200]; source.pivot = [...source.origin];
  if (source.parameters.radius) source.parameters.radius = 60;
  if (source.parameters.height) source.parameters.height = 70;
  const project = new CubeBricksProject({ formatId: 'bedrock_block', elements: [source] });
  assert.ok(bedrockSizeIsValid(projectSizeBounds(project)), type + ': fit the whole shape inside the Bedrock domain');
  const preview = geometry(project);
  assertGeometry(geometry(importBlockbench(exportBlockbench(project))), preview, type + ': Bedrock export retains the fitted assembly');
  const reopened = new CubeBricksProject(JSON.parse(JSON.stringify(project)));
  assertGeometry(geometry(reopened), preview, type + ': fitted domain survives reopening');
}

for (const [version, mode, copies, distribution, start, end, angle] of [
  [JavaBlockVersion.LEGACY, 'radial', 8, 'full', 0, 360, 22.5],
  [JavaBlockVersion.LEGACY, 'radial', 5, 'range', -45, 45, 22.5],
  [JavaBlockVersion.SINGLE_AXIS, 'radial', 3, 'full', 0, 360, 13],
  [JavaBlockVersion.SINGLE_AXIS, 'mandala', 3, 'full', 0, 360, 13]
]) {
  const project = new CubeBricksProject({ formatId: 'java_block_item', formatData: { javaBlockVersion: version },
    elements: [{ type: 'cube', uid: 'source', position: [1, 1, 1], size: [2, 3, 2], rotation: [0, angle, 0] }] });
  const owner = project.elements[0];
  const modifier = addModifier(owner, 'symmetry', { mode, copies, distribution, rangeStart: start, rangeEnd: end, ignoreDuplicateCubes: false }, project);
  assert.equal(modifier.copies, copies, 'retain non-quarter-turn counts when the actual source geometry supports them');
  const copy = addModifier(owner, 'element_copy', {}, project);
  copy.nodes[0].position = [8, 1, 0]; copy.nodes[0].rotation = [0, angle + 45, 0];
  constrainNode(owner, formatRules(project), project);
  assert.equal(copy.nodes[0].rotation[1], angle + 45, 'retain a valid relative copy angle instead of forcing a quarter turn');
  const preview = geometry(project, true);
  assertGeometry(geometry(importBlockbench(exportBlockbench(project))), preview, mode + '/' + version + ': legal extended counts survive export');
}

{
  const faces = Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map((name, index) => [name,
    { texture: index, uv: [index + 5, index, index, index + 3], rotation: index % 4 * 90 }]));
  const project = new CubeBricksProject({ formatId: 'java_block_item', elements: [
    { uid: 'cube', type: 'cube', size: [-3, 4, 2], rotation: [0, 0, 0], faces }],
    groups: [{ uid: 'parent', type: 'group', children: ['cube'], rotation: [0, 90, 0] }], outliner: ['parent'] });
  const cube = project.elements[0], modifier = addModifier(cube, 'element_copy', {}, project), node = modifier.nodes[0];
  constrainNode(cube, formatRules(project), project);
  assert.equal(cube.modifiers[0], modifier, 'format changes retain the active modifier object');
  assert.equal(modifier.nodes[0], node, 'format changes retain the active copy node');
  const effective = constrainElementCube(project, cube);
  assert.deepEqual(effective.faces, cube.faces, 'folded quarter turns keep live source face names, UV rotation and mirrors');
  assert.equal(Math.sign(effective.size[0]), -1, 'live source signed axes remain stable');
  assert.deepEqual(createUvPreviewElement(cube).element.position, effective.position, 'UV preview uses adapted source geometry without modifier results');
  const visual = Object.assign(Object.create(cube), { visible: true });
  assert.deepEqual(constrainElementCube(project, visual).position, effective.position, 'prototype-based visual copies retain their coordinates');
}

for (const formatId of ['java_block_item', 'modded_entity', 'bedrock_block']) {
  const project = new CubeBricksProject({ formatId, elements: [shape('bezier3d')] });
  const owner = project.elements[0], before = geometry(project), base = owner.toFormatBaseCubes()[0];
  owner.subdivisionEdits = { 0: { faces: { ...base.faces, north: { texture: 3, uv: [2, 4, 7, 9], rotation: 90 } } } };
  const edited = owner.toCubes()[0];
  assert.equal(edited.faces.north.texture, 3, 'subdivision face edits retain face identity');
  assertGeometry(geometry(project), before, formatId + ': changing a generated face UV does not alter geometry');
}

for (const formatId of ['java_block_item', 'modded_entity']) {
  const project = new CubeBricksProject({ formatId, elements: [
    { type: 'cube', uid: 'edited', size: [2, 2, 2] },
    { type: 'cube', uid: 'unrelated', size: [-3, 4, 2], rotation: [0, 90, 0] }] });
  const unrelated = project.getNode('unrelated'), before = JSON.stringify(unrelated);
  const modifier = addModifier(project.elements[0], 'symmetry', { ignoreDuplicateCubes: false }, project);
  bakeModifier(project, project.elements[0], modifier.uid);
  assert.equal(JSON.stringify(unrelated), before, 'baking a modifier does not rewrite unrelated Cube data');
  assert.equal(project.getParentGroup(unrelated.uid), null, 'unrelated Cubes acquire no materialization groups');
}

{
  const calls = [];
  shapeRegistry.register({ id: 'format_probe', label: 'Format probe', defaults: { width: 1 },
    constrainFormat(subject, context) {
      assert.equal(typeof context.utils.format.procedural.constrainBuiltinShape, 'function');
      calls.push(context.phase);
      if (context.phase === 'parameters') subject.parameters.width = 3;
      if (context.phase === 'geometry') subject[0].size[0] = 5;
    }, generate: (owner, { Cube }) => [new Cube({ size: [owner.parameters.width, 2, 2] })] }, { external: true });
  const project = new CubeBricksProject({ formatId: 'java_block_item', elements: [{ type: 'format_probe' }] });
  assert.equal(project.elements[0].parameters.width, 3);
  assert.equal(project.elements[0].toCubes()[0].size[0], 5);
  assert.ok(calls.includes('parameters') && calls.includes('geometry'), 'external Shape definitions override both format phases');
  shapeRegistry.removeExternal();

  modifierRegistry.register({ id: 'format_probe', targets: ['cube'], createDefault: () => ({}),
    supportsFormat: rules => !rules.moddedEntity,
    constrainFormat(subject, context) { subject.evaluations = (subject.evaluations || 0) + 1; assert.ok(context.utils); } });
  const cube = new Cube(); project.addElement(cube);
  addModifier(cube, 'format_probe', {}, project);
  const before = JSON.stringify(cube.modifiers);
  buildModifierRenderInstances(project);
  assert.equal(JSON.stringify(cube.modifiers), before, 'read-only evaluation runs modifier hooks on isolated data');
  assert.ok(!modifierRegistry.listFor('cube', formatRules({ formatId: 'modded_entity' })).some(definition => definition.id === 'format_probe'));
  const separate = new ModifierRegistry();
  separate.register({ id: 'symmetry', label: modifierRegistry.get('symmetry').label, targets: ['cube'], constrainFormat() { throw Error('Registry isolation failed'); } });
  const ordinary = new CubeBricksProject({ elements: [new Cube()] });
  assert.ok(addModifier(ordinary.elements[0], 'symmetry', {}, ordinary), 'independent registries cannot replace built-in format hooks');
}

console.log('Procedural formats: hooks, Java versions, bounds, bone rotations, preview, baking and export passed.');
