import { eulerFromQuaternion, quaternionFromEuler, quaternionFromAxisAngle, quaternionMultiply } from '../utils/math/rotation.js';

const near = (values, reference) => values.map((value, axis) => value + 360 * Math.round((reference[axis] - value) / 360));
export function nearestAnimationEuler(quaternion, reference) {
  const euler = eulerFromQuaternion(quaternion);
  const candidates = [euler, [euler[0] + 180, 180 - euler[1], euler[2] + 180]];
  if (Math.abs(Math.abs(euler[1]) - 90) < 1e-6)
    candidates.push([reference[0], euler[1], euler[2] + Math.sign(euler[1]) * reference[0]]);
  return candidates.map(candidate => near(candidate, reference)).sort((a, b) =>
    a.reduce((sum, value, axis) => sum + (value - reference[axis]) ** 2, 0)
    - b.reduce((sum, value, axis) => sum + (value - reference[axis]) ** 2, 0))[0];
}

export function rotateAnimationEuler(rotation, axis, angle) {
  const base = quaternionFromEuler(rotation), steps = Math.max(1, Math.min(8192, Math.ceil(Math.abs(angle) / 45)));
  let result = [...rotation];
  for (let step = 1; step <= steps; step++) result = nearestAnimationEuler(
    quaternionMultiply(quaternionFromAxisAngle(axis, angle * step / steps), base), result);
  return result;
}
