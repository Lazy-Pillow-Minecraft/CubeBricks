export const JavaBlockVersion = Object.freeze({
  LEGACY: '1.9-1.21.5',
  SINGLE_AXIS: '1.21.6-1.21.10',
  UNRESTRICTED: '1.21.11+'
});
const JAVA_BLOCK_VERSIONS = new Set(Object.values(JavaBlockVersion));

export function formatRules(project) {
  const javaBlock = project?.formatId === 'java_block_item';
  const bedrockBlock = project?.formatId === 'bedrock_block';
  const moddedEntity = project?.formatId === 'modded_entity';
  const version = JAVA_BLOCK_VERSIONS.has(project?.formatData?.javaBlockVersion)
    ? project.formatData.javaBlockVersion : JavaBlockVersion.LEGACY;
  return {
    javaBlock, bedrockBlock, moddedEntity, version,
    forceCullFaces: javaBlock,
    allowBoxUv: !javaBlock,
    allowFaceUv: !moddedEntity,
    integerCubeSize: moddedEntity,
    allowCubeRotation: !moddedEntity,
    singleAxisRotation: javaBlock && version !== JavaBlockVersion.UNRESTRICTED,
    rotationStep: javaBlock && version === JavaBlockVersion.LEGACY ? 22.5 : null,
    rotationLimit: javaBlock && version === JavaBlockVersion.LEGACY ? 45 : null
  };
}

export function constrainRotation(rotation, rules, { cube = false } = {}) {
  if (!Array.isArray(rotation)) return [0, 0, 0];
  if (cube && !rules.allowCubeRotation) return [0, 0, 0];
  const result = rotation.map(value => Number.isFinite(Number(value)) ? Number(value) : 0);
  if (rules.singleAxisRotation) {
    const axis = result.reduce((best, value, index) => Math.abs(value) > Math.abs(result[best]) ? index : best, 0);
    result.forEach((_, index) => { if (index !== axis) result[index] = 0; });
  }
  if (rules.rotationStep) return result.map(value => {
    const snapped = Math.round(value / rules.rotationStep) * rules.rotationStep;
    return rules.rotationLimit ? Math.max(-rules.rotationLimit, Math.min(rules.rotationLimit, snapped)) : snapped;
  });
  return result;
}

export function constrainCube(cube, rules) {
  if (rules.moddedEntity) {
    cube.size = cube.size.map(value => Math.round(value));
    cube.rotation = [0, 0, 0];
  } else if (rules.javaBlock) {
    cube.rotation = constrainRotation(cube.rotation, rules, { cube: true });
    // Java validates the unrotated from/to values, not the rotated corners.
    // Moving a diagonal cube because its visual AABB crosses this box would
    // reject otherwise valid Minecraft models.
    for (let axis = 0; axis < 3; axis++) {
      const start = Number(cube.position?.[axis]);
      const size = Number(cube.size?.[axis]);
      if (!Number.isFinite(start) || !Number.isFinite(size)) continue;
      const sign = size < 0 ? -1 : 1;
      const span = Math.min(48, Math.abs(size));
      const next = Math.max(sign < 0 ? -16 + span : -16,
        Math.min(sign < 0 ? 32 : 32 - span, start));
      if (next !== start && Array.isArray(cube.pivot)) cube.pivot[axis] += next - start;
      cube.position[axis] = next;
      cube.size[axis] = sign * span;
    }
  }
  if (!rules.allowBoxUv) cube.uvMode = 'face';
  if (!rules.allowFaceUv) cube.uvMode = 'box';
  if (cube.uvMode === 'box') {
    cube.autoUv = true;
    for (const face of Object.values(cube.faces || {})) if (face) delete face.uv;
  }
  return cube;
}

