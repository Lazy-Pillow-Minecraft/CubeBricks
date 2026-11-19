import { transformCubeFromWorld } from '../../model.js';
import { shapeRegistry } from '../../shapes/builtins.js';
import { sourceCubeEntries, sourceWorldVertices } from '../../model/modifier-evaluation.js';
import { captureBakeFrames, restoreBakeFrames } from '../../model/procedural-bake-frames.js';
import { affineAround, affineCompose, affineInverse, affinePoint, applyGroupChainPoint, groupChainMatrix, inverseGroupChainPoint,
  matrixDeterminant, matrixEuler, matrixIdentity, matrixMultiply, matrixTranspose, rotationMatrix } from '../../model/transform-math.js';

const clone = value => structuredClone(value);
const MIRROR_X = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]];
const LENGTH_PARAMETERS = ['radius', 'height', 'thickness', 'cubeSize', 'innerRadius', 'segmentLength'];
const scaled = (vector, factor) => vector.map(value => value * factor);
const groupFrame = group => ({ uid: group.uid, pivot: [...group.pivot], rotation: [...(group.rotation || [0, 0, 0])] });

export function boundsOfPoints(points) {
  if (!points.length) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], point[axis]);
    max[axis] = Math.max(max[axis], point[axis]);
  }
  return { min, max, size: max.map((value, axis) => value - min[axis]), center: min.map((value, axis) => (value + max[axis]) / 2) };
}

// Capture each source once, with parents before descendants. Every preview is
// recomputed from this immutable baseline, including group rotations and UVs.
export function captureToolboxSelection(project, roots) {
  const entries = [], visited = new Set(), points = [];
  const visit = node => {
    if (!node || visited.has(node.uid)) return;
    visited.add(node.uid);
    const data = clone(node), chain = project.getGroupChain(node.uid).map(groupFrame);
    const pivot = data.pivot || data.origin || data.position || [0, 0, 0];
    const sources = node.type === 'group' ? [] : sourceCubeEntries(project, node).map(source => ({
      ...source, cube: clone(source.cube), chain: source.chain.map(groupFrame), worldVertices: undefined
    }));
    const vertices = sources.flatMap(sourceWorldVertices);
    for (const point of vertices) points.push(point);
    entries.push({ node, data, chain, sources,
      attachedFrames: captureBakeFrames(project, node).filter(frame => frame.frame),
      worldCenter: node.type === 'cube' ? vertices.reduce((sum, point) => sum.map((value, axis) => value + point[axis] / vertices.length), [0, 0, 0]) : null,
      worldPivot: applyGroupChainPoint(pivot, chain),
      worldRotation: matrixMultiply(groupChainMatrix(chain), rotationMatrix(data.rotation || [0, 0, 0])) });
    if (node.type === 'group') node.children.forEach(uid => visit(project.getNode(uid)));
  };
  roots.forEach(visit);
  const rootIds = new Set(roots.map(node => node.uid));
  for (const entry of entries) entry.copyFrames = entry.chain.some(group => rootIds.has(group.uid))
    ? (entry.data.modifiers || []).filter(modifier => modifier.type === 'element_copy').flatMap(modifier => (modifier.nodes || []).map(node => ({
      modifierUid: modifier.uid, uid: node.uid, position: applyGroupChainPoint(node.position, entry.chain),
      rotation: matrixMultiply(groupChainMatrix(entry.chain), rotationMatrix(node.rotation || [0, 0, 0]))
    }))) : [];
  const pivots = entries.filter(entry => rootIds.has(entry.node.uid)).map(entry => entry.worldPivot);
  const pivot = pivots.length ? pivots.reduce((sum, point) => sum.map((value, axis) => value + point[axis]), [0, 0, 0]).map(value => value / pivots.length) : [0, 0, 0];
  return { entries, roots: [...rootIds], pivot, points, bounds: boundsOfPoints(points) };
}

export function restoreToolboxSelection(capture) {
  for (const { node, data } of capture.entries) {
    for (const key of Object.keys(node)) if (!Object.hasOwn(data, key)) delete node[key];
    Object.assign(node, clone(data));
  }
}

