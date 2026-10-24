import { ModelFormatId, modelFormatRegistry, resolveModelFormatId } from './common/config/model-formats.js';
import { modifierRegistry } from './common/config/modifiers.js';
import { operatorRegistry } from './common/config/operators.js';
import { constrainCube, formatRules } from './common/core/format-constraints.js';
import { shapeRegistry } from './shapes/builtins.js';
import { DODECAHEDRON_UNIT_FACES, TRUNCATED_ICOSAHEDRON_UNIT_FACES, regularPolyhedronCubes } from './utils/shape/polyhedron-geometry.js';
import { bezierCubes } from './utils/shape/bezier-geometry.js';
import { shapePackUtils } from './utils/index.js';

const uid = (prefix = 'obj') => `${prefix}_${crypto.randomUUID()}`;
// Blockbench's standard marker palette (pastel viewport colours).
export const BLOCKBENCH_MARKER_COLORS = Object.freeze(['#a2ebff', '#fff899', '#f1bb75', '#ff9b97', '#c5a6e8', '#a6c8ff', '#7bffa3', '#bdffa6', '#ffa5d5', '#e0e9fb']);
const reportedShapeErrors = new Set();

function blockbenchMarkerIndex(color) {
  const rgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const target = rgb(typeof color === 'string' ? color : BLOCKBENCH_MARKER_COLORS[0]);
  let best = 0, distance = Infinity;
  BLOCKBENCH_MARKER_COLORS.forEach((hex, index) => {
    const next = rgb(hex).reduce((sum, value, channel) => sum + (value - target[channel]) ** 2, 0);
    if (next < distance) { best = index; distance = next; }
  });
  return best;
}

function initializeNodeNaming(node, data, fallback) {
  node.name = data.name || fallback;
  // Older projects and imported names are explicit unless the saved state
  // says otherwise. Do not infer naming ownership from the displayed text.
  node.unnamed = booleanProperty(data.unnamed, !data.name);
}

export function allocateGroupName(project, sourceName = 'group_1', { duplicate = false, reservedNames = [], excludeUid = null } = {}) {
  const parse = name => {
    const match = String(name).match(/^(.*?)(\d+)$/);
    return match ? { prefix: match[1], number: BigInt(match[2]) } : { prefix: String(name), number: 1n };
  };
  const source = parse(sourceName);
  const numbers = [...project.groups.filter(group => group.uid !== excludeUid).map(group => group.name), ...reservedNames]
    .map(parse).filter(entry => entry.prefix === source.prefix).map(entry => entry.number);
  if (!numbers.length) return `${source.prefix}${duplicate ? source.number + 1n : source.number}`;
  const used = new Set(numbers.map(String));
  let candidate = numbers.reduce((minimum, number) => number < minimum ? number : minimum);
  while (used.has(String(candidate))) candidate++;
  return `${source.prefix}${candidate}`;
}

export function refreshAutomaticNodeName(project, node) {
  if (!node?.unnamed || node.type === 'group') return;
  const parent = project.getParentGroup(node.uid);
  node.name = parent && !parent.unnamed ? parent.name
    : node instanceof Shape ? 'shape' : node.type;
}

export function setNodeName(project, node, value) {
  const name = String(value || '').trim();
  if (!name) return setNodeUnnamed(project, node, true);
  node.name = name;
  node.unnamed = false;
  if (node.type === 'group') {
    for (const childUid of node.children) refreshAutomaticNodeName(project, project.getNode(childUid));
  }
}

export function setNodeUnnamed(project, node, value) {
  const wasUnnamed = node.unnamed;
  node.unnamed = Boolean(value);
  if (node.type === 'group') {
    if (node.unnamed && !wasUnnamed) node.name = allocateGroupName(project, 'group_1', { excludeUid: node.uid });
    for (const childUid of node.children) refreshAutomaticNodeName(project, project.getNode(childUid));
  } else if (node.unnamed) refreshAutomaticNodeName(project, node);
}

function normalizeRenderType(value) {
  const id = String(value || '').replace(/^minecraft:/, '');
  const aliases = {
    solid: 'solid', solid_mipped: 'solid_smooth', solid_smooth: 'solid_smooth',
    cutout: 'cutout', cutout_mipped: 'cutout_smooth', cutout_mipped_all: 'cutout_smooth', cutout_smooth: 'cutout_smooth',
    translucent: 'translucent', translucent_mipped: 'translucent_smooth', translucent_smooth: 'translucent_smooth'
  };
  return aliases[id] || null;
}

function hasAssignedTexture(faces) {
  return Boolean(faces && Object.values(faces).some(face => face && face.texture !== null && face.texture !== undefined));
}

function booleanProperty(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'false' || normalized === '0' || normalized === '') return false;
    if (normalized === 'true' || normalized === '1') return true;
  }
  return Boolean(value);
}

const SUBDIVISION_VECTOR_FIELDS = Object.freeze(['position', 'size', 'pivot', 'rotation']);

