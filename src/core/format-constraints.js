export const JavaBlockVersion = Object.freeze({
  LEGACY: '1.9-1.21.5',
  SINGLE_AXIS: '1.21.6-1.21.10',
  UNRESTRICTED: '1.21.11+'
});
const JAVA_BLOCK_VERSIONS = new Set(Object.values(JavaBlockVersion));

export function formatRules(project) {
  const javaBlock = project?.formatId === 'java_block_item';
  const moddedEntity = project?.formatId === 'modded_entity';
  const version = JAVA_BLOCK_VERSIONS.has(project?.formatData?.javaBlockVersion)
    ? project.formatData.javaBlockVersion : JavaBlockVersion.LEGACY;
  return {
    javaBlock, moddedEntity, version,
    allowBoxUv: !javaBlock,
    allowFaceUv: !moddedEntity,
    integerCubeSize: moddedEntity,
    allowCubeRotation: !moddedEntity,
    singleAxisRotation: javaBlock && version !== JavaBlockVersion.UNRESTRICTED,
    rotationStep: javaBlock && version === JavaBlockVersion.LEGACY ? 22.5 : null
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
  if (rules.rotationStep) return result.map(value => Math.round(value / rules.rotationStep) * rules.rotationStep);
  return result;
}

export function constrainCube(cube, rules) {
  if (rules.moddedEntity) {
    cube.size = cube.size.map(value => Math.round(value));
    cube.rotation = [0, 0, 0];
  } else if (rules.javaBlock) cube.rotation = constrainRotation(cube.rotation, rules, { cube: true });
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
  project.uvMode = rules.moddedEntity ? 'box' : 'face';
  for (const node of [...project.groups, ...project.elements]) constrainNode(node, rules);
  return project;
}
