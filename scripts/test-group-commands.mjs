import assert from 'node:assert/strict';
import { Cube, Group, Shape, BezierElement, CubeBricksProject, addModifier } from '../src/model.js';
import { sourceCubeEntries, sourceWorldVertices } from '../src/model/modifier-evaluation.js';
import { requireOperation } from '../src/common/core/operation-registry.js';
import { createElementCommands } from '../src/editor/element-commands.js';
import { dissolveGroupInPlace } from '../src/editor/group-dissolve.js';
import { captureBakeFrames } from '../src/model/procedural-bake-frames.js';
import { applyTransform, displayedTransformVector } from '../src/common/core/applied-transform.js';
import { buildElementGeometry } from '../src/render/scene-geometry.js';

function fixture() {
  const first = new Cube({ uid: 'first', position: [2, 4, -3], rotation: [10, 25, 5] });
  const second = new Cube({ uid: 'second' });
  const third = new Cube({ uid: 'third' });
  const inner = new Group({ uid: 'inner', children: [third.uid], pivot: [3, 2, 1], rotation: [10, 5, 30] });
  const parent = new Group({ uid: 'parent', children: [first.uid, second.uid, inner.uid],
    pivot: [9, 5, -2], rotation: [15, 20, 35] });
  const project = new CubeBricksProject({ elements: [first, second, third], groups: [parent, inner], outliner: [parent.uid] });
  const state = { mode: 'edit', project, selectedUid: null, selectedUids: new Set(), collapsedGroups: new Set(['inner']) };
  state.outlinerRows = ['parent', 'first', 'second', 'inner', 'third'].map(uid => ({ node: project.getNode(uid) }));
  const snapshots = [];
  const commands = createElementCommands({
    state, selectedNodeUids: () => [...state.selectedUids],
    topLevelSelectedUids: () => [...state.selectedUids].filter(id =>
      !project.getGroupChain(id).some(group => state.selectedUids.has(group.uid))),
    snapshot(id) { snapshots.push({ id: requireOperation(id), data: project.serialize() }); },
    markDirty() {}, renderAll() {}, toast() {}, captureOutlinerRowPositions() { return []; },
    animateOutlinerReorder() {}, inspectorController: {}
  });
  const select = (...ids) => { state.selectedUids = new Set(ids); state.selectedUid = ids.at(-1); };
  const result = () => project.getNode(state.selectedUid);
  return { project, state, commands, snapshots, select, result };
}
function geometry(project) {
  return project.elements.map(element => sourceCubeEntries(project, element).map(source =>
    sourceWorldVertices(source).map(point => point.map(value => +value.toFixed(6)))));
}
function renderedPoints(project) {
  return buildElementGeometry(project, project.elements, new Set()).boundsPoints
    .map(point => point.map(value => +value.toFixed(5)).join(',')).sort();
}

