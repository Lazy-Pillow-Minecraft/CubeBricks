// Row-major 3D transforms shared by model editing, modifier evaluation and baking.

export function rotateVector(vector, rotation) {
  let [x, y, z] = vector;
  const [rx, ry, rz] = rotation.map(value => value * Math.PI / 180);
  let c = Math.cos(rx), s = Math.sin(rx);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry);
  s = Math.sin(ry);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz);
  s = Math.sin(rz);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

export function inverseRotateVector(vector, rotation) {
  return rotateVector(rotateVector(rotateVector(vector, [0, 0, -rotation[2]]), [0, -rotation[1], 0]), [-rotation[0], 0, 0]);
}

export function matrixIdentity() { return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; }

export function matrixMultiply(left, right) {
  return [0, 1, 2].map(row => [0, 1, 2].map(column =>
    left[row][0] * right[0][column] + left[row][1] * right[1][column] + left[row][2] * right[2][column]));
}

export function matrixTranspose(matrix) { return [0, 1, 2].map(row => [0, 1, 2].map(column => matrix[column][row])); }

export function matrixVector(matrix, vector) {
  return matrix.map(row => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]);
}

export function matrixDeterminant(matrix) {
  return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
}

export function rotationMatrix(rotation = [0, 0, 0]) {
  const columns = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(axis => rotateVector(axis, rotation));
  return [0, 1, 2].map(row => columns.map(column => column[row]));
}

export function matrixEuler(matrix) {
  const y = Math.asin(Math.max(-1, Math.min(1, -matrix[2][0])));
  const cosine = Math.cos(y);
  const x = Math.abs(cosine) > 1e-7 ? Math.atan2(matrix[2][1], matrix[2][2]) : 0;
  const z = Math.abs(cosine) > 1e-7 ? Math.atan2(matrix[1][0], matrix[0][0]) : Math.atan2(-matrix[0][1], matrix[1][1]);
  return [x, y, z].map(value => Math.round(value * 180 / Math.PI * 1e8) / 1e8);
}

export function transformAround(point, center, matrix) {
  const offset = point.map((value, axis) => value - center[axis]);
  const rotated = matrixVector(matrix, offset);
  return rotated.map((value, axis) => value + center[axis]);
}

export function applyGroupChainPoint(point, chain) {
  let transformed = [...point];
  for (const group of [...chain].reverse()) transformed = transformAround(transformed, group.pivot, rotationMatrix(group.rotation));
  return transformed;
}

export function groupChainMatrix(chain) {
  return chain.reduce((matrix, group) => matrixMultiply(matrix, rotationMatrix(group.rotation)), matrixIdentity());
}

export function matrixIsIdentity(matrix, epsilon = 1e-6) {
  const identity = matrixIdentity();
  return matrix.every((row, rowIndex) => row.every((value, columnIndex) =>
    Math.abs(value - identity[rowIndex][columnIndex]) <= epsilon));
}

export function affineIdentity() {
  return { matrix: matrixIdentity(), translation: [0, 0, 0] };
}

export function affineAround(matrix, center) {
  const transformedCenter = matrixVector(matrix, center);
  return {
    matrix,
    translation: center.map((value, axis) => value - transformedCenter[axis])
  };
}

// Compose two world-space transforms in evaluation order: `before` is
// already applied to the geometry, then `after` consumes that result.
export function affineCompose(after, before) {
  return {
    matrix: matrixMultiply(after.matrix, before.matrix),
    translation: matrixVector(after.matrix, before.translation)
      .map((value, axis) => value + after.translation[axis])
  };
}

export function affineInverse(affine) {
  const matrix = matrixTranspose(affine.matrix);
  const moved = matrixVector(matrix, affine.translation);
  return { matrix, translation: moved.map(value => -value) };
}

export function affinePoint(affine, point) {
  return matrixVector(affine.matrix, point).map((value, axis) => value + affine.translation[axis]);
}

export function affineIsIdentity(affine, epsilon = 1e-6) {
  return matrixIsIdentity(affine.matrix, epsilon)
    && affine.translation.every(value => Math.abs(value) <= epsilon);
}

export function affineKey(affine) {
  const clean = value => Math.abs(value) < 1e-9 ? 0 : Math.round(value * 1e9) / 1e9;
  return JSON.stringify([...affine.matrix.flat(), ...affine.translation].map(clean));
}

export function inverseGroupChainPoint(point, chain) {
  let transformed = [...point];
  for (const group of chain) transformed = transformAround(transformed, group.pivot, matrixTranspose(rotationMatrix(group.rotation || [0, 0, 0])));
  return transformed;
}
