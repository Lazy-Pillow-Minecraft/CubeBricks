import { ModelFormatId, modelFormatRegistry, resolveModelFormatId } from './config/model-formats.js';

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
    for (const field of ['name', 'uvMode', 'uv', 'mirrorUv', 'faces', 'autoUv', 'exported', 'locked', 'shade', 'visible', 'color']) {
      if (edit[field] !== undefined) cube[field] = cloneData(edit[field]);
    }
    return cube;
  });
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
    this.autoUv = booleanProperty(data.autoUv ?? data.autouv, !hasAssignedTexture(this.faces));
    this.exported = booleanProperty(data.exported ?? data.export, true);
    this.locked = booleanProperty(data.locked, false);
    this.shade = data.shade ?? true;
    this.visible = booleanProperty(data.visible ?? data.visibility, true);
    this.color = data.color || '#9ac24d';
  }
}

export class Shape {
  constructor(data = {}) {
    this.type = 'polygon_prism';
    this.uid = data.uid || uid('shape');
    this.name = data.name || 'shape';
    this.shapeType = 'polygon_prism';
    this.parameters = {
      radius: 4, height: 8, sides: 8, cubeSize: 1,
      innerRadiusEnabled: false, innerRadiusMode: 'radius', innerRadius: 2,
      snapMode: 'cube',
      ...(data.parameters || {})
    };
    this.origin = data.origin || [0, 0, 0];
    this.rotation = data.rotation || [0, 0, 0];
    this.autoUv = booleanProperty(data.autoUv ?? data.autouv, true);
    this.exported = booleanProperty(data.exported ?? data.export, true);
    this.locked = booleanProperty(data.locked, false);
    this.shade = data.shade ?? true;
    this.visible = booleanProperty(data.visible ?? data.visibility, true);
    this.color = data.color || '#d6b35b';
    this.preserveSubdivisionEdits = booleanProperty(data.preserveSubdivisionEdits, false);
    this.subdivisionEdits = cloneData(data.subdivisionEdits || {});
  }

