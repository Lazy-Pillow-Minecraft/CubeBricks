import { createPaintStrokeController } from '../src/paint/stroke-controller.js';
import { createScenePaintController } from '../src/paint/scene-controller.js';
import { tiledFacePaintBounds } from '../src/paint/tiled-face.js';

// Run in an isolated Electron renderer: real canvas pixels, no desktop control
// and no user project/history writes.
export async function verifyTiledPaint() {
  const check = (value, message) => { if (!value) throw Error(message); };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const makeCanvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
  const mask = canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return Array.from({ length: canvas.width * canvas.height }, (_, i) => data[i * 4 + 3]);
  };
  const makeStroke = state => createPaintStrokeController({
    state, clamp,
    paintSetting: () => ({ size: 1 }), paintToolOpacity: () => .5, paintToolErasing: () => false,
    syncRendererTextureAsset() {}, scheduleSceneRender() {}, noteJournalOperation() {}
  });
  const paintState = {
    tool: 'line', paintColor: '#ff0000', paintShapeFilled: false,
    paintIgnoreTransparent: false, alphaLock: false
  };
  const stroke = makeStroke(paintState);
  const cube = { size: [24, 8, 1], faces: { north: { tiling: { width: 24, height: 8, offsetX: 0, offsetY: 0 } } } };
  const shape = (tool, start, end, filled = false) => {
    const canvas = makeCanvas(8, 8), context = canvas.getContext('2d');
    const drag = {
      canvas, context, tool, start, asset: { _uid: 'shape' },
      clip: { minU: 0, minV: 0, maxU: 8, maxV: 8 }, tiledFaceBounds: tiledFacePaintBounds(cube, 'north', canvas),
      baseImage: context.getImageData(0, 0, 8, 8), holisticStroke: true,
      historyAssets: new Set(['shape']), touchedSurfaces: new Set()
    };
    drag.rootDrag = drag;
    drag.baseSurface = drag;
    paintState.paintShapeFilled = filled;
    stroke.drawPaintShape(drag, end);
    return { canvas, drag };
  };
  const line = shape('line', [7, 2], [9, 2]);
  check(JSON.stringify(mask(line.canvas).slice(16, 24)) === JSON.stringify([128, 128, 0, 0, 0, 0, 0, 128]),
    'A line crossing a tile seam covers only its continuous segment');
  stroke.drawPaintShape(line.drag, [8, 2]);
  check(mask(line.canvas)[17] === 0 && mask(line.canvas)[16] === 128, 'Live preview removes pixels from the previous endpoint');
  const rectangle = mask(shape('rectangle', [7, 2], [9, 4], true).canvas);
  check(rectangle.filter(Boolean).length === 9 && rectangle[3 * 8] === 128 && rectangle[3 * 8 + 4] === 0,
    'Filled rectangles cross seams without filling the gap on the source texture');
  const ellipse = mask(shape('ellipse', [6, 1], [10, 5], true).canvas);
  check(ellipse[3 * 8] === 128 && ellipse[3 * 8 + 4] === 0, 'Ellipses retain their face-local center across a seam');
  const repeated = mask(shape('line', [1, 6], [20, 6]).canvas);
  check(repeated.slice(48, 56).every(alpha => alpha === 128), 'Crossing several periods applies stroke opacity once');
  cube.faces.north.tiling.offsetX = -2;
  const negative = mask(shape('line', [-1, 2], [1, 2]).canvas);
  check(negative[23] === 128 && negative[16] === 128 && negative[17] === 128, 'Negative offsets retain and wrap all stroke pixels');
  cube.size[0] = 2;
  cube.faces.north.tiling.width = 2;
  cube.faces.north.tiling.offsetX = 0;
  const clipped = mask(shape('line', [-3, 1], [4, 1]).canvas);
  check(clipped.filter(Boolean).length === 2 && clipped[8] === 128 && clipped[9] === 128,
    'A shape clips at the physical face boundary before wrapping');
  stroke.discardPaintedTextureSync(['shape']);

  async function sceneStroke(tiled, perspective, screenSpace = true) {
    const canvas = makeCanvas(tiled ? 64 : 128, tiled ? 32 : 64);
    const asset = {
      _uid: tiled ? 'tiled' : 'normal',
      mode: tiled ? 'tiled' : 'default',
      uvWidth: canvas.width,
      uvHeight: canvas.height
    };
    const cube = {
      uid: 'cube', type: 'cube', size: [16, 8, 1], uvMode: 'face',
      faces: { north: { texture: asset._uid, uv: [0, 0, 128, 64], tiling: { width: 128, height: 64, offsetX: 0, offsetY: 0 } } }
    };
    const points = [[0, 0, 0], [16, 0, -8], [0, 8, 0], [16, 8, -8]];
    const state = {
      mode: 'paint', tool: screenSpace ? 'brush' : 'line', paintColor: '#ff0000', paintIgnoreTransparent: false,
      paintScreenHeight: 32, paintBrushSize: 1, paintBrushShape: 'square', paintBrushAa: false,
      paintToolSettings: {}, textureAssets: [asset], activeTextureUid: asset._uid,
      project: { getNode: () => cube }, paintHistory: [], paintFuture: []
    };
    const stroke = makeStroke(state);
    const rayAt = (x, y) => perspective
      ? { origin: [8, 4, 20], direction: [(x / 100 - .5) * 16, (y / 100 - .5) * 8, -20] }
      : { origin: [x / 100 * 16, y / 100 * 8, 20], direction: [0, 0, -1] };
    const pickDetailed = (_project, x, y) => {
      const ray = rayAt(x, y), t = -(ray.origin[2] + ray.origin[0] / 2) / (ray.direction[2] + ray.direction[0] / 2);
      const point = ray.origin.map((value, axis) => value + ray.direction[axis] * t);
      if (point[0] < 0 || point[0] > 16 || point[1] < 0 || point[1] > 8) return null;
      return { uid: cube.uid, cubeUid: cube.uid, cube, faceName: 'north', point, facePoints: points };
    };
    let committed = null;
    const controller = createScenePaintController({
      state, clamp,
      sceneCanvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), setPointerCapture() {} },
      sceneRenderer: {
        pickDetailed,
        rayAt,
        projectPoint: point => ({ x: point[0] / 16 * 100, y: point[1] / 8 * 100, behind: false })
      },
      textureAssetForReference: () => asset, isFaceTiled: () => tiled,
      loadTextureAssetImage: async () => canvas, paintHitAlphaCache: new Map(), animationRasterCache: new Map(),
      paintSymmetryRelatedHits: hit => [hit], paintSymmetryFaceKey: hit => hit.uid + '::' + hit.faceName,
      pushTexturePaintHistory() {}, paintUvBounds: () => ({ minU: 0, minV: 0, maxU: canvas.width, maxV: canvas.height }),
      drawScreenPaintPixel: stroke.drawScreenPaintPixel, flushScreenPaintSurface: stroke.flushScreenPaintSurface,
      resetScreenPaintPreview: stroke.resetScreenPaintPreview,
      drawPaintShape: stroke.drawPaintShape, drawPaintSegment: stroke.drawPaintSegment,
      queuePaintedTextureSync: stroke.queuePaintedTextureSync, syncPaintedTextureNow: stroke.syncPaintedTextureNow,
      discardPaintedTextureSync: stroke.discardPaintedTextureSync,
      commitPaintedTextureAsset: (_asset, result) => { committed = mask(result); }, renderScene() {},
      toast: message => { throw Error(message); }
    });
    controller.startScenePaintPointer({ ctrlKey: screenSpace, pointerId: 1, clientX: 45, clientY: 48, preventDefault() {} }, 45, 48);
    const drag = state.dragging;
    if (!screenSpace) {
      for (let i = 0; i < 10 && !drag.ready; i++)await Promise.resolve();
      check(drag.ready, 'Scene geometry initializes its paint surface');
      check(!tiled || !!drag.tiledFaceBounds, 'Scene geometry records the tiled face domain');
    }
    controller.moveScenePaintDrag({ clientX: 55, clientY: 48 }, drag);
    if (screenSpace) await drag.queue;
    const output = screenSpace ? [...drag.assetSurfaces.values()][0].canvas : drag.canvas;
    const pixels = mask(output);
    if (!screenSpace) {
      controller.finishScenePaintDrag(drag);
      await Promise.resolve();
      check(JSON.stringify(committed) === JSON.stringify(pixels), 'Final geometry matches its live preview after symmetry processing');
    }
    stroke.discardPaintedTextureSync([asset._uid]);
    return { canvas: output, pixels };
  }
  for (const perspective of [false, true]) for (const screenSpace of [false, true]) {
    const tiled = await sceneStroke(true, perspective, screenSpace), normal = await sceneStroke(false, perspective, screenSpace);
    const folded = new Uint8Array(tiled.pixels.length);
    for (let y = 0; y < normal.canvas.height; y++)for (let x = 0; x < normal.canvas.width; x++) {
      const index = (y % 32) * 64 + x % 64;
      folded[index] = Math.max(folded[index], normal.pixels[y * normal.canvas.width + x]);
    }
    check(folded.some(Boolean), 'Reference stroke contains pixels');
    check(tiled.pixels.every((value, index) => value === folded[index]),
      'Tiled ' + (screenSpace ? 'screen-space width' : 'geometry') + ' matches normal textures in ' + (perspective ? 'perspective' : 'orthographic') + ' projection');
  }
  return ['seam line', 'preview reset', 'filled rectangle', 'ellipse', 'multi-period opacity', 'negative offsets', 'physical face clip', 'geometry preview/commit orthographic', 'geometry preview/commit perspective', 'screen width orthographic', 'screen width perspective'];
}