export function constrainNode(node, rules) {
  if (!node) return node;
  if (node.type === 'cube') return constrainCube(node, rules);
  if (Array.isArray(node.rotation) && rules.javaBlock) node.rotation = constrainRotation(node.rotation, rules);
  if (rules.moddedEntity && node.type !== 'group' && Array.isArray(node.origin)) {
    node.origin = node.origin.map(value => Math.round(value));
    if (Array.isArray(node.pivot)) node.pivot = node.pivot.map(value => Math.round(value));
    for (const key of ['radius', 'height', 'innerRadius', 'thickness', 'cubeSize', 'segmentLength']) {
      if (Number.isFinite(node.parameters?.[key])) node.parameters[key] = Math.round(node.parameters[key]);
    }
  }
  if ('uvMode' in node) {
    if (!rules.allowBoxUv) node.uvMode = 'face';
    if (!rules.allowFaceUv) { node.uvMode = 'box'; node.autoUv = true; }
  }
  return node;
}

export function constrainProject(project) {
  const rules = formatRules(project);
  if (!rules.javaBlock && !rules.moddedEntity) return project;
  if (rules.forceCullFaces) project.cullFaces = true;
  project.uvMode = rules.moddedEntity ? 'box' : 'face';
  for (const node of [...project.groups, ...project.elements]) constrainNode(node, rules);
  return project;
}

const DEG = Math.PI / 180;
const BEDROCK_BASE = [[-8, 8], [0, 16], [-8, 8]];
const BEDROCK_CENTER = [0, 8, 0];
const BEDROCK_CENTER_TRAVEL = 7;

function rotate(point, pivot, angles = [0, 0, 0]) {
  let [x, y, z] = point.map((value, axis) => value - (pivot?.[axis] || 0));
  const [rx, ry, rz] = angles.map(value => (Number(value) || 0) * DEG);
  let c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z].map((value, axis) => value + (pivot?.[axis] || 0));
}

// Use the same cube -> owner -> parent rotation order as the viewport. Bedrock
// checks the rendered extents, whereas Java checks raw element coordinates.
export function projectSizeBounds(project) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let hasBaseCube = false;
  for (const element of project?.elements || []) {
    if (element.type === 'locator' || element.type === 'node') continue;
    const generated = typeof element.toCubes === 'function' ? element.toCubes() : [element];
    const offset = typeof element.toCubes === 'function' ? element.origin || [0, 0, 0] : [0, 0, 0];
    const groups = project.getGroupChain?.(element.uid) || [];
    const ownerRotated = typeof element.toCubes === 'function'
      && element.rotation?.some(value => Math.abs(Number(value) || 0) > 1e-8);
    const groupRotated = groups.some(group => group.rotation?.some(value => Math.abs(Number(value) || 0) > 1e-8));
    const inflate = groups.reduce((sum, group) => sum + (Number(group.inflate) || 0), 0);
    for (const cube of generated) {
      if (!Array.isArray(cube.position) || !Array.isArray(cube.size)) continue;
      const cubeMin = [Infinity, Infinity, Infinity], cubeMax = [-Infinity, -Infinity, -Infinity];
      const extra = inflate + (Number(cube.inflate) || 0);
      const axes = cube.position.map((value, axis) => {
        const first = value + offset[axis], last = first + cube.size[axis];
        return [Math.min(first, last) - extra, Math.max(first, last) + extra];
      });
      const cubeRotated = cube.rotation?.some(value => Math.abs(Number(value) || 0) > 1e-8);
      if (!cubeRotated && !ownerRotated && !groupRotated) {
        for (let axis = 0; axis < 3; axis++) {
          cubeMin[axis] = axes[axis][0]; cubeMax[axis] = axes[axis][1];
          min[axis] = Math.min(min[axis], cubeMin[axis]);
          max[axis] = Math.max(max[axis], cubeMax[axis]);
        }
      } else {
        for (let mask = 0; mask < 8; mask++) {
          let point = axes.map((range, axis) => range[(mask >> axis) & 1]);
          point = rotate(point, (cube.pivot || [0, 0, 0]).map((value, axis) => value + offset[axis]), cube.rotation);
          if (element !== cube) point = rotate(point, element.pivot || element.origin, element.rotation);
          for (const group of [...groups].reverse()) point = rotate(point, group.pivot, group.rotation);
          for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], point[axis]);
            max[axis] = Math.max(max[axis], point[axis]);
            cubeMin[axis] = Math.min(cubeMin[axis], point[axis]);
            cubeMax[axis] = Math.max(cubeMax[axis], point[axis]);
          }
        }
      }
      if ([0, 1, 2].every(axis => Math.min(cubeMax[axis], BEDROCK_BASE[axis][1])
        - Math.max(cubeMin[axis], BEDROCK_BASE[axis][0]) >= 1 - 1e-6)) hasBaseCube = true;
    }
  }
  return min[0] === Infinity ? null : { min, max, hasBaseCube };
}