// Compensate each selected root around its own pivot. Descendants follow the
// root rigidly, rather than independently losing their relative rotations.
// For a selected modifier result, solve in that displayed instance's frame
// and map the operation back to its source, just like the other tools.
export function compensateToolboxRotation(project, capture, axes, frame = null) {
  for (const uid of capture.roots) {
    const node = project.getNode(uid);
    if (!node) continue;
    const branch = captureToolboxSelection(project, [node]), entry = branch.entries[0];
    const handedness = frame && matrixDeterminant(frame.matrix) < 0 ? MIRROR_X : matrixIdentity();
    const displayed = frame ? matrixMultiply(matrixMultiply(frame.matrix, entry.worldRotation), handedness) : entry.worldRotation;
    const desiredEuler = matrixEuler(displayed).map((angle, index) => axes === 'all' || axes.includes('xyz'[index]) ? 0 : angle);
    const delta = matrixMultiply(rotationMatrix(desiredEuler), matrixTranspose(displayed));
    const pivot = frame ? affinePoint(frame, entry.worldPivot) : entry.worldPivot;
    const operation = affineAround(delta, pivot);
    transformToolboxSelection(project, branch, frame
      ? affineCompose(affineInverse(frame), affineCompose(operation, frame)) : operation);
  }
}

export function snapToolboxLength(value, step) {
  return step > 0 ? Math.max(0, Math.round(value / step) * step) : value;
}

function solve3(matrix, vector) {
  const rows = matrix.map((row, i) => [...row, vector[i]]);
  for (let axis = 0; axis < 3; axis++) {
    let pivot = axis;
    for (let row = axis + 1; row < 3; row++) if (Math.abs(rows[row][axis]) > Math.abs(rows[pivot][axis])) pivot = row;
    if (Math.abs(rows[pivot][axis]) < 1e-10) return null;
    [rows[axis], rows[pivot]] = [rows[pivot], rows[axis]];
    const divisor = rows[axis][axis];
    rows[axis] = rows[axis].map(value => value / divisor);
    for (let row = 0; row < 3; row++) if (row !== axis) {
      const factor = rows[row][axis];
      rows[row] = rows[row].map((value, column) => value - rows[axis][column] * factor);
    }
  }
  return rows.map(row => row[3]);
}

// Fit snapped envelope extents while retaining a Cube's rotation. An oblique
// box can have dependent projected axes (for example exactly 45 degrees); in
// that case choose the nearest nonnegative dimensions, without adding shear.
function fitBoxDimensions(matrix, extents, fallback) {
  const exact = solve3(matrix, extents);
  if (exact?.every(value => value >= -1e-7)) return exact.map(value => Math.max(0, value));
  const result = [...fallback];
  for (let iteration = 0; iteration < 32; iteration++) for (let axis = 0; axis < 3; axis++) {
    let numerator = 1e-8 * fallback[axis], denominator = 1e-8;
    for (let row = 0; row < 3; row++) {
      const other = result.reduce((sum, value, column) => column === axis ? sum : sum + matrix[row][column] * value, 0);
      numerator += matrix[row][axis] * (extents[row] - other);
      denominator += matrix[row][axis] ** 2;
    }
    result[axis] = Math.max(0, numerator / denominator);
  }
  return result;
}

function scaleParameters(node, data, factor) {
  for (const key of ['handleIn', 'handleOut']) if (data[key]) node[key] = scaled(data[key], factor);
  if (data.parameters) {
    node.parameters = clone(data.parameters);
    const keys = new Set([...LENGTH_PARAMETERS, ...(shapeRegistry.get(node.shapeType)?.dimensionKeys || [])]);
    for (const key of keys) if (Number.isFinite(data.parameters[key])) node.parameters[key] = data.parameters[key] * factor;
  }
  if (data.nodes) node.nodes = node.nodes.map((node, index) => {
    const original = data.nodes[index];
    for (const key of ['position', 'handleIn', 'handleOut']) if (original[key]) node[key] = scaled(original[key], factor);
    if (Number.isFinite(original.radius)) node.radius = original.radius * factor;
    return node;
  });
  if (data.subdivisionEdits) {
    node.subdivisionEdits = clone(data.subdivisionEdits);
    for (const edit of Object.values(node.subdivisionEdits)) for (const key of ['position', 'size', 'pivot', 'positionDelta', 'sizeDelta', 'pivotDelta']) {
      if (Array.isArray(edit[key])) edit[key] = scaled(edit[key], factor);
    }
    for (const edit of Object.values(node.subdivisionEdits)) if (Number.isFinite(edit.inflateDelta)) edit.inflateDelta *= factor;
  }
}

