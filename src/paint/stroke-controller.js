import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv, isCubeFaceCulled } from '../render/webgl-renderer.js';
import { activeLayer, compositeLayers } from '../common/core/texture-features.js';
import { requireOperation } from '../common/core/operation-registry.js';
import { PAINT_TOOLS, PAINT_SHAPE_TOOLS } from '../editor/tool-registry.js';

export function createPaintStrokeController({
  state, $, $$, textureCanvas, textureCtx, uvEditorController,
  clientToTextureUv, clamp, isFaceTiled, faceUvWorldPoint,
  paintSetting, paintToolErasing, paintToolOpacity, PAINT_FACE_EDGES,
  CUBE_FACE_NAMES, textureAtlasReferences, effectiveFaceTextureReference,
  textureAssetForReference, paintCanvasForAsset, syncRendererTextureAsset,
  scheduleSceneRender, uvPreviewIsActive, renderUvPreview,
  updateTexturePreviewFrame, noteJournalOperation, markDirty, toast,
  renderScene, invalidateAllRenderGeometry, paintHitAlphaCache
}) {
const paintBrushOffsetCache = new Map();
const PAINT_FACE_LAYOUTS = Object.freeze({
  south: [7, 6, 4, 5], north: [2, 3, 1, 0], east: [6, 2, 5, 1],
  west: [3, 7, 0, 4], up: [3, 2, 7, 6], down: [4, 5, 0, 1]
});
let texturePaintSyncFrame = null;
const texturePaintSyncTargets = new Map();

function paintBrushOffsets(size, shape = state.paintBrushShape, antialias = state.paintBrushAa) {
  const normalized = clamp(Math.round(size) || 1, 1, 64);
  const key = `${normalized}:${shape}:${antialias ? 1 : 0}`;
  if (paintBrushOffsetCache.has(key)) return paintBrushOffsetCache.get(key);
  const offsets = [];
  const center = (normalized - 1) / 2;
  const radius = normalized / 2;
  for (let y = 0; y < normalized; y++) {
    for (let x = 0; x < normalized; x++) {
      let coverage = 1;
      if (shape === 'circle' && normalized > 1) {
        if (antialias) {
          let inside = 0;
          for (let sampleY = 0; sampleY < 4; sampleY++) for (let sampleX = 0; sampleX < 4; sampleX++) {
            const px = x - center + (sampleX + .5) / 4 - .5;
            const py = y - center + (sampleY + .5) / 4 - .5;
            if (Math.hypot(px, py) <= radius) inside++;
          }
          coverage = inside / 16;
          if (coverage <= 0) continue;
        } else if (Math.hypot(x - center, y - center) > radius) continue;
      }
      offsets.push([x - Math.floor(center), y - Math.floor(center), coverage]);
    }
  }
  paintBrushOffsetCache.set(key, offsets);
  return offsets;
}

function paintPointFromEvent(event) {
  const point = clientToTextureUv(event.clientX, event.clientY);
  return [Math.floor(point[0]), Math.floor(point[1])];
}

function paintPointInside(point) {
  return point[0] >= 0 && point[1] >= 0 && point[0] < textureCanvas.width && point[1] < textureCanvas.height;
}

function faceUvPixelSlots(cube, faceName) {
  const face = cube?.faces?.[faceName] || {};
  if (isFaceTiled(face)) return null;
  const rectangle = Array.isArray(face.uv) && face.uv.length >= 4
    ? face.uv : getBlockbenchBoxUv(cube, faceName);
  return rectangle ? createBlockbenchFaceUvSlots(rectangle, face.rotation || 0) : null;
}

function paintFaceDepthNeighbors(hit, target) {
  const sourcePoints = hit.facePoints;
  const sourceLayout = PAINT_FACE_LAYOUTS[target.faceName];
  const sourceSlots = faceUvPixelSlots(target.cube, target.faceName);
  if (sourcePoints?.length !== 4 || !sourceLayout || !sourceSlots) return [];
  const extent = Math.max(1, ...[0, 1, 2].map(axis => Math.max(...sourcePoints.map(point => point[axis]))
    - Math.min(...sourcePoints.map(point => point[axis]))));
  const neighbors = [];
  for (const [sourceFirst, sourceSecond] of PAINT_FACE_EDGES) {
    const worldStart = sourcePoints[sourceFirst], worldEnd = sourcePoints[sourceSecond];
    const cornerStart = sourceLayout[sourceFirst], cornerEnd = sourceLayout[sourceSecond];
    for (const [candidateName, candidateLayout] of Object.entries(PAINT_FACE_LAYOUTS)) {
      if (candidateName === target.faceName) continue;
      const candidateSlots = faceUvPixelSlots(target.cube, candidateName);
      if (!candidateSlots) continue;
      const pair = PAINT_FACE_EDGES.find(([first, second]) => (
        candidateLayout[first] === cornerStart && candidateLayout[second] === cornerEnd
      ) || (candidateLayout[first] === cornerEnd && candidateLayout[second] === cornerStart));
      if (!pair) continue;
      const [candidateFirst, candidateSecond] = pair;
      const forward = candidateLayout[candidateFirst] === cornerStart;
      const targetStart = candidateSlots[forward ? candidateFirst : candidateSecond];
      const targetEnd = candidateSlots[forward ? candidateSecond : candidateFirst];
      const targetCenter = candidateSlots.reduce((sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4], [0, 0]);
      const targetMidpoint = [(targetStart[0] + targetEnd[0]) / 2, (targetStart[1] + targetEnd[1]) / 2];
      const inwardRaw = [targetCenter[0] - targetMidpoint[0], targetCenter[1] - targetMidpoint[1]];
      const inwardLength = Math.hypot(...inwardRaw) || 1;
      const sourceStart = sourceSlots[sourceFirst], sourceEnd = sourceSlots[sourceSecond];
      const sourceCenter = sourceSlots.reduce((sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4], [0, 0]);
      const sourceMidpoint = [(sourceStart[0] + sourceEnd[0]) / 2, (sourceStart[1] + sourceEnd[1]) / 2];
      const sourceInwardRaw = [sourceCenter[0] - sourceMidpoint[0], sourceCenter[1] - sourceMidpoint[1]];
      const sourceInwardLength = Math.hypot(...sourceInwardRaw) || 1;
      const midpointWorld = worldStart.map((value, axis) => (value + worldEnd[axis]) / 2);
      const inwardWorld = faceUvWorldPoint(target.cube, target.faceName, sourcePoints, [
        sourceMidpoint[0] + sourceInwardRaw[0] / sourceInwardLength,
        sourceMidpoint[1] + sourceInwardRaw[1] / sourceInwardLength
      ]);
      neighbors.push({
        faceName: candidateName, sourceFacePoints: sourcePoints,
        sourceStart, sourceEnd,
        worldStart, worldEnd,
        worldPixelDepth: inwardWorld ? Math.max(1e-7, Math.hypot(...inwardWorld.map((value, axis) => value - midpointWorld[axis]))) : extent * 1e-4,
        targetStart, targetEnd,
        inward: inwardRaw.map(value => value / inwardLength)
      });
      break;
    }
  }
  return neighbors;
}

function prepareHolisticPaintSurface(surface) {
  const base = surface?.baseSurface || surface;
  if (!base?.canvas || !base.context) return null;
  if (base.strokeImage && base.strokeImage.width === base.canvas.width && base.strokeImage.height === base.canvas.height) return base;
  base.strokeImage = base.context.getImageData(0, 0, base.canvas.width, base.canvas.height);
  base.strokeBasePixels = new Uint8ClampedArray(base.strokeImage.data);
  base.strokeCoverage = new Uint8Array(base.canvas.width * base.canvas.height);
  base.strokeDirty = null;
  return base;
}

function extendPaintDirtyRect(surface, x, y) {
  const dirty = surface.strokeDirty;
  if (!dirty) surface.strokeDirty = { minX: x, minY: y, maxX: x, maxY: y };
  else {
    dirty.minX = Math.min(dirty.minX, x); dirty.minY = Math.min(dirty.minY, y);
    dirty.maxX = Math.max(dirty.maxX, x); dirty.maxY = Math.max(dirty.maxY, y);
  }
}

function flushHolisticPaintSurface(surface) {
  const base = surface?.baseSurface || surface;
  const dirty = base?.strokeDirty;
  if (!base?.strokeImage || !dirty) return;
  base.context.putImageData(base.strokeImage, 0, 0,
    dirty.minX, dirty.minY, dirty.maxX - dirty.minX + 1, dirty.maxY - dirty.minY + 1);
  base.strokeDirty = null;
}

function compositeHolisticPaintPixel(surface, x, y, coverage, tool, opacity) {
  const base = prepareHolisticPaintSurface(surface);
  if (!base) return false;
  const pixel = y * base.canvas.width + x;
  const offset = pixel * 4;
  const source = base.strokeBasePixels;
  if (state.paintIgnoreTransparent && source[offset + 3] === 0) return true;
  if (paintToolErasing(tool) && state.alphaLock) return true;
  const coverageByte = Math.round(clamp(coverage, 0, 1) * 255);
  if (coverageByte <= base.strokeCoverage[pixel]) return true;
  base.strokeCoverage[pixel] = coverageByte;
  const blend = opacity * coverageByte / 255;
  const output = base.strokeImage.data;
  const sourceAlpha = source[offset + 3] / 255;
  if (paintToolErasing(tool)) {
    output[offset] = source[offset]; output[offset + 1] = source[offset + 1]; output[offset + 2] = source[offset + 2];
    output[offset + 3] = Math.round(source[offset + 3] * (1 - blend));
  } else if (state.alphaLock) {
    const color = paintColorBytes();
    for (let channel = 0; channel < 3; channel++) output[offset + channel] = Math.round(source[offset + channel] * (1 - blend) + color[channel] * blend);
    output[offset + 3] = source[offset + 3];
  } else {
    const color = paintColorBytes();
    const outputAlpha = blend + sourceAlpha * (1 - blend);
    for (let channel = 0; channel < 3; channel++) output[offset + channel] = outputAlpha <= 0 ? 0 : Math.round(
      (color[channel] * blend + source[offset + channel] * sourceAlpha * (1 - blend)) / outputAlpha);
    output[offset + 3] = Math.round(outputAlpha * 255);
  }
  extendPaintDirtyRect(base, x, y);
  return true;
}

function drawPaintPixel(surface, x, y, coverage, tool, opacity) {
  if (!surface?.canvas || !surface.context || x < 0 || y < 0 || x >= surface.canvas.width || y >= surface.canvas.height) return;
  if (surface.rootDrag?.holisticStroke && compositeHolisticPaintPixel(surface, x, y, coverage, tool, opacity)) return;
  const context = surface.context;
  if (paintToolErasing(tool) && state.alphaLock) return;
  if (state.paintIgnoreTransparent && context.getImageData(x, y, 1, 1).data[3] === 0) return;
  context.globalAlpha = opacity * coverage;
  context.globalCompositeOperation = paintToolErasing(tool)
    ? 'destination-out' : state.alphaLock ? 'source-atop' : 'source-over';
  context.fillStyle = state.paintColor;
  context.fillRect(x, y, 1, 1);
}

function touchScenePaintSurface(surface) {
  const root = surface?.rootDrag;
  if (!root || root.historyAssets.has(surface.asset._uid)) return;
  root.historyAssets.add(surface.asset._uid);
  root.touchedSurfaces.add(surface.baseSurface || surface);
  pushTexturePaintHistory(surface.asset, surface.canvas, root.historyGroup);
}

function paintBrushDepthStamp(drag, centerX, centerY, offsets, opacity) {
  const depth = clamp(Math.round(Number(state.paintBrushDepth)) || 0, 0, 32);
  if (!depth || drag.tool !== 'brush' || !drag.paintFace?.cube || !drag.depthEdges?.length) return;
  for (const edge of drag.depthEdges) {
    const surface = edge.surface;
    if (!surface) continue;
    const sourceEdge = [edge.sourceEnd[0] - edge.sourceStart[0], edge.sourceEnd[1] - edge.sourceStart[1]];
    const sourceLengthSquared = sourceEdge[0] ** 2 + sourceEdge[1] ** 2;
    if (sourceLengthSquared < 1e-8) continue;
    const targetEdge = [edge.targetEnd[0] - edge.targetStart[0], edge.targetEnd[1] - edge.targetStart[1]];
    let touched = false;
    for (const [offsetX, offsetY, coverage] of offsets) {
      // Test the complete stamp, including pixels just outside the source UV
      // rectangle. This makes crossing a 3D cube edge deterministic instead
      // of depending on whether a clipped border pixel happened to survive.
      const sourcePoint = [centerX + offsetX + .5, centerY + offsetY + .5];
      const rawRatio = ((sourcePoint[0] - edge.sourceStart[0]) * sourceEdge[0]
        + (sourcePoint[1] - edge.sourceStart[1]) * sourceEdge[1]) / sourceLengthSquared;
      if (rawRatio < -.02 || rawRatio > 1.02) continue;
      const ratio = clamp(rawRatio, 0, 1);
      const closest = [edge.sourceStart[0] + sourceEdge[0] * ratio, edge.sourceStart[1] + sourceEdge[1] * ratio];
      if (Math.hypot(sourcePoint[0] - closest[0], sourcePoint[1] - closest[1]) > .8) continue;
      if (!touched) { touchScenePaintSurface(surface); touched = true; }
      const edgePoint = [edge.targetStart[0] + targetEdge[0] * ratio, edge.targetStart[1] + targetEdge[1] * ratio];
      for (let layer = 0; layer < depth; layer++) {
        const targetX = Math.floor(edgePoint[0] + edge.inward[0] * (layer + .5));
        const targetY = Math.floor(edgePoint[1] + edge.inward[1] * (layer + .5));
        drawPaintPixel(surface, targetX, targetY, coverage, drag.tool, opacity);
      }
    }
  }
}

function updateTextureBrushCursor(event) {
  const cursor = $('#textureBrushCursor');
  const preview = $('#texturePreview');
  const paintTool = state.mode === 'paint' && PAINT_TOOLS.includes(state.tool);
  if (!paintTool || !event || !uvEditorController.textureViewLayout) {
    cursor.hidden = true;
    preview.style.cursor = '';
    return;
  }
  const point = clientToTextureUv(event.clientX, event.clientY);
  if (point[0] < 0 || point[1] < 0 || point[0] >= textureCanvas.width || point[1] >= textureCanvas.height) {
    cursor.hidden = true;
    preview.style.cursor = '';
    return;
  }
  const previewRect = preview.getBoundingClientRect();
  const diameter = ['eyedropper', 'fill'].includes(state.tool) ? 7 : Math.max(3, paintSetting().size * uvEditorController.textureViewLayout.scale);
  cursor.style.left = `${event.clientX - previewRect.left}px`;
  cursor.style.top = `${event.clientY - previewRect.top}px`;
  cursor.style.width = `${diameter}px`;
  cursor.style.height = `${diameter}px`;
  cursor.classList.toggle('eraser', paintToolErasing());
  cursor.classList.toggle('square', state.tool === 'brush' && state.paintBrushShape === 'square');
  cursor.hidden = false;
  preview.style.cursor = 'none';
}

function syncPaintedTextureNow() {
  if (texturePaintSyncFrame !== null) cancelAnimationFrame(texturePaintSyncFrame);
  texturePaintSyncFrame = null;
  const targets = [...texturePaintSyncTargets.values()];
  texturePaintSyncTargets.clear();
  if (!targets.length) return;
  targets.forEach(target => syncRendererTextureAsset(target.asset, target.canvas));
  scheduleSceneRender();
  if (uvPreviewIsActive()) renderUvPreview();
}

function queuePaintedTextureSync(asset, canvas) {
  texturePaintSyncTargets.set(asset._uid, { asset, canvas });
  if (texturePaintSyncFrame !== null) return;
  texturePaintSyncFrame = requestAnimationFrame(syncPaintedTextureNow);
}

function drawPaintSegment(drag, from, to, sync = true) {
  const { canvas, context, asset, tool } = drag;
  const size = clamp(Math.round(paintSetting(tool).size) || 1, 1, 64);
  const opacity = paintToolOpacity(tool);
  const offsets = paintBrushOffsets(size, tool === 'brush' ? state.paintBrushShape : 'square', tool === 'brush' && state.paintBrushAa);
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const steps = Math.max(1, Math.max(Math.abs(dx), Math.abs(dy)));
  touchScenePaintSurface(drag);
  context.save();
  context.imageSmoothingEnabled = false;
  for (let step = 0; step <= steps; step++) {
    const ratio = step / steps;
    const centerX = Math.round(from[0] + dx * ratio);
    const centerY = Math.round(from[1] + dy * ratio);
    for (const [offsetX, offsetY, coverage] of offsets) {
      const x = centerX + offsetX, y = centerY + offsetY;
      const insideClip = !drag.clip || (x >= drag.clip.minU && y >= drag.clip.minV && x < drag.clip.maxU && y < drag.clip.maxV);
      if (insideClip && x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) {
        drawPaintPixel(drag, x, y, coverage, tool, opacity);
      }
    }
    paintBrushDepthStamp(drag, centerX, centerY, offsets, opacity);
  }
  context.restore();
  flushHolisticPaintSurface(drag);
  const depthSurfaces = new Set((drag.depthEdges || []).map(edge => edge.surface).filter(Boolean));
  for (const surface of depthSurfaces) flushHolisticPaintSurface(surface);
  if (sync) queuePaintedTextureSync(asset, canvas);
  if (sync) {
    for (const surface of depthSurfaces) {
      if (drag.rootDrag?.historyAssets.has(surface.asset._uid)) queuePaintedTextureSync(surface.asset, surface.canvas);
    }
  }
}

function drawPaintShape(drag, to, restoreBase = true) {
  if (!drag?.baseImage || !drag.start || !PAINT_SHAPE_TOOLS.includes(drag.tool)) return;
  if (restoreBase) {
    drag.context.putImageData(drag.baseImage, 0, 0);
    const base = drag.baseSurface || drag;
    base.strokeImage = null;
    base.strokeCoverage = null;
  }
  const [startX, startY] = drag.start;
  const [endX, endY] = to;
  if (drag.tool === 'line') drawPaintSegment(drag, drag.start, to, false);
  else if (drag.tool === 'rectangle') {
    const corners = [[startX, startY], [endX, startY], [endX, endY], [startX, endY], [startX, startY]];
    for (let index = 0; index < corners.length - 1; index++) drawPaintSegment(drag, corners[index], corners[index + 1], false);
  } else {
    const center = [(startX + endX) / 2, (startY + endY) / 2];
    const radius = [Math.abs(endX - startX) / 2, Math.abs(endY - startY) / 2];
    const steps = Math.max(16, Math.ceil(Math.PI * Math.max(radius[0], radius[1]) * 2));
    let previous = [Math.round(center[0] + radius[0]), Math.round(center[1])];
    for (let index = 1; index <= steps; index++) {
      const angle = index / steps * Math.PI * 2;
      const next = [Math.round(center[0] + Math.cos(angle) * radius[0]), Math.round(center[1] + Math.sin(angle) * radius[1])];
      drawPaintSegment(drag, previous, next, false);
      previous = next;
    }
  }
  queuePaintedTextureSync(drag.asset, drag.canvas);
}

function paintUvBounds(cube, faceName, canvas) {
  const face = cube.faces?.[faceName] || {};
  if (isFaceTiled(face)) return { minU: 0, minV: 0, maxU: canvas.width, maxV: canvas.height };
  const uv = Array.isArray(face.uv) && face.uv.length >= 4 ? face.uv : getBlockbenchBoxUv(cube, faceName);
  return {
    minU: clamp(Math.floor(Math.min(uv[0], uv[2])), 0, canvas.width),
    minV: clamp(Math.floor(Math.min(uv[1], uv[3])), 0, canvas.height),
    maxU: clamp(Math.ceil(Math.max(uv[0], uv[2])), 0, canvas.width),
    maxV: clamp(Math.ceil(Math.max(uv[1], uv[3])), 0, canvas.height)
  };
}

function fillPaintRects(result, asset, rectangles) {
  const { canvas, context } = result;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const color = paintColorBytes(), opacity = paintToolOpacity('fill');
  for (const rectangle of rectangles) {
    const minX = clamp(Math.floor(rectangle.minU), 0, canvas.width), maxX = clamp(Math.ceil(rectangle.maxU), 0, canvas.width);
    const minY = clamp(Math.floor(rectangle.minV), 0, canvas.height), maxY = clamp(Math.ceil(rectangle.maxV), 0, canvas.height);
    for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) blendPaintPixel(image.data, (y * canvas.width + x) * 4, color, opacity, 'fill');
  }
  context.putImageData(image, 0, 0);
  queuePaintedTextureSync(asset, result.canvas);
}

