import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv, isCubeFaceCulled } from '../common/core/geometry-utils.js';
import { activeLayer, faceTileSize, layerRasterCache, prepareLayers } from '../common/core/texture-features.js';
import { barycentric2d } from '../screen/color-picker/math.js';
import { dot3 } from '../utils/math/vector3.js';
import { PAINT_SHAPE_TOOLS } from '../editor/tool-registry.js';
import { paintSelectionAllows } from './selection-controller.js';
import { rasterScreenPaint, rasterScreenUvFootprint, screenPaintClientPoint, screenPaintGrid, screenPaintPoint } from './screen-space.js';

export function sceneBrushHitKey(hit) {
  return hit?.faceName ? `${hit.uid}::${hit.cubeUid || hit.uid}::${hit.cubeIndex ?? ''}`
    + `::${hit.faceName}::${hit.instanceKey || 'source'}` : '';
}

export function sceneBrushBranchKey(sourceHit, targetHit, assetUid) {
  return `${sceneBrushHitKey(sourceHit)}=>${sceneBrushHitKey(targetHit)}::${assetUid}::${(targetHit.symmetryPermutation || [0, 1, 2, 3]).join(',')}`;
}

export function paintDragAcceptsHit(drag, hit) {
  if (!drag || drag.multiSurface || drag.bucketDrag) return true;
  return hit.uid === drag.uid && (hit.cubeUid || hit.uid) === (drag.cubeUid || drag.uid)
    && hit.faceName === drag.faceName && (hit.instanceKey || null) === (drag.instanceKey || null);
}

