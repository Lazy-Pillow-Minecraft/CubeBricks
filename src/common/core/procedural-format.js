import { constrainCube, formatRules } from './format-constraints.js';
import { boundFormatContext, formatDefinition, invokeFormatHook } from './format-hooks.js';
import { rotateVector, inverseRotateVector, quaternionFromEuler, quaternionMultiply, eulerFromQuaternion } from '../../utils/math/rotation.js';
import { getBlockbenchBoxUv, rescaleRotationPoint } from './geometry-utils.js';
import { foldJavaCubeRotation } from '../../utils/math/cube-quarter-turn.js';
import { fitLimitedCurveCubes } from '../../utils/shape/java-curve-fit.js';

const clean = value => Math.abs(value) < 1e-7 ? 0 : Math.round(value * 1e9) / 1e9;
export function proceduralFormatContext(owner, project = null) {
  const bound = boundFormatContext(owner);
  project ||= bound?.project;
  return { owner, project, rules: project ? formatRules(project) : bound?.rules || formatRules(null) };
}
export function proceduralShapeSupported(owner, project = null) {
  return formatDefinition('shape', owner.shapeType || owner.type)?.supportsFormat(proceduralFormatContext(owner, project).rules) !== false;
}
export function constrainProceduralCubes(owner, cubes, project = null) {
  const context = { ...proceduralFormatContext(owner, project), phase: 'geometry' };
  const definition = formatDefinition('shape', owner.shapeType || owner.type);
  if (definition?.supportsFormat(context.rules) === false) return [];
  const result = invokeFormatHook('shape', owner.shapeType || owner.type, cubes, context);
  return Array.isArray(result) ? result : cubes;
}

function outerFrames(owner, project) {
  return [{ pivot: owner.pivot || owner.origin || [0, 0, 0], rotation: owner.rotation || [0, 0, 0] },
  ...(project?.getGroupChain(owner.uid) || []).slice().reverse()];
}
const turnPoint = (point, frame, inverse = false) => (inverse ? inverseRotateVector : rotateVector)(
  point.map((value, axis) => value - frame.pivot[axis]), frame.rotation).map((value, axis) => value + frame.pivot[axis]);
function frameQuaternion(frames) {
  return frames.reduce((q, frame) => quaternionMultiply(quaternionFromEuler(frame.rotation), q), [0, 0, 0, 1]);
}

// Express a procedural cube in world coordinates, retaining its signed sizes
// and UV basis. This is an oriented box, not its axis-aligned bounding box.
export function proceduralCubeWorld(owner, cube, project = null) {
  const offset = owner.origin || [0, 0, 0], frames = outerFrames(owner, project);
  if (cube.rescale && frames.some(frame => frame.rotation.some(value => Math.abs(value) > 1e-7))) {
    const sign = cube.size.map(value => value < 0 ? -1 : 1), inflate = Number(cube.inflate) || 0;
    const from = rescaleRotationPoint(cube.position.map((value, axis) => value - sign[axis] * inflate), cube.pivot, cube.rotation, true);
    const to = rescaleRotationPoint(cube.position.map((value, axis) => value + cube.size[axis] + sign[axis] * inflate), cube.pivot, cube.rotation, true);
    const faces = Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map(name => [name,
      cube.faces?.[name] === null ? null : { ...cube.faces?.[name], uv: cube.faces?.[name]?.uv || getBlockbenchBoxUv(cube, name) }]));
    cube = {
      ...cube,
      position: from,
      size: to.map((value, axis) => value - from[axis]),
      inflate: 0,
      rescale: false,
      uvMode: 'face',
      faces
    };
  }
  const basePivot = cube.pivot.map((value, axis) => value + offset[axis]);
  const pivot = frames.reduce((point, frame) => turnPoint(point, frame), basePivot);
  return {
    ...structuredClone(cube), pivot,
    position: pivot.map((value, axis) => value + cube.position[axis] + offset[axis] - basePivot[axis]),
    rotation: eulerFromQuaternion(quaternionMultiply(frameQuaternion(frames), quaternionFromEuler(cube.rotation || [0, 0, 0])))
  };
}
export function proceduralCubeLocal(owner, world, project = null) {
  const offset = owner.origin || [0, 0, 0], frames = outerFrames(owner, project);
  const outer = frameQuaternion(frames), inverse = outer.map((value, axis) => axis < 3 ? -value : value);
  const pivot = frames.slice().reverse().reduce((point, frame) => turnPoint(point, frame, true), world.pivot)
    .map((value, axis) => clean(value - offset[axis]));
  return {
    ...world, pivot,
    position: pivot.map((value, axis) => clean(value + world.position[axis] - world.pivot[axis])),
    rotation: eulerFromQuaternion(quaternionMultiply(inverse, quaternionFromEuler(world.rotation))).map(clean)
  };
}

