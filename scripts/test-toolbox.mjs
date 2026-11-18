import assert from 'node:assert/strict';
import test from 'node:test';
import { Cube, Shape, BezierElement, Group, CubeBricksProject, addModifier, buildModifierRenderInstances, exportBlockbench, importBlockbench } from '../src/model.js';
import { sourceCubeEntries, sourceWorldVertices } from '../src/model/modifier-evaluation.js';
import { affineAround, affinePoint, matrixIdentity, rotationMatrix } from '../src/model/transform-math.js';
import { boundsOfPoints, captureToolboxSelection, restoreToolboxSelection, scaleToolboxSelection, transformToolboxSelection } from '../src/editor/toolbox/model-transforms.js';
import { createToolboxController } from '../src/editor/toolbox/controller.js';
import { createSnapController } from '../src/editor/snap-controller.js';
import { objectIconAsset, objectAssetMarkup, syncCreationIcons } from '../src/screen/object-icons.js';
import { nodeLocalPoint, createSignedCubeCorners } from '../src/render/scene-geometry.js';
import { createBlockbenchFaceUvSlots, rescaleRotationPoint, rotatePoint, isCubeFaceCulled } from '../src/common/core/geometry-utils.js';
import { JavaBlockVersion, formatRules } from '../src/common/core/format-constraints.js';
import { createSubdivisionController } from '../src/screen/inspector/subdivision.js';
import { planTextureStretchUvs, stretchUvRectangle } from '../src/texture/resize-uv.js';
import { createTransformGeometry } from '../src/editor/transform-geometry.js';

const key = point => point.map(value => Math.round(value * 1e5)).join(',');
const keys = points => points.map(key).sort();
const near = (actual, expected, message = '') => assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) < 1e-5), `${message}: ${actual} vs ${expected}`);
const vertices = (project, nodes = project.elements) => nodes.flatMap(node => node.type === 'group'
  ? vertices(project, project.getDescendantElementUids(node.uid).map(uid => project.getNode(uid)))
  : sourceCubeEntries(project, node).flatMap(sourceWorldVertices));
const clone = value => JSON.parse(JSON.stringify(value));
const noop = () => {};

const faceSlots = { south: [7, 6, 4, 5], north: [2, 3, 1, 0], east: [6, 2, 5, 1], west: [3, 7, 0, 4], up: [3, 2, 7, 6], down: [4, 5, 0, 1] };
function surfaceSignature(cube, transform = null) {
  const points = createSignedCubeCorners(cube.position, cube.size, cube.inflate)
    .map(point => rotatePoint(rescaleRotationPoint(point, cube.pivot, cube.rotation, cube.rescale), cube.pivot, cube.rotation))
    .map(point => transform ? affinePoint(transform, point) : point);
  return Object.entries(faceSlots).flatMap(([name, slots]) => {
    const face = cube.faces[name];
    if (isCubeFaceCulled(face)) return [];
    const uv = createBlockbenchFaceUvSlots(face.uv, face.rotation);
    return slots.map((slot, index) => ({ texture: face.texture, point: points[slot], uv: uv[index] }));
  });
}
function sameSurfaces(actual, expected, message) {
  const close = (left, right) => left.every((value, axis) => Math.abs(value - right[axis]) < 1e-6);
  assert.equal(actual.length, expected.length, message);
  for (const sample of expected) assert.ok(actual.some(other => other.texture === sample.texture
    && close(other.point, sample.point) && close(other.uv, sample.uv)), message);
}

function scene(elements, nested = true) {
  return new CubeBricksProject({ formatId: 'bedrock_entity', elements,
    groups: nested ? [new Group({ uid: 'outer', pivot: [-3, 1, 2], rotation: [8, 14, 17], children: ['inner'] }),
      new Group({ uid: 'inner', pivot: [2, -1, 4], rotation: [13, -22, 28], children: elements.map(node => node.uid) })] : [],
    outliner: nested ? ['outer'] : elements.map(node => node.uid) });
}
const cube = () => new Cube({ uid: 'cube', position: [1, -2, 3], size: [-2, 3, 5], pivot: [-4, 2, 7], rotation: [11, 23, -17],
  uvMode: 'face', faces: Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map((name, i) => [name, { uv: [i, i + 1, i + 3, i + 6], texture: i % 2, rotation: i % 4 * 90 }])) });

