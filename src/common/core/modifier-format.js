import { quaternionFromEuler, quaternionMultiply, eulerFromQuaternion, rotateVector, inverseRotateVector } from '../../utils/math/rotation.js';

const inverse = q => q.map((value, axis) => axis < 3 ? -value : value);
const parentRotation = (owner, project) => (project?.getGroupChain(owner.uid) || []).reduce(
  (q, group) => quaternionMultiply(q, quaternionFromEuler(group.rotation || [0, 0, 0])), [0, 0, 0, 1]);
const quarterRotation = q => quaternionFromEuler(eulerFromQuaternion(q).map(value => Math.round(value / 90) * 90));
const cleanEuler = q => eulerFromQuaternion(q).map(value => Math.abs(value) < 1e-7 ? 0 : Math.round(value * 1e8) / 1e8);
const nearest = (value, values) => values.reduce((best, next) => Math.abs(next - value) <= Math.abs(best - value) ? next : best);
const pointInParent = (point, owner, project, reverse = false) => {
  const groups = project?.getGroupChain(owner.uid) || [];
  return (reverse ? groups : [...groups].reverse()).reduce((point, group) => (reverse ? inverseRotateVector : rotateVector)(
    point.map((value, axis) => value - group.pivot[axis]), group.rotation).map((value, axis) => value + group.pivot[axis]), [...point]);
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const bounds = points => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], point[axis]);
    max[axis] = Math.max(max[axis], point[axis]);
  }
  return { min, max };
};
const matrixFor = rotation => [0, 1, 2].map(axis => rotateVector([0, 1, 2].map(col => col === axis ? 1 : 0), rotation))
  .map((_row, axis, columns) => columns.map(column => column[axis]));

function sourceGeometry(modifier, context) {
  if (!context.project || !context.rules.javaBlock && !context.rules.bedrockBlock) return null;
  const evaluation = context.evaluation || new Map();
  const points = context.project.getFormatSourcePoints?.(context.owner, modifier, evaluation);
  return points?.length ? { points, domain: context.project.getFormatDomain(evaluation) } : null;
}

function fitSymmetryCenter(modifier, context, geometry) {
  const { owner, project } = context, pivot = owner.pivot || owner.origin || owner.position || [0, 0, 0];
  const localCenter = rotateVector(modifier.anchor.position.map((value, axis) => value - pivot[axis]), owner.rotation || [0, 0, 0])
    .map((value, axis) => value + pivot[axis]);
  let center = pointInParent(localCenter, owner, project);
  const planes = [];
  for (const matrix of project.getSymmetryFormatMatrices(owner, modifier)) {
    const transformed = project.transformFormatSourcePoints(geometry.points, matrix), limits = bounds(transformed);
    for (let axis = 0; axis < 3; axis++) {
      const row = matrix[axis], coefficients = row.map((value, col) => (col === axis ? 1 : 0) - value);
      const length = coefficients.reduce((sum, value) => sum + value * value, 0);
      if (length < 1e-10) continue;
      planes.push({
        coefficients,
        length,
        low: geometry.domain.min[axis] - limits.min[axis],
        high: geometry.domain.max[axis] - limits.max[axis]
      });
    }
  }
  for (let iteration = 0; iteration < 32; iteration++) for (const plane of planes) {
    const value = plane.coefficients.reduce((sum, coefficient, axis) => sum + coefficient * center[axis], 0);
    const delta = clamp(value, plane.low, plane.high) - value;
    center = center.map((value, axis) => value + plane.coefficients[axis] * delta / plane.length);
  }
  const valid = planes.every(plane => {
    const value = plane.coefficients.reduce((sum, coefficient, axis) => sum + coefficient * center[axis], 0);
    return value >= plane.low - 1e-6 && value <= plane.high + 1e-6;
  });
  if (!valid) return false;
  const parentPoint = pointInParent(center, owner, project, true);
  modifier.anchor.position = inverseRotateVector(parentPoint.map((value, axis) => value - pivot[axis]), owner.rotation || [0, 0, 0])
    .map((value, axis) => Math.round((value + pivot[axis]) * 1e8) / 1e8);
  return true;
}