function paintColorBytes() {
  const value = state.paintColor.slice(1);
  return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16));
}

function blendPaintPixel(data, offset, color, opacity, tool = 'fill') {
  const destinationAlpha = data[offset + 3] / 255;
  if (state.paintIgnoreTransparent && destinationAlpha <= 0) return;
  if (paintToolErasing(tool)) {
    if (!state.alphaLock) data[offset + 3] = Math.round(data[offset + 3] * (1 - opacity));
    return;
  }
  if (state.alphaLock && destinationAlpha <= 0) return;
  if (state.alphaLock) {
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(data[offset + channel] * (1 - opacity) + color[channel] * opacity);
    return;
  }
  const outputAlpha = opacity + destinationAlpha * (1 - opacity);
  for (let channel = 0; channel < 3; channel++) data[offset + channel] = outputAlpha <= 0 ? 0 : Math.round(
    (color[channel] * opacity + data[offset + channel] * destinationAlpha * (1 - opacity)) / outputAlpha);
  data[offset + 3] = Math.round(outputAlpha * 255);
}

function replacePaintColor(result, point, contiguous, clip = null) {
  const { canvas, context } = result;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const startX = clamp(Math.floor(point[0]), 0, canvas.width - 1);
  const startY = clamp(Math.floor(point[1]), 0, canvas.height - 1);
  const startOffset = (startY * canvas.width + startX) * 4;
  const target = [...image.data.slice(startOffset, startOffset + 4)];
  const matches = pixel => {
    const offset = pixel * 4;
    return image.data[offset] === target[0] && image.data[offset + 1] === target[1]
      && image.data[offset + 2] === target[2] && image.data[offset + 3] === target[3];
  };
  const insideClip = (x, y) => !clip || (x >= clip.minU && y >= clip.minV && x < clip.maxU && y < clip.maxV);
  const color = paintColorBytes();
  const opacity = paintToolOpacity('fill');
  if (!contiguous) {
    for (let pixel = 0; pixel < canvas.width * canvas.height; pixel++) {
      const x = pixel % canvas.width, y = Math.floor(pixel / canvas.width);
      if (insideClip(x, y) && matches(pixel)) blendPaintPixel(image.data, pixel * 4, color, opacity);
    }
  } else {
    const visited = new Uint8Array(canvas.width * canvas.height);
    const pending = [startY * canvas.width + startX];
    while (pending.length) {
      const pixel = pending.pop();
      const x = pixel % canvas.width, y = Math.floor(pixel / canvas.width);
      if (visited[pixel] || !insideClip(x, y) || !matches(pixel)) continue;
      visited[pixel] = 1;
      blendPaintPixel(image.data, pixel * 4, color, opacity);
      if (x > 0) pending.push(pixel - 1);
      if (x + 1 < canvas.width) pending.push(pixel + 1);
      if (y > 0) pending.push(pixel - canvas.width);
      if (y + 1 < canvas.height) pending.push(pixel + canvas.width);
    }
  }
  context.putImageData(image, 0, 0);
}