for (const grouped of [false, true]) for (const axis of [0, 1, 2]) test(`${grouped ? 'group' : 'cube'}: flip ${'XYZ'[axis]} preserves exact geometry, signed sizes, hierarchy and UVs`, () => {
  const project = scene([cube()]), node = project.getNode(grouped ? 'inner' : 'cube');
  const before = vertices(project), ids = project.elements.map(node => node.uid), hierarchy = clone(project.groups.map(group => group.children));
  const capture = captureToolboxSelection(project, [node]), matrix = matrixIdentity(); matrix[axis][axis] = -1;
  const operation = affineAround(matrix, [3, -5, 2]);
  transformToolboxSelection(project, capture, operation);
  assert.deepEqual(keys(vertices(project)), keys(before.map(point => affinePoint(operation, point))));
  assert.deepEqual(project.elements.map(node => node.uid), ids);
  assert.deepEqual(project.groups.map(group => group.children), hierarchy);
  assert.equal(Math.sign(project.getNode('cube').size[0]), -1);
  const second = captureToolboxSelection(project, [node]);
  transformToolboxSelection(project, second, operation);
  assert.deepEqual(keys(vertices(project)), keys(before), 'flipping twice restores the original vertices');
  assert.deepEqual(project.getNode('cube').faces, cube().faces, 'flipping twice restores every face UV and rotation');
});

for (const kind of ['polygon_prism', 'dodecahedron', 'bezier2d', 'bezier3d']) test(`${kind}: flip stays procedural, survives reload and matches baked bbmodel geometry`, () => {
  const element = kind.startsWith('bezier') ? new BezierElement({ uid: 'shape', origin: [1, 2, 3], rotation: [21, 17, 11],
    nodes: [{ position: [1, 0, 0] }, { position: [2, 0, 8] }, { position: [-3, 0, 12] }] }, kind === 'bezier2d' ? 2 : 3)
    : new Shape({ uid: 'shape', shapeType: kind, origin: [1, 2, 3], pivot: [-1, 0, 2], rotation: [21, 17, 11],
      parameters: { radius: 3, height: 4, sides: 6 } });
  const project = scene([element]), owner = project.getNode('shape');
  const before = vertices(project), parameters = clone(owner.parameters);
  const operation = affineAround([[-1, 0, 0], [0, 1, 0], [0, 0, 1]], [-2, 1, 4]);
  transformToolboxSelection(project, captureToolboxSelection(project, [owner]), operation);
  assert.deepEqual(keys(vertices(project)), keys(before.map(point => affinePoint(operation, point))));
  assert.deepEqual(owner.parameters, parameters);
  assert.equal(owner.geometryMirrorX, true);
  const restored = new CubeBricksProject(JSON.parse(project.serialize()));
  assert.deepEqual(keys(vertices(restored)), keys(vertices(project)), 'CBModel retains reflection metadata');
  const baked = importBlockbench(exportBlockbench(project));
  assert.deepEqual(keys(vertices(baked)), keys(vertices(project)), 'bbmodel bakes the visible result');
  if (owner.nodes) {
    const local = owner.nodes[0].position;
    const expected = [local[0] * -1, local[1], local[2]];
    const unrotated = { ...owner, origin: [0, 0, 0], rotation: [0, 0, 0] };
    near(nodeLocalPoint(unrotated, local), expected, 'curve node markers follow the reflected geometry');
  }
});

test('no-snap uniform scaling scales a rotated hierarchy from its immutable baseline', () => {
  const project = scene([cube()]);
  const capture = captureToolboxSelection(project, [project.getNode('outer')]);
  const before = vertices(project), center = capture.bounds.center;
  for (const factor of [1.35, .65, 1.125, 1]) {
    scaleToolboxSelection(project, capture, factor, { snap: 'none' });
    const expected = before.map(point => point.map((value, axis) => center[axis] + (value - center[axis]) * factor));
    assert.deepEqual(keys(vertices(project)), keys(expected), 'drag updates never accumulate rounding errors');
  }
});

