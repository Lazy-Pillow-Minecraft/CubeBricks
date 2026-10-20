export const layerRasterCache = new Map();

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
    const cached = layerRasterCache.get(layer.uid);
    if (!cached || cached.savedSource !== layer.source) {
      layerRasterCache.set(layer.uid, { canvas: await loadRaster(layer.source), savedSource: layer.source });
    }
  }
}

export function activeLayer(asset) {
  return asset?.layers?.find(layer => layer.uid === asset.activeLayerUid) || asset?.layers?.at(-1) || null;
}

export function compositeLayers(asset, liveCanvas = null) {
  if (!asset?.layers?.length) return liveCanvas;
  const selected = activeLayer(asset);
  if (liveCanvas && selected) layerRasterCache.set(selected.uid, { canvas: liveCanvas, savedSource: selected.source });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, asset.uvWidth || liveCanvas?.width || 16);
  canvas.height = Math.max(1, asset.uvHeight || liveCanvas?.height || 16);
  const context = canvas.getContext('2d');
  for (const layer of asset.layers) {
    if (layer.visible === false) continue;
    const raster = layerRasterCache.get(layer.uid)?.canvas;
    if (!raster) continue;
    context.globalAlpha = Math.max(0, Math.min(1, Number(layer.opacity ?? 100) / 100));
    context.drawImage(raster, 0, 0);
  }
  return canvas;
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
