import { DIRECTIONS, vector, newId, fileStem, mirrorPosition, mirrorRotation, bbDocument, importedTexture, cubeUv, faceVisible, textureIndex, exportedHierarchy, cleanVector } from './native-common.js';

export function importBedrockJson(data, name, references = [], formatId = 'bedrock_entity') {
  const legacy = Object.keys(data).find(key => key.startsWith('geometry.') && data[key]?.bones);
  const geometry = data['minecraft:geometry']?.[0] || data[legacy];
  if (!geometry || !Array.isArray(geometry.bones)) throw Error('基岩模型没有有效的 geometry/bones');
  const desc = geometry.description || { identifier: legacy, texture_width: geometry.texturewidth, texture_height: geometry.textureheight };
  const resolution = [Number(desc.texture_width) || 64, Number(desc.texture_height) || 64];
  const format = formatId === 'bedrock_block' ? 'bedrock_block' : formatId === 'geckolib_animated_model' ? 'geckolib_model' : 'bedrock';
  const bb = bbDocument(name, format, resolution), bones = new Map(), materials = new Map();
  const addTexture = material => {
    const key = material || '*';
    if (materials.has(key)) return materials.get(key);
    const saved = references.find(entry => entry.material === key || entry.id === key) || references[materials.size] || references[0];
    if (!saved && references.length === 0 && key !== '*') {
      const index = bb.textures.length;
      materials.set(key, index);
      bb.textures.push(importedTexture(key, key, [], resolution));
      return index;
    }
    const index = bb.textures.length;
    materials.set(key, index);
    bb.textures.push(importedTexture(saved?.id || String(index), saved?.resource || '', saved ? [saved] : [], resolution));
    return index;
  };
  for (const bone of geometry.bones) {
    const group = {
      uuid: newId(),
      name: bone.name || 'bone',
      origin: mirrorPosition(bone.pivot),
      rotation: mirrorRotation(bone.rotation),
      children: []
    };
    if (bones.has(bone.name)) throw Error('基岩模型包含重名骨骼');
    bones.set(bone.name, { group, bone });
  }
  for (const { group, bone } of bones.values()) {
    if (bone.parent && bones.has(bone.parent)) bones.get(bone.parent).group.children.push(group);
    else bb.outliner.push(group);
    for (const item of bone.cubes || []) {
      const size = vector(item.size), raw = vector(item.origin), from = [-(raw[0] + size[0]), raw[1], raw[2]];
      const cube = {
        uuid: newId(), type: 'cube', name: item.name || group.name, from, to: from.map((n, i) => n + size[i]),
        origin: mirrorPosition(item.pivot || raw.map((n, i) => n + size[i] / 2)), rotation: mirrorRotation(item.rotation),
        inflate: Number(item.inflate ?? bone.inflate) || 0, mirror_uv: item.mirror ?? bone.mirror ?? false,
        box_uv: Array.isArray(item.uv), uv_offset: Array.isArray(item.uv) ? item.uv : [0, 0], faces: {}
      };
      for (const direction of DIRECTIONS) {
        if (cube.box_uv) cube.faces[direction] = { texture: addTexture('*') };
        else {
          const face = item.uv?.[direction];
          if (!face) {
            cube.faces[direction] = { texture: null };
            continue;
          }
          const start = vector(face.uv, [0, 0]), extent = vector(face.uv_size, direction === 'up' || direction === 'down' ? [size[0], size[2]] : [direction === 'east' || direction === 'west' ? size[2] : size[0], size[1]]);
          let uv = [start[0], start[1], start[0] + extent[0], start[1] + extent[1]];
          if (direction === 'up' || direction === 'down') uv = [uv[2], uv[3], uv[0], uv[1]];
          cube.faces[direction] = {
            texture: addTexture(face.material_instance),
            uv,
            rotation: Number(face.uv_rotation) || 0,
            material_name: face.material_instance
          };
        }
      }
      bb.elements.push(cube);
      group.children.push(cube.uuid);
    }
    for (const [locatorName, value] of Object.entries(bone.locators || {})) {
      const locator = {
        uuid: newId(),
        type: 'locator',
        name: locatorName,
        position: mirrorPosition(Array.isArray(value) ? value : value.offset),
        rotation: mirrorRotation(value.rotation)
      };
      bb.elements.push(locator);
      group.children.push(locator.uuid);
    }
  }
  // Cyclic or disconnected parent links must not silently discard geometry.
  const reachable = new Set();
  const walk = items => {
    for (const item of items) if (typeof item !== 'string') {
      if (reachable.has(item.uuid)) throw Error('基岩骨骼存在循环引用');
      reachable.add(item.uuid);
      walk(item.children);
    }
  };
  walk(bb.outliner);
  if (reachable.size !== bones.size) throw Error('基岩骨骼存在循环引用');
  bb._cubebricksFormatData = { nativeGeometryDescription: structuredClone(desc), nativeGeometryVersion: data.format_version || '1.12.0' };
  return bb;
}

