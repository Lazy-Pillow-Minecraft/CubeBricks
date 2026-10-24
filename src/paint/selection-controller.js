// Paint selections are pixel masks indexed by texture asset. They are editor
// state, never baked into a model or its textures.
import { tiledFaceRaster } from '../common/core/texture-features.js';
import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv } from '../render/webgl-renderer.js';
import { selectionBounds, transformSelectedPixels } from './selection-transform.js';
import { SELECTION_STRIPE_SIZE, SELECTION_STRIPE_PIXELS, selectionStripePhase } from '../utils/selection-stripes.js';

const FACE_TRIANGLES = [[0, 2, 1], [2, 3, 1]];
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
  const normalLengthSquared = dot(normal, normal);
  if (uLengthSquared < 1e-10 || vLengthSquared < 1e-10 || normalLengthSquared < 1e-10) return null;
  return { origin, uAxis, vAxis, normal, uLengthSquared, vLengthSquared,
    normalLengthSquared, points: hit.facePoints, anchor: hit.point };
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
  return [dot(offset, frame.uAxis) / frame.uLengthSquared,
    dot(offset, frame.vAxis) / frame.vLengthSquared];
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
  textureCanvas, textureCtx, clientToTextureUv, textureAssetForReference, facePaintUvPoint,
  paintSymmetryRelatedHits, getTextureAtlasEntries, getTextureAtlasCanvas,
  scheduleSceneRender, updateToolOptions, pushTexturePaintHistory, commitPaintedTextureAsset }) {
  const texturePreview = $('#texturePreview');
  const overlay = $('#paintSelectionTextureOverlay');
  const border = $('#paintSelectionBorder');
  const sceneGesture = $('#paintSelectionGesture');
  const textureStage = $('#textureStage');
  let drag = null;
  let animation = null;
  let renderFrame = null;
  let edges = [];
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
    x = Math.floor(x); y = Math.floor(y);
    if (!mask || x < 0 || y < 0 || x >= mask.width || y >= mask.height) return;
    const index = y * mask.width + x;
    const value = operation === 'erase' ? 0 : 1;
    if (mask.pixels[index] !== value) { mask.pixels[index] = value; mask.revision = (mask.revision || 0) + 1; }
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
    const width = Math.max(1, Math.round(previewRect.width * pixelRatio));
    const height = Math.max(1, Math.round(previewRect.height * pixelRatio));
    if (border.width !== width) border.width = width;
    if (border.height !== height) border.height = height;
    const context = border.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    stripePattern.setTransform(new DOMMatrix().translate(
      -previewRect.left + selectionStripePhase(), -previewRect.top));
    const originX = stageRect.left - previewRect.left, originY = stageRect.top - previewRect.top;
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
    if (drag?.source === 'texture' && drag.mode !== 'brush' && drag.points.length > 1) {
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
    sceneGesture.hidden = !drag || state.mode !== 'paint' || state.tool !== 'paintSelection'
      || drag.source !== 'scene' || drag.mode === 'brush' || drag.points.length < 2;
    if (sceneGesture.hidden) { sceneGesture.replaceChildren(); return; }
    const rect = sceneCanvas.getBoundingClientRect();
    sceneGesture.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    let points;
    if (drag.mode === 'rectangle' && drag.faceFrame) {
      const frame = drag.faceFrame;
      const end = scenePlanePoint(drag.points.at(-1), frame);
      if (!end) { sceneGesture.hidden = true; return; }
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
    const placements = entries.length ? entries : [{ uid: state.activeTextureUid, x: 0, y: 0,
      width: textureCanvas.width, height: textureCanvas.height }];
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
    if (!drag) updateSceneMask();
    const asset = activeAsset();
    const selection = state.paintSelection;
    const mask = asset && selection.masks.get(asset._uid);
    overlay.hidden = state.mode !== 'paint' || !selection.active;
    if (border) border.hidden = overlay.hidden;
    if (overlay.hidden) return;
    const width = textureCanvas.width, height = textureCanvas.height;
    if (overlayMask === mask && overlayRevision === (mask?.revision || 0)
      && overlayAssetUid === asset?._uid && overlay.width === width && overlay.height === height) {
      drawBorder(); return;
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
      if (!matches?.[index]) { image.data[offset + 3] = 100; continue; }
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
    renderFrame = window.setTimeout(() => { renderFrame = null; renderOverlayNow(); }, drag ? 90 : 0);
  }
  function ensureAnimation() {
    if (animation !== null) return;
    animation = window.setInterval(() => {
      if (overlay?.hidden !== (state.mode !== 'paint' || !state.paintSelection.active)) renderOverlay();
      if (sceneGesture && (state.mode !== 'paint' || state.tool !== 'paintSelection') && !sceneGesture.hidden) {
        drag = null;
        sceneGesture.hidden = true;
        sceneGesture.replaceChildren();
      }
      if (!state.paintSelection.active || state.mode !== 'paint') return;
      if (sceneGesture && !sceneGesture.hidden) drawSceneGesture();
      if (edges.length < 20000) drawBorder();
      // The 3D marching border does not need to rebuild the whole scene here.
    }, 140);
  }
  function clear() {
    state.paintSelection = { active: false, masks: new Map() };
    sceneMaskDirty = true;
    overlayMask = null;
    if (sceneGesture) { sceneGesture.hidden = true; sceneGesture.replaceChildren(); }
    renderOverlay();
  }
  function finishTransform() {
    if (!drag?.transform) return;
    const { asset, changed } = drag.transform;
    if (changed) {
      commitPaintedTextureAsset(asset, textureCanvas);
      sceneMaskDirty = true;
      window.dispatchEvent(new Event('cubebricks:texture-change'));
    }
  }
  function applyTransformPreview(transform, dx, dy, angle) {
    if (!transform.historyPushed && (dx || dy || angle)) {
      pushTexturePaintHistory(transform.asset, textureCanvas, null, 'core.texture.selection-transform');
      transform.historyPushed = true;
    }
    if (!transform.historyPushed) return;
    const result = transformSelectedPixels(transform.source, transform.mask,
      textureCanvas.width, textureCanvas.height, { dx, dy, angle, copy: transform.copy,
        bounds: transform.bounds });
    textureCtx.putImageData(new ImageData(result.pixels, textureCanvas.width, textureCanvas.height), 0, 0);
    state.paintSelection.masks.set(transform.asset._uid,
      { width: textureCanvas.width, height: textureCanvas.height, pixels: result.mask });
    transform.changed = true;
    renderOverlay();
  }
  function rotateQuarter(turns) {
    const asset = activeAsset(), mask = asset && state.paintSelection.masks.get(asset._uid);
    if (!mask || mask.width !== textureCanvas.width || mask.height !== textureCanvas.height
      || !selectionBounds(mask.pixels, mask.width, mask.height)) return;
    pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.selection-transform');
    const source = textureCtx.getImageData(0, 0, textureCanvas.width, textureCanvas.height).data;
    const result = transformSelectedPixels(source, mask.pixels, mask.width, mask.height,
      { angle: turns * Math.PI / 2, copy: state.paintSelectionCopy });
    textureCtx.putImageData(new ImageData(result.pixels, mask.width, mask.height), 0, 0);
    state.paintSelection.masks.set(asset._uid, { width: mask.width, height: mask.height, pixels: result.mask });
    commitPaintedTextureAsset(asset, textureCanvas);
    sceneMaskDirty = true;
    renderOverlay();
    window.dispatchEvent(new Event('cubebricks:texture-change'));
  }
  function begin(event, source) {
    if (state.mode !== 'paint' || state.tool !== 'paintSelection' || event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const surface = source === 'texture' ? texturePreview : sceneCanvas;
    const point = source === 'texture' ? texturePoint(event.clientX, event.clientY) : [event.clientX, event.clientY];
    if (state.paintSelectionMode === 'transform') {
      if (source !== 'texture') return;
      const asset = activeAsset(), mask = asset && state.paintSelection.masks.get(asset._uid);
      const bounds = mask && selectionBounds(mask.pixels, mask.width, mask.height);
      if (!bounds || mask.width !== textureCanvas.width || mask.height !== textureCanvas.height) return;
      const px = Math.floor(point[0]), py = Math.floor(point[1]);
      if (px < 0 || py < 0 || px >= mask.width || py >= mask.height || !mask.pixels[py * mask.width + px]) return;
      surface.setPointerCapture(event.pointerId);
      drag = { source, pointerId: event.pointerId, mode: 'transform', points: [point],
        transform: { asset, bounds, start: point, source: new Uint8ClampedArray(
          textureCtx.getImageData(0, 0, mask.width, mask.height).data), mask: mask.pixels.slice(),
          copy: state.paintSelectionCopy, historyPushed: false, changed: false } };
      return;
    }
    const operation = event.ctrlKey ? 'erase' : 'add';
    let singleFace = null;
    let faceHit = null;
    if (source === 'scene' && state.paintSelectionMode === 'rectangle') {
      const rect = sceneCanvas.getBoundingClientRect();
      faceHit = sceneRenderer.pickDetailed(state.project, event.clientX - rect.left, event.clientY - rect.top, true);
      if (!faceHit?.faceName) return;
      singleFace = `${faceHit.cubeUid || faceHit.uid}:${faceHit.faceName}`;
    }
    surface.setPointerCapture(event.pointerId);
    if (!event.ctrlKey && !event.shiftKey) clear();
    state.paintSelection.active = true;
    sceneMaskDirty = true;
    drag = { source, pointerId: event.pointerId, operation, mode: state.paintSelectionMode,
      points: [point], singleFace, faceFrame: faceRectangleFrame(faceHit), faceHit,
      visited: source === 'scene' && state.paintSelectionMode === 'brush' ? new Set() : null };
    if (drag.mode === 'brush') brushLine(point, point, source, operation);
    drawSceneGesture();
    renderOverlay(); ensureAnimation();
  }
  function move(event, source) {
    if (!drag || drag.source !== source || drag.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const point = source === 'texture' ? texturePoint(event.clientX, event.clientY) : [event.clientX, event.clientY];
    if (drag.mode === 'transform') {
      const transform = drag.transform;
      if (state.paintSelectionTransformMode === 'rotate') {
        const center = transform.bounds;
        const startAngle = Math.atan2(transform.start[1] - center.cy, transform.start[0] - center.cx);
        let angle = Math.atan2(point[1] - center.cy, point[0] - center.cx) - startAngle;
        if (!state.paintSelectionFreeRotate) angle = Math.round(angle / (Math.PI / 2)) * Math.PI / 2;
        applyTransformPreview(transform, 0, 0, angle);
      } else applyTransformPreview(transform,
        Math.round(point[0] - transform.start[0]), Math.round(point[1] - transform.start[1]), 0);
      return;
    }
    if (drag.mode === 'brush') brushLine(drag.points.at(-1), point, source, drag.operation);
    drag.points.push(point);
    drawSceneGesture();
    renderOverlay();
  }
  function end(event, source) {
    if (!drag || drag.source !== source || drag.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const point = source === 'texture' ? texturePoint(event.clientX, event.clientY) : [event.clientX, event.clientY];
    if (drag.mode === 'transform') finishTransform();
    else if (drag.mode !== 'brush') applyArea(point);
    const surface = source === 'texture' ? texturePreview : sceneCanvas;
    drag = null;
    drawSceneGesture();
    if (sceneGesture) sceneGesture.replaceChildren();
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
      surface?.addEventListener('lostpointercapture', event => {
        if (drag?.source !== source || drag.pointerId !== event.pointerId) return;
        if (drag.mode === 'transform') finishTransform();
        drag = null;
        if (sceneGesture) { sceneGesture.hidden = true; sceneGesture.replaceChildren(); }
        sceneMaskDirty = true;
        renderOverlay();
      }, true);
    }
    window.addEventListener('blur', () => {
      if (drag?.mode === 'transform') finishTransform();
      drag = null;
      if (sceneGesture) { sceneGesture.hidden = true; sceneGesture.replaceChildren(); }
      sceneMaskDirty = true;
      renderOverlay();
    });
    $('#paintSelectionMode')?.addEventListener('change', event => { state.paintSelectionMode = event.target.value; updateToolOptions(); });
    $('#paintSelectionTransformMode')?.addEventListener('change', event => { state.paintSelectionTransformMode = event.target.value; updateToolOptions(); });
    $('#paintSelectionFreeRotate')?.addEventListener('change', event => { state.paintSelectionFreeRotate = event.target.checked; });
    $('#paintSelectionCopy')?.addEventListener('click', () => { state.paintSelectionCopy = !state.paintSelectionCopy; updateToolOptions(); });
    $('#paintSelectionRotateLeft')?.addEventListener('click', () => rotateQuarter(-1));
    $('#paintSelectionRotateRight')?.addEventListener('click', () => rotateQuarter(1));
    $('#paintSelectionBrushSize')?.addEventListener('change', event => { state.paintSelectionBrushSize = Math.max(1, Math.min(128, Number(event.target.value) || 18)); });
    $('#paintSelectionSymmetry')?.addEventListener('change', event => { state.paintSelectionSymmetry = event.target.checked; });
    $('#paintSelectionClear')?.addEventListener('click', clear);
    window.addEventListener('cubebricks:texture-change', renderOverlay);
    window.addEventListener('cubebricks:atlas-change', () => { sceneMaskDirty = true; renderOverlay(); });
    window.addEventListener('cubebricks:texture-view-change', drawBorder);
    ensureAnimation();
  }
  return { bind, clear, renderOverlay };
}
