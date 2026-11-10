import { dot3 } from '../utils/math/vector3.js';
import { paintSelectionAllows } from './selection-controller.js';
import { screenPaintGrid } from './screen-space.js';

// Scene gradients share a color ramp between the live preview and raster bake.
export function createSceneGradientController({
  state, $, sceneCanvas, sceneRenderer, paletteRows, palette, clamp, hexToRgb,
  samplePaletteGradient, paintToolOpacity, facePaintTarget, facePixelWorldPoint,
  paintSymmetryRelatedHits, paintSymmetryFaceKey, sceneBrushHitKey, screenVisibleFaceKey,
  paintCanvasForAsset, pushTexturePaintHistory, paintUvBounds, commitPaintedTextureAsset,
  queuePaintedTextureSync, syncPaintedTextureNow, renderTextureList, renderScene, toast
}) {
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
    if (overlay) {
      overlay.innerHTML = '';
      overlay.hidden = true;
    }
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
      if (overlay) {
        overlay.innerHTML = '';
        overlay.hidden = true;
      }
      return;
    }
    const sameCube = (hover.cubeUid || hover.uid) === (anchor.hit.cubeUid || anchor.hit.uid);
    const sameFace = sameCube && hover.faceName === anchor.hit.faceName;
    if (!sameCube || (state.paintGradientMode === 'face' && !sameFace)) {
      overlay.innerHTML = '';
      overlay.hidden = true;
      return;
    }
    const direction = hover.point.map((value, axis) => value - anchor.hit.point[axis]);
    const domainFaces = state.paintGradientMode === 'face'
      ? [hover]
      : sceneRenderer.getCubeFaceQuads(anchor.hit.uid, anchor.hit.cubeUid || anchor.hit.uid);
    const range = projectedGradientRange(domainFaces.flatMap(entry => entry.facePoints || []), anchor.hit.point, direction);
    if (!range) {
      overlay.innerHTML = '';
      overlay.hidden = true;
      return;
    }
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
      state.paintGradientHover = {
        screenPoint: snappedScreenPoint(state.paintGradientAnchor.screenGrid,
          event.clientX - rect.left, event.clientY - rect.top)
      };
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
        surface = {
          ...result, asset: target.asset,
          image: result.context.getImageData(0, 0, result.canvas.width, result.canvas.height)
        };
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

  return {
    blendRgbaPixel, activePaintGradientStops, samplePaintGradient,
    clearPaintGradientSelection, renderPaintGradientPreview, updatePaintGradientHover,
    useScreenPaintGradient, useScenePaintGradient
  };
}
