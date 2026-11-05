import { DIRECTIONS, vector, newId, bbDocument, importedTexture, cubeUv, faceVisible, textureIndex, exportedHierarchy, flattenedCube, cleanVector } from './native-common.js';

function defaultUv(direction, from, to) {
  const [x, y, z] = from, [X, Y, Z] = to;
  return { down: [x, 16 - Z, X, 16 - z], up: [x, z, X, Z], north: [16 - X, 16 - Y, 16 - x, 16 - y],
    south: [x, 16 - Y, X, 16 - y], west: [z, 16 - Y, Z, 16 - y], east: [16 - Z, 16 - Y, 16 - z, 16 - y] }[direction];
}

export function importJavaJson(data, name, references = []) {
  const bb = bbDocument(name, 'java_block', [16, 16]), keys = new Map();
  const resolve = key => {
    const visited = new Set(); let value = data.textures?.[key];
    while (typeof value === 'string' && value.startsWith('#') && !visited.has(value)) { visited.add(value); value = data.textures?.[value.slice(1)]; }
    return typeof value === 'string' && !value.startsWith('#') ? value : null;
  };
  for (const key of Object.keys(data.textures || {})) {
    const resource = resolve(key); if (!resource) continue;
    const existing = bb.textures.findIndex(texture => texture.resource === resource);
    keys.set(key, existing >= 0 ? existing : bb.textures.push(importedTexture(key, resource, references)) - 1);
  }
  let version = '1.9-1.21.5';
  for (const item of data.elements || []) {
    if (!Array.isArray(item.from) || !Array.isArray(item.to)) throw Error('Java 模型元素缺少有效的 from/to');
    const from = vector(item.from), to = vector(item.to), rotation = [0, 0, 0], origin = vector(item.rotation?.origin, [8, 8, 8]);
    if (item.rotation?.axis) {
      const axis = 'xyz'.indexOf(item.rotation.axis); if (axis < 0) throw Error('Java 模型旋转轴无效');
      rotation[axis] = Number(item.rotation.angle) || 0;
      if (Math.abs(rotation[axis]) > 45 || Math.abs(rotation[axis] / 22.5 - Math.round(rotation[axis] / 22.5)) > 1e-7) version = '1.21.6-1.21.10';
    } else if (item.rotation) { 'xyz'.split('').forEach((axis, i) => rotation[i] = Number(item.rotation[axis]) || 0); version = '1.21.11+'; }
    const cube = { uuid: newId(), type: 'cube', name: item.name || 'cube', from, to, origin, rotation,
      rescale: item.rotation?.rescale === true, shade: item.shade !== false, box_uv: false, faces: {} };
    for (const direction of DIRECTIONS) {
      const face = item.faces?.[direction];
      cube.faces[direction] = face ? { ...face, uv: face.uv || defaultUv(direction, from, to),
        texture: keys.has(String(face.texture).replace(/^#/, '')) ? keys.get(String(face.texture).replace(/^#/, '')) : false } : { texture: null };
    }
    bb.elements.push(cube); bb.outliner.push(cube.uuid);
  }
  bb._cubebricksFormatData = { javaBlockVersion: version, nativeJson: Object.fromEntries(Object.entries(data)
    .filter(([key]) => !['elements', 'textures', 'groups'].includes(key))) };
  return bb;
}

export function exportJavaJson(bb, locations, formatData = {}) {
  const data = { ...(structuredClone(formatData.nativeJson) || {}), textures: {}, elements: [] };
  locations.forEach((location, index) => { data.textures[String(index)] = location.resource; });
  const particle = bb.textures.findIndex(texture => texture.particle);
  if (particle >= 0) data.textures.particle = `#${particle}`;
  exportedHierarchy(bb, (cube, parents) => {
    if (!cube.from) return;
    const pose = flattenedCube(cube, parents), element = { from: pose.from, to: pose.to, faces: {} };
    const axes = pose.rotation.map((n, i) => Math.abs(n) > 1e-6 ? i : -1).filter(i => i >= 0);
    if (axes.length) {
      if (formatData.javaBlockVersion === '1.21.11+') element.rotation = { origin: pose.pivot, x: pose.rotation[0], y: pose.rotation[1], z: pose.rotation[2] };
      else {
        if (axes.length > 1) throw Error('当前 Java 版本不能导出多轴旋转，请选择 1.21.11+ 或调整组旋转');
        const axis = axes[0], angle = pose.rotation[axis];
        if ((!formatData.javaBlockVersion || formatData.javaBlockVersion === '1.9-1.21.5') && (Math.abs(angle) > 45 + 1e-6 || Math.abs(angle / 22.5 - Math.round(angle / 22.5)) > 1e-6))
          throw Error('当前 Java 版本不能导出该旋转角度，请调整版本或组旋转');
        element.rotation = { origin: pose.pivot, axis: 'xyz'[axis], angle };
      }
      if (cube.rescale && !pose.rescaleBaked) element.rotation.rescale = true;
    }
    if (cube.shade === false) element.shade = false;
    for (const direction of DIRECTIONS) {
      const record = cube.faces?.[direction]; if (!faceVisible(record)) continue;
      const face = record || {};
      const index = textureIndex(bb, face.texture), texture = bb.textures[index];
      const uv = cubeUv(cube, direction).map((n, axis) => n * 16 / (axis % 2 ? texture?.uv_height || bb.resolution.height : texture?.uv_width || bb.resolution.width));
      const value = { uv: cleanVector(uv), texture: index >= 0 ? `#${index}` : '#missing' };
      if (face.rotation) value.rotation = face.rotation;
      if (face.cullface) value.cullface = face.cullface;
      if (Number.isInteger(face.tintindex)) value.tintindex = face.tintindex;
      element.faces[direction] = value;
    }
    if (Object.keys(element.faces).length) data.elements.push(element);
  });
  if (!data.elements.length && data.parent) delete data.elements;
  return data;
}
