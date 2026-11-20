import assert from 'node:assert/strict';
import { Cube, Group, CubeBricksProject } from '../src/model.js';
import { sampleGroup, setAnimationKey, moveAnimationKey, constrainAnimationEnd, normalizeAnimations, ensureAnimationStart, keyedChannel, setGroupAnimationPose, inverseAnimationGroupPoint, animationGroupPoint, animationLocalDirection, animationLocalDelta } from '../src/animation/model.js';
import { AnimationMeshCache } from '../src/animation/mesh-cache.js';
import { buildElementGeometry } from '../src/render/scene-geometry.js';
import { buildFaceBvh } from '../src/render/face-bvh.js';
import { identity } from '../src/render/viewport-math.js';
import { createTransformContext } from '../src/editor/transform-context.js';
import { rotateVector } from '../src/utils/math/rotation.js';

const near = (a, b) => a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < 1e-6, `${a} != ${b}`));
const cube = new Cube({ uid: 'cube', position: [2, 0, 0], size: [2, 2, 2] });
const child = new Group({ uid: 'child', pivot: [2, 0, 0], rotation: [0, 0, 45], children: [cube.uid] });
const parent = new Group({ uid: 'parent', children: [child.uid] });
const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [cube], groups: [parent, child], outliner: [parent.uid] });
const clip = { uid: 'animation', name: 'test', fps: 24, length: 24, loop: 'loop', tracks: {} };
project.animations.push(clip);
setAnimationKey(clip, child.uid, 'position', 10, [2, 4, 6]);
near(sampleGroup(clip, child.uid, 5).position, [1, 2, 3]);
near(sampleGroup(clip, child.uid, 0).scale, [1, 1, 1]);
setAnimationKey(clip, child.uid, 'position', 10, [4, 6, 8]);
assert.equal(clip.tracks[child.uid].position.filter(key => key.frame === 10).length, 1, 'editing the same key replaces it');
for (const [channel, value] of Object.entries({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })) {
  assert.deepEqual(keyedChannel(clip, child.uid, channel, 0), value, 'the first future key creates a full default start');
}
assert.equal(keyedChannel(clip, child.uid, 'position', 5), null, 'interpolated poses are not configured keys');
assert.equal(keyedChannel(clip, child.uid, 'rotation', 10), null, 'unconfigured channels remain absent');
assert.deepEqual(new CubeBricksProject(JSON.parse(project.serialize())).animations, project.animations);

const partialStart = { length: 24, tracks: {} };
setAnimationKey(partialStart, child.uid, 'position', 0, [3, 2, 1]);
setAnimationKey(partialStart, child.uid, 'rotation', 8, [0, 45, 0]);
assert.equal(ensureAnimationStart(partialStart, child.uid), false);
assert.deepEqual(keyedChannel(partialStart, child.uid, 'position', 0), [3, 2, 1], 'existing start values survive');
assert.equal(keyedChannel(partialStart, child.uid, 'scale', 0), null, 'an existing partial start is not completed');
const imported = normalizeAnimations([{ length: 24, tracks: { row: { rotation: [{ frame: 8, value: [0, 45, 0] }] } } }])[0];
assert.deepEqual(keyedChannel(imported, 'row', 'scale', 0), [1, 1, 1], 'loaded rows receive the same explicit default start');
assert.equal(moveAnimationKey(partialStart, child.uid, 0, 4), true);
assert.deepEqual(keyedChannel(partialStart, child.uid, 'position', 0), [0, 0, 0], 'moving the start later restores a rest frame');
assert.deepEqual(keyedChannel(partialStart, child.uid, 'position', 4), [3, 2, 1]);

