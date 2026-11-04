import { compositeLayers, loadRaster } from '../common/core/texture-features.js';
import { frameLayerUids } from '../common/core/frame-links.js';
import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv } from '../common/core/geometry-utils.js';
import { checkBakeSize, positiveModulo } from './export-plan.js';

export function bakeCanvas(width, height) {
  checkBakeSize(width, height);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d').imageSmoothingEnabled = false;
  return canvas;
}

// Use private rasters, never the editable-layer canvas or the selected playback
// frame. Exporting must not mutate runtime caches or depend on a late decode.
export async function captureExportTexture(asset) {
  const rasters = new Map();
  for (const layer of asset.layers || []) if (layer.type !== 'group') {
    rasters.set(layer.uid, { canvas: await loadRaster(layer.source), savedSource: layer.source });
  }
  let source = null;
  if (!asset.layers?.length) source = await loadRaster(asset.source);
  const frame = index => asset.layers?.length
    ? compositeLayers(asset, null, null, null, asset.animation?.enabled && asset.animation.frames?.length
      ? frameLayerUids(asset, asset.animation.frames[index % asset.animation.frames.length]) : null, null, rasters)
    : source;
  return { frame, first: frame(0) };
}

export function paintTexturePlane(context, source, plane, x, y) {
  if (!plane.tiled) { context.drawImage(source, x, y); return; }
  context.save();
  context.translate(x, y);
  context.fillStyle = context.createPattern(source, 'repeat');
  context.fillRect(0, 0, plane.width, plane.height);
  context.restore();
}

export function paintBoxNet(context, net, sources, density, x, y) {
  for (const face of net.members) {
    const source = sources[face.index], pixels = source.getContext('2d').getImageData(0, 0, source.width, source.height);
    const target = getBlockbenchBoxUv(net.cube, face.name), slots = createBlockbenchFaceUvSlots(face.pixelUv, face.rotation);
    const left = Math.min(target[0], target[2]), top = Math.min(target[1], target[3]);
    const width = Math.round(Math.abs(target[2] - target[0]) * density), height = Math.round(Math.abs(target[3] - target[1]) * density);
    if (!width || !height) continue;
    const output = context.createImageData(width, height);
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      let u = (col + .5) / width, v = (row + .5) / height;
      if (target[0] > target[2]) u = 1 - u;
      if (target[1] > target[3]) v = 1 - v;
      const sx = slots[0][0] + u * (slots[1][0] - slots[0][0]) + v * (slots[2][0] - slots[0][0]);
      const sy = slots[0][1] + u * (slots[1][1] - slots[0][1]) + v * (slots[2][1] - slots[0][1]);
      const wrap = face.tiled === true;
      const px = wrap ? positiveModulo(Math.floor(sx), source.width) : Math.max(0, Math.min(source.width - 1, Math.floor(sx)));
      const py = wrap ? positiveModulo(Math.floor(sy), source.height) : Math.max(0, Math.min(source.height - 1, Math.floor(sy)));
      const start = (py * source.width + px) * 4;
      output.data.set(pixels.data.subarray(start, start + 4), (row * width + col) * 4);
    }
    context.putImageData(output, x + Math.round(left * density), y + Math.round(top * density));
  }
}