function allTextureUvEntriesForAsset(asset) {
  const references = new Set(textureAtlasReferences(asset, state.textureAssets.indexOf(asset))
    .flatMap(reference => [reference, reference.startsWith('#') ? reference.slice(1) : `#${reference}`]));
  const entries = [];
  for (const cube of state.project.elements.filter(element => element.type === 'cube')) {
    for (const faceName of CUBE_FACE_NAMES) {
      const face = cube.faces?.[faceName];
      if (isFaceTiled(face)) continue;
      if (isCubeFaceCulled(face) || !references.has(String(effectiveFaceTextureReference(face)))) continue;
      const uv = Array.isArray(face?.uv) && face.uv.length >= 4 ? face.uv.map(Number) : getBlockbenchBoxUv(cube, faceName).map(Number);
      entries.push({ cube, faceName, uv });
    }
  }
  return entries;
}

async function paintBucketAsset(asset, point, rectangles = null, contiguous = false, clip = null) {
  const result = asset._uid === state.activeTextureUid
    ? { canvas: textureCanvas, context: textureCtx }
    : await paintCanvasForAsset(asset);
  if (!result) return false;
  pushTexturePaintHistory(asset, result.canvas);
  if (rectangles) fillPaintRects(result, asset, rectangles);
  else {
    replacePaintColor(result, point, contiguous, clip);
    queuePaintedTextureSync(asset, result.canvas);
  }
  syncPaintedTextureNow();
  commitPaintedTextureAsset(asset, result.canvas);
  return true;
}