export function constrainSymmetryFormat(modifier, context) {
  const { phase, rules, owner, project } = context;
  if (phase !== 'parameters' || !rules.javaBlock && !rules.bedrockBlock) return;
  modifier.anchor ||= { position: [...(owner.pivot || owner.origin || [0, 0, 0])], rotation: [0, 0, 0] };
  const geometry = sourceGeometry(modifier, context);
  if (rules.javaBlock && rules.singleAxisRotation) {
    const valid = () => geometry && project.getSymmetryFormatMatrices(owner, modifier)
      .every(matrix => project.isFormatSourceTransformValid(geometry.points, matrix));
    if (!valid()) {
      const requested = modifier.copies;
      constrainQuarterSymmetry(modifier, context);
      if (modifier.mode !== 'axes' && modifier.distribution !== 'range') {
        const fallback = modifier.copies;
        for (const copies of [1, 2, 4, 8, 16].sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested) || b - a)) {
          modifier.copies = copies;
          if (valid()) break;
          modifier.copies = fallback;
        }
      }
    }
  }
  if (geometry && !fitSymmetryCenter(modifier, context, geometry) && rules.bedrockBlock) {
    constrainQuarterSymmetry(modifier, context);
    fitSymmetryCenter(modifier, context, geometry);
  }
}

function constrainQuarterSymmetry(modifier, { owner, project }) {
  const parent = parentRotation(owner, project), frame = quaternionMultiply(parent, quaternionFromEuler(owner.rotation || [0, 0, 0]));
  modifier.anchor ||= { position: [...(owner.pivot || owner.origin || [0, 0, 0])], rotation: [0, 0, 0] };
  const world = quaternionMultiply(frame, quaternionFromEuler(modifier.anchor.rotation || [0, 0, 0]));
  modifier.anchor.rotation = cleanEuler(quaternionMultiply(inverse(frame), quarterRotation(world)));
  if (modifier.mode === 'axes') return;
  const count = Math.max(1, Math.min(256, Math.round(Number(modifier.copies) || 1)));
  if (modifier.distribution !== 'range') modifier.copies = nearest(count, [1, 2, 4]);
  else {
    modifier.rangeStart = Math.round((Number(modifier.rangeStart) || 0) / 90) * 90;
    modifier.rangeEnd = Math.round((Number(modifier.rangeEnd) || 0) / 90) * 90;
    const steps = Math.abs(modifier.rangeEnd - modifier.rangeStart) / 90;
    const counts = [1];
    for (let copies = 2; copies <= Math.min(256, steps + 1); copies++) if (steps % (copies - 1) === 0) counts.push(copies);
    modifier.copies = nearest(count, counts);
  }
}

export function constrainCopyFormat(modifier, context) {
  const { phase, rules, owner, project } = context;
  if (phase !== 'parameters' || !rules.javaBlock && !rules.bedrockBlock) return;
  const parent = parentRotation(owner, project), frame = quaternionMultiply(parent, quaternionFromEuler(owner.rotation || [0, 0, 0]));
  const geometry = sourceGeometry(modifier, context);
  const pivot = owner.pivot || owner.origin || owner.position || [0, 0, 0];
  const baseCenter = pointInParent(pivot, owner, project);
  for (const node of modifier.nodes || []) {
    const target = quaternionMultiply(parent, quaternionFromEuler(node.rotation || [0, 0, 0]));
    let delta = quaternionMultiply(target, inverse(frame));
    if (rules.javaBlock && rules.singleAxisRotation
      && (!geometry || !project.isFormatSourceTransformValid(geometry.points, matrixFor(eulerFromQuaternion(delta))))) delta = quarterRotation(delta);
    let deltaEuler = eulerFromQuaternion(delta), points = geometry && project.transformFormatSourcePoints(geometry.points, matrixFor(deltaEuler));
    let limits = points && bounds(points);
    if (geometry && rules.bedrockBlock && [0, 1, 2].some(axis => limits.max[axis] - limits.min[axis] > 30 + 1e-6)) {
      delta = [0, 0, 0, 1];
      deltaEuler = [0, 0, 0];
      points = geometry.points.map(point => point.map((value, axis) => value - baseCenter[axis]));
      limits = bounds(points);
    } else if (geometry) {
      const centerDelta = rotateVector(baseCenter, deltaEuler);
      limits.min = limits.min.map((value, axis) => value - centerDelta[axis]);
      limits.max = limits.max.map((value, axis) => value - centerDelta[axis]);
    }
    node.rotation = cleanEuler(quaternionMultiply(inverse(parent), quaternionMultiply(delta, frame)));
    if (geometry) {
      let center = pointInParent(node.position, owner, project);
      center = center.map((value, axis) => clamp(value, geometry.domain.min[axis] - limits.min[axis], geometry.domain.max[axis] - limits.max[axis]));
      node.position = pointInParent(center, owner, project, true).map(value => Math.round(value * 1e8) / 1e8);
    }
  }
}
