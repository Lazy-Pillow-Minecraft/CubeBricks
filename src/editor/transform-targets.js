import { applyGroupTransforms } from '../render/webgl-renderer.js';
import { dot3, cross3, normalize3 } from '../utils/math/vector3.js';
import { rotateVector, inverseRotateVector, quaternionMultiply, quaternionFromEuler, quaternionFromAxisAngle, eulerFromQuaternion } from '../utils/math/rotation.js';

export function createTransformTargets({
  state, isShapeElement, subdivisionOwner, getTransformPivot,
  getTransformAxes
}) {
function captureGroupMembers(group) {
  const members = [];
  const visit = uidValue => {
    const node = state.project.getNode(uidValue); if (!node) return;
    if (node.type === 'group') {
      if (node !== group) members.push({ node, position: [...node.pivot], modifierAnchors: captureModifierAnchors(node) });
      node.children.forEach(visit);
    } else if (node.type === 'cube') members.push({ node, position: [...node.position], pivot: [...node.pivot], modifierAnchors: captureModifierAnchors(node) });
    else if (node.position) members.push({ node, position: [...node.position], modifierAnchors: captureModifierAnchors(node) });
    else members.push({ node, position: [...node.origin], pivot: Array.isArray(node.pivot) ? [...node.pivot] : null, modifierAnchors: captureModifierAnchors(node) });
  };
  group.children.forEach(visit);
  for (const member of members) member.appliedPosition = member.node.appliedTransform?.position
    ? [...member.node.appliedTransform.position] : null;
  return members;
}

function cubeLocalPointToWorld(cube, localPoint) {
  const offset = localPoint.map((value, axis) => value - cube.pivot[axis]);
  const rotated = rotateVector(offset, cube.rotation || [0, 0, 0]).map((value, axis) => value + cube.pivot[axis]);
  return applyGroupTransforms(rotated, state.project.getGroupChain(cube.uid));
}


function nodeTransformAnchor(node) {
  if (node.type === 'cube' || node.type === 'group' || isShapeElement(node)) return node.pivot;
  return node.position || node.origin;
}

function captureModifierAnchors(node) {
  return new Map([...(node.modifiers || []), ...(node.operators || [])].flatMap(modifier => Array.isArray(modifier.anchor?.position)
    ? [[modifier.uid, [...modifier.anchor.position]]]
    : []));
}

function translateModifierAnchorsFromSnapshot(node, anchors, delta) {
  for (const modifier of [...(node.modifiers || []), ...(node.operators || [])]) {
    const start = anchors?.get(modifier.uid);
    if (!start || !Array.isArray(modifier.anchor?.position)) continue;
    modifier.anchor.position = start.map((value, axis) => value + delta[axis]);
  }
}

function translateModifierAnchors(node, delta) {
  for (const modifier of [...(node.modifiers || []), ...(node.operators || [])]) {
    if (!Array.isArray(modifier.anchor?.position)) continue;
    modifier.anchor.position = modifier.anchor.position.map((value, axis) => value + delta[axis]);
  }
}

function captureTransformTarget(node) {
  const owner = subdivisionOwner(node);
  const chain = state.project.getGroupChain(owner?.uid || node.uid);
  const rotationChain = owner
    ? [...chain, { pivot: [0, 0, 0], rotation: owner.rotation || [0, 0, 0] }]
    : chain;
  const worldToLocalAxes = [0, 1, 2].map(worldAxis => {
    let local = [0, 1, 2].map(axis => axis === worldAxis ? 1 : 0);
    rotationChain.forEach(group => { local = inverseRotateVector(local, group.rotation || [0, 0, 0]); });
    return local;
  });
  const anchor = [...nodeTransformAnchor(node)];
  return {
    node,
    chain: rotationChain,
    anchor,
    worldAnchor: owner ? getTransformPivot(node) : applyGroupTransforms(anchor, chain),
    worldToLocalAxes,
    transformAxes: getTransformAxes(node).map(axis => [...axis]),
    position: node.position ? [...node.position] : node.origin ? [...node.origin] : node.pivot ? [...node.pivot] : [0, 0, 0],
    pivot: node.pivot ? [...node.pivot] : null,
    rotation: [...(node.rotation || [0, 0, 0])],
    size: node.size ? [...node.size] : null,
    radius: node.parameters?.radius,
    height: node.parameters?.height,
    modifierAnchors: captureModifierAnchors(node),
    groupMembers: node.type === 'group' ? captureGroupMembers(node) : []
  };
}

function translateCapturedTarget(target, delta) {
  const { node } = target;
  translateModifierAnchorsFromSnapshot(node, target.modifierAnchors, delta);
  if (node.type === 'cube') {
    node.position = target.position.map((value, axis) => value + delta[axis]);
    node.pivot = target.pivot.map((value, axis) => value + delta[axis]);
  } else if (node.origin) {
    node.origin = target.position.map((value, axis) => value + delta[axis]);
    if (isShapeElement(node) && target.pivot) node.pivot = target.pivot.map((value, axis) => value + delta[axis]);
  }
  else if (node.position) node.position = target.position.map((value, axis) => value + delta[axis]);
  else if (node.type === 'group') {
    node.pivot = target.position.map((value, axis) => value + delta[axis]);
    target.groupMembers.forEach(member => {
      if (member.appliedPosition)
        member.node.appliedTransform.position = member.appliedPosition.map((value, axis) => value + delta[axis]);
      if (member.node.type === 'cube') {
        member.node.position = member.position.map((value, axis) => value + delta[axis]);
        member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
      } else if (member.node.origin) {
        member.node.origin = member.position.map((value, axis) => value + delta[axis]);
        if (isShapeElement(member.node) && member.pivot) member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
      }
      else if (member.node.position) member.node.position = member.position.map((value, axis) => value + delta[axis]);
      else member.node.pivot = member.position.map((value, axis) => value + delta[axis]);
      translateModifierAnchorsFromSnapshot(member.node, member.modifierAnchors, delta);
    });
  }
}

function localDirectionFromWorld(direction, chain) {
  let local = [...direction];
  chain.forEach(group => { local = inverseRotateVector(local, group.rotation || [0, 0, 0]); });
  return normalize3(local);
}

function localDeltaFromWorld(target, worldDelta) {
  return [0, 1, 2].map(component => worldDelta.reduce((sum, value, worldAxis) =>
    sum + value * target.worldToLocalAxes[worldAxis][component], 0));
}

function rotatePointAroundAxis(point, pivot, axis, degrees) {
  const direction = normalize3(axis);
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const offset = point.map((value, index) => value - pivot[index]);
  const crossed = cross3(direction, offset);
  const aligned = dot3(direction, offset) * (1 - cosine);
  return offset.map((value, index) => pivot[index] + value * cosine + crossed[index] * sine + direction[index] * aligned);
}

function translationMatrix(delta) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    delta[0], delta[1], delta[2], 1
  ];
}