export function createScenePaintController({
  state, $, sceneCanvas, sceneRenderer, textureCanvas,
  textureAssetForReference, subdivisionPatch, isFaceTiled,
  clamp, paintToolOpacity, paletteRows, palette, samplePaletteGradient,
  hexToRgb, paintSymmetryRelatedHits, paintSymmetryFaceKey,
  pushTexturePaintHistory, paintUvBounds, commitPaintedTextureAsset,
  queuePaintedTextureSync, syncPaintedTextureNow, discardPaintedTextureSync, drawPaintSegment,
  drawPaintShape, drawScreenPaintPixel, flushScreenPaintSurface, resetScreenPaintPreview,
  paintFaceDepthNeighbors, applyTextureBucket, finishTextureBucketStroke,
  loadTextureAssetImage, paintHitAlphaCache, animationRasterCache,
  renderTextureList, renderScene, toast, setPaintColor, updateToolOptions,
  activateProjectTexture, sampleReferenceImage
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
  if (isFaceTiled(face)) return null;
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

function paintGradientSvgStops(opacity = paintToolOpacity('gradient')) {
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
  const texturePreview = $('#textureGradientPreview');
  if (texturePreview) texturePreview.hidden = true;
}

function renderPaintGradientPreview() {
  const overlay = $('#paintGradientOverlay');
  const anchor = state.paintGradientAnchor;
  const hover = state.paintGradientHover;
  if (overlay && anchor?.screenSpace && hover?.screenPoint) {
    const [startX, startY] = anchor.screenPoint, [endX, endY] = hover.screenPoint;
    const faces = state.paintGradientMode === 'face' ? [anchor.hit]
      : sceneRenderer.getCubeFaceQuads(anchor.hit.uid, anchor.hit.cubeUid || anchor.hit.uid);
    const paths = faces.filter(face => facePaintTarget(face)).flatMap(face => {
      const points = face.facePoints?.map(point => sceneRenderer.projectPoint(point));
      return points?.length === 4 && points.every(point => !point.behind)
        ? [`<path class="gradient-preview-face" d="M${[0, 1, 3, 2].map(index => `${points[index].x},${points[index].y}`).join(' L')} Z"/>`] : [];
    });
    overlay.setAttribute('viewBox', `0 0 ${sceneCanvas.clientWidth} ${sceneCanvas.clientHeight}`);
    overlay.innerHTML = `<defs><linearGradient id="paintGradientPreviewFill" gradientUnits="userSpaceOnUse" x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}">${paintGradientSvgStops()}</linearGradient></defs>
      ${paths.join('')}<line class="gradient-preview-line" x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}"/>
      <circle class="gradient-preview-point start" cx="${startX}" cy="${startY}" r="4"/><circle class="gradient-preview-point" cx="${endX}" cy="${endY}" r="4"/>`;
    overlay.hidden = false;
    return;
  }
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
  const projectedStart = sceneRenderer.projectPoint(range.start);
  const projectedEnd = sceneRenderer.projectPoint(range.end);
  // A long projection may cross the near plane even while both clicked points
  // are visible. Keep the preview anchored to the visible points in that case.
  const start = projectedStart.behind ? sceneRenderer.projectPoint(anchor.hit.point) : projectedStart;
  const end = projectedEnd.behind ? sceneRenderer.projectPoint(hover.point) : projectedEnd;
  const width = sceneCanvas.clientWidth, height = sceneCanvas.clientHeight;
  const cameraEye = sceneRenderer.getCameraFrame()?.eye;
  const paths = domainFaces.filter(face => facePaintTarget(face)).flatMap(face => {
    const points = face.facePoints;
    if (!points || points.length !== 4) return [];
    const u = points[1].map((value, axis) => value - points[0][axis]);
    const v = points[2].map((value, axis) => value - points[0][axis]);
    const normal = [v[1] * u[2] - v[2] * u[1], v[2] * u[0] - v[0] * u[2], v[0] * u[1] - v[1] * u[0]];
    if (cameraEye && dot3(normal, cameraEye.map((value, axis) => value - points[0][axis])) < 0) return [];
    const projected = points.map(point => sceneRenderer.projectPoint(point));
    if (projected.some(point => point.behind)) return [];
    const perimeter = [projected[0], projected[1], projected[3], projected[2]];
    return [`<path class="gradient-preview-face" d="M${perimeter.map(point => `${point.x},${point.y}`).join(' L')} Z"/>`];
  });
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  overlay.innerHTML = `<defs><linearGradient id="paintGradientPreviewFill" gradientUnits="userSpaceOnUse" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}">${paintGradientSvgStops()}</linearGradient></defs>
    ${paths.join('')}
    <line class="gradient-preview-line" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"/>
    <circle class="gradient-preview-point start" cx="${start.x}" cy="${start.y}" r="4"/><circle class="gradient-preview-point" cx="${end.x}" cy="${end.y}" r="4"/>`;
  overlay.hidden = false;
}

function updatePaintGradientHover(event) {
  if (!state.paintGradientAnchor || state.paintGradientAnchor.fixed || state.tool !== 'gradient') return;
  const rect = sceneCanvas.getBoundingClientRect();
  if (state.paintGradientAnchor.screenSpace) {
    state.paintGradientHover = { screenPoint: snappedScreenPoint(state.paintGradientAnchor.screenGrid,
      event.clientX - rect.left, event.clientY - rect.top) };
    renderPaintGradientPreview();
    return;
  }
  state.paintGradientHover = sceneRenderer.pickDetailed(state.project,
    event.clientX - rect.left, event.clientY - rect.top, true);
  renderPaintGradientPreview();
}

function snappedScreenPoint(grid, x, y) {
  return [(Math.floor(x * grid.scaleX) + .5) / grid.scaleX,
    (Math.floor(y * grid.scaleY) + .5) / grid.scaleY];
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
    const cubeKey = hit => `${hit.uid}::${hit.cubeUid || hit.uid}`;
    for (let index = 0; index < anchors.length; index++) {
      const anchor = anchors[index];
      // Volume gradients deliberately span different faces of the same cube.
      // Face-key matching here silently discarded every cross-face endpoint.
      const end = ends[index] && cubeKey(ends[index]) === cubeKey(anchor)
        ? ends[index] : ends.find(hit => cubeKey(hit) === cubeKey(anchor));
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
        if (!paintSelectionAllows(state, target.asset._uid, x, y, surface.canvas.width, surface.canvas.height)) continue;
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

async function bakeScreenPaintGradient(anchor, endPoint) {
  const startPoint = anchor.screenPoint;
  const direction = [endPoint[0] - startPoint[0], endPoint[1] - startPoint[1]];
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2;
  if (lengthSquared < 1) return;
  const hits = state.paintGradientMode === 'face' ? [anchor.hit]
    : sceneRenderer.getCubeFaceQuads(anchor.hit.uid, anchor.hit.cubeUid || anchor.hit.uid);
  const projections = hits.flatMap(hit => hit.facePoints || []).map(point => sceneRenderer.projectPoint(point))
    .filter(point => !point.behind).map(point => {
      const [x, y] = snappedScreenPoint(anchor.screenGrid, point.x, point.y);
      return (x - startPoint[0]) * direction[0] + (y - startPoint[1]) * direction[1];
    });
  if (!projections.length) return;
  const minimum = Math.min(...projections), span = Math.max(...projections) - minimum;
  if (span < 1e-8) return;
  const visibility = new Map();
  const surfaces = new Map(), stops = activePaintGradientStops();
  const historyGroup = crypto.randomUUID();
  for (const hit of hits) {
    const target = facePaintTarget(hit);
    if (!target) continue;
    let surface = surfaces.get(target.asset._uid);
    if (!surface) {
      const result = await paintCanvasForAsset(target.asset);
      if (!result) continue;
      surface = { ...result, asset: target.asset,
        image: result.context.getImageData(0, 0, result.canvas.width, result.canvas.height) };
      surfaces.set(target.asset._uid, surface);
    }
    const bounds = paintUvBounds(target.cube, target.faceName, surface.canvas);
    let touched = false;
    for (let y = bounds.minV; y < bounds.maxV; y++) for (let x = bounds.minU; x < bounds.maxU; x++) {
      if (!paintSelectionAllows(state, target.asset._uid, x, y, surface.canvas.width, surface.canvas.height)) continue;
      const world = facePixelWorldPoint(target.cube, target.faceName, hit.facePoints, x, y);
      if (!world) continue;
      const projected = sceneRenderer.projectPoint(world);
      if (projected.behind) continue;
      if (screenVisibleFaceKey(anchor.screenGrid, projected.x, projected.y, visibility)
        !== sceneBrushHitKey(hit)) continue;
      if (!surface.touched && !touched) pushTexturePaintHistory(target.asset, surface.canvas, historyGroup);
      touched = true;
      const [screenX, screenY] = snappedScreenPoint(anchor.screenGrid, projected.x, projected.y);
      const projection = (screenX - startPoint[0]) * direction[0]
        + (screenY - startPoint[1]) * direction[1];
      blendRgbaPixel(surface.image.data, (y * surface.canvas.width + x) * 4,
        samplePaintGradient((projection - minimum) / span, stops), paintToolOpacity('gradient'));
    }
    surface.touched ||= touched;
  }
  for (const surface of surfaces.values()) {
    if (!surface.touched) continue;
    surface.context.putImageData(surface.image, 0, 0);
    commitPaintedTextureAsset(surface.asset, surface.canvas);
    queuePaintedTextureSync(surface.asset, surface.canvas);
  }
  syncPaintedTextureNow();
  renderScene();
}

function useScreenPaintGradient(hit, event) {
  const rect = sceneCanvas.getBoundingClientRect();
  const grid = state.paintGradientAnchor?.screenGrid
    || screenPaintGrid(rect, state.paintScreenHeight);
  const screenPoint = snappedScreenPoint(grid, event.clientX - rect.left, event.clientY - rect.top);
  if (!state.paintGradientAnchor?.screenSpace) {
    state.paintGradientAnchor = { hit, screenPoint, screenGrid: grid, screenSpace: true };
    state.paintGradientHover = { screenPoint };
    renderPaintGradientPreview();
    toast('選擇屏幕空間漸變終點');
    return;
  }
  const anchor = state.paintGradientAnchor;
  const sameCube = (hit.cubeUid || hit.uid) === (anchor.hit.cubeUid || anchor.hit.uid);
  if (!sameCube || state.paintGradientMode === 'face' && hit.faceName !== anchor.hit.faceName) {
    toast('漸變終點須在相同面或物體上');
    return;
  }
  anchor.fixed = true;
  state.paintGradientHover = { screenPoint };
  renderPaintGradientPreview();
  bakeScreenPaintGradient(anchor, screenPoint).catch(error => toast(error.message)).finally(clearPaintGradientSelection);
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
  state.paintGradientAnchor.fixed = true;
  state.paintGradientHover = hit;
  renderPaintGradientPreview();
  bakePaintGradient(anchor, hit).catch(error => toast(error.message)).finally(clearPaintGradientSelection);
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
  const raster = animationRasterCache.get(target.asset._uid)?.canvas
    || (layer && layerRasterCache.get(layer.uid)?.canvas);
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
    return cached.canvas === (animationRasterCache.get(uid)?.canvas
      || (layer && layerRasterCache.get(layer.uid)?.canvas));
  }));
}

function scenePaintHit(clientX, clientY, drag = null) {
  const rect = sceneCanvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  let hit, hits = [];
  const generatedVisible = !state.modifierResultGhost && !!sceneRenderer.mirrorCache?.instances?.length;
  const needsCoincident = state.paintIgnoreTransparent || state.tool === 'brush' && state.paintBrushOverlay;
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
    hit = hits[0] || sceneRenderer.pickDetailed(state.project, x, y, true,
      { includeGenerated: generatedVisible });
  }
  if (generatedVisible && needsCoincident) {
    const visible = sceneRenderer.pickDetailed(state.project, x, y, true, { includeGenerated: true });
    if (visible?.generated && (!hit || visible.distance <= hit.distance + 1e-6)
      && (!state.paintIgnoreTransparent || paintHitVisibleAtStart(visible, drag))) {
      hit = visible;
      hits = [visible];
    }
  }
  if (!hit?.faceName) return null;
  if (!paintDragAcceptsHit(drag, hit)) return null;
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
  const cacheKey = `${target.asset._uid}:${hit.cubeUid || target.cube.uid}`
    + `:${hit.cubeIndex ?? ''}:${target.faceName}:${hit.instanceKey || ''}`;
  const cached = drag.brushSurfaceCache?.get(cacheKey);
  if (cached) return cached;
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
  (drag.brushSurfaceCache ||= new Map()).set(cacheKey, surface);
  return surface;
}


