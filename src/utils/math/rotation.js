import { normalize3 } from './vector3.js';

export function rotateVector(vector, rotation) {
  let [x, y, z] = vector;
  const [rx, ry, rz] = rotation.map(value => value * Math.PI / 180);
  let c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

export function inverseRotateVector(vector, rotation) {
  return rotateVector(rotateVector(rotateVector(vector, [0, 0, -rotation[2]]), [0, -rotation[1], 0]), [-rotation[0], 0, 0]);
}

export function quaternionMultiply(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}

export function quaternionFromEuler(rotation) {
  const half = rotation.map(value => value * Math.PI / 360);
  const qx = [Math.sin(half[0]), 0, 0, Math.cos(half[0])];
  const qy = [0, Math.sin(half[1]), 0, Math.cos(half[1])];
  const qz = [0, 0, Math.sin(half[2]), Math.cos(half[2])];
  return quaternionMultiply(quaternionMultiply(qz, qy), qx);
}

export function quaternionFromAxisAngle(axis, degrees) {
  const half = degrees * Math.PI / 360, direction = normalize3(axis);
  return [...direction.map(value => value * Math.sin(half)), Math.cos(half)];
}

export function eulerFromQuaternion(q) {
  const [x, y, z, w] = q;
  const sinY = 2 * (w * y - z * x);
  const rx = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const ry = Math.asin(Math.max(-1, Math.min(1, sinY)));
  const rz = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [rx, ry, rz].map(value => value * 180 / Math.PI);
}