const retimed = { length: 20, tracks: {} };
setAnimationKey(retimed, child.uid, 'position', 4, [2, 3, 4]);
setAnimationKey(retimed, child.uid, 'rotation', 4, [0, 30, 0]);
setAnimationKey(retimed, child.uid, 'position', 12, [9, 9, 9]);
setAnimationKey(retimed, child.uid, 'scale', 12, [2, 2, 2]);
assert.equal(moveAnimationKey(retimed, child.uid, 4, 12), true);
assert.deepEqual(keyedChannel(retimed, child.uid, 'position', 12), [2, 3, 4], 'retiming replaces a colliding channel');
assert.deepEqual(keyedChannel(retimed, child.uid, 'rotation', 12), [0, 30, 0], 'all keyed channels move together');
assert.deepEqual(keyedChannel(retimed, child.uid, 'scale', 12), [2, 2, 2], 'unrelated destination channels survive');
assert.equal(moveAnimationKey(retimed, child.uid, 12, 31), true);
assert.equal(retimed.length, 31, 'dropping after the end extends playback');
assert.equal(moveAnimationKey(retimed, child.uid, 31, 10), true);
retimed.length = constrainAnimationEnd(retimed, 20);
assert.equal(moveAnimationKey(retimed, child.uid, 10, 50, true), true);
assert.equal(retimed.length, 20);
assert.equal(retimed.tracks[child.uid].position.at(-1).frame, 20, 'Shift drop clamps to the current end');
assert.equal(moveAnimationKey(retimed, child.uid, 20, 20), false, 'an unchanged drop is not an edit');
setAnimationKey(retimed, parent.uid, 'rotation', 45, [0, 30, 0]);
assert.equal(constrainAnimationEnd(retimed, 5), 45, 'end bounds include keys in every group and channel');
assert.equal(constrainAnimationEnd(retimed, 60), 60, 'the end can extend beyond the last key');
assert.equal(normalizeAnimations([{ ...retimed, length: 2 }])[0].length, 45, 'loading repairs an end before existing keys');

// A scaled, rotated parent may shear its child's mesh, but must never shear
// the gizmo. Test the actual frame used by the viewport's handle renderer.
{
  const rig = new CubeBricksProject(JSON.parse(project.serialize()));
  const owner = rig.getNode(child.uid), ancestor = rig.getNode(parent.uid);
  ancestor.rotation = [20, -30, 14];
  setGroupAnimationPose(ancestor, { position: [2, 3, 4], rotation: [25, 30, 50], scale: [1, 1, 1] });
  setGroupAnimationPose(owner, { position: [3, 4, -2], rotation: [15, 35, -20], scale: [1, 1, 1] });
  const state = { project: rig, mode: 'animate', tool: 'move', transformSpace: 'self', rotationMode: 'pose' };
  const context = createTransformContext({ state, subdivisionOwner: () => null, isShapeElement: () => false });
  const baseline = new Map();
  for (const tool of ['move', 'resize', 'rotate', 'pivot']) for (const space of ['self', 'parent', 'global']) {
    state.tool = tool; state.transformSpace = space;
    baseline.set(`${tool}:${space}`, context.getTransformAxes(owner));
  }
  const pivotBefore = context.getTransformPivot(owner);
  const moveBefore = animationLocalDelta(rig, owner, [1, 2, 3]);
  ancestor._animationPose.scale = [5, .2, 3]; owner._animationPose.scale = [8, .1, 4];
  for (const tool of ['move', 'resize', 'rotate', 'pivot']) for (const space of ['self', 'parent', 'global']) {
    state.tool = tool; state.transformSpace = space;
    const axes = context.getTransformAxes(owner);
    axes.forEach((axis, index) => {
      near(axis, baseline.get(`${tool}:${space}`)[index]);
      assert.ok(Math.abs(Math.hypot(...axis) - 1) < 1e-8, 'gizmo axes stay unit length');
      for (let other = index + 1; other < 3; other++) assert.ok(Math.abs(axis.reduce((sum, value, i) => sum + value * axes[other][i], 0)) < 1e-8, 'gizmo axes stay orthogonal');
    });
  }
  assert.notDeepEqual(context.getTransformPivot(owner), pivotBefore, 'the handle position still follows the full matrix');
  assert.notDeepEqual(animationLocalDelta(rig, owner, [1, 2, 3]), moveBefore, 'position edits retain parent scale compensation');
  state.tool = 'move'; state.transformSpace = 'self';
  context.getTransformAxes(owner).forEach((axis, i) => near(animationLocalDirection(rig, owner, axis), rotateVector([0, 1, 2].map(n => n === i ? 1 : 0), owner.rotation.map((angle, n) => angle + owner._animationPose.rotation[n]))));
  state.tool = 'resize';
  owner._animationPose.scale = [-2, 0, 7]; ancestor._animationPose.scale = [-3, .2, 1];
  context.getTransformAxes(owner).forEach((axis, i) => near(axis, baseline.get('resize:self')[i].map(value => i === 0 ? -value : value)));
  state.dragging = { type: 'animation-transform', tool: 'resize', base: new Map([[owner.uid, { scale: [1, 1, 1] }]]) };
  context.getTransformAxes(owner).forEach((axis, i) => near(axis, baseline.get('resize:self')[i]));
  state.dragging = null; state.tool = 'rotate'; state.rotationMode = 'euler';
  const eulerAxes = context.getTransformAxes(owner);
  ancestor._animationPose.scale = [1, 1, 1]; owner._animationPose.scale = [1, 1, 1];
  context.getTransformAxes(owner).forEach((axis, i) => near(axis, eulerAxes[i]));
}

