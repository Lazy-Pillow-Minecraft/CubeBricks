import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv, isCubeFaceCulled } from '../common/core/geometry-utils.js';
import { faceTilingSettings } from '../common/core/face-tiling.js';
import { packTemplateRectangles } from '../utils/template-packer.js';

export const EXPORT_FACES = ['north', 'south', 'east', 'west', 'up', 'down'];
export const positiveModulo = (value, period) => ((value % period) + period) % period;

// Reject an unrepresentable result before allocating a canvas. Never shorten
// an animation or silently reduce its texture resolution to fit a limit.
export function checkBakeSize(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > 16384 || height > 16384 || width * height > 67108864) {
    throw new Error('烘焙贴图超出可用尺寸，请减少帧数或平铺范围');
  }
}

export function combinedAnimation(assets) {
  const animated = assets.filter(asset => asset.animation?.enabled && asset.animation.frames?.length);
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  let count = 1;
  for (const asset of animated) {
    const n = asset.animation.frames.length;
    count = count / gcd(count, n) * n;
    checkBakeSize(1, count);
  }
  return { count, fps: animated.length ? animated.reduce((sum, asset) => sum + (Number(asset.animation.fps) || 20), 0) / animated.length : 20,
    animated: animated.length > 0 };
}

export function exportedCubeView(element) {
  return { size: element.to.map((value, axis) => Math.abs(value - element.from[axis])),
    uv: element.uv_offset || [0, 0], uvScale: 1, mirrorUv: element.mirror_uv === true };
}

export function collectExportFaces(bbmodel, assets) {
  const references = new Map();
  // Match the editor's first matching asset, including legacy index/name
  // references. Copied assets may still carry the same optional display ID.
  assets.forEach((asset, index) => {
    for (const value of [asset.uuid, asset._uid, asset.id, String(index), asset.name, bbmodel.textures[index]?.uuid]) {
      if (value === undefined || value === null) continue;
      const key = String(value).replace(/^#/, '');
      if (!references.has(key)) references.set(key, index);
    }
  });
  const result = [];
  for (const element of bbmodel.elements) {
    if (!element.from || !element.to) continue;
    const cube = exportedCubeView(element);
    for (const name of EXPORT_FACES) {
      const face = element.faces?.[name];
      if (isCubeFaceCulled(face) || face?.texture === undefined || face.texture === false) continue;
      const index = references.get(String(face.texture).replace(/^#/, ''));
      if (index === undefined) continue;
      const uv = element.box_uv || !face.uv ? getBlockbenchBoxUv(cube, name) : [...face.uv];
      result.push({ element, name, face, index, uv, wasBox: element.box_uv, rotation: element.box_uv ? 0 : Number(face.rotation) || 0 });
    }
  }
  return result;
}

export function texturePlane(asset, raster, faces) {
  const plan = { asset, width: raster.width, height: raster.height, faces, tiled: asset.mode === 'tiled' };
  if (plan.tiled) for (const entry of faces) {
    const tile = faceTilingSettings(entry.face);
    const x = positiveModulo(tile.offsetX, raster.width), y = positiveModulo(tile.offsetY, raster.height);
    // Every face references the same periodic plane, including faces whose
    // sizes or offsets differ. Whole-period offsets cost no additional pixels.
    entry.pixelUv = [x, y, x + tile.width, y + tile.height];
    entry.rotation = 0;
    plan.width = Math.max(plan.width, Math.ceil(x + tile.width));
    plan.height = Math.max(plan.height, Math.ceil(y + tile.height));
  } else for (const entry of faces) {
    entry.pixelUv = entry.uv.map((value, coordinate) => value * (coordinate % 2 ? raster.height / (asset.uvHeight || raster.height) : raster.width / (asset.uvWidth || raster.width)));
  }
  checkBakeSize(plan.width, plan.height);
  return plan;
}

export function packExportPlanes(planes, { powerOfTwo = true } = {}) {
  const packed = packTemplateRectangles(planes, 0);
  const side = powerOfTwo ? 2 ** Math.ceil(Math.log2(packed.side)) : packed.side;
  checkBakeSize(side, side);
  return { ...packed, side };
}

// Java entity models require a fixed box net. Bake arbitrary input face UVs
// into that net rather than exporting forbidden per-face UVs.
export function boxExportPlan(bbmodel, faces, planes = []) {
  const byElement = new Map();
  for (const face of faces) {
    if (!byElement.has(face.element)) byElement.set(face.element, []);
    byElement.get(face.element).push(face);
  }
  const entries = [], signatures = new Map();
  let density = 1;
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const fraction = value => {
    for (let denominator = 1; denominator <= 256; denominator++) {
      const numerator = Math.round(Math.abs(value) * denominator);
      if (Math.abs(Math.abs(value) * denominator - numerator) < 1e-6) {
        const divisor = gcd(numerator, denominator) || 1;
        return [numerator / divisor, denominator / divisor];
      }
    }
    throw new Error('箱型 UV 的小数精度过高，无法无损烘焙');
  };
  const includeDensity = (start, end, span) => {
    if (!span) return;
    const axis = Math.abs(end[0] - start[0]) > 1e-8 ? 0 : 1;
    const [numerator, denominator] = fraction(Math.abs(end[axis] - start[axis]) / span);
    if (!numerator) return;
    const [, phaseDenominator] = fraction(start[axis]);
    const required = numerator * phaseDenominator / gcd(denominator, phaseDenominator);
    density = density / gcd(density, required) * required;
    checkBakeSize(1, density);
  };
  for (const [element, members] of byElement) {
    const cube = exportedCubeView(element);
    cube.uv = [0, 0]; cube.mirrorUv = false;
    const [x, y, z] = cube.size;
    const signature = JSON.stringify([cube.size, members.map(face => [face.name, face.index, face.pixelUv, face.rotation])]);
    let net = signatures.get(signature);
    if (!net) {
      net = { width: Math.max(1, 2 * (x + z)), height: Math.max(1, y + z), members, cube, elements: [] };
      signatures.set(signature, net); entries.push(net);
      for (const face of members) {
        const target = getBlockbenchBoxUv(cube, face.name), source = createBlockbenchFaceUvSlots(face.pixelUv, face.rotation);
        const w = Math.abs(target[2] - target[0]), h = Math.abs(target[3] - target[1]);
        includeDensity(source[0], source[1], w);
        includeDensity(source[0], source[2], h);
      }
    }
    net.elements.push(element);
  }
  // A common integer density keeps the box offsets exact and preserves high
  // resolution textures instead of collapsing them to one pixel per unit.
  density = Math.ceil(density);
  const used = new Set(faces.map(face => face.index));
  planes.forEach((plane, index) => {
    if (!used.has(index)) entries.push({ width: Math.ceil(plane.width / density), height: Math.ceil(plane.height / density), plane, index, elements: [] });
  });
  const packed = packExportPlanes(entries);
  return { ...packed, entries, density };
}
