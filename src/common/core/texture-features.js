import { blendLayerImageData, LAYER_BLEND_MODES } from './layer-blend.js';

export const layerRasterCache = new Map();

// Blockbench stores layer pixels in data_url, while native CubeBricks layers
// use source. Normalize at the project boundary so the editor, preview and
// undo all read the same image without changing the imported texture itself.
export function normalizeTextureLayers(asset) {
  if (!Array.isArray(asset?.layers) || !asset.layers.length) return null;
  const textureId = asset.uuid || asset.id || asset._uid || 'texture';
  const layers = asset.layers.map((layer, index) => {
    if (layer?.type === 'group') return {
      ...layer, uid: layer.uid || layer.uuid || `${textureId}_group_${index}`,
      parentUid: layer.parentUid || null, visible: layer.visible !== false,
      collapsed: layer.collapsed === true,
      opacity: Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 100,
      blendMode: LAYER_BLEND_MODES.some(([key]) => key === layer.blendMode) ? layer.blendMode : 'normal'
    };
    const source = layer?.source || layer?.data_url;
    if (typeof source !== 'string' || !source.startsWith('data:image/') && !source.startsWith('blob:')) return null;
    const properties = { ...layer };
    delete properties.data_url;
    const blendMode = layer.blendMode || layer.blend_mode || 'normal';
    return { ...properties, uid: layer.uid || layer.uuid || `${textureId}_layer_${index}`,
      parentUid: layer.parentUid || null,
      source, visible: layer.visible !== false, opacity: Number.isFinite(Number(layer.opacity))
        ? Number(layer.opacity) : 100,
      blendMode: LAYER_BLEND_MODES.some(([key]) => key === blendMode) ? blendMode : 'normal' };
  }).filter(Boolean);
  return layers.length ? layers : null;
}

export function imageCanvas(source, width = source.width || source.naturalWidth, height = source.height || source.naturalHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width); canvas.height = Math.max(1, height);
  canvas.getContext('2d').drawImage(source, 0, 0);
  return canvas;
}

export function loadRaster(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(imageCanvas(image));
    image.onerror = () => reject(new Error('貼圖載入失敗'));
    image.src = source;
  });
}

export async function prepareLayers(asset) {
  for (const layer of asset.layers || []) {
    if (layer.type === 'group') continue;
    const cached = layerRasterCache.get(layer.uid);
    if (!cached || cached.savedSource !== layer.source) {
      const source = layer.source;
      const canvas = await loadRaster(source);
      // A newer paint stroke may have replaced this layer while decoding.
      // Never label an older raster with the newer source's cache key.
      if (layer.source === source) layerRasterCache.set(layer.uid, { canvas, savedSource: source });
    }
  }
}

export function selectedLayerEntry(asset) {
  return asset?.layers?.find(layer => layer.uid === asset.activeLayerUid) || null;
}

export function activeLayer(asset) {
  const layers = asset?.layers || [];
  const selected = selectedLayerEntry(asset);
  if (selected?.type !== 'group' && selected) return selected;
  if (selected) {
    const descendants = layerDescendantUids(layers, selected.uid);
    const child = layers.filter(layer => layer.type !== 'group' && descendants.has(layer.uid)).at(-1);
    if (child) return child;
  }
  return layers.filter(layer => layer.type !== 'group').at(-1) || null;
}

export function layerDescendantUids(layers, uid) {
  const found = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const layer of layers) if (!found.has(layer.uid) && (layer.parentUid === uid || found.has(layer.parentUid))) {
      found.add(layer.uid); changed = true;
    }
  }
  return found;
}

export function layerDisplayRows(layers) {
  const groups = new Set(layers.filter(layer => layer.type === 'group').map(layer => layer.uid));
  const rows = [];
  const visit = (parentUid, depth, ancestors) => {
    const siblings = layers.filter(layer => (groups.has(layer.parentUid) ? layer.parentUid : null) === parentUid);
    for (const layer of siblings.reverse()) {
      if (ancestors.has(layer.uid)) continue;
      rows.push({ layer, depth });
      if (layer.type === 'group' && !layer.collapsed) visit(layer.uid, depth + 1, new Set([...ancestors, layer.uid]));
    }
  };
  visit(null, 0, new Set());
  return rows;
}

// A group footer belongs to the group whose rail it closes. Keep this tree
// description separate from the flat paint/compositing order.
export function layerTreeItems(layers) {
  const groups = new Set(layers.filter(layer => layer.type === 'group').map(layer => layer.uid));
  const items = [];
  const visit = (parentUid, depth, ancestors) => {
    const siblings = layers.filter(layer => (groups.has(layer.parentUid) ? layer.parentUid : null) === parentUid);
    for (const layer of siblings.reverse()) {
      if (ancestors.some(ancestor => ancestor.uid === layer.uid)) continue;
      items.push({ layer, depth, ancestors });
      if (layer.type === 'group') {
        if (!layer.collapsed) visit(layer.uid, depth + 1, [...ancestors, { uid: layer.uid, depth }]);
        items.push({ groupEnd: layer.uid, depth, ancestors });
      }
    }
  };
  visit(null, 0, []);
  return items;
}

