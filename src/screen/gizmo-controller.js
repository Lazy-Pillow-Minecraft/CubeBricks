import { dot3, cross3, normalize3 } from '../utils/math/vector3.js';
import { findVertexSnapIntersections } from '../common/core/vertex-intersections.js';

export function createGizmoController({
  state, $, sceneCanvas, sceneRenderer, selected, isBezierElement,
  isShapeElement, getTransformPivot, selectedMirrorGuideGroup,
  mirrorControllerWorldFrame, activeCurveNodeContext,
  activeModifierAnchorContext, getSelectionTransformContext,
  getModifierAnchorTransformAxes, getCurveNodeTransformAxes,
  getSelectionTransformAxes, isEffectivelyLocked, finiteWorldGuideMarkup
}) {
let vertexSnapIntersectionCache = null;

function addScaled3(point, direction, amount) {
  return point.map((value, axis) => value + direction[axis] * amount);
}

function intersectRayPlane(ray, planePoint, planeNormal) {
  if (!ray) return null;
  const denominator = dot3(ray.direction, planeNormal);
  if (Math.abs(denominator) < 1e-6) return null;
  const distance = dot3(planePoint.map((value, axis) => value - ray.origin[axis]), planeNormal) / denominator;
  return addScaled3(ray.origin, ray.direction, distance);
}

function projectViewportPoint(point) {
  const projected = sceneRenderer.projectPoint(point);
  return { ...projected, worldPerPixel: sceneRenderer.getCameraFrame()?.worldPerPixel || .08 };
}

function axisBasis(axis) {
  const reference = Math.abs(axis[1]) < .82 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize3(cross3(axis, reference));
  return [u, normalize3(cross3(axis, u))];
}

function pointsPath(points, close = false) {
  if (!points.length) return '';
  return `${points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}${close ? ' Z' : ''}`;
}

function gizmoDepthAttributes(shape, pointGroups, priority = '') {
  const groups = (Array.isArray(pointGroups[0]) ? pointGroups : [pointGroups]).filter(group => group.length);
  const points = groups.flat();
  const averageDepth = points.reduce((sum, point) => sum + point.depth, 0) / Math.max(1, points.length);
  const encoded = groups.map(group => group.map(point =>
    `${point.x.toFixed(3)},${point.y.toFixed(3)},${point.depth.toFixed(6)}`).join(';')).join('|');
  return `data-hit-shape="${shape}" data-hit-depth="${averageDepth.toFixed(6)}" data-hit-points="${encoded}"${priority ? ` data-hit-priority="${priority}"` : ''}`;
}

function gizmoControlLayer(control) {
  if (control.dataset.hitPriority === 'center') return 2;
  return control.dataset.kind?.startsWith('plane') ? 1 : 0;
}

function sortGizmoControlsByDepth(gizmo) {
  const controls = [...gizmo.children].filter(element => element.classList.contains('gizmo-control'));
  const anchor = [...gizmo.children].find(element => !element.classList.contains('gizmo-control')) || null;
  controls.sort((left, right) => {
    const leftLayer = gizmoControlLayer(left);
    const rightLayer = gizmoControlLayer(right);
    if (leftLayer !== rightLayer) return leftLayer - rightLayer;
    // OpenGL NDC depth grows away from the camera, so farther controls are
    // painted first and the nearer control remains visible on top.
    return Number(right.dataset.hitDepth || 1) - Number(left.dataset.hitDepth || 1);
  });
  controls.forEach(control => gizmo.insertBefore(control, anchor));
}

function parseGizmoDepthGroups(control) {
  return (control.dataset.hitPoints || '').split('|').map(group => group.split(';').map(point => {
    const values = point.split(',').map(Number);
    return values.length === 3 && values.every(Number.isFinite) ? values : null;
  }).filter(Boolean)).filter(group => group.length);
}

function triangleDepthAtPoint(point, first, second, third) {
  const denominator = (second[1] - third[1]) * (first[0] - third[0])
    + (third[0] - second[0]) * (first[1] - third[1]);
  if (Math.abs(denominator) < 1e-6) return null;
  const a = ((second[1] - third[1]) * (point[0] - third[0])
    + (third[0] - second[0]) * (point[1] - third[1])) / denominator;
  const b = ((third[1] - first[1]) * (point[0] - third[0])
    + (first[0] - third[0]) * (point[1] - third[1])) / denominator;
  const c = 1 - a - b;
  if (a < -.001 || b < -.001 || c < -.001) return null;
  return a * first[2] + b * second[2] + c * third[2];
}

function gizmoControlDepthAtPoint(control, x, y) {
  const groups = parseGizmoDepthGroups(control);
  const fallback = Number(control.dataset.hitDepth || 1);
  if (!groups.length) return fallback;
  if (control.dataset.hitShape === 'polygon' && groups[0].length >= 3) {
    const polygon = groups[0];
    for (let index = 1; index < polygon.length - 1; index++) {
      const depth = triangleDepthAtPoint([x, y], polygon[0], polygon[index], polygon[index + 1]);
      if (depth !== null) return depth;
    }
    return fallback;
  }
  let closest = { distance: Infinity, depth: fallback };
  for (const group of groups) {
    if (group.length === 1) continue;
    for (let index = 0; index < group.length - 1; index++) {
      const first = group[index], second = group[index + 1];
      const dx = second[0] - first[0], dy = second[1] - first[1];
      const lengthSquared = dx * dx + dy * dy;
      const amount = lengthSquared > 1e-6
        ? Math.max(0, Math.min(1, ((x - first[0]) * dx + (y - first[1]) * dy) / lengthSquared))
        : 0;
      const nearestX = first[0] + dx * amount, nearestY = first[1] + dy * amount;
      const distance = (x - nearestX) ** 2 + (y - nearestY) ** 2;
      if (distance < closest.distance) closest = {
        distance,
        depth: first[2] + (second[2] - first[2]) * amount
      };
    }
  }
  return closest.depth;
}

function resolveGizmoHandle(event) {
  const gizmo = $('#transformGizmo');
  const controls = [];
  const seen = new Set();
  for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
    const control = element.closest?.('.gizmo-control');
    if (!control || !gizmo.contains(control) || seen.has(control)) continue;
    seen.add(control); controls.push(control);
  }
  const fallback = event.target.closest?.('.gizmo-control');
  if (fallback && gizmo.contains(fallback) && !seen.has(fallback)) controls.push(fallback);
  if (!controls.length) return null;
  const frontLayer = Math.max(...controls.map(gizmoControlLayer));
  const frontControls = controls.filter(control => gizmoControlLayer(control) === frontLayer);
  const rect = gizmo.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  return frontControls.reduce((nearest, control) => {
    const depth = gizmoControlDepthAtPoint(control, x, y);
    if (!nearest || depth < nearest.depth - 1e-6) return { control, depth };
    if (Math.abs(depth - nearest.depth) <= 1e-6
      && control.dataset.kind === 'axis' && nearest.control.dataset.kind !== 'axis') return { control, depth };
    return nearest;
  }, null)?.control || fallback;
}