  toBaseCubes() {
    const radius = Math.max(.001, Number(this.parameters.radius) || 0);
    const requestedHeight = Math.max(0, Number(this.parameters.height) || 0);
    const sides = Math.max(3, Math.round(Number(this.parameters.sides) || 3));
    const halfTurn = Math.PI / sides;
    const hollow = this.parameters.innerRadiusEnabled === true;
    const outerApothem = radius * Math.cos(halfTurn);
    const edgeLength = 2 * radius * Math.sin(halfTurn);
    const innerValue = Math.max(0, Number(this.parameters.innerRadius) || 0);
    const height = requestedHeight;
    const innerRadius = !hollow ? 0
      : this.parameters.innerRadiusMode === 'depth'
        ? Math.max(0, outerApothem - Math.min(outerApothem, innerValue))
        : Math.max(0, Math.min(outerApothem - .001, innerValue));
    const mergedOpposites = !hollow && sides % 2 === 0;
    const cubeCount = mergedOpposites ? sides / 2 : sides;
    return Array.from({ length: cubeCount }, (_, index) => {
      // The normal of a regular-polygon edge points from the centre toward
      // the midpoint of that edge. Solid columns reach the centre; opposite
      // edges of an even polygon can therefore share one continuous cube.
      const angle = Math.PI / 2 + (index + .5) * Math.PI * 2 / sides;
      const radial = [Math.cos(angle), Math.sin(angle)];
      const startRadius = mergedOpposites ? -outerApothem : innerRadius;
      const endRadius = outerApothem;
      const cubeLength = endRadius - startRadius;
      const midpointRadius = (startRadius + endRadius) / 2;
      const midpoint = radial.map(value => value * midpointRadius);
      const yaw = Math.atan2(radial[0], radial[1]) * 180 / Math.PI;
      return new Cube({
        name: `${this.name}_${index + 1}`,
        position: [midpoint[0] - edgeLength / 2, 0, midpoint[1] - cubeLength / 2],
        size: [edgeLength, height, cubeLength],
        pivot: [midpoint[0], height / 2, midpoint[1]],
        rotation: [0, yaw, 0],
        autoUv: this.autoUv,
        exported: this.exported,
        locked: this.locked,
        shade: this.shade,
        color: this.color
      });
    });
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
    this.name = data.name || 'node';
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
    this.name = data.name || (dimension === 2 ? 'bezier_2d' : 'bezier_3d');
    this.dimension = dimension;
    this.origin = vector3(data.origin);
    this.rotation = vector3(data.rotation);
    const defaults = dimension === 2
      ? [{ position: [-4, 0, 0] }, { position: [4, 0, 0] }]
      : [{ position: [-4, 0, 0] }, { position: [4, 4, 2] }];
    this.nodes = (data.nodes?.length >= 2 ? data.nodes : defaults).map(node => new CurveNode(node, dimension === 2));
    this.parameters = {
      thickness: 1,
      segmentationMode: 'distance',
      segmentLength: 1,
      angleStep: 10,
      ...(data.parameters || {})
    };
    this.autoUv = booleanProperty(data.autoUv ?? data.autouv, true);
    this.exported = booleanProperty(data.exported ?? data.export, true);
    this.locked = booleanProperty(data.locked, false);
    this.shade = booleanProperty(data.shade, true);
    this.visible = booleanProperty(data.visible ?? data.visibility, true);
    this.color = data.color || (dimension === 2 ? '#d7b25b' : '#78b6d7');
    this.preserveSubdivisionEdits = booleanProperty(data.preserveSubdivisionEdits, false);
    this.subdivisionEdits = cloneData(data.subdivisionEdits || {});
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
    const points = this.sampleCurve();
    const thickness = Math.max(.01, Number(this.parameters.thickness) || 1);
    const segments = [];
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index].point, end = points[index + 1].point;
      const delta = end.map((value, axis) => value - start[axis]);
      const length = vectorLength(delta);
      if (length < 1e-6) continue;
      segments.push({ start, end, length, direction: delta.map(value => value / length) });
    }
    const jointExtension = (left, right) => {
      if (!left || !right) return 0;
      const cosine = Math.max(-1, Math.min(1,
        left.direction.reduce((sum, value, axis) => sum + value * right.direction[axis], 0)));
      const turn = Math.acos(cosine);
      if (turn < 1e-5) return 0;
      // Butt-ended cube columns leave a wedge on the outside of a bend. A
      // square-stroke miter closes it by extending both neighbours according
      // to their half-width and half of the turning angle. Cap pathological
      // near-reversals so an accidental cusp cannot create a huge cube.
      return Math.min(thickness * 4, thickness * .5 * Math.tan(Math.min(turn, Math.PI - .02) / 2));
    };
    const cubes = [];
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const { start, end, direction } = segment;
      const startExtension = jointExtension(segments[index - 1], segment);
      const endExtension = jointExtension(segment, segments[index + 1]);
      const length = segment.length + startExtension + endExtension;
      const midpoint = start.map((value, axis) => (value + end[axis]) / 2
        + direction[axis] * (endExtension - startExtension) / 2);
      const roll = (points[index].roll + points[index + 1].roll) / 2;
      const rotation = directionFrameEuler(direction, roll);
      cubes.push(new Cube({
        name: `${this.name}_${index + 1}`,
        position: [midpoint[0] - thickness / 2, midpoint[1] - thickness / 2, midpoint[2] - length / 2],
        size: [thickness, thickness, length],
        pivot: midpoint,
        rotation,
        autoUv: this.autoUv,
        exported: this.exported,
        locked: this.locked,
        shade: this.shade,
        color: this.color
      }));
    }
    return cubes;
  }


  toCubes() { return applySubdivisionEdits(this.toBaseCubes(), this); }
}