function rotationMatrixAroundAxis(axis, degrees, pivot) {
  const [x, y, z] = normalize3(axis);
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians), turn = 1 - cosine;
  const r00 = turn * x * x + cosine;
  const r01 = turn * x * y - sine * z;
  const r02 = turn * x * z + sine * y;
  const r10 = turn * x * y + sine * z;
  const r11 = turn * y * y + cosine;
  const r12 = turn * y * z - sine * x;
  const r20 = turn * x * z - sine * y;
  const r21 = turn * y * z + sine * x;
  const r22 = turn * z * z + cosine;
  const rotatedPivot = [
    r00 * pivot[0] + r01 * pivot[1] + r02 * pivot[2],
    r10 * pivot[0] + r11 * pivot[1] + r12 * pivot[2],
    r20 * pivot[0] + r21 * pivot[1] + r22 * pivot[2]
  ];
  return [
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    pivot[0] - rotatedPivot[0], pivot[1] - rotatedPivot[1], pivot[2] - rotatedPivot[2], 1
  ];
}

function applyTargetRotation(target, worldAxis, degrees, { separate = false, selfRelative = false, axisIndex = null, euler = false } = {}) {
  const { node } = target;
  if (euler && separate && axisIndex !== null) {
    node.rotation = [...target.rotation];
    node.rotation[axisIndex] = target.rotation[axisIndex] + degrees;
    return;
  }
  const localAxis = selfRelative && axisIndex !== null
    ? [0, 1, 2].map(index => index === axisIndex ? 1 : 0)
    : normalize3(localDeltaFromWorld(target, worldAxis));
  const turn = quaternionFromAxisAngle(localAxis, degrees);
  const current = quaternionFromEuler(target.rotation);
  node.rotation = eulerFromQuaternion(separate && selfRelative
    ? quaternionMultiply(current, turn)
    : quaternionMultiply(turn, current));
}

return {
  captureGroupMembers,
  cubeLocalPointToWorld,
  nodeTransformAnchor,
  captureModifierAnchors,
  translateModifierAnchorsFromSnapshot,
  translateModifierAnchors,
  captureTransformTarget,
  translateCapturedTarget,
  localDirectionFromWorld,
  localDeltaFromWorld,
  rotatePointAroundAxis,
  translationMatrix,
  rotationMatrixAroundAxis,
  applyTargetRotation,
};
}
