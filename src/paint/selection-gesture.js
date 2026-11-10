import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv } from '../common/core/geometry-utils.js';
import { faceTilingValues } from '../common/core/face-tiling.js';
import { cutSelection, invertSelectionTransform, mapSelectionPoint, multiplySelectionTransforms,
  selectionBounds, selectionCorners, selectionFrameMatrix, selectionTransformMatrix,
  transformSelectedPixels } from './selection-transform.js';
import { releasePaintCanvas } from './canvas-layer-binding.js';

export const selectionHandleKinds = ['scale', 'rotate', 'scale', 'rotate'];

export function selectionFaceLayout(hit, cube, asset, width, height) {
  const face = cube.faces?.[hit.faceName] || {};
  const uv = cube.uvMode !== 'box' && face.uv?.length >= 4 ? face.uv : getBlockbenchBoxUv(cube, hit.faceName);
  if (!uv) return null;
  let slots = createBlockbenchFaceUvSlots(uv, face.rotation || 0)
    .map(([x, y]) => [x * width / (asset.uvWidth || width), y * height / (asset.uvHeight || height)]);
  if (asset.mode === 'tiled') {
    // A tiled face edits the shared source period under the pointer.
    const [x, y, w, h] = faceTilingValues(face);
    slots = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    const origin = hit.facePoints[0], offset = hit.point.map((value, axis) => value - origin[axis]);
    const component = index => {
      const edge = hit.facePoints[index].map((value, axis) => value - origin[axis]);
      return edge.reduce((sum, value, axis) => sum + value * offset[axis], 0)
        / edge.reduce((sum, value) => sum + value * value, 0);
    };
    const periodX = Math.floor((x + w * component(1)) / width) * width;
    const periodY = Math.floor((y + h * component(2)) / height) * height;
    slots = slots.map(([u, v]) => [u - periodX, v - periodY]);
  }
  const matrix = selectionFrameMatrix(slots), inverse = invertSelectionTransform(matrix);
  if (!inverse) return null;
  const clip = {
    left: Math.max(0, Math.floor(Math.min(...slots.map(p => p[0])))),
    top: Math.max(0, Math.floor(Math.min(...slots.map(p => p[1])))),
    right: Math.min(width, Math.ceil(Math.max(...slots.map(p => p[0])))),
    bottom: Math.min(height, Math.ceil(Math.max(...slots.map(p => p[1]))))
  };
  return { hit, asset, width, height, slots, matrix, inverse, clip };
}

export function selectionGestureMatrix(bounds, start, point, corner,
  { rotationStep = Math.PI / 2, rotationOffset = 0, scaleBasis = null } = {}) {
  if (corner == null) return selectionTransformMatrix(bounds, { dx: Math.round(point[0] - start[0]), dy: Math.round(point[1] - start[1]) });
  if (selectionHandleKinds[corner] === 'rotate') {
    const radians = ([x, y]) => Math.atan2(y - bounds.cy, x - bounds.cx);
    const angle = radians(point) - radians(start);
    return selectionTransformMatrix(bounds,
      { angle: rotationStep ? Math.round((angle + rotationOffset) / rotationStep) * rotationStep - rotationOffset : angle });
  }
  const corners = selectionCorners(bounds), anchor = corners[(corner + 2) % 4], handle = corners[corner];
  const extents = handle.map((value, axis) => value - anchor[axis]);
  const requested = extents.map((extent, axis) => Math.round(extent + point[axis] - start[axis]) || Math.sign(extent));
  let scales = requested.map((extent, axis) => extent / extents[axis]);
  if (scaleBasis) {
    const diagonal = extents.map((extent, axis) => Math.abs(extent) / scaleBasis[axis]);
    const projected = diagonal.reduce((sum, length, axis) => sum + length * Math.abs(requested[axis]), 0);
    const factor = projected / (diagonal[0] ** 2 + diagonal[1] ** 2);
    const maximum = 4096 * Math.min(...scaleBasis);
    scales = scales.map((scale, axis) => Math.sign(scale) * Math.min(factor, maximum) / scaleBasis[axis]);
  } else scales = scales.map(scale => Math.max(-4096, Math.min(4096, scale)));
  return selectionTransformMatrix(bounds, { pivot: anchor, scaleX: scales[0], scaleY: scales[1] });
}

function restrictedMask(primary, target, mask, correspondence) {
  const output = new Uint8Array(target.width * target.height);
  const reverse = invertSelectionTransform(correspondence);
  if (!reverse) return output;
  const source = primary.clip, destination = target.clip;
  for (let y = destination.top; y < destination.bottom; y++) for (let x = destination.left; x < destination.right; x++) {
    const [sx, sy] = mapSelectionPoint(reverse, [x + .5, y + .5]).map(Math.floor);
    if (sx >= source.left && sx < source.right && sy >= source.top && sy < source.bottom)
      output[y * target.width + x] = mask[sy * primary.width + sx];
  }
  return output;
}