async function paintBucketElement(cube) {
  const byAsset = new Map();
  for (const faceName of CUBE_FACE_NAMES) {
    const existing = cube.faces?.[faceName];
    if (isCubeFaceCulled(existing)) continue;
    const asset = textureAssetForReference(existing?.texture);
    if (!asset) continue;
    const list = byAsset.get(asset) || [];
    list.push(faceName);
    byAsset.set(asset, list);
  }
  let painted = 0;
  for (const [asset, faceNames] of byAsset) {
    const result = asset._uid === state.activeTextureUid
      ? { canvas: textureCanvas, context: textureCtx }
      : await paintCanvasForAsset(asset);
    if (!result) continue;
    pushTexturePaintHistory(asset, result.canvas);
    fillPaintRects(result, asset, faceNames.map(faceName => paintUvBounds(cube, faceName, result.canvas)));
    syncPaintedTextureNow();
    commitPaintedTextureAsset(asset, result.canvas);
    painted++;
  }
  if (painted) {
    invalidateAllRenderGeometry();
    markDirty();
    renderScene();
  }
  return painted > 0;
}

async function applyTextureBucket(asset, point, hitEntry = null) {
  if (state.paintBucketScope === 'element') {
    if (!hitEntry?.cube) return toast('請指向一個元素的貼圖面');
    if (!await paintBucketElement(hitEntry.cube)) toast('這個元素沒有可繪畫的貼圖');
    return;
  }
  if (state.paintBucketScope === 'face') {
    if (!hitEntry?.cube || !hitEntry.faceName) return toast('請指向一個貼圖面');
    const result = asset._uid === state.activeTextureUid
      ? { canvas: textureCanvas, context: textureCtx }
      : await paintCanvasForAsset(asset);
    if (!result) return;
    pushTexturePaintHistory(asset, result.canvas);
    fillPaintRects(result, asset, [paintUvBounds(hitEntry.cube, hitEntry.faceName, result.canvas)]);
    syncPaintedTextureNow();
    commitPaintedTextureAsset(asset, result.canvas);
    return;
  }
  const singleFaceClip = state.paintBucketSingleFace && hitEntry?.cube && hitEntry.faceName
    ? paintUvBounds(hitEntry.cube, hitEntry.faceName, asset._uid === state.activeTextureUid ? textureCanvas : {
      width: asset.uvWidth || state.project.textureSize?.[0] || 16,
      height: asset.uvHeight || state.project.textureSize?.[1] || 16
    })
    : null;
  if (state.paintBucketSingleFace && !singleFaceClip) return toast('單面局限時請先指向一個貼圖面');
  await paintBucketAsset(asset, point, null, state.paintBucketScope === 'contiguous', singleFaceClip);
}

