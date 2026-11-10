// Convert Blockbench face coordinates into texture or atlas UVs.

import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv } from '../common/core/geometry-utils.js';
import { FACE_TRIANGLE_SLOTS } from './vertex-data.js';

export function textureLayoutEntry(layout, reference) {
  if (!layout) return null;
  if (reference === null || reference === undefined) return layout.defaultEntry;
  const raw = String(reference);
  return layout.byReference.get(raw) || layout.byReference.get(raw.startsWith('#') ? raw.slice(1) : `#${raw}`) || layout.defaultEntry;
}

export function getFaceUv(cube, faceName, textureSize, textureLayout = null) {
  const face = cube.faces?.[faceName] || {};
  const uv = cube.uvMode === 'box' ? getBlockbenchBoxUv(cube, faceName)
    : face.uv?.length >= 4 ? face.uv : getBlockbenchBoxUv(cube, faceName);
  const rectangle = uv?.length >= 4 ? [...uv] : [0, 0, textureSize[0], textureSize[1]];
  const atlasEntry = textureLayoutEntry(textureLayout, face.texture);
  if (atlasEntry) {
    return createAtlasFaceUvs(rectangle, face.rotation || 0, atlasEntry,
      [textureLayout.width, textureLayout.height], cube.uvMode === 'box');
  }
  return createBlockbenchFaceUvs(rectangle, textureSize, face.rotation || 0, cube.uvMode === 'box');
}

export function createAtlasFaceUvs(rectangle, rotation, atlasEntry, atlasSize, insetBoxUv = false) {
  const uv = [...rectangle];
  if (insetBoxUv) {
    for (let axis = 0; axis < 2; axis++) {
      const margin = uv[axis] > uv[axis + 2] ? -1 / 64 : 1 / 64;
      uv[axis] += margin;
      uv[axis + 2] -= margin;
    }
  }
  const atlasWidth = Math.max(1, atlasSize?.[0] || 1);
  const atlasHeight = Math.max(1, atlasSize?.[1] || 1);
  const slots = createBlockbenchFaceUvSlots(uv, rotation).map(slot => {
    const u = Math.max(0, Math.min(atlasEntry.width,
      slot[0] * atlasEntry.width / Math.max(1, atlasEntry.uvWidth || atlasEntry.width)));
    const v = Math.max(0, Math.min(atlasEntry.height,
      slot[1] * atlasEntry.height / Math.max(1, atlasEntry.uvHeight || atlasEntry.height)));
    return [(atlasEntry.x + u) / atlasWidth, 1 - (atlasEntry.y + v) / atlasHeight];
  });
  return FACE_TRIANGLE_SLOTS.map(slot => slots[slot]);
}

export function createBlockbenchFaceUvs(rectangle, textureSize = [64, 64], rotation = 0, insetBoxUv = false) {
  const uv = [...rectangle];
  if (insetBoxUv) {
    for (let axis = 0; axis < 2; axis++) {
      const margin = uv[axis] > uv[axis + 2] ? -1 / 64 : 1 / 64;
      uv[axis] += margin;
      uv[axis + 2] -= margin;
    }
  }
  const width = textureSize[0] || 1;
  const height = textureSize[1] || 1;
  const slots = createBlockbenchFaceUvSlots(uv, rotation)
    .map(slot => [slot[0] / width, 1 - slot[1] / height]);
  return FACE_TRIANGLE_SLOTS.map(slot => slots[slot]);
}