// Bedrock channel values add to rest Euler angles; translation stays in the
// parent frame. A pre-rotated bone must not rotate its position keys again.
{
  const bone = new Group({ pivot: [2, 3, 4], rotation: [20, -30, 45] });
  setGroupAnimationPose(bone, { position: [7, -2, 3], rotation: [-10, 15, 35], scale: [2, 3, .5] });
  const source = [4, 6, 8];
  const expected = rotateVector([4, 9, 2], [10, -15, 80]).map((value, i) => value + [9, 1, 7][i]);
  near(animationGroupPoint(source, bone), expected);
  near(inverseAnimationGroupPoint(expected, bone), source);
  const rig = new CubeBricksProject({ groups: [bone], outliner: [bone.uid] });
  near(animationLocalDelta(rig, rig.getNode(bone.uid), [1, 2, 3]), [1, 2, 3]);
}

const geometryBefore = JSON.stringify({ elements: project.elements, groups: project.groups });
const rest = buildElementGeometry(project, project.elements, null);
rest.faceBvh = buildFaceBvh(rest.faces);
rest.facesByUid = new Map([[cube.uid, rest.faces]]);
let uploads = 0;
const renderer = { staticCache: rest, selectionOutline: [1, 0, 1],
  gl: { STATIC_DRAW: 1, TRIANGLES: 4, LINES: 1, createBuffer: () => ({}), deleteBuffer() {} },
  uploadBuffer() { uploads++; }, drawBuffer() {} };
const cache = new AnimationMeshCache(renderer);
await new Promise(resolve => { cache.onReady = resolve; cache.ensure(project, rest); });
assert.equal(uploads, 2, 'one direct group bakes one triangle buffer and one edge buffer');
for (let frame = 0; frame < 8; frame++) {
  setGroupAnimationPose(project.getNode(parent.uid), { position: [3, 0, 0], scale: [2, 1, .5], rotation: [0, 30, 0] });
  setGroupAnimationPose(project.getNode(child.uid), { position: [0, frame / 4, 0], scale: [1, 2, 1], rotation: [0, 0, 20] });
  cache.draw({ renderMode: 'textured', selectedUids: new Set([parent.uid]) }, identity());
  const expected = buildElementGeometry(project, project.elements, null).ownerPoints.get(cube.uid);
  const actual = cache.vertices(cube.uid).map(entry => entry.point);
  actual.forEach((point, i) => near(point, expected[i]));
  near(inverseAnimationGroupPoint(animationGroupPoint([3, 4, 5], project.getNode(child.uid)), project.getNode(child.uid)), [3, 4, 5]);
}
assert.equal(uploads, 2, 'playback changes matrix uniforms without rebuilding or uploading meshes');
setGroupAnimationPose(project.getNode(parent.uid), { position: [3, 0, 0], scale: [-2, 1, .5], rotation: [0, 30, 0] });
cache.draw({ renderMode: 'textured', selectedUids: new Set() }, identity());
const posed = buildElementGeometry(project, project.elements, null), face = posed.faces[0];
const center = face.quad.reduce((sum, point) => sum.map((value, axis) => value + point[axis] / 4), [0, 0, 0]);
const u = face.quad[2].map((value, axis) => value - face.quad[0][axis]);
const v = face.quad[1].map((value, axis) => value - face.quad[0][axis]);
const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const length = Math.hypot(...normal), direction = normal.map(value => -value / length);
assert.equal(cache.pick({ origin: center.map((value, axis) => value - direction[axis] * 100), direction })?.uid, cube.uid,
  'matrix-scaled and reflected groups remain pickable');
cache.invalidate();
await new Promise(resolve => { cache.onReady = resolve; cache.ensure(project, rest); });
cache.draw({ renderMode: 'textured', selectedUids: new Set() }, identity());
cache.vertices(cube.uid).forEach((entry, index) => near(entry.point, posed.ownerPoints.get(cube.uid)[index]));
assert.equal(renderer.staticCache, rest, 'animation cache rebuilds retain the editor mesh');
assert.equal(JSON.stringify({ elements: project.elements, groups: project.groups }), geometryBefore,
  'animation preserves model transforms, cube dimensions and UVs');
const serialized = project.serialize();
assert.ok(!serialized.includes('_animationPose'), 'preview matrices never enter project files');
project.groups.forEach(group => setGroupAnimationPose(group, null));
console.log('Animation key interpolation, persistence, nested matrix scale and cached group meshes passed.');