export async function preparePixelSelection(primary, counterparts, masks, loadCanvas, patch = null) {
  const surfaces = new Map(), regions = [], seen = new Set();
  const original = masks?.get(primary.asset._uid)?.pixels;
  if (!original && !patch) return null;
  for (const target of [primary, ...counterparts]) {
    const correspondence = target === primary ? [1, 0, 0, 1, 0, 0]
      : multiplySelectionTransforms(selectionFrameMatrix(
        (target.hit.symmetryPermutation || [0, 1, 2, 3]).map(index => target.slots[index])), primary.inverse);
    // The same UV region may be referenced by several symmetric faces. Do not
    // cut or apply the same pixels twice.
    const key = [target.asset._uid, ...Object.values(target.clip), ...correspondence.map(value => Math.round(value * 1e6))].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    const inverse = invertSelectionTransform(correspondence);
    if (!inverse) continue;
    const mask = patch ? null : restrictedMask(primary, target, original, correspondence);
    const bounds = patch ? { left: 0, top: 0, right: patch.width - 1, bottom: patch.height - 1 }
      : selectionBounds(mask, target.width, target.height, target.clip);
    if (!bounds) continue;
    let surface = surfaces.get(target.asset);
    if (!surface) {
      const loaded = await loadCanvas(target.asset);
      if (!loaded || loaded.canvas.width !== target.width || loaded.canvas.height !== target.height) {
        if (loaded) releasePaintCanvas(loaded.canvas);
        for (const surface of surfaces.values()) releasePaintCanvas(surface.canvas);
        return null;
      }
      surface = { ...loaded, asset: target.asset, width: target.width, height: target.height,
        source: loaded.context.getImageData(0, 0, target.width, target.height) };
      surfaces.set(target.asset, surface);
    }
    const sourceMap = patch ? [1, 0, 0, 1, primary.bounds.left, primary.bounds.top] : inverse;
    regions.push({ surface, mask, bounds, clip: target.clip, correspondence, sourceMap, patch });
  }
  return regions.length ? { surfaces, regions } : null;
}

function regionTransform(region, matrix) {
  return multiplySelectionTransforms(region.correspondence, multiplySelectionTransforms(matrix, region.sourceMap));
}

function drawRegion(region, matrix, sampling, output, outputWidth, outputHeight, clip, claimed = null) {
  const { surface, patch, mask, bounds } = region;
  transformSelectedPixels(patch?.data || surface.source.data, mask,
    patch?.width || surface.width, patch?.height || surface.height,
    { matrix, bounds, clip, cut: false, output, outputWidth, outputHeight, resultMask: null, claimed, sampling });
}

export function renderPixelSelection(session, matrix, copy, sampling = 'smooth', place = true) {
  const pasted = Boolean(session.regions[0].patch);
  const unchanged = place ? !pasted && matrix.every((value, index) => Math.abs(value - [1, 0, 0, 1, 0, 0][index]) < 1e-8)
    : pasted || copy;
  for (const surface of session.surfaces.values()) {
    surface.output ||= surface.context.createImageData(surface.width, surface.height);
    surface.output.data.set(surface.source.data);
    if (session.regions.length > 1) {
      surface.claimed ||= new Uint8Array(surface.width * surface.height);
      surface.claimed.fill(0);
    }
  }
  if (!unchanged) {
    if (!pasted && !copy) for (const { surface, mask, bounds } of session.regions)
      cutSelection(surface.output.data, null, mask, surface.width, bounds, false);
    if (place) for (const region of session.regions) {
      const { surface } = region;
      drawRegion(region, regionTransform(region, matrix), sampling,
        surface.output.data, surface.width, surface.height, region.clip, surface.claimed);
    }
  }
  for (const surface of session.surfaces.values())
    surface.context.putImageData(surface.output, 0, 0);
  return !unchanged;
}

export function captureSelectionPatch(session, matrix, sampling) {
  const region = session.regions[0];
  const mapping = regionTransform(region, matrix);
  const corners = selectionCorners(region.bounds).map(point => mapSelectionPoint(mapping, point));
  const left = Math.max(region.clip.left, Math.floor(Math.min(...corners.map(p => p[0]))));
  const top = Math.max(region.clip.top, Math.floor(Math.min(...corners.map(p => p[1]))));
  const right = Math.min(region.clip.right, Math.ceil(Math.max(...corners.map(p => p[0]))));
  const bottom = Math.min(region.clip.bottom, Math.ceil(Math.max(...corners.map(p => p[1]))));
  if (left >= right || top >= bottom) return null;
  const width = right - left, height = bottom - top;
  const data = new Uint8ClampedArray(width * height * 4);
  drawRegion(region, multiplySelectionTransforms([1, 0, 0, 1, -left, -top], mapping), sampling, data, width, height);
  if (!data.some((value, index) => index % 4 === 3 && value)) return null;
  return { left, top, width, height, data };
}

export function selectionLayerCanvases(session, matrix, sampling) {
  const layers = new Map();
  for (const [asset, surface] of session.surfaces) {
    const canvas = document.createElement('canvas');
    canvas.width = surface.width; canvas.height = surface.height;
    const context = canvas.getContext('2d');
    const image = context.createImageData(surface.width, surface.height);
    const claimed = session.regions.length > 1 ? new Uint8Array(surface.width * surface.height) : null;
    for (const region of session.regions) if (region.surface === surface)
      drawRegion(region, regionTransform(region, matrix), sampling, image.data, surface.width, surface.height, region.clip, claimed);
    if (!image.data.some((value, index) => index % 4 === 3 && value)) continue;
    context.putImageData(image, 0, 0);
    layers.set(asset, canvas);
  }
  return layers;
}