for (const curved of [false, true]) test(`${curved ? 'curve' : 'shape'}: subdivision geometry and UV edits round-trip after a toolbox flip`, () => {
  const element = curved ? new BezierElement({ uid: 'owner', nodes: [{ position: [0, 0, 0] }, { position: [3, 0, 8] }] }, 3)
    : new Shape({ uid: 'owner', shapeType: 'polygon_prism', parameters: { sides: 5, radius: 4, height: 3 } });
  const project = scene([element], false), owner = project.getNode('owner');
  transformToolboxSelection(project, captureToolboxSelection(project, [owner]), affineAround([[-1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]));
  const subdivision = createSubdivisionController({ state: { project } });
  const edited = owner.toCubes(project)[0];
  assert.equal(subdivision.subdivisionPatch(owner, edited, 0), null, 'opening a mirrored cube creates no phantom edit');
  edited.position[0] += .375;
  edited.rotation[2] += 15;
  edited.uvMode = 'face';
  edited.autoUv = false;
  edited.faces = Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map((name, index) =>
    [name, { texture: 'asset', uv: [index, 2, index + 3, 6], rotation: index % 4 * 90 }]));
  owner.subdivisionEdits = { 0: subdivision.subdivisionPatch(owner, edited, 0) };
  const restored = owner.toCubes(project)[0];
  for (const field of ['position', 'size', 'pivot', 'rotation']) near(restored[field], edited[field], field);
  assert.deepEqual(restored.faces, edited.faces, 'mirrored face direction and UV orientation are retained');
  const texture = { _uid: 'asset' }, before = { pixels: [16, 16], uv: [16, 16] }, after = { pixels: [32, 16], uv: [32, 16] };
  const resize = planTextureStretchUvs(project, texture, [texture], before, after);
  resize.apply();
  const stretched = owner.toCubes(project)[0];
  for (const [name, face] of Object.entries(restored.faces)) assert.deepEqual(stretched.faces[name].uv,
    stretchUvRectangle(face.uv, before, after), `${name} stays on the same displayed face after texture stretch`);
  if (curved) {
    const beforePivotMove = keys(vertices(project));
    const geometry = createTransformGeometry({ state: { project }, isShapeElement: item => item.type === 'shape',
      isBezierElement: item => item.type.startsWith('bezier') });
    geometry.setNodePivotAtWorldPoint(owner, [2, 3, 4]);
    assert.deepEqual(keys(vertices(project)), beforePivotMove, 'centering a reflected curve pivot keeps its geometry in place');
  }
  const capture = captureToolboxSelection(project, [owner]);
  scaleToolboxSelection(project, capture, 2, { snap: 'none' });
  for (const field of ['positionDelta', 'sizeDelta', 'pivotDelta']) if (capture.entries[0].data.subdivisionEdits[0][field])
    near(owner.subdivisionEdits[0][field], capture.entries[0].data.subdivisionEdits[0][field].map(value => value * 2), field);
});

test('envelope snapping rounds XYZ independently and per-element snapping does not force a common ratio', () => {
  const first = new Cube({ uid: 'a', position: [0, 0, 0], size: [2, 3, 5] });
  const second = new Cube({ uid: 'b', position: [6, 2, -1], size: [1.5, 2.5, 3.5] });
  const project = scene([first, second], false), capture = captureToolboxSelection(project, project.elements);
  scaleToolboxSelection(project, capture, 1.3, { snap: 'bounds', step: 1 });
  near(boundsOfPoints(vertices(project)).size, capture.bounds.size.map(value => Math.round(value * 1.3)), 'overall envelope dimensions snap separately');
  restoreToolboxSelection(capture);
  scaleToolboxSelection(project, capture, 1.3, { snap: 'elements', step: 1 });
  near(project.getNode('a').size, [3, 4, 7]);
  near(project.getNode('b').size, [2, 3, 5]);
  assert.notEqual(project.getNode('a').size[0] / 2, project.getNode('a').size[1] / 3);
});