function updateGizmoDepthHover(event) {
  if (state.dragging?.type === 'transform') return;
  const gizmo = $('#transformGizmo');
  const handle = resolveGizmoHandle(event);
  gizmo.querySelectorAll('.depth-hover').forEach(control => control.classList.toggle('depth-hover', control === handle));
  handle?.classList.add('depth-hover');
}

const GIZMO_AXIS_PIXELS = 93;
const GIZMO_HEAD_GAP_PIXELS = 25;
// Rz * Ry * Rx is presented as the Z -> Y -> X Euler hierarchy. Keep that
// application order legible by nesting the corresponding rings outside-in.
const EULER_RING_RADIUS_SCALES = Object.freeze([.775, .87, .965]);

function coneMarkup(handle, origin, axisClass, pixelWorld) {
  const baseWorld = addScaled3(origin, handle.vector, handle.positiveDistance);
  const tipWorld = addScaled3(baseWorld, handle.vector, pixelWorld * 19.5);
  const u = handle.basisU, v = handle.basisV;
  const base = Array.from({ length: 12 }, (_, index) => {
    const angle = index / 12 * Math.PI * 2;
    let point = addScaled3(baseWorld, u, Math.cos(angle) * pixelWorld * 8.25);
    point = addScaled3(point, v, Math.sin(angle) * pixelWorld * 8.25);
    return projectViewportPoint(point);
  });
  const tip = projectViewportPoint(tipWorld);
  const baseCenter = projectViewportPoint(baseWorld);
  const center = projectViewportPoint(origin);
  const faces = base.map((point, index) => `<path class="gizmo-visible gizmo-head cone-face" d="${pointsPath([tip, point, base[(index + 1) % base.length]], true)}"/>`).join('');
  return `<g class="gizmo-control ${axisClass}" data-axis="${handle.axis}" data-kind="axis" ${gizmoDepthAttributes('segment', [center, tip])}>
    <line class="gizmo-hit" x1="${handle.centerX}" y1="${handle.centerY}" x2="${tip.x}" y2="${tip.y}"/>
    <line class="gizmo-visible axis-stem" x1="${handle.centerX}" y1="${handle.centerY}" x2="${baseCenter.x}" y2="${baseCenter.y}"/>
    ${faces}<circle class="gizmo-hit-point" cx="${tip.x}" cy="${tip.y}" r="18"/>
  </g>`;
}

function prismMarkup(handle, origin, axisClass, pixelWorld, sign) {
  const direction = handle.vector.map(value => value * sign);
  const distance = sign > 0 ? handle.positiveDistance : handle.negativeDistance;
  const endpointWorld = addScaled3(origin, direction, distance);
  const side = pixelWorld * 13.5;
  const halfSide = side / 2;
  const halfThickness = side / 4;
  const corners = [];
  for (const along of [-halfThickness, halfThickness]) for (const acrossU of [-halfSide, halfSide]) for (const acrossV of [-halfSide, halfSide]) {
    let point = addScaled3(endpointWorld, direction, along);
    point = addScaled3(point, handle.basisU, acrossU);
    point = addScaled3(point, handle.basisV, acrossV);
    corners.push(projectViewportPoint(point));
  }
  const faces = [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]
    .map(indices => ({ points: indices.map(index => corners[index]), depth: indices.reduce((sum, index) => sum + corners[index].depth, 0) / 4 }))
    .sort((a, b) => b.depth - a.depth)
    .map(face => `<path class="gizmo-visible gizmo-head prism-face" d="${pointsPath(face.points, true)}"/>`).join('');
  const endpoint = projectViewportPoint(endpointWorld);
  const center = projectViewportPoint(origin);
  return `<g class="gizmo-control ${axisClass}" data-axis="${handle.axis}" data-kind="axis" data-sign="${sign}" ${gizmoDepthAttributes('segment', [center, endpoint])}>
    <line class="gizmo-hit" x1="${handle.centerX}" y1="${handle.centerY}" x2="${endpoint.x}" y2="${endpoint.y}"/>
    <line class="gizmo-visible axis-stem" x1="${handle.centerX}" y1="${handle.centerY}" x2="${endpoint.x}" y2="${endpoint.y}"/>
    ${faces}<circle class="gizmo-hit-point" cx="${endpoint.x}" cy="${endpoint.y}" r="18"/>
  </g>`;
}

