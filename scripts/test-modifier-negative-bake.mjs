import assert from 'node:assert/strict';
import { Cube, Shape, Group, CubeBricksProject, addModifier, bakeModifier, buildModifierRenderInstances,
  exportBlockbench, importBlockbench } from '../src/model.js';
import { createSignedCubeCorners } from '../src/render/webgl-renderer.js';
import { rotatePoint, applyGroupTransforms, createBlockbenchFaceUvSlots, isCubeFaceCulled } from '../src/common/core/geometry-utils.js';

const layouts = { south: [7, 6, 4, 5], north: [2, 3, 1, 0], east: [6, 2, 5, 1],
  west: [3, 7, 0, 4], up: [3, 2, 7, 6], down: [4, 5, 0, 1] };
const faces = Object.fromEntries(Object.keys(layouts).map((name, index) => [name, name === 'east' ? null
  : { texture: `#${name}`, uv: [index, 2, index + 4, 7], rotation: index % 4 * 90 }]));
const signatures = Array.from({ length: 8 }, (_, bits) => [0, 1, 2].map(axis => bits & (1 << axis) ? -1 : 1));
// Baked Euler angles are serialized to four decimal places.
const close = (a, b) => a.every((value, index) => Math.abs(value - b[index]) < 1e-4);
const normal = quad => {
  const u = quad[2].map((value, axis) => value - quad[0][axis]);
  const v = quad[1].map((value, axis) => value - quad[0][axis]);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return n.map(value => value / Math.hypot(...n));
};
function surfaces(project, withModifiers = false) {
  const result = [], instances = withModifiers ? buildModifierRenderInstances(project) : [];
  for (const element of project.elements) {
    const cubes = element.type === 'cube' ? [element] : element.toCubes();
    const offset = element.type === 'cube' ? [0, 0, 0] : element.origin;
    const groups = project.getGroupChain(element.uid);
    const groupInflate = groups.reduce((sum, group) => sum + group.inflate, 0);
    for (let index = 0; index < cubes.length; index++) {
      const cube = cubes[index], pivot = cube.pivot.map((value, axis) => value + offset[axis]);
      const corners = createSignedCubeCorners(cube.position.map((value, axis) => value + offset[axis]), cube.size, cube.inflate + groupInflate)
        .map(point => rotatePoint(point, pivot, cube.rotation))
        .map(point => element.type === 'cube' ? point : rotatePoint(point, element.pivot, element.rotation))
        .map(point => applyGroupTransforms(point, groups));
      for (const instance of [null, ...instances.filter(item => item.sourceUids.includes(element.uid)
        && (!item.cubeIndices?.[element.uid] || item.cubeIndices[element.uid].includes(index)))]) {
        for (const [name, layout] of Object.entries(layouts)) {
          const face = cube.faces?.[name]; if (isCubeFaceCulled(face)) continue;
          const quad = layout.map(slot => instance ? instance.matrix.map((row, axis) =>
            row.reduce((sum, value, component) => sum + value * corners[slot][component], instance.translation[axis])) : corners[slot]);
          const uv = createBlockbenchFaceUvSlots(face.uv, face.rotation);
          result.push({ texture: face.texture, vertices: quad.map((point, slot) => [...point, ...uv[slot]]),
            normal: normal(quad).map(value => instance?.reflected ? -value : value) });
        }
      }
    }
  }
  return result;
}
function sameSurfaces(actual, expected, message) {
  assert.equal(actual.length, expected.length, `${message}: face count and culled faces`);
  const remaining = [...actual];
  for (const face of expected) {
    const index = remaining.findIndex(candidate => candidate.texture === face.texture && close(candidate.normal, face.normal)
      && face.vertices.every(vertex => candidate.vertices.some(other => close(vertex, other))));
    assert.notEqual(index, -1, `${message}: signed geometry, winding, inflation and UV correspondence`);
    remaining.splice(index, 1);
  }
}

for (const target of ['cube', 'group', 'shape']) for (const mode of ['axes', 'radial', 'mandala', 'element_copy']) {
  for (const signs of signatures) {
    const cube = new Cube({ uid: 'cube', name: 'signed', position: [2, 3, 4], size: [2, 3, 4].map((value, axis) => value * signs[axis]),
      rotation: [17, -23, 11], pivot: [1, 3, 2], inflate: .25, faces, uvMode: 'face' });
    let element = cube;
    if (target === 'shape') {
      element = new Shape({ uid: 'shape', origin: [1, 2, 3], pivot: [2, 4, 1], rotation: [12, 7, 15], uvMode: 'face',
        parameters: { sides: 4, radius: 2, height: 3 } });
      element.subdivisionEdits = Object.fromEntries(element.toBaseCubes().map((part, index) => [index, {
        sizeDelta: part.size.map((value, axis) => value * (signs[axis] - 1)), faces, inflateDelta: .25, uvMode: 'face'
      }]));
    }
    const child = new Group({ uid: 'child', rotation: [-12, 9, 7], pivot: [2, 1, 4], inflate: .125, children: [element.uid] });
    const owner = target === 'group' ? new Group({ uid: 'owner', rotation: [10, -7, 21],
      pivot: [1, 2, 3], inflate: .1, children: [child.uid] }) : element;
    const outer = new Group({ uid: 'outer', rotation: [13, 27, -19], pivot: [-2, 0, 3], inflate: .2,
      children: target === 'group' ? [owner.uid] : [child.uid] });
    const modifier = addModifier(owner, mode === 'element_copy' ? mode : 'symmetry', { mode, copies: 3,
      axes: { x: true, y: false, z: true }, ignoreDuplicateCubes: false,
      anchor: { position: [0, 0, 0], rotation: [5, 13, -4] } });
    if (mode === 'element_copy') modifier.nodes = [{ uid: 'copy', position: [9, 8, -7], rotation: [31, -43, 19] }];
    const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [element],
      groups: target === 'group' ? [outer, owner, child] : [outer, child], outliner: [outer.uid] });
    const expected = surfaces(project, true), context = `${target}/${mode}/${signs}`;
    const original = JSON.stringify(project);
    const exported = exportBlockbench(project);
    assert.equal(JSON.stringify(project), original, `${context}: export leaves the source unchanged`);
    bakeModifier(project, project.getNode(owner.uid), modifier.uid);
    sameSurfaces(surfaces(project), expected, `${context}: baking`);
    sameSurfaces(surfaces(importBlockbench(exported)), expected, `${context}: export`);
    assert.ok(project.elements.every(item => (item.type === 'cube' ? [item] : item.toCubes())
      .every(part => part.size.every((value, axis) => Math.sign(value) === signs[axis]))), `${context}: local size signs remain intact`);
  }
}

const negative = new Cube({ uid: 'negative', position: [-1, 0, 0], size: [-2, 2, 2], pivot: [0, 0, 0], inflate: .25 });
const occupied = new Cube({ uid: 'occupied', position: [3.25, -.25, -.25], size: [-2.5, 2.5, 2.5], pivot: [0, 0, 0] });
addModifier(negative, 'symmetry', { axes: { x: true, y: false, z: false }, ignoreDuplicateCubes: true });
const inflated = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [negative, occupied], outliner: [negative.uid, occupied.uid] });
assert.equal(buildModifierRenderInstances(inflated).some(instance => instance.sourceUids.includes(negative.uid)), false,
  'deduplication computes the actual outward inflation of negative dimensions');
console.log('Signed modifier geometry, winding, UVs and inflation survive baking and export.');