test('rotated cube envelope snapping retains rotation and lands all feasible projected dimensions on the grid', () => {
  const project = scene([new Cube({ uid: 'cube', size: [4, 6, 8], rotation: [7, 13, 19] })], false);
  const capture = captureToolboxSelection(project, project.elements);
  scaleToolboxSelection(project, capture, 1.3, { snap: 'bounds', step: .25 });
  near(project.elements[0].rotation, [7, 13, 19]);
  near(boundsOfPoints(vertices(project)).size, capture.bounds.size.map(value => Math.round(value * 1.3 / .25) * .25));
});

test('Shift, Ctrl and Ctrl+Shift use the existing project snap precision in every size mode', () => {
  const state = { project: scene([new Cube({ uid: 'cube', size: [2, 3, 5] })], false), settingsSnap: 16,
    modifierSnap: { shift: { mode: 'multiplier', value: 2 }, ctrl: { mode: 'multiplier', value: 4 }, shiftCtrl: { mode: 'multiplier', value: 8 } } };
  state.project.snap = { subdivisions: 16 };
  const snap = createSnapController({ state });
  for (const [event, step] of [[{}, 1], [{ shiftKey: true }, .5], [{ ctrlKey: true }, .25], [{ shiftKey: true, ctrlKey: true }, .125]]) {
    assert.equal(snap.getSnapStep(event), step);
    const capture = captureToolboxSelection(state.project, state.project.elements);
    for (const mode of ['bounds', 'elements']) {
      scaleToolboxSelection(state.project, capture, 1.137, { snap: mode, step: snap.getSnapStep(event) });
      const lengths = mode === 'elements' ? state.project.elements[0].size : boundsOfPoints(vertices(state.project)).size;
      near(lengths.map(value => value / step), lengths.map(value => Math.round(value / step)));
      restoreToolboxSelection(capture);
    }
  }
});

test('toolbox button actions are one undoable source edit, and geometry/pivot centering are distinct', () => {
  const project = scene([new Cube({ uid: 'cube', position: [4, 2, 6], size: [2, 4, 6], pivot: [9, -1, 3] })], false);
  const node = project.elements[0], state = { project, mode: 'edit', selectedUid: node.uid, selectedUids: new Set([node.uid]),
    toolboxCenterBase: 'geometry' };
  const history = [];
  const controller = createToolboxController({ state, sceneRenderer: {}, selectedTopLevelNodes: () => [node], isEffectivelyLocked: () => false,
    snapshot: id => history.push({ id, data: JSON.parse(project.serialize()) }), invalidateSelectionRenderGeometry: noop, markDirty: noop, renderAll: noop });
  const before = vertices(project);
  controller.applyAction('rotate', { axis: 'y', angle: 90 });
  assert.equal(history.at(-1).id, 'core.toolbox.rotate');
  const turn = affineAround(rotationMatrix([0, 90, 0]), [9, -1, 3]);
  assert.deepEqual(keys(vertices(project)), keys(before.map(point => affinePoint(turn, point))));
  assert.deepEqual(keys(vertices(new CubeBricksProject(history.at(-1).data))), keys(before), 'recorded undo restores the complete original source');
  controller.applyAction('center', { axis: 'all' });
  near(boundsOfPoints(vertices(project)).center, [0, 0, 0]);
  state.toolboxCenterBase = 'pivot';
  controller.applyAction('center', { axis: 'x' });
  near([node.pivot[0]], [0]);
  state.mode = 'paint';
  assert.equal(controller.applyAction('flip', { axis: 'x', base: 'origin' }), false);
});