export function insertLayerNearSelection(layers, entry, selectedUid) {
  const selected = layers.find(layer => layer.uid === selectedUid);
  if (!selected) return [...layers, { ...entry, parentUid: null }];
  const parentUid = selected.type === 'group' ? selected.uid : selected.parentUid || null;
  const index = layers.findIndex(layer => layer.uid === selected.uid);
  const next = [...layers];
  next.splice(selected.type === 'group' ? index : index + 1, 0, { ...entry, parentUid });
  return next;
}

export function createLayerGroup(layers, selectedUid, uid, name) {
  const selected = layers.find(layer => layer.uid === selectedUid);
  const group = { uid, type: 'group', name, parentUid: selected?.type === 'group' ? selected.uid : selected?.parentUid || null,
    visible: true, collapsed: false, opacity: 100, blendMode: 'normal' };
  if (!selected) return [...layers, group];
  const next = layers.map(layer => layer.uid === selectedUid && layer.type !== 'group'
    ? { ...layer, parentUid: uid } : layer);
  const index = next.findIndex(layer => layer.uid === selectedUid);
  next.splice(selected.type === 'group' ? index : index + 1, 0, group);
  return next;
}

export function moveLayerEntry(layers, draggedUid, targetUid, position) {
  const dragged = layers.find(layer => layer.uid === draggedUid);
  const target = layers.find(layer => layer.uid === targetUid);
  if (!dragged || !target || dragged === target || (position === 'inside' || position === 'inside-end') && target.type !== 'group') return layers;
  const movedUids = layerDescendantUids(layers, draggedUid);
  movedUids.add(draggedUid);
  if (movedUids.has(targetUid)) return layers;
  const block = layers.filter(layer => movedUids.has(layer.uid));
  const next = layers.filter(layer => !movedUids.has(layer.uid));
  const parentUid = position === 'inside' || position === 'inside-end' ? target.uid : target.parentUid || null;
  const moved = block.map(layer => layer.uid === draggedUid ? { ...layer, parentUid } : layer);
  const targetIndex = next.findIndex(layer => layer.uid === targetUid);
  const targetBlock = layerDescendantUids(next, targetUid);
  targetBlock.add(targetUid);
  const start = next.findIndex(layer => targetBlock.has(layer.uid));
  const insertion = position === 'inside' ? targetIndex : position === 'before' ? targetIndex + 1 : start;
  next.splice(insertion, 0, ...moved);
  if (next.every((layer, index) => layer.uid === layers[index].uid && (layer.parentUid || null) === (layers[index].parentUid || null))) return layers;
  return next;
}

export function reorderLayerStack(layers, draggedUid, targetUid, position) {
  return moveLayerEntry(layers, draggedUid, targetUid, position);
}

export function compositeLayers(asset, liveCanvas = null, rootUid = null) {
  if (!asset?.layers?.length) return liveCanvas;
  const selected = activeLayer(asset);
  // The editable texture canvas is reused when the active layer changes.
  // Caching that DOM canvas by reference makes the previous layer vanish as
  // soon as showEditableLayer clears it for the next layer.
  if (liveCanvas && selected) layerRasterCache.set(selected.uid, {
    canvas: imageCanvas(liveCanvas), savedSource: selected.source
  });
  const canvas = document.createElement('canvas');
  const rasters = asset.layers.filter(layer => layer.type !== 'group').map(layer => layerRasterCache.get(layer.uid)?.canvas).filter(Boolean);
  canvas.width = Math.max(1, liveCanvas?.width || Math.max(0, ...rasters.map(raster => raster.width)) || asset.uvWidth || 16);
  canvas.height = Math.max(1, liveCanvas?.height || Math.max(0, ...rasters.map(raster => raster.height)) || asset.uvHeight || 16);
  const context = canvas.getContext('2d');
  const groups = new Set(asset.layers.filter(layer => layer.type === 'group').map(layer => layer.uid));
  function blend(context, layer, raster) {
    if (!raster) return;
    if (!layer.blendMode || layer.blendMode === 'normal') {
      context.globalAlpha = Math.max(0, Math.min(1, Number(layer.opacity ?? 100) / 100));
      context.drawImage(raster, 0, 0);
      return;
    }
    if (layer.blendMode === 'multiply' || layer.blendMode === 'screen') {
      context.globalAlpha = Math.max(0, Math.min(1, Number(layer.opacity ?? 100) / 100));
      context.globalCompositeOperation = layer.blendMode;
      context.drawImage(raster, 0, 0);
      context.globalCompositeOperation = 'source-over';
      return;
    }
    const source = document.createElement('canvas');
    source.width = canvas.width; source.height = canvas.height;
    const sourceContext = source.getContext('2d');
    sourceContext.drawImage(raster, 0, 0);
    const lower = context.getImageData(0, 0, canvas.width, canvas.height);
    const upper = sourceContext.getImageData(0, 0, canvas.width, canvas.height);
    blendLayerImageData(lower.data, upper.data, layer.opacity ?? 100, layer.blendMode);
    context.putImageData(lower, 0, 0);
  }
  function renderChildren(parentUid, context, ancestors = new Set()) {
    for (const layer of asset.layers) {
      if ((groups.has(layer.parentUid) ? layer.parentUid : null) !== parentUid) continue;
      if (layer.type === 'group') {
        if (ancestors.has(layer.uid)) continue;
        if (layer.visible === false) continue;
        const nested = document.createElement('canvas');
        nested.width = canvas.width; nested.height = canvas.height;
        renderChildren(layer.uid, nested.getContext('2d'), new Set([...ancestors, layer.uid]));
        blend(context, layer, nested);
      } else if (layer.visible !== false) blend(context, layer, layerRasterCache.get(layer.uid)?.canvas);
    }
  }
  renderChildren(rootUid, context);
  return canvas;
}

