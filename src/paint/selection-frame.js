export const HANDLE_SIZE = 16;
export const selectionHandleIcons = ['scale', 'rotate'].map(kind =>
  new URL(`../assets/ui-icons/selection-${kind}.svg`, import.meta.url).href);

// Lay out the handle squares on the same plane as the frame, then project
// all four vertices. A single screen-space rotation cannot do this in perspective.
export function projectSelectionFrame(corners, project) {
  const points = corners.map(project);
  if (points.some(point => !point)) return null;
  const edges = [1, 3].map(index => corners[index].map((value, axis) => value - corners[0][axis]));
  const lengths = edges.map(edge => Math.hypot(...edge));
  if (lengths.includes(0)) return null;
  const axes = edges.map((edge, index) => edge.map(value => value / lengths[index]));
  const probe = Math.min(1, lengths[0] * .02, lengths[1] * .02);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const pixels = Math.min(HANDLE_SIZE, distance(points[0], points[1]) * .65, distance(points[0], points[3]) * .65);
  const handles = corners.map((center, index) => {
    const projectedAxes = axes.map(axis => project(center.map((value, i) => value + axis[i] * probe)));
    if (projectedAxes.includes(null)) return null;
    const density = Math.max(...projectedAxes.map(point => distance(point, points[index]))) / probe;
    if (density < 1e-6) return null;
    const half = pixels / density / 2;
    const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) =>
      project(center.map((value, i) => value + half * (axes[0][i] * x + axes[1][i] * y))));
    return quad.includes(null) ? null : quad;
  });
  return { points, handles };
}

// A homography maps the SVG's square to the perspective-projected plane quad.
export function selectionHandleProjection([a, b, c, d]) {
  const bx = b[0] - c[0], by = b[1] - c[1], dx = d[0] - c[0], dy = d[1] - c[1];
  const ex = a[0] - b[0] + c[0] - d[0], ey = a[1] - b[1] + c[1] - d[1];
  const determinant = bx * dy - dx * by;
  if (Math.abs(determinant) < 1e-8) return null;
  const g = (ex * dy - dx * ey) / determinant, h = (bx * ey - ex * by) / determinant;
  const s = HANDLE_SIZE;
  return [(b[0] - a[0] + g * b[0]) / s, (b[1] - a[1] + g * b[1]) / s, 0, g / s,
    (d[0] - a[0] + h * d[0]) / s, (d[1] - a[1] + h * d[1]) / s, 0, h / s,
    0, 0, 1, 0, a[0], a[1], 0, 1];
}
