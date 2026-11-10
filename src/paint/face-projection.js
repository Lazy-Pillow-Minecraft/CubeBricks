import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv } from '../common/core/geometry-utils.js';
import { barycentric2d } from '../screen/color-picker/math.js';
import { dot3 } from '../utils/math/vector3.js';
import { tiledFacePaintCoordinates, tiledFacePaintPoint } from './tiled-face.js';

// Map between world-space face quads and editable texture pixels. Tiled
// strokes can keep unwrapped coordinates to cross a repeat boundary.
export function createPaintFaceProjection({
  state, textureCanvas, textureAssetForReference, isFaceTiled, animationRasterCache
}) {
  function barycentricPoint(point, a, b, c) {
    const v0 = b.map((value, axis) => value - a[axis]);
    const v1 = c.map((value, axis) => value - a[axis]);
    const v2 = point.map((value, axis) => value - a[axis]);
    const d00 = dot3(v0, v0), d01 = dot3(v0, v1), d11 = dot3(v1, v1);
    const d20 = dot3(v2, v0), d21 = dot3(v2, v1);
    const denominator = d00 * d11 - d01 * d01;
    if (Math.abs(denominator) < 1e-10) return null;
    const second = (d11 * d20 - d01 * d21) / denominator;
    const third = (d00 * d21 - d01 * d20) / denominator;
    const first = 1 - second - third;
    return first >= -1e-4 && second >= -1e-4 && third >= -1e-4 ? [first, second, third] : null;
  }

  function facePaintUvPoint(hit, target, canvas, wrapTiled = true) {
    if (!hit?.point || !hit.facePoints?.length || !target || !canvas) return null;
    const face = target.cube.faces?.[target.faceName] || {};
    if (isFaceTiled(face)) {
      return tiledFacePaintPoint(hit, target.cube, target.faceName, canvas, wrapTiled);
    }
    const rectangle = target.cube.uvMode !== 'box' && Array.isArray(face.uv) && face.uv.length >= 4
      ? face.uv
      : getBlockbenchBoxUv(target.cube, target.faceName);
    if (!rectangle) return null;
    const slots = createBlockbenchFaceUvSlots(rectangle, face.rotation || 0);
    const scaleU = canvas.width / Math.max(1, target.asset?.uvWidth || canvas.width);
    const scaleV = canvas.height / Math.max(1, target.asset?.uvHeight || canvas.height);
    const limits = [
      [Math.floor(Math.min(rectangle[0], rectangle[2]) * scaleU),
      Math.ceil(Math.max(rectangle[0], rectangle[2]) * scaleU) - 1],
      [Math.floor(Math.min(rectangle[1], rectangle[3]) * scaleV),
      Math.ceil(Math.max(rectangle[1], rectangle[3]) * scaleV) - 1]
    ];
    const triangles = [[0, 2, 1], [2, 3, 1]];
    for (const indices of triangles) {
      const weights = barycentricPoint(hit.point,
        hit.facePoints[indices[0]], hit.facePoints[indices[1]], hit.facePoints[indices[2]]);
      if (!weights) continue;
      const uv = [0, 1].map(axis => indices.reduce((sum, slot, index) => sum + slots[slot][axis] * weights[index], 0));
      const point = [Math.max(limits[0][0], Math.min(limits[0][1], Math.floor(uv[0] * scaleU))),
      Math.max(limits[1][0], Math.min(limits[1][1], Math.floor(uv[1] * scaleV)))];
      if (point[0] >= 0 && point[1] >= 0 && point[0] < canvas.width && point[1] < canvas.height) return point;
    }
    return null;
  }

  function facePaintUvContinuous(hit, target, canvas) {
    if (!hit?.point || hit.facePoints?.length !== 4 || !target || !canvas) return null;
    const face = target.cube.faces?.[target.faceName] || {};
    if (isFaceTiled(face)) return tiledFacePaintCoordinates(hit, target.cube, target.faceName);
    const rectangle = target.cube.uvMode !== 'box' && Array.isArray(face.uv) && face.uv.length >= 4
      ? face.uv : getBlockbenchBoxUv(target.cube, target.faceName);
    if (!rectangle) return null;
    const slots = createBlockbenchFaceUvSlots(rectangle, face.rotation || 0);
    const origin = hit.facePoints[0];
    const uAxis = hit.facePoints[1].map((value, axis) => value - origin[axis]);
    const vAxis = hit.facePoints[2].map((value, axis) => value - origin[axis]);
    const offset = hit.point.map((value, axis) => value - origin[axis]);
    const uu = dot3(uAxis, uAxis), uv = dot3(uAxis, vAxis), vv = dot3(vAxis, vAxis);
    const determinant = uu * vv - uv * uv;
    if (Math.abs(determinant) < 1e-12) return null;
    const alongU = (dot3(offset, uAxis) * vv - dot3(offset, vAxis) * uv) / determinant;
    const alongV = (dot3(offset, vAxis) * uu - dot3(offset, uAxis) * uv) / determinant;
    return [0, 1].map(axis => (slots[0][axis]
      + alongU * (slots[1][axis] - slots[0][axis])
      + alongV * (slots[2][axis] - slots[0][axis]))
      * canvas[axis === 0 ? 'width' : 'height']
      / Math.max(1, target.asset?.[axis === 0 ? 'uvWidth' : 'uvHeight'] || canvas[axis === 0 ? 'width' : 'height']));
  }

  function faceUvWorldPoint(cube, faceName, facePoints, point) {
    if (!cube || !faceName || facePoints?.length !== 4) return null;
    const face = cube.faces?.[faceName] || {};
    const rectangle = cube.uvMode !== 'box' && Array.isArray(face.uv) && face.uv.length >= 4
      ? face.uv : getBlockbenchBoxUv(cube, faceName);
    if (!rectangle) return null;
    const slots = createBlockbenchFaceUvSlots(rectangle, face.rotation || 0);
    const asset = textureAssetForReference(face.texture);
    const canvas = asset && (asset._uid === state.activeTextureUid
      ? textureCanvas : animationRasterCache.get(asset._uid)?.canvas);
    if (canvas) point = [point[0] * (asset.uvWidth || canvas.width) / canvas.width,
    point[1] * (asset.uvHeight || canvas.height) / canvas.height];
    for (const indices of [[0, 2, 1], [2, 3, 1]]) {
      const weights = barycentric2d(point, slots[indices[0]], slots[indices[1]], slots[indices[2]]);
      if (!weights || weights.some(weight => weight < -1e-5)) continue;
      return [0, 1, 2].map(axis => indices.reduce((sum, slot, index) => sum + facePoints[slot][axis] * weights[index], 0));
    }
    return null;
  }

  function facePixelWorldPoint(cube, faceName, facePoints, x, y) {
    return faceUvWorldPoint(cube, faceName, facePoints, [x + .5, y + .5]);
  }

  return { barycentricPoint, facePaintUvPoint, facePaintUvContinuous, faceUvWorldPoint, facePixelWorldPoint };
}