function restoreCopyFrames(project, capture, pointTransform, orientation = matrixIdentity(), handedness = matrixIdentity()) {
  for (const entry of capture.entries) for (const frame of entry.copyFrames) {
    const modifier = entry.node.modifiers.find(modifier => modifier.uid === frame.modifierUid);
    const node = modifier?.nodes?.find(node => node.uid === frame.uid);
    if (!node) continue;
    const chain = project.getGroupChain(entry.node.uid);
    node.position = inverseGroupChainPoint(pointTransform(frame.position), chain);
    node.rotation = matrixEuler(matrixMultiply(matrixTranspose(groupChainMatrix(chain)),
      matrixMultiply(matrixMultiply(orientation, frame.rotation), handedness)));
  }
}

export function scaleToolboxSelection(project, capture, factor, { center = capture.bounds?.center || capture.pivot, snap = 'none', step = 1,
  axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], spans: referenceSpans = null } = {}) {
  const dot = (left, right) => left.reduce((sum, value, axis) => sum + value * right[axis], 0);
  const spans = referenceSpans || boundsOfPoints(capture.points.map(point => axes.map(axis => dot(point, axis))))?.size || [0, 0, 0];
  const factors = spans.map(length => snap === 'bounds' && length > 1e-8 ? snapToolboxLength(length * factor, step) / length : factor);
  const moveWorldPoint = point => {
    const offset = point.map((value, axis) => value - center[axis]);
    return center.map((value, axis) => value + axes.reduce((sum, basis, index) => sum + basis[axis] * dot(offset, basis) * factors[index], 0));
  };
  for (const entry of capture.entries) {
    const { node, data } = entry;
    const parentChain = project.getGroupChain(node.uid);
    const pivot = inverseGroupChainPoint(moveWorldPoint(entry.worldPivot), parentChain);
    const ownFactor = factor;
    const originalPivot = data.pivot || data.origin || data.position || [0, 0, 0];
    if (data.pivot) node.pivot = pivot;
    if (data.position) node.position = data.position.map((value, axis) => pivot[axis] + (value - originalPivot[axis]) * ownFactor);
    if (data.origin) node.origin = data.origin.map((value, axis) => pivot[axis] + (value - originalPivot[axis]) * ownFactor);
    if (data.size) {
      let lengths = data.size.map(value => Math.abs(value * factor));
      if (snap === 'elements') lengths = lengths.map(value => snapToolboxLength(value, step));
      if (snap === 'bounds') {
        const projection = axes.map(axis => [0, 1, 2].map(column => Math.abs(dot(axis, entry.worldRotation.map(row => row[column])))));
        const inflate = entry.sources[0]?.groupInflate || 0;
        const totalInflate = inflate + (Number(data.inflate) || 0);
        const original = data.size.map(value => Math.abs(value) + totalInflate * 2);
        const desired = projection.map((row, index) => dot(row, original) * factors[index] - row.reduce((sum, value) => sum + value * totalInflate * factor * 2, 0));
        lengths = fitBoxDimensions(projection, desired, lengths);
      }
      node.size = lengths.map((value, axis) => value * (data.size[axis] < 0 ? -1 : 1));
      const localCenter = inverseGroupChainPoint(moveWorldPoint(entry.worldCenter), parentChain);
      const relativeCenter = localCenter.map((value, axis) => value - pivot[axis]);
      const inverseOwn = matrixTranspose(rotationMatrix(data.rotation || [0, 0, 0]));
      const unrotated = inverseOwn.map(row => dot(row, relativeCenter));
      node.position = pivot.map((value, axis) => value + unrotated[axis] - node.size[axis] / 2);
    }
    if (Number.isFinite(data.inflate)) node.inflate = data.inflate * ownFactor;
    scaleParameters(node, data, ownFactor);
    if (snap !== 'none' && node.parameters) {
      const keys = new Set([...(shapeRegistry.get(node.shapeType)?.dimensionKeys || []), 'height', 'thickness']);
      for (const key of keys) if (Number.isFinite(node.parameters[key])) node.parameters[key] = snapToolboxLength(node.parameters[key], step);
      if (Number.isFinite(node.parameters.radius)) node.parameters.radius = snapToolboxLength(node.parameters.radius * 2, step) / 2;
    }
    for (const collection of ['modifiers', 'operators']) for (const attached of node[collection] || []) {
      const original = data[collection]?.find(item => item.uid === attached.uid);
      if (attached.anchor && original?.anchor) attached.anchor.position = original.anchor.position
        .map((value, axis) => pivot[axis] + (value - originalPivot[axis]) * ownFactor);
    }
  }
  for (const entry of capture.entries) restoreBakeFrames(project, entry.node, entry.attachedFrames.map(saved => ({ ...saved,
    frame: { matrix: saved.frame.matrix, center: moveWorldPoint(saved.frame.center) }
  })));
  restoreCopyFrames(project, capture, moveWorldPoint);
  return factor;
}