async function applySceneBrushHit(drag, hit) {
    if (drag.canceled || !hit?.faceName) {
      drag.lastByFace.clear();
      return;
    }
    const directHits = drag.tool === 'brush' && state.paintBrushOverlay && hit.coincidentHits?.length ? hit.coincidentHits : [hit];
    // A central cube can be its own radial/mandala counterpart. When a stroke
    // crosses to the next physical face, symmetry may map that new source face
    // back onto a target face already active in the stroke. It is a different
    // branch, not a continuation of the old UV cursor on that target face.
    const hits = [...new Map(directHits.flatMap(sourceHit =>
      paintSymmetryRelatedHits(sourceHit, drag).map(paintHit => ({
        paintHit, sourceHit, sourceFaceKey: sceneBrushHitKey(sourceHit)
      }))).map(entry => [
        `${entry.sourceFaceKey}:${paintSymmetryFaceKey(entry.paintHit)}:${(entry.paintHit.symmetryPermutation || [0, 1, 2, 3]).join(',')}`,
        entry
      ])).values()];
    const activeKeys = new Set();
    for (const { paintHit, sourceHit } of hits) {
      const surface = await sceneBrushSurfaceForHit(drag, paintHit);
      if (!surface || drag.canceled) continue;
      const point = facePaintUvPoint(paintHit, surface, surface.canvas);
      if (!point) continue;
      // Keep one UV-space cursor per source/target face branch. Two adjacent
      // source faces can map onto the same target face around the symmetry
      // center, but their points must never be joined into one segment.
      const faceKey = sceneBrushBranchKey(sourceHit, paintHit, surface.asset._uid);
      const previousPoint = drag.lastByFace.get(faceKey);
      const wrapped = isFaceTiled(surface.cube.faces?.[surface.faceName]) && previousPoint
        && (Math.abs(previousPoint[0] - point[0]) > surface.canvas.width / 2 || Math.abs(previousPoint[1] - point[1]) > surface.canvas.height / 2);
      const previous = wrapped ? null : previousPoint;
      drawPaintSegment(surface, previous || point, point);
      drag.lastByFace.set(faceKey, point);
      activeKeys.add(faceKey);
    }
    for (const key of [...drag.lastByFace.keys()]) if (!activeKeys.has(key)) drag.lastByFace.delete(key);
}