export class Locator {
  constructor(data = {}) {
    this.type = 'locator';
    this.uid = data.uid || data.uuid || uid('locator');
    this.name = data.name || 'locator';
    this.position = data.position || data.origin || [0, 0, 0];
    this.rotation = data.rotation || [0, 0, 0];
    this.exported = booleanProperty(data.exported ?? data.export, true);
    this.locked = booleanProperty(data.locked, false);
    this.visible = booleanProperty(data.visible ?? data.visibility, true);
  }
}

export class Group {
  constructor(data = {}) {
    this.type = 'group';
    this.uid = data.uid || data.uuid || uid('group');
    this.name = data.name || 'group';
    this.pivot = data.pivot || data.origin || [0, 0, 0];
    this.rotation = data.rotation || [0, 0, 0];
    this.inflate = Number(data.inflate) || 0;
    this.autoUv = booleanProperty(data.autoUv ?? data.autouv, true);
    this.exported = booleanProperty(data.exported ?? data.export, true);
    this.locked = booleanProperty(data.locked, false);
    this.shade = booleanProperty(data.shade, true);
    this.visible = booleanProperty(data.visible ?? data.visibility, true);
    this.children = [...(data.children || [])];
    const mirror = data.mirror || {};
    const mode = ['axes', 'radial', 'mandala'].includes(mirror.mode) ? mirror.mode : 'axes';
    const distribution = mirror.distribution === 'range' ? 'range' : 'full';
    this.mirror = {
      enabled: booleanProperty(mirror.enabled, false),
      mode,
      axes: {
        x: booleanProperty(mirror.axes?.x, false),
        y: booleanProperty(mirror.axes?.y, false),
        z: booleanProperty(mirror.axes?.z, false)
      },
      copies: Math.max(1, Math.round(Number(mirror.copies) || 3)),
      distribution,
      rangeStart: Number.isFinite(Number(mirror.rangeStart)) ? Number(mirror.rangeStart) : 0,
      rangeEnd: Number.isFinite(Number(mirror.rangeEnd)) ? Number(mirror.rangeEnd) : 180,
      wrapParent: booleanProperty(mirror.wrapParent, true),
      controllerUid: mirror.controllerUid || null
    };
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
  } else if (node.origin) node.origin = node.origin.map((value, axis) => value + delta[axis]);
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
    this.elements = (data.elements || []).map(item => {
      if (item.type === 'shape' || item.type === 'polygon_prism') return new Shape(item);
      if (item.type === 'locator') return new Locator(item);
      if (item.type === 'node') return new NodeElement(item);
      if (item.type === 'bezier2d') return new BezierElement(item, 2);
      if (item.type === 'bezier3d') return new BezierElement(item, 3);
      return new Cube(item);
    });
    this.groups = (data.groups || []).map(group => new Group(group));
    this.outliner = [...(data.outliner || [])];
    for (const group of this.groups) {
      if (!group.mirror?.enabled) continue;
      let controller = this.elements.find(element => element.uid === group.mirror.controllerUid
        || element.mirrorControllerFor === group.uid);
      if (!controller) {
        controller = new NodeElement({
          name: `${group.name}_mirror_axis`,
          position: [...group.pivot],
          rotation: [0, 0, 0],
          exported: false,
          mirrorControllerFor: group.uid
        });
        this.elements.push(controller);
      }
      controller.mirrorControllerFor = group.uid;
      controller.exported = false;
      group.mirror.controllerUid = controller.uid;
      if (!group.children.includes(controller.uid)) group.children.push(controller.uid);
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
  }