function pushTexturePaintHistory(asset, canvas = textureCanvas, group = null, operationId = null) {
  const id = requireOperation(operationId || `core.texture.${PAINT_TOOLS.includes(state.tool) ? state.tool : 'paint'}`);
  noteJournalOperation(id);
  state.paintHistory.push({
    uid: asset._uid,
    source: asset.layers?.length ? asset.source : canvas.toDataURL('image/png'),
    layers: asset.layers ? structuredClone(asset.layers) : null,
    activeLayerUid: asset.activeLayerUid || null,
    width: canvas.width,
    height: canvas.height,
    group
  });
  if (state.paintHistory.length > 60) state.paintHistory.shift();
  state.paintFuture.length = 0;
}

function commitPaintedTextureAsset(asset, canvas) {
  if (!asset || !canvas) return;
  paintHitAlphaCache.delete(asset._uid);
  const layer = activeLayer(asset);
  if (layer) layer.source = canvas.toDataURL('image/png');
  const composite = layer ? compositeLayers(asset, canvas) : canvas;
  asset.source = composite.toDataURL('image/png');
  asset.uvWidth = canvas.width;
  asset.uvHeight = canvas.height;
  asset.kind = 'PNG';
  if (asset._uid === state.activeTextureUid && canvas !== textureCanvas) {
    textureCanvas.width = canvas.width;
    textureCanvas.height = canvas.height;
    textureCtx.imageSmoothingEnabled = false;
    textureCtx.clearRect(0, 0, canvas.width, canvas.height);
    textureCtx.drawImage(canvas, 0, 0);
    updateTexturePreviewFrame(canvas.width, canvas.height);
  }
  syncRendererTextureAsset(asset, composite, true);
  const item = $$('.texture-item').find(node => node.dataset.textureUid === asset._uid);
  const thumbnail = item?.querySelector('.texture-thumb');
  if (thumbnail) thumbnail.style.backgroundImage = `url("${asset.source}")`;
  markDirty();
}

function replayTexturePaintPoints(drag) {
  const points = drag.pendingPoints.splice(0);
  for (const point of points) {
    if (PAINT_SHAPE_TOOLS.includes(drag.tool)) drawPaintShape(drag, point);
    else drawPaintSegment(drag, drag.last || point, point);
    drag.last = point;
  }
}

function finishTexturePaintDrag(drag) {
  if (!drag || drag.finished) return;
  drag.finished = true;
  syncPaintedTextureNow();
  const surfaces = drag.touchedSurfaces?.size ? [...drag.touchedSurfaces] : [drag];
  for (const surface of surfaces) commitPaintedTextureAsset(surface.asset, surface.canvas);
}
return { paintPointFromEvent, paintPointInside, faceUvPixelSlots, paintFaceDepthNeighbors, updateTextureBrushCursor, syncPaintedTextureNow, queuePaintedTextureSync, drawPaintSegment, drawPaintShape, paintUvBounds, allTextureUvEntriesForAsset, applyTextureBucket, pushTexturePaintHistory, commitPaintedTextureAsset, replayTexturePaintPoints, finishTexturePaintDrag };
}