function rotatedCorners(cube, includeInflate = false) {
  const inflate = includeInflate || cube.rescale ? Number(cube.inflate) || 0 : 0;
  return Array.from({ length: 8 }, (_, mask) => rotateVector(rescaleRotationPoint(cube.position.map((value, axis) =>
    value + ((mask >> axis) & 1) * cube.size[axis] + (cube.size[axis] < 0 ? -1 : 1) * (((mask >> axis) & 1) ? inflate : -inflate)),
    cube.pivot, cube.rotation, cube.rescale).map((value, axis) => value - cube.pivot[axis]), cube.rotation)
    .map((value, axis) => value + cube.pivot[axis]));
}

function constrainBedrockShape(cubes, context) {
  if (!cubes.length) return cubes;
  const { owner, project } = context;
  const groupInflate = (project?.getGroupChain(owner.uid) || []).reduce((sum, group) => sum + (Number(group.inflate) || 0), 0);
  const world = cubes.map(cube => proceduralCubeWorld(owner, { ...cube, inflate: (Number(cube.inflate) || 0) + groupInflate }, project));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const corners = world.map(cube => rotatedCorners(cube, true));
  for (const points of corners) for (const point of points) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], point[axis]);
    max[axis] = Math.max(max[axis], point[axis]);
  }
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const limitCenter = project?.formatData?.bedrockConstraintCenter || center.map((value, axis) =>
    Math.max([-7, 1, -7][axis], Math.min([7, 15, 7][axis], value)));
  const scale = Math.min(1, ...max.map((value, axis) => 30 / Math.max(1e-9, value - min[axis])));
  const delta = center.map((value, axis) => {
    const half = (max[axis] - min[axis]) * scale / 2;
    return Math.max(limitCenter[axis] - 15 + half, Math.min(limitCenter[axis] + 15 - half, value)) - value;
  });
  // The moving Bedrock box must still intersect the base block, including at
  // least one actual Cube. A distant curve's AABB alone is insufficient.
  const scaled = (value, axis) => (value - center[axis]) * scale + center[axis];
  let best = null, score = Infinity;
  for (const points of corners) {
    const candidate = [];
    for (let axis = 0; axis < 3; axis++) {
      const low = Math.min(...points.map(point => scaled(point[axis], axis))), high = Math.max(...points.map(point => scaled(point[axis], axis)));
      const lower = Math.max(limitCenter[axis] - 15 - scaled(min[axis], axis), [-8, 0, -8][axis] + 1 - high);
      const upper = Math.min(limitCenter[axis] + 15 - scaled(max[axis], axis), [8, 16, 8][axis] - 1 - low);
      if (high - low < 1 - 1e-7 || lower > upper + 1e-7) break;
      candidate.push(Math.max(lower, Math.min(upper, 0)));
    }
    if (candidate.length !== 3) continue;
    const distance = candidate.reduce((sum, value) => sum + value * value, 0);
    if (distance < score) {
      score = distance;
      best = candidate;
    }
  }
  if (best) delta.splice(0, 3, ...best);
  if (scale === 1 && delta.every(value => Math.abs(value) < 1e-8)) return cubes;
  const point = vector => vector.map((value, axis) => (value - center[axis]) * scale + center[axis] + delta[axis]);
  world.forEach((cube, index) => {
    cube.position = point(cube.position);
    cube.pivot = point(cube.pivot);
    cube.size = cube.size.map(value => value * scale);
    cube.inflate *= scale;
    const local = proceduralCubeLocal(owner, cube, project);
    local.inflate -= groupInflate;
    Object.assign(cubes[index], local);
  });
  return cubes;
}

function restoreFaceBasis(cube, source, turns) {
  // Quarter turns are a serialization detail. Keep the editable face identities
  // and corner order in live geometry so painting and UV selection use the
  // source face rather than a relabelled face from the export representation.
  for (const matrix of turns.slice().reverse()) {
    const inversePoint = point => matrix[0].map((_, axis) => matrix.reduce((sum, row, col) =>
      sum + row[axis] * (point[col] - cube.pivot[col]), 0) + cube.pivot[axis]);
    const start = inversePoint(cube.position), end = inversePoint(cube.position.map((value, axis) => value + cube.size[axis]));
    const signs = matrix[0].map((_, axis) => {
      const canonicalAxis = matrix.findIndex(row => row[axis] !== 0);
      return cube.size[canonicalAxis] < 0 ? -1 : 1;
    });
    cube.position = start.map((value, axis) => signs[axis] < 0 ? Math.max(value, end[axis]) : Math.min(value, end[axis]));
    cube.size = start.map((value, axis) => signs[axis] * Math.abs(end[axis] - value));
    const y = Math.asin(Math.max(-1, Math.min(1, -matrix[2][0])));
    const x = Math.abs(Math.cos(y)) > 1e-7 ? Math.atan2(matrix[2][1], matrix[2][2]) : 0;
    const z = Math.abs(Math.cos(y)) > 1e-7 ? Math.atan2(matrix[1][0], matrix[0][0]) : Math.atan2(-matrix[0][1], matrix[1][1]);
    cube.rotation = eulerFromQuaternion(quaternionMultiply(quaternionFromEuler(cube.rotation),
      quaternionFromEuler([x, y, z].map(value => value * 180 / Math.PI))));
  }
  if (turns.length) {
    cube.faces = Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map(name => [name,
      source.faces?.[name] === null ? null : {
        ...structuredClone(source.faces?.[name] || {}),
        uv: source.uvMode !== 'box' && source.faces?.[name]?.uv || getBlockbenchBoxUv(source, name)
      }]));
    cube.uvMode = 'face';
  }
}

