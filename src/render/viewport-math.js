// Camera projection, picking and column-major transforms used by WebGL.

export const DEG = Math.PI / 180;

const LOCATOR_ICON_PIXELS = 17;

const LOCATOR_NEAR_DISTANCE = 72;

const LOCATOR_MAX_PIXELS = 96;

export function buildCameraState(camera, aspect, width, height) {
  const pitch = clamp(camera.pitch, -Math.PI / 2 + .001, Math.PI / 2 - .001);
  const distance = camera.projection === 'perspective' ? 42 / camera.zoom : 4096;
  const baseTarget = camera.target || [0, 9, 0];
  const direction = [Math.sin(camera.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(camera.yaw) * Math.cos(pitch)];
  const preliminaryEye = add(baseTarget, scale(direction, distance));
  const forward = normalize(subtract(baseTarget, preliminaryEye));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = normalize(cross(right, forward));
  const worldPerPixel = camera.projection === 'perspective'
    ? 2 * distance * Math.tan(45 * DEG / 2) / height
    : 36 / (height * camera.zoom);
  const pan = add(scale(right, -camera.panX * worldPerPixel), scale(up, camera.panY * worldPerPixel));
  const target = add(baseTarget, pan);
  const eye = add(preliminaryEye, pan);
  const view = lookAt(eye, target, [0, 1, 0]);
  const projection = camera.projection === 'perspective'
    ? perspective(45 * DEG, aspect, .05, 30000)
    : orthographic(-18 * aspect / camera.zoom, 18 * aspect / camera.zoom, -18 / camera.zoom, 18 / camera.zoom, -30000, 30000);
  return {
    matrix: multiply(projection, view),
    eye,
    target,
    forward,
    right,
    up,
    worldPerPixel,
    projection: camera.projection
  };
}

export function projectScreenPoint(point, matrix, width, height) {
  const clip = transform(matrix, [...point, 1]);
  const w = clip[3] || .00001;
  return {
    x: (clip[0] / w * .5 + .5) * width,
    y: (1 - (clip[1] / w * .5 + .5)) * height,
    depth: clip[2] / w,
    behind: w < 0
  };
}

export function screenRay(screenX, screenY, viewport, cameraState, camera) {
  const ndcX = screenX / viewport.width * 2 - 1;
  const ndcY = 1 - screenY / viewport.height * 2;
  const aspect = viewport.width / viewport.height;
  if (cameraState.projection === 'perspective') {
    const halfFovTangent = Math.tan(45 * DEG / 2);
    const direction = normalize(add(cameraState.forward,
      add(scale(cameraState.right, ndcX * aspect * halfFovTangent), scale(cameraState.up, ndcY * halfFovTangent))));
    return { origin: cameraState.eye, direction };
  }
  const halfHeight = 18 / camera.zoom;
  const origin = add(cameraState.eye,
    add(scale(cameraState.right, ndcX * halfHeight * aspect), scale(cameraState.up, ndcY * halfHeight)));
  return { origin, direction: cameraState.forward };
}

export function rayTriangleDistance(origin, direction, a, b, c) {
  const epsilon = 1e-7;
  const edge1 = subtract(b, a), edge2 = subtract(c, a);
  const p = cross(direction, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) < epsilon) return null;
  const inverse = 1 / determinant;
  const fromA = subtract(origin, a);
  const u = dot(fromA, p) * inverse;
  if (u < 0 || u > 1) return null;
  const q = cross(fromA, edge1);
  const v = dot(direction, q) * inverse;
  if (v < 0 || u + v > 1) return null;
  const distance = dot(edge2, q) * inverse;
  return distance > epsilon ? distance : null;
}

export function screenBounds(points, matrix, width, height) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const point of points) {
    const projected = projectScreenPoint(point, matrix, width, height);
    if (projected.behind) continue;
    if (projected.x < x1) x1 = projected.x;
    if (projected.y < y1) y1 = projected.y;
    if (projected.x > x2) x2 = projected.x;
    if (projected.y > y2) y2 = projected.y;
  }
  return x1 === Infinity ? { x1: -1, y1: -1, x2: -1, y2: -1 } : { x1, y1, x2, y2 };
}

export function normalizeScreenRect(rect) {
  return {
    x1: Math.min(rect.x1, rect.x2),
    y1: Math.min(rect.y1, rect.y2),
    x2: Math.max(rect.x1, rect.x2),
    y2: Math.max(rect.y1, rect.y2)
  };
}

function screenPointInRect(point, rect) {
  return point.x >= rect.x1 && point.x <= rect.x2 && point.y >= rect.y1 && point.y <= rect.y2;
}