const GIZMO_PLANES = Object.freeze([
  { axes: [0, 1], key: 'xy' },
  { axes: [1, 2], key: 'yz' },
  { axes: [2, 0], key: 'zx' }
]);

function planeMarkup(handles, origin, plane, pixelWorld, signs = [1, 1]) {
  const [firstIndex, secondIndex] = plane.axes;
  const first = handles[firstIndex].vector.map(value => value * signs[0]);
  const second = handles[secondIndex].vector.map(value => value * signs[1]);
  const near = pixelWorld * 18;
  const far = pixelWorld * 39;
  const point = (firstDistance, secondDistance) => {
    let world = addScaled3(origin, first, firstDistance);
    world = addScaled3(world, second, secondDistance);
    return projectViewportPoint(world);
  };
  const corners = [point(near, near), point(far, near), point(far, far), point(near, far)];
  const path = pointsPath(corners, true);
  const axisKey = `plane-${firstIndex}${secondIndex}`;
  return `<g class="gizmo-control plane-${plane.key}" data-axis="${axisKey}" data-kind="plane" ${gizmoDepthAttributes('polygon', corners)}
      data-axes="${firstIndex},${secondIndex}" data-signs="${signs.join(',')}">
    <path class="gizmo-plane-hit" d="${path}"/>
    <path class="gizmo-visible plane-handle" d="${path}"/>
  </g>`;
}

function planeScaleCornerMarkup(handles, origin, plane, pixelWorld, signs) {
  const [firstIndex, secondIndex] = plane.axes;
  const first = handles[firstIndex].vector.map(value => value * signs[0]);
  const second = handles[secondIndex].vector.map(value => value * signs[1]);
  const inner = pixelWorld * 22;
  const outer = pixelWorld * 52;
  const point = (firstDistance, secondDistance) => {
    let world = addScaled3(origin, first, firstDistance);
    world = addScaled3(world, second, secondDistance);
    return projectViewportPoint(world);
  };
  const points = [point(outer, inner), point(outer, outer), point(inner, outer)];
  const path = pointsPath(points);
  const axisKey = `plane-uniform-${firstIndex}${secondIndex}`;
  return `<g class="gizmo-control plane-${plane.key}" data-axis="${axisKey}" data-kind="plane-uniform" ${gizmoDepthAttributes('polyline', points)}
      data-axes="${firstIndex},${secondIndex}" data-signs="${signs.join(',')}">
    <path class="gizmo-plane-corner-hit" d="${path}"/>
    <path class="gizmo-visible plane-scale-corner" d="${path}"/>
  </g>`;
}

function centerCubeMarkup(origin, axes, pixelWorld, { axisKey = 'uniform', kind = 'uniform', className = 'uniform-scale-control' } = {}) {
  const half = pixelWorld * 7.5;
  const corners = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    let point = addScaled3(origin, axes[0], x * half);
    point = addScaled3(point, axes[1], y * half);
    point = addScaled3(point, axes[2], z * half);
    corners.push(projectViewportPoint(point));
  }
  const faces = [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]
    .map(indices => ({ points: indices.map(index => corners[index]), depth: indices.reduce((sum, index) => sum + corners[index].depth, 0) / 4 }))
    .sort((left, right) => right.depth - left.depth)
    .map(face => `<path class="gizmo-visible center-cube-face" d="${pointsPath(face.points, true)}"/>`).join('');
  const center = projectViewportPoint(origin);
  return `<g class="gizmo-control ${className}" data-axis="${axisKey}" data-kind="${kind}" ${gizmoDepthAttributes('polygon', [center], 'center')}>
    <circle class="gizmo-hit-point" cx="${center.x}" cy="${center.y}" r="16"/>
    ${faces}
  </g>`;
}

function pivotMarkerMarkup(origin) {
  const center = projectViewportPoint(origin);
  const x = center.x, y = center.y, radius = 11;
  return `<g class="pivot-marker" aria-label="選中項樞軸點">
    <path class="pivot-marker-ring" d="M${x},${y - radius} L${x + radius},${y} L${x},${y + radius} L${x - radius},${y} Z"/>
    <path class="pivot-marker-cross" d="M${x - 15},${y} H${x + 15} M${x},${y - 15} V${y + 15}"/>
    <circle class="pivot-marker-core" cx="${x}" cy="${y}" r="3.5"/>
  </g>`;
}

function modifierAnchorMarkerMarkup(entry, active = false) {
  const frame = mirrorControllerWorldFrame(entry.owner, entry.modifier);
  if (!frame) return '';
  const point = projectViewportPoint(frame.origin);
  if (point.behind || point.depth < -1 || point.depth > 1) return '';
  const radius = active ? 11 : 9;
  return `<g class="${active ? '' : 'gizmo-control '}modifier-anchor-marker ${active ? 'active' : ''}" ${active ? '' : `data-kind="modifier-anchor" data-modifier-uid="${entry.modifier.uid}" ${gizmoDepthAttributes('point', [point], 'center')}`}>
    ${active ? '' : `<circle class="gizmo-hit-point" cx="${point.x}" cy="${point.y}" r="18"/>`}
    <path class="gizmo-visible modifier-anchor-ring" d="M${point.x},${point.y - radius} L${point.x + radius},${point.y} L${point.x},${point.y + radius} L${point.x - radius},${point.y} Z"/>
    <path class="gizmo-visible modifier-anchor-axis" d="M${point.x - 14},${point.y} H${point.x + 14} M${point.x},${point.y - 14} V${point.y + 14}"/>
    <circle class="gizmo-visible modifier-anchor-core" cx="${point.x}" cy="${point.y}" r="3.4"/>
  </g>`;
}