export function exportBedrockJson(bb, locations, formatData = {}) {
  const description = {
    ...structuredClone(formatData.nativeGeometryDescription || {}),
    identifier: formatData.nativeGeometryDescription?.identifier || `geometry.${fileStem(bb.name).replace(/[^a-zA-Z0-9_.-]/g, '_')}`,
    texture_width: bb.resolution.width, texture_height: bb.resolution.height
  };
  const geometry = { description, bones: [] }, groups = new Map(), usedNames = new Set();
  const uniqueName = value => {
    const base = String(value || 'bone').replace(/[^a-zA-Z0-9_.-]/g, '_');
    let name = base, n = 2;
    while (usedNames.has(name)) name = `${base}_${n++}`;
    usedNames.add(name);
    return name;
  };
  let root = null, hasFaceRotation = false;
  const rootBone = () => {
    if (!root) {
      root = { name: uniqueName('root'), pivot: [0, 0, 0] };
      geometry.bones.unshift(root);
    }
    return root;
  };
  exportedHierarchy(bb, (node, parents) => {
    const parent = parents.at(-1), parentBone = parent ? groups.get(parent.uuid) : null;
    if (Array.isArray(node.children)) {
      const bone = { name: uniqueName(node.name), pivot: mirrorPosition(node.origin) };
      if (parentBone) bone.parent = parentBone.name;
      if (vector(node.rotation).some(n => n)) bone.rotation = mirrorRotation(node.rotation);
      groups.set(node.uuid, bone);
      geometry.bones.push(bone);
      return;
    }
    const bone = parentBone || rootBone();
    if (node.type === 'locator') {
      bone.locators ||= {};
      bone.locators[node.name || node.uuid] = { offset: mirrorPosition(node.position || node.from), rotation: mirrorRotation(node.rotation) };
      return;
    }
    if (!node.from) return;
    const size = node.to.map((n, i) => n - node.from[i]), cube = { origin: [-(node.from[0] + size[0]), node.from[1], node.from[2]], size };
    if (node.inflate) cube.inflate = node.inflate;
    if (vector(node.rotation).some(n => n)) {
      cube.pivot = mirrorPosition(node.origin);
      cube.rotation = mirrorRotation(node.rotation);
    }
    const assigned = DIRECTIONS.map(direction => node.faces?.[direction]).filter(faceVisible);
    const indexes = new Set(assigned.map(face => textureIndex(bb, face?.texture)));
    const allFaces = assigned.length === 6 && indexes.size === 1;
    if (node.box_uv && allFaces && locations.length <= 1) {
      cube.uv = node.uv_offset || [0, 0];
      if (node.mirror_uv) cube.mirror = true;
    }
    else {
      cube.uv = {};
      for (const direction of DIRECTIONS) {
        const record = node.faces?.[direction];
        if (!faceVisible(record)) continue;
        const face = record || {};
        const index = textureIndex(bb, face.texture), texture = bb.textures[index];
        const uv = cubeUv(node, direction).map((n, axis) => n * (axis % 2 ? description.texture_height / (texture?.uv_height || description.texture_height) : description.texture_width / (texture?.uv_width || description.texture_width)));
        if (direction === 'up' || direction === 'down') [uv[0], uv[1], uv[2], uv[3]] = [uv[2], uv[3], uv[0], uv[1]];
        const value = { uv: cleanVector(uv.slice(0, 2)), uv_size: cleanVector([uv[2] - uv[0], uv[3] - uv[1]]) };
        if (face.rotation) {
          value.uv_rotation = face.rotation;
          hasFaceRotation = true;
        }
        if (locations.length > 1 && index >= 0) value.material_instance = `texture_${index}`;
        cube.uv[direction] = value;
      }
    }
    bone.cubes ||= [];
    bone.cubes.push(cube);
  });
  return { format_version: hasFaceRotation ? '1.21.0' : '1.12.0', 'minecraft:geometry': [geometry] };
}
