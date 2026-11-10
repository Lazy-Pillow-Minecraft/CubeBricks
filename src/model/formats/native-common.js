import { getBlockbenchBoxUv, isCubeFaceCulled, rotatePoint, rescaleRotationPoint } from '../../common/core/geometry-utils.js';
import { quaternionFromEuler, quaternionMultiply, eulerFromQuaternion } from '../../utils/math/rotation.js';

export const DIRECTIONS = ['north', 'south', 'east', 'west', 'up', 'down'];
export const vector = (value, fallback = [0, 0, 0]) => fallback.map((n, i) => Number.isFinite(Number(value?.[i])) ? Number(value[i]) : n);
export const cleanNumber = value => Math.abs(value) < 1e-8 ? 0 : Math.round(value * 1e8) / 1e8;
export const cleanVector = values => values.map(cleanNumber);
export const newId = () => crypto.randomUUID();
export const fileStem = name => String(name || 'untitled').replace(/^.*[\\/]/, '').replace(/(?:\.geo)?\.(json|java)$/i, '');
export const mirrorPosition = value => vector(value).map((n, i) => i === 0 ? -n : n);
export const mirrorRotation = value => vector(value).map((n, i) => i < 2 ? -n : n);

export function cubeUv(cube, direction) {
  return cube.box_uv || !cube.faces?.[direction]?.uv ? getBlockbenchBoxUv({
    size: cube.to.map((n, i) => Math.abs(n - cube.from[i])), uv: cube.uv_offset || [0, 0], mirrorUv: cube.mirror_uv
  }, direction) : [...cube.faces[direction].uv];
}

export function textureIndex(bb, reference) {
  if (typeof reference === 'number') return reference;
  const raw = String(reference ?? '').replace(/^#/, '');
  return bb.textures.findIndex((texture, index) => [texture.uuid, texture.id, String(index)].includes(raw));
}

export function exportedHierarchy(bb, visit) {
  const elements = new Map(bb.elements.map(element => [element.uuid, element])), seen = new Set();
  const walk = (items, parents = []) => {
    for (const item of items || []) {
      if (typeof item === 'string') {
        const element = elements.get(item);
        if (element && !seen.has(item)) {
          seen.add(item);
          if (element.export !== false) visit(element, parents);
        }
      } else if (item?.export !== false) {
        if (seen.has(item.uuid)) continue;
        seen.add(item.uuid);
        visit(item, parents);
        walk(item.children, [...parents, item]);
      }
    }
  };
  walk(bb.outliner);
  return seen;
}

export function flattenedCube(cube, parents) {
  let pivot = vector(cube.origin), q = quaternionFromEuler(vector(cube.rotation));
  for (const group of [...parents].reverse()) {
    pivot = rotatePoint(pivot, vector(group.origin), vector(group.rotation));
    q = quaternionMultiply(quaternionFromEuler(vector(group.rotation)), q);
  }
  const offset = pivot.map((n, i) => n - vector(cube.origin)[i]), inflate = Number(cube.inflate) || 0;
  const rescaleBaked = cube.rescale === true && parents.some(group => vector(group.rotation).some(n => Math.abs(n) > 1e-7));
  const signs = cube.to.map((value, axis) => value < cube.from[axis] ? -1 : 1);
  const from = rescaleRotationPoint(cube.from.map((n, axis) => n - signs[axis] * inflate), vector(cube.origin), vector(cube.rotation), rescaleBaked);
  const to = rescaleRotationPoint(cube.to.map((n, axis) => n + signs[axis] * inflate), vector(cube.origin), vector(cube.rotation), rescaleBaked);
  return {
    from: cleanVector(from.map((n, i) => n + offset[i])),
    to: cleanVector(to.map((n, i) => n + offset[i])), pivot: cleanVector(pivot), rotation: cleanVector(eulerFromQuaternion(q)), rescaleBaked
  };
}

export function importedTexture(id, resource, references = [], resolution = [16, 16]) {
  const saved = references.find(entry => String(entry.id) === String(id) || entry.resource === resource);
  return {
    uuid: newId(), id: String(id), name: saved?.name || (resource ? String(resource).split('/').at(-1) : 'texture') + '.png',
    namespace: String(resource).includes(':') ? String(resource).split(':')[0] : '',
    path: saved?.path || '', relative_path: saved?.relative_path || '', resource,
    uv_width: saved?.uv_width || resolution[0], uv_height: saved?.uv_height || resolution[1], use_as_default: id === '0'
  };
}

export function bbDocument(name, format, resolution) {
  return {
    meta: { format_version: '4.10', model_format: format }, name: fileStem(name),
    resolution: { width: resolution[0], height: resolution[1] }, elements: [], outliner: [], textures: []
  };
}

export function faceVisible(face) { return !isCubeFaceCulled(face); }