export async function verifyTiledBrush() {
  const check = (value, message) => { if (!value) throw Error(message); }, clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const alpha = canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return Array.from({ length: canvas.width * canvas.height }, (_, i) => data[i * 4 + 3]);
  };
  const makeStroke = (shape, size, aa = false, erase = false) => {
    const state = { tool: 'brush', paintColor: '#ff0000', paintBrushShape: shape, paintBrushAa: aa };
    const stroke = createPaintStrokeController({
      state,
      clamp,
      paintSetting: () => ({ size }),
      paintToolOpacity: () => .5,
      paintToolErasing: () => erase,
      syncRendererTextureAsset() {},
      scheduleSceneRender() {},
      noteJournalOperation() {}
    });
    return { state, stroke };
  };
  function stamp(shape, size, aa = false, erase = false, wrapped = true) {
    const { stroke } = makeStroke(shape, size, aa, erase), canvas = makeCanvas(wrapped ? 8 : 32, wrapped ? 8 : 32), context = canvas.getContext('2d');
    if (erase) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    const surface = {
      canvas,
      context,
      tool: 'brush',
      wrapTexture: wrapped,
      asset: { _uid: 'wrap-test' },
      holisticStroke: true,
      historyAssets: new Set(['wrap-test']),
      touchedSurfaces: new Set()
    };
    surface.rootDrag = surface;
    surface.baseSurface = surface;
    const point = wrapped ? [0, 0] : [16, 16];
    stroke.drawPaintSegment(surface, point, point, false);
    stroke.discardPaintedTextureSync(['wrap-test']);
    return { canvas, alpha: alpha(canvas) };
  }
  const square = stamp('square', 5);
  check(square.alpha.filter(Boolean).length === 25 && square.alpha[63] === 128, 'square brush radius wraps across both texture seams and corners');
  const large = stamp('square', 17);
  check(large.alpha.every(value => value === 128), 'several repetitions within one stamp apply opacity once');
  for (const aa of [false, true]) {
    const wrapped = stamp('circle', 7, aa), normal = stamp('circle', 7, aa, false, false), folded = new Uint8Array(64);
    for (let y = 0; y < 32; y++)for (let x = 0; x < 32; x++) {
      const index = (y % 8) * 8 + x % 8;
      folded[index] = Math.max(folded[index], normal.alpha[y * 32 + x]);
    }
    check(wrapped.alpha.every((value, index) => value === folded[index]), 'round brush and AA coverage wrap without clipping');
  }
  const erased = stamp('square', 5, false, true);
  check(erased.alpha.filter(value => value < 255).length === 25, 'erase mode uses the same wrapped radius');
  const { state, stroke } = makeStroke('square', 5), source = makeCanvas(8, 8), asset = { _uid: 'brush-scene', source: 'unused', mode: 'tiled', uvWidth: 8, uvHeight: 8 };
  const cube = {
    uid: 'brush-cube',
    type: 'cube',
    size: [16, 8, 1],
    faces: { north: { texture: asset._uid, tiling: { offsetX: 0, offsetY: 0, width: 16, height: 8 } } }
  };
  const hit = x => ({
    uid: cube.uid,
    cubeUid: cube.uid,
    cube,
    faceName: 'north',
    point: [x, 4, 0],
    facePoints: [[0, 0, 0], [16, 0, 0], [0, 8, 0], [16, 8, 0]]
  });
  Object.assign(state, { project: { getNode: () => cube }, textureAssets: [asset], paintBrushOverlay: false, paintBrushDepth: 0 });
  let current = hit(7);
  const controller = createScenePaintController({
    state, clamp, sceneCanvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {} }, sceneRenderer: { pickDetailed: () => current },
    textureAssetForReference: () => asset, isFaceTiled: () => true, loadTextureAssetImage: async () => source, paintHitAlphaCache: new Map(), animationRasterCache: new Map(),
    paintSymmetryRelatedHits: paintHit => [paintHit], paintSymmetryFaceKey: paintHit => paintHit.uid + '::north',
    pushTexturePaintHistory() {}, paintUvBounds: () => ({ minU: 0, minV: 0, maxU: 8, maxV: 8 }), drawPaintSegment: stroke.drawPaintSegment, renderScene() {}, toast: message => { throw Error(message); }
  });
  controller.startScenePaintPointer({ ctrlKey: false, pointerId: 1, clientX: 1, clientY: 1, preventDefault() {} });
  const drag = state.dragging;
  await drag.queue;
  const surface = [...drag.assetSurfaces.values()][0];
  check(alpha(surface.canvas).filter(Boolean).length === 25, '3D brush stamp crosses an internal tiled seam');
  current = hit(8);
  controller.queueSceneBrushPointer(drag, 2, 1);
  await drag.queue;
  check(alpha(surface.canvas).filter(Boolean).length === 30, '3D brush remains continuous through tiled seams');
  stroke.discardPaintedTextureSync([asset._uid]);
  return ['square seam radius', 'round and AA seam radius', 'wrapped opacity', 'wrapped erase', '3D tiled brush continuity'];
}
