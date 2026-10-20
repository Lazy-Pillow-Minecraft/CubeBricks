import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv, isCubeFaceCulled } from '../render/webgl-renderer.js';
import { activeLayer, faceTileSize, layerRasterCache, prepareLayers } from '../common/core/texture-features.js';
import { barycentric2d } from '../screen/color-picker/math.js';
import { dot3 } from '../utils/math/vector3.js';
import { PAINT_SHAPE_TOOLS } from '../editor/tool-registry.js';

export function createScenePaintController({
  state, $, sceneCanvas, sceneRenderer, textureCanvas,
  textureAssetForReference, subdivisionPatch, isFaceTiled,
  clamp, paintToolOpacity, paletteRows, palette, samplePaletteGradient,
  hexToRgb, paintSymmetryRelatedHits, paintSymmetryFaceKey,
  pushTexturePaintHistory, paintUvBounds, commitPaintedTextureAsset,
  queuePaintedTextureSync, syncPaintedTextureNow, drawPaintSegment,
  drawPaintShape, paintFaceDepthNeighbors, applyTextureBucket,
  loadTextureAssetImage, paintHitAlphaCache, animationRasterCache,
  renderTextureList, renderScene, toast, setPaintColor, updateToolOptions,
  activateProjectTexture
}) {
function facePaintTarget(hit) {
  if (!hit?.faceName) return null;
  const hitNode = state.project.getNode(hit.uid);
  const cube = hit.cube?.type === 'cube' ? hit.cube : hitNode;
  if (cube?.type !== 'cube') return null;
  const existingFace = cube.faces?.[hit.faceName];
  const asset = textureAssetForReference(existingFace?.texture);
  if (!asset) return null;
  return { cube, faceName: hit.faceName, asset, owner: cube.subdivisionOwnerUid ? state.project.getNode(cube.subdivisionOwnerUid) : null };
}

function persistGeneratedPaintCube(cube) {
  const owner = cube?.subdivisionOwnerUid && state.project.getNode(cube.subdivisionOwnerUid);
  const index = Number(cube?.subdivisionIndex);
  if (!owner?.toBaseCubes || !Number.isInteger(index) || index < 0) return;
  const edits = { ...(owner.subdivisionEdits || {}) };
  const patch = subdivisionPatch(owner, cube, index);
  if (patch) edits[index] = patch;
  else delete edits[index];
  owner.subdivisionEdits = edits;
}

function adjacentPaintFaceAsset(cube, faceName) {
  const existingFace = cube.faces?.[faceName];
  if (isCubeFaceCulled(existingFace)) return null;
  const assignedAsset = textureAssetForReference(existingFace?.texture);
  if (assignedAsset) return assignedAsset;
  return null;
}

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

function facePaintUvPoint(hit, target, canvas) {
  if (!hit?.point || !hit.facePoints?.length || !target || !canvas) return null;
  const face = target.cube.faces?.[target.faceName] || {};
  if (isFaceTiled(face)) {
    const uAxis = hit.facePoints[1].map((value, axis) => value - hit.facePoints[0][axis]);
    const vAxis = hit.facePoints[2].map((value, axis) => value - hit.facePoints[0][axis]);
    const offset = hit.point.map((value, axis) => value - hit.facePoints[0][axis]);
    const size = faceTileSize(target.cube, target.faceName);
    const u = dot3(offset, uAxis) / Math.max(1e-8, dot3(uAxis, uAxis)) * size[0];
    const v = dot3(offset, vAxis) / Math.max(1e-8, dot3(vAxis, vAxis)) * size[1];
    const fraction = value => ((value % 1) + 1) % 1;
    return [Math.floor(fraction((u + (Number(face.tiling?.offsetX) || 0)) / Math.max(.0001, Number(face.tiling?.width) || 16)) * canvas.width),
      Math.floor(fraction((v + (Number(face.tiling?.offsetY) || 0)) / Math.max(.0001, Number(face.tiling?.height) || 16)) * canvas.height)];
  }
  const rectangle = Array.isArray(face.uv) && face.uv.length >= 4
    ? face.uv
    : getBlockbenchBoxUv(target.cube, target.faceName);
  if (!rectangle) return null;
  const slots = createBlockbenchFaceUvSlots(rectangle, face.rotation || 0);
  const triangles = [[0, 2, 1], [2, 3, 1]];
  for (const indices of triangles) {
    const weights = barycentricPoint(hit.point,
      hit.facePoints[indices[0]], hit.facePoints[indices[1]], hit.facePoints[indices[2]]);
    if (!weights) continue;
    const uv = [0, 1].map(axis => indices.reduce((sum, slot, index) => sum + slots[slot][axis] * weights[index], 0));
    const point = [Math.floor(uv[0]), Math.floor(uv[1])];
    if (point[0] >= 0 && point[1] >= 0 && point[0] < canvas.width && point[1] < canvas.height) return point;
  }
  return null;
}

function faceUvWorldPoint(cube, faceName, facePoints, point) {
  if (!cube || !faceName || facePoints?.length !== 4) return null;
  const face = cube.faces?.[faceName] || {};
  const rectangle = Array.isArray(face.uv) && face.uv.length >= 4 ? face.uv : getBlockbenchBoxUv(cube, faceName);
  if (!rectangle) return null;
  const slots = createBlockbenchFaceUvSlots(rectangle, face.rotation || 0);
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

function blendRgbaPixel(data, offset, source, opacity = 1) {
  const sourceAlpha = clamp(source[3] * opacity, 0, 1);
  const destinationAlpha = data[offset + 3] / 255;
  if (state.paintIgnoreTransparent && destinationAlpha <= 0) return;
  if (sourceAlpha <= 0 || (state.alphaLock && destinationAlpha <= 0)) return;
  if (state.alphaLock) {
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(
      data[offset + channel] * (1 - sourceAlpha) + source[channel] * sourceAlpha);
    return;
  }
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel++) data[offset + channel] = outputAlpha <= 0 ? 0 : Math.round(
    (source[channel] * sourceAlpha + data[offset + channel] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
  data[offset + 3] = Math.round(outputAlpha * 255);
}

function activePaintGradientStops() {
  if (state.paintGradientPalette) {
    const row = paletteRows.find(entry => entry.id === palette.selectedRowId);
    if (row?.colorSpaceGradient || row?.colors?.length) return Array.from({ length: 65 }, (_, index) => ({
      color: hexToRgb(samplePaletteGradient(row, index / 64)), alpha: 1
    }));
  }
  return [
    { color: hexToRgb(state.paintGradientStart), alpha: clamp(state.paintGradientStartAlpha / 100, 0, 1) },
    { color: hexToRgb(state.paintGradientEnd), alpha: clamp(state.paintGradientEndAlpha / 100, 0, 1) }
  ];
}

function samplePaintGradient(ratio, stops = null) {
  if (state.paintGradientPalette) {
    const row = paletteRows.find(entry => entry.id === palette.selectedRowId);
    if (row?.colorSpaceGradient || row?.colors?.length) return [...hexToRgb(samplePaletteGradient(row, ratio)), 1];
  }
  stops ||= activePaintGradientStops();
  if (!stops.length) return [...hexToRgb(state.paintGradientStart), 1];
  if (stops.length === 1) return [...stops[0].color, stops[0].alpha];
  const scaled = clamp(ratio, 0, 1) * (stops.length - 1);
  const leftIndex = Math.floor(scaled);
  const rightIndex = Math.min(stops.length - 1, leftIndex + 1);
  const amount = scaled - leftIndex;
  const left = stops[leftIndex], right = stops[rightIndex];
  return [
    ...left.color.map((channel, index) => Math.round(channel + (right.color[index] - channel) * amount)),
    left.alpha + (right.alpha - left.alpha) * amount
  ];
}

function paintGradientSvgStops(opacity = .72) {
  const stops = activePaintGradientStops();
  return stops.map((stop, index) => {
    const color = `#${stop.color.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
    const offset = stops.length === 1 ? 0 : index / (stops.length - 1);
    return `<stop offset="${offset}" stop-color="${color}" stop-opacity="${stop.alpha * opacity}"/>`;
  }).join('');
}

function projectedGradientRange(points, origin, direction) {
  const lengthSquared = dot3(direction, direction);
  if (lengthSquared < 1e-8 || !points.length) return null;
  const amounts = points.map(point => dot3(point.map((value, axis) => value - origin[axis]), direction) / lengthSquared);
  const min = Math.min(...amounts), max = Math.max(...amounts);
  if (max - min < 1e-8) return null;
  return {
    min, max,
    start: origin.map((value, axis) => value + direction[axis] * min),
    end: origin.map((value, axis) => value + direction[axis] * max)
  };
}

function clearPaintGradientSelection() {
  state.paintGradientAnchor = null;
  state.paintGradientHover = null;
  const overlay = $('#paintGradientOverlay');
  if (overlay) { overlay.innerHTML = ''; overlay.hidden = true; }
}

function renderPaintGradientPreview() {
  const overlay = $('#paintGradientOverlay');
  const anchor = state.paintGradientAnchor;
  const hover = state.paintGradientHover;
  if (!overlay || !anchor?.hit || !hover?.faceName) {
    if (overlay) { overlay.innerHTML = ''; overlay.hidden = true; }
    return;
  }
  const sameCube = (hover.cubeUid || hover.uid) === (anchor.hit.cubeUid || anchor.hit.uid);
  const sameFace = sameCube && hover.faceName === anchor.hit.faceName;
  if (!sameCube || (state.paintGradientMode === 'face' && !sameFace)) {
    overlay.innerHTML = ''; overlay.hidden = true; return;
  }
  const direction = hover.point.map((value, axis) => value - anchor.hit.point[axis]);
  const domainFaces = state.paintGradientMode === 'face'
    ? [hover]
    : sceneRenderer.getCubeFaceQuads(anchor.hit.uid, anchor.hit.cubeUid || anchor.hit.uid);
  const range = projectedGradientRange(domainFaces.flatMap(entry => entry.facePoints || []), anchor.hit.point, direction);
  if (!range) { overlay.innerHTML = ''; overlay.hidden = true; return; }
  const start = sceneRenderer.projectPoint(range.start);
  const end = sceneRenderer.projectPoint(range.end);
  const face = hover.facePoints.map(point => sceneRenderer.projectPoint(point));
  if (start.behind || end.behind || face.some(point => point.behind)) return;
  const width = sceneCanvas.clientWidth, height = sceneCanvas.clientHeight;
  const perimeter = [face[0], face[1], face[3], face[2]];
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  overlay.innerHTML = `<defs><linearGradient id="paintGradientPreviewFill" gradientUnits="userSpaceOnUse" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}">${paintGradientSvgStops()}</linearGradient></defs>
    ${state.paintGradientMode === 'face' ? `<path class="gradient-preview-face" d="M${perimeter.map(point => `${point.x},${point.y}`).join(' L')} Z"/>` : ''}
    <line class="gradient-preview-line" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"/>
    <circle class="gradient-preview-point start" cx="${start.x}" cy="${start.y}" r="4"/><circle class="gradient-preview-point" cx="${end.x}" cy="${end.y}" r="4"/>`;
  overlay.hidden = false;
}

function updatePaintGradientHover(event) {
  if (!state.paintGradientAnchor || state.tool !== 'gradient') return;
  const rect = sceneCanvas.getBoundingClientRect();
  state.paintGradientHover = sceneRenderer.pickDetailed(state.project,
    event.clientX - rect.left, event.clientY - rect.top, true);
  renderPaintGradientPreview();
}

async function bakePaintGradient(anchorHit, endHit) {
  const cubeUid = anchorHit.cubeUid || anchorHit.uid;
  const domains = [];
  if (state.paintGradientMode === 'face') {
    const anchors = paintSymmetryRelatedHits(anchorHit);
    const ends = paintSymmetryRelatedHits(endHit);
    for (let index = 0; index < anchors.length; index++) {
      const anchor = anchors[index];
      const end = ends[index] && paintSymmetryFaceKey(ends[index]) === paintSymmetryFaceKey(anchor)
        ? ends[index]
        : ends.find(hit => paintSymmetryFaceKey(hit) === paintSymmetryFaceKey(anchor));
      if (end) domains.push({ anchor, end, hits: [anchor] });
    }
  } else {
    const anchors = paintSymmetryRelatedHits(anchorHit);
    const ends = paintSymmetryRelatedHits(endHit);
    for (let index = 0; index < anchors.length; index++) {
      const anchor = anchors[index];
      const end = ends[index] && paintSymmetryFaceKey(ends[index]) === paintSymmetryFaceKey(anchor)
        ? ends[index] : ends.find(hit => paintSymmetryFaceKey(hit) === paintSymmetryFaceKey(anchor));
      if (!end) continue;
      const targetCubeUid = anchor.cubeUid || anchor.uid;
      domains.push({
        anchor, end,
        hits: sceneRenderer.getCubeFaceQuads(anchor.uid, targetCubeUid).map(entry => ({ ...entry, point: anchor.point }))
      });
    }
  }
  const surfaces = new Map();
  const historyGroup = crypto.randomUUID();
  const stops = activePaintGradientStops();
  for (const domain of domains) {
    const direction = domain.end.point.map((value, axis) => value - domain.anchor.point[axis]);
    if (dot3(direction, direction) < 1e-8) continue;
    const projections = domain.hits.flatMap(hit => hit.facePoints || [])
      .map(point => dot3(point.map((value, axis) => value - domain.anchor.point[axis]), direction));
    const minimum = Math.min(...projections), maximum = Math.max(...projections), span = maximum - minimum;
    if (!Number.isFinite(span) || span < 1e-8) continue;
    for (const hit of domain.hits) {
      const target = facePaintTarget(hit);
      if (!target) continue;
      let surface = surfaces.get(target.asset._uid);
      if (!surface) {
        const result = await paintCanvasForAsset(target.asset);
        if (!result) continue;
        const pixelCount = result.canvas.width * result.canvas.height;
        surface = {
          ...result, asset: target.asset,
          image: result.context.getImageData(0, 0, result.canvas.width, result.canvas.height),
          samples: new Float32Array(pixelCount * 4), counts: new Uint32Array(pixelCount)
        };
        surfaces.set(target.asset._uid, surface);
        pushTexturePaintHistory(target.asset, result.canvas, historyGroup);
      }
      const bounds = paintUvBounds(target.cube, target.faceName, surface.canvas);
      for (let y = bounds.minV; y < bounds.maxV; y++) for (let x = bounds.minU; x < bounds.maxU; x++) {
        const world = facePixelWorldPoint(target.cube, target.faceName, hit.facePoints, x, y);
        if (!world) continue;
        const pixel = y * surface.canvas.width + x;
        const projection = dot3(world.map((value, axis) => value - domain.anchor.point[axis]), direction);
        const rgba = samplePaintGradient((projection - minimum) / span, stops);
        const offset = pixel * 4;
        for (let channel = 0; channel < 3; channel++) surface.samples[offset + channel] += rgba[channel] * rgba[3];
        surface.samples[offset + 3] += rgba[3];
        surface.counts[pixel]++;
      }
    }
  }
  if (!surfaces.size) return toast('漸變範圍無效，或對應面沒有貼圖');
  for (const surface of surfaces.values()) {
    // Combine all mapped gradients against the original texture once. An
    // overlapping self-mapping must neither erase another mapping nor apply
    // the stroke opacity repeatedly. Premultiplied averaging is order-free.
    for (let pixel = 0; pixel < surface.counts.length; pixel++) {
      const count = surface.counts[pixel];
      if (!count) continue;
      const offset = pixel * 4, alphaSum = surface.samples[offset + 3];
      const rgba = [0, 1, 2].map(channel => alphaSum > 0 ? surface.samples[offset + channel] / alphaSum : 0);
      rgba.push(alphaSum / count);
      blendRgbaPixel(surface.image.data, offset, rgba, paintToolOpacity('gradient'));
    }
    surface.context.putImageData(surface.image, 0, 0);
    commitPaintedTextureAsset(surface.asset, surface.canvas);
    queuePaintedTextureSync(surface.asset, surface.canvas);
  }
  syncPaintedTextureNow();
  renderTextureList();
  renderScene();
}

function useScenePaintGradient(hit) {
  if (!state.paintGradientAnchor?.hit) {
    state.paintGradientAnchor = { hit };
    state.paintGradientHover = hit;
    renderPaintGradientPreview();
    toast(state.paintGradientMode === 'face' ? '選擇面漸變終點' : '選擇同一 Cube 上的終點');
    return;
  }
  const anchor = state.paintGradientAnchor.hit;
  const sameCube = (hit.cubeUid || hit.uid) === (anchor.cubeUid || anchor.uid);
  const sameFace = sameCube && hit.faceName === anchor.faceName;
  if (!sameCube || (state.paintGradientMode === 'face' && !sameFace)) {
    toast(state.paintGradientMode === 'face' ? '面漸變的第二點必須在同一個面' : '體漸變的第二點必須在同一個 Cube');
    return;
  }
  clearPaintGradientSelection();
  bakePaintGradient(anchor, hit);
}

function cloneCanvas(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.naturalWidth || source.width;
  canvas.height = source.naturalHeight || source.height;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0);
  return { canvas, context };
}

async function paintCanvasForAsset(asset) {
  if (asset.layers?.length) {
    await prepareLayers(asset);
    return cloneCanvas(layerRasterCache.get(activeLayer(asset).uid).canvas);
  }
  const image = await loadTextureAssetImage(asset);
  return image ? cloneCanvas(image) : null;
}

function paintHitVisibleAtStart(hit, drag = null) {
  const target = facePaintTarget(hit);
  if (!target) return true;
  const layer = activeLayer(target.asset);
  const raster = (layer && layerRasterCache.get(layer.uid)?.canvas)
    || animationRasterCache.get(target.asset._uid)?.canvas;
  if (!raster) return true;
  const snapshot = drag?.paintHitAlphaSnapshots || paintHitAlphaCache;
  let cached = snapshot.get(target.asset._uid);
  if (!cached || (!drag && cached.canvas !== raster)) {
    cached = { canvas: raster, pixels: raster.getContext('2d').getImageData(0, 0, raster.width, raster.height).data };
    snapshot.set(target.asset._uid, cached);
  }
  const point = facePaintUvPoint(hit, target, cached.canvas);
  if (!point) return true;
  return cached.pixels[(point[1] * cached.canvas.width + point[0]) * 4 + 3] !== 0;
}

function paintHitAlphaSnapshot() {
  return new Map([...paintHitAlphaCache].filter(([uid, cached]) => {
    const asset = state.textureAssets.find(entry => entry._uid === uid);
    const layer = activeLayer(asset);
    return cached.canvas === ((layer && layerRasterCache.get(layer.uid)?.canvas)
      || animationRasterCache.get(uid)?.canvas);
  }));
}

function scenePaintHit(clientX, clientY, drag = null) {
  const rect = sceneCanvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  let hit, hits = [];
  if (state.paintIgnoreTransparent) {
    const ordered = sceneRenderer.pickCoincident(state.project, x, y, true, true);
    hit = ordered.find(candidate => paintHitVisibleAtStart(candidate, drag)) || null;
    if (hit && state.tool === 'brush' && state.paintBrushOverlay) {
      const tolerance = Math.max(1e-5, Math.abs(hit.distance) * 1e-6);
      hits = ordered.filter(candidate => Math.abs(candidate.distance - hit.distance) <= tolerance
        && Math.abs(dot3(candidate.normal, hit.normal)) >= .99999
        && paintHitVisibleAtStart(candidate, drag));
    }
  } else {
    hits = state.tool === 'brush' && state.paintBrushOverlay
      ? sceneRenderer.pickCoincident(state.project, x, y, true) : [];
    hit = hits[0] || sceneRenderer.pickDetailed(state.project, x, y, true);
  }
  if (!hit?.faceName) return null;
  if (drag && !drag.multiSurface && (hit.uid !== drag.uid
    || (hit.cubeUid || hit.uid) !== (drag.cubeUid || drag.uid)
    || hit.faceName !== drag.faceName)) return null;
  if (hits.length > 1) hit.coincidentHits = hits;
  return hit;
}

function ensureScenePaintAssetSurface(drag, asset) {
  if (drag.assetSurfaces.has(asset._uid)) return Promise.resolve(drag.assetSurfaces.get(asset._uid));
  if (drag.assetSurfacePromises.has(asset._uid)) return drag.assetSurfacePromises.get(asset._uid);
  const promise = paintCanvasForAsset(asset).then(result => {
    drag.assetSurfacePromises.delete(asset._uid);
    if (!result) return null;
    const surface = { ...result, asset, rootDrag: drag };
    surface.baseSurface = surface;
    drag.assetSurfaces.set(asset._uid, surface);
    return surface;
  });
  drag.assetSurfacePromises.set(asset._uid, promise);
  return promise;
}

async function sceneBrushSurfaceForHit(drag, hit) {
  const target = facePaintTarget(hit);
  if (!target) {
    if (!drag.warnedUntextured) {
      drag.warnedUntextured = true;
      toast('這個面尚未分配貼圖，無法繪製');
    }
    return null;
  }
  const base = await ensureScenePaintAssetSurface(drag, target.asset);
  if (!base) return null;
  const clip = paintUvBounds(target.cube, target.faceName, base.canvas);
  const surface = {
    ...base, baseSurface: base, rootDrag: drag, clip,
    tool: drag.tool,
    cube: target.cube, faceName: target.faceName,
    paintFace: { cube: target.cube, faceName: target.faceName, facePoints: hit.facePoints },
    depthEdges: []
  };
  if (state.paintBrushDepth > 0 && !isFaceTiled(target.cube.faces?.[target.faceName])) {
    const neighbors = paintFaceDepthNeighbors(hit, target);
    for (const neighbor of neighbors) {
      const asset = adjacentPaintFaceAsset(target.cube, neighbor.faceName);
      if (!asset) continue;
      const neighborSurface = await ensureScenePaintAssetSurface(drag, asset);
      if (neighborSurface) surface.depthEdges.push({ ...neighbor, surface: neighborSurface });
    }
  }
  return surface;
}


function queueSceneBrushHit(drag, hit) {
  drag.queue = drag.queue.then(async () => {
    if (drag.canceled || !hit?.faceName) {
      drag.lastByFace.clear();
      return;
    }
    const directHits = drag.tool === 'brush' && state.paintBrushOverlay && hit.coincidentHits?.length ? hit.coincidentHits : [hit];
    const hits = [...new Map(directHits.flatMap(paintHit => paintSymmetryRelatedHits(paintHit, drag))
      .map(paintHit => [`${paintSymmetryFaceKey(paintHit)}:${(paintHit.symmetryPermutation || [0, 1, 2, 3]).join(',')}`, paintHit])).values()];
    const activeKeys = new Set();
    for (const paintHit of hits) {
      const surface = await sceneBrushSurfaceForHit(drag, paintHit);
      if (!surface || drag.canceled) continue;
      const point = facePaintUvPoint(paintHit, surface, surface.canvas);
      if (!point) continue;
      // Each concrete face owns its own UV-space cursor. This keeps a single
      // 3D stroke continuous while preventing lines between unrelated UVs.
      const faceKey = `${sceneBrushHitKey(paintHit)}::${surface.asset._uid}::${(paintHit.symmetryPermutation || [0, 1, 2, 3]).join(',')}`;
      const previousPoint = drag.lastByFace.get(faceKey);
      const wrapped = isFaceTiled(surface.cube.faces?.[surface.faceName]) && previousPoint
        && (Math.abs(previousPoint[0] - point[0]) > surface.canvas.width / 2 || Math.abs(previousPoint[1] - point[1]) > surface.canvas.height / 2);
      const previous = wrapped ? null : previousPoint;
      drawPaintSegment(surface, previous || point, point);
      drag.lastByFace.set(faceKey, point);
      activeKeys.add(faceKey);
    }
    for (const key of [...drag.lastByFace.keys()]) if (!activeKeys.has(key)) drag.lastByFace.delete(key);
  });
  return drag.queue;
}

function sceneBrushHitKey(hit) {
  return hit?.faceName ? `${hit.uid}::${hit.cubeUid || hit.uid}::${hit.faceName}` : '';
}

function sceneBrushBoundary(from, to, drag) {
  const fromKey = sceneBrushHitKey(from.hit), toKey = sceneBrushHitKey(to.hit);
  if (fromKey === toKey) return null;
  let left = from, right = to;
  for (let iteration = 0; iteration < 11; iteration++) {
    const x = (left.x + right.x) / 2, y = (left.y + right.y) / 2;
    const hit = scenePaintHit(x, y, drag);
    const sample = { x, y, hit };
    if (sceneBrushHitKey(hit) === fromKey) left = sample;
    else right = sample;
  }
  return { before: left.hit, after: right.hit };
}

function queueSceneBrushPointer(drag, clientX, clientY) {
  const current = { x: clientX, y: clientY, hit: scenePaintHit(clientX, clientY, drag) };
  const previous = drag.lastPointerSample;
  if (!previous) {
    drag.lastPointerSample = current;
    queueSceneBrushHit(drag, current.hit);
    return;
  }
  const distance = Math.hypot(clientX - previous.x, clientY - previous.y);
  const sampleCount = Math.max(1, Math.min(128, Math.ceil(distance / 6)));
  let prior = previous;
  for (let index = 1; index <= sampleCount; index++) {
    const ratio = index / sampleCount;
    const sample = index === sampleCount ? current : {
      x: previous.x + (clientX - previous.x) * ratio,
      y: previous.y + (clientY - previous.y) * ratio
    };
    if (!sample.hit) sample.hit = scenePaintHit(sample.x, sample.y, drag);
    if (sceneBrushHitKey(prior.hit) !== sceneBrushHitKey(sample.hit)) {
      const boundary = sceneBrushBoundary(prior, sample, drag);
      if (boundary) {
        queueSceneBrushHit(drag, boundary.before);
        queueSceneBrushHit(drag, boundary.after);
      } else if (index !== sampleCount) queueSceneBrushHit(drag, sample.hit);
    }
    if (index === sampleCount) queueSceneBrushHit(drag, sample.hit);
    prior = sample;
  }
  drag.lastPointerSample = current;
}

function finishScenePaintDrag(drag) {
  if (!drag || drag.finished) return;
  drag.finished = true;
  if (drag.multiSurface) {
    if (drag.lastPointerSample && drag.latestClient
      && (drag.lastPointerSample.x !== drag.latestClient[0] || drag.lastPointerSample.y !== drag.latestClient[1])) {
      queueSceneBrushPointer(drag, drag.latestClient[0], drag.latestClient[1]);
    }
    drag.queue.then(() => {
      if (drag.canceled) return;
      if (!drag.touchedSurfaces.size) return;
      syncPaintedTextureNow();
      for (const surface of drag.touchedSurfaces) commitPaintedTextureAsset(surface.asset, surface.canvas);
      const lastSurface = [...drag.touchedSurfaces].at(-1);
      if (lastSurface && state.activeTextureUid !== lastSurface.asset._uid) {
        const index = state.textureAssets.findIndex(asset => asset._uid === lastSurface.asset._uid);
        if (index >= 0) activateProjectTexture(index);
      }
      renderScene();
    });
    return;
  }
  if (PAINT_SHAPE_TOOLS.includes(drag.tool) && drag.canvas) {
    finalizeScenePaintShapeSymmetry(drag);
    return;
  }
  if (!drag.canvas) return;
  syncPaintedTextureNow();
  commitPaintedTextureAsset(drag.asset, drag.canvas);
  if (state.activeTextureUid !== drag.asset._uid) {
    const index = state.textureAssets.findIndex(asset => asset._uid === drag.asset._uid);
    if (index >= 0) activateProjectTexture(index);
  }
  renderScene();
}

async function finalizeScenePaintShapeSymmetry(drag) {
  const endHit = drag.currentHit || drag.initialHit;
  const starts = paintSymmetryRelatedHits(drag.initialHit);
  const ends = paintSymmetryRelatedHits(endHit);
  const assets = new Map([[drag.asset._uid, {
    asset: drag.asset, canvas: drag.canvas, context: drag.context,
    baseImage: drag.baseImage, surfaces: []
  }]]);
  const sourceGroup = assets.get(drag.asset._uid);
  sourceGroup.surfaces.push({
    asset: drag.asset, canvas: drag.canvas, context: drag.context, baseImage: drag.baseImage,
    cube: drag.cube, faceName: drag.faceName, clip: drag.clip, tool: drag.tool,
    start: drag.start, end: drag.last || drag.start
  });
  for (let index = 1; index < starts.length; index++) {
    const startHit = starts[index];
    const endHitForTarget = ends[index] && paintSymmetryFaceKey(ends[index]) === paintSymmetryFaceKey(startHit)
      ? ends[index] : ends.find(hit => paintSymmetryFaceKey(hit) === paintSymmetryFaceKey(startHit));
    if (!endHitForTarget) continue;
    const target = facePaintTarget(startHit);
    if (!target) continue;
    let group = assets.get(target.asset._uid);
    if (!group) {
      const result = await paintCanvasForAsset(target.asset);
      if (!result) continue;
      group = {
        asset: target.asset, canvas: result.canvas, context: result.context,
        baseImage: result.context.getImageData(0, 0, result.canvas.width, result.canvas.height), surfaces: []
      };
      assets.set(target.asset._uid, group);
      pushTexturePaintHistory(target.asset, result.canvas);
    }
    const start = facePaintUvPoint(startHit, target, group.canvas);
    const end = facePaintUvPoint(endHitForTarget, target, group.canvas);
    if (!start || !end) continue;
    group.surfaces.push({
      asset: target.asset, canvas: group.canvas, context: group.context, baseImage: group.baseImage,
      cube: target.cube, faceName: target.faceName, clip: paintUvBounds(target.cube, target.faceName, group.canvas),
      tool: drag.tool, start, end
    });
  }
  for (const group of assets.values()) {
    group.context.putImageData(group.baseImage, 0, 0);
    group.strokeImage = null;
    group.strokeCoverage = null;
    const rootDrag = { holisticStroke: true, historyAssets: new Set([group.asset._uid]), touchedSurfaces: new Set(), historyGroup: null };
    group.rootDrag = rootDrag;
    group.baseSurface = group;
    for (const surface of group.surfaces) {
      surface.rootDrag = rootDrag;
      surface.baseSurface = group;
      drawPaintShape(surface, surface.end, false);
    }
    commitPaintedTextureAsset(group.asset, group.canvas);
    queuePaintedTextureSync(group.asset, group.canvas);
  }
  syncPaintedTextureNow();
  renderScene();
}

function moveScenePaintDrag(event, drag = state.dragging) {
  if (!drag || drag.type !== 'texture-paint-3d') return false;
  drag.latestClient = [event.clientX, event.clientY];
  if (drag.multiSurface) {
    queueSceneBrushPointer(drag, event.clientX, event.clientY);
    return true;
  }
  if (!drag.ready) return true;
  const hit = scenePaintHit(event.clientX, event.clientY, drag);
  const point = hit && facePaintUvPoint(hit, drag, drag.canvas);
  if (!point) {
    if (!PAINT_SHAPE_TOOLS.includes(drag.tool)) drag.last = null;
    return true;
  }
  if (PAINT_SHAPE_TOOLS.includes(drag.tool)) drawPaintShape(drag, point);
  else drawPaintSegment(drag, drag.last || point, point);
  drag.last = point;
  drag.currentHit = hit;
  return true;
}

function startScenePaintPointer(event, x, y) {
  const hit = scenePaintHit(event.clientX, event.clientY);
  if (state.tool === 'gradient') {
    if (!hit?.faceName) { toast('請指向一個 Cube 面'); return true; }
    const cube = hit.cube?.type === 'cube' ? hit.cube : state.project.getNode(hit.uid);
    const faceAsset = textureAssetForReference(cube?.faces?.[hit.faceName]?.texture);
    if (!faceAsset) { toast('這個面尚未分配貼圖，無法繪製'); return true; }
    event.preventDefault();
    useScenePaintGradient(hit);
    return true;
  }
  if (state.tool === 'brush') {
    if (hit?.faceName && !facePaintTarget(hit)) {
      toast('這個面尚未分配貼圖，無法繪製');
      return true;
    }
    event.preventDefault();
    sceneCanvas.setPointerCapture(event.pointerId);
    const drag = {
      type: 'texture-paint-3d', multiSurface: true, pointerId: event.pointerId, tool: state.tool,
      latestClient: [event.clientX, event.clientY], queue: Promise.resolve(),
      assetSurfaces: new Map(), assetSurfacePromises: new Map(), historyAssets: new Set(), touchedSurfaces: new Set(),
      paintSymmetryCaches: new Map(), paintSymmetryOperatorScopes: null,
      historyGroup: crypto.randomUUID(), last: null, lastFaceKey: null,
      lastByFace: new Map(),
      paintHitAlphaSnapshots: paintHitAlphaSnapshot(),
      holisticStroke: true, lastPointerSample: { x: event.clientX, y: event.clientY, hit },
      ready: true, ended: false, canceled: false, finished: false
    };
    state.dragging = drag;
    if (hit) queueSceneBrushHit(drag, hit);
    return true;
  }
  const target = facePaintTarget(hit);
  if (!target) {
    toast(hit?.faceName ? '這個面尚未分配貼圖，無法繪製' : '請指向一個 Cube 面');
    return true;
  }
  event.preventDefault();
  if (state.tool === 'fill') {
    (async () => {
      const related = paintSymmetryRelatedHits(hit);
      const seen = new Set();
      for (const paintHit of related) {
        const paintTarget = facePaintTarget(paintHit);
        if (!paintTarget) continue;
        const key = state.paintBucketScope === 'element'
          ? paintTarget.cube.uid
          : `${paintTarget.asset._uid}:${paintTarget.cube.uid}:${paintTarget.faceName}:${['color', 'contiguous'].includes(state.paintBucketScope) ? (paintHit.symmetryPermutation || [0, 1, 2, 3]).join(',') : 'face'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const result = await paintCanvasForAsset(paintTarget.asset);
        const point = result && facePaintUvPoint(paintHit, paintTarget, result.canvas);
        if (point) await applyTextureBucket(paintTarget.asset, point, { cube: paintTarget.cube, faceName: paintTarget.faceName });
      }
    })();
    return true;
  }
  if (state.tool === 'eyedropper') {
    paintCanvasForAsset(target.asset).then(result => {
      const point = result && facePaintUvPoint(hit, target, result.canvas);
      if (!point) return;
      const pixel = result.context.getImageData(point[0], point[1], 1, 1).data;
      setPaintColor(`#${[pixel[0], pixel[1], pixel[2]].map(value => value.toString(16).padStart(2, '0')).join('')}`, true);
      updateToolOptions();
    });
    return true;
  }
  sceneCanvas.setPointerCapture(event.pointerId);
  const drag = {
    type: 'texture-paint-3d', pointerId: event.pointerId, uid: hit.uid,
    cubeUid: hit.cubeUid || hit.uid, faceName: hit.faceName,
    asset: target.asset, cube: target.cube, tool: state.tool,
    initialHit: hit, latestClient: [event.clientX, event.clientY],
    canvas: null, context: null, last: null, ready: false, ended: false, canceled: false, finished: false,
    holisticStroke: true,
    paintHitAlphaSnapshots: paintHitAlphaSnapshot(),
    historyAssets: new Set([target.asset._uid]), touchedSurfaces: new Set()
  };
  drag.rootDrag = drag;
  drag.baseSurface = drag;
  const face = target.cube.faces?.[target.faceName] || {};
  const faceUv = Array.isArray(face.uv) && face.uv.length >= 4
    ? face.uv : getBlockbenchBoxUv(target.cube, target.faceName);
  drag.clip = {
    minU: Math.floor(Math.min(faceUv[0], faceUv[2])), minV: Math.floor(Math.min(faceUv[1], faceUv[3])),
    maxU: Math.ceil(Math.max(faceUv[0], faceUv[2])), maxV: Math.ceil(Math.max(faceUv[1], faceUv[3]))
  };
  state.dragging = drag;
  paintCanvasForAsset(target.asset).then(result => {
    if (!result || drag.canceled) return;
    drag.canvas = result.canvas;
    drag.context = result.context;
    drag.clip = paintUvBounds(target.cube, target.faceName, drag.canvas);
    pushTexturePaintHistory(drag.asset, drag.canvas);
    drag.ready = true;
    const initial = facePaintUvPoint(drag.initialHit, drag, drag.canvas);
    if (initial) {
      drag.start = initial;
      if (PAINT_SHAPE_TOOLS.includes(drag.tool)) {
        drag.baseImage = drag.context.getImageData(0, 0, drag.canvas.width, drag.canvas.height);
        drawPaintShape(drag, initial);
      } else drawPaintSegment(drag, initial, initial);
      drag.last = initial;
    }
    if (!drag.ended) {
      const [clientX, clientY] = drag.latestClient;
      moveScenePaintDrag({ clientX, clientY }, drag);
    } else finishScenePaintDrag(drag);
  });
  return true;
}
return { persistGeneratedPaintCube, barycentricPoint, faceUvWorldPoint, blendRgbaPixel, activePaintGradientStops, samplePaintGradient, clearPaintGradientSelection, renderPaintGradientPreview, updatePaintGradientHover, paintCanvasForAsset, queueSceneBrushPointer, finishScenePaintDrag, moveScenePaintDrag, startScenePaintPointer };
}
