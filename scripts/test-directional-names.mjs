import assert from 'node:assert/strict';
import test from 'node:test';
import { Cube, Group, CubeBricksProject, addModifier, bakeModifier, exportBlockbench, renameFlippedNodes } from '../src/model.js';
import { flipDirectionalName, stripDirectionalNames, axisDirectionPrefix } from '../src/common/core/directional-names.js';
import { createToolboxController } from '../src/editor/toolbox/controller.js';
import { ConfigKey, configRegistry } from '../src/common/config/app-config.js';
import { createInspectorStackPanels } from '../src/screen/inspector/stack-panels.js';

const noop = () => {};
const projectOf = (elements = [], groups = [], formatId = 'bedrock_entity') => new CubeBricksProject({
  formatId, elements, groups, outliner: groups.length ? groups.filter(group => !groups.some(parent => parent.children.includes(group.uid))).map(group => group.uid) : elements.map(node => node.uid)
});
function controllerFor(project, roots, rename = true) {
  const history = [], state = { mode: 'edit', project, selectedUids: new Set(roots.map(node => node.uid)), toolboxRenameDirections: rename };
  const controller = createToolboxController({ state, sceneRenderer: {}, selectedTopLevelNodes: () => roots, isEffectivelyLocked: () => false,
    snapshot: id => history.push({ id, data: JSON.parse(project.serialize()) }), invalidateSelectionRenderGeometry: noop, markDirty: noop, renderAll: noop });
  return { controller, history, state };
}

test('direction words swap simultaneously by axis and preserve identifier casing', () => {
  for (const [name, axis, expected] of [
    ['left_arm', 'x', 'right_arm'], ['RIGHT_Arm', 'x', 'LEFT_Arm'], ['LeftArm', 'x', 'RightArm'],
    ['ARMLeft02', 'x', 'ARMRight02'], ['armRIGHT', 'x', 'armLEFT'], ['left_left_right', 'x', 'right_right_left'],
    ['Up_Down', 'y', 'Down_Up'], ['UP-down_front', 'y', 'DOWN-up_front'],
    ['frontBefore', 'z', 'beforeFront'], ['FRONT_BEFORE', 'z', 'BEFORE_FRONT'],
    ['LeftUpFront', 'x', 'RightUpFront'], ['LeftUpFront', 'y', 'LeftDownFront'], ['LeftUpFront', 'z', 'LeftUpBefore'],
    ['group_1', 'y', 'group_1'], ['Bright_backup_setup', 'x', 'Bright_backup_setup'], ['Bright_backup_setup', 'y', 'Bright_backup_setup']
  ]) assert.equal(flipDirectionalName(name, axis), expected, `${axis}: ${name}`);
});

test('baking strips direction fragments and adjacent separators, while preserving other text', () => {
  for (const [name, expected] of [
    ['left_Right_UP_down_FRONT_before_Arm', 'Arm'], ['LeftArmRight', 'Arm'],
    ['arm_left_right_tip', 'arm_tip'], ['left-arm_right.tip', 'arm_tip'], ['left__right', ''],
    ['Bright_backup_group', 'Bright_backup_group'], ['LEFT_GROUP', 'GROUP']
  ]) assert.equal(stripDirectionalNames(name), expected, name);
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => axisDirectionPrefix({ x: true, y: true, z: true }, index)),
    ['right_up_front', 'right_up_before', 'right_down_front', 'right_down_before', 'left_up_front', 'left_up_before', 'left_down_front', 'left_down_before']);
});

test('flipping two opposite groups exchanges names without false duplicates and is one undo step', () => {
  const left = new Group({ uid: 'left', name: 'LeftArm', children: ['leftCube'] });
  const right = new Group({ uid: 'right', name: 'RightArm', children: ['rightCube'] });
  const project = projectOf([new Cube({ uid: 'leftCube', name: 'LeftArm', unnamed: true }), new Cube({ uid: 'rightCube', name: 'RightArm', unnamed: true })], [left, right]);
  const roots = [project.getNode('left'), project.getNode('right')], { controller, history } = controllerFor(project, roots);
  controller.applyAction('flip', { axis: 'x', base: 'pivot' });
  assert.equal(roots[0].name, 'RightArm'); assert.equal(roots[1].name, 'LeftArm');
  assert.equal(project.getNode('leftCube').name, 'RightArm'); assert.equal(project.getNode('leftCube').unnamed, true);
  assert.equal(history.length, 1); assert.equal(history[0].id, 'core.toolbox.flip');
  const restored = new CubeBricksProject(history[0].data);
  assert.equal(restored.getNode('left').name, 'LeftArm'); assert.equal(restored.getNode('leftCube').name, 'LeftArm');
});