function cloneData(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeReferenceImages(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(['general', 'x', 'y', 'z'].map(key => {
    const records = Array.isArray(source[key]) ? source[key] : source[key] ? [source[key]] : [];
    return [key, records.flatMap(record => {
      if (!record || typeof record.source !== 'string') return [];
      const naturalWidth = Math.max(1, Number(record.naturalWidth) || 1);
      const naturalHeight = Math.max(1, Number(record.naturalHeight) || 1);
      const fallbackScale = key === 'general' ? 1 : 16 / Math.max(naturalWidth, naturalHeight);
      return [{
        uid: String(record.uid || uid('reference')),
        name: String(record.name || 'reference.png'),
        source: record.source,
        naturalWidth,
        naturalHeight,
        offset: [Number(record.offset?.[0]) || 0, Number(record.offset?.[1]) || 0],
        scale: Math.max(.00001, Number(record.scale) || fallbackScale)
      }];
    })];
  }));
}

function normalizeModifierList(modifiers, targetType, anchorPosition = [0, 0, 0]) {
  if (!Array.isArray(modifiers)) return [];
  return modifiers.flatMap(data => {
    const modifier = modifierRegistry.create(data?.type, targetType, data);
    if (!modifier) return [];
    modifier.anchor = {
      position: vector3(modifier.anchor?.position, anchorPosition),
      rotation: vector3(modifier.anchor?.rotation)
    };
    return [modifier];
  });
}

function normalizeOperatorList(operators, targetType, anchorPosition = [0, 0, 0]) {
  if (!Array.isArray(operators)) return [];
  return operators.flatMap(data => {
    const operator = operatorRegistry.create(data?.type, targetType, data);
    if (!operator) return [];
    operator.anchor = {
      position: vector3(operator.anchor?.position, anchorPosition),
      rotation: vector3(operator.anchor?.rotation)
    };
    return [operator];
  });
}

function legacyMirrorHasState(mirror) {
  return Boolean(mirror && (mirror.enabled || mirror.controllerUid || mirror.mode && mirror.mode !== 'axes'
    || mirror.axes?.x || mirror.axes?.y || mirror.axes?.z || mirror.distribution === 'range'
    || Number(mirror.copies) !== 3 || Number(mirror.rangeStart) !== 0 || Number(mirror.rangeEnd) !== 180
    || mirror.wrapParent === false));
}

function legacyMirrorModifier(mirror, targetType, anchorPosition) {
  if (!legacyMirrorHasState(mirror)) return null;
  return modifierRegistry.create('symmetry', targetType, {
    enabled: booleanProperty(mirror.enabled, false),
    mode: ['axes', 'radial', 'mandala'].includes(mirror.mode) ? mirror.mode : 'axes',
    axes: {
      x: booleanProperty(mirror.axes?.x, false),
      y: booleanProperty(mirror.axes?.y, false),
      z: booleanProperty(mirror.axes?.z, false)
    },
    copies: Math.max(1, Math.round(Number(mirror.copies) || 3)),
    distribution: mirror.distribution === 'range' ? 'range' : 'full',
    rangeStart: Number.isFinite(Number(mirror.rangeStart)) ? Number(mirror.rangeStart) : 0,
    rangeEnd: Number.isFinite(Number(mirror.rangeEnd)) ? Number(mirror.rangeEnd) : 180,
    wrapParent: booleanProperty(mirror.wrapParent, true),
    anchor: { position: [...anchorPosition], rotation: [0, 0, 0] },
    _legacyControllerUid: mirror.controllerUid || null
  });
}

export function getModifier(owner, type) {
  return owner?.modifiers?.find(modifier => modifier.type === type) || null;
}

export function addModifier(owner, type, data = {}) {
  if (!owner) return null;
  const definition = modifierRegistry.get(type);
  if (definition?.allowMultiple === false && getModifier(owner, type)) return null;
  const modifier = modifierRegistry.create(type, owner.type, data);
  if (!modifier) return null;
  const anchorPosition = owner.type === 'group' || owner.type === 'cube' || owner instanceof Shape
    ? owner.pivot
    : owner.origin || owner.position || [0, 0, 0];
  modifier.anchor = {
    position: vector3(data.anchor?.position, anchorPosition),
    rotation: vector3(data.anchor?.rotation)
  };
  owner.modifiers ||= [];
  owner.modifiers.push(modifier);
  return modifier;
}

export function addOperator(owner, type, data = {}) {
  if (!owner) return null;
  const definition = operatorRegistry.get(type);
  if (definition?.allowMultiple === false && owner.operators?.some(operator => operator.type === type)) return null;
  const operator = operatorRegistry.create(type, owner.type, data);
  if (!operator) return null;
  const anchorPosition = owner.type === 'group' || owner.type === 'cube' || owner instanceof Shape
    ? owner.pivot
    : owner.origin || owner.position || [0, 0, 0];
  operator.anchor = {
    position: vector3(data.anchor?.position, anchorPosition),
    rotation: vector3(data.anchor?.rotation)
  };
  owner.operators ||= [];
  owner.operators.push(operator);
  return operator;
}

function applySubdivisionEdits(cubes, owner) {
  const edits = owner.subdivisionEdits || {};
  return cubes.map((cube, index) => {
    const edit = edits[index] || edits[String(index)];
    cube.uid = `${owner.uid}::subdivision::${index}`;
    cube.subdivisionOwnerUid = owner.uid;
    cube.subdivisionIndex = index;
    if (!edit) return cube;
    for (const field of SUBDIVISION_VECTOR_FIELDS) {
      const delta = edit[`${field}Delta`];
      if (Array.isArray(delta)) cube[field] = cube[field].map((value, axis) => value + (Number(delta[axis]) || 0));
    }
    if (Number.isFinite(Number(edit.inflateDelta))) cube.inflate += Number(edit.inflateDelta);
    for (const field of ['name', 'unnamed', 'uvMode', 'uvNormalized', 'uv', 'mirrorUv', 'faces', 'autoUv', 'exported', 'locked', 'shade', 'visible', 'color']) {
      if (edit[field] !== undefined) cube[field] = cloneData(edit[field]);
    }
    return cube;
  });
}

export class Cube {
  constructor(data = {}) {
    this.type = 'cube';
    this.uid = data.uid || uid('cube');
    initializeNodeNaming(this, data, 'cube');
    // CubeBricks cubes use a start position plus an extension size. The legacy
    // from/to pair is accepted only as a migration path for early prototypes.
    this.position = data.position || data.from || [-4, 0, -4];
    this.size = data.size || (data.to && data.from ? data.to.map((value, axis) => value - data.from[axis]) : [8, 8, 8]);
    this.inflate = data.inflate ?? 0;
    this.pivot = data.pivot || data.origin || [0, 4, 0];
    this.rotation = data.rotation || [0, 0, 0];
    this.uvMode = data.uvMode || 'box';
    this.uvNormalized = booleanProperty(data.uvNormalized ?? data.uv_normalized, true);
    this.uv = data.uv || [0, 0];
    this.uvScale = Number.isFinite(Number(data.uvScale)) && Number(data.uvScale) > 0 ? Number(data.uvScale) : 1;
    this.mirrorUv = data.mirrorUv ?? data.mirror_uv ?? false;
    this.faces = data.faces || null;
    this.autoUv = booleanProperty(data.autoUv ?? data.autouv, !hasAssignedTexture(this.faces));
    this.exported = booleanProperty(data.exported ?? data.export, true);
    this.locked = booleanProperty(data.locked, false);
    this.shade = data.shade ?? true;
    this.visible = booleanProperty(data.visible ?? data.visibility, true);
    this.color = typeof data.color === 'number' ? BLOCKBENCH_MARKER_COLORS[((Math.floor(data.color) % 10) + 10) % 10]
      : data.color || '#9ac24d';
    this.modifiers = normalizeModifierList(data.modifiers, this.type, this.pivot);
    this.operators = normalizeOperatorList(data.operators, this.type, this.pivot);
  }
}


export class Shape {
  constructor(data = {}) {
    const requestedType = data.shapeType || data.type;
    const shapeType = requestedType && requestedType !== 'shape' ? requestedType : 'polygon_prism';
    this.type = shapeType;
    this.uid = data.uid || uid('shape');
    initializeNodeNaming(this, data, 'shape');
    this.shapeType = shapeType;
    const defaults = shapeRegistry.get(shapeType)?.defaults || {};
    this.parameters = { ...defaults, ...(data.parameters || {}) };
    if (this.parameters.snapMode === 'cube') this.parameters.snapMode = 'edge';
    if (this.parameters.snapMode === 'bounds') this.parameters.snapMode = 'radius';
    this.origin = vector3(data.origin || data.position);
    this.pivot = vector3(data.pivot, this.origin);
    this.rotation = data.rotation || [0, 0, 0];
    this.uvMode = data.uvMode || 'box';
    this.uvNormalized = booleanProperty(data.uvNormalized ?? data.uv_normalized, true);
    this.autoUv = booleanProperty(data.autoUv ?? data.autouv, true);
    this.exported = booleanProperty(data.exported ?? data.export, true);
    this.locked = booleanProperty(data.locked, false);
    this.shade = data.shade ?? true;
    this.visible = booleanProperty(data.visible ?? data.visibility, true);
    this.color = data.color || '#d6b35b';
    this.preserveSubdivisionEdits = booleanProperty(data.preserveSubdivisionEdits, false);
    this.subdivisionEdits = cloneData(data.subdivisionEdits || {});
    this.modifiers = normalizeModifierList(data.modifiers, this.type, this.pivot);
    this.operators = normalizeOperatorList(data.operators, this.type, this.pivot);
  }

  toBaseCubes() {
    const definition = shapeRegistry.get(this.shapeType);
    if (!definition) return [];
    try {
      const cubes = definition.generate(this, {
        Cube,
        utils: shapePackUtils,
        regularPolyhedron: (faces, mergeEvenFaces = false) => regularPolyhedronCubes(this, faces, mergeEvenFaces, { Cube, matrixEuler }),
        dodecahedronFaces: DODECAHEDRON_UNIT_FACES,
        truncatedIcosahedronFaces: TRUNCATED_ICOSAHEDRON_UNIT_FACES
      });
      if (!Array.isArray(cubes) || cubes.length > 10000) throw new Error('generate 必須返回最多 10000 個 Cube');
      return cubes.map(cube => cube instanceof Cube ? cube : new Cube(cube));
    } catch (error) {
      if (!reportedShapeErrors.has(this.shapeType)) {
        reportedShapeErrors.add(this.shapeType);
        console.warn(`Shape ${this.shapeType} 生成失敗`, error);
      }
      return [];
    }
  }


  toCubes() { return applySubdivisionEdits(this.toBaseCubes(), this); }
}

export function pointInRegularPolygon(point, radius, sides) {
  const count = Math.max(3, Math.round(sides));
  const vertices = Array.from({ length: count }, (_, index) => {
    const angle = Math.PI / 2 + index * Math.PI * 2 / count;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
  let sign = 0;
  for (let index = 0; index < vertices.length; index++) {
    const start = vertices[index], end = vertices[(index + 1) % vertices.length];
    const crossValue = (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
    if (Math.abs(crossValue) < 1e-8) continue;
    const nextSign = Math.sign(crossValue);
    if (sign && nextSign !== sign) return false;
    sign = nextSign;
  }
  return true;
}

const vector3 = (value, fallback = [0, 0, 0]) => Array.isArray(value) && value.length >= 3
  ? value.slice(0, 3).map((component, axis) => Number.isFinite(Number(component)) ? Number(component) : fallback[axis])
  : [...fallback];

export class CurveNode {
  constructor(data = {}, planar = false) {
    this.uid = data.uid || uid('node');
    this.position = vector3(data.position);
    if (planar) this.position[1] = 0;
    this.rotation = vector3(data.rotation);
    if (planar) {
      this.rotation[0] = 0;
      this.rotation[2] = 0;
    }
    this.handlesEnabled = booleanProperty(data.handlesEnabled ?? data.handles, true);
    this.symmetricHandles = booleanProperty(data.symmetricHandles, true);
    const hasExplicitHandles = Array.isArray(data.handleIn) || Array.isArray(data.handleOut);
    this.autoTangent = booleanProperty(data.autoTangent, !hasExplicitHandles);
    this.roll = planar ? 0 : Number(data.roll) || 0;
    this.handleIn = vector3(data.handleIn, [-2, 0, 0]);
    this.handleOut = vector3(data.handleOut, [2, 0, 0]);
    if (planar) {
      this.handleIn[1] = 0;
      this.handleOut[1] = 0;
    }
  }
}

export class NodeElement {
  constructor(data = {}) {
    this.type = 'node';
    this.uid = data.uid || data.uuid || uid('node_element');
    initializeNodeNaming(this, data, 'node');
    this.position = vector3(data.position || data.origin);
    this.rotation = vector3(data.rotation);
    this.handlesEnabled = booleanProperty(data.handlesEnabled ?? data.handles, false);
    this.symmetricHandles = booleanProperty(data.symmetricHandles, true);
    this.handleIn = vector3(data.handleIn, [-2, 0, 0]);
    this.handleOut = vector3(data.handleOut, [2, 0, 0]);
    this.exported = booleanProperty(data.exported ?? data.export, true);
    this.locked = booleanProperty(data.locked, false);
    this.visible = booleanProperty(data.visible ?? data.visibility, true);
    this.mirrorControllerFor = data.mirrorControllerFor || null;
    this.modifiers = normalizeModifierList(data.modifiers, this.type, this.position);
    this.operators = normalizeOperatorList(data.operators, this.type, this.position);
  }
}

function cubicBezierPoint(start, controlA, controlB, end, t) {
  const inverse = 1 - t;
  return [0, 1, 2].map(axis => inverse ** 3 * start[axis]
    + 3 * inverse ** 2 * t * controlA[axis]
    + 3 * inverse * t ** 2 * controlB[axis]
    + t ** 3 * end[axis]);
}

function cubicBezierTangent(start, controlA, controlB, end, t) {
  const inverse = 1 - t;
  return [0, 1, 2].map(axis => 3 * inverse ** 2 * (controlA[axis] - start[axis])
    + 6 * inverse * t * (controlB[axis] - controlA[axis])
    + 3 * t ** 2 * (end[axis] - controlB[axis]));
}

function vectorLength(vector) { return Math.hypot(vector[0], vector[1], vector[2]); }
function normalizeVector(vector, fallback = [0, 0, 1]) {
  const length = vectorLength(vector);
  return length > 1e-8 ? vector.map(value => value / length) : [...fallback];
}

function interpolateAngleDegrees(start, end, amount) {
  const delta = ((end - start + 540) % 360) - 180;
  return start + delta * amount;
}

function crossVector(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

function directionFrameEuler(direction, roll = 0) {
  const forward = normalizeVector(direction);
  const referenceUp = Math.abs(forward[1]) < .98 ? [0, 1, 0] : [1, 0, 0];
  const baseRight = normalizeVector(crossVector(referenceUp, forward), [1, 0, 0]);
  const baseUp = normalizeVector(crossVector(forward, baseRight), [0, 1, 0]);
  const radians = roll * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const right = baseRight.map((value, axis) => value * cosine + baseUp[axis] * sine);
  const up = baseUp.map((value, axis) => value * cosine - baseRight[axis] * sine);
  const r00 = right[0], r10 = right[1], r20 = right[2];
  const r21 = up[2], r22 = forward[2];
  const pitch = Math.atan2(r21, r22);
  const yaw = Math.asin(Math.max(-1, Math.min(1, -r20)));
  const rollZ = Math.atan2(r10, r00);
  return [pitch, yaw, rollZ].map(value => value * 180 / Math.PI);
}

export class BezierElement {
  constructor(data = {}, dimension = data.dimension === 2 ? 2 : 3) {
    this.type = dimension === 2 ? 'bezier2d' : 'bezier3d';
    this.uid = data.uid || data.uuid || uid(this.type);
    initializeNodeNaming(this, data, this.type);
    this.dimension = dimension;
    this.origin = vector3(data.origin);
    this.rotation = vector3(data.rotation);
    this.uvMode = data.uvMode || 'box';
    this.uvNormalized = booleanProperty(data.uvNormalized ?? data.uv_normalized, true);
    const defaults = dimension === 2
      ? [{ position: [-4, 0, 0] }, { position: [4, 0, 0] }]
      : [{ position: [-4, 0, 0] }, { position: [4, 4, 2] }];
    this.nodes = (data.nodes?.length >= 2 ? data.nodes : defaults).map(node => new CurveNode(node, dimension === 2));
    this.parameters = { ...shapeRegistry.get(this.type)?.defaults, ...(data.parameters || {}) };
    this.autoUv = booleanProperty(data.autoUv ?? data.autouv, true);
    this.exported = booleanProperty(data.exported ?? data.export, true);
    this.locked = booleanProperty(data.locked, false);
    this.shade = booleanProperty(data.shade, true);
    this.visible = booleanProperty(data.visible ?? data.visibility, true);
    this.color = data.color || (dimension === 2 ? '#d7b25b' : '#78b6d7');
    this.preserveSubdivisionEdits = booleanProperty(data.preserveSubdivisionEdits, false);
    this.subdivisionEdits = cloneData(data.subdivisionEdits || {});
    this.modifiers = normalizeModifierList(data.modifiers, this.type, this.origin);
    this.operators = normalizeOperatorList(data.operators, this.type, this.origin);
  }

  resolvedNodeState(index) {
    const node = this.nodes[index];
    const previous = this.nodes[index - 1], next = this.nodes[index + 1];
    let handleIn, handleOut;
    if (node.autoTangent) {
      const direction = previous && next
        ? next.position.map((value, axis) => value - previous.position[axis])
        : next ? next.position.map((value, axis) => value - node.position[axis])
          : previous ? node.position.map((value, axis) => value - previous.position[axis])
            : [0, 0, 1];
      const tangent = normalizeVector(direction);
      const previousDistance = previous
        ? vectorLength(node.position.map((value, axis) => value - previous.position[axis]))
        : next ? vectorLength(next.position.map((value, axis) => value - node.position[axis])) : 3;
      const nextDistance = next
        ? vectorLength(next.position.map((value, axis) => value - node.position[axis]))
        : previousDistance;
      handleIn = tangent.map(value => -value * previousDistance / 3);
      handleOut = tangent.map(value => value * nextDistance / 3);
    } else {
      handleIn = rotateVector(node.handleIn, node.rotation || [0, 0, 0]);
      handleOut = rotateVector(node.handleOut, node.rotation || [0, 0, 0]);
    }
    const direction = vectorLength(handleOut) > 1e-8
      ? handleOut
      : handleIn.map(value => -value);
    const rotation = directionFrameEuler(direction, this.dimension === 3 ? node.roll : 0);
    return {
      handleIn,
      handleOut,
      rotation,
      localHandleIn: inverseRotateVector(handleIn, rotation),
      localHandleOut: inverseRotateVector(handleOut, rotation)
    };
  }

  sampleCurve() {
    const dense = [];
    const segmentCount = this.nodes.length - 1;
    const resolved = this.nodes.map((_, index) => this.resolvedNodeState(index));
    for (let segment = 0; segment < segmentCount; segment++) {
      const startNode = this.nodes[segment], endNode = this.nodes[segment + 1];
      const start = startNode.position;
      const end = endNode.position;
      const startHandle = resolved[segment].handleOut;
      const endHandle = resolved[segment + 1].handleIn;
      const controlA = startNode.handlesEnabled ? start.map((value, axis) => value + startHandle[axis]) : start;
      const controlB = endNode.handlesEnabled ? end.map((value, axis) => value + endHandle[axis]) : end;
      const steps = 96;
      for (let index = segment === 0 ? 0 : 1; index <= steps; index++) {
        const t = index / steps;
        dense.push({
          point: cubicBezierPoint(start, controlA, controlB, end, t),
          tangent: normalizeVector(cubicBezierTangent(start, controlA, controlB, end, t)),
          roll: this.dimension === 3 ? interpolateAngleDegrees(startNode.roll, endNode.roll, t) : 0,
          segment,
          t
        });
      }
    }
    if (dense.length < 2) return dense;
    const cumulative = [0];
    for (let index = 1; index < dense.length; index++) {
      cumulative.push(cumulative.at(-1) + vectorLength(
        dense[index].point.map((value, axis) => value - dense[index - 1].point[axis])));
    }
    const totalLength = cumulative.at(-1);
    const sampleAtDistance = distance => {
      const target = Math.max(0, Math.min(totalLength, distance));
      let high = cumulative.findIndex(value => value >= target);
      if (high <= 0) return { ...dense[0], point: [...dense[0].point], tangent: [...dense[0].tangent] };
      if (high < 0) return { ...dense.at(-1), point: [...dense.at(-1).point], tangent: [...dense.at(-1).tangent] };
      const low = high - 1;
      const span = cumulative[high] - cumulative[low];
      const amount = span > 1e-9 ? (target - cumulative[low]) / span : 0;
      return {
        point: dense[low].point.map((value, axis) => value + (dense[high].point[axis] - value) * amount),
        tangent: normalizeVector(dense[low].tangent.map(
          (value, axis) => value + (dense[high].tangent[axis] - value) * amount)),
        roll: interpolateAngleDegrees(dense[low].roll, dense[high].roll, amount),
        segment: amount < .5 ? dense[low].segment : dense[high].segment,
        t: dense[low].t + (dense[high].t - dense[low].t) * amount
      };
    };
    if (this.parameters.segmentationMode === 'angle') {
      const threshold = Math.max(.1, Number(this.parameters.angleStep) || 10) * Math.PI / 180;
      const middleDistance = totalLength / 2;
      const middle = sampleAtDistance(middleDistance);
      const left = [], right = [];
      let previousDirection = middle.tangent;
      for (let index = cumulative.findLastIndex(value => value < middleDistance); index > 0; index--) {
        const direction = dense[index].tangent;
        const cosine = Math.max(-1, Math.min(1, direction.reduce(
          (sum, value, axis) => sum + value * previousDirection[axis], 0)));
        if (Math.acos(cosine) + 1e-9 < threshold) continue;
        left.push(dense[index]);
        previousDirection = direction;
      }
      previousDirection = middle.tangent;
      for (let index = cumulative.findIndex(value => value > middleDistance); index < dense.length - 1; index++) {
        const direction = dense[index].tangent;
        const cosine = Math.max(-1, Math.min(1, direction.reduce(
          (sum, value, axis) => sum + value * previousDirection[axis], 0)));
        if (Math.acos(cosine) + 1e-9 < threshold) continue;
        right.push(dense[index]);
        previousDirection = direction;
      }
      return [dense[0], ...left.reverse(), middle, ...right, dense.at(-1)];
    }
    const spacing = Math.max(.0625, Number(this.parameters.segmentLength) || 1);
    if (totalLength <= spacing + 1e-8) return [dense[0], dense.at(-1)];
    // Each Bezier span is fitted outwards from its own arc-length midpoint.
    // Keeping explicit nodes as boundaries preserves sharp bends and makes a
    // mirrored span produce mirrored cube placement even with a remainder.
    const spanBoundaries = [0];
    for (let index = 1; index < dense.length; index++) {
      if (dense[index].segment !== dense[index - 1].segment) spanBoundaries.push(cumulative[index - 1]);
    }
    spanBoundaries.push(totalLength);
    const distances = [...spanBoundaries];
    for (let span = 0; span < spanBoundaries.length - 1; span++) {
      const startDistance = spanBoundaries[span], endDistance = spanBoundaries[span + 1];
      const middleDistance = (startDistance + endDistance) / 2;
      for (let offset = spacing / 2; middleDistance - offset > startDistance + 1e-8; offset += spacing) {
        distances.push(middleDistance - offset);
      }
      for (let offset = spacing / 2; middleDistance + offset < endDistance - 1e-8; offset += spacing) {
        distances.push(middleDistance + offset);
      }
    }
    const uniqueDistances = [...new Set(distances.map(value => Math.round(value * 1e9) / 1e9))];
    return uniqueDistances.sort((left, right) => left - right).map(sampleAtDistance);
  }

  toBaseCubes() {
    return shapeRegistry.get(this.type)?.generate(this, {
      Cube,
      utils: shapePackUtils,
      bezierCubes: curve => bezierCubes(curve, { Cube, vectorLength, directionFrameEuler })
    }) || [];
  }



  toCubes() { return applySubdivisionEdits(this.toBaseCubes(), this); }
}

export class Locator {
  constructor(data = {}) {
    this.type = 'locator';
    this.uid = data.uid || data.uuid || uid('locator');
    initializeNodeNaming(this, data, 'locator');
    this.position = data.position || data.origin || [0, 0, 0];
    this.rotation = data.rotation || [0, 0, 0];
    this.exported = booleanProperty(data.exported ?? data.export, true);
    this.locked = booleanProperty(data.locked, false);
    this.visible = booleanProperty(data.visible ?? data.visibility, true);
    this.modifiers = normalizeModifierList(data.modifiers, this.type, this.position);
    this.operators = normalizeOperatorList(data.operators, this.type, this.position);
  }
}

export class Group {
  constructor(data = {}) {
    this.type = 'group';
    this.uid = data.uid || data.uuid || uid('group');
    initializeNodeNaming(this, data, 'group_1');
    this.pivot = data.pivot || data.origin || [0, 0, 0];
    this.rotation = data.rotation || [0, 0, 0];
    this.inflate = Number(data.inflate) || 0;
    this.uvMode = data.uvMode || 'box';
    this.uvNormalized = booleanProperty(data.uvNormalized ?? data.uv_normalized, true);
    this.autoUv = booleanProperty(data.autoUv ?? data.autouv, true);
    this.exported = booleanProperty(data.exported ?? data.export, true);
    this.locked = booleanProperty(data.locked, false);
    this.shade = booleanProperty(data.shade, true);
    this.visible = booleanProperty(data.visible ?? data.visibility, true);
    this.children = [...(data.children || [])];
    this.modifiers = normalizeModifierList(data.modifiers, this.type, this.pivot);
    this.operators = normalizeOperatorList(data.operators, this.type, this.pivot);
    if (!getModifier(this, 'symmetry')) {
      const migrated = legacyMirrorModifier(data.mirror, this.type, this.pivot);
      if (migrated) this.modifiers.push(migrated);
    }
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

function translateModifierAnchors(node, delta) {
  for (const modifier of node?.modifiers || []) {
    if (!Array.isArray(modifier.anchor?.position)) continue;
    modifier.anchor.position = modifier.anchor.position.map((value, axis) => value + delta[axis]);
  }
  for (const operator of node?.operators || []) {
    if (!Array.isArray(operator.anchor?.position)) continue;
    operator.anchor.position = operator.anchor.position.map((value, axis) => value + delta[axis]);
  }
}

function translateNode(project, node, delta) {
  translateModifierAnchors(node, delta);
  if (node.type === 'cube') {
    node.position = node.position.map((value, axis) => value + delta[axis]);
    node.pivot = node.pivot.map((value, axis) => value + delta[axis]);
  } else if (node.origin) {
    node.origin = node.origin.map((value, axis) => value + delta[axis]);
    if (Array.isArray(node.pivot)) node.pivot = node.pivot.map((value, axis) => value + delta[axis]);
  }
  else if (node.position) node.position = node.position.map((value, axis) => value + delta[axis]);
  else if (node.type === 'group') {
    node.pivot = node.pivot.map((value, axis) => value + delta[axis]);
    node.children.forEach(uidValue => {
      const child = project.getNode(uidValue);
      if (child) translateNode(project, child, delta);
    });
  }
}

export function setPivotPreservingGeometry(project, item, nextPivot) {
  const proceduralShape = item && typeof item.toBaseCubes === 'function' && Array.isArray(item.origin);
  if (!item || (!['cube', 'group'].includes(item.type) && !proceduralShape)) return null;
  const previousPivot = [...item.pivot];
  const delta = nextPivot.map((value, axis) => value - previousPivot[axis]);
  const inverseDelta = inverseRotateVector(delta, item.rotation || [0, 0, 0]);
  const compensation = delta.map((value, axis) => value - inverseDelta[axis]);
  if (item.type === 'cube') {
    item.position = item.position.map((value, axis) => value + compensation[axis]);
  } else if (proceduralShape) {
    item.origin = item.origin.map((value, axis) => value + compensation[axis]);
  } else {
    item.children.forEach(uidValue => {
      const child = project.getNode(uidValue);
      if (child) translateNode(project, child, compensation);
    });
  }
  translateModifierAnchors(item, delta);
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
  data.name = cube.name;
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
    this.projectUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.projectUuid || '')
      ? data.projectUuid.toLowerCase() : crypto.randomUUID();
    this.formatVersion = Math.max(3, data.formatVersion || 0);
    this.formatId = resolveModelFormatId(data.formatId || data.modelType || ModelFormatId.JAVA_BLOCK_ITEM);
    const format = modelFormatRegistry.get(this.formatId);
    const defaults = format?.defaults || {};
    this.name = data.name || 'moss_golem';
    this.modelType = data.modelType || format?.blockbenchFormat || 'java_block';
    this.uvMode = data.uvMode || defaults.uvMode || 'box';
    this.textureSize = data.textureSize || defaults.textureSize || [64, 64];
    this.renderType = normalizeRenderType(data.renderType || data.render_type || defaults.renderType) || 'cutout';
    this.cullFaces = data.cullFaces ?? data.cull_faces ?? defaults.cullFaces ?? this.modelType.includes('block');
    const snapSubdivisions = Number(data.snap?.subdivisions ?? data.snapSubdivisions ?? format?.snap?.subdivisions);
    this.snap = { subdivisions: Number.isFinite(snapSubdivisions) && snapSubdivisions > 0 ? snapSubdivisions : null };
    this.formatData = structuredClone(data.formatData || {});
    this.historyLimit = Number.isInteger(data.historyLimit) && data.historyLimit >= 0 && data.historyLimit <= 10000
      ? data.historyLimit : null;
    this.referenceImages = normalizeReferenceImages(data.referenceImages);
    this.elements = (data.elements || []).map(item => {
      if (item.type === 'shape' || shapeRegistry.has(item.shapeType || item.type) && !['bezier2d', 'bezier3d'].includes(item.type)
        || item.shapeType && !['cube', 'group', 'locator', 'node', 'bezier2d', 'bezier3d'].includes(item.type)) return new Shape(item);
      if (item.type === 'locator') return new Locator(item);
      if (item.type === 'node') return new NodeElement(item);
      if (item.type === 'bezier2d') return new BezierElement(item, 2);
      if (item.type === 'bezier3d') return new BezierElement(item, 3);
      return new Cube(item);
    });
    this.groups = (data.groups || []).map(group => new Group(group));
    this.outliner = [...(data.outliner || [])];
    const legacyControllerUids = new Set();
    for (const group of this.groups) {
      const modifier = getModifier(group, 'symmetry');
      const legacyUid = modifier?._legacyControllerUid;
      const controller = this.elements.find(element => element.uid === legacyUid || element.mirrorControllerFor === group.uid);
      if (modifier && controller) {
        modifier.anchor = { position: vector3(controller.position, group.pivot), rotation: vector3(controller.rotation) };
        legacyControllerUids.add(controller.uid);
      }
      if (modifier) delete modifier._legacyControllerUid;
    }
    this.elements.forEach(element => { if (element.mirrorControllerFor) legacyControllerUids.add(element.uid); });
    if (legacyControllerUids.size) {
      this.elements = this.elements.filter(element => !legacyControllerUids.has(element.uid));
      this.outliner = this.outliner.filter(uidValue => !legacyControllerUids.has(uidValue));
      this.groups.forEach(group => group.children = group.children.filter(uidValue => !legacyControllerUids.has(uidValue)));
    }
    Object.defineProperties(this, {
      _nodeIndex: { value: null, writable: true },
      _nodeIndexElements: { value: null, writable: true },
      _nodeIndexGroups: { value: null, writable: true },
      _nodeIndexElementCount: { value: -1, writable: true },
      _nodeIndexGroupCount: { value: -1, writable: true },
      _parentIndex: { value: null, writable: true },
      _hierarchyRevision: { value: 0, writable: true }
    });
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
    this.invalidateHierarchyIndex();
  }

  invalidateHierarchyIndex() {
    this._parentIndex = null;
    this._hierarchyRevision += 1;
  }

  get hierarchyRevision() { return this._hierarchyRevision; }

  ensureNodeIndex() {
    if (this._nodeIndex
      && this._nodeIndexElements === this.elements
      && this._nodeIndexGroups === this.groups
      && this._nodeIndexElementCount === this.elements.length
      && this._nodeIndexGroupCount === this.groups.length) return this._nodeIndex;
    this._nodeIndex = new Map([...this.elements, ...this.groups].map(node => [node.uid, node]));
    this._nodeIndexElements = this.elements;
    this._nodeIndexGroups = this.groups;
    this._nodeIndexElementCount = this.elements.length;
    this._nodeIndexGroupCount = this.groups.length;
    return this._nodeIndex;
  }

  ensureParentIndex() {
    if (this._parentIndex) return this._parentIndex;
    this._parentIndex = new Map();
    for (const group of this.groups) {
      for (const childUid of group.children) this._parentIndex.set(childUid, group);
    }
    return this._parentIndex;
  }

  getNode(uidValue) {
    return this.ensureNodeIndex().get(uidValue) || null;
  }

  getParentGroup(uidValue) {
    const node = this.getNode(uidValue);
    if (node?.subdivisionOwnerUid) return this.getParentGroup(node.subdivisionOwnerUid);
    return this.ensureParentIndex().get(uidValue) || null;
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
    const parent = parentUid && this.getNode(parentUid);
    (parent ? parent.children : this.outliner).push(element.uid);
    this.invalidateHierarchyIndex();
    refreshAutomaticNodeName(this, element);
  }

  addGroup(group, parentUid = null) {
    if (group.unnamed) group.name = allocateGroupName(this);
    this.groups.push(group);
    const parent = parentUid && this.getNode(parentUid);
    (parent ? parent.children : this.outliner).push(group.uid);
    this.invalidateHierarchyIndex();
    group.children.forEach(childUid => refreshAutomaticNodeName(this, this.getNode(childUid)));
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
    this._nodeIndex = null;
    this.invalidateHierarchyIndex();
  }

  serialize() {
    this.meta.modifiedAt = new Date().toISOString();
    return JSON.stringify({
      ...this,
      elements: this.elements.filter(element => !element.subdivisionOwnerUid)
    }, null, 2);
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

export function bakeProceduralShape(project, shapeUid, generatedCubes = null) {
  const owner = project.getNode(shapeUid);
  if (!owner || owner.type === 'cube' || typeof owner.toCubes !== 'function') return null;
  const generated = generatedCubes || owner.toCubes();
  if (!generated.length) return null;
  const parent = project.getParentGroup(owner.uid);
  const siblings = parent ? parent.children : project.outliner;
  const index = siblings.indexOf(owner.uid);
  if (index < 0) return null;
  const offset = owner.origin || [0, 0, 0];
  const cubes = generated.map((source, cubeIndex) => new Cube({
    ...source,
    uid: uid('cube'),
    name: source.name || `${owner.name}_${cubeIndex + 1}`,
    unnamed: false,
    position: source.position.map((value, axis) => value + offset[axis]),
    pivot: source.pivot.map((value, axis) => value + offset[axis]),
    color: owner.color || source.color,
    shade: owner.shade !== false && source.shade !== false,
    visible: owner.visible !== false && source.visible !== false,
    locked: owner.locked === true || source.locked === true,
    exported: owner.exported !== false && source.exported !== false
  }));
  cubes.forEach(cube => constrainCube(cube, formatRules(project)));
  const group = new Group({
    uid: uid('group'), name: owner.name, unnamed: false,
    pivot: [...(owner.pivot || offset)], rotation: [...(owner.rotation || [0, 0, 0])],
    uvMode: owner.uvMode, uvNormalized: owner.uvNormalized, autoUv: owner.autoUv,
    exported: owner.exported, locked: owner.locked, shade: owner.shade,
    visible: owner.visible, modifiers: owner.modifiers, operators: owner.operators,
    children: cubes.map(cube => cube.uid)
  });
  if (formatRules(project).moddedEntity) { group.uvMode = 'box'; group.autoUv = true; }
  siblings.splice(index, 1, group.uid);
  project.elements = project.elements.filter(element => element.uid !== owner.uid);
  project.elements.push(...cubes);
  project.groups.push(group);
  project.invalidateHierarchyIndex();
  return { group, cubes };
}

export function importBlockbench(data) {
  const firstTexture = (data.textures || [])[0];
  const firstTextureKey = firstTexture?.id !== undefined && firstTexture?.id !== null && String(firstTexture.id) !== ''
    ? firstTexture.id : firstTexture?.uuid || 0;
  const fallbackTexture = firstTexture ? `#${firstTextureKey}` : null;
  const elements = (data.elements || []).filter(item => item.type !== 'mesh').map(item => {
    if (item.type === 'locator') return new Locator({
      uid: item.uuid,
      name: item.name,
      position: item.position || item.origin,
      rotation: item.rotation,
      exported: booleanProperty(item.export, true),
      locked: booleanProperty(item.locked, false),
      visible: booleanProperty(item.visibility ?? item.visible, true)
    });
    if (item.type && item.type !== 'cube') return null;
    const faces = item.faces ? structuredClone(item.faces)
      : fallbackTexture && Array.isArray(item.uv_offset) && item.box_uv !== false
        ? Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map(direction => [direction, {}]))
        : item.faces;
    if (fallbackTexture) for (const face of Object.values(faces || {})) {
      // An omitted texture reference in an external bbmodel means its UVs use
      // the first texture. Explicit null still means a culled face.
      if (face && typeof face === 'object' && face.enabled !== false && face.texture === undefined) face.texture = fallbackTexture;
    }
    return new Cube({
      uid: item.uuid,
      name: item.name,
      position: item.from,
      size: item.to?.map((value, axis) => value - item.from[axis]),
      inflate: item.inflate,
      pivot: item.origin,
      rotation: item.rotation,
      uvMode: item.box_uv === false ? 'face' : 'box',
      uvNormalized: booleanProperty(item.uv_normalized, true),
      uv: item.uv_offset,
      mirrorUv: item.mirror_uv,
      faces,
      autoUv: booleanProperty(item.autouv, false),
      exported: booleanProperty(item.export, true),
      locked: booleanProperty(item.locked, false),
      shade: item.shade,
      color: item.color,
      visible: booleanProperty(item.visibility ?? item.visible, true)
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
      inflate: node.inflate ?? saved.inflate,
      uvMode: (node.box_uv ?? saved.box_uv) === false ? 'face' : 'box',
      uvNormalized: booleanProperty(node.uv_normalized ?? saved.uv_normalized, true),
      autoUv: booleanProperty(node.autouv ?? saved.autouv, false),
      exported: booleanProperty(node.export ?? saved.export, true),
      locked: booleanProperty(node.locked ?? saved.locked, false),
      shade: booleanProperty(node.shade ?? saved.shade, true),
      visible: booleanProperty(node.visibility ?? node.visible ?? saved.visibility ?? saved.visible, true),
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
    formatId: resolveModelFormatId(data.meta?.model_format || 'free'),
    modelType: data.meta?.model_format || 'free',
    textureSize: data.resolution ? [data.resolution.width, data.resolution.height] : [64, 64],
    renderType: data.render_type,
    elements,
    groups,
    outliner,
    meta: { importedFrom: 'bbmodel', sourceModelFormat: data.meta?.model_format || 'free' }
  });
}

function blockbenchCube(cube, offset = [0, 0, 0]) {
  const from = cube.position.map((value, axis) => value + offset[axis]);
  const origin = cube.pivot.map((value, axis) => value + offset[axis]);
  const scaledBoxUv = cube.uvMode === 'box' && Number(cube.uvScale || 1) !== 1;
  const faces = cube.faces ? structuredClone(cube.faces) : scaledBoxUv ? {} : undefined;
  if (scaledBoxUv) {
    const [u, v] = cube.uv || [0, 0];
    const [x, y, z] = cube.size.map(value => {
      const length = Math.abs(Number(value) || 0) * cube.uvScale;
      return length > 0 ? Math.max(1, Math.round(length)) : 0;
    });
    const layout = {
      east: [u, v + z, u + z, v + z + y],
      north: [u + z, v + z, u + z + x, v + z + y],
      west: [u + z + x, v + z, u + z + x + z, v + z + y],
      south: [u + z + x + z, v + z, u + z + x + z + x, v + z + y],
      up: [u + z + x, v + z, u + z, v],
      down: [u + z + x + x, v, u + z + x, v + z]
    };
    for (const [direction, uv] of Object.entries(layout)) if (faces[direction] !== null) {
      faces[direction] = { ...(faces[direction] || {}), uv };
    }
  }
  const hasExplicitFaceUv = Object.values(faces || {}).some(face => Array.isArray(face?.uv) && face.uv.length >= 4);
  for (const face of Object.values(faces || {})) {
    if (face && typeof face === 'object') delete face._cubebricksCulledTexture;
  }
  return {
    name: cube.name,
    // Blockbench box UV cannot represent a normalized layout whose pixel
    // density differs from one model unit per pixel. Preserve such templates
    // losslessly as explicit per-face UV while retaining CubeBricks' mode.
    box_uv: cube.uvMode !== 'face' && !hasExplicitFaceUv,
    uv_normalized: cube.uvNormalized !== false,
    rescale: false,
    locked: cube.locked === true,
    from,
    to: from.map((value, axis) => value + cube.size[axis]),
    autouv: cube.autoUv ? 1 : 0,
    color: blockbenchMarkerIndex(cube.color),
    origin,
    rotation: [...cube.rotation],
    uv_offset: [...(cube.uv || [0, 0])],
    mirror_uv: cube.mirrorUv === true,
    inflate: cube.inflate || 0,
    shade: cube.shade !== false,
    visibility: cube.visible !== false,
    export: cube.exported !== false,
    faces,
    type: 'cube',
    uuid: cube.uid
  };
}

function blockbenchLocator(locator) {
  return {
    name: locator.name,
    locked: locator.locked === true,
    position: [...locator.position],
    rotation: [...(locator.rotation || [0, 0, 0])],
    visibility: locator.visible !== false,
    export: locator.exported !== false,
    type: 'locator',
    uuid: locator.uid
  };
}

function matrixIdentity() { return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; }
function matrixMultiply(left, right) {
  return [0, 1, 2].map(row => [0, 1, 2].map(column =>
    left[row][0] * right[0][column] + left[row][1] * right[1][column] + left[row][2] * right[2][column]));
}
function matrixTranspose(matrix) { return [0, 1, 2].map(row => [0, 1, 2].map(column => matrix[column][row])); }
function matrixVector(matrix, vector) {
  return matrix.map(row => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]);
}
function matrixDeterminant(matrix) {
  return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
}
function rotationMatrix(rotation = [0, 0, 0]) {
  const columns = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(axis => rotateVector(axis, rotation));
  return [0, 1, 2].map(row => columns.map(column => column[row]));
}
function matrixEuler(matrix) {
  const y = Math.asin(Math.max(-1, Math.min(1, -matrix[2][0])));
  const cosine = Math.cos(y);
  const x = Math.abs(cosine) > 1e-7 ? Math.atan2(matrix[2][1], matrix[2][2]) : 0;
  const z = Math.abs(cosine) > 1e-7 ? Math.atan2(matrix[1][0], matrix[0][0]) : Math.atan2(-matrix[0][1], matrix[1][1]);
  return [x, y, z].map(value => Math.round(value * 180 / Math.PI * 10000) / 10000);
}
function transformAround(point, center, matrix) {
  const offset = point.map((value, axis) => value - center[axis]);
  const rotated = matrixVector(matrix, offset);
  return rotated.map((value, axis) => value + center[axis]);
}
function applyGroupChainPoint(point, chain) {
  let transformed = [...point];
  for (const group of [...chain].reverse()) transformed = transformAround(transformed, group.pivot, rotationMatrix(group.rotation));
  return transformed;
}
function groupChainMatrix(chain) {
  return chain.reduce((matrix, group) => matrixMultiply(matrix, rotationMatrix(group.rotation)), matrixIdentity());
}
function symmetryExportAngles(modifier) {
  const count = Math.max(1, Math.min(256, Math.round(Number(modifier.copies) || 1)));
  if (modifier.distribution !== 'range') return Array.from({ length: count }, (_, index) => index * 360 / count);
  const start = Number(modifier.rangeStart) || 0, end = Number(modifier.rangeEnd) || 0;
  if (count === 1) return [start];
  return Array.from({ length: count }, (_, index) => start + (end - start) * index / (count - 1));
}
function rotationYMatrix(degrees) { return rotationMatrix([0, degrees, 0]); }
function symmetryInstanceDefinitions(owner, modifier, frameMatrix) {
  const inverseFrame = matrixTranspose(frameMatrix);
  const worldMatrix = local => matrixMultiply(matrixMultiply(frameMatrix, local), inverseFrame);
  if (modifier.mode === 'axes') {
    const axes = ['x', 'y', 'z'].filter(axis => modifier.axes?.[axis]);
    if (!axes.length) return [{ matrix: matrixIdentity(), name: owner.name }];
    const definitions = [];
    const visit = (index, signs) => {
      if (index < axes.length) {
        visit(index + 1, { ...signs, [axes[index]]: 1 });
        visit(index + 1, { ...signs, [axes[index]]: -1 });
        return;
      }
      const diagonal = [signs.x || 1, signs.y || 1, signs.z || 1];
      const labels = [];
      if (modifier.axes.x) labels.push(diagonal[0] < 0 ? 'left' : 'right');
      if (modifier.axes.y) labels.push(diagonal[1] < 0 ? 'down' : 'up');
      if (modifier.axes.z) labels.push(diagonal[2] < 0 ? 'before' : 'front');
      definitions.push({ matrix: worldMatrix([[diagonal[0], 0, 0], [0, diagonal[1], 0], [0, 0, diagonal[2]]]), name: `${labels.join('_')}_${owner.name}` });
    };
    visit(0, {});
    return definitions;
  }
  const angles = symmetryExportAngles(modifier);
  if (modifier.mode === 'radial') return angles.map((angle, index) => ({
    matrix: worldMatrix(rotationYMatrix(angle)), name: `${owner.name}_${index + 1}`
  }));
  const reflection = [[1, 0, 0], [0, 1, 0], [0, 0, -1]];
  const definitions = [];
  angles.forEach((angle, index) => {
    const turn = rotationYMatrix(angle);
    definitions.push({ matrix: worldMatrix(turn), name: `${owner.name}_${index * 2 + 1}` });
    definitions.push({ matrix: worldMatrix(matrixMultiply(turn, reflection)), name: `${owner.name}_${index * 2 + 2}` });
  });
  return definitions;
}

function matrixIsIdentity(matrix, epsilon = 1e-6) {
  const identity = matrixIdentity();
  return matrix.every((row, rowIndex) => row.every((value, columnIndex) =>
    Math.abs(value - identity[rowIndex][columnIndex]) <= epsilon));
}

function mirrorFaceUvHorizontally(face) {
  if (!face || !Array.isArray(face.uv) || face.uv.length < 4) return face;
  const mirrored = { ...face, uv: [...face.uv] };
  const turns = ((Math.round((Number(face.rotation) || 0) / 90) % 4) + 4) % 4;
  if (turns % 2 === 0) [mirrored.uv[0], mirrored.uv[2]] = [mirrored.uv[2], mirrored.uv[0]];
  else [mirrored.uv[1], mirrored.uv[3]] = [mirrored.uv[3], mirrored.uv[1]];
  return mirrored;
}

function mirrorCubeFacesAcrossLocalX(faces, flipExplicitUv) {
  if (!faces) return faces;
  const source = structuredClone(faces);
  const faceSource = { north: 'north', south: 'south', east: 'west', west: 'east', up: 'up', down: 'down' };
  return Object.fromEntries(Object.entries(faceSource).flatMap(([targetName, sourceName]) => {
    if (!Object.prototype.hasOwnProperty.call(source, sourceName)) return [];
    const face = source[sourceName];
    return [[targetName, flipExplicitUv ? mirrorFaceUvHorizontally(face) : face]];
  }));
}

function modifierOwnerTransform(owner) {
  return {
    pivot: owner.type === 'group' || owner.type === 'cube' || (Array.isArray(owner.pivot) && typeof owner.toCubes === 'function')
      ? owner.pivot
      : owner.origin || owner.position || [0, 0, 0],
    rotation: owner.rotation || [0, 0, 0]
  };
}

function symmetryWorldFrame(project, owner, modifier) {
  const chain = [...project.getGroupChain(owner.uid), modifierOwnerTransform(owner)];
  return {
    center: applyGroupChainPoint(modifier.anchor?.position || modifierOwnerTransform(owner).pivot, chain),
    matrix: matrixMultiply(groupChainMatrix(chain), rotationMatrix(modifier.anchor?.rotation || [0, 0, 0]))
  };
}

function symmetrySourceUids(project, owner) {
  return owner.type === 'group' ? project.getDescendantElementUids(owner.uid) : [owner.uid];
}

function affineIdentity() {
  return { matrix: matrixIdentity(), translation: [0, 0, 0] };
}

function affineAround(matrix, center) {
  const transformedCenter = matrixVector(matrix, center);
  return {
    matrix,
    translation: center.map((value, axis) => value - transformedCenter[axis])
  };
}

// Compose two world-space transforms in evaluation order: `before` is
// already applied to the geometry, then `after` consumes that result.
function affineCompose(after, before) {
  return {
    matrix: matrixMultiply(after.matrix, before.matrix),
    translation: matrixVector(after.matrix, before.translation)
      .map((value, axis) => value + after.translation[axis])
  };
}

function affinePoint(affine, point) {
  return matrixVector(affine.matrix, point).map((value, axis) => value + affine.translation[axis]);
}

function affineIsIdentity(affine, epsilon = 1e-6) {
  return matrixIsIdentity(affine.matrix, epsilon)
    && affine.translation.every(value => Math.abs(value) <= epsilon);
}

function affineKey(affine) {
  const clean = value => Math.abs(value) < 1e-9 ? 0 : Math.round(value * 1e9) / 1e9;
  return JSON.stringify([...affine.matrix.flat(), ...affine.translation].map(clean));
}

function sourceCubeEntries(project, element) {
  if (element.type === 'locator' || element.type === 'node') return [];
  const cubes = typeof element.toCubes === 'function' ? element.toCubes() : element.type === 'cube' ? [element] : [];
  return cubes.map((cube, index) => ({
    cube, index, offset: element.type === 'cube' ? [0, 0, 0] : element.origin || [0, 0, 0],
    ownerRotation: element.type === 'cube' ? [0, 0, 0] : element.rotation || [0, 0, 0],
    ownerOrigin: element.type === 'cube' ? element.pivot : element.pivot || element.origin || [0, 0, 0],
    chain: project.getGroupChain(element.uid)
  }));
}

function cubeVertexKey(source, affine = affineIdentity()) {
  const { cube, offset, ownerRotation, ownerOrigin, chain } = source;
  const inflate = (Number(cube.inflate) || 0) + chain.reduce((sum, group) => sum + (Number(group.inflate) || 0), 0);
  const from = cube.position.map((value, axis) => value + offset[axis] - inflate);
  const to = cube.position.map((value, axis) => value + offset[axis] + cube.size[axis] + inflate);
  const pivot = cube.pivot.map((value, axis) => value + offset[axis]);
  const points = [];
  for (const x of [from[0], to[0]]) for (const y of [from[1], to[1]]) for (const z of [from[2], to[2]]) {
    const point = applyGroupChainPoint(transformAround(transformAround([x, y, z], pivot,
      rotationMatrix(cube.rotation || [0, 0, 0])), ownerOrigin, rotationMatrix(ownerRotation)), chain);
    points.push(affinePoint(affine, point).map(value => Math.round(value * 100000) / 100000).join(','));
  }
  return points.sort().join('|');
}

function originalCubeKeys(project, sourcesByUid = null, excludedUids = null) {
  const keys = new Set();
  for (const element of project.elements) {
    if (excludedUids?.has(element.uid)) continue;
    if (element.visible === false || project.getGroupChain(element.uid).some(group => group.visible === false)) continue;
    const sources = sourceCubeEntries(project, element);
    sourcesByUid?.set(element.uid, sources);
    for (const source of sources) keys.add(cubeVertexKey(source));
  }
  return keys;
}

function variantIgnoresDuplicates(owners, variant) {
  return owners.some(owner => (owner.modifiers || []).some(modifier =>
    variant.modifierUids.includes(modifier.uid) && modifier.ignoreDuplicateCubes));
}

function modifierEvaluationOwners(project, element, terminalOwner = null, includeTerminal = true) {
  const owners = [element, ...project.getGroupChain(element.uid).reverse()];
  if (!terminalOwner) return owners;
  const index = owners.findIndex(owner => owner.uid === terminalOwner.uid);
  if (index < 0) return [];
  return owners.slice(0, index + (includeTerminal ? 1 : 0));
}

function evaluateModifierStack(project, owners, initialVariants = null) {
  let variants = initialVariants || [{ affine: affineIdentity(), modifierUids: [], names: [] }];
  for (const owner of owners) {
    for (const modifier of owner.modifiers || []) {
      if (!modifier?.enabled || modifier.type !== 'symmetry') continue;
      const frame = symmetryWorldFrame(project, owner, modifier);
      const definitions = symmetryInstanceDefinitions(owner, modifier, frame.matrix);
      variants = variants.flatMap(variant => definitions.map(definition => {
        const operation = affineAround(definition.matrix, frame.center);
        return {
          affine: affineCompose(operation, variant.affine),
          modifierUids: [...variant.modifierUids, modifier.uid],
          names: [...variant.names, definition.name]
        };
      }));
    }
  }
  return variants;
}

// Describe render-only symmetry instances without duplicating any Cube or mesh.
// The renderer reuses the source element ranges already uploaded to the GPU and
// applies these world-space matrices at draw time.
export function buildModifierRenderInstances(project) {
  if (![...project.elements, ...project.groups].some(owner =>
    owner.modifiers?.some(modifier => modifier?.enabled && modifier.type === 'symmetry'))) return [];
  const byTransform = new Map();
  const sourcesByUid = new Map();
  const deduplicate = [...project.elements, ...project.groups].some(owner =>
    owner.modifiers?.some(modifier => modifier?.enabled && modifier.type === 'symmetry' && modifier.ignoreDuplicateCubes));
  const occupied = deduplicate ? originalCubeKeys(project, sourcesByUid) : null;
  for (const element of project.elements) {
    const owners = modifierEvaluationOwners(project, element);
    if (element.visible === false || owners.some(owner => owner.visible === false)) continue;
    const variants = evaluateModifierStack(project, owners);
    for (const variant of variants) {
      if (affineIsIdentity(variant.affine)) continue;
      const key = affineKey(variant.affine);
      let instance = byTransform.get(key);
      if (!instance) {
        instance = {
          key,
          groupUid: owners.at(-1)?.uid || element.uid,
          modifierUid: variant.modifierUids.join(':'),
          modifierUids: [...variant.modifierUids],
          sourceUids: [],
          cubeIndices: {},
          matrix: variant.affine.matrix.map(row => [...row]),
          translation: [...variant.affine.translation],
          reflected: matrixDeterminant(variant.affine.matrix) < 0
        };
        byTransform.set(key, instance);
      }
      let sources = sourcesByUid.get(element.uid);
      if (!sources) {
        sources = sourceCubeEntries(project, element);
        sourcesByUid.set(element.uid, sources);
      }
      const ignoreDuplicates = variantIgnoresDuplicates(owners, variant);
      const include = sources.filter(source => {
        if (!occupied) return true;
        const vertexKey = cubeVertexKey(source, variant.affine);
        if (ignoreDuplicates && occupied.has(vertexKey)) return false;
        occupied.add(vertexKey);
        return true;
      }).map(source => source.index);
      if (!sources.length || include.length) {
        if (!instance.sourceUids.includes(element.uid)) instance.sourceUids.push(element.uid);
        if (sources.length && occupied) instance.cubeIndices[element.uid] = [...new Set([
          ...(instance.cubeIndices[element.uid] || []), ...include
        ])];
      }
    }
  }
  return [...byTransform.values()];
}

function inverseGroupChainPoint(point, chain) {
  let transformed = [...point];
  for (const group of chain) transformed = transformAround(transformed, group.pivot, matrixTranspose(rotationMatrix(group.rotation || [0, 0, 0])));
  return transformed;
}

function bakedCubeFromWorld(source, affine, parentChain) {
  const { cube, offset, ownerRotation, ownerOrigin, chain } = source;
  const baseFrom = cube.position.map((value, axis) => value + offset[axis]);
  const baseTo = baseFrom.map((value, axis) => value + cube.size[axis]);
  const basePivot = cube.pivot.map((value, axis) => value + offset[axis]);
  const ownerMatrix = rotationMatrix(ownerRotation);
  const ownedPivot = transformAround(basePivot, ownerOrigin, ownerMatrix);
  const worldPivot = applyGroupChainPoint(ownedPivot, chain);
  const worldOrientation = matrixMultiply(matrixMultiply(groupChainMatrix(chain), ownerMatrix), rotationMatrix(cube.rotation));
  const mirrored = matrixDeterminant(affine.matrix) < 0;
  const handednessFix = mirrored ? [[-1, 0, 0], [0, 1, 0], [0, 0, 1]] : matrixIdentity();
  const nextWorldPivot = affinePoint(affine, worldPivot);
  const localPivot = inverseGroupChainPoint(nextWorldPivot, parentChain);
  const parentMatrix = groupChainMatrix(parentChain);
  const localOrientation = matrixMultiply(matrixTranspose(parentMatrix),
    matrixMultiply(matrixMultiply(affine.matrix, worldOrientation), handednessFix));
  const fromOffset = matrixVector(handednessFix, baseFrom.map((value, axis) => value - basePivot[axis]));
  const toOffset = matrixVector(handednessFix, baseTo.map((value, axis) => value - basePivot[axis]));
  const from = localPivot.map((value, axis) => value + Math.min(fromOffset[axis], toOffset[axis]));
  const to = localPivot.map((value, axis) => value + Math.max(fromOffset[axis], toOffset[axis]));
  const faces = mirrored ? mirrorCubeFacesAcrossLocalX(cube.faces, cube.uvMode === 'face') : cloneData(cube.faces);
  return new Cube({
    ...cloneData(cube), uid: undefined,
    name: cube.name,
    position: from,
    size: to.map((value, axis) => value - from[axis]),
    pivot: localPivot,
    rotation: matrixEuler(localOrientation),
    faces,
    mirrorUv: mirrored && cube.uvMode !== 'face' ? !Boolean(cube.mirrorUv) : cube.mirrorUv,
    modifiers: []
  });
}

export function bakeModifier(project, owner, modifierUid) {
  const modifier = owner?.modifiers?.find(entry => entry.uid === modifierUid);
  if (!project || !owner || !modifier?.enabled || modifier.type !== 'symmetry') return null;
  const parent = project.getParentGroup(owner.uid);
  const container = parent ? parent.children : project.outliner;
  const insertionIndex = Math.max(0, container.indexOf(owner.uid));
  const parentChain = project.getGroupChain(owner.uid);
  const sourceUids = symmetrySourceUids(project, owner);
  const occupied = modifier.ignoreDuplicateCubes || sourceUids.some(uidValue =>
    project.getNode(uidValue)?.modifiers?.some(entry => entry.enabled && entry.ignoreDuplicateCubes))
    ? originalCubeKeys(project, null, new Set(sourceUids)) : null;
  const selectedVariants = evaluateModifierStack(project, [{ ...owner, modifiers: [modifier] }]);
  const generatedElements = [];
  const generatedGroups = [];
  const frame = symmetryWorldFrame(project, owner, modifier);
  const reflectedLocalAxis = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const instanceGroups = selectedVariants.map((selectedVariant, instanceIndex) => {
    const affine = selectedVariant.affine;
    const branchName = selectedVariant.names.at(-1) || `${owner.name}_${instanceIndex + 1}`;
    const descendantName = name => {
      const ownerSuffix = `_${owner.name}`;
      if (modifier.mode === 'axes' && branchName.endsWith(ownerSuffix))
        return `${branchName.slice(0, -ownerSuffix.length)}_${name}`;
      const ownerPrefix = `${owner.name}_`;
      if (branchName.startsWith(ownerPrefix)) return `${name}_${branchName.slice(ownerPrefix.length)}`;
      return name;
    };
    const instanceGroup = new Group({
      name: branchName,
      pivot: inverseGroupChainPoint(frame.center, parentChain),
      children: [],
      visible: owner.visible,
      locked: owner.locked,
      exported: owner.exported,
      shade: owner.shade,
      autoUv: owner.autoUv,
      uvMode: owner.uvMode,
      uvNormalized: owner.uvNormalized
    });
    const visit = (sourceUid, destination, destinationChain) => {
      const element = project.getNode(sourceUid);
      if (!element) return;
      if (element.type === 'group') {
        const originalChain = project.getGroupChain(element.uid);
        const worldPivot = applyGroupChainPoint(element.pivot, originalChain);
        const mirrored = matrixDeterminant(affine.matrix) < 0;
        const handednessFix = mirrored ? reflectedLocalAxis : matrixIdentity();
        const originalOrientation = groupChainMatrix([...originalChain, element]);
        const localOrientation = matrixMultiply(matrixTranspose(groupChainMatrix(destinationChain)),
          matrixMultiply(matrixMultiply(affine.matrix, originalOrientation), handednessFix));
        const group = new Group({
          ...cloneData(element), uid: undefined, unnamed: false,
          name: descendantName(element.name),
          pivot: inverseGroupChainPoint(affinePoint(affine, worldPivot), destinationChain),
          rotation: matrixEuler(localOrientation),
          children: [], modifiers: []
        });
        if (element._bakedSymmetryBranch) Object.defineProperty(group, '_bakedSymmetryBranch', { value: true });
        generatedGroups.push(group);
        destination.children.push(group.uid);
        element.children.forEach(childUid => visit(childUid, group, [...destinationChain, group]));
        return;
      }
      const innerVariants = evaluateModifierStack(project, modifierEvaluationOwners(project, element, owner, false));
      const chain = project.getGroupChain(element.uid);
      if (element.type === 'locator' || element.type === 'node') {
        for (const inner of innerVariants) {
          const combined = affineCompose(affine, inner.affine);
          const basePosition = applyGroupChainPoint(element.position, chain);
          const worldOrientation = matrixMultiply(groupChainMatrix(chain), rotationMatrix(element.rotation));
          const mirrored = matrixDeterminant(combined.matrix) < 0;
          const handednessFix = mirrored ? reflectedLocalAxis : matrixIdentity();
          const localPosition = inverseGroupChainPoint(affinePoint(combined, basePosition), destinationChain);
          const localOrientation = matrixMultiply(matrixTranspose(groupChainMatrix(destinationChain)),
            matrixMultiply(matrixMultiply(combined.matrix, worldOrientation), handednessFix));
          const locator = new Locator({
            name: element.name,
            position: localPosition,
            rotation: matrixEuler(localOrientation),
            exported: element.exported,
            locked: element.locked,
            visible: element.visible
          });
          generatedElements.push(locator);
          destination.children.push(locator.uid);
        }
        return;
      }
      const sources = typeof element.toCubes === 'function'
        ? element.toCubes().map(cube => ({
            cube,
            offset: element.origin || [0, 0, 0],
            ownerRotation: element.rotation || [0, 0, 0],
            ownerOrigin: element.pivot || element.origin || [0, 0, 0],
            chain
          }))
        : element.type === 'cube'
          ? [{ cube: element, offset: [0, 0, 0], ownerRotation: [0, 0, 0], ownerOrigin: element.pivot, chain }]
          : [];
      for (const inner of innerVariants) {
        const combined = affineCompose(affine, inner.affine);
        for (const source of sources) {
          const vertexKey = occupied ? cubeVertexKey(source, combined) : null;
          if (occupied && (modifier.ignoreDuplicateCubes
            || variantIgnoresDuplicates(modifierEvaluationOwners(project, element, owner, false), inner))
            && !affineIsIdentity(combined) && occupied.has(vertexKey)) continue;
          if (occupied) occupied.add(vertexKey);
          const cube = bakedCubeFromWorld(source, combined, destinationChain);
          generatedElements.push(cube);
          destination.children.push(cube.uid);
        }
      }
    };
    const sourceChildren = owner.type === 'group' ? owner.children : [owner.uid];
    sourceChildren.forEach(childUid => visit(childUid, instanceGroup, [...parentChain, instanceGroup]));
    Object.defineProperty(instanceGroup, '_bakedSymmetryBranch', { value: true });
    return instanceGroup;
  });
  const remainingModifiers = (owner.modifiers || []).filter(entry => entry.uid !== modifierUid).map(cloneData);
  const bakedRoot = new Group({
    name: owner.name,
    pivot: inverseGroupChainPoint(frame.center, parentChain),
    children: instanceGroups.map(group => group.uid),
    visible: owner.visible,
    locked: owner.locked,
    exported: owner.exported,
    shade: owner.shade,
    autoUv: owner.autoUv,
    uvMode: owner.uvMode,
    uvNormalized: owner.uvNormalized,
    inflate: owner.type === 'group' ? owner.inflate : 0,
    modifiers: remainingModifiers
  });
  project.removeNode(owner.uid);
  project.elements.push(...generatedElements);
  project.groups.push(bakedRoot, ...instanceGroups, ...generatedGroups);
  const targetContainer = parent ? parent.children : project.outliner;
  targetContainer.splice(Math.min(insertionIndex, targetContainer.length), 0, bakedRoot.uid);
  project.invalidateHierarchyIndex();
  return {
    rootUid: bakedRoot.uid,
    elementUids: generatedElements.map(element => element.uid),
    groupUids: [bakedRoot.uid, ...instanceGroups.map(group => group.uid), ...generatedGroups.map(group => group.uid)]
  };
}

// Compatibility alias for extensions built against early CubeBricks previews.
export const buildGroupMirrorRenderInstances = buildModifierRenderInstances;

function bakeSymmetryForExport(sourceProject) {
  if (![...sourceProject.elements, ...sourceProject.groups].some(owner =>
    owner.modifiers?.some(modifier => modifier?.enabled && modifier.type === 'symmetry'))) return sourceProject;
  // Export uses the same baking path as the editor, but only on a detached
  // project. No generated group or cube is written back to the open document.
  const project = new CubeBricksProject(structuredClone({ ...sourceProject, referenceImages: {} }));
  while (true) {
    const owner = [...project.elements, ...project.groups]
      .filter(node => node.modifiers?.some(modifier => modifier?.enabled && modifier.type === 'symmetry'))
      .sort((left, right) => project.getGroupChain(right.uid).length - project.getGroupChain(left.uid).length)[0];
    if (!owner) break;
    const modifier = owner.modifiers.find(entry => entry?.enabled && entry.type === 'symmetry');
    const hasSymmetryAncestor = project.getGroupChain(owner.uid).some(group =>
      group.modifiers?.some(entry => entry?.enabled && entry.type === 'symmetry'));
    const result = bakeModifier(project, owner, modifier.uid);
    if (!result) break;
    const root = project.getNode(result.rootUid);
    if (hasSymmetryAncestor || modifier.wrapParent !== false ||
      root.modifiers.some(entry => entry?.enabled && entry.type === 'symmetry')) continue;
    // A zero-rotation baking container is useful in the editor, but an
    // unwrapped bbmodel should expose its named symmetry branches directly.
    const parent = project.getParentGroup(root.uid);
    const container = parent ? parent.children : project.outliner;
    const index = container.indexOf(root.uid);
    if (index < 0) continue;
    for (const childUid of root.children) {
      const child = project.getNode(childUid);
      if (child?.type === 'group') child.inflate += root.inflate;
    }
    container.splice(index, 1, ...root.children);
    project.groups = project.groups.filter(group => group.uid !== root.uid);
    project.invalidateHierarchyIndex();
  }
  // Repeated symmetry produces a Cartesian product. The intermediate branch
  // containers have no rotation, so promote their already-transformed child
  // branches instead of exporting an extra level for each modifier.
  const redundantBranches = new Set();
  const collapseBranches = children => {
    for (let index = 0; index < children.length; index++) {
      const group = project.getNode(children[index]);
      if (group?.type !== 'group') continue;
      collapseBranches(group.children);
      if (!group._bakedSymmetryBranch || !group.children.length ||
        group.rotation.some(value => Math.abs(value) > 1e-6) || Math.abs(group.inflate) > 1e-9 ||
        !group.children.every(uidValue => project.getNode(uidValue)?._bakedSymmetryBranch)) continue;
      redundantBranches.add(group.uid);
      children.splice(index, 1, ...group.children);
      index += group.children.length - 1;
    }
  };
  collapseBranches(project.outliner);
  if (redundantBranches.size) {
    project.groups = project.groups.filter(group => !redundantBranches.has(group.uid));
    project.invalidateHierarchyIndex();
  }
  return project;
}

export function exportBlockbench(project, textureAssets = []) {
  project = bakeSymmetryForExport(project);
  const elements = [];
  const exportedElementIds = new Set();
  const pushElement = element => {
    if (exportedElementIds.has(element.uuid)) return;
    exportedElementIds.add(element.uuid);
    elements.push(element);
  };
  const proceduralGroup = element => {
    const generated = element.toCubes().map(cube => constrainCube(cube, formatRules(project)));
    const ancestors = project.getGroupChain(element.uid);
    const children = generated.map((cube, index) => {
      cube.uid = `${element.uid}_cube_${index + 1}`;
      const exported = blockbenchCube(cube, element.origin || [0, 0, 0]);
      exported.inflate += ancestors.reduce((total, group) => total + (Number(group.inflate) || 0), 0);
      exported.shade = exported.shade && ancestors.every(group => group.shade !== false);
      exported.visibility = exported.visibility && ancestors.every(group => group.visible !== false);
      pushElement(exported);
      return cube.uid;
    });
    return {
      name: element.name,
      origin: [...(element.pivot || element.origin || [0, 0, 0])],
      rotation: [...(element.rotation || [0, 0, 0])],
      color: 0,
      uuid: `${element.uid}_group`,
      export: element.exported !== false,
      locked: element.locked === true,
      visibility: element.visible !== false,
      autouv: element.autoUv ? 1 : 0,
      box_uv: element.uvMode !== 'face',
      uv_normalized: element.uvNormalized !== false,
      shade: element.shade !== false,
      isOpen: true,
      children
    };
  };
  const visit = uidValue => {
    const node = project.getNode(uidValue);
    if (!node) return null;
    if (node.type === 'group') return {
      name: node.name,
      origin: [...node.pivot],
      rotation: [...(node.rotation || [0, 0, 0])],
      color: 0,
      uuid: node.uid,
      export: node.exported !== false,
      locked: node.locked === true,
      visibility: node.visible !== false,
      autouv: node.autoUv ? 1 : 0,
      box_uv: node.uvMode !== 'face',
      uv_normalized: node.uvNormalized !== false,
      shade: node.shade !== false,
      isOpen: true,
      children: node.children.flatMap(childUid => {
        const child = visit(childUid);
        return Array.isArray(child) ? child : child ? [child] : [];
      })
    };
    if (node.type === 'cube') {
      const exported = blockbenchCube(node);
      const ancestors = project.getGroupChain(node.uid);
      exported.inflate += ancestors.reduce((total, group) => total + (Number(group.inflate) || 0), 0);
      exported.shade = exported.shade && ancestors.every(group => group.shade !== false);
      exported.visibility = exported.visibility && ancestors.every(group => group.visible !== false);
      pushElement(exported);
      return node.uid;
    }
    if (node.type === 'locator' || node.type === 'node') {
      const locator = node.type === 'locator' ? node : new Locator({
        uid: node.uid, name: node.name, position: node.position, rotation: node.rotation,
        exported: node.exported, locked: node.locked, visible: node.visible
      });
      pushElement(blockbenchLocator(locator));
      return node.uid;
    }
    if (typeof node.toCubes === 'function') return proceduralGroup(node);
    return null;
  };
  const textures = textureAssets.map((texture, index) => ({
    path: texture.path || '',
    name: texture.name || `texture_${index + 1}.png`,
    folder: texture.folder || '',
    namespace: texture.namespace || '',
    id: texture.id || String(index),
    particle: texture.particle === true,
    render_mode: texture.renderMode || 'default',
    visible: texture.visible !== false,
    mode: 'bitmap',
    saved: true,
    uuid: texture.uuid || texture._uid || `texture_${index + 1}`,
    source: texture.source,
    relative_path: texture.relativePath,
    uv_width: texture.uvWidth || project.textureSize[0],
    uv_height: texture.uvHeight || project.textureSize[1],
    use_as_default: texture.useAsDefault === true
  }));
  return {
    meta: {
      format_version: '4.10',
      model_format: project.modelType || 'free',
      box_uv: project.uvMode === 'box'
    },
    name: project.name,
    model_identifier: '',
    visible_box: [1, 1, 0],
    variable_placeholders: '',
    variable_placeholder_buttons: [],
    timeline_setups: [],
    unhandled_root_fields: {},
    resolution: { width: project.textureSize[0], height: project.textureSize[1] },
    render_type: project.renderType,
    elements,
    outliner: project.outliner.flatMap(uidValue => {
      const node = visit(uidValue);
      return Array.isArray(node) ? node : node ? [node] : [];
    }),
    textures
  };
}