function curveEditorOverlayMarkup(curve) {
  if (!isBezierElement(curve)) return '';
  const nodes = sceneRenderer.getCurveNodeWorldPoints(state.project, curve.uid);
  const handles = sceneRenderer.getCurveHandleWorldPoints(state.project, curve.uid, null);
  const nodeMarkup = nodes.map(entry => {
    const point = projectViewportPoint(entry.point);
    if (point.behind || point.depth < -1 || point.depth > 1) return '';
    const active = entry.index === state.selectedCurveNodeIndex ? ' active' : '';
    return `<g class="curve-node-marker${active}" aria-label="曲線節點">
      <path class="curve-node-marker-cross" d="M${point.x - 12},${point.y} H${point.x + 12} M${point.x},${point.y - 12} V${point.y + 12}"/>
      <path class="curve-node-marker-ring" d="M${point.x},${point.y - 8} L${point.x + 8},${point.y} L${point.x},${point.y + 8} L${point.x - 8},${point.y} Z"/>
      <circle class="curve-node-marker-core" cx="${point.x}" cy="${point.y}" r="2.8"/>
    </g>`;
  }).join('');
  const handleMarkup = handles.map(entry => {
    const point = projectViewportPoint(entry.point);
    if (point.behind || point.depth < -1 || point.depth > 1) return '';
    const radius = 5.5;
    return `<path class="curve-handle-head" aria-label="貝塞爾手柄" d="M${point.x},${point.y - radius} L${point.x + radius},${point.y} L${point.x},${point.y + radius} L${point.x - radius},${point.y} Z"/>`;
  }).join('');
  return `<g class="curve-editor-overlay">${nodeMarkup}${handleMarkup}</g>`;
}

function frontRingGeometry(origin, axis, radius, cameraFrame) {
  const [u, v] = axisBasis(axis);
  let path = '', drawing = false, group = [], groups = [];
  for (let step = 0; step <= 144; step++) {
    const angle = step / 144 * Math.PI * 2;
    let offset = u.map(value => value * Math.cos(angle) * radius);
    offset = offset.map((value, component) => value + v[component] * Math.sin(angle) * radius);
    const world = origin.map((value, component) => value + offset[component]);
    const toCamera = cameraFrame.projection === 'perspective'
      ? normalize3(cameraFrame.eye.map((value, component) => value - world[component]))
      : cameraFrame.forward.map(value => -value);
    if (dot3(offset, toCamera) < -.0001) {
      if (group.length) groups.push(group);
      group = []; drawing = false; continue;
    }
    const point = projectViewportPoint(world);
    path += `${drawing ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)} `;
    group.push(point);
    drawing = true;
  }
  if (group.length) groups.push(group);
  if (groups.length > 1) {
    const first = groups[0];
    const last = groups[groups.length - 1];
    const firstPoint = first[0], lastPoint = last[last.length - 1];
    if (Math.hypot(firstPoint.x - lastPoint.x, firstPoint.y - lastPoint.y) < 1) {
      groups = [[...last.slice(0, -1), ...first], ...groups.slice(1, -1)];
    }
  }
  path = groups.map(pointsPath).join(' ');
  const mainArc = [...groups].sort((left, right) => right.length - left.length)[0] || [];
  const handleIndex = Math.floor(mainArc.length / 2);
  const handlePoint = mainArc[handleIndex] || null;
  let handle = null;
  if (handlePoint) {
    const previous = mainArc[Math.max(0, handleIndex - 1)] || handlePoint;
    const next = mainArc[Math.min(mainArc.length - 1, handleIndex + 1)] || handlePoint;
    const tangentX = next.x - previous.x;
    const tangentY = next.y - previous.y;
    const tangentLength = Math.max(.0001, Math.hypot(tangentX, tangentY));
    handle = {
      ...handlePoint,
      tangentX: tangentX / tangentLength,
      tangentY: tangentY / tangentLength
    };
  }
  return { path: path.trim(), groups, handle };
}

function taperedRingPath(points) {
  if (points.length < 2) return '';
  const sides = points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x, dy = next.y - previous.y;
    const length = Math.max(.0001, Math.hypot(dx, dy));
    const progress = index / Math.max(1, points.length - 1);
    const width = .8 + 3.2 * Math.pow(Math.sin(progress * Math.PI), .7);
    const normalX = -dy / length * width / 2;
    const normalY = dx / length * width / 2;
    return {
      left: { x: point.x + normalX, y: point.y + normalY },
      right: { x: point.x - normalX, y: point.y - normalY }
    };
  });
  return pointsPath([...sides.map(entry => entry.left), ...sides.map(entry => entry.right).reverse()], true);
}

