// Paint selections are pixel masks indexed by texture asset. They are editor
// state, never baked into a model or its textures.
import { activeLayer, tiledFaceRaster } from '../common/core/texture-features.js';
import { ConfigKey, configRegistry, translateUiKey } from '../common/config/app-config.js';
import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv } from '../common/core/geometry-utils.js';
import {
  invertSelectionTransform, mapSelectionPoint, multiplySelectionTransforms, selectionBounds,
  selectionCorners, selectionTransformMatrix
} from './selection-transform.js';
import {
  captureSelectionPatch, preparePixelSelection, renderPixelSelection, selectionFaceLayout, selectionGestureMatrix,
  selectionHandleKinds, selectionLayerCanvases
} from './selection-gesture.js';
import { HANDLE_SIZE, projectSelectionFrame, selectionHandleIcons, selectionHandleProjection } from './selection-frame.js';
import { beginPaintGesture, pendingPaintCommit, trackPaintCommit } from './commit-order.js';
import { releasePaintCanvas } from './canvas-layer-binding.js';
import { SELECTION_STRIPE_SIZE, SELECTION_STRIPE_PIXELS, selectionStripePhase } from '../utils/selection-stripes.js';

const FACE_TRIANGLES = [[0, 2, 1], [2, 3, 1]];
const IDENTITY = [1, 0, 0, 1, 0, 0];
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const difference = (a, b) => a.map((value, axis) => value - b[axis]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function barycentric(point, a, b, c) {
  const first = [b[0] - a[0], b[1] - a[1]], second = [c[0] - a[0], c[1] - a[1]];
  const determinant = first[0] * second[1] - first[1] * second[0];
  if (Math.abs(determinant) < 1e-9) return null;
  const offset = [point[0] - a[0], point[1] - a[1]];
  const v = (offset[0] * second[1] - offset[1] * second[0]) / determinant;
  const w = (first[0] * offset[1] - first[1] * offset[0]) / determinant;
  const weights = [1 - v - w, v, w];
  return weights.every(value => value >= -1e-5) ? weights : null;
}

export function faceRectangleFrame(hit) {
  if (!hit?.point || hit.facePoints?.length !== 4) return null;
  const origin = hit.facePoints[0];
  const uAxis = difference(hit.facePoints[1], origin);
  const vAxis = difference(hit.facePoints[2], origin);
  const normal = cross(uAxis, vAxis);
  const uLengthSquared = dot(uAxis, uAxis), vLengthSquared = dot(vAxis, vAxis);
  const uvDot = dot(uAxis, vAxis);
  const normalLengthSquared = dot(normal, normal);
  if (uLengthSquared < 1e-10 || vLengthSquared < 1e-10 || normalLengthSquared < 1e-10) return null;
  return {
    origin, uAxis, vAxis, normal, uLengthSquared, vLengthSquared,
    uvDot, normalLengthSquared, points: hit.facePoints, anchor: hit.point
  };
}

export function faceRectanglePlanePoint(frame, ray) {
  if (!frame || !ray) return null;
  const denominator = dot(frame.normal, ray.direction);
  if (Math.abs(denominator) < 1e-9) return null;
  const distance = dot(frame.normal, difference(frame.origin, ray.origin)) / denominator;
  if (distance < 0) return null;
  return ray.origin.map((value, axis) => value + distance * ray.direction[axis]);
}

export function faceRectangleCoordinates(frame, point) {
  const offset = difference(point, frame.origin);
  const u = dot(offset, frame.uAxis), v = dot(offset, frame.vAxis);
  return [(u * frame.vLengthSquared - v * frame.uvDot) / frame.normalLengthSquared,
  (v * frame.uLengthSquared - u * frame.uvDot) / frame.normalLengthSquared];
}

export function faceRectangleWorldPoint(frame, u, v) {
  return frame.origin.map((value, axis) => value + frame.uAxis[axis] * u + frame.vAxis[axis] * v);
}
export function paintSelectionAllows(state, assetUid, x, y, width, height) {
  const selection = state.paintSelection;
  if (!selection?.active) return true;
  const entry = selection.masks.get(assetUid);
  return Boolean(entry && entry.width === width && entry.height === height
    && x >= 0 && y >= 0 && x < width && y < height && entry.pixels[y * width + x]);
}

export function createPaintSelectionController({ state, $, sceneCanvas, sceneRenderer,
  textureCanvas, clientToTextureUv, textureAssetForReference, facePaintUvPoint,
  paintSymmetryRelatedHits, getTextureAtlasEntries, getTextureAtlasCanvas,
  scheduleSceneRender, updateToolOptions, pushTexturePaintHistory, commitPaintedTextureAsset,
  paintCanvasForAsset, previewFloatingTexture, clearFloatingTextures, discardPaintedTextureSync,
  moveSelectionToLayer, showContextMenu, toast }) {
  const texturePreview = $('#texturePreview');
  const overlay = $('#paintSelectionTextureOverlay');
  const border = $('#paintSelectionBorder');
  const sceneGesture = $('#paintSelectionGesture');
  const textureStage = $('#textureStage');
  const handleImages = selectionHandleIcons.map(url => {
    const image = new Image();
    image.addEventListener('load', drawBorder);
    image.src = url;
    return image;
  });
  let drag = null;
  let floating = null;
  let clipboard = null;
  let commandPending = false;
  let animation = null;
  let renderFrame = null;
  let edges = [];
  let sceneFocus = null, focusSource = 'texture', sceneHoverFrame = null;
  let sceneTransformNodes = null;
  let boundsCache = new WeakMap();
  const stripeTile = document.createElement('canvas');
  stripeTile.width = stripeTile.height = SELECTION_STRIPE_SIZE;
  stripeTile.getContext('2d').putImageData(new ImageData(
    new Uint8ClampedArray(SELECTION_STRIPE_PIXELS), SELECTION_STRIPE_SIZE, SELECTION_STRIPE_SIZE), 0, 0);
  const stripePattern = border?.getContext('2d')?.createPattern(stripeTile, 'repeat');
  const stripeImageUrl = stripeTile.toDataURL('image/png');
  let sceneMaskDirty = true;
  let overlayMask = null, overlayRevision = -1, overlayAssetUid = null;
  const sceneMaskAtlas = document.createElement('canvas');
  const sceneMaskContext = sceneMaskAtlas.getContext('2d');

  function activeAsset() { return state.textureAssets.find(asset => asset._uid === state.activeTextureUid); }
  function maskBounds(mask, clip) {
    if (!mask) return null;
    const key = [mask.revision || 0, ...(clip ? Object.values(clip) : [])].join(':');
    let cache = boundsCache.get(mask);
    if (!cache || cache.revision !== (mask.revision || 0)) {
      cache = { revision: mask.revision || 0, values: new Map() };
      boundsCache.set(mask, cache);
    }
    if (!cache.values.has(key)) {
      if (cache.values.size > 24) cache.values.clear();
      cache.values.set(key, selectionBounds(mask.pixels, mask.width, mask.height, clip));
    }
    return cache.values.get(key);
  }
  function texturePoint(clientX, clientY) {
    const point = clientToTextureUv(clientX, clientY), asset = activeAsset();
    return [point[0] * textureCanvas.width / Math.max(1, asset?.uvWidth || textureCanvas.width),
    point[1] * textureCanvas.height / Math.max(1, asset?.uvHeight || textureCanvas.height)];
  }
  function assetPixels(asset) {
    if (asset?._uid === state.activeTextureUid) return [textureCanvas.width, textureCanvas.height];
    const entry = getTextureAtlasEntries().find(item => item.uid === asset?._uid);
    return [entry?.width || asset?.uvWidth || state.project.textureSize?.[0] || 16,
    entry?.height || asset?.uvHeight || state.project.textureSize?.[1] || 16];
  }
  function maskFor(asset, width, height) {
    if (!asset) return null;
    let mask = state.paintSelection.masks.get(asset._uid);
    if (!mask || mask.width !== width || mask.height !== height) {
      mask = { width, height, pixels: new Uint8Array(width * height) };
      state.paintSelection.masks.set(asset._uid, mask);
    }
    return mask;
  }
  function setPixel(mask, x, y, operation) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!mask || x < 0 || y < 0 || x >= mask.width || y >= mask.height) return;
    const index = y * mask.width + x;
    const value = operation === 'erase' ? 0 : 1;
    if (mask.pixels[index] !== value) {
      mask.pixels[index] = value;
      mask.revision = (mask.revision || 0) + 1;
    }
  }
  function stamp(mask, x, y, radius, operation) {
    const reach = Math.max(0, Math.floor(radius));
    for (let offsetY = -reach; offsetY <= reach; offsetY++) for (let offsetX = -reach; offsetX <= reach; offsetX++) {
      if (offsetX * offsetX + offsetY * offsetY > radius * radius) continue;
      setPixel(mask, x + offsetX, y + offsetY, operation);
    }
  }
  function pointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function insideShape(x, y, points, mode) {
    if (mode === 'rectangle') {
      const first = points[0], last = points.at(-1);
      return x >= Math.min(first[0], last[0]) && x <= Math.max(first[0], last[0])
        && y >= Math.min(first[1], last[1]) && y <= Math.max(first[1], last[1]);
    }
    return pointInPolygon(x, y, points);
  }
  function paintTextureBrush(point, operation) {
    const asset = activeAsset();
    const mask = maskFor(asset, textureCanvas.width, textureCanvas.height);
    if (mask) stamp(mask, point[0], point[1], state.paintSelectionBrushSize / 2, operation);
  }
  function paintScenePoint(clientX, clientY, operation, singleFace = null) {
    const rect = sceneCanvas.getBoundingClientRect();
    const hit = sceneRenderer.pickDetailed(state.project, clientX - rect.left, clientY - rect.top, true);
    if (!hit?.faceName) return null;
    const faceKey = `${hit.cubeUid || hit.uid}:${hit.faceName}`;
    if (singleFace && faceKey !== singleFace) return null;
    const hits = state.paintSelectionSymmetry ? paintSymmetryRelatedHits(hit) : [hit];
    for (const candidate of hits) {
      const cube = candidate.cube?.type === 'cube' ? candidate.cube : state.project.getNode(candidate.uid);
      if (cube?.type !== 'cube') continue;
      const asset = textureAssetForReference(cube.faces?.[candidate.faceName]?.texture);
      if (!asset) continue;
      const [width, height] = assetPixels(asset);
      const pixel = facePaintUvPoint(candidate, { cube, faceName: candidate.faceName }, { width, height });
      if (pixel) setPixel(maskFor(asset, width, height), pixel[0], pixel[1], operation);
    }
    return faceKey;
  }
  function brushLine(from, to, source, operation) {
    const radius = Math.max(1, state.paintSelectionBrushSize / 2);
    const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1])
      / (source === 'scene' ? Math.max(2, radius / 2) : 2)));
    for (let i = 0; i <= steps; i++) {
      const x = from[0] + (to[0] - from[0]) * i / steps;
      const y = from[1] + (to[1] - from[1]) * i / steps;
      if (source === 'texture') paintTextureBrush([x, y], operation);
      else {
        const grid = Math.max(3, Math.floor(radius / 2));
        for (let dy = -radius; dy <= radius; dy += grid) for (let dx = -radius; dx <= radius; dx += grid) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const screenX = Math.round(x + dx), screenY = Math.round(y + dy);
          const key = `${screenX}:${screenY}`;
          if (drag?.visited?.has(key)) continue;
          drag?.visited?.add(key);
          paintScenePoint(screenX, screenY, operation);
        }
      }
    }
  }
  function scenePlanePoint(clientPoint, frame) {
    if (!frame) return null;
    const rect = sceneCanvas.getBoundingClientRect();
    return faceRectanglePlanePoint(frame, sceneRenderer.getScreenRay(
      clientPoint[0] - rect.left, clientPoint[1] - rect.top));
  }
  function applyFaceRectangle(current) {
    const frame = drag.faceFrame;
    const end = scenePlanePoint(current, frame);
    if (!frame || !end) return;
    const startCoord = faceRectangleCoordinates(frame, frame.anchor);
    const endCoord = faceRectangleCoordinates(frame, end);
    const targets = state.paintSelectionSymmetry ? paintSymmetryRelatedHits(drag.faceHit) : [drag.faceHit];
    for (const hit of targets) {
      const targetFrame = faceRectangleFrame(hit);
      const cube = hit.cube?.type === 'cube' ? hit.cube : state.project.getNode(hit.uid);
      const faceName = hit.faceName;
      const asset = textureAssetForReference(cube?.faces?.[faceName]?.texture);
      if (!targetFrame || !asset) continue;
      const [width, height] = assetPixels(asset);
      const mask = maskFor(asset, width, height);
      const face = cube.faces?.[faceName] || {};
      const uv = Array.isArray(face.uv) && face.uv.length >= 4
        ? face.uv : getBlockbenchBoxUv(cube, faceName);
      if (!uv || !mask) continue;
      const slots = createBlockbenchFaceUvSlots(uv, face.rotation || 0);
      const permutation = hit === drag.faceHit ? [0, 1, 2, 3]
        : hit.symmetryPermutation || [0, 1, 2, 3];
      const mapped = ([u, v]) => {
        const p0 = hit.facePoints[permutation[0]], p1 = hit.facePoints[permutation[1]];
        const p2 = hit.facePoints[permutation[2]];
        return p0.map((value, axis) => value + (p1[axis] - value) * u + (p2[axis] - value) * v);
      };
      const a = faceRectangleCoordinates(targetFrame, mapped(startCoord));
      const b = faceRectangleCoordinates(targetFrame, mapped(endCoord));
      const minU = Math.min(a[0], b[0]), maxU = Math.max(a[0], b[0]);
      const minV = Math.min(a[1], b[1]), maxV = Math.max(a[1], b[1]);
      const limit = value => Math.max(0, Math.min(1, value));
      const uvCorners = [
        [limit(minU), limit(minV)], [limit(maxU), limit(minV)],
        [limit(minU), limit(maxV)], [limit(maxU), limit(maxV)]
      ].map(([u, v]) => slots[0].map((value, axis) =>
        (value + (slots[1][axis] - value) * u + (slots[2][axis] - value) * v)
        * (axis === 0 ? width / Math.max(1, asset.uvWidth || width)
          : height / Math.max(1, asset.uvHeight || height))));
      const left = Math.max(0, Math.floor(Math.min(...uvCorners.map(point => point[0]))));
      const right = Math.min(width, Math.ceil(Math.max(...uvCorners.map(point => point[0]))));
      const top = Math.max(0, Math.floor(Math.min(...uvCorners.map(point => point[1]))));
      const bottom = Math.min(height, Math.ceil(Math.max(...uvCorners.map(point => point[1]))));
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const uvPoint = [(x + .5) * (asset.uvWidth || width) / width,
        (y + .5) * (asset.uvHeight || height) / height];
        for (const triangle of FACE_TRIANGLES) {
          const weights = barycentric(uvPoint, ...triangle.map(slot => slots[slot]));
          if (!weights) continue;
          const world = targetFrame.origin.map((_, axis) => triangle.reduce((sum, slot, index) =>
            sum + targetFrame.points[slot][axis] * weights[index], 0));
          const [u, v] = faceRectangleCoordinates(targetFrame, world);
          if (u >= minU - 1e-6 && u <= maxU + 1e-6 && v >= minV - 1e-6 && v <= maxV + 1e-6)
            setPixel(mask, x, y, drag.operation);
          break;
        }
      }
    }
  }
  function applyArea(current) {
    if (drag.source === 'scene' && drag.mode === 'rectangle') {
      applyFaceRectangle(current);
      return;
    }
    const points = [...drag.points, current];
    const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
    const left = Math.floor(Math.min(...xs)), right = Math.ceil(Math.max(...xs));
    const top = Math.floor(Math.min(...ys)), bottom = Math.ceil(Math.max(...ys));
    if (drag.source === 'texture') {
      const mask = maskFor(activeAsset(), textureCanvas.width, textureCanvas.height);
      if (!mask) return;
      for (let y = Math.max(0, top); y < Math.min(mask.height, bottom + 1); y++)
        for (let x = Math.max(0, left); x < Math.min(mask.width, right + 1); x++)
          if (insideShape(x + .5, y + .5, points, drag.mode)) setPixel(mask, x, y, drag.operation);
    } else {
      // BVH picking keeps this bounded by visible surfaces and works in both
      // perspective and orthographic projection. A rectangle stays on its
      // starting face; freehand tools can pass over face edges.
      const step = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, (right - left) * (bottom - top)) / 40000)));
      for (let y = top; y <= bottom; y += step) for (let x = left; x <= right; x += step) {
        if (!insideShape(x + .5, y + .5, points, drag.mode)) continue;
        const face = paintScenePoint(x, y, drag.operation, drag.singleFace);
        if (drag.mode === 'rectangle' && !drag.singleFace && face) drag.singleFace = face;
      }
    }
  }
  function drawBorder() {
    if (!border || border.hidden) return;
    const previewRect = texturePreview.getBoundingClientRect();
    const stageRect = textureStage.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(texturePreview.clientWidth * pixelRatio));
    const height = Math.max(1, Math.round(texturePreview.clientHeight * pixelRatio));
    if (border.width !== width) border.width = width;
    if (border.height !== height) border.height = height;
    const context = border.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    stripePattern.setTransform(new DOMMatrix().translate(
      -previewRect.left + selectionStripePhase(), -previewRect.top));
    const originX = stageRect.left - previewRect.left - texturePreview.clientLeft;
    const originY = stageRect.top - previewRect.top - texturePreview.clientTop;
    const scaleX = stageRect.width / Math.max(1, textureCanvas.width);
    const scaleY = stageRect.height / Math.max(1, textureCanvas.height);
    context.beginPath();
    for (const [x1, y1, x2, y2] of edges) {
      context.moveTo(originX + x1 * scaleX, originY + y1 * scaleY);
      context.lineTo(originX + x2 * scaleX, originY + y2 * scaleY);
    }
    context.lineWidth = 2.5;
    context.strokeStyle = '#000';
    context.stroke();
    context.lineWidth = 1.5;
    context.strokeStyle = stripePattern;
    context.stroke();
    const frame = displayTransform('texture');
    if (frame) {
      const layout = projectSelectionFrame(frame.corners, ([x, y]) => [originX + x * scaleX, originY + y * scaleY]);
      if (layout) {
        context.beginPath();
        layout.points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
        context.closePath();
        context.lineWidth = 1;
        context.strokeStyle = getComputedStyle(border).getPropertyValue('--accent');
        context.setLineDash([4, 3]);
        context.stroke();
        context.setLineDash([]);
        layout.handles.forEach((quad, index) => {
          const image = handleImages[index % 2];
          if (!quad || !image.complete || !image.naturalWidth) return;
          const [[x, y], [rx, ry], , [bx, by]] = quad;
          context.save();
          context.transform((rx - x) / HANDLE_SIZE, (ry - y) / HANDLE_SIZE,
            (bx - x) / HANDLE_SIZE, (by - y) / HANDLE_SIZE, x, y);
          context.filter = 'invert(1) drop-shadow(0 0 1px #171a17)';
          context.drawImage(image, 0, 0, HANDLE_SIZE, HANDLE_SIZE);
          context.restore();
        });
      }
    }
    if (drag?.source === 'texture' && drag.mode !== 'brush' && !drag.transform && drag.points.length > 1) {
      const points = drag.mode === 'rectangle'
        ? [drag.points[0], [drag.points.at(-1)[0], drag.points[0][1]], drag.points.at(-1),
        [drag.points[0][0], drag.points.at(-1)[1]], drag.points[0]]
        : drag.points;
      context.beginPath();
      points.forEach(([x, y], index) => index
        ? context.lineTo(originX + x * scaleX, originY + y * scaleY)
        : context.moveTo(originX + x * scaleX, originY + y * scaleY));
      context.lineWidth = 2;
      context.strokeStyle = '#000';
      context.setLineDash([]);
      context.stroke();
      context.lineWidth = 1;
      context.strokeStyle = stripePattern;
      context.stroke();
    }
  }
  function drawSceneGesture() {
    if (!sceneGesture) return;
    const transform = displayTransform('scene');
    if (transform) {
      const rect = sceneCanvas.getBoundingClientRect();
      const layout = sceneSelectionLayout(transform);
      sceneGesture.toggleAttribute('hidden', !layout);
      if (!layout) return;
      sceneGesture.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
      if (!sceneTransformNodes) {
        const icons = selectionHandleKinds.map((_, index) => `<img class="selection-handle-icon"
          src="${selectionHandleIcons[index % 2]}" width="${HANDLE_SIZE}" height="${HANDLE_SIZE}" alt=""/>`).join('');
        sceneGesture.innerHTML = `<path class="selection-transform-frame"/>
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml" class="selection-handle-plane">${icons}</div>
          </foreignObject>`;
        sceneTransformNodes = { frame: sceneGesture.firstElementChild, icons: [...sceneGesture.querySelectorAll('img')] };
      }
      const path = layout.points.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ') + ' Z';
      sceneTransformNodes.frame.setAttribute('d', path);
      layout.handles.forEach((quad, index) => {
        const icon = sceneTransformNodes.icons[index];
        const projection = quad && selectionHandleProjection(quad);
        icon.hidden = !projection;
        if (projection) icon.style.transform = `matrix3d(${projection.join(',')})`;
      });
      return;
    }
    const hidden = !drag || state.mode !== 'paint' || state.tool !== 'paintSelection'
      || drag.source !== 'scene' || drag.transform || drag.mode === 'brush' || drag.points.length < 2;
    sceneGesture.toggleAttribute('hidden', Boolean(hidden));
    sceneTransformNodes = null;
    if (hidden) {
      if (sceneGesture.firstChild) sceneGesture.replaceChildren();
      return;
    }
    const rect = sceneCanvas.getBoundingClientRect();
    sceneGesture.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    let points;
    if (drag.mode === 'rectangle' && drag.faceFrame) {
      const frame = drag.faceFrame;
      const end = scenePlanePoint(drag.points.at(-1), frame);
      if (!end) {
        sceneGesture.setAttribute('hidden', '');
        return;
      }
      const [u0, v0] = faceRectangleCoordinates(frame, frame.anchor);
      const [u1, v1] = faceRectangleCoordinates(frame, end);
      const limit = value => Math.max(0, Math.min(1, value));
      points = [[u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0]]
        .map(([u, v]) => [limit(u), limit(v)])
        .map(([u, v]) => sceneRenderer.projectPoint(faceRectangleWorldPoint(frame, u, v)))
        .map(projected => [projected.x + rect.left, projected.y + rect.top]);
    } else points = drag.mode === 'rectangle'
      ? [drag.points[0], [drag.points.at(-1)[0], drag.points[0][1]], drag.points.at(-1),
      [drag.points[0][0], drag.points.at(-1)[1]], drag.points[0]]
      : drag.points;
    const path = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x - rect.left},${y - rect.top}`).join(' ');
    sceneGesture.innerHTML = `<defs><pattern id="paintSelectionGestureStripes" patternUnits="userSpaceOnUse"
      x="${-rect.left + selectionStripePhase()}" y="${-rect.top}"
      width="${SELECTION_STRIPE_SIZE}" height="${SELECTION_STRIPE_SIZE}">
      <image href="${stripeImageUrl}" width="${SELECTION_STRIPE_SIZE}" height="${SELECTION_STRIPE_SIZE}"/>
      </pattern></defs><path class="selection-gesture-underlay" d="${path}"/>
      <path class="selection-gesture-stripes" d="${path}"/>`;
  }
  function updateSceneMask() {
    if (!sceneMaskDirty) return;
    sceneMaskDirty = false;
    if (!state.paintSelection.active) {
      sceneRenderer.setSelectionMaskAtlas(null);
      scheduleSceneRender();
      return;
    }
    const entries = getTextureAtlasEntries();
    const atlas = getTextureAtlasCanvas();
    sceneMaskAtlas.width = entries.length ? atlas.width : textureCanvas.width;
    sceneMaskAtlas.height = entries.length ? atlas.height : textureCanvas.height;
    sceneMaskContext.clearRect(0, 0, sceneMaskAtlas.width, sceneMaskAtlas.height);
    const placements = entries.length ? entries : [{
      uid: state.activeTextureUid, x: 0, y: 0,
      width: textureCanvas.width, height: textureCanvas.height
    }];
    const sourceMasks = new Map();
    for (const entry of placements) {
      const mask = state.paintSelection.masks.get(entry.tileSourceUid || entry.uid);
      if (!mask) continue;
      const sourceUid = entry.tileSourceUid || entry.uid;
      let source = sourceMasks.get(sourceUid);
      if (!source) {
        source = document.createElement('canvas');
        source.width = mask.width;
        source.height = mask.height;
        const sourceContext = source.getContext('2d');
        const image = sourceContext.createImageData(mask.width, mask.height);
        for (let pixel = 0; pixel < mask.pixels.length; pixel++) {
          if (!mask.pixels[pixel]) continue;
          const offset = pixel * 4;
          image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = image.data[offset + 3] = 255;
        }
        sourceContext.putImageData(image, 0, 0);
        sourceMasks.set(sourceUid, source);
      }
      if (entry.tileSourceUid) {
        const tile = tiledFaceRaster(entry.tileCube, entry.tileFaceName, source,
          entry.tileRegion, [entry.width, entry.height]);
        sceneMaskContext.drawImage(tile, entry.x, entry.y);
      } else if (mask.width === entry.width && mask.height === entry.height) {
        sceneMaskContext.drawImage(source, entry.x, entry.y);
      }
    }
    sceneRenderer.setSelectionMaskAtlas(sceneMaskAtlas);
    scheduleSceneRender();
  }
  function renderOverlayNow() {
    if (!overlay || !textureCanvas) return;
    // Upload the atlas once on release, not for every pointer sample.
    if (!drag || drag.transform || floating) updateSceneMask();
    const asset = activeAsset();
    const selection = state.paintSelection;
    const mask = asset && selection.masks.get(asset._uid);
    overlay.hidden = state.mode !== 'paint' || !selection.active;
    if (border) border.hidden = overlay.hidden && !displayTransform('texture');
    if (overlay.hidden) {
      edges = [];
      overlayMask = null;
      drawBorder();
      return;
    }
    const width = textureCanvas.width, height = textureCanvas.height;
    if (overlayMask === mask && overlayRevision === (mask?.revision || 0)
      && overlayAssetUid === asset?._uid && overlay.width === width && overlay.height === height) {
      drawBorder();
      return;
    }
    overlayMask = mask;
    overlayRevision = mask?.revision || 0;
    overlayAssetUid = asset?._uid;
    if (overlay.width !== width) overlay.width = width;
    if (overlay.height !== height) overlay.height = height;
    const context = overlay.getContext('2d');
    const image = context.createImageData(width, height);
    const matches = mask?.width === width && mask?.height === height ? mask.pixels : null;
    edges = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x, offset = index * 4;
      if (!matches?.[index]) {
        image.data[offset + 3] = 100;
        continue;
      }
      if (x === 0 || !matches[index - 1]) edges.push([x, y, x, y + 1]);
      if (x === width - 1 || !matches[index + 1]) edges.push([x + 1, y, x + 1, y + 1]);
      if (y === 0 || !matches[index - width]) edges.push([x, y, x + 1, y]);
      if (y === height - 1 || !matches[index + width]) edges.push([x, y + 1, x + 1, y + 1]);
    }
    context.putImageData(image, 0, 0);
    drawBorder();
  }
  function renderOverlay() {
    if (renderFrame !== null) return;
    if (state.mode === 'paint' && (state.paintSelection.active || floating)) ensureAnimation();
    renderFrame = window.setTimeout(() => {
      renderFrame = null;
      renderOverlayNow();
    }, drag ? 90 : 0);
  }
  function ensureAnimation() {
    if (animation !== null) return;
    animation = window.setInterval(() => {
      if (overlay?.hidden !== (state.mode !== 'paint' || !state.paintSelection.active)) renderOverlay();
      if (floating && !transformIsCurrent(floating)) discardTransform();
      if (sceneGesture && (state.mode !== 'paint' || state.tool !== 'paintSelection') && !sceneGesture.hasAttribute('hidden')) {
        drag = null;
        sceneGesture.setAttribute('hidden', '');
        sceneGesture.replaceChildren();
        sceneTransformNodes = null;
      }
      if ((!state.paintSelection.active && !floating) || state.mode !== 'paint') {
        clearInterval(animation);
        animation = null;
        return;
      }
      if (state.dragging?.type === 'pan' || state.dragging?.type === 'orbit') return;
      if (sceneGesture && !sceneGesture.hasAttribute('hidden')) drawSceneGesture();
      if (edges.length < 20000) drawBorder();
      // The 3D marching border does not need to rebuild the whole scene here.
    }, 140);
  }
  function clear() {
    discardTransform();
    clearHandleCursors();
    state.paintSelection = { active: false, masks: new Map() };
    sceneMaskDirty = true;
    overlayMask = null;
    sceneFocus = null;
    sceneTransformNodes = null;
    if (sceneGesture) {
      sceneGesture.setAttribute('hidden', '');
      sceneGesture.replaceChildren();
    }
    renderOverlay();
  }
  function sceneHit(clientX, clientY) {
    const rect = sceneCanvas.getBoundingClientRect();
    return sceneRenderer.pickDetailed(state.project, clientX - rect.left, clientY - rect.top, true);
  }
  function faceTarget(hit) {
    const cube = hit?.cube?.type === 'cube' ? hit.cube : state.project.getNode(hit?.uid);
    const face = cube?.faces?.[hit?.faceName];
    const asset = face && textureAssetForReference(face.texture);
    if (!asset || !faceRectangleFrame(hit)) return null;
    const mask = state.paintSelection.masks.get(asset._uid);
    const [width, height] = mask ? [mask.width, mask.height] : assetPixels(asset);
    const layout = selectionFaceLayout(hit, cube, asset, width, height);
    return layout ? { ...layout, mask, bounds: maskBounds(mask, layout.clip), frame: faceRectangleFrame(hit) } : null;
  }
  function textureTarget(requireMask = true) {
    const asset = activeAsset(), mask = asset && state.paintSelection.masks.get(asset._uid);
    if (!asset || requireMask && !mask || mask && (mask.width !== textureCanvas.width || mask.height !== textureCanvas.height)) return null;
    const { width, height } = textureCanvas;
    return {
      asset,
      mask,
      width,
      height,
      bounds: maskBounds(mask),
      clip: { left: 0, top: 0, right: width, bottom: height }
    };
  }
  function displayTransform(source) {
    if (state.mode !== 'paint' || state.tool !== 'paintSelection') return null;
    if (floating) {
      if (floating.source !== source) return null;
      const { target, matrix } = floating;
      return { target, corners: selectionCorners(target.bounds).map(point => mapSelectionPoint(matrix, point)) };
    }
    if (!state.paintSelection.active) return null;
    if (drag?.source === source && !drag.transform) return null;
    const target = (drag?.source === source && drag.transform?.target) || (source === 'texture' ? textureTarget()
      : sceneFocus?.project === state.project ? faceTarget(sceneFocus.hit) : null);
    return target?.bounds ? { target, corners: selectionCorners(target.bounds) } : null;
  }
  function sceneSelectionLayout({ target, corners }) {
    const world = corners.map(point => {
      const [u, v] = mapSelectionPoint(target.inverse, point);
      return faceRectangleWorldPoint(target.frame, u, v);
    });
    return projectSelectionFrame(world, point => {
      const projected = sceneRenderer.projectPoint(point);
      return projected && !projected.behind ? [projected.x, projected.y] : null;
    });
  }
  function handleAt(source, client, frame = displayTransform(source)) {
    if (!frame) return null;
    const rect = (source === 'texture' ? textureStage : sceneCanvas).getBoundingClientRect();
    const layout = source === 'scene' ? sceneSelectionLayout(frame) : projectSelectionFrame(frame.corners, ([x, y]) =>
      [x * rect.width / frame.target.width, y * rect.height / frame.target.height]);
    if (!layout) return null;
    const x = client[0] - rect.left, y = client[1] - rect.top;
    let nearest = Infinity, corner = null;
    layout.handles.forEach((quad, index) => {
      if (!quad) return;
      const sides = quad.map(([px, py], edge) => {
        const [nextX, nextY] = quad[(edge + 1) % 4];
        return (nextX - px) * (y - py) - (nextY - py) * (x - px);
      });
      if (sides.every(side => Math.abs(side) < 1e-6)) return;
      if (sides.some(side => side > 0) && sides.some(side => side < 0)) return;
      const [cx, cy] = layout.points[index];
      const distance = Math.hypot(x - cx, y - cy);
      if (distance < nearest) {
        nearest = distance;
        corner = index;
      }
    });
    if (corner == null) return null;
    const [cx, cy] = layout.points[corner];
    const [ox, oy] = layout.points[(corner + 2) % 4];
    const direction = Math.round(Math.atan2(cy - oy, cx - ox) / (Math.PI / 4));
    const resizeCursor = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][(direction + 4) % 4];
    return { target: frame.target, corner, cursor: selectionHandleKinds[corner] === 'rotate' ? 'grab' : resizeCursor };
  }
  function setHandleCursor(surface, handle, grabbed = false) {
    const cursor = grabbed && handle?.cursor === 'grab' ? 'grabbing' : handle?.cursor;
    if (surface.dataset.selectionHandleCursor === cursor) return;
    if (cursor) surface.dataset.selectionHandleCursor = cursor;
    else delete surface.dataset.selectionHandleCursor;
  }
  function clearHandleCursors() {
    setHandleCursor(texturePreview, null);
    setHandleCursor(sceneCanvas, null);
    cancelSceneHover();
  }
  function cancelSceneHover() {
    if (sceneHoverFrame == null) return;
    cancelAnimationFrame(sceneHoverFrame);
    sceneHoverFrame = null;
  }
  function targetPoint(target, client) {
    if (!target.frame) return texturePoint(...client);
    const world = scenePlanePoint(client, target.frame);
    return world && mapSelectionPoint(target.matrix, faceRectangleCoordinates(target.frame, world));
  }
  function insideTarget(target, point) {
    if (!target?.bounds || !point) return false;
    const [x, y] = point.map(Math.floor), { left, right, top, bottom } = target.clip;
    return x >= left && x < right && y >= top && y < bottom && target.mask.pixels[y * target.width + x];
  }
  function transformIsCurrent(transform) {
    return state.mode === 'paint' && state.tool === 'paintSelection'
      && state.activeTextureUid === transform.activeTextureUid && transformSourcesMatch(transform);
  }
  function transformSourcesMatch(transform) {
    return state.project === transform.project && transform.assets.every(asset => {
      if (!state.textureAssets.includes(asset)) return false;
      const original = transform.originals?.get(asset);
      return !original || (asset.source === original.source && activeLayer(asset) === original.layer
        && original.layer?.source === original.layerSource);
    });
  }
  function prepareTransform(target, source, patch = null, useSymmetry = state.paintSelectionSymmetry) {
    const counterpart = target.hit && useSymmetry
      ? paintSymmetryRelatedHits(target.hit).slice(1).map(faceTarget).filter(Boolean) : [];
    const assets = [...new Set([target, ...counterpart].map(entry => entry.asset))];
    const transform = {
      target, source, assets, project: state.project, activeTextureUid: state.activeTextureUid,
      copy: state.paintSelectionCopy, patch, matrix: IDENTITY, frame: null
    };
    const masks = state.paintSelection.masks;
    transform.ready = Promise.resolve(pendingPaintCommit(transform.project)).then(() => {
      if (transform.cancelled || !transformSourcesMatch(transform)) return null;
      transform.originals = new Map(assets.map(asset => {
        const layer = activeLayer(asset);
        return [asset, { source: asset.source, layer, layerSource: layer?.source }];
      }));
      return preparePixelSelection(target, counterpart, masks, asset => {
        const layer = transform.originals.get(asset)?.layer;
        return layer?.locked ? null : paintCanvasForAsset(asset);
      }, patch);
    }).then(session => {
      transform.session = session;
      if (floating === transform && (!session || !transformIsCurrent(transform))) discardTransform();
      return session;
    }).catch(error => {
      if (floating === transform) discardTransform();
      toast(error.message);
      return null;
    });
    return transform;
  }
  function activateTransform(transform) {
    floating = transform;
    state.paintSelection = { active: false, masks: new Map() };
    sceneMaskDirty = true;
    drawSceneGesture();
    renderOverlayNow();
    ensureAnimation();
    return transform;
  }
  function liftTransform(target, source, patch = null) {
    return activateTransform(prepareTransform(target, source, patch));
  }
  function renderTransform(transform, session) {
    if (transform.drawn !== transform.matrix || transform.sampling !== state.paintSelectionSampling) {
      transform.sampling = state.paintSelectionSampling;
      transform.changed = renderPixelSelection(session, transform.matrix, transform.copy, transform.sampling);
      transform.drawn = transform.matrix;
    }
    return transform.changed;
  }
  function queueTransformPreview(transform) {
    if (transform.frame != null) return;
    transform.frame = requestAnimationFrame(() => {
      transform.frame = null;
      void transform.ready.then(session => {
        if (floating !== transform || !session || !transformIsCurrent(transform)
          || transform.drawn === transform.matrix && transform.sampling === state.paintSelectionSampling) return;
        renderTransform(transform, session);
        for (const { asset, canvas } of session.surfaces.values()) previewFloatingTexture(asset, canvas);
      }).catch(error => {
        if (floating === transform) discardTransform();
        toast(error.message);
      });
    });
  }
  function detachTransform() {
    const transform = floating;
    if (!transform) return null;
    floating = null;
    clearHandleCursors();
    if (transform.frame != null) cancelAnimationFrame(transform.frame);
    if (drag?.transform === transform || drag?.outside) {
      const surface = drag.source === 'texture' ? texturePreview : sceneCanvas;
      const { pointerId } = drag;
      drag = null;
      if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
    }
    drawSceneGesture();
    renderOverlayNow();
    return transform;
  }
  function releaseTransformSession(session) {
    if (session) for (const { canvas } of session.surfaces.values()) releasePaintCanvas(canvas);
  }
  function discardTransform() {
    const transform = detachTransform();
    if (!transform) return false;
    transform.cancelled = true;
    clearFloatingTextures();
    void transform.ready?.then(releaseTransformSession);
    return true;
  }
  function placeTransform(action = 'place') {
    if (!floating || !transformIsCurrent(floating)) {
      discardTransform();
      return;
    }
    const transform = detachTransform();
    beginPaintGesture(transform.project);
    const work = transform.ready.then(async session => {
      try {
        if (!session || !transformSourcesMatch(transform)) return false;
        const sampling = state.paintSelectionSampling;
        const layers = action === 'layer' ? selectionLayerCanvases(session, transform.matrix, sampling) : null;
        const changed = action === 'place' ? renderTransform(transform, session)
          : renderPixelSelection(session, transform.matrix, action !== 'layer' && transform.copy, sampling, false);
        if (layers ? !layers.size : !changed) return true;
        const group = crypto.randomUUID();
        const operation = action === 'layer' ? 'core.texture.selection-layer'
          : action === 'delete' ? 'core.texture.selection-delete'
            : action === 'cut' ? 'core.texture.selection-cut'
              : transform.operation || 'core.texture.selection-transform';
        const surfaces = [...session.surfaces.values()].filter(({ asset }) => !layers || layers.has(asset));
        for (const { asset, canvas } of surfaces) pushTexturePaintHistory(asset, canvas, group, operation);
        discardPaintedTextureSync(transform.assets);
        if (layers) {
          // The preview holds the old layer tree. Reveal the recomposed tree as
          // each new layer is inserted, including frame membership changes.
          clearFloatingTextures();
          await Promise.all(surfaces.map(({ asset, canvas }) =>
            moveSelectionToLayer(asset, transform.originals.get(asset).layer, canvas, layers.get(asset))));
        } else for (const { asset, canvas } of surfaces) commitPaintedTextureAsset(asset, canvas);
        window.dispatchEvent(new Event('cubebricks:texture-change'));
        return true;
      } finally {
        clearFloatingTextures();
        releaseTransformSession(session);
      }
    }).catch(error => {
      toast(error.message);
      return false;
    });
    return trackPaintCommit(transform.project, work);
  }
  function floatingPointIsInside(transform, point, includeTransparent = false) {
    if (!point) return false;
    const { target, matrix, session, patch } = transform;
    const [x, y] = point;
    const { left, right, top, bottom } = target.clip;
    if (x < left || x >= right || y < top || y >= bottom) return false;
    const inverse = invertSelectionTransform(matrix);
    if (!inverse) return false;
    const original = mapSelectionPoint(inverse, point);
    if (patch) {
      const x = Math.floor(original[0] - target.bounds.left), y = Math.floor(original[1] - target.bounds.top);
      return x >= 0 && y >= 0 && x < patch.width && y < patch.height
        && (includeTransparent || patch.data[(y * patch.width + x) * 4 + 3] > 0);
    }
    if (!insideTarget(target, original)) return false;
    const surface = session?.surfaces.get(target.asset);
    return includeTransparent || !surface
      || surface.source.data[(Math.floor(original[1]) * target.width + Math.floor(original[0])) * 4 + 3] > 0;
  }
  function floatingGestureMatrix(transform, gesture, point, { shiftKey, ctrlKey }) {
    const { base, corner, start } = gesture, { bounds } = transform.target;
    if (corner != null && selectionHandleKinds[corner] === 'scale') {
      const inverse = invertSelectionTransform(base);
      if (!inverse) return base;
      const scaleBasis = ctrlKey ? [Math.hypot(base[0], base[1]), Math.hypot(base[2], base[3])]
        : shiftKey ? [1, 1] : null;
      const delta = selectionGestureMatrix(bounds, mapSelectionPoint(inverse, start),
        mapSelectionPoint(inverse, point), corner, { scaleBasis });
      return multiplySelectionTransforms(base, delta);
    }
    const [cx, cy] = mapSelectionPoint(base, [bounds.cx, bounds.cy]);
    const rotationStep = ctrlKey ? Math.PI / 12 : shiftKey ? 0 : Math.PI / 2;
    const rotationOffset = ctrlKey ? Math.atan2(base[1], base[0]) : 0;
    return multiplySelectionTransforms(selectionGestureMatrix({ cx, cy }, start, point, corner, { rotationStep, rotationOffset }), base);
  }
  function transformCommand(options) {
    if (drag || commandPending || state.mode !== 'paint' || state.tool !== 'paintSelection') return;
    const previous = pendingPaintCommit(state.project);
    if (previous) {
      const project = state.project;
      void previous.then(() => { if (state.project === project) transformCommand(options); });
      return;
    }
    const target = floating?.target || displayTransform(focusSource)?.target || textureTarget();
    if (!target?.bounds) return;
    if (floating && !transformIsCurrent(floating)) {
      discardTransform();
      return;
    }
    const transform = floating || liftTransform(target, target.frame ? 'scene' : 'texture');
    const [cx, cy] = mapSelectionPoint(transform.matrix, [target.bounds.cx, target.bounds.cy]);
    transform.matrix = multiplySelectionTransforms(selectionTransformMatrix({ cx, cy }, options), transform.matrix);
    queueTransformPreview(transform);
    drawSceneGesture();
    drawBorder();
  }

  function sameTargetFace(a, b) {
    return a && b && a.faceName === b.faceName && (a.cubeUid || a.uid) === (b.cubeUid || b.uid);
  }

  function openPixelMenu(event, source) {
    if (state.mode !== 'paint' || state.tool !== 'paintSelection' || drag || commandPending) return;
    if (floating && !transformIsCurrent(floating)) discardTransform();
    const client = [event.clientX, event.clientY];
    const target = source === 'texture' ? textureTarget(!floating) : faceTarget(sceneHit(...client));
    const point = target && targetPoint(target, client);
    const handle = floating && handleAt(source, client);
    if (floating) {
      const origin = floating.target;
      const onTarget = target?.asset === origin.asset
        && (source === 'texture' || !origin.hit || sameTargetFace(origin.hit, target.hit));
      if (!handle && (!onTarget || !floatingPointIsInside(floating, point, true))) return;
    } else if (!state.paintSelection.active || !insideTarget(target, point)) return;

    const context = {
      target: target || floating.target, point: point || targetPoint(floating.target, client),
      source, floating, project: state.project, textureUid: state.activeTextureUid
    };
    const item = (label, command, properties = {}) => ({
      label: translateUiKey(`ui.selection-${label}`), ...properties,
      action: () => { void runPixelCommand(command, context); }
    });
    const items = [
      item('copy-pixels', 'copy'),
      item('duplicate-pixels', 'duplicate'),
      item('paste-pixels', 'paste', { disabled: !clipboard || !context.point })
    ];
    if (floating) items.push({ separator: true }, item('move-to-new-layer', 'layer'),
      item('delete-pixels', 'delete', { danger: true }));
    event.stopImmediatePropagation();
    showContextMenu(event, { items });
  }

  async function runPixelCommand(command, context) {
    const { target, source, point, project, textureUid, floating: original } = context;
    const currentWorkspace = () => state.project === project && state.activeTextureUid === textureUid
      && state.mode === 'paint' && state.tool === 'paintSelection' && state.textureAssets.includes(target.asset);
    if (commandPending || !currentWorkspace() || floating !== original) return;
    if (!original && state.paintSelection.masks.get(target.asset._uid) !== target.mask) return;
    commandPending = true;
    try {
      if (command === 'delete' || command === 'layer') {
        await placeTransform(command);
        return;
      }
      let patch = clipboard;
      if (command !== 'paste') {
        const transform = original || prepareTransform(target, source, null, false);
        const session = await transform.ready;
        let placing = false;
        try {
          if (!session || floating !== original || !currentWorkspace() || !transformSourcesMatch(transform)) return;
          patch = captureSelectionPatch(session, transform.matrix, state.paintSelectionSampling);
          if (command === 'copy' || command === 'cut') {
            if (patch) clipboard = patch;
            if (command === 'cut' && patch) {
              if (!original) {
                transform.copy = false;
                activateTransform(transform);
              }
              placing = true;
              await placeTransform('cut');
            }
            return;
          }
        } finally {
          if (!original && !placing) releaseTransformSession(session);
        }
      }
      if (!patch || !currentWorkspace() || floating !== original) return;
      if (original && !await placeTransform()) return;
      if (!currentWorkspace()) return;
      const inPlace = command === 'duplicate';
      const destination = inPlace && original ? original.target : target;
      const left = inPlace ? patch.left : Math.round(point[0] - patch.width / 2);
      const top = inPlace ? patch.top : Math.round(point[1] - patch.height / 2);
      const bounds = {
        left, top, right: left + patch.width - 1, bottom: top + patch.height - 1,
        cx: left + patch.width / 2, cy: top + patch.height / 2
      };
      const transform = liftTransform({ ...destination, bounds }, inPlace && original ? original.source : source, patch);
      transform.operation = inPlace ? 'core.texture.selection-duplicate' : 'core.texture.selection-paste';
      queueTransformPreview(transform);
    } catch (error) {
      toast(error.message);
    } finally {
      commandPending = false;
    }
  }

  function handleShortcut(command, { repeat = false, allowUnselectedPaste = false } = {}) {
    if (state.mode !== 'paint' || state.tool !== 'paintSelection') return false;
    if (floating && !transformIsCurrent(floating)) discardTransform();
    if (command === 'delete') {
      if (!floating) return false;
      if (!commandPending && !repeat) void placeTransform('delete');
      return true;
    }
    const target = floating?.target || textureTarget()
      || (command === 'paste' && clipboard && allowUnselectedPaste ? textureTarget(false) : null);
    if (!target) return false;
    if (commandPending || repeat || drag && !floating) return true;
    const center = target.bounds ? [target.bounds.cx, target.bounds.cy] : [target.width / 2, target.height / 2];
    const point = floating ? mapSelectionPoint(floating.matrix, center) : center;
    void runPixelCommand(command, {
      target, point, source: floating?.source || 'texture', floating,
      project: state.project, textureUid: state.activeTextureUid
    });
    return true;
  }

  function begin(event, source) {
    if (state.mode !== 'paint' || state.tool !== 'paintSelection' || drag) return;
    const surface = source === 'texture' ? texturePreview : sceneCanvas;
    if (event.button !== 0) {
      setHandleCursor(surface, null);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (commandPending) return;
    const client = [event.clientX, event.clientY], point = source === 'texture' ? texturePoint(...client) : client;
    if (floating && !transformIsCurrent(floating)) discardTransform();
    const handle = handleAt(source, client);
    const faceHit = source === 'scene' ? sceneHit(...client) : null;
    if (floating) {
      const target = floating.target;
      const usingHandle = handle;
      const sameFace = source === 'texture' || sameTargetFace(target.hit, faceHit);
      const start = floating.source === source && (usingHandle || sameFace) ? targetPoint(target, client) : null;
      const grabbing = start && (usingHandle || !event.shiftKey && !event.ctrlKey && floatingPointIsInside(floating, start));
      surface.setPointerCapture(event.pointerId);
      drag = { source, pointerId: event.pointerId, client, points: [point] };
      if (grabbing) {
        drag.transform = floating;
        drag.gesture = { start, corner: usingHandle ? handle.corner : null, base: floating.matrix };
        setHandleCursor(surface, usingHandle, true);
      } else {
        setHandleCursor(surface, null);
        drag.place = !event.shiftKey && !event.ctrlKey;
        drag.outside = true;
      }
      return;
    }
    const target = handle?.target || (source === 'texture' ? textureTarget() : faceTarget(faceHit));
    const start = target && targetPoint(target, client);
    const usingHandle = handle;
    focusSource = source;
    if (target?.bounds && start && (usingHandle || !event.shiftKey && !event.ctrlKey && insideTarget(target, start))) {
      surface.setPointerCapture(event.pointerId);
      if (target.hit) sceneFocus = { project: state.project, hit: target.hit };
      drag = {
        source, pointerId: event.pointerId, points: [point], client, transform: { target },
        gesture: { start, corner: usingHandle ? handle.corner : null, base: IDENTITY }
      };
      setHandleCursor(surface, usingHandle, true);
      drawSceneGesture();
      drawBorder();
      return;
    }
    setHandleCursor(surface, null);
    const operation = event.ctrlKey ? 'erase' : 'add';
    let singleFace = null;
    if (source === 'scene' && state.paintSelectionMode === 'rectangle') {
      if (!faceHit?.faceName) {
        if (!event.shiftKey && !event.ctrlKey) clear();
        return;
      }
      singleFace = `${faceHit.cubeUid || faceHit.uid}:${faceHit.faceName}`;
    }
    surface.setPointerCapture(event.pointerId);
    if (!event.ctrlKey && !event.shiftKey) clear();
    state.paintSelection.active = true;
    sceneMaskDirty = true;
    drag = {
      source, pointerId: event.pointerId, operation, mode: state.paintSelectionMode,
      points: [point], singleFace, faceFrame: faceRectangleFrame(faceHit), faceHit, client,
      visited: source === 'scene' && state.paintSelectionMode === 'brush' ? new Set() : null
    };
    if (drag.mode === 'brush') brushLine(point, point, source, operation);
    drawSceneGesture();
    renderOverlay();
    ensureAnimation();
  }
  function move(event, source) {
    if (!drag) {
      const client = [event.clientX, event.clientY];
      const handle = event.buttons ? null : handleAt(source, client);
      setHandleCursor(source === 'texture' ? texturePreview : sceneCanvas, handle);
      if (source !== 'scene') return;
      cancelSceneHover();
      if (state.mode !== 'paint' || state.tool !== 'paintSelection'
        || !state.paintSelection.active || event.buttons || handle) return;
      sceneHoverFrame = requestAnimationFrame(() => {
        sceneHoverFrame = null;
        if (drag || state.tool !== 'paintSelection') return;
        const hit = sceneHit(...client);
        if (faceTarget(hit)?.bounds) {
          sceneFocus = { project: state.project, hit };
          drawSceneGesture();
          setHandleCursor(sceneCanvas, handleAt('scene', client));
        }
      });
      return;
    }
    if (drag.source !== source || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const distance = Math.hypot(event.clientX - drag.client[0], event.clientY - drag.client[1]);
    if (drag.outside) {
      if (distance >= 3) drag.place = false;
      return;
    }
    const point = source === 'texture' ? texturePoint(event.clientX, event.clientY) : [event.clientX, event.clientY];
    if (drag.transform) {
      if (!drag.moved && distance < 3) return;
      drag.moved = true;
      const transform = floating || liftTransform(drag.transform.target, source);
      if (!transformIsCurrent(transform)) {
        discardTransform();
        return;
      }
      drag.transform = transform;
      const current = targetPoint(transform.target, [event.clientX, event.clientY]);
      if (!current) return;
      const matrix = floatingGestureMatrix(transform, drag.gesture, current, event);
      if (matrix.some((value, index) => value !== transform.matrix[index])) {
        transform.matrix = matrix;
        queueTransformPreview(transform);
      }
      drawSceneGesture();
      drawBorder();
      return;
    }
    if (drag.mode === 'brush') brushLine(drag.points.at(-1), point, source, drag.operation);
    drag.points.push(point);
    drawSceneGesture();
    renderOverlay();
  }
  function end(event, source) {
    if (!drag || drag.source !== source || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = source === 'texture' ? texturePoint(event.clientX, event.clientY) : [event.clientX, event.clientY];
    if (drag.transform || drag.outside) {
      if (event.type === 'pointerup') {
        move(event, source);
        if (!drag) return;
        if (drag.place && floating) {
          placeTransform();
          return;
        }
      }
    }
    else if (event.type === 'pointerup' && drag.mode !== 'brush') applyArea(point);
    if (drag.faceHit && !drag.transform) sceneFocus = { project: state.project, hit: drag.faceHit };
    const surface = source === 'texture' ? texturePreview : sceneCanvas;
    drag = null;
    drawSceneGesture();
    setHandleCursor(surface, event.type === 'pointerup' ? handleAt(source, [event.clientX, event.clientY]) : null);
    sceneMaskDirty = true;
    if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    renderOverlay();
  }
  function bind() {
    for (const [source, surface] of [['texture', texturePreview], ['scene', sceneCanvas]]) {
      surface?.addEventListener('pointerdown', event => begin(event, source), true);
      surface?.addEventListener('pointermove', event => move(event, source), true);
      surface?.addEventListener('pointerup', event => end(event, source), true);
      surface?.addEventListener('pointercancel', event => end(event, source), true);
      surface?.addEventListener('pointerleave', () => {
        if (drag?.source !== source) setHandleCursor(surface, null);
        if (source === 'scene') cancelSceneHover();
      });
      surface?.addEventListener('contextmenu', event => openPixelMenu(event, source), true);
      surface?.addEventListener('lostpointercapture', event => {
        if (drag?.source !== source || drag.pointerId !== event.pointerId) return;
        drag = null;
        setHandleCursor(surface, null);
        drawSceneGesture();
        sceneMaskDirty = true;
        renderOverlay();
      }, true);
    }
    window.addEventListener('blur', () => {
      drag = null;
      clearHandleCursors();
      drawSceneGesture();
      sceneMaskDirty = true;
      renderOverlay();
    });
    $('#paintSelectionMode')?.addEventListener('change', event => {
      state.paintSelectionMode = event.target.value;
      updateToolOptions();
    });
    $('#paintSelectionCopy')?.addEventListener('click', () => {
      state.paintSelectionCopy = !state.paintSelectionCopy;
      updateToolOptions();
    });
    $('#paintSelectionRotateLeft')?.addEventListener('click', () => transformCommand({ angle: -Math.PI / 2 }));
    $('#paintSelectionRotateRight')?.addEventListener('click', () => transformCommand({ angle: Math.PI / 2 }));
    $('#paintSelectionFlipX')?.addEventListener('click', () => transformCommand({ scaleX: -1 }));
    $('#paintSelectionFlipY')?.addEventListener('click', () => transformCommand({ scaleY: -1 }));
    $('#paintSelectionSampling')?.addEventListener('change', event => {
      configRegistry.set(ConfigKey.PAINT_SELECTION_SAMPLING, event.target.value, { source: 'toolbar' });
    });
    configRegistry.subscribe(ConfigKey.PAINT_SELECTION_SAMPLING, ({ value }) => {
      state.paintSelectionSampling = value;
      $('#paintSelectionSampling').value = value;
      if (floating) queueTransformPreview(floating);
    });
    $('#paintSelectionBrushSize')?.addEventListener('change', event => { state.paintSelectionBrushSize = Math.max(1, Math.min(128, Number(event.target.value) || 18)); });
    $('#paintSelectionSymmetry')?.addEventListener('change', event => { state.paintSelectionSymmetry = event.target.checked; });
    $('#paintSelectionClear')?.addEventListener('click', clear);
    window.addEventListener('cubebricks:texture-change', () => {
      if (floating && !transformIsCurrent(floating)) discardTransform();
      if (!drag) clearHandleCursors();
      renderOverlay();
    });
    window.addEventListener('cubebricks:atlas-change', () => {
      sceneMaskDirty = true;
      renderOverlay();
    });
    window.addEventListener('cubebricks:texture-view-change', drawBorder);
    ensureAnimation();
  }
  function finishActive() {
    clearHandleCursors();
    if (discardTransform()) return true;
    if (!drag) return;
    const { client, pointerId, source } = drag;
    end({
      type: 'pointercancel', clientX: client[0], clientY: client[1], pointerId,
      preventDefault() {}, stopImmediatePropagation() {}
    }, source);
  }
  return { bind, clear, renderOverlay, drawSceneGesture, finishActive, handleShortcut };
}