function queueSceneBrushHit(drag, hit) {
  drag.queue = drag.queue.then(() => applySceneBrushHit(drag, hit)).catch(error => toast(error.message));
  return drag.queue;
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

async function paintSceneBrushPointerSegment(drag, previous, clientX, clientY) {
  const current = { x: clientX, y: clientY, hit: scenePaintHit(clientX, clientY, drag) };
  if (!previous) {
    await applySceneBrushHit(drag, current.hit);
    return current;
  }
  const distance = Math.hypot(clientX - previous.x, clientY - previous.y);
  const sampleCount = Math.max(1, Math.min(128, Math.ceil(distance / 6)));
  let prior = previous;
  let lastYield = performance.now();
  for (let index = 1; index <= sampleCount; index++) {
    if (drag.canceled) return current;
    const ratio = index / sampleCount;
    const sample = index === sampleCount ? current : {
      x: previous.x + (clientX - previous.x) * ratio,
      y: previous.y + (clientY - previous.y) * ratio
    };
    if (!sample.hit) sample.hit = scenePaintHit(sample.x, sample.y, drag);
    if (sceneBrushHitKey(prior.hit) !== sceneBrushHitKey(sample.hit)) {
      const boundary = sceneBrushBoundary(prior, sample, drag);
      if (boundary) {
        await applySceneBrushHit(drag, boundary.before);
        await applySceneBrushHit(drag, boundary.after);
      } else if (index !== sampleCount) await applySceneBrushHit(drag, sample.hit);
    }
    if (index === sampleCount) await applySceneBrushHit(drag, sample.hit);
    prior = sample;
    if (index < sampleCount && performance.now() - lastYield > 8) {
      await paintFrameOpportunity();
      lastYield = performance.now();
    }
  }
  return current;
}

function paintFrameOpportunity() {
  return new Promise(resolve => {
    // Resume after the frame's render callbacks, so a long stroke cannot
    // immediately consume the frame that should display its current pixels.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}

function queueSceneBrushPointer(drag, clientX, clientY) {
  const pending = drag.pendingBrushPointers ||= [];
  const last = pending.at(-1);
  if (!last || last[0] !== clientX || last[1] !== clientY) pending.push([clientX, clientY]);
  if (drag.brushPointerWorkerActive) return drag.queue;
  drag.brushPointerWorkerActive = true;
  drag.queue = drag.queue.then(async () => {
    let previous = drag.lastPointerSample;
    let nextIndex = 0;
    let lastYield = performance.now();
    try {
      while (nextIndex < pending.length && !drag.canceled) {
        const [x, y] = pending[nextIndex++];
        previous = await paintSceneBrushPointerSegment(drag, previous, x, y);
        drag.lastPointerSample = previous;
        if (nextIndex < pending.length && performance.now() - lastYield > 8) {
          await paintFrameOpportunity();
          lastYield = performance.now();
        }
      }
    } finally {
      pending.length = 0;
      drag.brushPointerWorkerActive = false;
    }
  }).catch(error => toast(error.message));
  return drag.queue;
}

function screenCellTouchesFaceEdge(drag, index, hit) {
  if (hit.facePoints?.length !== 4) return true;
  const key = sceneBrushHitKey(hit);
  const polygons = drag.screenFacePolygons ||= new Map();
  let polygon = polygons.get(key);
  if (!polygon) {
    polygon = [0, 1, 3, 2].map(slot => sceneRenderer.projectPoint(hit.facePoints[slot]));
    polygons.set(key, polygon);
  }
  if (polygon.some(point => !point || point.behind)) return true;
  const cellX = index % drag.screenGrid.width, cellY = Math.floor(index / drag.screenGrid.width);
  const inside = (x, y) => {
    let sign = 0;
    for (let edge = 0; edge < 4; edge++) {
      const first = polygon[edge], second = polygon[(edge + 1) % 4];
      const cross = (second.x - first.x) * (y - first.y) - (second.y - first.y) * (x - first.x);
      if (Math.abs(cross) < 1e-8) continue;
      if (sign && Math.sign(cross) !== sign) return false;
      sign = Math.sign(cross);
    }
    return true;
  };
  for (const dx of [0, 1]) for (const dy of [0, 1]) {
    if (!inside((cellX + dx) / drag.screenGrid.scaleX,
      (cellY + dy) / drag.screenGrid.scaleY)) return true;
  }
  return false;
}

async function paintScreenSpacePixels(drag, from, to, preview, generation, fromEndpoint, toEndpoint) {
    if (drag.canceled || preview && generation !== drag.screenGeneration) return;
    if (preview) resetScreenPaintPreview(drag);
    const pixels = rasterScreenPaint(drag.tool, from, to, drag.screenGrid, {
      size: drag.screenSize, brushShape: drag.screenBrushShape,
      antialias: drag.screenBrushAa, filled: drag.screenFilled
    });
    const byAsset = new Map();
    for (const [index, coverage] of pixels) {
      if (preview && generation !== drag.screenGeneration) return;
      const endpointHits = [...new Set([fromEndpoint, toEndpoint]
        .filter(endpoint => endpoint?.index === index && endpoint.hit))];
      let hits = drag.screenHits.get(index);
      if (!hits) {
        const [clientX, clientY] = screenPaintClientPoint(drag.screenGrid,
          index % drag.screenGrid.width, Math.floor(index / drag.screenGrid.width));
        const centerHit = scenePaintHit(clientX, clientY, drag);
        const sources = [];
        const seen = new Set();
        const addSource = hit => {
          for (const source of hit?.coincidentHits?.length && drag.tool === 'brush' && state.paintBrushOverlay
            ? hit.coincidentHits : hit ? [hit] : []) {
            const key = sceneBrushHitKey(source);
            if (key && !seen.has(key)) { seen.add(key); sources.push(source); }
          }
        };
        addSource(centerHit);
        if (!centerHit || screenCellTouchesFaceEdge(drag, index, centerHit)) {
          const cellX = index % drag.screenGrid.width, cellY = Math.floor(index / drag.screenGrid.width);
          for (const [offsetX, offsetY] of [[.15, .15], [.85, .15], [.15, .85], [.85, .85],
            [.5, .15], [.85, .5], [.5, .85], [.15, .5]]) {
            const sampleX = drag.screenGrid.left + (cellX + offsetX) / drag.screenGrid.scaleX;
            const sampleY = drag.screenGrid.top + (cellY + offsetY) / drag.screenGrid.scaleY;
            addSource(scenePaintHit(sampleX, sampleY, drag));
          }
        }
        hits = sources.flatMap(source => paintSymmetryRelatedHits(source, drag)
          .filter(paintHit => paintHit === source || screenPaintHitIsVisible(paintHit))
          .map(paintHit => ({ paintHit, sourceHit: source })));
        drag.screenHits.set(index, hits);
      }
      if (endpointHits.length) {
        const seen = new Set(hits.map(({ sourceHit }) => sceneBrushHitKey(sourceHit)));
        for (const endpoint of endpointHits) {
          const key = sceneBrushHitKey(endpoint.hit);
          if (seen.has(key)) continue;
          seen.add(key);
          hits = [...hits, ...paintSymmetryRelatedHits(endpoint.hit, drag)
            .filter(paintHit => paintHit === endpoint.hit || screenPaintHitIsVisible(paintHit))
            .map(paintHit => ({ paintHit, sourceHit: endpoint.hit }))];
        }
      }
      for (const { paintHit: hit, sourceHit } of hits) {
        let target = drag.screenTargets.get(hit);
        if (target === undefined) {
          target = facePaintTarget(hit) || null;
          drag.screenTargets.set(hit, target);
        }
        if (!target) {
          if (hit?.faceName && !drag.warnedUntextured) {
            drag.warnedUntextured = true;
            toast('這個面尚未分配貼圖，無法繪製');
          }
          continue;
        }
        let group = byAsset.get(target.asset._uid);
        if (!group) { group = { asset: target.asset, samples: [] }; byAsset.set(target.asset._uid, group); }
        group.samples.push({ hit, sourceHit, target, coverage, index });
      }
    }
    for (const group of byAsset.values()) {
      const base = await ensureScenePaintAssetSurface(drag, group.asset);
      if (!base || drag.canceled || preview && generation !== drag.screenGeneration) continue;
      let lastYield = performance.now();
      for (const { hit, sourceHit, target, coverage, index } of group.samples) {
        const point = facePaintUvPoint(hit, target, base.canvas);
        if (!point) continue;
        const surfaceKey = `${group.asset._uid}:${hit.cubeUid || target.cube.uid}:${hit.cubeIndex ?? ''}:${target.faceName}`;
        let surface = drag.screenSurfaces.get(surfaceKey);
        if (!surface || surface.canvas !== base.canvas) {
          surface = { ...base, baseSurface: base, rootDrag: drag, tool: drag.tool,
            clip: paintUvBounds(target.cube, target.faceName, base.canvas) };
          drag.screenSurfaces.set(surfaceKey, surface);
        }
        let footprint = sourceHit === hit ? drag.screenFootprints.get(hit) : null;
        if (sourceHit === hit && (!footprint || footprint.index !== index || footprint.canvas !== base.canvas)) {
          footprint = { index, canvas: base.canvas,
            points: screenCellUvFootprint(drag.screenGrid, index, hit, target, base.canvas, point, surface.clip) };
          drag.screenFootprints.set(hit, footprint);
        }
        const points = sourceHit === hit ? footprint.points : [point];
        for (const [x, y] of points) drawScreenPaintPixel(surface, x, y, coverage);
        if (!preview && drag.tool === 'brush' && performance.now() - lastYield > 8) {
          flushScreenPaintSurface(base);
          await paintFrameOpportunity();
          if (drag.canceled) return;
          lastYield = performance.now();
        }
      }
      if (drag.touchedSurfaces.has(base)) flushScreenPaintSurface(base);
    }
}

function queueScreenSpacePaint(drag, from, to, preview = false, toEndpoint = null) {
  const generation = ++drag.screenGeneration;
  if (!preview && drag.tool === 'brush') {
    const pendingStrokes = drag.screenPendingStrokes ||= [];
    pendingStrokes.push({ point: to, endpoint: toEndpoint });
    if (drag.screenBrushWorkerActive) return drag.queue;
    drag.screenBrushWorkerActive = true;
    drag.queue = drag.queue.then(async () => {
      let lastPoint = drag.screenPaintedPoint || from;
      let lastEndpoint = drag.screenPaintedEndpoint || toEndpoint;
      let lastYield = performance.now();
      let nextIndex = 0;
      try {
        while (nextIndex < pendingStrokes.length && !drag.canceled) {
          const pending = pendingStrokes[nextIndex++];
          await paintScreenSpacePixels(drag, lastPoint, pending.point, false, generation,
            lastEndpoint, pending.endpoint);
          lastPoint = pending.point;
          lastEndpoint = pending.endpoint;
          if (nextIndex < pendingStrokes.length && performance.now() - lastYield > 8) {
            await paintFrameOpportunity();
            lastYield = performance.now();
          }
        }
      } finally {
        pendingStrokes.length = 0;
        drag.screenBrushWorkerActive = false;
      }
      drag.screenPaintedPoint = lastPoint;
      drag.screenPaintedEndpoint = lastEndpoint;
    }).catch(error => { drag.screenBrushWorkerActive = false; toast(error.message); });
    return drag.queue;
  }
  drag.queue = drag.queue.then(() => paintScreenSpacePixels(drag, from, to, preview,
    generation, drag.screenStartEndpoint, toEndpoint)).catch(error => toast(error.message));
  return drag.queue;
}

function screenPointerEndpoint(drag, clientX, clientY, point) {
  return { index: point[1] * drag.screenGrid.width + point[0],
    hit: scenePaintHit(clientX, clientY, drag) };
}

function screenPaintHitIsVisible(hit) {
  if (!hit?.point) return false;
  const projected = sceneRenderer.projectPoint(hit.point);
  const rect = sceneCanvas.getBoundingClientRect();
  if (projected.behind || projected.x < 0 || projected.y < 0
    || projected.x >= rect.width || projected.y >= rect.height) return false;
  return sceneBrushHitKey(scenePaintHit(rect.left + projected.x, rect.top + projected.y))
    === sceneBrushHitKey(hit);
}

function screenVisibleFaceKey(grid, x, y, cache, drag = null) {
  const cellX = Math.floor(x * grid.scaleX), cellY = Math.floor(y * grid.scaleY);
  if (cellX < 0 || cellY < 0 || cellX >= grid.width || cellY >= grid.height) return '';
  const index = cellY * grid.width + cellX;
  if (!cache.has(index)) {
    const [clientX, clientY] = screenPaintClientPoint(grid, cellX, cellY);
    cache.set(index, sceneBrushHitKey(scenePaintHit(clientX, clientY, drag)));
  }
  return cache.get(index);
}

function screenCellUvFootprint(grid, index, hit, target, canvas, center, bounds = null) {
  if (isFaceTiled(target.cube.faces?.[target.faceName])) return [center];
  const points = hit.facePoints;
  if (!points || points.length !== 4) return [center];
  const edgeU = points[1].map((value, axis) => value - points[0][axis]);
  const edgeV = points[2].map((value, axis) => value - points[0][axis]);
  const normal = [edgeU[1] * edgeV[2] - edgeU[2] * edgeV[1],
    edgeU[2] * edgeV[0] - edgeU[0] * edgeV[2], edgeU[0] * edgeV[1] - edgeU[1] * edgeV[0]];
  const cellX = index % grid.width, cellY = Math.floor(index / grid.width);
  const corners = [];
  for (const [offsetX, offsetY] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const screenX = (cellX + offsetX) / grid.scaleX;
    const screenY = (cellY + offsetY) / grid.scaleY;
    const ray = sceneRenderer.rayAt(screenX, screenY);
    if (!ray) return [center];
    const denominator = dot3(normal, ray.direction);
    if (Math.abs(denominator) < 1e-9) return [center];
    const distance = dot3(normal, points[0].map((value, axis) => value - ray.origin[axis])) / denominator;
    if (distance <= 0) return [center];
    const world = ray.origin.map((value, axis) => value + ray.direction[axis] * distance);
    const uv = facePaintUvContinuous({ ...hit, point: world }, target, canvas);
    if (!uv) return [center];
    corners.push(uv);
  }
  return rasterScreenUvFootprint(corners, center, bounds);
}

function startScreenSpacePaint(event) {
  event.preventDefault();
  sceneCanvas.setPointerCapture(event.pointerId);
  const grid = screenPaintGrid(sceneCanvas.getBoundingClientRect(), state.paintScreenHeight);
  const start = screenPaintPoint(grid, event.clientX, event.clientY);
  const tool = state.tool;
  const drag = {
    type: 'texture-paint-3d', screenSpace: true, multiSurface: true,
    pointerId: event.pointerId, tool, ready: true, ended: false, canceled: false, finished: false,
    screenGrid: grid, screenStart: start, screenLast: start, screenEnd: start,
    latestBucketClient: [event.clientX, event.clientY],
    screenGeneration: 0, screenHits: new Map(), screenTargets: new WeakMap(),
    screenFootprints: new WeakMap(), screenSurfaces: new Map(),
    screenVisibility: new Map(),
    screenBucket: tool === 'fill', screenBucketSeen: new Set(), screenOriginalPixels: new Map(),
    screenSize: tool === 'brush' ? state.paintBrushSize : state.paintToolSettings[tool]?.size || 1,
    screenBrushShape: state.paintBrushShape, screenBrushAa: state.paintBrushAa,
    screenFilled: state.paintShapeFilled,
    latestClient: [event.clientX, event.clientY], queue: Promise.resolve(),
    assetSurfaces: new Map(), assetSurfacePromises: new Map(), historyAssets: new Set(),
    touchedSurfaces: new Set(), paintSymmetryCaches: new Map(), paintSymmetryOperatorScopes: null,
    historyGroup: crypto.randomUUID(), paintHitAlphaSnapshots: paintHitAlphaSnapshot(),
    holisticStroke: true
  };
  drag.screenStartEndpoint = screenPointerEndpoint(drag, event.clientX, event.clientY, start);
  drag.screenPaintedEndpoint = drag.screenStartEndpoint;
  drag.screenLastEndpoint = drag.screenStartEndpoint;
  drag.screenPaintedPoint = start;
  drag.screenLastClient = [event.clientX, event.clientY];
  state.dragging = drag;
  if (drag.screenBucket) queueScreenSpaceBucket(drag, event.clientX, event.clientY);
  else queueScreenSpacePaint(drag, start, start, tool !== 'brush', drag.screenStartEndpoint);
  return true;
}

function queueScreenSpaceBucket(drag, clientX, clientY, mirror = true) {
  const hit = scenePaintHit(clientX, clientY, drag);
  const target = facePaintTarget(hit);
  if (!target) return;
  const scope = state.paintBucketScope;
  const key = `${scope}:${sceneBrushHitKey(hit)}${['color', 'contiguous'].includes(scope)
    ? `:${Math.floor(clientX / 4)}:${Math.floor(clientY / 4)}` : ''}`;
  if (drag.screenBucketSeen.has(key)) return;
  drag.screenBucketSeen.add(key);
  if (mirror) for (const related of paintSymmetryRelatedHits(hit, drag).slice(1)) {
    if (!screenPaintHitIsVisible(related)) continue;
    const projected = sceneRenderer.projectPoint(related.point);
    const rect = sceneCanvas.getBoundingClientRect();
    queueScreenSpaceBucket(drag, rect.left + projected.x, rect.top + projected.y, false);
  }
  drag.queue = drag.queue.then(async () => {
    const seed = await ensureScenePaintAssetSurface(drag, target.asset);
    if (!seed) return;
    const point = facePaintUvPoint(hit, target, seed.canvas);
    if (!point) return;
    const original = asset => {
      if (!drag.screenOriginalPixels.has(asset._uid)) {
        const base = drag.assetSurfaces.get(asset._uid);
        drag.screenOriginalPixels.set(asset._uid,
          new Uint8ClampedArray(base.context.getImageData(0, 0, base.canvas.width, base.canvas.height).data));
      }
      return drag.screenOriginalPixels.get(asset._uid);
    };
    const seedPixels = original(target.asset);
    const seedOffset = (point[1] * seed.canvas.width + point[0]) * 4;
    const seedColor = seedPixels.slice(seedOffset, seedOffset + 4);
    const faceQuads = scope === 'face' || state.paintBucketSingleFace && ['color', 'contiguous'].includes(scope)
      ? [hit] : scope === 'element'
        ? sceneRenderer.getCubeFaceQuads(hit.uid, hit.cubeUid || hit.uid)
        : sceneRenderer.getFaceQuadsForUids(new Set(state.project.elements.map(element => element.uid)));
    const candidates = new Map();
    const rect = sceneCanvas.getBoundingClientRect();
    let examined = 0;
    for (const faceHit of faceQuads) {
      const faceTarget = facePaintTarget(faceHit);
      if (!faceTarget || ['color', 'contiguous'].includes(scope)
        && faceTarget.asset._uid !== target.asset._uid) continue;
      const base = await ensureScenePaintAssetSurface(drag, faceTarget.asset);
      if (!base) continue;
      const pixels = original(faceTarget.asset);
      const bounds = paintUvBounds(faceTarget.cube, faceTarget.faceName, base.canvas);
      for (let y = bounds.minV; y < bounds.maxV; y++) for (let x = bounds.minU; x < bounds.maxU; x++) {
        if (++examined % 4096 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
          if (drag.canceled) return;
        }
        if (!paintSelectionAllows(state, faceTarget.asset._uid, x, y, base.canvas.width, base.canvas.height)) continue;
        const pixel = y * base.canvas.width + x, offset = pixel * 4;
        if (['color', 'contiguous'].includes(scope)
          && (pixels[offset] !== seedColor[0] || pixels[offset + 1] !== seedColor[1]
            || pixels[offset + 2] !== seedColor[2] || pixels[offset + 3] !== seedColor[3])) continue;
        const world = facePixelWorldPoint(faceTarget.cube, faceTarget.faceName, faceHit.facePoints, x, y);
        if (!world) continue;
        const projected = sceneRenderer.projectPoint(world);
        if (projected.behind || projected.x < 0 || projected.y < 0
          || projected.x >= rect.width || projected.y >= rect.height) continue;
        if (screenVisibleFaceKey(drag.screenGrid, projected.x, projected.y,
          drag.screenVisibility, drag) !== sceneBrushHitKey(faceHit)) continue;
        candidates.set(`${faceTarget.asset._uid}:${pixel}`, { base, target: faceTarget, x, y, pixel });
      }
    }
    let entries = [...candidates.values()];
    if (scope === 'contiguous') {
      const start = point[1] * seed.canvas.width + point[0];
      const pending = [start], visited = new Set(), connected = new Set();
      while (pending.length) {
        const pixel = pending.pop();
        if (visited.has(pixel)) continue;
        visited.add(pixel);
        const entry = candidates.get(`${target.asset._uid}:${pixel}`);
        if (!entry) continue;
        connected.add(pixel);
        const x = pixel % seed.canvas.width, y = Math.floor(pixel / seed.canvas.width);
        if (x > 0) pending.push(pixel - 1);
        if (x + 1 < seed.canvas.width) pending.push(pixel + 1);
        if (y > 0) pending.push(pixel - seed.canvas.width);
        if (y + 1 < seed.canvas.height) pending.push(pixel + seed.canvas.width);
      }
      entries = entries.filter(entry => connected.has(entry.pixel));
    }
    const touched = new Set();
    for (const entry of entries) {
      const surface = { ...entry.base, baseSurface: entry.base, rootDrag: drag,
        tool: 'fill', clip: paintUvBounds(entry.target.cube, entry.target.faceName, entry.base.canvas) };
      drawScreenPaintPixel(surface, entry.x, entry.y, 1);
      touched.add(entry.base);
    }
    for (const base of touched) flushScreenPaintSurface(base);
  }).catch(error => toast(error.message));
}

function finishScenePaintDrag(drag) {
  if (!drag || drag.finished) return;
  drag.finished = true;
  if (drag.screenSpace) {
    drag.queue.then(() => {
      if (drag.canceled || !drag.touchedSurfaces.size) return;
      discardPaintedTextureSync([...drag.touchedSurfaces].map(surface => surface.asset));
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
  if (drag.bucketDrag) {
    drag.queue.then(() => finishTextureBucketStroke(drag.history)).catch(error => toast(error.message));
    return;
  }
  if (drag.multiSurface) {
    if (drag.lastPointerSample && drag.latestClient
      && (drag.lastPointerSample.x !== drag.latestClient[0] || drag.lastPointerSample.y !== drag.latestClient[1])) {
      queueSceneBrushPointer(drag, drag.latestClient[0], drag.latestClient[1]);
    }
    drag.queue.then(() => {
      if (drag.canceled) return;
      if (!drag.touchedSurfaces.size) return;
      discardPaintedTextureSync([...drag.touchedSurfaces].map(surface => surface.asset));
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
  discardPaintedTextureSync([drag.asset]);
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
    group.strokeTiles = null;
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
  if ((drag.multiSurface || drag.screenSpace && drag.tool === 'brush')
    && typeof event.getCoalescedEvents === 'function') {
    const samples = event.getCoalescedEvents();
    for (const sample of samples) {
      if (Number.isFinite(sample.clientX) && Number.isFinite(sample.clientY))
        moveScenePaintDrag({ clientX: sample.clientX, clientY: sample.clientY }, drag);
    }
    if (samples.length && samples.at(-1).clientX === event.clientX
      && samples.at(-1).clientY === event.clientY) return true;
  }
  drag.latestClient = [event.clientX, event.clientY];
  if (drag.screenSpace) {
    if (drag.screenBucket) {
      const previous = drag.latestBucketClient;
      const steps = Math.max(1, Math.min(128, Math.ceil(Math.hypot(event.clientX - previous[0], event.clientY - previous[1]) / 6)));
      for (let index = 1; index <= steps; index++) {
        const ratio = index / steps;
        queueScreenSpaceBucket(drag, previous[0] + (event.clientX - previous[0]) * ratio,
          previous[1] + (event.clientY - previous[1]) * ratio);
      }
      drag.latestBucketClient = [event.clientX, event.clientY];
      return true;
    }
    const point = screenPaintPoint(drag.screenGrid, event.clientX, event.clientY);
    const sameCell = point[0] === drag.screenEnd[0] && point[1] === drag.screenEnd[1];
    if (sameCell && event.clientX === drag.screenLastClient[0]
      && event.clientY === drag.screenLastClient[1]) return true;
    const endpoint = screenPointerEndpoint(drag, event.clientX, event.clientY, point);
    if (drag.tool === 'brush') queueScreenSpacePaint(drag, drag.screenLast, point, false, endpoint);
    else queueScreenSpacePaint(drag, drag.screenStart, point, true, endpoint);
    drag.screenLast = point;
    drag.screenEnd = point;
    drag.screenLastEndpoint = endpoint;
    drag.screenLastClient = [event.clientX, event.clientY];
    return true;
  }
  if (drag.bucketDrag) {
    const previous = drag.lastBucketClient;
    const steps = Math.max(1, Math.min(256, Math.ceil(Math.hypot(event.clientX - previous[0], event.clientY - previous[1]) / 6)));
    for (let index = 1; index <= steps; index++) {
      const ratio = index / steps;
      queueSceneBucketAt(drag, previous[0] + (event.clientX - previous[0]) * ratio,
        previous[1] + (event.clientY - previous[1]) * ratio);
    }
    drag.lastBucketClient = [event.clientX, event.clientY];
    return true;
  }
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

function queueSceneBucketAt(drag, clientX, clientY) {
  const hit = scenePaintHit(clientX, clientY, drag);
  if (!hit) return;
  if (state.paintBucketScope === 'face' || state.paintBucketScope === 'element') {
    const target = facePaintTarget(hit);
    if (!target) return;
    const key = state.paintBucketScope === 'element' ? `element:${target.cube.uid}`
      : `face:${target.cube.uid}:${target.faceName}`;
    if (drag.seen.has(key)) return;
  }
  drag.queue = drag.queue.then(async () => {
    for (const paintHit of paintSymmetryRelatedHits(hit)) {
      const target = facePaintTarget(paintHit);
      if (!target) continue;
      const cached = drag.history.canvases?.get(target.asset._uid);
      const result = cached
        ? { canvas: cached.canvas, context: cached.canvas.getContext('2d') }
        : await paintCanvasForAsset(target.asset);
      const point = result && facePaintUvPoint(paintHit, target, result.canvas);
      if (!point) continue;
      const scope = state.paintBucketScope;
      const key = scope === 'element' ? `element:${target.cube.uid}`
        : scope === 'face' ? `face:${target.cube.uid}:${target.faceName}`
          : `pixel:${target.asset._uid}:${point[0]}:${point[1]}`;
      if (drag.seen.has(key)) continue;
      drag.seen.add(key);
      await applyTextureBucket(target.asset, point,
        { cube: target.cube, faceName: target.faceName }, drag.history);
    }
  }).catch(error => toast(error.message));
}

function startScenePaintPointer(event, x, y) {
  if (event.ctrlKey && (state.tool === 'brush' || state.tool === 'fill' || PAINT_SHAPE_TOOLS.includes(state.tool)))
    return startScreenSpacePaint(event);
  const hit = scenePaintHit(event.clientX, event.clientY);
  if (state.tool === 'eyedropper' && !hit) {
    const color = sampleReferenceImage?.(event.clientX, event.clientY);
    if (color) {
      event.preventDefault();
      setPaintColor(color, true);
      updateToolOptions();
      return true;
    }
  }
  if (state.tool === 'gradient') {
    if (!hit?.faceName) { toast('請指向一個 Cube 面'); return true; }
    const cube = hit.cube?.type === 'cube' ? hit.cube : state.project.getNode(hit.uid);
    const faceAsset = textureAssetForReference(cube?.faces?.[hit.faceName]?.texture);
    if (!faceAsset) { toast('這個面尚未分配貼圖，無法繪製'); return true; }
    event.preventDefault();
    if (event.ctrlKey || state.paintGradientAnchor?.screenSpace) useScreenPaintGradient(hit, event);
    else useScenePaintGradient(hit);
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
  if (!target && state.tool !== 'fill') {
    toast(hit?.faceName ? '這個面尚未分配貼圖，無法繪製' : '請指向一個 Cube 面');
    return true;
  }
  event.preventDefault();
  if (state.tool === 'fill') {
    if (hit?.faceName && !target) toast('這個面尚未分配貼圖，無法繪製');
    sceneCanvas.setPointerCapture(event.pointerId);
    const drag = {
      type: 'texture-paint-3d', bucketDrag: true, pointerId: event.pointerId, tool: 'fill',
      ready: true, latestClient: [event.clientX, event.clientY],
      lastBucketClient: [event.clientX, event.clientY], seen: new Set(), queue: Promise.resolve(),
      history: { group: crypto.randomUUID(), assets: new Set() }
    };
    state.dragging = drag;
    queueSceneBucketAt(drag, event.clientX, event.clientY);
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
    cubeUid: hit.cubeUid || hit.uid, faceName: hit.faceName, instanceKey: hit.instanceKey || null,
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
  const faceUv = target.cube.uvMode !== 'box' && Array.isArray(face.uv) && face.uv.length >= 4
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
return { persistGeneratedPaintCube, barycentricPoint, facePaintUvPoint, faceUvWorldPoint, blendRgbaPixel, activePaintGradientStops, samplePaintGradient, clearPaintGradientSelection, renderPaintGradientPreview, updatePaintGradientHover, paintCanvasForAsset, queueSceneBrushPointer, finishScenePaintDrag, moveScenePaintDrag, startScenePaintPointer };
}
