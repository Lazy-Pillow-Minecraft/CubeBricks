const uid = (prefix = 'obj') => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

function normalizeRenderType(value) {
  const id = String(value || '').replace(/^minecraft:/, '');
  const aliases = {
    solid: 'solid', solid_mipped: 'solid_smooth', solid_smooth: 'solid_smooth',
    cutout: 'cutout', cutout_mipped: 'cutout_smooth', cutout_mipped_all: 'cutout_smooth', cutout_smooth: 'cutout_smooth',
    translucent: 'translucent', translucent_mipped: 'translucent_smooth', translucent_smooth: 'translucent_smooth'
  };
  return aliases[id] || null;
}

export class Cube {
  constructor(data = {}) {
    this.type = 'cube';
    this.uid = data.uid || uid('cube');
    this.name = data.name || 'cube';
    // CubeBricks cubes use a start position plus an extension size. The legacy
    // from/to pair is accepted only as a migration path for early prototypes.
    this.position = data.position || data.from || [-4, 0, -4];
    this.size = data.size || (data.to && data.from ? data.to.map((value, axis) => value - data.from[axis]) : [8, 8, 8]);
    this.inflate = data.inflate ?? 0;
    this.pivot = data.pivot || data.origin || [0, 4, 0];
    this.rotation = data.rotation || [0, 0, 0];
    this.uvMode = data.uvMode || 'box';
    this.uv = data.uv || [0, 0];
    this.mirrorUv = data.mirrorUv ?? data.mirror_uv ?? false;
    this.faces = data.faces || null;
    this.shade = data.shade ?? true;
    this.visible = data.visible ?? true;
    this.color = data.color || '#9ac24d';
  }
}

export class Shape {
  constructor(data = {}) {
    this.type = 'shape';
    this.uid = data.uid || uid('shape');
    this.name = data.name || 'shape';
    this.shapeType = data.shapeType || 'cylinder';
    this.parameters = { radius: 4, height: 8, sides: 8, ...(data.parameters || {}) };
    this.origin = data.origin || [0, 0, 0];
    this.rotation = data.rotation || [0, 0, 0];
    this.shade = data.shade ?? true;
    this.visible = data.visible ?? true;
    this.color = data.color || '#d6b35b';
  }

  toCubes() {
    const { radius, height, sides } = this.parameters;
    return Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      return new Cube({
        name: `${this.name}_${i + 1}`,
        position: [x - 1.25, 0, z - 1.25],
        size: [2.5, height, 2.5],
        pivot: [0, height / 2, 0],
        rotation: [0, -(i / sides) * 360, 0],
        color: this.color
      });
    });
  }
}

export class Locator {
  constructor(data = {}) {
    this.type = 'locator';
    this.uid = data.uid || data.uuid || uid('locator');
    this.name = data.name || 'locator';
    this.position = data.position || data.origin || [0, 0, 0];
    this.rotation = data.rotation || [0, 0, 0];
    this.visible = data.visible ?? data.visibility ?? true;
  }
}

export class Group {
  constructor(data = {}) {
    this.type = 'group';
    this.uid = data.uid || data.uuid || uid('group');
    this.name = data.name || 'group';
    this.pivot = data.pivot || data.origin || [0, 0, 0];
    this.rotation = data.rotation || [0, 0, 0];
    this.visible = data.visible ?? true;
    this.children = [...(data.children || [])];
  }
}

