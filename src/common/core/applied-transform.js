import { eulerFromQuaternion, quaternionFromEuler, quaternionMultiply } from '../../utils/math/rotation.js';

const zero = () => [0, 0, 0];
const copyVector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? [...value] : zero();

export function supportsAppliedTransform(node) {
  return node?.type === 'cube' || node?.type === 'group' || typeof node?.toBaseCubes === 'function';
}

export function transformPosition(node) {
  return node?.type === 'group' ? node.pivot : node?.origin || node?.position || zero();
}

function inverseQuaternion([x, y, z, w]) { return [-x, -y, -z, w]; }

export function displayedTransformVector(node, field) {
  if (!node) return zero();
  if (field === 'transformPosition' || field === 'position' && supportsAppliedTransform(node) || field === 'origin' && supportsAppliedTransform(node)) {
    const current = transformPosition(node);
    const base = copyVector(node.appliedTransform?.position);
    return current.map((value, axis) => value - base[axis]);
  }
  if (field === 'rotation' && supportsAppliedTransform(node)) {
    const base = copyVector(node.appliedTransform?.rotation);
    if (base.every(value => value === 0)) return [...node.rotation];
    return eulerFromQuaternion(quaternionMultiply(inverseQuaternion(quaternionFromEuler(base)), quaternionFromEuler(node.rotation)));
  }
  return Array.isArray(node[field]) ? [...node[field]] : zero();
}

export function actualTransformValue(node, field, displayed) {
  if (!supportsAppliedTransform(node)) return [...displayed];
  if (field === 'rotation') {
    const base = copyVector(node.appliedTransform?.rotation);
    if (base.every(value => value === 0)) return [...displayed];
    return eulerFromQuaternion(quaternionMultiply(quaternionFromEuler(base), quaternionFromEuler(displayed)));
  }
  const base = copyVector(node.appliedTransform?.position);
  return displayed.map((value, axis) => value + base[axis]);
}

export function applyTransform(node, kind) {
  if (!supportsAppliedTransform(node)) return false;
  node.appliedTransform ||= {};
  if (kind === 'position') node.appliedTransform.position = [...transformPosition(node)];
  else if (kind === 'rotation') node.appliedTransform.rotation = [...node.rotation];
  else return false;
  return true;
}

export function restoreTransform(node, kind) {
  if (!supportsAppliedTransform(node) || !node.appliedTransform?.[kind]) return false;
  delete node.appliedTransform[kind];
  if (!Object.keys(node.appliedTransform).length) delete node.appliedTransform;
  return true;
}

export function translateAppliedPositionBaseline(node, delta) {
  if (node?.appliedTransform?.position)
    node.appliedTransform.position = node.appliedTransform.position.map((value, axis) => value + delta[axis]);
}

export function loadAppliedTransform(value) {
  if (!value || typeof value !== 'object') return undefined;
  const result = {};
  if (Array.isArray(value.position) && value.position.length === 3 && value.position.every(Number.isFinite)) result.position = [...value.position];
  if (Array.isArray(value.rotation) && value.rotation.length === 3 && value.rotation.every(Number.isFinite)) result.rotation = [...value.rotation];
  return Object.keys(result).length ? result : undefined;
}
