import assert from 'node:assert/strict';
import { BezierElement, Group, CubeBricksProject, addModifier, addOperator,
  bakeProceduralShape, bakeModifier, buildModifierRenderInstances, exportBlockbench, importBlockbench } from '../src/model.js';
import { copyNodeAffine, sourceCubeEntries, sourceWorldVertices, symmetryWorldFrame } from '../src/model/modifier-evaluation.js';

const pointKey = point => point.map(value => Number(value.toFixed(4))).join(',');
const cubeKey = vertices => vertices.map(pointKey).sort().join(';');
function geometry(project) {
  const sources = new Map(), keys = [];
  for (const element of project.elements) {
    const cubes = sourceCubeEntries(project, element);
    sources.set(element.uid, cubes);
    for (const source of cubes) keys.push(cubeKey(sourceWorldVertices(source)));
  }
  for (const instance of buildModifierRenderInstances(project)) for (const uid of instance.sourceUids) {
    for (const source of sources.get(uid) || []) {
      if (instance.cubeIndices[uid] && !instance.cubeIndices[uid].includes(source.index)) continue;
      keys.push(cubeKey(sourceWorldVertices(source).map(point => instance.matrix.map((row, axis) =>
        row.reduce((sum, value, index) => sum + value * point[index], instance.translation[axis])))));
    }
  }
  return keys.sort();
}
const near = (first, second) => assert.ok(first.flat(Infinity).every((value, index) =>
  Math.abs(value - second.flat(Infinity)[index]) < 1e-7));

for (const headAtStart of [true, false]) for (const rotatedParent of [false, true]) {
  for (const mode of ['axes', 'radial', 'mandala', 'element_copy']) {
    const curve = new BezierElement({
      uid: 'envelope', variant: 'envelope', origin: [7, 11, -4], rotation: [15, 40, -20],
      nodes: [{ position: [2, 1, 3], radius: 1 }, { position: [6, 8, -2], radius: 2 }, { position: [10, 10, 7], radius: .75 }],
      parameters: { radius: 1, segmentationMode: 'angle', angleStep: 35, headAtStart, nestedBake: true }
    }, 3);
    const modifier = addModifier(curve, mode === 'element_copy' ? mode : 'symmetry', {
      mode, copies: 3, axes: { x: true, y: false, z: true }, ignoreDuplicateCubes: false,
      anchor: { position: [4, 12, -6], rotation: [10, 20, 30] }
    });
    if (mode === 'element_copy') modifier.nodes[0] = { ...modifier.nodes[0], position: [20, 5, -9], rotation: [20, -10, 35] };
    addOperator(curve, 'paint_symmetry', { anchor: { position: [9, 4, -3], rotation: [5, 30, 20] } });
    const parent = new Group({ uid: 'parent', pivot: [3, 5, 1], rotation: rotatedParent ? [10, 30, 25] : [0, 0, 0], children: [curve.uid] });
    const data = { formatId: 'bedrock_entity', elements: [curve], groups: [parent], outliner: [parent.uid] };
    const project = new CubeBricksProject(data);
    const expected = geometry(project);
    const owner = project.getNode(curve.uid);
    const sourceState = JSON.stringify(project.elements);
    const sourceGroups = JSON.stringify(project.groups);
    const bb = exportBlockbench(project);
    assert.deepEqual(geometry(importBlockbench(bb)), expected, `${mode}: export preserves both head directions and rotated parents`);
    assert.equal(JSON.stringify(project.elements), sourceState);
    assert.equal(JSON.stringify(project.groups), sourceGroups);

    const before = mode === 'element_copy' ? copyNodeAffine(project, owner, owner.modifiers[0].nodes[0])
      : symmetryWorldFrame(project, owner, owner.modifiers[0]);
    const paintFrame = symmetryWorldFrame(project, owner, owner.operators[0]);
    const baked = bakeProceduralShape(project, owner.uid);
    const after = mode === 'element_copy' ? copyNodeAffine(project, baked.group, baked.group.modifiers[0].nodes[0])
      : symmetryWorldFrame(project, baked.group, baked.group.modifiers[0]);
    near(before.matrix, after.matrix);
    near(before.center || before.translation, after.center || after.translation);
    near(paintFrame.center, symmetryWorldFrame(project, baked.group, baked.group.operators[0]).center);
    assert.deepEqual(geometry(project), expected, `${mode}: manual shape baking preserves modifier results`);
    bakeModifier(project, baked.group, baked.group.modifiers[0].uid);
    assert.deepEqual(geometry(project), expected, `${mode}: subsequent modifier baking remains consistent`);
  }
}
console.log('Nested envelope baking retains symmetry, copy and paint frames for both head directions under rotated parents.');