// Apply a world-space rigid transform without flattening groups or Shapes.
// Reflections retain signed Cube sizes, face UV orientation and a proper pose.
export function transformToolboxSelection(project, capture, affine) {
  const reflected = matrixDeterminant(affine.matrix) < 0;
  const handedness = reflected ? MIRROR_X : matrixIdentity();
  for (const entry of capture.entries) {
    const { node, data } = entry, parentChain = project.getGroupChain(node.uid);
    if (node.type === 'cube') {
      // Edit the captured source pose, not a format-adapted render copy whose
      // quarter turns or rescale may already have been consumed.
      // Parent inflation is applied before rotation rescale in the renderer.
      // Include it while solving the new raw extents, without storing the
      // inherited amount in the Cube's own inflation property.
      const cube = data.rescale ? { ...data, inflate: (Number(data.inflate) || 0) + entry.sources[0].groupInflate } : data;
      const result = transformCubeFromWorld({ ...entry.sources[0], cube }, affine, parentChain, true);
      for (const key of ['position', 'size', 'pivot', 'rotation', 'faces', 'mirrorUv']) node[key] = result[key];
    } else {
      const pivot = inverseGroupChainPoint(affinePoint(affine, entry.worldPivot), parentChain);
      node.rotation = matrixEuler(matrixMultiply(matrixTranspose(groupChainMatrix(parentChain)),
        matrixMultiply(matrixMultiply(affine.matrix, entry.worldRotation), handedness)));
      if (data.pivot) node.pivot = pivot;
      if (data.origin) {
        const originalPivot = data.pivot || data.origin;
        node.origin = data.origin.map((value, axis) => pivot[axis] + (value - originalPivot[axis]) * (reflected && axis === 0 ? -1 : 1));
        if (Boolean(data.geometryMirrorX) !== reflected) node.geometryMirrorX = true;
        else delete node.geometryMirrorX;
      } else if (data.position) node.position = pivot;
      if (reflected && data.type === 'node') for (const key of ['handleIn', 'handleOut'])
        if (data[key]) node[key] = data[key].map((value, axis) => axis === 0 ? -value : value);
    }
  }
  for (const entry of capture.entries) restoreBakeFrames(project, entry.node, entry.attachedFrames.map(saved => ({ ...saved,
    frame: { center: affinePoint(affine, saved.frame.center),
      matrix: matrixMultiply(matrixMultiply(affine.matrix, saved.frame.matrix), handedness) }
  })));
  restoreCopyFrames(project, capture, point => affinePoint(affine, point), affine.matrix, handedness);
}
