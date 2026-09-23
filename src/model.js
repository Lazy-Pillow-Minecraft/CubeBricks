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