for (const version of Object.values(JavaBlockVersion)) test(`${version}: all twelve quarter turns preserve Java cube surfaces at existing angles`, () => {
  const angles = version === JavaBlockVersion.LEGACY ? [-45, -22.5, 0, 22.5, 45] : [-137.3, -44.75, -17.3, 0, 19.125, 37.875, 78.125];
  const rotations = [0, 1, 2].flatMap(axis => angles.map(angle => [0, 0, 0].map((_, index) => index === axis ? angle : 0)));
  if (version === JavaBlockVersion.UNRESTRICTED) rotations.push([17, 28, -39], [-75, 26.5, 143]);
  for (const rotation of rotations) for (const rescale of [false, true]) for (const negative of [false, true])
    for (const base of ['origin', 'pivot']) for (const axis of ['x', 'y', 'z']) for (const angle of [-90, 90]) {
      const original = cube();
      original.position = [2, 3, 4]; original.size = [negative ? -2 : 2, 3, 5]; original.pivot = [5, 6, 7];
      original.rotation = rotation; original.rescale = rescale; original.inflate = .15;
      for (const [name, face] of Object.entries(original.faces)) face.texture = name;
      original.faces.south = null;
      const project = new CubeBricksProject({ formatId: 'java_block_item', formatData: { javaBlockVersion: version, javaBlockBoundsEnabled: false },
        elements: [original], outliner: [original.uid] });
      const node = project.getNode(original.uid), old = structuredClone(node), history = [];
      sameSurfaces(surfaceSignature(sourceCubeEntries(project, node)[0].cube), surfaceSignature(old), 'render adaptation preserves the starting cube');
      const controller = createToolboxController({ state: { project, mode: 'edit', selectedUids: new Set([node.uid]) },
        sceneRenderer: {}, selectedTopLevelNodes: () => [node], isEffectivelyLocked: () => false,
        snapshot: id => history.push({ id, data: JSON.parse(project.serialize()) }), markDirty: noop, renderAll: noop, invalidateSelectionRenderGeometry: noop });
      const turn = affineAround(rotationMatrix([0, 0, 0].map((_, index) => 'xyz'[index] === axis ? angle : 0)), base === 'origin' ? [0, 0, 0] : old.pivot);
      controller.applyAction('rotate', { base, axis, angle });
      const label = `${rotation}, rescale ${rescale}, negative ${negative}, ${base}/${axis}/${angle}`;
      sameSurfaces(surfaceSignature(node), surfaceSignature(old, turn), label);
      sameSurfaces(surfaceSignature(sourceCubeEntries(project, node)[0].cube), surfaceSignature(old, turn), `render: ${label}`);
      assert.equal(node.uid, old.uid);
      assert.equal(history.length, 1);
      sameSurfaces(surfaceSignature(new CubeBricksProject(history[0].data).getNode(node.uid)), surfaceSignature(old), `undo: ${label}`);
      const rules = formatRules(project);
      if (rules.singleAxisRotation) assert.ok(node.rotation.filter(value => Math.abs(value) > 1e-6).length <= 1, label);
      if (rules.rotationStep) for (const value of node.rotation) assert.ok(Math.abs(value / 22.5 - Math.round(value / 22.5)) < 1e-7, label);
    }
});

test('creation menus and hierarchy icons share all built-in assets, including envelope curves', () => {
  assert.equal(objectIconAsset('bezier3d', 'envelope'), objectIconAsset('bezier3d-envelope'));
  for (const type of ['cube', 'polygon_prism', 'dodecahedron', 'truncated_icosahedron', 'bezier2d', 'bezier3d', 'bezier2d-envelope', 'bezier3d-envelope']) {
    let css;
    syncCreationIcons({ querySelectorAll: () => [{ dataset: { createShape: type }, style: { setProperty: (_key, value) => { css = value; } } }] });
    assert.ok(objectAssetMarkup(type).includes(css));
  }
});