function screenSegmentIntersectsRect(first, second, rect) {
  if (screenPointInRect(first, rect) || screenPointInRect(second, rect)) return true;
  const dx = second.x - first.x, dy = second.y - first.y;
  let start = 0, end = 1;
  for (const [p, q] of [[-dx, first.x - rect.x1], [dx, rect.x2 - first.x], [-dy, first.y - rect.y1], [dy, rect.y2 - first.y]]) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) start = Math.max(start, ratio);
    else end = Math.min(end, ratio);
    if (start > end) return false;
  }
  return true;
}

function screenPointInPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current], b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function screenPolygonIntersectsRect(points, screenRect) {
  const polygon = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!polygon.length) return false;
  const rect = normalizeScreenRect(screenRect);
  if (polygon.some(point => screenPointInRect(point, rect))) return true;
  if (polygon.length >= 3 && [
    { x: rect.x1, y: rect.y1 }, { x: rect.x2, y: rect.y1 },
    { x: rect.x2, y: rect.y2 }, { x: rect.x1, y: rect.y2 }
  ].some(point => screenPointInPolygon(point, polygon))) return true;
  const edgeCount = polygon.length === 2 ? 1 : polygon.length;
  for (let index = 0; index < edgeCount; index++) {
    if (screenSegmentIntersectsRect(polygon[index], polygon[(index + 1) % polygon.length], rect)) return true;
  }
  return false;
}

export function averagePoints(points) {
  return points.reduce((sum, point) => add(sum, point), [0, 0, 0]).map(value => value / (points.length || 1));
}

function cameraDepth(point, cameraState) { return dot(subtract(point, cameraState.eye), cameraState.forward); }

export function locatorScreenSize(point, cameraState) {
  if (!cameraState || cameraState.projection !== 'perspective') return LOCATOR_ICON_PIXELS;
  const distance = Math.max(.05, cameraDepth(point, cameraState));
  if (distance >= LOCATOR_NEAR_DISTANCE) return LOCATOR_ICON_PIXELS;
  return Math.min(LOCATOR_MAX_PIXELS, LOCATOR_ICON_PIXELS * LOCATOR_NEAR_DISTANCE / distance);
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

export function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

export function scale(v, amount) { return [v[0] * amount, v[1] * amount, v[2] * amount]; }

export function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

export function normalize(v) {
  const length = Math.hypot(...v) || 1;
  return scale(v, 1 / length);
}

export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

function mirrorModelMatrix(matrix, center) {
  const transformedCenter = matrix.map(row => row[0] * center[0] + row[1] * center[1] + row[2] * center[2]);
  const translation = center.map((value, axis) => value - transformedCenter[axis]);
  return [
    matrix[0][0], matrix[1][0], matrix[2][0], 0,
    matrix[0][1], matrix[1][1], matrix[2][1], 0,
    matrix[0][2], matrix[1][2], matrix[2][2], 0,
    translation[0], translation[1], translation[2], 1
  ];
}

export function modifierModelMatrix(matrix, translation, center = [0, 0, 0]) {
  if (!Array.isArray(translation)) return mirrorModelMatrix(matrix, center);
  return [
    matrix[0][0], matrix[1][0], matrix[2][0], 0,
    matrix[0][1], matrix[1][1], matrix[2][1], 0,
    matrix[0][2], matrix[1][2], matrix[2][2], 0,
    translation[0], translation[1], translation[2], 1
  ];
}

export function modifierInstancePoint(instance, point) {
  return instance.matrix.map((row, axis) =>
    row[0] * point[0] + row[1] * point[1] + row[2] * point[2] + instance.translation[axis]);
}

export function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  }
  return out;
}

export function scaleAroundPoint(center, factor) {
  return [factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, factor, 0,
    center[0] * (1 - factor), center[1] * (1 - factor), center[2] * (1 - factor), 1];
}

export function transform(matrix, vector) {
  return [0, 1, 2, 3].map(row => matrix[row] * vector[0] + matrix[4 + row] * vector[1] + matrix[8 + row] * vector[2] + matrix[12 + row] * vector[3]);
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), range = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * range, -1, 0, 0, 2 * far * near * range, 0];
}

function orthographic(left, right, bottom, top, near, far) {
  return [2 / (right - left), 0, 0, 0, 0, 2 / (top - bottom), 0, 0, 0, 0, -2 / (far - near), 0, -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1];
}

function lookAt(eye, target, up) {
  const z = normalize(subtract(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}
