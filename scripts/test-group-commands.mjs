import assert from 'node:assert/strict';
import { Cube, Group, CubeBricksProject } from '../src/model.js';
import { sourceCubeEntries, sourceWorldVertices } from '../src/model/modifier-evaluation.js';
import { requireOperation } from '../src/common/core/operation-registry.js';
import { createElementCommands } from '../src/editor/element-commands.js';

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
console.log('Empty-group placement, single/multiple wrapping, geometry preservation and undo snapshots passed.');
