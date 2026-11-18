import assert from 'node:assert/strict';
import { Cube, Group, CubeBricksProject, addModifier, translateNode, setPivotPreservingGeometry } from '../src/model.js';
import { createTransformTargets } from '../src/editor/transform-targets.js';
import { createMirrorGuideController } from '../src/screen/mirror-guides.js';
import { copyNodeAffine } from '../src/model/modifier-evaluation.js';
import { affinePoint, applyGroupChainPoint } from '../src/model/transform-math.js';

const near = (a, b) => assert.ok(a.every((value, axis) => Math.abs(value - b[axis]) < 1e-8), `${a} != ${b}`);
const cube = new Cube({ uid: 'cube', position: [4, 0, 0], pivot: [5, 1, 1], rotation: [0, 0, 20] });
const sub = new Group({ uid: 'sub', pivot: [3, 0, 0], rotation: [0, 0, 30], children: [cube.uid] });
const root = new Group({ uid: 'root', pivot: [1, 0, 1], rotation: [0, 90, 0], children: [sub.uid] });
for (const [owner, x] of [[cube, 8], [sub, 12], [root, 20]]) {
  const modifier = addModifier(owner, 'element_copy');
  modifier.nodes[0].position = [x, 2, 1];
}
const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [cube], groups: [root, sub], outliner: [root.uid] });
const source = project.getNode(cube.uid), child = project.getNode(sub.uid), parent = project.getNode(root.uid);
const point = owner => owner.modifiers[0].nodes[0];
const original = [source, child, parent].map(owner => [...point(owner).position]);
translateNode(project, parent, [2, 3, 4]);
near(point(source).position, [10, 5, 5]);
near(point(child).position, [14, 5, 5]);
near(point(parent).position, original[2]);
const sourceNodeBeforeOwnMove = [...point(source).position];
translateNode(project, source, [7, 0, 0]);
near(point(source).position, sourceNodeBeforeOwnMove);
const childNodeBeforeOwnMove = [...point(child).position];
translateNode(project, child, [1, 2, 3]);
near(point(child).position, childNodeBeforeOwnMove);
near(point(source).position, [11, 7, 8]);

const state = { project };
const targets = createTransformTargets({ state, subdivisionOwner: () => null, isShapeElement: () => false,
  getTransformPivot: owner => applyGroupChainPoint(owner.pivot, project.getGroupChain(owner.uid)),
  getTransformAxes: () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]] });
const baseline = [...point(source).position];
const captured = targets.captureTransformTarget(parent);
targets.translateCapturedTarget(captured, [4, 0, 0]);
near(point(source).position, baseline.map((value, axis) => value + (axis === 0 ? 4 : 0)));
targets.translateCapturedTarget(captured, [6, 0, 0]);
near(point(source).position, baseline.map((value, axis) => value + (axis === 0 ? 6 : 0)), 'drag deltas do not accumulate');
near(point(parent).position, original[2]);

const guides = createMirrorGuideController({ state, isShapeElement: () => false });
const modifier = source.modifiers[0];
const frame = guides.mirrorControllerWorldFrame(source, { ...modifier, anchor: point(source) });
const chain = project.getGroupChain(source.uid);
near(frame.origin, applyGroupChainPoint(point(source).position, chain));
const sourcePivot = applyGroupChainPoint(source.pivot, chain);
near(affinePoint(copyNodeAffine(project, source, point(source)), sourcePivot), frame.origin);
const beforeOwnerRotation = [...frame.origin];
source.rotation = [50, 20, 75];
const afterOwnerRotation = guides.mirrorControllerWorldFrame(source, { ...modifier, anchor: point(source) });
near(afterOwnerRotation.origin, beforeOwnerRotation);
for (let axis = 0; axis < 3; axis++) near(afterOwnerRotation.axes[axis], frame.axes[axis]);
child.rotation = [15, 20, 30];
near(guides.mirrorControllerWorldFrame(source, { ...modifier, anchor: point(source) }).origin,
  applyGroupChainPoint(point(source).position, project.getGroupChain(source.uid)));
const beforePivotEdit = [source, child, parent].map(owner => applyGroupChainPoint(point(owner).position, project.getGroupChain(owner.uid)));
setPivotPreservingGeometry(project, parent, parent.pivot.map(value => value + 3));
for (const [index, owner] of [source, child, parent].entries())
  near(applyGroupChainPoint(point(owner).position, project.getGroupChain(owner.uid)), beforePivotEdit[index]);
console.log('Copy nodes follow parent-group moves and rotations, stay independent of owner transforms, and agree in preview/evaluation.');
