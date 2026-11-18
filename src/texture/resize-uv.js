import { getBlockbenchBoxUv } from '../common/core/geometry-utils.js';
import { formatRules } from '../common/core/format-constraints.js';
import { CULLED_FACE_TEXTURE_KEY } from './face-constants.js';

const FACES = ['north', 'east', 'south', 'west', 'up', 'down'];
const UV_FIELDS = ['uvMode', 'autoUv', 'uv', 'uvScale', 'faces', 'subdivisionEdits'];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Pixel boundaries live in the physical raster, which can have a different
// resolution from the imported UV grid. Never round those UV units directly.
export function stretchUvRectangle(uv, before, after) {
  return uv.map((value, index) => {
    const axis = index % 2;
    const pixel = Math.round(Number(value) * after.pixels[axis] / before.uv[axis]);
    return pixel * after.uv[axis] / after.pixels[axis];
  });
}

function faceReference(face) {
  if (!face || typeof face !== 'object') return undefined;
  return face.texture ?? face[CULLED_FACE_TEXTURE_KEY];
}

function cubeUvChange(cube, matches, before, after, allowFaceUv) {
  const affected = FACES.filter(name => matches(faceReference(cube.faces?.[name])));
  if (!affected.length) return null;
  const rectangles = new Map(FACES.map(name => {
    const face = cube.faces?.[name];
    const original = cube.uvMode !== 'box' && face?.uv?.length >= 4 && face.uv.every(value => Number.isFinite(Number(value)))
      ? face.uv : getBlockbenchBoxUv(cube, name);
    return [name, affected.includes(name) ? stretchUvRectangle(original, before, after) : [...original]];
  }));
  if (cube.uvMode === 'box') {
    const scales = after.uv.map((value, axis) => value / before.uv[axis]);
    const candidate = {
      ...cube, uv: stretchUvRectangle([...(cube.uv || [0, 0])], before, after),
      uvScale: (Number(cube.uvScale) || 1) * scales[0]
    };
    // A uniform resize can retain the compact box representation, provided all
    // rendered faces still match their snapped target rectangles exactly.
    const fits = Math.abs(scales[0] - scales[1]) < 1e-8 && FACES.every(name =>
      cube.faces?.[name] === null || getBlockbenchBoxUv(candidate, name).every((value, axis) =>
        Math.abs(value - rectangles.get(name)[axis]) < 1e-7));
    if (fits) {
      const faces = structuredClone(cube.faces);
      for (const name of affected) if (faces[name]) delete faces[name].uv;
      return { uv: candidate.uv, uvScale: candidate.uvScale, faces };
    }
    if (!allowFaceUv) throw new Error('ui.texture-stretch-box-uv-limit');
  }
  const faces = structuredClone(cube.faces || {});
  for (const name of FACES) {
    if (faces[name] === null) continue;
    // Materializing every box face protects faces assigned to other textures.
    if (affected.includes(name) || cube.uvMode === 'box')
      faces[name] = { ...(faces[name] || {}), uv: rectangles.get(name) };
  }
  return { faces, ...(cube.uvMode === 'box' ? { uvMode: 'face', autoUv: false } : {}) };
}

export function captureResizeUvState(project, records) {
  return records.flatMap(({ uid }) => {
    const node = project.getNode(uid);
    if (!node) return [];
    return [{ uid, values: structuredClone(Object.fromEntries(UV_FIELDS
      .filter(field => Object.hasOwn(node, field)).map(field => [field, node[field]]))) }];
  });
}

export function restoreResizeUvState(project, records) {
  for (const { uid, values } of records || []) {
    const node = project.getNode(uid);
    if (!node) continue;
    for (const field of UV_FIELDS) {
      if (Object.hasOwn(values, field)) node[field] = structuredClone(values[field]);
      else delete node[field];
    }
  }
}

export function planTextureStretchUvs(project, asset, assets, before, after) {
  const references = new Map();
  for (const [index, candidate] of assets.entries()) {
    for (const reference of [candidate._uid, candidate.uuid, candidate.id, candidate.name, index]) {
      if (reference !== undefined && reference !== null && !references.has(String(reference)))
        references.set(String(reference), candidate);
    }
  }
  const matches = reference => reference !== undefined && reference !== null
    && references.get(String(reference).replace(/^#/, '')) === asset;
  const allowFaceUv = formatRules(project).allowFaceUv;
  const changes = [];
  const liveByOwner = new Map();
  for (const node of project.elements || []) if (node.subdivisionOwnerUid) {
    if (!liveByOwner.has(node.subdivisionOwnerUid)) liveByOwner.set(node.subdivisionOwnerUid, []);
    liveByOwner.get(node.subdivisionOwnerUid).push(node);
  }
  for (const node of project.elements || []) {
    if (node.subdivisionOwnerUid) continue;
    if (node.type === 'cube') {
      const values = cubeUvChange(node, matches, before, after, allowFaceUv);
      if (values) changes.push({ node, values });
      continue;
    }
    if (typeof node.toCubes !== 'function') continue;
    const live = liveByOwner.get(node.uid) || [];
    const cubes = live.length ? live : node.toCubes(project);
    const bases = node.toFormatBaseCubes?.(project) || node.toBaseCubes?.() || [];
    const edits = { ...(node.subdivisionEdits || {}) };
    let changed = false;
    for (let index = 0; index < cubes.length; index++) {
      const displayedCube = cubes[index];
      const cube = node.toSubdivisionSourceCube?.(displayedCube) || displayedCube;
      const values = cubeUvChange(cube, matches, before, after, allowFaceUv);
      if (!values) continue;
      changed = true;
      const edit = { ...(edits[index] || {}) };
      for (const [field, value] of Object.entries(values)) {
        if (same(value, bases[index]?.[field])) delete edit[field];
        else edit[field] = structuredClone(value);
      }
      edits[index] = edit;
      if (live.length) changes.push({ node: displayedCube,
        values: cubeUvChange(displayedCube, matches, before, after, allowFaceUv) });
    }
    if (changed) changes.push({ node, values: { subdivisionEdits: edits } });
  }
  const previous = captureResizeUvState(project, changes.map(({ node }) => ({ uid: node.uid })));
  return { previous, apply() { for (const { node, values } of changes) Object.assign(node, values); } };
}