export function constrainJavaProceduralCube(owner, cube, context) {
  const world = proceduralCubeWorld(owner, cube, context.project);
  const turns = [], source = context.preserveFaceBasis !== false ? { ...world, size: [...world.size] } : null;
  const weights = context.rotationWeights || world.size.map(value => Math.max(1e-6, value * value));
  const maximum = Math.max(...weights);
  const rules = {
    ...context.rules,
    onQuarterTurn: matrix => turns.push(matrix),
    rotationWeights: weights.map(value => value / maximum)
  };
  const corners = context.rules.singleAxisRotation ? rotatedCorners(world) : null;
  if (corners) {
    const center = [0, 1, 2].map(axis => corners.reduce((sum, point) => sum + point[axis], 0) / corners.length);
    foldJavaCubeRotation(world, rules);
    let localCenter = inverseRotateVector(center.map((value, axis) => value - world.pivot[axis]), world.rotation);
    if (world.rescale) {
      const axis = world.rotation.reduce((best, value, index) => Math.abs(value) > Math.abs(world.rotation[best]) ? index : best, 0);
      const cosine = Math.abs(Math.cos(world.rotation[axis] * Math.PI / 180));
      if (cosine >= 1e-7) localCenter = localCenter.map((value, index) => index === axis ? value : value * cosine);
    }
    // Preserve the physical center and signed dimensions. Expanding the
    // original corners in the new frame turns slanted beams into thick blocks.
    world.position = localCenter.map((value, axis) => value + world.pivot[axis] - world.size[axis] / 2);
  }
  constrainCube(world, rules);
  if (source) restoreFaceBasis(world, source, turns);
  Object.assign(cube, proceduralCubeLocal(owner, world, context.project));
  return cube;
}

export function constrainBuiltinShape(subject, context) {
  const { rules, owner, phase } = context;
  if (phase === 'parameters') {
    if (rules.javaBlock) owner.uvMode = 'face';
    if (rules.moddedEntity) {
      owner.uvMode = 'box';
      owner.autoUv = true;
      if (owner.origin) owner.origin = owner.origin.map(Math.round);
      if (owner.pivot) owner.pivot = owner.pivot.map(Math.round);
      for (const key of ['radius', 'height', 'innerRadius', 'thickness', 'cubeSize', 'segmentLength']) {
        if (Number.isFinite(owner.parameters?.[key])) owner.parameters[key] = Math.round(owner.parameters[key]);
      }
    }
    return;
  }
  if (phase !== 'geometry') return;
  if (rules.javaBlock) {
    if (rules.singleAxisRotation && owner.type?.startsWith('bezier')) return fitLimitedCurveCubes(subject, {
      toWorld: cube => proceduralCubeWorld(owner, cube, context.project),
      toLocal: cube => proceduralCubeLocal(owner, cube, context.project),
      fitCube: cube => {
        const weights = cube.size.map(value => Math.max(1e-6, value * value));
        weights[2] = Math.max(weights[2], 4 * weights[0], 4 * weights[1]);
        return constrainJavaProceduralCube(owner, cube, { ...context, rotationWeights: weights });
      }
    });
    return subject.map(cube => constrainJavaProceduralCube(owner, cube, context));
  }
  if (rules.bedrockBlock) return constrainBedrockShape(subject, context);
  if (rules.moddedEntity) for (const cube of subject) {
    const size = cube.size.map(value => value === 0 ? 0 : Math.sign(value) * Math.max(1,
      owner.type?.startsWith('bezier') ? Math.ceil(Math.abs(value) - 1e-7) : Math.round(Math.abs(value))));
    cube.position = cube.position.map((value, axis) => clean(value + (cube.size[axis] - size[axis]) / 2));
    cube.size = size;
    cube.uvMode = 'box';
    cube.autoUv = true;
    for (const face of Object.values(cube.faces || {})) if (face) delete face.uv;
    // Generated orientations become bone rotations when materialized. Do not
    // zero them here: the live shape must show the same oriented columns.
  }
  return subject;
}

export function constrainElementCube(project, cube) {
  const rules = formatRules(project);
  if (!rules.javaBlock || cube.subdivisionOwnerUid) return cube;
  const owner = { uid: cube.uid, origin: [0, 0, 0], pivot: [0, 0, 0], rotation: [0, 0, 0] };
  const values = {};
  // Visual copies can inherit Cube data; structuredClone alone drops those
  // inherited coordinates and would produce an incomplete derived Cube.
  for (const key in cube) values[key] = cube[key];
  return constrainJavaProceduralCube(owner, structuredClone(values), { project, owner, rules });
}
