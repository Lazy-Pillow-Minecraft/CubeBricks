import { faceTilingValues } from '../common/core/face-tiling.js';
import { dot3 } from '../utils/math/vector3.js';

// Keep geometry in the face's continuous texel plane. Reducing endpoints to
// one texture period before rasterizing changes shapes that cross a tile seam.
export function tiledFacePaintCoordinates(hit, cube, faceName) {
  const origin = hit.facePoints[0];
  const uAxis = hit.facePoints[1].map((value, axis) => value - origin[axis]);
  const vAxis = hit.facePoints[2].map((value, axis) => value - origin[axis]);
  const offset = hit.point.map((value, axis) => value - origin[axis]);
  const [offsetX, offsetY, width, height] = faceTilingValues(cube.faces?.[faceName]);
  const uu = dot3(uAxis, uAxis), uv = dot3(uAxis, vAxis), vv = dot3(vAxis, vAxis);
  const determinant = uu * vv - uv * uv;
  if (Math.abs(determinant) < 1e-12) return null;
  const u = (dot3(offset, uAxis) * vv - dot3(offset, vAxis) * uv) / determinant;
  const v = (dot3(offset, vAxis) * uu - dot3(offset, uAxis) * uv) / determinant;
  return [offsetX + u * width, offsetY + v * height];
}

export function tiledFacePaintPoint(hit, cube, faceName, canvas, wrap = true) {
  const coordinates = tiledFacePaintCoordinates(hit, cube, faceName);
  if (!coordinates) return null;
  const point = coordinates.map(Math.floor);
  return wrap ? point.map((value, axis) => {
    const period = axis ? canvas.height : canvas.width;
    return ((value % period) + period) % period;
  }) : point;
}

export function tiledFacePaintBounds(cube, faceName) {
  const [offsetX, offsetY, width, height] = faceTilingValues(cube.faces?.[faceName]);
  return {
    minU: Math.floor(offsetX), minV: Math.floor(offsetY),
    maxU: Math.ceil(offsetX + width), maxV: Math.ceil(offsetY + height)
  };
}