test('group collisions fill project-wide holes without stealing other natural destinations', () => {
  const groups = [new Group({ uid: 'a', name: 'left_part2', children: ['auto', 'explicit'] }),
    new Group({ uid: 'b', name: 'left_part3' }), ...[2, 4, 6].map(number => new Group({ uid: `taken${number}`, name: `right_part${number}` }))];
  const project = projectOf([new Cube({ uid: 'auto', name: 'left_part2', unnamed: true }), new Cube({ uid: 'explicit', name: 'LeftTip' })], groups);
  const { controller } = controllerFor(project, [project.getNode('a'), project.getNode('b')]);
  controller.applyAction('flip', { axis: 'x', base: 'origin' });
  assert.equal(project.getNode('a').name, 'right_part5'); assert.equal(project.getNode('b').name, 'right_part3');
  assert.equal(project.getNode('auto').name, 'right_part5'); assert.equal(project.getNode('explicit').name, 'RightTip');
  assert.equal(new Set(project.groups.map(group => group.name)).size, project.groups.length);
});

test('the flip naming switch leaves names alone, and a rejected geometric edit never renames', () => {
  const project = projectOf([new Cube({ uid: 'cube', name: 'LeftCorner', position: [2, 0, 0], size: [1, 1, 1] })]);
  const cube = project.getNode('cube'), { controller } = controllerFor(project, [cube], false);
  controller.applyAction('flip', { axis: 'x', base: 'origin' });
  assert.equal(cube.name, 'LeftCorner'); assert.equal(cube.position[0], -3);
  const limited = projectOf([new Cube({ uid: 'a', name: 'LeftCorner', position: [0, 0, 0], size: [1, 1, 1] }),
    new Cube({ uid: 'b', position: [29, 0, 0], size: [1, 1, 1] })], [], 'bedrock_block');
  controllerFor(limited, [limited.getNode('a')]).controller.applyAction('flip', { axis: 'x', base: 'origin' });
  assert.equal(limited.getNode('a').position[0], 0); assert.equal(limited.getNode('a').name, 'LeftCorner');
});

test('same-node duplicates do not flip names twice and non-direction names stay intact', () => {
  const cube = new Cube({ uid: 'a', name: 'LeftArm' }), group = new Group({ uid: 'g', name: 'group_1', children: [cube.uid] });
  const project = projectOf([cube], [group]);
  renameFlippedNodes(project, [project.getNode('a'), project.getNode('a'), project.getNode('g')], 'x');
  assert.equal(project.getNode('a').name, 'RightArm'); assert.equal(project.getNode('g').name, 'group_1');
});

for (const strip of [true, false]) test(`XYZ bake names cover groups and descendants, strip existing words = ${strip}`, () => {
  const owner = new Group({ uid: 'arm', name: 'LeftArm', children: ['finger'] });
  const finger = new Group({ uid: 'finger', name: 'RIGHT_Finger', children: ['cube'] });
  const project = projectOf([new Cube({ uid: 'cube', position: [2, 2, 0], size: [1, 1, 1] })], [owner, finger]);
  const modifier = addModifier(project.getNode('arm'), 'symmetry', { uid: 'symmetry', axes: { x: true, y: true, z: false },
    ignoreDuplicateCubes: false, wrapParent: false, stripDirectionalNames: strip });
  const original = project.serialize(), unchanged = JSON.stringify(project), exported = exportBlockbench(project);
  const prefixes = ['right_up', 'right_down', 'left_up', 'left_down'];
  assert.deepEqual(exported.outliner.map(group => group.name), prefixes.map(prefix => `${prefix}_${strip ? 'Arm' : 'LeftArm'}`));
  for (let index = 0; index < prefixes.length; index++) assert.equal(exported.outliner[index].children[0].name,
    `${prefixes[index]}_${strip ? 'Finger' : 'RIGHT_Finger'}`);
  assert.equal(JSON.stringify(project), unchanged, 'export does not rename source data');
  const restored = new CubeBricksProject(JSON.parse(original));
  assert.equal(restored.getNode('arm').modifiers[0].stripDirectionalNames, strip);
  const result = bakeModifier(project, project.getNode('arm'), modifier.uid);
  const bakedRoot = project.getNode(result.rootUid);
  assert.deepEqual(bakedRoot.children.map(uid => project.getNode(uid).name), exported.outliner.map(group => group.name));
  for (let index = 0; index < prefixes.length; index++) assert.equal(project.getNode(project.getNode(bakedRoot.children[index]).children[0]).name,
    exported.outliner[index].children[0].name);
});

test('standalone cubes receive XYZ direction names and old modifiers default to stripping', () => {
  for (const strip of [undefined, false]) {
    const project = projectOf([new Cube({ uid: 'cube', name: 'LeftPiece', position: [2, 0, 0], size: [1, 1, 1] })]);
    const modifier = addModifier(project.getNode('cube'), 'symmetry', { axes: { x: false, y: false, z: true }, ignoreDuplicateCubes: false });
    if (strip === undefined) delete modifier.stripDirectionalNames;
    else modifier.stripDirectionalNames = strip;
    const restored = new CubeBricksProject(JSON.parse(project.serialize()));
    assert.equal(restored.getNode('cube').modifiers[0].stripDirectionalNames, strip !== false);
    const expected = ['front', 'before'].map(prefix => `${prefix}_${strip === false ? 'LeftPiece' : 'Piece'}`);
    assert.deepEqual(exportBlockbench(project).elements.map(cube => cube.name), expected);
    bakeModifier(project, project.getNode('cube'), modifier.uid);
    assert.deepEqual(project.elements.map(cube => cube.name), expected);
    assert.equal(project.groups.length, 0);
  }
});

