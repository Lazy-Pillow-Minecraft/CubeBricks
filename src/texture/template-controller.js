import { getBlockbenchBoxUv, isCubeFaceCulled } from '../render/webgl-renderer.js';
import { compositeLayers, imageCanvas, layerRasterCache, loadRaster, normalizeTextureLayers,
  tiledFaceRaster, faceTileSize } from '../common/core/texture-features.js';
import { formatRules } from '../common/core/format-constraints.js';
import { minimumTemplatePackingSide, packTemplateRectangles } from '../utils/template-packer.js';

const TEMPLATE_FACE_COLORS = Object.freeze({
  up: { fill: '#ecf8fd', outline: '#b4d4e1' },
  down: { fill: '#6e788c', outline: '#536174' },
  east: { fill: '#7bffa3', outline: '#43e88d' },
  north: { fill: '#7bd4ff', outline: '#5bbcf4' },
  west: { fill: '#ffa7a4', outline: '#f48686' },
  south: { fill: '#fff899', outline: '#f8dd72' }
});

export function createTextureTemplateController({ state, $, CUBE_FACE_NAMES, getSelectionExpansion,
  isProceduralShape, getSubdivisionSession, subdivisionPatch, syncSubdivisionEdits,
  invalidateUvPreviewTextureState, renderTextureList, activateProjectTexture,
  markDirty, snapshot, toast, setCubeFaceCulled, invalidateAllRenderGeometry,
  renderAll, activeSnapSubdivisions, textureAssetForReference, loadTextureAssetImage }) {
function templateCubeTargets(selectedOnly = false) {
  const targets = [];
  const selected = selectedOnly ? getSelectionExpansion().elementSet : null;
  for (const element of state.project.elements) {
    if (element.subdivisionOwnerUid) continue;
    if (element.type === 'cube') {
      if (selected && !selected.has(element.uid)) continue;
      targets.push({ cube: element, owner: null, index: -1 });
      continue;
    }
    if (!isProceduralShape(element)) continue;
    const cubes = getSubdivisionSession()?.ownerUid === element.uid ? getSubdivisionSession().cubes : element.toCubes();
    cubes.forEach((cube, index) => {
      if (!selected || selected.has(element.uid) || selected.has(cube.uid)) targets.push({ cube, owner: element, index });
    });
  }
  return targets;
}

function facePixelSize(cube, faceName, subdivisions) {
  const axisPairs = {
    north: [0, 1], south: [0, 1], east: [2, 1], west: [2, 1], up: [0, 2], down: [0, 2]
  };
  const axes = axisPairs[faceName];
  const roundedPixelLength = value => {
    const length = Math.abs(Number(value) || 0);
    return length > 0 ? Math.max(1, Math.round(length)) : 0;
  };
  if (cube.uvNormalized !== false) return axes.map(axis => roundedPixelLength(Math.abs(Number(cube.size[axis]) || 0) * subdivisions / 16));
  const face = cube.faces?.[faceName];
  const uv = Array.isArray(face?.uv) && face.uv.length >= 4 ? face.uv : getBlockbenchBoxUv(cube, faceName);
  const uvLengths = [Math.abs(Number(uv[2]) - Number(uv[0])), Math.abs(Number(uv[3]) - Number(uv[1]))];
  return axes.map((axis, index) => {
    const geometryLength = Math.abs(Number(cube.size?.[axis]) || 0);
    if (geometryLength <= 1e-9) return 0;
    return Math.max(1, Math.round(uvLengths[index]));
  });
}

function cubeFaceHasZeroGeometry(cube, faceName) {
  const axisPairs = {
    north: [0, 1], south: [0, 1], east: [2, 1], west: [2, 1], up: [0, 2], down: [0, 2]
  };
  return axisPairs[faceName].some(axis => Math.abs(Number(cube.size?.[axis]) || 0) <= 1e-9);
}


function beginTextureGenerationProgress(totalFaces) {
  const dialog = $('#textureProgressDialog');
  const progressBar = $('#textureGenerationProgress');
  const status = $('#textureGenerationStatus');
  const counter = $('#textureGenerationCounter');
  const total = Math.max(1, Number(totalFaces) || 1);
  const startedAt = performance.now();
  const refreshEvery = Math.max(1, Math.ceil(total / 100));
  let processed = 0, nextRefresh = 0, shown = false, finished = false;
  progressBar.max = total;
  progressBar.value = 0;
  counter.textContent = `0 / ${totalFaces}`;
  dialog.oncancel = event => event.preventDefault();

  const refresh = async (label, force = false) => {
    if (finished || (!force && processed < nextRefresh)) return;
    nextRefresh = processed + refreshEvery;
    progressBar.value = Math.min(total, processed);
    status.textContent = label;
    counter.textContent = `${Math.min(totalFaces, processed)} / ${totalFaces}`;
    if (!shown && (totalFaces >= 180 || performance.now() - startedAt >= 180)) {
      if (!dialog.open) dialog.showModal();
      shown = dialog.open;
    }
    if (shown || force) await new Promise(resolve => setTimeout(resolve, 0));
  };

  return {
    prepare(label) { return refresh(label, true); },
    advance(label) { processed++; return refresh(label); },
    finish() {
      finished = true;
      progressBar.value = total;
      if (dialog.open) dialog.close();
    }
  };
}

function alignedTextureSide(side, powerOfTwo, multiple) {
  const size = Math.max(1, Math.ceil(side));
  if (powerOfTwo) return 2 ** Math.ceil(Math.log2(size));
  const unit = Math.max(1, Math.round(multiple) || 4);
  return Math.ceil(size / unit) * unit;
}

function drawFaceImage(ctx, entry, destination, image) {
  const { width, height, sourceUv, sourceAsset, faceName } = entry;
  if (width <= 0 || height <= 0 || !image) return false;
  if (sourceAsset?.mode === 'tiled') {
    const raster = tiledFaceRaster(entry.target.cube, faceName,
      typeof image.getContext === 'function' ? image : imageCanvas(image), null, [width, height]);
    ctx.drawImage(raster, destination.x, destination.y);
    return true;
  }
  if (image && sourceUv) {
    const left = Math.min(sourceUv[0], sourceUv[2]);
    const top = Math.min(sourceUv[1], sourceUv[3]);
    const sourceWidth = Math.abs(sourceUv[2] - sourceUv[0]);
    const sourceHeight = Math.abs(sourceUv[3] - sourceUv[1]);
    if (sourceWidth > 0 && sourceHeight > 0) {
      ctx.drawImage(image, left, top, sourceWidth, sourceHeight, destination.x, destination.y, width, height);
      return true;
    }
  }
  return false;
}

function drawTemplateFace(ctx, entry, destination, sourceImages) {
  const { width, height, sourceAsset, faceName } = entry;
  if (width <= 0 || height <= 0) return;
  if (drawFaceImage(ctx, entry, destination, sourceAsset ? sourceImages.get(sourceAsset._uid) : null)) return;
  const faceColors = TEMPLATE_FACE_COLORS[faceName] || { fill: '#b7b7b7', outline: '#9f9f9f' };
  ctx.fillStyle = faceColors.fill;
  ctx.fillRect(destination.x, destination.y, width, height);
  ctx.strokeStyle = faceColors.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(destination.x + .5, destination.y + .5, Math.max(0, width - 1), Math.max(0, height - 1));
}

function faceDestinationUv(entry, destination) {
  const source = entry.sourceUv || [0, 0, entry.width, entry.height];
  const uForward = source[2] >= source[0], vForward = source[3] >= source[1];
  return [
    uForward ? destination.x : destination.x + entry.width,
    vForward ? destination.y : destination.y + entry.height,
    uForward ? destination.x + entry.width : destination.x,
    vForward ? destination.y + entry.height : destination.y
  ];
}

function syncGeneratedTemplateEdits(targets) {
  const owners = new Set(targets.map(target => target.owner).filter(Boolean));
  for (const owner of owners) {
    const ownerTargets = targets.filter(target => target.owner === owner);
    const edits = { ...(owner.subdivisionEdits || {}) };
    for (const target of ownerTargets) {
      const patch = subdivisionPatch(owner, target.cube, target.index);
      if (patch) edits[target.index] = patch;
      else delete edits[target.index];
    }
    owner.subdivisionEdits = edits;
  }
  if (getSubdivisionSession()) syncSubdivisionEdits();
}

function registerGeneratedTexture(canvas, name, kind, layers = null, activeLayerUid = null) {
  const id = `texture_${crypto.randomUUID()}`;
  const asset = {
    _uid: id, uuid: id, id, name: name.toLowerCase().endsWith('.png') ? name : `${name}.png`,
    source: canvas.toDataURL('image/png'), uvWidth: canvas.width, uvHeight: canvas.height,
    kind, groupId: null, useAsDefault: state.textureAssets.length === 0,
    ...(layers ? { layers, activeLayerUid } : {})
  };
  state.textureAssets.push(asset);
  state.activeTextureUid = asset._uid;
  state.project.textureSize = [canvas.width, canvas.height];
  invalidateUvPreviewTextureState();
  renderTextureList();
  activateProjectTexture(state.textureAssets.length - 1);
  markDirty();
  return asset;
}

async function createTemplateLayerOutputs(sourceAssets, sourceImages, side) {
  const usable = [...sourceAssets].filter(asset => sourceImages.get(asset._uid) || normalizeTextureLayers(asset));
  const multipleSources = usable.length > 1;
  const outputs = new Map();
  const layers = [];
  let activeLayerUid = null;
  for (const asset of usable) {
    const normalized = normalizeTextureLayers(asset);
    const sourceLayers = normalized || [{
      uid: `${asset._uid}_base`, name: '底圖', source: asset.source,
      visible: true, opacity: 100, blendMode: 'normal'
    }];
    const uidMap = new Map(sourceLayers.map(layer => [layer.uid, crypto.randomUUID()]));
    const sourceGroupUid = multipleSources ? crypto.randomUUID() : null;
    if (sourceGroupUid) layers.push({ uid: sourceGroupUid, type: 'group', name: asset.name,
      parentUid: null, visible: true, collapsed: false, opacity: 100, blendMode: 'normal' });
    const rasters = [];
    for (const layer of sourceLayers) {
      const uid = uidMap.get(layer.uid);
      const parentUid = uidMap.get(layer.parentUid) || sourceGroupUid;
      const copy = { ...layer, uid, parentUid,
        maskLayerUid: uidMap.get(layer.maskLayerUid) || null };
      if (copy.uuid) copy.uuid = uid;
      if (layer.type === 'group') {
        layers.push(copy);
        continue;
      }
      const cached = layerRasterCache.get(layer.uid);
      const raster = cached?.savedSource === layer.source ? cached.canvas
        : normalized ? await loadRaster(layer.source) : sourceImages.get(asset._uid);
      const canvas = document.createElement('canvas');
      canvas.width = side; canvas.height = side;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = false;
      copy.source = '';
      layers.push(copy);
      rasters.push({ layer: copy, raster, canvas, context });
      if (asset.activeLayerUid === layer.uid) activeLayerUid = uid;
    }
    outputs.set(asset._uid, rasters);
  }
  return { layers, outputs, activeLayerUid };
}

async function createTextureTemplate(options) {
  const targets = templateCubeTargets(options.selectedOnly);
  if (!targets.length) return toast('目前沒有可建立模板的 Cube');
  const initialFaceCount = targets.reduce((count, target) => count + CUBE_FACE_NAMES.filter(faceName => {
    const face = target.cube.faces?.[faceName];
    return !isCubeFaceCulled(face);
  }).length, 0);
  if (!initialFaceCount) return toast('目前沒有可建立模板的面');
  const invalidFaces = [];
  const invalidFacesByCube = new WeakMap();
  if (options.cleanInvalidFaces) {
    for (const target of targets) {
      for (const faceName of CUBE_FACE_NAMES) {
        if (isCubeFaceCulled(target.cube.faces?.[faceName]) || !cubeFaceHasZeroGeometry(target.cube, faceName)) continue;
        invalidFaces.push({ target, faceName });
        const names = invalidFacesByCube.get(target.cube) || new Set();
        names.add(faceName);
        invalidFacesByCube.set(target.cube, names);
      }
    }
  }
  const cleanedFaceCount = invalidFaces.length;
  const faceCount = initialFaceCount - cleanedFaceCount;
  if (!faceCount) {
    snapshot('core.uv.cull_face');
    invalidFaces.forEach(({ target, faceName }) => setCubeFaceCulled(target.cube, faceName, true));
    syncGeneratedTemplateEdits(targets);
    invalidateAllRenderGeometry();
    markDirty();
    renderAll('all');
    return toast(cleanedFaceCount ? `已清理 ${cleanedFaceCount} 個無效面；沒有可建立模板的面` : '目前沒有可建立模板的面');
  }
  snapshot('core.texture.generate');
  const progress = beginTextureGenerationProgress(faceCount);
  try {
  await progress.prepare(`正在準備 ${faceCount} 個面…`);
  const subdivisions = options.boxUv && formatRules(state.project).moddedEntity ? 16 : activeSnapSubdivisions();
  const padding = options.paddingEnabled ? Math.max(0, Math.round(options.padding)) : 0;
  const sourceAssets = new Set();
  const rectangles = [];
  const assignments = [];
  const sharedEntries = new Map();
  const addFaceEntry = (target, faceName, width, height, boxEntry = null, offset = null) => {
    const cube = target.cube;
    const face = cube.faces?.[faceName];
    const sourceUv = Array.isArray(face?.uv) && face.uv.length >= 4 ? [...face.uv] : [...getBlockbenchBoxUv(cube, faceName)];
    const sourceAsset = textureAssetForReference(face?.texture);
    if (sourceAsset) sourceAssets.add(sourceAsset);
    const duplicateKey = !options.keepMultiTexture && !boxEntry
      ? `${sourceAsset?._uid || 'color'}:${faceName}:${sourceAsset?.mode === 'tiled' ? JSON.stringify([faceTileSize(cube, faceName), face?.tiling]) : sourceUv.join(',')}:${width}x${height}` : null;
    let entry = duplicateKey ? sharedEntries.get(duplicateKey) : null;
    if (!entry) {
      entry = boxEntry || { width, height, faceName, sourceUv, sourceAsset, targets: [] };
      if (!boxEntry) rectangles.push(entry);
      if (duplicateKey) sharedEntries.set(duplicateKey, entry);
    }
    const assignment = { target, faceName, width, height, sourceUv, sourceAsset, entry, offset };
    entry.targets.push(assignment);
    assignments.push(assignment);
  };
  for (const target of targets) {
    const cube = target.cube;
    const dimensions = cube.size.map(value => {
      const scaled = Math.abs(Number(value) || 0) * subdivisions / 16;
      return scaled > 0 ? Math.max(1, Math.round(scaled)) : 0;
    });
    if (options.boxUv) {
      const [x, y, z] = dimensions;
      const boxEntry = { width: 2 * (x + z), height: y + z, faceName: 'north', sourceUv: null, sourceAsset: null, targets: [] };
      rectangles.push(boxEntry);
      const offsets = {
        east: [0, z, z, y], north: [z, z, x, y], west: [z + x, z, z, y], south: [z + x + z, z, x, y],
        up: [z, 0, x, z], down: [z + x, 0, x, z]
      };
      for (const faceName of CUBE_FACE_NAMES) {
        const face = cube.faces?.[faceName];
      if (isCubeFaceCulled(face) || invalidFacesByCube.get(cube)?.has(faceName)) continue;
        const [ox, oy, width, height] = offsets[faceName];
        addFaceEntry(target, faceName, width, height, boxEntry, { x: ox, y: oy });
      }
    } else {
      for (const faceName of CUBE_FACE_NAMES) {
        const face = cube.faces?.[faceName];
      if (isCubeFaceCulled(face) || invalidFacesByCube.get(cube)?.has(faceName)) continue;
        const [width, height] = facePixelSize(cube, faceName, subdivisions);
        addFaceEntry(target, faceName, width, height);
      }
    }
  }
  await progress.prepare('正在讀取已有紋理…');
  const sourceImages = new Map(await Promise.all([...sourceAssets].map(async asset => [asset._uid, await loadTextureAssetImage(asset)])));
  await progress.prepare('正在由大到小排列 UV…');
  let packingSide = minimumTemplatePackingSide(rectangles, padding);
  let packed = null;
  while (!packed && packingSide <= 8192) {
    packed = packTemplateRectangles(rectangles, padding, packingSide);
    if (!packed) packingSide += Math.max(1, Math.ceil(packingSide * .06));
  }
  const side = alignedTextureSide(packingSide, options.powerOfTwo, options.multiple);
  if (!packed || side > 8192) {
    state.history.pop();
    return toast(`模板尺寸 ${side} × ${side} 過大，請降低吸附分辨率或間隔`);
  }
  invalidFaces.forEach(({ target, faceName }) => setCubeFaceCulled(target.cube, faceName, true));
  const canvas = document.createElement('canvas');
  canvas.width = side; canvas.height = side;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, side, side);
  const preserved = options.keepLayers ? await createTemplateLayerOutputs(sourceAssets, sourceImages, side) : null;
  const outputCanvases = preserved ? new Map([...preserved.outputs.values()].flat().map(entry => [entry.layer.uid, entry.canvas])) : null;
  let fallbackLayer = null;
  const drawFallbackFace = (assignment, destination) => {
    if (!fallbackLayer) {
      const fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.width = side; fallbackCanvas.height = side;
      const fallbackContext = fallbackCanvas.getContext('2d');
      fallbackContext.imageSmoothingEnabled = false;
      fallbackLayer = { canvas: fallbackCanvas, context: fallbackContext };
    }
    drawTemplateFace(fallbackLayer.context, assignment, destination, sourceImages);
  };
  for (const assignment of assignments) {
    const placement = packed.placements.get(assignment.entry);
    if (placement) {
      const destination = assignment.offset
        ? { x: placement.x + assignment.offset.x, y: placement.y + assignment.offset.y }
        : { x: placement.x, y: placement.y };
      if (preserved) {
        const sourceLayers = preserved.outputs.get(assignment.sourceAsset?._uid);
        if (sourceLayers?.length) {
          let drawn = false;
          for (const { context, raster } of sourceLayers) {
            if (drawFaceImage(context, assignment, destination, raster)) drawn = true;
          }
          if (!drawn) drawFallbackFace(assignment, destination);
        } else drawFallbackFace(assignment, destination);
      } else drawTemplateFace(ctx, assignment, destination, sourceImages);
      const cube = assignment.target.cube;
      cube.faces ||= {};
      const previous = cube.faces[assignment.faceName] || {};
      cube.faces[assignment.faceName] = { ...previous, uv: faceDestinationUv(assignment, destination) };
    }
    await progress.advance('正在繪製並分配 UV…');
  }
  if (preserved) {
    await progress.prepare('正在保存重排後的圖層…');
    if (fallbackLayer) {
      const uid = crypto.randomUUID();
      preserved.layers.unshift({ uid, name: '模板底圖', parentUid: null, source: '',
        visible: true, opacity: 100, blendMode: 'normal' });
      fallbackLayer.layerUid = uid;
    }
    for (const layer of preserved.layers) {
      if (layer.type === 'group') continue;
      const output = layer.uid === fallbackLayer?.layerUid ? fallbackLayer.canvas : outputCanvases.get(layer.uid);
      if (!output) continue;
      layer.source = output.toDataURL('image/png');
      layerRasterCache.set(layer.uid, { canvas: output, savedSource: layer.source });
    }
    preserved.activeLayerUid ||= preserved.layers.find(layer => layer.type !== 'group')?.uid || null;
    const merged = compositeLayers({ layers: preserved.layers, activeLayerUid: preserved.activeLayerUid,
      uvWidth: side, uvHeight: side });
    if (merged) ctx.drawImage(merged, 0, 0);
  }
  const asset = registerGeneratedTexture(canvas, options.name, 'TEMPLATE',
    preserved?.layers || null, preserved?.activeLayerUid || null);
  state.project.uvMode = options.boxUv ? 'box' : 'face';
  for (const target of targets) {
    target.cube.uvMode = options.boxUv ? 'box' : 'face';
    target.cube.autoUv = Boolean(options.boxUv);
    if (options.boxUv) target.cube.uvScale = subdivisions / 16;
    if (target.owner) {
      target.owner.uvMode = target.cube.uvMode;
      target.owner.autoUv = Boolean(options.boxUv);
    }
    for (const assignment of assignments.filter(entry => entry.target === target)) {
      target.cube.faces[assignment.faceName].texture = `#${asset.id}`;
    }
    const boxAssignment = assignments.find(assignment => assignment.target === target && assignment.offset);
    if (boxAssignment) {
      const placement = packed.placements.get(boxAssignment.entry);
      target.cube.uv = [placement.x, placement.y];
    }
    if (options.boxUv) for (const face of Object.values(target.cube.faces || {})) if (face) delete face.uv;
  }
  syncGeneratedTemplateEdits(targets);
  markDirty();
  invalidateUvPreviewTextureState();
  invalidateAllRenderGeometry();
  renderAll('all');
  toast(`已建立 ${side} × ${side} 紋理模板${cleanedFaceCount ? `，並清理 ${cleanedFaceCount} 個無效面` : ''}`);
  } finally {
    progress.finish();
  }
}
return { createTextureTemplate, registerGeneratedTexture };
}