function taperedRingMarkup(ring) {
  const arcs = ring.groups.map(group => `<path class="gizmo-visible rotate-ring" d="${taperedRingPath(group)}"/>`).join('');
  if (!ring.handle) return arcs;
  const tangent = [ring.handle.tangentX, ring.handle.tangentY];
  const normal = [-tangent[1], tangent[0]];
  const diamond = [
    { x: ring.handle.x - tangent[0] * 15, y: ring.handle.y - tangent[1] * 15 },
    { x: ring.handle.x + normal[0] * 5, y: ring.handle.y + normal[1] * 5 },
    { x: ring.handle.x + tangent[0] * 15, y: ring.handle.y + tangent[1] * 15 },
    { x: ring.handle.x - normal[0] * 5, y: ring.handle.y - normal[1] * 5 }
  ];
  return `${arcs}<path class="gizmo-visible rotate-handle" d="${pointsPath(diamond, true)}"/>
    <circle class="gizmo-hit-point rotate-handle-hit" cx="${ring.handle.x}" cy="${ring.handle.y}" r="18"/>`;
}

function cameraRingGeometry(origin, radius, cameraFrame) {
  const points = Array.from({ length: 97 }, (_, step) => {
    const angle = step / 96 * Math.PI * 2;
    let point = addScaled3(origin, cameraFrame.right, Math.cos(angle) * radius);
    point = addScaled3(point, cameraFrame.up, Math.sin(angle) * radius);
    return projectViewportPoint(point);
  });
  return { path: pointsPath(points, true), points };
}

function infiniteGuideMarkup(handle, width, height, axisClass) {
  return finiteWorldGuideMarkup(state.gizmoOrigin, handle.vector, `drag-infinite-line ${axisClass}`);
}

function renderVertexSnapGizmo(gizmo, width, height) {
  const item = selected();
  const points = [];
  const generatedSourceUids = item.type === 'group'
    ? state.project.getDescendantElementUids(item.uid) : [item.uid];
  for (const vertex of [...sceneRenderer.getWorldVertices(state.project, item.uid),
    ...generatedSourceUids.flatMap(uidValue => sceneRenderer.getGeneratedWorldVertices(uidValue))]) {
    const projected = projectViewportPoint(vertex.point);
    if (projected.behind || projected.x < -12 || projected.y < -12 || projected.x > width + 12 || projected.y > height + 12) continue;
    points.push({ ...vertex, pointType: 'vertex', projected });
  }
  if (isBezierElement(item)) {
    for (const entry of sceneRenderer.getCurveNodeWorldPoints(state.project, item.uid)) {
      const projected = projectViewportPoint(entry.point);
      if (projected.behind || projected.x < -12 || projected.y < -12 || projected.x > width + 12 || projected.y > height + 12) continue;
      points.push({ uid: item.uid, nodeIndex: entry.index, point: entry.point, pointType: 'curveNode', projected });
    }
  }
  if (state.vertexSnapMode === 'move' && (['cube', 'group'].includes(item.type) || isShapeElement(item))) {
    const pivotPoint = getTransformPivot(item);
    const projected = projectViewportPoint(pivotPoint);
    if (!projected.behind && projected.x >= -14 && projected.y >= -14 && projected.x <= width + 14 && projected.y <= height + 14) {
      points.push({ uid: item.uid, point: pivotPoint, pointType: 'pivot', projected });
    }
  }
  if (state.vertexSnapIntersections) {
    const cacheValid = vertexSnapIntersectionCache?.project === state.project
      && vertexSnapIntersectionCache.uid === item.uid
      && vertexSnapIntersectionCache.staticCache === sceneRenderer.staticCache
      && vertexSnapIntersectionCache.selectedCache === sceneRenderer.selectedCache
      && vertexSnapIntersectionCache.mirrorCache === sceneRenderer.mirrorCache
      && vertexSnapIntersectionCache.modifierResultGhost === state.modifierResultGhost
      && vertexSnapIntersectionCache.geometryRevision === sceneRenderer.geometryRevision
      && vertexSnapIntersectionCache.selectionRevision === sceneRenderer.selectionRevision;
    if (!cacheValid) {
      const geometry = sceneRenderer.getVertexSnapIntersectionGeometry(state.project, item.uid);
      vertexSnapIntersectionCache = {
        project: state.project, uid: item.uid,
        staticCache: sceneRenderer.staticCache, selectedCache: sceneRenderer.selectedCache,
        mirrorCache: sceneRenderer.mirrorCache, modifierResultGhost: state.modifierResultGhost,
        geometryRevision: sceneRenderer.geometryRevision, selectionRevision: sceneRenderer.selectionRevision,
        points: findVertexSnapIntersections(geometry.sourceCubes, geometry.targetCubes, geometry.targetQuads)
      };
    }
    for (const point of vertexSnapIntersectionCache.points) {
      const projected = projectViewportPoint(point);
      if (projected.behind || projected.x < -12 || projected.y < -12 || projected.x > width + 12 || projected.y > height + 12) continue;
      points.push({ uid: item.uid, point, pointType: 'intersection', targetOnly: true, projected });
    }
  }
  points.sort((left, right) => right.projected.depth - left.projected.depth);
  state.vertexSnapPoints = points;
  gizmo.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const pointMarkup = points.map((entry, index) => {
    const sourceActive = state.vertexSnapSource?.uid === entry.uid
      && state.vertexSnapSource.pointType === entry.pointType
      && state.vertexSnapSource.nodeIndex === entry.nodeIndex
      && state.vertexSnapSource.point.every((value, axis) => Math.abs(value - entry.point[axis]) < 1e-5);
    const classes = ['gizmo-control', 'vertex-snap-control', entry.targetOnly ? 'target-only' : 'source-candidate', entry.generated ? 'generated-reference' : '', sourceActive ? 'source-active' : ''].filter(Boolean).join(' ');
    if (entry.pointType === 'intersection') return `<g class="${classes}" data-kind="vertex" data-vertex-index="${index}" ${gizmoDepthAttributes('point', [entry.projected])}>
      <title>線線／線面交點 · 僅可作目標點</title>
      <circle class="gizmo-hit-point" cx="${entry.projected.x}" cy="${entry.projected.y}" r="13"/>
      <path class="gizmo-visible vertex-snap-intersection" d="M${entry.projected.x},${entry.projected.y - 6} L${entry.projected.x + 6},${entry.projected.y} L${entry.projected.x},${entry.projected.y + 6} L${entry.projected.x - 6},${entry.projected.y} Z"/>
    </g>`;
    if (entry.pointType === 'pivot') return `<g class="${classes} vertex-snap-pivot-control pivot-marker" data-kind="vertex" data-vertex-index="${index}" ${gizmoDepthAttributes('point', [entry.projected], 'front')}>
      <circle class="gizmo-hit-point" cx="${entry.projected.x}" cy="${entry.projected.y}" r="17"/>
      <path class="gizmo-visible pivot-marker-ring" d="M${entry.projected.x},${entry.projected.y - 11} L${entry.projected.x + 11},${entry.projected.y} L${entry.projected.x},${entry.projected.y + 11} L${entry.projected.x - 11},${entry.projected.y} Z"/>
      <path class="gizmo-visible pivot-marker-cross" d="M${entry.projected.x - 15},${entry.projected.y} H${entry.projected.x + 15} M${entry.projected.x},${entry.projected.y - 15} V${entry.projected.y + 15}"/>
      <circle class="gizmo-visible pivot-marker-core" cx="${entry.projected.x}" cy="${entry.projected.y}" r="3.5"/>
    </g>`;
    return `<g class="${classes}" data-kind="vertex" data-vertex-index="${index}" ${gizmoDepthAttributes('point', [entry.projected])}>
      <circle class="gizmo-hit-point" cx="${entry.projected.x}" cy="${entry.projected.y}" r="13"/>
      <circle class="gizmo-visible vertex-snap-point" cx="${entry.projected.x}" cy="${entry.projected.y}" r="5"/>
    </g>`;
  }).join('');
  let sourceMarkup = '';
  if (state.vertexSnapSource && state.vertexSnapSource.rootUid !== item.uid) {
    const source = projectViewportPoint(state.vertexSnapSource.point);
    if (!source.behind && state.vertexSnapSource.pointType === 'pivot') sourceMarkup = `<g class="pivot-marker vertex-snap-source-pivot">
      <path class="pivot-marker-ring" d="M${source.x},${source.y - 11} L${source.x + 11},${source.y} L${source.x},${source.y + 11} L${source.x - 11},${source.y} Z"/>
      <path class="pivot-marker-cross" d="M${source.x - 15},${source.y} H${source.x + 15} M${source.x},${source.y - 15} V${source.y + 15}"/>
      <circle class="pivot-marker-core" cx="${source.x}" cy="${source.y}" r="3.5"/>
    </g>`;
    else if (!source.behind) sourceMarkup = `<path class="vertex-snap-source-marker" d="M${source.x},${source.y - 9} L${source.x + 9},${source.y} L${source.x},${source.y + 9} L${source.x - 9},${source.y} Z"/>`;
  }
  gizmo.innerHTML = pointMarkup + sourceMarkup;
  sortGizmoControlsByDepth(gizmo);
  gizmo.removeAttribute('hidden');
}