test('group transforms carry nested symmetry frames and sibling copy nodes without changing the stack', () => {
  const project = scene([cube()]), owner = project.getNode('cube');
  const copy = addModifier(owner, 'element_copy', {}, project);
  copy.nodes[0].position = [12, 3, -4];
  copy.nodes[0].rotation = [17, -10, 5];
  addModifier(project.getNode('inner'), 'symmetry', { axes: { x: true, y: false, z: false },
    ignoreDuplicateCubes: false, anchor: { position: [2, 3, 5], rotation: [7, 11, 9] } }, project);
  const renderPoints = () => {
    const source = vertices(project);
    return [...source, ...buildModifierRenderInstances(project).flatMap(instance => source.map(point => instance.matrix.map((row, axis) =>
      row.reduce((sum, value, index) => sum + value * point[index], instance.translation[axis]))))];
  };
  const before = renderPoints();
  const flip = affineAround([[-1, 0, 0], [0, 1, 0], [0, 0, 1]], [-1, 2, 3]);
  transformToolboxSelection(project, captureToolboxSelection(project, [project.getNode('outer')]), flip);
  assert.deepEqual(keys(renderPoints()), keys(before.map(point => affinePoint(flip, point))));
  const capture = captureToolboxSelection(project, [project.getNode('outer')]), old = renderPoints();
  scaleToolboxSelection(project, capture, 1.5, { snap: 'none' });
  assert.deepEqual(keys(renderPoints()), keys(old.map(point => point.map((value, axis) => capture.bounds.center[axis] + (value - capture.bounds.center[axis]) * 1.5))));
  assert.equal(owner.modifiers[0].uid, copy.uid);
});

test('scale dragging has live modifier-key snapping, opposite vertical directions and one undo record', () => {
  const savedGlobals = { window: globalThis.window, document: globalThis.document,
    raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  const listeners = new Map();
  globalThis.window = { addEventListener: (type, handler) => listeners.set(type, handler) };
  globalThis.document = { addEventListener: noop };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = noop;
  try {
    const project = scene([new Cube({ uid: 'cube', size: [2, 3, 5] })], false), node = project.elements[0];
    const state = { project, mode: 'edit', tool: 'toolbox', toolboxCategory: 'scale', toolboxSnap: 'bounds',
      selectedUid: node.uid, selectedUids: new Set([node.uid]), settingsSnap: 16,
      modifierSnap: { shift: { mode: 'multiplier', value: 2 }, ctrl: { mode: 'multiplier', value: 4 }, shiftCtrl: { mode: 'multiplier', value: 8 } } };
    project.snap = { subdivisions: 16 };
    const ui = { style: {}, childElementCount: 0, addEventListener: noop, querySelectorAll: () => [],
      contains: () => false, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    const history = [];
    const controller = createToolboxController({ state, $: () => ui, sceneRenderer: { beginTransformGhost: noop, endTransformGhost: noop },
      selectedTopLevelNodes: () => [node], isEffectivelyLocked: () => false, getSnapStep: createSnapController({ state }).getSnapStep,
      snapshot: id => history.push({ id, before: JSON.parse(project.serialize()) }), markDirty: noop, renderAll: noop,
      renderScene: noop, invalidateSelectionRenderGeometry: noop, discardSubdivisionEdits: noop });
    controller.bind();
    const target = { setPointerCapture: noop, hasPointerCapture: () => false };
    controller.startScale({ button: 0, pointerId: 1, clientX: 100, clientY: 100 }, target);
    const y = 100 - Math.log(1.137) * 160;
    controller.moveScale({ pointerId: 1, clientX: 100, clientY: y }); controller.flushScale();
    near(node.size, [2, 3, 6]);
    listeners.get('keydown')({ key: 'Shift', shiftKey: true, ctrlKey: false }); controller.flushScale();
    near(node.size, [2.5, 3.5, 5.5]);
    listeners.get('keydown')({ key: 'Control', shiftKey: true, ctrlKey: true }); controller.flushScale();
    near(node.size, [2.25, 3.375, 5.625]);
    controller.moveScale({ pointerId: 1, clientX: 100, clientY: 130, shiftKey: true, ctrlKey: true }); controller.flushScale();
    assert.ok(node.size.every((value, axis) => value < [2, 3, 5][axis]), 'dragging down shrinks all dimensions');
    controller.finishScale({ type: 'pointerup', pointerId: 1 });
    assert.equal(state.dragging, null);
    assert.equal(history.length, 1);
    assert.equal(history[0].id, 'core.toolbox.scale');
    near(new CubeBricksProject(history[0].before).elements[0].size, [2, 3, 5]);
  } finally {
    globalThis.window = savedGlobals.window; globalThis.document = savedGlobals.document;
    globalThis.requestAnimationFrame = savedGlobals.raf; globalThis.cancelAnimationFrame = savedGlobals.cancel;
  }
});
