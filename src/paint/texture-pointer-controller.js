import { PAINT_SHAPE_TOOLS } from '../editor/tool-registry.js';
import { paintSelectionAllows } from './selection-controller.js';

export function createTexturePaintPointerController({
  state, $, textureCanvas, textureCtx, toast, pushTexturePaintHistory,
  paintUvBounds, activePaintGradientStops, samplePaintGradient,
  blendRgbaPixel, paintToolOpacity, commitPaintedTextureAsset,
  queuePaintedTextureSync, syncPaintedTextureNow, clearPaintGradientSelection,
  activeTextureAsset, paintPointFromEvent, paintPointInside,
  textureUvHit, allTextureUvEntriesForAsset, applyTextureBucket, finishTextureBucketStroke,
  setPaintColor, updateToolOptions, clamp, replayTexturePaintPoints,
  drawPaintShape, drawPaintSegment, finishTexturePaintDrag
}) {
let texturePaintDrag = null;
function queueBucketAt(drag, clientX, clientY) {
  const point = paintPointFromEvent({ clientX, clientY });
  if (!paintPointInside(point)) return;
  const logicalPoint = [point[0] * (drag.asset.uvWidth || textureCanvas.width) / textureCanvas.width,
    point[1] * (drag.asset.uvHeight || textureCanvas.height) / textureCanvas.height];
  const hit = textureUvHit(drag.entries, logicalPoint);
  const scope = state.paintBucketScope;
  if (['face', 'element'].includes(scope) && !hit) return;
  const key = scope === 'element' ? `element:${hit.cube.uid}`
    : scope === 'face' ? `face:${hit.cube.uid}:${hit.faceName}`
      : `pixel:${point[0]}:${point[1]}`;
  if (drag.seen.has(key)) return;
  drag.seen.add(key);
  drag.queue = drag.queue.then(() => applyTextureBucket(drag.asset, point, hit, drag.history))
    .catch(error => toast(error.message));
}

function queueBucketPath(drag, clientX, clientY) {
  const previous = drag.lastClient;
  const steps = Math.max(1, Math.min(256, Math.ceil(Math.hypot(clientX - previous[0], clientY - previous[1]) / 4)));
  for (let index = 1; index <= steps; index++) {
    const ratio = index / steps;
    queueBucketAt(drag, previous[0] + (clientX - previous[0]) * ratio,
      previous[1] + (clientY - previous[1]) * ratio);
  }
  drag.lastClient = [clientX, clientY];
}
function useTexturePaintGradient(asset, point, hit) {
  if (state.paintGradientMode === 'volume') {
    toast('體漸變需要在三維視圖的同一個 Cube 上選取兩點');
    return;
  }
  if (!hit) return toast('請在一個 UV 面內選擇漸變點');
  const anchor = state.paintGradientAnchor;
  if (!anchor || anchor.surface !== 'texture') {
    state.paintGradientAnchor = { surface: 'texture', assetUid: asset._uid, point, cubeUid: hit.cube.uid, faceName: hit.faceName };
    toast('選擇面漸變終點');
    return;
  }
  if (anchor.assetUid !== asset._uid || anchor.cubeUid !== hit.cube.uid || anchor.faceName !== hit.faceName) {
    toast('面漸變的第二點必須在同一個 UV 面');
    return;
  }
  const direction = [point[0] - anchor.point[0], point[1] - anchor.point[1]];
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2;
  if (lengthSquared < 1e-8) return toast('漸變兩點距離太短');
  pushTexturePaintHistory(asset, textureCanvas);
  const bounds = paintUvBounds(hit.cube, hit.faceName, textureCanvas);
  const image = textureCtx.getImageData(0, 0, textureCanvas.width, textureCanvas.height);
  const stops = activePaintGradientStops();
  const projections = [
    [bounds.minU, bounds.minV], [bounds.maxU, bounds.minV],
    [bounds.minU, bounds.maxV], [bounds.maxU, bounds.maxV]
  ].map(corner => (corner[0] - anchor.point[0]) * direction[0] + (corner[1] - anchor.point[1]) * direction[1]);
  const minProjection = Math.min(...projections), maxProjection = Math.max(...projections);
  const projectionSpan = Math.max(1e-8, maxProjection - minProjection);
  for (let y = bounds.minV; y < bounds.maxV; y++) for (let x = bounds.minU; x < bounds.maxU; x++) {
    if (!paintSelectionAllows(state, asset._uid, x, y, textureCanvas.width, textureCanvas.height)) continue;
    const projection = (x + .5 - anchor.point[0]) * direction[0] + (y + .5 - anchor.point[1]) * direction[1];
    const rgba = samplePaintGradient((projection - minProjection) / projectionSpan, stops);
    blendRgbaPixel(image.data, (y * textureCanvas.width + x) * 4, rgba, paintToolOpacity('gradient'));
  }
  textureCtx.putImageData(image, 0, 0);
  commitPaintedTextureAsset(asset, textureCanvas);
  queuePaintedTextureSync(asset, textureCanvas);
  syncPaintedTextureNow();
  clearPaintGradientSelection();
}

function startTexturePaintPointer(event) {
  const asset = activeTextureAsset();
  if (!asset) {
    toast('請先建立或導入一張貼圖');
    return;
  }
  const point = paintPointFromEvent(event);
  if (!paintPointInside(point)) return;
  const logicalPoint = [point[0] * (asset.uvWidth || textureCanvas.width) / textureCanvas.width,
    point[1] * (asset.uvHeight || textureCanvas.height) / textureCanvas.height];
  const hit = textureUvHit(allTextureUvEntriesForAsset(asset), logicalPoint);
  if (state.tool === 'gradient') {
    useTexturePaintGradient(asset, point, hit);
    return;
  }
  if (state.tool === 'fill') {
    texturePaintDrag = {
      pointerId: event.pointerId, tool: 'fill', asset,
      entries: allTextureUvEntriesForAsset(asset), seen: new Set(), queue: Promise.resolve(),
      history: { group: crypto.randomUUID(), assets: new Set() },
      lastClient: [event.clientX, event.clientY]
    };
    $('#texturePreview').setPointerCapture(event.pointerId);
    queueBucketAt(texturePaintDrag, event.clientX, event.clientY);
    return;
  }
  if (state.tool === 'eyedropper') {
    const pixel = textureCtx.getImageData(point[0], point[1], 1, 1).data;
    setPaintColor(`#${[pixel[0], pixel[1], pixel[2]].map(value => value.toString(16).padStart(2, '0')).join('')}`, true);
    updateToolOptions();
    return;
  }
  const historyGroup = crypto.randomUUID();
  pushTexturePaintHistory(asset, textureCanvas, historyGroup);
  texturePaintDrag = {
    pointerId: event.pointerId, uid: asset._uid, asset,
    canvas: textureCanvas, context: textureCtx, tool: state.tool, start: point, last: point,
    baseImage: PAINT_SHAPE_TOOLS.includes(state.tool) ? textureCtx.getImageData(0, 0, textureCanvas.width, textureCanvas.height) : null,
    historyGroup, historyAssets: new Set([asset._uid]), touchedSurfaces: new Set(), pendingPoints: [point],
    holisticStroke: true,
    ready: true, ended: false, finished: false
  };
  texturePaintDrag.rootDrag = texturePaintDrag;
  texturePaintDrag.baseSurface = texturePaintDrag;
  texturePaintDrag.touchedSurfaces.add(texturePaintDrag);
  $('#texturePreview').setPointerCapture(event.pointerId);
  replayTexturePaintPoints(texturePaintDrag);
}

function moveTexturePaintPointer(event) {
  if (!texturePaintDrag || texturePaintDrag.pointerId !== event.pointerId) return false;
  if (texturePaintDrag.tool === 'fill') {
    queueBucketPath(texturePaintDrag, event.clientX, event.clientY);
    return true;
  }
  let point = paintPointFromEvent(event);
  const outside = !paintPointInside(point);
  if (outside && texturePaintDrag.last && !PAINT_SHAPE_TOOLS.includes(texturePaintDrag.tool)) {
    const [startX, startY] = texturePaintDrag.last;
    const dx = point[0] - startX, dy = point[1] - startY;
    const limits = [dx < 0 ? (0 - startX) / dx : dx > 0 ? (textureCanvas.width - 1 - startX) / dx : 1,
      dy < 0 ? (0 - startY) / dy : dy > 0 ? (textureCanvas.height - 1 - startY) / dy : 1];
    const ratio = clamp(Math.min(...limits), 0, 1);
    point = [clamp(Math.round(startX + dx * ratio), 0, textureCanvas.width - 1),
      clamp(Math.round(startY + dy * ratio), 0, textureCanvas.height - 1)];
  }
  if (!texturePaintDrag.ready) {
    texturePaintDrag.pendingPoints.push(point);
    return true;
  }
  if (PAINT_SHAPE_TOOLS.includes(texturePaintDrag.tool)) drawPaintShape(texturePaintDrag, point);
  else drawPaintSegment(texturePaintDrag, texturePaintDrag.outside ? point : texturePaintDrag.last, point);
  texturePaintDrag.last = point;
  texturePaintDrag.outside = outside;
  return true;
}

function endTexturePaintPointer(event) {
  if (!texturePaintDrag || texturePaintDrag.pointerId !== event.pointerId) return false;
  const drag = texturePaintDrag;
  if (drag.ready && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) moveTexturePaintPointer(event);
  if (drag.tool === 'fill' && Number.isFinite(event.clientX) && Number.isFinite(event.clientY))
    queueBucketPath(drag, event.clientX, event.clientY);
  texturePaintDrag = null;
  const preview = $('#texturePreview');
  if (preview.hasPointerCapture?.(event.pointerId)) preview.releasePointerCapture(event.pointerId);
  drag.ended = true;
  if (drag.tool === 'fill') {
    drag.queue.then(() => finishTextureBucketStroke(drag.history)).catch(error => toast(error.message));
    return true;
  }
  // A lost capture ends at the last received sample. Keeping that partial
  // stroke is safer than leaving the canvas and texture asset out of sync.
  if (drag.ready) finishTexturePaintDrag(drag);
  return true;
}

return {
  get texturePaintDrag() { return texturePaintDrag; },
  useTexturePaintGradient,
  startTexturePaintPointer,
  moveTexturePaintPointer,
  endTexturePaintPointer,
};
}
