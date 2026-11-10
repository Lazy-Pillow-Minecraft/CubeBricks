import { PAINT_SHAPE_TOOLS } from '../editor/tool-registry.js';
import { paintSelectionAllows } from './selection-controller.js';
import { activeLayer, layerRasterCache } from '../common/core/texture-features.js';
import { eyedropperCanvas, opaqueTextureColor } from './eyedropper.js';
import {
  bindPaintCanvas, releasePaintCanvas, editablePaintSourceMatches,
  rememberEditablePaintSource
} from './canvas-layer-binding.js';
import { beginPaintGesture, pendingPaintCommit, trackPaintCommit } from './commit-order.js';

export function createTexturePaintPointerController({
  state, $, textureCanvas, textureCtx, toast, pushTexturePaintHistory,
  paintUvBounds, activePaintGradientStops, samplePaintGradient,
  blendRgbaPixel, paintToolOpacity, commitPaintedTextureAsset,
  queuePaintedTextureSync, syncPaintedTextureNow, clearPaintGradientSelection,
  activeTextureAsset, paintPointFromEvent, paintPointInside,
  textureUvHit, allTextureUvEntriesForAsset, applyTextureBucket, finishTextureBucketStroke,
  setPaintColor, updateToolOptions, clamp, replayTexturePaintPoints,
  drawPaintShape, drawPaintSegment, finishTexturePaintDrag, paintCanvasForAsset, capturePaintStyle = () => null
}) {
  let texturePaintDrag = null;
  function updateTextureGradientPreview(event) {
    const preview = $('#textureGradientPreview');
    const anchor = state.paintGradientAnchor;
    if (!preview || state.mode !== 'paint' || state.tool !== 'gradient' || anchor?.surface !== 'texture') return;
    const asset = activeTextureAsset();
    const point = paintPointFromEvent(event);
    if (!asset || asset._uid !== anchor.assetUid || !paintPointInside(point)) {
      preview.hidden = true;
      return;
    }
    const logical = [point[0] * (asset.uvWidth || textureCanvas.width) / textureCanvas.width,
    point[1] * (asset.uvHeight || textureCanvas.height) / textureCanvas.height];
    const hit = allTextureUvEntriesForAsset(asset).find(entry => entry.cube.uid === anchor.cubeUid
      && entry.faceName === anchor.faceName && logical[0] >= Math.min(entry.uv[0], entry.uv[2])
      && logical[0] <= Math.max(entry.uv[0], entry.uv[2])
      && logical[1] >= Math.min(entry.uv[1], entry.uv[3])
      && logical[1] <= Math.max(entry.uv[1], entry.uv[3]));
    if (!hit) {
      preview.hidden = true;
      return;
    }
    const direction = [point[0] - anchor.point[0], point[1] - anchor.point[1]];
    if (direction[0] ** 2 + direction[1] ** 2 < 1e-8) {
      preview.hidden = true;
      return;
    }
    const bounds = paintUvBounds(hit.cube, hit.faceName, textureCanvas);
    const projections = [[bounds.minU, bounds.minV], [bounds.maxU, bounds.minV],
    [bounds.minU, bounds.maxV], [bounds.maxU, bounds.maxV]]
      .map(corner => (corner[0] - anchor.point[0]) * direction[0] + (corner[1] - anchor.point[1]) * direction[1]);
    const minimum = Math.min(...projections), span = Math.max(1e-8, Math.max(...projections) - minimum);
    preview.width = Math.max(1, bounds.maxU - bounds.minU);
    preview.height = Math.max(1, bounds.maxV - bounds.minV);
    preview.style.left = `${bounds.minU / textureCanvas.width * 100}%`;
    preview.style.top = `${bounds.minV / textureCanvas.height * 100}%`;
    preview.style.width = `${preview.width / textureCanvas.width * 100}%`;
    preview.style.height = `${preview.height / textureCanvas.height * 100}%`;
    const context = preview.getContext('2d');
    context.drawImage(textureCanvas, bounds.minU, bounds.minV, preview.width, preview.height,
      0, 0, preview.width, preview.height);
    const image = context.getImageData(0, 0, preview.width, preview.height);
    const stops = activePaintGradientStops();
    for (let y = bounds.minV; y < bounds.maxV; y++) for (let x = bounds.minU; x < bounds.maxU; x++) {
      if (!paintSelectionAllows(state, asset._uid, x, y, textureCanvas.width, textureCanvas.height)) continue;
      const projection = (x + .5 - anchor.point[0]) * direction[0] + (y + .5 - anchor.point[1]) * direction[1];
      blendRgbaPixel(image.data, ((y - bounds.minV) * preview.width + x - bounds.minU) * 4,
        samplePaintGradient((projection - minimum) / span, stops), paintToolOpacity('gradient'));
    }
    context.putImageData(image, 0, 0);
    preview.hidden = false;
  }
  function queueBucketAt(drag, clientX, clientY) {
    const point = paintPointFromEvent({ clientX, clientY });
    if (!paintPointInside(point)) return;
    const key = drag.wholeLayer ? 'layer' : `pixel:${point[0]}:${point[1]}`;
    if (drag.seen.has(key)) return;
    drag.seen.add(key);
    const logicalPoint = [point[0] * (drag.asset.uvWidth || textureCanvas.width) / textureCanvas.width,
    point[1] * (drag.asset.uvHeight || textureCanvas.height) / textureCanvas.height];
    const hit = drag.wholeLayer ? null : textureUvHit(drag.entries, logicalPoint);
    drag.queue = drag.queue.then(() => {
      if (drag.project === state.project && state.textureAssets.includes(drag.asset))
        return applyTextureBucket(drag.asset, point, hit, drag.history, { wholeLayer: drag.wholeLayer });
    })
      .catch(error => toast(error.message));
  }

  function queueBucketPath(drag, clientX, clientY) {
    if (drag.wholeLayer && drag.seen.size) return;
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
    const anchor = state.paintGradientAnchor;
    if (!anchor || anchor.surface !== 'texture') {
      if (!hit) return toast('請在一個 UV 面內選擇漸變點');
      state.paintGradientAnchor = { surface: 'texture', assetUid: asset._uid, point, cubeUid: hit.cube.uid, faceName: hit.faceName };
      $('#textureGradientPreview').hidden = true;
      toast('選擇面漸變終點');
      return;
    }
    const candidate = allTextureUvEntriesForAsset(asset).find(entry => entry.cube.uid === anchor.cubeUid
      && entry.faceName === anchor.faceName && point[0] >= Math.min(entry.uv[0], entry.uv[2]) * textureCanvas.width / (asset.uvWidth || textureCanvas.width)
      && point[0] <= Math.max(entry.uv[0], entry.uv[2]) * textureCanvas.width / (asset.uvWidth || textureCanvas.width)
      && point[1] >= Math.min(entry.uv[1], entry.uv[3]) * textureCanvas.height / (asset.uvHeight || textureCanvas.height)
      && point[1] <= Math.max(entry.uv[1], entry.uv[3]) * textureCanvas.height / (asset.uvHeight || textureCanvas.height));
    if (anchor.assetUid !== asset._uid || !candidate) {
      toast('面漸變的第二點必須在同一個 UV 面');
      return;
    }
    hit = candidate;
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
    if (state.tool === 'eyedropper') {
      eyedropperCanvas(asset, { composite: event.ctrlKey, liveCanvas: textureCanvas }).then(canvas => {
        const color = opaqueTextureColor(canvas, point);
        if (color) {
          setPaintColor(color, true);
          updateToolOptions();
        }
      }).catch(error => toast(error.message));
      return;
    }
    if (asset.animation?.enabled && !activeLayer(asset)) {
      toast('當前幀沒有可編輯圖層');
      return;
    }
    const project = state.project, previous = pendingPaintCommit(project);
    beginPaintGesture(project);
    const layer = activeLayer(asset);
    const needsCanvas = Boolean(previous || !editablePaintSourceMatches(asset, textureCanvas, layer) || asset.layers?.some(entry =>
      entry.type !== 'group' && layerRasterCache.get(entry.uid)?.savedSource !== entry.source));
    if (state.tool === 'gradient') {
      const apply = () => {
        if (state.project !== project || activeTextureAsset() !== asset || state.tool !== 'gradient') return;
        bindPaintCanvas(asset, textureCanvas, activeLayer(asset)?.uid);
        try { useTexturePaintGradient(asset, point, hit); } finally { releasePaintCanvas(textureCanvas); }
      };
      if (previous) trackPaintCommit(project, previous.then(apply)); else apply();
      return;
    }
    if (state.tool === 'fill') {
      const wholeLayer = ['face', 'element'].includes(state.paintBucketScope);
      texturePaintDrag = {
        pointerId: event.pointerId, tool: 'fill', asset,
        project, wholeLayer, entries: wholeLayer ? [] : allTextureUvEntriesForAsset(asset),
        seen: new Set(), queue: previous || Promise.resolve(),
        history: { group: crypto.randomUUID(), assets: new Set() },
        lastClient: [event.clientX, event.clientY]
      };
      $('#texturePreview').setPointerCapture(event.pointerId);
      queueBucketAt(texturePaintDrag, event.clientX, event.clientY);
      return;
    }
    const historyGroup = crypto.randomUUID();
    const drag = texturePaintDrag = {
      pointerId: event.pointerId, uid: asset._uid, asset,
      project, canvas: textureCanvas, context: textureCtx, tool: state.tool, paintStyle: capturePaintStyle(state.tool), start: point, last: point,
      wrapTexture: state.tool === 'brush' && asset.mode === 'tiled',
      historyGroup, historyAssets: new Set([asset._uid]), touchedSurfaces: new Set(), pendingPoints: [point],
      holisticStroke: true,
      ready: false, ended: false, finished: false
    };
    texturePaintDrag.rootDrag = texturePaintDrag;
    texturePaintDrag.baseSurface = texturePaintDrag;
    texturePaintDrag.touchedSurfaces.add(texturePaintDrag);
    $('#texturePreview').setPointerCapture(event.pointerId);
    const start = () => {
      if (state.project !== project || activeTextureAsset() !== asset) return;
      bindPaintCanvas(asset, textureCanvas, activeLayer(asset)?.uid);
      pushTexturePaintHistory(asset, textureCanvas, historyGroup, `core.texture.${drag.tool}`);
      drag.baseImage = PAINT_SHAPE_TOOLS.includes(drag.tool)
        ? textureCtx.getImageData(0, 0, textureCanvas.width, textureCanvas.height) : null;
      drag.ready = true;
      replayTexturePaintPoints(drag);
    };
    if (!needsCanvas) {
      start();
      return;
    }
    drag.readyPromise = Promise.resolve(previous).then(() =>
      state.project === project && activeTextureAsset() === asset ? paintCanvasForAsset(asset) : null).then(result => {
        if (!result) return;
        releasePaintCanvas(result.canvas);
        if (state.project !== project || activeTextureAsset() !== asset) return;
        if (textureCanvas.width !== result.canvas.width) textureCanvas.width = result.canvas.width;
        if (textureCanvas.height !== result.canvas.height) textureCanvas.height = result.canvas.height;
        textureCtx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
        textureCtx.drawImage(result.canvas, 0, 0);
        rememberEditablePaintSource(asset, textureCanvas, activeLayer(asset));
        start();
      }).catch(error => toast(error.message));
  }

  function moveTexturePaintPointer(event) {
    if (!texturePaintDrag) {
      updateTextureGradientPreview(event);
      return false;
    }
    if (texturePaintDrag.pointerId !== event.pointerId) return false;
    if (texturePaintDrag.tool === 'brush' && typeof event.getCoalescedEvents === 'function') {
      const samples = event.getCoalescedEvents();
      for (const sample of samples) {
        if (Number.isFinite(sample.clientX) && Number.isFinite(sample.clientY))
          moveTexturePaintPointer({
            clientX: sample.clientX, clientY: sample.clientY,
            pointerId: event.pointerId
          });
      }
      if (samples.length && samples.at(-1).clientX === event.clientX
        && samples.at(-1).clientY === event.clientY) return true;
    }
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
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) moveTexturePaintPointer(event);
    texturePaintDrag = null;
    const preview = $('#texturePreview');
    if (preview.hasPointerCapture?.(event.pointerId)) preview.releasePointerCapture(event.pointerId);
    drag.ended = true;
    if (drag.tool === 'fill') {
      trackPaintCommit(drag.project, drag.queue.then(() => finishTextureBucketStroke(drag.history)).catch(error => toast(error.message)));
      return true;
    }
    // A lost capture ends at the last received sample. Keeping that partial
    // stroke is safer than leaving the canvas and texture asset out of sync.
    if (drag.ready) finishTexturePaintDrag(drag);
    else if (drag.readyPromise) trackPaintCommit(drag.project, drag.readyPromise.then(() => {
      if (drag.ready) finishTexturePaintDrag(drag);
    }));
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
