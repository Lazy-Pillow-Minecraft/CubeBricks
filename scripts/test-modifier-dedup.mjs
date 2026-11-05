import assert from 'node:assert/strict';
import { Cube, Group, CubeBricksProject, addModifier, bakeModifier, buildModifierRenderInstances,
  exportBlockbench } from '../src/model.js';

const signs = Array.from({ length: 8 }, (_, bits) => [0, 1, 2].map(axis => bits & (1 << axis) ? -1 : 1));
const signedCube = (uid, min, signature) => new Cube({ uid, pivot: [0, 0, 0],
  position: min.map((value, axis) => value + (signature[axis] < 0 ? 2 : 0)),
  size: signature.map(value => value * 2) });
const cubeSigns = cubes => cubes.map(cube => (cube.size || cube.to.map((value, axis) => value - cube.from[axis]))
  .map(Math.sign).join(',')).sort();

for (const target of ['cube', 'group']) for (const sourceSigns of signs) for (const obstacleSigns of signs) {
  const source = signedCube('source', [-3, 0, 0], sourceSigns);
  const obstacle = signedCube('obstacle', [1, 0, 0], obstacleSigns);
  const owner = target === 'group' ? new Group({ uid: 'owner', children: [source.uid] }) : source;
  const modifier = addModifier(owner, 'symmetry', { axes: { x: true, y: false, z: false },
    ignoreDuplicateCubes: true, wrapParent: false });
  const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [source, obstacle],
    groups: target === 'group' ? [owner] : [], outliner: [owner.uid, obstacle.uid] });
  const sameSigns = sourceSigns.every((value, axis) => value === obstacleSigns[axis]);
  const context = `${target}: source ${sourceSigns}, obstacle ${obstacleSigns}`;
  const visibleCopy = buildModifierRenderInstances(project).some(instance => instance.sourceUids.includes(source.uid));
  assert.equal(visibleCopy, !sameSigns, `${context}: preview only removes cubes with matching size signs`);
  const original = JSON.stringify(project);
  const exported = exportBlockbench(project).elements;
  assert.equal(exported.length, sameSigns ? 2 : 3,
    `${context}: export uses the same signed overlap rule`);
  const expectedSigns = [sourceSigns.join(','), obstacleSigns.join(',')];
  if (!sameSigns) expectedSigns.push(sourceSigns.join(','));
  assert.deepEqual(cubeSigns(exported), expectedSigns.sort(), `${context}: export preserves negative dimensions`);
  assert.equal(JSON.stringify(project), original, 'export never mutates the source document');
  bakeModifier(project, project.getNode(owner.uid), modifier.uid);
  assert.equal(project.elements.length, sameSigns ? 2 : 3,
    `${context}: manual baking preserves opposite-sign overlaps`);
  assert.deepEqual(cubeSigns(project.elements), expectedSigns.sort(), `${context}: baking preserves negative dimensions`);
}

// A group containing opposite signed boxes on opposite sides must expand into
// two branches, rather than merging them because their reflected bounds match.
const left = signedCube('left', [-3, 0, 0], [1, 1, 1]);
const right = signedCube('right', [1, 0, 0], [-1, 1, 1]);
const group = new Group({ uid: 'group', children: [left.uid, right.uid] });
const modifier = addModifier(group, 'symmetry', { axes: { x: true, y: false, z: false },
  ignoreDuplicateCubes: true, wrapParent: false });
const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [left, right],
  groups: [group], outliner: [group.uid] });
const exported = exportBlockbench(project);
assert.equal(exported.elements.length, 4, 'opposite signs inside one scope are both retained');
assert.equal(exported.outliner.length, 2, 'opposite signs do not falsely trigger merged overlap branches');
const result = bakeModifier(project, project.getNode(group.uid), modifier.uid);
assert.equal(result.mergedRoot, false, 'manual baking uses signed overlap for group branch decisions');
assert.equal(project.elements.length, 4);
console.log('Modifier deduplication preserves per-axis size signs in preview, baking and export.');