export function bedrockSizeViolation(bounds) {
  if (!bounds) return 0;
  let violation = bounds.hasBaseCube === false ? 1 : 0;
  for (let axis = 0; axis < 3; axis++) {
    violation += Math.max(0, BEDROCK_CENTER[axis] - BEDROCK_CENTER_TRAVEL - 15 - bounds.min[axis]);
    violation += Math.max(0, bounds.max[axis] - BEDROCK_CENTER[axis] - BEDROCK_CENTER_TRAVEL - 15);
    violation += Math.max(0, bounds.max[axis] - bounds.min[axis] - 30);
    violation += Math.max(0, 1 - Math.min(bounds.max[axis], BEDROCK_BASE[axis][1])
      + Math.max(bounds.min[axis], BEDROCK_BASE[axis][0]));
  }
  return violation;
}

export function bedrockSizeIsValid(bounds, epsilon = 1e-6) {
  return bedrockSizeViolation(bounds) <= epsilon;
}

export function bedrockLimitBox(bounds) {
  const center = bounds?.min.map((value, axis) => Math.max(BEDROCK_CENTER[axis] - BEDROCK_CENTER_TRAVEL,
    Math.min(BEDROCK_CENTER[axis] + BEDROCK_CENTER_TRAVEL,
      (value + bounds.max[axis]) / 2))) || [...BEDROCK_CENTER];
  return { min: center.map(value => value - 15), max: center.map(value => value + 15),
    valid: bedrockSizeIsValid(bounds) };
}

export function javaBlockSizeViolation(project) {
  let violation = 0;
  for (const element of project?.elements || []) {
    if (element.type === 'locator' || element.type === 'node') continue;
    const generated = typeof element.toCubes === 'function' ? element.toCubes() : [element];
    const offset = typeof element.toCubes === 'function' ? element.origin || [0, 0, 0] : [0, 0, 0];
    for (const cube of generated) for (let axis = 0; axis < 3; axis++) {
      const from = cube.position?.[axis] + offset[axis];
      const to = from + cube.size?.[axis];
      if (!Number.isFinite(from) || !Number.isFinite(to)) return Infinity;
      violation += Math.max(0, -16 - Math.min(from, to)) + Math.max(0, Math.max(from, to) - 32);
    }
  }
  return violation;
}

export function javaBlockSizeIsValid(project, epsilon = 1e-6) {
  return javaBlockSizeViolation(project) <= epsilon;
}

const GEOMETRY_FIELDS = ['position', 'size', 'pivot', 'origin', 'rotation', 'inflate', 'parameters', 'nodes', 'modifiers'];

export function captureFormatGeometry(nodes) {
  return [...new Set(nodes.filter(Boolean))].map(node => [node,
    Object.fromEntries(GEOMETRY_FIELDS.filter(key => key in node)
      .map(key => [key, structuredClone(node[key])]))]);
}

export function restoreFormatGeometry(captured) {
  for (const [node, values] of captured) for (const [key, value] of Object.entries(values)) node[key] = value;
}

export function keepFormatEditWithinLimit(project, captured) {
  const rules = formatRules(project);
  const violation = rules.bedrockBlock ? bedrockSizeViolation(projectSizeBounds(project))
    : rules.javaBlock ? javaBlockSizeViolation(project) : 0;
  if (violation <= 1e-6) return true;
  const after = captureFormatGeometry(captured.map(([node]) => node));
  restoreFormatGeometry(captured);
  const previous = rules.bedrockBlock ? bedrockSizeViolation(projectSizeBounds(project))
    : javaBlockSizeViolation(project);
  if (violation < previous - 1e-6) {
    restoreFormatGeometry(after);
    return true;
  }
  return false;
}