// A group's raster is the live merge of its descendants, rather than a second
// stored PNG. Its own visibility/opacity/blend mode are applied by its parent
// compositor exactly as they are for an ordinary layer.
export function layerEntryRaster(asset, uid) {
  const entry = asset?.layers?.find(layer => layer.uid === uid);
  if (!entry) return null;
  return entry.type === 'group' ? compositeLayers(asset, null, entry.uid)
    : layerRasterCache.get(entry.uid)?.canvas || null;
}

export function flipbookFrame(asset, source, frame = 0) {
  // Animation is a texture-kind placeholder until its playback contract is defined.
  return source;
}


export function faceTileSize(cube, faceName) {
  const axes = faceName === 'up' || faceName === 'down' ? [0, 2]
    : faceName === 'east' || faceName === 'west' ? [2, 1] : [0, 1];
  return axes.map(axis => Math.abs(Number(cube.size?.[axis]) || 0));
}

export function tiledFaceReference(cube, faceName, asset, region = null) {
  const face = cube.faces?.[faceName];
  if (asset?.mode !== 'tiled') return null;
  const tile = face.tiling || {};
  const size = region ? [region.width, region.height] : faceTileSize(cube, faceName);
  const mod = (v, n) => Math.round((((v % n) + n) % n) * 1e8) / 1e8;
  return `__tile__${JSON.stringify([face.texture, size, mod((Number(tile.offsetX) || 0) + (region?.x || 0), Number(tile.width) || 16), mod((Number(tile.offsetY) || 0) + (region?.y || 0), Number(tile.height) || 16), Number(tile.width) || 16, Number(tile.height) || 16])}`;
}

export function tiledFaceRegions(cube, faceName, sourceWidth, sourceHeight) {
  const tile = cube.faces?.[faceName]?.tiling || {};
  const [width, height] = faceTileSize(cube, faceName);
  const stepX = Math.max(.0001, Number(tile.width) || 16) * Math.max(1, Math.floor(1024 / sourceWidth));
  const stepY = Math.max(.0001, Number(tile.height) || 16) * Math.max(1, Math.floor(1024 / sourceHeight));
  const regions = [];
  for (let y = 0; y < height; y += stepY) for (let x = 0; x < width; x += stepX) {
    regions.push({ x, y, width: Math.min(stepX, width - x), height: Math.min(stepY, height - y), faceWidth: width, faceHeight: height });
  }
  return regions;
}

export function tiledFaceRaster(cube, faceName, source, region = null, outputSize = null) {
  const tile = cube.faces[faceName].tiling || {};
  const size = region ? [region.width, region.height] : faceTileSize(cube, faceName);
  const repeat = [size[0] / Math.max(.0001, Number(tile.width) || 16), size[1] / Math.max(.0001, Number(tile.height) || 16)];
  const canvas = document.createElement('canvas');
  canvas.width = outputSize?.[0] || Math.max(1, Math.min(1024, Math.ceil(repeat[0] * source.width)));
  canvas.height = outputSize?.[1] || Math.max(1, Math.min(1024, Math.ceil(repeat[1] * source.height)));
  const input = source.getContext('2d').getImageData(0, 0, source.width, source.height);
  const context = canvas.getContext('2d'), output = context.createImageData(canvas.width, canvas.height);
  const offset = [(Number(tile.offsetX) || 0) + (region?.x || 0), (Number(tile.offsetY) || 0) + (region?.y || 0)];
  const fraction = value => ((value % 1) + 1) % 1;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const u = Math.floor(fraction((x + .5) / canvas.width * repeat[0] + offset[0] / Math.max(.0001, Number(tile.width) || 16)) * source.width);
    const v = Math.floor(fraction((y + .5) / canvas.height * repeat[1] + offset[1] / Math.max(.0001, Number(tile.height) || 16)) * source.height);
    const src = (v * source.width + u) * 4, dst = (y * canvas.width + x) * 4;
    for (let channel = 0; channel < 4; channel++) output.data[dst + channel] = input.data[src + channel];
  }
  context.putImageData(output, 0, 0);
  return canvas;
}