  addGroup(group, parentUid = null) {
    this.groups.push(group);
    const parent = parentUid && this.getNode(parentUid);
    (parent ? parent.children : this.outliner).push(group.uid);
    this.invalidateHierarchyIndex();
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

export function importBlockbench(data) {
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
      autoUv: booleanProperty(item.autouv, false),
      exported: booleanProperty(item.export, true),
      locked: booleanProperty(item.locked, false),
      shade: item.shade,
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
  return {
    name: cube.name,
    box_uv: cube.uvMode !== 'face',
    rescale: false,
    locked: cube.locked === true,
    from,
    to: from.map((value, axis) => value + cube.size[axis]),
    autouv: cube.autoUv ? 1 : 0,
    color: 0,
    origin,
    rotation: [...cube.rotation],
    uv_offset: [...(cube.uv || [0, 0])],
    mirror_uv: cube.mirrorUv === true,
    inflate: cube.inflate || 0,
    shade: cube.shade !== false,
    visibility: cube.visible !== false,
    export: cube.exported !== false,
    faces: cube.faces ? structuredClone(cube.faces) : undefined,
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
function relativeMirrorChain(project, uidValue, mirrorGroupUid) {
  const chain = project.getGroupChain(uidValue);
  const index = chain.findIndex(group => group.uid === mirrorGroupUid);
  return index < 0 ? chain : chain.slice(index);
}
function groupMirrorExportAngles(mirror) {
  const count = Math.max(1, Math.min(256, Math.round(Number(mirror.copies) || 1)));
  if (mirror.distribution !== 'range') return Array.from({ length: count }, (_, index) => index * 360 / count);
  const start = Number(mirror.rangeStart) || 0, end = Number(mirror.rangeEnd) || 0;
  if (count === 1) return [start];
  return Array.from({ length: count }, (_, index) => start + (end - start) * index / (count - 1));
}
function rotationYMatrix(degrees) { return rotationMatrix([0, degrees, 0]); }
function mirrorInstanceDefinitions(group, frameMatrix) {
  const mirror = group.mirror;
  const inverseFrame = matrixTranspose(frameMatrix);
  const worldMatrix = local => matrixMultiply(matrixMultiply(frameMatrix, local), inverseFrame);
  if (mirror.mode === 'axes') {
    const axes = ['x', 'y', 'z'].filter(axis => mirror.axes?.[axis]);
    if (!axes.length) return [{ matrix: matrixIdentity(), name: group.name }];
    const definitions = [];
    const visit = (index, signs) => {
      if (index < axes.length) {
        visit(index + 1, { ...signs, [axes[index]]: 1 });
        visit(index + 1, { ...signs, [axes[index]]: -1 });
        return;
      }
      const diagonal = [signs.x || 1, signs.y || 1, signs.z || 1];
      const labels = [];
      if (mirror.axes.x) labels.push(diagonal[0] < 0 ? 'left' : 'right');
      if (mirror.axes.y) labels.push(diagonal[1] < 0 ? 'down' : 'up');
      if (mirror.axes.z) labels.push(diagonal[2] < 0 ? 'before' : 'front');
      definitions.push({ matrix: worldMatrix([[diagonal[0], 0, 0], [0, diagonal[1], 0], [0, 0, diagonal[2]]]), name: `${labels.join('_')}_${group.name}` });
    };
    visit(0, {});
    return definitions;
  }
  const angles = groupMirrorExportAngles(mirror);
  if (mirror.mode === 'radial') return angles.map((angle, index) => ({
    matrix: worldMatrix(rotationYMatrix(angle)), name: `${group.name}_${index + 1}`
  }));
  const reflection = [[1, 0, 0], [0, 1, 0], [0, 0, -1]];
  const definitions = [];
  angles.forEach((angle, index) => {
    const turn = rotationYMatrix(angle);
    definitions.push({ matrix: worldMatrix(turn), name: `${group.name}_${index * 2 + 1}` });
    definitions.push({ matrix: worldMatrix(matrixMultiply(turn, reflection)), name: `${group.name}_${index * 2 + 2}` });
  });
  return definitions;
}

function matrixIsIdentity(matrix, epsilon = 1e-6) {
  const identity = matrixIdentity();
  return matrix.every((row, rowIndex) => row.every((value, columnIndex) =>
    Math.abs(value - identity[rowIndex][columnIndex]) <= epsilon));
}

// Describe render-only mirror instances without duplicating any Cube or mesh.
// The renderer reuses the source element ranges already uploaded to the GPU and
// applies these world-space matrices at draw time.
export function buildGroupMirrorRenderInstances(project) {
  const renderInstances = [];
  for (const group of project.groups) {
    if (!group.mirror?.enabled || group.visible === false) continue;
    const controller = project.getNode(group.mirror.controllerUid);
    if (!controller || controller.type !== 'node') continue;
    const controllerChain = project.getGroupChain(controller.uid);
    const frameMatrix = matrixMultiply(groupChainMatrix(controllerChain), rotationMatrix(controller.rotation));
    const center = applyGroupChainPoint(controller.position, controllerChain);
    const instances = mirrorInstanceDefinitions(group, frameMatrix)
      .filter(instance => !matrixIsIdentity(instance.matrix));
    if (!instances.length) continue;
    const sourceUids = project.getDescendantElementUids(group.uid)
      .filter(uidValue => uidValue !== controller.uid && !project.getNode(uidValue)?.mirrorControllerFor);
    for (const instance of instances) renderInstances.push({
      groupUid: group.uid,
      sourceUids: [...sourceUids],
      center: [...center],
      matrix: instance.matrix.map(row => [...row]),
      reflected: matrixDeterminant(instance.matrix) < 0
    });
  }
  return renderInstances;
}

function exportMirroredGroup(project, group, pushElement) {
  const controller = project.getNode(group.mirror.controllerUid);
  if (!controller || controller.type !== 'node') return null;
  const controllerChain = relativeMirrorChain(project, controller.uid, group.uid);
  const frameMatrix = matrixMultiply(groupChainMatrix(controllerChain), rotationMatrix(controller.rotation));
  const center = applyGroupChainPoint(controller.position, controllerChain);
  const instances = mirrorInstanceDefinitions(group, frameMatrix);
  const sourceUids = project.getDescendantElementUids(group.uid)
    .filter(uidValue => uidValue !== controller.uid && !project.getNode(uidValue)?.mirrorControllerFor);
  const reflectedLocalAxis = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const instanceGroups = instances.map((instance, instanceIndex) => {
    const children = [];
    let generatedIndex = 0;
    for (const uidValue of sourceUids) {
      const element = project.getNode(uidValue);
      if (!element) continue;
      const chain = relativeMirrorChain(project, element.uid, group.uid);
      const chainMatrix = groupChainMatrix(chain);
      if (element.type === 'locator' || element.type === 'node') {
        const basePosition = applyGroupChainPoint(element.position, chain);
        const orientation = matrixMultiply(chainMatrix, rotationMatrix(element.rotation));
        const handednessFix = matrixDeterminant(instance.matrix) < 0 ? reflectedLocalAxis : matrixIdentity();
        const transformed = new Locator({
          uid: `${element.uid}_mirror_${instanceIndex + 1}`,
          name: element.name,
          position: transformAround(basePosition, center, instance.matrix),
          rotation: matrixEuler(matrixMultiply(matrixMultiply(instance.matrix, orientation), handednessFix)),
          visible: element.visible,
          locked: element.locked,
          exported: element.exported
        });
        pushElement(blockbenchLocator(transformed));
        children.push(transformed.uid);
        continue;
      }
      const cubes = typeof element.toCubes === 'function'
        ? element.toCubes().map(cube => ({ cube, offset: element.origin || [0, 0, 0], ownerRotation: element.rotation || [0, 0, 0], ownerOrigin: element.origin || [0, 0, 0] }))
        : element.type === 'cube' ? [{ cube: element, offset: [0, 0, 0], ownerRotation: [0, 0, 0], ownerOrigin: element.pivot }] : [];
      for (const source of cubes) {
        const baseFrom = source.cube.position.map((value, axis) => value + source.offset[axis]);
        const baseTo = baseFrom.map((value, axis) => value + source.cube.size[axis]);
        const basePivot = source.cube.pivot.map((value, axis) => value + source.offset[axis]);
        const ownerMatrix = rotationMatrix(source.ownerRotation);
        const ownerPivot = source.ownerOrigin;
        const ownedPivot = transformAround(basePivot, ownerPivot, ownerMatrix);
        const worldPivot = applyGroupChainPoint(ownedPivot, chain);
        const worldOrientation = matrixMultiply(matrixMultiply(chainMatrix, ownerMatrix), rotationMatrix(source.cube.rotation));
        const mirrored = matrixDeterminant(instance.matrix) < 0;
        const handednessFix = mirrored ? reflectedLocalAxis : matrixIdentity();
        const nextPivot = transformAround(worldPivot, center, instance.matrix);
        const nextFromOffset = matrixVector(handednessFix, baseFrom.map((value, axis) => value - basePivot[axis]));
        const nextToOffset = matrixVector(handednessFix, baseTo.map((value, axis) => value - basePivot[axis]));
        const exported = blockbenchCube(source.cube, source.offset);
        exported.uuid = `${element.uid}_mirror_${instanceIndex + 1}_${++generatedIndex}`;
        exported.from = nextFromOffset.map((value, axis) => value + nextPivot[axis]);
        exported.to = nextToOffset.map((value, axis) => value + nextPivot[axis]);
        exported.origin = nextPivot;
        exported.rotation = matrixEuler(matrixMultiply(matrixMultiply(instance.matrix, worldOrientation), handednessFix));
        exported.inflate = (Number(source.cube.inflate) || 0) + chain.reduce((total, parent) => total + (Number(parent.inflate) || 0), 0);
        exported.shade = source.cube.shade !== false && element.shade !== false && chain.every(parent => parent.shade !== false);
        exported.visibility = source.cube.visible !== false && element.visible !== false && chain.every(parent => parent.visible !== false);
        pushElement(exported);
        children.push(exported.uuid);
      }
    }
    return {
      name: instance.name,
      origin: [...center], rotation: [0, 0, 0], color: 0,
      uuid: `${group.uid}_mirror_instance_${instanceIndex + 1}`,
      export: group.exported !== false, locked: group.locked === true,
      visibility: group.visible !== false, autouv: group.autoUv ? 1 : 0,
      shade: group.shade !== false, isOpen: true, children
    };
  });
  if (!group.mirror.wrapParent) return instanceGroups;
  return {
    name: group.name,
    origin: [...center], rotation: [0, 0, 0], color: 0,
    uuid: `${group.uid}_mirror_parent`, export: group.exported !== false,
    locked: group.locked === true, visibility: group.visible !== false,
    autouv: group.autoUv ? 1 : 0, shade: group.shade !== false,
    isOpen: true, children: instanceGroups
  };
}

export function exportBlockbench(project, textureAssets = []) {
  const elements = [];
  const exportedElementIds = new Set();
  const pushElement = element => {
    if (exportedElementIds.has(element.uuid)) return;
    exportedElementIds.add(element.uuid);
    elements.push(element);
  };
  const proceduralGroup = element => {
    const generated = element.toCubes();
    const children = generated.map((cube, index) => {
      cube.uid = `${element.uid}_cube_${index + 1}`;
      pushElement(blockbenchCube(cube, element.origin || [0, 0, 0]));
      return cube.uid;
    });
    return {
      name: element.name,
      origin: [...(element.origin || [0, 0, 0])],
      rotation: [...(element.rotation || [0, 0, 0])],
      color: 0,
      uuid: `${element.uid}_group`,
      export: element.exported !== false,
      locked: element.locked === true,
      visibility: element.visible !== false,
      autouv: element.autoUv ? 1 : 0,
      shade: element.shade !== false,
      isOpen: true,
      children
    };
  };
  const visit = uidValue => {
    const node = project.getNode(uidValue);
    if (!node) return null;
    if (node.type === 'group' && node.mirror?.enabled) {
      const mirrored = exportMirroredGroup(project, node, pushElement);
      if (mirrored) return mirrored;
    }
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
      shade: node.shade !== false,
      isOpen: true,
      children: node.children.flatMap(childUid => {
        const child = visit(childUid);
        return Array.isArray(child) ? child : child ? [child] : [];
      })
    };
    if (node.type === 'cube') {
      pushElement(blockbenchCube(node));
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