test('XYZ baking resolves collisions from cleaned names without changing merged-group naming', () => {
  const owner = new Group({ uid: 'g', name: 'left_arm', children: ['cube'] });
  const project = projectOf([new Cube({ uid: 'cube', position: [2, 0, 0], size: [1, 1, 1] })], [owner]);
  const modifier = addModifier(project.getNode('g'), 'symmetry', { ignoreDuplicateCubes: false });
  bakeModifier(project, project.getNode('g'), modifier.uid);
  assert.equal(new Set(project.groups.map(group => group.name)).size, project.groups.length);
  const merged = projectOf([new Cube({ uid: 'cube', position: [-1, 0, -1], size: [2, 2, 2], pivot: [0, 0, 0] })],
    [new Group({ uid: 'g', name: 'LeftCore', children: ['cube'] })]);
  const symmetry = addModifier(merged.getNode('g'), 'symmetry', { ignoreDuplicateCubes: true });
  const baked = bakeModifier(merged, merged.getNode('g'), symmetry.uid);
  assert.equal(baked.mergedRoot, true); assert.equal(merged.getNode(baked.rootUid).name, 'LeftCore');
});

test('radial and mandala naming is independent of the XYZ name-cleanup option', () => {
  for (const mode of ['radial', 'mandala']) {
    const outputs = [true, false].map(strip => {
      const project = projectOf([new Cube({ uid: 'cube', position: [2, 0, 0] })], [new Group({ uid: 'g', name: 'LeftArm', children: ['cube'] })]);
      addModifier(project.getNode('g'), 'symmetry', { mode, copies: 2, wrapParent: false, ignoreDuplicateCubes: false, stripDirectionalNames: strip });
      return exportBlockbench(project).outliner.map(group => group.name);
    });
    assert.deepEqual(outputs[0], outputs[1]); assert.ok(outputs[0].every(name => name.startsWith('LeftArm_')));
  }
});

test('toolbar naming is a persisted preference and does not create a model history entry', () => {
  const oldValue = configRegistry.get(ConfigKey.TOOLBOX_FLIP_NAMES), oldWindow = globalThis.window, oldDocument = globalThis.document;
  const listeners = new Map(), ui = { childElementCount: 0, addEventListener: (name, callback) => listeners.set(name, callback) };
  globalThis.window = { addEventListener: noop }; globalThis.document = { addEventListener: noop };
  try {
    const { controller, state, history } = controllerFor(projectOf(), []);
    const bound = createToolboxController({ state, $: () => ui });
    bound.bind();
    listeners.get('change')({ target: { matches: () => true, checked: false } });
    assert.equal(state.toolboxRenameDirections, false); assert.equal(configRegistry.get(ConfigKey.TOOLBOX_FLIP_NAMES), false);
    assert.equal(history.length, 0); assert.equal(controller.applyAction('flip', { axis: 'x' }), false);
  } finally {
    configRegistry.set(ConfigKey.TOOLBOX_FLIP_NAMES, oldValue);
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});

test('the XYZ inspector option uses the normal undoable modifier field and is hidden for radial modes', () => {
  const project = projectOf([new Cube({ uid: 'a' })]), owner = project.getNode('a');
  const modifier = addModifier(owner, 'symmetry', { uid: 'symmetry' }), listeners = new Map(), history = [];
  const input = { type: 'checkbox', checked: true, dataset: { modifierUid: modifier.uid, modifierField: 'stripDirectionalNames' },
    addEventListener: (type, handler) => listeners.set(type, handler) };
  const panels = createInspectorStackPanels({ state: { project, collapsedModifiers: new Set(), selectedModifierUid: null },
    $: () => null, $$: selector => selector === '[data-modifier-field]' ? [input] : [],
    round: value => value, escapeHtml: String, openIconMarkup: () => '',
    sceneRenderer: { invalidateMirrorGeometry: noop }, snapshot: id => history.push(id), markDirty: noop,
    renderInspector: noop, renderScene: noop, syncInspectorValues: noop });
  assert.match(panels.modifierPanelMarkup(owner), /data-modifier-field="stripDirectionalNames"[^>]*checked/);
  panels.bindStackPanels({}, owner);
  input.checked = false; listeners.get('change')();
  assert.equal(modifier.stripDirectionalNames, false); assert.deepEqual(history, ['modifier.symmetry.change']);
  assert.equal(new CubeBricksProject(JSON.parse(project.serialize())).getNode('a').modifiers[0].stripDirectionalNames, false);
  modifier.mode = 'radial';
  assert.ok(!panels.modifierPanelMarkup(owner).includes('data-modifier-field="stripDirectionalNames"'));
});