function renderRotationPivotVertices(gizmo, width, height, selectionContext, item) {
  const target = selectionContext.multiple ? selectionContext.commonGroup : item;
  if (!target || !(['cube', 'group'].includes(target.type) || isShapeElement(target))) {
    state.rotationPivotVertices = [];
    gizmo.setAttribute('hidden', '');
    gizmo.innerHTML = '';
    return;
  }
  const vertices = sceneRenderer.getWorldVertices(state.project, target.uid)
    .map(entry => ({ ...entry, targetUid: target.uid, projected: projectViewportPoint(entry.point) }))
    .filter(entry => !entry.projected.behind && entry.projected.x >= -13 && entry.projected.y >= -13
      && entry.projected.x <= width + 13 && entry.projected.y <= height + 13)
    .sort((left, right) => right.projected.depth - left.projected.depth);
  state.rotationPivotVertices = vertices;
  gizmo.setAttribute('viewBox', `0 0 ${width} ${height}`);
  gizmo.innerHTML = vertices.map((entry, index) => `<g class="gizmo-control rotation-pivot-vertex" data-kind="rotation-pivot-vertex"
      data-vertex-index="${index}" ${gizmoDepthAttributes('point', [entry.projected])}>
      <circle class="gizmo-hit-point" cx="${entry.projected.x}" cy="${entry.projected.y}" r="14"/>
      <path class="gizmo-visible rotation-pivot-vertex-mark" d="M${entry.projected.x},${entry.projected.y - 6}
        L${entry.projected.x + 6},${entry.projected.y} L${entry.projected.x},${entry.projected.y + 6}
        L${entry.projected.x - 6},${entry.projected.y} Z"/>
    </g>`).join('');
  sortGizmoControlsByDepth(gizmo);
  gizmo.toggleAttribute('hidden', vertices.length === 0);
}