function rotateVector(vector, rotation) {
  let [x, y, z] = vector;
  const [rx, ry, rz] = rotation.map(value => value * Math.PI / 180);
  let c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

function inverseRotateVector(vector, rotation) {
  return rotateVector(rotateVector(rotateVector(vector, [0, 0, -rotation[2]]), [0, -rotation[1], 0]), [-rotation[0], 0, 0]);
}

function translateNode(project, node, delta) {
  if (node.type === 'cube') {
    node.position = node.position.map((value, axis) => value + delta[axis]);
    node.pivot = node.pivot.map((value, axis) => value + delta[axis]);
  } else if (node.type === 'shape') node.origin = node.origin.map((value, axis) => value + delta[axis]);
  else if (node.type === 'locator') node.position = node.position.map((value, axis) => value + delta[axis]);
  else if (node.type === 'group') {
    node.pivot = node.pivot.map((value, axis) => value + delta[axis]);
    node.children.forEach(uidValue => {
      const child = project.getNode(uidValue);
      if (child) translateNode(project, child, delta);
    });
  }
}

export function setPivotPreservingGeometry(project, item, nextPivot) {
  if (!item || !['cube', 'group'].includes(item.type)) return null;
  const previousPivot = [...item.pivot];
  const delta = nextPivot.map((value, axis) => value - previousPivot[axis]);
  const inverseDelta = inverseRotateVector(delta, item.rotation || [0, 0, 0]);
  const compensation = delta.map((value, axis) => value - inverseDelta[axis]);
  if (item.type === 'cube') {
    item.position = item.position.map((value, axis) => value + compensation[axis]);
  } else {
    item.children.forEach(uidValue => {
      const child = project.getNode(uidValue);
      if (child) translateNode(project, child, compensation);
    });
  }
  item.pivot = [...nextPivot];
  return compensation;
}

const CUT_FACE_LAYOUT = Object.freeze({
  south: Object.freeze({ horizontal: 0, horizontalReversed: false, vertical: 1, verticalReversed: true }),
  north: Object.freeze({ horizontal: 0, horizontalReversed: true, vertical: 1, verticalReversed: true }),
  east: Object.freeze({ horizontal: 2, horizontalReversed: true, vertical: 1, verticalReversed: true }),
  west: Object.freeze({ horizontal: 2, horizontalReversed: false, vertical: 1, verticalReversed: true }),
  up: Object.freeze({ horizontal: 0, horizontalReversed: false, vertical: 2, verticalReversed: false }),
  down: Object.freeze({ horizontal: 0, horizontalReversed: false, vertical: 2, verticalReversed: true })
});

function getCubeBoxUv(cube, faceName) {
  const [u, v] = cube.uv || [0, 0];
  const [x, y, z] = cube.size.map(Math.abs);
  const rectangles = {
    east: [u, v + z, u + z, v + z + y],
    north: [u + z, v + z, u + z + x, v + z + y],
    west: [u + z + x, v + z, u + z + x + z, v + z + y],
    south: [u + z + x + z, v + z, u + z + x + z + x, v + z + y],
    up: [u + z + x, v + z, u + z, v],
    down: [u + z + x + x, v, u + z + x, v + z]
  };
  if (cube.mirrorUv) {
    for (const rectangle of Object.values(rectangles)) [rectangle[0], rectangle[2]] = [rectangle[2], rectangle[0]];
    [rectangles.east, rectangles.west] = [rectangles.west, rectangles.east];
  }
  return rectangles[faceName];
}

function rotateFaceUvSlots(rectangle, rotation = 0) {
  let slots = [
    [rectangle[0], rectangle[1]], [rectangle[2], rectangle[1]],
    [rectangle[0], rectangle[3]], [rectangle[2], rectangle[3]]
  ];
  let turns = ((Math.round(rotation / 90) % 4) + 4) % 4;
  while (turns-- > 0) slots = [slots[2], slots[0], slots[3], slots[1]];
  return slots;
}

function faceUvRectangleFromSlots(slots, rotation = 0) {
  let restored = slots.map(slot => [...slot]);
  let turns = ((Math.round(rotation / 90) % 4) + 4) % 4;
  while (turns-- > 0) restored = [restored[1], restored[3], restored[0], restored[2]];
  return [restored[0][0], restored[0][1], restored[3][0], restored[3][1]];
}

function splitFaceUv(face, layout, axis, ratio) {
  const dimension = layout.horizontal === axis ? 'horizontal' : layout.vertical === axis ? 'vertical' : null;
  if (!dimension || !Array.isArray(face.uv) || face.uv.length < 4) return [structuredClone(face), structuredClone(face)];
  const slots = rotateFaceUvSlots(face.uv, face.rotation || 0);
  const physicalStart = dimension === 'horizontal' ? [0, 2] : [0, 1];
  const physicalEnd = dimension === 'horizontal' ? [1, 3] : [2, 3];
  const reversed = dimension === 'horizontal' ? layout.horizontalReversed : layout.verticalReversed;
  const startIndices = reversed ? physicalEnd : physicalStart;
  const endIndices = reversed ? physicalStart : physicalEnd;
  const firstSlots = slots.map(slot => [...slot]);
  const secondSlots = slots.map(slot => [...slot]);
  for (let index = 0; index < startIndices.length; index++) {
    const startIndex = startIndices[index], endIndex = endIndices[index];
    const cut = slots[startIndex].map((value, uvAxis) => value + (slots[endIndex][uvAxis] - value) * ratio);
    firstSlots[endIndex] = cut;
    secondSlots[startIndex] = cut;
  }
  return [
    { ...structuredClone(face), uv: faceUvRectangleFromSlots(firstSlots, face.rotation || 0) },
    { ...structuredClone(face), uv: faceUvRectangleFromSlots(secondSlots, face.rotation || 0) }
  ];
}

function materializeCutFaces(cube) {
  return Object.fromEntries(Object.keys(CUT_FACE_LAYOUT).map(faceName => {
    const face = structuredClone(cube.faces?.[faceName] || {});
    if (!Array.isArray(face.uv) || face.uv.length < 4) face.uv = [...getCubeBoxUv(cube, faceName)];
    return [faceName, face];
  }));
}

export function splitCubeAt(cube, axis, coordinate) {
  if (!(cube instanceof Cube) || axis < 0 || axis > 2 || !Number.isFinite(coordinate)) return null;
  const start = cube.position[axis];
  const end = start + cube.size[axis];
  const minimum = Math.min(start, end), maximum = Math.max(start, end);
  if (coordinate <= minimum + 1e-6 || coordinate >= maximum - 1e-6) return null;
  const ratio = (coordinate - start) / cube.size[axis];
  const originalFaces = materializeCutFaces(cube);
  const data = JSON.parse(JSON.stringify({ ...cube, faces: originalFaces }));
  delete data.uid;
  data.name = `${cube.name}_cut`;
  const second = new Cube(data);
  const firstSize = coordinate - start;
  const secondSize = end - coordinate;
  cube.size = [...cube.size];
  cube.size[axis] = firstSize;
  second.position = [...cube.position];
  second.position[axis] = coordinate;
  second.size = [...cube.size];
  second.size[axis] = secondSize;
  cube.faces = structuredClone(originalFaces);
  second.faces = structuredClone(originalFaces);
  for (const [faceName, layout] of Object.entries(CUT_FACE_LAYOUT)) {
    if (layout.horizontal !== axis && layout.vertical !== axis) continue;
    const [firstFace, secondFace] = splitFaceUv(originalFaces[faceName], layout, axis, ratio);
    cube.faces[faceName] = firstFace;
    second.faces[faceName] = secondFace;
  }
  return second;
}

const KNIFE_FACE_AXES = Object.freeze({
  north: Object.freeze({ normal: 2, horizontal: 0, vertical: 1 }),
  south: Object.freeze({ normal: 2, horizontal: 0, vertical: 1 }),
  east: Object.freeze({ normal: 0, horizontal: 2, vertical: 1 }),
  west: Object.freeze({ normal: 0, horizontal: 2, vertical: 1 }),
  up: Object.freeze({ normal: 1, horizontal: 0, vertical: 2 }),
  down: Object.freeze({ normal: 1, horizontal: 0, vertical: 2 })
});

export function getKnifeFaceAxes(faceName) {
  return KNIFE_FACE_AXES[faceName] || null;
}

export function chooseKnifeCutAxis(firstPoint, secondPoint, faceName, cube = null) {
  const axes = getKnifeFaceAxes(faceName);
  if (!axes || !Array.isArray(firstPoint) || !Array.isArray(secondPoint)) return null;
  const choices = [
    { axis: axes.horizontal, distance: Math.abs(secondPoint[axes.horizontal] - firstPoint[axes.horizontal]) },
    { axis: axes.vertical, distance: Math.abs(secondPoint[axes.vertical] - firstPoint[axes.vertical]) }
  ];
  const valid = cube ? choices.filter(choice => {
    const start = cube.position[choice.axis];
    const end = start + cube.size[choice.axis];
    const coordinate = firstPoint[choice.axis];
    return coordinate > Math.min(start, end) + 1e-6 && coordinate < Math.max(start, end) - 1e-6;
  }) : choices;
  valid.sort((left, right) => left.distance - right.distance);
  return valid[0]?.axis ?? null;
}

export class CubeBricksProject {
  constructor(data = {}) {
    this.formatVersion = Math.max(2, data.formatVersion || 0);
    this.name = data.name || 'moss_golem';
    this.modelType = data.modelType || 'java_block';
    this.uvMode = data.uvMode || 'box';
    this.textureSize = data.textureSize || [64, 64];
    this.renderType = normalizeRenderType(data.renderType || data.render_type) || 'cutout';
    this.cullFaces = data.cullFaces ?? data.cull_faces ?? this.modelType.includes('block');
    this.elements = (data.elements || []).map(item => {
      if (item.type === 'shape') return new Shape(item);
      if (item.type === 'locator') return new Locator(item);
      return new Cube(item);
    });
    this.groups = (data.groups || []).map(group => new Group(group));
    this.outliner = [...(data.outliner || [])];
    this.normalizeHierarchy();
    this.meta = { createdWith: 'CubeBricks', modifiedAt: new Date().toISOString(), ...(data.meta || {}) };
  }

  normalizeHierarchy() {
    const valid = new Set([...this.elements.map(item => item.uid), ...this.groups.map(group => group.uid)]);
    this.groups.forEach(group => group.children = group.children.filter(child => valid.has(child)));
    this.outliner = this.outliner.filter(child => valid.has(child));
    const referenced = new Set([...this.outliner, ...this.groups.flatMap(group => group.children)]);
    for (const group of this.groups) if (!referenced.has(group.uid)) this.outliner.push(group.uid);
    for (const element of this.elements) if (!referenced.has(element.uid)) this.outliner.push(element.uid);
  }

  getNode(uidValue) {
    return this.elements.find(item => item.uid === uidValue) || this.groups.find(group => group.uid === uidValue) || null;
  }

  getParentGroup(uidValue) {
    return this.groups.find(group => group.children.includes(uidValue)) || null;
  }

  getGroupChain(uidValue) {
    const chain = [];
    let parent = this.getParentGroup(uidValue);
    while (parent && !chain.includes(parent)) {
      chain.unshift(parent);
      parent = this.getParentGroup(parent.uid);
    }
    return chain;
  }

  getDescendantElementUids(groupUid) {
    const result = [];
    const visit = uidValue => {
      const node = this.getNode(uidValue);
      if (!node) return;
      if (node.type === 'group') node.children.forEach(visit);
      else result.push(node.uid);
    };
    visit(groupUid);
    return result;
  }

  addElement(element, parentUid = null) {
    this.elements.push(element);
    const parent = parentUid && this.groups.find(group => group.uid === parentUid);
    (parent ? parent.children : this.outliner).push(element.uid);
  }

  addGroup(group, parentUid = null) {
    this.groups.push(group);
    const parent = parentUid && this.groups.find(item => item.uid === parentUid);
    (parent ? parent.children : this.outliner).push(group.uid);
  }

  removeNode(uidValue) {
    const group = this.groups.find(item => item.uid === uidValue);
    const removal = new Set();
    const collect = childUid => {
      if (removal.has(childUid)) return;
      removal.add(childUid);
      const node = this.getNode(childUid);
      if (node?.type === 'group') node.children.forEach(collect);
    };
    collect(group ? group.uid : uidValue);
    this.elements = this.elements.filter(item => !removal.has(item.uid));
    this.groups = this.groups.filter(item => !removal.has(item.uid));
    this.outliner = this.outliner.filter(child => !removal.has(child));
    this.groups.forEach(item => item.children = item.children.filter(child => !removal.has(child)));
  }

  serialize() {
    this.meta.modifiedAt = new Date().toISOString();
    return JSON.stringify(this, null, 2);
  }

  static demo() {
    const elements = [
        new Cube({ name: 'body', position: [-5, 4, -3], size: [10, 10, 6], pivot: [0, 4, 0], color: '#9bbf54' }),
        new Cube({ name: 'head', position: [-4, 14, -4], size: [8, 7, 8], pivot: [0, 15, 0], rotation: [0, -12, 0], color: '#b4d768' }),
        new Cube({ name: 'left_arm', position: [-8, 5, -2], size: [3, 9, 4], pivot: [-5, 13, 0], rotation: [0, 0, -8], color: '#75933f' }),
        new Cube({ name: 'right_arm', position: [5, 5, -2], size: [3, 9, 4], pivot: [5, 13, 0], rotation: [0, 0, 8], color: '#75933f' }),
        new Shape({ name: 'crown_shape', parameters: { radius: 3.4, height: 2.4, sides: 7 }, origin: [0, 21, 0] })
    ];
    const root = new Group({ name: 'moss_golem', children: elements.map(item => item.uid) });
    return new CubeBricksProject({
      elements,
      groups: [root],
      outliner: [root.uid]
    });
  }
}

export function importBlockbench(data) {
  const elements = (data.elements || []).filter(item => item.type !== 'mesh').map(item => {
    if (item.type === 'locator') return new Locator({
      uid: item.uuid,
      name: item.name,
      position: item.position || item.origin,
      rotation: item.rotation,
      visible: item.visibility
    });
    if (item.type && item.type !== 'cube') return null;
    return new Cube({
      uid: item.uuid,
      name: item.name,
      position: item.from,
      size: item.to?.map((value, axis) => value - item.from[axis]),
      inflate: item.inflate,
      pivot: item.origin,
      rotation: item.rotation,
      uvMode: item.box_uv ? 'box' : 'face',
      uv: item.uv_offset,
      mirrorUv: item.mirror_uv,
      faces: item.faces,
      shade: item.shade,
      visible: item.visibility
    });
  }).filter(Boolean);
  const elementIds = new Set(elements.map(element => element.uid));
  const groupDefinitions = new Map((data.groups || []).filter(group => group?.uuid).map(group => [group.uuid, group]));
  const groupInstances = new Map();
  const groups = [];
  const outliner = [];
  const visit = (node, target) => {
    if (typeof node === 'string') {
      if (elementIds.has(node)) target.push(node);
      else if (groupDefinitions.has(node)) visit({ uuid: node }, target);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (elementIds.has(node.uuid) && !groupDefinitions.has(node.uuid)) {
      target.push(node.uuid);
      return;
    }
    const saved = groupDefinitions.get(node.uuid) || {};
    const children = node.children || saved.children || [];
    let group = groupInstances.get(node.uuid);
    if (group) {
      target.push(group.uid);
      return;
    }
    group = new Group({
      uid: node.uuid,
      name: node.name ?? saved.name,
      origin: node.origin ?? saved.origin,
      rotation: node.rotation ?? saved.rotation,
      visible: node.visibility ?? saved.visibility,
      children: []
    });
    groupInstances.set(group.uid, group);
    groups.push(group);
    target.push(group.uid);
    children.forEach(child => visit(child, group.children));
  };
  (data.outliner || elements.map(element => element.uid)).forEach(node => visit(node, outliner));

  return new CubeBricksProject({
    name: data.name || 'imported_model',
    modelType: data.meta?.model_format || 'free',
    textureSize: data.resolution ? [data.resolution.width, data.resolution.height] : [64, 64],
    renderType: data.render_type,
    elements,
    groups,
    outliner,
    meta: { importedFrom: 'bbmodel' }
  });
}