for (const selected of ['first', 'inner', 'parent']) {
  const { project, commands, select, result, snapshots } = fixture();
  select(selected);
  const parent = project.getParentGroup(selected);
  const container = parent ? parent.children : project.outliner;
  const index = container.indexOf(selected), before = geometry(project);
  commands.groupSelected();
  assert.deepEqual(result().children, [selected], 'a single element or entire group can be wrapped');
  assert.equal(container[index], result().uid, 'the wrapper occupies the original row');
  assert.equal(project.getParentGroup(selected).uid, result().uid);
  assert.deepEqual(geometry(project), before, 'wrapping preserves geometry through rotated parents and children');
  assert.equal(snapshots[0].id, 'core.group.group');
  assert.equal(new CubeBricksProject(JSON.parse(snapshots[0].data)).groups.length, 2,
    'the undo snapshot predates the new wrapper');
}
for (const ids of [[], ['parent'], ['first'], ['inner'], ['first', 'inner'], ['inner', 'first']]) {
  const { project, commands, select, result, snapshots } = fixture();
  select(...ids);
  const container = (ids.length && project.getParentGroup(ids.at(-1))?.children) || project.outliner;
  const expectedIndex = ids.length ? container.indexOf(ids.at(-1)) + 1 : container.length;
  const before = geometry(project), existingChildren = [...project.getNode('inner').children];
  commands.addEmptyGroup();
  assert.deepEqual(result().children, [], 'G always creates an empty group');
  assert.equal(container[expectedIndex], result().uid, 'the empty group follows the last selected row');
  assert.deepEqual(project.getNode('inner').children, existingChildren, 'selecting one group does not insert inside it');
  assert.deepEqual(geometry(project), before);
  assert.equal(snapshots[0].id, 'core.group.create');
}
{
  const { project, commands, select, result } = fixture();
  select('inner', 'first');
  commands.groupSelected();
  assert.deepEqual(result().children, ['first', 'inner'], 'grouping retains hierarchy order rather than click order');
  assert.deepEqual(project.getNode('parent').children, [result().uid, 'second']);
}
{
  const { project, commands, select, result } = fixture();
  select('parent', 'first', 'third');
  commands.groupSelected();
  assert.deepEqual(result().children, ['parent'], 'a selected ancestor absorbs selected descendants only once');
  assert.deepEqual(project.outliner, [result().uid]);
}
{
  const { state, commands, select, snapshots } = fixture();
  commands.groupSelected();
  assert.equal(snapshots.length, 0, 'grouping an empty selection is a no-op');
  select('first');
  state.mode = 'paint';
  commands.groupSelected();
  commands.addEmptyGroup();
  assert.equal(snapshots.length, 0, 'painting cannot create or wrap model groups');
}
for (const target of ['inner', 'parent']) {
  const { project, state, commands, select, snapshots } = fixture();
  project.formatId = 'bedrock_entity';
  project.getNode('first').size[0] *= -1;
  const before = geometry(project), children = [...project.getNode(target).children];
  const parent = project.getParentGroup(target), siblings = parent ? parent.children : project.outliner;
  const index = siblings.indexOf(target), previous = [...siblings];
  const faces = project.elements.map(node => structuredClone(node.faces));
  select(target); commands.dissolveGroup();
  assert.equal(project.getNode(target), null, 'only the chosen group is removed');
  assert.deepEqual(siblings, [...previous.slice(0, index), ...children, ...previous.slice(index + 1)], 'children replace the group in place');
  if (target === 'parent') assert.deepEqual(project.getNode('inner').children, ['third'], 'child groups are not dissolved');
  assert.deepEqual(geometry(project), before, 'nested world geometry survives dissolve');
  assert.deepEqual(project.elements.map(node => node.faces), faces, 'UVs remain unchanged');
  assert.deepEqual([...state.selectedUids], children);
  assert.equal(snapshots[0].id, 'core.group.dissolve');
  assert.equal(new CubeBricksProject(JSON.parse(snapshots[0].data)).getNode(target).type, 'group', 'undo restores the original group');
}
for (const target of ['inner', 'parent']) {
  const { project, commands, select, snapshots } = fixture();
  project.formatId = 'bedrock_entity';
  const cube = project.getNode('third');
  applyTransform(cube, 'rotation');
  addModifier(cube, 'element_copy', { nodes: [{ uid: 'copy', position: [4, 3, 2], rotation: [12, 14, 25] }] });
  const fields = ['position', 'origin', 'pivot', 'rotation', 'size', 'rescale', 'faces', 'appliedTransform', 'modifiers', 'operators'];
  const localData = node => Object.fromEntries(fields.filter(field => field in node).map(field => [field, structuredClone(node[field])]));
  const original = new Map([...project.elements, ...project.groups].filter(node => node.uid !== target).map(node => [node.uid, localData(node)]));
  const children = [...project.getNode(target).children], before = geometry(project);
  select(target); commands.dissolveGroup(target, { compensateRotation: false });
  assert.equal(project.getNode(target), null);
  for (const [uid, data] of original) assert.deepEqual(localData(project.getNode(uid)), data, 'uncompensated dissolve preserves all local transform and attachment values');
  for (const uid of children) assert.ok(!project.getGroupChain(uid).some(group => group.uid === target));
  if (target === 'parent') assert.deepEqual(project.getNode('inner').children, ['third'], 'the child group remains intact');
  assert.notDeepEqual(geometry(project), before, 'removing the rotated parent intentionally changes the world pose');
  assert.equal(snapshots[0].id, 'core.group.dissolve_no_rotation');
  const restored = new CubeBricksProject(JSON.parse(snapshots[0].data));
  assert.deepEqual(geometry(restored), before, 'undo recovers the original parent transform');
}
{
  const { project, commands, select } = fixture();
  project.formatId = 'bedrock_entity';
  const shape = new Shape({ uid: 'shape', origin: [1, 3, 2], pivot: [4, 2, 1], rotation: [15, 23, 34] });
  const curve = new BezierElement({ uid: 'curve', origin: [2, 1, -3], rotation: [-15, 8, 21] }, 3);
  project.addElement(shape, 'inner'); project.addElement(curve, 'inner');
  const cube = project.getNode('third'); applyTransform(cube, 'position'); applyTransform(cube, 'rotation');
  addModifier(cube, 'element_copy', { nodes: [{ uid: 'copy', position: [4, 3, 2], rotation: [12, 14, 25] }] });
  addModifier(shape, 'symmetry', { anchor: { position: [3, 2, 1], rotation: [20, 15, 7] } });
  const framesBefore = [cube, shape].map(node => captureBakeFrames(project, node));
  const before = geometry(project);
  select('inner'); commands.dissolveGroup();
  assert.deepEqual(geometry(project), before, 'Shapes and curves stay procedural with unchanged geometry');
  assert.equal(typeof project.getNode('shape').toCubes, 'function');
  for (const field of ['position', 'rotation']) assert.ok(displayedTransformVector(cube, field).every(value => Math.abs(value) < 1e-6), 'applied transforms remain applied');
  const framesAfter = [cube, shape].map(node => captureBakeFrames(project, node));
  const numbers = value => JSON.stringify(value, (_, item) => typeof item === 'number' ? +item.toFixed(5) : item);
  assert.equal(numbers(framesAfter), numbers(framesBefore), 'child modifier anchors and sibling copy nodes keep their world operations');
}
{
  const { project, commands, select, snapshots } = fixture();
  const group = project.getNode('inner');
  group.children = []; project.invalidateHierarchyIndex(); select(group.uid); commands.dissolveGroup();
  assert.equal(project.getNode(group.uid), null, 'empty groups can be dissolved');
  assert.equal(snapshots.length, 1);
  assert.equal(dissolveGroupInPlace(project, 'first'), null, 'non-groups are ignored');
}
for (const formatId of ['modded_entity', 'java_block_item']) {
  const project = new CubeBricksProject({ formatId, formatData: { javaBlockBoundsEnabled: false },
    elements: [new Cube({ uid: 'cube', position: [1, 2, 3], size: [2, 3, 4], pivot: [0, 0, 0], rotation: [0, 0, 0] })],
    groups: [new Group({ uid: 'group', rotation: [33, 21, 17], pivot: [1, 0, -1], children: ['cube'] })], outliner: ['group'] });
  const before = geometry(project);
  dissolveGroupInPlace(project, 'group');
  assert.deepEqual(geometry(project), before, `${formatId}: format-specific rotation storage preserves appearance`);
  assert.equal(project.getNode('group'), null, 'the requested group is removed even when a format needs a rotation bone');
  assert.equal(project.getNode('cube').type, 'cube', 'the original Cube identity survives');
}
for (const formatId of ['modded_entity', 'java_block_item']) {
  const project = new CubeBricksProject({ formatId, formatData: { javaBlockBoundsEnabled: false },
    elements: [new Cube({ uid: 'cube', position: [1, 2, 3], size: [2, 3, 4], pivot: [0, 0, 0],
      rotation: formatId === 'modded_entity' ? [0, 0, 0] : [0, 22.5, 0], rescale: true, inflate: .125 })],
    groups: [new Group({ uid: 'group', rotation: [33, 21, 17], inflate: .25, children: ['cube'] })], outliner: ['group'] });
  const before = renderedPoints(project);
  dissolveGroupInPlace(project, 'group');
  assert.deepEqual(renderedPoints(project), before, `${formatId}: rescale stays visually correct when rotation needs a legal bone`);
}
{
  const { project, commands, select } = fixture();
  project.formatId = 'bedrock_entity';
  const group = project.getNode('inner');
  Object.assign(group, { inflate: .25, visible: false, shade: false, locked: true, exported: false });
  const before = geometry(project); select('inner'); commands.dissolveGroup();
  assert.deepEqual(geometry(project), before, 'inherited inflation is transferred to the promoted child');
  const child = project.getNode('third');
  assert.equal(child.inflate, .25);
  assert.equal(child.visible, false); assert.equal(child.shade, false);
  assert.equal(child.locked, true); assert.equal(child.exported, false);
}
{
  const { project } = fixture();
  project.formatId = 'bedrock_entity';
  Object.assign(project.getNode('third'), { rotation: [0, 22.5, 0], rescale: true, inflate: .125 });
  project.getNode('inner').inflate = .25; project.getNode('parent').inflate = .125;
  const before = renderedPoints(project);
  dissolveGroupInPlace(project, 'inner');
  assert.deepEqual(renderedPoints(project), before, 'rotation rescale includes inherited inflation when dissolving a rotated group');
}
console.log('Group placement, wrapping, single-layer dissolve, world transforms, modifier frames and undo snapshots passed.');