function updateTransformGizmo() {
  const gizmo = $('#transformGizmo');
  state.rotationPivotVertices = [];
  if (state.mode === 'paint') {
    state.gizmoAxes = null; state.gizmoCenter = null; state.gizmoOrigin = null;
    gizmo.setAttribute('hidden', '');
    gizmo.innerHTML = '';
    return;
  }
  const item = selected();
  const rect = sceneCanvas.getBoundingClientRect();
  const width = rect.width, height = rect.height;
  const curveOverlay = curveEditorOverlayMarkup(item);
  const symmetryEntry = selectedMirrorGuideGroup();
  const modifierAnchorContext = activeModifierAnchorContext();
  const modifierAnchorMarker = symmetryEntry
    ? modifierAnchorMarkerMarkup(symmetryEntry, modifierAnchorContext?.modifier.uid === symmetryEntry.modifier.uid)
    : '';
  const editorOverlay = curveOverlay + modifierAnchorMarker;
  if (!item || isEffectivelyLocked(item.uid) || !['move', 'resize', 'rotate', 'pivot', 'vertexSnap'].includes(state.tool)) {
    state.gizmoAxes = null; state.gizmoCenter = null; state.gizmoOrigin = null;
    if (editorOverlay && item && !isEffectivelyLocked(item.uid)) {
      gizmo.setAttribute('viewBox', `0 0 ${width} ${height}`);
      gizmo.innerHTML = editorOverlay;
      gizmo.removeAttribute('hidden');
    } else { gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; }
    return;
  }
  const curveNodeContext = activeCurveNodeContext();
  const selectionContext = getSelectionTransformContext();
  if (state.tool === 'rotate' && state.rotationVertexPick) {
    state.gizmoAxes = null; state.gizmoCenter = null; state.gizmoOrigin = null;
    renderRotationPivotVertices(gizmo, width, height, selectionContext, item);
    return;
  }
  if (state.tool === 'resize' && (modifierAnchorContext || curveNodeContext || (!selectionContext.multiple && !['cube', 'group'].includes(item.type) && !isShapeElement(item)))) {
    state.gizmoAxes = null; state.gizmoCenter = null; state.gizmoOrigin = null;
    if (editorOverlay) {
      gizmo.setAttribute('viewBox', `0 0 ${width} ${height}`);
      gizmo.innerHTML = editorOverlay;
      gizmo.removeAttribute('hidden');
    } else { gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; }
    return;
  }
  if (state.tool === 'vertexSnap') {
    renderVertexSnapGizmo(gizmo, width, height);
    gizmo.insertAdjacentHTML('beforeend', editorOverlay);
    return;
  }
  const transformItem = item;
  if (state.tool === 'pivot' && !modifierAnchorContext && !curveNodeContext
    && !['cube', 'group', 'node'].includes(transformItem?.type) && !isShapeElement(transformItem)) {
    gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; return;
  }
  const modifierFrame = modifierAnchorContext
    ? mirrorControllerWorldFrame(modifierAnchorContext.owner, modifierAnchorContext.modifier)
    : null;
  const pivot = modifierFrame?.origin || (curveNodeContext
    ? sceneRenderer.getCurveNodeWorldPoints(state.project, item.uid)[curveNodeContext.index]?.point
    : selectionContext.multiple ? selectionContext.pivot : getTransformPivot(item));
  const geometryCenter = modifierAnchorContext || curveNodeContext ? pivot : selectionContext.multiple
    ? selectionContext.center || pivot
    : sceneRenderer.getSelectionBounds(state.project, state.selectedUids)?.center
      || sceneRenderer.getGeometryCenter(state.project, item.uid)
      || pivot;
  const gizmoOrigin = modifierAnchorContext || curveNodeContext || item.type === 'node' || ['rotate', 'pivot'].includes(state.tool) ? pivot : geometryCenter;
  const center = projectViewportPoint(gizmoOrigin);
  state.gizmoCenter = { x: center.x, y: center.y };
  state.gizmoOrigin = [...gizmoOrigin];
  const axes = modifierAnchorContext ? getModifierAnchorTransformAxes(modifierAnchorContext)
    : curveNodeContext ? getCurveNodeTransformAxes(curveNodeContext)
      : getSelectionTransformAxes(selectionContext, item);
  const classes = ['x', 'y', 'z'];
  const cameraFrame = sceneRenderer.getCameraFrame();
  const pixelSample = projectViewportPoint(addScaled3(gizmoOrigin, cameraFrame.right, 1));
  const pixelWorld = 1 / Math.max(.0001, Math.hypot(pixelSample.x - center.x, pixelSample.y - center.y));
  const relativeAxisLength = pixelWorld * GIZMO_AXIS_PIXELS;
  const handles = axes.map((axis, index) => {
    const unitPoint = projectViewportPoint(addScaled3(gizmoOrigin, axis, 1));
    const pixelsPerUnit = Math.hypot(unitPoint.x - center.x, unitPoint.y - center.y);
    const screenDelta = [unitPoint.x - center.x, -(unitPoint.y - center.y), 0];
    const screen = Math.hypot(screenDelta[0], screenDelta[1]) > 1
      ? normalize3(screenDelta)
      : index === 1 ? [0, 1, 0] : [1, 0, 0];
    let positiveDistance = relativeAxisLength, negativeDistance = relativeAxisLength;
    if (state.tool === 'resize' && state.scaleHandleMode === 'bounds') {
      let extent;
      if (selectionContext.multiple || item.type === 'group') {
        extent = sceneRenderer.getSelectionProjectionExtent(state.project, state.selectedUids, gizmoOrigin, axis) ?? 0;
      } else extent = item.type === 'cube'
        ? Math.abs(item.size[index]) / 2
        : item.shapeType !== 'polygon_prism' || index !== 1
          ? Math.abs(item.parameters.radius)
          : Math.abs(item.parameters.height) / 2;
      positiveDistance = extent + pixelWorld * GIZMO_HEAD_GAP_PIXELS;
      negativeDistance = positiveDistance;
    }
    return { axis: index, vector: axis, screen, screenPerWorld: screenDelta.slice(0, 2), positiveDistance, negativeDistance,
      basisU: axes[(index + 1) % 3], basisV: axes[(index + 2) % 3],
      worldPerPixel: 1 / Math.max(pixelsPerUnit, .0001) };
  });
  state.gizmoAxes = handles.map(handle => ({ ...handle, centerX: center.x, centerY: center.y }));
  gizmo.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (state.tool === 'rotate') {
    const pixelsPerUnit = 1 / pixelWorld;
    const radius = 87 / pixelsPerUnit;
    const sphere = cameraRingGeometry(gizmoOrigin, radius, cameraFrame);
    const layeredEulerRings = state.transformSpace === 'self' && state.rotationMode === 'euler';
    const rotationHandles = curveNodeContext?.curve.dimension === 2
      ? handles.filter(handle => handle.axis === 1)
      : handles;
    const rings = rotationHandles.map(handle => {
      const ringScale = layeredEulerRings ? EULER_RING_RADIUS_SCALES[handle.axis] : .965;
      const ring = frontRingGeometry(gizmoOrigin, handle.vector, radius * ringScale, cameraFrame);
      return `<g class="gizmo-control axis-${classes[handle.axis]}" data-axis="${handle.axis}" data-kind="rotate" ${gizmoDepthAttributes('polyline', ring.groups)}>
        <path class="gizmo-hit rotate-hit" d="${ring.path}"/>${taperedRingMarkup(ring)}
      </g>`;
    }).join('');
    const viewRing = curveNodeContext?.curve.dimension === 2 ? '' : `<g class="gizmo-control sphere-control" data-axis="view" data-kind="rotate-view" ${gizmoDepthAttributes('polyline', sphere.points)}>
      <path class="gizmo-hit rotate-hit" d="${sphere.path}"/><path class="gizmo-visible rotation-sphere" d="${sphere.path}"/>
    </g>`;
    gizmo.innerHTML = `${viewRing}${rings}<circle class="gizmo-visible rotation-pivot" cx="${center.x}" cy="${center.y}" r="5"/>`;
  } else if (state.tool === 'move' || state.tool === 'pivot') {
    const planes = GIZMO_PLANES.map(plane => planeMarkup(handles, gizmoOrigin, plane, pixelWorld)).join('');
    gizmo.innerHTML = `${planes}${handles.map(handle => coneMarkup({ ...handle, centerX: center.x, centerY: center.y }, gizmoOrigin, `axis-${classes[handle.axis]}`, pixelWorld)).join('')}
      ${centerCubeMarkup(gizmoOrigin, axes, pixelWorld, { axisKey: 'free', kind: 'free', className: 'center-control' })}
      ${state.tool === 'pivot' && !curveNodeContext && item.type !== 'node' ? pivotMarkerMarkup(gizmoOrigin) : ''}`;
  } else {
    const toCamera = cameraFrame.projection === 'perspective'
      ? normalize3(cameraFrame.eye.map((value, component) => value - gizmoOrigin[component]))
      : cameraFrame.forward.map(value => -value);
    const closestSigns = handles.map(handle => dot3(handle.vector, toCamera) >= 0 ? 1 : -1);
    const planes = GIZMO_PLANES.map(plane => planeMarkup(handles, gizmoOrigin, plane, pixelWorld,
      plane.axes.map(axisIndex => closestSigns[axisIndex]))).join('');
    const planeCorners = GIZMO_PLANES.map(plane => planeScaleCornerMarkup(handles, gizmoOrigin, plane, pixelWorld,
      plane.axes.map(axisIndex => closestSigns[axisIndex]))).join('');
    const axesMarkup = handles.flatMap(handle => [-1, 1].map(sign => prismMarkup({ ...handle, centerX: center.x, centerY: center.y }, gizmoOrigin, `axis-${classes[handle.axis]}`, pixelWorld, sign))).join('');
    gizmo.innerHTML = `${planes}${axesMarkup}${planeCorners}${centerCubeMarkup(gizmoOrigin, axes, pixelWorld)}`;
  }
  sortGizmoControlsByDepth(gizmo);
  if (state.dragging?.type === 'transform' && ['move', 'resize', 'pivot'].includes(state.dragging.tool)) {
    const guideAxes = state.dragging.kind.startsWith('plane')
      ? state.dragging.axisIndices
      : state.dragging.axisIndex === null ? [] : [state.dragging.axisIndex];
    const guides = guideAxes.map(axisIndex => infiniteGuideMarkup(state.gizmoAxes[axisIndex], width, height, `axis-${classes[axisIndex]}`)).join('');
    gizmo.innerHTML = guides + gizmo.innerHTML;
  }
  if (state.dragging?.type === 'transform') {
    const axis = state.dragging.axisKey;
    const sign = state.dragging.axisIndex === null ? '' : `[data-sign="${state.dragging.sign}"]`;
    const active = gizmo.querySelector(`[data-axis="${axis}"]${sign}`) || gizmo.querySelector(`[data-axis="${axis}"]`);
    active?.classList.add('active');
    state.dragging.handleElement = active;
  }
  gizmo.insertAdjacentHTML('beforeend', editorOverlay);
  gizmo.removeAttribute('hidden');
}
return {
  addScaled3, intersectRayPlane, projectViewportPoint,
  resolveGizmoHandle, updateGizmoDepthHover, updateTransformGizmo
};
}
