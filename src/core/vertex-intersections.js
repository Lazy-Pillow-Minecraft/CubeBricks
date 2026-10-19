// World-space intersections for vertex snapping. Screen-space crossings must
// never become snap targets: they can be far apart in depth.
const CUBE_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
const EPSILON = 1e-6;

const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const addScaled = (a, direction, scale) => a.map((value, axis) => value + direction[axis] * scale);
function bounds(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], point[axis]);
    max[axis] = Math.max(max[axis], point[axis]);
  }
  return { min: min.map(value => value - EPSILON), max: max.map(value => value + EPSILON) };
}
const overlaps = (left, right) => [0, 1, 2].every(axis => left.min[axis] <= right.max[axis] && right.min[axis] <= left.max[axis]);
const pointKey = point => point.map(value => Math.round(value * 1e5)).join(',');

function cubeEdges(cubes) {
  const edges = [], seen = new Set();
  for (const corners of cubes) {
    if (!corners || corners.length !== 8) continue;
    for (const [first, second] of CUBE_EDGES) {
      const a = corners[first], b = corners[second];
      if (dot(subtract(b, a), subtract(b, a)) < EPSILON * EPSILON) continue;
      const keys = [pointKey(a), pointKey(b)].sort();
      const key = `${keys[0]}|${keys[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b, ...bounds([a, b]) });
    }
  }
  return edges;
}

function buildBvh(entries) {
  if (!entries.length) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const entry of entries) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], entry.min[axis]);
    max[axis] = Math.max(max[axis], entry.max[axis]);
  }
  if (entries.length <= 12) return { min, max, entries };
  const axis = [0, 1, 2].reduce((best, current) => max[current] - min[current] > max[best] - min[best] ? current : best, 0);
  entries.sort((a, b) => (a.min[axis] + a.max[axis]) - (b.min[axis] + b.max[axis]));
  const middle = Math.floor(entries.length / 2);
  return { min, max, left: buildBvh(entries.slice(0, middle)), right: buildBvh(entries.slice(middle)) };
}

function queryBvh(root, entry, visit) {
  if (!root || !overlaps(root, entry)) return;
  if (root.entries) {
    for (const candidate of root.entries) if (overlaps(candidate, entry)) visit(candidate);
    return;
  }
  queryBvh(root.left, entry, visit);
  queryBvh(root.right, entry, visit);
}

function segmentSegmentIntersection(source, target) {
  const u = subtract(source.b, source.a), v = subtract(target.b, target.a), w = subtract(source.a, target.a);
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), uw = dot(u, w), vw = dot(v, w);
  const denominator = uu * vv - uv * uv;
  if (denominator <= uu * vv * 1e-12) return null; // Parallel or collinear: no unique crossing.
  const sourceT = (uv * vw - vv * uw) / denominator;
  const targetT = (uu * vw - uv * uw) / denominator;
  if (sourceT <= EPSILON || sourceT >= 1 - EPSILON || targetT < -EPSILON || targetT > 1 + EPSILON) return null;
  const first = addScaled(source.a, u, sourceT), second = addScaled(target.a, v, targetT);
  const separation = subtract(first, second);
  const tolerance = Math.max(1e-5, Math.max(Math.sqrt(uu), Math.sqrt(vv)) * 1e-6);
  return dot(separation, separation) <= tolerance * tolerance ? first : null;
}

function segmentFaceIntersection(source, face) {
  const [origin, right, down] = face.quad;
  const u = subtract(right, origin), v = subtract(down, origin);
  const normal = cross(u, v), direction = subtract(source.b, source.a);
  const normalLength = Math.hypot(...normal), directionLength = Math.hypot(...direction);
  if (normalLength < EPSILON || directionLength < EPSILON) return null;
  const denominator = dot(normal, direction);
  if (Math.abs(denominator) <= normalLength * directionLength * 1e-10) return null;
  const sourceT = dot(normal, subtract(origin, source.a)) / denominator;
  if (sourceT <= EPSILON || sourceT >= 1 - EPSILON) return null;
  const point = addScaled(source.a, direction, sourceT);
  const relative = subtract(point, origin);
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), ru = dot(relative, u), rv = dot(relative, v);
  const basis = uu * vv - uv * uv;
  if (basis <= uu * vv * 1e-12) return null;
  const alongU = (ru * vv - rv * uv) / basis;
  const alongV = (rv * uu - ru * uv) / basis;
  return alongU >= -EPSILON && alongU <= 1 + EPSILON && alongV >= -EPSILON && alongV <= 1 + EPSILON ? point : null;
}

export function findVertexSnapIntersections(sourceCubes, targetCubes, targetQuads) {
  const sourceEdges = cubeEdges(sourceCubes);
  if (!sourceEdges.length) return [];
  const sourceBounds = bounds((function* () {
    for (const corners of sourceCubes) for (const point of corners) yield point;
  })());
  const targetEdges = cubeEdges(targetCubes.filter(corners => corners?.length === 8 && overlaps(bounds(corners), sourceBounds)));
  const faces = targetQuads.filter(quad => quad?.length === 4 && overlaps(bounds(quad), sourceBounds))
    .map(quad => ({ quad, ...bounds(quad) }));
  const edgeBvh = buildBvh(targetEdges), faceBvh = buildBvh(faces);
  const intersections = new Map();
  const add = point => { if (point) intersections.set(pointKey(point), point); };
  for (const edge of sourceEdges) {
    queryBvh(edgeBvh, edge, target => add(segmentSegmentIntersection(edge, target)));
    queryBvh(faceBvh, edge, face => add(segmentFaceIntersection(edge, face)));
  }
  return [...intersections.values()];
}
