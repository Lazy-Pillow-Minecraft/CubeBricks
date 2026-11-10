import { rotateVector, quaternionFromEuler, quaternionMultiply, eulerFromQuaternion } from './rotation.js';
import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv, rescaleRotationPoint } from '../../common/core/geometry-utils.js';

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const CORNERS = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const FACES = { south: [7, 6, 4, 5], north: [2, 3, 1, 0], east: [6, 2, 5, 1], west: [3, 7, 0, 4], up: [3, 2, 7, 6], down: [4, 5, 0, 1] };
const NORMALS = { south: [0, 0, 1], north: [0, 0, -1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const multiply = (a, b) => a.map(row => [0, 1, 2].map(column => row.reduce((sum, value, axis) => sum + value * b[axis][column], 0)));
const transpose = matrix => matrix[0].map((_, axis) => matrix.map(row => row[axis]));
const transform = (matrix, vector) => matrix.map(row => row.reduce((sum, value, axis) => sum + value * vector[axis], 0));
const rotationMatrix = rotation => transpose(IDENTITY.map(axis => rotateVector(axis, rotation)));
const equal = (a, b) => a.every((value, axis) => Math.abs(value - b[axis]) < 1e-7);
const clean = value => Math.abs(value) < 1e-8 ? 0 : value;
const rotations = [IDENTITY], visited = new Set([IDENTITY.flat().join(',')]);
for (let index = 0; index < rotations.length; index++) for (const axis of [0, 1, 2]) {
  const turn = rotationMatrix([0, 0, 0].map((_, slot) => slot === axis ? 90 : 0)).map(row => row.map(Math.round));
  const matrix = multiply(turn, rotations[index]), key = matrix.flat().join(',');
  if (!visited.has(key)) { visited.add(key); rotations.push(matrix); }
}

function decompose(rotation, step, weights = [1, 1, 1]) {
  const target = rotationMatrix(rotation);
  let best = null;
  for (const quarter of rotations) {
    for (let axis = 0; axis < 3; axis++) {
      const a = (axis + 1) % 3, b = (axis + 2) % 3;
      const sine = weights.reduce((sum, weight, column) => sum + weight
        * (quarter[a][column] * target[b][column] - quarter[b][column] * target[a][column]), 0);
      const cosine = weights.reduce((sum, weight, column) => sum + weight
        * (quarter[a][column] * target[a][column] + quarter[b][column] * target[b][column]), 0);
      let angle = Math.atan2(sine, cosine) * 180 / Math.PI;
      if (step) angle = Math.round(angle / step) * step;
      if (Math.abs(angle) > 45 + 1e-7) continue;
      const residual = [0, 0, 0]; residual[axis] = clean(angle);
      const actual = multiply(rotationMatrix(residual), quarter);
      const score = actual.reduce((sum, row, i) => sum + row.reduce((total, value, j) => total + value * target[i][j], 0), 0);
      const fitScore = actual.reduce((sum, row, i) => sum + row.reduce((total, value, j) => total + weights[j] * value * target[i][j], 0), 0);
      if (!best || fitScore > best.fitScore + 1e-9 || Math.abs(fitScore - best.fitScore) < 1e-9 && Math.abs(angle) < Math.abs(best.angle) - 1e-7)
        best = { quarter, rotation: residual, angle, score, fitScore };
    }
  }
  return best;
}

function remapFaces(cube, cornerMap, quarter) {
  const result = {};
  for (const [name, slots] of Object.entries(FACES)) {
    const mapped = slots.map(slot => cornerMap[slot]);
    const [targetName, targetSlots] = Object.entries(FACES).find(([, indices]) => mapped.every(slot => indices.includes(slot)));
    const source = cube.faces?.[name];
    if (source === null) { result[targetName] = null; continue; }
    const rect = cube.uvMode === 'box' ? getBlockbenchBoxUv(cube, name) : source?.uv || getBlockbenchBoxUv(cube, name);
    const uv = createBlockbenchFaceUvSlots(rect, source?.rotation || 0);
    const desired = targetSlots.map(slot => uv[mapped.indexOf(slot)]);
    let replacement;
    for (const rectangle of [[...rect], [rect[2], rect[1], rect[0], rect[3]]]) for (const rotation of [0, 90, 180, 270]) {
      if (createBlockbenchFaceUvSlots(rectangle, rotation).every((point, slot) => equal(point, desired[slot]))) {
        replacement ||= { uv: rectangle, rotation };
      }
    }
    if (!replacement) throw Error('Quarter-turn UV mapping failed');
    result[targetName] = { ...structuredClone(source || {}), ...replacement };
    if (NORMALS[source?.cullface]) {
      const normal = transform(quarter, NORMALS[source.cullface]);
      result[targetName].cullface = Object.keys(NORMALS).find(direction => equal(NORMALS[direction], normal));
    }
  }
  return result;
}

function rebaseAttachedFrames(cube, quarter, pivot) {
  const y = Math.asin(Math.max(-1, Math.min(1, -quarter[2][0])));
  const x = Math.abs(Math.cos(y)) > 1e-7 ? Math.atan2(quarter[2][1], quarter[2][2]) : 0;
  const z = Math.abs(Math.cos(y)) > 1e-7 ? Math.atan2(quarter[1][0], quarter[0][0]) : Math.atan2(-quarter[0][1], quarter[1][1]);
  const q = quaternionFromEuler([x, y, z].map(value => value * 180 / Math.PI));
  const inverse = q.map((value, axis) => axis < 3 ? -value : value);
  if (cube.appliedTransform?.rotation) cube.appliedTransform.rotation = eulerFromQuaternion(
    quaternionMultiply(quaternionFromEuler(cube.appliedTransform.rotation), inverse));
  for (const entry of [...(cube.modifiers || []), ...(cube.operators || [])]) {
    if (entry.type === 'element_copy') {
      for (const node of entry.nodes || []) node.rotation = eulerFromQuaternion(quaternionMultiply(quaternionFromEuler(node.rotation || [0, 0, 0]), inverse));
    } else if (entry.anchor) {
      entry.anchor.position = transform(quarter, (entry.anchor.position || pivot).map((value, axis) => value - pivot[axis]))
        .map((value, axis) => value + pivot[axis]);
      entry.anchor.rotation = eulerFromQuaternion(quaternionMultiply(q, quaternionFromEuler(entry.anchor.rotation || [0, 0, 0])));
    }
  }
}

// R = residual * quarter: only the proper, integer orthogonal part is baked
// into geometry. Face corner correspondence preserves UV rotation and mirrors.
export function foldJavaCubeRotation(cube, { rotationStep = null, strict = false, onQuarterTurn = null, rotationWeights = null } = {}) {
  const rotation = (cube.rotation || [0, 0, 0]).map(value => Number(value) || 0);
  if (rotation.filter(value => Math.abs(value) > 1e-7).length <= 1 && rotation.every(value => Math.abs(value) <= 45 + 1e-7)) {
    if (strict && rotationStep && rotation.some(value => Math.abs(value / rotationStep - Math.round(value / rotationStep)) > 1e-6)) return false;
    cube.rotation = rotation.map(value => clean(rotationStep ? Math.round(value / rotationStep) * rotationStep : value));
    return true;
  }
  const result = decompose(rotation, rotationStep, strict ? undefined : rotationWeights || undefined);
  if (!result || strict && result.score < 3 - 1e-8) return false;
  const { quarter } = result;
  onQuarterTurn?.(quarter);
  const axes = quarter.map(row => row.findIndex(value => value !== 0));
  const cornerMap = CORNERS.map(bits => CORNERS.findIndex(candidate => equal(candidate,
    axes.map((source, axis) => quarter[axis][source] < 0 ? 1 - bits[source] : bits[source]))));
  const faces = remapFaces(cube, cornerMap, quarter), pivot = cube.pivot || [0, 0, 0];
  rebaseAttachedFrames(cube, quarter, pivot);
  const signs = cube.size.map(value => value < 0 ? -1 : 1);
  const bakedInflate = cube.rescale ? Number(cube.inflate) || 0 : 0;
  const from = cube.position.map((value, axis) => value - signs[axis] * bakedInflate);
  const to = cube.position.map((value, axis) => value + cube.size[axis] + signs[axis] * bakedInflate);
  const point = vector => transform(quarter, rescaleRotationPoint(vector, pivot, rotation, cube.rescale)
    .map((value, axis) => value - pivot[axis])).map((value, axis) => value + pivot[axis]);
  const start = point(from), end = point(to);
  const previousPosition = cube.position;
  cube.position = start.map((value, axis) => clean(signs[axes[axis]] < 0 ? Math.max(value, end[axis]) : Math.min(value, end[axis])));
  if (cube.appliedTransform?.position) cube.appliedTransform.position = cube.appliedTransform.position
    .map((value, axis) => value + cube.position[axis] - previousPosition[axis]);
  cube.size = start.map((value, axis) => clean(signs[axes[axis]] * Math.abs(end[axis] - value)));
  cube.faces = faces; cube.uvMode = 'face'; cube.rotation = result.rotation;
  if (cube.rescale) { cube.rescale = false; cube.inflate = 0; }
  return true;
}
